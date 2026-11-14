import { EarthDashboard } from './EarthDashboard'
import { MissionProvider } from './MissionContext'
import { MissionControls } from './MissionControls'
import { SiteComparison } from '../compare/SiteComparison'
import { MissionResilienceLab } from '../scenarios/MissionResilienceLab'
import './earth-suite.css'

export function EarthMissionSuite({
  initialSiteId = 'site04',
  activeSection = 'all',
  onSiteChange,
}: {
  initialSiteId?: 'site01' | 'site04'
  activeSection?: 'all' | 'earth' | 'compare'
  onSiteChange?: (siteId: 'site01' | 'site04') => void
}) {
  return (
    <MissionProvider initialSiteId={initialSiteId} onExternalSiteChange={onSiteChange}>
      <div className="b-suite-container">
        <div className="b-suite-header">
          <div>
            <div className="eyebrow view-eyebrow">
              <span className="mini-line" />
              LUNAR SOUTH POLE · TOPOCENTRIC EARTH &amp; MISSION RESILIENCE LAB (3D READY)
            </div>
            <h1>
              {activeSection === 'compare'
                ? 'Site Comparison & Resilience Lab'
                : 'Earth Line-of-Sight & 3D Observatory'}
              <span>.</span>
            </h1>
            <p>
              Geometric line of sight to Earth center (JPL Horizons body 399 from Moon topocentric coord@301) · LRO-LOLA
              5 m/pixel 3D surface topography · Semi-open UTC intervals [start, end).
            </p>
          </div>
        </div>

        <MissionControls />

        {(activeSection === 'all' || activeSection === 'earth') && <EarthDashboard />}
        {(activeSection === 'all' || activeSection === 'compare') && (
          <>
            <SiteComparison />
            <MissionResilienceLab />
          </>
        )}
      </div>
    </MissionProvider>
  )
}
