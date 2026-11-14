// Central lunar gravity: JPL DE440. Vehicle and engine values are editable
// hypotheses, not specifications of Artemis or any NASA flight vehicle.
export const MOON_GM = 4.902800118e12 // m^3/s^2
export const MOON_RADIUS = 1737400 // m
export const STANDARD_GRAVITY = 9.80665 // definition used by Isp
export const PHYSICS_SOURCES = {
  gravity: 'https://ssd.jpl.nasa.gov/astro_par.html',
  radius: 'https://ssd.jpl.nasa.gov/sats/phys_par/',
  propulsion: 'https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/specific-impulse/',
}
export type DescentConfig = {
  altitudeM: number; downwardSpeedMps: number; wetMassKg: number; dryMassKg: number
  maxThrustN: number; ispS: number; targetSpeedMps: number; surfaceElevationM: number
}
export type DescentSample = {
  timeS: number; altitudeM: number; velocityMps: number; massKg: number; fuelKg: number
  thrustN: number; throttle: number; gravityMps2: number; accelerationMps2: number
}
export type DescentRun = {
  config: DescentConfig; samples: DescentSample[]; outcome: 'soft-touchdown' | 'hard-impact' | 'timeout'
  durationS: number; impactSpeedMps: number | null; fuelUsedKg: number; fuelExhausted: boolean
}
export const DEFAULT_DESCENT: DescentConfig = {
  altitudeM: 2000, downwardSpeedMps: 25, wetMassKg: 12000, dryMassKg: 6000,
  maxThrustN: 45000, ispS: 320, targetSpeedMps: 0.8, surfaceElevationM: 0,
}
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))
export function validateDescent(c: DescentConfig) {
  if (Object.values(c).some(v => !Number.isFinite(v))) throw new Error('Todos los parámetros deben ser números finitos.')
  if (c.altitudeM < 10 || c.altitudeM > 20000) throw new Error('La altura inicial debe estar entre 10 y 20 000 m.')
  if (c.downwardSpeedMps < 0 || c.downwardSpeedMps > 250) throw new Error('La velocidad inicial debe estar entre 0 y 250 m/s.')
  if (c.dryMassKg < 100 || c.wetMassKg <= c.dryMassKg || c.wetMassKg > 1000000) throw new Error('La masa total debe superar la masa seca (mínimo 100 kg).')
  if (c.maxThrustN < 0 || c.maxThrustN > 10000000 || c.ispS < 50 || c.ispS > 1000) throw new Error('Revisa el empuje (0–10 MN) y el impulso específico (50–1000 s).')
  if (c.targetSpeedMps < 0.1 || c.targetSpeedMps > 2) throw new Error('La velocidad objetivo debe estar entre 0,1 y 2 m/s.')
  if (c.surfaceElevationM < -10000 || c.surfaceElevationM > 12000) throw new Error('Elevación lunar fuera del intervalo del modelo.')
}
export function gravityAt(altitudeM: number, surfaceElevationM: number) {
  return MOON_GM / (MOON_RADIUS + surfaceElevationM + altitudeM) ** 2
}
type State = { h: number; v: number; m: number }
function derivative(s: State, thrust: number, c: DescentConfig): State {
  return { h: s.v, v: thrust / s.m - gravityAt(s.h, c.surfaceElevationM), m: -thrust / (c.ispS * STANDARD_GRAVITY) }
}
function advance(s: State, k: State, dt: number): State { return { h: s.h + k.h * dt, v: s.v + k.v * dt, m: s.m + k.m * dt } }
function rk4(s: State, dt: number, thrust: number, c: DescentConfig): State {
  const a = derivative(s, thrust, c), b = derivative(advance(s, a, dt / 2), thrust, c)
  const d = derivative(advance(s, b, dt / 2), thrust, c), e = derivative(advance(s, d, dt), thrust, c)
  return { h: s.h + dt * (a.h + 2*b.h + 2*d.h + e.h) / 6, v: s.v + dt * (a.v + 2*b.v + 2*d.v + e.v) / 6, m: s.m + dt * (a.m + 2*b.m + 2*d.m + e.m) / 6 }
}
function guidance(s: State, c: DescentConfig) {
  if (s.m <= c.dryMassKg + 1e-8) return 0
  const g = gravityAt(s.h, c.surfaceElevationM)
  const deceleration = clamp((c.maxThrustN / s.m - g) * 0.45, 0.05, 1.2)
  const speed = Math.sqrt(c.targetSpeedMps ** 2 + 2 * deceleration * Math.max(0, s.h))
  const desiredVelocity = -Math.min(45, speed)
  const feedForward = speed < 45 ? deceleration : 0
  return clamp(s.m * (g + feedForward + 0.8 * (desiredVelocity - s.v)), 0, c.maxThrustN)
}
function sample(s: State, t: number, thrust: number, c: DescentConfig): DescentSample {
  const gravityMps2 = gravityAt(s.h, c.surfaceElevationM)
  return { timeS: t, altitudeM: Math.max(0, s.h), velocityMps: s.v, massKg: s.m,
    fuelKg: Math.max(0, s.m - c.dryMassKg), thrustN: thrust, throttle: thrust / (c.maxThrustN || 1), gravityMps2, accelerationMps2: thrust / s.m - gravityMps2 }
}
export function simulateDescent(config: DescentConfig, stepS = 0.1, maxTimeS = 1800): DescentRun {
  validateDescent(config)
  if (!Number.isFinite(stepS) || stepS < 0.01 || stepS > 0.5 || !Number.isFinite(maxTimeS) || maxTimeS <= 0 || maxTimeS > 3600 || maxTimeS / stepS > 100000) throw new Error('Paso o duración de integración no válidos.')
  const c = { ...config }, samples: DescentSample[] = []
  let s: State = { h: c.altitudeM, v: -c.downwardSpeedMps, m: c.wetMassKg }, t = 0
  samples.push(sample(s, t, guidance(s, c), c))
  while (t < maxTimeS && s.h > 0) {
    if (maxTimeS - t < 1e-9) break
    const thrust = guidance(s, c), flow = thrust / (c.ispS * STANDARD_GRAVITY)
    const remainingFuel = Math.max(0, s.m - c.dryMassKg)
    const dt = Math.min(stepS, maxTimeS - t, flow > 0 ? remainingFuel / flow : stepS)
    if (dt < 1e-9) { s.m = c.dryMassKg; continue }
    let next = rk4(s, dt, thrust, c), elapsed = dt
    if (next.h <= 0) {
      // Locate the first intersection with the measured local surface.
      let lo = 0, hi = dt
      for (let i = 0; i < 36; i++) { const mid = (lo + hi) / 2; if (rk4(s, mid, thrust, c).h > 0) lo = mid; else hi = mid }
      elapsed = (lo + hi) / 2; next = rk4(s, elapsed, thrust, c); next.h = 0
    }
    next.m = Math.max(c.dryMassKg, next.m)
    s = next; t += elapsed; samples.push(sample(s, t, thrust, c))
  }
  const impactSpeedMps = s.h === 0 ? Math.abs(s.v) : null
  return { config: c, samples, durationS: t, impactSpeedMps,
    outcome: impactSpeedMps === null ? 'timeout' : impactSpeedMps <= 2 ? 'soft-touchdown' : 'hard-impact',
    fuelUsedKg: c.wetMassKg - s.m, fuelExhausted: s.m <= c.dryMassKg + 1e-6 }
}
export function descentAt(run: DescentRun, timeS: number): DescentSample {
  let lo = 0, hi = run.samples.length - 1
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (run.samples[mid].timeS <= timeS) lo = mid; else hi = mid - 1 }
  return run.samples[lo]
}
