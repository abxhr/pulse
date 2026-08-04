import { useMemo } from "react";
import { Trophy, TrendingDown, Scale, BedDouble } from "lucide-react";
import { COLORS, fmtNum, fmtDate } from "../lib/format";
import { Panel } from "./primitives";

function epley(weight, reps) {
  return weight * (1 + reps / 30);
}

function isoWeek(d) {
  const dt = new Date(d);
  const day = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((dt - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ---------- PR feed ----------
export function PRFeed({ wkos }) {
  const prs = useMemo(() => {
    const bestByExercise = new Map();
    const hits = [];
    const sorted = [...wkos].filter((w) => w.date).sort((a, b) => a.date.localeCompare(b.date));
    for (const w of sorted) {
      for (const ex of w.exercises || []) {
        let sessionBest = 0;
        for (const s of ex.sets || []) {
          const e1rm = epley(s.weight_kg || 0, s.reps || 0);
          if (e1rm > sessionBest) sessionBest = e1rm;
        }
        if (!sessionBest) continue;
        const prev = bestByExercise.get(ex.title) || 0;
        if (sessionBest > prev * 1.001) {
          bestByExercise.set(ex.title, sessionBest);
          hits.push({ date: w.date, exercise: ex.title, e1rm: Math.round(sessionBest) });
        }
      }
    }
    return hits.reverse();
  }, [wkos]);

  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 30);
  const monthKey = monthAgo.toISOString().slice(0, 10);
  const recent = prs.filter((p) => p.date >= monthKey);

  if (!recent.length) return null;
  return (
    <Panel accent={COLORS.effort} title="PRs this month" sub={`${recent.length} new estimated 1RM${recent.length === 1 ? "" : "s"}`}>
      <div className="space-y-1.5">
        {recent.slice(0, 10).map((p, i) => (
          <div key={i} className="flex items-center justify-between rounded-lg border border-line bg-panel2/50 px-3 py-2">
            <span className="flex items-center gap-2 text-sm text-txt"><Trophy size={14} className="text-effort" /> {p.exercise}</span>
            <span className="font-mono text-xs text-effort tnum">{p.e1rm}kg · {fmtDate(p.date)}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ---------- Plateau detection ----------
export function PlateauList({ wkos }) {
  const plateaus = useMemo(() => {
    const byExercise = new Map();
    const sorted = [...wkos].filter((w) => w.date).sort((a, b) => a.date.localeCompare(b.date));
    for (const w of sorted) {
      for (const ex of w.exercises || []) {
        let best = 0;
        for (const s of ex.sets || []) best = Math.max(best, epley(s.weight_kg || 0, s.reps || 0));
        if (!best) continue;
        if (!byExercise.has(ex.title)) byExercise.set(ex.title, []);
        byExercise.get(ex.title).push({ date: w.date, e1rm: best });
      }
    }
    const out = [];
    const MIN_SESSIONS = 6;
    for (const [name, entries] of byExercise.entries()) {
      if (entries.length < MIN_SESSIONS) continue;
      const recent = entries.slice(-MIN_SESSIONS);
      const peak = Math.max(...recent.map((e) => e.e1rm));
      const latest = recent[recent.length - 1].e1rm;
      if (latest < peak * 0.98 && recent[0].e1rm >= peak * 0.95) {
        // hasn't set a new best across the whole window — plateaued, not just an off day
        const stillPlateaued = recent.every((e) => e.e1rm <= peak * 1.01);
        if (stillPlateaued) {
          out.push({ name, sessions: recent.length, peak: Math.round(peak), latest: Math.round(latest) });
        }
      }
    }
    return out;
  }, [wkos]);

  if (!plateaus.length) return null;
  return (
    <Panel accent={COLORS.strength} title="Possible plateaus" sub={`e1RM hasn't set a new best in ${plateaus[0]?.sessions}+ sessions`}>
      <div className="space-y-1.5">
        {plateaus.map((p) => (
          <div key={p.name} className="flex items-center justify-between rounded-lg border border-line bg-panel2/50 px-3 py-2">
            <span className="flex items-center gap-2 text-sm text-txt"><TrendingDown size={14} className="text-strength" /> {p.name}</span>
            <span className="font-mono text-xs text-faint tnum">peak {p.peak}kg · now {p.latest}kg</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-faint">Consider a deload week or swapping in a variation to break through.</p>
    </Panel>
  );
}

// ---------- Volume landmarks (MEV/MAV/MRV, weekly sets) ----------
const LANDMARKS = {
  chest: [8, 20, 22], back: [10, 22, 25], shoulders: [8, 20, 26],
  biceps: [6, 20, 26], triceps: [6, 14, 18], quadriceps: [8, 18, 20],
  hamstrings: [6, 16, 20], glutes: [0, 12, 16], calves: [6, 16, 20], core: [0, 20, 25],
};

export function VolumeLandmarks({ wkos }) {
  const rows = useMemo(() => {
    const weeks = new Set();
    const setsByMuscleWeek = new Map(); // muscle -> week -> count
    for (const w of wkos) {
      if (!w.date) continue;
      const wk = isoWeek(w.date);
      weeks.add(wk);
      for (const ex of w.exercises || []) {
        const m = ex.muscle_group;
        if (!m || !LANDMARKS[m]) continue;
        if (!setsByMuscleWeek.has(m)) setsByMuscleWeek.set(m, new Map());
        const byWeek = setsByMuscleWeek.get(m);
        byWeek.set(wk, (byWeek.get(wk) || 0) + (ex.sets?.length || 0));
      }
    }
    const weekList = [...weeks].sort();
    const lastFull = weekList.slice(-2, -1)[0] || weekList[weekList.length - 1]; // most recent likely-complete week
    if (!lastFull) return [];
    return Object.entries(LANDMARKS).map(([muscle, [mev, mav, mrv]]) => {
      const sets = setsByMuscleWeek.get(muscle)?.get(lastFull) || 0;
      let zone = "below MEV";
      if (sets >= mrv) zone = "above MRV";
      else if (sets >= mev && sets <= mav) zone = "in range";
      else if (sets > mav) zone = "approaching MRV";
      return { muscle, sets, mev, mav, mrv, zone, week: lastFull };
    }).filter((r) => r.sets > 0 || r.zone === "below MEV");
  }, [wkos]);

  if (!rows.length) return null;
  const zoneColor = { "below MEV": COLORS.muted, "in range": COLORS.recovery, "approaching MRV": COLORS.strength, "above MRV": COLORS.effort };

  return (
    <Panel accent={COLORS.recovery} title="Volume landmarks" sub={`weekly sets vs evidence-based ranges · week of ${rows[0]?.week}`}>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.muscle}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="capitalize text-txt">{r.muscle}</span>
              <span className="font-mono tnum" style={{ color: zoneColor[r.zone] }}>{r.sets} sets · {r.zone}</span>
            </div>
            <div className="relative h-2 rounded-full bg-panel2">
              <div className="absolute inset-y-0 rounded-full bg-recovery/30" style={{ left: `${(r.mev / r.mrv) * 100}%`, width: `${((r.mav - r.mev) / r.mrv) * 100}%` }} />
              <div className="absolute h-full rounded-full" style={{ width: `${Math.min(100, (r.sets / r.mrv) * 100)}%`, background: zoneColor[r.zone] }} />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-faint">Shaded band = MEV–MAV (maintenance to max adaptive volume). Approximate, evidence-informed ranges — not personalized prescriptions.</p>
    </Panel>
  );
}

// ---------- Symmetry check ----------
export function SymmetryCheck({ wkos }) {
  const data = useMemo(() => {
    let push = 0, pull = 0, quad = 0, ham = 0;
    for (const w of wkos) {
      for (const ex of w.exercises || []) {
        const vol = (ex.sets || []).reduce((s, x) => s + (x.weight_kg || 0) * (x.reps || 0), 0);
        if (["chest", "shoulders", "triceps"].includes(ex.muscle_group)) push += vol;
        if (["back", "biceps"].includes(ex.muscle_group)) pull += vol;
        if (ex.muscle_group === "quadriceps") quad += vol;
        if (ex.muscle_group === "hamstrings") ham += vol;
      }
    }
    return { push, pull, quad, ham };
  }, [wkos]);

  const rows = [];
  if (data.push > 0 && data.pull > 0) {
    const ratio = data.push / data.pull;
    rows.push({
      label: "Push : Pull", ratio: ratio.toFixed(2),
      flag: ratio > 1.4 ? "push-dominant — shoulder health risk" : ratio < 0.7 ? "pull-dominant" : null,
    });
  }
  if (data.quad > 0 && data.ham > 0) {
    const ratio = data.quad / data.ham;
    rows.push({
      label: "Quad : Hamstring", ratio: ratio.toFixed(2),
      flag: ratio > 2.2 ? "quad-dominant — knee/hamstring injury risk" : ratio < 0.8 ? "hamstring-dominant" : null,
    });
  }
  if (!rows.length) return null;

  return (
    <Panel accent={COLORS.muted} title="Symmetry check" sub="volume ratios · 8 weeks">
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm text-txt"><Scale size={14} className="text-muted" /> {r.label}</span>
            <span className="font-mono text-sm tnum" style={{ color: r.flag ? COLORS.effort : COLORS.recovery }}>{r.ratio}</span>
          </div>
        ))}
      </div>
      {rows.some((r) => r.flag) && (
        <p className="mt-2 text-[11px] text-effort">{rows.find((r) => r.flag)?.flag}</p>
      )}
    </Panel>
  );
}

// ---------- Rest-day recommendation ----------
export function RestDayRec({ week, health }) {
  const rec = useMemo(() => {
    if (!week?.by_muscle?.length || !health?.length) return null;
    const latest = health[health.length - 1];
    const baseline = health.slice(0, -1).filter((h) => h.hrv != null);
    if (!latest?.hrv || baseline.length < 5) return null;
    const avgHrv = baseline.reduce((s, h) => s + h.hrv, 0) / baseline.length;
    const recovered = latest.hrv >= avgHrv * 0.95;

    const hitThisWeek = new Set(week.by_muscle.map((m) => m.muscle.toLowerCase()));
    const allMuscles = ["chest", "back", "shoulders", "biceps", "triceps", "quadriceps", "hamstrings", "glutes", "calves", "core"];
    const untrained = allMuscles.filter((m) => !hitThisWeek.has(m));

    return { recovered, hrv: latest.hrv, avgHrv: Math.round(avgHrv), untrained };
  }, [week, health]);

  if (!rec) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-panel2/60 px-4 py-3">
      <BedDouble size={16} className={rec.recovered ? "text-recovery" : "text-effort"} />
      <p className="text-xs text-txt">
        {rec.recovered ? (
          <>HRV ({rec.hrv}ms) is at/above your baseline ({rec.avgHrv}ms) — recovered enough to train.
            {rec.untrained.length > 0 && ` ${rec.untrained.slice(0, 3).join(", ")} not hit yet this week — good candidates.`}
          </>
        ) : (
          <>HRV ({rec.hrv}ms) is below baseline ({rec.avgHrv}ms) — favor a lighter session or active recovery today.</>
        )}
      </p>
    </div>
  );
}
