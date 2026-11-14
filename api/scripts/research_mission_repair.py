"""Research-only proof of minimum-change planning over stored NASA samples.

No AI model is used here. The experiment establishes the deterministic result
that a future AI interface must explain, with provenance and a bounded search.
No app endpoints or application behavior are changed.
"""
import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import sys
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from api.app.core.sites import get_site
from api.app.solar.horizons import query_parameters, parse_result, iso
from api.app.core.horizon import horizon_at
from api.app.solar.windows import visibility_metrics

START = datetime(2026, 12, 14, tzinfo=timezone.utc)
DURATION_HOURS = 72
HEIGHT_M = 2
STEP_MINUTES = 60
REQUIREMENTS = {'minimum_sun_hours': 60, 'minimum_earth_hours': 36, 'max_slope_deg': 10}


def stored_body(site, target, delay):
    start = START + timedelta(hours=delay)
    stop = start + timedelta(hours=DURATION_HOURS)
    params = query_parameters(site, start, stop, STEP_MINUTES, HEIGHT_M, target, include_range=target == 399)
    key = hashlib.sha256(json.dumps(params, sort_keys=True).encode()).hexdigest()
    path = ROOT / 'data' / 'prepared' / 'ephemeris' / (key + '.json')
    record = json.loads(path.read_text(encoding='utf-8'))
    if record['params'] != params:
        raise ValueError('Stored NASA query does not match the observer or interval.')
    samples = parse_result(record['response']['result'], start, stop, STEP_MINUTES, target, include_range=target == 399)
    for sample in samples:
        horizon = horizon_at(site['id'], sample['azimuth_deg'], HEIGHT_M, 'terrain')
        sample['horizon_deg'] = horizon['elevation_deg']
        sample['visible'] = sample['elevation_deg'] > horizon['elevation_deg']
    return samples, {
        'site_id': site['id'], 'target': target, 'observer_height_m': HEIGHT_M,
        'start_utc': iso(start), 'end_utc': iso(stop),
        'path': path.relative_to(ROOT).as_posix(),
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'original_query_url': record['query_url'],
        'retrieved_at': record['retrieved_at'],
    }


def joined_series(site, target):
    merged = {}
    sources = []
    overlap_checks = 0
    for offset in (0, 12):
        samples, source = stored_body(site, target, offset)
        sources.append(source)
        for sample in samples:
            old = merged.get(sample['t_utc'])
            if old is not None:
                for field in ('azimuth_deg', 'elevation_deg', 'horizon_deg'):
                    if abs(old[field] - sample[field]) > 1e-9:
                        raise ValueError('Overlapping NASA responses disagree: ' + field)
                overlap_checks += 1
            merged[sample['t_utc']] = sample
    return merged, sources, overlap_checks


def run_experiment():
    all_rows, source_records, selected_plans, overlap_count = [], [], [], 0
    for sid in ('site01', 'site04'):
        site = get_site(sid)
        sun, sources, checks = joined_series(site, 10)
        source_records.extend(sources); overlap_count += checks
        earth, sources, checks = joined_series(site, 399)
        source_records.extend(sources); overlap_count += checks
        rows = []
        for delay in range(13):
            start = START + timedelta(hours=delay)
            stop = start + timedelta(hours=DURATION_HOURS)
            times = [iso(start + timedelta(hours=h)) for h in range(DURATION_HOURS + 1)]
            if any(t not in sun or t not in earth for t in times):
                raise ValueError('Candidate interval lacks actual NASA samples.')
            solar_samples = [sun[t] for t in times]
            earth_samples = [earth[t] for t in times]
            _, solar_metrics = visibility_metrics(solar_samples, iso(stop))
            _, earth_metrics = visibility_metrics(earth_samples, iso(stop))
            joint = [{'t_utc': t, 'visible': sun[t]['visible'] and earth[t]['visible']} for t in times]
            _, joint_metrics = visibility_metrics(joint, iso(stop))
            meets = solar_metrics['sun_visible_hours'] >= REQUIREMENTS['minimum_sun_hours'] and earth_metrics['sun_visible_hours'] >= REQUIREMENTS['minimum_earth_hours'] and site['slope_deg'] <= REQUIREMENTS['max_slope_deg']
            rows.append({
                'site_id': sid, 'start_shift_hours': delay, 'start_utc': iso(start), 'end_utc': iso(stop),
                'sun_hours': solar_metrics['sun_visible_hours'],
                'earth_hours': earth_metrics['sun_visible_hours'],
                'joint_hours': joint_metrics['sun_visible_hours'],
                'longest_earth_gap_hours': earth_metrics['longest_dark_gap_hours'],
                'reference_pixel_slope_deg': site['slope_deg'], 'meets_selected_requirements': meets,
            })
        by_shift = {row['start_shift_hours']: row for row in rows}
        robust_cases = []
        for nominal in rows:
            offsets = [nominal['start_shift_hours'] + error for error in (-2, -1, 0, 1, 2)]
            covered = all(offset in by_shift for offset in offsets)
            worlds = [by_shift[offset] for offset in offsets] if covered else []
            robust_cases.append({
                'nominal_shift_hours': nominal['start_shift_hours'],
                'evaluated_realized_shifts_hours': offsets,
                'coverage_complete': covered,
                'passes_all_tested_timing_errors': all(w['meets_selected_requirements'] for w in worlds) if covered else None,
                'minimum_earth_hours': min(w['earth_hours'] for w in worlds) if covered else None,
                'maximum_earth_hours': max(w['earth_hours'] for w in worlds) if covered else None,
            })
        all_rows.extend(rows)
        selected_plans.append({
            'site_id': sid, 'baseline': rows[0],
            'minimum_shift_on_tested_grid': next((r for r in rows if r['meets_selected_requirements']), None),
            'minimum_robust_shift_on_fully_covered_grid': next((r for r in robust_cases if r['passes_all_tested_timing_errors'] is True), None),
            'robust_timing_cases': robust_cases,
        })
    return {
        'schema': 'lunar-oracle-research/minimum-change/v1',
        'research_only': True,
        'computed_at': datetime.now(timezone.utc).isoformat(),
        'requirements_chosen_for_this_experiment': REQUIREMENTS,
        'analysis_parameters': {'duration_hours': DURATION_HOURS, 'horizon': 'partial LOLA terrain', 'height_m': HEIGHT_M, 'step_minutes': STEP_MINUTES, 'earth_clearance_deg': 0, 'searched_shift_hours': list(range(13)), 'tested_surface_timing_errors_hours': [-2, -1, 0, 1, 2], 'sites': ['site01', 'site04']},
        'method': 'Exhaustive bounded search over 26 candidate site/time windows; actual overlapping NASA series joined by UTC after agreement checks; half-open intervals with the final endpoint excluded from duration.',
        'matching_overlap_checks': overlap_count,
        'terrain_profile': {
            'path': 'data/prepared/horizon_profiles.json',
            'sha256': hashlib.sha256((ROOT/'data/prepared/horizon_profiles.json').read_bytes()).hexdigest(),
        },
        'site_catalog': {
            'path': 'data/catalog/sites.json',
            'sha256': hashlib.sha256((ROOT/'data/catalog/sites.json').read_bytes()).hexdigest(),
        },
        'new_nasa_requests': 0,
        'uses_ai': False,
        'limitations': [
            'Minimum only among the 0..12-hour integer shifts and two reference pixels tested, not a global or continuous optimum.',
            'Derived windows retain the two original NASA query URLs; NASA was not queried directly for each derived interval.',
            'Earth hours are accumulated centre visibility, not continuous communication or a guaranteed RF link.',
            'The chosen requirements omit a maximum communications blackout and a battery/thermal budget.',
            'Partial terrain horizons and sampled transitions remain; no landing or mission-safety certification.',
            'Changing the surface-analysis epoch does not model launch/orbit feasibility.',
            'Timing robustness covers only the five discrete shifts +/-2 h, not a calibrated probability or continuous guarantee.',
            'Insufficient temporal coverage is labelled unknown rather than passed or failed.',
            'This is research evidence, not an AI feature already integrated into the web app.',
        ],
        'results': selected_plans, 'candidate_windows': all_rows, 'source_records': source_records,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'docs/research/mission_repair_experiment.json')
    args = parser.parse_args()
    # Tripwire: this experiment must never acquire data from the network.
    with patch('httpx.AsyncClient', side_effect=AssertionError('Offline research only')):
        report = run_experiment()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    for result in report['results']:
        plan = result['minimum_shift_on_tested_grid']
        print(json.dumps({
            'site': result['site_id'],
            'baseline_sun_h': result['baseline']['sun_hours'],
            'baseline_earth_h': result['baseline']['earth_hours'],
            'first_passing_shift_h': plan['start_shift_hours'] if plan else None,
            'passing_earth_h': plan['earth_hours'] if plan else None,
            'longest_gap_h': plan['longest_earth_gap_hours'] if plan else None,
            'first_robust_shift_h': (result['minimum_robust_shift_on_fully_covered_grid'] or {}).get('nominal_shift_hours'),
            'robust_earth_range_h': [(result['minimum_robust_shift_on_fully_covered_grid'] or {}).get(k) for k in ('minimum_earth_hours','maximum_earth_hours')],
        }, ensure_ascii=False))
    print('Checked ' + str(report['matching_overlap_checks']) + ' overlapping samples; 26 windows; no network or AI calls.')


if __name__ == '__main__':
    main()
