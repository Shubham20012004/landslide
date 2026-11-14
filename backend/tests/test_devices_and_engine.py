"""Device offline detection, reconnection, health endpoint, and the firmware-logic port (SIMULATED data)."""
import random
from datetime import timedelta

from conftest import reading

from app.database import SessionLocal
from app.models import Device
from app.services import risk_engine
from app.services.app_settings import FIRMWARE_DEFAULT_THRESHOLDS as T
from app.services.monitor import check_devices_once
from app.services.simulator import SCENARIOS
from app.utils import utcnow


def _age_device(device_id: str, seconds: float) -> None:
    with SessionLocal() as db:
        d = db.get(Device, device_id)
        d.last_seen = utcnow() - timedelta(seconds=seconds)
        db.commit()


def test_device_goes_offline_once_and_reconnects(client):
    client.post("/api/reading", json=reading())
    _age_device("esp32-slope-node-01", 120)
    assert client.get("/api/devices").json()["devices"][0]["online"] is False  # stale record ≠ online
    assert check_devices_once() == 1
    assert check_devices_once() == 0  # no duplicate offline alert
    client.post("/api/reading", json=reading(uptime_sec=500))
    types = [a["alert_type"] for a in client.get("/api/alerts").json()["items"]]
    assert types.count("DEVICE_OFFLINE") == 1 and types.count("DEVICE_RECONNECTED") == 1
    assert client.get("/api/devices").json()["devices"][0]["online"] is True


def test_telemetry_gap_and_reboot_detection(client):
    client.post("/api/reading", json=reading(uptime_sec=1000))
    _age_device("esp32-slope-node-01", 15)  # > 4 s × 2.5 but < 20 s timeout
    client.post("/api/reading", json=reading(uptime_sec=3))  # uptime reset → reboot
    types = [a["alert_type"] for a in client.get("/api/alerts").json()["items"]]
    assert "TELEMETRY_GAP" in types
    events = [e["event_type"] for e in client.get("/api/events").json()["items"]]
    assert "DEVICE_REBOOT" in events


def test_device_health_endpoint(client):
    client.post("/api/reading", json=reading())
    client.post("/api/reading", json=reading(rain_index=None, sensor_health="DATA_INCOMPLETE", esp32_risk_state="DATA_INCOMPLETE"))
    h = client.get("/api/devices/esp32-slope-node-01/health").json()
    assert h["totals"]["readings"] == 2 and h["totals"]["degraded_health_readings"] == 1
    assert h["totals"]["missing_channel_values"]["rain_index"] == 1
    assert client.get("/api/devices/nope/health").status_code == 404


def test_offline_timeout_setting_is_validated(client):
    assert client.put("/api/settings", json={"device_offline_timeout_sec": 2}).status_code == 422
    assert client.put("/api/settings", json={"device_offline_timeout_sec": 30}).json()["settings"]["device_offline_timeout_sec"] == 30
    bad = dict(T, weights={"moisture": 0.5, "rain": 0.5, "tilt": 0.5})
    assert client.put("/api/settings", json={"analysis_thresholds": bad}).status_code == 422


# --- firmware logic port ------------------------------------------------------
def test_sub_risk_matches_firmware_piecewise_mapping():
    th = T["moisture"]  # 35, 60, 80, 100
    assert risk_engine.sub_risk(0, th) == 0
    assert risk_engine.sub_risk(35, th) == 25
    assert risk_engine.sub_risk(60, th) == 50
    assert risk_engine.sub_risk(70, th) == 62.5
    assert risk_engine.sub_risk(100, th) == 100
    assert risk_engine.sub_risk(150, th) == 100


def test_weighted_score_uses_neutral_50_for_unhealthy_channel():
    c = risk_engine.weighted(None, 0.0, 0.0, T)
    assert c.score == 0.4 * 50 and c.missing == ["moisture"]


def test_engine_never_reports_degraded_data_as_safe():
    eng = risk_engine.FirmwareEngine(cfg=T)
    for _ in range(5):
        eng.step(10.0, 2.0, None)
    p = eng.payload("t", 10, -60)
    assert p["sensor_health"] == "DATA_INCOMPLETE"
    assert p["esp32_risk_state"] == "DATA_INCOMPLETE"
    assert p["tilt_change_deg"] is None and p["tilt_rate_deg_per_min"] is None


def test_rate_override_requires_persistence():
    eng = risk_engine.FirmwareEngine(cfg=T)
    eng.step(30.0, 5.0, 0.3)
    eng.step(34.0, 5.0, 0.3)  # first fast rise: not yet latched
    first = eng.latched
    for m in (38, 42, 46, 50):
        eng.step(float(m), 5.0, 0.3)
    assert first == 0 and eng.latched >= 1


def test_payload_shape_matches_firmware_contract():
    eng = risk_engine.FirmwareEngine(cfg=T)
    eng.step(30.0, 5.0, 0.3)
    keys = set(eng.payload("d", 1, -50))
    assert keys == {"device_id", "moisture_index", "rain_index", "tilt_change_deg", "moisture_rate_per_min",
                    "tilt_rate_deg_per_min", "weighted_score", "esp32_risk_state", "sensor_health", "fault_reason",
                    "wifi_rssi", "uptime_sec"}


def test_reference_check_agrees_with_engine_score():
    eng = risk_engine.FirmwareEngine(cfg=T)
    rnd = random.Random(0)
    for k in range(80):
        eng.step(*SCENARIOS["combined"].fn(k, rnd))
    p = eng.payload("d", 1, -50)
    assert risk_engine.reference_check(p, T)["consistent"] is True


def test_heavy_rain_scenario_escalates():
    eng = risk_engine.FirmwareEngine(cfg=T)
    rnd = random.Random(1)
    seen = set()
    for k in range(200):
        eng.step(*SCENARIOS["heavy_rain"].fn(k, rnd))
        seen.add(risk_engine.LEVELS[eng.final_level])
    assert {"SAFE", "WARNING"} <= seen
