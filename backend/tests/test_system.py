"""Health, settings, events, experiment tagging and Demo Mode."""
import time

from conftest import reading


def test_health(client):
    h = client.get("/api/health").json()
    assert h["status"] == "ok" and h["database"] == "ok"


def test_settings_roundtrip_and_reset(client):
    s = client.get("/api/settings").json()
    assert "do NOT change the ESP32 firmware" in s["notice"]
    t = s["settings"]["analysis_thresholds"]
    t["moisture"] = [30, 55, 75, 100]
    assert client.put("/api/settings", json={"analysis_thresholds": t}).status_code == 200
    assert client.get("/api/settings").json()["settings"]["analysis_thresholds"]["moisture"] == [30, 55, 75, 100]
    client.post("/api/settings/reset-thresholds")
    assert client.get("/api/settings").json()["settings"]["analysis_thresholds"]["moisture"] == [35, 60, 80, 100]


def test_experiment_tagging(client):
    assert client.post("/api/experiments/start", json={"experiment_id": "bad id!"}).status_code == 400
    client.post("/api/experiments/start", json={"experiment_id": "RUN-01"})
    client.post("/api/reading", json=reading())
    client.post("/api/experiments/stop")
    client.post("/api/reading", json=reading())
    ex = client.get("/api/experiments").json()
    assert ex["active_experiment_id"] is None
    assert ex["experiments"] == [{**ex["experiments"][0], "experiment_id": "RUN-01", "readings": 1}]


def test_events_logged_for_dataset_and_training(client):
    client.post("/api/datasets/synthetic-fixture")
    types = [e["event_type"] for e in client.get("/api/events", params={"category": "dataset"}).json()["items"]]
    assert "DATASET_UPLOADED" in types


def test_demo_mode_generates_flagged_simulated_data(client):
    st = client.post("/api/demo/start", json={"scenario": "combined", "speed": 8}).json()
    assert st["running"] and "SIMULATED" in st["notice"]
    time.sleep(1.5)
    client.post("/api/demo/stop")
    latest = client.get("/api/latest").json()["reading"]
    assert latest["is_simulated"] is True and latest["device_id"] == "demo-sim-node-01"
    assert client.get("/api/analytics/summary", params={"include_simulated": False}).json()["total_readings"] == 0
    assert client.post("/api/demo/start", json={"scenario": "nope"}).status_code == 400
    assert client.delete("/api/demo/data").status_code == 400
    purged = client.delete("/api/demo/data", params={"confirm": True}).json()
    assert purged["readings"] >= 1 and client.get("/api/analytics/summary").json()["total_readings"] == 0
