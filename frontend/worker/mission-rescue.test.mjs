
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import {validateRescueRequest,selectRescueResources,evaluateRescue,searchMissionRescue,createMissionRescueApi,sliceBatch} from './mission-rescue.mjs'
const H=3600000,BASE=Date.parse('2026-12-01T12:30:00Z')
const iso=t=>new Date(t).toISOString().slice(0,19)+'Z'
const request={departure_utc:iso(BASE),date_kind:'landing',surface_hours:2,min_sun_hours:2,min_earth_hours:2,search_days:2}
function resources(){
 const cells=[['flat',2],['steep',15],['unknown',2]].map(([id,slope],i)=>({id,row:0,col:i,latitude_deg:-90,longitude_deg:0,x_m:i*50000,y_m:0,elevation_m:0,regional_slope_deg:slope,max_slope_deg:slope,known:true}))
 return {polar:{source_sha256:'source',cell_spacing_m:4750,cells},globalHorizons:{version:1,observer_height_m:2,azimuth_step_deg:5,radius_m:1737400,source_sha256:'source',quantization_deg:.05,quality:'fixture-angular','profile_encoding':'absolute',cell_ids:cells.map(c=>c.id),profiles_int:cells.map(()=>Array(72).fill(0)),valid_to_min_m:[250000,250000,1000],ray_coverage_min_per_mille:[1000,1000,100]}}
}
function batch(target,start,end,fn=()=>5){
 return {status:'ok',target,meta:{latitude_deg:-90,longitude_deg:0,source:'JPL Horizons',query_url:'https://ssd.jpl.nasa.gov/api/horizons.api?fixture='+target,start_utc:iso(start),end_utc:iso(end)},
 samples:Array.from({length:(end-start)/H+1},(_,i)=>({t_utc:iso(start+i*H),azimuth_deg:0,elevation_deg:fn((start-BASE)/H+i),range_km:target==='Sun'?149597870.7:384400}))}
}
function batches(firstHour=36){
 return {anchor:batch('Earth',BASE,BASE+49*H),sun:batch('Sun',BASE,BASE+50*H),earth:batch('Earth',BASE,BASE+50*H,h=>h>=firstHour?5:-5)}
}
test('Input is bounded and explicit criteria are rejected rather than relaxed',()=>{
 assert.equal(validateRescueRequest(request).search_days,2)
 for(const value of [{...request,search_days:15},{...request,search_days:null},{...request,search_days:true},{...request,search_days:0},{...request,min_sun_hours:3},{...request,departure_utc:'2026-02-30T12:00:00Z'}])assert.throws(()=>validateRescueRequest(value))
})
test('Only measured terrain and known finite horizons form the candidate pool',()=>{
 const r=resources(),before=structuredClone(r),selected=selectRescueResources(r,validateRescueRequest(request).q)
 assert.equal(selected.diagnosis.terrain_eligible_cells,2);assert.equal(selected.diagnosis.horizon_eligible_cells,1)
 assert.deepEqual(selected.resources.polar.cells.map(c=>c.id),['flat']);assert.deepEqual(selected.resources.globalHorizons.cell_ids,['flat'])
 assert.deepEqual(r,before)
 r.globalHorizons.source_sha256='wrong';assert.throws(()=>selectRescueResources(r,validateRescueRequest(request).q))
})
test('Bounded search refines before the first daily solution and preserves minute phase',()=>{
 const result=evaluateRescue(request,resources(),batches())
 assert.equal(result.status,'found');assert.equal(result.proposals[0].delta_hours,36)
 assert.equal(result.proposals[0].proposed_request.departure_utc,'2026-12-03T00:30:00Z')
 assert.equal(result.proposals[0].mission.arrival_utc,'2026-12-03T00:30:00Z')
 assert.equal(result.proposals[0].best.risk,'green');assert.equal(result.proposals[0].best.time_series.length,3)
 assert.equal(result.diagnosis.original_green,0)
 assert.equal(result.diagnosis.blockers.find(b=>b.code==='earth_arrival').count,1)
 assert.equal(result.search.tested_scenarios,26);assert.ok(result.search.tested_offsets_hours.includes(36))
 assert.equal(result.proposals[0].counts_scope,'terrain-and-horizon-eligible-centers')
 for(const proposal of result.proposals){
  assert.equal(proposal.criteria_preserved,true)
  for(const key of ['date_kind','surface_hours','max_slope_deg','min_sun_hours','min_earth_hours','observer_height_m'])assert.equal(proposal.proposed_request[key],result.original_request[key])
 }
})
test('Departure minute phase stays exact while visibility samples follow the rounded whole-hour arrival',async()=>{
 const q={...request,date_kind:'departure'},r=resources(),calls=[]
 let firstArrival
 const result=await searchMissionRescue(q,r,async(target,start,end)=>{
  const a=Date.parse(start),b=Date.parse(end);calls.push({target,start,end})
  if(calls.length===1)return batch('Earth',a,b)
  if(target==='Sun'){firstArrival=a;return batch('Sun',a,b)}
  return batch('Earth',a,b,h=>BASE+h*H>=firstArrival+36*H?5:-5)
 })
 assert.equal(result.status,'found')
 assert.equal(result.proposals[0].proposed_request.departure_utc.slice(14,16),'30')
 assert.equal(result.proposals[0].mission.arrival_utc.slice(14,16),'00')
 assert.equal(calls[0].start.slice(14,16),'30')
 assert.equal(calls[1].start.slice(14,16),'00')
 assert.ok(result.proposals[0].best.time_series.every(s=>s.t_utc.slice(14,16)==='00'))
})
test('An unsolved window stays unsolved and reports its exact finite search',()=>{
 const result=evaluateRescue(request,resources(),batches(1000))
 assert.equal(result.status,'none');assert.deepEqual(result.proposals,[]);assert.deepEqual(result.search.tested_offsets_hours,[0,24,48])
 assert.equal(result.search.first_coarse_passing_offset_hours,undefined)
})
test('Terrain exclusion and missing horizon block time search before any NASA call',async()=>{
 let calls=0;const get=async()=>{calls++;throw new Error('No NASA call expected')}
 const r=resources(),terrain=await searchMissionRescue({...request,max_slope_deg:0},r,get)
 assert.equal(terrain.status,'blocked');assert.equal(terrain.diagnosis.code,'terrain_constraints')
 r.globalHorizons.valid_to_min_m[0]=1000
 const unknown=await searchMissionRescue(request,r,get)
 assert.equal(unknown.diagnosis.code,'insufficient_horizon_data');assert.equal(calls,0)
})
test('Unknown DEM is not falsely diagnosed as an impossible slope',async()=>{
 const r=resources();r.polar.cells.forEach(c=>{c.known=false})
 const result=await searchMissionRescue(request,r,async()=>{throw new Error('Unknown terrain must not call NASA')})
 assert.equal(result.status,'blocked');assert.equal(result.diagnosis.code,'insufficient_terrain_data')
 assert.equal(result.diagnosis.unknown_terrain_cells,3)
})
test('Missing samples, invalid target and source mismatch never produce a proposal',()=>{
 for(const mutate of [b=>b.earth.samples.splice(4,1),b=>{b.sun.meta.latitude_deg=-85},b=>{b.anchor.samples[2].range_km=null}]){
  const b=batches();mutate(b);assert.throws(()=>evaluateRescue(request,resources(),b))
 }
 const b=batches();assert.throws(()=>sliceBatch(b.sun,BASE+H/2,BASE+2*H))
})
test('A real NASA fetch is batched exactly three times, never once per candidate',async()=>{
 let calls=[];const b=batches(),get=async(target,start,end)=>{calls.push([target,start,end]);return calls.length===1?b.anchor:target==='Sun'?b.sun:b.earth}
 const result=await searchMissionRescue(request,resources(),get)
 assert.equal(result.status,'found');assert.equal(calls.length,3)
 assert.deepEqual(calls.map(c=>c[0]),['Earth','Sun','Earth'])
 assert.ok(result.proposals.every(p=>p.sources.length===3))
})
test('Upstream failure propagates without synthetic alternatives',async()=>{
 let calls=0
 await assert.rejects(()=>searchMissionRescue(request,resources(),async()=>{calls++;throw new Error('NASA offline')}),/offline/)
 assert.equal(calls,1)
})
test('HTTP input, methods and body limits fail before NASA inference',async()=>{
 const api=createMissionRescueApi({...resources(),ephemeris:[]})
 assert.equal(await api(new Request('https://test/elsewhere')),null)
 assert.equal((await api(new Request('https://test/api/mission-rescue'))).status,405)
 assert.equal((await api(new Request('https://test/api/mission-rescue',{method:'POST',body:'{}'}))).status,415)
 assert.equal((await api(new Request('https://test/api/mission-rescue',{method:'POST',headers:{'content-type':'application/json'},body:'{"departure_utc":"invalid"}'}))).status,422)
 assert.equal((await api(new Request('https://test/api/mission-rescue',{method:'POST',headers:{'content-type':'application/json'},body:'x'.repeat(17000)}))).status,413)
})
test('Original NASA December scenario finds genuine alternatives offline and applying the first also passes',async t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw new Error('Offline validation must use original prepared NASA records.')})
 const read=async p=>JSON.parse(await readFile(new URL('../../data/'+p,import.meta.url),'utf8'))
 const actual={polar:await read('prepared/polar_screening.json'),globalHorizons:await read('prepared/global_horizons.json'),ephemeris:[]}
 for(const name of await readdir(new URL('../../data/prepared/ephemeris/',import.meta.url)))if(name.endsWith('.json'))actual.ephemeris.push(await read('prepared/ephemeris/'+name))
 const expected=await read('prepared/rescue_example.json')
 const response=await createMissionRescueApi(actual)(new Request('https://test/api/mission-rescue',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(expected.request)}))
 assert.equal(response.status,200);const result=await response.json()
 assert.equal(result.status,'found');assert.equal(result.proposals[0].delta_hours,146);assert.equal(result.proposals[0].best.id,'polar:32:95')
 assert.equal(result.diagnosis.original_green,0);assert.equal(result.diagnosis.horizon_eligible_cells,1832)
 assert.deepEqual(result.search.tested_offsets_hours,expected.search.tested_offsets_hours)
 assert.equal(result.meta.sources.length,3);assert.ok(result.meta.sources.every(s=>s.cache_hit))
 const {createAutomaticPlanApi}=await import('./automatic-plan.mjs')
 const applied=await createAutomaticPlanApi(actual)(new Request('https://test/api/automatic-plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(result.proposals[0].proposed_request)}))
 assert.equal(applied.status,200);const plan=await applied.json()
 assert.equal(plan.best.id,result.proposals[0].best.id);assert.equal(plan.best.risk,'green');assert.equal(plan.counts.green,1)
 assert.deepEqual(plan.mission,result.proposals[0].mission)
})

test('Rescue preserves a supported vehicle profile and can never switch an unsupported tall profile back to two metres',async()=>{
 const r=resources(),profile={lander_name:'Hypothetical reference vehicle',solar_panel_height:2,antenna_height:2,center_of_gravity_tolerance:8}
 const result=evaluateRescue({...request,max_slope_deg:10,vehicle_profile:profile},r,batches())
 assert.equal(result.status,'found');assert.deepEqual(result.original_request.vehicle_profile,profile)
 assert.equal(result.original_request.max_slope_deg,10);assert.equal(result.original_request.effective_max_slope_deg,8)
 for(const proposal of result.proposals){assert.deepEqual(proposal.proposed_request.vehicle_profile,profile);assert.equal(proposal.proposed_request.max_slope_deg,10)}
 let calls=0
 const tall={...profile,solar_panel_height:50,antenna_height:38}
 const blocked=await searchMissionRescue({...request,vehicle_profile:tall},r,async()=>{calls++;throw new Error('Unsupported height must not query NASA')})
 assert.equal(blocked.status,'blocked');assert.equal(blocked.diagnosis.code,'unsupported_observer_height')
 assert.equal(blocked.diagnosis.height_support.supported,false);assert.equal(blocked.diagnosis.height_support.profile_height_m,2)
 assert.deepEqual(blocked.original_request.vehicle_profile,tall);assert.deepEqual(blocked.proposals,[]);assert.equal(calls,0)
})
