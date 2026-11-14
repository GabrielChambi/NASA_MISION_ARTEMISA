from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional

from .horizons import az_el_to_enu_vector, fetch_topocentric_ephemeris
from .models import (
    EarthMetricsSummary,
    EarthProvenance,
    EarthQueryRequest,
    EarthResponse,
    EarthSample,
    HorizonMode,
    HorizonProfilePoint,
    QualityStatus,
    VisibilityWindow,
    format_utc_z,
    parse_strict_utc,
)
from .sites_catalog import get_site_metadata, get_terrain_mesh_3d

HorizonEvaluator = Callable[[float], float]


def resolve_horizon_evaluator(
    site_id: str, requested_mode: HorizonMode,
    custom_horizon_fn: Optional[HorizonEvaluator] = None, observer_height_m: float = 2,
) -> tuple[HorizonEvaluator, HorizonMode, bool, Optional[str]]:
    """Use the same partial LOLA profile and height as the canonical pipeline."""
    if requested_mode == "flat": return (lambda _az: 0.0), "flat", True, None
    if custom_horizon_fn is not None: return custom_horizon_fn, "terrain", True, None
    from ..core.horizon import horizon_at
    info=horizon_at(site_id,0,observer_height_m,requested_mode)
    return (lambda az: horizon_at(site_id,az,observer_height_m,requested_mode)['elevation_deg']),"terrain",True," ".join(info['warnings'])


def build_horizon_ring_profile(horizon_fn: HorizonEvaluator, step_deg: int = 10) -> list[HorizonProfilePoint]:
    """Generate 360-degree horizon profile with 3D ENU rim vectors for 2D polar & 3D sky-dome views."""
    points: list[HorizonProfilePoint] = []
    for az in range(0, 360, step_deg):
        h_deg = round(float(horizon_fn(float(az))), 4)
        points.append(
            HorizonProfilePoint(
                azimuth_deg=float(az),
                horizon_elevation_deg=h_deg,
                enu_rim_vector=az_el_to_enu_vector(float(az), h_deg),
            )
        )
    return points


def compute_semi_open_windows(
    samples: list[EarthSample],
    step_minutes: int,
    target_state: bool = True,
) -> list[VisibilityWindow]:
    """
    Compute contiguous semi-open intervals [start_utc, end_utc) where sample.earth_visible == target_state.
    Each sample at t_i covers [t_i, t_i + step_minutes).
    If a gap exists between sample timestamps (missing sample), contiguous windows do NOT bridge across the gap.
    """
    windows: list[VisibilityWindow] = []
    step_delta = timedelta(minutes=step_minutes)

    cur_start: Optional[datetime] = None
    cur_end: Optional[datetime] = None

    for sample in samples:
        t_dt = parse_strict_utc(sample.t_utc, "sample.t_utc")
        if sample.earth_visible == target_state:
            if cur_start is None:
                cur_start = t_dt
                cur_end = t_dt + step_delta
            elif cur_end == t_dt:
                cur_end = t_dt + step_delta
            else:
                # Gap detected due to missing sample: close previous window and start a new one
                dur = round((cur_end - cur_start).total_seconds() / 3600.0, 4)
                windows.append(
                    VisibilityWindow(
                        start_utc=format_utc_z(cur_start),
                        end_utc=format_utc_z(cur_end),
                        duration_hours=dur,
                    )
                )
                cur_start = t_dt
                cur_end = t_dt + step_delta
        else:
            if cur_start is not None and cur_end is not None:
                dur = round((cur_end - cur_start).total_seconds() / 3600.0, 4)
                windows.append(
                    VisibilityWindow(
                        start_utc=format_utc_z(cur_start),
                        end_utc=format_utc_z(cur_end),
                        duration_hours=dur,
                    )
                )
                cur_start = None
                cur_end = None

    if cur_start is not None and cur_end is not None:
        dur = round((cur_end - cur_start).total_seconds() / 3600.0, 4)
        windows.append(
            VisibilityWindow(
                start_utc=format_utc_z(cur_start),
                end_utc=format_utc_z(cur_end),
                duration_hours=dur,
            )
        )

    return windows


def evaluate_earth_series(
    raw_samples: list[dict[str, Any]],
    effective_start_utc: str,
    effective_end_utc: str,
    step_minutes: int,
    clearance_deg: float,
    horizon_fn: HorizonEvaluator,
) -> tuple[list[EarthSample], EarthMetricsSummary, list[VisibilityWindow], list[VisibilityWindow], list[str]]:
    """
    Evaluate geometric Earth visibility for every sample without fabricating missing timestamps:
        earth_visible = elevation_deg > local_horizon_deg + clearance_deg
    """
    start_dt = parse_strict_utc(effective_start_utc, "effective_start_utc")
    end_dt = parse_strict_utc(effective_end_utc, "effective_end_utc")

    expected_timestamps: list[str] = []
    cur = start_dt
    while cur < end_dt:
        expected_timestamps.append(format_utc_z(cur))
        cur += timedelta(minutes=step_minutes)
    expected_count = len(expected_timestamps)

    by_ts = {s["t_utc"]: s for s in raw_samples if "t_utc" in s}
    warnings: list[str] = []

    evaluated_samples: list[EarthSample] = []
    for ts in expected_timestamps:
        if ts not in by_ts:
            continue
        raw = by_ts[ts]
        az_deg = float(raw["azimuth_deg"])
        el_deg = float(raw["elevation_deg"])
        h_deg = round(float(horizon_fn(az_deg)), 6)
        threshold_deg = round(h_deg + clearance_deg, 6)
        # Strict inequality matching solar visibility convention: elevation > local_horizon + clearance
        is_visible = bool(el_deg > threshold_deg)
        enu = raw.get("enu_vector") or az_el_to_enu_vector(az_deg, el_deg)
        evaluated_samples.append(
            EarthSample(
                t_utc=ts,
                azimuth_deg=round(az_deg, 6),
                elevation_deg=round(el_deg, 6),
                local_horizon_deg=h_deg,
                clearance_deg=round(clearance_deg, 6),
                effective_threshold_deg=threshold_deg,
                earth_visible=is_visible,
                range_km=float(raw.get("range_km", 384400.0)),
                range_rate_km_s=float(raw.get("range_rate_km_s", 0.0)),
                enu_vector=(float(enu[0]), float(enu[1]), float(enu[2])),
                solar_elongation_note=raw.get("solar_elongation_note"),
            )
        )

    received_count = len(evaluated_samples)
    missing_count = max(0, expected_count - received_count)
    if missing_count > 0:
        warnings.append(
            f"Degraded series quality: {missing_count} of {expected_count} expected sample(s) missing; "
            "no synthetic interpolation was fabricated."
        )

    step_hours = step_minutes / 60.0
    total_hours = round(expected_count * step_hours, 4)
    visible_windows = compute_semi_open_windows(evaluated_samples, step_minutes, target_state=True)
    blackout_windows = compute_semi_open_windows(evaluated_samples, step_minutes, target_state=False)

    visible_count = sum(1 for s in evaluated_samples if s.earth_visible)
    earth_visible_hours = round(visible_count * step_hours, 4)
    earth_visible_fraction = round(visible_count / expected_count, 4) if expected_count > 0 else 0.0

    longest_blackout = max((w.duration_hours for w in blackout_windows), default=0.0)
    longest_visible = max((w.duration_hours for w in visible_windows), default=0.0)

    if evaluated_samples:
        elevs = [s.elevation_deg for s in evaluated_samples]
        ranges = [s.range_km for s in evaluated_samples]
        # Circular mean for azimuth
        sin_sum = sum(math.sin(math.radians(s.azimuth_deg)) for s in evaluated_samples)
        cos_sum = sum(math.cos(math.radians(s.azimuth_deg)) for s in evaluated_samples)
        mean_az = (math.degrees(math.atan2(sin_sum, cos_sum)) + 360.0) % 360.0
        min_el = round(min(elevs), 4)
        max_el = round(max(elevs), 4)
        mean_el = round(sum(elevs) / len(elevs), 4)
        mean_range = round(sum(ranges) / len(ranges), 2)
    else:
        min_el = max_el = mean_el = mean_az = mean_range = 0.0

    metrics = EarthMetricsSummary(
        total_hours=total_hours,
        earth_visible_hours=earth_visible_hours,
        earth_visible_fraction=earth_visible_fraction,
        longest_earth_blackout_hours=round(longest_blackout, 4),
        longest_earth_visible_hours=round(longest_visible, 4),
        min_elevation_deg=min_el,
        max_elevation_deg=max_el,
        mean_elevation_deg=mean_el,
        mean_azimuth_deg=round(mean_az, 4),
        mean_range_km=mean_range,
        expected_samples=expected_count,
        received_samples=received_count,
        missing_samples=missing_count,
    )

    return evaluated_samples, metrics, visible_windows, blackout_windows, warnings


def compute_earth_visibility(
    req: EarthQueryRequest,
    custom_raw_samples: Optional[list[dict[str, Any]]] = None,
    custom_horizon_fn: Optional[HorizonEvaluator] = None,
) -> EarthResponse:
    """
    Full Earth visibility pipeline:
      1. Shift [start_utc, end_utc) forward by delay_hours (if delay_hours > 0) and query real ephemerides.
      2. Resolve flat or verified terrain horizon profile.
      3. Evaluate geometric line of sight to Earth center and semi-open windows.
      4. Attach 3D ENU vectors and LOLA 3D surface mesh for 3D visualization.
    """
    if custom_raw_samples is None and custom_horizon_fn is None:
        import asyncio
        from ..mission_bridge import earth_payload
        return EarthResponse.model_validate(asyncio.run(earth_payload(req.model_dump())))

    site = get_site_metadata(req.site_id, observer_height_m=req.observer_height_m)

    base_start = parse_strict_utc(req.start_utc, "start_utc")
    base_end = parse_strict_utc(req.end_utc, "end_utc")
    delay_delta = timedelta(hours=req.delay_hours)
    eff_start_dt = base_start + delay_delta
    eff_end_dt = base_end + delay_delta
    eff_start_utc = format_utc_z(eff_start_dt)
    eff_end_utc = format_utc_z(eff_end_dt)

    horizon_fn, effective_horizon_mode, terrain_ok, terrain_warning = resolve_horizon_evaluator(
        site.site_id, req.horizon_mode, custom_horizon_fn=custom_horizon_fn, observer_height_m=req.observer_height_m
    )

    if custom_raw_samples is not None:
        raw_samples = custom_raw_samples
        cache_hit = True
    else:
        raw_samples, cache_hit = fetch_topocentric_ephemeris(
            site=site,
            start_utc=eff_start_utc,
            end_utc=eff_end_utc,
            step_minutes=req.step_minutes,
            target_command="399",
        )

    samples, metrics, windows, blackout_windows, eval_warnings = evaluate_earth_series(
        raw_samples=raw_samples,
        effective_start_utc=eff_start_utc,
        effective_end_utc=eff_end_utc,
        step_minutes=req.step_minutes,
        clearance_deg=req.clearance_deg,
        horizon_fn=horizon_fn,
    )

    warnings: list[str] = []
    if terrain_warning:
        warnings.append(terrain_warning)
    warnings.extend(eval_warnings)

    if metrics.received_samples == 0:
        quality: QualityStatus = "unavailable"
    elif metrics.missing_samples > 0:
        quality = "degraded"
    elif req.horizon_mode == "terrain" and not terrain_ok:
        quality = "terrain_unavailable"
    elif effective_horizon_mode == "terrain":
        quality = "verified_horizons_terrain"
    else:
        quality = "verified_horizons_flat"

    horizon_profile = build_horizon_ring_profile(horizon_fn, step_deg=10)
    terrain_mesh_3d = get_terrain_mesh_3d(site.site_id)

    provenance = EarthProvenance(
        source="JPL Horizons",
        ephemeris_kernel="DE441",
        target_body="Earth (399)",
        center_body=f"Moon topocentric (coord@301 · {site.lon_east_deg:.4f}°E, {site.lat_deg:.4f}°N)",
        visibility_definition="geometric line of sight to Earth center (elevation_deg > local_horizon_deg + clearance_deg)",
        interval_convention="[start_utc, end_utc)",
        requested_horizon_mode=req.horizon_mode,
        effective_horizon_mode=effective_horizon_mode,
        cache_hit=cache_hit,
        retrieved_at_utc=format_utc_z(datetime.now(timezone.utc)),
        limitations=[
            "Geometric visibility only: models unoccluded line of sight to Earth center (body 399).",
            "Does not guarantee direct-to-Earth RF communication link closure, ground station availability, or antenna multipath clearance.",
            f"Window boundaries are quantized to the {req.step_minutes}-minute sampling step under [start_utc, end_utc).",
        ],
    )

    return EarthResponse(
        site=site,
        query=req.model_dump(),
        effective_start_utc=eff_start_utc,
        effective_end_utc=eff_end_utc,
        quality=quality,
        warnings=warnings,
        metrics=metrics,
        windows=windows,
        blackout_windows=blackout_windows,
        horizon_profile=horizon_profile,
        samples=samples,
        terrain_mesh_3d=terrain_mesh_3d,
        provenance=provenance,
    )
