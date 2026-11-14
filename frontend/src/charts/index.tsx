import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SeriesPoint } from "../types";
import { fmtDateTime, fmtNum, fmtTime, RISK_COLORS, riskColor } from "../utils/format";

const AXIS = { stroke: "#334670", fontSize: 11, tick: { fill: "#8a96b3" } };
const GRID = <CartesianGrid stroke="#1f2d4a" strokeDasharray="0" vertical={false} />;
const TOOLTIP_STYLE = {
  contentStyle: { background: "#0e1729", border: "1px solid #25355a", borderRadius: 8, fontSize: 12, color: "#e2e8f0" },
  labelStyle: { color: "#94a3b8", marginBottom: 4 },
  itemStyle: { color: "#e2e8f0", padding: 0 },
  cursor: { stroke: "#64748b", strokeWidth: 1 },
};

export interface SeriesDef {
  key: keyof SeriesPoint | string;
  label: string;
  color: string;
  unit?: string;
}

export interface ThresholdLine {
  y: number;
  label: string;
  color?: string;
}

function ChartEmpty({ height, text }: { height: number; text: string }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-dashed border-line text-xs text-slate-500" style={{ height }}>
      {text}
    </div>
  );
}

/** Line chart over time. Null values break the line (sensor fault), never interpolated. */
export function TimeSeriesChart({
  data, series, height = 220, unit, yDomain, thresholds, emptyText = "No readings in this window", area,
}: {
  data: SeriesPoint[] | Record<string, unknown>[];
  series: SeriesDef[];
  height?: number;
  unit?: string;
  yDomain?: [number | "auto" | "dataMin" | "dataMax", number | "auto" | "dataMin" | "dataMax"];
  thresholds?: ThresholdLine[];
  emptyText?: string;
  area?: boolean;
}) {
  const rows = useMemo(
    () => (data as Record<string, unknown>[]).map((p) => ({ ...p, _ts: new Date(String(p.t)).getTime() }) as Record<string, unknown>),
    [data],
  );
  const hasValues = rows.some((r) => series.some((s) => r[s.key as string] !== null && r[s.key as string] !== undefined));
  if (!rows.length || !hasValues) return <ChartEmpty height={height} text={emptyText} />;
  const spanMs = rows.length > 1 ? (rows[rows.length - 1]._ts as number) - (rows[0]._ts as number) : 0;
  const tickFmt = (v: number) => (spanMs > 36 * 3600e3 ? new Date(v).toLocaleDateString(undefined, { month: "short", day: "2-digit" }) : fmtTime(new Date(v).toISOString(), spanMs < 600e3));
  const common = (
    <>
      {GRID}
      <XAxis dataKey="_ts" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={tickFmt} {...AXIS} minTickGap={40} />
      <YAxis {...AXIS} width={44} domain={yDomain ?? ["auto", "auto"]} tickFormatter={(v: number) => fmtNum(v, 1)} />
      <Tooltip
        {...TOOLTIP_STYLE}
        labelFormatter={(v: number) => fmtDateTime(new Date(v).toISOString())}
        formatter={(v: number, name: string) => [v === null || v === undefined ? "no data" : `${fmtNum(v, 2)}${unit ? ` ${unit}` : ""}`, name]}
      />
      {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12, color: "#cbd5e1" }} iconType="plainline" />}
      {thresholds?.map((t) => (
        <ReferenceLine key={t.label} y={t.y} stroke={t.color ?? "#475569"} strokeDasharray="4 4" ifOverflow="extendDomain"
          label={{ value: t.label, position: "insideTopRight", fill: "#8a96b3", fontSize: 10 }} />
      ))}
    </>
  );
  return (
    <ResponsiveContainer width="100%" height={height}>
      {area && series.length === 1 ? (
        <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`g-${String(series[0].key)}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={series[0].color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={series[0].color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {common}
          <Area type="monotone" dataKey={series[0].key as string} name={series[0].label} stroke={series[0].color} strokeWidth={2}
            fill={`url(#g-${String(series[0].key)})`} connectNulls={false} isAnimationActive={false} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#0e1729" }} />
        </AreaChart>
      ) : (
        <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          {common}
          {series.map((s) => (
            <Line key={String(s.key)} type="monotone" dataKey={s.key as string} name={s.label} stroke={s.color} strokeWidth={2}
              dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "#0e1729" }} connectNulls={false} isAnimationActive={false} />
          ))}
        </LineChart>
      )}
    </ResponsiveContainer>
  );
}

/** Run-length strip of ESP32 risk states over time, widths proportional to duration. */
export function RiskTimeline({ data, height = 28 }: { data: { t: string; esp32_risk_state: string }[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const runs = useMemo(() => {
    const out: { state: string; start: number; end: number; n: number }[] = [];
    for (const p of data) {
      const ts = new Date(p.t).getTime();
      const last = out[out.length - 1];
      if (last && last.state === p.esp32_risk_state) {
        last.end = ts;
        last.n++;
      } else {
        if (last) last.end = ts;
        out.push({ state: p.esp32_risk_state, start: ts, end: ts, n: 1 });
      }
    }
    return out;
  }, [data]);
  if (!runs.length) return <ChartEmpty height={height + 24} text="No risk-state history in this window" />;
  const t0 = runs[0].start;
  const span = Math.max(runs[runs.length - 1].end - t0, 1);
  const present = Array.from(new Set(runs.map((r) => r.state)));
  return (
    <div>
      <div className="relative flex w-full gap-[2px] overflow-hidden rounded-md" style={{ height }} onMouseLeave={() => setHover(null)}>
        {runs.map((r, i) => (
          <div
            key={i}
            onMouseEnter={() => setHover(i)}
            className="h-full transition-opacity"
            style={{ flexGrow: Math.max(r.end - r.start, span / 400), flexBasis: 0, background: riskColor(r.state), opacity: hover === null || hover === i ? 1 : 0.45, minWidth: 2 }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
        <span className="font-mono">{fmtTime(new Date(t0).toISOString())}</span>
        <span className="min-h-[16px] text-slate-300">
          {hover !== null
            ? `${runs[hover].state.replace("_", " ")} · ${fmtTime(new Date(runs[hover].start).toISOString())} → ${fmtTime(new Date(runs[hover].end).toISOString())} · ${runs[hover].n} reading${runs[hover].n > 1 ? "s" : ""}`
            : "Hover a segment for details"}
        </span>
        <span className="font-mono">{fmtTime(new Date(t0 + span).toISOString())}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-400">
        {present.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: riskColor(s) }} />
            {s.replace("_", " ")}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Horizontal bars for category counts (single series, one hue). */
export function HBarChart({ data, height, color = "#3987e5", valueKey = "count", nameKey = "name", valueLabel = "Events", onBarClick }: {
  data: Record<string, unknown>[]; height?: number; color?: string; valueKey?: string; nameKey?: string; valueLabel?: string; onBarClick?: (name: string) => void;
}) {
  if (!data.length) return <ChartEmpty height={height ?? 160} text="Not available for this dataset" />;
  const h = height ?? Math.max(120, data.length * 26 + 20);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 0 }} barCategoryGap={2}>
        <XAxis type="number" {...AXIS} tickFormatter={(v: number) => fmtNum(v, 0)} />
        <YAxis type="category" dataKey={nameKey} {...AXIS} width={130} tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v).replace(/_/g, " ")} interval={0} />
        <Tooltip {...TOOLTIP_STYLE} cursor={{ fill: "#ffffff08" }} formatter={(v: number) => [fmtNum(v, 0), valueLabel]} />
        <Bar dataKey={valueKey} fill={color} radius={[0, 4, 4, 0]} isAnimationActive={false} maxBarSize={18}
          onClick={onBarClick ? (d: Record<string, unknown>) => onBarClick(String(d[nameKey])) : undefined} cursor={onBarClick ? "pointer" : undefined} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Vertical columns (years, months). */
export function ColumnChart({ data, xKey, yKey, height = 220, color = "#3987e5", valueLabel = "Events" }: {
  data: Record<string, unknown>[]; xKey: string; yKey: string; height?: number; color?: string; valueLabel?: string;
}) {
  if (!data.length) return <ChartEmpty height={height} text="Not available for this dataset" />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
        {GRID}
        <XAxis dataKey={xKey} {...AXIS} interval="preserveStartEnd" minTickGap={8} />
        <YAxis {...AXIS} width={44} tickFormatter={(v: number) => fmtNum(v, 0)} />
        <Tooltip {...TOOLTIP_STYLE} cursor={{ fill: "#ffffff08" }} formatter={(v: number) => [fmtNum(v, 0), valueLabel]} />
        <Bar dataKey={yKey} fill={color} radius={[4, 4, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Bars coloured by risk state (status palette), always labelled. */
export function RiskBars({ data, height = 180 }: { data: { state: string; count: number; pct: number }[]; height?: number }) {
  if (!data.length) return <ChartEmpty height={height} text="No readings" />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 16, right: 8, bottom: 0, left: 0 }} barCategoryGap={6}>
        {GRID}
        <XAxis dataKey="state" {...AXIS} tickFormatter={(v: string) => v.replace("_", " ")} />
        <YAxis {...AXIS} width={44} />
        <Tooltip {...TOOLTIP_STYLE} cursor={{ fill: "#ffffff08" }} formatter={(v: number, _n, p) => [`${fmtNum(v, 0)} (${(p.payload as { pct: number }).pct}%)`, "Readings"]} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false} label={{ position: "top", fill: "#cbd5e1", fontSize: 11 }}>
          {data.map((d) => (
            <Cell key={d.state} fill={RISK_COLORS[d.state] ?? "#64748b"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Semicircular gauge for the 0–100 prototype weighted score with the firmware's cut-offs. */
export function ScoreGauge({ value, cutoffs = [25, 50, 75], state }: { value: number | null | undefined; cutoffs?: number[]; state?: string | null }) {
  const R = 80;
  const cx = 100;
  const cy = 92;
  const arc = (a: number, b: number) => {
    const p = (v: number) => {
      const ang = Math.PI * (1 - v / 100);
      return [cx + R * Math.cos(ang), cy - R * Math.sin(ang)];
    };
    const [x1, y1] = p(a);
    const [x2, y2] = p(b);
    return `M ${x1} ${y1} A ${R} ${R} 0 0 1 ${x2} ${y2}`;
  };
  const bands = [
    [0, cutoffs[0], RISK_COLORS.SAFE],
    [cutoffs[0], cutoffs[1], RISK_COLORS.WATCH],
    [cutoffs[1], cutoffs[2], RISK_COLORS.WARNING],
    [cutoffs[2], 100, RISK_COLORS.CRITICAL],
  ] as const;
  const v = value === null || value === undefined ? null : Math.max(0, Math.min(100, value));
  const ang = v === null ? 0 : Math.PI * (1 - v / 100);
  return (
    <svg viewBox="0 0 200 112" className="w-full max-w-[240px]" role="img" aria-label={`Weighted score ${v ?? "unavailable"}`}>
      {bands.map(([a, b, c], i) => (
        <path key={i} d={arc(a + (i ? 0.8 : 0), b - (i < 3 ? 0.8 : 0))} stroke={c} strokeWidth={12} fill="none" opacity={0.85} />
      ))}
      {v !== null && (
        <>
          <line x1={cx} y1={cy} x2={cx + (R - 18) * Math.cos(ang)} y2={cy - (R - 18) * Math.sin(ang)} stroke="#e2e8f0" strokeWidth={2.5} strokeLinecap="round" />
          <circle cx={cx} cy={cy} r={5} fill="#e2e8f0" />
        </>
      )}
      <text x={cx} y={cy - 22} textAnchor="middle" className="fill-slate-50 font-mono" fontSize="22" fontWeight={600}>
        {v === null ? "—" : v.toFixed(1)}
      </text>
      <text x={cx} y={110} textAnchor="middle" fill={state ? riskColor(state) : "#8a96b3"} fontSize="10" fontWeight={600}>
        {state ? state.replace("_", " ") : ""}
      </text>
    </svg>
  );
}

/** Confusion matrix heatmap (rows = actual, columns = predicted). */
export function ConfusionMatrix({ labels, matrix }: { labels: string[]; matrix: number[][] }) {
  const max = Math.max(1, ...matrix.flat());
  return (
    <div className="overflow-x-auto">
      <table className="mx-auto border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th />
            <th colSpan={labels.length} className="pb-1 text-center text-[11px] font-medium uppercase tracking-wider text-slate-500">
              Predicted
            </th>
          </tr>
          <tr>
            <th className="pr-2 text-right text-[11px] font-medium uppercase tracking-wider text-slate-500">Actual</th>
            {labels.map((l) => (
              <th key={l} className="px-1 pb-1 text-center text-[11px] font-semibold" style={{ color: riskColor(l) }}>
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => {
            const rowSum = row.reduce((a, b) => a + b, 0) || 1;
            return (
              <tr key={i}>
                <th className="pr-2 text-right text-[11px] font-semibold" style={{ color: riskColor(labels[i]) }}>
                  {labels[i]}
                </th>
                {row.map((v, j) => {
                  const a = v / max;
                  return (
                    <td
                      key={j}
                      title={`Actual ${labels[i]}, predicted ${labels[j]}: ${v} (${((100 * v) / rowSum).toFixed(1)}% of row)`}
                      className="h-14 w-20 rounded-md text-center align-middle font-mono text-sm"
                      style={{
                        background: i === j ? `rgba(57,135,229,${0.12 + 0.75 * a})` : v ? `rgba(208,59,59,${0.1 + 0.6 * a})` : "#0e1729",
                        color: a > 0.55 ? "#fff" : "#cbd5e1",
                        outline: i === j ? "1px solid #3987e555" : undefined,
                      }}
                    >
                      <div className="font-semibold">{v}</div>
                      <div className="text-[10px] opacity-70">{((100 * v) / rowSum).toFixed(0)}%</div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-center text-[11px] text-slate-500">Diagonal (blue) = correct. Off-diagonal (red) = misclassifications. Percentages are per actual-class row (= recall).</p>
    </div>
  );
}

/** Horizontal importance bars with optional error (std) text. */
export function ImportanceBars({ data, color = "#3987e5" }: { data: { feature: string; importance: number; std?: number }[]; color?: string }) {
  if (!data.length) return <ChartEmpty height={120} text="Not available" />;
  const max = Math.max(...data.map((d) => Math.abs(d.importance)), 1e-9);
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.feature} className="grid grid-cols-[150px_1fr_70px] items-center gap-3 text-xs">
          <span className="truncate font-mono text-slate-300" title={d.feature}>
            {d.feature}
          </span>
          <div className="h-3 rounded bg-ink-900">
            <div className="h-3 rounded-r" style={{ width: `${Math.max(0, (d.importance / max) * 100)}%`, background: color }} />
          </div>
          <span className="text-right font-mono text-slate-400">
            {fmtNum(d.importance, 3)}
            {d.std !== undefined && <span className="text-slate-600"> ±{fmtNum(d.std, 3)}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Class score bars for a prediction (labelled; not probabilities of landslide). */
export function ClassScores({ scores }: { scores: Record<string, number> }) {
  const order = ["SAFE", "WATCH", "WARNING", "CRITICAL"];
  const keys = [...order.filter((k) => k in scores), ...Object.keys(scores).filter((k) => !order.includes(k))];
  return (
    <div className="space-y-1.5">
      {keys.map((k) => (
        <div key={k} className="grid grid-cols-[80px_1fr_52px] items-center gap-2 text-xs">
          <span className="font-semibold" style={{ color: riskColor(k) }}>
            {k}
          </span>
          <div className="h-2.5 rounded bg-ink-900">
            <div className="h-2.5 rounded" style={{ width: `${(scores[k] ?? 0) * 100}%`, background: riskColor(k) }} />
          </div>
          <span className="text-right font-mono text-slate-300">{((scores[k] ?? 0) * 100).toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}
