from datetime import datetime, timezone
from ..core.sites import get_site
from ..core.horizon import horizon_at
from .horizons import fetch_samples, iso
from .windows import visibility_metrics

def validate_request(start_utc,end_utc,step_minutes,site_id,height,horizon_mode):
    try:
        start=datetime.fromisoformat(start_utc.replace('Z','+00:00'))
        end=datetime.fromisoformat(end_utc.replace('Z','+00:00'))
    except ValueError as exc: raise ValueError('Dates must be ISO 8601 UTC values.') from exc
    if any(d.tzinfo is None or d.utcoffset().total_seconds()!=0 for d in (start,end)): raise ValueError('Explicit UTC is required (Z or +00:00).')
    duration=(end-start).total_seconds()
    if not 3600<=duration<=31*86400: raise ValueError('Interval must be between 1 hour and 31 days.')
    if not 5<=step_minutes<=1440 or duration%(step_minutes*60)!=0: raise ValueError('Step must be 5–1440 minutes and divide the interval exactly.')
    if duration/(step_minutes*60)>1500: raise ValueError('At most 1500 intervals are allowed.')
    if any(d.second or d.microsecond for d in (start,end)): raise ValueError('Use whole-minute UTC timestamps.')
    if not 1962<=start.year<=2100 or end.year>2100: raise ValueError('Supported UTC years are 1962–2100; Horizons uses UT1 before 1962.')
    if not 0<=height<=100: raise ValueError('Observer height must be between 0 and 100 meters.')
    site=get_site(site_id)
    if not site: raise ValueError('Unknown site_id. Use site01 or site04.')
    if horizon_mode not in ('flat','terrain'): raise ValueError('horizon_mode must be flat or terrain.')
    return start,end,site

async def solar_result(site_id,start_utc,end_utc,step_minutes=60,horizon_mode='flat',observer_height_m=1,target=10):
    start,end,site=validate_request(start_utc,end_utc,step_minutes,site_id,observer_height_m,horizon_mode)
    quality=horizon_at(site_id,0,observer_height_m,horizon_mode)
    rows,record,cache_hit=await fetch_samples(site,start,end,step_minutes,observer_height_m,target)
    samples=[]
    for row in rows:
        horizon=horizon_at(site_id,row['azimuth_deg'],observer_height_m,horizon_mode)['elevation_deg']
        samples.append({**row,'horizon_deg':round(horizon,6),'visible':row['elevation_deg']>horizon})
    windows,summary=visibility_metrics(samples,iso(end))
    if target==399:
        summary={key.replace('sun_visible','earth_visible').replace('longest_dark_gap','longest_hidden_gap'):value for key,value in summary.items()}
    limitations=list(dict.fromkeys(quality['warnings']+['Geometric visibility proxy; no electrical energy or RF link guarantee.','Half-open windows use left samples; transitions are uncertain by up to one sample step.','The observer is a regional DEM reference pixel, not a NASA-approved landing location.','Lunar mean-Earth terrain/observer convention is used; independent SPICE frame validation is pending.']))
    return {'status':'ok','site_id':site_id,'target':'Sun' if target==10 else 'Earth','meta':{'source':'JPL Horizons','source_url':'https://ssd-api.jpl.nasa.gov/doc/horizons.html','query_url':record['query_url'],'retrieved_at':record['retrieved_at'],'cache_hit':cache_hit,'start_utc':iso(start),'end_utc':iso(end),'step_minutes':step_minutes,'horizon_mode':horizon_mode,'horizon_quality':quality['quality'],'observer_height_m':observer_height_m,'observer_altitude_km':(site['elevation_m']+observer_height_m)/1000,'latitude_deg':site['latitude_deg'],'longitude_deg':site['longitude_deg'],'reference_frame':'Horizons MEAN_ME lunar observer; NASA LOLA MOON_ME/DE421','window_convention':'[start,end), left sample, strict elevation > horizon','limitations':limitations},'samples':samples,'windows':windows,'summary':summary}
