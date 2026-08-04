import { useEffect, useState, useCallback, lazy, Suspense } from "react";
import {
  LayoutDashboard, Moon, Activity, Dumbbell, Sparkles, FileText, Utensils,
  RefreshCw, Circle, Menu, X, Upload, Power, ScrollText, Search, Sun, Bell, BellOff,
} from "lucide-react";
import { api } from "./lib/api";
import { COLORS } from "./lib/format";
import Changelog from "./components/Changelog";
import ErrorBoundary from "./components/ErrorBoundary";
import CommandPalette from "./components/CommandPalette";
import { useReminders } from "./lib/useReminders";
import { Loading } from "./components/primitives";

// Each view is its own chunk — the initial bundle only needs to ship the app
// shell, not every page's charting/AI code before the user's even logged in.
const Dashboard = lazy(() => import("./views/Dashboard"));
const Sleep = lazy(() => import("./views/Sleep"));
const Training = lazy(() => import("./views/Training"));
const Strength = lazy(() => import("./views/Strength"));
const Nutrition = lazy(() => import("./views/Nutrition"));
const Insights = lazy(() => import("./views/Insights"));
const Reports = lazy(() => import("./views/Reports"));

const NAV = [
  { id: "dashboard", label: "Overview", icon: LayoutDashboard, color: COLORS.recovery },
  { id: "sleep", label: "Sleep", icon: Moon, color: COLORS.sleep },
  { id: "training", label: "Cardio", icon: Activity, color: COLORS.cardio },
  { id: "strength", label: "Strength", icon: Dumbbell, color: COLORS.strength },
  { id: "nutrition", label: "Nutrition", icon: Utensils, color: COLORS.nutrition },
  { id: "insights", label: "Coach", icon: Sparkles, color: COLORS.recovery },
  { id: "reports", label: "Reports", icon: FileText, color: COLORS.strength },
];

function Dot({ ok }) {
  return <Circle size={8} className={ok ? "fill-recovery text-recovery" : "fill-faint text-faint"} />;
}

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem("pulse.theme") || "dark");
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme === "light" ? "light" : "dark");
    localStorage.setItem("pulse.theme", theme);
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "light" ? "dark" : "light"))];
}

export default function App() {
  const [view, setView] = useState("dashboard");
  const [theme, toggleTheme] = useTheme();
  const reminders = useReminders();
  const [status, setStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);

  const refresh = useCallback(() => api.status().then(setStatus).catch(() => {}), []);
  useEffect(() => { refresh(); }, [refresh]);

  // poll status while a sync is running
  useEffect(() => {
    if (!syncing) return;
    const t = setInterval(async () => {
      const s = await api.status().catch(() => null);
      if (s) {
        setStatus(s);
        const running = s.recent_syncs?.some((x) => x.status === "running");
        if (!running) { setSyncing(false); }
      }
    }, 2500);
    return () => clearInterval(t);
  }, [syncing]);

  async function runSync() {
    setSyncing(true);
    try { await api.syncAll(); } catch { setSyncing(false); }
    setTimeout(refresh, 1000);
  }

  async function onUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSyncing(true);
    try { await api.uploadHevyCsv(file); } catch (err) { console.error(err); }
    e.target.value = "";
    setTimeout(() => { refresh(); setSyncing(false); }, 800);
  }

  const [restarting, setRestarting] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  async function handleRestart() {
    if (!window.confirm("Restart the Pulse server? It'll be back in a few seconds.")) return;
    setRestarting(true);
    try { await api.restartServer(); } catch { /* connection drops mid-restart, expected */ }
    // Poll /api/health until the new process is back up, then reload.
    const start = Date.now();
    const poll = setInterval(async () => {
      try {
        const res = await fetch("/api/health");
        if (res.ok) { clearInterval(poll); window.location.reload(); }
      } catch { /* still restarting */ }
      if (Date.now() - start > 30000) clearInterval(poll);
    }, 1000);
  }

  const conn = status?.connections;
  const isDemo = status && status.recent_syncs?.length === 0 && (status.counts?.daily_health || 0) > 0;

  const Views = { dashboard: Dashboard, sleep: Sleep, training: Training, strength: Strength, nutrition: Nutrition, reports: Reports };
  const Current = view === "insights" ? null : Views[view];

  return (
    <div className="flex min-h-screen">
      {/* sidebar */}
      <aside className={`safe-top safe-bottom fixed inset-y-0 left-0 z-40 w-60 overflow-y-auto border-r border-line bg-ink/95 backdrop-blur-lg transition-transform lg:translate-x-0 ${mobileNav ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="relative flex h-8 w-8 items-center justify-center">
            <span className="absolute h-8 w-8 rounded-full bg-effort/20" />
            <span className="absolute h-4 w-4 animate-ping rounded-full bg-effort/40" />
            <span className="relative h-2.5 w-2.5 rounded-full bg-effort" />
          </div>
          <div>
            <div className="font-display text-lg font-bold leading-none tracking-tight">PULSE</div>
            <div className="text-[10px] tracking-wide text-faint">your body, instrumented</div>
          </div>
          <button className="ml-auto lg:hidden" onClick={() => setMobileNav(false)}><X size={18} /></button>
        </div>

        <nav className="mt-2 space-y-1 px-3">
          {NAV.map((n) => {
            const active = view === n.id;
            const Icon = n.icon;
            return (
              <button key={n.id} onClick={() => { setView(n.id); setMobileNav(false); }}
                className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
                  active ? "bg-panel text-txt" : "text-muted hover:bg-panel/60 hover:text-txt"
                }`}>
                <Icon size={17} style={{ color: active ? n.color : undefined }} />
                <span className="font-medium">{n.label}</span>
                {active && <span className="ml-auto h-1.5 w-1.5 rounded-full" style={{ background: n.color }} />}
              </button>
            );
          })}
        </nav>

        {/* connection panel */}
        <div className="absolute inset-x-3 bottom-4 rounded-xl border border-line bg-panel/70 p-3">
          <div className="mb-2 text-[10px] uppercase tracking-wider text-faint">Connections</div>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between"><span className="text-muted">Garmin</span><Dot ok={conn?.garmin} /></div>
            <div className="flex items-center justify-between"><span className="text-muted">Hevy · {conn?.hevy?.mode || "—"}</span><Dot ok={conn?.hevy?.configured} /></div>
            <div className="flex items-center justify-between"><span className="text-muted">Anthropic</span><Dot ok={conn?.ai?.anthropic} /></div>
            <div className="flex items-center justify-between"><span className="text-muted">OpenAI</span><Dot ok={conn?.ai?.openai} /></div>
          </div>
          {isDemo && (
            <div className="mt-2 rounded-md bg-strength/10 px-2 py-1 text-[10px] text-strength">
              demo data · connect to go live
            </div>
          )}
        </div>
      </aside>

      {/* main */}
      <div className="flex-1 lg:pl-60">
        <header className="safe-top sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-ink/80 px-4 py-3 backdrop-blur-lg sm:px-6">
          <button className="lg:hidden" onClick={() => setMobileNav(true)}><Menu size={20} /></button>
          <h1 className="font-display text-base font-semibold capitalize">
            {NAV.find((n) => n.id === view)?.label}
          </h1>
          <div className="ml-auto flex items-center gap-2">
            {status && (
              <span className="hidden font-mono text-[11px] text-faint sm:inline tnum">
                {status.counts.daily_health}d · {status.counts.activities} runs · {status.counts.workouts} lifts
              </span>
            )}
            {conn?.hevy?.mode === "csv" && (
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-medium text-txt transition hover:border-strength/40">
                <Upload size={13} className="text-strength" />
                <span className="hidden sm:inline">Import CSV</span>
                <input type="file" accept=".csv" className="hidden" onChange={onUpload} />
              </label>
            )}
            <button onClick={runSync} disabled={syncing}
              className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-medium text-txt transition hover:border-recovery/40 disabled:opacity-60">
              <RefreshCw size={13} className={syncing ? "animate-spin text-recovery" : ""} />
              {syncing ? "Syncing…" : "Sync"}
            </button>
            <button onClick={handleRestart} disabled={restarting} title="Restart server"
              className="flex items-center gap-2 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs font-medium text-txt transition hover:border-effort/40 disabled:opacity-60">
              <Power size={13} className={restarting ? "animate-pulse text-effort" : ""} />
              <span className="hidden sm:inline">{restarting ? "Restarting…" : "Restart"}</span>
            </button>
            <button onClick={() => setShowChangelog(true)} title="What's new"
              className="flex items-center gap-2 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs font-medium text-txt transition hover:border-recovery/40">
              <ScrollText size={13} />
            </button>
            <button onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}
              title="Search (Ctrl+K)"
              className="hidden items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs font-medium text-faint transition hover:border-recovery/40 hover:text-txt sm:flex">
              <Search size={13} /> <kbd className="text-[10px]">Ctrl K</kbd>
            </button>
            <button onClick={toggleTheme} title={theme === "light" ? "Switch to dark" : "Switch to light"}
              className="flex items-center gap-2 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs font-medium text-txt transition hover:border-recovery/40">
              {theme === "light" ? <Moon size={13} /> : <Sun size={13} />}
            </button>
            {reminders.supported && (
              <button onClick={() => (reminders.enabled ? reminders.disable() : reminders.enable())}
                title={reminders.enabled ? "Reminders on — click to disable" : "Enable weight/recovery reminders"}
                className="flex items-center gap-2 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs font-medium text-txt transition hover:border-recovery/40">
                {reminders.enabled ? <Bell size={13} className="text-recovery" /> : <BellOff size={13} />}
              </button>
            )}
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6">
          <ErrorBoundary key={view} resetKey={view}>
            <Suspense fallback={<Loading />}>
              {view === "insights"
                ? <Insights aiStatus={conn?.ai} />
                : view === "nutrition"
                ? <Nutrition aiStatus={conn?.ai} />
                : Current && <Current />}
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      {mobileNav && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setMobileNav(false)} />}

      <Changelog open={showChangelog} onClose={() => setShowChangelog(false)} />
      <CommandPalette onNavigate={setView} />
    </div>
  );
}
