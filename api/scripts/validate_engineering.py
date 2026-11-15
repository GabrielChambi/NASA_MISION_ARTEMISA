"""Reproducible engineering cases from original NASA rasters and stored JPL records."""
import asyncio,json,sys,time,hashlib
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from api.app import operations
from api.app.engineering import calculate,settings
from api.app.trajectory_design import design_roundtrip,propagate,ephemeris_interpolators,ephemeris_time
import numpy as np
async def main():
 source=json.loads((ROOT/'data/prepared/operations_example.json').read_text(encoding='utf-8'))['request'];cases=[]
 for name,energy,engineering in [
  ('reference_design_insufficient_thermal_energy',{},{}),
  ('larger_declared_battery',{'battery_capacity_wh':100000.}, {'sensitivity':True}),
  ('weak_declared_radio',{'battery_capacity_wh':100000.},{'rf':{'loss_db':90.}})]:
  payload=operations.validate_request(source|{'energy':energy});report=await operations.analyze(payload)
  start=time.monotonic();result=calculate(payload,report,settings(engineering));model=result['engineering'];budget=model.get('budget')
  if budget:assert abs(budget['summary']['energy_balance_residual_wh'])<1e-6
  assert not result['operationally_validated'] and not result['acceptance']['hardware_calibrated']
  cases.append({'id':name,'request':source|{'energy':energy,'engineering':engineering},'status':model['status'],'reason':model.get('reason'),'thermal':model['thermal'].get('summary'),'budget':budget['summary'] if budget else None,'budget_pass':bool(budget and budget['feasible']),'dsn_station_hours':result['dsn_geometry'].get('station_model_hours'),'spice_maximum_angular_error_deg':result['spice_validation'].get('maximum_angular_separation_deg'),'sensitivity':result['sensitivity'],'sources':result['sources'],'seconds':time.monotonic()-start})
  print(json.dumps({'case':name,'status':model['status'],'budget_pass':bool(budget and budget['feasible']),'seconds':cases[-1]['seconds']}),flush=True)
 assert cases[0]['status']=='unknown'
 assert cases[1]['status']=='ok' and cases[1]['budget_pass']
 assert cases[2]['status']=='ok' and not cases[2]['budget_pass'] and cases[2]['budget']['buffer_final_gb']>0
 from api.app.native_terrain import native_footprint
 from api.app.rover_route import route
 catalog=json.loads((ROOT/'data/catalog/sites.json').read_text(encoding='utf-8'))['sites'][0]
 settings_local=operations.validate_landing();local=native_footprint(catalog['latitude_deg'],catalog['longitude_deg'],settings_local);point=local['recommended_local_center']
 assert point is not None
 refined=native_footprint(point['latitude_deg'],point['longitude_deg'],settings_local);rover=route(refined)
 assert rover['status']=='found' and rover['points'][0]['index']==rover['points'][-1]['index']
 payload=operations.validate_request(source);report=await operations.analyze(payload)
 start=time.monotonic();trajectory=design_roundtrip(report['affected']['mission'],report['affected']['cell']['latitude_deg'],report['affected']['cell']['longitude_deg'])
 checks=[]
 for name in ('outbound','return'):
  leg=trajectory[name];duration=leg['flight_hours']*3600;et=ephemeris_time(leg['start_utc']);moon,sun=ephemeris_interpolators(et,duration)
  tighter=propagate(np.array(leg['initial_position_km']),np.array(leg['initial_velocity_km_s']),duration,moon,sun,1e-12,detect_collision=True)
  difference=float(np.linalg.norm(tighter.y[:3,-1]-np.array(leg['points'][-1]['position_km'])))
  checks.append({k:leg[k] for k in ('status','start_utc','end_utc','terminal_error_km','departure_impulse_km_s','lunar_capture_impulse_km_s','collision_detected','minimum_sampled_earth_radius_km','minimum_sampled_moon_radius_km')}|{'tight_tolerance_endpoint_difference_km':difference})
  assert leg['status']=='closed' and leg['terminal_error_km']<1. and not leg['collision_detected'] and difference<.01
 result={'status':'pass','created_utc':datetime.now(timezone.utc).isoformat(),'model_version':'engineering-1','cases':cases,'native_rover':{'center':point,'study_settings':settings_local,'source_resolution_m':refined['source_resolution_m'],'sources':refined['sources'],'result':rover},'implementation_sha256':{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in ['api/app/engineering_models.py','api/app/energy_model.py','api/app/trajectory_design.py','api/app/rover_route.py','api/app/dsn_geometry.py','api/app/native_terrain.py']},'trajectory':{'status':trajectory['status'],'checks':checks,'seconds':time.monotonic()-start,'model':trajectory['model'],'limitations':trajectory['limitations']},'scope':'Enumerated deterministic design scenarios and numerical closure checks. No authenticated hardware telemetry, full joint covariance propagation, independent physical calibration, flight qualification or NASA endorsement.'}
 (ROOT/'docs/validation/engineering-reference-validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print(json.dumps({'status':'pass','cases':len(cases),'outbound_error_m':checks[0]['terminal_error_km']*1000,'return_error_m':checks[1]['terminal_error_km']*1000}),flush=True)
asyncio.run(main())
