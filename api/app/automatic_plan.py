"""Automatic whole-cap planning using native regional horizons and exact JPL series.

Transit is an explicitly labelled two-body estimate; it does not solve launch,
guidance, thermal state, electrical energy or an RF budget.
"""
import asyncio
import json
import math
import numpy as np
from datetime import datetime,timezone,timedelta
from functools import lru_cache
from fastapi import APIRouter,Request
from fastapi.responses import JSONResponse
from .core.sites import DATA
from .solar.horizons import fetch_samples,iso,HorizonsUnavailable
from .polar import surface

router=APIRouter()
R=1737400.0
REFERENCE={'id':'automatic-south-pole','latitude_deg':-90,'longitude_deg':0,'elevation_m':0}
LIMITATIONS=[
 'Cribado regional del DEM NASA de 80 m agregado en zonas de 4,75 km; no certifica huella ni obstáculos locales.',
 'Horizontes propios de cada zona, muestreados cada 5 grados hasta 250 km; cobertura distante parcial.',
 'Las direcciones se trasladan geométricamente desde un observador JPL lunar; no son soluciones SPICE independientes por zona.',
 'Tránsito ideal de dos cuerpos desde órbita terrestre de 200 km; no calcula ventana de lanzamiento, guiado ni combustible.',
 'El retorno usa la misma duración estimada de ida; no se ha calculado una trayectoria de regreso.',
 'Visibilidad geométrica del centro del Sol/Tierra; sin energía eléctrica, temperatura ni presupuesto RF.',
 'La cadencia horaria limita las transiciones; los datos desconocidos no se extrapolan.'
]

def finite(value,lo,hi):
    return isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value) and lo<=value<=hi

def validate_plan_request(value):
    if not isinstance(value,dict):raise ValueError('Define los parámetros de la misión.')
    raw=value.get('departure_utc')
    try:
        if not isinstance(raw,str) or len(raw)!=20 or not raw.endswith(':00Z'):raise ValueError()
        start=datetime.strptime(raw,'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
        if not 1962<=start.year<=2099:raise ValueError()
    except (ValueError,TypeError):raise ValueError('La fecha debe ser UTC explícita, válida y con minutos completos (1962–2099).')
    vp=value.get('vehicle_profile',{})
    if vp is None:vp={}
    if not isinstance(vp,dict):raise ValueError('El perfil del vehículo debe ser un objeto.')
    lander_name=str(vp.get('lander_name') or value.get('lander_name') or 'Perfil de referencia 2 m').strip()[:80]
    solar_h=vp.get('solar_panel_height',value.get('solar_panel_height',2))
    antenna_h=vp.get('antenna_height',value.get('antenna_height',2))
    user_slope=value.get('max_slope_deg',10)
    vehicle_slope=vp.get('center_of_gravity_tolerance',value.get('center_of_gravity_tolerance',user_slope))
    q={'departure_utc':raw,'date_kind':value.get('date_kind','departure'),'surface_hours':value.get('surface_hours',72),
       'max_slope_deg':user_slope,'min_sun_hours':value.get('min_sun_hours',12),'min_earth_hours':value.get('min_earth_hours',12),
       'observer_height_m':value.get('observer_height_m',2)}
    if q['date_kind'] not in ('departure','landing') or not finite(q['surface_hours'],1,336) or not isinstance(q['surface_hours'],int) or not finite(user_slope,0,45) or not finite(vehicle_slope,0,45) or not finite(q['min_sun_hours'],0,q['surface_hours']) or not finite(q['min_earth_hours'],0,q['surface_hours']) or q['observer_height_m']!=2 or not finite(solar_h,.5,200) or not finite(antenna_h,.5,200):
        raise ValueError('Revisa duración (1–336 h), pendientes (0–45°), horas requeridas, referencia de 2 m y alturas del vehículo (0.5–200 m).')
    q.update(effective_max_slope_deg=min(user_slope,vehicle_slope),lander_name=lander_name,solar_panel_height=solar_h,antenna_height=antenna_h,
             vehicle_profile={'lander_name':lander_name,'solar_panel_height':solar_h,'antenna_height':antenna_h,'center_of_gravity_tolerance':vehicle_slope})
    return q

def height_support(q,h):
    profile_height=h['observer_height_m']
    supported=q.get('solar_panel_height',2)==profile_height and q.get('antenna_height',2)==profile_height
    return {'supported':supported,'profile_height_m':profile_height,
            'reason':'Horizontes del DEM preparados para paneles y antena a 2 m.' if supported else 'Faltan horizontes del DEM calculados para estas alturas de paneles o antena. El perfil de 2 m no se corrige con una distancia supuesta.'}

def cardinal_es(az:float)->str:
    dirs=('norte','noreste','este','sureste','sur','suroeste','oeste','noroeste')
    return dirs[int(((az%360)+22.5)//45)%8]

def frame(latitude,longitude):
    p,l=math.radians(latitude),math.radians(longitude)
    return ([-math.sin(l),math.cos(l),0],[-math.sin(p)*math.cos(l),-math.sin(p)*math.sin(l),math.cos(p)],[math.cos(p)*math.cos(l),math.cos(p)*math.sin(l),math.sin(p)])

def body_position(sample,reference=REFERENCE):
    if not isinstance(sample,dict) or not all(finite(sample.get(k),-1e12,1e12) for k in ('azimuth_deg','elevation_deg','range_km')) or sample['range_km']<=0:raise ValueError('Faltan ángulos o distancia de NASA.')
    east,north,up=frame(reference['latitude_deg'],reference['longitude_deg'])
    a,e=math.radians(sample['azimuth_deg']),math.radians(sample['elevation_deg'])
    d=sample['range_km']*1000
    return [up[i]*(R+reference['elevation_m']+2)+d*(east[i]*math.sin(a)*math.cos(e)+north[i]*math.cos(a)*math.cos(e)+up[i]*math.sin(e)) for i in range(3)]

def angles(position,basis,elevation,emitter_height_m=2.0):
    east,north,up=basis
    r_obs=R+elevation+emitter_height_m
    vx,vy,vz=position[0]-up[0]*r_obs,position[1]-up[1]*r_obs,position[2]-up[2]*r_obs
    e=vx*east[0]+vy*east[1]+vz*east[2]
    n=vx*north[0]+vy*north[1]+vz*north[2]
    u=vx*up[0]+vy*up[1]+vz*up[2]
    return (math.degrees(math.atan2(e,n))%360,math.degrees(math.atan2(u,math.hypot(e,n))))

def estimate_transfer(sample):
    distance=math.sqrt(sum(v*v for v in body_position(sample)))/1000
    if not 300000<=distance<=450000:raise ValueError('La distancia Tierra–Luna NASA queda fuera del rango válido.')
    r1,mu=6378.1366+200,398600.435507
    hours=math.pi*math.sqrt(((r1+distance)/2)**3/mu)/3600
    return {'method':'TWO_BODY_ESTIMATE','earth_moon_distance_km':distance,'parking_orbit_altitude_km':200,'earth_gm_km3_s2':mu,
            'transfer_hours':hours,'source_url':'https://ssd.jpl.nasa.gov/astro_par.html',
            'assumptions':['Transferencia elíptica ideal de dos cuerpos.','No es una trayectoria Artemis ni una ventana de lanzamiento.','Regreso simétrico sólo para estimar la duración total.']}

def timing(q,transfer):
    requested=datetime.strptime(q['departure_utc'],'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
    duration=timedelta(hours=transfer['transfer_hours'])
    theoretical=requested+duration
    if q['date_kind']=='landing':
        arrival=requested;departure=arrival-duration;rounding=0
    else:
        arrival=datetime.fromtimestamp(math.ceil(theoretical.timestamp()/3600)*3600,timezone.utc);departure=requested
        rounding=(arrival-theoretical).total_seconds()/60
    end=arrival+timedelta(hours=q['surface_hours']);back=end+duration
    return {'date_kind':q['date_kind'],'requested_utc':q['departure_utc'],'departure_utc':iso(departure),'arrival_utc':iso(arrival),
            'surface_end_utc':iso(end),'return_utc':iso(back),'outbound_hours':(arrival-departure).total_seconds()/3600,
            'surface_hours':q['surface_hours'],'return_hours':transfer['transfer_hours'],'total_hours':(back-departure).total_seconds()/3600,
            'arrival_rounding_minutes':rounding,'transfer_model':transfer,'assumptions':transfer['assumptions']}

def horizon_value(profile,azimuth,quant=.05):
    p=(azimuth%360)/5;i=int(p);fraction=p-i
    return (profile[i]*(1-fraction)+profile[(i+1)%72]*fraction)*quant

@lru_cache(maxsize=1)
def global_horizons():
    data=json.loads((DATA/'prepared/global_horizons.json').read_text(encoding='utf-8'))
    return data

@lru_cache(maxsize=1)
def decoded_global_profiles():
    h=global_horizons()
    enc=h.get('profile_encoding')
    return {id:(decode_profile(h['profiles_int'][i],enc),h['ray_coverage_min_per_mille'][i],h['valid_to_min_m'][i]) for i,id in enumerate(h['cell_ids'])}

@lru_cache(maxsize=1)
def cached_cell_frames():
    p=surface()
    return {c['id']:frame(c['latitude_deg'],c['longitude_deg']) for c in p['cells'] if c['latitude_deg']<=-80}

def validate_sky(result,target,mission):
    start=datetime.strptime(mission['arrival_utc'],'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
    if result.get('target')!=target or result.get('status')!='ok' or result.get('meta',{}).get('latitude_deg')!=-90 or result.get('meta',{}).get('longitude_deg')!=0 or not str(result.get('meta',{}).get('query_url','')).startswith('https://ssd.jpl.nasa.gov/api/horizons.api?') or len(result.get('samples',[]))!=mission['surface_hours']+1:raise ValueError('NASA devolvió un observador o una serie incompleta.')
    for index,row in enumerate(result['samples']):
        if row.get('t_utc')!=iso(start+timedelta(hours=index)) or not all(finite(row.get(k),-1e12,1e12) for k in ('azimuth_deg','elevation_deg','range_km')) or row['range_km']<=0:raise ValueError('Serie NASA desalineada o incompleta.')

def candidate(cell):
    return {k:cell[k] for k in ('id','latitude_deg','longitude_deg','elevation_m','regional_slope_deg','x_m','y_m')}|{'name':f"Sector {abs(cell['latitude_deg']):.2f}°S · {cell['longitude_deg']:.2f}°E"}

def separated(rows,limit,distance):
    result=[]
    for row in rows:
        if all(math.hypot(row['x_m']-r['x_m'],row['y_m']-r['y_m'])>=distance for r in result):
            result.append(row)
            if len(result)==limit:break
    return result

def decode_profile(values,encoding=None):
    if values is None:return None
    if not isinstance(values,list) or len(values)!=72 or any(not finite(v,-1e6,1e6) for v in values):return None
    if encoding not in (None,'absolute','delta'):raise ValueError('Codificación de horizontes no compatible.')
    if encoding!='delta':return values
    result=[];total=0
    for value in values:total+=value;result.append(total)
    return result


# Spatial coverage and angular-sampling sensitivity for every center in the cap.
GLX=(-.9602898564975363,-.7966664774136267,-.525532409916329,-.1834346424956498,.1834346424956498,.525532409916329,.7966664774136267,.9602898564975363)
GLW=(.1012285362903763,.2223810344533745,.3137066458778873,.362683783378362,.362683783378362,.3137066458778873,.2223810344533745,.1012285362903763)

@lru_cache(maxsize=32768)
def stereographic_cell_area(x,y,spacing,radius=R,cap_latitude=-80):
    if not all(isinstance(v,(int,float)) and math.isfinite(v) for v in (x,y,spacing,radius)) or spacing<=0 or radius<=0:return 0.0
    cap=2*radius*math.tan(math.radians(90+cap_latitude)/2);half=spacing/2
    left,right=max(-cap,x-half),min(cap,x+half);bottom,top=y-half,y+half
    if right<=left or bottom>=cap or top<=-cap:return 0.0
    if max(abs(x)-half,0)**2+max(abs(y)-half,0)**2>=cap*cap:return 0.0
    cuts=[left,right]
    for edge in (bottom,top):
        if abs(edge)<cap:
            crossing=math.sqrt(cap*cap-edge*edge)
            cuts.extend(k for k in (-crossing,crossing) if left<k<right)
    cuts.sort()
    primitive=lambda z,a:z/(2*a*(a+z*z))+math.atan(z/math.sqrt(a))/(2*a**1.5)
    area=0.0;scale=16*radius**4
    for index in range(1,len(cuts)):
        middle=(cuts[index]+cuts[index-1])/2;width=(cuts[index]-cuts[index-1])/2
        for gx,gw in zip(GLX,GLW):
            xx=middle+width*gx;rim=math.sqrt(max(0,cap*cap-xx*xx));lo,hi=max(bottom,-rim),min(top,rim)
            if hi<=lo:continue
            a=4*radius*radius+xx*xx
            area+=width*gw*scale*(primitive(hi,a)-primitive(lo,a))
    return max(0.0,area/1e6)

def horizon_sensitivity(profile,azimuth,quant=.05):
    if not isinstance(profile,list) or len(profile)!=72 or any(not finite(v,-1e6,1e6) for v in profile):return None
    p=(azimuth%360)/5;i=int(p);fraction=p-i;a,b=profile[i]*quant,profile[(i+1)%72]*quant
    return {'nominal':a*(1-fraction)+b*fraction,'lower':min(a,b)-quant,'upper':max(a,b)}

def sky_arrays(cell,profile,positions,hours,quant,solar_h=2.0,antenna_h=2.0):
    # Heights require their own DEM-derived horizon. No arbitrary obstacle distance.
    if solar_h!=2 or antenna_h!=2:raise ValueError('No hay horizontes preparados para estas alturas.')
    # One vectorized time array per cell avoids Python loops over every epoch.
    basis=np.asarray(frame(cell['latitude_deg'],cell['longitude_deg']),dtype=np.float64)
    lookup=np.asarray(profile,dtype=np.float64)*quant
    output=[]
    for body,emitter_h in (('sun',solar_h),('earth',antenna_h)):
        projected=positions[body][:hours]@basis.T
        az=np.mod(np.degrees(np.arctan2(projected[:,0],projected[:,1])),360)
        el=np.degrees(np.arctan2(projected[:,2]-(R+cell['elevation_m']+emitter_h),np.hypot(projected[:,0],projected[:,1])))
        p=az/5;index=np.floor(p).astype(np.int64);fraction=p-index
        a,b=lookup[index],lookup[(index+1)%72]
        output.append((el-(a*(1-fraction)+b*fraction),el-np.maximum(a,b),el-(np.minimum(a,b)-quant)))
    return output

def max_false_run(visible):
    indexes=np.flatnonzero(np.concatenate(([True],visible,[True])))
    return int(np.max(np.diff(indexes)-1))

def time_metrics(cell,profile,positions,hours,quant,margin=.3,solar_h=2.0,antenna_h=2.0):
    sun,earth=sky_arrays(cell,profile,positions,hours,quant,solar_h=solar_h,antenna_h=antenna_h)
    sv,ev=sun[0]>margin,earth[0]>margin
    return {'sun_hours':int(np.count_nonzero(sv)),'earth_hours':int(np.count_nonzero(ev)),'joint_hours':int(np.count_nonzero(sv&ev)),
        'longest_dark_hours':max_false_run(sv),'longest_earth_hidden_hours':max_false_run(ev),'sun_margin_deg':float(sun[0][0]),'earth_margin_deg':float(earth[0][0]),
        'sun_hours_sensitivity':{'lower':int(np.count_nonzero(sun[1]>margin)),'upper':int(np.count_nonzero(sun[2]>margin))},
        'earth_hours_sensitivity':{'lower':int(np.count_nonzero(earth[1]>margin)),'upper':int(np.count_nonzero(earth[2]>margin))},
        'arrival_margin_sensitivity':{'sun_lower_deg':float(sun[1][0]),'sun_upper_deg':float(sun[2][0]),'earth_lower_deg':float(earth[1][0]),'earth_upper_deg':float(earth[2][0])}}

def validated_resources(polar,h):
    if not polar.get('cells') or h.get('version')!=1 or h.get('source_sha256')!=polar['source_sha256'] or h.get('observer_height_m')!=2 or h.get('azimuth_step_deg')!=5 or h.get('radius_m')!=R or not finite(h.get('quantization_deg'),.001,1) or len(h.get('cell_ids',[]))!=len(h.get('profiles_int',[])) or len(h.get('cell_ids',[]))!=len(h.get('ray_coverage_min_per_mille',[])) or len(h.get('cell_ids',[]))!=len(h.get('valid_to_min_m',[])):raise ValueError('Horizontes regionales incompletos o incompatibles.')
    if len(set(h['cell_ids']))!=len(h['cell_ids']):raise ValueError('Horizontes regionales contienen celdas duplicadas.')

def prepare_evaluation(request,polar,h,sky,transfer,only_cell_id=None):
    q=validate_plan_request(request);mission=timing(q,transfer)
    validated_resources(polar,h)
    validate_sky(sky['sun'],'Sun',mission);validate_sky(sky['earth'],'Earth',mission)
    if only_cell_id is None and (h is global_horizons()):
        profiles=decoded_global_profiles()
    else:
        profiles={id:(decode_profile(h['profiles_int'][i],h.get('profile_encoding')),h['ray_coverage_min_per_mille'][i],h['valid_to_min_m'][i]) for i,id in enumerate(h['cell_ids']) if only_cell_id is None or id==only_cell_id}
    positions={body:np.asarray([body_position(s) for s in sky[body]['samples']],dtype=np.float64) for body in ('sun','earth')}
    return q,mission,profiles,positions

def evaluate_cell(cell,profile_info,q,positions,h,spacing):
    profile,coverage,validto=profile_info or (None,None,None)
    row={k:cell.get(k) for k in ('id','row','col','x_m','y_m','latitude_deg','longitude_deg','elevation_m','regional_slope_deg','max_slope_deg','median_slope_deg','roughness_m','relief_m')}
    row.update(coverage_fraction=cell.get('coverage_fraction',1 if cell.get('known') else 0),area_km2=round(stereographic_cell_area(cell['x_m'],cell['y_m'],spacing),6),
        risk='unknown',reason='Datos de terreno desconocidos.',reasons=[],score=None,sun_hours=None,earth_hours=None,joint_hours=None,
        sun_margin_deg=None,earth_margin_deg=None,longest_dark_hours=None,longest_earth_hidden_hours=None,nominal_pass=False,sensitivity_pass=False,
        horizon_quality=h['quality'],horizon_coverage_min=coverage/1000 if finite(coverage,0,1000) else None,horizon_min_distance_m=validto)
    if not -90<=cell['latitude_deg']<=-80:
        row['reason']='Borde del casquete sin perfil de observador preparado; no se extiende el resultado vecino.';row['reasons']=[row['reason']];return row
    if not cell.get('known') or not all(finite(cell.get(k),-1e12,1e12) for k in ('elevation_m','regional_slope_deg','max_slope_deg')):
        row['reasons']=[row['reason']];return row
    support=height_support(q,h)
    if not support['supported']:
        row['reason']=support['reason'];row['reasons']=[row['reason']];return row
    terrain_failed=cell['regional_slope_deg']>q['effective_max_slope_deg']
    profile_known=profile is not None and len(profile)==72 and all(finite(v,-1e6,1e6) for v in profile) and finite(validto,20000,250000)
    if not profile_known:
        row['risk']='red' if terrain_failed else 'unknown'
        row['reason']='Pendiente regional por encima del límite.' if terrain_failed else 'Cobertura del horizonte inferior a 20 km; faltan obstáculos distantes.'
        row['reasons']=[row['reason']];return row
    m=time_metrics(cell,profile,positions,q['surface_hours'],h['quantization_deg'],solar_h=q.get('solar_panel_height',2.0),antenna_h=q.get('antenna_height',2.0))
    reasons=[]
    if terrain_failed:reasons.append('Pendiente regional por encima del límite.')
    if m['sun_margin_deg']<=.3:reasons.append('Sol sin despeje suficiente al llegar.')
    if m['earth_margin_deg']<=.3:reasons.append('Tierra sin despeje suficiente al llegar.')
    if m['sun_hours']<q['min_sun_hours']:reasons.append('Horas de Sol insuficientes.')
    if m['earth_hours']<q['min_earth_hours']:reasons.append('Horas de Tierra visible insuficientes.')
    a=m['arrival_margin_sensitivity'];nominal=not reasons
    robust=not terrain_failed and a['sun_lower_deg']>.3 and a['earth_lower_deg']>.3 and m['sun_hours_sensitivity']['lower']>=q['min_sun_hours'] and m['earth_hours_sensitivity']['lower']>=q['min_earth_hours']
    optimistic=not terrain_failed and a['sun_upper_deg']>.3 and a['earth_upper_deg']>.3 and m['sun_hours_sensitivity']['upper']>=q['min_sun_hours'] and m['earth_hours_sensitivity']['upper']>=q['min_earth_hours']
    row.update(m)
    row['risk']='green' if robust else 'yellow' if nominal or optimistic else 'red';row['nominal_pass']=nominal;row['sensitivity_pass']=robust
    row['reason']='Candidato regional que cumple incluso al variar entre los horizontes angulares muestreados.' if row['risk']=='green' else 'Resultado sensible al muestreo angular del horizonte; requiere un estudio local.' if row['risk']=='yellow' else reasons[0]
    row['reasons']=[row['reason']] if row['risk']=='green' else [row['reason']]+reasons if row['risk']=='yellow' else reasons
    row['score']=round(min(m['sun_hours']/q['surface_hours'],m['earth_hours']/q['surface_hours'])*100,3)
    row['sun_margin_deg']=round(row['sun_margin_deg'],6);row['earth_margin_deg']=round(row['earth_margin_deg'],6)
    row['arrival_margin_sensitivity']={k:round(v,6) for k,v in a.items()}
    return row

def coverage_for(results,polar):
    cap_area=2*math.pi*R*R*(1-math.sin(math.radians(80)))
    classes={risk:{'cells':0,'area_km2':0.0,'fraction_of_cap':0.0} for risk in ('green','yellow','red','unknown')}
    represented=evaluated=0.0
    for cell in results:
        area=cell['area_km2'];represented+=area;classes[cell['risk']]['cells']+=1;classes[cell['risk']]['area_km2']+=area
        if cell['risk']!='unknown':evaluated+=area
    cap_area/=1e6;gap=max(0.0,cap_area-represented)
    classes['unknown']['area_km2']+=gap
    for value in classes.values():
        value['fraction_of_cap']=value['area_km2']/cap_area;value['area_km2']=round(value['area_km2'],3)
    return {'cap_area_km2':round(cap_area,3),'represented_area_km2':round(represented,3),'unrepresented_area_km2':round(gap,3),'evaluated_area_km2':round(evaluated,3),
        'by_class':classes,'source_resolution_m':80,'cell_spacing_m':polar['cell_spacing_m'],'latitude_bounds_deg':[-90,-80],
        'area_method':'Spherical inverse-stereographic area Jacobian integrated with 8-point quadrature and clipped to the 80 S cap.',
        'scope':'regional-screening-centers','unknown_boundary_included':True}

def evaluation_meta(polar,h,sky,q=None):
    solar_h=(q or {}).get('solar_panel_height',2)
    antenna_h=(q or {}).get('antenna_height',2)
    return {'generated_at':datetime.now(timezone.utc).isoformat(),'source_resolution_m':80,'regional_cell_spacing_m':polar['cell_spacing_m'],'horizon_quality':h['quality'],
        'horizon_azimuth_step_deg':5,'observer_height_m':2,'solar_panel_height_m':solar_h,'antenna_height_m':antenna_h,'height_support':height_support(q or {},h),'requested_max_slope_deg':(q or {}).get('max_slope_deg',10),'effective_max_slope_deg':(q or {}).get('effective_max_slope_deg',10),'temporal_step_minutes':60,'arrival_clearance_deg':.3,'minimum_horizon_coverage_m':20000,'terrain_source_sha256':polar['source_sha256'],
        'screening_unit':'4.75 km regional cell represented by its center observer; not a resolved landing footprint.',
        'sensitivity_method':'Adjacent 5-degree horizon-bin min/max, including upward-quantization interval of 0.05 degrees; scenario sensitivity, not physical uncertainty bounds.',
        'score_definition':'100 × menor fracción nominal de horas con Sol/Tierra. Los empates se resuelven con interrupciones, margen y pendiente.',
        'ranking':'Cumplimiento de sensibilidad primero; fracción nominal, interrupciones, margen y pendiente. Alternativas separadas al menos 30 km.',
        'sources':[s for s in (sky['sun']['meta'],sky['earth']['meta'],sky.get('transfer_source')) if s],
        'limitations':LIMITATIONS+h.get('limitations',[])+[
            'La clasificación corresponde al centro y al estadístico regional P95; no certifica cada punto de una celda ni una huella de alunizaje.',
            'Amarillo representa sensibilidad entre azimuts muestreados, no una probabilidad ni una cota de todos los errores; obstáculos entre rayos y error del DEM no están acotados.',
            'El borde no representado por centros preparados permanece desconocido. No se extrapolan las clases vecinas.']}

def attach_timeline(row,profiles,sky,h,positions,q=None,mission=None):
    support=height_support(q or {},h)
    if not support['supported']:
        return row|{'time_series':[],'diagnostics':{'height_support':support,'base_in_shadow_while_panels_lit_hours':None,'vehicle_comparison_status':'not_computed'}}
    profile,_,validto=profiles.get(row['id'],(None,None,None))
    if profile is None or not finite(validto,20000,250000) or not finite(row['elevation_m'],-1e12,1e12) or row['latitude_deg']>-80:return row|{'time_series':[]}
    basis=frame(row['latitude_deg'],row['longitude_deg']);series=[]
    quant=h['quantization_deg'];margin=.3
    surface_hours=(mission or {}).get('surface_hours',len(sky['sun']['samples'])-1)
    first_sun_block_h=None;first_sun_block_dir=None;first_earth_block_h=None;first_earth_block_dir=None
    for i,sample in enumerate(sky['sun']['samples']):
        saz,sel=angles(positions['sun'][i],basis,row['elevation_m'],2)
        eaz,eel=angles(positions['earth'][i],basis,row['elevation_m'],2)
        shor=horizon_value(profile,saz,quant);ehor=horizon_value(profile,eaz,quant)
        series.append({'t_utc':sample['t_utc'],'sun_azimuth_deg':round(saz,3),'sun_elevation_deg':round(sel,3),'sun_horizon_deg':round(shor,3),
            'earth_azimuth_deg':round(eaz,3),'earth_elevation_deg':round(eel,3),'earth_horizon_deg':round(ehor,3),
            'base_sun_horizon_deg':round(shor,3)})
        if i<surface_hours:
            if sel-shor<=margin and first_sun_block_h is None:
                first_sun_block_h=i;first_sun_block_dir=cardinal_es(saz)
            if eel-ehor<=margin and first_earth_block_h is None:
                first_earth_block_h=i;first_earth_block_dir=cardinal_es(eaz)
    return row|{'time_series':series,'diagnostics':{
        'first_sun_block_hour':first_sun_block_h,'first_sun_block_cardinal':first_sun_block_dir,
        'first_earth_block_hour':first_earth_block_h,'first_earth_block_cardinal':first_earth_block_dir,
        'height_support':support,'clearance_threshold_deg':margin,'cadence_minutes':60,
        'base_in_shadow_while_panels_lit_hours':None,'vehicle_comparison_status':'not_computed'
    }}

def evaluate_global_plan(request,polar,h,sky,transfer):
    q,mission,profiles,positions=prepare_evaluation(request,polar,h,sky,transfer)
    results=[];counts={'green':0,'yellow':0,'red':0,'unknown':0}
    for cell in polar['cells']:
        if cell['latitude_deg']>-80:continue
        row=evaluate_cell(cell,profiles.get(cell['id']),q,positions,h,polar['cell_spacing_m'])
        counts[row['risk']]+=1;results.append(row)
    priorities={'green':0,'yellow':1,'red':2,'unknown':3}
    ranked=sorted((r for r in results if r['score'] is not None),key=lambda r:(priorities[r['risk']],-min(r['sun_hours'],r['earth_hours']),max(r['longest_dark_hours'],r['longest_earth_hidden_hours']),-min(r['sun_margin_deg'],r['earth_margin_deg']),r['regional_slope_deg'],r['id']))
    greens=separated([r for r in ranked if r['risk']=='green'],5,30000)
    yellows=separated([r for r in ranked if r['risk']=='yellow'],3,30000)
    reds=separated(sorted((r for r in results if r['risk']=='red'),key=lambda r:(-(r['regional_slope_deg'] or 0),r['id'])),8,50000)
    attach=lambda row:attach_timeline(row,profiles,sky,h,positions,q,mission) if row else None
    return {'status':'ok','mission':mission,
        'vehicle_profile':q['vehicle_profile'],
        'best':attach(greens[0]) if greens else None,'closest_candidate':None if greens else attach(ranked[0]) if ranked else None,
        'alternatives':[attach(r) for r in greens[1:4]],'caution_candidates':[attach(r) for r in yellows],'rejected':reds,'counts':counts,'total_cells':len(results),
        'cells':results,'coverage':coverage_for(results,polar),'meta':evaluation_meta(polar,h,sky,q)}

def evaluate_plan_cell(request,polar,h,sky,transfer,cell_id):
    q,mission,profiles,positions=prepare_evaluation(request,polar,h,sky,transfer,cell_id)
    cell=next((c for c in polar['cells'] if c['id']==cell_id),None)
    if cell is None:raise ValueError('La celda solicitada no pertenece al catálogo regional.')
    row=evaluate_cell(cell,profiles.get(cell['id']),q,positions,h,polar['cell_spacing_m'])
    return {'status':'ok','mission':mission,'vehicle_profile':q['vehicle_profile'],'cell':attach_timeline(row,profiles,sky,h,positions,q,mission),'meta':evaluation_meta(polar,h,sky,q)}

async def get_sky(target,start,end):
    rows,record,cached=await fetch_samples(REFERENCE,start,end,60,2,10 if target=='Sun' else 399,True)
    return {'status':'ok','target':target,'samples':rows,'meta':{'source':'JPL Horizons','source_url':'https://ssd-api.jpl.nasa.gov/doc/horizons.html','query_url':record['query_url'],
        'retrieved_at':record['retrieved_at'],'cache_hit':cached,'start_utc':iso(start),'end_utc':iso(end),'latitude_deg':-90,'longitude_deg':0,'observer_height_m':2}}

@router.post('/api/automatic-plan/cell')
@router.post('/api/automatic-plan')
async def automatic_plan(request:Request):
    try:
        if 'application/json' not in request.headers.get('content-type',''):return JSONResponse(status_code=415,content={'status':'unavailable','message':'Usa application/json.'})
        body=b''
        async for part in request.stream():
            body+=part
            if len(body)>16384:return JSONResponse(status_code=413,content={'status':'unavailable','message':'La petición supera el tamaño permitido.'})
        try:q=validate_plan_request(json.loads(body))
        except (ValueError,TypeError):return JSONResponse(status_code=422,content={'status':'unavailable','message':'Los parámetros de misión no son válidos.'})
        inspect=request.url.path.endswith('/cell')
        cell_id=json.loads(body).get('cell_id')
        if inspect and (not isinstance(cell_id,str) or len(cell_id)>64 or not any(c['id']==cell_id for c in surface()['cells'])):
            return JSONResponse(status_code=404,content={'status':'unavailable','message':'La celda solicitada no pertenece al catálogo regional.'})
        start=datetime.strptime(q['departure_utc'],'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
        anchor=await get_sky('Earth',start,start+timedelta(hours=1))
        transfer=estimate_transfer(anchor['samples'][0]);mission=timing(q,transfer)
        arrival=datetime.strptime(mission['arrival_utc'],'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
        end=arrival+timedelta(hours=q['surface_hours'])
        sun,earth=await asyncio.gather(get_sky('Sun',arrival,end),get_sky('Earth',arrival,end))
        sky={'sun':sun,'earth':earth,'transfer_source':anchor['meta']}
        if inspect:return await asyncio.to_thread(evaluate_plan_cell,q,surface(),global_horizons(),sky,transfer,cell_id)
        return await asyncio.to_thread(evaluate_global_plan,q,surface(),global_horizons(),sky,transfer)
    except HorizonsUnavailable as exc:return JSONResponse(status_code=503,content={'status':'unavailable','message':str(exc)})
    except FileNotFoundError:return JSONResponse(status_code=503,content={'status':'unavailable','message':'Los horizontes regionales NASA todavía no están preparados.'})
    except ValueError as exc:return JSONResponse(status_code=503,content={'status':'unavailable','message':str(exc)})
