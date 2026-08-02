import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { COLORS, fmtDate, fmtPace, fmtNum, fmtDuration, activityMeta } from "../lib/format";
import { Modal, StatTile, Chip, Loading } from "./primitives";
import RouteMap from "./RouteMap";

const ZONE_COLORS = ["#8A93A6", "#3DD68C", "#F5A623", "#FF5C7A", "#c026d3"];

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
            <StatTile label="Distance" value={a.distance_km || "—"} unit="km" color={COLORS.cardio} />
            <StatTile label="Duration" value={fmtDuration((a.moving_duration_min || a.duration_min) * 60)} color={COLORS.cardio} />
            <StatTile label="Pace" value={a.pace_per_km ? fmtPace(a.pace_per_km) : "—"} color={COLORS.cardio} />
            <StatTile label="Avg HR" value={a.avg_hr} unit="bpm" color={COLORS.effort} />
            <StatTile label="Max HR" value={a.max_hr} unit="bpm" color={COLORS.effort} />
            <StatTile label="Calories" value={fmtNum(a.calories)} color={COLORS.strength} />
            <StatTile label="Elevation" value={fmtNum(a.elevation_gain_m)} unit="m" color={COLORS.muted} />
            <StatTile label="Cadence" value={fmtNum(a.avg_cadence)} color={COLORS.muted} />
            <StatTile label="VO₂max" value={a.vo2max != null ? fmtNum(a.vo2max, 1) : "—"} color={COLORS.recovery} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <StatTile label="Aerobic TE" value={a.aerobic_te != null ? fmtNum(a.aerobic_te, 1) : "—"} hint={a.aerobic_te_message} color={COLORS.recovery} />
            <StatTile label="Anaerobic TE" value={a.anaerobic_te != null ? fmtNum(a.anaerobic_te, 1) : "—"} hint={a.anaerobic_te_message} color={COLORS.effort} />
          </div>

          {totalZoneMin > 0 && (
            <div>
              <div className="mb-2 text-[10.5px] uppercase tracking-wider text-faint">Time in HR zones</div>
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
                    <span key={z} className="flex items-center gap-1.5 text-[11px] text-muted">
                      <span className="h-2 w-2 rounded-full" style={{ background: ZONE_COLORS[z - 1] }} />
                      Z{z} {min}m
                    </span>
                  ) : null;
                })}
              </div>
            </div>
          )}

          {(a.min_temperature != null || a.lap_count) && (
            <div className="flex flex-wrap gap-4 border-t border-line pt-3 text-xs text-muted">
              {a.lap_count && <span>{a.lap_count} laps</span>}
              {a.min_temperature != null && <span>{fmtNum(a.min_temperature)}–{fmtNum(a.max_temperature)}°C</span>}
              {(a.moderate_intensity_min || a.vigorous_intensity_min) && (
                <span>{fmtNum(a.moderate_intensity_min)}m moderate · {fmtNum(a.vigorous_intensity_min)}m vigorous</span>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
