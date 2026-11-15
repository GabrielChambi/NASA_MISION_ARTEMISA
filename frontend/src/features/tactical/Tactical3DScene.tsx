import {useI18n} from '../../i18n/LanguageContext'
import {assessVisibility,scientificObserver,visibilityColor} from '../../../worker/visibility.mjs'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls, Stars, Line, Html } from '@react-three/drei'
import type { OrbitControls as Controls } from 'three-stdlib'
import * as THREE from 'three'
import { Crosshair, MapPin } from 'lucide-react'
import { buildAtlasGeometry, projectedToWorld, bodyDirection, type AtlasData } from '../sites/atlasGeometry'
import { latLonToStereoM, sampleExactStereoMeshPoint, type RaycastHit } from './tacticalMath'
import { LunarRocketLanderModel } from './LunarLanderModel'
import type { CellAssessment, Risk } from './landingScience'
import { loadLunarShading } from '../sites/lunarDetail'
import { findPolarCell,type PolarSurface,type PolarAssessment,type PolarCell } from './polarScience'
import {PolarCoverageLayer,type PolarCoverage} from './PolarCoverageLayer'
import {polarCellAtWorld} from './polarCoverage'

export type PlanMapMarker={id:string;latitude_deg:number;longitude_deg:number;kind:'best'|'alternative'|'rejected'|'unknown';label?:string}
export interface Tactical3DSceneProps {
  missionMarkers?:PlanMapMarker[];onMarkerSelect?:(id:string)=>void
  missionCoverage?:PolarCoverage;onCoverageSelect?:(cellId:string)=>void;onCoverageHover?:(cellId:string|null)=>void
  showSurfaceVehicle?:boolean
  latDeg:number;lonDeg:number;observerHeightM:number
  sunAzimuthDeg:number;sunElevationDeg:number;earthAzimuthDeg:number;earthElevationDeg:number
  minSolarElevation:number;maxSlopeDeg:number;currentSlopeDeg:number
  atlasData:AtlasData|null;focusTerrainData?:AtlasData|null;detailAtlasData?:AtlasData|null;contextAtlasData?:AtlasData|null
  sunRaycast:RaycastHit;earthRaycast:RaycastHit
  cameraView:'orbit'|'mast'|'top'|'polar';siteName:string
  placementMode?:boolean;onTogglePlacementMode?:()=>void
  onSurfacePlace?:(lat:number,lon:number)=>void;cameraResetKey?:number
  scienceReady?:boolean;assessmentRisk?:Risk;assessments?:CellAssessment[]
  active?:boolean;altitudeM?:number;landed?:boolean
  overview?:boolean;focusZone?:boolean;onShadingStatus?:(status:string)=>void;polarSurface?:PolarSurface|null;polarAssessments?:PolarAssessment[];polarSelection?:PolarCell|null
  solarPanelHeightM?:number;antennaHeightM?:number;landerName?:string;vehiclePulseKey?:number
  pinnedTarget?:{lat:number;lon:number;label?:string}|null
  scientificSurfaceElevationM?:number|null
  traverseRadiusKm?:number|null
  roverName?:string
  roverSpeed?:number
}
const EXAGGERATION=1
const COLORS:Record<Risk,string>={green:'#62e6a0',yellow:'#f5cb67',red:'#ff797f',unknown:'#788e9e'}
function inside(data:AtlasData,x:number,y:number){
  const b=data.manifest.sample_extent_m
  return x>=b.xmin&&x<=b.xmax&&y>=b.ymin&&y<=b.ymax
}
function surfacePoint(data:AtlasData,lat:number,lon:number){
  const [x,y]=latLonToStereoM(lat,lon,data.manifest.radius_m)
  return sampleExactStereoMeshPoint(x,y,data.heights,data.manifest,EXAGGERATION,1)
}
function cellPosition(data:AtlasData,x:number,y:number,offset=0.0008){
  const sample=sampleExactStereoMeshPoint(x,y,data.heights,data.manifest,EXAGGERATION,1)
  const p=sample.position.clone()
  p.y+=offset
  return p
}
export function Tactical3DScene(props:Tactical3DSceneProps){
 const {tr}=useI18n()

  const [dragging,setDragging]=useState(false)
  const [hover,setHover]=useState<[number,number]|null>(null)
  useEffect(()=>{
    const up=()=>setDragging(false)
    window.addEventListener('pointerup',up)
    return()=>window.removeEventListener('pointerup',up)
  },[])
  return <div className="tactical-canvas-container" style={{width:'100%',height:'100%',position:'relative',cursor:dragging?'grabbing':props.placementMode?'crosshair':'grab'}}>
    <div className="surface-tools" hidden={props.overview}>
      <button className="tactical-surface-place-btn" onClick={props.onTogglePlacementMode} aria-pressed={props.placementMode}>{props.placementMode?<Crosshair size={12}/>:<MapPin size={12}/>} {tr(props.placementMode?'CLIC PARA ELEGIR DESTINO':'ELEGIR SOBRE LA SUPERFICIE')}</button>
      <span>{tr(hover&&props.placementMode?hover[0].toFixed(5)+'°, '+hover[1].toFixed(5)+'°':'Arrastra para orbitar · rueda para acercar')}</span>
    </div>
    <Canvas frameloop={props.active===false?'never':'always'} dpr={[1,1.25]} camera={{position:[12,7,14],near:props.overview?0.1:0.001,far:props.overview?2500:5000,fov:45}} gl={{antialias:true,alpha:false,localClippingEnabled:true,powerPreference:'high-performance'}}>
      <color attach="background" args={['#03080d']}/>
      <ambientLight intensity={0.45}/>
      <Stars radius={1100} depth={200} count={900} factor={2} fade/>
      {props.atlasData&&<Terrain {...props} dragging={dragging} onHover={setHover}/>}
      {props.atlasData&&(!props.overview||props.showSurfaceVehicle||props.scienceReady)&&<Spacecraft {...props} onDrag={()=>setDragging(true)}/>}
      {props.scienceReady&&props.detailAtlasData&&props.assessments?.length&&<LandingContours data={props.detailAtlasData} assessments={props.assessments}/>}
      {props.cameraView==='polar'&&props.atlasData&&<group>
        {props.atlasData.manifest.features.map(f=><Html key={f.name} position={projectedToWorld(f.x_m,f.y_m,f.elevation_m,1,props.atlasData!.manifest.radius_m)} center zIndexRange={[8,0]} style={{pointerEvents:'none'}}>
          <div className="polar-feature-label">{tr(f.name)}</div>
        </Html>)}
      </group>}
      {props.overview&&props.polarSelection&&props.atlasData&&<PolarSelection data={props.atlasData} cell={props.polarSelection}/>}
      {props.atlasData&&props.pinnedTarget&&<PinnedPinMarker data={props.atlasData} pin={props.pinnedTarget}/>}
      {props.atlasData&&props.missionMarkers&&<MissionMarkers data={props.atlasData} markers={props.missionMarkers} onSelect={props.onMarkerSelect}/>}
      {props.atlasData&&props.traverseRadiusKm&&props.traverseRadiusKm>0&&<RoverTraverseRange data={props.atlasData} lat={props.latDeg} lon={props.lonDeg} radiusKm={props.traverseRadiusKm} roverName={props.roverName} roverSpeed={props.roverSpeed}/>}
      <Camera {...props} dragging={dragging}/>
    </Canvas>
    {props.atlasData&&!props.overview&&<div className="surface-destination" style={{borderColor:COLORS[props.assessmentRisk??'unknown']}}>
      <span className="destination-dot" style={{background:COLORS[props.assessmentRisk??'unknown']}}/>
      <div><strong>{tr(props.landed?'CONTACTO · ':'')}{tr(props.siteName)}</strong><small>{tr(props.latDeg.toFixed(6))}°, {tr(props.lonDeg.toFixed(6))}°{tr(props.scienceReady?' · destino calculado':' · pendiente de simular')}</small></div>
    </div>}
  </div>
}
function clipBox(data:AtlasData|null|undefined,overlap=.002) {
  if(!data)return []
  const b=data.manifest.sample_extent_m
  const points=[[b.xmin,b.ymin],[b.xmax,b.ymax],[b.xmin,b.ymax],[b.xmax,b.ymin]].map(([x,y])=>cellPosition(data,x,y,0))
  const xmin=Math.min(...points.map(p=>p.x))+overlap,xmax=Math.max(...points.map(p=>p.x))-overlap
  const zmin=Math.min(...points.map(p=>p.z))+overlap,zmax=Math.max(...points.map(p=>p.z))-overlap
  return [new THREE.Plane(new THREE.Vector3(-1,0,0),xmin),new THREE.Plane(new THREE.Vector3(1,0,0),-xmax),new THREE.Plane(new THREE.Vector3(0,0,-1),zmin),new THREE.Plane(new THREE.Vector3(0,0,1),-zmax)]
}
function visualGeometry(data:AtlasData,stride:number,props:Tactical3DSceneProps,localTexture=false){
  const g=buildAtlasGeometry(data,EXAGGERATION,props.overview?'natural':'elevation',stride)
  const positions=g.getAttribute('position'),colors=g.getAttribute('color')
  const uv=new Float32Array(positions.count*2),grid=Math.floor((data.manifest.grid_size-1)/stride)+1
  const b=data.manifest.sample_extent_m
  const assessments=new Map((props.polarAssessments??[]).map(a=>[a.cell.id,a.risk]))
  const base=new THREE.Color('#c9cbd0'),tint=new THREE.Color()
  for(let i=0;i<positions.count;i++){
    const x=b.xmin+(i%grid)*stride*data.manifest.display_spacing_m
    const y=b.ymax-Math.floor(i/grid)*stride*data.manifest.display_spacing_m
    // All tiles and the overview use one NASA south-polar projection texture.
    uv[i*2]=localTexture?(x-b.xmin)/(b.xmax-b.xmin):(x+304000)/608000;uv[i*2+1]=localTexture?(y-b.ymin)/(b.ymax-b.ymin):(y+304000)/608000
    if(props.overview&&props.polarSurface&&assessments.size){
      const rho=Math.hypot(x,y),lat=2*Math.atan2(rho,2*data.manifest.radius_m)*180/Math.PI-90,lon=Math.atan2(x,y)*180/Math.PI
      const c=findPolarCell(props.polarSurface,lat,lon),risk=c?assessments.get(c.id)??'unknown':'unknown'
      tint.copy(base).lerp(new THREE.Color(COLORS[risk]),.42)
      colors.setXYZ(i,tint.r,tint.g,tint.b)
    }
  }
  g.setAttribute('uv',new THREE.BufferAttribute(uv,2))
  return g
}
function Terrain(props:Tactical3DSceneProps&{dragging:boolean;onHover:(v:[number,number]|null)=>void}){
  const {gl}=useThree()
  const coverageHovered=useRef<string|null>(null)
  const regional=props.atlasData!,detail=props.detailAtlasData,context=props.contextAtlasData
  const stride=props.overview?3:2
  const [shading,setShading]=useState<THREE.Texture|null>(null)
  useEffect(()=>{
    if(!props.overview)return
    const ac=new AbortController()
    props.onShadingStatus?.('Cargando sombreado NASA…')
    let texture:THREE.Texture|null=null
    loadLunarShading(ac.signal).then(asset=>{
      if(ac.signal.aborted){asset.dispose();return}
      texture=new THREE.TextureLoader().load(asset.url,t=>{
        asset.dispose()
        if(ac.signal.aborted){t.dispose();return}
        t.colorSpace=THREE.SRGBColorSpace
        t.anisotropy=Math.min(8,gl.capabilities.getMaxAnisotropy())
        t.minFilter=THREE.LinearMipmapLinearFilter;t.magFilter=THREE.LinearFilter
        t.needsUpdate=true;setShading(t);props.onShadingStatus?.('Sombreado NASA ilustrativo · no representa el Sol de la misión')
      },undefined,()=>{asset.dispose();if(!ac.signal.aborted)props.onShadingStatus?.('Sombreado no disponible; relieve conservado')})
    }).catch(()=>{if(!ac.signal.aborted)props.onShadingStatus?.('Sombreado no disponible; relieve conservado')})
    return()=>{ac.abort();texture?.dispose()}
  },[props.overview,props.onShadingStatus,gl])
  const geometry=useMemo(()=>visualGeometry(regional,stride,props),[regional,stride,props.overview,props.polarSurface,props.polarAssessments])
  const focus=props.focusTerrainData
  const [localShading,setLocalShading]=useState<{id:string;texture:THREE.Texture}|null>(null)
  useEffect(()=>{
    if(!focus)return
    const ac=new AbortController()
    let texture:THREE.Texture|null=null
    loadLunarShading(ac.signal,focus.manifest.data_url).then(asset=>{
      if(ac.signal.aborted||!asset.local){asset.dispose();return}
      texture=new THREE.TextureLoader().load(asset.url,t=>{
        asset.dispose()
        if(ac.signal.aborted){t.dispose();return}
        t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=Math.min(8,gl.capabilities.getMaxAnisotropy())
        t.needsUpdate=true;setLocalShading({id:focus.manifest.data_url,texture:t})
      },undefined,()=>asset.dispose())
    }).catch(()=>{})
    return()=>{ac.abort();texture?.dispose()}
  },[focus,gl])
  const focusedTexture=focus&&localShading?.id===focus.manifest.data_url?localShading.texture:null
  const focusGeometry=useMemo(()=>{
    if(!focus)return null
    const g=visualGeometry(focus,2,props,Boolean(focusedTexture)),positions=g.getAttribute('position')
    const b=focus.manifest.sample_extent_m,side=Math.floor((focus.manifest.grid_size-1)/2)+1,spacing=focus.manifest.display_spacing_m*2
    const transition=regional.manifest.display_spacing_m*stride*2
    for(let i=0;i<positions.count;i++){
      const x=b.xmin+(i%side)*spacing,y=b.ymax-Math.floor(i/side)*spacing
      const distance=Math.min(x-b.xmin,b.xmax-x,y-b.ymin,b.ymax-y)
      if(distance>=transition)continue
      const coarse=sampleExactStereoMeshPoint(x,y,regional.heights,regional.manifest,1,stride)
      if(!Number.isFinite(coarse.position.y))continue
      const t=THREE.MathUtils.clamp(distance/transition,0,1),weight=t*t*(3-2*t)
      const precise=new THREE.Vector3().fromBufferAttribute(positions,i)
      precise.lerp(coarse.position,1-weight);positions.setXYZ(i,precise.x,precise.y,precise.z)
    }
    g.computeVertexNormals();g.computeBoundingSphere()
    return g
  },[focus,focusedTexture,regional,stride,props.overview,props.polarSurface,props.polarAssessments])
  useEffect(()=>()=>focusGeometry?.dispose(),[focusGeometry])
  const local=useMemo(()=>detail?buildAtlasGeometry(detail,EXAGGERATION,'natural',1):null,[detail])
  const middle=useMemo(()=>context?buildAtlasGeometry(context,EXAGGERATION,'natural',1):null,[context])
  useEffect(()=>()=>geometry.dispose(),[geometry])
  useEffect(()=>()=>local?.dispose(),[local])
  useEffect(()=>()=>middle?.dispose(),[middle])
  const planes=useMemo(()=>clipBox(context??detail??focus,(context||detail)?0.002:0.25),[context,detail,focus])
  const localPlanes=useMemo(()=>clipBox(detail),[detail])
  const direction=props.scienceReady?bodyDirection({latitude_deg:props.latDeg,longitude_deg:props.lonDeg} as never,props.sunAzimuthDeg,props.sunElevationDeg):new THREE.Vector3(-1,1,0.2).normalize()
  const hasCoverage=Boolean(props.missionCoverage&&props.polarSurface&&!props.showSurfaceVehicle)
  function hit(e:ThreeEvent<PointerEvent|MouseEvent>,place:boolean){
    if(props.showSurfaceVehicle)return
    if(!place&&!props.placementMode&&!props.dragging&&!hasCoverage)return
    // Three.js raycasters do not apply shader clipping planes.
    const clip=e.object.name==='regional-lola-terrain'?planes:e.object.name==='local-context-terrain'?localPlanes:[]
    if(clip.length&&clip.every(p=>p.distanceToPoint(e.point)<0))return
    e.stopPropagation()
    const vector=e.point.clone().add(new THREE.Vector3(0,regional.manifest.radius_m/1000,0)).normalize()
    const lat=-Math.asin(THREE.MathUtils.clamp(vector.y,-1,1))*180/Math.PI,lon=Math.atan2(-vector.x,vector.z)*180/Math.PI
    if(!props.overview)props.onHover([lat,lon])
    const cell=props.polarSurface?polarCellAtWorld(props.polarSurface,e.point):null
    if(coverageHovered.current!==(cell?.id??null)){coverageHovered.current=cell?.id??null;props.onCoverageHover?.(cell?.id??null)}
    if(place&&cell&&hasCoverage&&props.onCoverageSelect)props.onCoverageSelect(cell.id)
    if(place||props.dragging)props.onSurfacePlace?.(lat,lon)
  }
  const handlers=props.dragging
    ?{onPointerMove:(e:ThreeEvent<PointerEvent>)=>hit(e,false),onClick:(e:ThreeEvent<MouseEvent>)=>{if(e.delta<=5)hit(e,true)},onDoubleClick:(e:ThreeEvent<MouseEvent>)=>hit(e,true),onPointerOut:()=>{props.onHover(null);if(coverageHovered.current!==null){coverageHovered.current=null;props.onCoverageHover?.(null)}}}
    :{onClick:(e:ThreeEvent<MouseEvent>)=>{if(e.delta<=5)hit(e,true)},onDoubleClick:(e:ThreeEvent<MouseEvent>)=>hit(e,true),onPointerOut:()=>{if(coverageHovered.current!==null){coverageHovered.current=null;props.onCoverageHover?.(null)}}}
  return <group>
    <directionalLight position={direction.clone().multiplyScalar(300)} color="#fff1d4" intensity={props.scienceReady?2:1.4}/>
    <directionalLight position={[70,100,-90]} color="#809fac" intensity={0.35}/>
    <mesh name="regional-lola-terrain" geometry={geometry} {...handlers}><meshStandardMaterial vertexColors map={shading} roughness={1} clippingPlanes={planes} clipIntersection/></mesh>
    {hasCoverage&&props.polarSurface&&props.missionCoverage&&<PolarCoverageLayer geometry={geometry} surface={props.polarSurface} coverage={props.missionCoverage} clippingPlanes={planes}/>}
    {focusGeometry&&hasCoverage&&props.polarSurface&&props.missionCoverage&&<PolarCoverageLayer geometry={focusGeometry} surface={props.polarSurface} coverage={props.missionCoverage}/>}
    {focusGeometry&&<mesh name="lunar-detail-tile" geometry={focusGeometry} {...handlers}><meshStandardMaterial vertexColors map={focusedTexture??shading} roughness={1}/></mesh>}
    {middle&&<mesh name="local-context-terrain" geometry={middle} {...handlers}><meshStandardMaterial color="#99a8ae" roughness={1} clippingPlanes={localPlanes} clipIntersection/></mesh>}
    {local&&<mesh name="native-5m-lola-terrain" geometry={local} {...handlers}><meshStandardMaterial color="#a6afb6" roughness={1}/></mesh>}
  </group>
}

function LandingContours({data,assessments}:{data:AtlasData;assessments:CellAssessment[]}){
  const riskKey=assessments.map(a=>a.risk[0]).join('')
  const resources=useMemo(()=>{
    const fill:number[]=[],colours:number[]=[],lines:number[]=[],lineColours:number[]=[]
    const byIndex=new Map(assessments.map(a=>[a.cell.iy+':'+a.cell.ix,a]))
    function point(x:number,y:number){return cellPosition(data,x,y).toArray()}
    for(const a of assessments){
      const c=a.cell, colour=new THREE.Color(COLORS[a.risk])
      // Subdivide each cell on the 5 m DEM, so colours follow actual relief.
      for(let dy=-25;dy<25;dy+=5)for(let dx=-25;dx<25;dx+=5){
        const p=point(c.x_m+dx,c.y_m+dy),q=point(c.x_m+dx+5,c.y_m+dy),r=point(c.x_m+dx,c.y_m+dy+5),s=point(c.x_m+dx+5,c.y_m+dy+5)
        for(const v of [p,r,q,q,r,s]){fill.push(...v);colours.push(colour.r,colour.g,colour.b)}
      }
      // Shared boundaries appear only where classification changes.
      const boundaries=[
        {neighbor:byIndex.get(c.iy+':'+(c.ix-1)),x:-25,y:-25,dx:0,dy:5},
        {neighbor:byIndex.get(c.iy+':'+(c.ix+1)),x:25,y:-25,dx:0,dy:5},
        {neighbor:byIndex.get((c.iy-1)+':'+c.ix),x:-25,y:-25,dx:5,dy:0},
        {neighbor:byIndex.get((c.iy+1)+':'+c.ix),x:-25,y:25,dx:5,dy:0}]
      for(const b of boundaries)if(!b.neighbor||b.neighbor.risk!==a.risk){
        for(let k=0;k<10;k++){lines.push(...point(c.x_m+b.x+k*b.dx,c.y_m+b.y+k*b.dy),...point(c.x_m+b.x+(k+1)*b.dx,c.y_m+b.y+(k+1)*b.dy));lineColours.push(colour.r,colour.g,colour.b,colour.r,colour.g,colour.b)}
      }
    }
    const geometry=new THREE.BufferGeometry(),edges=new THREE.BufferGeometry()
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(fill,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colours,3))
    edges.setAttribute('position',new THREE.Float32BufferAttribute(lines,3));edges.setAttribute('color',new THREE.Float32BufferAttribute(lineColours,3))
    return {geometry,edges}
    // Colours/positions are unchanged when only numerical margins change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[data,riskKey])
  useEffect(()=>()=>{resources.geometry.dispose();resources.edges.dispose()},[resources])
  return <group name="calculated-landing-contours">
    <mesh geometry={resources.geometry} renderOrder={2} raycast={()=>null}><meshBasicMaterial vertexColors transparent opacity={0.25} side={THREE.DoubleSide} depthWrite={false} polygonOffset polygonOffsetFactor={-2}/></mesh>
    <lineSegments geometry={resources.edges} renderOrder={3} raycast={()=>null}><lineBasicMaterial vertexColors transparent opacity={0.95} depthWrite={false}/></lineSegments>
  </group>
}
function Spacecraft(props:Tactical3DSceneProps&{onDrag:()=>void}){
  const data=props.detailAtlasData??props.focusTerrainData??props.atlasData!
  const base=useMemo(()=>surfacePoint(data,props.latDeg,props.lonDeg),[data,props.latDeg,props.lonDeg])
  if(!Number.isFinite(base.position.y))return null
  const site={latitude_deg:props.latDeg,longitude_deg:props.lonDeg} as never
  const up=bodyDirection(site,0,90)
  const norm=base.normal.lengthSq()>0.5?base.normal:up
  const showVehicle=!props.overview||props.showSurfaceVehicle||props.focusZone
  const vehicleScale=props.focusZone&&!props.showSurfaceVehicle?0.45:0.008
  const groundOffset=vehicleScale*0.22+(props.overview?0.005:0.002)
  const position=base.position.clone().addScaledVector(norm,groundOffset).addScaledVector(up,(props.altitudeM??0)/1000)
  const rotation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),(props.altitudeM??0)>0?up:norm)
  const solarH=props.solarPanelHeightM??props.observerHeightM
  const antennaH=props.antennaHeightM??props.observerHeightM
  // Scientific rays originate at the declared surface observer, never at the enlarged display model.
  const [scienceX,scienceY]=latLonToStereoM(props.latDeg,props.lonDeg,data.manifest.radius_m)
  const scienceBase=typeof props.scientificSurfaceElevationM==='number'&&Number.isFinite(props.scientificSurfaceElevationM)
    ?projectedToWorld(scienceX,scienceY,props.scientificSurfaceElevationM,1,data.manifest.radius_m):base.position
  const solarEmitter=new THREE.Vector3().fromArray(scientificObserver(scienceBase.toArray(),up.toArray(),solarH))
  const earthEmitter=new THREE.Vector3().fromArray(scientificObserver(scienceBase.toArray(),up.toArray(),antennaH))
  const sunVisibility=assessVisibility(props.sunElevationDeg,props.sunRaycast.obstacleElevationDeg)
  const earthVisibility=assessVisibility(props.earthElevationDeg,props.earthRaycast.obstacleElevationDeg)

  const sun=solarEmitter.clone().addScaledVector(bodyDirection(site,props.sunAzimuthDeg,props.sunElevationDeg),380)
  const earth=earthEmitter.clone().addScaledVector(bodyDirection(site,props.earthAzimuthDeg,props.earthElevationDeg),340)
  const colour=COLORS[props.assessmentRisk??'unknown']
  return <group>
    {showVehicle&&<group position={position} quaternion={rotation} onPointerDown={e=>{e.stopPropagation();props.onDrag()}}>
      <LunarRocketLanderModel
        isSafe={props.assessmentRisk==='green'}
        scale={vehicleScale}
        statusColor={colour}
        solarPanelHeightM={solarH}
        antennaHeightM={antennaH}
        pulseKey={props.vehiclePulseKey}
      />
      {(props.altitudeM??0)>0&&<mesh position={[0,-.008,0]} rotation={[Math.PI,0,0]}><coneGeometry args={[.003,.015,12]}/><meshBasicMaterial color="#8adaff" transparent opacity={.7}/></mesh>}
    </group>}
    {showVehicle&&<group position={base.position} quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),base.normal)}>
      <mesh raycast={()=>null}><ringGeometry args={[.015,.017,64]}/><meshBasicMaterial color={colour} side={THREE.DoubleSide} transparent opacity={.95}/></mesh>
      {props.landed&&<mesh raycast={()=>null}><circleGeometry args={[.007,24]}/><meshBasicMaterial color={colour} side={THREE.DoubleSide}/></mesh>}
    </group>}
    {props.scienceReady&&<>
      <Line points={[solarEmitter,sun]} color={visibilityColor(sunVisibility.state,'sun')} lineWidth={2.4} transparent opacity={.92}/>
      <Line points={[earthEmitter,earth]} color={visibilityColor(earthVisibility.state,'earth')} lineWidth={2.2} transparent opacity={.9}/>
      <mesh position={sun} raycast={()=>null}><sphereGeometry args={[8,24,18]}/><meshBasicMaterial color="#ffe8ad"/></mesh>
      <group position={earth}>
        <mesh raycast={()=>null}><sphereGeometry args={[10,28,20]}/><meshStandardMaterial color="#447fbc" roughness={1}/></mesh>
        <mesh raycast={()=>null}><sphereGeometry args={[10.1,20,14]}/><meshBasicMaterial color="#bfe2e4" wireframe transparent opacity={.22}/></mesh>
      </group>
    </>}
  </group>
}
function Camera(props:Tactical3DSceneProps&{dragging:boolean}){
  const {camera,size}=useThree(),controls=useRef<Controls>(null)
  const lastCamPos=useRef(new THREE.Vector3())
  const data=props.detailAtlasData??(props.showSurfaceVehicle?props.focusTerrainData:null)??props.atlasData
  const target=useMemo(()=>data?surfacePoint(data,props.latDeg,props.lonDeg).position:new THREE.Vector3(),[data,props.latDeg,props.lonDeg])
  useEffect(()=>{
    // Whole-cap framing must remain available even when the selected edge cell
    // has no measured center height. Only close/local views need a valid target.
    const wholeCapView=props.overview&&props.cameraView==='polar'&&!props.focusZone
    if(!data||!controls.current||(!wholeCapView&&!Number.isFinite(target.y)))return
    // Flush residual orbit/pan inertia before applying a deliberate reset or view.
    // Otherwise OrbitControls adds the previous drag to the newly assigned pose.
    const damping=controls.current.enableDamping
    controls.current.enableDamping=false;controls.current.update();controls.current.enableDamping=damping
    camera.near=props.showSurfaceVehicle?.001:props.overview?.1:.001;camera.updateProjectionMatrix()
    if(props.cameraView==='polar'&&props.focusZone){camera.position.copy(target).add(new THREE.Vector3(16,20,26));controls.current.target.copy(target)}
    else if(props.cameraView==='polar'){
      // The oblique cap projects below its pole: center the projected footprint.
      // A width-dependent lower bound preserves the full 80 S rim on mobile.
      const fit=props.overview?Math.max(680,800/(size.width/Math.max(size.height,1))):400
      camera.position.copy(new THREE.Vector3(.6,.7,.65).normalize().multiplyScalar(fit))
      controls.current.target.set(0,props.overview?-80:-8,0)
    }
    else if(props.cameraView==='top'){const height=Math.max(1.7,1.4/(2*Math.tan(Math.PI/8)*(size.width/Math.max(size.height,1))));camera.position.copy(target).add(new THREE.Vector3(.05,height,.01));controls.current.target.copy(target)}
    else if(props.cameraView==='mast'){
      const direction=bodyDirection({latitude_deg:props.latDeg,longitude_deg:props.lonDeg} as never,props.sunAzimuthDeg,props.sunElevationDeg)
      camera.position.copy(target).add(new THREE.Vector3(0,.04,.02));controls.current.target.copy(camera.position).addScaledVector(direction,.4)
    }else{const flying=(props.altitudeM??0)>0;camera.position.copy(target).add(flying?new THREE.Vector3(2.2,2.6,3):new THREE.Vector3(.85,.65,1.05));controls.current.target.copy(target).add(new THREE.Vector3(0,flying?.7:0,0))}
    controls.current.update()
    // Keep the user's orbit when placing a different cell manually.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[props.cameraView,props.cameraResetKey,Boolean(data),data?.manifest.sample_extent_m.xmin,Boolean((props.altitudeM??0)>0),props.overview,props.showSurfaceVehicle,props.focusZone,props.focusZone?props.latDeg:0,props.focusZone?props.lonDeg:0,size.width,size.height])
  useFrame(()=>{
    const region=props.atlasData
    if(!region)return
    if(props.overview&&props.showSurfaceVehicle&&controls.current){
      const up=bodyDirection({latitude_deg:props.latDeg,longitude_deg:props.lonDeg} as never,0,90)
      const vehicle=target.clone().addScaledVector(up,(props.altitudeM??0)/1000)
      const offset=new THREE.Vector3(.14,.10,.18)
      camera.position.copy(vehicle).add(offset);controls.current.target.copy(vehicle);controls.current.update()
    }
    if(camera.position.distanceToSquared(lastCamPos.current)<1e-6)return
    lastCamPos.current.copy(camera.position)
    const radial=camera.position.clone().add(new THREE.Vector3(0,region.manifest.radius_m/1000,0)).normalize()
    const lat=-Math.asin(THREE.MathUtils.clamp(radial.y,-1,1))*180/Math.PI,lon=Math.atan2(-radial.x,radial.z)*180/Math.PI
    const [x,y]=latLonToStereoM(lat,lon), terrain=props.detailAtlasData&&inside(props.detailAtlasData,x,y)?props.detailAtlasData:props.contextAtlasData&&inside(props.contextAtlasData,x,y)?props.contextAtlasData:region
    const h=surfacePoint(terrain,lat,lon).position.y
    if(Number.isFinite(h)&&camera.position.y<h+.003)camera.position.y=h+.003
  })
  return <OrbitControls ref={controls} enabled={!props.dragging&&!props.showSurfaceVehicle} enableRotate={props.overview||!props.placementMode} enableDamping dampingFactor={.08} minDistance={.025} maxDistance={props.overview?1800:800} maxPolarAngle={Math.PI*.51}/>
}

function PolarSelection({data,cell}:{data:AtlasData;cell:PolarCell}){
  const position=surfacePoint(data,cell.latitude_deg,cell.longitude_deg).position.clone()
  if(!Number.isFinite(position.y))return null
  position.y+=1
  return <group position={position}>
    <mesh rotation={[-Math.PI/2,0,0]} raycast={()=>null}><ringGeometry args={[2.3,2.8,48]}/><meshBasicMaterial color="#ffffff" depthTest={false}/></mesh>
    <mesh position={[0,3,0]} raycast={()=>null}><cylinderGeometry args={[.12,.12,6,8]}/><meshBasicMaterial color="#ffffff" depthTest={false}/></mesh>
  </group>
}

function MissionMarkers({data,markers,onSelect}:{data:AtlasData;markers:PlanMapMarker[];onSelect?:(id:string)=>void}){
 const {tr}=useI18n()

  return <group name="calculated-mission-destinations">
    {markers.map((m,index)=>{
      const surface=surfacePoint(data,m.latitude_deg,m.longitude_deg)
      if(!Number.isFinite(surface.position.y))return null
      const color=m.kind==='rejected'?'#ff666f':m.kind==='unknown'?'#9aa6b0':'#73f2b3'
      const radius=m.kind==='best'?8:m.kind==='alternative'?5:3.5
      const up=bodyDirection({latitude_deg:m.latitude_deg,longitude_deg:m.longitude_deg} as never,0,90)
      const rotation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),up)
      return <group key={m.id} position={surface.position.clone().addScaledVector(up,.3)} quaternion={rotation} onClick={e=>{e.stopPropagation();onSelect?.(m.id)}}>
        <mesh renderOrder={30}><ringGeometry args={[radius*.76,radius,64]}/><meshBasicMaterial color={color} transparent opacity={.95} side={THREE.DoubleSide} depthTest={false} depthWrite={false}/></mesh>
        <mesh renderOrder={29}><circleGeometry args={[radius*.76,48]}/><meshBasicMaterial color={color} transparent opacity={.13} side={THREE.DoubleSide} depthTest={false} depthWrite={false}/></mesh>
        <Html center zIndexRange={[35,25]}><button type="button" aria-label={tr(m.kind==='best'?'Elegir mejor candidato':m.kind==='rejected'?'Ver zona descartada':'Elegir alternativa '+(m.label??String(index+1)))} onClick={e=>{e.stopPropagation();onSelect?.(m.id)}} className={'mission-marker-label '+m.kind}>{tr(m.kind==='best'?'★':m.kind==='rejected'?'×':m.label??String(index+1))}{m.kind==='best'&&<span>{tr("Mejor candidato")}</span>}</button></Html>
      </group>
    })}
  </group>
}

function PinnedPinMarker({data,pin}:{data:AtlasData;pin:{lat:number;lon:number;label?:string}}){
 const {tr}=useI18n()

  const surface=surfacePoint(data,pin.lat,pin.lon)
  if(!Number.isFinite(surface.position.y))return null
  const up=bodyDirection({latitude_deg:pin.lat,longitude_deg:pin.lon} as never,0,90)
  const rotation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),up)
  return (
    <group position={surface.position.clone().addScaledVector(up,.35)} quaternion={rotation}>
      <mesh renderOrder={40} raycast={()=>null}>
        <ringGeometry args={[5.5,7.2,48]}/>
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.92} side={THREE.DoubleSide} depthTest={false} depthWrite={false}/>
      </mesh>
      <mesh renderOrder={39} raycast={()=>null}>
        <circleGeometry args={[5.5,36]}/>
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.25} side={THREE.DoubleSide} depthTest={false} depthWrite={false}/>
      </mesh>
      <mesh renderOrder={41} raycast={()=>null}>
        <circleGeometry args={[1.8,24]}/>
        <meshBasicMaterial color="#ffffff" side={THREE.DoubleSide} depthTest={false} depthWrite={false}/>
      </mesh>
      <mesh position={[0,0,3.5]} rotation={[Math.PI/2,0,0]} renderOrder={42} raycast={()=>null}>
        <cylinderGeometry args={[0.2,0.3,7,12]}/>
        <meshBasicMaterial color="#38bdf8" depthTest={false}/>
      </mesh>
      <Html center zIndexRange={[50,35]}>
        <div className="tactical-pinned-flag">
          <span className="pinned-flag-dot"/>
          <strong>📍 {tr(pin.label??'Lugar fijado')}</strong>
        </div>
      </Html>
    </group>
  )
}

function RoverTraverseRange({
  data,
  lat,
  lon,
  radiusKm,
  roverName,
  roverSpeed
}: {
  data: AtlasData
  lat: number
  lon: number
  radiusKm: number
  roverName?: string
  roverSpeed?: number
}) {
  const {tr}=useI18n()
  const surface=surfacePoint(data,lat,lon)
  if(!Number.isFinite(surface.position.y))return null
  const up=bodyDirection({latitude_deg:lat,longitude_deg:lon} as never,0,90)
  const rotation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),up)
  const pos=surface.position.clone().addScaledVector(up,0.2)
  return (
    <group position={pos} quaternion={rotation} name="rover-traverse-range">
      {/* Outer exploration boundary ring */}
      <mesh renderOrder={32} raycast={()=>null}>
        <ringGeometry args={[radiusKm*0.96, radiusKm, 80]}/>
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.82} side={THREE.DoubleSide} depthTest={false} depthWrite={false}/>
      </mesh>
      {/* Semi-transparent reachable area */}
      <mesh renderOrder={31} raycast={()=>null}>
        <circleGeometry args={[radiusKm*0.96, 64]}/>
        <meshBasicMaterial color="#0284c7" transparent opacity={0.12} side={THREE.DoubleSide} depthTest={false} depthWrite={false}/>
      </mesh>
      {/* Mid-range safety checkpoint ring (50% distance for safe return) */}
      <mesh renderOrder={32} raycast={()=>null}>
        <ringGeometry args={[radiusKm*0.48, radiusKm*0.50, 48]}/>
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.38} side={THREE.DoubleSide} depthTest={false} depthWrite={false}/>
      </mesh>
      {/* Label hovering on the perimeter */}
      <Html position={[radiusKm*0.72, radiusKm*0.72, 0.5]} center zIndexRange={[45,30]}>
        <div className="rover-range-badge" title={tr("Radio de desplazamiento seguro ida y vuelta")}>
          <span className="rover-badge-title">🚗 {tr("Radio de acción:")} <b>{radiusKm.toFixed(1)} km</b></span>
          <small>{tr(roverName??'Rover')}{roverSpeed ? ` · ${roverSpeed} km/h` : ''} · {tr("ida y vuelta")}</small>
        </div>
      </Html>
    </group>
  )
}
