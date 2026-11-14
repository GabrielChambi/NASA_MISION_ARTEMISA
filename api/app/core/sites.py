from pathlib import Path
import json

DATA = Path(__file__).resolve().parents[3] / 'data'

def catalog():
    path = DATA / 'catalog' / 'sites.json'
    if not path.exists(): raise FileNotFoundError('NASA site catalog is not prepared. Run api/scripts/acquire_nasa.py.')
    return json.loads(path.read_text(encoding='utf-8'))

def get_site(site_id):
    return next((site for site in catalog()['sites'] if site['id'] == site_id), None)

def datasets():
    path = DATA / 'catalog' / 'datasets.json'
    if not path.exists(): raise FileNotFoundError('NASA product inventory is not prepared.')
    return json.loads(path.read_text(encoding='utf-8'))
