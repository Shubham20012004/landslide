import { Cpu, RotateCw, Wifi, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { RiskTimeline, TimeSeriesChart } from "../charts";
import { Async, Badge, Card, EmptyState, HealthBadge, KV, MetricCard, Notice, PageHeader, RiskBadge, Segmented, SimBadge, StatusDot, Table } from "../components/ui";
import { useApi } from "../hooks/useApi";
import { useRefreshMs } from "../hooks/useAppSettings";
import { api } from "../services/api";
import { fmtAgo, fmtDateTime, fmtDuration, fmtInt, rssiQuality, SERIES_COLORS } from "../utils/format";

export default function DeviceHealth() {
  const refresh = useRefreshMs();
  const devs = useApi(() => api.devices(), [], refresh);
  const [sel, setSel] = useState("");
  const [win, setWin] = useState<"1h" | "6h" | "24h" | "7d">("1h");
  useEffect(() => { if (!sel && devs.data?.devices.length) setSel(devs.data.devices[0].device_id); }, [devs.data, sel]);
  const health = useApi(() => api.deviceHealth(sel, win), [sel, win], refresh, !!sel);

  return (
    <>
      <PageHeader icon={Cpu} title="Device Health" subtitle={`A device is online only if telemetry arrived within the configured timeout (${devs.data?.offline_timeout_sec ?? "—"} s). Stored history alone never marks a device online.`} />
      <Card title="Devices">
        <Async state={devs}>{(d) => d.devices.length === 0 ? <EmptyState icon={Cpu} title="No device has sent telemetry yet" /> : (
          <Table head={["Device", "Connection", "Last received", "RSSI", "Uptime", "Last state", "Sensor health", "Readings", "Reboots"]}>
            {d.devices.map((x) => (
              <tr key={x.device_id} onClick={() => setSel(x.device_id)} className={`cursor-pointer ${sel === x.device_id ? "bg-sky-500/5" : "hover:bg-ink-750/50"}`}>
                <td className="px-3 py-2 font-mono text-xs">{x.device_id} {x.is_simulated && <SimBadge />}</td>
                <td className="px-3 py-2"><StatusDot online={x.online} label={x.online ? "online" : "offline"} /></td>
                <td className="px-3 py-2 text-xs">{fmtDateTime(x.last_seen)}<div className="text-slate-500">{fmtAgo(x.last_seen)}</div></td>
                <td className="px-3 py-2 font-mono text-xs" style={{ color: rssiQuality(x.wifi_rssi).color }}>{x.wifi_rssi ?? "—"} dBm</td>
                <td className="px-3 py-2 text-xs">{fmtDuration(x.uptime_sec)}</td>
                <td className="px-3 py-2"><RiskBadge state={x.last_risk_state} size="sm" /></td>
                <td className="px-3 py-2"><HealthBadge health={x.last_sensor_health} /></td>
                <td className="px-3 py-2 font-mono">{fmtInt(x.total_readings)}</td>
                <td className="px-3 py-2 font-mono">{x.reboot_count}</td>
              </tr>
            ))}
          </Table>
        )}</Async>
      </Card>

      {sel && (
        <div className="mt-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-mono text-sm text-slate-300">{sel}</h2>
            <Segmented value={win} onChange={setWin} options={[{ value: "1h", label: "1 h" }, { value: "6h", label: "6 h" }, { value: "24h", label: "24 h" }, { value: "7d", label: "7 d" }]} />
          </div>
          <Async state={health}>{(h) => {
            const q = rssiQuality(h.device.wifi_rssi);
            return (
              <>
                {h.device.last_fault_reason && <Notice tone="danger" className="mb-3" title={`Last fault: ${h.device.last_sensor_health}`}>{h.device.last_fault_reason}</Notice>}
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
                  <MetricCard label="Connection" value={<span className="flex items-center gap-2 text-base">{h.device.online ? <Wifi size={18} className="text-green-400" /> : <WifiOff size={18} className="text-red-400" />}{h.device.connection_status}</span>} hint={`last ${fmtAgo(h.device.last_seen)}`} />
                  <MetricCard label="Wi-Fi RSSI" value={h.device.wifi_rssi ?? "—"} unit="dBm" hint={<span style={{ color: q.color }}>{q.label}</span>} />
                  <MetricCard label="Uptime" value={<span className="text-base">{fmtDuration(h.device.uptime_sec)}</span>} hint={<span className="flex items-center gap-1"><RotateCw size={11} /> {h.device.reboot_count} reboot(s)</span>} />
                  <MetricCard label="Sensor health" value={<HealthBadge health={h.device.last_sensor_health} />} />
                  <MetricCard label="Total readings" value={fmtInt(h.totals.readings)} />
                  <MetricCard label="Invalid readings" value={fmtInt(h.totals.invalid_readings)} />
                  <MetricCard label="Degraded-health readings" value={fmtInt(h.totals.degraded_health_readings)} />
                  <MetricCard label={`Gaps (${win})`} value={fmtInt(h.telemetry_gaps.gap_count)} hint={`~${h.telemetry_gaps.estimated_missing_packets} packets missing`} />
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <Card title="Wi-Fi RSSI history" subtitle="Higher (less negative) is better; below −80 dBm packets may drop." bodyClass="p-3">
                    <TimeSeriesChart data={h.history} series={[{ key: "wifi_rssi", label: "RSSI", color: SERIES_COLORS.moisture }]} unit="dBm" height={200} thresholds={[{ y: -80, label: "weak", color: "#d03b3b" }]} />
                  </Card>
                  <Card title="Telemetry history (risk state)">
                    <RiskTimeline data={h.history} />
                    <div className="mt-4">
                      <KV items={[
                        ["Readings in window", fmtInt(h.window_readings)],
                        ["Gap threshold", `${h.telemetry_gaps.gap_threshold_sec}s`],
                        ["Longest gap", fmtDuration(h.telemetry_gaps.longest_gap_sec)],
                        ["First seen", fmtDateTime(h.device.first_seen)],
                        ["Null moisture values", fmtInt(h.totals.missing_channel_values.moisture_index)],
                        ["Null rain values", fmtInt(h.totals.missing_channel_values.rain_index)],
                        ["Null tilt values", fmtInt(h.totals.missing_channel_values.tilt_change_deg)],
                      ]} />
                    </div>
                  </Card>
                </div>
                <Card className="mt-4" title="Recent sensor faults">
                  {h.recent_faults.length === 0 ? <EmptyState title="No degraded-health readings recorded" /> : (
                    <Table dense head={["Time", "Health", "Fault reason"]}>
                      {h.recent_faults.map((f, i) => <tr key={i}><td className="px-3 py-1.5 font-mono">{fmtDateTime(f.received_at)}</td><td className="px-3 py-1.5"><Badge tone="violet">{f.sensor_health}</Badge></td><td className="px-3 py-1.5">{f.fault_reason}</td></tr>)}
                    </Table>
                  )}
                </Card>
              </>
            );
          }}</Async>
        </div>
      )}
    </>
  );
}
