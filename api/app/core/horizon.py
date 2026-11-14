"""Shared geometric horizon service. Flat is explicit; terrain never silently falls back."""
import json
import math
from functools import lru_cache
from .sites import DATA

class HorizonUnavailable(ValueError): pass

def geometric_horizon(elevations_m, distances_m, observer_elevation_m, observer_height_m, radius_m=1737400):
    """Spherical line-of-sight elevation, excluding nodata and nonpositive distances."""
    import numpy as np
    elevation=np.asarray(elevations_m,dtype=float)
    distance=np.asarray(distances_m,dtype=float)
    valid=np.isfinite(elevation)&np.isfinite(distance)&(distance>0)
    if not valid.any(): raise HorizonUnavailable('No valid terrain samples along horizon ray.')
    radius=radius_m+elevation[valid]
    angle=distance[valid]/radius_m
    return float(np.max(np.degrees(np.arctan2(radius*np.cos(angle)-(radius_m+observer_elevation_m+observer_height_m),radius*np.sin(angle)))))

@lru_cache(maxsize=1)
def profiles():
    path = DATA/'prepared'/'horizon_profiles.json'
    if not path.exists(): raise HorizonUnavailable('NASA terrain horizon profiles have not been prepared.')
    return json.loads(path.read_text(encoding='utf-8'))

def circular_interpolate(values, azimuth_deg):
    if not values or any(not math.isfinite(v) for v in values): raise HorizonUnavailable('Invalid or nodata horizon profile.')
    position = (azimuth_deg % 360) * len(values)/360
    lower = math.floor(position)
    fraction = position-lower
    return values[lower % len(values)]*(1-fraction)+values[(lower+1) % len(values)]*fraction

def horizon_at(site_id, azimuth_deg, observer_height_m=1, mode='terrain'):
    if mode == 'flat': return {'elevation_deg':0.0,'quality':'approximation','warnings':['Flat horizon approximation: terrain obstruction and horizon dip are excluded.']}
    if mode != 'terrain': raise HorizonUnavailable('Unsupported horizon mode.')
    if observer_height_m not in (1,2,5): raise HorizonUnavailable('Prepared terrain profiles support observer heights of 1, 2 or 5 m only.')
    profile = profiles().get('profiles',{}).get(site_id,{}).get(str(int(observer_height_m)))
    if not profile: raise HorizonUnavailable('No NASA terrain profile available for this site and observer height.')
    return {'elevation_deg':circular_interpolate([p['elevation_deg'] for p in profile['samples']],azimuth_deg),'quality':profile['quality'],'warnings':profile['warnings']}
