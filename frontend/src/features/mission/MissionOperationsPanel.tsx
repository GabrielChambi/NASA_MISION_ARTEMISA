import {useI18n} from '../../i18n/LanguageContext'
import {useEffect,useRef,useState} from 'react'
import {Activity,ArrowRight,BatteryCharging,Check,ChevronDown,Download,FlaskConical,LoaderCircle,MapPin,RefreshCw,ShieldAlert,X} from 'lucide-react'
import type {AutomaticPlan,MissionIntent,MissionPoint,VehicleProfile} from './automaticTypes'
import type {PlanRequest} from './rescueTypes'
import {formatMissionDate,type LaunchSite} from '../../../worker/timezones.mjs'
import {DEFAULT_ENERGY,DEFAULT_FAULT,DEFAULT_LANDING,type Budget,type EnergyConfig,type FaultConfig,type LandingSettings,type LocalStudy,type OperationsReport,type OperationsRepair,type OperationsProposal,type Policy} from './operationsTypes'
import {validateOperationPatch,type OperationPatch} from '../../../worker/mission-command.mjs'
import './operations.css'
type NumericEnergy={ [K in keyof EnergyConfig]:EnergyConfig[K] extends number?K:never }[keyof EnergyConfig]
type LocalTarget={latitude_deg:number;longitude_deg:number;regional_id:string;name:string}
export type OperationsCommand={id:number;expected_utc:string;patch?:OperationPatch;action?:'search'|'apply_proposal'|'inspect'|'cancel';index?:number}
type Props={command?:OperationsCommand|null;onCommandFeedback?:(message:string,success:boolean)=>void;plan:AutomaticPlan|null;selected:MissionPoint|null;intent:MissionIntent|null;vehicle:VehicleProfile;launchSite:LaunchSite;timezone:string;message:string;onApply:(request:PlanRequest,cellId:string,label:string)=>void;onInspect:(lat:number,lon:number)=>string|undefined;onEvidence:(data:unknown)=>void}
function Chart({baseline,affected,reserve}:{baseline:Budget;affected:Budget;reserve:number}){
 const {tr,number:n}=useI18n()

 const w=680,h=175,p=29,last=Math.max(1,affected.states.at(-1)?.hour??1)
 const path=(b:Budget)=>b.states.map((s,i)=>(i?'L':'M')+(p+s.hour/last*(w-2*p)).toFixed(2)+','+(h-p-s.soc*(h-2*p)).toFixed(2)).join(' ')
 const line=h-p-reserve*(h-2*p)
 return <figure className="energy-chart"><svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={tr("Batería estimada con escenario original y fallo")}><line x1={p} y1={h-p} x2={w-p} y2={h-p} stroke="#46515f"/><line x1={p} y1={line} x2={w-p} y2={line} stroke="#e6be64" strokeDasharray="5 5"/><text x={w-p} y={line-5} textAnchor="end">{tr("Reserva")} {tr(n(reserve*100,0))} %</text>{[0,.5,1].map(v=><text key={v} x={p-5} y={h-p-v*(h-2*p)+3} textAnchor="end">{v*100}%</text>)}<path d={path(baseline)} fill="none" stroke="#8195a9" strokeWidth="2" strokeDasharray="5 4"/><path d={path(affected)} fill="none" stroke="#a2edc2" strokeWidth="2.5"/><text x={p} y={h-7}>{tr("Llegada")}</text><text x={w-p} y={h-7} textAnchor="end">+{tr(n(last,0))} h</text></svg><figcaption><span><i className="original"/>{" "}{tr("Sin fallo introducido")}</span><span><i/>{" "}{tr("Escenario estudiado")}</span><small>{tr("Modelo eléctrico · muestras NASA cada 15 min")}</small></figcaption></figure>
}
function LocalMap({study}:{study:LocalStudy}){
 const {tr,number:n}=useI18n()

 const ref=useRef<HTMLCanvasElement>(null),[hover,setHover]=useState('')
 useEffect(()=>{
  const canvas=ref.current;if(!canvas)return
  const g=study.grid;canvas.width=g.width;canvas.height=g.height
  const ctx=canvas.getContext('2d');if(!ctx)return
  const pixels=ctx.createImageData(g.width,g.height),palette=[[111,129,145],[100,221,158],[235,190,91],[221,103,120]]
  for(let i=0;i<g.risk.length;i++){
   const height=g.elevations_m[i],shade=height==null?20:45+Math.round(85*(height-g.elevation_min_m)/Math.max(1,g.elevation_max_m-g.elevation_min_m))
   const color=g.inside_ellipse[i]?palette[g.risk[i]]:[shade,shade+8,shade+12]
   pixels.data.set([...color,255],i*4)
  }
  ctx.putImageData(pixels,0,0)
  ctx.strokeStyle='#f0f5f7';ctx.lineWidth=Math.max(.6,g.width/220);ctx.beginPath();ctx.moveTo(g.width/2-3,g.height/2);ctx.lineTo(g.width/2+3,g.height/2);ctx.moveTo(g.width/2,g.height/2-3);ctx.lineTo(g.width/2,g.height/2+3);ctx.stroke()
 },[study])
 return <div className="local-native-map"><span className="local-map-north"><b style={{transform:`rotate(${study.center.longitude_deg}deg)`}}>↑</b> N</span><canvas ref={ref} aria-label={tr("Estudio de la elipse de dispersión con píxeles NASA nativos")} onPointerMove={e=>{const rect=e.currentTarget.getBoundingClientRect(),g=study.grid;const x=Math.min(g.width-1,Math.max(0,Math.floor((e.clientX-rect.left)/rect.width*g.width))),y=Math.min(g.height-1,Math.max(0,Math.floor((e.clientY-rect.top)/rect.height*g.height))),i=y*g.width+x;setHover('Elevación '+n(g.elevations_m[i],2)+' m · '+(['Sin resolver','Cumple el modelo local','Margen limitado','No cumple'][g.risk[i]])+(g.inside_ellipse[i]?' · dentro de la elipse':' · contexto'))}}/><div className="native-map-caption"><span>{tr("Norte real indicado ·")}{" "}{study.native_spacing_m}{" "}{tr("m por píxel nativo")}</span><span>{tr("+ Centro solicitado")}</span></div><p className="local-map-readout">{tr(hover||'Cada centro dentro de la elipse se evalúa con el área que ocuparía la nave.')}</p></div>
}
export default function MissionOperationsPanel({command,onCommandFeedback,plan,selected,intent,vehicle,launchSite,timezone,message,onApply,onInspect,onEvidence}:Props){
 const {tr,number:n,language}=useI18n()

 const [energy,setEnergy]=useState<EnergyConfig>(DEFAULT_ENERGY),[fault,setFault]=useState<FaultConfig>(DEFAULT_FAULT),[landing,setLanding]=useState<LandingSettings>(DEFAULT_LANDING),[policy,setPolicy]=useState<Policy>({science_slots:null,optional_enabled:true})
 const [tab,setTab]=useState<'energy'|'local'>('energy'),[configuration,setConfiguration]=useState(false),[target,setTarget]=useState<LocalTarget|null>(null)
 const [report,setReport]=useState<OperationsReport|null>(null),[repair,setRepair]=useState<OperationsRepair|null>(null),[busy,setBusy]=useState(false),[repairBusy,setRepairBusy]=useState(false),[error,setError]=useState(''),[repairError,setRepairError]=useState(''),[elapsed,setElapsed]=useState(0),[attempt,setAttempt]=useState(0),[applied,setApplied]=useState('')
 const [coordinates,setCoordinates]=useState({latitude:'',longitude:''})
 const [sites,setSites]=useState<{id:string;name:string;latitude_deg:number;longitude_deg:number}[]>([])
 const lastCommand=useRef(0),commandFeedback=useRef(onCommandFeedback)
 commandFeedback.current=onCommandFeedback
 const adoption=useRef<unknown>(null)
 const request=useRef<AbortController|null>(null),repairRequest=useRef<AbortController|null>(null),evidenceCallback=useRef(onEvidence)
 evidenceCallback.current=onEvidence
 const mission:PlanRequest|null=intent?{departure_utc:intent.departure_utc,date_kind:intent.date_kind,surface_hours:intent.surface_hours,max_slope_deg:intent.max_slope_deg,min_sun_hours:intent.min_sun_hours,min_earth_hours:intent.min_earth_hours,observer_height_m:2,vehicle_profile:vehicle}:null
 const payload=plan&&selected&&mission?{mission,cell_id:selected.id,launch_site_id:launchSite.id,energy,fault,landing,policy,target_coordinates:target?{latitude_deg:target.latitude_deg,longitude_deg:target.longitude_deg}:undefined,candidate_ids:[...(plan.best?[plan.best.id]:[]),...plan.alternatives.map(c=>c.id)].slice(0,4)}:null
 const key=JSON.stringify(payload)
 useEffect(()=>{const ac=new AbortController();fetch('/api/sites',{signal:ac.signal}).then(r=>r.json()).then(d=>{if(!ac.signal.aborted&&Array.isArray(d.sites))setSites(d.sites)}).catch(()=>{});return()=>ac.abort()},[])
 useEffect(()=>{if(target&&selected&&selected.id!==target.regional_id)setTarget(null)},[selected?.id,target])
 useEffect(()=>{if(report)setCoordinates({latitude:String(report.local_study.center.latitude_deg),longitude:String(report.local_study.center.longitude_deg)})},[report?.local_study.center.latitude_deg,report?.local_study.center.longitude_deg])
 useEffect(()=>{
  const data=JSON.parse(key);setReport(null);setRepair(null);setError('');setRepairError('');setRepairBusy(false);repairRequest.current?.abort();evidenceCallback.current(null)
  if(!data){setBusy(false);return}
  const ac=new AbortController();request.current=ac;setBusy(true);setElapsed(0)
  const start=performance.now(),clock=window.setInterval(()=>{if(ac.signal.aborted){window.clearInterval(clock);return}setElapsed(Math.floor((performance.now()-start)/1000))},1000)
  const timer=window.setTimeout(()=>{
   fetch('/api/operations/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:key,signal:ac.signal}).then(async response=>{const d=await response.json();if(!response.ok||d.status!=='ok')throw new Error(d.message??'Estudio local no disponible. Inicia la API científica con npm run dev:full.');if(!ac.signal.aborted)setReport(d)}).catch(e=>{if(!ac.signal.aborted)setError(e instanceof Error?e.message:'No se pudo obtener el estudio.')}).finally(()=>{if(!ac.signal.aborted){setBusy(false);window.clearInterval(clock)}})
  },650)
  return()=>{ac.abort();window.clearTimeout(timer);window.clearInterval(clock)}
 },[key,attempt])
 useEffect(()=>{
  evidenceCallback.current(report?{...report,repair,applied,configuration:{energy,fault,landing,policy},adopted_operational_scenario:adoption.current,original_message:message}:null)
 },[report,repair,applied,energy,fault,landing,policy,message])
 useEffect(()=>{
  if(report?.affected.budget.status==='ok'&&!report.affected.budget.feasible)void findRepairs()
  return()=>repairRequest.current?.abort()
 // A new scientific report starts a bounded search; UI edits abort its results.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[report,busy])
 useEffect(()=>()=>{request.current?.abort();repairRequest.current?.abort()},[])
 async function findRepairs(){
  if(!payload||busy)return
  repairRequest.current?.abort();const ac=new AbortController();repairRequest.current=ac;setRepairBusy(true);setRepairError('');setRepair(null)
  try{const response=await fetch('/api/operations/replan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:ac.signal});const d=await response.json();if(!response.ok||!['found','none'].includes(d.status)||d.criteria_preserved!==true)throw new Error(d.message??'No se pudo verificar una alternativa.');if(!ac.signal.aborted)setRepair(d)}catch(e){if(!ac.signal.aborted)setRepairError(e instanceof Error?e.message:'Búsqueda no disponible.')}finally{if(!ac.signal.aborted)setRepairBusy(false)}
 }
 useEffect(()=>{
  if(!command||lastCommand.current===command.id||!plan||!mission||mission.departure_utc!==command.expected_utc)return
  if(command.action==='search'&&busy)return
  lastCommand.current=command.id
  try{
   if(command.patch){
    const patch=validateOperationPatch(command.patch)
    const nextEnergy={...energy,...patch.energy},nextFault={...fault,...patch.fault}
    if(nextEnergy.science_duration_hours+nextEnergy.science_start_hour>mission.surface_hours)throw new Error('La ciencia solicitada termina fuera de la estancia. Indica una duración compatible; no reduciré tu objetivo.')
    if([nextFault.solar_fault_start_hour,nextFault.earth_outage_start_hour,nextFault.earth_outage_hours].some(h=>h>mission.surface_hours))throw new Error('El fallo queda fuera de la estancia. Indica su inicio y duración dentro del intervalo calculado.')
    request.current?.abort();repairRequest.current?.abort();setReport(null);setRepair(null);setError('');setApplied('');setPolicy({science_slots:null,optional_enabled:true})
    if(patch.energy)setEnergy(nextEnergy)
    if(patch.fault)setFault(nextFault)
    if(patch.landing){setLanding(p=>({...p,...patch.landing}));setTab('local')}else setTab('energy')
    setAttempt(a=>a+1)
    commandFeedback.current?.('Cambio aplicado. Recalculo con NASA y conservo los demás parámetros.',true)
   }
   if(command.action==='inspect'){setTab('local');document.querySelector('.mission-operations')?.scrollIntoView({behavior:'smooth',block:'start'})}
   if(command.action==='search'){void findRepairs();commandFeedback.current?.('Comparo las alternativas disponibles con tus requisitos actuales.',true)}
   if(command.action==='cancel'){request.current?.abort();repairRequest.current?.abort();setBusy(false);setRepairBusy(false);setError('Estudio detenido; no se ha aplicado otra alternativa.')}
   if(command.action==='apply_proposal'){
    const chosen=repair?.proposals[command.index??0]
    if(!chosen)throw new Error('No hay una propuesta operativa calculada con ese número. Primero pide «busca alternativas».')
    apply(chosen)
   }
  }catch(e){commandFeedback.current?.(e instanceof Error?e.message:'No se aplicó el cambio.',false)}
 // Each explicitly dispatched command executes once against the matching mission.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[command?.id,plan,mission?.departure_utc,busy])
 function apply(proposal:OperationsProposal){
  if(!proposal.criteria_preserved)return
  adoption.current={original_report:report,repair,chosen_proposal:proposal,energy,fault,landing,policy}
  setFault(f=>({...f,delay_hours:0}));setPolicy(proposal.policy);setApplied(proposal.label+' · '+formatMissionDate(proposal.proposed_request.departure_utc,timezone,language))
  setTarget({...(proposal.target_coordinates),regional_id:proposal.cell_id,name:'Alternativa aplicada'})
  onApply(proposal.proposed_request,proposal.cell_id,proposal.label)
 }
 function chooseLocal(lat:number,lon:number,name:string){if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat< -90||lat> -80||lon< -180||lon>180){setError('Revisa latitud (−90 a −80°) y longitud (−180 a 180°).');return}setApplied('');const id=onInspect(lat,lon);if(id){setTarget({latitude_deg:lat,longitude_deg:lon,regional_id:id,name});setTab('local')}else setError('El centro está fuera de la cobertura del catálogo regional.')}
 function changeEnergy(k:NumericEnergy,value:number){setPolicy({science_slots:null,optional_enabled:true});setApplied('');setEnergy(p=>({...p,[k]:value}))}
 function field(label:string,k:NumericEnergy,min:number,max:number,step:number|undefined=1){return <label key={k}>{tr(label)}<input aria-label={tr(label)} type="number" min={min} max={max} step={step} value={energy[k]} onChange={e=>changeEnergy(k,Number(e.target.value))}/></label>}
 function faultField(label:string,k:keyof FaultConfig,min:number,max:number,step:number=1){return <label key={k}>{tr(label)}<input aria-label={tr(label)} type="number" min={min} max={max} step={step} value={fault[k]} onChange={e=>{setApplied('');setPolicy({science_slots:null,optional_enabled:true});setFault(p=>({...p,[k]:Number(e.target.value)}))}}/></label>}
 function landingField(label:string,k:keyof LandingSettings,min:number,max:number,step=1){return <label key={k}>{tr(label)}<input aria-label={tr(label)} type="number" min={min} max={max} step={step} value={landing[k]} onChange={e=>setLanding(p=>({...p,[k]:Number(e.target.value)}))}/></label>}
 if(!plan||!selected||!mission)return null
 const current=report?.affected,budget=current?.budget,summary=budget?.summary,local=report?.local_study
 return <section className="mission-operations" data-testid="mission-operations" aria-label={tr("Energía, fallos y estudio local del destino")}>
  <div className="operations-top"><div><span className="micro-title">{tr("ESTUDIO DE TU MISIÓN · DATOS NASA")}</span><h2>{tr("¿Podrá completar sus actividades?")}</h2></div><span className="operations-badge">{tr("LOLA nativo + JPL · 15 min")}</span></div>
  <p className="operations-intro">{tr("Comprueba batería, operaciones y terreno con la configuración declarada. El estudio local recalcula el horizonte para paneles a")}{" "}{vehicle.solar_panel_height}{" "}{tr("m y antena a")}{" "}{vehicle.antenna_height} m.</p>
  <div className="operations-tabs" role="tablist" aria-label={tr("Estudio de misión")}><button role="tab" aria-selected={tab==='energy'} onClick={()=>setTab('energy')}><BatteryCharging size={15}/>{" "}{tr("Energía y fallos")}</button><button role="tab" aria-selected={tab==='local'} onClick={()=>setTab('local')}><MapPin size={15}/>{" "}{tr("Destino local")}</button></div>
  {tab==='energy'?<>
   <div className="operations-config-heading"><div><strong>{tr("Configuración de diseño editable")}</strong><p>{tr("Especificaciones de subsistemas de la nave. Los datos orbitales y el terreno provienen de NASA; las capacidades del hardware se ajustan a tu perfil de misión. Orientación actual:")}{" "}{tr(energy.panel_mode==='sun_tracking'?'seguimiento solar ideal':'panel fijo')}{tr(". La carga esencial debe incluir los equipos críticos y la calefacción necesaria.")}</p></div><button onClick={()=>setConfiguration(v=>!v)} aria-expanded={configuration}>{tr("Configurar nave")}{" "}<ChevronDown size={13}/></button></div>
   <div className="operations-fields primary-fields">{field('Batería · Wh','battery_capacity_wh',1,10000000)}{field('Carga esencial · W','essential_load_w',0,1000000)}{field('Panel solar · m²','solar_area_m2',.01,1000,.1)}{field('Horas de ciencia requeridas','science_duration_hours',0,mission.surface_hours,.25)}</div>
   {configuration&&<div className="operations-expanded" data-testid="energy-configuration"><div className="operations-fields">{field('Carga inicial · fracción','initial_soc',0,1,.05)}{field('Reserva mínima · fracción','reserve_soc',0,1,.05)}{field('Eficiencia del panel · fracción','solar_efficiency',.001,1,.01)}{field('Factor eléctrico del panel','solar_derate',0,1,.01)}{field('Eficiencia de carga','charge_efficiency',.01,1,.01)}{field('Eficiencia de descarga','discharge_efficiency',.01,1,.01)}{field('Potencia máxima de carga · W','max_charge_w',0,1000000)}{field('Potencia máxima de descarga · W','max_discharge_w',0,1000000)}{field('Ciencia · W','science_load_w',0,1000000)}{field('Carga opcional · W','optional_load_w',0,1000000)}{field('Radio · W','radio_load_w',0,1000000)}{field('Inicio de ciencia · h desde llegada','science_start_hour',0,mission.surface_hours,.25)}{field('Datos de ciencia · Mbit/s','science_data_mbps',0,10000,.01)}{field('Transmisión configurada · Mbit/s','downlink_mbps',0,10000,.01)}{field('Memoria · GB','storage_gb',.001,1000000,.1)}<label>{tr("Orientación del panel")}<select aria-label={tr("Orientación del panel")} value={energy.panel_mode} onChange={e=>setEnergy(p=>({...p,panel_mode:e.target.value as EnergyConfig['panel_mode']}))}><option value="sun_tracking">{tr("Seguimiento solar ideal declarado")}</option><option value="fixed">{tr("Panel fijo")}</option></select></label>{energy.panel_mode==='fixed'&&<>{field('Inclinación desde horizontal · °','panel_tilt_deg',0,180)}{field('Azimut del panel desde norte · °','panel_azimuth_deg',0,360)}</>}</div><label className="operations-check"><input type="checkbox" checked={energy.require_all_data} onChange={e=>setEnergy(p=>({...p,require_all_data:e.target.checked}))}/>{" "}{tr("Exigir transmisión de todos los datos antes del final")}</label></div>}
   <div className="fault-scenario"><h3><ShieldAlert size={17}/>{" "}{tr("Cambia una condición y observa el resultado")}</h3><div className="operations-fields">{faultField('Retraso de la fecha · h','delay_hours',0,72,.25)}<label>{tr("Pérdida de producción solar · %")}<input aria-label={tr("Pérdida de producción solar · %")} type="number" min={0} max={100} value={Math.round(fault.solar_loss_fraction*100)} onChange={e=>{setPolicy({science_slots:null,optional_enabled:true});setFault(p=>({...p,solar_loss_fraction:Number(e.target.value)/100}))}}/></label>{faultField('Inicio del fallo solar · h','solar_fault_start_hour',0,mission.surface_hours,.25)}{faultField('Corte de comunicaciones · h','earth_outage_hours',0,mission.surface_hours,.25)}{faultField('Inicio del corte · h','earth_outage_start_hour',0,mission.surface_hours,.25)}</div><p>{tr("Los fallos son escenarios introducidos por ti. Las horas del fallo se cuentan desde el alunizaje; el retraso mueve la fecha solicitada y vuelve a consultar NASA.")}</p></div>
  </>:<>
   <div className="local-study-intro"><h3>{tr("Evalúa la región donde podría tocar suelo.")}</h3><p>{tr("La elipse delimita centros posibles; cada uno se estudia con una huella circular de la nave. No representa una probabilidad de aterrizaje.")}</p><div className="operations-fields">{landingField('Semieje mayor de dispersión · m','semi_major_m',20,600)}{landingField('Semieje menor de dispersión · m','semi_minor_m',10,600)}{landingField('Rumbo de la elipse · ° desde norte','heading_deg',0,360)}{landingField('Radio de apoyo de la nave · m','footprint_radius_m',5,60)}{landingField('Pendiente local máxima · °','max_local_slope_deg',0,45)}{landingField('Rugosidad RMS máxima · m','max_roughness_m',.01,20,.05)}</div><div className="local-coordinate-entry"><label>{tr("Latitud exacta · °")}<input aria-label={tr("Latitud del estudio local")} type="number" min={-90} max={-80} step="any" value={coordinates.latitude} onChange={e=>setCoordinates(p=>({...p,latitude:e.target.value}))}/></label><label>{tr("Longitud exacta · °")}<input aria-label={tr("Longitud del estudio local")} type="number" min={-180} max={180} step="any" value={coordinates.longitude} onChange={e=>setCoordinates(p=>({...p,longitude:e.target.value}))}/></label><button onClick={()=>chooseLocal(Number(coordinates.latitude),Number(coordinates.longitude),'Coordenada introducida')}>{tr("Estudiar coordenadas")}{" "}<ArrowRight size={12}/></button></div><p className="local-target-label">{tr("Centro:")}{" "}{tr(target?.name??'Zona seleccionada en el mapa')} · {tr(n(target?.latitude_deg??selected.latitude_deg,5))}°, {tr(n(target?.longitude_deg??selected.longitude_deg,5))}°</p><div className="native-source-shortcuts"><span>{tr("Datos nativos de 5 m disponibles:")}</span>{sites.map(s=><button key={s.id} onClick={()=>chooseLocal(s.latitude_deg,s.longitude_deg,s.name)}>{tr(s.name)} <ArrowRight size={11}/></button>)}</div></div>
  </>}
  {applied&&<div className="operations-applied"><Check size={14}/>{tr(applied)}</div>}
  {busy&&<div className="operations-loading" role="status"><LoaderCircle size={17} className="spin"/><div><strong>{tr("Calculando con datos nativos NASA…")}</strong><span>{tr("Horizontes de estas alturas, batería, datos y huella ·")}{" "}{elapsed} s</span></div><button onClick={()=>{request.current?.abort();setBusy(false);setError('Estudio cancelado. Puedes volver a calcularlo.')}} aria-label={tr("Cancelar estudio operativo")}><X size={14}/></button></div>}
  {error&&<div className="operations-error" role="alert">{tr(error)}<button onClick={()=>setAttempt(a=>a+1)}><RefreshCw size={12}/>{" "}{tr("Reintentar")}</button></div>}
  {report&&budget&&summary&&<>
   {tab==='energy'?<>
    <div className={'operations-verdict '+(budget.status==='unknown'?'unknown':budget.feasible?'pass':'fail')} data-testid="energy-verdict"><Activity size={20}/><div><h3>{tr(budget.status==='unknown'?'Faltan datos para cerrar el presupuesto.':budget.feasible?'La energía y los datos cumplen el modelo.':'Esta configuración necesita ajustes.')}</h3><p>{tr(budget.feasible?'Se conservan la reserva, las horas de ciencia y el objetivo de transmisión declarados.':budget.reasons.join(' '))}</p><small>{tr(formatMissionDate(current!.mission.arrival_utc,timezone,language))} · {tr(timezone)} · {tr(report.launch_site.name)}</small></div></div>
    <div className="energy-metrics"><div><span>{tr("Batería mínima")}</span><strong>{tr(n(summary.minimum_soc==null?null:summary.minimum_soc*100))} %</strong><small>{tr("Sin fallo:")}{" "}{tr(n(report.baseline.budget.summary.minimum_soc==null?null:report.baseline.budget.summary.minimum_soc*100))} %</small></div><div><span>{tr("Entra en reserva")}</span><strong>{tr(summary.reserve_crossing_hour==null?(budget.status==='unknown'?'Sin resolver':'No observado'):'+'+n(summary.reserve_crossing_hour)+' h')}</strong><small>{tr(summary.battery_empty_hour==null?'Sin agotamiento observado':'Agotamiento a +'+n(summary.battery_empty_hour)+' h')}</small></div><div><span>{tr("Ciencia completada")}</span><strong>{tr(n(summary.science_completed_hours))} / {tr(n(summary.science_required_hours))} h</strong><small>{tr("Las actividades sin potencia quedan pendientes")}</small></div><div><span>{tr("Datos pendientes")}</span><strong>{tr(n(summary.buffer_final_gb,3))} GB</strong><small>{tr(n(summary.data_lost_gb,3))}{" "}{tr("GB perdidos por memoria")}</small></div></div>
    {budget.status==='ok'&&<Chart baseline={report.baseline.budget} affected={budget} reserve={energy.reserve_soc}/>}
    <div className="operations-mini-metrics"><span>Solar: <b>{tr(n(summary.solar_generated_wh,0))} Wh</b></span><span>{tr("Consumo servido:")}{" "}<b>{tr(n(summary.load_served_wh,0))} Wh</b></span><span>{tr("Esencial no servido:")}{" "}<b>{tr(n(summary.essential_unserved_wh,0))} Wh</b></span><span>{tr("Datos transmitidos:")}{" "}<b>{tr(n(summary.data_sent_gb,3))} GB</b></span></div>
    {budget.events.length>0&&<details className="operations-event-list"><summary>{tr("Eventos y actividades suspendidas ·")}{" "}{budget.events.length}{" "}{tr("registros")}</summary>{budget.events.slice(0,12).map((event,i)=><p key={i}><strong>+{tr(n(event.hour,2))} h</strong> {tr(event.message)}{tr(event.duration_hours?' · '+n(event.duration_hours,2)+' h':'')}</p>)}{budget.events.length>12&&<small>{tr("Se muestran los primeros doce; la exportación conserva hasta cuatrocientos eventos y la serie de estados completa.")}</small>}</details>}
    {!current!.planning_constraints_met&&<p className="operations-geometric-caution">{tr("El presupuesto eléctrico se evalúa por separado: este destino aún incumple algún criterio de terreno o visibilidad. Una batería suficiente no valida el aterrizaje.")}</p>}
    <div className="operations-repairs"><div className="repair-heading"><h3><FlaskConical size={16}/>{" "}{tr("Alternativas verificadas")}</h3><button disabled={repairBusy||busy} onClick={()=>void findRepairs()}>{repairBusy?<LoaderCircle size={13} className="spin"/>:<RefreshCw size={13}/>} {tr(repairBusy?'Buscando ajustes…':'Comparar ajustes')}</button></div><p>{tr("Se comparan hasta cuatro zonas del plan, tres fechas y distintas distribuciones de la misma actividad científica. La búsqueda conserva tus requisitos.")}</p>{repairBusy&&<p role="status">{tr("Verificando presupuestos completos; los resultados anteriores no se aplican automáticamente.")}</p>}{repairError&&<p role="alert">{tr(repairError)}</p>}{repair?.status==='none'&&<p className="repair-no-fit">{tr("Ninguna combinación examinada cumple. No se han reducido las horas de ciencia ni los límites para fabricar una solución. Revisa las causas indicadas y la configuración de la nave.")}</p>}{repair?.proposals.map(p=><article className="operations-repair-card" key={p.id}><div><strong>{tr(p.label)}</strong><span>{tr(formatMissionDate(p.proposed_request.departure_utc,timezone,language))} · {tr(n(Math.abs(p.result.cell.latitude_deg),3))}°S, {tr(n(p.result.cell.longitude_deg,3))}°</span><small>{tr("Reserva mínima:")}{" "}{tr(n(p.summary.minimum_soc==null?null:p.summary.minimum_soc*100))}{" "}{tr("% · ciencia:")}{" "}{tr(n(p.summary.science_completed_hours))} h{tr(p.changes.optional_suspended?' · carga opcional suspendida':'')}</small><small>{tr("Huella local pendiente de estudio.")}</small></div><button onClick={()=>apply(p)}>{tr("Aplicar y recalcular")}{" "}<ArrowRight size={12}/></button></article>)}{repair&&<small>{repair.search.tested_scenarios}{" "}{tr("escenarios comprobados · hasta +48 h desde la fecha afectada · búsqueda acotada.")}</small>}</div>
   </>:local&&<div className="native-study-results" data-testid="native-study"><div className="native-study-title"><strong>{tr("NASA LOLA ·")}{" "}{local.source_resolution_m} m</strong><span>{tr(local.footprint_resolved?'Huella evaluable a esta escala':'Huella pequeña sin resolver a esta escala')}</span></div><LocalMap study={local}/><div className="local-risk-legend"><span><i className="pass"/>{" "}{tr("Cumple modelo local")}</span><span><i className="limited"/>{" "}{tr("Margen limitado")}</span><span><i className="fail"/>{" "}{tr("No cumple")}</span><span><i className="unknown"/>{" "}{tr("Sin resolver")}</span></div><p>{tr(n(local.sample_count,0))}{" "}{tr("centros evaluados dentro de la elipse ·")}{" "}{tr(n(local.counts['1']+local.counts['2'],0))}{" "}{tr("cumplen los criterios nominales · incertidumbre vertical máxima disponible:")}{" "}{tr(n(local.max_height_uncertainty_m,2))} m.</p>{!local.footprint_resolved&&<p className="operations-geometric-caution">{tr("Este destino sólo tiene datos nativos de 80 m. La huella de la nave no queda resuelta; el sistema no inventa un terreno de 5 m. Puedes explorar las coberturas disponibles o adquirir productos adicionales.")}</p>}{local.recommended_local_center&&<div className="local-recommendation"><strong>{tr("Centro local para seguir estudiando")}</strong><p>{tr("Pendiente máxima en huella:")}{" "}{tr(n(local.recommended_local_center.max_slope_deg,2))}{tr("° · rugosidad RMS:")}{" "}{tr(n(local.recommended_local_center.roughness_rms_m,2))} m</p><button onClick={()=>chooseLocal(local.recommended_local_center!.latitude_deg,local.recommended_local_center!.longitude_deg,'Centro local propuesto')}>{tr("Recentrar y recalcular horizontes")}{" "}<ArrowRight size={12}/></button></div>}<p className="native-scope">{tr("Los colores no certifican rocas subpíxel, estabilidad mecánica ni seguridad de alunizaje. La pendiente y la altura tienen incertidumbres; la elipse es una hipótesis de dispersión editable.")}</p></div>}
   <details className="operations-evidence"><summary>{tr("Datos, configuración y límites del estudio")}</summary><p>{tr("Alturas recalculadas: panel")}{" "}{current!.horizon.observer_heights_m.sun}{" "}{tr("m; antena")}{" "}{current!.horizon.observer_heights_m.earth}{" "}{tr("m. Alcance mínimo de rayos:")}{" "}{tr(n(current!.horizon.valid_to_min_m/1000))}{" "}{tr("km. Cobertura distante parcial.")}</p><ul>{[...report.limitations,...budget.limitations,...(local?.limitations??[])].map((s,i)=><li key={i}>{tr(s)}</li>)}</ul><p>{tr("Residual del balance eléctrico:")}{" "}{tr(n(summary.energy_balance_residual_wh,8))}{" "}{tr("Wh. Es una comprobación numérica, no una validación física independiente.")}</p><button onClick={()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({report,repair,energy,fault,landing,policy},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='lunar-oracle-estudio-operativo.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}}><Download size={13}/>{" "}{tr("Descargar estudio y procedencia")}</button></details>
  </>}
 </section>
}
