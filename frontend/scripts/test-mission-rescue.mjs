
/** Real NASA mission-rescue journey. Only failure/cancellation boundaries are intercepted. */
import {chromium} from 'playwright'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const base=process.env.LUNAR_ORACLE_TEST_URL||'http://127.0.0.1:5173/'
const out=new URL('../../artifacts/',import.meta.url)
await mkdir(out,{recursive:true})
const file=name=>fileURLToPath(new URL(name,out))
const REQUEST='quiero viajar el 1 de diciembre de 2026 a las 10am UTC−04:00'
const CHRISTMAS='Quiero viajar el 25 de diciembre de 2026 a las 8 am UTC−04:00 y estar 72 horas en la Luna.'
const checks=[],errors=[],consoleErrors=[],failedRequests=[],requests=[]
const browser=await chromium.launch({channel:'chrome',headless:true})
let page,realRescue,originalPlan,adoptedPlan
const check=(label,condition)=>{assert.ok(condition,label);checks.push(label)}
const responseFor=(p,path)=>p.waitForResponse(r=>new URL(r.url()).pathname===path&&r.request().method()==='POST',{timeout:120000}).catch(()=>null)
const frame=p=>p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
async function fresh(){
 const p=await browser.newPage({viewport:{width:1600,height:1100},deviceScaleFactor:1,reducedMotion:'reduce'})
 p.on('pageerror',e=>errors.push(e.message))
 p.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text())})
 p.on('requestfailed',request=>{if(request.failure()?.errorText!=='net::ERR_ABORTED')failedRequests.push({path:new URL(request.url()).pathname,error:request.failure()?.errorText})})
 p.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname.startsWith('/api/'))requests.push({page:p,path:new URL(request.url()).pathname,body:request.postDataJSON()})})
 await p.goto(base,{waitUntil:'domcontentloaded'})
 await p.waitForFunction(()=>document.querySelector('.primary-plan')&&!document.querySelector('.primary-plan').disabled,null,{timeout:60000})
 page=p;return p
}
async function calculate(p,text=REQUEST){
 await p.getByLabel('Describe tu misión',{exact:true}).fill(text)
 const intent=responseFor(p,'/api/mission-intent'),plan=responseFor(p,'/api/automatic-plan')
 await p.getByRole('button',{name:'Planificar mi misión',exact:true}).click()
 const [ir,pr]=await Promise.all([intent,plan])
 assert.ok(ir&&pr,'Both interpretation and scientific calculation must finish')
 assert.equal(ir.status(),200);assert.equal(pr.status(),200)
 return {intent:await ir.json(),plan:await pr.json(),sent:pr.request().postDataJSON()}
}
function sameCriteria(actual,expected){
 return ['date_kind','surface_hours','max_slope_deg','min_sun_hours','min_earth_hours','observer_height_m'].every(key=>actual[key]===expected[key])
}
function holdSearch(p,payload){
 let releaseGate,entered
 const gate=new Promise(resolve=>{releaseGate=resolve}),received=new Promise(resolve=>{entered=resolve}),finishes=[]
 const handler=async route=>{
  let finish;finishes.push(new Promise(resolve=>{finish=resolve}))
  entered(route.request().postDataJSON())
  await gate
  try{await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)})}catch{/* An aborted browser request cannot consume the delayed result. */}
  finally{finish()}
 }
 return {handler,received,release:async()=>{releaseGate();await Promise.all(finishes);await frame(p)}}
}
try{
 // Positive path: all science comes from the running backend and original NASA records.
 const main=await fresh(),rescueResponse=responseFor(main,'/api/mission-rescue')
 const first=await calculate(main);originalPlan=first.plan
 check('The exact December request becomes 1 December 14:00 UTC',first.intent.intent.departure_utc==='2026-12-01T14:00:00Z'&&first.intent.intent.date_kind==='departure')
 check('The original whole-cap NASA analysis honestly has no favorable candidate',first.plan.best===null&&first.plan.counts.green===0&&first.plan.total_cells===12892)
 const rescued=await rescueResponse
 assert.ok(rescued);realRescue=await rescued.json()
 check('A no-solution result automatically starts the scientific rescue search',rescued.status()===200&&realRescue.status==='found')
 check('Search preserves the exact original mission and requirements',realRescue.criteria_preserved===true&&realRescue.original_request.departure_utc===first.sent.departure_utc&&sameCriteria(realRescue.original_request,first.sent))
 check('Search is bounded and documents evaluated starts',realRescue.search.search_days===14&&realRescue.search.tested_offsets_hours.length>14&&realRescue.search.refine_step_hours===1)
 check('The diagnosis reports actual original blockers',realRescue.diagnosis.original_green===0&&realRescue.diagnosis.blockers.some(blocker=>blocker.count>0))
 check('Three alternatives carry real JPL source provenance',realRescue.proposals.length===3&&realRescue.meta.sources.length===3&&realRescue.meta.sources.every(s=>new URL(s.query_url).hostname==='ssd.jpl.nasa.gov'))
 check('Every alternative retains constraints and is green under the same model',realRescue.proposals.every(p=>p.criteria_preserved===true&&p.best.risk==='green'&&sameCriteria(p.proposed_request,first.sent)))
 check('The earliest evaluated feasible alternative is 7 December 16:00 UTC',realRescue.proposals[0].proposed_request.departure_utc==='2026-12-07T16:00:00Z'&&realRescue.proposals[0].delta_hours===146)
 await main.waitForFunction(()=>document.querySelectorAll('.apply-rescue').length===3)
 check('Suggestions do not silently replace the failed original scenario',await main.locator('.best-destination').count()===0&&await main.getByTestId('adopted-alternative').count()===0&&(await main.locator('.trip-overview').innerText()).includes('01 dic'))
 await main.getByTestId('mission-rescue').scrollIntoViewIfNeeded()
 await main.screenshot({path:file('mission-rescue-options-desktop.png'),fullPage:true})
 await main.setViewportSize({width:390,height:844})
 await main.getByTestId('mission-rescue').scrollIntoViewIfNeeded()
 check('All alternative controls remain available on mobile without horizontal overflow',await main.locator('.apply-rescue').count()===3&&await main.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1))
 await main.screenshot({path:file('mission-rescue-options-mobile.png'),fullPage:true})
 await main.setViewportSize({width:1600,height:1100})
 const appliedResponse=responseFor(main,'/api/automatic-plan')
 await main.getByRole('button',{name:'Aplicar y recalcular',exact:true}).first().click()
 const applied=await appliedResponse
 assert.ok(applied);adoptedPlan=await applied.json()
 check('Applying a proposal runs a fresh complete analysis of all 12,892 sectors',applied.status()===200&&adoptedPlan.total_cells===12892&&adoptedPlan.best?.risk==='green')
 check('Adoption changes only the requested date, preserving every scientific criterion',applied.request().postDataJSON().departure_utc==='2026-12-07T16:00:00Z'&&sameCriteria(applied.request().postDataJSON(),first.sent))
 check('The adopted full-map answer matches the independently searched candidate',adoptedPlan.best.id===realRescue.proposals[0].best.id&&adoptedPlan.best.id==='polar:32:95'&&adoptedPlan.counts.green===1&&adoptedPlan.best.sun_hours===72&&adoptedPlan.best.earth_hours===72)
 await main.getByTestId('adopted-alternative').waitFor()
 const banner=await main.getByTestId('adopted-alternative').innerText()
 check('The adoption banner distinguishes the original and proposed dates',banner.includes('01 dic')&&banner.includes('07 dic')&&banner.includes('09:00')&&banner.includes('11:00'))
 const appliedText=await main.getByLabel('Describe tu misión',{exact:true}).inputValue()
 check('The visible request now reflects the explicitly adopted date and requirements',appliedText!==REQUEST&&appliedText.includes('7 de diciembre de 2026')&&appliedText.includes('11:00')&&appliedText.includes('72 horas')&&appliedText.includes('10 grados'))
 await main.getByTestId('operational-windows').waitFor()
 check('Operational cards describe both Sun and Earth clearance',await main.locator('.operation-card').count()===2&&/Despeje exigido/.test(await main.getByTestId('operational-windows').innerText()))
 const before=await main.locator('.conditions-readouts').innerText()
 await main.getByLabel('Hora de la estancia',{exact:true}).fill('24')
 check('NASA-backed variables still change after adopting an alternative',before!==await main.locator('.conditions-readouts').innerText())
 await main.getByLabel('Hora de la estancia',{exact:true}).fill('72')
 check('At coverage end both operational cards explicitly refuse extrapolation',await main.getByText('Fin del intervalo calculado',{exact:true}).count()===2&&await main.getByText('No se extrapolan condiciones posteriores.',{exact:true}).count()===2)
 await main.getByLabel('Hora de la estancia',{exact:true}).fill('0')
 await main.locator('.mission-decisions').evaluate(element=>{element.scrollTop=0})
 await main.screenshot({path:file('mission-rescue-adopted-desktop.png'),fullPage:true})
 const downloadEvent=main.waitForEvent('download')
 await main.getByRole('button',{name:'Descargar plan y evidencia',exact:true}).click()
 const download=await downloadEvent,exportPath=file('mission-rescue-adopted-export.json')
 await download.saveAs(exportPath)
 const exported=JSON.parse(await readFile(exportPath,'utf8'))
 check('Downloaded evidence preserves the original request and the adopted alternative separately',exported.adopted_alternative?.original_text===REQUEST&&exported.adopted_alternative.original.departure_utc==='2026-12-01T14:00:00Z'&&exported.adopted_alternative.proposal.proposed_request.departure_utc==='2026-12-07T16:00:00Z'&&exported.user_request===appliedText)
 const searchesBeforeReplan=requests.filter(r=>r.page===main&&r.path==='/api/mission-rescue').length
 const reaffirmed=await calculate(main,appliedText)
 await main.locator('.best-destination').waitFor()
 check('Planning again uses the adopted date instead of reverting to the failed original',reaffirmed.sent.departure_utc==='2026-12-07T16:00:00Z'&&sameCriteria(reaffirmed.sent,first.sent)&&reaffirmed.plan.best?.id==='polar:32:95'&&requests.filter(r=>r.page===main&&r.path==='/api/mission-rescue').length===searchesBeforeReplan)
 await main.close()

 // Negative boundary: cancel an in-flight search, then retry using the real API.
 const cancelled=await fresh(),held=holdSearch(cancelled,realRescue)
 await cancelled.route('**/api/mission-rescue',held.handler)
 await calculate(cancelled);await held.received
 await cancelled.getByRole('button',{name:'Cancelar búsqueda',exact:true}).waitFor()
 await cancelled.getByRole('button',{name:'Cancelar búsqueda',exact:true}).click()
 check('Cancellation leaves the original scenario and removes the active search state',await cancelled.getByTestId('mission-rescue').getAttribute('aria-busy')==='false'&&await cancelled.locator('.apply-rescue').count()===0&&await cancelled.locator('.best-destination').count()===0)
 await held.release()
 check('A late cancelled response cannot manufacture visible proposals',await cancelled.locator('.apply-rescue').count()===0)
 await cancelled.unroute('**/api/mission-rescue',held.handler)
 const retry=responseFor(cancelled,'/api/mission-rescue')
 await cancelled.getByRole('button',{name:'Volver a buscar',exact:true}).click()
 const retried=await retry
 assert.ok(retried);const retryData=await retried.json()
 await cancelled.waitForFunction(()=>document.querySelectorAll('.apply-rescue').length===3)
 check('Retry reaches NASA-backed search again and restores valid alternatives',retried.status()===200&&retryData.status==='found'&&retryData.proposals[0].delta_hours===146)
 await cancelled.close()

 // Negative boundary: an unavailable upstream search never creates a successful mission.
 const outage=await fresh()
 await outage.route('**/api/mission-rescue',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({status:'unavailable',criteria_preserved:true,proposals:[],message:'NASA temporalmente no disponible para buscar alternativas.'})}))
 await calculate(outage)
 await outage.locator('.rescue-error').waitFor()
 check('NASA search outages remain explicit without changing the original result',/NASA temporalmente/.test(await outage.locator('.rescue-error').innerText())&&await outage.locator('.apply-rescue').count()===0&&await outage.locator('.best-destination').count()===0)
 check('An unavailable search offers a retry without inventing a new date',await outage.getByRole('button',{name:'Volver a buscar',exact:true}).isVisible()&&await outage.getByTestId('adopted-alternative').count()===0)
 await outage.screenshot({path:file('mission-rescue-unavailable.png'),fullPage:true})
 await outage.close()

 // Negative boundary: editing the mission aborts and invalidates a pending old search.
 const stale=await fresh(),old=holdSearch(stale,realRescue)
 await stale.route('**/api/mission-rescue',old.handler)
 await calculate(stale);await old.received
 await stale.getByRole('button',{name:'Cancelar búsqueda',exact:true}).waitFor()
 await stale.getByLabel('Describe tu misión',{exact:true}).fill(CHRISTMAS)
 await old.release()
 check('Editing invalidates stale recommendations and a late response cannot reappear',await stale.getByTestId('mission-rescue').count()===0&&await stale.locator('.apply-rescue').count()===0&&await stale.locator('.best-destination').count()===0)
 await stale.unroute('**/api/mission-rescue',old.handler)
 const previousRequests=requests.filter(r=>r.page===stale&&r.path==='/api/mission-rescue').length
 const feasible=await calculate(stale,CHRISTMAS)
 await stale.locator('.best-destination').waitFor()
 await frame(stale)
 check('An already feasible date does not automatically launch rescue search',feasible.plan.best?.risk==='green'&&requests.filter(r=>r.page===stale&&r.path==='/api/mission-rescue').length===previousRequests&&await stale.getByTestId('mission-rescue').count()===0)
 check('The new feasible request retains its own December date',feasible.sent.departure_utc==='2026-12-25T12:00:00Z'&&await stale.getByLabel('Describe tu misión',{exact:true}).inputValue()===CHRISTMAS)
 await stale.close()
 check('No uncaught JavaScript errors occurred',errors.length===0)
 check('No application request failed except explicitly cancelled requests',failedRequests.length===0)
 await writeFile(file('mission-rescue-browser-report.json'),JSON.stringify({status:'ok',base,checks,original:{counts:originalPlan.counts,mission:originalPlan.mission},rescue:realRescue,adopted:{counts:adoptedPlan.counts,mission:adoptedPlan.mission,best:adoptedPlan.best.id},errors,consoleErrors,failedRequests},null,2))
 console.log(JSON.stringify({status:'ok',base,checks:checks.length,first_proposal:realRescue.proposals[0].proposed_request.departure_utc,delay_hours:realRescue.proposals[0].delta_hours,adopted_best:adoptedPlan.best.id}))
}catch(error){
 if(page&&!page.isClosed())await page.screenshot({path:file('mission-rescue-failure.png'),fullPage:true}).catch(()=>{})
 await writeFile(file('mission-rescue-browser-report.json'),JSON.stringify({status:'failed',base,checks,error:String(error),errors,consoleErrors,failedRequests},null,2))
 console.error(JSON.stringify({status:'failed',error:String(error),checks,errors,consoleErrors,failedRequests},null,2));process.exitCode=1
}finally{await browser.close()}
