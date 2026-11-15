"""Prepare separate sampled regional horizons for every known polar screening cell.

Source: original NASA LOLA 80 m south-polar DEM. No reference-point horizon is
transplanted across the cap. These finite 5-degree / variable radial profiles
are regional planning proxies, not a landing-hazard or RF guarantee.
"""
from pathlib import Path
import argparse
import gzip
import hashlib
import json
import math
import time
import numpy as np
import rasterio

ROOT=Path(__file__).resolve().parents[2]
DATA=ROOT/'data'
RADIUS=1737400.0
OBSERVER_HEIGHT=2.0
AZ_STEP=5
QUANTIZATION=.05
DISTANCES=np.concatenate((np.arange(80,2001,80,dtype=np.float64),
                          np.arange(2250,20001,250,dtype=np.float64),
                          np.arange(21000,250001,1000,dtype=np.float64)))
AZIMUTHS=np.deg2rad(np.arange(0,360,AZ_STEP,dtype=np.float64))
SOURCE_URL='https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF'

def destination(latitude_deg,longitude_deg,azimuth_rad,distances_m,radius=RADIUS):
    """Great-circle destination from true local north/east, angles in radians."""
    lat=np.deg2rad(np.asarray(latitude_deg,dtype=np.float64))
    lon=np.deg2rad(np.asarray(longitude_deg,dtype=np.float64))
    arc=np.asarray(distances_m,dtype=np.float64)/radius
    az=np.asarray(azimuth_rad,dtype=np.float64)
    lat2=np.arcsin(np.clip(np.sin(lat)*np.cos(arc)+np.cos(lat)*np.sin(arc)*np.cos(az),-1,1))
    lon2=lon+np.arctan2(np.sin(az)*np.sin(arc)*np.cos(lat),np.cos(arc)-np.sin(lat)*np.sin(lat2))
    return lat2,lon2

def project(latitude_rad,longitude_rad,radius=RADIUS):
    rho=2*radius*np.tan((np.pi/2+latitude_rad)/2)
    return rho*np.sin(longitude_rad),rho*np.cos(longitude_rad)

def sample_native(array,transform,x,y):
    col=np.floor((x-transform.c)/transform.a).astype(np.int32)
    row=np.floor((y-transform.f)/transform.e).astype(np.int32)
    good=(row>=0)&(col>=0)&(row<array.shape[0])&(col<array.shape[1])
    values=np.full(x.shape,np.nan,dtype=np.float64)
    values[good]=array[row[good],col[good]]
    return values

def ray_angles(elevations,distances,observer_elevation,observer_height=OBSERVER_HEIGHT,radius=RADIUS):
    """Spherical geometry in float64; nodata angles remain NaN."""
    h=np.asarray(elevations,dtype=np.float64)
    d=np.asarray(distances,dtype=np.float64)
    eye=np.asarray(observer_elevation,dtype=np.float64)+observer_height
    angle=d/radius
    return np.degrees(np.arctan2((radius+h)*np.cos(angle)-(radius+eye),(radius+h)*np.sin(angle)))

def compute_batch(cells,array,transform):
    lat=np.array([c['latitude_deg'] for c in cells],dtype=np.float64)[:,None,None]
    lon=np.array([c['longitude_deg'] for c in cells],dtype=np.float64)[:,None,None]
    eye=np.array([c['elevation_m'] for c in cells],dtype=np.float64)[:,None,None]
    lat2,lon2=destination(lat,lon,AZIMUTHS[None,:,None],DISTANCES[None,None,:])
    x,y=project(lat2,lon2)
    heights=sample_native(array,transform,x,y)
    valid=np.isfinite(heights)
    angles=ray_angles(heights,DISTANCES[None,None,:],eye)
    angles[~valid]=-np.inf
    maximum=np.max(angles,axis=2)
    # Quantize upward, conservatively preserving obstructions at the bin width.
    quantized=np.ceil(maximum/QUANTIZATION-1e-12)
    near_count=int(np.count_nonzero(DISTANCES<=2000))
    near_complete=valid[:,:,:near_count].all(axis=(1,2))
    profiles=[]
    for i in range(len(cells)):
        profiles.append(quantized[i].astype(np.int16).tolist() if near_complete[i] and np.isfinite(maximum[i]).all() else None)
    coverage=np.min(np.mean(valid,axis=2),axis=1)
    valid_to=np.min(np.max(np.where(valid,DISTANCES[None,None,:],0),axis=2),axis=1)
    return profiles,np.round(coverage*1000).astype(int).tolist(),valid_to.astype(int).tolist()

def prepare(batch_size=16):
    began=time.perf_counter()
    source=DATA/'raw/regional80m.tif'
    if not source.exists():raise FileNotFoundError('Acquire the original NASA regional DEM first.')
    catalog=json.loads((DATA/'prepared/polar_screening.json').read_text(encoding='utf-8'))
    source_sha=hashlib.sha256(source.read_bytes()).hexdigest()
    if source_sha!=catalog['source_sha256']:raise ValueError('NASA source does not match the regional catalog.')
    cells=[c for c in catalog['cells'] if c['known']]
    with rasterio.open(source) as ds:
        if ds.width!=7600 or ds.height!=7600 or ds.transform.a!=80 or ds.transform.e!=-80:
            raise ValueError('Unexpected NASA source shape/resolution.')
        array=ds.read(1,masked=True).filled(np.nan).astype(np.float32)
        transform=ds.transform
    profiles=[];coverage=[];valid_to=[]
    for begin in range(0,len(cells),batch_size):
        pp,cc,vv=compute_batch(cells[begin:begin+batch_size],array,transform)
        profiles.extend(pp);coverage.extend(cc);valid_to.extend(vv)
        if begin%1024==0 or begin+batch_size>=len(cells):
            print(f'{min(begin+batch_size,len(cells))}/{len(cells)} cells; {time.perf_counter()-began:.1f} seconds',flush=True)
    output={
        'version':1,'status':'ok','quality':'sampled-regional-partial',
        'source_url':SOURCE_URL,'source_sha256':source_sha,
        'radius_m':RADIUS,'source_resolution_m':80,'observer_height_m':OBSERVER_HEIGHT,
        'azimuth_step_deg':AZ_STEP,'quantization_deg':QUANTIZATION,'quantization':'ceil toward obstruction',
        'near_coverage_required_m':2000,'max_distance_m':250000,
        'radial_distances_m':DISTANCES.astype(int).tolist(),
        'cell_ids':[c['id'] for c in cells],'profile_encoding':'delta',
        'profiles_int':[[p[0]]+[p[i]-p[i-1] for i in range(1,len(p))] if p is not None else None for p in profiles],
        'ray_coverage_min_per_mille':coverage,'valid_to_min_m':valid_to,
        'known_profile_count':sum(p is not None for p in profiles),
        'limitations':[
            'Every cell has its own horizon from the original regional DEM; no central horizon is reused.',
            'Regional 80 m terrain and 5 degree azimuth sampling cannot certify a landing footprint or subpixel hazards.',
            'A null profile means missing near-field terrain in at least one direction; never replace it with a flat horizon.',
            'Non-null horizons are lower-bound finite sampled obstructions, not proof of complete distant coverage.',
            'Coverage varies by cell and azimuth; rays leaving the 80S cap are not extrapolated beyond the source.',
            'Radial samples are 80 m to 2 km, 250 m to 20 km and 1 km to 250 km; intervening obstacles can be missed.',
            'Horizon bins are rounded upward by at most 0.05 degrees; angular/radial DEM uncertainty is not fully propagated.',
            'Lunar MOON_ME/DE421 source; independent SPICE frame validation remains pending.',
            'Visibility is geometric apparent-center clearance only, not electrical energy or a guaranteed RF link.'
        ]}
    path=DATA/'prepared/global_horizons.json'
    raw=json.dumps(output,separators=(',',':'),allow_nan=False).encode()
    path.write_bytes(raw)
    print(json.dumps({'path':str(path),'cells':len(cells),'known':output['known_profile_count'],
        'raw_bytes':len(raw),'gzip_bytes':len(gzip.compress(raw)),'elapsed_seconds':round(time.perf_counter()-began,2)}),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--batch-size',type=int,default=16)
    args=parser.parse_args()
    if not 1<=args.batch_size<=128:raise ValueError('Use a batch size from 1 to 128.')
    prepare(args.batch_size)
