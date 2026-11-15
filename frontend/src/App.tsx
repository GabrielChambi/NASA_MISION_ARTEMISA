import {ArrowLeft} from 'lucide-react'
import { useState, lazy, Suspense } from 'react'
import MissionExperience from './features/tactical/MissionExperience'
import { MissionProvider } from './features/mission/MissionContext'
const MissionPlanner = lazy(() => import('./features/mission/MissionPlanner'))

export default function App() {
  const [showAdvanced,setShowAdvanced]=useState(false)
  return <MissionProvider initialSiteId="site01">
    <div hidden={showAdvanced}><MissionExperience active={!showAdvanced} onOpenScientific={()=>setShowAdvanced(true)}/></div>
    {showAdvanced&&<div>
      <div style={{background:'#111113',padding:'12px 18px',color:'#e4e4e7',display:'flex',gap:18,alignItems:'center',flexWrap:'wrap'}}>
        <button onClick={()=>setShowAdvanced(false)} style={{background:'#f4f4f5',border:0,padding:'9px 14px',borderRadius:4,cursor:'pointer'}}><ArrowLeft size={13} style={{verticalAlign:'middle'}}/> Volver al cockpit</button>
        <span style={{fontSize:12}}>Comparación de píxeles de referencia NASA. La evidencia de cada celda está en el cockpit.</span>
      </div>
      <Suspense fallback={<div style={{padding:40,color:'#b4e4df',background:'#05090e'}}>Cargando herramientas científicas NASA…</div>}><MissionPlanner/></Suspense>
    </div>}
  </MissionProvider>
}
