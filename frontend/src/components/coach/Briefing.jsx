import { useEffect } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import { api } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { COLORS } from "../../lib/format";
import { Panel } from "../primitives";
import Blocks from "./Blocks";

export const askCoach = (prompt) => window.dispatchEvent(new CustomEvent("pulse:coach", { detail: { prompt } }));

/** The Coach's proactive daily briefing: generated overnight (or on first open), regenerated when an injury or race changes. */
export default function Briefing({ onSend = askCoach }) {
  const { data, error, loading, reload } = useApi("briefing", api.agentBriefing, { ttl: 300_000 });
  useEffect(() => {
    const again = () => reload();
    window.addEventListener("pulse:data-changed", again);
    return () => window.removeEventListener("pulse:data-changed", again);
  }, [reload]);

  async function refresh() {
    await api.refreshAgentBriefing().catch(() => {});
    reload();
  }

  const stamp = data?.created_at && new Date(data.created_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return (
    <Panel title="Today's briefing" sub={stamp ? `Coach · ${stamp}` : "Coach"}
      right={<button onClick={refresh} disabled={loading} aria-label="Regenerate briefing" title="Regenerate"
        className="rounded-lg bg-panel2 p-2 text-muted transition hover:text-txt disabled:opacity-50"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>}>
      {loading && !data ? (
        <div className="flex items-center gap-2 text-sm text-muted"><Sparkles size={15} className="animate-pulse" style={{ color: COLORS.recovery }} />Reading your numbers and writing today's call…</div>
      ) : error && !data ? (
        <p className="text-sm text-muted">{/not set|configured/i.test(String(error.message)) ? "Add an AI key to .env and restart to enable the Coach." : `The Coach couldn't write today's briefing: ${error.message}`}
          <button onClick={reload} className="ml-2 text-recovery underline">Retry</button></p>
      ) : data ? <Blocks blocks={data.blocks} onSend={onSend} /> : null}
    </Panel>
  );
}
