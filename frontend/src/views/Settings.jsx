import { useEffect, useState } from "react";
import { Bell, BellOff, DatabaseBackup, Download, LockKeyhole, Moon, Power, RefreshCw, Sun } from "lucide-react";
import { api } from "../lib/api";
import HevyStatus from "../components/HevyStatus";
import { COLORS } from "../lib/format";
import { Panel } from "../components/primitives";

function notice(message) {
  window.dispatchEvent(new CustomEvent("pulse:notice", { detail: { type: "success", message } }));
}

function Connection({ label, ok, detail }) {
  return <div className="flex min-h-11 items-center justify-between rounded-xl bg-panel2 px-3 py-2">
    <div><div className="text-sm text-txt">{label}</div>{detail && <div className="text-xs text-faint">{detail}</div>}</div>
    <span className={`rounded-full px-2 py-1 text-xs ${ok ? "bg-recovery/10 text-recovery" : "bg-effort/10 text-effort"}`}>{ok ? "Connected" : "Needs setup"}</span>
  </div>;
}

export default function Settings({ status, onSync, syncing, onRestart, restarting, theme, onToggleTheme, reminders, onLogout }) {
  const [backups, setBackups] = useState(null);
  const [backingUp, setBackingUp] = useState(false);
  const conn = status?.connections;
  const loadBackups = () => api.backups().then(setBackups).catch(() => setBackups([]));
  useEffect(() => { loadBackups(); }, []);
  async function backup() {
    setBackingUp(true);
    try { await api.runBackup(); await loadBackups(); notice("Database backup completed."); }
    finally { setBackingUp(false); }
  }
  return <div className="space-y-4">
    <Panel title="Connections" sub="Data sources and intelligence providers" accent={COLORS.recovery}>
      <div className="grid gap-2 sm:grid-cols-2">
        <Connection label="Garmin" ok={conn?.garmin} detail="Health, sleep and activities" />
        <Connection label="Hevy" ok={conn?.hevy?.configured} detail={conn?.hevy?.automatic ? "Automatic" : "CSV import only"} />
        <Connection label="Anthropic" ok={conn?.ai?.anthropic} detail="AI coach provider" />
        <Connection label="OpenAI" ok={conn?.ai?.openai} detail="AI coach provider" />
      </div>
      <div className="mt-3"><HevyStatus /></div>
      <button onClick={onSync} disabled={syncing} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-panel2 text-sm text-txt disabled:opacity-50">
        <RefreshCw size={15} className={syncing ? "animate-spin" : ""}/> {syncing ? "Syncing data…" : "Sync all data now"}
      </button>
    </Panel>

    <Panel title="Appearance & reminders" sub="Preferences are stored on this device" accent={COLORS.sleep}>
      <div className="grid gap-2 sm:grid-cols-2">
        <button onClick={onToggleTheme} className="flex min-h-12 items-center gap-3 rounded-xl bg-panel2 px-3 text-left text-sm text-txt">
          {theme === "light" ? <Moon size={17}/> : <Sun size={17}/>} Switch to {theme === "light" ? "dark" : "light"} theme
        </button>
        {reminders.supported ? <button onClick={() => reminders.enabled ? reminders.disable() : reminders.enable()} className="flex min-h-12 items-center gap-3 rounded-xl bg-panel2 px-3 text-left text-sm text-txt">
          {reminders.enabled ? <Bell size={17} className="text-recovery"/> : <BellOff size={17}/>} {reminders.enabled ? "Disable reminders" : "Enable reminders"}
        </button> : <div className="flex min-h-12 items-center rounded-xl bg-panel2 px-3 text-sm text-faint">Notifications are unavailable in this browser.</div>}
      </div>
    </Panel>

    <Panel title="Backups & export" sub="Keep an independent copy of your health history" accent={COLORS.strength}>
      <button onClick={backup} disabled={backingUp} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-strength px-4 text-sm font-semibold text-ink disabled:opacity-50">
        <DatabaseBackup size={16}/> {backingUp ? "Backing up…" : "Back up database now"}
      </button>
      <div className="mt-3 flex flex-wrap gap-2">
        <a href="/api/export/json" download className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm text-muted hover:text-txt"><Download size={15}/> Full JSON export</a>
        {['meals','weights','activities','workouts'].map((table)=><a key={table} href={`/api/export/csv/${table}`} download className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-sm capitalize text-muted hover:text-txt"><Download size={15}/> {table}</a>)}
      </div>
      <div className="mt-3 text-xs text-faint">{backups === null ? "Reading backups…" : backups.length ? `${backups.length} backups · newest ${new Date(backups[0].created_at).toLocaleString()} · ${backups[0].verified ? "verified" : "verification failed"}` : "No backups yet."}</div>
    </Panel>

    <Panel title="System" sub="Administrative actions for this Pulse server" accent={COLORS.effort}>
      <div className="grid gap-2 sm:grid-cols-2">
        <button onClick={onRestart} disabled={restarting} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-panel2 text-sm text-txt disabled:opacity-50"><Power size={16}/> {restarting ? "Restarting…" : "Restart server"}</button>
        <button onClick={onLogout} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-effort/30 bg-effort/5 text-sm text-effort"><LockKeyhole size={16}/> Lock Pulse</button>
      </div>
      <p className="mt-3 text-xs text-faint">Pulse {status?.version || "0.12.0"} · Server operations affect every connected device.</p>
    </Panel>
  </div>;
}
