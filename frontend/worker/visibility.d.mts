export const REQUIRED_CLEARANCE_DEG:number
export type VisibilityState='unknown'|'occluded'|'limited'|'clear'
export type VisibilityAssessment={state:VisibilityState;clearance_deg:number|null;required_margin_deg:number;geometry_visible:boolean|null;meets_margin:boolean|null}
export function assessVisibility(elevationDeg:number|null|undefined,horizonDeg:number|null|undefined,requiredMarginDeg?:number):VisibilityAssessment
export function scientificObserver(baseKm:number[],up:number[],heightM:number):number[]
export function visibilityColor(state:VisibilityState,target?:'earth'|'sun'):string

export function clearsMargin(clearanceDeg:number|null|undefined,requiredMarginDeg?:number):boolean|null
