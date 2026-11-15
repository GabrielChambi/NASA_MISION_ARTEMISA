"""Regional south-pole terrain screening; no implicit landing or visibility claim."""
from functools import lru_cache
import json
import math
from fastapi import APIRouter
from .core.sites import DATA

router = APIRouter(prefix='/api/polar')

def validate_surface(data):
    if data.get('schema_version') != 1 or data.get('analysis_type') != 'regional-terrain-screening':
        raise ValueError('Invalid NASA polar screening schema.')
    n = data.get('grid_size')
    if not isinstance(n, int) or not 3 <= n <= 257 or len(data.get('cells', [])) != n*n:
        raise ValueError('Incomplete NASA polar screening grid.')
    for index, cell in enumerate(data['cells']):
        if cell['row'] != index//n or cell['col'] != index%n:
            raise ValueError('NASA polar cells are not row-major.')
        if cell['known']:
            fields = ['elevation_m','regional_slope_deg','median_slope_deg','max_slope_deg','roughness_m','relief_m','coverage_fraction']
            if any(not isinstance(cell.get(k),(int,float)) or not math.isfinite(cell[k]) for k in fields):
                raise ValueError('Known NASA regional cell contains missing or nonfinite values.')
            if not -90 <= cell['latitude_deg'] <= -80 or cell['coverage_fraction'] < .95:
                raise ValueError('Known NASA regional cell has incomplete coverage.')
    return data

@lru_cache(maxsize=1)
def surface():
    path = DATA/'prepared/polar_screening.json'
    if not path.exists():
        raise FileNotFoundError('Prepare NASA polar screening with api/scripts/prepare_polar_screening.py.')
    return validate_surface(json.loads(path.read_text(encoding='utf-8')))

@router.get('/surface')
def surface_endpoint():
    return surface()
