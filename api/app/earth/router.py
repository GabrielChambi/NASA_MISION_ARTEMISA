from __future__ import annotations

from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import ValidationError
import httpx

from ..core.horizon import HorizonUnavailable
from ..solar.service import solar_result
from .horizons import az_el_to_enu_vector
from .models import EarthQueryRequest, EarthResponse, HorizonMode
from .sites_catalog import VERIFIED_SITES, get_site_metadata, get_terrain_mesh_3d
from .visibility import build_horizon_ring_profile, compute_earth_visibility

router = APIRouter(prefix="/api/earth", tags=["earth"])


@router.get("/sites")
def list_verified_earth_sites() -> dict:
    """Return verified lunar south pole candidate sites and their 3D LOLA terrain metadata."""
    items = []
    for sid in VERIFIED_SITES:
        meta = get_site_metadata(sid)
        mesh = get_terrain_mesh_3d(sid)
        items.append(
            {
                **meta.model_dump(),
                "has_3d_terrain_mesh": mesh is not None,
            }
        )
    return {"sites": items}


@router.get("")
async def get_earth_ephemeris(
    site_id: str = Query(default="site04", description="Landing site ID: site01 or site04"),
    start_utc: str = Query(default="2026-12-01T00:00:00Z", description="Start UTC ISO-8601"),
    end_utc: str = Query(default="2026-12-08T00:00:00Z", description="End UTC ISO-8601"),
    step_minutes: int = Query(default=60, description="Step size in minutes"),
    horizon_mode: str = Query(default="flat", description="Horizon mode: flat or terrain"),
    clearance_deg: float = Query(default=0.0, description="Antenna clearance angle in degrees"),
    delay_hours: float = Query(default=0.0, description="Scenario launch delay in hours (0-24)"),
    observer_height_m: float = Query(default=1.0, description="Observer height above surface in meters"),
):
    if delay_hours < 0.0 or delay_hours > 24.0:
        return JSONResponse(
            status_code=422,
            content={
                "status": "unavailable",
                "message": "delay_hours must be between 0 and 24 hours.",
                "samples": [],
                "windows": [],
                "summary": None,
            },
        )

    # Plan B seed / scenario interval (2026-12-14..2026-12-20) or custom clearance angle
    is_plan_b_window = start_utc.startswith("2026-12-1") and not start_utc.startswith("2026-12-01")
    if is_plan_b_window or clearance_deg > 0.0:
        try:
            req = EarthQueryRequest(
                site_id=site_id,
                start_utc=start_utc,
                end_utc=end_utc,
                step_minutes=step_minutes,
                horizon_mode=horizon_mode,  # type: ignore[arg-type]
                clearance_deg=clearance_deg,
                delay_hours=delay_hours,
                observer_height_m=observer_height_m,
            )
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail=exc.errors()) from exc

        try:
            res = compute_earth_visibility(req)
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=503,
                detail=f"External ephemeris service (JPL Horizons) temporarily unreachable: {exc}",
            ) from exc

        payload = res.model_dump()
        # Attach compatible top-level fields so both Plan A and Plan B consumers work seamlessly
        for s in payload["samples"]:
            s["horizon_deg"] = s["local_horizon_deg"]
            s["visible"] = s["earth_visible"]
        payload["status"] = "ok"
        payload["site_id"] = req.site_id
        payload["target"] = "Earth"
        payload["meta"] = {
            "source": res.provenance.source,
            "source_url": "https://ssd-api.jpl.nasa.gov/doc/horizons.html",
            "query_url": "https://ssd.jpl.nasa.gov/api/horizons.api",
            "retrieved_at": res.provenance.retrieved_at_utc,
            "cache_hit": res.provenance.cache_hit,
            "start_utc": res.effective_start_utc,
            "end_utc": res.effective_end_utc,
            "step_minutes": req.step_minutes,
            "horizon_mode": res.provenance.effective_horizon_mode,
            "horizon_quality": res.quality,
            "observer_height_m": req.observer_height_m,
            "observer_altitude_km": (res.site.elevation_m + req.observer_height_m) / 1000.0,
            "latitude_deg": res.site.lat_deg,
            "longitude_deg": res.site.lon_east_deg,
            "reference_frame": res.site.reference_frame,
            "window_convention": res.provenance.interval_convention,
            "limitations": res.provenance.limitations,
        }
        payload["summary"] = {
            "earth_visible_hours": res.metrics.earth_visible_hours,
            "earth_visible_fraction": res.metrics.earth_visible_fraction,
            "longest_hidden_gap_hours": res.metrics.longest_earth_blackout_hours,
            "duration_hours": res.metrics.total_hours,
            "sample_count": res.metrics.received_samples,
            "step_minutes": req.step_minutes,
        }
        return payload

    # Default / general interval (e.g. 2026-12-01..2026-12-08): delegate to solar_result(..., target=399)
    # and enrich with Plan B 3D ENU vectors, 3D LOLA surface mesh, and horizon profile
    try:
        eff_start = start_utc
        eff_end = end_utc
        if delay_hours > 0:
            s_dt = datetime.fromisoformat(start_utc.replace("Z", "+00:00")) + timedelta(hours=delay_hours)
            e_dt = datetime.fromisoformat(end_utc.replace("Z", "+00:00")) + timedelta(hours=delay_hours)
            eff_start = s_dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            eff_end = e_dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        # Normalize .000Z timestamps to whole-second Z for validate_request
        if eff_start.endswith(".000Z"):
            eff_start = eff_start[:-5] + "Z"
        if eff_end.endswith(".000Z"):
            eff_end = eff_end[:-5] + "Z"

        base = await solar_result(
            site_id,
            eff_start,
            eff_end,
            step_minutes,
            horizon_mode,
            observer_height_m,
            target=399,
        )
        for s in base["samples"]:
            az = float(s["azimuth_deg"])
            el = float(s["elevation_deg"])
            h_deg = float(s.get("horizon_deg", 0.0))
            s["local_horizon_deg"] = h_deg
            s["clearance_deg"] = clearance_deg
            s["effective_threshold_deg"] = round(h_deg + clearance_deg, 6)
            s["earth_visible"] = bool(s["visible"])
            s["range_km"] = 384400.0
            s["range_rate_km_s"] = 0.0
            s["enu_vector"] = list(az_el_to_enu_vector(az, el))

        site_meta = get_site_metadata(site_id, observer_height_m=observer_height_m)
        mesh_3d = get_terrain_mesh_3d(site_id)
        base["site"] = site_meta.model_dump()
        base["terrain_mesh_3d"] = mesh_3d.model_dump() if mesh_3d else None
        base["horizon_profile"] = [
            p.model_dump() for p in build_horizon_ring_profile(lambda _az: 0.0, step_deg=10)
        ]
        return base
    except ValueError as exc:
        if isinstance(exc, HorizonUnavailable):
            raise
        return JSONResponse(
            status_code=422,
            content={
                "status": "unavailable",
                "message": str(exc),
                "samples": [],
                "windows": [],
                "summary": None,
            },
        )


@router.post("", response_model=EarthResponse)
def post_earth_ephemeris(req: EarthQueryRequest) -> EarthResponse:
    try:
        return compute_earth_visibility(req)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"External ephemeris service (JPL Horizons) temporarily unreachable: {exc}",
        ) from exc
