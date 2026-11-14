"""ORM table definitions.

Tables: devices, sensor_readings, alerts, system_events, datasets,
training_runs, trained_models, app_settings.
All timestamps are stored as naive UTC datetimes.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base
from ..utils import utcnow


class Device(Base):
    __tablename__ = "devices"

    device_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    first_seen: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_seen: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    # Connection status as last evaluated by the monitor (used to emit transitions only once).
    status: Mapped[str] = mapped_column(String(16), default="online")
    last_risk_state: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    last_sensor_health: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    last_fault_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    last_wifi_rssi: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    last_uptime_sec: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    total_readings: Mapped[int] = mapped_column(Integer, default=0)
    reboot_count: Mapped[int] = mapped_column(Integer, default=0)
    is_simulated: Mapped[bool] = mapped_column(Boolean, default=False)


class SensorReading(Base):
    __tablename__ = "sensor_readings"
    __table_args__ = (
        Index("ix_readings_device_time", "device_id", "received_at"),
        Index("ix_readings_sim_time", "is_simulated", "received_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    device_id: Mapped[str] = mapped_column(String(64), index=True)
    received_at: Mapped[datetime] = mapped_column(DateTime, index=True, default=utcnow)

    moisture_index: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    rain_index: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    tilt_change_deg: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    moisture_rate_per_min: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    tilt_rate_deg_per_min: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    weighted_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    esp32_risk_state: Mapped[str] = mapped_column(String(32), index=True)
    sensor_health: Mapped[str] = mapped_column(String(32))
    fault_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    wifi_rssi: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    uptime_sec: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    raw_payload: Mapped[str] = mapped_column(Text)
    quality_flags: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_valid: Mapped[bool] = mapped_column(Boolean, default=True)
    is_simulated: Mapped[bool] = mapped_column(Boolean, default=False)
    experiment_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    device_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    alert_type: Mapped[str] = mapped_column(String(40), index=True)
    severity: Mapped[str] = mapped_column(String(16), index=True)  # info | warning | critical
    title: Mapped[str] = mapped_column(String(200))
    message: Mapped[str] = mapped_column(Text, default="")
    details: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_simulated: Mapped[bool] = mapped_column(Boolean, default=False)
    acknowledged: Mapped[bool] = mapped_column(Boolean, default=False)
    acknowledged_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class SystemEvent(Base):
    __tablename__ = "system_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    category: Mapped[str] = mapped_column(String(24), index=True)  # device|dataset|ml|system|demo
    event_type: Mapped[str] = mapped_column(String(48), index=True)
    severity: Mapped[str] = mapped_column(String(16), default="info")
    device_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    message: Mapped[str] = mapped_column(Text, default="")
    details: Mapped[Optional[str]] = mapped_column(Text, nullable=True)


class Dataset(Base):
    __tablename__ = "datasets"
    __table_args__ = (UniqueConstraint("name", "version", name="uq_dataset_name_version"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    category: Mapped[str] = mapped_column(String(16), index=True)  # historical | experimental
    description: Mapped[str] = mapped_column(Text, default="")
    original_filename: Mapped[str] = mapped_column(String(255))
    stored_path: Mapped[str] = mapped_column(String(500))
    cleaned_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    file_size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    encoding: Mapped[str] = mapped_column(String(24), default="utf-8")
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    n_rows: Mapped[int] = mapped_column(Integer, default=0)
    n_columns: Mapped[int] = mapped_column(Integer, default=0)
    profile_json: Mapped[str] = mapped_column(Text, default="{}")
    cleaning_report_json: Mapped[str] = mapped_column(Text, default="{}")
    column_mapping_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Provenance of labels for experimental datasets.
    label_source: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    source: Mapped[str] = mapped_column(String(40), default="upload")  # upload|recorded_readings|synthetic_fixture


class TrainingRun(Base):
    __tablename__ = "training_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="queued", index=True)
    dataset_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("datasets.id", ondelete="SET NULL"), nullable=True
    )
    dataset_name: Mapped[str] = mapped_column(String(160), default="")
    config_json: Mapped[str] = mapped_column(Text, default="{}")
    warnings_json: Mapped[str] = mapped_column(Text, default="[]")
    log: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    model_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    duration_sec: Mapped[Optional[float]] = mapped_column(Float, nullable=True)


class TrainedModel(Base):
    __tablename__ = "trained_models"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    version: Mapped[int] = mapped_column(Integer, unique=True)
    name: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    run_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    dataset_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    dataset_name: Mapped[str] = mapped_column(String(160), default="")
    dataset_hash: Mapped[str] = mapped_column(String(64), default="")
    features_json: Mapped[str] = mapped_column(Text)
    target: Mapped[str] = mapped_column(String(120))
    classes_json: Mapped[str] = mapped_column(Text)
    hyperparams_json: Mapped[str] = mapped_column(Text)
    split_strategy: Mapped[str] = mapped_column(String(24))
    split_details_json: Mapped[str] = mapped_column(Text, default="{}")
    metrics_json: Mapped[str] = mapped_column(Text)
    training_duration_sec: Mapped[float] = mapped_column(Float, default=0.0)
    n_rows: Mapped[int] = mapped_column(Integer, default=0)
    n_train: Mapped[int] = mapped_column(Integer, default=0)
    n_test: Mapped[int] = mapped_column(Integer, default=0)
    artifact_path: Mapped[str] = mapped_column(String(500))
    artifact_sha256: Mapped[str] = mapped_column(String(64))
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    label_source: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    warnings_json: Mapped[str] = mapped_column(Text, default="[]")
    notes: Mapped[str] = mapped_column(Text, default="")


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value_json: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
