import type {
  Alert,
  AppSettings,
  DatasetDetail,
  DatasetSummary,
  DemoStatus,
  DeviceStatus,
  FilterOptions,
  HistoricalAnalytics,
  HybridResponse,
  LatestResponse,
  MapPoint,
  ModelInfo,
  Paged,
  Preflight,
  Prediction,
  PreviewResponse,
  Reading,
  RiskDistribution,
  SensorStatsResponse,
  SeriesPoint,
  SeriesResponse,
  Summary,
  SystemEvent,
  Thresholds,
  TrainConfig,
  TrainingRun,
} from "../types";

/** Error carrying the HTTP status and the backend's JSON body. */
export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

type Params = Record<string, string | number | boolean | null | undefined>;

export function qs(params?: Params): string {
  if (!params) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

function messageFrom(body: unknown, status: number): string {
  if (body && typeof body === "object" && "detail" in body) {
    const d = (body as { detail: unknown }).detail;
    if (typeof d === "string") return d;
    if (d && typeof d === "object" && "message" in d) return String((d as { message: string }).message);
    return JSON.stringify(d);
  }
  if (status === 0) return "Cannot reach the backend. Is the FastAPI server running on port 8000?";
  return `Request failed (HTTP ${status})`;
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(0, messageFrom(null, 0), null);
  }
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    if (res.status === 502 || res.status === 504) throw new ApiError(0, messageFrom(null, 0), body);
    throw new ApiError(res.status, messageFrom(body, res.status), body);
  }
  return body as T;
}

const get = <T>(path: string, params?: Params) => request<T>(`${path}${qs(params)}`);
const send = <T>(method: string, path: string, data?: unknown, params?: Params) =>
  request<T>(`${path}${qs(params)}`, {
    method,
    headers: data !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });

export interface ReadingFilters extends Params {
  device_id?: string;
  start?: string;
  end?: string;
  window?: string;
  risk_state?: string;
  include_simulated?: boolean;
  valid_only?: boolean;
  experiment_id?: string;
}

export interface HistFilters extends Params {
  year_from?: number;
  year_to?: number;
  country?: string;
  trigger?: string;
  category?: string;
  size?: string;
  setting?: string;
  fatal_only?: boolean;
  rain_only?: boolean;
}

export const api = {
  health: () => get<{ status: string; database: string; version: string; server_time: string; demo_mode: boolean }>("/api/health"),
  summary: (include_simulated = true) => get<Summary>("/api/analytics/summary", { include_simulated }),
  latest: (device_id?: string, include_simulated = true) => get<LatestResponse>("/api/latest", { device_id, include_simulated }),
  series: (f: ReadingFilters & { max_points?: number }) => get<SeriesResponse>("/api/history/series", f),
  history: (f: ReadingFilters & { page?: number; page_size?: number; order?: string }) =>
    get<Paged<Reading> & { pages: number }>("/api/history", f),
  exportUrl: (f: ReadingFilters) => `/api/history/export.csv${qs(f)}`,
  devices: () => get<{ devices: DeviceStatus[]; offline_timeout_sec: number }>("/api/devices"),
  deviceHealth: (id: string, window = "24h") =>
    get<{
      device: DeviceStatus;
      totals: { readings: number; invalid_readings: number; degraded_health_readings: number; missing_channel_values: Record<string, number> };
      window: string;
      window_readings: number;
      telemetry_gaps: { gap_threshold_sec: number; gap_count: number; longest_gap_sec: number; estimated_missing_packets: number };
      history: SeriesPoint[];
      recent_faults: { received_at: string; sensor_health: string; fault_reason: string | null }[];
    }>(`/api/devices/${encodeURIComponent(id)}/health`, { window }),
  sensorStats: (f: ReadingFilters & { sensors?: string }) => get<SensorStatsResponse>("/api/analytics/sensors", f),
  riskDistribution: (f: ReadingFilters) => get<RiskDistribution>("/api/analytics/risk-distribution", f),

  alerts: (p: Params) => get<Paged<Alert> & { alert_types: string[] }>("/api/alerts", p),
  ackAlert: (id: number) => send<Alert>("POST", `/api/alerts/${id}/acknowledge`),
  ackAll: () => send<{ acknowledged: number }>("POST", "/api/alerts/acknowledge-all"),
  events: (p: Params) => get<Paged<SystemEvent> & { event_types: string[] }>("/api/events", p),

  settings: () => get<{ settings: AppSettings; firmware_defaults: Thresholds; notice: string }>("/api/settings"),
  saveSettings: (s: Partial<AppSettings>) => send<{ settings: AppSettings }>("PUT", "/api/settings", s),
  resetThresholds: () => send<{ settings: AppSettings }>("POST", "/api/settings/reset-thresholds"),
  experiments: () =>
    get<{ active_experiment_id: string | null; experiments: { experiment_id: string; readings: number; first: string; last: string; has_simulated: boolean }[] }>(
      "/api/experiments",
    ),
  startExperiment: (experiment_id: string) => send<{ active_experiment_id: string }>("POST", "/api/experiments/start", { experiment_id }),
  stopExperiment: () => send<{ stopped: string | null }>("POST", "/api/experiments/stop"),

  demoStatus: () => get<DemoStatus>("/api/demo/status"),
  demoStart: (scenario: string, speed: number) => send<DemoStatus>("POST", "/api/demo/start", { scenario, speed }),
  demoStop: () => send<DemoStatus>("POST", "/api/demo/stop"),
  demoPurge: () => send<{ readings: number; alerts: number; devices: number }>("DELETE", "/api/demo/data", undefined, { confirm: true }),
  systemInfo: () => get<Record<string, unknown>>("/api/system/info"),

  datasets: (category?: string) => get<{ datasets: DatasetSummary[] }>("/api/datasets", { category }),
  dataset: (id: number) => get<DatasetDetail>(`/api/datasets/${id}`),
  preview: (id: number, offset: number, limit: number, variant: "cleaned" | "original") =>
    get<PreviewResponse>(`/api/datasets/${id}/preview`, { offset, limit, variant }),
  downloadUrl: (id: number, variant: "cleaned" | "original") => `/api/datasets/${id}/download${qs({ variant })}`,
  deleteDataset: (id: number) => send<{ deleted: number }>("DELETE", `/api/datasets/${id}`, undefined, { confirm: true }),
  uploadDataset: (form: FormData) => request<DatasetDetail>("/api/datasets/upload", { method: "POST", body: form }),
  syntheticFixture: () => send<DatasetDetail>("POST", "/api/datasets/synthetic-fixture"),
  fromReadings: (body: { name: string; device_id?: string; experiment_ids?: string[]; include_simulated: boolean; confirm_new_version: boolean }) =>
    send<DatasetDetail>("POST", "/api/datasets/from-readings", body),

  histAnalytics: (id: number, f: HistFilters) => get<HistoricalAnalytics>(`/api/historical/${id}/analytics`, f),
  histMap: (id: number, f: HistFilters) =>
    get<{ available: boolean; points: MapPoint[]; total_with_coordinates: number; sampled?: boolean }>(`/api/historical/${id}/map`, f),
  histOptions: (id: number) => get<FilterOptions>(`/api/historical/${id}/filter-options`),
  histMapping: (id: number, mapping: Record<string, string | null>) =>
    send<{ mapping: Record<string, string | null> }>("PUT", `/api/historical/${id}/mapping`, mapping),

  preflight: (cfg: TrainConfig) => send<Preflight>("POST", "/api/ml/preflight", cfg),
  train: (cfg: TrainConfig) => send<TrainingRun>("POST", "/api/ml/train", cfg),
  runs: () => get<{ runs: TrainingRun[] }>("/api/ml/training-runs"),
  run: (id: number) => get<TrainingRun>(`/api/ml/training-runs/${id}`),
  models: () => get<{ models: ModelInfo[] }>("/api/ml/models"),
  model: (id: number) => get<ModelInfo>(`/api/ml/models/${id}`),
  compare: (ids: number[]) => get<{ models: ModelInfo[] }>("/api/ml/models/compare", { ids: ids.join(",") }),
  activate: (id: number) => send<ModelInfo>("POST", `/api/ml/models/${id}/activate`),
  deactivate: (id: number) => send<ModelInfo>("POST", `/api/ml/models/${id}/deactivate`),
  deleteModel: (id: number) => send<{ deleted: number }>("DELETE", `/api/ml/models/${id}`, undefined, { confirm: true }),
  artifactUrl: (name: string) => `/api/ml/artifacts/${encodeURIComponent(name)}`,
  predict: (body: { features?: Record<string, number | null>; use_latest?: boolean; device_id?: string }) =>
    send<Prediction>("POST", "/api/ml/predict", body),
  hybrid: (device_id?: string) => get<HybridResponse>("/api/ml/hybrid", { device_id }),
};
