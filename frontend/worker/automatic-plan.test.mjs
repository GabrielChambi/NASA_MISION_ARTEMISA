import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import {validatePlanRequest,bodyPosition,estimateTransfer,missionTiming,evaluateGlobalPlan,decodeProfile,horizonValue,createAutomaticPlanApi,evaluatePlanCell,stereographicCellArea,horizonSensitivity} from './automatic-plan.mjs'
const read=async name=>JSON.parse(await readFile(new URL('../../data/'+name,import.meta.url),'utf8'))
const q={departure_utc:'2026-12-25T12:00:00Z',date_kind:'landing',surface_hours:2,min_sun_hours:2,min_earth_hours:2}
const transfer={transfer_hours:107.4,method:'TWO_BODY_ESTIMATE',assumptions:['Ideal, no launch solution.']}
function fixtures(){
 const sample=(i,el)=>({t_utc:new Date(Date.parse(q.departure_utc)+i*3600000).toISOString().replace('.000Z','Z'),azimuth_deg:0,elevation_deg:el,range_km:384400})
 const sky={sun:{status:'ok',target:'Sun',meta:{latitude_deg:-90,longitude_deg:0,query_url:'https://ssd.jpl.nasa.gov/api/horizons.api?sun'},samples:[sample(0,5),sample(1,5),sample(2,-20)]},earth:{status:'ok',target:'Earth',meta:{latitude_deg:-90,longitude_deg:0,query_url:'https://ssd.jpl.nasa.gov/api/horizons.api?earth'},samples:[sample(0,8),sample(1,8),sample(2,-20)]}}
 const cells=[['flat',2],['blocked',2],['unknown',2],['steep',15]].map(([id,slope],i)=>({id,latitude_deg:-90,longitude_deg:0,elevation_m:0,regional_slope_deg:slope,max_slope_deg:slope,x_m:i*50000,y_m:0,known:true}))
 const resources={polar:{source_sha256:'source',cell_spacing_m:4750,cells},globalHorizons:{version:1,observer_height_m:2,azimuth_step_deg:5,source_sha256:'source',quantization_deg:.05,radius_m:1737400,quality:'sampled-regional-partial',profile_encoding:'delta',near_coverage_required_m:2000,cell_ids:cells.map(c=>c.id),profiles_int:[Array(72).fill(0),[1000,...Array(71).fill(0)],Array(72).fill(0),Array(72).fill(0)],ray_coverage_min_per_mille:[1000,1000,90,1000],valid_to_min_m:[250000,250000,10000,250000]}}
 return {resources,sky}
}
test('Strict date, bounded criteria, and invalid values fail before NASA is queried',async()=>{
 assert.equal(validatePlanRequest({departure_utc:'2026-12-25T12:00:00Z'}).surface_hours,72)
 for(const bad of [{departure_utc:'2026-02-30T12:00:00Z'},{departure_utc:'2026-12-25T12:00:00-04:00'},{departure_utc:'2026-12-25T12:00:01Z'},{...q,surface_hours:true},{...q,max_slope_deg:NaN},{...q,observer_height_m:5}])assert.throws(()=>validatePlanRequest(bad))
 const api=createAutomaticPlanApi({ephemeris:[]})
 const response=await api(new Request('https://test/api/automatic-plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...q,departure_utc:'invalid'})}))
 assert.equal(response.status,422)
 assert.equal((await api(new Request('https://test/api/automatic-plan'))).status,405)
})
test('Transit uses measured range and labelled half-ellipse; departure and landing dates differ',()=>{
 const t=estimateTransfer({azimuth_deg:0,elevation_deg:0,range_km:384400})
 assert.equal(t.method,'TWO_BODY_ESTIMATE');assert.ok(t.transfer_hours>100&&t.transfer_hours<140)
 const m=missionTiming(validatePlanRequest({...q,date_kind:'departure'}),transfer)
 assert.equal(m.departure_utc,q.departure_utc);assert.equal(m.arrival_utc,'2026-12-30T00:00:00Z');assert.ok(Math.abs(m.arrival_rounding_minutes-36)<1e-8)
 assert.equal(missionTiming(validatePlanRequest(q),transfer).arrival_utc,q.departure_utc)
 assert.throws(()=>estimateTransfer({azimuth_deg:0,elevation_deg:0,range_km:1}))
})
test('Reference vector reconstruction respects local ENU and lunar radius',()=>{
 const p=bodyPosition({azimuth_deg:90,elevation_deg:0,range_km:1})
 assert.ok(Math.abs(p[0])<1e-6);assert.ok(Math.abs(p[1]-1000)<1e-6);assert.ok(Math.abs(p[2]+1737402)<1e-6)
 const r=bodyPosition({azimuth_deg:0,elevation_deg:90,range_km:1},{latitude_deg:0,longitude_deg:90,elevation_m:10})
 assert.ok(Math.abs(r[1]-1738412)<1e-6)
})
test('Delta profiles preserve integer geometry and circular interpolation',()=>{
 assert.deepEqual(decodeProfile([10,...Array(71).fill(1)],'delta'),Array.from({length:72},(_,i)=>10+i))
 const p=Array(72).fill(0);p[0]=20
 assert.equal(horizonValue(p,0),1);assert.equal(horizonValue(p,357.5),.5);assert.equal(horizonValue(p,-2.5),.5)
 assert.equal(decodeProfile(null,'delta'),null)
})
test('Whole-cap classification uses each terrain horizon, preserves unknowns, and excludes endpoint duration',()=>{
 const {resources,sky}=fixtures(),r=evaluateGlobalPlan(q,resources,sky,transfer)
 assert.deepEqual(r.counts,{green:1,yellow:0,red:2,unknown:1});assert.equal(r.total_cells,4);assert.equal(r.best.id,'flat')
 assert.equal(r.best.sun_hours,2);assert.equal(r.best.time_series.length,3);assert.equal(r.best.time_series[2].sun_elevation_deg,-20)
 assert.equal(r.cells.find(c=>c.id==='blocked').sun_hours,0)
 assert.match(r.cells.find(c=>c.id==='unknown').reason,/20 km/)
 assert.equal(r.cells.find(c=>c.id==='steep').sun_hours,2)
 assert.equal(r.closest_candidate,null)
})
test('No candidate passes: failed site stays red and appears only as closest_candidate',()=>{
 const {resources,sky}=fixtures();resources.globalHorizons.profiles_int[0]=[1000,...Array(71).fill(0)]
 const r=evaluateGlobalPlan(q,resources,sky,transfer)
 assert.equal(r.best,null);assert.deepEqual(r.alternatives,[]);assert.equal(r.closest_candidate.risk,'red');assert.ok(r.closest_candidate.reasons.length)
})
test('Each candidate receives its own north basis instead of the reference-pole elevation',()=>{
 const {resources,sky}=fixtures();resources.polar.cells[0].latitude_deg=-80
 const r=evaluateGlobalPlan(q,resources,sky,transfer)
 assert.ok(Math.abs(r.best.time_series[0].sun_elevation_deg-15)<.1)
})
test('Misaligned NASA time grids and mismatched terrain sources are rejected',()=>{
 const {resources,sky}=fixtures();sky.sun.samples[1].t_utc=sky.sun.samples[0].t_utc
 assert.throws(()=>evaluateGlobalPlan(q,resources,sky,transfer),/alineada/)
 const f=fixtures();f.resources.globalHorizons.source_sha256='wrong'
 assert.throws(()=>evaluateGlobalPlan(q,f.resources,f.sky,transfer),/horizontes/)
})
test('Actual NASA Christmas departure runs offline through the complete Worker pipeline',async()=>{
 const resources={polar:await read('prepared/polar_screening.json'),globalHorizons:await read('prepared/global_horizons.json'),ephemeris:[]}
 const expected=await read('prepared/automatic_example.json')
 for(const name of await readdir(new URL('../../data/prepared/ephemeris/',import.meta.url)))if(name.endsWith('.json'))resources.ephemeris.push(await read('prepared/ephemeris/'+name))
 const response=await createAutomaticPlanApi(resources)(new Request('https://test/api/automatic-plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(expected.request)}))
 assert.equal(response.status,200);const result=await response.json()
 assert.deepEqual(result.counts,expected.counts);assert.equal(result.best.id,expected.best.id);assert.equal(result.mission.arrival_utc,expected.mission.arrival_utc)
 assert.equal(result.total_cells,12892);assert.equal(result.best.sun_hours,expected.best.sun_hours);assert.equal(result.best.earth_hours,expected.best.earth_hours)
 assert.equal(result.meta.sources.length,3);assert.ok(result.meta.sources.every(s=>s.cache_hit&&s.query_url.includes('QUANTITIES=%274%2C20%27')))
 assert.equal(result.best.time_series.length,73);assert.equal(result.best.horizon_quality,'sampled-regional-partial')
 assert.ok(JSON.stringify(result).length<18000000)
})

test('Angular sampling sensitivity preserves nominal passes as yellow instead of claiming robustness',()=>{
 const {resources,sky}=fixtures()
 resources.globalHorizons.profile_encoding='absolute'
 resources.globalHorizons.profiles_int[0]=[0,160,...Array(70).fill(0)]
 const result=evaluateGlobalPlan(q,resources,sky,transfer),cell=result.cells.find(c=>c.id==='flat')
 assert.equal(cell.risk,'yellow')
 assert.equal(cell.nominal_pass,true)
 assert.equal(cell.sensitivity_pass,false)
 assert.equal(cell.sun_hours,2)
 assert.deepEqual(cell.sun_hours_sensitivity,{lower:0,upper:2})
 assert.ok(cell.arrival_margin_sensitivity.sun_lower_deg<0)
 assert.equal(result.best,null)
 assert.equal(result.closest_candidate.risk,'yellow')
 assert.match(result.meta.sensitivity_method,/scenario sensitivity, not physical uncertainty bounds/)
})
test('Quantization and circular adjacent bins expose a bounded sampling scenario without hiding narrow-peak limitations',()=>{
 const profile=Array(72).fill(0);profile[0]=20;profile[1]=60
 assert.deepEqual(horizonSensitivity(profile,2.5),{nominal:2,lower:.95,upper:3})
 assert.deepEqual(horizonSensitivity(profile,357.5),{nominal:.5,lower:-.05,upper:1})
 assert.equal(horizonSensitivity(null,0),null)
 const {resources,sky}=fixtures();resources.polar.cells[0].max_slope_deg=40
 const r=evaluateGlobalPlan(q,resources,sky,transfer)
 assert.equal(r.best.risk,'green','A P95 regional criterion must not silently become a maximum-slope criterion')
 assert.equal(r.best.max_slope_deg,40,'The local-refinement warning must have the maximum native slope available')
 assert.match(r.meta.screening_unit,/not a resolved landing footprint/)
})
test('Inspecting a nonsuggested cell computes that cell only and includes its own complete time series',()=>{
 const {resources,sky}=fixtures(),cellId='steep'
 const result=evaluatePlanCell(q,resources,sky,transfer,cellId)
 assert.equal(result.cell.id,cellId)
 assert.equal(result.cell.risk,'red')
 assert.equal(result.cell.sun_hours,2)
 assert.equal(result.cell.time_series.length,3)
 assert.equal(result.cells,undefined)
 assert.ok(result.cell.reasons.some(reason=>reason.includes('Pendiente')))
 const unknown=evaluatePlanCell(q,resources,sky,transfer,'unknown')
 assert.equal(unknown.cell.risk,'unknown')
 assert.deepEqual(unknown.cell.time_series,[])
 assert.throws(()=>evaluatePlanCell(q,resources,sky,transfer,'no-cell'),/catálogo/)
 resources.polar.cells.push({id:'fringe',latitude_deg:-79.99,longitude_deg:0,x_m:0,y_m:304000,elevation_m:null,known:false})
 const edge=evaluatePlanCell(q,resources,sky,transfer,'fringe')
 assert.equal(edge.cell.risk,'unknown')
 assert.deepEqual(edge.cell.time_series,[])
})
test('Spherical clipped-cell area conserves cap area and keeps the unrepresented edge unknown',async()=>{
 const polar=await read('prepared/polar_screening.json')
 const cap=2*Math.PI*1737400**2*(1-Math.sin(80*Math.PI/180))/1e6
 const actual=polar.cells.reduce((sum,c)=>sum+stereographicCellArea(c.x_m,c.y_m,polar.cell_spacing_m),0)
 assert.ok(Math.abs(actual-(cap-.054393))<.01,'Clipped area matches independent high-order quadrature including the tiny cardinal gaps')
 const {resources,sky}=fixtures(),result=evaluateGlobalPlan(q,resources,sky,transfer)
 const areaSum=Object.values(result.coverage.by_class).reduce((sum,c)=>sum+c.area_km2,0)
 assert.ok(Math.abs(areaSum-result.coverage.cap_area_km2)<.003)
 assert.ok(result.coverage.unrepresented_area_km2>0)
 assert.ok(result.coverage.by_class.unknown.area_km2>result.cells.find(c=>c.risk==='unknown').area_km2)
 assert.ok(stereographicCellArea(0,0,4750)>stereographicCellArea(200000,0,4750))
 assert.equal(stereographicCellArea(700000,0,4750),0)
 assert.ok(stereographicCellArea(0,304000,4750)>0)
})
test('Cell endpoint rejects unknown catalog IDs before NASA and returns a prepared real cell independently',async()=>{
 const resources={polar:await read('prepared/polar_screening.json'),globalHorizons:await read('prepared/global_horizons.json'),ephemeris:[]}
 for(const name of await readdir(new URL('../../data/prepared/ephemeris/',import.meta.url)))if(name.endsWith('.json'))resources.ephemeris.push(await read('prepared/ephemeris/'+name))
 const api=createAutomaticPlanApi(resources),example=await read('prepared/automatic_example.json')
 const request=body=>new Request('https://test/api/automatic-plan/cell',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
 assert.equal((await api(request({...example.request,cell_id:'not-in-catalog'}))).status,404)
 const response=await api(request({...example.request,cell_id:'polar:64:64'}))
 assert.equal(response.status,200)
 const result=await response.json()
 assert.equal(result.cell.id,'polar:64:64')
 assert.equal(result.cell.time_series.length,73)
 assert.equal(result.cells,undefined)
 assert.ok(result.meta.sources.every(s=>s.cache_hit))
})

test('Vehicle tolerance can only tighten the user slope constraint and profile normalization is stable',()=>{
 const loose=validatePlanRequest({...q,max_slope_deg:4,vehicle_profile:{lander_name:'Hypothetical X',solar_panel_height:2,antenna_height:2,center_of_gravity_tolerance:25}})
 assert.equal(loose.max_slope_deg,4);assert.equal(loose.effective_max_slope_deg,4)
 assert.deepEqual(validatePlanRequest(loose),loose)
 const strict=validatePlanRequest({...q,max_slope_deg:10,vehicle_profile:{lander_name:'Hypothetical X',solar_panel_height:2,antenna_height:2,center_of_gravity_tolerance:1}})
 assert.equal(strict.max_slope_deg,10);assert.equal(strict.effective_max_slope_deg,1)
 const {resources,sky}=fixtures(),result=evaluateGlobalPlan(strict,resources,sky,transfer)
 assert.equal(result.best,null);assert.equal(result.counts.green,0);assert.equal(result.cells.find(c=>c.id==='flat').risk,'red')
 assert.equal(result.meta.requested_max_slope_deg,10);assert.equal(result.meta.effective_max_slope_deg,1)
})
test('Unprepared vehicle heights stay unknown instead of using an invented obstacle-distance clearance',()=>{
 const {resources,sky}=fixtures()
 const custom={...q,vehicle_profile:{lander_name:'Hypothetical tall lander',solar_panel_height:50,antenna_height:38,center_of_gravity_tolerance:8}}
 const result=evaluateGlobalPlan(custom,resources,sky,transfer)
 assert.equal(result.best,null);assert.equal(result.closest_candidate,null)
 assert.equal(result.counts.green,0);assert.equal(result.counts.yellow,0);assert.equal(result.counts.unknown,4)
 assert.equal(result.meta.height_support.supported,false);assert.equal(result.meta.height_support.profile_height_m,2)
 assert.equal(result.vehicle_profile.solar_panel_height,50);assert.equal(result.vehicle_profile.antenna_height,38)
 assert.ok(result.cells.every(c=>c.sun_hours===null&&c.earth_hours===null&&c.risk==='unknown'))
 const cell=evaluatePlanCell(custom,resources,sky,transfer,'flat')
 assert.deepEqual(cell.cell.time_series,[]);assert.equal(cell.cell.diagnostics.height_support.supported,false)
 assert.equal(cell.cell.diagnostics.starship_would_survive,undefined)
})
test('Prepared two-metre diagnostics report sampled obstruction without survival claims',()=>{
 const {resources,sky}=fixtures(),result=evaluatePlanCell(q,resources,sky,transfer,'blocked')
 assert.equal(result.cell.diagnostics.first_sun_block_hour,0)
 assert.equal(result.cell.diagnostics.first_sun_block_cardinal,'norte')
 assert.equal(result.cell.diagnostics.clearance_threshold_deg,.3)
 assert.equal(result.cell.diagnostics.base_in_shadow_while_panels_lit_hours,null)
 assert.equal(result.cell.diagnostics.vehicle_comparison_status,'not_computed')
 assert.equal(result.cell.diagnostics.starship_would_survive,undefined)
 assert.ok(result.cell.time_series.every(s=>s.sun_horizon_deg===s.base_sun_horizon_deg))
})
