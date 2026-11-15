import test from 'node:test'
import assert from 'node:assert/strict'
import {createMissionIntentApi,parseMissionIntent} from './mission-intent.mjs'

const example='si quierio hacer un viaje el 25 de diciembre de 2026 a las 8 am donde seria bueno caer y cuanto tardara la mision'
const input=(message=example,extra={})=>({message,timezone:'America/La_Paz',...extra})
const request=value=>new Request('https://lunar.example/api/mission-intent',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)})
const model=(overrides={})=>({local_date:'2026-12-25',local_time:'08:00',timezone:'America/La_Paz',date_kind:'departure',date_explicit:true,time_explicit:true,surface_hours:null,max_slope_deg:null,min_sun_hours:null,min_earth_hours:null,...overrides})
const gemini=value=>Response.json({candidates:[{content:{parts:[{text:JSON.stringify(value)}]}}]})

test('the user request yields a departure instant and explicit hypotheses, not a refusal',()=>{
 const parsed=parseMissionIntent(input())
 assert.equal(parsed.needs_clarification,false)
 assert.equal(parsed.intent.departure_utc,'2026-12-25T12:00:00Z')
 assert.equal(parsed.intent.local_datetime,'2026-12-25T08:00')
 assert.equal(parsed.intent.date_kind,'departure')
 assert.equal(parsed.intent.surface_hours,72)
 assert.match(parsed.assumptions.join(' '),/America\/La_Paz.*UTC−04:00/)
 assert.match(parsed.assumptions.join(' '),/hipótesis editable.*no como duración total/)
 assert.deepEqual(parsed.explicit_fields,[])
})

for(const [time,expected] of [['12 am','04:00'],['12 pm','16:00'],['8:35 pm','00:35']]){
 test('12-hour clock '+time,()=>{
  const parsed=parseMissionIntent(input('Viaje el 25 de diciembre de 2026 a las '+time))
  assert.equal(parsed.needs_clarification,false)
  const day=time==='8:35 pm'?'26':'25'
  assert.equal(parsed.intent.requested_utc,'2026-12-'+day+'T'+expected+':00Z')
 })
}

test('explicit UTC and ISO offsets take priority over the page timezone',()=>{
 for(const message of ['Viaje el 25 de diciembre de 2026 a las 8 am UTC','Viaje 2026-12-25T08:00:00Z','Viaje 2026-12-25T10:00+02:00']){
  const parsed=parseMissionIntent(input(message))
  assert.equal(parsed.needs_clarification,false)
  assert.equal(parsed.intent.requested_utc,'2026-12-25T08:00:00Z')
  assert.equal(parsed.intent.timezone,'UTC')
 }
 assert.equal(parseMissionIntent(input('Viaje el 25/12/2026 a las 8 UTC−04:00')).intent.requested_utc,'2026-12-25T12:00:00Z')
})

test('landing dates remain landing dates and minutes remain unchanged',()=>{
 const parsed=parseMissionIntent(input('Quiero alunizar el 25 de diciembre de 2026 a las 08:19'))
 assert.equal(parsed.intent.date_kind,'landing')
 assert.equal(parsed.intent.requested_utc,'2026-12-25T12:19:00Z')
})

test('explicit stay and constraints override UI defaults',()=>{
 const parsed=parseMissionIntent(input(example+' Quiero estar 48 horas, pendiente máxima 5°, 24 horas de Sol y 12 horas de Tierra visible.',{defaults:{surface_hours:168,max_slope_deg:10}}))
 assert.equal(parsed.needs_clarification,false)
 assert.equal(parsed.intent.surface_hours,48)
 assert.equal(parsed.intent.max_slope_deg,5)
 assert.equal(parsed.intent.min_sun_hours,24)
 assert.equal(parsed.intent.min_earth_hours,12)
 assert.deepEqual(parsed.explicit_fields,['surface_hours','max_slope_deg','min_sun_hours','min_earth_hours'])
 assert.doesNotMatch(parsed.assumptions.join(' '),/No indicaste estancia/)
})

test('unknown total mission duration is a question and not an explicit stay',()=>{
 const parsed=parseMissionIntent(input(example,{defaults:{surface_hours:24}}))
 assert.equal(parsed.intent.surface_hours,24)
 assert.equal(parsed.explicit_fields.includes('surface_hours'),false)
})

test('missing absolute dates request just the missing date, while date-only requests assume 08:00',()=>{
 for(const message of ['¿Dónde debería caer?','Viaje el 25 de diciembre a las 8 am']){
  const parsed=parseMissionIntent(input(message))
  assert.equal(parsed.needs_clarification,true)
  assert.match(parsed.question,/fecha|año/)
  assert.equal(parsed.intent.departure_utc,undefined)
 }
 for(const message of ['Quiero alunizar el 25 de diciembre de 2026','dime donde aterrizarel 9 de agosto el 2027','aterrizar el 9 de agosto del 2027']){
  const parsed=parseMissionIntent(input(message))
  assert.equal(parsed.needs_clarification,false,message)
  assert.equal(parsed.intent.date_kind,'landing')
  assert.match(parsed.assumptions.join(' '),/No indicaste hora/)
 }
})

test('invalid calendar, clock and contradictory constraints cannot be silently repaired',()=>{
 for(const message of ['Viaje el 30 de febrero de 2026 a las 8 am','Viaje 2026-02-30T08:00+02:00','Viaje el 25/12/2101 a las 8 am','Viaje el 25/12/2026 a las 25:00',example+' estar 8 horas y 24 horas de Sol']){
  const parsed=parseMissionIntent(input(message))
  assert.equal(parsed.needs_clarification,true,message)
  assert.equal(parsed.intent.departure_utc,undefined)
 }
})

test('defaults can shorten stay without inventing impossible default visibility requirements',()=>{
 const parsed=parseMissionIntent(input(example,{defaults:{surface_hours:8}}))
 assert.equal(parsed.intent.min_sun_hours,8)
 assert.equal(parsed.intent.min_earth_hours,8)
})

test('the endpoint is isolated, bounded, and accepts no browser API key',async()=>{
 const api=createMissionIntentApi({fetcher:()=>{throw new Error('should not run')}})
 assert.equal(await api(new Request('https://lunar.example/api/other')),null)
 assert.equal((await api(new Request('https://lunar.example/api/mission-intent'))).status,405)
 assert.equal((await api(new Request('https://lunar.example/api/mission-intent',{method:'POST',body:'{}'}))).status,415)
 assert.equal((await api(request({message:'a'.repeat(9000)}))).status,413)
 assert.equal((await api(request(input(example,{timezone:'Made/Up'})))).status,422)
 const response=await api(request({...input(),GEMINI_API_KEY:'browser-key'}))
 const body=await response.json()
 assert.equal(body.mode,'parser')
 assert.equal(body.reason,'model_not_configured')
 assert.equal(body.intent.requested_utc,'2026-12-25T12:00:00Z')
 assert.equal(response.headers.get('cache-control'),'no-store')
})

test('Gemini is used server-side only for structured extraction and is not asked for science',async()=>{
 let call
 const api=createMissionIntentApi({fetcher:async(url,init)=>{call={url,init};return gemini(model())}})
 const response=await api(request(input()),{GEMINI_API_KEY:'server-only-secret',AI_MODEL:'gemini-3.5-flash-lite'})
 const body=await response.json(),payload=JSON.parse(call.init.body)
 assert.equal(body.mode,'ai')
 assert.equal(body.needs_clarification,false)
 assert.equal(body.intent.departure_utc,'2026-12-25T12:00:00Z')
 assert.equal(call.url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent')
 assert.equal(call.init.headers['x-goog-api-key'],'server-only-secret')
 assert.equal(payload.generationConfig.responseMimeType,'application/json')
 assert.equal(payload.generationConfig.responseJsonSchema.additionalProperties,false)
 assert.equal(JSON.stringify(body).includes('server-only-secret'),false)
 assert.match(body.assumptions.join(' '),/72 horas como hipótesis/)
})

test('changed explicit date or invented stay causes transparent deterministic fallback',async()=>{
 for(const changed of [model({local_date:'2026-12-26'}),model({surface_hours:72}),model({max_slope_deg:2}),model({date_kind:'landing'})]){
  const api=createMissionIntentApi({fetcher:async()=>gemini(changed)})
  const body=await (await api(request(input()),{GEMINI_API_KEY:'server-secret'})).json()
  assert.equal(body.mode,'parser')
  assert.equal(body.reason,'provider_or_extraction_unavailable')
  assert.equal(body.intent.requested_utc,'2026-12-25T12:00:00Z')
  assert.equal(body.intent.max_slope_deg,10)
 }
})

test('provider outages and oversized responses preserve a usable parser result',async()=>{
 for(const fetcher of [async()=>{throw new Error('offline')},async()=>new Response('x'.repeat(33000)),async()=>Response.json({error:'quota'},{status:429})]){
  const body=await (await createMissionIntentApi({fetcher})(request(input()),{GEMINI_API_KEY:'server-secret'})).json()
  assert.equal(body.mode,'parser')
  assert.equal(body.needs_clarification,false)
 }
})

test('invalid explicit dates never call the provider',async()=>{
 let called=false
 const api=createMissionIntentApi({fetcher:async()=>{called=true;return gemini(model())}})
 const body=await (await api(request(input('Viaje el 30 de febrero de 2026 a las 8 am')),{GEMINI_API_KEY:'secret'})).json()
 assert.equal(called,false)
 assert.equal(body.needs_clarification,true)
})
