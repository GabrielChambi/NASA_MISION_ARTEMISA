"""Reproducibly acquire NASA source rasters and generate small scientific derivatives.

Run from repository root with api/.venv/Scripts/python.exe api/scripts/acquire_nasa.py.
Raw DEMs remain in ignored data/raw; only compact derived data is versioned.
"""
from pathlib import Path
from datetime import datetime, timezone
import json
import hashlib
import math
import urllib.request
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.io import MemoryFile
from pyproj import CRS, Transformer, Geod
from concurrent.futures import ThreadPoolExecutor

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'data'
RADIUS = 1737400.0
BASE = 'https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/'
REGIONAL = 'https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF'
GEODETIC = CRS.from_proj4(f'+proj=longlat +R={RADIUS} +no_defs')
GEOD = Geod(a=RADIUS, b=RADIUS)
NOW = datetime.now(timezone.utc).isoformat()

def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, separators=(',', ':'), allow_nan=False), encoding='utf-8')

def download(url, path):
    if path.exists(): return
    print('Downloading', url, flush=True)
    partial=path.with_suffix(path.suffix+'.part')
    with urllib.request.urlopen(url, timeout=120) as response, partial.open('wb') as output:
        while chunk := response.read(1024 * 1024): output.write(chunk)
        expected=response.headers.get('Content-Length')
    if expected is not None and partial.stat().st_size!=int(expected): raise ValueError('Incomplete NASA source download')
    partial.replace(path)

def header_point(url, col, row):
    """Read GeoTIFF metadata and a single uncompressed strip pixel using HTTP ranges."""
    import struct
    with urllib.request.urlopen(urllib.request.Request(url, headers={'Range':'bytes=0-65535'}), timeout=45) as r:
        header = r.read(65536)
        total = int(r.headers.get('Content-Range', '/0').split('/')[-1])
    with MemoryFile(header) as mem, mem.open() as dataset:
        crs = dataset.crs.to_wkt()
        bounds = list(dataset.bounds)
        width, height = dataset.width, dataset.height
    count = struct.unpack('<H', header[8:10])[0]
    tags = {}
    for i in range(count):
        tag, typ, n, offset = struct.unpack('<HHII', header[10+i*12:22+i*12])
        if tag in (273,278):
            size = 4 if typ == 4 else 2
            data = header[18+i*12:22+i*12] if n*size <= 4 else header[offset:offset+n*size]
            tags[tag] = struct.unpack('<'+('I' if size==4 else 'H')*n, data[:n*size])
    strip = row // tags.get(278, (1,))[0]
    offset = tags[273][strip] + (row % tags.get(278, (1,))[0] * width + col)*4
    with urllib.request.urlopen(urllib.request.Request(url, headers={'Range':f'bytes={offset}-{offset+3}'}), timeout=45) as r:
        value = struct.unpack('<f', r.read(4))[0]
    return {'url':url,'status':'point_sample_verified','size_bytes':total,'width':width,'height':height,'crs_wkt':crs,'bounds_m':bounds,'point_value':round(value,4) if math.isfinite(value) else None,'retrieved_at':NOW}

def sample_dataset(ds, array, lngs, lats):
    transformer = Transformer.from_crs(GEODETIC, ds.crs, always_xy=True)
    x, y = transformer.transform(lngs, lats)
    cols = np.floor((np.asarray(x)-ds.transform.c)/ds.transform.a).astype(int)
    rows = np.floor((np.asarray(y)-ds.transform.f)/ds.transform.e).astype(int)
    valid = (cols>=0)&(cols<ds.width)&(rows>=0)&(rows<ds.height)
    result = np.full(np.shape(cols), np.nan)
    result[valid] = array[rows[valid], cols[valid]]
    return result

def main():
    raw = DATA/'raw'; raw.mkdir(parents=True, exist_ok=True)
    # Download independent raster products concurrently, never concurrent JPL requests.
    extra=[]
    for number in ['01','04']:
        for suffix in ['slp','toterr']:
            extra.append((BASE+f'Site{number}/Site{number}_final_adj_5mpp_{suffix}.tif',raw/f'site{number}-{suffix}.tif'))
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures=[pool.submit(download,url,path) for url,path in extra]
        for future in futures: future.result()
    sites, datasets, originals = [], [], {}
    for number, name in [('01','Connecting ridge'),('04','Shackleton rim')]:
        sid = 'site'+number
        url = BASE+f'Site{number}/Site{number}_final_adj_5mpp_surf.tif'
        path = raw/f'{sid}.tif'
        download(url,path)
        ds = rasterio.open(path)
        array = ds.read(1)
        if ds.nodata is not None and np.isfinite(ds.nodata): array=np.where(array==ds.nodata,np.nan,array)
        # A deterministic regional reference pixel, not a NASA-approved landing point.
        row, col = ds.height//2, ds.width//2
        if not np.isfinite(array[row,col]): raise ValueError('DEM reference pixel is nodata')
        x, y = ds.xy(row,col)
        longitude, latitude = Transformer.from_crs(ds.crs,GEODETIC,always_xy=True).transform(x,y)
        elevation = float(array[row,col])
        product = {'id':sid+'-elevation','name':f'Site{number} elevation','url':url,'status':'downloaded_verified','resolution_m':5,'size_bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'crs_wkt':ds.crs.to_wkt(),'bounds_m':list(ds.bounds),'retrieved_at':NOW}
        datasets.append(product)
        products = {'elevation':url}
        map_previews={}
        for suffix, kind in [('slp','slope'),('toterr','uncertainty')]:
            purl = BASE+f'Site{number}/Site{number}_final_adj_5mpp_{suffix}.tif'
            product_path=raw/f'{sid}-{suffix}.tif'
            with rasterio.open(product_path) as raster:
                if raster.crs!=ds.crs or raster.transform!=ds.transform or raster.width!=ds.width or raster.height!=ds.height:
                    raise ValueError(f'NASA {kind} raster is not aligned with elevation DEM')
                grid=raster.read(1,masked=True)
                value=float(grid[row,col])
                if not math.isfinite(value): raise ValueError('Invalid slope/uncertainty reference pixel')
                preview=raster.read(1,out_shape=(65,65),resampling=Resampling.bilinear,masked=True)
                if np.ma.getmaskarray(preview).any() or not np.isfinite(preview).all(): raise ValueError('Nodata in NASA map preview')
                map_previews[kind]=np.round(preview,4).flatten().tolist()
                metadata={'url':purl,'status':'downloaded_verified','size_bytes':product_path.stat().st_size,'sha256':hashlib.sha256(product_path.read_bytes()).hexdigest(),'width':raster.width,'height':raster.height,'crs_wkt':raster.crs.to_wkt(),'bounds_m':list(raster.bounds),'point_value':round(value,4),'retrieved_at':NOW,'alignment':'exact CRS, transform, width and height match elevation DEM','statistics':{'min':round(float(grid.min()),4),'max':round(float(grid.max()),4),'valid_pixels':int(grid.count())}}
            metadata.update(id=sid+'-'+kind,name=f'Site{number} {kind}',resolution_m=5)
            datasets.append(metadata); products[kind]=purl
        site={'id':sid,'name':name,'latitude_deg':round(latitude,8),'longitude_deg':round(longitude,8),'elevation_m':round(elevation,3),'dem_coverage':'verified','coordinate_quality':'NASA DEM reference pixel, not an approved landing site','reference_frame':'MOON_ME / DE421','radius_m':RADIUS,'source_url':'https://pgda.gsfc.nasa.gov/products/78','products':products,'point_pixel':{'row':row,'col':col,'x_m':x,'y_m':y},'dem_bounds_m':list(ds.bounds),'dem_resolution_m':5,'slope_deg':datasets[-2]['point_value'],'height_uncertainty_m':datasets[-1]['point_value']}
        sites.append(site)
        preview=ds.read(1,out_shape=(65,65),resampling=Resampling.bilinear)
        if not np.isfinite(preview).all(): raise ValueError('Terrain preview contains nodata')
        terrain={'site_id':sid,'source_url':url,'width':65,'height':65,'elevations_m':np.round(preview,2).flatten().tolist(),'extent_m':dict(zip(['xmin','ymin','xmax','ymax'],ds.bounds)),'observer_elevation_m':elevation,'resolution_m':(ds.bounds.right-ds.bounds.left)/65,'quality':'NASA LOLA 5m DEM, downsampled for display','warnings':['Preview is downsampled; not suitable for landing safety decisions.'],'crs_wkt':ds.crs.to_wkt(),'retrieved_at':NOW}
        terrain['slope_degrees']=map_previews['slope']
        terrain['height_uncertainty_m']=map_previews['uncertainty']
        save(DATA/'prepared'/f'{sid}-terrain.json',terrain)
        originals[sid]=(ds,array)
        print('Verified',sid,latitude,longitude,elevation,flush=True)
    save(DATA/'catalog'/'sites.json',{'status':'ok','sites':sites})
    save(DATA/'catalog'/'datasets.json',{'status':'ok','datasets':datasets})
    regional_path=raw/'regional80m.tif'
    download(REGIONAL,regional_path)
    regional=rasterio.open(regional_path); regional_array=regional.read(1)
    if regional.nodata is not None: regional_array=np.where(regional_array==regional.nodata,np.nan,regional_array)
    datasets.append({'id':'regional-80m','name':'Lunar south pole regional DEM','url':REGIONAL,'status':'downloaded_verified','resolution_m':80,'size_bytes':regional_path.stat().st_size,'sha256':hashlib.sha256(regional_path.read_bytes()).hexdigest(),'crs_wkt':regional.crs.to_wkt(),'bounds_m':list(regional.bounds),'retrieved_at':NOW})
    profiles={}
    for site in sites:
        sid=site['id']; ds,array=originals[sid]; profiles[sid]={}
        for height in [1,2,5]:
            samples=[]
            for az in range(360):
                # Dense local 5m source with 10m radial steps, plus distant 80m source.
                localdist=np.arange(10,22001,10,dtype=float)
                regdist=np.arange(250,250001,250,dtype=float)
                terrain_parts=[]
                for src,arr,dist in [(ds,array,localdist),(regional,regional_array,regdist)]:
                    lng,lat,_=GEOD.fwd(np.full(dist.size,site['longitude_deg']),np.full(dist.size,site['latitude_deg']),np.full(dist.size,az),dist)
                    elevations=sample_dataset(src,arr,lng,lat)
                    good=np.isfinite(elevations)
                    radial=RADIUS+elevations[good]
                    central=dist[good]/RADIUS
                    angles=np.degrees(np.arctan2(radial*np.cos(central)-(RADIUS+site['elevation_m']+height),radial*np.sin(central)))
                    terrain_parts.append((angles,dist[good]))
                angles=np.concatenate([p[0] for p in terrain_parts]); distances=np.concatenate([p[1] for p in terrain_parts])
                if not len(angles): raise ValueError('No terrain horizon data')
                index=int(np.argmax(angles))
                samples.append({'azimuth_deg':az,'elevation_deg':round(float(angles[index]),5),'distance_m':float(distances[index])})
            profiles[sid][str(height)]={'observer_height_m':height,'quality':'partial','samples':samples,'warnings':['Ray sampling: local 10m radial spacing from 5m DEM; regional 250m spacing from 80m DEM; finite 250km range.','MOON_ME/DE421 terrain; Horizons lunar mean-Earth topocentric observer. Not independently SPICE cross-validated.','No propagation of elevation uncertainty; distant coverage and subpixel obstacles may be missed.']}
        print('Horizon profiles prepared',sid,flush=True)
    save(DATA/'prepared'/'horizon_profiles.json',{'source':'NASA LOLA','source_url':'https://pgda.gsfc.nasa.gov/products/78','retrieved_at':NOW,'profiles':profiles})
    save(DATA/'catalog'/'datasets.json',{'status':'ok','datasets':datasets})

if __name__=='__main__': main()
