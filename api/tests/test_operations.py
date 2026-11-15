import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.app import operations


def _series(target: str):
    rows = []
    for hour in range(3):
        rows.append({
            "t_utc": f"2026-12-30T0{hour}:00:00Z",
            "azimuth_deg": 180,
            "elevation_deg": 45,
            "horizon_deg": 0,
            "visible": True,
            "range_km": 149597870.7 if target == "Sun" else 384400,
        })
    return {
        "status": "ok",
        "target": target,
        "meta": {"start_utc": rows[0]["t_utc"], "end_utc": rows[-1]["t_utc"]},
        "samples": rows,
    }


@pytest.fixture
def client(monkeypatch, tmp_path):
    async def fake_solar_result(*args, target=10, **kwargs):
        return _series("Sun" if target == 10 else "Earth")

    monkeypatch.setattr(operations, "solar_result", fake_solar_result)
    monkeypatch.setenv("LUNAR_ORACLE_STATE_DB", str(tmp_path / "operations.sqlite3"))
    app = FastAPI()
    app.include_router(operations.router)
    return TestClient(app)


def _plan():
    return {
        "site_id": "site04",
        "start_utc": "2026-12-30T00:00:00Z",
        "end_utc": "2026-12-30T02:00:00Z",
        "vehicle": {
            "vehicle_id": "vehicle-real-id",
            "battery_capacity_wh": 1000,
            "initial_battery_wh": 500,
            "minimum_battery_wh": 100,
            "memory_capacity_mb": 1000,
            "initial_memory_mb": 0,
            "base_load_w": 10,
            "panel_area_m2": 1,
            "panel_efficiency": 0.2,
            "panel_azimuth_deg": 180,
            "panel_elevation_deg": 45,
        },
        "activities": [{
            "activity_id": "measurement-1",
            "kind": "measurement",
            "start_utc": "2026-12-30T00:00:00Z",
            "end_utc": "2026-12-30T01:00:00Z",
            "power_w": 20,
            "memory_rate_mb_per_hour": 5,
        }],
    }


def test_plan_uses_real_series_and_persists_prediction(client):
    response = client.post("/api/operations/plan", json=_plan())
    assert response.status_code == 200
    result = response.json()
    assert result["feasible"] is True
    assert result["schedule"][0]["solar_flux_w_m2"] == pytest.approx(1361)
    assert result["provenance"]["interval_convention"] == "[start_utc, end_utc), left sample"

    observation = client.post("/api/operations/observations", json={
        "vehicle_id": "vehicle-real-id",
        "timestamp_utc": "2026-12-30T00:00:00Z",
        "source": "vehicle telemetry export 2026-12-30",
        "battery_wh": result["schedule"][0]["battery_wh"] - 10,
    })
    assert observation.status_code == 200
    assert observation.json()["prediction_check"]["prediction_status"] == "compared"
    assert observation.json()["prediction_check"]["residuals"]["battery_wh"]["absolute_error"] == pytest.approx(-10)


def test_validation_reports_missing_points(client):
    response = client.post("/api/operations/validate", json={
        "metric": "battery_wh",
        "unit": "Wh",
        "model": [{"t_utc": "2026-12-30T00:00:00Z", "value": 100}],
        "reference": [
            {"t_utc": "2026-12-30T00:00:00Z", "value": 98},
            {"t_utc": "2026-12-30T01:00:00Z", "value": 97},
        ],
        "model_source": "Lunar Oracle operations model",
        "reference_source": "independent instrument report",
        "tolerance": 3,
    })
    assert response.status_code == 200
    assert response.json()["compared_count"] == 1
    assert response.json()["missing_count"] == 1
    assert response.json()["within_tolerance_fraction"] == 1
