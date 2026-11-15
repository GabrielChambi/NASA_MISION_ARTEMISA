import {fileURLToPath} from 'node:url'
import http from 'node:http'
import worker from '../dist/server/index.js'

try{process.loadEnvFile(fileURLToPath(new URL('../../.env',import.meta.url)))}catch(error){if(error.code!=='ENOENT')throw error}
const aiEnv=Object.fromEntries(['AI_PROVIDER','AI_MODEL','AI_BASE_URL','AI_API_KEY','GEMINI_API_KEY','GOOGLE_API_KEY'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]))
const port=Number(process.env.PORT || 4173)
const server=http.createServer(async(req,res)=>{
  try {
    const chunks=[];let size=0
    if(!['GET','HEAD'].includes(req.method)){for await(const chunk of req){size+=chunk.length;if(size>12288){res.writeHead(413);res.end('Request too large');return}chunks.push(chunk)}}
    const request=new Request(`http://127.0.0.1:${port}${req.url}`,{method:req.method,headers:req.headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})})
    const response=await worker.fetch(request,aiEnv, {waitUntil:promise=>void promise.catch(error=>console.error(error.message))})
    res.writeHead(response.status,Object.fromEntries(response.headers))
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch(error) {console.error(error);res.writeHead(500);res.end('Local preview server error')}
})
server.listen(port,'127.0.0.1',()=>console.log(`Hosted API + frontend preview: http://127.0.0.1:${port}`))
process.on('SIGINT',()=>server.close())
process.on('SIGTERM',()=>server.close())
