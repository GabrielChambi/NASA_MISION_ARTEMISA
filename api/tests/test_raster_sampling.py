"""Original pixel values and nodata must survive bounded-memory access."""
import numpy as np
import rasterio
from rasterio.transform import from_origin
from api.app.raster_sampling import RasterPixels
from api.app.native_terrain import nearest

def test_window_sampler_matches_original_float32_pixels_and_nodata(tmp_path):
    path=tmp_path/'source.tif'
    original=np.arange(515*520,dtype=np.float32).reshape(515,520)/np.float32(7)
    original[260,260]=-9999
    tr=from_origin(-200,300,5,5)
    with rasterio.open(path,'w',driver='GTiff',width=520,height=515,count=1,dtype='float32',transform=tr,nodata=-9999) as ds:ds.write(original,1)
    pixels=RasterPixels(path)
    rng=np.random.default_rng(713)
    rows=np.r_[0,260,514,rng.integers(0,515,size=2000)]
    cols=np.r_[0,260,519,rng.integers(0,520,size=2000)]
    sampled=pixels[rows,cols];expected=original[rows,cols].copy();expected[expected==-9999]=np.nan
    np.testing.assert_array_equal(sampled,expected)
    # Reordered accesses cross tiles and exercise eviction, edge windows and cache reuse.
    np.testing.assert_array_equal(pixels[rows[::-1],cols[::-1]],expected[::-1])
    assert len(pixels._tiles)<=8
    assert np.isnan(nearest(pixels,tr,np.array([-10000.]),np.array([10000.]))).all()
    assert np.isnan(nearest(pixels,tr,tr.c+260.5*5,tr.f-260.5*5))
