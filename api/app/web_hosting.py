"""Serve the built frontend and the complete Python API on one public origin."""
from pathlib import Path
from fastapi.responses import JSONResponse
from starlette.staticfiles import StaticFiles
from starlette.exceptions import HTTPException
class FrontendFiles(StaticFiles):
 async def get_response(self,path,scope):
  path=str(path).replace(chr(92),'/')
  if path=='.':path=''
  if any(part.startswith('.') for part in path.split('/') if part):raise HTTPException(404)
  try:response=await super().get_response(path,scope)
  except HTTPException as exc:
   if exc.status_code!=404 or Path(path).suffix:raise
   response=await super().get_response('index.html',scope)
  response.headers['X-Content-Type-Options']='nosniff'
  response.headers['Referrer-Policy']='strict-origin-when-cross-origin'
  response.headers['Cache-Control']='public, max-age=31536000, immutable' if path.startswith('assets/') and response.status_code==200 else 'no-cache'
  return response
def attach_frontend(app,folder):
 folder=Path(folder).resolve()
 if not (folder/'index.html').is_file():raise RuntimeError('Production frontend is missing. Run npm run build before starting production.')
 async def missing_api(path:str=''):return JSONResponse(status_code=404,content={'status':'unavailable','message':'Unknown API route.'})
 app.add_api_route('/api',missing_api,methods=['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'],include_in_schema=False)
 app.add_api_route('/api/{path:path}',missing_api,methods=['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'],include_in_schema=False)
 app.mount('/',FrontendFiles(directory=str(folder),html=True),name='frontend')
