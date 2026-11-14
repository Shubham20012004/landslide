I want you to become my long-term project mentor for my B.Tech ECE final-year/major project.

Please read and understand the entire project context below before answering any future questions. Treat this as the established project direction unless I explicitly change something later.

# PROJECT TITLE

**IoT-Based Multi-Parameter Landslide Risk Monitoring and AI-Assisted Early Warning System Using ESP32**

The project is designed as a **student-level but technically strong B.Tech ECE project with societal impact**, focused on landslide risk monitoring and early warning.

The project should combine:

- Embedded systems
- Sensors
- ESP32
- IoT
- Real-time data
- Data analytics
- Historical landslide data
- AI/ML
- Risk assessment
- Web dashboard
- Environmental monitoring

---

# 1. MAIN PROBLEM

We want to build a prototype system that monitors environmental and slope-related parameters and provides an **early warning/risk indication** when multiple indicators become abnormal.

The system must NOT claim that it can:

- predict the exact time of a landslide
- guarantee that a landslide will occur
- provide scientifically validated real-world landslide probability
- replace professional geological/geotechnical warning systems

The correct terminology is:

**Landslide Risk Monitoring**

**Early-Warning Indicator**

**AI-Assisted Risk Classification**

**Prototype Risk Assessment**

---

# 2. FINAL HARDWARE DIRECTION

The current core hardware is:

### ESP32

Main controller.

### Sensors

1. **Capacitive Soil Moisture Sensor**
2. **Rain Sensor / Rainfall Indicator**
3. **MPU6050**
   - Accelerometer
   - Gyroscope
   - Used for slope tilt/deformation monitoring

### Warning hardware

- Green LED
- Yellow LED
- Red LED
- Buzzer

### Monitoring

A **laptop** will be used as the main monitoring station.

We decided NOT to use OLED in the current version.

We decided NOT to use LoRa in the first version.

The communication method will be:

**ESP32 → Wi-Fi → Laptop/Web Dashboard**

LoRa may be mentioned as a future real-world deployment option, but it is not part of the current core implementation.

GPS, solar power, LoRa, advanced cloud infrastructure, etc. should remain optional/future scope unless I explicitly decide to add them.

---

# 3. CURRENT SYSTEM ARCHITECTURE

The core architecture is:

Rain Sensor
\+
Soil Moisture
\+
MPU6050
↓
ESP32
↓
Wi-Fi
↓
Laptop
↓
Web Dashboard
↓
Risk Analysis
↓
Warning Level

The warning levels should be:

🟢 SAFE

🟡 WATCH

🟠 WARNING

🔴 CRITICAL

The system should also activate local LEDs/buzzer according to the risk state.

---

# 4. UNIQUE PART OF THE PROJECT

I do NOT want this to become a basic:

"Soil moisture > threshold → buzzer"

project.

The system should use **multi-parameter sensor fusion**.

Inputs:

- Soil moisture
- Rain/rainfall condition
- Slope tilt
- Moisture rate of change
- Tilt rate of change
- Recent rain duration if available

The system should consider both:

### Absolute values

and

### Trends/rate of change

Example:

Moisture:

40%
→ 45%
→ 52%
→ 65%
→ 78%

This rapid increase should contribute to increasing risk.

Similarly:

Tilt:

2.0°
→ 2.1°
→ 2.3°
→ 2.8°
→ 3.5°

The system should detect increasing deformation.

This trend-based approach is one of the project's unique features.

---

# 5. RISK ENGINE

The project should initially have a **rule-based risk engine**.

Example concept:

Risk Score =
weighted combination of:

- Moisture risk
- Rain risk
- Tilt/deformation risk

For example:

Risk =
0.40 × Moisture Risk
\+
0.30 × Rain Risk
\+
0.30 × Tilt Risk

These values are ONLY prototype design parameters.

Never describe them as universal geotechnical thresholds.

The system should eventually support:

### Rule-Based Mode

### Machine Learning Mode

### Hybrid Mode

The Hybrid system can combine the rule-based score and ML output.

All weights and thresholds should be configurable.

---

# 6. HISTORICAL LANDSLIDE DATASET

I uploaded a CSV called:

**Global\_Landslide\_Catalog\_Export\_rows.csv**

It contains approximately:

**11,033 historical landslide-event records**

and approximately:

**31 columns**

The dataset contains fields including:

- event\_date
- event\_title
- landslide\_category
- landslide\_trigger
- landslide\_size
- landslide\_setting
- fatality\_count
- injury\_count
- country\_name
- latitude
- longitude
- storm\_name
- event\_description
- and other historical-event metadata

This dataset is extremely important to the project.

---

# 7. VERY IMPORTANT DATASET LIMITATION

The historical landslide CSV does NOT directly contain the live sensor measurements we need for the real-time sensor ML model.

It does NOT provide fields such as:

- soil moisture sensor readings
- slope tilt measurements
- moisture rate of change
- tilt rate of change
- continuous rainfall sensor measurements

Therefore:

**DO NOT train a fake sensor prediction model using these historical records as if they contain sensor data.**

Do not make claims such as:

"Moisture = 76%, Tilt = 3.4°, therefore this historical dataset predicts a landslide."

That would be scientifically invalid.

---

# 8. HOW WE WILL USE THE HISTORICAL DATASET

Instead, the 11,033-record dataset will become the project's:

## Historical Landslide Intelligence Layer

We should analyze it for:

### Historical triggers

Examples:

- rain
- downpour
- monsoon
- tropical cyclone
- earthquake
- snowmelt
- construction
- unknown

### Geographic patterns

Using:

- latitude
- longitude
- country
- administrative division

### Temporal patterns

Using:

- event\_date
- year
- month
- season

### Severity

Using:

- landslide\_size
- fatality\_count
- injury\_count

### Historical event map

Display events geographically on the dashboard.

### Trigger distribution

Show how many historical events were associated with different triggers.

### Year/month distribution

Show temporal patterns.

---

# 9. TWO-LAYER PROJECT CONCEPT

The final project should combine:

## Layer 1 — Historical Landslide Intelligence

Using the 11,033-record dataset.

This layer answers:

- Where have landslides historically occurred?
- What triggers are common?
- Which countries/regions have many recorded events?
- How do events vary over time?
- What historical severity patterns exist?

## Layer 2 — Real-Time Embedded Monitoring

Using:

ESP32
\+
Soil moisture
\+
Rain
\+
MPU6050

This layer answers:

- What is happening RIGHT NOW?
- Is soil moisture increasing?
- Is rain occurring?
- Is slope tilt changing?
- Is the combined risk increasing?

---

# 10. FINAL CONCEPTUAL ARCHITECTURE

The project should eventually look conceptually like:

Historical Landslide Dataset
↓
Historical Analysis
↓
Historical Intelligence
↓
┐
├───────────────┐
│ │
Real-Time │
Sensors │
│ │
↓ │
ESP32 │
↓ │
Wi-Fi │
↓ │
Web Dashboard │
│ │
└───────┬───────┘
↓
Risk Assessment
↓
Rule-Based Engine
\+
ML Model
↓
Hybrid Risk Score
↓
SAFE / WATCH / WARNING / CRITICAL
↓
Alert + Dashboard

---

# 11. AI/ML PLAN

AI should be an **upgrade layer**, not the only thing the project depends on.

### Level 1 — Rule-Based System

Build this first.

It should work even without ML.

### Level 2 — ML using our own controlled experimental data

Collect data from the physical prototype.

Possible fields:

timestamp
soil\_moisture
rain\_level
rain\_duration
tilt\_angle
moisture\_rate
tilt\_rate
risk\_score
risk\_label

Possible labels:

SAFE
WATCH
WARNING
CRITICAL

The dataset generated from our own experiments must be clearly identified as experimental/prototype data.

### Level 3 — Larger real-world dataset

If suitable matched sensor/weather/geotechnical datasets become available, use them later.

Do not fabricate real-world training data.

---

# 12. RECOMMENDED ML MODEL

Start with an interpretable model such as:

- Random Forest
- Gradient Boosting
- Logistic Regression

Random Forest is currently preferred because it is:

- relatively easy to train
- suitable for tabular data
- interpretable
- useful for feature importance
- easier to defend in a B.Tech viva than a complicated neural network

Do NOT use deep learning just to make the project sound advanced.

---

# 13. AI DASHBOARD

The website should eventually include:

### AI Risk Analysis

Show:

- Model Risk Score
- Risk category
- Model status
- Training dataset size
- Features used
- Accuracy
- Precision
- Recall
- F1 score
- Confusion matrix
- Feature importance

If data is insufficient:

**Do not invent metrics.**

Instead display:

"Insufficient data for reliable model evaluation."

If synthetic/demo data is used, clearly label:

**DEMO / SYNTHETIC DATA**

Never present synthetic accuracy as real-world accuracy.

---

# 14. EXPLAINABLE AI

The dashboard should explain why risk increased.

Example:

"Risk increased because:

1. Soil moisture increased by 14% in the last 20 minutes.
2. Tilt increased by 0.9° from baseline.
3. Rain activity remained high.
4. Multiple parameters showed increasing trends."

This explanation can initially be rule-based.

Do not falsely claim that this explanation came from an advanced neural network.

---

# 15. WEB DASHBOARD

The laptop should display a professional dashboard.

Main sections:

1. Dashboard
2. Live Monitoring
3. Historical Intelligence
4. Analytics
5. AI Model
6. Alerts
7. Sensor Data
8. Device Health
9. Calibration
10. Project Information
11. Settings

---

# 16. MAIN DASHBOARD CONTENT

Show:

### Current Risk

Example:

68 / 100

WARNING

Label it appropriately as:

**Prototype Risk Score**

rather than a scientifically validated real-world probability.

### Sensor cards

Soil Moisture:

76%

Rain:

HIGH / DETECTED

Slope Tilt:

3.4°

### Risk breakdown

Show contribution from:

- moisture
- rain
- tilt

### Trend graphs

- Moisture vs Time
- Tilt vs Time
- Rain activity vs Time
- Risk Score vs Time

### Risk timeline

SAFE → WATCH → WARNING → CRITICAL

### Live sensor table

Timestamp
Moisture
Rain
Tilt
Risk
Status

---

# 17. HISTORICAL INTELLIGENCE DASHBOARD

Use the uploaded Global Landslide Catalog dataset.

Show:

### Total historical events

11,033 approximately, after verifying the actual dataset.

### Trigger distribution

Chart.

### Landslide size distribution

Chart.

### Events by year

Chart.

### Events by month

Chart.

### Countries with most recorded events

Chart/table.

### Historical map

Latitude/longitude points.

### Fatality/injury statistics

Where data is available.

### Rain-related event analysis

Especially important because our real-time system monitors rainfall/moisture.

---

# 18. IMPORTANT HISTORICAL DATA RULE

Before making claims from the CSV:

- inspect missing values
- inspect duplicates
- inspect inconsistent categories
- inspect date ranges
- inspect trigger categories
- inspect geographic coverage

Always distinguish:

**recorded events in this dataset**

from:

**all landslides that actually occurred worldwide**

The dataset is not necessarily complete global ground truth.

---

# 19. DEMO MODE

The website MUST have a Demo Mode.

This allows the project to be demonstrated without ESP32 hardware.

Scenarios:

### Normal Conditions

### Heavy Rain

### Rapid Soil Saturation

### Increasing Tilt

### Combined Risk

When a scenario is selected, the system should simulate sensor values.

Example:

Heavy Rain:

Rain ↑
Moisture ↑
Tilt gradually ↑
Risk ↑

Status transitions:

SAFE
→ WATCH
→ WARNING
→ CRITICAL

The demo should clearly indicate:

**DEMO MODE**

so simulated data is never confused with real sensor data.

---

# 20. LIVE HARDWARE MODE

The website should also support:

**Data Source**

○ Demo Simulation

○ ESP32 Live Data

ESP32 sends JSON such as:

{
"device\_id": "NODE\_01",
"timestamp": "...",
"soil\_moisture": 76.4,
"rain\_level": 2,
"tilt\_angle": 3.4
}

The web application receives it over Wi-Fi.

Prefer:

ESP32 → HTTP/WebSocket → Backend → Dashboard

or another simple local architecture.

---

# 21. LAPTOP-FIRST SYSTEM

The project should work locally.

Preferred stack:

Frontend:

- React
- TypeScript
- Tailwind CSS
- Recharts or similar

Backend:

- FastAPI OR Node.js/Express

Database:

- SQLite

Real-time:

- WebSocket where appropriate

The system should not depend on expensive cloud services.

---

# 22. PHYSICAL LANDSLIDE MODEL

The project will include a miniature physical slope.

Possible materials:

- soil
- sand
- small stones
- cardboard/wood
- miniature road
- trees
- small houses
- water

Sensor placement:

Soil moisture → inside soil

MPU6050 → firmly attached to slope

Rain sensor → exposed to simulated rain

The physical model is for demonstration and experimentation.

It should NOT be presented as a scientifically scaled simulation of a real mountain.

---

# 23. PROJECT DEVELOPMENT ORDER

We should build in this order:

### Phase 1

ESP32 setup

### Phase 2

Soil moisture sensor

### Phase 3

MPU6050

### Phase 4

Rain sensor

### Phase 5

Combine sensors

### Phase 6

Calibration

### Phase 7

Trend analysis

### Phase 8

Rule-based risk engine

### Phase 9

LED/buzzer warning

### Phase 10

ESP32 Wi-Fi

### Phase 11

Laptop dashboard

### Phase 12

Historical dataset integration

### Phase 13

Data logging

### Phase 14

Experimental data collection

### Phase 15

ML model

### Phase 16

Hybrid AI + rule-based system

### Phase 17

Physical landslide model

### Phase 18

Testing and validation

---

# 24. WHAT I WANT FROM YOU AS MY PROJECT MENTOR

Do not simply agree with every idea.

If I suggest something technically weak, tell me.

If something is scientifically inaccurate, correct me.

If something is unnecessarily complicated for B.Tech level, tell me.

If there is a better architecture, recommend it.

Always distinguish:

- what is technically possible
- what is realistically achievable
- what is scientifically valid
- what is good for a B.Tech project
- what is only future scope

Help me make the project impressive WITHOUT making it unnecessarily complicated.

---

# 25. IMPORTANT PROJECT PHILOSOPHY

The project should prioritize:

**Reliability > unnecessary complexity**

**Real data > fabricated data**

**Explainability > black-box AI**

**Working prototype > too many features**

**Scientific honesty > impressive claims**

**Societal usefulness > gimmicks**

---

# 26. CURRENT PROJECT STATUS

At this point:

- Parkinson's project was rejected by faculty.
- We selected landslide early-warning/risk monitoring as the new direction.
- LoRa was considered but removed from the current implementation.
- OLED was considered but removed.
- Wi-Fi is the current communication method.
- Laptop is the main visualization/monitoring station.
- We have the Global Landslide Catalog CSV with approximately 11,033 records.
- We want to use that historical dataset for historical landslide intelligence, NOT falsely as sensor-training data.
- We want to add AI/ML after establishing the rule-based system and collecting suitable experimental sensor data.

---

# 27. WHEN I ASK FUTURE QUESTIONS

Use this project context automatically.

For example, if I ask:

"How should I make the dashboard?"

Assume I mean the landslide project's dashboard.

If I ask:

"Can we use AI?"

Assume I mean AI for this landslide risk-monitoring system.

If I ask:

"What sensor should we add?"

Evaluate it against this project's architecture.

If I ask:

"Is this data useful?"

Evaluate it in the context of the historical landslide intelligence + real-time sensor architecture.

If I ask for code:

Make sure it is compatible with the architecture already established.

If I ask for project documentation:

Keep the scientific limitations and prototype terminology consistent.

---

# 28. FIRST THING I WANT YOU TO DO

After reading this context, do NOT immediately start building everything.

First respond with:

1. Your understanding of the project
2. Final architecture you recommend
3. What makes the project unique
4. How the historical dataset will be used
5. How AI/ML will be integrated without making false claims
6. Recommended development phases
7. Any major technical risks you see

Then wait for my next instruction.