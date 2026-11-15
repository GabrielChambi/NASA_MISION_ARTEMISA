"""Cache the user's 25-Dec-2026 08:00 La Paz example as original JPL records.

Each exact query retains its parameters, source URL and full NASA response.
Re-running uses validated exact cache records rather than making extra requests.
"""
import asyncio
from datetime import datetime,timezone,timedelta
import hashlib
import json
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'api'))
from app.automatic_plan import (REFERENCE,estimate_transfer,timing,get_sky,
    evaluate_global_plan,validate_plan_request,global_horizons)
from app.solar.horizons import fetch_samples
from app.polar import surface

async def main():
    request=validate_plan_request({'departure_utc':'2026-12-25T12:00:00Z','date_kind':'departure','surface_hours':72})
    start=datetime(2026,12,25,12,tzinfo=timezone.utc)
    saved=[]
    async def acquire(target,a,b):
        rows,record,_=await fetch_samples(REFERENCE,a,b,60,2,10 if target=='Sun' else 399,True)
        key=hashlib.sha256(json.dumps(record['params'],sort_keys=True).encode()).hexdigest()
        destination=ROOT/'data/prepared/ephemeris'/f'{key}.json'
        destination.write_text(json.dumps(record,separators=(',',':')),encoding='utf-8')
        saved.append(destination.name)
        return await get_sky(target,a,b)
    anchor=await acquire('Earth',start,start+timedelta(hours=1))
    transfer=estimate_transfer(anchor['samples'][0]);mission=timing(request,transfer)
    arrival=datetime.strptime(mission['arrival_utc'],'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
    end=arrival+timedelta(hours=request['surface_hours'])
    sun=await acquire('Sun',arrival,end);earth=await acquire('Earth',arrival,end)
    result=evaluate_global_plan(request,surface(),global_horizons(),{'sun':sun,'earth':earth,'transfer_source':anchor['meta']},transfer)
    summary={'request':request,'mission':mission,'counts':result['counts'],'best':{k:result['best'][k] for k in ('id','latitude_deg','longitude_deg','sun_hours','earth_hours')} if result['best'] else None,
        'closest_candidate':result['closest_candidate']['id'] if result['closest_candidate'] else None,'saved_records':saved}
    (ROOT/'data/prepared/automatic_example.json').write_text(json.dumps(summary,separators=(',',':')),encoding='utf-8')
    print(json.dumps(summary,indent=2,ensure_ascii=True))

if __name__=='__main__':asyncio.run(main())
