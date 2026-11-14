export type RiskLevel = "SAFE" | "WATCH" | "WARNING" | "CRITICAL";
export type Esp32State = RiskLevel | "DATA_INCOMPLETE" | "SENSOR_FAULT" | string;

export interface Reading {
  id: number;
  device_id: string;
  received_at: string;
  moisture_index: number | null;
  rain_index: number | null;
  tilt_change_deg: number | null;
  moisture_rate_per_min: number | null;
  tilt_rate_deg_per_min: number | null;
  weighted_score: number | null;
  esp32_risk_state: Esp32State;
  sensor_health: string;
  fault_reason: string | null;
  wifi_rssi: number | null;
  uptime_sec: number | null;
  is_valid: boolean;
  quality_flags: string[];
  is_simulated: boolean;
  experiment_id: string | null;
  raw_payload?: unknown;
}

export interface DeviceStatus {
  device_id: string;
  online: boolean;
  connection_status: "online" | "offline";
  seconds_since_last_seen: number | null;
  first_seen: string | null;
  last_seen: string | null;
  last_risk_state: Esp32State | null;
  last_sensor_health: string | null;
  last_fault_reason: string | null;
  wifi_rssi: number | null;
  uptime_sec: number | null;
  total_readings: number;
  reboot_count: number;
  is_simulated: boolean;
  offline_timeout_sec: number;
}

export interface Contribution {
  factor: string;
  key: string;
  value: number | null;
  sub_risk: number;
  weight: number;
  points: number;
  missing: boolean;
}

export interface LatestResponse {
  reading: Reading | null;
  device: DeviceStatus | null;
  message?: string;
  reference_check?: {
    backend_reference_score: number;
    backend_score_level: string;
    instantaneous_rate_level: string;
    reported_score: number | null;
    abs_difference: number | null;
    consistent: boolean | null;
    tolerance: number;
    note: string;
  };
  explanation?: { contributions: Contribution[]; score_level: string; reasons: string[]; source: string };
}

export interface SeriesPoint {
  t: string;
  moisture_index: number | null;
  rain_index: number | null;
  tilt_change_deg: number | null;
  moisture_rate_per_min: number | null;
  tilt_rate_deg_per_min: number | null;
  weighted_score: number | null;
  wifi_rssi: number | null;
  esp32_risk_state: Esp32State;
  sensor_health: string;
  n: number;
}

export interface SeriesResponse {
  n_readings: number;
  n_points: number;
  downsampled: boolean;
  points: SeriesPoint[];
}

export interface Paged<T> {
  total: number;
  page: number;
  page_size: number;
  pages?: number;
  items: T[];
}

export interface Summary {
  total_readings: number;
  real_readings: number;
  simulated_readings: number;
  invalid_readings: number;
  first_reading_at: string | null;
  last_reading_at: string | null;
  devices: DeviceStatus[];
  devices_online: number;
  active_model: { id: number; version: number; name: string; is_synthetic: boolean } | null;
  models_total: number;
  datasets: { historical: number; experimental: number };
  alerts_last_24h: number;
  alerts_unacknowledged: number;
  active_experiment_id: string | null;
  server_time: string;
}

export interface SensorStat {
  key: string;
  label: string;
  unit: string;
  count: number;
  missing: number;
  invalid: number;
  current?: number | null;
  min?: number | null;
  max?: number | null;
  mean?: number | null;
  std?: number | null;
  median?: number | null;
  trend_slope_per_min?: number | null;
  trend?: string;
  net_change?: number | null;
}

export interface SensorStatsResponse {
  n_readings: number;
  first?: string;
  last?: string;
  duration_sec?: number;
  invalid_readings?: number;
  devices?: string[];
  telemetry_gaps?: { gap_count: number; estimated_missing_packets: number; longest_gap_sec: number; gap_threshold_sec: number };
  sensors: SensorStat[];
  message?: string;
}

export interface RiskDistribution {
  n_readings: number;
  states: { state: string; count: number; pct: number; approx_duration_sec: number }[];
  note?: string;
}

export interface Alert {
  id: number;
  created_at: string;
  device_id: string | null;
  alert_type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  details: Record<string, unknown>;
  is_simulated: boolean;
  acknowledged: boolean;
  acknowledged_at: string | null;
}

export interface SystemEvent {
  id: number;
  created_at: string;
  category: string;
  event_type: string;
  severity: string;
  device_id: string | null;
  message: string;
  details: Record<string, unknown>;
}

export interface ColumnProfile {
  name: string;
  dtype: string;
  kind: string;
  missing: number;
  missing_pct: number;
  unique: number;
  sample_values: string[];
  min?: number | null;
  max?: number | null;
  mean?: number | null;
}

export interface DatasetSummary {
  id: number;
  name: string;
  version: number;
  category: "historical" | "experimental";
  description: string;
  original_filename: string;
  uploaded_at: string;
  n_rows: number;
  n_columns: number;
  file_size_bytes: number;
  sha256: string;
  encoding: string;
  label_source: string | null;
  is_synthetic: boolean;
  source: string;
  duplicate_rows: number | null;
  warning_count: number;
  column_names: string[];
}

export interface DatasetDetail extends DatasetSummary {
  profile: {
    n_rows: number;
    n_columns: number;
    columns: ColumnProfile[];
    duplicate_rows: number;
    total_missing_cells: number;
    warnings: string[];
    detected_mapping?: Record<string, string | null>;
  };
  cleaning_report: Record<string, unknown> & { steps?: string[]; rows_before?: number; rows_after?: number };
  column_mapping: Record<string, string | null> | null;
  cleaned_rows?: number;
  used_by_models?: { id: number; version: number }[];
}

export interface PreviewResponse {
  columns: string[];
  rows: (string | number | boolean | null)[][];
  offset: number;
  limit: number;
  total: number;
  variant: string;
}

export interface CountItem {
  name: string;
  count: number;
  pct?: number;
  fatalities?: number | null;
}

export interface HistoricalAnalytics {
  dataset: { id: number; name: string; version: number; rows_total: number };
  mapping: Record<string, string | null>;
  available: Record<string, boolean>;
  totals: {
    events: number;
    events_with_valid_date?: number;
    date_min?: string | null;
    date_max?: string | null;
    events_with_valid_coordinates?: number;
    countries?: number;
    total_fatalities?: number;
    events_with_fatalities?: number;
    fatality_values_missing?: number;
    total_injuries?: number;
    events_with_injuries?: number;
    injury_values_missing?: number;
  };
  by_year?: { year: number; count: number; fatalities: number | null }[];
  by_month?: { month: number; label: string; count: number }[];
  countries?: CountItem[];
  admin_divisions?: CountItem[];
  triggers?: CountItem[];
  categories?: CountItem[];
  sizes?: CountItem[];
  settings?: CountItem[];
  deadliest_events?: { title: string; date: string | null; country: string | null; trigger: string | null; fatalities: number }[];
  fatalities_by_trigger?: { name: string; fatalities: number }[];
  rain_related?: {
    keywords: string[];
    count: number;
    pct_of_events_with_known_trigger: number;
    triggers: CountItem[];
    by_month: { month: number; label: string; count: number }[];
    fatalities: number | null;
    note: string;
  };
  data_quality: Record<string, unknown> & {
    mapped_column_missing?: Record<string, { column: string; missing: number; missing_pct: number }>;
  };
  caveats: string[];
}

export interface MapPoint {
  lat: number;
  lon: number;
  title: string | null;
  date: string | null;
  trigger: string | null;
  size: string | null;
  country: string | null;
  fatalities: number | null;
}

export interface FilterOptions {
  year_min?: number;
  year_max?: number;
  country?: { value: string; count: number }[];
  trigger?: { value: string; count: number }[];
  category?: { value: string; count: number }[];
  size?: { value: string; count: number }[];
  setting?: { value: string; count: number }[];
  columns: string[];
  mapping: Record<string, string | null>;
  roles: string[];
}

export interface TrainConfig {
  dataset_id: number;
  features: string[];
  target: string;
  test_size: number;
  random_seed: number;
  n_estimators: number;
  max_depth: number | null;
  min_samples_split: number;
  min_samples_leaf: number;
  class_weight: "none" | "balanced" | "balanced_subsample";
  split_strategy: "group" | "chronological" | "stratified" | "random";
  group_column: string | null;
  time_column: string | null;
  model_name: string;
  notes: string;
  acknowledge_warnings: boolean;
}

export interface Preflight {
  ok: boolean;
  errors: string[];
  warnings: string[];
  blocking_warnings: string[];
  needs_acknowledgement?: boolean;
  class_distribution?: { label: string; count: number; pct: number }[];
  data?: { rows_in_file: number; rows_dropped_missing_target: number; rows_usable: number; feature_missing: Record<string, number> };
  detected?: { group_column: string | null; time_column: string | null };
  n_groups?: number;
  dataset?: { id: number; name: string; version: number; label_source: string | null; is_synthetic: boolean; sha256: string };
}

export interface TrainingRun {
  id: number;
  status: "queued" | "running" | "completed" | "failed";
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  dataset_id: number | null;
  dataset_name: string;
  config: TrainConfig;
  warnings: string[];
  error: string | null;
  model_id: number | null;
  duration_sec: number | null;
  log?: string;
}

export interface PerClass {
  label: string;
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

export interface ModelMetrics {
  accuracy: number;
  balanced_accuracy: number;
  precision_macro: number;
  recall_macro: number;
  f1_macro: number;
  precision_weighted: number;
  recall_weighted: number;
  f1_weighted: number;
  majority_baseline_accuracy: number;
  majority_class: string;
  per_class: PerClass[];
  confusion_matrix: { labels: string[]; matrix: number[][] };
  classification_report_text: string;
  feature_importance_mdi: { feature: string; importance: number }[];
  permutation_importance: { feature: string; importance: number; std: number }[];
  class_distribution_train: Record<string, number>;
  class_distribution_test: Record<string, number>;
  fit_time_sec: number;
  training_duration_sec?: number;
  n_rows: number;
  n_train: number;
  n_test: number;
  evaluation_warnings: string[];
  plots?: { confusion_matrix?: string; feature_importance?: string };
}

export interface ModelInfo {
  id: number;
  version: number;
  name: string;
  created_at: string;
  dataset_id: number | null;
  dataset_name: string;
  dataset_hash: string;
  features: string[];
  target: string;
  classes: string[];
  hyperparameters: Record<string, unknown>;
  split_strategy: string;
  training_duration_sec: number;
  n_rows: number;
  n_train: number;
  n_test: number;
  is_active: boolean;
  label_source: string | null;
  is_synthetic: boolean;
  run_id: number | null;
  artifact_file: string;
  artifact_sha256: string;
  warnings: string[];
  notes: string;
  summary_metrics: Partial<Record<"accuracy" | "balanced_accuracy" | "f1_macro" | "f1_weighted" | "precision_macro" | "recall_macro" | "majority_baseline_accuracy", number>>;
  metrics?: ModelMetrics;
  split_details?: Record<string, unknown>;
}

export interface Prediction {
  predicted_class: string;
  class_scores: Record<string, number>;
  class_scores_note: string;
  input: Record<string, number>;
  model_id: number;
  model_version: number;
  model_name: string;
  trained_on_synthetic: boolean;
  label_source: string | null;
  predicted_at: string;
  source: { type: string; reading_id?: number; device_id?: string; esp32_risk_state?: string; is_simulated?: boolean };
}

export interface HybridResponse {
  reading: (Partial<Reading> & { age_sec: number; stale: boolean }) | null;
  esp32_state: Esp32State | null;
  ml: Prediction | null;
  agreement: boolean | null;
  model_status: "no_active_model" | "active" | "incompatible" | "refused";
  policy: string;
  message?: string;
}

export interface Thresholds {
  moisture: number[];
  rain: number[];
  tilt: number[];
  weights: { moisture: number; rain: number; tilt: number };
  score_cutoffs: { watch: number; warning: number; critical: number };
  moisture_rate: { watch: number; warning: number; critical: number; hysteresis: number };
  tilt_rate: { watch: number; warning: number; critical: number; hysteresis: number };
  rate_trigger_persist: number;
  rate_clear_persist: number;
  score_mismatch_tolerance: number;
}

export interface AppSettings {
  dashboard_refresh_ms: number;
  device_offline_timeout_sec: number;
  expected_telemetry_interval_sec: number;
  telemetry_gap_factor: number;
  data_retention_days: number;
  time_format_24h: boolean;
  chart_max_points: number;
  show_simulated_data: boolean;
  active_experiment_id: string | null;
  analysis_thresholds: Thresholds;
}

export interface DemoStatus {
  running: boolean;
  scenario: string | null;
  scenario_label: string | null;
  speed: number;
  device_id: string;
  started_at: string | null;
  posts: number;
  last_state: string | null;
  scenarios: { key: string; label: string; description: string }[];
  notice: string;
}
