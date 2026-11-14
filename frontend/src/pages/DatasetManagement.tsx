import { Database, Download, Eye, FileUp, FlaskConical, Hammer, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Async, Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, KV, Modal, Notice, PageHeader, Pagination, Segmented, Select, Table, Tabs, Toggle,
} from "../components/ui";
import { useAction, useApi } from "../hooks/useApi";
import { ApiError, api } from "../services/api";
import type { DatasetDetail } from "../types";
import { fmtBytes, fmtDateTime, fmtInt, LABEL_SOURCE_TEXT } from "../utils/format";

function UploadCard({ onDone }: { onDone: (id: number) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<"historical" | "experimental">("experimental");
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [labelSource, setLabelSource] = useState("manual_observation");
  const [synthetic, setSynthetic] = useState(false);
  const [conflict, setConflict] = useState<{ message: string; next: number } | null>(null);
  const act = useAction();

  const submit = async (confirm: boolean) => {
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    fd.append("category", category);
    fd.append("name", name || file.name.replace(/\.csv$/i, ""));
    fd.append("description", desc);
    if (category === "experimental") fd.append("label_source", labelSource);
    fd.append("is_synthetic", String(synthetic));
    fd.append("confirm_new_version", String(confirm));
    try {
      const ds = await act.run(async () => {
        try {
          return await api.uploadDataset(fd);
        } catch (e) {
          if (e instanceof ApiError && e.status === 409 && (e.body as { conflict?: string })?.conflict === "name_exists") {
            setConflict({ message: e.message, next: (e.body as { next_version: number }).next_version });
            return undefined;
          }
          throw e;
        }
      });
      if (ds) {
        setConflict(null);
        setFile(null);
        setName("");
        setDesc("");
        if (fileRef.current) fileRef.current.value = "";
        onDone(ds.id);
      }
    } catch {
      /* handled by useAction */
    }
  };

  return (
    <Card title="Upload CSV dataset" icon={FileUp} subtitle="Validated for type, size, encoding and contents. Originals are kept unchanged; a cleaned copy is derived.">
      <div className="space-y-3">
        <Segmented value={category} onChange={setCategory} options={[{ value: "experimental", label: "B · Experimental sensor data" }, { value: "historical", label: "A · Historical landslide events" }]} />
        <p className="text-xs text-slate-500">
          {category === "historical"
            ? "Event-level catalogue (e.g. NASA Global Landslide Catalog). Used for historical analysis only — never as sensor training rows."
            : "Prototype measurements with labels. Expected columns: experiment_id, timestamp, moisture_index, rain_index, tilt_change_deg, moisture_rate_per_min, tilt_rate_deg_per_min, risk_label."}
        </p>
        <Field label="CSV file"><Input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Dataset name" hint="Same name → stored as a new version (confirmation required)"><Input value={name} placeholder={file?.name.replace(/\.csv$/i, "") ?? "e.g. bench-run-oct"} onChange={(e) => setName(e.target.value)} /></Field>
          {category === "experimental" && (
            <Field label="How were labels assigned?">
              <Select value={labelSource} onChange={(e) => setLabelSource(e.target.value)}>
                {Object.entries(LABEL_SOURCE_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
          )}
        </div>
        <Field label="Description / provenance notes"><Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Where and how this data was collected" /></Field>
        {category === "experimental" && <div><Toggle checked={synthetic} onChange={setSynthetic} label="This file contains synthetic / simulated data" /></div>}
        <div><Button variant="primary" icon={FileUp} disabled={!file} loading={act.busy} onClick={() => submit(false)}>Upload &amp; validate</Button></div>
        {act.error && <Notice tone="danger">{act.error}</Notice>}
      </div>
      <ConfirmDialog open={!!conflict} title="Dataset name already exists" confirmLabel={`Store as version ${conflict?.next}`} busy={act.busy}
        onCancel={() => setConflict(null)} onConfirm={() => submit(true)}>
        {conflict?.message}
      </ConfirmDialog>
    </Card>
  );
}

function BuildersCard({ onDone }: { onDone: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("recorded-readings");
  const [device, setDevice] = useState("");
  const [exps, setExps] = useState<string[]>([]);
  const [sim, setSim] = useState(false);
  const [version, setVersion] = useState(false);
  const devs = useApi(() => api.devices(), [open], null, open);
  const ex = useApi(() => api.experiments(), [open], null, open);
  const act = useAction();
  return (
    <Card title="Create experimental datasets" icon={Hammer}>
      <div className="space-y-4 text-sm">
        <div>
          <Button icon={FlaskConical} loading={act.busy} onClick={() => act.run(async () => { const d = await api.syntheticFixture(); onDone(d.id); })}>Generate SYNTHETIC test fixture</Button>
          <p className="mt-1 text-xs text-slate-500">1,050 rows from 14 simulated runs, labelled by a software replica of the firmware rules (+3% label noise). Only for testing the training pipeline — its metrics are not project findings.</p>
        </div>
        <div>
          <Button icon={Database} onClick={() => setOpen(true)}>Build from recorded readings…</Button>
          <p className="mt-1 text-xs text-slate-500">Exports stored telemetry (valid, SAFE–CRITICAL only) with <code>risk_label</code> = the ESP32's reported state. Disclosed as rule-engine labels.</p>
        </div>
        {act.error && <Notice tone="danger">{act.error}</Notice>}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Build experimental dataset from recorded readings"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" loading={act.busy} onClick={() => act.run(async () => {
            const d = await api.fromReadings({ name, device_id: device || undefined, experiment_ids: exps.length ? exps : undefined, include_simulated: sim, confirm_new_version: version });
            setOpen(false); onDone(d.id);
          })}>Create dataset</Button></>}>
        <div className="space-y-3">
          <Notice tone="warning">Labels will be the ESP32 rule-engine state. A model trained on them learns to imitate those rules; it does not independently discover slope behaviour.</Notice>
          <Field label="Dataset name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Device"><Select value={device} onChange={(e) => setDevice(e.target.value)}><option value="">All devices</option>{devs.data?.devices.map((d) => <option key={d.device_id} value={d.device_id}>{d.device_id}{d.is_simulated ? " (simulated)" : ""}</option>)}</Select></Field>
          <Field label="Experiment sessions (optional)" hint="Tag readings via Live Monitoring → Experiment session">
            <div className="flex flex-wrap gap-2">
              {ex.data?.experiments.length ? ex.data.experiments.map((e) => (
                <label key={e.experiment_id} className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={exps.includes(e.experiment_id)} onChange={(ev) => setExps(ev.target.checked ? [...exps, e.experiment_id] : exps.filter((x) => x !== e.experiment_id))} />
                  {e.experiment_id} ({e.readings})
                </label>
              )) : <span className="text-xs text-slate-500">No tagged experiments yet.</span>}
            </div>
          </Field>
          <Toggle checked={sim} onChange={setSim} label="Include SIMULATED readings (dataset will be flagged synthetic)" />
          <Toggle checked={version} onChange={setVersion} label="If the name exists, store as a new version" />
          {act.error && <Notice tone="danger">{act.error}</Notice>}
        </div>
      </Modal>
    </Card>
  );
}

function Preview({ id }: { id: number }) {
  const [variant, setVariant] = useState<"cleaned" | "original">("cleaned");
  const [page, setPage] = useState(1);
  const size = 20;
  const pv = useApi(() => api.preview(id, (page - 1) * size, size, variant), [id, variant, page]);
  return (
    <div>
      <div className="mb-2"><Segmented value={variant} onChange={(v) => { setVariant(v); setPage(1); }} options={[{ value: "cleaned", label: "Cleaned" }, { value: "original", label: "Original" }]} /></div>
      <Async state={pv}>{(d) => (
        <>
          <Table dense head={d.columns}>
            {d.rows.map((row, i) => <tr key={i}>{row.map((v, j) => <td key={j} className="max-w-[240px] truncate px-3 py-1 font-mono" title={v === null ? "" : String(v)}>{v === null ? <span className="text-slate-600">null</span> : String(v)}</td>)}</tr>)}
          </Table>
          <Pagination page={page} pages={Math.ceil(d.total / size)} total={d.total} onPage={setPage} />
        </>
      )}</Async>
    </div>
  );
}

function Detail({ d, onDelete }: { d: DatasetDetail; onDelete: () => void }) {
  const [tab, setTab] = useState<"schema" | "preview" | "quality">("schema");
  const nav = useNavigate();
  const rep = d.cleaning_report;
  return (
    <Card title={<span className="flex items-center gap-2">{d.name} <Badge>v{d.version}</Badge> <Badge tone={d.category === "historical" ? "sky" : "green"}>{d.category}</Badge>{d.is_synthetic && <Badge tone="violet">SYNTHETIC</Badge>}</span>}
      subtitle={d.description || d.original_filename}
      actions={<>
        {d.category === "experimental" && <Button size="sm" variant="primary" onClick={() => nav(`/training?dataset=${d.id}`)}>Train with this</Button>}
        {d.category === "historical" && <Button size="sm" variant="primary" onClick={() => nav(`/historical`)}>Analyse</Button>}
        <a href={api.downloadUrl(d.id, "original")}><Button size="sm" icon={Download}>Original</Button></a>
        <a href={api.downloadUrl(d.id, "cleaned")}><Button size="sm" icon={Download}>Cleaned</Button></a>
        <Button size="sm" variant="danger" icon={Trash2} onClick={onDelete}>Delete</Button>
      </>}>
      <KV cols={3} items={[
        ["Rows × columns", `${fmtInt(d.n_rows)} × ${d.n_columns}`],
        ["File size", fmtBytes(d.file_size_bytes)],
        ["Encoding", d.encoding],
        ["Uploaded", fmtDateTime(d.uploaded_at)],
        ["Duplicate rows", String(d.profile.duplicate_rows)],
        ["Missing cells", fmtInt(d.profile.total_missing_cells)],
        ["Source", d.source],
        ["Label source", d.label_source ? LABEL_SOURCE_TEXT[d.label_source] ?? d.label_source : "—"],
        ["SHA-256", <span className="font-mono text-[11px]" title={d.sha256}>{d.sha256.slice(0, 16)}…</span>],
      ]} />
      {d.profile.warnings.length > 0 && (
        <div className="mt-3 space-y-1.5">{d.profile.warnings.map((w, i) => <Notice key={i} tone={/SYNTHETIC/.test(w) ? "sim" : "warning"}>{w}</Notice>)}</div>
      )}
      {d.used_by_models?.length ? <p className="mt-2 text-xs text-slate-400">Used by models: {d.used_by_models.map((m) => `v${m.version}`).join(", ")}</p> : null}
      <div className="mt-4">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: "schema", label: "Schema", count: d.n_columns }, { value: "preview", label: "Preview" }, { value: "quality", label: "Cleaning report" }]} />
        {tab === "schema" && (
          <Table dense head={["Column", "Type", "Kind", "Missing", "Unique", "Min", "Max", "Mean", "Sample values"]}>
            {d.profile.columns.map((c) => (
              <tr key={c.name}>
                <td className="px-3 py-1 font-mono text-slate-200">{c.name}</td><td className="px-3 py-1 font-mono">{c.dtype}</td><td className="px-3 py-1">{c.kind}</td>
                <td className={`px-3 py-1 font-mono ${c.missing ? "text-amber-300" : ""}`}>{c.missing} ({c.missing_pct}%)</td><td className="px-3 py-1 font-mono">{c.unique}</td>
                <td className="px-3 py-1 font-mono">{c.min ?? ""}</td><td className="px-3 py-1 font-mono">{c.max ?? ""}</td><td className="px-3 py-1 font-mono">{c.mean ?? ""}</td>
                <td className="max-w-[280px] truncate px-3 py-1 text-slate-400" title={c.sample_values.join(" | ")}>{c.sample_values.join(" | ")}</td>
              </tr>
            ))}
          </Table>
        )}
        {tab === "preview" && <Preview id={d.id} />}
        {tab === "quality" && (
          <div className="space-y-2 text-sm">
            <KV items={[["Rows before", fmtInt(rep.rows_before)], ["Rows after", fmtInt(rep.rows_after)]]} />
            <ul className="list-disc space-y-1 pl-5 text-slate-300">{(rep.steps ?? []).map((s, i) => <li key={i}>{s}</li>)}{!rep.steps?.length && <li>No changes were necessary.</li>}</ul>
            {typeof rep.note === "string" && <p className="text-xs text-slate-500">{rep.note}</p>}
          </div>
        )}
      </div>
    </Card>
  );
}

export default function DatasetManagement() {
  const [cat, setCat] = useState<"" | "historical" | "experimental">("");
  const list = useApi(() => api.datasets(cat || undefined), [cat]);
  const [sel, setSel] = useState<number | null>(null);
  const detail = useApi(() => api.dataset(sel!), [sel], null, sel !== null);
  const [del, setDel] = useState(false);
  const act = useAction();
  const refreshTo = (id: number) => { list.reload(); setSel(id); };

  return (
    <>
      <PageHeader icon={Database} title="Dataset Management" subtitle="Category A (historical events) and Category B (experimental sensor data) are stored, versioned and analysed separately." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_1fr]">
        <UploadCard onDone={refreshTo} />
        <BuildersCard onDone={refreshTo} />
      </div>
      <Card className="mt-4" title="Datasets" actions={<Segmented value={cat} onChange={setCat} options={[{ value: "", label: "All" }, { value: "historical", label: "Historical" }, { value: "experimental", label: "Experimental" }]} />}>
        <Async state={list} empty={null}>{(d) => d.datasets.length === 0 ? <EmptyState icon={Database} title="No datasets yet">Upload a CSV above. No historical catalogue or labelled experimental dataset has been added.</EmptyState> : (
          <Table head={["Name", "Category", "Rows", "Cols", "Size", "Uploaded", "Labels", "Warnings", ""]}>
            {d.datasets.map((x) => (
              <tr key={x.id} className={sel === x.id ? "bg-sky-500/5" : "hover:bg-ink-750/50"}>
                <td className="px-3 py-2"><div className="font-medium text-slate-200">{x.name} <span className="text-xs text-slate-500">v{x.version}</span></div><div className="text-[11px] text-slate-500">{x.original_filename}</div></td>
                <td className="px-3 py-2"><Badge tone={x.category === "historical" ? "sky" : "green"}>{x.category}</Badge> {x.is_synthetic && <Badge tone="violet">synthetic</Badge>}</td>
                <td className="px-3 py-2 font-mono">{fmtInt(x.n_rows)}</td><td className="px-3 py-2 font-mono">{x.n_columns}</td>
                <td className="px-3 py-2 font-mono">{fmtBytes(x.file_size_bytes)}</td><td className="px-3 py-2 text-xs">{fmtDateTime(x.uploaded_at)}</td>
                <td className="px-3 py-2 text-xs">{x.label_source ?? "—"}</td>
                <td className="px-3 py-2">{x.warning_count ? <Badge tone="amber">{x.warning_count}</Badge> : <Badge tone="green">0</Badge>}</td>
                <td className="px-3 py-2 text-right"><Button size="sm" icon={Eye} onClick={() => setSel(x.id)}>Inspect</Button></td>
              </tr>
            ))}
          </Table>
        )}</Async>
      </Card>
      {sel !== null && <div className="mt-4"><Async state={detail}>{(d) => <Detail d={d} onDelete={() => setDel(true)} />}</Async></div>}
      <ConfirmDialog open={del} danger title="Delete dataset?" confirmLabel="Delete permanently" busy={act.busy} onCancel={() => setDel(false)}
        onConfirm={() => act.run(async () => { await api.deleteDataset(sel!); setDel(false); setSel(null); list.reload(); })}>
        <p>This permanently deletes <b>{detail.data?.name} v{detail.data?.version}</b> (original and cleaned files). Trained models keep their recorded dataset hash and remain usable.</p>
        {act.error && <Notice tone="danger" className="mt-2">{act.error}</Notice>}
      </ConfirmDialog>
    </>
  );
}
