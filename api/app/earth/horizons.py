from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional
import httpx

from .models import AU_TO_KM, SiteMetadata, format_utc_z, parse_strict_utc

HORIZONS_API_URL = "https://ssd.jpl.nasa.gov/api/horizons.api"
_HERE = Path(__file__).resolve().parent
_SEED_PATH = _HERE / "seed_ephemeris.json"
_CACHE_DIR = _HERE / ".cache"

_MONTH_MAP = {
    "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
    "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12,
}


def az_el_to_enu_vector(azimuth_deg: float, elevation_deg: float) -> tuple[float, float, float]:
    """
    Convert topocentric azimuth (0=North, 90=East) and elevation (-90..+90 deg)
    into a 3D unit vector [east, north, up] ready for 3D WebGL / Three.js scenes.
    """
    az_rad = math.radians(azimuth_deg)
    el_rad = math.radians(elevation_deg)
    cos_el = math.cos(el_rad)
    east = round(cos_el * math.sin(az_rad), 6)
    north = round(cos_el * math.cos(az_rad), 6)
    up = round(math.sin(el_rad), 6)
    return (east, north, up)


def parse_horizons_timestamp(raw_ts: str) -> str:
    """Convert '2026-Dec-14 00:00' or '2026-Dec-14 00:00:00' into '2026-12-14T00:00:00Z'."""
    parts = raw_ts.strip().split()
    if len(parts) < 2:
        raise ValueError(f"Unrecognized Horizons timestamp: '{raw_ts}'")
    date_part, time_part = parts[0], parts[1]
    ymd = date_part.split("-")
    if len(ymd) != 3:
        raise ValueError(f"Unrecognized Horizons date: '{date_part}'")
    year = int(ymd[0])
    month = _MONTH_MAP.get(ymd[1], 0)
    if month == 0:
        month = int(ymd[1])
    day = int(ymd[2])
    hms = time_part.split(":")
    hour = int(hms[0])
    minute = int(hms[1])
    second = int(float(hms[2])) if len(hms) > 2 else 0
    dt = datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc)
    return format_utc_z(dt)


def parse_horizons_observer_text(raw_text: str) -> list[dict[str, Any]]:
    """
    Parse JPL Horizons observer table text between $$SOE and $$EOE.
    Expects CSV_FORMAT='YES' with QUANTITIES='4,20' (or '4'):
      Date__(UT)__HR:MN, <solar_presence>, <lunar_presence>, Azi_(a-app), Elev_(a-app), [delta, deldot]
    Never fabricates or interpolates missing points.
    """
    if "$$SOE" not in raw_text or "$$EOE" not in raw_text:
        raise ValueError("JPL Horizons response missing $$SOE / $$EOE ephemeris markers")

    block = raw_text.split("$$SOE", 1)[1].split("$$EOE", 1)[0]
    samples: list[dict[str, Any]] = []

    for raw_line in block.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        cols = [c.strip() for c in line.split(",")]
        if len(cols) < 5:
            continue
        try:
            t_utc = parse_horizons_timestamp(cols[0])
            az_deg = float(cols[3])
            el_deg = float(cols[4])
        except (ValueError, IndexError):
            continue

        delta_au = 0.002569555
        deldot_km_s = 0.0
        if len(cols) >= 7:
            try:
                delta_au = float(cols[5])
                deldot_km_s = float(cols[6])
            except ValueError:
                pass

        range_km = round(delta_au * AU_TO_KM, 2)
        samples.append(
            {
                "t_utc": t_utc,
                "azimuth_deg": round(az_deg, 6),
                "elevation_deg": round(el_deg, 6),
                "range_km": range_km,
                "range_rate_km_s": round(deldot_km_s, 6),
                "enu_vector": az_el_to_enu_vector(az_deg, el_deg),
                "solar_elongation_note": cols[2] if cols[2] else None,
            }
        )
    return samples


def build_horizons_params(
    target_command: str,
    site: SiteMetadata,
    start_dt: datetime,
    end_dt: datetime,
    step_minutes: int,
) -> dict[str, str]:
    """
    Build verified JPL Horizons OBSERVER query parameters for a lunar topocentric site on body 301.
    """
    total_height_km = (site.elevation_m + site.observer_height_m) / 1000.0
    site_coord = f"{site.lon_east_deg:.6f},{site.lat_deg:.6f},{total_height_km:.5f}"
    start_str = start_dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M")
    stop_str = end_dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M")
    return {
        "format": "json",
        "COMMAND": f"'{target_command}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{site_coord}'",
        "START_TIME": f"'{start_str}'",
        "STOP_TIME": f"'{stop_str}'",
        "STEP_SIZE": f"'{step_minutes} m'",
        "QUANTITIES": "'4,20'",
        "TIME_TYPE": "'UT'",
        "CSV_FORMAT": "'YES'",
        "ANG_FORMAT": "'DEG'",
    }


def _try_seed_lookup(
    site_id: str,
    target_command: str,
    start_dt: datetime,
    end_dt: datetime,
    step_minutes: int,
) -> Optional[list[dict[str, Any]]]:
    """Check if the requested range is covered by the pre-verified JPL Horizons 30-min seed archive."""
    if step_minutes % 30 != 0 or not _SEED_PATH.exists():
        return None
    try:
        seed_data = json.loads(_SEED_PATH.read_text(encoding="utf-8"))
    except Exception:
        return None

    for key, raw_text in seed_data.items():
        if not key.startswith(f"{site_id}:{target_command}:"):
            continue
        all_samples = parse_horizons_observer_text(raw_text)
        by_ts = {s["t_utc"]: s for s in all_samples}
        expected_ts: list[str] = []
        cur = start_dt
        # Semi-open interval [start_utc, end_utc)
        while cur < end_dt:
            expected_ts.append(format_utc_z(cur))
            cur += timedelta(minutes=step_minutes)
        if expected_ts and all(ts in by_ts for ts in expected_ts):
            return [by_ts[ts] for ts in expected_ts]
    return None


def fetch_topocentric_ephemeris(
    site: SiteMetadata,
    start_utc: str,
    end_utc: str,
    step_minutes: int,
    target_command: str = "399",
    timeout_s: float = 15.0,
) -> tuple[list[dict[str, Any]], bool]:
    """
    Fetch topocentric ephemeris samples for the semi-open interval [start_utc, end_utc).
    Returns (samples, cache_hit).
    """
    start_dt = parse_strict_utc(start_utc, "start_utc")
    end_dt = parse_strict_utc(end_utc, "end_utc")

    # 1. Check verified seed archive
    seeded = _try_seed_lookup(site.site_id, target_command, start_dt, end_dt, step_minutes)
    if seeded is not None:
        return seeded, True

    # 2. Check local disk cache
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_key_raw = (
        f"{site.site_id}:{target_command}:{site.lon_east_deg:.5f}:{site.lat_deg:.5f}:"
        f"{site.elevation_m + site.observer_height_m:.2f}:{format_utc_z(start_dt)}:"
        f"{format_utc_z(end_dt)}:{step_minutes}"
    )
    cache_hash = hashlib.sha256(cache_key_raw.encode("utf-8")).hexdigest()[:24]
    cache_file = _CACHE_DIR / f"{cache_hash}.json"
    if cache_file.exists():
        try:
            cached_samples = json.loads(cache_file.read_text(encoding="utf-8"))
            return cached_samples, True
        except Exception:
            pass

    # 3. Query live NASA JPL Horizons API
    params = build_horizons_params(target_command, site, start_dt, end_dt, step_minutes)
    with httpx.Client(timeout=timeout_s) as client:
        resp = client.get(HORIZONS_API_URL, params=params)
        resp.raise_for_status()
        payload = resp.json()

    result_text = payload.get("result", "")
    parsed_all = parse_horizons_observer_text(result_text)

    # Filter strictly to semi-open interval [start_dt, end_dt)
    end_iso = format_utc_z(end_dt)
    start_iso = format_utc_z(start_dt)
    filtered = [s for s in parsed_all if start_iso <= s["t_utc"] < end_iso]

    try:
        cache_file.write_text(json.dumps(filtered), encoding="utf-8")
    except Exception:
        pass

    return filtered, False
