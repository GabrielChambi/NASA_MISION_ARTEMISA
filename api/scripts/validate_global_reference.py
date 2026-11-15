"""Independent live JPL comparison for the polar-reference translation.

Run from repository root. Raw JPL responses remain in the standard exact-query
cache; the compact validation report contains traceable query URLs only.
"""
import asyncio
import json
import math
from datetime import datetime, timezone, timedelta
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'api'))
from app.automatic_plan import (
    get_sky, estimate_transfer, timing, evaluate_global_plan, global_horizons,
    body_position, angles, frame,
)
from app.polar import surface
from app.solar.horizons import fetch_samples


async def main():
    request = {'departure_utc': '2026-12-25T12:00:00Z', 'surface_hours': 72}
    departure = datetime(2026, 12, 25, 12, tzinfo=timezone.utc)
    anchor = await get_sky('Earth', departure, departure + timedelta(hours=1))
    transfer = estimate_transfer(anchor['samples'][0])
    mission = timing(request | {'date_kind': 'departure'}, transfer)
    arrival = datetime.fromisoformat(mission['arrival_utc'].replace('Z', '+00:00'))
    end = arrival + timedelta(hours=72)
    sun = await get_sky('Sun', arrival, end)
    earth = await get_sky('Earth', arrival, end)
    plan = evaluate_global_plan(request, surface(), global_horizons(), {'sun': sun, 'earth': earth}, transfer)
    selected = [plan['best'], *plan['alternatives'][:2]]
    selected = [row for row in selected if row is not None]
    if len(selected) < 3:
        by_id = {row['id']: row for row in surface()['cells']}
        for identifier in ('polar:64:64', 'polar:45:65', 'polar:75:75'):
            if identifier in by_id and not any(row['id'] == identifier for row in selected):
                selected.append(by_id[identifier])
            if len(selected) >= 3:
                break
    print(json.dumps({'arrival': mission['arrival_utc'], 'counts': plan['counts'], 'selected': [{k: row[k] for k in ('id', 'latitude_deg', 'longitude_deg', 'elevation_m')} for row in selected]}), flush=True)
    comparisons = []
    for cell in selected:
        for name, target, reference_rows in [('Sun', 10, sun['samples']), ('Earth', 399, earth['samples'])]:
            actual, record, cached = await fetch_samples(cell, arrival, arrival + timedelta(hours=2), 60, 2, target, True)
            rows = []
            for index, exact in enumerate(actual):
                azimuth, elevation = angles(body_position(reference_rows[index]), frame(cell['latitude_deg'], cell['longitude_deg']), cell['elevation_m'])
                da = (azimuth - exact['azimuth_deg'] + 180) % 360 - 180
                de = elevation - exact['elevation_deg']
                # Great-circle angular separation is meaningful near zenith.
                a, e, b, f = map(math.radians, (azimuth, elevation, exact['azimuth_deg'], exact['elevation_deg']))
                separation = math.degrees(math.acos(max(-1, min(1, math.sin(e)*math.sin(f)+math.cos(e)*math.cos(f)*math.cos(a-b)))))
                rows.append({'t_utc': exact['t_utc'], 'delta_azimuth_deg': da, 'delta_elevation_deg': de, 'angular_separation_deg': separation, 'exact': exact, 'translated': {'azimuth_deg': azimuth, 'elevation_deg': elevation}})
            comparison = {'cell_id': cell['id'], 'latitude_deg': cell['latitude_deg'], 'longitude_deg': cell['longitude_deg'], 'target': name, 'query_url': record['query_url'], 'retrieved_at': record['retrieved_at'], 'cache_hit': cached, 'samples': rows}
            comparisons.append(comparison)
            print(json.dumps({'cell': cell['id'], 'target': name, 'max_separation_deg': max(row['angular_separation_deg'] for row in rows), 'max_el_error_deg': max(abs(row['delta_elevation_deg']) for row in rows)}), flush=True)
    report = {
        'validation_scope': 'Three selected real NASA DEM cells; three hourly epochs per cell and target; one departure date. This does not validate every location, epoch, lunar reference-frame realization, terrain horizon, or mission scenario.',
        'reproduce': 'api/.venv/Scripts/python.exe api/scripts/validate_global_reference.py',
        'reference_observer': {'latitude_deg': -90, 'longitude_deg': 0, 'elevation_m': 0, 'height_above_surface_m': 2},
        'method': 'Compare topocentric apparent airless JPL observer angles at each cell against spherical ENU translation of the polar JPL apparent vector and range. Exact JPL calls use the same UTC epochs and lunar MEAN_ME frame.',
        'request': request, 'mission': mission, 'counts': plan['counts'],
        'selected': [{key: cell[key] for key in ('id', 'latitude_deg', 'longitude_deg', 'elevation_m', 'regional_slope_deg')} for cell in selected],
        'comparisons': comparisons,
        'max_angular_separation_deg': max(row['angular_separation_deg'] for c in comparisons for row in c['samples']),
        'max_absolute_elevation_error_deg': max(abs(row['delta_elevation_deg']) for c in comparisons for row in c['samples']),
        'limitations': [
            'This comparison tests observer translation, not launch feasibility or landing safety.',
            'The finite 80 m DEM horizon and its 5 degree azimuth sampling remain an approximate regional model.',
            'Agreement within this small sample does not replace independent SPICE frame validation.',
        ],
    }
    path = ROOT / 'docs' / 'validation' / 'global-reference-validation.json'
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
    print('saved', path, flush=True)


if __name__ == '__main__':
    asyncio.run(main())
