"""Rebuild the interactive polar atlas from the official NASA regional GeoTIFF.

Only browser-sized derivatives are tracked. No synthetic terrain is generated.
Run from the repository root: api/.venv/Scripts/python.exe api/scripts/prepare_polar_atlas.py
"""
from datetime import datetime, timezone
from pathlib import Path
import hashlib
import json
import math
import urllib.request
import zipfile
import xml.etree.ElementTree as ET

import numpy as np
import rasterio
from rasterio.enums import Resampling

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / 'data/raw'
OUT = ROOT / 'frontend/public/data/polar-atlas'
SOURCE = 'https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF'
GAZETTEER = 'https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MOON_nomenclature_center_pts.kmz'
RADIUS = 1737400.0
GRID = 769
SCALE = 0.5  # meters per integer step; much finer than the display mesh spacing
OFFSET = -16000.0


def download(url, destination):
    if destination.exists():
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + '.part')
    with urllib.request.urlopen(url, timeout=120) as response, temporary.open('wb') as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
    temporary.replace(destination)


def polar_xy(lon, lat):
    rho = 2 * RADIUS * math.tan(math.radians(90 + lat) / 2)
    return rho * math.sin(math.radians(lon)), rho * math.cos(math.radians(lon))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    dem = RAW / 'regional80m.tif'
    download(SOURCE, dem)
    names = RAW / 'MOON_nomenclature_center_pts.kmz'
    download(GAZETTEER, names)
    ns = {'k': 'http://www.opengis.net/kml/2.2'}
    with zipfile.ZipFile(names) as archive:
        filename = next(name for name in archive.namelist() if name.endswith('.kml'))
        document = ET.fromstring(archive.read(filename))
    wanted = ['Shackleton', 'Shoemaker', 'Haworth', 'de Gerlache', 'Faustini', 'Sverdrup', 'Nobile', 'Amundsen', 'Cabeus', 'Malapert', 'Mons Mouton', 'Wiechert', 'Nefed’ev', 'Nefed\'ev', 'Idel\'son', 'Idel’son', 'Zeeman', 'Scott', 'Hédervári', 'Newton', 'Cabeus A', 'Slater']
    features = []
    with rasterio.open(dem) as dataset:
        grid = dataset.read(1, out_shape=(GRID, GRID), masked=True, resampling=Resampling.bilinear)
        values = grid.filled(np.nan)
        half = float(dataset.bounds.right)
        spacing = 2 * half / GRID
        axis = np.linspace(-half + spacing / 2, half - spacing / 2, GRID)
        xx, yy = np.meshgrid(axis, axis[::-1])
        valid = np.isfinite(values) & (xx * xx + yy * yy <= (half - 160) ** 2)
        if dataset.nodata is not None and math.isfinite(dataset.nodata):
            valid &= values != dataset.nodata
        if valid.sum() < GRID * GRID * 0.7:
            raise ValueError('Insufficient valid NASA DEM coverage')
        encoded = np.full(values.shape, 65535, dtype='<u2')
        encoded[valid] = np.rint((values[valid] - OFFSET) / SCALE).astype('<u2')
        if np.any(np.abs((encoded[valid].astype(float) * SCALE + OFFSET) - values[valid]) > SCALE / 2 + 0.002):
            raise ValueError('DEM encoding exceeds declared height precision')
        binary = encoded.tobytes()
        (OUT / 'south-pole-height.u16').write_bytes(binary)
        for placemark in document.findall('.//k:Placemark', ns):
            name = placemark.findtext('k:name', default='', namespaces=ns).strip()
            if name not in wanted:
                continue
            point = placemark.findtext('.//k:Point/k:coordinates', namespaces=ns)
            if not point:
                continue
            lon, lat = [float(v) for v in point.strip().split(',')[:2]]
            x, y = polar_xy(lon, lat)
            if math.hypot(x, y) > half - 2500:
                continue
            z = float(next(dataset.sample([(x, y)]))[0])
            if not math.isfinite(z):
                continue
            description = placemark.findtext('k:description', default='', namespaces=ns)
            description += placemark.findtext('.//k:SimpleData[@name="link"]', default='', namespaces=ns)
            import re
            link = re.search(r'https?://planetarynames\.wr\.usgs\.gov/(?:Feature|feature)/\d+', description)
            features.append({'name': name, 'latitude_deg': lat, 'longitude_east_deg': lon % 360, 'x_m': round(x, 3), 'y_m': round(y, 3), 'elevation_m': round(z, 2), 'source_url': link.group(0).replace('http:', 'https:') if link else 'https://planetarynames.wr.usgs.gov/GIS_Downloads'})
        features.sort(key=lambda item: wanted.index(item['name']))
        if not any(item['name'] == 'Shackleton' for item in features):
            raise ValueError('Official feature coordinates could not be parsed')
        catalog = json.loads((ROOT / 'data/catalog/sites.json').read_text(encoding='utf-8'))
        for site in catalog['sites']:
            x, y = polar_xy(site['longitude_deg'], site['latitude_deg'])
            site['atlas_x_m'] = round(x, 3)
            site['atlas_y_m'] = round(y, 3)
        manifest = {
            'version': 1, 'title': 'Lunar south pole · NASA LOLA regional terrain',
            'source_url': SOURCE, 'source_product': 'LDEM_80S_80MPP_ADJ.TIF', 'source_resolution_m': 80,
            'source_sha256': hashlib.sha256(dem.read_bytes()).hexdigest(),
            'source_width': dataset.width, 'source_height': dataset.height, 'crs_wkt': dataset.crs.to_wkt(),
            'radius_m': RADIUS, 'extent_m': dict(zip(['xmin', 'ymin', 'xmax', 'ymax'], dataset.bounds)),
            'grid_size': GRID, 'display_spacing_m': spacing, 'sample_extent_m': {'xmin':float(axis[0]),'ymin':float(axis[0]),'xmax':float(axis[-1]),'ymax':float(axis[-1])}, 'scale_m': SCALE, 'offset_m': OFFSET,
            'nodata': 65535, 'data_url': '/data/polar-atlas/south-pole-height.u16', 'byte_order': 'little-endian',
            'height_sha256': hashlib.sha256(binary).hexdigest(), 'valid_vertices': int(valid.sum()),
            'min_elevation_m': round(float(values[valid].min()), 2), 'max_elevation_m': round(float(values[valid].max()), 2),
            'features': features, 'sites': catalog['sites'],
            'nomenclature_source': 'IAU / USGS Gazetteer of Planetary Nomenclature · LOLA 2011 control network',
            'nomenclature_url': 'https://planetarynames.wr.usgs.gov/GIS_Downloads',
            'nomenclature_download_url': GAZETTEER, 'nomenclature_sha256': hashlib.sha256(names.read_bytes()).hexdigest(),
            'reference_visualization_url': 'https://svs.gsfc.nasa.gov/5127',
            'prepared_at': datetime.now(timezone.utc).isoformat(),
            'limitations': [
                'Browser mesh is downsampled from the 80 m NASA DEM; do not use it for local landing safety or horizon calculations.',
                'Elevation colors encode measured heights, not optical surface colors, illumination or water ice.',
                'Vertical exaggeration is a display-only setting and never changes ephemerides or visibility results.',
                'IAU/USGS feature coordinates are cartographic labels, not landing sites; independent frame cross-validation is pending.',
                'Scene lighting aids terrain inspection; it is not a ray-traced prediction of solar illumination.'
            ]
        }
    (OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    print(json.dumps({'grid': GRID, 'bytes': len(binary), 'features': [f['name'] for f in features], 'min_m': manifest['min_elevation_m'], 'max_m': manifest['max_elevation_m'], 'source': SOURCE}))


if __name__ == '__main__':
    main()
