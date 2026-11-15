import {Layers} from 'lucide-react'
import type {AutomaticPlan,SurfaceRisk} from './automaticTypes'
const format=(n:number,digits=0)=>n.toLocaleString('es',{maximumFractionDigits:digits})
export const SURFACE_CLASS_LABELS:Record<SurfaceRisk,string>={
 green:'Favorables en el modelo',yellow:'Margen limitado',red:'No cumplen los criterios',unknown:'Sin resolver'
}
const SHORT_LABELS:Record<SurfaceRisk,string>={
 green:'Favorables',yellow:'Margen limitado',red:'No cumplen',unknown:'Sin resolver'
}
export default function SurfaceCoverageSummary({plan,active,onToggle,onEvidence}:{plan:AutomaticPlan;active:boolean;onToggle:()=>void;onEvidence:()=>void}){
 const coverage=plan.coverage
 if(!coverage)return null
 const risks:SurfaceRisk[]=['green','yellow','red','unknown']
 return <section className="surface-coverage-summary compact" data-testid="surface-coverage-summary" aria-label="Resultados de toda la superficie" data-cell-count={plan.total_cells}>
  <div className="coverage-compact-row">
   <div className="coverage-compact-title">
    <strong>{format(plan.total_cells)} sectores ({format(coverage.cap_area_km2)} km²)</strong>
    <button type="button" className="coverage-how-link" onClick={onEvidence}>Cómo se calcula</button>
   </div>
   <div className="coverage-class-list">
    {risks.map(risk=>{
     const data=coverage.by_class[risk]
     const pct=format(data.fraction_of_cap*100,2)+' %'
     return <div key={risk} className={'coverage-class '+risk} data-risk={risk} data-area-km2={data.area_km2} title={`${SURFACE_CLASS_LABELS[risk]} · ${format(data.area_km2,1)} km²`}>
      <i/>
      <strong>{SHORT_LABELS[risk]}: <b>{pct}</b></strong>
      <span className="sr-only-label">{SURFACE_CLASS_LABELS[risk]} · {format(data.area_km2,1)} km² · {pct}</span>
     </div>
    })}
   </div>
   <button className="coverage-mode-button" aria-pressed={active} onClick={onToggle}><Layers size={12}/>{active?'Ver relieve NASA':'Ver evaluación completa'}</button>
  </div>
  <div className="coverage-area-bar" aria-label="Superficie por clasificación">{risks.map(risk=><span key={risk} className={'coverage-area-segment '+risk} style={{width:(coverage.by_class[risk].fraction_of_cap*100)+'%'}}/>)}</div>
 </section>
}
