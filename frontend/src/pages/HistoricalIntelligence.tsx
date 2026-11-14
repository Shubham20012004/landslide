import { CloudRain, Columns3, Download, Filter, Globe2, RotateCcw, Skull } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ColumnChart, HBarChart } from "../charts";
import {
  Async, Badge, Button, Card, EmptyState, Field, KV, Loading, MetricCard, Modal, Notice, PageHeader, Select, Table, Toggle,
} from "../components/ui";
import { useAction, useApi } from "../hooks/useApi";
import { api, type HistFilters } from "../services/api";
import { fmtInt, fmtNum, humanize } from "../utils/format";

const EventMap = lazy(() => import("../charts/EventMap"));

function MappingEditor({ id, open, onClose, onSaved }: { id: number; open: boolean; onClose: () => void; onSaved: () => void }) {
  const opts = useApi(() => api.histOptions(id), [id, open], null, open);
  const [m, setM] = useState<Record<string, string | null>>({});
  const act = useAction();
  useEffect(() => { if (opts.data) setM(opts.data.mapping); }, [opts.data]);
  return (
    <Modal open={open} onClose={onClose} title="Column roles (detected from the actual CSV header)" wide
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={act.busy} onClick={() => act.run(async () => { await api.histMapping(id, m); onSaved(); onClose(); })}>Save mapping</Button></>}>
      <p className="mb-3 text-xs text-slate-400">Each analysis uses the column assigned to its role. Leave a role empty if the dataset has no such column — that analysis will be shown as unavailable rather than invented.</p>
      <Async state={opts}>{(o) => (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {o.roles.map((role) => (
            <Field key={role} label={humanize(role)}>
              <Select value={m[role] ?? ""} onChange={(e) => setM({ ...m, [role]: e.target.value || null })}>
                <option value="">— not available —</option>
                {o.columns.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
          ))}
        </div>
      )}</Async>
      {act.error && <Notice tone="danger" className="mt-3">{act.error}</Notice>}
    </Modal>
  );
}

export default function HistoricalIntelligence() {
  const list = useApi(() => api.datasets("historical"), []);
  const [id, setId] = useState<number | null>(null);
  useEffect(() => { if (id === null && list.data?.datasets.length) setId(list.data.datasets[0].id); }, [list.data, id]);
  const [f, setF] = useState<HistFilters>({});
  const [mapOpen, setMapOpen] = useState(false);
  const [rev, setRev] = useState(0);
  const key = JSON.stringify(f);
  const opts = useApi(() => api.histOptions(id!), [id, rev], null, id !== null);
  const an = useApi(() => api.histAnalytics(id!, f), [id, key, rev], null, id !== null);
  const map = useApi(() => api.histMap(id!, f), [id, key, rev], null, id !== null);
  const set = (k: keyof HistFilters, v: string | number | boolean) =>
    setF((p) => ({ ...p, [k]: v === "" || v === false ? undefined : v }) as HistFilters);
  const years = useMemo(() => {
    const o = opts.data;
    if (!o?.year_min) return [];
    return Array.from({ length: o.year_max! - o.year_min + 1 }, (_, i) => o.year_min! + i);
  }, [opts.data]);

  if (list.data && !list.data.datasets.length) {
    return (
      <>
        <PageHeader icon={Globe2} title="Historical Landslide Intelligence" />
        <Card><EmptyState icon={Globe2} title="No historical dataset uploaded"
          action={<Link to="/datasets"><Button variant="primary">Upload a historical catalogue</Button></Link>}>
          Upload an event-level CSV such as the NASA Global Landslide Catalog (category “Historical”). Its columns are inspected on upload; nothing is assumed.
        </EmptyState></Card>
      </>
    );
  }

  const a = an.data;
  return (
    <>
      <PageHeader icon={Globe2} title="Historical Landslide Intelligence"
        subtitle="Event-level analysis of a historical catalogue. These are recorded events, not sensor measurements, and they do not validate the miniature-slope prototype."
        actions={<>
          <Select value={id ?? ""} onChange={(e) => { setId(Number(e.target.value)); setF({}); }} className="w-auto min-w-[220px]">
            {list.data?.datasets.map((d) => <option key={d.id} value={d.id}>{d.name} v{d.version} ({fmtInt(d.n_rows)} rows)</option>)}
          </Select>
          <Button icon={Columns3} onClick={() => setMapOpen(true)} disabled={id === null}>Column roles</Button>
          {id !== null && <a href={api.downloadUrl(id, "cleaned")}><Button icon={Download}>Cleaned CSV</Button></a>}
        </>} />

      <Notice tone="info" className="mb-4" title="Data provenance">
        Historical records describe reported landslide events (date, place, trigger, size, casualties). They contain no soil-moisture, rain-module or MPU6050 readings,
        so they are kept separate from the experimental sensor data used to train the Random Forest.
      </Notice>

      <Card title="Filters" icon={Filter} className="mb-4" actions={<Button size="sm" icon={RotateCcw} variant="ghost" onClick={() => setF({})}>Reset</Button>}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <Field label="Year from"><Select value={f.year_from ?? ""} onChange={(e) => set("year_from", e.target.value ? Number(e.target.value) : "")} disabled={!years.length}><option value="">Any</option>{years.map((y) => <option key={y}>{y}</option>)}</Select></Field>
          <Field label="Year to"><Select value={f.year_to ?? ""} onChange={(e) => set("year_to", e.target.value ? Number(e.target.value) : "")} disabled={!years.length}><option value="">Any</option>{years.map((y) => <option key={y}>{y}</option>)}</Select></Field>
          {(["country", "trigger", "category", "size", "setting"] as const).map((k) => (
            <Field key={k} label={humanize(k)}>
              <Select value={(f[k] as string) ?? ""} onChange={(e) => set(k, e.target.value)} disabled={!opts.data?.[k]}>
                <option value="">{opts.data?.[k] ? "Any" : "n/a"}</option>
                {opts.data?.[k]?.map((o) => <option key={o.value} value={o.value}>{humanize(o.value)} ({o.count})</option>)}
              </Select>
            </Field>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-5">
          <Toggle checked={!!f.fatal_only} onChange={(v) => set("fatal_only", v)} label="Only events with recorded fatalities" />
          <Toggle checked={!!f.rain_only} onChange={(v) => set("rain_only", v)} label="Only rain-related triggers" />
        </div>
      </Card>

      {an.error && !a ? <Card><Async state={an}>{() => null}</Async></Card> : !a ? <Loading /> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <MetricCard label="Recorded events" value={fmtInt(a.totals.events)} hint={`of ${fmtInt(a.dataset.rows_total)} in dataset`} />
            <MetricCard label="Date range" value={<span className="text-base">{a.totals.date_min ?? "—"}</span>} hint={a.totals.date_max ? `to ${a.totals.date_max}` : "no date column"} />
            <MetricCard label="Countries" value={a.totals.countries ?? "n/a"} />
            <MetricCard label="Mappable events" value={fmtInt(a.totals.events_with_valid_coordinates)} hint="valid lat/lon" />
            <MetricCard label="Recorded fatalities" value={a.totals.total_fatalities !== undefined ? fmtInt(a.totals.total_fatalities) : "n/a"}
              hint={a.totals.fatality_values_missing !== undefined ? `${fmtInt(a.totals.fatality_values_missing)} events not recorded` : undefined} />
            <MetricCard label="Recorded injuries" value={a.totals.total_injuries !== undefined ? fmtInt(a.totals.total_injuries) : "n/a"}
              hint={a.totals.injury_values_missing !== undefined ? `${fmtInt(a.totals.injury_values_missing)} events not recorded` : undefined} />
          </div>

          <Card className="mt-4" title="Geographic distribution of recorded events" subtitle={map.data ? `${fmtInt(map.data.points.length)} of ${fmtInt(map.data.total_with_coordinates)} events with valid coordinates${map.data.sampled ? " (sampled)" : ""} · orange = recorded fatalities (size ∝ √fatalities)` : undefined}>
            {map.data && !map.data.available ? <EmptyState title="No latitude/longitude columns mapped">Assign them in “Column roles” if they exist.</EmptyState>
              : <Suspense fallback={<Loading label="Loading map…" />}><EventMap points={map.data?.points ?? []} /></Suspense>}
          </Card>

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card title="Recorded events per year">{a.by_year ? <ColumnChart data={a.by_year} xKey="year" yKey="count" /> : <EmptyState title="No date column" />}</Card>
            <Card title="Recorded events per calendar month" subtitle="Pooled across all hemispheres — monsoon seasonality varies by region.">{a.by_month ? <ColumnChart data={a.by_month} xKey="label" yKey="count" /> : <EmptyState title="No date column" />}</Card>
            <Card title="Trigger categories" subtitle="Click a bar to filter">{a.triggers ? <HBarChart data={a.triggers as unknown as Record<string, unknown>[]} onBarClick={(n) => n !== "(other)" && set("trigger", n)} /> : <EmptyState title="No trigger column" />}</Card>
            <Card title="Landslide type (category)">{a.categories ? <HBarChart data={a.categories as unknown as Record<string, unknown>[]} onBarClick={(n) => n !== "(other)" && set("category", n)} /> : <EmptyState title="No category column" />}</Card>
            <Card title="Landslide size distribution">{a.sizes ? <HBarChart data={a.sizes as unknown as Record<string, unknown>[]} /> : <EmptyState title="No size column" />}</Card>
            <Card title="Landslide setting">{a.settings ? <HBarChart data={a.settings as unknown as Record<string, unknown>[]} /> : <EmptyState title="No setting column" />}</Card>
            <Card title="Countries with most recorded events (top 20)" subtitle="Reflects reporting coverage as much as hazard.">{a.countries ? <HBarChart data={a.countries as unknown as Record<string, unknown>[]} onBarClick={(n) => set("country", n)} /> : <EmptyState title="No country column" />}</Card>
            <Card title="Recorded fatalities per year" icon={Skull}>{a.by_year && a.by_year[0]?.fatalities !== null ? <ColumnChart data={a.by_year} xKey="year" yKey="fatalities" color="#ec835a" valueLabel="Fatalities" /> : <EmptyState title="No fatality column" />}</Card>
          </div>

          {a.rain_related && (
            <Card className="mt-4" title="Rain-related events" icon={CloudRain} subtitle={a.rain_related.note}>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="space-y-3">
                  <MetricCard label="Rain-related events" value={fmtInt(a.rain_related.count)} hint={`${fmtNum(a.rain_related.pct_of_events_with_known_trigger, 1)}% of events with a known trigger`} />
                  <MetricCard label="Fatalities in rain-related events" value={a.rain_related.fatalities !== null ? fmtInt(a.rain_related.fatalities) : "n/a"} />
                  <div className="flex flex-wrap gap-1">{a.rain_related.keywords.map((k) => <Badge key={k}>{k}</Badge>)}</div>
                  <p className="text-xs text-slate-500">Relevance to this project: the prototype monitors rain activity and soil moisture; the catalogue shows how often rainfall is reported as a trigger. It does not provide threshold values for the sensors.</p>
                </div>
                <div><div className="mb-1 text-xs text-slate-400">By month</div><ColumnChart data={a.rain_related.by_month} xKey="label" yKey="count" height={200} color="#199e70" /></div>
                <div><div className="mb-1 text-xs text-slate-400">Rain trigger breakdown</div><HBarChart data={a.rain_related.triggers as unknown as Record<string, unknown>[]} color="#199e70" /></div>
              </div>
            </Card>
          )}

          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card title="Deadliest recorded events" icon={Skull}>
              {a.deadliest_events?.length ? (
                <Table dense head={["Event", "Date", "Country", "Trigger", "Fatalities"]}>
                  {a.deadliest_events.map((e, i) => (
                    <tr key={i}><td className="max-w-[260px] truncate px-3 py-1.5" title={e.title}>{e.title}</td><td className="px-3 py-1.5 font-mono">{e.date}</td><td className="px-3 py-1.5">{e.country}</td><td className="px-3 py-1.5">{humanize(e.trigger)}</td><td className="px-3 py-1.5 font-mono">{fmtInt(e.fatalities)}</td></tr>
                  ))}
                </Table>
              ) : <EmptyState title="No fatality data" />}
            </Card>
            <Card title="Data quality">
              <KV items={[
                ["Rows (original)", fmtInt(a.data_quality.rows_original as number)],
                ["Rows after cleaning", fmtInt(a.data_quality.rows_after_cleaning as number)],
                ["Duplicate rows removed", String(a.data_quality.duplicate_rows_removed ?? "—")],
                ["Duplicate event IDs", String(a.data_quality.duplicate_ids ?? "n/a")],
                ["Unparseable dates", String(a.data_quality.unparseable_dates ?? "n/a")],
                ["Invalid/missing coordinates", String(a.data_quality.invalid_or_missing_coordinates ?? "n/a")],
              ]} />
              <div className="mt-3 text-xs text-slate-400">Missing values in mapped columns</div>
              <Table dense className="mt-1" head={["Role", "Column", "Missing", "%"]}>
                {Object.entries(a.data_quality.mapped_column_missing ?? {}).map(([role, v]) => (
                  <tr key={role}><td className="px-3 py-1">{humanize(role)}</td><td className="px-3 py-1 font-mono">{v.column}</td><td className="px-3 py-1 font-mono">{fmtInt(v.missing)}</td><td className="px-3 py-1 font-mono">{v.missing_pct}%</td></tr>
                ))}
              </Table>
            </Card>
          </div>

          <Card className="mt-4" title="Interpretation caveats">
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-300">{a.caveats.map((c, i) => <li key={i}>{c}</li>)}</ul>
          </Card>
        </>
      )}
      {id !== null && <MappingEditor id={id} open={mapOpen} onClose={() => setMapOpen(false)} onSaved={() => setRev((r) => r + 1)} />}
    </>
  );
}
