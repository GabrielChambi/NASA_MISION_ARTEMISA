import { useMemo, useRef, useEffect } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, OrbitControls, Stars } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
import type { AtlasData } from '../sites/atlasGeometry'
import { buildAtlasGeometry } from '../sites/atlasGeometry'
import {
  latLonToStereoM,
  projectStereoTo3D,
  sampleLolaHeight,
  topocentricToWorldDirection,
  type RaycastHit,
} from './tacticalMath'

interface Tactical3DSceneProps {
  latDeg: number
  lonDeg: number
  observerHeightM: number
  sunAzimuthDeg: number
  sunElevationDeg: number
  earthAzimuthDeg: number
  earthElevationDeg: number
  minSolarElevation: number
  maxSlopeDeg: number
  currentSlopeDeg: number
  atlasData: AtlasData | null
  sunRaycast: RaycastHit
  earthRaycast: RaycastHit
  cameraView: 'orbit' | 'mast' | 'top'
  siteName: string
}

const EXAGGERATION = 2.5

export function Tactical3DScene(props: Tactical3DSceneProps) {
  return (
    <div className="tactical-canvas-container" style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Canvas
        camera={{ position: [0, 45, 75], fov: 42, near: 0.1, far: 5000 }}
        gl={{ antialias: true, alpha: false, toneMapping: THREE.ACESFilmicToneMapping }}
      >
        <color attach="background" args={['#03070b']} />
        <ambientLight intensity={0.12} />

        <Stars radius={400} depth={80} count={3500} factor={4} saturation={0.2} fade speed={0.4} />

        {props.atlasData && (
          <TerrainSurface
            atlasData={props.atlasData}
            latDeg={props.latDeg}
            lonDeg={props.lonDeg}
            sunAzimuthDeg={props.sunAzimuthDeg}
            sunElevationDeg={props.sunElevationDeg}
          />
        )}

        <LanderAndSurvivalRays {...props} />

        <CelestialBodies
          latDeg={props.latDeg}
          lonDeg={props.lonDeg}
          sunAzimuthDeg={props.sunAzimuthDeg}
          sunElevationDeg={props.sunElevationDeg}
          earthAzimuthDeg={props.earthAzimuthDeg}
          earthElevationDeg={props.earthElevationDeg}
        />

        <CameraController
          cameraView={props.cameraView}
          latDeg={props.latDeg}
          lonDeg={props.lonDeg}
          atlasData={props.atlasData}
        />
      </Canvas>

      <CompassOverlay sunAzimuthDeg={props.sunAzimuthDeg} earthAzimuthDeg={props.earthAzimuthDeg} />
    </div>
  )
}

function TerrainSurface({
  atlasData,
  latDeg,
  lonDeg,
  sunAzimuthDeg,
  sunElevationDeg,
}: {
  atlasData: AtlasData
  latDeg: number
  lonDeg: number
  sunAzimuthDeg: number
  sunElevationDeg: number
}) {
  const meshGeometry = useMemo(() => {
    return buildAtlasGeometry(atlasData, EXAGGERATION, 'natural', 3)
  }, [atlasData])

  const sunDir = useMemo(() => {
    return topocentricToWorldDirection(latDeg, lonDeg, sunAzimuthDeg, Math.max(sunElevationDeg, 0.2))
  }, [latDeg, lonDeg, sunAzimuthDeg, sunElevationDeg])

  return (
    <group>
      <directionalLight position={sunDir.clone().multiplyScalar(200)} intensity={1.85} color="#fff6e5" />
      <directionalLight position={[0, -100, 0]} intensity={0.08} color="#455a64" />
      <mesh geometry={meshGeometry} receiveShadow>
        <meshStandardMaterial
          vertexColors={false}
          color="#909aa2"
          roughness={0.92}
          metalness={0.06}
          flatShading={false}
        />
      </mesh>
    </group>
  )
}

function LanderAndSurvivalRays({
  latDeg,
  lonDeg,
  observerHeightM: _observerHeightM,
  sunAzimuthDeg,
  sunElevationDeg,
  earthAzimuthDeg,
  earthElevationDeg,
  minSolarElevation,
  maxSlopeDeg,
  currentSlopeDeg,
  atlasData,
  sunRaycast,
  earthRaycast,
  siteName,
}: Tactical3DSceneProps) {
  const manifest = atlasData?.manifest
  const heights = atlasData?.heights

  const landerWorld = useMemo(() => {
    if (!manifest || !heights) return new THREE.Vector3(0, 0, 0)
    const [xM, yM] = latLonToStereoM(latDeg, lonDeg, manifest.radius_m)
    const hM = sampleLolaHeight(xM, yM, heights, manifest)
    return projectStereoTo3D(xM, yM, hM, EXAGGERATION, manifest.radius_m)
  }, [latDeg, lonDeg, manifest, heights])

  const sunDir = useMemo(() => {
    return topocentricToWorldDirection(latDeg, lonDeg, sunAzimuthDeg, sunElevationDeg)
  }, [latDeg, lonDeg, sunAzimuthDeg, sunElevationDeg])

  const earthDir = useMemo(() => {
    return topocentricToWorldDirection(latDeg, lonDeg, earthAzimuthDeg, earthElevationDeg)
  }, [latDeg, lonDeg, earthAzimuthDeg, earthElevationDeg])

  const isSunBlocked = sunRaycast.hit || sunElevationDeg < minSolarElevation
  const isEarthBlocked = earthRaycast.hit || earthElevationDeg < 0.0
  const isSlopeHazard = currentSlopeDeg > maxSlopeDeg
  const isSafe = !isSunBlocked && !isEarthBlocked && !isSlopeHazard

  // Ray lengths in scene units (km)
  const sunRayLength = sunRaycast.hit && sunRaycast.hitPositionWorld
    ? landerWorld.distanceTo(sunRaycast.hitPositionWorld)
    : 160.0

  const earthRayLength = earthRaycast.hit && earthRaycast.hitPositionWorld
    ? landerWorld.distanceTo(earthRaycast.hitPositionWorld)
    : 140.0

  const sunEndpoint = useMemo(() => {
    if (sunRaycast.hit && sunRaycast.hitPositionWorld) {
      return sunRaycast.hitPositionWorld
    }
    return landerWorld.clone().addScaledVector(sunDir, sunRayLength)
  }, [landerWorld, sunDir, sunRayLength, sunRaycast])

  const earthEndpoint = useMemo(() => {
    if (earthRaycast.hit && earthRaycast.hitPositionWorld) {
      return earthRaycast.hitPositionWorld
    }
    return landerWorld.clone().addScaledVector(earthDir, earthRayLength)
  }, [landerWorld, earthDir, earthRayLength, earthRaycast])

  return (
    <group position={landerWorld}>
      {/* 3D Lunar Lander Vehicle */}
      <LanderModel isSafe={isSafe} />

      {/* Holographic Landing Safety Ellipse */}
      <LandingEllipse isSafe={isSafe} currentSlope={currentSlopeDeg} />

      {/* Sun Ray (Yellow when clear, Crimson when blocked) */}
      <SurvivalBeam
        start={[0, 0.45, 0]}
        end={sunEndpoint.clone().sub(landerWorld).toArray()}
        color={isSunBlocked ? '#ff3838' : '#ffd32a'}
        label={isSunBlocked ? '⚠️ SOL BLOQUEADO' : '☀️ SOL DESPEJADO'}
        blocked={isSunBlocked}
      />

      {/* Earth Ray (Cyan when clear, Crimson when blocked) */}
      <SurvivalBeam
        start={[0, 0.55, 0]}
        end={earthEndpoint.clone().sub(landerWorld).toArray()}
        color={isEarthBlocked ? '#ff3838' : '#00d2d3'}
        label={isEarthBlocked ? '⚠️ TIERRA BLOQUEADA' : '🌍 ENLACE TIERRA DIRECTO'}
        blocked={isEarthBlocked}
      />

      {/* Site HUD Annotation */}
      <Html position={[0, 1.4, 0]} center distanceFactor={18} zIndexRange={[100, 0]}>
        <div className={`tactical-lander-tag ${isSafe ? 'tag-safe' : 'tag-hazard'}`}>
          <div className="tag-dot" />
          <div className="tag-text">
            <strong>{siteName.toUpperCase()}</strong>
            <small>
              {Math.abs(latDeg).toFixed(4)}°S / {((lonDeg + 360) % 360).toFixed(4)}°E
            </small>
          </div>
        </div>
      </Html>
    </group>
  )
}

function LanderModel({ isSafe }: { isSafe: boolean }) {
  return (
    <group scale={[0.18, 0.18, 0.18]}>
      {/* Descent Stage Octagonal Body */}
      <mesh position={[0, 0.4, 0]}>
        <cylinderGeometry args={[1.2, 1.4, 0.8, 8]} />
        <meshStandardMaterial color="#c59b27" roughness={0.3} metalness={0.85} />
      </mesh>

      {/* Ascent Stage Cabin */}
      <mesh position={[0, 1.05, 0]}>
        <boxGeometry args={[1.3, 0.9, 1.2]} />
        <meshStandardMaterial color="#dcdde1" roughness={0.5} metalness={0.2} />
      </mesh>

      {/* Engine Bell */}
      <mesh position={[0, -0.1, 0]}>
        <coneGeometry args={[0.45, 0.6, 12, 1, true]} />
        <meshStandardMaterial color="#2f3640" roughness={0.8} metalness={0.6} side={THREE.DoubleSide} />
      </mesh>

      {/* 4 Landing Gear Legs */}
      {[0, 90, 180, 270].map((angle, i) => {
        const rad = (angle * Math.PI) / 180
        const legX = Math.sin(rad) * 1.6
        const legZ = Math.cos(rad) * 1.6
        return (
          <group key={i}>
            <mesh position={[legX * 0.55, 0.15, legZ * 0.55]} rotation={[0, rad, -0.45]}>
              <cylinderGeometry args={[0.04, 0.04, 1.4, 6]} />
              <meshStandardMaterial color="#718093" metalness={0.8} />
            </mesh>
            <mesh position={[legX, -0.25, legZ]}>
              <cylinderGeometry args={[0.22, 0.22, 0.06, 8]} />
              <meshStandardMaterial color="#c59b27" metalness={0.7} />
            </mesh>
          </group>
        )
      })}

      {/* High-Gain Antenna Mast */}
      <mesh position={[0.45, 1.8, 0.45]}>
        <cylinderGeometry args={[0.03, 0.03, 0.8, 6]} />
        <meshStandardMaterial color="#dcdde1" metalness={0.5} />
      </mesh>
      <mesh position={[0.45, 2.2, 0.45]} rotation={[0.4, 0.5, 0.2]}>
        <sphereGeometry args={[0.3, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#f5f6fa" roughness={0.3} metalness={0.6} side={THREE.DoubleSide} />
      </mesh>

      {/* Status Beacon on Top */}
      <mesh position={[0, 1.6, 0]}>
        <sphereGeometry args={[0.09, 8, 8]} />
        <meshBasicMaterial color={isSafe ? '#2ed573' : '#ff4757'} />
      </mesh>
    </group>
  )
}

function LandingEllipse({ isSafe }: { isSafe: boolean; currentSlope?: number }) {
  const ringRef = useRef<THREE.Mesh>(null)

  useFrame((_, delta) => {
    if (ringRef.current) {
      ringRef.current.rotation.z += delta * (isSafe ? 0.3 : 0.8)
    }
  })

  const color = isSafe ? '#2ed573' : '#ff4757'

  return (
    <group position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh ref={ringRef}>
        <ringGeometry args={[0.75, 0.88, 36]} />
        <meshBasicMaterial color={color} transparent opacity={0.75} side={THREE.DoubleSide} />
      </mesh>
      <mesh>
        <circleGeometry args={[0.75, 24]} />
        <meshBasicMaterial color={color} transparent opacity={0.12} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

function SurvivalBeam({
  start,
  end,
  color,
  blocked,
}: {
  start: [number, number, number]
  end: [number, number, number]
  color: string
  label?: string
  blocked: boolean
}) {
  const linePoints = useMemo(() => {
    return [new THREE.Vector3(...start), new THREE.Vector3(...end)]
  }, [start, end])

  const lineGeo = useMemo(() => {
    return new THREE.BufferGeometry().setFromPoints(linePoints)
  }, [linePoints])

  return (
    <group>
      {/* Laser line */}
      <primitive object={new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color, linewidth: 2 }))} />

      {/* Collision impact marker if blocked */}
      {blocked && (
        <group position={end}>
          <mesh>
            <sphereGeometry args={[0.25, 12, 12]} />
            <meshBasicMaterial color="#ff3838" />
          </mesh>
          <pointLight color="#ff3838" intensity={2.5} distance={5} />
          <Html position={[0, 0.5, 0]} center distanceFactor={16}>
            <div className="impact-beacon">
              <span>OBSTRUCCIÓN</span>
            </div>
          </Html>
        </group>
      )}
    </group>
  )
}

function CelestialBodies({
  latDeg,
  lonDeg,
  sunAzimuthDeg,
  sunElevationDeg,
  earthAzimuthDeg,
  earthElevationDeg,
}: {
  latDeg: number
  lonDeg: number
  sunAzimuthDeg: number
  sunElevationDeg: number
  earthAzimuthDeg: number
  earthElevationDeg: number
}) {
  const sunDir = useMemo(() => {
    return topocentricToWorldDirection(latDeg, lonDeg, sunAzimuthDeg, sunElevationDeg)
  }, [latDeg, lonDeg, sunAzimuthDeg, sunElevationDeg])

  const earthDir = useMemo(() => {
    return topocentricToWorldDirection(latDeg, lonDeg, earthAzimuthDeg, earthElevationDeg)
  }, [latDeg, lonDeg, earthAzimuthDeg, earthElevationDeg])

  const sunPos = sunDir.multiplyScalar(220)
  const earthPos = earthDir.multiplyScalar(190)

  return (
    <group>
      {/* Sun Body */}
      <mesh position={sunPos}>
        <sphereGeometry args={[4.5, 24, 24]} />
        <meshBasicMaterial color="#fffae6" />
      </mesh>

      {/* Earth Body (Blue Marble with Atmosphere Glow) */}
      <group position={earthPos}>
        <mesh>
          <sphereGeometry args={[3.2, 24, 24]} />
          <meshStandardMaterial color="#227093" roughness={0.4} metalness={0.1} />
        </mesh>
        <mesh scale={[1.08, 1.08, 1.08]}>
          <sphereGeometry args={[3.2, 24, 24]} />
          <meshBasicMaterial color="#00d2d3" transparent opacity={0.25} side={THREE.BackSide} />
        </mesh>
      </group>
    </group>
  )
}

function CameraController({
  cameraView,
  latDeg,
  lonDeg,
  atlasData,
}: {
  cameraView: 'orbit' | 'mast' | 'top'
  latDeg: number
  lonDeg: number
  atlasData: AtlasData | null
}) {
  const { camera } = useThree()
  const controlsRef = useRef<OrbitControlsImpl>(null)

  const landerTarget = useMemo(() => {
    if (!atlasData) return new THREE.Vector3(0, 0, 0)
    const [xM, yM] = latLonToStereoM(latDeg, lonDeg, atlasData.manifest.radius_m)
    const hM = sampleLolaHeight(xM, yM, atlasData.heights, atlasData.manifest)
    return projectStereoTo3D(xM, yM, hM, EXAGGERATION, atlasData.manifest.radius_m)
  }, [latDeg, lonDeg, atlasData])

  useEffect(() => {
    if (!controlsRef.current) return
    controlsRef.current.target.copy(landerTarget)

    if (cameraView === 'orbit') {
      camera.position.set(landerTarget.x + 6, landerTarget.y + 4.5, landerTarget.z + 8.5)
    } else if (cameraView === 'mast') {
      camera.position.set(landerTarget.x + 0.3, landerTarget.y + 1.2, landerTarget.z + 0.4)
    } else if (cameraView === 'top') {
      camera.position.set(landerTarget.x, landerTarget.y + 25, landerTarget.z + 0.1)
    }
    controlsRef.current.update()
  }, [cameraView, landerTarget, camera])

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.08}
      maxDistance={250}
      minDistance={1.2}
      maxPolarAngle={Math.PI / 2 + 0.05}
    />
  )
}

function CompassOverlay({
  sunAzimuthDeg,
  earthAzimuthDeg,
}: {
  sunAzimuthDeg: number
  earthAzimuthDeg: number
}) {
  return (
    <div className="tactical-compass-hud">
      <div className="compass-rose">
        <span className="compass-n">N</span>
        <span className="compass-e">E</span>
        <span className="compass-s">S</span>
        <span className="compass-w">W</span>
        <div
          className="compass-needle-sun"
          style={{ transform: `rotate(${sunAzimuthDeg}deg)` }}
          title={`Sol: ${sunAzimuthDeg.toFixed(1)}°`}
        />
        <div
          className="compass-needle-earth"
          style={{ transform: `rotate(${earthAzimuthDeg}deg)` }}
          title={`Tierra: ${earthAzimuthDeg.toFixed(1)}°`}
        />
      </div>
      <div className="compass-legend">
        <span className="c-sun">☀️ {sunAzimuthDeg.toFixed(1)}°</span>
        <span className="c-earth">🌍 {earthAzimuthDeg.toFixed(1)}°</span>
      </div>
    </div>
  )
}
