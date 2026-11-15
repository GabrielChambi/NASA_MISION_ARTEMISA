"""Local native-DEM operations API: electric/data budgets, faults and bounded repairs."""
import asyncio,json,math
from datetime import datetime,timedelta,timezone
from fastapi import APIRouter,Request
from fastapi.responses import JSONResponse
from . import automatic_plan as planner
from .energy_model import validate_energy,validate_fault,simulate_energy,optimized_schedule
from .native_terrain import horizon_profile,native_footprint,interpolate_horizon
from .launch_context import LAUNCH_SITES
from .solar.horizons import fetch_samples,iso,HorizonsUnavailable

router=APIRouter(prefix='/api/operations')
DEFAULT_LANDING={'semi_major_m':200.,'semi_minor_m':100.,'heading_deg':0.,'footprint_radius_m':15.,'max_local_slope_deg':10.,'max_roughness_m':.5}

def validate_landing(raw=None):
 if raw is not None and not isinstance(raw,dict):raise ValueError('La región de dispersión debe ser un objeto.')
 q=DEFAULT_LANDING|dict(raw or {})
 for key,(lo,hi) in {'semi_major_m':(20,600),'semi_minor_m':(10,600),'heading_deg':(0,360),'footprint_radius_m':(5,60),'max_local_slope_deg':(0,45),'max_roughness_m':(.01,20)}.items():
  if not planner.finite(q.get(key),lo,hi):raise ValueError('Parámetro local inválido: '+key)
 if q['semi_minor_m']>q['semi_major_m']:raise ValueError('El semieje menor no puede superar al mayor.')
 return {k:q[k] for k in DEFAULT_LANDING}

def validate_request(value):
 if not isinstance(value,dict):raise ValueError('Define una misión y su configuración.')
 q=planner.validate_plan_request(value.get('mission'));catalog={c['id']:c for c in planner.surface()['cells'] if c['latitude_deg']<=-80}
 cell_id=value.get('cell_id')
 if not isinstance(cell_id,str) or cell_id not in catalog:raise ValueError('Elige una zona del polo sur.')
 site_id=value.get('launch_site_id','ksc-39b')
 if site_id not in LAUNCH_SITES:raise ValueError('Centro de lanzamiento desconocido.')
 target=dict(catalog[cell_id]);custom=value.get('target_coordinates')
 if custom is not None:
  if not isinstance(custom,dict) or not planner.finite(custom.get('latitude_deg'),-90,-80) or not planner.finite(custom.get('longitude_deg'),-180,180):raise ValueError('Coordenadas locales inválidas.')
  # The local center remains explicitly separate from the whole-cap screening cell.
  from .native_terrain import xy
  surface=planner.surface();x,y=xy(math.radians(custom['latitude_deg']),math.radians(custom['longitude_deg']))
  col=int(math.floor((float(x)-surface['grid']['xmin'])/surface['cell_spacing_m']));row=int(math.floor((surface['grid']['ymax']-float(y))/surface['cell_spacing_m']))
  actual=surface['cells'][row*surface['grid_size']+col] if 0<=row<surface['grid_size'] and 0<=col<surface['grid_size'] else None
  if not actual or actual['id'] not in catalog:raise ValueError('La coordenada local está fuera del catálogo del polo sur.')
  target=dict(actual)|{'latitude_deg':custom['latitude_deg'],'longitude_deg':custom['longitude_deg']}
 energy=validate_energy(value.get('energy'),q['surface_hours']);fault=validate_fault(value.get('fault'),q['surface_hours']);landing=validate_landing(value.get('landing'))
 landing['max_local_slope_deg']=min(landing['max_local_slope_deg'],q['effective_max_slope_deg'])
 candidates=value.get('candidate_ids',[])
 if not isinstance(candidates,list) or len(candidates)>4 or any(not isinstance(c,str) or c not in catalog for c in candidates):raise ValueError('Lista de sitios alternativos inválida.')
 policy=value.get('policy',{})
 if not isinstance(policy,dict) or not isinstance(policy.get('optional_enabled',True),bool):raise ValueError('Política de cargas inválida.')
 slots=policy.get('science_slots')
 if slots is not None and (not isinstance(slots,list) or len(slots)>1344 or any(not isinstance(i,int) or isinstance(i,bool) or not 0<=i<1344 for i in slots) or len(set(slots))!=len(slots)):raise ValueError('Horario científico inválido.')
 return {'mission':q,'cell':target,'energy':energy,'fault':fault,'landing':landing,'launch_site':LAUNCH_SITES[site_id],
  'candidate_ids':list(dict.fromkeys([target['id']]+candidates))[:4],'policy':{'science_slots':slots,'optional_enabled':policy.get('optional_enabled',True)}}

def shifted_request(q,hours):
 d=datetime.strptime(q['departure_utc'],'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)+timedelta(hours=hours)
 # The existing planning contract supports full minutes.
 if d.second or d.microsecond:raise ValueError('El retraso debe representar minutos completos.')
 return q|{'departure_utc':iso(d)}

async def environment(q):
 start=datetime.strptime(q['departure_utc'],'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
 anchor=await planner.get_sky('Earth',start,start+timedelta(hours=1));mission=planner.timing(q,planner.estimate_transfer(anchor['samples'][0]))
 begin=datetime.strptime(mission['arrival_utc'],'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc);end=begin+timedelta(hours=q['surface_hours'])
 result={};sources=[anchor['meta']]
 # JPL fair-use semaphore serializes the two queries, with exact per-epoch records.
 for key,target in (('sun',10),('earth',399)):
  rows,record,cached=await fetch_samples(planner.REFERENCE,begin,end,15,2,target,True)
  result[key]=rows;sources.append({'source':'JPL Horizons','query_url':record['query_url'],'retrieved_at':record['retrieved_at'],'cache_hit':cached,'latitude_deg':-90,'longitude_deg':0,'step_minutes':15})
 return {'mission':mission,'sky':result,'positions':{k:[planner.body_position(s) for s in rows] for k,rows in result.items()},'sources':sources}

def point_series(q,cell,env):
 hp=horizon_profile(float(cell['latitude_deg']),float(cell['longitude_deg']),float(q['solar_panel_height']),float(q['antenna_height']))
 basis=planner.frame(cell['latitude_deg'],cell['longitude_deg']);height=hp['elevation_m'];rows=[]
 supported=hp['near_complete'] and hp['valid_to_min_m']>=20000 and all(hp['profiles'][k] is not None for k in ('sun','earth'))
 for i,sample in enumerate(env['sky']['sun']):
  sun=env['positions']['sun'][i];earth=env['positions']['earth'][i]
  saz,sel=planner.angles(sun,basis,height,q['solar_panel_height']);eaz,eel=planner.angles(earth,basis,height,q['antenna_height'])
  epa,epe=planner.angles(earth,basis,height,q['solar_panel_height'])
  distance=lambda position,h:math.sqrt(sum((position[j]-basis[2][j]*(planner.R+height+h))**2 for j in range(3)))/1000
  rows.append({'t_utc':sample['t_utc'],'sun_azimuth_deg':saz,'sun_elevation_deg':sel,'earth_azimuth_deg':eaz,'earth_elevation_deg':eel,
   'sun_horizon_deg':interpolate_horizon(hp['profiles']['sun'],saz) if supported else None,'earth_horizon_deg':interpolate_horizon(hp['profiles']['earth'],eaz) if supported else None,
   'sun_range_km':distance(sun,q['solar_panel_height']),'earth_range_km':distance(earth,q['antenna_height']),
   'eclipse_earth_azimuth_deg':epa,'eclipse_earth_elevation_deg':epe,'eclipse_earth_range_km':distance(earth,q['solar_panel_height'])})
 return rows,hp

def terrain_assessment(cell,q,settings):
 study=native_footprint(cell['latitude_deg'],cell['longitude_deg'],settings)
 center=study['center_footprint']
 if center['risk']==3:
  return {'rule':'native-terrain-exclusion','source_resolution_m':study['source_resolution_m'],'passes':False,'center_footprint':center}
 if center['resolved']:
  return {'rule':'native-footprint','source_resolution_m':study['source_resolution_m'],'passes':center['risk'] in (1,2),'center_footprint':center}
 return {'rule':'regional-p95-only','source_resolution_m':study['source_resolution_m'],'passes':planner.finite(cell.get('regional_slope_deg'),0,q['effective_max_slope_deg']),'center_footprint':center,'limitation':'La huella permanece sin resolver; el criterio regional no la certifica.'}

def case_result(payload,q,cell,env,policy=None):
 rows,hp=point_series(q,cell,env);p=policy or payload['policy']
 budget=simulate_energy(rows,payload['energy'],payload['fault'],p['science_slots'],p['optional_enabled'])
 geometric={target+'_hours':None if any(s[target+'_horizon_deg'] is None for s in rows) else sum(.25 for s in rows[:-1] if s[target+'_elevation_deg']-s[target+'_horizon_deg']>.3) for target in ('sun','earth')}
 available_earth=None if geometric['earth_hours'] is None else sum(max(0.,.25-max(0.,min((i+1)*.25,payload['fault']['earth_outage_start_hour']+payload['fault']['earth_outage_hours'])-max(i*.25,payload['fault']['earth_outage_start_hour']))) for i,s in enumerate(rows[:-1]) if s['earth_elevation_deg']-s['earth_horizon_deg']>.3)
 geometric['available_earth_hours']=available_earth
 arrival_ok=all(rows[0][k+'_horizon_deg'] is not None and rows[0][k+'_elevation_deg']-rows[0][k+'_horizon_deg']>.3 for k in ('sun','earth'))
 terrain=terrain_assessment(cell,q,payload['landing']);slope_ok=terrain['passes']
 constraints={'terrain':slope_ok,'arrival_sun_earth_clearance':arrival_ok,'minimum_sun_hours':geometric['sun_hours'] is not None and geometric['sun_hours']>=q['min_sun_hours'],'minimum_earth_hours':available_earth is not None and available_earth>=q['min_earth_hours']}
 return {'request':q,'cell':{'id':cell['id'],'latitude_deg':cell['latitude_deg'],'longitude_deg':cell['longitude_deg'],'elevation_m':hp['elevation_m'],'regional_slope_deg':cell.get('regional_slope_deg')},
  'mission':env['mission'],'budget':budget,'geometric_visibility':geometric,'planning_constraints':constraints,'planning_constraints_met':all(constraints.values()),
  'energy_and_planning_pass':budget['feasible'] and all(constraints.values()),'terrain_assessment':terrain,'horizon':{k:v for k,v in hp.items() if k!='profiles'},'samples':rows,'sources':env['sources']}

async def analyze(payload):
 q=payload['mission'];original_env=await environment(q)
 original=await asyncio.to_thread(case_result,payload,q,payload['cell'],original_env)
 # The baseline has the same hardware and schedule, with no inserted failure.
 baseline_payload=payload|{'fault':validate_fault(None,q['surface_hours'])}
 baseline=await asyncio.to_thread(case_result,baseline_payload,q,payload['cell'],original_env)
 delayed=payload['fault']['delay_hours']
 if delayed:
  shifted=shifted_request(q,delayed);actual_env=await environment(shifted)
  affected=await asyncio.to_thread(case_result,payload,shifted,payload['cell'],actual_env)
 else:affected=original
 landing=await asyncio.to_thread(native_footprint,payload['cell']['latitude_deg'],payload['cell']['longitude_deg'],payload['landing'])
 return {'status':'ok','model_version':'lunar-operations-1','launch_site':payload['launch_site'],'baseline':baseline,'affected':affected,'local_study':landing,
  'scope':'Local native-DEM analysis; full-cap map remains regional. Electric/data feasibility and local terrain checks are separate.',
  'limitations':['Análisis local con rasters NASA verificados; requiere la API científica local, no usa mallas visuales.',
   'El centro espacial fija el contexto y su zona horaria. El tránsito sigue siendo una estimación desde órbita terrestre de 200 km; no se resuelve ascenso ni una ventana de lanzamiento.',
   'Los datos orbitales son JPL con cadencia de 15 min y traslación del observador lunar; comparación por escenario con SPICE disponible en el estudio físico.',
   'La energía y el enlace son modelos de diseño. Ninguna propuesta demuestra supervivencia térmica, estabilidad de la nave o ausencia de rocas subpíxel.']}

async def replan(payload):
 catalog={c['id']:c for c in planner.surface()['cells']};base=shifted_request(payload['mission'],payload['fault']['delay_hours']);tested=[];proposals=[]
 for offset in (0,24,48):
  q=shifted_request(base,offset);env=await environment(q)
  for id in payload['candidate_ids']:
   cell=payload['cell'] if id==payload['cell']['id'] else catalog[id]
   rows,hp=await asyncio.to_thread(point_series,q,cell,env)
   if not hp['near_complete'] or hp['valid_to_min_m']<20000:continue
   slots=optimized_schedule(rows,payload['energy'],payload['fault'])
   variants=[('same_schedule',payload['policy'])]
   if slots is not None:variants.extend([('reschedule_science',{'science_slots':slots,'optional_enabled':True}),('reschedule_and_shed_optional',{'science_slots':slots,'optional_enabled':False})])
   for mode,policy in variants:
    report=await asyncio.to_thread(case_result,payload,q,cell,env,policy)
    tested.append({'cell_id':id,'additional_delay_hours':offset,'policy':mode,'energy_pass':report['budget']['feasible'],'planning_pass':report['planning_constraints_met']})
    if not report['energy_and_planning_pass']:continue
    if offset==0 and id==payload['cell']['id'] and mode=='same_schedule':continue
    proposals.append({'id':str(offset)+':'+id+':'+mode,'label':{'same_schedule':'Cambiar fecha o lugar','reschedule_science':'Reprogramar la misma ciencia','reschedule_and_shed_optional':'Reprogramar y suspender carga opcional'}[mode],
     'proposed_request':q,'cell_id':id,'target_coordinates':{'latitude_deg':cell['latitude_deg'],'longitude_deg':cell['longitude_deg']},'policy':policy,
     'additional_delay_hours':offset,'total_delay_hours':payload['fault']['delay_hours']+offset,'criteria_preserved':True,
     'changes':{'site_changed':id!=payload['cell']['id'],'date_changed':offset!=0,'science_rescheduled':mode!='same_schedule','optional_suspended':not policy['optional_enabled']},
     'result':{k:report[k] for k in ('cell','mission','geometric_visibility','planning_constraints','horizon','sources')},'summary':report['budget']['summary'],
     'local_footprint_status':'requires_native_local_study','limitations':['Alternativa eléctrica y de visibilidad; debe estudiarse su huella local por separado.']})
    # One passing policy per site/date; do not flood the user with duplicates.
    break
  if len(proposals)>=3:break
 proposals.sort(key=lambda p:(p['additional_delay_hours'],p['changes']['site_changed'],p['changes']['optional_suspended'],-p['summary']['minimum_soc']))
 return {'status':'found' if proposals else 'none','criteria_preserved':True,'proposals':proposals[:3],'tested':tested,
  'search':{'date_offsets_hours':[0,24,48],'sites_considered':payload['candidate_ids'],'tested_scenarios':len(tested),'max_scenarios':36,
   'scope':'Hasta cuatro centros y tres fechas, con tres políticas. Heurística verificada; no óptimo global ni búsqueda de toda la superficie.'},
  'limitations':['No se reducen las horas científicas ni los criterios de pendiente/visibilidad; sólo se reorganizan actividades y cargas declaradas opcionales.',
   'Si no hay alternativa, significa que ninguna de las combinaciones examinadas pasó; no demuestra imposibilidad de la misión.']}

@router.post('/analyze')
@router.post('/replan')
async def endpoint(request:Request):
 try:
  if 'application/json' not in request.headers.get('content-type',''):return JSONResponse(status_code=415,content={'status':'unavailable','message':'Usa application/json.'})
  raw=b''
  async for part in request.stream():
   raw+=part
   if len(raw)>32768:return JSONResponse(status_code=413,content={'status':'unavailable','message':'Petición demasiado grande.'})
  try:payload=validate_request(json.loads(raw))
  except (ValueError,TypeError):return JSONResponse(status_code=422,content={'status':'unavailable','message':'Revisa misión, actividad científica, energía, dispersión y parámetros del fallo.'})
  try:
   result=await (replan(payload) if request.url.path.endswith('/replan') else analyze(payload))
   return JSONResponse(content=result,headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})
  except (FileNotFoundError,HorizonsUnavailable) as exc:
   english=request.headers.get('x-lunar-language')=='en'
   terrain=isinstance(exc,FileNotFoundError)
   message=('Native NASA terrain data are missing. Acquire the original rasters to calculate this destination.' if english else 'Faltan datos nativos de terreno NASA. Adquiere los rasters originales para calcular este destino.') if terrain else ('NASA/JPL ephemerides are unavailable for this exact scenario. Try again later; no alternative has been verified.' if english else 'No hay efemérides NASA/JPL disponibles para este escenario exacto. Reintenta más tarde; no se ha verificado una alternativa.')
   return JSONResponse(status_code=503,content={'status':'unavailable','code':'terrain_data_unavailable' if terrain else 'ephemeris_unavailable','message':message,'proposals':[]},headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'})
 except ValueError as exc:return JSONResponse(status_code=422,content={'status':'unavailable','message':str(exc)})
