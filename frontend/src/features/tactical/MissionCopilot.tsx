import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Send, Sparkles, ArrowUpRight, RefreshCw, ExternalLink, X } from 'lucide-react'
export type CopilotAction={type:string;target_id?:string}|null
type Connection={mode:'ai'|'guide';available?:boolean;reason?:string;model?:string}
type Reply=Connection&{sources?:{id:string;label:string;url:string}[];explanation:string;intent:string;action:CopilotAction;evidence:{id:string;label:string;value?:unknown;unit?:string;source?:string}[]}
const reasonLabel:Record<string,string>={
 model_not_configured:'Falta configurar la clave de Gemini',
 invalid_api_key:'La clave de Gemini no es válida',
 permission_denied:'La clave no tiene acceso al modelo',
 quota_exceeded:'Gemini alcanzó la cuota disponible',
 model_not_available:'El modelo configurado no está disponible',
 invalid_model_reply:'La respuesta no cumplió el formato de evidencia',
 provider_unavailable:'Gemini no responde en este momento'
}
export default function MissionCopilot({context,onAction,active=true}:{context:Record<string,unknown>;onAction:(a:CopilotAction)=>void;active?:boolean}){
  const messageId=useId()
  const [connection,setConnection]=useState<Connection|null>(null),[checking,setChecking]=useState(false),[setup,setSetup]=useState(false)
  const [message,setMessage]=useState(''),[reply,setReply]=useState<Reply|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const request=useRef<AbortController|null>(null),statusRequest=useRef<AbortController|null>(null)
  const contextKey=JSON.stringify(context),lastKey=useRef(contextKey)
  const [replyKey,setReplyKey]=useState('')
  const checkConnection=useCallback(async()=>{
    statusRequest.current?.abort()
    const ac=new AbortController();statusRequest.current=ac;setChecking(true)
    try{
      const response=await fetch('/api/copilot/status',{signal:ac.signal})
      if(!response.ok)throw new Error()
      const data=await response.json()
      if(!ac.signal.aborted)setConnection(data)
    }catch{if(!ac.signal.aborted)setConnection({mode:'guide',reason:'provider_unavailable'})}
    finally{if(!ac.signal.aborted)setChecking(false)}
  },[])
  useEffect(()=>{
    if(active)void checkConnection()
    else{statusRequest.current?.abort();request.current?.abort();setChecking(false);setBusy(false)}
    return()=>{statusRequest.current?.abort();request.current?.abort()}
  },[active,checkConnection])
  useEffect(()=>{if(lastKey.current!==contextKey){request.current?.abort();setBusy(false);lastKey.current=contextKey}},[contextKey])
  async function ask(text:string){
    if(!text.trim()||busy)return
    request.current?.abort();const ac=new AbortController();request.current=ac
    setMessage(text);setBusy(true);setError('');setReply(null)
    try{
      const response=await fetch('/api/copilot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,context}),signal:ac.signal})
      const data=await response.json()
      if(!response.ok)throw new Error(data.message??'No se pudo consultar el asistente.')
      if(!ac.signal.aborted){setReply(data);setReplyKey(contextKey);setConnection(data)}
    }catch(e){if(!ac.signal.aborted)setError(e instanceof Error?e.message:'Asistente no disponible.')}
    finally{if(!ac.signal.aborted)setBusy(false)}
  }
  const labels:Record<string,string>={polar_view:'Ver todo el polo',details:'Abrir estudio detallado',run_simulation:'Ir al análisis',select_cell:'Ver zona propuesta'}
  const connected=connection?.mode==='ai',gemini=connection?.model?.startsWith('gemini')??true
  return <section className="mission-copilot" aria-label="Copiloto de misión">
    <div className="copilot-heading"><span><Sparkles size={17}/> Tu copiloto</span><small role="status">{checking?'Comprobando conexión…':connected?(gemini?'Gemini conectado':'IA conectada'):'Guía disponible · '+(reasonLabel[connection?.reason??'model_not_configured']??'IA no disponible')}</small></div>
    <div className="copilot-connection-tools"><button aria-label="Comprobar conexión de Gemini" disabled={checking} onClick={()=>void checkConnection()}><RefreshCw size={11}/> Comprobar</button><button onClick={()=>setSetup(true)}>Configurar Gemini <ExternalLink size={11}/></button></div>
    <p className="copilot-intro">Describe lo que necesitas. Te ayudo a entender el mapa y dar el siguiente paso.</p>
    <div className="copilot-prompts">{['¿Por dónde empiezo?','¿Qué era el cuadrado de otro color?','Busca zonas para estudiar','¿Por qué no puedo aterrizar aquí?'].map(q=><button key={q} disabled={busy} onClick={()=>ask(q)}>{q}</button>)}</div>
    <form onSubmit={e=>{e.preventDefault();void ask(message)}}>
      <label htmlFor={messageId} className="sr-only">Pregunta al copiloto</label>
      <textarea id={messageId} value={message} maxLength={1200} onChange={e=>setMessage(e.target.value)} placeholder="Quiero explorar una zona con terreno suave…" rows={3}/>
      <button className="copilot-send" type="submit" disabled={busy||!message.trim()}><Send size={14}/>{busy?'Consultando…':'Preguntar'}</button>
    </form>
    {error&&<p className="science-error" role="alert">{error}</p>}
    {reply&&<div className="copilot-reply" role="status">
      <span className="reply-mode">{reply.mode==='ai'?(reply.model?.startsWith('gemini')?'RESPUESTA DE GEMINI':'RESPUESTA DE IA'):'GUÍA DEL SISTEMA · SIN MODELO IA'}</span>
      <p>{reply.explanation}</p>
      {replyKey!==contextKey?<p className="stale-advice">Cambiaste el mapa o los criterios. Consulta de nuevo para actualizar esta respuesta.</p>:reply.action&&<button className="copilot-action" onClick={()=>onAction(reply.action)}>{labels[reply.action.type]??'Ver siguiente paso'}<ArrowUpRight size={13}/></button>}
      {reply.mode==='guide'&&<p className="copilot-setup">{reasonLabel[reply.reason??'model_not_configured']??'El modelo no está disponible'}. Esta respuesta es una guía del sistema.</p>}
      {reply.evidence?.length>0&&<details><summary>Datos usados en esta respuesta</summary>{reply.evidence.slice(0,8).map(e=><div className="copilot-fact" key={e.id}><span>{e.label}</span><strong>{e.value===undefined?'Fuente del modelo':typeof e.value==='object'?JSON.stringify(e.value):String(e.value)} {e.unit??''}</strong></div>)}{reply.sources?.map(s=><a className="copilot-source" key={s.id} href={s.url} target="_blank" rel="noreferrer">{s.label} ↗</a>)}</details>}
    </div>}
    <p className="copilot-footnote">Las mediciones las calcula el motor científico. El copiloto explica y propone; tú eliges la acción.</p>
    {setup&&<div className="gemini-setup-backdrop" onClick={()=>setSetup(false)}><section className="gemini-setup-dialog" role="dialog" aria-modal="true" aria-label="Activar Gemini" onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Escape')setSetup(false)}}>
      <div><h2>Conecta tu copiloto con Gemini.</h2><button autoFocus aria-label="Cerrar configuración Gemini" onClick={()=>setSetup(false)}><X size={16}/></button></div>
      <p>La clave la configura quien administra el proyecto. Los visitantes pueden usar el copiloto sin iniciar sesión.</p>
      <ol><li>Abre <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Google AI Studio ↗</a>, entra con Google y selecciona <strong>Crear clave de API</strong>.</li><li>Elige o crea un proyecto de Google Cloud y guarda la clave en un lugar privado.</li><li>En tu PC, edita <code>.env</code> y completa <code>GEMINI_API_KEY</code>. Reinicia <code>npm run dev:full</code>.</li><li>En la página publicada, configura esa variable como secreto del servidor. La clave local no se publica automáticamente.</li></ol>
      <p>No pegues la clave en el chat ni en el código del navegador.</p>
      <a href="https://aistudio.google.com/docs/api-key" target="_blank" rel="noreferrer">Consultar instrucciones oficiales de Google ↗</a>
      <button className="copilot-action" onClick={()=>void checkConnection()} disabled={checking}>{checking?'Comprobando…':'Comprobar conexión ahora'}</button>
      <p className="gemini-setup-status">{connected?'El servidor tiene un modelo IA conectado.':reasonLabel[connection?.reason??'model_not_configured']??'El modelo no responde.'}</p>
    </section></div>}
  </section>
}
