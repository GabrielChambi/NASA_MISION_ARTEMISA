
import {ArrowRight,Check,Clock3,LoaderCircle,RefreshCw,Search,X} from 'lucide-react'
import type {RescueReport,RescueProposal} from './rescueTypes'
const n=(value:number|null|undefined,digits=1)=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('es',{maximumFractionDigits:digits}):'—'
const time=(utc:string)=>new Intl.DateTimeFormat('es',{timeZone:'America/La_Paz',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(utc))
function slopeMargin(proposal:RescueProposal){return Math.min(proposal.proposed_request.max_slope_deg,proposal.proposed_request.vehicle_profile?.center_of_gravity_tolerance??proposal.proposed_request.max_slope_deg)-(proposal.best.regional_slope_deg??0)}
function delay(hours:number){const days=Math.floor(hours/24),rest=hours%24;return (days?days+' d ':'')+(rest?n(rest)+' h':days?'':'0 h')}
export default function MissionRescuePanel({report,busy,error,elapsed,onApply,onRetry,onCancel,onEvidence}:{report:RescueReport|null;busy:boolean;error:string;elapsed:number;onApply:(proposal:RescueProposal)=>void;onRetry:()=>void;onCancel:()=>void;onEvidence:()=>void}){
 const found=report?.status==='found'&&Boolean(report.proposals.length)
 return <section className="mission-rescue" aria-label="Alternativas calculadas para tu misión" data-testid="mission-rescue" aria-busy={busy}>
  <div className="rescue-heading"><Search size={17}/><div><span className="micro-title">BUSCADOR DE SOLUCIONES</span><h2>{busy?'Buscando una alternativa para ti.':found?'Tu misión tiene otras opciones.':'Qué impide esta misión y cómo avanzar.'}</h2></div></div>
  {busy?<><p>Comparando próximas fechas sobre las zonas con terreno evaluable, conservando tu estancia, pendiente y requisitos de visibilidad.</p><div className="rescue-progress" role="status"><LoaderCircle className="spin" size={14}/><span>Consultando NASA y evaluando ventanas · {elapsed} s</span></div><button className="rescue-cancel" onClick={onCancel}><X size={12}/> Cancelar búsqueda</button></>:<>
   {Boolean(report?.diagnosis?.blockers?.length)&&<div className="rescue-diagnosis"><strong>En la fecha solicitada</strong><ul>{report!.diagnosis.blockers.filter(b=>b.count>0).sort((a,b)=>b.count-a.count).slice(0,2).map(blocker=><li key={blocker.code}>{blocker.label} <span>{n(blocker.count)} sectores evaluables</span></li>)}</ul></div>}
   {found&&<><p>Estas alternativas cumplen los criterios del modelo sin reducir tus requisitos. Elige una para recalcular el mapa completo.</p><div className="rescue-proposals">{report!.proposals.map((proposal,index)=><article key={proposal.id} className="rescue-proposal" data-proposal-id={proposal.id}>
    <div className="proposal-rank"><span>{index===0?'MENOR RETRASO ENCONTRADO':'OTRA OPCIÓN CALCULADA'}</span><b><Clock3 size={11}/> +{delay(proposal.delta_hours)}</b></div>
    <h3>{time(proposal.proposed_request.departure_utc)} <small>· {proposal.proposed_request.date_kind==='landing'?'alunizaje':'salida'} en Bolivia</small></h3>
    <p className="proposal-arrival">Llegada: {time(proposal.mission.arrival_utc)} · {n(proposal.mission.surface_hours)} h en superficie</p>
    <div className="proposal-metrics"><span>Sol <b>{n(proposal.best.sun_hours)} h</b></span><span>Tierra <b>{n(proposal.best.earth_hours)} h</b></span><span>Pendiente P95 <b>{n(proposal.best.regional_slope_deg,2)}°</b></span></div>
    {proposal.best.regional_slope_deg!=null&&slopeMargin(proposal)<1&&<p className="proposal-caution">Pendiente P95 a {n(slopeMargin(proposal),2)}° del límite. Requiere estudio local del terreno.</p>}<div className="proposal-preserved"><Check size={12}/> Mismos requisitos · {n(Math.abs(proposal.best.latitude_deg))}°S, {n(Math.abs(proposal.best.longitude_deg))}°{proposal.best.longitude_deg<0?'O':'E'}</div>
    <button className="apply-rescue" onClick={()=>onApply(proposal)}>Aplicar y recalcular <ArrowRight size={13}/></button>
   </article>)}</div></>}
   {report?.status==='none'&&<p>Ninguna de las fechas evaluadas dentro de los próximos {report.search.search_days} días cumplió los criterios. Puedes mover la fecha o ajustar tus requisitos; no se han cambiado automáticamente.</p>}
   {report?.status==='blocked'&&<p>{report.diagnosis.code==='unsupported_observer_height'?'La altura de tus paneles o antena requiere perfiles de horizonte propios. Los disponibles son de 2 m; no se puede recomendar otra fecha para esa configuración todavía. Puedes compararla explícitamente con la referencia de 2 m desde el catálogo.':report.diagnosis.code==='terrain_constraints'?'Cambiar la fecha no resuelve el límite de pendiente con los datos disponibles. Revisa el criterio de terreno y las áreas sin resolver.':report.diagnosis.code==='insufficient_terrain_data'?'Faltan mediciones del terreno para comprobar tus requisitos. Las zonas sin medir permanecen desconocidas.':'Faltan perfiles de horizonte suficientes para recomendar otra fecha. Las zonas sin datos no se sustituyen por lugares supuestamente favorables.'}</p>}
   {error&&<div className="rescue-error" role="alert">{error}</div>}
   {!report&&!error&&<p>Búsqueda detenida. El resultado original se conserva.</p>}
   {report&&<div className="rescue-search-scope">{n(report.search?.tested_scenarios??report.search?.tested_offsets_hours?.length??0)} fechas comprobadas · intervalo de búsqueda: {report.search?.search_days??14} días · refinamiento por hora. Se comparan horas disponibles; no es un diseño de lanzamiento.</div>}
   <div className="rescue-footer"><button onClick={onRetry}><RefreshCw size={12}/> Volver a buscar</button>{report&&<button onClick={onEvidence}>Ver evidencia</button>}</div>
  </>}
 </section>
}
