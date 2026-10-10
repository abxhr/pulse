"""Report generation. Produces a structured report (JSON) and a Markdown render
for a chosen period. The frontend renders it and can print to PDF; you can also
wire in reportlab/weasyprint later for server-side PDF (see build_pdf stub)."""
from __future__ import annotations
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Insight
from . import analytics, insights

SCHEDULED_SCOPE = "weekly_report_auto"


def _fmt_hm(seconds):
    if not seconds:
        return "-"
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
        f"# Pulse - {weeks}-Week Performance Report",
        f"_Generated {s['generated']}_\n",
        "## Headline",
        f"- **Avg sleep score:** {s['avg_sleep_score'] or '-'}  ·  **Avg sleep:** {s['avg_sleep_hours'] or '-'} h",
        f"- **Avg resting HR:** {s['avg_resting_hr'] or '-'} bpm  ·  **Avg HRV:** {s['avg_hrv'] or '-'} ms",
        f"- **Avg readiness:** {s['avg_readiness'] or '-'}  ·  **VO₂max:** {s['current_vo2max'] or '-'}",
        f"- **Running:** {s['total_run_km']} km  ·  **Strength volume:** {s['strength_volume_kg']:.0f} kg  ·  **Sessions:** {s['sessions']}",
        "",
    ]
    if ai_text:
        lines += ["## Analysis", ai_text, ""]
    lines += ["## Strength - top exercises by volume"]
    for t in strength["top_exercises"][:6]:
        lines.append(f"- **{t['exercise']}** - {t['volume']:.0f} kg over {t['sets']} sets (best {t['best_kg']:.0f} kg)")
    lines += ["", "## Sessions this period"]
    for a in acts[:15]:
        lines.append(
            f"- {a['date']} · {a['type']} · {a['distance_km']} km · {a['duration_min']} min · avg HR {a['avg_hr'] or '-'}"
        )
    return "\n".join(lines)


def get_or_generate_scheduled(db: Session, force: bool = False) -> dict:
    """Auto-generated weekly report, cached once per ISO week - ready Monday
    morning without having to remember to click Generate. Reuses the Insight
    table (scope-tagged) so no extra schema is needed for the cached markdown."""
    if not force:
        monday = date.today() - timedelta(days=date.today().weekday())
        week_start = datetime.combine(monday, datetime.min.time())
        existing = db.execute(
            select(Insight)
            .where(Insight.scope == SCHEDULED_SCOPE, Insight.role == "assistant", Insight.created_at >= week_start)
            .order_by(Insight.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()
        if existing:
            return {"markdown": existing.content, "created_at": existing.created_at.isoformat(), "cached": True}
    report = weekly_report(db, weeks=1, with_ai=True)
    row = Insight(scope=SCHEDULED_SCOPE, role="assistant", content=report["markdown"])
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"markdown": report["markdown"], "created_at": row.created_at.isoformat(), "cached": False}


def comparison_report(db: Session, weeks: int = 4) -> dict:
    """This window vs. the equal-length window immediately before it - a
    single snapshot doesn't show direction, this does."""
    days = weeks * 7

    def _window_summary(offset_days: int) -> dict:
        end = date.today() - timedelta(days=offset_days)
        start = end - timedelta(days=days)
        health = [r for r in analytics.health_trend(db, offset_days + days) if start.isoformat() <= r["date"] < end.isoformat()]
        sleep = [r for r in analytics.sleep_trend(db, offset_days + days) if start.isoformat() <= r["date"] < end.isoformat()]
        acts = [a for a in analytics.recent_activities(db, 500) if a["date"] and start.isoformat() <= a["date"] < end.isoformat()]
        run_km = round(sum(a["distance_km"] for a in acts if "run" in (a["type"] or "")), 1)

        def avg(rows, key):
            vals = [r[key] for r in rows if r.get(key) is not None]
            return round(sum(vals) / len(vals), 1) if vals else None

        return {
            "avg_sleep_hours": avg(sleep, "total_h"), "avg_readiness": avg(health, "readiness"),
            "avg_resting_hr": avg(health, "resting_hr"), "avg_hrv": avg(health, "hrv"),
            "run_km": run_km, "sessions": len(acts),
        }

    current = _window_summary(0)
    previous = _window_summary(days)

    def delta(key):
        c, p = current.get(key), previous.get(key)
        if c is None or p is None:
            return None
        return round(c - p, 1)

    return {
        "weeks": weeks, "current": current, "previous": previous,
        "delta": {k: delta(k) for k in current},
    }


def build_pdf(markdown_text: str) -> bytes | None:
    """Optional server-side PDF. Left as an extension point.
    Easiest path: `pip install markdown weasyprint` then render markdown->HTML->PDF."""
    return None
