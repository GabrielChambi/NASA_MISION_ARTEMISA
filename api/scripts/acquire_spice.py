"""Acquire official NAIF kernels locally; do not bundle large binaries in Git."""
import hashlib,json,sys,urllib.request
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[2]
BASE='https://naif.jpl.nasa.gov/pub/naif/generic_kernels/'
FILES={'naif0012.tls':'lsk/naif0012.tls','de440s.bsp':'spk/planets/de440s.bsp','moon_pa_de440_200625.bpc':'pck/moon_pa_de440_200625.bpc','moon_de440_250416.tf':'fk/satellites/moon_de440_250416.tf','pck00011.tpc':'pck/pck00011.tpc','earth_000101_270210_261114.bpc':'pck/earth_000101_270210_261114.bpc'}
def main():
 folder=ROOT/'data/raw/spice';folder.mkdir(parents=True,exist_ok=True);items=[]
 manifest_path=ROOT/'data/prepared/spice_manifest.json'
 known={item['name']:item['sha256'] for item in json.loads(manifest_path.read_text(encoding='utf-8'))['kernels']} if manifest_path.exists() else {}
 for name,relative in FILES.items():
  path=folder/name
  expected=known.get(name)
  if not path.exists() or expected is None or hashlib.sha256(path.read_bytes()).hexdigest()!=expected:
   tmp=path.with_suffix(path.suffix+'.part')
   try:
    with urllib.request.urlopen(BASE+relative,timeout=90) as response,tmp.open('wb') as output:
     while block:=response.read(1048576):output.write(block)
    if expected is not None and hashlib.sha256(tmp.read_bytes()).hexdigest()!=expected:raise ValueError('Official kernel differs from the pinned hash: '+name+'. Review the source revision before updating the manifest.')
    tmp.replace(path)
   finally:tmp.unlink(missing_ok=True)
  digest=hashlib.sha256(path.read_bytes()).hexdigest()
  items.append({'name':name,'url':BASE+relative,'sha256':digest,'bytes':path.stat().st_size})
  print(name,path.stat().st_size,flush=True)
 manifest={'source':'NASA/JPL NAIF','retrieved_at':datetime.now(timezone.utc).isoformat(),'kernels':items}
 manifest_path.write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
if __name__=='__main__':main()
