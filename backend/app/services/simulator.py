"""DEMO MODE simulator.

Generates SIMULATED telemetry so the platform can be demonstrated without hardware.
Each scenario produces underlying moisture/rain/tilt values that are passed through
`FirmwareEngine` (a port of the ESP32 risk logic), then ingested through the SAME code
path as real telemetry with `is_simulated=True`. Simulated readings, devices and alerts
are flagged everywhere in the UI and excluded from dataset exports by default.

Simulated values are NOT measurements and must never be reported as project findings.
"""
from __future__ import annotations

import asyncio
import logging
import math
import random
from dataclasses import dataclass
from typing import Callable, Optional

from ..database import session_scope
from ..models import Alert, Device, SensorReading
from ..schemas.telemetry import ReadingIn
from ..utils import iso, utcnow
from . import app_settings
from .events import log_event
from .risk_engine import FirmwareEngine
from .telemetry import ingest

log = logging.getLogger("landslide.demo")
DEMO_DEVICE_ID = "demo-sim-node-01"
SAMPLE_SEC = 2.0  # firmware SAMPLE_INTERVAL_MS
SAMPLES_PER_POST = 2  # firmware posts every 4 s = 2 samples

Values = tuple[Optional[float], Optional[float], Optional[float]]


def _ramp(k: int, start: int, length: int) -> float:
    if k <= start:
        return 0.0
    return min(1.0, (k - start) / length)


def _normal(k: int, rnd: random.Random) -> Values:
    return (30 + rnd.gauss(0, 0.6), max(0.0, 4 + rnd.gauss(0, 1.5)), abs(0.25 + rnd.gauss(0, 0.05)))


def _heavy_rain(k: int, rnd: random.Random) -> Values:
    rain = 5 + 85 * _ramp(k, 5, 25)
    moist = 30 + 58 * _ramp(k, 15, 120)
    tilt = 0.3 + 6.5 * _ramp(k, 70, 100) ** 2
    return (moist + rnd.gauss(0, 0.6), min(100, rain + rnd.gauss(0, 2)), tilt + abs(rnd.gauss(0, 0.05)))


def _rapid_saturation(k: int, rnd: random.Random) -> Values:
    moist = 30 + 65 * _ramp(k, 8, 45)  # ~2.9 %-pts per 2 s sample ≈ 87 %/min peak
    return (moist + rnd.gauss(0, 0.5), 35 + rnd.gauss(0, 3), 0.4 + 1.5 * _ramp(k, 40, 60) + abs(rnd.gauss(0, 0.04)))


def _increasing_tilt(k: int, rnd: random.Random) -> Values:
    tilt = 0.3 + 14 * _ramp(k, 10, 110) ** 2.2
    return (45 + rnd.gauss(0, 0.5), max(0.0, 10 + rnd.gauss(0, 2)), tilt + abs(rnd.gauss(0, 0.05)))


def _combined(k: int, rnd: random.Random) -> Values:
    f = _ramp(k, 5, 140)
    return (
        30 + 62 * f + rnd.gauss(0, 0.6),
        min(100.0, 5 + 90 * _ramp(k, 0, 40) + rnd.gauss(0, 2)),
        0.3 + 12 * f ** 2.5 + abs(rnd.gauss(0, 0.05)),
    )


def _sensor_fault(k: int, rnd: random.Random) -> Values:
    m, r, t = _normal(k, rnd)
    if 20 <= k < 60:
        t = None  # MPU6050 I2C fault
    if 40 <= k < 60:
        m = None  # soil ADC out of range
    return (m, r, t)


def _recovery(k: int, rnd: random.Random) -> Values:
    f = 1 - _ramp(k, 10, 120)
    return (30 + 55 * f + rnd.gauss(0, 0.5), max(0.0, 4 + 80 * (1 - _ramp(k, 0, 30)) + rnd.gauss(0, 2)), 0.3 + 5 * f)


@dataclass(frozen=True)
class Scenario:
    key: str
    label: str
    description: str
    fn: Callable[[int, random.Random], Values]


SCENARIOS: dict[str, Scenario] = {s.key: s for s in [
    Scenario("normal", "Normal Conditions", "Stable, dry slope with sensor noise only.", _normal),
    Scenario("heavy_rain", "Heavy Rain", "Rain activity rises fast, soil moisture follows, tilt starts creeping late.", _heavy_rain),
    Scenario("rapid_saturation", "Rapid Soil Saturation", "Moisture climbs steeply; exercises the moisture rate-of-change override.", _rapid_saturation),
    Scenario("increasing_tilt", "Increasing Tilt", "Accelerating slope tilt with moderate moisture; exercises the tilt-rate override.", _increasing_tilt),
    Scenario("combined", "Combined Risk", "All indicators rise together towards CRITICAL.", _combined),
    Scenario("sensor_fault", "Sensor Fault", "MPU6050 then soil channel drop out and recover; shows DATA_INCOMPLETE handling.", _sensor_fault),
    Scenario("recovery", "Drying / Recovery", "Starts wet and tilted, then drains back towards SAFE (hysteresis step-down).", _recovery),
]}


class DemoSimulator:
    def __init__(self) -> None:
        self.task: Optional[asyncio.Task] = None
        self.scenario: Optional[str] = None
        self.speed: float = 1.0
        self.started_at = None
        self.posts = 0
        self.last_state: Optional[str] = None

    @property
    def running(self) -> bool:
        return self.task is not None and not self.task.done()

    def status(self) -> dict:
        return {
            "running": self.running,
            "scenario": self.scenario if self.running else None,
            "scenario_label": SCENARIOS[self.scenario].label if self.running and self.scenario else None,
            "speed": self.speed,
            "device_id": DEMO_DEVICE_ID,
            "started_at": iso(self.started_at) if self.running else None,
            "posts": self.posts,
            "last_state": self.last_state,
            "scenarios": [{"key": s.key, "label": s.label, "description": s.description} for s in SCENARIOS.values()],
            "notice": "DEMO MODE — readings are SIMULATED by a software port of the firmware logic, not measured.",
        }

    async def start(self, scenario: str, speed: float = 1.0) -> None:
        if scenario not in SCENARIOS:
            raise ValueError(f"unknown scenario '{scenario}'")
        await self.stop(log_it=False)
        self.scenario, self.speed, self.posts = scenario, speed, 0
        self.started_at = utcnow()
        self.task = asyncio.create_task(self._run(scenario, speed))
        with session_scope() as db:
            log_event(db, "demo", "DEMO_STARTED",
                      f"Demo Mode started: {SCENARIOS[scenario].label} (×{speed} speed). Readings are SIMULATED.",
                      device_id=DEMO_DEVICE_ID)

    async def stop(self, log_it: bool = True) -> None:
        if self.task and not self.task.done():
            self.task.cancel()
            try:
                await self.task
            except (asyncio.CancelledError, Exception):
                pass
            if log_it:
                with session_scope() as db:
                    log_event(db, "demo", "DEMO_STOPPED", "Demo Mode stopped.", device_id=DEMO_DEVICE_ID)
        self.task = None

    async def _run(self, scenario: str, speed: float) -> None:
        rnd = random.Random(42)
        with session_scope() as db:
            cfg = app_settings.get(db, "analysis_thresholds")
        engine = FirmwareEngine(cfg=cfg)
        fn = SCENARIOS[scenario].fn
        k = 0
        uptime = 0
        while True:
            for _ in range(SAMPLES_PER_POST):
                engine.step(*fn(k, rnd), dt_sec=SAMPLE_SEC)
                k += 1
                uptime += int(SAMPLE_SEC)
            rssi = int(-55 + 6 * math.sin(k / 15) + rnd.gauss(0, 1.5))
            payload = engine.payload(DEMO_DEVICE_ID, uptime, rssi)
            try:
                await asyncio.to_thread(self._post, payload)
                self.posts += 1
                self.last_state = payload["esp32_risk_state"]
            except Exception:
                log.exception("demo ingest failed")
            await asyncio.sleep(SAMPLE_SEC * SAMPLES_PER_POST / speed)

    @staticmethod
    def _post(payload: dict) -> None:
        with session_scope() as db:
            ingest(db, ReadingIn(**payload), payload, is_simulated=True)


def purge_simulated_data() -> dict[str, int]:
    with session_scope() as db:
        r = db.query(SensorReading).filter(SensorReading.is_simulated.is_(True)).delete(synchronize_session=False)
        a = db.query(Alert).filter(Alert.is_simulated.is_(True)).delete(synchronize_session=False)
        d = db.query(Device).filter(Device.is_simulated.is_(True)).delete(synchronize_session=False)
        log_event(db, "demo", "DEMO_DATA_PURGED", f"Deleted {r} simulated readings, {a} simulated alerts, {d} simulated devices.")
    return {"readings": r, "alerts": a, "devices": d}


simulator = DemoSimulator()
