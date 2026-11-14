"""Sensor analytics computed server-side from stored readings."""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Alert, Dataset, Device, SensorReading, TrainedModel
from ..utils import clean_float, iso, utcnow
from . import app_settings
from .telemetry import NUMERIC_FIELDS, SEVERITY_ORDER, device_status, gap_stats

SENSORS = {
    "moisture_index": {"label": "Soil Moisture Index", "unit": "index 0–100"},
    "rain_index": {"label": "Rain Activity Index", "unit": "index 0–100"},
    "tilt_change_deg": {"label": "Slope Tilt Change", "unit": "°"},
    "moisture_rate_per_min": {"label": "Moisture Rate of Change", "unit": "%-pts/min"},
    "tilt_rate_deg_per_min": {"label": "Tilt Rate of Change", "unit": "°/min"},
    "weighted_score": {"label": "Prototype Weighted Risk Score", "unit": "0–100"},
    "wifi_rssi": {"label": "Wi-Fi RSSI", "unit": "dBm"},
}


def _frame(db: Session, conds: list) -> pd.DataFrame:
    cols = [SensorReading.received_at, SensorReading.device_id, SensorReading.esp32_risk_state,
            SensorReading.sensor_health, SensorReading.quality_flags, SensorReading.is_valid,
            *[getattr(SensorReading, f) for f in NUMERIC_FIELDS], SensorReading.wifi_rssi]
    rows = db.execute(select(*cols).where(*conds).order_by(SensorReading.received_at)).all()
    return pd.DataFrame(rows, columns=[c.key for c in cols])


def sensor_stats(db: Session, conds: list, sensors: list[str] | None = None) -> dict[str, Any]:
    df = _frame(db, conds)
    cfg = app_settings.get_all(db)
    keys = [s for s in (sensors or list(SENSORS)) if s in SENSORS]
    out: dict[str, Any] = {"n_readings": int(len(df)), "sensors": []}
    if df.empty:
        out["message"] = "No readings match the selected filters."
        return out
    t = pd.to_datetime(df["received_at"])
    out["first"] = iso(t.iloc[0].to_pydatetime())
    out["last"] = iso(t.iloc[-1].to_pydatetime())
    out["duration_sec"] = clean_float((t.iloc[-1] - t.iloc[0]).total_seconds(), 1)
    out["invalid_readings"] = int((~df["is_valid"].astype(bool)).sum())
    out["devices"] = sorted(df["device_id"].unique().tolist())
    per_dev_gaps = [gap_stats(list(g["received_at"]), cfg["expected_telemetry_interval_sec"], cfg["telemetry_gap_factor"])
                    for _, g in df.groupby("device_id")]
    out["telemetry_gaps"] = {
        "gap_count": sum(g["gap_count"] for g in per_dev_gaps),
        "estimated_missing_packets": sum(g["estimated_missing_packets"] for g in per_dev_gaps),
        "longest_gap_sec": max((g["longest_gap_sec"] or 0) for g in per_dev_gaps) if per_dev_gaps else 0,
        "gap_threshold_sec": cfg["expected_telemetry_interval_sec"] * cfg["telemetry_gap_factor"],
    }
    minutes = (t - t.iloc[0]).dt.total_seconds().values / 60.0
    flags = df["quality_flags"].fillna("")
    for key in keys:
        s = pd.to_numeric(df[key], errors="coerce")
        valid = s.notna()
        item: dict[str, Any] = {"key": key, **SENSORS[key], "count": int(valid.sum()),
                                "missing": int((~valid).sum()),
                                "invalid": int(flags.str.contains(f"{key}_out_of_range").sum())}
        if valid.any():
            vals = s[valid]
            item.update(current=clean_float(vals.iloc[-1]), min=clean_float(vals.min()), max=clean_float(vals.max()),
                        mean=clean_float(vals.mean()), std=clean_float(vals.std(ddof=1)) if len(vals) > 1 else 0.0,
                        median=clean_float(vals.median()))
            x = minutes[valid.values]
            if len(vals) >= 3 and np.ptp(x) > 0:
                slope = float(np.polyfit(x, vals.values.astype(float), 1)[0])
                span = (item["max"] or 0) - (item["min"] or 0)
                tol = max(abs(span) * 0.02, 1e-6)
                direction = "rising" if slope * max(np.ptp(x), 1e-9) > tol else ("falling" if slope * np.ptp(x) < -tol else "stable")
                item.update(trend_slope_per_min=clean_float(slope), trend=direction)
            else:
                item.update(trend_slope_per_min=None, trend="insufficient data")
            item["net_change"] = clean_float(vals.iloc[-1] - vals.iloc[0])
        out["sensors"].append(item)
    return out


def risk_distribution(db: Session, conds: list) -> dict[str, Any]:
    df = _frame(db, conds)
    if df.empty:
        return {"n_readings": 0, "states": []}
    cfg = app_settings.get_all(db)
    cap = cfg["expected_telemetry_interval_sec"] * cfg["telemetry_gap_factor"]
    df = df.sort_values(["device_id", "received_at"])
    dt = df.groupby("device_id")["received_at"].diff().shift(-1).dt.total_seconds()
    df["dwell"] = dt.clip(upper=cap).fillna(cfg["expected_telemetry_interval_sec"])
    g = df.groupby("esp32_risk_state").agg(count=("dwell", "size"), seconds=("dwell", "sum"))
    total = int(g["count"].sum())
    states = [{"state": s, "count": int(r["count"]), "pct": round(100 * r["count"] / total, 2),
               "approx_duration_sec": clean_float(r["seconds"], 0)}
              for s, r in g.iterrows()]
    states.sort(key=lambda x: SEVERITY_ORDER.get(x["state"], 1))
    return {"n_readings": total, "states": states,
            "note": "Duration is approximated from intervals between consecutive readings (capped at the gap threshold)."}


def summary(db: Session, include_simulated: bool = True) -> dict[str, Any]:
    cfg = app_settings.get_all(db)
    timeout = float(cfg["device_offline_timeout_sec"])
    sim_cond = [] if include_simulated else [SensorReading.is_simulated.is_(False)]
    total = db.scalar(select(func.count(SensorReading.id)).where(*sim_cond)) or 0
    real_total = db.scalar(select(func.count(SensorReading.id)).where(SensorReading.is_simulated.is_(False))) or 0
    first = db.scalar(select(func.min(SensorReading.received_at)).where(*sim_cond))
    last = db.scalar(select(func.max(SensorReading.received_at)).where(*sim_cond))
    invalid = db.scalar(select(func.count(SensorReading.id)).where(SensorReading.is_valid.is_(False), *sim_cond)) or 0
    devices = db.query(Device).all()
    if not include_simulated:
        devices = [d for d in devices if not d.is_simulated]
    now = utcnow()
    dev_status = [device_status(d, timeout, now) for d in devices]
    active = db.query(TrainedModel).filter(TrainedModel.is_active.is_(True)).first()
    ds_counts = dict(db.query(Dataset.category, func.count(Dataset.id)).group_by(Dataset.category).all())
    since = now.replace(microsecond=0) - pd.Timedelta(hours=24).to_pytimedelta()
    alerts_24h = db.scalar(select(func.count(Alert.id)).where(Alert.created_at >= since)) or 0
    unack = db.scalar(select(func.count(Alert.id)).where(Alert.acknowledged.is_(False))) or 0
    return {
        "total_readings": total,
        "real_readings": real_total,
        "simulated_readings": (db.scalar(select(func.count(SensorReading.id)).where(SensorReading.is_simulated.is_(True))) or 0),
        "invalid_readings": invalid,
        "first_reading_at": iso(first),
        "last_reading_at": iso(last),
        "devices": dev_status,
        "devices_online": sum(1 for d in dev_status if d["online"]),
        "active_model": None if active is None else {"id": active.id, "version": active.version, "name": active.name,
                                                     "is_synthetic": active.is_synthetic},
        "models_total": db.query(TrainedModel).count(),
        "datasets": {"historical": ds_counts.get("historical", 0), "experimental": ds_counts.get("experimental", 0)},
        "alerts_last_24h": alerts_24h,
        "alerts_unacknowledged": unack,
        "active_experiment_id": cfg.get("active_experiment_id"),
        "server_time": iso(now),
    }
