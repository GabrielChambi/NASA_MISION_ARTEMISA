"""NAIF kernel-based observer geometry. Calls are serialized: SPICE has process-global state."""
import hashlib,json,math,threading
from functools import lru_cache
from datetime import datetime,timezone
import numpy as np
import spiceypy as spice
from .core.sites import DATA
LOCK=threading.RLock()
FRAME='MOON_ME'
class SpiceUnavailable(RuntimeError):pass
@lru_cache(maxsize=1)
def kernel_manifest():
 path=DATA/'prepared/spice_manifest.json'
 if not path.exists():raise SpiceUnavailable('Run api/scripts/acquire_spice.py to acquire original NAIF kernels.')
 manifest=json.loads(path.read_text(encoding='utf-8'))
 expected={'naif0012.tls','de440s.bsp','moon_pa_de440_200625.bpc','moon_de440_250416.tf','pck00011.tpc','earth_000101_270210_261114.bpc'}
 if {k['name'] for k in manifest['kernels']}!=expected:raise SpiceUnavailable('Unexpected kernel manifest.')
 paths=[]
 for item in manifest['kernels']:
  path=DATA/'raw/spice'/item['name']
  if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest()!=item['sha256']:raise SpiceUnavailable('Missing or altered NAIF kernel: '+item['name'])
  paths.append(path)
 with LOCK:
  for path in paths:spice.furnsh(str(path))
 return manifest
def ephemeris_time(utc):
 kernel_manifest()
 if not isinstance(utc,str) or not utc.endswith('Z'):raise ValueError('SPICE requires explicit UTC.')
 with LOCK:return float(spice.str2et(utc))
def body_state(target,utc_or_et,center='EARTH'):
 kernel_manifest();et=ephemeris_time(utc_or_et) if isinstance(utc_or_et,str) else float(utc_or_et)
 with LOCK:state,_=spice.spkezr(str(target),et,'J2000','NONE',center)
 return np.asarray(state)
def observer_angles(utc,lat,lon,elevation_m=0.,height_m=2.,target='EARTH'):
 if not all(isinstance(v,(int,float)) and not isinstance(v,bool) and math.isfinite(v) for v in (lat,lon,elevation_m,height_m)) or not -90<=lat<=-80 or not -180<=lon<=180 or not 0<=height_m<=200:raise ValueError('Invalid lunar observer.')
 et=ephemeris_time(utc);latitude,longitude=math.radians(lat),math.radians(lon)
 up=np.array([math.cos(latitude)*math.cos(longitude),math.cos(latitude)*math.sin(longitude),math.sin(latitude)])
 east=np.array([-math.sin(longitude),math.cos(longitude),0.])
 north=np.cross(up,east)
 position=(1737.4+(elevation_m+height_m)/1000)*up
 with LOCK:state,light=spice.spkcpo(target,et,FRAME,'OBSERVER','CN+S',position,'MOON',FRAME)
 vec=np.asarray(state[:3]);e,n,u=float(vec@east),float(vec@north),float(vec@up)
 return {'t_utc':utc,'azimuth_deg':math.degrees(math.atan2(e,n))%360,'elevation_deg':math.degrees(math.atan2(u,math.hypot(e,n))),'range_km':float(np.linalg.norm(vec)),'light_time_s':float(light),'frame':FRAME,'aberration':'CN+S','observer_height_m':height_m}
def compare_samples(samples,lat,lon,elevation_m,sun_height_m,earth_height_m,max_epochs=7):
 kernel_manifest()
 indices=sorted({round(i*(len(samples)-1)/max(1,max_epochs-1)) for i in range(min(max_epochs,len(samples)))})
 rows=[]
 for i in indices:
  for key,target,height in [('sun','SUN',sun_height_m),('earth','EARTH',earth_height_m)]:
   calculated=observer_angles(samples[i]['t_utc'],lat,lon,elevation_m,height,target)
   a=calculated['azimuth_deg'];b=samples[i][key+'_azimuth_deg'];da=abs((a-b+180)%360-180)
   de=abs(calculated['elevation_deg']-samples[i][key+'_elevation_deg'])
   # Great-circle separation is stable for azimuths near polar elevation.
   az1,el1=math.radians(a),math.radians(calculated['elevation_deg']);az2,el2=math.radians(b),math.radians(samples[i][key+'_elevation_deg'])
   p=np.array([math.cos(el1)*math.sin(az1),math.cos(el1)*math.cos(az1),math.sin(el1)])
   q=np.array([math.cos(el2)*math.sin(az2),math.cos(el2)*math.cos(az2),math.sin(el2)])
   separation=math.degrees(math.atan2(float(np.linalg.norm(np.cross(p,q))),float(p@q)))
   rows.append({'target':key,'t_utc':samples[i]['t_utc'],'angular_separation_deg':separation,'azimuth_difference_deg':da,'elevation_difference_deg':de,'range_difference_km':abs(calculated['range_km']-samples[i][key+'_range_km']),'spice':calculated})
 maximum=max(r['angular_separation_deg'] for r in rows)
 return {'status':'pass' if maximum<=.01 else 'review','maximum_angular_separation_deg':maximum,'acceptance_deg':.01,'comparisons':rows,'kernels':kernel_manifest()['kernels'],'frame':FRAME,'aberration':'CN+S','scope':'Independent software path using NAIF/DE440 at these epochs and observer only. Horizons may use a newer ephemeris and additional apparent corrections; agreement does not validate terrain, hardware or all epochs.'}
