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

// Eight-point Gauss-Legendre quadrature over the spherical stereographic
// inverse-area Jacobian. Boundary cells are clipped to the 80 S cap.
const GLX=[-.9602898564975363,-.7966664774136267,-.525532409916329,-.1834346424956498,.1834346424956498,.525532409916329,.7966664774136267,.9602898564975363]
const GLW=[.1012285362903763,.2223810344533745,.3137066458778873,.362683783378362,.362683783378362,.3137066458778873,.2223810344533745,.1012285362903763]
export function stereographicCellArea(x,y,spacing,radius=R,capLatitude=-80){
 if(![x,y,spacing,radius].every(Number.isFinite)||spacing<=0||radius<=0)return 0
 const cap=2*radius*Math.tan((90+capLatitude)*RAD/2),half=spacing/2
 const left=Math.max(-cap,x-half),right=Math.min(cap,x+half),bottom=y-half,top=y+half
 if(right<=left||bottom>=cap||top<=-cap)return 0
 const nearestX=Math.max(Math.abs(x)-half,0),nearestY=Math.max(Math.abs(y)-half,0)
 if(nearestX*nearestX+nearestY*nearestY>=cap*cap)return 0
 const cuts=[left,right]
 for(const edge of [bottom,top])if(Math.abs(edge)<cap){const crossing=Math.sqrt(cap*cap-edge*edge);for(const k of [-crossing,crossing])if(k>left&&k<right)cuts.push(k)}
 cuts.sort((a,b)=>a-b)
 const scale=16*radius**4
 const primitive=(z,a)=>z/(2*a*(a+z*z))+Math.atan(z/Math.sqrt(a))/(2*a**1.5)
 let area=0
 for(let interval=1;interval<cuts.length;interval++){
  const middle=(cuts[interval]+cuts[interval-1])/2,width=(cuts[interval]-cuts[interval-1])/2
  for(let i=0;i<8;i++){
   const xx=middle+width*GLX[i],rim=Math.sqrt(Math.max(0,cap*cap-xx*xx)),lo=Math.max(bottom,-rim),hi=Math.min(top,rim)
   if(hi<=lo)continue
   const a=4*radius*radius+xx*xx
   area+=width*GLW[i]*scale*(primitive(hi,a)-primitive(lo,a))
  }
 }
 return Math.max(0,area/1e6)
}
export function horizonSensitivity(profile,azimuth,quant=.05){
 if(!Array.isArray(profile)||profile.length!==72||profile.some(v=>!Number.isFinite(v)))return null
 const p=((azimuth%360+360)%360)/5,i=Math.floor(p),f=p-i,a=profile[i]*quant,b=profile[(i+1)%72]*quant
 return {nominal:a*(1-f)+b*f,lower:Math.min(a,b)-quant,upper:Math.max(a,b)}
}
function fastAngles(position,f,elevation){
 const east=dot(position,f.east),north=dot(position,f.north),up=dot(position,f.up)-(R+elevation+2)
 return {azimuth_deg:(Math.atan2(east,north)/RAD+360)%360,elevation_deg:Math.atan2(up,Math.hypot(east,north))/RAD}
}
function unvalidatedSensitivity(profile,azimuth,quant){
 const p=((azimuth%360+360)%360)/5,i=Math.floor(p),f=p-i,a=profile[i]*quant,b=profile[(i+1)%72]*quant
 return [a*(1-f)+b*f,Math.min(a,b)-quant,Math.max(a,b)]
}
function timeMetrics(c,p,positions,hours,quant,margin){
 const f=frame(c.latitude_deg,c.longitude_deg)
 const m={sun_hours:0,earth_hours:0,joint_hours:0,longest_dark_hours:0,longest_earth_hidden_hours:0,sun_margin_deg:null,earth_margin_deg:null,
  sun_hours_sensitivity:{lower:0,upper:0},earth_hours_sensitivity:{lower:0,upper:0},arrival_margin_sensitivity:{sun_lower_deg:0,sun_upper_deg:0,earth_lower_deg:0,earth_upper_deg:0}}
 let dark=0,hidden=0
 for(let i=0;i<hours;i++){
  const s=fastAngles(positions.sun[i],f,c.elevation_m),e=fastAngles(positions.earth[i],f,c.elevation_m)
  const sh=unvalidatedSensitivity(p.values,s.azimuth_deg,quant),eh=unvalidatedSensitivity(p.values,e.azimuth_deg,quant)
  const sm=s.elevation_deg-sh[0],em=e.elevation_deg-eh[0],sv=sm>margin,ev=em>margin
  if(i===0){
   m.sun_margin_deg=sm;m.earth_margin_deg=em
   m.arrival_margin_sensitivity={sun_lower_deg:s.elevation_deg-sh[2],sun_upper_deg:s.elevation_deg-sh[1],earth_lower_deg:e.elevation_deg-eh[2],earth_upper_deg:e.elevation_deg-eh[1]}
  }
  if(sv){m.sun_hours++;dark=0}else{dark++;m.longest_dark_hours=Math.max(m.longest_dark_hours,dark)}
  if(ev){m.earth_hours++;hidden=0}else{hidden++;m.longest_earth_hidden_hours=Math.max(m.longest_earth_hidden_hours,hidden)}
  if(sv&&ev)m.joint_hours++
  if(s.elevation_deg-sh[2]>margin)m.sun_hours_sensitivity.lower++
  if(s.elevation_deg-sh[1]>margin)m.sun_hours_sensitivity.upper++
  if(e.elevation_deg-eh[2]>margin)m.earth_hours_sensitivity.lower++
  if(e.elevation_deg-eh[1]>margin)m.earth_hours_sensitivity.upper++
 }
 return m
}
function validateResources(resources){
 const polar=resources.polar,h=resources.globalHorizons
 if(!polar?.cells?.length||h?.version!==1||h.observer_height_m!==2||h.azimuth_step_deg!==5||h.source_sha256!==polar.source_sha256||h.cell_ids?.length!==h.profiles_int?.length||h.cell_ids?.length!==h.ray_coverage_min_per_mille?.length||h.cell_ids?.length!==h.valid_to_min_m?.length||!finite(h.quantization_deg,.001,1)||h.radius_m!==R)throw new ScienceError('Los horizontes regionales NASA no están preparados o no corresponden al terreno.',503)
 if(new Set(h.cell_ids).size!==h.cell_ids.length)throw new ScienceError('Los horizontes regionales contienen celdas duplicadas.',503)
 return {polar,h}
}
function profileIndex(h,onlyId){return new Map(h.cell_ids.flatMap((id,i)=>onlyId!==undefined&&id!==onlyId?[]:[[id,{values:decodeProfile(h.profiles_int[i],h.profile_encoding),coverage:h.ray_coverage_min_per_mille[i],valid_to:h.valid_to_min_m[i]}]]))}
function evaluateCell(c,p,q,positions,h,spacing){
 const row={id:c.id,row:c.row??null,col:c.col??null,x_m:c.x_m,y_m:c.y_m,latitude_deg:c.latitude_deg,longitude_deg:c.longitude_deg,elevation_m:c.elevation_m,
  regional_slope_deg:c.regional_slope_deg,max_slope_deg:c.max_slope_deg,median_slope_deg:c.median_slope_deg??null,
  roughness_m:c.roughness_m??null,relief_m:c.relief_m??null,coverage_fraction:c.coverage_fraction??(c.known?1:0),
  area_km2:rounded(stereographicCellArea(c.x_m,c.y_m,spacing),6),risk:'unknown',reason:'Datos de terreno desconocidos.',reasons:[],score:null,
  sun_hours:null,earth_hours:null,joint_hours:null,sun_margin_deg:null,earth_margin_deg:null,longest_dark_hours:null,longest_earth_hidden_hours:null,
  nominal_pass:false,sensitivity_pass:false,horizon_quality:h.quality,horizon_coverage_min:Number.isFinite(p?.coverage)?p.coverage/1000:null,horizon_min_distance_m:p?.valid_to??null}
 if(c.latitude_deg> -80||c.latitude_deg< -90){row.reason='Borde del casquete sin perfil de observador preparado; no se extiende el resultado vecino.';row.reasons=[row.reason];return row}
 if(!c.known||![c.elevation_m,c.regional_slope_deg,c.max_slope_deg].every(Number.isFinite)){row.reasons=[row.reason];return row}
 const terrainFailed=c.regional_slope_deg>q.max_slope_deg
 const profileKnown=p?.values?.length===72&&p.values.every(Number.isFinite)&&finite(p.valid_to,20000,250000)
 if(!profileKnown){
  row.risk=terrainFailed?'red':'unknown';row.reason=terrainFailed?'Pendiente regional por encima del límite.':'Cobertura del horizonte inferior a 20 km; faltan obstáculos distantes.'
  row.reasons=[row.reason];return row
 }
 const m=timeMetrics(c,p,positions,q.surface_hours,h.quantization_deg,.3)
 Object.assign(row,m)
 const reasons=[]
 if(terrainFailed)reasons.push('Pendiente regional por encima del límite.')
 if(m.sun_margin_deg<=.3)reasons.push('Sol sin despeje suficiente al llegar.')
 if(m.earth_margin_deg<=.3)reasons.push('Tierra sin despeje suficiente al llegar.')
 if(m.sun_hours<q.min_sun_hours)reasons.push('Horas de Sol insuficientes.')
 if(m.earth_hours<q.min_earth_hours)reasons.push('Horas de Tierra visible insuficientes.')
 const a=m.arrival_margin_sensitivity,nominal=!reasons.length
 const robust=!terrainFailed&&a.sun_lower_deg>.3&&a.earth_lower_deg>.3&&m.sun_hours_sensitivity.lower>=q.min_sun_hours&&m.earth_hours_sensitivity.lower>=q.min_earth_hours
 const optimistic=!terrainFailed&&a.sun_upper_deg>.3&&a.earth_upper_deg>.3&&m.sun_hours_sensitivity.upper>=q.min_sun_hours&&m.earth_hours_sensitivity.upper>=q.min_earth_hours
 row.risk=robust?'green':nominal||optimistic?'yellow':'red';row.nominal_pass=nominal;row.sensitivity_pass=robust
 row.reason=row.risk==='green'?'Candidato regional que cumple incluso al variar entre los horizontes angulares muestreados.':row.risk==='yellow'?'Resultado sensible al muestreo angular del horizonte; requiere un estudio local.':reasons[0]
 row.reasons=row.risk==='green'?[row.reason]:row.risk==='yellow'?[row.reason,...reasons]:reasons
 row.score=rounded(Math.min(m.sun_hours/q.surface_hours,m.earth_hours/q.surface_hours)*100)
 row.sun_margin_deg=rounded(row.sun_margin_deg,6);row.earth_margin_deg=rounded(row.earth_margin_deg,6)
 row.arrival_margin_sensitivity=Object.fromEntries(Object.entries(a).map(([key,value])=>[key,rounded(value,6)]))
 return row
}
function coverageFor(results,polar){
 const capArea=2*Math.PI*R*R*(1-Math.sin(80*RAD))/1e6,classes=Object.fromEntries(['green','yellow','red','unknown'].map(risk=>[risk,{cells:0,area_km2:0,fraction_of_cap:0}]))
 let represented=0,evaluated=0
 for(const c of results){const area=c.area_km2;represented+=area;classes[c.risk].cells++;classes[c.risk].area_km2+=area;if(c.risk!=='unknown')evaluated+=area}
 const gap=Math.max(0,capArea-represented)
 classes.unknown.area_km2+=gap
 for(const c of Object.values(classes)){c.fraction_of_cap=c.area_km2/capArea;c.area_km2=rounded(c.area_km2,3)}
 return {cap_area_km2:rounded(capArea,3),represented_area_km2:rounded(represented,3),unrepresented_area_km2:rounded(gap,3),evaluated_area_km2:rounded(evaluated,3),
  by_class:classes,source_resolution_m:80,cell_spacing_m:polar.cell_spacing_m,latitude_bounds_deg:[-90,-80],
  area_method:'Spherical inverse-stereographic area Jacobian integrated with 8-point quadrature and clipped to the 80 S cap.',
  scope:'regional-screening-centers',unknown_boundary_included:true}
}
function prepareEvaluation(request,resources,sky,transfer,onlyId){
 const q=validatePlanRequest(request),mission=missionTiming(q,transfer),{polar,h}=validateResources(resources)
 validateSky(sky.sun,'Sun',mission);validateSky(sky.earth,'Earth',mission)
 return {q,mission,polar,h,profiles:profileIndex(h,onlyId),positions:{sun:sky.sun.samples.map(s=>bodyPosition(s)),earth:sky.earth.samples.map(s=>bodyPosition(s))}}
}
function evaluationMeta(p,sky){
 return {generated_at:new Date().toISOString(),source_resolution_m:80,regional_cell_spacing_m:p.polar.cell_spacing_m,horizon_quality:p.h.quality,horizon_azimuth_step_deg:5,
  observer_height_m:2,temporal_step_minutes:60,arrival_clearance_deg:.3,minimum_horizon_coverage_m:20000,terrain_source_sha256:p.polar.source_sha256,
  screening_unit:'4.75 km regional cell represented by its center observer; not a resolved landing footprint.',
  sensitivity_method:'Adjacent 5-degree horizon-bin min/max, including upward-quantization interval of 0.05 degrees; scenario sensitivity, not physical uncertainty bounds.',
  score_definition:'100 × menor fracción nominal de horas con Sol/Tierra. Los empates se resuelven con interrupciones, margen y pendiente.',
  ranking:'Cumplimiento de sensibilidad primero; fracción nominal, interrupciones, margen y pendiente. Alternativas separadas al menos 30 km.',
  sources:[sky.sun.meta,sky.earth.meta,sky.transfer_source].filter(Boolean),limitations:[...PLAN_LIMITATIONS,...(p.h.limitations??[]),
   'La clasificación corresponde al centro y al estadístico regional P95; no certifica cada punto de una celda ni una huella de alunizaje.',
   'Amarillo representa sensibilidad entre azimuts muestreados, no una probabilidad ni una cota de todos los errores; obstáculos entre rayos y error del DEM no están acotados.',
   'El borde no representado por centros preparados permanece desconocido. No se extrapolan las clases vecinas.']}
}
function attachTimeline(row,p,sky){
 const info=p.profiles.get(row.id),profile=info?.values
 return {...row,time_series:profile&&finite(info.valid_to,20000,250000)&&Number.isFinite(row.elevation_m)&&row.latitude_deg<=-80?timelineFor(row,profile,sky,p.h):[]}
}
export function evaluateGlobalPlan(request,resources,sky,transfer){
 const p=prepareEvaluation(request,resources,sky,transfer),results=[],counts={green:0,yellow:0,red:0,unknown:0}
 for(const cell of p.polar.cells){
  if(cell.latitude_deg> -80)continue
  const row=evaluateCell(cell,p.profiles.get(cell.id),p.q,p.positions,p.h,p.polar.cell_spacing_m)
  results.push(row);counts[row.risk]++
 }
 const priorities={green:0,yellow:1,red:2,unknown:3}
 const ranked=results.filter(c=>Number.isFinite(c.score)).sort((a,b)=>priorities[a.risk]-priorities[b.risk]||(Math.min(b.sun_hours,b.earth_hours)-Math.min(a.sun_hours,a.earth_hours))||(Math.max(a.longest_dark_hours,a.longest_earth_hidden_hours)-Math.max(b.longest_dark_hours,b.longest_earth_hidden_hours))||(Math.min(b.sun_margin_deg,b.earth_margin_deg)-Math.min(a.sun_margin_deg,a.earth_margin_deg))||(a.regional_slope_deg-b.regional_slope_deg)||a.id.localeCompare(b.id))
 const green=separated(ranked.filter(c=>c.risk==='green'),5,30000),yellow=separated(ranked.filter(c=>c.risk==='yellow'),3,30000)
 const red=separated(results.filter(c=>c.risk==='red').sort((a,b)=>(b.regional_slope_deg??0)-(a.regional_slope_deg??0)||a.id.localeCompare(b.id)),8,50000)
 const best=green[0]??null,closest=best?null:ranked[0]??null
 return {status:'ok',mission:p.mission,best:best?attachTimeline(best,p,sky):null,closest_candidate:closest?attachTimeline(closest,p,sky):null,
  alternatives:green.slice(1,4).map(c=>attachTimeline(c,p,sky)),caution_candidates:yellow.map(c=>attachTimeline(c,p,sky)),rejected:red,counts,total_cells:results.length,
  cells:results,coverage:coverageFor(results,p.polar),meta:evaluationMeta(p,sky)}
}
export function evaluatePlanCell(request,resources,sky,transfer,cellId){
 const p=prepareEvaluation(request,resources,sky,transfer,cellId)
 const cell=p.polar.cells.find(c=>c.id===cellId)
 if(!cell)throw new ScienceError('La celda solicitada no pertenece al catálogo regional.',404)
 const row=evaluateCell(cell,p.profiles.get(cell.id),p.q,p.positions,p.h,p.polar.cell_spacing_m)
 return {status:'ok',mission:p.mission,cell:attachTimeline(row,p,sky),meta:evaluationMeta(p,sky)}
}


export function createAutomaticPlanApi(resources){
 const api=createScienceApi({...resources,sites:{sites:[REFERENCE]}})
 return async function automatic(request,ctx){
  const url=new URL(request.url)
  if(!['/api/automatic-plan','/api/automatic-plan/cell'].includes(url.pathname))return null
  const inspect=url.pathname.endsWith('/cell')
  const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}})
  if(request.method!=='POST')return json({status:'unavailable',message:'POST requerido.'},405)
  try{
   if(!request.headers.get('content-type')?.includes('application/json'))throw new ScienceError('Usa application/json.',415)
   const reader=request.body?.getReader();if(!reader)throw new ScienceError('La petición está vacía.')
   let size=0,text='',decoder=new TextDecoder()
   while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>16384){await reader.cancel();throw new ScienceError('La petición supera el tamaño permitido.',413)}text+=decoder.decode(part.value,{stream:true})}
   let raw;try{raw=JSON.parse(text+decoder.decode())}catch{throw new ScienceError('JSON no válido.')}
   const q=validatePlanRequest(raw)
   if(inspect&&(typeof raw.cell_id!=='string'||raw.cell_id.length>64||!resources.polar?.cells?.some(c=>c.id===raw.cell_id)))throw new ScienceError('La celda solicitada no pertenece al catálogo regional.',404)
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
   const sky={sun,earth,transfer_source:anchor.meta}
   return json(inspect?evaluatePlanCell(q,resources,sky,transfer,raw.cell_id):evaluateGlobalPlan(q,resources,sky,transfer))
  }catch(e){return json({status:'unavailable',message:e instanceof Error?e.message:'No se pudo calcular la misión.'},e instanceof ScienceError?e.status:503)}
 }
}
