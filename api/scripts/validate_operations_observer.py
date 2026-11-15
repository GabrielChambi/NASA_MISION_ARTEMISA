import asyncio,json,sys,math
from pathlib import Path
from datetime import datetime,timedelta,timezone
sys.path.insert(0,str(Path('.').resolve()))
from api.app.operations import validate_request,environment,point_series
from api.app.solar.horizons import fetch_samples
async def main():
 p=validate_request({'mission':{'departure_utc':'2026-12-25T13:00:00Z','vehicle_profile':{'lander_name':'Height validation example','solar_panel_height':50,'antenna_height':38,'center_of_gravity_tolerance':10}},'cell_id':'polar:5:56'})
 env=await environment(p['mission']);series,h=point_series(p['mission'],p['cell'],env)
 start=datetime.fromisoformat(series[0]['t_utc'].replace('Z','+00:00'));end=start+timedelta(hours=1)
 point={'id':'operations-independent-observer','latitude_deg':p['cell']['latitude_deg'],'longitude_deg':p['cell']['longitude_deg'],'elevation_m':h['elevation_m']}
 reports=[]
 for target,height,key in ((10,50,'sun'),(399,38,'earth')):
  actual,record,cached=await fetch_samples(point,start,end,15,height,target,True)
  diffs=[{'t_utc':a['t_utc'],'azimuth_difference_deg':abs((a['azimuth_deg']-b[key+'_azimuth_deg']+180)%360-180),'elevation_difference_deg':abs(a['elevation_deg']-b[key+'_elevation_deg']),'range_difference_km':abs(a['range_km']-b[key+'_range_km'])} for a,b in zip(actual,series)]
  maximum=max(max(d['azimuth_difference_deg'],d['elevation_difference_deg']) for d in diffs)
  assert maximum<.001,maximum
  reports.append({'target':key,'observer_height_m':height,'query_url':record['query_url'],'retrieved_at':record['retrieved_at'],'samples':diffs,'maximum_angular_difference_deg':maximum})
 result={'status':'pass','checked_at':datetime.now(timezone.utc).isoformat(),'point':point,'reports':reports,'angular_tolerance_deg':.001,'scope':'Five epochs per body and one point. Direct JPL observer queries independently check the polar-reference translation and heights. This does not validate all dates, terrain, spacecraft or the lunar frame with SPICE.'}
 Path('docs/validation/operations-observer-validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print(json.dumps({'status':'pass','samples':sum(len(r['samples']) for r in reports),'maximum_angular_difference_deg':max(r['maximum_angular_difference_deg'] for r in reports)}))
asyncio.run(main())
