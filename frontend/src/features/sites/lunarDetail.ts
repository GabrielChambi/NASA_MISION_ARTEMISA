/** Higher-detail visual NASA terrain, loaded only when a zone is inspected.
 * Scientific slopes/horizons never use these display derivatives.
 */
import type { AtlasData } from './atlasGeometry'
type Extent={xmin:number;ymin:number;xmax:number;ymax:number}
export type LunarDetailTile={
  image_url?:string;image_sha256?:string;image_spacing_m?:number
  id:string;row:number;col:number;grid_size:number;display_spacing_m:number
  sample_extent_m:Extent;data_url:string;compression:'gzip';byte_order:'little-endian'
  height_sha256:string;compressed_sha256:string;bytes:number;valid_vertices:number
  min_elevation_m:number;max_elevation_m:number
}
export type LunarDetailManifest={
  version:number;source_url:string;source_sha256:string;source_resolution_m:number;radius_m:number
  tile_rows:number;tile_cols:number;grid_size:number;scale_m:number;offset_m:number;nodata:number
  sample_extent_m:Extent;display_spacing_m:number;tiles:LunarDetailTile[];limitations:string[]
  shading:{url:string;sha256:string;width:number;height:number;sample_extent_m:Extent;pixel_spacing_m:number;method:string}
}
let manifestCache:LunarDetailManifest|undefined
const ROOT='/data/polar-detail/'
export async function loadLunarDetailManifest(signal:AbortSignal):Promise<LunarDetailManifest>{
  if(manifestCache)return manifestCache
  const response=await fetch(ROOT+'manifest.json',{signal})
  if(!response.ok)throw new Error('No se pudo cargar el catálogo de detalle visual NASA.')
  const value:LunarDetailManifest=await response.json()
  if(value.version!==1||value.source_resolution_m!==80||!value.source_url.startsWith('https://pgda.gsfc.nasa.gov/')||value.tile_rows!==8||value.tile_cols!==8||value.grid_size<129||value.grid_size>513||value.tiles.length>64||!/^[a-f0-9]{64}$/.test(value.source_sha256)||value.nodata!==65535||!Number.isFinite(value.scale_m)||value.scale_m<=0)throw new Error('El catálogo de detalle lunar no es válido.')
  for(const t of value.tiles){
    if(t.grid_size!==value.grid_size||!t.data_url.startsWith(ROOT)||!/^\/data\/polar-detail\/tile-\d-\d\.u16\.gz$/.test(t.data_url)||!Number.isInteger(t.row)||t.row<0||t.row>7||!Number.isInteger(t.col)||t.col<0||t.col>7||!Number.isFinite(t.display_spacing_m)||t.display_spacing_m<80||![t.height_sha256,t.compressed_sha256].every(h=>/^[a-f0-9]{64}$/.test(h)))throw new Error('Una tesela lunar no tiene metadatos válidos.')
  }
  if(!value.shading.url.startsWith(ROOT)||!/^\/data\/polar-detail\/nasa-relief\.(png|jpg)$/.test(value.shading.url)||!/^[a-f0-9]{64}$/.test(value.shading.sha256))throw new Error('El sombreado lunar no tiene procedencia válida.')
  manifestCache=value
  return value
}
async function boundedBuffer(stream:ReadableStream<Uint8Array>|null,max:number,signal:AbortSignal){
  if(!stream)throw new Error('El archivo de detalle NASA está vacío.')
  const reader=stream.getReader(),chunks:Uint8Array[]=[]
  let total=0
  try{
    while(true){
      if(signal.aborted)throw new DOMException('Aborted','AbortError')
      const {value,done}=await reader.read()
      if(done)break
      total+=value.length
      if(total>max){await reader.cancel();throw new Error('El archivo de detalle supera su tamaño declarado.')}
      chunks.push(value)
    }
  }finally{reader.releaseLock()}
  const bytes=new Uint8Array(total)
  let at=0
  for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length}
  return bytes
}
async function verify(bytes:Uint8Array,expected:string){
  if(!globalThis.crypto?.subtle)throw new Error('La verificación NASA requiere una conexión segura.')
  const digest=await crypto.subtle.digest('SHA-256',bytes.buffer as ArrayBuffer)
  const actual=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('')
  if(actual!==expected)throw new Error('La integridad del detalle visual NASA no coincide con el catálogo.')
}
export function detailTileAt(manifest:LunarDetailManifest,lat:number,lon:number):LunarDetailTile|null{
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat< -90||lat> -80||lon< -180||lon>180)return null
  const rho=2*manifest.radius_m*Math.tan((90+lat)*Math.PI/360),x=rho*Math.sin(lon*Math.PI/180),y=rho*Math.cos(lon*Math.PI/180)
  const e=manifest.sample_extent_m,span=(e.xmax-e.xmin)/manifest.tile_cols
  const col=Math.min(7,Math.floor((x-e.xmin)/span)),row=Math.min(7,Math.floor((e.ymax-y)/span))
  if(col<0||row<0)return null
  return manifest.tiles.find(t=>t.row===row&&t.col===col)??null
}
export async function loadDetailTile(base:AtlasData,lat:number,lon:number,signal:AbortSignal):Promise<AtlasData|null>{
  const manifest=await loadLunarDetailManifest(signal)
  if(manifest.source_sha256!==base.manifest.source_sha256||manifest.radius_m!==base.manifest.radius_m)throw new Error('El detalle no corresponde al mismo DEM NASA del mapa.')
  const tile=detailTileAt(manifest,lat,lon)
  if(!tile)return null
  const response=await fetch(tile.data_url,{signal})
  if(!response.ok)throw new Error('No se pudo descargar el detalle visual de esta zona.')
  const expectedBytes=tile.grid_size**2*2
  const payload=await boundedBuffer(response.body,Math.max(expectedBytes,Math.min(1048576,tile.bytes)),signal)
  let bytes:Uint8Array
  // Browsers decode Content-Encoding:gzip automatically (Vite). The hosted
  // asset server returns gzip bytes without that header. Verify both contracts.
  if(response.headers.get('content-encoding')?.includes('gzip')&&payload.length===expectedBytes){
    bytes=payload
  }else{
    if(payload.length!==tile.bytes)throw new Error('La tesela NASA está incompleta.')
    await verify(payload,tile.compressed_sha256)
    if(typeof DecompressionStream==='undefined')throw new Error('Este navegador no permite cargar el detalle comprimido.')
    const stream=new Blob([payload.buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream('gzip'))
    bytes=await boundedBuffer(stream,expectedBytes,signal)
  }
  if(bytes.length!==expectedBytes)throw new Error('El tamaño del relieve lunar es incorrecto.')
  await verify(bytes,tile.height_sha256)
  const heights=new Uint16Array(tile.grid_size**2),view=new DataView(bytes.buffer)
  for(let i=0;i<heights.length;i++)heights[i]=view.getUint16(i*2,true)
  const result:AtlasData={heights,manifest:{...base.manifest,
    grid_size:tile.grid_size,display_spacing_m:tile.display_spacing_m,scale_m:manifest.scale_m,offset_m:manifest.offset_m,
    nodata:manifest.nodata,data_url:tile.data_url,height_sha256:tile.height_sha256,
    source_resolution_m:80,extent_m:tile.sample_extent_m,sample_extent_m:tile.sample_extent_m,
    min_elevation_m:tile.min_elevation_m,max_elevation_m:tile.max_elevation_m,
    title:'NASA LOLA · detalle visual '+Math.round(tile.display_spacing_m)+' m',
    limitations:[...base.manifest.limitations,...manifest.limitations]}}
  return result
}
/** Returns an integrity-checked URL for a THREE.TextureLoader or ImageBitmap.
 * Its fixed shaded relief is illustrative, never a date-specific illumination result.
 */
export async function loadLunarShading(signal:AbortSignal,tileUrl?:string):Promise<{url:string;manifest:LunarDetailManifest;local:boolean;dispose:()=>void}>{
  const manifest=await loadLunarDetailManifest(signal)
  const tile=tileUrl?manifest.tiles.find(t=>t.data_url===tileUrl):undefined
  const local=Boolean(tile?.image_url&&tile.image_sha256)
  const urlPath=local?tile!.image_url!:manifest.shading.url
  const hash=local?tile!.image_sha256!:manifest.shading.sha256
  if(local&&(!/^\/data\/polar-detail\/tile-\d-\d\.jpg$/.test(urlPath)||!/^[a-f0-9]{64}$/.test(hash)))throw new Error('El sombreado local no tiene procedencia válida.')
  const response=await fetch(urlPath,{signal})
  if(!response.ok)throw new Error('No se pudo cargar el sombreado del relieve NASA.')
  const bytes=await boundedBuffer(response.body,8388608,signal)
  await verify(bytes,hash)
  const type=urlPath.endsWith('.jpg')?'image/jpeg':'image/png'
  const url=URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer],{type}))
  return {url,manifest,local,dispose:()=>URL.revokeObjectURL(url)}
}
