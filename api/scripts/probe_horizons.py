"""Inspect live NASA response format at a clearly illustrative probe coordinate."""
import httpx
import json
from pathlib import Path

p = dict(format='json', COMMAND="'10'", OBJ_DATA="'NO'", MAKE_EPHEM="'YES'", EPHEM_TYPE="'OBSERVER'", CENTER="'coord@301'", COORD_TYPE="'GEODETIC'", SITE_COORD="'0,-89,0'", START_TIME="'2026-12-01 00:00'", STOP_TIME="'2026-12-01 03:00'", STEP_SIZE="'60 m'", QUANTITIES="'4'", TIME_TYPE="'UT'", CSV_FORMAT="'YES'", TIME_DIGITS="'SECONDS'")
r = httpx.get('https://ssd.jpl.nasa.gov/api/horizons.api', params=p, timeout=60)
r.raise_for_status()
d = r.json()
Path('data/prepared/format-probe.json').write_text(json.dumps({'probe_only':True,'query_url':str(r.url),'response':d}), encoding='utf-8')
print(d.get('error',''))
t=d.get('result','')
print(t[:4200])
print(t[t.find('$$SOE'):t.find('$$EOE')+5])
