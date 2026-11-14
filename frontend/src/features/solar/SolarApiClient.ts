import type { LunarSite, MissionParameters, SolarResult } from '../mission/types'

export class ScientificApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

async function getJson<T>(path: string, signal: AbortSignal): Promise<T> {
  let response: Response
  try { response = await fetch(path, { signal, headers: { Accept: 'application/json' } }) }
  catch (error) {
    if (signal.aborted) throw error
    throw new ScientificApiError('The scientific API could not be reached. Check that the API service is running.', 503)
  }
  const body = await response.json().catch(() => null)
  if (!response.ok || !body || body.status === 'unavailable') {
    const detail = body?.detail
    const message = typeof detail === 'string' ? detail : typeof detail?.message === 'string' ? detail.message : body?.message
    throw new ScientificApiError(message || `The scientific service returned HTTP ${response.status}. No valid data are available.`, response.status)
  }
  return body as T
}

export async function fetchSites(signal: AbortSignal) {
  const response = await getJson<{ sites: LunarSite[] }>('/api/sites', signal)
  if (!Array.isArray(response.sites) || response.sites.some(s => !Number.isFinite(s.latitude_deg) || !Number.isFinite(s.longitude_deg))) {
    throw new ScientificApiError('The site catalog is missing valid coordinates.', 502)
  }
  return response.sites
}

export function solarQuery(siteId: string, mission: MissionParameters) {
  const shift = (value: string) => new Date(new Date(value).getTime() + mission.delayHours * 3600000).toISOString()
  return '/api/solar?' + new URLSearchParams({ site_id: siteId, start_utc: shift(mission.startUtc), end_utc: shift(mission.endUtc), step_minutes: String(mission.stepMinutes), horizon_mode: mission.horizonMode, observer_height_m: String(mission.observerHeightM) })
}

export async function fetchSolar(siteId: string, mission: MissionParameters, signal: AbortSignal, target: 'solar' | 'earth' = 'solar') {
  const data = await getJson<SolarResult>(solarQuery(siteId, mission).replace('/api/solar?', `/api/${target}?`) + (target === 'earth' ? '&canonical=true&include_range=true' : ''), signal)
  if (data.status !== 'ok' || !data.samples?.length || data.samples.some(s => !Number.isFinite(s.azimuth_deg) || !Number.isFinite(s.elevation_deg))) {
    throw new ScientificApiError('The API did not return a complete, validated ephemeris.', 502)
  }
  if (target === 'earth') {
    const summary = data.summary as unknown as { earth_visible_hours: number; earth_visible_fraction: number; longest_hidden_gap_hours: number }
    data.summary = { sun_visible_hours: summary.earth_visible_hours, sun_visible_fraction: summary.earth_visible_fraction, longest_dark_gap_hours: summary.longest_hidden_gap_hours }
  }
  return data
}
