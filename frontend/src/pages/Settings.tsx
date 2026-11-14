import { Cpu, RotateCcw, Save, Settings2, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { Async, Button, Card, Field, Input, KV, Notice, PageHeader, Select, Toggle } from "../components/ui";
import { useAction, useApi } from "../hooks/useApi";
import { useAppSettings } from "../hooks/useAppSettings";
import { api } from "../services/api";
import type { AppSettings, Thresholds } from "../types";

function NumIn({ value, onChange, step = 1 }: { value: number; onChange: (v: number) => void; step?: number }) {
  return <Input type="number" step={step} value={Number.isFinite(value) ? value : ""} onChange={(e) => onChange(Number(e.target.value))} />;
}

function Ladder4({ label, unit, v, onChange }: { label: string; unit: string; v: number[]; onChange: (v: number[]) => void }) {
  const names = ["SAFE max", "WATCH max", "WARNING max", "CRITICAL max"];
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-slate-300">{label} <span className="text-slate-500">({unit})</span></div>
      <div className="grid grid-cols-4 gap-2">
        {v.map((x, i) => <Field key={i} label={names[i]}><NumIn value={x} step={0.1} onChange={(n) => onChange(v.map((y, j) => (j === i ? n : y)))} /></Field>)}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { refreshSettings } = useAppSettings();
  const s = useApi(() => api.settings(), []);
  const info = useApi(() => api.systemInfo(), []);
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const act = useAction();
  useEffect(() => { if (s.data) setDraft(s.data.settings); }, [s.data]);
  const set = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => { setDraft((d) => (d ? { ...d, [k]: v } : d)); setSaved(false); };
  const setT = <K extends keyof Thresholds>(k: K, v: Thresholds[K]) => draft && set("analysis_thresholds", { ...draft.analysis_thresholds, [k]: v });
  const save = () => act.run(async () => {
    const { active_experiment_id: _ignored, ...rest } = draft!;
    void _ignored;
    await api.saveSettings(rest);
    await refreshSettings();
    s.reload();
    setSaved(true);
  });
  const fw = (info.data?.firmware ?? {}) as Record<string, unknown>;
  const t = draft?.analysis_thresholds;

  return (
    <>
      <PageHeader icon={Settings2} title="Calibration & Settings"
        actions={<Button variant="primary" icon={Save} loading={act.busy} disabled={!draft} onClick={save}>Save settings</Button>} />
      <Notice tone="warning" className="mb-4" title="Backend configuration ≠ firmware configuration">
        {s.data?.notice ?? "These settings configure the backend and dashboard only. They do not change the ESP32 firmware."} To change on-device thresholds or ADC calibration, edit the constants in
        <code className="mx-1 font-mono text-xs">firmware/esp32_landslide_monitor/esp32_landslide_monitor.ino</code> and re-flash. No device-configuration protocol exists in this project.
      </Notice>
      {saved && <Notice tone="success" className="mb-4">Settings saved.</Notice>}
      {act.error && <Notice tone="danger" className="mb-4">{act.error}</Notice>}

      <Async state={s}>{() => !draft || !t ? null : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card title="Dashboard & data" icon={SlidersHorizontal}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Dashboard refresh rate" hint="How often pages poll the backend">
                <Select value={draft.dashboard_refresh_ms} onChange={(e) => set("dashboard_refresh_ms", Number(e.target.value))}>
                  {[1000, 2000, 4000, 5000, 10000, 30000].map((v) => <option key={v} value={v}>{v / 1000} s</option>)}
                </Select>
              </Field>
              <Field label="Device offline timeout (s)" hint="No telemetry for this long → offline (firmware posts every ~4 s)"><NumIn value={draft.device_offline_timeout_sec} onChange={(v) => set("device_offline_timeout_sec", v)} /></Field>
              <Field label="Expected telemetry interval (s)"><NumIn value={draft.expected_telemetry_interval_sec} step={0.5} onChange={(v) => set("expected_telemetry_interval_sec", v)} /></Field>
              <Field label="Missing-telemetry factor" hint={`gap alert after ${(draft.expected_telemetry_interval_sec * draft.telemetry_gap_factor).toFixed(1)} s`}><NumIn value={draft.telemetry_gap_factor} step={0.5} onChange={(v) => set("telemetry_gap_factor", v)} /></Field>
              <Field label="Data retention (days)" hint="0 = keep forever; older readings are deleted hourly"><NumIn value={draft.data_retention_days} onChange={(v) => set("data_retention_days", v)} /></Field>
              <Field label="Max points per chart" hint="Longer windows are time-bucketed"><NumIn value={draft.chart_max_points} step={50} onChange={(v) => set("chart_max_points", v)} /></Field>
            </div>
            <div className="mt-4 flex flex-wrap gap-5">
              <Toggle checked={draft.time_format_24h} onChange={(v) => set("time_format_24h", v)} label="24-hour time format" />
            </div>
          </Card>

          <Card title="Backend analysis thresholds" icon={SlidersHorizontal} subtitle="Used for chart threshold lines, the rule-based explanation, the backend score cross-check and Demo Mode. Defaults = firmware constants."
            actions={<Button size="sm" icon={RotateCcw} onClick={() => act.run(async () => { const r = await api.resetThresholds(); setDraft(r.settings); await refreshSettings(); })}>Reset to firmware defaults</Button>}>
            <div className="space-y-4">
              <Ladder4 label="Soil Moisture Index sub-risk breakpoints" unit="index" v={t.moisture} onChange={(v) => setT("moisture", v)} />
              <Ladder4 label="Rain Activity Index sub-risk breakpoints" unit="index" v={t.rain} onChange={(v) => setT("rain", v)} />
              <Ladder4 label="Slope Tilt Change sub-risk breakpoints" unit="°" v={t.tilt} onChange={(v) => setT("tilt", v)} />
              <div>
                <div className="mb-1 text-xs font-medium text-slate-300">Weights (must sum to 1.0) — currently {(t.weights.moisture + t.weights.rain + t.weights.tilt).toFixed(2)}</div>
                <div className="grid grid-cols-3 gap-2">
                  {(["moisture", "rain", "tilt"] as const).map((k) => <Field key={k} label={k}><NumIn value={t.weights[k]} step={0.05} onChange={(v) => setT("weights", { ...t.weights, [k]: v })} /></Field>)}
                </div>
              </div>
              <div>
                <div className="mb-1 text-xs font-medium text-slate-300">Score cut-offs (0–100)</div>
                <div className="grid grid-cols-3 gap-2">
                  {(["watch", "warning", "critical"] as const).map((k) => <Field key={k} label={k.toUpperCase()}><NumIn value={t.score_cutoffs[k]} onChange={(v) => setT("score_cutoffs", { ...t.score_cutoffs, [k]: v })} /></Field>)}
                </div>
              </div>
              {(["moisture_rate", "tilt_rate"] as const).map((lk) => (
                <div key={lk}>
                  <div className="mb-1 text-xs font-medium text-slate-300">{lk === "moisture_rate" ? "Moisture rate override (%-pts/min)" : "Tilt rate override (°/min)"}</div>
                  <div className="grid grid-cols-4 gap-2">
                    {(["watch", "warning", "critical", "hysteresis"] as const).map((k) => <Field key={k} label={k}><NumIn value={t[lk][k]} step={0.05} onChange={(v) => setT(lk, { ...t[lk], [k]: v })} /></Field>)}
                  </div>
                </div>
              ))}
              <div className="grid grid-cols-3 gap-2">
                <Field label="Trigger persistence (samples)"><NumIn value={t.rate_trigger_persist} onChange={(v) => setT("rate_trigger_persist", v)} /></Field>
                <Field label="Clear persistence (samples)"><NumIn value={t.rate_clear_persist} onChange={(v) => setT("rate_clear_persist", v)} /></Field>
                <Field label="Cross-check tolerance (pts)"><NumIn value={t.score_mismatch_tolerance} step={0.5} onChange={(v) => setT("score_mismatch_tolerance", v)} /></Field>
              </div>
              <p className="text-[11px] text-slate-500">All thresholds are illustrative prototype parameters requiring calibration on the physical slope; they are not geotechnical constants.</p>
            </div>
          </Card>

          <Card title="Firmware configuration (read-only reference)" icon={Cpu} subtitle="Values compiled into the supplied sketch. Change them in the .ino and re-flash." className="xl:col-span-2">
            <Async state={info}>{() => {
              const cal = (fw.calibration ?? {}) as Record<string, number>;
              const pins = (fw.pins ?? {}) as Record<string, string>;
              return (
                <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                  <KV cols={1} items={[["Board", String(fw.board ?? "")], ["Sample interval", `${fw.sample_interval_ms} ms`], ["Telemetry interval", `${fw.telemetry_interval_ms} ms`], ["ADC oversamples", String(fw.adc_oversamples)], ["Complementary filter α", String(fw.complementary_alpha)], ["EMA value / rate α", `${fw.ema_value_alpha} / ${fw.ema_rate_alpha}`]]} />
                  <KV cols={1} items={[["SOIL_ADC_DRY / WET", `${cal.soil_adc_dry} / ${cal.soil_adc_wet}`], ["RAIN_ADC_DRY / WET", `${cal.rain_adc_dry} / ${cal.rain_adc_wet}`], ["ADC fault window", "15 – 4085"], ["MPU6050 address", String(fw.mpu6050_address)], ["Tilt baseline", "40 samples at boot; serial 'c' re-zeroes"]]} />
                  <KV cols={1} items={Object.entries(pins).map(([k, v]) => [k.replace(/_/g, " "), v] as [string, string])} />
                </div>
              );
            }}</Async>
            <Notice tone="info" className="mt-4" title="Calibrating the sensors">
              Over serial (115200 baud) type <code>r</code> to print raw ADC values: record soil ADC in dry soil and in saturated soil, and the rain plate dry and wet, then set
              <code className="mx-1">SOIL_ADC_DRY/WET</code> and <code className="mx-1">RAIN_ADC_DRY/WET</code>. Type <code>c</code> with the slope stationary to re-capture the tilt baseline.
            </Notice>
          </Card>
        </div>
      )}</Async>
    </>
  );
}
