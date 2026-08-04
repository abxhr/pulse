import { TrendingUp, TrendingDown, AlertTriangle, Moon, Gauge, CloudSun, CloudRain, CloudFog, Cloud, Sun, CloudSnow, CloudLightning } from "lucide-react";
import { COLORS, fmtNum } from "../lib/format";
import { Panel, StatTile } from "./primitives";

export function WhatChangedBanner({ data }) {
  if (!data) return null;
  const Icon = data.direction === "up" ? TrendingUp : TrendingDown;
  const color = data.good ? COLORS.recovery : COLORS.effort;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-panel2/60 px-4 py-3">
      <Icon size={16} style={{ color }} />
      <p className="text-xs text-muted">
        <span className="font-medium text-txt">What changed —</span> {data.summary}
      </p>
    </div>
  );
}

export function AnomalyAlerts({ alerts }) {
  if (!alerts?.length) return null;
  return (
    <div className="space-y-2">
      {alerts.map((a) => (
        <div key={a.metric} className="flex items-center gap-3 rounded-xl border border-effort/30 bg-effort/10 px-4 py-3">
          <AlertTriangle size={16} className="text-effort shrink-0" />
          <p className="text-xs text-txt">
            <span className="font-medium">{a.label} looks off —</span> {fmtNum(a.value, 1)} is {a.direction} vs. your
            {" "}{fmtNum(a.baseline_mean, 1)} baseline ({a.z_score > 0 ? "+" : ""}{a.z_score} SD, 30d)
          </p>
        </div>
      ))}
    </div>
  );
}

export function SleepDebtCard({ data }) {
  if (!data || !data.nights_tracked) return null;
  const behind = data.debt_hours > 0;
  return (
    <Panel accent={COLORS.sleep} title="Sleep debt" sub={`vs ${fmtNum(data.target_hours, 1)}h target · last ${data.nights_tracked} nights`}>
      <div className="grid grid-cols-2 gap-3">
        <StatTile label={behind ? "Behind by" : "Ahead by"} value={fmtNum(Math.abs(data.debt_hours), 1)} unit="h"
          color={behind ? COLORS.effort : COLORS.recovery} />
        <StatTile label="Avg / night" value={fmtNum(data.avg_hours, 1)} unit="h" color={COLORS.sleep} />
      </div>
      {behind && data.debt_hours > 5 && (
        <p className="mt-2 text-[11px] text-faint">That's over a full night's sleep of accumulated deficit — consider an earlier bedtime this week.</p>
      )}
    </Panel>
  );
}

export function LoadRatioCard({ data }) {
  if (!data) return null;
  const zoneMeta = {
    undertraining: { label: "Undertraining", color: COLORS.muted },
    sweet_spot: { label: "Sweet spot", color: COLORS.recovery },
    caution: { label: "Caution", color: COLORS.strength },
    high_risk: { label: "High injury risk", color: COLORS.effort },
  }[data.zone];
  return (
    <Panel accent={zoneMeta.color} title="Acute : chronic load" sub="7-day load ÷ 28-day weekly avg">
      <div className="flex items-center gap-4">
        <Gauge size={28} style={{ color: zoneMeta.color }} />
        <div>
          <div className="font-mono text-2xl font-semibold tnum" style={{ color: zoneMeta.color }}>{data.ratio}</div>
          <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: zoneMeta.color }}>{zoneMeta.label}</div>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-faint">
        {data.zone === "high_risk" && "Recent load has spiked well past what your body's adapted to — dial back intensity this week."}
        {data.zone === "caution" && "Ramping up quickly — fine short-term, but watch recovery markers closely."}
        {data.zone === "sweet_spot" && "Load is well-matched to your training base — good place to build from."}
        {data.zone === "undertraining" && "Well below your usual load — room to push if recovery allows."}
      </p>
    </Panel>
  );
}

const WEATHER_ICONS = {
  0: Sun, 1: Sun, 2: CloudSun, 3: Cloud,
  45: CloudFog, 48: CloudFog,
  51: CloudRain, 53: CloudRain, 55: CloudRain, 61: CloudRain, 63: CloudRain, 65: CloudRain,
  66: CloudRain, 67: CloudRain, 80: CloudRain, 81: CloudRain, 82: CloudRain,
  71: CloudSnow, 73: CloudSnow, 75: CloudSnow, 77: CloudSnow, 85: CloudSnow, 86: CloudSnow,
  95: CloudLightning, 96: CloudLightning, 99: CloudLightning,
};

export function WeatherChip({ data }) {
  if (!data) return null;
  const Icon = WEATHER_ICONS[data.code] || Cloud;
  return (
    <div className="flex items-center gap-2 rounded-full border border-line bg-panel2/60 px-3 py-1.5">
      <Icon size={15} className="text-faint" />
      <span className="font-mono text-xs text-txt tnum">{fmtNum(data.temperature_c, 0)}°C</span>
      <span className="text-[11px] text-faint">{data.condition}</span>
    </div>
  );
}
