import { useEffect, useState } from "react";
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from "recharts";
import { Flag, Footprints, AlertTriangle, Route, Plus, X } from "lucide-react";
import { api } from "../lib/api";
import { COLORS, fmtNum, fmtPace, fmtDate, axisLabelStyle } from "../lib/format";
import { Panel } from "./primitives";

const axis = { stroke: "#5b6479", fontSize: 11, fontFamily: "JetBrains Mono" };

function FormTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="rounded-lg border border-line bg-panel2 px-3 py-2 shadow-panel">
      <div className="mb-1 font-mono text-[11px] text-muted">{fmtDate(label)}</div>
      <div className="text-xs text-recovery">Fitness (CTL) {p.fitness}</div>
      <div className="text-xs text-effort">Fatigue (ATL) {p.fatigue}</div>
      <div className="text-xs text-sleep">Form (TSB) {p.form}</div>
    </div>
  );
}

export function TrainingStressBalance() {
  const [series, setSeries] = useState(null);
  useEffect(() => { api.trainingStressBalance(180).then(setSeries).catch(() => setSeries([])); }, []);
  if (!series?.length) return null;
  const latest = series[series.length - 1];
  const formLabel = latest.form > 5 ? "Fresh — ready for a hard effort" : latest.form < -20 ? "Deeply fatigued — overtraining risk" : latest.form < -10 ? "Building fatigue" : "Balanced";
  const formColor = latest.form > 5 ? COLORS.recovery : latest.form < -20 ? COLORS.effort : latest.form < -10 ? COLORS.strength : COLORS.sleep;

  return (
    <Panel accent={COLORS.sleep} title="Training stress balance" sub="Fitness / Fatigue / Form (Banister model) · 180 days">
      <div className="mb-3 grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-line bg-panel2/60 px-3 py-2.5 text-center">
          <div className="text-[10px] uppercase tracking-wide text-faint">Fitness</div>
          <div className="font-mono text-xl font-semibold text-recovery tnum">{latest.fitness}</div>
        </div>
        <div className="rounded-xl border border-line bg-panel2/60 px-3 py-2.5 text-center">
          <div className="text-[10px] uppercase tracking-wide text-faint">Fatigue</div>
          <div className="font-mono text-xl font-semibold text-effort tnum">{latest.fatigue}</div>
        </div>
        <div className="rounded-xl border border-line bg-panel2/60 px-3 py-2.5 text-center">
          <div className="text-[10px] uppercase tracking-wide text-faint">Form</div>
          <div className="font-mono text-xl font-semibold tnum" style={{ color: formColor }}>{latest.form}</div>
        </div>
      </div>
      <p className="mb-3 text-xs" style={{ color: formColor }}>{formLabel}</p>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={series} margin={{ left: -8, right: 8, top: 6 }}>
          <defs>
            <linearGradient id="tsbForm" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.sleep} stopOpacity={0.4} />
              <stop offset="100%" stopColor={COLORS.sleep} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1c2230" vertical={false} />
          <XAxis dataKey="date" tick={axis} tickFormatter={fmtDate} minTickGap={40} axisLine={false} tickLine={false} />
          <YAxis tick={axis} axisLine={false} tickLine={false} width={36} label={{ value: "load", angle: -90, position: "insideLeft", style: axisLabelStyle }} />
          <Tooltip content={<FormTip />} />
          <ReferenceLine y={0} stroke="#3a4152" />
          <Area type="monotone" dataKey="form" name="Form" stroke={COLORS.sleep} strokeWidth={2} fill="url(#tsbForm)" />
          <Line type="monotone" dataKey="fitness" name="Fitness" stroke={COLORS.recovery} strokeWidth={1.5} dot={false} />
          <Line type="monotone" dataKey="fatigue" name="Fatigue" stroke={COLORS.effort} strokeWidth={1.5} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="mt-2 text-[11px] text-faint">
        Fitness/Fatigue are exponentially-weighted training load (42d / 7d time constants). Form = Fitness − Fatigue —
        positive means fresh, sustained negative means accumulating fatigue.
      </p>
    </Panel>
  );
}

const ZONE_COLORS = ["#8A93A6", "#3DD68C", "#F5A623", "#FF5C7A", "#c026d3"];

export function KarvonenZonesCard() {
  const [zones, setZones] = useState(null);
  const [sessions, setSessions] = useState(null);
  useEffect(() => {
    api.karvonenZones().then((z) => setZones(z?.zones ? z : null)).catch(() => setZones(null));
    api.karvonenSessions().then(setSessions).catch(() => setSessions([]));
  }, []);
  if (!zones) return null;
  const maxSessions = Math.max(1, ...(sessions || []).map((s) => s.sessions));

  return (
    <Panel accent={COLORS.effort} title="Personalized HR zones" sub={`Karvonen · max ${zones.max_hr} · resting ${zones.resting_hr}bpm`}>
      <div className="space-y-2">
        {zones.zones.map((z, i) => {
          const s = sessions?.find((x) => x.zone === z.name);
          return (
            <div key={z.name} className="flex items-center gap-3">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: ZONE_COLORS[i] }} />
              <span className="w-28 shrink-0 text-xs text-txt">{z.name}</span>
              <span className="w-24 shrink-0 font-mono text-xs text-faint tnum">{z.low_bpm}-{z.high_bpm}bpm</span>
              <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-panel2">
                <div className="h-full rounded-full" style={{ width: `${((s?.sessions || 0) / maxSessions) * 100}%`, background: ZONE_COLORS[i] }} />
              </div>
              <span className="w-6 shrink-0 text-right font-mono text-[11px] text-faint tnum">{s?.sessions || 0}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-faint">
        Zones from heart-rate-reserve (your actual max/resting HR), not a generic %-of-max estimate.
        Session counts are by average HR per run, not a full time-in-zone breakdown.
      </p>
    </Panel>
  );
}

const DIST_OPTIONS = [
  { value: "5k", label: "5K" }, { value: "10k", label: "10K" },
  { value: "half_marathon", label: "Half Marathon" }, { value: "marathon", label: "Marathon" },
];

export function RaceGoalCard() {
  const [race, setRace] = useState(null);
  const [form, setForm] = useState(false);
  const [name, setName] = useState("");
  const [raceDate, setRaceDate] = useState("");
  const [dist, setDist] = useState("10k");

  const refresh = () => { api.raceGoal().then((r) => setRace(r?.name ? r : null)).catch(() => setRace(null)); };
  useEffect(refresh, []);

  async function save(e) {
    e.preventDefault();
    if (!name || !raceDate) return;
    await api.setRaceGoal({ name, race_date: raceDate, distance_type: dist });
    setForm(false);
    setName(""); setRaceDate("");
    refresh();
  }

  async function clear() {
    await api.clearRaceGoal();
    refresh();
  }

  if (!race && !form) {
    return (
      <button onClick={() => setForm(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-panel2/40 px-4 py-3 text-sm font-medium text-muted transition hover:border-cardio/40 hover:text-cardio">
        <Flag size={15} /> Set a race goal
      </button>
    );
  }

  if (form) {
    return (
      <form onSubmit={save} className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-panel2/60 p-3">
        <div className="flex-1 min-w-[140px]">
          <label className="mb-1 block text-[10px] uppercase tracking-wide text-faint">Race name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. City Half"
            className="w-full rounded-lg border border-line bg-ink px-2 py-2 text-sm text-txt focus:border-cardio/50 focus:outline-none" />
        </div>
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wide text-faint">Date</label>
          <input type="date" value={raceDate} onChange={(e) => setRaceDate(e.target.value)}
            className="rounded-lg border border-line bg-ink px-2 py-2 text-sm text-txt focus:border-cardio/50 focus:outline-none" />
        </div>
        <div>
          <label className="mb-1 block text-[10px] uppercase tracking-wide text-faint">Distance</label>
          <select value={dist} onChange={(e) => setDist(e.target.value)}
            className="rounded-lg border border-line bg-ink px-2 py-2 text-sm text-txt focus:border-cardio/50 focus:outline-none">
            {DIST_OPTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </div>
        <button type="submit" className="rounded-lg bg-cardio px-4 py-2 text-sm font-semibold text-ink">Save</button>
        <button type="button" onClick={() => setForm(false)} className="text-faint hover:text-txt"><X size={16} /></button>
      </form>
    );
  }

  return (
    <Panel accent={COLORS.cardio} title={race.name} sub={`${race.distance_label} · ${fmtDate(race.race_date)}`}
      right={<button onClick={clear} className="text-faint hover:text-effort"><X size={15} /></button>}>
      <div className="flex items-center gap-4">
        <Flag size={24} className="text-cardio" />
        <div>
          <div className="font-mono text-2xl font-semibold text-cardio tnum">{race.days_left}</div>
          <div className="text-[11px] text-faint">days to go</div>
        </div>
        {race.in_taper && (
          <div className="ml-auto rounded-lg border border-strength/30 bg-strength/10 px-3 py-2 text-right">
            <div className="text-[10px] uppercase tracking-wide text-strength">Taper week</div>
            <div className="font-mono text-sm text-strength tnum">
              target ~{fmtNum(race.target_weekly_km, 0)}km <span className="text-faint">({Math.round(race.taper_pct * 100)}% of peak)</span>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

export function OverloadWarnings() {
  const [warnings, setWarnings] = useState([]);
  useEffect(() => { api.overloadWarnings().then(setWarnings).catch(() => {}); }, []);
  if (!warnings.length) return null;
  const latest = warnings[warnings.length - 1];
  return (
    <div className="flex items-center gap-3 rounded-xl border border-effort/30 bg-effort/10 px-4 py-3">
      <AlertTriangle size={16} className="text-effort shrink-0" />
      <p className="text-xs text-txt">
        {latest.kind === "return_after_gap" ? <><span className="font-medium">Running resumed after a low-volume week</span> ({fmtNum(latest.prev_km, 1)}km → {fmtNum(latest.current_km, 1)}km). Build gradually and use soreness/recovery—not a misleading percentage—as your guide.</> : <><span className="font-medium">Weekly volume increased {latest.pct_increase}%</span> ({fmtNum(latest.prev_km, 1)}km → {fmtNum(latest.current_km, 1)}km). This is above your established ≥10km baseline; monitor recovery and discomfort.</>}
      </p>
    </div>
  );
}

export function RepeatRoutes() {
  const [routes, setRoutes] = useState(null);
  useEffect(() => { api.repeatRoutes().then(setRoutes).catch(() => setRoutes([])); }, []);
  if (!routes?.length) return null;
  return (
    <Panel accent={COLORS.cardio} title="Repeat routes" sub="loops you run often">
      <div className="space-y-2">
        {routes.map((r, i) => (
          <div key={i} className="flex items-center justify-between rounded-lg border border-line bg-panel2/50 px-3 py-2">
            <div className="flex items-center gap-2.5">
              <Route size={15} className="text-cardio" />
              <div>
                <div className="text-sm text-txt">{fmtNum(r.distance_km, 1)}km loop</div>
                <div className="text-[11px] text-faint">{r.runs} runs · last {fmtDate(r.last_run_date)}</div>
              </div>
            </div>
            <div className="text-right font-mono text-xs tnum">
              <div className="text-recovery">PR {fmtPace(r.best_pace_s_per_km)}</div>
              <div className="text-faint">avg {fmtPace(r.avg_pace_s_per_km)}</div>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function ShoeTracker() {
  const [shoes, setShoes] = useState(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [target, setTarget] = useState(700);

  const refresh = () => { api.shoes().then(setShoes).catch(() => setShoes([])); };
  useEffect(refresh, []);

  async function add(e) {
    e.preventDefault();
    if (!name) return;
    await api.addShoe({ name, target_km: Number(target) });
    setName(""); setAdding(false);
    refresh();
  }

  async function retire(id) {
    await api.retireShoe(id);
    refresh();
  }

  if (!shoes) return null;
  const active = shoes.filter((s) => !s.retired);

  return (
    <Panel accent={COLORS.muted} title="Shoe mileage" sub="cumulative km per pair"
      right={<button onClick={() => setAdding((a) => !a)} className="text-faint hover:text-txt"><Plus size={16} /></button>}>
      {adding && (
        <form onSubmit={add} className="mb-3 flex flex-wrap items-end gap-2 rounded-xl border border-line bg-panel2/60 p-3">
          <div className="flex-1 min-w-[120px]">
            <label className="mb-1 block text-[10px] uppercase tracking-wide text-faint">Shoe name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pegasus 40"
              className="w-full rounded-lg border border-line bg-ink px-2 py-2 text-sm text-txt focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-[10px] uppercase tracking-wide text-faint">Target km</label>
            <input inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)}
              className="w-24 rounded-lg border border-line bg-ink px-2 py-2 text-sm text-txt focus:outline-none" />
          </div>
          <button type="submit" className="rounded-lg bg-muted/80 px-4 py-2 text-sm font-semibold text-ink">Add</button>
        </form>
      )}
      {active.length ? (
        <div className="space-y-2">
          {active.map((s) => (
            <div key={s.id} className="rounded-lg border border-line bg-panel2/50 px-3 py-2">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-txt"><Footprints size={14} className="text-muted" /> {s.name}</span>
                <span className="font-mono text-xs text-faint tnum">{fmtNum(s.total_km, 0)} / {fmtNum(s.target_km, 0)}km</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel">
                <div className="h-full rounded-full" style={{
                  width: `${s.pct_used}%`,
                  background: s.pct_used >= 90 ? COLORS.effort : s.pct_used >= 70 ? COLORS.strength : COLORS.recovery,
                }} />
              </div>
              {s.pct_used >= 90 && (
                <button onClick={() => retire(s.id)} className="mt-1.5 text-[10px] text-faint hover:text-effort">retire this pair</button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-faint">No shoes tracked yet — add a pair and assign it to runs from the activity detail view.</p>
      )}
    </Panel>
  );
}
