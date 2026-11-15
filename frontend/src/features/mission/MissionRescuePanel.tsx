import {useI18n} from '../../i18n/LanguageContext'

import {ArrowRight,Check,Clock3,LoaderCircle,RefreshCw,Search,X} from 'lucide-react'
import type {RescueReport,RescueProposal} from './rescueTypes'
const time=(utc:string,timezone:string,language:string)=>new Intl.DateTimeFormat(language,{timeZone:timezone,day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(utc))
function slopeMargin(proposal:RescueProposal){return Math.min(proposal.proposed_request.max_slope_deg,proposal.proposed_request.vehicle_profile?.center_of_gravity_tolerance??proposal.proposed_request.max_slope_deg)-(proposal.best.regional_slope_deg??0)}
export default function MissionRescuePanel({report,busy,error,elapsed,onApply,onRetry,onCancel,onEvidence,timezone='America/New_York'}:{timezone?:string;report:RescueReport|null;busy:boolean;error:string;elapsed:number;onApply:(proposal:RescueProposal)=>void;onRetry:()=>void;onCancel:()=>void;onEvidence:()=>void}){
 const {tr,number:n,language}=useI18n()

 const delay=(hours:number)=>{const days=Math.floor(hours/24),rest=hours%24;return (days?days+' d ':'')+(rest?n(rest)+' h':days?'':'0 h')}
 const found=report?.status==='found'&&Boolean(report.proposals.length)
 return <details className="mission-rescue collapsible-sidebar-card" aria-label={tr("Alternativas calculadas para tu misión")} data-testid="mission-rescue" aria-busy={busy} open>
  <summary className="rescue-heading-summary">
    <div className="rescue-heading"><Search size={17}/><div><span className="micro-title">{tr("BUSCADOR DE SOLUCIONES")}</span><h2>{tr(busy?'Buscando una alternativa para ti.':found?'Tu misión tiene otras opciones.':'Qué impide esta misión y cómo avanzar.')}</h2></div></div>
  </summary>
  <div className="rescue-body">
   {busy?<><p>{tr("Comparando próximas fechas sobre las zonas con terreno evaluable, conservando tu estancia, pendiente y requisitos de visibilidad.")}</p><div className="rescue-progress" role="status"><LoaderCircle className="spin" size={14}/><span>{tr("Consultando NASA y evaluando ventanas ·")}{" "}{elapsed} s</span></div><button className="rescue-cancel" onClick={onCancel}><X size={12}/>{" "}{tr("Cancelar búsqueda")}</button></>:<>
   {Boolean(report?.diagnosis?.blockers?.length)&&<div className="rescue-diagnosis"><strong>{tr("En la fecha solicitada")}</strong><ul>{report!.diagnosis.blockers.filter(b=>b.count>0).sort((a,b)=>b.count-a.count).slice(0,2).map(blocker=><li key={blocker.code}>{tr(blocker.label)} <span>{tr(n(blocker.count))}{" "}{tr("sectores evaluables")}</span></li>)}</ul></div>}
   {found&&<><p>{tr("Estas alternativas cumplen los criterios del modelo sin reducir tus requisitos. Elige una para recalcular el mapa completo.")}</p><div className="rescue-proposals">{report!.proposals.map((proposal,index)=><article key={proposal.id} className="rescue-proposal" data-proposal-id={proposal.id}>
    <div className="proposal-rank"><span>{tr(index===0?'MENOR RETRASO ENCONTRADO':'OTRA OPCIÓN CALCULADA')}</span><b><Clock3 size={11}/> +{tr(delay(proposal.delta_hours))}</b></div>
    <h3>{tr(time(proposal.proposed_request.departure_utc,timezone,language))} <small>· {tr(proposal.proposed_request.date_kind==='landing'?'alunizaje':'salida')} · {tr(timezone)}</small></h3>
    <p className="proposal-arrival">{tr("Llegada:")}{" "}{tr(time(proposal.mission.arrival_utc,timezone,language))} · {tr(n(proposal.mission.surface_hours))}{" "}{tr("h en superficie")}</p>
    <div className="proposal-metrics"><span>{tr("Sol")}{" "}<b>{tr(n(proposal.best.sun_hours))} h</b></span><span>{tr("Tierra")}{" "}<b>{tr(n(proposal.best.earth_hours))} h</b></span><span>{tr("Pendiente P95")}{" "}<b>{tr(n(proposal.best.regional_slope_deg,2))}°</b></span></div>
    {proposal.best.regional_slope_deg!=null&&slopeMargin(proposal)<1&&<p className="proposal-caution">{tr("Pendiente P95 a")}{" "}{tr(n(slopeMargin(proposal),2))}{tr("° del límite. Requiere estudio local del terreno.")}</p>}<div className="proposal-preserved"><Check size={12}/>{" "}{tr("Mismos requisitos ·")}{" "}{tr(n(Math.abs(proposal.best.latitude_deg)))}°S, {tr(n(Math.abs(proposal.best.longitude_deg)))}°{tr(proposal.best.longitude_deg<0?(language==='en'?'W':'O'):'E')}</div>
    <button className="apply-rescue" onClick={()=>onApply(proposal)}>{tr("Aplicar y recalcular")}{" "}<ArrowRight size={13}/></button>
   </article>)}</div></>}
   {report?.status==='none'&&<p>{tr("Ninguna de las fechas evaluadas dentro de los próximos")}{" "}{report.search.search_days}{" "}{tr("días cumplió los criterios. Puedes mover la fecha o ajustar tus requisitos; no se han cambiado automáticamente.")}</p>}
   {report?.status==='blocked'&&<p>{tr(report.diagnosis.code==='unsupported_observer_height'?'El mapa regional usa perfiles preparados de 2 m y no puede clasificar otras alturas. El estudio de misión recalcula los horizontes locales para tus paneles y antena en la zona seleccionada; puedes consultarlo más abajo.':report.diagnosis.code==='terrain_constraints'?'Cambiar la fecha no resuelve el límite de pendiente con los datos disponibles. Revisa el criterio de terreno y las áreas sin resolver.':report.diagnosis.code==='insufficient_terrain_data'?'Faltan mediciones del terreno para comprobar tus requisitos. Las zonas sin medir permanecen desconocidas.':'Faltan perfiles de horizonte suficientes para recomendar otra fecha. Las zonas sin datos no se sustituyen por lugares supuestamente favorables.')}</p>}
   {error&&<div className="rescue-error" role="alert">{tr(error)}</div>}
   {!report&&!error&&<p>{tr("Búsqueda detenida. El resultado original se conserva.")}</p>}
   {report&&<div className="rescue-search-scope">{tr(n(report.search?.tested_scenarios??report.search?.tested_offsets_hours?.length??0))}{" "}{tr("fechas comprobadas · intervalo de búsqueda:")}{" "}{report.search?.search_days??14}{" "}{tr("días · refinamiento por hora. Se comparan horas disponibles; no es un diseño de lanzamiento.")}</div>}
   <div className="rescue-footer"><button onClick={onRetry}><RefreshCw size={12}/>{" "}{tr("Volver a buscar")}</button>{report&&<button onClick={onEvidence}>{tr("Ver evidencia")}</button>}</div>
  </>}
  </div>
 </details>
}
