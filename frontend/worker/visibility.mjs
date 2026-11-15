/** Center-line visibility against a DEM angular horizon. World positions are in km. */
export const REQUIRED_CLEARANCE_DEG=.3
const EPS=1e-9
export function clearsMargin(clearanceDeg,requiredMarginDeg=REQUIRED_CLEARANCE_DEG){return typeof clearanceDeg==='number'&&Number.isFinite(clearanceDeg)&&typeof requiredMarginDeg==='number'&&Number.isFinite(requiredMarginDeg)&&requiredMarginDeg>=0?clearanceDeg>requiredMarginDeg+EPS:null}
export function assessVisibility(elevationDeg,horizonDeg,requiredMarginDeg=REQUIRED_CLEARANCE_DEG){
 if(![elevationDeg,horizonDeg,requiredMarginDeg].every(v=>typeof v==='number'&&Number.isFinite(v))||Math.abs(elevationDeg)>90||Math.abs(horizonDeg)>90||requiredMarginDeg<0)return {state:'unknown',clearance_deg:null,required_margin_deg:requiredMarginDeg,geometry_visible:null,meets_margin:null}
 const clearance=elevationDeg-horizonDeg,state=clearance<=EPS?'occluded':clearsMargin(clearance,requiredMarginDeg)?'clear':'limited'
 return {state,clearance_deg:clearance,required_margin_deg:requiredMarginDeg,geometry_visible:clearance>EPS,meets_margin:state==='clear'}
}
export function scientificObserver(baseKm,up,heightM){
 if(!Array.isArray(baseKm)||!Array.isArray(up)||baseKm.length!==3||up.length!==3||![...baseKm,...up,heightM].every(v=>typeof v==='number'&&Number.isFinite(v))||heightM<0)throw new Error('Invalid scientific observer geometry')
 const norm=Math.hypot(...up);if(norm<=0)throw new Error('Invalid local vertical')
 return baseKm.map((v,i)=>v+up[i]/norm*heightM/1000)
}
export function visibilityColor(state,target='earth'){return state==='unknown'?'#788e9e':state==='occluded'?'#ff797f':state==='limited'?'#f5cb67':target==='sun'?'#f5cb67':'#8ddfe9'}
