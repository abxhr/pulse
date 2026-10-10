import { useEffect, useState, useRef } from "react";
import { Search, Activity, Dumbbell, UtensilsCrossed } from "lucide-react";
import { api } from "../lib/api";
import { fmtDate } from "../lib/format";

const PENDING_KEY = "pulse.pendingOpen";

export function setPendingOpen(type, id) {
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ type, id }));
}

export function consumePendingOpen(type) {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.type !== type) return null;
    sessionStorage.removeItem(PENDING_KEY);
    return parsed.id;
  } catch {
    return null;
  }
}

export default function CommandPalette({ onNavigate }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [data, setData] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 30);
    if (!data) {
      Promise.all([
        api.activities(200).catch(() => []),
        api.workouts(200).catch(() => []),
        api.recipes().catch(() => []),
      ]).then(([activities, workouts, recipes]) => setData({ activities, workouts, recipes }));
    }
  }, [open, data]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const results = [];
  if (data && q) {
    for (const a of data.activities) {
      if ((a.name || a.type || "").toLowerCase().includes(q)) {
        results.push({ kind: "activity", id: a.id, label: a.name || a.type, sub: fmtDate(a.date), icon: Activity });
      }
    }
    for (const w of data.workouts) {
      if ((w.title || "").toLowerCase().includes(q)) {
        results.push({ kind: "workout", id: w.id, label: w.title || "Workout", sub: fmtDate(w.date), icon: Dumbbell });
      }
    }
    for (const r of data.recipes) {
      if ((r.name || "").toLowerCase().includes(q)) {
        results.push({ kind: "recipe", id: r.id, label: r.name, sub: "recipe", icon: UtensilsCrossed });
      }
    }
  }

  function select(r) {
    if (r.kind === "activity") { setPendingOpen("activity", r.id); onNavigate("training"); }
    else if (r.kind === "workout") { setPendingOpen("workout", r.id); onNavigate("strength"); }
    else if (r.kind === "recipe") { onNavigate("nutrition"); }
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 pt-24 backdrop-blur-sm" onClick={() => setOpen(false)}>
      <div className="w-full max-w-lg rounded-2xl border border-line bg-panel shadow-panel" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <Search size={16} className="text-faint" />
          <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search activities, workouts, recipes…"
            className="flex-1 bg-transparent text-sm text-txt placeholder:text-faint focus:outline-none" />
          <kbd className="rounded border border-line px-1.5 py-0.5 text-xs text-faint">Esc</kbd>
        </div>
        <div className="max-h-80 overflow-y-auto p-2">
          {!data && <p className="px-3 py-4 text-center text-xs text-faint">loading…</p>}
          {data && q && !results.length && <p className="px-3 py-4 text-center text-xs text-faint">No matches.</p>}
          {results.slice(0, 20).map((r) => (
            <button key={`${r.kind}-${r.id}`} onClick={() => select(r)}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-panel2">
              <r.icon size={15} className="text-faint" />
              <span className="flex-1 truncate text-sm text-txt">{r.label}</span>
              <span className="text-xs text-faint">{r.sub}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
