"""Landing-grid API. Every observer query uses the selected NASA DEM pixel."""
import json
import math
from functools import lru_cache
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from .core.sites import DATA
from .core.horizon import circular_interpolate
from .solar.service import validate_request
from .solar.horizons import fetch_samples, iso
from .solar.windows import visibility_metrics

router = APIRouter(prefix='/api/landing')

@lru_cache(maxsize=1)
def surface():
    path = DATA/'prepared/landing_surface.json'
    if not path.exists():
        raise FileNotFoundError('Prepare original NASA landing data with api/scripts/prepare_landing_surface.py.')
    return json.loads(path.read_text(encoding='utf-8'))

def get_cell(cell_id):
    for region in surface()['regions']:
        for cell in region['cells']:
            if cell['id']==cell_id:
                if not cell['known'] or len(cell['horizon_deg'])!=360 or any(not isinstance(v,(int,float)) or not math.isfinite(v) for v in cell['horizon_deg']):
                    raise ValueError('Unknown terrain or incomplete horizon coverage: this cell cannot be assessed.')
                return region,cell
    raise ValueError('Unknown cell_id. Choose a cell inside prepared NASA coverage.')

@router.get('/surface')
def surface_endpoint():
    return surface()

@router.get('/ephemeris')
async def ephemeris(cell_id: str, target: str, start_utc: str, end_utc: str, step_minutes: int=60, observer_height_m: float=2):
    try:
        if target not in ('Sun','Earth'): raise ValueError('target must be Sun or Earth.')
        if observer_height_m != 2: raise ValueError('Landing-grid profiles are prepared at 2 m observer height only.')
        region,cell=get_cell(cell_id)
        start,end,_=validate_request(start_utc,end_utc,step_minutes,region['id'],observer_height_m,'terrain')
        point={'id':cell_id,'latitude_deg':cell['latitude_deg'],'longitude_deg':cell['longitude_deg'],'elevation_m':cell['elevation_m']}
        rows,record,cached=await fetch_samples(point,start,end,step_minutes,observer_height_m,10 if target=='Sun' else 399,True)
        samples=[]
        for row in rows:
            horizon=circular_interpolate(cell['horizon_deg'],row['azimuth_deg'])
            samples.append({**row,'horizon_deg':horizon,'visible':row['elevation_deg']>horizon})
        windows,summary=visibility_metrics(samples,iso(end))
        if target=='Earth':
            summary={k.replace('sun_visible','earth_visible').replace('longest_dark_gap','longest_hidden_gap'):v for k,v in summary.items()}
        return {'status':'ok','site_id':cell_id,'target':target,'meta':{
            'source':'JPL Horizons','source_url':'https://ssd-api.jpl.nasa.gov/doc/horizons.html',
            'query_url':record['query_url'],'retrieved_at':record['retrieved_at'],'cache_hit':cached,
            'start_utc':iso(start),'end_utc':iso(end),'step_minutes':step_minutes,
            'horizon_mode':'terrain','horizon_quality':'sampled-partial',
            'observer_height_m':observer_height_m,'observer_altitude_km':(cell['elevation_m']+observer_height_m)/1000,
            'latitude_deg':cell['latitude_deg'],'longitude_deg':cell['longitude_deg'],
            'reference_frame':surface()['reference_frame'],'cell_id':cell_id,'region_id':region['id'],
            'window_convention':'[start,end), left sample, strict elevation > horizon',
            'limitations':surface()['limitations']
        },'samples':samples,'windows':windows,'summary':summary}
    except ValueError as exc:
        return JSONResponse(status_code=422,content={'status':'unavailable','message':str(exc),'samples':[],'windows':[],'summary':None})
