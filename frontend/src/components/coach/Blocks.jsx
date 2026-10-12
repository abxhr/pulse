import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from "recharts";
import { AlertTriangle, CheckCircle2, Info, OctagonAlert, Check, Loader2, ArrowRight } from "lucide-react";
import { api } from "../../lib/api";
import { invalidate } from "../../lib/useApi";
import { COLORS, fmtNum, mix } from "../../lib/format";
import { hashForRoute } from "../../lib/navigation";

const TONE = {
  good: COLORS.recovery, warn: COLORS.strength, bad: COLORS.effort, info: COLORS.cardio, neutral: "var(--color-faint)",
};
const KIND_COLOR = { run: COLORS.cardio, race: COLORS.effort, strength: COLORS.strength, recovery: COLORS.muted, rest: COLORS.muted };

function metricColor(metric = "") {
  if (metric.startsWith("sleep")) return COLORS.sleep;
  if (metric.includes("run")) return COLORS.cardio;
  if (["weight", "calories", "protein"].includes(metric)) return COLORS.nutrition;
  if (["strain", "fatigue", "stress"].includes(metric)) return COLORS.effort;
  return COLORS.recovery;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayLabel = (x) => (ISO_DAY.test(x) ? new Date(x + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : String(x).replace(/^\d{4}-/, ""));
const weekday = (x) => new Date(x + "T00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

/** Run a button's job. Returns {state, run, message}. Destructive tools need a second click. */
function useAction(item, { onSend }) {
  const [state, setState] = useState("idle"); // idle | arm | busy | done | error
  const [message, setMessage] = useState("");

  async function run() {
    if (item.view) { window.location.hash = hashForRoute(item.view); return; }
    if (item.prompt) { onSend?.(item.prompt); return; }
    if (!item.tool) return;
    if (item.confirm && state !== "arm") { setState("arm"); setTimeout(() => setState((s) => (s === "arm" ? "idle" : s)), 4000); return; }
    setState("busy");
    try {
      const res = await api.agentExecute(item.tool, item.args || {});
      setMessage(res.summary || "Done");
      setState("done");
      invalidate();
      window.dispatchEvent(new Event("pulse:data-changed"));
    } catch (e) {
      setMessage(e.message || "Failed");
      setState("error");
    }
  }
  return { state, message, run };
}

function ActionButton({ item, onSend, primary }) {
  const { state, message, run } = useAction(item, { onSend });
  const base = "inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:opacity-60";
  if (state === "done") return <span className={`${base} bg-recovery/10 text-recovery`}><Check size={14} aria-hidden="true" />{message}</span>;
  const cls = state === "arm" ? "bg-effort text-ink" : primary ? "bg-recovery text-ink hover:opacity-90" : "bg-panel text-txt hover:bg-line";
  return (
    <span className="inline-flex flex-col items-start">
      <button onClick={run} disabled={state === "busy"} className={`${base} ${cls}`}>
        {state === "busy" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : (item.view || item.prompt) ? <ArrowRight size={14} aria-hidden="true" /> : null}
        {state === "arm" ? `Confirm: ${item.label}` : item.label}
      </button>
      {state === "error" && <span role="alert" className="mt-1 text-xs text-effort">{message}</span>}
    </span>
  );
}

function Text({ block }) {
  return <div className="md text-[15px] leading-relaxed"><ReactMarkdown remarkPlugins={[remarkGfm]}>{block.text}</ReactMarkdown></div>;
}

function Callout({ block }) {
  const color = TONE[block.tone] || TONE.info;
  const Icon = { good: CheckCircle2, warn: AlertTriangle, bad: OctagonAlert }[block.tone] || Info;
  return (
    <div role={block.tone === "bad" ? "alert" : undefined} className="flex gap-3 rounded-xl px-4 py-3" style={{ background: mix(color, 12) }}>
      <Icon size={18} className="mt-0.5 shrink-0" style={{ color }} aria-hidden="true" />
      <div className="min-w-0">
        <div className="font-display text-base font-semibold text-txt">{block.title}</div>
        <p className="mt-0.5 text-sm text-muted">{block.text}</p>
      </div>
    </div>
  );
}

function Stats({ block }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {block.items.map((it, i) => (
        <div key={i} className="rounded-xl bg-panel2 px-3.5 py-3" style={{ borderLeft: `3px solid ${TONE[it.tone] || TONE.neutral}` }}>
          <div className="text-xs text-muted">{it.label}</div>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="font-num text-2xl font-semibold leading-none text-txt tnum">{it.value}</span>
            {it.unit && <span className="text-xs text-muted">{it.unit}</span>}
          </div>
          {it.note && <div className="mt-1 text-xs text-faint">{it.note}</div>}
        </div>
      ))}
    </div>
  );
}

function ChartTip({ active, payload, label, unit }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-ink px-2.5 py-1.5 text-xs shadow-lg">
      <div className="text-faint">{dayLabel(label)}</div>
      <div className="font-num text-sm text-txt tnum">{fmtNum(payload[0].value, 1)} {unit}</div>
    </div>
  );
}

function Chart({ block }) {
 
  const color = metricColor(block.metric);
  const axis = { stroke: "var(--color-faint)", fontSize: 11 };
  const top = block.target != null ? (max) => Math.max(max, block.target * 1.05) : "auto";
  const Plot = block.kind === "bar" ? BarChart : LineChart;
  return (
    <figure className="rounded-xl bg-panel2 px-3 pb-2 pt-3" aria-label={block.title}>
      <figcaption className="px-1 pb-1 text-sm font-medium text-txt">{block.title}{block.unit ? <span className="text-faint"> ({block.unit})</span> : null}</figcaption>
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <Plot data={block.points} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid vertical={false} stroke="var(--color-line)" strokeDasharray="3 3" />
            <XAxis dataKey="date" tickFormatter={dayLabel} {...axis} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis {...axis} tickLine={false} axisLine={false} domain={[block.kind === "bar" ? 0 : "auto", top]} />
            <Tooltip content={<ChartTip unit={block.unit} />} cursor={{ fill: mix(color, 8) }} />
            {block.target != null && (
              <ReferenceLine y={block.target} stroke={COLORS.strength} strokeDasharray="5 4"
                label={{ value: block.target_label || `${block.target}`, fill: COLORS.strength, fontSize: 11, position: "insideTopRight" }} />
            )}
            {block.kind === "bar"
              ? <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]} maxBarSize={22} />
              : <Line dataKey="value" stroke={color} strokeWidth={2} dot={block.points.length < 15} connectNulls />}
          </Plot>
        </ResponsiveContainer>
      </div>
      <span className="sr-only">{block.points.length} points, latest {block.points.at(-1)?.value} {block.unit}</span>
    </figure>
  );
}

export function PlanBlock({ block, onSend }) {
  return (
    <div className="rounded-xl bg-panel2 px-4 py-3">
      <div className="font-display text-base font-semibold text-txt">{block.title}</div>
      <ol className="mt-2 divide-y divide-line">
        {block.rows.map((r, i) => (
          <li key={i} className="flex items-start gap-3 py-2">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: KIND_COLOR[r.kind] || COLORS.muted }} aria-hidden="true" />
            <span className="w-24 shrink-0 text-xs text-muted tnum">{weekday(r.date)}</span>
            <span className="min-w-0 flex-1">
              <span className={`text-sm ${r.kind === "rest" ? "text-muted" : "font-medium text-txt"}`}>{r.title}</span>
              {r.details && <span className="block text-xs text-faint">{r.details}</span>}
            </span>
          </li>
        ))}
      </ol>
      {block.apply && <div className="mt-3"><ActionButton item={block.apply} onSend={onSend} primary /></div>}
    </div>
  );
}

function Actions({ block, onSend }) {
  return <div className="flex flex-wrap items-start gap-2">{block.items.map((it, i) => <ActionButton key={i} item={it} onSend={onSend} primary={i === 0} />)}</div>;
}

function Replies({ block, onSend }) {
  return (
    <div className="flex flex-wrap gap-2">
      {block.items.map((q) => (
        <button key={q} onClick={() => onSend?.(q)} className="rounded-full bg-panel2 px-3 py-1.5 text-sm text-muted transition hover:text-txt">{q}</button>
      ))}
    </div>
  );
}

function Done({ block }) {
  return <div className="flex items-center gap-2 text-sm text-recovery"><Check size={14} aria-hidden="true" />{block.text}</div>;
}

const RENDER = { text: Text, callout: Callout, stats: Stats, chart: Chart, plan: PlanBlock, actions: Actions, replies: Replies, done: Done };

/** One assistant message: ordered blocks. Unknown block types are skipped, never crash the thread. */
export default function Blocks({ blocks, onSend }) {
  return (
    <div className="space-y-3">
      {blocks.map((b, i) => {
        const C = RENDER[b.type];
        return C ? <C key={i} block={b} onSend={onSend} /> : null;
      })}
    </div>
  );
}
