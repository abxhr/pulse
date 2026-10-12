import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useApi, invalidate } from "../../lib/useApi";
import { Panel, Chip } from "../primitives";
import { COLORS } from "../../lib/format";
import { askCoach } from "./Briefing";

const STATUS_COLOR = { active: COLORS.effort, recovering: COLORS.strength, resolved: COLORS.recovery };

export function Injuries() {
  const { data, reload } = useApi("injuries", api.injuries, { ttl: 60_000 });
  useEffect(() => {
    window.addEventListener("pulse:data-changed", reload);
    return () => window.removeEventListener("pulse:data-changed", reload);
  }, [reload]);

  async function setStatus(id, status) {
    await api.updateInjury(id, { status });
    invalidate();
    window.dispatchEvent(new Event("pulse:data-changed"));
  }
  return (
    <Panel title="Injuries" sub="Shapes your plan and the race verdict">
      {data?.length ? (
        <ul className="space-y-3">
          {data.map((i) => (
            <li key={i.id} className="rounded-xl bg-panel2 px-3.5 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-txt">{i.area}{i.side ? `, ${i.side}` : ""}</span>
                <Chip color={STATUS_COLOR[i.status]}>{i.status}</Chip>
              </div>
              <p className="mt-0.5 text-xs text-muted">Day {i.days_since_onset}{i.pain != null ? ` · pain ${i.pain}/10` : ""}</p>
              {i.restrictions?.length > 0 && <p className="mt-1 text-xs text-faint">{i.restrictions.join("; ")}</p>}
              <label className="mt-2 flex items-center gap-2 text-xs text-muted">Status
                <select value={i.status} onChange={(e) => setStatus(i.id, e.target.value)} className="rounded-md bg-panel px-2 py-1 text-xs text-txt">
                  <option value="active">active</option><option value="recovering">recovering</option><option value="resolved">resolved</option>
                </select>
              </label>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted">Nothing logged.</p>}
      <button onClick={() => askCoach("I have an injury I need to log.")} className="mt-3 rounded-lg bg-panel2 px-3.5 py-2 text-sm font-medium text-txt hover:bg-line">Tell the Coach about one</button>
    </Panel>
  );
}

export function Memory() {
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const load = () => api.coachMemory().then((r) => setNotes(r.notes || "")).catch(() => {});
    load();
    window.addEventListener("pulse:data-changed", load);
    return () => window.removeEventListener("pulse:data-changed", load);
  }, []);
  async function save() {
    await api.setCoachMemory(notes);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }
  return (
    <Panel title="What the Coach knows" sub="Diet, schedule, preferences. It adds to this itself.">
      <textarea aria-label="Coach notes about you" value={notes} onChange={(e) => setNotes(e.target.value)} rows={4}
        placeholder="e.g. No pork. Can only run Tue/Thu/Sat. Dominant hand is right."
        className="w-full resize-y rounded-xl bg-panel2 px-3.5 py-2.5 text-sm text-txt placeholder:text-faint focus-visible:ring-2 focus-visible:ring-recovery/50" />
      <button onClick={save} className="mt-2 rounded-lg bg-panel2 px-3.5 py-2 text-sm font-medium text-txt hover:bg-line">{saved ? "Saved" : "Save"}</button>
    </Panel>
  );
}
