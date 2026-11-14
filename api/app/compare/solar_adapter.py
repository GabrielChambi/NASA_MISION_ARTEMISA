from __future__ import annotations

import importlib
from datetime import timedelta
from typing import Any, Optional, Protocol

from ..earth.horizons import az_el_to_enu_vector, fetch_topocentric_ephemeris
from ..earth.models import HorizonMode, SiteMetadata, format_utc_z, parse_strict_utc
from ..earth.visibility import resolve_horizon_evaluator


class SolarSeriesResult:
    """Standardized solar visibility series returned by SolarServiceProtocol."""

    def __init__(
        self,
        status: str,
        source: str,
        samples: list[dict[str, Any]],
        visible_hours: Optional[float],
        visible_fraction: Optional[float],
        longest_dark_gap_hours: Optional[float],
        warnings: Optional[list[str]] = None,
    ) -> None:
        self.status = status  # "verified_horizons", "test_fixture", "unavailable"
        self.source = source
        self.samples = samples
        self.visible_hours = visible_hours
        self.visible_fraction = visible_fraction
        self.longest_dark_gap_hours = longest_dark_gap_hours
        self.warnings = warnings or []


class SolarServiceProtocol(Protocol):
    """Protocol isolating Member A's SolarService so Member B never modifies api/app/solar/**."""

    def get_solar_series(
        self,
        site: SiteMetadata,
        start_utc: str,
        end_utc: str,
        step_minutes: int,
        horizon_mode: HorizonMode,
    ) -> SolarSeriesResult:
        ...


class UnavailableSolarAdapter:
    """Explicit unavailable solar adapter for testing unknown constraint handling."""

    def get_solar_series(
        self,
        site: SiteMetadata,
        start_utc: str,
        end_utc: str,
        step_minutes: int,
        horizon_mode: HorizonMode,
    ) -> SolarSeriesResult:
        return SolarSeriesResult(
            status="unavailable",
            source="SolarService unavailable",
            samples=[],
            visible_hours=None,
            visible_fraction=None,
            longest_dark_gap_hours=None,
            warnings=[f"Solar ephemeris series for {site.site_id} is currently unavailable."],
        )


class HorizonsSolarAdapter:
    """
    Production adapter that delegates to Member A's api.app.solar if present,
    or queries real NASA JPL Horizons (body '10' = Sun) from lunar topocentric observer (coord@301)
    without touching api/app/solar/**.
    """

    def get_solar_series(
        self,
        site: SiteMetadata,
        start_utc: str,
        end_utc: str,
        step_minutes: int,
        horizon_mode: HorizonMode,
    ) -> SolarSeriesResult:
        # 1. Try Member A's solar service if present in repository
        try:
            solar_mod = importlib.import_module("api.app.solar.service")
            if hasattr(solar_mod, "get_solar_series"):
                return solar_mod.get_solar_series(
                    site=site,
                    start_utc=start_utc,
                    end_utc=end_utc,
                    step_minutes=step_minutes,
                    horizon_mode=horizon_mode,
                )
        except ModuleNotFoundError:
            pass

        # 2. Query real NASA JPL Horizons for Sun (COMMAND='10') from lunar topocentric site
        try:
            raw_samples, _cache_hit = fetch_topocentric_ephemeris(
                site=site,
                start_utc=start_utc,
                end_utc=end_utc,
                step_minutes=step_minutes,
                target_command="10",
            )
        except Exception as exc:
            return SolarSeriesResult(
                status="unavailable",
                source="JPL Horizons (Sun 10 unreachable)",
                samples=[],
                visible_hours=None,
                visible_fraction=None,
                longest_dark_gap_hours=None,
                warnings=[f"Solar service unreachable for {site.site_id}: {exc}"],
            )

        horizon_fn, eff_mode, terrain_ok, terrain_warn = resolve_horizon_evaluator(site.site_id, horizon_mode)

        start_dt = parse_strict_utc(start_utc, "start_utc")
        end_dt = parse_strict_utc(end_utc, "end_utc")
        by_ts = {s["t_utc"]: s for s in raw_samples}

        evaluated: list[dict[str, Any]] = []
        cur = start_dt
        step_hours = step_minutes / 60.0
        cur_dark_hours = 0.0
        longest_dark_hours = 0.0
        visible_count = 0
        expected_count = 0

        while cur < end_dt:
            ts = format_utc_z(cur)
            expected_count += 1
            if ts in by_ts:
                raw = by_ts[ts]
                az = float(raw["azimuth_deg"])
                el = float(raw["elevation_deg"])
                h_deg = float(horizon_fn(az))
                # Consistent strict comparison: sun_elevation_deg > local_horizon_deg
                vis = bool(el > h_deg)
                if vis:
                    visible_count += 1
                    cur_dark_hours = 0.0
                else:
                    cur_dark_hours += step_hours
                    if cur_dark_hours > longest_dark_hours:
                        longest_dark_hours = cur_dark_hours
                evaluated.append(
                    {
                        "t_utc": ts,
                        "azimuth_deg": round(az, 6),
                        "elevation_deg": round(el, 6),
                        "local_horizon_deg": round(h_deg, 6),
                        "sun_visible": vis,
                        "enu_vector": raw.get("enu_vector") or az_el_to_enu_vector(az, el),
                    }
                )
            cur += timedelta(minutes=step_minutes)

        if not evaluated:
            return SolarSeriesResult(
                status="unavailable",
                source="JPL Horizons (Sun 10 empty)",
                samples=[],
                visible_hours=None,
                visible_fraction=None,
                longest_dark_gap_hours=None,
                warnings=[f"No solar samples returned for {site.site_id}."],
            )

        vis_hours = round(visible_count * step_hours, 4)
        vis_frac = round(visible_count / expected_count, 4) if expected_count > 0 else 0.0
        warnings = [terrain_warn] if terrain_warn else []
        status = (
            "terrain_unavailable"
            if (horizon_mode == "terrain" and not terrain_ok)
            else f"verified_horizons_{eff_mode}"
        )
        return SolarSeriesResult(
            status=status,
            source="JPL Horizons (Sun 10 · DE441)",
            samples=evaluated,
            visible_hours=vis_hours,
            visible_fraction=vis_frac,
            longest_dark_gap_hours=round(longest_dark_hours, 4),
            warnings=warnings,
        )
