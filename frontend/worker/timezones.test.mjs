import test from 'node:test'
import assert from 'node:assert/strict'
import {wallToUtc,wallTime,LAUNCH_SITES} from './timezones.mjs'
import {parseMissionIntent} from './mission-intent.mjs'
for(const [zone,local,utc] of [
 ['America/New_York','2026-12-01T10:00','2026-12-01T15:00:00Z'],
 ['America/New_York','2026-07-01T10:00','2026-07-01T14:00:00Z'],
 ['America/Los_Angeles','2026-12-01T10:00','2026-12-01T18:00:00Z'],
 ['America/Los_Angeles','2026-07-01T10:00','2026-07-01T17:00:00Z'],
 ['UTC','2026-12-01T10:00','2026-12-01T10:00:00Z']]){
 test('IANA launch clock '+zone+' '+local,()=>{assert.equal(wallToUtc(local,zone),utc);assert.equal(wallTime(utc,zone),local)})
}
for(const local of ['2026-03-08T02:30','2026-11-01T01:30'])test('DST invalid/ambiguous time requires an explicit instant '+local,()=>{
 assert.throws(()=>wallToUtc(local,'America/New_York'))
 assert.equal(parseMissionIntent({message:'Quiero despegar '+local,timezone:'America/New_York'}).needs_clarification,true)
})
test('Default interpretation follows Kennedy and explicit UTC preserves its meaning',()=>{
 assert.equal(LAUNCH_SITES[0].id,'ksc-39b')
 assert.equal(parseMissionIntent({message:'Viajar el 25 de diciembre de 2026 a las 8am'}).intent.departure_utc,'2026-12-25T13:00:00Z')
 assert.equal(parseMissionIntent({message:'Viajar el 25 de diciembre de 2026 a las 8am UTC',timezone:'America/New_York'}).intent.departure_utc,'2026-12-25T08:00:00Z')
})
