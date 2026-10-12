import { useState, useEffect } from "react";
import { api } from "./api";

const KEY = "pulse.remindersEnabled";

function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// Real background push (service-worker + VAPID) - the backend's scheduler
// evaluates conditions every 15 min and pushes to the browser directly, so
// this fires even with the app fully closed. Replaces the old foreground-only
// Notification() polling, which only ever worked while the tab stayed open.
export function useReminders() {
  const [enabled, setEnabled] = useState(() => localStorage.getItem(KEY) === "1");
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

  useEffect(() => {
    if (!supported) return;
    // Reconcile stored preference with the actual subscription state (e.g.
    // user revoked the OS notification permission outside the app).
    navigator.serviceWorker.ready.then((reg) => reg.pushManager.getSubscription()).then((sub) => {
      if (!sub && enabled) setEnabled(false);
    }).catch(() => {});
  }, [supported]);

  async function enable() {
    if (!supported) return false;
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return false;
    const { key } = await api.pushVapidKey();
    if (!key) return false; // server has no VAPID keys configured yet
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key),
    });
    await api.pushSubscribe(sub.toJSON());
    localStorage.setItem(KEY, "1");
    setEnabled(true);
    return true;
  }

  async function disable() {
    if (supported) {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.pushUnsubscribe(sub.endpoint).catch(() => {});
        await sub.unsubscribe();
      }
    }
    localStorage.removeItem(KEY);
    setEnabled(false);
  }

  return { enabled, supported, enable, disable };
}
