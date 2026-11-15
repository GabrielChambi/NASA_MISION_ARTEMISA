/** Native NASA 80 m terrain triage over the 80–90 S cap.
 * Regional class names deliberately avoid "safe" or "landing possible".
 * Time-dependent Sun/Earth visibility is not inferred by this module.
 */
export type PolarRisk='green'|'yellow'|'red'|'unknown'
export type PolarCell={
  id:string;row:number;col:number;x_m:number;y_m:number
  latitude_deg:number;longitude_deg:number
  elevation_m:number|null;regional_slope_deg:number|null;median_slope_deg:number|null
  max_slope_deg:number|null;roughness_m:number|null;relief_m:number|null
  coverage_fraction:number;native_pixels:number;cap_fraction:number;known:boolean
}
export type PolarSurface={
  schema_version:number;status:string;analysis_type:'regional-terrain-screening'
  source:string;source_url:string;source_sha256:string;source_resolution_m:number
  radius_m:number;reference_frame:string;latitude_bounds_deg:[number,number]
  grid_size:number;cell_spacing_m:number
  grid:{xmin:number;ymax:number;xmax:number;ymin:number;center_xmin:number;center_ymax:number;order:string}
  slope_method:string;roughness_method:string;limitations:string[]
  statistics:{total_grid_cells:number;cap_center_cells:number;known_cells:number;unknown_cap_cells:number;covered_area_km2:number;cap_area_km2:number;coverage_fraction_by_center:number;minimum_elevation_m:number;maximum_elevation_m:number}
  cells:PolarCell[]
}
export type PolarAssessment={cell:PolarCell;risk:PolarRisk;label:string;reason:string;requires_local_analysis:true}
const R=1737400,RAD=Math.PI/180

export function validatePolarSurface(data:PolarSurface):PolarSurface{
  if(data.schema_version!==1||data.status!=='ok'||data.analysis_type!=='regional-terrain-screening'||data.source_resolution_m!==80||data.grid_size!==128||data.cell_spacing_m!==4750||data.cells.length!==data.grid_size**2||!/^https:\/\/pgda\.gsfc\.nasa\.gov\//.test(data.source_url)||!/^[a-f0-9]{64}$/.test(data.source_sha256))throw new Error('La evaluación regional NASA no está completa.')
  for(let index=0;index<data.cells.length;index++){
    const c=data.cells[index]
    if(c.row!==Math.floor(index/data.grid_size)||c.col!==index%data.grid_size)throw new Error('La rejilla polar no está ordenada.')
    if(c.known&&([c.elevation_m,c.regional_slope_deg,c.median_slope_deg,c.max_slope_deg,c.roughness_m,c.relief_m,c.coverage_fraction].some(v=>typeof v!=='number'||!Number.isFinite(v))||c.latitude_deg< -90||c.latitude_deg> -80||c.coverage_fraction<.95))throw new Error('Una celda polar carece de datos válidos.')
  }
  return data
}

/** User's threshold is a regional screening threshold, not a footprint limit.
 * Max native slope over the cell influences precaution; this is conservative
 * prioritisation, not proof that every part of a red region is unusable.
 */
export function classifyPolarCell(cell:PolarCell,maxRegionalSlope=10):PolarAssessment{
  const unknown=(reason:string):PolarAssessment=>({cell,risk:'unknown',label:'Datos insuficientes',reason,requires_local_analysis:true})
  if(!Number.isFinite(maxRegionalSlope)||maxRegionalSlope<0||maxRegionalSlope>45)return unknown('El umbral regional debe estar entre 0 y 45 grados.')
  if(!cell.known||cell.coverage_fraction<.95||cell.latitude_deg< -90||cell.latitude_deg> -80||[cell.regional_slope_deg,cell.max_slope_deg,cell.elevation_m].some(v=>typeof v!=='number'||!Number.isFinite(v)))return unknown('Cobertura regional ausente o incompleta; no se sustituye por terreno plano.')
  if(cell.regional_slope_deg!>maxRegionalSlope)return {cell,risk:'red',label:'Relieve regional exigente',reason:'La pendiente percentil 95 a escala de 80 m supera el umbral regional. No excluye posibles enclaves más suaves.',requires_local_analysis:true}
  if(cell.regional_slope_deg!>Math.max(0,maxRegionalSlope-2)||cell.max_slope_deg!>maxRegionalSlope||cell.coverage_fraction<.999)return {cell,risk:'yellow',label:'Estudiar con precaución',reason:'El terreno regional contiene pendientes pronunciadas, margen limitado o cobertura parcial. Requiere relieve local más fino.',requires_local_analysis:true}
  return {cell,risk:'green',label:'Prioridad de estudio',reason:'Terreno regional relativamente suave bajo el umbral evaluado. Falta evaluar huella, Sol, Tierra y riesgos locales.',requires_local_analysis:true}
}

export function findPolarCell(data:PolarSurface,lat:number,lon:number):PolarCell|null{
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat< -90||lat> -80||lon< -180||lon>180)return null
  const rho=2*data.radius_m*Math.tan((90+lat)*RAD/2),x=rho*Math.sin(lon*RAD),y=rho*Math.cos(lon*RAD)
  const col=Math.floor((x-data.grid.xmin)/data.cell_spacing_m),row=Math.floor((data.grid.ymax-y)/data.cell_spacing_m)
  if(row<0||col<0||row>=data.grid_size||col>=data.grid_size)return null
  const cell=data.cells[row*data.grid_size+col]
  return cell.latitude_deg<=-80?cell:null
}

/** Three geographically separated candidates prevent returning adjacent copies. */
export function rankPolarCells(data:PolarSurface,maxRegionalSlope=10,limit=3,minDistanceM=30000):PolarAssessment[]{
  if(!Number.isInteger(limit)||limit<1||limit>20||!Number.isFinite(minDistanceM)||minDistanceM<0)throw new Error('Parámetros de búsqueda regional no válidos.')
  const score=(a:PolarAssessment)=>(a.risk==='green'?0:1)*1000+(a.cell.regional_slope_deg??90)
  const candidates=data.cells.map(c=>classifyPolarCell(c,maxRegionalSlope)).filter(a=>a.risk==='green'||a.risk==='yellow').sort((a,b)=>score(a)-score(b)||a.cell.id.localeCompare(b.cell.id))
  const chosen:PolarAssessment[]=[]
  for(const candidate of candidates){
    if(chosen.every(a=>Math.hypot(a.cell.x_m-candidate.cell.x_m,a.cell.y_m-candidate.cell.y_m)>=minDistanceM)){
      chosen.push(candidate);if(chosen.length===limit)break
    }
  }
  return chosen
}
export function polarCellCenterToLatLon(x:number,y:number){
  const rho=Math.hypot(x,y)
  return {latitude_deg:2*Math.atan2(rho,2*R)/RAD-90,longitude_deg:rho?Math.atan2(x,y)/RAD:0}
}
