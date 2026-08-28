import { api } from "./api";

const KEY = "pulse.offlineMealQueue";

export function getQueue() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

function setQueue(items) {
  localStorage.setItem(KEY, JSON.stringify(items));
}

export function enqueueMeal(payload) {
  const items = getQueue();
  items.push({ payload, queuedAt: new Date().toISOString() });
  setQueue(items);
  return items.length;
}

// Meal logging is the primary "log this from my phone with no signal" case —
// syncs automatically once the connection comes back.
export async function flushQueue() {
  const items = getQueue();
  if (!items.length) return 0;
  const remaining = [];
  let synced = 0;
  for (const item of items) {
    try {
      await api.addMeal(item.payload);
      synced++;
    } catch {
      remaining.push(item);
    }
  }
  setQueue(remaining);
  return synced;
}
