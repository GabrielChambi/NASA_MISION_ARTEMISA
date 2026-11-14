import { readFile, readdir, mkdir, writeFile, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
const data = [path.join(root, '../data'), path.join(root, 'data')].find(p => existsSync(path.join(p, 'catalog/sites.json')))
if (!data) throw new Error('Verified NASA data/catalog is required. See README for data preparation.')
const json = async p => JSON.parse(await readFile(path.join(data, p), 'utf8'))
const sites = await json('catalog/sites.json'), datasets = await json('catalog/datasets.json')
const horizon = await json('prepared/horizon_profiles.json')
const terrain = Object.fromEntries(await Promise.all(sites.sites.map(async s => [s.id, await json(`prepared/${s.id}-terrain.json`)])))
const ephemeris = []
for (const name of await readdir(path.join(data, 'prepared/ephemeris'))) if (name.endsWith('.json')) ephemeris.push(await json(`prepared/ephemeris/${name}`))
const methodology = { status: 'ok', title: 'Sampled geometric visibility', formula: 'visible = apparent_elevation_deg > horizon_elevation_deg', windows: 'Half-open [start,end), left sample; final graph sample adds no duration.', flat_horizon: '0 degrees; terrain obstruction and horizon dip are excluded.', terrain_horizon: 'NASA LOLA local and regional finite-ray sampling, partial coverage; uncertainty not propagated.', sources: [{ name: 'JPL Horizons', url: 'https://ssd-api.jpl.nasa.gov/doc/horizons.html' }, { name: 'NASA LOLA', url: 'https://pgda.gsfc.nasa.gov/products/78' }], limitations: ['Geometric visibility is not electric energy or a guaranteed RF link.', 'Reference pixels are not approved landing locations.', 'Independent SPICE frame validation is pending.'], datasets: datasets.datasets }
const assets = {}
const mime = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.woff':'font/woff','.woff2':'font/woff2','.json':'application/json' }
async function walk(dir, prefix = '') {
  for (const name of await readdir(dir)) {
    if (name === 'server' || name === '.openai') continue
    const full = path.join(dir, name), relative = `${prefix}/${name}`
    if ((await stat(full)).isDirectory()) await walk(full, relative)
    else { const bytes = await readFile(full); assets[relative] = { mime: mime[path.extname(name)] || 'application/octet-stream', base64: bytes.toString('base64') } }
  }
}
await walk(path.join(root, 'dist'))
await mkdir(path.join(root, '.generated'), { recursive: true })
const entry = path.join(root, '.generated/hosted-entry.mjs')
const resources = { sites, datasets, horizon, terrain, ephemeris, methodology }
await writeFile(entry, `import {createScienceApi} from '../worker/science.mjs';
const api=createScienceApi(${JSON.stringify(resources)});
const assets=${JSON.stringify(assets)};
export default {async fetch(request,env,ctx){const url=new URL(request.url);if(url.pathname.startsWith('/api/'))return api(request,ctx);if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});const asset=assets[url.pathname]||(url.pathname.includes('.')?null:assets['/index.html']);if(!asset)return new Response('Not found',{status:404});const bytes=Uint8Array.from(atob(asset.base64),v=>v.charCodeAt(0));return new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':asset.mime,'Cache-Control':url.pathname.startsWith('/assets/')?'public,max-age=31536000,immutable':'private,max-age=60','X-Content-Type-Options':'nosniff'}})}};`)
await mkdir(path.join(root, 'dist/server'), { recursive: true })
await build({ entryPoints: [entry], outfile: path.join(root, 'dist/server/index.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true })
console.log(`Hosted Worker built with ${Object.keys(assets).length} local assets, ${ephemeris.length} traceable JPL records and ${datasets.datasets.length} NASA datasets.`)
