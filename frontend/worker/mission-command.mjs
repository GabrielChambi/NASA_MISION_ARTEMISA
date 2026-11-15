/** Deterministic dispatcher for auditable mission experiments. No scientific quantities are generated. */
import {normalizeMissionText} from './text-normalization.mjs'
import {parseMissionIntent} from './mission-intent.mjs'
import {wallTime,wallToUtc} from './timezones.mjs'
const NUMBER='(?<![\\d.,-])(-?\\d+(?:[.,]\\d+)?)(?![\\d.,])'
const months='enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre'
const numeric=s=>Number(s.replace(',','.'))
const asHours=(n,unit)=>numeric(n)*(/dia/.test(unit)?24:/min/.test(unit)?1/60:1)
function result(kind,extra={}){return {kind,...extra}}
function clarification(question){return result('clarify',{question})}
const hasYear=text=>/\b(?:19\d{2}|20\d{2}|2100)\b/.test(text)
const hasDate=text=>new RegExp('\\b(?:\\d{1,2}\\s*(?:de|/|[.])?\\s*(?:'+months+')|(?:'+months+')\\s+\\d{1,2}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{4})','i').test(text)
const imperative=text=>/\b(cambia|cambiar|pon|poner|usa|usar|fija|ajusta|reduce|aumenta|prueba|simula|simular|calcula|planifica|planificar|quiero|quisiera|necesito|retrasa|retrasar|reprograma|supongamos)\b/.test(text)||/^(y\s+)?(si|ahora|mejor)\b/.test(text)
export function resolveMissionCommand(message,context={}){
 if(typeof message!=='string'||!message.trim()||message.length>1600)return clarification('Escribe tu misión o el cambio que quieres estudiar, hasta 1600 caracteres.')
 const text=normalizeMissionText(message),mission=context.mission??null,zone=context.timezone??'America/New_York'
 if(/\b(?:no|nunca|jamas)\s+(?:me\s+)?(?:cambies|cambiar|reduzcas|reducir|apliques|aplicar|retrases|retrasar|modifiques|uses|usar|utilices|utilizar|quiero|quieras)\b/.test(text))return result('question')
 if(/\b(?:restaura|restaurar|quita|quitar|elimina|eliminar)\b/.test(text)&&/fallo|corte|perdida solar/.test(text))return mission?result('operations',{operations:{fault:{solar_loss_fraction:0,solar_fault_start_hour:0,earth_outage_hours:0,earth_outage_start_hour:0}},changes:['Retirar los fallos introducidos; misma misión y hardware']}):clarification('Primero planifica una misión.')
 const defaults=mission??context.defaults??{}
 if(context.pending_command_text&&/^(?:wh|kwh|w|kw|horas?|dias?|\d+(?:[.,]\d+)?\s*(?:wh|kwh|w|kw|%|horas?|dias?))$/i.test(text))return resolveMissionCommand(context.pending_command_text+' '+message,{...context,pending_command_text:null})
 // A date awaiting clarification stays separate from an already evaluated mission.
 if(context.pending_text&&!/\b(cancela|olvida|nueva mision|empezar de nuevo)\b/.test(text)){
  const joined=context.pending_text+' '+message
  const joinedText=normalizeMissionText(joined)
  if(hasYear(joinedText)){
   const parsed=parseMissionIntent({message:joined,timezone:zone,defaults})
   if(!parsed.needs_clarification)return result('plan',{message:joined,source_message:message,parsed:parsed.intent,context_used:true})
  }
 }
 const operation={energy:{},fault:{},landing:{}},descriptions=[]
 let requiresUnits=false
 const set=(group,key,value,label)=>{operation[group][key]=value;descriptions.push(label)}
 const find=(pattern,fn)=>{const m=text.match(new RegExp(pattern,'i'));if(m)fn(m)}
 find('\\bbateria(?:\\s+(?:de|a|con|tiene|es|capacidad|la|en))*\\s*'+NUMBER+'\\s*(kwh|wh)\\b',m=>set('energy','battery_capacity_wh',numeric(m[1])*(m[2]==='kwh'?1000:1),'Batería: '+numeric(m[1])+' '+m[2]))
 if(/\bbateria\s+(?:de\s+)?\d/.test(text)&&!Object.hasOwn(operation.energy,'battery_capacity_wh')&&!/%/.test(text))requiresUnits=true
 find('\\b(?:consumo|carga)(?:\\s+(?:esencial|base|continua|de|a|en))*\\s*'+NUMBER+'\\s*(kw|w)\\b',m=>set('energy','essential_load_w',numeric(m[1])*(m[2]==='kw'?1000:1),'Consumo esencial: '+numeric(m[1])+' '+m[2]))
 find('\\b(?:reserva|reserva minima)(?:\\s+(?:de|a|del|al|en))*\\s*'+NUMBER+'\\s*%',m=>set('energy','reserve_soc',numeric(m[1])/100,'Reserva: '+m[1]+' %'))
 find('\\b(?:carga inicial|bateria inicial|estado de carga inicial)(?:\\s+(?:de|a|del|al|en))*\\s*'+NUMBER+'\\s*%',m=>set('energy','initial_soc',numeric(m[1])/100,'Carga inicial: '+m[1]+' %'))
 find('\\b(?:panel(?:es)?(?: solar(?:es)?)?|area solar|area de paneles)(?:\\s+(?:de|a|con|en|un area de))*\\s*'+NUMBER+'\\s*m(?:2|²|etros cuadrados)\\b',m=>set('energy','solar_area_m2',numeric(m[1]),'Área de paneles: '+m[1]+' m²'))
 find('\\b(?:eficiencia(?: solar| del panel| de paneles)?)(?:\\s+(?:de|a|del|al|en))*\\s*'+NUMBER+'\\s*%',m=>set('energy','solar_efficiency',numeric(m[1])/100,'Eficiencia solar: '+m[1]+' %'))
 find('\\b(?:necesito|quiero|realizar|completar|conservar|mantener)\\s+'+NUMBER+'\\s*(horas?|h)\\s*(?:de\\s+)?ciencia\\b',m=>set('energy','science_duration_hours',numeric(m[1]),'Ciencia requerida: '+m[1]+' h'))
 find('\\bciencia(?:\\s+(?:de|durante|por|a))*\\s*'+NUMBER+'\\s*(horas?|h)\\b',m=>set('energy','science_duration_hours',numeric(m[1]),'Ciencia requerida: '+m[1]+' h'))
 find('\\b(?:pierde|perder|reduce|reducir|reduccion|perdida)(?:\\s+(?:un|el|de|la|produccion|solar|del|al))*\\s*'+NUMBER+'\\s*%[^.;]{0,35}(?:solar|sol|panel)',m=>set('fault','solar_loss_fraction',numeric(m[1])/100,'Pérdida de producción solar: '+m[1]+' %'))
 find(NUMBER+'\\s*%\\s*(?:menos|de perdida)[^.;]{0,35}(?:solar|sol|panel)',m=>set('fault','solar_loss_fraction',numeric(m[1])/100,'Pérdida de producción solar: '+m[1]+' %'))
 find('\\b(?:panel(?:es)?|produccion solar)[^.;]{0,22}(?:produce[n]?|rinde[n]?|genera[n]?)[^.;]{0,12}'+NUMBER+'\\s*%\\s*menos',m=>set('fault','solar_loss_fraction',numeric(m[1])/100,'Pérdida de producción solar: '+m[1]+' %'))
 find('\\b(?:sin|perder|pierdo|corte de|perdida de)\\s+(?:las?\\s+)?(?:comunicaciones|comunicacion|enlace|contacto con la tierra)(?:\\s+(?:durante|por|de|con la tierra))*\\s*'+NUMBER+'\\s*(horas?|h|dias?|minutos?)\\b',m=>set('fault','earth_outage_hours',asHours(m[1],m[2]),'Corte de comunicaciones: '+asHours(m[1],m[2])+' h'))
 if(Object.hasOwn(operation.fault,'solar_loss_fraction'))find('(?:a partir de|desde)\\s+(?:la\\s+)?hora\\s*'+NUMBER,m=>set('fault','solar_fault_start_hour',numeric(m[1]),'Fallo solar desde +'+m[1]+' h'))
 if(Object.hasOwn(operation.fault,'earth_outage_hours'))find('(?:a partir de|desde)\\s+(?:la\\s+)?hora\\s*'+NUMBER,m=>set('fault','earth_outage_start_hour',numeric(m[1]),'Corte desde +'+m[1]+' h'))
 find('\\b(?:radio|huella|radio de apoyo)(?:\\s+(?:de|a|la nave|apoyo))*\\s*'+NUMBER+'\\s*(?:m|metros)\\b',m=>set('landing','footprint_radius_m',numeric(m[1]),'Radio de huella: '+m[1]+' m'))
 if(requiresUnits)return clarification('¿La capacidad de batería está en Wh o en kWh? Por ejemplo: «batería de 1000 Wh».')
 const changes=Object.values(operation).some(group=>Object.keys(group).length)
 if(changes&&/\bcompara(?:r)?\b/.test(text)&&/\b(contra|frente|versus|vs|entre)\b/.test(text))return clarification('Para no modificar un escenario ambiguo, indica primero qué configuración quieres ensayar, por ejemplo «batería de 1000 Wh». Después podrás compararla con otro presupuesto calculado.')
 const queryOnly=/^(?:¿?\s*)?(por que|porque|que significa|cuanto|como|cual|donde|what|why|how)\b/.test(text)&&!imperative(text)
 if(queryOnly&&!/\by si\b/.test(text))return result('question')
 const shift=text.match(new RegExp('\\b(retrasa|retrasar|pospone|posponer|aplaza|retraso)(?:\\s+(?:la|el|salida|lanzamiento|despegue|mision|viaje|en|por|de))*\\s*'+NUMBER+'\\s*(horas?|h|dias?|minutos?)\\b','i'))
 let next=null
 if(shift){
  if(!mission)return clarification('Primero indica la fecha de salida; conservaré ese contexto para aplicar el retraso.')
  const hours=asHours(shift[2],shift[3]);if(!Number.isFinite(hours)||hours<0||hours>72)return clarification('El ensayo admite un retraso de hasta 72 horas. Indica uno dentro de ese intervalo.')
  const utc=new Date(Date.parse(mission.departure_utc)+hours*3600000).toISOString().replace('.000Z','Z')
  next={...mission,departure_utc:utc,requested_utc:utc,local_datetime:wallTime(utc,zone),timezone:zone}
  descriptions.push('Fecha solicitada: +'+hours+' h')
 }
 let effectiveMessage=message,contextYear=false
 if(mission&&hasDate(text)&&!hasYear(text)&&imperative(text)){effectiveMessage=text.replace(new RegExp('\\b('+months+')\\b'),'$1 de '+wallTime(mission.departure_utc,zone).slice(0,4));contextYear=true;descriptions.push('Año '+wallTime(mission.departure_utc,zone).slice(0,4)+' conservado del escenario activo')}
 const constraint=parseMissionIntent({message:effectiveMessage,timezone:zone,defaults})
 const explicit=constraint.explicit_fields??[]
 const absolute=hasDate(normalizeMissionText(effectiveMessage))&&hasYear(normalizeMissionText(effectiveMessage))
 const timeOnly=!absolute&&/\b(?:cambia|cambiar|pon|mejor|ahora|salir|salida|despegar|alunizar|llegar)\b/.test(text)&&/\ba\s*las?\s*\d{1,2}|\b\d{1,2}:\d{2}|\b\d{1,2}\s*[ap]m\b/.test(text)
 if(absolute){
  if(constraint.needs_clarification)return clarification(constraint.question)
  // New dates keep requirements from the active scenario via defaults; the date meaning only changes when explicitly stated.
  next={...constraint.intent,date_kind:/aluniz|aterriz|llegar|llegada/.test(text)?'landing':/viaj|salir|salida|despeg|lanz|partir/.test(text)?'departure':mission?.date_kind??constraint.intent.date_kind}
 }else if(timeOnly&&mission){
  const local=wallTime(mission.departure_utc,zone).slice(0,10)
  const parsed=parseMissionIntent({message:local+' '+message,timezone:zone,defaults})
  if(parsed.needs_clarification)return clarification(parsed.question)
  next={...mission,...parsed.intent,date_kind:/aluniz|llegada/.test(text)?'landing':mission.date_kind}
  descriptions.push('Hora actualizada, misma fecha y requisitos')
 }else if(explicit.length&&mission){
  next={...(next??mission)}
  for(const key of explicit)next[key]=constraint.intent[key]
  if(explicit.some(k=>k==='surface_hours')&&(next.min_sun_hours>next.surface_hours||next.min_earth_hours>next.surface_hours))return clarification('La nueva estancia es menor que las horas mínimas actuales de Sol o Tierra. Indica qué requisito quieres cambiar; no los reduciré automáticamente.')
  if(constraint.needs_clarification&&constraint.question&&!/fecha/.test(constraint.question))return clarification(constraint.question)
  descriptions.push('Requisitos de misión actualizados; los demás se conservan')
 }
 if(next&&mission&&explicit.includes('surface_hours')&&((!explicit.includes('min_sun_hours')&&mission.min_sun_hours>next.surface_hours)||(!explicit.includes('min_earth_hours')&&mission.min_earth_hours>next.surface_hours)))return clarification('La nueva estancia es menor que las horas mínimas actuales. Indica qué requisito quieres cambiar; no reduciré tus límites automáticamente.')
 if(next)return result('plan',{message:contextYear?effectiveMessage:message,parsed:next,operations:changes?operation:undefined,changes:descriptions,context_used:Boolean(mission)})
 if(changes){if(!mission&&!absolute)return clarification('Indica primero la fecha y hora de la misión; después podré evaluar esa configuración.');return result('operations',{operations:operation,changes:descriptions})}
 if(/\b(?:aplica|aplicar|elige|elegir|usa|usar)\b[^.;]{0,35}\b(?:alternativa|propuesta|opcion)\b/.test(text)||/^(aplica|aplicar|usa) (la )?(primera|segunda|tercera)\b/.test(text)){
  const m=text.match(/(?:alternativa|propuesta|opcion)\s*(\d|primera|segunda|tercera)|\b(primera|segunda|tercera)\b/),rank=m?.[1]??m?.[2]??'1'
  const index={primera:0,segunda:1,tercera:2}[rank]??Number(rank)-1
  return index>=0&&index<3?result('apply_proposal',{index}):clarification('Elige una de las tres propuestas calculadas que aparecen en el resultado.')
 }
 if(/\b(busca|buscar|compara|comparar|optimiza|optimizar|encuentra|encontrar)\b/.test(text)&&/alternativ|solucion|mejor|otra|opcion|ajuste/.test(text))return mission?result('search'):clarification('Indica la fecha y hora de tu misión para comenzar la búsqueda.')
 if(/\b(?:analiza|analizar|estudia|estudiar|acerca|acercar|muestra|mostrar)\b/.test(text)&&/huella|local|detalle|terreno/.test(text))return mission?result('inspect'):clarification('Primero planifica una misión para estudiar su destino.')
 if(/\b(cancela|cancelar|deten|detener)\b/.test(text))return result('cancel')
 if(hasDate(text)||!mission&&hasYear(text)||!mission&&imperative(text))return result('plan',{message})
 if(imperative(text)||/\b(y si|que pasa si|supongamos)\b/.test(text))return result('unresolved',{message})
 return result('question')
}
export function validateOperationPatch(patch){
 const limits={energy:{battery_capacity_wh:[.01,1e7],essential_load_w:[0,1e6],reserve_soc:[0,1],initial_soc:[0,1],solar_area_m2:[.01,1000],solar_efficiency:[.001,1],science_duration_hours:[0,336]},fault:{solar_loss_fraction:[0,1],solar_fault_start_hour:[0,336],earth_outage_hours:[0,336],earth_outage_start_hour:[0,336]},landing:{footprint_radius_m:[5,60]}}
 if(!patch||typeof patch!=='object')throw new Error('El cambio no contiene parámetros verificables.')
 for(const [group,values] of Object.entries(patch)){
  if(!Object.hasOwn(limits,group)||!values||typeof values!=='object'||Array.isArray(values))throw new Error('Grupo de parámetros no autorizado.')
  for(const [key,v] of Object.entries(values)){
   const range=Object.hasOwn(limits[group],key)?limits[group][key]:null
   if(!range||typeof v!=='number'||!Number.isFinite(v)||v<range[0]||v>range[1])throw new Error('Revisa el valor de '+key+'. No se ha aplicado el cambio.')
  }
 }
 return patch
}
