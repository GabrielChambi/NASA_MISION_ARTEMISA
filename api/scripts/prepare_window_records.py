"""Prepare exact JPL source records for the bounded window-search example.

Original responses, full query parameters and retrieval times remain intact.
Cropped candidate windows are never presented as new NASA responses.
"""
import argparse
import asyncio
from datetime import datetime,timedelta
import hashlib
import json
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from api.app.landing import get_cell
from api.app.solar.horizons import fetch_samples

async def prepare(cell_id,start_utc,duration_hours,include_nominal=False):
    if not 1<=duration_hours<=336:
        raise ValueError('Duration must be between 1 and 336 hours.')
    nominal=datetime.fromisoformat(start_utc.replace('Z','+00:00'))
    if nominal.tzinfo is None or nominal.utcoffset()!=timedelta(0) or nominal.second or nominal.microsecond:
        raise ValueError('Explicit whole-minute UTC required.')
    _,cell=get_cell(cell_id)
    point={'id':cell_id,'latitude_deg':cell['latitude_deg'],'longitude_deg':cell['longitude_deg'],'elevation_m':cell['elevation_m']}
    intervals=[('expanded',nominal-timedelta(hours=2),nominal+timedelta(hours=duration_hours+14))]
    if include_nominal:intervals.insert(0,('nominal',nominal,nominal+timedelta(hours=duration_hours)))
    output=ROOT/'data/prepared/ephemeris'
    output.mkdir(parents=True,exist_ok=True)
    # NASA fair-use: requests remain serial, one per body/interval.
    for name,start,end in intervals:
        for target in (10,399):
            rows,record,cached=await fetch_samples(point,start,end,60,2,target,True)
            key=hashlib.sha256(json.dumps(record['params'],sort_keys=True).encode()).hexdigest()
            path=output/f'{key}.json'
            path.write_text(json.dumps(record,separators=(',',':')),encoding='utf-8')
            print(json.dumps({'interval':name,'cell_id':cell_id,'target':target,'samples':len(rows),'cache_hit':cached,
                'start_utc':rows[0]['t_utc'],'end_utc':rows[-1]['t_utc'],'file':str(path.relative_to(ROOT))}),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--cell-id',default='site01:2:0')
    parser.add_argument('--start-utc',default='2026-12-14T00:00:00Z')
    parser.add_argument('--duration-hours',type=int,default=72)
    parser.add_argument('--include-nominal',action='store_true')
    args=parser.parse_args()
    asyncio.run(prepare(args.cell_id,args.start_utc,args.duration_hours,args.include_nominal))
