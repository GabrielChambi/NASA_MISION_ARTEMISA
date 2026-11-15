/** IANA conversion. Ambiguous or nonexistent daylight-saving wall times are rejected. */
export const TIMEZONES=['America/New_York','America/Los_Angeles','America/La_Paz','UTC']
export const LAUNCH_SITES=[
 {id:'ksc-39b',name:'Kennedy Space Center · LC-39B',timezone:'America/New_York',use:'Referencia Artemis / SLS',source_url:'https://www.nasa.gov/humans-in-space/exploration-ground-systems/launch-pad-39b/'},
 {id:'ksc-39a',name:'Kennedy Space Center · LC-39A',timezone:'America/New_York',use:'Lanzamientos comerciales para NASA',source_url:'https://www.nasa.gov/humans-in-space/commercial-space/commercial-crew-program/commercial-crew-program-overview/'},
 {id:'vandenberg-4e',name:'Vandenberg · SLC-4E',timezone:'America/Los_Angeles',use:'Misiones científicas; compatibilidad de trayectoria lunar no evaluada',source_url:'https://svs.gsfc.nasa.gov/14803/'}
]
export function wallTime(utc,timezone='America/New_York'){
 const d=new Date(utc);if(!Number.isFinite(d.getTime())||!TIMEZONES.includes(timezone))throw new Error('Fecha o zona horaria inválida.')
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d).map(v=>[v.type,v.value]))
 return p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute
}
export function wallToUtc(local,timezone='America/New_York'){
 if(typeof local!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(local)||!TIMEZONES.includes(timezone))throw new Error('Fecha o zona horaria inválida.')
 const wall=Date.parse(local+':00Z')
 if(!Number.isFinite(wall)||new Date(wall).toISOString().slice(0,16)!==local)throw new Error('La fecha local no es válida.')
 const matches=[]
 // All explicitly supported IANA zones have whole-hour offsets in the supported date range.
 for(let offset=-14;offset<=14;offset++){
  const candidate=new Date(wall-offset*3600000).toISOString()
  if(wallTime(candidate,timezone)===local)matches.push(candidate.replace('.000Z','Z'))
 }
 if(matches.length===0)throw new Error('Esa hora local no existe por el horario de verano. Indica otra hora o UTC explícito.')
 if(matches.length>1)throw new Error('Esa hora local ocurre dos veces por el cambio de horario. Indica UTC o un desplazamiento explícito.')
 return matches[0]
}
export function formatMissionDate(utc,timezone='America/New_York'){
 return new Intl.DateTimeFormat('es',{timeZone:timezone,day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(utc))
}
