import { useEffect, useState } from 'react'
import { ArrowDownToLine, ExternalLink, Sun, Moon, Clock3, Database, ChevronRight } from 'lucide-react'
import type { LunarSite, SolarResult, SolarSample } from '../mission/types'

export function utcLabel(value: string, full = false) {
  const date = new Date(value)
  return date.toLocaleString('en-GB', { timeZone: 'UTC', month: 'short', day: '2-digit', ...(full ? { year: 'numeric' } : {}), hour: '2-digit', minute: '2-digit', hour12: false })
}

function SeriesChart({ samples, azimuth = false, selected, onSelect, body = 'Sun' }: { samples: SolarSample[]; azimuth?: boolean; selected: number; onSelect: (index: number) => void; body?: 'Sun' | 'Earth' }) {
  const width = 800, height = 208, left = 46, right = 17, top = 14, bottom = 37
  const start = Date.parse(samples[0].t_utc), end = Date.parse(samples[samples.length - 1].t_utc)
  const x = (sample: SolarSample) => left + (Date.parse(sample.t_utc) - start) / (end - start || 1) * (width - left - right)
  const values = samples.flatMap(sample => [sample.elevation_deg, sample.horizon_deg, 0])
  const min = azimuth ? 0 : Math.floor(Math.min(...values) - 1)
  const max = azimuth ? 360 : Math.ceil(Math.max(...values) + 1)
  const y = (value: number) => height - bottom - (value - min) / (max - min || 1) * (height - top - bottom)
  const path = (key: 'azimuth_deg' | 'elevation_deg' | 'horizon_deg') => samples.map((sample, index) => `${index === 0 || (key === 'azimuth_deg' && Math.abs(sample.azimuth_deg - samples[index - 1].azimuth_deg) > 180) ? 'M' : 'L'}${x(sample).toFixed(2)},${y(sample[key]).toFixed(2)}`).join(' ')
  return <div className="science-chart-wrap"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={azimuth ? `${body} azimuth in degrees over UTC time` : `${body} elevation and horizon in degrees over UTC time`}>
    {!azimuth && samples.slice(0, -1).map((sample, index) => !sample.visible && <rect key={sample.t_utc} x={x(sample)} y={top} width={Math.max(0, x(samples[index + 1]) - x(sample) + .25)} height={height - top - bottom} fill="#070d14" opacity=".55" />)}
    {Array.from({ length: 5 }, (_, index) => min + (max - min) * index / 4).map(value => <g key={value}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} stroke="#afc7d026" strokeDasharray="2 5" /><text x={left - 9} y={y(value) + 3} textAnchor="end" fill="#8ea7b1" fontSize="9">{value.toFixed(azimuth ? 0 : 1)}°</text></g>)}
    {!azimuth && <path d={path('horizon_deg')} fill="none" stroke="#9db9c5" strokeWidth="1.6" strokeDasharray="5 4" />}
    <path d={path(azimuth ? 'azimuth_deg' : 'elevation_deg')} fill="none" stroke={azimuth ? '#a8cbd3' : '#dfc78e'} strokeWidth="2" strokeLinejoin="round" />
    {[0, .25, .5, .75, 1].map(fraction => <text key={fraction} x={left + fraction * (width - left - right)} y={height - 12} fill="#91a8b3" fontSize="8" textAnchor={fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle'}>{utcLabel(new Date(start + fraction * (end - start)).toISOString())}</text>)}
    <line x1={x(samples[selected])} x2={x(samples[selected])} y1={top} y2={height - bottom} stroke="#dce7d7" opacity=".45" />
    <circle cx={x(samples[selected])} cy={y(azimuth ? samples[selected].azimuth_deg : samples[selected].elevation_deg)} r="3" fill={azimuth ? '#b6d6dd' : '#efd29a'} stroke="#101d28" strokeWidth="1.5" />
    <rect x={left} y={top} width={width - left - right} height={height - top - bottom} fill="transparent" onPointerMove={event => {
      const rect = event.currentTarget.ownerSVGElement!.getBoundingClientRect()
      const fraction = Math.max(0, Math.min(1, ((event.clientX - rect.left) / rect.width * width - left) / (width - left - right)))
      onSelect(Math.round(fraction * (samples.length - 1)))
    }} />
  </svg></div>
}

export function MetricCards({ result, body = 'Sun' }: { result: SolarResult; body?: 'Sun' | 'Earth' }) {
  return <div className="science-metrics"><article><Sun size={18} /><span>{body === 'Sun' ? 'SOLAR' : 'EARTH'} VISIBILITY</span><strong>{(result.summary.sun_visible_fraction * 100).toFixed(1)}<small>%</small></strong><p>of the sampled interval</p></article><article><Clock3 size={18} /><span>{body === 'Sun' ? 'ILLUMINATED' : 'VISIBLE'} TIME</span><strong>{result.summary.sun_visible_hours.toFixed(1)}<small>h</small></strong><p>geometric visibility proxy</p></article><article><Moon size={18} /><span>LONGEST {body === 'Sun' ? 'DARK' : 'HIDDEN'} GAP</span><strong>{result.summary.longest_dark_gap_hours.toFixed(1)}<small>h</small></strong><p>sampled, not exact transitions</p></article></div>
}

export function DataQualityNotice({ result }: { result: SolarResult }) {
  return <section className="science-quality"><div className="science-quality-heading"><Database size={15} /><strong>Real ephemerides. Transparent assumptions.</strong><span>{result.meta.cache_hit ? 'TRACEABLE CACHE' : 'NASA / JPL HORIZONS'}</span></div><dl><div><dt>Source</dt><dd><a href={result.meta.source_url} target="_blank" rel="noreferrer">{result.meta.source}<ExternalLink size={10} /></a></dd></div><div><dt>Retrieved</dt><dd>{utcLabel(result.meta.retrieved_at, true)} UTC</dd></div><div><dt>Sampling</dt><dd>{result.meta.step_minutes} min</dd></div><div><dt>Horizon</dt><dd>{result.meta.horizon_mode === 'flat' ? 'Flat horizon approximation' : 'Local terrain horizon'}</dd></div><div><dt>Observer height</dt><dd>{result.meta.observer_height_m} m</dd></div></dl><ul>{(result.meta.limitations || []).map(warning => <li key={warning}>{warning}</li>)}</ul><p>Visibility is geometric. It does not certify a safe landing, available electrical power, or a radio link. Window boundaries are limited by the sampling interval.</p>{result.meta.query_url && <a className="science-source-link" href={result.meta.query_url} target="_blank" rel="noreferrer">Open the original JPL query<ExternalLink size={12} /></a>}</section>
}

export function SolarDashboard({ result, site, body = 'Sun' }: { result: SolarResult; site: LunarSite; body?: 'Sun' | 'Earth' }) {
  const [selected, setSelected] = useState(0)
  const [showAzimuth, setShowAzimuth] = useState(false)
  useEffect(() => setSelected(0), [result])
  const selectedIndex = Math.min(selected, result.samples.length - 1)
  const sample = result.samples[selectedIndex]
  function exportCsv() {
    const rows = ['t_utc,azimuth_deg,elevation_deg,horizon_deg,visible', ...result.samples.map(s => [s.t_utc, s.azimuth_deg, s.elevation_deg, s.horizon_deg, s.visible].join(','))]
    const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = `lunar-oracle-${site.id}-${body.toLowerCase()}.csv`; link.click(); URL.revokeObjectURL(url)
  }
  return <><MetricCards result={result} body={body} /><section className="science-card science-solar-chart"><div className="science-card-heading"><div><span className="science-eyebrow">{body.toUpperCase()} / TOPOCENTRIC OBSERVER ON THE MOON</span><h3>{body === 'Sun' ? 'Follow the light.' : 'Keep home in sight.'}</h3></div><button className="science-text-button" onClick={exportCsv}><ArrowDownToLine size={14} />Export CSV</button></div><div className="science-chart-legend"><span><i className="solar" />{body} elevation</span><span><i className="horizon" />Horizon</span><span><i className="darkness" />Below horizon</span><span className="science-chart-site">{site.name}</span></div><SeriesChart samples={result.samples} body={body} selected={selectedIndex} onSelect={setSelected} /><label className="science-sample-slider"><span>Inspect an instant <span>UTC</span></span><input type="range" aria-label={`Inspect ${body.toLowerCase()} sample`} min="0" max={result.samples.length - 1} value={selectedIndex} onChange={e => setSelected(Number(e.target.value))} /></label><div className="science-sample-readout"><time dateTime={sample.t_utc}>{utcLabel(sample.t_utc)} UTC</time><span>AZ <strong>{sample.azimuth_deg.toFixed(3)}°</strong></span><span>EL <strong>{sample.elevation_deg.toFixed(3)}°</strong></span><span>HORIZON <strong>{sample.horizon_deg.toFixed(3)}°</strong></span><span className={sample.visible ? 'visible' : 'dark'}>{sample.visible ? `${body.toUpperCase()} ABOVE HORIZON` : `${body.toUpperCase()} NOT ABOVE HORIZON`}</span></div><button className="science-azimuth-toggle" onClick={() => setShowAzimuth(value => !value)} aria-expanded={showAzimuth}><ChevronRight size={12} className={showAzimuth ? 'rotated' : ''} />{showAzimuth ? 'Hide' : 'Show'} {body.toLowerCase()} azimuth curve · 0–360°</button>{showAzimuth && <SeriesChart samples={result.samples} body={body} azimuth selected={selectedIndex} onSelect={setSelected} />}</section><section className="science-card science-windows"><div className="science-card-heading"><div><span className="science-eyebrow">SAMPLED VISIBILITY / HALF-OPEN INTERVALS</span><h3>{body === 'Sun' ? 'Solar' : 'Earth'} visibility windows</h3></div><span className="science-small-badge">{result.windows.length} WINDOWS</span></div>{result.windows.length ? <div className="science-window-table"><table><thead><tr><th>Start · UTC</th><th>End · UTC</th><th>Duration</th></tr></thead><tbody>{result.windows.map(window => <tr key={window.start_utc}><td>{utcLabel(window.start_utc)}</td><td>{utcLabel(window.end_utc)}</td><td>{window.duration_hours.toFixed(1)} h</td></tr>)}</tbody></table></div> : <p className="science-empty-inline">The {body} does not exceed the selected horizon during this sampled interval.</p>}<p className="science-table-note">Intervals use [start, end). These are sampled geometric windows, not precise transition predictions.</p></section><DataQualityNotice result={result} /></>
}
