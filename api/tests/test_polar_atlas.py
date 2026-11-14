"""Scientific data checks for the regional 3D view, separate from its appearance."""
import hashlib
import json
import math
from pathlib import Path
import numpy as np
import pytest
from pyproj import CRS, Transformer

ROOT=Path(__file__).resolve().parents[2]
ATLAS=ROOT/'frontend/public/data/polar-atlas'
MANIFEST=json.loads((ATLAS/'manifest.json').read_text(encoding='utf-8'))

def test_regional_binary_integrity_and_height_bounds():
    binary=(ATLAS/'south-pole-height.u16').read_bytes()
    assert hashlib.sha256(binary).hexdigest()==MANIFEST['height_sha256']
    grid=np.frombuffer(binary,dtype='<u2').reshape((MANIFEST['grid_size'],)*2)
    valid=grid!=MANIFEST['nodata']
    assert int(valid.sum())==MANIFEST['valid_vertices']
    assert 0.7<valid.mean()<0.8  # The polar cap has a real circular footprint, not invented corner terrain.
    heights=grid[valid].astype(float)*MANIFEST['scale_m']+MANIFEST['offset_m']
    assert abs(heights.min()-MANIFEST['min_elevation_m'])<=.26
    assert abs(heights.max()-MANIFEST['max_elevation_m'])<=.26

def test_official_feature_labels_are_projected_with_the_actual_lunar_crs():
    lunar=CRS.from_proj4(f'+proj=longlat +R={MANIFEST["radius_m"]} +no_defs')
    transform=Transformer.from_crs(lunar,CRS.from_wkt(MANIFEST['crs_wkt']),always_xy=True)
    features={feature['name']:feature for feature in MANIFEST['features']}
    assert {'Shackleton','Shoemaker','Haworth','Cabeus','Mons Mouton','Amundsen'}<=features.keys()
    assert features['Shackleton']['latitude_deg']==-89.67
    assert features['Shackleton']['longitude_east_deg']==129.78
    for feature in features.values():
        x,y=transform.transform(feature['longitude_east_deg'],feature['latitude_deg'])
        assert abs(x-feature['x_m'])<.01
        assert abs(y-feature['y_m'])<.01
        assert math.hypot(x,y)<304000
        assert 'planetarynames.wr.usgs.gov' in feature['source_url']

def test_display_uses_pixel_centers_and_declares_downsampling():
    m=MANIFEST;n=m['grid_size'];spacing=m['display_spacing_m']
    assert m['source_resolution_m']==80
    assert spacing>m['source_resolution_m']
    assert abs(m['sample_extent_m']['xmin']-(m['extent_m']['xmin']+spacing/2))<1e-6
    assert abs(m['sample_extent_m']['ymax']-(m['extent_m']['ymax']-spacing/2))<1e-6
    assert abs(m['sample_extent_m']['xmax']-m['sample_extent_m']['xmin']-(n-1)*spacing)<1e-6
    assert any('lighting' in note for note in m['limitations'])

def test_prepared_height_samples_agree_with_nasa_geotiff_when_source_is_present():
    source=ROOT/'data/raw/regional80m.tif'
    if not source.exists():pytest.skip('Raw NASA file is intentionally excluded from Git.')
    import rasterio
    from rasterio.enums import Resampling
    with rasterio.open(source) as dataset:
        n=MANIFEST['grid_size'];sampled=dataset.read(1,out_shape=(n,n),masked=True,resampling=Resampling.bilinear)
    actual=np.fromfile(ATLAS/'south-pole-height.u16',dtype='<u2').reshape(n,n)
    for row,col in [(384,384),(150,380),(400,180),(600,430)]:
        assert actual[row,col]!=MANIFEST['nodata']
        height=float(actual[row,col])*MANIFEST['scale_m']+MANIFEST['offset_m']
        assert abs(height-float(sampled[row,col]))<=.252

def test_atlas_earth_query_uses_the_shared_catalog_and_exact_source_record():
    from fastapi.testclient import TestClient
    from api.app.main import app
    with TestClient(app) as client:
        response=client.get('/api/earth',params={'canonical':'true','site_id':'site04'})
    assert response.status_code==200
    result=response.json()
    assert len(result['samples'])==169
    assert result['meta']['latitude_deg']==-89.76674148
    assert 'SITE_COORD' in result['meta']['query_url']
    expected=json.loads((ROOT/'data/prepared/site04-earth.json').read_text(encoding='utf-8'))
    assert result['samples']==expected['samples']
