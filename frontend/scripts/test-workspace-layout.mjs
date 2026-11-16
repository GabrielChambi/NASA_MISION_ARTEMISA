/** Browser regression: resize handle must receive clicks inside the clipped chat panel. */
import {chromium} from 'playwright'
import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
const browser=await chromium.launch({channel:'chrome',headless:true}),errors=[],checks=[]
const page=await browser.newPage({locale:'es-BO',viewport:{width:1600,height:1100},reducedMotion:'reduce'})
page.on('pageerror',e=>errors.push(e.message))
const check=(name,value)=>{assert.ok(value,name);checks.push(name)}
try{
 await page.goto('http://127.0.0.1:5173/',{waitUntil:'domcontentloaded'})
 await page.waitForFunction(()=>document.querySelector('.primary-plan')&&!document.querySelector('.primary-plan').disabled)
 const panel=page.locator('.trip-panel'),before=(await panel.boundingBox()).width
 const handle=await page.getByRole('separator').boundingBox()
 await page.mouse.move(handle.x+handle.width/2,handle.y+150)
 await page.mouse.down()
 await page.mouse.move(handle.x+155,handle.y+150,{steps:12})
 await page.mouse.up()
 await page.waitForFunction(w=>document.querySelector('.trip-panel').getBoundingClientRect().width>w+100,before)
 check('Dragging the chat edge changes its width',true)
 check('Resizing stops cleanly on mouse release',!await page.locator('body').evaluate(e=>e.classList.contains('is-resizing-chat')))
 const saved=await page.evaluate(()=>Number(localStorage.getItem('lunar_oracle_chat_width')))
 await page.reload({waitUntil:'domcontentloaded'})
 await page.waitForFunction(()=>document.querySelector('.primary-plan')&&!document.querySelector('.primary-plan').disabled)
 check('Chat width is restored after reload',Math.abs((await panel.boundingBox()).width-saved)<3)
 await page.getByRole('button',{name:'Alternar panel de chat',exact:true}).click()
 check('The header control hides the chat',await panel.count()===0)
 await page.getByRole('button',{name:'Alternar panel de chat',exact:true}).click()
 await panel.waitFor()
 check('The header control restores the chat',true)
 const canvas=page.getByTestId('mission-map').locator('canvas');await canvas.waitFor()
 let hit=null
 for(const [x,y] of [[.5,.6],[.5,.72],[.5,.5],[.4,.65],[.6,.65],[.5,.8]]){
  const r=await canvas.boundingBox()
  await page.mouse.move(r.x+r.width*x,r.y+r.height*y)
  await page.waitForTimeout(300)
  if(await page.locator('.surface-hover-pin-hint').isVisible()){hit={x:r.x+r.width*x,y:r.y+r.height*y};break}
 }
 check('The new pin hint appears while hovering the lunar surface',hit!==null)
 const count=await page.locator('.gemini-msg.assistant').count()
 await page.mouse.click(hit.x,hit.y)
 await page.locator('.pin-target-chip').waitFor()
 check('Clicking the terrain places a pin',true)
 check('Placing a pin does not add an assistant message',await page.locator('.gemini-msg.assistant').count()===count)
 await page.screenshot({path:'artifacts/latest-main-desktop.png',fullPage:false})
 await page.setViewportSize({width:390,height:844})
 check('The updated layout fits mobile width',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
 await page.screenshot({path:'artifacts/latest-main-mobile.png',fullPage:false})
 check('No uncaught application errors',errors.length===0)
 await writeFile('artifacts/latest-main-layout-report.json',JSON.stringify({status:'passed',checks,errors},null,2))
 console.log(JSON.stringify({status:'passed',checks:checks.length,errors}))
}catch(error){await page.screenshot({path:'artifacts/latest-main-layout-failure.png'}).catch(()=>{});await writeFile('artifacts/latest-main-layout-report.json',JSON.stringify({status:'failed',checks,errors,error:String(error)},null,2));throw error}finally{await browser.close()}
