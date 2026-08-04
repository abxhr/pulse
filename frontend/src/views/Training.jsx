import { useEffect, useState } from "react";
import {
  ResponsiveContainer, ComposedChart, Area, Line, LineChart, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from "recharts";
import { api } from "../lib/api";
import { COLORS, fmtDate, fmtPace, fmtNum, fmtDuration, activityMeta, axisLabelStyle } from "../lib/format";
import { Panel, StatTile, Loading, Empty } from "../components/primitives";
import { ChartLegend, useSeriesToggle } from "../components/ChartLegend";
import ActivityDetail from "../components/ActivityDetail";
import IntradayChart from "../components/IntradayChart";
import { RaceGoalCard, OverloadWarnings, RepeatRoutes, ShoeTracker, KarvonenZonesCard } from "../components/CardioExtras";
import { consumePendingOpen } from "../components/CommandPalette";

const axis = { stroke: "#5b6479", fontSize: 11, fontFamily: "JetBrains Mono" };
const ZONE_COLORS = ["#8A93A6", "#3DD68C", "#F5A623", "#FF5C7A", "#c026d3"];
const ZONE_NAMES = ["Z1 easy", "Z2 aerobic", "Z3 tempo", "Z4 threshold", "Z5 max"];

function Tip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-panel2 px-3 py-2 shadow-panel">
      <div className="mb-1 font-mono text-[11px] text-muted">{fmtDate(label)}</div>
      {payload.map((p) => (
        p.value != null && (
          <div key={p.dataKey} className="flex items-center gap-2 text-xs">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
            <span className="text-txt font-mono tnum">{fmtNum(p.value, 1)}</span>
            <span className="text-faint">{p.name}</span>
          </div>
        )
      ))}
    </div>
  );
}

function RacePredictions({ data }) {
  if (!data?.predictions) return null;
  const labels = { "5k": "5K", "10k": "10K", half_marathon: "Half", marathon: "Marathon" };
  return (
    <Panel accent={COLORS.recovery} title="Predicted race times" sub={`from VO₂max ${fmtNum(data.vo2max, 1)} · as of ${fmtDate(data.vo2max_date)}`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Object.entries(data.predictions).map(([key, v]) => (
          <div key={key} className="rounded-xl border border-line bg-panel2/60 px-3 py-3 text-center">
            <div className="text-[10.5px] uppercase tracking-wider text-faint">{labels[key] || key}</div>
            <div className="mt-1 font-mono text-xl font-semibold text-recovery tnum">{fmtDuration(v.seconds)}</div>
            <div className="font-mono text-[11px] text-faint">{fmtPace(v.pace_per_km)}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-faint">Estimated from current fitness (ACSM VO₂ cost model) — a ballpark, not a guarantee.</p>
    </Panel>
  );
}

export default function Training() {
  const [acts, setActs] = useState(null);
  const [health, setHealth] = useState([]);
  const [zones, setZones] = useState(null);
  const [predictions, setPredictions] = useState(null);
  const [openId, setOpenId] = useState(null);
  const hrToggle = useSeriesToggle();

  useEffect(() => {
    api.activities(200).then(setActs).catch(() => setActs([]));
    api.healthTrend(90).then(setHealth).catch(() => setHealth([]));
    api.hrZones(30).then(setZones).catch(() => setZones(null));
    api.racePredictions().then(setPredictions).catch(() => setPredictions(null));
    const pending = consumePendingOpen("activity");
    if (pending) setOpenId(pending);
  }, []);
  if (!acts) return <Loading label="Reading activity log…" />;

  const runs = acts.filter((a) => (a.type || "").includes("run"));
  const totalKm = runs.reduce((s, a) => s + (a.distance_km || 0), 0);
  const vo2 = health.filter((h) => h.vo2max != null);
  const hrTrend = health.filter((h) => h.resting_hr != null || h.max_hr != null);
  const paceTrend = runs.filter((a) => a.pace_per_km).slice(0, 30).reverse();

  const zoneChart = zones?.zones_min?.map((min, i) => ({ zone: ZONE_NAMES[i], min, color: ZONE_COLORS[i] })) || [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label={`Runs (${acts.length} total)`} value={runs.length} color={COLORS.cardio} />
        <StatTile label="Distance" value={fmtNum(totalKm, 0)} unit="km" color={COLORS.cardio} />
        <StatTile label="Current VO₂max" value={vo2.length ? fmtNum(vo2[vo2.length - 1].vo2max, 1) : "—"} color={COLORS.recovery} />
        <StatTile label="Avg HR (runs)" value={fmtNum(runs.reduce((s, a) => s + (a.avg_hr || 0), 0) / (runs.length || 1))} unit="bpm" color={COLORS.effort} />
      </div>

      <RaceGoalCard />
      <OverloadWarnings />

      <RacePredictions data={predictions} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel accent={COLORS.recovery} title="VO₂max trend" sub="fitness trajectory · 90 days">
          {vo2.length ? (
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={vo2} margin={{ left: -8, right: 8, top: 6 }}>
                <defs>
                  <linearGradient id="v" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLORS.recovery} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={COLORS.recovery} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#1c2230" vertical={false} />
                <XAxis dataKey="date" tick={axis} tickFormatter={fmtDate} minTickGap={40} axisLine={false} tickLine={false} />
                <YAxis tick={axis} axisLine={false} tickLine={false} width={34} domain={["dataMin - 1", "dataMax + 1"]}
                  label={{ value: "ml/kg/min", angle: -90, position: "insideLeft", style: axisLabelStyle }} />
                <Tooltip content={<Tip />} />
                <Area type="monotone" dataKey="vo2max" name="VO₂max" stroke={COLORS.recovery} strokeWidth={2} fill="url(#v)" />
              </ComposedChart>
            </ResponsiveContainer>
          ) : <Empty title="No VO₂max data" body="Runs with a compatible Garmin device populate this." />}
        </Panel>

        <Panel accent={COLORS.effort} title="Resting vs max HR" sub="90 days">
          {hrTrend.length ? (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={hrTrend} margin={{ left: -8, right: 8, top: 6 }}>
                  <CartesianGrid stroke="#1c2230" vertical={false} />
                  <XAxis dataKey="date" tick={axis} tickFormatter={fmtDate} minTickGap={40} axisLine={false} tickLine={false} />
                  <YAxis tick={axis} axisLine={false} tickLine={false} width={34}
                    label={{ value: "bpm", angle: -90, position: "insideLeft", style: axisLabelStyle }} />
                  <Tooltip content={<Tip />} />
                  <Line type="monotone" dataKey="resting_hr" name="Resting HR" stroke={COLORS.recovery} strokeWidth={2} dot={false}
                    hide={hrToggle.hidden.has("resting_hr")} connectNulls />
                  <Line type="monotone" dataKey="max_hr" name="Max HR" stroke={COLORS.effort} strokeWidth={2} dot={false}
                    hide={hrToggle.hidden.has("max_hr")} connectNulls />
                </LineChart>
              </ResponsiveContainer>
              <ChartLegend series={[
                { key: "resting_hr", name: "Resting HR", color: COLORS.recovery },
                { key: "max_hr", name: "Max HR", color: COLORS.effort },
              ]} {...hrToggle} />
            </>
          ) : <Empty title="No HR trend yet" body="Syncs more days to populate this." />}
        </Panel>
      </div>

      <KarvonenZonesCard />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel accent={COLORS.strength} title="Time in HR zones" sub={`across ${zones?.activities_with_hr ?? 0} activities · 30 days`}>
          {zoneChart.some((z) => z.min > 0) ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={zoneChart} layout="vertical" margin={{ left: 16, right: 12, top: 6 }}>
                <CartesianGrid stroke="#1c2230" horizontal={false} />
                <XAxis type="number" tick={axis} axisLine={false} tickLine={false}
                  label={{ value: "minutes", position: "insideBottom", offset: -4, style: axisLabelStyle }} />
                <YAxis type="category" dataKey="zone" tick={{ ...axis, fontFamily: "Inter" }} axisLine={false} tickLine={false} width={80} />
                <Tooltip contentStyle={{ background: "#171C28", border: "1px solid #232a38", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 12 }} cursor={{ fill: "#ffffff08" }} />
                <Bar dataKey="min" name="Minutes" radius={[0, 4, 4, 0]} maxBarSize={20}>
                  {zoneChart.map((z, i) => <Cell key={i} fill={z.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty title="No HR zone data" body="Activities with HR sensor data populate this." />}
        </Panel>

        <Panel accent={COLORS.cardio} title="Pace trend" sub="last 30 runs">
          {paceTrend.length ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={paceTrend} margin={{ left: -8, right: 8, top: 6 }}>
                <CartesianGrid stroke="#1c2230" vertical={false} />
                <XAxis dataKey="date" tick={axis} tickFormatter={fmtDate} minTickGap={40} axisLine={false} tickLine={false} />
                <YAxis tick={axis} axisLine={false} tickLine={false} width={44} reversed
                  tickFormatter={(v) => fmtPace(v)} label={{ value: "pace", angle: -90, position: "insideLeft", style: axisLabelStyle }} />
                <Tooltip content={({ active, payload, label }) => active && payload?.length ? (
                  <div className="rounded-lg border border-line bg-panel2 px-3 py-2 shadow-panel">
                    <div className="mb-1 font-mono text-[11px] text-muted">{fmtDate(label)}</div>
                    <div className="text-xs text-cardio font-mono">{fmtPace(payload[0].value)}</div>
                  </div>
                ) : null} />
                <Line type="monotone" dataKey="pace_per_km" name="Pace" stroke={COLORS.cardio} strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : <Empty title="No pace data yet" body="Outdoor runs with GPS populate this." />}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RepeatRoutes />
        <ShoeTracker />
      </div>

      <IntradayChart />

      <Panel accent={COLORS.cardio} title="Activity log" sub={`${acts.length} total · click a row for the full breakdown`}>
        {acts.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[10.5px] uppercase tracking-wider text-faint">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Activity</th>
                  <th className="py-2 pr-3 text-right font-medium">Dist</th>
                  <th className="py-2 pr-3 text-right font-medium">Time</th>
                  <th className="py-2 pr-3 text-right font-medium">Pace</th>
                  <th className="py-2 pr-3 text-right font-medium">Avg HR</th>
                  <th className="py-2 text-right font-medium">TE</th>
                </tr>
              </thead>
              <tbody className="font-mono tnum text-[13px]">
                {acts.map((a) => {
                  const m = activityMeta(a.type);
                  return (
                    <tr key={a.id} onClick={() => setOpenId(a.id)}
                      className="cursor-pointer border-b border-line/50 hover:bg-panel2/40">
                      <td className="py-2 pr-3 text-muted">{fmtDate(a.date)}</td>
                      <td className="py-2 pr-3">
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full" style={{ background: COLORS[m.color] }} />
                          <span className="font-body text-txt">{a.name || m.label}</span>
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right text-txt">{a.distance_km ? `${a.distance_km}` : "—"}</td>
                      <td className="py-2 pr-3 text-right text-muted">{fmtDuration(a.duration_min * 60)}</td>
                      <td className="py-2 pr-3 text-right text-cardio">{a.pace_per_km ? fmtPace(a.pace_per_km) : "—"}</td>
                      <td className="py-2 pr-3 text-right text-effort">{a.avg_hr ?? "—"}</td>
                      <td className="py-2 text-right text-recovery">{a.aerobic_te != null ? fmtNum(a.aerobic_te, 1) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <Empty title="No activities yet" body="Sync Garmin to import runs, rides and more." />}
      </Panel>

      <ActivityDetail id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
