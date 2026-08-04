const CACHE = "pulse-shell-v3";
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Network-first for everything (API calls must never serve stale cache); falls back
// to the cached shell only when fully offline, so the app still opens.
//
// `cache: "no-store"` is the important part here — without it, `fetch()` can be
// silently satisfied from the *browser's own* HTTP cache (not our Cache Storage),
// which happily returns a stale index.html/JS bundle referencing an old build even
// though this handler "looks" network-first. That let a genuinely fixed crash bug
// keep reappearing after every deploy until a hard refresh — this is why.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api/")) return; // never cache API responses

  e.respondWith(
    fetch(e.request, { cache: "no-store" })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((cached) => cached || caches.match("/")))
  );
});

// Real background push — fires even when no tab is open, unlike the old
// foreground-only Notification() calls from useReminders.js.
self.addEventListener("push", (e) => {
  let payload = { title: "Pulse", body: "" };
  try { payload = e.data.json(); } catch { /* non-JSON push, use default */ }
  e.waitUntil(
    self.registration.showNotification(payload.title || "Pulse", {
      body: payload.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: payload.tag || "pulse",
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      for (const c of clients) if ("focus" in c) return c.focus();
      if (self.clients.openWindow) return self.clients.openWindow("/");
    })
  );
});
