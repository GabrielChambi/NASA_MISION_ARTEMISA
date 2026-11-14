from __future__ import annotations

import math
from fastapi.testclient import TestClient

from api.app.earth.horizons import az_el_to_enu_vector, parse_horizons_observer_text
from api.app.earth.models import EarthQueryRequest
from api.app.earth.visibility import compute_earth_visibility
from api.app.main import app

client = TestClient(app)


def test_actual_catalog_coordinates_match_prepared_nasa_earth_samples() -> None:
    """
    Compare real NASA values at the common DEM reference pixels, not the legacy seed coordinates.
    This is a stored NASA response regression; independent JPL checks are in validation.json.
    """
    req_s01 = EarthQueryRequest(
        site_id="site01",
        start_utc="2026-12-14T00:00:00Z",
        end_utc="2026-12-17T00:00:00Z",
        step_minutes=60,
        horizon_mode="flat",
    )
    res_s01 = compute_earth_visibility(req_s01)
    s01_t0 = res_s01.samples[0]
    assert s01_t0.t_utc == "2026-12-14T00:00:00Z"
    assert math.isclose(s01_t0.azimuth_deg, 133.057924, abs_tol=1e-4)
    assert math.isclose(s01_t0.elevation_deg, -1.436344, abs_tol=1e-4)
    assert s01_t0.earth_visible is False

    req_s04 = EarthQueryRequest(
        site_id="site04",
        start_utc="2026-12-14T00:00:00Z",
        end_utc="2026-12-17T00:00:00Z",
        step_minutes=60,
        horizon_mode="flat",
    )
    res_s04 = compute_earth_visibility(req_s04)
    s04_t0 = res_s04.samples[0]
    s04_t24 = [s for s in res_s04.samples if s.t_utc == "2026-12-15T00:00:00Z"][0]
    assert math.isclose(s04_t0.azimuth_deg, 167.454807, abs_tol=1e-4)
    assert math.isclose(s04_t0.elevation_deg, -1.297333, abs_tol=1e-4)
    assert s04_t0.earth_visible is False
    # At 2026-12-15T00:00:00Z, Site04 is already above flat horizon (+0.091028 deg), whereas Site01 is still below (-0.040540 deg)
    assert math.isclose(s04_t24.elevation_deg, 0.091028, abs_tol=1e-4)
    assert s04_t24.earth_visible is True


def test_earth_below_flat_horizon_gives_false_and_exact_blackout() -> None:
    """
    Mandatory Test 2: Earth below flat horizon gives earth_visible=False and exact blackout hours.
    """
    raw = [
        {"t_utc": "2026-12-14T00:00:00Z", "azimuth_deg": 140.0, "elevation_deg": -2.5, "range_km": 400000.0},
        {"t_utc": "2026-12-14T01:00:00Z", "azimuth_deg": 140.2, "elevation_deg": -1.2, "range_km": 400000.0},
        {"t_utc": "2026-12-14T02:00:00Z", "azimuth_deg": 140.4, "elevation_deg": -0.1, "range_km": 400000.0},
    ]
    req = EarthQueryRequest(
        site_id="site01",
        start_utc="2026-12-14T00:00:00Z",
        end_utc="2026-12-14T03:00:00Z",
        step_minutes=60,
        horizon_mode="flat",
    )
    res = compute_earth_visibility(req, custom_raw_samples=raw)
    assert all(not s.earth_visible for s in res.samples)
    assert res.metrics.earth_visible_hours == 0.0
    assert res.metrics.longest_earth_blackout_hours == 3.0
    assert len(res.blackout_windows) == 1
    assert res.blackout_windows[0].start_utc == "2026-12-14T00:00:00Z"
    assert res.blackout_windows[0].end_utc == "2026-12-14T03:00:00Z"


def test_earth_boundary_comparison_consistent_with_solar() -> None:
    """
    Mandatory Test 3: Earth exactly on horizon (elevation == horizon + clearance) is False;
    strictly above (elevation > horizon + clearance) is True, matching solar convention.
    """
    raw = [
        {"t_utc": "2026-12-14T00:00:00Z", "azimuth_deg": 150.0, "elevation_deg": 0.0, "range_km": 400000.0},
        {"t_utc": "2026-12-14T01:00:00Z", "azimuth_deg": 150.0, "elevation_deg": 0.0001, "range_km": 400000.0},
    ]
    req = EarthQueryRequest(
        site_id="site04",
        start_utc="2026-12-14T00:00:00Z",
        end_utc="2026-12-14T02:00:00Z",
        step_minutes=60,
        horizon_mode="flat",
        clearance_deg=0.0,
    )
    res = compute_earth_visibility(req, custom_raw_samples=raw)
    assert res.samples[0].earth_visible is False
    assert res.samples[1].earth_visible is True
    assert res.metrics.earth_visible_hours == 1.0


def test_missing_sample_marks_degraded_quality_without_fabricating_point() -> None:
    """
    Mandatory Test 4: Time series with a missing sample marks quality='degraded'
    and does NOT fabricate or interpolate the missing point.
    """
    # 01:00Z is deliberately missing in a 3-hour window with 60-min step
    raw = [
        {"t_utc": "2026-12-14T00:00:00Z", "azimuth_deg": 135.0, "elevation_deg": 2.0, "range_km": 400000.0},
        {"t_utc": "2026-12-14T02:00:00Z", "azimuth_deg": 136.0, "elevation_deg": 2.5, "range_km": 400000.0},
    ]
    req = EarthQueryRequest(
        site_id="site01",
        start_utc="2026-12-14T00:00:00Z",
        end_utc="2026-12-14T03:00:00Z",
        step_minutes=60,
        horizon_mode="flat",
    )
    res = compute_earth_visibility(req, custom_raw_samples=raw)
    assert res.quality == "degraded"
    assert res.metrics.expected_samples == 3
    assert res.metrics.received_samples == 2
    assert res.metrics.missing_samples == 1
    assert [s.t_utc for s in res.samples] == ["2026-12-14T00:00:00Z", "2026-12-14T02:00:00Z"]
    # Contiguous windows must NOT bridge across the missing 01:00Z gap
    assert len(res.windows) == 2
    assert res.windows[0].start_utc == "2026-12-14T00:00:00Z"
    assert res.windows[0].end_utc == "2026-12-14T01:00:00Z"
    assert res.windows[1].start_utc == "2026-12-14T02:00:00Z"
    assert res.windows[1].end_utc == "2026-12-14T03:00:00Z"


def test_terrain_mode_uses_actual_partial_lola_horizon_without_flat_substitution() -> None:
    """
    Terrain is available and partial: preserve the requested model and report its limits.
    """
    resp = client.post(
        "/api/earth",
        json={
            "site_id": "site04",
            "start_utc": "2026-12-14T00:00:00Z",
            "end_utc": "2026-12-17T00:00:00Z",
            "step_minutes": 60,
            "horizon_mode": "terrain",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["quality"] == "degraded"
    assert data["provenance"]["requested_horizon_mode"] == "terrain"
    assert data["provenance"]["effective_horizon_mode"] == "terrain"
    assert any('finite' in w or 'uncertainty' in w for w in data['warnings'])
    assert any(s['local_horizon_deg'] != 0 for s in data['samples'])


def test_3d_enu_vectors_and_terrain_mesh_ready_for_3d() -> None:
    """
    Verify 3D ENU unit vectors have unit norm and real LRO-LOLA 3D surface mesh is attached.
    """
    v_zenith = az_el_to_enu_vector(0.0, 90.0)
    assert math.isclose(v_zenith[2], 1.0, abs_tol=1e-6)
    resp = client.post(
        "/api/earth",
        json={
            "site_id": "site01",
            "start_utc": "2026-12-14T00:00:00Z",
            "end_utc": "2026-12-17T00:00:00Z",
            "step_minutes": 60,
        },
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["terrain_mesh_3d"] is not None
    assert payload["terrain_mesh_3d"]["grid_size"] == 65
    for s in payload["samples"]:
        vx, vy, vz = s["enu_vector"]
        norm = math.sqrt(vx * vx + vy * vy + vz * vz)
        assert math.isclose(norm, 1.0, abs_tol=1e-4)


def test_horizons_soe_eoe_parser() -> None:
    sample_block = """
$$SOE
 2026-Dec-14 00:00,*,i, 133.057924,    -1.436344,  0.00269550259334, -0.0290594,
$$EOE
"""
    parsed = parse_horizons_observer_text(sample_block)
    assert len(parsed) == 1
    assert parsed[0]["t_utc"] == "2026-12-14T00:00:00Z"
    assert math.isclose(parsed[0]["azimuth_deg"], 133.057924, abs_tol=1e-6)
    assert math.isclose(parsed[0]["elevation_deg"], -1.436344, abs_tol=1e-6)
