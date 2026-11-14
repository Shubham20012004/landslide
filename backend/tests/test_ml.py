"""Random Forest pipeline: preflight, leakage guard, training, registry, prediction.

Uses the clearly-labelled SYNTHETIC fixture: metrics asserted here only prove the
pipeline works and are not project findings.
"""
from pathlib import Path

from conftest import reading, wait_for_run
from test_datasets import HIST_CSV, upload

FEATURES = ["moisture_index", "rain_index", "tilt_change_deg", "moisture_rate_per_min", "tilt_rate_deg_per_min"]


def _fixture(client) -> int:
    r = client.post("/api/datasets/synthetic-fixture")
    assert r.status_code == 201
    d = r.json()
    assert d["is_synthetic"] and d["label_source"] == "synthetic_rule_engine"
    return d["id"]


def _cfg(ds_id, **kw):
    return {"dataset_id": ds_id, "features": FEATURES, "target": "risk_label", "n_estimators": 60, **kw}


def _train(client, cfg) -> dict:
    r = client.post("/api/ml/train", json=cfg)
    assert r.status_code == 202, r.text
    run = wait_for_run(client, r.json()["id"])
    assert run["status"] == "completed", run
    return run


def test_preflight_and_guards(client):
    ds = _fixture(client)
    pf = client.post("/api/ml/preflight", json=_cfg(ds)).json()
    assert pf["ok"] and pf["n_groups"] == 14 and pf["detected"]["group_column"] == "experiment_id"
    assert {c["label"] for c in pf["class_distribution"]} == {"SAFE", "WATCH", "WARNING", "CRITICAL"}
    assert any("SYNTHETIC" in w for w in pf["warnings"])
    # Random split with experiment IDs present requires explicit acknowledgement.
    pf2 = client.post("/api/ml/preflight", json=_cfg(ds, split_strategy="random")).json()
    assert pf2["needs_acknowledgement"]
    assert client.post("/api/ml/train", json=_cfg(ds, split_strategy="random")).status_code == 400
    # Target cannot be a feature; unknown columns rejected.
    assert not client.post("/api/ml/preflight", json=_cfg(ds, features=FEATURES + ["risk_label"])).json()["ok"]
    assert not client.post("/api/ml/preflight", json=_cfg(ds, features=["nope"])).json()["ok"]


def test_historical_dataset_cannot_train(client):
    h = upload(client, HIST_CSV).json()
    pf = client.post("/api/ml/preflight", json=_cfg(h["id"], features=["latitude"], target="landslide_trigger")).json()
    assert not pf["ok"] and "Historical" in pf["errors"][0]


def test_group_split_training_metrics_and_registry(client):
    ds = _fixture(client)
    run = _train(client, _cfg(ds))
    m = client.get(f"/api/ml/models/{run['model_id']}").json()
    assert m["is_active"] is False  # never auto-activated
    assert m["split_strategy"] == "group" and m["dataset_hash"]
    sd = m["split_details"]
    assert not set(sd["train_groups"]) & set(sd["test_groups"])  # no experiment in both sets
    met = m["metrics"]
    for k in ("accuracy", "f1_macro", "f1_weighted", "precision_macro", "recall_macro", "majority_baseline_accuracy"):
        assert 0 <= met[k] <= 1
    cm = met["confusion_matrix"]
    assert sum(map(sum, cm["matrix"])) == m["n_test"]
    assert {p["label"] for p in met["per_class"]} == set(cm["labels"])
    assert len(met["feature_importance_mdi"]) == 5
    assert Path(met["plots"]["confusion_matrix"]).suffix == ".png"
    assert client.get(f"/api/ml/artifacts/{met['plots']['confusion_matrix']}").status_code == 200
    assert client.get("/api/ml/artifacts/..%2F..%2Fsecret").status_code == 404


def test_chronological_split(client):
    ds = _fixture(client)
    run = _train(client, _cfg(ds, split_strategy="chronological"))
    m = client.get(f"/api/ml/models/{run['model_id']}").json()
    assert m["split_details"]["time_column"] == "timestamp"


def test_activation_prediction_and_hybrid(client):
    ds = _fixture(client)
    mid = _train(client, _cfg(ds))["model_id"]
    manual = {"features": {"moisture_index": 85, "rain_index": 80, "tilt_change_deg": 6, "moisture_rate_per_min": 2,
                           "tilt_rate_deg_per_min": 0.3}}
    assert client.post("/api/ml/predict", json=manual).status_code == 409  # no active model
    assert client.post(f"/api/ml/models/{mid}/activate").status_code == 200
    p = client.post("/api/ml/predict", json=manual).json()
    assert p["predicted_class"] in ("SAFE", "WATCH", "WARNING", "CRITICAL")
    assert abs(sum(p["class_scores"].values()) - 1) < 1e-6 and "NOT a landslide probability" in p["class_scores_note"]
    # Missing / invalid inputs are refused.
    assert client.post("/api/ml/predict", json={"features": {"moisture_index": 85}}).status_code == 422
    bad = {"features": dict(manual["features"], rain_index="abc")}
    assert client.post("/api/ml/predict", json=bad).status_code == 422
    # Hybrid comparison with a reading; a reading with a null channel is refused.
    client.post("/api/reading", json=reading(esp32_risk_state="WATCH"))
    h = client.get("/api/ml/hybrid").json()
    assert h["esp32_state"] == "WATCH" and h["ml"] is not None and h["agreement"] in (True, False)
    client.post("/api/reading", json=reading(tilt_change_deg=None, sensor_health="DATA_INCOMPLETE", esp32_risk_state="DATA_INCOMPLETE"))
    h2 = client.get("/api/ml/hybrid").json()
    assert h2["ml"] is None and h2["model_status"] == "refused"
    # Deleting requires deactivation and confirmation.
    assert client.delete(f"/api/ml/models/{mid}", params={"confirm": True}).status_code == 400
    client.post(f"/api/ml/models/{mid}/deactivate")
    assert client.delete(f"/api/ml/models/{mid}").status_code == 400
    assert client.delete(f"/api/ml/models/{mid}", params={"confirm": True}).status_code == 200


def test_tampered_artifact_is_not_loaded(client):
    ds = _fixture(client)
    mid = _train(client, _cfg(ds))["model_id"]
    from app.database import SessionLocal
    from app.models import TrainedModel

    with SessionLocal() as db:
        path = Path(db.get(TrainedModel, mid).artifact_path)
    path.write_bytes(path.read_bytes() + b"tampered")
    r = client.post(f"/api/ml/models/{mid}/activate")
    assert r.status_code == 500 and "hash mismatch" in r.json()["detail"]
