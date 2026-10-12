import { useEffect, useState } from "react";
import { Flag } from "lucide-react";
import { api } from "../lib/api";
import { useApi } from "../lib/useApi";
import { COLORS, fmtDuration, fmtDate, fmtNum, mix } from "../lib/format";
import { Panel, Chip } from "./primitives";
import { PlanBlock } from "./coach/Blocks";
import { askCoach } from "./coach/Briefing";

const VERDICT_COLOR = { ready: COLORS.recovery, on_track: COLORS.recovery, stretch: COLORS.strength, underprepared: COLORS.effort };

function Coverage({ facts, dist }) {
  const max = Math.max(dist, facts.target_km, facts.projected_peak_km) || 1;
  const pct = (km) => `${Math.min(100, (km / max) * 100)}%`;
  return (
    <div className="mt-4">
      <div className="relative h-3 rounded-full bg-panel2" role="img"
        aria-label={`Longest run ${facts.longest_6w_km} km, reachable ${facts.projected_peak_km} km, needed about ${facts.target_km} km`}>
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct(facts.projected_peak_km), background: mix(COLORS.cardio, 35) }} />
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct(facts.longest_6w_km), background: COLORS.cardio }} />
        <div className="absolute -inset-y-1 w-0.5 rounded bg-txt" style={{ left: pct(facts.target_km) }} />
      </div>
      <div className="relative mt-1 flex justify-between text-xs text-muted">
        <span><b className="font-num text-txt tnum">{fmtNum(facts.longest_6w_km, 1)}</b> km longest run, last 6 wks</span>
        <span>needs ~<b className="font-num text-txt tnum">{fmtNum(facts.target_km, 0)}</b> km</span>
      </div>
    </div>
  );
}

export default function RaceReadiness() {
  const { data, reload } = useApi("raceReadiness", api.raceReadiness, { ttl: 60_000 });
  const [plan, setPlan] = useState(false);
  useEffect(() => {
    window.addEventListener("pulse:data-changed", reload);
    return () => window.removeEventListener("pulse:data-changed", reload);
  }, [reload]);
  if (!data) return null;

  if (!data.race) {
    return (
      <Panel title="Race readiness" sub="No race set">
        <p className="max-w-prose text-sm text-muted">Tell the Coach what you're training for and it will judge whether you're on track, day by day.</p>
        <button onClick={() => askCoach("I'm training for a race. Help me set it up.")} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-recovery px-3.5 py-2 text-sm font-medium text-ink"><Flag size={14} />Set up my race</button>
      </Panel>
    );
  }

  const { race, facts, verdict, flags, estimated_finish: est, injuries } = data;
  const color = VERDICT_COLOR[verdict];
  const rows = data.bridge_plan.map((r) => ({ ...r }));
  return (
    <Panel title="Race readiness" sub={`${race.name} · ${fmtNum(race.distance_km, 1)} km · ${fmtDate(race.race_date)}`}
      right={<Chip color={color} solid>{race.days_left === 0 ? "Race day" : `${race.days_left} days`}</Chip>}>
      <p className="font-display text-xl font-semibold leading-snug" style={{ color }}>{data.label}</p>
      <p className="mt-1 max-w-prose text-sm text-muted">{data.headline}</p>
      <Coverage facts={facts} dist={race.distance_km} />
      <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
        {[["Weekly average (4 wks)", `${fmtNum(facts.weekly_km_avg_4w, 1)} km`], ["Runs per week", fmtNum(facts.runs_per_week_6w, 1)],
          ["Last run", facts.days_since_last_run == null ? "-" : facts.days_since_last_run === 0 ? "today" : `${facts.days_since_last_run} d ago`]].map(([k, v]) => (
          <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="font-num text-lg font-semibold text-txt tnum">{v}</dd></div>
        ))}
      </dl>
      {est && <p className="mt-3 text-xs text-muted">Finish estimate <b className="font-num text-txt">{fmtDuration(est.low_s)} to {fmtDuration(est.high_s)}</b>. {est.note}</p>}
      {injuries.length > 0 && <p className="mt-2 text-xs text-muted">Carrying: {injuries.map((i) => `${i.area} (${i.status})`).join(", ")}</p>}
      {flags.length > 0 && <ul className="mt-3 space-y-1 text-sm text-muted">{flags.slice(0, 3).map((f) => <li key={f} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />{f}</li>)}</ul>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={() => askCoach("Will I be OK for my race? Give me the honest options and what to do from now.")} className="rounded-lg bg-recovery px-3.5 py-2 text-sm font-medium text-ink hover:opacity-90">Ask the Coach what to do</button>
        <button onClick={() => setPlan((p) => !p)} aria-expanded={plan} className="rounded-lg bg-panel2 px-3.5 py-2 text-sm font-medium text-txt hover:bg-line">{plan ? "Hide" : "Show"} day-by-day plan</button>
      </div>
      {plan && <div className="mt-3"><PlanBlock block={{ title: `Bridge plan, ${data.plan_horizon_days} days`, rows, apply: { label: "Add to my plan", tool: "schedule_sessions", args: { sessions: rows.map(({ date, kind, title, details, distance_km }) => ({ date, kind, title, details, distance_km })) } } }} /></div>}
    </Panel>
  );
}
