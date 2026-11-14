"""Telemetry ingestion, readings history, CSV export and device health.

NOTE: no `from __future__ import annotations` here — FastAPI must resolve the
annotations of the class-based `Filters` dependency at runtime.
"""
import csv
import io
import json
from typing import Any, Iterator, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import SessionLocal, get_db
from ..models import Device, SensorReading
from ..schemas.telemetry import ReadingIn, ReadingStored
from ..services import app_settings, risk_engine
from ..services.analytics import sensor_stats
from ..services.telemetry import (
    NUMERIC_FIELDS,
    build_filters,
    count,
    device_status,
    downsample,
    gap_stats,
    ingest,
    reading_to_dict,
)
from ..utils import iso, parse_dt, utcnow

router = APIRouter(prefix="/api", tags=["telemetry"])


class Filters:
    """Shared query parameters for reading queries."""

    def __init__(
        self,
        device_id: Optional[str] = Query(None, max_length=64),
        start: Optional[str] = Query(None, description="ISO-8601 start (UTC if no zone)"),
        end: Optional[str] = Query(None, description="ISO-8601 end"),
        window: Optional[str] = Query(None, description="1m | 5m | 15m | 1h | 6h | 24h | 7d | 30d"),
        risk_state: Optional[str] = Query(None, description="Comma-separated ESP32 states"),
        include_simulated: bool = Query(True),
        valid_only: bool = Query(False),
        experiment_id: Optional[str] = Query(None),
    ):
        try:
            self.conds = build_filters(device_id, parse_dt(start), parse_dt(end), window, risk_state,
                                       include_simulated, valid_only, experiment_id)
        except ValueError as e:
            raise HTTPException(400, str(e))


@router.post("/reading", status_code=201, response_model=ReadingStored,
             summary="Ingest one ESP32 telemetry packet (firmware POST target)")
async def post_reading(request: Request, db: Session = Depends(get_db)) -> Any:
    try:
        raw = await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise HTTPException(400, "Body must be valid JSON.")
    if not isinstance(raw, dict):
        raise HTTPException(400, "Body must be a JSON object.")
    try:
        payload = ReadingIn(**raw)
    except ValidationError as e:
        raise HTTPException(422, {"message": "Telemetry validation failed", "errors": e.errors(include_url=False)})
    # The firmware never sends this header. Test clients (scripts/simulate_esp32.py) set it so that
    # simulated packets are flagged and never mistaken for real measurements.
    simulated = request.headers.get("x-simulated", "").lower() in ("1", "true", "yes")
    reading = ingest(db, payload, raw, is_simulated=simulated)
    db.commit()
    return ReadingStored(id=reading.id, device_id=reading.device_id, received_at=iso(reading.received_at),
                         is_valid=reading.is_valid, quality_flags=reading.quality_flags.split(",") if reading.quality_flags else [])


@router.get("/latest", summary="Latest reading with device status, cross-check and explanation")
def latest(device_id: Optional[str] = None, include_simulated: bool = True, db: Session = Depends(get_db)) -> Any:
    q = db.query(SensorReading)
    if device_id:
        q = q.filter(SensorReading.device_id == device_id)
    if not include_simulated:
        q = q.filter(SensorReading.is_simulated.is_(False))
    r = q.order_by(SensorReading.received_at.desc(), SensorReading.id.desc()).first()
    if r is None:
        return {"reading": None, "device": None, "message": "No telemetry has been received yet."}
    cfg = app_settings.get_all(db)
    dev = db.get(Device, r.device_id)
    d = reading_to_dict(r, include_raw=True)
    thresholds = cfg["analysis_thresholds"]
    return {
        "reading": d,
        "device": device_status(dev, float(cfg["device_offline_timeout_sec"])) if dev else None,
        "reference_check": risk_engine.reference_check(d, thresholds),
        "explanation": risk_engine.explain(d, thresholds),
    }


@router.get("/history", summary="Paginated raw reading history")
def history(
    f: Filters = Depends(),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=1000),
    order: str = Query("desc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
) -> Any:
    total = count(db, f.conds)
    col = SensorReading.received_at.desc() if order == "desc" else SensorReading.received_at.asc()
    rows = db.execute(select(SensorReading).where(*f.conds).order_by(col, SensorReading.id.desc() if order == "desc" else SensorReading.id)
                      .offset((page - 1) * page_size).limit(page_size)).scalars().all()
    return {"total": total, "page": page, "page_size": page_size, "pages": (total + page_size - 1) // page_size,
            "items": [reading_to_dict(r) for r in rows]}


@router.get("/history/series", summary="Time series for charts (time-bucket downsampled)")
def series(f: Filters = Depends(), max_points: int = Query(500, ge=10, le=5000), db: Session = Depends(get_db)) -> Any:
    rows = db.execute(select(SensorReading).where(*f.conds).order_by(SensorReading.received_at)).scalars().all()
    pts = downsample(rows, max_points)
    return {"n_readings": len(rows), "n_points": len(pts), "downsampled": len(rows) > max_points, "points": pts}


CSV_COLUMNS = ["id", "device_id", "received_at", *NUMERIC_FIELDS, "esp32_risk_state", "sensor_health", "fault_reason",
               "wifi_rssi", "uptime_sec", "is_valid", "quality_flags", "is_simulated", "experiment_id"]


@router.get("/history/export.csv", summary="CSV export of filtered readings")
def export_csv(f: Filters = Depends()) -> StreamingResponse:
    stmt = select(SensorReading).where(*f.conds).order_by(SensorReading.received_at).execution_options(yield_per=2000)

    def gen() -> Iterator[str]:
        # Own session: request-scoped dependencies are closed before streaming starts.
        db = SessionLocal()
        try:
            buf = io.StringIO()
            w = csv.writer(buf)
            w.writerow(CSV_COLUMNS)
            yield buf.getvalue()
            for r in db.execute(stmt).scalars():
                buf.seek(0)
                buf.truncate()
                d = reading_to_dict(r)
                d["quality_flags"] = ";".join(d["quality_flags"])
                w.writerow([d.get(c) if d.get(c) is not None else "" for c in CSV_COLUMNS])
                yield buf.getvalue()
        finally:
            db.close()

    name = f"sensor_readings_{utcnow().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(gen(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.get("/devices", summary="All known devices with live online/offline status")
def devices(db: Session = Depends(get_db)) -> Any:
    timeout = float(app_settings.get(db, "device_offline_timeout_sec"))
    now = utcnow()
    devs = db.query(Device).order_by(Device.last_seen.desc()).all()
    return {"devices": [device_status(d, timeout, now) for d in devs], "offline_timeout_sec": timeout}


@router.get("/devices/{device_id}/health", summary="Device health, telemetry quality and history")
def device_health(device_id: str, window: str = Query("24h"), db: Session = Depends(get_db)) -> Any:
    dev = db.get(Device, device_id)
    if dev is None:
        raise HTTPException(404, f"Device '{device_id}' not found.")
    cfg = app_settings.get_all(db)
    try:
        conds = build_filters(device_id=device_id, window=window)
    except ValueError as e:
        raise HTTPException(400, str(e))
    rows = db.execute(select(SensorReading).where(*conds).order_by(SensorReading.received_at)).scalars().all()
    all_conds = build_filters(device_id=device_id)
    total = count(db, all_conds)
    invalid = count(db, all_conds + [SensorReading.is_valid.is_(False)])
    degraded = count(db, all_conds + [SensorReading.sensor_health != "OK"])
    missing = {f: count(db, all_conds + [getattr(SensorReading, f).is_(None)]) for f in
               ("moisture_index", "rain_index", "tilt_change_deg")}
    faults = db.execute(select(SensorReading.received_at, SensorReading.sensor_health, SensorReading.fault_reason)
                        .where(*all_conds, SensorReading.sensor_health != "OK")
                        .order_by(SensorReading.received_at.desc()).limit(20)).all()
    return {
        "device": device_status(dev, float(cfg["device_offline_timeout_sec"])),
        "totals": {"readings": total, "invalid_readings": invalid, "degraded_health_readings": degraded,
                   "missing_channel_values": missing},
        "window": window,
        "window_readings": len(rows),
        "telemetry_gaps": gap_stats([r.received_at for r in rows], cfg["expected_telemetry_interval_sec"],
                                    cfg["telemetry_gap_factor"]),
        "history": downsample(rows, int(cfg["chart_max_points"])),
        "recent_faults": [{"received_at": iso(t), "sensor_health": h, "fault_reason": fr} for t, h, fr in faults],
    }


@router.get("/devices/{device_id}/stats", include_in_schema=False)
def device_stats(device_id: str, window: str = "24h", db: Session = Depends(get_db)) -> Any:
    return sensor_stats(db, build_filters(device_id=device_id, window=window))
