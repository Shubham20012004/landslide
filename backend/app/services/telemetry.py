"""Telemetry ingestion, reading queries and device status.

Alerts are emitted only on meaningful TRANSITIONS (risk-state change, sensor fault
start/clear, telemetry gap, reconnection, reboot) — never once per repeated packet.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any, Iterable, Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..models import Device, SensorReading
from ..schemas.telemetry import RISK_LEVELS, ReadingIn, quality_flags
from ..utils import WINDOWS, clean_float, iso, utcnow
from . import app_settings
from .events import log_event, raise_alert

NUMERIC_FIELDS = (
    "moisture_index",
    "rain_index",
    "tilt_change_deg",
    "moisture_rate_per_min",
    "tilt_rate_deg_per_min",
    "weighted_score",
)
SEVERITY_ORDER = {"SAFE": 0, "WATCH": 1, "DATA_INCOMPLETE": 1, "SENSOR_FAULT": 2, "WARNING": 2, "CRITICAL": 3}


def _risk_alert_severity(state: str) -> str:
    if state == "CRITICAL":
        return "critical"
    if state in ("WARNING", "SENSOR_FAULT", "DATA_INCOMPLETE"):
        return "warning"
    return "info"


def ingest(db: Session, payload: ReadingIn, raw: dict[str, Any], is_simulated: bool = False) -> SensorReading:
    now = utcnow()
    flags = quality_flags(payload)
    cfg = app_settings.get_all(db)
    timeout = float(cfg["device_offline_timeout_sec"])
    gap_limit = float(cfg["expected_telemetry_interval_sec"]) * float(cfg["telemetry_gap_factor"])
    sim = is_simulated

    dev = db.get(Device, payload.device_id)
    if dev is None:
        dev = Device(device_id=payload.device_id, first_seen=now, status="online", is_simulated=sim, total_readings=0)
        db.add(dev)
        log_event(db, "device", "DEVICE_REGISTERED",
                  f"New {'simulated ' if sim else ''}device '{payload.device_id}' sent its first reading.",
                  device_id=payload.device_id)
        if payload.esp32_risk_state != "SAFE":
            raise_alert(db, "RISK_STATE_CHANGE", _risk_alert_severity(payload.esp32_risk_state),
                        f"Initial ESP32 state: {payload.esp32_risk_state}",
                        f"First reading from {payload.device_id} reported {payload.esp32_risk_state}.",
                        payload.device_id, {"to": payload.esp32_risk_state}, sim)
        if payload.sensor_health != "OK":
            raise_alert(db, "SENSOR_FAULT", "warning", f"Sensor health {payload.sensor_health}",
                        payload.fault_reason or "", payload.device_id,
                        {"sensor_health": payload.sensor_health}, sim)
    else:
        gap = (now - dev.last_seen).total_seconds() if dev.last_seen else None
        if dev.status == "offline":
            raise_alert(db, "DEVICE_RECONNECTED", "info", f"{dev.device_id} reconnected",
                        f"Telemetry resumed after {gap:.0f} s without data." if gap else "Telemetry resumed.",
                        dev.device_id, {"gap_sec": gap}, sim)
            log_event(db, "device", "DEVICE_RECONNECTED", f"Device {dev.device_id} reconnected.", device_id=dev.device_id)
        elif gap is not None and gap_limit < gap < timeout:
            raise_alert(db, "TELEMETRY_GAP", "info", f"Missing telemetry from {dev.device_id}",
                        f"No reading for {gap:.1f} s (expected every ~{cfg['expected_telemetry_interval_sec']} s).",
                        dev.device_id, {"gap_sec": round(gap, 1)}, sim)
        if (payload.uptime_sec is not None and dev.last_uptime_sec is not None
                and payload.uptime_sec + 5 < dev.last_uptime_sec):
            dev.reboot_count = (dev.reboot_count or 0) + 1
            log_event(db, "device", "DEVICE_REBOOT",
                      f"{dev.device_id} uptime reset ({dev.last_uptime_sec}s → {payload.uptime_sec}s); device restarted.",
                      severity="warning", device_id=dev.device_id)
        if dev.last_risk_state != payload.esp32_risk_state:
            raise_alert(db, "RISK_STATE_CHANGE", _risk_alert_severity(payload.esp32_risk_state),
                        f"ESP32 state {dev.last_risk_state} → {payload.esp32_risk_state}",
                        f"Weighted score {payload.weighted_score}; health {payload.sensor_health}.",
                        dev.device_id,
                        {"from": dev.last_risk_state, "to": payload.esp32_risk_state,
                         "weighted_score": payload.weighted_score,
                         "escalation": SEVERITY_ORDER.get(payload.esp32_risk_state, 1)
                         > SEVERITY_ORDER.get(dev.last_risk_state or "SAFE", 0)}, sim)
        prev_ok = dev.last_sensor_health in (None, "OK")
        now_ok = payload.sensor_health == "OK"
        if prev_ok and not now_ok:
            raise_alert(db, "SENSOR_FAULT", "warning", f"Sensor fault: {payload.sensor_health}",
                        payload.fault_reason or "No fault reason supplied.", dev.device_id,
                        {"sensor_health": payload.sensor_health, "fault_reason": payload.fault_reason}, sim)
        elif not prev_ok and now_ok:
            raise_alert(db, "SENSOR_RECOVERED", "info", "Sensor health restored to OK",
                        f"Previous fault: {dev.last_fault_reason or dev.last_sensor_health}", dev.device_id, None, sim)
        elif not prev_ok and not now_ok and (payload.fault_reason or "") != (dev.last_fault_reason or ""):
            raise_alert(db, "SENSOR_FAULT", "warning", f"Sensor fault changed: {payload.sensor_health}",
                        payload.fault_reason or "", dev.device_id,
                        {"sensor_health": payload.sensor_health, "fault_reason": payload.fault_reason}, sim)

    dev.last_seen = now
    dev.status = "online"
    dev.last_risk_state = payload.esp32_risk_state
    dev.last_sensor_health = payload.sensor_health
    dev.last_fault_reason = payload.fault_reason
    dev.last_wifi_rssi = payload.wifi_rssi
    dev.last_uptime_sec = payload.uptime_sec
    dev.total_readings = (dev.total_readings or 0) + 1

    reading = SensorReading(
        device_id=payload.device_id,
        received_at=now,
        moisture_index=payload.moisture_index,
        rain_index=payload.rain_index,
        tilt_change_deg=payload.tilt_change_deg,
        moisture_rate_per_min=payload.moisture_rate_per_min,
        tilt_rate_deg_per_min=payload.tilt_rate_deg_per_min,
        weighted_score=payload.weighted_score,
        esp32_risk_state=payload.esp32_risk_state,
        sensor_health=payload.sensor_health,
        fault_reason=payload.fault_reason,
        wifi_rssi=payload.wifi_rssi,
        uptime_sec=payload.uptime_sec,
        raw_payload=json.dumps(raw, ensure_ascii=False)[:20000],
        quality_flags=",".join(flags) if flags else None,
        is_valid=not flags,
        is_simulated=sim,
        experiment_id=cfg.get("active_experiment_id"),
    )
    db.add(reading)
    db.flush()
    return reading


def reading_to_dict(r: SensorReading, include_raw: bool = False) -> dict[str, Any]:
    d = {
        "id": r.id,
        "device_id": r.device_id,
        "received_at": iso(r.received_at),
        **{f: getattr(r, f) for f in NUMERIC_FIELDS},
        "esp32_risk_state": r.esp32_risk_state,
        "sensor_health": r.sensor_health,
        "fault_reason": r.fault_reason,
        "wifi_rssi": r.wifi_rssi,
        "uptime_sec": r.uptime_sec,
        "is_valid": r.is_valid,
        "quality_flags": r.quality_flags.split(",") if r.quality_flags else [],
        "is_simulated": r.is_simulated,
        "experiment_id": r.experiment_id,
    }
    if include_raw:
        try:
            d["raw_payload"] = json.loads(r.raw_payload)
        except ValueError:
            d["raw_payload"] = r.raw_payload
    return d


def device_status(dev: Device, timeout_sec: float, now: Optional[datetime] = None) -> dict[str, Any]:
    now = now or utcnow()
    age = (now - dev.last_seen).total_seconds() if dev.last_seen else None
    online = age is not None and age <= timeout_sec
    return {
        "device_id": dev.device_id,
        "online": online,
        "connection_status": "online" if online else "offline",
        "seconds_since_last_seen": clean_float(age, 1),
        "first_seen": iso(dev.first_seen),
        "last_seen": iso(dev.last_seen),
        "last_risk_state": dev.last_risk_state,
        "last_sensor_health": dev.last_sensor_health,
        "last_fault_reason": dev.last_fault_reason,
        "wifi_rssi": dev.last_wifi_rssi,
        "uptime_sec": dev.last_uptime_sec,
        "total_readings": dev.total_readings,
        "reboot_count": dev.reboot_count,
        "is_simulated": dev.is_simulated,
        "offline_timeout_sec": timeout_sec,
    }


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------
def build_filters(
    device_id: Optional[str] = None,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
    window: Optional[str] = None,
    risk_state: Optional[str] = None,
    include_simulated: bool = True,
    valid_only: bool = False,
    experiment_id: Optional[str] = None,
) -> list:
    conds = []
    if device_id:
        conds.append(SensorReading.device_id == device_id)
    if window:
        if window not in WINDOWS:
            raise ValueError(f"window must be one of {list(WINDOWS)}")
        start = utcnow() - WINDOWS[window]
    if start:
        conds.append(SensorReading.received_at >= start)
    if end:
        conds.append(SensorReading.received_at <= end)
    if risk_state:
        states = [s.strip() for s in risk_state.split(",") if s.strip()]
        conds.append(SensorReading.esp32_risk_state.in_(states))
    if not include_simulated:
        conds.append(SensorReading.is_simulated.is_(False))
    if valid_only:
        conds.append(SensorReading.is_valid.is_(True))
    if experiment_id:
        conds.append(SensorReading.experiment_id == experiment_id)
    return conds


def count(db: Session, conds: Iterable) -> int:
    return db.scalar(select(func.count(SensorReading.id)).where(*conds)) or 0


def downsample(rows: list[SensorReading], max_points: int) -> list[dict[str, Any]]:
    """Time-bucket rows: numeric fields averaged, risk state = most severe in bucket.

    Keeps short CRITICAL episodes visible on long windows instead of stride-sampling them away.
    """
    if len(rows) <= max_points:
        return [
            {
                "t": iso(r.received_at),
                **{f: getattr(r, f) for f in NUMERIC_FIELDS},
                "esp32_risk_state": r.esp32_risk_state,
                "sensor_health": r.sensor_health,
                "wifi_rssi": r.wifi_rssi,
                "n": 1,
            }
            for r in rows
        ]
    t0, t1 = rows[0].received_at, rows[-1].received_at
    span = max((t1 - t0).total_seconds(), 1e-6)
    width = span / max_points
    buckets: dict[int, list[SensorReading]] = {}
    for r in rows:
        k = min(int((r.received_at - t0).total_seconds() / width), max_points - 1)
        buckets.setdefault(k, []).append(r)
    out = []
    for k in sorted(buckets):
        grp = buckets[k]
        point: dict[str, Any] = {"t": iso(grp[-1].received_at), "n": len(grp)}
        for f in NUMERIC_FIELDS + ("wifi_rssi",):
            vals = [getattr(r, f) for r in grp if getattr(r, f) is not None]
            point[f] = round(sum(vals) / len(vals), 3) if vals else None
        worst = max(grp, key=lambda r: SEVERITY_ORDER.get(r.esp32_risk_state, 1))
        point["esp32_risk_state"] = worst.esp32_risk_state
        point["sensor_health"] = "OK" if all(r.sensor_health == "OK" for r in grp) else worst.sensor_health
        out.append(point)
    return out


def gap_stats(times: list[datetime], expected_sec: float, factor: float) -> dict[str, Any]:
    """Count telemetry gaps longer than expected_interval * factor."""
    limit = expected_sec * factor
    gaps = []
    for a, b in zip(times, times[1:]):
        d = (b - a).total_seconds()
        if d > limit:
            gaps.append(d)
    est_missing = sum(max(int(g / expected_sec) - 1, 0) for g in gaps)
    return {
        "gap_threshold_sec": limit,
        "gap_count": len(gaps),
        "longest_gap_sec": clean_float(max(gaps), 1) if gaps else 0,
        "estimated_missing_packets": est_missing,
    }


def purge_older_than(db: Session, days: int) -> int:
    if days <= 0:
        return 0
    cutoff = utcnow() - timedelta(days=days)
    n = db.query(SensorReading).filter(SensorReading.received_at < cutoff).delete(synchronize_session=False)
    return n


def is_risk_level(state: Optional[str]) -> bool:
    return state in RISK_LEVELS
