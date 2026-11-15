import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Bot, Check, ChevronDown, CircleHelp, Compass, Cpu, Download, Globe2, Layers, LoaderCircle, MapPin, Maximize2, Minimize2, Orbit, PanelBottom, PanelLeft, PanelRight, Pause, Play, Plus, Rocket, Send, Settings2, Sun, X } from 'lucide-react'

import { Tactical3DScene,type PlanMapMarker } from '../tactical/Tactical3DScene'
import { loadAtlas,type AtlasData } from '../sites/atlasGeometry'
import { loadDetailTile } from '../sites/lunarDetail'
import { validatePolarSurface,type PolarSurface } from '../tactical/polarScience'
import { DEFAULT_DESCENT,descentAt,simulateDescent,type DescentRun } from './descentPhysics'
import type { RaycastHit } from '../tactical/tacticalMath'
import type { AutomaticPlan,LanderReview,MissionIntent,MissionPoint,VehicleProfile } from './automaticTypes'
import SurfaceCoverageSummary,{SURFACE_CLASS_LABELS} from './SurfaceCoverageSummary'
import MissionRescuePanel from './MissionRescuePanel'
import OperationalWindowsPanel from './OperationalWindowsPanel'
import type {AdoptedAlternative,RescueReport,RescueProposal} from './rescueTypes'
import './unified-mission.css'

const EXAMPLE='Quiero hacer un viaje el 25 de diciembre de 2026 a las 8 am. ¿Dónde sería mejor alunizar y cuánto tardaría la misión?'
const TIMEZONE='America/La_Paz'

const CATALOG_EXAMPLES:Record<string,VehicleProfile>={
  blue_moon:{
    lander_name:'Blue Moon MK2',
    solar_panel_height:15,
    antenna_height:12,
    center_of_gravity_tolerance:10,
    category:'Lander Tripulado HLS',
    description:'Ejemplo hipotético editable; parámetros sin ficha de fabricante verificada.'
  },
  starship:{
    lander_name:'Starship HLS',
    solar_panel_height:50,
    antenna_height:38,
    center_of_gravity_tolerance:10,
    category:'Lander Tripulado HLS',
    description:'Ejemplo hipotético editable; parámetros sin ficha de fabricante verificada.'
  },
  alpaca:{
    lander_name:'Dynetics ALPACA',
    solar_panel_height:6,
    antenna_height:8,
    center_of_gravity_tolerance:12,
    category:'Lander Tripulado HLS',
    description:'Ejemplo hipotético editable; parámetros sin ficha de fabricante verificada.'
  },
  griffin:{
    lander_name:'Griffin Lander (Astrobotic)',
    solar_panel_height:4.5,
    antenna_height:4,
    center_of_gravity_tolerance:10,
    category:'Lander de Carga CLPS',
    description:'Ejemplo hipotético editable; parámetros sin ficha de fabricante verificada.'
  },
  nova_c:{
    lander_name:'Nova-C IM-2 (Intuitive Machines)',
    solar_panel_height:4,
    antenna_height:3.5,
    center_of_gravity_tolerance:9,
    category:'Lander Comercial CLPS',
    description:'Ejemplo hipotético editable; parámetros sin ficha de fabricante verificada.'
  },
  blue_ghost:{
    lander_name:'Blue Ghost (Firefly)',
    solar_panel_height:3.2,
    antenna_height:3.5,
    center_of_gravity_tolerance:11,
    category:'Lander Comercial CLPS',
    description:'Ejemplo hipotético editable; parámetros sin ficha de fabricante verificada.'
  },
  ltv_rover:{
    lander_name:'Lunar Terrain Vehicle (LTV)',
    solar_panel_height:2.5,
    antenna_height:3,
    center_of_gravity_tolerance:15,
    category:'Rover y Movilidad',
    description:'Ejemplo hipotético editable; parámetros sin ficha de fabricante verificada.'
  },
  lunar_cruiser:{
    lander_name:'Rover Presurizado (JAXA/Toyota)',
    solar_panel_height:5,
    antenna_height:5.5,
    center_of_gravity_tolerance:12,
    category:'Rover y Movilidad',
    description:'Ejemplo hipotético editable; parámetros sin ficha de fabricante verificada.'
  },
  viper:{
    lander_name:'Rover VIPER (NASA)',
    solar_panel_height:2.5,
    antenna_height:2.8,
    center_of_gravity_tolerance:14,
    category:'Rover y Movilidad',
    description:'Ejemplo hipotético editable; parámetros sin ficha de fabricante verificada.'
  },
  artemis_habitat:{
    lander_name:'Hábitat Base Artemis (SHH)',
    solar_panel_height:18,
    antenna_height:16,
    center_of_gravity_tolerance:8,
    category:'Infraestructura Polar',
    description:'Ejemplo hipotético editable; parámetros sin ficha de fabricante verificada.'
  },
  vsat_tower:{
    lander_name:'Torre Solar Vertical (NASA VSAT)',
    solar_panel_height:32,
    antenna_height:24,
    center_of_gravity_tolerance:9,
    category:'Infraestructura Polar',
    description:'Ejemplo hipotético editable; parámetros sin ficha de fabricante verificada.'
  }
}


export const LUNAR_OBJECTS:Record<string,VehicleProfile>={
  reference:{lander_name:'Referencia regional · 2 m',solar_panel_height:2,antenna_height:2,center_of_gravity_tolerance:10,category:'Referencia del modelo',description:'Observador de 2 m con perfiles de horizonte preparados. No representa una nave real.'},
  ...Object.fromEntries(Object.entries(CATALOG_EXAMPLES).map(([key,value])=>[key,{...value,category:'Ejemplo hipotético · '+value.category,description:'Parámetros de demostración editables. No son especificaciones verificadas del fabricante.'}]))
}

// Language detection from cookie or navigator
function getInitialLanguage():'es'|'en'{
  try{
    const match=document.cookie.match(/(?:^|;\s*)app_lang=(es|en)(?:;|$)/)
    if(match&&match[1])return match[1] as 'es'|'en'
    const nav=navigator.language?.toLowerCase()||''
    if(nav.startsWith('en'))return 'en'
  }catch{}
  return 'es'
}

const STRINGS={
  es:{
    chatGreeting:'Dime las características de tu viaje (fecha, tiempo o vehículo) y calculamos tu mejor lugar de alunizaje en el Polo Sur Lunar.',
    exampleBtn:'Probar el viaje del 25 dic · 08:00',
    manualSettings:'Configurar fecha y requisitos manualmente (sin IA)',
    manualTitle:'Configuración manual de la misión',
    placeholder:'Escribe la fecha de tu viaje o pregunta al copiloto…',
    planBtn:'Planificar mi misión',
    calculating:'Calculando…',
    howItWorks:'Cómo funciona',
    allPole:'Todo el polo',
    zoomSite:'Acercar destino',
    fullscreen:'Pantalla grande',
    exitFullscreen:'Salir de pantalla grande',
    timelineTitle:'Línea de tiempo unificada',
    sunLabel:'Sol',
    earthLabel:'Tierra',
    slopeP95:'Pendiente P95',
    landingDay:'Fecha de alunizaje',
    departureDay:'Fecha de salida',
    stayDuration:'Tiempo en la Luna',
    maxSlope:'Pendiente regional máxima · grados',
    minSun:'Horas mínimas de Sol',
    minEarth:'Horas mínimas de Tierra visible',
    recalcBtn:'Recalcular con estos cambios'
  },
  en:{
    chatGreeting:'Tell me the details of your trip (date, stay, or vehicle) and we will calculate your best lunar landing site at the South Pole.',
    exampleBtn:'Try the Dec 25 · 08:00 trip',
    manualSettings:'Configure date and criteria manually (without AI)',
    manualTitle:'Manual Mission Configuration',
    placeholder:'Enter departure date or ask the mission copilot…',
    planBtn:'Plan my mission',
    calculating:'Calculating…',
    howItWorks:'How it works',
    allPole:'Whole pole',
    zoomSite:'Zoom target',
    fullscreen:'Fullscreen',
    exitFullscreen:'Exit fullscreen',
    timelineTitle:'Unified Timeline',
    sunLabel:'Sun',
    earthLabel:'Earth',
    slopeP95:'Slope P95',
    landingDay:'Landing date',
    departureDay:'Departure date',
    stayDuration:'Stay duration on the Moon',
    maxSlope:'Maximum regional slope · degrees',
    minSun:'Minimum Sun hours',
    minEarth:'Minimum Earth visible hours',
    recalcBtn:'Recalculate with these changes'
  }
}

const USER_TIMEZONE=(()=>{
  try{return Intl.DateTimeFormat().resolvedOptions().timeZone||TIMEZONE}catch{return TIMEZONE}
})()

function localTimeZoneLabel(){
  const short=USER_TIMEZONE.split('/').pop()?.replace(/_/g,' ')||USER_TIMEZONE
  return `Tu hora local (${short})`
}

function toUserDatetimeInputValue(utc:string):string{
  const d=new Date(utc)
  if(!Number.isFinite(d.getTime()))return ''
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:USER_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(d)
  const get=(type:string)=>parts.find(p=>p.type===type)?.value??'00'
  const hour=get('hour')==='24'?'00':get('hour')
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`
}

type ChatTurn={
  id:string
  role:'user'|'assistant'
  text:string
  vehicle?:VehicleProfile
  review?:LanderReview
  reviewKey?:string
  altTarget?:{id:string;latitude_deg:number;longitude_deg:number}|null
  timestamp:string
}

const unknownRay:RaycastHit={hit:true,hitDistanceM:NaN,hitPositionWorld:null,obstacleElevationDeg:NaN,marginDeg:NaN}
const num=(value:number|null|undefined,digits=1)=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('es',{maximumFractionDigits:digits}):'—'
const duration=(hours:number)=>{if(!Number.isFinite(hours))return '—';const rounded=Math.round(hours),d=Math.floor(rounded/24),h=rounded%24;return d?d+' d'+(h?' '+h+' h':''):h+' h'}
const longitude=(value:number,digits=2)=>num(Math.abs(value),digits)+'°'+(value<0?'O':'E')
const localDate=(utc:string)=>{const d=new Date(utc);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('es',{timeZone:USER_TIMEZONE,day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(d):'—'}
function reasonPoint(p:MissionPoint){return p.reasons?.join(' ')||p.reason||'No hay evaluación suficiente para clasificar este sector.'}
function missionRequest(i:MissionIntent,v:VehicleProfile=LUNAR_OBJECTS.reference){return {departure_utc:i.departure_utc,date_kind:i.date_kind,surface_hours:i.surface_hours,max_slope_deg:i.max_slope_deg,min_sun_hours:i.min_sun_hours,min_earth_hours:i.min_earth_hours,observer_height_m:2,vehicle_profile:{lander_name:v.lander_name,solar_panel_height:v.solar_panel_height,antenna_height:v.antenna_height,center_of_gravity_tolerance:v.center_of_gravity_tolerance}}}

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
  const [lang]=useState<'es'|'en'>(getInitialLanguage)
  const t=STRINGS[lang]
  const [atlas,setAtlas]=useState<AtlasData|null>(null),[polar,setPolar]=useState<PolarSurface|null>(null)
  const [loadError,setLoadError]=useState(''),[retry,setRetry]=useState(0)
  const [message,setMessage]=useState(''),[intent,setIntent]=useState<MissionIntent|null>(null),[assumptions,setAssumptions]=useState<string[]>([])
  const [coverageVisible,setCoverageVisible]=useState(true),[hoveredId,setHoveredId]=useState<string|null>(null)
  const [cellDetail,setCellDetail]=useState<MissionPoint|null>(null),[cellLoading,setCellLoading]=useState(false),[cellError,setCellError]=useState('')
  const [inspectLat,setInspectLat]=useState(''),[inspectLon,setInspectLon]=useState(''),[coordinateError,setCoordinateError]=useState('')
  const [rescueReport,setRescueReport]=useState<RescueReport|null>(null),[rescueBusy,setRescueBusy]=useState(false),[rescueError,setRescueError]=useState('')
  const [rescueElapsed,setRescueElapsed]=useState(0),[rescueAttempt,setRescueAttempt]=useState(0),[adopted,setAdopted]=useState<AdoptedAlternative|null>(null)
  const rescueRequest=useRef<AbortController|null>(null),rescueTimer=useRef<number|undefined>(undefined)
  const [plan,setPlan]=useState<AutomaticPlan|null>(null),[selectedId,setSelectedId]=useState('')
  const [busy,setBusy]=useState<'intent'|'science'|null>(null),[elapsed,setElapsed]=useState(0),[error,setError]=useState('')
  const [slope,setSlope]=useState(10),[sunHours,setSunHours]=useState(12),[earthHours,setEarthHours]=useState(12)
  const [stay,setStay]=useState('72'),[preferences,setPreferences]=useState(false),[evidence,setEvidence]=useState(false),[help,setHelp]=useState(false)
  const [cameraRevision,setCameraRevision]=useState(0)
  const [focus,setFocus]=useState(false),[detail,setDetail]=useState<AtlasData|null>(null),[visualStatus,setVisualStatus]=useState('')
  const [shadingStatus,setShadingStatus]=useState('Cargando relieve NASA…'),[timeline,setTimeline]=useState(0),[playing,setPlaying]=useState(false)
  const [flight,setFlight]=useState<DescentRun|null>(null),[flightTime,setFlightTime]=useState(0),[flying,setFlying]=useState(false)
  const [aiMode,setAiMode]=useState(''),[departureInput,setDepartureInput]=useState('')
  const [vehicle,setVehicle]=useState<VehicleProfile>(LUNAR_OBJECTS.reference)
  const [vehiclePulseKey,setVehiclePulseKey]=useState(0),[uploadNotice,setUploadNotice]=useState('')
  const [landerReview,setLanderReview]=useState<LanderReview|null>(null),[reviewBusy,setReviewBusy]=useState(false)
  const [catalogOpen,setCatalogOpen]=useState(false),[composerDrag,setComposerDrag]=useState(false)
  const [mapFullscreen,setMapFullscreen]=useState(false)
  const [hideLeftPanel,setHideLeftPanel]=useState(false),[hideRightPanel,setHideRightPanel]=useState(false),[hideTimelinePanel,setHideTimelinePanel]=useState(false)
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
  const chartGeometry=useMemo(()=>{
    if(!series.length)return null
    const n=Math.max(1,series.length-1)
    const sunMargins=series.map(s=>s.sun_elevation_deg-s.sun_horizon_deg)
    const earthMargins=series.map(s=>s.earth_elevation_deg-s.earth_horizon_deg)
    const all=[...sunMargins,...earthMargins,0.3]
    const minVal=Math.min(-8,...all)-1.5
    const maxVal=Math.max(10,...all)+1.5
    const span=Math.max(4,maxVal-minVal)
    const yOf=(v:number)=>58-((v-minVal)/span)*50
    const xOf=(i:number)=>(i/n)*1000
    const thresholdY=yOf(0.3)
    const sunPath=sunMargins.map((v,i)=>`${i===0?'M':'L'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ')
    const earthPath=earthMargins.map((v,i)=>`${i===0?'M':'L'}${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ')
    const sunArea=`${sunPath} L1000,${thresholdY.toFixed(1)} L0,${thresholdY.toFixed(1)} Z`
    const earthArea=`${earthPath} L1000,${thresholdY.toFixed(1)} L0,${thresholdY.toFixed(1)} Z`
    const blockZones:Array<{x:number;w:number;kind:'sun'|'earth'|'both'}>=[]
    let start=-1,curKind:'sun'|'earth'|'both'|null=null
    for(let i=0;i<series.length;i++){
      const sBad=sunMargins[i]<=0.3,eBad=earthMargins[i]<=0.3
      const k:'sun'|'earth'|'both'|null=sBad&&eBad?'both':sBad?'sun':eBad?'earth':null
      if(k!==curKind){
        if(curKind!==null&&start>=0){
          const x0=xOf(Math.max(0,start-0.4)),x1=xOf(Math.min(n,i-0.6))
          blockZones.push({x:x0,w:Math.max(6,x1-x0),kind:curKind})
        }
        start=i;curKind=k
      }
    }
    if(curKind!==null&&start>=0){
      const x0=xOf(Math.max(0,start-0.4)),x1=1000
      blockZones.push({x:x0,w:Math.max(6,x1-x0),kind:curKind})
    }
    return {sunMargins,earthMargins,yOf,xOf,thresholdY,sunPath,earthPath,sunArea,earthArea,blockZones}
  },[series])
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
      label:`0h · ${s0&&e0?'Despeje inicial':'Sin despeje'}`,
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
          detail:currS?`Entre +${i-1} y +${i} h los paneles (${vehicle.solar_panel_height}m) recuperan luz solar`:`Entre +${i-1} y +${i} h el relieve bloquea el Sol en los paneles (${vehicle.solar_panel_height}m)`
        })
      }
      if(prevE!==currE){
        pins.push({
          hour:i,
          kind:currE?'ok':'fail',
          label:`+${i}h · ${currE?'Tierra visible':'Sin Tierra'}`,
          detail:currE?`Entre +${i-1} y +${i} h la antena (${vehicle.antenna_height}m) recupera despeje hacia la Tierra`:`Entre +${i-1} y +${i} h se pierde despeje hacia la Tierra (${vehicle.antenna_height}m)`
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
    setRescueReport(null);setRescueError('');setRescueBusy(false);setRescueElapsed(0)
    if(!plan||plan.best||!intent)return
    const ac=new AbortController();rescueRequest.current=ac
    const started=performance.now();setRescueBusy(true)
    const timer=window.setInterval(()=>setRescueElapsed(Math.floor((performance.now()-started)/1000)),1000);rescueTimer.current=timer
    const expected=missionRequest(intent,vehicle)
    fetch('/api/mission-rescue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...expected,search_days:14}),signal:ac.signal})
      .then(async response=>{
        const data=await response.json()
        if(!response.ok||data.status==='unavailable')throw new Error(data.message??'No se pudo completar la búsqueda NASA. El escenario original se conserva.')
        if(!['found','none','blocked'].includes(data.status)||data.criteria_preserved!==true||!Array.isArray(data.proposals))throw new Error('La búsqueda no devolvió evidencia suficiente para proponer cambios.')
        const profileEqual=(a:unknown,b:unknown)=>{const left=a as VehicleProfile|undefined,right=b as VehicleProfile|undefined;return Boolean(left&&right&&['lander_name','solar_panel_height','antenna_height','center_of_gravity_tolerance'].every(key=>left[key as keyof VehicleProfile]===right[key as keyof VehicleProfile]))}
        const equal=['date_kind','surface_hours','max_slope_deg','min_sun_hours','min_earth_hours','observer_height_m'] as const
        if(data.original_request?.departure_utc!==expected.departure_utc||equal.some(key=>data.original_request[key]!==expected[key])||!profileEqual(data.original_request.vehicle_profile,expected.vehicle_profile))throw new Error('La búsqueda no corresponde a los requisitos de esta misión.')
        for(const proposal of data.proposals){
          const date=Date.parse(proposal.proposed_request?.departure_utc),shift=(date-Date.parse(expected.departure_utc))/3600000
          if(proposal.criteria_preserved!==true||proposal.best?.risk!=='green'||!Number.isFinite(shift)||shift<0||shift>336||Math.abs(shift-proposal.delta_hours)>1e-6||equal.some(key=>proposal.proposed_request[key]!==expected[key])||!profileEqual(proposal.proposed_request.vehicle_profile,expected.vehicle_profile))throw new Error('Una alternativa no conserva tus requisitos. No se ha aplicado ningún cambio.')
        }
        if(!ac.signal.aborted){setRescueReport(data);if(data.status==='found'&&data.proposals[0])appendChatTurn('assistant','El motor científico encontró '+data.proposals.length+' alternativas entre las fechas examinadas. La opción de menor retraso comprobado propone '+(data.proposals[0].proposed_request.date_kind==='landing'?'alunizar':'salir')+' el '+localDate(data.proposals[0].proposed_request.departure_utc)+' (hora de Bolivia), manteniendo la estancia y tus requisitos. Revisa las propuestas calculadas antes de aplicar una fecha.');if(data.status==='found'&&window.innerWidth<=900)setTimeout(()=>{if(!ac.signal.aborted)document.querySelector('.mission-rescue')?.scrollIntoView({behavior:'smooth',block:'start'})},100)}
      })
      .catch(e=>{if(!ac.signal.aborted)setRescueError(e instanceof Error?e.message:'No se pudo completar la búsqueda de alternativas.')})
      .finally(()=>{window.clearInterval(timer);if(!ac.signal.aborted)setRescueBusy(false)})
    return()=>{ac.abort();window.clearInterval(timer)}
  },[plan,intent,rescueAttempt,vehicle])

  useEffect(()=>{
    setCellDetail(null);setCellError('');setCellLoading(false)
    if(!plan||!intent||!selectedSummary||selectedSummary.time_series?.length||!resultById.has(selectedSummary.id))return
    const ac=new AbortController(),id=selectedSummary.id
    setCellLoading(true)
    fetch('/api/automatic-plan/cell',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...missionRequest(intent,vehicle),cell_id:id,vehicle_profile:plan.vehicle_profile??vehicle}),signal:ac.signal})
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
    const activeVeh=plan.vehicle_profile??vehicle
    const revKey=`${plan.mission.arrival_utc}-${selected.id}-${activeVeh.lander_name}`
    const altSnap=recommendedAlt?{id:recommendedAlt.id,latitude_deg:recommendedAlt.latitude_deg,longitude_deg:recommendedAlt.longitude_deg}:null
    fetch('/api/copilot/lander-review',{
      method:'POST',headers:{'Content-Type':'application/json'},signal:ac.signal,
      body:JSON.stringify({
        vehicle_profile:activeVeh,
        selected:{id:selected.id,risk:selected.risk,latitude_deg:selected.latitude_deg,longitude_deg:selected.longitude_deg,x_m:selected.x_m,y_m:selected.y_m,regional_slope_deg:selected.regional_slope_deg,max_slope_deg:selected.max_slope_deg,sun_hours:selected.sun_hours,earth_hours:selected.earth_hours,reasons:selected.reasons,diagnostics:{first_sun_block_hour:selected.diagnostics?.first_sun_block_hour,first_sun_block_cardinal:selected.diagnostics?.first_sun_block_cardinal,first_earth_block_hour:selected.diagnostics?.first_earth_block_hour,first_earth_block_cardinal:selected.diagnostics?.first_earth_block_cardinal}},
        alternative:recommendedAlt?{id:recommendedAlt.id,risk:recommendedAlt.risk,latitude_deg:recommendedAlt.latitude_deg,longitude_deg:recommendedAlt.longitude_deg,x_m:recommendedAlt.x_m,y_m:recommendedAlt.y_m,regional_slope_deg:recommendedAlt.regional_slope_deg,sun_hours:recommendedAlt.sun_hours,earth_hours:recommendedAlt.earth_hours}:null,
        height_support:plan.meta.height_support,
        sources:plan.meta.sources.filter((value):value is Record<string,unknown>=>Boolean(value&&typeof value==='object'&&'query_url' in value)).slice(0,6).map(value=>({source:value.source,query_url:value.query_url,retrieved_at:value.retrieved_at})),
        source_resolution_m:plan.meta.source_resolution_m,
        surface_hours:plan.mission.surface_hours,
        arrival_label:localDate(plan.mission.arrival_utc)
      })
    }).then(r=>r.json()).then(d=>{
      if(!ac.signal.aborted&&d.status==='ok'){
        setLanderReview(d)
        const now=new Date().toLocaleTimeString('es',{timeZone:USER_TIMEZONE,hour:'2-digit',minute:'2-digit',hour12:false})
        setChatTurns(prev=>{
          const existingIdx=prev.findIndex(t=>t.reviewKey===revKey)
          if(existingIdx>=0){
            const copy=[...prev]
            copy[existingIdx]={...copy[existingIdx],review:d,altTarget:altSnap,timestamp:now}
            return copy
          }
          return [...prev.slice(-18),{id:`rev-${Date.now()}-${Math.random()}`,role:'assistant',text:d.summary,vehicle:activeVeh,review:d,reviewKey:revKey,altTarget:altSnap,timestamp:now}]
        })
      }
    }).catch(()=>{}).finally(()=>{if(!ac.signal.aborted)setReviewBusy(false)})
    return()=>ac.abort()
  },[plan,selected,recommendedAlt,vehicle])

  useEffect(()=>{
    if(!mapFullscreen&&!hideLeftPanel&&!hideRightPanel&&!hideTimelinePanel)return
    const onKey=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){
        setMapFullscreen(false);setHideLeftPanel(false);setHideRightPanel(false);setHideTimelinePanel(false)
      }
    }
    window.addEventListener('keydown',onKey)
    return()=>window.removeEventListener('keydown',onKey)
  },[mapFullscreen,hideLeftPanel,hideRightPanel,hideTimelinePanel])

  useEffect(()=>{
    chatEndRef.current?.scrollIntoView({behavior:'smooth',block:'nearest'})
  },[chatTurns.length,landerReview,busy,error])

  function appendChatTurn(role:'user'|'assistant',text:string,turnVehicle?:VehicleProfile){
    const now=new Date().toLocaleTimeString('es',{timeZone:USER_TIMEZONE,hour:'2-digit',minute:'2-digit',hour12:false})
    setChatTurns(prev=>[...prev.slice(-18),{id:`${Date.now()}-${Math.random()}`,role,text,vehicle:turnVehicle,timestamp:now}])
  }

  function applyVehicleProfile(next:VehicleProfile,noticeLabel?:string){
    setVehicle(next)
    setVehiclePulseKey(k=>k+1)
    setCatalogOpen(false)
    setUploadNotice(noticeLabel??`${next.lander_name} · Paneles ${next.solar_panel_height}m · Antena ${next.antenna_height}m · límite del perfil ${next.center_of_gravity_tolerance}°`)
    if(intent&&plan){
      appendChatTurn('user',`Cambiar objeto lunar a ${next.lander_name} (Paneles ${next.solar_panel_height}m, Antena ${next.antenna_height}m, límite de pendiente del perfil ${next.center_of_gravity_tolerance}°)`,next)
      void calculate(message,{...intent,max_slope_deg:slope},next,true)
    }
  }
  async function handleProfileFile(file:File){
    try{
      if(file.size>1024*1024||!/\.(json|gltf)$/i.test(file.name)){setError('Adjunta metadatos .json o .gltf de hasta 1 MB. GLB binario no está soportado.');return}
      const rawText=await file.text()
      const json=JSON.parse(rawText)
      const meta=json.extras??json.asset?.extras??json
      const lander_name=String(meta.lander_name??meta.name??file.name.replace(/\.(json|gltf)$/i,'')).trim().slice(0,80)||'Perfil personalizado'
      const solar_panel_height=meta.solar_panel_height??meta.panel_height
      const antenna_height=meta.antenna_height??meta.dte_antenna_height
      const center_of_gravity_tolerance=meta.center_of_gravity_tolerance??meta.max_slope_deg
      if(typeof solar_panel_height!=='number'||typeof antenna_height!=='number'||typeof center_of_gravity_tolerance!=='number'||!Number.isFinite(solar_panel_height)||solar_panel_height<0.5||solar_panel_height>200||!Number.isFinite(antenna_height)||antenna_height<0.5||antenna_height>200||!Number.isFinite(center_of_gravity_tolerance)||center_of_gravity_tolerance<0||center_of_gravity_tolerance>45){
        setError('El archivo debe incluir solar_panel_height (0.5–200m), antenna_height (0.5–200m) y center_of_gravity_tolerance (0–45°).')
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

  async function askMissionQA(question:string){
    if(!plan||!selected)return
    appendChatTurn('user',question,vehicle)
    setBusy('intent')
    const activeVeh=plan.vehicle_profile??vehicle
    try{
      const res=await fetch('/api/copilot/chat',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          message:question,
          context:{
            vehicle:{
              lander_name:activeVeh.lander_name,
              solar_panel_height:activeVeh.solar_panel_height,
              antenna_height:activeVeh.antenna_height,
              center_of_gravity_tolerance:activeVeh.center_of_gravity_tolerance
            },
            counts:plan.counts,
            best:plan.best?{
              id:plan.best.id,
              lat:plan.best.latitude_deg,
              lon:plan.best.longitude_deg,
              slopeDeg:plan.best.regional_slope_deg,
              sunHours:plan.best.sun_hours,
              earthHours:plan.best.earth_hours
            }:null,
            selected:{
              id:selected.id,
              name:`Sector ${selected.id.replace('polar:','')}`,
              lat:selected.latitude_deg,
              lon:selected.longitude_deg,
              slopeDeg:selected.regional_slope_deg,
              resolutionM:80,
              coverage:'regional',
              sunHours:selected.sun_hours,
              earthHours:selected.earth_hours
            },
            regional:{
              scope:'Polo Sur Lunar (80°S — 90°S)',
              sourceResolutionM:80,
              totalCells:plan.total_cells??12892,
              knownCells:((plan.counts?.green??0)+(plan.counts?.yellow??0)+(plan.counts?.red??0))||12800,
              evaluated:true
            },
            simulation:{
              status:selected.time_series?.length?'ready':'not_run',
              risk:selected.risk,
              reasons:selected.reasons??[],
              sunHours:selected.sun_hours,
              earthHours:selected.earth_hours
            },
            alternatives:plan.alternatives?.slice(0,4).map(a=>({
              id:a.id,
              name:`${num(Math.abs(a.latitude_deg),2)}°S ${longitude(a.longitude_deg,2)}`,
              lat:a.latitude_deg,
              lon:a.longitude_deg,
              slopeDeg:a.regional_slope_deg,
              sunHours:a.sun_hours,
              earthHours:a.earth_hours
            }))??[]
          }
        })
      })
      const data=await res.json()
      if(data.status==='ok'&&data.explanation){
        appendChatTurn('assistant',data.explanation,activeVeh)
        if(data.action?.type==='select_cell'&&data.action.target_id){
          choose(data.action.target_id)
        }
      }else{
        appendChatTurn('assistant',data.message||'No se pudo obtener respuesta del copiloto en este momento.')
      }
    }catch(e){
      appendChatTurn('assistant',e instanceof Error?e.message:'Error al consultar al copiloto.')
    }finally{
      setBusy(null)
    }
  }

  function clearResult(){setAdopted(null);request.current?.abort();requestId.current++;setBusy(null);setPlan(null);setError('');setFlight(null);setFlying(false);setPlaying(false)}
  async function calculate(text=message,reuseIntent?:MissionIntent,overrideVehicle?:VehicleProfile,skipUserBubble=false,alternative?:AdoptedAlternative){
    const detectedVehicle=!overrideVehicle&&text?matchCatalogVehicleFromText(text):null
    const activeVehicle=overrideVehicle??detectedVehicle??vehicle
    if(detectedVehicle&&detectedVehicle.lander_name!==vehicle.lander_name){
      setVehicle(detectedVehicle)
      setVehiclePulseKey(k=>k+1)
    }
    if(!text.trim()&&!reuseIntent){setError('Escribe la fecha y hora de tu viaje para empezar.');return}
    if(!atlas||!polar){setError('Espera a que terminen de cargar los datos NASA.');return}
    const requirements=reuseIntent??{surface_hours:Number(stay),max_slope_deg:slope,min_sun_hours:sunHours,min_earth_hours:earthHours}
    if(!Number.isInteger(requirements.surface_hours)||requirements.surface_hours<1||requirements.surface_hours>336||!Number.isFinite(requirements.max_slope_deg)||requirements.max_slope_deg<0||requirements.max_slope_deg>45){setError('Revisa la estancia (1–336 horas) y la pendiente máxima (0–45°).');return}
    if([requirements.min_sun_hours,requirements.min_earth_hours].some(value=>!Number.isFinite(value)||value<0||value>requirements.surface_hours)){setError('Las horas mínimas de Sol o Tierra deben estar entre cero y la duración de la estancia. Ajusta los requisitos; no se reducen automáticamente.');return}
    if(!skipUserBubble&&text.trim()){
      appendChatTurn('user',text.trim(),activeVehicle)
    }
    request.current?.abort();const ac=new AbortController(),id=++requestId.current;request.current=ac
    setAdopted(alternative??null);setError('');setPlan(null);setFlight(null);setFlying(false);setPlaying(false);setFocus(false);setElapsed(0);startClock.current=performance.now()
    try{
      let parsed=reuseIntent
      if(!parsed){
        setBusy('intent')
        const response=await fetch('/api/mission-intent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,timezone:TIMEZONE,defaults:{surface_hours:Number(stay),max_slope_deg:slope,min_sun_hours:sunHours,min_earth_hours:earthHours}}),signal:ac.signal})
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
      setIntent(parsed);setDepartureInput(toUserDatetimeInputValue(parsed.departure_utc));setBusy('science')
      const response=await fetch('/api/automatic-plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(missionRequest(parsed,activeVehicle)),signal:ac.signal})
      const data=await response.json()
      if(!response.ok||data.status!=='ok'||!data.coverage||!Array.isArray(data.cells))throw new Error(data.message??'NASA no pudo completar el análisis; no se inventará una recomendación.')
      if(ac.signal.aborted||id!==requestId.current)return
      setCoverageVisible(true);setHoveredId(null);document.querySelector('.mission-decisions')?.scrollTo({top:0});setPlan(data);setSelectedId(data.best?.id??data.closest_candidate?.id??'');setPreferences(false)
      if(window.innerWidth<=900)setTimeout(()=>{if(id===requestId.current)document.querySelector('.one-map-heading')?.scrollIntoView({behavior:'smooth',block:'start'})},100)
    }catch(e){
      if(!ac.signal.aborted){
        const msg=e instanceof Error?e.message:'No se pudo completar el cálculo.'
        setError(msg)
      }
    }
    finally{if(!ac.signal.aborted&&id===requestId.current)setBusy(null)}
  }
  function cancelRescue(){rescueRequest.current?.abort();window.clearInterval(rescueTimer.current);setRescueBusy(false)}
  function applyAlternative(proposal:RescueProposal){
    if(!intent||!rescueReport||proposal.criteria_preserved!==true)return
    const chosen={original_text:message,original:rescueReport.original_request,proposal,search:rescueReport.search,meta:rescueReport.meta}
    const request=proposal.proposed_request,date=new Date(request.departure_utc)
    const day=new Intl.DateTimeFormat('es',{timeZone:TIMEZONE,day:'numeric',month:'long',year:'numeric'}).format(date)
    const clock=new Intl.DateTimeFormat('es',{timeZone:TIMEZONE,hour:'2-digit',minute:'2-digit',hour12:false}).format(date)
    const updated='Quiero '+(request.date_kind==='landing'?'alunizar':'viajar')+' el '+day+' a las '+clock+' (hora de Bolivia) y estar '+request.surface_hours+' horas en la Luna. Pendiente máxima '+request.max_slope_deg+' grados; mínimo '+request.min_sun_hours+' horas de Sol y '+request.min_earth_hours+' horas de Tierra visible.'
    const local=new Date(date.getTime()-4*3600000).toISOString().slice(0,16)
    setMessage(updated)
    void calculate(updated,{...intent,...request,requested_utc:request.departure_utc,timezone:TIMEZONE,local_datetime:local},undefined,false,chosen)
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
    const data={...plan,user_request:message,interpreted_intent:intent,interpretation_assumptions:assumptions,rescue_search:rescueReport,adopted_alternative:adopted,selected_id:selected?.id,exported_at:new Date().toISOString(),descent:flight?{configuration:flight.config,outcome:flight.outcome,impact_speed_mps:flight.impactSpeedMps}:null}
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a')
    a.href=url;a.download='lunar-oracle-plan-de-mision.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  function recalculate(){
    if(!intent)return
    const date=new Date(departureInput)
    if(!Number.isFinite(date.getTime())||!departureInput){setError('Revisa la fecha y hora.');return}
    void calculate(message,{...intent,departure_utc:date.toISOString().replace(/\.\d{3}Z$/,'Z'),local_datetime:departureInput,surface_hours:Number(stay),max_slope_deg:slope,min_sun_hours:sunHours,min_earth_hours:earthHours})
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

  const layoutClass=[
    'unified-layout',
    (mapFullscreen||hideLeftPanel)?'hide-left':'',
    (mapFullscreen||hideRightPanel)?'hide-right':'',
    hideTimelinePanel?'hide-timeline':''
  ].filter(Boolean).join(' ')

  return <div className={'unified-mission'+(mapFullscreen?' map-is-fullscreen':'')} data-testid="unified-mission">
    <header className="unified-header"><div className="unified-logo"><Orbit size={30}/><div>LUNAR ORACLE<small>PLANIFICA TU LLEGADA A LA LUNA</small></div></div><span className="unified-data-status"><i/> NASA LOLA + JPL HORIZONS</span><button onClick={()=>setHelp(true)}><CircleHelp size={15}/> Cómo funciona</button></header>
    <div className={layoutClass}>
      {!hideLeftPanel&&<aside className="trip-panel chat-linked-panel">
        <div className="chat-panel-top">
          <div className="chat-panel-top-bar">
            <span className="micro-title">COPILOTO DE MISIÓN</span>
            <button
              type="button"
              className={'chat-settings-gear-btn'+(preferences?' active':'')}
              onClick={()=>setPreferences(v=>!v)}
              aria-label={t.manualSettings}
              title={t.manualSettings}
            >
              <Settings2 size={16}/>
            </button>
          </div>
          <h1>Dinos cuándo y <em>encontramos dónde.</em></h1>
        </div>

        {/* Fluid Gemini-style Persistent Conversational Thread */}
        <div className="mission-chat-thread" aria-live="polite">
          {chatTurns.length===0&&!plan&&!busy&&<div className="gemini-msg assistant">
            <div className="gemini-msg-head"><Bot size={15}/><span>Copiloto de misión</span></div>
            <div className="gemini-msg-content">
              <p>{t.chatGreeting}</p>
              <button type="button" className="example-trip" onClick={()=>{setMessage(EXAMPLE);void calculate(EXAMPLE)}} disabled={!atlas||!polar}>{t.exampleBtn} <ArrowRight size={12}/></button>
            </div>
          </div>}

          {chatTurns.map((turn,turnIdx)=>{
            if(turn.role==='user'){
              return (
                <div key={turn.id} className="gemini-msg user">
                  <div className="user-pill">
                    <p>{turn.text}</p>
                    {turn.vehicle&&<small className="user-pill-meta">{turn.vehicle.lander_name} · {turn.vehicle.solar_panel_height}m / {turn.vehicle.antenna_height}m / {turn.vehicle.center_of_gravity_tolerance}°</small>}
                  </div>
                </div>
              )
            }
            if(turn.review){
              const rev=turn.review
              const isLatestReview=turnIdx===chatTurns.length-1||!chatTurns.slice(turnIdx+1).some(t=>Boolean(t.review))
              const alt=turn.altTarget??recommendedAlt
              return (
                <div key={turn.id} className="gemini-msg assistant" data-testid={isLatestReview?'gemini-engineer-card':undefined}>
                  <div className="gemini-msg-head">
                    <Bot size={15}/>
                    <span>Explicación del escenario</span>
                    <small>{rev.mode==='ai'?`IA · ${rev.model}`:'Guía con evidencia del modelo'} · {turn.timestamp}</small>
                  </div>
                  <div className="gemini-msg-content">
                    <p className="engineer-summary">{rev.summary}</p>
                    <p className="gemini-paragraph-muted"><strong>Diagnóstico:</strong> {rev.risk_alert}</p>
                    <div className="gemini-recommendations-list">
                      <p><strong>1. Sitio alternativo:</strong> {rev.site_recommendation}</p>
                      <p><strong>2. Hardware:</strong> {rev.hardware_recommendation}</p>
                    </div>
                    <div className="gemini-action-chips">
                      {alt&&alt.id!==selected?.id&&<button type="button" onClick={()=>{choose(alt.id);setFocus(true);appendChatTurn('user',`Cambiar al sector alternativo (${num(Math.abs(alt.latitude_deg),2)}°S, ${longitude(alt.longitude_deg,2)})`,vehicle)}}>Ir a {num(Math.abs(alt.latitude_deg),2)}°S <ArrowRight size={11}/></button>}
                      <small>Comparar otras alturas requiere recalcular sus propios horizontes.</small>
                    </div>
                  </div>
                </div>
              )
            }
            return (
              <div key={turn.id} className="gemini-msg assistant">
                <div className="gemini-msg-head"><Bot size={15}/><span>Copiloto de misión</span><small>{turn.timestamp}</small></div>
                <div className="gemini-msg-content"><p>{turn.text}</p></div>
              </div>
            )
          })}

          {busy&&<div className="gemini-msg assistant">
            <div className="gemini-msg-head"><LoaderCircle size={15} className="spin"/><span>Copiloto de misión</span></div>
            <div className="gemini-msg-content">
              <div className="planning-progress" role="status">
                <span>{busy==='intent'?'Interpretando tu viaje…':'Calculando horizontes NASA LOLA y efemérides JPL…'}</span>
                <div><Check size={13}/> Relieve polar · {vehicle.lander_name} ({vehicle.solar_panel_height}m / {vehicle.antenna_height}m)</div>
                <small>{elapsed} s · <button type="button" className="inline-cancel" onClick={()=>{request.current?.abort();setBusy(null)}}>Cancelar</button></small>
              </div>
            </div>
          </div>}

          {plan&&reviewBusy&&!chatTurns.some(t=>Boolean(t.review))&&<div className="gemini-msg assistant" data-testid="gemini-engineer-card">
            <div className="gemini-msg-head">
              <Bot size={15}/>
              <span>Explicación del escenario</span>
              <small>Analizando…</small>
            </div>
            <div className="gemini-msg-content">
              <p className="loading-note">Evaluando geometría del vehículo sobre el terreno…</p>
            </div>
          </div>}
          <div ref={chatEndRef}/>
        </div>

        {(error||loadError)&&<div className="trip-error" role="alert">{error||loadError}{loadError&&<button onClick={()=>setRetry(r=>r+1)}>Reintentar datos</button>}</div>}
        {!atlas&&!loadError&&<p className="loading-note">Cargando el relieve lunar…</p>}

        {/* ChatGPT / Gemini style unified composer with single + (.json/.gltf) and Lunar Object Selector */}
        <form
          className={'chat-composer-box'+(composerDrag?' dragging':'')}
          onSubmit={e=>{
            e.preventDefault()
            const txt=message.trim()
            if(!txt)return
            setMessage('')
            if(plan&&selected&&!/(\d{1,2}\s+de\s+[a-z]+|\d{4}-\d{2}-\d{2}|viaj|aluniz|salid)/i.test(txt)){
              void askMissionQA(txt)
            }else{
              void calculate(txt)
            }
          }}
          onDragOver={e=>{e.preventDefault();setComposerDrag(true)}}
          onDragLeave={()=>setComposerDrag(false)}
          onDrop={e=>{e.preventDefault();setComposerDrag(false);const f=e.dataTransfer.files?.[0];if(f)void handleProfileFile(f)}}
        >
          <input ref={fileInputRef} type="file" accept=".json,.gltf" hidden onChange={e=>{const f=e.target.files?.[0];if(f)void handleProfileFile(f);e.target.value=''}}/>

          {/* Active Vehicle / Object Attachment Chip inside the composer box */}
          <div className="composer-attachment-bar">
            <div className="composer-active-chip" title={vehicle.description??vehicle.lander_name}>
              <Rocket size={12}/>
              <strong>{vehicle.lander_name}</strong>
              <span>Paneles {vehicle.solar_panel_height}m · Antena {vehicle.antenna_height}m · límite del perfil {vehicle.center_of_gravity_tolerance}°</span>
            </div>
          </div>

          <label htmlFor="mission-request" className="sr-only-label">¿Qué misión quieres hacer?</label>
          <textarea
            id="mission-request"
            aria-label="Describe tu misión"
            value={message}
            onChange={e=>setMessage(e.target.value)}
            onKeyDown={e=>{
              if(e.key==='Enter'&&!e.shiftKey){
                e.preventDefault()
                const txt=message.trim()
                if(!txt||busy||!atlas||!polar)return
                setMessage('')
                if(plan&&selected&&!/(\d{1,2}\s+de\s+[a-z]+|\d{4}-\d{2}-\d{2}|viaj|aluniz|salid)/i.test(txt)){
                  void askMissionQA(txt)
                }else{
                  void calculate(txt)
                }
              }
            }}
            rows={3}
            maxLength={1600}
            placeholder={t.placeholder}
          />

          {/* Popover menu for all Lunar South Pole vehicles, rovers & habitats */}
          {catalogOpen&&<div className="lunar-catalog-popover" role="region" aria-label="Objetos y vehículos para el Polo Sur Lunar">
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
                          <span>Paneles {item.solar_panel_height}m · Antena {item.antenna_height}m · límite del perfil {item.center_of_gravity_tolerance}°</span>
                        </div>
                        <small>{item.description}</small>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>}

          {/* Bottom Toolbar inside the Chat Input Box — single .json/.gltf option */}
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
              <span>{busy?t.calculating:t.planBtn}</span>
            </button>
          </div>
          {uploadNotice&&<small className="upload-notice">{uploadNotice}</small>}
        </form>
        {adopted&&<div className="adopted-alternative" data-testid="adopted-alternative"><Check size={14}/><div><strong>Alternativa aplicada</strong><span>{adopted.original.date_kind==='landing'?'Alunizaje':'Salida'} original: {localDate(adopted.original.departure_utc)}<br/>Nueva fecha: {localDate(adopted.proposal.proposed_request.departure_utc)}</span><small>La solicitud original queda guardada en la comparación. La estancia y los requisitos no cambian.</small></div></div>}
        <p className="profile-provenance sr-only-label" data-testid="profile-provenance">Perfil de referencia: horizontes preparados a 2 m. Los objetos del catálogo son ejemplos hipotéticos editables, no fichas de fabricante.</p>
        {preferences&&<div className="trip-preferences chat-manual-modal">
          <div className="manual-modal-head">
            <strong>{t.manualTitle}</strong>
            <button type="button" onClick={()=>setPreferences(false)} aria-label="Cerrar configuración manual"><X size={14}/></button>
          </div>
          {intent&&<label>{intent.date_kind==='landing'?t.landingDay:t.departureDay} · {localTimeZoneLabel()}<input aria-label="Fecha de viaje" type="datetime-local" value={departureInput} onChange={e=>{clearResult();setDepartureInput(e.target.value)}}/></label>}
          <label>{t.stayDuration}<select aria-label="Estancia en la Luna" value={stay} onChange={e=>{clearResult();setStay(e.target.value)}}><option value="24">1 día · 24 h</option><option value="48">2 días · 48 h</option><option value="72">3 días · 72 h</option><option value="168">7 días · 168 h</option>{!['24','48','72','168'].includes(stay)&&<option value={stay}>{stay} horas</option>}</select></label>
          <label>{t.maxSlope}<input aria-label="Pendiente máxima" type="number" min={0} max={45} value={slope} onChange={e=>{clearResult();setSlope(Number(e.target.value))}}/></label>
          <label>{t.minSun}<input aria-label="Horas mínimas de Sol" type="number" min={0} max={Number(stay)} value={sunHours} onChange={e=>{clearResult();setSunHours(Number(e.target.value))}}/></label>
          <label>{t.minEarth}<input aria-label="Horas mínimas de Tierra visible" type="number" min={0} max={Number(stay)} value={earthHours} onChange={e=>{clearResult();setEarthHours(Number(e.target.value))}}/></label>
          <p>El viaje de ida y vuelta se estima por separado. La estancia no es la duración total.</p>
          {intent&&<button onClick={recalculate} disabled={Boolean(busy)}>{t.recalcBtn}</button>}
        </div>}
      </aside>}

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
            <div className="workspace-panel-toggles" role="group" aria-label="Ocultar o mostrar paneles">
              <button
                type="button"
                className="panel-toggle-btn"
                aria-pressed={!hideLeftPanel&&!mapFullscreen}
                onClick={()=>{setMapFullscreen(false);setHideLeftPanel(v=>!v);setTimeout(()=>setCameraRevision(r=>r+1),60)}}
                title={hideLeftPanel?'Mostrar panel de chat izquierdo':'Ocultar panel de chat izquierdo'}
                aria-label="Alternar panel de chat"
              >
                <PanelLeft size={14}/>
              </button>
              {plan&&<button
                type="button"
                className="panel-toggle-btn"
                aria-pressed={!hideTimelinePanel}
                onClick={()=>{setHideTimelinePanel(v=>!v);setTimeout(()=>setCameraRevision(r=>r+1),60)}}
                title={hideTimelinePanel?'Mostrar línea de tiempo':'Ocultar línea de tiempo'}
                aria-label="Alternar línea de tiempo"
              >
                <PanelBottom size={14}/>
              </button>}
              <button
                type="button"
                className="panel-toggle-btn"
                aria-pressed={!hideRightPanel&&!mapFullscreen}
                onClick={()=>{setMapFullscreen(false);setHideRightPanel(v=>!v);setTimeout(()=>setCameraRevision(r=>r+1),60)}}
                title={hideRightPanel?'Mostrar panel derecho':'Ocultar panel derecho'}
                aria-label="Alternar panel derecho"
              >
                <PanelRight size={14}/>
              </button>
            </div>
          </div>
        </div>
        <div className="one-moon-map" data-testid="mission-map">
          <Tactical3DScene latDeg={selected?.latitude_deg??-90} lonDeg={selected?.longitude_deg??0} observerHeightM={2} sunAzimuthDeg={current?.sun_azimuth_deg??0} sunElevationDeg={current?.sun_elevation_deg??0} earthAzimuthDeg={current?.earth_azimuth_deg??0} earthElevationDeg={current?.earth_elevation_deg??0} minSolarElevation={0} maxSlopeDeg={vehicle.center_of_gravity_tolerance} currentSlopeDeg={selected?.regional_slope_deg??NaN}
            atlasData={atlas} focusTerrainData={detail} sunRaycast={ray(current?.sun_elevation_deg,current?.sun_horizon_deg)} earthRaycast={ray(current?.earth_elevation_deg,current?.earth_horizon_deg)} cameraView="polar" siteName={selected?`${vehicle.lander_name} · Destino`:'Polo sur'}
            overview focusZone={focus} onShadingStatus={setShadingStatus} cameraResetKey={cameraRevision+(focus?1:0)} missionMarkers={flight?[]:markers} onMarkerSelect={choose} polarSurface={polar} missionCoverage={coverageLayer} onCoverageSelect={choose} onCoverageHover={setHoveredId}
            onSurfacePlace={sampleMap} placementMode scienceReady={Boolean(current)} assessmentRisk={selected?.risk??'unknown'} showSurfaceVehicle={Boolean(flight)} altitudeM={telemetry?.altitudeM??0} landed={landed}
            solarPanelHeightM={vehicle.solar_panel_height} antennaHeightM={vehicle.antenna_height} landerName={vehicle.lander_name} vehiclePulseKey={vehiclePulseKey}/>
          <div className="one-map-source"><span>{plan&&coverageVisible&&!flight?'Evaluación de toda la superficie':'NASA LOLA · relieve continuo'}</span><small>{focus&&detail?'Detalle visual ~396 m · fuente 80 m':shadingStatus.includes('no disponible')?'Sombreado no disponible; relieve conservado':'Vista regional · fuente de 80 m'}{visualStatus.includes('no disponible')?' · '+visualStatus:''}</small><small>Nave y astros en escala ilustrativa.</small></div>

          {/* Icon-only "Simular llegada a este destino" button inside the Moon map screen */}
          {plan&&selected&&<button
            type="button"
            className={'simulate-arrival map-simulate-icon-btn'+(flight?' active':'')}
            aria-label="Simular llegada a este destino"
            title={isRejected||!plan.best?'Selecciona un candidato favorable para simular el descenso':'Simular llegada a este destino'}
            disabled={isRejected||!plan.best||cellLoading||Boolean(cellError)}
            onClick={runDescent}
          >
            <Rocket size={16}/>
          </button>}

          {!plan&&<div className="one-map-empty"><Orbit size={20}/><strong>{busy?'Estamos calculando tus destinos.':'Escribe tu viaje para ver dónde alunizar.'}</strong><span>{busy?'La recomendación aparecerá aquí con sus alternativas.':'Sin cambiar de pantalla ni elegir capas técnicas.'}</span></div>}
          {plan&&!flight&&<div className="surface-inspection-hint"><MapPin size={12}/>{hovered?<><b className={'risk-text '+hovered.risk}>{SURFACE_CLASS_LABELS[hovered.risk]}</b><span>{num(Math.abs(hovered.latitude_deg),2)}°S · {longitude(hovered.longitude_deg)} · pendiente P95 {num(hovered.regional_slope_deg)}°</span></>:<span>Haz clic en cualquier área para ver sus mediciones y motivos.</span>}</div>}
        </div>
        {plan&&!hideTimelinePanel&&<SurfaceCoverageSummary plan={plan} active={coverageVisible} onToggle={()=>setCoverageVisible(v=>!v)} onEvidence={()=>setEvidence(true)}/>}
        {plan&&!hideTimelinePanel&&<div className="mission-conditions">
          <div className="conditions-heading">
            <strong><Globe2 size={14}/> Línea de tiempo unificada · {vehicle.lander_name}</strong>
            <div className="conditions-legend-inline">
              <span className="legend-sun"><Sun size={11}/> Sol ({vehicle.solar_panel_height}m): <b>{num(selected?.sun_hours,0)}h</b>/{plan.mission.surface_hours}h</span>
              <span className="legend-earth"><Globe2 size={11}/> Tierra ({vehicle.antenna_height}m): <b>{num(selected?.earth_hours,0)}h</b>/{plan.mission.surface_hours}h</span>
              <time>{current?localDate(current.t_utc):localDate(plan.mission.arrival_utc)} · {localTimeZoneLabel()} ({!current?'Datos no disponibles':currentBothOk?'Sol y Tierra visibles':!currentSunOk&&!currentEarthOk?'Sin despeje de Sol ni Tierra':!currentSunOk?'Sol sin despeje':'Tierra sin despeje'})</time>
            </div>
          </div>

          <div className="conditions-slider">
            <button aria-label={playing?'Pausar condiciones':'Reproducir condiciones'} disabled={!series.length||flying} onClick={()=>{if(timeline===series.length-1)setTimeline(0);setPlaying(v=>!v)}}>{playing?<Pause size={14}/>:<Play size={14}/>}</button>
            <div className="timeline-track-stack unified-curve-stack">
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

              {/* Single Unified Continuous Timeline Chart: Yellow Sun (#f5cb67) & Sky-Blue Earth (#8ddfe9) rising and falling over time */}
              {chartGeometry&&<div className="unified-chart-box">
                <svg className="unified-timeline-svg" viewBox="0 0 1000 64" preserveAspectRatio="none" aria-hidden="true">
                  <rect x={0} y={chartGeometry.thresholdY} width={1000} height={Math.max(0,64-chartGeometry.thresholdY)} fill="#1a1115" opacity={0.55}/>
                  {chartGeometry.blockZones.map((z,i)=>(
                    <rect key={i} x={z.x} y={0} width={z.w} height={64} fill={z.kind==='both'?'#ff5a6726':z.kind==='sun'?'#f5cb6718':'#8ddfe918'}/>
                  ))}
                  <line x1={0} y1={chartGeometry.thresholdY} x2={1000} y2={chartGeometry.thresholdY} stroke="#526477" strokeWidth={1} strokeDasharray="4 4"/>
                  <path d={chartGeometry.sunArea} fill="#f5cb67" opacity={0.11}/>
                  <path d={chartGeometry.earthArea} fill="#8ddfe9" opacity={0.11}/>
                  <path d={chartGeometry.earthPath} fill="none" stroke="#8ddfe9" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"/>
                  <path d={chartGeometry.sunPath} fill="none" stroke="#f5cb67" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"/>
                  <line x1={chartGeometry.xOf(timeline)} y1={0} x2={chartGeometry.xOf(timeline)} y2={64} stroke="#ffffff" strokeWidth={1.5} opacity={0.85}/>
                  {chartGeometry.earthMargins[timeline]!==undefined&&<circle cx={chartGeometry.xOf(timeline)} cy={chartGeometry.yOf(chartGeometry.earthMargins[timeline])} r={3.5} fill={currentEarthOk?'#8ddfe9':'#ff6b78'} stroke="#0b1118" strokeWidth={1.2}/>}
                  {chartGeometry.sunMargins[timeline]!==undefined&&<circle cx={chartGeometry.xOf(timeline)} cy={chartGeometry.yOf(chartGeometry.sunMargins[timeline])} r={3.5} fill={currentSunOk?'#f5cb67':'#ff6b78'} stroke="#0b1118" strokeWidth={1.2}/>}
                </svg>
                <input
                  className="chart-range-overlay"
                  aria-label="Hora de la estancia"
                  type="range"
                  min={0}
                  max={Math.max(0,series.length-1)}
                  value={timeline}
                  disabled={!series.length||flying}
                  onChange={e=>{setPlaying(false);setTimeline(Number(e.target.value))}}
                />
              </div>}
              {!chartGeometry&&<input
                aria-label="Hora de la estancia"
                type="range"
                min={0}
                max={Math.max(0,series.length-1)}
                value={timeline}
                disabled={!series.length||flying}
                onChange={e=>{setPlaying(false);setTimeline(Number(e.target.value))}}
              />}

              {/* Integrated interval strip at the base of the unified chart */}
              {series.length>0&&<div className="timeline-status-bars">
                <div className="status-bar-row">
                  <span className="bar-label sun-label"><Sun size={11}/> Sol ({vehicle.solar_panel_height}m)</span>
                  <div className="bar-segments">
                    {series.slice(0,-1).map((s,idx)=>{
                      const ok=s.sun_elevation_deg-s.sun_horizon_deg>0.3
                      return <span
                        key={idx}
                        className={'seg '+(ok?'sun-ok':'off')+(idx===timeline?' active':'')}
                        onClick={()=>{setPlaying(false);setTimeline(idx)}}
                        title={`Intervalo +${idx} a +${idx+1} h · Sol al inicio: ${ok?'Iluminado':'Sombra'} (${num(s.sun_elevation_deg-s.sun_horizon_deg,2)}°)`}
                      />
                    })}
                  </div>
                  <small className="bar-summary"><b>{num(selected?.sun_hours,0)}h</b>/{plan.mission.surface_hours}h</small>
                </div>
                <div className="status-bar-row">
                  <span className="bar-label earth-label"><Globe2 size={11}/> Tierra ({vehicle.antenna_height}m)</span>
                  <div className="bar-segments">
                    {series.slice(0,-1).map((s,idx)=>{
                      const ok=s.earth_elevation_deg-s.earth_horizon_deg>0.3
                      return <span
                        key={idx}
                        className={'seg '+(ok?'earth-ok':'off')+(idx===timeline?' active':'')}
                        onClick={()=>{setPlaying(false);setTimeline(idx)}}
                        title={`Intervalo +${idx} a +${idx+1} h · Tierra al inicio: ${ok?'Visible':'Sin despeje'} (${num(s.earth_elevation_deg-s.earth_horizon_deg,2)}°)`}
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
            <span><Sun size={12}/> Sol sobre el horizonte ({vehicle.solar_panel_height} m): <b className={current?(current.sun_elevation_deg-current.sun_horizon_deg>0.3?'kpi-ok':'kpi-warn'):undefined}>{num(current?current.sun_elevation_deg-current.sun_horizon_deg:null,2)}°</b></span>
            <span><Globe2 size={12}/> Tierra sobre el horizonte ({vehicle.antenna_height} m): <b className={current?(current.earth_elevation_deg-current.earth_horizon_deg>0.3?'kpi-ok':'kpi-warn'):undefined}>{num(current?current.earth_elevation_deg-current.earth_horizon_deg:null,2)}°</b></span>
            <span>Pendiente P95: <b className={selected?.regional_slope_deg==null?undefined:selected.regional_slope_deg<=Math.min(intent?.max_slope_deg??slope,vehicle.center_of_gravity_tolerance)?'kpi-ok':'kpi-warn'}>{num(selected?.regional_slope_deg,2)}°</b> · límite del escenario {num(Math.min(intent?.max_slope_deg??slope,vehicle.center_of_gravity_tolerance),2)}°</span>
          </div>
        </div>}
      </main>

      {!hideRightPanel&&<aside className="mission-decisions">
        {!plan?<div className="decision-welcome"><MapPin size={28}/><h2>Aquí encontrarás tu mejor opción.</h2><p>El sistema relacionará la fecha de tu viaje y el objeto lunar elegido con el terreno, la luz y la visibilidad de la Tierra.</p><ul><li><Check size={13}/> Un destino recomendado y sus razones</li><li><Check size={13}/> Clasificación de toda la superficie</li><li><Check size={13}/> Diagnóstico conversacional en el chat izquierdo</li></ul><small>Los resultados corresponden a un modelo regional de planificación, no a una autorización de vuelo.</small></div>:<>
          {!plan.best&&<><div className="decision-title"><span className="micro-title">{plan.best?'RECOMENDACIÓN CALCULADA':plan.counts.unknown===plan.total_cells?'FALTAN DATOS PARA EVALUAR ESTE PERFIL':'NINGUNA ZONA CUMPLE TODOS LOS CRITERIOS'}</span>{aiMode&&<small>{aiMode}</small>}</div><MissionRescuePanel report={rescueReport} busy={rescueBusy} error={rescueError} elapsed={rescueElapsed} onApply={applyAlternative} onRetry={()=>setRescueAttempt(a=>a+1)} onCancel={cancelRescue} onEvidence={()=>setEvidence(true)}/></>}
          {/* Selected sector, followed by the compact candidate list. */}
          {selected&&<section className="selected-destination top-selected-destination"><div className="selected-destination-title"><span className={'selected-color '+selected.risk}/><h3>{selectedLabel}</h3></div><span className="selected-sector-id">Sector {selected.id.replace('polar:','')} · {num(selected.area_km2,2)} km² regionales</span><p>{reasonPoint(selected)}</p><dl><div><dt>Perfil del escenario</dt><dd>{vehicle.lander_name}</dd></div><div><dt>Centro del sector</dt><dd>{num(selected.latitude_deg,5)}°, {num(selected.longitude_deg,5)}°</dd></div><div><dt>Elevación</dt><dd>{num(selected.elevation_m??selectedCell?.elevation_m,0)} m</dd></div><div><dt>Pendiente P95 · fuente de 80 m</dt><dd>{num(selected.regional_slope_deg,2)}°</dd></div><div><dt>Máxima pendiente nativa</dt><dd>{num(selected.max_slope_deg??selectedCell?.max_slope_deg)}°</dd></div><div><dt>Sol visible ({vehicle.solar_panel_height}m)</dt><dd>{num(selected.sun_hours,0)} h</dd></div><div><dt>Tierra visible ({vehicle.antenna_height}m)</dt><dd>{num(selected.earth_hours,0)} h</dd></div></dl>

            {selected.sun_hours_sensitivity&&selected.earth_hours_sensitivity&&<div className="sampling-sensitivity"><strong>Variación por muestreo angular</strong><span>Sol: {num(selected.sun_hours_sensitivity.lower,0)}–{num(selected.sun_hours_sensitivity.upper,0)} h · Tierra: {num(selected.earth_hours_sensitivity.lower,0)}–{num(selected.earth_hours_sensitivity.upper,0)} h</span><small>Compara direcciones vecinas del horizonte. No es una probabilidad de éxito.</small></div>}
            {cellLoading&&<p className="cell-detail-status" role="status"><LoaderCircle className="spin" size={13}/> Cargando condiciones de esta área…</p>}
            {cellError&&<p className="trip-error" role="alert">{cellError}</p>}
            {flight&&<div className="arrival-telemetry"><strong>{landed?(flight.outcome==='soft-touchdown'?'Contacto suave en el modelo':'Impacto en el modelo'):'Descenso físico · 30×'}</strong><span>Altura: {num(telemetry?.altitudeM,0)} m</span><span>Velocidad: {num(telemetry?.velocityMps,1)} m/s</span><span>Combustible: {num(telemetry?.fuelKg,0)} kg</span><button onClick={()=>setFlying(v=>!v)} disabled={landed}>{flying?'Pausar':'Continuar'}</button><small>Descenso de una nave genérica hipotética. El perfil visual no aporta masa, empuje ni una validación del destino.</small></div>}
          </section>}

          {/* 2. Below Selected Sector: Uniform Candidate List where #1 shares the exact compact row design of #2, #3, #4 */}
          {plan.best&&<div className="decision-title candidates-below-title"><span className="micro-title">{plan.best?'RECOMENDACIÓN CALCULADA':'NINGUNA ZONA CUMPLE TODOS LOS CRITERIOS'}</span>{aiMode&&<small>{aiMode}</small>}</div>}
          {plan.best?(
            <section className="other-destinations unified-candidates-list">
              <button className={'best-destination '+(selected?.id===plan.best.id?'selected':'')} onClick={()=>choose(plan.best!.id)}>
                <span className="destination-number">1</span>
                <div>
                  <strong>{num(Math.abs(plan.best.latitude_deg),2)}°S · {longitude(plan.best.longitude_deg,2)}</strong>
                  <small>{num(plan.best.sun_hours,0)} h de Sol · {num(plan.best.earth_hours,0)} h de Tierra · P95 {num(plan.best.regional_slope_deg,2)}°</small>
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
          ):null}
          <details className="coordinate-inspector"><summary>Consultar cualquier coordenada del polo sur</summary><form onSubmit={e=>{e.preventDefault();inspectCoordinates()}}><label>Latitud<input aria-label="Latitud a consultar" type="number" step="any" min={-90} max={-80} value={inspectLat} onChange={e=>setInspectLat(e.target.value)}/></label><label>Longitud<input aria-label="Longitud a consultar" type="number" step="any" min={-180} max={180} value={inspectLon} onChange={e=>setInspectLon(e.target.value)}/></label><button type="submit">Examinar área</button>{coordinateError&&<p role="alert">{coordinateError}</p>}</form></details>
          <details className="rejected-destinations"><summary>{num(rejectedTotal,0)} zonas descartadas · ver ejemplos</summary>{plan.rejected.map(p=><button key={p.id} onClick={()=>choose(p.id)}><span className="reject-dot"/><div><strong>{num(Math.abs(p.latitude_deg),2)}°S · {longitude(p.longitude_deg,2)}</strong><small>{p.reasons?.[0]??'No cumple los criterios'}</small></div></button>)}</details>
          {selected&&<OperationalWindowsPanel samples={series} index={timeline}/>}
          <button className="download-plan" onClick={exportPlan}><Download size={14}/> Descargar plan y evidencia</button>
          <p className="decision-scope">Los colores describen sectores regionales, con condiciones calculadas en sus centros. Una zona verde puede contener pendientes locales mayores. Falta evaluar rocas pequeñas, huella de la nave, energía, temperatura y enlace de radio.</p>
        </>}

        {/* 3. At the bottom of the right panel: TU ITINERARIO ESTIMADO + Ver datos y supuestos */}
        {plan&&<div className="trip-overview right-bottom-itinerary"><span className="micro-title">TU ITINERARIO ESTIMADO</span>
          <div className="itinerary-item"><span className="itinerary-dot"/><div><small>Salida de la Tierra</small><strong>{localDate(plan.mission.departure_utc)}</strong></div></div>
          <div className="itinerary-duration">↓ Ida estimada: {duration(plan.mission.outbound_hours)}</div>
          <div className="itinerary-item"><span className="itinerary-dot moon"/><div><small>Alunizaje analizado</small><strong>{localDate(plan.mission.arrival_utc)}</strong></div></div>
          <div className="itinerary-duration">Estancia: {duration(plan.mission.surface_hours)}</div>
          <div className="itinerary-item"><span className="itinerary-dot"/><div><small>Regreso estimado</small><strong>{localDate(plan.mission.return_utc)}</strong></div></div>
          <div className="total-trip"><span>Duración total estimada</span><strong>{duration(plan.mission.total_hours)}</strong></div>
          <p className="estimate-note">Estimación orbital simplificada desde una órbita terrestre de 200 km.</p>
        </div>}
        <button className="evidence-link" onClick={()=>setEvidence(true)}><Layers size={13}/> Ver datos y supuestos</button>
      </aside>}
    </div>
    {(help||evidence)&&<div className="mission-modal-backdrop" onClick={()=>{setHelp(false);setEvidence(false)}}><section className="mission-modal" role="dialog" aria-modal="true" aria-label={help?'Cómo se planifica tu misión':'Datos del plan de misión'} onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Escape'){setHelp(false);setEvidence(false)}}}><div className="modal-top"><h2>{help?'Escribe tu viaje. Nosotros calculamos.':'Los datos detrás de tu recomendación.'}</h2><button autoFocus aria-label="Cerrar información" onClick={()=>{setHelp(false);setEvidence(false)}}><X size={17}/></button></div>
      {help?<><p>Escribe la fecha y hora de salida y pulsa <strong>Planificar mi misión</strong>. Gemini interpreta tu petición; el motor científico consulta NASA y compara el polo sur automáticamente. Si la fecha no produce candidatos favorables, busca automáticamente otras fechas manteniendo los requisitos y te permite comparar antes de aplicar.</p><p>Puedes adjuntar un perfil JSON o metadatos glTF y comparar parámetros hipotéticos del vehículo. El catálogo no constituye una ficha técnica verificada. Una altura nueva requiere un horizonte calculado para esa altura; sin él, la visibilidad queda desconocida.</p><p>La evaluación cubre todo el polo sur visible. Verde indica sectores favorables en el modelo, amarillo indica sensibilidad al muestreo, rojo indica que no cumplen los criterios y gris indica datos insuficientes. Haz clic en cualquier área para consultar su pendiente, Sol, Tierra y motivos. La estrella destaca el mejor centro candidato; los colores no certifican cada punto de un sector.</p><p>Si dices «alunizar el…», esa fecha se interpreta como llegada. Si dices «viajar el…», se interpreta como salida. La hora se muestra respecto a tu zona horaria local ({localTimeZoneLabel()}).</p><p>La ida y vuelta usan una estimación orbital simplificada. La estancia se declara como supuesto editable. Una misión real requiere diseñar la trayectoria, la nave y sus operaciones.</p></>:<><p>{plan?'Datos del cálculo actual:':'Escribe y calcula una misión para obtener las consultas y mediciones de tu caso.'}</p>{(rescueReport||adopted)&&<details open><summary>Evidencia de la búsqueda de alternativas</summary><p>Se proponen cambios de fecha conservando las restricciones. El resultado sólo cubre los escenarios examinados.</p><pre>{JSON.stringify(rescueReport??adopted,null,2)}</pre></details>}<ul>{assumptions.map(a=><li key={a}>{a}</li>)}{plan?.mission.assumptions?.map(a=><li key={a}>{a}</li>)}</ul><p>Terreno: NASA LOLA de 80 m. Comparación regional por sectores de 4,75 km y perfiles de horizonte propios por centro. Los intervalos amarillo/verde comparan los azimuts vecinos del horizonte; no representan toda la incertidumbre del terreno. Los sectores del borde sin mediciones se conservan en gris. Las superficies se calculan sobre la esfera lunar y se recortan al casquete 80–90°S.</p><ul>{plan?.meta.limitations.map(note=><li key={note}>{note}</li>)}</ul><details><summary>Consultas y procedencia completas</summary><pre>{JSON.stringify(plan?.meta.sources??[],null,2)}</pre></details>{plan&&<button className="download-plan" onClick={exportPlan}><Download size={14}/> Descargar evidencia completa</button>}</>}
    </section></div>}
  </div>
}
