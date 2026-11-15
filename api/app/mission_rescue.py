
"""Bounded alternatives from original NASA series; requested criteria are immutable."""
import asyncio
import json
import math
from datetime import datetime,timezone,timedelta
from fastapi import APIRouter,Request
from fastapi.responses import JSONResponse
from . import automatic_plan as plan
from .polar import surface

router=APIRouter()
H=3600000
LIMITATIONS=[
 'Búsqueda acotada a fechas futuras: pasos de 24 h y refinamiento de 1 h antes del primer día compatible. No es una optimización global continua.',
 'Se conservan pendiente, estancia, horas mínimas y altura del observador; sólo cambia el instante solicitado.',
 'Sólo se recomiendan centros con horizonte regional suficiente; los datos desconocidos no se extrapolan.',
 'El tránsito sigue siendo una estimación de dos cuerpos. No calcula una ventana real de lanzamiento, propulsión ni trayectoria de regreso.',
 'Cumplimiento regional con sensibilidad angular del horizonte; no certifica una huella de aterrizaje ni todos los errores del DEM.'
]

def milliseconds(value):
    return int(datetime.strptime(value,'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc).timestamp()*1000)

def stamp(value):
    return datetime.fromtimestamp(value/1000,timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

def validate_rescue_request(value):
    q=plan.validate_plan_request(value)
    days=value.get('search_days',14)
    if isinstance(days,bool) or not isinstance(days,int) or not 1<=days<=14:raise ValueError('La búsqueda debe abarcar entre 1 y 14 días.')
    if datetime.fromtimestamp((milliseconds(q['departure_utc'])+days*24*H)/1000,timezone.utc).year>2099:raise ValueError('La búsqueda supera el intervalo de fechas admitido.')
    return q,days

def select_resources(polar,h,q):
    plan.validated_resources(polar,h)
    support=plan.height_support(q,h)
    indices={name:i for i,name in enumerate(h['cell_ids'])}
    ready=[];terrain=[];selected=[]
    total=terrain_failed=terrain_unknown=0
    for cell in polar['cells']:
        if not -90<=cell['latitude_deg']<=-80:continue
        total+=1
        if not cell.get('known') or not all(plan.finite(cell.get(k),-1e12,1e12) for k in ('elevation_m','regional_slope_deg','max_slope_deg')):
            terrain_unknown+=1;continue
        if cell['regional_slope_deg']>q['effective_max_slope_deg']:
            terrain_failed+=1;continue
        terrain.append(cell)
        if not support['supported']:continue
        index=indices.get(cell['id'])
        if index is None or not plan.finite(h['valid_to_min_m'][index],20000,250000):continue
        profile=plan.decode_profile(h['profiles_int'][index],h.get('profile_encoding'))
        if profile is None or not all(plan.finite(v,-1e12,1e12) for v in profile):continue
        ready.append(cell);selected.append(index)
    subset=dict(h)
    for key in ('cell_ids','profiles_int','valid_to_min_m','ray_coverage_min_per_mille'):
        subset[key]=[h[key][i] for i in selected]
    diagnosis={'total_region_centers':total,'terrain_eligible_cells':len(terrain),'horizon_eligible_cells':len(ready),'terrain_excluded_cells':terrain_failed,
               'unknown_terrain_cells':terrain_unknown,'unknown_horizon_cells':len(terrain)-len(ready),'height_support':support,'original_green':0,'original_yellow':0,'blockers':[]}
    return dict(polar,cells=ready),subset,diagnosis

def base_report(q,days,polar,diagnosis):
    return {'status':'none','original_request':q,'criteria_preserved':True,'diagnosis':dict(diagnosis),'proposals':[],
            'search':{'search_days':days,'coarse_step_hours':24,'refine_step_hours':1,'max_scenarios':days+1+23,'candidate_centers':diagnosis['horizon_eligible_cells'],'tested_offsets_hours':[],'tested_scenarios':0,
                      'min_start_utc':q['departure_utc'],'max_start_utc':stamp(milliseconds(q['departure_utc'])+days*24*H),'scope':'earliest-tested-candidate-not-continuous-global-optimum'},
            'meta':{'sources':[],'limitations':LIMITATIONS,'terrain_source_sha256':polar['source_sha256']}}

def blocked_report(report):
    terrain=report['diagnosis']['terrain_eligible_cells']
    report['status']='blocked'
    report['diagnosis']['code']='unsupported_observer_height' if not report['diagnosis']['height_support']['supported'] else 'insufficient_horizon_data' if terrain else 'insufficient_terrain_data' if report['diagnosis']['unknown_terrain_cells'] else 'terrain_constraints'
    report['diagnosis']['summary']=report['diagnosis']['height_support']['reason'] if report['diagnosis']['code']=='unsupported_observer_height' else 'Faltan mediciones de terreno; los datos ausentes no permiten demostrar que ninguna zona pueda cumplir.' if report['diagnosis']['code']=='insufficient_terrain_data' else 'Hay sectores con pendiente compatible, pero sus horizontes no tienen cobertura suficiente. Cambiar la fecha no sustituye los datos ausentes.' if terrain else 'Ningún sector preparado cumple la pendiente solicitada. Cambiar la fecha no modifica el terreno.'
    return report

def validate_batch(batch,target,start,end):
    meta=batch.get('meta',{}) if isinstance(batch,dict) else {}
    if not isinstance(batch,dict) or batch.get('status')!='ok' or batch.get('target')!=target or meta.get('latitude_deg')!=-90 or meta.get('longitude_deg')!=0 or not str(meta.get('query_url','')).startswith('https://ssd.jpl.nasa.gov/api/horizons.api?') or len(batch.get('samples',[]))!=(end-start)//H+1:
        raise ValueError('La consulta NASA no cubre toda la búsqueda.')
    for i,row in enumerate(batch['samples']):
        if row.get('t_utc')!=stamp(start+i*H) or not all(plan.finite(row.get(k),-1e15,1e15) for k in ('azimuth_deg','elevation_deg','range_km')) or row['range_km']<=0:
            raise ValueError('La búsqueda recibió una serie NASA incompleta o desalineada.')
    return batch

def slice_batch(batch,start,end):
    offset=(start-milliseconds(batch['samples'][0]['t_utc']))/H
    length=(end-start)/H
    if not offset.is_integer() or not length.is_integer() or offset<0 or offset+length>=len(batch['samples']):
        raise ValueError('La ventana no coincide con el muestreo horario NASA; no se interpola una solución.')
    offset,length=int(offset),int(length)
    return dict(batch,samples=batch['samples'][offset:offset+length+1],meta=dict(batch['meta'],selection_start_utc=stamp(start),selection_end_utc=stamp(end),selection_first_sample=offset,selection_last_sample=offset+length))

def original_diagnosis(result,q):
    rows=result['cells']
    conditions=[
      ('sun_arrival','Sol sin despeje suficiente al llegar.',lambda c:c['arrival_margin_sensitivity']['sun_lower_deg']<=.3),
      ('earth_arrival','Tierra sin despeje suficiente al llegar.',lambda c:c['arrival_margin_sensitivity']['earth_lower_deg']<=.3),
      ('sun_duration','Horas de Sol insuficientes con el horizonte conservador.',lambda c:c['sun_hours_sensitivity']['lower']<q['min_sun_hours']),
      ('earth_duration','Horas de Tierra visible insuficientes con el horizonte conservador.',lambda c:c['earth_hours_sensitivity']['lower']<q['min_earth_hours'])]
    blockers=[{'code':code,'label':label,'count':sum(bool(predicate(row)) for row in rows)} for code,label,predicate in conditions]
    return {'original_green':result['counts']['green'],'original_yellow':result['counts']['yellow'],'blocker_scope':'terrain-and-horizon-eligible-centers',
            'blockers':[b for b in blockers if b['count']>0],
            'summary':'La fecha original ya contiene un candidato que cumple el modelo regional.' if result['best'] else 'La pendiente compatible no basta en esta fecha: se buscan otros instantes con Sol y Tierra sobre el horizonte, manteniendo tus requisitos.'}

def quality(scenario):
    best=scenario['result']['best']
    return (-min(best['sun_hours_sensitivity']['lower'],best['earth_hours_sensitivity']['lower']),
            -min(best['arrival_margin_sensitivity']['sun_lower_deg'],best['arrival_margin_sensitivity']['earth_lower_deg']),
            max(best['longest_dark_hours'],best['longest_earth_hidden_hours']),scenario['offset'])

def proposals_for(successes,sources):
    ordered=sorted(successes,key=lambda s:s['offset']);picked=[]
    if ordered:picked.append(ordered[0])
    if len(ordered)>1:
        candidates=[s for s in ordered if abs(s['offset']-picked[0]['offset'])>=12]
        picked.append(min(candidates or ordered[1:],key=quality))
    if len(picked)<3:
        remaining=[s for s in ordered if s not in picked]
        separate=[s for s in remaining if all(abs(s['offset']-p['offset'])>=12 for p in picked)]
        if separate or remaining:picked.append((separate or remaining)[0])
    result=[]
    for i,scenario in enumerate(picked):
        q=scenario['request'];offset=scenario['offset']
        result.append({'id':'rescue:'+q['departure_utc'],'label':'Menor cambio encontrado' if i==0 else 'Otra opción con buen margen' if i==1 else 'Otra ventana compatible',
          'proposed_request':q,'delta_hours':offset,'mission':scenario['result']['mission'],'best':scenario['result']['best'],'counts':scenario['result']['counts'],'counts_scope':'terrain-and-horizon-eligible-centers',
          'criteria_preserved':True,'changes':[] if offset==0 else ['Cambiar '+('el alunizaje' if q['date_kind']=='landing' else 'la salida')+' '+str(offset)+' horas.'],'sources':sources})
    return result

def evaluate_rescue(value,polar,h,batches):
    q,days=validate_rescue_request(value)
    selected,profiles,diagnosis=select_resources(polar,h,q);report=base_report(q,days,selected,diagnosis)
    if not diagnosis['horizon_eligible_cells']:return blocked_report(report)
    start=milliseconds(q['departure_utc']);last=start+days*24*H
    anchor=validate_batch(batches['anchor'],'Earth',start,last+H)
    at={s['t_utc']:s for s in anchor['samples']};timings={}
    for offset in range(days*24+1):
        request=dict(q,departure_utc=stamp(start+offset*H))
        if request['departure_utc'] not in at:raise ValueError('Falta la distancia NASA de un instante de búsqueda.')
        transfer=plan.estimate_transfer(at[request['departure_utc']]);mission=plan.timing(request,transfer)
        timings[offset]=(request,transfer,mission)
    min_arrival=min(milliseconds(t[2]['arrival_utc']) for t in timings.values())
    max_end=max(milliseconds(t[2]['surface_end_utc']) for t in timings.values())
    validate_batch(batches['sun'],'Sun',min_arrival,max_end);validate_batch(batches['earth'],'Earth',min_arrival,max_end)
    sources=[batches['anchor']['meta'],batches['sun']['meta'],batches['earth']['meta']]
    report['meta']['sources']=sources
    report['search'].update(arrival_start_utc=stamp(min_arrival),arrival_end_utc=stamp(max_end))
    scenarios={}
    def test(offset):
        if offset in scenarios:return scenarios[offset]
        request,transfer,mission=timings[offset]
        a,end=milliseconds(mission['arrival_utc']),milliseconds(mission['surface_end_utc'])
        sky={'sun':slice_batch(batches['sun'],a,end),'earth':slice_batch(batches['earth'],a,end),'transfer_source':batches['anchor']['meta']}
        full=plan.evaluate_global_plan(request,selected,profiles,sky,transfer)
        if offset==0:report['diagnosis'].update(original_diagnosis(full,q))
        result={key:full[key] for key in ('best','counts','mission')}
        scenario={'offset':offset,'request':request,'result':result};scenarios[offset]=scenario;return scenario
    coarse=list(range(0,days*24+1,24))
    for offset in coarse:test(offset)
    first=next((offset for offset in coarse if scenarios[offset]['result']['best']),None)
    if first is not None:
        report['search']['first_coarse_passing_offset_hours']=first
        for offset in range(max(0,first-23),first):test(offset)
    report['search'].update(tested_offsets_hours=sorted(scenarios),tested_scenarios=len(scenarios),refined_interval_hours=None if first is None else [max(0,first-23),first])
    report['proposals']=proposals_for([s for s in scenarios.values() if s['result']['best']],sources)
    report['status']='found' if report['proposals'] else 'none'
    return report

async def fetch_batches(q,days,get):
    start=milliseconds(q['departure_utc']);last=start+days*24*H
    anchor=await get('Earth',stamp(start),stamp(last+H))
    validate_batch(anchor,'Earth',start,last+H)
    times=[plan.timing(dict(q,departure_utc=stamp(start+i*H)),plan.estimate_transfer(sample)) for i,sample in enumerate(anchor['samples'][:-1])]
    lo=min(milliseconds(t['arrival_utc']) for t in times);hi=max(milliseconds(t['surface_end_utc']) for t in times)
    if hi-lo>31*24*H:raise ValueError('La ventana NASA necesaria supera el límite de 31 días.')
    sun=await get('Sun',stamp(lo),stamp(hi));earth=await get('Earth',stamp(lo),stamp(hi))
    return {'anchor':anchor,'sun':sun,'earth':earth}

async def search_mission_rescue(value,polar,h,get=None):
    q,days=validate_rescue_request(value)
    selected,_,diagnosis=select_resources(polar,h,q)
    if not diagnosis['horizon_eligible_cells']:return blocked_report(base_report(q,days,selected,diagnosis))
    if get is None:
        async def get(target,start,end):
            return await plan.get_sky(target,datetime.strptime(start,'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc),datetime.strptime(end,'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc))
    batches=await fetch_batches(q,days,get)
    return await asyncio.to_thread(evaluate_rescue,value,polar,h,batches)

@router.post('/api/mission-rescue')
async def mission_rescue(request:Request):
    try:
        if 'application/json' not in request.headers.get('content-type',''):return JSONResponse(status_code=415,content={'status':'unavailable','message':'Usa application/json.','proposals':[]})
        body=b''
        async for part in request.stream():
            body+=part
            if len(body)>16384:return JSONResponse(status_code=413,content={'status':'unavailable','message':'Petición demasiado grande.','proposals':[]})
        try:
            value=json.loads(body);validate_rescue_request(value)
        except (ValueError,TypeError):
            return JSONResponse(status_code=422,content={'status':'unavailable','message':'Los parámetros de búsqueda no son válidos.','proposals':[]})
        return await search_mission_rescue(value,surface(),plan.global_horizons())
    except plan.HorizonsUnavailable as error:
        return JSONResponse(status_code=503,content={'status':'unavailable','criteria_preserved':True,'proposals':[],'message':str(error)})
    except (ValueError,FileNotFoundError) as error:
        return JSONResponse(status_code=503,content={'status':'unavailable','criteria_preserved':True,'proposals':[],'message':str(error)})
