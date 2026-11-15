import {compactPhysicsEvidence} from './EngineeringPanel'
import MissionVisibilityPanel from './MissionVisibilityPanel'
import {useI18n} from '../../i18n/LanguageContext'
import {assessVisibility} from '../../../worker/visibility.mjs'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Bot, Check, CircleHelp, Compass, Cpu, Download, Globe2, Layers, LoaderCircle, MapPin, Maximize2, Minimize2, Orbit, PanelBottom, PanelLeft, PanelRight, Pause, Play, Plus, Rocket, Send, Settings2, Sun, X } from 'lucide-react'

import { Tactical3DScene,type PlanMapMarker } from '../tactical/Tactical3DScene'
import LunarObject3DViewer from '../tactical/LunarObject3DViewer'
import { loadAtlas,type AtlasData } from '../sites/atlasGeometry'
import { loadDetailTile } from '../sites/lunarDetail'
import { validatePolarSurface, type PolarSurface } from '../tactical/polarScience'
import { DEFAULT_DESCENT,descentAt,simulateDescent,type DescentRun } from './descentPhysics'
import type { RaycastHit } from '../tactical/tacticalMath'
import type { AutomaticPlan,LanderReview,MissionIntent,MissionPoint,VehicleProfile } from './automaticTypes'
import SurfaceCoverageSummary,{SURFACE_CLASS_LABELS} from './SurfaceCoverageSummary'
import MissionRescuePanel from './MissionRescuePanel'
import OperationalWindowsPanel from './OperationalWindowsPanel'
import MissionOperationsPanel,{type OperationsCommand} from './MissionOperationsPanel'
import MissionDecisionBrief from './MissionDecisionBrief'
import type {OperationsReport} from './operationsTypes'
import {resolveMissionCommand,validateOperationPatch,type MissionCommand} from '../../../worker/mission-command.mjs'
import {LAUNCH_SITES,wallTime,wallToUtc,formatMissionDate} from '../../../worker/timezones.mjs'
import type {PlanRequest} from './rescueTypes'
import type {AdoptedAlternative,RescueReport,RescueProposal} from './rescueTypes'
import './unified-mission.css'

const EXAMPLE='Quiero hacer un viaje el 25 de diciembre de 2026 a las 8 am. ¿Dónde sería mejor alunizar y cuánto tardaría la misión?'

function FriendlyBotIcon({size=54}:{size?:number}){
  return (
    <svg width={size} height={size} viewBox="0 0 54 54" fill="none" xmlns="http://www.w3.org/2000/svg" className="copilot-robot-avatar" aria-hidden="true">
      <defs>
        <filter id="robot-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>
      {/* Antenna */}
      <circle cx="27" cy="7.5" r="3.5" fill="#94edbb" filter="url(#robot-glow)" />
      <line x1="27" y1="11" x2="27" y2="18" stroke="#94edbb" strokeWidth="2.5" strokeLinecap="round" />
      {/* Ear nodes */}
      <rect x="6.5" y="24" width="4" height="10" rx="2" fill="#52708a" />
      <rect x="43.5" y="24" width="4" height="10" rx="2" fill="#52708a" />
      {/* Round head */}
      <rect x="9.5" y="16" width="35" height="27" rx="13.5" fill="#131d27" stroke="#3d556c" strokeWidth="2.2" />
      {/* Visor display */}
      <rect x="14.5" y="22" width="25" height="13" rx="6.5" fill="#091118" stroke="#223647" strokeWidth="1.2" />
      {/* Glowing round eyes */}
      <circle cx="21.5" cy="28.5" r="2.8" fill="#94edbb" filter="url(#robot-glow)" />
      <circle cx="32.5" cy="28.5" r="2.8" fill="#94edbb" filter="url(#robot-glow)" />
      {/* Little smile */}
      <path d="M24 37 Q27 39.5 30 37" stroke="#6b88a3" strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </svg>
  )
}

const CATALOG_EXAMPLES:Record<string,VehicleProfile>={
  blue_moon:{
    lander_name:'Blue Moon MK2',
    solar_panel_height:15,
    antenna_height:12,
    center_of_gravity_tolerance:10,
    category:'Lander Tripulado HLS',
    description:'Lander tripulado Blue Moon MK2 para el programa Artemis de NASA.'
  },
  starship:{
    lander_name:'Starship HLS',
    solar_panel_height:50,
    antenna_height:38,
    center_of_gravity_tolerance:10,
    category:'Lander Tripulado HLS',
    description:'Aterrizador lunar Starship HLS de SpaceX para misiones tripuladas Artemis.'
  },
  alpaca:{
    lander_name:'Dynetics ALPACA',
    solar_panel_height:6,
    antenna_height:8,
    center_of_gravity_tolerance:12,
    category:'Lander Tripulado HLS',
    description:'Sistema de aterrizaje Dynetics ALPACA con cabina baja y tanques laterales.'
  },
  griffin:{
    lander_name:'Griffin Lander (Astrobotic)',
    solar_panel_height:4.5,
    antenna_height:4,
    center_of_gravity_tolerance:10,
    category:'Lander de Carga CLPS',
    description:'Módulo de alunizaje pesado Griffin de Astrobotic para transporte de rovers.'
  },
  nova_c:{
    lander_name:'Nova-C IM-2 (Intuitive Machines)',
    solar_panel_height:4,
    antenna_height:3.5,
    center_of_gravity_tolerance:9,
    category:'Lander Comercial CLPS',
    description:'Aterrizador comercial CLPS Nova-C para cargas científicas y tecnológicas.'
  },
  blue_ghost:{
    lander_name:'Blue Ghost (Firefly)',
    solar_panel_height:3.2,
    antenna_height:3.5,
    center_of_gravity_tolerance:11,
    category:'Lander Comercial CLPS',
    description:'Aterrizador lunar CLPS Blue Ghost de Firefly Aerospace para exploración polar.'
  },
  ltv_rover:{
    lander_name:'Lunar Terrain Vehicle (LTV)',
    solar_panel_height:2.5,
    antenna_height:3,
    center_of_gravity_tolerance:15,
    category:'Rover y Movilidad',
    is_rover:true,
    speed_km_h:2.5,
    nominal_range_km:15.0,
    description:'Rover de exploración tripulado no presurizado; radio de acción nominal de 15 km a 2.5 km/h.'
  },
  lunar_cruiser:{
    lander_name:'Rover Presurizado (JAXA/Toyota)',
    solar_panel_height:5,
    antenna_height:5.5,
    center_of_gravity_tolerance:12,
    category:'Rover y Movilidad',
    is_rover:true,
    speed_km_h:5.0,
    nominal_range_km:25.0,
    description:'Rover presurizado de largo alcance; autonomía de 25 km a 5 km/h con cabina cerrada.'
  },
  viper:{
    lander_name:'Rover VIPER (NASA)',
    solar_panel_height:2.5,
    antenna_height:2.8,
    center_of_gravity_tolerance:14,
    category:'Rover y Movilidad',
    is_rover:true,
    speed_km_h:1.5,
    nominal_range_km:10.0,
    description:'Rover robótico prospector de hielo en cráteres y PSRs; radio nominal de 10 km a 1.5 km/h.'
  },
  artemis_habitat:{
    lander_name:'Hábitat Base Artemis (SHH)',
    solar_panel_height:18,
    antenna_height:16,
    center_of_gravity_tolerance:8,
    category:'Infraestructura Polar',
    description:'Hábitat de superficie presurizado para estancia prolongada de astronautas.'
  },
  vsat_tower:{
    lander_name:'Torre Solar Vertical (NASA VSAT)',
    solar_panel_height:32,
    antenna_height:24,
    center_of_gravity_tolerance:9,
    category:'Infraestructura Polar',
    description:'Torre vertical desplegable con paneles solares de alta elevación para captación continua.'
  }
}


export const LUNAR_OBJECTS:Record<string,VehicleProfile>={
  reference:{lander_name:'Referencia regional · 2 m',solar_panel_height:2,antenna_height:2,center_of_gravity_tolerance:10,category:'Referencia del modelo',description:'Observador de 2 m con perfiles de horizonte preparados. No representa una nave real.'},
  ...Object.fromEntries(Object.entries(CATALOG_EXAMPLES).map(([key,value])=>[key,{...value,category:value.category,description:value.description+' Parámetros hipotéticos editables; no son especificaciones verificadas del fabricante.'}]))
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

function formatInlineMarkdown(raw:string):string{
  const safe=raw
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
  return safe
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+?)\*/g,'$1<em>$2</em>')
    .replace(/`([^`]+)`/g,'<code>$1</code>')
}

function renderMarkdown(text:string){
  const paragraphs=text.split(/\n\s*\n/)
  return paragraphs.map((para,pIdx)=>{
    const lines=para.split('\n').map(l=>l.trim()).filter(Boolean)
    const isList=lines.length>0&&lines.every(l=>/^[*•-]\s+/.test(l))
    if(isList){
      return (
        <ul key={pIdx} className="chat-md-list">
          {lines.map((item,i)=>(
            <li key={i} dangerouslySetInnerHTML={{__html:formatInlineMarkdown(item.replace(/^[*•-]\s+/,''))}}/>
          ))}
        </ul>
      )
    }
    if(para.startsWith('### ')){
      return <h4 key={pIdx} className="chat-md-h4" dangerouslySetInnerHTML={{__html:formatInlineMarkdown(para.replace(/^###\s+/,''))}}/>
    }
    if(para.startsWith('## ')){
      return <h3 key={pIdx} className="chat-md-h3" dangerouslySetInnerHTML={{__html:formatInlineMarkdown(para.replace(/^##\s+/,''))}}/>
    }
    const html=lines.map(l=>formatInlineMarkdown(l)).join('<br/>')
    return <p key={pIdx} className="chat-md-p" dangerouslySetInnerHTML={{__html:html}}/>
  })
}

type ChatTurn={
  sourceMode?:'ai'|'guide'
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
const duration=(hours:number)=>{if(!Number.isFinite(hours))return '—';const rounded=Math.round(hours),d=Math.floor(rounded/24),h=rounded%24;return d?d+' d'+(h?' '+h+' h':''):h+' h'}


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
  const [launchSiteId,setLaunchSiteId]=useState('ksc-39b'),[clockMode,setClockMode]=useState('local')
  const launchSite=LAUNCH_SITES.find(site=>site.id===launchSiteId)??LAUNCH_SITES[0]
  const TIMEZONE=clockMode==='UTC'?'UTC':launchSite.timezone
  const localDate=(utc:string)=>Number.isFinite(Date.parse(utc))?formatMissionDate(utc,TIMEZONE,lang):'—'
  const operationsEvidence=useRef<unknown>(null)
  const USER_TIMEZONE=TIMEZONE
  const localTimeZoneLabel=()=>TIMEZONE
  const [missionText,setMissionText]=useState(''),[pendingText,setPendingText]=useState(''),[pendingCommandText,setPendingCommandText]=useState('')
  const [operationsCommand,setOperationsCommand]=useState<OperationsCommand|null>(null)
  const [operationsSnapshot,setOperationsSnapshot]=useState<(OperationsReport&{repair?:{status:string;proposals:unknown[]}})|null>(null)
  const commandCounter=useRef(0),lastOpsSummary=useRef('')
  const {language:lang,setLanguage,tr,number:num,fetch}=useI18n()
  const longitude=(value:number,digits=2)=>num(Math.abs(value),digits)+'°'+(value<0?(lang==='en'?'W':'O'):'E')
  const t=STRINGS[lang]

  const [atlas,setAtlas]=useState<AtlasData|null>(null),[polar,setPolar]=useState<PolarSurface|null>(null)
  const [loadError,setLoadError]=useState(''),[retry,setRetry]=useState(0)
  const [message,setMessage]=useState(''),[sentHistory,setSentHistory]=useState<string[]>([]),[historyIndex,setHistoryIndex]=useState<number>(-1),[intent,setIntent]=useState<MissionIntent|null>(null),[assumptions,setAssumptions]=useState<string[]>([])
  const [pinnedTarget,setPinnedTarget]=useState<{lat:number;lon:number;id:string;elevation_m?:number|null;regional_slope_deg?:number|null;label?:string}|null>(null)
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
  const [visibilityModalTarget,setVisibilityModalTarget]=useState<'sun'|'earth'|null>(null)
  const [viewMode,setViewMode]=useState<'map'|'vehicle'>('map')
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
  const currentSunVisibility=assessVisibility(current?.sun_elevation_deg,current?.sun_horizon_deg)
  const currentEarthVisibility=assessVisibility(current?.earth_elevation_deg,current?.earth_horizon_deg)
  const currentSunOk=currentSunVisibility.meets_margin===true
  const currentEarthOk=currentEarthVisibility.meets_margin===true
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
      const sBad=assessVisibility(series[i].sun_elevation_deg,series[i].sun_horizon_deg).meets_margin!==true,eBad=assessVisibility(series[i].earth_elevation_deg,series[i].earth_horizon_deg).meets_margin!==true
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
    const isSun=(s:typeof series[number])=>assessVisibility(s.sun_elevation_deg,s.sun_horizon_deg).meets_margin===true
    const isEarth=(s:typeof series[number])=>assessVisibility(s.earth_elevation_deg,s.earth_horizon_deg).meets_margin===true
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
        if(!ac.signal.aborted){setRescueReport(data);if(data.status==='found'&&data.proposals[0])appendChatTurn('assistant','El motor científico encontró '+data.proposals.length+' alternativas entre las fechas examinadas. La opción de menor retraso comprobado propone '+(data.proposals[0].proposed_request.date_kind==='landing'?'alunizar':'salir')+' el '+localDate(data.proposals[0].proposed_request.departure_utc)+' ('+TIMEZONE+'), manteniendo la estancia y tus requisitos. Revisa las propuestas calculadas antes de aplicar una fecha.');if(data.status==='found'&&window.innerWidth<=900)setTimeout(()=>{if(!ac.signal.aborted)document.querySelector('.mission-rescue')?.scrollIntoView({behavior:'smooth',block:'start'})},100)}
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

  function appendChatTurn(role:'user'|'assistant',text:string,turnVehicle?:VehicleProfile,sourceMode?:'ai'|'guide'){
    const now=new Date().toLocaleTimeString('es',{timeZone:USER_TIMEZONE,hour:'2-digit',minute:'2-digit',hour12:false})
    setChatTurns(prev=>[...prev.slice(-18),{id:`${Date.now()}-${Math.random()}`,role,text,vehicle:turnVehicle,timestamp:now,sourceMode}])
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

  function receiveOperationsEvidence(value:unknown){
    operationsEvidence.current=value
    const report=value as (OperationsReport&{repair?:{status:string;proposals:unknown[]}})|null
    setOperationsSnapshot(report)
    if(!report||!operationsCommand?.patch||report.affected.request.departure_utc!==operationsCommand.expected_utc)return
    const expected=operationsCommand.patch,actual=report.affected.budget
    if(Object.entries(expected.energy??{}).some(([k,v])=>actual.config[k as keyof typeof actual.config]!==v)||Object.entries(expected.fault??{}).some(([k,v])=>actual.fault[k as keyof typeof actual.fault]!==v))return
    const key=String(operationsCommand.id)+':'+report.affected.request.departure_utc
    if(lastOpsSummary.current===key)return
    lastOpsSummary.current=key
    const s=actual.summary
    appendChatTurn('assistant',actual.status==='unknown'?'El estudio sigue sin resolver porque faltan datos del destino. No se ha supuesto una batería disponible.':
      'Cálculo actualizado: batería mínima '+num(s.minimum_soc==null?null:s.minimum_soc*100,1)+' %; ciencia completada '+num(s.science_completed_hours,2)+' de '+num(s.science_required_hours,2)+' h. '+(actual.feasible?'El presupuesto cumple los requisitos eléctricos y de datos declarados.':'El presupuesto necesita ajustes; busco alternativas conservando tus requisitos.')+' El terreno se comprueba por separado.')
  }
  function dispatchOperation(command:OperationsCommand){
    operationsEvidence.current=null;setOperationsSnapshot(null);setOperationsCommand(command)
  }
  async function submitMessage(text=message){
    const original=text.trim()
    if(!original||busy||!atlas||!polar)return
    setSentHistory(previous=>[original,...previous.filter(item=>item!==original)].slice(0,50));setHistoryIndex(-1);setMessage('');setError('')
    const context={mission:intent,pending_text:pendingText,pending_command_text:pendingCommandText,timezone:TIMEZONE,defaults:{surface_hours:Number(stay),max_slope_deg:slope,min_sun_hours:sunHours,min_earth_hours:earthHours}}
    let command:MissionCommand
    try{command=resolveMissionCommand(original,context)}catch(e){appendChatTurn('user',original,vehicle);appendChatTurn('assistant',e instanceof Error?e.message:'No se ha aplicado el cambio.');return}
    if(command.kind==='unresolved'){
      appendChatTurn('user',original,vehicle)
      request.current?.abort();const ac=new AbortController(),id=++requestId.current;request.current=ac;setBusy('intent');startClock.current=performance.now();setElapsed(0)
      try{
        const response=await fetch('/api/copilot/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:original,context:{has_mission:Boolean(intent),timezone:TIMEZONE}}),signal:ac.signal})
        const data=await response.json();if(ac.signal.aborted||id!==requestId.current)return
        if(!response.ok||data.needs_clarification||typeof data.normalized_message!=='string'){appendChatTurn('assistant',data.question??'Indica el cambio con su valor y unidad. Tu misión se conserva.');return}
        command=resolveMissionCommand(data.normalized_message,context)
        if(['question','unresolved','clarify'].includes(command.kind)){appendChatTurn('assistant',command.question??'Todavía falta precisar el cambio. Por ejemplo: «batería de 1000 Wh».');return}
      }catch(e){if(!ac.signal.aborted)appendChatTurn('assistant','No pude precisar esa orden. Indica el parámetro, su valor y unidad; la misión se conserva.');return}
      finally{if(!ac.signal.aborted&&id===requestId.current)setBusy(null)}
      await executeCommand(command,original,true);return
    }
    await executeCommand(command,original)
  }
  async function executeCommand(command:MissionCommand,original:string,userAlreadyShown=false){
    const showUser=()=>{if(!userAlreadyShown)appendChatTurn('user',original,vehicle)}
    if(command.kind==='question'){
      if(plan&&selected||pinnedTarget){await askMissionQA(original);return}
      showUser();appendChatTurn('assistant','Puedo planificar una misión, comparar fechas y evaluar batería, fallos y terreno con NASA. Escribe una fecha de salida, por ejemplo «1 de diciembre de 2026 a las 10 am». Se usará el centro espacial seleccionado.');return
    }
    if(command.kind==='clarify'){setPendingCommandText(original);showUser();appendChatTurn('assistant',command.question??'Indica el dato que falta. No he cambiado la misión.');return}
    if(command.kind==='plan'){
      setPendingCommandText('');showUser()
      try{
        if(command.operations){const patch=validateOperationPatch(command.operations);const utc=command.parsed?.departure_utc;if(!utc)throw new Error('No hay fecha suficiente para aplicar el cambio.');dispatchOperation({id:++commandCounter.current,expected_utc:utc,patch})}
        if(command.context_used&&command.changes?.length)appendChatTurn('assistant',command.changes.join(' · ')+'. Recalculo el escenario y conservo los demás requisitos.')
        await calculate(command.message??original,command.context_used&&command.parsed?command.parsed:undefined,undefined,true)
      }catch(e){appendChatTurn('assistant',e instanceof Error?e.message:'No se ha aplicado el cambio.')}
      return
    }
    showUser()
    if(command.kind==='cancel'){request.current?.abort();requestId.current++;setBusy(null);cancelRescue();if(intent)dispatchOperation({id:++commandCounter.current,expected_utc:intent.departure_utc,action:'cancel'});appendChatTurn('assistant','Cálculos detenidos. No se ha aplicado otra fecha ni otro destino.');return}
    if(!intent||!plan){appendChatTurn('assistant','Primero indica la fecha y hora de tu misión; después evaluaré ese cambio.');return}
    if(command.kind==='operations'){
      setPendingCommandText('')
      try{const patch=validateOperationPatch(command.operations);appendChatTurn('assistant',(command.changes??[]).join(' · ')+'. Conservo fecha, estancia y los demás límites.');dispatchOperation({id:++commandCounter.current,expected_utc:intent.departure_utc,patch})}catch(e){appendChatTurn('assistant',e instanceof Error?e.message:'No se ha aplicado el cambio.')}
    }
    if(command.kind==='search'){
      if(!plan.best){setRescueAttempt(a=>a+1);appendChatTurn('assistant','Busco otras fechas con los mismos requisitos y datos NASA.')}else dispatchOperation({id:++commandCounter.current,expected_utc:intent.departure_utc,action:'search'})
    }
    if(command.kind==='inspect')dispatchOperation({id:++commandCounter.current,expected_utc:intent.departure_utc,action:'inspect'})
    if(command.kind==='apply_proposal'){
      const index=command.index??0
      if(rescueReport?.status==='found'&&!plan.best){const proposal=rescueReport.proposals[index];if(proposal)applyAlternative(proposal);else appendChatTurn('assistant','No existe una alternativa calculada con ese número.')}
      else dispatchOperation({id:++commandCounter.current,expected_utc:intent.departure_utc,action:'apply_proposal',index})
    }
  }
  function compactOperationsEvidence(){
    const value=operationsEvidence.current as {engineering?:unknown;affected?:{cell:unknown;budget:{status:string;feasible:boolean;summary:unknown};planning_constraints:unknown;horizon:unknown};local_study?:{source_resolution_m:number;center_footprint:unknown;footprint_resolved:boolean}}|null
    return value?.affected?{engineering:compactPhysicsEvidence(value.engineering),scope:'Estudio operativo local, distinto del cribado regional',cell:value.affected.cell,status:value.affected.budget.status,feasible:value.affected.budget.feasible,summary:value.affected.budget.summary,planning_constraints:value.affected.planning_constraints,local_terrain:value.local_study?{resolution_m:value.local_study.source_resolution_m,center_footprint:value.local_study.center_footprint,footprint_resolved:value.local_study.footprint_resolved}:null}:null
  }
  async function askMissionQA(question:string){
    if(!plan&&!pinnedTarget)return
    request.current?.abort();const ac=new AbortController(),id=++requestId.current;request.current=ac
    appendChatTurn('user',question,vehicle)
    setBusy('intent');setElapsed(0);startClock.current=performance.now()
    const activeVeh=plan?.vehicle_profile??vehicle
    try{
      const res=await fetch('/api/copilot/chat',{
        method:'POST',signal:ac.signal,
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          message:question,
          context:{
            operations:compactOperationsEvidence(),
            visibility:current?{
              t_utc:current.t_utc,
              sun:{elevation_deg:current.sun_elevation_deg,horizon_deg:current.sun_horizon_deg,azimuth_deg:current.sun_azimuth_deg,observer_height_m:vehicle.solar_panel_height},
              earth:{elevation_deg:current.earth_elevation_deg,horizon_deg:current.earth_horizon_deg,azimuth_deg:current.earth_azimuth_deg,observer_height_m:vehicle.antenna_height}
            }:null,
            launch_site:launchSite,
            mission_time_zone:TIMEZONE,
            history:chatTurns.slice(-6).map(t=>({
              role:t.role,
              text:t.text
            })),
            vehicle:{
              lander_name:activeVeh.lander_name,
              solar_panel_height:activeVeh.solar_panel_height,
              antenna_height:activeVeh.antenna_height,
              center_of_gravity_tolerance:activeVeh.center_of_gravity_tolerance
            },
            pinned_target:pinnedTarget?{
              id:pinnedTarget.id,
              label:pinnedTarget.label,
              lat:pinnedTarget.lat,
              lon:pinnedTarget.lon,
              elevation_m:pinnedTarget.elevation_m,
              slopeDeg:pinnedTarget.regional_slope_deg
            }:null,
            counts:plan?.counts,
            best:plan?.best?{
              id:plan.best.id,
              lat:plan.best.latitude_deg,
              lon:plan.best.longitude_deg,
              slopeDeg:plan.best.regional_slope_deg,
              sunHours:plan.best.sun_hours,
              earthHours:plan.best.earth_hours
            }:null,
            selected:selected?{
              id:selected.id,
              name:`Sector ${selected.id.replace('polar:','')}`,
              lat:selected.latitude_deg,
              lon:selected.longitude_deg,
              slopeDeg:selected.regional_slope_deg,
              resolutionM:80,
              coverage:'regional',
              sunHours:selected.sun_hours,
              earthHours:selected.earth_hours
            }:(pinnedTarget?{
              id:pinnedTarget.id,
              name:`Lugar fijado ${pinnedTarget.label}`,
              lat:pinnedTarget.lat,
              lon:pinnedTarget.lon,
              slopeDeg:pinnedTarget.regional_slope_deg??null,
              resolutionM:80,
              coverage:'regional',
              sunHours:null,
              earthHours:null
            }:null),
            regional:{
              scope:'Polo Sur Lunar (80°S — 90°S)',
              sourceResolutionM:80,
              totalCells:plan?.total_cells??null,
              knownCells:plan?.counts?((plan.counts.green??0)+(plan.counts.yellow??0)+(plan.counts.red??0)):null,
              evaluated:Boolean(plan)
            },
            simulation:selected?{
              status:selected.time_series?.length?'ready':'not_run',
              risk:selected.risk,
              reasons:selected.reasons??[],
              sunHours:selected.sun_hours,
              earthHours:selected.earth_hours
            }:{status:'not_run',risk:'unknown',reasons:[]},
            alternatives:plan?.alternatives?.slice(0,4).map(a=>({
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
      if(ac.signal.aborted||id!==requestId.current)return
      if(data.status==='ok'&&data.explanation){
        appendChatTurn('assistant',data.explanation,activeVeh,data.mode==='ai'?'ai':'guide')
        if(data.action?.type==='select_cell'&&data.action.target_id){
          choose(data.action.target_id)
        }
      }else{
        appendChatTurn('assistant',data.message||'No se pudo obtener respuesta del copiloto en este momento.')
      }
    }catch(e){
      if(!ac.signal.aborted)appendChatTurn('assistant',e instanceof Error?e.message:'Error al consultar al copiloto.')
    }finally{
      if(!ac.signal.aborted&&id===requestId.current)setBusy(null)
    }
  }

  function clearResult(){setAdopted(null);request.current?.abort();requestId.current++;setBusy(null);setPlan(null);setError('');setFlight(null);setFlying(false);setPlaying(false)}
  async function calculate(text=message,reuseIntent?:MissionIntent,overrideVehicle?:VehicleProfile,skipUserBubble=false,alternative?:AdoptedAlternative,preferredCellId?:string){
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
    setMissionText(text.trim()||missionText)
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
          setError('');setPendingText(text)
          appendChatTurn('assistant',qText)
          setBusy(null)
          return
        }
        parsed=data.intent
        if(!parsed?.departure_utc)throw new Error('La solicitud no contiene una fecha de viaje válida.')
        setAiMode(data.mode==='ai'?'Gemini interpretó tu viaje':'Fecha interpretada por el sistema')
        setAssumptions(data.assumptions??[])
      }
      if(ac.signal.aborted||id!==requestId.current)return
      if(reuseIntent){setAiMode('Escenario actualizado por el sistema');setAssumptions([])}
      setStay(String(parsed.surface_hours));setSlope(parsed.max_slope_deg);setSunHours(parsed.min_sun_hours);setEarthHours(parsed.min_earth_hours)
      setPendingText('');setIntent(parsed);setDepartureInput(wallTime(parsed.departure_utc,TIMEZONE));setBusy('science')

      const response=await fetch('/api/automatic-plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(missionRequest(parsed,activeVehicle)),signal:ac.signal})
      const data=await response.json()
      if(!response.ok||data.status!=='ok'||!data.coverage||!Array.isArray(data.cells))throw new Error(data.message??'NASA no pudo completar el análisis; no se inventará una recomendación.')
      if(ac.signal.aborted||id!==requestId.current)return
      setCoverageVisible(true);setHoveredId(null);document.querySelector('.mission-decisions')?.scrollTo({top:0});setPlan(data);setSelectedId(preferredCellId??pinnedTarget?.id??data.best?.id??data.closest_candidate?.id??(data.cells.some((point:MissionPoint)=>point.id===selectedId)?selectedId:data.cells.find((point:MissionPoint)=>point.latitude_deg< -89&&point.elevation_m!=null)?.id??''));setPreferences(false)
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
    const chosen={original_text:missionText||message,original:rescueReport.original_request,proposal,search:rescueReport.search,meta:rescueReport.meta}
    const request=proposal.proposed_request,date=new Date(request.departure_utc)
    const day=new Intl.DateTimeFormat(lang,{timeZone:TIMEZONE,day:'numeric',month:'long',year:'numeric'}).format(date)
    const clock=new Intl.DateTimeFormat(lang,{timeZone:TIMEZONE,hour:'2-digit',minute:'2-digit',hour12:false}).format(date)
    const updated='Quiero '+(request.date_kind==='landing'?'alunizar':'viajar')+' el '+day+' a las '+clock+' ('+TIMEZONE+') y estar '+request.surface_hours+' horas en la Luna. Pendiente máxima '+request.max_slope_deg+' grados; mínimo '+request.min_sun_hours+' horas de Sol y '+request.min_earth_hours+' horas de Tierra visible.'
    const local=wallTime(request.departure_utc,TIMEZONE)
    setMessage(updated)
    void calculate(updated,{...intent,...request,requested_utc:request.departure_utc,timezone:TIMEZONE,local_datetime:local},undefined,false,chosen)
  }
  function choose(id:string){if(!polarById.has(id))return;setSelectedId(id);setError('');setCoordinateError('')}
  function sampleMap(lat:number,lon:number){
    if(!polar||!Number.isFinite(lat)||!Number.isFinite(lon)||lat< -90||lat> -80||lon< -180||lon>180)return
    // Boundary fragments belong to the cap even when their grid center lies north of 80 S.
    const rho=2*polar.radius_m*Math.tan((90+lat)*Math.PI/360),x=rho*Math.sin(lon*Math.PI/180),y=rho*Math.cos(lon*Math.PI/180)
    const col=Math.floor((x-polar.grid.xmin)/polar.cell_spacing_m),row=Math.floor((polar.grid.ymax-y)/polar.cell_spacing_m)
    if(col<0||row<0||col>=polar.grid_size||row>=polar.grid_size)return
    const cell=polar.cells[row*polar.grid_size+col]
    if(!cell)return
    if(cell.latitude_deg> -80){
      setPinnedTarget({lat,lon,id:cell.id,elevation_m:null,regional_slope_deg:null,label:num(Math.abs(lat),3)+'°S, '+longitude(lon,3)})
      if(plan)choose(cell.id)
      appendChatTurn('assistant','La coordenada está en una franja del borde sin centro evaluado. Sus condiciones permanecen desconocidas; no se ha desplazado al interior ni declarado favorable.')
      return cell.id
    }
    const latStr=`${num(Math.abs(cell.latitude_deg),2)}°S`
    const lonStr=longitude(cell.longitude_deg,2)
    const pin={
      lat:cell.latitude_deg,
      lon:cell.longitude_deg,
      id:cell.id,
      elevation_m:cell.elevation_m,
      regional_slope_deg:cell.regional_slope_deg,
      label:`${latStr}, ${lonStr}`
    }
    setPinnedTarget(pin)
    appendChatTurn(
      'assistant',
      `**Lugar fijado en el mapa lunar:** ${latStr}, ${lonStr} (Sector \`${cell.id}\`)\n* **Elevación LOLA:** ${cell.elevation_m!=null?Math.round(cell.elevation_m)+' m':'Desconocida'}\n* **Pendiente regional:** ${cell.regional_slope_deg!=null?cell.regional_slope_deg.toFixed(1)+'°':'Desconocida'}\n\n*Escribe una fecha para evaluar este destino y comparar el polo sur. Las condiciones se calculan con datos NASA para ese escenario; fijar un punto no implica que sea apto.*`
    )
    if(plan&&polarById.has(cell.id)){
      choose(cell.id)
    }
    return cell.id
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
    const data={...plan,pinned_target:pinnedTarget,conversation:chatTurns.map(turn=>({role:turn.role,text:turn.text,timestamp:turn.timestamp})),launch_site:launchSite,display_timezone:TIMEZONE,operations:operationsEvidence.current,user_request:missionText||message,interpreted_intent:intent,interpretation_assumptions:assumptions,rescue_search:rescueReport,adopted_alternative:adopted,selected_id:selected?.id,exported_at:new Date().toISOString(),descent:flight?{configuration:flight.config,outcome:flight.outcome,impact_speed_mps:flight.impactSpeedMps}:null}
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a')
    a.href=url;a.download='lunar-oracle-plan-de-mision.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  function describeScenario(i:MissionIntent){
    return 'Quiero '+(i.date_kind==='landing'?'alunizar':'despegar')+' el '+i.departure_utc+' y estar '+i.surface_hours+' horas en la Luna. Pendiente máxima '+i.max_slope_deg+' grados; mínimo '+i.min_sun_hours+' horas de Sol y '+i.min_earth_hours+' horas de Tierra visible.'
  }
  function changeLaunchContext(id:string,mode:string){
    const site=LAUNCH_SITES.find(s=>s.id===id)??LAUNCH_SITES[0],zone=mode==='UTC'?'UTC':site.timezone
    setLaunchSiteId(id);setClockMode(mode)
    if(intent){setDepartureInput(wallTime(intent.departure_utc,zone));setMessage(describeScenario(intent))}
  }
  function recalculate(){
    if(!intent)return
    try{
      const next={...intent,departure_utc:wallToUtc(departureInput,TIMEZONE),timezone:TIMEZONE,local_datetime:departureInput,surface_hours:Number(stay),max_slope_deg:slope,min_sun_hours:sunHours,min_earth_hours:earthHours}
      const text=describeScenario(next);setMessage(text);void calculate(text,next)
    }catch(e){setError(e instanceof Error?e.message:'Revisa la fecha y hora.')}
  }
  function applyOperationalScenario(q:PlanRequest,cellId:string,label:string){
    if(!intent)return
    const next={...intent,...q,timezone:TIMEZONE,local_datetime:wallTime(q.departure_utc,TIMEZONE)}
    const text=describeScenario(next);setMessage(text);appendChatTurn('assistant','Aplicando propuesta verificada: '+label+'. Se vuelven a evaluar el mapa regional y el presupuesto operativo.')
    void calculate(text,next,undefined,false,undefined,cellId)

  }
  const ray=(el:number|undefined,h:number|undefined):RaycastHit=>el!==undefined&&h!==undefined?{hit:assessVisibility(el,h).state==='occluded',hitDistanceM:NaN,hitPositionWorld:null,obstacleElevationDeg:h,marginDeg:el-h}:unknownRay
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
    <header className="unified-header"><div className="unified-logo"><Orbit size={30}/><div>LUNAR ORACLE<small>{tr("PLANIFICA TU LLEGADA A LA LUNA")}</small></div></div><span className="unified-data-status"><i/> NASA LOLA + JPL HORIZONS</span><div className="language-picker" role="group" aria-label={tr("Language / Idioma")}><button type="button" lang="es" aria-pressed={lang==='es'} onClick={()=>setLanguage('es')}>Español</button><button type="button" lang="en" aria-pressed={lang==='en'} onClick={()=>setLanguage('en')}>English</button></div><button onClick={()=>setHelp(true)}><CircleHelp size={15}/>{" "}{tr("Cómo funciona")}</button></header>
    <div className={layoutClass}>
      {!hideLeftPanel&&<aside className="trip-panel chat-linked-panel">
        <div className="chat-panel-top">
          <div className="chat-panel-top-bar">
            <span className="sr-only">{tr("Copiloto de misión")}</span>
            <button
              type="button"
              className={'chat-settings-gear-btn'+(preferences?' active':'')}
              onClick={()=>setPreferences(v=>!v)}
              aria-label={tr(intent?'Cambiar fecha o requisitos':t.manualSettings)}
              aria-expanded={preferences}
              aria-controls="mission-manual-settings"
              aria-haspopup="dialog"
              title={tr(t.manualSettings)}
            >
              <Settings2 size={16}/>
            </button>
          </div>
        </div>

        {preferences&&(
          <div id="mission-manual-settings" className="chat-manual-modal" role="dialog" aria-label={tr("Ajustes y requisitos manuales")} onKeyDown={e=>{if(e.key==='Escape')setPreferences(false)}}>
            <div className="manual-modal-head">
              <strong>{tr(plan?'Cambiar fecha o requisitos':'Ajustes y Configuración de Misión')}</strong>
              <button type="button" autoFocus onClick={()=>setPreferences(false)} aria-label={tr("Cerrar ajustes")}><X size={15}/></button>
            </div>
            <div className="trip-preferences">
              <div className="launch-context" data-testid="launch-context">
                <label>{tr("Centro de lanzamiento")}{" "}<select aria-label={tr("Centro de lanzamiento")} value={launchSiteId} onChange={e=>changeLaunchContext(e.target.value,'local')}>
                    {LAUNCH_SITES.map(site=><option key={site.id} value={site.id}>{tr(site.name)}</option>)}
                  </select>
                </label>
                <label>{tr("Reloj de la misión")}{" "}<select aria-label={tr("Zona horaria de misión")} value={clockMode} onChange={e=>changeLaunchContext(launchSiteId,e.target.value)}>
                    <option value="local">{tr("Hora local del centro espacial")}</option>
                    <option value="UTC">{tr("UTC · tiempo universal")}</option>
                  </select>
                </label>
                <small>{tr(launchSite.use)} · {tr(TIMEZONE)}{tr(". Los instantes calculados se conservan al cambiar de reloj.")}{" "}<a href={launchSite.source_url} target="_blank" rel="noreferrer">{tr("Fuente NASA")}</a></small>
              </div>

              {intent&&<label>{tr(intent.date_kind==='landing'?'Fecha de alunizaje':'Fecha de salida')} · {tr(TIMEZONE)}<input aria-label={tr("Fecha de viaje")} type="datetime-local" value={departureInput} onChange={e=>{clearResult();setDepartureInput(e.target.value)}}/></label>}
              <label>{tr("Tiempo en la Luna")}<select aria-label={tr("Estancia en la Luna")} value={stay} onChange={e=>{clearResult();setStay(e.target.value)}}><option value="24">{tr("1 día · 24 h")}</option><option value="48">{tr("2 días · 48 h")}</option><option value="72">{tr("3 días · 72 h")}</option><option value="168">{tr("7 días · 168 h")}</option>{!['24','48','72','168'].includes(stay)&&<option value={stay}>{tr(stay)}{" "}{tr("horas")}</option>}</select></label>
              <label>{tr("Pendiente regional máxima · grados")}<input aria-label={tr("Pendiente máxima")} type="number" min={0} max={45} value={slope} onChange={e=>{clearResult();setSlope(Number(e.target.value))}}/></label>
              <label>{tr("Horas mínimas de Sol")}<input aria-label={tr("Horas mínimas de Sol")} type="number" min={0} max={Number(stay)} value={sunHours} onChange={e=>{clearResult();setSunHours(Number(e.target.value))}}/></label>
              <label>{tr("Horas mínimas de Tierra visible")}<input aria-label={tr("Horas mínimas de Tierra")} type="number" min={0} max={Number(stay)} value={earthHours} onChange={e=>{clearResult();setEarthHours(Number(e.target.value))}}/></label>
              <p>{tr("El viaje de ida y vuelta se estima por separado. La estancia no es la duración total. Los perfiles del catálogo son hipótesis editables, no fichas verificadas del fabricante.")}</p>{(error||loadError)&&<p className="trip-error" role="alert">{tr(error||loadError)}</p>}
              {intent&&<button type="button" onClick={()=>void recalculate()} disabled={Boolean(busy)}>{tr("Recalcular con estos cambios")}</button>}
            </div>
          </div>
        )}

        {/* Fluid Gemini-style Conversational Thread */}

        <div className="mission-chat-thread" aria-live="polite">
          <div className="chat-thread-hero">
            <div className="chat-hero-avatar-wrap">
              <FriendlyBotIcon size={54}/>
            </div>
            <span className="micro-title">{tr("COPILOTO DE MISIÓN")}</span>
            <h1 className="chat-hero-title">{tr("Dime cuándo y")}{" "}<em>{tr("encuentro dónde.")}</em></h1>
            {chatTurns.length===0&&!plan&&!busy&&(
              <div className="chat-hero-examples">
                <button type="button" className="example-trip" onClick={()=>{setMessage(tr(EXAMPLE));void calculate(tr(EXAMPLE))}} disabled={!atlas||!polar}>
                  {tr(t.exampleBtn)} <ArrowRight size={12}/>
                </button>
                <button type="button" className="example-trip hint-alt" onClick={()=>void submitMessage(tr('QUIERO HACER UN VIAJE EL 1DE DICIEMBREDE 2026 A LAS 10AM'))} disabled={!atlas||!polar}>
                  {tr('Planificar el 1 dic · 10:00')} <ArrowRight size={12}/>
                </button>
              </div>
            )}
          </div>

          {chatTurns.map((turn,turnIdx)=>{
            if(turn.role==='user'){
              return (
                <div key={turn.id} className="gemini-msg user">
                  <div className="user-pill">
                    <p>{turn.text}</p>
                    {turn.vehicle&&<small className="user-pill-meta">{tr(turn.vehicle.lander_name)} · {turn.vehicle.solar_panel_height}m / {turn.vehicle.antenna_height}m / {turn.vehicle.center_of_gravity_tolerance}°</small>}
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
                    <span>{tr("Explicación del mapa regional")}</span>
                    <small>{tr(rev.mode==='ai'?`IA · ${rev.model}`:'Guía con evidencia del modelo')} · {tr(turn.timestamp)}</small>
                  </div>
                  <div className="gemini-msg-content">
                    <p className="engineer-summary">{tr(rev.summary)}</p><small>{tr("Lectura del mapa regional. El estudio de misión recalcula energía y horizontes locales para las alturas declaradas.")}</small>
                    <details className="chat-scientific-detail"><summary>{tr("Ver mediciones y límites del sector")}</summary><p>{tr(rev.summary)}</p><p className="gemini-paragraph-muted"><strong>{tr("Diagnóstico:")}</strong> {tr(rev.risk_alert)}</p>
                    <div className="gemini-recommendations-list">
                      <p><strong>{tr("1. Sitio alternativo:")}</strong> {tr(rev.site_recommendation)}</p>
                      <p><strong>{tr("2. Hardware:")}</strong> {tr(rev.hardware_recommendation)}</p>
                    </div>
                    <div className="gemini-action-chips">
                      {alt&&alt.id!==selected?.id&&<button type="button" onClick={()=>{choose(alt.id);setFocus(true);appendChatTurn('user',`Cambiar al sector alternativo (${num(Math.abs(alt.latitude_deg),2)}°S, ${longitude(alt.longitude_deg,2)})`,vehicle)}}>{tr("Ir a")}{" "}{tr(num(Math.abs(alt.latitude_deg),2))}°S <ArrowRight size={11}/></button>}
                      <small>{tr("Comparar otras alturas requiere recalcular sus propios horizontes.")}</small>
                    </div></details>
                  </div>
                </div>
              )
            }
            return (
              <div key={turn.id} className="gemini-msg assistant">
                <div className="gemini-msg-head"><Bot size={15}/><span>{tr("Copiloto de misión")}</span><small>{tr(turn.timestamp)}{tr(turn.sourceMode==='guide'?' · Guía calculada':turn.sourceMode==='ai'?' · Gemini':'')}</small></div>
                <div className="gemini-msg-content">{renderMarkdown(tr(turn.text))}</div>
              </div>
            )
          })}

          {busy&&<div className="gemini-msg assistant">
            <div className="gemini-msg-head"><LoaderCircle size={15} className="spin"/><span>{tr("Copiloto de misión")}</span></div>
            <div className="gemini-msg-content">
              <div className="planning-progress" role="status">
                <span>{tr(busy==='intent'?'Interpretando tu viaje…':'Calculando horizontes NASA LOLA y efemérides JPL…')}</span>
                <div><Check size={13}/>{" "}{tr("Relieve polar ·")}{" "}{tr(vehicle.lander_name)} ({vehicle.solar_panel_height}m / {vehicle.antenna_height}m)</div>
                <small>{elapsed} s · <button type="button" className="inline-cancel" onClick={()=>{request.current?.abort();setBusy(null)}}>{tr("Cancelar")}</button></small>
              </div>
            </div>
          </div>}

          {plan&&reviewBusy&&!chatTurns.some(t=>Boolean(t.review))&&<div className="gemini-msg assistant" data-testid="gemini-engineer-card">
            <div className="gemini-msg-head">
              <Bot size={15}/>
              <span>{tr("Explicación del mapa regional")}</span>
              <small>{tr("Analizando…")}</small>
            </div>
            <div className="gemini-msg-content">
              <p className="loading-note">{tr("Evaluando geometría del vehículo sobre el terreno…")}</p>

            </div>
          </div>}
          <div ref={chatEndRef}/>
        </div>

        {!preferences&&(error||loadError)&&<div className="trip-error" role="alert">{tr(error||loadError)}{loadError&&<button onClick={()=>setRetry(r=>r+1)}>{tr("Reintentar datos")}</button>}</div>}
        {!atlas&&!loadError&&<p className="loading-note">{tr("Cargando el relieve lunar…")}</p>}

        {/* ChatGPT / Gemini style unified composer with single + (.json/.gltf) and Lunar Object Selector */}
        <form
          className={'chat-composer-box'+(composerDrag?' dragging':'')}
          onSubmit={e=>{e.preventDefault();void submitMessage()}}
          onDragOver={e=>{e.preventDefault();setComposerDrag(true)}}
          onDragLeave={()=>setComposerDrag(false)}
          onDrop={e=>{e.preventDefault();setComposerDrag(false);const f=e.dataTransfer.files?.[0];if(f)void handleProfileFile(f)}}
        >
          <input ref={fileInputRef} data-testid="vehicle-profile-upload" aria-label={tr("Importar perfil de nave o modelo GLTF")} type="file" accept=".json,.gltf" hidden onChange={e=>{const f=e.target.files?.[0];if(f)void handleProfileFile(f);e.target.value=''}}/>

          {/* Active Vehicle and Pinned Target Chips inside the composer box */}
          <div className="composer-attachment-bar">
            <div className="composer-active-chip" title={tr(vehicle.description??vehicle.lander_name)}>
              <Rocket size={12}/>
              <strong>{tr(vehicle.lander_name)}</strong>
              <span>{tr("Paneles")} {vehicle.solar_panel_height}{tr("m · Antena")}{" "}{vehicle.antenna_height}{tr("m · límite")}{" "}{vehicle.center_of_gravity_tolerance}°</span>
            </div>
            {pinnedTarget&&<div className="composer-active-chip pin-target-chip" title={tr("Lugar fijado en el mapa")}>
              <MapPin size={11} className="pin-icon"/>
              <strong>{tr(pinnedTarget.label)}</strong>
              <span>{tr("Elevación")}{" "}{pinnedTarget.elevation_m!=null?Math.round(pinnedTarget.elevation_m):'—'}{tr("m · Pendiente")}{" "}{tr(pinnedTarget.regional_slope_deg!=null?pinnedTarget.regional_slope_deg.toFixed(1)+'°':'—')}</span>
              <button type="button" onClick={()=>setPinnedTarget(null)} aria-label={tr("Quitar pin")} className="pin-remove-btn"><X size={11}/></button>
            </div>}
          </div>

          <label htmlFor="mission-request" className="sr-only-label">{tr("¿Qué misión quieres hacer?")}</label>
          <textarea
            id="mission-request"
            aria-label={tr("Describe tu misión")}
            value={message}
            onChange={e=>setMessage(e.target.value)}
            onKeyDown={e=>{
              if(e.key==='ArrowUp'){
                const isAtStart=e.currentTarget.selectionStart===0&&e.currentTarget.selectionEnd===0
                if(isAtStart&&sentHistory.length>0){
                  e.preventDefault()
                  const nextIdx=Math.min(historyIndex+1,sentHistory.length-1)
                  setHistoryIndex(nextIdx)
                  setMessage(sentHistory[nextIdx])
                }
                return
              }
              if(e.key==='ArrowDown'){
                if(historyIndex>0){
                  e.preventDefault()
                  const nextIdx=historyIndex-1
                  setHistoryIndex(nextIdx)
                  setMessage(sentHistory[nextIdx])
                }else if(historyIndex===0){
                  e.preventDefault()
                  setHistoryIndex(-1)
                  setMessage('')
                }
                return
              }
              if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();void submitMessage()}
            }}
            rows={3}
            maxLength={1600}
            placeholder={tr(t.placeholder)}
          />

          {/* Popover menu for all Lunar South Pole vehicles, rovers & habitats */}
          {catalogOpen&&<div className="lunar-catalog-popover" role="region" aria-label={tr("Objetos y vehículos para el Polo Sur Lunar")}>
            <div className="catalog-popover-head">
              <span><Compass size={12}/>{" "}{tr("OBJETOS Y ELEMENTOS · POLO SUR LUNAR")}</span>
              <button type="button" onClick={()=>setCatalogOpen(false)} aria-label={tr("Cerrar selector")}><X size={13}/></button>
            </div>
            <div className="catalog-popover-list">
              {groupedCatalog.map(([category,items])=>(
                <div key={category} className="catalog-group">
                  <small className="catalog-group-title">{tr(category)}</small>
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
                          <strong>{tr(item.lander_name)}</strong>
                          <span>{tr("Paneles")} {item.solar_panel_height}{tr("m · Antena")}{" "}{item.antenna_height}{tr("m")}{item.is_rover?` · ${tr("Radio")} ${item.nominal_range_km}km (${item.speed_km_h}km/h)`:''}{" "}{tr("· límite")}{" "}{item.center_of_gravity_tolerance}°</span>
                        </div>
                        <small>{tr(item.description)}</small>
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          </div>}

          {/* Bottom Toolbar inside the Chat Input Box — single horizontal line */}
          <div className="composer-toolbar">
            <div className="composer-tools-left">
              <button
                type="button"
                className="composer-icon-btn composer-plus-btn"
                onClick={()=>fileInputRef.current?.click()}
                title={tr("Añadir perfil de vehículo (.json o .gltf)")}
                aria-label={tr("Añadir archivo JSON o GLTF")}
              >
                <Plus size={16}/>
              </button>
              <button
                type="button"
                className={'composer-catalog-btn'+(viewMode==='vehicle'?' active':'')}
                onClick={()=>{
                  setViewMode('vehicle')
                  setCatalogOpen(false)
                  const el = document.querySelector('.lunar-object-studio-container') || document.querySelector('.one-map-heading')
                  el?.scrollIntoView({ behavior:'smooth', block:'start' })
                }}
                aria-expanded={viewMode==='vehicle'}
                title={tr("Visualizar vehículos y rovers lunares en 3D interactivo")}
              >
                <Cpu size={13}/>
                <span>{tr("Objetos Lunares")}</span>
              </button>
            </div>

            <button
              className="primary-plan composer-send-btn"
              type="submit"
              disabled={Boolean(busy)||!atlas||!polar}
              title={tr(busy?t.calculating:t.planBtn)}
              aria-label={tr(t.planBtn)}
            >
              {busy?<LoaderCircle className="spin" size={15}/>:<Send size={15}/>}
            </button>
          </div>
          {uploadNotice&&<small className="upload-notice">{tr(uploadNotice)}</small>}
        </form>
        {intent&&!busy&&<div className="mission-prompt-hints"><button type="button" onClick={()=>void submitMessage(tr('Busca alternativas conservando mis requisitos'))}>{tr("Buscar alternativas")}</button><button type="button" onClick={()=>{setMessage(tr('¿Qué pasa si mis paneles producen un 20% menos?'));document.querySelector<HTMLTextAreaElement>('#mission-request')?.focus()}}>{tr("Probar un fallo solar")}</button><button type="button" onClick={()=>void submitMessage(tr('Estudia la huella local del destino'))}>{tr("Estudiar huella")}</button></div>}
        {adopted&&<div className="adopted-alternative" data-testid="adopted-alternative"><Check size={14}/><div><strong>{tr("Alternativa aplicada")}</strong><span>{tr(adopted.original.date_kind==='landing'?'Alunizaje':'Salida')}{" "}{tr("original:")}{" "}{tr(localDate(adopted.original.departure_utc))}<br/>{tr("Nueva fecha:")}{" "}{tr(localDate(adopted.proposal.proposed_request.departure_utc))}</span><small>{tr("La solicitud original queda guardada en la comparación. La estancia y los requisitos no cambian.")}</small></div></div>}
      </aside>}


      <main className="one-moon-panel">
        <div className="one-map-heading">
          <div>
            <span className="micro-title">{tr("POLO SUR LUNAR · 80°S — 90°S")}</span>
            <h2>{tr(plan?'Toda la superficie. Una decisión informada.':'Una Luna. Todos los destinos.')}</h2>
            {(vehicle.is_rover||vehicle.category==='Rover y Movilidad')&&<span className="rover-range-indicator"><Compass size={12}/>{" "}{tr("Radio geométrico:")}{" "}<b>{vehicle.nominal_range_km??15} km</b>{" "}<small>({tr("no es una ruta validada")})</small></span>}
          </div>
          <div className="one-map-actions">
            <button
              type="button"
              onClick={()=>{setViewMode('map');setFocus(false);setFlight(null);setFlying(false);setCameraRevision(r=>r+1)}}
              aria-pressed={viewMode==='map'&&!focus}
            >
              {tr("Todo el polo")}
            </button>
            <button
              type="button"
              disabled={!selected||selected.latitude_deg> -80||selected.elevation_m==null}
              onClick={()=>{setViewMode('map');setFocus(true);setCameraRevision(r=>r+1)}}
              aria-pressed={viewMode==='map'&&focus}
            >
              {tr("Acercar destino")}
            </button>
            <button
              type="button"
              className="vehicle-3d-tab-btn"
              onClick={()=>setViewMode(v=>v==='vehicle'?'map':'vehicle')}
              aria-pressed={viewMode==='vehicle'}
              title={tr("Visualizar nave o rover en 3D con giro automático")}
            >
              <Orbit size={13}/>{" "}{tr("Vehículo 3D")}
            </button>
            <button
              type="button"
              disabled={!plan}
              onClick={()=>document.querySelector('.mission-operations')?.scrollIntoView({behavior:'smooth',block:'start'})}
            >
              {tr("Estudio de misión")}
            </button>
            <button
              type="button"
              onClick={()=>{setMapFullscreen(v=>!v);setTimeout(()=>setCameraRevision(r=>r+1),60)}}
              aria-pressed={mapFullscreen}
              title={tr(mapFullscreen?'Salir de pantalla grande (Esc)':'Ver vistazo de la Luna en pantalla grande')}
            >
              {mapFullscreen?<Minimize2 size={13}/>:<Maximize2 size={13}/>}
              {tr(mapFullscreen?'Salir de pantalla grande':'Pantalla grande')}
            </button>
            <div className="workspace-panel-toggles" role="group" aria-label={tr("Ocultar o mostrar paneles")}>
              <button
                type="button"
                className="panel-toggle-btn"
                aria-pressed={!hideLeftPanel&&!mapFullscreen}
                onClick={()=>{setMapFullscreen(false);setHideLeftPanel(v=>!v);setTimeout(()=>setCameraRevision(r=>r+1),60)}}
                title={tr(hideLeftPanel?'Mostrar panel de chat izquierdo':'Ocultar panel de chat izquierdo')}
                aria-label={tr("Alternar panel de chat")}
              >
                <PanelLeft size={14}/>
              </button>
              {plan&&<button
                type="button"
                className="panel-toggle-btn"
                aria-pressed={!hideTimelinePanel}
                onClick={()=>{setHideTimelinePanel(v=>!v);setTimeout(()=>setCameraRevision(r=>r+1),60)}}
                title={tr(hideTimelinePanel?'Mostrar línea de tiempo':'Ocultar línea de tiempo')}
                aria-label={tr("Alternar línea de tiempo")}
              >
                <PanelBottom size={14}/>
              </button>}
              <button
                type="button"
                className="panel-toggle-btn"
                aria-pressed={!hideRightPanel&&!mapFullscreen}
                onClick={()=>{setMapFullscreen(false);setHideRightPanel(v=>!v);setTimeout(()=>setCameraRevision(r=>r+1),60)}}
                title={tr(hideRightPanel?'Mostrar panel derecho':'Ocultar panel derecho')}
                aria-label={tr("Alternar panel derecho")}
              >
                <PanelRight size={14}/>
              </button>
            </div>
          </div>
        </div>
        {viewMode === 'vehicle' ? (
          <LunarObject3DViewer
            activeVehicle={vehicle}
            onSelectVehicle={applyVehicleProfile}
            onClose={() => setViewMode('map')}
          />
        ) : (
          <div className="one-moon-map" data-testid="mission-map">
            <Tactical3DScene latDeg={selected?.latitude_deg??pinnedTarget?.lat??-90} lonDeg={selected?.longitude_deg??pinnedTarget?.lon??0} observerHeightM={2} sunAzimuthDeg={current?.sun_azimuth_deg??0} sunElevationDeg={current?.sun_elevation_deg??0} earthAzimuthDeg={current?.earth_azimuth_deg??0} earthElevationDeg={current?.earth_elevation_deg??0} minSolarElevation={0} maxSlopeDeg={vehicle.center_of_gravity_tolerance} currentSlopeDeg={selected?.regional_slope_deg??pinnedTarget?.regional_slope_deg??NaN}
              atlasData={atlas} focusTerrainData={detail} scientificSurfaceElevationM={selected?.elevation_m} sunRaycast={ray(current?.sun_elevation_deg,current?.sun_horizon_deg)} earthRaycast={ray(current?.earth_elevation_deg,current?.earth_horizon_deg)} cameraView="polar" siteName={selected?`${vehicle.lander_name} · Destino`:pinnedTarget?`${pinnedTarget.label}`:'Polo sur'}
              overview focusZone={focus} onShadingStatus={setShadingStatus} cameraResetKey={cameraRevision+(focus?1:0)} missionMarkers={flight?[]:markers} onMarkerSelect={choose} polarSurface={polar} missionCoverage={coverageLayer} onCoverageSelect={choose} onCoverageHover={setHoveredId}
              onSurfacePlace={sampleMap} placementMode scienceReady={Boolean(current)} assessmentRisk={selected?.risk??'unknown'} showSurfaceVehicle={Boolean(flight)} altitudeM={telemetry?.altitudeM??0} landed={landed}
              solarPanelHeightM={vehicle.solar_panel_height} antennaHeightM={vehicle.antenna_height} landerName={vehicle.lander_name} vehiclePulseKey={vehiclePulseKey}
              pinnedTarget={pinnedTarget}
              traverseRadiusKm={vehicle.is_rover||vehicle.category==='Rover y Movilidad'?(vehicle.nominal_range_km??15):null}
              roverName={vehicle.lander_name} roverSpeed={vehicle.speed_km_h}/>
            <div className="one-map-source">
              {intent&&<div className="recognized-mission" data-testid="recognized-mission"><span>{tr("ESCENARIO ACTIVO")}</span><strong>{tr(intent.date_kind==='landing'?'Alunizaje':'Salida')} · {tr(localDate(intent.departure_utc))}</strong><small>{tr(TIMEZONE)} · {intent.surface_hours}{" "}{tr("h en superficie ·")}{" "}{tr(launchSite.name)}</small>{(pendingText||pendingCommandText)&&<small className="recognized-mission-pending">{tr("La última petición está pendiente de completar; este escenario se conserva.")}</small>}</div>}
              <div className="one-map-source-body">
                <span>{tr(plan&&coverageVisible&&!flight?'Evaluación de toda la superficie':'NASA LOLA · relieve continuo')}</span>
                <small>{tr(focus&&detail?'Detalle visual ~396 m · fuente 80 m':shadingStatus.includes('no disponible')?'Sombreado no disponible; relieve conservado':'Vista regional · fuente de 80 m')}{tr(visualStatus.includes('no disponible')?' · '+visualStatus:'')}</small>
                <small>{tr("Nave y astros en escala ilustrativa.")}</small>
              </div>
            </div>

            {/* Icon-only "Simular llegada a este destino" button inside the Moon map screen */}
            {plan&&selected&&<button
              type="button"
              className={'simulate-arrival map-simulate-icon-btn'+(flight?' active':'')}
              aria-label={tr("Simular llegada a este destino")}
              title={tr(isRejected||!plan.best?'Selecciona un candidato favorable para simular el descenso':'Simular llegada a este destino')}
              disabled={isRejected||!plan.best||cellLoading||Boolean(cellError)}
              onClick={runDescent}
            >
              <Rocket size={16}/>
            </button>}

            {!plan&&!pinnedTarget&&<div className="one-map-empty"><Orbit size={20}/><strong>{tr(busy?'Estamos calculando tus destinos.':'Escribe tu viaje o haz clic en la Luna para fijar un punto.')}</strong><span>{tr(busy?'La recomendación aparecerá aquí con sus alternativas.':'Haz clic en el mapa para fijar un destino y escribe la fecha que quieres evaluar.')}</span></div>}
            {!plan&&pinnedTarget&&<div className="surface-inspection-hint"><MapPin size={12}/><b>{tr("Lugar fijado:")}{" "}{tr(pinnedTarget.label)}</b><span>{tr("Elevación")}{" "}{tr(pinnedTarget.elevation_m!=null?Math.round(pinnedTarget.elevation_m)+' m':'—')}{" "}{tr("· Pendiente")}{" "}{tr(pinnedTarget.regional_slope_deg!=null?pinnedTarget.regional_slope_deg.toFixed(1)+'°':'—')}{" "}{tr("· Escribe una fecha para calcular sus condiciones")}</span></div>}
            {plan&&!flight&&<div className="surface-inspection-hint"><MapPin size={12}/>{hovered?<><b className={'risk-text '+hovered.risk}>{tr(SURFACE_CLASS_LABELS[hovered.risk])}</b><span>{tr(num(Math.abs(hovered.latitude_deg),2))}°S · {tr(longitude(hovered.longitude_deg))}{" "}{tr("· pendiente P95")}{" "}{tr(num(hovered.regional_slope_deg))}°</span></>:<span>{tr("Haz clic en cualquier área para ver sus mediciones y motivos.")}</span>}</div>}
          </div>
        )}
        {plan&&!hideTimelinePanel&&<SurfaceCoverageSummary plan={plan} active={coverageVisible} onToggle={()=>setCoverageVisible(v=>!v)} onEvidence={()=>setEvidence(true)}/>}
        {plan&&!hideTimelinePanel&&<div className="mission-conditions">
          <div className="conditions-heading">
            <strong><Globe2 size={14}/>{" "}{tr("Línea de tiempo unificada ·")}{" "}{tr(vehicle.lander_name)}</strong>
            <div className="conditions-legend-inline">
              <button type="button" className="legend-sun legend-pill-btn" onClick={()=>setVisibilityModalTarget('sun')} title={tr("Ver especificaciones de elevación y horizonte DEM del Sol")}>
                <Sun size={11}/>{" "}{tr("Sol (")}{vehicle.solar_panel_height}m): <b>{tr(num(selected?.sun_hours,0))}h</b>/{plan.mission.surface_hours}h
                <span className="pill-action">{tr("DEM >")}</span>
              </button>
              <button type="button" className="legend-earth legend-pill-btn" onClick={()=>setVisibilityModalTarget('earth')} title={tr("Ver especificaciones de elevación y horizonte DEM de la Tierra")}>
                <Globe2 size={11}/>{" "}{tr("Tierra (")}{vehicle.antenna_height}m): <b>{tr(num(selected?.earth_hours,0))}h</b>/{plan.mission.surface_hours}h
                <span className="pill-action">{tr("DEM >")}</span>
              </button>
              <time>{tr(current?localDate(current.t_utc):localDate(plan.mission.arrival_utc))} · {tr(localTimeZoneLabel())} ({tr(!current?'Datos no disponibles':currentBothOk?'Sol y Tierra visibles':!currentSunOk&&!currentEarthOk?'Sin despeje de Sol ni Tierra':!currentSunOk?'Sol sin despeje':'Tierra sin despeje')})</time>
            </div>

          </div>

          <div className="conditions-slider">
            <button aria-label={tr(playing?'Pausar condiciones':'Reproducir condiciones')} disabled={!series.length||flying} onClick={()=>{if(timeline===series.length-1)setTimeline(0);setPlaying(v=>!v)}}>{playing?<Pause size={14}/>:<Play size={14}/>}</button>
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
                      title={tr(pin.detail)}
                    >
                      <small>{tr(pin.label)}</small>
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
                  aria-label={tr("Hora de la estancia")}
                  type="range"
                  min={0}
                  max={Math.max(0,series.length-1)}
                  value={timeline}
                  disabled={!series.length||flying}
                  onChange={e=>{setPlaying(false);setTimeline(Number(e.target.value))}}
                />
              </div>}
              {!chartGeometry&&<input
                aria-label={tr("Hora de la estancia")}
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
                  <span className="bar-label sun-label"><Sun size={11}/>{" "}{tr("Sol (")}{vehicle.solar_panel_height}m)</span>
                  <div className="bar-segments">
                    {series.slice(0,-1).map((s,idx)=>{
                      const ok=assessVisibility(s.sun_elevation_deg,s.sun_horizon_deg).meets_margin===true
                      return <span
                        key={idx}
                        className={'seg '+(ok?'sun-ok':'off')+(idx===timeline?' active':'')}
                        onClick={()=>{setPlaying(false);setTimeline(idx)}}
                        title={tr(`Intervalo +${idx} a +${idx+1} h · Sol al inicio: ${ok?'Iluminado':'Sombra'} (${num(s.sun_elevation_deg-s.sun_horizon_deg,2)}°)`)}
                      />
                    })}
                  </div>
                  <small className="bar-summary"><b>{tr(num(selected?.sun_hours,0))}h</b>/{plan.mission.surface_hours}h</small>
                </div>
                <div className="status-bar-row">
                  <span className="bar-label earth-label"><Globe2 size={11}/>{" "}{tr("Tierra (")}{vehicle.antenna_height}m)</span>
                  <div className="bar-segments">
                    {series.slice(0,-1).map((s,idx)=>{
                      const ok=assessVisibility(s.earth_elevation_deg,s.earth_horizon_deg).meets_margin===true
                      return <span
                        key={idx}
                        className={'seg '+(ok?'earth-ok':'off')+(idx===timeline?' active':'')}
                        onClick={()=>{setPlaying(false);setTimeline(idx)}}
                        title={tr(`Intervalo +${idx} a +${idx+1} h · Tierra al inicio: ${ok?'Visible':'Sin despeje'} (${num(s.earth_elevation_deg-s.earth_horizon_deg,2)}°)`)}
                      />
                    })}
                  </div>
                  <small className="bar-summary"><b>{tr(num(selected?.earth_hours,0))}h</b>/{plan.mission.surface_hours}h</small>
                </div>
              </div>}
            </div>
            <span className="timeline-hour-plain">+{timeline} h</span>
          </div>

          <div className="conditions-readouts">
            <button type="button" className="readout-interactive-btn" onClick={()=>setVisibilityModalTarget('sun')} title={tr("Ver especificaciones y DEM del Sol")} data-testid="open-visibility-sun">
              <Sun size={12}/>{" "}<span>{tr("Sol sobre el horizonte (")}{vehicle.solar_panel_height} m):</span>{" "}<b className={current?(currentSunOk?'kpi-ok':'kpi-warn'):undefined}>{tr(num(current?current.sun_elevation_deg-current.sun_horizon_deg:null,2))}°</b>{" "}<span className="kpi-tag">{tr("Ver DEM")}</span>
            </button>
            <button type="button" className="readout-interactive-btn" onClick={()=>setVisibilityModalTarget('earth')} title={tr("Ver especificaciones y DEM de la Tierra")} data-testid="open-visibility-earth">
              <Globe2 size={12}/>{" "}<span>{tr("Tierra sobre el horizonte (")}{vehicle.antenna_height} m):</span>{" "}<b className={current?(currentEarthOk?'kpi-ok':'kpi-warn'):undefined}>{tr(num(current?current.earth_elevation_deg-current.earth_horizon_deg:null,2))}°</b>{" "}<span className="kpi-tag">{tr("Ver DEM")}</span>
            </button>
            <span className="condition-metric-plain">{tr("Pendiente P95:")}{" "}<b className={selected?.regional_slope_deg==null?undefined:selected.regional_slope_deg<=Math.min(intent?.max_slope_deg??slope,vehicle.center_of_gravity_tolerance)?'kpi-ok':'kpi-warn'}>{tr(num(selected?.regional_slope_deg,2))}°</b>{" "}{tr("· límite del escenario")}{" "}{tr(num(Math.min(intent?.max_slope_deg??slope,vehicle.center_of_gravity_tolerance),2))}°</span>
          </div>
        </div>}
      </main>

      {!hideRightPanel&&<aside className="mission-decisions">
        <MissionDecisionBrief intent={intent} plan={plan} operations={operationsSnapshot} rescue={rescueReport} rescueBusy={rescueBusy} busy={Boolean(busy)} timezone={TIMEZONE} onStudy={()=>document.querySelector('.mission-operations')?.scrollIntoView({behavior:'smooth',block:'start'})} onBest={()=>{if(plan?.best)choose(plan.best.id)}}/>

        {!plan?<div className="decision-welcome"><MapPin size={28}/><h2>{tr("Aquí encontrarás tu mejor opción.")}</h2><p>{tr("El sistema relacionará la fecha de tu viaje y el objeto lunar elegido con el terreno, la luz y la visibilidad de la Tierra.")}</p><ul><li><Check size={13}/>{" "}{tr("Un destino recomendado y sus razones")}</li><li><Check size={13}/>{" "}{tr("Clasificación de toda la superficie")}</li><li><Check size={13}/>{" "}{tr("Diagnóstico conversacional en el chat izquierdo")}</li></ul><small>{tr("Los resultados corresponden a un modelo regional de planificación, no a una autorización de vuelo.")}</small></div>:<>
          {!plan.best&&<><div className="decision-title"><span className="micro-title">{tr(plan.best?'RECOMENDACIÓN CALCULADA':plan.counts.unknown===plan.total_cells?'FALTAN DATOS PARA EVALUAR ESTE PERFIL':'NINGUNA ZONA CUMPLE TODOS LOS CRITERIOS')}</span>{aiMode&&<small>{tr(aiMode)}</small>}</div><MissionRescuePanel timezone={TIMEZONE} report={rescueReport} busy={rescueBusy} error={rescueError} elapsed={rescueElapsed} onApply={applyAlternative} onRetry={()=>setRescueAttempt(a=>a+1)} onCancel={cancelRescue} onEvidence={()=>setEvidence(true)}/></>}
          {/* Selected sector, followed by the compact candidate list. */}
          {selected&&<details className="selected-destination top-selected-destination collapsible-sidebar-card" open>
            <summary className="selected-destination-summary">
              <div className="selected-destination-title"><span className={'selected-color '+selected.risk}/><h3>{tr(selectedLabel)}</h3></div>
              <span className="selected-sector-id">{tr("Sector")}{" "}{tr(selected.id.replace('polar:',''))} · {tr(num(selected.area_km2,2))}{" "}{tr("km² regionales")}</span>
            </summary>
            <div className="selected-destination-body">
              <p>{tr(reasonPoint(selected))}</p><dl><div><dt>{tr("Perfil del escenario")}</dt><dd>{tr(vehicle.lander_name)}</dd></div><div><dt>{tr("Centro del sector")}</dt><dd>{tr(num(selected.latitude_deg,5))}°, {tr(num(selected.longitude_deg,5))}°</dd></div><div><dt>{tr("Elevación")}</dt><dd>{tr(num(selected.elevation_m??selectedCell?.elevation_m,0))} m</dd></div><div><dt>{tr("Pendiente P95 · fuente de 80 m")}</dt><dd>{tr(num(selected.regional_slope_deg,2))}°</dd></div><div><dt>{tr("Máxima pendiente nativa")}</dt><dd>{tr(num(selected.max_slope_deg??selectedCell?.max_slope_deg))}°</dd></div><div><dt>{tr("Sol visible (")}{vehicle.solar_panel_height}m)</dt><dd>{tr(num(selected.sun_hours,0))} h</dd></div><div><dt>{tr("Tierra visible (")}{vehicle.antenna_height}m)</dt><dd>{tr(num(selected.earth_hours,0))} h</dd></div>{(vehicle.is_rover||vehicle.category==='Rover y Movilidad')&&<div><dt>{tr("Radio de acción rover")}</dt><dd className="kpi-ok">{vehicle.nominal_range_km??15} km {vehicle.speed_km_h?`(${vehicle.speed_km_h} km/h)`:''}</dd></div>}</dl>

              {selected.sun_hours_sensitivity&&selected.earth_hours_sensitivity&&<div className="sampling-sensitivity"><strong>{tr("Variación por muestreo angular")}</strong><span>{tr("Sol:")}{" "}{tr(num(selected.sun_hours_sensitivity.lower,0))}–{tr(num(selected.sun_hours_sensitivity.upper,0))}{" "}{tr("h · Tierra:")}{" "}{tr(num(selected.earth_hours_sensitivity.lower,0))}–{tr(num(selected.earth_hours_sensitivity.upper,0))} h</span><small>{tr("Compara direcciones vecinas del horizonte. No es una probabilidad de éxito.")}</small></div>}
              {cellLoading&&<p className="cell-detail-status" role="status"><LoaderCircle className="spin" size={13}/>{" "}{tr("Cargando condiciones de esta área…")}</p>}
              {cellError&&<p className="trip-error" role="alert">{tr(cellError)}</p>}
              {flight&&<div className="arrival-telemetry"><strong>{tr(landed?(flight.outcome==='soft-touchdown'?'Contacto suave en el modelo':'Impacto en el modelo'):'Descenso físico · 30×')}</strong><span>{tr("Altura:")}{" "}{tr(num(telemetry?.altitudeM,0))} m</span><span>{tr("Velocidad:")}{" "}{tr(num(telemetry?.velocityMps,1))} m/s</span><span>{tr("Combustible:")}{" "}{tr(num(telemetry?.fuelKg,0))} kg</span><button onClick={()=>setFlying(v=>!v)} disabled={landed}>{tr(flying?'Pausar':'Continuar')}</button><small>{tr("Descenso de una nave genérica hipotética. El perfil visual no aporta masa, empuje ni una validación del destino.")}</small></div>}
            </div>
          </details>}

          {/* 2. Below Selected Sector: Uniform Candidate List where #1 shares the exact compact row design of #2, #3, #4 */}
          {plan.best?(
            <details className="candidates-list-wrapper collapsible-sidebar-card" open>
              <summary className="candidates-summary">
                <span className="micro-title">{tr(plan.best?'RECOMENDACIÓN CALCULADA':'NINGUNA ZONA CUMPLE TODOS LOS CRITERIOS')}</span>
                <h3>{tr("Candidatos recomendados")} ({plan.alternatives.length})</h3>
              </summary>
              <section className="other-destinations unified-candidates-list">
                <button className={'best-destination '+(selected?.id===plan.best.id?'selected':'')} onClick={()=>choose(plan.best!.id)}>
                  <span className="destination-number">1</span>
                  <div>
                    <strong>{tr(num(Math.abs(plan.best.latitude_deg),2))}°S · {tr(longitude(plan.best.longitude_deg,2))}</strong>
                    <small>{tr(num(plan.best.sun_hours,0))}{" "}{tr("h de Sol ·")}{" "}{tr(num(plan.best.earth_hours,0))}{" "}{tr("h de Tierra · P95")}{" "}{tr(num(plan.best.regional_slope_deg,2))}°</small>
                  </div>
                  <ArrowRight size={13}/>
                </button>
                {plan.alternatives.filter(p=>p.id!==plan.best?.id).map((p,i)=>(
                  <button key={p.id} className={selected?.id===p.id?'selected':''} onClick={()=>choose(p.id)}>
                    <span className="destination-number">{i+2}</span>
                    <div>
                      <strong>{tr(num(Math.abs(p.latitude_deg),2))}°S · {tr(longitude(p.longitude_deg,2))}</strong>
                      <small>{tr(num(p.sun_hours,0))}{" "}{tr("h de Sol ·")}{" "}{tr(num(p.earth_hours,0))}{" "}{tr("h de Tierra")}</small>
                    </div>
                    <ArrowRight size={13}/>
                  </button>
                ))}
              </section>
            </details>
          ):null}
          <details className="coordinate-inspector"><summary>{tr("Consultar cualquier coordenada del polo sur")}</summary><form onSubmit={e=>{e.preventDefault();inspectCoordinates()}}><label>{tr("Latitud")}<input aria-label={tr("Latitud a consultar")} type="number" step="any" min={-90} max={-80} value={inspectLat} onChange={e=>setInspectLat(e.target.value)}/></label><label>{tr("Longitud")}<input aria-label={tr("Longitud a consultar")} type="number" step="any" min={-180} max={180} value={inspectLon} onChange={e=>setInspectLon(e.target.value)}/></label><button type="submit">{tr("Examinar área")}</button>{coordinateError&&<p role="alert">{tr(coordinateError)}</p>}</form></details>
          <details className="rejected-destinations"><summary>{tr(num(rejectedTotal,0))}{" "}{tr("zonas descartadas · ver ejemplos")}</summary>{plan.rejected.map(p=><button key={p.id} onClick={()=>choose(p.id)}><span className="reject-dot"/><div><strong>{tr(num(Math.abs(p.latitude_deg),2))}°S · {tr(longitude(p.longitude_deg,2))}</strong><small>{tr(p.reasons?.[0]??'No cumple los criterios')}</small></div></button>)}</details>
          {selected&&<OperationalWindowsPanel samples={series} index={timeline} timezone={TIMEZONE}/>}
          <button className="download-plan" onClick={exportPlan}><Download size={14}/>{" "}{tr("Descargar plan y evidencia")}</button>
          <p className="decision-scope">{tr("Los colores describen sectores regionales, con condiciones calculadas en sus centros. Una zona verde puede contener pendientes locales mayores. Falta evaluar rocas pequeñas, huella de la nave, energía, temperatura y enlace de radio.")}</p>
        </>}

        {/* 3. At the bottom of the right panel: TU ITINERARIO ESTIMADO + Ver datos y supuestos */}
        {plan&&<details className="trip-overview right-bottom-itinerary collapsible-sidebar-card" open>
          <summary className="itinerary-summary">
            <span className="micro-title">{tr("TU ITINERARIO ESTIMADO")}</span>
            <div className="itinerary-summary-sub"><strong>{tr(localDate(plan.mission.departure_utc))}</strong>{" · "}<small>{tr("Duración total:")}{" "}{tr(duration(plan.mission.total_hours))}</small></div>
          </summary>
          <div className="itinerary-body">
            <div className="itinerary-item"><span className="itinerary-dot"/><div><small>{tr("Salida ·")}{" "}{tr(launchSite.name)}</small><strong>{tr(localDate(plan.mission.departure_utc))}</strong></div></div>
            <div className="itinerary-duration">{tr("↓ Ida estimada:")}{" "}{tr(duration(plan.mission.outbound_hours))}</div>
            <div className="itinerary-item"><span className="itinerary-dot moon"/><div><small>{tr("Alunizaje analizado")}</small><strong>{tr(localDate(plan.mission.arrival_utc))}</strong></div></div>
            <div className="itinerary-duration">{tr("Estancia:")}{" "}{tr(duration(plan.mission.surface_hours))}</div>
            <div className="itinerary-item"><span className="itinerary-dot"/><div><small>{tr("Regreso estimado")}</small><strong>{tr(localDate(plan.mission.return_utc))}</strong></div></div>
            <div className="total-trip"><span>{tr("Duración total estimada")}</span><strong>{tr(duration(plan.mission.total_hours))}</strong></div>
            <p className="estimate-note">{tr("Estimación orbital simplificada desde una órbita terrestre de 200 km.")}</p>
          </div>
        </details>}
        <button className="evidence-link" onClick={()=>setEvidence(true)}><Layers size={13}/>{" "}{tr("Ver datos y supuestos")}</button>
      </aside>}
    </div>
    <MissionOperationsPanel command={operationsCommand} onCommandFeedback={(text,success)=>{if(!success)appendChatTurn('assistant',text)}} plan={plan} selected={selected} intent={intent} vehicle={vehicle} launchSite={launchSite} timezone={TIMEZONE} message={missionText||message} onApply={applyOperationalScenario} onInspect={sampleMap} onEvidence={receiveOperationsEvidence}/>
    {(help||evidence)&&<div className="mission-modal-backdrop" onClick={()=>{setHelp(false);setEvidence(false)}}><section className="mission-modal" role="dialog" aria-modal="true" aria-label={tr(help?'Cómo se planifica tu misión':'Datos del plan de misión')} onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Escape'){setHelp(false);setEvidence(false)}}}><div className="modal-top"><h2>{tr(help?'Escribe tu viaje. Nosotros calculamos.':'Los datos detrás de tu recomendación.')}</h2><button autoFocus aria-label={tr("Cerrar información")} onClick={()=>{setHelp(false);setEvidence(false)}}><X size={17}/></button></div>
      {help?<><p>{tr("Escribe la fecha y hora de salida y pulsa")}{" "}<strong>{tr("Planificar mi misión")}</strong>{tr(". Gemini interpreta tu petición; el motor científico consulta NASA y compara el polo sur automáticamente. Si la fecha no produce candidatos favorables, busca automáticamente otras fechas manteniendo los requisitos y te permite comparar antes de aplicar.")}</p><p>{tr("Puedes adjuntar un perfil JSON o metadatos glTF y comparar parámetros hipotéticos del vehículo. El catálogo no constituye una ficha técnica verificada. El estudio operativo recalcula horizontes nativos para las alturas declaradas en el punto elegido. La clasificación regional conserva sus horizontes preparados de 2 m; otras alturas se estudian localmente.")}</p><p>{tr("La evaluación cubre todo el polo sur visible. Verde indica sectores favorables en el modelo, amarillo indica sensibilidad al muestreo, rojo indica que no cumplen los criterios y gris indica datos insuficientes. Haz clic en cualquier área para consultar su pendiente, Sol, Tierra y motivos. La estrella destaca el mejor centro candidato; los colores no certifican cada punto de un sector.")}</p><p>{tr("Si dices «alunizar el…», esa fecha se interpreta como llegada. Si dices «viajar el…», se interpreta como salida. La hora se interpreta en el centro espacial elegido, con su horario de verano, o en UTC si lo indicas. Kennedy LC-39B es la referencia inicial para Artemis. El centro no convierte la estimación orbital en una ventana real de lanzamiento.")}</p><p>{tr("La ida y vuelta usan una estimación orbital simplificada. La estancia se declara como supuesto editable. Una misión real requiere diseñar la trayectoria, la nave y sus operaciones.")}</p></>:<><p>{tr(plan?'Datos del cálculo actual:':'Escribe y calcula una misión para obtener las consultas y mediciones de tu caso.')}</p>{(rescueReport||adopted)&&<details open><summary>{tr("Evidencia de la búsqueda de alternativas")}</summary><p>{tr("Se proponen cambios de fecha conservando las restricciones. El resultado sólo cubre los escenarios examinados.")}</p><pre>{tr(JSON.stringify(rescueReport??adopted,null,2))}</pre></details>}<ul>{assumptions.map(a=><li key={a}>{tr(a)}</li>)}{plan?.mission.assumptions?.map(a=><li key={a}>{tr(a)}</li>)}</ul><p>{tr("Terreno: NASA LOLA de 80 m. Comparación regional por sectores de 4,75 km y perfiles de horizonte propios por centro. Los intervalos amarillo/verde comparan los azimuts vecinos del horizonte; no representan toda la incertidumbre del terreno. Los sectores del borde sin mediciones se conservan en gris. Las superficies se calculan sobre la esfera lunar y se recortan al casquete 80–90°S.")}</p><ul>{plan?.meta.limitations.map(note=><li key={note}>{tr(note)}</li>)}</ul><details><summary>{tr("Consultas y procedencia completas")}</summary><pre>{tr(JSON.stringify(plan?.meta.sources??[],null,2))}</pre></details>{plan&&<button className="download-plan" onClick={exportPlan}><Download size={14}/>{" "}{tr("Descargar evidencia completa")}</button>}</>}

    </section></div>}
    {visibilityModalTarget&&<div className="mission-modal-backdrop" onClick={()=>setVisibilityModalTarget(null)}><section className="mission-modal visibility-modal" role="dialog" aria-modal="true" aria-label={tr("Especificaciones de visibilidad y relieve")} onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Escape')setVisibilityModalTarget(null)}}><div className="modal-top"><div><span className="micro-title">{tr("ESPECIFICACIONES DE VISIBILIDAD · NASA LOLA DEM")}</span><h2>{tr(visibilityModalTarget==='sun'?'Horizonte y ángulo del Sol':'Horizonte y ángulo de la Tierra')}</h2></div><button autoFocus aria-label={tr("Cerrar especificaciones")} onClick={()=>setVisibilityModalTarget(null)}><X size={17}/></button></div>
      <MissionVisibilityPanel sample={current} sunHeightM={vehicle.solar_panel_height} earthHeightM={vehicle.antenna_height} initialTarget={visibilityModalTarget}/>
    </section></div>}
  </div>
}
