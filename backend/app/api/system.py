"""System health, alerts, events, settings, experiment sessions and Demo Mode."""
from __future__ import annotations

import platform
import re
from typing import Any, Optional

import sklearn
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import Alert, SensorReading, SystemEvent
from ..services import app_settings
from ..services.events import alert_to_dict, event_to_dict, log_event
from ..services.simulator import SCENARIOS, purge_simulated_data, simulator
from ..utils import iso, parse_dt, utcnow

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health", summary="Backend liveness and database check")
def health(db: Session = Depends(get_db)) -> Any:
    try:
        db.execute(text("SELECT 1"))
        db_ok = True
    except Exception:
        db_ok = False
    return {"status": "ok" if db_ok else "degraded", "database": "ok" if db_ok else "error",
            "version": settings.app_version, "server_time": iso(utcnow()), "demo_mode": simulator.running}


def _page(q, page: int, page_size: int):
    total = q.count()
    return total, q.offset((page - 1) * page_size).limit(page_size).all()


@router.get("/alerts", summary="Alerts with filtering and pagination")
def alerts(
    severity: Optional[str] = None, alert_type: Optional[str] = None, device_id: Optional[str] = None,
    start: Optional[str] = None, end: Optional[str] = None, acknowledged: Optional[bool] = None,
    include_simulated: bool = True, page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
) -> Any:
    q = db.query(Alert)
    if severity:
        q = q.filter(Alert.severity.in_(severity.split(",")))
    if alert_type:
        q = q.filter(Alert.alert_type.in_(alert_type.split(",")))
    if device_id:
        q = q.filter(Alert.device_id == device_id)
    if start:
        q = q.filter(Alert.created_at >= parse_dt(start))
    if end:
        q = q.filter(Alert.created_at <= parse_dt(end))
    if acknowledged is not None:
        q = q.filter(Alert.acknowledged.is_(acknowledged))
    if not include_simulated:
        q = q.filter(Alert.is_simulated.is_(False))
    total, rows = _page(q.order_by(Alert.created_at.desc(), Alert.id.desc()), page, page_size)
    types = [t for (t,) in db.query(Alert.alert_type).distinct().all()]
    return {"total": total, "page": page, "page_size": page_size, "items": [alert_to_dict(a) for a in rows],
            "alert_types": sorted(types)}


@router.post("/alerts/{alert_id}/acknowledge", summary="Acknowledge an alert")
def ack(alert_id: int, db: Session = Depends(get_db)) -> Any:
    a = db.get(Alert, alert_id)
    if a is None:
        raise HTTPException(404, "Alert not found.")
    a.acknowledged, a.acknowledged_at = True, utcnow()
    db.commit()
    return alert_to_dict(a)


@router.post("/alerts/acknowledge-all", summary="Acknowledge all open alerts")
def ack_all(db: Session = Depends(get_db)) -> Any:
    n = db.query(Alert).filter(Alert.acknowledged.is_(False)).update(
        {Alert.acknowledged: True, Alert.acknowledged_at: utcnow()}, synchronize_session=False)
    db.commit()
    return {"acknowledged": n}


@router.get("/events", summary="System event log")
def events(category: Optional[str] = None, event_type: Optional[str] = None, severity: Optional[str] = None,
           device_id: Optional[str] = None, start: Optional[str] = None, end: Optional[str] = None,
           page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=500), db: Session = Depends(get_db)) -> Any:
    q = db.query(SystemEvent)
    if category:
        q = q.filter(SystemEvent.category.in_(category.split(",")))
    if event_type:
        q = q.filter(SystemEvent.event_type == event_type)
    if severity:
        q = q.filter(SystemEvent.severity.in_(severity.split(",")))
    if device_id:
        q = q.filter(SystemEvent.device_id == device_id)
    if start:
        q = q.filter(SystemEvent.created_at >= parse_dt(start))
    if end:
        q = q.filter(SystemEvent.created_at <= parse_dt(end))
    total, rows = _page(q.order_by(SystemEvent.created_at.desc(), SystemEvent.id.desc()), page, page_size)
    types = [t for (t,) in db.query(SystemEvent.event_type).distinct().all()]
    return {"total": total, "page": page, "page_size": page_size, "items": [event_to_dict(e) for e in rows],
            "event_types": sorted(types)}


# --- Settings -----------------------------------------------------------------
@router.get("/settings", summary="Backend/dashboard settings")
def get_settings(db: Session = Depends(get_db)) -> Any:
    return {"settings": app_settings.get_all(db), "firmware_defaults": app_settings.FIRMWARE_DEFAULT_THRESHOLDS,
            "notice": "These settings configure the backend and dashboard only. They do NOT change the ESP32 firmware, "
                      "which computes its own risk state from constants compiled into the sketch."}


@router.put("/settings", summary="Update settings (validated)")
def put_settings(upd: app_settings.SettingsUpdate, db: Session = Depends(get_db)) -> Any:
    out = app_settings.update(db, upd)
    log_event(db, "system", "SETTINGS_UPDATED", f"Settings updated: {sorted(upd.model_dump(exclude_none=True))}")
    db.commit()
    return {"settings": out}


@router.post("/settings/reset-thresholds", summary="Reset backend analysis thresholds to the firmware defaults")
def reset_thresholds(db: Session = Depends(get_db)) -> Any:
    app_settings.reset_thresholds(db)
    log_event(db, "system", "SETTINGS_UPDATED", "Analysis thresholds reset to firmware defaults.")
    db.commit()
    return {"settings": app_settings.get_all(db)}


# --- Experiment sessions (tag incoming readings for group-aware ML splits) ------
class ExperimentStart(BaseModel):
    experiment_id: str = Field(min_length=1, max_length=64)


@router.post("/experiments/start", summary="Tag subsequently received readings with an experiment ID")
def exp_start(body: ExperimentStart, db: Session = Depends(get_db)) -> Any:
    if not re.match(r"^[A-Za-z0-9_.-]+$", body.experiment_id):
        raise HTTPException(400, "experiment_id may contain letters, digits, '.', '-' and '_' only.")
    app_settings.put(db, "active_experiment_id", body.experiment_id)
    log_event(db, "system", "EXPERIMENT_STARTED", f"Experiment session '{body.experiment_id}' started; new readings are tagged.")
    db.commit()
    return {"active_experiment_id": body.experiment_id}


@router.post("/experiments/stop", summary="Stop tagging readings")
def exp_stop(db: Session = Depends(get_db)) -> Any:
    cur = app_settings.get(db, "active_experiment_id")
    app_settings.put(db, "active_experiment_id", None)
    if cur:
        log_event(db, "system", "EXPERIMENT_STOPPED", f"Experiment session '{cur}' stopped.")
    db.commit()
    return {"active_experiment_id": None, "stopped": cur}


@router.get("/experiments", summary="Experiment IDs present in recorded readings")
def experiments(db: Session = Depends(get_db)) -> Any:
    rows = db.execute(select(SensorReading.experiment_id, func.count(SensorReading.id), func.min(SensorReading.received_at),
                             func.max(SensorReading.received_at), func.max(SensorReading.is_simulated))
                      .where(SensorReading.experiment_id.is_not(None)).group_by(SensorReading.experiment_id)).all()
    return {"active_experiment_id": app_settings.get(db, "active_experiment_id"),
            "experiments": [{"experiment_id": e, "readings": n, "first": iso(a), "last": iso(b), "has_simulated": bool(s)}
                            for e, n, a, b, s in rows]}


# --- Demo Mode ----------------------------------------------------------------
class DemoStart(BaseModel):
    scenario: str
    speed: float = Field(default=1.0, ge=0.5, le=8.0)


@router.get("/demo/status", tags=["demo"], summary="Demo Mode status and scenarios")
def demo_status() -> Any:
    return simulator.status()


@router.post("/demo/start", tags=["demo"], summary="Start a SIMULATED telemetry scenario")
async def demo_start(body: DemoStart) -> Any:
    if body.scenario not in SCENARIOS:
        raise HTTPException(400, f"Unknown scenario. Options: {list(SCENARIOS)}")
    await simulator.start(body.scenario, body.speed)
    return simulator.status()


@router.post("/demo/stop", tags=["demo"], summary="Stop Demo Mode")
async def demo_stop() -> Any:
    await simulator.stop()
    return simulator.status()


@router.delete("/demo/data", tags=["demo"], summary="Delete all SIMULATED readings, alerts and devices")
async def demo_purge(confirm: bool = Query(False)) -> Any:
    if not confirm:
        raise HTTPException(400, "Deletion requires confirm=true.")
    await simulator.stop(log_it=False)
    return purge_simulated_data()


@router.get("/system/info", summary="Versions, configuration and project metadata")
def info(db: Session = Depends(get_db)) -> Any:
    import fastapi
    import pandas

    return {
        "app": settings.app_name, "version": settings.app_version,
        "python": platform.python_version(), "platform": platform.platform(),
        "libraries": {"fastapi": fastapi.__version__, "scikit-learn": sklearn.__version__, "pandas": pandas.__version__},
        "database": "SQLite" if settings.database_url.startswith("sqlite") else "other",
        "max_upload_mb": settings.max_upload_mb,
        "telemetry_endpoint": "POST /api/reading",
        "firmware": {
            "board": "ESP32 DevKit V1 (ESP-WROOM-32)",
            "pins": {"soil_adc": "GPIO34", "rain_adc": "GPIO35", "i2c_sda": "GPIO21", "i2c_scl": "GPIO22",
                     "led_safe": "GPIO16", "led_watch": "GPIO17", "led_warning": "GPIO18", "led_critical": "GPIO19",
                     "buzzer": "GPIO23"},
            "sample_interval_ms": 2000, "telemetry_interval_ms": 4000, "adc_oversamples": 16,
            "complementary_alpha": 0.96, "ema_value_alpha": 0.35, "ema_rate_alpha": 0.40,
            "mpu6050_address": "0x68",
            "calibration": {"soil_adc_dry": 3100, "soil_adc_wet": 1300, "rain_adc_dry": 3600, "rain_adc_wet": 1200},
            "thresholds": app_settings.FIRMWARE_DEFAULT_THRESHOLDS,
        },
        "row_counts": {
            "sensor_readings": db.query(SensorReading).count(), "alerts": db.query(Alert).count(),
            "system_events": db.query(SystemEvent).count(),
        },
    }
