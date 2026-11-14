export const RISK_LEVELS = ["SAFE", "WATCH", "WARNING", "CRITICAL"] as const;

export const RISK_COLORS: Record<string, string> = {
  // Reserved status palette (validated for the dark surface); never reused for data series.
  SAFE: "#0ca30c",
  WATCH: "#fab219",
  WARNING: "#ec835a",
  CRITICAL: "#d03b3b",
  DATA_INCOMPLETE: "#94a3b8",
  SENSOR_FAULT: "#cbd5e1",
};

/** Fixed categorical identity per sensor (dark-mode slots 1, 3, 7). */
export const SERIES_COLORS = {
  moisture: "#3987e5",
  rain: "#199e70",
  tilt: "#9085e9",
  neutral: "#cbd5e1",
};

export const RISK_NUM: Record<string, number> = { SAFE: 0, WATCH: 1, WARNING: 2, CRITICAL: 3, DATA_INCOMPLETE: 1.5, SENSOR_FAULT: 1.5 };

export function riskColor(state?: string | null): string {
  return (state && RISK_COLORS[state]) || "#64748b";
}

let use24h = true;
export function setTimeFormat24h(v: boolean) {
  use24h = v;
}

export function fmtTime(iso?: string | null, withSeconds = true): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: withSeconds ? "2-digit" : undefined, hour12: !use24h });
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" })} ${fmtTime(iso)}`;
}

export function fmtNum(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function fmtInt(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return Math.round(v).toLocaleString();
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

export function fmtDuration(sec?: number | null): string {
  if (sec === null || sec === undefined) return "—";
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function fmtAgo(iso?: string | null): string {
  if (!iso) return "never";
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 0) return "just now";
  return `${fmtDuration(sec)} ago`;
}

export function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

export function humanize(s?: string | null): string {
  if (!s) return "—";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function rssiQuality(rssi?: number | null): { label: string; color: string } {
  if (rssi === null || rssi === undefined) return { label: "unknown", color: "#64748b" };
  if (rssi >= -60) return { label: "excellent", color: "#22c55e" };
  if (rssi >= -70) return { label: "good", color: "#84cc16" };
  if (rssi >= -80) return { label: "fair", color: "#eab308" };
  return { label: "weak", color: "#ef4444" };
}

export const LABEL_SOURCE_TEXT: Record<string, string> = {
  manual_observation: "Manual observation (team-assigned)",
  esp32_rule_engine: "ESP32 rule engine (model may learn the rules)",
  synthetic_rule_engine: "SYNTHETIC rule-engine fixture (pipeline test only)",
  unknown: "Unknown / undocumented",
};
