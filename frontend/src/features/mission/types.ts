export type HorizonMode = 'flat' | 'terrain'
export type WorkspaceView = 'explorer' | 'solar' | 'earth' | 'compare' | 'evidence'

export type LunarSite = {
  id: string
  name: string
  latitude_deg: number
  longitude_deg: number
  elevation_m?: number
  slope_deg?: number
  height_uncertainty_m?: number
  dem_resolution_m?: number
  reference_frame?: string
  dem_coverage: string
  coordinate_quality?: string
  source_url: string
  products?: unknown
}

export type SolarSample = {
  t_utc: string
  azimuth_deg: number
  elevation_deg: number
  horizon_deg: number
  visible: boolean
}

export type SolarResult = {
  status: string
  meta: {
    source: string
    source_url: string
    query_url?: string
    retrieved_at: string
    cache_hit?: boolean
    horizon_mode: string
    observer_height_m: number
    step_minutes: number
    limitations: string[]
    [key: string]: unknown
  }
  samples: SolarSample[]
  windows: { start_utc: string; end_utc: string; duration_hours: number }[]
  summary: {
    sun_visible_hours: number
    sun_visible_fraction: number
    longest_dark_gap_hours: number
  }
}

export type MissionParameters = {
  siteIds: string[]
  startUtc: string
  endUtc: string
  stepMinutes: number
  horizonMode: HorizonMode
  delayHours: number
  observerHeightM: number
}
