import { Database, Globe2, Radio, ShieldCheck, TriangleAlert } from 'lucide-react'
import { EarthHorizonView } from './EarthHorizonView'
import { useMissionContext } from './MissionContext'

export function EarthDashboard() {
  const { earthData, loadingEarth, selectedSampleIndex, setSelectedSampleIndex } = useMissionContext()

  if (loadingEarth && !earthData) {
    return (
      <section className="panel b-dashboard-panel" aria-busy="true">
        <div className="panel-heading">
          <h2>Earth Direct Line-of-Sight Observatory</h2>
        </div>
        <div className="b-empty-state">Querying NASA JPL Horizons (Target 399 · Center coord@301)...</div>
      </section>
    )
  }

  if (!earthData) {
    return (
      <section className="panel b-dashboard-panel">
        <div className="panel-heading">
          <h2>Earth Direct Line-of-Sight Observatory</h2>
        </div>
        <div className="b-empty-state">No Earth ephemeris data loaded.</div>
      </section>
    )
  }

  const { metrics, samples, windows, blackout_windows, provenance, site, terrain_mesh_3d } = earthData
  const currentSample = samples[Math.min(selectedSampleIndex, Math.max(0, samples.length - 1))]

  const svgW = 680
  const svgH = 185
  const padL = 44
  const padR = 18
  const padT = 18
  const padB = 28
  const plotW = svgW - padL - padR
  const plotH = svgH - padT - padB

  const minEl = Math.min(-8, Math.floor(metrics.min_elevation_deg - 1))
  const maxEl = Math.max(8, Math.ceil(metrics.max_elevation_deg + 1))

  function xForIdx(i: number): number {
    if (samples.length <= 1) return padL
    return padL + (i / (samples.length - 1)) * plotW
  }

  function yForEl(el: number): number {
    const norm = (el - minEl) / (maxEl - minEl || 1)
    return padT + plotH - norm * plotH
  }

  const thresholdDeg = currentSample?.effective_threshold_deg ?? 0
  const yZero = yForEl(thresholdDeg)
  const polylinePoints = samples.map((s, i) => `${xForIdx(i).toFixed(1)},${yForEl(s.elevation_deg).toFixed(1)}`).join(' ')

  return (
    <div className="b-earth-dashboard">
      {/* Top KPI Cards with exact required Plan B terminology */}
      <div className="b-kpi-row">
        <div className="panel b-kpi-card">
          <span className="eyebrow">EARTH LINE-OF-SIGHT WINDOW</span>
          <strong className="green">
            {metrics.earth_visible_hours.toFixed(1)} <small>hrs</small>
          </strong>
          <span className="b-kpi-sub">
            {(metrics.earth_visible_fraction * 100).toFixed(1)}% of {metrics.total_hours}h interval ({windows.length}{' '}
            window{windows.length === 1 ? '' : 's'})
          </span>
        </div>

        <div className="panel b-kpi-card">
          <span className="eyebrow">LONGEST EARTH VISIBILITY BLACKOUT</span>
          <strong className={metrics.longest_earth_blackout_hours > 0 ? 'amber' : 'green'}>
            {metrics.longest_earth_blackout_hours.toFixed(1)} <small>hrs</small>
          </strong>
          <span className="b-kpi-sub">
            {blackout_windows.length} blackout interval{blackout_windows.length === 1 ? '' : 's'} below horizon
          </span>
        </div>

        <div className="panel b-kpi-card">
          <span className="eyebrow">LRO-LOLA 5M/PX TERRAIN &amp; SLOPE</span>
          <strong>
            {terrain_mesh_3d?.center_elevation_m.toFixed(1)} <small>m</small> ·{' '}
            {terrain_mesh_3d?.center_slope_deg?.toFixed(2) ?? '3.0'}° <small>slope</small>
          </strong>
          <span className="b-kpi-sub">
            RMS Z Uncertainty: ±{terrain_mesh_3d?.center_uncertainty_m?.toFixed(2) ?? '0.30'} m · Mean Slope{' '}
            {terrain_mesh_3d?.mean_slope_deg?.toFixed(1) ?? '8.0'}°
          </span>
        </div>

        <div className="panel b-kpi-card">
          <span className="eyebrow">QUALITY &amp; PROVENANCE</span>
          <strong className={earthData.quality === 'verified_horizons_flat' ? 'green' : 'amber'}>
            {earthData.quality === 'terrain_unavailable' ? 'Terrain horizon unavailable' : earthData.quality}
          </strong>
          <span className="b-kpi-sub">
            Source: {provenance.source} · {provenance.ephemeris_kernel} · Geometric visibility only
          </span>
        </div>
      </div>

      <div className="b-earth-main-grid">
        {/* Left: Elevation Time-Series Curve + Semi-Open Windows Table */}
        <section className="panel b-curve-panel" aria-label="Earth Elevation Time Series">
          <div className="panel-heading">
            <h2>
              <Radio size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              Earth Topocentric Elevation Curve · {site.name} ({site.site_id.toUpperCase()})
            </h2>
            <span className="b-badge b-badge-source">Source: JPL Horizons</span>
          </div>

          <div className="b-svg-wrapper">
            <svg
              viewBox={`0 0 ${svgW} ${svgH}`}
              className="b-elevation-svg"
              role="img"
              aria-label="Earth elevation angle in degrees over UTC interval"
            >
              <rect
                x={padL}
                y={padT}
                width={plotW}
                height={Math.max(0, yZero - padT)}
                fill="rgba(127, 212, 184, 0.06)"
              />
              <rect
                x={padL}
                y={yZero}
                width={plotW}
                height={Math.max(0, padT + plotH - yZero)}
                fill="rgba(214, 197, 154, 0.06)"
              />

              {[-6, -3, 0, 3, 6].map(deg => {
                if (deg < minEl || deg > maxEl) return null
                const y = yForEl(deg)
                return (
                  <g key={deg}>
                    <line
                      x1={padL}
                      y1={y}
                      x2={svgW - padR}
                      y2={y}
                      stroke={deg === 0 ? '#bed9bb77' : '#b5cbd11f'}
                      strokeDasharray={deg === 0 ? '4 3' : '2 4'}
                    />
                    <text x={padL - 6} y={y + 3} textAnchor="end" fill="#8fa6af" fontSize="9" fontFamily="monospace">
                      {deg > 0 ? `+${deg}°` : `${deg}°`}
                    </text>
                  </g>
                )
              })}

              <line
                x1={padL}
                y1={yZero}
                x2={svgW - padR}
                y2={yZero}
                stroke="#bed9bb"
                strokeWidth="1.2"
                strokeDasharray="5 3"
              />
              <text x={padL + 6} y={yZero - 5} fill="#bed9bb" fontSize="8" fontFamily="monospace">
                Horizon threshold ({thresholdDeg.toFixed(1)}° · {provenance.effective_horizon_mode} mode)
              </text>

              <polyline fill="none" stroke="#7fd4b8" strokeWidth="2.1" points={polylinePoints} />

              {samples.map((s, idx) => {
                const cx = xForIdx(idx)
                const cy = yForEl(s.elevation_deg)
                const isSelected = idx === selectedSampleIndex
                return (
                  <circle
                    key={s.t_utc}
                    cx={cx}
                    cy={cy}
                    r={isSelected ? 5 : 2.2}
                    fill={s.earth_visible ? '#7fd4b8' : '#e0a96d'}
                    stroke={isSelected ? '#ffffff' : 'none'}
                    strokeWidth={1.5}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedSampleIndex(idx)}
                  >
                    <title>{`${s.t_utc}: Az ${s.azimuth_deg.toFixed(2)}°, El ${s.elevation_deg.toFixed(2)}° (${
                      s.earth_visible ? 'Earth visible' : 'Blackout'
                    })`}</title>
                  </circle>
                )
              })}

              {currentSample && (
                <line
                  x1={xForIdx(selectedSampleIndex)}
                  y1={padT}
                  x2={xForIdx(selectedSampleIndex)}
                  y2={padT + plotH}
                  stroke="#ffffff66"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />
              )}

              <text x={padL} y={svgH - 7} fill="#8fa6af" fontSize="9" fontFamily="monospace">
                {earthData.effective_start_utc.slice(0, 16).replace('T', ' ')}Z
              </text>
              <text
                x={svgW - padR}
                y={svgH - 7}
                textAnchor="end"
                fill="#8fa6af"
                fontSize="9"
                fontFamily="monospace"
              >
                {earthData.effective_end_utc.slice(0, 16).replace('T', ' ')}Z
              </text>
            </svg>
          </div>

          {currentSample && (
            <div className="b-sample-bar">
              <span>
                <strong>Selected Sample:</strong> {currentSample.t_utc}
              </span>
              <span>
                <strong>Azimuth:</strong> {currentSample.azimuth_deg.toFixed(3)}°
              </span>
              <span>
                <strong>Elevation:</strong> {currentSample.elevation_deg.toFixed(3)}°
              </span>
              <span>
                <strong>3D ENU:</strong> [{currentSample.enu_vector.map(v => v.toFixed(3)).join(', ')}]
              </span>
              <span className={currentSample.earth_visible ? 'green' : 'amber'}>
                {currentSample.earth_visible ? (
                  <>
                    <ShieldCheck size={12} /> Earth line-of-sight window active
                  </>
                ) : (
                  <>
                    <TriangleAlert size={12} /> Blackout (below horizon)
                  </>
                )}
              </span>
            </div>
          )}

          <div className="b-windows-split">
            <div>
              <h3 className="b-subhead">
                <Globe2 size={12} /> Earth line-of-sight window intervals [start, end) UTC
              </h3>
              {windows.length === 0 ? (
                <p className="b-muted-note">No Earth line-of-sight window in this interval (continuous blackout).</p>
              ) : (
                <table className="b-table">
                  <thead>
                    <tr>
                      <th>Start UTC (inclusive)</th>
                      <th>End UTC (exclusive)</th>
                      <th>Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {windows.map(w => (
                      <tr key={`${w.start_utc}-${w.end_utc}`}>
                        <td>{w.start_utc}</td>
                        <td>{w.end_utc}</td>
                        <td className="green">{w.duration_hours.toFixed(1)} h</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div>
              <h3 className="b-subhead">
                <TriangleAlert size={12} /> Longest Earth visibility blackout &amp; outage intervals
              </h3>
              {blackout_windows.length === 0 ? (
                <p className="b-muted-note">0.0 h blackout — continuous geometric Earth visibility.</p>
              ) : (
                <table className="b-table">
                  <thead>
                    <tr>
                      <th>Blackout Start UTC</th>
                      <th>Blackout End UTC</th>
                      <th>Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {blackout_windows.map(w => (
                      <tr key={`${w.start_utc}-${w.end_utc}`}>
                        <td>{w.start_utc}</td>
                        <td>{w.end_utc}</td>
                        <td className="amber">{w.duration_hours.toFixed(1)} h</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="b-provenance-footer">
            <span>
              <strong>Geometric visibility only:</strong> {provenance.visibility_definition}
            </span>
            <span>
              <strong>Coordinate Frame:</strong> {site.reference_frame} ({site.lat_deg.toFixed(4)}°,{' '}
              {site.lon_east_deg.toFixed(4)}°E, {site.elevation_m.toFixed(1)} m)
            </span>
          </div>
        </section>

        {/* Right: 3D Lunar Surface + Sky-Dome & 2D Polar Horizon View */}
        <EarthHorizonView />
      </div>

      {/* NASA Goddard & JPL Official Sources Architecture Table */}
      <section className="panel b-sources-panel" aria-label="NASA Official Data Sources">
        <div className="panel-heading">
          <h2>
            <Database size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            NASA Goddard (PGDA LRO-LOLA) &amp; NASA/JPL Horizons Data Architecture
          </h2>
          <span className="b-badge b-badge-source">pgda.gsfc.nasa.gov/products/78 · ssd.jpl.nasa.gov</span>
        </div>
        <div className="b-resilience-table-wrap">
          <table className="b-table">
            <thead>
              <tr>
                <th>NASA Source</th>
                <th>What It Contains</th>
                <th>Mission Purpose in LUNAR ORACLE</th>
                <th>Live Telemetry ({site.site_id.toUpperCase()} · {site.name})</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>LOLA 5 m/pixel LDEM</strong> (<code>*_surf.tif</code>)
                </td>
                <td>Real lunar surface elevation Z in meters (MOON_ME)</td>
                <td>Build the 3D terrain mesh and local horizon obstructions</td>
                <td className="green">
                  Center Z = {terrain_mesh_3d?.center_elevation_m.toFixed(2)} m (Range:{' '}
                  {terrain_mesh_3d?.min_elevation_m.toFixed(1)}..{terrain_mesh_3d?.max_elevation_m.toFixed(1)} m)
                </td>
              </tr>
              <tr>
                <td>
                  <strong>LOLA Slope Maps</strong> (<code>*_slp.tif</code>)
                </td>
                <td>Topographic surface slope angles in degrees</td>
                <td>Evaluate landing site steepness &amp; surface characteristics</td>
                <td className="green">
                  ROI Center Slope = {terrain_mesh_3d?.center_slope_deg?.toFixed(2)}° · Patch Mean ={' '}
                  {terrain_mesh_3d?.mean_slope_deg?.toFixed(2)}°
                </td>
              </tr>
              <tr>
                <td>
                  <strong>LOLA Uncertainty Maps</strong> (<code>*_toterr.tif</code>)
                </td>
                <td>RMS Z elevation uncertainty from co-adjusted tracks &amp; clones</td>
                <td>Display vertical precision boundaries &amp; horizon uncertainty</td>
                <td className="amber">
                  Center RMS Error = ±{terrain_mesh_3d?.center_uncertainty_m?.toFixed(3)} m · Median = ±
                  {terrain_mesh_3d?.median_uncertainty_m?.toFixed(3)} m
                </td>
              </tr>
              <tr>
                <td>
                  <strong>LOLA South Pole 80 m/pixel</strong>
                </td>
                <td>Wide-area regional polar relief DEM</td>
                <td>Detect distant mountains/massifs that block low-elevation horizon</td>
                <td>Integrated with horizon profile service (<code>core/horizon.py</code>)</td>
              </tr>
              <tr>
                <td>
                  <strong>JPL Horizons</strong> (<code>DE441</code>)
                </td>
                <td>Topocentric Sun (10) &amp; Earth (399) Az/El by UTC date &amp; site</td>
                <td>Calculate solar illumination, Earth LoS windows &amp; 3D ENU vectors</td>
                <td className="green">
                  Earth LoS = {metrics.earth_visible_hours.toFixed(1)}h / {metrics.total_hours.toFixed(1)}h · Range ={' '}
                  {metrics.mean_range_km.toLocaleString()} km
                </td>
              </tr>
              <tr>
                <td>
                  <strong>LROC / Moon Trek</strong>
                </td>
                <td>Visual lunar imagery &amp; polar orthographic basemaps</td>
                <td>Visual explorer context &amp; 3D surface shading</td>
                <td>South Polar Stereographic MOON_ME alignment</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
