import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createScienceApi, circularInterpolate, visibilityMetrics } from './science.mjs'

const data = [new URL('../../data/', import.meta.url),new URL('../data/',import.meta.url)].find(p=>existsSync(new URL('catalog/sites.json',p)))
const read = async name => JSON.parse(await readFile(new URL(name, data), 'utf8'))
const resources = { sites: await read('catalog/sites.json'), datasets: await read('catalog/datasets.json'), horizon:await read('prepared/horizon_profiles.json'), terrain:{site01:await read('prepared/site01-terrain.json'),site04:await read('prepared/site04-terrain.json')}, methodology:{}, ephemeris:[] }
for (const name of await readdir(new URL('prepared/ephemeris/',data))) if (name.endsWith('.json')) resources.ephemeris.push(await read(`prepared/ephemeris/${name}`))
const api = createScienceApi(resources)
for (const site of ['site01','site04']) for (const target of ['solar','earth']) {
  test(`Python/edge parity: ${site} ${target} actual NASA interval`,async()=>{
    const expected=await read(`prepared/${site}-${target}.json`)
    const response=await api(new Request(`https://test.local/api/${target}?site_id=${site}`))
    assert.equal(response.status,200)
    const actual=await response.json()
    assert.deepEqual(actual.samples,expected.samples)
    assert.deepEqual(actual.windows,expected.windows)
    assert.deepEqual(actual.summary,expected.summary)
    assert.equal(actual.meta.observer_altitude_km,expected.meta.observer_altitude_km)
    assert.equal(actual.meta.cache_hit,true)
    assert.ok(actual.meta.query_url.includes('horizons.api'))
  })
}
test('Circular profile interpolation crosses 359/0 without discontinuity',()=>{
  const samples=Array.from({length:360},(_,i)=>({elevation_deg:Math.cos(i*Math.PI/180)}))
  assert.ok(Math.abs(circularInterpolate(samples,359.5)-circularInterpolate(samples,-0.5))<1e-12)
})
test('Half-open intervals exclude final sample duration',()=>{
  const samples=[true,false,true].map((visible,i)=>({t_utc:`2026-12-01T0${i}:00:00Z`,visible}))
  const result=visibilityMetrics(samples,samples[2].t_utc)
  assert.equal(result.summary.sun_visible_hours,1)
  assert.equal(result.summary.sun_visible_fraction,.5)
  assert.equal(result.summary.longest_dark_gap_hours,1)
  assert.equal(result.windows[0].end_utc,samples[1].t_utc)
})
test('Terrain response uses prepared NASA profile; unsupported heights rejected',async()=>{
  const response=await api(new Request('https://test.local/api/solar?horizon_mode=terrain'))
  assert.equal(response.status,200)
  const body=await response.json()
  assert.equal(body.meta.horizon_quality,'partial')
  assert.ok(body.samples.some(s=>s.horizon_deg!==0))
  assert.equal((await api(new Request('https://test.local/api/solar?horizon_mode=terrain&observer_height_m=3'))).status,422)
})
test('Reject invalid UTC, site, resolution and calendar values',async()=>{
  for(const query of ['site_id=unknown','start_utc=2026-12-01T00:00:00','start_utc=2026-02-30T00:00:00Z','step_minutes=0','observer_height_m=NaN']) assert.equal((await api(new Request(`https://test.local/api/solar?${query}`))).status,422)
})
test('An upstream failure produces unavailable, never synthetic visibility',async t=>{
  t.mock.method(globalThis,'fetch',async()=>{throw new Error('Offline')})
  const unavailable=createScienceApi({...resources,ephemeris:[]})
  const response=await unavailable(new Request('https://test.local/api/solar'))
  const body=await response.json()
  assert.equal(response.status,503)
  assert.equal(body.status,'unavailable')
  assert.deepEqual(body.samples,[])
  assert.equal(body.summary,null)
})

test('Pre-1962 UT1 cannot be presented as UTC',async()=>{
  const response=await api(new Request('https://test.local/api/solar?start_utc=1961-12-01T00:00:00Z&end_utc=1961-12-02T00:00:00Z'))
  assert.equal(response.status,422)
  assert.ok((await response.json()).message.includes('UT1'))
})

test('Terrain alias matches backend schema and unknown site handling',async()=>{
  const response=await api(new Request('https://test.local/api/terrain?site_id=site01'))
  assert.equal(response.status,200)
  assert.equal((await response.json()).elevations_m.length,65*65)
  assert.equal((await api(new Request('https://test.local/api/terrain?site_id=unknown'))).status,404)
})

test('Concurrent requests retain independent target data without shared request state',async t=>{
  t.mock.method(globalThis,'fetch',async input=>{
    const params=new URL(input).searchParams
    const record=resources.ephemeris.find(item=>item.params.COMMAND===params.get('COMMAND')&&item.params.SITE_COORD===params.get('SITE_COORD'))
    await Promise.resolve()
    return Response.json(record.response)
  })
  const uncached=createScienceApi({...resources,ephemeris:[]})
  const responses=await Promise.all([uncached(new Request('https://test.local/api/solar')),uncached(new Request('https://test.local/api/earth'))])
  assert.ok(responses.every(response=>response.status===200))
  const bodies=await Promise.all(responses.map(r=>r.json()))
  assert.equal(bodies[0].target,'Sun')
  assert.equal(bodies[1].target,'Earth')
  assert.notDeepEqual(bodies[0].samples,bodies[1].samples)
})
