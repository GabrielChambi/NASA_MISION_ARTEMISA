export type HorizonMode = 'flat' | 'terrain'

export type QualityStatus =
  | 'verified_horizons_flat'
  | 'verified_horizons_terrain'
  | 'terrain_unavailable'
  | 'degraded'
  | 'cached_horizons_flat'
  | 'unavailable'

export interface VisibilityWindow {
  start_utc: string
  end_utc: string
  duration_hours: number
}

export interface EarthSample {
  t_utc: string
  azimuth_deg: number
  elevation_deg: number
  local_horizon_deg: number
  clearance_deg: number
  effective_threshold_deg: number
  earth_visible: boolean
  range_km: number
  range_rate_km_s: number
  enu_vector: [number, number, number]
  solar_elongation_note?: string | null
}

export interface HorizonProfilePoint {
  azimuth_deg: number
  horizon_elevation_deg: number
  enu_rim_vector: [number, number, number]
}

export interface TerrainMesh3D {
  grid_size: number
  spacing_m: number
  extent_m: number
  center_elevation_m: number
  min_elevation_m: number
  max_elevation_m: number
  elevation_grid_m: number[][]
  slope_grid_deg?: number[][] | null
  center_slope_deg?: number | null
  mean_slope_deg?: number | null
  uncertainty_grid_m?: number[][] | null
  center_uncertainty_m?: number | null
  median_uncertainty_m?: number | null
  frame: string
  provenance_url: string
}

export interface SiteMetadata {
  site_id: string
  name: string
  region: string
  lat_deg: number
  lon_east_deg: number
  elevation_m: number
  observer_height_m: number
  reference_frame: string
  provenance_source: string
  provenance_url: string
}

export interface EarthMetricsSummary {
  total_hours: number
  earth_visible_hours: number
  earth_visible_fraction: number
  longest_earth_blackout_hours: number
  longest_earth_visible_hours: number
  min_elevation_deg: number
  max_elevation_deg: number
  mean_elevation_deg: number
  mean_azimuth_deg: number
  mean_range_km: number
  expected_samples: number
  received_samples: number
  missing_samples: number
}

export interface EarthProvenance {
  source: string
  ephemeris_kernel: string
  target_body: string
  center_body: string
  visibility_definition: string
  interval_convention: string
  requested_horizon_mode: HorizonMode
  effective_horizon_mode: HorizonMode
  cache_hit: boolean
  retrieved_at_utc: string
  limitations: string[]
}

export interface EarthResponse {
  site: SiteMetadata
  query: Record<string, unknown>
  effective_start_utc: string
  effective_end_utc: string
  quality: QualityStatus
  warnings: string[]
  metrics: EarthMetricsSummary
  windows: VisibilityWindow[]
  blackout_windows: VisibilityWindow[]
  horizon_profile: HorizonProfilePoint[]
  samples: EarthSample[]
  terrain_mesh_3d?: TerrainMesh3D | null
  provenance: EarthProvenance
}

export interface EarthQueryParams {
  site_id: 'site01' | 'site04'
  start_utc: string
  end_utc: string
  step_minutes: number
  horizon_mode: HorizonMode
  clearance_deg: number
  delay_hours: number
  observer_height_m: number
}

export interface CombinedSamplePoint {
  t_utc: string
  earth_azimuth_deg: number | null
  earth_elevation_deg: number | null
  earth_visible: boolean | null
  earth_enu_vector: [number, number, number] | null
  sun_azimuth_deg: number | null
  sun_elevation_deg: number | null
  sun_visible: boolean | null
  sun_enu_vector: [number, number, number] | null
  joint_visible: boolean | null
}

export type ConstraintStatus = boolean | 'unknown'

export interface SiteComparisonSummary {
  site: SiteMetadata
  quality: QualityStatus
  solar_quality: string
  earth_quality: QualityStatus
  total_hours: number
  solar_visible_hours: number | null
  solar_visible_fraction: number | null
  longest_solar_dark_gap_hours: number | null
  earth_visible_hours: number | null
  earth_visible_fraction: number | null
  longest_earth_blackout_hours: number | null
  overlap_solar_earth_hours: number | null
  overlap_solar_earth_fraction: number | null
  meets_solar_constraint: ConstraintStatus
  meets_earth_constraint: ConstraintStatus
  meets_constraints: ConstraintStatus
  constraints_satisfied_count: number | null
  earth_windows: VisibilityWindow[]
  overlap_windows: VisibilityWindow[]
  samples: CombinedSamplePoint[]
  terrain_mesh_3d?: TerrainMesh3D | null
  explanation: string
}

export interface BaselineDeltaSummary {
  site_id: string
  baseline_earth_visible_hours: number | null
  delayed_earth_visible_hours: number | null
  delta_earth_visible_hours: number | null
  baseline_longest_blackout_hours: number | null
  delayed_longest_blackout_hours: number | null
  delta_longest_blackout_hours: number | null
  baseline_overlap_hours: number | null
  delayed_overlap_hours: number | null
  delta_overlap_hours: number | null
}

export interface CompareRequestParams {
  site_ids: ['site01', 'site04']
  start_utc: string
  end_utc: string
  step_minutes: number
  horizon_mode: HorizonMode
  clearance_deg: number
  delay_hours: number
  observer_height_m: number
  minimum_solar_hours: number
  minimum_earth_visible_hours: number
}

export interface CompareResponse {
  query: Record<string, unknown>
  base_start_utc: string
  base_end_utc: string
  effective_start_utc: string
  effective_end_utc: string
  delay_hours: number
  requested_horizon_mode: HorizonMode
  effective_horizon_mode: HorizonMode
  consolidated_quality: string
  preferred_site_id: string | null
  preference_label: string
  ranking_order: string[]
  ranking_rule: string
  decision_explanation: string
  warnings: string[]
  sites: SiteComparisonSummary[]
  delay_sensitivity: BaselineDeltaSummary[]
  provenance: Record<string, string>
}

export interface Earth3DSceneBundle {
  siteId: string
  siteName: string
  timestampUtc: string
  observerPositionM: [number, number, number]
  earthState: {
    azimuthDeg: number
    elevationDeg: number
    rangeKm: number
    visible: boolean
    enuUnitVector: [number, number, number]
  }
  sunState: {
    azimuthDeg: number | null
    elevationDeg: number | null
    visible: boolean | null
    enuUnitVector: [number, number, number] | null
  }
  trajectory3D: Array<{
    tUtc: string
    enuUnitVector: [number, number, number]
    visible: boolean
    elevationDeg: number
    azimuthDeg: number
  }>
  horizonRing3D: Array<{
    azimuthDeg: number
    elevationDeg: number
    enuRimVector: [number, number, number]
  }>
  terrainMesh3D: TerrainMesh3D | null
}

const API_BASE = ''

function formatApiError(status: number, body: unknown): string {
  if (typeof body === 'object' && body !== null && 'detail' in body) {
    const detail = (body as { detail: unknown }).detail
    if (typeof detail === 'string') return `API Error (${status}): ${detail}`
    if (Array.isArray(detail)) {
      const msgs = detail.map(item => {
        if (typeof item === 'object' && item !== null && 'msg' in item) {
          const loc = Array.isArray((item as { loc?: unknown[] }).loc)
            ? (item as { loc: unknown[] }).loc.join('.')
            : 'input'
          return `${loc}: ${String((item as { msg: unknown }).msg)}`
        }
        return JSON.stringify(item)
      })
      return `Validation Error (${status}): ${msgs.join('; ')}`
    }
  }
  return `Request failed with HTTP status ${status}`
}

export class EarthApiClient {
  private earthController: AbortController | null = null
  private compareController: AbortController | null = null

  public cancelPending(): void {
    this.earthController?.abort()
    this.compareController?.abort()
  }

  public async fetchEarthVisibility(params: EarthQueryParams): Promise<EarthResponse> {
    this.earthController?.abort()
    const controller = new AbortController()
    this.earthController = controller

    const res = await fetch(`${API_BASE}/api/earth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    })

    if (!res.ok) {
      let errBody: unknown = null
      try {
        errBody = await res.json()
      } catch {
        errBody = null
      }
      throw new Error(formatApiError(res.status, errBody))
    }

    return (await res.json()) as EarthResponse
  }

  public async fetchSiteComparison(params: CompareRequestParams): Promise<CompareResponse> {
    this.compareController?.abort()
    const controller = new AbortController()
    this.compareController = controller

    const res = await fetch(`${API_BASE}/api/compare`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(params),
      signal: controller.signal,
    })

    if (!res.ok) {
      let errBody: unknown = null
      try {
        errBody = await res.json()
      } catch {
        errBody = null
      }
      throw new Error(formatApiError(res.status, errBody))
    }

    return (await res.json()) as CompareResponse
  }
}

export const earthApiClient = new EarthApiClient()

export function buildEarth3DSceneBundle(
  earth: EarthResponse,
  compare: CompareResponse | null,
  sampleIndex: number
): Earth3DSceneBundle {
  const safeIndex = Math.max(0, Math.min(earth.samples.length - 1, sampleIndex))
  const sample = earth.samples[safeIndex] ?? {
    t_utc: earth.effective_start_utc,
    azimuth_deg: 150,
    elevation_deg: 0,
    earth_visible: false,
    range_km: 384400,
    enu_vector: [0.5, -0.866, 0] as [number, number, number],
  }

  const compareSite = compare?.sites.find(s => s.site.site_id === earth.site.site_id)
  const combinedSample = compareSite?.samples.find(s => s.t_utc === sample.t_utc)

  return {
    siteId: earth.site.site_id,
    siteName: earth.site.name,
    timestampUtc: sample.t_utc,
    observerPositionM: [0, 0, earth.site.observer_height_m],
    earthState: {
      azimuthDeg: sample.azimuth_deg,
      elevationDeg: sample.elevation_deg,
      rangeKm: sample.range_km,
      visible: sample.earth_visible,
      enuUnitVector: sample.enu_vector,
    },
    sunState: {
      azimuthDeg: combinedSample?.sun_azimuth_deg ?? null,
      elevationDeg: combinedSample?.sun_elevation_deg ?? null,
      visible: combinedSample?.sun_visible ?? null,
      enuUnitVector: combinedSample?.sun_enu_vector ?? null,
    },
    trajectory3D: earth.samples.map(s => ({
      tUtc: s.t_utc,
      enuUnitVector: s.enu_vector,
      visible: s.earth_visible,
      elevationDeg: s.elevation_deg,
      azimuthDeg: s.azimuth_deg,
    })),
    horizonRing3D: earth.horizon_profile.map(h => ({
      azimuthDeg: h.azimuth_deg,
      elevationDeg: h.horizon_elevation_deg,
      enuRimVector: h.enu_rim_vector,
    })),
    terrainMesh3D: earth.terrain_mesh_3d ?? null,
  }
}
