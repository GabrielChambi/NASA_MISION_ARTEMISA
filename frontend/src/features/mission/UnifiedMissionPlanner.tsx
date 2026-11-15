import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Bot, Check, ChevronDown, CircleHelp, Clock3, Compass, Cpu, Download, FileUp, Globe2, Layers, LoaderCircle, MapPin, Maximize2, Minimize2, Orbit, Pause, Play, Plus, Radio, Rocket, Send, Settings2, Sun, X } from 'lucide-react'
import { Tactical3DScene,type PlanMapMarker } from '../tactical/Tactical3DScene'
import { loadAtlas,type AtlasData } from '../sites/atlasGeometry'
import { loadDetailTile } from '../sites/lunarDetail'
import { validatePolarSurface,type PolarSurface } from '../tactical/polarScience'
import { DEFAULT_DESCENT,descentAt,simulateDescent,type DescentRun } from './descentPhysics'
import type { RaycastHit } from '../tactical/tacticalMath'
import type { AutomaticPlan,LanderReview,MissionIntent,MissionPoint,VehicleProfile } from './automaticTypes'
import SurfaceCoverageSummary,{SURFACE_CLASS_LABELS} from './SurfaceCoverageSummary'
import './unified-mission.css'

const EXAMPLE='Quiero hacer un viaje el 25 de diciembre de 2026 a las 8 am. ¿Dónde sería mejor alunizar y cuánto tardaría la misión?'
const TIMEZONE='America/La_Paz'

export const LUNAR_OBJECTS:Record<string,VehicleProfile>={
  blue_moon:{
    lander_name:'Blue Moon MK2',
    solar_panel_height:15,
    antenna_height:12,
    center_of_gravity_tolerance:10,
    category:'Lander Tripulado HLS',
    description:'Módulo lunar tripulado de Blue Origin (Artemis V) con paneles a 15 m y antena DTE a 12 m.'
  },
  starship:{
    lander_name:'Starship HLS',
    solar_panel_height:50,
    antenna_height:38,
    center_of_gravity_tolerance:10,
    category:'Lander Tripulado HLS',
    description:'Torre lunar de SpaceX (50 m) capaz de superar sombras de cráteres profundos en el Polo Sur.'
  },
  alpaca:{
    lander_name:'Dynetics ALPACA',
    solar_panel_height:6,
    antenna_height:8,
    center_of_gravity_tolerance:12,
    category:'Lander Tripulado HLS',
    description:'Módulo de centro de gravedad ultrabajo (tolerancia 12°) para laderas escarpadas.'
  },
  griffin:{
    lander_name:'Griffin Lander (Astrobotic)',
    solar_panel_height:4.5,
    antenna_height:4,
    center_of_gravity_tolerance:10,
    category:'Lander de Carga CLPS',
    description:'Plataforma polar de carga pesada diseñada para transportar rovers al Polo Sur.'
  },
  nova_c:{
    lander_name:'Nova-C IM-2 (Intuitive Machines)',
    solar_panel_height:4,
    antenna_height:3.5,
    center_of_gravity_tolerance:9,
    category:'Lander Comercial CLPS',
    description:'Módulo hexagonal comercial para prospección de hielo en crestas polares.'
  },
  blue_ghost:{
    lander_name:'Blue Ghost (Firefly)',
    solar_panel_height:3.2,
    antenna_height:3.5,
    center_of_gravity_tolerance:11,
    category:'Lander Comercial CLPS',
    description:'Módulo compacto de alta estabilidad geométrica para instrumentos científicos.'
  },
  ltv_rover:{
    lander_name:'Lunar Terrain Vehicle (LTV)',
    solar_panel_height:2.5,
    antenna_height:3,
    center_of_gravity_tolerance:15,
    category:'Rover y Movilidad',
    description:'Vehículo todoterreno Artemis no presurizado para exploración de bordes de cráter (15°).'
  },
  lunar_cruiser:{
    lander_name:'Rover Presurizado (JAXA/Toyota)',
    solar_panel_height:5,
    antenna_height:5.5,
    center_of_gravity_tolerance:12,
    category:'Rover y Movilidad',
    description:'Cabina móvil presurizada para travesías polares de múltiples días.'
  },
  viper:{
    lander_name:'Rover VIPER (NASA)',
    solar_panel_height:2.5,
    antenna_height:2.8,
    center_of_gravity_tolerance:14,
    category:'Rover y Movilidad',
    description:'Rover explorador de volátiles y hielo de agua con mástil solar e iluminación.'
  },
  artemis_habitat:{
    lander_name:'Hábitat Base Artemis (SHH)',
    solar_panel_height:18,
    antenna_height:16,
    center_of_gravity_tolerance:8,
    category:'Infraestructura Polar',
    description:'Módulo habitable fijo de superficie con mástil solar elevado a 18 m.'
  },
  vsat_tower:{
    lander_name:'Torre Solar Vertical (NASA VSAT)',
    solar_panel_height:32,
    antenna_height:24,
    center_of_gravity_tolerance:9,
    category:'Infraestructura Polar',
    description:'Torre energética desplegable de 32 m para captar luz rasante en el Polo Sur.'
  }
}

type ChatTurn={
  id:string
  role:'user'|'assistant'
  text:string
  vehicle?:VehicleProfile
  timestamp:string
}

const unknownRay:RaycastHit={hit:true,hitDistanceM:NaN,hitPositionWorld:null,obstacleElevationDeg:NaN,marginDeg:NaN}
const num=(value:number|null|undefined,digits=1)=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('es',{maximumFractionDigits:digits}):'—'
const duration=(hours:number)=>{if(!Number.isFinite(hours))return '—';const rounded=Math.round(hours),d=Math.floor(rounded/24),h=rounded%24;return d?d+' d'+(h?' '+h+' h':''):h+' h'}
const longitude=(value:number,digits=2)=>num(Math.abs(value),digits)+'°'+(value<0?'O':'E')
const localDate=(utc:string)=>{const d=new Date(utc);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('es',{timeZone:TIMEZONE,day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(d):'—'}
function reasonPoint(p:MissionPoint){return p.reasons?.join(' ')||p.reason||'No hay evaluación suficiente para clasificar este sector.'}
function missionRequest(i:MissionIntent){return {departure_utc:i.departure_utc,date_kind:i.date_kind,surface_hours:i.surface_hours,max_slope_deg:i.max_slope_deg,min_sun_hours:i.min_sun_hours,min_earth_hours:i.min_earth_hours,observer_height_m:2}}

function matchCatalogVehicleFromText(text:string):VehicleProfile|null{
  const low=text.toLowerCase()
  if(low.includes('starship'))return LUNAR_OBJECTS.starship
  if(low.includes('blue moon'))return LUNAR_OBJECTS.blue_moon
  if(low.includes('alpaca')||low.includes('dynetics'))return LUNAR_OBJECTS.alpaca
  if(low.includes('griffin')||low.includes('astrobotic'))return LUNAR_OBJECTS.griffin
  if(low.includes('nova-c')||low.includes('nova c')||low.includes('intuitive'))return LUNAR_OBJECTS.nova_c
  if(low.includes('blue ghost')||low.includes('firefly'))return LUNAR_OBJECTS.blue_ghost
  if(low.includes('viper'))return LUNAR_OBJECTS.viper
  if(low.includes('cruiser')||low.includes('jaxa')||low.includes('toyota'))return LUNAR_OBJECTS.lunar_cruiser
  if(low.includes('ltv')||low.includes('rover'))return LUNAR_OBJECTS.ltv_rover
  if(low.includes('hábitat')||low.includes('habitat')||low.includes('base'))return LUNAR_OBJECTS.artemis_habitat
  if(low.includes('vsat')||low.includes('torre solar')||low.includes('torre'))return LUNAR_OBJECTS.vsat_tower
  return null
}

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
  const [vehicle,setVehicle]=useState<VehicleProfile>(LUNAR_OBJECTS.blue_moon)
  const [vehiclePulseKey,setVehiclePulseKey]=useState(0),[uploadNotice,setUploadNotice]=useState('')
  const [landerReview,setLanderReview]=useState<LanderReview|null>(null),[reviewBusy,setReviewBusy]=useState(false)
  const [catalogOpen,setCatalogOpen]=useState(false),[composerDrag,setComposerDrag]=useState(false)
  const [mapFullscreen,setMapFullscreen]=useState(false)
  const [chatTurns,setChatTurns]=useState<ChatTurn[]>([])
  const fileInputRef=useRef<HTMLInputElement|null>(null)
  const chatEndRef=useRef<HTMLDivElement|null>(null)
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
  const currentSunOk=Boolean(current&&current.sun_elevation_deg-current.sun_horizon_deg>0.3)
  const currentEarthOk=Boolean(current&&current.earth_elevation_deg-current.earth_horizon_deg>0.3)
  const currentBothOk=currentSunOk&&currentEarthOk
  const timelinePins=useMemo(()=>{
    if(!series.length)return []
    const pins:Array<{hour:number;kind:'ok'|'fail';label:string;detail:string}>=[]
    const lastIdx=series.length-1
    const isSun=(s:typeof series[number])=>s.sun_elevation_deg-s.sun_horizon_deg>0.3
    const isEarth=(s:typeof series[number])=>s.earth_elevation_deg-s.earth_horizon_deg>0.3
    const s0=isSun(series[0]),e0=isEarth(series[0])
    pins.push({
      hour:0,
      kind:s0&&e0?'ok':'fail',
      label:`0h · ${s0&&e0?'Inicio OK':'Sin despeje'}`,
      detail:`Alunizaje (+0h): Sol ${s0?'VERDE':'ROJO'} · Tierra ${e0?'VERDE':'ROJO'}`
    })
    for(let i=1;i<series.length;i++){
      const prevS=isSun(series[i-1]),currS=isSun(series[i])
      const prevE=isEarth(series[i-1]),currE=isEarth(series[i])
      if(prevS!==currS){
        pins.push({
          hour:i,
          kind:currS?'ok':'fail',
          label:`+${i}h · ${currS?'Luz Solar':'Sombra'}`,
          detail:currS?`En +${i}h los paneles (${vehicle.solar_panel_height}m) recuperan luz solar`:`En +${i}h el relieve bloquea el Sol en los paneles (${vehicle.solar_panel_height}m)`
        })
      }
      if(prevE!==currE){
        pins.push({
          hour:i,
          kind:currE?'ok':'fail',
          label:`+${i}h · ${currE?'Enlace Tierra':'Sin Tierra'}`,
          detail:currE?`En +${i}h la antena (${vehicle.antenna_height}m) recupera comunicación con la Tierra`:`En +${i}h se pierde comunicación con la Tierra (${vehicle.antenna_height}m)`
        })
      }
    }
    if(lastIdx>0){
      const sEnd=isSun(series[lastIdx]),eEnd=isEarth(series[lastIdx])
      pins.push({
        hour:lastIdx,
        kind:sEnd&&eEnd?'ok':'fail',
        label:`+${lastIdx}h · Fin`,
        detail:`Fin de estancia (+${lastIdx}h): Sol ${sEnd?'VERDE':'ROJO'} · Tierra ${eEnd?'VERDE':'ROJO'}`
      })
    }
    return pins
  },[series,vehicle.solar_panel_height,vehicle.antenna_height])
  const selectedLabel=selected?SURFACE_CLASS_LABELS[selected.risk]:''
  const isRejected=Boolean(selected&&selected.risk!=='green')
  const markers=useMemo<PlanMapMarker[]>(()=>plan?[
    ...(plan.best?[{...plan.best,kind:'best' as const}]:[]),
    ...plan.alternatives.filter(p=>p.id!==plan.best?.id).map((p,i)=>({...p,kind:'alternative' as const,label:String(i+2)})),
  ]:[],[plan])
  const telemetry=flight?descentAt(flight,flightTime):null
  const landed=Boolean(flight&&flightTime>=flight.durationS)
  const recommendedAlt=useMemo(()=>{
    if(!plan||!selected)return null
    const candidates=[...(plan.best?[plan.best]:[]),...plan.alternatives].filter(p=>p.id!==selected.id)
    return candidates[0]??plan.best??null
  },[plan,selected])

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
    fetch('/api/automatic-plan/cell',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...missionRequest(intent),cell_id:id,vehicle_profile:plan.vehicle_profile??vehicle}),signal:ac.signal})
      .then(async response=>{const data=await response.json();if(!response.ok||data.status!=='ok'||data.cell?.id!==id||data.mission?.arrival_utc!==plan.mission.arrival_utc)throw new Error(data.message??'No se pudieron cargar las condiciones de este sector.');if(!ac.signal.aborted)setCellDetail(data.cell)})
      .catch(e=>{if(!ac.signal.aborted)setCellError(e instanceof Error?e.message:'Condiciones del sector no disponibles.')})
      .finally(()=>{if(!ac.signal.aborted)setCellLoading(false)})
    return()=>ac.abort()
  },[plan,intent,selectedSummary?.id,resultById,vehicle])
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
  useEffect(()=>{
    if(!plan||!selected){setLanderReview(null);return}
    const ac=new AbortController();setReviewBusy(true)
    fetch('/api/copilot/lander-review',{
      method:'POST',headers:{'Content-Type':'application/json'},signal:ac.signal,
      body:JSON.stringify({
        vehicle_profile:plan.vehicle_profile??vehicle,
        selected,
        alternative:recommendedAlt,
        surface_hours:plan.mission.surface_hours,
        arrival_label:localDate(plan.mission.arrival_utc)
      })
    }).then(r=>r.json()).then(d=>{if(!ac.signal.aborted&&d.status==='ok')setLanderReview(d)}).catch(()=>{}).finally(()=>{if(!ac.signal.aborted)setReviewBusy(false)})
    return()=>ac.abort()
  },[plan,selected,recommendedAlt,vehicle])

  useEffect(()=>{
    if(!mapFullscreen)return
    const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')setMapFullscreen(false)}
    window.addEventListener('keydown',onKey)
    return()=>window.removeEventListener('keydown',onKey)
  },[mapFullscreen])

  useEffect(()=>{
    chatEndRef.current?.scrollIntoView({behavior:'smooth',block:'nearest'})
  },[chatTurns.length,landerReview,busy,error])

  function appendChatTurn(role:'user'|'assistant',text:string,turnVehicle?:VehicleProfile){
    const now=new Date().toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit',hour12:false})
    setChatTurns(prev=>[...prev.slice(-14),{id:`${Date.now()}-${Math.random()}`,role,text,vehicle:turnVehicle,timestamp:now}])
  }

  function applyVehicleProfile(next:VehicleProfile,noticeLabel?:string){
    setVehicle(next)
    setSlope(next.center_of_gravity_tolerance)
    setVehiclePulseKey(k=>k+1)
    setCatalogOpen(false)
    setUploadNotice(noticeLabel??`${next.lander_name} · Paneles ${next.solar_panel_height}m · Antena ${next.antenna_height}m · CG ${next.center_of_gravity_tolerance}°`)
    if(intent){
      appendChatTurn('user',`Cambiar objeto lunar a ${next.lander_name} (Paneles ${next.solar_panel_height}m, Antena ${next.antenna_height}m, CG ${next.center_of_gravity_tolerance}°)`,next)
      void calculate(message,{...intent,max_slope_deg:next.center_of_gravity_tolerance},next,true)
    }
  }
  async function handleProfileFile(file:File){
    try{
      const rawText=await file.text()
      const json=JSON.parse(rawText)
      const meta=json.extras??json.asset?.extras??json
      const lander_name=String(meta.lander_name??meta.name??file.name.replace(/\.(json|gltf|glb)$/i,'')).trim()||'Custom Lunar Lander'
      const solar_panel_height=Number(meta.solar_panel_height??meta.panel_height??15)
      const antenna_height=Number(meta.antenna_height??meta.dte_antenna_height??12)
      const center_of_gravity_tolerance=Number(meta.center_of_gravity_tolerance??meta.max_slope_deg??10)
      if(!Number.isFinite(solar_panel_height)||solar_panel_height<0.5||solar_panel_height>200||!Number.isFinite(antenna_height)||antenna_height<0.5||antenna_height>200||!Number.isFinite(center_of_gravity_tolerance)||center_of_gravity_tolerance<=0||center_of_gravity_tolerance>45){
        setError('El archivo debe incluir solar_panel_height (0.5–200m), antenna_height (0.5–200m) y center_of_gravity_tolerance (1–45°).')
        return
      }
      setError('')
      const customProfile:VehicleProfile={
        lander_name,
        solar_panel_height,
        antenna_height,
        center_of_gravity_tolerance,
        category:'Archivo Personalizado (.json/.gltf)',
        description:`Cargado desde ${file.name}`
      }
      applyVehicleProfile(customProfile,`Archivo adjunto: ${file.name} (${lander_name})`)
    }catch{
      setError('No se pudo leer el perfil del vehículo. Sube un archivo .json o .gltf válido.')
    }
  }
  function downloadSampleProfile(){
    const payload={
      lander_name:vehicle.lander_name,
      solar_panel_height:vehicle.solar_panel_height,
      antenna_height:vehicle.antenna_height,
      center_of_gravity_tolerance:vehicle.center_of_gravity_tolerance
    }
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'})),a=document.createElement('a')
    a.href=url;a.download=`${vehicle.lander_name.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-profile.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }

  function invalidate(){
    request.current?.abort();requestId.current++;setBusy(null);setPlan(null);setIntent(null);setError('');setTimeline(0);setPlaying(false);setFlight(null);setFlying(false)
  }
  function clearResult(){request.current?.abort();requestId.current++;setBusy(null);setPlan(null);setError('');setFlight(null);setFlying(false);setPlaying(false)}
  async function calculate(text=message,reuseIntent?:MissionIntent,overrideVehicle?:VehicleProfile,skipUserBubble=false){
    const detectedVehicle=!overrideVehicle&&text?matchCatalogVehicleFromText(text):null
    const activeVehicle=overrideVehicle??detectedVehicle??vehicle
    if(detectedVehicle&&detectedVehicle.lander_name!==vehicle.lander_name){
      setVehicle(detectedVehicle)
      setSlope(detectedVehicle.center_of_gravity_tolerance)
      setVehiclePulseKey(k=>k+1)
    }
    if(!text.trim()&&!reuseIntent){setError('Escribe la fecha y hora de tu viaje para empezar.');return}
    if(!atlas||!polar){setError('Espera a que terminen de cargar los datos NASA.');return}
    const requirements=reuseIntent??{surface_hours:Number(stay),max_slope_deg:activeVehicle.center_of_gravity_tolerance,min_sun_hours:sunHours,min_earth_hours:earthHours}
    if(!Number.isInteger(requirements.surface_hours)||requirements.surface_hours<1||requirements.surface_hours>336||!Number.isFinite(requirements.max_slope_deg)||requirements.max_slope_deg<0||requirements.max_slope_deg>45){setError('Revisa la estancia (1–336 horas) y la pendiente máxima (0–45°).');return}
    if([requirements.min_sun_hours,requirements.min_earth_hours].some(value=>!Number.isFinite(value)||value<0||value>requirements.surface_hours)){setError('Las horas mínimas de Sol o Tierra deben estar entre cero y la duración de la estancia. Ajusta los requisitos; no se reducen automáticamente.');return}
    if(!skipUserBubble&&text.trim()){
      appendChatTurn('user',text.trim(),activeVehicle)
    }
    request.current?.abort();const ac=new AbortController(),id=++requestId.current;request.current=ac
    setError('');setPlan(null);setFlight(null);setFlying(false);setPlaying(false);setElapsed(0);startClock.current=performance.now()
    try{
      let parsed=reuseIntent
      if(!parsed){
        setBusy('intent')
        const response=await fetch('/api/mission-intent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,timezone:TIMEZONE,defaults:{surface_hours:Number(stay),max_slope_deg:activeVehicle.center_of_gravity_tolerance,min_sun_hours:sunHours,min_earth_hours:earthHours}}),signal:ac.signal})
        const data=await response.json()
        if(!response.ok)throw new Error(data.message??'No se pudo interpretar la solicitud.')
        if(data.needs_clarification){
          const qText=data.question??'Indica la fecha y hora de salida.'
          setError(qText)
          appendChatTurn('assistant',qText)
          setBusy(null)
          return
        }
        parsed=data.intent
        if(!parsed?.departure_utc)throw new Error('La solicitud no contiene una fecha de viaje válida.')
        setAiMode(data.mode==='ai'?'Gemini interpretó tu viaje':'Fecha interpretada por el sistema')
        setAssumptions(data.assumptions??[]);setStay(String(parsed.surface_hours));setSlope(parsed.max_slope_deg);setSunHours(parsed.min_sun_hours);setEarthHours(parsed.min_earth_hours)
      }
      if(ac.signal.aborted||id!==requestId.current)return
      setIntent(parsed);setDepartureInput(new Date(Date.parse(parsed.departure_utc)-4*3600000).toISOString().slice(0,16));setBusy('science')
      const effectiveSlope=reuseIntent?parsed.max_slope_deg:activeVehicle.center_of_gravity_tolerance
      const response=await fetch('/api/automatic-plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...missionRequest(parsed),max_slope_deg:effectiveSlope,vehicle_profile:{...activeVehicle,center_of_gravity_tolerance:effectiveSlope}}),signal:ac.signal})
      const data=await response.json()
      if(!response.ok||data.status!=='ok'||!data.coverage||!Array.isArray(data.cells))throw new Error(data.message??'NASA no pudo completar el análisis; no se inventará una recomendación.')
      if(ac.signal.aborted||id!==requestId.current)return
      setCoverageVisible(true);setHoveredId(null);setPlan(data);setSelectedId(prev=>prev&&[...(data.best?[data.best]:[]),...data.alternatives,...data.rejected].some((p:MissionPoint)=>p.id===prev)?prev:(data.best?.id??data.closest_candidate?.id??''));setPreferences(false)
      if(window.innerWidth<=900)setTimeout(()=>{if(id===requestId.current)document.querySelector('.one-map-heading')?.scrollIntoView({behavior:'smooth',block:'start'})},100)
    }catch(e){
      if(!ac.signal.aborted){
        const msg=e instanceof Error?e.message:'No se pudo completar el cálculo.'
        setError(msg)
      }
    }
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
  const groupedCatalog=useMemo(()=>{
    const groups=new Map<string,Array<[string,VehicleProfile]>>()
    for(const entry of Object.entries(LUNAR_OBJECTS)){
      const cat=entry[1].category??'Otros Objetos'
      const list=groups.get(cat)??[]
      list.push(entry)
      groups.set(cat,list)
    }
    return Array.from(groups.entries())
  },[])

  return <div className={'unified-mission'+(mapFullscreen?' map-is-fullscreen':'')} data-testid="unified-mission">
    <header className="unified-header"><div className="unified-logo"><Orbit size={30}/><div>LUNAR ORACLE<small>PLANIFICA TU LLEGADA A LA LUNA</small></div></div><span className="unified-data-status"><i/> NASA LOLA + JPL HORIZONS</span><button onClick={()=>setHelp(true)}><CircleHelp size={15}/> Cómo funciona</button></header>
    <div className="unified-layout">
      <aside className="trip-panel chat-linked-panel">
        <div className="chat-panel-top">
          <span className="micro-title">GEMINI COPILOT</span>
          <h1>Dinos cuándo.<br/><em>Encontramos dónde.</em></h1>
        </div>

        {/* Fluid Gemini-style Conversational Thread */}
        <div className="mission-chat-thread" aria-live="polite">
          {chatTurns.length===0&&!plan&&!busy&&<div className="gemini-msg assistant">
            <div className="gemini-msg-head"><Bot size={15}/><span>Gemini</span></div>
            <div className="gemini-msg-content">
              <p>Escribe la fecha de tu viaje al Polo Sur Lunar. Desde la casilla inferior puedes adjuntar un archivo <code>.json</code> o <code>.gltf</code> con <strong>+</strong> o elegir cualquiera de los objetos y vehículos lunares.</p>
              <button type="button" className="example-trip" onClick={()=>{setMessage(EXAMPLE);void calculate(EXAMPLE)}} disabled={!atlas||!polar}>Probar el viaje del 25 dic · 08:00 <ArrowRight size={12}/></button>
            </div>
          </div>}

          {chatTurns.map(turn=>(
            turn.role==='user'?(
              <div key={turn.id} className="gemini-msg user">
                <div className="user-pill">
                  <p>{turn.text}</p>
                  {turn.vehicle&&<small className="user-pill-meta">{turn.vehicle.lander_name} · {turn.vehicle.solar_panel_height}m / {turn.vehicle.antenna_height}m / {turn.vehicle.center_of_gravity_tolerance}°</small>}
                </div>
              </div>
            ):(
              <div key={turn.id} className="gemini-msg assistant">
                <div className="gemini-msg-head"><Bot size={15}/><span>Gemini</span><small>{turn.timestamp}</small></div>
                <div className="gemini-msg-content"><p>{turn.text}</p></div>
              </div>
            )
          ))}

          {busy&&<div className="gemini-msg assistant">
            <div className="gemini-msg-head"><LoaderCircle size={15} className="spin"/><span>Gemini</span></div>
            <div className="gemini-msg-content">
              <div className="planning-progress" role="status">
                <span>{busy==='intent'?'Interpretando tu viaje…':'Calculando horizontes NASA LOLA y efemérides JPL…'}</span>
                <div><Check size={13}/> Relieve polar · {vehicle.lander_name} ({vehicle.solar_panel_height}m / {vehicle.antenna_height}m)</div>
                <small>{elapsed} s · <button type="button" className="inline-cancel" onClick={()=>{request.current?.abort();setBusy(null)}}>Cancelar</button></small>
              </div>
            </div>
          </div>}

          {plan&&(landerReview||reviewBusy)&&<div className="gemini-msg assistant" data-testid="gemini-engineer-card">
            <div className="gemini-msg-head">
              <Bot size={15}/>
              <span>Gemini · Ingeniero de Misión</span>
              <small>{reviewBusy?'Analizando…':landerReview?.mode==='ai'?landerReview.model:'NASA LOLA'}</small>
            </div>
            <div className="gemini-msg-content">
              {landerReview?<>
                <p>{landerReview.summary}</p>
                <p className="gemini-paragraph-muted"><strong>Diagnóstico:</strong> {landerReview.risk_alert}</p>
                <div className="gemini-recommendations-list">
                  <p><strong>1. Sitio alternativo:</strong> {landerReview.site_recommendation}</p>
                  <p><strong>2. Hardware:</strong> {landerReview.hardware_recommendation}</p>
                </div>
                <div className="gemini-action-chips">
                  {recommendedAlt&&recommendedAlt.id!==selected?.id&&<button type="button" onClick={()=>{choose(recommendedAlt.id);setFocus(true);appendChatTurn('user',`Cambiar al sector alternativo (${num(Math.abs(recommendedAlt.latitude_deg),2)}°S, ${longitude(recommendedAlt.longitude_deg,2)})`,vehicle)}}>Ir a {num(Math.abs(recommendedAlt.latitude_deg),2)}°S <ArrowRight size={11}/></button>}
                  {vehicle.solar_panel_height<45&&<button type="button" onClick={()=>{setFocus(true);applyVehicleProfile(LUNAR_OBJECTS.starship,'Recalculando con Starship HLS (50 m)…')}}>Probar Starship HLS (50m) <ArrowRight size={11}/></button>}
                </div>
              </>:<p className="loading-note">Evaluando geometría del vehículo sobre el terreno…</p>}
            </div>
          </div>}
          <div ref={chatEndRef}/>
        </div>

        {(error||loadError)&&<div className="trip-error" role="alert">{error||loadError}{loadError&&<button onClick={()=>setRetry(r=>r+1)}>Reintentar datos</button>}</div>}
        {!atlas&&!loadError&&<p className="loading-note">Cargando el relieve lunar…</p>}

        {/* ChatGPT / Gemini style unified composer with inline + (.json/.gltf) and Lunar Object Selector */}
        <form
          className={'chat-composer-box'+(composerDrag?' dragging':'')}
          onSubmit={e=>{e.preventDefault();void calculate()}}
          onDragOver={e=>{e.preventDefault();setComposerDrag(true)}}
          onDragLeave={()=>setComposerDrag(false)}
          onDrop={e=>{e.preventDefault();setComposerDrag(false);const f=e.dataTransfer.files?.[0];if(f)void handleProfileFile(f)}}
        >
          <input ref={fileInputRef} type="file" accept=".json,.gltf,.glb" hidden onChange={e=>{const f=e.target.files?.[0];if(f)void handleProfileFile(f);e.target.value=''}}/>

          {/* Active Vehicle / Object Attachment Chip inside the composer box */}
          <div className="composer-attachment-bar">
            <div className="composer-active-chip" title={vehicle.description??vehicle.lander_name}>
              <Rocket size={12}/>
              <strong>{vehicle.lander_name}</strong>
              <span>Paneles {vehicle.solar_panel_height}m · Antena {vehicle.antenna_height}m · CG {vehicle.center_of_gravity_tolerance}°</span>
            </div>
            <button type="button" className="composer-json-btn" onClick={downloadSampleProfile} title="Descargar este perfil en formato .json">
              <Download size={11}/> .json
            </button>
          </div>

          <label htmlFor="mission-request" className="sr-only-label">¿Qué misión quieres hacer?</label>
          <textarea
            id="mission-request"
            aria-label="Describe tu misión"
            value={message}
            onChange={e=>{invalidate();setMessage(e.target.value)}}
            onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();if(!busy&&atlas&&polar)void calculate()}}}
            rows={3}
            maxLength={1600}
            placeholder="Escribe la fecha de tu viaje o pregunta a Gemini (ej. 25 de diciembre 2026 a las 8 am)…"
          />

          {/* Popover menu for all Lunar South Pole vehicles, rovers & habitats */}
          {catalogOpen&&<div className="lunar-catalog-popover" role="listbox" aria-label="Objetos y vehículos para el Polo Sur Lunar">
            <div className="catalog-popover-head">
              <span><Compass size={12}/> OBJETOS Y ELEMENTOS · POLO SUR LUNAR</span>
              <button type="button" onClick={()=>setCatalogOpen(false)} aria-label="Cerrar selector"><X size={13}/></button>
            </div>
            <div className="catalog-popover-list">
              {groupedCatalog.map(([category,items])=>(
                <div key={category} className="catalog-group">
                  <small className="catalog-group-title">{category}</small>
                  {items.map(([key,item])=>{
                    const active=vehicle.lander_name===item.lander_name
                    return (
                      <button
                        key={key}
                        type="button"
                        className={'catalog-item-btn'+(active?' active':'')}
                        onClick={()=>applyVehicleProfile(item)}
                      >
                        <div className="catalog-item-main">
                          <strong>{item.lander_name}</strong>
                          <span>Paneles {item.solar_panel_height}m · Antena {item.antenna_height}m · CG {item.center_of_gravity_tolerance}°</span>
                        </div>
                        <small>{item.description}</small>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
            <div className="catalog-popover-foot">
              <button type="button" onClick={()=>{setCatalogOpen(false);fileInputRef.current?.click()}}>
                <FileUp size={13}/> Subir archivo personalizado (.json / .gltf / .glb)
              </button>
            </div>
          </div>}

          {/* Bottom Toolbar inside the Chat Input Box (like ChatGPT / Gemini) */}
          <div className="composer-toolbar">
            <div className="composer-tools-left">
              <button
                type="button"
                className="composer-icon-btn"
                onClick={()=>fileInputRef.current?.click()}
                title="Añadir perfil de vehículo (.json o .gltf)"
                aria-label="Añadir archivo JSON o GLTF"
              >
                <Plus size={15}/>
                <span>.json / .gltf</span>
              </button>
              <button
                type="button"
                className={'composer-catalog-btn'+(catalogOpen?' open':'')}
                onClick={()=>setCatalogOpen(v=>!v)}
                aria-expanded={catalogOpen}
                title="Elegir entre todos los objetos y vehículos que viajan al Polo Sur Lunar"
              >
                <Cpu size={13}/>
                <span>Objetos Lunares</span>
                <ChevronDown size={13}/>
              </button>
            </div>

            <button className="primary-plan composer-send-btn" type="submit" disabled={Boolean(busy)||!atlas||!polar}>
              {busy?<LoaderCircle className="spin" size={15}/>:<Send size={14}/>}
              <span>{busy?'Calculando…':'Planificar mi misión'}</span>
            </button>
          </div>
          {uploadNotice&&<small className="upload-notice">{uploadNotice}</small>}
        </form>

        <div className="trip-assumption"><Clock3 size={13}/><span>Hora de Bolivia · UTC−04:00 · Estancia: {num(Number(stay),0)} h</span></div>
        <button className="preferences-toggle" onClick={()=>setPreferences(v=>!v)} aria-expanded={preferences}><Settings2 size={13}/> {plan?'Cambiar fecha o requisitos':'Preferencias del viaje'}</button>
        {preferences&&<div className="trip-preferences">
          {intent&&<label>{intent.date_kind==='landing'?'Fecha de alunizaje':'Fecha de salida'} · hora Bolivia<input aria-label="Fecha de viaje" type="datetime-local" value={departureInput} onChange={e=>{clearResult();setDepartureInput(e.target.value)}}/></label>}
          <label>Tiempo en la Luna<select aria-label="Estancia en la Luna" value={stay} onChange={e=>{clearResult();setStay(e.target.value)}}><option value="24">1 día · 24 h</option><option value="48">2 días · 48 h</option><option value="72">3 días · 72 h</option><option value="168">7 días · 168 h</option>{!['24','48','72','168'].includes(stay)&&<option value={stay}>{stay} horas</option>}</select></label>
          <label>Pendiente regional máxima · grados<input aria-label="Pendiente máxima" type="number" min={0} max={45} value={slope} onChange={e=>{clearResult();setSlope(Number(e.target.value))}}/></label><label>Horas mínimas de Sol<input aria-label="Horas mínimas de Sol" type="number" min={0} max={Number(stay)} value={sunHours} onChange={e=>{clearResult();setSunHours(Number(e.target.value))}}/></label><label>Horas mínimas de Tierra visible<input aria-label="Horas mínimas de Tierra" type="number" min={0} max={Number(stay)} value={earthHours} onChange={e=>{clearResult();setEarthHours(Number(e.target.value))}}/></label><p>El viaje de ida y vuelta se estima por separado. La estancia no es la duración total.</p>
          {intent&&<button onClick={recalculate} disabled={Boolean(busy)}>Recalcular con estos cambios</button>}
        </div>}

        {plan&&<div className="trip-overview"><span className="micro-title">TU ITINERARIO ESTIMADO</span>
          <div className="itinerary-item"><span className="itinerary-dot"/><div><small>Salida de la Tierra</small><strong>{localDate(plan.mission.departure_utc)}</strong></div></div>
          <div className="itinerary-duration">↓ Ida estimada: {duration(plan.mission.outbound_hours)}</div>
          <div className="itinerary-item"><span className="itinerary-dot moon"/><div><small>Alunizaje analizado</small><strong>{localDate(plan.mission.arrival_utc)}</strong></div></div>
          <div className="itinerary-duration">Estancia: {duration(plan.mission.surface_hours)}</div>
          <div className="itinerary-item"><span className="itinerary-dot"/><div><small>Regreso estimado</small><strong>{localDate(plan.mission.return_utc)}</strong></div></div>
          <div className="total-trip"><span>Duración total estimada</span><strong>{duration(plan.mission.total_hours)}</strong></div>
          <p className="estimate-note">Estimación orbital simplificada desde una órbita terrestre de 200 km.</p>
        </div>}
        <button className="evidence-link" onClick={()=>setEvidence(true)}><Layers size={13}/> Ver datos y supuestos</button>
      </aside>

      <main className="one-moon-panel">
        <div className="one-map-heading">
          <div><span className="micro-title">POLO SUR LUNAR · 80°S — 90°S</span><h2>{plan?'Toda la superficie. Una decisión informada.':'Una Luna. Todos los destinos.'}</h2></div>
          <div className="one-map-actions">
            <button onClick={()=>{setFocus(false);setFlight(null);setFlying(false);setCameraRevision(r=>r+1)}} aria-pressed={!focus}>Todo el polo</button>
            <button disabled={!selected||selected.latitude_deg> -80||selected.elevation_m==null} onClick={()=>{setFocus(true);setCameraRevision(r=>r+1)}} aria-pressed={focus}>Acercar destino</button>
            <button onClick={()=>{setMapFullscreen(v=>!v);setTimeout(()=>setCameraRevision(r=>r+1),60)}} aria-pressed={mapFullscreen} title={mapFullscreen?'Salir de pantalla grande (Esc)':'Ver vistazo de la Luna en pantalla grande'}>
              {mapFullscreen?<Minimize2 size={13}/>:<Maximize2 size={13}/>}
              {mapFullscreen?'Salir de pantalla grande':'Pantalla grande'}
            </button>
          </div>
        </div>
        <div className="one-moon-map" data-testid="mission-map">
          <Tactical3DScene latDeg={selected?.latitude_deg??-90} lonDeg={selected?.longitude_deg??0} observerHeightM={2} sunAzimuthDeg={current?.sun_azimuth_deg??0} sunElevationDeg={current?.sun_elevation_deg??0} earthAzimuthDeg={current?.earth_azimuth_deg??0} earthElevationDeg={current?.earth_elevation_deg??0} minSolarElevation={0} maxSlopeDeg={vehicle.center_of_gravity_tolerance} currentSlopeDeg={selected?.regional_slope_deg??NaN}
            atlasData={atlas} focusTerrainData={detail} sunRaycast={ray(current?.sun_elevation_deg,current?.sun_horizon_deg)} earthRaycast={ray(current?.earth_elevation_deg,current?.earth_horizon_deg)} cameraView="polar" siteName={selected?`${vehicle.lander_name} · Destino`:'Polo sur'}
            overview focusZone={focus} onShadingStatus={setShadingStatus} cameraResetKey={cameraRevision+(focus?1:0)} missionMarkers={flight?[]:markers} onMarkerSelect={choose} polarSurface={polar} missionCoverage={coverageLayer} onCoverageSelect={choose} onCoverageHover={setHoveredId}
            onSurfacePlace={sampleMap} placementMode scienceReady={Boolean(current)} assessmentRisk={selected?.risk??'unknown'} showSurfaceVehicle={Boolean(flight)} altitudeM={telemetry?.altitudeM??0} landed={landed}
            solarPanelHeightM={vehicle.solar_panel_height} antennaHeightM={vehicle.antenna_height} landerName={vehicle.lander_name} vehiclePulseKey={vehiclePulseKey}/>
          <div className="one-map-source"><span>{plan&&coverageVisible&&!flight?'Evaluación de toda la superficie':'NASA LOLA · relieve continuo'}</span><small>{focus&&detail?'Detalle visual ~396 m · fuente 80 m':shadingStatus.includes('no disponible')?'Sombreado no disponible; relieve conservado':'Vista regional · fuente de 80 m'}{visualStatus.includes('no disponible')?' · '+visualStatus:''}</small></div>
          {!plan&&<div className="one-map-empty"><Orbit size={20}/><strong>{busy?'Estamos calculando tus destinos.':'Escribe tu viaje para ver dónde alunizar.'}</strong><span>{busy?'La recomendación aparecerá aquí con sus alternativas.':'Sin cambiar de pantalla ni elegir capas técnicas.'}</span></div>}
          {plan&&!flight&&<div className="surface-inspection-hint"><MapPin size={12}/>{hovered?<><b className={'risk-text '+hovered.risk}>{SURFACE_CLASS_LABELS[hovered.risk]}</b><span>{num(Math.abs(hovered.latitude_deg),2)}°S · {longitude(hovered.longitude_deg)} · pendiente P95 {num(hovered.regional_slope_deg)}°</span></>:<span>Haz clic en cualquier área para ver sus mediciones y motivos.</span>}</div>}
        </div>
        {plan&&<SurfaceCoverageSummary plan={plan} active={coverageVisible} onToggle={()=>setCoverageVisible(v=>!v)} onEvidence={()=>setEvidence(true)}/>}
        {plan&&<div className="mission-conditions">
          <div className="conditions-heading">
            <strong><Globe2 size={14}/> Línea de tiempo de estancia · {vehicle.lander_name}</strong>
            <time>{current?localDate(current.t_utc):localDate(plan.mission.arrival_utc)} · Bolivia ({currentBothOk?'Sol y Tierra visibles':!currentSunOk&&!currentEarthOk?'Sin Sol ni Tierra':!currentSunOk?'Sombra solar':'Sin enlace Tierra'})</time>
          </div>

          <div className="conditions-slider">
            <button aria-label={playing?'Pausar condiciones':'Reproducir condiciones'} disabled={!series.length||flying} onClick={()=>{if(timeline===series.length-1)setTimeline(0);setPlaying(v=>!v)}}>{playing?<Pause size={14}/>:<Play size={14}/>}</button>
            <div className="timeline-track-stack">
              {/* Minimal flat delimiter pins along the timeline axis */}
              {series.length>1&&<div className="timeline-axis-pins">
                {timelinePins.map((pin,idx)=>{
                  const pct=(pin.hour/Math.max(1,series.length-1))*100
                  return (
                    <button
                      key={`axis-${pin.hour}-${idx}`}
                      type="button"
                      className={'axis-pin'+(timeline===pin.hour?' current':'')}
                      style={{left:`${pct}%`}}
                      onClick={()=>{setPlaying(false);setTimeline(pin.hour)}}
                      title={pin.detail}
                    >
                      <small>{pin.label}</small>
                      <i/>
                    </button>
                  )
                })}
              </div>}
              <input
                aria-label="Hora de la estancia"
                type="range"
                min={0}
                max={Math.max(0,series.length-1)}
                value={timeline}
                disabled={!series.length||flying}
                onChange={e=>{setPlaying(false);setTimeline(Number(e.target.value))}}
              />
              {/* Yellow Sun bar (#f5cb67) & Sky-Blue Earth bar (#8ddfe9) matching 3D vectors */}
              {series.length>0&&<div className="timeline-status-bars">
                <div className="status-bar-row">
                  <span className="bar-label sun-label"><Sun size={11}/> Sol ({vehicle.solar_panel_height}m)</span>
                  <div className="bar-segments">
                    {series.map((s,idx)=>{
                      const ok=s.sun_elevation_deg-s.sun_horizon_deg>0.3
                      return <span
                        key={idx}
                        className={'seg '+(ok?'sun-ok':'off')+(idx===timeline?' active':'')}
                        onClick={()=>{setPlaying(false);setTimeline(idx)}}
                        title={`+${idx}h · Sol: ${ok?'Iluminado':'Sombra'} (${num(s.sun_elevation_deg-s.sun_horizon_deg,2)}°)`}
                      />
                    })}
                  </div>
                  <small className="bar-summary"><b>{num(selected?.sun_hours,0)}h</b>/{plan.mission.surface_hours}h</small>
                </div>
                <div className="status-bar-row">
                  <span className="bar-label earth-label"><Radio size={11}/> Tierra ({vehicle.antenna_height}m)</span>
                  <div className="bar-segments">
                    {series.map((s,idx)=>{
                      const ok=s.earth_elevation_deg-s.earth_horizon_deg>0.3
                      return <span
                        key={idx}
                        className={'seg '+(ok?'earth-ok':'off')+(idx===timeline?' active':'')}
                        onClick={()=>{setPlaying(false);setTimeline(idx)}}
                        title={`+${idx}h · Tierra: ${ok?'Enlace directo':'Bloqueado'} (${num(s.earth_elevation_deg-s.earth_horizon_deg,2)}°)`}
                      />
                    })}
                  </div>
                  <small className="bar-summary"><b>{num(selected?.earth_hours,0)}h</b>/{plan.mission.surface_hours}h</small>
                </div>
              </div>}
            </div>
            <span className="timeline-hour-plain">+{timeline} h</span>
          </div>

          <div className="conditions-readouts">
            <span>Paneles ({vehicle.solar_panel_height}m): <b className={currentSunOk?'readout-sun':'readout-off'}>{current?(currentSunOk?`Iluminado (+${num(current.sun_elevation_deg-current.sun_horizon_deg,2)}°)`:`Sombra (${num(current.sun_elevation_deg-current.sun_horizon_deg,2)}°)`):'—'}</b></span>
            <span>Antena DTE ({vehicle.antenna_height}m): <b className={currentEarthOk?'readout-earth':'readout-off'}>{current?(currentEarthOk?`Enlace directo (+${num(current.earth_elevation_deg-current.earth_horizon_deg,2)}°)`:`Bloqueado (${num(current.earth_elevation_deg-current.earth_horizon_deg,2)}°)`):'—'}</b></span>
            <span>Pendiente vs CG ({vehicle.center_of_gravity_tolerance}°): <b>{num(selected?.regional_slope_deg,1)}°</b></span>
          </div>
        </div>}
      </main>

      <aside className="mission-decisions">
        {!plan?<div className="decision-welcome"><MapPin size={28}/><h2>Aquí encontrarás tu mejor opción.</h2><p>El sistema relacionará la fecha de tu viaje y el objeto lunar elegido con el terreno, la luz y la visibilidad de la Tierra.</p><ul><li><Check size={13}/> Un destino recomendado y sus razones</li><li><Check size={13}/> Clasificación de toda la superficie</li><li><Check size={13}/> Diagnóstico conversacional en el chat izquierdo</li></ul><small>Los resultados corresponden a un modelo regional de planificación, no a una autorización de vuelo.</small></div>:<>
          {/* 1. First on top: Selected Sector Details + Simulate Arrival */}
          {selected&&<section className="selected-destination top-selected-destination"><div className="selected-destination-title"><span className={'selected-color '+selected.risk}/><h3>{selectedLabel}</h3></div><span className="selected-sector-id">Sector {selected.id.replace('polar:','')} · {num(selected.area_km2,2)} km² regionales</span><p>{reasonPoint(selected)}</p><dl><div><dt>Vehículo / Elemento</dt><dd>{vehicle.lander_name}</dd></div><div><dt>Centro del sector</dt><dd>{num(selected.latitude_deg,5)}°, {num(selected.longitude_deg,5)}°</dd></div><div><dt>Elevación</dt><dd>{num(selected.elevation_m??selectedCell?.elevation_m,0)} m</dd></div><div><dt>Pendiente P95 · fuente de 80 m</dt><dd>{num(selected.regional_slope_deg)}°</dd></div><div><dt>Máxima pendiente nativa</dt><dd>{num(selected.max_slope_deg??selectedCell?.max_slope_deg)}°</dd></div><div><dt>Sol visible ({vehicle.solar_panel_height}m)</dt><dd>{num(selected.sun_hours,0)} h</dd></div><div><dt>Tierra visible ({vehicle.antenna_height}m)</dt><dd>{num(selected.earth_hours,0)} h</dd></div></dl>
            {selected.sun_hours_sensitivity&&selected.earth_hours_sensitivity&&<div className="sampling-sensitivity"><strong>Variación por muestreo angular</strong><span>Sol: {num(selected.sun_hours_sensitivity.lower,0)}–{num(selected.sun_hours_sensitivity.upper,0)} h · Tierra: {num(selected.earth_hours_sensitivity.lower,0)}–{num(selected.earth_hours_sensitivity.upper,0)} h</span><small>Compara direcciones vecinas del horizonte. No es una probabilidad de éxito.</small></div>}
            {cellLoading&&<p className="cell-detail-status" role="status"><LoaderCircle className="spin" size={13}/> Cargando condiciones de esta área…</p>}
            {cellError&&<p className="trip-error" role="alert">{cellError}</p>}
            <button className="simulate-arrival" disabled={isRejected||!plan.best||cellLoading||Boolean(cellError)} onClick={runDescent}><Rocket size={14}/> Simular llegada a este destino</button>
            {flight&&<div className="arrival-telemetry"><strong>{landed?(flight.outcome==='soft-touchdown'?'Contacto suave en el modelo':'Impacto en el modelo'):'Descenso físico · 30×'}</strong><span>Altura: {num(telemetry?.altitudeM,0)} m</span><span>Velocidad: {num(telemetry?.velocityMps,1)} m/s</span><span>Combustible: {num(telemetry?.fuelKg,0)} kg</span><button onClick={()=>setFlying(v=>!v)} disabled={landed}>{flying?'Pausar':'Continuar'}</button><small>Nave hipotética y descenso vertical. Su resultado no certifica el destino.</small></div>}
          </section>}

          {/* 2. Below Selected Sector: Uniform Candidate List where #1 shares the exact compact row design of #2, #3, #4 */}
          <div className="decision-title candidates-below-title"><span className="micro-title">{plan.best?'RECOMENDACIÓN CALCULADA':'NINGUNA ZONA CUMPLE TODOS LOS CRITERIOS'}</span>{aiMode&&<small>{aiMode}</small>}</div>
          {plan.best?(
            <section className="other-destinations unified-candidates-list">
              <button className={'best-destination '+(selected?.id===plan.best.id?'selected':'')} onClick={()=>choose(plan.best!.id)}>
                <span className="destination-number">1</span>
                <div>
                  <strong>{num(Math.abs(plan.best.latitude_deg),2)}°S · {longitude(plan.best.longitude_deg,2)}</strong>
                  <small>{num(plan.best.sun_hours,0)} h de Sol · {num(plan.best.earth_hours,0)} h de Tierra · P95 {num(plan.best.regional_slope_deg)}°</small>
                </div>
                <ArrowRight size={13}/>
              </button>
              {plan.alternatives.filter(p=>p.id!==plan.best?.id).map((p,i)=>(
                <button key={p.id} className={selected?.id===p.id?'selected':''} onClick={()=>choose(p.id)}>
                  <span className="destination-number">{i+2}</span>
                  <div>
                    <strong>{num(Math.abs(p.latitude_deg),2)}°S · {longitude(p.longitude_deg,2)}</strong>
                    <small>{num(p.sun_hours,0)} h de Sol · {num(p.earth_hours,0)} h de Tierra</small>
                  </div>
                  <ArrowRight size={13}/>
                </button>
              ))}
            </section>
          ):(
            <div className="no-fit-plan"><h2>Revisa las condiciones antes de elegir.</h2><p>No se ha forzado un lugar verde. Revisa las recomendaciones de Gemini en el chat izquierdo o cambia el vehículo/fecha.</p></div>
          )}
          <details className="coordinate-inspector"><summary>Consultar cualquier coordenada del polo sur</summary><form onSubmit={e=>{e.preventDefault();inspectCoordinates()}}><label>Latitud<input aria-label="Latitud a consultar" type="number" step="any" min={-90} max={-80} value={inspectLat} onChange={e=>setInspectLat(e.target.value)}/></label><label>Longitud<input aria-label="Longitud a consultar" type="number" step="any" min={-180} max={180} value={inspectLon} onChange={e=>setInspectLon(e.target.value)}/></label><button type="submit">Examinar área</button>{coordinateError&&<p role="alert">{coordinateError}</p>}</form></details>
          <details className="rejected-destinations"><summary>{num(rejectedTotal,0)} zonas descartadas · ver ejemplos</summary>{plan.rejected.map(p=><button key={p.id} onClick={()=>choose(p.id)}><span className="reject-dot"/><div><strong>{num(Math.abs(p.latitude_deg),2)}°S · {longitude(p.longitude_deg,2)}</strong><small>{p.reasons?.[0]??'No cumple los criterios'}</small></div></button>)}</details>
          <button className="download-plan" onClick={exportPlan}><Download size={14}/> Descargar plan y evidencia</button>
          <p className="decision-scope">Los colores describen sectores regionales, con condiciones calculadas en sus centros. Una zona verde puede contener pendientes locales mayores. Falta evaluar rocas pequeñas, huella de la nave, energía, temperatura y enlace de radio.</p>
        </>}
      </aside>
    </div>
    {(help||evidence)&&<div className="mission-modal-backdrop" onClick={()=>{setHelp(false);setEvidence(false)}}><section className="mission-modal" role="dialog" aria-modal="true" aria-label={help?'Cómo se planifica tu misión':'Datos del plan de misión'} onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Escape'){setHelp(false);setEvidence(false)}}}><div className="modal-top"><h2>{help?'Escribe tu viaje. Nosotros calculamos.':'Los datos detrás de tu recomendación.'}</h2><button autoFocus aria-label="Cerrar información" onClick={()=>{setHelp(false);setEvidence(false)}}><X size={17}/></button></div>
      {help?<><p>Escribe la fecha y hora de salida y pulsa <strong>Planificar mi misión</strong>. Gemini interpreta tu petición; el motor científico consulta NASA y compara el polo sur automáticamente.</p><p>Desde la misma casilla de chat puedes adjuntar un archivo <code>.json</code> o <code>.gltf</code> con el botón <strong>+</strong> o desplegar <strong>Objetos Lunares</strong> para elegir entre naves tripuladas (Starship HLS, Blue Moon MK2, ALPACA), landers robóticos CLPS, rovers (LTV, VIPER, Lunar Cruiser) o infraestructura de superficie.</p><p>La respuesta de Gemini como Ingeniero Jefe aparece integrada directamente en la conversación de la izquierda, recomendándote cambios tácticos de sitio o de hardware.</p></>:<><p>{plan?'Datos del cálculo actual:':'Escribe y calcula una misión para obtener las consultas y mediciones de tu caso.'}</p><ul>{assumptions.map(a=><li key={a}>{a}</li>)}{plan?.mission.assumptions?.map(a=><li key={a}>{a}</li>)}</ul><p>Terreno: NASA LOLA de 80 m. Comparación regional por sectores de 4,75 km y perfiles de horizonte propios por centro. Los intervalos amarillo/verde comparan los azimuts vecinos del horizonte; no representan toda la incertidumbre del terreno. Los sectores del borde sin mediciones se conservan en gris. Las superficies se calculan sobre la esfera lunar y se recortan al casquete 80–90°S.</p><ul>{plan?.meta.limitations.map(note=><li key={note}>{note}</li>)}</ul><details><summary>Consultas y procedencia completas</summary><pre>{JSON.stringify(plan?.meta.sources??[],null,2)}</pre></details>{plan&&<button className="download-plan" onClick={exportPlan}><Download size={14}/> Descargar evidencia completa</button>}</>}
    </section></div>}
  </div>
}
