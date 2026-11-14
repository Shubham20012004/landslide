"""Telemetry contract, matching `sendTelemetryIfConnected()` in the ESP32 firmware.

The firmware sends null for unhealthy sensor channels, and esp32_risk_state can be
SAFE / WATCH / WARNING / CRITICAL or (when health is degraded and the risk is at most
WATCH) the health string DATA_INCOMPLETE / SENSOR_FAULT.

Validation philosophy: reject structurally malformed payloads (wrong types, missing
required fields); ACCEPT and preserve values that are merely out of the expected range,
but flag them as invalid so they are counted in analytics instead of silently dropped.
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, StrictInt

RISK_LEVELS = ("SAFE", "WATCH", "WARNING", "CRITICAL")
DEGRADED_STATES = ("DATA_INCOMPLETE", "SENSOR_FAULT")
KNOWN_RISK_STATES = RISK_LEVELS + DEGRADED_STATES
KNOWN_HEALTH = ("OK", "DATA_INCOMPLETE", "SENSOR_FAULT")


class ReadingIn(BaseModel):
    model_config = ConfigDict(extra="allow")  # extra keys are preserved in raw_payload

    device_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.:-]+$")
    moisture_index: Optional[float] = Field(default=None, allow_inf_nan=False)
    rain_index: Optional[float] = Field(default=None, allow_inf_nan=False)
    tilt_change_deg: Optional[float] = Field(default=None, allow_inf_nan=False)
    moisture_rate_per_min: Optional[float] = Field(default=None, allow_inf_nan=False)
    tilt_rate_deg_per_min: Optional[float] = Field(default=None, allow_inf_nan=False)
    weighted_score: Optional[float] = Field(default=None, allow_inf_nan=False)
    esp32_risk_state: str = Field(min_length=1, max_length=32)
    sensor_health: str = Field(min_length=1, max_length=32)
    fault_reason: Optional[str] = Field(default=None, max_length=500)
    wifi_rssi: Optional[StrictInt] = None
    uptime_sec: Optional[StrictInt] = None


class ReadingStored(BaseModel):
    status: str = "stored"
    id: int
    device_id: str
    received_at: str
    is_valid: bool
    quality_flags: list[str]


def quality_flags(r: ReadingIn) -> list[str]:
    """Range / consistency checks. Returned flags mark a reading as invalid."""
    flags: list[str] = []

    def rng(name: str, v: Optional[float], lo: float, hi: float) -> None:
        if v is not None and not (lo <= v <= hi):
            flags.append(f"{name}_out_of_range")

    rng("moisture_index", r.moisture_index, 0, 100)
    rng("rain_index", r.rain_index, 0, 100)
    rng("tilt_change_deg", r.tilt_change_deg, 0, 180)
    rng("moisture_rate_per_min", r.moisture_rate_per_min, -500, 500)
    rng("tilt_rate_deg_per_min", r.tilt_rate_deg_per_min, -500, 500)
    rng("weighted_score", r.weighted_score, 0, 100)
    if r.wifi_rssi is not None and not (-127 <= r.wifi_rssi <= 0):
        flags.append("wifi_rssi_out_of_range")
    if r.uptime_sec is not None and r.uptime_sec < 0:
        flags.append("uptime_negative")
    if r.esp32_risk_state not in KNOWN_RISK_STATES:
        flags.append("unknown_risk_state")
    if r.sensor_health not in KNOWN_HEALTH:
        flags.append("unknown_sensor_health")
    if r.sensor_health == "OK" and any(
        v is None for v in (r.moisture_index, r.rain_index, r.tilt_change_deg)
    ):
        flags.append("null_channel_with_ok_health")
    if r.weighted_score is None:
        flags.append("weighted_score_missing")
    return flags
