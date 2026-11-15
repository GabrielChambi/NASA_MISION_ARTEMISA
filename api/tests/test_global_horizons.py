"""Independent checks for full-cap regional horizon preparation."""
from pathlib import Path
import gzip
import hashlib
import json
import math
import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin
from pyproj import Geod
from api.scripts.prepare_global_horizons import (
    RADIUS,OBSERVER_HEIGHT,QUANTIZATION,DISTANCES,AZIMUTHS,
    destination,project,sample_native,ray_angles,compute_batch,
)
ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'data/raw/regional80m.tif'
PATH=ROOT/'data/prepared/global_horizons.json'

def test_true_local_azimuth_matches_independent_spherical_geodesy():
    geod=Geod(a=RADIUS,b=RADIUS)
    for lat,lon in [(-89.7,-160),(-82.5,55),(-88.4,170)]:
        for az in (0,45,90,180,270,355):
            distance=np.array([80,2000,20000,250000],dtype=float)
            p,l=destination(lat,lon,math.radians(az),distance)
            expected_lon,expected_lat,_=geod.fwd(np.full(4,lon),np.full(4,lat),np.full(4,az),distance)
            np.testing.assert_allclose(np.rad2deg(p),expected_lat,atol=1e-9)
            longitude_delta=(np.rad2deg(l)-expected_lon+180)%360-180
            np.testing.assert_allclose(longitude_delta,0,atol=1e-9)

def test_flat_spherical_moon_does_not_block_positive_elevation_ray():
    transform=from_origin(-300500,300500,1000,1000)
    terrain=np.zeros((601,601),dtype=np.float32)
    cells=[{'latitude_deg':-90,'longitude_deg':-160,'elevation_m':0}]
    profiles,coverage,valid_to=compute_batch(cells,terrain,transform)
    assert profiles[0] is not None
    assert all(value*QUANTIZATION<0 for value in profiles[0])
    assert all(.1>value*QUANTIZATION for value in profiles[0])
    assert coverage==[1000]
    assert valid_to==[250000]
    dip=-math.degrees(math.acos(RADIUS/(RADIUS+OBSERVER_HEIGHT)))
    assert max(profiles[0])*QUANTIZATION>=dip
    assert max(profiles[0])*QUANTIZATION<dip+QUANTIZATION+.001

def test_missing_nearby_terrain_remains_unknown_not_flat():
    transform=from_origin(-300500,300500,1000,1000)
    terrain=np.zeros((601,601),dtype=np.float32)
    terrain[299:302,299:302]=np.nan
    profiles,coverage,valid_to=compute_batch(
        [{'latitude_deg':-90,'longitude_deg':0,'elevation_m':0}],terrain,transform)
    assert profiles==[None]
    assert coverage[0]<1000

def test_spherical_height_geometry_excludes_nodata_and_uses_correct_curvature_sign():
    distance=np.array([1000,10000,100000],dtype=float)
    angles=ray_angles([0,0,0],distance,0)
    expected=np.rad2deg(np.arctan2(RADIUS*np.cos(distance/RADIUS)-(RADIUS+2),RADIUS*np.sin(distance/RADIUS)))
    np.testing.assert_allclose(angles,expected,atol=1e-12)
    assert np.isnan(ray_angles([np.nan],[1000],0)[0])
    assert ray_angles([100],[1000],0)[0]>5

def test_manifest_has_one_separate_profile_per_known_cap_cell_and_small_transport():
    data=json.loads(PATH.read_text(encoding='utf-8'))
    polar=json.loads((ROOT/'data/prepared/polar_screening.json').read_text(encoding='utf-8'))
    known=[c for c in polar['cells'] if c['known']]
    assert data['cell_ids']==[c['id'] for c in known]
    assert len(data['profiles_int'])==12892
    assert len(set(data['cell_ids']))==12892
    assert data['azimuth_step_deg']==5
    assert data['quantization_deg']==.05
    assert data['observer_height_m']==2
    assert data['quality']=='sampled-regional-partial'
    assert len(gzip.compress(PATH.read_bytes()))<1_000_000
    assert data['known_profile_count']==sum(p is not None for p in data['profiles_int'])
    assert 12000<data['known_profile_count']<=12892
    assert data['profile_encoding']=='delta'
    for profile in data['profiles_int']:
        if profile is not None:
            assert len(profile)==72
            assert all(isinstance(v,int) for v in profile)
            assert np.all(np.abs(np.cumsum(profile))<=1800)
    assert all(0<=c<=1000 for c in data['ray_coverage_min_per_mille'])
    assert all(0<=v<=250000 for v in data['valid_to_min_m'])
    assert any('lower-bound' in warning for warning in data['limitations'])

def test_source_hash_and_single_ray_agree_with_original_tiff():
    if not SOURCE.exists():pytest.skip('Original large source is excluded from Git.')
    data=json.loads(PATH.read_text(encoding='utf-8'))
    assert hashlib.sha256(SOURCE.read_bytes()).hexdigest()==data['source_sha256']
    polar=json.loads((ROOT/'data/prepared/polar_screening.json').read_text(encoding='utf-8'))
    cell=next(c for c in polar['cells'] if c['id']=='polar:64:64')
    p,l=destination(cell['latitude_deg'],cell['longitude_deg'],math.radians(75),DISTANCES)
    x,y=project(p,l)
    with rasterio.open(SOURCE) as dataset:
        values=np.array([float(v[0]) if not np.ma.is_masked(v[0]) else np.nan for v in dataset.sample(zip(x,y),masked=True)])
    good=np.isfinite(values)
    radius=RADIUS+values[good]
    d=DISTANCES[good]
    expected=float(np.max(np.rad2deg(np.arctan2(
        radius*np.cos(d/RADIUS)-(RADIUS+cell['elevation_m']+2),radius*np.sin(d/RADIUS)))))
    index=data['cell_ids'].index(cell['id'])
    stored=int(np.cumsum(data['profiles_int'][index])[15])*data['quantization_deg']
    assert stored>=expected-1e-10
    assert stored-expected<=data['quantization_deg']+1e-10
