import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowDownLeft, ArrowRight, AudioLines, Check, ChevronDown, ChevronRight,
  CircleHelp, Crosshair, Expand, Globe2, Layers3, Menu, Orbit,
  Radio, RotateCcw, Rocket, Satellite, Settings2, ShieldCheck, Volume2,
  VolumeX, X,
} from 'lucide-react'

const LaunchScene3D = lazy(() => import('./components/LaunchScene3D'))
const MissionWorkspace = lazy(() => import('./features/mission/MissionWorkspace'))

type Modal = 'briefing' | 'settings' | 'help' | 'telemetry' | null
type Phase = 'standby' | 'countdown' | 'transit'

const sites = {
  site04: { name: 'Shackleton rim', region: 'Lunar south pole', id: 'SITE 04', note: 'A candidate landing region along the rim of Shackleton crater.' },
  site01: { name: 'Connecting ridge', region: 'Lunar south pole', id: 'SITE 01', note: 'A candidate landing region connecting ridges near the lunar south pole.' },
}
type SiteId = keyof typeof sites
const checks = ['Guidance systems calibrated', 'Payload secured', 'Communications online', 'Trajectory configured', 'Propulsion systems armed']
const route = [
  { title: 'Earth orbit', time: 'T+ 00:00', detail: 'Our journey begins in low Earth orbit.' },
  { title: 'Translunar injection', time: 'T+ 01:30', detail: 'Departure from Earth orbit toward the Moon.' },
  { title: 'Lunar approach', time: 'T+ 72:00', detail: 'Approach the Moon and prepare for lunar orbit.' },
  { title: 'South pole arrival', time: 'T+ 96:00', detail: 'Arrive at the selected lunar south pole region.' },
]

function Logo({ small = false }: { small?: boolean }) {
  return <svg className={small ? 'oracle-mark small' : 'oracle-mark'} viewBox="0 0 46 46" fill="none" aria-hidden="true">
    <circle cx="23" cy="23" r="12.5" stroke="currentColor" strokeWidth="1.2" />
    <ellipse cx="23" cy="23" rx="23" ry="7" transform="rotate(-43 23 23)" stroke="currentColor" strokeWidth="1.2" />
    <path d="M23 14V32M14 23H32" stroke="currentColor" strokeWidth=".65" opacity=".45" />
    <circle cx="36.7" cy="9" r="2.5" fill="#bed9bb" />
  </svg>
}

function Panel({ title, aside, className = '', children }: { title: string; aside?: ReactNode; className?: string; children: ReactNode }) {
  return <section className={`panel ${className}`}><div className="panel-heading"><h2>{title}</h2>{aside}</div>{children}</section>
}

function Signal({ gold = false }: { gold?: boolean }) {
  return <span className={`signal ${gold ? 'gold' : ''}`} aria-hidden="true"><i /><i /><i /><i /></span>
}

function Sparkline({ variant = 'signal' }: { variant?: 'signal' | 'pressure' }) {
  const id = useId().replaceAll(':', '')
  const pressure = variant === 'pressure'
  return <svg className="sparkline" viewBox="0 0 230 70" role="img" aria-label={`${pressure ? 'Pressure' : 'Signal'} illustrative telemetry graph`}>
    <defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={pressure ? '#c6b78b' : '#9dc8c4'} stopOpacity=".22" /><stop offset="1" stopColor={pressure ? '#c6b78b' : '#9dc8c4'} stopOpacity="0" /></linearGradient></defs>
    {[12, 32, 52].map(y => <path key={y} d={`M0 ${y}H230`} stroke="#b0c3cc" strokeOpacity=".09" strokeDasharray="2 4" />)}
    {[35, 85, 135, 185].map(x => <path key={x} d={`M${x} 0V66`} stroke="#b0c3cc" strokeOpacity=".07" />)}
    <path d={pressure ? 'M0 58L12 56L24 48L36 50L48 38L60 40L72 26L84 25L96 15L108 18L120 17L132 22L144 20L156 25L168 19L180 22L192 19L204 24L216 21L230 23V70H0Z' : 'M0 43L10 39L20 41L30 29L40 35L50 32L60 15L70 39L80 43L90 33L100 35L110 31L120 37L130 26L140 30L150 22L160 29L170 10L180 24L190 30L200 24L210 28L220 25L230 31V70H0Z'} fill={`url(#${id})`} />
    <path d={pressure ? 'M0 58L12 56L24 48L36 50L48 38L60 40L72 26L84 25L96 15L108 18L120 17L132 22L144 20L156 25L168 19L180 22L192 19L204 24L216 21L230 23' : 'M0 43L10 39L20 41L30 29L40 35L50 32L60 15L70 39L80 43L90 33L100 35L110 31L120 37L130 26L140 30L150 22L160 29L170 10L180 24L190 30L200 24L210 28L220 25L230 31'} fill="none" stroke={pressure ? '#c6b78b' : '#9dc8c4'} strokeWidth="1.3" strokeLinejoin="round" />
    {!pressure && <path d="M0 48Q25 22 50 37T100 40T150 30T200 37T230 33" fill="none" stroke="#85a8bb" strokeWidth=".8" opacity=".5" />}
  </svg>
}

function Dialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => { if (dialog.open) dialog.close() }
  }, [])
  return <dialog ref={ref} className="dialog" aria-labelledby={titleId} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <div className="dialog-top"><span className="eyebrow"><Logo small /> LUNAR ORACLE / MISSION CONTROL</span><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={19} /></button></div>
    <h2 id={titleId}>{title}</h2>{children}
  </dialog>
}

function formatCountdown(seconds: number) {
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0')).join(':')
}

export default function App() {
  const [now, setNow] = useState(new Date())
  const [checked, setChecked] = useState(checks.map(() => true))
  const [siteId, setSiteId] = useState<SiteId>('site04')
  const [modal, setModal] = useState<Modal>(null)
  const [phase, setPhase] = useState<Phase>('standby')
  const [seconds, setSeconds] = useState(600)
  const [routeStep, setRouteStep] = useState(0)
  const [sound, setSound] = useState(false)
  const [effects, setEffects] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [workspaceVisited, setWorkspaceVisited] = useState(false)
  const [arrived, setArrived] = useState(false)
  const ready = checked.every(Boolean)
  const selectedSite = sites[siteId]
  const audioRef = useRef<AudioContext | null>(null)

  function openScience() { setWorkspaceVisited(true); setWorkspaceOpen(true); setMenuOpen(false) }
  useEffect(() => {
    if (phase !== 'transit') return
    const approach = window.setTimeout(() => setRouteStep(2), 14000)
    return () => window.clearTimeout(approach)
  }, [phase])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    const update = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])
  useEffect(() => () => { void audioRef.current?.close() }, [])
  useEffect(() => {
    if (phase !== 'countdown') return
    if (seconds <= 0) { setPhase('transit'); setRouteStep(1); return }
    const timer = window.setTimeout(() => setSeconds(s => s - 1), 1000)
    if (sound && audioRef.current) {
      const context = audioRef.current
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.frequency.value = seconds <= 3 ? 880 : 440
      gain.gain.setValueAtTime(0.035, context.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.15)
      oscillator.start()
      oscillator.stop(context.currentTime + 0.15)
    }
    return () => window.clearTimeout(timer)
  }, [phase, seconds, sound])

  function launch() {
    if (!ready) return
    if (sound) { audioRef.current ??= new AudioContext(); void audioRef.current.resume() }
    setSeconds(10)
    setPhase('countdown')
    setRouteStep(0)
    setArrived(false)
  }
  function reset() { setPhase('standby'); setSeconds(600); setRouteStep(0); setArrived(false) }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch { setModal('settings') }
  }

  return <div className={`app-shell ${effects ? 'effects-on' : ''} phase-${phase} ${workspaceOpen ? 'workspace-active' : ''} ${arrived ? 'has-arrived' : ''}`}>
    <header className="topbar">
      <button className="menu-button icon-button" aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} onClick={() => setMenuOpen(v => !v)}><Menu size={19} /></button>
      <a className="brand" href="#mission-control" aria-label="Lunar Oracle home"><Logo /><span><strong>LUNAR ORACLE</strong><small>LUNAR LANDING SITE NAVIGATOR</small></span></a>
      <div className="header-mission"><span className="header-divider" /><span className="eyebrow">{workspaceOpen ? 'NASA SCIENCE' : 'MISSION CONTROL'}</span><span className={`status-pill ${phase === 'countdown' ? 'counting' : ''}`}><span className="status-dot" />{phase === 'standby' ? 'PRE-LAUNCH' : phase === 'countdown' ? 'COUNTDOWN' : 'IN TRANSIT'}</span></div>
      <div className="utc-clock"><Globe2 size={15} /><time dateTime={now.toISOString()}>{now.toISOString().slice(11, 19)} <span>UTC</span></time><span className="clock-divider" /><span className="clock-date">{now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).toUpperCase()}</span></div>
      <button className="operator" onClick={() => setModal('briefing')} aria-label="Open mission briefing">LO</button>
    </header>

    <aside className={`sidebar ${menuOpen ? 'expanded' : ''}`} aria-label="Mission navigation">
      <div className="nav-primary">
        <button className={`nav-button ${!workspaceOpen ? 'active' : ''}`} aria-label="Mission control" title="Mission control" onClick={() => { setWorkspaceOpen(false); setMenuOpen(false); document.getElementById('mission-control')?.focus() }}><Rocket size={20} /><span>Mission control</span><i /></button>
        <button className={`nav-button ${workspaceOpen ? 'active' : ''}`} aria-label="Lunar explorer and solar science" title="Lunar explorer and solar science" onClick={openScience}><Globe2 size={21} /><span>NASA explorer</span></button>
        <button className="nav-button" aria-label="Mission briefing" title="Mission briefing" onClick={() => { setModal('briefing'); setMenuOpen(false) }}><Orbit size={21} /><span>Mission briefing</span></button>
        <button className="nav-button" aria-label="View telemetry" title="View telemetry" onClick={() => { setModal('telemetry'); setMenuOpen(false) }}><AudioLines size={20} /><span>Telemetry</span></button>
        <button className="nav-button" aria-label="Destination details" title="Destination details" onClick={() => { setModal('briefing'); setMenuOpen(false) }}><Crosshair size={20} /><span>Destination</span></button>
        <span className="nav-separator" />
        <button className="nav-button" aria-label="Display settings" title="Display settings" onClick={() => { setModal('settings'); setMenuOpen(false) }}><Layers3 size={19} /><span>Display settings</span></button>
      </div>
      <div className="nav-bottom"><button className="nav-button" aria-label="Mission help" title="Mission help" onClick={() => setModal('help')}><CircleHelp size={19} /><span>Mission help</span></button><button className="nav-button" aria-label="Settings" title="Settings" onClick={() => setModal('settings')}><Settings2 size={19} /><span>Settings</span></button><span className="rail-version">V.01</span></div>
    </aside>
    {menuOpen && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}

    <main id="mission-control" className="mission-view" tabIndex={-1} hidden={workspaceOpen}>
      <Suspense fallback={<div className="scene-loading">Preparing the 3D launch environment…</div>}><LaunchScene3D phase={phase} seconds={seconds} siteId={siteId} effects={effects && !workspaceOpen} active={!workspaceOpen} onArrival={() => { setArrived(true); setRouteStep(3) }} /></Suspense>
      <div className="scene-shade" /><div className="scene-grid" aria-hidden="true" />
      <div className="launch-glow" aria-hidden="true" />

      <div className="view-heading"><div className="eyebrow view-eyebrow"><span className="mini-line" />THE NEXT CHAPTER OF EXPLORATION</div><h1>Mission control<span>.</span></h1><p>Earth is only the beginning.</p><button className="open-science-button" onClick={openScience}><Globe2 size={13} />Explore NASA data<ArrowRight size={13} /></button></div>
      <div className="mission-meta"><div className="eyebrow">ARTEMIS / MISSION 001</div><span><span className="status-dot" />{phase === 'transit' ? 'TRANSIT DEMO ACTIVE' : 'ALL EYES ON THE MOON'}</span></div>

      <div className="left-stack">
        <Panel title="Mission telemetry" aside={<Radio size={13} className="muted" />} className="telemetry-panel">
          <dl className="telemetry-list"><div><dt>Mission status</dt><dd className={ready ? 'green' : 'amber'}><span className={`status-dot ${!ready ? 'amber-dot' : ''}`} />{phase === 'transit' ? 'IN TRANSIT' : phase === 'countdown' ? 'COUNTDOWN' : ready ? 'READY' : 'HOLD'}</dd></div><div><dt>Propellant</dt><dd>100<span className="unit">%</span><span className="tiny-bars"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></span></dd></div><div><dt>Weather conditions</dt><dd className="green">GO<Check size={12} /></dd></div><div><dt>Flight mode</dt><dd className="window-value">CINEMATIC<ArrowDownLeft size={12} /></dd></div></dl>
          <div className="destination"><div className="destination-icon"><Crosshair size={19} /></div><div><span className="eyebrow">TARGET DESTINATION</span><label className="site-select"><span className="sr-only">Select target destination</span><select value={siteId} disabled={phase !== 'standby'} onChange={e => setSiteId(e.target.value as SiteId)}><option value="site04">Shackleton rim</option><option value="site01">Connecting ridge</option></select><ChevronDown size={13} /></label><span className="destination-region">{selectedSite.region}<span> / {selectedSite.id}</span></span></div></div>
        </Panel>

        <Panel title="Systems diagnostics" aside={<span className="live-dot" />} className="diagnostics-panel"><div className="diagnostic-row"><span>COMM SIGNAL</span><span className="green">NOMINAL</span></div><Sparkline /><div className="chart-axis"><span>−60 s</span><span>−30 s</span><span>NOW</span></div><div className="diagnostic-separator" /><div className="diagnostic-row"><span>TANK PRESSURE</span><span className="sand">STABLE</span></div><Sparkline variant="pressure" /><div className="chart-axis"><span>−60 s</span><span>−30 s</span><span>NOW</span></div><div className="diagnostics-bottom"><span className="status-dot" />Illustrative telemetry</div></Panel>
      </div>

      <div className="vehicle-marker" aria-hidden="true"><span className="marker-dot" /><span className="marker-line" /><div><span>SPACE LAUNCH SYSTEM</span><strong>ARTEMIS <span>—</span> SLS</strong><small>BLOCK 1 / CREW VEHICLE</small></div></div>
      <div className="location-marker"><span className="location-cross">+</span><span>KENNEDY SPACE CENTER<small>LAUNCH COMPLEX 39B · EARTH</small></span></div>

      <div className="right-stack">
        <Panel title="Pre-flight checklist" aside={<span className="check-count">{checked.filter(Boolean).length}/{checks.length}</span>} className="checklist-panel"><p className="panel-description">A small step. Everything checked.</p><div className="checklist">{checks.map((check, i) => <label key={check} className="check-item"><input type="checkbox" checked={checked[i]} disabled={phase !== 'standby'} onChange={() => setChecked(current => current.map((v, index) => index === i ? !v : v))} /><span className="custom-checkbox"><Check size={11} strokeWidth={2.5} /></span><span>{check}</span></label>)}</div><div className={`checklist-status ${ready ? '' : 'hold'}`}><ShieldCheck size={14} /><span>{ready ? 'All systems are go for launch' : 'Complete all checks to launch'}</span><span className={`status-dot ${!ready ? 'amber-dot' : ''}`} /></div></Panel>

        <button className="destination-preview" onClick={openScience}><div className="planet moon" /><div><span className="eyebrow">NASA LOLA / JPL HORIZONS</span><strong>Lunar south pole</strong><small>Choose a landing region<ArrowRight size={12} /></small></div><ChevronRight size={15} /></button>
        <div className="right-caption"><span>01</span><div className="caption-line" /><span>EARTH → MOON</span></div>
      </div>

      <section className="timeline-panel panel" aria-label="Illustrative transit chronology"><div className="panel-heading"><h2>Transit chronology</h2><span className="timeline-detail">{route[routeStep].title}<span className="timeline-demo">ILLUSTRATIVE ROUTE</span></span></div><div className="route-track"><button className="planet-stop earth-stop" onClick={() => setRouteStep(0)} aria-label="Show Earth orbit"><span className="planet earth" /><span>EARTH</span></button><div className="route-stages"><div className="track-line"><div style={{ width: `${routeStep / 3 * 100}%` }} /></div>{route.map((step, i) => <button key={step.title} className={`route-stage ${i <= routeStep ? 'reached' : ''} ${i === routeStep ? 'current' : ''}`} aria-label={`${step.title}, ${step.time}`} aria-pressed={i === routeStep} onClick={() => setRouteStep(i)}><span className="route-node">{i === routeStep && <span />}</span><span className="route-time">{step.time}</span><span className="route-name">{step.title}</span></button>)}</div><button className="planet-stop moon-stop" onClick={() => setRouteStep(3)} aria-label="Show lunar arrival"><span className="planet moon" /><span>MOON</span></button></div><div className="timeline-foot"><span><span className="status-dot" />{route[routeStep].detail}</span><span>NOT TO SCALE<ArrowRight size={12} /></span></div></section>

      <section className="launch-panel panel" aria-label="Launch controls"><div className="launch-countdown"><div><span className="eyebrow">{phase === 'countdown' ? 'DEMO SEQUENCE' : phase === 'transit' ? 'MISSION STATUS' : 'LAUNCH COUNTDOWN'}</span><strong className={phase === 'countdown' ? 'countdown-active' : ''}>{phase === 'transit' ? <span className="transit-label">{arrived ? 'Touchdown' : 'On our way'}<ArrowRight size={21} /></span> : <><span className="t-minus">T−</span>{formatCountdown(seconds)}</>}</strong></div><div className="readiness-ring"><svg viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="22" /><circle cx="26" cy="26" r="22" style={{ strokeDashoffset: 138.23 * (1 - checked.filter(Boolean).length / checks.length) }} /></svg><span>{Math.round(checked.filter(Boolean).length / checks.length * 100)}<small>%</small></span></div></div><div className="launch-readiness"><span className={ready ? 'green' : 'amber'}><Signal />{ready ? 'READY FOR LAUNCH' : 'PRE-FLIGHT HOLD'}</span><span>SIMULATION</span></div>{phase === 'standby' ? <button className="launch-button" onClick={launch} disabled={!ready}><Rocket size={17} /><span>Launch & begin transit</span><ArrowRight size={17} /></button> : <button className={`launch-button ${phase === 'countdown' ? 'abort-button' : ''}`} onClick={reset}>{phase === 'countdown' ? <X size={17} /> : <RotateCcw size={16} />}<span>{phase === 'countdown' ? 'Abort launch sequence' : 'Reset mission preview'}</span>{phase === 'countdown' && <span className="button-countdown">{seconds}</span>}</button>}<span className="launch-note">{phase === 'standby' ? 'The next giant leap starts with you.' : phase === 'countdown' ? '10-second demonstration countdown' : '3D journey · NASA study region.'}</span></section>

      <div className="scene-tools"><button className="scene-tool" aria-label={sound ? 'Mute countdown sound' : 'Enable countdown sound'} title={sound ? 'Mute countdown sound' : 'Enable countdown sound'} aria-pressed={sound} onClick={() => setSound(v => !v)}>{sound ? <Volume2 size={15} /> : <VolumeX size={15} />}</button><span /><button className="scene-tool" aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} title={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} onClick={() => void toggleFullscreen()}><Expand size={15} /></button></div>
      {phase === 'countdown' && <div className="countdown-overlay" aria-live="polite"><span className="eyebrow">LAUNCH SEQUENCE INITIATED</span><strong key={seconds}>{String(seconds).padStart(2, '0')}</strong><span>DEMONSTRATION COUNTDOWN</span></div>}
      {phase === 'transit' && <div className="transit-message" role="status"><span className="eyebrow"><span className="status-dot" />{arrived ? 'TOUCHDOWN' : 'CINEMATIC FLIGHT'}</span><h2>{arrived ? 'A new horizon.' : 'The Moon is calling.'}</h2><p>{arrived ? `Landed at ${selectedSite.name}.` : `Your journey to ${selectedSite.name} has begun.`}</p>{arrived && <button className="open-science-button" onClick={openScience}>Study this region<ArrowRight size={13} /></button>}<span>Illustrative trajectory · NASA science in Explorer</span></div>}
    </main>

    {workspaceVisited && <div className="science-host" hidden={!workspaceOpen}><Suspense fallback={<div className="science-loading">Opening the NASA science workspace…</div>}><MissionWorkspace initialSiteId={siteId} onSelectSite={id => { if (id === 'site01' || id === 'site04') setSiteId(id) }} onClose={() => setWorkspaceOpen(false)} /></Suspense></div>}

    <footer className="statusbar"><span className="system-status"><span className="status-dot" />{ready ? 'ALL SYSTEMS NOMINAL' : 'AWAITING PRE-FLIGHT CHECKS'}</span><span className="footer-project">NASA SPACE APPS CHALLENGE <span>/</span> 2026</span><button onClick={() => setModal('help')} className="demo-label">3D FLIGHT DEMO<CircleHelp size={11} /></button><span className="footer-session"><Signal />{workspaceOpen ? 'NASA / JPL SOURCES' : 'CINEMATIC SIMULATION'}<span className="footer-version">LO—001</span></span></footer>

    {modal && <Dialog title={modal === 'briefing' ? 'One mission. A new horizon.' : modal === 'settings' ? 'Make space your own.' : modal === 'telemetry' ? 'A closer look at the systems.' : 'Welcome to mission control.'} onClose={() => setModal(null)}>
      {modal === 'briefing' && <><p className="dialog-lead">Your starting point for exploring the lunar south pole.</p><div className="briefing-destination"><div className="planet moon" /><div><span className="eyebrow">{selectedSite.id} / TARGET REGION</span><h3>{selectedSite.name}</h3><p>{selectedSite.note}</p></div></div><div className="briefing-grid"><div><Satellite size={18} /><span>MISSION</span><strong>Lunar exploration</strong></div><div><Crosshair size={18} /><span>DESTINATION</span><strong>South pole</strong></div></div><p className="dialog-note">Explore NASA LOLA site data and JPL Horizons solar ephemerides in the science workspace. The 3D flight is an illustrative journey, not an orbital dynamics calculation or landing safety assessment.</p><button className="dialog-primary" onClick={() => { setModal(null); openScience() }}>Open NASA explorer<ArrowRight size={16} /></button></>}
      {modal === 'settings' && <><p className="dialog-lead">Set the atmosphere for your mission.</p><label className="setting-row"><div><strong>Ambient effects</strong><small>Gentle light and status animations</small></div><input type="checkbox" role="switch" checked={effects} onChange={e => setEffects(e.target.checked)} /></label><label className="setting-row"><div><strong>Countdown audio</strong><small>Soft tones during the launch demonstration</small></div><input type="checkbox" role="switch" checked={sound} onChange={e => setSound(e.target.checked)} /></label><button className="setting-action" onClick={() => void toggleFullscreen()}><Expand size={17} />{fullscreen ? 'Exit full screen' : 'Enter full screen'}<ArrowRight size={16} /></button><p className="dialog-note">Times are displayed in UTC. Your device’s reduced motion preference is respected.</p></>}
      {modal === 'telemetry' && <><p className="dialog-lead">A preview of the information a launch team keeps in view.</p><div className="telemetry-dialog-chart"><div className="diagnostic-row"><span>COMMUNICATION SIGNAL</span><span className="green">ILLUSTRATIVE</span></div><Sparkline /></div><div className="telemetry-dialog-chart"><div className="diagnostic-row"><span>TANK PRESSURE</span><span className="sand">ILLUSTRATIVE</span></div><Sparkline variant="pressure" /></div><p className="dialog-note">The signal graphs, propellant level, weather, readiness, and countdown are sample interface states. They are not live NASA telemetry or calculated mission results.</p></>}
      {modal === 'help' && <><p className="dialog-lead">A little curiosity. An extraordinary destination.</p><ol className="help-steps"><li><span>01</span><div><strong>Choose your destination</strong><p>Switch between Shackleton rim and Connecting ridge in the telemetry panel.</p></div></li><li><span>02</span><div><strong>Check your systems</strong><p>Complete all five pre-flight checks to enable the launch button.</p></div></li><li><span>03</span><div><strong>Begin the journey</strong><p>Launch a 10-second demonstration. Explore each stage on the transit chronology.</p></div></li></ol><p className="dialog-note">The 3D flight, vehicle telemetry and transit times are illustrative. Open Explore NASA data for real JPL Horizons ephemerides, NASA LOLA terrain, visibility windows and source records.</p></>}
    </Dialog>}
  </div>
}
