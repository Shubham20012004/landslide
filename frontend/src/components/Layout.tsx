import clsx from "clsx";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BellRing,
  BrainCircuit,
  ChevronsLeft,
  ChevronsRight,
  Cpu,
  Database,
  FlaskConical,
  Gauge,
  Globe2,
  Info,
  LayoutDashboard,
  Menu,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useApi } from "../hooks/useApi";
import { useAppSettings } from "../hooks/useAppSettings";
import { api } from "../services/api";
import { fmtAgo } from "../utils/format";
import { Button, RiskBadge, StatusDot } from "./ui";

export const NAV = [
  { to: "/", label: "Overview Dashboard", icon: LayoutDashboard, group: "Monitoring" },
  { to: "/live", label: "Live Monitoring", icon: Activity, group: "Monitoring" },
  { to: "/analytics", label: "Sensor Analytics", icon: BarChart3, group: "Monitoring" },
  { to: "/historical", label: "Historical Intelligence", icon: Globe2, group: "Intelligence" },
  { to: "/datasets", label: "Dataset Management", icon: Database, group: "Intelligence" },
  { to: "/training", label: "AI Model Training", icon: FlaskConical, group: "AI / ML" },
  { to: "/evaluation", label: "Model Evaluation", icon: Gauge, group: "AI / ML" },
  { to: "/predictions", label: "AI Predictions", icon: BrainCircuit, group: "AI / ML" },
  { to: "/alerts", label: "Alerts & Event Logs", icon: BellRing, group: "Operations" },
  { to: "/devices", label: "Device Health", icon: Cpu, group: "Operations" },
  { to: "/settings", label: "Calibration & Settings", icon: Settings2, group: "Operations" },
  { to: "/system", label: "System Information", icon: Info, group: "Operations" },
];

function Sidebar({ collapsed, onToggle, mobile, onClose }: { collapsed: boolean; onToggle: () => void; mobile?: boolean; onClose?: () => void }) {
  const groups = Array.from(new Set(NAV.map((n) => n.group)));
  return (
    <aside
      className={clsx(
        "flex h-full flex-col border-r border-line bg-ink-950/95 transition-[width] duration-200",
        collapsed && !mobile ? "w-[68px]" : "w-64",
      )}
    >
      <div className="flex h-14 items-center gap-2.5 border-b border-line px-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/10">
          <svg viewBox="0 0 32 32" className="h-5 w-5">
            <path d="M3 26 L12 11 L18 18 L22 13 L29 26 Z" fill="#38bdf8" opacity=".9" />
            <circle cx="23" cy="7" r="3" fill="#ec835a" />
          </svg>
        </div>
        {(!collapsed || mobile) && (
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-semibold text-slate-100">Landslide Risk Monitor</div>
            <div className="truncate text-[11px] text-slate-500">ESP32 · AI-assisted prototype</div>
          </div>
        )}
        {mobile && (
          <button className="ml-auto rounded p-1 text-slate-400 hover:bg-ink-800" onClick={onClose} aria-label="Close menu">
            <X size={18} />
          </button>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {groups.map((g) => (
          <div key={g} className="mb-3">
            {(!collapsed || mobile) && <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600">{g}</div>}
            {NAV.filter((n) => n.group === g).map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === "/"}
                title={collapsed && !mobile ? n.label : undefined}
                onClick={onClose}
                className={({ isActive }) =>
                  clsx(
                    "group mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                    isActive ? "bg-sky-500/10 text-sky-300" : "text-slate-400 hover:bg-ink-800 hover:text-slate-200",
                    collapsed && !mobile && "justify-center px-0",
                  )
                }
              >
                <n.icon size={17} className="shrink-0" />
                {(!collapsed || mobile) && <span className="truncate">{n.label}</span>}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      {!mobile && (
        <button
          onClick={onToggle}
          className="flex items-center justify-center gap-2 border-t border-line py-3 text-xs text-slate-500 hover:text-slate-300"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronsRight size={16} /> : (<><ChevronsLeft size={16} /> Collapse</>)}
        </button>
      )}
    </aside>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const { backendOnline, demo } = useAppSettings();
  const devices = useApi(() => api.devices(), [], 4000);
  const loc = useLocation();
  const page = NAV.find((n) => (n.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(n.to)));
  const devs = devices.data?.devices ?? [];
  const real = devs.filter((d) => !d.is_simulated);
  const primary = real[0] ?? devs[0];
  return (
    <header className="sticky top-0 z-[1000] flex h-14 items-center gap-3 border-b border-line bg-ink-900/85 px-4 backdrop-blur">
      <button className="rounded p-1.5 text-slate-400 hover:bg-ink-800 lg:hidden" onClick={onMenu} aria-label="Open menu">
        <Menu size={18} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-slate-200">{page?.label ?? "Landslide Risk Monitor"}</div>
        <div className="hidden truncate text-[11px] text-slate-500 sm:block">
          IoT-Based Multi-Parameter Landslide Risk Monitoring and AI-Assisted Early Warning System Using ESP32
        </div>
      </div>
      <div className="flex items-center gap-3">
        {demo?.running && (
          <span className="hidden items-center gap-1 rounded-md border border-violet-500/40 bg-violet-500/10 px-2 py-1 text-[11px] font-semibold text-violet-300 md:inline-flex">
            <Sparkles size={12} /> DEMO MODE
          </span>
        )}
        {primary ? (
          <div className="hidden items-center gap-2 rounded-lg border border-line bg-ink-800 px-2.5 py-1.5 md:flex" title={`Last telemetry ${fmtAgo(primary.last_seen)}`}>
            <StatusDot online={primary.online} />
            <span className="max-w-[160px] truncate font-mono text-xs text-slate-300">{primary.device_id}</span>
            <RiskBadge state={primary.online ? primary.last_risk_state : null} size="sm" />
            {!primary.online && <span className="text-[11px] text-red-300">offline</span>}
          </div>
        ) : (
          <span className="hidden text-xs text-slate-500 md:inline">No device yet</span>
        )}
        <div className="flex items-center gap-1.5 rounded-lg border border-line bg-ink-800 px-2.5 py-1.5" title="FastAPI backend">
          <StatusDot online={backendOnline} />
          <span className="text-xs text-slate-400">API</span>
        </div>
      </div>
    </header>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("sidebar-collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const { backendOnline, demo, refreshDemo } = useAppSettings();
  const loc = useLocation();
  useEffect(() => setMobileOpen(false), [loc.pathname]);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("sidebar-collapsed", c ? "0" : "1");
      } catch {
        /* storage unavailable */
      }
      return !c;
    });
  };
  return (
    <div className="flex h-screen overflow-hidden bg-ink-900 text-slate-200">
      <div className="hidden lg:block">
        <Sidebar collapsed={collapsed} onToggle={toggle} />
      </div>
      {mobileOpen && (
        <div className="fixed inset-0 z-[1500] flex lg:hidden">
          <Sidebar collapsed={false} onToggle={toggle} mobile onClose={() => setMobileOpen(false)} />
          <div className="flex-1 bg-black/60" onClick={() => setMobileOpen(false)} />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          {backendOnline === false && (
            <div className="flex items-center gap-2 border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">
              <AlertTriangle size={15} /> Backend unreachable. Start it with <code className="font-mono text-xs">uvicorn app.main:app --host 0.0.0.0 --port 8000</code> in <code className="font-mono text-xs">backend/</code>.
            </div>
          )}
          {demo?.running && (
            <div className="flex flex-wrap items-center gap-2 border-b border-violet-500/30 bg-[repeating-linear-gradient(135deg,rgba(139,92,246,0.10)_0_10px,rgba(139,92,246,0.04)_10px_20px)] px-4 py-2 text-sm text-violet-100">
              <Sparkles size={15} className="text-violet-300" />
              <b>DEMO MODE</b> — scenario “{demo.scenario_label}” is generating <b>SIMULATED</b> telemetry for <code className="font-mono text-xs">{demo.device_id}</code>. These are not sensor measurements.
              <Button size="sm" variant="ghost" className="ml-auto" onClick={async () => { await api.demoStop(); refreshDemo(); }}>
                Stop demo
              </Button>
            </div>
          )}
          <div className="mx-auto max-w-[1600px] p-4 md:p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}
