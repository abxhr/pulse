import { useEffect, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from "recharts";
import { api } from "../lib/api";
import { COLORS, fmtNum, fmtDate, fmtDuration } from "../lib/format";
import { Panel, StatTile, Loading, Empty } from "../components/primitives";
import MuscleBody from "../components/MuscleBody";
import WorkoutDetail from "../components/WorkoutDetail";

const axis = { stroke: "#5b6479", fontSize: 11, fontFamily: "JetBrains Mono" };
const MUSCLE_COLORS = ["#F5A623", "#FF5C7A", "#38BDF8", "#7C83FF", "#3DD68C", "#a3a8ff", "#f0883e"];

function WeekHeatmap({ week }) {
  const [hover, setHover] = useState(null);
  if (!week) return null;
  const intensities = Object.fromEntries((week.by_muscle || []).map((m) => [m.muscle, m.intensity]));
  const hoveredData = hover && (week.by_muscle || []).find((m) => m.muscle.toLowerCase() === hover.toLowerCase());

  return (
    <Panel accent={COLORS.strength} title="Muscles hit this week"
      sub={`Mon ${fmtDate(week.week_start)} – Sun ${fmtDate(week.week_end)} · ${week.workout_count} session${week.workout_count === 1 ? "" : "s"}`}>
      <MuscleBody intensities={intensities} onHover={setHover} />
      <div className="mt-2 flex min-h-[18px] items-center justify-center font-mono text-xs text-muted">
        {hover
          ? `${hover}${hoveredData ? ` · ${fmtNum(hoveredData.volume_kg)}kg · ${hoveredData.sets} sets` : " · not hit yet"}`
          : "hover a region"}
      </div>
      {!week.workout_count && (
        <p className="mt-2 text-center text-xs text-faint">No workouts logged yet this week.</p>
      )}
    </Panel>
  );
}

export default function Strength() {
  const [s, setS] = useState(null);
  const [week, setWeek] = useState(null);
  const [wkos, setWkos] = useState([]);
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    api.strength(8).then(setS).catch(() => setS({ by_muscle: [], top_exercises: [], weekly_volume: [] }));
    api.strengthThisWeek().then(setWeek).catch(() => setWeek(null));
    api.workouts(200).then(setWkos).catch(() => setWkos([]));
  }, []);

  if (!s) return <Loading label="Reading strength log…" />;
  const empty = !s.workout_count;
  if (empty) return <Empty title="No workouts yet" body="Sync Hevy to import your lifting history." />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Volume (8wk)" value={fmtNum(s.total_volume_kg)} unit="kg" color={COLORS.strength} />
        <StatTile label="Workouts (8wk)" value={s.workout_count} color={COLORS.strength} />
        <StatTile label="Top lift" value={s.top_exercises[0]?.exercise?.split(" (")[0] || "—"} color={COLORS.effort} />
        <StatTile label="Best set" value={fmtNum(s.top_exercises[0]?.best_kg)} unit="kg" color={COLORS.effort} />
      </div>

      <WeekHeatmap week={week} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel accent={COLORS.strength} title="Weekly volume" sub="total kg moved · 8 weeks">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={s.weekly_volume} margin={{ left: -8, right: 8, top: 6 }}>
              <CartesianGrid stroke="#1c2230" vertical={false} />
              <XAxis dataKey="week" tick={axis} axisLine={false} tickLine={false} tickFormatter={(w) => w?.split("-W")[1]} />
              <YAxis tick={axis} axisLine={false} tickLine={false} width={52} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ background: "#171C28", border: "1px solid #232a38", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 12 }}
              />
              <Bar dataKey="volume_kg" name="Volume kg" fill={COLORS.strength} radius={[3, 3, 0, 0]} maxBarSize={30} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel accent={COLORS.effort} title="Volume by muscle group" sub="8 weeks">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={s.by_muscle} layout="vertical" margin={{ left: 16, right: 12, top: 6 }}>
              <CartesianGrid stroke="#1c2230" horizontal={false} />
              <XAxis type="number" tick={axis} axisLine={false} tickLine={false} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <YAxis type="category" dataKey="muscle" tick={{ ...axis, fontFamily: "Inter" }} axisLine={false} tickLine={false} width={80} />
              <Tooltip
                contentStyle={{ background: "#171C28", border: "1px solid #232a38", borderRadius: 8, fontFamily: "JetBrains Mono", fontSize: 12 }}
                cursor={{ fill: "#ffffff08" }}
              />
              <Bar dataKey="volume_kg" name="Volume kg" radius={[0, 4, 4, 0]} maxBarSize={20}>
                {s.by_muscle.map((_, i) => <Cell key={i} fill={MUSCLE_COLORS[i % MUSCLE_COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <Panel accent={COLORS.strength} title="Top exercises" sub="by volume · 8 weeks">
        <div className="space-y-2">
          {s.top_exercises.map((t, i) => {
            const max = s.top_exercises[0]?.volume || 1;
            return (
              <div key={t.exercise} className="flex items-center gap-3">
                <div className="w-40 shrink-0 truncate text-sm text-txt">{t.exercise}</div>
                <div className="relative h-6 flex-1 overflow-hidden rounded-md bg-panel2">
                  <div className="h-full rounded-md" style={{ width: `${(t.volume / max) * 100}%`, background: `${MUSCLE_COLORS[i % MUSCLE_COLORS.length]}cc` }} />
                </div>
                <div className="w-28 shrink-0 text-right font-mono text-xs text-muted tnum">
                  {fmtNum(t.volume)}kg · {t.sets}s
                </div>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel accent={COLORS.strength} title="Workout history" sub={`${wkos.length} total · click a row for the full breakdown`}>
        <div className="max-h-[480px] overflow-y-auto overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-panel">
              <tr className="border-b border-line text-[10.5px] uppercase tracking-wider text-faint">
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 font-medium">Workout</th>
                <th className="py-2 pr-3 text-right font-medium">Volume</th>
                <th className="py-2 pr-3 text-right font-medium">Sets</th>
                <th className="py-2 text-right font-medium">Duration</th>
              </tr>
            </thead>
            <tbody className="font-mono tnum text-[13px]">
              {wkos.map((w) => (
                <tr key={w.id} onClick={() => setOpenId(w.id)}
                  className="cursor-pointer border-b border-line/50 hover:bg-panel2/40">
                  <td className="py-2 pr-3 text-muted">{fmtDate(w.date)}</td>
                  <td className="py-2 pr-3 font-body text-txt">{w.title || "Workout"}</td>
                  <td className="py-2 pr-3 text-right text-strength">{fmtNum(w.volume_kg)}kg</td>
                  <td className="py-2 pr-3 text-right text-muted">{w.set_count}</td>
                  <td className="py-2 text-right text-muted">{fmtDuration(w.duration_min * 60)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <WorkoutDetail id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
