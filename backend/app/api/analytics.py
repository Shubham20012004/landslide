from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..services import analytics
from .telemetry import Filters

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/summary", summary="Platform-wide summary for the overview dashboard")
def summary(include_simulated: bool = True, db: Session = Depends(get_db)) -> Any:
    return analytics.summary(db, include_simulated)


@router.get("/sensors", summary="Per-sensor statistics (current/min/max/mean/std/trend/missing/invalid)")
def sensors(f: Filters = Depends(), sensors: Optional[str] = Query(None, description="Comma-separated sensor keys"),
            db: Session = Depends(get_db)) -> Any:
    keys = [s.strip() for s in sensors.split(",")] if sensors else None
    return analytics.sensor_stats(db, f.conds, keys)


@router.get("/risk-distribution", summary="ESP32 risk-state distribution")
def risk_distribution(f: Filters = Depends(), db: Session = Depends(get_db)) -> Any:
    return analytics.risk_distribution(db, f.conds)
