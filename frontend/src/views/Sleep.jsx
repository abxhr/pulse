import { useEffect, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { api } from "../lib/api";
import { COLORS, fmtDate, fmtNum } from "../lib/format";
import { Panel, StatTile, Loading, Empty } from "../components/primitives";

const axis = { stroke: "#5b6479", fontSize: 11, fontFamily: "JetBrains Mono" };
const STAGES = [
  { key: "deep_h", name: "Deep", color: "#4c51bf" },
  { key: "rem_h", name: "REM", color: "#7C83FF" },
  { key: "light_h", name: "Light", color: "#a3a8ff" },
  { key: "awake_h", name: "Awake", color: "#2a3242" },
];

function Tip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-panel2 px-3 py-2 shadow-panel">
      <div className="mb-1 font-mono text-[11px] text-muted">{fmtDate(label)}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-xs">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-txt font-mono tnum">{fmtNum(p.value, 1)}</span>
          <span className="text-faint">{p.name}</span>
        </div>
      ))}
    </div>
  );
}

export default function Sleep() {
  const [data, setData] = useState(null);
  useEffect(() => { api.sleepTrend(30).then(setData).catch(() => setData([])); }, []);
  if (!data) return <Loading label="Reading sleep archive…" />;
  if (!data.length) return <Empty title="No sleep data yet" body="Sync Garmin to import your sleep history." />;

  const recent = data.slice(-14);
  const avg = (k) => {
    const v = data.map((r) => r[k]).filter((x) => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Avg score" value={fmtNum(avg("score"))} color={COLORS.sleep} />
        <StatTile label="Avg duration" value={fmtNum(avg("total_h"), 1)} unit="h" color={COLORS.sleep} />
        <StatTile label="Avg deep" value={fmtNum(avg("deep_h"), 1)} unit="h" color="#4c51bf" />
        <StatTile label="Avg REM" value={fmtNum(avg("rem_h"), 1)} unit="h" color="#7C83FF" />
      </div>

      <Panel accent={COLORS.sleep} title="Sleep stages" sub="stacked hours · last 14 nights">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={recent} margin={{ left: -18, right: 8, top: 6 }}>
            <CartesianGrid stroke="#1c2230" vertical={false} />
            <XAxis dataKey="date" tick={axis} tickFormatter={fmtDate} minTickGap={20} axisLine={false} tickLine={false} />
            <YAxis tick={axis} axisLine={false} tickLine={false} width={34} />
            <Tooltip content={<Tip />} cursor={{ fill: "#ffffff08" }} />
            {STAGES.map((st) => (
              <Bar key={st.key} dataKey={st.key} name={st.name} stackId="s" fill={st.color} maxBarSize={26}
                radius={st.key === "deep_h" ? [0, 0, 0, 0] : [0, 0, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
        <div className="mt-2 flex flex-wrap gap-3">
          {STAGES.map((st) => (
            <span key={st.key} className="flex items-center gap-1.5 text-[11px] text-muted">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: st.color }} />{st.name}
            </span>
          ))}
        </div>
      </Panel>

      <Panel accent={COLORS.recovery} title="Sleep score vs overnight HRV" sub="30 days">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ left: -18, right: 8, top: 6 }}>
            <CartesianGrid stroke="#1c2230" vertical={false} />
            <XAxis dataKey="date" tick={axis} tickFormatter={fmtDate} minTickGap={28} axisLine={false} tickLine={false} />
            <YAxis yAxisId="l" tick={axis} axisLine={false} tickLine={false} width={34} domain={[0, 100]} />
            <YAxis yAxisId="r" orientation="right" tick={axis} axisLine={false} tickLine={false} width={34} />
            <Tooltip content={<Tip />} />
            <Line yAxisId="l" type="monotone" dataKey="score" name="Score" stroke={COLORS.sleep} strokeWidth={2} dot={false} />
            <Line yAxisId="r" type="monotone" dataKey="hrv" name="HRV" stroke={COLORS.recovery} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </Panel>
    </div>
  );
}
