import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
const browser=await chromium.launch({channel:'chrome',headless:true})
const page=await browser.newPage({viewport:{width:1440,height:1100},reducedMotion:'reduce'})
page.setDefaultTimeout(45000)
const errors=[];page.on('pageerror',e=>errors.push(e.message))
try{
  await page.goto(process.env.LUNAR_ORACLE_TEST_URL||'http://127.0.0.1:4173/',{waitUntil:'domcontentloaded'})
  await page.getByRole('button',{name:'Explore NASA data',exact:true}).click()
  const workspace=page.getByRole('region',{name:'Lunar scientific workspace'})
  const earthResponse=page.waitForResponse(r=>r.url().endsWith('/api/earth')&&r.request().method()==='POST'&&r.status()===200)
  await workspace.getByRole('button',{name:'Earth visibility',exact:true}).click()
  await earthResponse
  await page.locator('.b-suite-container canvas').first().waitFor()
  const earthText=await page.locator('.b-suite-container').innerText()
  assert.ok(!earthText.includes('405'))
  await page.locator('.b-suite-container').screenshot({path:fileURLToPath(new URL('../../artifacts/main-earth-integration.png',import.meta.url))})
  await workspace.getByRole('button',{name:'Compare sites',exact:true}).click()
  await page.locator('.b-suite-container .b-site-card').first().waitFor()
  const comparison=await page.request.post(new URL('/api/compare',process.env.LUNAR_ORACLE_TEST_URL||'http://127.0.0.1:4173/').href,{data:{}})
  assert.equal(comparison.status(),200)
  const body=await comparison.json()
  assert.equal(body.sites.length,2)
  assert.ok(body.sites.every(s=>s.samples.length===72))
  await page.getByRole('region',{name:'Site Comparison',exact:true}).waitFor()
  await page.locator('.b-suite-container').screenshot({path:fileURLToPath(new URL('../../artifacts/main-comparison-integration.png',import.meta.url))})
  assert.deepEqual(errors,[])
  console.log('PASS updated main integration: POST Earth observatory renders, POST site comparison receives actual NASA results, both sites and 72-hour windows intact; no runtime errors.')
}finally{await browser.close()}
