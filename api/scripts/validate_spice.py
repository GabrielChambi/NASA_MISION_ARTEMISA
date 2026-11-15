"""Compare original JPL observer records with a separate NAIF software path."""
import hashlib,json,math,sys
from pathlib import Path
from datetime import datetime,timezone
import numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from api.app.spice_service import observer_angles,kernel_manifest
from api.app.solar.horizons import parse_result
def main():
 records=[];seen=set()
 for folder in (ROOT/'data/prepared/ephemeris',ROOT/'data/cache'):
  for path in sorted(folder.glob('*.json')):
   try:
    record=json.loads(path.read_text(encoding='utf-8'));p=record['params'];target=int(p['COMMAND'].strip("'"))
    if target not in (10,399) or '20' not in p['QUANTITIES']:continue
    lon,lat,alt=map(float,p['SITE_COORD'].strip("'").split(','))
    if not -90<=lat<=-80:continue
    start=datetime.strptime(p['START_TIME'].strip("'"),'%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc);end=datetime.strptime(p['STOP_TIME'].strip("'"),'%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc);step=int(p['STEP_SIZE'].strip("'").split()[0])
    identity=(target,lon,lat,alt,start,end,step)
    if identity in seen:continue
    seen.add(identity);samples=parse_result(record['response']['result'],start,end,step,target,True)
    records.append((path,record,lat,lon,alt,target,samples))
   except (KeyError,ValueError):continue
 # Span different source parameters and epochs deterministically instead of duplicating cached queries.
 if len(records)>40:records=[records[round(i*(len(records)-1)/39)] for i in range(40)]
 results=[]
 for path,record,lat,lon,alt,target,samples in records:
  pairs=[]
  for index in sorted({0,len(samples)//2,len(samples)-1}):
   sample=samples[index];sp=observer_angles(sample['t_utc'],lat,lon,alt*1000,0.,str(target))
   def vector(az,el):
    a,e=math.radians(az),math.radians(el);return np.array([math.cos(e)*math.sin(a),math.cos(e)*math.cos(a),math.sin(e)])
   a=vector(sample['azimuth_deg'],sample['elevation_deg']);b=vector(sp['azimuth_deg'],sp['elevation_deg'])
   separation=math.degrees(math.atan2(np.linalg.norm(np.cross(a,b)),a@b))
   pairs.append({'t_utc':sample['t_utc'],'angular_separation_deg':separation,'range_difference_km':abs(sample['range_km']-sp['range_km'])})
  results.append({'query_url':record['query_url'],'record_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'observer':{'latitude_deg':lat,'longitude_deg':lon,'height_above_lunar_reference_m':alt*1000},'target':target,'comparisons':pairs})
 maximum=max(x['angular_separation_deg'] for r in results for x in r['comparisons'])
 report={'status':'pass' if maximum<=.01 else 'review','created_utc':datetime.now(timezone.utc).isoformat(),'acceptance_deg':.01,'maximum_angular_separation_deg':maximum,'source_record_count':len(results),'comparison_count':sum(len(r['comparisons']) for r in results),'records':results,'kernel_manifest':kernel_manifest(),'scope':'Original JPL observer records versus separate NAIF DE440 CN+S mean-Earth software path. Covers only enumerated observers and epochs; shared JPL ephemeris heritage is not independent physical evidence.'}
 (ROOT/'docs/validation/spice-reference-validation.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
 print(json.dumps({k:report[k] for k in ('status','comparison_count','source_record_count','maximum_angular_separation_deg')}))
 if report['status']!='pass':raise SystemExit(1)
if __name__=='__main__':main()
