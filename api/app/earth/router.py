from datetime import datetime, timedelta
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from ..core.sites import catalog
from ..core.horizon import HorizonUnavailable
from ..solar.service import solar_result
from ..solar.windows import visibility_metrics
from ..mission_bridge import earth_payload, site_metadata, terrain_mesh
from .models import EarthQueryRequest, EarthResponse

router=APIRouter(prefix='/api/earth',tags=['earth'])

@router.get('/sites')
def list_verified_earth_sites():
    return {'sites':[{**site_metadata(s['id']),'has_3d_terrain_mesh':terrain_mesh(s['id']) is not None} for s in catalog()['sites']]}

@router.get('')
async def get_earth_ephemeris(
    site_id:str='site04',start_utc:str='2026-12-01T00:00:00Z',end_utc:str='2026-12-08T00:00:00Z',
    step_minutes:int=60,horizon_mode:str='flat',clearance_deg:float=0,delay_hours:float=0,
    observer_height_m:float=1,canonical:bool=True,include_range:bool=Query(default=False),
):
    try:
        if canonical:
            if not 0<=delay_hours<=24 or not 0<=clearance_deg<=20: raise ValueError('Invalid delay or clearance.')
            shift=timedelta(hours=delay_hours)
            start=datetime.fromisoformat(start_utc.replace('Z','+00:00'))+shift
            end=datetime.fromisoformat(end_utc.replace('Z','+00:00'))+shift
            data=await solar_result(site_id,start.isoformat(),end.isoformat(),step_minutes,horizon_mode,observer_height_m,target=399,include_range=include_range)
            if clearance_deg:
                for s in data['samples']: s['visible']=s['elevation_deg']>s['horizon_deg']+clearance_deg
                data['windows'],metrics=visibility_metrics(data['samples'],data['meta']['end_utc'])
                data['summary']={k.replace('sun_visible','earth_visible').replace('longest_dark_gap','longest_hidden_gap'):v for k,v in metrics.items()}
                data['meta']['clearance_deg']=clearance_deg
            return data
        q=EarthQueryRequest(site_id=site_id,start_utc=start_utc,end_utc=end_utc,step_minutes=step_minutes,
                            horizon_mode=horizon_mode,clearance_deg=clearance_deg,delay_hours=delay_hours,observer_height_m=observer_height_m)
        return await earth_payload(q.model_dump())
    except ValueError as exc:
        if isinstance(exc,HorizonUnavailable): raise
        return JSONResponse(status_code=422,content={'status':'unavailable','message':str(exc),'samples':[],'windows':[],'summary':None})

@router.post('',response_model=EarthResponse)
async def post_earth_ephemeris(req:EarthQueryRequest):
    try: return await earth_payload(req.model_dump())
    except ValueError as exc:
        if isinstance(exc,HorizonUnavailable): raise
        return JSONResponse(status_code=422,content={'status':'unavailable','message':str(exc)})
