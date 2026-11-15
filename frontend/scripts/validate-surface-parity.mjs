
/** Reproduce Python/Worker consistency using prepared original NASA records only.
 * Run from any directory: node <repo>/frontend/scripts/validate-surface-parity.mjs
 * Optional LUNAR_ORACLE_PYTHON overrides the Python executable; no shell is used.
 */
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {createScienceApi,validateQuery,queryParameters} from '../worker/science.mjs'
import {REFERENCE,validatePlanRequest,estimateTransfer,missionTiming,evaluateGlobalPlan} from '../worker/automatic-plan.mjs'

const root=fileURLToPath(new URL('../../',import.meta.url))
const read=async relative=>JSON.parse(await readFile(path.join(root,'data',relative),'utf8'))
const resources={polar:await read('prepared/polar_screening.json'),globalHorizons:await read('prepared/global_horizons.json'),sites:{sites:[REFERENCE]},ephemeris:[]}
for(const filename of await readdir(path.join(root,'data/prepared/ephemeris')))if(filename.endsWith('.json'))resources.ephemeris.push(await read('prepared/ephemeris/'+filename))
const example=await read('prepared/automatic_example.json'),request=validatePlanRequest(example.request),api=createScienceApi(resources)
const iso=t=>new Date(t).toISOString().slice(0,19)+'Z'
async function getSky(target,start,end){
 const url=new URL(target==='Sun'?'/api/solar':'/api/earth','https://offline.validation')
 url.search=new URLSearchParams({site_id:REFERENCE.id,start_utc:start,end_utc:end,step_minutes:'60',observer_height_m:'2',horizon_mode:'flat',include_range:'true'}).toString()
 const params=queryParameters(validateQuery(url,resources.sites))
 if(!resources.ephemeris.some(record=>Object.keys(params).every(key=>record.params?.[key]===params[key])))throw new Error('Original NASA record is missing; this validator never fetches network data.')
 const response=await api(new Request(url)),result=await response.json()
 if(!response.ok||result.meta?.cache_hit!==true)throw new Error('The prepared NASA series could not be validated offline.')
 return result
}
const anchor=await getSky('Earth',request.departure_utc,iso(Date.parse(request.departure_utc)+3600000))
const transfer=estimateTransfer(anchor.samples[0]),mission=missionTiming(request,transfer)
const sky={sun:await getSky('Sun',mission.arrival_utc,mission.surface_end_utc),earth:await getSky('Earth',mission.arrival_utc,mission.surface_end_utc),transfer_source:anchor.meta}
const worker=evaluateGlobalPlan(request,resources,sky,transfer)
const fields=['risk','sun_hours','earth_hours','joint_hours','sun_hours_sensitivity','earth_hours_sensitivity','nominal_pass','sensitivity_pass','longest_dark_hours','longest_earth_hidden_hours']
const candidates=process.platform==='win32'?[path.join(root,'api/.venv/Scripts/python.exe')]:[path.join(root,'api/.venv/bin/python')]
const python=process.env.LUNAR_ORACLE_PYTHON||candidates.find(existsSync)||(process.platform==='win32'?'python':'python3')
const source=String.raw`import sys,json
sys.path.insert(0,sys.argv[1])
from api.app.automatic_plan import evaluate_global_plan,global_horizons
from api.app.polar import surface
value=json.load(sys.stdin)
result=evaluate_global_plan(value['request'],surface(),global_horizons(),value['sky'],value['transfer'])
fields=value['fields']
print(json.dumps({'rows':[[row['id']]+[row.get(key) for key in fields] for row in result['cells']],'coverage':result['coverage'],'counts':result['counts'],'python_version':sys.version.split()[0]},separators=(',',':')))
`
const child=spawnSync(python,['-c',source,root],{input:JSON.stringify({request,sky,transfer,fields}),encoding:'utf8',maxBuffer:8*1024*1024,windowsHide:true})
if(child.error)throw new Error('Cannot start Python: '+child.error.message)
if(child.status!==0)throw new Error('Python validation failed: '+child.stderr.slice(0,1200))
const other=JSON.parse(child.stdout),byId=new Map(other.rows.map(row=>[row[0],row])),workerIds=new Set(worker.cells.map(cell=>cell.id))
let mismatches=0,fieldMismatches=0
const samples=[]
for(const cell of worker.cells){
 const peer=byId.get(cell.id),different=fields.filter((key,i)=>!peer||JSON.stringify(cell[key]??null)!==JSON.stringify(peer[i+1]??null))
 if(different.length){mismatches++;fieldMismatches+=different.length;if(samples.length<10)samples.push({id:cell.id,fields:different})}
}
const missingIds=other.rows.filter(row=>!workerIds.has(row[0])).map(row=>row[0])
mismatches+=missingIds.length
const duplicateIds=worker.cells.length-workerIds.size+other.rows.length-byId.size
const a=worker.coverage,b=other.coverage,risks=['green','yellow','red','unknown']
const differences=risks.map(risk=>Math.abs(a.by_class[risk].area_km2-b.by_class[risk].area_km2))
const workerClosure=Math.abs(risks.reduce((sum,risk)=>sum+a.by_class[risk].area_km2,0)-a.cap_area_km2)
const pythonClosure=Math.abs(risks.reduce((sum,risk)=>sum+b.by_class[risk].area_km2,0)-b.cap_area_km2)
const expectedCells=resources.polar.cells.filter(cell=>cell.latitude_deg<=-80).length
const consistent=risks.every(risk=>worker.counts[risk]===other.counts[risk])&&worker.cells.length===expectedCells&&other.rows.length===expectedCells&&mismatches===0&&duplicateIds===0&&Math.max(...differences)<=.001&&workerClosure<=.003&&pythonClosure<=.003
const report={schema_version:1,status:consistent?'ok':'failed',generated_at:new Date().toISOString(),
 scope:'Implementation consistency for one prepared mission; not independent NASA validation, uncertainty propagation, or landing certification.',
 request,terrain_source_sha256:resources.polar.source_sha256,horizon_source_sha256:resources.globalHorizons.source_sha256,
 source_resolution_m:80,cell_spacing_m:resources.polar.cell_spacing_m,sources:worker.meta.sources.map(s=>({source:s.source,query_url:s.query_url,retrieved_at:s.retrieved_at})),
 expected_cells:expectedCells,cells_compared:worker.cells.length,fields_compared:fields,unavailable_field_normalization:'Absent fields and null both denote unavailable measurements.',mismatch_count:mismatches,field_mismatch_count:fieldMismatches,duplicate_id_count:duplicateIds,
 mismatch_samples:samples,missing_ids:missingIds.slice(0,10),counts:worker.counts,python_version:other.python_version,
 area:{cap_area_km2:a.cap_area_km2,represented_area_km2:a.represented_area_km2,unrepresented_area_km2:a.unrepresented_area_km2,
  by_class:a.by_class,max_engine_difference_km2:Math.max(...differences),worker_conservation_error_km2:workerClosure,python_conservation_error_km2:pythonClosure,
  engine_tolerance_km2:.001,conservation_tolerance_km2:.003,unknown_boundary_included:a.unknown_boundary_included}}
const output=path.join(root,'docs/validation/surface-parity.json')
await mkdir(path.dirname(output),{recursive:true})
await writeFile(output,JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify({status:report.status,cells_compared:report.cells_compared,mismatch_count:report.mismatch_count,counts:report.counts,report:'docs/validation/surface-parity.json'},null,2))
if(!consistent)process.exitCode=1
