
import {readFile} from 'node:fs/promises'
import {transform} from 'esbuild'
import {test} from 'node:test'
import assert from 'node:assert/strict'
const source=await readFile(new URL('../src/features/tactical/polarCoverage.ts',import.meta.url),'utf8')
const {code}=await transform(source,{loader:'ts',format:'esm',target:'es2022'})
const {coverageRaster,polarCellAtStereo,polarCellAtWorld,worldPointToPolarStereo,COVERAGE_CODE}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))
const R=1737400
function fixture(n=2,pitch=100){
 return {radius_m:R,grid_size:n,cell_spacing_m:pitch,grid:{xmin:-n*pitch/2,ymax:n*pitch/2},cells:Array.from({length:n*n},(_,i)=>({id:'polar:'+Math.floor(i/n)+':'+i%n,row:Math.floor(i/n),col:i%n,known:true,cap_fraction:1}))}
}
function world(latitude,longitude,height=0){
 const c=(latitude+90)*Math.PI/180,l=longitude*Math.PI/180,r=(R+height)/1000
 return {x:-r*Math.sin(c)*Math.sin(l),y:r*Math.cos(c)-R/1000,z:r*Math.sin(c)*Math.cos(l)}
}
test('Classification raster uses north-to-south rows and west-to-east columns without texture inversion',()=>{
 const surface=fixture()
 const pixels=coverageRaster(surface,[{id:'polar:0:0',risk:'green'},{id:'polar:0:1',risk:'red'},{id:'polar:1:1',risk:'yellow'}])
 assert.deepEqual([...pixels],[1,3,4,2])
 assert.equal(polarCellAtStereo(surface,-50,50).id,'polar:0:0')
 assert.equal(polarCellAtStereo(surface,50,50).id,'polar:0:1')
 assert.equal(polarCellAtStereo(surface,-50,-50).id,'polar:1:0')
 assert.equal(polarCellAtStereo(surface,50,-50).id,'polar:1:1')
 assert.equal(pixels[polarCellAtStereo(surface,50,-50).row*2+1],COVERAGE_CODE.yellow)
})
test('Every missing, unknown or contradictory result stays gray rather than interpolating a nearby green cell',()=>{
 const surface=fixture()
 surface.cells[2].cap_fraction=0
 const pixels=coverageRaster(surface,[{id:'polar:0:0',risk:'green'},{id:'polar:0:0',risk:'green'},{id:'polar:0:1',risk:'safe-fiction'},{id:'outside',risk:'green'}])
 assert.deepEqual([...pixels],[4,4,4,4])
 assert.equal(pixels.length,surface.cells.length)
})
test('World picking preserves east/west, height independence and pole identity on the displaced sphere',()=>{
 for(const lat of [-90,-89,-85,-80.01])for(const lon of [-179,-90,0,90,179]){
  const expectedRadius=2*R*Math.tan((lat+90)*Math.PI/360)
  const expected=[expectedRadius*Math.sin(lon*Math.PI/180),expectedRadius*Math.cos(lon*Math.PI/180)]
  for(const height of [-7000,0,8000]){
   const actual=worldPointToPolarStereo(world(lat,lon,height),R)
   assert.ok(Math.abs(actual[0]-expected[0])<1e-7)
   assert.ok(Math.abs(actual[1]-expected[1])<1e-7)
  }
 }
 const surface=fixture(128,4750)
 assert.equal(polarCellAtWorld(surface,world(-90,0)).id,'polar:64:64')
 assert.equal(polarCellAtWorld(surface,world(-89,90)).col>64,true)
 assert.equal(polarCellAtWorld(surface,world(-89,-90)).col<64,true)
 assert.equal(polarCellAtWorld(surface,world(-89,0)).row<64,true)
 assert.equal(polarCellAtWorld(surface,world(-89,180)).row>64,true)
})
test('Coverage accepts unresolved 80 S edge fragments but never snaps points outside the cap or grid',()=>{
 const surface=fixture(128,4750)
 const radius=2*R*Math.tan(5*Math.PI/180),angle=32*Math.PI/180
 const x=(radius-5)*Math.sin(angle),y=(radius-5)*Math.cos(angle)
 const cell=polarCellAtStereo(surface,x,y)
 assert.ok(cell)
 cell.cap_fraction=0;cell.known=false
 assert.equal(polarCellAtStereo(surface,x,y).id,cell.id)
 const pixels=coverageRaster(surface,[])
 assert.equal(pixels[cell.row*surface.grid_size+cell.col],COVERAGE_CODE.unknown)
 assert.equal(polarCellAtStereo(surface,(radius+5)*Math.sin(angle),(radius+5)*Math.cos(angle)),null)
 assert.equal(polarCellAtStereo(surface,NaN,0),null)
 assert.equal(polarCellAtStereo(surface,Infinity,0),null)
 assert.equal(worldPointToPolarStereo({x:0,y:-R/1000,z:0},R),null)
})
test('Real NASA polar metadata covers the complete raster and selectable edge cells remain distinct from measured centers',async()=>{
 const surface=JSON.parse(await readFile(new URL('../../data/prepared/polar_screening.json',import.meta.url),'utf8'))
 const measured=surface.cells.filter(c=>c.known)
 const pixels=coverageRaster(surface,measured.map(c=>({id:c.id,risk:'red'})))
 assert.equal(pixels.length,128*128)
 assert.equal(pixels.filter(v=>v===COVERAGE_CODE.red).length,12892)
 assert.equal(pixels.filter(v=>v===COVERAGE_CODE.unknown).length,3492)
 for(const lon of Array.from({length:360},(_,i)=>i-180)){
  const cell=polarCellAtWorld(surface,world(-80.001,lon,1000))
  assert.ok(cell,'Every boundary direction inside the mapped cap has a selectable raster cell')
  if(!cell.known)assert.equal(pixels[cell.row*128+cell.col],COVERAGE_CODE.unknown)
 }
})
test('Independent geodetic picking agrees with measured NASA cell identities over the entire cap',async()=>{
 const surface=JSON.parse(await readFile(new URL('../../data/prepared/polar_screening.json',import.meta.url),'utf8'))
 const measured=surface.cells.filter(cell=>cell.known)
 const results=measured.map((cell,i)=>({id:cell.id,risk:['green','yellow','red','unknown'][i%4]}))
 const raster=coverageRaster(surface,results)
 for(let i=0;i<measured.length;i+=37){
  const cell=measured[i]
  const hit=polarCellAtWorld(surface,world(cell.latitude_deg,cell.longitude_deg,cell.elevation_m))
  assert.equal(hit?.id,cell.id)
  assert.equal(raster[hit.row*surface.grid_size+hit.col],COVERAGE_CODE[results[i].risk])
 }
})
