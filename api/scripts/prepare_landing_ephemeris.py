"""Acquire and retain original JPL records used by the landing cockpit regressions."""
import asyncio
from datetime import datetime,timezone,timedelta
import hashlib,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from api.app.landing import surface
from api.app.solar.horizons import fetch_samples
async def main():
    start=datetime(2026,12,14,tzinfo=timezone.utc)
    for region in surface()['regions']:
        ids=[region['center_cell_id']]
        if region['id']=='site01': ids+=['site01:0:0']
        for cid in ids:
            cell=next(c for c in region['cells'] if c['id']==cid)
            point={'id':cid,'latitude_deg':cell['latitude_deg'],'longitude_deg':cell['longitude_deg'],'elevation_m':cell['elevation_m']}
            for target in (10,399):
                rows,record,cached=await fetch_samples(point,start,start+timedelta(hours=72),60,2,target,True)
                key=hashlib.sha256(json.dumps(record['params'],sort_keys=True).encode()).hexdigest()
                (ROOT/'data/prepared/ephemeris'/f'{key}.json').write_text(json.dumps(record),encoding='utf-8')
                print(cid,target,len(rows),'cache',cached,'first',rows[0]['azimuth_deg'],rows[0]['elevation_deg'],flush=True)
if __name__=='__main__':asyncio.run(main())
