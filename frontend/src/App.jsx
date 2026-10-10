import { useEffect, useState, useCallback, lazy, Suspense } from "react";
import {
  LayoutDashboard, Moon, Activity, Dumbbell, Sparkles, FileText, Utensils,
  RefreshCw, Circle, Menu, X, Upload, ScrollText, Search, Sun, Bell, BellOff,
  MoreHorizontal, CalendarDays, FlaskConical, Settings2,
  LogOut,
} from "lucide-react";
import { api } from "./lib/api";
import { COLORS } from "./lib/format";
import Changelog from "./components/Changelog";
import ErrorBoundary from "./components/ErrorBoundary";
import CommandPalette from "./components/CommandPalette";
import { useReminders } from "./lib/useReminders";
import { Loading } from "./components/primitives";
import AuthGate from "./components/AuthGate";
import QuickLog from "./components/QuickLog";
import ToastHost from "./components/ToastHost";
import { hashForRoute, routeFromHash } from "./lib/navigation";

// Each view is its own chunk - the initial bundle only needs to ship the app
// shell, not every page's charting/AI code before the user's even logged in.
const Dashboard = lazy(() => import("./views/Dashboard"));
const Sleep = lazy(() => import("./views/Sleep"));
const Training = lazy(() => import("./views/Training"));
const Strength = lazy(() => import("./views/Strength"));
const Nutrition = lazy(() => import("./views/Nutrition"));
const Insights = lazy(() => import("./views/Insights"));
const Reports = lazy(() => import("./views/Reports"));
const Planner = lazy(() => import("./views/Planner"));
const Lab = lazy(() => import("./views/Lab"));
const Settings = lazy(() => import("./views/Settings"));

const NAV = [
  { id: "dashboard", label: "Today", group: "Today", icon: LayoutDashboard, color: COLORS.recovery },
  { id: "planner", label: "Plan", group: "Train", icon: CalendarDays, color: COLORS.cardio },
  { id: "training", label: "Cardio", group: "Train", icon: Activity, color: COLORS.cardio },
  { id: "strength", label: "Strength", group: "Train", icon: Dumbbell, color: COLORS.strength },
  { id: "sleep", label: "Sleep", group: "Health", icon: Moon, color: COLORS.sleep },
  { id: "nutrition", label: "Nutrition", group: "Health", icon: Utensils, color: COLORS.nutrition },
  { id: "lab", label: "Lab", group: "Health", icon: FlaskConical, color: COLORS.strength },
  { id: "insights", label: "Coach", group: "Review", icon: Sparkles, color: COLORS.recovery },
  { id: "reports", label: "Reports", group: "Review", icon: FileText, color: COLORS.strength },
  { id: "settings", label: "Settings", group: "System", icon: Settings2, color: COLORS.muted },
];
const NAV_GROUPS = ["Today", "Train", "Health", "Review", "System"];
const MOBILE_NAV = ["dashboard", "planner", "training", "nutrition"];

function hashView() {
  return routeFromHash(window.location.hash, NAV.map((item) => item.id));
}

function Dot({ ok }) {
  return <Circle aria-hidden="true" size={8} className={ok ? "fill-recovery text-recovery" : "fill-faint text-faint"} />;
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
  const [auth, setAuth] = useState(null);
  const [view, setView] = useState(hashView);
  const [theme, toggleTheme] = useTheme();
  const reminders = useReminders();
  const [status, setStatus] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [mobileActions, setMobileActions] = useState(false);
  const navigate = useCallback((next) => {
    if (!NAV.some((item) => item.id === next)) return;
    if (hashView() === next) setView(next);
    else window.location.hash = hashForRoute(next);
    setMobileNav(false);
    setMobileActions(false);
  }, []);
  useEffect(() => {
    const update = () => { setView(hashView()); window.scrollTo({ top: 0, behavior: "auto" }); };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  const refresh = useCallback(() => api.status().then(setStatus).catch(() => {}), []);
  const checkAuth = useCallback(() => api.authStatus().then(setAuth).catch(() => setAuth({ configured: true, authenticated: false, setup_allowed: false })), []);
  useEffect(() => { checkAuth(); const lock=()=>checkAuth(); window.addEventListener("pulse:unauthorized", lock); return()=>window.removeEventListener("pulse:unauthorized", lock); }, [checkAuth]);
  useEffect(() => { if (auth?.authenticated) refresh(); }, [refresh, auth?.authenticated]);

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
  async function handleLogout() { await api.authLogout().catch(() => {}); setStatus(null); checkAuth(); }

  const conn = status?.connections;
  const isDemo = status && status.recent_syncs?.length === 0 && (status.counts?.daily_health || 0) > 0;

  const Views = { dashboard: Dashboard, planner: Planner, lab: Lab, sleep: Sleep, training: Training, strength: Strength, nutrition: Nutrition, reports: Reports, settings: Settings };
  const Current = view === "insights" ? null : Views[view];

  if (!auth) return <div className="flex min-h-screen items-center justify-center"><Loading /></div>;
  if (!auth.authenticated) return <AuthGate status={auth} onAuthenticated={checkAuth} />;

  return (
    <div className="flex min-h-screen min-w-0 overflow-x-hidden">
      <a href="#main-content" onClick={(event)=>{event.preventDefault();document.getElementById("main-content")?.focus();}} className="fixed left-3 top-3 z-[120] -translate-y-20 rounded-lg bg-recovery px-3 py-2 font-semibold text-ink focus:translate-y-0">Skip to content</a>
      {/* sidebar */}
      <aside id="primary-navigation" aria-label="Application navigation" className={`safe-top safe-bottom fixed inset-y-0 left-0 z-40 w-60 overflow-y-auto border-r border-line bg-ink pb-4 transition-transform lg:translate-x-0 ${mobileNav ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span aria-hidden="true" className="h-3 w-3 rounded-full bg-effort" />
          <div className="font-display text-3xl font-semibold leading-none">Pulse</div>
          <button aria-label="Close navigation" className="ml-auto rounded-lg p-2 lg:hidden" onClick={() => setMobileNav(false)}><X size={18} /></button>
        </div>

        <nav className="mt-2 px-3">
          {NAV_GROUPS.map((group) => <div key={group} className="mb-3">
            {group !== "Today" && <div className="mb-1 px-3 text-sm text-faint">{group}</div>}
            <div className="space-y-1">{NAV.filter((item) => item.group === group).map((n) => {
            const active = view === n.id;
            const Icon = n.icon;
            return (
              <button key={n.id} aria-current={active ? "page" : undefined} onClick={() => navigate(n.id)}
                className={`group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] transition ${
                  active ? "bg-panel font-semibold text-txt" : "text-muted hover:bg-panel hover:text-txt"
                }`}>
                {active && <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full" style={{ background: n.color }} />}
                <Icon size={17} style={{ color: active ? n.color : undefined }} />
                <span>{n.label}</span>
              </button>
            );
          })}</div></div>)}
        </nav>

        {/* connection panel */}
        <div className="mx-3 mt-5 rounded-xl bg-panel p-3">
          <div className="mb-2 text-sm text-faint">Connected</div>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between"><span className="text-muted">Garmin</span><span className="sr-only">{conn?.garmin ? "connected" : "not connected"}</span><Dot ok={conn?.garmin} /></div>
            <div className="flex items-center justify-between"><span className="text-muted">Hevy · {conn?.hevy?.mode || "-"}</span><span className="sr-only">{conn?.hevy?.configured ? "connected" : "not connected"}</span><Dot ok={conn?.hevy?.configured} /></div>
            <div className="flex items-center justify-between"><span className="text-muted">Anthropic</span><span className="sr-only">{conn?.ai?.anthropic ? "connected" : "not connected"}</span><Dot ok={conn?.ai?.anthropic} /></div>
            <div className="flex items-center justify-between"><span className="text-muted">OpenAI</span><span className="sr-only">{conn?.ai?.openai ? "connected" : "not connected"}</span><Dot ok={conn?.ai?.openai} /></div>
          </div>
          {isDemo && (
            <div className="mt-2 rounded-md bg-strength/15 px-2 py-1 text-xs text-strength">
              Demo data. Connect Garmin to go live.
            </div>
          )}
        </div>
      </aside>

      {/* main */}
      <div className="min-w-0 flex-1 lg:pl-60">
        <header className="safe-top sticky top-0 z-30 flex min-w-0 items-center gap-2 border-b border-line bg-ink px-3 py-2.5 sm:gap-3 sm:px-6">
          <button aria-label="Open navigation" aria-expanded={mobileNav} aria-controls="primary-navigation" className="shrink-0 rounded-lg p-2 lg:hidden" onClick={() => setMobileNav(true)}><Menu size={20} /></button>
          <h1 className="min-w-0 truncate font-display text-2xl font-semibold">
            {NAV.find((n) => n.id === view)?.label}
          </h1>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {status && (
              <span className="hidden text-sm text-faint sm:inline tnum">
                {status.counts.activities} runs, {status.counts.workouts} lifts
              </span>
            )}
            {conn?.hevy?.mode === "csv" && (
              <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-panel px-3 py-1.5 text-xs font-medium text-txt transition hover:bg-panel2">
                <Upload size={13} className="text-strength" />
                <span className="hidden sm:inline">Import CSV</span>
                <input type="file" accept=".csv" className="hidden" onChange={onUpload} />
              </label>
            )}
            <button aria-label={syncing ? "Syncing health data" : "Sync health data"} onClick={runSync} disabled={syncing}
              className="flex items-center gap-2 rounded-lg bg-panel px-2.5 py-2 text-xs font-medium text-txt transition hover:bg-panel2 disabled:opacity-60 sm:px-3 sm:py-1.5">
              <RefreshCw size={13} className={syncing ? "animate-spin text-recovery" : ""} />
              <span className="hidden sm:inline">{syncing ? "Syncing…" : "Sync"}</span>
            </button>
            <button onClick={() => setShowChangelog(true)} title="What's new"
              className="hidden items-center gap-2 rounded-lg bg-panel px-2.5 py-1.5 text-xs font-medium text-txt transition hover:bg-panel2 sm:flex">
              <ScrollText size={13} />
            </button>
            <button onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}
              title="Search (Ctrl+K)"
              className="hidden items-center gap-1.5 rounded-lg bg-panel px-2.5 py-1.5 text-xs font-medium text-faint transition hover:bg-panel2 hover:text-txt sm:flex">
              <Search size={13} /> <kbd className="text-xs">Ctrl K</kbd>
            </button>
            <button onClick={toggleTheme} title={theme === "light" ? "Switch to dark" : "Switch to light"}
              className="hidden items-center gap-2 rounded-lg bg-panel px-2.5 py-1.5 text-xs font-medium text-txt transition hover:bg-panel2 sm:flex">
              {theme === "light" ? <Moon size={13} /> : <Sun size={13} />}
            </button>
            {reminders.supported && (
              <button onClick={() => (reminders.enabled ? reminders.disable() : reminders.enable())}
                title={reminders.enabled ? "Reminders on - click to disable" : "Enable weight/recovery reminders"}
                className="hidden items-center gap-2 rounded-lg bg-panel px-2.5 py-1.5 text-xs font-medium text-txt transition hover:bg-panel2 sm:flex">
                {reminders.enabled ? <Bell size={13} className="text-recovery" /> : <BellOff size={13} />}
              </button>
            )}
            <button onClick={handleLogout} title="Lock Pulse" aria-label="Lock Pulse"
              className="hidden items-center rounded-lg bg-panel px-2.5 py-1.5 text-txt transition hover:bg-panel2 sm:flex"><LogOut size={13}/></button>
            <button aria-label="More actions" aria-expanded={mobileActions} aria-controls="mobile-actions" onClick={() => setMobileActions((v) => !v)}
              className="rounded-lg bg-panel p-2 text-txt sm:hidden">
              <MoreHorizontal size={16} />
            </button>
          </div>
          {mobileActions && (
            <div id="mobile-actions" className="absolute right-3 top-[calc(100%+6px)] z-50 w-52 rounded-xl bg-panel p-2 shadow-2xl sm:hidden">
              {conn?.hevy?.mode === "csv" && <label className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-panel2"><Upload size={15} /> Import Hevy CSV<input type="file" accept=".csv" className="hidden" onChange={(e) => { onUpload(e); setMobileActions(false); }} /></label>}
              <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-panel2" onClick={() => navigate("settings")}><Settings2 size={15} /> Settings</button>
              <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-panel2" onClick={() => { setShowChangelog(true); setMobileActions(false); }}><ScrollText size={15} /> What's new</button>
              <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-panel2" onClick={() => { toggleTheme(); setMobileActions(false); }}>{theme === "light" ? <Moon size={15} /> : <Sun size={15} />} Theme</button>
              {reminders.supported && <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-panel2" onClick={() => { reminders.enabled ? reminders.disable() : reminders.enable(); setMobileActions(false); }}>{reminders.enabled ? <Bell size={15} /> : <BellOff size={15} />} {reminders.enabled ? "Disable reminders" : "Enable reminders"}</button>}
              <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-effort hover:bg-panel2" onClick={handleLogout}><LogOut size={15}/> Lock Pulse</button>
            </div>
          )}
        </header>

        <main id="main-content" tabIndex="-1" className="mx-auto min-w-0 max-w-6xl overflow-x-hidden px-3 py-4 pb-24 sm:px-6 sm:py-5 lg:pb-5">
          <ErrorBoundary key={view} resetKey={view}>
            <Suspense fallback={<Loading />}>
              {view === "insights"
                ? <Insights aiStatus={conn?.ai} />
                : view === "nutrition"
                ? <Nutrition aiStatus={conn?.ai} />
                : view === "settings"
                ? <Settings status={status} onSync={runSync} syncing={syncing} onRestart={handleRestart} restarting={restarting} theme={theme} onToggleTheme={toggleTheme} reminders={reminders} onLogout={handleLogout} />
                : Current && <Current />}
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      {mobileNav && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setMobileNav(false)} />}

      <nav aria-label="Primary mobile navigation" className="safe-bottom fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-line bg-ink px-1 pt-1.5 lg:hidden">
        {MOBILE_NAV.map((id) => { const n=NAV.find((item)=>item.id===id); const Icon=n.icon; const active=view===n.id; return <button key={n.id} aria-current={active?"page":undefined} aria-label={n.label} onClick={() => navigate(n.id)} className={`flex min-h-12 min-w-14 flex-1 flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-xs ${active ? "font-semibold text-txt" : "text-faint"}`}><Icon size={18} style={{color:active?n.color:undefined}}/><span>{n.label}</span></button>; })}
        <button aria-label="More sections" aria-expanded={mobileNav} onClick={() => setMobileNav(true)} className={`flex min-h-12 min-w-14 flex-1 flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-xs ${!MOBILE_NAV.includes(view)?"text-txt":"text-faint"}`}><MoreHorizontal size={18}/><span>More</span></button>
      </nav>

      <Changelog open={showChangelog} onClose={() => setShowChangelog(false)} />
      <QuickLog onNavigate={navigate} />
      <CommandPalette onNavigate={navigate} />
      <ToastHost />
    </div>
  );
}
