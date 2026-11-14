"""Python port of the ESP32 firmware risk engine.

Used for three things only — it NEVER overrides the risk state the ESP32 reports:

1. `reference_check()` — recompute the weighted score from the reported values with the
   backend's configured thresholds, as an advisory cross-check.
2. `explain()` — a rule-based, human-readable explanation of what drives the score.
3. `FirmwareEngine` — a stateful replica of `evaluateSensorsAndRisk()` (EMA filtering,
   rate-of-change, persistence + hysteresis overrides, fault handling) used by the
   clearly-labelled Demo Mode simulator.

Every threshold is an illustrative prototype parameter, not a geotechnical constant.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

from .app_settings import FIRMWARE_DEFAULT_THRESHOLDS

LEVELS = ("SAFE", "WATCH", "WARNING", "CRITICAL")


def sub_risk(value: float, thresh: list[float]) -> float:
    """Piecewise-linear 0..100 sub-risk, identical to firmware `computeSubRisk()`."""
    if value <= 0.0:
        return 0.0
    if value <= thresh[0]:
        return 25.0 * (value / thresh[0])
    if value <= thresh[1]:
        return 25.0 + 25.0 * ((value - thresh[0]) / (thresh[1] - thresh[0]))
    if value <= thresh[2]:
        return 50.0 + 25.0 * ((value - thresh[1]) / (thresh[2] - thresh[1]))
    if value <= thresh[3]:
        return 75.0 + 25.0 * ((value - thresh[2]) / (thresh[3] - thresh[2]))
    return 100.0


def score_level(score: float, cut: dict[str, float]) -> str:
    if score >= cut["critical"]:
        return "CRITICAL"
    if score >= cut["warning"]:
        return "WARNING"
    if score >= cut["watch"]:
        return "WATCH"
    return "SAFE"


def rate_level(m_rate: Optional[float], t_rate: Optional[float], cfg: dict[str, Any]) -> str:
    """Instantaneous rate level (the firmware additionally requires persistence)."""
    lvl = 0
    mr, tr = cfg["moisture_rate"], cfg["tilt_rate"]
    for i, name in enumerate(("watch", "warning", "critical"), start=1):
        if (m_rate is not None and m_rate >= mr[name]) or (t_rate is not None and t_rate >= tr[name]):
            lvl = i
    return LEVELS[lvl]


@dataclass
class Components:
    moisture: float
    rain: float
    tilt: float
    score: float
    level: str
    missing: list[str]


def weighted(
    moisture: Optional[float], rain: Optional[float], tilt: Optional[float], cfg: dict[str, Any]
) -> Components:
    """Firmware rule: an unhealthy channel contributes a neutral sub-risk of 50."""
    missing = [n for n, v in (("moisture", moisture), ("rain", rain), ("tilt", tilt)) if v is None]
    m = sub_risk(moisture, cfg["moisture"]) if moisture is not None else 50.0
    r = sub_risk(rain, cfg["rain"]) if rain is not None else 50.0
    t = sub_risk(tilt, cfg["tilt"]) if tilt is not None else 50.0
    w = cfg["weights"]
    s = w["moisture"] * m + w["rain"] * r + w["tilt"] * t
    return Components(m, r, t, s, score_level(s, cfg["score_cutoffs"]), missing)


def reference_check(reading: dict[str, Any], cfg: dict[str, Any]) -> dict[str, Any]:
    c = weighted(reading.get("moisture_index"), reading.get("rain_index"), reading.get("tilt_change_deg"), cfg)
    reported = reading.get("weighted_score")
    diff = None if reported is None else round(abs(reported - c.score), 2)
    tol = cfg.get("score_mismatch_tolerance", 1.5)
    return {
        "backend_reference_score": round(c.score, 2),
        "backend_score_level": c.level,
        "instantaneous_rate_level": rate_level(
            reading.get("moisture_rate_per_min"), reading.get("tilt_rate_deg_per_min"), cfg
        ),
        "reported_score": reported,
        "abs_difference": diff,
        "consistent": None if diff is None else diff <= tol,
        "tolerance": tol,
        "note": (
            "Advisory recomputation using the backend's configured thresholds. "
            "The ESP32-reported state remains authoritative."
        ),
    }


def explain(reading: dict[str, Any], cfg: dict[str, Any]) -> dict[str, Any]:
    """Rule-based explanation of the reading. Not produced by the ML model."""
    c = weighted(reading.get("moisture_index"), reading.get("rain_index"), reading.get("tilt_change_deg"), cfg)
    w = cfg["weights"]
    contributions = [
        {"factor": "Soil Moisture Index", "key": "moisture", "value": reading.get("moisture_index"),
         "sub_risk": round(c.moisture, 1), "weight": w["moisture"], "points": round(w["moisture"] * c.moisture, 1),
         "missing": "moisture" in c.missing},
        {"factor": "Rain Activity Index", "key": "rain", "value": reading.get("rain_index"),
         "sub_risk": round(c.rain, 1), "weight": w["rain"], "points": round(w["rain"] * c.rain, 1),
         "missing": "rain" in c.missing},
        {"factor": "Slope Tilt Change", "key": "tilt", "value": reading.get("tilt_change_deg"),
         "sub_risk": round(c.tilt, 1), "weight": w["tilt"], "points": round(w["tilt"] * c.tilt, 1),
         "missing": "tilt" in c.missing},
    ]
    reasons: list[str] = []
    for item in sorted(contributions, key=lambda x: -x["points"]):
        if item["missing"]:
            reasons.append(f"{item['factor']} unavailable (sensor unhealthy) — firmware substitutes a neutral sub-risk of 50.")
        elif item["sub_risk"] >= 50:
            reasons.append(f"{item['factor']} is high ({item['value']}) → sub-risk {item['sub_risk']}, adding {item['points']} points.")
        elif item["sub_risk"] >= 25:
            reasons.append(f"{item['factor']} is elevated ({item['value']}) → adding {item['points']} points.")
    mr, tr = reading.get("moisture_rate_per_min"), reading.get("tilt_rate_deg_per_min")
    mcfg, tcfg = cfg["moisture_rate"], cfg["tilt_rate"]
    if mr is not None and mr >= mcfg["watch"]:
        reasons.append(f"Soil moisture rising at {mr:.2f} %-pts/min (WATCH override threshold {mcfg['watch']}).")
    if tr is not None and tr >= tcfg["watch"]:
        reasons.append(f"Tilt changing at {tr:.2f} °/min (WATCH override threshold {tcfg['watch']}).")
    state = reading.get("esp32_risk_state")
    if state in LEVELS and c.level != state and LEVELS.index(state) > LEVELS.index(c.level):
        reasons.append(
            f"ESP32 state {state} is above the score level {c.level}: consistent with a persistent "
            "rate-of-change override latched on the device."
        )
    if reading.get("sensor_health") not in (None, "OK"):
        reasons.append("Sensor health is degraded; the firmware never reports degraded data as SAFE.")
    if not reasons:
        reasons.append("All indicators are below their first prototype thresholds.")
    return {
        "contributions": contributions,
        "score_level": c.level,
        "reasons": reasons,
        "source": "rule-based explanation (backend port of firmware logic)",
    }


# ---------------------------------------------------------------------------
# Stateful firmware replica (Demo Mode only)
# ---------------------------------------------------------------------------
EMA_VALUE_ALPHA = 0.35
EMA_RATE_ALPHA = 0.40


@dataclass
class FirmwareEngine:
    cfg: dict[str, Any] = field(default_factory=lambda: dict(FIRMWARE_DEFAULT_THRESHOLDS))
    filter_initialized: bool = False
    filt_moisture: float = 0.0
    filt_tilt: float = 0.0
    m_rate: float = 0.0
    t_rate: float = 0.0
    latched: int = 0
    above: list[int] = field(default_factory=lambda: [0, 0, 0, 0])
    below: list[int] = field(default_factory=lambda: [0, 0, 0, 0])
    rain: float = 0.0
    weighted_score: float = 0.0
    final_level: int = 0
    sensor_health: str = "DATA_INCOMPLETE"
    fault_reason: str = "Initializing sensors"
    soil_ok: bool = False
    rain_ok: bool = False
    mpu_ok: bool = False

    def _rate_overrides(self, m: float, t: float) -> None:
        mc, tc = self.cfg["moisture_rate"], self.cfg["tilt_rate"]
        persist, clear_n = self.cfg["rate_trigger_persist"], self.cfg["rate_clear_persist"]
        names = {1: "watch", 2: "warning", 3: "critical"}
        for lvl in (1, 2, 3):
            n = names[lvl]
            exceed = m >= mc[n] or t >= tc[n]
            clear = m < mc[n] - mc.get("hysteresis", 0) and t < tc[n] - tc.get("hysteresis", 0)
            if exceed:
                self.above[lvl] += 1
                self.below[lvl] = 0
                if self.above[lvl] >= persist and self.latched < lvl:
                    self.latched = lvl
            elif clear:
                self.below[lvl] += 1
                self.above[lvl] = 0
                if self.below[lvl] >= clear_n and self.latched == lvl:
                    self.latched = lvl - 1

    def step(
        self, moisture: Optional[float], rain: Optional[float], tilt: Optional[float], dt_sec: float = 2.0
    ) -> None:
        """One sample. Pass None for a channel to simulate a sensor fault."""
        self.soil_ok, self.rain_ok, self.mpu_ok = moisture is not None, rain is not None, tilt is not None
        faults = []
        if not self.soil_ok:
            faults.append("SOIL_ADC_OUT_OF_RANGE; ")
        if not self.rain_ok:
            faults.append("RAIN_ADC_OUT_OF_RANGE; ")
        if not self.mpu_ok:
            faults.append("MPU6050_I2C_FAULT; ")
        healthy = 3 - len(faults)
        self.sensor_health = "OK" if healthy == 3 else ("SENSOR_FAULT" if healthy == 0 else "DATA_INCOMPLETE")
        self.fault_reason = "".join(faults)
        if self.rain_ok:
            self.rain = float(rain)

        dt_min = dt_sec / 60.0
        if not self.filter_initialized and self.soil_ok and self.mpu_ok:
            self.filt_moisture, self.filt_tilt = float(moisture), float(tilt)
            self.m_rate = self.t_rate = 0.0
            self.filter_initialized = True
        elif self.filter_initialized:
            pm, pt = self.filt_moisture, self.filt_tilt
            if self.soil_ok:
                self.filt_moisture = EMA_VALUE_ALPHA * moisture + (1 - EMA_VALUE_ALPHA) * pm
                self.m_rate = EMA_RATE_ALPHA * ((self.filt_moisture - pm) / dt_min) + (1 - EMA_RATE_ALPHA) * self.m_rate
            if self.mpu_ok:
                self.filt_tilt = EMA_VALUE_ALPHA * tilt + (1 - EMA_VALUE_ALPHA) * pt
                self.t_rate = EMA_RATE_ALPHA * ((self.filt_tilt - pt) / dt_min) + (1 - EMA_RATE_ALPHA) * self.t_rate

        c = weighted(
            self.filt_moisture if self.soil_ok else None,
            self.rain if self.rain_ok else None,
            self.filt_tilt if self.mpu_ok else None,
            self.cfg,
        )
        self.weighted_score = c.score
        if self.soil_ok and self.mpu_ok:
            self._rate_overrides(self.m_rate, self.t_rate)
        combined = max(LEVELS.index(c.level), self.latched)
        if self.sensor_health != "OK" and combined == 0:
            combined = 1
        self.final_level = combined

    def payload(self, device_id: str, uptime_sec: int, rssi: int) -> dict[str, Any]:
        """JSON identical in shape to the firmware's HTTP POST body."""
        reported = (
            self.sensor_health
            if self.sensor_health != "OK" and self.final_level <= 1
            else LEVELS[self.final_level]
        )
        return {
            "device_id": device_id,
            "moisture_index": round(self.filt_moisture, 2) if self.soil_ok else None,
            "rain_index": round(self.rain, 2) if self.rain_ok else None,
            "tilt_change_deg": round(self.filt_tilt, 2) if self.mpu_ok else None,
            "moisture_rate_per_min": round(self.m_rate, 2) if self.soil_ok else None,
            "tilt_rate_deg_per_min": round(self.t_rate, 2) if self.mpu_ok else None,
            "weighted_score": round(self.weighted_score, 2),
            "esp32_risk_state": reported,
            "sensor_health": self.sensor_health,
            "fault_reason": self.fault_reason or None,
            "wifi_rssi": rssi,
            "uptime_sec": uptime_sec,
        }
