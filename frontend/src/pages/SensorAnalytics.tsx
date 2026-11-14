import { BarChart3, Download, Filter } from "lucide-react";
import { useMemo, useState } from "react";
import { RiskBars, TimeSeriesChart } from "../charts";
import { DeviceSelect, SENSOR_CHARTS } from "../components/monitoring";
import { Async, Badge, Button, Card, EmptyState, Field, Input, KV, MetricCard, PageHeader, Pagination, RiskBadge, Select, SimBadge, Table, Toggle } from "../components/ui";
import { useApi } from "../hooks/useApi";
import { useAppSettings } from "../hooks/useAppSettings";
import { api, type ReadingFilters } from "../services/api";
import { fmtDateTime, fmtDuration, fmtInt, fmtNum, SERIES_COLORS } from "../utils/format";

const toIso = (local: string) => (local ? new Date(local).toISOString() : undefined);

export default function SensorAnalytics() {
  const { settings } = useAppSettings();
  const devs = useApi(() => api.devices(), [], 15000);
  const [device, setDevice] = useState("");
  const [sensor, setSensor] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [state, setState] = useState("");
  const [window, setWindow] = useState("24h");
  const [sim, setSim] = useState(true);
  const [validOnly, setValidOnly] = useState(false);
  const [page, setPage] = useState(1);

  const filters: ReadingFilters = useMemo(() => ({
    device_id: device || undefined,
    window: start || end ? undefined : window || undefined,
    start: toIso(start), end: toIso(end),
    risk_state: state || undefined,
    include_simulated: sim, valid_only: validOnly,
  }), [device, start, end, state, window, sim, validOnly]);
  const key = JSON.stringify(filters);

  const stats = useApi(() => api.sensorStats({ ...filters, sensors: sensor || undefined }), [key, sensor]);
  const dist = useApi(() => api.riskDistribution(filters), [key]);
  const series = useApi(() => api.series({ ...filters, max_points: settings?.chart_max_points ?? 500 }), [key]);
  const rows = useApi(() => api.history({ ...filters, page, page_size: 25 }), [key, page]);
  const charts = SENSOR_CHARTS.filter((c) => !sensor || c.key === sensor);

  return (
    <>
      <PageHeader icon={BarChart3} title="Sensor Analytics" subtitle="Server-side statistics over stored telemetry. Trend = least-squares slope per minute over the selected period."
        actions={<a href={api.exportUrl(filters)}><Button icon={Download}>Export filtered CSV</Button></a>} />

      <Card title="Filters" icon={Filter} className="mb-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Field label="Device"><DeviceSelect devices={devs.data?.devices ?? []} value={device} onChange={(v) => { setDevice(v); setPage(1); }} allowAll /></Field>
          <Field label="Sensor">
            <Select value={sensor} onChange={(e) => setSensor(e.target.value)}>
              <option value="">All sensors</option>
              {SENSOR_CHARTS.map((c) => <option key={c.key} value={c.key}>{c.title.split(" vs")[0]}</option>)}
            </Select>
          </Field>
          <Field label="Quick range" hint={start || end ? "custom range overrides" : undefined}>
            <Select value={window} onChange={(e) => { setWindow(e.target.value); setPage(1); }} disabled={!!(start || end)}>
              {["1h", "6h", "24h", "7d", "30d"].map((w) => <option key={w} value={w}>Last {w}</option>)}
              <option value="">All time</option>
            </Select>
          </Field>
          <Field label="From"><Input type="datetime-local" value={start} onChange={(e) => { setStart(e.target.value); setPage(1); }} /></Field>
          <Field label="To"><Input type="datetime-local" value={end} onChange={(e) => { setEnd(e.target.value); setPage(1); }} /></Field>
          <Field label="ESP32 risk state">
            <Select value={state} onChange={(e) => { setState(e.target.value); setPage(1); }}>
              <option value="">Any</option>
              {["SAFE", "WATCH", "WARNING", "CRITICAL", "DATA_INCOMPLETE", "SENSOR_FAULT"].map((s) => <option key={s}>{s}</option>)}
            </Select>
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-5">
          <Toggle checked={sim} onChange={(v) => { setSim(v); setPage(1); }} label="Include simulated (Demo Mode) readings" />
          <Toggle checked={validOnly} onChange={(v) => { setValidOnly(v); setPage(1); }} label="Valid readings only" />
        </div>
      </Card>

      <Async state={stats}>
        {(s) => s.n_readings === 0 ? <Card><EmptyState title="No readings match these filters" /></Card> : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <MetricCard label="Readings" value={fmtInt(s.n_readings)} />
              <MetricCard label="Collection duration" value={<span className="text-lg">{fmtDuration(s.duration_sec)}</span>} hint={`${fmtDateTime(s.first)} → ${fmtDateTime(s.last)}`} />
              <MetricCard label="Invalid readings" value={fmtInt(s.invalid_readings)} hint="range / consistency flags" />
              <MetricCard label="Telemetry gaps" value={fmtInt(s.telemetry_gaps?.gap_count)} hint={`> ${s.telemetry_gaps?.gap_threshold_sec}s · longest ${fmtDuration(s.telemetry_gaps?.longest_gap_sec)}`} />
              <MetricCard label="Est. missing packets" value={fmtInt(s.telemetry_gaps?.estimated_missing_packets)} hint="from gap lengths" />
            </div>
            <Card className="mt-4" title="Per-sensor statistics">
              <Table head={["Sensor", "Current", "Min", "Max", "Mean", "Std dev", "Trend /min", "Net change", "Missing (null)", "Invalid"]}>
                {s.sensors.map((x) => (
                  <tr key={x.key}>
                    <td className="px-3 py-2"><div className="font-medium text-slate-200">{x.label}</div><div className="text-[11px] text-slate-500">{x.unit}</div></td>
                    {[x.current, x.min, x.max, x.mean, x.std].map((v, i) => <td key={i} className="px-3 py-2 font-mono">{fmtNum(v, 2)}</td>)}
                    <td className="px-3 py-2 font-mono">{fmtNum(x.trend_slope_per_min, 3)} <Badge tone={x.trend === "rising" ? "amber" : x.trend === "falling" ? "sky" : "slate"}>{x.trend}</Badge></td>
                    <td className="px-3 py-2 font-mono">{fmtNum(x.net_change, 2)}</td>
                    <td className="px-3 py-2 font-mono">{x.missing}</td>
                    <td className="px-3 py-2 font-mono">{x.invalid}</td>
                  </tr>
                ))}
              </Table>
              <p className="mt-2 text-[11px] text-slate-500">Missing = null values sent by the firmware for unhealthy channels. Rate-of-change values are those computed on the ESP32 (EMA-filtered).</p>
            </Card>
          </>
        )}
      </Async>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card title="ESP32 risk-state distribution" subtitle={dist.data?.note}>
          <Async state={dist}>{(d) => (
            <>
              <RiskBars data={d.states} />
              <KV cols={1} items={d.states.map((x) => [<RiskBadge state={x.state} size="sm" />, `${x.count} · ~${fmtDuration(x.approx_duration_sec)}`])} />
            </>
          )}</Async>
        </Card>
        <div className="space-y-4 xl:col-span-2">
          {charts.map((c) => (
            <Card key={c.key} title={c.title} bodyClass="p-3">
              <TimeSeriesChart data={series.data?.points ?? []} series={[{ key: c.key, label: c.title.split(" vs")[0], color: c.color }]} unit={c.unit} yDomain={c.domain} height={180} />
            </Card>
          ))}
          {!sensor && (
            <Card title="Moisture, rain and tilt sub-indices together" subtitle="Separate scales are not mixed: tilt is plotted on its own chart above." bodyClass="p-3">
              <TimeSeriesChart data={series.data?.points ?? []} height={200} yDomain={[0, 100]} series={[
                { key: "moisture_index", label: "Soil Moisture Index", color: SERIES_COLORS.moisture },
                { key: "rain_index", label: "Rain Activity Index", color: SERIES_COLORS.rain },
              ]} />
            </Card>
          )}
        </div>
      </div>

      <Card className="mt-4" title="Records" subtitle="Server-side pagination, newest first">
        <Async state={rows}>{(d) => (
          <>
            <Table dense head={["Received", "Device", "Moist.", "Rain", "Tilt °", "M rate", "T rate", "Score", "State", "Health", "RSSI", "Flags"]}>
              {d.items.map((r) => (
                <tr key={r.id} className={r.is_valid ? "" : "bg-amber-500/5"}>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono">{fmtDateTime(r.received_at)}</td>
                  <td className="px-3 py-1.5 font-mono">{r.device_id} {r.is_simulated && <SimBadge />}</td>
                  {[r.moisture_index, r.rain_index, r.tilt_change_deg, r.moisture_rate_per_min, r.tilt_rate_deg_per_min, r.weighted_score].map((v, i) => (
                    <td key={i} className="px-3 py-1.5 font-mono">{v === null ? <span className="text-violet-300">null</span> : fmtNum(v, 2)}</td>
                  ))}
                  <td className="px-3 py-1.5"><RiskBadge state={r.esp32_risk_state} size="sm" /></td>
                  <td className="px-3 py-1.5">{r.sensor_health}</td>
                  <td className="px-3 py-1.5 font-mono">{r.wifi_rssi ?? "—"}</td>
                  <td className="px-3 py-1.5 text-amber-300">{r.quality_flags.join(", ")}</td>
                </tr>
              ))}
            </Table>
            <Pagination page={d.page} pages={d.pages} total={d.total} onPage={setPage} />
          </>
        )}</Async>
      </Card>
    </>
  );
}
