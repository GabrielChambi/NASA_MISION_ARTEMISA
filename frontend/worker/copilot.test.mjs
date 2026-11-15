import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createCopilotApi,validateCopilotInput,validateModelReply} from './copilot.mjs'
const context={
  selected:{id:'local:one',name:'Connecting ridge',lat:-89.4,lon:-137.5,slopeDeg:4.2,resolutionM:5,coverage:'local'},
  regional:{scope:'80S–90S',sourceResolutionM:80,totalCells:16000,knownCells:11000,evaluated:true},
  simulation:{status:'ready',risk:'red',reasons:['Pendiente excesiva'],sunHours:72,earthHours:26},
  alternatives:[{id:'polar:1',name:'Candidato regional',lat:-88,lon:10,slopeDeg:2,resolutionM:80}]
}
const input={message:'¿Por qué ese cuadrado pequeño?',context}
const post=(api,body=input,env={})=>api(new Request('https://test.local/api/copilot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),env)
const response=content=>Response.json({candidates:[{content:{parts:[{text:JSON.stringify(content)}]}}]})
const env={AI_PROVIDER:'gemini',GEMINI_API_KEY:'test-only-secret',AI_MODEL:'gemini-3.5-flash-lite'}
const reply={explanation:'La vista regional preselecciona terreno; revisa el detalle antes de evaluar un aterrizaje.',intent:'find_sites',action:{type:'select_cell',target_id:'polar:1'}}

test('without credentials guide is explicit; square explanation and evidence come from the app',async()=>{
  const api=createCopilotApi({fetcher:()=>{throw Error('No external calls without model')}})
  const r=await post(api),body=await r.json()
  assert.equal(r.status,200);assert.equal(body.mode,'guide');assert.equal(body.reason,'model_not_configured')
  assert.equal(body.intent,'why_square');assert.equal(body.action.type,'polar_view')
  assert.equal(body.evidence.find(e=>e.id==='sun-hours').value,72)
  assert.equal(body.sources[0].url,'https://pgda.gsfc.nasa.gov/products/78')
  assert.ok(!JSON.stringify(body).includes('API_KEY'))
})
test('Gemini generates real schema-constrained answer; secret is a header, never URL or UI',async()=>{
  let calls=0
  const api=createCopilotApi({fetcher:async(url,options)=>{
    calls++
    assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent')
    assert.ok(!url.includes('test-only-secret'))
    assert.equal(options.headers['x-goog-api-key'],'test-only-secret')
    const body=JSON.parse(options.body)
    assert.equal(body.generationConfig.responseMimeType,'application/json')
    assert.ok(body.generationConfig.responseJsonSchema.required.includes('action'))
    assert.ok(body.systemInstruction.parts[0].text.includes('No escribas números'))
    return response(reply)
  }})
  const result=await(await post(api,input,env)).json()
  assert.equal(calls,1);assert.equal(result.mode,'ai');assert.equal(result.explanation,reply.explanation)
  assert.deepEqual(result.action,reply.action);assert.ok(!JSON.stringify(result).includes('test-only-secret'))
})
test('status probes actual model metadata; missing model and outage are never reported as AI available',async()=>{
  for(const [payload,available] of [[{name:'models/'+env.AI_MODEL,supportedGenerationMethods:['generateContent']},true],[{name:'models/other',supportedGenerationMethods:['generateContent']},false]]){
    const api=createCopilotApi({fetcher:async(url,options)=>{assert.equal(options.headers['x-goog-api-key'],env.GEMINI_API_KEY);return Response.json(payload)}})
    const r=await api(new Request('https://test.local/api/copilot/status'),env)
    assert.equal((await r.json()).available,available)
  }
  const api=createCopilotApi({fetcher:async()=>{throw Error('provider secret detail')}})
  const body=await(await api(new Request('https://test.local/api/copilot/status'),env)).json()
  assert.equal(body.mode,'guide');assert.equal(body.reason,'provider_unavailable')
  assert.ok(!JSON.stringify(body).includes('secret detail'))
})
test('unsupported quantities, arbitrary destinations and guarantees invalidate model prose and fall back visibly',async()=>{
  for(const patch of [
    {explanation:'Hay 100 horas de luz para tu misión.'},
    {explanation:'Este es un aterrizaje seguro y aprobado por NASA.'},
    {action:{type:'select_cell',target_id:'invented'}},
    {action:{type:'execute_code',target_id:'http://example.com'}},
    {explanation:'Consulta https://untrusted.example para continuar.'}
  ]){
    const api=createCopilotApi({fetcher:async()=>response({...reply,...patch})})
    const result=await(await post(api,input,env)).json()
    assert.equal(result.mode,'guide')
    assert.equal(result.reason,'provider_unavailable')
    assert.equal(result.action.type,'polar_view')
  }
})
test('stale results and invalid numbers never become numeric evidence; request context is whitelisted',()=>{
  const value=validateCopilotInput({message:'Necesito ayuda',context:{...context,selected:{...context.selected,slopeDeg:Infinity,secret:'none'},simulation:{status:'stale',sunHours:72,earthHours:0}}})
  assert.ok(!('secret' in value.context.selected));assert.ok(!('slopeDeg' in value.context.selected))
  assert.ok(!('sunHours' in value.context.simulation))
  assert.throws(()=>validateModelReply({...reply,action:{type:'select_cell',target_id:'missing'}},value.context))
})
test('bounded JSON and unsupported input fail without contacting inference',async()=>{
  const api=createCopilotApi({fetcher:()=>{throw Error('must not call')}})
  for(const body of [{message:''},{message:'x'.repeat(1300)},{message:'x'.repeat(13000)}]){
    const r=await post(api,body,env);assert.ok([422,413].includes(r.status))
  }
  const malformed=new Request('https://test.local/api/copilot',{method:'POST',headers:{'Content-Type':'application/json'},body:'invalid'})
  assert.equal((await api(malformed,env)).status,422)
  const wrongType=new Request('https://test.local/api/copilot',{method:'POST',body:'text'})
  assert.equal((await api(wrongType,env)).status,415)
})
test('Ollama and OpenAI-compatible inference remain available as optional server-side providers',async()=>{
  for(const provider of ['ollama','openai_compatible']){
    const config={AI_PROVIDER:provider,AI_MODEL:'test-model',AI_API_KEY:'test-key',AI_BASE_URL:provider==='ollama'?'http://127.0.0.1:11434':'https://example.test/v1'}
    const api=createCopilotApi({fetcher:async(url,options)=>{
      assert.ok(url.endsWith(provider==='ollama'?'/api/chat':'/chat/completions'))
      assert.equal(JSON.parse(options.body).model,'test-model')
      return Response.json(provider==='ollama'?{message:{content:JSON.stringify(reply)}}:{choices:[{message:{content:JSON.stringify(reply)}}]})
    }})
    assert.equal((await(await post(api,input,config)).json()).mode,'ai')
  }
})
test('provider outage or oversized output cannot expose diagnostics or make up a model answer',async()=>{
  for(const fetcher of [async()=>{throw Error('key=secret')},async()=>new Response('x'.repeat(70000)),async()=>Response.json({error:{message:'secret'}})]){
    const result=await(await post(createCopilotApi({fetcher}),input,env)).json()
    assert.equal(result.mode,'guide');assert.ok(!JSON.stringify(result).includes('secret'))
  }
})
