import {
  Activity,
  BellRing,
  BrainCircuit,
  Clock,
  CloudRain,
  Cpu,
  Database,
  Droplets,
  Gauge,
  HeartPulse,
  LayoutDashboard,
  Rows3,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Triangle,
  Wifi,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RiskTimeline, ScoreGauge } from "../charts";
import { DeviceSelect, defaultDevice, ExplanationPanel, SensorChartGrid } from "../components/monitoring";
import { Badge, Button, Card, EmptyState, HealthBadge, MetricCard, Notice, PageHeader, RiskBadge, SeverityBadge, SimBadge, StatusDot } from "../components/ui";
import { useApi } from "../hooks/useApi";
import { useAppSettings, useRefreshMs } from "../hooks/useAppSettings";
import { api } from "../services/api";
import { fmtAgo, fmtDateTime, fmtInt, fmtNum, fmtTime, riskColor } from "../utils/format";

export default function Overview() {
  const refresh = useRefreshMs();
  const { settings } = useAppSettings();
  const summary = useApi(() => api.summary(), [], refresh);
  const devices = summary.data?.devices ?? [];
  const [device, setDevice] = useState("");
  useEffect(() => {
    if (!device && devices.length) setDevice(defaultDevice(devices));
  }, [devices, device]);

  const latest = useApi(() => api.latest(device || undefined), [device], refresh);
  const series = useApi(() => api.series({ device_id: device || undefined, window: "1h", max_points: settings?.chart_max_points ?? 500 }), [device, settings?.chart_max_points], refresh);
  const alerts = useApi(() => api.alerts({ page_size: 6 }), [], refresh * 2);
  const events = useApi(() => api.events({ page_size: 6 }), [], refresh * 3);
  const hist = useApi(() => api.datasets("historical"), [], 30000);

  const s = summary.data;
  const r = latest.data?.reading;
  const dev = latest.data?.device;
  const points = series.data?.points ?? [];

  if (s && s.total_readings === 0) {
    return (
      <>
        <PageHeader icon={LayoutDashboard} title="Overview Dashboard" subtitle="Live state of the miniature-slope prototype, history, alerts and AI status." />
        <Card>
          <EmptyState icon={Activity} title="No sensor readings received yet"
            action={<div className="flex flex-wrap justify-center gap-2"><Link to="/system"><Button>ESP32 connection guide</Button></Link><Link to="/live"><Button variant="primary" icon={Sparkles}>Start Demo Mode</Button></Link></div>}>
            Flash the firmware with this computer's LAN IP in <code>BACKEND_ENDPOINT</code> and power the ESP32; readings appear here automatically.
            Without hardware, use the clearly-labelled Demo Mode on the Live Monitoring page.
          </EmptyState>
        </Card>
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <MetricCard label="Historical datasets" value={s.datasets.historical} icon={Database} />
          <MetricCard label="Experimental datasets" value={s.datasets.experimental} icon={Database} />
          <MetricCard label="Trained models" value={s.models_total} icon={BrainCircuit} />
          <MetricCard label="Active ML model" value={s.active_model ? `v${s.active_model.version}` : "None"} icon={BrainCircuit} tone={s.active_model ? undefined : "muted"} />
        </div>
      </>
    );
  }

  const t = settings?.analysis_thresholds;
  const state = dev?.online ? r?.esp32_risk_state : null;
  return (
    <>
      <PageHeader
        icon={LayoutDashboard}
        title="Overview Dashboard"
        subtitle="ESP32 rule-based state is authoritative for the local system. Indices are normalised prototype measurements, not calibrated physical quantities."
        actions={devices.length > 0 && <DeviceSelect devices={devices} value={device} onChange={setDevice} />}
      />
      {r?.is_simulated && <Notice tone="sim" className="mb-4" title="Showing SIMULATED data">This device's readings are flagged SIMULATED (Demo Mode or the HTTP test client) and are not measurements from the physical prototype.</Notice>}
      {dev && !dev.online && (
        <Notice tone="warning" className="mb-4" title={`${dev.device_id} is offline`}>
          No telemetry for {fmtAgo(dev.last_seen)} (timeout {dev.offline_timeout_sec}s). Values below are the last received reading, not live values. The ESP32's local LEDs/buzzer continue independently of Wi-Fi.
        </Notice>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
        <Card title="Current ESP32 risk state" icon={ShieldAlert} bodyClass="flex flex-col items-center gap-2 py-5">
          <div className="rounded-xl px-6 py-3 text-center" style={{ background: `${riskColor(state)}14`, border: `1px solid ${riskColor(state)}55` }}>
            <div className="text-3xl font-bold tracking-wide" style={{ color: riskColor(state) }}>{state ? state.replace("_", " ") : dev ? "OFFLINE" : "—"}</div>
            <div className="mt-0.5 text-[11px] text-slate-400">prototype category · not an official warning level</div>
          </div>
          {!dev?.online && r && <div className="text-xs text-slate-500">Last reported: <RiskBadge state={r.esp32_risk_state} size="sm" /></div>}
          <ScoreGauge value={r?.weighted_score} state={r?.esp32_risk_state} cutoffs={t ? [t.score_cutoffs.watch, t.score_cutoffs.warning, t.score_cutoffs.critical] : undefined} />
          <div className="text-center text-[11px] text-slate-500">Prototype weighted score (0.40 moisture + 0.30 rain + 0.30 tilt). Not a landslide probability.</div>
        </Card>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
          <MetricCard label="Weighted Risk Score" value={fmtNum(r?.weighted_score, 1)} unit="/100" icon={Gauge} accent={riskColor(r?.esp32_risk_state)} />
          <MetricCard label="Soil Moisture Index" value={fmtNum(r?.moisture_index, 1)} unit="/100" icon={Droplets} hint={r && r.moisture_index === null ? "channel unhealthy" : undefined} />
          <MetricCard label="Rain Activity Index" value={fmtNum(r?.rain_index, 1)} unit="/100" icon={CloudRain} hint={r && r.rain_index === null ? "channel unhealthy" : undefined} />
          <MetricCard label="Slope Tilt Change" value={fmtNum(r?.tilt_change_deg, 2)} unit="°" icon={Triangle} hint={r && r.tilt_change_deg === null ? "MPU6050 unhealthy" : "relative to baseline"} />
          <MetricCard label="Moisture Rate" value={fmtNum(r?.moisture_rate_per_min, 2)} unit="%-pts/min" icon={TrendingUp} />
          <MetricCard label="Tilt Rate" value={fmtNum(r?.tilt_rate_deg_per_min, 2)} unit="°/min" icon={TrendingUp} />
          <MetricCard label="Sensor Health" value={<HealthBadge health={r?.sensor_health} />} icon={HeartPulse} hint={r?.fault_reason || undefined} />
          <MetricCard label="ESP32 Connection" value={<StatusDot online={dev ? dev.online : null} label={dev ? (dev.online ? "Online" : "Offline") : "—"} />} icon={Wifi} hint={dev?.wifi_rssi != null ? `RSSI ${dev.wifi_rssi} dBm` : undefined} />
          <MetricCard label="Last Telemetry" value={<span className="text-lg">{fmtTime(r?.received_at)}</span>} icon={Clock} hint={fmtAgo(r?.received_at)} />
          <MetricCard label="Active ML Model" value={s?.active_model ? `v${s.active_model.version}` : "None"} tone={s?.active_model ? undefined : "muted"} icon={BrainCircuit}
            hint={s?.active_model ? (s.active_model.is_synthetic ? "trained on SYNTHETIC data" : s.active_model.name) : <Link className="text-sky-400" to="/training">Train a model</Link>} />
          <MetricCard label="Total Readings" value={fmtInt(s?.total_readings)} icon={Rows3} hint={s ? `${fmtInt(s.real_readings)} real · ${fmtInt(s.simulated_readings)} simulated` : undefined} />
          <MetricCard label="Open Alerts" value={fmtInt(s?.alerts_unacknowledged)} icon={BellRing} hint={`${s?.alerts_last_24h ?? 0} in last 24 h`} />
        </div>
      </div>

      <Card className="mt-4" title="Risk state timeline (last hour)" subtitle={series.data ? `${series.data.n_readings} readings${series.data.downsampled ? " · bucketed, most severe state kept" : ""}` : undefined}>
        <RiskTimeline data={points} />
      </Card>

      <div className="mt-4">
        <SensorChartGrid points={points} thresholds={t} height={180} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        {latest.data?.reading && <ExplanationPanel latest={latest.data} />}
        <Card title="Recent alerts" icon={BellRing} actions={<Link to="/alerts" className="text-xs text-sky-400">View all</Link>}>
          {alerts.data?.items.length ? (
            <ul className="space-y-2">
              {alerts.data.items.map((a) => (
                <li key={a.id} className="flex items-start gap-2 text-sm">
                  <SeverityBadge severity={a.severity} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-slate-200">{a.title}</div>
                    <div className="text-[11px] text-slate-500">{fmtDateTime(a.created_at)} · {a.device_id ?? "system"} {a.is_simulated && "· simulated"}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No alerts" />}
        </Card>
        <Card title="Latest readings" icon={Activity} actions={<Link to="/analytics" className="text-xs text-sky-400">Analytics</Link>}>
          {points.length ? (
            <table className="w-full text-xs">
              <thead className="text-left text-slate-500"><tr><th className="pb-1">Time</th><th>Moist.</th><th>Rain</th><th>Tilt°</th><th>State</th></tr></thead>
              <tbody className="font-mono text-slate-300">
                {points.slice(-7).reverse().map((p) => (
                  <tr key={p.t} className="border-t border-line/50"><td className="py-1">{fmtTime(p.t)}</td><td>{fmtNum(p.moisture_index, 1)}</td><td>{fmtNum(p.rain_index, 1)}</td><td>{fmtNum(p.tilt_change_deg, 2)}</td><td><RiskBadge state={p.esp32_risk_state} size="sm" /></td></tr>
                ))}
              </tbody>
            </table>
          ) : <EmptyState title="No readings in the last hour" />}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card title="Device health" icon={Cpu} actions={<Link to="/devices" className="text-xs text-sky-400">Details</Link>}>
          <ul className="space-y-2 text-sm">
            {devices.slice(0, 4).map((d) => (
              <li key={d.device_id} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2"><StatusDot online={d.online} /><span className="truncate font-mono text-xs">{d.device_id}</span>{d.is_simulated && <SimBadge />}</span>
                <HealthBadge health={d.last_sensor_health} />
              </li>
            ))}
          </ul>
        </Card>
        <Card title="ML model status" icon={BrainCircuit} actions={<Link to="/evaluation" className="text-xs text-sky-400">Registry</Link>}>
          <div className="space-y-1 text-sm text-slate-300">
            <div>{s?.models_total ?? 0} trained model(s)</div>
            {s?.active_model ? (
              <div className="flex flex-wrap items-center gap-1">Active: <b>v{s.active_model.version}</b> {s.active_model.is_synthetic && <Badge tone="violet">synthetic</Badge>}</div>
            ) : <div className="text-slate-500">No model active — predictions disabled.</div>}
          </div>
        </Card>
        <Card title="Dataset status" icon={Database} actions={<Link to="/datasets" className="text-xs text-sky-400">Manage</Link>}>
          <div className="space-y-1 text-sm text-slate-300">
            <div>{s?.datasets.historical ?? 0} historical (event-level)</div>
            <div>{s?.datasets.experimental ?? 0} experimental (sensor)</div>
            {s?.active_experiment_id && <div className="text-xs text-amber-300">Recording experiment: {s.active_experiment_id}</div>}
          </div>
        </Card>
        <Card title="Historical data summary" icon={Database} actions={<Link to="/historical" className="text-xs text-sky-400">Explore</Link>}>
          {hist.data?.datasets.length ? (
            <div className="space-y-1 text-sm text-slate-300">
              <div className="truncate font-medium">{hist.data.datasets[0].name} v{hist.data.datasets[0].version}</div>
              <div>{fmtInt(hist.data.datasets[0].n_rows)} recorded events · {hist.data.datasets[0].n_columns} columns</div>
              <div className="text-[11px] text-slate-500">Event records, not sensor data</div>
            </div>
          ) : <div className="text-sm text-slate-500">No historical catalogue uploaded.</div>}
        </Card>
      </div>

      <Card className="mt-4" title="Recent system events" actions={<Link to="/alerts" className="text-xs text-sky-400">Event log</Link>}>
        {events.data?.items.length ? (
          <ul className="divide-y divide-line/50 text-sm">
            {events.data.items.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="w-36 shrink-0 font-mono text-[11px] text-slate-500">{fmtDateTime(e.created_at)}</span>
                <Badge>{e.category}</Badge>
                <span className="min-w-0 flex-1 text-slate-300">{e.message}</span>
              </li>
            ))}
          </ul>
        ) : <EmptyState title="No events" />}
      </Card>
    </>
  );
}
