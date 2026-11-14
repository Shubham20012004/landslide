"""Telemetry ingestion, persistence, alert de-duplication, history, export (SIMULATED test payloads)."""
from conftest import reading

from app.database import SessionLocal
from app.models import Alert, SensorReading


def test_firmware_payload_is_stored_with_server_timestamp(client):
    r = client.post("/api/reading", json=reading())
    assert r.status_code == 201
    body = r.json()
    assert body["is_valid"] is True and body["received_at"].endswith("Z")
    latest = client.get("/api/latest").json()
    rd = latest["reading"]
    assert rd["moisture_index"] == 42.5
    assert rd["esp32_risk_state"] == "SAFE"
    assert rd["raw_payload"] == reading()  # original payload preserved unchanged
    assert latest["device"]["online"] is True


def test_null_channels_and_degraded_states_are_accepted(client):
    p = reading(tilt_change_deg=None, tilt_rate_deg_per_min=None, esp32_risk_state="DATA_INCOMPLETE",
                sensor_health="DATA_INCOMPLETE", fault_reason="MPU6050_I2C_FAULT; ")
    r = client.post("/api/reading", json=p)
    assert r.status_code == 201 and r.json()["is_valid"] is True
    rd = client.get("/api/latest").json()["reading"]
    assert rd["tilt_change_deg"] is None and rd["esp32_risk_state"] == "DATA_INCOMPLETE"


def test_esp32_state_is_never_replaced_by_backend(client):
    # Score says SAFE-ish but the device reports CRITICAL (rate override latched on device): keep it.
    client.post("/api/reading", json=reading(esp32_risk_state="CRITICAL", weighted_score=20.0))
    latest = client.get("/api/latest").json()
    assert latest["reading"]["esp32_risk_state"] == "CRITICAL"
    assert latest["reference_check"]["backend_score_level"] in ("SAFE", "WATCH")


def test_malformed_payloads_are_rejected(client):
    assert client.post("/api/reading", json={"device_id": "x"}).status_code == 422
    assert client.post("/api/reading", json=reading(moisture_index="wet")).status_code == 422
    assert client.post("/api/reading", json=reading(device_id="bad id with spaces")).status_code == 422
    assert client.post("/api/reading", content=b"not json", headers={"Content-Type": "application/json"}).status_code == 400
    assert client.post("/api/reading", json=[1, 2]).status_code == 400


def test_out_of_range_values_are_kept_but_flagged_invalid(client):
    r = client.post("/api/reading", json=reading(moisture_index=140.0, esp32_risk_state="BOGUS")).json()
    assert r["is_valid"] is False
    assert "moisture_index_out_of_range" in r["quality_flags"] and "unknown_risk_state" in r["quality_flags"]
    stats = client.get("/api/analytics/sensors").json()
    assert stats["invalid_readings"] == 1
    m = next(s for s in stats["sensors"] if s["key"] == "moisture_index")
    assert m["invalid"] == 1 and m["max"] == 140.0


def test_alerts_only_on_transitions(client):
    for _ in range(5):
        client.post("/api/reading", json=reading())
    for _ in range(4):
        client.post("/api/reading", json=reading(esp32_risk_state="WARNING", weighted_score=55))
    client.post("/api/reading", json=reading(esp32_risk_state="CRITICAL", weighted_score=80))
    alerts = client.get("/api/alerts", params={"alert_type": "RISK_STATE_CHANGE"}).json()
    assert alerts["total"] == 2  # SAFE→WARNING, WARNING→CRITICAL; repeated packets do not alert
    assert alerts["items"][0]["severity"] == "critical"


def test_sensor_fault_and_recovery_alerts(client):
    client.post("/api/reading", json=reading())
    bad = reading(tilt_change_deg=None, sensor_health="DATA_INCOMPLETE", esp32_risk_state="DATA_INCOMPLETE",
                  fault_reason="MPU6050_I2C_FAULT; ")
    client.post("/api/reading", json=bad)
    client.post("/api/reading", json=bad)
    client.post("/api/reading", json=reading())
    types = [a["alert_type"] for a in client.get("/api/alerts").json()["items"]]
    assert types.count("SENSOR_FAULT") == 1 and types.count("SENSOR_RECOVERED") == 1


def test_history_pagination_and_filters(client):
    for i in range(30):
        client.post("/api/reading", json=reading(uptime_sec=100 + i * 4, esp32_risk_state="WATCH" if i % 3 == 0 else "SAFE"))
    page = client.get("/api/history", params={"page": 2, "page_size": 10}).json()
    assert page["total"] == 30 and page["pages"] == 3 and len(page["items"]) == 10
    watch = client.get("/api/history", params={"risk_state": "WATCH"}).json()
    assert watch["total"] == 10
    assert client.get("/api/history", params={"window": "bogus"}).status_code == 400


def test_series_downsampling_keeps_most_severe_state(client):
    for i in range(40):
        state = "CRITICAL" if i == 17 else "SAFE"
        client.post("/api/reading", json=reading(esp32_risk_state=state, uptime_sec=i * 4))
    s = client.get("/api/history/series", params={"max_points": 10}).json()
    assert s["downsampled"] is True and s["n_points"] <= 10
    assert any(p["esp32_risk_state"] == "CRITICAL" for p in s["points"])


def test_csv_export(client):
    client.post("/api/reading", json=reading())
    client.post("/api/reading", json=reading(moisture_index=None, sensor_health="DATA_INCOMPLETE", esp32_risk_state="DATA_INCOMPLETE"))
    r = client.get("/api/history/export.csv")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    lines = r.text.strip().splitlines()
    assert lines[0].startswith("id,device_id,received_at,moisture_index") and len(lines) == 3


def test_simulated_header_flags_reading(client):
    client.post("/api/reading", json=reading(device_id="sim-test"), headers={"X-Simulated": "true"})
    rd = client.get("/api/latest").json()["reading"]
    assert rd["is_simulated"] is True
    assert client.get("/api/analytics/summary", params={"include_simulated": False}).json()["total_readings"] == 0


def test_readings_persist_in_database(client):
    client.post("/api/reading", json=reading())
    with SessionLocal() as db:
        assert db.query(SensorReading).count() == 1
        assert db.query(Alert).count() == 0
