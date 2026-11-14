from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from ..earth.models import EarthQueryRequest, VisibilityWindow, format_utc_z, parse_strict_utc
from ..earth.visibility import HorizonEvaluator, compute_earth_visibility
from .models import (
    BaselineDeltaSummary,
    CombinedSamplePoint,
    CompareRequest,
    CompareResponse,
    ConstraintStatus,
    SiteComparisonSummary,
)
from .solar_adapter import HorizonsSolarAdapter, SolarServiceProtocol


def _compute_overlap_windows(samples: list[CombinedSamplePoint], step_minutes: int) -> list[VisibilityWindow]:
    windows: list[VisibilityWindow] = []
    step_delta = timedelta(minutes=step_minutes)
    cur_start: Optional[datetime] = None
    cur_end: Optional[datetime] = None

    for s in samples:
        t_dt = parse_strict_utc(s.t_utc, "sample.t_utc")
        if s.joint_visible is True:
            if cur_start is None:
                cur_start = t_dt
                cur_end = t_dt + step_delta
            elif cur_end == t_dt:
                cur_end = t_dt + step_delta
            else:
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


def _evaluate_single_site_for_window(
    site_id: str,
    start_utc: str,
    end_utc: str,
    req: CompareRequest,
    delay_hours: float,
    solar_service: SolarServiceProtocol,
    custom_horizon_fn: Optional[HorizonEvaluator] = None,
) -> tuple[SiteComparisonSummary, list[str], str]:
    earth_req = EarthQueryRequest(
        site_id=site_id,
        start_utc=start_utc,
        end_utc=end_utc,
        step_minutes=req.step_minutes,
        horizon_mode=req.horizon_mode,
        clearance_deg=req.clearance_deg,
        delay_hours=delay_hours,
        observer_height_m=req.observer_height_m,
    )
    earth_resp = compute_earth_visibility(earth_req, custom_horizon_fn=custom_horizon_fn)

    solar_res = solar_service.get_solar_series(
        site=earth_resp.site,
        start_utc=earth_resp.effective_start_utc,
        end_utc=earth_resp.effective_end_utc,
        step_minutes=req.step_minutes,
        horizon_mode=req.horizon_mode,
    )

    warnings = list(earth_resp.warnings)
    for w in solar_res.warnings:
        if w and w not in warnings:
            warnings.append(w)

    solar_by_ts = {s["t_utc"]: s for s in solar_res.samples}
    combined_samples: list[CombinedSamplePoint] = []
    overlap_count = 0
    step_hours = req.step_minutes / 60.0

    solar_available = solar_res.status != "unavailable" and len(solar_res.samples) > 0
    earth_available = earth_resp.quality != "unavailable" and len(earth_resp.samples) > 0

    for es in earth_resp.samples:
        ss = solar_by_ts.get(es.t_utc)
        if ss is not None and solar_available:
            sun_vis = bool(ss["sun_visible"])
            joint_vis = bool(es.earth_visible and sun_vis)
            if joint_vis:
                overlap_count += 1
            sun_enu = ss.get("enu_vector")
            combined_samples.append(
                CombinedSamplePoint(
                    t_utc=es.t_utc,
                    earth_azimuth_deg=es.azimuth_deg,
                    earth_elevation_deg=es.elevation_deg,
                    earth_visible=es.earth_visible,
                    earth_enu_vector=es.enu_vector,
                    sun_azimuth_deg=float(ss["azimuth_deg"]),
                    sun_elevation_deg=float(ss["elevation_deg"]),
                    sun_visible=sun_vis,
                    sun_enu_vector=(float(sun_enu[0]), float(sun_enu[1]), float(sun_enu[2])) if sun_enu else None,
                    joint_visible=joint_vis,
                )
            )
        else:
            combined_samples.append(
                CombinedSamplePoint(
                    t_utc=es.t_utc,
                    earth_azimuth_deg=es.azimuth_deg,
                    earth_elevation_deg=es.elevation_deg,
                    earth_visible=es.earth_visible,
                    earth_enu_vector=es.enu_vector,
                    sun_azimuth_deg=None,
                    sun_elevation_deg=None,
                    sun_visible=None,
                    sun_enu_vector=None,
                    joint_visible=None,
                )
            )

    expected_samples = earth_resp.metrics.expected_samples
    if solar_available and earth_available:
        overlap_hours: Optional[float] = round(overlap_count * step_hours, 4)
        overlap_fraction: Optional[float] = (
            round(overlap_count / expected_samples, 4) if expected_samples > 0 else 0.0
        )
        overlap_windows = _compute_overlap_windows(combined_samples, req.step_minutes)
        meets_solar: ConstraintStatus = bool(
            solar_res.visible_hours is not None and solar_res.visible_hours >= req.minimum_solar_hours
        )
        meets_earth: ConstraintStatus = bool(
            earth_resp.metrics.earth_visible_hours >= req.minimum_earth_visible_hours
        )
        meets_both: ConstraintStatus = bool(meets_solar is True and meets_earth is True)
        satisfied_count: Optional[int] = int(meets_solar is True) + int(meets_earth is True)
        site_quality = earth_resp.quality
    else:
        overlap_hours = None
        overlap_fraction = None
        overlap_windows = []
        meets_solar = "unknown" if not solar_available else bool(
            solar_res.visible_hours is not None and solar_res.visible_hours >= req.minimum_solar_hours
        )
        meets_earth = "unknown" if not earth_available else bool(
            earth_resp.metrics.earth_visible_hours >= req.minimum_earth_visible_hours
        )
        meets_both = "unknown"
        satisfied_count = None
        site_quality = "unavailable"

    label_site = site_id.capitalize()
    if meets_both == "unknown":
        explanation = (
            f"{label_site} constraint evaluation is unknown because required solar or Earth ephemeris series "
            "is unavailable; no heuristic preference is declared."
        )
    elif meets_both is True:
        explanation = (
            f"{label_site} satisfies both selected minimum visibility constraints under the geometric model; "
            "results may change with terrain data."
        )
    else:
        explanation = (
            f"{label_site} satisfies {satisfied_count}/2 selected minimum visibility constraints "
            f"(Solar: {solar_res.visible_hours}h vs {req.minimum_solar_hours}h min; "
            f"Earth: {earth_resp.metrics.earth_visible_hours}h vs {req.minimum_earth_visible_hours}h min) "
            "under the geometric model; results may change with terrain data."
        )

    summary = SiteComparisonSummary(
        site=earth_resp.site,
        quality=site_quality,
        solar_quality=solar_res.status,
        earth_quality=earth_resp.quality,
        total_hours=earth_resp.metrics.total_hours,
        solar_visible_hours=solar_res.visible_hours if solar_available else None,
        solar_visible_fraction=solar_res.visible_fraction if solar_available else None,
        longest_solar_dark_gap_hours=solar_res.longest_dark_gap_hours if solar_available else None,
        earth_visible_hours=earth_resp.metrics.earth_visible_hours if earth_available else None,
        earth_visible_fraction=earth_resp.metrics.earth_visible_fraction if earth_available else None,
        longest_earth_blackout_hours=earth_resp.metrics.longest_earth_blackout_hours if earth_available else None,
        overlap_solar_earth_hours=overlap_hours,
        overlap_solar_earth_fraction=overlap_fraction,
        meets_solar_constraint=meets_solar,
        meets_earth_constraint=meets_earth,
        meets_constraints=meets_both,
        constraints_satisfied_count=satisfied_count,
        earth_windows=earth_resp.windows,
        overlap_windows=overlap_windows,
        samples=combined_samples,
        terrain_mesh_3d=earth_resp.terrain_mesh_3d,
        explanation=explanation,
    )
    return summary, warnings, earth_resp.provenance.effective_horizon_mode


def compare_sites(
    req: CompareRequest,
    solar_service: Optional[SolarServiceProtocol] = None,
    custom_horizon_fn: Optional[HorizonEvaluator] = None,
) -> CompareResponse:
    """
    Compare 2 candidate lunar south pole sites across identical UTC dates, step, horizon mode, and scenario delay.
    Enforces deterministic heuristic ranking and refuses to declare a winner if any site series is unavailable.
    """
    active_solar = solar_service or HorizonsSolarAdapter()

    base_start_dt = parse_strict_utc(req.start_utc, "start_utc")
    base_end_dt = parse_strict_utc(req.end_utc, "end_utc")
    delay_delta = timedelta(hours=req.delay_hours)
    eff_start_utc = format_utc_z(base_start_dt + delay_delta)
    eff_end_utc = format_utc_z(base_end_dt + delay_delta)

    site_summaries: list[SiteComparisonSummary] = []
    all_warnings: list[str] = []
    effective_modes: set[str] = set()

    for sid in req.site_ids:
        summary, site_warnings, eff_mode = _evaluate_single_site_for_window(
            site_id=sid,
            start_utc=req.start_utc,
            end_utc=req.end_utc,
            req=req,
            delay_hours=req.delay_hours,
            solar_service=active_solar,
            custom_horizon_fn=custom_horizon_fn,
        )
        site_summaries.append(summary)
        effective_modes.add(eff_mode)
        for w in site_warnings:
            if w not in all_warnings:
                all_warnings.append(w)

    # Calculate baseline (0h delay) vs delayed sensitivity delta
    delay_sensitivity: list[BaselineDeltaSummary] = []
    for delayed_sum in site_summaries:
        if req.delay_hours == 0.0:
            base_sum = delayed_sum
        else:
            base_sum, _, _ = _evaluate_single_site_for_window(
                site_id=delayed_sum.site.site_id,
                start_utc=req.start_utc,
                end_utc=req.end_utc,
                req=req,
                delay_hours=0.0,
                solar_service=active_solar,
                custom_horizon_fn=custom_horizon_fn,
            )

        def _diff(a: Optional[float], b: Optional[float]) -> Optional[float]:
            if a is None or b is None:
                return None
            return round(b - a, 4)

        delay_sensitivity.append(
            BaselineDeltaSummary(
                site_id=delayed_sum.site.site_id,
                baseline_earth_visible_hours=base_sum.earth_visible_hours,
                delayed_earth_visible_hours=delayed_sum.earth_visible_hours,
                delta_earth_visible_hours=_diff(base_sum.earth_visible_hours, delayed_sum.earth_visible_hours),
                baseline_longest_blackout_hours=base_sum.longest_earth_blackout_hours,
                delayed_longest_blackout_hours=delayed_sum.longest_earth_blackout_hours,
                delta_longest_blackout_hours=_diff(
                    base_sum.longest_earth_blackout_hours, delayed_sum.longest_earth_blackout_hours
                ),
                baseline_overlap_hours=base_sum.overlap_solar_earth_hours,
                delayed_overlap_hours=delayed_sum.overlap_solar_earth_hours,
                delta_overlap_hours=_diff(base_sum.overlap_solar_earth_hours, delayed_sum.overlap_solar_earth_hours),
            )
        )

    ranking_rule = (
        "Heuristic decision rule (not a certified NASA index): "
        "(1) Exclude decision if any site series is unavailable; "
        "(2) Order by number of minimum visibility constraints satisfied (0..2); "
        "(3) Order by temporal overlap hours (Solar ∩ Earth) at identical sampling step; "
        "(4) Deterministic tie-breaker by site_id."
    )

    any_unavailable = any(
        s.quality == "unavailable" or s.meets_constraints == "unknown" for s in site_summaries
    )

    if any_unavailable:
        preferred_site_id = None
        ranking_order = []
        consolidated_quality = "unavailable"
        decision_explanation = (
            "Comparison decision is unknown: one or more required solar or Earth ephemeris series are "
            "unavailable. In accordance with mission quality rules, no preferred landing site is declared."
        )
    else:
        sorted_sites = sorted(
            site_summaries,
            key=lambda s: (
                -(s.constraints_satisfied_count or 0),
                -(s.overlap_solar_earth_hours or 0.0),
                -(s.earth_visible_hours or 0.0),
                s.site.site_id,
            ),
        )
        ranking_order = [s.site.site_id for s in sorted_sites]
        winner = sorted_sites[0]
        runner_up = sorted_sites[1]
        preferred_site_id = winner.site.site_id

        if any(s.quality == "degraded" for s in site_summaries):
            consolidated_quality = "degraded"
        elif any(s.quality == "terrain_unavailable" for s in site_summaries):
            consolidated_quality = "terrain_unavailable"
        elif "terrain" in effective_modes and len(effective_modes) == 1:
            consolidated_quality = "verified_horizons_terrain"
        else:
            consolidated_quality = "verified_horizons_flat"

        delay_clause = (
            f" after applying a +{req.delay_hours:g}h scenario shift ({eff_start_utc} to {eff_end_utc})"
            if req.delay_hours > 0
            else ""
        )
        decision_explanation = (
            f"{winner.explanation} "
            f"Preferred under selected constraints{delay_clause}: {winner.site.site_id.upper()} ({winner.site.name}) "
            f"achieves {winner.overlap_solar_earth_hours}h of joint Solar ∩ Earth geometric visibility "
            f"({winner.earth_visible_hours}h Earth LoS, {winner.longest_earth_blackout_hours}h max blackout) "
            f"vs {runner_up.site.site_id.upper()} with {runner_up.overlap_solar_earth_hours}h joint overlap "
            f"({runner_up.earth_visible_hours}h Earth LoS, {runner_up.longest_earth_blackout_hours}h max blackout). "
            "Note: This ranking uses a transparent heuristic rule, not an official NASA mission certification index."
        )

    effective_horizon_mode = "terrain" if effective_modes == {"terrain"} else "flat"

    return CompareResponse(
        query=req.model_dump(),
        base_start_utc=req.start_utc,
        base_end_utc=req.end_utc,
        effective_start_utc=eff_start_utc,
        effective_end_utc=eff_end_utc,
        delay_hours=req.delay_hours,
        requested_horizon_mode=req.horizon_mode,
        effective_horizon_mode=effective_horizon_mode,
        consolidated_quality=consolidated_quality,
        preferred_site_id=preferred_site_id,
        preference_label="Preferred under selected constraints",
        ranking_order=ranking_order,
        ranking_rule=ranking_rule,
        decision_explanation=decision_explanation,
        warnings=all_warnings,
        sites=site_summaries,
        delay_sensitivity=delay_sensitivity,
        provenance={
            "earth_source": "JPL Horizons (Earth 399 · DE441)",
            "solar_source": "JPL Horizons (Sun 10 · DE441 / SolarServiceProtocol)",
            "terrain_source": "NASA GSFC PGDA LRO-LOLA 5m/pix (Product 78)",
            "interval_convention": "[start_utc, end_utc)",
            "visibility_model": "Geometric line of sight to body center; does not guarantee RF link closure or power generation.",
        },
    )
