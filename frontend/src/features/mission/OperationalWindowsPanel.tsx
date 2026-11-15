import {useI18n} from '../../i18n/LanguageContext'

import {useMemo} from 'react'
import {Globe2,Sun} from 'lucide-react'
import {getOperationalWindows,type OperationalChannel,type OperationalWindows} from './operationalWindows'
import type {MissionTimeSample} from './automaticTypes'
function text(channel:OperationalChannel,windows:OperationalWindows,date:(utc:string)=>string,n:(v:number)=>string){
 if(windows.is_end_of_coverage)return {heading:'Fin del intervalo calculado',detail:'No se extrapolan condiciones posteriores.'}
 if(channel.current_visible===null)return {heading:'Condiciones desconocidas',detail:'No se sustituye un dato ausente por visibilidad.'}
 if(channel.current_visible){
  const event=channel.next_loss
  if(event.event_state==='observed')return {heading:'Pérdida de margen en '+n(event.hours_until_min!)+'–'+n(event.hours_until_max!)+' h',detail:'Cambio entre '+date(event.bracket_start_utc!)+' y '+date(event.bracket_end_utc!)+'.'}
  if(event.event_state==='unknown')return {heading:'Despeje en la muestra actual',detail:'Faltan datos para ubicar la próxima pérdida.'}
  return {heading:'Sin pérdida en las muestras',detail:'Datos hasta '+date(windows.coverage_end_utc)+', dentro de '+n(windows.remaining_hours)+' h.'}
 }
 const event=channel.next_available
 if(event.event_state==='observed')return {heading:'Ahora sin margen suficiente',detail:'Recuperación muestreada en '+n(event.hours_until_min!)+'–'+n(event.hours_until_max!)+' h.'}
 if(event.event_state==='unknown')return {heading:'Ahora sin margen suficiente',detail:'Faltan datos para ubicar su recuperación.'}
 return {heading:'Sin despeje en las muestras',detail:'No se registra recuperación antes de '+date(windows.coverage_end_utc)+'.'}
}
export default function OperationalWindowsPanel({samples,index,timezone="America/New_York"}:{samples:MissionTimeSample[];index:number;timezone?:string}){
 const {tr,number:n,language}=useI18n()

 const date=(utc:string)=>new Intl.DateTimeFormat(language,{timeZone:timezone,day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(utc))
 const result=useMemo(()=>getOperationalWindows(samples,index,.3),[samples,index])
 if(result.status!=='ok')return null
 return <details className="operational-windows collapsible-sidebar-card" data-testid="operational-windows" aria-label={tr("Próximos cambios del Sol y la Tierra")} open>
  <summary className="operations-heading-summary">
    <div className="operations-heading"><strong>{tr("¿Cuánto margen queda?")}</strong><span>{tr("Despeje exigido:")}{" "}{tr(n(result.margin_deg))}{tr("° · observador en la superficie")}</span></div>
  </summary>
  <div className="operations-windows-body">
    <div className="operations-cards">{(['sun','earth'] as const).map(target=>{const channel=result[target],content=text(channel,result,date,n);return <article key={target} className={'operation-card '+(channel.current_visible===null?'unknown':channel.current_visible?'visible':'blocked')} data-target={target}>
      <div className="operation-target">{target==='sun'?<Sun size={15}/>:<Globe2 size={15}/>}<span>{tr(target==='sun'?'Sol sobre el horizonte':'Tierra sobre el horizonte')}</span><b>{tr(channel.current_visible===null?'Sin datos':channel.current_visible?'Con margen':'Sin margen')}</b></div>
      <strong>{tr(content.heading)}</strong><p>{tr(content.detail)}</p>
    </article>})}</div>
    <details className="operations-intervals"><summary>{tr("Ver ventanas calculadas de visibilidad")}</summary>
      <div className="interval-groups">{(['sun','earth','joint'] as const).map(target=><div key={target}><h4>{tr(target==='sun'?'Sol':target==='earth'?'Tierra':'Ambos simultáneamente')}</h4>{result[target].intervals.length?result[target].intervals.map(interval=><p key={interval.start_utc}>{tr(date(interval.start_utc))} → {tr(date(interval.end_utc))} <b>{tr(n(interval.hours))} h</b></p>):<p>{tr("No hay intervalos que cumplan dentro de estos datos.")}</p>}</div>)}</div>
    </details>
    <p className="operations-scope">{tr("Muestreo cada hora; pueden existir cortes breves entre muestras. Visibilidad geométrica: aún no calcula energía eléctrica ni garantiza un enlace de radio.")}</p>
  </div>
 </details>
}
