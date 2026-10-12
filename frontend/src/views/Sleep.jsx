import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Sparkles, Moon, AlertCircle, BedDouble } from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, ScatterChart, Scatter,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { api } from "../lib/api";
import { SleepNeed } from "../components/PerformanceTrio";
import { COLORS, fmtDate, fmtNum, axisLabelStyle } from "../lib/format";
import { Panel, StatTile, Loading, Empty } from "../components/primitives";
import { ChartLegend, useSeriesToggle } from "../components/ChartLegend";

const axis = { stroke: "var(--color-faint)", fontSize: 12, fontFamily: "Instrument Sans" };
const STAGES = [
  { key: "deep_h", name: "Deep", color: "#4c51bf" },
  { key: "rem_h", name: "REM", color: "#7C83FF" },
  { key: "light_h", name: "Light", color: "#a3a8ff" },
  { key: "awake_h", name: "Awake", color: "#2a3242" },
];

function Tip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-ink px-3 py-2 shadow-lg">
      <div className="mb-1 font-mono text-xs text-muted">{fmtDate(label)}</div>
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

function hourLabel(h) {
  if (h == null) return "-";
  const wrapped = h % 24;
  const hh = Math.floor(wrapped);
  const mm = Math.round((wrapped - hh) * 60);
  const period = hh >= 12 && hh < 24 ? "PM" : "AM";
  let h12 = hh % 12;
  if (h12 === 0) h12 = 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${period}`;
}

// Clean "6 PM" tick for the axis - no minutes clutter.
function hourLabelShort(h) {
  if (h == null) return "";
  const wrapped = Math.round(h) % 24;
  const period = wrapped >= 12 && wrapped < 24 ? "PM" : "AM";
  let h12 = wrapped % 12;
  if (h12 === 0) h12 = 12;
  return `${h12} ${period}`;
}
const CONSISTENCY_TICKS = [18, 20, 22, 24, 26, 28, 30, 32]; // 6PM .. 8AM, 2h apart

function ConsistencyTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div className="rounded-lg border border-line bg-ink px-3 py-2 shadow-lg">
      <div className="mb-1 font-mono text-xs text-muted">{fmtDate(p.date)}</div>
      <div className="text-xs text-sleep">Bed {hourLabel(p.bedtime_hour)}</div>
      <div className="text-xs text-recovery">Wake {hourLabel(p.wake_hour)}</div>
    </div>
  );
}

function SleepCoach() {
  const [content, setContent] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function ask() {
    setBusy(true);
    setErr(null);
    try {
      const res = await api.insight({
        scope: "sleep",
        question: "Act as my sleep coach. Focus specifically on my sleep: stage balance " +
          "(deep/REM/light/awake), bedtime and wake-time consistency, overnight HRV and resting HR, " +
          "SpO2 and respiration if notable, and how sleep is tracking against readiness. Call out the " +
          "single biggest lever I could pull to sleep better, and 2-3 concrete, specific actions.",
      });
      setContent(res.content);
    } catch (e) {
      setErr(String(e).includes("not set")
        ? "Add an AI key in .env (ANTHROPIC_API_KEY or OPENAI_API_KEY) and restart the server."
        : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel accent={COLORS.sleep} title="Sleep coach" sub="AI analysis of your sleep patterns">
      {!content && !busy && (
        <button onClick={ask}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-panel2 px-4 py-3.5 text-sm font-medium text-muted transition hover:border-sleep/40 hover:text-sleep">
          <Sparkles size={16} /> Analyze my sleep
        </button>
      )}
      {busy && (
        <div className="flex items-center gap-2 px-1 py-3">
          <span className="h-2 w-2 animate-pulse rounded-full bg-sleep" />
          <span className="font-mono text-xs text-muted">reading your sleep data…</span>
        </div>
      )}
      {err && <p className="text-xs text-effort">{err}</p>}
      {content && (
        <>
          <div className="md text-sm"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div>
          <button onClick={ask} className="mt-3 text-xs text-faint hover:text-txt">Re-analyze</button>
        </>
      )}
    </Panel>
  );
}

function ChronotypeCard({ data }) {
  if (!data) return null;
  return (
    <Panel accent={COLORS.sleep} title="Chronotype" sub="from your actual bedtime pattern">
      <div className="flex items-center gap-3">
        <Moon size={22} className="text-sleep" />
        <div>
          <div className="font-display text-sm font-semibold text-txt">{data.label}</div>
          <p className="mt-0.5 text-xs text-faint">{data.description}</p>
        </div>
      </div>
    </Panel>
  );
}

function BedtimeRecCard({ data }) {
  if (!data) return null;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-sleep/30 bg-sleep/10 px-4 py-3">
      <BedDouble size={18} className="text-sleep shrink-0" />
      <p className="text-xs text-txt">
        <span className="font-medium">Aim for bed by {data.suggested_bedtime} tonight</span> - about
        {" "}{data.extra_minutes} min earlier than your recent average. Repeating that for roughly
        {" "}{data.half_debt_nights} nights would close half of your estimated {fmtNum(data.debt_hours, 1)}h opportunity gap.
      </p>
    </div>
  );
}

function WhyBadNightCard({ data }) {
  if (!data) return null;
  return (
    <Panel accent={COLORS.effort} title="Why was last night off?" sub={`${fmtDate(data.date)}, score ${data.score} vs baseline ${data.baseline_mean}`}>
      <ul className="space-y-1.5">
        {data.reasons.map((r, i) => (
          <li key={i} className="flex items-start gap-2 text-xs text-muted">
            <AlertCircle size={13} className="mt-0.5 shrink-0 text-effort" /> {r}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function CorrelationCard({ data }) {
  if (!data || data.n_nights < 5) return null;
  const rows = [
    { label: "→ Next-day readiness", v: data.readiness_corr },
    { label: "→ Next-day lift volume", v: data.strength_volume_corr },
    { label: "→ Next-day run pace", v: data.run_pace_corr },
  ].filter((r) => r.v != null);
  if (!rows.length) return null;
  const strength = (v) => Math.abs(v) >= 0.5 ? "strong" : Math.abs(v) >= 0.3 ? "moderate" : "weak";
  return (
    <Panel accent={COLORS.recovery} title="Sleep score → next-day performance" sub={`correlation, ${data.n_nights} nights`}>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between">
            <span className="text-xs text-muted">{r.label}</span>
            <span className="font-mono text-xs tnum" style={{ color: r.v > 0 ? COLORS.recovery : COLORS.effort }}>
              {r.v > 0 ? "+" : ""}{r.v} <span className="text-faint">({strength(r.v)})</span>
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export default function Sleep() {
  const [data, setData] = useState(null);
  const [consistency, setConsistency] = useState(null);
  const [extra, setExtra] = useState(null);
  const stagesToggle = useSeriesToggle();
  const scoreHrvToggle = useSeriesToggle();
  const hrSpo2Toggle = useSeriesToggle();
  useEffect(() => {
    api.sleepTrend(30).then(setData).catch(() => setData([]));
    api.sleepConsistency(30).then(setConsistency).catch(() => setConsistency(null));
    api.sleepExtra().then(setExtra).catch(() => {});
  }, []);
  if (!data) return <Loading label="Reading sleep archive…" />;
  if (!data.length) return <Empty title="No sleep data yet" body="Sync Garmin to import your sleep history." />;

  const recent = data.slice(-14);
  const avg = (k) => {
    const v = data.map((r) => r[k]).filter((x) => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const totalNaps = data.reduce((s, r) => s + (r.nap_h || 0), 0);

  return (
    <div className="space-y-4">
      {extra?.bedtime_recommendation && <BedtimeRecCard data={extra.bedtime_recommendation} />}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Avg score" value={fmtNum(avg("score"))} color={COLORS.sleep} />
        <StatTile label="Avg duration" value={fmtNum(avg("total_h"), 1)} unit="h" color={COLORS.sleep} />
        <StatTile label="Avg deep" value={fmtNum(avg("deep_h"), 1)} unit="h" color="#4c51bf" />
        <StatTile label="Avg REM" value={fmtNum(avg("rem_h"), 1)} unit="h" color="#7C83FF" />
        <StatTile label="Overnight HR" value={fmtNum(avg("avg_hr"))} unit="bpm" color={COLORS.effort} />
        <StatTile label="Avg SpO2" value={fmtNum(avg("avg_spo2"))} unit="%" color={COLORS.cardio} />
        <StatTile label="Respiration" value={fmtNum(avg("avg_respiration"), 1)} unit="br/min" color={COLORS.recovery} />
        <StatTile label="Awakenings" value={fmtNum(avg("awake_count"), 1)} color={COLORS.muted} />
        {totalNaps > 0 && (
          <StatTile label="Naps (30d)" value={fmtNum(totalNaps, 1)} unit="h" color={COLORS.sleep}
            hint={`${data.filter((r) => r.nap_h > 0).length} days napped`} />
        )}
      </div>

      {extra?.why_last_night_bad && <WhyBadNightCard data={extra.why_last_night_bad} />}

      {(extra?.chronotype || extra?.correlation) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChronotypeCard data={extra.chronotype} />
          <CorrelationCard data={extra.correlation} />
        </div>
      )}

      {consistency && (consistency.bedtime_variability_h != null || consistency.wake_variability_h != null) && (
        <Panel accent={COLORS.sleep} title="Sleep consistency" sub="bedtime & wake time, last 30 nights">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Avg bedtime" value={hourLabel(consistency.avg_bedtime_hour)} color={COLORS.sleep} />
            <StatTile label="Avg wake" value={hourLabel(consistency.avg_wake_hour)} color={COLORS.recovery} />
            <StatTile label="Bedtime swing" value={fmtNum(consistency.bedtime_variability_h, 1)} unit="h stdev"
              color={consistency.bedtime_variability_h > 1.2 ? COLORS.effort : COLORS.recovery}
              hint={consistency.bedtime_variability_h > 1.2 ? "inconsistent" : "steady"} />
            <StatTile label="Wake swing" value={fmtNum(consistency.wake_variability_h, 1)} unit="h stdev"
              color={consistency.wake_variability_h > 1.2 ? COLORS.effort : COLORS.recovery}
              hint={consistency.wake_variability_h > 1.2 ? "inconsistent" : "steady"} />
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <ScatterChart margin={{ left: -8, right: 8, top: 10 }}>
              <CartesianGrid stroke="var(--color-line)" vertical={false} />
              <XAxis dataKey="date" type="category" tick={axis} tickFormatter={fmtDate} minTickGap={28} axisLine={false} tickLine={false}
                allowDuplicatedCategory={false} />
              <YAxis dataKey="bedtime_hour" type="number" domain={[18, 32]} ticks={CONSISTENCY_TICKS}
                tick={axis} axisLine={false} tickLine={false} width={52}
                tickFormatter={hourLabelShort} />
              <Tooltip content={<ConsistencyTip />} />
              <Scatter data={consistency.nights_data} dataKey="bedtime_hour" fill={COLORS.sleep} />
            </ScatterChart>
          </ResponsiveContainer>
          <div className="mt-1 flex items-center gap-4 text-xs text-muted">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sleep" />bedtime</span>
          </div>
        </Panel>
      )}

      <SleepNeed />

      <Panel accent={COLORS.sleep} title="Sleep stages" sub={`stacked hours, last 14 nights, avg ${fmtNum(avg("total_h"), 1)}h/night`}>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={recent} margin={{ left: -8, right: 8, top: 6 }}>
            <CartesianGrid stroke="var(--color-line)" vertical={false} />
            <XAxis dataKey="date" tick={axis} tickFormatter={fmtDate} minTickGap={20} axisLine={false} tickLine={false} />
            <YAxis tick={axis} axisLine={false} tickLine={false} width={44}
              label={{ value: "hours", angle: -90, position: "insideLeft", style: axisLabelStyle }} />
            <Tooltip content={<Tip />} cursor={{ fill: "#ffffff08" }} />
            {STAGES.map((st) => (
              <Bar key={st.key} dataKey={st.key} name={st.name} stackId="s" fill={st.color} maxBarSize={26}
                hide={stagesToggle.hidden.has(st.key)} />
            ))}
          </BarChart>
        </ResponsiveContainer>
        <ChartLegend series={STAGES.map((s) => ({ key: s.key, name: s.name, color: s.color }))} {...stagesToggle} />
      </Panel>

      <Panel accent={COLORS.recovery} title="Sleep score vs overnight HRV" sub="30 days">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ left: -8, right: 8, top: 6 }}>
            <CartesianGrid stroke="var(--color-line)" vertical={false} />
            <XAxis dataKey="date" tick={axis} tickFormatter={fmtDate} minTickGap={28} axisLine={false} tickLine={false} />
            <YAxis yAxisId="l" tick={axis} axisLine={false} tickLine={false} width={40} domain={[0, 100]}
              label={{ value: "score", angle: -90, position: "insideLeft", style: axisLabelStyle }} />
            <YAxis yAxisId="r" orientation="right" tick={axis} axisLine={false} tickLine={false} width={40}
              label={{ value: "ms", angle: 90, position: "insideRight", style: axisLabelStyle }} />
            <Tooltip content={<Tip />} />
            <Line yAxisId="l" type="monotone" dataKey="score" name="Score" stroke={COLORS.sleep} strokeWidth={2} dot={false}
              hide={scoreHrvToggle.hidden.has("score")} />
            <Line yAxisId="r" type="monotone" dataKey="hrv" name="HRV" stroke={COLORS.recovery} strokeWidth={2} dot={false}
              hide={scoreHrvToggle.hidden.has("hrv")} />
          </LineChart>
        </ResponsiveContainer>
        <ChartLegend series={[
          { key: "score", name: "Score", color: COLORS.sleep },
          { key: "hrv", name: "HRV", color: COLORS.recovery },
        ]} {...scoreHrvToggle} />
      </Panel>

      <Panel accent={COLORS.cardio} title="Overnight HR & SpO2" sub="30 days">
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data} margin={{ left: -8, right: 8, top: 6 }}>
            <CartesianGrid stroke="var(--color-line)" vertical={false} />
            <XAxis dataKey="date" tick={axis} tickFormatter={fmtDate} minTickGap={28} axisLine={false} tickLine={false} />
            <YAxis yAxisId="l" tick={axis} axisLine={false} tickLine={false} width={36}
              label={{ value: "bpm", angle: -90, position: "insideLeft", style: axisLabelStyle }} />
            <YAxis yAxisId="r" orientation="right" tick={axis} axisLine={false} tickLine={false} width={36} domain={[85, 100]}
              label={{ value: "%", angle: 90, position: "insideRight", style: axisLabelStyle }} />
            <Tooltip content={<Tip />} />
            <Line yAxisId="l" type="monotone" dataKey="avg_hr" name="Overnight HR" stroke={COLORS.effort} strokeWidth={2} dot={false}
              hide={hrSpo2Toggle.hidden.has("avg_hr")} />
            <Line yAxisId="r" type="monotone" dataKey="avg_spo2" name="SpO2" stroke={COLORS.cardio} strokeWidth={2} dot={false}
              hide={hrSpo2Toggle.hidden.has("avg_spo2")} />
          </LineChart>
        </ResponsiveContainer>
        <ChartLegend series={[
          { key: "avg_hr", name: "Overnight HR", color: COLORS.effort },
          { key: "avg_spo2", name: "SpO2", color: COLORS.cardio },
        ]} {...hrSpo2Toggle} />
      </Panel>

      <SleepCoach />
    </div>
  );
}
