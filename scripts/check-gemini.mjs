import {existsSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
const envPath=fileURLToPath(new URL('../.env',import.meta.url))
if(existsSync(envPath))process.loadEnvFile(envPath)
const key=process.env.GEMINI_API_KEY||''
const model=process.env.AI_MODEL||'gemini-3.5-flash-lite'
if(!key.trim()){
 console.error('Gemini pendiente: completa GEMINI_API_KEY en .env. Crea la clave en https://aistudio.google.com/apikey. No la pegues en el chat.')
 process.exitCode=1
}else if(!/^[A-Za-z0-9_.:-]+$/.test(model)){
 console.error('AI_MODEL no es válido. Revisa el nombre del modelo en .env.');process.exitCode=1
}else{
 try{
  const base='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)
  const headers={'x-goog-api-key':key}
  const response=await fetch(base,{headers,signal:AbortSignal.timeout(15000)})
  if(!response.ok){
   const labels={400:'Clave o petición no válida',401:'Clave no válida',403:'Sin permisos para el modelo',404:'Modelo no disponible',429:'Cuota agotada'}
   console.error('Gemini: '+(labels[response.status]||'Proveedor no disponible')+'. Revisa tu proyecto en Google AI Studio.')
   process.exitCode=1
  }else{
   const metadata=await response.json()
   if(!metadata.supportedGenerationMethods?.includes('generateContent'))throw new Error('Modelo sin generación compatible.')
   console.log('Conexión de Gemini correcta. Modelo: '+model+'.')
   if(process.argv.includes('--generate')){
    const generation=await fetch(base+':generateContent',{method:'POST',headers:{...headers,'Content-Type':'application/json'},signal:AbortSignal.timeout(45000),body:JSON.stringify({contents:[{parts:[{text:'Responde únicamente el JSON {"ok":true}.'}]}],generationConfig:{responseMimeType:'application/json',maxOutputTokens:256}})})
    if(!generation.ok){console.error('La generación falló. Estado HTTP '+generation.status+'. Revisa permisos y cuota.');process.exitCode=1}
    else{
     const data=await generation.json(),text=data.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('')||''
     if(JSON.parse(text).ok!==true)throw new Error('El modelo no devolvió la respuesta de comprobación.')
     console.log('Generación real comprobada. La clave no se ha mostrado ni guardado en el frontend.')
    }
   }else console.log('Para comprobar también una generación real: npm run ai:check -- --generate')
  }
 }catch{console.error('No se pudo completar la comprobación. Revisa la conexión y la configuración de Gemini.');process.exitCode=1}
}
