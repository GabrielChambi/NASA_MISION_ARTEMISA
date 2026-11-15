import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, CircleHelp, Clock3, Download, Globe2, Layers, LoaderCircle, MapPin, Orbit, Pause, Play, Rocket, Settings2, Sparkles, X } from 'lucide-react'
import { Tactical3DScene,type PlanMapMarker } from '../tactical/Tactical3DScene'
import { loadAtlas,type AtlasData } from '../sites/atlasGeometry'
import { loadDetailTile } from '../sites/lunarDetail'
import { validatePolarSurface,type PolarSurface } from '../tactical/polarScience'
import { DEFAULT_DESCENT,descentAt,simulateDescent,type DescentRun } from './descentPhysics'
import type { RaycastHit } from '../tactical/tacticalMath'
import type { AutomaticPlan,MissionIntent,MissionPoint } from './automaticTypes'
import SurfaceCoverageSummary,{SURFACE_CLASS_LABELS} from './SurfaceCoverageSummary'
import './unified-mission.css'

const EXAMPLE='Quiero hacer un viaje el 25 de diciembre de 2026 a las 8 am. ¿Dónde sería mejor alunizar y cuánto tardaría la misión?'
const TIMEZONE='America/La_Paz'
const unknownRay:RaycastHit={hit:true,hitDistanceM:NaN,hitPositionWorld:null,obstacleElevationDeg:NaN,marginDeg:NaN}
const num=(value:number|null|undefined,digits=1)=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('es',{maximumFractionDigits:digits}):'—'
const duration=(hours:number)=>{if(!Number.isFinite(hours))return '—';const rounded=Math.round(hours),d=Math.floor(rounded/24),h=rounded%24;return d?d+' d'+(h?' '+h+' h':''):h+' h'}
const longitude=(value:number,digits=2)=>num(Math.abs(value),digits)+'°'+(value<0?'O':'E')
const localDate=(utc:string)=>{const d=new Date(utc);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('es',{timeZone:TIMEZONE,day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(d):'—'}
function reasonPoint(p:MissionPoint){return p.reasons?.join(' ')||p.reason||'No hay evaluación suficiente para clasificar este sector.'}
function missionRequest(i:MissionIntent){return {departure_utc:i.departure_utc,date_kind:i.date_kind,surface_hours:i.surface_hours,max_slope_deg:i.max_slope_deg,min_sun_hours:i.min_sun_hours,min_earth_hours:i.min_earth_hours,observer_height_m:2}}

export default function UnifiedMissionPlanner(){
  const [atlas,setAtlas]=useState<AtlasData|null>(null),[polar,setPolar]=useState<PolarSurface|null>(null)
  const [loadError,setLoadError]=useState(''),[retry,setRetry]=useState(0)
  const [message,setMessage]=useState(''),[intent,setIntent]=useState<MissionIntent|null>(null),[assumptions,setAssumptions]=useState<string[]>([])
  const [coverageVisible,setCoverageVisible]=useState(true),[hoveredId,setHoveredId]=useState<string|null>(null)
  const [cellDetail,setCellDetail]=useState<MissionPoint|null>(null),[cellLoading,setCellLoading]=useState(false),[cellError,setCellError]=useState('')
  const [inspectLat,setInspectLat]=useState(''),[inspectLon,setInspectLon]=useState(''),[coordinateError,setCoordinateError]=useState('')
  const [plan,setPlan]=useState<AutomaticPlan|null>(null),[selectedId,setSelectedId]=useState('')
  const [busy,setBusy]=useState<'intent'|'science'|null>(null),[elapsed,setElapsed]=useState(0),[error,setError]=useState('')
  const [slope,setSlope]=useState(10),[sunHours,setSunHours]=useState(12),[earthHours,setEarthHours]=useState(12)
  const [stay,setStay]=useState('72'),[preferences,setPreferences]=useState(false),[evidence,setEvidence]=useState(false),[help,setHelp]=useState(false)
  const [cameraRevision,setCameraRevision]=useState(0)
  const [focus,setFocus]=useState(false),[detail,setDetail]=useState<AtlasData|null>(null),[visualStatus,setVisualStatus]=useState('')
  const [shadingStatus,setShadingStatus]=useState('Cargando relieve NASA…'),[timeline,setTimeline]=useState(0),[playing,setPlaying]=useState(false)
  const [flight,setFlight]=useState<DescentRun|null>(null),[flightTime,setFlightTime]=useState(0),[flying,setFlying]=useState(false)
  const [aiMode,setAiMode]=useState(''),[departureInput,setDepartureInput]=useState('')
  const request=useRef<AbortController|null>(null),requestId=useRef(0),startClock=useRef(0)
  const points=useMemo(()=>plan?[...(plan.best?[plan.best]:[]),...plan.alternatives,...plan.rejected,...(plan.closest_candidate?[plan.closest_candidate]:[])].filter((p,i,a)=>a.findIndex(x=>x.id===p.id)===i):[],[plan])
  const polarById=useMemo(()=>new Map(polar?.cells.map(c=>[c.id,c])??[]),[polar])
  const resultById=useMemo(()=>new Map([...(plan?.cells??[]),...points].map(p=>[p.id,p])),[plan,points])
  function sector(id:string):MissionPoint|null{
    const result=resultById.get(id);if(result)return result
    const c=polarById.get(id);if(!plan||!c)return null
    return {...c,risk:'unknown',sun_hours:null,earth_hours:null,reasons:['El borde del casquete no tiene un centro regional evaluado. Esta franja queda sin resolver; no se extrapola una recomendación.']}
  }
  const selectedSummary=useMemo(()=>sector(selectedId)??plan?.best??plan?.closest_candidate??null,[selectedId,plan,resultById,polarById])
  const selected=cellDetail?.id===selectedSummary?.id?cellDetail:selectedSummary
  const selectedCell=selected?polarById.get(selected.id)??null:null
  const hovered=hoveredId?sector(hoveredId):null
  const coverageLayer=useMemo(()=>coverageVisible&&plan?{cells:plan.cells,selectedId,opacity:1}:undefined,[coverageVisible,plan,selectedId])
  const series=selected?.time_series??[]
  const current=series[timeline]
  const selectedLabel=selected?SURFACE_CLASS_LABELS[selected.risk]:''
  const isRejected=Boolean(selected&&selected.risk!=='green')
  const markers=useMemo<PlanMapMarker[]>(()=>plan?[
    ...(plan.best?[{...plan.best,kind:'best' as const}]:[]),
    ...plan.alternatives.filter(p=>p.id!==plan.best?.id).map((p,i)=>({...p,kind:'alternative' as const,label:String(i+2)})),
    // Full classes are shown on the surface. Only recommended centers need markers.
  ]:[],[plan])
  const telemetry=flight?descentAt(flight,flightTime):null
  const landed=Boolean(flight&&flightTime>=flight.durationS)

  useEffect(()=>{
    const ac=new AbortController();setLoadError('')
    Promise.all([loadAtlas(ac.signal),fetch('/api/polar/surface',{signal:ac.signal}).then(async r=>{if(!r.ok)throw new Error('No se pudieron cargar los datos regionales NASA.');return validatePolarSurface(await r.json())})])
      .then(([a,p])=>{if(!ac.signal.aborted){setAtlas(a);setPolar(p)}}).catch(e=>{if(!ac.signal.aborted)setLoadError(e instanceof Error?e.message:'Datos NASA no disponibles.')})
    return()=>ac.abort()
  },[retry])
  useEffect(()=>()=>request.current?.abort(),[])
  useEffect(()=>{
    setCellDetail(null);setCellError('');setCellLoading(false)
    if(!plan||!intent||!selectedSummary||selectedSummary.time_series?.length||!resultById.has(selectedSummary.id))return
    const ac=new AbortController(),id=selectedSummary.id
    setCellLoading(true)
    fetch('/api/automatic-plan/cell',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...missionRequest(intent),cell_id:id}),signal:ac.signal})
      .then(async response=>{const data=await response.json();if(!response.ok||data.status!=='ok'||data.cell?.id!==id||data.mission?.arrival_utc!==plan.mission.arrival_utc)throw new Error(data.message??'No se pudieron cargar las condiciones de este sector.');if(!ac.signal.aborted)setCellDetail(data.cell)})
      .catch(e=>{if(!ac.signal.aborted)setCellError(e instanceof Error?e.message:'Condiciones del sector no disponibles.')})
      .finally(()=>{if(!ac.signal.aborted)setCellLoading(false)})
    return()=>ac.abort()
  },[plan,intent,selectedSummary?.id,resultById])
  useEffect(()=>{
    if(selectedSummary){setInspectLat(String(selectedSummary.latitude_deg));setInspectLon(String(selectedSummary.longitude_deg))}
    setCoordinateError('')
  },[selectedSummary?.id])

  useEffect(()=>{
    if(!busy)return
    const timer=setInterval(()=>setElapsed(Math.floor((performance.now()-startClock.current)/1000)),1000)
    return()=>clearInterval(timer)
  },[busy])
  useEffect(()=>{
    if(!focus||!selected||!atlas){setDetail(null);setVisualStatus('');return}
    const ac=new AbortController();setDetail(null);setVisualStatus('Cargando detalle…')
    loadDetailTile(atlas,selected.latitude_deg,selected.longitude_deg,ac.signal).then(d=>{if(!ac.signal.aborted){setDetail(d);setVisualStatus(d?'Detalle visual NASA cargado':'Se conserva el relieve regional')}}).catch(()=>{if(!ac.signal.aborted)setVisualStatus('Detalle no disponible; se conserva la vista general')})
    return()=>ac.abort()
  },[focus,selected,atlas])
  useEffect(()=>{setTimeline(0);setPlaying(false);setFlight(null);setFlying(false)},[selectedId,plan])
  useEffect(()=>{
    if(!playing||!series.length)return
    const timer=setInterval(()=>setTimeline(t=>{if(t>=series.length-1){setPlaying(false);return t}return t+1}),650)
    return()=>clearInterval(timer)
  },[playing,series.length])
  useEffect(()=>{
    if(!flying||!flight)return
    let frame=0,previous=performance.now()
    const tick=(now:number)=>{const dt=Math.min((now-previous)/1000,.2)*30;previous=now;setFlightTime(t=>{const next=Math.min(flight.durationS,t+dt);if(next===flight.durationS)setFlying(false);return next});frame=requestAnimationFrame(tick)}
    frame=requestAnimationFrame(tick)
    return()=>cancelAnimationFrame(frame)
  },[flying,flight])

  function invalidate(){
    request.current?.abort();requestId.current++;setBusy(null);setPlan(null);setIntent(null);setError('');setTimeline(0);setPlaying(false);setFlight(null);setFlying(false)
  }
  function clearResult(){request.current?.abort();requestId.current++;setBusy(null);setPlan(null);setError('');setFlight(null);setFlying(false);setPlaying(false)}
  async function calculate(text=message,reuseIntent?:MissionIntent){
    if(!text.trim()&&!reuseIntent){setError('Escribe la fecha y hora de tu viaje para empezar.');return}
    if(!atlas||!polar){setError('Espera a que terminen de cargar los datos NASA.');return}
    const requirements=reuseIntent??{surface_hours:Number(stay),max_slope_deg:slope,min_sun_hours:sunHours,min_earth_hours:earthHours}
    if(!Number.isInteger(requirements.surface_hours)||requirements.surface_hours<1||requirements.surface_hours>336||!Number.isFinite(requirements.max_slope_deg)||requirements.max_slope_deg<0||requirements.max_slope_deg>45){setError('Revisa la estancia (1–336 horas) y la pendiente máxima (0–45°).');return}
    if([requirements.min_sun_hours,requirements.min_earth_hours].some(value=>!Number.isFinite(value)||value<0||value>requirements.surface_hours)){setError('Las horas mínimas de Sol o Tierra deben estar entre cero y la duración de la estancia. Ajusta los requisitos; no se reducen automáticamente.');return}
    request.current?.abort();const ac=new AbortController(),id=++requestId.current;request.current=ac
    setError('');setPlan(null);setFlight(null);setFlying(false);setPlaying(false);setFocus(false);setElapsed(0);startClock.current=performance.now()
    try{
      let parsed=reuseIntent
      if(!parsed){
        setBusy('intent')
        const response=await fetch('/api/mission-intent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,timezone:TIMEZONE,defaults:{surface_hours:Number(stay),max_slope_deg:slope,min_sun_hours:sunHours,min_earth_hours:earthHours}}),signal:ac.signal})
        const data=await response.json()
        if(!response.ok)throw new Error(data.message??'No se pudo interpretar la solicitud.')
        if(data.needs_clarification){setError(data.question??'Indica la fecha y hora de salida.');setBusy(null);return}
        parsed=data.intent
        if(!parsed?.departure_utc)throw new Error('La solicitud no contiene una fecha de viaje válida.')
        setAiMode(data.mode==='ai'?'Gemini interpretó tu viaje':'Fecha interpretada por el sistema')
        setAssumptions(data.assumptions??[]);setStay(String(parsed.surface_hours));setSlope(parsed.max_slope_deg);setSunHours(parsed.min_sun_hours);setEarthHours(parsed.min_earth_hours)
      }
      if(ac.signal.aborted||id!==requestId.current)return
      setIntent(parsed);setDepartureInput(new Date(Date.parse(parsed.departure_utc)-4*3600000).toISOString().slice(0,16));setBusy('science')
      const response=await fetch('/api/automatic-plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(missionRequest(parsed)),signal:ac.signal})
      const data=await response.json()
      if(!response.ok||data.status!=='ok'||!data.coverage||!Array.isArray(data.cells))throw new Error(data.message??'NASA no pudo completar el análisis; no se inventará una recomendación.')
      if(ac.signal.aborted||id!==requestId.current)return
      setCoverageVisible(true);setHoveredId(null);setPlan(data);setSelectedId(data.best?.id??data.closest_candidate?.id??'');setPreferences(false)
      if(window.innerWidth<=900)setTimeout(()=>{if(id===requestId.current)document.querySelector('.one-map-heading')?.scrollIntoView({behavior:'smooth',block:'start'})},100)
    }catch(e){if(!ac.signal.aborted)setError(e instanceof Error?e.message:'No se pudo completar el cálculo.')}
    finally{if(!ac.signal.aborted&&id===requestId.current)setBusy(null)}
  }
  function choose(id:string){if(!polarById.has(id))return;setSelectedId(id);setError('');setCoordinateError('')}
  function sampleMap(lat:number,lon:number){
    if(!plan||!polar||!Number.isFinite(lat)||!Number.isFinite(lon)||lat< -90||lat> -80||lon< -180||lon>180)return
    const rho=2*polar.radius_m*Math.tan((90+lat)*Math.PI/360),x=rho*Math.sin(lon*Math.PI/180),y=rho*Math.cos(lon*Math.PI/180)
    const col=Math.floor((x-polar.grid.xmin)/polar.cell_spacing_m),row=Math.floor((polar.grid.ymax-y)/polar.cell_spacing_m)
    const c=polar.cells[row*polar.grid_size+col]
    if(c&&col>=0&&row>=0&&col<polar.grid_size&&row<polar.grid_size)choose(c.id)
  }
  function inspectCoordinates(){
    const lat=Number(inspectLat),lon=Number(inspectLon)
    if(!inspectLat.trim()||!inspectLon.trim()||!Number.isFinite(lat)||!Number.isFinite(lon)||lat< -90||lat> -80||lon< -180||lon>180){setCoordinateError('Indica una latitud entre −90 y −80 y una longitud entre −180 y 180.');return}
    sampleMap(lat,lon)
  }
  function runDescent(){
    if(!selected||isRejected||!plan?.best||selected.elevation_m==null||cellLoading||cellError)return
    try{setPlaying(false);setFlight(simulateDescent({...DEFAULT_DESCENT,surfaceElevationM:selected.elevation_m!}));setFlightTime(0);setFlying(true);setFocus(true)}
    catch(e){setError(e instanceof Error?e.message:'No se pudo simular el descenso.')}
  }
  function exportPlan(){
    if(!plan)return
    const data={...plan,user_request:message,interpreted_intent:intent,interpretation_assumptions:assumptions,selected_id:selected?.id,exported_at:new Date().toISOString(),descent:flight?{configuration:flight.config,outcome:flight.outcome,impact_speed_mps:flight.impactSpeedMps}:null}
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a')
    a.href=url;a.download='lunar-oracle-plan-de-mision.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  function recalculate(){
    if(!intent)return
    const date=new Date(departureInput+':00-04:00')
    if(!Number.isFinite(date.getTime())||!departureInput||new Date(date.getTime()-4*3600000).toISOString().slice(0,16)!==departureInput){setError('Revisa la fecha y hora.');return}
    void calculate(message,{...intent,departure_utc:date.toISOString().replace('.000Z','Z'),local_datetime:departureInput,surface_hours:Number(stay),max_slope_deg:slope,min_sun_hours:sunHours,min_earth_hours:earthHours})
  }
  const ray=(el:number|undefined,h:number|undefined):RaycastHit=>el!==undefined&&h!==undefined?{hit:el<=h,hitDistanceM:NaN,hitPositionWorld:null,obstacleElevationDeg:h,marginDeg:el-h}:unknownRay
  const rejectedTotal=plan?.counts.red??0
  return <div className="unified-mission" data-testid="unified-mission">
    <header className="unified-header"><div className="unified-logo"><Orbit size={30}/><div>LUNAR ORACLE<small>PLANIFICA TU LLEGADA A LA LUNA</small></div></div><span className="unified-data-status"><i/> NASA LOLA + JPL HORIZONS</span><button onClick={()=>setHelp(true)}><CircleHelp size={15}/> Cómo funciona</button></header>
    <div className="unified-layout">
      <aside className="trip-panel">
        <span className="micro-title">TU VIAJE EMPIEZA AQUÍ</span><h1>Dinos cuándo.<br/><em>Encontramos dónde.</em></h1>
        <p className="trip-lead">Escribe tu viaje. Calculamos la llegada, analizamos el polo sur y comparamos los destinos por ti.</p>
        <form onSubmit={e=>{e.preventDefault();void calculate()}}>
          <label htmlFor="mission-request">¿Qué misión quieres hacer?</label><textarea id="mission-request" aria-label="Describe tu misión" value={message} onChange={e=>{invalidate();setMessage(e.target.value)}} rows={5} maxLength={1600} placeholder="Quiero viajar el 25 de diciembre de 2026 a las 8 am. ¿Dónde alunizo y cuánto tarda la misión?"/>
          <button className="primary-plan" type="submit" disabled={Boolean(busy)||!atlas||!polar}>{busy?<LoaderCircle className="spin" size={17}/>:<Sparkles size={17}/>} {busy?'Calculando tu misión…':'Planificar mi misión'} {!busy&&<ArrowRight size={16}/>}</button>
        </form>
        {!plan&&!busy&&<button className="example-trip" onClick={()=>{setMessage(EXAMPLE);void calculate(EXAMPLE)}} disabled={!atlas||!polar}>Probar el viaje del 25 dic · 08:00 <ArrowRight size={12}/></button>}
        <div className="trip-assumption"><Clock3 size={13}/><span>Hora de Bolivia · UTC−04:00<br/>Estancia de ejemplo: {num(Number(stay),0)} h, editable abajo.</span></div>
        <button className="preferences-toggle" onClick={()=>setPreferences(v=>!v)} aria-expanded={preferences}><Settings2 size={13}/> {plan?'Cambiar fecha o requisitos':'Preferencias del viaje'}</button>
        {preferences&&<div className="trip-preferences">
          {intent&&<label>{intent.date_kind==='landing'?'Fecha de alunizaje':'Fecha de salida'} · hora Bolivia<input aria-label="Fecha de viaje" type="datetime-local" value={departureInput} onChange={e=>{clearResult();setDepartureInput(e.target.value)}}/></label>}
          <label>Tiempo en la Luna<select aria-label="Estancia en la Luna" value={stay} onChange={e=>{clearResult();setStay(e.target.value)}}><option value="24">1 día · 24 h</option><option value="48">2 días · 48 h</option><option value="72">3 días · 72 h</option><option value="168">7 días · 168 h</option>{!['24','48','72','168'].includes(stay)&&<option value={stay}>{stay} horas</option>}</select></label>
          <label>Pendiente regional máxima · grados<input aria-label="Pendiente máxima" type="number" min={0} max={45} value={slope} onChange={e=>{clearResult();setSlope(Number(e.target.value))}}/></label><label>Horas mínimas de Sol<input aria-label="Horas mínimas de Sol" type="number" min={0} max={Number(stay)} value={sunHours} onChange={e=>{clearResult();setSunHours(Number(e.target.value))}}/></label><label>Horas mínimas de Tierra visible<input aria-label="Horas mínimas de Tierra" type="number" min={0} max={Number(stay)} value={earthHours} onChange={e=>{clearResult();setEarthHours(Number(e.target.value))}}/></label><p>El viaje de ida y vuelta se estima por separado. La estancia no es la duración total.</p>
          {intent&&<button onClick={recalculate} disabled={Boolean(busy)}>Recalcular con estos cambios</button>}
        </div>}
        {busy&&<div className="planning-progress" role="status"><span>{busy==='intent'?'Entendiendo fecha y objetivos':'Consultando NASA y comparando el polo sur'}</span><div><Check size={13}/> Relieve NASA de todo el casquete</div><div>{busy==='science'?<LoaderCircle size={13} className="spin"/>:<span className="progress-dot"/>} Sol, Tierra y horizontes de cada zona</div><small>{elapsed} s · puedes cancelar el cálculo</small><button onClick={()=>{request.current?.abort();setBusy(null)}}>Cancelar</button></div>}
        {(error||loadError)&&<div className="trip-error" role="alert">{error||loadError}{loadError&&<button onClick={()=>setRetry(r=>r+1)}>Reintentar datos</button>}</div>}
        {!atlas&&!loadError&&<p className="loading-note">Cargando el relieve lunar…</p>}
        {plan&&<div className="trip-overview"><span className="micro-title">TU ITINERARIO ESTIMADO</span>
          <div className="itinerary-item"><span className="itinerary-dot"/><div><small>Salida de la Tierra</small><strong>{localDate(plan.mission.departure_utc)}</strong></div></div>
          <div className="itinerary-duration">↓ Ida estimada: {duration(plan.mission.outbound_hours)}</div>
          <div className="itinerary-item"><span className="itinerary-dot moon"/><div><small>Alunizaje analizado</small><strong>{localDate(plan.mission.arrival_utc)}</strong></div></div>
          <div className="itinerary-duration">Estancia: {duration(plan.mission.surface_hours)}</div>
          <div className="itinerary-item"><span className="itinerary-dot"/><div><small>Regreso estimado</small><strong>{localDate(plan.mission.return_utc)}</strong></div></div>
          <div className="total-trip"><span>Duración total estimada</span><strong>{duration(plan.mission.total_hours)}</strong></div>
          <p className="estimate-note">Estimación orbital simplificada desde una órbita terrestre de 200 km. No incluye preparación, esperas ni diseño de trayectoria de una misión real.</p>
        </div>}
        <button className="evidence-link" onClick={()=>setEvidence(true)}><Layers size={13}/> Ver datos y supuestos</button>
      </aside>
      <main className="one-moon-panel">
        <div className="one-map-heading"><div><span className="micro-title">POLO SUR LUNAR · 80°S — 90°S</span><h2>{plan?'Toda la superficie. Una decisión informada.':'Una Luna. Todos los destinos.'}</h2></div><div className="one-map-actions"><button onClick={()=>{setFocus(false);setFlight(null);setFlying(false);setCameraRevision(r=>r+1)}} aria-pressed={!focus}>Todo el polo</button><button disabled={!selected||selected.latitude_deg> -80||selected.elevation_m==null} onClick={()=>{setFocus(true);setCameraRevision(r=>r+1)}} aria-pressed={focus}>Acercar destino</button></div></div>
        <div className="one-moon-map" data-testid="mission-map">
          <Tactical3DScene latDeg={selected?.latitude_deg??-90} lonDeg={selected?.longitude_deg??0} observerHeightM={2} sunAzimuthDeg={current?.sun_azimuth_deg??0} sunElevationDeg={current?.sun_elevation_deg??0} earthAzimuthDeg={current?.earth_azimuth_deg??0} earthElevationDeg={current?.earth_elevation_deg??0} minSolarElevation={0} maxSlopeDeg={intent?.max_slope_deg??10} currentSlopeDeg={selected?.regional_slope_deg??NaN}
            atlasData={atlas} focusTerrainData={detail} sunRaycast={ray(current?.sun_elevation_deg,current?.sun_horizon_deg)} earthRaycast={ray(current?.earth_elevation_deg,current?.earth_horizon_deg)} cameraView="polar" siteName={selected?'Destino elegido':'Polo sur'}
            overview focusZone={focus} onShadingStatus={setShadingStatus} cameraResetKey={cameraRevision+(focus?1:0)} missionMarkers={flight?[]:markers} onMarkerSelect={choose} polarSurface={polar} missionCoverage={coverageLayer} onCoverageSelect={choose} onCoverageHover={setHoveredId}
            onSurfacePlace={sampleMap} placementMode scienceReady={Boolean(current)} assessmentRisk={selected?.risk??'unknown'} showSurfaceVehicle={Boolean(flight)} altitudeM={telemetry?.altitudeM??0} landed={landed}/>
          <div className="one-map-source"><span>{plan&&coverageVisible&&!flight?'Evaluación de toda la superficie':'NASA LOLA · relieve continuo'}</span><small>{focus&&detail?'Detalle visual ~396 m · fuente 80 m':shadingStatus.includes('no disponible')?'Sombreado no disponible; relieve conservado':'Vista regional · fuente de 80 m'}{visualStatus.includes('no disponible')?' · '+visualStatus:''}</small></div>
          {!plan&&<div className="one-map-empty"><Orbit size={20}/><strong>{busy?'Estamos calculando tus destinos.':'Escribe tu viaje para ver dónde alunizar.'}</strong><span>{busy?'La recomendación aparecerá aquí con sus alternativas.':'Sin cambiar de pantalla ni elegir capas técnicas.'}</span></div>}
          {plan&&!flight&&<div className="surface-inspection-hint"><MapPin size={12}/>{hovered?<><b className={'risk-text '+hovered.risk}>{SURFACE_CLASS_LABELS[hovered.risk]}</b><span>{num(Math.abs(hovered.latitude_deg),2)}°S · {longitude(hovered.longitude_deg)} · pendiente P95 {num(hovered.regional_slope_deg)}°</span></>:<span>Haz clic en cualquier área para ver sus mediciones y motivos.</span>}</div>}
        </div>
        {plan&&<SurfaceCoverageSummary plan={plan} active={coverageVisible} onToggle={()=>setCoverageVisible(v=>!v)} onEvidence={()=>setEvidence(true)}/>}
        {plan&&<div className="mission-conditions">
          <div className="conditions-heading"><strong><Globe2 size={15}/> Condiciones durante tu estancia</strong><time>{current?localDate(current.t_utc):localDate(plan.mission.arrival_utc)} · Bolivia</time></div>
          <div className="conditions-slider"><button aria-label={playing?'Pausar condiciones':'Reproducir condiciones'} disabled={!series.length||flying} onClick={()=>{if(timeline===series.length-1)setTimeline(0);setPlaying(v=>!v)}}>{playing?<Pause size={14}/>:<Play size={14}/>}</button><input aria-label="Hora de la estancia" type="range" min={0} max={Math.max(0,series.length-1)} value={timeline} disabled={!series.length||flying} onChange={e=>{setPlaying(false);setTimeline(Number(e.target.value))}}/><span>+{timeline} h</span></div>
          <div className="conditions-readouts"><span>Sol sobre el horizonte <b>{num(current?current.sun_elevation_deg-current.sun_horizon_deg:null,2)}°</b></span><span>Tierra sobre el horizonte <b>{num(current?current.earth_elevation_deg-current.earth_horizon_deg:null,2)}°</b></span><span>{cellLoading?'Cargando condiciones del sector…':'Resolución temporal'} <b>{cellLoading?'':'1 h'}</b></span></div>
        </div>}
      </main>
      <aside className="mission-decisions">
        {!plan?<div className="decision-welcome"><MapPin size={28}/><h2>Aquí encontrarás tu mejor opción.</h2><p>El sistema relacionará la fecha de tu viaje con el terreno, la luz y la visibilidad de la Tierra.</p><ul><li><Check size={13}/> Un destino recomendado y sus razones</li><li><Check size={13}/> Clasificación de toda la superficie</li><li><Check size={13}/> Tiempo estimado de ida, estancia y vuelta</li></ul><small>Los resultados corresponden a un modelo regional de planificación, no a una autorización de vuelo.</small></div>:<>
          <div className="decision-title"><span className="micro-title">{plan.best?'RECOMENDACIÓN CALCULADA':'NINGUNA ZONA CUMPLE TODOS LOS CRITERIOS'}</span>{aiMode&&<small>{aiMode}</small>}</div>
          {plan.best?<button className={'best-destination '+(selected?.id===plan.best.id?'selected':'')} onClick={()=>choose(plan.best!.id)}><span className="best-badge">★ MEJOR CANDIDATO</span><h2>{num(Math.abs(plan.best.latitude_deg),3)}°S · {longitude(plan.best.longitude_deg,3)}</h2><p>{reasonPoint(plan.best)}</p><div className="destination-metrics"><span>Luz solar<strong>{num(plan.best.sun_hours,0)} h</strong></span><span>Tierra visible<strong>{num(plan.best.earth_hours,0)} h</strong></span><span>Pendiente P95<strong>{num(plan.best.regional_slope_deg)}°</strong></span></div></button>:<div className="no-fit-plan"><h2>Revisa las condiciones antes de elegir.</h2><p>No se ha forzado un lugar verde. Cambia la fecha o la estancia para recalcular; los requisitos no se relajan automáticamente.</p></div>}
          {plan.alternatives.filter(p=>p.id!==plan.best?.id).length>0&&<section className="other-destinations"><h3>También puedes estudiar</h3>{plan.alternatives.filter(p=>p.id!==plan.best?.id).map((p,i)=><button key={p.id} className={selected?.id===p.id?'selected':''} onClick={()=>choose(p.id)}><span className="destination-number">{i+2}</span><div><strong>{num(Math.abs(p.latitude_deg),2)}°S · {longitude(p.longitude_deg,2)}</strong><small>{num(p.sun_hours,0)} h de Sol · {num(p.earth_hours,0)} h de Tierra</small></div><ArrowRight size={13}/></button>)}</section>}
          {selected&&<section className="selected-destination"><div className="selected-destination-title"><span className={'selected-color '+selected.risk}/><h3>{selectedLabel}</h3></div><span className="selected-sector-id">Sector {selected.id.replace('polar:','')} · {num(selected.area_km2,2)} km² regionales</span><p>{reasonPoint(selected)}</p><dl><div><dt>Centro del sector</dt><dd>{num(selected.latitude_deg,5)}°, {num(selected.longitude_deg,5)}°</dd></div><div><dt>Elevación</dt><dd>{num(selected.elevation_m??selectedCell?.elevation_m,0)} m</dd></div><div><dt>Pendiente P95 · fuente de 80 m</dt><dd>{num(selected.regional_slope_deg)}°</dd></div><div><dt>Máxima pendiente nativa</dt><dd>{num(selected.max_slope_deg??selectedCell?.max_slope_deg)}°</dd></div><div><dt>Sol visible acumulado</dt><dd>{num(selected.sun_hours,0)} h</dd></div><div><dt>Tierra visible acumulada</dt><dd>{num(selected.earth_hours,0)} h</dd></div></dl>
            {selected.sun_hours_sensitivity&&selected.earth_hours_sensitivity&&<div className="sampling-sensitivity"><strong>Variación por muestreo angular</strong><span>Sol: {num(selected.sun_hours_sensitivity.lower,0)}–{num(selected.sun_hours_sensitivity.upper,0)} h · Tierra: {num(selected.earth_hours_sensitivity.lower,0)}–{num(selected.earth_hours_sensitivity.upper,0)} h</span><small>Compara direcciones vecinas del horizonte. No es una probabilidad de éxito.</small></div>}
            {cellLoading&&<p className="cell-detail-status" role="status"><LoaderCircle className="spin" size={13}/> Cargando condiciones de esta área…</p>}
            {cellError&&<p className="trip-error" role="alert">{cellError}</p>}
            <button className="simulate-arrival" disabled={isRejected||!plan.best||cellLoading||Boolean(cellError)} onClick={runDescent}><Rocket size={14}/> Simular llegada a este destino</button>
            {flight&&<div className="arrival-telemetry"><strong>{landed?(flight.outcome==='soft-touchdown'?'Contacto suave en el modelo':'Impacto en el modelo'):'Descenso físico · 30×'}</strong><span>Altura: {num(telemetry?.altitudeM,0)} m</span><span>Velocidad: {num(telemetry?.velocityMps,1)} m/s</span><span>Combustible: {num(telemetry?.fuelKg,0)} kg</span><button onClick={()=>setFlying(v=>!v)} disabled={landed}>{flying?'Pausar':'Continuar'}</button><small>Nave hipotética y descenso vertical. Su resultado no certifica el destino.</small></div>}
          </section>}
          <details className="coordinate-inspector"><summary>Consultar cualquier coordenada del polo sur</summary><form onSubmit={e=>{e.preventDefault();inspectCoordinates()}}><label>Latitud<input aria-label="Latitud a consultar" type="number" step="any" min={-90} max={-80} value={inspectLat} onChange={e=>setInspectLat(e.target.value)}/></label><label>Longitud<input aria-label="Longitud a consultar" type="number" step="any" min={-180} max={180} value={inspectLon} onChange={e=>setInspectLon(e.target.value)}/></label><button type="submit">Examinar área</button>{coordinateError&&<p role="alert">{coordinateError}</p>}</form></details>
          <details className="rejected-destinations"><summary>{num(rejectedTotal,0)} zonas descartadas · ver ejemplos</summary>{plan.rejected.map(p=><button key={p.id} onClick={()=>choose(p.id)}><span className="reject-dot"/><div><strong>{num(Math.abs(p.latitude_deg),2)}°S · {longitude(p.longitude_deg,2)}</strong><small>{p.reasons?.[0]??'No cumple los criterios'}</small></div></button>)}</details>
          <button className="download-plan" onClick={exportPlan}><Download size={14}/> Descargar plan y evidencia</button>
          <p className="decision-scope">Los colores describen sectores regionales, con condiciones calculadas en sus centros. Una zona verde puede contener pendientes locales mayores. Falta evaluar rocas pequeñas, huella de la nave, energía, temperatura y enlace de radio.</p>
        </>}
      </aside>
    </div>
    {(help||evidence)&&<div className="mission-modal-backdrop" onClick={()=>{setHelp(false);setEvidence(false)}}><section className="mission-modal" role="dialog" aria-modal="true" aria-label={help?'Cómo se planifica tu misión':'Datos del plan de misión'} onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Escape'){setHelp(false);setEvidence(false)}}}><div className="modal-top"><h2>{help?'Escribe tu viaje. Nosotros calculamos.':'Los datos detrás de tu recomendación.'}</h2><button autoFocus aria-label="Cerrar información" onClick={()=>{setHelp(false);setEvidence(false)}}><X size={17}/></button></div>
      {help?<><p>Escribe la fecha y hora de salida y pulsa <strong>Planificar mi misión</strong>. Gemini interpreta tu petición; el motor científico consulta NASA y compara el polo sur automáticamente.</p><p>La evaluación cubre todo el polo sur visible. Verde indica sectores favorables en el modelo, amarillo indica sensibilidad al muestreo, rojo indica que no cumplen los criterios y gris indica datos insuficientes. Haz clic en cualquier área para consultar su pendiente, Sol, Tierra y motivos. La estrella destaca el mejor centro candidato; los colores no certifican cada punto de un sector.</p><p>Si dices «alunizar el…», esa fecha se interpreta como llegada. Si dices «viajar el…», se interpreta como salida. La hora se interpreta en Bolivia (UTC−04:00) o en UTC si lo indicas.</p><p>La ida y vuelta usan una estimación orbital simplificada. La estancia se declara como supuesto editable. Una misión real requiere diseñar la trayectoria, la nave y sus operaciones.</p></>:<><p>{plan?'Datos del cálculo actual:':'Escribe y calcula una misión para obtener las consultas y mediciones de tu caso.'}</p><ul>{assumptions.map(a=><li key={a}>{a}</li>)}{plan?.mission.assumptions?.map(a=><li key={a}>{a}</li>)}</ul><p>Terreno: NASA LOLA de 80 m. Comparación regional por sectores de 4,75 km y perfiles de horizonte propios por centro. Los intervalos amarillo/verde comparan los azimuts vecinos del horizonte; no representan toda la incertidumbre del terreno. Los sectores del borde sin mediciones se conservan en gris. Las superficies se calculan sobre la esfera lunar y se recortan al casquete 80–90°S.</p><ul>{plan?.meta.limitations.map(note=><li key={note}>{note}</li>)}</ul><details><summary>Consultas y procedencia completas</summary><pre>{JSON.stringify(plan?.meta.sources??[],null,2)}</pre></details>{plan&&<button className="download-plan" onClick={exportPlan}><Download size={14}/> Descargar evidencia completa</button>}</>}
    </section></div>}
  </div>
}
