"""Regional screening regressions: native NASA source, geometry and honest scope."""
from pathlib import Path
import hashlib
import math

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.app.polar import router, surface, validate_surface
from api.scripts.prepare_polar_screening import native_cell_metrics, inverse_projection, RADIUS_M

ROOT = Path(__file__).resolve().parents[2]
polar_app = FastAPI()
polar_app.include_router(router)
client = TestClient(polar_app)


def test_polar_route_full_cap_shape_and_unknown_corners():
    response = client.get('/api/polar/surface')
    assert response.status_code == 200
    data = response.json()
    assert data['analysis_type'] == 'regional-terrain-screening'
    assert data['latitude_bounds_deg'] == [-90, -80]
    assert data['source_resolution_m'] == 80
    assert data['grid_size'] == 128
    assert len(data['cells']) == 128**2
    assert data['statistics']['known_cells'] > 12000
    assert data['statistics']['unknown_cap_cells'] == 0
    assert data['cells'][0]['known'] is False
    assert data['cells'][0]['regional_slope_deg'] is None
    assert data['cells'][0]['elevation_m'] is None
    assert 0.99 < data['statistics']['covered_area_km2']/data['statistics']['cap_area_km2'] < 1.01
    assert any('not mean safe' in v for v in data['limitations'])
    assert any('No Sun/Earth' in v for v in data['limitations'])


def test_spherical_polar_coordinates_match_independent_pyproj():
    from pyproj import CRS, Transformer
    source = CRS.from_proj4(f'+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R={RADIUS_M} +units=m +no_defs')
    target = CRS.from_proj4(f'+proj=longlat +R={RADIUS_M} +no_defs')
    transform = Transformer.from_crs(source,target,always_xy=True)
    for x,y in [(0,0),(100000,200000),(-290000,0),(2375,-2375)]:
        lat,lon = inverse_projection(x,y)
        longitude,latitude = transform.transform(x,y)
        assert lat == pytest.approx(latitude,abs=1e-10)
        if x or y:
            assert lon == pytest.approx(longitude,abs=1e-10)


def test_polar_values_are_finite_with_nonzero_native_sample_count():
    data=surface()
    for cell in data['cells']:
        if cell['known']:
            assert -90 <= cell['latitude_deg'] <= -80
            assert 0 <= cell['median_slope_deg'] <= cell['regional_slope_deg'] <= cell['max_slope_deg'] <= 90
            assert cell['coverage_fraction'] >= .95
            assert cell['native_pixels'] > 100
            assert cell['roughness_m'] >= 0
            assert cell['relief_m'] >= 0
        else:
            assert cell['regional_slope_deg'] is None


def test_missing_or_nonfinite_polar_values_fail_validation():
    import copy
    data=copy.deepcopy(surface())
    cell=next(c for c in data['cells'] if c['known'])
    cell['regional_slope_deg']=None
    with pytest.raises(ValueError,match='missing'):
        validate_surface(data)
    cell['regional_slope_deg']=math.nan
    with pytest.raises(ValueError,match='missing'):
        validate_surface(data)


def test_native_dem_hash_and_center_heights_independent_of_display_mesh():
    path=ROOT/'data/raw/regional80m.tif'
    if not path.exists():
        pytest.skip('Original NASA TIFF is optional in a clone.')
    import rasterio
    data=surface()
    assert hashlib.sha256(path.read_bytes()).hexdigest()==data['source_sha256']
    known=[c for c in data['cells'] if c['known']]
    with rasterio.open(path) as ds:
        for cell in known[::239]:
            height=float(next(ds.sample([(cell['x_m'],cell['y_m'])]))[0])
            assert cell['elevation_m']==pytest.approx(height,abs=.00051)


def test_native_slopes_use_80m_pixels_with_stereographic_scale():
    """Synthetic tilted plane has an independent analytic derivative."""
    import rasterio
    from rasterio.io import MemoryFile
    from rasterio.transform import from_origin
    n=100
    transform=from_origin(96500,3500,80,80)
    x=transform.c+(np.arange(n)+.5)*80
    y=transform.f-(np.arange(n)+.5)*80
    xx,yy=np.meshgrid(x,y)
    gradient=math.tan(math.radians(10))
    heights=(gradient*xx).astype('float64')
    with MemoryFile() as mem:
        with mem.open(driver='GTiff',width=n,height=n,count=1,dtype='float64',transform=transform,
                      nodata=-9999) as ds:
            ds.write(heights,1)
            result=native_cell_metrics(ds,100000,0)
    assert result['known']
    scale=1+(100000/(2*RADIUS_M))**2
    expected=math.degrees(math.atan(gradient*scale))
    assert result['regional_slope_deg']==pytest.approx(expected,abs=.001)
    assert result['median_slope_deg']==pytest.approx(expected,abs=.001)
    assert result['regional_slope_deg'] > 10


def test_nodata_plane_never_becomes_smooth_known_terrain():
    import rasterio
    from rasterio.io import MemoryFile
    from rasterio.transform import from_origin
    values=np.full((100,100),-9999.,dtype='float64')
    with MemoryFile() as mem:
        with mem.open(driver='GTiff',width=100,height=100,count=1,dtype='float64',
                      transform=from_origin(-4000,4000,80,80),
                      nodata=-9999) as ds:
            ds.write(values,1)
            assert native_cell_metrics(ds,0,0) is None
