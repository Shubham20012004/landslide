"""Test configuration: every test run uses its own temporary database, upload and artifact dirs.

Telemetry used in these tests is SIMULATED test data, not measurements from the prototype.
"""
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="landslide-tests-"))
os.environ.update(
    DATABASE_URL=f"sqlite:///{(_TMP / 'test.db').as_posix()}",
    UPLOAD_DIR=str(_TMP / "uploads"),
    ARTIFACT_DIR=str(_TMP / "artifacts"),
    ENABLE_BACKGROUND_TASKS="false",
    LOG_LEVEL="WARNING",
)
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.database import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with TestClient(app) as c:
        yield c


def reading(**overrides) -> dict:
    """A firmware-shaped payload (SIMULATED test values)."""
    base = {
        "device_id": "esp32-slope-node-01",
        "moisture_index": 42.5,
        "rain_index": 12.0,
        "tilt_change_deg": 0.8,
        "moisture_rate_per_min": 0.4,
        "tilt_rate_deg_per_min": 0.02,
        "weighted_score": 21.6,
        "esp32_risk_state": "SAFE",
        "sensor_health": "OK",
        "fault_reason": None,
        "wifi_rssi": -61,
        "uptime_sec": 120,
    }
    base.update(overrides)
    return base


def wait_for_run(client, run_id: int, timeout: float = 90.0) -> dict:
    t0 = time.time()
    while time.time() - t0 < timeout:
        r = client.get(f"/api/ml/training-runs/{run_id}").json()
        if r["status"] in ("completed", "failed"):
            return r
        time.sleep(0.3)
    raise TimeoutError("training did not finish")


def pytest_sessionfinish(session, exitstatus):  # pragma: no cover
    engine.dispose()
    shutil.rmtree(_TMP, ignore_errors=True)
