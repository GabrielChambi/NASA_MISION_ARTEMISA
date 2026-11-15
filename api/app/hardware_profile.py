"""User-declared asset identity and provenance; never self-certifies hardware."""
import re
from urllib.parse import urlparse
def validate_hardware(raw):
 if raw is None:return None
 if not isinstance(raw,dict):raise ValueError('Hardware identity must be an object.')
 output={}
 for key,limit in (('asset_id',80),('name',160),('revision',80)):
  if not isinstance(raw.get(key),str) or not 1<=len(raw[key].strip())<=limit:raise ValueError('Hardware requires asset_id, name and revision.')
  output[key]=raw[key].strip()
 if not re.fullmatch(r'[A-Za-z0-9_.-]+',output['asset_id']):raise ValueError('Use letters, digits, dots, hyphens or underscores for asset_id.')
 references=raw.get('references')
 if not isinstance(references,list) or not 1<=len(references)<=20:raise ValueError('Hardware requires 1–20 source references.')
 output['references']=[]
 for item in references:
  if not isinstance(item,dict) or item.get('kind') not in ('design_assumption','manufacturer_specification','test_report'):raise ValueError('Declare the kind of each hardware source.')
  if not isinstance(item.get('url'),str) or len(item['url'])>2000:raise ValueError('Invalid hardware source URL.')
  url=urlparse(item['url'])
  if url.scheme not in ('http','https') or not url.hostname or url.username or url.password:raise ValueError('Use public HTTP(S) source references without credentials.')
  entry={'url':item['url'],'kind':item['kind']}
  if item.get('sha256') is not None:
   if not isinstance(item['sha256'],str) or not re.fullmatch(r'[a-fA-F0-9]{64}',item['sha256']):raise ValueError('Invalid hardware document SHA256.')
   entry['sha256']=item['sha256'].lower()
  output['references'].append(entry)
 output['independently_authenticated']=False;output['calibrated']=False
 return output
