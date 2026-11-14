import { Calendar, Clock, Compass, Layers, RefreshCw, ShieldAlert, Sliders } from 'lucide-react'
import { useMissionContext } from './MissionContext'
import type { HorizonMode } from './EarthApiClient'

const PRESET_WINDOWS = [
  {
    label: 'Dec 14–17, 2026 · Earth Rise Transition (72h)',
    startUtc: '2026-12-14T00:00:00Z',
    durationHours: 72,
  },
  {
    label: 'Dec 14–21, 2026 · Full 7-Day Libration Climb (168h)',
    startUtc: '2026-12-14T00:00:00Z',
    durationHours: 168,
  },
  {
    label: 'Dec 18–21, 2026 · 72 h study window',
    startUtc: '2026-12-18T00:00:00Z',
    durationHours: 72,
  },
  {
    label: 'Dec 01–04, 2026 · 72 h study window',
    startUtc: '2026-12-01T00:00:00Z',
    durationHours: 72,
  },
]

export function MissionControls() {
  const {
    siteId,
    startUtc,
    endUtc,
    durationHours,
    stepMinutes,
    horizonMode,
    clearanceDeg,
    delayHours,
    minimumSolarHours,
    minimumEarthVisibleHours,
    earthData,
    loadingEarth,
    loadingCompare,
    errorMessage,
    setSiteId,
    setStartUtcAndDuration,
    setStepMinutes,
    setHorizonMode,
    setClearanceDeg,
    setDelayHours,
    setMinimumConstraints,
    refreshAll,
  } = useMissionContext()

  const datetimeLocalValue = startUtc.slice(0, 16)

  function handleCustomDateChange(rawLocal: string) {
    if (!rawLocal) return
    const formatted = rawLocal.length === 16 ? `${rawLocal}:00Z` : `${rawLocal}Z`
    setStartUtcAndDuration(formatted, durationHours)
  }

  return (
    <section className="panel b-mission-controls" aria-label="Mission Controls">
      <div className="panel-heading">
        <h2>
          <Sliders size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
          Mission Controls · UTC & Scenario Parameters
        </h2>
        <div className="b-controls-badges">
          <span className="b-badge b-badge-source">Source: NASA/JPL Horizons</span>
          <span className="b-badge b-badge-geom">Geometric visibility only</span>
          <button
            type="button"
            className="b-icon-refresh"
            onClick={refreshAll}
            title="Re-query NASA JPL Horizons ephemeris"
            aria-label="Re-query NASA JPL Horizons ephemeris"
          >
            <RefreshCw size={13} className={loadingEarth || loadingCompare ? 'b-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="b-controls-grid">
        {/* Site Selector */}
        <div className="b-control-group">
          <label htmlFor="b-site-select">
            <Compass size={12} /> Target Landing Site
          </label>
          <select
            id="b-site-select"
            value={siteId}
            onChange={e => setSiteId(e.target.value as 'site01' | 'site04')}
          >
            <option value="site04">Site04 · Shackleton rim</option>
            <option value="site01">Site01 · Connecting ridge</option>
          </select>
          <small className="b-control-hint">NASA LOLA reference pixel · coordinates in result provenance</small>
        </div>

        {/* Preset Window Selector */}
        <div className="b-control-group">
          <label htmlFor="b-preset-select">
            <Calendar size={12} /> Mission Epoch Preset (UTC)
          </label>
          <select
            id="b-preset-select"
            value={`${startUtc}|${durationHours}`}
            onChange={e => {
              const [s, d] = e.target.value.split('|')
              if (s && d) setStartUtcAndDuration(s, Number(d))
            }}
          >
            {PRESET_WINDOWS.map(p => (
              <option key={`${p.startUtc}|${p.durationHours}`} value={`${p.startUtc}|${p.durationHours}`}>
                {p.label}
              </option>
            ))}
            {!PRESET_WINDOWS.some(p => p.startUtc === startUtc && p.durationHours === durationHours) && (
              <option value={`${startUtc}|${durationHours}`}>
                Custom ({startUtc.slice(0, 16)}Z · {durationHours}h)
              </option>
            )}
          </select>
          <small className="b-control-hint">
            Active interval: [{earthData?.effective_start_utc ?? startUtc}, {earthData?.effective_end_utc ?? endUtc})
          </small>
        </div>

        {/* Custom UTC Start & Duration */}
        <div className="b-control-group">
          <label htmlFor="b-start-utc">
            <Clock size={12} /> Start UTC & Window Duration
          </label>
          <div className="b-inline-inputs">
            <input
              id="b-start-utc"
              type="datetime-local"
              value={datetimeLocalValue}
              min="1962-01-01T00:00"
              max="2099-12-01T00:00"
              onChange={e => handleCustomDateChange(e.target.value)}
              aria-label="Start UTC timestamp"
            />
            <select
              aria-label="Interval duration in hours"
              value={durationHours}
              onChange={e => setStartUtcAndDuration(startUtc, Number(e.target.value))}
            >
              <option value={24}>24 h (1d)</option>
              <option value={48}>48 h (2d)</option>
              <option value={72}>72 h (3d)</option>
              <option value={120}>120 h (5d)</option>
              <option value={168}>168 h (7d)</option>
            </select>
          </div>
          <small className="b-control-hint">Semi-open convention [start_utc, end_utc) in UTC</small>
        </div>

        {/* Step Size & Horizon Mode */}
        <div className="b-control-group">
          <label htmlFor="b-step-select">
            <Layers size={12} /> Step Size & Horizon Model
          </label>
          <div className="b-inline-inputs">
            <select
              id="b-step-select"
              aria-label="Sampling step in minutes"
              value={stepMinutes}
              onChange={e => setStepMinutes(Number(e.target.value))}
            >
              <option value={10}>10 min step</option><option value={15}>15 min step</option><option value={30}>30 min step</option>
              <option value={60}>60 min step</option>
              <option value={120}>120 min step</option>
              <option value={180}>180 min step</option>
            </select>
            <select
              aria-label="Horizon elevation model"
              value={horizonMode}
              onChange={e => setHorizonMode(e.target.value as HorizonMode)}
            >
              <option value="flat">Flat Horizon (0°)</option>
              <option value="terrain">Terrain Horizon (LOLA)</option>
            </select>
          </div>
          <small className="b-control-hint">
            Clearance:
            {[0, 1, 2, 5].map(deg => (
              <button
                key={deg}
                type="button"
                className={`b-chip ${clearanceDeg === deg ? 'active' : ''}`}
                onClick={() => setClearanceDeg(deg)}
              >
                +{deg}°
              </button>
            ))}
          </small>
        </div>

        {/* Launch Delay Scenario (0-24h) */}
        <div className="b-control-group">
          <label htmlFor="b-delay-slider">
            Scenario Launch Delay: <strong>+{delayHours} h</strong>
          </label>
          <input
            id="b-delay-slider"
            type="range"
            min={0}
            max={24}
            step={6}
            value={delayHours}
            onChange={e => setDelayHours(Number(e.target.value))}
          />
          <div className="b-chip-row">
            {[0, 6, 12, 18, 24].map(h => (
              <button
                key={h}
                type="button"
                className={`b-chip ${delayHours === h ? 'active' : ''}`}
                onClick={() => setDelayHours(h)}
              >
                +{h}h
              </button>
            ))}
          </div>
        </div>

        {/* Minimum Visibility Constraints */}
        <div className="b-control-group">
          <label htmlFor="b-min-earth">
            Resilience Thresholds (Min Solar / Min Earth LoS)
          </label>
          <div className="b-inline-inputs">
            <label className="b-mini-field">
              <span>Sun ≥</span>
              <input
                type="number"
                min={0}
                max={durationHours}
                step={6}
                value={minimumSolarHours}
                onChange={e => setMinimumConstraints(Number(e.target.value), minimumEarthVisibleHours)}
                aria-label="Minimum solar hours constraint"
              />
              <span>h</span>
            </label>
            <label className="b-mini-field">
              <span>Earth ≥</span>
              <input
                id="b-min-earth"
                type="number"
                min={0}
                max={durationHours}
                step={6}
                value={minimumEarthVisibleHours}
                onChange={e => setMinimumConstraints(minimumSolarHours, Number(e.target.value))}
                aria-label="Minimum Earth visible hours constraint"
              />
              <span>h</span>
            </label>
          </div>
          <small className="b-control-hint">Used by deterministic comparison heuristic</small>
        </div>
      </div>

      {/* Explicit Terrain Unavailable / Quality Warning Banner */}
      {earthData?.quality === 'terrain_unavailable' && (
        <div className="b-alert b-alert-warn" role="status">
          <ShieldAlert size={15} />
          <div>
            <strong>Terrain horizon unavailable</strong> — Requested mode is <code>terrain</code>, but verified
            LOLA horizon service (<code>api/app/core/horizon.py</code>) is not active yet. Serving explicit{' '}
            <code>0.0° flat</code> geometric approximation without altering your preference.
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="b-alert b-alert-error" role="alert">
          <ShieldAlert size={15} />
          <div>
            <strong>Telemetry Validation / Connection Notice:</strong> {errorMessage}
          </div>
        </div>
      )}
    </section>
  )
}
