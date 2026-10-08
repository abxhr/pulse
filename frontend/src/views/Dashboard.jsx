import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, BarChart, Bar, ComposedChart,
  XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from "recharts";
import { Activity, Moon, HeartPulse, Flame, Footprints, TrendingUp, Sparkles, RefreshCw, ChevronDown } from "lucide-react";
import { api } from "../lib/api";
import { COLORS, fmtDate, fmtPace, fmtNum, activityMeta, axisLabelStyle } from "../lib/format";
import { Panel, StatTile, Chip, Loading, Empty } from "../components/primitives";
import ReadinessRing from "../components/ReadinessRing";
import { ChartLegend, useSeriesToggle } from "../components/ChartLegend";
import IntradayChart from "../components/IntradayChart";
import { WhatChangedBanner, AnomalyAlerts, SleepDebtCard, LoadRatioCard, WeatherChip, OvertrainingRiskCard, CorrelationMiner } from "../components/OverviewExtras";
import LayoutSettings, { CustomizeButton } from "../components/LayoutSettings";
import { useDashboardLayout } from "../lib/useDashboardLayout";
import DataFreshness, { FreshnessBadge } from "../components/DataFreshness";
import CommandCenter from "../components/CommandCenter";

function DailyInsight() {
  const [insight, setInsight] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(false);

  const load = () => api.dailyInsight().then(setInsight).catch((e) => setErr(String(e)));
  useEffect(() => { load(); }, []);

  async function refresh() {
    setBusy(true);
    setErr(null);
    try {
      const res = await api.refreshDailyInsight();
      setInsight(res);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (err) {
    return (
      <Panel accent={COLORS.recovery} title="Today's briefing">
        <p className="text-xs text-faint">
          {err.includes("not set") ? "Add an AI key in .env and restart the server to enable daily briefings." : err}
        </p>
      </Panel>
    );
  }
  if (!insight) return null;

  return (
    <Panel accent={COLORS.recovery} title="Today's briefing"
      sub={open ? `auto-generated · ${new Date(insight.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : "tap to expand"}
      right={
        <div className="flex items-center gap-2">
          {open && (
            <button onClick={refresh} disabled={busy} title="Refresh"
              className="flex items-center gap-1.5 rounded-lg border border-line bg-panel2 px-2.5 py-1 text-[11px] text-muted transition hover:border-recovery/40 disabled:opacity-50">
              <RefreshCw size={12} className={busy ? "animate-spin" : ""} /> Refresh
            </button>
          )}
          <button onClick={() => setOpen((o) => !o)} className="text-faint hover:text-txt">
            <ChevronDown size={16} className={`transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        </div>
      }>
      {open && <div className="md text-sm"><ReactMarkdown remarkPlugins={[remarkGfm]}>{insight.content}</ReactMarkdown></div>}
    </Panel>
  );
}

const axis = { stroke: "var(--color-faint)", fontSize: 11, fontFamily: "JetBrains Mono" };

const fmtWeek = (w) => (w ? `Week ${w.split("-W")[1]}, ${w.split("-W")[0]}` : "-");

function ChartTip({ active, payload, label, unit = "", labelFormatter = fmtDate }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-panel2 px-3 py-2 shadow-panel">
      <div className="mb-1 font-mono text-[11px] text-muted">{labelFormatter(label)}</div>
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

const SECTIONS = [
  { id: "command_center", label: "Daily plan, goals & anomaly inbox" },
  { id: "briefing", label: "Today's briefing" },
  { id: "hero", label: "Readiness + Vitals" },
  { id: "insights", label: "Sleep debt, load ratio & alerts" },
  { id: "recovery_sleep", label: "Recovery & Sleep charts" },
  { id: "steps_intraday", label: "Steps & intraday" },
  { id: "readiness_trend", label: "Training readiness trend" },
  { id: "training_load", label: "Training load & recent sessions" },
];
const DEFAULT_ORDER = SECTIONS.map((s) => s.id);

export default function Dashboard() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [current, setCurrent] = useState(null);
  const [extra, setExtra] = useState(null);
  const [showLayout, setShowLayout] = useState(false);
  const [command, setCommand] = useState(null);

  const refreshCommand = () => api.commandCenter().then(setCommand).catch(() => {});

  useEffect(() => {
    api.dashboard().then(setD).catch((e) => setErr(String(e)));
    api.dashboardExtra().then(setExtra).catch(() => {});
    refreshCommand();
  }, []);

  useEffect(() => {
    const load = () => api.currentReading().then(setCurrent).catch(() => {});
    load();
    const t = setInterval(load, 2 * 60 * 1000); // stress/body battery are genuinely live - refresh every 2 min
    return () => clearInterval(t);
  }, []);

  const recoveryToggle = useSeriesToggle();
  const sleepToggle = useSeriesToggle();
  const loadToggle = useSeriesToggle();
  const layout = useDashboardLayout(DEFAULT_ORDER);

  if (err) return <Empty title="Couldn't load dashboard" body={err} />;
  if (!d) return <Loading />;

  const s = d.snapshot;
  const bb = s.body_battery_high;

  const sections = {
    command_center: <CommandCenter data={command} onRefresh={refreshCommand} />,
    briefing: <DailyInsight />,

    hero: (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[auto_1fr]">
        <Panel accent={COLORS.recovery} title={s.date === new Date().toISOString().slice(0,10) ? "Today" : "Latest available"} sub={s.date || "no data yet"}
          right={extra?.weather ? <WeatherChip data={extra.weather} /> : null}>
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

        <Panel accent={COLORS.effort} title="Vitals" sub="latest readings" right={<FreshnessBadge compact item={extra?.freshness?.sources?.garmin_health} />}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile label="Resting HR" value={s.resting_hr} unit="bpm" color={COLORS.effort} />
            <StatTile label="HRV" value={s.hrv_last_night} unit="ms" color={COLORS.recovery} />
            <StatTile label="Sleep score" value={s.sleep_score} color={COLORS.sleep}
              hint={s.sleep_seconds ? `${(s.sleep_seconds / 3600).toFixed(1)}h slept` : null} />
            <StatTile label="VO₂max" value={s.vo2max != null ? fmtNum(s.vo2max, 1) : "-"}
              color={COLORS.cardio} hint={s.vo2max_date && s.vo2max_date !== s.date ? `as of ${fmtDate(s.vo2max_date)}` : null} />
            <StatTile label={current?.stress != null ? "Stress now" : "Avg stress"} value={current?.stress ?? s.stress} color={COLORS.strength}
              hint={current?.stress != null ? `daily avg ${s.stress ?? "-"}` : `as of ${fmtDate(s.date)}`} />
            <StatTile label="Steps" value={fmtNum(s.steps)} color={COLORS.muted}
              hint={extra?.adaptive_step_goal
                ? `adaptive goal ${fmtNum(extra.adaptive_step_goal.target)}`
                : s.step_goal ? `goal ${fmtNum(s.step_goal)}` : null} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile label="Intensity min" value={s.intensity_minutes} color={COLORS.recovery} />
            <StatTile label={current?.body_battery != null ? "Body battery now" : "Body battery peak"} value={current?.body_battery ?? s.body_battery_high} color={COLORS.sleep}
              hint={current?.body_battery != null ? `daily peak ${s.body_battery_high ?? "-"}` : `as of ${fmtDate(s.date)}`} />
            <StatTile label="Readiness" value={s.training_readiness} color={COLORS.recovery}
              hint={s.training_readiness_label} />
          </div>
          {s.calories_total != null && (
            <div className="mt-3 grid grid-cols-3 gap-3">
              <StatTile label="Burned total" value={fmtNum(s.calories_total)} unit="kcal" color={COLORS.strength} />
              <StatTile label="Active" value={fmtNum(s.calories_active)} unit="kcal" color={COLORS.effort} />
              <StatTile label="Resting" value={fmtNum(s.calories_resting)} unit="kcal" color={COLORS.muted} />
            </div>
          )}
          {s.fitness_age != null && (
            <div className="mt-3 rounded-xl border border-line bg-panel2/60 px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-[10.5px] uppercase tracking-wider text-muted">Fitness age</span>
                <span className="font-mono text-xs text-faint tnum">chronological {s.chronological_age}</span>
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-mono text-2xl font-semibold text-recovery tnum">{fmtNum(s.fitness_age, 1)}</span>
                <span className="text-xs text-faint">
                  {s.fitness_age < s.chronological_age
                    ? `${fmtNum(s.chronological_age - s.fitness_age, 1)} years younger than your age`
                    : "keep training to bring this down"}
                </span>
              </div>
            </div>
          )}
        </Panel>
      </div>
    ),

    insights: extra ? (
      <div className="space-y-3">
        <DataFreshness data={extra.freshness} />
        <WhatChangedBanner data={extra.what_changed} />
        <AnomalyAlerts alerts={extra.anomalies} />
        <OvertrainingRiskCard data={extra.overtraining_risk} />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SleepDebtCard data={extra.sleep_debt} />
          <LoadRatioCard data={extra.training_load_ratio} />
        </div>
        <CorrelationMiner />
      </div>
    ) : null,

    recovery_sleep: (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel accent={COLORS.recovery} title="Recovery" sub="HRV vs resting HR · 30 days">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={d.health_trend} margin={{ left: -18, right: 8, top: 6 }}>
              <CartesianGrid stroke="var(--color-line)" vertical={false} />
              <XAxis dataKey="date" tick={axis} tickFormatter={fmtDate} minTickGap={28} axisLine={false} tickLine={false} />
              <YAxis yAxisId="l" tick={axis} axisLine={false} tickLine={false} width={36}
                label={{ value: "ms", angle: -90, position: "insideLeft", style: axisLabelStyle }} />
              <YAxis yAxisId="r" orientation="right" tick={axis} axisLine={false} tickLine={false} width={32}
                label={{ value: "bpm", angle: 90, position: "insideRight", style: axisLabelStyle }} />
              <Tooltip content={<ChartTip />} />
              <Line yAxisId="l" type="monotone" dataKey="hrv" name="HRV" stroke={COLORS.recovery} strokeWidth={2} dot={false}
                hide={recoveryToggle.hidden.has("hrv")} />
              <Line yAxisId="r" type="monotone" dataKey="resting_hr" name="Rest HR" stroke={COLORS.effort} strokeWidth={2} dot={false}
                hide={recoveryToggle.hidden.has("resting_hr")} />
            </LineChart>
          </ResponsiveContainer>
          <ChartLegend series={[
            { key: "hrv", name: "HRV", color: COLORS.recovery },
            { key: "resting_hr", name: "Rest HR", color: COLORS.effort },
          ]} {...recoveryToggle} />
        </Panel>

        <Panel accent={COLORS.sleep} title="Sleep" sub="hours + score · 30 days">
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={d.sleep_trend} margin={{ left: -18, right: 8, top: 6 }}>
              <defs>
                <linearGradient id="sl" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.sleep} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={COLORS.sleep} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--color-line)" vertical={false} />
              <XAxis dataKey="date" tick={axis} tickFormatter={fmtDate} minTickGap={28} axisLine={false} tickLine={false} />
              <YAxis yAxisId="l" tick={axis} axisLine={false} tickLine={false} width={30}
                label={{ value: "hours", angle: -90, position: "insideLeft", style: axisLabelStyle }} />
              <YAxis yAxisId="r" orientation="right" tick={axis} axisLine={false} tickLine={false} width={34} domain={[0, 100]}
                label={{ value: "score", angle: 90, position: "insideRight", style: axisLabelStyle }} />
              <Tooltip content={<ChartTip />} />
              <Area yAxisId="l" type="monotone" dataKey="total_h" name="Hours" stroke={COLORS.sleep} strokeWidth={2} fill="url(#sl)"
                hide={sleepToggle.hidden.has("total_h")} />
              <Line yAxisId="r" type="monotone" dataKey="score" name="Score" stroke={COLORS.recovery} strokeWidth={2} dot={false}
                hide={sleepToggle.hidden.has("score")} />
            </ComposedChart>
          </ResponsiveContainer>
          <ChartLegend series={[
            { key: "total_h", name: "Hours", color: COLORS.sleep },
            { key: "score", name: "Score", color: COLORS.recovery },
          ]} {...sleepToggle} />
        </Panel>
      </div>
    ),

    steps_intraday: (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel accent={COLORS.muted} title="Steps"
          sub={extra?.adaptive_step_goal ? `daily · 30 days · adaptive goal ${fmtNum(extra.adaptive_step_goal.target)}` : "daily · 30 days"}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={d.health_trend} margin={{ left: -18, right: 8, top: 6 }}>
              <CartesianGrid stroke="var(--color-line)" vertical={false} />
              <XAxis dataKey="date" tick={axis} tickFormatter={fmtDate} minTickGap={28} axisLine={false} tickLine={false} />
              <YAxis tick={axis} axisLine={false} tickLine={false} width={44} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                label={{ value: "steps", angle: -90, position: "insideLeft", style: axisLabelStyle }} />
              <Tooltip content={<ChartTip />} cursor={{ fill: "#ffffff08" }} />
              <Bar dataKey="steps" name="Steps" radius={[3, 3, 0, 0]} maxBarSize={16}>
                {d.health_trend.map((r, i) => (
                  <Cell key={i} fill={(r.steps || 0) >= (extra?.adaptive_step_goal?.target || 10000) ? COLORS.recovery : COLORS.muted} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="mt-2 text-center text-[11px] text-faint">
            <span className="mr-1 inline-block h-2 w-2 rounded-full align-middle" style={{ background: COLORS.recovery }} />
            {extra?.adaptive_step_goal ? `${fmtNum(extra.adaptive_step_goal.target)}+ adaptive goal met` : "10k+ goal met"}
          </p>
        </Panel>

        <IntradayChart />
      </div>
    ),

    readiness_trend: (
      <Panel accent={COLORS.recovery} title="Training readiness" sub="30 days">
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={d.health_trend} margin={{ left: -18, right: 8, top: 6 }}>
            <defs>
              <linearGradient id="rd" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={COLORS.recovery} stopOpacity={0.4} />
                <stop offset="100%" stopColor={COLORS.recovery} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--color-line)" vertical={false} />
            <XAxis dataKey="date" tick={axis} tickFormatter={fmtDate} minTickGap={28} axisLine={false} tickLine={false} />
            <YAxis tick={axis} axisLine={false} tickLine={false} width={30} domain={[0, 100]}
              label={{ value: "readiness", angle: -90, position: "insideLeft", style: axisLabelStyle }} />
            <Tooltip content={<ChartTip />} />
            <Area type="monotone" dataKey="readiness" name="Readiness" stroke={COLORS.recovery} strokeWidth={2} fill="url(#rd)" />
          </AreaChart>
        </ResponsiveContainer>
      </Panel>
    ),

    training_load: (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Panel accent={COLORS.cardio} title="Training load" sub="weekly run km + strength volume · 12 weeks">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={d.training_load} margin={{ left: -18, right: 8, top: 6 }}>
              <CartesianGrid stroke="var(--color-line)" vertical={false} />
              <XAxis dataKey="week" tick={axis} axisLine={false} tickLine={false}
                tickFormatter={(w) => w?.split("-W")[1]} />
              <YAxis yAxisId="l" tick={axis} axisLine={false} tickLine={false} width={38}
                label={{ value: "km", angle: -90, position: "insideLeft", style: axisLabelStyle }} />
              <YAxis yAxisId="r" orientation="right" tick={axis} axisLine={false} tickLine={false} width={44}
                label={{ value: "kg", angle: 90, position: "insideRight", style: axisLabelStyle }} />
              <Tooltip content={<ChartTip labelFormatter={fmtWeek} />} cursor={{ fill: "#ffffff08" }} />
              <Bar yAxisId="l" dataKey="run_km" name="Run km" fill={COLORS.cardio} radius={[3, 3, 0, 0]} maxBarSize={16}
                hide={loadToggle.hidden.has("run_km")} />
              <Bar yAxisId="r" dataKey="strength_volume" name="Volume kg" fill={COLORS.strength} radius={[3, 3, 0, 0]} maxBarSize={16} opacity={0.85}
                hide={loadToggle.hidden.has("strength_volume")} />
            </BarChart>
          </ResponsiveContainer>
          <ChartLegend series={[
            { key: "run_km", name: "Run km", color: COLORS.cardio },
            { key: "strength_volume", name: "Volume kg", color: COLORS.strength },
          ]} {...loadToggle} />
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
                      <div>{a.pace_per_km ? fmtPace(a.pace_per_km) : `HR ${a.avg_hr ?? "-"}`}</div>
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
    ),
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <CustomizeButton onClick={() => setShowLayout(true)} />
      </div>
      <LayoutSettings open={showLayout} onClose={() => setShowLayout(false)} sections={SECTIONS} layout={layout} />

      {layout.order.filter((id) => !layout.hidden.includes(id)).map((id) => (
        <div key={id}>{sections[id]}</div>
      ))}
    </div>
  );
}
