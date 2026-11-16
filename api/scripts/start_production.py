"""Validate the immutable scientific image and launch a single scientific worker."""
import os,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT))
from api.scripts.acquire_runtime_data import acquire
def main():
 raw_port=os.environ.get('PORT','8000')
 if not raw_port.isdigit() or not 1<=int(raw_port)<=65535:raise SystemExit('PORT must be an integer from 1 to 65535.')
 if not (ROOT/'frontend/dist/index.html').is_file():raise SystemExit('Production frontend has not been built.')
 if os.environ.get('LUNAR_REQUIRE_GEMINI','1')=='1' and not os.environ.get('GEMINI_API_KEY','').strip():raise SystemExit('Set GEMINI_API_KEY in the hosting secret settings before starting production.')
 acquire(verify_only=True)
 os.environ['LUNAR_DATA_VERIFIED']='1'
 import uvicorn
 uvicorn.run('api.app.production:app',host='0.0.0.0',port=int(raw_port),workers=1,proxy_headers=False)
if __name__=='__main__':main()
