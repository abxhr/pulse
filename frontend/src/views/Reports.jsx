import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText, Printer, Loader2, ChevronDown, RefreshCw, TrendingUp, TrendingDown, ImageDown } from "lucide-react";
import { api } from "../lib/api";
import { Panel, StatTile, Chip } from "../components/primitives";
import { COLORS, fmtNum } from "../lib/format";

const RANGES = [
  { label: "1 week", weeks: 1 },
  { label: "4 weeks", weeks: 4 },
  { label: "12 weeks", weeks: 12 },
];

function ScheduledReportPanel() {
  const [report, setReport] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = () => api.scheduledReport().then(setReport).catch((e) => setErr(String(e)));
  useEffect(() => { load(); }, []);

  async function refresh() {
    setBusy(true);
    try { setReport(await api.refreshScheduledReport()); }
    catch (e) { setErr(String(e)); }
    finally { setBusy(false); }
  }

  if (err || !report) return null;
  return (
    <Panel accent={COLORS.strength} title="This week's report" sub="auto-generated · ready every Monday"
      right={
        <div className="flex items-center gap-2">
          <button onClick={(e) => { e.stopPropagation(); refresh(); }}
            className="flex items-center gap-1 text-[11px] text-faint hover:text-txt">
            <RefreshCw size={11} className={busy ? "animate-spin" : ""} /> refresh
          </button>
          <button onClick={() => setOpen((o) => !o)} className="text-faint hover:text-txt">
            <ChevronDown size={16} className={`transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      }>
      {open && <div className="md text-sm"><ReactMarkdown remarkPlugins={[remarkGfm]}>{report.markdown}</ReactMarkdown></div>}
    </Panel>
  );
}

const COMPARE_METRICS = [
  { key: "avg_sleep_hours", label: "Avg sleep", unit: "h", higherIsGood: true },
  { key: "avg_readiness", label: "Avg readiness", unit: "", higherIsGood: true },
  { key: "avg_resting_hr", label: "Resting HR", unit: "bpm", higherIsGood: false },
  { key: "avg_hrv", label: "HRV", unit: "ms", higherIsGood: true },
  { key: "run_km", label: "Run distance", unit: "km", higherIsGood: true },
  { key: "sessions", label: "Sessions", unit: "", higherIsGood: true },
];

function ComparisonPanel({ weeks }) {
  const [cmp, setCmp] = useState(null);
  useEffect(() => { api.comparisonReport(weeks).then(setCmp).catch(() => setCmp(null)); }, [weeks]);
  if (!cmp) return null;
  return (
    <Panel accent={COLORS.cardio} title={`This ${weeks}-week window vs. previous`} sub="direction, not just a snapshot">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {COMPARE_METRICS.map((m) => {
          const d = cmp.delta[m.key];
          if (d == null) return null;
          const good = d === 0 ? null : (d > 0) === m.higherIsGood;
          const Icon = d > 0 ? TrendingUp : TrendingDown;
          return (
            <div key={m.key} className="rounded-xl border border-line bg-panel2/60 px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wide text-faint">{m.label}</div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="font-mono text-lg font-semibold text-txt tnum">{cmp.current[m.key] ?? "—"}</span>
                <span className="text-[11px] text-faint">{m.unit}</span>
              </div>
              {d !== 0 && (
                <div className="mt-0.5 flex items-center gap-1 text-[11px]" style={{ color: good ? COLORS.recovery : COLORS.effort }}>
                  <Icon size={11} /> {d > 0 ? "+" : ""}{d}{m.unit}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function ShareImageButton({ summary, weeks }) {
  const canvasRef = useRef(null);

  function draw() {
    const c = canvasRef.current;
    const ctx = c.getContext("2d");
    c.width = 800; c.height = 500;
    ctx.fillStyle = "#0B0E14"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#3DD68C"; ctx.font = "600 20px sans-serif";
    ctx.fillText("PULSE", 40, 56);
    ctx.fillStyle = "#8A93A6"; ctx.font = "13px monospace";
    ctx.fillText(`${weeks}-week report · ${summary.generated}`, 40, 80);

    const stats = [
      ["Avg sleep", `${summary.avg_sleep_hours ?? "—"}h`],
      ["Avg readiness", `${summary.avg_readiness ?? "—"}`],
      ["Resting HR", `${summary.avg_resting_hr ?? "—"} bpm`],
      ["HRV", `${summary.avg_hrv ?? "—"} ms`],
      ["Run distance", `${summary.total_run_km ?? "—"} km`],
      ["Strength volume", `${fmtNum(summary.strength_volume_kg)} kg`],
    ];
    stats.forEach(([label, value], i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = 40 + col * 380, y = 150 + row * 100;
      ctx.fillStyle = "#171C28"; ctx.fillRect(x, y, 340, 80);
      ctx.fillStyle = "#8A93A6"; ctx.font = "11px monospace"; ctx.fillText(label.toUpperCase(), x + 20, y + 28);
      ctx.fillStyle = "#F4F6FB"; ctx.font = "600 28px monospace"; ctx.fillText(value, x + 20, y + 62);
    });

    const link = document.createElement("a");
    link.download = `pulse-report-${summary.generated}.png`;
    link.href = c.toDataURL("image/png");
    link.click();
  }

  return (
    <>
      <button onClick={draw}
        className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition hover:text-txt">
        <ImageDown size={14} /> Share image
      </button>
      <canvas ref={canvasRef} className="hidden" />
    </>
  );
}

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
      <ScheduledReportPanel />
      <ComparisonPanel weeks={weeks} />

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
              <div className="flex items-center gap-2">
                <ShareImageButton summary={s} weeks={weeks} />
                <button onClick={() => window.print()}
                  className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition hover:text-txt">
                  <Printer size={14} /> Print / PDF
                </button>
              </div>
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
