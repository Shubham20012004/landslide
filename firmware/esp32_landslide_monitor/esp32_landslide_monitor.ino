/**
 * IoT-Based Multi-Parameter Landslide Risk Monitoring System (ESP32 Firmware)
 * ----------------------------------------------------------------------------
 * EXPERIMENTAL PROTOTYPE FOR MINIATURE SLOPE MODELS ONLY.
 * Thresholds and risk weights are illustrative engineering defaults and MUST be
 * calibrated on your physical test bench before experimental runs.
 *
 * Board: ESP32 DevKit V1 (ESP-WROOM-32)
 * Framework: Arduino Core for ESP32 (no external third-party libraries required)
 */

#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <math.h>

// ============================================================================
// 1. NETWORK & BACKEND CONFIGURATION
// ============================================================================
// Credentials and the backend URL live in secrets.h (git-ignored), so they are never
// committed. Copy secrets.example.h to secrets.h and fill in your own values.
#include "secrets.h"
const char* WIFI_SSID         = FI-WI;
const char* WIFI_PASSWORD     = satyam@__DEFINE_CPP_OVERLOAD_SECURE_FUNC_1_2;
const char* BACKEND_ENDPOINT  = SECRET_BACKEND_ENDPOINT;  // http://<LAN-IP>:8000/api/reading
const char* DEVICE_ID         = "esp32-slope-node-01";

// ============================================================================
// 2. CONFIGURABLE PIN ASSIGNMENTS (ESP32 DevKit V1 / ESP-WROOM-32)
// ============================================================================
constexpr uint8_t PIN_SOIL_ADC      = 34; // ADC1_CH6 (input-only, Wi-Fi safe)
constexpr uint8_t PIN_RAIN_ADC      = 35; // ADC1_CH7 (input-only, Wi-Fi safe)
constexpr uint8_t PIN_I2C_SDA       = 21; // MPU6050 SDA
constexpr uint8_t PIN_I2C_SCL       = 22; // MPU6050 SCL

constexpr uint8_t PIN_LED_SAFE      = 16;
constexpr uint8_t PIN_LED_WATCH     = 17;
constexpr uint8_t PIN_LED_WARNING   = 18;
constexpr uint8_t PIN_LED_CRITICAL  = 19;
constexpr uint8_t PIN_BUZZER        = 23; // Drives NPN transistor base

// ============================================================================
// 3. TIMING & FILTERING PARAMETERS (Non-Blocking)
// ============================================================================
constexpr unsigned long SAMPLE_INTERVAL_MS     = 2000;  // Sensor read & eval period
constexpr unsigned long TELEMETRY_INTERVAL_MS  = 4000;  // HTTP POST period
constexpr unsigned long WIFI_RETRY_INTERVAL_MS = 15000; // Reconnect backoff
constexpr uint8_t       ADC_OVERSAMPLES        = 16;    // Noise reduction samples
constexpr float         EMA_VALUE_ALPHA        = 0.35f; // Smoothing for moisture/tilt
constexpr float         EMA_RATE_ALPHA         = 0.40f; // Smoothing for derivatives
constexpr float         COMPLEMENTARY_ALPHA    = 0.96f; // Gyro vs Accel tilt blend

// ============================================================================
// 4. EXPERIMENTAL CALIBRATION CONSTANTS (Calibrate on Physical Slope!)
// ============================================================================
// Capacitive sensors output higher voltage/ADC when DRY and lower when WET.
int SOIL_ADC_DRY = 3100; // Measured in dry soil
int SOIL_ADC_WET = 1300; // Measured in saturated soil

int RAIN_ADC_DRY = 3600; // Measured with completely dry rain plate
int RAIN_ADC_WET = 1200; // Measured with wet rain plate

// Hardware fault detection boundaries (open circuit / dead short detection)
constexpr int ADC_FAULT_MIN = 15;
constexpr int ADC_FAULT_MAX = 4085;

// Illustrative risk sub-score thresholds (SAFE_MAX, WATCH_MAX, WARNING_MAX, CRITICAL_MAX)
constexpr float MOISTURE_THRESH[4] = {35.0f, 60.0f, 80.0f, 100.0f}; // %
constexpr float RAIN_THRESH[4]     = {25.0f, 55.0f, 80.0f, 100.0f}; // %
constexpr float TILT_THRESH[4]     = {2.0f,  5.0f,  10.0f, 20.0f};  // degrees

// Weighted score coefficients (must sum to 1.0)
constexpr float WEIGHT_MOISTURE = 0.40f;
constexpr float WEIGHT_RAIN     = 0.30f;
constexpr float WEIGHT_TILT     = 0.30f;

// Rate-of-change alert override thresholds (illustrative experimental values)
constexpr float MOISTURE_RATE_WATCH    = 3.0f;  // % pts / min
constexpr float MOISTURE_RATE_WARNING  = 6.0f;  // % pts / min
constexpr float MOISTURE_RATE_CRITICAL = 12.0f; // % pts / min
constexpr float MOISTURE_RATE_HYST     = 0.8f;  // Hysteresis band (% pts / min)

constexpr float TILT_RATE_WATCH        = 0.5f;  // deg / min
constexpr float TILT_RATE_WARNING      = 1.5f;  // deg / min
constexpr float TILT_RATE_CRITICAL     = 3.5f;  // deg / min
constexpr float TILT_RATE_HYST         = 0.15f; // Hysteresis band (deg / min)

constexpr uint8_t RATE_TRIGGER_PERSIST = 3;     // Consecutive samples to latch
constexpr uint8_t RATE_CLEAR_PERSIST   = 2;     // Consecutive samples to clear

// MPU6050 Register Map
constexpr uint8_t MPU6050_ADDR         = 0x68;
constexpr uint8_t MPU_REG_PWR_MGMT_1   = 0x6B;
constexpr uint8_t MPU_REG_ACCEL_CONFIG = 0x1C;
constexpr uint8_t MPU_REG_GYRO_CONFIG  = 0x1B;
constexpr uint8_t MPU_REG_ACCEL_XOUT_H = 0x3B;
constexpr uint8_t MPU_REG_WHO_AM_I     = 0x75;

// ============================================================================
// 5. STATE DEFINITIONS
// ============================================================================
enum RiskLevel : uint8_t {
  RISK_SAFE     = 0,
  RISK_WATCH    = 1,
  RISK_WARNING  = 2,
  RISK_CRITICAL = 3
};

struct SystemState {
  // Raw & calibrated metrics
  int   rawSoilAdc          = 0;
  int   rawRainAdc          = 0;
  float moistureIndex       = 0.0f;
  float rainIndex           = 0.0f;
  float pitchDeg            = 0.0f;
  float rollDeg             = 0.0f;
  float baselinePitchDeg    = 0.0f;
  float baselineRollDeg     = 0.0f;
  float tiltChangeDeg       = 0.0f;

  // Filtered values & rates
  bool  filterInitialized   = false;
  float filtMoisture        = 0.0f;
  float filtTilt            = 0.0f;
  float moistureRatePerMin  = 0.0f;
  float tiltRateDegPerMin   = 0.0f;

  // Risk scoring
  float     weightedScore       = 0.0f;
  RiskLevel scoreRisk           = RISK_SAFE;
  RiskLevel latchedRateRisk     = RISK_SAFE;
  RiskLevel finalRisk           = RISK_SAFE;

  // Rate persistence counters
  uint8_t aboveCount[4] = {0, 0, 0, 0};
  uint8_t belowCount[4] = {0, 0, 0, 0};

  // Sensor health
  bool   soilHealthy     = false;
  bool   rainHealthy     = false;
  bool   mpuHealthy      = false;
  String sensorHealth    = "DATA_INCOMPLETE";
  String faultReason     = "Initializing sensors";
};

SystemState state;

unsigned long lastSampleMs    = 0;
unsigned long lastTelemetryMs = 0;
unsigned long lastWifiCheckMs = 0;
unsigned long lastMpuMicros   = 0;

// ============================================================================
// 6. HELPER FUNCTIONS
// ============================================================================
const char* riskToString(RiskLevel level) {
  switch (level) {
    case RISK_SAFE:     return "SAFE";
    case RISK_WATCH:    return "WATCH";
    case RISK_WARNING:  return "WARNING";
    case RISK_CRITICAL: return "CRITICAL";
    default:            return "WATCH";
  }
}

float clampFloat(float val, float minVal, float maxVal) {
  if (val < minVal) return minVal;
  if (val > maxVal) return maxVal;
  return val;
}

// Piecewise linear mapping from sensor value to 0..100 sub-risk score
float computeSubRisk(float value, const float thresh[4]) {
  if (value <= 0.0f) return 0.0f;
  if (value <= thresh[0]) {
    return 25.0f * (value / thresh[0]);
  }
  if (value <= thresh[1]) {
    return 25.0f + 25.0f * ((value - thresh[0]) / (thresh[1] - thresh[0]));
  }
  if (value <= thresh[2]) {
    return 50.0f + 25.0f * ((value - thresh[1]) / (thresh[2] - thresh[1]));
  }
  if (value <= thresh[3]) {
    return 75.0f + 25.0f * ((value - thresh[2]) / (thresh[3] - thresh[2]));
  }
  return 100.0f;
}

// Trimmed oversampling ADC read to reject spikes
int readAdcFiltered(uint8_t pin) {
  long sum = 0;
  int minVal = 4096;
  int maxVal = -1;

  for (uint8_t i = 0; i < ADC_OVERSAMPLES; i++) {
    int sample = analogRead(pin);
    sum += sample;
    if (sample < minVal) minVal = sample;
    if (sample > maxVal) maxVal = sample;
    delayMicroseconds(250);
  }
  return (int)((sum - minVal - maxVal) / (ADC_OVERSAMPLES - 2));
}

float adcToPercentInverted(int adc, int dryAdc, int wetAdc) {
  if (dryAdc == wetAdc) return 0.0f;
  float pct = 100.0f * (float)(dryAdc - adc) / (float)(dryAdc - wetAdc);
  return clampFloat(pct, 0.0f, 100.0f);
}

// ============================================================================
// 7. MPU6050 I2C DRIVER & BASELINE CALIBRATION
// ============================================================================
bool initMpu6050() {
  Wire.beginTransmission(MPU6050_ADDR);
  Wire.write(MPU_REG_WHO_AM_I);
  if (Wire.endTransmission(false) != 0) return false;

  if (Wire.requestFrom(MPU6050_ADDR, (uint8_t)1) != 1) return false;
  uint8_t whoAmI = Wire.read();
  if (whoAmI != 0x68 && whoAmI != 0x72) {
    Serial.printf("[MPU6050] Unexpected WHO_AM_I: 0x%02X\n", whoAmI);
    return false;
  }

  // Wake up MPU6050 (clear sleep bit)
  Wire.beginTransmission(MPU6050_ADDR);
  Wire.write(MPU_REG_PWR_MGMT_1);
  Wire.write(0x00);
  if (Wire.endTransmission() != 0) return false;

  // Set Accel range to +/- 2g (0x00) and Gyro range to +/- 250 deg/s (0x00)
  Wire.beginTransmission(MPU6050_ADDR);
  Wire.write(MPU_REG_ACCEL_CONFIG);
  Wire.write(0x00);
  Wire.endTransmission();

  Wire.beginTransmission(MPU6050_ADDR);
  Wire.write(MPU_REG_GYRO_CONFIG);
  Wire.write(0x00);
  Wire.endTransmission();

  delay(50);
  return true;
}

bool readMpu6050Raw(float &ax, float &ay, float &az, float &gx, float &gy, float &gz) {
  Wire.beginTransmission(MPU6050_ADDR);
  Wire.write(MPU_REG_ACCEL_XOUT_H);
  if (Wire.endTransmission(false) != 0) return false;

  if (Wire.requestFrom(MPU6050_ADDR, (uint8_t)14) != 14) return false;

  int16_t rawAx = (Wire.read() << 8) | Wire.read();
  int16_t rawAy = (Wire.read() << 8) | Wire.read();
  int16_t rawAz = (Wire.read() << 8) | Wire.read();
  int16_t rawTp = (Wire.read() << 8) | Wire.read();
  int16_t rawGx = (Wire.read() << 8) | Wire.read();
  int16_t rawGy = (Wire.read() << 8) | Wire.read();
  int16_t rawGz = (Wire.read() << 8) | Wire.read();
  (void)rawTp;

  // Reject stuck-zero I2C bus failure
  if (rawAx == 0 && rawAy == 0 && rawAz == 0) return false;

  // Convert to g (+/-2g -> 16384 LSB/g) and deg/s (+/-250dps -> 131 LSB/dps)
  ax = rawAx / 16384.0f;
  ay = rawAy / 16384.0f;
  az = rawAz / 16384.0f;
  gx = rawGx / 131.0f;
  gy = rawGy / 131.0f;
  gz = rawGz / 131.0f;

  // Check physical plausibility of gravity vector (~1g when stationary)
  float accelMag = sqrtf(ax * ax + ay * ay + az * az);
  if (isnan(accelMag) || accelMag < 0.3f || accelMag > 3.5f) {
    return false;
  }
  return true;
}

void calibrateTiltBaseline() {
  Serial.println("[CAL] Keep miniature slope stationary for MPU6050 baseline calibration...");
  const int samples = 40;
  float sumPitch = 0.0f;
  float sumRoll  = 0.0f;
  int validCount = 0;

  for (int i = 0; i < samples; i++) {
    float ax, ay, az, gx, gy, gz;
    if (readMpu6050Raw(ax, ay, az, gx, gy, gz)) {
      float accPitch = atan2f(ay, sqrtf(ax * ax + az * az)) * RAD_TO_DEG;
      float accRoll  = atan2f(-ax, az) * RAD_TO_DEG;
      sumPitch += accPitch;
      sumRoll  += accRoll;
      validCount++;
    }
    delay(20);
  }

  if (validCount >= 20) {
    state.baselinePitchDeg = sumPitch / validCount;
    state.baselineRollDeg  = sumRoll / validCount;
    state.pitchDeg         = state.baselinePitchDeg;
    state.rollDeg          = state.baselineRollDeg;
    state.mpuHealthy       = true;
    Serial.printf("[CAL] Baseline locked -> Pitch: %.2f deg, Roll: %.2f deg\n",
                  state.baselinePitchDeg, state.baselineRollDeg);
  } else {
    state.mpuHealthy = false;
    Serial.println("[CAL] WARNING: MPU6050 baseline calibration failed (check I2C wiring).");
  }
  lastMpuMicros = micros();
}

// ============================================================================
// 8. RISK ENGINE (Weighted Score + Filtered Rate Overrides with Hysteresis)
// ============================================================================
void updateRateOverrides(float mRate, float tRate) {
  // Determine instantaneous threshold exceedance for each alert tier
  bool exceed[4] = {false, false, false, false};
  bool clear[4]  = {true,  true,  true,  true};

  exceed[RISK_WATCH]    = (mRate >= MOISTURE_RATE_WATCH)    || (tRate >= TILT_RATE_WATCH);
  exceed[RISK_WARNING]  = (mRate >= MOISTURE_RATE_WARNING)  || (tRate >= TILT_RATE_WARNING);
  exceed[RISK_CRITICAL] = (mRate >= MOISTURE_RATE_CRITICAL) || (tRate >= TILT_RATE_CRITICAL);

  clear[RISK_WATCH]    = (mRate < (MOISTURE_RATE_WATCH    - MOISTURE_RATE_HYST)) &&
                         (tRate < (TILT_RATE_WATCH        - TILT_RATE_HYST));
  clear[RISK_WARNING]  = (mRate < (MOISTURE_RATE_WARNING  - MOISTURE_RATE_HYST)) &&
                         (tRate < (TILT_RATE_WARNING      - TILT_RATE_HYST));
  clear[RISK_CRITICAL] = (mRate < (MOISTURE_RATE_CRITICAL - MOISTURE_RATE_HYST)) &&
                         (tRate < (TILT_RATE_CRITICAL     - TILT_RATE_HYST));

  for (uint8_t lvl = RISK_WATCH; lvl <= RISK_CRITICAL; lvl++) {
    if (exceed[lvl]) {
      state.aboveCount[lvl]++;
      state.belowCount[lvl] = 0;
      if (state.aboveCount[lvl] >= RATE_TRIGGER_PERSIST && state.latchedRateRisk < lvl) {
        state.latchedRateRisk = (RiskLevel)lvl;
      }
    } else if (clear[lvl]) {
      state.belowCount[lvl]++;
      state.aboveCount[lvl] = 0;
      if (state.belowCount[lvl] >= RATE_CLEAR_PERSIST && state.latchedRateRisk == lvl) {
        // Step down one level at a time
        state.latchedRateRisk = (RiskLevel)(lvl - 1);
      }
    }
  }
}

void evaluateSensorsAndRisk(unsigned long elapsedMs) {
  // 1. Read and validate analog sensors
  state.rawSoilAdc = readAdcFiltered(PIN_SOIL_ADC);
  state.rawRainAdc = readAdcFiltered(PIN_RAIN_ADC);

  state.soilHealthy = (state.rawSoilAdc > ADC_FAULT_MIN && state.rawSoilAdc < ADC_FAULT_MAX);
  state.rainHealthy = (state.rawRainAdc > ADC_FAULT_MIN && state.rawRainAdc < ADC_FAULT_MAX);

  if (state.soilHealthy) {
    state.moistureIndex = adcToPercentInverted(state.rawSoilAdc, SOIL_ADC_DRY, SOIL_ADC_WET);
  }
  if (state.rainHealthy) {
    state.rainIndex = adcToPercentInverted(state.rawRainAdc, RAIN_ADC_DRY, RAIN_ADC_WET);
  }

  // 2. Read and validate MPU6050 (attempt hot-recovery if disconnected earlier)
  float ax, ay, az, gx, gy, gz;
  if (!state.mpuHealthy) {
    state.mpuHealthy = initMpu6050();
  }
  if (state.mpuHealthy && readMpu6050Raw(ax, ay, az, gx, gy, gz)) {
    unsigned long nowMicros = micros();
    float dtSec = (nowMicros - lastMpuMicros) / 1000000.0f;
    lastMpuMicros = nowMicros;
    if (dtSec <= 0.0f || dtSec > 10.0f) dtSec = elapsedMs / 1000.0f;

    float accPitch = atan2f(ay, sqrtf(ax * ax + az * az)) * RAD_TO_DEG;
    float accRoll  = atan2f(-ax, az) * RAD_TO_DEG;

    // Complementary filter fuses fast gyro response with drift-free accel angle
    state.pitchDeg = COMPLEMENTARY_ALPHA * (state.pitchDeg + gx * dtSec) +
                     (1.0f - COMPLEMENTARY_ALPHA) * accPitch;
    state.rollDeg  = COMPLEMENTARY_ALPHA * (state.rollDeg  + gy * dtSec) +
                     (1.0f - COMPLEMENTARY_ALPHA) * accRoll;

    float dPitch = state.pitchDeg - state.baselinePitchDeg;
    float dRoll  = state.rollDeg  - state.baselineRollDeg;
    state.tiltChangeDeg = sqrtf(dPitch * dPitch + dRoll * dRoll);
  } else {
    state.mpuHealthy = false;
  }

  // 3. Evaluate overall sensor health (never falsely report SAFE on missing/faulty data)
  String faults = "";
  uint8_t healthyCount = 0;
  if (state.soilHealthy) healthyCount++; else faults += "SOIL_ADC_OUT_OF_RANGE; ";
  if (state.rainHealthy) healthyCount++; else faults += "RAIN_ADC_OUT_OF_RANGE; ";
  if (state.mpuHealthy)  healthyCount++; else faults += "MPU6050_I2C_FAULT; ";

  if (healthyCount == 3) {
    state.sensorHealth = "OK";
    state.faultReason  = "";
  } else if (healthyCount == 0) {
    state.sensorHealth = "SENSOR_FAULT";
    state.faultReason  = faults;
  } else {
    state.sensorHealth = "DATA_INCOMPLETE";
    state.faultReason  = faults;
  }

  // 4. Filter values and compute rates of change (% pts/min and deg/min)
  float dtMin = elapsedMs / 60000.0f;
  if (dtMin <= 0.0f) dtMin = SAMPLE_INTERVAL_MS / 60000.0f;

  if (!state.filterInitialized && state.soilHealthy && state.mpuHealthy) {
    state.filtMoisture      = state.moistureIndex;
    state.filtTilt          = state.tiltChangeDeg;
    state.moistureRatePerMin = 0.0f;
    state.tiltRateDegPerMin  = 0.0f;
    state.filterInitialized  = true;
  } else if (state.filterInitialized) {
    float prevFiltMoisture = state.filtMoisture;
    float prevFiltTilt     = state.filtTilt;

    if (state.soilHealthy) {
      state.filtMoisture = EMA_VALUE_ALPHA * state.moistureIndex +
                           (1.0f - EMA_VALUE_ALPHA) * prevFiltMoisture;
      float rawMRate = (state.filtMoisture - prevFiltMoisture) / dtMin;
      state.moistureRatePerMin = EMA_RATE_ALPHA * rawMRate +
                                 (1.0f - EMA_RATE_ALPHA) * state.moistureRatePerMin;
    }
    if (state.mpuHealthy) {
      state.filtTilt = EMA_VALUE_ALPHA * state.tiltChangeDeg +
                       (1.0f - EMA_VALUE_ALPHA) * prevFiltTilt;
      float rawTRate = (state.filtTilt - prevFiltTilt) / dtMin;
      state.tiltRateDegPerMin = EMA_RATE_ALPHA * rawTRate +
                                (1.0f - EMA_RATE_ALPHA) * state.tiltRateDegPerMin;
    }
  }

  // 5. Weighted local risk score (0.40 moisture + 0.30 rain + 0.30 tilt)
  float mRisk = state.soilHealthy ? computeSubRisk(state.filtMoisture, MOISTURE_THRESH) : 50.0f;
  float rRisk = state.rainHealthy ? computeSubRisk(state.rainIndex,    RAIN_THRESH)     : 50.0f;
  float tRisk = state.mpuHealthy  ? computeSubRisk(state.filtTilt,     TILT_THRESH)     : 50.0f;

  state.weightedScore = (WEIGHT_MOISTURE * mRisk) +
                        (WEIGHT_RAIN     * rRisk) +
                        (WEIGHT_TILT     * tRisk);

  if (state.weightedScore >= 75.0f)      state.scoreRisk = RISK_CRITICAL;
  else if (state.weightedScore >= 50.0f) state.scoreRisk = RISK_WARNING;
  else if (state.weightedScore >= 25.0f) state.scoreRisk = RISK_WATCH;
  else                                   state.scoreRisk = RISK_SAFE;

  // 6. Apply rate-of-change overrides only on healthy filtered signals
  if (state.soilHealthy && state.mpuHealthy) {
    updateRateOverrides(state.moistureRatePerMin, state.tiltRateDegPerMin);
  }

  RiskLevel combined = (state.scoreRisk > state.latchedRateRisk)
                         ? state.scoreRisk
                         : state.latchedRateRisk;

  // Safety constraint: never classify faulty/incomplete telemetry as SAFE
  if (state.sensorHealth != "OK" && combined == RISK_SAFE) {
    combined = RISK_WATCH;
  }
  state.finalRisk = combined;
}

// ============================================================================
// 9. NON-BLOCKING LOCAL LED & BUZZER CONTROLLER (Works Offline)
// ============================================================================
void updateIndicatorsNonBlocking() {
  unsigned long now = millis();
  bool fault = (state.sensorHealth != "OK");

  if (fault) {
    // Distinct alternating fault pattern on WATCH + WARNING LEDs and short chirp
    bool blinkFast = ((now / 250) % 2) == 0;
    digitalWrite(PIN_LED_SAFE,     LOW);
    digitalWrite(PIN_LED_WATCH,    blinkFast ? HIGH : LOW);
    digitalWrite(PIN_LED_WARNING,  blinkFast ? LOW  : HIGH);
    digitalWrite(PIN_LED_CRITICAL, (state.finalRisk == RISK_CRITICAL) ? HIGH : LOW);
    digitalWrite(PIN_BUZZER,       ((now % 3000) < 120) ? HIGH : LOW);
    return;
  }

  digitalWrite(PIN_LED_SAFE,     state.finalRisk == RISK_SAFE     ? HIGH : LOW);
  digitalWrite(PIN_LED_WATCH,    state.finalRisk == RISK_WATCH    ? HIGH : LOW);
  digitalWrite(PIN_LED_WARNING,  state.finalRisk == RISK_WARNING  ? HIGH : LOW);
  digitalWrite(PIN_LED_CRITICAL, state.finalRisk == RISK_CRITICAL ? HIGH : LOW);

  switch (state.finalRisk) {
    case RISK_SAFE:
      digitalWrite(PIN_BUZZER, LOW);
      break;
    case RISK_WATCH:
      // Short advisory pulse every 5 seconds
      digitalWrite(PIN_BUZZER, ((now % 5000) < 100) ? HIGH : LOW);
      break;
    case RISK_WARNING:
      // Intermittent 1 Hz warning beep
      digitalWrite(PIN_BUZZER, ((now % 1000) < 300) ? HIGH : LOW);
      break;
    case RISK_CRITICAL:
      // Rapid urgent alarm cadence
      digitalWrite(PIN_BUZZER, ((now % 300) < 200) ? HIGH : LOW);
      break;
  }
}

// ============================================================================
// 10. WI-FI & TELEMETRY UPLINK (Fault-Tolerant)
// ============================================================================
void maintainWifiNonBlocking() {
  if (WiFi.status() == WL_CONNECTED) return;

  unsigned long now = millis();
  if (now - lastWifiCheckMs >= WIFI_RETRY_INTERVAL_MS) {
    lastWifiCheckMs = now;
    Serial.println("[WIFI] Reconnecting to Wi-Fi (local alerts remain active)...");
    WiFi.disconnect();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  }
}

void sendTelemetryIfConnected() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[NET] Offline - skipping HTTP POST (local protection active).");
    return;
  }

  HTTPClient http;
  http.setTimeout(3000);
  if (!http.begin(BACKEND_ENDPOINT)) {
    Serial.println("[NET] HTTPClient begin failed.");
    return;
  }
  http.addHeader("Content-Type", "application/json");

  // Build JSON payload (send null for unhealthy sensor channels)
  String soilJson = state.soilHealthy ? String(state.filtMoisture, 2)       : "null";
  String rainJson = state.rainHealthy ? String(state.rainIndex, 2)          : "null";
  String tiltJson = state.mpuHealthy  ? String(state.filtTilt, 2)           : "null";
  String mRateJsn = state.soilHealthy ? String(state.moistureRatePerMin, 2) : "null";
  String tRateJsn = state.mpuHealthy  ? String(state.tiltRateDegPerMin, 2)  : "null";
  String faultJsn = (state.faultReason.length() > 0)
                      ? ("\"" + state.faultReason + "\"")
                      : "null";
  String reportedState = (state.sensorHealth != "OK" && state.finalRisk <= RISK_WATCH)
                           ? state.sensorHealth
                           : String(riskToString(state.finalRisk));

  String payload = "{";
  payload += "\"device_id\":\"" + String(DEVICE_ID) + "\",";
  payload += "\"moisture_index\":" + soilJson + ",";
  payload += "\"rain_index\":" + rainJson + ",";
  payload += "\"tilt_change_deg\":" + tiltJson + ",";
  payload += "\"moisture_rate_per_min\":" + mRateJsn + ",";
  payload += "\"tilt_rate_deg_per_min\":" + tRateJsn + ",";
  payload += "\"weighted_score\":" + String(state.weightedScore, 2) + ",";
  payload += "\"esp32_risk_state\":\"" + reportedState + "\",";
  payload += "\"sensor_health\":\"" + state.sensorHealth + "\",";
  payload += "\"fault_reason\":" + faultJsn + ",";
  payload += "\"wifi_rssi\":" + String(WiFi.RSSI()) + ",";
  payload += "\"uptime_sec\":" + String(millis() / 1000);
  payload += "}";

  int httpCode = http.POST(payload);
  if (httpCode > 0) {
    Serial.printf("[NET] POST /api/reading -> HTTP %d\n", httpCode);
  } else {
    Serial.printf("[NET] POST failed: %s\n", http.errorToString(httpCode).c_str());
  }
  http.end();
}

// ============================================================================
// 11. SERIAL CALIBRATION HELPER (Type 'c' to re-zero tilt, 'r' to print raw ADC)
// ============================================================================
void handleSerialCommands() {
  while (Serial.available() > 0) {
    char cmd = (char)Serial.read();
    if (cmd == 'c' || cmd == 'C') {
      calibrateTiltBaseline();
    } else if (cmd == 'r' || cmd == 'R') {
      Serial.printf("[RAW] Soil ADC: %d | Rain ADC: %d | Pitch: %.2f | Roll: %.2f\n",
                    readAdcFiltered(PIN_SOIL_ADC),
                    readAdcFiltered(PIN_RAIN_ADC),
                    state.pitchDeg,
                    state.rollDeg);
    }
  }
}

// ============================================================================
// 12. SETUP & MAIN LOOP
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n=======================================================");
  Serial.println(" ESP32 Miniature-Slope Landslide Risk Prototype v1.0");
  Serial.println(" EXPERIMENTAL USE ONLY - Calibrate thresholds on bench");
  Serial.println(" Commands: 'c' = re-zero tilt baseline | 'r' = raw ADC");
  Serial.println("=======================================================");

  pinMode(PIN_LED_SAFE,     OUTPUT);
  pinMode(PIN_LED_WATCH,    OUTPUT);
  pinMode(PIN_LED_WARNING,  OUTPUT);
  pinMode(PIN_LED_CRITICAL, OUTPUT);
  pinMode(PIN_BUZZER,       OUTPUT);

  // Brief LED self-test on boot
  digitalWrite(PIN_LED_SAFE, HIGH);     delay(120); digitalWrite(PIN_LED_SAFE, LOW);
  digitalWrite(PIN_LED_WATCH, HIGH);    delay(120); digitalWrite(PIN_LED_WATCH, LOW);
  digitalWrite(PIN_LED_WARNING, HIGH);  delay(120); digitalWrite(PIN_LED_WARNING, LOW);
  digitalWrite(PIN_LED_CRITICAL, HIGH); delay(120); digitalWrite(PIN_LED_CRITICAL, LOW);

  analogReadResolution(12);
  analogSetAttenuation(ADC_11db); // Full 0 - 3.3V input span

  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setClock(100000); // 100 kHz standard mode for long breadboard wires

  if (initMpu6050()) {
    calibrateTiltBaseline();
  } else {
    Serial.println("[ERR] MPU6050 not detected at 0x68 during boot.");
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiCheckMs = millis();
}

void loop() {
  unsigned long now = millis();

  handleSerialCommands();
  updateIndicatorsNonBlocking();
  maintainWifiNonBlocking();

  if (now - lastSampleMs >= SAMPLE_INTERVAL_MS) {
    unsigned long elapsed = now - lastSampleMs;
    lastSampleMs = now;

    evaluateSensorsAndRisk(elapsed);

    Serial.printf("[DATA] Health=%s | State=%s (Score=%.1f) | Moist=%.1f%% (%.2f%%/m) | Rain=%.1f%% | Tilt=%.2fdeg (%.2fdeg/m) | WiFi=%s\n",
                  state.sensorHealth.c_str(),
                  riskToString(state.finalRisk),
                  state.weightedScore,
                  state.filtMoisture,
                  state.moistureRatePerMin,
                  state.rainIndex,
                  state.filtTilt,
                  state.tiltRateDegPerMin,
                  (WiFi.status() == WL_CONNECTED) ? "OK" : "OFFLINE");
  }

  if (now - lastTelemetryMs >= TELEMETRY_INTERVAL_MS) {
    lastTelemetryMs = now;
    sendTelemetryIfConnected();
  }
}