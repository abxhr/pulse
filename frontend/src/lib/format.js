export const fmtDuration = (sec) => {
  if (!sec && sec !== 0) return "-";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
};

export const fmtHours = (sec) => (sec ? (sec / 3600).toFixed(1) + "h" : "-");

export const fmtPace = (secPerKm) => {
  if (!secPerKm) return "-";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
};

export const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "-";

export const fmtNum = (n, d = 0) =>
  n === null || n === undefined ? "-" : Number(n).toLocaleString(undefined, { maximumFractionDigits: d });

// activity type -> {label, color, icon-key}
export const activityMeta = (type = "") => {
  const t = type.toLowerCase();
  if (t.includes("run")) return { label: "Run", color: "cardio" };
  if (t.includes("cycl") || t.includes("bik")) return { label: "Ride", color: "recovery" };
  if (t.includes("swim")) return { label: "Swim", color: "sleep" };
  if (t.includes("strength") || t.includes("training")) return { label: "Strength", color: "strength" };
  if (t.includes("walk") || t.includes("hik")) return { label: "Walk", color: "muted" };
  if (t.includes("row") || t.includes("kayak")) return { label: "Paddle", color: "recovery" };
  if (t.includes("soccer") || t.includes("football")) return { label: "Sport", color: "effort" };
  return { label: type || "Activity", color: "muted" };
};

// Shared style for Recharts <YAxis label={{...}}> / <XAxis label={{...}}> titles.
export const axisLabelStyle = { fill: "var(--color-faint)", fontSize: 10, fontFamily: "Instrument Sans", textAnchor: "middle" };

// Theme-aware: each resolves to the dark-mode tone or the darker light-mode tone (see index.css).
// Because they are CSS variables, never append hex alpha digits; use mix(color, percent) instead.
export const COLORS = {
  recovery: "rgb(var(--c-recovery))",
  effort: "rgb(var(--c-effort))",
  sleep: "rgb(var(--c-sleep))",
  cardio: "rgb(var(--c-cardio))",
  strength: "rgb(var(--c-strength))",
  nutrition: "rgb(var(--c-nutrition))",
  muted: "var(--color-muted)",
};

export const ZONE_COLORS = [COLORS.muted, COLORS.recovery, COLORS.strength, COLORS.effort, COLORS.sleep];

/** `color` at `percent`% opacity over the page, for tinted backgrounds and borders. */
export const mix = (color, percent) => `color-mix(in srgb, ${color} ${percent}%, transparent)`;
