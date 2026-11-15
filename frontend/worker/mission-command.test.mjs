import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {parseMissionIntent,createMissionIntentApi} from './mission-intent.mjs'
import {resolveMissionCommand,validateOperationPatch} from './mission-command.mjs'
import {normalizeMissionText} from './text-normalization.mjs'
const cases=JSON.parse(readFileSync(new URL('../../data/fixtures/mission-language.json',import.meta.url),'utf8'))
for(const c of cases)test('Shared language corpus: '+c.message,()=>{
 const r=parseMissionIntent({message:c.message,timezone:c.timezone})
 if(c.utc){assert.equal(r.needs_clarification,false);assert.equal(r.intent.departure_utc,c.utc);assert.equal(r.intent.date_kind,c.date_kind)}else{assert.equal(r.needs_clarification,true);assert.equal(r.intent.departure_utc,undefined);assert.ok(r.question.toLowerCase().includes(c.clarify_contains))}
})
const mission={departure_utc:'2026-12-25T13:00:00Z',requested_utc:'2026-12-25T13:00:00Z',date_kind:'departure',surface_hours:72,max_slope_deg:10,min_sun_hours:12,min_earth_hours:12,timezone:'America/New_York',local_datetime:'2026-12-25T08:00'}
const resolve=text=>resolveMissionCommand(text,{mission,timezone:'America/New_York'})
for(const [text,path,value] of [
 ['Batería de1000 Wh',['energy','battery_capacity_wh'],1000],['bateria de un kWh',['energy','battery_capacity_wh'],1000],
 ['Batería de mil Wh',['energy','battery_capacity_wh'],1000],['consumo esencial de 125 W',['energy','essential_load_w'],125],
 ['reserva mínima del25%',['energy','reserve_soc'],.25],['necesito6 horas de ciencia',['energy','science_duration_hours'],6],
 ['¿Qué pasa si mis paneles producen un 20% menos?',['fault','solar_loss_fraction'],.2],
 ['pierde el20% de producción solar',['fault','solar_loss_fraction'],.2],
 ['corte de comunicaciones durante6 horas desde la hora12',['fault','earth_outage_hours'],6],
 ['radio de huella de20m',['landing','footprint_radius_m'],20]
])test('Tool routing preserves the exact requested quantity: '+text,()=>{const r=resolve(text);assert.equal(r.kind,'operations');assert.equal(r.operations[path[0]][path[1]],value);assert.doesNotThrow(()=>validateOperationPatch(r.operations))})
test('A delayed departure preserves all constraints and computes the actual new UTC',()=>{const r=resolve('retrasa la salida12 horas');assert.equal(r.kind,'plan');assert.equal(r.parsed.departure_utc,'2026-12-26T01:00:00Z');for(const k of ['surface_hours','max_slope_deg','min_sun_hours','min_earth_hours'])assert.equal(r.parsed[k],mission[k])})
test('An hour-only followup keeps the current date rather than asking for it again',()=>{const r=resolve('cambia la hora a las10am');assert.equal(r.kind,'plan');assert.equal(r.parsed.departure_utc,'2026-12-25T15:00:00Z')})
test('A stay-only followup preserves the date and every unmentioned criterion',()=>{const r=resolve('quiero estar48 horas');assert.equal(r.parsed.surface_hours,48);assert.equal(r.parsed.departure_utc,mission.departure_utc);assert.equal(r.parsed.min_sun_hours,12)})
test('A clarification answer completes the pending mission instead of starting from scratch',()=>{const r=resolveMissionCommand('2026 a las10am',{pending_text:'quiero viajar el1de diciembre',timezone:'America/New_York'});assert.equal(r.kind,'plan');assert.equal(r.parsed.departure_utc,'2026-12-01T15:00:00Z')})
test('Negation and explanatory questions never modify parameters',()=>{assert.equal(resolve('No cambies la batería de1000 Wh').kind,'question');assert.equal(resolve('¿Cuánto dura la batería de1000 Wh?').kind,'question')})
test('Missing units and contradictory constraints ask precise questions',()=>{assert.equal(resolve('batería de1000').kind,'clarify');assert.equal(resolve('quiero estar6 horas').kind,'clarify')})
test('Only an explicit apply command selects a computed proposal',()=>{assert.deepEqual(resolve('aplica la primera alternativa'),{kind:'apply_proposal',index:0});assert.equal(resolve('busca alternativas').kind,'search')})
test('Invalid numeric values cannot enter an operations tool',()=>{for(const value of [NaN,Infinity,-1,true,'1000'])assert.throws(()=>validateOperationPatch({energy:{battery_capacity_wh:value}}));assert.throws(()=>validateOperationPatch({energy:{invented:1}}))})
test('The screenshot works without any inference provider',async()=>{const req=new Request('https://test/api/mission-intent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:cases[0].message,timezone:'America/New_York'})});const r=await (await createMissionIntentApi()(req,{})).json();assert.equal(r.needs_clarification,false);assert.equal(r.intent.departure_utc,'2026-12-01T15:00:00Z')})

test('A unit-only answer completes a pending equipment command',()=>{const r=resolveMissionCommand('Wh',{mission,pending_command_text:'batería de1000',timezone:'America/New_York'});assert.equal(r.kind,'operations');assert.equal(r.operations.energy.battery_capacity_wh,1000)})
test('An explicit month/day edit inherits the active year with a visible assumption',()=>{const r=resolve('Cambia la fecha al1de diciembre a las10am');assert.equal(r.kind,'plan');assert.equal(r.parsed.departure_utc,'2026-12-01T15:00:00Z');assert.ok(r.changes.some(c=>c.includes('Año 2026')))});

test('Negative commands and a negative delay cannot silently become positive actions',()=>{for(const text of ['No uses una batería de1000 Wh','Nunca cambies la batería de1000 Wh','No quiero cambiar la batería de1000 Wh'])assert.equal(resolve(text).kind,'question');assert.equal(resolve('retrasa la salida -12 horas').kind,'clarify')})
test('Only own whitelisted tool fields are accepted',()=>{for(const json of ['{"__proto__":{"invented":1}}','{"energy":{"constructor":1}}','{"energy":{"__proto__":1}}'])assert.throws(()=>validateOperationPatch(JSON.parse(json)))})
