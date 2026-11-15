import { useState, useRef, useMemo } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Html, Stars } from '@react-three/drei'
import * as THREE from 'three'
import {
  Pause,
  Play,
  RotateCcw,
  Ruler,
  Compass,
  Sun,
  Globe2,
  ShieldAlert,
  X,
  Rocket,
  Bot,
  Building2,
  Crosshair,
} from 'lucide-react'
import { useI18n } from '../../i18n/LanguageContext'
import type { VehicleProfile } from '../mission/automaticTypes'
import { LUNAR_OBJECTS } from '../mission/UnifiedMissionPlanner'

type Props = {
  activeVehicle: VehicleProfile
  onSelectVehicle: (v: VehicleProfile) => void
  onClose?: () => void
}

/** Dynamic Camera Framing: smoothly lerps camera and target to fit each 3D object's scale,
 * then yields 100% control to the user so mouse wheel zoom in/out works completely unrestricted. */
function CameraFramer({
  vehicle,
  controlsRef,
  resetTrigger,
}: {
  vehicle: VehicleProfile
  controlsRef: React.RefObject<any>
  resetTrigger: number
}) {
  const { camera } = useThree()
  const isTransitioningRef = useRef(true)
  const prevVehicleRef = useRef(vehicle.lander_name)
  const prevResetRef = useRef(resetTrigger)

  const targetConfig = useMemo(() => {
    const name = vehicle.lander_name.toLowerCase()
    // Distances increased generously ("un poco más lejos") for wide, cinematic framing
    if (name.includes('starship')) {
      return { target: new THREE.Vector3(0, 3.8, 0), pos: new THREE.Vector3(11.2, 7.6, 12.2) }
    }
    if (name.includes('vsat') || name.includes('torre')) {
      return { target: new THREE.Vector3(0, 3.3, 0), pos: new THREE.Vector3(9.6, 6.4, 10.6) }
    }
    if (name.includes('hábitat') || name.includes('base artemis')) {
      return { target: new THREE.Vector3(0, 1.4, 0), pos: new THREE.Vector3(7.8, 4.6, 8.4) }
    }
    if (name.includes('cruiser') || name.includes('presurizado')) {
      return { target: new THREE.Vector3(0, 1.2, 0), pos: new THREE.Vector3(7.0, 4.0, 7.6) }
    }
    if (name.includes('viper') || name.includes('ltv') || vehicle.is_rover) {
      return { target: new THREE.Vector3(0, 0.85, 0), pos: new THREE.Vector3(5.2, 3.2, 5.6) }
    }
    if (name.includes('blue moon')) {
      return { target: new THREE.Vector3(0, 2.2, 0), pos: new THREE.Vector3(8.0, 5.2, 8.8) }
    }
    if (name.includes('alpaca') || name.includes('griffin')) {
      return { target: new THREE.Vector3(0, 1.2, 0), pos: new THREE.Vector3(6.6, 3.8, 7.2) }
    }
    // Default landers (Nova-C, Blue Ghost, etc.)
    return { target: new THREE.Vector3(0, 1.3, 0), pos: new THREE.Vector3(6.5, 3.8, 7.0) }
  }, [vehicle.lander_name, vehicle.is_rover])

  // Detect vehicle changes or reset click to restart smooth transition
  if (prevVehicleRef.current !== vehicle.lander_name || prevResetRef.current !== resetTrigger) {
    prevVehicleRef.current = vehicle.lander_name
    prevResetRef.current = resetTrigger
    isTransitioningRef.current = true
  }

  useFrame(() => {
    // Once transition finishes, do not touch camera or controls so user can scroll/zoom freely!
    if (!isTransitioningRef.current) return

    if (controlsRef.current) {
      controlsRef.current.target.lerp(targetConfig.target, 0.08)
      camera.position.lerp(targetConfig.pos, 0.08)
      controlsRef.current.update()

      // When close to optimal framing, finalize and hand full control back to user
      const dist = camera.position.distanceTo(targetConfig.pos)
      const targetDist = controlsRef.current.target.distanceTo(targetConfig.target)
      if (dist < 0.04 && targetDist < 0.04) {
        camera.position.copy(targetConfig.pos)
        controlsRef.current.target.copy(targetConfig.target)
        controlsRef.current.update()
        isTransitioningRef.current = false
      }
    }
  })

  return null
}

/** 3D Rover Model (LTV, VIPER, Lunar Cruiser) */
function RoverModel({ vehicle }: { vehicle: VehicleProfile }) {
  const isViper = vehicle.lander_name.toLowerCase().includes('viper')
  const isCruiser = vehicle.lander_name.toLowerCase().includes('cruiser') || vehicle.lander_name.toLowerCase().includes('presurizado')
  const solarY = Math.max(1.8, Math.min(vehicle.solar_panel_height * 0.7, 4.0))
  const antennaY = Math.max(2.0, Math.min(vehicle.antenna_height * 0.75, 4.5))

  if (isCruiser) {
    // 6-wheeled heavy pressurized explorer
    return (
      <group position={[0, 0, 0]}>
        {/* 6 Large Mesh Wheels */}
        {[-1.8, 0, 1.8].map((z, idx) => (
          <group key={idx}>
            <mesh position={[-1.4, 0.45, z]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.45, 0.45, 0.32, 16]} />
              <meshStandardMaterial color="#334155" metalness={0.7} roughness={0.4} />
            </mesh>
            <mesh position={[1.4, 0.45, z]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.45, 0.45, 0.32, 16]} />
              <meshStandardMaterial color="#334155" metalness={0.7} roughness={0.4} />
            </mesh>
          </group>
        ))}

        {/* Heavy Pressurized Cabin */}
        <mesh position={[0, 1.35, 0]}>
          <boxGeometry args={[2.2, 1.3, 4.4]} />
          <meshStandardMaterial color="#f8fafc" metalness={0.3} roughness={0.3} />
        </mesh>
        {/* Front Cockpit Observation Dome */}
        <mesh position={[0, 1.45, 2.2]}>
          <boxGeometry args={[1.9, 0.85, 0.4]} />
          <meshStandardMaterial color="#0284c7" emissive="#0369a1" emissiveIntensity={0.35} metalness={0.9} roughness={0.1} />
        </mesh>
        {/* Rear Air-lock / Equipment bay */}
        <mesh position={[0, 1.35, -2.25]}>
          <cylinderGeometry args={[0.65, 0.65, 0.3, 16]} />
          <meshStandardMaterial color="#475569" metalness={0.6} roughness={0.5} />
        </mesh>

        {/* Deployable Solar Array Wing atop the cruiser */}
        <group position={[0, solarY, 0.2]}>
          <mesh position={[0, 0.1, 0]}>
            <cylinderGeometry args={[0.06, 0.06, 0.6, 8]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.8} roughness={0.3} />
          </mesh>
          <mesh position={[1.3, 0.4, 0]} rotation={[0.2, 0, 0]}>
            <boxGeometry args={[2.2, 0.03, 0.9]} />
            <meshStandardMaterial color="#1d4ed8" emissive="#1e3a8a" emissiveIntensity={0.4} metalness={0.8} roughness={0.2} />
          </mesh>
          <mesh position={[-1.3, 0.4, 0]} rotation={[0.2, 0, 0]}>
            <boxGeometry args={[2.2, 0.03, 0.9]} />
            <meshStandardMaterial color="#1d4ed8" emissive="#1e3a8a" emissiveIntensity={0.4} metalness={0.8} roughness={0.2} />
          </mesh>
        </group>

        {/* Comms High-Gain Antenna */}
        <group position={[0.7, antennaY, -1.2]}>
          <mesh position={[0, -0.4, 0]}>
            <cylinderGeometry args={[0.04, 0.05, 0.8, 8]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.85} roughness={0.2} />
          </mesh>
          <mesh rotation={[0.4, 0, 0]}>
            <sphereGeometry args={[0.35, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
            <meshStandardMaterial color="#8ddfe9" side={THREE.DoubleSide} metalness={0.85} roughness={0.2} />
          </mesh>
        </group>
      </group>
    )
  }

  if (isViper) {
    // NASA VIPER Ice-Prospecting Robotic Rover
    return (
      <group position={[0, 0, 0]}>
        {/* 4 Steerable Prospecting Wheels */}
        {[
          [-0.85, 0.75],
          [0.85, 0.75],
          [-0.85, -0.75],
          [0.85, -0.75],
        ].map(([x, z], idx) => (
          <group key={idx} position={[x, 0.32, z]}>
            <mesh rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.3, 0.3, 0.22, 16]} />
              <meshStandardMaterial color="#e2e8f0" metalness={0.7} roughness={0.3} />
            </mesh>
            <mesh position={[0, 0.2, 0]}>
              <cylinderGeometry args={[0.04, 0.04, 0.35, 8]} />
              <meshStandardMaterial color="#64748b" metalness={0.8} roughness={0.4} />
            </mesh>
          </group>
        ))}

        {/* Gold Thermal Multi-layer Insulated Avionics Box */}
        <mesh position={[0, 0.8, 0]}>
          <boxGeometry args={[1.2, 0.65, 1.25]} />
          <meshStandardMaterial color="#d97706" metalness={0.85} roughness={0.3} />
        </mesh>

        {/* TRIDENT 1-Meter Regolith Ice Drill at the Rear */}
        <group position={[0, 0.9, -0.75]}>
          <mesh>
            <cylinderGeometry args={[0.09, 0.09, 1.1, 12]} />
            <meshStandardMaterial color="#475569" metalness={0.9} roughness={0.2} />
          </mesh>
        </group>

        {/* VIPER Sensor & Camera Mast with Solar Arrays */}
        <group position={[0, solarY, 0.3]}>
          <mesh position={[0, -0.5, 0]}>
            <cylinderGeometry args={[0.04, 0.05, 1.0, 8]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.8} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.1, 0.05]}>
            <boxGeometry args={[0.5, 0.12, 0.15]} />
            <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.2} />
          </mesh>
          <mesh position={[0, 0.2, -0.1]} rotation={[0.15, 0, 0]}>
            <boxGeometry args={[1.3, 0.02, 0.55]} />
            <meshStandardMaterial color="#1d4ed8" emissive="#1e3a8a" emissiveIntensity={0.4} metalness={0.8} roughness={0.2} />
          </mesh>
        </group>

        {/* Gimbaled DTE Antenna Dish */}
        <group position={[0.45, antennaY, -0.2]}>
          <mesh position={[0, -0.3, 0]}>
            <cylinderGeometry args={[0.03, 0.03, 0.6, 8]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.8} roughness={0.3} />
          </mesh>
          <mesh rotation={[0.3, 0, 0]}>
            <sphereGeometry args={[0.22, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
            <meshStandardMaterial color="#8ddfe9" side={THREE.DoubleSide} metalness={0.85} roughness={0.2} />
          </mesh>
        </group>
      </group>
    )
  }

  // Default: Lunar Terrain Vehicle (LTV) - 2-Astronaut Open Cockpit Buggy
  return (
    <group position={[0, 0, 0]}>
      {/* 4 Lunar LRV / LTV Wire-mesh Wheels */}
      {[
        [-0.95, 0.85],
        [0.95, 0.85],
        [-0.95, -0.85],
        [0.95, -0.85],
      ].map(([x, z], idx) => (
        <group key={idx} position={[x, 0.36, z]}>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.36, 0.36, 0.25, 20]} />
            <meshStandardMaterial color="#94a3b8" wireframe metalness={0.9} roughness={0.2} />
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.14, 0.14, 0.27, 12]} />
            <meshStandardMaterial color="#eab308" metalness={0.8} roughness={0.3} />
          </mesh>
        </group>
      ))}

      {/* Tubular Chassis Frame */}
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[1.35, 0.22, 2.1]} />
        <meshStandardMaterial color="#f1f5f9" metalness={0.6} roughness={0.3} />
      </mesh>

      {/* Roll Cage and Frame */}
      <mesh position={[0, 1.05, 0]}>
        <boxGeometry args={[1.2, 0.9, 1.4]} />
        <meshStandardMaterial color="#334155" wireframe metalness={0.8} roughness={0.3} />
      </mesh>

      {/* Astronaut Dual Seats */}
      <mesh position={[-0.28, 0.8, -0.1]}>
        <boxGeometry args={[0.38, 0.45, 0.38]} />
        <meshStandardMaterial color="#1e293b" metalness={0.2} roughness={0.8} />
      </mesh>
      <mesh position={[0.28, 0.8, -0.1]}>
        <boxGeometry args={[0.38, 0.45, 0.38]} />
        <meshStandardMaterial color="#1e293b" metalness={0.2} roughness={0.8} />
      </mesh>

      {/* Front Headlights */}
      <mesh position={[-0.45, 0.6, 1.06]}>
        <sphereGeometry args={[0.08, 12, 12]} />
        <meshBasicMaterial color="#fef08a" />
      </mesh>
      <mesh position={[0.45, 0.6, 1.06]}>
        <sphereGeometry args={[0.08, 12, 12]} />
        <meshBasicMaterial color="#fef08a" />
      </mesh>

      {/* Solar Panel Wing */}
      <group position={[0, solarY, 0.2]}>
        <mesh position={[0, -0.4, 0]}>
          <cylinderGeometry args={[0.04, 0.05, 0.8, 8]} />
          <meshStandardMaterial color="#64748b" metalness={0.8} />
        </mesh>
        <mesh position={[0, 0.08, 0]} rotation={[0.25, 0, 0]}>
          <boxGeometry args={[1.5, 0.02, 0.6]} />
          <meshStandardMaterial color="#1d4ed8" emissive="#1e3a8a" emissiveIntensity={0.4} metalness={0.8} roughness={0.2} />
        </mesh>
      </group>

      {/* High-Gain Antenna */}
      <group position={[-0.48, antennaY, -0.6]}>
        <mesh position={[0, -0.5, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 1.0, 8]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.85} roughness={0.2} />
        </mesh>
        <mesh rotation={[0.3, 0, 0]}>
          <sphereGeometry args={[0.24, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
          <meshStandardMaterial color="#8ddfe9" side={THREE.DoubleSide} metalness={0.85} roughness={0.2} />
        </mesh>
      </group>
    </group>
  )
}

/** 3D Rocket Lander Models (Starship HLS, Dynetics ALPACA, Blue Moon MK2, Griffin, Nova-C, Blue Ghost) */
function LanderModel({ vehicle }: { vehicle: VehicleProfile }) {
  const name = vehicle.lander_name.toLowerCase()
  const isStarship = name.includes('starship')
  const isAlpaca = name.includes('alpaca')
  const isBlueMoon = name.includes('blue moon')
  const isGriffin = name.includes('griffin')
  const isNovaC = name.includes('nova-c') || name.includes('intuitive')

  // Starship HLS: Tall stainless steel tower
  if (isStarship) {
    return (
      <group position={[0, 0, 0]}>
        {/* 4 Landing Legs */}
        {[45, 135, 225, 315].map((angle, i) => {
          const rad = (angle * Math.PI) / 180
          return (
            <group key={i} rotation={[0, rad, 0]}>
              <mesh position={[1.4, 0.04, 0]}>
                <cylinderGeometry args={[0.35, 0.45, 0.08, 14]} />
                <meshStandardMaterial color="#475569" metalness={0.8} roughness={0.3} />
              </mesh>
              <mesh position={[1.0, 0.6, 0]} rotation={[0, 0, -0.45]}>
                <cylinderGeometry args={[0.08, 0.08, 1.4, 8]} />
                <meshStandardMaterial color="#94a3b8" metalness={0.85} roughness={0.2} />
              </mesh>
            </group>
          )
        })}

        {/* Raptor Engine Bells */}
        {[-0.3, 0.3].map((x, i) => (
          <mesh key={i} position={[x, 0.35, 0]}>
            <coneGeometry args={[0.28, 0.5, 16, 1, true]} />
            <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.4} side={THREE.DoubleSide} />
          </mesh>
        ))}

        {/* Main Stainless Steel Tower */}
        <mesh position={[0, 3.2, 0]}>
          <cylinderGeometry args={[0.95, 0.95, 5.4, 28]} />
          <meshStandardMaterial color="#e2e8f0" metalness={0.92} roughness={0.15} />
        </mesh>

        {/* Top Nosecone with Crew Cabin */}
        <mesh position={[0, 6.6, 0]}>
          <coneGeometry args={[0.95, 1.4, 28]} />
          <meshStandardMaterial color="#f1f5f9" metalness={0.88} roughness={0.2} />
        </mesh>

        {/* Ring Solar Array near the top */}
        <mesh position={[0, 5.2, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.97, 1.6, 32]} />
          <meshStandardMaterial color="#1d4ed8" emissive="#1e3a8a" emissiveIntensity={0.45} side={THREE.DoubleSide} metalness={0.8} roughness={0.2} />
        </mesh>

        {/* High-Gain Dish Antenna */}
        <group position={[0.98, 5.7, 0]}>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.05, 0.05, 0.3, 8]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.8} />
          </mesh>
          <mesh position={[0.25, 0, 0]}>
            <sphereGeometry args={[0.25, 14, 14]} />
            <meshBasicMaterial color="#8ddfe9" />
          </mesh>
        </group>
      </group>
    )
  }

  // Dynetics ALPACA: Low-slung crew cabin flanked by lateral propellant tanks
  if (isAlpaca) {
    return (
      <group position={[0, 0, 0]}>
        {/* Central Low-Center-of-Gravity Crew Cabin */}
        <mesh position={[0, 1.05, 0]}>
          <boxGeometry args={[2.0, 1.3, 2.2]} />
          <meshStandardMaterial color="#f8fafc" metalness={0.5} roughness={0.25} />
        </mesh>
        {/* Front EVA Hatch and Windows */}
        <mesh position={[0, 1.15, 1.12]}>
          <boxGeometry args={[0.8, 0.8, 0.05]} />
          <meshStandardMaterial color="#0284c7" emissive="#0369a1" emissiveIntensity={0.3} metalness={0.8} roughness={0.15} />
        </mesh>
        {/* EVA Steps to Lunar Surface */}
        <mesh position={[0, 0.35, 1.15]}>
          <boxGeometry args={[0.6, 0.6, 0.1]} />
          <meshStandardMaterial color="#475569" metalness={0.7} roughness={0.4} />
        </mesh>

        {/* Lateral Propellant Tanks (Left & Right Flanks) */}
        {[-1.6, 1.6].map((x, idx) => (
          <group key={idx} position={[x, 0.95, 0]}>
            <mesh rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.55, 0.55, 2.3, 20]} />
              <meshStandardMaterial color="#d97706" metalness={0.85} roughness={0.3} />
            </mesh>
            {/* Structural Mount Struts to central cabin */}
            <mesh position={[-Math.sign(x) * 0.3, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.06, 0.06, 0.6, 8]} />
              <meshStandardMaterial color="#64748b" metalness={0.8} />
            </mesh>
          </group>
        ))}

        {/* 4 Outrigger Landing Legs with Wide Footpads */}
        {[
          [-1.9, 1.2],
          [1.9, 1.2],
          [-1.9, -1.2],
          [1.9, -1.2],
        ].map(([x, z], i) => (
          <group key={i}>
            <mesh position={[x, 0.04, z]}>
              <cylinderGeometry args={[0.3, 0.36, 0.08, 14]} />
              <meshStandardMaterial color="#eab308" metalness={0.7} roughness={0.3} />
            </mesh>
            <mesh position={[x * 0.85, 0.45, z * 0.85]} rotation={[Math.sign(z) * 0.35, 0, -Math.sign(x) * 0.35]}>
              <cylinderGeometry args={[0.06, 0.06, 1.1, 8]} />
              <meshStandardMaterial color="#cbd5e1" metalness={0.85} roughness={0.2} />
            </mesh>
          </group>
        ))}

        {/* Twin Descent Engines Underneath */}
        {[-0.5, 0.5].map((x, i) => (
          <mesh key={i} position={[x, 0.25, 0]}>
            <coneGeometry args={[0.22, 0.35, 14, 1, true]} />
            <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.4} side={THREE.DoubleSide} />
          </mesh>
        ))}

        {/* Deployable Top Solar Array Wings */}
        <group position={[0, 1.85, 0]}>
          <mesh position={[0, 0.08, 0]}>
            <cylinderGeometry args={[0.05, 0.05, 0.3, 8]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.8} />
          </mesh>
          <mesh position={[1.5, 0.15, 0]} rotation={[0.2, 0, 0]}>
            <boxGeometry args={[1.5, 0.02, 0.8]} />
            <meshStandardMaterial color="#1d4ed8" emissive="#1e3a8a" emissiveIntensity={0.45} metalness={0.8} roughness={0.2} />
          </mesh>
          <mesh position={[-1.5, 0.15, 0]} rotation={[0.2, 0, 0]}>
            <boxGeometry args={[1.5, 0.02, 0.8]} />
            <meshStandardMaterial color="#1d4ed8" emissive="#1e3a8a" emissiveIntensity={0.45} metalness={0.8} roughness={0.2} />
          </mesh>
        </group>

        {/* High-Gain Antenna on Mast */}
        <group position={[0.7, 2.3, -0.4]}>
          <mesh position={[0, -0.3, 0]}>
            <cylinderGeometry args={[0.03, 0.03, 0.6, 8]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.85} />
          </mesh>
          <mesh rotation={[0.3, 0, 0]}>
            <sphereGeometry args={[0.26, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
            <meshStandardMaterial color="#8ddfe9" side={THREE.DoubleSide} metalness={0.85} roughness={0.2} />
          </mesh>
        </group>
      </group>
    )
  }

  // Blue Moon MK2: Tall Two-Stage Lander
  if (isBlueMoon) {
    return (
      <group position={[0, 0, 0]}>
        {/* 4 Landing Legs */}
        {[45, 135, 225, 315].map((angle, i) => {
          const rad = (angle * Math.PI) / 180
          const padX = Math.sin(rad) * 1.8
          const padZ = Math.cos(rad) * 1.8
          return (
            <group key={i}>
              <mesh position={[padX, 0.04, padZ]}>
                <cylinderGeometry args={[0.32, 0.4, 0.08, 14]} />
                <meshStandardMaterial color="#eab308" metalness={0.7} roughness={0.3} />
              </mesh>
              <mesh position={[padX * 0.65, 0.7, padZ * 0.65]} rotation={[Math.cos(rad) * 0.5, 0, -Math.sin(rad) * 0.5]}>
                <cylinderGeometry args={[0.06, 0.06, 1.6, 8]} />
                <meshStandardMaterial color="#cbd5e1" metalness={0.85} roughness={0.2} />
              </mesh>
            </group>
          )
        })}

        {/* Lower Propulsion Section (BE-7 Engines + Tanks) */}
        <mesh position={[0, 0.35, 0]}>
          <coneGeometry args={[0.4, 0.45, 16, 1, true]} />
          <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.4} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 1.1, 0]}>
          <cylinderGeometry args={[1.2, 1.25, 1.2, 20]} />
          <meshStandardMaterial color="#d97706" metalness={0.85} roughness={0.3} />
        </mesh>

        {/* Upper Crew / Cargo Stage */}
        <mesh position={[0, 2.3, 0]}>
          <cylinderGeometry args={[1.1, 1.15, 1.2, 20]} />
          <meshStandardMaterial color="#f8fafc" metalness={0.4} roughness={0.3} />
        </mesh>

        {/* High Solar Arrays */}
        <mesh position={[1.8, 3.2, 0]} rotation={[0.25, 0, 0]}>
          <boxGeometry args={[1.6, 0.03, 0.75]} />
          <meshStandardMaterial color="#1d4ed8" emissive="#1e3a8a" emissiveIntensity={0.45} metalness={0.8} roughness={0.2} />
        </mesh>
        <mesh position={[-1.8, 3.2, 0]} rotation={[0.25, 0, 0]}>
          <boxGeometry args={[1.6, 0.03, 0.75]} />
          <meshStandardMaterial color="#1d4ed8" emissive="#1e3a8a" emissiveIntensity={0.45} metalness={0.8} roughness={0.2} />
        </mesh>

        {/* Comms Dish */}
        <group position={[0.8, 3.5, 0.4]}>
          <mesh position={[0, -0.3, 0]}>
            <cylinderGeometry args={[0.04, 0.04, 0.5, 8]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.8} />
          </mesh>
          <mesh rotation={[0.3, 0, 0]}>
            <sphereGeometry args={[0.3, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
            <meshStandardMaterial color="#8ddfe9" side={THREE.DoubleSide} metalness={0.85} roughness={0.2} />
          </mesh>
        </group>
      </group>
    )
  }

  // Griffin Heavy Cargo Lander (Astrobotic)
  if (isGriffin) {
    return (
      <group position={[0, 0, 0]}>
        {/* 4 Wide Quad Legs */}
        {[45, 135, 225, 315].map((angle, i) => {
          const rad = (angle * Math.PI) / 180
          const padX = Math.sin(rad) * 1.7
          const padZ = Math.cos(rad) * 1.7
          return (
            <group key={i}>
              <mesh position={[padX, 0.04, padZ]}>
                <cylinderGeometry args={[0.28, 0.34, 0.08, 12]} />
                <meshStandardMaterial color="#eab308" metalness={0.7} roughness={0.3} />
              </mesh>
              <mesh position={[padX * 0.65, 0.45, padZ * 0.65]} rotation={[Math.cos(rad) * 0.45, 0, -Math.sin(rad) * 0.45]}>
                <cylinderGeometry args={[0.06, 0.06, 1.1, 8]} />
                <meshStandardMaterial color="#94a3b8" metalness={0.85} roughness={0.2} />
              </mesh>
            </group>
          )
        })}

        {/* Hexagonal Propulsion Core */}
        <mesh position={[0, 0.7, 0]}>
          <cylinderGeometry args={[1.3, 1.4, 0.8, 6]} />
          <meshStandardMaterial color="#d97706" metalness={0.85} roughness={0.3} />
        </mesh>

        {/* Wide Flat Top Payload Deck (holds VIPER) */}
        <mesh position={[0, 1.2, 0]}>
          <cylinderGeometry args={[1.45, 1.45, 0.15, 6]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.8} roughness={0.3} />
        </mesh>

        {/* Rover Deployment Ramps (Front & Rear) */}
        <mesh position={[0, 0.7, 1.55]} rotation={[0.6, 0, 0]}>
          <boxGeometry args={[1.1, 0.04, 1.2]} />
          <meshStandardMaterial color="#475569" metalness={0.7} roughness={0.4} />
        </mesh>

        {/* Deck Antenna and Solar Mast */}
        <group position={[1.1, 1.8, -0.6]}>
          <mesh position={[0, -0.3, 0]}>
            <cylinderGeometry args={[0.04, 0.04, 0.7, 8]} />
            <meshStandardMaterial color="#cbd5e1" metalness={0.8} />
          </mesh>
          <mesh rotation={[0.3, 0, 0]}>
            <sphereGeometry args={[0.24, 12, 12, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
            <meshStandardMaterial color="#8ddfe9" side={THREE.DoubleSide} metalness={0.85} roughness={0.2} />
          </mesh>
        </group>
      </group>
    )
  }

  // Commercial CLPS Landers (Nova-C / Blue Ghost / Standard)
  return (
    <group position={[0, 0, 0]}>
      {/* 4 or 6 Outrigger Landing Legs with Golden Footpads */}
      {(isNovaC ? [30, 90, 150, 210, 270, 330] : [45, 135, 225, 315]).map((angle, i) => {
        const rad = (angle * Math.PI) / 180
        const padX = Math.sin(rad) * 1.5
        const padZ = Math.cos(rad) * 1.5
        return (
          <group key={i}>
            <mesh position={[padX, 0.04, padZ]}>
              <cylinderGeometry args={[0.24, 0.3, 0.08, 12]} />
              <meshStandardMaterial color="#eab308" metalness={0.7} roughness={0.3} />
            </mesh>
            <mesh position={[padX * 0.65, 0.5, padZ * 0.65]} rotation={[Math.cos(rad) * 0.5, 0, -Math.sin(rad) * 0.5]}>
              <cylinderGeometry args={[0.05, 0.05, 1.2, 8]} />
              <meshStandardMaterial color="#cbd5e1" metalness={0.85} roughness={0.2} />
            </mesh>
          </group>
        )
      })}

      {/* Main Engine Bell */}
      <mesh position={[0, 0.35, 0]}>
        <coneGeometry args={[0.35, 0.4, 16, 1, true]} />
        <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.4} side={THREE.DoubleSide} />
      </mesh>

      {/* Lower Propulsion Section (Gold MLI Thermal Foil) */}
      <mesh position={[0, 0.8, 0]}>
        <cylinderGeometry args={[0.82, 0.9, 0.6, isNovaC ? 6 : 8]} />
        <meshStandardMaterial color="#d97706" metalness={0.85} roughness={0.3} />
      </mesh>

      {/* Main Spacecraft Octagonal/Hexagonal Bus */}
      <mesh position={[0, 1.6, 0]}>
        <cylinderGeometry args={[0.8, 0.82, 1.0, isNovaC ? 6 : 8]} />
        <meshStandardMaterial color="#f8fafc" metalness={0.4} roughness={0.3} />
      </mesh>

      {/* Integrated or Deployable Solar Arrays */}
      <mesh position={[1.4, 1.9, 0]} rotation={[0.2, 0, 0]}>
        <boxGeometry args={[1.2, 0.03, 0.55]} />
        <meshStandardMaterial color="#1d4ed8" emissive="#1e3a8a" emissiveIntensity={0.4} metalness={0.8} roughness={0.2} />
      </mesh>
      <mesh position={[-1.4, 1.9, 0]} rotation={[0.2, 0, 0]}>
        <boxGeometry args={[1.2, 0.03, 0.55]} />
        <meshStandardMaterial color="#1d4ed8" emissive="#1e3a8a" emissiveIntensity={0.4} metalness={0.8} roughness={0.2} />
      </mesh>

      {/* High-Gain Antenna Strut and Dish */}
      <group position={[0.7, 2.3, 0.3]}>
        <mesh position={[0, -0.3, 0]}>
          <cylinderGeometry args={[0.04, 0.04, 0.5, 8]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.8} />
        </mesh>
        <mesh rotation={[0.3, 0, 0]}>
          <sphereGeometry args={[0.24, 12, 12, 0, Math.PI * 2, 0, Math.PI * 0.5]} />
          <meshStandardMaterial color="#8ddfe9" side={THREE.DoubleSide} metalness={0.85} roughness={0.2} />
        </mesh>
      </group>
    </group>
  )
}

/** 3D Habitat or Solar Tower Model */
function InfrastructureModel({ vehicle }: { vehicle: VehicleProfile }) {
  const isTower = vehicle.lander_name.toLowerCase().includes('torre') || vehicle.lander_name.toLowerCase().includes('vsat')

  if (isTower) {
    // NASA VSAT: Vertical Solar Array Technology Tower
    return (
      <group position={[0, 0, 0]}>
        {/* Base Anchor Pad */}
        <mesh position={[0, 0.1, 0]}>
          <cylinderGeometry args={[1.4, 1.6, 0.2, 16]} />
          <meshStandardMaterial color="#334155" metalness={0.7} roughness={0.4} />
        </mesh>
        {/* Tall Telescoping Lattice Mast */}
        <mesh position={[0, 3.2, 0]}>
          <cylinderGeometry args={[0.15, 0.22, 6.0, 8]} />
          <meshStandardMaterial color="#94a3b8" wireframe metalness={0.9} roughness={0.2} />
        </mesh>
        {/* Vertical Solar Array Wings */}
        <mesh position={[1.2, 4.2, 0]} rotation={[0, 0.3, 0]}>
          <boxGeometry args={[2.0, 3.8, 0.04]} />
          <meshStandardMaterial color="#1d4ed8" emissive="#1e3a8a" emissiveIntensity={0.5} metalness={0.85} roughness={0.2} />
        </mesh>
        <mesh position={[-1.2, 4.2, 0]} rotation={[0, 0.3, 0]}>
          <boxGeometry args={[2.0, 3.8, 0.04]} />
          <meshStandardMaterial color="#1d4ed8" emissive="#1e3a8a" emissiveIntensity={0.5} metalness={0.85} roughness={0.2} />
        </mesh>
        {/* Top Tracking Beacon */}
        <mesh position={[0, 6.4, 0]}>
          <sphereGeometry args={[0.18, 12, 12]} />
          <meshBasicMaterial color="#f5cb67" />
        </mesh>
      </group>
    )
  }

  // Artemis Base Camp Pressurized Habitat Dome
  return (
    <group position={[0, 0, 0]}>
      {/* Foundation Base */}
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[2.4, 2.5, 0.2, 24]} />
        <meshStandardMaterial color="#334155" metalness={0.6} roughness={0.5} />
      </mesh>
      {/* Pressurized Habitat Dome */}
      <mesh position={[0, 1.1, 0]}>
        <sphereGeometry args={[2.1, 24, 20, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
        <meshStandardMaterial color="#f8fafc" metalness={0.3} roughness={0.3} />
      </mesh>
      {/* Airlock Vestibule Tunnel */}
      <mesh position={[0, 0.65, 2.1]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.6, 0.6, 0.9, 16]} />
        <meshStandardMaterial color="#475569" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* Habitat External Communications & Solar Array */}
      <group position={[0, 2.5, 0]}>
        <mesh position={[0, 0.4, 0]}>
          <cylinderGeometry args={[0.06, 0.06, 0.8, 8]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.8} />
        </mesh>
        <mesh position={[1.4, 0.8, 0]} rotation={[0.2, 0, 0]}>
          <boxGeometry args={[2.0, 0.03, 0.8]} />
          <meshStandardMaterial color="#1d4ed8" emissive="#1e3a8a" emissiveIntensity={0.4} metalness={0.85} roughness={0.2} />
        </mesh>
        <mesh position={[-1.4, 0.8, 0]} rotation={[0.2, 0, 0]}>
          <boxGeometry args={[2.0, 0.03, 0.8]} />
          <meshStandardMaterial color="#1d4ed8" emissive="#1e3a8a" emissiveIntensity={0.4} metalness={0.85} roughness={0.2} />
        </mesh>
      </group>
    </group>
  )
}

/** Auto-rotating turntable wrapper */
function RotatingStudio({
  vehicle,
  autoRotate,
  showRulers,
}: {
  vehicle: VehicleProfile
  autoRotate: boolean
  showRulers: boolean
}) {
  const groupRef = useRef<THREE.Group>(null)
  const isRover = Boolean(vehicle.is_rover || vehicle.category === 'Rover y Movilidad')
  const isInfrastructure = vehicle.category === 'Infraestructura Polar'

  useFrame((_, delta) => {
    if (autoRotate && groupRef.current) {
      groupRef.current.rotation.y += delta * 0.45
    }
  })

  // Dynamic label positions based on vehicle
  const solarLabelY = useMemo(() => {
    const name = vehicle.lander_name.toLowerCase()
    if (name.includes('starship')) return 5.4
    if (name.includes('vsat')) return 4.5
    if (name.includes('blue moon')) return 3.2
    return 2.0
  }, [vehicle.lander_name])

  const antennaLabelY = useMemo(() => {
    const name = vehicle.lander_name.toLowerCase()
    if (name.includes('starship')) return 6.0
    if (name.includes('vsat')) return 6.2
    if (name.includes('blue moon')) return 3.5
    return 2.4
  }, [vehicle.lander_name])

  return (
    <group ref={groupRef}>
      {isRover ? (
        <RoverModel vehicle={vehicle} />
      ) : isInfrastructure ? (
        <InfrastructureModel vehicle={vehicle} />
      ) : (
        <LanderModel vehicle={vehicle} />
      )}

      {/* Dynamic 3D Physical Metric Callouts */}
      {showRulers && (
        <group>
          <Html position={[2.1, solarLabelY, 0]} center>
            <div className="studio-ruler-badge solar-badge">
              <Sun size={11} />
              <span>Paneles: <b>{vehicle.solar_panel_height} m</b></span>
            </div>
          </Html>

          <Html position={[-2.1, antennaLabelY, 0]} center>
            <div className="studio-ruler-badge antenna-badge">
              <Globe2 size={11} />
              <span>Antena: <b>{vehicle.antenna_height} m</b></span>
            </div>
          </Html>
        </group>
      )}
    </group>
  )
}

export default function LunarObject3DViewer({
  activeVehicle,
  onSelectVehicle,
  onClose,
}: Props) {
  const { tr } = useI18n()
  const [autoRotate, setAutoRotate] = useState(true)
  const [showRulers, setShowRulers] = useState(true)
  const [resetTrigger, setResetTrigger] = useState(0)
  const controlsRef = useRef<any>(null)

  const isRover = Boolean(activeVehicle.is_rover || activeVehicle.category === 'Rover y Movilidad')
  const allObjects = useMemo(() => Object.entries(LUNAR_OBJECTS), [])

  const resetCamera = () => {
    setResetTrigger(t => t + 1)
    if (controlsRef.current) {
      controlsRef.current.reset()
    }
  }

  // Clean Lucide icons instead of emojis
  const renderObjectIcon = (item: VehicleProfile) => {
    if (item.is_rover || item.category === 'Rover y Movilidad') {
      return <Bot size={15} />
    }
    if (item.category === 'Infraestructura Polar') {
      return <Building2 size={15} />
    }
    if (item.category === 'Referencia del modelo') {
      return <Crosshair size={15} />
    }
    return <Rocket size={15} />
  }

  return (
    <div className="lunar-object-studio-container" data-testid="lunar-object-3d-viewer">
      {/* 3D Canvas Studio */}
      <Canvas
        camera={{ position: [7.0, 4.5, 7.5], fov: 42 }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      >
        <color attach="background" args={['#060a10']} />
        <Stars radius={200} depth={80} count={1200} factor={3} fade />

        {/* Studio Space & Sun Lighting */}
        <ambientLight intensity={0.45} />
        <directionalLight position={[12, 16, 10]} intensity={2.4} color="#fffcf2" castShadow />
        <directionalLight position={[-10, 4, -8]} intensity={0.65} color="#8ddfe9" />
        <pointLight position={[0, -2, 0]} intensity={0.25} color="#64748b" />

        {/* Lunar Regolith Studio Platform with Distance Rings */}
        <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <circleGeometry args={[4.2, 48]} />
          <meshStandardMaterial color="#0b131d" roughness={0.85} metalness={0.2} />
        </mesh>
        <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[1.98, 2.02, 48]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.3} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[3.98, 4.02, 48]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.15} side={THREE.DoubleSide} />
        </mesh>

        {/* Centered Rotating Model */}
        <RotatingStudio vehicle={activeVehicle} autoRotate={autoRotate} showRulers={showRulers} />

        {/* Camera Framer adapts dynamically to object scale with full user zoom/scroll freedom */}
        <CameraFramer vehicle={activeVehicle} controlsRef={controlsRef} resetTrigger={resetTrigger} />

        <OrbitControls
          ref={controlsRef}
          enableDamping
          dampingFactor={0.06}
          minDistance={1.2}
          maxDistance={60}
          maxPolarAngle={Math.PI / 2 - 0.02}
        />
      </Canvas>

      {/* Top Header Overlay inside the Studio */}
      <div className="studio-top-overlay">
        <div className="studio-title-badge">
          <span className="micro-title">{tr("ESTUDIO 3D DE VEHÍCULO · POLO SUR LUNAR")}</span>
          <h3>{tr(activeVehicle.lander_name)}</h3>
          <span className="studio-category-tag">{tr(activeVehicle.category ?? 'Vehículo')}</span>
        </div>

        <div className="studio-actions-bar">
          <button
            type="button"
            className={'studio-tool-btn' + (autoRotate ? ' active' : '')}
            onClick={() => setAutoRotate(v => !v)}
            title={tr(autoRotate ? "Pausar giro automático" : "Activar giro automático")}
          >
            {autoRotate ? <Pause size={13} /> : <Play size={13} />}
            <span>{tr(autoRotate ? "Pausar giro" : "Girar 360°")}</span>
          </button>

          <button
            type="button"
            className={'studio-tool-btn' + (showRulers ? ' active' : '')}
            onClick={() => setShowRulers(v => !v)}
            title={tr("Mostrar/ocultar cotas métricas")}
          >
            <Ruler size={13} />
            <span>{tr("Cotas")}</span>
          </button>

          <button
            type="button"
            className="studio-tool-btn"
            onClick={resetCamera}
            title={tr("Reiniciar cámara")}
          >
            <RotateCcw size={13} />
            <span>{tr("Centrar")}</span>
          </button>

          {onClose && (
            <button
              type="button"
              className="studio-tool-btn studio-close-btn"
              onClick={onClose}
              title={tr("Volver al mapa lunar")}
            >
              <X size={13} />
              <span>{tr("Volver al mapa")}</span>
            </button>
          )}
        </div>
      </div>

      {/* HUD Telemetry Specifications Card on Top-Right (No overlap with bottom dock) */}
      <div className="studio-hud-telemetry" data-testid="studio-hud-telemetry">
        <div className="hud-metric-row">
          <div className="hud-metric-icon sun"><Sun size={13} /></div>
          <div className="hud-metric-data">
            <small>{tr("Paneles solares")}</small>
            <strong>{activeVehicle.solar_panel_height} m</strong>
          </div>
        </div>

        <div className="hud-metric-row">
          <div className="hud-metric-icon earth"><Globe2 size={13} /></div>
          <div className="hud-metric-data">
            <small>{tr("Antena DTE")}</small>
            <strong>{activeVehicle.antenna_height} m</strong>
          </div>
        </div>

        <div className="hud-metric-row">
          <div className="hud-metric-icon warn"><ShieldAlert size={13} /></div>
          <div className="hud-metric-data">
            <small>{tr("Inclinación límite")}</small>
            <strong>{activeVehicle.center_of_gravity_tolerance}°</strong>
          </div>
        </div>

        {isRover && (
          <div className="hud-metric-row rover-accent">
            <div className="hud-metric-icon rover"><Compass size={13} /></div>
            <div className="hud-metric-data">
              <small>{tr("Radio de travesía")}</small>
              <strong>{activeVehicle.nominal_range_km ?? 15} km</strong>
              <span>({activeVehicle.speed_km_h ?? 2.5} km/h)</span>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Horizontal Vehicle Carousel Selector with Lucide Icons (Clean and spacious) */}
      <div className="studio-carousel-dock">
        <span className="dock-hint">{tr("Elige un objeto lunar para inspeccionarlo en 3D:")}</span>
        <div className="dock-scroll-row">
          {allObjects.map(([key, item]) => {
            const active = activeVehicle.lander_name === item.lander_name
            const roverItem = Boolean(item.is_rover || item.category === 'Rover y Movilidad')
            return (
              <button
                key={key}
                type="button"
                className={'dock-item-btn' + (active ? ' active' : '')}
                onClick={() => onSelectVehicle(item)}
              >
                <div className="dock-item-icon">
                  {renderObjectIcon(item)}
                </div>
                <div className="dock-item-text">
                  <strong>{tr(item.lander_name)}</strong>
                  <small>{roverItem ? `${item.nominal_range_km ?? 15} km` : `${item.solar_panel_height}m`}</small>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
