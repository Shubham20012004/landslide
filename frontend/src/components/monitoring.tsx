import { Lightbulb, Scale } from "lucide-react";
import { TimeSeriesChart, type ThresholdLine } from "../charts";
import type { DeviceStatus, LatestResponse, SeriesPoint, Thresholds } from "../types";
import { fmtNum, RISK_COLORS, SERIES_COLORS } from "../utils/format";
import { Badge, Card, RiskBadge, Select } from "./ui";

export interface ChartSpec {
  key: keyof SeriesPoint;
  title: string;
  unit: string;
  color: string;
  domain?: [number, number];
  thresholds?: (t: Thresholds) => ThresholdLine[];
  area?: boolean;
}

const ladder = (vals: number[]): ThresholdLine[] =>
  [
    { y: vals[0], label: "WATCH", color: RISK_COLORS.WATCH },
    { y: vals[1], label: "WARNING", color: RISK_COLORS.WARNING },
    { y: vals[2], label: "CRITICAL", color: RISK_COLORS.CRITICAL },
  ].filter((t) => Number.isFinite(t.y));

export const SENSOR_CHARTS: ChartSpec[] = [
  { key: "moisture_index", title: "Soil Moisture Index vs Time", unit: "index", color: SERIES_COLORS.moisture, domain: [0, 100], area: true,
    thresholds: (t) => ladder([t.moisture[0], t.moisture[1], t.moisture[2]]) },
  { key: "rain_index", title: "Rain Activity Index vs Time", unit: "index", color: SERIES_COLORS.rain, domain: [0, 100], area: true,
    thresholds: (t) => ladder([t.rain[0], t.rain[1], t.rain[2]]) },
  { key: "tilt_change_deg", title: "Slope Tilt Change vs Time", unit: "°", color: SERIES_COLORS.tilt, area: true,
    thresholds: (t) => ladder([t.tilt[0], t.tilt[1], t.tilt[2]]) },
  { key: "moisture_rate_per_min", title: "Moisture Rate of Change vs Time", unit: "%-pts/min", color: SERIES_COLORS.moisture,
    thresholds: (t) => ladder([t.moisture_rate.watch, t.moisture_rate.warning, t.moisture_rate.critical]) },
  { key: "tilt_rate_deg_per_min", title: "Tilt Rate of Change vs Time", unit: "°/min", color: SERIES_COLORS.tilt,
    thresholds: (t) => ladder([t.tilt_rate.watch, t.tilt_rate.warning, t.tilt_rate.critical]) },
  { key: "weighted_score", title: "Prototype Weighted Score vs Time", unit: "/100", color: SERIES_COLORS.neutral, domain: [0, 100], area: true,
    thresholds: (t) => ladder([t.score_cutoffs.watch, t.score_cutoffs.warning, t.score_cutoffs.critical]) },
];

export function SensorChartGrid({ points, thresholds, height = 200, showThresholds = true }: { points: SeriesPoint[]; thresholds?: Thresholds; height?: number; showThresholds?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {SENSOR_CHARTS.map((c) => (
        <Card key={c.key} title={c.title} subtitle={showThresholds && thresholds ? "Dashed lines: prototype thresholds (backend copy of firmware defaults)" : undefined} bodyClass="p-3">
          <TimeSeriesChart
            data={points}
            series={[{ key: c.key, label: c.title.split(" vs")[0], color: c.color }]}
            unit={c.unit}
            yDomain={c.domain}
            height={height}
            area={c.area}
            thresholds={showThresholds && thresholds && c.thresholds ? c.thresholds(thresholds) : undefined}
          />
        </Card>
      ))}
    </div>
  );
}

export function ExplanationPanel({ latest }: { latest: LatestResponse }) {
  const ex = latest.explanation;
  const rc = latest.reference_check;
  if (!ex || !latest.reading) return null;
  return (
    <Card title="Why is the risk at this level?" subtitle={ex.source} icon={Lightbulb}>
      <div className="space-y-3">
        <div className="space-y-2">
          {ex.contributions.map((c) => (
            <div key={c.key} className="grid grid-cols-[150px_1fr_64px] items-center gap-3 text-xs">
              <span className="text-slate-300">
                {c.factor} <span className="text-slate-500">×{c.weight}</span>
              </span>
              <div className="h-2.5 rounded bg-ink-900" title={`Sub-risk ${c.sub_risk}/100`}>
                <div className="h-2.5 rounded" style={{ width: `${c.sub_risk}%`, background: c.missing ? "#64748b" : c.key === "moisture" ? SERIES_COLORS.moisture : c.key === "rain" ? SERIES_COLORS.rain : SERIES_COLORS.tilt }} />
              </div>
              <span className="text-right font-mono text-slate-300">{c.missing ? "n/a" : `+${fmtNum(c.points, 1)}`}</span>
            </div>
          ))}
        </div>
        <ul className="list-disc space-y-1 pl-4 text-[13px] text-slate-300">
          {ex.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
        {rc && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-ink-850 px-3 py-2 text-xs text-slate-400">
            <Scale size={13} />
            Backend cross-check: reference score <b className="font-mono text-slate-200">{fmtNum(rc.backend_reference_score, 1)}</b>
            ({rc.backend_score_level}) vs ESP32 <b className="font-mono text-slate-200">{fmtNum(rc.reported_score, 1)}</b>
            {rc.consistent === true && <Badge tone="green">consistent</Badge>}
            {rc.consistent === false && <Badge tone="amber" title="Backend thresholds may differ from those flashed on the device">differs by {rc.abs_difference}</Badge>}
            <span className="w-full text-[11px] text-slate-500">{rc.note}</span>
          </div>
        )}
      </div>
    </Card>
  );
}

export function DeviceSelect({ devices, value, onChange, allowAll }: { devices: DeviceStatus[]; value: string; onChange: (v: string) => void; allowAll?: boolean }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className="w-auto min-w-[200px]" aria-label="Device">
      {allowAll && <option value="">All devices</option>}
      {!allowAll && !devices.length && <option value="">No devices</option>}
      {devices.map((d) => (
        <option key={d.device_id} value={d.device_id}>
          {d.device_id} {d.is_simulated ? "(simulated)" : ""} · {d.online ? "online" : "offline"}
        </option>
      ))}
    </Select>
  );
}

/** Pick a sensible default device: online real > online simulated > most recent. */
export function defaultDevice(devices: DeviceStatus[]): string {
  return (devices.find((d) => d.online && !d.is_simulated) ?? devices.find((d) => d.online) ?? devices[0])?.device_id ?? "";
}

export function StateLegend() {
  return (
    <div className="flex flex-wrap gap-2">
      {["SAFE", "WATCH", "WARNING", "CRITICAL", "DATA_INCOMPLETE", "SENSOR_FAULT"].map((s) => (
        <RiskBadge key={s} state={s} size="sm" />
      ))}
    </div>
  );
}
