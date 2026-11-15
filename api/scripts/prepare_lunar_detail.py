"""Prepare sharper visual derivatives from the original NASA LOLA 80 m GeoTIFF.

The visual tiles and shaded-relief texture never replace the scientific raster.
Tile border nodes are shared; no noise, craters or synthetic elevation is added.
"""
from pathlib import Path
import gzip
import hashlib
import json
import math
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.io import MemoryFile

ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'data/raw/regional80m.tif'
OUT=ROOT/'frontend/public/data/polar-detail'
SOURCE_URL='https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF'
RADIUS=1737400.0
TILES=8
GRID=193
SCALE=1.0
OFFSET=-16000.0
NODATA=65535
TEXTURE_GRID=1536

def sha(data):
    return hashlib.sha256(data).hexdigest()

def sample_nodes(dataset,xs,ys):
    """Bilinear source sampling at explicit map coordinates, preserving nodata."""
    x,y=np.meshgrid(xs,ys)
    cf=(x-dataset.transform.c)/dataset.transform.a-.5
    rf=(y-dataset.transform.f)/dataset.transform.e-.5
    # Input node coordinates are inside the outermost NASA pixel centers.
    cf=np.clip(cf,0,dataset.width-1)
    rf=np.clip(rf,0,dataset.height-1)
    c0=np.minimum(np.floor(cf).astype(int),dataset.width-2)
    r0=np.minimum(np.floor(rf).astype(int),dataset.height-2)
    cx,rx=int(c0.min()),int(r0.min())
    cw,rh=int(c0.max()-cx+2),int(r0.max()-rx+2)
    from rasterio.windows import Window
    raw=dataset.read(1,window=Window(cx,rx,cw,rh),masked=True).filled(np.nan).astype(np.float64)
    u,v=cf-c0,rf-r0
    c,r=c0-cx,r0-rx
    a,b,cc,d=raw[r,c],raw[r,c+1],raw[r+1,c],raw[r+1,c+1]
    # A missing neighbour remains unknown rather than turning into a zero-height edge.
    valid=np.isfinite(a)&np.isfinite(b)&np.isfinite(cc)&np.isfinite(d)
    values=(1-u)*(1-v)*a+u*(1-v)*b+(1-u)*v*cc+u*v*d
    # Preserve NASA's finite circular data footprint.
    return np.where(valid,values,np.nan)

def encode(values):
    valid=np.isfinite(values)
    if not valid.any():return None
    encoded=np.full(values.shape,NODATA,dtype='<u2')
    numbers=np.rint((values[valid]-OFFSET)/SCALE)
    if np.any(numbers<0) or np.any(numbers>=NODATA):
        raise ValueError('NASA elevation does not fit the documented visual encoding.')
    encoded[valid]=numbers.astype('<u2')
    return encoded

def build_shading(dataset):
    """Grayscale visual relief, from resampled NASA heights and true map spacing.

    This is fixed illustrative relief lighting, not a date-specific Sun simulation.
    It contains no photographic albedo or invented crater/rock texture.
    """
    h=dataset.read(1,out_shape=(TEXTURE_GRID,TEXTURE_GRID),masked=True,resampling=Resampling.bilinear).filled(np.nan).astype(np.float64)
    pitch=(dataset.bounds.right-dataset.bounds.left)/TEXTURE_GRID
    dy,dx=np.gradient(h,pitch,pitch)
    valid=np.isfinite(h)&np.isfinite(dx)&np.isfinite(dy)
    x=dataset.bounds.left+(np.arange(TEXTURE_GRID)+.5)*pitch
    y=dataset.bounds.top-(np.arange(TEXTURE_GRID)+.5)*pitch
    xx,yy=np.meshgrid(x,y)
    scale=1+(xx*xx+yy*yy)/(4*RADIUS*RADIUS)
    dx*=scale;dy*=scale
    # In image coordinates +row is -north. Illuminate from the image upper left.
    direction=np.array([-.55,-.45,.70]);direction/=np.linalg.norm(direction)
    norm=np.sqrt(dx*dx+dy*dy+1)
    diffuse=(-dx*direction[0]-dy*direction[1]+direction[2])/norm
    # Enough ambient light to keep basin structure visible; measured gradients are unchanged.
    shade=np.clip(75+178*np.clip(diffuse,0,1),0,255)
    gray=np.where(valid,np.rint(shade),0).astype('uint8')
    with MemoryFile() as memory:
        with memory.open(driver='JPEG',width=TEXTURE_GRID,height=TEXTURE_GRID,count=1,dtype='uint8',quality=92) as image:
            image.write(gray,1)
        image_bytes=memory.read()
    return image_bytes,int(valid.sum())

def build_tile_shading(dataset,left,right,bottom,top):
    side=513
    values=sample_nodes(dataset,np.linspace(left,right,side),np.linspace(top,bottom,side))
    pitch=(right-left)/(side-1)
    dy,dx=np.gradient(values,pitch,pitch)
    valid=np.isfinite(values)&np.isfinite(dx)&np.isfinite(dy)
    direction=np.array([-.55,-.45,.70]);direction/=np.linalg.norm(direction)
    diffuse=(-dx*direction[0]-dy*direction[1]+direction[2])/np.sqrt(dx*dx+dy*dy+1)
    gray=np.where(valid,np.rint(np.clip(75+178*np.clip(diffuse,0,1),0,255)),0).astype('uint8')
    with MemoryFile() as memory:
        with memory.open(driver='JPEG',width=side,height=side,count=1,dtype='uint8',quality=72) as image:image.write(gray,1)
        return memory.read()


def prepare():
    if not SOURCE.exists():
        raise FileNotFoundError('Download the original NASA DEM with api/scripts/prepare_polar_atlas.py first.')
    OUT.mkdir(parents=True,exist_ok=True)
    tiles=[]
    with rasterio.open(SOURCE) as dataset:
        if dataset.width!=7600 or dataset.height!=7600 or dataset.transform.a!=80:
            raise ValueError('Unexpected NASA source raster dimensions/resolution.')
        xmin=dataset.bounds.left+40
        xmax=dataset.bounds.right-40
        ymax=dataset.bounds.top-40
        ymin=dataset.bounds.bottom+40
        span=(xmax-xmin)/TILES
        for row in range(TILES):
            top=ymax-row*span;bottom=top-span
            ys=np.linspace(top,bottom,GRID)
            for col in range(TILES):
                left=xmin+col*span;right=left+span
                values=sample_nodes(dataset,np.linspace(left,right,GRID),ys)
                xx,yy=np.meshgrid(np.linspace(left,right,GRID),ys)
                cap_radius=2*RADIUS*math.tan(math.radians(5))
                values=np.where(xx*xx+yy*yy<=cap_radius*cap_radius,values,np.nan)
                encoded=encode(values)
                if encoded is None:
                    stale=OUT/f'tile-{row}-{col}.u16.gz'
                    if stale.exists():stale.unlink()
                    continue
                binary=encoded.tobytes()
                compressed=gzip.compress(binary,compresslevel=9,mtime=0)
                filename=f'tile-{row}-{col}.u16.gz'
                (OUT/filename).write_bytes(compressed)
                valid=np.isfinite(values)
                image=build_tile_shading(dataset,left,right,bottom,top)
                image_name=f'tile-{row}-{col}.jpg'
                (OUT/image_name).write_bytes(image)
                tiles.append({'image_url':'/data/polar-detail/'+image_name,'image_sha256':hashlib.sha256(image).hexdigest(),
                    'image_spacing_m':span/512,'id':f'{row}:{col}','row':row,'col':col,'grid_size':GRID,'display_spacing_m':span/(GRID-1),
                    'sample_extent_m':{'xmin':left,'ymin':bottom,'xmax':right,'ymax':top},
                    'data_url':'/data/polar-detail/'+filename,'compression':'gzip','byte_order':'little-endian',
                    'height_sha256':sha(binary),'compressed_sha256':sha(compressed),'bytes':len(compressed),
                    'valid_vertices':int(valid.sum()),'min_elevation_m':round(float(values[valid].min()),3),
                    'max_elevation_m':round(float(values[valid].max()),3)})
        shading,valid_pixels=build_shading(dataset)
        (OUT/'nasa-relief.jpg').write_bytes(shading)
        old_png=OUT/'nasa-relief.png'
        if old_png.exists():old_png.unlink()
        manifest={'version':1,'title':'NASA LOLA detail tiles and illustrative shaded relief',
            'source_url':SOURCE_URL,'source_sha256':sha(SOURCE.read_bytes()),'source_resolution_m':80,
            'radius_m':RADIUS,'tile_rows':TILES,'tile_cols':TILES,'grid_size':GRID,'scale_m':SCALE,'offset_m':OFFSET,'nodata':NODATA,
            'sample_extent_m':{'xmin':xmin,'ymin':ymin,'xmax':xmax,'ymax':ymax},
            'display_spacing_m':span/(GRID-1),'tiles':tiles,
            'shading':{'url':'/data/polar-detail/nasa-relief.jpg','sha256':sha(shading),'width':TEXTURE_GRID,'height':TEXTURE_GRID,
                'sample_extent_m':{'xmin':float(dataset.bounds.left),'ymin':float(dataset.bounds.bottom),'xmax':float(dataset.bounds.right),'ymax':float(dataset.bounds.top)},
                'pixel_spacing_m':(dataset.bounds.right-dataset.bounds.left)/TEXTURE_GRID,
                'valid_pixels':valid_pixels,'channels':'grayscale; JPEG quality 92; outside-data pixels black','method':'Bilinear NASA DEM, gradient-derived Lambertian relief with fixed upper-left visual light; no photographic albedo.'},
            'limitations':['Visual derivatives only. Slope, horizon and landing assessments continue to use their original scientific data.',
                'Source spacing is 80 m; zoom geometry is downsampled to approximately 396 m; neither resolves rocks or landing-footprint hazards.',
                'Shaded-relief texture is fixed illustrative lighting, not solar illumination at a selected date.',
                'Unknown source samples remain nodata; no invented terrain or crater texture is introduced.']}
    (OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')
    print(json.dumps({'tiles':len(tiles),'compressed_tile_bytes':sum(t['bytes'] for t in tiles),'shading_bytes':len(shading),'spacing_m':manifest['display_spacing_m'],'source_sha256':manifest['source_sha256']}))

if __name__=='__main__':
    prepare()
