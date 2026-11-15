"""Independent landing-grid/API regressions against original NASA records and TIFFs."""
from pathlib import Path
from urllib.parse import urlparse,parse_qs
import math
import numpy as np
import pytest
from fastapi.testclient import TestClient
from api.app.main import app
from api.app.landing import surface,get_cell
from api.app.core.horizon import geometric_horizon,circular_interpolate
from api.app.core.sites import DATA
client=TestClient(app)
BASE={'start_utc':'2026-12-14T00:00:00Z','end_utc':'2026-12-17T00:00:00Z','step_minutes':60,'observer_height_m':2}

@pytest.mark.parametrize('region',['site01','site04'])
@pytest.mark.parametrize('target',['Sun','Earth'])
def test_observer_is_exact_dem_cell_with_original_nasa_range(region,target):
    sid=f'{region}:10:10'
    response=client.get('/api/landing/ephemeris',params={**BASE,'cell_id':sid,'target':target})
    assert response.status_code==200
    result=response.json()
    _,cell=get_cell(sid)
    assert result['meta']['latitude_deg']==cell['latitude_deg']
    assert result['meta']['longitude_deg']==cell['longitude_deg']
    q=parse_qs(urlparse(result['meta']['query_url']).query)
    xyz=[float(v) for v in q['SITE_COORD'][0].strip("'").split(',')]
    assert xyz==pytest.approx([cell['longitude_deg'],cell['latitude_deg'],(cell['elevation_m']+2)/1000],abs=1e-8)
    assert q['QUANTITIES']==["'4,20'"]
    assert len(result['samples'])==73
    for row in result['samples']:
        assert row['horizon_deg']==pytest.approx(circular_interpolate(cell['horizon_deg'],row['azimuth_deg']))
        assert row['visible']==(row['elevation_deg']>row['horizon_deg'])
        assert row['range_km']>100000
    hours=sum(row['visible'] for row in result['samples'][:-1])
    assert result['summary']['sun_visible_hours' if target=='Sun' else 'earth_visible_hours']==hours

@pytest.mark.parametrize('patch',[
    {'cell_id':'outside'},{'target':'Mars'},{'observer_height_m':5},
    {'start_utc':''},{'start_utc':'2026-02-30T00:00:00Z'},
    {'start_utc':'2026-12-14T00:00:00'},{'step_minutes':-1},
])
def test_invalid_point_dates_and_height_never_produce_scientific_result(patch):
    r=client.get('/api/landing/ephemeris',params={**BASE,'cell_id':'site01:10:10','target':'Sun',**patch})
    assert r.status_code==422
    assert r.json()['status']=='unavailable'
    assert not r.json().get('samples')

def test_finite_angular_profiles_and_native_rendering_resolution():
    data=surface()
    assert len(data['source_sha256'])==7
    assert data['native_resolution_m']==5
    assert sum(len(r['cells']) for r in data['regions'])==882
    for region in data['regions']:
        grid=region['render_grid']
        assert grid['spacing_m']==5
        assert len(grid['heights'])==221**2
        for cell in region['cells']:
            assert len(cell['horizon_deg'])==360
            assert all(math.isfinite(h) for h in cell['horizon_deg'])
            assert cell['max_slope_deg']>=cell['slope_deg']
            assert 0<=cell['ray_coverage_fraction']<=1

def test_native_maximum_slope_uses_every_5m_pixel_in_cell_and_footprint():
    import rasterio
    for region in surface()['regions']:
        path=DATA/f"raw/{region['id']}-slp.tif"
        if not path.exists():pytest.skip('Original large TIFFs optional; run acquire_nasa.py to audit native pixels.')
        with rasterio.open(path) as ds:
            raw=ds.read(1)
            for cell in region['cells'][::37]:
                row,col=ds.index(cell['x_m'],cell['y_m'])
                maximum=float(raw[row-8:row+9,col-8:col+9].max())
                assert cell['max_slope_deg']==pytest.approx(maximum,abs=.000051)

def test_geometric_horizon_curvature_sign_and_missing_values():
    distances=np.arange(5,50001,5)
    elevation=geometric_horizon(np.zeros(len(distances)),distances,0,2)
    assert elevation<0
    assert .1>elevation
    assert geometric_horizon([math.nan,100],[10,1000],0,2)>5

def test_reference_cells_use_the_same_horizon_as_the_canonical_engine():
    from api.app.core.horizon import horizon_at
    for rid in ('site01','site04'):
        _,cell=get_cell(rid+':10:10')
        for az in range(360):
            assert cell['horizon_deg'][az]==pytest.approx(horizon_at(rid,az,2,'terrain')['elevation_deg'],abs=.0011)
