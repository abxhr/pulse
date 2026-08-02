import { useEffect, useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from "recharts";
import { Activity, Moon, HeartPulse, Flame, Footprints, TrendingUp } from "lucide-react";
import { api } from "../lib/api";
import { COLORS, fmtDate, fmtPace, fmtNum, activityMeta } from "../lib/format";
import { Panel, StatTile, Chip, Loading, Empty } from "../components/primitives";
import ReadinessRing from "../components/ReadinessRing";

const axis = { stroke: "#5b6479", fontSize: 11, fontFamily: "JetBrains Mono" };

function ChartTip({ active, payload, label, unit = "" }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-panel2 px-3 py-2 shadow-panel">
      <div className="mb-1 font-mono text-[11px] text-muted">{fmtDate(label)}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-xs">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-txt tnum font-mono">{fmtNum(p.value, 1)}{unit}</span>
          <span className="text-faint">{p.name}</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.dashboard().then(setD).catch((e) => setErr(String(e)));
  }, []);

  if (err) return <Empty title="Couldn't load dashboard" body={err} />;
  if (!d) return <Loading />;

  const s = d.snapshot;
  const bb = s.body_battery_high;

  return (
    <div className="space-y-4">
      {/* hero */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[auto_1fr]">
        <Panel accent={COLORS.recovery} title="Today" sub={s.date || "no data yet"}>
          <div className="flex items-center justify-center py-2">
            <ReadinessRing
              score={s.training_readiness}
              label={s.training_readiness_label}
              bodyBattery={bb}
            />
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {s.training_status && <Chip color={COLORS.cardio}>{s.training_status}</Chip>}
            {s.hrv_status && <Chip color={COLORS.recovery}>HRV {s.hrv_status}</Chip>}
          </div>
        </Panel>

        <Panel accent={COLORS.effort} title="Vitals" sub="latest readings">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile label="Resting HR" value={s.resting_hr} unit="bpm" color={COLORS.effort} />
            <StatTile label="HRV" value={s.hrv_last_night} unit="ms" color={COLORS.recovery} />
            <StatTile label="Sleep score" value={s.sleep_score} color={COLORS.sleep}
              hint={s.sleep_seconds ? `${(s.sleep_seconds / 3600).toFixed(1)}h slept` : null} />
            <StatTile label="VO₂max" value={s.vo2max} color={COLORS.cardio} />
            <StatTile label="Stress" value={s.stress} color={COLORS.strength} />
            <StatTile label="Steps" value={fmtNum(s.steps)} color={COLORS.muted}
              hint={s.step_goal ? `goal ${fmtNum(s.step_goal)}` : null} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile label="Intensity min" value={s.intensity_minutes} color={COLORS.recovery} />
            <StatTile label="Body battery" value={s.body_battery_high} unit="peak" color={COLORS.sleep} />
            <StatTile label="Readiness" value={s.training_readiness} color={COLORS.recovery}
              hint={s.training_readiness_label} />
          </div>
        </Panel>
      </div>

      {/* trends row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel accent={COLORS.recovery} title="Recovery" sub="HRV vs resting HR · 30 days">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={d.health_trend} margin={{ left: -18, right: 8, top: 6 }}>
              <CartesianGrid stroke="#1c2230" vertical={false} />
              <XAxis dataKey="date" tick={axis} tickFormatter={fmtDate} minTickGap={28} axisLine={false} tickLine={false} />
              <YAxis yAxisId="l" tick={axis} axisLine={false} tickLine={false} width={40} />
              <YAxis yAxisId="r" orientation="right" tick={axis} axisLine={false} tickLine={false} width={30} />
              <Tooltip content={<ChartTip />} />
              <Line yAxisId="l" type="monotone" dataKey="hrv" name="HRV" stroke={COLORS.recovery} strokeWidth={2} dot={false} />
              <Line yAxisId="r" type="monotone" dataKey="resting_hr" name="Rest HR" stroke={COLORS.effort} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>

        <Panel accent={COLORS.sleep} title="Sleep" sub="hours + score · 30 days">
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={d.sleep_trend} margin={{ left: -18, right: 8, top: 6 }}>
              <defs>
                <linearGradient id="sl" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.sleep} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={COLORS.sleep} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1c2230" vertical={false} />
              <XAxis dataKey="date" tick={axis} tickFormatter={fmtDate} minTickGap={28} axisLine={false} tickLine={false} />
              <YAxis tick={axis} axisLine={false} tickLine={false} width={40} />
              <Tooltip content={<ChartTip unit="h" />} />
              <Area type="monotone" dataKey="total_h" name="Hours" stroke={COLORS.sleep} strokeWidth={2} fill="url(#sl)" />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      {/* training load + activities */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel accent={COLORS.cardio} title="Training load" sub="weekly run km + strength volume · 12 weeks">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={d.training_load} margin={{ left: -18, right: 8, top: 6 }}>
              <CartesianGrid stroke="#1c2230" vertical={false} />
              <XAxis dataKey="week" tick={axis} axisLine={false} tickLine={false}
                tickFormatter={(w) => w?.split("-W")[1]} />
              <YAxis yAxisId="l" tick={axis} axisLine={false} tickLine={false} width={38} />
              <YAxis yAxisId="r" orientation="right" tick={axis} axisLine={false} tickLine={false} width={44} />
              <Tooltip content={<ChartTip />} cursor={{ fill: "#ffffff08" }} />
              <Bar yAxisId="l" dataKey="run_km" name="Run km" fill={COLORS.cardio} radius={[3, 3, 0, 0]} maxBarSize={16} />
              <Bar yAxisId="r" dataKey="strength_volume" name="Volume kg" fill={COLORS.strength} radius={[3, 3, 0, 0]} maxBarSize={16} opacity={0.85} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel accent={COLORS.strength} title="Recent sessions">
          {d.activities?.length ? (
            <ul className="space-y-2">
              {d.activities.map((a) => {
                const m = activityMeta(a.type);
                return (
                  <li key={a.id} className="flex items-center justify-between rounded-lg border border-line bg-panel2/50 px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      <span className="h-8 w-1 rounded-full" style={{ background: COLORS[m.color] }} />
                      <div>
                        <div className="text-sm text-txt">{a.name || m.label}</div>
                        <div className="font-mono text-[11px] text-faint">{fmtDate(a.date)}</div>
                      </div>
                    </div>
                    <div className="text-right font-mono text-xs text-muted tnum">
                      <div className="text-txt">{a.distance_km ? `${a.distance_km} km` : `${a.duration_min}m`}</div>
                      <div>{a.pace_per_km ? fmtPace(a.pace_per_km) : `HR ${a.avg_hr ?? "—"}`}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty title="No activities yet" body="Sync Garmin to pull your runs and rides." />
          )}
        </Panel>
      </div>
    </div>
  );
}
