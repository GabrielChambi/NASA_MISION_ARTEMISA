import * as THREE from 'three'
import type { LunarSite } from '../mission/types'

export type AtlasFeature = { name: string; latitude_deg: number; longitude_east_deg: number; x_m: number; y_m: number; elevation_m: number; source_url: string }
export type AtlasManifest = {
  version: number; title: string; source_url: string; source_product: string; source_resolution_m: number; source_sha256: string
  grid_size: number; display_spacing_m: number; scale_m: number; offset_m: number; nodata: number; data_url: string; height_sha256: string
  radius_m: number; extent_m: { xmin: number; ymin: number; xmax: number; ymax: number }; sample_extent_m: { xmin: number; ymin: number; xmax: number; ymax: number }
  min_elevation_m: number; max_elevation_m: number; features: AtlasFeature[]; sites: LunarSite[]; prepared_at: string
  nomenclature_url: string; reference_visualization_url: string; limitations: string[]
}
export type AtlasData = { manifest: AtlasManifest; heights: Uint16Array }
export type AtlasColorMode = 'elevation' | 'natural'
export const ELEVATION_COLORS: [number, string][] = [[-7000,'#142b55'],[-5000,'#254f80'],[-3000,'#3e7e98'],[-1000,'#71a7aa'],[0,'#b4c794'],[1500,'#d6d47c'],[3000,'#b7a46a'],[4500,'#af8273'],[7000,'#e2d2cc']]
const palette = ELEVATION_COLORS.map(([height, color]) => [height, new THREE.Color(color)] as const)

export function elevationColor(height: number, output = new THREE.Color()) {
  for (let i = 1; i < palette.length; i++) if (height <= palette[i][0]) {
    return output.copy(palette[i-1][1]).lerp(palette[i][1], THREE.MathUtils.clamp((height - palette[i-1][0]) / (palette[i][0] - palette[i-1][0]), 0, 1))
  }
  return output.copy(palette.at(-1)![1])
}

// NASA south-polar stereographic coordinates on a sphere. Scene units are km.
// A physical height is exaggerated radially for display, never in the science API.
export function projectedToWorld(xM: number, yM: number, heightM: number, exaggeration: number, radiusM: number): THREE.Vector3 {
  const rho = Math.hypot(xM, yM)
  const angle = 2 * Math.atan(rho / (2 * radiusM))
  const radial = radiusM + heightM * exaggeration
  const k = rho > 0 ? radial * Math.sin(angle) / rho / 1000 : 0
  return new THREE.Vector3(-xM * k, (radial * Math.cos(angle) - radiusM) / 1000, yM * k)
}

export function siteWorld(site: LunarSite, exaggeration: number, radiusM: number) {
  const rho = 2 * radiusM * Math.tan((90 + site.latitude_deg) * Math.PI / 360)
  const lon = site.longitude_deg * Math.PI / 180
  return projectedToWorld(rho * Math.sin(lon), rho * Math.cos(lon), site.elevation_m ?? 0, exaggeration, radiusM)
}

export function bodyDirection(site: LunarSite, azimuthDeg: number, elevationDeg: number) {
  const lon = site.longitude_deg * Math.PI / 180, lat = site.latitude_deg * Math.PI / 180
  const az = azimuthDeg * Math.PI / 180, el = elevationDeg * Math.PI / 180
  const east = new THREE.Vector3(-Math.cos(lon), 0, -Math.sin(lon))
  const north = new THREE.Vector3(Math.sin(lat)*Math.sin(lon), -Math.cos(lat), -Math.sin(lat)*Math.cos(lon))
  const up = new THREE.Vector3(-Math.cos(lat)*Math.sin(lon), -Math.sin(lat), Math.cos(lat)*Math.cos(lon))
  return east.multiplyScalar(Math.sin(az)*Math.cos(el)).addScaledVector(north,Math.cos(az)*Math.cos(el)).addScaledVector(up,Math.sin(el)).normalize()
}

export function buildAtlasGeometry(data: AtlasData, exaggeration: number, mode: AtlasColorMode, stride: number) {
  const { manifest: m, heights } = data
  const grid = Math.floor((m.grid_size - 1) / stride) + 1
  const position = new Float32Array(grid * grid * 3), colors = new Float32Array(grid * grid * 3)
  const valid = new Uint8Array(grid * grid), color = new THREE.Color()
  const pitch = m.display_spacing_m
  for (let row = 0; row < grid; row++) for (let col = 0; col < grid; col++) {
    const sourceRow = row * stride, sourceCol = col * stride, sourceIndex = sourceRow * m.grid_size + sourceCol
    const encoded = heights[sourceIndex], index = row * grid + col
    if (encoded === m.nodata) continue
    valid[index] = 1
    const h = encoded * m.scale_m + m.offset_m
    const x = m.sample_extent_m.xmin + sourceCol * pitch, y = m.sample_extent_m.ymax - sourceRow * pitch
    const world = projectedToWorld(x,y,h,exaggeration,m.radius_m)
    position.set(world.toArray(),index*3)
    if (mode === 'elevation') elevationColor(h,color)
    else color.set('#a8b0b5')
    colors.set([color.r,color.g,color.b],index*3)
  }
  const indices: number[] = []
  for (let row=0;row<grid-1;row++) for(let col=0;col<grid-1;col++) {
    const a=row*grid+col,b=a+1,c=a+grid,d=c+1
    if (valid[a]&&valid[c]&&valid[b]) indices.push(a,c,b)
    if (valid[b]&&valid[c]&&valid[d]) indices.push(b,c,d)
  }
  const geometry=new THREE.BufferGeometry()
  geometry.setAttribute('position',new THREE.BufferAttribute(position,3))
  geometry.setAttribute('color',new THREE.BufferAttribute(colors,3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

export async function loadAtlas(signal: AbortSignal): Promise<AtlasData> {
  const response=await fetch('/data/polar-atlas/manifest.json',{signal})
  if(!response.ok) throw new Error('The prepared NASA regional terrain could not be loaded.')
  const manifest:AtlasManifest=await response.json()
  if(!Number.isInteger(manifest.grid_size)||manifest.grid_size<3||manifest.grid_size>1537||!manifest.source_url.startsWith('https://pgda.gsfc.nasa.gov/')) throw new Error('The regional terrain metadata is invalid.')
  const heightResponse=await fetch(manifest.data_url,{signal})
  if(!heightResponse.ok) throw new Error('The NASA elevation mesh is unavailable.')
  const buffer=await heightResponse.arrayBuffer()
  if(buffer.byteLength!==manifest.grid_size**2*2) throw new Error('The regional elevation mesh is incomplete.')
  if(globalThis.crypto?.subtle) {
    const digest=await crypto.subtle.digest('SHA-256',buffer)
    const hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('')
    if(hash!==manifest.height_sha256) throw new Error('The regional terrain checksum does not match its NASA derivative metadata.')
  }
  const heights=new Uint16Array(manifest.grid_size**2), view=new DataView(buffer)
  for(let i=0;i<heights.length;i++) heights[i]=view.getUint16(i*2,true)
  return {manifest,heights}
}
