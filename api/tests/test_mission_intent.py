"""Mission intent extraction never substitutes language-model output for science."""
import json
from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from api.app import mission_intent as module

EXAMPLE = "si quierio hacer un viaje el 25 de diciembre de 2026 a las 8 am donde seria bueno caer y cuanto tardara la mision"


def data(message=EXAMPLE, **extra):
    return dict(message=message, timezone="America/La_Paz", **extra)


def model(**extra):
    return dict(local_date="2026-12-25", local_time="08:00", timezone="America/La_Paz", date_kind="departure",
                date_explicit=True, time_explicit=True, surface_hours=None, max_slope_deg=None,
                min_sun_hours=None, min_earth_hours=None, **extra)


@pytest.fixture
def client(monkeypatch):
    for key in ("AI_PROVIDER", "AI_MODEL", "AI_API_KEY", "AI_BASE_URL", "GEMINI_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    app = FastAPI()
    app.include_router(module.router)
    return TestClient(app)


def test_user_example_has_date_timezone_and_visible_hypothesis():
    parsed = module.parse_mission_intent(data())
    assert not parsed["needs_clarification"]
    assert parsed["intent"]["departure_utc"] == "2026-12-25T12:00:00Z"
    assert parsed["intent"]["local_datetime"] == "2026-12-25T08:00"
    assert parsed["intent"]["date_kind"] == "departure"
    assert parsed["intent"]["surface_hours"] == 72
    assert "America/La_Paz (UTC−04:00)" in " ".join(parsed["assumptions"])
    assert "hipótesis editable, no como duración total" in " ".join(parsed["assumptions"])
    assert parsed["explicit_fields"] == []


@pytest.mark.parametrize("clock,expected", [
    ("12 am", "2026-12-25T04:00:00Z"), ("12 pm", "2026-12-25T16:00:00Z"), ("8:35 pm", "2026-12-26T00:35:00Z")
])
def test_12_hour_clocks(clock, expected):
    assert module.parse_mission_intent(data("Viaje el 25 de diciembre de 2026 a las " + clock))["intent"]["requested_utc"] == expected


@pytest.mark.parametrize("message", [
    "Viaje el 25 de diciembre de 2026 a las 8 am UTC",
    "Viaje 2026-12-25T08:00:00Z",
    "Viaje 2026-12-25T10:00+02:00",
])
def test_explicit_utc_and_iso_offsets(message):
    parsed = module.parse_mission_intent(data(message))
    assert parsed["intent"]["requested_utc"] == "2026-12-25T08:00:00Z"
    assert parsed["intent"]["timezone"] == "UTC"


def test_explicit_utc_minus_four_keeps_local_time():
    assert module.parse_mission_intent(data("Viaje el 25/12/2026 a las 8 UTC−04:00"))["intent"]["requested_utc"] == "2026-12-25T12:00:00Z"


def test_landing_date_and_minutes():
    parsed = module.parse_mission_intent(data("Quiero alunizar el 25 de diciembre de 2026 a las 08:19"))
    assert parsed["intent"]["date_kind"] == "landing"
    assert parsed["intent"]["requested_utc"] == "2026-12-25T12:19:00Z"


def test_explicit_stay_and_constraints_override_ui_defaults():
    parsed = module.parse_mission_intent(data(EXAMPLE + " Quiero estar 48 horas, pendiente máxima 5°, 24 horas de Sol y 12 horas de Tierra visible.",
                                                  defaults=dict(surface_hours=168, max_slope_deg=10)))
    assert not parsed["needs_clarification"]
    assert parsed["intent"]["surface_hours"] == 48
    assert parsed["intent"]["max_slope_deg"] == 5
    assert parsed["intent"]["min_sun_hours"] == 24
    assert parsed["intent"]["min_earth_hours"] == 12
    assert parsed["explicit_fields"] == list(module.FIELDS)


def test_duration_question_is_not_an_explicit_stay():
    parsed = module.parse_mission_intent(data(defaults=dict(surface_hours=24)))
    assert parsed["intent"]["surface_hours"] == 24
    assert "surface_hours" not in parsed["explicit_fields"]


@pytest.mark.parametrize("message", [
    "¿Dónde debería caer?", "Viaje el 25 de diciembre a las 8 am", "Quiero alunizar el 25 de diciembre de 2026"
])
def test_missing_date_or_time_requests_clarification(message):
    parsed = module.parse_mission_intent(data(message))
    assert parsed["needs_clarification"]
    assert "departure_utc" not in parsed["intent"]
    assert parsed["question"]


@pytest.mark.parametrize("message", [
    "Viaje el 30 de febrero de 2026 a las 8 am", "Viaje 2026-02-30T08:00+02:00",
    "Viaje el 25/12/2101 a las 8 am", "Viaje el 25/12/2026 a las 25:00",
    EXAMPLE + " estar 8 horas y 24 horas de Sol"
])
def test_invalid_input_is_not_silently_repaired(message):
    parsed = module.parse_mission_intent(data(message))
    assert parsed["needs_clarification"]
    assert "departure_utc" not in parsed["intent"]


def test_short_stay_has_possible_default_visibility_requirements():
    parsed = module.parse_mission_intent(data(defaults=dict(surface_hours=8)))
    assert parsed["intent"]["min_sun_hours"] == 8
    assert parsed["intent"]["min_earth_hours"] == 8


def test_endpoint_limits_and_private_configuration(client):
    assert client.post("/api/mission-intent", content="{}").status_code == 415
    assert client.post("/api/mission-intent", json=dict(message="a" * 9000)).status_code == 413
    assert client.post("/api/mission-intent", json=dict(message=EXAMPLE, timezone="Made/Up")).status_code == 422
    response = client.post("/api/mission-intent", json={**data(), "GEMINI_API_KEY": "browser-secret"})
    body = response.json()
    assert body["mode"] == "parser"
    assert body["reason"] == "model_not_configured"
    assert body["intent"]["requested_utc"] == "2026-12-25T12:00:00Z"
    assert response.headers["cache-control"] == "no-store"


def test_gemini_is_structured_extractor_with_server_configuration(client, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "server-secret")
    infer = AsyncMock(return_value=model())
    monkeypatch.setattr(module, "infer", infer)
    body = client.post("/api/mission-intent", json=data()).json()
    assert body["mode"] == "ai"
    assert body["intent"]["departure_utc"] == "2026-12-25T12:00:00Z"
    assert "server-secret" not in json.dumps(body)
    assert infer.await_args.args[1]["key"] == "server-secret"
    assert "72 horas como hipótesis" in " ".join(body["assumptions"])


@pytest.mark.parametrize("field,value", [("local_date", "2026-12-26"), ("surface_hours", 72), ("max_slope_deg", 2), ("date_kind", "landing")])
def test_changed_explicit_dates_and_invented_requirements_use_parser(client, monkeypatch, field, value):
    monkeypatch.setenv("GEMINI_API_KEY", "secret")
    result = model()
    result[field] = value
    monkeypatch.setattr(module, "infer", AsyncMock(return_value=result))
    body = client.post("/api/mission-intent", json=data()).json()
    assert body["mode"] == "parser"
    assert body["reason"] == "provider_or_extraction_unavailable"
    assert body["intent"]["departure_utc"] == "2026-12-25T12:00:00Z"
    assert body["intent"]["max_slope_deg"] == 10


def test_provider_failure_preserves_a_working_request(client, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "secret")
    monkeypatch.setattr(module, "infer", AsyncMock(side_effect=RuntimeError("quota")))
    body = client.post("/api/mission-intent", json=data()).json()
    assert body["mode"] == "parser"
    assert not body["needs_clarification"]


def test_bad_explicit_date_never_calls_provider(client, monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "secret")
    infer = AsyncMock(return_value=model())
    monkeypatch.setattr(module, "infer", infer)
    body = client.post("/api/mission-intent", json=data("Viaje el 30 de febrero de 2026 a las 8 am")).json()
    assert body["needs_clarification"]
    infer.assert_not_awaited()
