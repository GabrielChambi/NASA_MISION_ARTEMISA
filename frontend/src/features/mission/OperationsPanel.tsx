import { useEffect, useState } from 'react'
import type { AutomaticPlan, MissionPoint, VehicleProfile } from './automaticTypes'

type Props = { plan: AutomaticPlan | null; site: MissionPoint | null; vehicleProfile?: VehicleProfile; onAskCopilot?: (question: string) => void; autofillText?: string }

const input = { width: '100%', boxSizing: 'border-box' as const }

export default function OperationsPanel({ plan, site, vehicleProfile, onAskCopilot, autofillText }: Props) {
  const [vehicle, setVehicle] = useState({ vehicle_id: vehicleProfile?.lander_name ?? '', battery_capacity_wh: '', initial_battery_wh: '', minimum_battery_wh: '', memory_capacity_mb: '', initial_memory_mb: '', base_load_w: '', panel_area_m2: '', panel_efficiency: '', panel_azimuth_deg: '', panel_elevation_deg: '' })
  const [activities, setActivities] = useState('')
  const [observation, setObservation] = useState('')
  const [validation, setValidation] = useState('')
  const [result, setResult] = useState<unknown>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const setField = (key: keyof typeof vehicle, value: string) => setVehicle(current => ({ ...current, [key]: value }))
  useEffect(() => {
    if (!autofillText) return
    const text = autofillText
    const find = (patterns: RegExp[]) => {
      for (const pattern of patterns) {
        const match = text.match(pattern)
        if (match) return match[1]
      }
      return null
    }
    const value = (patterns: RegExp[], multiplier = 1) => {
      const found = find(patterns)
      const number = found === null ? NaN : Number(found)
      return Number.isFinite(number) ? String(number * multiplier) : null
    }
    const patch: Partial<typeof vehicle> = {}
    const fields: [keyof typeof vehicle, RegExp[], number?][] = [
      ['battery_capacity_wh', [/(?:capacidad|total)\s+(?:de\s+)?bater[ií]a[^\d]{0,40}(\d+(?:\.\d+)?)\s*kwh/i], 1000],
      ['battery_capacity_wh', [/(?:capacidad|total)\s+(?:de\s+)?bater[ií]a[^\d]{0,40}(\d+(?:\.\d+)?)\s*wh/i]],
      ['initial_battery_wh', [/(?:bater[ií]a|soc)\s+(?:inicial|disponible)[^\d]{0,30}(\d+(?:\.\d+)?)\s*wh/i]],
      ['minimum_battery_wh', [/(?:reserva|m[ií]nimo)\s+(?:de\s+)?bater[ií]a[^\d]{0,30}(\d+(?:\.\d+)?)\s*wh/i]],
      ['memory_capacity_mb', [/(?:memoria|almacenamiento)\s+(?:total|capacidad)[^\d]{0,30}(\d+(?:\.\d+)?)\s*gb/i], 1024],
      ['memory_capacity_mb', [/(?:memoria|almacenamiento)\s+(?:total|capacidad)[^\d]{0,30}(\d+(?:\.\d+)?)\s*mb/i]],
      ['base_load_w', [/(?:consumo|carga)\s+base[^\d]{0,30}(\d+(?:\.\d+)?)\s*w/i]],
      ['panel_area_m2', [/(?:[áa]rea)\s+(?:de\s+)?panel(?:es)?[^\d]{0,30}(\d+(?:\.\d+)?)\s*m2/i]],
      ['panel_efficiency', [/(?:eficiencia)\s+(?:del\s+)?panel[^\d]{0,30}(\d+(?:\.\d+)?)\s*%/i], 0.01],
      ['panel_azimuth_deg', [/(?:azimut|azimuth)\s+(?:del\s+)?panel[^\d]{0,30}(\d+(?:\.\d+)?)/i]],
      ['panel_elevation_deg', [/(?:elevaci[oó]n)\s+(?:del\s+)?panel[^\d]{0,30}(\d+(?:\.\d+)?)/i]],
    ]
    for (const [key, patterns, multiplier] of fields) {
      const parsed = value(patterns, multiplier)
      if (parsed !== null) patch[key] = parsed
    }
    const jsonStart = autofillText.indexOf('[{')
    if (jsonStart >= 0) {
      try {
        const parsed = JSON.parse(autofillText.slice(jsonStart))
        if (Array.isArray(parsed)) setActivities(JSON.stringify(parsed, null, 2))
      } catch {
        // Natural-language extraction remains useful even when an activity JSON is incomplete.
      }
    }
    if (Object.keys(patch).length) setVehicle(current => ({ ...current, ...patch }))
  }, [autofillText])
  const numeric = (key: keyof typeof vehicle) => Number(vehicle[key])
  const request = () => ({
    site_id: site?.id,
    start_utc: plan?.mission.arrival_utc,
    end_utc: plan?.mission.surface_end_utc,
    step_minutes: 60,
    horizon_mode: 'terrain',
    observer_height_m: 2,
    vehicle: {
      vehicle_id: vehicle.vehicle_id,
      battery_capacity_wh: numeric('battery_capacity_wh'),
      initial_battery_wh: numeric('initial_battery_wh'),
      minimum_battery_wh: numeric('minimum_battery_wh'),
      memory_capacity_mb: numeric('memory_capacity_mb'),
      initial_memory_mb: numeric('initial_memory_mb'),
      base_load_w: numeric('base_load_w'),
      panel_area_m2: numeric('panel_area_m2'),
      panel_efficiency: numeric('panel_efficiency'),
      panel_azimuth_deg: numeric('panel_azimuth_deg'),
      panel_elevation_deg: numeric('panel_elevation_deg'),
    },
    activities: JSON.parse(activities),
  })
  async function post(path: string, body: unknown) {
    setBusy(path); setError(''); setResult(null)
    try {
      const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail ?? data.message ?? 'La API rechazó los datos.')
      setResult(data)
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo completar la operación.') }
    finally { setBusy('') }
  }
  async function submitObservation() { try { await post('/api/operations/observations', JSON.parse(observation)) } catch (e) { setError(e instanceof Error ? e.message : 'JSON de observación inválido.') } }
  async function submitValidation() { try { await post('/api/operations/validate', JSON.parse(validation)) } catch (e) { setError(e instanceof Error ? e.message : 'JSON de validación inválido.') } }
  const fields: [keyof typeof vehicle, string][] = [
    ['vehicle_id', 'ID del vehículo'], ['battery_capacity_wh', 'Capacidad batería (Wh)'], ['initial_battery_wh', 'Batería inicial (Wh)'],
    ['minimum_battery_wh', 'Reserva mínima (Wh)'], ['memory_capacity_mb', 'Memoria total (MB)'], ['initial_memory_mb', 'Memoria inicial (MB)'],
    ['base_load_w', 'Consumo base (W)'], ['panel_area_m2', 'Área paneles (m²)'], ['panel_efficiency', 'Eficiencia panel (0–1)'],
    ['panel_azimuth_deg', 'Azimut panel (°)'], ['panel_elevation_deg', 'Elevación panel (°)'],
  ]
  return <section className="operations-panel" aria-label="Operaciones científicas">
    <div className="operations-panel-heading"><strong>4–6 · Operaciones científicas</strong><span>Datos verificables</span></div>
    {!plan || !site ? <p className="field-help">Calcula primero una misión y selecciona un sector. Los datos del vehículo y las actividades deben proceder de una ficha o medición verificable; no se rellenan automáticamente.</p> : <>
      <div className="operations-context"><span>SECTOR</span><strong>{site.id}</strong><span>INTERVALO</span><strong>{plan.mission.arrival_utc} → {plan.mission.surface_end_utc}</strong></div>
      <p className="field-help">El sector, las fechas y las series NASA ya están vinculados. El chat puede indicar qué datos operativos faltan; no puede inventar consumos ni capacidades.</p>
      {onAskCopilot && <button className="operations-assistant-link" onClick={() => onAskCopilot('Revisa el módulo de operaciones de esta misión y dime qué datos medidos faltan para calcular energía, memoria y validación independiente.')}>Consultar al copiloto sobre datos faltantes</button>}
      <details><summary>4 · Planificar actividades con energía y memoria</summary>
        <div className="operations-fields">
          {fields.map(([key, label]) => <label key={key} className="operations-field">{label}<input style={input} value={vehicle[key]} onChange={e => setField(key, e.target.value)} inputMode={key === 'vehicle_id' ? 'text' : 'decimal'} /></label>)}
        </div>
        <label className="operations-field">Actividades JSON (intervalos y consumos medidos)<textarea className="operations-textarea" value={activities} onChange={e => setActivities(e.target.value)} placeholder='[{"activity_id":"...","kind":"measurement","start_utc":"...","end_utc":"...","power_w":0,"memory_rate_mb_per_hour":0}]' /></label>
        <button className="wide quiet operations-submit" disabled={Boolean(busy) || !activities} onClick={() => { try { void post('/api/operations/plan', request()) } catch (e) { setError(e instanceof Error ? e.message : 'Datos inválidos.') } }}>{busy === '/api/operations/plan' ? 'CALCULANDO…' : 'Calcular plan operativo'}</button>
      </details>
      <details><summary>5 · Importar observación del vehículo</summary>
        <p className="field-help">La observación debe incluir `vehicle_id`, `timestamp_utc`, `source` y al menos una medición. Si coincide con un plan guardado, se calculan residuales.</p>
        <textarea className="operations-textarea" value={observation} onChange={e => setObservation(e.target.value)} placeholder='{"vehicle_id":"...","timestamp_utc":"...Z","source":"...","battery_wh":0}' />
        <button className="wide quiet operations-submit" disabled={Boolean(busy) || !observation} onClick={() => void submitObservation()}>Actualizar estado observado</button>
      </details>
      <details><summary>6 · Validar contra otra herramienta</summary>
        <p className="field-help">Referencia recomendada: <a href="https://wgc2.jpl.nasa.gov:8443/webgeocalc/" target="_blank" rel="noreferrer">NAIF WebGeocalc 2 ↗</a>, geometría SPICE independiente. Exporta sus muestras y pégalas aquí; no se aceptan datos inventados ni interpolados.</p>
        <textarea className="operations-textarea" value={validation} onChange={e => setValidation(e.target.value)} placeholder='{"metric":"...","unit":"...","model":[{"t_utc":"...","value":0}],"reference":[{"t_utc":"...","value":0}],"model_source":"Lunar Oracle","reference_source":"NAIF WebGeocalc 2"}' />
        <button className="wide quiet operations-submit" disabled={Boolean(busy) || !validation} onClick={() => void submitValidation()}>Comparar resultados</button>
      </details>
      {error && <p className="science-error" role="alert">{error}</p>}
      {result && <details open><summary>Resultado trazable</summary><pre className="operations-result">{JSON.stringify(result, null, 2)}</pre></details>}
    </>}
  </section>
}
