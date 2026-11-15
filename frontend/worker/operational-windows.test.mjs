
import {readFile} from 'node:fs/promises'
import {build} from 'esbuild'
import {test} from 'node:test'
import assert from 'node:assert/strict'
const source=await readFile(new URL('../src/features/mission/operationalWindows.ts',import.meta.url),'utf8')
const {outputFiles}=await build({stdin:{contents:source,resolveDir:new URL('../src/features/mission/',import.meta.url).pathname.replace(/^\/(?:([A-Za-z]):)/,'$1:'),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',target:'es2022'})
const code=outputFiles[0].text
const {getOperationalWindows}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const START=Date.parse('2026-12-06T12:00:00Z'),H=3600000
const utc=i=>new Date(START+i*H).toISOString().replace('.000Z','Z')
const series=(sun,earth=sun.map(()=>2))=>sun.map((e,i)=>({t_utc:utc(i),sun_elevation_deg:e,sun_horizon_deg:0,earth_elevation_deg:earth[i],earth_horizon_deg:0}))
const ok=(rows,index=0,margin=.3)=>{const result=getOperationalWindows(rows,index,margin);assert.equal(result.status,'ok');return result}

test('Loss and availability events carry hourly brackets; no interpolated exact crossing is invented',()=>{
 const rows=series([2,2,-1,-1,2,2],[2,-1,-1,2,2,2]),r=ok(rows)
 assert.equal(r.sun.current_visible,true)
 assert.deepEqual(r.sun.next_loss,{event_state:'observed',at_utc:utc(2),hours_until:2,bracket_start_utc:utc(1),bracket_end_utc:utc(2),uncertainty_hours:1,hours_until_min:1,hours_until_max:2,observed_until_utc:utc(2)})
 assert.equal(r.earth.next_loss.at_utc,utc(1))
 assert.equal(r.joint_current_window_end_utc,utc(1))
 const blocked=ok(rows,2)
 assert.equal(blocked.sun.next_loss.event_state,'not_active')
 assert.equal(blocked.sun.next_available.event_state,'observed')
 assert.equal(blocked.sun.next_available.hours_until,2)
 assert.equal(blocked.earth.next_available.hours_until,1)
 assert.equal(blocked.joint.next_available.hours_until,2)
})

test('Half-open windows merge contiguous intervals and never count the endpoint as another hour',()=>{
 const r=ok(series([2,2,-1,2,2,2],[2,-1,-1,2,2,2]))
 assert.deepEqual(r.sun.intervals,[{start_utc:utc(0),end_utc:utc(2),hours:2},{start_utc:utc(3),end_utc:utc(5),hours:2}])
 assert.equal(r.sun.visible_hours,4)
 assert.equal(r.sun.blocked_hours,1)
 assert.equal(r.sun.unknown_hours,0)
 assert.deepEqual(r.joint.intervals,[{start_utc:utc(0),end_utc:utc(1),hours:1},{start_utc:utc(3),end_utc:utc(5),hours:2}])
 assert.equal(r.joint.visible_hours,3)
})

test('No observed loss means bounded coverage, never perpetual light or an invented later sunset',()=>{
 const r=ok(series([2,2,2,2]),1)
 assert.equal(r.remaining_hours,2)
 assert.equal(r.coverage_end_utc,utc(3))
 assert.equal(r.sun.next_loss.event_state,'not_observed')
 assert.equal(r.sun.next_loss.at_utc,null)
 assert.equal(r.sun.next_loss.hours_until,null)
 assert.equal(r.sun.next_loss.observed_until_utc,utc(3))
 assert.equal(r.sun.next_available.event_state,'already_active')
 assert.equal(r.sun.next_available.hours_until,0)
 assert.equal(r.joint_current_window_end_utc,null)
 assert.equal(r.joint_current_window_end_state,'not_observed')
 const blocked=ok(series([-1,-1,-1]))
 assert.equal(blocked.sun.next_available.event_state,'not_observed')
 assert.equal(blocked.sun.next_available.at_utc,null)
})

test('A loss at the final observed sample is recorded without adding any final-sample duration',()=>{
 const rows=series([2,2,-1]),r=ok(rows)
 assert.equal(r.sun.next_loss.at_utc,utc(2))
 assert.equal(r.sun.visible_hours,2)
 assert.equal(r.sun.blocked_hours,0)
 assert.equal(r.sun.intervals[0].end_utc,utc(2))
 const last=ok(rows,2)
 assert.equal(last.remaining_hours,0)
 assert.equal(last.is_end_of_coverage,true)
 assert.equal(last.sun.current_visible,false)
 assert.equal(last.sun.next_available.event_state,'not_observed')
 assert.equal(last.sun.next_available.hours_until,null)
})

test('Missing or nonfinite geometry remains unknown and interrupts an otherwise visible window',()=>{
 const rows=series([2,null,2,2],[2,2,2,2])
 rows[2].sun_horizon_deg=NaN
 const r=ok(rows)
 assert.equal(r.sun.next_loss.event_state,'unknown')
 assert.equal(r.sun.next_loss.at_utc,null)
 assert.equal(r.sun.visible_hours,1)
 assert.equal(r.sun.unknown_hours,2)
 assert.equal(r.earth.visible_hours,3)
 assert.equal(r.earth.unknown_hours,0)
 assert.equal(r.joint.unknown_hours,2)
 assert.deepEqual(r.sun.intervals,[{start_utc:utc(0),end_utc:utc(1),hours:1}])
 assert.equal(ok(rows,1).sun.current_visible,null)
 assert.equal(ok(rows,1).sun.current_geometric_visible,null)
 assert.equal(ok(rows,1).sun.next_available.event_state,'unknown')
})

test('Geometric horizon visibility is distinct from the declared operational-clearance margin',()=>{
 const r=ok(series([.3,.31,0,-.2]),0,.3)
 assert.equal(r.sun.current_clearance_deg,.3)
 assert.equal(r.sun.current_geometric_visible,true)
 assert.equal(r.sun.current_visible,false)
 assert.equal(r.sun.next_available.at_utc,utc(1))
 assert.equal(r.sun.visible_hours,1)
 const zero=ok(series([0,.1]),0,0)
 assert.equal(zero.sun.current_geometric_visible,false)
 assert.equal(zero.sun.current_visible,false)
 assert.equal(zero.sun.next_available.at_utc,utc(1))
})

test('Strict UTC and hourly alignment reject gaps, duplicate dates and impossible calendars',()=>{
 for(const rows of [
  [],
  series([2]),
  [{...series([2,2])[0],t_utc:'2026-12-06T12:00:00'},series([2,2])[1]],
  [{...series([2,2])[0],t_utc:'2026-02-30T12:00:00Z'},series([2,2])[1]],
  [series([2,2])[0],{...series([2,2])[1],t_utc:utc(2)}],
  [series([2,2])[0],{...series([2,2])[1],t_utc:utc(0)}]
 ])assert.equal(getOperationalWindows(rows).status,'unavailable')
})

test('Timeline endpoints are validated instead of silently clamping an invalid index or margin',()=>{
 const rows=series([2,2,2])
 for(const index of [-1,3,1.5,NaN])assert.equal(getOperationalWindows(rows,index).status,'unavailable')
 for(const margin of [-1,91,NaN,Infinity])assert.equal(getOperationalWindows(rows,0,margin).status,'unavailable')
 const r=ok(rows,2)
 assert.equal(r.is_end_of_coverage,true)
 assert.equal(r.remaining_hours,0)
 assert.equal(r.sun.next_loss.event_state,'not_observed')
 assert.equal(r.sun.visible_hours,2)
})

test('Windows remain correct across midnight and permit UTC milliseconds without altering cadence',()=>{
 const rows=series([2,2,-1]).map((row,i)=>({...row,t_utc:new Date(Date.parse('2026-12-31T23:30:00.000Z')+i*H).toISOString()}))
 const r=ok(rows)
 assert.equal(r.coverage_start_utc,'2026-12-31T23:30:00.000Z')
 assert.equal(r.sun.next_loss.at_utc,'2027-01-01T01:30:00.000Z')
 assert.equal(r.sun.next_loss.hours_until,2)
 assert.equal(r.sun.visible_hours,2)
})


test('Impossible finite angles are unknown rather than creating unlimited Sun or Earth clearance',()=>{
 const rows=series([91,2,2],[2,2,2])
 rows[1].earth_horizon_deg=-91
 const r=ok(rows)
 assert.equal(r.sun.current_visible,null)
 assert.equal(r.sun.unknown_hours,1)
 assert.equal(r.earth.unknown_hours,1)
 assert.equal(r.joint.unknown_hours,2)
 assert.equal(r.method,'hourly-left-sample-clearance')
 assert.equal(r.transition_uncertainty_hours,1)
 assert.ok(r.limitations.some(note=>note.includes('pérdidas breves')))
})
