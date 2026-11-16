"""Bounded-memory nearest-pixel access to original scientific rasters.

Reads original pixels in windows; no resampling, rounding or interpolation.
"""
from collections import OrderedDict
import threading
import numpy as np
import rasterio
from rasterio.windows import Window

class RasterPixels:
    tile_size = 256

    def __init__(self, path):
        self.path = path
        with rasterio.open(path) as ds:
            self.shape = (ds.height, ds.width)
            self.transform = ds.transform
        self._tiles = OrderedDict()
        self._lock = threading.Lock()

    def __getitem__(self, indices):
        rows, cols = np.broadcast_arrays(*indices)
        shape = rows.shape
        rows, cols = rows.ravel(), cols.ravel()
        across = (self.shape[1] + self.tile_size - 1) // self.tile_size
        keys = (rows // self.tile_size) * across + cols // self.tile_size
        order = np.argsort(keys, kind='stable')
        ordered = keys[order]
        edges = np.r_[0, np.flatnonzero(np.diff(ordered)) + 1, len(order)]
        output = np.empty(rows.size, dtype=np.float32)
        # Each call uses its own GDAL handle; cache writes remain serialized.
        with self._lock, rasterio.open(self.path) as ds:
            for start, end in zip(edges[:-1], edges[1:]):
                if start == end:
                    continue
                selected = order[start:end]
                key = int(ordered[start])
                row0 = (key // across) * self.tile_size
                col0 = (key % across) * self.tile_size
                tile = self._tiles.pop(key, None)
                if tile is None:
                    window = Window(col0, row0, min(self.tile_size, self.shape[1]-col0), min(self.tile_size, self.shape[0]-row0))
                    tile = ds.read(1, window=window, masked=True).filled(np.nan).astype(np.float32)
                self._tiles[key] = tile
                while len(self._tiles) > 8:
                    self._tiles.popitem(last=False)
                output[selected] = tile[rows[selected]-row0, cols[selected]-col0]
        return output.reshape(shape)
