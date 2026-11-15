/** Bounded search over exact NASA samples. No interpolation, invented ephemerides
 * or requirement relaxation. Robustness means passing five hourly perturbations,
 * not a calibrated landing success probability.
 */
import { assessCell, validateBody, windowMetrics } from './landingScience'
import type { BodyResult, LandingRun } from './landingScience'
const HOUR=3600000
const iso=(ms:number)=>new Date(ms).toISOString().replace('.000Z','Z')
export const START_SHIFTS_HOURS=Array.from({length:13},(_,i)=>i)
export const ROBUST_OFFSETS_HOURS=[-2,-1,0,1,2] as const
export type WindowStatus='meets'|'fails'|'unknown'
export type WindowScenario={
  startUtc:string;endUtc:string;offsetHours:number;status:WindowStatus
  sunHours:number|null;earthHours:number|null;jointHours:number|null
  longestDarkHours:number|null;sunClearanceDeg:number|null;earthClearanceDeg:number|null
  reasons:string[]
}
export type WindowCandidate=WindowScenario&{
  shiftHours:number;robustStatus:WindowStatus;robustCases:WindowScenario[]
  worstSunHours:number|null;worstEarthHours:number|null
}
export type SearchGate={status:'ready'|'blocked'|'unknown';reasons:string[]}
export type WindowSearchReport={
  schemaVersion:1;status:'ok'|'blocked'|'unknown';originId:string;nominalStartUtc:string
  durationHours:number;gridStepMinutes:60;searchedStartShiftHours:number[];robustOffsetsHours:number[]
  constraints:LandingRun['limits'];candidates:WindowCandidate[];firstPassing:WindowCandidate|null
  firstRobust:WindowCandidate|null;alternatives:WindowCandidate[];reasons:string[]
  sources:{body:'Sun'|'Earth';queryUrl:string;retrievedAt:string;startUtc:string;endUtc:string}[]
  limitations:string[]
}
export const SEARCH_LIMITATIONS=[
  'Se prueban trece inicios horarios entre el nominal y doce horas después; no es un óptimo global.',
  'La robustez sólo ensaya cambios de inicio de menos dos a más dos horas; no es una probabilidad de éxito.',
  'Las ventanas usan muestras NASA horarias e intervalos [inicio, fin); las transiciones pueden variar hasta un paso.',
  'Los requisitos de pendiente, relieve, márgenes y horas mínimas permanecen fijos.',
  'Cambiar la ventana superficial no calcula la viabilidad de lanzamiento, transferencia ni guiado orbital.',
]
function runDuration(run:LandingRun){
  const start=Date.parse(run.sun.samples[0]?.t_utc??'')
  const end=Date.parse(run.sun.samples.at(-1)?.t_utc??'')
  const hours=(end-start)/HOUR
  if(!Number.isFinite(start)||!Number.isFinite(end)||!Number.isInteger(hours)||hours<1||hours>336)throw new Error('El intervalo de misión debe contener entre una y 336 horas completas.')
  return {start,end,hours}
}
export function windowSearchGate(run:LandingRun):SearchGate{
  const cell=run.origin,l=run.limits
  try{
    const {hours}=runDuration(run)
    if([l.maxSlope,l.maxRelief,l.sunMargin,l.earthMargin,l.minSunHours,l.minEarthHours].some(v=>!Number.isFinite(v))||l.maxSlope<0||l.maxSlope>45||l.maxRelief<0||l.maxRelief>50||l.sunMargin<0||l.sunMargin>10||l.earthMargin<0||l.earthMargin>10||l.minSunHours<0||l.minEarthHours<0||l.minSunHours>hours||l.minEarthHours>hours)return {status:'unknown',reasons:['Los requisitos de misión no son válidos para este intervalo.']}
  }catch(e){return {status:'unknown',reasons:[e instanceof Error?e.message:'Intervalo desconocido.']}}
  if(!cell.known||cell.ray_coverage_fraction<.995||[cell.elevation_m,cell.max_slope_deg,cell.relief_m].some(v=>typeof v!=='number'||!Number.isFinite(v))||cell.horizon_deg.length!==360||cell.horizon_deg.some(v=>!Number.isFinite(v)))return {status:'unknown',reasons:['La celda no tiene cobertura de terreno y horizonte suficiente para buscar fechas.']}
  const reasons:string[]=[]
  if(cell.max_slope_deg!>l.maxSlope)reasons.push('La pendiente máxima de la celda y huella supera el límite. Cambiar la fecha no corrige la pendiente.')
  if(cell.relief_m!>l.maxRelief)reasons.push('El relieve local supera el límite. Cambiar la fecha no corrige el terreno.')
  return {status:reasons.length?'blocked':'ready',reasons}
}
export function expandedSearchInterval(run:LandingRun){
  const {start,end}=runDuration(run)
  return {startUtc:iso(start-2*HOUR),endUtc:iso(end+14*HOUR),durationHours:(end-start)/HOUR}
}
function scenario(run:LandingRun,sun:BodyResult,earth:BodyResult,start:number,duration:number,offsetHours:number):WindowScenario{
  const end=start+duration*HOUR
  const unknown=(reason:string):WindowScenario=>({startUtc:iso(start),endUtc:iso(end),offsetHours,status:'unknown',sunHours:null,earthHours:null,jointHours:null,longestDarkHours:null,sunClearanceDeg:null,earthClearanceDeg:null,reasons:[reason]})
  const rows=(body:BodyResult)=>body.samples.filter(s=>Date.parse(s.t_utc)>=start&&Date.parse(s.t_utc)<=end)
  const a=rows(sun),b=rows(earth)
  if(a.length!==duration+1||b.length!==duration+1||a.some((s,i)=>Date.parse(s.t_utc)!==start+i*HOUR||s.t_utc!==b[i]?.t_utc))return unknown('La serie NASA no cubre todos los instantes de este escenario.')
  try{
    const slice={...run,sun:{...sun,samples:a},earth:{...earth,samples:b}}
    const hours=windowMetrics(slice,run.origin),assessment=assessCell(slice,run.origin,0,hours)
    if(assessment.risk==='unknown')return unknown(assessment.reasons.join(' '))
    return {startUtc:iso(start),endUtc:iso(end),offsetHours,status:assessment.risk==='red'?'fails':'meets',
      sunHours:hours.sunHours,earthHours:hours.earthHours,jointHours:hours.jointHours,longestDarkHours:hours.longestDark,
      sunClearanceDeg:assessment.sunMargin,earthClearanceDeg:assessment.earthMargin,reasons:assessment.risk==='red'?assessment.reasons:['Cumple los criterios conocidos del modelo en este inicio.']}
  }catch{return unknown('Hay datos NASA ausentes o no finitos; no se emite una solución.')}
}
function source(body:'Sun'|'Earth',value:BodyResult){
  return {body,queryUrl:value.meta.query_url,retrievedAt:value.meta.retrieved_at,startUtc:value.samples[0]?.t_utc??'',endUtc:value.samples.at(-1)?.t_utc??''}
}
export function searchMissionWindows(run:LandingRun,sun?:BodyResult,earth?:BodyResult):WindowSearchReport{
  const gate=windowSearchGate(run)
  let start=NaN,hours=0
  try{({start,hours}=runDuration(run))}catch{/* Gate already preserves the error. */}
  const report:WindowSearchReport={schemaVersion:1,status:gate.status==='ready'?'ok':gate.status,originId:run.origin.id,nominalStartUtc:Number.isFinite(start)?iso(start):'',durationHours:hours,
    gridStepMinutes:60,searchedStartShiftHours:[...START_SHIFTS_HOURS],robustOffsetsHours:[...ROBUST_OFFSETS_HOURS],constraints:{...run.limits},
    candidates:[],firstPassing:null,firstRobust:null,alternatives:[],reasons:[...gate.reasons],sources:[],limitations:[...SEARCH_LIMITATIONS]}
  if(gate.status!=='ready')return report
  if(!sun||!earth){report.status='unknown';report.reasons=['Faltan las series NASA ampliadas del Sol y la Tierra.'];return report}
  // Validate the full source grid, preserve its real query, never relabel a crop.
  try{
    for(const body of [sun,earth])validateBody(body,run.origin,body.samples[0]?.t_utc??'',body.samples.at(-1)?.t_utc??'')
  }catch(e){report.status='unknown';report.reasons=[e instanceof Error?e.message:'Serie NASA no válida.'];return report}
  report.sources=[source('Sun',sun),source('Earth',earth)]
  report.candidates=START_SHIFTS_HOURS.map(shiftHours=>{
    const baseline=scenario(run,sun,earth,start+shiftHours*HOUR,hours,0)
    const cases=ROBUST_OFFSETS_HOURS.map(offset=>scenario(run,sun,earth,start+(shiftHours+offset)*HOUR,hours,offset))
    const robustStatus:WindowStatus=cases.some(c=>c.status==='unknown')?'unknown':cases.every(c=>c.status==='meets')?'meets':'fails'
    const known=cases.every(c=>c.sunHours!==null&&c.earthHours!==null)
    return {...baseline,shiftHours,robustStatus,robustCases:cases,worstSunHours:known?Math.min(...cases.map(c=>c.sunHours!)):null,worstEarthHours:known?Math.min(...cases.map(c=>c.earthHours!)):null}
  })
  report.firstPassing=report.candidates.find(c=>c.status==='meets')??null
  report.firstRobust=report.candidates.find(c=>c.status==='meets'&&c.robustStatus==='meets')??null
  report.alternatives=report.candidates.filter(c=>c.status==='meets').slice(0,3)
  if(!report.firstPassing)report.reasons=[report.candidates.some(c=>c.status==='unknown')?'Cobertura insuficiente para descartar o confirmar todas las fechas.':'Ninguno de los trece inicios probados cumple todos tus requisitos.']
  if(report.candidates.every(c=>c.status==='unknown'))report.status='unknown'
  return report
}
export async function fetchWindowSearch(run:LandingRun,signal:AbortSignal,fetcher:typeof fetch=fetch,onProgress?:(body:'Sun'|'Earth')=>void):Promise<WindowSearchReport>{
  if(windowSearchGate(run).status!=='ready')return searchMissionWindows(run)
  const interval=expandedSearchInterval(run)
  const get=async(target:'Sun'|'Earth')=>{
    onProgress?.(target)
    const params=new URLSearchParams({cell_id:run.origin.id,target,start_utc:interval.startUtc,end_utc:interval.endUtc,step_minutes:'60',observer_height_m:'2'})
    const response=await fetcher('/api/landing/ephemeris?'+params,{signal})
    const result=await response.json()
    if(!response.ok)throw new Error(result.message??'NASA no pudo completar la búsqueda de fechas.')
    validateBody(result,run.origin,interval.startUtc,interval.endUtc)
    return result as BodyResult
  }
  const sun=await get('Sun'),earth=await get('Earth')
  if(signal.aborted)throw new DOMException('Búsqueda cancelada.','AbortError')
  return searchMissionWindows(run,sun,earth)
}
