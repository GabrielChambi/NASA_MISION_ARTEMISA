"""Explicit, traceable recorded telemetry; no simulated physical connection."""
import hashlib,json,math
from datetime import datetime,timezone
import numpy as np
from .energy_model import number
def validate_telemetry(raw,mission):
 if raw is None:return None
 if not isinstance(raw,dict) or raw.get('kind') not in ('recorded','synthetic_test') or raw.get('mode') not in ('replay','live'):raise ValueError('Telemetry requires recorded/synthetic_test kind and replay/live mode.')
 for key in ('asset_id','source'):
  if not isinstance(raw.get(key),str) or not 1<=len(raw[key])<=200:raise ValueError('Telemetry requires an asset identifier and source.')
 rows=raw.get('samples')
 if not isinstance(rows,list) or not 1<=len(rows)<=2000:raise ValueError('Telemetry must contain 1–2000 samples.')
 uncertainty=raw.get('uncertainty')
 if not isinstance(uncertainty,dict) or not number(uncertainty.get('temperature_k'),.001,100) or not number(uncertainty.get('soc'),.00001,1):raise ValueError('Declare temperature_k and soc measurement uncertainty.')
 begin=datetime.fromisoformat(mission['arrival_utc'].replace('Z','+00:00'));previous=-math.inf;clean=[]
 for row in rows:
  if not isinstance(row,dict) or not isinstance(row.get('t_utc'),str) or not row['t_utc'].endswith('Z'):raise ValueError('Telemetry timestamps require explicit UTC.')
  try:t=datetime.fromisoformat(row['t_utc'].replace('Z','+00:00'))
  except ValueError:raise ValueError('Invalid telemetry UTC.')
  hour=(t-begin).total_seconds()/3600
  if not 0<=hour<=mission['surface_hours'] or hour<=previous:raise ValueError('Telemetry must be strictly ordered inside the modeled mission.')
  if raw['mode']=='live' and t>datetime.now(timezone.utc):raise ValueError('Future samples cannot be live telemetry.')
  if not number(row.get('temperature_k'),20,600) or not number(row.get('soc'),0,1):raise ValueError('Invalid telemetry temperature or SOC.')
  clean.append({'t_utc':row['t_utc'],'hour':hour,'temperature_k':row['temperature_k'],'soc':row['soc']});previous=hour
 return {'asset_id':raw['asset_id'],'source':raw['source'],'kind':raw['kind'],'mode':raw['mode'],'uncertainty':{k:uncertainty[k] for k in ('temperature_k','soc')},'samples':clean,'sha256':hashlib.sha256(json.dumps(raw,sort_keys=True,separators=(',',':')).encode()).hexdigest()}
def compare_telemetry(record,prediction):
 if record is None:return {'status':'unconnected','physical_asset_connected':False,'reason':'No physical asset telemetry was supplied. Design parameters are uncalibrated.'}
 if prediction.get('budget') is None or prediction['thermal']['status']!='ok':return {'status':'synthetic_test' if record['kind']=='synthetic_test' else 'recorded_comparison','comparison_status':'unresolved','physical_asset_connected':False,'record':record,'calibrated':False}
 series={'temperature_k':prediction['thermal']['states'],'soc':prediction['budget']['states']};metrics={}
 for key,states in series.items():
  predicted=np.interp([r['hour'] for r in record['samples']],[r['hour'] for r in states],[r[key] for r in states])
  residual=predicted-np.array([r[key] for r in record['samples']])
  metrics[key]={'rmse':float(np.sqrt(np.mean(residual**2))),'bias':float(np.mean(residual)),'maximum_absolute_error':float(np.max(np.abs(residual))),'within_declared_uncertainty':bool(np.max(np.abs(residual))<=record['uncertainty'][key])}
 return {'status':'synthetic_test' if record['kind']=='synthetic_test' else 'recorded_comparison','physical_asset_connected':False,'comparison_status':'compared','record':record,'metrics':metrics,'calibrated':False,'limitation':'User-supplied recorded samples and uncertainty; provenance is retained, not independently authenticated. Residual agreement is not hardware qualification or parameter calibration.'}
