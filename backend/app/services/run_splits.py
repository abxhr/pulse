"""Pure maths over cached Garmin splits (see gc.fetch_splits): true best
efforts and aerobic decoupling. No DB access, so it is trivially testable."""
from __future__ import annotations

_MIN_SPLITS_DECOUPLING = 6


def best_window(splits: list[dict], target_m: float) -> float | None:
    """Fastest time (s) to cover target_m using consecutive splits, or None.
    Windows must land within -2%/+5% of the target and are scaled to exactly
    target_m; only whole laps are used, so this suits ~1 km auto-laps."""
    laps = [s for s in splits if s.get("distance_m") and s.get("duration_s")]
    best = None
    for i in range(len(laps)):
        dist = dur = 0.0
        for lap in laps[i:]:
            dist += lap["distance_m"]
            dur += lap["duration_s"]
            if dist >= target_m * 0.98:
                if dist <= target_m * 1.05:
                    t = dur * target_m / dist
                    best = t if best is None else min(best, t)
                break
    return best


def decoupling_pct(splits: list[dict]) -> float | None:
    """Aerobic decoupling: % drop in speed-per-heartbeat from the first to the
    second half of a run. Under ~5% is a well-built aerobic base; higher means
    cardiac drift (heat, fatigue, going out too fast). None if too few splits."""
    laps = [s for s in splits if s.get("distance_m") and s.get("duration_s") and s.get("avg_hr")]
    if len(laps) < _MIN_SPLITS_DECOUPLING:
        return None
    mid = len(laps) // 2

    def ef(part):
        dist = sum(s["distance_m"] for s in part)
        dur = sum(s["duration_s"] for s in part)
        hr = sum(s["avg_hr"] * s["duration_s"] for s in part) / dur
        return (dist / dur) / hr

    first, second = ef(laps[:mid]), ef(laps[mid:])
    return round((first - second) / first * 100, 1)
