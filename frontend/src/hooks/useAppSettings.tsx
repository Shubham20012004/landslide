import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "../services/api";
import type { AppSettings, DemoStatus } from "../types";
import { setTimeFormat24h } from "../utils/format";

interface Ctx {
  settings: AppSettings | null;
  refreshSettings: () => Promise<void>;
  demo: DemoStatus | null;
  refreshDemo: () => Promise<void>;
  backendOnline: boolean | null;
}

const AppCtx = createContext<Ctx>({
  settings: null,
  refreshSettings: async () => {},
  demo: null,
  refreshDemo: async () => {},
  backendOnline: null,
});

export function AppSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [demo, setDemo] = useState<DemoStatus | null>(null);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);

  const refreshSettings = useCallback(async () => {
    try {
      const r = await api.settings();
      setSettings(r.settings);
      setTimeFormat24h(r.settings.time_format_24h);
      setBackendOnline(true);
    } catch {
      setBackendOnline(false);
    }
  }, []);

  const refreshDemo = useCallback(async () => {
    try {
      setDemo(await api.demoStatus());
      setBackendOnline(true);
    } catch {
      setBackendOnline(false);
    }
  }, []);

  useEffect(() => {
    refreshSettings();
    refreshDemo();
    const id = window.setInterval(() => {
      refreshDemo();
      if (!settings) refreshSettings();
    }, 5000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <AppCtx.Provider value={{ settings, refreshSettings, demo, refreshDemo, backendOnline }}>{children}</AppCtx.Provider>;
}

export const useAppSettings = () => useContext(AppCtx);

/** Dashboard refresh interval from settings (defaults to the firmware's 4 s telemetry period). */
export function useRefreshMs(): number {
  const { settings } = useAppSettings();
  return settings?.dashboard_refresh_ms ?? 4000;
}
