import {useI18n} from '../../i18n/LanguageContext'
import {Layers} from 'lucide-react'
import type {AutomaticPlan,SurfaceRisk} from './automaticTypes'
export const SURFACE_CLASS_LABELS:Record<SurfaceRisk,string>={
 green:'Favorables en el modelo',yellow:'Margen limitado',red:'No cumplen los criterios',unknown:'Sin resolver'
}
const SHORT_LABELS:Record<SurfaceRisk,string>={
 green:'Favorables',yellow:'Margen limitado',red:'No cumplen',unknown:'Sin resolver'
}
export default function SurfaceCoverageSummary({plan,active,onToggle,onEvidence}:{plan:AutomaticPlan;active:boolean;onToggle:()=>void;onEvidence:()=>void}){
 const {tr,number}=useI18n()

 const format=(value:number,digits=0)=>number(value,digits)
 const coverage=plan.coverage
 if(!coverage)return null
 const risks:SurfaceRisk[]=['green','yellow','red','unknown']
 return <section className="surface-coverage-summary compact" data-testid="surface-coverage-summary" aria-label={tr("Resultados de toda la superficie")} data-cell-count={plan.total_cells}>
  <div className="coverage-compact-row">
   <div className="coverage-compact-title">
    <strong>{tr(format(plan.total_cells))}{" "}{tr("sectores (")}{tr(format(coverage.cap_area_km2))} km²)</strong>
    <button type="button" className="coverage-how-link" onClick={onEvidence}>{tr("Cómo se calcula")}</button>
   </div>
   <div className="coverage-class-list">
    {risks.map(risk=>{
     const data=coverage.by_class[risk]
     const pct=format(data.fraction_of_cap*100,2)+' %'
     return <div key={risk} className={'coverage-class '+risk} data-risk={risk} data-area-km2={data.area_km2} title={tr(`${SURFACE_CLASS_LABELS[risk]} · ${format(data.area_km2,1)} km²`)}>
      <i/>
      <strong>{tr(SHORT_LABELS[risk])}: <b>{tr(pct)}</b></strong>
      <span className="sr-only-label">{tr(SURFACE_CLASS_LABELS[risk])} · {tr(format(data.area_km2,1))} km² · {tr(pct)}</span>
     </div>
    })}
   </div>
   <button className="coverage-mode-button" aria-pressed={active} onClick={onToggle}><Layers size={12}/>{tr(active?'Ver relieve NASA':'Ver evaluación completa')}</button>
  </div>
  <div className="coverage-area-bar" aria-label={tr("Superficie por clasificación")}>{risks.map(risk=><span key={risk} className={'coverage-area-segment '+risk} style={{width:(coverage.by_class[risk].fraction_of_cap*100)+'%'}}/>)}</div>
 </section>
}
