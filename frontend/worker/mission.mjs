// Compatibility adapter for the Earth/Compare modules added to main.
// Uses the same verified catalog, exact NASA cache and horizon as the atlas.
import { ScienceError, visibilityMetrics, validateQuery } from './science.mjs'

const iso=millis=>new Date(millis).toISOString().replace('.000Z','Z')
const vec=(az,el)=>{const a=az*Math.PI/180,e=el*Math.PI/180;return [Math.cos(e)*Math.sin(a),Math.cos(e)*Math.cos(a),Math.sin(e)]}
const average=values=>values.reduce((a,b)=>a+b,0)/values.length

function parameters(body,compare){
  const q={site_id:'site04',site_ids:['site01','site04'],start_utc:'2026-12-14T00:00:00Z',end_utc:'2026-12-17T00:00:00Z',step_minutes:60,horizon_mode:'flat',clearance_deg:0,delay_hours:0,observer_height_m:2,minimum_solar_hours:36,minimum_earth_visible_hours:36,...body}
  for(const [key,min,max] of [['clearance_deg',0,15],['delay_hours',0,24],['observer_height_m',0,50],['minimum_solar_hours',0,336],['minimum_earth_visible_hours',0,336]]) if(typeof q[key]!=='number'||!Number.isFinite(q[key])||q[key]<min||q[key]>max)throw new ScienceError(`${key} must be between ${min} and ${max}.`)
  if(!Number.isInteger(q.step_minutes)||q.step_minutes<30||q.step_minutes>180)throw new ScienceError('step_minutes must be 30–180 for mission analysis.')
  if(compare&&(!Array.isArray(q.site_ids)||q.site_ids.length!==2||new Set(q.site_ids).size!==2||q.site_ids.some(s=>!['site01','site04'].includes(s))))throw new ScienceError('Choose two distinct catalog sites.')
  return q
}

function siteMetadata(site,height){return {site_id:site.id,name:site.name,region:'Lunar south pole',lat_deg:site.latitude_deg,lon_east_deg:(site.longitude_deg+360)%360,elevation_m:site.elevation_m,observer_height_m:height,reference_frame:site.reference_frame,provenance_source:'NASA LOLA regional reference pixel',provenance_url:site.source_url}}
function terrainMesh(tile,site){
  if(!tile)return null
  const n=tile.width,grid=values=>values?Array.from({length:n},(_,r)=>values.slice(r*n,(r+1)*n)):null
  return {grid_size:n,spacing_m:tile.resolution_m,extent_m:tile.extent_m.xmax-tile.extent_m.xmin,center_elevation_m:site.elevation_m,min_elevation_m:Math.min(...tile.elevations_m),max_elevation_m:Math.max(...tile.elevations_m),elevation_grid_m:grid(tile.elevations_m),slope_grid_deg:grid(tile.slope_degrees),center_slope_deg:site.slope_deg??null,mean_slope_deg:tile.slope_degrees?average(tile.slope_degrees):null,uncertainty_grid_m:grid(tile.height_uncertainty_m),center_uncertainty_m:site.height_uncertainty_m??null,median_uncertainty_m:null,frame:site.reference_frame,provenance_url:tile.source_url}
}

export function createMissionApi(resources,science){
  const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}})
  async function result(origin,query,siteId,target,delay,ctx){
    const url=new URL(`/api/${target}`,origin)
    const unshifted=new URL(url)
    unshifted.search=new URLSearchParams({site_id:siteId,start_utc:query.start_utc,end_utc:query.end_utc,step_minutes:String(query.step_minutes),horizon_mode:query.horizon_mode,observer_height_m:String(query.observer_height_m)})
    validateQuery(unshifted,resources.sites)
    const shift=value=>{const time=Date.parse(value);if(!Number.isFinite(time)||!/(Z|\+00:00)$/.test(value))throw new ScienceError('Explicit valid UTC is required.');return iso(time+delay*3600000)}
    url.search=new URLSearchParams({site_id:siteId,start_utc:shift(query.start_utc),end_utc:shift(query.end_utc),step_minutes:String(query.step_minutes),horizon_mode:query.horizon_mode,observer_height_m:String(query.observer_height_m),...(target==='earth'?{include_range:'true'}:{})})
    const response=await science(new Request(url),ctx),data=await response.json()
    if(!response.ok)throw new ScienceError(data.message||'Scientific data unavailable.',response.status)
    return data
  }
  function horizonProfile(query,siteId){
    const profile=resources.horizon?.profiles?.[siteId]?.[String(query.observer_height_m)]
    if(query.horizon_mode==='terrain'&&!profile)throw new ScienceError('No prepared terrain profile for this height.')
    return Array.from({length:36},(_,i)=>{const az=i*10,h=query.horizon_mode==='terrain'?profile.samples[az].elevation_deg:0;return {azimuth_deg:az,horizon_elevation_deg:h,enu_rim_vector:vec(az,h)}})
  }
  async function earth(origin,query,siteId,delay,ctx){
    const data=await result(origin,query,siteId,'earth',delay,ctx)
    const catalogSite=resources.sites.sites.find(s=>s.id===siteId)
    const evaluated=data.samples.map(s=>({...s,visible:s.elevation_deg>s.horizon_deg+query.clearance_deg}))
    const end=data.meta.end_utc
    const metrics=visibilityMetrics(evaluated,end,399)
    const blackout=visibilityMetrics(evaluated.map(s=>({...s,visible:!s.visible})),end,399)
    const samples=evaluated.slice(0,-1).map(s=>({...s,local_horizon_deg:s.horizon_deg,clearance_deg:query.clearance_deg,effective_threshold_deg:s.horizon_deg+query.clearance_deg,earth_visible:s.visible,enu_vector:vec(s.azimuth_deg,s.elevation_deg),solar_elongation_note:null}))
    const elevations=samples.map(s=>s.elevation_deg),ranges=samples.map(s=>s.range_km),az=samples.map(s=>s.azimuth_deg*Math.PI/180)
    const quality=query.horizon_mode==='terrain'?'degraded':data.meta.cache_hit?'cached_horizons_flat':'verified_horizons_flat'
    return {site:siteMetadata(catalogSite,query.observer_height_m),query,effective_start_utc:data.meta.start_utc,effective_end_utc:end,quality,warnings:data.meta.limitations,metrics:{total_hours:metrics.summary.duration_hours,earth_visible_hours:metrics.summary.earth_visible_hours,earth_visible_fraction:metrics.summary.earth_visible_fraction,longest_earth_blackout_hours:metrics.summary.longest_hidden_gap_hours,longest_earth_visible_hours:Math.max(0,...metrics.windows.map(w=>w.duration_hours)),min_elevation_deg:Math.min(...elevations),max_elevation_deg:Math.max(...elevations),mean_elevation_deg:average(elevations),mean_azimuth_deg:(Math.atan2(average(az.map(Math.sin)),average(az.map(Math.cos)))*180/Math.PI+360)%360,mean_range_km:average(ranges),expected_samples:samples.length,received_samples:samples.length,missing_samples:0},windows:metrics.windows,blackout_windows:blackout.windows,horizon_profile:horizonProfile(query,siteId),samples,terrain_mesh_3d:terrainMesh(resources.terrain[siteId],catalogSite),provenance:{source:'JPL Horizons',ephemeris_kernel:'Horizons observer ephemeris (see original query)',target_body:'Earth (399)',center_body:'Moon topocentric (coord@301)',visibility_definition:'apparent Earth-center elevation > selected horizon + clearance',interval_convention:'[start,end), left sample',requested_horizon_mode:query.horizon_mode,effective_horizon_mode:query.horizon_mode,cache_hit:data.meta.cache_hit,retrieved_at_utc:data.meta.retrieved_at,query_url:data.meta.query_url,limitations:data.meta.limitations}}
  }
  async function compareSite(origin,q,siteId,delay,ctx){
    const e=await earth(origin,q,siteId,delay,ctx)
    const sun=await result(origin,q,siteId,'solar',delay,ctx)
    const byTime=new Map(sun.samples.map(s=>[s.t_utc,s]))
    const samples=e.samples.map(s=>{const t=byTime.get(s.t_utc);if(!t)throw new ScienceError('Solar/Earth samples do not align.',503);return {t_utc:s.t_utc,earth_azimuth_deg:s.azimuth_deg,earth_elevation_deg:s.elevation_deg,earth_visible:s.earth_visible,earth_enu_vector:s.enu_vector,sun_azimuth_deg:t.azimuth_deg,sun_elevation_deg:t.elevation_deg,sun_visible:t.visible,sun_enu_vector:vec(t.azimuth_deg,t.elevation_deg),joint_visible:s.earth_visible&&t.visible}})
    const joint=samples.map(s=>({t_utc:s.t_utc,visible:s.joint_visible}));joint.push({t_utc:e.effective_end_utc,visible:false})
    const overlap=visibilityMetrics(joint,e.effective_end_utc)
    const solarMet=sun.summary,em=e.metrics,passesSolar=solarMet.sun_visible_hours>=q.minimum_solar_hours,passesEarth=em.earth_visible_hours>=q.minimum_earth_visible_hours
    return {site:e.site,quality:e.quality,solar_quality:'verified_horizons',earth_quality:e.quality,total_hours:em.total_hours,solar_visible_hours:solarMet.sun_visible_hours,solar_visible_fraction:solarMet.sun_visible_fraction,longest_solar_dark_gap_hours:solarMet.longest_dark_gap_hours,earth_visible_hours:em.earth_visible_hours,earth_visible_fraction:em.earth_visible_fraction,longest_earth_blackout_hours:em.longest_earth_blackout_hours,overlap_solar_earth_hours:overlap.summary.sun_visible_hours,overlap_solar_earth_fraction:overlap.summary.sun_visible_fraction,meets_solar_constraint:passesSolar,meets_earth_constraint:passesEarth,meets_constraints:passesSolar&&passesEarth,constraints_satisfied_count:Number(passesSolar)+Number(passesEarth),earth_windows:e.windows,overlap_windows:overlap.windows,samples,terrain_mesh_3d:e.terrain_mesh_3d,explanation:`${e.site.name}: ${solarMet.sun_visible_hours} h solar visibility, ${em.earth_visible_hours} h Earth visibility and ${overlap.summary.sun_visible_hours} h overlap under the selected model.`}
  }
  return async(request,ctx)=>{
    const url=new URL(request.url)
    if(url.pathname==='/api/earth/sites'&&request.method==='GET')return json({sites:resources.sites.sites.map(s=>({...siteMetadata(s,2),has_3d_terrain_mesh:Boolean(resources.terrain[s.id])}))})
    if(request.method!=='POST'||!['/api/earth','/api/compare'].includes(url.pathname))return null
    try{
      if(Number(request.headers.get('content-length')||0)>8192)throw new ScienceError('Mission request is too large.',413)
      const reader=request.body?.getReader(),decoder=new TextDecoder();let text='',bytes=0
      if(reader)while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>8192){await reader.cancel();throw new ScienceError('Mission request is too large.',413)}text+=decoder.decode(part.value,{stream:true})}
      text+=decoder.decode()
      let body;try{body=JSON.parse(text)}catch{throw new ScienceError('Invalid JSON body.')}
      if(!body||typeof body!=='object'||Array.isArray(body))throw new ScienceError('Expected a mission parameter object.')
      const q=parameters(body,url.pathname==='/api/compare')
      if(url.pathname==='/api/earth')return json(await earth(url.origin,q,q.site_id,q.delay_hours,ctx))
      const sites=[];for(const sid of q.site_ids)sites.push(await compareSite(url.origin,q,sid,q.delay_hours,ctx))
      const deltas=[];for(const delayed of sites){const base=q.delay_hours?await compareSite(url.origin,q,delayed.site.site_id,0,ctx):delayed;deltas.push({site_id:delayed.site.site_id,baseline_earth_visible_hours:base.earth_visible_hours,delayed_earth_visible_hours:delayed.earth_visible_hours,delta_earth_visible_hours:delayed.earth_visible_hours-base.earth_visible_hours,baseline_longest_blackout_hours:base.longest_earth_blackout_hours,delayed_longest_blackout_hours:delayed.longest_earth_blackout_hours,delta_longest_blackout_hours:delayed.longest_earth_blackout_hours-base.longest_earth_blackout_hours,baseline_overlap_hours:base.overlap_solar_earth_hours,delayed_overlap_hours:delayed.overlap_solar_earth_hours,delta_overlap_hours:delayed.overlap_solar_earth_hours-base.overlap_solar_earth_hours})}
      const sorted=[...sites].sort((a,b)=>b.constraints_satisfied_count-a.constraints_satisfied_count||b.overlap_solar_earth_hours-a.overlap_solar_earth_hours||b.earth_visible_hours-a.earth_visible_hours||a.site.site_id.localeCompare(b.site.site_id))
      const tied=sorted[0].constraints_satisfied_count===sorted[1].constraints_satisfied_count&&sorted[0].overlap_solar_earth_hours===sorted[1].overlap_solar_earth_hours&&sorted[0].earth_visible_hours===sorted[1].earth_visible_hours
      return json({query:q,base_start_utc:q.start_utc,base_end_utc:q.end_utc,effective_start_utc:iso(Date.parse(q.start_utc)+q.delay_hours*3600000),effective_end_utc:iso(Date.parse(q.end_utc)+q.delay_hours*3600000),delay_hours:q.delay_hours,requested_horizon_mode:q.horizon_mode,effective_horizon_mode:q.horizon_mode,consolidated_quality:q.horizon_mode==='terrain'?'degraded':'verified_horizons_flat',preferred_site_id:tied?null:sorted[0].site.site_id,preference_label:tied?'Equal under selected criteria':'Preferred under selected constraints',ranking_order:sorted.map(s=>s.site.site_id),ranking_rule:'Transparent heuristic, not a NASA certification: constraints satisfied, then Solar ∩ Earth overlap, then Earth-visible hours. Exact ties have no preferred region.',decision_explanation:`${sites.map(s=>s.explanation).join(' ')} ${tied?'No preference: both regions tie under the selected criteria.':`${sorted[0].site.name} leads under these criteria; this is not a landing safety recommendation.`}`,warnings:['Regional reference pixels, not approved landing locations.','Terrain horizon remains partial; visibility is not energy production or an RF link.','Times are sampled, not exact transition instants.'],sites,delay_sensitivity:deltas,provenance:{earth_source:'NASA/JPL Horizons Earth 399',solar_source:'NASA/JPL Horizons Sun 10',terrain_source:'NASA LOLA local and regional DEMs',interval_convention:'[start,end), left sample',visibility_model:'body-center elevation > terrain horizon (+ Earth clearance)'}})
    }catch(error){return json({status:'unavailable',message:error.message||'Mission data unavailable.',detail:error.message||'Mission data unavailable.'},error instanceof ScienceError?error.status:503)}
  }
}
