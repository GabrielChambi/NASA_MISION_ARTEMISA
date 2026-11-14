import { useMemo, useRef, useEffect, useState, useCallback } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Html, OrbitControls, Stars, Line } from '@react-three/drei'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import * as THREE from 'three'
import {
  Crosshair,
  MapPin,
  Lock,
  Navigation,
  AlertTriangle,
  Check,
  Sun,
  Globe2,
} from 'lucide-react'
import type { AtlasData } from '../sites/atlasGeometry'
import { buildAtlasGeometry } from '../sites/atlasGeometry'
import {
  MESH_STRIDE,
  TERRAIN_EXAGGERATION,
  sampleExactMeshSurface,
  sampleLolaSlope,
  latLonToStereoM,
  topocentricToWorldDirection,
  world3DToLatLon,
  type RaycastHit,
} from './tacticalMath'

export interface Tactical3DSceneProps {
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
  placementMode?: boolean
  onTogglePlacementMode?: () => void
  onSurfacePlace?: (latDeg: number, lonDeg: number) => void
  cameraResetKey?: number
}

const SKY_SUN_DISTANCE = 380.0
const SKY_EARTH_DISTANCE = 340.0
const CONSTANT_ROCKET_SCALE = 0.42

/**
 * Generates a procedural Blue Marble Earth texture (oceans, continents, polar caps, clouds).
 */
function createEarthTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256
  const ctx = canvas.getContext('2d')!

  // Deep ocean gradient
  const oceanGrad = ctx.createLinearGradient(0, 0, 0, 256)
  oceanGrad.addColorStop(0, '#0b2545')
  oceanGrad.addColorStop(0.2, '#0d47a1')
  oceanGrad.addColorStop(0.5, '#1565c0')
  oceanGrad.addColorStop(0.8, '#0d47a1')
  oceanGrad.addColorStop(1, '#0b2545')
  ctx.fillStyle = oceanGrad
  ctx.fillRect(0, 0, 512, 256)

  // Helper to paint organic landmass blobs
  const drawLand = (cx: number, cy: number, rx: number, ry: number, rot: number, color: string) => {
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(rot)
    ctx.beginPath()
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    ctx.restore()
  }

  // North & South America
  drawLand(135, 78, 42, 28, -0.3, '#2d6a4f')
  drawLand(145, 92, 24, 16, 0.2, '#b5832b')
  drawLand(172, 158, 26, 44, -0.15, '#2b9348')
  drawLand(168, 145, 16, 26, -0.1, '#52b788')

  // Africa & Eurasia
  drawLand(278, 132, 32, 42, 0.1, '#d4a373')
  drawLand(282, 152, 22, 26, 0.05, '#2d6a4f')
  drawLand(275, 76, 36, 20, -0.1, '#40916c')
  drawLand(345, 78, 65, 32, 0.08, '#52b788')
  drawLand(360, 92, 42, 18, 0.05, '#c9ada7')

  // Australia
  drawLand(418, 174, 24, 16, -0.1, '#d97706')

  // Polar ice caps (Arctic & Antarctica)
  ctx.fillStyle = '#f1f5f9'
  ctx.fillRect(0, 0, 512, 16)
  ctx.fillRect(0, 236, 512, 20)

  // Atmospheric cloud bands
  ctx.fillStyle = 'rgba(255, 255, 255, 0.28)'
  for (let i = 0; i < 18; i++) {
    const x = (i * 67) % 480
    const y = 28 + ((i * 43) % 195)
    drawLand(x, y, 36 + (i % 3) * 14, 5 + (i % 2) * 4, (i % 5) * 0.12 - 0.2, 'rgba(255,255,255,0.26)')
  }

  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

/**
 * Generates a radial solar corona glow texture for the Sun in the lunar sky.
 */
function createSunCoronaTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')!

  const grad = ctx.createRadialGradient(128, 128, 8, 128, 128, 126)
  grad.addColorStop(0.0, 'rgba(255, 255, 245, 1.0)')
  grad.addColorStop(0.18, 'rgba(255, 235, 130, 0.92)')
  grad.addColorStop(0.42, 'rgba(255, 185, 25, 0.48)')
  grad.addColorStop(0.72, 'rgba(255, 120, 0, 0.14)')
  grad.addColorStop(1.0, 'rgba(255, 90, 0, 0.0)')

  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 256, 256)

  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

export function Tactical3DScene(props: Tactical3DSceneProps) {
  const [isDraggingRocket, setIsDraggingRocket] = useState(false)
  const [hoverSurface, setHoverSurface] = useState<{
    point: THREE.Vector3
    normal: THREE.Vector3
    latDeg: number
    lonDeg: number
    elevationM: number
    slopeDeg: number
  } | null>(null)

  const terrainMeshRef = useRef<THREE.Mesh | null>(null)

  // End dragging if pointer is released anywhere in the window
  useEffect(() => {
    if (!isDraggingRocket) return
    const handleUp = () => {
      setIsDraggingRocket(false)
      document.body.style.cursor = 'default'
    }
    window.addEventListener('pointerup', handleUp)
    return () => window.removeEventListener('pointerup', handleUp)
  }, [isDraggingRocket])

  return (
    <div
      className="tactical-canvas-container"
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        cursor: isDraggingRocket ? 'grabbing' : props.placementMode ? 'crosshair' : 'default',
      }}
    >
      {/* Floating HUD bar for manual surface placement & surface lock feedback */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 14,
          zIndex: 30,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          pointerEvents: 'auto',
        }}
      >
        <button
          type="button"
          onClick={props.onTogglePlacementMode}
          className={`tactical-surface-place-btn ${props.placementMode ? 'active' : ''}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 13px',
            borderRadius: 4,
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.04em',
            cursor: 'pointer',
            border: props.placementMode ? '1px solid #ffffff' : '1px solid rgba(255, 255, 255, 0.24)',
            background: props.placementMode
              ? 'rgba(255, 255, 255, 0.16)'
              : 'rgba(8, 8, 10, 0.88)',
            color: props.placementMode ? '#ffffff' : 'rgba(255, 255, 255, 0.82)',
            backdropFilter: 'blur(8px)',
          }}
          title="Haz clic aquí para colocar el cohete haciendo clic en cualquier montaña o cráter lunar, o arrastra directamente el cohete sobre la superficie"
        >
          {props.placementMode ? <Crosshair size={13} /> : <MapPin size={13} />}
          <span>{props.placementMode ? 'MODO UBICAR EN SUPERFICIE: ACTIVO (HAZ CLIC EN LA LUNA)' : 'UBICAR COHETE MANUALMENTE EN SUPERFICIE'}</span>
        </button>

        <div
          style={{
            padding: '6px 10px',
            borderRadius: 4,
            background: 'rgba(8, 8, 10, 0.85)',
            border: '1px solid rgba(255, 255, 255, 0.18)',
            color: 'rgba(255, 255, 255, 0.78)',
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            pointerEvents: 'none',
            backdropFilter: 'blur(8px)',
          }}
        >
          <Lock size={11} />
          <span>SUPERFICIE LOLA FIJADA (0.0 m SOBRE CORTEZA)</span>
        </div>

        {(props.placementMode || isDraggingRocket) && hoverSurface && (
          <div
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              background: 'rgba(8, 8, 10, 0.92)',
              border: `1px solid ${hoverSurface.slopeDeg <= props.maxSlopeDeg ? '#ffffff' : 'rgba(255, 255, 255, 0.45)'}`,
              color: '#ffffff',
              fontFamily: 'IBM Plex Mono, monospace',
              fontSize: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              pointerEvents: 'none',
              backdropFilter: 'blur(8px)',
            }}
          >
            <strong style={{ color: '#ffffff', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Crosshair size={11} /> DESTINO:
            </strong>
            <span style={{ color: 'rgba(255, 255, 255, 0.82)' }}>
              {Math.abs(hoverSurface.latDeg).toFixed(4)}°S / {hoverSurface.lonDeg.toFixed(4)}°E
            </span>
            <span style={{ color: 'rgba(255, 255, 255, 0.82)' }}>Alt: {hoverSurface.elevationM} m</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              Pendiente: {hoverSurface.slopeDeg}°{' '}
              {hoverSurface.slopeDeg <= props.maxSlopeDeg ? <Check size={11} /> : <AlertTriangle size={11} />}
            </span>
          </div>
        )}
      </div>

      <Canvas
        camera={{ position: [0, 28, 46], fov: 44, near: 0.05, far: 8000 }}
        gl={{ antialias: true, alpha: false, toneMapping: THREE.ACESFilmicToneMapping }}
      >
        <color attach="background" args={['#020509']} />
        <ambientLight intensity={0.22} />

        <Stars radius={1200} depth={300} count={4500} factor={4} saturation={0.2} fade speed={0.35} />

        {props.atlasData && (
          <TerrainSurface
            atlasData={props.atlasData}
            latDeg={props.latDeg}
            lonDeg={props.lonDeg}
            sunAzimuthDeg={props.sunAzimuthDeg}
            sunElevationDeg={props.sunElevationDeg}
            placementMode={Boolean(props.placementMode)}
            isDraggingRocket={isDraggingRocket}
            onSurfacePlace={props.onSurfacePlace}
            onHoverSurface={setHoverSurface}
            terrainMeshRef={terrainMeshRef}
          />
        )}

        {/* Holographic surface reticle when moving mouse in placement mode or dragging */}
        {(props.placementMode || isDraggingRocket) && hoverSurface && (
          <SurfacePlacementReticle
            hover={hoverSurface}
            maxSlopeDeg={props.maxSlopeDeg}
            isDragging={isDraggingRocket}
          />
        )}

        <LanderAndLinkedBodies
          {...props}
          terrainMeshRef={terrainMeshRef}
          isDraggingRocket={isDraggingRocket}
          onStartDragRocket={() => {
            setIsDraggingRocket(true)
            document.body.style.cursor = 'grabbing'
          }}
        />

        <CameraController
          cameraView={props.cameraView}
          latDeg={props.latDeg}
          lonDeg={props.lonDeg}
          sunAzimuthDeg={props.sunAzimuthDeg}
          sunElevationDeg={props.sunElevationDeg}
          earthAzimuthDeg={props.earthAzimuthDeg}
          earthElevationDeg={props.earthElevationDeg}
          atlasData={props.atlasData}
          isDraggingRocket={isDraggingRocket}
          placementMode={Boolean(props.placementMode)}
          cameraResetKey={props.cameraResetKey ?? 0}
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
  placementMode,
  isDraggingRocket,
  onSurfacePlace,
  onHoverSurface,
  terrainMeshRef,
}: {
  atlasData: AtlasData
  latDeg: number
  lonDeg: number
  sunAzimuthDeg: number
  sunElevationDeg: number
  placementMode: boolean
  isDraggingRocket: boolean
  onSurfacePlace?: (latDeg: number, lonDeg: number) => void
  onHoverSurface: (
    info: {
      point: THREE.Vector3
      normal: THREE.Vector3
      latDeg: number
      lonDeg: number
      elevationM: number
      slopeDeg: number
    } | null
  ) => void
  terrainMeshRef: React.MutableRefObject<THREE.Mesh | null>
}) {
  const meshGeometry = useMemo(() => {
    return buildAtlasGeometry(atlasData, TERRAIN_EXAGGERATION, 'natural', MESH_STRIDE)
  }, [atlasData])

  const sunDir = useMemo(() => {
    return topocentricToWorldDirection(latDeg, lonDeg, sunAzimuthDeg, Math.max(sunElevationDeg, 1.5))
  }, [latDeg, lonDeg, sunAzimuthDeg, sunElevationDeg])

  const extractSurfaceHit = useCallback(
    (e: ThreeEvent<PointerEvent | MouseEvent>) => {
      const [hitLat, hitLon] = world3DToLatLon(e.point, atlasData.manifest.radius_m)
      const exact = sampleExactMeshSurface(
        hitLat,
        hitLon,
        atlasData.heights,
        atlasData.manifest,
        TERRAIN_EXAGGERATION,
        MESH_STRIDE
      )
      const [xM, yM] = latLonToStereoM(hitLat, hitLon, atlasData.manifest.radius_m)
      const slopeDeg = Number(sampleLolaSlope(xM, yM, atlasData.heights, atlasData.manifest).toFixed(1))

      return {
        point: exact.position,
        normal: exact.normal,
        latDeg: hitLat,
        lonDeg: hitLon,
        elevationM: Math.round(exact.elevationM),
        slopeDeg,
      }
    },
    [atlasData]
  )

  const handlePointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!placementMode && !isDraggingRocket) return
      e.stopPropagation()
      const hit = extractSurfaceHit(e)
      onHoverSurface(hit)
      if (isDraggingRocket && onSurfacePlace) {
        onSurfacePlace(hit.latDeg, hit.lonDeg)
      }
    },
    [placementMode, isDraggingRocket, extractSurfaceHit, onHoverSurface, onSurfacePlace]
  )

  const handlePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!placementMode || !onSurfacePlace || e.button !== 0) return
      e.stopPropagation()
      const hit = extractSurfaceHit(e)
      onHoverSurface(hit)
      onSurfacePlace(hit.latDeg, hit.lonDeg)
    },
    [placementMode, onSurfacePlace, extractSurfaceHit, onHoverSurface]
  )

  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (!placementMode || !onSurfacePlace) return
      e.stopPropagation()
      const hit = extractSurfaceHit(e)
      onSurfacePlace(hit.latDeg, hit.lonDeg)
    },
    [placementMode, onSurfacePlace, extractSurfaceHit]
  )

  const handleDoubleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (!onSurfacePlace) return
      e.stopPropagation()
      const hit = extractSurfaceHit(e)
      onSurfacePlace(hit.latDeg, hit.lonDeg)
    },
    [onSurfacePlace, extractSurfaceHit]
  )

  return (
    <group>
      <directionalLight position={sunDir.clone().multiplyScalar(220)} intensity={2.1} color="#fff7e6" />
      <directionalLight position={[0, 120, 0]} intensity={0.22} color="#607d8b" />
      <mesh
        ref={terrainMeshRef}
        name="lunar-terrain-mesh"
        geometry={meshGeometry}
        receiveShadow
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerOut={() => onHoverSurface(null)}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <meshStandardMaterial
          vertexColors={false}
          color="#8d97a0"
          roughness={0.9}
          metalness={0.08}
          flatShading={false}
        />
      </mesh>
    </group>
  )
}

function SurfacePlacementReticle({
  hover,
  maxSlopeDeg,
}: {
  hover: {
    point: THREE.Vector3
    normal: THREE.Vector3
    latDeg: number
    lonDeg: number
    elevationM: number
    slopeDeg: number
  }
  maxSlopeDeg: number
  isDragging?: boolean
}) {
  const isSlopeSafe = hover.slopeDeg <= maxSlopeDeg
  const color = isSlopeSafe ? '#ffffff' : '#a1a1aa'

  const alignQuat = useMemo(() => {
    const q = new THREE.Quaternion()
    q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), hover.normal.clone().normalize())
    return q
  }, [hover.normal])

  return (
    <group position={hover.point} quaternion={alignQuat}>
      <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <ringGeometry args={[0.55, 0.78, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.65, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.03, 0.03, 1.3, 8]} />
        <meshBasicMaterial color={color} transparent opacity={0.65} />
      </mesh>
    </group>
  )
}

function LanderAndLinkedBodies({
  latDeg,
  lonDeg,
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
  terrainMeshRef,
  isDraggingRocket,
  onStartDragRocket,
}: Tactical3DSceneProps & {
  terrainMeshRef: React.MutableRefObject<THREE.Mesh | null>
  isDraggingRocket: boolean
  onStartDragRocket: () => void
}) {
  const manifest = atlasData?.manifest
  const heights = atlasData?.heights

  const rocketGroupRef = useRef<THREE.Group>(null)
  const downRaycaster = useMemo(() => new THREE.Raycaster(), [])

  // Compute exact surface position and normal on the rendered triangle mesh
  const surfaceSample = useMemo(() => {
    if (!manifest || !heights) {
      return {
        position: new THREE.Vector3(0, 0, 0),
        normal: new THREE.Vector3(0, 1, 0),
        elevationM: 1628,
      }
    }
    return sampleExactMeshSurface(latDeg, lonDeg, heights, manifest, TERRAIN_EXAGGERATION, MESH_STRIDE)
  }, [latDeg, lonDeg, manifest, heights])

  // Hardware-level raycast against the live Three.js terrain mesh so the rocket
  // sits flush on the exact rendered triangle face and aligns with its exact normal
  const { clampedLanderWorld, surfaceQuat } = useMemo(() => {
    const pos = surfaceSample.position.clone()
    const norm = surfaceSample.normal.clone()
    if (terrainMeshRef.current) {
      downRaycaster.set(new THREE.Vector3(pos.x, pos.y + 60, pos.z), new THREE.Vector3(0, -1, 0))
      const hits = downRaycaster.intersectObject(terrainMeshRef.current, false)
      if (hits.length > 0) {
        pos.copy(hits[0].point)
        if (hits[0].face) {
          norm.copy(hits[0].face.normal).normalize()
          if (norm.y < 0) norm.negate()
        }
      }
    }
    const up = new THREE.Vector3(0, 1, 0)
    const q = new THREE.Quaternion().setFromUnitVectors(up, norm)
    return { clampedLanderWorld: pos, surfaceQuat: q }
  }, [surfaceSample, terrainMeshRef, downRaycaster])

  // Keep fixed physical 3D size for the rocket so zooming in/out with scroll behaves naturally
  const rocketScale = CONSTANT_ROCKET_SCALE

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

  // Origin of the vectors at the top communications / solar mast of the rocket
  const emitterOffset = useMemo(() => {
    return surfaceSample.normal.clone().multiplyScalar(3.35 * rocketScale)
  }, [surfaceSample.normal, rocketScale])

  const emitterWorld = useMemo(() => {
    return clampedLanderWorld.clone().add(emitterOffset)
  }, [clampedLanderWorld, emitterOffset])

  // Exact sky positions of the Sun and Earth at the tips of the vectors coming out of the spacecraft
  const sunSkyWorld = useMemo(() => {
    return emitterWorld.clone().addScaledVector(sunDir, SKY_SUN_DISTANCE)
  }, [emitterWorld, sunDir])

  const earthSkyWorld = useMemo(() => {
    return emitterWorld.clone().addScaledVector(earthDir, SKY_EARTH_DISTANCE)
  }, [emitterWorld, earthDir])

  // Collision points on mountains if obstructed
  const sunHitWorld = useMemo(() => {
    if (sunRaycast.hit && sunRaycast.hitPositionWorld) {
      return sunRaycast.hitPositionWorld
    }
    return null
  }, [sunRaycast])

  const earthHitWorld = useMemo(() => {
    if (earthRaycast.hit && earthRaycast.hitPositionWorld) {
      return earthRaycast.hitPositionWorld
    }
    return null
  }, [earthRaycast])

  return (
    <group>
      {/* ====================================================================
          SPACECRAFT / LUNAR ROCKET CLAMPED STRICTLY ON THE LUNAR SURFACE
          ==================================================================== */}
      <group
        ref={rocketGroupRef}
        position={clampedLanderWorld}
        quaternion={surfaceQuat}
        onPointerDown={e => {
          e.stopPropagation()
          onStartDragRocket()
        }}
        onPointerOver={() => {
          if (!isDraggingRocket) document.body.style.cursor = 'grab'
        }}
        onPointerOut={() => {
          if (!isDraggingRocket) document.body.style.cursor = 'default'
        }}
      >
        <LunarRocketLanderModel isSafe={isSafe} scale={rocketScale} />
        <LandingEllipse isSafe={isSafe} scale={rocketScale} />

        {/* Spacecraft HUD Tag */}
        <Html position={[0, 4.1 * rocketScale, 0]} center distanceFactor={16} zIndexRange={[100, 0]}>
          <div
            className={`tactical-lander-tag ${isSafe ? 'tag-safe' : 'tag-hazard'}`}
            style={{ cursor: 'grab', userSelect: 'none' }}
            onPointerDown={e => {
              e.stopPropagation()
              onStartDragRocket()
            }}
          >
            <div className="tag-dot" />
            <div className="tag-text">
              <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Navigation size={11} /> {siteName.toUpperCase()}
              </strong>
              <small>
                {Math.abs(latDeg).toFixed(4)}°S / {lonDeg.toFixed(4)}°E · Alt: {Math.round(surfaceSample.elevationM)}m
              </small>
            </div>
          </div>
        </Html>
      </group>

      {/* ====================================================================
          SOLAR VECTOR + LINKED 3D SUN IN BACKGROUND SKY
          ==================================================================== */}
      <LinkedSurvivalVector
        emitterWorld={emitterWorld}
        skyBodyWorld={sunSkyWorld}
        hitWorld={sunHitWorld}
        clearColor="#ffffff"
        blockedColor="#a1a1aa"
        isBlocked={isSunBlocked}
      />

      <SunSkyBody
        position={sunSkyWorld}
        azimuthDeg={sunAzimuthDeg}
        elevationDeg={sunElevationDeg}
        isBlocked={isSunBlocked}
      />

      {/* ====================================================================
          EARTH VECTOR + LINKED 3D EARTH IN BACKGROUND SKY
          ==================================================================== */}
      <LinkedSurvivalVector
        emitterWorld={emitterWorld}
        skyBodyWorld={earthSkyWorld}
        hitWorld={earthHitWorld}
        clearColor="#a3adc2"
        blockedColor="#71717a"
        isBlocked={isEarthBlocked}
      />

      <EarthSkyBody
        position={earthSkyWorld}
        sunDirection={sunDir}
        azimuthDeg={earthAzimuthDeg}
        elevationDeg={earthElevationDeg}
        isBlocked={isEarthBlocked}
      />
    </group>
  )
}

/**
 * Artemis / HLS Lunar Rocket Lander Model.
 * Strictly constructed with all landing footpads resting at local Y = 0.00 (never below 0).
 */
function LunarRocketLanderModel({ isSafe, scale }: { isSafe: boolean; scale: number }) {
  return (
    <group scale={[scale, scale, scale]}>
      {/* Surface Contact Base Pad Ring at exact Y = 0.01 */}
      <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.35, 1.55, 24]} />
        <meshBasicMaterial color={isSafe ? '#ffffff' : '#a1a1aa'} transparent opacity={0.45} side={THREE.DoubleSide} />
      </mesh>

      {/* 4 Heavy Landing Gear Struts & Golden Footpads resting at exact Y = 0.00 */}
      {[45, 135, 225, 315].map((angle, i) => {
        const rad = (angle * Math.PI) / 180
        const padX = Math.sin(rad) * 1.42
        const padZ = Math.cos(rad) * 1.42
        return (
          <group key={i}>
            {/* Footpad resting flush on the lunar regolith (Y = 0.00 to 0.08) */}
            <mesh position={[padX, 0.04, padZ]}>
              <cylinderGeometry args={[0.28, 0.34, 0.08, 12]} />
              <meshStandardMaterial color="#eab308" roughness={0.35} metalness={0.75} />
            </mesh>
            {/* Primary telescopic shock strut from hull skirt down to footpad */}
            <mesh
              position={[padX * 0.68, 0.48, padZ * 0.68]}
              rotation={[Math.cos(rad) * 0.52, 0, -Math.sin(rad) * 0.52]}
            >
              <cylinderGeometry args={[0.055, 0.055, 1.15, 8]} />
              <meshStandardMaterial color="#cbd5e1" roughness={0.3} metalness={0.85} />
            </mesh>
          </group>
        )
      })}

      {/* Engine Bells (Safe clearance at Y = 0.22 to 0.50 above regolith) */}
      <mesh position={[0, 0.35, 0]}>
        <coneGeometry args={[0.42, 0.38, 16, 1, true]} />
        <meshStandardMaterial color="#334155" roughness={0.6} metalness={0.7} side={THREE.DoubleSide} />
      </mesh>

      {/* Lower Propulsion & Thermal Gold Skirt (Y = 0.45 to 1.05) */}
      <mesh position={[0, 0.75, 0]}>
        <cylinderGeometry args={[0.88, 0.96, 0.6, 16]} />
        <meshStandardMaterial color="#d97706" roughness={0.32} metalness={0.82} />
      </mesh>

      {/* Main Pressurized Cylindrical Rocket Hull (Y = 1.05 to 2.45) */}
      <mesh position={[0, 1.75, 0]}>
        <cylinderGeometry args={[0.85, 0.88, 1.4, 20]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.28} metalness={0.35} />
      </mesh>

      {/* Dark Thermal Shield Accent Band & Crew Viewport Windows */}
      <mesh position={[0, 1.95, 0]}>
        <cylinderGeometry args={[0.865, 0.865, 0.24, 20]} />
        <meshStandardMaterial color="#0f172a" roughness={0.2} metalness={0.5} />
      </mesh>

      {/* Conical Rocket Nose Fairing / Upper Ascent Dome (Y = 2.45 to 3.20) */}
      <mesh position={[0, 2.82, 0]}>
        <coneGeometry args={[0.85, 0.75, 20]} />
        <meshStandardMaterial color="#f1f5f9" roughness={0.25} metalness={0.4} />
      </mesh>

      {/* Deployed Solar Array Wings (Left & Right) */}
      <mesh position={[1.65, 1.85, 0]} rotation={[0.2, 0, 0]}>
        <boxGeometry args={[1.55, 0.04, 0.52]} />
        <meshStandardMaterial color="#1d4ed8" emissive="#1e3a8a" emissiveIntensity={0.35} roughness={0.2} metalness={0.8} />
      </mesh>
      <mesh position={[-1.65, 1.85, 0]} rotation={[0.2, 0, 0]}>
        <boxGeometry args={[1.55, 0.04, 0.52]} />
        <meshStandardMaterial color="#1d4ed8" emissive="#1e3a8a" emissiveIntensity={0.35} roughness={0.2} metalness={0.8} />
      </mesh>

      {/* Top Vector Emitter Turret & High-Gain Dish (Y = 3.20 to 3.45) */}
      <mesh position={[0, 3.35, 0]}>
        <sphereGeometry args={[0.2, 14, 14]} />
        <meshBasicMaterial color={isSafe ? '#ffffff' : '#d4d4d8'} />
      </mesh>
      <pointLight position={[0, 3.4, 0]} color="#ffffff" intensity={1.4} distance={6} />
    </group>
  )
}

function LandingEllipse({ isSafe, scale }: { isSafe: boolean; scale: number }) {
  const ringRef = useRef<THREE.Mesh>(null)

  useFrame((_, delta) => {
    if (ringRef.current) {
      ringRef.current.rotation.z += delta * (isSafe ? 0.35 : 0.85)
    }
  })

  const color = isSafe ? '#ffffff' : '#a1a1aa'

  return (
    <group position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[scale, scale, scale]}>
      <mesh ref={ringRef} raycast={() => null}>
        <ringGeometry args={[2.1, 2.32, 40]} />
        <meshBasicMaterial color={color} transparent opacity={0.68} side={THREE.DoubleSide} />
      </mesh>
      <mesh raycast={() => null}>
        <circleGeometry args={[2.1, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.1} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

/**
 * Renders the vector emerging from the spacecraft and connecting directly to the Sun or Earth in the sky.
 * If obstructed by a mountain, renders a red collision beam up to the mountain impact point,
 * and a dashed continuation vector from the mountain up to the celestial body in the sky.
 */
function LinkedSurvivalVector({
  emitterWorld,
  skyBodyWorld,
  hitWorld,
  clearColor,
  blockedColor,
  isBlocked,
}: {
  emitterWorld: THREE.Vector3
  skyBodyWorld: THREE.Vector3
  hitWorld: THREE.Vector3 | null
  clearColor: string
  blockedColor: string
  isBlocked: boolean
}) {
  if (isBlocked && hitWorld) {
    return (
      <group>
        {/* Solid crimson beam from spacecraft to mountain collision point */}
        <Line
          points={[emitterWorld, hitWorld]}
          color={blockedColor}
          lineWidth={3.2}
        />

        {/* Dashed continuation line from mountain collision point to the celestial body in the sky */}
        <Line
          points={[hitWorld, skyBodyWorld]}
          color={clearColor}
          lineWidth={1.6}
          dashed
          dashSize={3.5}
          gapSize={2.2}
          transparent
          opacity={0.55}
        />

        {/* Collision beacon on the mountain ridge */}
        <group position={hitWorld}>
          <mesh>
            <sphereGeometry args={[0.38, 16, 16]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
          <pointLight color="#ffffff" intensity={2.0} distance={8} />
          <Html position={[0, 0.9, 0]} center distanceFactor={24} zIndexRange={[105, 0]}>
            <div className="impact-beacon">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <AlertTriangle size={11} /> IMPACTO EN MONTAÑA (BLOQUEO)
              </span>
            </div>
          </Html>
        </group>
      </group>
    )
  }

  return (
    <group>
      {/* Unobstructed bright laser vector from spacecraft straight into the celestial body */}
      <Line
        points={[emitterWorld, skyBodyWorld]}
        color={ isBlocked ? blockedColor : clearColor }
        lineWidth={2.8}
      />
    </group>
  )
}

/**
 * 3D Sun in the far background sky, directly anchored to the tip of the solar vector.
 */
function SunSkyBody({
  position,
  azimuthDeg,
  elevationDeg,
  isBlocked,
}: {
  position: THREE.Vector3
  azimuthDeg: number
  elevationDeg: number
  isBlocked: boolean
}) {
  const coronaTexture = useMemo(() => createSunCoronaTexture(), [])

  return (
    <group position={position}>
      {/* Incandescent Solar Core */}
      <mesh>
        <sphereGeometry args={[14.5, 32, 32]} />
        <meshBasicMaterial color={isBlocked ? '#d4d4d8' : '#fffdf2'} />
      </mesh>

      {/* Photosphere Halo */}
      <mesh scale={[1.28, 1.28, 1.28]}>
        <sphereGeometry args={[14.5, 28, 28]} />
        <meshBasicMaterial
          color={isBlocked ? '#a1a1aa' : '#ffd32a'}
          transparent
          opacity={isBlocked ? 0.28 : 0.55}
          side={THREE.BackSide}
        />
      </mesh>

      {/* Luminous Solar Corona Sprite */}
      <sprite scale={[88, 88, 1]}>
        <spriteMaterial
          map={coronaTexture}
          color={isBlocked ? '#a1a1aa' : '#ffd32a'}
          transparent
          opacity={isBlocked ? 0.35 : 0.9}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </sprite>

      {/* HUD Label Attached to the Sun */}
      <Html position={[0, 23, 0]} center distanceFactor={240} zIndexRange={[95, 0]}>
        <div
          style={{
            background: 'rgba(8, 8, 10, 0.92)',
            border: `1px solid ${isBlocked ? 'rgba(255, 255, 255, 0.85)' : 'rgba(255, 255, 255, 0.45)'}`,
            borderRadius: 4,
            padding: '4px 9px',
            color: '#ffffff',
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: 10,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            pointerEvents: 'none',
            backdropFilter: 'blur(6px)',
          }}
        >
          <Sun size={11} />
          <span>
            SOL {isBlocked ? '(OCULTO)' : '(CONECTADO)'} · El {elevationDeg.toFixed(2)}° | Az {azimuthDeg.toFixed(1)}°
          </span>
        </div>
      </Html>
    </group>
  )
}

/**
 * 3D Earth (Blue Marble with continents, clouds, and atmosphere) in the far background sky,
 * directly anchored to the tip of the Earth communication vector.
 */
function EarthSkyBody({
  position,
  sunDirection,
  azimuthDeg,
  elevationDeg,
  isBlocked,
}: {
  position: THREE.Vector3
  sunDirection: THREE.Vector3
  azimuthDeg: number
  elevationDeg: number
  isBlocked: boolean
}) {
  const earthMeshRef = useRef<THREE.Mesh>(null)
  const earthTexture = useMemo(() => createEarthTexture(), [])

  useFrame((_, delta) => {
    if (earthMeshRef.current) {
      earthMeshRef.current.rotation.y += delta * 0.12
    }
  })

  return (
    <group position={position}>
      {/* Local sunlight illuminating the Earth globe */}
      <directionalLight position={sunDirection.clone().multiplyScalar(60)} intensity={1.8} color="#ffffff" />

      {/* Blue Marble Globe with Continents & Clouds */}
      <mesh ref={earthMeshRef} rotation={[0.25, -0.6, 0]}>
        <sphereGeometry args={[12.5, 36, 36]} />
        <meshStandardMaterial
          map={earthTexture}
          roughness={0.45}
          metalness={0.08}
          emissive="#0c4a6e"
          emissiveIntensity={0.45}
        />
      </mesh>

      {/* Subtle White Atmospheric Rim Glow */}
      <mesh scale={[1.14, 1.14, 1.14]}>
        <sphereGeometry args={[12.5, 32, 32]} />
        <meshBasicMaterial
          color={isBlocked ? '#71717a' : '#cbd5e1'}
          transparent
          opacity={0.26}
          side={THREE.BackSide}
        />
      </mesh>

      {/* Outer Telemetry Beacon Ring around Earth */}
      <mesh rotation={[Math.PI / 2.4, 0.3, 0]}>
        <ringGeometry args={[15.8, 16.6, 48]} />
        <meshBasicMaterial
          color={isBlocked ? '#a1a1aa' : '#ffffff'}
          transparent
          opacity={0.42}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* HUD Label Attached to the Earth */}
      <Html position={[0, 21, 0]} center distanceFactor={220} zIndexRange={[95, 0]}>
        <div
          style={{
            background: 'rgba(8, 8, 10, 0.92)',
            border: `1px solid ${isBlocked ? 'rgba(255, 255, 255, 0.75)' : 'rgba(255, 255, 255, 0.35)'}`,
            borderRadius: 4,
            padding: '4px 9px',
            color: 'rgba(255, 255, 255, 0.88)',
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: 10,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            pointerEvents: 'none',
            backdropFilter: 'blur(6px)',
          }}
        >
          <Globe2 size={11} />
          <span>
            TIERRA {isBlocked ? '(BLOQUEADA)' : '(ENLACE ACTIVO)'} · El {elevationDeg.toFixed(2)}° | Az {azimuthDeg.toFixed(1)}°
          </span>
        </div>
      </Html>
    </group>
  )
}

function CameraController({
  cameraView,
  latDeg,
  lonDeg,
  sunAzimuthDeg,
  sunElevationDeg,
  earthAzimuthDeg,
  earthElevationDeg,
  atlasData,
  isDraggingRocket,
  placementMode,
  cameraResetKey,
}: {
  cameraView: 'orbit' | 'mast' | 'top'
  latDeg: number
  lonDeg: number
  sunAzimuthDeg: number
  sunElevationDeg: number
  earthAzimuthDeg: number
  earthElevationDeg: number
  atlasData: AtlasData | null
  isDraggingRocket: boolean
  placementMode: boolean
  cameraResetKey: number
}) {
  const { camera } = useThree()
  const controlsRef = useRef<OrbitControlsImpl>(null)

  const landerTarget = useMemo(() => {
    if (!atlasData) return new THREE.Vector3(0, 0, 0)
    return sampleExactMeshSurface(
      latDeg,
      lonDeg,
      atlasData.heights,
      atlasData.manifest,
      TERRAIN_EXAGGERATION,
      MESH_STRIDE
    ).position
  }, [latDeg, lonDeg, atlasData])

  // Position camera behind the rocket looking toward the Sun & Earth vectors ONLY when preset or view mode changes
  useEffect(() => {
    if (!controlsRef.current || !atlasData) return

    const sunDir = topocentricToWorldDirection(latDeg, lonDeg, sunAzimuthDeg, sunElevationDeg)
    const earthDir = topocentricToWorldDirection(latDeg, lonDeg, earthAzimuthDeg, earthElevationDeg)

    // Horizontal bisector pointing from the rocket toward the midpoint of Sun and Earth
    const bisector = sunDir.clone().add(earthDir)
    bisector.y = 0
    if (bisector.lengthSq() < 0.001) {
      bisector.set(0, 0, -1)
    } else {
      bisector.normalize()
    }

    if (cameraView === 'orbit') {
      // Place camera behind the spacecraft looking forward toward the spacecraft AND the Sun & Earth in the sky
      const camPos = landerTarget
        .clone()
        .addScaledVector(bisector, -18.5)
        .add(new THREE.Vector3(0, 4.2, 0))
      const lookTarget = landerTarget
        .clone()
        .addScaledVector(bisector, 8.0)
        .add(new THREE.Vector3(0, 2.2, 0))

      camera.position.copy(camPos)
      controlsRef.current.target.copy(lookTarget)
    } else if (cameraView === 'mast') {
      const camPos = landerTarget
        .clone()
        .addScaledVector(bisector, -2.2)
        .add(new THREE.Vector3(0, 1.8, 0))
      const lookTarget = landerTarget
        .clone()
        .addScaledVector(bisector, 20.0)
        .add(new THREE.Vector3(0, 2.5, 0))

      camera.position.copy(camPos)
      controlsRef.current.target.copy(lookTarget)
    } else if (cameraView === 'top') {
      camera.position.set(landerTarget.x, landerTarget.y + 32, landerTarget.z + 0.1)
      controlsRef.current.target.copy(landerTarget)
    }

    controlsRef.current.update()
    // Only trigger camera reposition when view mode or site preset changes, NEVER when clicking/dragging on terrain
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraView, cameraResetKey, Boolean(atlasData)])

  // Prevent camera from ever dipping underneath the lunar terrain crust
  useFrame(() => {
    if (!atlasData) return
    const [camLat, camLon] = world3DToLatLon(camera.position, atlasData.manifest.radius_m)
    const camSurface = sampleExactMeshSurface(
      camLat,
      camLon,
      atlasData.heights,
      atlasData.manifest,
      TERRAIN_EXAGGERATION,
      MESH_STRIDE
    )
    const minCamY = camSurface.position.y + 0.45
    if (camera.position.y < minCamY) {
      camera.position.y = minCamY
    }
  })

  return (
    <OrbitControls
      ref={controlsRef}
      enabled={!isDraggingRocket}
      enableRotate={!isDraggingRocket && !placementMode}
      enableDamping
      dampingFactor={0.08}
      maxDistance={260}
      minDistance={1.5}
      maxPolarAngle={Math.PI / 2 + 0.08}
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
  const sunRad = (sunAzimuthDeg - 90) * (Math.PI / 180)
  const earthRad = (earthAzimuthDeg - 90) * (Math.PI / 180)

  const sunX = 36 + Math.cos(sunRad) * 24
  const sunY = 36 + Math.sin(sunRad) * 24

  const earthX = 36 + Math.cos(earthRad) * 20
  const earthY = 36 + Math.sin(earthRad) * 20

  return (
    <div className="tactical-compass" title="Orientación topocéntrica: Sol (Blanco) / Tierra (Gris claro)">
      <svg width="72" height="72" viewBox="0 0 72 72">
        <circle cx="36" cy="36" r="32" fill="none" stroke="rgba(255, 255, 255, 0.22)" strokeWidth="1" />
        <circle cx="36" cy="36" r="20" fill="none" stroke="rgba(255, 255, 255, 0.1)" strokeDasharray="2 2" />
        <line x1="36" y1="4" x2="36" y2="68" stroke="rgba(255,255,255,0.08)" />
        <line x1="4" y1="36" x2="68" y2="36" stroke="rgba(255,255,255,0.08)" />

        <text x="36" y="12" textAnchor="middle" fill="#ffffff" fontSize="8" fontFamily="monospace" fontWeight="bold">
          N
        </text>
        <text x="63" y="39" textAnchor="middle" fill="rgba(255,255,255,0.45)" fontSize="7" fontFamily="monospace">
          E
        </text>
        <text x="36" y="66" textAnchor="middle" fill="rgba(255,255,255,0.45)" fontSize="7" fontFamily="monospace">
          S
        </text>
        <text x="9" y="39" textAnchor="middle" fill="rgba(255,255,255,0.45)" fontSize="7" fontFamily="monospace">
          W
        </text>

        <line x1="36" y1="36" x2={sunX} y2={sunY} stroke="#ffffff" strokeWidth="1.8" />
        <circle cx={sunX} cy={sunY} r="3" fill="#ffffff" />

        <line x1="36" y1="36" x2={earthX} y2={earthY} stroke="rgba(255,255,255,0.5)" strokeWidth="1.6" />
        <circle cx={earthX} cy={earthY} r="2.6" fill="rgba(255,255,255,0.65)" />

        <circle cx="36" cy="36" r="2" fill="#ffffff" />
      </svg>
      <div className="compass-readout">
        <span style={{ color: '#ffffff', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          <Sun size={10} /> {sunAzimuthDeg.toFixed(0)}°
        </span>
        <span style={{ color: 'rgba(255,255,255,0.62)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          <Globe2 size={10} /> {earthAzimuthDeg.toFixed(0)}°
        </span>
      </div>
    </div>
  )
}
