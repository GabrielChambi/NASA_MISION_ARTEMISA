import * as THREE from 'three'
export function LunarRocketLanderModel({ isSafe, scale, statusColor }: { isSafe: boolean; scale: number; statusColor?:string }) {
  return (
    <group scale={[scale, scale, scale]}>
      {/* Surface Contact Base Pad Ring at exact Y = 0.01 */}
      <mesh position={[0, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.35, 1.55, 24]} />
        <meshBasicMaterial color={statusColor ?? (isSafe ? '#2ed573' : '#ff4757')} transparent opacity={0.55} side={THREE.DoubleSide} />
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
        <meshBasicMaterial color={statusColor ?? (isSafe ? '#2ed573' : '#ff4757')} />
      </mesh>

    </group>
  )
}
