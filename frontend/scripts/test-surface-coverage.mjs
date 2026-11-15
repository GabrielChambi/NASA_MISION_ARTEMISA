
/** Real full-surface E2E: no mocked science or inference. Run against the local application. */
import {chromium} from 'playwright'
import {mkdir,writeFile} from 'node:fs/promises'
import {inflateSync} from 'node:zlib'
import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
const base=process.env.LUNAR_ORACLE_TEST_URL||'http://127.0.0.1:5173/'
const out=new URL('../../artifacts/',import.meta.url)
await mkdir(out,{recursive:true})
const path=name=>fileURLToPath(new URL(name,out))
const checks=[],errors=[],consoleErrors=[],requestsFailed=[],selections=[]
const browser=await chromium.launch({channel:'chrome',headless:true})
let page
const check=(label,condition)=>{assert.ok(condition,label);checks.push(label)}
const responseFor=(pathname)=>page.waitForResponse(r=>new URL(r.url()).pathname===pathname&&r.request().method()==='POST',{timeout:120000})
function pixels(png){
 let width,height,type,offset=8,parts=[]
 while(offset<png.length){const length=png.readUInt32BE(offset),name=png.toString('ascii',offset+4,offset+8),data=png.subarray(offset+8,offset+8+length);if(name==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);type=data[9];assert.equal(data[8],8)}if(name==='IDAT')parts.push(data);offset+=length+12}
 const channels=type===6?4:3;assert.ok(type===2||type===6)
 const raw=inflateSync(Buffer.concat(parts)),stride=width*channels,rgba=new Uint8Array(width*height*4),previous=new Uint8Array(stride)
 const paeth=(a,b,c)=>{const p=a+b-c,x=Math.abs(p-a),y=Math.abs(p-b),z=Math.abs(p-c);return x<=y&&x<=z?a:y<=z?b:c}
 offset=0
 for(let y=0;y<height;y++){
  const filter=raw[offset++],row=new Uint8Array(stride)
  for(let x=0;x<stride;x++){const a=x>=channels?row[x-channels]:0,b=previous[x],c=x>=channels?previous[x-channels]:0,add=filter===0?0:filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):paeth(a,b,c);row[x]=(raw[offset++]+add)&255}
  for(let x=0;x<width;x++){const dst=(y*width+x)*4;rgba[dst]=row[x*channels];rgba[dst+1]=row[x*channels+1];rgba[dst+2]=row[x*channels+2];rgba[dst+3]=255}
  previous.set(row)
 }
 return {width,height,data:rgba}
}
function terrainAtViewportEdges(image,inset=8){
 const {width,height,data}=image
 let leftPixels=0,rightPixels=0,leftRun=0,rightRun=0,maxLeftRun=0,maxRightRun=0
 for(let y=Math.ceil(height*.22);y<height*.92;y++){
  let left=0,right=0
  const visible=x=>{const i=(y*width+x)*4,r=data[i],g=data[i+1],b=data[i+2];return Math.min(r,g,b)>28&&Math.max(r,g,b)-Math.min(r,g,b)<75}
  for(let x=0;x<inset;x++){if(visible(x))left++;if(visible(width-1-x))right++}
  leftPixels+=left;rightPixels+=right
  leftRun=left>=inset/2?leftRun+1:0;rightRun=right>=inset/2?rightRun+1:0
  maxLeftRun=Math.max(maxLeftRun,leftRun);maxRightRun=Math.max(maxRightRun,rightRun)
 }
 return {leftPixels,rightPixels,maxLeftRun,maxRightRun,inset,width,height}
}
function poseDifference(a,b){
 assert.equal(a.width,b.width);assert.equal(a.height,b.height)
 let changed=0,total=0
 for(let y=Math.round(a.height*.2);y<a.height*.93;y++)for(let x=0;x<a.width;x++){
  const i=(y*a.width+x)*4
  if(a.data[i]+a.data[i+1]+a.data[i+2]<50&&b.data[i]+b.data[i+1]+b.data[i+2]<50)continue
  total++
  if(Math.abs(a.data[i]-b.data[i])+Math.abs(a.data[i+1]-b.data[i+1])+Math.abs(a.data[i+2]-b.data[i+2])>15)changed++
 }
 return changed/Math.max(total,1)
}
function rasterDifference(evaluation,relief){
 assert.equal(evaluation.width,relief.width);assert.equal(evaluation.height,relief.height)
 const {width,height}=relief,tiles=Array.from({length:9},()=>({moon:0,changed:0}))
 let moon=0,changed=0
 for(let y=Math.ceil(height*.15);y<height*.94;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4,r=relief.data[i],g=relief.data[i+1],b=relief.data[i+2]
  if(Math.min(r,g,b)<25||Math.max(r,g,b)-Math.min(r,g,b)>45)continue
  const tile=tiles[Math.min(2,Math.floor(y/height*3))*3+Math.min(2,Math.floor(x/width*3))]
  moon++;tile.moon++
  if(Math.abs(r-evaluation.data[i])+Math.abs(g-evaluation.data[i+1])+Math.abs(b-evaluation.data[i+2])>10){changed++;tile.changed++}
 }
 return {moon,changed,changedFraction:changed/Math.max(moon,1),tiles,changedTiles:tiles.filter(t=>t.moon>300&&t.changed/t.moon>.25).length}
}
try{
 page=await browser.newPage({viewport:{width:1600,height:1100},deviceScaleFactor:1,reducedMotion:'reduce'})
 page.on('pageerror',error=>errors.push(error.message))
 page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text())})
 page.on('requestfailed',r=>{if(r.failure()?.errorText!=='net::ERR_ABORTED')requestsFailed.push({path:new URL(r.url()).pathname,error:r.failure()?.errorText})})
 await page.goto(base,{waitUntil:'domcontentloaded'})
 await page.waitForFunction(()=>{const b=document.querySelector('.primary-plan');return b&&!b.disabled},null,{timeout:60000})
 await page.getByLabel('Describe tu misión',{exact:true}).fill('Quiero viajar el 25 de diciembre de 2026 a las 8 am y estar 72 horas en la Luna.')
 const intentWait=responseFor('/api/mission-intent'),planWait=responseFor('/api/automatic-plan')
 await page.getByRole('button',{name:'Planificar mi misión',exact:true}).click()
 const intent=await (await intentWait).json(),planResponse=await planWait,plan=await planResponse.json()
 check('A real interpreted request automatically produces a full polar NASA plan',intent.status==='ok'&&planResponse.ok()&&plan.status==='ok')
 check('All regional results include source coordinates and class',plan.total_cells===12892&&plan.cells.length===12892&&plan.cells.every(c=>Number.isFinite(c.latitude_deg)&&Number.isFinite(c.longitude_deg)&&['green','yellow','red','unknown'].includes(c.risk)))
 check('The coverage budget includes every part of the spherical cap',Math.abs(Object.values(plan.coverage.by_class).reduce((n,c)=>n+c.area_km2,0)-plan.coverage.cap_area_km2)<.01)
 check('Missing boundary fragments remain unresolved',plan.coverage.unrepresented_area_km2>700&&plan.coverage.by_class.unknown.area_km2>=plan.coverage.unrepresented_area_km2)
 check('NASA provenance includes terrain hash and exact JPL queries',/^[a-f0-9]{64}$/.test(plan.meta.terrain_source_sha256)&&plan.meta.sources.every(s=>new URL(s.query_url).hostname==='ssd.jpl.nasa.gov'))
 await page.getByTestId('surface-coverage-summary').waitFor()
 await page.waitForTimeout(500)
 const canvas=page.locator('canvas')
 const colored=await canvas.screenshot()
 await page.getByRole('button',{name:'Ver relieve NASA',exact:true}).click()
 await page.waitForTimeout(350)
 const neutral=await canvas.screenshot()
 const difference=rasterDifference(pixels(colored),pixels(neutral))
 check('Surface colors affect a majority of actual terrain pixels, rather than only marker circles',difference.moon>50000&&difference.changedFraction>.5)
 check('Continuous classification is visible across at least six distant map regions',difference.changedTiles>=6)
 await writeFile(path('surface-analysis-evaluation-map.png'),colored)
 await writeFile(path('surface-analysis-relief-map.png'),neutral)
 await page.getByRole('button',{name:'Ver evaluación completa',exact:true}).click()
 await page.waitForTimeout(200)
 await page.mouse.move(40,90)
 await page.waitForTimeout(100)
 const initialPose=pixels(await canvas.screenshot()),initialBox=await canvas.boundingBox()
 await page.mouse.move(initialBox.x+initialBox.width*.5,initialBox.y+initialBox.height*.55)
 await page.mouse.down()
 await page.mouse.move(initialBox.x+initialBox.width*.65,initialBox.y+initialBox.height*.65,{steps:12})
 await page.mouse.up();await page.mouse.move(40,90)
 await page.waitForTimeout(600)
 const orbitPose=pixels(await canvas.screenshot())
 check('Dragging the actual lunar surface changes the camera without selecting a marker',poseDifference(initialPose,orbitPose)>.2)
 await page.getByRole('button',{name:'Todo el polo',exact:true}).click()
 await page.mouse.move(40,90);await page.waitForTimeout(600)
 const resetPose=pixels(await canvas.screenshot()),resetDrift=poseDifference(initialPose,resetPose)
 check('Todo el polo restores the complete-cap framing without residual orbit inertia',resetDrift<.005)
 await page.screenshot({path:path('surface-analysis-desktop.png'),fullPage:true})
 const markerIds=new Set([plan.best?.id,...plan.alternatives.map(c=>c.id)].filter(Boolean))
 const positions=[[.31,.39],[.49,.34],[.69,.40],[.29,.64],[.50,.64],[.70,.64]]
 for(const [x,y] of positions){
  const box=await canvas.boundingBox(),wait=responseFor('/api/automatic-plan/cell')
  await page.mouse.move(box.x+box.width*x,box.y+box.height*y)
  await page.mouse.click(box.x+box.width*x,box.y+box.height*y)
  const response=await wait,data=await response.json()
  check('A direct terrain click retrieves its own sector '+data.cell?.id,response.ok()&&data.status==='ok'&&data.cell?.id&&data.cell.id===response.request().postDataJSON().cell_id)
  check('Clicked sector is independent of the recommendation markers '+data.cell.id,!markerIds.has(data.cell.id))
  const row=data.cell.id.replace('polar:','')
  await page.waitForFunction(value=>document.querySelector('.selected-sector-id')?.textContent?.includes('Sector '+value+' ·'),row)
  selections.push({id:data.cell.id,risk:data.cell.risk,latitude_deg:data.cell.latitude_deg,longitude_deg:data.cell.longitude_deg})
 }
 check('Six map positions inspect six distinct sectors',new Set(selections.map(c=>c.id)).size===6)
 check('Selection spans separate lunar longitudes',Math.max(...selections.map(c=>c.longitude_deg))-Math.min(...selections.map(c=>c.longitude_deg))>100)
 const surface=await (await page.request.get(new URL('/api/polar/surface',base).href)).json()
 const inspect=page.locator('.coordinate-inspector')
 if(!await inspect.getAttribute('open'))await inspect.locator('summary').click()
 async function inspectCoordinate(latitude,longitude){
  await page.getByLabel('Latitud a consultar',{exact:true}).fill(String(latitude))
  await page.getByLabel('Longitud a consultar',{exact:true}).fill(String(longitude))
  await page.getByRole('button',{name:'Examinar área',exact:true}).click()
 }
 const marginal=plan.cells.find(c=>c.risk==='yellow')
 check('Sensitivity classification exposes marginal sectors',Boolean(marginal))
 const marginalWait=responseFor('/api/automatic-plan/cell')
 await inspectCoordinate(marginal.latitude_deg,marginal.longitude_deg)
 const marginalData=await (await marginalWait).json()
 check('A marginal sector remains yellow with its own hourly conditions',marginalData.cell.risk==='yellow'&&marginalData.cell.time_series.length===plan.mission.surface_hours+1)
 await page.waitForFunction(()=>document.querySelector('.selected-color')?.classList.contains('yellow'))
 check('Marginal sector cannot run a falsely favorable landing',await page.locator('.simulate-arrival').isDisabled())
 let edge=null
 for(let longitude=-179;longitude<180;longitude++){
  const rho=2*surface.radius_m*Math.tan((90-80.001)*Math.PI/360),a=longitude*Math.PI/180
  const col=Math.floor((rho*Math.sin(a)-surface.grid.xmin)/surface.cell_spacing_m),row=Math.floor((surface.grid.ymax-rho*Math.cos(a))/surface.cell_spacing_m)
  const cell=surface.cells[row*surface.grid_size+col]
  if(cell&&!plan.cells.some(c=>c.id===cell.id)){edge={latitude:-80.001,longitude,id:cell.id};break}
 }
 check('The 80 S rim contains explicit unmeasured edge fragments',Boolean(edge))
 await inspectCoordinate(edge.latitude,edge.longitude)
 await page.waitForFunction(id=>document.querySelector('.selected-sector-id')?.textContent?.includes(id.replace('polar:','')),edge.id)
 check('Boundary inspection preserves unknown instead of snapping to an interior candidate',await page.locator('.selected-color.unknown').count()===1&&await page.locator('.simulate-arrival').isDisabled())
 await page.getByRole('button',{name:'Todo el polo',exact:true}).click()
 await page.screenshot({path:path('surface-analysis-unknown.png'),fullPage:true})
 await page.setViewportSize({width:390,height:844})
 await canvas.scrollIntoViewIfNeeded();await page.waitForTimeout(300)
 const unknownMobilePose=pixels(await canvas.screenshot()),unknownMobileRim=terrainAtViewportEdges(unknownMobilePose)
 check('Unknown edge selection does not crop the lunar terrain at mobile screen edges',unknownMobileRim.maxLeftRun<12&&unknownMobileRim.maxRightRun<12&&unknownMobileRim.leftPixels<160&&unknownMobileRim.rightPixels<160)
 const mobileBox=await canvas.boundingBox()
 await page.mouse.move(mobileBox.x+mobileBox.width*.5,mobileBox.y+mobileBox.height*.55)
 await page.mouse.down();await page.mouse.move(mobileBox.x+mobileBox.width*.72,mobileBox.y+mobileBox.height*.68,{steps:10});await page.mouse.up();await page.mouse.move(5,5)
 await page.waitForTimeout(300)
 await page.getByRole('button',{name:'Todo el polo',exact:true}).click()
 await page.mouse.move(5,5);await page.waitForTimeout(300)
 const unknownResetPose=pixels(await canvas.screenshot()),unknownResetDrift=poseDifference(unknownMobilePose,unknownResetPose)
 check('Todo el polo restores the mobile cap even when the selected center has no terrain height',unknownResetDrift<.005)
 await page.screenshot({path:path('surface-analysis-mobile-unknown.png'),fullPage:true})
 await page.getByRole('button',{name:'Elegir mejor candidato',exact:true}).click()
 await page.waitForTimeout(300)
 const bestMobileRim=terrainAtViewportEdges(pixels(await canvas.screenshot()))
 check('The best-candidate mobile view also preserves both complete lunar edges',bestMobileRim.maxLeftRun<12&&bestMobileRim.maxRightRun<12&&bestMobileRim.leftPixels<160&&bestMobileRim.rightPixels<160)
 await page.screenshot({path:path('surface-analysis-mobile.png'),fullPage:true})
 check('Mobile complete-surface UI stays within the viewport',await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth))
 const gl=await canvas.evaluate(canvas=>canvas.getContext('webgl2')?.getError())
 check('The complete-surface shader compiles without WebGL errors',gl===0&&!consoleErrors.some(t=>/shader|WebGL|GL_INVALID/i.test(t)))
 check('No uncaught browser or application-network failures',errors.length===0&&requestsFailed.length===0)
 const report={status:'ok',base,checks,mode:intent.mode,counts:plan.counts,coverage:plan.coverage,terrain_source_sha256:plan.meta.terrain_source_sha256,difference,resetDrift,unknownMobileRim,unknownResetDrift,bestMobileRim,selections,edge,errors,consoleErrors,requestsFailed}
 await writeFile(path('surface-analysis-browser-report.json'),JSON.stringify(report,null,2))
 console.log(JSON.stringify({status:'ok',checks:checks.length,counts:plan.counts,difference,selected:selections.length}))
}catch(error){
 if(page)await page.screenshot({path:path('surface-analysis-failure.png'),fullPage:true}).catch(()=>{})
 await writeFile(path('surface-analysis-browser-report.json'),JSON.stringify({status:'failed',base,checks,selections,error:String(error),errors,consoleErrors,requestsFailed},null,2))
 console.error(JSON.stringify({status:'failed',error:String(error),checks,selections,errors,consoleErrors,requestsFailed},null,2))
 process.exitCode=1
}finally{await browser.close()}
