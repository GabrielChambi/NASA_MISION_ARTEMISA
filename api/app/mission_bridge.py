"""Compatibility for main's Earth/Compare UI, backed by the canonical NASA pipeline.

No legacy seed archive is used: cache matching includes observer coordinates,
height, target, dates and all Horizons parameters. Both deployment paths share
the same prepared raw NASA records and partial LOLA horizon.
"""
import json
from datetime import datetime, timedelta
from functools import lru_cache
from .core.sites import DATA, get_site
from .core.horizon import horizon_at
from .solar.service import solar_result
from .solar.windows import visibility_metrics
from .earth.horizons import az_el_to_enu_vector
from .earth.visibility import evaluate_earth_series, build_horizon_ring_profile


def site_metadata(sid, height=2):
    site=get_site(sid)
    if not site: raise ValueError('Unknown site_id.')
    return dict(site_id=sid,name=site['name'],region='Lunar south pole',
                lat_deg=site['latitude_deg'],lon_east_deg=site['longitude_deg']%360,
                elevation_m=site['elevation_m'],observer_height_m=height,
                reference_frame=site['reference_frame'],provenance_source='NASA LOLA regional reference pixel',
                provenance_url=site['source_url'])


@lru_cache(maxsize=2)
def terrain_mesh(sid):
    site=get_site(sid)
    path=DATA/'prepared'/f'{sid}-terrain.json'
    if not path.exists(): return None
    tile=json.loads(path.read_text(encoding='utf-8')); n=tile['width']
    def grid(key):
        values=tile.get(key)
        return [values[row*n:(row+1)*n] for row in range(n)] if values else None
    return dict(grid_size=n,spacing_m=tile['resolution_m'],extent_m=tile['extent_m']['xmax']-tile['extent_m']['xmin'],
                center_elevation_m=site['elevation_m'],min_elevation_m=min(tile['elevations_m']),max_elevation_m=max(tile['elevations_m']),
                elevation_grid_m=grid('elevations_m'),slope_grid_deg=grid('slope_degrees'),
                center_slope_deg=site.get('slope_deg'),mean_slope_deg=sum(tile['slope_degrees'])/len(tile['slope_degrees']),
                uncertainty_grid_m=grid('height_uncertainty_m'),center_uncertainty_m=site.get('height_uncertainty_m'),
                median_uncertainty_m=None,frame=site['reference_frame'],provenance_url=tile['source_url'])


async def body_result(q,sid,target,delay):
    shift=timedelta(hours=delay)
    start=datetime.fromisoformat(q['start_utc'].replace('Z','+00:00'))+shift
    end=datetime.fromisoformat(q['end_utc'].replace('Z','+00:00'))+shift
    return await solar_result(sid,start.isoformat(),end.isoformat(),q['step_minutes'],q['horizon_mode'],
                              q['observer_height_m'],target=target,include_range=target==399)


async def earth_payload(q,sid=None,delay=None):
    sid=sid or q['site_id']; delay=q['delay_hours'] if delay is None else delay
    data=await body_result(q,sid,399,delay)
    # Last NASA sample is an endpoint for graphs, not an extra mission interval.
    raw=[{**s,'enu_vector':az_el_to_enu_vector(s['azimuth_deg'],s['elevation_deg'])} for s in data['samples'][:-1]]
    horizon=lambda az:horizon_at(sid,az,q['observer_height_m'],q['horizon_mode'])['elevation_deg']
    samples,metrics,windows,blackouts,warnings=evaluate_earth_series(
        raw,data['meta']['start_utc'],data['meta']['end_utc'],q['step_minutes'],q['clearance_deg'],horizon)
    quality='degraded' if q['horizon_mode']=='terrain' else ('cached_horizons_flat' if data['meta']['cache_hit'] else 'verified_horizons_flat')
    return dict(site=site_metadata(sid,q['observer_height_m']),query=q,
                effective_start_utc=data['meta']['start_utc'],effective_end_utc=data['meta']['end_utc'],
                quality=quality,warnings=data['meta']['limitations']+warnings,metrics=metrics.model_dump(),
                windows=[w.model_dump() for w in windows],blackout_windows=[w.model_dump() for w in blackouts],
                horizon_profile=[p.model_dump() for p in build_horizon_ring_profile(horizon)],
                samples=[s.model_dump() for s in samples],terrain_mesh_3d=terrain_mesh(sid),
                provenance=dict(source='JPL Horizons',ephemeris_kernel='Horizons observer ephemeris (see original query)',
                    target_body='Earth (399)',center_body='Moon topocentric (coord@301)',
                    visibility_definition='apparent Earth-center elevation > selected horizon + clearance',
                    interval_convention='[start,end), left sample',requested_horizon_mode=q['horizon_mode'],
                    effective_horizon_mode=q['horizon_mode'],cache_hit=data['meta']['cache_hit'],
                    retrieved_at_utc=data['meta']['retrieved_at'],query_url=data['meta']['query_url'],
                    limitations=data['meta']['limitations']))


async def compare_site(q,sid,delay):
    e=await earth_payload(q,sid,delay); sun=await body_result(q,sid,10,delay)
    by_time={s['t_utc']:s for s in sun['samples']}; samples=[]
    for s in e['samples']:
        t=by_time.get(s['t_utc'])
        if t is None: raise ValueError('NASA solar/Earth timestamps do not align.')
        samples.append(dict(t_utc=s['t_utc'],earth_azimuth_deg=s['azimuth_deg'],earth_elevation_deg=s['elevation_deg'],
                            earth_visible=s['earth_visible'],earth_enu_vector=s['enu_vector'],
                            sun_azimuth_deg=t['azimuth_deg'],sun_elevation_deg=t['elevation_deg'],
                            sun_visible=t['visible'],sun_enu_vector=az_el_to_enu_vector(t['azimuth_deg'],t['elevation_deg']),
                            joint_visible=s['earth_visible'] and t['visible']))
    joint=[dict(t_utc=s['t_utc'],visible=s['joint_visible']) for s in samples]
    joint.append(dict(t_utc=e['effective_end_utc'],visible=False))
    windows,overlap=visibility_metrics(joint,e['effective_end_utc'])
    sm=sun['summary']; em=e['metrics']
    solar_ok=sm['sun_visible_hours']>=q['minimum_solar_hours']
    earth_ok=em['earth_visible_hours']>=q['minimum_earth_visible_hours']
    return dict(site=e['site'],quality=e['quality'],solar_quality='verified_horizons',earth_quality=e['quality'],
        total_hours=em['total_hours'],solar_visible_hours=sm['sun_visible_hours'],solar_visible_fraction=sm['sun_visible_fraction'],
        longest_solar_dark_gap_hours=sm['longest_dark_gap_hours'],earth_visible_hours=em['earth_visible_hours'],
        earth_visible_fraction=em['earth_visible_fraction'],longest_earth_blackout_hours=em['longest_earth_blackout_hours'],
        overlap_solar_earth_hours=overlap['sun_visible_hours'],overlap_solar_earth_fraction=overlap['sun_visible_fraction'],
        meets_solar_constraint=solar_ok,meets_earth_constraint=earth_ok,meets_constraints=solar_ok and earth_ok,
        constraints_satisfied_count=int(solar_ok)+int(earth_ok),earth_windows=e['windows'],overlap_windows=windows,
        samples=samples,terrain_mesh_3d=e['terrain_mesh_3d'],
        explanation=f"{e['site']['name']}: {sm['sun_visible_hours']} h Sun, {em['earth_visible_hours']} h Earth, {overlap['sun_visible_hours']} h overlap under the selected model.")


async def compare_payload(q):
    sites=[await compare_site(q,sid,q['delay_hours']) for sid in q['site_ids']]
    deltas=[]
    for delayed in sites:
        base=await compare_site(q,delayed['site']['site_id'],0) if q['delay_hours'] else delayed
        deltas.append(dict(site_id=delayed['site']['site_id'],
            baseline_earth_visible_hours=base['earth_visible_hours'],delayed_earth_visible_hours=delayed['earth_visible_hours'],
            delta_earth_visible_hours=delayed['earth_visible_hours']-base['earth_visible_hours'],
            baseline_longest_blackout_hours=base['longest_earth_blackout_hours'],delayed_longest_blackout_hours=delayed['longest_earth_blackout_hours'],
            delta_longest_blackout_hours=delayed['longest_earth_blackout_hours']-base['longest_earth_blackout_hours'],
            baseline_overlap_hours=base['overlap_solar_earth_hours'],delayed_overlap_hours=delayed['overlap_solar_earth_hours'],
            delta_overlap_hours=delayed['overlap_solar_earth_hours']-base['overlap_solar_earth_hours']))
    score=lambda s:(s['constraints_satisfied_count'],s['overlap_solar_earth_hours'],s['earth_visible_hours'])
    ranked=sorted(sites,key=score,reverse=True); tied=score(ranked[0])==score(ranked[1])
    shift=timedelta(hours=q['delay_hours'])
    effective=lambda key:(datetime.fromisoformat(q[key].replace('Z','+00:00'))+shift).isoformat().replace('+00:00','Z')
    return dict(query=q,base_start_utc=q['start_utc'],base_end_utc=q['end_utc'],
        effective_start_utc=effective('start_utc'),effective_end_utc=effective('end_utc'),delay_hours=q['delay_hours'],
        requested_horizon_mode=q['horizon_mode'],effective_horizon_mode=q['horizon_mode'],
        consolidated_quality='degraded' if q['horizon_mode']=='terrain' else 'verified_horizons_flat',
        preferred_site_id=None if tied else ranked[0]['site']['site_id'],preference_label='Equal under selected criteria' if tied else 'Preferred under selected constraints',
        ranking_order=[s['site']['site_id'] for s in ranked],
        ranking_rule='Constraints satisfied, then simultaneous Solar/Earth hours, then Earth hours. Exact ties have no preferred site; not landing certification.',
        decision_explanation=' '.join(s['explanation'] for s in sites)+(' Equal under the selected criteria.' if tied else ' '+ranked[0]['site']['name']+' leads under the selected criteria.'),
        warnings=['Regional reference pixels, not approved landing locations.','Terrain horizon is partial; visibility is not power production or an RF link.','Transitions are uncertain by up to one sample step.'],
        sites=sites,delay_sensitivity=deltas,provenance=dict(earth_source='NASA/JPL Horizons Earth 399',solar_source='NASA/JPL Horizons Sun 10',
            terrain_source='NASA LOLA local and regional DEMs',interval_convention='[start,end), left sample',
            visibility_model='body-centre elevation > selected horizon (+ Earth clearance)'))
