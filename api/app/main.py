from typing import Annotated
import json
from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from .core.sites import DATA, catalog, datasets, get_site
from .core.horizon import profiles, HorizonUnavailable
from .solar.horizons import HorizonsUnavailable
from .solar.service import solar_result
from .earth.router import router as earth_router
from .compare.router import router as compare_router
from .landing import router as landing_router
from .polar import router as polar_router
from .copilot import router as copilot_router
from .automatic_plan import router as automatic_plan_router
from .mission_intent import router as mission_intent_router

app=FastAPI(title='Lunar Oracle scientific API',version='1.0.0',description='NASA LOLA catalog and JPL Horizons geometric visibility. No simulated science.')
app.add_middleware(CORSMiddleware,allow_origins=['http://127.0.0.1:5173','http://localhost:5173'],allow_credentials=False,allow_methods=['GET','POST','OPTIONS'],allow_headers=['*'])

@app.exception_handler(RequestValidationError)
async def invalid_request(request:Request,exc:RequestValidationError):
    errors=[{'field':'.'.join(str(part) for part in item['loc']),'message':item['msg']} for item in exc.errors()]
    return JSONResponse(status_code=422,content={'status':'unavailable','message':'Invalid query parameters.','errors':errors,'samples':[],'windows':[],'summary':None})

@app.exception_handler(HorizonsUnavailable)
async def jpl_error(request:Request,exc:HorizonsUnavailable):
    return JSONResponse(status_code=503,content={'status':'unavailable','message':str(exc),'samples':[],'windows':[],'summary':None})

@app.exception_handler(HorizonUnavailable)
async def terrain_error(request:Request,exc:HorizonUnavailable):
    return JSONResponse(status_code=422,content={'status':'unavailable','message':str(exc),'samples':[],'windows':[],'summary':None})

@app.exception_handler(FileNotFoundError)
async def missing_data(request:Request,exc:FileNotFoundError):
    return JSONResponse(status_code=503,content={'status':'unavailable','message':str(exc)})

@app.get('/api/health')
def health():
    return {'status':'ok','service':'Lunar Oracle scientific API','sources':['NASA LOLA','JPL Horizons'],'horizons_connection':'checked per query','catalog_prepared':(DATA/'catalog'/'sites.json').exists(),'terrain_prepared':(DATA/'prepared'/'horizon_profiles.json').exists()}

@app.get('/api/sites')
def sites_endpoint(): return catalog()

@app.get('/api/datasets')
def datasets_endpoint(): return datasets()

@app.get('/api/sites/{site_id}/terrain')
def terrain_endpoint(site_id:str):
    if not get_site(site_id): return JSONResponse(status_code=404,content={'status':'unavailable','message':'Unknown site.'})
    path=DATA/'prepared'/f'{site_id}-terrain.json'
    if not path.exists(): raise FileNotFoundError('NASA terrain preview has not been prepared.')
    return json.loads(path.read_text(encoding='utf-8'))

@app.get('/api/horizon')
def horizon_endpoint(site_id:str='site04',observer_height_m:int=1):
    profile=profiles()['profiles'].get(site_id,{}).get(str(observer_height_m))
    if profile is None: raise HorizonUnavailable('Unknown site or unsupported terrain height; choose 1, 2 or 5 m.')
    return {'status':'ok','site_id':site_id,**profile}

@app.get('/api/terrain')
def terrain_alias(site_id:str='site04'): return terrain_endpoint(site_id)

@app.get('/api/methodology')
def methodology():
    return {'status':'ok','title':'Sampled geometric visibility','sources':[{'name':'JPL Horizons','url':'https://ssd-api.jpl.nasa.gov/doc/horizons.html'},{'name':'NASA LOLA 5m landing regions','url':'https://pgda.gsfc.nasa.gov/products/78'},{'name':'Horizons manual','url':'https://ssd.jpl.nasa.gov/horizons/manual.html'}],'formula':'visible = apparent_elevation_deg > horizon_elevation_deg','flat_horizon':'0 degrees; excludes terrain and horizon dip','terrain_horizon':'NASA LOLA local and regional data; finite ray sampling, partial coverage, no uncertainty propagation','windows':'Half-open [start,end), left sample represents each interval; final graph sample adds no duration','limitations':['Geometric visibility is not electric energy or a guaranteed RF link.','Candidate markers are deterministic regional DEM reference pixels, not approved landing sites.','Lunar mean-Earth frame convention; independent SPICE validation is pending.','Changing time, site or observer height triggers a distinct exact NASA query/cache key.'],'datasets':datasets()['datasets']}

@app.get('/api/solar')
async def solar_endpoint(site_id:str='site04',start_utc:str='2026-12-01T00:00:00Z',end_utc:str='2026-12-08T00:00:00Z',step_minutes:Annotated[int,Query(ge=5,le=1440)]=60,horizon_mode:str='flat',observer_height_m:Annotated[float,Query(ge=0,le=100)]=1):
    try: return await solar_result(site_id,start_utc,end_utc,step_minutes,horizon_mode,observer_height_m)
    except ValueError as exc:
        if isinstance(exc,HorizonUnavailable): raise
        return JSONResponse(status_code=422,content={'status':'unavailable','message':str(exc),'samples':[],'windows':[],'summary':None})

app.include_router(automatic_plan_router)
app.include_router(mission_intent_router)
app.include_router(polar_router)
app.include_router(copilot_router)
app.include_router(landing_router)
app.include_router(earth_router)
app.include_router(compare_router)
