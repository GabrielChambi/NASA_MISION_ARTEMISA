// Same observable contract as api/app. Pure calculations are parity-tested.
const JPL = 'https://ssd.jpl.nasa.gov/api/horizons.api'
export class ScienceError extends Error { constructor(message, status = 422) { super(message); this.status = status } }
const iso = value => new Date(value).toISOString().replace('.000Z', 'Z')

export function validateQuery(url, catalog) {
  const p = url.searchParams
  const siteId = p.get('site_id') || 'site04'
  const startText = p.get('start_utc') || '2026-12-01T00:00:00Z'
  const endText = p.get('end_utc') || '2026-12-08T00:00:00Z'
  const isUTC = text => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::00(?:\.0+)?)?(?:Z|\+00:00)$/.test(text)
  if (!isUTC(startText) || !isUTC(endText)) throw new ScienceError('Explicit whole-minute UTC is required (Z or +00:00).')
  const start = Date.parse(startText), end = Date.parse(endText)
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new ScienceError('Invalid UTC date.')
  const canonical = text => text.slice(0, 16)
  if (iso(start).slice(0, 16) !== canonical(startText) || iso(end).slice(0, 16) !== canonical(endText)) throw new ScienceError('Invalid calendar date.')
  const step = Number(p.get('step_minutes') || 60), height = Number(p.get('observer_height_m') ?? 1)
  const mode = p.get('horizon_mode') || 'flat', duration = end - start
  if (new Date(start).getUTCFullYear() < 1962 || new Date(end).getUTCFullYear() > 2100) throw new ScienceError('Supported UTC years are 1962–2100; Horizons uses UT1 before 1962.')
  if (duration < 3600000 || duration > 31 * 86400000) throw new ScienceError('Interval must be between 1 hour and 31 days.')
  if (!Number.isInteger(step) || step < 5 || step > 1440 || duration % (step * 60000) || duration / (step * 60000) > 1500) throw new ScienceError('Use 5–1440 minutes, an exact interval divisor, at most 1500 intervals.')
  if (!Number.isFinite(height) || height < 0 || height > 100) throw new ScienceError('Observer height must be between 0 and 100 meters.')
  if (!['flat', 'terrain'].includes(mode)) throw new ScienceError('horizon_mode must be flat or terrain.')
  const site = catalog.sites.find(s => s.id === siteId)
  if (!site) throw new ScienceError('Unknown site_id. Use site01 or site04.')
  return { site, start, end, step, height, mode, target: url.pathname === '/api/earth' ? 399 : 10 }
}

export function queryParameters(q) {
  const values = { COMMAND: String(q.target), MAKE_EPHEM: 'YES', OBJ_DATA: 'NO', EPHEM_TYPE: 'OBSERVER', CENTER: 'coord@301', COORD_TYPE: 'GEODETIC', SITE_COORD: `${q.site.longitude_deg},${q.site.latitude_deg},${((q.site.elevation_m + q.height) / 1000).toFixed(9)}`, START_TIME: iso(q.start).slice(0, 19).replace('T', ' '), STOP_TIME: iso(q.end).slice(0, 19).replace('T', ' '), STEP_SIZE: `${q.step} m`, QUANTITIES: '4', TIME_TYPE: 'UT', TIME_DIGITS: 'SECONDS', CSV_FORMAT: 'YES', ANG_FORMAT: 'DEG', APPARENT: 'AIRLESS', CAL_TYPE: 'GREGORIAN' }
  return { format: 'json', ...Object.fromEntries(Object.entries(values).map(([k, v]) => [k, `'${v}'`])) }
}

export function parseHorizons(text, q) {
  const required = ['$$SOE', '$$EOE', 'Center body name: Moon (301)', 'Center pole/equ : MEAN_ME', 'Center geodetic', 'Azi_(a-app)', 'Elev_(a-app)', q.target === 10 ? 'Sun (10)' : 'Earth (399)']
  if (typeof text !== 'string' || required.some(v => !text.includes(v))) throw new ScienceError('JPL returned an unexpected observer, target or incomplete table.', 503)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const samples = text.split('$$SOE')[1].split('$$EOE')[0].trim().split('\n').filter(s => s.trim()).map(line => {
    const row = line.split(',').map(v => v.trim())
    const date = row[0].match(/^(\d{4})-([A-Z][a-z]{2})-(\d{2}) (\d{2}:\d{2}:\d{2})$/)
    if (!date || !row[3] || !row[4]) throw new ScienceError('Malformed JPL ephemeris sample.', 503)
    const month = months.indexOf(date[2]) + 1
    const t = `${date[1]}-${String(month).padStart(2, '0')}-${date[3]}T${date[4]}Z`
    const az = Number(row[3]), el = Number(row[4])
    if (!month || !Number.isFinite(az) || az < 0 || az > 360 || !Number.isFinite(el) || el < -90 || el > 90 || !Number.isFinite(Date.parse(t))) throw new ScienceError('Invalid JPL time or angular value.', 503)
    return { t_utc: t, azimuth_deg: az % 360, elevation_deg: el }
  })
  if (samples.length !== (q.end - q.start) / (q.step * 60000) + 1 || samples.some((s, i) => s.t_utc !== iso(q.start + i * q.step * 60000))) throw new ScienceError('JPL timestamps do not match the complete requested UTC grid.', 503)
  return samples
}

export function circularInterpolate(samples, azimuth) {
  if (!samples.length || samples.some(s => !Number.isFinite(s.elevation_deg))) throw new ScienceError('Invalid or missing terrain profile.')
  const pos = ((azimuth % 360 + 360) % 360) * samples.length / 360, lower = Math.floor(pos), fraction = pos - lower
  return samples[lower % samples.length].elevation_deg * (1 - fraction) + samples[(lower + 1) % samples.length].elevation_deg * fraction
}

export function visibilityMetrics(samples, endUtc, target = 10) {
  if (samples.length < 2 || samples.at(-1).t_utc !== endUtc || samples.some((s, i) => i && Date.parse(s.t_utc) <= Date.parse(samples[i-1].t_utc))) throw new ScienceError('A complete chronological grid including the endpoint is required.')
  let visible = 0, darkness = 0, longest = 0, open = null
  const windows = []
  const close = end => { if (open !== null) { windows.push({ start_utc: open, end_utc: end, duration_hours: (Date.parse(end) - Date.parse(open)) / 3600000 }); open = null } }
  for (let i = 0; i < samples.length - 1; i++) {
    const row = samples[i], duration = (Date.parse(samples[i + 1].t_utc) - Date.parse(row.t_utc)) / 3600000
    if (row.visible) { visible += duration; darkness = 0; open ??= row.t_utc } else { close(row.t_utc); darkness += duration; longest = Math.max(longest, darkness) }
  }
  close(endUtc)
  const total = (Date.parse(endUtc) - Date.parse(samples[0].t_utc)) / 3600000
  const body = target === 10 ? 'sun' : 'earth'
  return { windows, summary: { [`${body}_visible_hours`]: Number(visible.toFixed(6)), [`${body}_visible_fraction`]: total ? Number((visible / total).toFixed(8)) : 0, [target === 10 ? 'longest_dark_gap_hours' : 'longest_hidden_gap_hours']: Number(longest.toFixed(6)), duration_hours:total, window_count:windows.length } }
}

async function boundedJSON(response) {
  if (!response.ok) throw new ScienceError('Scientific data unavailable: JPL request failed.', 503)
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let count = 0, result = ''
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; count += chunk.value.length; if (count > 1000000) { await reader.cancel(); throw new ScienceError('JPL response exceeded the bounded request limit.', 503) } result += decoder.decode(chunk.value, { stream: true }) }
    result += decoder.decode()
    return JSON.parse(result)
  } catch (error) { if (error instanceof ScienceError) throw error; throw new ScienceError('JPL returned invalid JSON.', 503) }
}

export function createScienceApi(resources) {
  return async function science(request, ctx) {
    const url = new URL(request.url), p = url.searchParams
    const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': status === 200 ? 'private, max-age=60' : 'no-store' } })
    try {
      if (request.method !== 'GET') return json({ status: 'unavailable', message: 'GET only.' }, 405)
      if (url.pathname === '/api/health') return json({ status: 'ok', service: 'Lunar Oracle scientific API · edge adapter', catalog_prepared: true, terrain_prepared: Boolean(resources.horizon?.profiles), horizons_connection: 'checked per query' })
      if (url.pathname === '/api/sites') return json(resources.sites)
      if (url.pathname === '/api/datasets') return json(resources.datasets)
      if (url.pathname === '/api/methodology') return json(resources.methodology)
      const terrainSite = url.pathname.match(/^\/api\/sites\/(site01|site04)\/terrain$/)?.[1]
      if (terrainSite) return resources.terrain[terrainSite] ? json(resources.terrain[terrainSite]) : json({ status: 'unavailable', message: 'NASA terrain data unavailable.' }, 503)
      if (url.pathname === '/api/terrain') {
        const sid = p.get('site_id') || 'site04'
        if (!resources.sites.sites.some(site => site.id === sid)) return json({ status: 'unavailable', message: 'Unknown site.' }, 404)
        return resources.terrain[sid] ? json(resources.terrain[sid]) : json({ status: 'unavailable', message: 'NASA terrain data unavailable.' }, 503)
      }
      if (url.pathname === '/api/horizon') {
        const sid = p.get('site_id') || 'site04', height = p.get('observer_height_m') || '1'
        const profile = resources.horizon?.profiles?.[sid]?.[height]
        if (!profile) throw new ScienceError('No prepared terrain profile for this site/height.')
        return json({ status: 'ok', site_id: sid, ...profile })
      }
      if (!['/api/solar', '/api/earth'].includes(url.pathname)) return json({ status: 'unavailable', message: 'Unknown API route.' }, 404)
      const q = validateQuery(url, resources.sites)
      const profile = q.mode === 'terrain' ? resources.horizon?.profiles?.[q.site.id]?.[String(q.height)] : null
      if (q.mode === 'terrain' && !profile) throw new ScienceError('Prepared terrain profiles support observer heights of 1, 2 or 5 m only.')
      const params = queryParameters(q)
      const queryUrl = `${JPL}?${new URLSearchParams(params)}`
      let record = resources.ephemeris.find(item => Object.keys(params).every(key => item.params?.[key] === params[key]))
      let cacheHit = Boolean(record)
      const cache = globalThis.caches?.default
      const cacheKey = new Request(queryUrl)
      if (!record && cache) { const cached = await cache.match(cacheKey); if (cached) { record = await cached.json(); cacheHit = true } }
      if (!record) {
        try {
          const response = await fetch(queryUrl, { signal: AbortSignal.timeout(45000) })
          const payload = await boundedJSON(response)
          if (!payload || typeof payload !== 'object' || typeof payload.result !== 'string') throw new ScienceError('JPL returned an invalid ephemeris document.', 503)
          if (payload.error) throw new ScienceError('JPL rejected the observer query.', 503)
          parseHorizons(payload.result, q)
          record = { params, query_url: queryUrl, retrieved_at: new Date().toISOString(), response: payload, source: 'JPL Horizons' }
          if (cache && ctx) ctx.waitUntil(cache.put(cacheKey, Response.json(record, { headers: { 'Cache-Control': 'public, max-age=86400' } })))
        } catch (error) { if (error instanceof ScienceError) throw error; throw new ScienceError('Scientific data unavailable: JPL Horizons could not be reached. No fabricated fallback is used.', 503) }
      }
      const rows = parseHorizons(record.response.result, q)
      const samples = rows.map(row => { const horizon = profile ? circularInterpolate(profile.samples, row.azimuth_deg) : 0; return { ...row, horizon_deg: Math.round(horizon * 1e6) / 1e6, visible: row.elevation_deg > horizon } })
      const metrics = visibilityMetrics(samples, iso(q.end), q.target)
      return json({ status: 'ok', site_id: q.site.id, target: q.target === 10 ? 'Sun' : 'Earth', meta: { source: 'JPL Horizons', source_url: 'https://ssd-api.jpl.nasa.gov/doc/horizons.html', query_url: record.query_url, retrieved_at: record.retrieved_at, cache_hit: cacheHit, start_utc: iso(q.start), end_utc: iso(q.end), step_minutes: q.step, horizon_mode: q.mode, horizon_quality: profile?.quality || 'approximation', observer_height_m: q.height, observer_altitude_km: (q.site.elevation_m + q.height) / 1000, latitude_deg: q.site.latitude_deg, longitude_deg: q.site.longitude_deg, reference_frame: 'Horizons MEAN_ME lunar observer; NASA LOLA MOON_ME/DE421', window_convention: '[start,end), left sample, strict elevation > horizon', limitations: [...(profile?.warnings || ['Flat horizon approximation: terrain obstruction and horizon dip are excluded.']), 'Geometric visibility proxy; no electrical energy or RF link guarantee.', 'Half-open windows use left samples; transition uncertainty is up to one sample step.', 'The observer is a regional DEM reference pixel, not a NASA-approved landing location.', 'Independent SPICE frame validation is pending.'] }, samples, ...metrics })
    } catch (error) { console.error(JSON.stringify({ event: 'science_request_failed', path: url.pathname, message: error instanceof Error ? error.message : 'Unknown failure' })); return json({ status: 'unavailable', message: error instanceof Error ? error.message : 'Scientific service unavailable.', samples: [], windows: [], summary: null }, error instanceof ScienceError ? error.status : 503) }
  }
}
