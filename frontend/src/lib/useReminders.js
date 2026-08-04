import { useState, useEffect, useRef } from "react";
import { api } from "./api";

const KEY = "pulse.remindersEnabled";
const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 min — foreground-only, no service worker push subscription

// Best-effort local reminders while the app tab is open. True background push
// would need a service-worker push subscription + a backend VAPID sender;
// this covers the common case (app installed as PWA, opened at least once a day).
export function useReminders() {
  const [enabled, setEnabled] = useState(() => localStorage.getItem(KEY) === "1");
  const lastFired = useRef({});

  async function enable() {
    if (!("Notification" in window)) return false;
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return false;
    localStorage.setItem(KEY, "1");
    setEnabled(true);
    return true;
  }

  function disable() {
    localStorage.removeItem(KEY);
    setEnabled(false);
  }

  useEffect(() => {
    if (!enabled || Notification.permission !== "granted") return;

    async function check() {
      const today = new Date().toISOString().slice(0, 10);
      const hour = new Date().getHours();

      try {
        const current = await api.currentReading();
        if (current?.body_battery != null && current.body_battery < 20 && lastFired.current.battery !== today) {
          new Notification("Body battery low", { body: `Down to ${current.body_battery} — consider easing off training today.` });
          lastFired.current.battery = today;
        }
      } catch { /* Garmin not reachable — skip this check silently */ }

      if (hour >= 20 && lastFired.current.weight !== today) {
        try {
          const trend = await api.weightTrend(2);
          const loggedToday = trend.some((r) => r.date === today);
          if (!loggedToday) {
            new Notification("Log your weight", { body: "Haven't seen a weigh-in today yet." });
            lastFired.current.weight = today;
          }
        } catch { /* no weight data yet — skip */ }
      }
    }

    check();
    const t = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(t);
  }, [enabled]);

  return { enabled, supported: "Notification" in window, enable, disable };
}
