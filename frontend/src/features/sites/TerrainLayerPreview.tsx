import { useEffect, useMemo, useRef, useState } from 'react'
import { Database, ExternalLink, Layers3, LoaderCircle, TriangleAlert } from 'lucide-react'
import type { LunarSite } from '../mission/types'

type Layer = 'elevations_m' | 'slope_degrees' | 'height_uncertainty_m'
type Raster = {
  site_id: string; width: number; height: number; source_url: string
  elevations_m: (number | null)[]; slope_degrees?: (number | null)[]; height_uncertainty_m?: (number | null)[]
  resolution_m: number; quality?: string; retrieved_at?: string; warnings?: string[]
  extent_m: { xmin: number; ymin: number; xmax: number; ymax: number }
}
const layers: { id: Layer; name: string; unit: string; explanation: string }[] = [
  { id: 'elevations_m', name: 'Elevation', unit: 'm', explanation: 'Surface elevation from the NASA LOLA regional elevation model. The reference pixel is shown at the center.' },
  { id: 'slope_degrees', name: 'Slope', unit: '°', explanation: 'Local surface slope from the NASA LOLA slope product. Slope alone does not establish landing suitability.' },
  { id: 'height_uncertainty_m', name: 'Height uncertainty', unit: 'm', explanation: 'Height uncertainty from the accompanying NASA LOLA total-error product. These values are not propagated into confidence bounds for the visibility windows.' },
]

export function TerrainLayerPreview({ site }: { site: LunarSite }) {
  const [raster, setRaster] = useState<Raster | null>(null)
  const [layer, setLayer] = useState<Layer>('elevations_m')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const canvas = useRef<HTMLCanvasElement>(null)
  const selected = layers.find(item => item.id === layer)!
  const values = raster?.[layer]
  const range = useMemo(() => {
    const finite = values?.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)) || []
    return finite.length ? { min: Math.min(...finite), max: Math.max(...finite), count: finite.length } : null
  }, [values])

  useEffect(() => {
    const controller = new AbortController()
    setRaster(null); setLoading(true); setError('')
    fetch(`/api/sites/${encodeURIComponent(site.id)}/terrain`, { signal: controller.signal })
      .then(async response => {
        const data = await response.json().catch(() => null)
        if (!response.ok || !data || !Number.isInteger(data.width) || !Number.isInteger(data.height) || data.width < 1 || data.height < 1 || !Array.isArray(data.elevations_m) || data.elevations_m.length !== data.width * data.height) {
          throw new Error(data?.message || 'No prepared NASA terrain raster is available for this study region.')
        }
        if (!controller.signal.aborted) setRaster(data)
      })
      .catch(reason => { if (!controller.signal.aborted) setError(reason.message || 'The NASA terrain preview could not be loaded.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [site.id])

  useEffect(() => {
    if (!canvas.current || !raster || !range || !values || values.length !== raster.width * raster.height) return
    const context = canvas.current.getContext('2d')
    if (!context) return
    const image = context.createImageData(raster.width, raster.height)
    const colors = layer === 'height_uncertainty_m' ? [[28, 37, 48], [211, 172, 105]] : layer === 'slope_degrees' ? [[27, 48, 58], [218, 193, 134]] : [[23, 45, 59], [203, 219, 193]]
    for (let index = 0; index < values.length; index++) {
      const value = values[index]
      if (typeof value !== 'number' || !Number.isFinite(value)) { image.data[index * 4 + 3] = 0; continue }
      const fraction = (value - range.min) / (range.max - range.min || 1)
      for (let channel = 0; channel < 3; channel++) image.data[index * 4 + channel] = colors[0][channel] + fraction * (colors[1][channel] - colors[0][channel])
      image.data[index * 4 + 3] = 255
    }
    context.putImageData(image, 0, 0)
  }, [raster, range, values, layer])

  const productKey = layer === 'elevations_m' ? 'elevation' : layer === 'slope_degrees' ? 'slope' : 'uncertainty'
  const products = site.products as Record<string, string> | undefined
  const source = products?.[productKey] || raster?.source_url || site.source_url
  return <section className="science-card science-terrain-preview" aria-label="NASA terrain layers"><div className="science-card-heading"><div><span className="science-eyebrow">NASA LOLA / THREE MEASURED TERRAIN LAYERS</span><h3>Read the surface.</h3></div><Layers3 size={19} /></div><div className="science-terrain-controls"><label>Display layer<select aria-label="NASA terrain display layer" value={layer} onChange={event => setLayer(event.target.value as Layer)}>{layers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><span>{site.name} / {site.id.toUpperCase()}</span></div>
    {loading ? <div className="science-loading" role="status"><LoaderCircle size={18} className="spinning" />Loading the NASA terrain derivative…</div> : error ? <div className="science-terrain-error" role="alert"><TriangleAlert size={17} /><p>{error} No replacement raster is generated.</p></div> : !range || !raster || !values || values.length !== raster.width * raster.height ? <div className="science-terrain-error" role="alert"><TriangleAlert size={17} /><p>This layer has not been prepared for the selected site. No measurements are inferred.</p></div> : <div className="science-terrain-content"><div className="science-terrain-visual"><div className="science-terrain-canvas"><canvas ref={canvas} width={raster.width} height={raster.height} role="img" aria-label={`NASA ${selected.name.toLowerCase()} raster for ${site.name}, ${raster.width} by ${raster.height} samples`} /><span className="science-terrain-observer" aria-hidden="true">+</span><span className="science-terrain-north">GRID NORTH ↑</span></div><div className={`science-terrain-legend ${layer}`}><span>{range.min.toFixed(layer === 'height_uncertainty_m' ? 3 : 1)} {selected.unit}</span><i /><span>{range.max.toFixed(layer === 'height_uncertainty_m' ? 3 : 1)} {selected.unit}</span></div></div><div className="science-terrain-info"><span className="science-eyebrow">{selected.name.toUpperCase()} / ACTUAL NASA SOURCE VALUES</span><p>{selected.explanation}</p><dl><div><dt>Display grid</dt><dd>{raster.width} × {raster.height} samples</dd></div><div><dt>Display sampling</dt><dd>~{raster.resolution_m.toFixed(0)} m / pixel</dd></div><div><dt>Local extent</dt><dd>{((raster.extent_m.xmax - raster.extent_m.xmin) / 1000).toFixed(1)} × {((raster.extent_m.ymax - raster.extent_m.ymin) / 1000).toFixed(1)} km</dd></div><div><dt>Valid display samples</dt><dd>{range.count} / {values.length}</dd></div></dl><p className="science-terrain-warning">Downsampled for display from a regional 5 m/pixel NASA product. Colors are scaled to this region’s displayed minimum and maximum. The preview does not replace the horizon calculation or certify landing safety.</p>{raster.warnings?.length ? <ul>{raster.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul> : null}<a href={source} target="_blank" rel="noreferrer"><Database size={12} />Open this NASA source layer<ExternalLink size={11} /></a></div></div>}
  </section>
}
