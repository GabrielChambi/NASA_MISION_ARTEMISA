import { useEffect, useRef, useState } from 'react'
import { CalendarClock, Search, Download, ArrowRight } from 'lucide-react'
import type { LandingRun } from './landingScience'
import { fetchWindowSearch, windowSearchGate, type WindowCandidate, type WindowSearchReport } from './windowPlanner'

const utc=(text:string)=>text.replace('T',' ').slice(0,16)+' UTC'
const hours=(value:number|null)=>value===null?'Sin datos':value.toFixed(0)+' h'
const box={border:'1px solid #344657',borderRadius:6,padding:11,marginTop:10,background:'#111b25'}
export default function WindowPlannerPanel({run,onApplyStart,active=true}:{run:LandingRun|null;onApplyStart:(utcInput:string)=>void;active?:boolean}){
  const [storedReport,setReport]=useState<WindowSearchReport|null>(null),[busy,setBusy]=useState(''),[error,setError]=useState('')
  const [reportVersion,setReportVersion]=useState('')
  const pending=useRef<AbortController|null>(null)
  const version=run?run.key+'|'+run.createdAt:'none'
  const report=reportVersion===version?storedReport:null
  const lastVersion=useRef(version)
  lastVersion.current=version
  useEffect(()=>{pending.current?.abort();setReport(null);setBusy('');setError('');return()=>pending.current?.abort()},[version])
  useEffect(()=>{if(!active){pending.current?.abort();setBusy('')}},[active])
  const gate=run?windowSearchGate(run):null
  async function search(){
    if(!run||busy)return
    pending.current?.abort();const ac=new AbortController(),key=version;pending.current=ac
    setError('');setReport(null);setBusy('Preparando búsqueda…')
    try{
      const result=await fetchWindowSearch(run,ac.signal,fetch,body=>setBusy(body==='Sun'?'Consultando intervalo del Sol…':'Consultando intervalo de la Tierra…'))
      if(!ac.signal.aborted&&lastVersion.current===key){setReport(result);setReportVersion(key)}
    }catch(e){if(!ac.signal.aborted)setError(e instanceof Error?e.message:'No se pudieron calcular las alternativas.')}
    finally{if(!ac.signal.aborted)setBusy('')}
  }
  function exportReport(){
    if(!report)return
    const payload={...report,exportedAt:new Date().toISOString(),origin:run?{id:run.origin.id,latitude_deg:run.origin.latitude_deg,longitude_deg:run.origin.longitude_deg,elevation_m:run.origin.elevation_m,max_slope_deg:run.origin.max_slope_deg,relief_m:run.origin.relief_m}:null}
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'})),a=document.createElement('a')
    a.href=url;a.download='lunar-oracle-busqueda-fechas.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  const sameFirst=Boolean(report?.firstPassing&&report.firstRobust&&report.firstPassing.shiftHours===report.firstRobust.shiftHours)
  const show=(title:string,c:WindowCandidate|null,empty:string)=><div style={box}>
    <strong style={{fontSize:11,color:'#d1e2ee'}}>{title}</strong>
    {c?<><div style={{font:'10px IBM Plex Mono,monospace',color:'#b4d8d0',marginTop:8,lineHeight:1.7}}>{utc(c.startUtc)}<br/>Cambio: +{c.shiftHours} h</div><div className="measured-row"><span>Sol / Tierra</span><strong>{hours(c.sunHours)} / {hours(c.earthHours)}</strong></div>
      <p className="field-help">{c.robustStatus==='meets'?'Cumple en los cinco cambios de hora ensayados.':c.robustStatus==='unknown'?'No hay cobertura completa para todos los cambios de hora.':'Algún cambio de hora ensayado incumple los criterios.'}</p>
      <button className="wide quiet" style={{marginTop:10}} onClick={()=>onApplyStart(c.startUtc.slice(0,16))}>Aplicar fecha al formulario <ArrowRight size={12}/></button></>:<p className="field-help">{empty}</p>}
  </div>
  return <section className="window-planner" aria-label="Buscador de fechas con NASA">
    <h2><CalendarClock size={15}/> Busca una fecha con más margen</h2>
    <p className="field-help">Compara trece inicios, desde tu fecha hasta +12 h, sin cambiar tus requisitos. Después ensaya cambios de −2 a +2 h.</p>
    {!run&&<p className="field-help">Analiza primero Sol y Tierra para fijar destino, intervalo y límites.</p>}
    {gate&&gate.status!=='ready'&&<div style={{...box,borderColor:'#786345'}} role="status">{gate.reasons.map(reason=><p className="field-help" key={reason}>{reason}</p>)}</div>}
    <button className="wide quiet" style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8,marginTop:12}} disabled={!run||Boolean(busy)||!active} onClick={()=>void search()}><Search size={13}/>{busy?'BUSCANDO…':'Buscar alternativas con NASA'}</button>
    {busy&&<p className="request-status" role="status">{busy}</p>}
    {error&&<p className="science-error" role="alert">{error}</p>}
    {report&&<div data-testid="window-search-results">
      {report.reasons.map(reason=><p className="field-help" key={reason}>{reason}</p>)}
      {report.status==='ok'&&<>
        {show('Primer inicio que cumple',report.firstPassing,'Ninguno de los inicios evaluados cumple todos los criterios.')}
        {sameFirst?<p className="field-help">El primer inicio ya cumple en los cinco cambios de hora ensayados; no hace falta retrasarlo dentro de esta rejilla.</p>:show('Primer inicio con margen temporal',report.firstRobust,'No se encontró un inicio que cumpla en los cinco cambios de hora ensayados.')}
        {report.alternatives.filter(c=>c.shiftHours!==report.firstPassing?.shiftHours&&c.shiftHours!==report.firstRobust?.shiftHours).slice(0,sameFirst?2:1).map(c=><div key={c.shiftHours}>{show('Otra alternativa cercana',c,'')}</div>)}
        {report.firstRobust&&<div className="measured-row"><span>Peor Sol / Tierra en los cinco ensayos</span><strong>{hours(report.firstRobust.worstSunHours)} / {hours(report.firstRobust.worstEarthHours)}</strong></div>}
        <details style={{marginTop:14}}><summary style={{fontSize:10,color:'#9bb8cd',cursor:'pointer'}}>Ver los trece inicios y sus márgenes</summary><div style={{overflowX:'auto',marginTop:10}}>
          <table style={{fontSize:10,width:'100%',borderCollapse:'collapse'}}><thead><tr><th style={{textAlign:'left'}}>Cambio</th><th>Sol</th><th>Tierra</th><th>Cumple</th><th>±2 h</th></tr></thead><tbody>
            {report.candidates.map(c=><tr key={c.shiftHours}><td style={{padding:'7px 3px',borderTop:'1px solid #2d4050'}}>+{c.shiftHours} h</td><td style={{textAlign:'center'}}>{hours(c.sunHours)}</td><td style={{textAlign:'center'}}>{hours(c.earthHours)}</td><td style={{textAlign:'center'}}>{c.status==='meets'?'Sí':c.status==='fails'?'No':'?'}</td><td style={{textAlign:'center'}}>{c.robustStatus==='meets'?'Sí':c.robustStatus==='fails'?'No':'?'}</td></tr>)}
          </tbody></table></div>
          {report.sources.map(source=><p className="field-help" key={source.body}><a href={source.queryUrl} target="_blank" rel="noreferrer" style={{color:'#b7dfe1'}}>Consulta NASA {source.body} ↗</a><br/>Serie original: {utc(source.startUtc)} → {utc(source.endUtc)}</p>)}
        </details>
      </>}
      <button className="wide quiet" style={{marginTop:13}} onClick={exportReport}><Download size={12}/> Descargar búsqueda y evidencia</button>
      <p className="field-help">Aplicar una fecha sólo cambia el formulario. Vuelve a analizar Sol y Tierra para confirmar el nuevo caso.</p>
    </div>}
    <p className="field-help" style={{fontSize:10}}>Búsqueda calculada, no una respuesta de IA. La robustez temporal no expresa probabilidad de éxito ni valida lanzamiento u órbita.</p>
  </section>
}
