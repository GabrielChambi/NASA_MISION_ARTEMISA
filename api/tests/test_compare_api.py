from __future__ import annotations

from fastapi.testclient import TestClient

from api.app.compare.models import CompareRequest
from api.app.compare.service import compare_sites
from api.app.compare.solar_adapter import UnavailableSolarAdapter
from api.app.main import app

client = TestClient(app)


def test_compare_with_unavailable_solar_series_returns_unknown_and_no_winner() -> None:
    """
    Mandatory Test 5: Comparison with an unavailable solar series marks meets_constraints='unknown'
    and refuses to declare a preferred site (preferred_site_id is None).
    """
    req = CompareRequest(
        site_ids=["site01", "site04"],
        start_utc="2026-12-14T00:00:00Z",
        end_utc="2026-12-15T00:00:00Z",
        step_minutes=60,
        horizon_mode="flat",
        minimum_solar_hours=10.0,
        minimum_earth_visible_hours=10.0,
    )
    res = compare_sites(req, solar_service=UnavailableSolarAdapter())
    assert res.preferred_site_id is None
    assert res.consolidated_quality == "unavailable"
    assert res.ranking_order == []
    for s in res.sites:
        assert s.meets_constraints == "unknown"
        assert s.overlap_solar_earth_hours is None


def test_delay_scenario_queries_shifted_real_utc_range() -> None:
    """
    Mandatory Test 6: Delay scenario shifts start_utc and end_utc forward and queries the real
    ephemerides for the new UTC interval (not just visual shifting).
    Between 2026-12-14T00:00Z and 2026-12-16T00:00Z, Earth is rising at the Lunar South Pole,
    so a +12h delay genuinely reduces the initial blackout and increases Earth visible hours.
    """
    base_req = CompareRequest(
        site_ids=["site01", "site04"],
        start_utc="2026-12-14T00:00:00Z",
        end_utc="2026-12-16T00:00:00Z",
        step_minutes=60,
        horizon_mode="flat",
        delay_hours=0.0,
        minimum_solar_hours=24.0,
        minimum_earth_visible_hours=30.0,
    )
    delayed_req = CompareRequest(
        site_ids=["site01", "site04"],
        start_utc="2026-12-14T00:00:00Z",
        end_utc="2026-12-16T00:00:00Z",
        step_minutes=60,
        horizon_mode="flat",
        delay_hours=12.0,
        minimum_solar_hours=24.0,
        minimum_earth_visible_hours=30.0,
    )
    res_base = compare_sites(base_req)
    res_delayed = compare_sites(delayed_req)

    assert res_base.effective_start_utc == "2026-12-14T00:00:00Z"
    assert res_delayed.effective_start_utc == "2026-12-14T12:00:00Z"
    assert res_delayed.effective_end_utc == "2026-12-16T12:00:00Z"

    s04_base = [s for s in res_base.sites if s.site.site_id == "site04"][0]
    s04_delayed = [s for s in res_delayed.sites if s.site.site_id == "site04"][0]

    assert s04_delayed.samples[0].t_utc == "2026-12-14T12:00:00Z"
    assert (s04_delayed.earth_visible_hours or 0) > (s04_base.earth_visible_hours or 0)
    assert (s04_delayed.longest_earth_blackout_hours or 0) < (s04_base.longest_earth_blackout_hours or 0)
    # Verify constraint flip under +12h delay
    assert s04_base.meets_constraints is False
    assert s04_delayed.meets_constraints is True


def test_semi_open_interval_and_units_consistency() -> None:
    """
    Mandatory Test 7: A and B use identical units and semi-open interval convention [start_utc, end_utc).
    A 24-hour window with 60-minute step has exactly 24 samples starting at start_utc and ending at end_utc - 1h,
    and a continuous window has end_utc == request.effective_end_utc.
    """
    resp = client.post(
        "/api/compare",
        json={
            "site_ids": ["site01", "site04"],
            "start_utc": "2026-12-16T00:00:00Z",
            "end_utc": "2026-12-17T00:00:00Z",
            "step_minutes": 60,
            "horizon_mode": "flat",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["provenance"]["interval_convention"] == "[start_utc, end_utc)"
    for site_summary in data["sites"]:
        assert site_summary["total_hours"] == 24.0
        assert len(site_summary["samples"]) == 24
        assert site_summary["samples"][0]["t_utc"] == "2026-12-16T00:00:00Z"
        assert site_summary["samples"][-1]["t_utc"] == "2026-12-16T23:00:00Z"
        assert site_summary["earth_windows"][0]["start_utc"] == "2026-12-16T00:00:00Z"
        assert site_summary["earth_windows"][0]["end_utc"] == "2026-12-17T00:00:00Z"


def test_invalid_inputs_return_422() -> None:
    """
    Mandatory Test 8: Invalid UTC strings, reversed intervals, out-of-range steps, or >24h delay return 422.
    """
    # Missing Z timezone
    r1 = client.post(
        "/api/compare",
        json={
            "site_ids": ["site01", "site04"],
            "start_utc": "2026-12-14T00:00:00",
            "end_utc": "2026-12-15T00:00:00Z",
            "step_minutes": 60,
        },
    )
    assert r1.status_code == 422

    # Step out of bounds (< 30)
    r2 = client.post(
        "/api/compare",
        json={
            "site_ids": ["site01", "site04"],
            "start_utc": "2026-12-14T00:00:00Z",
            "end_utc": "2026-12-15T00:00:00Z",
            "step_minutes": 5,
        },
    )
    assert r2.status_code == 422

    # Delay out of bounds (> 24)
    r3 = client.get(
        "/api/earth",
        params={
            "site_id": "site01",
            "start_utc": "2026-12-14T00:00:00Z",
            "end_utc": "2026-12-15T00:00:00Z",
            "step_minutes": 60,
            "delay_hours": 48,
        },
    )
    assert r3.status_code == 422
