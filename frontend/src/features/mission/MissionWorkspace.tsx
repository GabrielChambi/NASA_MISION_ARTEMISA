import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, ChevronDown, Compass, Database, ExternalLink, Globe2, LoaderCircle, MapPin, Moon, RefreshCw, Rocket, ShieldCheck, SlidersHorizontal, Sun, TriangleAlert, X } from 'lucide-react'
import { MissionProvider, useMission } from './MissionContext'
import { LunarMap2D } from '../sites/LunarMap2D'
import { TerrainLayerPreview } from '../sites/TerrainLayerPreview'
import { fetchSites, fetchSolar } from '../solar/SolarApiClient'
import { DataQualityNotice, MetricCards, SolarDashboard } from '../solar/SolarDashboard'
import type { LunarSite, SolarResult, WorkspaceView } from './types'
import './workspace.css'

type Props = { initialSiteId: string; onSelectSite?: (siteId: string) => void; onClose?: () => void }
const tabs: { id: WorkspaceView; label: string; icon: typeof Compass }[] = [
  { id: 'explorer', label: 'Lunar explorer', icon: Compass }, { id: 'solar', label: 'Solar observatory', icon: Sun }, { id: 'earth', label: 'Earth visibility', icon: Globe2 }, { id: 'compare', label: 'Compare sites', icon: SlidersHorizontal }, { id: 'evidence', label: 'Scientific evidence', icon: Database },
]
const names = { explorer: 'Choose your lunar horizon.', solar: 'Find your window of light.', earth: 'A line of sight to home.', compare: 'Same mission. Two perspectives.', evidence: 'Every result has a source.' }
const descriptions = { explorer: 'Explore the south pole. Select a study region, then investigate the conditions of your mission.', solar: 'Solar geometry from JPL Horizons, evaluated against an explicitly selected horizon.', earth: 'Understand which evidence is needed before a geometric view of Earth becomes a visibility result.', compare: 'Compare solar visibility with identical dates, observer height and horizon assumptions.', evidence: 'Follow the data from its NASA source to the calculation, with its limitations in view.' }
type Acquisition = { url: string; status: string; resolution_m?: number; retrieved_at?: string; point_value?: number }
const datasetProducts = [
  ...['Site01', 'Site04'].flatMap(site => [
    { name: `${site} · elevation`, kind: '5 m / pixel · GeoTIFF', file: `${site}_final_adj_5mpp_surf.tif`, url: `https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/${site}/${site}_final_adj_5mpp_surf.tif`, use: 'Local surface model and regional coverage.' },
    { name: `${site} · slope`, kind: '5 m / pixel · GeoTIFF', file: `${site}_final_adj_5mpp_slp.tif`, url: `https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/${site}/${site}_final_adj_5mpp_slp.tif`, use: 'Surface slope; independent of landing safety approval.' },
    { name: `${site} · uncertainty`, kind: '5 m / pixel · GeoTIFF', file: `${site}_final_adj_5mpp_toterr.tif`, url: `https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/${site}/${site}_final_adj_5mpp_toterr.tif`, use: 'Elevation uncertainty accompanying the regional model.' },
  ]),
  { name: 'South pole · regional elevation', kind: '80 m / pixel · GeoTIFF', file: 'LDEM_80S_80MPP_ADJ.TIF', url: 'https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF', use: 'Regional terrain for obstacles beyond a local site crop.' },
]

export default function MissionWorkspace(props: Props) {
  return <MissionProvider initialSiteId={props.initialSiteId}><WorkspaceContent {...props} /></MissionProvider>
}

function WorkspaceContent({ onSelectSite, onClose }: Props) {
  const { mission, updateMission } = useMission()
  const [view, setView] = useState<WorkspaceView>('explorer')
  const [sites, setSites] = useState<LunarSite[]>([])
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState('')
  const [results, setResults] = useState<Record<string, SolarResult>>({})
  const [loading, setLoading] = useState(false)
  const [dataError, setDataError] = useState('')
  const [revision, setRevision] = useState(0)
  const [evidence, setEvidence] = useState<{ datasets?: Acquisition[] } | null>(null)
  const selectedSite = sites.find(site => site.id === mission.siteIds[0])
  const primary = results[mission.siteIds[0]]
  const secondary = results[mission.siteIds[1]]
  const queryKey = JSON.stringify(mission)
  const comparison = view === 'compare'
  const target = view === 'earth' ? 'earth' : 'solar'
  const queriedSites = useMemo(() => comparison ? mission.siteIds : mission.siteIds.slice(0, 1), [comparison, mission.siteIds])

  useEffect(() => {
    const controller = new AbortController()
    setCatalogLoading(true); setCatalogError('')
    fetchSites(controller.signal).then(setSites).catch(error => { if (!controller.signal.aborted) setCatalogError(error.message) }).finally(() => { if (!controller.signal.aborted) setCatalogLoading(false) })
    return () => controller.abort()
  }, [revision])

  useEffect(() => {
    if (!sites.length) return
    const controller = new AbortController()
    setDataError(''); setResults({})
    const start = Date.parse(mission.startUtc), end = Date.parse(mission.endUtc)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) { setDataError('Choose a valid UTC interval with the end after the start.'); setLoading(false); return }
    setLoading(true)
    const debounce = window.setTimeout(() => {
      // Keep the two NASA observer queries sequential, including the hosted API.
      ;(async () => {
        const entries: (readonly [string, SolarResult])[] = []
        for (const siteId of queriedSites) entries.push([siteId, await fetchSolar(siteId, mission, controller.signal, target)] as const)
        return entries
      })()
        .then(entries => { if (!controller.signal.aborted) setResults(Object.fromEntries(entries)) })
        .catch(error => { if (!controller.signal.aborted) setDataError(error.message || 'No validated data available.') })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 250)
    return () => { window.clearTimeout(debounce); controller.abort() }
  // The serialized mission key captures all shared scenario parameters without stale responses.
  }, [queryKey, sites, comparison, target, revision])

  useEffect(() => {
    if (view !== 'evidence') return
    const controller = new AbortController()
    fetch('/api/datasets', { signal: controller.signal }).then(r => r.ok ? r.json() : null).then(value => { if (!controller.signal.aborted) setEvidence(value) }).catch(() => {})
    return () => controller.abort()
  }, [view])

  function selectSite(siteId: string) {
    const other = sites.find(site => site.id !== siteId)?.id || mission.siteIds[1]
    updateMission({ siteIds: [siteId, other] })
    onSelectSite?.(siteId)
  }
  function utcInput(value: string) { return value.slice(0, 16) }
  function updateDate(field: 'startUtc' | 'endUtc', value: string) {
    if (value && Number.isFinite(Date.parse(value + 'Z'))) updateMission({ [field]: new Date(value + 'Z').toISOString() })
  }
  return <section className="science-workspace" aria-label="Lunar scientific workspace">
    <div className="science-workspace-top"><div className="science-workspace-brand"><Moon size={22} /><span>LUNAR ORACLE<small>SCIENCE OPERATIONS</small></span></div><span className="science-authentic-badge"><Database size={11} />NASA SOURCE DATA</span>{onClose && <button className="science-return" onClick={onClose}><ArrowLeft size={14} /><span>Return to launch</span><X size={14} /></button>}</div>
    <nav className="science-tabs" aria-label="Science modules">{tabs.map(tab => <button key={tab.id} className={view === tab.id ? 'active' : ''} aria-pressed={view === tab.id} onClick={() => setView(tab.id)}><tab.icon size={16} /><span>{tab.label}</span>{view === tab.id && <i />}</button>)}</nav>
    <div className="science-workspace-body"><header className="science-page-heading"><div><span className="science-eyebrow">MISSION PLANNING / LUNAR SOUTH POLE</span><h2>{names[view]}</h2><p>{descriptions[view]}</p></div><div className="science-coordinate-pill"><MapPin size={14} /><span>{selectedSite ? selectedSite.name : 'SELECT A STUDY REGION'}<small>{selectedSite ? `${selectedSite.latitude_deg.toFixed(5)}° / ${((selectedSite.longitude_deg + 360) % 360).toFixed(5)}° E` : 'Coordinates from the NASA catalog'}</small></span></div></header>

      <div className="science-controls" aria-label="Shared mission parameters"><label><span>PRIMARY STUDY REGION</span><div className="science-select-wrap"><select aria-label="Primary study region" value={mission.siteIds[0]} disabled={!sites.length} onChange={e => selectSite(e.target.value)}>{sites.length ? sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>) : <option value={mission.siteIds[0]}>Loading NASA catalog…</option>}</select><ChevronDown size={12} /></div></label><label><span>START / UTC</span><input type="datetime-local" aria-label="Start date UTC" value={utcInput(mission.startUtc)} onChange={e => updateDate('startUtc', e.target.value)} /></label><label><span>END / UTC</span><input type="datetime-local" aria-label="End date UTC" value={utcInput(mission.endUtc)} onChange={e => updateDate('endUtc', e.target.value)} /></label><label><span>SAMPLING</span><div className="science-select-wrap"><select aria-label="Sampling interval" value={mission.stepMinutes} onChange={e => updateMission({ stepMinutes: Number(e.target.value) })}>{[15, 30, 60, 120].map(step => <option key={step} value={step}>{step} min</option>)}</select><ChevronDown size={12} /></div></label><label><span>HORIZON MODEL</span><div className="science-select-wrap"><select aria-label="Horizon model" value={mission.horizonMode} onChange={e => updateMission({ horizonMode: e.target.value as 'flat' | 'terrain' })}><option value="flat">Flat · 0° approximation</option><option value="terrain">Local terrain · LOLA</option></select><ChevronDown size={12} /></div></label><button className="science-refresh" aria-label="Refresh scientific data" title="Refresh scientific data" onClick={() => setRevision(v => v + 1)}><RefreshCw size={15} className={loading ? 'spinning' : ''} /></button></div>

      <div className="science-scenario-controls"><span><SlidersHorizontal size={13} />SHARED SCENARIO</span><label>Observer height<select aria-label="Observer height" value={mission.observerHeightM} onChange={e => updateMission({ observerHeightM: Number(e.target.value) })}>{[1, 2, 5].map(height => <option key={height} value={height}>{height} m</option>)}</select></label><label>Arrival delay<select aria-label="Arrival delay" value={mission.delayHours} onChange={e => updateMission({ delayHours: Number(e.target.value) })}>{[0, 6, 12, 24].map(delay => <option key={delay} value={delay}>+{delay} h</option>)}</select></label>{mission.delayHours > 0 && <small>Both UTC bounds shift by {mission.delayHours} h. Ephemerides are recalculated.</small>}</div>

      {catalogLoading && <div className="science-loading" role="status"><LoaderCircle size={20} className="spinning" /><span>Loading the NASA study-region catalog…</span></div>}
      {catalogError && <Unavailable error={catalogError} onRetry={() => setRevision(v => v + 1)} />}

      {view === 'explorer' && <div className="science-explorer-grid"><section className="science-card science-map-card"><div className="science-card-heading"><div><span className="science-eyebrow">SOUTH POLAR COORDINATE EXPLORER</span><h3>A place for the next step.</h3></div><span className="science-small-badge">2 REGIONS</span></div><LunarMap2D sites={sites} selectedId={mission.siteIds[0]} onSelect={selectSite} /></section><div className="science-site-list"><div className="science-section-label">SELECT YOUR PRIMARY STUDY REGION</div>{sites.map((site, index) => <button key={site.id} onClick={() => selectSite(site.id)} className={`science-site-card ${site.id === mission.siteIds[0] ? 'selected' : ''}`} aria-pressed={site.id === mission.siteIds[0]}><span className="science-site-number">0{index + 1}</span><div><span className="science-eyebrow">{site.id.toUpperCase()} / NASA LOLA</span><h3>{site.name}</h3><p>{Math.abs(site.latitude_deg).toFixed(5)}° S <span>/</span> {((site.longitude_deg + 360) % 360).toFixed(5)}° E</p><span className={`science-coverage ${site.dem_coverage === 'verified' ? 'verified' : ''}`}><ShieldCheck size={12} />DEM coverage: {site.dem_coverage}</span><SitePixelSummary site={site} /></div><span className="science-site-selected">{site.id === mission.siteIds[0] ? <Check size={15} /> : <ArrowRight size={15} />}</span></button>)}<div className="science-region-note"><MapPin size={15} /><p>These are reference points inside NASA study regions. Selecting a region does not establish a safe or approved landing location.</p></div>{selectedSite && <div className="science-card science-current-region"><span className="science-eyebrow">YOUR SELECTED REGION</span><h3>{selectedSite.name}</h3><p>{selectedSite.coordinate_quality || 'Coordinates derived from the source-region metadata. Read the scientific evidence before interpreting results.'}</p><RegionMeasurements site={selectedSite} /><a href={selectedSite.source_url} target="_blank" rel="noreferrer">View source region<ExternalLink size={11} /></a><div className="science-region-actions"><button onClick={() => setView('solar')}>Explore solar conditions<Sun size={14} /></button>{onClose && <button onClick={onClose}>Use for launch preview<Rocket size={14} /></button>}</div></div>}</div></div>}

      {view === 'explorer' && selectedSite && <TerrainLayerPreview site={selectedSite} />}

      {(view === 'solar' || view === 'compare' || view === 'earth') && <>{loading && <div className="science-loading" role="status"><LoaderCircle size={22} className="spinning" /><div><strong>Retrieving scientific ephemerides…</strong><span>Querying JPL Horizons or a traceable stored response. No illustrative values are substituted.</span></div></div>}{dataError && <Unavailable error={dataError} onRetry={() => setRevision(v => v + 1)} />}{!loading && !dataError && primary && selectedSite && (view !== 'compare' ? <SolarDashboard result={primary} site={selectedSite} body={view === 'earth' ? 'Earth' : 'Sun'} /> : secondary ? <><div className="science-comparison-intro"><SlidersHorizontal size={17} /><p>Both regions use the same UTC interval, {mission.stepMinutes}-minute sampling, {mission.observerHeightM} m observer height and {mission.horizonMode} horizon. This is a solar comparison; no overall landing-safety score is assigned.</p></div><div className="science-comparison-grid">{mission.siteIds.map(id => { const result = results[id]; const site = sites.find(s => s.id === id)!; return <section key={id} className="science-card science-compare-site"><span className="science-eyebrow">{id.toUpperCase()} / SOLAR GEOMETRY</span><h3>{site.name}</h3><MetricCards result={result} /><p>{result.windows.length} sampled visibility windows</p><DataQualityNotice result={result} /></section> })}</div><section className="science-comparison-difference"><Sun size={18} /><div><strong>{Math.abs(primary.summary.sun_visible_hours - secondary.summary.sun_visible_hours).toFixed(1)} h difference in sampled solar visibility</strong><p>{primary.summary.sun_visible_hours === secondary.summary.sun_visible_hours ? 'These conditions produce equal visible duration. Terrain or another interval may change the comparison.' : `${sites.find(s => s.id === (primary.summary.sun_visible_hours > secondary.summary.sun_visible_hours ? mission.siteIds[0] : mission.siteIds[1]))?.name} has more Sun-above-horizon time for these assumptions. This alone is not a landing recommendation.`}</p></div></section></> : null)}</>}



      {view === 'evidence' && <><section className="science-quality science-evidence-intro"><div className="science-quality-heading"><ShieldCheck size={16} /><strong>Sources are inputs. Visibility is our model.</strong></div><p>NASA supplies terrain and ephemerides. Lunar Oracle evaluates the selected observer geometry against the chosen horizon, then groups sampled visible instants into windows. Flat-horizon calculations do not include terrain obstructions.</p><div className="science-evidence-links"><a href="https://ssd-api.jpl.nasa.gov/doc/horizons.html" target="_blank" rel="noreferrer">JPL Horizons API<ExternalLink size={12} /></a><a href="https://pgda.gsfc.nasa.gov/products/78" target="_blank" rel="noreferrer">NASA LOLA regions<ExternalLink size={12} /></a><a href="https://trek.nasa.gov/moon/" target="_blank" rel="noreferrer">NASA Moon Trek<ExternalLink size={12} /></a><a href="https://quickmap.lroc.asu.edu/" target="_blank" rel="noreferrer">LROC QuickMap<ExternalLink size={12} /></a></div></section><div className="science-section-label">SEVEN TERRAIN SOURCE PRODUCTS · OFFICIAL NASA DOWNLOADS</div><div className="science-dataset-grid">{datasetProducts.map((product, index) => <article key={product.file} className="science-card science-dataset"><div><span className="science-dataset-index">{String(index + 1).padStart(2, '0')}</span><Database size={16} /></div><h3>{product.name}</h3><span className="science-eyebrow">{product.kind}</span><p>{product.use}</p><AcquisitionStatus item={evidence?.datasets?.find(item => item.url === product.url)} /><code>{product.file}</code><a href={product.url} target="_blank" rel="noreferrer">Open NASA source<ExternalLink size={12} /></a></article>)}</div><p className="science-table-note">The inventory lists source products; listing a file does not mean the entire raster has been downloaded or incorporated. Check model provenance and acquisition metadata for what a result actually used.</p>{evidence !== null && <details className="science-acquisition"><summary>Inspect acquisition metadata from the scientific API</summary><pre>{JSON.stringify(evidence, null, 2)}</pre></details>}{primary && <DataQualityNotice result={primary} />}<section className="science-card science-methodology"><span className="science-eyebrow">HOW TO READ A RESULT</span><h3>Four assumptions to keep in view.</h3><ol><li><strong>Coordinates and frames.</strong> Markers represent study-region reference points; regional NASA DEM coverage does not constitute landing approval.</li><li><strong>Apparent geometry.</strong> Solar azimuth and elevation come from a topocentric JPL Horizons observer on the Moon.</li><li><strong>Horizon and resolution.</strong> Flat mode assumes 0°. Terrain mode must declare coverage, nodata and distant-obstacle limitations. Sampled windows are not exact transition times.</li><li><strong>Scope.</strong> Illumination is not electricity, Earth visibility is not a radio link, and this application does not certify a safe landing.</li></ol></section></>}
      <footer className="science-workspace-footer"><span><Database size={11} />Real source data · explicit assumptions · reproducible queries</span><span>UTC THROUGHOUT / LUNAR ORACLE</span></footer>
    </div>
  </section>
}

function Unavailable({ error, onRetry }: { error: string; onRetry: () => void }) {
  return <div className="science-unavailable" role="alert"><TriangleAlert size={24} /><div><strong>Scientific data unavailable</strong><p>{error}</p><span>No validated data available. No NASA result is inferred from this state.</span></div><button onClick={onRetry}><RefreshCw size={13} />Try again</button></div>
}

function RegionMeasurements({ site }: { site: LunarSite }) {
  return <dl className="science-region-measurements">{Number.isFinite(site.elevation_m) && <div><dt>Elevation</dt><dd>{site.elevation_m!.toFixed(1)} m</dd></div>}{Number.isFinite(site.slope_deg) && <div><dt>Reference-pixel slope</dt><dd>{site.slope_deg!.toFixed(2)}?</dd></div>}{Number.isFinite(site.height_uncertainty_m) && <div><dt>Height uncertainty</dt><dd>{site.height_uncertainty_m!.toFixed(3)} m</dd></div>}</dl>
}
function AcquisitionStatus({ item }: { item?: Acquisition }) {
  const label = item?.status === 'downloaded_verified' ? 'Downloaded ? metadata verified' : item?.status === 'point_sample_verified' ? 'Reference-pixel sample verified' : item?.status?.replaceAll('_', ' ') || 'Source listed ? acquisition not confirmed'
  return <span className={`science-acquisition-status ${item ? 'acquired' : ''}`}><ShieldCheck size={11} />{label}</span>
}

function SitePixelSummary({ site }: { site: LunarSite }) {
  return <div className="science-site-pixel-summary">{Number.isFinite(site.slope_deg) && <span>Reference-pixel slope <strong>{site.slope_deg!.toFixed(2)}?</strong></span>}{Number.isFinite(site.height_uncertainty_m) && <span>Height uncertainty <strong>{site.height_uncertainty_m!.toFixed(3)} m</strong></span>}</div>
}
