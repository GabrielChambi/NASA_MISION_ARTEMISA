"""Station-specific instantaneous geometry, not DSN scheduling or a pointing guarantee."""
import math
import numpy as np
from spiceypy.utils.exceptions import SpiceyError
from .spice_service import kernel_manifest,ephemeris_time,body_state,LOCK,spice,SpiceUnavailable
from .native_terrain import interpolate_horizon
from .engineering_models import link_budget,rf_config
SOURCE='https://deepspace.jpl.nasa.gov/dsndocs/810-005/301/301P.pdf'
# WGS84 geodetic DMS and heights, table 5, epoch 2003.0. No decommissioned antennas.
def dms(d,m,s):return (-1 if d<0 else 1)*(abs(d)+m/60+s/3600)
STATIONS=[
 {'id':'DSS-24','complex':'Goldstone','lat':dms(35,20,23.61416),'lon':dms(243,7,30.74007),'height_m':951.499},
 {'id':'DSS-34','complex':'Canberra','lat':dms(-35,23,54.52383),'lon':dms(148,58,55.07191),'height_m':692.020},
 {'id':'DSS-54','complex':'Madrid','lat':dms(40,25,32.23805),'lon':dms(355,44,45.25141),'height_m':837.051}]
def station_vector(station):
 p,l=math.radians(station['lat']),math.radians(station['lon']);a=6378.137;f=1/298.257223563;e2=f*(2-f);N=a/math.sqrt(1-e2*math.sin(p)**2);h=station['height_m']/1000
 return np.array([(N+h)*math.cos(p)*math.cos(l),(N+h)*math.cos(p)*math.sin(l),(N*(1-e2)+h)*math.sin(p)]),np.array([math.cos(p)*math.cos(l),math.cos(p)*math.sin(l),math.sin(p)])
def station_geometry(utc,cell,horizon,minimum_ground_elevation_deg=10.):
 et=ephemeris_time(utc);lat,lon=math.radians(cell['latitude_deg']),math.radians(cell['longitude_deg'])
 up=np.array([math.cos(lat)*math.cos(lon),math.cos(lat)*math.sin(lon),math.sin(lat)]);east=np.array([-math.sin(lon),math.cos(lon),0.]);north=np.cross(up,east)
 lunar=(1737.4+(cell['elevation_m']+horizon['observer_heights_m']['earth'])/1000)*up
 earth=body_state('EARTH',et,'MOON')[:3]
 with LOCK:
  lunar_to_inertial=spice.pxform('MOON_ME','J2000',et)
  terrestrial_to_inertial=spice.pxform('ITRF93','J2000',et)
 rows=[]
 for station in STATIONS:
  position,station_up=station_vector(station);vector=earth+terrestrial_to_inertial@position-lunar_to_inertial@lunar
  moon_local=lunar_to_inertial.T@vector;receiver_local=terrestrial_to_inertial.T@(-vector);distance=float(np.linalg.norm(vector))
  elev=math.degrees(math.asin(np.clip(float(moon_local@up)/distance,-1,1)));az=math.degrees(math.atan2(float(moon_local@east),float(moon_local@north)))%360
  station_elev=math.degrees(math.asin(np.clip(float(receiver_local@station_up)/distance,-1,1)))
  native_horizon=interpolate_horizon(horizon['profiles']['earth'],az)
  known=horizon['near_complete'] and horizon['valid_to_min_m']>=20000 and native_horizon is not None
  rows.append({'id':station['id'],'complex':station['complex'],'range_km':distance,'lunar_azimuth_deg':az,'lunar_elevation_deg':elev,'lunar_horizon_deg':native_horizon if known else None,'ground_elevation_deg':station_elev,'ground_mask_deg':minimum_ground_elevation_deg,'geometry_pass':known and elev-native_horizon>.3 and station_elev>=minimum_ground_elevation_deg})
 return rows
def dsn_scenario(samples,cell,horizon,raw_rf=None):
 q=rf_config(raw_rf);rows=[];hours={s['id']:0. for s in STATIONS}
 try:
  kernel_manifest()
  for i,s in enumerate(samples):
   candidates=station_geometry(s['t_utc'],cell,horizon)
   for c in candidates:
    c.update(link_budget(c['range_km'],q));c['link_model_pass']=c['geometry_pass'] and c['margin_db']>=0
    if i<len(samples)-1 and c['link_model_pass']:
     from datetime import datetime
     delta=(datetime.fromisoformat(samples[i+1]['t_utc'].replace('Z','+00:00'))-datetime.fromisoformat(s['t_utc'].replace('Z','+00:00'))).total_seconds()/3600
     hours[c['id']]+=delta
   best=max(candidates,key=lambda c:(c['link_model_pass'],c['geometry_pass'],c['margin_db']))
   rows.append({'t_utc':s['t_utc'],'stations':candidates,'selected':best})
 except (SpiceUnavailable,SpiceyError) as exc:return {'status':'unknown','reason':'Earth orientation or native horizon unavailable for station geometry.','states':[],'source_url':SOURCE}
 return {'status':'ok','stations':STATIONS,'states':rows,'station_model_hours':hours,'source_url':SOURCE,'scheduled':False,
 'limitations':['Three 34 m station locations from DSN 301P table 5, epoch 2003.0; no tectonic propagation of these reference positions.','Instantaneous geometric vectors use DE440, MOON_ME and ITRF93; no signal-event light-time iteration, aberration or refraction. A 0.3 degree lunar clearance is imposed.','Ground elevation mask of 10 degrees is a declared design mask; actual azimuth-dependent station masks, equipment configurations, weather, pointing and DSN schedules are not confirmed.','The pinned Earth PCK includes predicted Earth orientation after its measured interval. Dates outside its coverage are unresolved, not extrapolated.','Gain, receiver noise and losses are declared equivalent 34 m design parameters; station pass hours are conditional model windows, not booked DSN contacts.']}
