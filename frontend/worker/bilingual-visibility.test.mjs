import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {parseMissionIntent} from './mission-intent.mjs'
import {resolveMissionCommand} from './mission-command.mjs'
import {normalizeMissionText} from './text-normalization.mjs'
import {assessVisibility,scientificObserver,clearsMargin} from './visibility.mjs'
import {translateText,formatNumber} from './locale.mjs'
const cases=JSON.parse(readFileSync(new URL('../../data/fixtures/mission-english.json',import.meta.url),'utf8'))
for(const c of cases)test('English intent parity: '+c.message,()=>{const r=parseMissionIntent(c);assert.equal(r.needs_clarification,Boolean(c.invalid));if(!c.invalid){assert.equal(r.intent.departure_utc,c.utc);assert.equal(r.intent.date_kind,c.date_kind)}})
const mission={departure_utc:'2026-12-25T13:00:00Z',date_kind:'departure',surface_hours:72,max_slope_deg:10,min_sun_hours:12,min_earth_hours:12}
for(const [message,group,key,value] of [
 ['Change the battery to one thousand Wh','energy','battery_capacity_wh',1000],
 ['Essential load 125 W','energy','essential_load_w',125],
 ['Reserve 25%','energy','reserve_soc',.25],
 ['Initial state of charge 85%','energy','initial_soc',.85],
 ['I need 6 hours of science','energy','science_duration_hours',6],
 ['What if solar panels produce 20% less?','fault','solar_loss_fraction',.2],
 ['Communications blackout for 6 hours starting at hour 12','fault','earth_outage_hours',6],
])test('English tool preserves quantity: '+message,()=>{const r=resolveMissionCommand(message,{mission});assert.equal(r.kind,'operations');assert.equal(r.operations[group][key],value)})
test('English relative follow-ups preserve the full active scientific request',()=>{const r=resolveMissionCommand('Delay departure by 12 hours',{mission});assert.equal(r.parsed.departure_utc,'2026-12-26T01:00:00Z');assert.equal(r.parsed.max_slope_deg,10);assert.equal(r.parsed.min_sun_hours,12)})
test('English negation never applies a hardware change',()=>{for(const text of ["Do not change the battery to 1000 Wh","Don't use a battery of 1000 Wh","Never change the battery to 1000 Wh"])assert.equal(resolveMissionCommand(text,{mission}).kind,'question')})
test('Compound English number words preserve their entire value and units',()=>{assert.match(normalizeMissionText('battery one hundred and twenty Wh'),/120 wh/);assert.match(normalizeMissionText('battery one thousand two hundred Wh'),/1200 wh/)})
for(const [e,h,state] of [[-1.884,-1.470,'occluded'],[-.4,-1,'clear'],[.1,0,'limited'],[.3,0,'limited'],[1.3,1,'limited'],[2,1,'clear']])test('Center visibility uses one margin and allows a negative terrain horizon: '+e+'/'+h,()=>{const a=assessVisibility(e,h);assert.equal(a.state,state);assert.equal(a.meets_margin,state==='clear')})
test('Absent or corrupt angles stay unknown rather than turning into a blocked ray',()=>{for(const value of [null,undefined,NaN,Infinity])assert.equal(assessVisibility(value,0).state,'unknown');assert.equal(assessVisibility(0,null).geometry_visible,null)})
test('The scientific observer is exactly at its declared metric height along the local vertical',()=>{const base=[-56.2,-.8,90.1],up=[.6,.8,0],p=scientificObserver(base,up,2),delta=p.map((v,i)=>v-base[i]);assert.ok(Math.abs(Math.hypot(...delta)-.002)<1e-13);assert.ok(Math.abs(delta.reduce((v,d,i)=>v+d*up[i],0)-.002)<1e-13);assert.throws(()=>scientificObserver(base,[0,0,0],2));assert.throws(()=>scientificObserver(base,up,-1))})
test('Clearance comparisons remain valid beyond a ninety-degree difference',()=>{assert.equal(clearsMargin(120,.3),true);assert.equal(clearsMargin(null,.3),null)})
test('Locale changes format and labels, never numerical science or names',()=>{assert.equal(translateText('Tierra','en'),'Earth');assert.equal(translateText('Tierra','es'),'Tierra');assert.equal(formatNumber(12892,0,'en'),'12,892');assert.equal(translateText('polar:29:26','en'),'polar:29:26');assert.equal(translateText('JPL Horizons','en'),'JPL Horizons')})

test('Dynamic fragments keep their surrounding quantities and word boundaries',()=>{const out=translateText('Solar production. Estancia declarada: 72 h. Centro regional: 82.3°S, 47.3°O.','en');assert.ok(out.startsWith('Solar production.'));assert.ok(out.includes('Declared surface stay: 72 h'));assert.ok(out.includes('Regional center:'));assert.ok(out.includes('47.3°W'))})

test('A year-only English answer keeps an already specified clock',()=>{const r=resolveMissionCommand('2026',{pending_text:'I want to travel on December 1 at 10am',timezone:'America/New_York'});assert.equal(r.kind,'plan');assert.equal(r.parsed.departure_utc,'2026-12-01T15:00:00Z');assert.equal(r.message,'I want to travel on December 1 at 10am 2026')})
test('A year-only Spanish answer also preserves its known date and clock',()=>{const r=resolveMissionCommand('2026',{pending_text:'Quiero viajar el 1 de diciembre a las 10am',timezone:'America/New_York'});assert.equal(r.kind,'plan');assert.equal(r.parsed.departure_utc,'2026-12-01T15:00:00Z')})
