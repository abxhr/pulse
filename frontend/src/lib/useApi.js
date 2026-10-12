import { useCallback, useEffect, useRef, useState } from "react";

// Short-lived response cache shared by every component: two cards asking for the
// same thing within `ttl` share one request, and revisiting a page shows data
// instantly while it refetches. Keys are plain strings, e.g. "healthTrend:90".
const store = new Map(); // key -> { at, data }
const pending = new Map(); // key -> Promise

export function fetchCached(key, fetcher, ttl = 30_000, now = Date.now) {
  const hit = store.get(key);
  if (hit && now() - hit.at < ttl) return Promise.resolve(hit.data);
  if (pending.has(key)) return pending.get(key);
  const p = fetcher()
    .then((data) => { store.set(key, { at: now(), data }); return data; })
    .finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}

/** Drop cached entries whose key starts with `prefix` (call after a write). */
export function invalidate(prefix = "") {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}

export function resetCache() { store.clear(); pending.clear(); }

/**
 * const { data, error, loading, reload } = useApi("tsb:180", () => api.trainingStressBalance(180));
 * `error` is set when the request fails; `reload()` bypasses the cache.
 */
export function useApi(key, fetcher, { ttl } = {}) {
  const [state, setState] = useState(() => ({ data: store.get(key)?.data ?? null, error: null, loading: !store.has(key) }));
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const latest = useRef(0);

  const run = useCallback((force) => {
    const id = ++latest.current;
    if (force) store.delete(key);
    setState((s) => ({ ...s, error: null, loading: true }));
    fetchCached(key, () => fetchRef.current(), ttl)
      .then((data) => { if (id === latest.current) setState({ data, error: null, loading: false }); })
      .catch((error) => { if (id === latest.current) setState((s) => ({ data: s.data, error, loading: false })); });
  }, [key, ttl]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- the counter must be read at cleanup time, not captured
  useEffect(() => { run(false); return () => { latest.current++; }; }, [run]);
  return { ...state, reload: () => run(true) };
}
