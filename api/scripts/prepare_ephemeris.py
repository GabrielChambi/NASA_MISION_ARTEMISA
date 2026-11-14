"""Fetch exact real NASA intervals for an auditable offline demo and independent cross-check."""
import asyncio
from datetime import timedelta
import json
from pathlib import Path
import shutil
import sys
import httpx

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from api.app.solar.service import solar_result, validate_request
from api.app.solar.horizons import query_parameters, parse_result, BASE
from api.app.core.sites import DATA

async def main():
    validation=[]
    for site_id in ['site01','site04']:
        for target,label in [(10,'solar'),(399,'earth')]:
            result=await solar_result(site_id,'2026-12-01T00:00:00Z','2026-12-08T00:00:00Z',60,'flat',1,target)
            (DATA/'prepared'/f'{site_id}-{label}.json').write_text(json.dumps(result,separators=(',',':')),encoding='utf-8')
            print(site_id,label,len(result['samples']),result['summary'],flush=True)
        # Independent short direct JPL requests for three dates, compared to the longer series.
        solar=json.loads((DATA/'prepared'/f'{site_id}-solar.json').read_text())
        for offset in [0,72,144]:
            start,end,site=validate_request(solar['samples'][offset]['t_utc'],solar['samples'][offset+1]['t_utc'],60,site_id,1,'flat')
            params=query_parameters(site,start,end,60,1)
            async with httpx.AsyncClient(timeout=60) as client:
                response=await client.get(BASE,params=params)
                response.raise_for_status()
                body=response.json()
            direct=parse_result(body['result'],start,end,60)
            delta=max(abs(direct[0][field]-solar['samples'][offset][field]) for field in ['azimuth_deg','elevation_deg'])
            if delta>1e-5: raise AssertionError(f'Independent Horizons cross-check differs {delta}')
            validation.append({'site_id':site_id,'t_utc':direct[0]['t_utc'],'query_url':str(response.url),'max_difference_deg':delta,'tolerance_deg':1e-5,'result':'passed','azimuth_deg':direct[0]['azimuth_deg'],'elevation_deg':direct[0]['elevation_deg']})
            await asyncio.sleep(.2)
    (DATA/'prepared'/'ephemeris').mkdir(exist_ok=True)
    for path in (DATA/'cache').glob('*.json'):
        shutil.copy2(path,DATA/'prepared'/'ephemeris'/path.name)
    (DATA/'prepared'/'validation.json').write_text(json.dumps({'source':'Independent direct JPL Horizons query with shorter interval','checks':validation},indent=2),encoding='utf-8')
    print('Independent NASA cross-checks:',len(validation),'passed',flush=True)

if __name__=='__main__': asyncio.run(main())
