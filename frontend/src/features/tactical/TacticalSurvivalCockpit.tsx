import { useEffect, useMemo, useRef, useState } from 'react'
import { Database, Globe2, Layers, MapPin, Pause, Play, Rocket, ShieldCheck, Sun, Orbit, Maximize2, Clock, X } from 'lucide-react'
import { Tactical3DScene } from './Tactical3DScene'
import { loadAtlas, type AtlasData } from '../sites/atlasGeometry'
import { useMission } from '../mission/MissionContext'
import { DEFAULT_DESCENT, descentAt, simulateDescent, type DescentRun } from '../mission/descentPhysics'
import { assessCell, nearestCell, parseUtcInput, validateBody, validateSurface, windowMetrics, type BodyResult, type LandingRun, type LandingSurface, type Limits } from './landingScience'
import type { RaycastHit } from './tacticalMath'
import WindowPlannerPanel from './WindowPlannerPanel'
import MissionCopilot,{type CopilotAction} from './MissionCopilot'
import './tactical-cockpit.css'

const format = (v: number | null | undefined, digits=1) => typeof v==='number'&&Number.isFinite(v)?v.toFixed(digits):'—'
const utcLabel = (s: string) => s.replace('T',' ').slice(0,16)+' UTC'
const initialLimits = { maxSlope:'10',maxRelief:'5',sunMargin:'0.2',earthMargin:'0.2',minSunHours:'12',minEarthHours:'12' }
const riskLabel = { green:'Cumple el modelo',yellow:'Margen limitado',red:'No cumple criterios',unknown:'Sin evaluación' }
const emptyRay:RaycastHit = {hit:true,hitDistanceM:NaN,hitPositionWorld:null,obstacleElevationDeg:NaN,marginDeg:NaN}

export default function TacticalSurvivalCockpit({ onOpenScientific, onBackToPolar, active=true }: { onOpenScientific?:()=>void; onBackToPolar?:()=>void; active?:boolean }) {
  const { mission, updateMission, updateRequirements } = useMission()
  const [surface,setSurface]=useState<LandingSurface|null>(null)
  const [atlas,setAtlas]=useState<AtlasData|null>(null)
  const [loadError,setLoadError]=useState('')
  const [attempt,setAttempt]=useState(0)
  const [cellId,setCellId]=useState('site01:10:10')
  const [manualLat,setManualLat]=useState('-89.46315776')
  const [manualLon,setManualLon]=useState('-137.50198491')
  const [start,setStart]=useState(mission.startUtc.slice(0,16))
  const [duration,setDuration]=useState('72')
  const [limits,setLimits]=useState(initialLimits)
  const [run,setRun]=useState<LandingRun|null>(null)
  const [error,setError]=useState('')
  const [loading,setLoading]=useState('')
  const [index,setIndex]=useState(0)
  const [playing,setPlaying]=useState(false)
  const [view,setView]=useState<'orbit'|'mast'|'top'|'polar'>('orbit')
  const [placement,setPlacement]=useState(false)
  const [cameraKey,setCameraKey]=useState(0)
  const [evidence,setEvidence]=useState(false)
  const [flight,setFlight]=useState<DescentRun|null>(null)
  const [flightTime,setFlightTime]=useState(0)
  const [flightPlaying,setFlightPlaying]=useState(false)
  const [flightSpeed,setFlightSpeed]=useState(10)
  const requestRef=useRef<AbortController|null>(null)
  const rootRef=useRef<HTMLDivElement>(null)
  const key=JSON.stringify([cellId,manualLat,manualLon,start,duration,limits])
  const keyRef=useRef(key)
  keyRef.current=key
  const region=surface?.regions.find(r=>r.cells.some(c=>c.id===cellId))??null
  const cell=region?.cells.find(c=>c.id===cellId)??null
  const coordinatesConfirmed=Boolean(cell&&manualLat.trim()&&manualLon.trim()&&Math.abs(Number(manualLat)-cell.latitude_deg)<1e-7&&Math.abs(Number(manualLon)-cell.longitude_deg)<1e-7)
  const current=run?.key===key&&!loadError&&coordinatesConfirmed?run:null
  const dirty=Boolean(run&&!current)
  const rows=current?.sun.samples??[]
  const sample=rows[index], earthSample=current?.earth.samples[index]
  const metrics=useMemo(()=>{
    if(!current)return new Map()
    return new Map(current.region.cells.filter(c=>c.known).map(c=>[c.id,windowMetrics(current,c)]))
  },[current])
  const assessments=useMemo(()=>current?current.region.cells.map(c=>assessCell(current,c,index,metrics.get(c.id)??{sunHours:0,earthHours:0})):[],[current,index,metrics])
  const selected=assessments.find(a=>a.cell.id===cellId)
  const totals=metrics.get(cellId)
  const best=useMemo(()=>assessments.filter(a=>a.risk==='green'||a.risk==='yellow').sort((a,b)=>(a.risk==='green'?0:1)-(b.risk==='green'?0:1)||(a.cell.max_slope_deg??90)-(b.cell.max_slope_deg??90))[0],[assessments])
  const telemetry=flight?descentAt(flight,flightTime):null
  const landed=Boolean(flight&&flightTime>=flight.durationS)
  const sunRay:RaycastHit=sample?{hit:sample.elevation_deg<=sample.horizon_deg,hitDistanceM:NaN,hitPositionWorld:null,obstacleElevationDeg:sample.horizon_deg,marginDeg:sample.elevation_deg-sample.horizon_deg}:emptyRay
  const earthRay:RaycastHit=earthSample?{hit:earthSample.elevation_deg<=earthSample.horizon_deg,hitDistanceM:NaN,hitPositionWorld:null,obstacleElevationDeg:earthSample.horizon_deg,marginDeg:earthSample.elevation_deg-earthSample.horizon_deg}:emptyRay
  const detail=useMemo<AtlasData|null>(()=>{
    if(!atlas||!region)return null
    const g=region.render_grid,extent={xmin:g.xmin,xmax:g.xmin+(g.grid_size-1)*g.spacing_m,ymax:g.ymax,ymin:g.ymax-(g.grid_size-1)*g.spacing_m}
    return {heights:Uint16Array.from(g.heights),manifest:{...atlas.manifest,grid_size:g.grid_size,display_spacing_m:g.spacing_m,scale_m:g.scale_m,offset_m:g.offset_m,nodata:65535,source_resolution_m:5,sample_extent_m:extent,extent_m:extent}}
  },[atlas,region])

  const contextAtlas=useMemo<AtlasData|null>(()=>{
    if(!atlas||!region)return null
    const g=region.context_grid,extent={xmin:g.xmin,xmax:g.xmin+(g.grid_size-1)*g.spacing_m,ymax:g.ymax,ymin:g.ymax-(g.grid_size-1)*g.spacing_m}
    return {heights:Uint16Array.from(g.heights),manifest:{...atlas.manifest,grid_size:g.grid_size,display_spacing_m:g.spacing_m,scale_m:g.scale_m,offset_m:g.offset_m,nodata:65535,source_resolution_m:5,sample_extent_m:extent,extent_m:extent}}
  },[atlas,region])

  useEffect(()=>{
    const ac=new AbortController()
    setLoadError('');setSurface(null);setAtlas(null)
    Promise.all([
      fetch('/api/landing/surface',{signal:ac.signal}).then(async r=>{if(!r.ok)throw new Error('No se pudieron cargar las áreas NASA de 5 m.');return validateSurface(await r.json())}),
      loadAtlas(ac.signal)
    ]).then(([s,a])=>{if(!ac.signal.aborted){setSurface(s);setAtlas(a)}}).catch(e=>{if(!ac.signal.aborted)setLoadError(e instanceof Error?e.message:'Datos NASA no disponibles.')})
    return ()=>ac.abort()
  },[attempt])
  useEffect(()=>()=>requestRef.current?.abort(),[])
  useEffect(()=>{
    setPlaying(false);setFlightPlaying(false);setFlight(null);setIndex(0)
    requestRef.current?.abort();setLoading('')
  },[key])
  useEffect(()=>{
    if(!active){setPlaying(false);setFlightPlaying(false)}
  },[active])
  useEffect(()=>{
    if(!playing||!current||!active)return
    const timer=setInterval(()=>setIndex(i=>{if(i>=rows.length-1){setPlaying(false);return i}return i+1}),650)
    return ()=>clearInterval(timer)
  },[playing,current,active,rows.length])
  useEffect(()=>{
    if(!flight||!flightPlaying||!active)return
    let raf=0, previous=performance.now()
    const tick=(now:number)=>{
      const elapsed=Math.min((now-previous)/1000,0.25)*flightSpeed
      previous=now
      setFlightTime(t=>{const next=Math.min(flight.durationS,t+elapsed);if(next>=flight.durationS)setFlightPlaying(false);return next})
      raf=requestAnimationFrame(tick)
    }
    raf=requestAnimationFrame(tick)
    return ()=>cancelAnimationFrame(raf)
  },[flight,flightPlaying,flightSpeed,active])

  function chooseCell(id:string,reset=false) {
    const c=surface?.regions.flatMap(r=>r.cells).find(c=>c.id===id)
    if(!c)return
    setCellId(c.id);setManualLat(c.latitude_deg.toFixed(8));setManualLon(c.longitude_deg.toFixed(8));setError('')
    if(reset)setCameraKey(k=>k+1)
  }
  function place(lat:number,lon:number) {
    if(!surface)return
    const result=nearestCell(surface,lat,lon)
    if(!result){setCellId('outside');setManualLat(lat.toFixed(8));setManualLon(lon.toFixed(8));setError('Fuera de las dos áreas preparadas de 5 m. Aptitud desconocida; selecciona un área cubierta.');return}
    chooseCell(result.cell.id)
  }
  function manualPlace() {
    if(!manualLat.trim()||!manualLon.trim()){setError('Completa latitud y longitud; un campo vacío no es cero.');return}
    const lat=Number(manualLat),lon=Number(manualLon)
    if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat< -90||lat> -80||lon< -180||lon>180){setError('Usa latitud de −90 a −80 y longitud este de −180 a 180.');return}
    place(lat,lon)
  }
  async function simulate() {
    let parsed:Limits,begin:string,end:string
    try {
      if(!surface||!atlas||!cell?.known||!region||!coordinatesConfirmed)throw new Error('Se requiere una celda con datos NASA completos.')
      begin=parseUtcInput(start)
      const hours=Number(duration)
      if(!Number.isInteger(hours)||hours<1||hours>336)throw new Error('El intervalo debe ser de 1 a 336 horas.')
      end=new Date(Date.parse(begin)+hours*3600000).toISOString().replace('.000Z','Z')
      if(new Date(end).getUTCFullYear()>2100)throw new Error('El intervalo termina fuera de los años admitidos.')
      if(Object.values(limits).some(v=>!v.trim()||!Number.isFinite(Number(v))))throw new Error('Completa todos los límites con números finitos.')
      parsed=Object.fromEntries(Object.entries(limits).map(([k,v])=>[k,Number(v)])) as Limits
      if(parsed.maxSlope<0||parsed.maxSlope>45||parsed.maxRelief<0||parsed.maxRelief>50||parsed.sunMargin<0||parsed.sunMargin>10||parsed.earthMargin<0||parsed.earthMargin>10||parsed.minSunHours<0||parsed.minEarthHours<0||parsed.minSunHours>hours||parsed.minEarthHours>hours)throw new Error('Revisa los límites: pendiente 0–45°, relieve 0–50 m, márgenes 0–10° y horas dentro del intervalo.')
    } catch(e){setError(e instanceof Error?e.message:'Parámetros no válidos.');return}
    requestRef.current?.abort()
    const ac=new AbortController(),requestKey=key
    requestRef.current=ac
    setError('');setPlaying(false);setFlight(null);setRun(null);setIndex(0)
    try {
      const get=async(target:'Sun'|'Earth')=>{
        setLoading(target==='Sun'?'Consultando Sol · JPL Horizons…':'Consultando Tierra · JPL Horizons…')
        const params=new URLSearchParams({cell_id:cell!.id,target,start_utc:begin,end_utc:end,step_minutes:'60',observer_height_m:'2'})
        const response=await fetch('/api/landing/ephemeris?'+params,{signal:ac.signal})
        const result=await response.json()
        if(!response.ok)throw new Error(result.message??'NASA no está disponible; no se emitirá una evaluación.')
        validateBody(result,cell!,begin,end)
        return result as BodyResult
      }
      const sun=await get('Sun')
      const earth=await get('Earth')
      if(ac.signal.aborted||keyRef.current!==requestKey)return
      setRun({origin:cell!,region:region!,sun,earth,limits:parsed!,createdAt:new Date().toISOString(),key:requestKey})
      updateMission({siteIds:[region!.id,region!.id==='site01'?'site04':'site01'],startUtc:begin!,endUtc:end!,stepMinutes:60,horizonMode:'terrain',observerHeightM:2,delayHours:0})
      updateRequirements({maxSlopeDeg:parsed!.maxSlope,minimumSunHours:parsed!.minSunHours,minimumEarthHours:parsed!.minEarthHours,earthClearanceDeg:parsed!.earthMargin})
    } catch(e){if(!ac.signal.aborted)setError(e instanceof Error?e.message:'La simulación no pudo completarse.')}
    finally{if(!ac.signal.aborted)setLoading('')}
  }
  function delay(days:number) {
    try{const begin=parseUtcInput(start);setStart(new Date(Date.parse(begin)+days*86400000).toISOString().slice(0,16))}
    catch(e){setError(e instanceof Error?e.message:'Fecha no válida.')}
  }
  function seekMission(next:number) {
    setPlaying(false);setFlightPlaying(false);setFlight(null);setIndex(next)
  }
  async function toggleFullscreen() {
    try { if(document.fullscreenElement)await document.exitFullscreen();else await rootRef.current?.requestFullscreen() }
    catch { setError('Este navegador no pudo abrir la pantalla completa.') }
  }
  function startDescent() {
    if(!current||!cell||cell.elevation_m===null)return
    try{setFlight(simulateDescent({...DEFAULT_DESCENT,surfaceElevationM:cell.elevation_m}));setFlightTime(0);setPlaying(false);setFlightPlaying(true)}
    catch(e){setError(e instanceof Error?e.message:'Descenso no disponible.')}
  }
  function exportRun() {
    if(!current)return
    const record={schema_version:1,model:'NASA LOLA / JPL Horizons sampled planning model',...current,terrain_products:current.region.products,source_sha256:surface?.source_sha256,
      current_utc:sample?.t_utc,assessments:assessments.map(({cell,...a})=>({...a,cell_id:cell.id})),footprint_radius_m:15,cell_width_m:50,
      spatial_ephemeris_method:'Translate selected-observer apparent body vectors using Horizons range into adjacent local ENU frames; approximate, not independent per-cell SPICE.',
      display_vertical_exaggeration:1,vehicle_hypothesis:flight?.config??DEFAULT_DESCENT,descent:flight?{outcome:flight.outcome,impact_speed_mps:flight.impactSpeedMps,fuel_used_kg:flight.fuelUsedKg,elapsed_s:flightTime,samples:flight.samples}:null,
      unmodeled:['thermal','solar electrical energy','RF link budget','sub-5 m rocks','horizontal guidance','full uncertainty propagation','independent SPICE frame validation']}
    const blob=new Blob([JSON.stringify(record,null,2)],{type:'application/json'})
    const url=URL.createObjectURL(blob),a=document.createElement('a')
    a.href=url;a.download='lunar-oracle-'+cellId.replaceAll(':','-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  const nextDark=current?rows.findIndex((s,i)=>i>index&&s.elevation_deg-s.horizon_deg<=current.limits.sunMargin):-1
  const darkLabel=!sample?'—':selected?.sunMargin!==null&&selected?.sunMargin!==undefined&&selected.sunMargin<=current!.limits.sunMargin?'Ahora':nextDark>=0?(nextDark-index)+' h':'No observado en el intervalo'
  const counts=assessments.reduce((out,a)=>({...out,[a.risk]:out[a.risk]+1}),{green:0,yellow:0,red:0,unknown:0})
  const copilotContext={
    selected:cell?{id:cell.id,name:region?.name,lat:cell.latitude_deg,lon:cell.longitude_deg,slopeDeg:cell.max_slope_deg,resolutionM:5,coverage:'local'}:null,
    regional:{scope:'local',sourceResolutionM:5,totalCells:region?.cells.length??0,knownCells:region?.cells.filter(c=>c.known).length??0,evaluated:Boolean(current)},
    simulation:{status:current?'ready':dirty?'stale':'not_run',risk:selected?.risk??'unknown',reasons:selected?.reasons??[],sunHours:totals?.sunHours??null,earthHours:totals?.earthHours??null},
    alternatives:best?[{id:best.cell.id,name:'Celda que cumple el modelo',lat:best.cell.latitude_deg,lon:best.cell.longitude_deg,slopeDeg:best.cell.max_slope_deg,resolutionM:5}]:[]
  }
  function copilotAction(a:CopilotAction){
    if(!a)return
    if(a.type==='polar_view'){onBackToPolar?.();return}
    if(a.type==='select_cell'&&a.target_id){chooseCell(a.target_id,true);return}
    if(a.type==='run_simulation'){void simulate();return}
    if(a.type==='details'){setView('top');setCameraKey(k=>k+1)}
  }
  const status=current?riskLabel[selected?.risk??'unknown']:dirty?'Cambios sin simular':loading?'Consultando NASA':'Ejecuta la simulación'
  return <div ref={rootRef} className="science-cockpit" data-testid="tactical-cockpit">
    <header className="science-header">
      <div className="science-brand"><Orbit className="brand-orbit" size={34}/><div><strong>LUNAR ORACLE</strong><small>EXPLORACIÓN DEL POLO SUR · NASA SPACE APPS</small></div></div>
      <div className="science-header-meta"><span className={'data-indicator '+(current?'ready':'')}/>{current?'NASA · OBSERVADOR VERIFICADO':'NASA LOLA + JPL HORIZONS'}</div>
      <nav aria-label="Herramientas de misión">{onBackToPolar&&<button onClick={onBackToPolar}>← Todo el polo sur</button>}<button onClick={()=>setEvidence(true)}><Database size={14}/> Evidencia NASA</button><button onClick={()=>{setPlaying(false);setFlightPlaying(false);onOpenScientific?.()}}>Comparar referencias</button></nav>
    </header>
    <div className="science-layout">
      <aside className="science-controls">
        <div className="panel-heading"><span>ESTUDIO LOCAL · PASO 3</span><span className="live-label">UTC</span></div>
        <section>
          <h2><MapPin size={15}/> Elige un área de detalle</h2><p className="field-help local-scope-note">Aquí se estudia una zona de 1,05 km con datos de 5 m. Para explorar todo el polo, vuelve al mapa regional.</p>
          <label>Área con cobertura de 5 m<select aria-label="Área lunar" value={region?.id??'outside'} onChange={e=>{const r=surface?.regions.find(r=>r.id===e.target.value);if(r)chooseCell(r.center_cell_id,true)}}>
            {!region&&<option value="outside">Fuera de cobertura</option>}
            {(surface?.regions??[]).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
          </select></label>
          <details className="coordinate-details"><summary>Introducir coordenadas exactas</summary><div className="field-pair"><label>Latitud °<input aria-label="Latitud" type="number" step="any" value={manualLat} onChange={e=>setManualLat(e.target.value)}/></label><label>Longitud este °<input aria-label="Longitud este" type="number" step="any" value={manualLon} onChange={e=>setManualLon(e.target.value)}/></label></div>
          <button className="wide quiet" onClick={manualPlace}>Localizar en rejilla NASA</button></details>
          <p className="field-help">Clic en el terreno para elegir. El destino se ajusta a una celda de 50 m; las coordenadas confirmadas aparecen en el mapa.</p>
          <div className="measured-row"><span>Pendiente del píxel · 5 m</span><strong>{format(cell?.slope_deg)}°</strong></div>
          <div className="measured-row"><span>Máxima en celda + huella</span><strong>{format(cell?.max_slope_deg)}°</strong></div>
          <div className="measured-row"><span>Elevación / error de altura</span><strong>{format(cell?.elevation_m,0)} / {format(cell?.height_uncertainty_m,2)} m</strong></div>
        </section>
        <section>
          <h2><Globe2 size={15}/> Ventana de misión</h2>
          <label>Inicio · UTC<input aria-label="Inicio UTC" type="datetime-local" min="1962-01-01T00:00" max="2100-12-31T23:59" value={start} onChange={e=>setStart(e.target.value)}/></label>
          <label>Duración<select aria-label="Duración" value={duration} onChange={e=>setDuration(e.target.value)}><option value="72">72 horas · 3 días</option><option value="168">168 horas · 7 días</option><option value="336">336 horas · 14 días</option></select></label>
          <div className="delay-actions"><button onClick={()=>delay(1)}>+1 día</button><button onClick={()=>delay(6)}>+6 días</button><button onClick={()=>delay(12)}>+12 días</button></div>
          <p className="field-help">Cada cambio consulta las fechas y el observador exactos. Cadencia de efemérides: 1 hora.</p>
        </section>
        <details className="criteria-details">
          <summary>Límites del vehículo · hipótesis editables</summary>
          <div className="field-pair"><label>Pendiente máx. °<input aria-label="Pendiente máxima" type="number" min="0" max="45" value={limits.maxSlope} onChange={e=>setLimits({...limits,maxSlope:e.target.value})}/></label><label>Relieve máx. m<input aria-label="Relieve máximo" type="number" min="0" max="50" step="0.5" value={limits.maxRelief} onChange={e=>setLimits({...limits,maxRelief:e.target.value})}/></label></div>
          <div className="field-pair"><label>Margen Sol °<input aria-label="Margen Sol" type="number" min="0" max="10" step="0.1" value={limits.sunMargin} onChange={e=>setLimits({...limits,sunMargin:e.target.value})}/></label><label>Margen Tierra °<input aria-label="Margen Tierra" type="number" min="0" max="10" step="0.1" value={limits.earthMargin} onChange={e=>setLimits({...limits,earthMargin:e.target.value})}/></label></div>
          <div className="field-pair"><label>Horas Sol mín.<input aria-label="Horas Sol mínimas" type="number" min="0" max={duration} value={limits.minSunHours} onChange={e=>setLimits({...limits,minSunHours:e.target.value})}/></label><label>Horas Tierra mín.<input aria-label="Horas Tierra mínimas" type="number" min="0" max={duration} value={limits.minEarthHours} onChange={e=>setLimits({...limits,minEarthHours:e.target.value})}/></label></div>
          <p className="field-help">Huella: radio de 15 m. Máximo de pendiente en cada celda más ese margen. Relieve: rango de alturas en 35 × 35 m centrales.</p>
        </details>
        <button className="simulate-button" onClick={simulate} disabled={Boolean(loading)||!surface||!atlas||!cell?.known||!coordinatesConfirmed}><Play size={16}/>{loading?'CONSULTANDO NASA…':'ANALIZAR SOL Y TIERRA'}</button>
        {loading&&<p className="request-status" role="status">{loading}</p>}
        {(error||loadError)&&<div className="science-error" role="alert">{error||loadError}{loadError&&<button onClick={()=>setAttempt(n=>n+1)}>Reintentar datos</button>}</div>}
        {!surface&&!loadError&&<p role="status" className="field-help">Cargando relieve y productos NASA verificados…</p>}
      </aside>
      <main className="science-main">
        <div className="map-toolbar"><div><span className="panel-kicker">DETALLE LOCAL · NASA LOLA 5 M</span><h1>Comprueba las condiciones de tu misión.</h1></div><div className="view-buttons" aria-label="Cámara">{(['orbit','top','mast','polar'] as const).map(v=><button key={v} aria-pressed={view===v} onClick={()=>setView(v)}>{v==='orbit'?'Relieve':v==='top'?'Mapa':v==='polar'?'Contexto':'Superficie'}</button>)}<button title="Pantalla completa" onClick={toggleFullscreen}><Maximize2 size={14}/></button></div></div>
        <div className="science-map" data-testid="lunar-map">
          <Tactical3DScene latDeg={cell?.latitude_deg??(Number(manualLat)||-89.46315776)} lonDeg={cell?.longitude_deg??(Number(manualLon)||-137.50198491)}
            observerHeightM={2} sunAzimuthDeg={sample?.azimuth_deg??0} sunElevationDeg={sample?.elevation_deg??0}
            earthAzimuthDeg={earthSample?.azimuth_deg??0} earthElevationDeg={earthSample?.elevation_deg??0}
            minSolarElevation={-90} maxSlopeDeg={current?.limits.maxSlope??Number(limits.maxSlope)}
            currentSlopeDeg={cell?.max_slope_deg??NaN} atlasData={atlas} detailAtlasData={detail} contextAtlasData={contextAtlas}
            sunRaycast={sunRay} earthRaycast={earthRay} cameraView={view} siteName={region?.name??'Cobertura desconocida'}
            placementMode={placement} onTogglePlacementMode={()=>setPlacement(p=>!p)} onSurfacePlace={place} cameraResetKey={cameraKey}
            scienceReady={Boolean(current)} assessmentRisk={selected?.risk??'unknown'} assessments={assessments}
            active={active} altitudeM={telemetry?.altitudeM??0} landed={landed}/>
          <div className="map-caption"><span><Layers size={12}/> {view==='polar'?'NASA LOLA · fuente 80 m · vista ~791 m · fondo = altitud':'NASA LOLA · parche local 5 m · relieve sin exageración'}</span><span>Rayos desde 2 m · cuerpos ilustrativos</span></div>
          {!current&&<div className="map-start-hint">{dirty?'Parámetros cambiados. Ejecuta de nuevo para actualizar los contornos.':'Elige un destino y simula para revelar los contornos de aptitud.'}</div>}
          <div className="map-legend" aria-label="Leyenda de aptitud"><span><i className="green"/>Cumple {current?'· '+counts.green:''}</span><span><i className="yellow"/>Precaución {current?'· '+counts.yellow:''}</span><span><i className="red"/>No cumple {current?'· '+counts.red:''}</span><span><i className="unknown"/>Desconocido</span></div>
        </div>
        <div className="mission-timeline">
          <div className="timeline-title"><span><Clock size={12} style={{verticalAlign:'middle'}}/> {sample?utcLabel(sample.t_utc):'SIN EFEMÉRIDES CALCULADAS'}</span><span>{current?'Muestra '+(index+1)+' / '+rows.length:'Los colores aparecen tras simular'}</span></div>
          <div className="timeline-controls"><button aria-label={playing?'Pausar tiempo':'Reproducir tiempo'} disabled={!current||Boolean(flightPlaying)} onClick={()=>{setFlightPlaying(false);setFlight(null);if(index===rows.length-1)setIndex(0);setPlaying(p=>!p)}}>{playing?<Pause size={16}/>:<Play size={16}/>}</button><input aria-label="Instante de misión" type="range" min="0" max={Math.max(0,rows.length-1)} value={index} disabled={!current||flightPlaying} onChange={e=>seekMission(Number(e.target.value))}/><strong>+{index} h</strong></div>
          <div className="visibility-strip" aria-label="Visibilidad conjunta por hora">{rows.slice(0,-1).map((s,i)=><button key={s.t_utc} aria-label={utcLabel(s.t_utc)} className={(s.elevation_deg-s.horizon_deg>current!.limits.sunMargin?'sun-on':'sun-off')+' '+(current!.earth.samples[i].elevation_deg-current!.earth.samples[i].horizon_deg>current!.limits.earthMargin?'earth-on':'earth-off')} title={utcLabel(s.t_utc)+' · altura Sol '+s.elevation_deg.toFixed(2)+'°'} onClick={()=>seekMission(i)}/>)}</div>
          <p className="field-help">Franja superior: Sol; inferior: Tierra. Ventanas [inicio, fin); cambios de visibilidad inciertos hasta 1 h. No se extrapola fuera del intervalo.</p>
        </div>
      </main>
      <aside className="science-results">
        <div className="panel-heading"><span>RESULTADOS DE TU MISIÓN</span><span className="live-label">{current?'CALCULADO':'PENDIENTE'}</span></div>
        <div className={'assessment-status risk-'+(selected?.risk??'unknown')} data-testid="assessment-status"><ShieldCheck size={25}/><strong>{status}</strong><small>{current?'Criterios geométricos evaluados · no certificación':'Sin datos calculados no se declara aptitud'}</small></div>
        <section><h2><Sun size={15}/> Condiciones del destino</h2>
          <div className="body-readout"><span>SOL</span><strong>{format(sample?.elevation_deg,2)}<small>° elevación</small></strong><div>Azimut {format(sample?.azimuth_deg,2)}°</div><div>Horizonte {format(sample?.horizon_deg,2)}°</div><div>Despeje {format(selected?.sunMargin,2)}°</div></div>
          <div className="body-readout earth"><span>TIERRA</span><strong>{format(earthSample?.elevation_deg,2)}<small>° elevación</small></strong><div>Azimut {format(earthSample?.azimuth_deg,2)}°</div><div>Horizonte {format(earthSample?.horizon_deg,2)}°</div><div>Despeje {format(selected?.earthMargin,2)}°</div></div>
          <div className="measured-row"><span>Próximo bloqueo solar</span><strong>{darkLabel}</strong></div>
          <div className="measured-row"><span>Horas Sol / Tierra</span><strong>{format(totals?.sunHours,0)} / {format(totals?.earthHours,0)} h</strong></div>
          <div className="measured-row"><span>Visibilidad simultánea</span><strong>{format(totals?.jointHours,0)} h</strong></div>
          <div className="measured-row"><span>Mayor intervalo sin Sol</span><strong>{format(totals?.longestDark,0)} h</strong></div>
          {selected&&<ul className="assessment-reasons">{selected.reasons.map(r=><li key={r}>{r}</li>)}</ul>}
          {best&&best.cell.id!==cellId&&<button className="wide quiet" onClick={()=>chooseCell(best.cell.id,true)}>Elegir mejor celda evaluada · {format(best.cell.max_slope_deg)}°</button>}
          {current&&!best&&<p className="field-help">Ninguna celda cumple todos los criterios en este instante. Cambia la fecha o revisa los requisitos.</p>}
        </section>
        <section className="descent-panel"><h2><Rocket size={15}/> Ensayo de descenso</h2>
          <p className="field-help">Gravedad lunar, empuje, masa y combustible integrados con RK4. Vehículo hipotético; trayectoria vertical, sin navegación lateral.</p>
          <button className="wide quiet" disabled={!current} onClick={startDescent}>Simular descenso físico</button>
          {flight&&<><div className="measured-row"><span>Altitud sobre superficie</span><strong>{format(telemetry?.altitudeM,0)} m</strong></div><div className="measured-row"><span>Velocidad vertical</span><strong>{format(telemetry?.velocityMps)} m/s</strong></div><div className="measured-row"><span>Combustible</span><strong>{format(telemetry?.fuelKg,0)} kg</strong></div><div className="measured-row"><span>Gravedad / empuje</span><strong>{format(telemetry?.gravityMps2,3)} m/s² · {format((telemetry?.thrustN??0)/1000)} kN</strong></div>
          <div className="flight-controls"><button onClick={()=>setFlightPlaying(p=>!p)} disabled={landed}>{flightPlaying?'Pausar':'Continuar'}</button><label>Velocidad<select aria-label="Velocidad del ensayo" value={flightSpeed} onChange={e=>setFlightSpeed(Number(e.target.value))}><option value={1}>1×</option><option value={10}>10×</option><option value={60}>60×</option></select></label></div>
          <p role="status" className="touchdown-status">{landed?(flight.outcome==='soft-touchdown'?'CONTACTO SUAVE · ':'IMPACTO / DESCENSO INCOMPLETO · ')+format(flight.impactSpeedMps,2)+' m/s · '+format(cell?.latitude_deg,6)+'°, '+format(cell?.longitude_deg,6)+'°':'Descendiendo · '+format(flightTime,0)+' / '+format(flight.durationS,0)+' s'}</p>
          {landed&&<p className="field-help">La velocidad de contacto y la aptitud ambiental son evaluaciones independientes. El marcador indica la celda seleccionada.</p>}</>}
        </section>
        <WindowPlannerPanel run={current} onApplyStart={setStart} active={active}/>
        <MissionCopilot context={copilotContext} onAction={copilotAction} active={active}/>
        <div className="model-scope"><Database size={13}/><p>Modelo de planificación con datos NASA. Sin balance térmico, energía eléctrica, presupuesto RF, rocas menores de 5 m ni validación SPICE independiente. Verde expresa el cumplimiento del modelo.</p></div>
        <button className="wide quiet" disabled={!current} onClick={exportRun}>Descargar evidencia JSON</button>
      </aside>
    </div>
    {evidence&&<div className="evidence-backdrop" onClick={()=>setEvidence(false)}><section onKeyDown={e=>{if(e.key==='Escape')setEvidence(false)}} className="evidence-dialog" role="dialog" aria-modal="true" aria-label="Evidencia NASA de la simulación" onClick={e=>e.stopPropagation()}>
      <div className="panel-heading"><span>EVIDENCIA DEL DESTINO SELECCIONADO</span><button autoFocus onClick={()=>setEvidence(false)}>Cerrar <X size={12} style={{verticalAlign:'middle'}}/></button></div>
      <h2>{region?.name??'Fuera de cobertura'} · {cellId}</h2><p>{cell?cell.latitude_deg.toFixed(8)+'°, '+cell.longitude_deg.toFixed(8)+'° · '+format(cell.elevation_m,3)+' m':'Terreno desconocido'}</p>
      {current?<><p>Intervalo: {utcLabel(rows[0].t_utc)} → {utcLabel(rows.at(-1)!.t_utc)}. Observador: 2 m. Efemérides: 60 minutos.</p><p><a href={current.sun.meta.query_url} target="_blank" rel="noreferrer">Consulta exacta del Sol · JPL Horizons ↗</a></p><p><a href={current.earth.meta.query_url} target="_blank" rel="noreferrer">Consulta exacta de la Tierra · JPL Horizons ↗</a></p><p>Recuperado: {current.sun.meta.retrieved_at}. En las celdas vecinas se traslada geométricamente el vector aparente NASA usando su distancia; es una aproximación espacial, no una solución SPICE independiente por celda.</p></>:<p>Ejecuta la simulación para obtener consultas verificables del destino y fechas actuales.</p>}
      {Object.entries(region?.products??{}).map(([name,url])=><p key={name}><a href={url} target="_blank" rel="noreferrer">NASA LOLA · {name} · producto original de 5 m ↗</a></p>)}
      <p>NASA informa que cerca del 90% de los píxeles del DEM son interpolados. El espaciado de 5 m no garantiza resolver obstáculos de ese tamaño.</p><p>Pendiente del píxel: {format(cell?.slope_deg,4)}°. Máxima de celda y huella: {format(cell?.max_slope_deg,4)}°. Horizonte: 360 rayos, hasta 250 km, terreno local de 5 m y regional de 80 m. Reserva de precaución: 0,5° angular y 1° de pendiente; no representa una cota estadística del error.</p>
      <ul>{surface?.limitations.map(l=><li key={l}>{l}</li>)}</ul><button className="wide quiet" disabled={!current} onClick={exportRun}>Descargar cálculo, fuentes y hashes</button>
    </section></div>}
  </div>
}
