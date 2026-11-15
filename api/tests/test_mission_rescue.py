
"""Decision-search tests use synthetic sky only when explicitly named fixtures."""
import asyncio
import copy
import json
from pathlib import Path
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from api.app import mission_rescue as rescue

BASE=rescue.milliseconds('2026-12-01T12:30:00Z')
Q={'departure_utc':'2026-12-01T12:30:00Z','date_kind':'landing','surface_hours':2,'min_sun_hours':2,'min_earth_hours':2,'search_days':2}
ROOT=Path(__file__).resolve().parents[2]

def resources():
    cells=[dict(id=name,row=0,col=i,latitude_deg=-90,longitude_deg=0,x_m=i*50000,y_m=0,elevation_m=0,regional_slope_deg=slope,max_slope_deg=slope,known=True) for i,(name,slope) in enumerate([('flat',2),('steep',15),('unknown',2)])]
    polar={'source_sha256':'source','cell_spacing_m':4750,'cells':cells}
    horizons=dict(version=1,observer_height_m=2,azimuth_step_deg=5,radius_m=1737400,source_sha256='source',quantization_deg=.05,quality='fixture-angular',profile_encoding='absolute',
        cell_ids=[c['id'] for c in cells],profiles_int=[[0]*72 for _ in cells],valid_to_min_m=[250000,250000,1000],ray_coverage_min_per_mille=[1000,1000,100])
    return polar,horizons

def batch(target,start,end,fn=lambda h:5):
    return {'status':'ok','target':target,'meta':{'latitude_deg':-90,'longitude_deg':0,'source':'JPL Horizons','query_url':'https://ssd.jpl.nasa.gov/api/horizons.api?fixture='+target,'start_utc':rescue.stamp(start),'end_utc':rescue.stamp(end)},
      'samples':[{'t_utc':rescue.stamp(start+i*rescue.H),'azimuth_deg':0,'elevation_deg':fn((start-BASE)/rescue.H+i),'range_km':149597870.7 if target=='Sun' else 384400} for i in range((end-start)//rescue.H+1)]}

def batches(first=36):
    return {'anchor':batch('Earth',BASE,BASE+49*rescue.H),'sun':batch('Sun',BASE,BASE+50*rescue.H),'earth':batch('Earth',BASE,BASE+50*rescue.H,lambda h:5 if h>=first else -5)}

def client():
    app=FastAPI();app.include_router(rescue.router);return TestClient(app)

def test_input_preserves_explicit_constraints_and_bounds_search():
    assert rescue.validate_rescue_request(Q)[1]==2
    for bad in [Q|{'search_days':0},Q|{'search_days':None},Q|{'search_days':True},Q|{'search_days':15},Q|{'min_sun_hours':3},Q|{'departure_utc':'2026-02-30T12:00:00Z'}]:
        with pytest.raises(ValueError):rescue.validate_rescue_request(bad)

def test_only_measured_terrain_and_horizons_form_pool_without_mutating_catalog():
    polar,h=resources();before=copy.deepcopy((polar,h))
    p,subset,diagnosis=rescue.select_resources(polar,h,rescue.validate_rescue_request(Q)[0])
    assert diagnosis['terrain_eligible_cells']==2 and diagnosis['horizon_eligible_cells']==1
    assert [c['id'] for c in p['cells']]==subset['cell_ids']==['flat']
    assert (polar,h)==before
    h['source_sha256']='wrong'
    with pytest.raises(ValueError):rescue.select_resources(polar,h,rescue.validate_rescue_request(Q)[0])

def test_refines_first_coarse_pass_with_exact_minute_phase_and_unchanged_requirements():
    polar,h=resources();result=rescue.evaluate_rescue(Q,polar,h,batches())
    assert result['status']=='found'
    first=result['proposals'][0]
    assert first['delta_hours']==36
    assert first['proposed_request']['departure_utc']==first['mission']['arrival_utc']=='2026-12-03T00:30:00Z'
    assert first['best']['risk']=='green' and len(first['best']['time_series'])==3
    assert result['search']['tested_scenarios']==26
    assert result['diagnosis']['original_green']==0
    assert next(b for b in result['diagnosis']['blockers'] if b['code']=='earth_arrival')['count']==1
    assert first['counts_scope']=='terrain-and-horizon-eligible-centers'
    for proposal in result['proposals']:
        assert proposal['criteria_preserved']
        for key in ['date_kind','surface_hours','max_slope_deg','min_sun_hours','min_earth_hours','observer_height_m']:
            assert proposal['proposed_request'][key]==result['original_request'][key]

def test_departure_minutes_are_preserved_but_arrival_visibility_uses_its_own_whole_hour_grid():
    polar,h=resources();calls=[];first_arrival=None
    async def get(target,start,end):
        nonlocal first_arrival
        a,b=rescue.milliseconds(start),rescue.milliseconds(end);calls.append((target,start,end))
        if len(calls)==1:return batch('Earth',a,b)
        if target=='Sun':
            first_arrival=a;return batch('Sun',a,b)
        return batch('Earth',a,b,lambda hours:5 if BASE+hours*rescue.H>=first_arrival+36*rescue.H else -5)
    result=asyncio.run(rescue.search_mission_rescue(Q|{'date_kind':'departure'},polar,h,get))
    assert result['status']=='found'
    first=result['proposals'][0]
    assert first['proposed_request']['departure_utc'][14:16]=='30'
    assert first['mission']['arrival_utc'][14:16]=='00'
    assert calls[0][1][14:16]=='30' and calls[1][1][14:16]=='00'
    assert all(s['t_utc'][14:16]=='00' for s in first['best']['time_series'])

def test_failure_within_window_does_not_force_green():
    polar,h=resources();result=rescue.evaluate_rescue(Q,polar,h,batches(1000))
    assert result['status']=='none' and result['proposals']==[]
    assert result['search']['tested_offsets_hours']==[0,24,48]
    assert 'first_coarse_passing_offset_hours' not in result['search']

def test_terrain_and_missing_horizons_block_before_nasa():
    polar,h=resources();calls=[]
    async def never(*args):calls.append(args);raise AssertionError('No NASA query expected')
    blocked=asyncio.run(rescue.search_mission_rescue(Q|{'max_slope_deg':0},polar,h,never))
    assert blocked['status']=='blocked' and blocked['diagnosis']['code']=='terrain_constraints'
    h['valid_to_min_m'][0]=1000
    unknown=asyncio.run(rescue.search_mission_rescue(Q,polar,h,never))
    assert unknown['diagnosis']['code']=='insufficient_horizon_data' and not calls

def test_unknown_dem_is_not_an_impossible_slope_claim():
    polar,h=resources()
    for c in polar['cells']:c['known']=False
    async def never(*args):raise AssertionError('Unknown terrain cannot query NASA')
    result=asyncio.run(rescue.search_mission_rescue(Q,polar,h,never))
    assert result['status']=='blocked' and result['diagnosis']['code']=='insufficient_terrain_data'
    assert result['diagnosis']['unknown_terrain_cells']==3

@pytest.mark.parametrize('mutation',['missing','observer','range'])
def test_missing_or_misaligned_nasa_data_never_creates_alternative(mutation):
    polar,h=resources();sky=batches()
    if mutation=='missing':sky['earth']['samples'].pop(4)
    if mutation=='observer':sky['sun']['meta']['latitude_deg']=-85
    if mutation=='range':sky['anchor']['samples'][2]['range_km']=None
    with pytest.raises(ValueError):rescue.evaluate_rescue(Q,polar,h,sky)
    with pytest.raises(ValueError):rescue.slice_batch(batches()['sun'],BASE+rescue.H/2,BASE+2*rescue.H)

def test_three_batched_queries_are_used_instead_of_one_query_per_scenario():
    polar,h=resources();sky=batches();calls=[]
    async def get(target,start,end):
        calls.append((target,start,end))
        return sky['anchor'] if len(calls)==1 else sky['sun'] if target=='Sun' else sky['earth']
    result=asyncio.run(rescue.search_mission_rescue(Q,polar,h,get))
    assert result['status']=='found'
    assert [c[0] for c in calls]==['Earth','Sun','Earth']
    assert all(len(p['sources'])==3 for p in result['proposals'])

def test_upstream_failure_has_no_fabricated_fallback():
    polar,h=resources();calls=[]
    async def offline(*args):calls.append(args);raise rescue.plan.HorizonsUnavailable('NASA offline')
    with pytest.raises(rescue.plan.HorizonsUnavailable):asyncio.run(rescue.search_mission_rescue(Q,polar,h,offline))
    assert len(calls)==1

def test_http_limits_and_invalid_parameters():
    api=client()
    assert api.get('/api/mission-rescue').status_code==405
    assert api.post('/api/mission-rescue',content='{}').status_code==415
    assert api.post('/api/mission-rescue',json={'departure_utc':'bad'}).status_code==422
    assert api.post('/api/mission-rescue',content='x'*17000,headers={'content-type':'application/json'}).status_code==413

def test_endpoint_nasa_failure_returns_no_solution_instead_of_fabricated_alternatives(monkeypatch):
    async def offline(*args,**kwargs):raise rescue.plan.HorizonsUnavailable('NASA offline')
    monkeypatch.setattr(rescue.plan,'get_sky',offline)
    response=client().post('/api/mission-rescue',json={'departure_utc':'2026-12-01T14:00:00Z','surface_hours':72})
    assert response.status_code==503
    assert response.json()['status']=='unavailable'
    assert response.json()['proposals']==[]

def test_original_nasa_case_and_applied_first_proposal_are_reproducible_offline(monkeypatch):
    async def offline(*args,**kwargs):raise AssertionError('Offline validation must use prepared original NASA records.')
    monkeypatch.setattr('httpx.AsyncClient.get',offline)
    example=json.loads((ROOT/'data/prepared/rescue_example.json').read_text(encoding='utf-8'))
    response=client().post('/api/mission-rescue',json=example['request'])
    assert response.status_code==200
    result=response.json()
    assert result['status']=='found'
    first=result['proposals'][0]
    assert first['delta_hours']==146 and first['best']['id']=='polar:32:95'
    assert result['diagnosis']['original_green']==0
    assert result['diagnosis']['horizon_eligible_cells']==1832
    assert result['search']['tested_offsets_hours']==example['search']['tested_offsets_hours']
    assert all(s['cache_hit'] for s in result['meta']['sources'])
    app=FastAPI();app.include_router(rescue.plan.router)
    applied=TestClient(app).post('/api/automatic-plan',json=first['proposed_request'])
    assert applied.status_code==200
    full=applied.json()
    assert full['best']['id']==first['best']['id'] and full['counts']['green']==1
    assert full['mission']==first['mission']

def test_rescue_preserves_vehicle_profile_and_never_substitutes_two_metres_for_tall_vehicle():
    polar,h=resources()
    profile={'lander_name':'Hypothetical reference vehicle','solar_panel_height':2,'antenna_height':2,'center_of_gravity_tolerance':8}
    result=rescue.evaluate_rescue(Q|{'max_slope_deg':10,'vehicle_profile':profile},polar,h,batches())
    assert result['status']=='found' and result['original_request']['vehicle_profile']==profile
    assert result['original_request']['max_slope_deg']==10 and result['original_request']['effective_max_slope_deg']==8
    assert all(p['proposed_request']['vehicle_profile']==profile and p['proposed_request']['max_slope_deg']==10 for p in result['proposals'])
    calls=[]
    async def never(*args):calls.append(args);raise AssertionError('Unsupported heights must not query NASA')
    tall=profile|{'solar_panel_height':50,'antenna_height':38}
    blocked=asyncio.run(rescue.search_mission_rescue(Q|{'vehicle_profile':tall},polar,h,never))
    assert blocked['status']=='blocked' and blocked['diagnosis']['code']=='unsupported_observer_height'
    assert not blocked['diagnosis']['height_support']['supported'] and blocked['diagnosis']['height_support']['profile_height_m']==2
    assert blocked['original_request']['vehicle_profile']==tall and blocked['proposals']==[] and not calls

def test_rescue_endpoint_blocks_unprepared_heights_without_nasa(monkeypatch):
    async def never(*args,**kwargs):raise AssertionError('Unsupported height reached NASA')
    monkeypatch.setattr(rescue.plan,'get_sky',never)
    response=client().post('/api/mission-rescue',json={'departure_utc':'2026-12-01T14:00:00Z','solar_panel_height':50,'antenna_height':38})
    assert response.status_code==200
    data=response.json()
    assert data['status']=='blocked' and data['diagnosis']['code']=='unsupported_observer_height'
    assert data['original_request']['vehicle_profile']['solar_panel_height']==50
    assert data['proposals']==[]
