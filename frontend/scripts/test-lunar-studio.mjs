import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[],checks=[]
const page=await browser.newPage({locale:'es-BO',viewport:{width:1600,height:1100},reducedMotion:'reduce'})
page.on('pageerror',e=>errors.push({at:checks.at(-1),stack:e.stack}))
const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log(name)}
try{
 await page.goto(process.env.LUNAR_ORACLE_TEST_URL||'http://127.0.0.1:5173/',{waitUntil:'domcontentloaded'})
 await page.waitForFunction(()=>document.querySelector('.primary-plan')&&!document.querySelector('.primary-plan').disabled,null,{timeout:60000})
 await page.getByRole('button',{name:'Objetos Lunares',exact:true}).click()
 const studio=page.locator('.lunar-object-studio-container')
 await studio.waitFor()
 check('Chat Lunar Objects opens the new 3D studio',await studio.locator('canvas').isVisible())
 await studio.getByRole('button',{name:'Pausar giro',exact:true}).click()
 check('Automatic rotation can be paused',await studio.getByRole('button',{name:'Girar 360°',exact:true}).count()===1)
 check('The simplified viewer omits the old dimension controls',await studio.getByRole('button',{name:'Cotas',exact:true}).count()===0)
 await studio.getByRole('button',{name:'Centrar',exact:true}).click()
 check('Camera reset responds in the simplified viewer',await studio.locator('canvas').isVisible())
 const objects=await studio.locator('.dock-item-btn').count()
 check('The new carousel includes all reference and vehicle examples',objects>=10)
 for(const name of ['Starship HLS','Rover VIPER (NASA)','Blue Moon MK2']){
  await studio.locator('.dock-item-btn').filter({hasText:name}).click()
  await page.waitForTimeout(400)
  check('The model and active selection update to '+name,(await studio.locator('.studio-title-badge h3').innerText()).includes(name))
 }
 await studio.locator('.dock-item-btn').filter({hasText:'Rover VIPER (NASA)'}).click()
 check('Rover telemetry includes its declared range',/10 km/.test(await studio.getByTestId('studio-hud-telemetry').innerText()))
 await page.screenshot({path:'artifacts/sync-main-studio-desktop.png',fullPage:false})
 await page.setViewportSize({width:390,height:844})
 check('The studio fits the mobile viewport',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
 await page.setViewportSize({width:1600,height:1100})
 await studio.getByRole('button',{name:'Volver al mapa',exact:true}).click()
 check('Return to map restores the lunar terrain',await studio.count()===0&&await page.getByTestId('mission-map').locator('canvas').isVisible())
 await page.getByRole('button',{name:'Vehículo 3D',exact:true}).click()
 await studio.waitFor()
 check('The map toolbar also opens the studio',await studio.locator('canvas').isVisible())
 for(let i=0;i<4;i++){
  await studio.getByRole('button',{name:'Centrar',exact:true}).click()
  await studio.getByRole('button',{name:'Volver al mapa',exact:true}).click()
  await page.getByRole('button',{name:'Vehículo 3D',exact:true}).click()
  await studio.waitFor()
 }
 await page.waitForTimeout(300)
 check('Repeated camera resets and scene changes preserve a working viewer',await studio.locator('canvas').isVisible())
 check('No uncaught application errors',errors.length===0)
 const report={status:'ok',base_commit:'eb30fb2',checks,errors}
 await writeFile('artifacts/sync-main-studio-report.json',JSON.stringify(report,null,2))
 console.log(JSON.stringify({status:'ok',checks:checks.length,errors}))
}catch(e){await page.screenshot({path:'artifacts/sync-main-studio-failure.png',fullPage:true}).catch(()=>{});console.error(JSON.stringify({error:String(e),checks,errors}));process.exitCode=1}finally{await browser.close()}
