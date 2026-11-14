"""Acquire exact NASA queries used by the newly integrated hosted mission modules."""
import asyncio
from datetime import datetime, timezone, timedelta
import hashlib
import json
from pathlib import Path
import sys
import httpx

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from api.app.core.sites import catalog
from api.app.solar.horizons import query_parameters, parse_result

async def main():
    output=ROOT/'data/prepared/ephemeris'
    for delay in [0,12]:
        start=datetime(2026,12,14,tzinfo=timezone.utc)+timedelta(hours=delay)
        end=start+timedelta(hours=72)
        for site in catalog()['sites']:
            for target in [399,10]:
                params=query_parameters(site,start,end,60,2,target)
                if target==399:params['QUANTITIES']="'4,20'"
                key=hashlib.sha256(json.dumps(params,sort_keys=True).encode()).hexdigest()
                path=output/f'{key}.json'
                if path.exists():continue
                async with httpx.AsyncClient(timeout=60) as client:
                    response=await client.get('https://ssd.jpl.nasa.gov/api/horizons.api',params=params)
                    response.raise_for_status();payload=response.json()
                samples=parse_result(payload.get('result',''),start,end,60,target)
                record={'params':params,'query_url':str(response.url),'retrieved_at':datetime.now(timezone.utc).isoformat(),'response':payload,'source':'JPL Horizons'}
                path.write_text(json.dumps(record),encoding='utf-8')
                print(site['id'],target,delay,'hours delay:',len(samples),'verified NASA samples',flush=True)

if __name__=='__main__':asyncio.run(main())
