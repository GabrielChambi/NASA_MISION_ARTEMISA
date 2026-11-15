import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile,readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { createLandingApi } from './landing.mjs'
const bundled=await build({entryPoints:[fileURLToPath(new URL('../src/features/tactical/windowPlanner.ts',import.meta.url))],bundle:true,write:false,format:'esm',platform:'node'})
const planner=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text+'\n//# sourceURL=windowPlanner.test.js').toString('base64'))
const H=3600000,START=Date.parse('2026-12-14T00:00:00Z')
const iso=t=>new Date(t).toISOString().replace('.000Z','Z')
const origin={id:'test-cell',ix:0,iy:0,x_m:0,y_m:0,latitude_deg:-89.5,longitude_deg:0,elevation_m:0,slope_deg:3,max_slope_deg:3,relief_m:1,height_uncertainty_m:.2,known:true,horizon_deg:Array(360).fill(0),ray_coverage_fraction:1}
const limits={maxSlope:10,maxRelief:5,sunMargin:.2,earthMargin:.2,minSunHours:24,minEarthHours:22}
const body=(target,startHour,endHour,fn)=>({status:'ok',meta:{query_url:'https://ssd.jpl.nasa.gov/api/horizons.api?test_fixture='+target,retrieved_at:'fixture',latitude_deg:origin.latitude_deg,longitude_deg:origin.longitude_deg,cell_id:origin.id,limitations:['Synthetic fixture for algorithm tests only.']},samples:Array.from({length:endHour-startHour+1},(_,i)=>{const h=startHour+i,e=fn(h);return {t_utc:iso(START+h*H),azimuth_deg:90,elevation_deg:e,horizon_deg:0,range_km:target==='Sun'?150000000:380000,visible:e>0}})})
const sun=body('Sun',-2,38,()=>2),earth=body('Earth',-2,38,h=>h>=7?2:-1)
const run={origin,region:{id:'fixture'},sun:{...sun,samples:sun.samples.slice(2,27)},earth:{...earth,samples:earth.samples.slice(2,27)},limits,createdAt:'fixture',key:'fixture'}

test('bounded search distinguishes earliest passing start from five-case temporal robustness',()=>{
  const report=planner.searchMissionWindows(run,sun,earth)
  assert.equal(report.status,'ok');assert.equal(report.candidates.length,13)
  assert.deepEqual(report.searchedStartShiftHours,[0,1,2,3,4,5,6,7,8,9,10,11,12])
  assert.equal(report.firstPassing.shiftHours,7)
  assert.equal(report.firstRobust.shiftHours,9)
  assert.deepEqual(report.alternatives.map(c=>c.shiftHours),[7,8,9])
  assert.equal(report.candidates[7].robustStatus,'fails')
  assert.equal(report.candidates[9].robustCases.length,5)
  assert.equal(report.candidates[9].worstEarthHours,24)
  assert.equal(report.sources[0].queryUrl,sun.meta.query_url)
  assert.equal(report.sources[0].startUtc,sun.samples[0].t_utc)
})
test('static terrain failures block time search before any NASA requests; unknown terrain is distinct',async()=>{
  let calls=0
  const fetcher=async()=>{calls++;throw new Error('No request expected')}
  const steep={...run,origin:{...origin,max_slope_deg:12}}
  const blocked=await planner.fetchWindowSearch(steep,new AbortController().signal,fetcher)
  assert.equal(blocked.status,'blocked');assert.match(blocked.reasons[0],/Cambiar la fecha no corrige la pendiente/)
  assert.equal(blocked.candidates.length,0);assert.equal(calls,0)
  const missing=planner.searchMissionWindows({...run,origin:{...origin,known:false}},sun,earth)
  assert.equal(missing.status,'unknown');assert.equal(missing.firstPassing,null)
})
test('all requirements remain mandatory, equality at celestial margin is blocked',()=>{
  const changed={...run,limits:{...limits,minSunHours:24}}
  const blockedSun=body('Sun',-2,38,()=>.2)
  const before=JSON.stringify(changed.limits)
  const result=planner.searchMissionWindows(changed,blockedSun,earth)
  assert.equal(result.firstPassing,null)
  assert.ok(result.candidates.every(c=>c.status==='fails'))
  assert.equal(JSON.stringify(changed.limits),before)
  const missing=planner.searchMissionWindows({...run,limits:{...limits,minSunHours:undefined}},sun,earth)
  assert.equal(missing.status,'unknown')
})
test('incomplete robustness coverage remains unknown, not a passing margin',()=>{
  const crop={...sun,samples:sun.samples.slice(2)},cropEarth={...earth,samples:earth.samples.slice(2)}
  const report=planner.searchMissionWindows(run,crop,cropEarth)
  assert.equal(report.candidates[0].robustStatus,'unknown')
  assert.equal(report.candidates[0].robustCases[0].status,'unknown')
  assert.equal(report.firstRobust.shiftHours,9)
})
test('nonfinite or misaligned NASA source series produces no solutions',()=>{
  const bad=structuredClone(sun);bad.samples[5].range_km=NaN
  const report=planner.searchMissionWindows(run,bad,earth)
  assert.equal(report.status,'unknown');assert.equal(report.candidates.length,0)
  const shifted=structuredClone(earth);shifted.samples[5].t_utc=shifted.samples[6].t_utc
  assert.equal(planner.searchMissionWindows(run,sun,shifted).status,'unknown')
})
test('NASA is queried once per body over extended bounds and sequentially, never once per candidate',async()=>{
  const calls=[],phases=[]
  let active=false
  const fetcher=async url=>{
    assert.equal(active,false);active=true
    const u=new URL(url,'http://test')
    calls.push(u)
    const value=u.searchParams.get('target')==='Sun'?sun:earth
    await Promise.resolve();active=false
    return Response.json(value)
  }
  const report=await planner.fetchWindowSearch(run,new AbortController().signal,fetcher,body=>phases.push(body))
  assert.deepEqual(phases,['Sun','Earth']);assert.equal(calls.length,2)
  assert.equal(calls[0].searchParams.get('start_utc'),iso(START-2*H))
  assert.equal(calls[0].searchParams.get('end_utc'),iso(START+38*H))
  assert.equal(report.candidates.length,13)
})
test('upstream failure and cancellation cannot turn into fabricated alternatives',async()=>{
  const failed=()=>Promise.resolve(Response.json({message:'NASA unavailable'},{status:503}))
  await assert.rejects(()=>planner.fetchWindowSearch(run,new AbortController().signal,failed),/NASA unavailable/)
  const ac=new AbortController()
  let calls=0
  const cancelled=async()=>{calls++;ac.abort();return Response.json(calls===1?sun:earth)}
  await assert.rejects(()=>planner.fetchWindowSearch(run,ac.signal,cancelled),/cancelada/)
})
const dataRoot=new URL('../../data/',import.meta.url)
const json=async name=>JSON.parse(await readFile(new URL(name,dataRoot),'utf8'))
const landing=await json('prepared/landing_surface.json')
const ephemeris=await Promise.all((await readdir(new URL('prepared/ephemeris/',dataRoot))).filter(n=>n.endsWith('.json')).map(n=>json('prepared/ephemeris/'+n)))
const api=createLandingApi({landing,ephemeris})
const real=async target=>{
  const p=new URLSearchParams({cell_id:'site01:10:10',target,start_utc:iso(START),end_utc:iso(START+72*H),step_minutes:'60'})
  const response=await api(new Request('http://test/api/landing/ephemeris?'+p))
  assert.equal(response.status,200)
  return response.json()
}
test('real NASA stored samples agree with an independent half-open hourly calculation',async()=>{
  const s=await real('Sun'),e=await real('Earth')
  const region=landing.regions[0],cell=region.cells.find(c=>c.id==='site01:10:10')
  const min={maxSlope:45,maxRelief:50,sunMargin:.2,earthMargin:.2,minSunHours:10,minEarthHours:2}
  const r={origin:cell,region,limits:min,key:'actual NASA',createdAt:'actual NASA',sun:{...s,samples:s.samples.slice(36,49)},earth:{...e,samples:e.samples.slice(36,49)}}
  const report=planner.searchMissionWindows(r,s,e)
  assert.equal(report.status,'ok')
  for(const candidate of report.candidates){
    const start=36+candidate.shiftHours
    const sunHours=s.samples.slice(start,start+12).filter(v=>v.elevation_deg-v.horizon_deg>min.sunMargin).length
    const earthHours=e.samples.slice(start,start+12).filter(v=>v.elevation_deg-v.horizon_deg>min.earthMargin).length
    assert.equal(candidate.sunHours,sunHours);assert.equal(candidate.earthHours,earthHours)
    const pass=sunHours>=10&&earthHours>=2&&s.samples[start].elevation_deg-s.samples[start].horizon_deg>.2&&e.samples[start].elevation_deg-e.samples[start].horizon_deg>.2
    assert.equal(candidate.status,pass?'meets':'fails')
  }
  assert.equal(report.sources[0].startUtc,iso(START))
  assert.equal(report.sources[0].endUtc,iso(START+72*H))
  assert.equal(report.sources[0].queryUrl,s.meta.query_url)
})
