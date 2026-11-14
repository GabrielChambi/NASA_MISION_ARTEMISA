import asyncio
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from api.app.main import app
from api.app.core.sites import DATA, get_site
from api.app.core.horizon import circular_interpolate, geometric_horizon, horizon_at, HorizonUnavailable
from api.app.solar.windows import visibility_metrics
from api.app.solar.horizons import parse_result, HorizonsUnavailable, query_parameters
from api.app.solar.service import validate_request, solar_result

UTC=timezone.utc
START=datetime(2026,12,1,tzinfo=UTC)
END=START+timedelta(days=7)
client=TestClient(app)

def series(flags):
    return [{'t_utc':(START+timedelta(hours=i)).isoformat().replace('+00:00','Z'),'visible':flag} for i,flag in enumerate(flags)]

@pytest.mark.parametrize('flags,hours,longest,count',[
    ([True,True,True],2,0,1),([False,False,True],0,2,0),
    ([True,False,True,False],2,1,2),([False,True,True,False],2,1,1)])
def test_half_open_windows_do_not_add_final_endpoint(flags,hours,longest,count):
    rows=series(flags); windows,summary=visibility_metrics(rows,rows[-1]['t_utc'])
    assert summary['sun_visible_hours']==hours
    assert summary['longest_dark_gap_hours']==longest
    assert len(windows)==count
    assert sum(w['duration_hours'] for w in windows)==hours

def test_utc_windows_cross_midnight():
    rows=series([True]*26)
    windows,summary=visibility_metrics(rows,rows[-1]['t_utc'])
    assert summary['duration_hours']==25
    assert windows[0]['end_utc']=='2026-12-02T01:00:00Z'

def test_circular_horizon_wraps_at_north():
    profile=[0.0]*360; profile[359]=10; profile[0]=20; profile[1]=10
    assert circular_interpolate(profile,359.5)==15
    assert circular_interpolate(profile,-.5)==15
    assert circular_interpolate(profile,.5)==15
    assert circular_interpolate(profile,360)==20

def test_synthetic_plane_hill_nodata():
    assert geometric_horizon([0,0],[10,100],0,0)<=0
    assert geometric_horizon([10],[100],0,1)>5
    with pytest.raises(HorizonUnavailable): geometric_horizon([float('nan')],[100],0,1)

@pytest.mark.parametrize('start,end,step',[
    ('2026-12-01T00:00:00','2026-12-08T00:00:00Z',60),
    ('2026-12-01T00:00:00-04:00','2026-12-08T00:00:00Z',60),
    ('2026-12-08T00:00:00Z','2026-12-01T00:00:00Z',60),
    ('2026-12-01T00:00:01Z','2026-12-08T00:00:01Z',60),
    ('2026-12-01T00:00:00Z','2027-12-08T00:00:00Z',60),
    ('2026-12-01T00:00:00Z','2026-12-08T00:00:00Z',61),
    ('2026-12-01T00:00:00Z','2026-12-08T00:00:00Z',1)])
def test_invalid_time_or_step_is_explicit(start,end,step):
    with pytest.raises(ValueError): validate_request(start,end,step,'site04',1,'flat')

def test_pre_1962_ut1_is_not_mislabeled_utc():
    with pytest.raises(ValueError,match='UT1'):
        validate_request('1961-12-01T00:00:00Z','1961-12-02T00:00:00Z',60,'site04',1,'flat')

def test_sites_provenance_and_dem_reference_pixel():
    response=client.get('/api/sites'); assert response.status_code==200
    for site in response.json()['sites']:
        assert site['dem_coverage']=='verified'
        assert -90<site['latitude_deg']<-89
        assert site['reference_frame']=='MOON_ME / DE421'
        assert 'not an approved' in site['coordinate_quality']
        terrain=client.get(f"/api/sites/{site['id']}/terrain").json()
        assert len(terrain['elevations_m'])==65*65
        assert len(terrain['slope_degrees'])==65*65
        assert len(terrain['height_uncertainty_m'])==65*65
        assert all(isinstance(z,(int,float)) for z in terrain['elevations_m'])

def test_horizons_height_includes_surface_elevation():
    site=get_site('site04')
    params=query_parameters(site,START,END,60,1)
    assert abs(float(params['SITE_COORD'].strip("'").split(',')[2])-(site['elevation_m']+1)/1000)<1e-8

def test_real_cached_horizons_table_and_independent_crosschecks():
    record=next(json.loads(p.read_text()) for p in sorted((DATA/'prepared'/'ephemeris').glob('*.json')) if json.loads(p.read_text())['params']['COMMAND']=="'10'" and json.loads(p.read_text())['params']['START_TIME']==f"'{START.strftime('%Y-%m-%d %H:%M:%S')}'")
    parsed=parse_result(record['response']['result'],START,END,60)
    assert len(parsed)==169
    checks=json.loads((DATA/'prepared'/'validation.json').read_text())['checks']
    assert len(checks)==6
    assert all(check['max_difference_deg']<=1e-5 for check in checks)
    with pytest.raises(HorizonsUnavailable): parse_result('NASA service unavailable',START,END,60)
    with pytest.raises(HorizonsUnavailable): parse_result(None,START,END,60)
    with pytest.raises(HorizonsUnavailable): parse_result(record['response']['result'].replace('$$EOE',''),START,END,60)

def test_failed_horizons_never_returns_visible_samples(monkeypatch):
    async def failed(*args,**kwargs): raise HorizonsUnavailable('NASA unavailable')
    monkeypatch.setattr('api.app.solar.service.fetch_samples',failed)
    response=client.get('/api/solar')
    assert response.status_code==503
    assert response.json()['samples']==[]
    assert response.json()['summary'] is None

def test_horizon_equality_is_not_visible(monkeypatch):
    async def zero(*args,**kwargs):
        return [{'t_utc':'2026-12-01T00:00:00Z','azimuth_deg':0,'elevation_deg':0},{'t_utc':'2026-12-01T01:00:00Z','azimuth_deg':0,'elevation_deg':0}],{'query_url':'test','retrieved_at':'test'},False
    monkeypatch.setattr('api.app.solar.service.fetch_samples',zero)
    result=asyncio.run(solar_result('site04','2026-12-01T00:00:00Z','2026-12-01T01:00:00Z'))
    assert not any(sample['visible'] for sample in result['samples'])
    assert result['summary']['sun_visible_hours']==0

@pytest.mark.parametrize('route',['solar','earth'])
def test_actual_api_defaults_are_exact_cached_nasa_results(route):
    response=client.get('/api/'+route)
    assert response.status_code==200
    result=response.json()
    assert result['meta']['cache_hit'] is True
    assert result['meta']['source']=='JPL Horizons'
    assert len(result['samples'])==169
    assert result['meta']['observer_altitude_km']>0

def test_unknown_site_and_terrain_unsupported_height():
    assert client.get('/api/solar?site_id=unknown').status_code==422
    assert client.get('/api/solar?horizon_mode=terrain&observer_height_m=3').status_code==422
    assert client.get('/api/sites/unknown/terrain').status_code==404
    malformed=client.get('/api/solar?step_minutes=abc')
    assert malformed.status_code==422
    assert malformed.json()['status']=='unavailable'
    assert malformed.json()['samples']==[]

def test_real_terrain_horizon_and_regional_inventory():
    inventory=client.get('/api/datasets').json()['datasets']
    assert len(inventory)==7
    assert sum(item['status']=='downloaded_verified' for item in inventory)==7
    assert all(len(item['sha256'])==64 for item in inventory)
    for item in inventory:
        if item['id'].endswith(('-slope','-uncertainty')):
            assert item['statistics']['valid_pixels']>0
            assert item['statistics']['min']<=item['point_value']<=item['statistics']['max']
            assert item['alignment'].startswith('exact CRS')
    for sid in ['site01','site04']:
        for height in [1,2,5]:
            response=client.get('/api/horizon',params={'site_id':sid,'observer_height_m':height})
            assert response.status_code==200
            profile=response.json()
            assert len(profile['samples'])==360
            assert profile['quality']=='partial'
            assert all(-90<=sample['elevation_deg']<=90 for sample in profile['samples'])
        result=client.get('/api/solar',params={'site_id':sid,'horizon_mode':'terrain'}).json()
        assert result['status']=='ok'
        assert result['meta']['horizon_quality']=='partial'
        assert any(abs(sample['horizon_deg'])>0 for sample in result['samples'])
        assert all(sample['visible']==(sample['elevation_deg']>sample['horizon_deg']) for sample in result['samples'])
