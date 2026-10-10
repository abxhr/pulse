import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Sparkles, ListOrdered, Footprints, Thermometer } from "lucide-react";
import { api } from "../lib/api";
import { COLORS, fmtDate, fmtPace, fmtNum, fmtDuration, activityMeta } from "../lib/format";
import { Modal, StatTile, Chip, Loading } from "./primitives";
import RouteMap from "./RouteMap";

const ZONE_COLORS = ["#8A93A6", "#3DD68C", "#F5A623", "#FF5C7A", "#c026d3"];

function ExplainRun({ a }) {
  const [content, setContent] = useState(null);
  const [busy, setBusy] = useState(false);

  async function ask() {
    setBusy(true);
    try {
      const res = await api.insight({
        scope: "activity",
        question: `Explain this specific ${a.type || "activity"} from ${a.date}: ${a.distance_km}km, ` +
          `${fmtDuration((a.moving_duration_min || a.duration_min) * 60)}, pace ${a.pace_per_km ? fmtPace(a.pace_per_km) : "n/a"}, ` +
          `avg HR ${a.avg_hr ?? "n/a"}, max HR ${a.max_hr ?? "n/a"}, aerobic TE ${a.aerobic_te ?? "n/a"}, ` +
          `anaerobic TE ${a.anaerobic_te ?? "n/a"}. How does it fit into my recent training load and recovery? ` +
          `Was this an appropriate effort given my recent sleep/readiness? Keep it to 3-4 sentences.`,
      });
      setContent(res.content);
    } finally {
      setBusy(false);
    }
  }

  if (content) return <div className="md text-sm border-t border-line pt-3"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div>;
  return (
    <button onClick={ask} disabled={busy}
      className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line py-2 text-xs text-muted transition hover:border-recovery/40 hover:text-recovery disabled:opacity-50">
      <Sparkles size={13} /> {busy ? "Analyzing…" : "Explain this run"}
    </button>
  );
}

function SplitsTable({ activityId }) {
  const [splits, setSplits] = useState(null);
  const [open, setOpen] = useState(false);

  function toggle() {
    if (!open && !splits) {
      api.activitySplits(activityId).then((r) => setSplits(r.splits)).catch(() => setSplits([]));
    }
    setOpen((o) => !o);
  }

  return (
    <div>
      <button onClick={toggle}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line py-2 text-xs text-muted transition hover:border-cardio/40 hover:text-cardio">
        <ListOrdered size={13} /> {open ? "Hide splits" : "Show splits"}
      </button>
      {open && (
        splits === null ? (
          <p className="mt-2 text-center text-xs text-faint">loading…</p>
        ) : splits.length ? (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line text-xs text-faint">
                  <th className="py-1.5 pr-2 font-medium">#</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Dist</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Pace</th>
                  <th className="py-1.5 pr-2 text-right font-medium">GAP</th>
                  <th className="py-1.5 text-right font-medium">HR</th>
                </tr>
              </thead>
              <tbody className="font-mono tnum">
                {splits.map((s) => (
                  <tr key={s.index} className="border-b border-line/40">
                    <td className="py-1.5 pr-2 text-muted">{s.index}</td>
                    <td className="py-1.5 pr-2 text-right text-txt">{fmtNum((s.distance_m || 0) / 1000, 2)}</td>
                    <td className="py-1.5 pr-2 text-right text-cardio">{s.pace_s_per_km ? fmtPace(s.pace_s_per_km) : "-"}</td>
                    <td className="py-1.5 pr-2 text-right text-recovery">{s.gap_s_per_km ? fmtPace(s.gap_s_per_km) : "-"}</td>
                    <td className="py-1.5 text-right text-effort">{s.avg_hr ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-2 text-center text-xs text-faint">No split data for this activity.</p>
        )
      )}
    </div>
  );
}

function ShoePicker({ activityId, shoeId }) {
  const [shoes, setShoes] = useState(null);
  const [current, setCurrent] = useState(shoeId);
  useEffect(() => { api.shoes().then(setShoes).catch(() => setShoes([])); }, []);
  useEffect(() => setCurrent(shoeId), [shoeId]);

  async function change(e) {
    const val = e.target.value ? Number(e.target.value) : null;
    setCurrent(val);
    await api.assignShoe(activityId, val);
  }

  if (!shoes?.length) return null;
  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      <Footprints size={14} className="text-faint" />
      <select value={current ?? ""} onChange={change}
        className="rounded-lg border border-line bg-ink px-2 py-1 text-xs text-txt focus:outline-none">
        <option value="">No shoe assigned</option>
        {shoes.filter((s) => !s.retired || s.id === current).map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
    </label>
  );
}

export default function ActivityDetail({ id, onClose }) {
  const [a, setA] = useState(null);
  useEffect(() => {
    if (!id) return;
    setA(null);
    api.activityDetail(id).then(setA).catch(() => setA(false));
  }, [id]);

  const m = activityMeta(a?.type);
  const totalZoneMin = a
    ? Object.values(a.hr_zones_min || {}).reduce((s, v) => s + (v || 0), 0)
    : 0;

  return (
    <Modal open={!!id} onClose={onClose} accent={a ? COLORS[m.color] : undefined}
      title={a ? (a.name || m.label) : "Activity"} sub={a ? fmtDate(a.date) : undefined}>
      {!a && a !== false && <Loading label="Loading activity…" />}
      {a === false && <p className="text-sm text-muted">Couldn't load this activity.</p>}
      {a && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            {a.is_pr && <Chip color={COLORS.strength} solid>PR</Chip>}
            {a.training_effect_label && <Chip color={COLORS.recovery}>{a.training_effect_label}</Chip>}
            <Chip color={COLORS[m.color]}>{m.label}</Chip>
          </div>

          {a.has_route && <RouteMap activityId={a.id} />}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile label="Distance" value={a.distance_km || "-"} unit="km" color={COLORS.cardio} />
            <StatTile label="Duration" value={fmtDuration((a.moving_duration_min || a.duration_min) * 60)} color={COLORS.cardio} />
            <StatTile label="Pace" value={a.pace_per_km ? fmtPace(a.pace_per_km) : "-"} color={COLORS.cardio} />
            {a.gap_pace_per_km != null && a.gap_pace_per_km !== a.pace_per_km && (
              <StatTile label="Grade-adj. pace" value={fmtPace(a.gap_pace_per_km)} color={COLORS.recovery} hint="flat-effort equivalent" />
            )}
            <StatTile label="Avg HR" value={a.avg_hr} unit="bpm" color={COLORS.effort} />
            <StatTile label="Max HR" value={a.max_hr} unit="bpm" color={COLORS.effort} />
            <StatTile label="Calories" value={fmtNum(a.calories)} color={COLORS.strength} />
            <StatTile label="Elevation" value={fmtNum(a.elevation_gain_m)} unit="m" color={COLORS.muted} />
            <StatTile label="Cadence" value={fmtNum(a.avg_cadence)} color={COLORS.muted} />
            <StatTile label="VO₂max" value={a.vo2max != null ? fmtNum(a.vo2max, 1) : "-"} color={COLORS.recovery} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <StatTile label="Aerobic TE" value={a.aerobic_te != null ? fmtNum(a.aerobic_te, 1) : "-"} hint={a.aerobic_te_message} color={COLORS.recovery} />
            <StatTile label="Anaerobic TE" value={a.anaerobic_te != null ? fmtNum(a.anaerobic_te, 1) : "-"} hint={a.anaerobic_te_message} color={COLORS.effort} />
          </div>

          {totalZoneMin > 0 && (
            <div>
              <div className="mb-2 text-xs text-faint">Time in HR zones</div>
              <div className="flex h-3 overflow-hidden rounded-full bg-panel2">
                {[1, 2, 3, 4, 5].map((z) => {
                  const min = a.hr_zones_min[`zone_${z}_min`] || 0;
                  const pct = (min / totalZoneMin) * 100;
                  return pct > 0 ? (
                    <div key={z} style={{ width: `${pct}%`, background: ZONE_COLORS[z - 1] }} title={`Zone ${z}: ${min}min`} />
                  ) : null;
                })}
              </div>
              <div className="mt-2 flex flex-wrap gap-3">
                {[1, 2, 3, 4, 5].map((z) => {
                  const min = a.hr_zones_min[`zone_${z}_min`] || 0;
                  return min > 0 ? (
                    <span key={z} className="flex items-center gap-1.5 text-xs text-muted">
                      <span className="h-2 w-2 rounded-full" style={{ background: ZONE_COLORS[z - 1] }} />
                      Z{z} {min}m
                    </span>
                  ) : null;
                })}
              </div>
            </div>
          )}

          {(a.min_temperature != null || a.lap_count || a.weather) && (
            <div className="flex flex-wrap gap-4 border-t border-line pt-3 text-xs text-muted">
              {a.lap_count && <span>{a.lap_count} laps</span>}
              {a.min_temperature != null && <span>{fmtNum(a.min_temperature)}–{fmtNum(a.max_temperature)}°C</span>}
              {(a.moderate_intensity_min || a.vigorous_intensity_min) && (
                <span>{fmtNum(a.moderate_intensity_min)}m moderate · {fmtNum(a.vigorous_intensity_min)}m vigorous</span>
              )}
              {a.weather && (
                <span className="flex items-center gap-1">
                  <Thermometer size={12} /> {fmtNum(a.weather.temperature_c, 0)}°C
                  {a.weather.humidity_pct != null && ` · ${fmtNum(a.weather.humidity_pct, 0)}% humidity`}
                  {a.weather.temperature_c >= 32 && <span className="text-effort"> - hot effort, pace naturally suffers</span>}
                </span>
              )}
            </div>
          )}

          {(a.type || "").includes("run") && <ShoePicker activityId={a.id} shoeId={a.shoe_id} />}

          {(a.type || "").includes("run") && a.distance_km > 0 && <SplitsTable activityId={a.id} />}

          {(a.type || "").includes("run") && <ExplainRun a={a} />}
        </div>
      )}
    </Modal>
  );
}
