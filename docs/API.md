# API reference

Interactive documentation with request/response schemas: **http://localhost:8000/docs** (Swagger) or `/redoc`.
All timestamps are UTC ISO-8601 with `Z`. Errors return `{"detail": "..."}` with an appropriate HTTP status.

## Telemetry
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/reading` | Firmware POST target. Validates the JSON contract, adds a server timestamp, stores the raw payload, emits transition alerts. `201` on success, `422` malformed. Optional header `X-Simulated: true` (test clients only). |
| GET | `/api/latest?device_id=` | Latest reading + device status + backend score cross-check + rule-based explanation |
| GET | `/api/history` | Paginated readings. Filters: `device_id, window (1m,5m,15m,1h,6h,24h,7d,30d), start, end, risk_state, include_simulated, valid_only, experiment_id`; `page, page_size, order` |
| GET | `/api/history/series` | Time series for charts, time-bucket downsampled (`max_points`); bucket keeps the most severe state |
| GET | `/api/history/export.csv` | Streaming CSV export of filtered readings |
| GET | `/api/devices` | Devices with live online/offline status |
| GET | `/api/devices/{device_id}/health` | Health, totals, missing/invalid counts, gaps, RSSI history, recent faults |

## Analytics
| GET | `/api/analytics/summary` | Overview counters (readings, devices, model, datasets, alerts) |
|---|---|---|
| GET | `/api/analytics/sensors` | Per-sensor current/min/max/mean/std/trend/missing/invalid + telemetry gaps (same filters as history) |
| GET | `/api/analytics/risk-distribution` | ESP32 state counts and approximate dwell time |

## Datasets & historical intelligence
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/datasets/upload` | multipart: `file, category (historical|experimental), name, description, label_source, is_synthetic, confirm_new_version`. `409` on duplicate content / existing name |
| GET | `/api/datasets?category=` | List |
| GET | `/api/datasets/{id}` | Profile, schema, warnings, cleaning report, mapping |
| GET | `/api/datasets/{id}/preview?offset&limit&variant` | Rows of the original or cleaned file |
| GET | `/api/datasets/{id}/download?variant=original|cleaned` | Download CSV |
| DELETE | `/api/datasets/{id}?confirm=true` | Delete (confirmation required) |
| POST | `/api/datasets/synthetic-fixture` | SYNTHETIC pipeline-test dataset |
| POST | `/api/datasets/from-readings` | Experimental dataset from stored readings (labels = ESP32 state, disclosed) |
| GET | `/api/historical/{id}/analytics` | Filters: `year_from, year_to, country, trigger, category, size, setting, fatal_only, rain_only` |
| GET | `/api/historical/{id}/map` | Event points with valid coordinates |
| GET | `/api/historical/{id}/filter-options` | Available filter values and columns |
| PUT | `/api/historical/{id}/mapping` | Override detected column roles |

## Machine learning
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/ml/preflight` | Validate a training config; returns errors, warnings, leakage warnings needing acknowledgement, class distribution |
| POST | `/api/ml/train` | Start a background training job (`202`) |
| GET | `/api/ml/training-runs`, `/api/ml/training-runs/{id}` | Training history / one run |
| GET | `/api/ml/models`, `/api/ml/models/{id}` | Registry / model detail |
| GET | `/api/ml/models/compare?ids=1,2` | Compare versions |
| GET | `/api/ml/models/{id}/metrics` | Full evaluation metrics |
| POST | `/api/ml/models/{id}/activate` · `/deactivate` | Explicit activation (one active model) |
| DELETE | `/api/ml/models/{id}?confirm=true` | Delete an inactive model and its artifact |
| GET | `/api/ml/artifacts/{name}` | Evaluation plot PNGs |
| POST | `/api/ml/predict` | `{"features": {...}}` or `{"use_latest": true, "device_id": ...}`; refuses missing/invalid inputs |
| GET | `/api/ml/hybrid?device_id=` | ESP32 state vs Random Forest on the latest reading |

## System
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness + DB check |
| GET | `/api/alerts` | Filters: `severity, alert_type, device_id, start, end, acknowledged, include_simulated`; pagination |
| POST | `/api/alerts/{id}/acknowledge`, `/api/alerts/acknowledge-all` | Acknowledge |
| GET | `/api/events` | System event log (filters: `category, event_type, severity, device_id, start, end`) |
| GET/PUT | `/api/settings` | Backend/dashboard settings (validated). Never changes firmware |
| POST | `/api/settings/reset-thresholds` | Restore firmware-default thresholds |
| POST | `/api/experiments/start`, `/api/experiments/stop`; GET `/api/experiments` | Tag incoming readings with an experiment ID |
| GET | `/api/demo/status`; POST `/api/demo/start`, `/api/demo/stop`; DELETE `/api/demo/data?confirm=true` | Demo Mode (SIMULATED) |
| GET | `/api/system/info` | Versions, firmware constants, row counts |
