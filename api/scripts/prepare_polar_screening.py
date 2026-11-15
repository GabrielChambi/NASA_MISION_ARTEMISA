"""Prepare full-cap regional terrain screening from the original NASA 80 m DEM.

This is regional terrain triage, not a landing hazard map. Slopes are derivatives
of the native 80 m DEM, aggregated in 4.75 km cells. No illumination or radio
visibility is inferred from terrain or transferred from a reference pixel.
"""
from pathlib import Path
import hashlib
import json
import math

import numpy as np
import rasterio
from rasterio.windows import Window

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'data'
SOURCE_URL = 'https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF'
RADIUS_M = 1737400.0
GRID_SIZE = 128
SPACING_M = 4750.0
HALF_EXTENT_M = GRID_SIZE * SPACING_M / 2
LATITUDE_LIMIT_DEG = -80.0
CAP_RADIUS_M = 2 * RADIUS_M * math.tan(math.radians(90 + LATITUDE_LIMIT_DEG) / 2)


def inverse_projection(x, y):
    rho = math.hypot(x, y)
    latitude = math.degrees(2 * math.atan2(rho, 2 * RADIUS_M) - math.pi / 2)
    longitude = math.degrees(math.atan2(x, y)) if rho else 0.0
    return latitude, longitude


def native_cell_metrics(dataset, x, y):
    """Read native source cells with a one-pixel halo; never use display terrain."""
    left, right = x - SPACING_M / 2, x + SPACING_M / 2
    bottom, top = y - SPACING_M / 2, y + SPACING_M / 2
    # Pixel centers inside the geographic screening square belong to this cell.
    tr = dataset.transform
    c0 = max(0, math.ceil((left - tr.c) / tr.a - .5))
    c1 = min(dataset.width, math.ceil((right - tr.c) / tr.a - .5))
    r0 = max(0, math.ceil((top - tr.f) / tr.e - .5))
    r1 = min(dataset.height, math.ceil((bottom - tr.f) / tr.e - .5))
    if r1 <= r0 or c1 <= c0:
        return None
    rr0, rr1 = max(0, r0 - 1), min(dataset.height, r1 + 1)
    cc0, cc1 = max(0, c0 - 1), min(dataset.width, c1 + 1)
    values = dataset.read(1, window=Window(cc0, rr0, cc1 - cc0, rr1 - rr0), masked=True).filled(np.nan).astype(np.float64)
    if values.shape[0] < 3 or values.shape[1] < 3:
        return None
    # A nodata neighbour makes the derivative unknown. No filling with zero.
    dzdy, dzdx = np.gradient(values, abs(tr.e), tr.a)
    yaxis = tr.f + (np.arange(rr0, rr1) + .5) * tr.e
    xaxis = tr.c + (np.arange(cc0, cc1) + .5) * tr.a
    xx, yy = np.meshgrid(xaxis, yaxis)
    rho2 = xx * xx + yy * yy
    # Stereographic map scale k = sec^2(c/2); multiply dz/dx_map by k.
    physical_scale = 1 + rho2 / (4 * RADIUS_M ** 2)
    slopes = np.degrees(np.arctan(np.hypot(dzdx, dzdy) * physical_scale))
    rs, cs = slice(r0 - rr0, r1 - rr0), slice(c0 - cc0, c1 - cc0)
    h, slope, rho2_core = values[rs, cs], slopes[rs, cs], rho2[rs, cs]
    inside_cap = rho2_core <= CAP_RADIUS_M ** 2
    valid_height = np.isfinite(h) & inside_cap
    valid_slope = np.isfinite(slope) & valid_height
    total_cap_pixels = int(inside_cap.sum())
    if not total_cap_pixels:
        return None
    coverage = float(valid_slope.sum() / total_cap_pixels)
    if not valid_height.any() or not valid_slope.any():
        return None
    hgood, sgood = h[valid_height], slope[valid_slope]
    center = next(dataset.sample([(x, y)], masked=True))[0]
    center_height = None if np.ma.is_masked(center) or not np.isfinite(center) else float(center)
    return {
        'elevation_m': round(center_height, 3) if center_height is not None else None,
        'regional_slope_deg': round(float(np.percentile(sgood, 95)), 4),
        'median_slope_deg': round(float(np.median(sgood)), 4),
        'max_slope_deg': round(float(sgood.max()), 4),
        'roughness_m': round(float(np.std(hgood)), 3),
        'relief_m': round(float(np.ptp(hgood)), 3),
        'coverage_fraction': round(coverage, 6),
        'native_pixels': int(valid_slope.sum()),
        'cap_fraction': round(float(total_cap_pixels / h.size), 6),
        'known': bool(center_height is not None and coverage >= .95),
    }


def prepare():
    source = DATA / 'raw/regional80m.tif'
    if not source.exists():
        raise FileNotFoundError('Download NASA source first with api/scripts/prepare_polar_atlas.py.')
    cells = []
    with rasterio.open(source) as dataset:
        if dataset.width != 7600 or dataset.height != 7600 or abs(dataset.transform.a - 80) > 1e-6:
            raise ValueError('Unexpected NASA regional DEM shape or resolution.')
        for row in range(GRID_SIZE):
            y = HALF_EXTENT_M - (row + .5) * SPACING_M
            for col in range(GRID_SIZE):
                x = -HALF_EXTENT_M + (col + .5) * SPACING_M
                lat, lon = inverse_projection(x, y)
                cell = {
                    'id': f'polar:{row}:{col}', 'row': row, 'col': col,
                    'x_m': x, 'y_m': y,
                    'latitude_deg': round(lat, 8), 'longitude_deg': round(lon, 8),
                    'elevation_m': None, 'regional_slope_deg': None,
                    'median_slope_deg': None, 'max_slope_deg': None,
                    'roughness_m': None, 'relief_m': None,
                    'coverage_fraction': 0, 'native_pixels': 0, 'cap_fraction': 0,
                    'known': False,
                }
                # Keep the row-major rectangular shape but preserve unknown corners.
                if lat <= LATITUDE_LIMIT_DEG:
                    metrics = native_cell_metrics(dataset, x, y)
                    if metrics:
                        cell.update(metrics)
                cells.append(cell)
            if row % 16 == 0:
                print('Regional screening row', row, '/', GRID_SIZE, flush=True)
        crs_wkt = dataset.crs.to_wkt()
        bounds = list(dataset.bounds)
    known = [cell for cell in cells if cell['known']]
    target = sum(cell['latitude_deg'] <= LATITUDE_LIMIT_DEG for cell in cells)
    # Cell area on the lunar sphere uses the inverse stereographic area scale.
    area_m2 = sum(SPACING_M ** 2 * cell['cap_fraction'] /
                  (1 + (cell['x_m'] ** 2 + cell['y_m'] ** 2) / (4 * RADIUS_M ** 2)) ** 2
                  for cell in known)
    result = {
        'schema_version': 1, 'status': 'ok',
        'title': 'NASA LOLA south-polar regional terrain screening',
        'analysis_type': 'regional-terrain-screening',
        'source': 'NASA LOLA regional 80 m DEM',
        'source_url': SOURCE_URL,
        'source_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'source_resolution_m': 80, 'radius_m': RADIUS_M,
        'reference_frame': 'MOON_ME / DE421; spherical south polar stereographic',
        'crs_wkt': crs_wkt,
        'latitude_bounds_deg': [-90, -80],
        'grid_size': GRID_SIZE, 'cell_spacing_m': SPACING_M,
        'grid': {'xmin': -HALF_EXTENT_M, 'ymax': HALF_EXTENT_M,
                 'xmax': HALF_EXTENT_M, 'ymin': -HALF_EXTENT_M,
                 'center_xmin': -HALF_EXTENT_M + SPACING_M / 2,
                 'center_ymax': HALF_EXTENT_M - SPACING_M / 2,
                 'order': 'row-major, north to south, west to east'},
        'source_bounds_m': bounds,
        'slope_method': '95th percentile of central-difference slopes of native 80 m DEM pixels within each 4.75 km cell; spherical stereographic map scale corrected per pixel.',
        'roughness_method': 'Standard deviation of native elevation values inside the cell; relief is maximum minus minimum, not subpixel rock roughness.',
        'statistics': {
            'total_grid_cells': len(cells), 'cap_center_cells': target,
            'known_cells': len(known), 'unknown_cap_cells': target - len(known),
            'covered_area_km2': round(area_m2 / 1e6, 2),
            'cap_area_km2': round(2 * math.pi * RADIUS_M ** 2 * (1 - math.sin(math.radians(80))) / 1e6, 2),
            'coverage_fraction_by_center': round(len(known) / target, 6) if target else 0,
            'minimum_elevation_m': min(cell['elevation_m'] for cell in known),
            'maximum_elevation_m': max(cell['elevation_m'] for cell in known),
        },
        'limitations': [
            'Regional screening covers the available south-polar cap from 80 S to 90 S; it does not certify landing suitability.',
            'The 80 m DEM cannot resolve small rocks, landing-footprint slopes, or hazards below its effective resolution.',
            'Screening cells are 4.75 km wide. Their colours are regional priorities, not the detailed 50 m landing-cell classes.',
            'Green means a relatively gentle regional terrain candidate for further study; it does not mean safe to land.',
            'Slope is derived from native regional elevations; this is not the independent NASA 5 m slope product.',
            'No Sun/Earth ephemerides, terrain horizon, time-dependent visibility, thermal state, electrical power or RF budget is inferred by this screening.',
            'Terrain uncertainty is not propagated. Missing samples remain unknown and lower coverage.',
            'Height spread over kilometres is not a measurement of lander-scale roughness.',
        ],
        'cells': cells,
    }
    path = DATA / 'prepared/polar_screening.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    print('Prepared', len(known), 'known /', target, 'cap centers;', path.stat().st_size, 'bytes', flush=True)
    return result


if __name__ == '__main__':
    prepare()
