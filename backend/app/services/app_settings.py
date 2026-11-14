"""Backend application settings stored in the `app_settings` table.

IMPORTANT: these are BACKEND / DASHBOARD settings. Changing them never changes the
ESP32 firmware. The firmware computes its own risk state with constants compiled
into the sketch; no configuration protocol to the device exists in this project.
"""
from __future__ import annotations

import copy
from typing import Any, Optional

from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from ..models import AppSetting
from ..utils import dumps, loads, utcnow

# Default analysis thresholds mirror the constants in the supplied firmware
# (MOISTURE_THRESH, RAIN_THRESH, TILT_THRESH, WEIGHT_*, rate thresholds).
FIRMWARE_DEFAULT_THRESHOLDS: dict[str, Any] = {
    "moisture": [35.0, 60.0, 80.0, 100.0],
    "rain": [25.0, 55.0, 80.0, 100.0],
    "tilt": [2.0, 5.0, 10.0, 20.0],
    "weights": {"moisture": 0.40, "rain": 0.30, "tilt": 0.30},
    "score_cutoffs": {"watch": 25.0, "warning": 50.0, "critical": 75.0},
    "moisture_rate": {"watch": 3.0, "warning": 6.0, "critical": 12.0, "hysteresis": 0.8},
    "tilt_rate": {"watch": 0.5, "warning": 1.5, "critical": 3.5, "hysteresis": 0.15},
    "rate_trigger_persist": 3,
    "rate_clear_persist": 2,
    "score_mismatch_tolerance": 1.5,
}

DEFAULTS: dict[str, Any] = {
    "dashboard_refresh_ms": 4000,
    "device_offline_timeout_sec": 20,
    "expected_telemetry_interval_sec": 4,
    "telemetry_gap_factor": 2.5,
    "data_retention_days": 0,  # 0 = keep forever
    "time_format_24h": True,
    "chart_max_points": 500,
    "show_simulated_data": True,
    "active_experiment_id": None,
    "analysis_thresholds": FIRMWARE_DEFAULT_THRESHOLDS,
}


class Ladder(BaseModel):
    watch: float = Field(gt=0)
    warning: float = Field(gt=0)
    critical: float = Field(gt=0)
    hysteresis: float = Field(default=0.0, ge=0)

    @model_validator(mode="after")
    def _ascending(self) -> "Ladder":
        if not (self.watch < self.warning < self.critical):
            raise ValueError("rate thresholds must be ascending: watch < warning < critical")
        return self


class Thresholds(BaseModel):
    moisture: list[float] = Field(min_length=4, max_length=4)
    rain: list[float] = Field(min_length=4, max_length=4)
    tilt: list[float] = Field(min_length=4, max_length=4)
    weights: dict[str, float]
    score_cutoffs: dict[str, float]
    moisture_rate: Ladder
    tilt_rate: Ladder
    rate_trigger_persist: int = Field(ge=1, le=20)
    rate_clear_persist: int = Field(ge=1, le=20)
    score_mismatch_tolerance: float = Field(ge=0, le=50)

    @model_validator(mode="after")
    def _check(self) -> "Thresholds":
        for name in ("moisture", "rain", "tilt"):
            t = getattr(self, name)
            if any(v <= 0 for v in t) or any(t[i] >= t[i + 1] for i in range(3)):
                raise ValueError(f"{name} thresholds must be positive and strictly ascending")
        if set(self.weights) != {"moisture", "rain", "tilt"}:
            raise ValueError("weights must contain exactly moisture, rain, tilt")
        if any(w < 0 for w in self.weights.values()) or abs(sum(self.weights.values()) - 1.0) > 1e-3:
            raise ValueError("weights must be non-negative and sum to 1.0")
        c = self.score_cutoffs
        if set(c) != {"watch", "warning", "critical"} or not (0 < c["watch"] < c["warning"] < c["critical"] <= 100):
            raise ValueError("score cut-offs must satisfy 0 < watch < warning < critical <= 100")
        return self


class SettingsUpdate(BaseModel):
    dashboard_refresh_ms: Optional[int] = Field(default=None, ge=1000, le=60000)
    device_offline_timeout_sec: Optional[int] = Field(default=None, ge=6, le=3600)
    expected_telemetry_interval_sec: Optional[float] = Field(default=None, ge=1, le=600)
    telemetry_gap_factor: Optional[float] = Field(default=None, ge=1.5, le=20)
    data_retention_days: Optional[int] = Field(default=None, ge=0, le=3650)
    time_format_24h: Optional[bool] = None
    chart_max_points: Optional[int] = Field(default=None, ge=50, le=5000)
    show_simulated_data: Optional[bool] = None
    analysis_thresholds: Optional[Thresholds] = None


def get_all(db: Session) -> dict[str, Any]:
    out = copy.deepcopy(DEFAULTS)
    for row in db.query(AppSetting).all():
        if row.key in out:
            out[row.key] = loads(row.value_json, out[row.key])
    return out


def get(db: Session, key: str) -> Any:
    row = db.get(AppSetting, key)
    if row is None:
        return copy.deepcopy(DEFAULTS.get(key))
    return loads(row.value_json, copy.deepcopy(DEFAULTS.get(key)))


def put(db: Session, key: str, value: Any) -> None:
    row = db.get(AppSetting, key)
    if row is None:
        db.add(AppSetting(key=key, value_json=dumps(value), updated_at=utcnow()))
    else:
        row.value_json = dumps(value)
        row.updated_at = utcnow()


def update(db: Session, upd: SettingsUpdate) -> dict[str, Any]:
    data = upd.model_dump(exclude_none=True)
    for k, v in data.items():
        put(db, k, v)
    db.flush()  # sessions use autoflush=False; make new rows visible to get_all()
    return get_all(db)


def reset_thresholds(db: Session) -> None:
    put(db, "analysis_thresholds", copy.deepcopy(FIRMWARE_DEFAULT_THRESHOLDS))
    db.flush()
