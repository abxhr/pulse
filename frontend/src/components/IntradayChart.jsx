import { useEffect, useState } from "react";
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { api } from "../lib/api";
import { COLORS, axisLabelStyle } from "../lib/format";
import { Panel, Loading } from "./primitives";
import { ChartLegend, useSeriesToggle } from "./ChartLegend";

const axis = { stroke: "var(--color-faint)", fontSize: 11, fontFamily: "JetBrains Mono" };

function hourTick(h) {
  const period = h >= 12 ? "PM" : "AM";
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}${period}`;
}

function Tip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-panel2 px-3 py-2 shadow-panel">
      <div className="mb-1 font-mono text-[11px] text-muted">{hourTick(label)}</div>
      {payload.map((p) => (
        p.value != null && (
          <div key={p.dataKey} className="flex items-center gap-2 text-xs">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
            <span className="text-txt font-mono tnum">{Math.round(p.value)}</span>
            <span className="text-faint">{p.name}</span>
          </div>
        )
      ))}
    </div>
  );
}

const DAY_OPTIONS = Array.from({ length: 7 }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - i);
  return d.toISOString().slice(0, 10);
});

export default function IntradayChart() {
  const [day, setDay] = useState(DAY_OPTIONS[0]);
  const [data, setData] = useState(null);
  const toggle = useSeriesToggle();

  useEffect(() => {
    setData(null);
    api.intraday(day).then(setData).catch(() => setData(false));
  }, [day]);

  return (
    <Panel accent={COLORS.strength} title="Stress & body battery" sub="hourly · stored locally after sync">
      <div className="mb-2 flex flex-wrap gap-1.5">
        {DAY_OPTIONS.map((d, i) => (
          <button key={d} onClick={() => setDay(d)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
              day === d ? "bg-strength text-ink" : "bg-panel2 text-muted"
            }`}>
            {i === 0 ? "Today" : new Date(d).toLocaleDateString(undefined, { weekday: "short" })}
          </button>
        ))}
      </div>

      {data === null && <Loading label="Loading intraday data…" />}
      {data === false && <p className="py-6 text-center text-xs text-faint">No intraday data for this day.</p>}
      {data && (
        <>
          {data.cached && <p className="mb-2 text-[10px] text-faint">Cached Garmin reading · updated {data.updated_at ? new Date(data.updated_at).toLocaleString() : "during sync"}</p>}
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={data.hourly} margin={{ left: -8, right: 8, top: 6 }}>
              <defs>
                <linearGradient id="bb" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.sleep} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={COLORS.sleep} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--color-line)" vertical={false} />
              <XAxis dataKey="hour" tick={axis} tickFormatter={hourTick} interval={2} axisLine={false} tickLine={false} />
              <YAxis yAxisId="l" tick={axis} axisLine={false} tickLine={false} width={30} domain={[0, 100]}
                label={{ value: "stress", angle: -90, position: "insideLeft", style: axisLabelStyle }} />
              <YAxis yAxisId="r" orientation="right" tick={axis} axisLine={false} tickLine={false} width={34} domain={[0, 100]}
                label={{ value: "battery", angle: 90, position: "insideRight", style: axisLabelStyle }} />
              <Tooltip content={<Tip />} />
              <Area yAxisId="r" type="monotone" dataKey="avg_battery" name="Body battery" stroke={COLORS.sleep} strokeWidth={2} fill="url(#bb)"
                hide={toggle.hidden.has("avg_battery")} connectNulls />
              <Line yAxisId="l" type="monotone" dataKey="avg_stress" name="Stress" stroke={COLORS.strength} strokeWidth={2} dot={false}
                hide={toggle.hidden.has("avg_stress")} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
          <ChartLegend series={[
            { key: "avg_stress", name: "Stress", color: COLORS.strength },
            { key: "avg_battery", name: "Body battery", color: COLORS.sleep },
          ]} {...toggle} />
          <div className="mt-1 flex justify-center gap-4 font-mono text-[11px] text-faint">
            <span>avg stress {data.avg_stress ?? "-"}</span>
            <span>max stress {data.max_stress ?? "-"}</span>
          </div>
        </>
      )}
    </Panel>
  );
}
