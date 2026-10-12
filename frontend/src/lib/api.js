const BASE = "/api";

export class ApiError extends Error {
  constructor(message, { status, code, details, requestId } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

async function responseError(res) {
  const payload = await res.json().catch(() => null);
  const error = payload?.error;
  return new ApiError(error?.message || `Request failed (${res.status})`, {
    status: res.status,
    code: error?.code,
    details: error?.details,
    requestId: error?.request_id || res.headers.get("x-request-id"),
  });
}

async function throwResponseError(res) {
  const error = await responseError(res);
  window.dispatchEvent(new CustomEvent("pulse:notice", { detail: { type: "error", message: error.message, requestId: error.requestId } }));
  throw error;
}

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event("pulse:unauthorized"));
    await throwResponseError(res);
  }
  return res.json();
}

export const api = {
  authStatus: () => req("/auth/status"),
  authSetup: (password) => req("/auth/setup", { method: "POST", body: JSON.stringify({ password }) }),
  authLogin: (password) => req("/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
  authReset: (password) => req("/auth/reset", { method: "POST", body: JSON.stringify({ password }) }),
  authLogout: () => req("/auth/logout", { method: "POST" }),
  status: () => req("/status"),
  dashboard: () => req("/dashboard"),
  dashboardExtra: () => req("/dashboard/extra"),
  commandCenter: () => req("/command-center"),
  goals: () => req("/goals"),
  setGoals: (items) => req("/goals", { method: "PUT", body: JSON.stringify(items) }),
  checkinsToday: () => req("/check-ins/today"),
  addCheckin: (body) => req("/check-ins", { method: "POST", body: JSON.stringify(body) }),
  anomalies: () => req("/anomalies"),
  setAnomaly: (fingerprint, status) => req(`/anomalies/${fingerprint}`, { method: "PUT", body: JSON.stringify({ status }) }),
  manualHydration: () => req("/hydration/manual"),
  addWater: (amount_ml) => req("/hydration/manual", { method: "POST", body: JSON.stringify({ amount_ml }) }),
  plannerWeek: (start) => req(`/planner/week${start ? `?start=${start}` : ""}`),
  regeneratePlan: (start) => req("/planner/regenerate", { method: "POST", body: JSON.stringify({ start }) }),
  updatePlannedSession: (id, body) => req(`/planner/sessions/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  plannerSettings: () => req("/planner/settings"),
  setPlannerSettings: (body) => req("/planner/settings", { method: "PUT", body: JSON.stringify(body) }),
  recoveryForecast: () => req("/planner/recovery-forecast"),
  aiProbe: () => req("/ai/probe"),
  lab: () => req("/lab"),
  createExperiment: (body) => req("/lab/experiments", { method: "POST", body: JSON.stringify(body) }),
  updateExperiment: (id, body) => req(`/lab/experiments/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteExperiment: (id) => req(`/lab/experiments/${id}`, { method: "DELETE" }),
  logExperimentDay: (id, body = {}) => req(`/lab/experiments/${id}/days`, { method: "POST", body: JSON.stringify(body) }),
  addAnnotation: (body) => req("/lab/annotations", { method: "POST", body: JSON.stringify(body) }),
  deleteAnnotation: (id) => req(`/lab/annotations/${id}`, { method: "DELETE" }),
  dataQuality: () => req("/data-quality"),
  hevyStatus: () => req("/hevy/status"),
  healthTrend: (days = 30) => req(`/health/trend?days=${days}`),
  sleepTrend: (days = 30) => req(`/sleep/trend?days=${days}`),
  sleepConsistency: (days = 30) => req(`/sleep/consistency?days=${days}`),
  sleepExtra: () => req("/sleep/extra"),
  activities: (limit = 20) => req(`/activities?limit=${limit}`),
  activityDetail: (id) => req(`/activities/${id}`),
  activityRoute: (id) => req(`/activities/${id}/route`),
  activitySplits: (id) => req(`/activities/${id}/splits`),
  routeHeatmap: () => req("/activities/route-heatmap"),
  pushVapidKey: () => req("/push/vapid-public-key"),
  pushSubscribe: (subscription) => req("/push/subscribe", { method: "POST", body: JSON.stringify({ subscription }) }),
  pushUnsubscribe: (endpoint) => req("/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint }) }),
  pushTest: () => req("/push/test", { method: "POST" }),
  syncRouteHeatmap: (batchSize = 8) => req(`/activities/route-heatmap/sync?batch_size=${batchSize}`, { method: "POST" }),
  workouts: (limit = 20) => req(`/workouts?limit=${limit}`),
  workoutDetail: (id) => req(`/workouts/${id}`),
  pushWorkoutToGarmin: (id) => req(`/workouts/${id}/push-to-garmin`, { method: "POST" }),
  strength: (weeks = 8) => req(`/strength?weeks=${weeks}`),
  strengthThisWeek: () => req("/strength/this-week"),
  muscleRecency: () => req("/strength/muscle-recency"),
  trainingLoad: (weeks = 12) => req(`/training-load?weeks=${weeks}`),
  goalHistory: () => req("/weight/goal-history"),
  raceGoal: () => req("/training/race-goal"),
  setRaceGoal: (body) => req("/training/race-goal", { method: "POST", body: JSON.stringify(body) }),
  clearRaceGoal: () => req("/training/race-goal", { method: "DELETE" }),
  overloadWarnings: (weeks = 8) => req(`/training/overload-warnings?weeks=${weeks}`),
  trainingStressBalance: (days = 180) => req(`/training/stress-balance?days=${days}`),
  correlations: (days = 90) => req(`/analytics/correlations?days=${days}`),
  activityCalendar: (days = 365) => req(`/analytics/calendar?days=${days}`),
  repeatRoutes: () => req("/training/repeat-routes"),
  shoes: () => req("/shoes"),
  addShoe: (body) => req("/shoes", { method: "POST", body: JSON.stringify(body) }),
  retireShoe: (id) => req(`/shoes/${id}/retire`, { method: "POST" }),
  assignShoe: (activityId, shoeId) => req(`/activities/${activityId}/shoe`, { method: "POST", body: JSON.stringify({ shoe_id: shoeId }) }),
  todaysCall: () => req("/training/todays-call"),
  performance: (days = 30) => req(`/performance?days=${days}`),
  planCompliance: (weeks = 6) => req(`/training/plan-compliance?weeks=${weeks}`),
  syncSplits: (batch = 8) => req(`/activities/splits/sync?batch_size=${batch}`, { method: "POST" }),
  runInsights: (weeks = 12) => req(`/training/run-insights?weeks=${weeks}`),
  racePredictions: () => req("/training/race-predictions"),
  hrZones: (days = 30) => req(`/activities/hr-zones?days=${days}`),
  karvonenZones: () => req("/activities/karvonen-zones"),
  karvonenSessions: (days = 90) => req(`/activities/karvonen-sessions?days=${days}`),
  syncAll: (days) => req(`/sync/all${days ? `?days=${days}` : ""}`, { method: "POST" }),
  restartServer: () => req("/system/restart", { method: "POST" }),
  syncGarmin: (days) => req(`/sync/garmin${days ? `?days=${days}` : ""}`, { method: "POST" }),
  syncHevy: () => req("/sync/hevy", { method: "POST" }),
  connectHevy: () => req("/hevy/connect", { method: "POST" }),
  uploadHevyCsv: async (file) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/sync/hevy/upload", { method: "POST", body: fd });
    if (!res.ok) await throwResponseError(res);
    return res.json();
  },
  nutritionToday: () => req("/nutrition/today"),
  nutritionDay: (d) => req(`/nutrition/day?d=${d}`),
  nutritionTrend: (days = 14) => req(`/nutrition/trend?days=${days}`),
  setNutritionDayComplete: (date, complete) => req("/nutrition/day/complete", { method: "PUT", body: JSON.stringify({ date, complete }) }),
  nutritionFavorites: () => req("/nutrition/favorites"),
  nutritionStreak: () => req("/nutrition/streak"),
  nutritionProteinTiming: (d) => req(`/nutrition/protein-timing${d ? `?d=${d}` : ""}`),
  nutritionHydration: (d) => req(`/nutrition/hydration${d ? `?d=${d}` : ""}`),
  nutritionBarcode: (upc) => req(`/nutrition/barcode/${upc}`),
  addMeal: (payload) => req("/nutrition/meals", { method: "POST", body: JSON.stringify(payload) }),
  analyzeMeal: async (file, notes, provider) => {
    const fd = new FormData();
    if (file) fd.append("image", file);
    if (notes) fd.append("notes", notes);
    if (provider) fd.append("provider", provider);
    const res = await fetch("/api/nutrition/analyze", { method: "POST", body: fd });
    if (!res.ok) await throwResponseError(res);
    return res.json();
  },
  deleteMeal: (id) => req(`/nutrition/meals/${id}`, { method: "DELETE" }),
  nutritionGoal: () => req("/nutrition/goal"),
  setNutritionGoal: (payload) => req("/nutrition/goal", { method: "PUT", body: JSON.stringify(payload) }),
  updateMeal: (id, payload) => req(`/nutrition/meals/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  weightTrend: (days = 90) => req(`/weight/trend?days=${days}`),
  logWeight: (payload) => req("/weight", { method: "POST", body: JSON.stringify(payload) }),
  deleteWeight: (d) => req(`/weight/${d}`, { method: "DELETE" }),
  cutGoal: () => req("/weight/goal"),
  setCutGoal: (payload) => req("/weight/goal", { method: "PUT", body: JSON.stringify(payload) }),
  macroRecommendation: () => req("/weight/recommendation"),
  intraday: (d) => req(`/health/intraday${d ? `?d=${d}` : ""}`),
  currentReading: () => req("/health/current"),
  recipes: () => req("/recipes"),
  extractRecipe: async (images, url, text, provider) => {
    const fd = new FormData();
    (images || []).forEach((f) => fd.append("images", f));
    if (url) fd.append("url", url);
    if (text) fd.append("text", text);
    if (provider) fd.append("provider", provider);
    const res = await fetch("/api/recipes/extract", { method: "POST", body: fd });
    if (!res.ok) await throwResponseError(res);
    return res.json();
  },
  saveRecipe: (payload) => req("/recipes", { method: "POST", body: JSON.stringify(payload) }),
  deleteRecipe: (id) => req(`/recipes/${id}`, { method: "DELETE" }),
  logRecipeAsMeal: (id, payload) => req(`/recipes/${id}/log-as-meal`, { method: "POST", body: JSON.stringify(payload || {}) }),
  agentHistory: () => req("/agent/history"),
  clearAgentHistory: () => req("/agent/history", { method: "DELETE" }),
  agentExecute: (tool, args) => req("/agent/execute", { method: "POST", body: JSON.stringify({ tool, args }) }),
  agentBriefing: () => req("/agent/briefing"),
  refreshAgentBriefing: () => req("/agent/briefing/refresh", { method: "POST" }),
  raceReadiness: () => req("/race/readiness"),
  injuries: () => req("/injuries"),
  updateInjury: (id, body) => req(`/injuries/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  insight: (payload) => req("/insights", { method: "POST", body: JSON.stringify(payload) }),
  dailyInsight: () => req("/insights/daily"),
  refreshDailyInsight: () => req("/insights/daily/refresh", { method: "POST" }),
  insightHistory: () => req("/insights/history"),
  weeklyDigest: () => req("/insights/weekly"),
  refreshWeeklyDigest: () => req("/insights/weekly/refresh", { method: "POST" }),
  coachMemory: () => req("/insights/memory"),
  setCoachMemory: (notes) => req("/insights/memory", { method: "PUT", body: JSON.stringify({ notes }) }),
  weeklyReport: (weeks = 1, withAi = true) =>
    req(`/reports/weekly?weeks=${weeks}&with_ai=${withAi}`, { method: "POST" }),
  scheduledReport: () => req("/reports/scheduled"),
  refreshScheduledReport: () => req("/reports/scheduled/refresh", { method: "POST" }),
  comparisonReport: (weeks = 4) => req(`/reports/comparison?weeks=${weeks}`),
  backups: () => req("/backups"),
  runBackup: () => req("/backups/run", { method: "POST" }),
};
