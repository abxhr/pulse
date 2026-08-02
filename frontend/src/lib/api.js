const BASE = "/api";

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json();
}

export const api = {
  status: () => req("/status"),
  dashboard: () => req("/dashboard"),
  healthTrend: (days = 30) => req(`/health/trend?days=${days}`),
  sleepTrend: (days = 30) => req(`/sleep/trend?days=${days}`),
  activities: (limit = 20) => req(`/activities?limit=${limit}`),
  activityDetail: (id) => req(`/activities/${id}`),
  workouts: (limit = 20) => req(`/workouts?limit=${limit}`),
  workoutDetail: (id) => req(`/workouts/${id}`),
  strength: (weeks = 8) => req(`/strength?weeks=${weeks}`),
  strengthThisWeek: () => req("/strength/this-week"),
  trainingLoad: (weeks = 12) => req(`/training-load?weeks=${weeks}`),
  syncAll: (days) => req(`/sync/all${days ? `?days=${days}` : ""}`, { method: "POST" }),
  syncGarmin: (days) => req(`/sync/garmin${days ? `?days=${days}` : ""}`, { method: "POST" }),
  syncHevy: () => req("/sync/hevy", { method: "POST" }),
  uploadHevyCsv: async (file) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/sync/hevy/upload", { method: "POST", body: fd });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return res.json();
  },
  nutritionToday: () => req("/nutrition/today"),
  nutritionDay: (d) => req(`/nutrition/day?d=${d}`),
  nutritionTrend: (days = 14) => req(`/nutrition/trend?days=${days}`),
  addMeal: (payload) => req("/nutrition/meals", { method: "POST", body: JSON.stringify(payload) }),
  analyzeMeal: async (file, notes, provider) => {
    const fd = new FormData();
    if (file) fd.append("image", file);
    if (notes) fd.append("notes", notes);
    if (provider) fd.append("provider", provider);
    const res = await fetch("/api/nutrition/analyze", { method: "POST", body: fd });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return res.json();
  },
  deleteMeal: (id) => req(`/nutrition/meals/${id}`, { method: "DELETE" }),
  nutritionGoal: () => req("/nutrition/goal"),
  setNutritionGoal: (payload) => req("/nutrition/goal", { method: "PUT", body: JSON.stringify(payload) }),
  insight: (payload) => req("/insights", { method: "POST", body: JSON.stringify(payload) }),
  insightHistory: () => req("/insights/history"),
  weeklyReport: (weeks = 1, withAi = true) =>
    req(`/reports/weekly?weeks=${weeks}&with_ai=${withAi}`, { method: "POST" }),
};
