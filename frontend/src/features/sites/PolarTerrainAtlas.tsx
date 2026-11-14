import { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, Line, OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
import { ArrowRight, Check, ChevronDown, Compass, Database, ExternalLink, Eye, EyeOff, Focus, Globe2, Layers3, LoaderCircle, MapPin, Maximize2, Minus, Mountain, Pause, Play, Plus, RotateCcw, Sun, TriangleAlert, X } from 'lucide-react'
import { useMission } from '../mission/MissionContext'
import type { LunarSite, SolarResult, SolarSample } from '../mission/types'
import type { DescentSample } from '../mission/descentPhysics'
import { fetchSolar } from '../solar/SolarApiClient'
import { bodyDirection, buildAtlasGeometry, ELEVATION_COLORS, loadAtlas, projectedToWorld, siteWorld } from './atlasGeometry'
import type { AtlasColorMode, AtlasData, AtlasFeature } from './atlasGeometry'
import './polar-atlas.css'
import './atlas-refinements.css'

type ViewPreset = 'oblique' | 'polar' | 'site'
export type AtlasDescent = { sample: DescentSample; landed: boolean; hardImpact: boolean; startAltitudeM: number; playing?: boolean; durationS?: number; onToggle?: () => void; onSeek?: (time:number) => void }
type Props = {
  sites: LunarSite[]; selectedSiteId: string; onSelectSite: (id: string) => void
  solarResult?: SolarResult; earthResult?: SolarResult; onOpenSolar: () => void
  language?: 'es' | 'en'; timeline?: { index: number; onChange: (index: number) => void }; descent?: AtlasDescent; focusRevision?: number
}
const primaryLabels = new Set(['Shackleton','Shoemaker','Haworth','de Gerlache','Faustini','Sverdrup','Nobile','Amundsen','Cabeus','Malapert','Mons Mouton','Wiechert'])

export default function PolarTerrainAtlas({ sites, selectedSiteId, onSelectSite, solarResult, earthResult, onOpenSolar, timeline, descent, focusRevision, language='en' }: Props) {
  const { mission } = useMission()
  const t=(en:string,es:string)=>language==='es'?es:en
  const [atlas,setAtlas]=useState<AtlasData|null>(null)
  const [error,setError]=useState('')
  const [retry,setRetry]=useState(0)
  const [mode,setMode]=useState<AtlasColorMode>('elevation')
  const [labels,setLabels]=useState(true)
  const [rotate,setRotate]=useState(false)
  const [exaggeration,setExaggeration]=useState(3)
  const [preset,setPreset]=useState<ViewPreset>('oblique')
  const [cameraRevision,setCameraRevision]=useState(0)
  const [zoom,setZoom]=useState(0)
  const [feature,setFeature]=useState<AtlasFeature|null>(null)
  const [fullscreen,setFullscreen]=useState(false)
  const [webglError,setWebglError]=useState(false)
  const [sampleIndex,setSampleIndex]=useState(0)
  const [playing,setPlaying]=useState(false)
  const [earth,setEarth]=useState<SolarResult|null>(null)
  const [earthError,setEarthError]=useState('')
  const [showDirections,setShowDirections]=useState(false)
  const [reducedMotion,setReducedMotion]=useState(false)
  const root=useRef<HTMLElement>(null)
  const labelHost=useRef<HTMLDivElement>(null)
  const selectedSite=sites.find(s=>s.id===selectedSiteId)
  const missionKey=JSON.stringify(mission)

  useEffect(()=>{
    const controller=new AbortController();setError('');setAtlas(null)
    loadAtlas(controller.signal).then(data=>{if(!controller.signal.aborted)setAtlas(data)}).catch(err=>{if(!controller.signal.aborted)setError(err.message)})
    return ()=>controller.abort()
  },[retry])
  useEffect(()=>{
    const media=window.matchMedia('(prefers-reduced-motion: reduce)');const update=()=>setReducedMotion(media.matches)
    update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update)
  },[])
  useEffect(()=>{
    if(earthResult){setEarth(earthResult);setEarthError('');return}
    if(!solarResult||!selectedSite)return
    const controller=new AbortController();setEarth(null);setEarthError('')
    fetchSolar(selectedSiteId,mission,controller.signal,'earth').then(value=>{if(!controller.signal.aborted)setEarth(value)}).catch(err=>{if(!controller.signal.aborted)setEarthError(err.message)})
    return()=>controller.abort()
  // The serialized key represents all scientific inputs; the visible solar result is the prerequisite.
  },[selectedSiteId,missionKey,solarResult,earthResult])
  useEffect(()=>{setSampleIndex(0);setPlaying(false)},[selectedSiteId,missionKey])
  const samples=solarResult?.samples||[]
  const index=Math.min(timeline?.index??sampleIndex,Math.max(samples.length-1,0))
  const changeIndex=(value:number)=>timeline?timeline.onChange(value):setSampleIndex(value)
  const solar=samples[index]
  const earthSample=earth?.samples.find(s=>s.t_utc===solar?.t_utc)
  useEffect(()=>{
    if(!playing||samples.length<2)return
    const timer=window.setInterval(()=>changeIndex((index+1)%samples.length),700)
    return()=>window.clearInterval(timer)
  },[playing,samples.length,index,timeline])
  useEffect(()=>{
    const update=()=>setFullscreen(document.fullscreenElement===root.current)
    document.addEventListener('fullscreenchange',update);return()=>document.removeEventListener('fullscreenchange',update)
  },[])

  useEffect(()=>{
    if(!focusRevision)return
    setPreset('site');setCameraRevision(v=>v+1);setZoom(1);setRotate(false)
  },[focusRevision])

  useEffect(()=>{if(descent)setPlaying(false)},[!!descent])

  function setView(view:ViewPreset){setPreset(view);setCameraRevision(v=>v+1);setZoom(0);setRotate(false)}
  async function toggleFullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await root.current?.requestFullscreen()}catch{setError('Full-screen access was denied by this browser. The atlas remains available below.')}}

  return <section ref={root} className={`polar-atlas ${fullscreen?'atlas-fullscreen':''}`} aria-label="NASA lunar south pole 3D terrain atlas">
    <header className="atlas-header"><div><span className="atlas-kicker"><span/>LRO / LUNAR ORBITER LASER ALTIMETER</span><h3>{t('The south pole, in perspective','El polo sur, en perspectiva')}<span>.</span></h3><p>{t('Real lunar topography. A different view of every possibility.','Topografía lunar medida. Explora el relieve de tu próxima misión.')}</p></div><a className="atlas-source-badge" href="https://pgda.gsfc.nasa.gov/products/78" target="_blank" rel="noreferrer"><Database size={14}/><span>NASA LOLA<small>{t('MEASURED ELEVATION','ELEVACIÓN MEDIDA')}</small></span><ExternalLink size={11}/></a></header>
    <div className="atlas-toolbar"><div className="atlas-segmented" aria-label="Terrain color mode"><button aria-pressed={mode==='elevation'} onClick={()=>setMode('elevation')}><Layers3 size={13}/>{t('Elevation color','Color por elevación')}</button><button aria-pressed={mode==='natural'} onClick={()=>setMode('natural')}><Mountain size={13}/>{t('Monochrome relief','Relieve monocromo')}</button></div><div className="atlas-toolbar-actions"><button onClick={()=>setLabels(v=>!v)} aria-pressed={labels}>{labels?<Eye size={13}/>:<EyeOff size={13}/>}<span>{t('Feature labels','Nombres')}</span></button><button onClick={()=>setShowDirections(v=>!v)} aria-pressed={showDirections}><Sun size={13}/><span>{t('Sun & Earth','Sol y Tierra')}</span></button><label>{t('RELIEF','RELIEVE')}<select aria-label="Vertical exaggeration" value={exaggeration} onChange={e=>setExaggeration(Number(e.target.value))}><option value={1}>{t('1× true scale','1× escala real')}</option><option value={3}>{t('3× display','3× visual')}</option><option value={5}>{t('5× display','5× visual')}</option></select><ChevronDown size={11}/></label></div></div>

    <div className="atlas-viewport" data-testid="polar-atlas-viewport">
      {!atlas&&!error&&<div className="atlas-loading" role="status"><LoaderCircle size={23}/><strong>{t('Reconstructing the lunar south pole','Reconstruyendo el polo sur lunar')}</strong><span>{t('Loading and verifying the NASA elevation mesh…','Cargando y verificando las elevaciones NASA…')}</span></div>}
      {error&&!atlas&&<div className="atlas-loading atlas-error" role="alert"><TriangleAlert size={24}/><strong>Regional terrain unavailable</strong><span>{error}</span><button onClick={()=>setRetry(v=>v+1)}>Reload NASA terrain<RotateCcw size={13}/></button></div>}
      {webglError&&<div className="atlas-loading atlas-error" role="alert"><TriangleAlert size={24}/><strong>This browser could not start 3D</strong><span>Enable WebGL or hardware acceleration. The 2D map and scientific results remain available below.</span></div>}
      {atlas&&!webglError&&<AtlasBoundary onError={()=>setWebglError(true)}><Canvas frameloop="demand" dpr={[1,1.5]} camera={{position:[20,205,365],fov:47,near:0.2,far:2500}} gl={{antialias:true,alpha:false,powerPreference:'high-performance'}} onCreated={({gl})=>{gl.setClearColor('#03060a');gl.toneMapping=THREE.ACESFilmicToneMapping;gl.toneMappingExposure=1.15;gl.domElement.setAttribute('aria-label','NASA LOLA south pole terrain, rotate by dragging and zoom by scrolling');gl.domElement.setAttribute('role','img')}} fallback={<div className="atlas-loading atlas-error">WebGL unavailable. Use the 2D explorer below.</div>}><Suspense fallback={null}>
        <AtlasScene data={atlas} mode={mode} exaggeration={exaggeration} labelHost={labelHost} rotate={rotate&&!reducedMotion} preset={preset} cameraRevision={cameraRevision} zoom={zoom} selectedSite={selectedSite} sites={sites} showDirections={showDirections} solar={solar} earth={earthSample} descent={descent}/>
      </Suspense></Canvas></AtlasBoundary>}
      <div ref={labelHost} className="atlas-screen-labels">{atlas&&!webglError&&labels&&atlas.manifest.features.filter(f=>primaryLabels.has(f.name)).map(f=><button key={f.name} data-atlas-feature={f.name} className={`atlas-crater-label ${f.name==='Shackleton'?'atlas-label-pole':''}`} aria-label={`Inspect lunar feature ${f.name}`} onClick={()=>setFeature(f)}><span>{f.name}</span><i/></button>)}{atlas&&!webglError&&sites.map(site=><button key={site.id} data-atlas-site={site.id} className={`atlas-site-pin ${site.id==='site01'?'left':'right'} ${site.id===selectedSiteId?'selected':''}`} aria-label={`Select terrain region ${site.name}`} title={site.name} aria-pressed={site.id===selectedSiteId} onClick={()=>onSelectSite(site.id)}>{site.id==='site01'?'01':'04'}</button>)}</div>
      {descent&&selectedSite&&<div className="atlas-descent-stamp" data-testid="map-landing-target" data-latitude={selectedSite.latitude_deg} data-longitude={selectedSite.longitude_deg}><span>{descent.landed?(descent.hardImpact?'IMPACTO EN EL MODELO':'CONTACTO CON LA SUPERFICIE'):'PUNTO OBJETIVO DEL DESCENSO'}</span><strong>{selectedSite.name}</strong><small>{Math.abs(selectedSite.latitude_deg).toFixed(6)}° S · {((selectedSite.longitude_deg+360)%360).toFixed(6)}° E</small><small>Altura {descent.sample.altitudeM.toFixed(1)} m · velocidad {Math.abs(descent.sample.velocityMps).toFixed(2)} m/s</small><small>Propelente {descent.sample.fuelKg.toFixed(1)} kg · empuje {(descent.sample.thrustN/1000).toFixed(1)} kN</small><small>Posición calculada · símbolo de nave sin escala</small></div>}
      <div className="atlas-view-presets" aria-label="Terrain camera view">{(['oblique','polar','site'] as const).map(view=><button key={view} aria-pressed={preset===view} onClick={()=>setView(view)}>{view==='oblique'?<Mountain size={12}/>:view==='polar'?<Compass size={12}/>:<Focus size={12}/>}<span>{view==='oblique'?t('Perspective','Perspectiva'):view==='polar'?t('Polar view','Vista polar'):t('Focus region','Centrar punto')}</span></button>)}</div>
      {descent?.onToggle&&<div className="atlas-flight-controls"><button aria-label={descent.playing?'Pausar descenso en mapa':'Reproducir descenso en mapa'} onClick={descent.onToggle}>{descent.playing?<Pause size={14}/>:<Play size={14}/>}</button><time>T+ {descent.sample.timeS.toFixed(1)} s</time><input aria-label="Tiempo del descenso en mapa" type="range" min={0} max={descent.durationS} step="any" value={descent.sample.timeS} onChange={e=>descent.onSeek?.(Number(e.target.value))}/></div>}
      <div className="atlas-map-tools"><button aria-label="Zoom in terrain" title="Zoom in" onClick={()=>setZoom(v=>v+1)}><Plus size={16}/></button><button aria-label="Zoom out terrain" title="Zoom out" onClick={()=>setZoom(v=>v-1)}><Minus size={16}/></button><i/><button aria-label={rotate?'Pause terrain orbit':'Orbit terrain automatically'} title="Orbit terrain" aria-pressed={rotate} onClick={()=>setRotate(v=>!v)} disabled={reducedMotion}>{rotate?<Pause size={15}/>:<Play size={15}/>}</button><button aria-label="Reset terrain view" title="Reset terrain view" onClick={()=>setView('oblique')}><RotateCcw size={15}/></button><button aria-label={fullscreen?'Exit terrain fullscreen':'Expand terrain fullscreen'} title="Full screen" onClick={()=>void toggleFullscreen()}><Maximize2 size={15}/></button></div>
      <div className="atlas-legend"><span>{mode==='elevation'?t('ELEVATION / LUNAR REFERENCE SPHERE','ELEVACIÓN / ESFERA LUNAR DE REFERENCIA'):t('RELIEF / INSPECTION LIGHTING','RELIEVE / LUZ PARA INSPECCIÓN')}</span>{mode==='elevation'&&<><i style={{background:`linear-gradient(90deg,${ELEVATION_COLORS.map(([,c])=>c).join(',')})`}}/><div><span>−7 km</span><span>0</span><span>+7 km</span></div></>}<small>{t('Vertical display:','Relieve visual:')} {exaggeration}×<span>80 {t('m source','m de fuente')} / {atlas?Math.round(atlas.manifest.display_spacing_m):'—'} {t('m mesh','m de malla')}</span></small></div>
      <div className="atlas-coordinate-stamp"><Compass size={13}/><span>SOUTH POLAR REGION<small>80° S — 90° S · EAST LONGITUDE</small></span></div>
      {feature&&<aside className="atlas-feature-detail"><button aria-label="Close feature details" onClick={()=>setFeature(null)}><X size={14}/></button><span className="atlas-kicker">IAU / USGS FEATURE</span><h4>{feature.name}</h4><p>{Math.abs(feature.latitude_deg).toFixed(3)}° S <span>/</span> {feature.longitude_east_deg.toFixed(3)}° E</p><div><span>DEM height at label</span><strong>{(feature.elevation_m/1000).toFixed(2)} km</strong></div><a href={feature.source_url} target="_blank" rel="noreferrer">Official nomenclature<ExternalLink size={10}/></a></aside>}
    </div>

    <div className="atlas-site-strip"><span><MapPin size={14}/>{t('STUDY REGIONS','REGIONES DE ESTUDIO')}</span><div>{sites.map(site=><button key={site.id} aria-pressed={site.id===selectedSiteId} onClick={()=>{onSelectSite(site.id);setFeature(null)}}><span>{site.id==='site01'?'01':'04'}</span>{site.name}{site.id===selectedSiteId?<Check size={12}/>:<ArrowRight size={12}/>}</button>)}</div><button className="atlas-open-science" onClick={onOpenSolar}>{t('Study the solar window','Analizar ventanas')}<ArrowRight size={13}/></button></div>
    <div className="atlas-time-panel"><div className="atlas-time-title"><span className="atlas-kicker">{t('GEOMETRY AT THE SELECTED REGION','GEOMETRÍA DEL PUNTO SELECCIONADO')}</span><span><MapPin size={10}/>{selectedSite?.name||'Select a study region'}</span></div><div className="atlas-ephemeris-row"><BodyReadout language={language} name="Sun" sample={solar} error={!solar?'Solar ephemerides loading or unavailable.':undefined}/><BodyReadout language={language} name="Earth" sample={earthSample} error={earthError||(!earthSample?'Retrieving Earth ephemerides…':undefined)}/><div className="atlas-timeline"><div><button aria-label={playing?'Pause ephemeris timeline':'Play ephemeris timeline'} disabled={samples.length<2||!!descent} onClick={()=>setPlaying(v=>!v)}>{playing?<Pause size={13}/>:<Play size={13}/>}</button><time>{solar?solar.t_utc.replace('T',' ').replace('Z',' UTC'):t('Scientific data pending','Efemérides pendientes')}</time><span>{index+1}/{samples.length||'—'}</span></div><input aria-label="Terrain ephemeris time" type="range" min={0} max={Math.max(samples.length-1,1)} value={index} disabled={!samples.length} onChange={e=>{setPlaying(false);changeIndex(Number(e.target.value))}}/><small>JPL Horizons · {mission.stepMinutes}-minute samples · {mission.horizonMode==='terrain'?t('LOLA terrain horizon','horizonte de relieve LOLA'):t('flat horizon approximation','aproximación de horizonte plano')}</small></div></div></div>
    <footer className="atlas-provenance"><p><Database size={12}/><span><a href="https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF" target="_blank" rel="noreferrer">NASA / LOLA regional DEM</a> · <a href="https://planetarynames.wr.usgs.gov/GIS_Downloads" target="_blank" rel="noreferrer">IAU / USGS names</a> · <a href="https://svs.gsfc.nasa.gov/5127" target="_blank" rel="noreferrer">NASA visual reference<ExternalLink size={10}/></a></span></p><details><summary>{t('Data, display & limits','Datos, visualización y límites')}</summary><p>The surface is reconstructed from measured NASA elevations, with lunar curvature. Elevation colors and {exaggeration}× vertical exaggeration aid inspection. Lighting is illustrative; colors do not represent ice or instantaneous sunlight. The display mesh is downsampled from 80 m data; scientific horizons use the separate local and regional source rasters. Labels identify geographic features, not approved landing sites. Sun/Earth rays show sampled local directions, with schematic lengths; inspect visibility values rather than scene brightness.</p>{atlas&&<code>NASA source SHA-256: {atlas.manifest.source_sha256}<br/>Prepared: {atlas.manifest.prepared_at}</code>}</details></footer>
  </section>
}

function BodyReadout({name,sample,error,language='en'}:{language?:'es'|'en';name:'Sun'|'Earth';sample?:SolarSample;error?:string}) {
  const t=(en:string,es:string)=>language==='es'?es:en
  return <div className={`atlas-body-readout ${name==='Sun'?'atlas-sun':'atlas-earth'}`}><div>{name==='Sun'?<Sun size={17}/>:<Globe2 size={17}/>}<span>{language==='es'?(name==='Sun'?'SOL':'TIERRA'):name.toUpperCase()}<small>{sample?(sample.visible?t('ABOVE SELECTED HORIZON','SOBRE EL HORIZONTE'):t('BELOW / AT HORIZON','BAJO EL HORIZONTE / MARGEN')):error}</small></span><i className={sample?.visible?'visible':''}/></div><dl><div><dt>{t('AZIMUTH','AZIMUT')}</dt><dd>{sample?`${sample.azimuth_deg.toFixed(2)}°`:'—'}</dd></div><div><dt>{t('ELEVATION','ELEVACIÓN')}</dt><dd>{sample?`${sample.elevation_deg.toFixed(2)}°`:'—'}</dd></div><div><dt>{t('HORIZON','HORIZONTE')}</dt><dd>{sample?`${sample.horizon_deg.toFixed(2)}°`:'—'}</dd></div></dl></div>
}

function AtlasScene({data,mode,exaggeration,labelHost,rotate,preset,cameraRevision,zoom,selectedSite,sites,showDirections,solar,earth,descent}:{data:AtlasData;mode:AtlasColorMode;exaggeration:number;labelHost:RefObject<HTMLDivElement|null>;rotate:boolean;preset:ViewPreset;cameraRevision:number;zoom:number;selectedSite?:LunarSite;sites:LunarSite[];showDirections:boolean;solar?:SolarSample;earth?:SolarSample;descent?:AtlasDescent}) {
  const {size}=useThree()
  const geometry=useMemo(()=>buildAtlasGeometry(data,exaggeration,mode,size.width<650?2:1),[data,exaggeration,mode,size.width<650])
  useEffect(()=>()=>geometry.dispose(),[geometry])
  const controls=useRef<OrbitControlsImpl>(null)
  const view=useMemo(()=>({preset,revision:cameraRevision,siteId:preset==='site'?selectedSite?.id:'',zoom}),[preset,cameraRevision,selectedSite?.id,zoom])
  const m=data.manifest
  return <>
    <color attach="background" args={['#03060a']}/>
    <ambientLight intensity={.65} color="#dbe6f2"/>
    <directionalLight position={[-250,190,100]} intensity={2.2} color="#f3f2e6"/>
    <directionalLight position={[180,70,-100]} intensity={.3} color="#abc7e2"/>
    <mesh geometry={geometry} raycast={()=>{}}><meshStandardMaterial vertexColors roughness={.96} metalness={0} side={THREE.DoubleSide}/></mesh>
    {sites.map(site=>{
      const pos=siteWorld(site,exaggeration,m.radius_m),selected=site.id===selectedSite?.id
      return <group key={site.id} position={pos}>{!(selected&&descent)&&<mesh position={[0,.6,0]}><sphereGeometry args={[selected?1.1:.8,12,8]}/><meshBasicMaterial color={selected?'#e1eac5':'#a8c9dc'}/></mesh>}</group>
    })}
    {showDirections&&selectedSite&&[solar&&{sample:solar,name:'Sun',color:'#f3d48b'},earth&&{sample:earth,name:'Earth',color:'#9acbdc'}].filter(Boolean).map(item=>{
      if(!item)return null
      const origin=siteWorld(selectedSite,exaggeration,m.radius_m).add(new THREE.Vector3(0,1,0))
      const end=origin.clone().addScaledVector(bodyDirection(selectedSite,item.sample.azimuth_deg,item.sample.elevation_deg),80)
      return <group key={item.name}><Line points={[origin,end]} color={item.color} lineWidth={1.4} dashed={!item.sample.visible} dashSize={2} gapSize={1.5}/><mesh position={end}><sphereGeometry args={[1.6,16,12]}/><meshBasicMaterial color={item.color}/></mesh><Html position={end} center zIndexRange={[9,1]}><span className="atlas-body-label">{item.name} · {item.sample.elevation_deg.toFixed(2)}°</span></Html></group>
    })}
    {descent&&selectedSite&&<DescentVehicle site={selectedSite} descent={descent} exaggeration={exaggeration} radius={m.radius_m}/>}
    <OrbitControls ref={controls} makeDefault autoRotate={rotate} autoRotateSpeed={.35} enableDamping dampingFactor={.1} minDistance={15} maxDistance={1000} minPolarAngle={.02} maxPolarAngle={Math.PI/2-.04} target={[0,-8,0]} zoomSpeed={.7} rotateSpeed={.6}/>
    <CameraDirector view={view} controls={controls} site={selectedSite} exaggeration={exaggeration} radius={m.radius_m}/>
    <ProjectLabels data={data} exaggeration={exaggeration} host={labelHost} sites={sites}/>
  </>
}

function DescentVehicle({site,descent,exaggeration,radius}:{site:LunarSite;descent:AtlasDescent;exaggeration:number;radius:number}) {
  const ground=siteWorld(site,exaggeration,radius)
  const up=bodyDirection(site,0,90)
  const vehicle=ground.clone().addScaledVector(up,descent.sample.altitudeM/1000)
  const visual=vehicle.clone().addScaledVector(up,.625)
  const top=ground.clone().addScaledVector(up,descent.startAltitudeM/1000)
  const color=descent.hardImpact&&descent.landed?'#f49a7e':'#d9e9a8'
  return <group>
    <Line points={[ground,top]} color={color} lineWidth={2} dashed dashSize={.12} gapSize={.1}/>
    <group position={ground} quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),up)}>
      <mesh><ringGeometry args={[.25,.32,40]}/><meshBasicMaterial color={color} side={THREE.DoubleSide} depthTest={false}/></mesh>
      <Line points={[[-.65,0,0],[.65,0,0]]} color={color} lineWidth={1.5} depthTest={false}/>
      <Line points={[[0,-.65,0],[0,.65,0]]} color={color} lineWidth={1.5} depthTest={false}/>
    </group>
    <group position={visual} scale={2.5} quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),up)}>
      <mesh><cylinderGeometry args={[.12,.18,.22,8]}/><meshStandardMaterial color="#e7e5cc" metalness={.5} roughness={.5}/></mesh>
      <mesh position={[0,.16,0]}><coneGeometry args={[.13,.14,8]}/><meshStandardMaterial color="#adb5ae" metalness={.6}/></mesh>
      {[-1,1].flatMap(x=>[-1,1].map(z=><group key={x+','+z}><Line points={[[x*.1,-.04,z*.1],[x*.25,-.25,z*.25]]} color="#e4cb89" lineWidth={2}/><mesh position={[x*.25,-.25,z*.25]}><boxGeometry args={[.1,.02,.1]}/><meshStandardMaterial color="#95876b"/></mesh></group>))}
      {!descent.landed&&descent.sample.throttle>0&&<mesh position={[0,-.2-descent.sample.throttle*.12,0]} rotation={[Math.PI,0,0]}><coneGeometry args={[.055,.12+descent.sample.throttle*.24,12]}/><meshBasicMaterial color="#b1d8eb" transparent opacity={.75}/></mesh>}
    </group>
    <Html position={visual.clone().addScaledVector(up,1)} center zIndexRange={[20,10]}><div className={'atlas-craft '+(descent.landed?'landed':'')} style={{borderColor:color}}><span>{descent.landed?'＋':'▼'}</span><small>{descent.landed?'CONTACTO':descent.sample.altitudeM.toFixed(0)+' m'}</small></div></Html>
  </group>
}

function ProjectLabels({data,exaggeration,host,sites}:{data:AtlasData;exaggeration:number;host:RefObject<HTMLDivElement|null>;sites:LunarSite[]}) {
  const {camera,size}=useThree()
  const positions=useMemo(()=>new Map(data.manifest.features.map(f=>[f.name,projectedToWorld(f.x_m,f.y_m,f.elevation_m,exaggeration,data.manifest.radius_m)])),[data,exaggeration])
  const sitePositions=useMemo(()=>new Map(sites.map(s=>[s.id,siteWorld(s,exaggeration,data.manifest.radius_m)])),[sites,exaggeration,data])
  const projection=useMemo(()=>new THREE.Vector3(),[])
  useFrame(()=>{
    host.current?.querySelectorAll<HTMLButtonElement>('button').forEach(element=>{
      const pos=element.dataset.atlasFeature?positions.get(element.dataset.atlasFeature):sitePositions.get(element.dataset.atlasSite||'')
      if(!pos)return
      projection.copy(pos).project(camera)
      const visible=projection.z<1&&projection.z>-1&&Math.abs(projection.x)<1.05&&Math.abs(projection.y)<1.1
      element.style.visibility=visible?'visible':'hidden'
      element.style.left=`${(projection.x*.5+.5)*size.width}px`
      element.style.top=`${(-projection.y*.5+.5)*size.height}px`
    })
  })
  return null
}

function CameraDirector({view,controls,site,exaggeration,radius}:{view:{preset:ViewPreset;revision:number;siteId?:string;zoom:number};controls:RefObject<OrbitControlsImpl|null>;site?:LunarSite;exaggeration:number;radius:number}) {
  const {camera,invalidate,size}=useThree()
  const goal=useRef<{position:THREE.Vector3;target:THREE.Vector3}|null>(null)
  useEffect(()=>{
    const target=view.preset==='site'&&site?siteWorld(site,exaggeration,radius):new THREE.Vector3(0,-8,0)
    const mobile=size.width<650
    const offset=view.preset==='polar'?new THREE.Vector3(.1,mobile?760:560,.5):view.preset==='site'?new THREE.Vector3(20,32,48):new THREE.Vector3(20,mobile?300:205,mobile?540:365)
    offset.multiplyScalar(Math.pow(.8,view.zoom))
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches&&controls.current){camera.position.copy(target.clone().add(offset));controls.current.target.copy(target);controls.current.update();goal.current=null;invalidate();return}
    goal.current={position:target.clone().add(offset),target}
    invalidate()
  // Resize does not reset a user-controlled orbit; buttons provide explicit camera resets.
  },[view,exaggeration,radius])
  useFrame((_,delta)=>{
    if(!goal.current||!controls.current)return
    const g=goal.current,step=1-Math.exp(-Math.min(delta,.1)*6)
    camera.position.lerp(g.position,step);controls.current.target.lerp(g.target,step);controls.current.update()
    if(camera.position.distanceTo(g.position)<.1&&controls.current.target.distanceTo(g.target)<.1)goal.current=null
    else invalidate()
  })
  return null
}

class AtlasBoundary extends Component<{children:ReactNode;onError:()=>void},{failed:boolean}>{
  state={failed:false}
  static getDerivedStateFromError(){return {failed:true}}
  componentDidCatch(){this.props.onError()}
  render(){return this.state.failed?null:this.props.children}
}
