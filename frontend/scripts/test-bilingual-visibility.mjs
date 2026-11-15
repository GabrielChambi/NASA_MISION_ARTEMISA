/** End-to-end: latest main UI, English science, Earth diagnosis and locale invariance. */
import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import {mkdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
const base=process.env.LUNAR_ORACLE_TEST_URL||'http://127.0.0.1:5173/'
const out=new URL('../../artifacts/',import.meta.url);await mkdir(out,{recursive:true})
const path=name=>fileURLToPath(new URL(name,out))
const checks=[],errors=[],requests=[],failures=[]
const check=(name,ok)=>{assert.ok(ok,name);checks.push(name);console.log('PASS '+name)}
const browser=await chromium.launch({channel:'chrome',headless:true});let page,firstPlan
const waitApi=route=>page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===route,{timeout:180000})
const count=route=>requests.filter(r=>r.path===route).length
async function send(text){await page.getByRole('textbox',{name:'Describe your mission',exact:true}).fill(text);await page.getByRole('button',{name:'Plan my mission',exact:true}).click()}
try{
 page=await browser.newPage({locale:'es-BO',viewport:{width:1600,height:1100},reducedMotion:'reduce'})
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname.startsWith('/api/'))requests.push({path:new URL(r.url()).pathname,body:r.postDataJSON(),language:r.headers()['x-lunar-language']})});page.on('requestfailed',r=>{if(r.failure()?.errorText!=='net::ERR_ABORTED')failures.push({path:new URL(r.url()).pathname,error:r.failure()?.errorText})})
 await page.goto(base,{waitUntil:'domcontentloaded'})
 await page.waitForFunction(()=>document.querySelector('.primary-plan')&&!document.querySelector('.primary-plan').disabled,null,{timeout:60000})
 check('The newly pulled teammate greeting and icon toolbar are present',await page.locator('.copilot-robot-avatar').count()>0&&await page.locator('.composer-toolbar').count()>0)
 check('Spanish is available with no sign-in',await page.locator('html').getAttribute('lang')==='es'&&!/chatgpt.com|accounts.google/.test(page.url()))
 await page.getByRole('button',{name:'English',exact:true}).click()
 check('The visible language selector switches the application to English',await page.locator('html').getAttribute('lang')==='en'&&await page.getByRole('textbox',{name:'Describe your mission',exact:true}).count()===1)
 const initial=waitApi('/api/automatic-plan'),rescue=waitApi('/api/mission-rescue')
 await send('I want to travel on December 1, 2026 at 10am and stay 72 hours')
 firstPlan=await (await initial).json()
 check('An English request evaluates the entire south-pole cap with the Kennedy clock',firstPlan.total_cells===12892&&firstPlan.mission.requested_utc==='2026-12-01T15:00:00Z'&&firstPlan.mission.surface_hours===72)
 const diagnostic=page.getByTestId('visibility-diagnostic');await diagnostic.waitFor()
 await page.waitForFunction(()=>document.querySelector('[data-testid="visibility-diagnostic"]')?.dataset.state!=='unknown')
 const elevation=Number(await diagnostic.getAttribute('data-elevation-deg')),horizon=Number(await diagnostic.getAttribute('data-horizon-deg')),clearance=Number(await diagnostic.getAttribute('data-clearance-deg'))
 check('The Earth diagnostic exposes the actual difference between ephemeris and DEM horizon',Math.abs(elevation-horizon-clearance)<1e-10&&Number(await diagnostic.getAttribute('data-required-margin-deg'))===.3)
 check('The known December case is honestly occluded even when the 3D view seemed open',clearance<0&&await diagnostic.getAttribute('data-state')==='occluded')
 check('English labels distinguish geometry from a radio guarantee',/Center hidden|Center.*horizon/.test(await diagnostic.innerText())&&/Clearance|clearance/.test(await diagnostic.innerText()))
 await diagnostic.locator('summary').click()
 check('The view explains distant terrain, the enlarged illustration and unknown obstacle distance',/distant terrain|outside/.test(await diagnostic.innerText())&&/does not locate|not the distance/.test(await diagnostic.innerText())&&/radio-link/.test(await diagnostic.innerText()))
 const qaResponse=waitApi('/api/copilot/chat')
 await send('Why is Earth blocked in the view?')
 const qa=await (await qaResponse).json()
 check('The English copilot receives the same visibility angles as the diagnostic',qa.evidence.visibility.earth.elevation_deg===elevation&&Math.abs(qa.evidence.visibility.earth.clearance_deg-clearance)<1e-10)
 check('The scientific explanation respects the chosen English language',typeof qa.explanation==='string'&&/horizon|clearance|camera|Earth/i.test(qa.explanation)&&!/El centro|despeje|horizonte|La c.mara/.test(qa.explanation))
 await rescue
 check('English no-solution planning still launches the real bounded date search',count('/api/mission-rescue')===1&&await page.getByTestId('mission-rescue').count()===1)
 await page.getByRole('button',{name:'Zoom to destination',exact:true}).click()
 check('Zooming the camera does not change the scientific visibility diagnosis',Number(await diagnostic.getAttribute('data-elevation-deg'))===elevation&&await diagnostic.getAttribute('data-state')==='occluded')
 await diagnostic.scrollIntoViewIfNeeded()
 await page.screenshot({path:path('earth-visibility-english.png'),fullPage:false})
 const analyzed=count('/api/automatic-plan')
 await page.getByRole('button',{name:'Español',exact:true}).click()
 check('Switching to Spanish keeps the mission and does not rerun or change NASA science',await page.locator('html').getAttribute('lang')==='es'&&count('/api/automatic-plan')===analyzed&&Number(await diagnostic.getAttribute('data-clearance-deg'))===clearance&&/Centro oculto/.test(await diagnostic.innerText()))
 await page.getByRole('button',{name:'English',exact:true}).click()
 const text=await page.locator('.unified-mission').innerText()
 await writeFile(path('english-visible-text.txt'),text)
 const leftovers=text.match(/\b(?:Pendiente|Despeje|Alunizaje|Superficie|Paneles|Antena|Sol|Tierra|Calculando|Estancia)\b/g)||[]
 check('Main mission, terrain and science labels are English throughout',leftovers.length===0)
 await page.setViewportSize({width:390,height:844})
 check('The bilingual interface fits a mobile viewport',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
 await page.screenshot({path:path('earth-visibility-english-mobile.png'),fullPage:true})
 await page.setViewportSize({width:1600,height:1100})
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('.primary-plan')&&!document.querySelector('.primary-plan').disabled,null,{timeout:60000})
 check('The selected language persists after reloading',await page.locator('html').getAttribute('lang')==='en')
 const missing=waitApi('/api/mission-intent')
 await send('I want to travel on December 1 at 10am')
 const clarification=await (await missing).json()
 check('An English request with a missing year asks only for that year in English',clarification.needs_clarification===true&&/year/i.test(clarification.question)&&!/año|fecha/.test(clarification.question))
 const completed=waitApi('/api/automatic-plan')
 await send('2026')
 check('A short English-context clarification completes the original date',(await (await completed).json()).mission.requested_utc==='2026-12-01T15:00:00Z')
 const christmas=waitApi('/api/automatic-plan'),native=waitApi('/api/operations/analyze')
 await send('I want to travel on December 25, 2026 at 8am and stay 72 hours')
 const full=await (await christmas).json();await native
 check('An English date change preserves whole-cap analysis and operational studies',full.mission.requested_utc==='2026-12-25T13:00:00Z'&&full.total_cells===12892)
 const hardware=waitApi('/api/operations/analyze')
 await send('Change the battery to one thousand Wh')
 const changed=await (await hardware).json()
 check('A spoken-number English command runs the real battery model with the exact value',changed.affected.budget.config.battery_capacity_wh===1000&&changed.affected.request.surface_hours===72)
 const fault=waitApi('/api/operations/analyze')
 await send('What if solar panels produce 20% less?')
 const solar=await (await fault).json()
 check('An English failure experiment retains hardware and applies exactly twenty percent',solar.affected.budget.fault.solar_loss_fraction===.2&&solar.affected.budget.config.battery_capacity_wh===1000)
 check('English scientific API calls carry the selected response language',requests.filter(r=>r.path==='/api/copilot/chat').every(r=>r.language==='en'))
 check('There are no uncaught browser errors or failed non-cancelled requests',errors.length===0&&failures.length===0)
 await writeFile(path('bilingual-visibility-browser-report.json'),JSON.stringify({status:'ok',checks,errors,failures,case:{departure_utc:firstPlan.mission.requested_utc,elevation_deg:elevation,horizon_deg:horizon,clearance_deg:clearance}},null,2))
 console.log(JSON.stringify({status:'ok',checks:checks.length,errors,earth_clearance_deg:clearance}))
}catch(error){
 if(page&&!page.isClosed()){await page.screenshot({path:path('bilingual-visibility-browser-failure.png'),fullPage:true}).catch(()=>{});await writeFile(path('english-failure-text.txt'),await page.locator('body').innerText().catch(()=>''))}
 await writeFile(path('bilingual-visibility-browser-report.json'),JSON.stringify({status:'failed',error:String(error),checks,errors,failures,requests},null,2));console.error(JSON.stringify({status:'failed',error:String(error),checks,errors,failures}));process.exitCode=1
}finally{await browser.close()}
