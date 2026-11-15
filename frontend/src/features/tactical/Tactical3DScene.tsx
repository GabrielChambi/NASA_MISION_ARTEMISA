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

export interface Tactical3DSceneProps {
  latDeg:number;lonDeg:number;observerHeightM:number
  sunAzimuthDeg:number;sunElevationDeg:number;earthAzimuthDeg:number;earthElevationDeg:number
  minSolarElevation:number;maxSlopeDeg:number;currentSlopeDeg:number
  atlasData:AtlasData|null;detailAtlasData?:AtlasData|null;contextAtlasData?:AtlasData|null
  sunRaycast:RaycastHit;earthRaycast:RaycastHit
  cameraView:'orbit'|'mast'|'top'|'polar';siteName:string
  placementMode?:boolean;onTogglePlacementMode?:()=>void
  onSurfacePlace?:(lat:number,lon:number)=>void;cameraResetKey?:number
  scienceReady?:boolean;assessmentRisk?:Risk;assessments?:CellAssessment[]
  active?:boolean;altitudeM?:number;landed?:boolean
}
const EXAGGERATION=1
const COLORS:Record<Risk,string>={green:'#62e6a0',yellow:'#f5cb67',red:'#ff797f',unknown:'#788e9e'}
function inside(data:AtlasData,x:number,y:number){
  const b=data.manifest.sample_extent_m
  return x>=b.xmin&&x<=b.xmax&&y>=b.ymin&&y<=b.ymax
}
function surfacePoint(data:AtlasData,lat:number,lon:number){
  const [x,y]=latLonToStereoM(lat,lon,data.manifest.radius_m)
  return sampleExactStereoMeshPoint(x,y,data.heights,data.manifest,EXAGGERATION,data.manifest.source_resolution_m===5?1:2)
}
function cellPosition(data:AtlasData,x:number,y:number,offset=0.0008){
  const sample=sampleExactStereoMeshPoint(x,y,data.heights,data.manifest,EXAGGERATION,1)
  const p=sample.position.clone()
  p.y+=offset
  return p
}
export function Tactical3DScene(props:Tactical3DSceneProps){
  const [dragging,setDragging]=useState(false)
  const [hover,setHover]=useState<[number,number]|null>(null)
  useEffect(()=>{
    const up=()=>setDragging(false)
    window.addEventListener('pointerup',up)
    return()=>window.removeEventListener('pointerup',up)
  },[])
  return <div className="tactical-canvas-container" style={{width:'100%',height:'100%',position:'relative',cursor:dragging?'grabbing':props.placementMode?'crosshair':'grab'}}>
    <div className="surface-tools">
      <button className="tactical-surface-place-btn" onClick={props.onTogglePlacementMode} aria-pressed={props.placementMode}>{props.placementMode?<Crosshair size={12}/>:<MapPin size={12}/>} {props.placementMode?'CLIC PARA ELEGIR DESTINO':'ELEGIR SOBRE LA SUPERFICIE'}</button>
      <span>{hover&&props.placementMode?hover[0].toFixed(5)+'°, '+hover[1].toFixed(5)+'°':'Arrastra para orbitar · rueda para acercar'}</span>
    </div>
    <Canvas frameloop={props.active===false?'never':'always'} dpr={[1,1.7]} camera={{position:[12,7,14],near:0.001,far:5000,fov:45}} gl={{antialias:true,alpha:false,localClippingEnabled:true}}>
      <color attach="background" args={['#03080d']}/>
      <ambientLight intensity={0.45}/>
      <Stars radius={1100} depth={200} count={2000} factor={2} fade/>
      {props.atlasData&&<Terrain {...props} dragging={dragging} onHover={setHover}/>}
      {props.atlasData&&<Spacecraft {...props} onDrag={()=>setDragging(true)}/>}
      {props.scienceReady&&props.detailAtlasData&&props.assessments?.length&&<LandingContours data={props.detailAtlasData} assessments={props.assessments}/>}
      {props.cameraView==='polar'&&props.atlasData&&<group>
        {props.atlasData.manifest.features.map(f=><Html key={f.name} position={projectedToWorld(f.x_m,f.y_m,f.elevation_m,1,props.atlasData!.manifest.radius_m)} center zIndexRange={[8,0]} style={{pointerEvents:'none'}}>
          <div className="polar-feature-label">{f.name}</div>
        </Html>)}
      </group>}
      <Camera {...props} dragging={dragging}/>
    </Canvas>
    {props.atlasData&&<div className="surface-destination" style={{borderColor:COLORS[props.assessmentRisk??'unknown']}}>
      <span className="destination-dot" style={{background:COLORS[props.assessmentRisk??'unknown']}}/>
      <div><strong>{props.landed?'CONTACTO · ':''}{props.siteName}</strong><small>{props.latDeg.toFixed(6)}°, {props.lonDeg.toFixed(6)}°{props.scienceReady?' · destino calculado':' · pendiente de simular'}</small></div>
    </div>}
  </div>
}
function clipBox(data:AtlasData|null|undefined) {
  if(!data)return []
  const b=data.manifest.sample_extent_m
  const points=[[b.xmin,b.ymin],[b.xmax,b.ymax],[b.xmin,b.ymax],[b.xmax,b.ymin]].map(([x,y])=>cellPosition(data,x,y,0))
  const overlap=.002
  const xmin=Math.min(...points.map(p=>p.x))+overlap,xmax=Math.max(...points.map(p=>p.x))-overlap
  const zmin=Math.min(...points.map(p=>p.z))+overlap,zmax=Math.max(...points.map(p=>p.z))-overlap
  return [new THREE.Plane(new THREE.Vector3(-1,0,0),xmin),new THREE.Plane(new THREE.Vector3(1,0,0),-xmax),new THREE.Plane(new THREE.Vector3(0,0,-1),zmin),new THREE.Plane(new THREE.Vector3(0,0,1),-zmax)]
}
function Terrain(props:Tactical3DSceneProps&{dragging:boolean;onHover:(v:[number,number]|null)=>void}){
  const regional=props.atlasData!,detail=props.detailAtlasData,context=props.contextAtlasData
  const geometry=useMemo(()=>buildAtlasGeometry(regional,EXAGGERATION,'elevation',2),[regional])
  const local=useMemo(()=>detail?buildAtlasGeometry(detail,EXAGGERATION,'natural',1):null,[detail])
  const middle=useMemo(()=>context?buildAtlasGeometry(context,EXAGGERATION,'natural',1):null,[context])
  useEffect(()=>()=>geometry.dispose(),[geometry])
  useEffect(()=>()=>local?.dispose(),[local])
  useEffect(()=>()=>middle?.dispose(),[middle])
  const planes=useMemo(()=>clipBox(context??detail),[context,detail])
  const localPlanes=useMemo(()=>clipBox(detail),[detail])
  const direction=props.scienceReady?bodyDirection({latitude_deg:props.latDeg,longitude_deg:props.lonDeg} as never,props.sunAzimuthDeg,props.sunElevationDeg):new THREE.Vector3(-1,1,0.2).normalize()
  function hit(e:ThreeEvent<PointerEvent|MouseEvent>,place:boolean){
    if(!props.placementMode&&!props.dragging&&!place)return
    // Three.js raycasters do not apply shader clipping planes.
    const clip=e.object.name==='regional-lola-terrain'?planes:e.object.name==='local-context-terrain'?localPlanes:[]
    if(clip.length&&clip.every(p=>p.distanceToPoint(e.point)<0))return
    e.stopPropagation()
    const vector=e.point.clone().add(new THREE.Vector3(0,regional.manifest.radius_m/1000,0)).normalize()
    const lat=-Math.asin(THREE.MathUtils.clamp(vector.y,-1,1))*180/Math.PI,lon=Math.atan2(-vector.x,vector.z)*180/Math.PI
    props.onHover([lat,lon])
    if(place||props.dragging)props.onSurfacePlace?.(lat,lon)
  }
  const handlers={onPointerMove:(e:ThreeEvent<PointerEvent>)=>hit(e,false),onClick:(e:ThreeEvent<MouseEvent>)=>{if(props.placementMode)hit(e,true)},onDoubleClick:(e:ThreeEvent<MouseEvent>)=>hit(e,true),onPointerOut:()=>props.onHover(null)}
  return <group>
    <directionalLight position={direction.clone().multiplyScalar(300)} color="#fff1d4" intensity={props.scienceReady?2:1.4}/>
    <directionalLight position={[70,100,-90]} color="#809fac" intensity={0.35}/>
    <mesh name="regional-lola-terrain" geometry={geometry} {...handlers}><meshStandardMaterial vertexColors roughness={.95} clippingPlanes={planes} clipIntersection/></mesh>
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
  const data=props.detailAtlasData??props.atlasData!
  const base=useMemo(()=>surfacePoint(data,props.latDeg,props.lonDeg),[data,props.latDeg,props.lonDeg])
  if(!Number.isFinite(base.position.y))return null
  const site={latitude_deg:props.latDeg,longitude_deg:props.lonDeg} as never
  const up=bodyDirection(site,0,90),position=base.position.clone().addScaledVector(up,(props.altitudeM??0)/1000)
  const rotation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),(props.altitudeM??0)>0?up:base.normal)
  // Visibility rays belong to the queried 2 m surface observer, including during descent.
  const emitter=base.position.clone().addScaledVector(up,props.observerHeightM/1000)
  const sun=emitter.clone().addScaledVector(bodyDirection(site,props.sunAzimuthDeg,props.sunElevationDeg),380)
  const earth=emitter.clone().addScaledVector(bodyDirection(site,props.earthAzimuthDeg,props.earthElevationDeg),340)
  const colour=COLORS[props.assessmentRisk??'unknown']
  return <group>
    <group position={position} quaternion={rotation} onPointerDown={e=>{e.stopPropagation();props.onDrag()}}>
      <LunarRocketLanderModel isSafe={props.assessmentRisk==='green'} scale={0.008} statusColor={colour}/>
      {(props.altitudeM??0)>0&&<mesh position={[0,-.008,0]} rotation={[Math.PI,0,0]}><coneGeometry args={[.003,.015,12]}/><meshBasicMaterial color="#8adaff" transparent opacity={.7}/></mesh>}
    </group>
    <group position={base.position} quaternion={new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),base.normal)}>
      <mesh raycast={()=>null}><ringGeometry args={[.015,.017,64]}/><meshBasicMaterial color={colour} side={THREE.DoubleSide} transparent opacity={.95}/></mesh>
      {props.landed&&<mesh raycast={()=>null}><circleGeometry args={[.007,24]}/><meshBasicMaterial color={colour} side={THREE.DoubleSide}/></mesh>}
    </group>
    {props.scienceReady&&<>
      <Line points={[emitter,sun]} color={props.sunRaycast.hit?'#ff797f':'#f5cb67'} lineWidth={1.2} transparent opacity={.6}/>
      <Line points={[emitter,earth]} color={props.earthRaycast.hit?'#ff797f':'#8ddfe9'} lineWidth={1.2} transparent opacity={.6}/>
      <mesh position={sun} raycast={()=>null}><sphereGeometry args={[5,32,24]}/><meshBasicMaterial color="#ffe8ad"/></mesh>
      <group position={earth}>
        <mesh raycast={()=>null}><sphereGeometry args={[7,40,32]}/><meshStandardMaterial color="#447fbc" roughness={1}/></mesh>
        <mesh raycast={()=>null}><sphereGeometry args={[7.06,24,16]}/><meshBasicMaterial color="#bfe2e4" wireframe transparent opacity={.16}/></mesh>
      </group>
    </>}
  </group>
}
function Camera(props:Tactical3DSceneProps&{dragging:boolean}){
  const {camera,size}=useThree(),controls=useRef<Controls>(null)
  const data=props.detailAtlasData??props.atlasData
  const target=useMemo(()=>data?surfacePoint(data,props.latDeg,props.lonDeg).position:new THREE.Vector3(),[data,props.latDeg,props.lonDeg])
  useEffect(()=>{
    if(!data||!controls.current||!Number.isFinite(target.y))return
    if(props.cameraView==='polar'){camera.position.set(185,140,225);controls.current.target.set(0,-8,0)}
    else if(props.cameraView==='top'){const height=Math.max(1.7,1.4/(2*Math.tan(Math.PI/8)*(size.width/Math.max(size.height,1))));camera.position.copy(target).add(new THREE.Vector3(.05,height,.01));controls.current.target.copy(target)}
    else if(props.cameraView==='mast'){
      const direction=bodyDirection({latitude_deg:props.latDeg,longitude_deg:props.lonDeg} as never,props.sunAzimuthDeg,props.sunElevationDeg)
      camera.position.copy(target).add(new THREE.Vector3(0,.04,.02));controls.current.target.copy(camera.position).addScaledVector(direction,.4)
    }else{const flying=(props.altitudeM??0)>0;camera.position.copy(target).add(flying?new THREE.Vector3(2.2,2.6,3):new THREE.Vector3(.85,.65,1.05));controls.current.target.copy(target).add(new THREE.Vector3(0,flying?.7:0,0))}
    controls.current.update()
    // Keep the user's orbit when placing a different cell manually.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[props.cameraView,props.cameraResetKey,Boolean(data),data?.manifest.sample_extent_m.xmin,Boolean((props.altitudeM??0)>0),size.width,size.height])
  useFrame(()=>{
    const region=props.atlasData
    if(!region)return
    const radial=camera.position.clone().add(new THREE.Vector3(0,region.manifest.radius_m/1000,0)).normalize()
    const lat=-Math.asin(THREE.MathUtils.clamp(radial.y,-1,1))*180/Math.PI,lon=Math.atan2(-radial.x,radial.z)*180/Math.PI
    const [x,y]=latLonToStereoM(lat,lon), terrain=props.detailAtlasData&&inside(props.detailAtlasData,x,y)?props.detailAtlasData:props.contextAtlasData&&inside(props.contextAtlasData,x,y)?props.contextAtlasData:region
    const h=surfacePoint(terrain,lat,lon).position.y
    if(Number.isFinite(h)&&camera.position.y<h+.003)camera.position.y=h+.003
  })
  return <OrbitControls ref={controls} enabled={!props.dragging} enableRotate={!props.placementMode} enableDamping dampingFactor={.08} minDistance={.025} maxDistance={400} maxPolarAngle={Math.PI*.51}/>
}
