import { Clock, Flame, Layers, TrendingUp } from 'lucide-react'
import { useMissionContext } from '../earth/MissionContext'

export function MissionResilienceLab() {
  const { compareData, delayHours, setDelayHours, minimumSolarHours, minimumEarthVisibleHours } = useMissionContext()

  if (!compareData) {
    return null
  }

  return (
    <section className="panel b-resilience-panel" aria-label="Mission Resilience Lab">
      <div className="panel-heading">
        <h2>
          <Flame size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
          Mission Resilience Lab · Launch Delay & Threshold Sensitivity
        </h2>
        <div className="b-controls-badges">
          <span className="b-badge b-badge-source">
            Base: {compareData.base_start_utc.slice(0, 16)}Z → Effective: {compareData.effective_start_utc.slice(0, 16)}Z
          </span>
          <span className="b-badge b-badge-geom">Delay Shift: +{delayHours}h (Real Horizons Re-query)</span>
        </div>
      </div>

      <div className="b-resilience-intro">
        <p>
          <strong>True Ephemeris Delay Re-Calculation:</strong> Introducing a launch or lunar orbit insertion delay (
          <code>delay_hours = +{delayHours}h</code>) shifts the mission window from{' '}
          <code>
            [{compareData.base_start_utc}, {compareData.base_end_utc})
          </code>{' '}
          to{' '}
          <code>
            [{compareData.effective_start_utc}, {compareData.effective_end_utc})
          </code>{' '}
          and queries NASA JPL Horizons for the shifted epoch. No visual curve-shifting or synthetic battery percentage
          is fabricated.
        </p>

        <div className="b-delay-quick-strip" role="group" aria-label="Quick scenario delay selector">
          <span>Test Launch Delay Scenario:</span>
          {[0, 6, 12, 18, 24].map(h => (
            <button
              key={h}
              type="button"
              className={`b-chip ${delayHours === h ? 'active' : ''}`}
              onClick={() => setDelayHours(h)}
            >
              <Clock size={11} /> +{h} hours
            </button>
          ))}
        </div>
      </div>

      <div className="b-resilience-table-wrap">
        <table className="b-table b-resilience-table">
          <thead>
            <tr>
              <th>Candidate Site</th>
              <th>Baseline Earth LoS (0h)</th>
              <th>Delayed Earth LoS (+{delayHours}h)</th>
              <th>Δ Earth LoS</th>
              <th>Baseline Max Blackout</th>
              <th>Delayed Max Blackout</th>
              <th>Δ Max Blackout</th>
              <th>Delayed Joint (Sol ∩ Tierra)</th>
              <th>
                Constraint Status (Sun ≥ {minimumSolarHours}h &amp; Earth ≥ {minimumEarthVisibleHours}h)
              </th>
            </tr>
          </thead>
          <tbody>
            {compareData.delay_sensitivity.map(delta => {
              const siteSummary = compareData.sites.find(s => s.site.site_id === delta.site_id)
              const deltaEarth = delta.delta_earth_visible_hours ?? 0
              const deltaBlackout = delta.delta_longest_blackout_hours ?? 0
              return (
                <tr key={delta.site_id}>
                  <td>
                    <strong>{delta.site_id.toUpperCase()}</strong> · {siteSummary?.site.name}
                  </td>
                  <td>
                    {delta.baseline_earth_visible_hours !== null
                      ? `${delta.baseline_earth_visible_hours.toFixed(1)} h`
                      : '—'}
                  </td>
                  <td>
                    <strong>
                      {delta.delayed_earth_visible_hours !== null
                        ? `${delta.delayed_earth_visible_hours.toFixed(1)} h`
                        : '—'}
                    </strong>
                  </td>
                  <td className={deltaEarth > 0 ? 'green' : deltaEarth < 0 ? 'amber' : ''}>
                    {deltaEarth >= 0 ? `+${deltaEarth.toFixed(1)} h` : `${deltaEarth.toFixed(1)} h`}
                  </td>
                  <td>
                    {delta.baseline_longest_blackout_hours !== null
                      ? `${delta.baseline_longest_blackout_hours.toFixed(1)} h`
                      : '—'}
                  </td>
                  <td>
                    {delta.delayed_longest_blackout_hours !== null
                      ? `${delta.delayed_longest_blackout_hours.toFixed(1)} h`
                      : '—'}
                  </td>
                  <td className={deltaBlackout < 0 ? 'green' : deltaBlackout > 0 ? 'amber' : ''}>
                    {deltaBlackout >= 0 ? `+${deltaBlackout.toFixed(1)} h` : `${deltaBlackout.toFixed(1)} h`}
                  </td>
                  <td>
                    <TrendingUp size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                    {delta.delayed_overlap_hours !== null ? `${delta.delayed_overlap_hours.toFixed(1)} h` : '—'}
                  </td>
                  <td>
                    <span
                      className={`b-status-tag ${
                        siteSummary?.meets_constraints === true
                          ? 'b-tag-pass'
                          : siteSummary?.meets_constraints === 'unknown'
                          ? 'b-tag-unknown'
                          : 'b-tag-fail'
                      }`}
                    >
                      <Layers size={11} /> {String(siteSummary?.meets_constraints).toUpperCase()}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
