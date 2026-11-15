/** End-to-end user journey: Gemini intent -> real NASA whole-cap plan -> one 3D map.
 * Run: node frontend/scripts/test-automatic-mission.mjs
 * LUNAR_ORACLE_TEST_URL may target local preview or the published application.
 */
import {chromium} from 'playwright'
import {mkdir,writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {inflateSync} from 'node:zlib'
import assert from 'node:assert/strict'
const base=process.env.LUNAR_ORACLE_TEST_URL||process.env.BASE_URL||'http://127.0.0.1:4173/'
const out=new URL('../../artifacts/',import.meta.url)
await mkdir(out,{recursive:true})
const example='si quiero hacer un viaje el 25 de diciembre de 2026 a las 8 am UTC−04:00 donde seria bueno caer y cuanto tardara la mision'
const checks=[],errors=[],failedRequests=[]
const browser=await chromium.launch({channel:'chrome',headless:true})
let page
function check(name,value=true){assert.ok(value,name);checks.push(name)}
const filepath=name=>fileURLToPath(new URL(name,out))
function watch(p){p.on('pageerror',e=>errors.push(e.message));p.on('requestfailed',r=>{if(r.failure()?.errorText!=='net::ERR_ABORTED')failedRequests.push({path:new URL(r.url()).pathname,error:r.failure()?.errorText})})}
const waitReady=p=>p.waitForFunction(()=>{const b=document.querySelector('.primary-plan');return b&&!b.disabled},null,{timeout:60000})
const apiResponse=(p,path)=>p.waitForResponse(r=>new URL(r.url()).pathname===path&&r.request().method()==='POST',{timeout:120000})
async function execute(p){
 const intentWait=apiResponse(p,'/api/mission-intent'),planWait=apiResponse(p,'/api/automatic-plan')
 await p.getByRole('button',{name:'Planificar mi misión',exact:true}).click()
 const intentResponse=await intentWait,intent=await intentResponse.json()
 check('Gemini intent response succeeds',intentResponse.status()===200)
 check('Intent extraction is explicitly identified as Gemini or fallback',intent.mode==='ai'||intent.mode==='parser')
 if(process.env.LUNAR_ORACLE_REQUIRE_AI==='1')check('A real connected Gemini model interprets the trip',intent.mode==='ai')
 checks.push({intent_mode:intent.mode})
 check('An explicit historical08:00 UTC−04:00 is interpreted as12:00 UTC',intent.intent.departure_utc==='2026-12-25T12:00:00Z')
 check('A travel date means departure, with declared 72-hour surface stay',intent.intent.date_kind==='departure'&&intent.intent.surface_hours===72)
 const planResponse=await planWait,plan=await planResponse.json(),sent=planResponse.request().postDataJSON()
 check('Planner executes automatically after intent with the same UTC and duration',sent.departure_utc===intent.intent.departure_utc&&sent.surface_hours===72)
 check('NASA plan response succeeds',planResponse.status()===200&&plan.status==='ok')
 check('All 12,892 south-polar zones are evaluated',plan.total_cells===12892&&Object.values(plan.counts).reduce((a,b)=>a+b,0)===12892)
 check('A green best candidate and separate green alternatives exist',plan.best?.risk==='green'&&plan.alternatives.length>=2&&plan.alternatives.every(c=>c.risk==='green'))
 check('Excluded red examples are preserved',plan.rejected.length>0&&plan.rejected.every(c=>c.risk==='red'))
 check('Unknown coverage is preserved',plan.counts.unknown>0)
 check('Transit is explicitly a two-body estimate',plan.mission.transfer_model.method==='TWO_BODY_ESTIMATE'&&plan.mission.arrival_rounding_minutes>=0)
 check('Timing adds outbound, stay and return',Math.abs(plan.mission.total_hours-plan.mission.outbound_hours-plan.mission.surface_hours-plan.mission.return_hours)<1e-5)
 check('Three exact NASA query sources are attached',plan.meta.sources.length===3&&plan.meta.sources.every(s=>s.query_url.startsWith('https://ssd.jpl.nasa.gov/api/horizons.api?')))
 await p.locator('.best-destination').waitFor({timeout:20000})
 await p.locator('.mission-marker-label.best').waitFor({timeout:20000})
 return {intent,plan}
}
// Decode Chrome's RGB/RGBA PNG to check actual rendered circle colors, excluding the map legend.
function colors(png,excludeBottom=100){
 let width,height,type,position=8,parts=[]
 while(position<png.length){const length=png.readUInt32BE(position),name=png.toString('ascii',position+4,position+8),data=png.subarray(position+8,position+8+length);if(name==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);type=data[9];assert.equal(data[8],8)}if(name==='IDAT')parts.push(data);position+=length+12}
 const channels=type===6?4:3;assert.ok(type===2||type===6)
 const raw=inflateSync(Buffer.concat(parts)),stride=width*channels,previous=new Uint8Array(stride);let offset=0,red=0,green=0,neutral=0,tealWash=0
 const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c}
 for(let y=0;y<height;y++){const filter=raw[offset++],row=new Uint8Array(stride)
  for(let x=0;x<stride;x++){const a=x>=channels?row[x-channels]:0,b=previous[x],c=x>=channels?previous[x-channels]:0,add=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c);row[x]=(raw[offset++]+add)&255}
  if(y<height-excludeBottom)for(let x=0;x<stride;x+=channels){const r=row[x],g=row[x+1],b=row[x+2];if(r>150&&r>g*1.35&&r>b*1.2)red++;if(g>140&&g>r*1.2&&g>b*1.1)green++;if(r>20&&Math.max(r,g,b)-Math.min(r,g,b)<35)neutral++;if(g>100&&g>r*1.17&&b>r*1.08)tealWash++}
  previous.set(row)
 }
 return {red,green,neutral,tealWash,width,height}
}
try{
 page=await browser.newPage({locale:'es-BO',viewport:{width:1600,height:1100},deviceScaleFactor:1,reducedMotion:'reduce'});watch(page)
 await page.goto(base,{waitUntil:'domcontentloaded'});await waitReady(page)
 check('Home opens directly without login',await page.getByLabel('Describe tu misión',{exact:true}).isVisible())
 check('The workflow has one visible application page',await page.getByTestId('unified-mission').count()===1&&await page.locator('a[href*="cockpit"],a[href*="planner"],a[href*="chatgpt"]').count()===0)
 check('Legacy second-page navigation is absent',await page.getByRole('button',{name:/Abrir estudio detallado|Herramientas científicas|Volver al cockpit/}).count()===0)
 await page.getByLabel('Describe tu misión',{exact:true}).fill(example)
 const result=await execute(page)
 check('The map displays a rendered canvas',await page.getByTestId('mission-map').locator('canvas').isVisible())
 check('The UI explains the estimated total mission duration',/Duración total estimada/.test(await page.locator('.trip-overview').innerText()))
 check('The UI displays all evaluated cells',/12[.,\s]?892/.test(await page.getByTestId('surface-coverage-summary').innerText()))
 check('The UI contains one best marker and green numbered alternatives',await page.locator('.mission-marker-label.best').count()===1&&await page.locator('.mission-marker-label:not(.rejected)').count()===1+result.plan.alternatives.length)
 check('The best and alternative circles are accessible map controls',await page.getByRole('button',{name:'Elegir mejor candidato',exact:true}).count()===1&&await page.getByRole('button',{name:/^Elegir alternativa /}).count()===result.plan.alternatives.length)
 check('Complete evaluation shows four area classes',await page.locator('.coverage-class').count()===4&&result.plan.counts.yellow>0)
 check('Sparse red example markers are replaced by the complete surface',await page.getByRole('button',{name:'Ver zona descartada',exact:true}).count()===0)
 check('Class areas conserve the complete spherical cap',Math.abs(Object.values(result.plan.coverage.by_class).reduce((a,c)=>a+c.area_km2,0)-result.plan.coverage.cap_area_km2)<.01)
 check('Unprepared boundary area remains unresolved',result.plan.coverage.unrepresented_area_km2>700&&result.plan.coverage.by_class.unknown.area_km2>=result.plan.coverage.unrepresented_area_km2)
 const rejected=result.plan.rejected[0]
 await page.locator('.coordinate-inspector summary').click()
 await page.getByLabel('Latitud a consultar',{exact:true}).fill(String(rejected.latitude_deg))
 await page.getByLabel('Longitud a consultar',{exact:true}).fill(String(rejected.longitude_deg))
 const cellResponse=apiResponse(page,'/api/automatic-plan/cell')
 await page.getByRole('button',{name:'Examinar área',exact:true}).click()
 const inspected=await cellResponse,inspectedBody=await inspected.json()
 check('Any excluded area can be inspected with its own physical timeline',inspected.status()===200&&inspectedBody.cell.id===rejected.id&&inspectedBody.cell.time_series.length===73)
 check('Excluded area explains its criteria and blocks descent',/No cumplen/.test(await page.locator('.selected-destination-title').innerText())&&await page.getByRole('button',{name:'Simular llegada a este destino',exact:true}).isDisabled())
 await page.locator('.coordinate-inspector summary').click()
 await page.getByRole('button',{name:'Elegir mejor candidato',exact:true}).click()
 await page.screenshot({path:filepath('automatic-plan-desktop.png'),fullPage:true})
 const circlePixels=colors(await page.getByTestId('mission-map').locator('canvas').screenshot())
 check('Green and red circles are rendered on the lunar surface',circlePixels.green>20&&circlePixels.red>20)
 checks.push({circlePixels})
 const readouts=await page.locator('.conditions-readouts').innerText()
 await page.getByLabel('Hora de la estancia',{exact:true}).fill('24')
 check('Changing timeline updates NASA-backed variables',readouts!==await page.locator('.conditions-readouts').innerText())
 await page.locator('.other-destinations button').first().click()
 check('Alternative selection stays in the same map and updates the destination',await page.locator('.other-destinations button.selected').count()===1&&new URL(page.url()).pathname===new URL(base).pathname)
 await page.locator('.best-destination').click()
 await page.getByRole('button',{name:'Simular llegada a este destino',exact:true}).click()
 await page.locator('.arrival-telemetry').waitFor()
 const initialTelemetry=await page.locator('.arrival-telemetry').innerText()
 await page.waitForFunction(before=>document.querySelector('.arrival-telemetry')?.textContent!==before,initialTelemetry,{timeout:15000})
 check('Physical descent updates altitude, speed and fuel in the same page',/Altura:/.test(initialTelemetry)&&/Velocidad:/.test(initialTelemetry)&&/Combustible:/.test(initialTelemetry)&&new URL(page.url()).pathname===new URL(base).pathname)
 await page.waitForFunction(()=>/Contacto|Impacto/.test(document.querySelector('.arrival-telemetry strong')?.textContent??''),null,{timeout:60000})
 check('The descent reaches a displayed contact outcome',/Contacto|Impacto/.test(await page.locator('.arrival-telemetry strong').innerText()))
 check('Landing keeps the selected NASA destination and the same map',await page.locator('.best-destination.selected').count()===1&&await page.getByTestId('mission-map').locator('canvas').isVisible())
 check('Regional marker circles do not cover the close-up landing view',await page.locator('.mission-marker-label').count()===0)
 const descentPixels=colors(await page.getByTestId('mission-map').locator('canvas').screenshot())
 const measuredArea=descentPixels.width*Math.max(1,descentPixels.height-100)
 check('Close-up lunar terrain stays gray without an oversized green wash',descentPixels.neutral/measuredArea>.05&&descentPixels.tealWash/measuredArea<.35)
 checks.push({descentPixels})
 await page.screenshot({path:filepath('automatic-plan-descent.png'),fullPage:true})
 await page.getByRole('button',{name:'Cambiar fecha o requisitos',exact:true}).click()
 await page.getByLabel('Estancia en la Luna',{exact:true}).selectOption('48')
 check('Changing stay invalidates old recommendations immediately',await page.locator('.best-destination').count()===0&&await page.locator('.mission-marker-label').count()===0)
 await page.getByLabel('Fecha de viaje',{exact:true}).fill('2026-12-26T07:00')
 check('Changing departure date keeps stale green results hidden',await page.locator('.best-destination').count()===0)
 await page.getByLabel('Fecha de viaje',{exact:true}).fill('2026-12-25T07:00')
 await page.getByLabel('Estancia en la Luna',{exact:true}).selectOption('72')
 const repeat=apiResponse(page,'/api/automatic-plan')
 await page.getByRole('button',{name:'Recalcular con estos cambios',exact:true}).click()
 check('Edited parameters can be recalculated without navigating',(await repeat).status()===200)
 await page.locator('.best-destination').waitFor()
 await page.getByRole('button',{name:'Cambiar fecha o requisitos',exact:true}).click()
 await page.setViewportSize({width:390,height:844})
 await page.getByTestId('mission-map').scrollIntoViewIfNeeded()
 await page.screenshot({path:filepath('automatic-plan-mobile.png'),fullPage:true})
 check('Mobile has no horizontal overflow',await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1))
 check('Mobile retains the interactive map',await page.getByTestId('mission-map').locator('canvas').isVisible())
 // Inject an upstream outage at the API boundary: the UI must never keep a prior green recommendation.
 await page.setViewportSize({width:1600,height:1100})
 // Changing surface duration must not silently lower explicit visibility requirements.
 const preferences=page.getByRole('button',{name:'Cambiar fecha o requisitos',exact:true})
 if(await preferences.getAttribute('aria-expanded')!=='true')await preferences.click()
 await page.getByLabel('Horas mínimas de Sol',{exact:true}).fill('50')
 await page.getByLabel('Estancia en la Luna',{exact:true}).selectOption('24')
 let invalidRequests=0
 const invalidCounter=request=>{if(new URL(request.url()).pathname==='/api/automatic-plan')invalidRequests++}
 page.on('request',invalidCounter)
 await page.getByRole('button',{name:'Recalcular con estos cambios',exact:true}).click()
 await page.getByRole('alert').waitFor()
 check('Incompatible criteria produce an error without reducing requested hours',/no se reducen automáticamente/.test(await page.getByRole('alert').innerText())&&invalidRequests===0&&await page.getByLabel('Horas mínimas de Sol',{exact:true}).inputValue()==='50')
 page.off('request',invalidCounter)
 await page.getByLabel('Horas mínimas de Sol',{exact:true}).fill('12')
 await page.getByLabel('Estancia en la Luna',{exact:true}).selectOption('72')
 // Main now keeps manual controls in a popover; close it before returning to the chat.
 await page.getByRole('button',{name:'Cerrar ajustes',exact:true}).click()
 await page.route('**/api/automatic-plan',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({status:'unavailable',message:'NASA temporalmente no disponible. No se ha calculado un destino.'})}))
 await page.getByLabel('Describe tu misión',{exact:true}).fill(example)
 const outage=apiResponse(page,'/api/automatic-plan')
 await page.getByRole('button',{name:'Planificar mi misión',exact:true}).click()
 check('The upstream outage is surfaced as 503',(await outage).status()===503)
 await page.getByRole('alert').waitFor()
 check('NASA failure produces an explicit error without fabricated recommendations',/NASA temporalmente/.test(await page.getByRole('alert').innerText())&&await page.locator('.best-destination').count()===0&&await page.locator('.mission-marker-label').count()===0)
 await page.screenshot({path:filepath('automatic-plan-unavailable.png'),fullPage:true})
 await page.unroute('**/api/automatic-plan')
 async function clarification(text,label){
  let scienceRequests=0
  const counter=request=>{if(new URL(request.url()).pathname==='/api/automatic-plan')scienceRequests++}
  page.on('request',counter)
  await page.getByLabel('Describe tu misión',{exact:true}).fill(text)
  const before=await page.locator('.mission-chat-thread').innerText()
  await page.getByRole('button',{name:'Planificar mi misión',exact:true}).click()
  await page.waitForFunction(previous=>document.querySelector('.mission-chat-thread')?.textContent!==previous&&!document.querySelector('.primary-plan').disabled,before,{timeout:60000})
  const thread=await page.locator('.mission-chat-thread').innerText()
  page.off('request',counter)
  check(label+' asks only for a missing or invalid field in the conversation',thread!==before&&/fecha|año|día|mes|calendario/i.test(thread)&&await page.locator('.trip-error').count()===0)
  check(label+' does not query science or retain green results',scienceRequests===0&&await page.locator('.best-destination').count()===0&&await page.locator('.mission-marker-label').count()===0)
 }
 await clarification('Quiero viajar el 30 de febrero de 2026 a las 8 am','An impossible calendar date')
 await clarification('Quiero viajar a la Luna, ¿dónde me recomiendas aterrizar?','A request without a departure date')
 check('No uncaught browser errors',errors.length===0)
 check('No failed application requests',failedRequests.length===0)
 await writeFile(filepath('automatic-plan-browser-report.json'),JSON.stringify({base,checks,errors,failedRequests,mission:result.plan.mission,counts:result.plan.counts},null,2))
 console.log(JSON.stringify({status:'ok',base,checks:checks.length,counts:result.plan.counts,screenshots:['artifacts/automatic-plan-desktop.png','artifacts/automatic-plan-mobile.png']},null,2))
}catch(error){
 if(page){await page.screenshot({path:filepath('automatic-plan-browser-failure.png'),fullPage:true}).catch(()=>{});await page.setViewportSize({width:390,height:844});await page.screenshot({path:filepath('automatic-plan-mobile.png'),fullPage:true}).catch(()=>{})}
 await writeFile(filepath('automatic-plan-browser-report.json'),JSON.stringify({base,checks,errors,failedRequests,error:String(error)},null,2))
 console.error(JSON.stringify({status:'failed',message:String(error),checks,errors,failedRequests},null,2));process.exitCode=1
}finally{await browser.close()}
