import { useState, useCallback } from "react";

const STORAGE_KEY = "pulse.overview.layout.v1";

export function loadLayout(defaultOrder) {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!saved?.order) return { order: defaultOrder, hidden: [] };
    // merge in any newly-added sections that aren't in a previously-saved order yet
    const missing = defaultOrder.filter((id) => !saved.order.includes(id));
    return { order: [...saved.order.filter((id) => defaultOrder.includes(id)), ...missing], hidden: saved.hidden || [] };
  } catch {
    return { order: defaultOrder, hidden: [] };
  }
}

export function useDashboardLayout(defaultOrder) {
  const [layout, setLayout] = useState(() => loadLayout(defaultOrder));

  const persist = useCallback((updaterOrValue) => {
    setLayout((prev) => {
      const next = typeof updaterOrValue === "function" ? updaterOrValue(prev) : updaterOrValue;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const move = useCallback((id, dir) => persist((prev) => {
    const order = [...prev.order];
    const i = order.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= order.length) return prev;
    [order[i], order[j]] = [order[j], order[i]];
    return { ...prev, order };
  }), [persist]);

  const toggleHidden = useCallback((id) => persist((prev) => ({
    ...prev,
    hidden: prev.hidden.includes(id) ? prev.hidden.filter((h) => h !== id) : [...prev.hidden, id],
  })), [persist]);

  const reset = useCallback(() => persist({ order: defaultOrder, hidden: [] }), [persist, defaultOrder]);

  return { order: layout.order, hidden: layout.hidden, move, toggleHidden, reset };
}
