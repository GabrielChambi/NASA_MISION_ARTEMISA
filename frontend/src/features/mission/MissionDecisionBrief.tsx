import {Check,ChevronRight,Clock3,LoaderCircle,MapPin,Search,ShieldAlert} from 'lucide-react'
import type {AutomaticPlan,MissionIntent} from './automaticTypes'
import type {RescueReport} from './rescueTypes'
import type {OperationsReport} from './operationsTypes'
import {formatMissionDate} from '../../../worker/timezones.mjs'
type Snapshot=OperationsReport&{repair?:{status:string;proposals:unknown[]}}
export default function MissionDecisionBrief({intent,plan,operations,rescue,rescueBusy,busy,timezone,onStudy,onBest}:{intent:MissionIntent|null;plan:AutomaticPlan|null;operations:Snapshot|null;rescue:RescueReport|null;rescueBusy:boolean;busy:boolean;timezone:string;onStudy:()=>void;onBest:()=>void}){
 if(!intent)return null
 const current=operations?.affected,budget=current?.budget,local=operations?.local_study
 const ready=Boolean(plan?.best),finding=rescueBusy||Boolean(!ready&&!rescue&&plan)
 const title=busy?'Estoy calculando tu misión.':!plan?'Preparando la evaluación.':!ready?(rescue?.status==='found'?'Tu fecha necesita un cambio; hay opciones calculadas.':finding?'Tu fecha no cumple. Busco otras opciones.':'Esta fecha no tiene un candidato favorable.'):
  !operations?'Destino regional encontrado. Compruebo sus operaciones.':budget?.status==='unknown'?'Hay un candidato, con comprobaciones pendientes.':!budget?.feasible?'El destino requiere un ajuste de operaciones.':!local?.footprint_resolved?'La operación cumple; falta resolver la huella local.':'Revisión regional y local disponibles.'
 const status=busy||finding?'working':!ready||budget&&!budget.feasible?'attention':'ready'
 return <section className={'mission-decision-brief '+status} data-testid="mission-decision-brief" aria-live="polite">
  <span className="micro-title">TU MISIÓN · ESTADO CALCULADO</span><h3>{busy||finding?<LoaderCircle size={17} className="spin"/>:status==='attention'?<ShieldAlert size={17}/>:<MapPin size={17}/>} {title}</h3>
  <p><Clock3 size={12}/>{intent.date_kind==='landing'?'Alunizaje':'Salida'}: {formatMissionDate(intent.departure_utc,timezone)} · {timezone}<br/>{intent.surface_hours} h en superficie · pendiente regional ≤{intent.max_slope_deg}°</p>
  <ol className="mission-review-steps"><li data-state={plan?'done':'active'}><i>{plan?<Check size={11}/>:1}</i><span>Todo el polo sur<small>{plan?plan.total_cells.toLocaleString('es')+' sectores evaluados':'Consultando relieve y efemérides NASA'}</small></span></li><li data-state={operations?budget?.feasible?'done':'attention':plan?'active':'pending'}><i>{operations?budget?.feasible?<Check size={11}/>:<ShieldAlert size={11}/>:2}</i><span>Energía y operaciones<small>{budget?budget.status==='unknown'?'Datos insuficientes':budget.feasible?'Presupuesto eléctrico y de datos compatible':'Revisa reserva, actividad o transmisión':'Estudio automático con configuración declarada'}</small></span></li><li data-state={local?.footprint_resolved?'done':'pending'}><i>{local?.footprint_resolved?<Check size={11}/>:3}</i><span>Huella del destino<small>{local?local.footprint_resolved?'Criterios nativos evaluados; revisa la elipse':'Datos de '+local.source_resolution_m+' m: huella pequeña sin resolver':'Depende de cobertura local NASA'}</small></span></li></ol>
  {rescue?.status==='found'&&rescue.proposals[0]&&<div className="brief-alternative"><Search size={13}/><span>Menor retraso entre las fechas probadas: <strong>{formatMissionDate(rescue.proposals[0].proposed_request.departure_utc,timezone)}</strong>Conserva la estancia y los requisitos. Revisa antes de aplicar.</span></div>}
  {operations?.repair?.status==='found'&&<p className="brief-fact">Hay {operations.repair.proposals.length} ajustes operativos verificados para comparar.</p>}
  <div className="brief-actions">{ready&&<button onClick={onBest}>Ver mejor candidato <ChevronRight size={12}/></button>}<button disabled={!plan} onClick={onStudy}>Ver estudio y siguientes pasos <ChevronRight size={12}/></button></div>
  <small className="brief-scope">Cada estado corresponde al modelo y a sus datos disponibles. La selección regional no certifica el alunizaje.</small>
 </section>
}
