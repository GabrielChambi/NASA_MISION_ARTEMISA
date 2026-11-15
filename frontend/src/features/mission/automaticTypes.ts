export type MissionIntent = {
  departure_utc:string;requested_utc?:string;local_datetime:string;timezone:string
  date_kind:'departure'|'landing';surface_hours:number;max_slope_deg:number
  min_sun_hours:number;min_earth_hours:number
}
export type MissionPoint={
  id:string;latitude_deg:number;longitude_deg:number;elevation_m:number
  regional_slope_deg:number;sun_hours:number;earth_hours:number;joint_hours?:number
  score?:number;risk?:'green'|'red'|'unknown';reasons:string[]
  sun_margin_deg?:number;earth_margin_deg?:number
  time_series?:MissionTimeSample[]
}
export type MissionTimeSample={
  t_utc:string;sun_azimuth_deg:number;sun_elevation_deg:number;sun_horizon_deg:number
  earth_azimuth_deg:number;earth_elevation_deg:number;earth_horizon_deg:number
}
export type AutomaticPlan={
  status:string
  mission:{departure_utc:string;arrival_utc:string;surface_end_utc:string;return_utc:string;outbound_hours:number;surface_hours:number;total_hours:number;assumptions?:string[];[key:string]:unknown}
  best:MissionPoint|null;alternatives:MissionPoint[];rejected:MissionPoint[];closest_candidate?:MissionPoint|null
  total_cells:number
  counts:{evaluated?:number;green:number;red:number;unknown:number;[key:string]:number|undefined}
  cells:{id:string;risk:string;[key:string]:unknown}[]
  meta:{sources:unknown[];limitations:string[];[key:string]:unknown}
}
