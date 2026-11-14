"""Application configuration loaded from environment variables / backend/.env.

Nothing secret is hard-coded here. Copy `backend/.env.example` to `backend/.env`
to override values locally.
"""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    app_name: str = "Landslide Risk Monitoring & Intelligence Platform"
    app_version: str = "1.0.0"

    database_url: str = f"sqlite:///{(BACKEND_DIR / 'data' / 'landslide.db').as_posix()}"
    upload_dir: Path = BACKEND_DIR / "uploads"
    artifact_dir: Path = BACKEND_DIR / "artifacts"

    # Comma-separated list of browser origins allowed to call the API.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    max_upload_mb: int = 50
    max_dataset_rows: int = 1_000_000

    log_level: str = "INFO"
    # Background loop that marks devices offline and applies data retention.
    enable_background_tasks: bool = True
    monitor_interval_sec: float = 5.0
    # Thread pool size for model training jobs (training never blocks the API loop).
    training_workers: int = 1

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


settings = Settings()
