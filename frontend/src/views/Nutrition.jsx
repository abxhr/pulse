import { useEffect, useState, useCallback } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from "recharts";
import { Trash2, Plus, Settings2, X, Camera, Sparkles, Image as ImageIcon } from "lucide-react";
import { api } from "../lib/api";
import { COLORS, fmtDate, fmtNum } from "../lib/format";
import { Panel, Loading, Chip } from "../components/primitives";

const axis = { stroke: "#5b6479", fontSize: 11, fontFamily: "JetBrains Mono" };
const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"];
const MACROS = [
  { key: "calories", label: "Calories", unit: "kcal", color: COLORS.nutrition },
  { key: "protein_g", label: "Protein", unit: "g", color: COLORS.strength },
  { key: "carbs_g", label: "Carbs", unit: "g", color: COLORS.cardio },
  { key: "fat_g", label: "Fat", unit: "g", color: COLORS.effort },
];

function MacroBar({ label, value, goal, unit, color }) {
  const pct = goal ? Math.min(100, Math.round((value / goal) * 100)) : null;
  return (
    <div className="rounded-xl border border-line bg-panel2/60 px-4 py-3.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-muted">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />{label}
        </span>
        {pct !== null && <span className="font-mono text-[11px] text-faint tnum">{pct}%</span>}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="font-mono text-2xl font-semibold text-txt tnum">{fmtNum(value, 0)}</span>
        <span className="text-xs text-faint">{unit}{goal ? ` / ${fmtNum(goal, 0)}` : ""}</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line/60">
        <div className="h-full rounded-full transition-all"
          style={{ width: `${pct ?? 0}%`, background: color }} />
      </div>
    </div>
  );
}

const EMPTY_MEAL = { name: "", meal_type: "lunch", calories: "", protein_g: "", carbs_g: "", fat_g: "" };

function MacroInputs({ form, onChange }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {MACROS.map(({ key, label, unit, color }) => (
        <div key={key} className="rounded-lg border border-line bg-ink px-2 py-1.5">
          <label htmlFor={`macro-${key}`} className="block truncate text-center text-[9.5px] font-medium uppercase tracking-wide" style={{ color }}>
            {label}
          </label>
          <input id={`macro-${key}`} inputMode="decimal" value={form[key]} onChange={(e) => onChange(key, e.target.value)}
            placeholder="0"
            className="w-full bg-transparent text-center text-sm text-txt placeholder:text-faint focus:outline-none" />
          <div className="text-center text-[9px] text-faint">{unit}</div>
        </div>
      ))}
    </div>
  );
}

function ScanMeal({ onEstimate, aiStatus }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [provider, setProvider] = useState(null); // null = server default

  const options = [
    { id: null, label: "Auto" },
    { id: "anthropic", label: "Claude", ok: aiStatus?.anthropic },
    { id: "openai", label: "GPT", ok: aiStatus?.openai },
  ];

  function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }

  async function analyze() {
    if (!file && !notes.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const est = await api.analyzeMeal(file, notes.trim(), provider);
      onEstimate(est);
      setFile(null);
      setPreview(null);
      setNotes("");
    } catch (err) {
      setError("Couldn't read that meal — try adding more detail, or enter it manually.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-faint">AI model</span>
        <div className="flex gap-1 rounded-full bg-ink p-0.5">
          {options.map((o) => (
            <button key={o.label} type="button" onClick={() => setProvider(o.id)}
              disabled={o.id && o.ok === false}
              title={o.id && o.ok === false ? `${o.label} key not configured` : undefined}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-30 ${
                provider === o.id ? "bg-nutrition text-ink" : "text-muted"
              }`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-ink px-4 py-6 text-center transition hover:border-nutrition/40">
        {preview ? (
          <img src={preview} alt="" className="max-h-40 rounded-lg object-cover" />
        ) : (
          <>
            <Camera size={22} className="text-faint" />
            <span className="text-xs text-muted">Take or choose a photo</span>
          </>
        )}
        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
      </label>

      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
        placeholder="Optional details — e.g. 150g rice, 200g chicken breast, 1 tbsp olive oil"
        className="w-full resize-none rounded-lg border border-line bg-ink px-3 py-2.5 text-sm text-txt placeholder:text-faint focus:border-nutrition/50 focus:outline-none" />

      {error && <p className="text-xs text-effort">{error}</p>}

      <button type="button" onClick={analyze} disabled={busy || (!file && !notes.trim())}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-nutrition py-2.5 text-sm font-semibold text-ink transition disabled:opacity-50">
        <Sparkles size={15} /> {busy ? "Reading meal…" : "Analyze"}
      </button>
    </div>
  );
}

function AddMealForm({ onAdded, aiStatus }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("manual"); // manual | scan
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY_MEAL);
  const [estimate, setEstimate] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function applyEstimate(est) {
    setForm((f) => ({
      ...f,
      name: est.name || f.name,
      calories: est.calories ?? "",
      protein_g: est.protein_g ?? "",
      carbs_g: est.carbs_g ?? "",
      fat_g: est.fat_g ?? "",
    }));
    setEstimate(est);
    setMode("manual");
  }

  function reset() {
    setForm(EMPTY_MEAL);
    setEstimate(null);
    setMode("manual");
    setOpen(false);
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      await api.addMeal({
        name: form.name.trim(),
        meal_type: form.meal_type,
        calories: form.calories ? Number(form.calories) : null,
        protein_g: form.protein_g ? Number(form.protein_g) : null,
        carbs_g: form.carbs_g ? Number(form.carbs_g) : null,
        fat_g: form.fat_g ? Number(form.fat_g) : null,
      });
      reset();
      onAdded();
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => { setOpen(true); setMode("manual"); }}
          className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-panel2/40 px-4 py-3.5 text-sm font-medium text-muted transition hover:border-nutrition/40 hover:text-nutrition">
          <Plus size={16} /> Log a meal
        </button>
        <button onClick={() => { setOpen(true); setMode("scan"); }}
          className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-panel2/40 px-4 py-3.5 text-sm font-medium text-muted transition hover:border-nutrition/40 hover:text-nutrition">
          <Camera size={16} /> Scan a meal
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-line bg-panel2/60 p-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 rounded-full bg-ink p-0.5">
          {[["manual", "Manual"], ["scan", "Scan"]].map(([m, label]) => (
            <button key={m} type="button" onClick={() => setMode(m)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                mode === m ? "bg-nutrition text-ink" : "text-muted"
              }`}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" onClick={reset} className="text-faint hover:text-txt"><X size={16} /></button>
      </div>

      {mode === "scan" ? (
        <ScanMeal onEstimate={applyEstimate} aiStatus={aiStatus} />
      ) : (
        <form onSubmit={submit} className="space-y-3">
          {estimate && (
            <div className="flex items-start gap-2 rounded-lg border border-nutrition/30 bg-nutrition/10 px-3 py-2 text-[11px] text-nutrition">
              <ImageIcon size={13} className="mt-0.5 shrink-0" />
              <span>
                AI estimate ({estimate.confidence || "medium"} confidence)
                {estimate.notes ? ` — ${estimate.notes}` : ""}. Review before saving.
              </span>
            </div>
          )}

          <input autoFocus value={form.name} onChange={set("name")} placeholder="What did you eat?"
            className="w-full rounded-lg border border-line bg-ink px-3 py-2.5 text-sm text-txt placeholder:text-faint focus:border-nutrition/50 focus:outline-none" />

          <div className="flex flex-wrap gap-1.5">
            {MEAL_TYPES.map((t) => (
              <button key={t} type="button" onClick={() => setForm((f) => ({ ...f, meal_type: t }))}
                className={`rounded-full px-3 py-1 text-xs capitalize transition ${
                  form.meal_type === t ? "bg-nutrition text-ink font-medium" : "bg-panel text-muted"
                }`}>
                {t}
              </button>
            ))}
          </div>

          <MacroInputs form={form} onChange={(k, v) => setForm((f) => ({ ...f, [k]: v }))} />

          <button type="submit" disabled={busy || !form.name.trim()}
            className="w-full rounded-lg bg-nutrition py-2.5 text-sm font-semibold text-ink transition disabled:opacity-50">
            {busy ? "Saving…" : "Add meal"}
          </button>
        </form>
      )}
    </div>
  );
}

function GoalEditor({ goal, onSaved }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(goal);
  useEffect(() => setForm(goal), [goal]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    await api.setNutritionGoal({
      calories: form.calories ? Number(form.calories) : null,
      protein_g: form.protein_g ? Number(form.protein_g) : null,
      carbs_g: form.carbs_g ? Number(form.carbs_g) : null,
      fat_g: form.fat_g ? Number(form.fat_g) : null,
    });
    setOpen(false);
    onSaved();
  }

  return (
    <div>
      <button onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-[11px] text-faint hover:text-txt">
        <Settings2 size={12} /> {open ? "Close" : "Edit targets"}
      </button>
      {open && (
        <form onSubmit={submit} className="mt-2 space-y-2 rounded-xl border border-line bg-panel2/60 p-3">
          <MacroInputs form={{ calories: form?.calories ?? "", protein_g: form?.protein_g ?? "", carbs_g: form?.carbs_g ?? "", fat_g: form?.fat_g ?? "" }}
            onChange={(k, v) => setForm((f) => ({ ...f, [k]: v }))} />
          <button type="submit" className="w-full rounded-lg border border-nutrition/40 bg-nutrition/10 py-2 text-xs font-semibold text-nutrition">
            Save targets
          </button>
        </form>
      )}
    </div>
  );
}

function Tip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-panel2 px-3 py-2 shadow-panel">
      <div className="mb-1 font-mono text-[11px] text-muted">{fmtDate(label)}</div>
      <div className="flex items-center gap-2 text-xs">
        <span className="h-2 w-2 rounded-full" style={{ background: COLORS.nutrition }} />
        <span className="text-txt font-mono tnum">{fmtNum(payload[0].value)}</span>
        <span className="text-faint">kcal</span>
      </div>
    </div>
  );
}

export default function Nutrition({ aiStatus }) {
  const [today, setToday] = useState(null);
  const [trendData, setTrendData] = useState(null);

  const refresh = useCallback(() => {
    api.nutritionToday().then(setToday).catch(() => setToday({ meals: [], totals: {}, goal: {} }));
    api.nutritionTrend(14).then(setTrendData).catch(() => setTrendData([]));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function removeMeal(id) {
    await api.deleteMeal(id);
    refresh();
  }

  if (!today) return <Loading label="Loading today's macros…" />;

  const { totals, goal, meals } = today;
  const trendChart = (trendData || []).map((d) => ({ date: d.date, calories: d.totals.calories }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {MACROS.map((m) => (
          <MacroBar key={m.key} label={m.label} unit={m.unit} color={m.color}
            value={totals?.[m.key] ?? 0} goal={goal?.[m.key]} />
        ))}
      </div>

      <GoalEditor goal={goal} onSaved={refresh} />

      <AddMealForm onAdded={refresh} aiStatus={aiStatus} />

      <Panel accent={COLORS.nutrition} title="Today's meals" sub={meals?.length ? `${meals.length} logged` : "nothing logged yet"}>
        {!meals?.length ? (
          <p className="py-6 text-center text-xs text-faint">Log your first meal above.</p>
        ) : (
          <div className="space-y-2">
            {meals.map((m) => (
              <div key={m.id} className="flex items-center justify-between rounded-lg border border-line bg-panel2/40 px-3 py-2.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-txt">{m.name}</span>
                    {m.meal_type && <Chip color={COLORS.nutrition}>{m.meal_type}</Chip>}
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-faint tnum">
                    {fmtNum(m.calories)} kcal · P{fmtNum(m.protein_g)} · C{fmtNum(m.carbs_g)} · F{fmtNum(m.fat_g)}
                  </div>
                </div>
                <button onClick={() => removeMeal(m.id)} className="ml-2 shrink-0 text-faint hover:text-effort">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel accent={COLORS.nutrition} title="Calories" sub="last 14 days">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={trendChart} margin={{ left: -18, right: 8, top: 6 }}>
            <CartesianGrid stroke="#1c2230" vertical={false} />
            <XAxis dataKey="date" tick={axis} tickFormatter={fmtDate} minTickGap={20} axisLine={false} tickLine={false} />
            <YAxis tick={axis} axisLine={false} tickLine={false} width={34} />
            <Tooltip content={<Tip />} cursor={{ fill: "#ffffff08" }} />
            {goal?.calories && <ReferenceLine y={goal.calories} stroke={COLORS.muted} strokeDasharray="4 4" />}
            <Bar dataKey="calories" fill={COLORS.nutrition} radius={[4, 4, 0, 0]} maxBarSize={26} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>
    </div>
  );
}
