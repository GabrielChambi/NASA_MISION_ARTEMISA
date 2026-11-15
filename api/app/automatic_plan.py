"""Automatic whole-cap planning using native regional horizons and exact JPL series.

Transit is an explicitly labelled two-body estimate; it does not solve launch,
guidance, thermal state, electrical energy or an RF budget.
"""
import json
import math
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
    q={'departure_utc':raw,'date_kind':value.get('date_kind','departure'),'surface_hours':value.get('surface_hours',72),
       'max_slope_deg':value.get('max_slope_deg',10),'min_sun_hours':value.get('min_sun_hours',12),
       'min_earth_hours':value.get('min_earth_hours',12),'observer_height_m':value.get('observer_height_m',2)}
    if q['date_kind'] not in ('departure','landing') or not finite(q['surface_hours'],1,336) or not isinstance(q['surface_hours'],int) or not finite(q['max_slope_deg'],0,45) or not finite(q['min_sun_hours'],0,q['surface_hours']) or not finite(q['min_earth_hours'],0,q['surface_hours']) or q['observer_height_m']!=2:
        raise ValueError('Revisa duración (1–336 h), pendiente (0–45°), horas requeridas y altura del observador (2 m).')
    return q

def frame(latitude,longitude):
    p,l=math.radians(latitude),math.radians(longitude)
    return ([-math.sin(l),math.cos(l),0],[-math.sin(p)*math.cos(l),-math.sin(p)*math.sin(l),math.cos(p)],[math.cos(p)*math.cos(l),math.cos(p)*math.sin(l),math.sin(p)])

def body_position(sample,reference=REFERENCE):
    if not isinstance(sample,dict) or not all(finite(sample.get(k),-1e12,1e12) for k in ('azimuth_deg','elevation_deg','range_km')) or sample['range_km']<=0:raise ValueError('Faltan ángulos o distancia de NASA.')
    east,north,up=frame(reference['latitude_deg'],reference['longitude_deg'])
    a,e=math.radians(sample['azimuth_deg']),math.radians(sample['elevation_deg'])
    d=sample['range_km']*1000
    return [up[i]*(R+reference['elevation_m']+2)+d*(east[i]*math.sin(a)*math.cos(e)+north[i]*math.cos(a)*math.cos(e)+up[i]*math.sin(e)) for i in range(3)]

def angles(position,basis,elevation):
    east,north,up=basis
    v=[position[i]-up[i]*(R+elevation+2) for i in range(3)]
    dot=lambda a,b:sum(x*y for x,y in zip(a,b))
    e,n=dot(v,east),dot(v,north)
    return (math.degrees(math.atan2(e,n))%360,math.degrees(math.atan2(dot(v,up),math.hypot(e,n))))

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

def evaluate_global_plan(request,polar,h,sky,transfer):
    q=validate_plan_request(request);mission=timing(q,transfer)
    if h.get('version')!=1 or h.get('source_sha256')!=polar['source_sha256'] or h.get('observer_height_m')!=2 or h.get('azimuth_step_deg')!=5 or h.get('radius_m')!=R or not finite(h.get('quantization_deg'),.001,1) or len(h.get('cell_ids',[]))!=len(h.get('profiles_int',[])) or len(h.get('cell_ids',[]))!=len(h.get('ray_coverage_min_per_mille',[])) or len(h.get('cell_ids',[]))!=len(h.get('valid_to_min_m',[])):raise ValueError('Horizontes regionales incompletos o incompatibles.')
    validate_sky(sky['sun'],'Sun',mission);validate_sky(sky['earth'],'Earth',mission)
    profiles={id:(decode_profile(h['profiles_int'][i],h.get('profile_encoding')),h['ray_coverage_min_per_mille'][i],h['valid_to_min_m'][i]) for i,id in enumerate(h['cell_ids'])}
    suns=[body_position(s) for s in sky['sun']['samples']];earths=[body_position(s) for s in sky['earth']['samples']]
    results=[];counts={'green':0,'red':0,'unknown':0};quant=h['quantization_deg'];margin=.3
    for cell in polar['cells']:
        if cell['latitude_deg']>-80:continue
        row=candidate(cell)|{'risk':'unknown','reason':'Datos de terreno desconocidos.','reasons':[],'sun_hours':None,'earth_hours':None,'joint_hours':None,
            'sun_margin_deg':None,'earth_margin_deg':None,'longest_dark_hours':None,'longest_earth_hidden_hours':None,'score':None,'horizon_quality':h['quality']}
        if not cell['known'] or not all(finite(cell[k],-1e12,1e12) for k in ('elevation_m','regional_slope_deg','max_slope_deg')):
            row['reasons']=[row['reason']];counts['unknown']+=1;results.append(row);continue
        if cell['regional_slope_deg']>q['max_slope_deg']:
            row.update(risk='red',reason='Pendiente regional por encima del límite.',reasons=['Pendiente regional por encima del límite.'])
            counts['red']+=1;results.append(row);continue
        profile,coverage,validto=profiles.get(cell['id'],(None,0,0))
        if profile is None or len(profile)!=72 or any(not finite(v,-3600,3600) for v in profile) or not finite(validto,20000,250000):
            row['reason']='Cobertura del horizonte inferior a 20 km; faltan obstáculos distantes.';row['reasons']=[row['reason']];counts['unknown']+=1;results.append(row);continue
        basis=frame(cell['latitude_deg'],cell['longitude_deg'])
        sh=eh=jh=dark=hidden=maxdark=maxhidden=0;firstsun=firstearth=None
        for i in range(mission['surface_hours']):
            saz,sel=angles(suns[i],basis,cell['elevation_m']);eaz,eel=angles(earths[i],basis,cell['elevation_m'])
            sm=sel-horizon_value(profile,saz,quant);em=eel-horizon_value(profile,eaz,quant)
            if i==0:firstsun,firstearth=sm,em
            if sm>margin:sh+=1;dark=0
            else:dark+=1;maxdark=max(maxdark,dark)
            if em>margin:eh+=1;hidden=0
            else:hidden+=1;maxhidden=max(maxhidden,hidden)
            if sm>margin and em>margin:jh+=1
        reasons=[]
        if firstsun<=margin:reasons.append('Sol sin despeje suficiente al llegar.')
        if firstearth<=margin:reasons.append('Tierra sin despeje suficiente al llegar.')
        if sh<q['min_sun_hours']:reasons.append('Horas de Sol insuficientes.')
        if eh<q['min_earth_hours']:reasons.append('Horas de Tierra visible insuficientes.')
        score=min(sh/mission['surface_hours'],eh/mission['surface_hours'])*100
        row.update(risk='red' if reasons else 'green',reason=reasons[0] if reasons else 'Cumple el modelo regional en la fecha y duración evaluadas.',
            reasons=reasons or ['Cumple los criterios regionales calculados.'],sun_hours=sh,earth_hours=eh,joint_hours=jh,sun_margin_deg=round(firstsun,3),
            earth_margin_deg=round(firstearth,3),longest_dark_hours=maxdark,longest_earth_hidden_hours=maxhidden,score=round(score,3),horizon_coverage_min=coverage/1000)
        counts[row['risk']]+=1;results.append(row)
    ranked=sorted((r for r in results if r['score'] is not None),key=lambda r:(r['risk']!='green',-min(r['sun_hours'],r['earth_hours']),max(r['longest_dark_hours'],r['longest_earth_hidden_hours']),-min(r['sun_margin_deg'],r['earth_margin_deg']),r['regional_slope_deg'],r['id']))
    greens=separated([r for r in ranked if r['risk']=='green'],5,30000)
    reds=separated(sorted((r for r in results if r['risk']=='red'),key=lambda r:(-(r['regional_slope_deg'] or 0),r['id'])),8,50000)
    def attach(row):
        if row is None:return None
        profile=profiles[row['id']][0];basis=frame(row['latitude_deg'],row['longitude_deg']);series=[]
        for i,sample in enumerate(sky['sun']['samples']):
            saz,sel=angles(suns[i],basis,row['elevation_m']);eaz,eel=angles(earths[i],basis,row['elevation_m'])
            series.append({'t_utc':sample['t_utc'],'sun_azimuth_deg':round(saz,3),'sun_elevation_deg':round(sel,3),'sun_horizon_deg':round(horizon_value(profile,saz,quant),3),
                'earth_azimuth_deg':round(eaz,3),'earth_elevation_deg':round(eel,3),'earth_horizon_deg':round(horizon_value(profile,eaz,quant),3)})
        return row|{'time_series':series}
    compact_keys=('id','risk','reason','sun_hours','earth_hours','joint_hours','sun_margin_deg','earth_margin_deg','score')
    return {'status':'ok','mission':mission,'best':attach(greens[0]) if greens else None,'closest_candidate':None if greens else attach(ranked[0]) if ranked else None,
        'alternatives':[attach(r) for r in greens[1:4]],'rejected':reds,'counts':counts,'total_cells':len(results),'cells':[{k:r[k] for k in compact_keys} for r in results],
        'meta':{'generated_at':datetime.now(timezone.utc).isoformat(),'source_resolution_m':80,'regional_cell_spacing_m':polar['cell_spacing_m'],'horizon_quality':h['quality'],
            'horizon_azimuth_step_deg':5,'observer_height_m':2,'temporal_step_minutes':60,'arrival_clearance_deg':margin,'minimum_horizon_coverage_m':20000,'terrain_source_sha256':polar['source_sha256'],'score_definition':'100 × menor fracción de horas con Sol/Tierra. Los empates se resuelven con interrupciones, margen y pendiente.',
            'ranking':'Cumplimiento primero, luego peor fracción de Sol/Tierra, mayor interrupción, margen al llegar y pendiente; alternativas separadas al menos 30 km.',
            'sources':[sky['sun']['meta'],sky['earth']['meta'],sky.get('transfer_source')],'limitations':LIMITATIONS+h.get('limitations',[])}}

async def get_sky(target,start,end):
    rows,record,cached=await fetch_samples(REFERENCE,start,end,60,2,10 if target=='Sun' else 399,True)
    return {'status':'ok','target':target,'samples':rows,'meta':{'source':'JPL Horizons','source_url':'https://ssd-api.jpl.nasa.gov/doc/horizons.html','query_url':record['query_url'],
        'retrieved_at':record['retrieved_at'],'cache_hit':cached,'start_utc':iso(start),'end_utc':iso(end),'latitude_deg':-90,'longitude_deg':0,'observer_height_m':2}}

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
        start=datetime.strptime(q['departure_utc'],'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
        anchor=await get_sky('Earth',start,start+timedelta(hours=1))
        transfer=estimate_transfer(anchor['samples'][0]);mission=timing(q,transfer)
        arrival=datetime.strptime(mission['arrival_utc'],'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
        end=arrival+timedelta(hours=q['surface_hours'])
        sun=await get_sky('Sun',arrival,end);earth=await get_sky('Earth',arrival,end)
        return evaluate_global_plan(q,surface(),global_horizons(),{'sun':sun,'earth':earth,'transfer_source':anchor['meta']},transfer)
    except HorizonsUnavailable as exc:return JSONResponse(status_code=503,content={'status':'unavailable','message':str(exc)})
    except FileNotFoundError:return JSONResponse(status_code=503,content={'status':'unavailable','message':'Los horizontes regionales NASA todavía no están preparados.'})
    except ValueError as exc:return JSONResponse(status_code=503,content={'status':'unavailable','message':str(exc)})
