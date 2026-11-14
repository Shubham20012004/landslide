import { BookOpen, Cpu, ExternalLink, Info, Network, ShieldAlert } from "lucide-react";
import { Async, Badge, Card, KV, Notice, PageHeader, Table } from "../components/ui";
import { useApi } from "../hooks/useApi";
import { api } from "../services/api";
import { fmtDateTime, fmtInt } from "../utils/format";

const FLOW = [
  { t: "Sensors", d: "Capacitive soil moisture (GPIO34) · Rain module (GPIO35) · MPU6050 (I²C 21/22)" },
  { t: "ESP32 firmware", d: "2 s sampling · EMA filtering · complementary tilt filter · 0.40/0.30/0.30 weighted score · rate overrides · local LEDs & buzzer" },
  { t: "Wi-Fi HTTP POST", d: "JSON every ~4 s to /api/reading; local alerts continue offline" },
  { t: "FastAPI + SQLite", d: "Validation · server timestamp · transition alerts · offline detection · analytics" },
  { t: "Web dashboard", d: "Live monitoring · analytics · historical intelligence · ML training & hybrid comparison" },
];

export default function SystemInfo() {
  const health = useApi(() => api.health(), [], 10000);
  const info = useApi(() => api.systemInfo(), []);
  return (
    <>
      <PageHeader icon={Info} title="System Information" subtitle="Project identity, architecture, ESP32 connection guide, software versions and scientific limitations." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Card title="Project" icon={BookOpen}>
          <h2 className="text-lg font-semibold text-slate-100">IoT-Based Multi-Parameter Landslide Risk Monitoring and AI-Assisted Early Warning System Using ESP32</h2>
          <p className="mt-1 text-sm text-slate-400">An Embedded IoT and AI-Assisted Prototype for Multi-Parameter Slope Risk Monitoring.</p>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-line bg-ink-850 p-3 text-sm">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Layer 1 · Historical intelligence</div>
              <p className="mt-1 text-slate-300">Event-level analysis of a landslide catalogue: where, when, triggers, size, casualties. Context only — not sensor training data.</p>
            </div>
            <div className="rounded-lg border border-line bg-ink-850 p-3 text-sm">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Layer 2 · Real-time embedded monitoring</div>
              <p className="mt-1 text-slate-300">Soil moisture, rain activity and slope tilt fused on the ESP32 into prototype states, with an experimental Random Forest alongside.</p>
            </div>
          </div>
          <div className="mt-4 text-xs text-slate-500">Department of Electronics and Communication Engineering, Assam University · B.Tech major project</div>
        </Card>
        <Card title="Backend status" icon={Network}>
          <Async state={health}>{(h) => (
            <KV cols={1} items={[
              ["API", <Badge tone={h.status === "ok" ? "green" : "red"}>{h.status}</Badge>],
              ["Database", <Badge tone={h.database === "ok" ? "green" : "red"}>{h.database}</Badge>],
              ["Version", h.version],
              ["Server time", fmtDateTime(h.server_time)],
              ["Demo Mode", h.demo_mode ? <Badge tone="violet">running</Badge> : "off"],
            ]} />
          )}</Async>
          <Async state={info}>{(i) => (
            <div className="mt-4">
              <KV cols={1} items={[
                ["Python", String(i.python)],
                ...Object.entries(i.libraries as Record<string, string>).map(([k, v]) => [k, v] as [string, string]),
                ["Database engine", String(i.database)],
                ["Max upload", `${i.max_upload_mb} MB`],
                ...Object.entries(i.row_counts as Record<string, number>).map(([k, v]) => [k.replace(/_/g, " "), fmtInt(v)] as [string, string]),
              ]} />
            </div>
          )}</Async>
          <a href="/api/docs" onClick={(e) => { e.preventDefault(); window.open(`${location.protocol}//${location.hostname}:8000/docs`, "_blank"); }}
            className="mt-4 inline-flex items-center gap-1 text-sm text-sky-400">Interactive API documentation (Swagger) <ExternalLink size={13} /></a>
        </Card>
      </div>

      <Card className="mt-4" title="Architecture" icon={Network}>
        <ol className="grid grid-cols-1 gap-2 md:grid-cols-5">
          {FLOW.map((f, i) => (
            <li key={f.t} className="relative rounded-lg border border-line bg-ink-850 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-sky-400">Step {i + 1}</div>
              <div className="mt-0.5 text-sm font-semibold text-slate-100">{f.t}</div>
              <p className="mt-1 text-xs text-slate-400">{f.d}</p>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-slate-500">The ESP32 rule-based state is authoritative for the local system. The Random Forest output is displayed alongside it and never overrides it.</p>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Connecting the ESP32" icon={Cpu}>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-300">
            <li>Start the backend on all interfaces: <code className="font-mono text-xs">uvicorn app.main:app --host 0.0.0.0 --port 8000</code>.</li>
            <li>Find this computer's LAN IPv4 address (Windows: <code className="font-mono text-xs">ipconfig</code>). The ESP32 and laptop must be on the same network; <code>localhost</code> will not work from the ESP32.</li>
            <li>Copy <code className="font-mono text-xs">firmware/esp32_landslide_monitor/secrets.example.h</code> to <code className="font-mono text-xs">secrets.h</code> and set your Wi-Fi SSID, password and <code className="font-mono text-xs">http://&lt;LAN-IP&gt;:8000/api/reading</code>. <code>secrets.h</code> is git-ignored.</li>
            <li>Allow inbound TCP port 8000 in Windows Defender Firewall for private networks.</li>
            <li>Flash with Board “ESP32 Dev Module”, open Serial Monitor at 115200 baud and look for <code className="font-mono text-xs">POST /api/reading -&gt; HTTP 201</code>.</li>
            <li>The device appears under Device Health within ~4 s. If telemetry stops for longer than the offline timeout it is marked offline (local LEDs/buzzer keep working).</li>
          </ol>
        </Card>
        <Card title="Telemetry contract (from the firmware)" icon={Cpu}>
          <Table dense head={["Field", "Type", "Notes"]}>
            {[
              ["device_id", "string", "e.g. esp32-slope-node-01"],
              ["moisture_index", "number | null", "0–100 normalised (null if soil ADC unhealthy)"],
              ["rain_index", "number | null", "0–100 normalised rain-plate wetness"],
              ["tilt_change_deg", "number | null", "° from boot baseline (null if MPU6050 fault)"],
              ["moisture_rate_per_min", "number | null", "EMA-filtered %-pts/min"],
              ["tilt_rate_deg_per_min", "number | null", "EMA-filtered °/min"],
              ["weighted_score", "number", "0.40·m + 0.30·r + 0.30·t sub-risks"],
              ["esp32_risk_state", "string", "SAFE/WATCH/WARNING/CRITICAL or DATA_INCOMPLETE/SENSOR_FAULT"],
              ["sensor_health", "string", "OK / DATA_INCOMPLETE / SENSOR_FAULT"],
              ["fault_reason", "string | null", "e.g. MPU6050_I2C_FAULT;"],
              ["wifi_rssi", "integer", "dBm"],
              ["uptime_sec", "integer", "seconds since boot"],
            ].map(([a, b, c]) => <tr key={a}><td className="px-3 py-1 font-mono">{a}</td><td className="px-3 py-1 font-mono text-slate-400">{b}</td><td className="px-3 py-1 text-slate-400">{c}</td></tr>)}
          </Table>
          <p className="mt-2 text-xs text-slate-500">The server adds a received timestamp and stores the original payload unchanged.</p>
        </Card>
      </div>

      <Card className="mt-4" title="Scientific limitations" icon={ShieldAlert}>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {[
            "This is an experimental miniature-slope prototype; it is not a scaled geotechnical replica of a natural slope.",
            "Soil Moisture Index and Rain Activity Index are normalised sensor indices, not calibrated volumetric water content or rainfall intensity (mm/h).",
            "Slope Tilt Change is an MPU6050 inclination change relative to a baseline; it is not a complete measurement of slope displacement.",
            "The Prototype Weighted Risk Score is not a landslide probability. Weights and thresholds are illustrative and need experimental calibration.",
            "SAFE / WATCH / WARNING / CRITICAL are prototype categories, not official geological warning classifications.",
            "Random Forest class scores are model confidence, not real-world landslide probabilities; a model trained on rule-engine labels learns those rules.",
            "Historical catalogue analysis describes recorded events; it does not validate the prototype or its thresholds.",
            "The system must not be used as the sole basis for public-safety decisions.",
          ].map((t) => <Notice key={t} tone="info">{t}</Notice>)}
        </div>
      </Card>
    </>
  );
}
