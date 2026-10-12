import { useState } from "react";

// Click a legend entry to hide/show that series - lets you isolate one line on a
// busy dual-axis chart instead of staring at both tangled together.
export function useSeriesToggle() {
  const [hidden, setHidden] = useState(() => new Set());
  const toggle = (key) => setHidden((h) => {
    const next = new Set(h);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });
  return { hidden, toggle };
}

export function ChartLegend({ series, hidden, toggle }) {
  return (
    <div className="mt-2 flex flex-wrap justify-center gap-3">
      {series.map((s) => {
        const off = hidden.has(s.key);
        return (
          <button key={s.key} type="button" onClick={() => toggle(s.key)}
            className={`flex items-center gap-1.5 text-xs transition ${off ? "text-faint/60" : "text-muted"}`}>
            <span className={`h-2.5 w-2.5 rounded-full transition-opacity ${off ? "opacity-30" : ""}`} style={{ background: s.color }} />
            <span className={off ? "line-through" : ""}>{s.name}</span>
          </button>
        );
      })}
    </div>
  );
}
