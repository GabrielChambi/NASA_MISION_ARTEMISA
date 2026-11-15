import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {transform} from 'esbuild'
import {createPolarApi} from './polar.mjs'
const data=JSON.parse(await readFile(new URL('../../data/prepared/polar_screening.json',import.meta.url),'utf8'))
const source=await readFile(new URL('../src/features/tactical/polarScience.ts',import.meta.url),'utf8')
const {code}=await transform(source,{loader:'ts',format:'esm',target:'es2022'})
const model=await import('data:text/javascript;base64,'+Buffer.from(code+'\n//# sourceURL=polarScience.test.js').toString('base64'))
const api=createPolarApi({polar:data})
test('regional route returns full polar screening, no ephemerides or landing verdict',async()=>{
  const response=await api(new Request('http://test/api/polar/surface'))
  assert.equal(response.status,200)
  const body=await response.json()
  assert.equal(body.cells.length,16384)
  assert.ok(body.statistics.known_cells>12000)
  assert.equal(body.analysis_type,'regional-terrain-screening')
  assert.equal(body.source_resolution_m,80)
  assert.equal(body.cells[0].elevation_m,null)
  assert.equal(body.samples,undefined)
})
test('missing dataset and invalid methods fail rather than fabricate terrain',async()=>{
  assert.equal((await createPolarApi({})(new Request('http://test/api/polar/surface'))).status,503)
  assert.equal((await api(new Request('http://test/api/polar/surface',{method:'POST'}))).status,405)
  assert.equal((await api(new Request('http://test/api/polar/not-found'))).status,404)
  assert.equal(await api(new Request('http://test/api/other')),null)
})
test('validate metadata, finite values and source provenance',()=>{
  assert.equal(model.validatePolarSurface(data),data)
  const broken=structuredClone(data)
  broken.cells.find(c=>c.known).regional_slope_deg=null
  assert.throws(()=>model.validatePolarSurface(broken))
})
test('green is only a regional study priority; extreme slopes red, nodata unknown',()=>{
  const cell=data.cells.find(c=>c.known)
  const gentle={...cell,regional_slope_deg:2,max_slope_deg:4}
  const green=model.classifyPolarCell(gentle,10)
  assert.equal(green.risk,'green')
  assert.equal(green.requires_local_analysis,true)
  assert.equal(green.label,'Prioridad de estudio')
  assert.equal(model.classifyPolarCell({...gentle,regional_slope_deg:11},10).risk,'red')
  assert.equal(model.classifyPolarCell({...gentle,max_slope_deg:15},10).risk,'yellow')
  for(const patch of [{known:false},{regional_slope_deg:null},{elevation_m:NaN},{coverage_fraction:.5}]){
    assert.equal(model.classifyPolarCell({...gentle,...patch},10).risk,'unknown')
  }
  assert.equal(model.classifyPolarCell(gentle,NaN).risk,'unknown')
})
test('polar selection covers cap and preserves out-of-range coordinates',()=>{
  const c=data.cells.find(c=>c.known&&c.latitude_deg< -85)
  assert.equal(model.findPolarCell(data,c.latitude_deg,c.longitude_deg).id,c.id)
  assert.equal(model.findPolarCell(data,-79,0),null)
  assert.equal(model.findPolarCell(data,-89,NaN),null)
  const center=model.polarCellCenterToLatLon(c.x_m,c.y_m)
  assert.ok(Math.abs(center.latitude_deg-c.latitude_deg)<1e-7)
  assert.ok(Math.abs(center.longitude_deg-c.longitude_deg)<1e-7)
})
test('regional rankings yield distinct geographically separated study candidates',()=>{
  const ranked=model.rankPolarCells(data,10,3,30000)
  assert.equal(ranked.length,3)
  for(let i=0;i<ranked.length;i++){
    assert.ok(['green','yellow'].includes(ranked[i].risk))
    assert.equal(ranked[i].requires_local_analysis,true)
    for(let j=0;j<i;j++){
      assert.ok(Math.hypot(ranked[i].cell.x_m-ranked[j].cell.x_m,ranked[i].cell.y_m-ranked[j].cell.y_m)>=30000)
    }
  }
})
