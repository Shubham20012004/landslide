import { Activity, Braces, CircleStop, Download, FlaskConical, Pause, Play, Sparkles, Trash2, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { RiskTimeline } from "../charts";
import { DeviceSelect, defaultDevice, ExplanationPanel, SensorChartGrid } from "../components/monitoring";
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, Field, HealthBadge, Input, MetricCard, Modal, Notice, PageHeader, RiskBadge, Segmented, Select, SimBadge,
} from "../components/ui";
import { useAction, useApi } from "../hooks/useApi";
import { useAppSettings, useRefreshMs } from "../hooks/useAppSettings";
import { api } from "../services/api";
import { fmtAgo, fmtDateTime, fmtDuration, fmtNum, rssiQuality } from "../utils/format";

const WINDOWS = [
  { value: "1m", label: "1 min" },
  { value: "5m", label: "5 min" },
  { value: "15m", label: "15 min" },
  { value: "1h", label: "1 hour" },
  { value: "24h", label: "24 hours" },
] as const;
type Win = (typeof WINDOWS)[number]["value"];

function DemoPanel() {
  const { demo, refreshDemo } = useAppSettings();
  const [scenario, setScenario] = useState("heavy_rain");
  const [speed, setSpeed] = useState(1);
  const [purge, setPurge] = useState(false);
  const act = useAction();
  const sc = demo?.scenarios.find((s) => s.key === scenario);
  return (
    <Card title="Demo Mode (no hardware)" icon={Sparkles} subtitle="Generates SIMULATED telemetry through the same ingestion path, using a software port of the firmware risk logic.">
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_110px]">
          <Field label="Scenario" hint={sc?.description}>
            <Select value={scenario} onChange={(e) => setScenario(e.target.value)} disabled={demo?.running}>
              {demo?.scenarios.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </Select>
          </Field>
          <Field label="Speed">
            <Select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} disabled={demo?.running}>
              {[1, 2, 4].map((v) => <option key={v} value={v}>×{v}{v === 1 ? " (real time)" : ""}</option>)}
            </Select>
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          {demo?.running ? (
            <Button variant="danger" icon={CircleStop} loading={act.busy} onClick={() => act.run(async () => { await api.demoStop(); await refreshDemo(); })}>Stop demo</Button>
          ) : (
            <Button variant="primary" icon={Play} loading={act.busy} onClick={() => act.run(async () => { await api.demoStart(scenario, speed); await refreshDemo(); })}>Start scenario</Button>
          )}
          <Button icon={Trash2} onClick={() => setPurge(true)}>Delete simulated data</Button>
        </div>
        {demo?.running && <div className="text-xs text-violet-300">Running “{demo.scenario_label}” · {demo.posts} simulated packets · last state {demo.last_state ?? "—"}</div>}
        {act.error && <Notice tone="danger">{act.error}</Notice>}
      </div>
      <ConfirmDialog open={purge} title="Delete all simulated data?" danger confirmLabel="Delete simulated data" busy={act.busy}
        onCancel={() => setPurge(false)}
        onConfirm={() => act.run(async () => { const r = await api.demoPurge(); await refreshDemo(); setPurge(false); alert(`Deleted ${r.readings} simulated readings, ${r.alerts} alerts, ${r.devices} device(s).`); })}>
        This removes every reading, alert and device flagged as SIMULATED. Real ESP32 readings are not affected. This cannot be undone.
      </ConfirmDialog>
    </Card>
  );
}

function ExperimentPanel() {
  const exp = useApi(() => api.experiments(), [], 8000);
  const [id, setId] = useState("");
  const act = useAction();
  const active = exp.data?.active_experiment_id;
  return (
    <Card title="Experiment session" icon={FlaskConical} subtitle="Tag incoming readings with an experiment/run ID so ML training can split by experiment (prevents leakage).">
      {active ? (
        <div className="space-y-2">
          <div className="text-sm text-amber-200">Recording into <b className="font-mono">{active}</b></div>
          <Button icon={CircleStop} loading={act.busy} onClick={() => act.run(async () => { await api.stopExperiment(); exp.reload(); })}>Stop session</Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Input placeholder="e.g. RUN-01-heavy-rain" value={id} onChange={(e) => setId(e.target.value)} />
          <Button variant="primary" disabled={!id.trim()} loading={act.busy} onClick={() => act.run(async () => { await api.startExperiment(id.trim()); setId(""); exp.reload(); })}>Start</Button>
        </div>
      )}
      {act.error && <Notice tone="danger" className="mt-2">{act.error}</Notice>}
      {!!exp.data?.experiments.length && (
        <div className="mt-3 text-xs text-slate-400">Recorded: {exp.data.experiments.map((e) => `${e.experiment_id} (${e.readings})`).join(", ")}</div>
      )}
    </Card>
  );
}

export default function LiveMonitoring() {
  const defaultRefresh = useRefreshMs();
  const { settings } = useAppSettings();
  const devs = useApi(() => api.devices(), [], 5000);
  const devices = devs.data?.devices ?? [];
  const [device, setDevice] = useState("");
  const [win, setWin] = useState<Win>("15m");
  const [paused, setPaused] = useState(false);
  const [refresh, setRefresh] = useState<number | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const interval = paused ? null : refresh ?? defaultRefresh;
  useEffect(() => {
    if (!device && devices.length) setDevice(defaultDevice(devices));
  }, [devices, device]);

  const latest = useApi(() => api.latest(device || undefined), [device], interval);
  const series = useApi(() => api.series({ device_id: device || undefined, window: win, max_points: settings?.chart_max_points ?? 500 }), [device, win, settings?.chart_max_points], interval);
  const r = latest.data?.reading;
  const dev = devices.find((d) => d.device_id === device) ?? latest.data?.device ?? null;
  const expected = settings?.expected_telemetry_interval_sec ?? 4;
  const gapLimit = expected * (settings?.telemetry_gap_factor ?? 2.5);
  const age = dev?.seconds_since_last_seen ?? null;
  const missing = dev && age !== null && age > gapLimit && dev.online;
  const rssi = rssiQuality(r?.wifi_rssi);

  return (
    <>
      <PageHeader
        icon={Activity}
        title="Live Monitoring"
        subtitle="Readings exactly as reported by the ESP32 (server timestamp added on receipt). Null values mean the firmware marked that channel unhealthy."
        actions={
          <>
            <DeviceSelect devices={devices} value={device} onChange={setDevice} />
            <Select value={refresh ?? ""} onChange={(e) => setRefresh(e.target.value ? Number(e.target.value) : null)} className="w-auto" aria-label="Refresh interval">
              <option value="">Refresh: settings ({defaultRefresh / 1000}s)</option>
              {[1000, 2000, 4000, 10000, 30000].map((v) => <option key={v} value={v}>Refresh every {v / 1000}s</option>)}
            </Select>
            <Button icon={paused ? Play : Pause} variant={paused ? "primary" : "secondary"} onClick={() => setPaused((p) => !p)}>{paused ? "Resume" : "Pause"}</Button>
            <a href={api.exportUrl({ device_id: device || undefined, window: win })}><Button icon={Download}>CSV</Button></a>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented options={WINDOWS.map((w) => ({ value: w.value, label: w.label }))} value={win} onChange={setWin} />
        {paused && <Badge tone="amber">Visual updates paused — telemetry is still being stored</Badge>}
        {latest.lastUpdated && !paused && <span className="text-xs text-slate-500">Updated {fmtAgo(new Date(latest.lastUpdated).toISOString())}</span>}
      </div>

      {!devices.length && !devs.loading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_380px]">
          <Card><EmptyState icon={WifiOff} title="Waiting for the first telemetry packet">The ESP32 posts to <code>POST /api/reading</code> every ~4 s. Or start a Demo Mode scenario.</EmptyState></Card>
          <div className="space-y-4"><DemoPanel /><ExperimentPanel /></div>
        </div>
      ) : (
        <>
          {r?.is_simulated && <Notice tone="sim" className="mb-3" title="SIMULATED telemetry">This reading is flagged SIMULATED (Demo Mode or the HTTP test client). Values are not measured by the prototype.</Notice>}
          {dev && !dev.online && <Notice tone="warning" className="mb-3" title="Device offline">No telemetry for {fmtAgo(dev.last_seen)} (offline timeout {dev.offline_timeout_sec}s). The values shown are the last received reading.</Notice>}
          {missing && <Notice tone="warning" className="mb-3" title="Missing telemetry">No packet for {fmtDuration(age)} — expected every ~{expected}s. Check Wi-Fi signal or backend reachability.</Notice>}
          {r && r.sensor_health !== "OK" && <Notice tone="danger" className="mb-3" title={`Sensor fault: ${r.sensor_health}`}>{r.fault_reason || "No fault reason reported."} The firmware sends null for unhealthy channels and never reports degraded data as SAFE.</Notice>}
          {r && !r.is_valid && <Notice tone="warning" className="mb-3" title="Reading flagged invalid">Quality flags: {r.quality_flags.join(", ")}. Stored unchanged for traceability.</Notice>}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <MetricCard label="ESP32 State" value={<RiskBadge state={r?.esp32_risk_state} size="lg" />} />
            <MetricCard label="Weighted Score" value={fmtNum(r?.weighted_score, 1)} unit="/100" />
            <MetricCard label="Soil Moisture" value={fmtNum(r?.moisture_index, 1)} unit="idx" hint={r?.moisture_index === null ? <Badge tone="violet">null · unhealthy</Badge> : undefined} />
            <MetricCard label="Rain Activity" value={fmtNum(r?.rain_index, 1)} unit="idx" hint={r?.rain_index === null ? <Badge tone="violet">null · unhealthy</Badge> : undefined} />
            <MetricCard label="Tilt Change" value={fmtNum(r?.tilt_change_deg, 2)} unit="°" hint={r?.tilt_change_deg === null ? <Badge tone="violet">null · unhealthy</Badge> : undefined} />
            <MetricCard label="Moisture Rate" value={fmtNum(r?.moisture_rate_per_min, 2)} unit="/min" />
            <MetricCard label="Tilt Rate" value={fmtNum(r?.tilt_rate_deg_per_min, 2)} unit="°/min" />
            <MetricCard label="Sensor Health" value={<HealthBadge health={r?.sensor_health} />} />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
            <MetricCard label="Connection" value={<span className="flex items-center gap-2 text-base">{dev?.online ? <Wifi size={18} className="text-green-400" /> : <WifiOff size={18} className="text-red-400" />}{dev?.online ? "Online" : "Offline"}</span>} hint={`timeout ${dev?.offline_timeout_sec ?? "—"}s`} />
            <MetricCard label="Last received" value={<span className="text-base">{fmtDateTime(r?.received_at)}</span>} hint={fmtAgo(r?.received_at)} />
            <MetricCard label="Wi-Fi RSSI" value={r?.wifi_rssi ?? "—"} unit="dBm" hint={<span style={{ color: rssi.color }}>{rssi.label}</span>} />
            <MetricCard label="Uptime" value={<span className="text-base">{fmtDuration(r?.uptime_sec)}</span>} hint={<span className="flex items-center gap-2">reading #{r?.id ?? "—"} {r?.is_simulated && <SimBadge />} <button className="text-sky-400" onClick={() => setRawOpen(true)}><Braces size={12} className="inline" /> raw JSON</button></span>} />
          </div>

          <Card className="mt-4" title="ESP32 risk-state timeline" subtitle={series.data ? `${series.data.n_readings} readings in window${series.data.downsampled ? " · bucketed (most severe state kept)" : ""}` : undefined}>
            <RiskTimeline data={series.data?.points ?? []} />
          </Card>
          <div className="mt-4"><SensorChartGrid points={series.data?.points ?? []} thresholds={settings?.analysis_thresholds} height={200} /></div>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
            {latest.data?.reading && <ExplanationPanel latest={latest.data} />}
            <DemoPanel />
            <ExperimentPanel />
          </div>
        </>
      )}
      <Modal open={rawOpen} onClose={() => setRawOpen(false)} title="Original telemetry payload (as received)">
        <pre className="overflow-x-auto rounded-lg bg-ink-950 p-3 font-mono text-xs text-slate-300">{JSON.stringify(r?.raw_payload ?? null, null, 2)}</pre>
      </Modal>
    </>
  );
}
