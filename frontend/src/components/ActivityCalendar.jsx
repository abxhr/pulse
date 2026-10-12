import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { COLORS, mix } from "../lib/format";
import { Panel } from "./primitives";

const LEVEL_COLOR = ["var(--color-panel2)", mix(COLORS.recovery, 20), mix(COLORS.recovery, 40), mix(COLORS.recovery, 60), COLORS.recovery];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function ActivityCalendar() {
  const [days, setDays] = useState(null);
  const [hover, setHover] = useState(null);
  useEffect(() => { api.activityCalendar(365).then(setDays).catch(() => setDays([])); }, []);
  if (!days?.length) return null;

  // Pad to start on a Sunday so the grid lines up into clean week columns.
  const first = new Date(days[0].date + "T00:00:00");
  const pad = first.getDay();
  const cells = [...Array(pad).fill(null), ...days];
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const monthLabels = [];
  let lastMonth = -1;
  weeks.forEach((week, wi) => {
    const firstReal = week.find(Boolean);
    if (!firstReal) return;
    const m = new Date(firstReal.date + "T00:00:00").getMonth();
    if (m !== lastMonth) { monthLabels.push({ wi, label: MONTH_NAMES[m] }); lastMonth = m; }
  });

  const activeDays = days.filter((d) => d.level > 0).length;

  return (
    <Panel accent={COLORS.recovery} title="Activity calendar" sub={`${activeDays} of ${days.length} days logged something, last 12 months`}>
      <div className="overflow-x-auto">
        <div className="relative inline-block" style={{ paddingLeft: 2 }}>
          <div className="relative mb-1 h-3" style={{ width: weeks.length * 13 }}>
            {monthLabels.map((m) => (
              <span key={m.wi} className="absolute text-xs text-faint" style={{ left: m.wi * 13 }}>{m.label}</span>
            ))}
          </div>
          <div className="flex gap-[3px]">
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-[3px]">
                {week.map((d, di) => (
                  <div key={di}
                    className="h-[10px] w-[10px] rounded-sm"
                    style={{ background: d ? LEVEL_COLOR[d.level] : "transparent" }}
                    onMouseEnter={() => d && setHover(d)}
                    onMouseLeave={() => setHover(null)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-faint">
        <span>{hover ? `${hover.date} - ${hover.categories.length ? hover.categories.join(", ") : "nothing logged"}` : "hover a day"}</span>
        <span className="flex items-center gap-1">
          less {LEVEL_COLOR.map((c, i) => <span key={i} className="h-[10px] w-[10px] rounded-sm" style={{ background: c }} />)} more
        </span>
      </div>
    </Panel>
  );
}
