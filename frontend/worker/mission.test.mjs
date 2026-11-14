import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import {existsSync} from 'node:fs'
import {createScienceApi} from './science.mjs'
import {createMissionApi} from './mission.mjs'
const data=[new URL('../../data/',import.meta.url),new URL('../data/',import.meta.url)].find(p=>existsSync(new URL('catalog/sites.json',p)))
const read=async path=>JSON.parse(await readFile(new URL(path,data),'utf8'))
const sites=await read('catalog/sites.json'),horizon=await read('prepared/horizon_profiles.json'),terrain={},ephemeris=[]
for(const site of sites.sites)terrain[site.id]=await read(`prepared/${site.id}-terrain.json`)
for(const path of await readdir(new URL('prepared/ephemeris/',data)))if(path.endsWith('.json'))ephemeris.push(await read('prepared/ephemeris/'+path))
const resources={sites,horizon,terrain,ephemeris}
const api=createMissionApi(resources,createScienceApi(resources))
const post=(route,body)=>api(new Request('https://test.local/api/'+route,{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json'}}))
test('POST Earth preserves main contract using exact NASA coordinates and measured range',async()=>{
  const response=await post('earth',{})
  assert.equal(response.status,200)
  const body=await response.json()
  assert.equal(body.samples.length,72)
  assert.equal(body.site.lat_deg,sites.sites[1].latitude_deg)
  assert.equal(body.provenance.cache_hit,true)
  assert.ok(body.samples.every(s=>s.range_km>300000&&s.range_km<500000))
  assert.ok(body.samples.some(s=>s.range_km!==body.samples[0].range_km))
  assert.equal(body.terrain_mesh_3d.grid_size,65)
  assert.equal(body.metrics.earth_visible_hours+body.blackout_windows.reduce((h,w)=>h+w.duration_hours,0),72)
})
test('Comparison and delay use identical NASA grids and recomputed windows',async()=>{
  const base=await (await post('compare',{minimum_solar_hours:48,minimum_earth_visible_hours:48})).json()
  const response=await post('compare',{delay_hours:12,minimum_solar_hours:48,minimum_earth_visible_hours:48})
  assert.equal(response.status,200)
  const shifted=await response.json()
  assert.equal(shifted.sites.length,2)
  assert.equal(shifted.effective_start_utc,'2026-12-14T12:00:00Z')
  for(const site of shifted.sites){
    assert.equal(site.samples.length,72)
    assert.notDeepEqual(site.samples,base.sites.find(s=>s.site.site_id===site.site.site_id).samples)
    assert.equal(site.overlap_solar_earth_hours,site.samples.filter(s=>s.joint_visible).length)
    assert.equal(shifted.delay_sensitivity.find(d=>d.site_id===site.site.site_id).delta_earth_visible_hours,site.earth_visible_hours-base.sites.find(s=>s.site.site_id===site.site.site_id).earth_visible_hours)
  }
})
test('Terrain POST uses shared partial profiles without substituting flat horizon',async()=>{
  const body=await (await post('earth',{horizon_mode:'terrain'})).json()
  assert.equal(body.quality,'degraded')
  assert.equal(body.provenance.effective_horizon_mode,'terrain')
  assert.ok(body.horizon_profile.some(p=>p.horizon_elevation_deg!==0))
})
test('Invalid mission parameters cannot yield fabricated results',async()=>{
  for(const query of [{site_id:'unknown'},{delay_hours:25},{clearance_deg:-1},{site_ids:['site01','site01']},{step_minutes:0}]){
    const response=await post(query.site_ids?'compare':'earth',query)
    assert.equal(response.status,422)
    assert.equal((await response.json()).status,'unavailable')
  }
})
