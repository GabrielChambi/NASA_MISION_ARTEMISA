import {fileURLToPath} from 'node:url'
import { readFile } from 'node:fs/promises'
import { transform, build } from 'esbuild'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLandingApi } from './landing.mjs'
const root=new URL('../../data/',import.meta.url)
const json=async path=>JSON.parse(await readFile(new URL(path,root),'utf8'))
const landing=await json('prepared/landing_surface.json')
const {readdir}=await import('node:fs/promises')
const ephemeris=await Promise.all((await readdir(new URL('prepared/ephemeris/',root))).filter(n=>n.endsWith('.json')).map(n=>json('prepared/ephemeris/'+n)))
const api=createLandingApi({landing,ephemeris})
const source=await readFile(new URL('../src/features/tactical/landingScience.ts',import.meta.url),'utf8')
const {code}=await transform(source,{loader:'ts',format:'esm',target:'es2022'})
const model=await import('data:text/javascript;base64,'+Buffer.from(code+'\n//# sourceURL=landingScience.test.js').toString('base64'))
const get=async(id,target,extra={})=>{
  const params=new URLSearchParams({cell_id:id,target,start_utc:'2026-12-14T00:00:00Z',end_utc:'2026-12-17T00:00:00Z',step_minutes:'60',...extra})
  return api(new Request('http://test/api/landing/ephemeris?'+params))
}
const limits={maxSlope:10,maxRelief:5,sunMargin:.2,earthMargin:.2,minSunHours:12,minEarthHours:12}
const region=landing.regions[0],origin=region.cells.find(c=>c.id===region.center_cell_id)
const sun=await (await get(origin.id,'Sun')).json(),earth=await (await get(origin.id,'Earth')).json()
const run={origin,region,sun,earth,limits,createdAt:'test',key:'test'}

test('exact NASA observer reproduces independent JPL angles, including negative Earth elevation',()=>{
  assert.equal(sun.status,'ok');assert.equal(earth.status,'ok')
  assert.equal(sun.samples[0].azimuth_deg,259.177675)
  assert.equal(earth.samples[0].elevation_deg,-1.436344)
  assert.ok(sun.samples.every(s=>s.range_km>140000000))
  for(const result of [sun,earth])model.validateBody(result,origin,'2026-12-14T00:00:00Z','2026-12-17T00:00:00Z')
})
test('complete native source metadata; no display-grid slope is used',()=>{
  assert.equal(model.validateSurface(landing),landing)
  assert.equal(origin.slope_deg,3.7994)
  const steep=landing.regions[1].cells.find(c=>c.id==='site04:10:10')
  assert.equal(steep.slope_deg,32.7358);assert.ok(steep.max_slope_deg>=steep.slope_deg)
  assert.equal(landing.regions.reduce((n,r)=>n+r.cells.length,0),882)
})
test('unknown terrain, missing heights and nodata horizons never become green',()=>{
  for(const patch of [{known:false},{elevation_m:null},{horizon_deg:Array(360).fill(NaN)},{ray_coverage_fraction:.8}]){
    const a=model.assessCell(run,{...origin,...patch},0,{sunHours:72,earthHours:72})
    assert.equal(a.risk,'unknown')
  }
  const broken=structuredClone(landing);broken.regions[0].cells[0].slope_deg=null
  assert.throws(()=>model.validateSurface(broken))
})
test('slope, instantaneous obstruction and mission duration all affect verdicts',()=>{
  const fakeCell={...origin,horizon_deg:Array(360).fill(-5),max_slope_deg:3,relief_m:1}
  const hours={sunHours:72,earthHours:72}
  assert.equal(model.assessCell(run,fakeCell,0,hours).risk,'green')
  assert.equal(model.assessCell(run,{...fakeCell,max_slope_deg:10.1},0,hours).risk,'red')
  assert.equal(model.assessCell(run,{...fakeCell,max_slope_deg:9.5},0,hours).risk,'yellow')
  assert.equal(model.assessCell(run,{...fakeCell,horizon_deg:Array(360).fill(20)},0,hours).risk,'red')
  assert.equal(model.assessCell(run,fakeCell,0,{sunHours:0,earthHours:72}).risk,'red')
})
test('spatial translation agrees with independent NASA corner observer within 0.002 degrees',async()=>{
  const corner=region.cells.find(c=>c.id==='site01:0:0')
  for(const target of ['Sun','Earth']){
    const independent=await(await get(corner.id,target)).json()
    const baseline=target==='Sun'?sun:earth
    assert.equal(independent.status,'ok')
    for(let i=0;i<baseline.samples.length;i++){
      const predicted=model.anglesAtCell(baseline.samples[i],origin,corner),actual=independent.samples[i]
      const azError=Math.abs(((predicted.azimuth_deg-actual.azimuth_deg+540)%360)-180)
      assert.ok(azError<.002,'az error '+azError)
      assert.ok(Math.abs(predicted.elevation_deg-actual.elevation_deg)<.002)
    }
  }
})
test('UTC grid is strict; endpoint contributes zero hours, and missing samples fail',()=>{
  const allVisible={...run,origin:{...origin,horizon_deg:Array(360).fill(-10)}}
  const result=model.windowMetrics(allVisible,allVisible.origin)
  assert.equal(result.sunHours,72);assert.equal(result.earthHours,72);assert.equal(result.jointHours,72)
  assert.equal(result.jointWindows[0].hours,72)
  assert.throws(()=>model.parseUtcInput(''));assert.throws(()=>model.parseUtcInput('2026-02-30T09:00'))
  assert.throws(()=>model.parseUtcInput('bad'));assert.equal(model.parseUtcInput('2026-12-14T00:00'),'2026-12-14T00:00:00Z')
  assert.throws(()=>model.validateBody({...sun,samples:sun.samples.slice(1)},origin,'2026-12-14T00:00:00Z','2026-12-17T00:00:00Z'))
})
test('selection snaps only inside prepared coverage; previous fictional rescue point stays unknown',()=>{
  assert.equal(model.nearestCell(landing,origin.latitude_deg,origin.longitude_deg).cell.id,origin.id)
  assert.equal(model.nearestCell(landing,-89.7,-160),null)
  assert.equal(model.nearestCell(landing,NaN,0),null)
})
test('API rejects missing coverage, unsupported target, height, and invalid UTC without NASA calls',async()=>{
  for(const [id,target,extra] of [['outside','Sun',{}],[origin.id,'Mars',{}],[origin.id,'Sun',{observer_height_m:'5'}],[origin.id,'Sun',{start_utc:'2026-02-30T00:00:00Z'}]]){
    const r=await get(id,target,extra);assert.equal(r.status,422)
  }
})
test('visual sampling preserves unknowns; curved flat Moon does not block a positive-elevation ray',async()=>{
  const path=new URL('../src/features/tactical/tacticalMath.ts',import.meta.url)
  const output=await build({entryPoints:[fileURLToPath(path)],bundle:true,write:false,format:'esm',platform:'node'})
  const math=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'))
  const manifest={grid_size:201,display_spacing_m:1000,scale_m:1,offset_m:0,nodata:65535,radius_m:1737400,sample_extent_m:{xmin:-100000,xmax:100000,ymin:-100000,ymax:100000}}
  const heights=new Uint16Array(201*201)
  const hit=math.raycastTerrainObstruction(-90,-160,2,40,.1,heights,manifest,1,50)
  assert.equal(hit.hit,false);assert.ok(hit.marginDeg>0)
  assert.ok(Number.isNaN(math.sampleLolaHeight(200000,0,heights,manifest)))
  assert.ok(Number.isNaN(math.sampleExactStereoMeshPoint(200000,0,heights,manifest).elevationM))
  heights.fill(65535);assert.ok(Number.isNaN(math.sampleLolaHeight(0,0,heights,manifest)))
})
