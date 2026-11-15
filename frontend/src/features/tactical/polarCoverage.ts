/** Georeferencing for the full polar result raster. No slope/sky values are invented. */
import type { PolarCell,PolarSurface,PolarRisk } from './polarScience'

export type PolarCoverage = {
  cells:readonly {id:string;risk:PolarRisk|string}[]
  opacity?:number
  selectedId?:string|null
}
export const COVERAGE_CODE={unknown:4,green:1,yellow:2,red:3} as const
export type CoverageGrid=Pick<PolarSurface,'grid_size'|'cell_spacing_m'|'grid'|'radius_m'|'cells'>

export function coverageRaster(surface:CoverageGrid,results:PolarCoverage['cells']):Uint8Array{
  const n=surface.grid_size
  if(!Number.isInteger(n)||n<1||n>2048||surface.cells.length!==n*n||!Number.isFinite(surface.cell_spacing_m)||surface.cell_spacing_m<=0)throw new Error('La rejilla de cobertura no es válida.')
  // Outside-center cells also have fragments inside the circular cap. They stay
  // unknown when the scientific result has no measurement for their center.
  const values=new Uint8Array(n*n).fill(COVERAGE_CODE.unknown)
  const byId=new Map(surface.cells.map((cell,index)=>[cell.id,index]))
  const seen=new Set<string>()
  for(const result of results){
    const index=byId.get(result.id)
    if(index===undefined)continue
    if(seen.has(result.id)){values[index]=COVERAGE_CODE.unknown;continue}
    seen.add(result.id)
    values[index]=COVERAGE_CODE[result.risk as PolarRisk]??COVERAGE_CODE.unknown
  }
  return values
}

export function polarCellAtStereo(surface:CoverageGrid,x:number,y:number):PolarCell|null{
  if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(surface.radius_m)||surface.radius_m<=0)return null
  const capRadius=2*surface.radius_m*Math.tan(5*Math.PI/180)
  if(Math.hypot(x,y)>capRadius)return null
  const col=Math.floor((x-surface.grid.xmin)/surface.cell_spacing_m)
  const row=Math.floor((surface.grid.ymax-y)/surface.cell_spacing_m)
  if(col<0||row<0||col>=surface.grid_size||row>=surface.grid_size)return null
  // Point coverage, rather than the cell-center latitude, includes unresolved
  // slivers at 80 S as unknown instead of silently snapping them to an interior.
  return surface.cells[row*surface.grid_size+col]??null
}

export function worldPointToPolarStereo(point:{x:number;y:number;z:number},radiusM:number):[number,number]|null{
  if(![point.x,point.y,point.z,radiusM].every(Number.isFinite)||radiusM<=0)return null
  const vertical=point.y+radiusM/1000
  const radial=Math.hypot(point.x,vertical,point.z)
  if(radial===0||radial+vertical<=0)return null
  // Scene units km; same algebra as inverse south-polar stereographic on a sphere.
  // Height cancels from the ratio, so this follows the actual displaced mesh.
  const factor=2*radiusM/(radial+vertical)
  return [-point.x*factor,point.z*factor]
}

export function polarCellAtWorld(surface:CoverageGrid,point:{x:number;y:number;z:number}):PolarCell|null{
  const projected=worldPointToPolarStereo(point,surface.radius_m)
  return projected?polarCellAtStereo(surface,projected[0],projected[1]):null
}
