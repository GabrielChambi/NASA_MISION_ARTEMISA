import { useState, lazy, Suspense } from 'react'
import { ArrowLeft } from 'lucide-react'
import TacticalSurvivalCockpit from './features/tactical/TacticalSurvivalCockpit'
import { MissionProvider } from './features/mission/MissionContext'

const MissionPlanner = lazy(() => import('./features/mission/MissionPlanner'))

export default function App() {
  const [showAdvanced, setShowAdvanced] = useState(false)

  if (showAdvanced) {
    return (
      <MissionProvider initialSiteId="site04">
        <Suspense
          fallback={
            <div
              style={{
                padding: 40,
                color: '#ffffff',
                background: '#050506',
                height: '100vh',
                fontFamily: 'IBM Plex Mono, monospace',
              }}
            >
              Cargando herramientas analíticas NASA…
            </div>
          }
        >
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowAdvanced(false)}
              style={{
                position: 'fixed',
                top: 10,
                right: 180,
                zIndex: 9999,
                background: '#ffffff',
                color: '#050506',
                border: '1px solid rgba(255, 255, 255, 0.9)',
                padding: '6px 12px',
                borderRadius: 3,
                fontFamily: 'IBM Plex Mono, monospace',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <ArrowLeft size={12} />
              <span>VOLVER AL PANEL TÁCTICO 3D</span>
            </button>
            <MissionPlanner />
          </div>
        </Suspense>
      </MissionProvider>
    )
  }

  return <TacticalSurvivalCockpit onOpenScientific={() => setShowAdvanced(true)} />
}
