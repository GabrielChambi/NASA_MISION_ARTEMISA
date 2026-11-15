import {readFile} from 'node:fs/promises'
import {transform} from 'esbuild'
import {gzipSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {test} from 'node:test'
import assert from 'node:assert/strict'
const source=await readFile(new URL('../src/features/sites/lunarDetail.ts',import.meta.url),'utf8')
const {code}=await transform(source,{loader:'ts',format:'esm',target:'es2022'})
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
const side=129,bytes=new Uint8Array(side*side*2),view=new DataView(bytes.buffer)
for(let i=0;i<side*side;i++)view.setUint16(i*2,i%1024,true)
const compressed=new Uint8Array(gzipSync(bytes))
const sourceSha=sha(new TextEncoder().encode('NASA-shaped test fixture; not measured terrain'))
const extent={xmin:0,ymin:-10240,xmax:10240,ymax:0}
const tile={id:'tile-4-4',row:4,col:4,grid_size:side,display_spacing_m:80,sample_extent_m:extent,data_url:'/data/polar-detail/tile-4-4.u16.gz',compression:'gzip',byte_order:'little-endian',height_sha256:sha(bytes),compressed_sha256:sha(compressed),bytes:compressed.length,valid_vertices:side*side,min_elevation_m:0,max_elevation_m:1023}
const manifest={version:1,source_url:'https://pgda.gsfc.nasa.gov/fixture.tif',source_sha256:sourceSha,source_resolution_m:80,radius_m:1737400,tile_rows:8,tile_cols:8,grid_size:side,scale_m:1,offset_m:0,nodata:65535,sample_extent_m:{xmin:-40960,ymin:-40960,xmax:40960,ymax:40960},display_spacing_m:80,tiles:[tile],limitations:['Synthetic transport fixture for loader tests, not scientific results.'],shading:{url:'/data/polar-detail/nasa-relief.jpg',sha256:sha(bytes),width:128,height:128,sample_extent_m:extent,pixel_spacing_m:80,method:'fixture'}}
const base={manifest:{source_sha256:sourceSha,radius_m:1737400,limitations:[]},heights:new Uint16Array()}
async function load(index){
 return import('data:text/javascript;base64,'+Buffer.from(code+'\n//# sourceURL=lunarDetail.transport.test.'+index+'.js').toString('base64'))
}
function fakeFetch(payload,headers={}){
 return async url=>String(url).endsWith('/manifest.json')?Response.json(manifest):new Response(payload,{headers})
}
test('tile loader verifies gzip asset bytes and decompresses once on Worker-style responses',async()=>{
 const original=globalThis.fetch;globalThis.fetch=fakeFetch(compressed)
 try{
  const module=await load('gzip'),result=await module.loadDetailTile(base,-90,0,new AbortController().signal)
  assert.equal(result.heights.length,side*side)
  assert.equal(result.heights[777],777)
  assert.equal(result.manifest.display_spacing_m,80)
 }finally{globalThis.fetch=original}
})
test('tile loader accepts browser-auto-decoded Content-Encoding:gzip only after raw size and SHA verification',async()=>{
 const original=globalThis.fetch;globalThis.fetch=fakeFetch(bytes,{'Content-Encoding':'gzip'})
 try{
  const module=await load('decoded'),result=await module.loadDetailTile(base,-90,0,new AbortController().signal)
  assert.equal(result.heights[777],777)
  assert.equal(result.heights.length,side*side)
 }finally{globalThis.fetch=original}
})
test('corrupt compressed bytes and corrupt auto-decoded bytes both fail integrity checks',async()=>{
 const original=globalThis.fetch
 try{
  for(const [id,payload,headers] of [['compressed',compressed.slice(),{}],['raw',bytes.slice(),{'Content-Encoding':'gzip'}]]){
   payload[15]^=7;globalThis.fetch=fakeFetch(payload,headers)
   const module=await load('bad-'+id)
   await assert.rejects(()=>module.loadDetailTile(base,-90,0,new AbortController().signal),/integridad/)
  }
 }finally{globalThis.fetch=original}
})
test('cancelled tile load cannot return geometry data for a stale selection',async()=>{
 const original=globalThis.fetch;globalThis.fetch=fakeFetch(compressed)
 try{
  const module=await load('aborted'),ac=new AbortController();ac.abort()
  await assert.rejects(()=>module.loadDetailTile(base,-90,0,ac.signal),error=>error.name==='AbortError')
 }finally{globalThis.fetch=original}
})
test('truncated HTTP-decoded and gzip payloads cannot turn into a successful detail tile',async()=>{
 const original=globalThis.fetch
 try{
  for(const [id,payload,headers] of [['gzip',compressed.slice(0,-2),{}],['decoded',bytes.slice(0,-2),{'Content-Encoding':'gzip'}]]){
   globalThis.fetch=fakeFetch(payload,headers)
   const module=await load('truncated-'+id)
   await assert.rejects(()=>module.loadDetailTile(base,-90,0,new AbortController().signal))
  }
 }finally{globalThis.fetch=original}
})
