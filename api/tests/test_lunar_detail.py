"""Visual-derivative checks independent of scientific landing classifications."""
import gzip
import hashlib
import json
import math
from pathlib import Path
import numpy as np
import pytest
import rasterio
from rasterio.io import MemoryFile
from rasterio.transform import from_origin

ROOT=Path(__file__).resolve().parents[2]
DIR=ROOT/'frontend/public/data/polar-detail'
MANIFEST=json.loads((DIR/'manifest.json').read_text(encoding='utf-8'))
SOURCE=ROOT/'data/raw/regional80m.tif'

def encoded(tile):
    compressed=(DIR/Path(tile['data_url']).name).read_bytes()
    return np.frombuffer(gzip.decompress(compressed),dtype='<u2').reshape((tile['grid_size'],)*2)

def test_visual_tiles_are_compact_real_nasa_derivatives():
    m=MANIFEST
    assert m['source_resolution_m']==80
    assert m['source_url']=='https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF'
    assert m['grid_size']==193
    assert m['tile_rows']==m['tile_cols']==8
    assert 395<m['display_spacing_m']<397
    assert m['scale_m']==1
    assert len(m['tiles'])==60
    total=sum(t['bytes'] for t in m['tiles'])+(DIR/Path(m['shading']['url']).name).stat().st_size
    assert total<4500000
    assert any('Visual derivatives only' in note for note in m['limitations'])
    assert any('fixed illustrative lighting' in note for note in m['limitations'])
    if SOURCE.exists():
        assert hashlib.sha256(SOURCE.read_bytes()).hexdigest()==m['source_sha256']

def test_all_tile_integrity_and_shapes_are_exact():
    for tile in MANIFEST['tiles']:
        compressed=(DIR/Path(tile['data_url']).name).read_bytes()
        assert len(compressed)==tile['bytes']
        assert hashlib.sha256(compressed).hexdigest()==tile['compressed_sha256']
        raw=gzip.decompress(compressed)
        assert len(raw)==tile['grid_size']**2*2
        assert hashlib.sha256(raw).hexdigest()==tile['height_sha256']
        a=np.frombuffer(raw,dtype='<u2')
        good=a!=MANIFEST['nodata']
        assert good.sum()==tile['valid_vertices']
        assert good.any()

def test_neighbouring_tiles_share_identical_nodes_without_seams():
    indexed={(t['row'],t['col']):t for t in MANIFEST['tiles']}
    comparisons=0
    for (row,col),tile in indexed.items():
        a=encoded(tile)
        if (row,col+1) in indexed:
            b=encoded(indexed[row,col+1])
            assert np.array_equal(a[:,-1],b[:,0])
            comparisons+=1
        if (row+1,col) in indexed:
            b=encoded(indexed[row+1,col])
            assert np.array_equal(a[-1,:],b[0,:])
            comparisons+=1
    assert comparisons>80

def test_interpolation_agrees_with_original_nasa_pixels_and_visual_quantization():
    if not SOURCE.exists():pytest.skip('The large original TIFF is intentionally excluded from Git.')
    tiles={(t['row'],t['col']):t for t in MANIFEST['tiles']}
    with rasterio.open(SOURCE) as ds:
        for key in [(3,3),(4,4),(2,5),(6,3)]:
            tile=tiles[key];a=encoded(tile);e=tile['sample_extent_m']
            for row,col in [(44,83),(96,96),(150,45)]:
                x=e['xmin']+col*tile['display_spacing_m']
                y=e['ymax']-row*tile['display_spacing_m']
                c=(x-ds.transform.c)/ds.transform.a-.5
                r=(y-ds.transform.f)/ds.transform.e-.5
                ci,ri=math.floor(c),math.floor(r)
                from rasterio.windows import Window
                native=ds.read(1,window=Window(ci,ri,2,2),masked=True)
                if np.ma.getmaskarray(native).any():
                    assert a[row,col]==MANIFEST['nodata']
                else:
                    u,v=c-ci,r-ri
                    expected=float(native[0,0])*(1-u)*(1-v)+float(native[0,1])*u*(1-v)+float(native[1,0])*(1-u)*v+float(native[1,1])*u*v
                    actual=float(a[row,col])*MANIFEST['scale_m']+MANIFEST['offset_m']
                    assert abs(actual-expected)<=.500001

def test_missing_data_stays_unknown_and_linear_plane_interpolation_is_exact():
    from api.scripts.prepare_lunar_detail import sample_nodes
    a=np.arange(36,dtype='float32').reshape(6,6)
    with MemoryFile() as mem:
        with mem.open(driver='GTiff',width=6,height=6,count=1,dtype='float32',transform=from_origin(0,6,1,1),nodata=-9999) as ds:
            ds.write(a,1)
            got=sample_nodes(ds,np.array([1.0,2.0,3.0]),np.array([5.0,4.0]))
            assert np.allclose(got,[[3.5,4.5,5.5],[9.5,10.5,11.5]])
            a[1,1]=-9999;ds.write(a,1)
            got=sample_nodes(ds,np.array([1.0]),np.array([5.0]))
            assert np.isnan(got[0,0])

def test_shading_is_a_georeferenced_nasa_relief_visual_not_photography():
    info=MANIFEST['shading']
    path=DIR/Path(info['url']).name
    assert hashlib.sha256(path.read_bytes()).hexdigest()==info['sha256']
    assert info['width']==info['height']==1536
    assert 395<info['pixel_spacing_m']<397
    assert info['sample_extent_m']=={'xmin':-304000.0,'ymin':-304000.0,'xmax':304000.0,'ymax':304000.0}
    assert 'no photographic albedo' in info['method']
    with rasterio.open(path) as ds:
        assert ds.count==1
        image=ds.read(1)
        assert image.shape==(1536,1536)
        assert image.dtype==np.uint8
        assert image.std()>10
    # Numerical analysis does not consume the lossy visual JPEG.
    assert info['url'].endswith('.jpg')
    assert all(t['data_url'].endswith('.u16.gz') for t in MANIFEST['tiles'])

def test_local_shading_tiles_have_matching_hashes_and_finer_spacing():
    import hashlib,json
    import rasterio
    root=Path(__file__).resolve().parents[2]/'frontend/public/data/polar-detail'
    manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
    for tile in manifest['tiles']:
        asset=root/Path(tile['image_url']).name
        assert hashlib.sha256(asset.read_bytes()).hexdigest()==tile['image_sha256']
        assert 80<tile['image_spacing_m']<tile['display_spacing_m']
        with rasterio.open(asset) as image:
            assert (image.width,image.height)==(513,513)
            assert image.count==1
