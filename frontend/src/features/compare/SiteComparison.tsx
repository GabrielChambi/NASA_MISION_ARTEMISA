import { Award, CheckCircle2, GitCompare, HelpCircle, ShieldAlert, XCircle } from 'lucide-react'
import { useMissionContext } from '../earth/MissionContext'
import type { ConstraintStatus } from '../earth/EarthApiClient'

function renderConstraintBadge(status: ConstraintStatus) {
  if (status === 'unknown') {
    return (
      <span className="b-status-tag b-tag-unknown">
        <HelpCircle size={12} /> UNKNOWN (Series unavailable)
      </span>
    )
  }
  if (status === true) {
    return (
      <span className="b-status-tag b-tag-pass">
        <CheckCircle2 size={12} /> MEETS CONSTRAINTS
      </span>
    )
  }
  return (
    <span className="b-status-tag b-tag-fail">
      <XCircle size={12} /> BELOW THRESHOLD
    </span>
  )
}

export function SiteComparison() {
  const { compareData, loadingCompare, setSiteId, siteId } = useMissionContext()

  if (loadingCompare && !compareData) {
    return (
      <section className="panel b-compare-panel" aria-busy="true">
        <div className="panel-heading">
          <h2>Multi-Site Geometric Comparison (Site01 vs Site04)</h2>
        </div>
        <div className="b-empty-state">Aggregating Solar & Earth ephemerides for Site01 and Site04...</div>
      </section>
    )
  }

  if (!compareData) {
    return (
      <section className="panel b-compare-panel">
        <div className="panel-heading">
          <h2>Multi-Site Geometric Comparison (Site01 vs Site04)</h2>
        </div>
        <div className="b-empty-state">Comparison data unavailable.</div>
      </section>
    )
  }

  const { sites, preferred_site_id, preference_label, decision_explanation, ranking_rule, consolidated_quality } =
    compareData

  return (
    <section className="panel b-compare-panel" aria-label="Site Comparison">
      <div className="panel-heading">
        <h2>
          <GitCompare size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
          Site Comparison · Connecting Ridge (Site01) vs Shackleton Rim (Site04)
        </h2>
        <div className="b-controls-badges">
          <span className="b-badge b-badge-source">Consolidated Quality: {consolidated_quality}</span>
          <span className="b-badge b-badge-geom">{preference_label}</span>
        </div>
      </div>

      {/* Decision Banner */}
      <div className="b-decision-banner">
        <div className="b-decision-header">
          <Award size={18} className="green" />
          <div>
            <span className="eyebrow">{preference_label.toUpperCase()} (HEURISTIC DECISION RULE)</span>
            <h3>
              {preferred_site_id
                ? `${preferred_site_id.toUpperCase()} — ${
                    sites.find(s => s.site.site_id === preferred_site_id)?.site.name ?? ''
                  }`
                : 'Undecided / Unknown (Required ephemeris series unavailable)'}
            </h3>
          </div>
        </div>
        <p className="b-decision-text">{decision_explanation}</p>
        <small className="b-decision-rule">
          <strong>Rule provenance:</strong> {ranking_rule}
        </small>
      </div>

      {/* Side-by-Side Site Cards */}
      <div className="b-compare-cards">
        {sites.map(item => {
          const isPreferred = preferred_site_id === item.site.site_id
          const isSelected = siteId === item.site.site_id
          const totalH = item.total_hours || 1
          const sunPct = item.solar_visible_hours !== null ? (item.solar_visible_hours / totalH) * 100 : 0
          const earthPct = item.earth_visible_hours !== null ? (item.earth_visible_hours / totalH) * 100 : 0
          const overlapPct =
            item.overlap_solar_earth_hours !== null ? (item.overlap_solar_earth_hours / totalH) * 100 : 0

          return (
            <div
              key={item.site.site_id}
              className={`b-site-card ${isPreferred ? 'preferred' : ''} ${isSelected ? 'active-site' : ''}`}
            >
              <div className="b-site-card-top">
                <div>
                  <span className="eyebrow">
                    {item.site.site_id.toUpperCase()} · {item.site.region.toUpperCase()}
                  </span>
                  <h3>{item.site.name}</h3>
                  <small>
                    Lat {item.site.lat_deg.toFixed(4)}° · Lon {item.site.lon_east_deg.toFixed(4)}°E · Elev{' '}
                    {item.site.elevation_m.toFixed(1)} m
                  </small>
                </div>
                <div className="b-site-card-badges">
                  {isPreferred && <span className="b-preferred-pill">{preference_label}</span>}
                  {renderConstraintBadge(item.meets_constraints)}
                </div>
              </div>

              {/* Metric Bars (strictly rendered from backend values without frontend recalculation) */}
              <div className="b-metric-bars">
                <div className="b-metric-bar-row">
                  <div className="b-metric-bar-label">
                    <span>Solar Visible Duration (Sun &gt; Horizon)</span>
                    <strong>
                      {item.solar_visible_hours !== null ? `${item.solar_visible_hours.toFixed(1)} h` : 'unavailable'}{' '}
                      <small>
                        ({item.solar_visible_fraction !== null ? `${(item.solar_visible_fraction * 100).toFixed(1)}%` : '—'})
                      </small>
                    </strong>
                  </div>
                  <div className="b-progress-track">
                    <div className="b-progress-fill sun" style={{ width: `${Math.min(100, sunPct)}%` }} />
                  </div>
                </div>

                <div className="b-metric-bar-row">
                  <div className="b-metric-bar-label">
                    <span>Earth Line-of-Sight Window (Earth &gt; Horizon + Clearance)</span>
                    <strong>
                      {item.earth_visible_hours !== null ? `${item.earth_visible_hours.toFixed(1)} h` : 'unavailable'}{' '}
                      <small>
                        ({item.earth_visible_fraction !== null ? `${(item.earth_visible_fraction * 100).toFixed(1)}%` : '—'})
                      </small>
                    </strong>
                  </div>
                  <div className="b-progress-track">
                    <div className="b-progress-fill earth" style={{ width: `${Math.min(100, earthPct)}%` }} />
                  </div>
                </div>

                <div className="b-metric-bar-row">
                  <div className="b-metric-bar-label">
                    <span>Joint Overlap (Solar ∩ Earth Simultaneous Visibility)</span>
                    <strong className="green">
                      {item.overlap_solar_earth_hours !== null
                        ? `${item.overlap_solar_earth_hours.toFixed(1)} h`
                        : 'unavailable'}{' '}
                      <small>
                        (
                        {item.overlap_solar_earth_fraction !== null
                          ? `${(item.overlap_solar_earth_fraction * 100).toFixed(1)}%`
                          : '—'}
                        )
                      </small>
                    </strong>
                  </div>
                  <div className="b-progress-track">
                    <div className="b-progress-fill overlap" style={{ width: `${Math.min(100, overlapPct)}%` }} />
                  </div>
                </div>
              </div>

              <dl className="b-site-metrics-grid">
                <div>
                  <dt>Longest Earth visibility blackout</dt>
                  <dd className={(item.longest_earth_blackout_hours ?? 0) > 0 ? 'amber' : 'green'}>
                    {item.longest_earth_blackout_hours !== null
                      ? `${item.longest_earth_blackout_hours.toFixed(1)} h`
                      : 'unknown'}
                  </dd>
                </div>
                <div>
                  <dt>Longest solar dark gap</dt>
                  <dd>
                    {item.longest_solar_dark_gap_hours !== null
                      ? `${item.longest_solar_dark_gap_hours.toFixed(1)} h`
                      : 'unknown'}
                  </dd>
                </div>
                <div>
                  <dt>Constraints satisfied</dt>
                  <dd>
                    {item.constraints_satisfied_count !== null ? `${item.constraints_satisfied_count} / 2` : 'unknown'}
                  </dd>
                </div>
                <div>
                  <dt>Series quality</dt>
                  <dd>{item.quality}</dd>
                </div>
              </dl>

              <p className="b-site-explanation">{item.explanation}</p>

              <button
                type="button"
                className="b-inspect-site-btn"
                onClick={() => setSiteId(item.site.site_id as 'site01' | 'site04')}
              >
                {isSelected
                  ? `Active in 3D Observatory (${item.site.site_id.toUpperCase()})`
                  : `Inspect ${item.site.name} in 3D Observatory`}
              </button>
            </div>
          )
        })}
      </div>

      {compareData.warnings.length > 0 && (
        <div className="b-alert b-alert-warn">
          <ShieldAlert size={14} />
          <div>{compareData.warnings.join(' | ')}</div>
        </div>
      )}
    </section>
  )
}
