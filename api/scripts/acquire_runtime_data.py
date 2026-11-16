"""Acquire only the pinned original files required by the deployed scientific API."""
import argparse,hashlib,json,re,shutil,urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
REGIONAL='https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF'
def sources(root=ROOT):
 data=root/'data';expected=json.loads((data/'prepared/landing_surface.json').read_text(encoding='utf-8'))['source_sha256']
 native={'regional80m.tif','site01.tif','site04.tif','site01-slp.tif','site04-slp.tif','site01-toterr.tif','site04-toterr.tif'}
 if set(expected)!=native:raise ValueError('Incomplete or unexpected NASA raster manifest.')
 output=[]
 for name,digest in expected.items():
  if name=='regional80m.tif':url=REGIONAL
  elif name in ('site01.tif','site04.tif','site01-slp.tif','site04-slp.tif','site01-toterr.tif','site04-toterr.tif'):
   site=name.split('.')[0].split('-')[0];number=site[-2:];suffix='surf' if '-' not in name else name.split('-')[1].split('.')[0]
   url=f'https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site{number}/Site{number}_final_adj_5mpp_{suffix}.tif'
  else:raise ValueError('Unexpected native data filename.')
  if not isinstance(digest,str) or not re.fullmatch('[a-fA-F0-9]{64}',digest):raise ValueError('Invalid source digest.')
  output.append((data/'raw'/name,url,digest))
 kernels=json.loads((data/'prepared/spice_manifest.json').read_text(encoding='utf-8'))['kernels']
 if {k['name'] for k in kernels}!={'naif0012.tls','de440s.bsp','moon_pa_de440_200625.bpc','moon_de440_250416.tf','pck00011.tpc','earth_000101_270210_261114.bpc'} or len(kernels)!=6:raise ValueError('Incomplete or unexpected NAIF manifest.')
 for kernel in kernels:
  if '/' in kernel['name'] or chr(92) in kernel['name'] or not kernel['url'].startswith('https://naif.jpl.nasa.gov/pub/naif/generic_kernels/'):raise ValueError('Unexpected NAIF source.')
  if not isinstance(kernel.get('sha256'),str) or not re.fullmatch('[a-fA-F0-9]{64}',kernel['sha256']):raise ValueError('Invalid kernel digest.')
  output.append((data/'raw/spice'/kernel['name'],kernel['url'],kernel['sha256']))
 return output
def digest(path):
 h=hashlib.sha256()
 with path.open('rb') as stream:
  for block in iter(lambda:stream.read(1048576),b''):h.update(block)
 return h.hexdigest()
def acquire(verify_only=False,root=ROOT):
 items=sources(root)
 for path,url,expected in items:
  if path.is_file() and digest(path)==expected:continue
  if verify_only:raise RuntimeError('Missing or altered pinned scientific file: '+path.name)
  path.parent.mkdir(parents=True,exist_ok=True)
  bundled=root/'data/pinned/naif'/path.name
  if bundled.is_file():
   if digest(bundled)!=expected:raise RuntimeError('Altered bundled scientific source: '+path.name)
   shutil.copyfile(bundled,path)
   continue
  temporary=path.with_suffix(path.suffix+'.part')
  try:
   last_error=None
   for attempt in range(3):
    try:
     print('Acquiring '+path.name+' (attempt '+str(attempt+1)+')',flush=True)
     # A retry bypasses intermediary caches; the accepted bytes stay pinned.
     target_url=url if attempt==0 else url+('?retry=' if '?' not in url else '&retry=')+expected[:16]+'-'+str(attempt)
     request=urllib.request.Request(target_url,headers={'User-Agent':'LunarOracle-data-acquisition/1','Accept-Encoding':'identity'})
     received=0;download_hash=hashlib.sha256()
     with urllib.request.urlopen(request,timeout=180) as response,temporary.open('wb') as target:
      headers=getattr(response,'headers',{})
      if getattr(response,'status',200)!=200 or headers.get('Content-Range'):raise RuntimeError('Partial scientific response: '+path.name)
      while block:=response.read(1048576):
       target.write(block);download_hash.update(block);received+=len(block)
      length=headers.get('Content-Length')
     if length is not None and received!=int(length):raise RuntimeError('Incomplete scientific response: '+path.name)
     if download_hash.hexdigest()!=expected:raise RuntimeError('Original source hash mismatch: '+path.name)
     temporary.replace(path)
     break
    except (OSError,ValueError,RuntimeError) as error:
     last_error=error
     temporary.unlink(missing_ok=True)
   else:raise RuntimeError('Could not acquire pinned scientific source: '+path.name) from last_error
  finally:temporary.unlink(missing_ok=True)
 print(json.dumps({'status':'verified','files':len(items),'bytes':sum(p.stat().st_size for p,_,__ in items)}),flush=True)
 return items
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--verify-only',action='store_true');args=parser.parse_args();acquire(args.verify_only)
