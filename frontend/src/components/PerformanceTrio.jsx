import { useEffect, useState } from "react";
import { ResponsiveContainer, ComposedChart, Bar, Line, Cell, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { api } from "../lib/api";
import { COLORS, fmtDate, fmtNum } from "../lib/format";
import { Panel, ErrorState } from "./primitives";

const BAND = { green: COLORS.recovery, yellow: COLORS.strength, red: COLORS.effort };
const BAND_WORD = { green: "Primed", yellow: "Moderate", red: "Run down" };
const WHY = {
  hrv: "HRV is below your norm",
  resting_hr: "Resting heart rate is above your norm",
  respiration: "Breathing rate is up",
  sleep: "Sleep fell short of what you needed",
};
const axis = { stroke: "var(--color-faint)", fontSize: 12, fontFamily: "Instrument Sans" };

/** A thin meter, optionally with a shaded target range. */
function Meter({ value, max, color, target, label }) {
  const pct = (v) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  return (
    <div className="relative mt-3 h-2 rounded-full bg-panel2" role="img" aria-label={label}>
      {target && (
        <span className="absolute inset-y-0 rounded-full bg-txt/15"
          style={{ left: pct(target[0]), width: `${((target[1] - target[0]) / max) * 100}%` }} />
      )}
      <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct(value ?? 0), background: color }} />
    </div>
  );
}

function Figure({ label, value, unit, color, meter, note }) {
  return (
    <div className="min-w-0">
      <div className="text-sm text-muted">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="font-num text-6xl font-semibold leading-none tnum" style={{ color }}>{value ?? "-"}</span>
        {unit && <span className="text-lg text-muted">{unit}</span>}
      </div>
      {meter}
      <div className="mt-2 text-sm text-muted">{note}</div>
    </div>
  );
}

function Tip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-line bg-ink px-3 py-2 text-sm shadow-lg">
      <div className="mb-1 text-muted">{fmtDate(label)}</div>
      {row.recovery != null && <div style={{ color: BAND[row.band] }}>Recovery {row.recovery}%</div>}
      {row.strain != null && <div className="text-cardio">Strain {fmtNum(row.strain, 1)}</div>}
      {row.sleep_performance != null && <div className="text-sleep">Sleep {row.sleep_performance}%</div>}
    </div>
  );
}

export default function PerformanceTrio() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const load = () => {
    setErr(null);
    api.performance(30).then(setD).catch((e) => setErr(String(e?.message || e)));
  };
  useEffect(load, []);

  if (err) return <ErrorState title="Couldn't load recovery and strain" detail={err} onRetry={load} />;
  if (!d) return null;
  const r = d.latest_scored;
  const t = d.today;
  if (!r) {
    return (
      <Panel title="Recovery, strain and sleep" sub="Needs about a week of HRV and sleep history before it can score you">
        <p className="text-sm text-muted">Keep syncing Garmin. Recovery compares each night with your own 28-day baseline.</p>
      </Panel>
    );
  }
  const band = r.band;
  const why = WHY[r.factors?.[0]?.factor];
  const strainNow = r.strain ?? 0;
  const [lo, hi] = r.strain_target || [];
  const strainNote = r.strain_target
    ? strainNow > hi ? `Above the ${lo}-${hi} target for this recovery`
      : strainNow >= lo ? `On target (${lo}-${hi})`
      : `${fmtNum(lo - strainNow, 1)} short of the ${lo}-${hi} target`
    : "No target yet";

  return (
    <Panel title="Recovery, strain and sleep" sub={`Scored ${fmtDate(r.date)} against your own 28-day baselines`}>
      <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
        <Figure label="Recovery" value={r.recovery} unit="%" color={BAND[band]}
          meter={<Meter value={r.recovery} max={100} color={BAND[band]} label={`Recovery ${r.recovery} percent`} />}
          note={<><b className="font-semibold" style={{ color: BAND[band] }}>{BAND_WORD[band]}.</b>{" "}
            {band !== "green" && why ? `${why}.` : "HRV, resting heart rate and sleep are at or above your norm."}</>} />
        <Figure label="Day strain" value={fmtNum(strainNow, 1)} unit="of 21" color={COLORS.cardio}
          meter={<Meter value={strainNow} max={21} color={COLORS.cardio} target={r.strain_target} label={`Strain ${strainNow} of 21`} />}
          note={strainNote} />
        <Figure label="Sleep performance" value={r.sleep_performance} unit="%" color={COLORS.sleep}
          meter={<Meter value={r.sleep_performance} max={100} color={COLORS.sleep} label={`Sleep ${r.sleep_performance} percent of need`} />}
          note={r.slept_h ? `${fmtNum(r.slept_h, 1)} h slept of ${fmtNum(r.sleep_need_h, 1)} h needed` : `Need ${fmtNum(r.sleep_need_h, 1)} h`} />
      </div>

      <div className="mt-8">
        <div className="mb-1 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-muted">
          <span>Last 30 days</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLORS.recovery }} />Recovery, coloured by band</span>
          <span className="flex items-center gap-1.5"><span className="h-0.5 w-4" style={{ background: COLORS.cardio }} />Strain</span>
        </div>
        <ResponsiveContainer width="100%" height={190}>
          <ComposedChart data={d.series} margin={{ left: -18, right: -12, top: 8 }}>
            <CartesianGrid stroke="var(--color-line)" vertical={false} />
            <XAxis dataKey="date" tick={axis} tickFormatter={fmtDate} minTickGap={32} axisLine={false} tickLine={false} />
            <YAxis yAxisId="r" domain={[0, 100]} tick={axis} axisLine={false} tickLine={false} width={36} />
            <YAxis yAxisId="s" orientation="right" domain={[0, 21]} tick={axis} axisLine={false} tickLine={false} width={36} />
            <Tooltip content={<Tip />} cursor={{ fill: "var(--color-panel2)" }} />
            <Bar yAxisId="r" dataKey="recovery" maxBarSize={14} radius={[2, 2, 0, 0]}>
              {d.series.map((x, i) => <Cell key={i} fill={BAND[x.band] || "var(--color-line)"} fillOpacity={0.85} />)}
            </Bar>
            <Line yAxisId="s" type="monotone" dataKey="strain" stroke={COLORS.cardio} strokeWidth={2} dot={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {r.date !== t?.date && (
        <p className="mt-2 text-sm text-faint">Today isn't scored yet. Garmin hasn't reported last night's HRV, so this shows {fmtDate(r.date)}.</p>
      )}
    </Panel>
  );
}
