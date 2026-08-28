import { useEffect, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { Repeat, Flame, Droplets, RotateCcw, Info } from "lucide-react";
import { api } from "../lib/api";
import { COLORS, fmtNum } from "../lib/format";
import { Panel } from "./primitives";

const axis = { stroke: "#5b6479", fontSize: 11, fontFamily: "JetBrains Mono" };

export function FavoriteMeals({ onRelog }) {
  const [favs, setFavs] = useState([]);
  useEffect(() => { api.nutritionFavorites().then(setFavs).catch(() => setFavs([])); }, []);
  if (!favs.length) return null;

  async function relog(f) {
    await api.addMeal({
      name: f.last.name, meal_type: f.last.meal_type,
      calories: f.last.calories, protein_g: f.last.protein_g,
      carbs_g: f.last.carbs_g, fat_g: f.last.fat_g, fiber_g: f.last.fiber_g,
    });
    onRelog();
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-faint">
        <Repeat size={11} /> Quick re-log
      </div>
      <div className="flex flex-wrap gap-1.5">
        {favs.map((f) => (
          <button key={f.name} onClick={() => relog(f)}
            className="rounded-full border border-line bg-panel2/60 px-3 py-1.5 text-xs text-txt transition hover:border-nutrition/40">
            {f.last.name} <span className="text-faint">×{f.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function StreakBadge() {
  const [streak, setStreak] = useState(null);
  useEffect(() => { api.nutritionStreak().then(setStreak).catch(() => setStreak(null)); }, []);
  if (!streak?.goal_set || streak.streak < 2) return null;
  return (
    <div className="flex items-center gap-2 rounded-full border border-strength/30 bg-strength/10 px-3 py-1.5">
      <Flame size={14} className="text-strength" />
      <span className="text-xs font-medium text-strength">{streak.streak} day streak on target</span>
    </div>
  );
}

export function ProteinTimingChart() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.nutritionProteinTiming().then(setRows).catch(() => setRows([])); }, []);
  if (!rows?.length) return null;
  const chart = rows.map((r) => ({
    label: r.time ? new Date(r.time).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : r.meal_type,
    protein_g: r.protein_g, name: r.name,
  }));
  return (
    <Panel accent={COLORS.strength} title="Protein timing" sub="distribution across today">
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={chart} margin={{ left: -18, right: 8, top: 6 }}>
          <CartesianGrid stroke="#1c2230" vertical={false} />
          <XAxis dataKey="label" tick={axis} axisLine={false} tickLine={false} />
          <YAxis tick={axis} axisLine={false} tickLine={false} width={30} />
          <Tooltip
            contentStyle={{ background: "#171C28", border: "1px solid #232a38", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 12 }}
            formatter={(v, n, p) => [`${fmtNum(v)}g`, p.payload.name]} />
          <Bar dataKey="protein_g" fill={COLORS.strength} radius={[4, 4, 0, 0]} maxBarSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  );
}

export function HydrationCard() {
  const [h, setH] = useState(null);
  useEffect(() => { api.nutritionHydration().then(setH).catch(() => setH(null)); }, []);
  if (!h?.intake_ml) return null;
  const pct = h.goal_ml ? Math.min(100, Math.round((h.intake_ml / h.goal_ml) * 100)) : null;
  return (
    <div className="rounded-xl border border-line bg-panel2/60 px-4 py-3.5">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-muted">
          <Droplets size={12} className="text-cardio" /> Hydration
        </span>
        {pct != null && <span className="font-mono text-[11px] text-faint tnum">{pct}%</span>}
      </div>
      <div className="mt-1.5 flex items-baseline gap-1">
        <span className="font-mono text-2xl font-semibold text-txt tnum">{fmtNum(h.intake_ml / 1000, 1)}</span>
        <span className="text-xs text-faint">L{h.goal_ml ? ` / ${fmtNum(h.goal_ml / 1000, 1)}L` : ""}</span>
      </div>
      {pct != null && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line/60">
          <div className="h-full rounded-full bg-cardio" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

export function RefeedNudge({ data }) {
  if (!data) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-sleep/30 bg-sleep/10 px-4 py-3">
      <RotateCcw size={16} className="text-sleep shrink-0" />
      <p className="text-xs text-txt">{data.message}</p>
    </div>
  );
}

export function TdeeConfidence({ data }) {
  if (!data?.method) return null;
  const colors = { high: COLORS.recovery, medium: COLORS.strength, low: COLORS.muted, none: COLORS.muted };
  return (
    <div className="flex items-start gap-2 text-[11px] text-faint">
      <Info size={13} className="mt-0.5 shrink-0" style={{ color: colors[data.confidence] }} />
      <span>
        <span className="font-medium" style={{ color: colors[data.confidence] }}>{data.confidence} confidence</span> — {data.method}.
        {data.days_for_higher_confidence > 0 && ` ${data.days_for_higher_confidence} more logged days to firm this up.`}
      </span>
    </div>
  );
}
