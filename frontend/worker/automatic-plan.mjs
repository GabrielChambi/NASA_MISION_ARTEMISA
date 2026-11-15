/** Whole-cap regional mission planning. All sky samples are traceable JPL data.
 * The transfer is a labelled two-body estimate, not a launch solution.
 */
import { createScienceApi, ScienceError } from './science.mjs'
const HOUR=3600000,R=1737400,RAD=Math.PI/180
export const REFERENCE={id:'automatic-south-pole',latitude_deg:-90,longitude_deg:0,elevation_m:0}
export const PLAN_LIMITATIONS=[
 'Cribado regional del DEM NASA de 80 m agregado en zonas de 4,75 km; no certifica huella ni obstáculos locales.',
 'Horizontes propios de cada zona, muestreados cada 5 grados hasta 250 km; cobertura distante parcial.',
 'Las direcciones se trasladan geométricamente desde un observador JPL lunar; no son soluciones SPICE independientes por zona.',
 'La duración de tránsito es una transferencia de dos cuerpos desde órbita terrestre de 200 km; no calcula ventana de lanzamiento, guiado ni combustible.',
 'El retorno usa la misma duración estimada de ida; no se ha calculado una trayectoria de regreso.',
 'Visibilidad geométrica del centro del Sol/Tierra; sin energía eléctrica, temperatura ni presupuesto RF.',
 'La cadencia horaria limita la precisión de las transiciones; no se extrapolan datos desconocidos.'
]
const iso=t=>new Date(t).toISOString().slice(0,19)+'Z'
const finite=(x,min,max)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max
export function validatePlanRequest(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new ScienceError('Define los parámetros de la misión.')
 const text=input.departure_utc
 if(typeof text!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:00Z$/.test(text))throw new ScienceError('La fecha debe incluir UTC explícito y minutos completos.')
 const start=Date.parse(text)
 if(!Number.isFinite(start)||iso(start)!==text||new Date(start).getUTCFullYear()<1962||new Date(start).getUTCFullYear()>2099)throw new ScienceError('La fecha UTC no es válida o queda fuera de 1962–2099.')
 const q={departure_utc:text,date_kind:input.date_kind??'departure',surface_hours:input.surface_hours??72,max_slope_deg:input.max_slope_deg??10,
  min_sun_hours:input.min_sun_hours??12,min_earth_hours:input.min_earth_hours??12,observer_height_m:input.observer_height_m??2}
 if(!['departure','landing'].includes(q.date_kind)||!Number.isInteger(q.surface_hours)||!finite(q.surface_hours,1,336)||!finite(q.max_slope_deg,0,45)||!finite(q.min_sun_hours,0,q.surface_hours)||!finite(q.min_earth_hours,0,q.surface_hours)||q.observer_height_m!==2)throw new ScienceError('Revisa duración (1–336 h), pendiente (0–45°), horas requeridas y altura de observador (2 m).')
 return q
}
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2]
function frame(lat,lon){const p=lat*RAD,l=lon*RAD;return {east:[-Math.sin(l),Math.cos(l),0],north:[-Math.sin(p)*Math.cos(l),-Math.sin(p)*Math.sin(l),Math.cos(p)],up:[Math.cos(p)*Math.cos(l),Math.cos(p)*Math.sin(l),Math.sin(p)]}}
export function bodyPosition(sample,reference=REFERENCE){
 if(!sample||![sample.azimuth_deg,sample.elevation_deg,sample.range_km].every(Number.isFinite)||sample.range_km<=0)throw new ScienceError('Faltan ángulos o distancia de NASA.',503)
 const f=frame(reference.latitude_deg,reference.longitude_deg),a=sample.azimuth_deg*RAD,e=sample.elevation_deg*RAD,d=sample.range_km*1000
 return f.up.map((u,i)=>u*(R+reference.elevation_m+2)+d*(f.east[i]*Math.sin(a)*Math.cos(e)+f.north[i]*Math.cos(a)*Math.cos(e)+u*Math.sin(e)))
}
function angles(position,f,elevation){
 const v=position.map((x,i)=>x-f.up[i]*(R+elevation+2)),east=dot(v,f.east),north=dot(v,f.north)
 return {azimuth_deg:(Math.atan2(east,north)/RAD+360)%360,elevation_deg:Math.atan2(dot(v,f.up),Math.hypot(east,north))/RAD}
}
export function estimateTransfer(earthSample){
 const p=bodyPosition(earthSample),distance=Math.hypot(...p)/1000
 if(!finite(distance,300000,450000))throw new ScienceError('La distancia Tierra–Luna NASA queda fuera del rango válido.',503)
 const r1=6378.1366+200,mu=398600.435507,seconds=Math.PI*Math.sqrt(((r1+distance)/2)**3/mu)
 return {method:'TWO_BODY_ESTIMATE',earth_moon_distance_km:distance,parking_orbit_altitude_km:200,earth_gm_km3_s2:mu,transfer_hours:seconds/3600,
  source_url:'https://ssd.jpl.nasa.gov/astro_par.html',assumptions:['Transferencia elíptica ideal de dos cuerpos.','No es una trayectoria Artemis ni una ventana de lanzamiento.','Regreso simétrico sólo para estimar la duración total.']}
}
export function missionTiming(q,transfer){
 const requested=Date.parse(q.departure_utc),duration=transfer.transfer_hours*HOUR
 const arrival=q.date_kind==='landing'?requested:Math.ceil((requested+duration)/HOUR)*HOUR
 const departure=q.date_kind==='landing'?arrival-duration:requested,end=arrival+q.surface_hours*HOUR,back=end+duration
 return {date_kind:q.date_kind,requested_utc:q.departure_utc,departure_utc:iso(departure),arrival_utc:iso(arrival),surface_end_utc:iso(end),return_utc:iso(back),
  outbound_hours:(arrival-departure)/HOUR,surface_hours:q.surface_hours,return_hours:transfer.transfer_hours,total_hours:(back-departure)/HOUR,
  arrival_rounding_minutes:q.date_kind==='departure'?(arrival-requested-duration)/60000:0,transfer_model:transfer,assumptions:transfer.assumptions}
}
export function horizonValue(profile,azimuth,quant=.05){
 if(!Array.isArray(profile)||profile.length!==72||profile.some(v=>!Number.isFinite(v)))return NaN
 return interpolateProfile(profile,azimuth,quant)
}
function interpolateProfile(profile,azimuth,quant){
 const p=((azimuth%360+360)%360)/5,i=Math.floor(p),fraction=p-i
 return (profile[i]* (1-fraction)+profile[(i+1)%72]*fraction)*quant
}
function validateSky(result,target,timing){
 if(result?.status!=='ok'||result.target!==target||result.meta?.latitude_deg!==-90||result.meta?.longitude_deg!==0||!result.meta?.query_url?.startsWith('https://ssd.jpl.nasa.gov/api/horizons.api?')||result.samples?.length!==timing.surface_hours+1)throw new ScienceError('NASA devolvió un observador o una serie incompleta.',503)
 const start=Date.parse(timing.arrival_utc)
 for(let i=0;i<result.samples.length;i++){const s=result.samples[i];if(Date.parse(s.t_utc)!==start+i*HOUR||![s.azimuth_deg,s.elevation_deg,s.range_km].every(Number.isFinite)||s.range_km<=0)throw new ScienceError('La serie NASA no está alineada o tiene valores desconocidos.',503)}
}
const rounded=(v,d=3)=>Number(v.toFixed(d))
function circleSample(c){return {id:c.id,name:'Sector '+Math.abs(c.latitude_deg).toFixed(2)+'°S · '+c.longitude_deg.toFixed(2)+'°E',latitude_deg:c.latitude_deg,longitude_deg:c.longitude_deg,elevation_m:c.elevation_m,regional_slope_deg:c.regional_slope_deg}}
function separated(candidates,limit,minDistance){
 const selected=[]
 for(const c of candidates){if(selected.every(s=>Math.hypot(s.x_m-c.x_m,s.y_m-c.y_m)>=minDistance)){selected.push(c);if(selected.length===limit)break}}
 return selected
}
function timelineFor(cell,profile,sky,h){
 const f=frame(cell.latitude_deg,cell.longitude_deg)
 return sky.sun.samples.map((s,i)=>{
  const sun=angles(bodyPosition(s),f,cell.elevation_m),earth=angles(bodyPosition(sky.earth.samples[i]),f,cell.elevation_m)
  return {t_utc:s.t_utc,sun_azimuth_deg:rounded(sun.azimuth_deg),sun_elevation_deg:rounded(sun.elevation_deg),sun_horizon_deg:rounded(horizonValue(profile,sun.azimuth_deg,h.quantization_deg)),
   earth_azimuth_deg:rounded(earth.azimuth_deg),earth_elevation_deg:rounded(earth.elevation_deg),earth_horizon_deg:rounded(horizonValue(profile,earth.azimuth_deg,h.quantization_deg))}
 })
}
export function decodeProfile(values,encoding){
 if(values==null)return null
 if(!Array.isArray(values)||values.length!==72||values.some(v=>!Number.isFinite(v)))return null
 if(encoding!==undefined&&encoding!=='absolute'&&encoding!=='delta')throw new ScienceError('Codificación de horizontes no compatible.',503)
 if(encoding!=='delta')return values
 let sum=0;return values.map(value=>(sum+=value))
}
export function evaluateGlobalPlan(request,resources,sky,transfer){
 const q=validatePlanRequest(request),mission=missionTiming(q,transfer),polar=resources.polar,h=resources.globalHorizons
 if(!polar?.cells?.length||h?.version!==1||h.observer_height_m!==2||h.azimuth_step_deg!==5||h.source_sha256!==polar.source_sha256||h.cell_ids?.length!==h.profiles_int?.length||h.cell_ids?.length!==h.ray_coverage_min_per_mille?.length||h.cell_ids?.length!==h.valid_to_min_m?.length||!finite(h.quantization_deg,.001,1)||h.radius_m!==R)throw new ScienceError('Los horizontes regionales NASA no están preparados o no corresponden al terreno.',503)
 validateSky(sky.sun,'Sun',mission);validateSky(sky.earth,'Earth',mission)
 const profiles=new Map(h.cell_ids.map((id,i)=>[id,{values:decodeProfile(h.profiles_int[i],h.profile_encoding),coverage:h.ray_coverage_min_per_mille?.[i],valid_to:h.valid_to_min_m?.[i]}]))
 const sunPositions=sky.sun.samples.map(s=>bodyPosition(s)),earthPositions=sky.earth.samples.map(s=>bodyPosition(s))
 const results=[],counts={green:0,red:0,unknown:0},margin=.3
 for(const c of polar.cells){
  if(c.latitude_deg> -80)continue
  const row={...circleSample(c),x_m:c.x_m,y_m:c.y_m,risk:'unknown',reason:'Datos de terreno desconocidos.',reasons:[],sun_hours:null,earth_hours:null,joint_hours:null,sun_margin_deg:null,earth_margin_deg:null,longest_dark_hours:null,longest_earth_hidden_hours:null,score:null,horizon_quality:h.quality}
  if(!c.known||![c.elevation_m,c.regional_slope_deg,c.max_slope_deg].every(Number.isFinite)){row.reasons=[row.reason];counts.unknown++;results.push(row);continue}
  if(c.regional_slope_deg>q.max_slope_deg){row.risk='red';row.reason='Pendiente regional por encima del límite.';row.reasons=[row.reason];counts.red++;results.push(row);continue}
  const p=profiles.get(c.id)
  if(!p?.values||p.values.length!==72||p.values.some(v=>!Number.isFinite(v))||(!Number.isFinite(p.valid_to)||p.valid_to<20000)){row.reason='Cobertura del horizonte inferior a 20 km; faltan obstáculos distantes.';row.reasons=[row.reason];counts.unknown++;results.push(row);continue}
  const f=frame(c.latitude_deg,c.longitude_deg)
  let sh=0,eh=0,jh=0,dark=0,hidden=0,maxDark=0,maxHidden=0,firstSun=null,firstEarth=null
  for(let i=0;i<mission.surface_hours;i++){
   const s=angles(sunPositions[i],f,c.elevation_m),e=angles(earthPositions[i],f,c.elevation_m)
   const sm=s.elevation_deg-interpolateProfile(p.values,s.azimuth_deg,h.quantization_deg),em=e.elevation_deg-interpolateProfile(p.values,e.azimuth_deg,h.quantization_deg)
   if(i===0){firstSun=sm;firstEarth=em}
   const sv=sm>margin,ev=em>margin
   if(sv){sh++;dark=0}else{dark++;maxDark=Math.max(maxDark,dark)}
   if(ev){eh++;hidden=0}else{hidden++;maxHidden=Math.max(maxHidden,hidden)}
   if(sv&&ev)jh++
  }
  const reasons=[]
  if(firstSun<=margin)reasons.push('Sol sin despeje suficiente al llegar.')
  if(firstEarth<=margin)reasons.push('Tierra sin despeje suficiente al llegar.')
  if(sh<q.min_sun_hours)reasons.push('Horas de Sol insuficientes.')
  if(eh<q.min_earth_hours)reasons.push('Horas de Tierra visible insuficientes.')
  const quality=Math.min(sh/mission.surface_hours,eh/mission.surface_hours)
  Object.assign(row,{risk:reasons.length?'red':'green',reason:reasons[0]??'Cumple el modelo regional en la fecha y duración evaluadas.',reasons:reasons.length?reasons:['Cumple los criterios regionales calculados.'],sun_hours:sh,earth_hours:eh,joint_hours:jh,sun_margin_deg:rounded(firstSun),earth_margin_deg:rounded(firstEarth),longest_dark_hours:maxDark,longest_earth_hidden_hours:maxHidden,
   score:rounded(quality*100),horizon_coverage_min:p.coverage/1000})
  counts[row.risk]++;results.push(row)
 }
 const ranked=results.filter(c=>Number.isFinite(c.score)).sort((a,b)=>((a.risk==='green'?0:1)-(b.risk==='green'?0:1))||(Math.min(b.sun_hours,b.earth_hours)-Math.min(a.sun_hours,a.earth_hours))||(Math.max(a.longest_dark_hours,a.longest_earth_hidden_hours)-Math.max(b.longest_dark_hours,b.longest_earth_hidden_hours))||(Math.min(b.sun_margin_deg,b.earth_margin_deg)-Math.min(a.sun_margin_deg,a.earth_margin_deg))||(a.regional_slope_deg-b.regional_slope_deg)||a.id.localeCompare(b.id))
 const green=separated(ranked.filter(c=>c.risk==='green'),5,30000)
 const red=separated(results.filter(c=>c.risk==='red').sort((a,b)=>(b.regional_slope_deg??0)-(a.regional_slope_deg??0)||a.id.localeCompare(b.id)),8,50000)
 const best=green[0]??null,closest=best?null:ranked[0]??null
 const attach=c=>c?{...c,time_series:timelineFor(c,profiles.get(c.id).values,sky,h)}:null
 return {status:'ok',mission,best:attach(best),closest_candidate:attach(closest),alternatives:green.slice(1,4).map(attach),rejected:red,counts,total_cells:results.length,
  cells:results.map(c=>({id:c.id,risk:c.risk,reason:c.reason,sun_hours:c.sun_hours,earth_hours:c.earth_hours,joint_hours:c.joint_hours,sun_margin_deg:c.sun_margin_deg,earth_margin_deg:c.earth_margin_deg,score:c.score})),
  meta:{generated_at:new Date().toISOString(),source_resolution_m:80,regional_cell_spacing_m:polar.cell_spacing_m,horizon_quality:h.quality,horizon_azimuth_step_deg:5,observer_height_m:2,temporal_step_minutes:60,arrival_clearance_deg:margin,minimum_horizon_coverage_m:20000,terrain_source_sha256:polar.source_sha256,score_definition:'100 × menor fracción de horas con Sol/Tierra. Los empates se resuelven con interrupciones, margen y pendiente.',
   ranking:'Cumplimiento primero, luego peor fracción de Sol/Tierra, mayor interrupción, margen al llegar y pendiente; alternativas separadas al menos 30 km.',sources:[sky.sun.meta,sky.earth.meta,sky.transfer_source].filter(Boolean),limitations:[...PLAN_LIMITATIONS,...(h.limitations??[])]}}
}
export function createAutomaticPlanApi(resources){
 const api=createScienceApi({...resources,sites:{sites:[REFERENCE]}})
 return async function automatic(request,ctx){
  const url=new URL(request.url)
  if(url.pathname!=='/api/automatic-plan')return null
  const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}})
  if(request.method!=='POST')return json({status:'unavailable',message:'POST requerido.'},405)
  try{
   if(!request.headers.get('content-type')?.includes('application/json'))throw new ScienceError('Usa application/json.',415)
   const reader=request.body?.getReader();if(!reader)throw new ScienceError('La petición está vacía.')
   let size=0,text='',decoder=new TextDecoder()
   while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>16384){await reader.cancel();throw new ScienceError('La petición supera el tamaño permitido.',413)}text+=decoder.decode(part.value,{stream:true})}
   let raw;try{raw=JSON.parse(text+decoder.decode())}catch{throw new ScienceError('JSON no válido.')}
   const q=validatePlanRequest(raw)
   const get=async(target,start,end)=>{
    const u=new URL(target==='Sun'?'/api/solar':'/api/earth',url)
    u.search=new URLSearchParams({site_id:REFERENCE.id,start_utc:start,end_utc:end,step_minutes:'60',observer_height_m:'2',horizon_mode:'flat',include_range:'true'}).toString()
    const response=await api(new Request(u),ctx),result=await response.json()
    if(!response.ok)throw new ScienceError(result.message??'NASA no está disponible.',response.status)
    return result
   }
   const anchor=await get('Earth',q.departure_utc,iso(Date.parse(q.departure_utc)+HOUR))
   const transfer=estimateTransfer(anchor.samples[0]),timing=missionTiming(q,transfer)
   const sun=await get('Sun',timing.arrival_utc,timing.surface_end_utc)
   const earth=await get('Earth',timing.arrival_utc,timing.surface_end_utc)
   return json(evaluateGlobalPlan(q,resources,{sun,earth,transfer_source:anchor.meta},transfer))
  }catch(e){return json({status:'unavailable',message:e instanceof Error?e.message:'No se pudo calcular la misión.'},e instanceof ScienceError?e.status:503)}
 }
}
