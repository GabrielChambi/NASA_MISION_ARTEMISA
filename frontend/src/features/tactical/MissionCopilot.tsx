import { useEffect, useId, useRef, useState } from 'react'
import { Send, Sparkles, ArrowUpRight } from 'lucide-react'
export type CopilotAction={type:string;target_id?:string}|null
type Reply={sources?:{id:string;label:string;url:string}[];mode:'ai'|'guide';reason?:string;explanation:string;intent:string;action:CopilotAction;evidence:{id:string;label:string;value?:unknown;unit?:string;source?:string}[]}
export default function MissionCopilot({context,onAction}:{context:Record<string,unknown>;onAction:(a:CopilotAction)=>void}){
  const messageId=useId()
  const [mode,setMode]=useState('Comprobando conexión…'),[message,setMessage]=useState(''),[reply,setReply]=useState<Reply|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const request=useRef<AbortController|null>(null)
  const contextKey=JSON.stringify(context),lastKey=useRef(contextKey)
  const [replyKey,setReplyKey]=useState('')
  useEffect(()=>{
    const ac=new AbortController()
    fetch('/api/copilot/status',{signal:ac.signal}).then(r=>r.json()).then(s=>{if(!ac.signal.aborted)setMode(s.mode==='ai'?'Gemini conectado':'Guía disponible · Gemini por activar')}).catch(()=>{if(!ac.signal.aborted)setMode('Asistente no disponible')})
    return()=>{ac.abort();request.current?.abort()}
  },[])
  useEffect(()=>{if(lastKey.current!==contextKey){request.current?.abort();setBusy(false);lastKey.current=contextKey}},[contextKey])
  async function ask(text:string){
    if(!text.trim()||busy)return
    request.current?.abort();const ac=new AbortController();request.current=ac
    setMessage(text);setBusy(true);setError('');setReply(null)
    try{
      const response=await fetch('/api/copilot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,context}),signal:ac.signal})
      const data=await response.json()
      if(!response.ok)throw new Error(data.message??'No se pudo consultar el asistente.')
      if(!ac.signal.aborted){setReply(data);setReplyKey(contextKey);setMode(data.mode==='ai'?'Gemini conectado':'Guía disponible · Gemini por activar')}
    }catch(e){if(!ac.signal.aborted)setError(e instanceof Error?e.message:'Asistente no disponible.')}
    finally{if(!ac.signal.aborted)setBusy(false)}
  }
  const labels:Record<string,string>={polar_view:'Ver todo el polo',details:'Abrir estudio detallado',run_simulation:'Ir al análisis',select_cell:'Ver zona propuesta'}
  return <section className="mission-copilot" aria-label="Copiloto de misión">
    <div className="copilot-heading"><span><Sparkles size={17}/> Tu copiloto</span><small>{mode}</small></div>
    <p className="copilot-intro">Describe lo que necesitas. Te ayudo a entender el mapa y dar el siguiente paso.</p>
    <div className="copilot-prompts">{['¿Por dónde empiezo?','¿Qué era el cuadrado de otro color?','Busca zonas para estudiar','¿Por qué no puedo aterrizar aquí?'].map(q=><button key={q} disabled={busy} onClick={()=>ask(q)}>{q}</button>)}</div>
    <form onSubmit={e=>{e.preventDefault();void ask(message)}}>
      <label htmlFor={messageId} className="sr-only">Pregunta al copiloto</label>
      <textarea id={messageId} value={message} maxLength={1200} onChange={e=>setMessage(e.target.value)} placeholder="Quiero explorar una zona con terreno suave…" rows={3}/>
      <button className="copilot-send" type="submit" disabled={busy||!message.trim()}><Send size={14}/>{busy?'Consultando…':'Preguntar'}</button>
    </form>
    {error&&<p className="science-error" role="alert">{error}</p>}
    {reply&&<div className="copilot-reply" role="status">
      <span className="reply-mode">{reply.mode==='ai'?'RESPUESTA DE GEMINI':'GUÍA DEL SISTEMA · SIN MODELO IA'}</span>
      <p>{reply.explanation}</p>
      {replyKey!==contextKey?<p className="stale-advice">Cambiaste el mapa o los criterios. Consulta de nuevo para actualizar esta respuesta.</p>:reply.action&&<button className="copilot-action" onClick={()=>onAction(reply.action)}>{labels[reply.action.type]??'Ver siguiente paso'}<ArrowUpRight size={13}/></button>}
      {reply.mode==='guide'&&<p className="copilot-setup">{reply.reason==='model_not_configured'?'Gemini todavía no está activado en el servidor. Esta respuesta es una guía del sistema.':'Gemini no pudo responder. Se muestra la guía del sistema.'}</p>}
      {reply.evidence?.length>0&&<details><summary>Datos usados en esta respuesta</summary>{reply.evidence.slice(0,8).map(e=><div className="copilot-fact" key={e.id}><span>{e.label}</span><strong>{e.value===undefined?'Fuente del modelo':typeof e.value==='object'?JSON.stringify(e.value):String(e.value)} {e.unit??''}</strong></div>)}{reply.sources?.map(s=><a className="copilot-source" key={s.id} href={s.url} target="_blank" rel="noreferrer">{s.label} ↗</a>)}</details>}
    </div>}
    <p className="copilot-footnote">Las mediciones las calcula el motor científico. El copiloto explica y propone; tú eliges la acción.</p>
  </section>
}
