"""Acquire official NAIF kernels locally; do not bundle large binaries in Git."""
import hashlib,json,sys,urllib.request
from pathlib import Path
from datetime import datetime,timezone
ROOT=Path(__file__).resolve().parents[2]
BASE='https://naif.jpl.nasa.gov/pub/naif/generic_kernels/'
FILES={'naif0012.tls':'lsk/naif0012.tls','de440s.bsp':'spk/planets/de440s.bsp','moon_pa_de440_200625.bpc':'pck/moon_pa_de440_200625.bpc','moon_de440_250416.tf':'fk/satellites/moon_de440_250416.tf','pck00011.tpc':'pck/pck00011.tpc','earth_000101_270210_261114.bpc':'pck/earth_000101_270210_261114.bpc'}
def main():
 folder=ROOT/'data/raw/spice';folder.mkdir(parents=True,exist_ok=True);items=[]
 for name,relative in FILES.items():
  path=folder/name
  if not path.exists():
   tmp=path.with_suffix(path.suffix+'.part')
   try:
    with urllib.request.urlopen(BASE+relative,timeout=90) as response,tmp.open('wb') as output:
     while block:=response.read(1048576):output.write(block)
    tmp.replace(path)
   finally:tmp.unlink(missing_ok=True)
  digest=hashlib.sha256(path.read_bytes()).hexdigest()
  items.append({'name':name,'url':BASE+relative,'sha256':digest,'bytes':path.stat().st_size})
  print(name,path.stat().st_size,flush=True)
 manifest={'source':'NASA/JPL NAIF','retrieved_at':datetime.now(timezone.utc).isoformat(),'kernels':items}
 (ROOT/'data/prepared/spice_manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
if __name__=='__main__':main()
