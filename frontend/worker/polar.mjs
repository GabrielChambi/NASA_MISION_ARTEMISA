/** Regional terrain priorities only; never reinterpret them as landing approval. */
export function createPolarApi(resources) {
  return async function polar(request) {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/polar/')) return null
    const error=(message,status)=>Response.json({status:'unavailable',message},{status,headers:{'Cache-Control':'no-store'}})
    if(request.method!=='GET')return error('GET only.',405)
    if(url.pathname!=='/api/polar/surface')return error('Unknown polar endpoint.',404)
    const data=resources.polar
    if(!data||data.schema_version!==1||data.analysis_type!=='regional-terrain-screening'||!Array.isArray(data.cells)||data.cells.length!==data.grid_size*data.grid_size) {
      return error('NASA regional polar screening data unavailable.',503)
    }
    return Response.json(data,{headers:{'Cache-Control':'private,max-age=3600'}})
  }
}
