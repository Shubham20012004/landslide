import { BellRing, Check, CheckCheck, Filter } from "lucide-react";
import { useState } from "react";
import { Async, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Pagination, Select, SeverityBadge, SimBadge, Table, Tabs, Toggle } from "../components/ui";
import { useAction, useApi } from "../hooks/useApi";
import { useRefreshMs } from "../hooks/useAppSettings";
import { api } from "../services/api";
import { fmtDateTime, humanize } from "../utils/format";

const toIso = (v: string) => (v ? new Date(v).toISOString() : undefined);

function AlertsTab() {
  const refresh = useRefreshMs();
  const devs = useApi(() => api.devices(), []);
  const [f, setF] = useState({ severity: "", alert_type: "", device_id: "", start: "", end: "", open: false, sim: true });
  const [page, setPage] = useState(1);
  const params = { severity: f.severity, alert_type: f.alert_type, device_id: f.device_id, start: toIso(f.start), end: toIso(f.end),
    acknowledged: f.open ? false : undefined, include_simulated: f.sim, page, page_size: 25 };
  const alerts = useApi(() => api.alerts(params), [JSON.stringify(params)], refresh);
  const act = useAction();
  const upd = (k: string, v: unknown) => { setF({ ...f, [k]: v }); setPage(1); };
  return (
    <>
      <Card title="Filters" icon={Filter} className="mb-4" actions={<Button size="sm" icon={CheckCheck} loading={act.busy} onClick={() => act.run(async () => { await api.ackAll(); alerts.reload(); })}>Acknowledge all</Button>}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Field label="Severity"><Select value={f.severity} onChange={(e) => upd("severity", e.target.value)}><option value="">Any</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="info">Info</option></Select></Field>
          <Field label="Type"><Select value={f.alert_type} onChange={(e) => upd("alert_type", e.target.value)}><option value="">Any</option>{alerts.data?.alert_types.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</Select></Field>
          <Field label="Device"><Select value={f.device_id} onChange={(e) => upd("device_id", e.target.value)}><option value="">Any</option>{devs.data?.devices.map((d) => <option key={d.device_id}>{d.device_id}</option>)}</Select></Field>
          <Field label="From"><Input type="datetime-local" value={f.start} onChange={(e) => upd("start", e.target.value)} /></Field>
          <Field label="To"><Input type="datetime-local" value={f.end} onChange={(e) => upd("end", e.target.value)} /></Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-5">
          <Toggle checked={f.open} onChange={(v) => upd("open", v)} label="Unacknowledged only" />
          <Toggle checked={f.sim} onChange={(v) => upd("sim", v)} label="Include simulated (Demo Mode) alerts" />
        </div>
      </Card>
      <Async state={alerts}>{(d) => d.items.length === 0 ? <Card><EmptyState icon={BellRing} title="No alerts match">Alerts are created only on transitions (state change, fault start/clear, gap, offline/reconnect) — not for every packet.</EmptyState></Card> : (
        <Card>
          <Table head={["Time", "Severity", "Type", "Device", "Alert", "Status", ""]}>
            {d.items.map((a) => (
              <tr key={a.id} className={a.acknowledged ? "opacity-60" : ""}>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{fmtDateTime(a.created_at)}</td>
                <td className="px-3 py-2"><SeverityBadge severity={a.severity} /></td>
                <td className="px-3 py-2 text-xs">{humanize(a.alert_type)}</td>
                <td className="px-3 py-2 font-mono text-xs">{a.device_id ?? "—"} {a.is_simulated && <SimBadge />}</td>
                <td className="px-3 py-2"><div className="text-slate-200">{a.title}</div><div className="text-xs text-slate-500">{a.message}</div></td>
                <td className="px-3 py-2">{a.acknowledged ? <Badge tone="green">ack</Badge> : <Badge tone="amber">open</Badge>}</td>
                <td className="px-3 py-2 text-right">{!a.acknowledged && <Button size="sm" icon={Check} onClick={() => act.run(async () => { await api.ackAlert(a.id); alerts.reload(); })}>Ack</Button>}</td>
              </tr>
            ))}
          </Table>
          <Pagination page={d.page} pages={Math.ceil(d.total / d.page_size)} total={d.total} onPage={setPage} />
        </Card>
      )}</Async>
    </>
  );
}

function EventsTab() {
  const [f, setF] = useState({ category: "", event_type: "", severity: "", start: "", end: "" });
  const [page, setPage] = useState(1);
  const params = { category: f.category, event_type: f.event_type, severity: f.severity, start: toIso(f.start), end: toIso(f.end), page, page_size: 30 };
  const ev = useApi(() => api.events(params), [JSON.stringify(params)], 8000);
  const upd = (k: string, v: string) => { setF({ ...f, [k]: v }); setPage(1); };
  return (
    <>
      <Card title="Filters" icon={Filter} className="mb-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Field label="Category"><Select value={f.category} onChange={(e) => upd("category", e.target.value)}><option value="">Any</option>{["device", "dataset", "ml", "system", "demo"].map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Field label="Event type"><Select value={f.event_type} onChange={(e) => upd("event_type", e.target.value)}><option value="">Any</option>{ev.data?.event_types.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</Select></Field>
          <Field label="Severity"><Select value={f.severity} onChange={(e) => upd("severity", e.target.value)}><option value="">Any</option><option>info</option><option>warning</option></Select></Field>
          <Field label="From"><Input type="datetime-local" value={f.start} onChange={(e) => upd("start", e.target.value)} /></Field>
          <Field label="To"><Input type="datetime-local" value={f.end} onChange={(e) => upd("end", e.target.value)} /></Field>
        </div>
      </Card>
      <Async state={ev}>{(d) => d.items.length === 0 ? <Card><EmptyState title="No events" /></Card> : (
        <Card>
          <Table dense head={["Time", "Category", "Event", "Severity", "Message"]}>
            {d.items.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap px-3 py-1.5 font-mono">{fmtDateTime(e.created_at)}</td>
                <td className="px-3 py-1.5"><Badge>{e.category}</Badge></td>
                <td className="px-3 py-1.5">{humanize(e.event_type)}</td>
                <td className="px-3 py-1.5"><SeverityBadge severity={e.severity} /></td>
                <td className="px-3 py-1.5 text-slate-300">{e.message}</td>
              </tr>
            ))}
          </Table>
          <Pagination page={d.page} pages={Math.ceil(d.total / d.page_size)} total={d.total} onPage={setPage} />
        </Card>
      )}</Async>
    </>
  );
}

export default function AlertsEvents() {
  const [tab, setTab] = useState<"alerts" | "events">("alerts");
  return (
    <>
      <PageHeader icon={BellRing} title="Alerts & Event Logs" subtitle="Alerts: risk-state changes, sensor faults, missing telemetry, disconnection and reconnection. Events: audit log of uploads, training, model activation and system actions." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "alerts", label: "Alerts" }, { value: "events", label: "System event log" }]} />
      {tab === "alerts" ? <AlertsTab /> : <EventsTab />}
    </>
  );
}
