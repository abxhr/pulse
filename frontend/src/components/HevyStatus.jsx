import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { api } from "../lib/api";
import { invalidate } from "../lib/useApi";
import { fmtDate } from "../lib/format";

/**
 * Hevy connection state. Automatic once connected; until then one button opens Hevy's own
 * login on this PC (the password goes to hevy.com, never to Pulse) and the card polls until it lands.
 */
export default function HevyStatus() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const wasConnecting = useRef(false);

  const load = () => api.hevyStatus().then(setData).catch(() => {});
  useEffect(() => { load(); }, []);

  // while the login window is open, check every 3s
  useEffect(() => {
    if (!data?.connecting) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [data?.connecting]);

  // login finished -> pull the workouts straight away
  useEffect(() => {
    if (data?.connecting) { wasConnecting.current = true; return; }
    if (wasConnecting.current && data?.automatic) {
      wasConnecting.current = false;
      api.syncHevy().then(() => setTimeout(() => { invalidate(); load(); }, 4000)).catch(() => {});
    }
  }, [data?.connecting, data?.automatic]);

  if (!data) return null;

  async function connect() {
    setError(null);
    try { await api.connectHevy(); await load(); }
    catch (e) { setError(e?.message || "Couldn't open the Hevy login window"); }
  }
  async function syncNow() {
    setBusy(true);
    try { await api.syncHevy(); setTimeout(() => { invalidate(); load(); setBusy(false); }, 4000); }
    catch { setBusy(false); }
  }

  const Icon = data.stale || data.last_error ? AlertTriangle : CheckCircle2;
  const tone = data.stale || data.last_error ? "text-strength" : "text-recovery";
  const latest = data.latest_workout ? `Latest workout ${fmtDate(data.latest_workout)}` : "No workouts yet";

  let headline, detail;
  if (data.connecting) {
    headline = "Finish logging in to Hevy";
    detail = "A Hevy login window opened on this PC. Sign in there; this page updates by itself when you're done.";
  } else if (data.automatic && data.last_error) {
    headline = "Hevy sync needs attention";
    detail = `${data.last_error} Reconnecting usually fixes it.`;
  } else if (data.automatic) {
    headline = "Hevy syncs automatically";
    detail = `${latest}${data.last_sync ? `. Last checked ${new Date(data.last_sync + "Z").toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}.`;
  } else {
    headline = "Hevy isn't connected";
    detail = `${latest}. ${data.action}`;
  }

  return (
    <div className="flex items-start gap-3 rounded-xl bg-panel p-4">
      <Icon size={18} className={`mt-0.5 shrink-0 ${tone}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-txt">{headline}</p>
        <p className="mt-0.5 text-sm text-muted">{detail}</p>
        {error && <p role="alert" className="mt-1 text-sm text-effort">{error}</p>}
      </div>
      <div className="flex shrink-0 gap-2">
        {data.connecting ? (
          <span className="flex items-center gap-2 text-sm text-muted"><RefreshCw size={14} className="animate-spin" aria-hidden="true" />Waiting for login</span>
        ) : (data.can_connect || data.last_error) ? (
          <button onClick={connect} className="rounded-lg bg-strength px-4 py-2 text-sm font-semibold text-ink hover:opacity-90">
            {data.last_error ? "Reconnect Hevy" : "Connect Hevy"}
          </button>
        ) : null}
        {data.automatic && !data.connecting && (
          <button onClick={syncNow} disabled={busy} className="flex items-center gap-2 rounded-lg bg-panel2 px-3 py-2 text-sm text-txt hover:bg-line disabled:opacity-60">
            <RefreshCw size={14} className={busy ? "animate-spin" : ""} aria-hidden="true" />Sync now
          </button>
        )}
      </div>
    </div>
  );
}
