import {clearsMargin} from '../../../worker/visibility.mjs'

/** Bounded hourly visibility windows from measured/modelled series, never extrapolated.
 * "Visible" means apparent-center clearance exceeds the declared margin. It is
 * not an electrical-power or radio-link assessment. Left samples cover [t,t+1h).
 */
export type OperationalSample={
  t_utc:string
  sun_elevation_deg?:number|null;sun_horizon_deg?:number|null
  earth_elevation_deg?:number|null;earth_horizon_deg?:number|null
}
export type OperationalEventState='observed'|'not_observed'|'not_active'|'already_active'|'unknown'
export type OperationalEvent={
  event_state:OperationalEventState;at_utc:string|null;hours_until:number|null
  bracket_start_utc:string|null;bracket_end_utc:string|null;uncertainty_hours:number|null
  hours_until_min:number|null;hours_until_max:number|null;observed_until_utc:string|null
}
export type OperationalInterval={start_utc:string;end_utc:string;hours:number}
export type OperationalChannel={
  current_visible:boolean|null;current_geometric_visible:boolean|null;current_clearance_deg:number|null
  visible_hours:number;blocked_hours:number;unknown_hours:number;intervals:OperationalInterval[]
  next_loss:OperationalEvent;next_available:OperationalEvent
}
export type OperationalWindows={
  status:'ok';current_utc:string;coverage_start_utc:string;coverage_end_utc:string
  remaining_hours:number;step_hours:1;margin_deg:number;window_convention:'[start,end)'
  is_end_of_coverage:boolean;method:'hourly-left-sample-clearance';transition_uncertainty_hours:1;limitations:string[]
  sun:OperationalChannel;earth:OperationalChannel;joint:OperationalChannel
  joint_current_window_end_utc:string|null;joint_current_window_end_state:OperationalEventState
}
export type OperationalWindowsUnavailable={status:'unavailable';reason:string}
const HOUR=3600000
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)
const unavailable=(reason:string):OperationalWindowsUnavailable=>({status:'unavailable',reason})
function event(state:OperationalEventState,end:string|null):OperationalEvent{
  return {event_state:state,at_utc:null,hours_until:null,bracket_start_utc:null,bracket_end_utc:null,uncertainty_hours:null,hours_until_min:null,hours_until_max:null,observed_until_utc:end}
}
function nextEvent(states:(boolean|null)[],times:string[],index:number,target:boolean):OperationalEvent{
  const now=states[index],end=times[times.length-1]
  if(now===null)return event('unknown',times[index])
  if(now===target){
    if(!target)return event('not_active',times[index])
    return {...event('already_active',times[index]),at_utc:times[index],hours_until:0,hours_until_min:0,hours_until_max:0,uncertainty_hours:0}
  }
  for(let i=index+1;i<states.length;i++){
    if(states[i]===null)return event('unknown',times[i-1])
    if(states[i]===target)return {...event('observed',times[i]),at_utc:times[i],hours_until:i-index,
      bracket_start_utc:times[i-1],bracket_end_utc:times[i],uncertainty_hours:1,hours_until_min:i-index-1,hours_until_max:i-index}
  }
  return event('not_observed',end)
}
function channel(clearances:(number|null)[],times:string[],index:number,margin:number):OperationalChannel{
  const states=clearances.map(v=>v===null?null:clearsMargin(v,margin))
  const intervals:OperationalInterval[]=[]
  let start:number|null=null,visible=0,blocked=0,unknown=0
  // The last row is an observed endpoint, not an additional one-hour interval.
  for(let i=0;i<states.length-1;i++){
    if(states[i]===true){visible++;if(start===null)start=i}
    else {if(states[i]===null)unknown++;else blocked++}
    if(start!==null&&(states[i]!==true||i===states.length-2)){
      const end=states[i]===true?i+1:i
      intervals.push({start_utc:times[start],end_utc:times[end],hours:end-start});start=null
    }
  }
  return {current_visible:states[index],current_geometric_visible:clearances[index]===null?null:clearances[index]!>0,current_clearance_deg:clearances[index],
    visible_hours:visible,blocked_hours:blocked,unknown_hours:unknown,intervals,
    next_loss:nextEvent(states,times,index,false),next_available:nextEvent(states,times,index,true)}
}
export function getOperationalWindows(series:readonly OperationalSample[],index=0,margin=.3):OperationalWindows|OperationalWindowsUnavailable{
  if(!Array.isArray(series)||series.length<2)return unavailable('No hay una serie horaria completa para este sector.')
  if(!Number.isInteger(index)||index<0||index>=series.length)return unavailable('La hora seleccionada queda fuera de la serie disponible.')
  if(!finite(margin)||margin<0||margin>90)return unavailable('El margen de despeje no es válido.')
  const times:string[]=[],milliseconds:number[]=[]
  for(const sample of series){
    const raw=sample?.t_utc
    if(typeof raw!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(raw))return unavailable('La serie debe usar fechas UTC explícitas.')
    const ms=Date.parse(raw),normalized=raw.replace(/Z$/,raw.includes('.')?'Z':'.000Z')
    if(!Number.isFinite(ms)||new Date(ms).toISOString()!==normalized)return unavailable('La serie contiene una fecha UTC no válida.')
    if(milliseconds.length&&ms-milliseconds[milliseconds.length-1]!==HOUR)return unavailable('La serie debe ser continua con una cadencia de una hora.')
    times.push(raw);milliseconds.push(ms)
  }
  const clearance=(sample:OperationalSample,target:'sun'|'earth')=>{
    const elevation=sample[target==='sun'?'sun_elevation_deg':'earth_elevation_deg'],horizon=sample[target==='sun'?'sun_horizon_deg':'earth_horizon_deg']
    return finite(elevation)&&finite(horizon)&&elevation>=-90&&elevation<=90&&horizon>=-90&&horizon<=90?elevation-horizon:null
  }
  const s=series.map(row=>clearance(row,'sun')),e=series.map(row=>clearance(row,'earth'))
  const jointClearance=s.map((value,i)=>value===null||e[i]===null?null:Math.min(value,e[i]!))
  const sun=channel(s,times,index,margin),earth=channel(e,times,index,margin),joint=channel(jointClearance,times,index,margin)
  return {status:'ok',current_utc:times[index],coverage_start_utc:times[0],coverage_end_utc:times[times.length-1],remaining_hours:times.length-1-index,
    step_hours:1,margin_deg:margin,window_convention:'[start,end)',is_end_of_coverage:index===times.length-1,
    method:'hourly-left-sample-clearance',transition_uncertainty_hours:1,
    limitations:['La cadencia horaria puede omitir pérdidas breves entre muestras.','El despeje geométrico no calcula energía eléctrica ni un presupuesto de radio.','No se predicen eventos fuera del intervalo observado.'],sun,earth,joint,
    joint_current_window_end_utc:joint.next_loss.event_state==='observed'?joint.next_loss.at_utc:null,joint_current_window_end_state:joint.next_loss.event_state}
}
