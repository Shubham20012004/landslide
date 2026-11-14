import { ArrowLeftRight, BrainCircuit, CheckCircle2, ClipboardPaste, Cpu, Send, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ClassScores } from "../charts";
import { DeviceSelect, defaultDevice } from "../components/monitoring";
import { Async, Badge, Button, Card, EmptyState, Field, Input, KV, Notice, PageHeader, RiskBadge, SimBadge } from "../components/ui";
import { useAction, useApi } from "../hooks/useApi";
import { useRefreshMs } from "../hooks/useAppSettings";
import { api } from "../services/api";
import type { Prediction } from "../types";
import { fmtAgo, fmtDateTime, fmtNum } from "../utils/format";

function PredictionResult({ p }: { p: Prediction }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-xs uppercase tracking-wider text-slate-400">Predicted class</span>
        <RiskBadge state={p.predicted_class} size="lg" />
        {p.trained_on_synthetic && <Badge tone="violet">model trained on SYNTHETIC data</Badge>}
      </div>
      <ClassScores scores={p.class_scores} />
      <p className="text-[11px] text-slate-500">{p.class_scores_note}</p>
      <KV items={[["Model", `v${p.model_version} · ${p.model_name}`], ["Predicted at", fmtDateTime(p.predicted_at)], ...Object.entries(p.input).map(([k, v]) => [k, fmtNum(v, 3)] as [string, string])]} />
    </div>
  );
}

export default function Predictions() {
  const refresh = useRefreshMs();
  const devs = useApi(() => api.devices(), [], 10000);
  const devices = devs.data?.devices ?? [];
  const [device, setDevice] = useState("");
  useEffect(() => { if (!device && devices.length) setDevice(defaultDevice(devices)); }, [devices, device]);
  const models = useApi(() => api.models(), []);
  const activeModel = models.data?.models.find((m) => m.is_active) ?? null;
  const hybrid = useApi(() => api.hybrid(device || undefined), [device], refresh);
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Prediction | null>(null);
  const act = useAction();
  useEffect(() => {
    if (activeModel) setValues((v) => Object.fromEntries(activeModel.features.map((f) => [f, v[f] ?? ""])));
  }, [activeModel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const h = hybrid.data;
  const fillFromLatest = () => {
    if (!h?.reading || !activeModel) return;
    setValues(Object.fromEntries(activeModel.features.map((f) => {
      const v = (h.reading as Record<string, unknown>)[f];
      return [f, v === null || v === undefined ? "" : String(v)];
    })));
  };

  return (
    <>
      <PageHeader icon={BrainCircuit} title="AI Predictions" subtitle="AI-assisted prototype risk classification from the explicitly activated Random Forest. Shown side-by-side with — never instead of — the ESP32 rule-based state."
        actions={devices.length > 0 && <DeviceSelect devices={devices} value={device} onChange={setDevice} />} />

      <Card title="Model status" icon={BrainCircuit} className="mb-4">
        <Async state={models}>{() => activeModel ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge tone="green">ACTIVE</Badge>
            <span>Model <b>v{activeModel.version}</b> · {activeModel.name}</span>
            <span className="text-slate-400">features: <span className="font-mono text-xs">{activeModel.features.join(", ")}</span></span>
            <span className="text-slate-400">macro-F1 {fmtNum(activeModel.summary_metrics.f1_macro, 3)} ({activeModel.split_strategy} split)</span>
            {activeModel.is_synthetic && <Badge tone="violet">trained on SYNTHETIC data — demo only</Badge>}
          </div>
        ) : (
          <EmptyState icon={BrainCircuit} title="No model is active" action={<Link to="/evaluation"><Button variant="primary">Open model registry</Button></Link>}>
            Predictions are disabled until you train a model and explicitly activate it. Models are never activated automatically.
          </EmptyState>
        )}</Async>
      </Card>

      <Card title="Hybrid comparison on the latest reading" icon={ArrowLeftRight} subtitle={h?.policy}>
        <Async state={hybrid}>{(d) => !d.reading ? <EmptyState title={d.message ?? "No readings yet"} /> : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto_1fr_auto]">
              <div className="rounded-xl border border-line bg-ink-850 p-4">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-400"><Cpu size={14} /> 1 · ESP32 rule-based state</div>
                <div className="mt-3"><RiskBadge state={d.esp32_state} size="lg" /></div>
                <div className="mt-2 text-xs text-slate-500">Authoritative for the local LEDs/buzzer · score {fmtNum(d.reading.weighted_score, 1)}</div>
              </div>
              <div className="hidden items-center text-slate-600 md:flex"><ArrowLeftRight /></div>
              <div className="rounded-xl border border-line bg-ink-850 p-4">
                <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-400"><BrainCircuit size={14} /> 2 · Random Forest prediction</div>
                {d.ml ? (
                  <>
                    <div className="mt-3"><RiskBadge state={d.ml.predicted_class} size="lg" /></div>
                    <div className="mt-3"><ClassScores scores={d.ml.class_scores} /></div>
                  </>
                ) : <div className="mt-3 text-sm text-slate-400">{d.message ?? "Unavailable"}</div>}
              </div>
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-line bg-ink-850 p-4 text-center">
                <div className="text-xs uppercase tracking-wider text-slate-400">3 · Agreement</div>
                {d.agreement === true && <><CheckCircle2 className="text-green-400" size={28} /><span className="text-sm text-green-300">Agree</span></>}
                {d.agreement === false && <><XCircle className="text-amber-400" size={28} /><span className="text-sm text-amber-300">Disagree</span><span className="text-[11px] text-slate-500">ESP32 state remains in force</span></>}
                {d.agreement === null && <span className="text-sm text-slate-500">not assessed</span>}
                <div className="text-[11px] text-slate-500">4 · model {d.ml ? `v${d.ml.model_version}` : "—"}</div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              Reading #{d.reading.id} from <span className="font-mono">{d.reading.device_id}</span> · {fmtAgo(d.reading.received_at)}
              {d.reading.stale && <Badge tone="amber">stale — device offline</Badge>}
              {d.reading.is_simulated && <SimBadge />}
            </div>
            {d.message && d.ml && <Notice tone="info" className="mt-2">{d.message}</Notice>}
          </>
        )}</Async>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Manual prediction" subtitle="Enter sensor values to test the active model. All required inputs must be valid numbers." actions={activeModel && h?.reading && <Button size="sm" icon={ClipboardPaste} onClick={fillFromLatest}>Fill from latest reading</Button>}>
          {!activeModel ? <EmptyState title="Activate a model to enable manual prediction" /> : (
            <form className="space-y-3" onSubmit={(e) => {
              e.preventDefault();
              act.run(async () => {
                const features: Record<string, number | null> = {};
                for (const f of activeModel.features) features[f] = values[f]?.trim() === "" || values[f] === undefined ? null : Number(values[f]);
                setResult(await api.predict({ features }));
              });
            }}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {activeModel.features.map((f) => (
                  <Field key={f} label={f}>
                    <Input inputMode="decimal" value={values[f] ?? ""} onChange={(e) => setValues({ ...values, [f]: e.target.value })} placeholder="required" />
                  </Field>
                ))}
              </div>
              <Button variant="primary" icon={Send} type="submit" loading={act.busy}>Predict</Button>
              {act.error && <Notice tone="danger">{act.error}</Notice>}
            </form>
          )}
        </Card>
        <Card title="Manual prediction result">
          {result ? <PredictionResult p={result} /> : <EmptyState title="No prediction yet" />}
        </Card>
      </div>

      <Notice tone="info" className="mt-4" title="How to interpret this">
        The Random Forest is trained on prototype data from a miniature slope. Its class scores are the share of trees voting for each class — a model confidence score, not a probability that a landslide will occur.
        SAFE/WATCH/WARNING/CRITICAL are prototype categories, not official warning levels.
      </Notice>
    </>
  );
}
