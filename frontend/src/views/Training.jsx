import { useEffect, useState } from "react";
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { api } from "../lib/api";
import { COLORS, fmtDate, fmtPace, fmtNum, fmtDuration, activityMeta } from "../lib/format";
import { Panel, StatTile, Chip, Loading, Empty } from "../components/primitives";
import ActivityDetail from "../components/ActivityDetail";

const axis = { stroke: "#5b6479", fontSize: 11, fontFamily: "JetBrains Mono" };

export default function Training() {
  const [acts, setActs] = useState(null);
  const [health, setHealth] = useState([]);
  const [openId, setOpenId] = useState(null);
  useEffect(() => {
    api.activities(200).then(setActs).catch(() => setActs([]));
    api.healthTrend(90).then(setHealth).catch(() => setHealth([]));
  }, []);
  if (!acts) return <Loading label="Reading activity log…" />;

  const runs = acts.filter((a) => (a.type || "").includes("run"));
  const totalKm = runs.reduce((s, a) => s + (a.distance_km || 0), 0);
  const vo2 = health.filter((h) => h.vo2max != null);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label={`Runs (${acts.length} total)`} value={runs.length} color={COLORS.cardio} />
        <StatTile label="Distance" value={fmtNum(totalKm, 0)} unit="km" color={COLORS.cardio} />
        <StatTile label="Current VO₂max" value={vo2.length ? fmtNum(vo2[vo2.length - 1].vo2max, 1) : "—"} color={COLORS.recovery} />
        <StatTile label="Avg HR (runs)" value={fmtNum(runs.reduce((s, a) => s + (a.avg_hr || 0), 0) / (runs.length || 1))} unit="bpm" color={COLORS.effort} />
      </div>

      <Panel accent={COLORS.recovery} title="VO₂max trend" sub="fitness trajectory · 90 days">
        {vo2.length ? (
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={vo2} margin={{ left: -18, right: 8, top: 6 }}>
              <defs>
                <linearGradient id="v" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.recovery} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={COLORS.recovery} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1c2230" vertical={false} />
              <XAxis dataKey="date" tick={axis} tickFormatter={fmtDate} minTickGap={40} axisLine={false} tickLine={false} />
              <YAxis tick={axis} axisLine={false} tickLine={false} width={34} domain={["dataMin - 1", "dataMax + 1"]} />
              <Tooltip
                contentStyle={{ background: "#171C28", border: "1px solid #232a38", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 12 }}
                labelFormatter={fmtDate}
              />
              <Area type="monotone" dataKey="vo2max" name="VO₂max" stroke={COLORS.recovery} strokeWidth={2} fill="url(#v)" />
            </ComposedChart>
          </ResponsiveContainer>
        ) : <Empty title="No VO₂max data" body="Runs with a compatible Garmin device populate this." />}
      </Panel>

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
