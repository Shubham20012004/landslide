import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw, X, XCircle, type LucideIcon } from "lucide-react";
import { forwardRef, useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { humanize, riskColor } from "../utils/format";

/* ------------------------------------------------------------------ layout */
export function PageHeader({ title, subtitle, icon: Icon, actions }: { title: string; subtitle?: ReactNode; icon?: LucideIcon; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        {Icon && (
          <div className="mt-0.5 rounded-lg border border-line bg-ink-800 p-2 text-accent">
            <Icon size={18} />
          </div>
        )}
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">{title}</h1>
          {subtitle && <p className="mt-0.5 max-w-3xl text-sm text-slate-400">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, className, bodyClass, icon: Icon }: {
  title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; bodyClass?: string; icon?: LucideIcon;
}) {
  return (
    <section className={clsx("rounded-xl border border-line bg-ink-800/80 shadow-card", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {Icon && <Icon size={15} className="shrink-0 text-slate-400" />}
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-slate-200">{title}</h2>
              {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
            </div>
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={clsx("p-4", bodyClass)}>{children}</div>
    </section>
  );
}

export function MetricCard({ label, value, unit, hint, icon: Icon, accent, children, tone }: {
  label: string; value: ReactNode; unit?: string; hint?: ReactNode; icon?: LucideIcon; accent?: string; children?: ReactNode; tone?: "muted";
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-ink-800/80 p-4 shadow-card">
      {accent && <div className="absolute inset-y-0 left-0 w-1" style={{ background: accent }} />}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</span>
        {Icon && <Icon size={15} className="text-slate-500" />}
      </div>
      <div className={clsx("mt-2 flex items-baseline gap-1.5", tone === "muted" ? "text-slate-400" : "text-slate-50")}>
        <span className="font-mono text-2xl font-semibold tabular-nums">{value}</span>
        {unit && <span className="text-xs text-slate-500">{unit}</span>}
      </div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ badges */
export function RiskBadge({ state, size = "md", label }: { state?: string | null; size?: "sm" | "md" | "lg"; label?: string }) {
  if (!state) return <span className="text-slate-500">—</span>;
  const c = riskColor(state);
  return (
    <span
      className={clsx("inline-flex items-center gap-1.5 rounded-md border font-semibold tracking-wide",
        size === "sm" && "px-1.5 py-0.5 text-[10px]", size === "md" && "px-2 py-0.5 text-xs", size === "lg" && "px-3 py-1 text-sm")}
      style={{ color: c, borderColor: `${c}55`, background: `${c}18` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
      {label ?? state.replace("_", " ")}
    </span>
  );
}

const BADGE_TONES = {
  slate: "border-slate-600/50 bg-slate-500/10 text-slate-300",
  sky: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  green: "border-green-500/40 bg-green-500/10 text-green-300",
  amber: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  red: "border-red-500/40 bg-red-500/10 text-red-300",
  violet: "border-violet-500/40 bg-violet-500/10 text-violet-300",
};
export type Tone = keyof typeof BADGE_TONES;

export function Badge({ children, tone = "slate", className, title }: { children: ReactNode; tone?: Tone; className?: string; title?: string }) {
  return (
    <span title={title} className={clsx("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium", BADGE_TONES[tone], className)}>
      {children}
    </span>
  );
}

export function HealthBadge({ health }: { health?: string | null }) {
  if (!health) return <Badge>unknown</Badge>;
  if (health === "OK") return <Badge tone="green">Sensors OK</Badge>;
  return <Badge tone="violet">{humanize(health)}</Badge>;
}

export function SimBadge() {
  return <Badge tone="violet" title="Generated by Demo Mode; not a measurement">SIMULATED</Badge>;
}

export function SeverityBadge({ severity }: { severity: string }) {
  const tone: Tone = severity === "critical" ? "red" : severity === "warning" ? "amber" : "sky";
  return <Badge tone={tone}>{severity}</Badge>;
}

export function StatusDot({ online, label }: { online: boolean | null; label?: string }) {
  const c = online === null ? "bg-slate-500" : online ? "bg-green-500" : "bg-red-500";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className="relative flex h-2 w-2">
        {online && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60" />}
        <span className={clsx("relative inline-flex h-2 w-2 rounded-full", c)} />
      </span>
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ controls */
export function Button({ variant = "secondary", size = "md", icon: Icon, loading, children, className, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm" | "md"; icon?: LucideIcon; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg border font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
        variant === "primary" && "border-sky-500/60 bg-sky-500/90 text-ink-950 hover:bg-sky-400",
        variant === "secondary" && "border-line bg-ink-750 text-slate-200 hover:border-ink-500 hover:bg-ink-700",
        variant === "danger" && "border-red-500/50 bg-red-500/10 text-red-300 hover:bg-red-500/20",
        variant === "ghost" && "border-transparent bg-transparent text-slate-300 hover:bg-ink-750",
        className,
      )}
    >
      {loading ? <Loader2 size={14} className="animate-spin" /> : Icon ? <Icon size={14} /> : null}
      {children}
    </button>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}

/** Default to full width unless the caller supplies its own width class. */
const widthCls = (className?: string) => (className && /(^|\s)(w-|min-w-)/.test(className) ? "" : "w-full");

const inputCls =
  "rounded-lg border border-line bg-ink-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-500/60 focus:outline-none focus:ring-1 focus:ring-sky-500/40 disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(props, ref) {
  return <input ref={ref} {...props} className={clsx(inputCls, widthCls(props.className), props.className)} />;
});

export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={clsx(inputCls, "pr-8", widthCls(props.className), props.className)}>
      {children}
    </select>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className="inline-flex cursor-pointer select-none items-center gap-2 text-sm text-slate-300">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx("relative h-5 w-9 rounded-full border transition-colors", checked ? "border-sky-500 bg-sky-500/80" : "border-line bg-ink-700")}
      >
        <span className={clsx("absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-transform", checked ? "translate-x-4" : "translate-x-0.5")} />
      </button>
      {label}
    </label>
  );
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-ink-900 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={clsx("rounded-md px-2.5 py-1 text-xs font-medium transition-colors", value === o.value ? "bg-ink-700 text-slate-50" : "text-slate-400 hover:text-slate-200")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="mb-4 flex gap-1 border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={clsx("-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            value === t.value ? "border-sky-400 text-slate-100" : "border-transparent text-slate-400 hover:text-slate-200")}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 rounded bg-ink-700 px-1.5 text-[11px] text-slate-400">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ states */
export function Notice({ tone = "info", title, children, className }: { tone?: "info" | "warning" | "danger" | "success" | "sim"; title?: ReactNode; children?: ReactNode; className?: string }) {
  const map = {
    info: { cls: "border-sky-500/30 bg-sky-500/5 text-sky-200", Icon: Info },
    warning: { cls: "border-amber-500/30 bg-amber-500/5 text-amber-200", Icon: AlertTriangle },
    danger: { cls: "border-red-500/30 bg-red-500/5 text-red-200", Icon: XCircle },
    success: { cls: "border-green-500/30 bg-green-500/5 text-green-200", Icon: CheckCircle2 },
    sim: { cls: "border-violet-500/40 bg-violet-500/10 text-violet-200", Icon: AlertTriangle },
  }[tone];
  return (
    <div className={clsx("flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm", map.cls, className)}>
      <map.Icon size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className={clsx("text-[13px] opacity-90", title && "mt-0.5")}>{children}</div>}
      </div>
    </div>
  );
}

export function Loading({ label = "Loading…", className }: { label?: string; className?: string }) {
  return (
    <div className={clsx("flex items-center justify-center gap-2 py-10 text-sm text-slate-500", className)}>
      <Loader2 size={16} className="animate-spin" /> {label}
    </div>
  );
}

export function EmptyState({ icon: Icon = Info, title, children, action }: { icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      <div className="rounded-full border border-line bg-ink-850 p-3 text-slate-500">
        <Icon size={20} />
      </div>
      <div className="mt-3 text-sm font-medium text-slate-300">{title}</div>
      {children && <div className="mt-1 max-w-md text-xs text-slate-500">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: { message: string } | string; onRetry?: () => void }) {
  const msg = typeof error === "string" ? error : error.message;
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <XCircle className="text-red-400" size={22} />
      <div className="max-w-lg text-sm text-red-200">{msg}</div>
      {onRetry && (
        <Button size="sm" icon={RefreshCw} onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

/** Render loading / error / content for an async resource. */
export function Async<T>({ state, children, empty }: { state: { data: T | null; error: { message: string } | null; loading: boolean; reload: () => void }; children: (d: T) => ReactNode; empty?: ReactNode }) {
  if (state.error && !state.data) return <ErrorState error={state.error} onRetry={state.reload} />;
  if (!state.data) return state.loading ? <Loading /> : <>{empty}</>;
  return <>{children(state.data)}</>;
}

/* ------------------------------------------------------------------ dialogs */
export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={clsx("max-h-[90vh] w-full overflow-hidden rounded-xl border border-line bg-ink-850 shadow-2xl", wide ? "max-w-4xl" : "max-w-lg")}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-ink-700 hover:text-slate-100" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-4 text-sm text-slate-300">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, children, confirmLabel = "Confirm", danger, busy, onConfirm, onCancel }: {
  open: boolean; title: string; children: ReactNode; confirmLabel?: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={danger ? "danger" : "primary"} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

/* ------------------------------------------------------------------ tables */
export function Table({ head, children, className, dense }: { head: ReactNode[]; children: ReactNode; className?: string; dense?: boolean }) {
  return (
    <div className={clsx("overflow-x-auto rounded-lg border border-line", className)}>
      <table className="w-full min-w-max text-left text-sm">
        <thead className="bg-ink-850 text-[11px] uppercase tracking-wider text-slate-400">
          <tr>
            {head.map((h, i) => (
              <th key={i} className={clsx("whitespace-nowrap px-3 font-medium", dense ? "py-1.5" : "py-2")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={clsx("divide-y divide-line/60 text-slate-300", dense && "text-xs")}>{children}</tbody>
      </table>
    </div>
  );
}

export function Pagination({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  return (
    <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
      <span>
        {total.toLocaleString()} record{total === 1 ? "" : "s"}
      </span>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <span className="font-mono">
          {page} / {Math.max(pages, 1)}
        </span>
        <Button size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

export function KV({ items, cols = 2 }: { items: [ReactNode, ReactNode][]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={clsx("grid gap-x-6 gap-y-2 text-sm", cols === 1 && "grid-cols-1", cols === 2 && "grid-cols-1 sm:grid-cols-2", cols === 3 && "grid-cols-1 sm:grid-cols-3")}>
      {items.map(([k, v], i) => (
        <div key={i} className="flex items-baseline justify-between gap-3 border-b border-line/40 pb-1.5">
          <dt className="text-slate-500">{k}</dt>
          <dd className="text-right font-medium text-slate-200">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
