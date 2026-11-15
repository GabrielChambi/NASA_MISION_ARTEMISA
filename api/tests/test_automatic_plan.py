from fastapi import FastAPI
from fastapi.testclient import TestClient
import copy
from datetime import datetime,timezone,timedelta
import json
import math
from pathlib import Path
import pytest
from api.app import automatic_plan as plan

ROOT=Path(__file__).resolve().parents[2]
Q={'departure_utc':'2026-12-25T12:00:00Z','date_kind':'landing','surface_hours':2,'min_sun_hours':2,'min_earth_hours':2}
TRANSFER={'transfer_hours':107.4,'method':'TWO_BODY_ESTIMATE','assumptions':['Ideal, no launch solution.']}

def fixture():
    start=datetime(2026,12,25,12,tzinfo=timezone.utc)
    def samples(elevation):
        return [{'t_utc':plan.iso(start+timedelta(hours=i)),'azimuth_deg':0,'elevation_deg':elevation if i<2 else -20,'range_km':384400} for i in range(3)]
    def sky(target,elevation):return {'status':'ok','target':target,'meta':{'latitude_deg':-90,'longitude_deg':0,'query_url':'https://ssd.jpl.nasa.gov/api/horizons.api?target='+target},'samples':samples(elevation)}
    cells=[{'id':id,'latitude_deg':-90,'longitude_deg':0,'elevation_m':0,'regional_slope_deg':slope,'max_slope_deg':slope,'x_m':i*50000,'y_m':0,'known':True} for i,(id,slope) in enumerate([('flat',2),('blocked',2),('unknown',2),('steep',15)])]
    polar={'source_sha256':'source','cell_spacing_m':4750,'cells':cells}
    horizons={'version':1,'source_sha256':'source','observer_height_m':2,'radius_m':1737400,'azimuth_step_deg':5,'quantization_deg':.05,'quality':'sampled-regional-partial','profile_encoding':'delta','near_coverage_required_m':2000,'cell_ids':[c['id'] for c in cells],'profiles_int':[[0]*72,[1000]+[0]*71,[0]*72,[0]*72],'ray_coverage_min_per_mille':[1000,1000,90,1000],'valid_to_min_m':[250000,250000,10000,250000]}
    return polar,horizons,{'sun':sky('Sun',5),'earth':sky('Earth',8)}

def test_strict_input_and_boundaries():
    assert plan.validate_plan_request({'departure_utc':Q['departure_utc']})['surface_hours']==72
    for bad in [{'departure_utc':'2026-02-30T12:00:00Z'},{'departure_utc':'2026-12-25T12:00:00-04:00'},{'departure_utc':'2026-12-25T12:00:01Z'},Q|{'surface_hours':True},Q|{'max_slope_deg':math.nan},Q|{'observer_height_m':5}]:
        with pytest.raises(ValueError):plan.validate_plan_request(bad)

def test_transfer_and_departure_vs_landing_dates():
    result=plan.estimate_transfer({'azimuth_deg':0,'elevation_deg':0,'range_km':384400})
    assert result['method']=='TWO_BODY_ESTIMATE'
    assert 100<result['transfer_hours']<140
    mission=plan.timing(plan.validate_plan_request(Q|{'date_kind':'departure'}),TRANSFER)
    assert mission['arrival_utc']=='2026-12-30T00:00:00Z'
    assert mission['departure_utc']==Q['departure_utc']
    assert mission['arrival_rounding_minutes']==pytest.approx(36)
    assert plan.timing(plan.validate_plan_request(Q),TRANSFER)['arrival_utc']==Q['departure_utc']
    with pytest.raises(ValueError):plan.estimate_transfer({'azimuth_deg':0,'elevation_deg':0,'range_km':1})

def test_vector_frame_and_local_north():
    position=plan.body_position({'azimuth_deg':90,'elevation_deg':0,'range_km':1})
    assert position==pytest.approx([0,1000,-1737402],abs=1e-6)
    az,el=plan.angles(plan.body_position({'azimuth_deg':0,'elevation_deg':5,'range_km':149597870}),plan.frame(-80,0),0)
    assert el==pytest.approx(15,abs=.01)
    assert az==pytest.approx(0,abs=1e-6)

def test_delta_and_circular_interpolation():
    assert plan.decode_profile([10]+[1]*71,'delta')==list(range(10,82))
    assert plan.decode_profile(None,'delta') is None
    profile=[20]+[0]*71
    assert plan.horizon_value(profile,0)==1
    assert plan.horizon_value(profile,357.5)==.5
    assert plan.horizon_value(profile,-2.5)==.5

def test_whole_cap_and_unknown_coverage_never_becomes_green():
    polar,h,sky=fixture();result=plan.evaluate_global_plan(Q,polar,h,sky,TRANSFER)
    assert result['counts']=={'green':1,'yellow':0,'red':2,'unknown':1}
    assert result['total_cells']==4
    assert result['best']['id']=='flat'
    assert result['best']['sun_hours']==2
    assert len(result['best']['time_series'])==3
    assert result['best']['time_series'][-1]['sun_elevation_deg']==-20
    assert next(c for c in result['cells'] if c['id']=='blocked')['sun_hours']==0
    assert '20 km' in next(c for c in result['cells'] if c['id']=='unknown')['reason']
    assert next(c for c in result['cells'] if c['id']=='steep')['sun_hours']==2

def test_no_green_preserves_closest_failed_candidate():
    polar,h,sky=fixture();h['profiles_int'][0]=[1000]+[0]*71
    result=plan.evaluate_global_plan(Q,polar,h,sky,TRANSFER)
    assert result['best'] is None
    assert result['alternatives']==[]
    assert result['closest_candidate']['risk']=='red'
    assert result['closest_candidate']['reasons']

def test_bad_query_grid_and_resource_hash_fail_closed():
    polar,h,sky=fixture();sky['sun']['samples'][1]['t_utc']=sky['sun']['samples'][0]['t_utc']
    with pytest.raises(ValueError,match='desalineada'):plan.evaluate_global_plan(Q,polar,h,sky,TRANSFER)
    polar,h,sky=fixture();h['source_sha256']='wrong'
    with pytest.raises(ValueError,match='Horizontes'):plan.evaluate_global_plan(Q,polar,h,sky,TRANSFER)

def client():
    app=FastAPI();app.include_router(plan.router)
    return TestClient(app)

def test_endpoint_rejects_bad_inputs_and_bounds_body(monkeypatch):
    async def never(*args,**kwargs):raise AssertionError('Invalid request reached NASA.')
    monkeypatch.setattr(plan,'get_sky',never)
    c=client()
    assert c.post('/api/automatic-plan',json={'departure_utc':'bad'}).status_code==422
    assert c.post('/api/automatic-plan',content='{}',headers={'content-type':'text/plain'}).status_code==415
    assert c.post('/api/automatic-plan',content=' '*16385,headers={'content-type':'application/json'}).status_code==413

def test_upstream_failure_is_not_a_fabricated_result(monkeypatch):
    async def unavailable(*args,**kwargs):raise plan.HorizonsUnavailable('NASA temporarily unavailable.')
    monkeypatch.setattr(plan,'get_sky',unavailable)
    response=client().post('/api/automatic-plan',json=Q)
    assert response.status_code==503
    assert response.json()=={'status':'unavailable','message':'NASA temporarily unavailable.'}

def test_actual_nasa_christmas_example_runs_from_exact_cache():
    example=json.loads((ROOT/'data/prepared/automatic_example.json').read_text(encoding='utf-8'))
    response=client().post('/api/automatic-plan',json=example['request'])
    assert response.status_code==200
    result=response.json()
    assert result['counts']==example['counts']
    assert result['best']['id']==example['best']['id']
    assert result['best']['sun_hours']==example['best']['sun_hours']
    assert result['best']['earth_hours']==example['best']['earth_hours']
    assert result['mission']['arrival_utc']==example['mission']['arrival_utc']
    assert result['total_cells']==12892
    assert len(result['best']['time_series'])==73
    assert all(s['cache_hit'] and 'QUANTITIES=%274%2C20%27' in s['query_url'] for s in result['meta']['sources'])
    assert len(json.dumps(result).encode())<20000000

def test_angular_sampling_sensitivity_retains_nominal_candidate_as_yellow():
    polar,h,sky=fixture()
    h['profile_encoding']='absolute';h['profiles_int'][0]=[0,160]+[0]*70
    result=plan.evaluate_global_plan(Q,polar,h,sky,TRANSFER)
    cell=next(c for c in result['cells'] if c['id']=='flat')
    assert cell['risk']=='yellow'
    assert cell['nominal_pass'] is True
    assert cell['sensitivity_pass'] is False
    assert cell['sun_hours']==2
    assert cell['sun_hours_sensitivity']=={'lower':0,'upper':2}
    assert cell['arrival_margin_sensitivity']['sun_lower_deg']<0
    assert result['best'] is None
    assert result['closest_candidate']['risk']=='yellow'
    assert 'not physical uncertainty bounds' in result['meta']['sensitivity_method']

def test_neighboring_bin_envelope_and_maximum_slope_do_not_redefine_regional_p95():
    profile=[20,60]+[0]*70
    assert plan.horizon_sensitivity(profile,2.5)=={'nominal':2,'lower':.95,'upper':3}
    assert plan.horizon_sensitivity(profile,357.5)=={'nominal':.5,'lower':-.05,'upper':1}
    assert plan.horizon_sensitivity(None,0) is None
    polar,h,sky=fixture();polar['cells'][0]['max_slope_deg']=40
    result=plan.evaluate_global_plan(Q,polar,h,sky,TRANSFER)
    assert result['best']['risk']=='green'
    assert result['best']['max_slope_deg']==40
    assert 'not a resolved landing footprint' in result['meta']['screening_unit']

def test_inspect_any_cell_has_independent_series_and_no_full_cap_recalculation(monkeypatch):
    polar,h,sky=fixture()
    original=plan.evaluate_cell;calls=[]
    def count(*args):
        calls.append(args[0]['id'])
        return original(*args)
    monkeypatch.setattr(plan,'evaluate_cell',count)
    result=plan.evaluate_plan_cell(Q,polar,h,sky,TRANSFER,'steep')
    assert calls==['steep']
    assert result['cell']['risk']=='red'
    assert result['cell']['sun_hours']==2
    assert len(result['cell']['time_series'])==3
    assert 'cells' not in result
    assert any('Pendiente' in reason for reason in result['cell']['reasons'])
    unknown=plan.evaluate_plan_cell(Q,polar,h,sky,TRANSFER,'unknown')
    assert unknown['cell']['risk']=='unknown'
    assert unknown['cell']['time_series']==[]
    with pytest.raises(ValueError,match='catálogo'):plan.evaluate_plan_cell(Q,polar,h,sky,TRANSFER,'no-cell')
    polar['cells'].append({'id':'fringe','latitude_deg':-79.99,'longitude_deg':0,'x_m':0,'y_m':304000,'elevation_m':None,'known':False})
    fringe=plan.evaluate_plan_cell(Q,polar,h,sky,TRANSFER,'fringe')
    assert fringe['cell']['risk']=='unknown'
    assert fringe['cell']['time_series']==[]

def test_inverse_projection_area_matches_independent_cap_quadrature_and_reserves_unknown_border():
    polar=plan.surface()
    cap=2*math.pi*1737400**2*(1-math.sin(math.radians(80)))/1e6
    actual=sum(plan.stereographic_cell_area(c['x_m'],c['y_m'],4750) for c in polar['cells'])
    assert abs(actual-(cap-.054393))<.01
    p,h,sky=fixture();result=plan.evaluate_global_plan(Q,p,h,sky,TRANSFER)
    assert sum(v['area_km2'] for v in result['coverage']['by_class'].values())==pytest.approx(result['coverage']['cap_area_km2'],abs=.003)
    assert result['coverage']['unrepresented_area_km2']>0
    unknown=next(c for c in result['cells'] if c['risk']=='unknown')
    assert result['coverage']['by_class']['unknown']['area_km2']>unknown['area_km2']
    assert plan.stereographic_cell_area(0,0,4750)>plan.stereographic_cell_area(200000,0,4750)
    assert plan.stereographic_cell_area(700000,0,4750)==0
    assert plan.stereographic_cell_area(0,304000,4750)>0

def test_cell_endpoint_rejects_unknown_cell_before_nasa(monkeypatch):
    async def never(*args,**kwargs):raise AssertionError('Unknown cell reached NASA.')
    monkeypatch.setattr(plan,'get_sky',never)
    result=client().post('/api/automatic-plan/cell',json=Q|{'cell_id':'no-cell'})
    assert result.status_code==404

def test_cell_endpoint_returns_real_prepared_non_suggestion():
    example=json.loads((ROOT/'data/prepared/automatic_example.json').read_text(encoding='utf-8'))
    response=client().post('/api/automatic-plan/cell',json=example['request']|{'cell_id':'polar:64:64'})
    assert response.status_code==200
    result=response.json()
    assert result['cell']['id']=='polar:64:64'
    assert len(result['cell']['time_series'])==73
    assert 'cells' not in result
    assert all(s['cache_hit'] for s in result['meta']['sources'])
