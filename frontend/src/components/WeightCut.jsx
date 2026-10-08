import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from "recharts";
import { Sparkles, Settings2, Trash2, ChevronDown, History } from "lucide-react";
import { api } from "../lib/api";
import { COLORS, fmtDate, fmtNum, axisLabelStyle } from "../lib/format";
import { Panel, StatTile, Loading } from "../components/primitives";
import { RefeedNudge, TdeeConfidence } from "./NutritionExtras";

const axis = { stroke: "var(--color-faint)", fontSize: 11, fontFamily: "JetBrains Mono" };
const today = () => new Date().toISOString().slice(0, 10);

function LogWeight({ onLogged, trendKg }) {
  const [date, setDate] = useState(today());
  const [weight, setWeight] = useState("");
  const [bodyFat, setBodyFat] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  // Flags a likely typo (e.g. 175 instead of 75, or a stray extra digit) before
  // it distorts the EMA - >8% off the current trend on a single entry is well
  // outside normal day-to-day water-weight swings.
  const pctOff = trendKg ? Math.abs(Number(weight) - trendKg) / trendKg : 0;
  const looksOff = weight && trendKg && pctOff > 0.08;

  async function save() {
    setBusy(true);
    try {
      await api.logWeight({ date, weight_kg: Number(weight), body_fat_pct: bodyFat ? Number(bodyFat) : null });
      setDate(today()); setWeight(""); setBodyFat(""); setConfirming(false);
      onLogged();
    } finally {
      setBusy(false);
    }
  }

  function submit(e) {
    e.preventDefault();
    if (!weight) return;
    if (looksOff && !confirming) { setConfirming(true); return; }
    save();
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <div className="w-36">
        <label className="mb-1 block text-[10px] uppercase tracking-wide text-faint">Date</label>
        <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)}
          className="w-full rounded-lg border border-line bg-ink px-2 py-2 text-sm text-txt focus:border-nutrition/50 focus:outline-none" />
      </div>
      <div className="flex-1">
        <label className="mb-1 block text-[10px] uppercase tracking-wide text-faint">Weight (kg)</label>
        <input inputMode="decimal" value={weight} onChange={(e) => { setWeight(e.target.value); setConfirming(false); }} placeholder="e.g. 78.4"
          className={`w-full rounded-lg border bg-ink px-3 py-2 text-sm text-txt placeholder:text-faint focus:outline-none ${
            looksOff ? "border-effort/60 focus:border-effort" : "border-line focus:border-nutrition/50"
          }`} />
      </div>
      <div className="w-24">
        <label className="mb-1 block text-[10px] uppercase tracking-wide text-faint">Body fat %</label>
        <input inputMode="decimal" value={bodyFat} onChange={(e) => setBodyFat(e.target.value)} placeholder="optional"
          className="w-full rounded-lg border border-line bg-ink px-3 py-2 text-sm text-txt placeholder:text-faint focus:border-nutrition/50 focus:outline-none" />
      </div>
      <button type="submit" disabled={busy || !weight}
        className={`rounded-lg px-4 py-2 text-sm font-semibold text-ink transition disabled:opacity-50 ${confirming ? "bg-effort" : "bg-nutrition"}`}>
        {busy ? "…" : confirming ? "Log anyway" : "Log"}
      </button>
      {looksOff && (
        <p className="w-full text-[11px] text-effort">
          That's {fmtNum(pctOff * 100, 0)}% off your recent trend ({fmtNum(trendKg, 1)}kg) - typo? Click "Log anyway" to confirm.
        </p>
      )}
      <p className="w-full text-[10px] text-faint">Backdate it if you're catching up on past weigh-ins - that unlocks the trend chart faster.</p>
    </form>
  );
}

function WeightHistory({ trend, onChanged }) {
  const [open, setOpen] = useState(false);
  if (!trend.length) return null;
  const rows = [...trend].reverse(); // newest first

  async function remove(d) {
    await api.deleteWeight(d);
    onChanged();
  }

  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-[11px] text-faint hover:text-txt">
        <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
        {trend.length} weigh-in{trend.length === 1 ? "" : "s"} logged
      </button>
      {open && (
        <div className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-line bg-ink p-2">
          {rows.map((r) => (
            <div key={r.date} className="flex items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-panel2/60">
              <span className="text-muted">{fmtDate(r.date)}</span>
              <span className="font-mono text-txt tnum">
                {fmtNum(r.weight_kg, 1)}kg{r.body_fat_pct != null ? ` · ${fmtNum(r.body_fat_pct, 1)}% BF` : ""}
              </span>
              <button onClick={() => remove(r.date)} className="text-faint hover:text-effort"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const PHASE_LABEL = { cut: "Cut", bulk: "Bulk", maintain: "Maintain" };
const PHASE_COLOR = { cut: COLORS.effort, bulk: COLORS.strength, maintain: COLORS.recovery };

function GoalHistoryList() {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState(null);

  useEffect(() => { if (open && !history) api.goalHistory().then(setHistory).catch(() => setHistory([])); }, [open, history]);
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 text-[11px] text-faint hover:text-txt">
        <History size={12} /> Goal history
      </button>
    );
  }
  return (
    <div>
      <button onClick={() => setOpen(false)} className="mb-1.5 flex items-center gap-1.5 text-[11px] text-faint hover:text-txt">
        <History size={12} /> Hide history
      </button>
      {history?.length ? (
        <div className="space-y-1">
          {history.map((h) => (
            <div key={h.id} className="flex items-center justify-between rounded-lg border border-line bg-panel2/40 px-3 py-1.5 text-xs">
              <span className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: PHASE_COLOR[h.phase] }} />
                {PHASE_LABEL[h.phase]}
                {h.target_weight_kg ? ` · target ${fmtNum(h.target_weight_kg, 1)}kg` : ""}
                {h.weekly_rate_kg ? ` · ${fmtNum(h.weekly_rate_kg, 2)}kg/wk` : ""}
              </span>
              <span className="font-mono text-faint tnum">{fmtDate(h.start_date)} – {h.end_date ? fmtDate(h.end_date) : "now"}</span>
            </div>
          ))}
        </div>
      ) : <p className="text-xs text-faint">No goal changes recorded yet.</p>}
    </div>
  );
}

function GoalForm({ goal, onSaved }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(goal?.target_weight_kg ?? "");
  const [rate, setRate] = useState(goal?.weekly_rate_kg ?? -0.4);

  useEffect(() => { setTarget(goal?.target_weight_kg ?? ""); setRate(goal?.weekly_rate_kg ?? -0.4); }, [goal]);

  async function save(e) {
    e.preventDefault();
    await api.setCutGoal({ target_weight_kg: target ? Number(target) : null, weekly_rate_kg: Number(rate) });
    setOpen(false);
    onSaved();
  }

  return (
    <div>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-[11px] text-faint hover:text-txt">
        <Settings2 size={12} /> {goal?.target_weight_kg ? "Edit goal" : "Set a goal"}
      </button>
      {open && (
        <form onSubmit={save} className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border border-line bg-panel2/60 p-3">
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wide text-faint">Target weight (kg)</label>
            <input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)}
              className="w-28 rounded-lg border border-line bg-ink px-2 py-2 text-center text-sm text-txt focus:border-nutrition/50 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wide text-faint">Weekly rate (kg)</label>
            <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)}
              className="w-28 rounded-lg border border-line bg-ink px-2 py-2 text-center text-sm text-txt focus:border-nutrition/50 focus:outline-none" />
          </div>
          <p className="w-full text-[10px] text-faint">Negative = losing (cut), positive = gaining. -0.4 to -0.7 kg/week is a typical sustainable cut.</p>
          <button type="submit" className="rounded-lg border border-nutrition/40 bg-nutrition/10 px-4 py-2 text-xs font-semibold text-nutrition">
            Save
          </button>
        </form>
      )}
    </div>
  );
}

function CutCoach() {
  const [content, setContent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function ask() {
    setBusy(true);
    setErr(null);
    try {
      const res = await api.insight({
        scope: "cut",
        question: "Focus on my weight trend, cut/bulk goal, and nutrition logging. Am I on track for my " +
          "target rate? Is my logged protein/calories consistent with what my body is actually doing? " +
          "Given my training volume, is my macro target sane, or should I adjust it? Be specific and quantitative.",
      });
      setContent(res.content);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {!content && !busy && (
        <button onClick={ask}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-panel2/40 px-4 py-3 text-sm font-medium text-muted transition hover:border-nutrition/40 hover:text-nutrition">
          <Sparkles size={15} /> Analyze my progress
        </button>
      )}
      {busy && <p className="font-mono text-xs text-muted">reading your weight + nutrition history…</p>}
      {err && <p className="text-xs text-effort">{err}</p>}
      {content && (
        <>
          <div className="md text-sm"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div>
          <button onClick={ask} className="mt-2 text-[11px] text-faint hover:text-txt">Re-analyze</button>
        </>
      )}
    </div>
  );
}

function Tip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-panel2 px-3 py-2 shadow-panel">
      <div className="mb-1 font-mono text-[11px] text-muted">{fmtDate(label)}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-xs">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-txt font-mono tnum">{fmtNum(p.value, 1)}kg</span>
          <span className="text-faint">{p.name}</span>
        </div>
      ))}
    </div>
  );
}

export default function WeightCut() {
  const [trend, setTrend] = useState(null);
  const [goal, setGoal] = useState(null);
  const [rec, setRec] = useState(null);

  const refresh = () => {
    api.weightTrend(90).then(setTrend).catch(() => setTrend([]));
    api.cutGoal().then(setGoal).catch(() => setGoal(null));
    api.macroRecommendation().then(setRec).catch(() => setRec(null));
  };
  useEffect(refresh, []);

  if (!trend) return <Loading label="Loading weight history…" />;

  const latest = trend[trend.length - 1];

  return (
    <Panel accent={COLORS.effort} title="Weight & cut" sub={goal?.target_weight_kg
      ? `target ${fmtNum(goal.target_weight_kg, 1)}kg · ${fmtNum(goal.weekly_rate_kg, 2)}kg/wk`
      : "track your weight to unlock macro recommendations"}>
      <div className="space-y-4">
        <LogWeight onLogged={refresh} trendKg={latest?.trend_kg} />

        {trend.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile label="Trend" value={fmtNum(latest.trend_kg, 1)} unit="kg" color={COLORS.effort} />
            {rec?.projection && (
              <>
                <StatTile label="Trend rate" value={fmtNum(rec.projection.weekly_rate_kg, 2)} unit="kg/wk"
                  color={rec.projection.weekly_rate_kg < 0 ? COLORS.recovery : COLORS.strength} />
                <StatTile label="Goal ETA" value={rec.projection.eta_at_goal ? fmtDate(rec.projection.eta_at_goal) : "-"} color={COLORS.sleep} />
              </>
            )}
          </div>
        )}

        {trend.length >= 2 ? (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={trend} margin={{ left: -8, right: 8, top: 6 }}>
              <CartesianGrid stroke="var(--color-line)" vertical={false} />
              <XAxis dataKey="date" tick={axis} tickFormatter={fmtDate} minTickGap={28} axisLine={false} tickLine={false} />
              <YAxis tick={axis} axisLine={false} tickLine={false} width={40} domain={["dataMin - 1", "dataMax + 1"]}
                label={{ value: "kg", angle: -90, position: "insideLeft", style: axisLabelStyle }} />
              <Tooltip content={<Tip />} />
              {goal?.target_weight_kg && (
                <ReferenceLine y={goal.target_weight_kg} stroke={COLORS.recovery} strokeDasharray="4 4" label={{ value: "goal", fill: COLORS.recovery, fontSize: 10 }} />
              )}
              <Line type="linear" dataKey="weight_kg" name="Weight (logged)" stroke={COLORS.effort} strokeWidth={1} strokeOpacity={0.35} dot={{ r: 2, fillOpacity: 0.5 }} connectNulls />
              <Line type="monotone" dataKey="trend_kg" name="Trend (7d)" stroke={COLORS.effort} strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : trend.length === 1 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-xs text-faint">
            One weigh-in logged - log at least one more (any date) to see a trend line.
          </p>
        ) : null}

        {trend.some((r) => r.body_fat_pct != null) && (
          <div>
            <div className="mb-1 text-[10.5px] uppercase tracking-wider text-faint">Body fat %</div>
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={trend.filter((r) => r.body_fat_pct != null)} margin={{ left: -8, right: 8, top: 6 }}>
                <CartesianGrid stroke="var(--color-line)" vertical={false} />
                <XAxis dataKey="date" tick={axis} tickFormatter={fmtDate} minTickGap={28} axisLine={false} tickLine={false} />
                <YAxis tick={axis} axisLine={false} tickLine={false} width={30} domain={["dataMin - 1", "dataMax + 1"]} />
                <Tooltip content={<Tip />} />
                <Line type="monotone" dataKey="body_fat_pct" name="Body fat %" stroke={COLORS.strength} strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        <WeightHistory trend={trend} onChanged={refresh} />

        <GoalForm goal={goal} onSaved={refresh} />
        <GoalHistoryList />

        <RefeedNudge data={rec?.refeed_nudge} />

        {rec && (
          <div className="rounded-xl border border-line bg-panel2/60 p-3">
            {rec.ready ? (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[10.5px] uppercase tracking-wider text-faint">Recommended daily macros</span>
                  <span className="font-mono text-[10px] text-faint">
                    TDEE ~{fmtNum(rec.tdee_estimate)}kcal ({rec.tdee_source === "energy_balance" ? "from your logs" : "Garmin estimate"}
                    {rec.tdee_raw && Math.abs(rec.tdee_raw - rec.tdee_estimate) >= 10 ? `, smoothed from ${fmtNum(rec.tdee_raw)}` : ""})
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div><div className="font-mono text-lg font-semibold text-nutrition tnum">{fmtNum(rec.target_calories)}</div><div className="text-[10px] text-faint">kcal</div></div>
                  <div><div className="font-mono text-lg font-semibold text-strength tnum">{fmtNum(rec.protein_g)}</div><div className="text-[10px] text-faint">protein g</div></div>
                  <div><div className="font-mono text-lg font-semibold text-cardio tnum">{fmtNum(rec.carbs_g)}</div><div className="text-[10px] text-faint">carbs g</div></div>
                  <div><div className="font-mono text-lg font-semibold text-effort tnum">{fmtNum(rec.fat_g)}</div><div className="text-[10px] text-faint">fat g</div></div>
                </div>
                <button
                  onClick={() => api.setNutritionGoal({
                    calories: rec.target_calories, protein_g: rec.protein_g, carbs_g: rec.carbs_g, fat_g: rec.fat_g,
                  })}
                  className="mt-2 w-full rounded-lg border border-nutrition/40 bg-nutrition/10 py-1.5 text-[11px] font-semibold text-nutrition">
                  Use as my nutrition target
                </button>
                <div className="mt-2">
                  <TdeeConfidence data={rec.tdee_confidence} />
                </div>
              </>
            ) : (
              <p className="text-xs text-muted">{rec.reason}</p>
            )}
          </div>
        )}

        <CutCoach />
      </div>
    </Panel>
  );
}
