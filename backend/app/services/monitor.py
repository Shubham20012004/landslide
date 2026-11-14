"""Background monitor: marks stale devices offline (once) and applies data retention.

A device is offline when no telemetry arrived within `device_offline_timeout_sec`.
Old database records alone never make a device appear online.
"""
from __future__ import annotations

import asyncio
import logging
import time

from ..database import session_scope
from ..models import Device
from ..utils import utcnow
from . import app_settings
from .events import log_event, raise_alert
from .telemetry import purge_older_than

log = logging.getLogger("landslide.monitor")
_last_retention = 0.0


def check_devices_once() -> int:
    """Return number of devices newly marked offline."""
    changed = 0
    with session_scope() as db:
        timeout = float(app_settings.get(db, "device_offline_timeout_sec"))
        now = utcnow()
        for dev in db.query(Device).filter(Device.status == "online").all():
            if dev.last_seen is None or (now - dev.last_seen).total_seconds() > timeout:
                dev.status = "offline"
                age = (now - dev.last_seen).total_seconds() if dev.last_seen else None
                raise_alert(
                    db, "DEVICE_OFFLINE", "warning", f"{dev.device_id} is offline",
                    f"No telemetry for {age:.0f} s (timeout {timeout:.0f} s). Local ESP32 LEDs/buzzer "
                    "continue to operate independently of Wi-Fi." if age else "No telemetry received.",
                    dev.device_id, {"seconds_since_last_seen": age, "timeout_sec": timeout}, dev.is_simulated,
                )
                log_event(db, "device", "DEVICE_OFFLINE", f"Device {dev.device_id} marked offline.",
                          severity="warning", device_id=dev.device_id)
                changed += 1
    return changed


def apply_retention_once() -> int:
    with session_scope() as db:
        days = int(app_settings.get(db, "data_retention_days") or 0)
        n = purge_older_than(db, days)
        if n:
            log_event(db, "system", "DATA_RETENTION", f"Deleted {n} readings older than {days} days.")
        return n


async def monitor_loop(interval: float) -> None:
    global _last_retention
    log.info("Device monitor started (interval %.1fs)", interval)
    while True:
        try:
            await asyncio.to_thread(check_devices_once)
            if time.monotonic() - _last_retention > 3600:
                _last_retention = time.monotonic()
                await asyncio.to_thread(apply_retention_once)
        except asyncio.CancelledError:
            raise
        except Exception:  # keep the loop alive
            log.exception("monitor iteration failed")
        await asyncio.sleep(interval)
