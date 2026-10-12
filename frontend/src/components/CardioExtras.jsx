import { useEffect, useState } from "react";
import {
  ResponsiveContainer, ComposedChart, LineChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine,
} from "recharts";
import { Flag, Footprints, AlertTriangle, Route, Plus, X } from "lucide-react";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { COLORS, fmtNum, fmtPace, fmtDate, axisLabelStyle, ZONE_COLORS } from "../lib/format";
import { Panel, ErrorState } from "./primitives";

const axis = { stroke: "var(--color-faint)", fontSize: 12, fontFamily: "Instrument Sans" };

function FormTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="rounded-lg border border-line bg-ink px-3 py-2 shadow-lg">
      <div className="mb-1 font-mono text-xs text-muted">{fmtDate(label)}</div>
      <div className="text-xs text-recovery">Fitness (CTL) {p.fitness}</div>
      <div className="text-xs text-effort">Fatigue (ATL) {p.fatigue}</div>
      <div className="text-xs text-sleep">Form (TSB) {p.form}</div>
    </div>
  );
}

export function TrainingStressBalance() {
  const { data: series, error, reload } = useApi("tsb:180", () => api.trainingStressBalance(180));
  if (error) return <ErrorState title="Couldn't load training stress balance" onRetry={reload} />;
  if (!series?.length) return null;
  const latest = series[series.length - 1];
  const formLabel = latest.form > 5 ? "Fresh - ready for a hard effort" : latest.form < -20 ? "Deeply fatigued - overtraining risk" : latest.form < -10 ? "Building fatigue" : "Balanced";
  const formColor = latest.form > 5 ? COLORS.recovery : latest.form < -20 ? COLORS.effort : latest.form < -10 ? COLORS.strength : COLORS.sleep;

  return (
    <Panel accent={COLORS.sleep} title="Training stress balance" sub="Fitness / Fatigue / Form (Banister model), 180 days">
      <div className="mb-3 grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-panel2 px-3 py-2.5 text-center">
          <div className="text-xs text-faint">Fitness</div>
          <div className="font-num text-xl font-semibold text-recovery tnum">{latest.fitness}</div>
        </div>
        <div className="rounded-xl bg-panel2 px-3 py-2.5 text-center">
          <div className="text-xs text-faint">Fatigue</div>
          <div className="font-num text-xl font-semibold text-effort tnum">{latest.fatigue}</div>
        </div>
        <div className="rounded-xl bg-panel2 px-3 py-2.5 text-center">
          <div className="text-xs text-faint">Form</div>
          <div className="font-num text-xl font-semibold tnum" style={{ color: formColor }}>{latest.form}</div>
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
          <CartesianGrid stroke="var(--color-line)" vertical={false} />
          <XAxis dataKey="date" tick={axis} tickFormatter={fmtDate} minTickGap={40} axisLine={false} tickLine={false} />
          <YAxis tick={axis} axisLine={false} tickLine={false} width={36} label={{ value: "load", angle: -90, position: "insideLeft", style: axisLabelStyle }} />
          <Tooltip content={<FormTip />} />
          <ReferenceLine y={0} stroke="var(--color-faint)" />
          <Area type="monotone" dataKey="form" name="Form" stroke={COLORS.sleep} strokeWidth={2} fill="url(#tsbForm)" />
          <Line type="monotone" dataKey="fitness" name="Fitness" stroke={COLORS.recovery} strokeWidth={1.5} dot={false} />
          <Line type="monotone" dataKey="fatigue" name="Fatigue" stroke={COLORS.effort} strokeWidth={1.5} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="mt-2 text-xs text-faint">
        Fitness/Fatigue are exponentially-weighted training load (42d / 7d time constants). Form = Fitness − Fatigue -
        positive means fresh, sustained negative means accumulating fatigue.
      </p>
    </Panel>
  );
}


export function KarvonenZonesCard() {
  const { data: kz, error, reload } = useApi("karvonen:zones", () => api.karvonenZones());
  const { data: sessions } = useApi("karvonen:sessions:90", () => api.karvonenSessions());
  if (error) return <ErrorState title="Couldn't load heart-rate zones" onRetry={reload} />;
  const zones = kz?.zones ? kz : null;
  if (!zones) return null;
  const maxSessions = Math.max(1, ...(sessions || []).map((s) => s.sessions));

  return (
    <Panel accent={COLORS.effort} title="Personalized HR zones" sub={`Karvonen, max ${zones.max_hr}, resting ${zones.resting_hr}bpm`}>
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
              <span className="w-6 shrink-0 text-right font-mono text-xs text-faint tnum">{s?.sessions || 0}</span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-faint">
        Zones from heart-rate-reserve (your actual max/resting HR), not a generic %-of-max estimate.
        Session counts are by average HR per run, not a full time-in-zone breakdown.
      </p>
    </Panel>
  );
}

const DIST_OPTIONS = [
  { value: "5k", label: "5K" }, { value: "10k", label: "10K" },
  { value: "half_marathon", label: "Half Marathon" }, { value: "marathon", label: "Marathon" },
  { value: "custom", label: "Custom distance" },
];

export function RaceGoalCard() {
  const [race, setRace] = useState(null);
  const [form, setForm] = useState(false);
  const [name, setName] = useState("");
  const [raceDate, setRaceDate] = useState("");
  const [dist, setDist] = useState("10k");
  const [km, setKm] = useState("");

  const refresh = () => { api.raceGoal().then((r) => setRace(r?.name ? r : null)).catch(() => setRace(null)); };
  useEffect(refresh, []);

  async function save(e) {
    e.preventDefault();
    if (!name || !raceDate || (dist === "custom" && !(+km > 0))) return;
    await api.setRaceGoal({ name, race_date: raceDate, distance_type: dist, ...(dist === "custom" ? { distance_km: +km } : {}) });
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
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-panel2 px-4 py-3 text-sm font-medium text-muted transition hover:border-cardio/40 hover:text-cardio">
        <Flag size={15} /> Set a race goal
      </button>
    );
  }

  if (form) {
    return (
      <form onSubmit={save} className="flex flex-wrap items-end gap-2 rounded-xl bg-panel2 p-3">
        <div className="flex-1 min-w-[140px]">
          <label htmlFor="race-name" className="mb-1 block text-xs text-faint">Race name</label>
          <input id="race-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. City Half"
            className="w-full rounded-lg border border-line bg-ink px-2 py-2 text-sm text-txt focus:border-cardio/50 focus:outline-none" />
        </div>
        <div>
          <label htmlFor="race-date" className="mb-1 block text-xs text-faint">Date</label>
          <input id="race-date" type="date" value={raceDate} onChange={(e) => setRaceDate(e.target.value)}
            className="rounded-lg border border-line bg-ink px-2 py-2 text-sm text-txt focus:border-cardio/50 focus:outline-none" />
        </div>
        <div>
          <label htmlFor="race-dist" className="mb-1 block text-xs text-faint">Distance</label>
          <select id="race-dist" value={dist} onChange={(e) => setDist(e.target.value)}
            className="rounded-lg border border-line bg-ink px-2 py-2 text-sm text-txt focus:border-cardio/50 focus:outline-none">
            {DIST_OPTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </div>
        {dist === "custom" && (
          <div>
            <label htmlFor="race-km" className="mb-1 block text-xs text-faint">Kilometres</label>
            <input id="race-km" type="number" min="1" step="0.1" value={km} onChange={(e) => setKm(e.target.value)} placeholder="25"
              className="w-24 rounded-lg border border-line bg-ink px-2 py-2 text-sm text-txt focus:border-cardio/50 focus:outline-none" />
          </div>
        )}
        <button type="submit" className="rounded-lg bg-cardio px-4 py-2 text-sm font-semibold text-ink">Save</button>
        <button type="button" onClick={() => setForm(false)} aria-label="Cancel" className="text-faint hover:text-txt"><X size={16} /></button>
      </form>
    );
  }

  return (
    <Panel accent={COLORS.cardio} title={race.name} sub={`${race.distance_label}, ${fmtDate(race.race_date)}`}
      right={<button onClick={clear} aria-label="Clear race goal" className="text-faint hover:text-effort"><X size={15} /></button>}>
      <div className="flex items-center gap-4">
        <Flag size={24} className="text-cardio" />
        <div>
          <div className="font-num text-2xl font-semibold text-cardio tnum">{race.days_left}</div>
          <div className="text-xs text-faint">days to go</div>
        </div>
        {race.in_taper && (
          <div className="ml-auto rounded-lg border border-strength/30 bg-strength/10 px-3 py-2 text-right">
            <div className="text-xs text-strength">Taper week</div>
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
        {latest.kind === "return_after_gap" ? <><span className="font-medium">Running resumed after a low-volume week</span> ({fmtNum(latest.prev_km, 1)}km → {fmtNum(latest.current_km, 1)}km). Build gradually and use soreness/recovery-not a misleading percentage-as your guide.</> : <><span className="font-medium">Weekly volume increased {latest.pct_increase}%</span> ({fmtNum(latest.prev_km, 1)}km → {fmtNum(latest.current_km, 1)}km). This is above your established ≥10km baseline; monitor recovery and discomfort.</>}
      </p>
    </div>
  );
}

export function RepeatRoutes() {
  const { data: routes, error, reload } = useApi("repeatRoutes", () => api.repeatRoutes());
  if (error) return <ErrorState title="Couldn't load repeat routes" onRetry={reload} />;
  if (!routes?.length) return null;
  return (
    <Panel accent={COLORS.cardio} title="Repeat routes" sub="loops you run often">
      <div className="space-y-2">
        {routes.map((r, i) => (
          <div key={i} className="flex items-center justify-between rounded-lg bg-panel2 px-3 py-2">
            <div className="flex items-center gap-2.5">
              <Route size={15} className="text-cardio" />
              <div>
                <div className="text-sm text-txt">{fmtNum(r.distance_km, 1)}km loop</div>
                <div className="text-xs text-faint">{r.runs} runs · last {fmtDate(r.last_run_date)}</div>
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
      right={<button onClick={() => setAdding((a) => !a)} aria-label="Add shoe" className="text-faint hover:text-txt"><Plus size={16} /></button>}>
      {adding && (
        <form onSubmit={add} className="mb-3 flex flex-wrap items-end gap-2 rounded-xl bg-panel2 p-3">
          <div className="flex-1 min-w-[120px]">
            <label htmlFor="shoe-name" className="mb-1 block text-xs text-faint">Shoe name</label>
            <input id="shoe-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pegasus 40"
              className="w-full rounded-lg border border-line bg-ink px-2 py-2 text-sm text-txt focus:outline-none" />
          </div>
          <div>
            <label htmlFor="shoe-km" className="mb-1 block text-xs text-faint">Target km</label>
            <input id="shoe-km" inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value)}
              className="w-24 rounded-lg border border-line bg-ink px-2 py-2 text-sm text-txt focus:outline-none" />
          </div>
          <button type="submit" className="rounded-lg bg-muted/80 px-4 py-2 text-sm font-semibold text-ink">Add</button>
        </form>
      )}
      {active.length ? (
        <div className="space-y-2">
          {active.map((s) => (
            <div key={s.id} className="rounded-lg bg-panel2 px-3 py-2">
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
                <button onClick={() => retire(s.id)} className="mt-1.5 text-xs text-faint hover:text-effort">retire this pair</button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-faint">No shoes tracked yet - add a pair and assign it to runs from the activity detail view.</p>
      )}
    </Panel>
  );
}

export function RunInsights() {
  const { data: d, error, reload: load } = useApi("runInsights:12", () => api.runInsights(12));
  const [fetching, setFetching] = useState(false);
  const [fetchErr, setFetchErr] = useState(null);

  // Garmin splits are fetched in small batches until none remain, so each request stays fast.
  async function fetchSplits() {
    setFetching(true); setFetchErr(null);
    try {
      for (let i = 0; i < 40; i++) {
        const r = await api.syncSplits(8);
        if (r.done) break;
      }
    } catch (e) {
      setFetchErr(e?.message || "Could not reach Garmin");
    }
    setFetching(false);
    load();
  }

  if (error) return <ErrorState title="Couldn't load run insights" onRetry={load} />;
  if (!d?.weeks?.length) return null;
  const cov = d.splits_coverage;
  const missingSplits = cov ? cov.runs - cov.with_splits : 0;
  const dec = d.decoupling || [];
  const medDec = dec.length ? [...dec].map((x) => x.pct).sort((a, b) => a - b)[Math.floor(dec.length / 2)] : null;
  const weeks = d.weeks.filter((w) => w.easy_pct != null);
  const avgEasy = weeks.length ? Math.round(weeks.reduce((s, w) => s + w.easy_pct, 0) / weeks.length) : null;
  const last = d.weeks[d.weeks.length - 1];
  const ef = d.efficiency_change_pct;
  const efColor = ef == null ? COLORS.muted : ef >= 0 ? COLORS.recovery : COLORS.effort;
  const longHigh = last.long_run_pct > 40 && d.weeks.length > 0 && last.km >= 15;

  return (
    <Panel accent={COLORS.cardio} title="Run insights" sub="aerobic efficiency, easy/hard split, long-run share">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-panel2 px-3 py-2.5 text-center">
          <div className="text-xs text-faint">Efficiency 4wk</div>
          <div className="font-num text-xl font-semibold tnum" style={{ color: efColor }}>
            {ef == null ? "-" : `${ef > 0 ? "+" : ""}${ef}%`}
          </div>
        </div>
        <div className="rounded-xl bg-panel2 px-3 py-2.5 text-center">
          <div className="text-xs text-faint">Easy time</div>
          <div className="font-num text-xl font-semibold tnum" style={{ color: avgEasy >= 75 ? COLORS.recovery : COLORS.strength }}>
            {avgEasy == null ? "-" : `${avgEasy}%`}
          </div>
        </div>
        <div className="rounded-xl bg-panel2 px-3 py-2.5 text-center">
          <div className="text-xs text-faint">Long run</div>
          <div className="font-num text-xl font-semibold tnum" style={{ color: longHigh ? COLORS.strength : COLORS.cardio }}>
            {last.long_run_pct ?? "-"}%
          </div>
        </div>
      </div>
      {Object.keys(d.bests || {}).length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {Object.entries(d.bests).map(([k, b]) => (
            <div key={k} className="rounded-lg bg-panel2 px-3 py-1.5 text-xs">
              <span className=" text-faint">{k === "half" ? "Half" : k.toUpperCase()}+</span>{" "}
              <span className="font-mono text-recovery tnum">{fmtPace(b.pace_s_per_km)}</span>{" "}
              <span className="text-faint">{fmtNum(b.run_km, 1)}km · {fmtDate(b.date)}</span>{" "}
              {b.source === "splits"
                ? <span className="text-recovery" title="Measured from the fastest consecutive laps">exact</span>
                : <span className="text-strength" title="Average pace of a whole run at least this long - a slower bound">approx</span>}
            </div>
          ))}
        </div>
      )}
      {weeks.length > 0 && (
      <ResponsiveContainer width="100%" height={140}>
        <ComposedChart data={d.weeks} margin={{ left: -8, right: 8, top: 10 }}>
          <CartesianGrid stroke="var(--color-line)" vertical={false} />
          <XAxis dataKey="week" tick={axis} tickFormatter={(w) => w.slice(-3)} axisLine={false} tickLine={false} />
          <YAxis tick={axis} axisLine={false} tickLine={false} width={36} domain={[0, 100]} />
          <Tooltip contentStyle={{ background: "var(--color-panel2)", border: "1px solid var(--color-line)", borderRadius: 8, fontSize: 12 }} />
          <ReferenceLine y={80} stroke="var(--color-faint)" strokeDasharray="3 3" />
          <Line type="monotone" dataKey="easy_pct" name="Easy %" stroke={COLORS.recovery} strokeWidth={2} dot={{ r: 2 }} connectNulls />
          <Line type="monotone" dataKey="hard_pct" name="Hard %" stroke={COLORS.effort} strokeWidth={1.5} dot={false} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
      )}
      {missingSplits > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-panel2 px-3 py-2 text-xs text-muted">
          <span>{cov.with_splits}/{cov.runs} runs have lap data. Fetch the rest for exact best efforts and aerobic decoupling.</span>
          <button onClick={fetchSplits} disabled={fetching}
            className="rounded-md bg-cardio px-3 py-1 text-xs font-semibold text-ink disabled:opacity-60">
            {fetching ? "Fetching…" : "Fetch lap data"}
          </button>
          {fetchErr && <span role="alert" className="text-effort">{fetchErr}</span>}
        </div>
      )}
      {dec.length > 0 && (
        <div className="mt-3 text-xs text-muted">
          Aerobic decoupling (median of {dec.length} runs):{" "}
          <span className="font-mono text-sm tnum" style={{ color: medDec <= 5 ? COLORS.recovery : COLORS.strength }}>{medDec}%</span>
          <span className="text-faint"> · under ~5% means HR holds steady at the same pace; higher means cardiac drift.</span>
        </div>
      )}
      {d.weeks.some((w) => w.cadence) && (
        <>
          <div className="mt-3 text-xs text-faint">Cadence (spm) · weekly average</div>
          <ResponsiveContainer width="100%" height={90}>
            <LineChart data={d.weeks} margin={{ left: -8, right: 8, top: 6 }}>
              <XAxis dataKey="week" tick={axis} tickFormatter={(w) => w.slice(-3)} axisLine={false} tickLine={false} />
              <YAxis tick={axis} axisLine={false} tickLine={false} width={36} domain={["dataMin - 3", "dataMax + 3"]} />
              <Tooltip contentStyle={{ background: "var(--color-panel2)", border: "1px solid var(--color-line)", borderRadius: 8, fontSize: 12 }} />
              <Line type="monotone" dataKey="cadence" name="Cadence" stroke={COLORS.cardio} strokeWidth={2} dot={{ r: 2 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
      {d.pace_bands && (
        <p className="mt-3 text-xs text-muted">
          vs your median {fmtPace(d.median_pace_s_per_km)}: <span className="text-txt">{d.pace_bands.easier}</span> easier runs ·{" "}
          <span className="text-txt">{d.pace_bands.steady}</span> steady · <span className="text-txt">{d.pace_bands.faster}</span> faster (±8%).
        </p>
      )}
      <p className="mt-2 text-xs text-faint">
        Efficiency = speed per heartbeat, last 4 weeks vs the 4 before (up = fitter at the same effort). Easy = HR zones 1-2;
        the dashed line is the common 80% easy target. Long run is your longest run as a share of that week's km (~30-35% is typical).
      </p>
    </Panel>
  );
}

const CALL_STYLE = {
  hard: { label: "Quality session OK", color: COLORS.recovery }, moderate: { label: "Moderate effort", color: COLORS.cardio },
  easy: { label: "Easy day", color: COLORS.strength }, rest: { label: "Rest", color: COLORS.effort },
  unknown: { label: "No call yet", color: COLORS.muted },
};

export function TodaysCall() {
  const { data: d, error, reload } = useApi("todaysCall", () => api.todaysCall());
  if (error) return <ErrorState title="Couldn't work out today's call" onRetry={reload} />;
  if (!d?.call) return null;
  const st = CALL_STYLE[d.call] || CALL_STYLE.unknown;
  return (
    <Panel accent={st.color} title="Today's call" sub="recovery risk, load balance, Garmin readiness">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="font-display text-3xl font-semibold" style={{ color: st.color }}>{st.label}</div>
        <ul className="space-y-0.5 text-xs text-muted">
          {d.reasons.map((r) => <li key={r}>• {r}</li>)}
        </ul>
      </div>
    </Panel>
  );
}

export function PlanCompliance() {
  const { data: weeks, error, reload } = useApi("planCompliance:6", () => api.planCompliance(6));
  if (error) return <ErrorState title="Couldn't load plan vs actual" onRetry={reload} />;
  if (!weeks?.length) return null;
  const totPlanned = weeks.reduce((s, w) => s + w.planned_km, 0);
  const totActual = weeks.reduce((s, w) => s + w.actual_km, 0);
  const pct = totPlanned ? Math.round((totActual / totPlanned) * 100) : null;
  return (
    <Panel accent={COLORS.cardio} title="Plan vs actual" sub={`running · last ${weeks.length} planned weeks${pct != null ? ` · ${pct}% of planned km` : ""}`}>
      <div className="space-y-2">
        {weeks.map((w) => {
          const p = Math.min(w.km_pct ?? 0, 120);
          const color = w.km_pct == null ? COLORS.muted : w.km_pct >= 90 && w.km_pct <= 115 ? COLORS.recovery : w.km_pct < 70 ? COLORS.effort : COLORS.strength;
          return (
            <div key={w.week} className="flex items-center gap-3 text-xs">
              <span className="w-14 shrink-0 font-mono text-faint">{fmtDate(w.week)}</span>
              <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-panel2" role="img"
                aria-label={`${w.actual_km} of ${w.planned_km} planned km`}>
                <div className="h-full rounded-full" style={{ width: `${(p / 120) * 100}%`, background: color }} />
                <span className="absolute inset-y-0 w-px bg-faint/60" style={{ left: `${(100 / 120) * 100}%` }} aria-hidden="true" />
              </div>
              <span className="w-28 shrink-0 whitespace-nowrap text-right font-mono tnum text-muted">{fmtNum(w.actual_km, 1)} / {fmtNum(w.planned_km, 0)}km</span>
              <span className="w-16 shrink-0 whitespace-nowrap text-right font-mono tnum text-faint">{w.runs_done}/{w.planned_runs} runs</span>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-faint">
        Green = 90-115% of planned distance, amber = over or slightly under, red = under 70%. The tick marks 100%. Skipped sessions are excluded; the current week counts only sessions already due.
      </p>
    </Panel>
  );
}
