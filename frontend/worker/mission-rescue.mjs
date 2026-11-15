
/** Bounded, traceable schedule alternatives. Changes time only; never relaxes criteria. */
import {createScienceApi,ScienceError} from './science.mjs'
import {REFERENCE,validatePlanRequest,estimateTransfer,missionTiming,evaluateGlobalPlan,decodeProfile,heightSupport} from './automatic-plan.mjs'
const H=3600000,R=1737400
const iso=t=>new Date(t).toISOString().slice(0,19)+'Z'
export const RESCUE_LIMITATIONS=[
 'Búsqueda acotada a fechas futuras: pasos de 24 h y refinamiento de 1 h antes del primer día compatible. No es una optimización global continua.',
 'Se conservan pendiente, estancia, horas mínimas y altura del observador; sólo cambia el instante solicitado.',
 'Sólo se recomiendan centros con horizonte regional suficiente; los datos desconocidos no se extrapolan.',
 'El tránsito sigue siendo una estimación de dos cuerpos. No calcula una ventana real de lanzamiento, propulsión ni trayectoria de regreso.',
 'Cumplimiento regional con sensibilidad angular del horizonte; no certifica una huella de aterrizaje ni todos los errores del DEM.'
]
export function validateRescueRequest(input){
 const q=validatePlanRequest(input),days=input.search_days===undefined?14:input.search_days
 if(!Number.isInteger(days)||days<1||days>14)throw new ScienceError('La búsqueda debe abarcar entre 1 y 14 días.')
 if(new Date(Date.parse(q.departure_utc)+days*24*H).getUTCFullYear()>2099)throw new ScienceError('La búsqueda supera el intervalo de fechas admitido.')
 return {q,search_days:days}
}
const finite=value=>typeof value==='number'&&Number.isFinite(value)
export function selectRescueResources(resources,q){
 const polar=resources.polar,h=resources.globalHorizons
 if(!polar?.cells?.length||h?.version!==1||h.observer_height_m!==2||h.azimuth_step_deg!==5||h.radius_m!==R||h.source_sha256!==polar.source_sha256||h.cell_ids?.length!==h.profiles_int?.length||h.cell_ids?.length!==h.valid_to_min_m?.length||h.cell_ids?.length!==h.ray_coverage_min_per_mille?.length||!finite(h.quantization_deg)||h.quantization_deg<=0||new Set(h.cell_ids).size!==h.cell_ids.length)throw new ScienceError('Los perfiles regionales no corresponden al terreno NASA.',503)
 const support=heightSupport(q,h)
 const byId=new Map(h.cell_ids.map((id,i)=>[id,i])),terrain=[],eligible=[],indices=[]
 let total=0,terrainFailed=0,terrainUnknown=0
 for(const cell of polar.cells){
  if(cell.latitude_deg> -80||cell.latitude_deg< -90)continue
  total++
  if(!cell.known||![cell.elevation_m,cell.regional_slope_deg,cell.max_slope_deg].every(finite)){terrainUnknown++;continue}
  if(cell.regional_slope_deg>q.effective_max_slope_deg){terrainFailed++;continue}
  terrain.push(cell)
  if(!support.supported)continue
  const i=byId.get(cell.id)
  if(i===undefined||!finite(h.valid_to_min_m[i])||h.valid_to_min_m[i]<20000||h.valid_to_min_m[i]>250000)continue
  const profile=decodeProfile(h.profiles_int[i],h.profile_encoding)
  if(!profile||profile.some(value=>!finite(value)))continue
  eligible.push(cell);indices.push(i)
 }
 const subset={...h}
 for(const name of ['cell_ids','profiles_int','valid_to_min_m','ray_coverage_min_per_mille'])subset[name]=indices.map(i=>h[name][i])
 return {resources:{...resources,polar:{...polar,cells:eligible},globalHorizons:subset},
  diagnosis:{total_region_centers:total,terrain_eligible_cells:terrain.length,horizon_eligible_cells:eligible.length,terrain_excluded_cells:terrainFailed,unknown_terrain_cells:terrainUnknown,unknown_horizon_cells:terrain.length-eligible.length,height_support:support,original_green:0,original_yellow:0,blockers:[]}}
}
function baseReport(q,days,selection){
 return {status:'none',original_request:q,criteria_preserved:true,diagnosis:{...selection.diagnosis},
  proposals:[],search:{search_days:days,coarse_step_hours:24,refine_step_hours:1,max_scenarios:days+1+23,candidate_centers:selection.diagnosis.horizon_eligible_cells,tested_offsets_hours:[],tested_scenarios:0,min_start_utc:q.departure_utc,max_start_utc:iso(Date.parse(q.departure_utc)+days*24*H),scope:'earliest-tested-candidate-not-continuous-global-optimum'},
  meta:{sources:[],limitations:RESCUE_LIMITATIONS,terrain_source_sha256:selection.resources.polar.source_sha256}}
}
function blockedReport(report){
 const terrain=report.diagnosis.terrain_eligible_cells
 report.status='blocked';report.diagnosis.code=!report.diagnosis.height_support.supported?'unsupported_observer_height':terrain?'insufficient_horizon_data':report.diagnosis.unknown_terrain_cells?'insufficient_terrain_data':'terrain_constraints'
 report.diagnosis.summary=report.diagnosis.code==='unsupported_observer_height'?report.diagnosis.height_support.reason:report.diagnosis.code==='insufficient_terrain_data'?'Faltan mediciones de terreno; los datos ausentes no permiten demostrar que ninguna zona pueda cumplir.':terrain?'Hay sectores con pendiente compatible, pero sus horizontes no tienen cobertura suficiente. Cambiar la fecha no sustituye los datos ausentes.':'Ningún sector preparado cumple la pendiente solicitada. Cambiar la fecha no modifica el terreno.'
 return report
}
export function validateBatch(batch,target,start,end){
 if(batch?.status!=='ok'||batch.target!==target||batch.meta?.latitude_deg!==-90||batch.meta?.longitude_deg!==0||!batch.meta?.query_url?.startsWith('https://ssd.jpl.nasa.gov/api/horizons.api?')||batch.samples?.length!==(end-start)/H+1)throw new ScienceError('La consulta NASA no cubre toda la búsqueda.',503)
 for(let i=0;i<batch.samples.length;i++){
  const s=batch.samples[i]
  if(s.t_utc!==iso(start+i*H)||![s.azimuth_deg,s.elevation_deg,s.range_km].every(finite)||s.range_km<=0)throw new ScienceError('La búsqueda recibió una serie NASA incompleta o desalineada.',503)
 }
 return batch
}
export function sliceBatch(batch,start,end){
 const offset=(start-Date.parse(batch.samples[0].t_utc))/H,length=(end-start)/H
 if(!Number.isInteger(offset)||!Number.isInteger(length)||offset<0||offset+length>=batch.samples.length)throw new ScienceError('La ventana no coincide con el muestreo horario NASA; no se interpola una solución.',503)
 return {...batch,samples:batch.samples.slice(offset,offset+length+1),meta:{...batch.meta,selection_start_utc:iso(start),selection_end_utc:iso(end),selection_first_sample:offset,selection_last_sample:offset+length}}
}
function diagnosisFor(result,initial){
 const reasons=[
  ['sun_arrival','Sol sin despeje suficiente al llegar.',c=>c.arrival_margin_sensitivity?.sun_lower_deg<=.3],
  ['earth_arrival','Tierra sin despeje suficiente al llegar.',c=>c.arrival_margin_sensitivity?.earth_lower_deg<=.3],
  ['sun_duration','Horas de Sol insuficientes con el horizonte conservador.',c=>c.sun_hours_sensitivity?.lower<initial.min_sun_hours],
  ['earth_duration','Horas de Tierra visible insuficientes con el horizonte conservador.',c=>c.earth_hours_sensitivity?.lower<initial.min_earth_hours]
 ]
 return {original_green:result.counts.green,original_yellow:result.counts.yellow,blocker_scope:'terrain-and-horizon-eligible-centers',blockers:reasons.map(([code,label,predicate])=>({code,label,count:result.cells.filter(predicate).length})).filter(row=>row.count>0),
  summary:result.best?'La fecha original ya contiene un candidato que cumple el modelo regional.':'La pendiente compatible no basta en esta fecha: se buscan otros instantes con Sol y Tierra sobre el horizonte, manteniendo tus requisitos.'}
}
function quality(scenario){
 const b=scenario.result.best
 return [Math.min(b.sun_hours_sensitivity.lower,b.earth_hours_sensitivity.lower),Math.min(b.arrival_margin_sensitivity.sun_lower_deg,b.arrival_margin_sensitivity.earth_lower_deg),-Math.max(b.longest_dark_hours,b.longest_earth_hidden_hours)]
}
function compareQuality(a,b){const x=quality(a),y=quality(b);return y[0]-x[0]||y[1]-x[1]||y[2]-x[2]||a.offset-b.offset}
function proposalsFor(successes,sources){
 const ordered=[...successes].sort((a,b)=>a.offset-b.offset),picked=[]
 if(ordered.length)picked.push(ordered[0])
 if(ordered.length>1){
  const candidates=ordered.filter(c=>Math.abs(c.offset-picked[0].offset)>=12)
  picked.push(...(candidates.length?candidates:ordered.slice(1)).sort(compareQuality).slice(0,1))
 }
 if(picked.length<3){
  const remaining=ordered.filter(c=>!picked.includes(c)),separate=remaining.filter(c=>picked.every(p=>Math.abs(p.offset-c.offset)>=12))
  if(separate[0]||remaining[0])picked.push(separate[0]??remaining[0])
 }
 return picked.map((scenario,index)=>({id:'rescue:'+scenario.request.departure_utc,label:index===0?'Menor cambio encontrado':index===1?'Otra opción con buen margen':'Otra ventana compatible',
  proposed_request:scenario.request,delta_hours:scenario.offset,mission:scenario.result.mission,best:scenario.result.best,counts:scenario.result.counts,counts_scope:'terrain-and-horizon-eligible-centers',criteria_preserved:true,
  changes:scenario.offset===0?[]:['Cambiar '+(scenario.request.date_kind==='landing'?'el alunizaje':'la salida')+' '+scenario.offset+' horas.'],
  sources}))
}
/** Pure scientific search over three already-validated original JPL batches. */
export function evaluateRescue(request,resources,batches){
 const {q,search_days:days}=validateRescueRequest(request),selection=selectRescueResources(resources,q),report=baseReport(q,days,selection)
 if(!selection.diagnosis.horizon_eligible_cells)return blockedReport(report)
 const start=Date.parse(q.departure_utc),last=start+days*24*H
 const anchor=validateBatch(batches.anchor,'Earth',start,last+H),anchorAt=new Map(anchor.samples.map(s=>[s.t_utc,s]))
 const coarse=Array.from({length:days+1},(_,i)=>i*24)
 // Every possible hourly refinement uses the measured Earth range at that same requested instant.
 const timingByOffset=new Map()
 for(let offset=0;offset<=days*24;offset++){
  const requested={...q,departure_utc:iso(start+offset*H)},sample=anchorAt.get(requested.departure_utc)
  if(!sample)throw new ScienceError('Falta la distancia NASA de un instante de búsqueda.',503)
  const transfer=estimateTransfer(sample),mission=missionTiming(requested,transfer)
  timingByOffset.set(offset,{requested,transfer,mission})
 }
 const values=[...timingByOffset.values()],minArrival=Math.min(...values.map(v=>Date.parse(v.mission.arrival_utc))),maxEnd=Math.max(...values.map(v=>Date.parse(v.mission.surface_end_utc)))
 validateBatch(batches.sun,'Sun',minArrival,maxEnd);validateBatch(batches.earth,'Earth',minArrival,maxEnd)
 const sources=[batches.anchor.meta,batches.sun.meta,batches.earth.meta]
 report.meta.sources=sources
 report.search.arrival_start_utc=iso(minArrival);report.search.arrival_end_utc=iso(maxEnd)
 const scenarios=new Map()
 function test(offset){
  if(scenarios.has(offset))return scenarios.get(offset)
  const timing=timingByOffset.get(offset),a=Date.parse(timing.mission.arrival_utc),end=Date.parse(timing.mission.surface_end_utc)
  const full=evaluateGlobalPlan(timing.requested,selection.resources,{sun:sliceBatch(batches.sun,a,end),earth:sliceBatch(batches.earth,a,end),transfer_source:batches.anchor.meta},timing.transfer)
  if(offset===0)Object.assign(report.diagnosis,diagnosisFor(full,q))
  // Release regional row tables after each scenario; retaining 38 full tables
  // would exceed the memory budget of a hosted Worker.
  const result={best:full.best,counts:full.counts,mission:full.mission}
  const scenario={offset,request:timing.requested,result};scenarios.set(offset,scenario);return scenario
 }
 for(const offset of coarse)test(offset)
 const coarsePass=coarse.find(offset=>scenarios.get(offset).result.best)
 if(coarsePass!==undefined){
  report.search.first_coarse_passing_offset_hours=coarsePass
  for(let offset=Math.max(0,coarsePass-23);offset<coarsePass;offset++)test(offset)
 }
 report.search.tested_offsets_hours=[...scenarios.keys()].sort((a,b)=>a-b);report.search.tested_scenarios=scenarios.size
 report.search.refined_interval_hours=coarsePass===undefined?null:[Math.max(0,coarsePass-23),coarsePass]
 const passing=[...scenarios.values()].filter(scenario=>scenario.result.best)
 report.proposals=proposalsFor(passing,sources);report.status=report.proposals.length?'found':'none'
 return report
}
async function fetchBatches(q,days,get){
 const start=Date.parse(q.departure_utc),last=start+days*24*H,anchor=await get('Earth',iso(start),iso(last+H))
 validateBatch(anchor,'Earth',start,last+H)
 const times=anchor.samples.slice(0,-1).map((sample,offset)=>missionTiming({...q,departure_utc:iso(start+offset*H)},estimateTransfer(sample)))
 const min=Math.min(...times.map(m=>Date.parse(m.arrival_utc))),max=Math.max(...times.map(m=>Date.parse(m.surface_end_utc)))
 if(max-min>31*24*H)throw new ScienceError('La ventana NASA necesaria supera el límite de 31 días.',422)
 const sun=await get('Sun',iso(min),iso(max)),earth=await get('Earth',iso(min),iso(max))
 return {anchor,sun,earth}
}
export async function searchMissionRescue(input,resources,get){
 const {q,search_days:days}=validateRescueRequest(input),selection=selectRescueResources(resources,q)
 if(!selection.diagnosis.horizon_eligible_cells)return blockedReport(baseReport(q,days,selection))
 const batches=await fetchBatches(q,days,get)
 return evaluateRescue({...q,search_days:days},resources,batches)
}
export function createMissionRescueApi(resources){
 const science=createScienceApi({...resources,sites:{sites:[REFERENCE]}})
 return async function rescue(request,ctx){
  const url=new URL(request.url)
  if(url.pathname!=='/api/mission-rescue')return null
  const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}})
  if(request.method!=='POST')return json({status:'unavailable',message:'POST requerido.'},405)
  try{
   if(!request.headers.get('content-type')?.includes('application/json'))throw new ScienceError('Usa application/json.',415)
   const reader=request.body?.getReader();if(!reader)throw new ScienceError('Petición vacía.')
   let size=0,text='',decoder=new TextDecoder()
   while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>16384){await reader.cancel();throw new ScienceError('Petición demasiado grande.',413)}text+=decoder.decode(part.value,{stream:true})}
   let body;try{body=JSON.parse(text+decoder.decode())}catch{throw new ScienceError('JSON no válido.')}
   const result=await searchMissionRescue(body,resources,async(target,start,end)=>{
    const u=new URL(target==='Sun'?'/api/solar':'/api/earth',url)
    u.search=new URLSearchParams({site_id:REFERENCE.id,start_utc:start,end_utc:end,step_minutes:'60',observer_height_m:'2',horizon_mode:'flat',include_range:'true'}).toString()
    const response=await science(new Request(u),ctx),data=await response.json()
    if(!response.ok)throw new ScienceError(data.message??'NASA no está disponible.',response.status)
    return data
   })
   return json(result)
  }catch(error){return json({status:'unavailable',criteria_preserved:true,proposals:[],message:error instanceof Error?error.message:'No se pudieron buscar alternativas con NASA.'},error instanceof ScienceError?error.status:503)}
 }
}
