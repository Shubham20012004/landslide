import { CheckCircle2, FlaskConical, Loader2, Play, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Async, Badge, Button, Card, EmptyState, Field, Input, Notice, PageHeader, Select, Table } from "../components/ui";
import { useAction, useApi } from "../hooks/useApi";
import { api } from "../services/api";
import type { TrainConfig } from "../types";
import { fmtDateTime, fmtNum, riskColor } from "../utils/format";

const EXPECTED = ["moisture_index", "rain_index", "tilt_change_deg", "moisture_rate_per_min", "tilt_rate_deg_per_min"];
const SPLITS: { value: TrainConfig["split_strategy"]; label: string; text: string }[] = [
  { value: "group", label: "Group-aware (by experiment)", text: "Whole experiments go to either train or test. Recommended: no run leaks into both sets." },
  { value: "chronological", label: "Chronological", text: "The most recent fraction of rows (by time column) is held out. Mimics deploying on future data." },
  { value: "stratified", label: "Stratified random", text: "Random rows, class ratios preserved. Optimistic for sequential sensor data — needs acknowledgement." },
  { value: "random", label: "Random", text: "Plain random rows. Optimistic for sequential sensor data — needs acknowledgement." },
];

const DEFAULTS: Omit<TrainConfig, "dataset_id" | "features" | "target"> = {
  test_size: 0.25, random_seed: 42, n_estimators: 200, max_depth: null, min_samples_split: 2, min_samples_leaf: 1,
  class_weight: "balanced", split_strategy: "group", group_column: null, time_column: null, model_name: "RandomForest", notes: "", acknowledge_warnings: false,
};

function RunStatus({ status }: { status: string }) {
  if (status === "completed") return <Badge tone="green"><CheckCircle2 size={11} /> completed</Badge>;
  if (status === "failed") return <Badge tone="red"><XCircle size={11} /> failed</Badge>;
  return <Badge tone="sky"><Loader2 size={11} className="animate-spin" /> {status}</Badge>;
}

export default function ModelTraining() {
  const [params] = useSearchParams();
  const list = useApi(() => api.datasets("experimental"), []);
  const [dsId, setDsId] = useState<number | null>(params.get("dataset") ? Number(params.get("dataset")) : null);
  useEffect(() => { if (dsId === null && list.data?.datasets.length) setDsId(list.data.datasets[0].id); }, [list.data, dsId]);
  const ds = useApi(() => api.dataset(dsId!), [dsId], null, dsId !== null);
  const cols = ds.data?.profile.columns ?? [];
  const numericCols = cols.filter((c) => c.kind === "numeric" || c.kind === "numeric-like text").map((c) => c.name);

  const [features, setFeatures] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [cfg, setCfg] = useState(DEFAULTS);
  useEffect(() => {
    if (!ds.data) return;
    const names = ds.data.profile.columns.map((c) => c.name);
    setFeatures(EXPECTED.filter((f) => names.includes(f)));
    setTarget(names.includes("risk_label") ? "risk_label" : "");
    setCfg((c) => ({ ...c, group_column: null, time_column: null, acknowledge_warnings: false }));
  }, [ds.data]);

  const full: TrainConfig | null = dsId !== null && features.length && target ? { ...cfg, dataset_id: dsId, features, target } : null;
  const key = JSON.stringify(full && { ...full, acknowledge_warnings: false, notes: "", model_name: "" });
  const pre = useApi(() => api.preflight(full!), [key], null, !!full);
  const runs = useApi(() => api.runs(), []);
  const active = runs.data?.runs.some((r) => r.status === "queued" || r.status === "running");
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(runs.reload, 1500);
    return () => window.clearInterval(id);
  }, [active, runs.reload]);
  const act = useAction();
  const set = <K extends keyof typeof cfg>(k: K, v: (typeof cfg)[K]) => setCfg((c) => ({ ...c, [k]: v, acknowledge_warnings: k === "acknowledge_warnings" ? (v as boolean) : false }));
  const p = pre.data;
  const canTrain = !!full && !!p?.ok && (!p.needs_acknowledgement || cfg.acknowledge_warnings);
  const maxCount = useMemo(() => Math.max(1, ...(p?.class_distribution ?? []).map((c) => c.count)), [p]);

  if (list.data && !list.data.datasets.length) {
    return (
      <>
        <PageHeader icon={FlaskConical} title="AI Model Training" />
        <Card><EmptyState icon={FlaskConical} title="No experimental sensor dataset available" action={<Link to="/datasets"><Button variant="primary">Go to Dataset Management</Button></Link>}>
          Required schema: one row per reading with numeric features <code>moisture_index, rain_index, tilt_change_deg, moisture_rate_per_min, tilt_rate_deg_per_min</code>,
          a label column <code>risk_label</code> (SAFE / WATCH / WARNING / CRITICAL), and ideally <code>experiment_id</code> and <code>timestamp</code>.
          You can also build one from recorded readings, or generate a clearly-labelled SYNTHETIC fixture to test the pipeline.
        </EmptyState></Card>
      </>
    );
  }

  return (
    <>
      <PageHeader icon={FlaskConical} title="AI Model Training" subtitle="Random Forest classifier in a scikit-learn Pipeline (median imputation fitted on the training split only). Training runs in a background worker; new models are never activated automatically." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-4">
          <Card title="1 · Dataset, features and target">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Experimental dataset">
                <Select value={dsId ?? ""} onChange={(e) => setDsId(Number(e.target.value))}>
                  {list.data?.datasets.map((d) => <option key={d.id} value={d.id}>{d.name} v{d.version} · {d.n_rows} rows{d.is_synthetic ? " · SYNTHETIC" : ""}</option>)}
                </Select>
              </Field>
              <Field label="Target column (label)">
                <Select value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">Select…</option>
                  {cols.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                </Select>
              </Field>
            </div>
            {ds.data?.is_synthetic && <Notice tone="sim" className="mt-3" title="SYNTHETIC dataset">Metrics will only demonstrate that the pipeline works. They are not project results.</Notice>}
            <div className="mt-3 text-xs font-medium text-slate-400">Feature columns (numeric)</div>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {numericCols.filter((c) => c !== target).map((c) => (
                <label key={c} className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${features.includes(c) ? "border-sky-500/50 bg-sky-500/10 text-sky-200" : "border-line text-slate-400"}`}>
                  <input type="checkbox" className="accent-sky-500" checked={features.includes(c)} onChange={(e) => setFeatures(e.target.checked ? [...features, c] : features.filter((f) => f !== c))} />
                  <span className="font-mono">{c}</span>
                </label>
              ))}
              {!numericCols.length && <span className="text-xs text-slate-500">No numeric columns detected.</span>}
            </div>
          </Card>

          <Card title="2 · Train–test split">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {SPLITS.map((s) => (
                <label key={s.value} className={`cursor-pointer rounded-lg border p-3 ${cfg.split_strategy === s.value ? "border-sky-500/60 bg-sky-500/5" : "border-line hover:border-ink-500"}`}>
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
                    <input type="radio" className="accent-sky-500" checked={cfg.split_strategy === s.value} onChange={() => set("split_strategy", s.value)} /> {s.label}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{s.text}</p>
                </label>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <Field label={`Test size (${Math.round(cfg.test_size * 100)}%)`}><input type="range" min={0.1} max={0.5} step={0.05} value={cfg.test_size} onChange={(e) => set("test_size", Number(e.target.value))} className="w-full accent-sky-500" /></Field>
              <Field label="Random seed"><Input type="number" value={cfg.random_seed} onChange={(e) => set("random_seed", Number(e.target.value))} /></Field>
              <Field label="Group column" hint={p?.detected?.group_column ? `auto: ${p.detected.group_column}` : "none detected"}>
                <Select value={cfg.group_column ?? ""} onChange={(e) => set("group_column", e.target.value || null)}><option value="">Auto-detect</option>{cols.map((c) => <option key={c.name}>{c.name}</option>)}</Select>
              </Field>
              <Field label="Time column" hint={p?.detected?.time_column ? `auto: ${p.detected.time_column}` : "row order"}>
                <Select value={cfg.time_column ?? ""} onChange={(e) => set("time_column", e.target.value || null)}><option value="">Auto-detect</option>{cols.map((c) => <option key={c.name}>{c.name}</option>)}</Select>
              </Field>
            </div>
          </Card>

          <Card title="3 · Random Forest hyperparameters">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Field label="Number of estimators"><Input type="number" min={10} max={1000} value={cfg.n_estimators} onChange={(e) => set("n_estimators", Number(e.target.value))} /></Field>
              <Field label="Maximum depth" hint="empty = unlimited"><Input type="number" min={1} max={100} value={cfg.max_depth ?? ""} onChange={(e) => set("max_depth", e.target.value ? Number(e.target.value) : null)} /></Field>
              <Field label="Class weighting"><Select value={cfg.class_weight} onChange={(e) => set("class_weight", e.target.value as TrainConfig["class_weight"])}><option value="none">None</option><option value="balanced">Balanced</option><option value="balanced_subsample">Balanced subsample</option></Select></Field>
              <Field label="Min samples split"><Input type="number" min={2} value={cfg.min_samples_split} onChange={(e) => set("min_samples_split", Number(e.target.value))} /></Field>
              <Field label="Min samples leaf"><Input type="number" min={1} value={cfg.min_samples_leaf} onChange={(e) => set("min_samples_leaf", Number(e.target.value))} /></Field>
              <Field label="Model name"><Input value={cfg.model_name} onChange={(e) => setCfg({ ...cfg, model_name: e.target.value })} /></Field>
            </div>
            <Field label="Notes" className="mt-3"><Input value={cfg.notes} onChange={(e) => setCfg({ ...cfg, notes: e.target.value })} placeholder="Purpose of this run" /></Field>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Pre-training validation" icon={ShieldCheck} subtitle="Dataset, feature, label, class-balance and leakage checks">
            {!full ? <EmptyState title="Select a dataset, at least one feature and a target" /> : (
              <Async state={pre}>{(r) => (
                <div className="space-y-2">
                  {r.ok ? <Notice tone="success" title="Configuration valid" /> : <Notice tone="danger" title="Cannot train">{r.errors.map((e, i) => <div key={i}>• {e}</div>)}</Notice>}
                  {r.data && <div className="text-xs text-slate-400">{r.data.rows_usable} labelled rows usable · {r.data.rows_dropped_missing_target} dropped (missing label){r.n_groups ? ` · ${r.n_groups} groups` : ""}</div>}
                  {r.class_distribution && (
                    <div className="space-y-1">
                      {r.class_distribution.map((c) => (
                        <div key={c.label} className="grid grid-cols-[80px_1fr_80px] items-center gap-2 text-xs">
                          <span className="font-semibold" style={{ color: riskColor(c.label) }}>{c.label}</span>
                          <div className="h-2 rounded bg-ink-900"><div className="h-2 rounded" style={{ width: `${(100 * c.count) / maxCount}%`, background: riskColor(c.label) }} /></div>
                          <span className="text-right font-mono text-slate-400">{c.count} ({c.pct}%)</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {r.warnings.map((w, i) => <Notice key={i} tone={/SYNTHETIC/.test(w) ? "sim" : "warning"}>{w}</Notice>)}
                  {r.blocking_warnings.length > 0 && (
                    <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-sm text-red-200">
                      <div className="mb-1 font-medium">Requires acknowledgement</div>
                      {r.blocking_warnings.map((w, i) => <p key={i} className="mb-1 text-[13px]">{w}</p>)}
                      <label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={cfg.acknowledge_warnings} onChange={(e) => set("acknowledge_warnings", e.target.checked)} /> I understand these results may be optimistic and will report the split strategy.</label>
                    </div>
                  )}
                </div>
              )}</Async>
            )}
            <Button className="mt-3 w-full" variant="primary" icon={Play} disabled={!canTrain} loading={act.busy}
              onClick={() => act.run(async () => { await api.train({ ...full!, acknowledge_warnings: cfg.acknowledge_warnings }); runs.reload(); })}>
              Start background training
            </Button>
            {act.error && <Notice tone="danger" className="mt-2">{act.error}</Notice>}
          </Card>

          <Card title="Training history">
            <Async state={runs}>{(d) => d.runs.length === 0 ? <EmptyState title="No training runs yet" /> : (
              <Table dense head={["Run", "Dataset", "Split", "Status", "Duration", "Model"]}>
                {d.runs.map((r) => (
                  <tr key={r.id} title={r.error ?? undefined}>
                    <td className="px-3 py-1.5 font-mono">#{r.id}<div className="text-[10px] text-slate-500">{fmtDateTime(r.created_at)}</div></td>
                    <td className="max-w-[140px] truncate px-3 py-1.5">{r.dataset_name}</td>
                    <td className="px-3 py-1.5">{r.config.split_strategy}</td>
                    <td className="px-3 py-1.5"><RunStatus status={r.status} />{r.error && <div className="max-w-[200px] truncate text-[10px] text-red-300">{r.error}</div>}</td>
                    <td className="px-3 py-1.5 font-mono">{r.duration_sec ? `${fmtNum(r.duration_sec, 1)}s` : "—"}</td>
                    <td className="px-3 py-1.5">{r.model_id ? <Link className="text-sky-400" to={`/evaluation?model=${r.model_id}`}>View</Link> : "—"}</td>
                  </tr>
                ))}
              </Table>
            )}</Async>
          </Card>
        </div>
      </div>
    </>
  );
}
