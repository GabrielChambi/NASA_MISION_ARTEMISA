import { readFile } from 'node:fs/promises'
import { transform } from 'esbuild'
import { test } from 'node:test'
import assert from 'node:assert/strict'
async function load(name) {
  const source = await readFile(new URL('../src/features/mission/'+name+'.ts', import.meta.url),'utf8')
  const { code } = await transform(source,{loader:'ts',format:'esm',target:'es2022'})
  return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
}
const {simulateDescent,DEFAULT_DESCENT,gravityAt,MOON_GM,MOON_RADIUS,STANDARD_GRAVITY,descentAt} = await load('descentPhysics')
const {analyzeStudy,rankStudies} = await load('missionAnalysis')
test('JPL lunar gravity uses inverse square law and measured ground elevation',()=>{
  assert.equal(gravityAt(0,0),MOON_GM/MOON_RADIUS**2)
  assert.ok(Math.abs(gravityAt(0,0)-1.6249)<0.001)
  assert.ok(gravityAt(2000,1000)<gravityAt(0,1000))
})
test('default vehicle makes a powered contact with changing thrust, velocity and mass',()=>{
  const run=simulateDescent({...DEFAULT_DESCENT,surfaceElevationM:1944.767})
  assert.equal(run.outcome,'soft-touchdown');assert.ok(run.durationS>60&&run.durationS<300)
  assert.ok(run.impactSpeedMps>0&&run.impactSpeedMps<1.2)
  assert.equal(run.samples.at(-1).altitudeM,0)
  assert.ok(run.fuelUsedKg>0&&run.fuelUsedKg<6000)
  assert.ok(new Set(run.samples.map(s=>s.thrustN.toFixed(1))).size>100)
  assert.ok(run.samples.every(s=>s.massKg>=DEFAULT_DESCENT.dryMassKg&&s.throttle>=0&&s.throttle<=1))
})
test('propellant equals integral of thrust / (Isp g0), including partial touchdown step',()=>{
  const run=simulateDescent(DEFAULT_DESCENT)
  const used=run.samples.slice(1).reduce((n,s,i)=>n+s.thrustN/(DEFAULT_DESCENT.ispS*STANDARD_GRAVITY)*(s.timeS-run.samples[i].timeS),0)
  assert.ok(Math.abs(used-run.fuelUsedKg)<1e-6)
})
test('zero thrust matches independent radial free-fall energy, classified as impact',()=>{
  const c={...DEFAULT_DESCENT,maxThrustN:0,downwardSpeedMps:0}
  const run=simulateDescent(c)
  const predicted=Math.sqrt(2*MOON_GM*(1/MOON_RADIUS-1/(MOON_RADIUS+c.altitudeM)))
  assert.equal(run.outcome,'hard-impact')
  assert.ok(Math.abs(run.impactSpeedMps-predicted)<1e-6)
  assert.equal(run.fuelUsedKg,0)
})
test('fuel exhaustion cuts propulsion exactly and never burns dry mass',()=>{
  const c={...DEFAULT_DESCENT,wetMassKg:6001,dryMassKg:6000}
  const run=simulateDescent(c)
  assert.equal(run.outcome,'hard-impact');assert.equal(run.fuelExhausted,true)
  assert.ok(Math.abs(run.fuelUsedKg-1)<1e-9)
  assert.ok(run.samples.filter(s=>s.fuelKg===0).slice(1).every(s=>s.thrustN===0))
})
test('weak engine cannot create a false soft touchdown',()=>{
  const run=simulateDescent({...DEFAULT_DESCENT,maxThrustN:5000})
  assert.equal(run.outcome,'hard-impact');assert.ok(run.impactSpeedMps>25)
})
test('time-step halving gives convergent touchdown time, fuel and speed',()=>{
  const a=simulateDescent(DEFAULT_DESCENT,0.1),b=simulateDescent(DEFAULT_DESCENT,0.05)
  assert.ok(Math.abs(a.durationS-b.durationS)<0.15)
  assert.ok(Math.abs(a.impactSpeedMps-b.impactSpeedMps)<0.1)
  assert.ok(Math.abs(a.fuelUsedKg-b.fuelUsedKg)<0.3)
})
test('invalid inputs fail without fabricated telemetry and replay uses bounded samples',()=>{
  assert.throws(()=>simulateDescent({...DEFAULT_DESCENT,wetMassKg:1}))
  assert.throws(()=>simulateDescent({...DEFAULT_DESCENT,ispS:NaN}))
  assert.throws(()=>simulateDescent(DEFAULT_DESCENT,0))
  const run=simulateDescent(DEFAULT_DESCENT)
  assert.equal(descentAt(run,1e6),run.samples.at(-1))
  assert.equal(descentAt(run,-1),run.samples[0])
})
const rules={minimumSunHours:1,minimumEarthHours:1,maxSlopeDeg:10,earthClearanceDeg:0}
function series(elevations) {
  return {samples:elevations.map((e,i)=>({t_utc:new Date(Date.UTC(2026,11,14,i)).toISOString(),elevation_deg:e,horizon_deg:0,azimuth_deg:100,visible:e>0}))}
}
function study(id,sun,earth,slope=2) { return {site:{id,name:id,slope_deg:slope},solar:series(sun),earth:series(earth)} }
test('half-open intervals exclude endpoint and intersect aligned body samples',()=>{
  const m=analyzeStudy(study('a',[1,1,-1,1],[1,-1,1,1]),rules)
  assert.equal(m.sunHours,2);assert.equal(m.earthHours,2);assert.equal(m.jointHours,1)
  assert.equal(m.sunWindows.length,1);assert.equal(m.sunWindows[0].hours,2)
  assert.equal(m.longestDarkHours,1);assert.equal(m.longestEarthGapHours,1)
})
test('Earth clearance changes durations; equality is hidden; Sun is unchanged',()=>{
  const m=analyzeStudy(study('a',[1,1,1,1],[1,2,3,4]),{...rules,earthClearanceDeg:2})
  assert.equal(m.sunHours,3);assert.equal(m.earthHours,1)
})
test('incompatible UTC grids are rejected',()=>{
  const a=study('a',[1,1,1],[1,1,1]);a.earth.samples[1].t_utc='2026-12-14T01:01:00.000Z'
  assert.throws(()=>analyzeStudy(a,rules),/UTC/)
})
test('requirements precede raw hours and equal alternatives retain equal metrics',()=>{
  const a=study('a',[1,1,1,1],[1,1,1,1],32),b=study('b',[1,1,-1,1],[1,1,-1,1],3)
  const rows=rankStudies([a,b],rules)
  assert.equal(rows[0].site.id,'b');assert.equal(rows[1].metrics.meetsRequirements,false)
  assert.match(rows[1].metrics.reasons.join(' '),/Pendiente/)
  const tied=rankStudies([b,{...b,site:{...b.site,id:'c'}}],rules)
  assert.deepEqual(tied[0].metrics,tied[1].metrics)
})
test('a time-limited run stops cleanly without claiming surface contact',()=>{
  const run=simulateDescent(DEFAULT_DESCENT,0.1,1)
  assert.equal(run.outcome,'timeout');assert.equal(run.impactSpeedMps,null)
  assert.ok(run.samples.at(-1).altitudeM>1900)
  assert.ok(Math.abs(run.durationS-1)<1e-9)
})
test('a missing or nonfinite horizon cannot become fabricated zero visibility',()=>{
  const a=study('a',[1,1,1],[1,1,1])
  a.earth.samples[1].horizon_deg=NaN
  assert.throws(()=>analyzeStudy(a,rules),/finitos/)
})
