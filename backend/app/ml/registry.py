"""Model registry, safe artifact loading and prediction.

Only artifacts written by this application (paths recorded in the DB, inside
ARTIFACT_DIR, SHA-256 verified) are ever deserialised. Model files are never
accepted as uploads, because joblib/pickle files can execute arbitrary code.
"""
from __future__ import annotations

import math
import threading
from pathlib import Path
from typing import Any, Optional

import joblib
import pandas as pd
from sqlalchemy.orm import Session

from ..config import settings
from ..models import SensorReading, TrainedModel
from ..utils import clean_float, iso, loads, sha256_file, utcnow
from ..services import app_settings
from ..services.events import log_event

_cache: dict[tuple[int, str], Any] = {}
_lock = threading.Lock()
READING_FIELDS = {"moisture_index", "rain_index", "tilt_change_deg", "moisture_rate_per_min", "tilt_rate_deg_per_min",
                  "weighted_score", "wifi_rssi", "uptime_sec"}


class ModelError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def model_to_dict(m: TrainedModel, detail: bool = False) -> dict[str, Any]:
    metrics = loads(m.metrics_json, {})
    d = {
        "id": m.id, "version": m.version, "name": m.name, "created_at": iso(m.created_at),
        "dataset_id": m.dataset_id, "dataset_name": m.dataset_name, "dataset_hash": m.dataset_hash,
        "features": loads(m.features_json, []), "target": m.target, "classes": loads(m.classes_json, []),
        "hyperparameters": loads(m.hyperparams_json, {}), "split_strategy": m.split_strategy,
        "training_duration_sec": clean_float(m.training_duration_sec, 3),
        "n_rows": m.n_rows, "n_train": m.n_train, "n_test": m.n_test, "is_active": m.is_active,
        "label_source": m.label_source, "is_synthetic": m.is_synthetic, "run_id": m.run_id,
        "artifact_file": Path(m.artifact_path).name, "artifact_sha256": m.artifact_sha256,
        "warnings": loads(m.warnings_json, []), "notes": m.notes,
        "summary_metrics": {k: metrics.get(k) for k in ("accuracy", "balanced_accuracy", "f1_macro", "f1_weighted",
                                                        "precision_macro", "recall_macro", "majority_baseline_accuracy")},
    }
    if detail:
        d["metrics"] = metrics
        d["split_details"] = loads(m.split_details_json, {})
    return d


def load_model(m: TrainedModel) -> Any:
    path = Path(m.artifact_path).resolve()
    root = settings.artifact_dir.resolve()
    if root not in path.parents:
        raise ModelError("Model artifact path is outside the artifact directory; refusing to load.", 500)
    if not path.exists():
        raise ModelError(f"Model artifact file missing: {path.name}", 500)
    key = (m.id, m.artifact_sha256)
    with _lock:
        if key in _cache:
            return _cache[key]
    if sha256_file(path) != m.artifact_sha256:
        raise ModelError("Model artifact hash mismatch (file changed since training); refusing to load.", 500)
    obj = joblib.load(path)
    if not isinstance(obj, dict) or obj.get("format") != "landslide-rf-v1":
        raise ModelError("Unrecognised artifact format.", 500)
    with _lock:
        _cache[key] = obj
    return obj


def active_model(db: Session) -> Optional[TrainedModel]:
    return db.query(TrainedModel).filter(TrainedModel.is_active.is_(True)).first()


def activate(db: Session, m: TrainedModel) -> None:
    load_model(m)  # verify before activation
    for other in db.query(TrainedModel).filter(TrainedModel.is_active.is_(True)).all():
        other.is_active = False
    m.is_active = True
    log_event(db, "ml", "MODEL_ACTIVATED", f"Model v{m.version} ({m.name}) activated by user."
              + (" [trained on SYNTHETIC data]" if m.is_synthetic else ""), details={"model_id": m.id})


def deactivate(db: Session, m: TrainedModel) -> None:
    m.is_active = False
    log_event(db, "ml", "MODEL_DEACTIVATED", f"Model v{m.version} deactivated.", details={"model_id": m.id})


def delete(db: Session, m: TrainedModel) -> None:
    path = Path(m.artifact_path)
    if settings.artifact_dir.resolve() in path.resolve().parents:
        path.unlink(missing_ok=True)
    metrics = loads(m.metrics_json, {})
    for name in (metrics.get("plots") or {}).values():
        (settings.artifact_dir / "plots" / name).unlink(missing_ok=True)
    with _lock:
        for k in [k for k in _cache if k[0] == m.id]:
            _cache.pop(k, None)
    log_event(db, "ml", "MODEL_DELETED", f"Model v{m.version} deleted.", severity="warning", details={"model_id": m.id})
    db.delete(m)


def predict(m: TrainedModel, values: dict[str, Any]) -> dict[str, Any]:
    features = loads(m.features_json, [])
    missing = [f for f in features if values.get(f) is None]
    if missing:
        raise ModelError(f"Missing required input values: {missing}. Prediction refused.")
    bad = []
    row = {}
    for f in features:
        try:
            v = float(values[f])
        except (TypeError, ValueError):
            bad.append(f)
            continue
        if math.isnan(v) or math.isinf(v):
            bad.append(f)
        row[f] = v
    if bad:
        raise ModelError(f"Invalid (non-finite / non-numeric) input values: {bad}. Prediction refused.")
    obj = load_model(m)
    pipe = obj["pipeline"]
    X = pd.DataFrame([row], columns=features)
    label = str(pipe.predict(X)[0])
    probs = {}
    if hasattr(pipe, "predict_proba"):
        p = pipe.predict_proba(X)[0]
        probs = {str(c): clean_float(v) for c, v in zip(pipe.classes_, p)}
    return {
        "predicted_class": label,
        "class_scores": probs,
        "class_scores_note": "Fraction of trees voting for each class — a model confidence score, NOT a landslide probability.",
        "input": row,
        "model_id": m.id, "model_version": m.version, "model_name": m.name,
        "trained_on_synthetic": m.is_synthetic, "label_source": m.label_source,
        "predicted_at": iso(utcnow()),
    }


def hybrid(db: Session, device_id: Optional[str]) -> dict[str, Any]:
    q = db.query(SensorReading)
    if device_id:
        q = q.filter(SensorReading.device_id == device_id)
    r = q.order_by(SensorReading.received_at.desc()).first()
    m = active_model(db)
    timeout = float(app_settings.get(db, "device_offline_timeout_sec"))
    out: dict[str, Any] = {"reading": None, "esp32_state": None, "ml": None, "agreement": None,
                           "model_status": "no_active_model" if m is None else "active",
                           "policy": "The ESP32 rule-based state is authoritative for the local system. "
                                     "The Random Forest output is shown alongside it and never replaces it."}
    if r is None:
        out["message"] = "No sensor readings received yet."
        return out
    age = (utcnow() - r.received_at).total_seconds()
    out["reading"] = {"id": r.id, "device_id": r.device_id, "received_at": iso(r.received_at),
                      "age_sec": round(age, 1), "stale": age > timeout, "is_simulated": r.is_simulated,
                      **{f: getattr(r, f) for f in READING_FIELDS}, "sensor_health": r.sensor_health}
    out["esp32_state"] = r.esp32_risk_state
    if m is None:
        out["message"] = "No model is active. Train a model and activate it explicitly in Model Evaluation."
        return out
    features = loads(m.features_json, [])
    unsupported = [f for f in features if f not in READING_FIELDS]
    if unsupported:
        out["model_status"] = "incompatible"
        out["message"] = f"Active model uses features not present in live telemetry: {unsupported}. Use manual prediction."
        return out
    try:
        res = predict(m, {f: getattr(r, f) for f in features})
    except ModelError as e:
        out["model_status"] = "refused"
        out["message"] = str(e)
        return out
    out["ml"] = res
    if r.esp32_risk_state in ("SAFE", "WATCH", "WARNING", "CRITICAL"):
        out["agreement"] = res["predicted_class"] == r.esp32_risk_state
    else:
        out["message"] = f"ESP32 reported {r.esp32_risk_state}; agreement is not assessed for degraded readings."
    return out
