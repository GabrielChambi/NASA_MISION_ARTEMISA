import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

export function LunarRocketLanderModel({
  isSafe,
  scale,
  statusColor,
  solarPanelHeightM = 15,
  antennaHeightM = 12,
  pulseKey = 0,
}: {
  isSafe: boolean
  scale: number
  statusColor?: string
  solarPanelHeightM?: number
  antennaHeightM?: number
  pulseKey?: number
}) {
  const maxH = Math.max(solarPanelHeightM, antennaHeightM, 4)
  // Scale vertical hull height so a 50m Starship HLS looks like a tall tower compared to a 6m or 15m lander
  const heightStretch = THREE.MathUtils.clamp(maxH / 12, 0.75, 3.2)
  const panelLocalY = THREE.MathUtils.clamp((solarPanelHeightM / maxH) * (2.6 * heightStretch) + 0.55, 0.9, 3.2 * heightStretch)
  const antennaLocalY = THREE.MathUtils.clamp((antennaHeightM / maxH) * (2.6 * heightStretch) + 0.45, 0.75, 3.1 * heightStretch)

  const pulseRef = useRef<THREE.Mesh>(null)
  const pulseTimer = useRef(0)

  useEffect(() => {
    pulseTimer.current = 1.0
  }, [pulseKey, solarPanelHeightM, antennaHeightM])

  useFrame((_, delta) => {
    if (pulseRef.current && pulseTimer.current > 0) {
      pulseTimer.current = Math.max(0, pulseTimer.current - delta * 1.4)
      const s = 1 + (1 - pulseTimer.current) * 1.8
      pulseRef.current.scale.set(s, s, 1)
      const mat = pulseRef.current.material as THREE.MeshBasicMaterial
      mat.opacity = pulseTimer.current * 0.85
      pulseRef.current.visible = pulseTimer.current > 0.02
    }
  })

  const hullHeight = 1.4 * heightStretch
  const hullCenterY = 1.05 + hullHeight / 2
  const noseCenterY = 1.05 + hullHeight + 0.38

  return (
    <group scale={[scale, scale, scale]}>
      {/* Surface Contact Base Pad Ring at exact Y = 0.01 */}
      <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.35, 1.55, 24]} />
        <meshBasicMaterial color={statusColor ?? (isSafe ? '#2ed573' : '#ff4757')} transparent opacity={0.55} side={THREE.DoubleSide} />
      </mesh>

      {/* Profile Upload Pulse Ring */}
      <mesh ref={pulseRef} visible={false} position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.5, 2.1, 32]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0} side={THREE.DoubleSide} />
      </mesh>

      {/* 4 Heavy Landing Gear Struts & Golden Footpads resting at exact Y = 0.00 */}
      {[45, 135, 225, 315].map((angle, i) => {
        const rad = (angle * Math.PI) / 180
        const padX = Math.sin(rad) * 1.42
        const padZ = Math.cos(rad) * 1.42
        return (
          <group key={i}>
            <mesh position={[padX, 0.04, padZ]}>
              <cylinderGeometry args={[0.28, 0.34, 0.08, 12]} />
              <meshStandardMaterial color="#eab308" roughness={0.35} metalness={0.75} />
            </mesh>
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

      {/* Engine Bells */}
      <mesh position={[0, 0.35, 0]}>
        <coneGeometry args={[0.42, 0.38, 16, 1, true]} />
        <meshStandardMaterial color="#334155" roughness={0.6} metalness={0.7} side={THREE.DoubleSide} />
      </mesh>

      {/* Lower Propulsion & Thermal Gold Skirt */}
      <mesh position={[0, 0.75, 0]}>
        <cylinderGeometry args={[0.88, 0.96, 0.6, 16]} />
        <meshStandardMaterial color="#d97706" roughness={0.32} metalness={0.82} />
      </mesh>

      {/* Main Pressurized Cylindrical Rocket Hull (scales with vehicle height) */}
      <mesh position={[0, hullCenterY, 0]}>
        <cylinderGeometry args={[0.85, 0.88, hullHeight, 20]} />
        <meshStandardMaterial color="#f8fafc" roughness={0.25} metalness={0.45} />
      </mesh>

      {/* Dark Thermal Shield Accent Band */}
      <mesh position={[0, hullCenterY + hullHeight * 0.18, 0]}>
        <cylinderGeometry args={[0.865, 0.865, 0.24, 20]} />
        <meshStandardMaterial color="#0f172a" roughness={0.2} metalness={0.5} />
      </mesh>

      {/* Conical Rocket Nose Fairing / Upper Ascent Dome */}
      <mesh position={[0, noseCenterY, 0]}>
        <coneGeometry args={[0.85, 0.76, 20]} />
        <meshStandardMaterial color="#f1f5f9" roughness={0.25} metalness={0.4} />
      </mesh>

      {/* Deployed Solar Array Wings positioned at solarPanelHeightM */}
      <mesh position={[1.65, panelLocalY, 0]} rotation={[0.2, 0, 0]}>
        <boxGeometry args={[1.55, 0.04, 0.52]} />
        <meshStandardMaterial color="#1d4ed8" emissive="#1e3a8a" emissiveIntensity={0.35} roughness={0.2} metalness={0.8} />
      </mesh>
      <mesh position={[-1.65, panelLocalY, 0]} rotation={[0.2, 0, 0]}>
        <boxGeometry args={[1.55, 0.04, 0.52]} />
        <meshStandardMaterial color="#1d4ed8" emissive="#1e3a8a" emissiveIntensity={0.35} roughness={0.2} metalness={0.8} />
      </mesh>

      {/* Solar Emitter Node (Yellow beacon at solar_panel_height) */}
      <mesh position={[0, noseCenterY + 0.42, 0]}>
        <sphereGeometry args={[0.22, 14, 14]} />
        <meshBasicMaterial color="#f5cb67" />
      </mesh>

      {/* Side-Mounted DTE Parabolic Antenna Dish at antenna_height */}
      <group position={[1.05, antennaLocalY, 0.35]}>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.05, 0.05, 0.45, 8]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh position={[0.24, 0, 0]}>
          <sphereGeometry args={[0.2, 12, 12]} />
          <meshBasicMaterial color="#8ddfe9" />
        </mesh>
      </group>
    </group>
  )
}
