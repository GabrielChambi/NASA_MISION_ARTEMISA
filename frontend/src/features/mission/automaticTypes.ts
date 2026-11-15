
export type MissionIntent = {
  departure_utc:string;requested_utc?:string;local_datetime:string;timezone:string
  date_kind:'departure'|'landing';surface_hours:number;max_slope_deg:number
  min_sun_hours:number;min_earth_hours:number
}
export type SurfaceRisk='green'|'yellow'|'red'|'unknown'
export type SensitivityRange={lower:number;upper:number}
export type MissionPoint={
  id:string;name?:string;row?:number;col?:number;x_m?:number;y_m?:number
  latitude_deg:number;longitude_deg:number;elevation_m:number|null
  regional_slope_deg:number|null;max_slope_deg?:number|null
  coverage_fraction?:number;area_km2?:number;valid_to_min_m?:number|null
  sun_hours:number|null;earth_hours:number|null;joint_hours?:number|null
  score?:number|null;risk:SurfaceRisk;reason?:string;reasons:string[]
  sun_margin_deg?:number|null;earth_margin_deg?:number|null
  longest_dark_hours?:number|null;longest_earth_hidden_hours?:number|null
  sun_hours_sensitivity?:SensitivityRange;earth_hours_sensitivity?:SensitivityRange
  time_series?:MissionTimeSample[]
  [key:string]:unknown
}
export type MissionTimeSample={
  t_utc:string;sun_azimuth_deg:number;sun_elevation_deg:number;sun_horizon_deg:number
  earth_azimuth_deg:number;earth_elevation_deg:number;earth_horizon_deg:number
}
export type SurfaceCoverage={
  cap_area_km2:number;represented_area_km2:number;unrepresented_area_km2:number;evaluated_area_km2:number
  by_class:Record<SurfaceRisk,{cells:number;area_km2:number;fraction_of_cap:number}>
  source_resolution_m:number;cell_spacing_m:number;latitude_bounds_deg:[number,number]
  area_method:string;scope:string
}
export type AutomaticPlan={
  status:string
  mission:{departure_utc:string;arrival_utc:string;surface_end_utc:string;return_utc:string;outbound_hours:number;surface_hours:number;total_hours:number;assumptions?:string[];[key:string]:unknown}
  best:MissionPoint|null;alternatives:MissionPoint[];rejected:MissionPoint[];closest_candidate?:MissionPoint|null
  total_cells:number
  counts:{evaluated?:number;green:number;yellow:number;red:number;unknown:number;[key:string]:number|undefined}
  cells:MissionPoint[]
  coverage:SurfaceCoverage
  meta:{sources:unknown[];limitations:string[];[key:string]:unknown}
}
