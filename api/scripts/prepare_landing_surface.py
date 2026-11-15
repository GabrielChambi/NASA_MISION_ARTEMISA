"""Prepare finite, traceable landing-grid assessments from original NASA LOLA products.

Grid cells are 50 m wide. Slope maxima include every native 5 m pixel in a
cell plus a 15 m footprint buffer. Profiles use unexaggerated spherical geometry,
true local north/east, native local DEM + regional 80 m DEM, not the display mesh.
This is a sampled planning model, not a certified hazard map.
"""
from pathlib import Path
import hashlib
import json
import math
import numpy as np
import rasterio

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'data'
R = 1737400.0
GRID = 21
SPACING = 50.0
BUFFER = 15.0
# Same two-source/radial convention as the canonical scientific engine.
LOCAL_DIST = np.arange(10,22001,10,dtype=float)
REGIONAL_DIST = np.arange(250,250001,250,dtype=float)
DIST = np.concatenate((LOCAL_DIST,REGIONAL_DIST))
AZ = np.deg2rad(np.arange(360))[None, :, None]

def xy(lat, lon):
    rho = 2*R*np.tan((np.pi/2+lat)/2)
    return rho*np.sin(lon), rho*np.cos(lon)

def latlon(x, y):
    return 2*np.arctan2(np.hypot(x,y), 2*R)-np.pi/2, np.arctan2(x,y)

def read(path):
    with rasterio.open(path) as ds:
        a = ds.read(1, masked=True).filled(np.nan).astype(np.float32)
        return a, ds.transform

def sample(a, tr, x, y):
    col = np.floor((x-tr.c)/tr.a).astype(int)
    row = np.floor((y-tr.f)/tr.e).astype(int)
    inside = (row>=0)&(col>=0)&(row<a.shape[0])&(col<a.shape[1])
    values = np.full(x.shape, np.nan, dtype=np.float32)
    values[inside] = a[row[inside], col[inside]]
    return values

def prepare():
    catalog = json.loads((DATA/'catalog/sites.json').read_text(encoding='utf-8'))
    regional, rt = read(DATA/'raw/regional80m.tif')
    regions = []
    for site in catalog['sites']:
        print('Preparing', site['id'], flush=True)
        dem, tr = read(DATA/f"raw/{site['id']}.tif")
        slopes, _ = read(DATA/f"raw/{site['id']}-slp.tif")
        errors, _ = read(DATA/f"raw/{site['id']}-toterr.tif")
        centers = []
        cells = []
        cx, cy = site['point_pixel']['x_m'], site['point_pixel']['y_m']
        for iy in range(GRID):
            for ix in range(GRID):
                x, y = cx+(ix-GRID//2)*SPACING, cy+(iy-GRID//2)*SPACING
                lat, lon = latlon(x,y)
                row, col = int((y-tr.f)/tr.e), int((x-tr.c)/tr.a)
                b = int(math.ceil((SPACING/2+BUFFER)/5))
                sl = slopes[row-b:row+b+1,col-b:col+b+1]
                h = dem[row-3:row+4,col-3:col+4]
                er = errors[row-b:row+b+1,col-b:col+b+1]
                valid = bool(sl.size == (2*b+1)**2 and np.isfinite(sl).all() and np.isfinite(h).all() and np.isfinite(er).all())
                # Keep catalog coordinates exactly, so its existing Horizons records match.
                lat_deg, lon_deg = (site['latitude_deg'],site['longitude_deg']) if ix==iy==GRID//2 else (math.degrees(lat),math.degrees(lon))
                cell = {'id':f"{site['id']}:{iy}:{ix}",'ix':ix,'iy':iy,'x_m':x,'y_m':y,'latitude_deg':lat_deg,'longitude_deg':lon_deg,'known':valid,
                    'elevation_m':round(float(dem[row,col]),4) if valid else None,
                    'slope_deg':round(float(slopes[row,col]),4) if valid else None,
                    'max_slope_deg':round(float(np.max(sl)),4) if valid else None,
                    'relief_m':round(float(np.ptp(h)),4) if valid else None,
                    'height_uncertainty_m':round(float(np.max(er)),4) if valid else None}
                if ix==iy==GRID//2:
                    cell['elevation_m'] = site['elevation_m']
                centers.append((math.radians(lat_deg),math.radians(lon_deg),cell['elevation_m'] or 0))
                cells.append(cell)
        for begin in range(0,len(cells),3):
            batch = np.array(centers[begin:begin+3])
            lat,lon,eye = batch[:,0,None,None],batch[:,1,None,None],batch[:,2,None,None]+2
            delta = DIST[None,None,:]/R
            lat2 = np.arcsin(np.sin(lat)*np.cos(delta)+np.cos(lat)*np.sin(delta)*np.cos(AZ))
            lon2 = lon+np.arctan2(np.sin(AZ)*np.sin(delta)*np.cos(lat),np.cos(delta)-np.sin(lat)*np.sin(lat2))
            xx,yy = xy(lat2,lon2)
            near = sample(dem,tr,xx,yy)
            far = sample(regional,rt,xx,yy)
            # Keep radius + small terrain differences in float64. float32 at lunar
            # radius loses decimetres and can corrupt shallow horizon angles.
            height = np.where(np.arange(DIST.size)[None,None,:]<LOCAL_DIST.size,near,far).astype(np.float64)
            valid = np.isfinite(height)
            angle = np.degrees(np.arctan2((R+height)*np.cos(delta)-(R+eye),(R+height)*np.sin(delta)))
            angle[~valid] = -np.inf
            profiles = np.max(angle,axis=2)
            coverage = np.mean(np.isfinite(far[:,:,LOCAL_DIST.size:]),axis=2)
            for j,cell in enumerate(cells[begin:begin+3]):
                cell['horizon_deg'] = [round(float(v),3) if np.isfinite(v) else None for v in profiles[j]]
                cell['ray_coverage_fraction'] = round(float(np.min(coverage[j])),5)
                cell['known'] = cell['known'] and bool(np.isfinite(profiles[j]).all()) and bool((coverage[j]>=0.995).all())
        region = {'id':site['id'],'name':site['name'],'width':GRID,'height':GRID,'spacing_m':SPACING,'footprint_radius_m':BUFFER,
                  'observer_height_m':2,'center_cell_id':f"{site['id']}:{GRID//2}:{GRID//2}",'products':site['products'],'cells':cells}
        # Native-resolution visual patch, quantized to 0.1 m only for rendering.
        half = 550
        r0 = site['point_pixel']['row']-half//5
        c0 = site['point_pixel']['col']-half//5
        patch = dem[r0:r0+221,c0:c0+221]
        encoded = np.where(np.isfinite(patch),np.round((patch+1000)/0.1),65535)
        if ((encoded<0)|(encoded>65535)).any(): raise ValueError('Render quantization range exceeded.')
        region['render_grid'] = {'grid_size':221,'spacing_m':5,'scale_m':0.1,'offset_m':-1000,
            'xmin':cx-half,'ymax':cy+half,'heights':encoded.astype(int).ravel().tolist()}
        # Regional context from the same original local tile; 75 m display grid.
        cr = site['point_pixel']['row']
        cc = site['point_pixel']['col']
        context = dem[cr-1500:cr+1501:15,cc-1500:cc+1501:15]
        enc = np.where(np.isfinite(context),np.round((context+5000)/0.25),65535)
        if ((enc<0)|(enc>65535)).any(): raise ValueError('Context quantization range exceeded.')
        region['context_grid'] = {'grid_size':201,'spacing_m':75,'scale_m':0.25,'offset_m':-5000,
            'xmin':cx-7500,'ymax':cy+7500,'heights':enc.astype(int).ravel().tolist()}
        regions.append(region)
        print('Known cells',sum(c['known'] for c in cells),'terrain slope <=10',sum(c['known'] and c['max_slope_deg']<=10 for c in cells),flush=True)
    raw_paths = [DATA/f"raw/{sid}{suffix}.tif" for sid in ('site01','site04') for suffix in ('','-slp','-toterr')]+[DATA/'raw/regional80m.tif']
    output = {'schema_version':1,'status':'ok','source':'NASA LOLA PGDA product 78; regional 80 m DEM',
        'radius_m':R,'reference_frame':'NASA MOON_ME/DE421; Horizons MEAN_ME; independent frame validation pending',
        'regional_source_url':'https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF',
        'native_resolution_m':5,'regional_resolution_m':80,'horizon_azimuth_step_deg':1,'horizon_max_distance_m':250000,
        'horizon_distances_m':DIST.tolist(),'source_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in raw_paths},
        'limitations':['Finite 1 degree angular sampling; local 10 m radial samples plus regional 250 m samples, identical to the canonical engine; intervening obstacles can be missed.',
        'Slope maxima cover each 50 m cell plus a 15 m footprint buffer using original 5 m slope pixels.',
        'Relief is the elevation range in the central 35 m square; rocks smaller than 5 m are unresolved.',
        'Terrain height uncertainty is reported, not propagated into a certified safety probability.',
        'Green means evaluated model criteria meet margins; not an approved or guaranteed safe NASA landing site.',
        'NASA reports that about 90% of the 5 m DEM pixels are interpolated; pixel spacing is not independent measurement resolution.',
        'Slope uncertainty is not propagated; the displayed margins are screening choices, not statistical error bounds.',
        'Solar power, thermal state, RF link budget and lateral flight dynamics are not modeled.'],
        'regions':regions}
    path = DATA/'prepared/landing_surface.json'
    path.write_text(json.dumps(output,separators=(',',':'),allow_nan=False),encoding='utf-8')
    print(path, path.stat().st_size, flush=True)

if __name__=='__main__':
    prepare()
