export const fmtDuration = (sec) => {
  if (!sec && sec !== 0) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
};

export const fmtHours = (sec) => (sec ? (sec / 3600).toFixed(1) + "h" : "—");

export const fmtPace = (secPerKm) => {
  if (!secPerKm) return "—";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}/km`;
};

export const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";

export const fmtNum = (n, d = 0) =>
  n === null || n === undefined ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: d });

// activity type -> {label, color, icon-key}
export const activityMeta = (type = "") => {
  const t = type.toLowerCase();
  if (t.includes("run")) return { label: "Run", color: "cardio" };
  if (t.includes("cycl") || t.includes("bik")) return { label: "Ride", color: "recovery" };
  if (t.includes("swim")) return { label: "Swim", color: "sleep" };
  if (t.includes("strength") || t.includes("training")) return { label: "Strength", color: "strength" };
  if (t.includes("walk") || t.includes("hik")) return { label: "Walk", color: "muted" };
  return { label: type || "Activity", color: "muted" };
};

export const COLORS = {
  recovery: "#3DD68C",
  effort: "#FF5C7A",
  sleep: "#7C83FF",
  cardio: "#38BDF8",
  strength: "#F5A623",
  nutrition: "#2DD4BF",
  muted: "#8A93A6",
};
