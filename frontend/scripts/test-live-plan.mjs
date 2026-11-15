
/** Live check for a date outside the prepared Christmas example. Requires network. */
import {chromium} from 'playwright'
import {writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const base=process.env.LUNAR_ORACLE_TEST_URL||'https://lunar-oracle-mission-control.gptcompartir.chatgpt.site/'
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
 const page=await browser.newPage()
 await page.goto(base,{waitUntil:'domcontentloaded'})
 const result=await page.evaluate(async()=>{
  const start=performance.now(),request={departure_utc:'2026-12-26T12:00:00Z',surface_hours:72,max_slope_deg:10,min_sun_hours:12,min_earth_hours:12,observer_height_m:2}
  const response=await fetch('/api/automatic-plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)})
  const data=await response.json()
  return {http:response.status,status:data.status,seconds:Math.round((performance.now()-start)/100)/10,request,arrival:data.mission?.arrival_utc,counts:data.counts,best:data.best?.id,best_sun_hours:data.best?.sun_hours,message:data.message,sources:data.meta?.sources?.map(s=>s?{cache_hit:s.cache_hit,source:s.source,query_url:s.query_url}:null)}
 })
 await writeFile(new URL('../../artifacts/automatic-public-new-date.json',import.meta.url),JSON.stringify({base,...result},null,2))
 console.log(JSON.stringify(result))
 assert.equal(result.http,200,'The deployed application must query NASA for an unprepared date')
 assert.equal(result.status,'ok')
 assert.equal(Object.values(result.counts).reduce((sum,n)=>sum+n,0),12892)
 assert.ok(Date.parse(result.arrival)>Date.parse(result.request.departure_utc))
 assert.equal(result.sources.length,3)
 assert.ok(result.sources.every(source=>source&&new URL(source.query_url).hostname==='ssd.jpl.nasa.gov'))
}finally{await browser.close()}
