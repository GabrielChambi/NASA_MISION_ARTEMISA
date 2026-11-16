"""Production entry: all scientific routes plus the built web application."""
import os
from pathlib import Path
from .main import app
from .web_hosting import attach_frontend
ROOT=Path(__file__).resolve().parents[2]
@app.get('/api/ready',include_in_schema=False)
def ready():
 return {'status':'ok','frontend_ready':True,'native_sources_verified_at_startup':os.environ.get('LUNAR_DATA_VERIFIED')=='1','gemini_configured':bool(os.environ.get('GEMINI_API_KEY')),'gemini_generation_checked':False}
attach_frontend(app,os.environ.get('LUNAR_FRONTEND_DIST',str(ROOT/'frontend/dist')))
