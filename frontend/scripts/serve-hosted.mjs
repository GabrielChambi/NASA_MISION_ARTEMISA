import http from 'node:http'
import worker from '../dist/server/index.js'

const port=Number(process.env.PORT || 4173)
const server=http.createServer(async(req,res)=>{
  try {
    const request=new Request(`http://127.0.0.1:${port}${req.url}`,{method:req.method,headers:req.headers})
    const response=await worker.fetch(request,{}, {waitUntil:promise=>void promise.catch(error=>console.error(error.message))})
    res.writeHead(response.status,Object.fromEntries(response.headers))
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch(error) {console.error(error);res.writeHead(500);res.end('Local preview server error')}
})
server.listen(port,'127.0.0.1',()=>console.log(`Hosted API + frontend preview: http://127.0.0.1:${port}`))
process.on('SIGINT',()=>server.close())
process.on('SIGTERM',()=>server.close())
