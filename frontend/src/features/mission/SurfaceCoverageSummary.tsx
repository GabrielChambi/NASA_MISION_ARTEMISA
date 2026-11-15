
import {Layers} from 'lucide-react'
import type {AutomaticPlan,SurfaceRisk} from './automaticTypes'
const format=(n:number,digits=0)=>n.toLocaleString('es',{maximumFractionDigits:digits})
export const SURFACE_CLASS_LABELS:Record<SurfaceRisk,string>={
 green:'Favorables en el modelo',yellow:'Margen limitado',red:'No cumplen los criterios',unknown:'Sin resolver'
}
export default function SurfaceCoverageSummary({plan,active,onToggle,onEvidence}:{plan:AutomaticPlan;active:boolean;onToggle:()=>void;onEvidence:()=>void}){
 const coverage=plan.coverage
 if(!coverage)return null
 const risks:SurfaceRisk[]=['green','yellow','red','unknown']
 return <section className="surface-coverage-summary" data-testid="surface-coverage-summary" aria-label="Resultados de toda la superficie" data-cell-count={plan.total_cells}>
  <div className="coverage-summary-heading"><div><strong>{format(coverage.cap_area_km2)} km² de polo sur</strong><span>{format(plan.total_cells)} sectores comparados · {plan.mission.surface_hours} h de estancia · haz clic en cualquier área</span></div><button className="coverage-mode-button" aria-pressed={active} onClick={onToggle}><Layers size={13}/>{active?'Ver relieve NASA':'Ver evaluación completa'}</button></div>
  <div className="coverage-area-bar" aria-label="Superficie por clasificación">{risks.map(risk=><span key={risk} className={'coverage-area-segment '+risk} style={{width:(coverage.by_class[risk].fraction_of_cap*100)+'%'}}/>)}</div>
  <div className="coverage-class-list">{risks.map(risk=>{const data=coverage.by_class[risk];return <div key={risk} className={'coverage-class '+risk} data-risk={risk} data-area-km2={data.area_km2}><i/><div><strong>{SURFACE_CLASS_LABELS[risk]}</strong><span>{format(data.area_km2,1)} km² · {format(data.fraction_of_cap*100,2)} %</span></div></div>})}</div>
  <div className="coverage-summary-foot"><span>Fuente de {coverage.source_resolution_m} m · sectores de {format(coverage.cell_spacing_m/1000,2)} km · condiciones cada 1 h</span><button onClick={onEvidence}>Cómo se calcula</button></div>
 </section>
}
