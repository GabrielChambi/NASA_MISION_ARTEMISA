import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowDown, ArrowRight, Check, ChevronDown, Compass, Database, Download, ExternalLink, Globe2, Layers3, LoaderCircle, MapPin, Moon, Pause, Play, Radio, RefreshCw, Rocket, RotateCcw, SlidersHorizontal, Sun, TriangleAlert } from 'lucide-react'
import { useMission } from './MissionContext'
import { fetchSites, fetchSolar } from '../solar/SolarApiClient'
import { analyzeStudy, rankStudies, utcLabel } from './missionAnalysis'
import type { Requirements, Study, StudyMetrics } from './missionAnalysis'
import { DEFAULT_DESCENT, descentAt, PHYSICS_SOURCES, simulateDescent } from './descentPhysics'
import type { DescentConfig, DescentRun } from './descentPhysics'
import type { LunarSite, MissionParameters, SolarResult } from './types'
import './planner.css'

const PolarTerrainAtlas = lazy(() => import('../sites/PolarTerrainAtlas'))
const MissionWorkspace = lazy(() => import('./MissionWorkspace'))
const defaultRules: Requirements = { minimumSunHours: 12, minimumEarthHours: 12, maxSlopeDeg: 10, earthClearanceDeg: 0 }
type Analysis = { key: string; studies: Study[] }
type RunState = { run: DescentRun; siteId: string; epoch: string; queryKey: string }
type Baseline = { studies: Study[]; mission: MissionParameters }
const number = (value: number | undefined, digits = 1) => value === undefined ? '—' : value.toFixed(digits)
const degrees = (value: number | undefined) => number(value, 2) + (value === undefined ? '' : '°')
const missionKey = (m: MissionParameters) => JSON.stringify([m.startUtc, m.endUtc, m.stepMinutes, m.horizonMode, m.delayHours, m.observerHeightM])
function download(value: unknown, fileName: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = fileName; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function MissionPlanner() {
  const { mission, updateMission, requirements: rules, updateRequirements } = useMission()
  const [draft, setDraft] = useState(mission)
  const [sites, setSites] = useState<LunarSite[]>([])
  const [catalogError, setCatalogError] = useState('')
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [dataError, setDataError] = useState('')
  const [progress, setProgress] = useState(0)
  const [retry, setRetry] = useState(0)
  const [index, setIndex] = useState(0)
  const [advanced, setAdvanced] = useState(false)
  const [baseline, setBaseline] = useState<Baseline | null>(null)
  const [descentConfig, setDescentConfig] = useState<DescentConfig>(DEFAULT_DESCENT)
  const [flight, setFlight] = useState<RunState | null>(null)
  const [flightTime, setFlightTime] = useState(0)
  const [flying, setFlying] = useState(false)
  const [speed, setSpeed] = useState(10)
  const [physicsError, setPhysicsError] = useState('')
  const [focusRevision, setFocusRevision] = useState(0)
  const mapAnchor = useRef<HTMLDivElement>(null)
  const queryKey = missionKey(mission)
  const pendingChanges = missionKey(draft) !== queryKey
  const selectedId = mission.siteIds[0]
  const selectedSite = sites.find(s => s.id === selectedId)
  const studies = analysis?.key === queryKey ? analysis.studies : []
  const ready = studies.length === sites.length && sites.length > 0
  const study = studies.find(s => s.site.id === selectedId)
  const ranked = useMemo(() => {
    try { return { rows: rankStudies(studies, rules), error: '' } }
    catch (e) { return { rows: [], error: (e as Error).message } }
  }, [analysis, queryKey, rules, sites])
  const canFly = ready && !dataError && !catalogError && !ranked.error && !pendingChanges
  const metrics = ranked.rows.find(s => s.site.id === selectedId)?.metrics
  const selectedSample = study?.solar.samples[Math.min(index, study.solar.samples.length - 1)]
  const currentFlight = flight?.queryKey === queryKey && flight.siteId === selectedId ? flight : null
  const descentSample = currentFlight ? descentAt(currentFlight.run, flightTime) : null
  const finished = !!currentFlight && flightTime >= currentFlight.run.durationS
  const landed = finished && currentFlight?.run.outcome !== 'timeout'
  const displayedIndex = currentFlight && study ? Math.max(0, study.solar.samples.reduce((found,s,i) => Date.parse(s.t_utc) <= Date.parse(currentFlight.epoch) + flightTime * 1000 ? i : found, 0)) : index
  const solarNow = study?.solar.samples[displayedIndex]
  const earthForAtlas = useMemo(() => study ? { ...study.earth, samples: study.earth.samples.map(s => ({ ...s, visible: s.elevation_deg - s.horizon_deg > rules.earthClearanceDeg })) } : undefined, [study, rules.earthClearanceDeg])
  const previous = baseline?.studies.find(s => s.site.id === selectedId)
  const previousMetrics = previous ? analyzeStudy(previous, rules) : null

  useEffect(() => {
    const controller = new AbortController(); setCatalogError('')
    fetchSites(controller.signal).then(setSites).catch(e => { if (!controller.signal.aborted) setCatalogError(e.message) })
    return () => controller.abort()
  }, [retry])
  useEffect(() => { setDraft(mission) }, [queryKey])
  useEffect(() => { setFlight(null); setFlying(false); setFlightTime(0); setIndex(0) }, [queryKey, selectedId])
  useEffect(() => {
    if (!sites.length || advanced || analysis?.key === queryKey) return
    const controller = new AbortController(); setDataError(''); setProgress(0)
    const timer = setTimeout(() => {
      ;(async () => {
        const found: Study[] = []
        for (const site of sites) {
          const solar = await fetchSolar(site.id, mission, controller.signal)
          if (controller.signal.aborted) return
          setProgress(v => v + 1)
          const earth = await fetchSolar(site.id, mission, controller.signal, 'earth')
          if (controller.signal.aborted) return
          analyzeStudy({ site, solar, earth }, defaultRules)
          found.push({ site, solar, earth }); setProgress(v => v + 1)
        }
        if (!controller.signal.aborted) setAnalysis({ key: queryKey, studies: found })
      })().catch(e => { if (!controller.signal.aborted) { setAnalysis(null); setDataError(e.message || 'No hay una respuesta NASA válida para esta consulta.') } })
    }, 200)
    return () => { clearTimeout(timer); controller.abort() }
  }, [queryKey, sites, retry, advanced])
  useEffect(() => {
    if (!flying || !currentFlight) return
    let frame = 0, last = performance.now()
    function tick(now: number) {
      const dt = Math.min((now - last) / 1000, 0.2); last = now
      setFlightTime(t => Math.min(currentFlight!.run.durationS, t + dt * speed))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [flying, currentFlight, speed])
  useEffect(() => { if (advanced || pendingChanges) setFlying(false) }, [advanced,pendingChanges])
  useEffect(() => { if (finished) { setFlying(false); setFocusRevision(v => v + 1) } }, [finished])

  function selectSite(id: string) { updateMission({ siteIds: [id, ...sites.filter(s => s.id !== id).map(s => s.id)] }) }
  function applyMission(event: FormEvent) {
    event.preventDefault()
    const start = Date.parse(draft.startUtc), end = Date.parse(draft.endUtc)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end-start < 3600000 || end-start > 31*86400000) { setDataError('Elige un intervalo UTC de 1 hora a 31 días, con fin posterior al inicio.'); return }
    if (studies.length) setBaseline({ studies, mission: { ...mission } })
    setAnalysis(null); updateMission({ ...draft, siteIds: mission.siteIds })
    if (missionKey(draft) === queryKey) setRetry(v => v + 1)
  }
  function changeEpoch(value: number) { setIndex(value); setFlight(null); setFlying(false); setFlightTime(0) }
  function startDescent() {
    if (!selectedSite || !selectedSample || !canFly) return
    try {
      const run = simulateDescent({ ...descentConfig, surfaceElevationM: selectedSite.elevation_m ?? 0 })
      if (Date.parse(selectedSample.t_utc)+run.durationS*1000 > Date.parse(mission.endUtc)+mission.delayHours*3600000) throw new Error('Elige una hora anterior: el descenso debe terminar dentro del intervalo NASA calculado.')
      setPhysicsError(''); setFlight({ run, siteId: selectedId, epoch: selectedSample.t_utc, queryKey })
      setFlightTime(0); setFlying(true); setFocusRevision(v => v + 1)
      mapAnchor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch (e) { setPhysicsError((e as Error).message) }
  }
  function exportEvidence() {
    download({ schema: 'lunar-oracle-mission/v1', exported_at: new Date().toISOString(), mission, requirements: rules,
      methodology: { visibility: 'centre elevation > sampled terrain horizon + clearance (Earth only)', windows: 'half-open intervals, left sample; final sample adds no duration', scope: 'geometric visibility, not electrical power or RF link budget', horizon_coverage: 'partial finite DEM rays; see each NASA result meta', ranking: 'requirements met, joint hours, Sun hours, Earth hours; equal values remain a tie' },
      studies: ranked.rows, baseline, descent: currentFlight ? { ...currentFlight, integrator: 'RK4, 0.1 s; fuel-depletion splitting; surface intersection bisection', sources: PHYSICS_SOURCES, scope: 'radial vertical descent; fixed latitude/longitude; editable hypothetical vehicle; no orbital flight or certified landing safety' } : null }, 'lunar-oracle-mission.json')
  }

  return <div className="mission-planner">
    <header className="planner-nav"><a className="planner-brand" href="/" aria-label="Lunar Oracle inicio"><span className="planner-logo"><Moon size={23}/><i/></span><span>LUNAR ORACLE<small>NASA SPACE APPS · MISSION PLANNER</small></span></a><nav><button className={!advanced?'active':''} onClick={() => setAdvanced(false)}><Compass size={14}/>Planificar misión</button><button className={advanced?'active':''} onClick={() => setAdvanced(true)} aria-label="Explore NASA data"><Database size={14}/>Datos y método</button></nav><a className="planner-github" href="https://github.com/GabrielChambi/NASA_MISION_ARTEMISA" target="_blank" rel="noreferrer">GitHub<ExternalLink size={12}/></a></header>
    {advanced ? <Suspense fallback={<Loading text="Abriendo herramientas científicas…"/>}><MissionWorkspace initialSiteId={selectedId} onSelectSite={selectSite} onClose={() => setAdvanced(false)}/></Suspense> : <main className="planner-main">
      <section className="planner-intro"><div><span className="planner-eyebrow"><i/>EXPLORAR. COMPARAR. DECIDIR.</span><h1>Tu próximo paso,<br/><em>en la Luna.</em></h1><p>Elige un lugar. Encuentra su ventana de luz y conexión.<br/>Comprueba cada decisión con datos reales de NASA.</p></div><div className="planner-intro-note"><span>EL POLO SUR, CON DATOS</span><strong>02<small>regiones de estudio</small></strong><p><Database size={12}/>Topografía LOLA · Efemérides JPL Horizons</p><p><Radio size={12}/>Visibilidad geométrica · horas UTC</p></div></section>
      <section className="planner-steps" aria-label="Pasos para planificar"><button onClick={()=>document.getElementById('mission-setup')?.scrollIntoView({behavior:'smooth'})}><b>01</b>Elige lugar y fecha<ArrowRight size={15}/></button><button onClick={()=>document.getElementById('mission-conditions')?.scrollIntoView({behavior:'smooth'})}><b>02</b>Compara las condiciones<ArrowRight size={15}/></button><button onClick={()=>document.getElementById('mission-descent')?.scrollIntoView({behavior:'smooth'})}><b>03</b>Ensaya el descenso<ArrowDown size={15}/></button></section>
      <div className="planner-grid">
        <aside className="planner-config" id="mission-setup">
          <section className="planner-card"><div className="planner-card-title"><span>01 / TU MISIÓN</span><MapPin size={16}/></div><h2>¿Dónde y cuándo?</h2>
            <label className="planner-field">Punto de estudio<select aria-label="Punto de estudio" value={selectedId} onChange={e => selectSite(e.target.value)} disabled={!sites.length}>{sites.map(s => <option value={s.id} key={s.id}>{s.id==='site01'?'01':'04'} · {s.name}</option>)}</select></label>
            {selectedSite&&<p className="planner-coordinates">{Math.abs(selectedSite.latitude_deg).toFixed(6)}° S <span>/</span> {((selectedSite.longitude_deg+360)%360).toFixed(6)}° E<br/><small>Elevación {number(selectedSite.elevation_m)} m · pendiente {degrees(selectedSite.slope_deg)}</small></p>}
            <form onSubmit={applyMission}>
              <label className="planner-field">Inicio de la misión · UTC<input aria-label="Inicio de misión UTC" type="datetime-local" required min="1962-01-01T00:00" max="2099-12-01T00:00" step={60} value={draft.startUtc.slice(0,16)} onChange={e => setDraft(v => ({...v,startUtc:e.target.value+':00Z'}))}/></label>
              <label className="planner-field">Fin del análisis · UTC<input aria-label="Fin de misión UTC" type="datetime-local" required step={60} value={draft.endUtc.slice(0,16)} onChange={e => setDraft(v => ({...v,endUtc:e.target.value+':00Z'}))}/></label>
              <div className="planner-two"><label className="planner-field">Altura del observador<select aria-label="Altura del observador" value={draft.observerHeightM} onChange={e => setDraft(v => ({...v,observerHeightM:Number(e.target.value)}))}><option value={1}>1 m</option><option value={2}>2 m</option><option value={5}>5 m</option></select></label><label className="planner-field">Muestra cada<select aria-label="Paso temporal" value={draft.stepMinutes} onChange={e => setDraft(v => ({...v,stepMinutes:Number(e.target.value)}))}><option value={60}>60 min</option><option value={30}>30 min</option><option value={10}>10 min</option></select></label></div>
              <label className="planner-field">Horizonte<select aria-label="Modelo de horizonte" value={draft.horizonMode} onChange={e => setDraft(v => ({...v,horizonMode:e.target.value as MissionParameters['horizonMode']}))}><option value="terrain">Relieve NASA LOLA</option><option value="flat">Plano · referencia 0°</option></select></label>
              <button className="planner-primary" type="submit"><RefreshCw size={14}/>Calcular con NASA<ArrowRight size={15}/></button>
            </form><p className="planner-help">Se consultan ambos puntos con idénticas fechas. Cambiar un campo requiere recalcular.</p>
          </section>
          <section className="planner-card planner-criteria"><div className="planner-card-title"><span>CRITERIOS DE COMPARACIÓN</span><SlidersHorizontal size={15}/></div><p>Define lo que necesita tu misión.</p><Rule label="Luz mínima" unit="h" value={rules.minimumSunHours} max={744} onChange={v => updateRequirements({minimumSunHours:v})}/><Rule label="Tierra visible mínima" unit="h" value={rules.minimumEarthHours} max={744} onChange={v => updateRequirements({minimumEarthHours:v})}/><Rule label="Pendiente máxima del punto" unit="°" value={rules.maxSlopeDeg} max={90} onChange={v => updateRequirements({maxSlopeDeg:v})}/><Rule label="Margen sobre horizonte · Tierra" unit="°" value={rules.earthClearanceDeg} max={20} step={0.1} onChange={v => updateRequirements({earthClearanceDeg:v})}/><small>Umbrales elegidos por ti; no son requisitos ni aprobación de NASA.</small></section>
        </aside>
        <div className="planner-map-column">
          <div className="planner-status" role="status" data-testid="mission-data-status" data-state={dataError||catalogError||ranked.error?'error':pendingChanges?'dirty':ready?'ready':'loading'}>{dataError||catalogError||ranked.error?<><TriangleAlert size={15}/><span>{dataError||catalogError||ranked.error}</span><button onClick={() => setRetry(v => v+1)}>Reintentar</button></>:pendingChanges?<><RefreshCw size={15}/><span>Hay cambios sin calcular. Los resultados aún corresponden al cálculo anterior.</span></>:ready?<><Check size={15}/><span>Datos NASA verificados · {study?.solar.samples.length} muestras por astro y sitio</span><small>{mission.horizonMode==='terrain'?'Horizonte LOLA parcial':'Horizonte plano 0°'}</small></>:<><LoaderCircle size={15} className="spinning"/><span>Consultando NASA / JPL Horizons… {progress}/{sites.length*2||4}</span><small>Sin valores de sustitución</small></>}</div>
          <div ref={mapAnchor} className="planner-map-anchor"><Suspense fallback={<Loading text="Reconstruyendo el relieve NASA…"/>}><PolarTerrainAtlas language="es" sites={sites} selectedSiteId={selectedId} onSelectSite={selectSite} solarResult={study?.solar} earthResult={earthForAtlas} timeline={{index:displayedIndex,onChange:changeEpoch}} focusRevision={focusRevision} descent={descentSample&&currentFlight?{sample:descentSample,landed,hardImpact:currentFlight.run.outcome==='hard-impact',startAltitudeM:currentFlight.run.config.altitudeM,playing:flying,durationS:currentFlight.run.durationS,onToggle:()=>{if(finished)setFlightTime(0);setFlying(v=>!v)},onSeek:(t:number)=>{setFlying(false);setFlightTime(t)}}:undefined} onOpenSolar={() => document.getElementById('mission-conditions')?.scrollIntoView({behavior:'smooth'})}/></Suspense></div>
          <section className="planner-card planner-conditions" id="mission-conditions"><div className="planner-card-title"><span>02 / CONDICIONES QUE CAMBIAN</span><span className="planner-live">{solarNow?'JPL HORIZONS':'DATOS PENDIENTES'}</span></div><div className="planner-condition-heading"><h2>El cielo desde tu punto.</h2><time data-testid="conditions-utc">{solarNow?utcLabel(solarNow.t_utc):'Esperando efemérides'}</time></div><p>Desliza el tiempo del mapa y observa las posiciones y el bloqueo del relieve.</p>
            <div className="planner-readouts"><InstantBody name="Sol" result={study?.solar} index={displayedIndex} clearance={0}/><InstantBody name="Tierra" result={study?.earth} index={displayedIndex} clearance={rules.earthClearanceDeg}/></div>
            {study&&<><ElevationChart solar={study.solar} earth={study.earth} index={displayedIndex} clearance={rules.earthClearanceDeg} onChange={changeEpoch}/><div className="planner-duration-grid"><Duration label="Sol sobre horizonte" value={metrics?.sunHours} icon={Sun}/><Duration label="Tierra con margen" value={metrics?.earthHours} icon={Globe2}/><Duration label="Ambos a la vez" value={metrics?.jointHours} icon={Radio}/><Duration label="Mayor oscuridad" value={metrics?.longestDarkHours} icon={Moon}/></div><div className="planner-window-lists"><WindowList label="Ventanas de luz" windows={metrics?.sunWindows||[]}/><WindowList label="Ventanas de Tierra" windows={metrics?.earthWindows||[]}/></div></>}
            <p className="planner-help">Elevación del centro del astro &gt; horizonte local{rules.earthClearanceDeg>0?' + '+rules.earthClearanceDeg+'° de margen para la Tierra':''}. Ventanas estimadas cada {mission.stepMinutes} min; la transición puede ocurrir entre muestras. Ver Tierra no garantiza un enlace de radio.</p>
          </section>
        </div>
      </div>
      <section className="planner-comparison planner-card" aria-label="Comparación de lugares"><div className="planner-card-title"><span>MISMA MISIÓN / DOS ALTERNATIVAS</span><Layers3 size={16}/></div><div className="planner-section-heading"><div><h2>Una decisión con razones.</h2><p>Luz, visibilidad terrestre y pendiente del píxel de referencia, bajo tus criterios.</p></div><button className="planner-secondary" disabled={!ready} onClick={exportEvidence}><Download size={14}/>Descargar evidencia</button></div><div className="planner-compare-grid">{ranked.rows.map(row => <button key={row.site.id} className={'planner-compare-site '+(row.site.id===selectedId?'selected':'')} onClick={() => selectSite(row.site.id)} data-testid={'comparison-'+row.site.id} aria-pressed={row.site.id===selectedId}><div><span>{row.site.id==='site01'?'01':'04'} / {row.site.name}</span>{row.site.id===selectedId?<Check size={14}/>:<ArrowRight size={14}/>}</div><h3 className={row.metrics.meetsRequirements?'positive':'caution'}>{row.metrics.meetsRequirements?'Cumple tus umbrales':'Revisar condiciones'}</h3><dl><div><dt>Luz</dt><dd>{row.metrics.sunHours.toFixed(1)} h</dd></div><div><dt>Tierra</dt><dd>{row.metrics.earthHours.toFixed(1)} h</dd></div><div><dt>Coincidencia</dt><dd>{row.metrics.jointHours.toFixed(1)} h</dd></div><div><dt>Pendiente</dt><dd>{degrees(row.site.slope_deg)}</dd></div></dl><p>{row.metrics.reasons.join(' · ')||'Luz, Tierra y pendiente dentro de los límites seleccionados.'}</p></button>)}</div>{ranked.rows.length===2&&<p className="planner-ranking" data-testid="mission-ranking"><Compass size={16}/>{recommendation(ranked.rows)}</p>}{previousMetrics&&metrics&&<div className="planner-scenario" data-testid="scenario-difference"><RefreshCw size={16}/><div><strong>¿Qué cambió frente al cálculo anterior?</strong><p>{utcLabel(baseline!.mission.startUtc)} → {utcLabel(mission.startUtc)} · Luz: {signed(metrics.sunHours-previousMetrics.sunHours)} h · Tierra: {signed(metrics.earthHours-previousMetrics.earthHours)} h · Coincidencia: {signed(metrics.jointHours-previousMetrics.jointHours)} h</p><small>Anterior: horizonte {baseline!.mission.horizonMode}, altura {baseline!.mission.observerHeightM} m. Actual: {mission.horizonMode}, {mission.observerHeightM} m. Los mismos criterios se aplican a ambos.</small></div></div>}<p className="planner-help">Cada marcador es un píxel de estudio con coordenadas conocidas. La cobertura del horizonte es parcial. Esta comparación no certifica una zona segura ni resuelve obstáculos menores que el DEM.</p></section>
      <section id="mission-descent" className="planner-descent planner-card" aria-label="Simulación física de descenso"><div className="planner-card-title"><span>03 / ENSAYA EL DESCENSO</span><Rocket size={16}/></div><div className="planner-section-heading"><div><h2>Del cálculo al contacto.</h2><p>Un descenso vertical bajo gravedad lunar. Cada segundo sale del modelo físico.</p></div><span className="planner-model-badge">MODELO 1D · NAVE HIPOTÉTICA</span></div>
        <div className="planner-descent-layout"><div><p className="planner-descent-target"><MapPin size={17}/><span>Objetivo en el mapa<strong>{selectedSite?.name||'Selecciona un punto'}<small>{selectedSite?Math.abs(selectedSite.latitude_deg).toFixed(6)+'° S · '+((selectedSite.longitude_deg+360)%360).toFixed(6)+'° E':'—'}</small></strong></span></p><details className="planner-engine"><summary>Ajustar nave y condiciones iniciales<ChevronDown size={13}/></summary><div className="planner-engine-grid">{([['altitudeM','Altura inicial','m'],['downwardSpeedMps','Velocidad hacia abajo','m/s'],['wetMassKg','Masa total inicial','kg'],['dryMassKg','Masa seca','kg'],['maxThrustN','Empuje máximo','N'],['ispS','Impulso específico','s'],['targetSpeedMps','Velocidad objetivo','m/s']] as const).map(([key,label,unit]) => <label className="planner-field" key={key}>{label} · {unit}<input type="number" step="any" aria-label={label} value={descentConfig[key]} onChange={e => {setDescentConfig(c => ({...c,[key]:e.target.valueAsNumber}));setFlight(null);setFlying(false)}}/></label>)}</div><small>Valores iniciales ilustrativos y editables. El relieve y la gravedad sí provienen de NASA; estos parámetros no describen una nave NASA.</small></details><button className="planner-primary" onClick={startDescent} disabled={!canFly}><Rocket size={16}/>{flight?'Recalcular descenso':'Simular descenso'}<ArrowRight size={15}/></button>{physicsError&&<p className="planner-error" role="alert">{physicsError}</p>}<p className="planner-help">Guía automática con empuje limitado, masa variable y agotamiento de propelente. Velocidad horizontal 0; coordenadas fijas. El modelo inicia sobre la Luna; no calcula el viaje desde la Tierra.</p></div>
        <div className="planner-flight-data"><div className="planner-flight-heading"><span>{landed?(currentFlight?.run.outcome==='hard-impact'?'IMPACTO / REVISAR NAVE':'CONTACTO EN EL MODELO'):flying?'DESCENSO EN CURSO':currentFlight?'REPRODUCCIÓN EN PAUSA':'TELEMETRÍA DEL MODELO'}</span><time data-testid="descent-time">T+ {flightTime.toFixed(1)} s</time></div><div className="planner-telemetry"><Telemetry label="Altura sobre el punto" value={descentSample?.altitudeM} unit="m"/><Telemetry label="Velocidad descendente" value={descentSample?Math.abs(descentSample.velocityMps):undefined} unit="m/s" digits={2}/><Telemetry label="Propelente restante" value={descentSample?.fuelKg} unit="kg"/><Telemetry label="Empuje" value={descentSample?descentSample.thrustN/1000:undefined} unit="kN"/><Telemetry label="Masa total" value={descentSample?.massKg} unit="kg"/><Telemetry label="Gravedad local" value={descentSample?.gravityMps2} unit="m/s²" digits={4}/></div>{currentFlight&&<><DescentChart run={currentFlight.run} time={flightTime}/><div className="planner-replay"><button aria-label={flying?'Pausar descenso':'Reproducir descenso'} onClick={() => {if(finished)setFlightTime(0);setFlying(v => !v)}}>{flying?<Pause size={15}/>:<Play size={15}/>}</button><input type="range" aria-label="Tiempo del descenso" min={0} max={currentFlight.run.durationS} step="any" value={flightTime} onChange={e => {setFlying(false);setFlightTime(Number(e.target.value))}}/><select aria-label="Velocidad de reproducción" value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value={1}>1×</option><option value={5}>5×</option><option value={10}>10×</option><option value={30}>30×</option></select><button aria-label="Reiniciar reproducción" onClick={() => {setFlightTime(0);setFlying(false)}}><RotateCcw size={15}/></button></div><p className="planner-flight-outcome" data-testid="descent-outcome">{finished?(currentFlight.run.outcome==='timeout'?'No se alcanzó la superficie en 1800 s.':(currentFlight.run.outcome==='hard-impact'?'Impacto':'Contacto')+' a '+number(currentFlight.run.impactSpeedMps??undefined,2)+' m/s · '+currentFlight.run.fuelUsedKg.toFixed(1)+' kg consumidos · '+currentFlight.run.durationS.toFixed(1)+' s.'):'Duración calculada: '+currentFlight.run.durationS.toFixed(1)+' s. La velocidad de reproducción acelera la visualización.'}</p>{landed&&<button className="planner-secondary" onClick={() => {setFocusRevision(v => v+1);mapAnchor.current?.scrollIntoView({behavior:'smooth'})}}><MapPin size={14}/>Ver punto de contacto en el mapa</button>}<small>UTC del modelo: {utcLabel(new Date(Date.parse(currentFlight.epoch)+flightTime*1000).toISOString())}. Cielo mostrado: última muestra NASA anterior, cada {mission.stepMinutes} min. Contacto ≤ 2 m/s es una clasificación didáctica; no valida estabilidad sobre la pendiente.</small></>}</div></div>
        <details className="planner-method"><summary>Física, fuentes y supuestos del modelo</summary><p>Se integra dh/dt = v; dv/dt = T/m − μ/(R + elevación LOLA + h)²; dm/dt = −T/(Isp · g₀). Integración Runge–Kutta de orden 4 cada 0,1 s, con detección del contacto y corte del motor al agotar combustible. Una guía proporcional ajusta el empuje para frenar hacia la velocidad objetivo. Se omiten movimiento horizontal, rotación, terreno bajo las patas y dinámica orbital.</p><div><a href={PHYSICS_SOURCES.gravity} target="_blank" rel="noreferrer">Gravedad JPL DE440<ExternalLink size={11}/></a><a href={PHYSICS_SOURCES.radius} target="_blank" rel="noreferrer">Radio lunar JPL<ExternalLink size={11}/></a><a href={PHYSICS_SOURCES.propulsion} target="_blank" rel="noreferrer">Propulsión NASA Glenn<ExternalLink size={11}/></a></div></details>
      </section>
      <section className="planner-sources"><Database size={19}/><div><strong>Un dato, una fuente. Un resultado, un método.</strong><p>Topografía medida NASA LOLA, posiciones NASA/JPL Horizons y nombres IAU/USGS. Los colores representan elevación; la iluminación del modelo 3D facilita inspeccionar el relieve.</p><div><a href="https://pgda.gsfc.nasa.gov/products/78" target="_blank" rel="noreferrer">NASA LOLA<ExternalLink size={11}/></a><a href="https://ssd-api.jpl.nasa.gov/doc/horizons.html" target="_blank" rel="noreferrer">Horizons API<ExternalLink size={11}/></a><button onClick={() => setAdvanced(true)}>Ver procedencia y herramientas<ArrowRight size={12}/></button></div></div></section>
      <footer className="planner-footer"><span>LUNAR ORACLE <i/> NASA SPACE APPS</span><span>CONSTRUIDO PARA EXPLORAR CON EVIDENCIA</span></footer>
    </main>}
  </div>
}

function Loading({text}:{text:string}) { return <div className="planner-loading"><LoaderCircle className="spinning" size={20}/>{text}</div> }
function signed(n:number) { return (n>0?'+':'')+n.toFixed(1) }
function Rule({label,value,unit,max,step=1,onChange}:{label:string;value:number;unit:string;max:number;step?:number;onChange:(v:number)=>void}) {
  return <label className="planner-rule"><span>{label}</span><div><input aria-label={label} type="number" value={value} min={0} max={max} step={step} onChange={e => {const v=e.target.valueAsNumber;if(Number.isFinite(v)&&v>=0&&v<=max)onChange(v)}}/><span>{unit}</span></div></label>
}
function InstantBody({name,result,index,clearance}:{name:'Sol'|'Tierra';result?:SolarResult;index:number;clearance:number}) {
  const s=result?.samples[index], margin=s?s.elevation_deg-s.horizon_deg-clearance:undefined, visible=margin!==undefined&&margin>0
  return <article className={'planner-instant '+(name==='Sol'?'sun':'earth')} data-testid={'instant-'+(name==='Sol'?'solar':'earth')}><header>{name==='Sol'?<Sun size={20}/>:<Globe2 size={20}/>}<strong>{name}</strong><span className={visible?'positive':'caution'}>{s?(visible?'Visible':'Oculto / bajo margen'):'Sin datos'}</span></header><dl><div><dt>Elevación</dt><dd data-value="elevation">{degrees(s?.elevation_deg)}</dd></div><div><dt>Azimut</dt><dd>{degrees(s?.azimuth_deg)}</dd></div><div><dt>Horizonte local</dt><dd>{degrees(s?.horizon_deg)}</dd></div><div><dt>Despeje{clearance>0?' con margen':''}</dt><dd>{degrees(margin)}</dd></div></dl></article>
}
function Duration({label,value,icon:Icon}:{label:string;value?:number;icon:typeof Sun}) { return <div><Icon size={15}/><span>{label}</span><strong>{number(value)}<small> h</small></strong></div> }
function Telemetry({label,value,unit,digits=1}:{label:string;value?:number;unit:string;digits?:number}) { return <div><span>{label}</span><strong>{number(value,digits)}<small>{unit}</small></strong></div> }
function WindowList({label,windows}:{label:string;windows:StudyMetrics['sunWindows']}) { return <details><summary>{label}<span>{windows.length} ventanas</span></summary>{windows.length?windows.map(w=><p key={w.startUtc}><time>{utcLabel(w.startUtc)}</time><ArrowRight size={10}/><time>{utcLabel(w.endUtc)}</time><strong>{w.hours.toFixed(1)} h</strong></p>):<p>No hay ventanas bajo estas condiciones.</p>}</details> }
function recommendation(rows:ReturnType<typeof rankStudies>) {
  const [a,b]=rows
  if (!a.metrics.meetsRequirements&&!b.metrics.meetsRequirements) return 'Ningún punto cumple todos tus criterios. Revisa los motivos, prueba otra fecha o ajusta las necesidades de la misión.'
  if (a.metrics.meetsRequirements===b.metrics.meetsRequirements&&a.metrics.jointHours===b.metrics.jointHours&&a.metrics.sunHours===b.metrics.sunHours&&a.metrics.earthHours===b.metrics.earthHours) return 'Empate bajo estos criterios. Harían falta otras condiciones para preferir un punto.'
  return a.site.name+' queda primero por cumplimiento de tus umbrales y, después, horas simultáneas de Sol y Tierra, luz y Tierra visible. La pendiente se evalúa sólo en el punto de referencia.'
}
function ElevationChart({solar,earth,index,clearance,onChange}:{solar:SolarResult;earth:SolarResult;index:number;clearance:number;onChange:(n:number)=>void}) {
  const w=720,h=150,pad=24,n=solar.samples.length,all=[...solar.samples,...earth.samples]
  const min=Math.min(-1,...all.map(s=>Math.min(s.elevation_deg,s.horizon_deg))),max=Math.max(2,...all.map(s=>Math.max(s.elevation_deg,s.horizon_deg+clearance)))
  const x=(i:number)=>pad+i/(n-1)*(w-2*pad),y=(v:number)=>h-pad-(v-min)/(max-min)*(h-2*pad)
  const path=(result:SolarResult,horizon=false,offset=0)=>result.samples.map((s,i)=>(i?'L':'M')+x(i).toFixed(2)+','+y((horizon?s.horizon_deg:s.elevation_deg)+offset).toFixed(2)).join(' ')
  return <div className="planner-elevation-chart"><div><span><i className="solar"/>Sol</span><span><i className="earth"/>Tierra</span><span><i className="dashed"/>Horizonte + margen</span><small>Elevación angular · °</small></div><svg viewBox={'0 0 '+w+' '+h} role="img" aria-label="Elevación del Sol y la Tierra frente al horizonte local"><line x1={pad} x2={w-pad} y1={y(0)} y2={y(0)} stroke="#526064" strokeDasharray="3 5"/><text x={0} y={y(0)+3}>0°</text><path d={path(solar)} stroke="#e5c68a"/><path d={path(earth)} stroke="#8dbfc9"/><path d={path(solar,true)} stroke="#e5c68a" strokeDasharray="4 5" opacity=".5"/><path d={path(earth,true,clearance)} stroke="#8dbfc9" strokeDasharray="4 5" opacity=".5"/><line x1={x(index)} x2={x(index)} y1={8} y2={h-pad} stroke="#dce8ce" opacity=".6"/><circle cx={x(index)} cy={y(solar.samples[index]?.elevation_deg??0)} r={3} fill="#e5c68a"/><text x={pad} y={h-3}>{solar.samples[0].t_utc.slice(5,16).replace('T',' ')}</text><text textAnchor="end" x={w-pad} y={h-3}>{solar.samples.at(-1)!.t_utc.slice(5,16).replace('T',' ')} UTC</text></svg><input aria-label="Hora de las condiciones" type="range" min={0} max={n-1} value={index} onChange={e=>onChange(Number(e.target.value))}/></div>
}
function DescentChart({run,time}:{run:DescentRun;time:number}) {
  const points=run.samples.filter((_,i)=>i%10===0||i===run.samples.length-1),w=600,h=95
  const path=(value:(s:DescentRun['samples'][0])=>number,max:number)=>points.map((s,i)=>(i?'L':'M')+(s.timeS/run.durationS*w).toFixed(2)+','+(h-6-value(s)/max*(h-12)).toFixed(2)).join(' ')
  const maxV=Math.max(1,...run.samples.map(s=>Math.abs(s.velocityMps)))
  return <div className="planner-descent-chart"><div><span>Altura · m <b>{run.config.altitudeM}</b></span><span>Velocidad · m/s <b>{maxV.toFixed(1)}</b></span></div><svg viewBox={'0 0 '+w+' '+h} role="img" aria-label="Altura y velocidad calculadas durante el descenso"><path d={path(s=>s.altitudeM,run.config.altitudeM)} stroke="#c7dca5"/><path d={path(s=>Math.abs(s.velocityMps),maxV)} stroke="#e1ad82"/><line x1={time/run.durationS*w} x2={time/run.durationS*w} y1={0} y2={h} stroke="#e3e9e5" opacity=".5"/></svg><small>Escalas independientes · tiempo físico 0–{run.durationS.toFixed(1)} s</small></div>
}
