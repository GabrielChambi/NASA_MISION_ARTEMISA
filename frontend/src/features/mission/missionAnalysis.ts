import type { LunarSite, SolarResult } from './types'
export type Study = { site: LunarSite; solar: SolarResult; earth: SolarResult }
export type Requirements = { minimumSunHours: number; minimumEarthHours: number; maxSlopeDeg: number; earthClearanceDeg: number }
export type Window = { startUtc: string; endUtc: string; hours: number }
export type StudyMetrics = {
  sunHours: number; earthHours: number; jointHours: number; longestDarkHours: number; longestEarthGapHours: number
  sunWindows: Window[]; earthWindows: Window[]; jointWindows: Window[]; meetsRequirements: boolean; reasons: string[]
}
function windows(times: string[], visible: boolean[]): Window[] {
  const result: Window[] = []; let start = -1
  for (let i = 0; i < times.length - 1; i++) {
    if (visible[i] && start < 0) start = i
    if (start >= 0 && (!visible[i] || i === times.length - 2)) {
      const end = visible[i] ? i + 1 : i
      result.push({ startUtc: times[start], endUtc: times[end], hours: (Date.parse(times[end]) - Date.parse(times[start])) / 3600000 }); start = -1
    }
  }
  return result
}
const hours = (w: Window[]) => w.reduce((n, value) => n + value.hours, 0)
const longest = (w: Window[]) => Math.max(0, ...w.map(v => v.hours))
export function analyzeStudy(study: Study, rules: Requirements): StudyMetrics {
  const { solar, earth, site } = study
  if (solar.samples.length < 2 || solar.samples.length !== earth.samples.length) throw new Error('Las series del Sol y la Tierra no cubren el mismo intervalo.')
  const times = solar.samples.map(s => s.t_utc)
  times.forEach((t, i) => {
    if (!Number.isFinite(Date.parse(t)) || t !== earth.samples[i].t_utc || (i && Date.parse(t) <= Date.parse(times[i - 1]))) throw new Error('Las muestras NASA no están alineadas en UTC.')
  })
  if (Object.values(rules).some(v => !Number.isFinite(v) || v < 0)) throw new Error('Las restricciones deben ser números positivos.')
  if ([...solar.samples, ...earth.samples].some(s => !Number.isFinite(s.elevation_deg) || !Number.isFinite(s.horizon_deg) || !Number.isFinite(s.azimuth_deg))) throw new Error('Efemérides u horizonte sin valores finitos; no es posible calcular visibilidad.')
  const sun = solar.samples.map(s => s.elevation_deg > s.horizon_deg)
  const home = earth.samples.map(s => s.elevation_deg - s.horizon_deg > rules.earthClearanceDeg)
  const sunWindows = windows(times, sun), earthWindows = windows(times, home)
  const jointWindows = windows(times, sun.map((v, i) => v && home[i]))
  const sunHours = hours(sunWindows), earthHours = hours(earthWindows), reasons: string[] = []
  if (sunHours < rules.minimumSunHours) reasons.push('Luz: ' + sunHours.toFixed(1) + ' h de ' + rules.minimumSunHours + ' h requeridas')
  if (earthHours < rules.minimumEarthHours) reasons.push('Tierra: ' + earthHours.toFixed(1) + ' h de ' + rules.minimumEarthHours + ' h requeridas')
  if (site.slope_deg === undefined) reasons.push('Pendiente del punto sin datos')
  else if (site.slope_deg > rules.maxSlopeDeg) reasons.push('Pendiente: ' + site.slope_deg.toFixed(1) + '° supera ' + rules.maxSlopeDeg + '°')
  return { sunHours, earthHours, jointHours: hours(jointWindows), longestDarkHours: longest(windows(times, sun.map(v => !v))), longestEarthGapHours: longest(windows(times, home.map(v => !v))), sunWindows, earthWindows, jointWindows, meetsRequirements: !reasons.length, reasons }
}
export function rankStudies(studies: Study[], rules: Requirements) {
  return studies.map(study => ({ ...study, metrics: analyzeStudy(study, rules) })).sort((a, b) => Number(b.metrics.meetsRequirements) - Number(a.metrics.meetsRequirements) || b.metrics.jointHours - a.metrics.jointHours || b.metrics.sunHours - a.metrics.sunHours || b.metrics.earthHours - a.metrics.earthHours)
}
export function utcLabel(value: string) { return value.replace('T', ' ').replace(/\.000Z$|Z$/, ' UTC') }
