import { useState, lazy, Suspense } from 'react'
import TacticalSurvivalCockpit from './features/tactical/TacticalSurvivalCockpit'
import { MissionProvider } from './features/mission/MissionContext'

const MissionPlanner = lazy(() => import('./features/mission/MissionPlanner'))

export default function App() {
  const [showAdvanced, setShowAdvanced] = useState(false)

  if (showAdvanced) {
    return (
      <MissionProvider initialSiteId="site04">
        <Suspense fallback={<div style={{ padding: 40, color: '#48dbfb', background: '#05090e', height: '100vh', fontFamily: 'monospace' }}>Cargando herramientas analíticas NASA…</div>}>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowAdvanced(false)}
              style={{
                position: 'fixed',
                top: 10,
                right: 180,
                zIndex: 9999,
                background: '#48dbfb',
                color: '#05090e',
                border: 'none',
                padding: '6px 12px',
                borderRadius: 4,
                fontFamily: 'monospace',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              ◀ VOLVER AL PANEL TÁCTICO 3D
            </button>
            <MissionPlanner />
          </div>
        </Suspense>
      </MissionProvider>
    )
  }

  return <TacticalSurvivalCockpit onOpenScientific={() => setShowAdvanced(true)} />
}
