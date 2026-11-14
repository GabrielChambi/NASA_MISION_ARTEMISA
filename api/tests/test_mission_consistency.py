"""Regression checks against the common stored NASA records, without network."""
import json
from pathlib import Path
from urllib.parse import parse_qs,urlparse
import pytest
from fastapi.testclient import TestClient
from api.app.main import app
from api.app.core.sites import get_site
from api.app.solar.horizons import parse_result,HorizonsUnavailable

client=TestClient(app)

@pytest.mark.parametrize('sid',['site01','site04'])
def test_post_earth_matches_canonical_nasa_and_map_position(sid):
    q=dict(site_id=sid,start_utc='2026-12-14T00:00:00Z',end_utc='2026-12-17T00:00:00Z',step_minutes=60,horizon_mode='terrain',observer_height_m=2)
    canonical=client.get('/api/earth',params={**q,'canonical':True,'include_range':True})
    compatible=client.post('/api/earth',json=q)
    assert canonical.status_code==compatible.status_code==200
    a,b=canonical.json(),compatible.json()
    site=get_site(sid)
    assert b['site']['lat_deg']==site['latitude_deg']
    assert b['site']['lon_east_deg']==site['longitude_deg']%360
    assert b['site']['elevation_m']==site['elevation_m']
    assert len(b['samples'])==len(a['samples'])-1==72
    for before,after in zip(a['samples'],b['samples']):
        assert before['t_utc']==after['t_utc']
        assert before['azimuth_deg']==after['azimuth_deg']
        assert before['elevation_deg']==after['elevation_deg']
        assert before['range_km']==after['range_km']
        assert before['horizon_deg']==after['local_horizon_deg']
        assert before['visible']==after['earth_visible']
    assert b['metrics']['earth_visible_hours']==a['summary']['earth_visible_hours']
    coords=parse_qs(urlparse(b['provenance']['query_url']).query)['SITE_COORD'][0].strip("'").split(',')
    assert float(coords[0])==site['longitude_deg']
    assert float(coords[1])==site['latitude_deg']
    assert abs(float(coords[2])*1000-(site['elevation_m']+2))<1e-6
    assert b['terrain_mesh_3d']['center_elevation_m']==site['elevation_m']
    assert b['quality']=='degraded'
    assert b['provenance']['effective_horizon_mode']=='terrain'

def test_unsupported_terrain_height_cannot_fall_back_to_flat_or_legacy_seed():
    result=client.post('/api/earth',json={'observer_height_m':3,'horizon_mode':'terrain'})
    assert result.status_code==422
    assert result.json()['status']=='unavailable'

def test_compare_and_landing_planner_have_same_sun_and_earth_windows():
    q=dict(horizon_mode='terrain',minimum_solar_hours=12,minimum_earth_visible_hours=12)
    result=client.post('/api/compare',json=q)
    assert result.status_code==200
    rows=result.json()['sites']
    assert [(s['solar_visible_hours'],s['earth_visible_hours'],s['overlap_solar_earth_hours']) for s in rows]==[(72,29,29),(72,0,0)]
    assert result.json()['consolidated_quality']=='degraded'

def test_measured_range_cannot_be_replaced_by_a_constant():
    from datetime import datetime,timezone
    start=datetime(2026,12,14,tzinfo=timezone.utc)
    end=datetime(2026,12,17,tzinfo=timezone.utc)
    folder=Path(__file__).resolve().parents[2]/'data/prepared/ephemeris'
    record=next(json.loads(p.read_text()) for p in folder.glob('*.json') if json.loads(p.read_text())['params']['COMMAND']=="'399'" and json.loads(p.read_text())['params']['QUANTITIES']=="'4'" )
    text=record['response']['result']
    with pytest.raises(HorizonsUnavailable):
        parse_result(text,start,end,60,399,include_range=True)
