# IoT-Based Multi-Parameter Landslide Risk Monitoring and AI-Assisted Early Warning System Using ESP32

*An Embedded IoT and AI-Assisted Prototype for Multi-Parameter Slope Risk Monitoring.*

B.Tech ECE major project, Department of Electronics and Communication Engineering, Assam University.

This repository contains the complete monitoring and intelligence platform:

* **ESP32 firmware**: soil moisture, rain activity and MPU6050 tilt; local rule-based risk; LEDs and buzzer.
* **FastAPI backend**: telemetry ingestion, SQLite storage, analytics, alerts, dataset management, Random Forest training and prediction.
* **React dashboard**: twelve pages covering live monitoring, analytics, historical intelligence, ML and operations.

> **Scientific limitations.** This is an experimental **miniature-slope prototype**, not a scaled geotechnical
> replica and not a validated landslide predictor.
> * The *Soil Moisture Index* and *Rain Activity Index* are normalised sensor indices.
> * *Slope Tilt Change* is the MPU6050 inclination change from a baseline.
> * The *Prototype Weighted Risk Score* is **not a landslide probability**.
> * SAFE / WATCH / WARNING / CRITICAL are **prototype categories**, not official warning levels.
> * Random Forest class scores are model confidence, not real-world probabilities.

---

## 1. Architecture

```
 Capacitive soil sensor (GPIO34) ─┐
 Rain module (GPIO35) ────────────┼─► ESP32 DevKit V1 ──► LEDs GPIO16-19 + buzzer GPIO23 (works offline)
 MPU6050 (I²C SDA21/SCL22) ───────┘     │  2 s sampling, EMA + complementary filter,
                                        │  0.40·moisture + 0.30·rain + 0.30·tilt score,
                                        │  rate-of-change overrides with persistence/hysteresis
                                        ▼  HTTP POST JSON every ~4 s
                              FastAPI  /api/reading  ──► SQLite (readings, devices, alerts, events,
                                        │                        datasets, training runs, models, settings)
                                        ▼
                              React dashboard (Vite, Tailwind, Recharts, Leaflet)

 Historical catalogue CSV ──► Historical Intelligence (event-level analysis, kept separate)
 Experimental sensor CSV  ──► Random Forest training ──► model registry ──► AI Predictions (beside the ESP32 state)
```

The **ESP32's rule-based state is authoritative** for the local system. The backend stores it unchanged.
The ML prediction is shown **next to it** and never replaces it.

## 2. Project structure

```
projectlandslide/
├── backend/                      FastAPI application
│   ├── app/
│   │   ├── api/                  REST routers (telemetry, analytics, datasets/historical, ml, system)
│   │   ├── database/             engine, sessions
│   │   ├── models/               SQLAlchemy tables
│   │   ├── schemas/              Pydantic request schemas (telemetry contract, ML config)
│   │   ├── services/             ingestion, alerts, analytics, datasets, historical, risk engine port,
│   │   │                         Demo Mode simulator, device monitor, settings
│   │   ├── ml/                   training pipeline + model registry / prediction
│   │   └── main.py
│   ├── scripts/                  simulate_esp32.py (HTTP test client), import_dataset.py
│   ├── tests/                    pytest suite (44 tests)
│   ├── uploads/  artifacts/  data/   runtime storage (git-ignored)
│   ├── requirements.txt  requirements-dev.txt  .env.example
├── frontend/                     React + TypeScript + Vite + Tailwind
│   └── src/ components/ pages/ charts/ services/ hooks/ types/ utils/
├── firmware/esp32_landslide_monitor/
│   ├── esp32_landslide_monitor.ino   supplied firmware (credentials moved to secrets.h)
│   └── secrets.example.h
├── data/historical/              Global_Landslide_Catalog_Export_rows.csv (supplied)
├── data/experimental/            header-only template (no real labelled dataset exists yet)
├── docs/                         API reference, project sources (reports, presentation, notes)
├── start_backend.bat  start_frontend.bat
└── README.md  .gitignore  .env.example
```

## 3. Installation

Prerequisites: **Python 3.10+**, **Node.js 18+** (tested with Python 3.10.9 and Node 23), Arduino IDE with the ESP32 core.

```bash
cd backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements-dev.txt
```

```bash
cd frontend
npm install
```

Optional: copy `backend/.env.example` to `backend/.env` to change limits, CORS origins or paths.

## 4. Running

**Backend** (bind to all interfaces so the ESP32 can reach it):

```bash
cd backend
.venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

* API docs (Swagger): <http://localhost:8000/docs>
* Health: <http://localhost:8000/api/health>

**Frontend:**

```bash
cd frontend
npm run dev
```

Open <http://localhost:5173>. The Vite dev server proxies `/api` to port 8000.

On Windows you can double-click `start_backend.bat` and `start_frontend.bat` instead.

**Load the historical catalogue** (once). Either upload it on *Dataset Management* (category A · Historical), or run this from `backend/`:

```bash
.venv\Scripts\python scripts/import_dataset.py ../data/historical/Global_Landslide_Catalog_Export_rows.csv --category historical --name "NASA Global Landslide Catalog"
```

## 5. Connecting the ESP32

1. Find the laptop's LAN IPv4 address: `ipconfig` → "IPv4 Address" (e.g. `192.168.1.20`). The ESP32 and laptop must be on the same Wi-Fi. `localhost` does not work from the ESP32.
2. In `firmware/esp32_landslide_monitor/`, copy `secrets.example.h` to `secrets.h` and set:
   * `SECRET_WIFI_SSID`
   * `SECRET_WIFI_PASSWORD`
   * `SECRET_BACKEND_ENDPOINT` = `"http://192.168.1.20:8000/api/reading"`

   `secrets.h` is git-ignored.
3. Allow inbound TCP 8000 in Windows Defender Firewall (private network). One way, from an administrator terminal:
   ```bash
   netsh advfirewall firewall add rule name="Landslide backend 8000" dir=in action=allow protocol=TCP localport=8000 profile=private
   ```
4. In Arduino IDE, select board **ESP32 Dev Module** and upload. Then open Serial Monitor at **115200 baud**. You should see `[NET] POST /api/reading -> HTTP 201`.
5. The device appears on **Device Health** and **Live Monitoring** within ~4 s.

The only firmware change from the supplied sketch is moving the three network constants into `secrets.h`. Sensing, filtering, risk logic and the JSON payload are unchanged.

**Telemetry contract** (from `sendTelemetryIfConnected()`):

```json
{"device_id":"esp32-slope-node-01","moisture_index":42.5,"rain_index":12.0,"tilt_change_deg":0.8,
 "moisture_rate_per_min":0.4,"tilt_rate_deg_per_min":0.02,"weighted_score":21.6,
 "esp32_risk_state":"SAFE","sensor_health":"OK","fault_reason":null,"wifi_rssi":-61,"uptime_sec":120}
```

Notes on the contract:
* Unhealthy channels arrive as `null`.
* `esp32_risk_state` may also be `DATA_INCOMPLETE` or `SENSOR_FAULT` when health is degraded.
* The server adds a receive timestamp and stores the original payload unchanged.
* Values outside expected ranges are **stored and flagged invalid**, not silently dropped.

**Online/offline.** A device is online only if a packet arrived within the *device offline timeout* (default 20 s). Gaps longer than 2.5 × the 4 s interval raise a *missing telemetry* alert, and uptime resets are logged as reboots.

### Calibrating sensors

Calibration lives in the firmware, not the dashboard. Over serial:
* Type `r` to print raw ADC values. Record soil ADC in dry and saturated soil, and the rain plate dry and wet. Edit `SOIL_ADC_DRY/WET` and `RAIN_ADC_DRY/WET`, then re-flash.
* Type `c` with the slope still to re-zero the tilt baseline.

The **Calibration & Settings** page changes **backend** parameters only: refresh rate, offline timeout, retention, display options and analysis thresholds. Those thresholds drive chart lines, explanations, the score cross-check and Demo Mode. **They do not reconfigure the ESP32**, because this project has no device-configuration protocol.

## 6. Demo Mode (no hardware)

On **Live Monitoring → Demo Mode**, choose a scenario and press *Start scenario*. The scenarios are Normal, Heavy Rain, Rapid Soil Saturation, Increasing Tilt, Combined Risk, Sensor Fault and Drying / Recovery.

* Simulated packets come from a Python port of the firmware logic (EMA, rates, persistence/hysteresis overrides, fault handling). They go through the same ingestion path as real telemetry.
* Every simulated reading, device and alert is flagged **SIMULATED**, and a banner is shown while it runs.
* *Delete simulated data* removes them all.

To exercise the real HTTP endpoint the way the ESP32 does (packets carry `X-Simulated: true`, so they are flagged too):

```bash
cd backend
.venv\Scripts\python scripts/simulate_esp32.py --scenario heavy_rain --count 60 --interval 4
```

## 7. Datasets

| Category | Example | Used for |
|---|---|---|
| **A · Historical** | NASA Global Landslide Catalog | Historical Intelligence (event-level) |
| **B · Experimental** | your bench-run sensor CSV | Random Forest training/evaluation |

**Uploading.** On *Dataset Management*, choose the category and file, then state how the labels were assigned (`manual_observation`, `esp32_rule_engine`, `synthetic_rule_engine` or `unknown`). Each upload is validated:
* Format: `.csv` extension, size limit, binary rejection and encoding detection (UTF-8, cp1252 or latin-1).
* Content: parse errors, empty files and row limit.
* Schema: category-specific checks on the columns.

**What you get for each dataset:**
* A profile: rows, columns, types, missing values, duplicates and warnings.
* A cleaned copy. Original columns are preserved and derived columns are prefixed `clean_`.
* A SHA-256 hash.

**Conflicts and deletion:**
* An identical file is refused.
* Re-using a name requires confirmation and creates **v2**. The old version is kept.
* Deletion requires confirmation.

**Expected experimental schema** (`data/experimental/experimental_sensor_dataset_template.csv`):

```
experiment_id,timestamp,moisture_index,rain_index,tilt_change_deg,moisture_rate_per_min,tilt_rate_deg_per_min,risk_label
```

**Recording your own experimental data:**
1. On *Live Monitoring → Experiment session*, start a session (e.g. `RUN-03-heavy-rain`). Incoming readings are tagged with that ID.
2. Run the physical experiment, then stop the session.
3. On *Dataset Management → Build from recorded readings*, export the tagged readings. Here `risk_label` = the ESP32 state, and the dataset is **disclosed as rule-engine labels**: a model trained on it learns to imitate the firmware rules. For independent labels, annotate observed slope behaviour yourself and upload with `manual_observation`.

**Synthetic fixture.** *Generate SYNTHETIC test fixture* creates 1,050 clearly labelled synthetic rows (14 runs) for **pipeline testing only**.

## 8. Historical intelligence

Select the historical dataset on *Historical Intelligence*.

**How columns are found.** Column roles (date, trigger, category, size, country, lat/lon, fatalities and so on) are detected from the actual header. You can override them under *Column roles*. Analyses for missing roles are shown as unavailable, never invented.

**What it shows:**
* KPIs and a Leaflet/OpenStreetMap event map.
* Events per year (continuous axis) and per calendar month.
* Trigger, type, size and setting distributions.
* Top countries, fatalities per year, and the deadliest events.
* Rain-related events, using a documented keyword grouping.
* Data quality.
* A downloadable cleaned CSV.

**Filters:** year range, country, trigger, category, size, setting, fatal-only and rain-only.

Using the supplied catalogue, the backend computes:
* 11,033 events from 1988-11-07 to 2017-09-28 across 141 countries, with 0 duplicate rows.
* 31,061 recorded fatalities, with fatality values missing for 1,385 events.
* 79.8% of events with a known trigger are rain-related.

These describe **reported events**, not all landslides, and they do not validate the prototype.

## 9. Random Forest training

On *AI Model Training*:

1. **Choose the data.** Pick an experimental dataset, the feature columns (the five firmware features are preselected when present) and the target column.
2. **Choose a split strategy:**
   * **Group-aware** (default, recommended) — whole experiments go to train *or* test.
   * **Chronological** — the latest fraction is held out.
   * **Stratified random / random** — the UI and API **require an explicit acknowledgement** when experiment IDs or timestamps exist, because correlated neighbouring readings inflate scores.
3. **Set hyperparameters:** estimators, max depth, min samples split/leaf, class weighting, seed and test size.
4. **Review pre-training validation.** It checks:
   * columns and numeric features
   * labels and class distribution/imbalance
   * missing values
   * group count
   * target leakage (e.g. `weighted_score` as a feature)
   * label provenance and synthetic data
5. **Start training.** It runs in a background thread pool, so the API stays responsive.

**Pipeline:**
* `SimpleImputer(median) → RandomForestClassifier`. The imputer is fitted on the training split only.
* Artifacts are saved with joblib together with their SHA-256 hash.
* New models are **never activated automatically**.

## 10. Model evaluation and activation

On *Model Evaluation*, each model shows:
* accuracy, balanced accuracy
* macro and weighted precision, recall and F1
* a **majority-class baseline**
* per-class precision/recall/F1 and the confusion matrix (PNG export too)
* MDI and permutation feature importance
* the classification report
* full provenance: dataset hash, features, hyperparameters, split details, train/test groups and timings

Use **macro-F1 and per-class recall** when classes are imbalanced. You can compare versions side by side, and activate, deactivate or delete models (with confirmation). Model files are never accepted as uploads; only artifacts written by this app are loaded, after their hash is verified.

## 11. AI predictions

*AI Predictions* requires an explicitly activated model.

* **Hybrid comparison** (latest reading):
  1. the ESP32 rule state
  2. the Random Forest class and class scores
  3. agree / disagree
  4. the model version

  Prediction is refused when any required input is null (sensor fault). Agreement is not assessed for degraded readings.
* **Manual prediction**: enter values (or *Fill from latest reading*) and predict. Missing or non-numeric inputs are refused.

## 12. Testing

```bash
cd backend
.venv\Scripts\python -m pytest -q
```

The 44 tests cover:
* Telemetry ingestion: null channels, malformed and invalid payloads, and preserving the ESP32 state.
* Persistence and alert de-duplication.
* Offline detection and reconnection, plus gap and reboot detection.
* History pagination, downsampling and CSV export.
* Dataset validation: type, empty, binary, size, encoding, duplicates, versioning and delete confirmation.
* Historical analytics and column mapping.
* The firmware logic port.
* ML: the leakage guard, group/chronological splits, metrics, no auto-activation, prediction refusal, the hybrid view and the tampered-artifact refusal.
* Settings validation, experiment tagging and Demo Mode.

All telemetry in the tests is **simulated test data**.

Frontend type-check and production build:

```bash
cd frontend
npm run build
```

## 13. Troubleshooting

| Symptom | Fix |
|---|---|
| Red "Backend unreachable" banner | Start the backend on port 8000; check `http://localhost:8000/api/health`. |
| ESP32 serial shows `POST failed` / `connection refused` | Use the laptop's **LAN IP** (not localhost) in `secrets.h`; same Wi-Fi network; open firewall port 8000; backend started with `--host 0.0.0.0`. |
| Device shows offline although ESP32 runs | Telemetry stopped for longer than the offline timeout (Settings). Check Wi-Fi RSSI (below −80 dBm is weak) and the serial log. |
| `DATA_INCOMPLETE` / `SENSOR_FAULT` | Firmware reported an unhealthy channel (`fault_reason`): check ADC wiring (GPIO34/35) or MPU6050 I²C (SDA 21, SCL 22, address 0x68). |
| Backend score "differs" from ESP32 score | Backend thresholds (Settings) differ from the constants flashed on the device. Reset to firmware defaults or update the sketch. |
| Upload rejected | Must be a `.csv` under `MAX_UPLOAD_MB`; identical files and existing names need confirmation (new version). |
| Training button disabled | Read *Pre-training validation*: fix errors, or acknowledge the random-split leakage warning. |
| Predictions unavailable | Activate a model in *Model Evaluation*; live prediction needs all model features non-null in the latest reading. |
| Map tiles missing | OpenStreetMap tiles need internet access; points still render. |

## 14. Status of deliverables

**Implemented and tested:**
* Backend, frontend, SQLite persistence.
* Telemetry ingestion, offline detection and alerts.
* Analytics, historical intelligence on the real catalogue, and dataset management.
* Random Forest training, evaluation and registry.
* Prediction, hybrid comparison, settings and Demo Mode.

**Blocked by unavailable inputs (not a code limitation):**
* **No physical ESP32 was connected** during development. Ingestion was verified with simulated payloads matching the firmware JSON, sent over HTTP.
* **No real labelled experimental dataset exists.** Training and evaluation were verified only with the clearly labelled synthetic fixture. Its metrics are **not project findings**. Real model results must come from bench experiments.
#   l a n d s l i d e  
 #   l a n d s l i d e  
 