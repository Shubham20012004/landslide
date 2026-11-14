"""Helpers that record alerts (operational, per-device) and system events (audit log)."""
from __future__ import annotations

import logging
from typing import Any, Optional

from sqlalchemy.orm import Session

from ..models import Alert, SystemEvent
from ..utils import dumps, iso, loads

log = logging.getLogger("landslide.events")


def log_event(
    db: Session,
    category: str,
    event_type: str,
    message: str,
    severity: str = "info",
    device_id: Optional[str] = None,
    details: Optional[dict[str, Any]] = None,
) -> SystemEvent:
    ev = SystemEvent(
        category=category,
        event_type=event_type,
        severity=severity,
        device_id=device_id,
        message=message,
        details=dumps(details) if details else None,
    )
    db.add(ev)
    log.info("[%s/%s] %s", category, event_type, message)
    return ev


def raise_alert(
    db: Session,
    alert_type: str,
    severity: str,
    title: str,
    message: str = "",
    device_id: Optional[str] = None,
    details: Optional[dict[str, Any]] = None,
    is_simulated: bool = False,
) -> Alert:
    a = Alert(
        alert_type=alert_type,
        severity=severity,
        title=title,
        message=message,
        device_id=device_id,
        details=dumps(details) if details else None,
        is_simulated=is_simulated,
    )
    db.add(a)
    log.info("ALERT %s [%s] %s", alert_type, severity, title)
    return a


def alert_to_dict(a: Alert) -> dict[str, Any]:
    return {
        "id": a.id,
        "created_at": iso(a.created_at),
        "device_id": a.device_id,
        "alert_type": a.alert_type,
        "severity": a.severity,
        "title": a.title,
        "message": a.message,
        "details": loads(a.details, {}),
        "is_simulated": a.is_simulated,
        "acknowledged": a.acknowledged,
        "acknowledged_at": iso(a.acknowledged_at),
    }


def event_to_dict(e: SystemEvent) -> dict[str, Any]:
    return {
        "id": e.id,
        "created_at": iso(e.created_at),
        "category": e.category,
        "event_type": e.event_type,
        "severity": e.severity,
        "device_id": e.device_id,
        "message": e.message,
        "details": loads(e.details, {}),
    }
