import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText, Printer, Loader2 } from "lucide-react";
import { api } from "../lib/api";
import { Panel, StatTile, Chip } from "../components/primitives";
import { COLORS, fmtNum } from "../lib/format";

const RANGES = [
  { label: "1 week", weeks: 1 },
  { label: "4 weeks", weeks: 4 },
  { label: "12 weeks", weeks: 12 },
];

export default function Reports() {
  const [weeks, setWeeks] = useState(4);
  const [withAi, setWithAi] = useState(true);
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function generate() {
    setBusy(true); setErr(null);
    try {
      setReport(await api.weeklyReport(weeks, withAi));
    } catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  }

  const s = report?.summary;

  return (
    <div className="space-y-4">
      <Panel accent={COLORS.strength} title="Generate report" sub="performance summary + AI narrative">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-line bg-panel2/60 p-1">
            {RANGES.map((r) => (
              <button key={r.weeks} onClick={() => setWeeks(r.weeks)}
                className={`rounded-md px-3 py-1.5 text-xs transition ${weeks === r.weeks ? "bg-strength text-ink" : "text-muted hover:text-txt"}`}>
                {r.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={withAi} onChange={(e) => setWithAi(e.target.checked)}
              className="accent-recovery" />
            include AI narrative
          </label>
          <button onClick={generate} disabled={busy}
            className="ml-auto flex items-center gap-2 rounded-lg bg-strength px-4 py-2 text-sm font-medium text-ink transition hover:opacity-90 disabled:opacity-50">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
            {busy ? "Building…" : "Generate"}
          </button>
        </div>
        {err && <p className="mt-3 text-xs text-effort">{err}</p>}
      </Panel>

      {s && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Avg sleep" value={fmtNum(s.avg_sleep_hours, 1)} unit="h" color={COLORS.sleep} />
            <StatTile label="Avg readiness" value={fmtNum(s.avg_readiness)} color={COLORS.recovery} />
            <StatTile label="Run distance" value={fmtNum(s.total_run_km)} unit="km" color={COLORS.cardio} />
            <StatTile label="Strength vol" value={fmtNum(s.strength_volume_kg)} unit="kg" color={COLORS.strength} />
          </div>

          <Panel
            title={`${weeks}-week report`}
            accent={COLORS.strength}
            right={
              <button onClick={() => window.print()}
                className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition hover:text-txt">
                <Printer size={14} /> Print / PDF
              </button>
            }
          >
            <div className="md rounded-xl border border-line bg-panel2/40 p-5" id="report-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.markdown}</ReactMarkdown>
            </div>
          </Panel>
        </>
      )}

      {!s && !busy && (
        <div className="rounded-xl border border-dashed border-line bg-panel2/30 px-6 py-10 text-center">
          <FileText className="mx-auto mb-2 text-faint" />
          <p className="font-display text-sm text-txt">No report yet</p>
          <p className="mt-1 text-xs text-muted">Pick a range and hit Generate. Use Print to save as PDF.</p>
        </div>
      )}
    </div>
  );
}
