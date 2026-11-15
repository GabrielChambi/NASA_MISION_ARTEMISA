import { createScienceApi } from './science.mjs'

/** Uses the canonical JPL parser, exact query keys and terrain horizon algorithm. */
export function createLandingApi(resources) {
  return async function landing(request, ctx) {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/landing/')) return null
    const error = (message,status=422) => Response.json({status:'unavailable',message,samples:[],windows:[],summary:null},{status,headers:{'Cache-Control':'no-store'}})
    if(request.method!=='GET') return error('GET only.',405)
    if(!resources.landing) return error('Original NASA landing-grid data unavailable.',503)
    if(url.pathname==='/api/landing/surface') return Response.json(resources.landing,{headers:{'Cache-Control':'private,max-age=3600'}})
    if(url.pathname!=='/api/landing/ephemeris') return error('Unknown landing endpoint.',404)
    const p=url.searchParams
    if(!p.get('start_utc')||!p.get('end_utc'))return error('Explicit start_utc and end_utc are required.')
    if(p.has('step_minutes')&&!/^[0-9]+$/.test(p.get('step_minutes')))return error('step_minutes must be an integer.')
    const region=resources.landing.regions.find(r=>r.cells.some(c=>c.id===p.get('cell_id')))
    const cell=region?.cells.find(c=>c.id===p.get('cell_id'))
    if(!cell?.known || cell.horizon_deg.length!==360 || cell.horizon_deg.some(v=>!Number.isFinite(v))) return error('Unknown terrain or incomplete horizon coverage: choose a prepared NASA cell.')
    if(!['Sun','Earth'].includes(p.get('target'))) return error('target must be Sun or Earth.')
    if(Number(p.get('observer_height_m')??2)!==2) return error('Landing-grid profiles are prepared at 2 m observer height only.')
    const point={id:cell.id,latitude_deg:cell.latitude_deg,longitude_deg:cell.longitude_deg,elevation_m:cell.elevation_m}
    const profile={samples:cell.horizon_deg.map(elevation_deg=>({elevation_deg})),quality:'sampled-partial',warnings:resources.landing.limitations}
    const api=createScienceApi({...resources,sites:{sites:[point]},horizon:{profiles:{[cell.id]:{'2':profile}}}})
    const inner=new URL(url)
    inner.pathname=p.get('target')==='Sun'?'/api/solar':'/api/earth'
    inner.searchParams.set('site_id',cell.id)
    inner.searchParams.set('horizon_mode','terrain')
    inner.searchParams.set('observer_height_m','2')
    inner.searchParams.set('include_range','true')
    const response=await api(new Request(inner),ctx)
    if(!response.ok) return response
    const result=await response.json()
    Object.assign(result.meta,{cell_id:cell.id,region_id:region.id,reference_frame:resources.landing.reference_frame,limitations:resources.landing.limitations})
    return Response.json(result,{headers:{'Cache-Control':'private,max-age=60'}})
  }
}
