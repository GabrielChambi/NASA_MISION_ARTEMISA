"""Bounded engineering studies based on recomputed NASA operations, never client-supplied predictions."""
import asyncio,json,math,threading
import numpy as np
from datetime import datetime,timezone
from fastapi import APIRouter,Request
from fastapi.responses import JSONResponse
from spiceypy.utils.exceptions import SpiceyError
from . import operations
from .engineering_models import coupled_scenario,thermal_config,rf_config,BATTERY_CURVE,battery_factors
from .spice_service import compare_samples,SpiceUnavailable
from .rover_route import route
from .hardware_profile import validate_hardware
from .dsn_geometry import dsn_scenario
from .native_terrain import horizon_profile
from .telemetry import validate_telemetry,compare_telemetry
from .trajectory_design import design_roundtrip
from .solar.horizons import HorizonsUnavailable
router=APIRouter(prefix='/api/engineering')
LOCK=asyncio.Semaphore(1)
def settings(raw):
 if raw is None:raw={}
 if not isinstance(raw,dict) or set(raw)-{'hardware','thermal','rf','battery_curve','rover','goal_index','start_index','telemetry','assimilate_initial_state','sensitivity'}:raise ValueError('Invalid engineering settings.')
 thermal=thermal_config(raw.get('thermal'));rf=rf_config(raw.get('rf'));curve=raw.get('battery_curve',BATTERY_CURVE)
 battery_factors(thermal['initial_k'],curve)
 for key in ('assimilate_initial_state','sensitivity'):
  if key in raw and not isinstance(raw[key],bool):raise ValueError('Invalid engineering option.')
 return raw|{'thermal':thermal,'rf':rf,'battery_curve':curve,'hardware':validate_hardware(raw.get('hardware'))}
def calculate(payload,report,q,cancel=None):
 case=report['affected'];rows=case['samples'];cell=case['cell'];initial_energy=dict(payload['energy']);thermal=dict(q['thermal'])
 record=validate_telemetry(q.get('telemetry'),case['mission'])
 if record and record['kind']=='recorded' and q['hardware'] is None:raise ValueError('Recorded telemetry requires an identified hardware profile.')
 if record and q['hardware'] and record['asset_id']!=q['hardware']['asset_id']:raise ValueError('Telemetry asset_id does not match the hardware profile.')
 assimilation={'applied':False}
 if q.get('assimilate_initial_state'):
  if not record or abs(record['samples'][0]['hour'])>1e-8:raise ValueError('Initial-state assimilation requires a telemetry sample exactly at arrival.')
  first=record['samples'][0];assimilation={'applied':True,'source_sha256':record['sha256'],'asset_id':record['asset_id'],'previous_initial_soc':initial_energy['initial_soc'],'previous_initial_k':thermal['initial_k'],'initial_soc':first['soc'],'initial_k':first['temperature_k'],'kind':record['kind'],'calibration':False}
  initial_energy['initial_soc']=first['soc'];thermal['initial_k']=first['temperature_k']
 hp=horizon_profile(cell['latitude_deg'],cell['longitude_deg'],case['request']['solar_panel_height'],case['request']['antenna_height'])
 stations=dsn_scenario(rows,cell,hp,q['rf'])
 nominal=coupled_scenario(rows,initial_energy,payload['fault'],payload['policy'],thermal,q['rf'],q['battery_curve'],stations,cancel)
 try:spice=compare_samples(rows,cell['latitude_deg'],cell['longitude_deg'],cell['elevation_m'],case['request']['solar_panel_height'],case['request']['antenna_height'])
 except (SpiceUnavailable,SpiceyError) as exc:spice={'status':'unavailable','message':str(exc),'comparisons':[]}
 rover=route(report['local_study'],q.get('rover'),q.get('goal_index'),q.get('start_index'))
 sensitivity={'status':'not_requested','probability_of_success':None,'cases':[]}
 if q.get('sensitivity'):
  variants=[('solar_minus_10_percent',initial_energy|{'solar_derate':initial_energy['solar_derate']*.9},thermal,q['rf']),('cold_initial_minus_5_k',initial_energy,thermal|{'initial_k':max(20.,thermal['initial_k']-5.)},q['rf']),('radio_losses_plus_3_db',initial_energy,thermal,q['rf']|{'loss_db':min(100.,q['rf']['loss_db']+3)}),('combined_declared_perturbations',initial_energy|{'solar_derate':initial_energy['solar_derate']*.9},thermal|{'initial_k':max(20.,thermal['initial_k']-5.)},q['rf']|{'loss_db':min(100.,q['rf']['loss_db']+3)})]
  cases=[]
  for name,energy,t,r in variants:
   out=coupled_scenario(rows,energy,payload['fault'],payload['policy'],t,r,q['battery_curve'],dsn_scenario(rows,cell,hp,r),cancel)
   cases.append({'id':name,'status':out['status'],'minimum_usable_soc':out['budget']['summary']['minimum_usable_soc'] if out.get('budget') else None,'minimum_temperature_k':out['thermal'].get('summary',{}).get('minimum_k'),'link_hours':out['rf'].get('summary',{}).get('link_model_hours'),'budget_pass':out.get('budget',{}).get('feasible',False) if out.get('budget') else False})
  sensitivity={'status':'evaluated','cases':cases,'probability_of_success':None,'scope':'Three one-at-a-time declared design perturbations plus their joint scenario. Not exhaustive joint uncertainty bounds or a statistical success probability.'}
 telemetry=compare_telemetry(record,nominal)
 budget=nominal.get('budget');temp=nominal['thermal'].get('summary',{})
 gates={'source_geometry':spice['status']=='pass','planning_constraints':case['planning_constraints_met'],'all_local_dispersion_centers':report['local_study']['all_dispersion_centers_meet_nominal_model'],
 'coupled_budget':nominal['status']=='ok' and budget is not None and budget['feasible'],'declared_temperature_limits':temp.get('outside_declared_battery_limits_hours',math.inf)<1e-9,
 'hardware_identified':q['hardware'] is not None,'hardware_calibrated':False,'independent_review':False}
 return {'status':'ok','model_version':'engineering-1','created_utc':datetime.now(timezone.utc).isoformat().replace('+00:00','Z'),'physical_twin_status':'uncalibrated_design_model','operationally_validated':False,
 'cell':cell,'mission':case['mission'],'engineering':nominal,'dsn_geometry':stations,'spice_validation':spice,'rover_route':rover,'telemetry':telemetry,'initial_state_assimilation':assimilation,'sensitivity':sensitivity,'acceptance':gates,
 'configuration':q,'input':{'mission':payload['mission'],'energy':initial_energy,'fault':payload['fault'],'landing':payload['landing'],'policy':payload['policy']},'sources':case['sources']+report['local_study']['sources'],
 'limitations':['No real spacecraft has been authenticated or physically connected. Recorded telemetry is user supplied and its provenance is retained; hardware configuration and curve calibration require external evidence.','A passing numerical study does not certify landing safety, hardware survival, a DSN booking or a launch opportunity.','Regional screening, local terrain, energy, thermal, RF and trajectory studies have different scopes; an unresolved criterion cannot become a pass.']}
async def run_cancellable(request,function,*args):
 cancelled=threading.Event()
 task=asyncio.create_task(asyncio.to_thread(function,*args,cancel=cancelled))
 try:
  while not task.done():
   if await request.is_disconnected():cancelled.set()
   await asyncio.wait({task},timeout=.25)
  return await task
 finally:cancelled.set()
@router.post('/analyze')
@router.post('/trajectory')
async def endpoint(request:Request):
 english=request.headers.get('x-lunar-language')=='en'
 if 'application/json' not in request.headers.get('content-type',''):return JSONResponse(status_code=415,content={'status':'unavailable','message':'Use application/json.'})
 raw=b''
 async for part in request.stream():
  raw+=part
  if len(raw)>512000:return JSONResponse(status_code=413,content={'status':'unavailable','message':'Engineering request exceeds 512 kB.'})
 try:
  value=json.loads(raw);payload=operations.validate_request(value);q=settings(value.get('engineering'))
  if LOCK.locked():return JSONResponse(status_code=429,content={'status':'unavailable','message':'Another engineering study is running. Try again after it finishes.'},headers={'Retry-After':'10'})
  async with LOCK:
   if request.url.path.endswith('/trajectory'):
    # Resolve the same mission timing and actual local target as the operational study.
    affected=operations.shifted_request(payload['mission'],payload['fault']['delay_hours'])
    env=await operations.environment(affected)
    result=await run_cancellable(request,design_roundtrip,env['mission'],payload['cell']['latitude_deg'],payload['cell']['longitude_deg'])
   else:
    report=await operations.analyze(payload)
    result=await run_cancellable(request,calculate,payload,report,q)
  return JSONResponse(content=result,headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})
 except InterruptedError:return JSONResponse(status_code=499,content={'status':'cancelled','message':'Study cancelled.'})
 except (ValueError,TypeError,KeyError,ArithmeticError,RecursionError,np.linalg.LinAlgError) as exc:return JSONResponse(status_code=422,content={'status':'unavailable','message':str(exc)})
 except (FileNotFoundError,HorizonsUnavailable,SpiceUnavailable,SpiceyError) as exc:
  return JSONResponse(status_code=503,content={'status':'unavailable','message':('Original NASA data or NAIF kernels are unavailable for this study.' if english else 'Faltan datos originales NASA o kernels NAIF para este estudio.'),'code':type(exc).__name__})
