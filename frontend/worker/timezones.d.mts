export type LaunchSite={id:string;name:string;timezone:string;use:string;source_url:string}
export const TIMEZONES:string[]
export const LAUNCH_SITES:LaunchSite[]
export function wallTime(utc:string,timezone?:string):string
export function wallToUtc(local:string,timezone?:string):string
export function formatMissionDate(utc:string,timezone?:string):string
