"""Report generation. Produces a structured report (JSON) and a Markdown render
for a chosen period. The frontend renders it and can print to PDF; you can also
wire in reportlab/weasyprint later for server-side PDF (see build_pdf stub)."""
from __future__ import annotations
from datetime import date, timedelta

from sqlalchemy.orm import Session

from . import analytics, insights


def _fmt_hm(seconds):
    if not seconds:
        return "—"
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    return f"{h}h {m:02d}m"


def weekly_report(db: Session, weeks: int = 1, with_ai: bool = True) -> dict:
    days = weeks * 7
    health = analytics.health_trend(db, days)
    sleep = analytics.sleep_trend(db, days)
    acts = analytics.recent_activities(db, 30)
    strength = analytics.strength_summary(db, weeks)
    snap = analytics.snapshot(db)

    def avg(rows, key):
        vals = [r[key] for r in rows if r.get(key) is not None]
        return round(sum(vals) / len(vals), 1) if vals else None

    period_acts = [a for a in acts if a["date"] and a["date"] >= (date.today() - timedelta(days=days)).isoformat()]
    run_km = round(sum(a["distance_km"] for a in period_acts if "run" in (a["type"] or "")), 1)

    summary = {
        "period_days": days,
        "generated": date.today().isoformat(),
        "avg_sleep_score": avg(sleep, "score"),
        "avg_sleep_hours": avg(sleep, "total_h"),
        "avg_resting_hr": avg(health, "resting_hr"),
        "avg_hrv": avg(health, "hrv"),
        "avg_readiness": avg(health, "readiness"),
        "avg_steps": avg(health, "steps"),
        "total_run_km": run_km,
        "sessions": len(period_acts) + strength["workout_count"],
        "strength_volume_kg": strength["total_volume_kg"],
        "current_vo2max": snap.get("vo2max"),
    }

    ai_text = None
    if with_ai:
        try:
            ai = insights.generate_insight(
                db,
                question=f"Write the narrative section of my {weeks}-week performance report. "
                         "Cover recovery, sleep, cardio, and strength, with 3 focus areas for next week.",
                scope="report",
            )
            ai_text = ai["content"]
        except Exception as e:
            ai_text = f"_AI narrative unavailable: {e}_"

    md = _render_markdown(summary, strength, period_acts, ai_text, weeks)
    return {"summary": summary, "strength": strength, "activities": period_acts,
            "ai_narrative": ai_text, "markdown": md}


def _render_markdown(s, strength, acts, ai_text, weeks) -> str:
    lines = [
        f"# Pulse — {weeks}-Week Performance Report",
        f"_Generated {s['generated']}_\n",
        "## Headline",
        f"- **Avg sleep score:** {s['avg_sleep_score'] or '—'}  ·  **Avg sleep:** {s['avg_sleep_hours'] or '—'} h",
        f"- **Avg resting HR:** {s['avg_resting_hr'] or '—'} bpm  ·  **Avg HRV:** {s['avg_hrv'] or '—'} ms",
        f"- **Avg readiness:** {s['avg_readiness'] or '—'}  ·  **VO₂max:** {s['current_vo2max'] or '—'}",
        f"- **Running:** {s['total_run_km']} km  ·  **Strength volume:** {s['strength_volume_kg']:.0f} kg  ·  **Sessions:** {s['sessions']}",
        "",
    ]
    if ai_text:
        lines += ["## Analysis", ai_text, ""]
    lines += ["## Strength — top exercises by volume"]
    for t in strength["top_exercises"][:6]:
        lines.append(f"- **{t['exercise']}** — {t['volume']:.0f} kg over {t['sets']} sets (best {t['best_kg']:.0f} kg)")
    lines += ["", "## Sessions this period"]
    for a in acts[:15]:
        lines.append(
            f"- {a['date']} · {a['type']} · {a['distance_km']} km · {a['duration_min']} min · avg HR {a['avg_hr'] or '—'}"
        )
    return "\n".join(lines)


def build_pdf(markdown_text: str) -> bytes | None:
    """Optional server-side PDF. Left as an extension point.
    Easiest path: `pip install markdown weasyprint` then render markdown->HTML->PDF."""
    return None
