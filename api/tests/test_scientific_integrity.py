"""Boundary regressions: data outages cannot manufacture a successful physical scenario."""
import asyncio,json
from datetime import datetime
from pathlib import Path
import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from api.app import operations
from api.app.solar import horizons
ROOT=Path(__file__).resolve().parents[2]

@pytest.mark.parametrize('route,function',[('analyze','analyze'),('replan','replan')])
@pytest.mark.parametrize('failure',[FileNotFoundError('missing NASA raster'),horizons.HorizonsUnavailable('NASA unavailable')])
@pytest.mark.parametrize('language',['es','en'])
def test_upstream_data_failures_never_become_successful_demonstrations(monkeypatch,route,function,failure,language):
 example=json.loads((ROOT/'data/prepared/operations_example.json').read_text(encoding='utf-8'))
 async def unavailable(*args,**kwargs):raise failure
 monkeypatch.setattr(operations,function,unavailable)
 app=FastAPI();app.include_router(operations.router)
 response=TestClient(app).post('/api/operations/'+route,json=example['request'],headers={'X-Lunar-Language':language})
 assert response.status_code==503
 body=response.json()
 assert body['status']=='unavailable' and isinstance(body['message'],str)
 assert body['code'] in ('terrain_data_unavailable','ephemeris_unavailable')
 assert body.get('proposals',[])==[] and not body.get('local_study') and not body.get('affected')
 assert response.headers['cache-control']=='no-store'

def test_successful_nasa_response_survives_unwritable_optional_cache(monkeypatch,tmp_path):
 record=None
 for file in sorted((ROOT/'data/prepared/ephemeris').glob('*.json')):
  candidate=json.loads(file.read_text(encoding='utf-8'))
  if candidate['params']['COMMAND']=="'10'" and candidate['params']['STEP_SIZE']=="'60 m'":
   record=candidate;break
 assert record is not None
 params=record['params'];start=datetime.strptime(params['START_TIME'].strip("'"),'%Y-%m-%d %H:%M:%S').replace(tzinfo=horizons.timezone.utc);end=datetime.strptime(params['STOP_TIME'].strip("'"),'%Y-%m-%d %H:%M:%S').replace(tzinfo=horizons.timezone.utc)
 monkeypatch.setattr(horizons,'DATA',tmp_path)
 monkeypatch.setattr(horizons,'query_parameters',lambda *args:params)
 class Client:
  def __init__(self,*args,**kwargs):pass
  async def __aenter__(self):return self
  async def __aexit__(self,*args):pass
  async def get(self,*args,**kwargs):return httpx.Response(200,json=record['response'],request=httpx.Request('GET',horizons.BASE))
 def denied(*args,**kwargs):raise PermissionError('Read-only optional cache')
 monkeypatch.setattr(horizons.httpx,'AsyncClient',Client)
 monkeypatch.setattr(horizons.tempfile,'mkstemp',denied)
 include_range='20' in params['QUANTITIES']
 expected=horizons.parse_result(record['response']['result'],start,end,60,10,include_range)
 rows,source,cached=asyncio.run(horizons.fetch_samples({},start,end,60,2,10,include_range))
 assert rows==expected and source['response']==record['response'] and cached is False

@pytest.mark.parametrize('target',['sun','earth'])
def test_missing_operational_angles_never_generate_a_feasible_budget(target):
 from api.app.energy_model import simulate_energy,DEFAULT_ENERGY
 begin='2026-12-25T00:00:00Z'
 row={'t_utc':begin,'sun_azimuth_deg':90.,'sun_elevation_deg':30.,'sun_horizon_deg':0.,'sun_range_km':149597870.7,'earth_azimuth_deg':270.,'earth_elevation_deg':20.,'earth_horizon_deg':0.,'earth_range_km':384400.}
 row[target+'_horizon_deg']=None
 end={**row,'t_utc':'2026-12-25T01:00:00Z'}
 value=simulate_energy([row,end],DEFAULT_ENERGY|{'science_duration_hours':0.})
 assert value['status']=='unknown' and value['feasible'] is False
 assert value['summary']['minimum_soc'] is None and value['summary']['final_soc'] is None

@pytest.mark.parametrize('seed',range(12))
def test_energy_ledger_conserves_energy_and_data_across_generated_scenarios(seed):
 import math,random
 from datetime import timedelta
 from api.app.energy_model import simulate_energy,DEFAULT_ENERGY
 rng=random.Random(seed);start=datetime(2026,12,25,tzinfo=horizons.timezone.utc);rows=[]
 for i in range(49):
  visible=(i+seed)%17<9
  rows.append({'t_utc':horizons.iso(start+timedelta(minutes=15*i)),'sun_azimuth_deg':90.,'sun_elevation_deg':30.,'sun_horizon_deg':0. if visible else 90.,'sun_range_km':149597870.7*(.98+.04*rng.random()),'earth_azimuth_deg':270.,'earth_elevation_deg':20.,'earth_horizon_deg':0. if i%13<7 else 90.,'earth_range_km':384400.})
 config=DEFAULT_ENERGY|{'battery_capacity_wh':rng.uniform(10,1200),'initial_soc':rng.random(),'reserve_soc':.2,'essential_load_w':rng.uniform(5,100),'solar_area_m2':rng.uniform(.1,2),'science_duration_hours':2.,'science_data_mbps':rng.uniform(.01,.1),'storage_gb':rng.uniform(.01,.2)}
 value=simulate_energy(rows,config,{'solar_loss_fraction':.4,'solar_fault_start_hour':3.125,'earth_outage_start_hour':1.125,'earth_outage_hours':2.5})
 summary=value['summary']
 assert value['status']=='ok'
 assert abs(summary['energy_balance_residual_wh'])<1e-7
 assert summary['data_generated_gb']==pytest.approx(summary['data_sent_gb']+summary['buffer_final_gb']+summary['data_lost_gb'],abs=1e-10)
 assert 0<=summary['minimum_soc']<=1 and 0<=summary['final_soc']<=1
 assert all(0<=row['soc']<=1 and row['buffer_gb']<=config['storage_gb']+1e-10 for row in value['states'])
 assert all(math.isfinite(x) for x in summary.values() if isinstance(x,(int,float)))
 if value['feasible']:
  assert summary['minimum_soc']+1e-6>=config['reserve_soc']
  assert summary['essential_unserved_wh']<1e-6 and summary['science_completed_hours']>=2-1e-8
  assert summary['data_lost_gb']<1e-9 and summary['buffer_final_gb']<1e-8
