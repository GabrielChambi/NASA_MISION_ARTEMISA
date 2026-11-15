/** Browser integrity of vehicle metadata. Uses real local APIs; no scientific responses are mocked. */
import {chromium} from 'playwright'
import {mkdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const base=process.env.LUNAR_ORACLE_TEST_URL||'http://127.0.0.1:5173/'
const output=new URL('../../artifacts/',import.meta.url)
await mkdir(output,{recursive:true})
const path=name=>fileURLToPath(new URL(name,output))
const checks=[],errors=[],consoleErrors=[],failedRequests=[],requests=[],reviews=[]
let referenceRequest=null
const browser=await chromium.launch({channel:'chrome',headless:true})
let page
const check=(label,value)=>{assert.ok(value,label);checks.push(label)}
const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
const waitResponse=route=>page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===route,{timeout:120000}).catch(()=>null)
const readCount=()=>page.evaluate(()=>window.__vehicleProfileReads||0)
const currentProfile=()=>page.locator('.composer-active-chip strong').innerText()
const scientificRequestCount=()=>requests.filter(r=>r.path==='/api/automatic-plan').length
async function upload(name,value,mime='application/json'){
 const buffer=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value))
 await page.locator('input[type="file"]').setInputFiles({name,mimeType:mime,buffer})
 await frame()
}
async function rejectedUpload(name,value,readExpected,mime){
 const profile=await currentProfile(),before=scientificRequestCount(),reads=await readCount()
 await upload(name,value,mime)
 await page.locator('.trip-error[role="alert"]').waitFor({timeout:15000})
 check(name+' is rejected without changing the selected profile',await currentProfile()===profile)
 check(name+' never recalculates the mission',scientificRequestCount()===before)
 check(name+' read policy is enforced',await readCount()===reads+readExpected)
 check(name+' preserves the verified reference recommendation',await page.locator('.best-destination').count()===1)
}
async function uploadAndCalculate(name,profile){
 const response=waitResponse('/api/automatic-plan')
 await upload(name,profile)
 const received=await response
 assert.ok(received,'Uploading a valid profile must recalculate the active mission')
 const result=await received.json(),sent=received.request().postDataJSON()
 check(name+' returns an actual scientific response',received.status()===200&&result.status==='ok')
 await page.waitForFunction(profileName=>document.querySelector('.composer-active-chip strong')?.textContent===profileName,profile.name??profile.lander_name)
 await frame()
 return {result,sent}
}
function unchangedUserCriteria(sent){
 return (!referenceRequest||(sent.departure_utc===referenceRequest.departure_utc&&sent.date_kind===referenceRequest.date_kind))&&sent.max_slope_deg===10&&sent.surface_hours===72&&sent.min_sun_hours===12&&sent.min_earth_hours===12&&sent.observer_height_m===2
}
try{
 page=await browser.newPage({viewport:{width:1600,height:1100},deviceScaleFactor:1,reducedMotion:'reduce'})
 page.on('pageerror',e=>errors.push(e.message))
 page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text())})
 page.on('requestfailed',r=>{if(r.failure()?.errorText!=='net::ERR_ABORTED')failedRequests.push({path:new URL(r.url()).pathname,error:r.failure()?.errorText})})
 page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname.startsWith('/api/')){let body;try{body=r.postDataJSON()}catch{}requests.push({path:new URL(r.url()).pathname,body})}})
 page.on('response',async response=>{
  if(response.request().method()==='POST'&&/\/api\/(?:lander-review|copilot\/lander-review)$/.test(new URL(response.url()).pathname)){
   try{reviews.push(await response.json())}catch{/* Transport may be canceled when changing profiles. */}
  }
 })
 await page.addInitScript(()=>{
  window.__vehicleProfileReads=0
  const original=File.prototype.text
  File.prototype.text=function(...args){window.__vehicleProfileReads++;return original.apply(this,args)}
 })
 await page.goto(base,{waitUntil:'domcontentloaded'})
 await page.waitForFunction(()=>document.querySelector('.primary-plan')&&!document.querySelector('.primary-plan').disabled,null,{timeout:60000})
 check('The Spanish mission label is valid UTF-8 after editing the interface',await page.locator('#mission-request').getAttribute('aria-label')==='Describe tu misión')
 check('The model starts with the explicitly prepared two-metre reference',/Referencia regional.*2 m/.test(await currentProfile()))
 check('Reference metadata does not pretend to represent a real spacecraft',/No representa una nave real/.test(await page.locator('.composer-active-chip').getAttribute('title')))
 await page.getByLabel('Describe tu misión',{exact:true}).fill('Quiero viajar el 25 de diciembre de 2026 a las 8 am UTC−04:00 y estar 72 horas en la Luna.')
 const initialResponse=waitResponse('/api/automatic-plan')
 await page.locator('.primary-plan').click()
 const first=await initialResponse;assert.ok(first)
 const initial=await first.json(),initialSent=first.request().postDataJSON()
 referenceRequest=initialSent
 await page.locator('.best-destination').waitFor({timeout:30000})
 check('Reference calculation preserves the user slope and known NASA case',first.status()===200&&initial.counts.green===9&&initialSent.max_slope_deg===10)
 check('Reference height provenance is explicit',initial.meta.height_support.supported===true&&initial.meta.height_support.profile_height_m===2)
 const input=page.locator('input[type="file"]')
 check('File attachment only accepts supported text metadata',await input.getAttribute('accept')==='.json,.gltf')
 await rejectedUpload('empty-profile.json',{},1)
 await rejectedUpload('boolean-heights.json',{name:'Invalid booleans',solar_panel_height:true,antenna_height:true,center_of_gravity_tolerance:15},1)
 await rejectedUpload('unsupported.glb',Buffer.from([0x67,0x6c,0x54,0x46,2,0,0,0]),0,'model/gltf-binary')
 await rejectedUpload('oversized-profile.json',Buffer.alloc(1024*1024+1,0x20),0)
 const profile={name:'Equipo de prueba',solar_panel_height:50,antenna_height:38,center_of_gravity_tolerance:15}
 const rescueResponse=waitResponse('/api/mission-rescue')
 const tall=await uploadAndCalculate('tall-equipment.json',profile)
 const blockedResponse=await rescueResponse;assert.ok(blockedResponse)
 const blocked=await blockedResponse.json()
 check('Tall uploaded equipment preserves all original user criteria',unchangedUserCriteria(tall.sent))
 check('Tall equipment is preserved in the actual request and response',tall.sent.vehicle_profile.lander_name==='Equipo de prueba'&&tall.sent.vehicle_profile.solar_panel_height===50&&tall.sent.vehicle_profile.antenna_height===38&&tall.result.vehicle_profile.solar_panel_height===50)
 check('A generous vehicle tolerance never relaxes the user slope limit',tall.result.meta.requested_max_slope_deg===10&&tall.result.meta.effective_max_slope_deg===10)
 check('Unsupported heights never invent solar hours or favorable areas',tall.result.counts.green===0&&tall.result.counts.yellow===0&&tall.result.cells.every(c=>c.risk==='unknown'&&c.sun_hours===null&&c.earth_hours===null))
 check('Unsupported height provenance explains the available two-metre profiles',tall.result.meta.height_support.supported===false&&tall.result.meta.height_support.profile_height_m===2&&typeof tall.result.meta.height_support.reason==='string')
 check('Automatic rescue does not change equipment back to two metres',blockedResponse.status()===200&&blocked.status==='blocked'&&blocked.diagnosis.code==='unsupported_observer_height'&&blocked.proposals.length===0&&blocked.original_request.vehicle_profile.solar_panel_height===50&&blocked.original_request.vehicle_profile.antenna_height===38)
 check('Unsupported equipment cannot launch a NASA date search',blocked.meta.sources.length===0&&blocked.search.tested_scenarios===0)
 check('Unsupported equipment has no survival assertion',!JSON.stringify(tall.result).includes('starship_would_survive')&&!JSON.stringify(blocked).includes('starship_would_survive'))
 check('The results heading distinguishes unknown coverage from rejected areas',/FALTAN DATOS PARA EVALUAR ESTE PERFIL/.test(await page.locator('.decision-title').innerText()))
 check('The UI clearly explains unavailable height-specific horizons',/perfiles.*2 m|preparados de 2 m/.test(await page.getByTestId('mission-rescue').innerText()))
 await page.screenshot({path:path('vehicle-profile-unsupported.png'),fullPage:true})
 const strict=await uploadAndCalculate('strict-reference.json',{name:'Equipo 2 m · límite 5°',solar_panel_height:2,antenna_height:2,center_of_gravity_tolerance:5})
 check('A stricter vehicle tightens the effective slope without changing the user request',unchangedUserCriteria(strict.sent)&&strict.result.meta.requested_max_slope_deg===10&&strict.result.meta.effective_max_slope_deg===5)
 check('The 5-degree profile remains distinct from the user 10-degree requirement',strict.result.vehicle_profile.center_of_gravity_tolerance===5&&strict.sent.vehicle_profile.center_of_gravity_tolerance===5)
 const loose=await uploadAndCalculate('loose-reference.json',{name:'Equipo 2 m · límite 15°',solar_panel_height:2,antenna_height:2,center_of_gravity_tolerance:15})
 check('A less restrictive vehicle never loosens the original user constraint',unchangedUserCriteria(loose.sent)&&loose.result.meta.effective_max_slope_deg===10&&loose.result.vehicle_profile.center_of_gravity_tolerance===15)
 check('Equivalent effective constraints recover the known reference result',loose.result.counts.green===9&&loose.result.meta.height_support.supported===true)
 await page.locator('.composer-catalog-btn').click()
 await page.locator('.lunar-catalog-popover').waitFor()
 check('The catalog clearly labels unverified spacecraft examples',/Ejemplo hipotético/i.test(await page.locator('.lunar-catalog-popover').innerText())&&/No son especificaciones verificadas/i.test(await page.locator('.lunar-catalog-popover').innerText()))
 const back=waitResponse('/api/automatic-plan'),backReview=waitResponse('/api/copilot/lander-review')
 await page.locator('.catalog-item-btn').filter({hasText:'Referencia regional · 2 m'}).click()
 const backResponse=await back;assert.ok(backResponse);const restored=await backResponse.json(),restoredSent=backResponse.request().postDataJSON()
 await page.locator('.best-destination').waitFor()
 const reviewResponse=await backReview;assert.ok(reviewResponse,'The final reference must receive an actual lander review')
 const reviewed=await reviewResponse.json()
 check('The final profile receives a complete review with height-specific evidence',reviewResponse.status()===200&&reviewed.status==='ok'&&reviewed.height_support.supported===true&&reviewed.query_sources.length>=2)
 check('Review mode identifies AI or its explicit fallback reason',['ai','guide'].includes(reviewed.mode)&&(reviewed.mode==='ai'?typeof reviewed.model==='string':typeof reviewed.reason==='string'))
 await page.locator('.engineer-summary').waitFor()
 check('Selecting the prepared reference restores the validated case on the same page',restored.counts.green===9&&restored.meta.height_support.supported===true&&restored.vehicle_profile.solar_panel_height===2&&restored.vehicle_profile.antenna_height===2&&unchangedUserCriteria(restoredSent)&&new URL(page.url()).pathname===new URL(base).pathname)
 await frame()
 const visible=(await page.locator('body').innerText()).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 check('The UI makes no mechanical-CG, nominal-energy or guaranteed-link claim',!/cg.{0,30}(validado|validada)|energia nominal|enlace garantizado|starship.{0,30}sobrevive/.test(visible))
 for(const review of reviews){
  const text=JSON.stringify(review).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  check('The lander review avoids unverified survival and energy/link guarantees',!/energia nominal|enlace garantizado|starship.{0,30}sobrevive/.test(text))
 }
 const intervals=restored.best.time_series.slice(0,-1)
 for(const [target,index] of [['sun',0],['earth',1]]){
  const row=page.locator('.status-bar-row').nth(index),segments=row.locator('.bar-segments .seg')
  check(target+' timeline covers intervals without adding an hour at its final boundary',await segments.count()===restored.mission.surface_hours&&intervals.length===restored.mission.surface_hours)
  const visibleCount=intervals.filter(sample=>sample[target+'_elevation_deg']-sample[target+'_horizon_deg']>0.3).length
  check(target+' timeline matches NASA geometric clearance samples',await row.locator('.seg.'+target+'-ok').count()===visibleCount)
 }
 const sectorBefore=await page.locator('.selected-sector-id').innerText(),callsBefore=scientificRequestCount()
 await page.getByRole('button',{name:'Pantalla grande',exact:true}).click()
 check('The map can expand without replacing the active mission',await page.locator('.unified-mission.map-is-fullscreen').count()===1&&!await page.locator('.trip-panel').isVisible()&&!await page.locator('.mission-decisions').isVisible())
 await page.keyboard.press('Escape')
 check('Escape restores the selected sector and does not recalculate the mission',await page.locator('.unified-mission.map-is-fullscreen').count()===0&&await page.locator('.selected-sector-id').innerText()===sectorBefore&&scientificRequestCount()===callsBefore)
 await page.screenshot({path:path('vehicle-profile-reference.png'),fullPage:true})
 await page.setViewportSize({width:390,height:844})
 await page.locator('.composer-catalog-btn').click()
 const mobileCatalog=page.locator('.lunar-catalog-popover')
 await mobileCatalog.waitFor()
 await mobileCatalog.scrollIntoViewIfNeeded()
 const mobileReference=page.locator('.catalog-item-btn').filter({hasText:'Referencia regional'})
 await mobileReference.scrollIntoViewIfNeeded()
 await mobileReference.click({trial:true})
 check('The reference option is reachable with a normal touch-size viewport',true)
 const mobileDimensions=await mobileCatalog.evaluate(el=>({height:el.clientHeight,width:el.clientWidth,viewport:window.innerWidth}))
 check('The mobile catalog is height-limited and fits the viewport width',mobileDimensions.height<=360&&mobileDimensions.width<=mobileDimensions.viewport)
 await page.screenshot({path:path('vehicle-profile-catalog-mobile.png'),fullPage:false})
 const mobileLast=page.locator('.catalog-item-btn').last()
 await mobileLast.scrollIntoViewIfNeeded()
 await mobileLast.click({trial:true})
 check('The last catalog example is reachable through its own scroll area',true)
 await page.locator('.catalog-popover-head button').click()
 check('There are no uncaught browser errors',errors.length===0)
 check('There are no failed application network requests',failedRequests.length===0)
 await writeFile(path('vehicle-profile-integrity-report.json'),JSON.stringify({status:'ok',base,checks,errors,consoleErrors,failedRequests,requests,reviews,reviews_received:reviews.length,initial_counts:initial.counts,tall_counts:tall.result.counts,restored_counts:restored.counts},null,2))
 console.log(JSON.stringify({status:'ok',checks:checks.length,initial_counts:initial.counts,tall_counts:tall.result.counts,restored_counts:restored.counts}))
}catch(error){
 if(page)await page.screenshot({path:path('vehicle-profile-integrity-failure.png'),fullPage:true}).catch(()=>{})
 await writeFile(path('vehicle-profile-integrity-report.json'),JSON.stringify({status:'failed',base,error:String(error),checks,errors,consoleErrors,failedRequests,requests,reviews},null,2))
 console.error(JSON.stringify({status:'failed',error:String(error),checks,errors,consoleErrors,failedRequests}))
 process.exitCode=1
}finally{await browser.close()}
