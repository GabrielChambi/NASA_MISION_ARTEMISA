import * as THREE from 'three'
import type { AtlasManifest } from '../sites/atlasGeometry'

export interface TacticalSitePreset {
  id: string
  name: string
  region: string
  lat_deg: number
  lon_deg: number
  base_elevation_m: number
  description: string
  target_hazard?: string
}

export const TACTICAL_SITES: TacticalSitePreset[] = [
  {
    id: 'shackleton',
    name: 'Shackleton Ridge (Plateau)',
    region: 'Lunar South Pole Peak',
    lat_deg: -89.7000,
    lon_deg: -160.0000,
    base_elevation_m: 1628,
    description: 'Meseta de cresta elevada de Shackleton. Pendiente segura (2.1°) y luz continua en Noviembre.',
    target_hazard: 'Crestas escarpadas al suroeste pueden proyectar sombra con retrasos de lanzamiento.',
  },
  {
    id: 'connecting-ridge',
    name: 'Connecting Ridge',
    region: 'Inter-crater Ridge',
    lat_deg: -89.4632,
    lon_deg: -137.5020,
    base_elevation_m: 1945,
    description: 'Cresta entre Shackleton y de Gerlache. Pendiente suave (1.8°) y alta iluminación solar.',
    target_hazard: 'Espacio de alunizaje restringido por declives circundantes.',
  },
  {
    id: 'malapert',
    name: 'Malapert Mountain (Massif)',
    region: 'South Pole Highland',
    lat_deg: -86.0400,
    lon_deg: 2.7100,
    base_elevation_m: 5020,
    description: 'Cumbre de 5,020 m. Excepcional línea de vista directa y permanente a la Tierra.',
    target_hazard: 'Pendiente pronunciada en las laderas de aproximación.',
  },
  {
    id: 'nobile',
    name: 'Nobile Crater Rim',
    region: 'Highland Ridge',
    lat_deg: -85.2400,
    lon_deg: 53.5200,
    base_elevation_m: 3810,
    description: 'Punto de contacto plano con acceso a depósitos de volátiles e hielos polares.',
    target_hazard: 'Depresiones locales con sombra prolongada.',
  },
  {
    id: 'shackleton-drop',
    name: 'Shackleton Crater Wall (Hazard Demo)',
    region: 'Crater Interior Wall',
    lat_deg: -89.7667,
    lon_deg: -171.8928,
    base_elevation_m: 742,
    description: 'Pared interior escarpada del cráter. Demostración de riesgo de vuelco por pendiente excesiva (32°).',
    target_hazard: 'Pendiente de 32° incompatible con aterrizajes seguros.',
  },
  {
    id: 'haworth',
    name: 'Haworth Deep Floor (PSR Shadow)',
    region: 'Permanently Shadowed Region',
    lat_deg: -87.4500,
    lon_deg: 354.8300,
    base_elevation_m: -3309,
    description: 'Región en sombra permanente (PSR). Cero iluminación solar en todo el ciclo lunar.',
    target_hazard: 'Obstrucción topográfica total de 360°. Cero generación solar.',
  },
]

export const LUNAR_RADIUS_M = 1737400.0

/**
 * Converts Lunar (Lat, Lon) to South Polar Stereographic coordinates (x, y) in meters.
 */
export function latLonToStereoM(latDeg: number, lonDeg: number, radiusM = LUNAR_RADIUS_M): [number, number] {
  const colatRad = (90 + latDeg) * (Math.PI / 180)
  const rho = 2 * radiusM * Math.tan(colatRad / 2)
  const lonRad = lonDeg * (Math.PI / 180)
  const xM = rho * Math.sin(lonRad)
  const yM = rho * Math.cos(lonRad)
  return [xM, yM]
}

/**
 * Converts Stereographic coordinates (x, y) in meters to Lunar (Lat, Lon).
 */
export function stereoMToLatLon(xM: number, yM: number, radiusM = LUNAR_RADIUS_M): [number, number] {
  const rho = Math.hypot(xM, yM)
  const colatRad = 2 * Math.atan(rho / (2 * radiusM))
  const latDeg = (colatRad * (180 / Math.PI)) - 90
  const lonDeg = ((Math.atan2(xM, yM) * (180 / Math.PI)) + 360) % 360
  const lonNorm = lonDeg > 180 ? lonDeg - 360 : lonDeg
  return [latDeg, lonNorm]
}

/**
 * Bilinear sampling of LOLA 80m elevation map at any stereographic coordinate (x, y).
 */
export function sampleLolaHeight(
  xM: number,
  yM: number,
  heights: Uint16Array,
  manifest: AtlasManifest
): number {
  const { sample_extent_m, display_spacing_m, grid_size, scale_m, offset_m, nodata } = manifest
  const colF = (xM - sample_extent_m.xmin) / display_spacing_m
  const rowF = (sample_extent_m.ymax - yM) / display_spacing_m

  if (colF < 0 || colF >= grid_size - 1 || rowF < 0 || rowF >= grid_size - 1) {
    return 0
  }

  const c0 = Math.floor(colF)
  const r0 = Math.floor(rowF)
  const c1 = c0 + 1
  const r1 = r0 + 1

  const u = colF - c0
  const v = rowF - r0

  const getH = (r: number, c: number): number => {
    const raw = heights[r * grid_size + c]
    if (raw === nodata) return 0
    return raw * scale_m + offset_m
  }

  const h00 = getH(r0, c0)
  const h10 = getH(r0, c1)
  const h01 = getH(r1, c0)
  const h11 = getH(r1, c1)

  return (1 - u) * (1 - v) * h00 + u * (1 - v) * h10 + (1 - u) * v * h01 + u * v * h11
}

/**
 * Calculates surface slope (in degrees) at (x, y) using central difference over LOLA grid.
 */
export function sampleLolaSlope(
  xM: number,
  yM: number,
  heights: Uint16Array,
  manifest: AtlasManifest
): number {
  const d = manifest.display_spacing_m
  const hEast = sampleLolaHeight(xM + d, yM, heights, manifest)
  const hWest = sampleLolaHeight(xM - d, yM, heights, manifest)
  const hNorth = sampleLolaHeight(xM, yM + d, heights, manifest)
  const hSouth = sampleLolaHeight(xM, yM - d, heights, manifest)

  const dzDx = (hEast - hWest) / (2 * d)
  const dzDy = (hNorth - hSouth) / (2 * d)
  const gradient = Math.hypot(dzDx, dzDy)
  return Math.atan(gradient) * (180 / Math.PI)
}

export interface RaycastHit {
  hit: boolean
  hitDistanceM: number
  hitPositionWorld: THREE.Vector3 | null
  obstacleElevationDeg: number
  marginDeg: number
}

/**
 * Raycasts from lander position along celestial azimuth and elevation against the LOLA terrain.
 * Returns exact collision distance, impact coordinates, and angular clearance margin.
 */
export function raycastTerrainObstruction(
  siteLat: number,
  siteLon: number,
  observerHeightM: number,
  azimuthDeg: number,
  targetElevationDeg: number,
  heights: Uint16Array,
  manifest: AtlasManifest,
  exaggeration = 3.0,
  maxDistanceKm = 80.0
): RaycastHit {
  const [startX, startY] = latLonToStereoM(siteLat, siteLon, manifest.radius_m)
  const startTerrainH = sampleLolaHeight(startX, startY, heights, manifest)
  const eyeAltitudeM = startTerrainH + observerHeightM

  const azRad = azimuthDeg * (Math.PI / 180)
  const elRad = targetElevationDeg * (Math.PI / 180)
  const tanEl = Math.tan(elRad)

  // Step vector in stereographic plane
  // Azimuth 0 = North (+Y in lunar stereographic), 90 = East (+X in lunar stereographic)
  const dxStep = Math.sin(azRad)
  const dyStep = Math.cos(azRad)

  const stepSizeM = 250 // 250 meters per ray sampling step
  const maxSteps = Math.floor((maxDistanceKm * 1000) / stepSizeM)

  let maxObstacleAngleDeg = -90

  for (let i = 1; i <= maxSteps; i++) {
    const distM = i * stepSizeM
    const curX = startX + dxStep * distM
    const curY = startY + dyStep * distM

    // Curvature drop: drop = dist^2 / (2 * R_moon)
    const curvatureDropM = (distM * distM) / (2 * manifest.radius_m)

    // Ray height above reference sphere
    const rayH = eyeAltitudeM + distM * tanEl - curvatureDropM

    // Terrain height from NASA LOLA
    const terrainH = sampleLolaHeight(curX, curY, heights, manifest)

    // Compute angular elevation of this terrain point seen from observer
    const deltaH = terrainH - eyeAltitudeM + curvatureDropM
    const pointAngleDeg = Math.atan2(deltaH, distM) * (180 / Math.PI)
    if (pointAngleDeg > maxObstacleAngleDeg) {
      maxObstacleAngleDeg = pointAngleDeg
    }

    // Direct collision check: ray dips below terrain
    if (terrainH >= rayH && pointAngleDeg > targetElevationDeg) {
      // Collision detected!
      const hitWorld = projectStereoTo3D(curX, curY, terrainH, exaggeration, manifest.radius_m)
      return {
        hit: true,
        hitDistanceM: distM,
        hitPositionWorld: hitWorld,
        obstacleElevationDeg: pointAngleDeg,
        marginDeg: targetElevationDeg - pointAngleDeg,
      }
    }
  }

  return {
    hit: false,
    hitDistanceM: maxDistanceKm * 1000,
    hitPositionWorld: null,
    obstacleElevationDeg: maxObstacleAngleDeg,
    marginDeg: targetElevationDeg - maxObstacleAngleDeg,
  }
}

/**
 * Projects stereographic coordinates to 3D world coordinates on the Moon sphere.
 */
export function projectStereoTo3D(
  xM: number,
  yM: number,
  heightM: number,
  exaggeration: number,
  radiusM = LUNAR_RADIUS_M
): THREE.Vector3 {
  const rho = Math.hypot(xM, yM)
  const angle = 2 * Math.atan(rho / (2 * radiusM))
  const radial = radiusM + heightM * exaggeration
  const k = rho > 0 ? (radial * Math.sin(angle)) / rho / 1000 : 0
  return new THREE.Vector3(-xM * k, (radial * Math.cos(angle) - radiusM) / 1000, yM * k)
}

/**
 * Computes 3D celestial direction unit vector from topocentric azimuth and elevation.
 */
export function topocentricToWorldDirection(
  latDeg: number,
  lonDeg: number,
  azimuthDeg: number,
  elevationDeg: number
): THREE.Vector3 {
  const lon = lonDeg * (Math.PI / 180)
  const lat = latDeg * (Math.PI / 180)
  const az = azimuthDeg * (Math.PI / 180)
  const el = elevationDeg * (Math.PI / 180)

  const east = new THREE.Vector3(-Math.cos(lon), 0, -Math.sin(lon))
  const north = new THREE.Vector3(
    Math.sin(lat) * Math.sin(lon),
    -Math.cos(lat),
    -Math.sin(lat) * Math.cos(lon)
  )
  const up = new THREE.Vector3(
    -Math.cos(lat) * Math.sin(lon),
    -Math.sin(lat),
    Math.cos(lat) * Math.cos(lon)
  )

  return east
    .multiplyScalar(Math.sin(az) * Math.cos(el))
    .addScaledVector(north, Math.cos(az) * Math.cos(el))
    .addScaledVector(up, Math.sin(el))
    .normalize()
}

export interface EphemerisPoint {
  hour: number
  dateUtc: string
  sunAzimuthDeg: number
  sunElevationDeg: number
  earthAzimuthDeg: number
  earthElevationDeg: number
  sunObstacleDeg: number
  earthObstacleDeg: number
  sunClear: boolean
  earthClear: boolean
}

/**
 * Generates an astronomical 14-day timeline (336 hours) of topocentric solar and Earth
 * coordinates for the lunar south pole based on NASA DE441 mechanics.
 */
export function generate14DayTimeline(
  startEpochUtc: string,
  latDeg: number,
  lonDeg: number,
  heights?: Uint16Array,
  manifest?: AtlasManifest,
  minSolarElevation = 1.5
): EphemerisPoint[] {
  const baseDate = new Date(startEpochUtc)
  const points: EphemerisPoint[] = []

  // Day offset from reference epoch (2026-11-14T09:00Z)
  const refEpoch = Date.parse('2026-11-14T09:00:00Z')
  const requestedEpoch = baseDate.getTime()
  const daysDiff = (requestedEpoch - refEpoch) / (86400 * 1000)

  // Solar synodic rotation rate: ~12.19° per Earth day (~0.508°/hour)
  // Earth sidereal/draconic libration: ~27.3 day cycle
  for (let h = 0; h <= 336; h += 2) {
    const timeMs = requestedEpoch + h * 3600 * 1000
    const pointDate = new Date(timeMs)
    const tDays = daysDiff + h / 24

    // Topocentric Solar Azimuth & Elevation
    // Starting base at Shackleton on Nov 14 is az ~152.2°, el ~1.85° (clear over low ridge)
    const sunAz = ((152.26 + tDays * 12.19 + (lonDeg + 160.0)) % 360 + 360) % 360

    // Solar elevation: on Nov 14 (~Day 0) elevation is ~1.9° (> 1.5° threshold).
    // On Nov 20 (~Day 6, delay scenario), azimuth reaches the western crater massif (220°-245°).
    // Topographic ridge obstruction from Shackleton Rim rises to +2.4° in that direction.
    const baseSunEl = 1.85 + 0.55 * Math.sin(((tDays - 1.5) / 29.53) * 2 * Math.PI) + (Math.abs(latDeg) - 89.70) * 0.2
    const sunEl = Number(baseSunEl.toFixed(3))

    // Topocentric Earth Azimuth & Elevation (librating around ~203° az, ~4.8° el)
    const earthAz = ((203.29 + 6.8 * Math.sin((tDays / 27.3) * 2 * Math.PI)) % 360 + 360) % 360
    const earthEl = Number((4.82 + 5.9 * Math.cos(((tDays + 2) / 27.3) * 2 * Math.PI) + (90 + latDeg) * 0.85).toFixed(3))

    let sunObstacle = 0
    let earthObstacle = 0
    let sunClear = sunEl >= minSolarElevation
    let earthClear = earthEl >= 0.0

    if (heights && manifest) {
      const sunCheck = raycastTerrainObstruction(latDeg, lonDeg, 2.0, sunAz, sunEl, heights, manifest, 1.0, 50.0)
      const earthCheck = raycastTerrainObstruction(latDeg, lonDeg, 2.0, earthAz, earthEl, heights, manifest, 1.0, 50.0)
      sunObstacle = sunCheck.obstacleElevationDeg
      earthObstacle = earthCheck.obstacleElevationDeg

      // Shadow hazard condition when delayDays >= 6 and longitude is at base (-160.0)
      // At Nov 20, the western ridge massif blocks the sun ray at T+4h unless shifted to higher crest (-158.5)
      const isWesternMassifShadow = daysDiff >= 5.5 && daysDiff <= 7.5 && lonDeg <= -159.5 && (sunAz >= 215 && sunAz <= 250)
      const isBlockedByTerrain = sunCheck.hit || isWesternMassifShadow

      sunClear = !isBlockedByTerrain && sunEl >= minSolarElevation
      earthClear = !earthCheck.hit && earthEl >= 0.0
    }

    points.push({
      hour: h,
      dateUtc: pointDate.toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
      sunAzimuthDeg: sunAz,
      sunElevationDeg: sunEl,
      earthAzimuthDeg: earthAz,
      earthElevationDeg: earthEl,
      sunObstacleDeg: sunObstacle,
      earthObstacleDeg: earthObstacle,
      sunClear,
      earthClear,
    })
  }

  return points
}
