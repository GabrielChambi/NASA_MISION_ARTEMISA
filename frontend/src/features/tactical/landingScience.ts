/** Actual NASA observer ephemerides + finite, native-5 m terrain assessments.
 * Adjacent-cell sky directions are a geometric translation of the queried
 * apparent body vector, NOT independent SPICE solutions. Provenance is exported.
 */
export type LandingCell = {
  id: string; ix: number; iy: number; x_m: number; y_m: number
  latitude_deg: number; longitude_deg: number; elevation_m: number | null
  slope_deg: number | null; max_slope_deg: number | null; relief_m: number | null
  height_uncertainty_m: number | null; known: boolean
  horizon_deg: number[]; ray_coverage_fraction: number
}
export type LandingRegion = {
  id: string; name: string; width: number; height: number; spacing_m: number
  footprint_radius_m: number; observer_height_m: number; center_cell_id: string
  products: Record<string, string>; cells: LandingCell[]
  context_grid: { grid_size: number; spacing_m: number; xmin: number; ymax: number; scale_m: number; offset_m: number; heights: number[] }
  render_grid: { grid_size: number; spacing_m: number; xmin: number; ymax: number; scale_m: number; offset_m: number; heights: number[] }
}
export type LandingSurface = {
  schema_version: number; native_resolution_m: number; regional_resolution_m: number
  source_sha256: Record<string, string>; limitations: string[]; reference_frame: string
  regions: LandingRegion[]
}
export type BodySample = { t_utc: string; azimuth_deg: number; elevation_deg: number; horizon_deg: number; range_km: number; visible: boolean }
export type BodyResult = { status: string; meta: Record<string, unknown> & { query_url: string; latitude_deg: number; longitude_deg: number; cell_id: string; retrieved_at: string; limitations: string[] }; samples: BodySample[] }
export type Limits = { maxSlope: number; maxRelief: number; sunMargin: number; earthMargin: number; minSunHours: number; minEarthHours: number }
export type Risk = 'green' | 'yellow' | 'red' | 'unknown'
export type CellAssessment = { cell: LandingCell; risk: Risk; reasons: string[]; sunMargin: number | null; earthMargin: number | null; sunHours: number; earthHours: number }
export type LandingRun = { origin: LandingCell; region: LandingRegion; sun: BodyResult; earth: BodyResult; limits: Limits; createdAt: string; key: string }
const R = 1737400, RAD = Math.PI / 180
type Vec = [number, number, number]
const dot = (a: Vec, b: Vec) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2]
const plus = (a: Vec, b: Vec): Vec => [a[0]+b[0],a[1]+b[1],a[2]+b[2]]
const times = (a: Vec, k: number): Vec => [a[0]*k,a[1]*k,a[2]*k]
function frame(c: LandingCell) {
  const p=c.latitude_deg*RAD, l=c.longitude_deg*RAD
  return { east:[-Math.sin(l),Math.cos(l),0] as Vec, north:[-Math.sin(p)*Math.cos(l),-Math.sin(p)*Math.sin(l),Math.cos(p)] as Vec, up:[Math.cos(p)*Math.cos(l),Math.cos(p)*Math.sin(l),Math.sin(p)] as Vec }
}
export function anglesAtCell(row: BodySample, from: LandingCell, to: LandingCell) {
  if (![row.azimuth_deg,row.elevation_deg,row.range_km,from.elevation_m,to.elevation_m].every(v=>typeof v==='number'&&Number.isFinite(v)) || row.range_km<=0) throw new Error('Efemérides o elevación no disponibles.')
  if (from.id===to.id) return { azimuth_deg:row.azimuth_deg,elevation_deg:row.elevation_deg }
  const f=frame(from), t=frame(to), a=row.azimuth_deg*RAD,e=row.elevation_deg*RAD
  const direction=plus(plus(times(f.east,Math.sin(a)*Math.cos(e)),times(f.north,Math.cos(a)*Math.cos(e))),times(f.up,Math.sin(e)))
  const body=plus(times(f.up,R+from.elevation_m!+2),times(direction,row.range_km*1000))
  const vector=plus(body,times(t.up,-(R+to.elevation_m!+2)))
  const az=Math.atan2(dot(vector,t.east),dot(vector,t.north))/RAD
  const el=Math.atan2(dot(vector,t.up),Math.hypot(dot(vector,t.east),dot(vector,t.north)))/RAD
  return { azimuth_deg:(az+360)%360,elevation_deg:el }
}
export function horizonAt(cell: LandingCell, azimuth: number) {
  if (!cell.known || cell.horizon_deg.length!==360 || !Number.isFinite(azimuth)) return NaN
  const p=(azimuth%360+360)%360, i=Math.floor(p), f=p-i
  const a=cell.horizon_deg[i], b=cell.horizon_deg[(i+1)%360]
  return Number.isFinite(a)&&Number.isFinite(b)?a*(1-f)+b*f:NaN
}
export function marginsAt(cell: LandingCell, origin: LandingCell, sun: BodySample, earth: BodySample) {
  const s=anglesAtCell(sun,origin,cell), e=anglesAtCell(earth,origin,cell)
  return { sun:s.elevation_deg-horizonAt(cell,s.azimuth_deg),earth:e.elevation_deg-horizonAt(cell,e.azimuth_deg) }
}
export function validateBody(result: BodyResult, cell: LandingCell, start: string, end: string) {
  const count=(Date.parse(end)-Date.parse(start))/3600000+1
  if(result.status!=='ok'||result.meta.cell_id!==cell.id||result.meta.latitude_deg!==cell.latitude_deg||result.meta.longitude_deg!==cell.longitude_deg||!result.meta.query_url?.startsWith('https://ssd.jpl.nasa.gov/api/horizons.api?')||result.samples.length!==count) throw new Error('NASA devolvió un observador o una serie incompleta.')
  result.samples.forEach((s,i)=>{
    if(Date.parse(s.t_utc)!==Date.parse(start)+i*3600000||![s.azimuth_deg,s.elevation_deg,s.horizon_deg,s.range_km].every(Number.isFinite)||s.range_km<=0) throw new Error('La serie NASA contiene muestras desconocidas o fechas desalineadas.')
  })
}
export function validateSurface(value: LandingSurface) {
  if(value.schema_version!==1 || value.native_resolution_m!==5 || !Array.isArray(value.regions)||value.regions.length!==2) throw new Error('El catálogo de terreno NASA no es válido.')
  for(const region of value.regions) {
    if(region.cells.length!==region.width*region.height || region.spacing_m!==50 || region.observer_height_m!==2) throw new Error('La rejilla NASA está incompleta.')
    const context=region.context_grid
    if(context.grid_size!==201||context.heights.length!==201*201||context.heights.some(v=>!Number.isInteger(v)||v<0||v>65535))throw new Error('El contexto NASA está incompleto.')
    const g=region.render_grid
    if(g.grid_size!==221||g.heights.length!==g.grid_size*g.grid_size||g.heights.some(v=>!Number.isInteger(v)||v<0||v>65535)) throw new Error('El relieve NASA está incompleto.')
    for(const c of region.cells) if(c.known&&([c.elevation_m,c.slope_deg,c.max_slope_deg,c.height_uncertainty_m,c.relief_m].some(v=>typeof v!=='number'||!Number.isFinite(v))||c.horizon_deg.length!==360||c.horizon_deg.some(v=>!Number.isFinite(v)))) throw new Error('Una celda marcada conocida contiene datos ausentes.')
  }
  return value
}
export function windowMetrics(run: LandingRun, cell: LandingCell) {
  let sunHours=0,earthHours=0,jointHours=0,dark=0,longestDark=0
  const jointWindows:{start:string;end:string;hours:number}[]=[]
  let opening:string|null=null
  for(let i=0;i<run.sun.samples.length-1;i++) {
    const a=run.sun.samples[i], b=run.earth.samples[i], m=marginsAt(cell,run.origin,a,b)
    const hours=(Date.parse(run.sun.samples[i+1].t_utc)-Date.parse(a.t_utc))/3600000
    const s=m.sun>run.limits.sunMargin,e=m.earth>run.limits.earthMargin
    if(s){sunHours+=hours;dark=0}else{dark+=hours;longestDark=Math.max(longestDark,dark)}
    if(e)earthHours+=hours
    if(s&&e){jointHours+=hours;opening??=a.t_utc}else if(opening){jointWindows.push({start:opening,end:a.t_utc,hours:(Date.parse(a.t_utc)-Date.parse(opening))/3600000});opening=null}
  }
  const end=run.sun.samples.at(-1)!.t_utc
  if(opening)jointWindows.push({start:opening,end,hours:(Date.parse(end)-Date.parse(opening))/3600000})
  return {sunHours,earthHours,jointHours,longestDark,jointWindows}
}
export function assessCell(run: LandingRun, cell: LandingCell, index: number, hours: {sunHours:number;earthHours:number}): CellAssessment {
  const unknown=(reason:string): CellAssessment=>({cell,risk:'unknown',reasons:[reason],sunMargin:null,earthMargin:null,sunHours:hours.sunHours,earthHours:hours.earthHours})
  if(!cell.known || cell.ray_coverage_fraction<0.995 || [cell.elevation_m,cell.max_slope_deg,cell.relief_m].some(v=>typeof v!=='number'||!Number.isFinite(v))) return unknown('Cobertura NASA insuficiente.')
  const s=run.sun.samples[index],e=run.earth.samples[index]
  if(!s||!e||s.t_utc!==e.t_utc) return unknown('Falta una muestra NASA alineada.')
  let m:ReturnType<typeof marginsAt>
  try{m=marginsAt(cell,run.origin,s,e)}catch{return unknown('Efemérides desconocidas.')}
  if(!Number.isFinite(m.sun)||!Number.isFinite(m.earth))return unknown('Horizonte desconocido.')
  const reasons:string[]=[]
  const l=run.limits
  if(cell.max_slope_deg!>l.maxSlope)reasons.push('Pendiente máxima sobre el límite.')
  if(cell.relief_m!>l.maxRelief)reasons.push('Relieve local sobre el límite.')
  if(m.sun<=l.sunMargin)reasons.push('Sol bajo el margen requerido.')
  if(m.earth<=l.earthMargin)reasons.push('Tierra bajo el margen requerido.')
  if(hours.sunHours<l.minSunHours)reasons.push('Horas de Sol insuficientes.')
  if(hours.earthHours<l.minEarthHours)reasons.push('Horas de Tierra insuficientes.')
  const near=cell.max_slope_deg!>l.maxSlope-1 || cell.relief_m!>l.maxRelief-0.5 || m.sun<l.sunMargin+0.5 || m.earth<l.earthMargin+0.5 || cell.height_uncertainty_m!>1
  return {cell,risk:reasons.length?'red':near?'yellow':'green',reasons:reasons.length?reasons:near?['Margen pequeño o incertidumbre elevada.']:['Cumple los criterios evaluados del modelo.'],sunMargin:m.sun,earthMargin:m.earth,sunHours:hours.sunHours,earthHours:hours.earthHours}
}
export function parseUtcInput(input:string) {
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input)) throw new Error('Completa la fecha y hora UTC.')
  const iso=input+':00Z', date=new Date(iso)
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,16)!==input||date.getUTCFullYear()<1962||date.getUTCFullYear()>2100) throw new Error('Fecha UTC no válida (1962–2100).')
  return iso
}
export function nearestCell(surface: LandingSurface, lat:number,lon:number) {
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat> -80||lat< -90||lon< -180||lon>180)return null
  const rho=2*R*Math.tan((90+lat)*RAD/2),x=rho*Math.sin(lon*RAD),y=rho*Math.cos(lon*RAD)
  let nearest:LandingCell|null=null, region:LandingRegion|null=null,distance=Infinity
  for(const r of surface.regions)for(const c of r.cells){
    const d=Math.hypot(c.x_m-x,c.y_m-y)
    if(d<distance){nearest=c;region=r;distance=d}
  }
  return nearest&&region&&distance<=surface.regions[0].spacing_m/Math.sqrt(2)+0.02?{cell:nearest,region,distance}:null
}
