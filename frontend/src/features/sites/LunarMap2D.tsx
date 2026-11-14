import type { LunarSite } from '../mission/types'

export function LunarMap2D({ sites, selectedId, onSelect }: { sites: LunarSite[]; selectedId: string; onSelect: (id: string) => void }) {
  const project = (site: LunarSite) => {
    // South polar stereographic display, Moon spherical approximation. This is a coordinate graticule, not a DEM image.
    const rho = Math.tan((90 + site.latitude_deg) * Math.PI / 360) / Math.tan(Math.PI / 360) * 174
    const longitude = site.longitude_deg * Math.PI / 180
    return { x: 220 + rho * Math.sin(longitude), y: 220 - rho * Math.cos(longitude) }
  }
  return <div className="science-polar-map"><svg viewBox="0 0 440 440" aria-label="South polar coordinate map, showing NASA study regions" role="img">
    <defs><radialGradient id="polarGlow"><stop offset="0" stopColor="#2b4349" /><stop offset="1" stopColor="#101e29" /></radialGradient><clipPath id="polarClip"><circle cx="220" cy="220" r="174" /></clipPath></defs>
    <circle cx="220" cy="220" r="190" fill="#bed9bb03" stroke="#bed9bb12" />
    <circle cx="220" cy="220" r="174" fill="url(#polarGlow)" stroke="#c1d5d346" />
    {[0.25, 0.5, 0.75, 1].map(deg => <g key={deg}><circle cx="220" cy="220" r={Math.tan(deg * Math.PI / 360) / Math.tan(Math.PI / 360) * 174} fill="none" stroke="#a1bdc22b" strokeDasharray="2 5" /><text x="225" y={220 + deg * 174 - 5} fill="#a0b9bd" fontSize="8">{90 - deg}°S</text></g>)}
    {Array.from({ length: 8 }, (_, i) => i * 45).map(deg => <g key={deg}><line x1="220" y1="220" x2={220 + 174 * Math.sin(deg * Math.PI / 180)} y2={220 - 174 * Math.cos(deg * Math.PI / 180)} stroke="#a1bdc21c" /><text textAnchor="middle" x={220 + 199 * Math.sin(deg * Math.PI / 180)} y={223 - 199 * Math.cos(deg * Math.PI / 180)} fill="#9ab1ba" fontSize="9">{deg}°E</text></g>)}
    <path d="M214 220h12m-6-6v12" stroke="#c9d9d1" /><text x="220" y="208" textAnchor="middle" fill="#a9bebd" fontSize="7">SOUTH POLE</text>
    <g clipPath="url(#polarClip)">{sites.map((site, index) => {
      const position = project(site)
      const selected = site.id === selectedId
      return <g key={site.id} className={`science-map-marker ${selected ? 'selected' : ''}`} role="button" tabIndex={0} aria-label={`Select ${site.name}`} aria-pressed={selected} onClick={() => onSelect(site.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(site.id) } }}>
        <title>{site.name}: {site.latitude_deg.toFixed(5)}°, {site.longitude_deg.toFixed(5)}°E</title><circle cx={position.x} cy={position.y} r="20" fill="transparent" /><circle cx={position.x} cy={position.y} r={selected ? 12 : 9} fill={selected ? '#bfd9bb19' : '#b8b28d0e'} stroke={selected ? '#bed9bb8c' : '#c1b88d50'} /><circle cx={position.x} cy={position.y} r="3" fill={selected ? '#bed9bb' : '#d4c49a'} /><line x1={position.x + (index ? -12 : 12)} y1={position.y} x2={position.x + (index ? -40 : 40)} y2={position.y + (index ? 26 : -26)} stroke="#c8d8cd70" /><text x={position.x + (index ? -45 : 45)} y={position.y + (index ? 30 : -28)} textAnchor={index ? 'end' : 'start'} fill={selected ? '#e1edd9' : '#b9c7c4'} fontSize="9">{site.id.toUpperCase()}</text>
      </g>
    })}</g>
  </svg><div className="science-map-caption"><span><i />NASA STUDY REGIONS</span><span>89°S — 90°S · EAST LONGITUDE</span></div><p>Coordinate graticule · polar stereographic display. Markers are reference points inside study regions, not approved landing sites.</p></div>
}
