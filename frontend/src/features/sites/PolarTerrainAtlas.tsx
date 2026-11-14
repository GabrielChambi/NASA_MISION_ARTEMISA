import { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, Line, OrbitControls } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
import { ArrowRight, Check, ChevronDown, Compass, Database, ExternalLink, Eye, EyeOff, Focus, Globe2, Layers3, LoaderCircle, MapPin, Maximize2, Minus, Mountain, Pause, Play, Plus, RotateCcw, Sun, TriangleAlert, X } from 'lucide-react'
import { useMission } from '../mission/MissionContext'
import type { LunarSite, SolarResult, SolarSample } from '../mission/types'
import { fetchSolar } from '../solar/SolarApiClient'
import { bodyDirection, buildAtlasGeometry, ELEVATION_COLORS, loadAtlas, projectedToWorld, siteWorld } from './atlasGeometry'
import type { AtlasColorMode, AtlasData, AtlasFeature } from './atlasGeometry'
import './polar-atlas.css'
import './atlas-refinements.css'

type ViewPreset = 'oblique' | 'polar' | 'site'
type Props = { sites: LunarSite[]; selectedSiteId: string; onSelectSite: (id: string) => void; solarResult?: SolarResult; onOpenSolar: () => void }
const primaryLabels = new Set(['Shackleton','Shoemaker','Haworth','de Gerlache','Faustini','Sverdrup','Nobile','Amundsen','Cabeus','Malapert','Mons Mouton','Wiechert'])

export default function PolarTerrainAtlas({ sites, selectedSiteId, onSelectSite, solarResult, onOpenSolar }: Props) {
  const { mission } = useMission()
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
    if(!solarResult||!selectedSite)return
    const controller=new AbortController();setEarth(null);setEarthError('')
    fetchSolar(selectedSiteId,mission,controller.signal,'earth').then(value=>{if(!controller.signal.aborted)setEarth(value)}).catch(err=>{if(!controller.signal.aborted)setEarthError(err.message)})
    return()=>controller.abort()
  // The serialized key represents all scientific inputs; the visible solar result is the prerequisite.
  },[selectedSiteId,missionKey,solarResult])
  useEffect(()=>{setSampleIndex(0);setPlaying(false)},[selectedSiteId,missionKey])
  const samples=solarResult?.samples||[]
  const index=Math.min(sampleIndex,Math.max(samples.length-1,0))
  const solar=samples[index]
  const earthSample=earth?.samples.find(s=>s.t_utc===solar?.t_utc)
  useEffect(()=>{
    if(!playing||samples.length<2)return
    const timer=window.setInterval(()=>setSampleIndex(value=>(value+1)%samples.length),700)
    return()=>window.clearInterval(timer)
  },[playing,samples.length])
  useEffect(()=>{
    const update=()=>setFullscreen(document.fullscreenElement===root.current)
    document.addEventListener('fullscreenchange',update);return()=>document.removeEventListener('fullscreenchange',update)
  },[])

  function setView(view:ViewPreset){setPreset(view);setCameraRevision(v=>v+1);setZoom(0);setRotate(false)}
  async function toggleFullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await root.current?.requestFullscreen()}catch{setError('Full-screen access was denied by this browser. The atlas remains available below.')}}

  return <section ref={root} className={`polar-atlas ${fullscreen?'atlas-fullscreen':''}`} aria-label="NASA lunar south pole 3D terrain atlas">
    <header className="atlas-header"><div><span className="atlas-kicker"><span/>LRO / LUNAR ORBITER LASER ALTIMETER</span><h3>The south pole, in perspective<span>.</span></h3><p>Real lunar topography. A different view of every possibility.</p></div><a className="atlas-source-badge" href="https://pgda.gsfc.nasa.gov/products/78" target="_blank" rel="noreferrer"><Database size={14}/><span>NASA LOLA<small>MEASURED ELEVATION</small></span><ExternalLink size={11}/></a></header>
    <div className="atlas-toolbar"><div className="atlas-segmented" aria-label="Terrain color mode"><button aria-pressed={mode==='elevation'} onClick={()=>setMode('elevation')}><Layers3 size={13}/>Elevation color</button><button aria-pressed={mode==='natural'} onClick={()=>setMode('natural')}><Mountain size={13}/>Monochrome relief</button></div><div className="atlas-toolbar-actions"><button onClick={()=>setLabels(v=>!v)} aria-pressed={labels}>{labels?<Eye size={13}/>:<EyeOff size={13}/>}<span>Feature labels</span></button><button onClick={()=>setShowDirections(v=>!v)} aria-pressed={showDirections}><Sun size={13}/><span>Sun & Earth</span></button><label>RELIEF<select aria-label="Vertical exaggeration" value={exaggeration} onChange={e=>setExaggeration(Number(e.target.value))}><option value={1}>1× true scale</option><option value={3}>3× display</option><option value={5}>5× display</option></select><ChevronDown size={11}/></label></div></div>

    <div className="atlas-viewport" data-testid="polar-atlas-viewport">
      {!atlas&&!error&&<div className="atlas-loading" role="status"><LoaderCircle size={23}/><strong>Reconstructing the lunar south pole</strong><span>Loading and verifying the NASA elevation mesh…</span></div>}
      {error&&!atlas&&<div className="atlas-loading atlas-error" role="alert"><TriangleAlert size={24}/><strong>Regional terrain unavailable</strong><span>{error}</span><button onClick={()=>setRetry(v=>v+1)}>Reload NASA terrain<RotateCcw size={13}/></button></div>}
      {webglError&&<div className="atlas-loading atlas-error" role="alert"><TriangleAlert size={24}/><strong>This browser could not start 3D</strong><span>Enable WebGL or hardware acceleration. The 2D map and scientific results remain available below.</span></div>}
      {atlas&&!webglError&&<AtlasBoundary onError={()=>setWebglError(true)}><Canvas frameloop="demand" dpr={[1,1.5]} camera={{position:[20,205,365],fov:47,near:0.2,far:2500}} gl={{antialias:true,alpha:false,powerPreference:'high-performance'}} onCreated={({gl})=>{gl.setClearColor('#03060a');gl.toneMapping=THREE.ACESFilmicToneMapping;gl.toneMappingExposure=1.15;gl.domElement.setAttribute('aria-label','NASA LOLA south pole terrain, rotate by dragging and zoom by scrolling');gl.domElement.setAttribute('role','img')}} fallback={<div className="atlas-loading atlas-error">WebGL unavailable. Use the 2D explorer below.</div>}><Suspense fallback={null}>
        <AtlasScene data={atlas} mode={mode} exaggeration={exaggeration} labelHost={labelHost} rotate={rotate&&!reducedMotion} preset={preset} cameraRevision={cameraRevision} zoom={zoom} selectedSite={selectedSite} sites={sites} showDirections={showDirections} solar={solar} earth={earthSample}/>
      </Suspense></Canvas></AtlasBoundary>}
      <div ref={labelHost} className="atlas-screen-labels">{atlas&&!webglError&&labels&&atlas.manifest.features.filter(f=>primaryLabels.has(f.name)).map(f=><button key={f.name} data-atlas-feature={f.name} className={`atlas-crater-label ${f.name==='Shackleton'?'atlas-label-pole':''}`} aria-label={`Inspect lunar feature ${f.name}`} onClick={()=>setFeature(f)}><span>{f.name}</span><i/></button>)}{atlas&&!webglError&&sites.map(site=><button key={site.id} data-atlas-site={site.id} className={`atlas-site-pin ${site.id==='site01'?'left':'right'} ${site.id===selectedSiteId?'selected':''}`} aria-label={`Select terrain region ${site.name}`} title={site.name} aria-pressed={site.id===selectedSiteId} onClick={()=>onSelectSite(site.id)}>{site.id==='site01'?'01':'04'}</button>)}</div>
      <div className="atlas-view-presets" aria-label="Terrain camera view">{(['oblique','polar','site'] as const).map(view=><button key={view} aria-pressed={preset===view} onClick={()=>setView(view)}>{view==='oblique'?<Mountain size={12}/>:view==='polar'?<Compass size={12}/>:<Focus size={12}/>}<span>{view==='oblique'?'Perspective':view==='polar'?'Polar view':'Focus region'}</span></button>)}</div>
      <div className="atlas-map-tools"><button aria-label="Zoom in terrain" title="Zoom in" onClick={()=>setZoom(v=>v+1)}><Plus size={16}/></button><button aria-label="Zoom out terrain" title="Zoom out" onClick={()=>setZoom(v=>v-1)}><Minus size={16}/></button><i/><button aria-label={rotate?'Pause terrain orbit':'Orbit terrain automatically'} title="Orbit terrain" aria-pressed={rotate} onClick={()=>setRotate(v=>!v)} disabled={reducedMotion}>{rotate?<Pause size={15}/>:<Play size={15}/>}</button><button aria-label="Reset terrain view" title="Reset terrain view" onClick={()=>setView('oblique')}><RotateCcw size={15}/></button><button aria-label={fullscreen?'Exit terrain fullscreen':'Expand terrain fullscreen'} title="Full screen" onClick={()=>void toggleFullscreen()}><Maximize2 size={15}/></button></div>
      <div className="atlas-legend"><span>{mode==='elevation'?'ELEVATION / LUNAR REFERENCE SPHERE':'RELIEF / INSPECTION LIGHTING'}</span>{mode==='elevation'&&<><i style={{background:`linear-gradient(90deg,${ELEVATION_COLORS.map(([,c])=>c).join(',')})`}}/><div><span>−7 km</span><span>0</span><span>+7 km</span></div></>}<small>Vertical display: {exaggeration}×<span>80 m source / {atlas?Math.round(atlas.manifest.display_spacing_m):'—'} m mesh</span></small></div>
      <div className="atlas-coordinate-stamp"><Compass size={13}/><span>SOUTH POLAR REGION<small>80° S — 90° S · EAST LONGITUDE</small></span></div>
      {feature&&<aside className="atlas-feature-detail"><button aria-label="Close feature details" onClick={()=>setFeature(null)}><X size={14}/></button><span className="atlas-kicker">IAU / USGS FEATURE</span><h4>{feature.name}</h4><p>{Math.abs(feature.latitude_deg).toFixed(3)}° S <span>/</span> {feature.longitude_east_deg.toFixed(3)}° E</p><div><span>DEM height at label</span><strong>{(feature.elevation_m/1000).toFixed(2)} km</strong></div><a href={feature.source_url} target="_blank" rel="noreferrer">Official nomenclature<ExternalLink size={10}/></a></aside>}
    </div>

    <div className="atlas-site-strip"><span><MapPin size={14}/>STUDY REGIONS</span><div>{sites.map(site=><button key={site.id} aria-pressed={site.id===selectedSiteId} onClick={()=>{onSelectSite(site.id);setFeature(null)}}><span>{site.id==='site01'?'01':'04'}</span>{site.name}{site.id===selectedSiteId?<Check size={12}/>:<ArrowRight size={12}/>}</button>)}</div><button className="atlas-open-science" onClick={onOpenSolar}>Study the solar window<ArrowRight size={13}/></button></div>
    <div className="atlas-time-panel"><div className="atlas-time-title"><span className="atlas-kicker">GEOMETRY AT THE SELECTED REGION</span><span><MapPin size={10}/>{selectedSite?.name||'Select a study region'}</span></div><div className="atlas-ephemeris-row"><BodyReadout name="Sun" sample={solar} error={!solar?'Solar ephemerides loading or unavailable.':undefined}/><BodyReadout name="Earth" sample={earthSample} error={earthError||(!earthSample?'Retrieving Earth ephemerides…':undefined)}/><div className="atlas-timeline"><div><button aria-label={playing?'Pause ephemeris timeline':'Play ephemeris timeline'} disabled={samples.length<2} onClick={()=>setPlaying(v=>!v)}>{playing?<Pause size={13}/>:<Play size={13}/>}</button><time>{solar?solar.t_utc.replace('T',' ').replace('Z',' UTC'):'Scientific data pending'}</time><span>{index+1}/{samples.length||'—'}</span></div><input aria-label="Terrain ephemeris time" type="range" min={0} max={Math.max(samples.length-1,1)} value={index} disabled={!samples.length} onChange={e=>{setPlaying(false);setSampleIndex(Number(e.target.value))}}/><small>JPL Horizons · {mission.stepMinutes}-minute samples · {mission.horizonMode==='terrain'?'LOLA terrain horizon':'flat horizon approximation'}</small></div></div></div>
    <footer className="atlas-provenance"><p><Database size={12}/><span><a href="https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF" target="_blank" rel="noreferrer">NASA / LOLA regional DEM</a> · <a href="https://planetarynames.wr.usgs.gov/GIS_Downloads" target="_blank" rel="noreferrer">IAU / USGS names</a> · <a href="https://svs.gsfc.nasa.gov/5127" target="_blank" rel="noreferrer">NASA visual reference<ExternalLink size={10}/></a></span></p><details><summary>Data, display & limits</summary><p>The surface is reconstructed from measured NASA elevations, with lunar curvature. Elevation colors and {exaggeration}× vertical exaggeration aid inspection. Lighting is illustrative; colors do not represent ice or instantaneous sunlight. The display mesh is downsampled from 80 m data; scientific horizons use the separate local and regional source rasters. Labels identify geographic features, not approved landing sites. Sun/Earth rays show sampled local directions, with schematic lengths; inspect visibility values rather than scene brightness.</p>{atlas&&<code>NASA source SHA-256: {atlas.manifest.source_sha256}<br/>Prepared: {atlas.manifest.prepared_at}</code>}</details></footer>
  </section>
}

function BodyReadout({name,sample,error}:{name:'Sun'|'Earth';sample?:SolarSample;error?:string}) {
  return <div className={`atlas-body-readout ${name==='Sun'?'atlas-sun':'atlas-earth'}`}><div>{name==='Sun'?<Sun size={17}/>:<Globe2 size={17}/>}<span>{name.toUpperCase()}<small>{sample?(sample.visible?'ABOVE SELECTED HORIZON':'BELOW / AT HORIZON'):error}</small></span><i className={sample?.visible?'visible':''}/></div><dl><div><dt>AZIMUTH</dt><dd>{sample?`${sample.azimuth_deg.toFixed(2)}°`:'—'}</dd></div><div><dt>ELEVATION</dt><dd>{sample?`${sample.elevation_deg.toFixed(2)}°`:'—'}</dd></div><div><dt>HORIZON</dt><dd>{sample?`${sample.horizon_deg.toFixed(2)}°`:'—'}</dd></div></dl></div>
}

function AtlasScene({data,mode,exaggeration,labelHost,rotate,preset,cameraRevision,zoom,selectedSite,sites,showDirections,solar,earth}:{data:AtlasData;mode:AtlasColorMode;exaggeration:number;labelHost:RefObject<HTMLDivElement|null>;rotate:boolean;preset:ViewPreset;cameraRevision:number;zoom:number;selectedSite?:LunarSite;sites:LunarSite[];showDirections:boolean;solar?:SolarSample;earth?:SolarSample}) {
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
      return <group key={site.id} position={pos}><mesh position={[0,.6,0]}><sphereGeometry args={[selected?1.1:.8,12,8]}/><meshBasicMaterial color={selected?'#e1eac5':'#a8c9dc'}/></mesh></group>
    })}
    {showDirections&&selectedSite&&[solar&&{sample:solar,name:'Sun',color:'#f3d48b'},earth&&{sample:earth,name:'Earth',color:'#9acbdc'}].filter(Boolean).map(item=>{
      if(!item)return null
      const origin=siteWorld(selectedSite,exaggeration,m.radius_m).add(new THREE.Vector3(0,1,0))
      const end=origin.clone().addScaledVector(bodyDirection(selectedSite,item.sample.azimuth_deg,item.sample.elevation_deg),80)
      return <group key={item.name}><Line points={[origin,end]} color={item.color} lineWidth={1.4} dashed={!item.sample.visible} dashSize={2} gapSize={1.5}/><mesh position={end}><sphereGeometry args={[1.6,16,12]}/><meshBasicMaterial color={item.color}/></mesh><Html position={end} center zIndexRange={[9,1]}><span className="atlas-body-label">{item.name} · {item.sample.elevation_deg.toFixed(2)}°</span></Html></group>
    })}
    <OrbitControls ref={controls} makeDefault autoRotate={rotate} autoRotateSpeed={.35} enableDamping dampingFactor={.1} minDistance={15} maxDistance={1000} minPolarAngle={.02} maxPolarAngle={Math.PI/2-.04} target={[0,-8,0]} zoomSpeed={.7} rotateSpeed={.6}/>
    <CameraDirector view={view} controls={controls} site={selectedSite} exaggeration={exaggeration} radius={m.radius_m}/>
    <ProjectLabels data={data} exaggeration={exaggeration} host={labelHost} sites={sites}/>
  </>
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
