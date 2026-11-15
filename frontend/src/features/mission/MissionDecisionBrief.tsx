import {compactPhysicsEvidence} from './EngineeringPanel'
import {useI18n} from '../../i18n/LanguageContext'
import {Check,ChevronRight,Clock3,LoaderCircle,MapPin,Search,ShieldAlert} from 'lucide-react'
import type {AutomaticPlan,MissionIntent} from './automaticTypes'
import type {RescueReport} from './rescueTypes'
import type {OperationsReport} from './operationsTypes'
import {formatMissionDate} from '../../../worker/timezones.mjs'
type Snapshot=OperationsReport&{engineering?:unknown;repair?:{status:string;proposals:unknown[]}}
export default function MissionDecisionBrief({intent,plan,operations,rescue,rescueBusy,busy,timezone,onStudy,onBest}:{intent:MissionIntent|null;plan:AutomaticPlan|null;operations:Snapshot|null;rescue:RescueReport|null;rescueBusy:boolean;busy:boolean;timezone:string;onStudy:()=>void;onBest:()=>void}){
 const {tr,language}=useI18n()

 if(!intent)return null
 const current=operations?.affected,budget=current?.budget,local=operations?.local_study
 const physics=compactPhysicsEvidence(operations?.engineering),physicsPass=Boolean(physics?.status==='ok'&&physics.coupled_budget_pass&&physics.outside_temperature_limits_hours===0)
 const ready=Boolean(plan?.best),finding=rescueBusy||Boolean(!ready&&!rescue&&plan)
 const title=busy?'Estoy calculando tu misión.':!plan?'Preparando la evaluación.':!ready?(rescue?.status==='found'?'Tu fecha necesita un cambio; hay opciones calculadas.':finding?'Tu fecha no cumple. Busco otras opciones.':'Esta fecha no tiene un candidato favorable.'):
  !operations?'Destino regional encontrado. Compruebo sus operaciones.':budget?.status==='unknown'?'Hay un candidato, con comprobaciones pendientes.':!budget?.feasible?'El destino requiere un ajuste de operaciones.':!physics?'Compruebo temperatura y comunicaciones.':!physicsPass?'El estudio físico requiere revisar condiciones.':!local?.footprint_resolved?'Los presupuestos calculados cumplen; falta resolver la huella local.':'Revisión regional y local disponibles.'
 const status=busy||finding?'working':!ready||budget&&!budget.feasible||Boolean(physics&&!physicsPass)?'attention':'ready'
 return <section className={'mission-decision-brief '+status} data-testid="mission-decision-brief" aria-live="polite">
  <span className="micro-title">{tr("TU MISIÓN · ESTADO CALCULADO")}</span><h3>{busy||finding?<LoaderCircle size={17} className="spin"/>:status==='attention'?<ShieldAlert size={17}/>:<MapPin size={17}/>} {tr(title)}</h3>
  <p><Clock3 size={12}/>{tr(intent.date_kind==='landing'?'Alunizaje':'Salida')}: {tr(formatMissionDate(intent.departure_utc,timezone,language))} · {tr(timezone)}<br/>{intent.surface_hours}{" "}{tr("h en superficie · pendiente regional ≤")}{intent.max_slope_deg}°</p>
  <ol className="mission-review-steps"><li data-state={plan?'done':'active'}><i>{plan?<Check size={11}/>:1}</i><span>{tr("Todo el polo sur")}<small>{tr(plan?plan.total_cells.toLocaleString('es')+' sectores evaluados':'Consultando relieve y efemérides NASA')}</small></span></li><li data-state={operations?budget?.feasible?'done':'attention':plan?'active':'pending'}><i>{operations?budget?.feasible?<Check size={11}/>:<ShieldAlert size={11}/>:2}</i><span>{tr("Energía y operaciones")}<small>{tr(budget?budget.status==='unknown'?'Datos insuficientes':budget.feasible?'Presupuesto eléctrico y de datos compatible':'Revisa reserva, actividad o transmisión':'Estudio automático con configuración declarada')}</small></span></li><li data-state={local?.footprint_resolved?'done':'pending'}><i>{local?.footprint_resolved?<Check size={11}/>:3}</i><span>{tr("Huella del destino")}<small>{tr(local?local.footprint_resolved?'Criterios nativos evaluados; revisa la elipse':'Datos de '+local.source_resolution_m+' m: huella pequeña sin resolver':'Depende de cobertura local NASA')}</small></span></li><li data-state={!physics?'active':physicsPass?'done':'attention'}><i>{physics?physicsPass?<Check size={11}/>:<ShieldAlert size={11}/>:4}</i><span>{tr("Temperatura y radio")}<small>{tr(!physics?'Cálculo físico automático pendiente':physicsPass?'Presupuesto acoplado compatible; falta calibración':'Revisa calefacción, batería y contactos con estaciones')}</small></span></li></ol>
  {rescue?.status==='found'&&rescue.proposals[0]&&<div className="brief-alternative"><Search size={13}/><span>{tr("Menor retraso entre las fechas probadas:")}{" "}<strong>{tr(formatMissionDate(rescue.proposals[0].proposed_request.departure_utc,timezone,language))}</strong>{tr("Conserva la estancia y los requisitos. Revisa antes de aplicar.")}</span></div>}
  {operations?.repair?.status==='found'&&<p className="brief-fact">{tr("Hay")}{" "}{operations.repair.proposals.length}{" "}{tr("ajustes operativos verificados para comparar.")}</p>}
  <div className="brief-actions">{ready&&<button onClick={onBest}>{tr("Ver mejor candidato")}{" "}<ChevronRight size={12}/></button>}<button disabled={!plan} onClick={onStudy}>{tr("Ver estudio y siguientes pasos")}{" "}<ChevronRight size={12}/></button></div>
  <small className="brief-scope">{tr("Cada estado corresponde al modelo y a sus datos disponibles. La selección regional no certifica el alunizaje.")}</small>
 </section>
}
