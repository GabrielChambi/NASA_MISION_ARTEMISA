
import type {AutomaticPlan,MissionPoint,VehicleProfile} from './automaticTypes'
export type PlanRequest={
 departure_utc:string;date_kind:'departure'|'landing';surface_hours:number
 max_slope_deg:number;min_sun_hours:number;min_earth_hours:number;observer_height_m:number;vehicle_profile?:VehicleProfile;effective_max_slope_deg?:number
}
export type RescueProposal={
 id:string;label:string;proposed_request:PlanRequest;delta_hours:number
 mission:AutomaticPlan['mission'];best:MissionPoint;counts:AutomaticPlan['counts']
 criteria_preserved:boolean;changes:string[];sources:unknown[]
}
export type RescueReport={
 status:'found'|'none'|'blocked'|'unavailable';message?:string
 original_request:PlanRequest;criteria_preserved:boolean
 diagnosis:{code?:string;terrain_eligible_cells:number;horizon_eligible_cells:number;original_green:number;original_yellow:number;blockers:{code:string;label:string;count:number}[];[key:string]:unknown}
 proposals:RescueProposal[]
 search:{search_days:number;coarse_step_hours:number;refine_step_hours:number;tested_offsets_hours:number[];tested_scenarios:number;max_start_utc:string;scope:string;[key:string]:unknown}
 meta:{sources:unknown[];limitations:string[];[key:string]:unknown}
}
export type AdoptedAlternative={original_text:string;original:PlanRequest;proposal:RescueProposal;search:RescueReport['search'];meta:RescueReport['meta']}
