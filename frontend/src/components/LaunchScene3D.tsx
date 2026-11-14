import { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Line, useTexture } from '@react-three/drei'
import * as THREE from 'three'
import './launch-scene.css'
import moonTextureUrl from './scene/nasa-lroc-color.webp'
import earthTextureUrl from './scene/nasa-blue-marble.webp'

type MissionPhase = 'standby' | 'countdown' | 'transit'
type FlightStage = 'pad' | 'ignition' | 'ascent' | 'transfer' | 'descent' | 'landed'
type Vec3 = [number, number, number]

export interface LaunchScene3DProps {
  phase: MissionPhase
  seconds: number
  siteId: string
  effects: boolean
  active?: boolean
  onArrival?: () => void
}

const stageNames: Record<FlightStage, string> = {
  pad: 'PRE-LAUNCH · LC–39B',
  ignition: 'ENGINE IGNITION',
  ascent: 'LIFTOFF · EARTH DEPARTURE',
  transfer: 'TRANSLUNAR COAST',
  descent: 'LUNAR DESCENT',
  landed: 'TOUCHDOWN CONFIRMED',
}
const smooth = (value: number) => THREE.MathUtils.smoothstep(value, 0, 1)

function seededRandom(seed: number) {
  let value = seed
  return () => { value = (value * 16807) % 2147483647; return (value - 1) / 2147483646 }
}

function Beam({ from, to, radius = 0.055, color = '#725045' }: { from: Vec3; to: Vec3; radius?: number; color?: string }) {
  const { midpoint, quaternion, length } = useMemo(() => {
    const a = new THREE.Vector3(...from)
    const b = new THREE.Vector3(...to)
    const direction = b.clone().sub(a)
    return { midpoint: a.add(b).multiplyScalar(0.5), quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize()), length: direction.length() }
  }, [from, to])
  return <mesh position={midpoint} quaternion={quaternion} castShadow><cylinderGeometry args={[radius, radius, length, 6]} /><meshStandardMaterial color={color} roughness={0.65} metalness={0.6} /></mesh>
}

function NightSky({ space }: { space: boolean }) {
  const material = useMemo(() => new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uSpace: { value: 0 } },
    vertexShader: 'varying vec3 vPosition; void main(){vPosition=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'uniform float uSpace;varying vec3 vPosition;void main(){float h=normalize(vPosition).y;vec3 top=vec3(.012,.026,.063);vec3 middle=vec3(.095,.145,.225);vec3 sunset=vec3(.25,.145,.10);vec3 sky=mix(middle,top,smoothstep(.01,.65,h));sky=mix(sunset,sky,smoothstep(-.08,.09,h));sky=mix(sky,vec3(.002,.005,.012),uSpace);gl_FragColor=vec4(sky,1.0);}',
  }), [])
  useEffect(() => () => material.dispose(), [material])
  useEffect(() => { material.uniforms.uSpace.value = space ? 1 : 0 }, [space, material])
  return <mesh material={material}><sphereGeometry args={[450, 32, 24]} /></mesh>
}

function StarField() {
  const positions = useMemo(() => {
    const random = seededRandom(1949)
    const array = new Float32Array(2300 * 3)
    for (let i = 0; i < 2300; i++) {
      const theta = random() * Math.PI * 2
      const cosine = random() * 1.6 - 0.6
      const sine = Math.sqrt(1 - cosine * cosine)
      const distance = 180 + random() * 100
      array.set([Math.cos(theta) * sine * distance, cosine * distance, Math.sin(theta) * sine * distance], i * 3)
    }
    return array
  }, [])
  return <points><bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry><pointsMaterial color="#c6d9eb" size={0.16} sizeAttenuation transparent opacity={0.82} fog={false} depthWrite={false} /></points>
}

function Planet({ earth = false, radius = 3, position }: { earth?: boolean; radius?: number; position: Vec3 }) {
  const texture = useTexture(earth ? earthTextureUrl : moonTextureUrl)
  useEffect(() => { texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4 }, [texture])
  const geometry = useMemo(() => {
    const result = new THREE.SphereGeometry(radius, 56, 40)
    const p = result.attributes.position
    const colors = []
    const point = new THREE.Vector3()
    const base = new THREE.Color()
    for (let i = 0; i < p.count; i++) {
      point.fromBufferAttribute(p, i).normalize()
      const n = Math.sin(point.x * 17 + Math.cos(point.z * 13)) * Math.sin(point.y * 15 + point.z * 8)
      const detail = Math.sin(point.x * 63 + point.y * 47) * Math.cos(point.z * 52)
      if (earth) {
        const land = Math.sin(point.x * 9 + point.z * 3) * Math.cos(point.y * 8 + point.x * 3) + Math.sin(point.z * 14) * 0.25
        base.set(Math.abs(point.y) > 0.9 ? '#c5d9dc' : land > 0.38 ? '#5d785c' : '#1c5773')
        if (Math.sin(point.x * 34 + point.y * 20 + point.z * 27) > 0.86) base.lerp(new THREE.Color('#c7d7d7'), 0.55)
      } else {
        base.set('#a8aca7').multiplyScalar(0.74 + n * 0.15 + detail * 0.045)
        point.multiplyScalar(radius * (1 + detail * 0.0017))
        p.setXYZ(i, point.x, point.y, point.z)
      }
      colors.push(base.r, base.g, base.b)
    }
    result.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    result.computeVertexNormals()
    return result
  }, [earth, radius])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <group position={position}><mesh geometry={geometry} rotation={[0, earth ? Math.PI * 0.6 : Math.PI * 0.3, 0]} castShadow><meshStandardMaterial map={texture} color="#ffffff" roughness={earth ? 0.75 : 1} metalness={0} /></mesh>{earth && <mesh scale={1.025}><sphereGeometry args={[radius, 40, 28]} /><meshBasicMaterial color="#629bb5" transparent opacity={0.11} side={THREE.BackSide} depthWrite={false} /></mesh>}</group>
}

function EngineFlame({ strength, effects }: { strength: number; effects: boolean }) {
  const flame = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (flame.current) flame.current.scale.set(1 + (effects ? Math.sin(clock.elapsedTime * 38) * 0.07 : 0), strength * (1 + (effects ? Math.sin(clock.elapsedTime * 57) * 0.13 : 0)), 1)
  })
  return <group ref={flame} visible={strength > 0.01} position={[0, 0.2, 0]}>
    <mesh position={[0, -2.2, 0]} rotation={[Math.PI, 0, 0]}><coneGeometry args={[0.66, 4.8, 12, 1, true]} /><meshBasicMaterial color="#ff7e37" transparent opacity={0.45} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} /></mesh>
    <mesh position={[0, -1.35, 0]} rotation={[Math.PI, 0, 0]}><coneGeometry args={[0.35, 3, 14]} /><meshBasicMaterial color="#ffd498" transparent opacity={0.9} blending={THREE.AdditiveBlending} depthWrite={false} /></mesh>
    <mesh position={[0, -0.6, 0]} rotation={[Math.PI, 0, 0]}><coneGeometry args={[0.22, 1.5, 14]} /><meshBasicMaterial color="#f4fbff" toneMapped={false} /></mesh>
    <pointLight position={[0, -1, 0]} color="#ffb06a" intensity={110 * strength} distance={24} decay={2} />
  </group>
}

function RocketModel({ engineStrength, effects }: { engineStrength: number; effects: boolean }) {
  return <group>
    <mesh position={[0, 6.9, 0]} castShadow><cylinderGeometry args={[0.74, 0.79, 10.8, 32]} /><meshStandardMaterial color="#b66c33" roughness={0.82} metalness={0.12} /></mesh>
    {[2, 2.18, 10.3, 11.8, 12.05].map(y => <mesh key={y} position={[0, y, 0]}><cylinderGeometry args={[0.755, 0.755, 0.12, 32]} /><meshStandardMaterial color={y > 11 ? '#d3d9d6' : '#74462a'} roughness={0.6} metalness={0.3} /></mesh>)}
    <mesh position={[0, 12.85, 0]} castShadow><cylinderGeometry args={[0.54, 0.73, 1.2, 32]} /><meshStandardMaterial color="#d4d9d6" metalness={0.25} roughness={0.5} /></mesh>
    <mesh position={[0, 13.9, 0]} castShadow><cylinderGeometry args={[0.43, 0.54, 0.9, 32]} /><meshStandardMaterial color="#e5e5dd" roughness={0.55} /></mesh>
    <mesh position={[0, 14.8, 0]} castShadow><coneGeometry args={[0.43, 0.95, 32]} /><meshStandardMaterial color="#e5e7df" roughness={0.6} /></mesh>
    <mesh position={[0, 15.65, 0]}><cylinderGeometry args={[0.045, 0.12, 1.1, 12]} /><meshStandardMaterial color="#bdc7c5" metalness={0.6} roughness={0.3} /></mesh>
    <mesh position={[0, 16.33, 0]}><coneGeometry args={[0.045, 0.3, 8]} /><meshStandardMaterial color="#d0d8d6" /></mesh>
    {[-1.17, 1.17].map(x => <group key={x} position={[x, 0, 0]}>
      <mesh position={[0, 6.1, 0]} castShadow><cylinderGeometry args={[0.34, 0.36, 9.2, 24]} /><meshStandardMaterial color="#d3d7d1" roughness={0.62} metalness={0.16} /></mesh>
      <mesh position={[0, 11.2, 0]} castShadow><coneGeometry args={[0.34, 1, 24]} /><meshStandardMaterial color="#d7ddd6" roughness={0.7} /></mesh>
      {[2.15, 2.4, 4.2, 6.2, 8.25, 10.25].map(y => <mesh key={y} position={[0, y, 0]}><cylinderGeometry args={[0.353, 0.353, 0.08, 24]} /><meshStandardMaterial color={y < 2.5 ? '#4d5558' : '#b5bbb6'} metalness={0.4} roughness={0.6} /></mesh>)}
      <mesh position={[0, 1.28, 0]}><cylinderGeometry args={[0.21, 0.34, 0.6, 16]} /><meshStandardMaterial color="#45494a" metalness={0.8} roughness={0.4} /></mesh>
      <group position={[0, 0.9, 0]} scale={[0.65, 0.65, 0.65]}><EngineFlame strength={engineStrength} effects={effects} /></group>
    </group>)}
    {[-0.28, 0.28].flatMap(x => [-0.28, 0.28].map(z => <mesh key={`${x}-${z}`} position={[x, 1.1, z]}><cylinderGeometry args={[0.15, 0.24, 0.65, 16]} /><meshStandardMaterial color="#343d40" roughness={0.35} metalness={0.8} /></mesh>))}
    <mesh position={[0.19, 7.7, 0.745]}><boxGeometry args={[0.12, 3.1, 0.035]} /><meshStandardMaterial color="#d4cdc1" metalness={0.4} roughness={0.6} /></mesh>
    <mesh position={[-0.25, 9.8, 0.72]}><boxGeometry args={[0.24, 0.5, 0.035]} /><meshStandardMaterial color="#d9d6c7" roughness={0.7} /></mesh>
    <group position={[0, 0.8, 0]}><EngineFlame strength={engineStrength} effects={effects} /></group>
  </group>
}

function LaunchTower() {
  const levels = Array.from({ length: 9 }, (_, index) => index * 1.9 + 0.5)
  return <group position={[2.9, 0, -1.8]}>
    {[-0.9, 0.9].flatMap(x => [-0.9, 0.9].map(z => <Beam key={`${x}-${z}`} from={[x, 0, z]} to={[x, 18, z]} radius={0.09} color="#8a5d4b" />))}
    {levels.map((y, i) => <group key={y}>
      <mesh position={[0, y, 0]}><boxGeometry args={[2.1, 0.11, 2.1]} /><meshStandardMaterial color="#9b9585" metalness={0.8} roughness={0.5} /></mesh>
      <Beam from={[-0.9, y, 0.9]} to={[0.9, y + 1.8, 0.9]} radius={0.045} />
      <Beam from={[0.9, y, -0.9]} to={[0.9, y + 1.8, 0.9]} radius={0.045} />
      <Beam from={[-0.9, y, -0.9]} to={[-0.9, y + 1.8, 0.9]} radius={0.045} />
      {i % 2 === 0 && <mesh position={[-1.5, y + 0.17, 0]}><boxGeometry args={[1.7, 0.22, 0.55]} /><meshStandardMaterial color="#9d9c8a" metalness={0.65} roughness={0.5} /></mesh>}
      <mesh position={[0.8, y + 0.7, 0.98]}><boxGeometry args={[0.06, 0.2, 0.04]} /><meshBasicMaterial color="#d6a36a" /></mesh>
    </group>)}
    <mesh position={[0, 18, 0]}><boxGeometry args={[2.15, 0.6, 2.15]} /><meshStandardMaterial color="#745449" roughness={0.7} metalness={0.5} /></mesh>
    <pointLight position={[0, 17.5, 1.3]} color="#ffc183" intensity={8} distance={10} />
  </group>
}

function LaunchGround() {
  return <group>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.06, 0]} receiveShadow><planeGeometry args={[280, 280]} /><meshStandardMaterial color="#182825" roughness={0.96} /></mesh>
    <mesh position={[0, 0.2, 0]} receiveShadow><cylinderGeometry args={[5.2, 6, 0.5, 8]} /><meshStandardMaterial color="#666d65" roughness={0.8} metalness={0.25} /></mesh>
    <mesh position={[0, 0.54, 0]} receiveShadow><boxGeometry args={[5, 0.2, 4.5]} /><meshStandardMaterial color="#4a5350" roughness={0.65} metalness={0.65} /></mesh>
    <mesh position={[0, 0.04, 34]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[6.4, 65]} /><meshStandardMaterial color="#4a5151" roughness={0.9} /></mesh>
    <mesh position={[-24, -0.03, 11]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[30, 75]} /><meshStandardMaterial color="#10242e" roughness={0.24} metalness={0.5} /></mesh>
    {[-9, 10].flatMap(x => [-7, 9].map(z => <group key={`${x}-${z}`} position={[x, 0, z]}>
      <Beam from={[0, 0, 0]} to={[0, 22, 0]} radius={0.055} color="#5e6b70" />
      <Beam from={[-1, 0, 0]} to={[0, 15, 0]} radius={0.035} color="#5e6b70" />
      <Beam from={[1, 0, 0]} to={[0, 15, 0]} radius={0.035} color="#5e6b70" />
      <mesh position={[0, 22, 0]}><sphereGeometry args={[0.08, 6, 6]} /><meshBasicMaterial color="#dd735b" /></mesh>
    </group>))}
    {[-6, 6].flatMap(x => [-3, 5, 12, 23, 35, 49].map(z => <group key={`${x}-${z}`} position={[x, 0, z]}>
      <mesh position={[0, 0.4, 0]}><boxGeometry args={[0.28, 0.8, 0.28]} /><meshStandardMaterial color="#64716b" /></mesh>
      <mesh position={[0, 0.83, 0]}><sphereGeometry args={[0.1, 8, 6]} /><meshBasicMaterial color="#f3deae" toneMapped={false} /></mesh>
    </group>))}
    <spotLight position={[-7, 6, 9]} target-position={[0, 9, 0]} color="#d2e5e2" intensity={800} angle={0.65} penumbra={0.7} distance={45} castShadow shadow-mapSize={[1024, 1024]} />
    <spotLight position={[8, 4, 5]} target-position={[0, 8, 0]} color="#ffd4a7" intensity={650} angle={0.75} penumbra={0.8} distance={40} />
  </group>
}

function Vapor({ strength, effects }: { strength: number; effects: boolean }) {
  const group = useRef<THREE.Group>(null)
  const puffs = useMemo(() => {
    const random = seededRandom(510)
    return Array.from({ length: 22 }, (_, i) => ({ phase: random() * 6, x: (random() - 0.5) * 2, z: (random() - 0.5) * 2, size: 0.3 + random() * 0.4, i }))
  }, [])
  useFrame(({ clock }) => {
    if (!group.current) return
    group.current.children.forEach((object, i) => {
      const t = (clock.elapsedTime * (effects ? 0.65 : 0) + puffs[i].phase) % 6
      object.position.set(-1 + puffs[i].x - t * 0.55, 8 + t * 0.6, puffs[i].z)
      object.scale.setScalar(puffs[i].size + t * 0.16)
      const mesh = object as THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
      mesh.material.opacity = (1 - t / 6) * (0.055 + strength * 0.06)
    })
  })
  return <group ref={group}>{puffs.map(puff => <mesh key={puff.i}><sphereGeometry args={[1, 8, 6]} /><meshBasicMaterial color="#cad6dd" transparent opacity={0.06} depthWrite={false} /></mesh>)}</group>
}

function Spacecraft({ engineStrength, effects }: { engineStrength: number; effects: boolean }) {
  return <group>
    <mesh position={[0, 0.25, 0]} castShadow><cylinderGeometry args={[0.65, 0.85, 0.9, 8]} /><meshStandardMaterial color="#bc9b56" metalness={0.72} roughness={0.45} flatShading /></mesh>
    <mesh position={[0, 1.13, 0]} castShadow><cylinderGeometry args={[0.42, 0.64, 0.85, 8]} /><meshStandardMaterial color="#d5d9cf" metalness={0.55} roughness={0.4} /></mesh>
    <mesh position={[0, 1.7, 0]}><coneGeometry args={[0.43, 0.4, 8]} /><meshStandardMaterial color="#c8d3ce" metalness={0.65} roughness={0.4} /></mesh>
    <mesh position={[0, 1.25, 0.52]}><boxGeometry args={[0.4, 0.25, 0.03]} /><meshStandardMaterial color="#203c49" metalness={0.65} roughness={0.2} /></mesh>
    {[0, Math.PI / 2, Math.PI, Math.PI * 1.5].map(angle => <group key={angle} rotation={[0, angle, 0]}>
      <Beam from={[0.5, 0.3, 0]} to={[1.55, -0.85, 0]} radius={0.055} color="#afaba0" />
      <Beam from={[0.65, -0.2, 0]} to={[1.3, -0.7, 0]} radius={0.035} color="#aa9467" />
      <mesh position={[1.55, -0.9, 0]}><cylinderGeometry args={[0.28, 0.32, 0.07, 12]} /><meshStandardMaterial color="#a8aca6" metalness={0.6} roughness={0.5} /></mesh>
    </group>)}
    <mesh position={[0, -0.4, 0]}><cylinderGeometry args={[0.2, 0.4, 0.55, 16]} /><meshStandardMaterial color="#41494a" metalness={0.8} roughness={0.4} /></mesh>
    <group position={[0, -0.7, 0]} scale={0.58}><EngineFlame strength={engineStrength} effects={effects} /></group>
    <Beam from={[0.3, 1.4, 0]} to={[0.6, 2.7, 0]} radius={0.025} color="#c5c6b8" />
  </group>
}

interface TerrainPreview {
  width: number
  height: number
  elevations_m: number[]
  extent_m: { xmin: number; ymin: number; xmax: number; ymax: number }
  observer_elevation_m: number
}

function LunarTerrain({ siteId, onQuality, onCenterHeight }: { siteId: string; onQuality: (available: boolean) => void; onCenterHeight: (height: number) => void }) {
  const [terrain, setTerrain] = useState<TerrainPreview | null>(null)
  useEffect(() => {
    const abort = new AbortController()
    setTerrain(null)
    onQuality(false)
    onCenterHeight(0)
    void fetch(`/api/sites/${encodeURIComponent(siteId)}/terrain`, { signal: abort.signal })
      .then(response => { if (!response.ok) throw new Error('NASA terrain preview unavailable'); return response.json() as Promise<TerrainPreview> })
      .then(result => {
        if (!Number.isInteger(result.width) || !Number.isInteger(result.height) || result.width < 2 || result.width > 256 || result.height < 2 || result.height > 256 || result.elevations_m.length !== result.width * result.height || !result.elevations_m.every(Number.isFinite) || !Number.isFinite(result.observer_elevation_m) || result.extent_m.xmax <= result.extent_m.xmin) throw new Error('Invalid terrain preview')
        setTerrain(result)
        onQuality(true)
        const centerX = (result.width - 1) / 2
        const centerY = (result.height - 1) / 2
        const x0 = Math.floor(centerX)
        const y0 = Math.floor(centerY)
        const fx = centerX - x0
        const fy = centerY - y0
        const value = (x: number, y: number) => result.elevations_m[Math.min(y, result.height - 1) * result.width + Math.min(x, result.width - 1)]
        const height = value(x0, y0) * (1 - fx) * (1 - fy) + value(x0 + 1, y0) * fx * (1 - fy) + value(x0, y0 + 1) * (1 - fx) * fy + value(x0 + 1, y0 + 1) * fx * fy
        onCenterHeight((height - result.observer_elevation_m) * 160 / (result.extent_m.xmax - result.extent_m.xmin))
      })
      .catch(() => { if (!abort.signal.aborted) onQuality(false) })
    return () => abort.abort()
  }, [siteId, onQuality, onCenterHeight])
  const geometry = useMemo(() => {
    if (terrain) {
      const widthM = terrain.extent_m.xmax - terrain.extent_m.xmin
      const depthM = terrain.extent_m.ymax - terrain.extent_m.ymin
      const worldScale = 160 / widthM
      const result = new THREE.PlaneGeometry(160, depthM * worldScale, terrain.width - 1, terrain.height - 1)
      result.rotateX(-Math.PI / 2)
      const positions = result.attributes.position
      for (let i = 0; i < positions.count; i++) positions.setY(i, (terrain.elevations_m[i] - terrain.observer_elevation_m) * worldScale)
      result.computeVertexNormals()
      return result
    }
    const random = seededRandom(siteId === 'site01' ? 1959 : 1969)
    const craters = Array.from({ length: 27 }, () => ({ x: (random() - 0.5) * 125, z: (random() - 0.5) * 125, radius: 2 + random() * 9, depth: 0.5 + random() * 2 }))
      .filter(crater => Math.hypot(crater.x, crater.z) > crater.radius + 5)
    const ground = new THREE.PlaneGeometry(160, 160, 112, 112)
    ground.rotateX(-Math.PI / 2)
    const positions = ground.attributes.position
    const colors: number[] = []
    const color = new THREE.Color()
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i)
      const z = positions.getZ(i)
      let h = (Math.sin(x * 0.2) * Math.cos(z * 0.16) + Math.sin(x * 0.6 + z * 0.3) * 0.2) * 0.16
      for (const crater of craters) {
        const d = Math.hypot(x - crater.x, z - crater.z)
        if (d < crater.radius) h -= crater.depth * Math.pow(1 - d * d / (crater.radius * crater.radius), 1.3)
        h += crater.depth * 0.35 * Math.exp(-Math.pow((d - crater.radius) / 0.7, 2))
      }
      if (Math.hypot(x, z) < 5) h *= Math.min(Math.hypot(x, z) / 5, 1)
      positions.setY(i, h)
      color.set('#8e9493').multiplyScalar(0.85 + Math.sin(x * 1.2 + z * 0.9) * 0.035 + h * 0.035)
      colors.push(color.r, color.g, color.b)
    }
    ground.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    ground.computeVertexNormals()
    return ground
  }, [siteId, terrain])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <mesh geometry={geometry} receiveShadow><meshStandardMaterial vertexColors={!terrain} color={terrain ? '#929695' : '#ffffff'} roughness={1} metalness={0} /></mesh>
}

function LandingBeacon({ landed, effects, elevation }: { landed: boolean; effects: boolean; elevation: number }) {
  const ring = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (ring.current) {
      const scale = effects && !landed ? 1 + Math.sin(clock.elapsedTime * 2) * 0.1 : 1
      ring.current.scale.setScalar(scale)
    }
  })
  return <group position={[0, elevation + 0.12, 0]}>
    <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[2.6, 2.64, 64]} /><meshBasicMaterial color="#bbd8ad" transparent opacity={0.7} depthWrite={false} /></mesh>
    {[-1, 1].flatMap(x => [-1, 1].map(z => <group key={`${x}-${z}`} position={[x * 2.1, 0, z * 2.1]}><mesh><cylinderGeometry args={[0.025, 0.025, 0.9, 6]} /><meshStandardMaterial color="#b3b6a6" /></mesh><mesh position={[0, 0.5, 0]}><sphereGeometry args={[0.055, 8, 6]} /><meshBasicMaterial color="#d0e9bb" toneMapped={false} /></mesh></group>))}
  </group>
}

function SceneDirector({ phase, seconds, effects, siteId, onStage, onArrival, onTerrainQuality, reducedMotion }: LaunchScene3DProps & { onStage: (stage: FlightStage) => void; onTerrainQuality: (available: boolean) => void; reducedMotion: boolean }) {
  const rocket = useRef<THREE.Group>(null)
  const shuttle = useRef<THREE.Group>(null)
  const lander = useRef<THREE.Group>(null)
  const launchWorld = useRef<THREE.Group>(null)
  const transferWorld = useRef<THREE.Group>(null)
  const moonWorld = useRef<THREE.Group>(null)
  const startedAt = useRef<number | null>(null)
  const stageRef = useRef<FlightStage>('pad')
  const deliveredArrival = useRef(false)
  const callbackRef = useRef(onArrival)
  const [engineStrength, setEngineStrength] = useState(0)
  const [landerEngine, setLanderEngine] = useState(0)
  const [landed, setLanded] = useState(false)
  const [surfaceHeight, setSurfaceHeight] = useState(0)
  const cameraTarget = useMemo(() => new THREE.Vector3(), [])
  const lookTarget = useMemo(() => new THREE.Vector3(), [])
  const currentLook = useRef(new THREE.Vector3(0, 8, 0))
  const { camera, size } = useThree()
  callbackRef.current = onArrival
  const cruisePath = useMemo(() => new THREE.CatmullRomCurve3([new THREE.Vector3(-22, -2, 16), new THREE.Vector3(-12, 9, 8), new THREE.Vector3(4, 12, -3), new THREE.Vector3(25, 5, -13)]), [])
  const routePoints = useMemo(() => cruisePath.getPoints(100), [cruisePath])

  useEffect(() => {
    startedAt.current = null
    deliveredArrival.current = false
    setLanded(false)
    setEngineStrength(phase === 'countdown' ? 0.13 : 0)
    setLanderEngine(0)
  }, [phase])

  useFrame(({ clock, pointer }, delta) => {
    let time = 0
    if (phase === 'transit') {
      startedAt.current ??= clock.elapsedTime
      time = reducedMotion ? 28 : clock.elapsedTime - startedAt.current
    }
    const stage: FlightStage = phase === 'standby' ? 'pad' : phase === 'countdown' ? 'ignition' : time < 8 ? 'ascent' : time < 18 ? 'transfer' : time < 28 ? 'descent' : 'landed'
    if (stage !== stageRef.current) {
      stageRef.current = stage
      onStage(stage)
      setEngineStrength(stage === 'ascent' ? 1 : stage === 'ignition' ? 0.13 : 0)
      setLanderEngine(stage === 'descent' ? 0.6 : 0)
      setLanded(stage === 'landed')
    }
    const lunar = stage === 'descent' || stage === 'landed'
    if (launchWorld.current) launchWorld.current.visible = !lunar && stage !== 'transfer'
    if (transferWorld.current) transferWorld.current.visible = stage === 'transfer'
    if (moonWorld.current) moonWorld.current.visible = lunar

    if (stage === 'pad' || stage === 'ignition') {
      const sway = effects ? Math.sin(clock.elapsedTime * 0.1) * 0.65 : 0
      cameraTarget.set(20 + sway + (reducedMotion ? 0 : pointer.x * 0.65), 12.5 + (reducedMotion ? 0 : pointer.y * 0.45), size.width < 650 ? 40 : 35)
      lookTarget.set(-1.8, 8.3, 0)
      if (rocket.current) { rocket.current.position.set(0, 0.6, 0); rocket.current.rotation.set(0, 0, 0) }
      const desiredFlame = stage === 'ignition' ? Math.min((11 - seconds) * 0.07, 0.65) : 0
      if (Math.abs(engineStrength - desiredFlame) > 0.025) setEngineStrength(desiredFlame)
    } else if (stage === 'ascent') {
      const progress = time / 8
      const height = Math.pow(progress, 1.8) * 62
      if (rocket.current) {
        rocket.current.position.set(progress * progress * 6, height + 0.6, -progress * 4)
        rocket.current.rotation.z = -progress * 0.12
      }
      cameraTarget.set(21 + progress * 9, 13 + height * 0.74, 36 + progress * 9)
      lookTarget.set(progress * 6, height + 8, -progress * 4)
    } else if (stage === 'transfer') {
      const progress = smooth((time - 8) / 10)
      const point = cruisePath.getPoint(progress)
      if (shuttle.current) { shuttle.current.position.copy(point); shuttle.current.rotation.set(0.1, 0, -0.85) }
      cameraTarget.set(10 + progress * 17, 16 - progress * 2, 49 - progress * 22)
      lookTarget.copy(point).multiplyScalar(0.5).add(new THREE.Vector3(5, 0, -6))
    } else {
      const progress = smooth(Math.min((time - 18) / 10, 1))
      const side = siteId === 'site01' ? -1 : 1
      if (lander.current) {
        lander.current.position.set(side * (1 - progress) * 6, surfaceHeight + 1.05 + (1 - progress) * 17, (1 - progress) * -4)
        lander.current.rotation.set(0, Math.PI * 0.16, side * (1 - progress) * 0.07)
      }
      cameraTarget.set(18 - progress * 5, surfaceHeight + 12 - progress * 5.3, 30 - progress * 8)
      lookTarget.set(0, surfaceHeight + 3.4 + (1 - progress) * 7, 0)
      if (stage === 'landed' && !deliveredArrival.current) { deliveredArrival.current = true; callbackRef.current?.() }
    }
    const lerp = 1 - Math.exp(-delta * (effects ? 2.8 : 5))
    if (reducedMotion) { camera.position.copy(cameraTarget); currentLook.current.copy(lookTarget) }
    else { camera.position.lerp(cameraTarget, lerp); currentLook.current.lerp(lookTarget, lerp) }
    camera.lookAt(currentLook.current)
  })

  return <>
    <NightSky space={phase === 'transit'} /><StarField />
    <ambientLight intensity={0.28} color="#99b9d0" />
    <hemisphereLight args={['#b9cddd', '#263027', 0.62]} />
    <directionalLight position={[-35, 25, 10]} color="#d8ded6" intensity={2.2} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-40} shadow-camera-right={40} shadow-camera-top={40} shadow-camera-bottom={-40} shadow-camera-far={160} shadow-bias={-0.0006} />
    <group ref={launchWorld}>
      <LaunchGround /><LaunchTower />
      <group ref={rocket} position={[0, 0.6, 0]}><RocketModel engineStrength={engineStrength} effects={effects} /></group>
      <Vapor strength={phase === 'countdown' ? 1 : 0} effects={effects} />
      <Planet position={[-5, 26, -60]} radius={3.8} />
    </group>
    <group ref={transferWorld} visible={false}>
      <Planet earth position={[-35, -18, -28]} radius={18} />
      <Planet position={[33, 4, -26]} radius={9} />
      <Line points={routePoints} color="#bcd2b9" lineWidth={0.8} transparent opacity={0.24} dashed dashSize={0.5} gapSize={0.65} />
      <group ref={shuttle}><Spacecraft engineStrength={0.15} effects={effects} /></group>
    </group>
    <group ref={moonWorld} visible={false}>
      <LunarTerrain siteId={siteId} onQuality={onTerrainQuality} onCenterHeight={setSurfaceHeight} />
      <LandingBeacon landed={landed} effects={effects} elevation={surfaceHeight} />
      <Planet earth position={[-35, 20, -90]} radius={6} />
      <group ref={lander}><Spacecraft engineStrength={landerEngine} effects={effects} /></group>
      <directionalLight position={[-45, 7, -20]} intensity={1.7} color="#f2ead7" />
    </group>
  </>
}

class SceneBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onFailure() }
  render() { return this.state.failed ? null : this.props.children }
}

export default function LaunchScene3D(props: LaunchScene3DProps) {
  const [stage, setStage] = useState<FlightStage>('pad')
  const [failed, setFailed] = useState(false)
  const [ready, setReady] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [nasaTerrain, setNasaTerrain] = useState(false)
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(preference.matches)
    update()
    preference.addEventListener('change', update)
    return () => preference.removeEventListener('change', update)
  }, [])

  return <div className={`launch-scene launch-scene--${stage}`} data-scene="real-time-3d" data-stage={stage}>
    <SceneBoundary onFailure={() => setFailed(true)}>
      {!failed && <Canvas frameloop={props.active === false ? 'never' : 'always'} shadows dpr={[1, 1.5]} camera={{ position: [20, 12.5, 35], fov: 42, near: 0.1, far: 650 }} gl={{ antialias: true, powerPreference: 'high-performance', alpha: false }} onCreated={({ gl }) => {
        gl.setClearColor('#08121f')
        gl.toneMapping = THREE.ACESFilmicToneMapping
        gl.toneMappingExposure = 1.25
        gl.domElement.setAttribute('aria-label', 'Interactive 3D Artemis launch and lunar landing cinematic')
        gl.domElement.setAttribute('role', 'img')
        gl.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); setFailed(true) }, { once: true })
        setReady(true)
      }} fallback={<div className="launch-scene-unavailable">WebGL is unavailable. The scientific explorer remains available.</div>}>
        <Suspense fallback={null}><SceneDirector {...props} effects={props.effects && !reducedMotion} reducedMotion={reducedMotion} onStage={setStage} onTerrainQuality={setNasaTerrain} /></Suspense>
      </Canvas>}
    </SceneBoundary>
    {!ready && !failed && <div className="launch-scene-loading"><span /><small>PREPARING 3D MISSION ENVIRONMENT</small></div>}
    {failed && <div className="launch-scene-unavailable"><span className="fallback-orbit" /><strong>3D rendering unavailable</strong><span>Your browser could not start WebGL. NASA data and the mission controls remain available.</span></div>}
    <div className="flight-stage-badge" aria-live="polite"><span className="flight-live-dot" /><span>{stageNames[stage]}</span><small>{stage === 'descent' || stage === 'landed' ? `${props.siteId === 'site01' ? 'CONNECTING RIDGE' : 'SHACKLETON RIM'} · ${nasaTerrain ? 'NASA LOLA LOCAL DEM' : 'CONCEPTUAL TERRAIN'}` : 'REAL-TIME 3D · CINEMATIC FLIGHT'}</small></div>
  </div>
}
