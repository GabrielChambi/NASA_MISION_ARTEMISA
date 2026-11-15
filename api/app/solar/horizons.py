"""Bounded JPL observer queries; parse the live CSV format inspected on 2026-11-14."""
import asyncio
import csv
from datetime import datetime, timezone
import hashlib
import io
import json
import math
import os
from pathlib import Path
import tempfile
import httpx
from ..core.sites import DATA

BASE='https://ssd.jpl.nasa.gov/api/horizons.api'
LOCK=asyncio.Semaphore(1)  # Respect JPL's serial-request fair-use guidance.

class HorizonsUnavailable(RuntimeError): pass

def iso(dt): return dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

def query_parameters(site,start,end,step,height,target=10,include_range=False):
    altitude_km=(site['elevation_m']+height)/1000
    values={'COMMAND':str(target),'MAKE_EPHEM':'YES','OBJ_DATA':'NO','EPHEM_TYPE':'OBSERVER','CENTER':'coord@301','COORD_TYPE':'GEODETIC','SITE_COORD':f"{site['longitude_deg']},{site['latitude_deg']},{altitude_km:.9f}",'START_TIME':start.strftime('%Y-%m-%d %H:%M:%S'),'STOP_TIME':end.strftime('%Y-%m-%d %H:%M:%S'),'STEP_SIZE':f'{step} m','QUANTITIES':'4','TIME_TYPE':'UT','TIME_DIGITS':'SECONDS','CSV_FORMAT':'YES','ANG_FORMAT':'DEG','APPARENT':'AIRLESS','CAL_TYPE':'GREGORIAN'}
    if include_range: values['QUANTITIES']='4,20'
    return {'format':'json',**{k:f"'{v}'" for k,v in values.items()}}

def parse_result(text,start,end,step,target=10,include_range=False):
    if not isinstance(text,str) or '$$SOE' not in text or '$$EOE' not in text: raise HorizonsUnavailable('JPL response did not contain a complete ephemeris table.')
    required=['Center body name: Moon (301)','Center pole/equ : MEAN_ME','Center geodetic','Azi_(a-app)','Elev_(a-app)']
    if any(field not in text for field in required): raise HorizonsUnavailable('Unexpected observer body, lunar frame, coordinates or table columns.')
    expected_name='Sun (10)' if target==10 else 'Earth (399)'
    if expected_name not in text: raise HorizonsUnavailable('JPL returned an unexpected target body.')
    rows=text.split('$$SOE',1)[1].split('$$EOE',1)[0]
    samples=[]
    try:
        for row in csv.reader(io.StringIO(rows)):
            if not row or not row[0].strip(): continue
            if len(row)<5: raise ValueError('Short CSV row')
            t=datetime.strptime(row[0].strip(),'%Y-%b-%d %H:%M:%S').replace(tzinfo=timezone.utc)
            az,el=float(row[3]),float(row[4])
            if not math.isfinite(az) or not math.isfinite(el) or not 0<=az<=360 or not -90<=el<=90: raise ValueError('Invalid angular values')
            sample={'t_utc':iso(t),'azimuth_deg':az%360,'elevation_deg':el}
            if include_range:
                delta,rate=float(row[5]),float(row[6])
                if not math.isfinite(delta) or delta<=0 or not math.isfinite(rate): raise ValueError('Missing measured range')
                sample.update(range_km=delta*149597870.7,range_rate_km_s=rate)
            samples.append(sample)
    except (ValueError,IndexError) as exc: raise HorizonsUnavailable('Malformed or non-numeric JPL ephemeris sample.') from exc
    expected=int((end-start).total_seconds()/(step*60))+1
    if len(samples)!=expected: raise HorizonsUnavailable('JPL returned an incomplete number of samples.')
    from datetime import timedelta
    if any(sample['t_utc']!=iso(start+timedelta(minutes=i*step)) for i,sample in enumerate(samples)): raise HorizonsUnavailable('JPL timestamps do not match the requested UTC grid.')
    return samples

async def fetch_samples(site,start,end,step,height,target=10,include_range=False):
    params=query_parameters(site,start,end,step,height,target,include_range)
    key=hashlib.sha256(json.dumps(params,sort_keys=True).encode()).hexdigest()
    bundled=DATA/'prepared'/'ephemeris'/f'{key}.json'
    runtime=DATA/'cache'/f'{key}.json'
    # Prepared records retain the original JPL response and query parameters.
    for path in (runtime,bundled):
        if path.exists():
            try:
                record=json.loads(path.read_text(encoding='utf-8'))
                if record['params']!=params: raise ValueError('Cache query mismatch')
                samples=parse_result(record['response']['result'],start,end,step,target,include_range)
                return samples,record,True
            except (OSError,UnicodeError,ValueError,KeyError,HorizonsUnavailable): continue
    async with LOCK:
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(45,connect=10),follow_redirects=False) as client:
                response=await client.get(BASE,params=params)
                response.raise_for_status()
                payload=response.json()
            if not isinstance(payload,dict) or not isinstance(payload.get('result'),str): raise HorizonsUnavailable('JPL response did not contain a valid ephemeris document.')
            if 'error' in payload: raise HorizonsUnavailable('JPL rejected the requested observer query.')
            samples=parse_result(payload.get('result',''),start,end,step,target,include_range)
            record={'params':params,'query_url':str(response.url),'retrieved_at':datetime.now(timezone.utc).isoformat(),'response':payload,'source':'JPL Horizons'}
            # A cache is optional; a verified NASA response remains usable if disk storage fails.
            tmp=None
            try:
                runtime.parent.mkdir(parents=True,exist_ok=True)
                fd,tmp=tempfile.mkstemp(dir=runtime.parent,suffix='.tmp')
                with os.fdopen(fd,'w',encoding='utf-8') as out: json.dump(record,out)
                os.replace(tmp,runtime)
            except OSError:
                if tmp is not None:
                    try:Path(tmp).unlink(missing_ok=True)
                    except OSError:pass
            return samples,record,False
        except (httpx.HTTPError,ValueError,KeyError) as exc:
            raise HorizonsUnavailable('Scientific data unavailable: JPL Horizons did not return a valid response. Try again later or use a previously cached exact interval.') from exc
