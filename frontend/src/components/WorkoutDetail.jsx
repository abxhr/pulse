import { useEffect, useState } from "react";
import { Watch } from "lucide-react";
import { api } from "../lib/api";
import { COLORS, fmtDate, fmtDuration, fmtNum } from "../lib/format";
import { Modal, StatTile, Chip, Loading } from "./primitives";

export default function WorkoutDetail({ id, onClose }) {
  const [w, setW] = useState(null);
  const [pushState, setPushState] = useState("idle"); // idle | busy | ok | error
  const [pushMsg, setPushMsg] = useState(null);

  useEffect(() => {
    if (!id) return;
    setW(null);
    setPushState("idle");
    api.workoutDetail(id).then(setW).catch(() => setW(false));
  }, [id]);

  async function pushToGarmin() {
    setPushState("busy");
    try {
      const res = await api.pushWorkoutToGarmin(id);
      const matched = res.exercise_matches?.filter((m) => m.matched).length || 0;
      const total = res.exercise_matches?.length || 0;
      setPushMsg(res.pushed_to_device
        ? `Sent to your watch (${matched}/${total} exercises matched exactly).`
        : `Uploaded to Garmin Connect, but couldn't push to a device - open Garmin Connect to send it manually.`);
      setPushState("ok");
    } catch (e) {
      setPushMsg(String(e));
      setPushState("error");
    }
  }

  return (
    <Modal open={!!id} onClose={onClose} accent={COLORS.strength}
      title={w ? (w.title || "Workout") : "Workout"} sub={w ? fmtDate(w.date) : undefined}>
      {!w && w !== false && <Loading label="Loading workout…" />}
      {w === false && <p className="text-sm text-muted">Couldn't load this workout.</p>}
      {w && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <StatTile label="Volume" value={fmtNum(w.volume_kg)} unit="kg" color={COLORS.strength} />
            <StatTile label="Sets" value={w.set_count} color={COLORS.strength} />
            <StatTile label="Duration" value={fmtDuration(w.duration_min * 60)} color={COLORS.strength} />
          </div>

          <div>
            <button onClick={pushToGarmin} disabled={pushState === "busy"}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-panel2 py-2.5 text-sm font-medium text-muted transition hover:border-cardio/40 hover:text-cardio disabled:opacity-50">
              <Watch size={15} />
              {pushState === "busy" ? "Sending to Garmin…" : "Do this workout - push to Garmin"}
            </button>
            {pushMsg && (
              <p className={`mt-1.5 text-xs ${pushState === "error" ? "text-effort" : "text-recovery"}`}>{pushMsg}</p>
            )}
          </div>

          {w.description && <p className="text-xs text-muted">{w.description}</p>}

          <div className="space-y-3">
            {(w.exercises || []).map((ex, i) => {
              const vol = (ex.sets || []).reduce((s, x) => s + (x.weight_kg || 0) * (x.reps || 0), 0);
              return (
                <div key={i} className="rounded-xl bg-panel2 p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-txt">{ex.title}</span>
                      {ex.muscle_group && <Chip color={COLORS.effort}>{ex.muscle_group}</Chip>}
                    </div>
                    <span className="font-mono text-xs text-faint tnum">{fmtNum(vol)}kg</span>
                  </div>
                  <table className="mt-2 w-full text-left text-xs">
                    <thead>
                      <tr className="text-xs text-faint">
                        <th className="py-1 pr-3 font-medium">Set</th>
                        <th className="py-1 pr-3 font-medium">Weight</th>
                        <th className="py-1 pr-3 font-medium">Reps</th>
                        <th className="py-1 text-right font-medium">RPE</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono tnum">
                      {(ex.sets || []).map((s, j) => (
                        <tr key={j} className="border-t border-line/50">
                          <td className="py-1 pr-3 text-faint">{j + 1}</td>
                          <td className="py-1 pr-3 text-txt">{s.weight_kg ? `${s.weight_kg}kg` : "-"}</td>
                          <td className="py-1 pr-3 text-txt">{s.reps ?? "-"}</td>
                          <td className="py-1 text-right text-muted">{s.rpe ?? "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Modal>
  );
}
