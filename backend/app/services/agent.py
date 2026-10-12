"""Pulse Coach: a tool-calling agent that lives inside the app.

It reads everything through `read` tools, changes things through `write` tools, asks the owner
before anything destructive (`confirm` tools surface as buttons), and answers with rich blocks
(`ui` tools: charts, stat tiles, plans, callouts, action buttons, quick replies).

One loop, two providers (Anthropic / OpenAI), both streamed. `run_turn` is a generator of
small event dicts that the API forwards as NDJSON.
"""
from __future__ import annotations
import json
import logging
import threading
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Callable, Iterator

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Activity, CoachMemory, Injury, Insight, PlannedSession, RaceGoal
from ..schemas import MealBody, RaceGoalBody, WaterBody, WeightBody
from . import (analytics, cardio_extras, injury as injury_svc, insights, lab, nutrition, performance, phase2,
               planner, race_readiness, weight as weight_svc)

log = logging.getLogger("pulse.agent")
MAX_STEPS = 8
MAX_RESULT_CHARS = 14_000
CHAT_SCOPE, BRIEFING_SCOPE = "agent", "agent_briefing"

# --------------------------------------------------------------------------- registry
@dataclass
class Tool:
    name: str
    desc: str
    params: dict
    fn: Callable
    kind: str  # read | write | confirm | ui


TOOLS: dict[str, Tool] = {}


def _schema(props: dict) -> dict:
    """Shorthand -> JSON schema. Value is (type, description[, enum]) or a raw schema dict.
    A trailing '!' on the key or the type marks it required."""
    out, req = {}, []
    for key, v in props.items():
        name = key.rstrip("!")
        if key.endswith("!"): req.append(name)
        if isinstance(v, dict):
            out[name] = v
            continue
        typ, desc, *enum = v
        if typ.endswith("!"):
            typ = typ[:-1]; req.append(name)
        out[name] = {"type": typ, "description": desc, **({"enum": enum[0]} if enum else {})}
    return {"type": "object", "properties": out, "required": req}


def tool(kind: str, desc: str, /, **props):
    def wrap(fn):
        TOOLS[fn.__name__] = Tool(fn.__name__, desc, _schema(props), fn, kind)
        return fn
    return wrap


@dataclass
class Ctx:
    db: Session
    events: list = field(default_factory=list)   # UI blocks queued for the stream, in order
    notes: list = field(default_factory=list)    # one-line records of actions taken
    mutated: bool = False
    ui_shown: bool = False
    offered: set = field(default_factory=set)   # (tool, args) buttons already shown this turn

    def emit(self, block: dict) -> None:
        self.ui_shown = True
        self.events.append(block)

    def _offer(self, item: dict) -> bool:
        key = json.dumps([item.get("tool"), item.get("args")], sort_keys=True, default=str)
        if key in self.offered: return False
        self.offered.add(key)
        self.events.append({"type": "actions", "items": [item]})
        return True

    def done(self, text: str) -> None:
        self.mutated = True
        self.notes.append(text)
        self.events.append({"type": "done", "text": text})

    def run(self, name: str, args: dict, trusted: bool = False) -> str:
        t = TOOLS.get(name)
        if not t: return json.dumps({"error": f"unknown tool '{name}'"})
        if t.kind == "confirm" and not trusted:
            # Never executed from the model: it becomes a confirm button the owner has to click.
            self._offer({"label": t.desc.rstrip("."), "tool": name, "args": args or {}, "confirm": True})
            return json.dumps({"status": "awaiting_owner_confirmation", "note": "A confirm button was shown. Say exactly what will be deleted; do not say it is deleted."})
        try:
            res = t.fn(self, **(args or {}))
        except (TypeError, ValueError, KeyError) as e:
            self.db.rollback()
            return json.dumps({"error": f"{type(e).__name__}: {e}"})
        except Exception as e:  # keep the loop alive; the model can explain or retry
            self.db.rollback()
            log.exception("agent tool %s failed", name)
            return json.dumps({"error": f"{type(e).__name__}: {e}"})
        text = json.dumps(res, default=str)
        if len(text) > MAX_RESULT_CHARS:
            text = text[:MAX_RESULT_CHARS] + '... [truncated; ask for a narrower window]'
        return text


# --------------------------------------------------------------------------- series (charts + analysis)
def _pairs(rows, key, sub=None):
    return [(r["date"], (r[key] if sub is None else r[sub][key])) for r in rows]


def _runs_in(db: Session, days: int):
    since = date.today() - timedelta(days=days)
    return [a for a in db.execute(select(Activity).where(Activity.date >= since).order_by(Activity.date)).scalars()
            if "run" in (a.activity_type or "").lower() and (a.distance_m or 0) >= 1000]


# name -> (label, unit, chart kind, fetcher(db, days) -> [(x, value)])
_SERIES: dict[str, tuple] = {
    "hrv": ("HRV (overnight)", "ms", "line", lambda db, d: _pairs(analytics.health_trend(db, d), "hrv")),
    "resting_hr": ("Resting heart rate", "bpm", "line", lambda db, d: _pairs(analytics.health_trend(db, d), "resting_hr")),
    "readiness": ("Garmin training readiness", "", "line", lambda db, d: _pairs(analytics.health_trend(db, d), "readiness")),
    "body_battery": ("Body battery (daily high)", "", "line", lambda db, d: _pairs(analytics.health_trend(db, d), "body_battery_high")),
    "stress": ("Average stress", "", "line", lambda db, d: _pairs(analytics.health_trend(db, d), "stress")),
    "steps": ("Steps", "", "bar", lambda db, d: _pairs(analytics.health_trend(db, d), "steps")),
    "sleep_hours": ("Sleep duration", "h", "bar", lambda db, d: _pairs(analytics.sleep_trend(db, d), "total_h")),
    "sleep_score": ("Sleep score", "", "line", lambda db, d: _pairs(analytics.sleep_trend(db, d), "score")),
    "weight": ("Body weight (7-day trend)", "kg", "line", lambda db, d: _pairs(weight_svc.trend(db, d), "trend_kg")),
    "calories": ("Calories eaten", "kcal", "bar", lambda db, d: [(r["date"], r["totals"]["calories"]) for r in nutrition.trend(db, d) if r["has_entries"]]),
    "protein": ("Protein eaten", "g", "bar", lambda db, d: [(r["date"], r["totals"]["protein_g"]) for r in nutrition.trend(db, d) if r["has_entries"]]),
    "weekly_run_km": ("Weekly running distance", "km", "bar", lambda db, d: [(w["week"], w["run_km"]) for w in analytics.training_load(db, max(2, d // 7))]),
    "run_distance": ("Distance per run", "km", "bar", lambda db, d: [(a.date.isoformat(), round(a.distance_m / 1000, 1)) for a in _runs_in(db, d)]),
    "run_pace": ("Run pace", "min/km", "line", lambda db, d: [(a.date.isoformat(), round(a.avg_pace_s_per_km / 60, 2)) for a in _runs_in(db, d) if a.avg_pace_s_per_km]),
    "fitness": ("Fitness (CTL)", "", "line", lambda db, d: _pairs(analytics.training_stress_balance(db, d), "fitness")),
    "fatigue": ("Fatigue (ATL)", "", "line", lambda db, d: _pairs(analytics.training_stress_balance(db, d), "fatigue")),
    "form": ("Form (fitness minus fatigue)", "", "line", lambda db, d: _pairs(analytics.training_stress_balance(db, d), "form")),
    "recovery": ("Recovery score", "%", "line", lambda db, d: _pairs(performance.load(db, d)["series"], "recovery")),
    "strain": ("Day strain", "/21", "bar", lambda db, d: _pairs(performance.load(db, d)["series"], "strain")),
}
_METRIC_ENUM = sorted(_SERIES)


def _series(db: Session, metric: str, days: int) -> dict:
    if metric not in _SERIES: raise ValueError(f"unknown metric '{metric}'. Options: {', '.join(_METRIC_ENUM)}")
    label, unit, kind, fetch = _SERIES[metric]
    pts = [{"date": x, "value": round(v, 2)} for x, v in fetch(db, max(2, min(int(days), 365))) if v is not None]
    stats = {}
    if pts:
        vals = [p["value"] for p in pts]
        stats = {"first": vals[0], "last": vals[-1], "min": min(vals), "max": max(vals),
                 "avg": round(sum(vals) / len(vals), 2), "change": round(vals[-1] - vals[0], 2), "n": len(vals)}
    return {"metric": metric, "label": label, "unit": unit, "kind": kind, "points": pts, "stats": stats}


# --------------------------------------------------------------------------- read tools
@tool("read", "Everything about right now in one call: Garmin snapshot, recovery score, today's training call, today's planned sessions, "
              "sleep debt, open alerts, nutrition and water so far today, injuries, race verdict, data freshness. Start here for any open question.")
def overview(ctx: Ctx):
    db = ctx.db
    rec = performance.load(db, 7)
    plan = phase2.daily_plan(db)
    rr = race_readiness.assess(db)
    return {
        "today": date.today().isoformat(), "snapshot": analytics.snapshot(db), "recovery": rec["latest_scored"], "sleep_tonight": rec["tonight"],
        "training_call": analytics.todays_call(db), "overtraining_risk": analytics.overtraining_risk(db),
        "plan_today": plan["scheduled_sessions"], "suggested_actions": plan["actions"], "checkins_today": plan["checkins"],
        "sleep_debt_7d": analytics.sleep_debt(db, days=7),
        "alerts": [a for a in phase2.anomaly_inbox(db) if a["status"] == "open"],
        "nutrition_today": nutrition.day_summary(db, date.today()), "nutrition_goal": nutrition.get_goal(db),
        "water": phase2.water_today(db), "injuries": injury_svc.list_all(db),
        "race": rr and {k: rr[k] for k in ("race", "verdict", "label", "headline", "flags")},
        "all_races": cardio_extras.list_races(db),
        "freshness": analytics.data_freshness(db),
    }


@tool("read", "Honest feasibility check for the next upcoming race (or the race named in `name` when several are on file): long-run coverage vs what the distance needs, projected best long run before race day, "
              "weekly volume, flags, injury impact, estimated finish range, and a day-by-day bridge plan to race day.",
      name=("string", "race name, only when the owner means a race other than the next one"))
def race_readiness_report(ctx: Ctx, name: str | None = None):
    return race_readiness.assess(ctx.db, race_name=name) or {"error": "No upcoming race found. Offer to add one with set_race_goal."}


@tool("read", "A metric's daily/weekly values plus first/last/min/max/avg/change. Use it to answer trend questions with real numbers. "
              "Pass the same metric to show_chart to display it.",
      **{"metric!": ("string", "Which series", _METRIC_ENUM), "days": ("integer", "Lookback in days (default 30, max 365)")})
def get_series(ctx: Ctx, metric: str, days: int = 30):
    s = _series(ctx.db, metric, days)
    return {k: s[k] for k in ("metric", "label", "unit", "stats")} | {"points": s["points"][-40:]}


@tool("read", "Recent Garmin activities (runs, hikes, rides, strength...), newest first.",
      limit=("integer", "How many (default 10)"), kind=("string", "Filter", ["run", "strength", "walk_hike", "ride", "all"]))
def recent_activities(ctx: Ctx, limit: int = 10, kind: str = "all"):
    rows = analytics.recent_activities(ctx.db, 60)
    if kind != "all": rows = [r for r in rows if r["category"] == kind]
    return rows[:max(1, min(int(limit), 30))]


@tool("read", "Running analysis over weeks: efficiency, pace bands, best efforts, aerobic decoupling.", weeks=("integer", "default 12"))
def run_analysis(ctx: Ctx, weeks: int = 12):
    return analytics.run_insights(ctx.db, int(weeks)) or {"error": "not enough runs yet"}


@tool("read", "Weekly training load: run km, run minutes, strength volume per week.", weeks=("integer", "default 8"))
def training_load(ctx: Ctx, weeks: int = 8):
    return {"weeks": analytics.training_load(ctx.db, int(weeks)), "overload_warnings": cardio_extras.overload_warnings(ctx.db, int(weeks)),
            "acute_chronic": analytics.training_load_ratio(ctx.db)}


@tool("read", "Strength training summary (volume, top lifts, frequency) and which muscles are fresh vs recently trained.", weeks=("integer", "default 8"))
def strength(ctx: Ctx, weeks: int = 8):
    return {"summary": analytics.strength_summary(ctx.db, int(weeks)), "muscle_recency": analytics.muscle_recency(ctx.db),
            "this_week": analytics.strength_this_week(ctx.db), "preservation": phase2.strength_preservation(ctx.db)}


@tool("read", "The planned training week (sessions with ids, status, targets), adherence, deload advice. Defaults to this week.",
      start=("string", "Any date inside the week, YYYY-MM-DD"))
def week_plan(ctx: Ctx, start: str | None = None):
    w = planner.week(ctx.db, date.fromisoformat(start) if start else None)
    return {k: w[k] for k in ("start", "end", "sessions", "adherence_pct", "completed", "due", "deload", "settings")}


@tool("read", "Nutrition: a day's meals and totals, the last N days of intake, targets, and the macro recommendation.",
      date=("string", "YYYY-MM-DD, default today"), days=("integer", "Trend window, default 7"))
def nutrition_report(ctx: Ctx, date: str | None = None, days: int = 7):  # noqa: A002 (tool arg name is user-facing)
    d = _date(date)
    return {"day": nutrition.day_summary(ctx.db, d), "trend": nutrition.trend(ctx.db, int(days)), "goal": nutrition.get_goal(ctx.db),
            "macro_recommendation": weight_svc.macro_recommendation(ctx.db)}


@tool("read", "Weight: recent weigh-ins with 7-day trend, the cut/bulk goal, and the projected rate and ETA.", days=("integer", "default 28"))
def weight_report(ctx: Ctx, days: int = 28):
    return {"trend": weight_svc.trend(ctx.db, int(days)), "goal": weight_svc.get_goal(ctx.db), "projection": weight_svc.weight_projection(ctx.db, int(days))}


@tool("read", "Sleep: nightly detail, consistency, and debt over a window.", days=("integer", "default 14"))
def sleep_report(ctx: Ctx, days: int = 14):
    return {"nights": analytics.sleep_trend(ctx.db, int(days)), "consistency": analytics.sleep_consistency(ctx.db, int(days)),
            "debt": analytics.sleep_debt(ctx.db, days=int(days))}


@tool("read", "Projected form/fatigue for the next 7 days if the planned sessions are done.")
def recovery_forecast(ctx: Ctx):
    return planner.recovery_forecast(ctx.db)


@tool("read", "All injuries including resolved ones.")
def injuries(ctx: Ctx):
    return injury_svc.list_all(ctx.db, include_resolved=True)


def _date(s: str | None) -> date:
    return date.fromisoformat(s) if s else date.today()


# --------------------------------------------------------------------------- write tools (reversible, run immediately)
@tool("write", "Log a meal. Estimate macros yourself if the owner only describes the food, and say they are estimates.",
      **{"name!": ("string", "Meal name"), "calories!": ("number", "kcal"), "protein_g": ("number", "g"), "carbs_g": ("number", "g"),
         "fat_g": ("number", "g"), "fiber_g": ("number", "g"), "meal_type": ("string", "", ["breakfast", "lunch", "dinner", "snack"]),
         "date": ("string", "YYYY-MM-DD, default today")})
def log_meal(ctx: Ctx, **a):
    body = MealBody(**a).model_dump(mode="json", exclude_none=True)
    m = nutrition.add_meal(ctx.db, body)
    ctx.done(f"Logged {m['name']} ({round(m['calories'] or 0)} kcal)")
    return {"logged": m, "today": nutrition.day_summary(ctx.db, _date(a.get("date")))["totals"]}


@tool("write", "Add water to today's hydration log.", **{"amount_ml!": ("integer", "millilitres, 1-5000")})
def log_water(ctx: Ctx, amount_ml: int):
    t = phase2.log_water(ctx.db, WaterBody(amount_ml=amount_ml).amount_ml)
    ctx.done(f"Logged {amount_ml} ml water ({t['total_ml']} ml today)")
    return t


@tool("write", "Log a weigh-in.", **{"weight_kg!": ("number", "kg"), "date": ("string", "YYYY-MM-DD, default today"),
                                     "body_fat_pct": ("number", "optional")})
def log_weight(ctx: Ctx, **a):
    b = WeightBody(**a)
    row = weight_svc.add_weight(ctx.db, b.date or date.today(), b.weight_kg, b.body_fat_pct, b.notes)
    ctx.done(f"Logged weight {b.weight_kg:g} kg")
    return row


@tool("write", "Save a subjective check-in (1-5 scales) or set a context mode such as injured, sick or travel.",
      phase=("string", "morning or evening, default by time of day", ["morning", "evening"]), energy=("integer", "1-5"), soreness=("integer", "1-5"),
      mood=("integer", "1-5"), stress=("integer", "1-5"), hunger=("integer", "1-5"),
      context_mode=("string", "", ["normal", "sick", "travel", "fasting", "injured"]), notes=("string", "free text"))
def log_checkin(ctx: Ctx, **a):
    a.setdefault("phase", "morning" if datetime.now().hour < 14 else "evening")
    row = phase2.save_checkin(ctx.db, a)
    ctx.done(f"Saved {row['phase']} check-in")
    return row


@tool("write", "Record a new injury. This immediately changes the planner (e.g. a wrist injury stops upper-body/grip sessions) and the race verdict. "
               "Ask for side and onset date first if the owner has not said.",
      **{"area!": ("string", "e.g. 'wrist (TFCC)', 'left knee'"), "side": ("string", "take it from the owner's words", ["left", "right", "both"]), "started": ("string", "YYYY-MM-DD onset"),
         "pain": ("integer", "current pain 0-10"), "restrictions": {"type": "array", "items": {"type": "string"}, "description": "Plain-language limits for training"},
         "notes": ("string", "diagnosis, what aggravates it, what the clinician said")})
def add_injury(ctx: Ctx, **a):
    row = injury_svc.add(ctx.db, a)
    ctx.done(f"Logged injury: {row['area']}")
    return row


@tool("write", "Update an injury: status (active/recovering/resolved), pain 0-10, restrictions, notes.",
      **{"id!": ("integer", "injury id"), "status": ("string", "", ["active", "recovering", "resolved"]), "pain": ("integer", "0-10"),
         "restrictions": {"type": "array", "items": {"type": "string"}}, "notes": ("string", "")})
def update_injury(ctx: Ctx, id: int, **a):  # noqa: A002
    row = injury_svc.update(ctx.db, id, a)
    ctx.done(f"Updated injury: {row['area']} is {row['status']}")
    return row


@tool("write", "Add a race (several can be on file; the soonest is the one tracked). Saving a race with an existing name updates it. Any distance works; the verdict and bridge plan recompute immediately.",
      **{"name!": ("string", ""), "race_date!": ("string", "YYYY-MM-DD"), "distance_km!": ("number", "e.g. 25"), "target_time_min": ("number", "optional goal time in minutes")})
def set_race_goal(ctx: Ctx, name: str, race_date: str, distance_km: float, target_time_min: float | None = None):
    kind = cardio_extras.distance_type_for(float(distance_km))
    body = RaceGoalBody(name=name, race_date=race_date, distance_type=kind, distance_km=distance_km,
                        target_time_s=round(target_time_min * 60) if target_time_min else None)
    race = cardio_extras.set_race_goal(ctx.db, body.name, body.race_date, body.distance_type, body.target_time_s, body.distance_km)
    ctx.done(f"Race set: {race['name']}, {race['distance_label']} on {race['race_date']}")
    return race


_SESSION_ITEM = {"type": "object", "properties": {
    "date": {"type": "string", "description": "YYYY-MM-DD"},
    "kind": {"type": "string", "enum": ["run", "strength", "recovery", "rest", "race"]},
    "title": {"type": "string"}, "details": {"type": "string"},
    "distance_km": {"type": "number"}, "duration_min": {"type": "number"}}, "required": ["date", "kind", "title"]}


def _write_sessions(db: Session, sessions: list[dict]) -> int:
    """Replace whatever is still 'planned' on each given date with these sessions."""
    dates = {date.fromisoformat(s["date"]) for s in sessions}
    for r in db.execute(select(PlannedSession).where(PlannedSession.date.in_(dates), PlannedSession.status == "planned")).scalars():
        db.delete(r)
    for s in sessions:
        kind = s["kind"]
        stored = {"race": "run", "rest": "recovery"}.get(kind, kind)
        km = s.get("distance_km")
        target = {"distance_km": km, "effort": "race" if kind == "race" else "easy"} if kind in ("run", "race") and km else \
                 {"duration_min": s["duration_min"]} if s.get("duration_min") else None
        db.add(PlannedSession(date=date.fromisoformat(s["date"]), kind=stored, title=str(s["title"])[:128], details=(s.get("details") or None),
                              target=target, planned_load=round(km * 10) if km else 35 if kind == "strength" else 5, source="coach"))
    db.commit()
    return len(sessions)


@tool("write", "Write sessions into the owner's training plan. Replaces any not-yet-done planned sessions on those dates. Use for bridge plans, "
               "race-week plans, or moving/adding a single session.", **{"sessions!": {"type": "array", "items": _SESSION_ITEM, "description": "Sessions to schedule"}})
def schedule_sessions(ctx: Ctx, sessions: list):
    n = _write_sessions(ctx.db, sessions)
    ctx.done(f"Scheduled {n} session{'s' if n != 1 else ''} on your plan")
    return {"scheduled": n}


@tool("write", "Mark a planned session completed/skipped/planned or move it to another date.",
      **{"id!": ("integer", "planned session id from week_plan"), "status": ("string", "", ["planned", "completed", "skipped"]), "date": ("string", "new YYYY-MM-DD")})
def update_plan_session(ctx: Ctx, id: int, **a):  # noqa: A002
    r = planner.update_session(ctx.db, id, a)
    ctx.done(f"Plan session {r['status']} on {r['date']}")
    return r


@tool("write", "Rebuild this week's adaptive plan from current data. Sessions the Coach scheduled itself are kept.")
def regenerate_week_plan(ctx: Ctx):
    w = planner.regenerate(ctx.db)
    ctx.done("Rebuilt this week's plan")
    return {"sessions": w["sessions"]}


@tool("write", "Change how many run/strength days the planner uses, and the long-run and rest weekday (Monday=0).",
      run_days=("integer", "1-6"), strength_days=("integer", "1-6"), long_run_weekday=("integer", "0-6"), preferred_rest_weekday=("integer", "0-6"))
def set_planner_settings(ctx: Ctx, **a):
    s = planner.update_settings(ctx.db, a)
    ctx.done("Updated planner settings")
    return s


@tool("write", "Pin a note on the health timeline (illness, travel, new meds, injury event) so trends can be read in context.",
      **{"label!": ("string", "short"), "category": ("string", "e.g. illness, travel, injury, other"), "date": ("string", "YYYY-MM-DD"), "notes": ("string", "")})
def add_timeline_note(ctx: Ctx, **a):
    r = lab.add_annotation(ctx.db, a)
    ctx.done(f"Added timeline note: {r['label']}")
    return r


@tool("write", "Remember a durable fact or preference about the owner (diet, schedule, goals, equipment). Not for one-off data.",
      **{"note!": ("string", "one concise sentence")})
def remember(ctx: Ctx, note: str):
    old = insights.get_memory(ctx.db)
    if note.strip().lower() in old.lower(): return {"saved": False, "reason": "already known"}
    insights.set_memory(ctx.db, (old + "\n" + note.strip()).strip())
    ctx.done("Remembered: " + note.strip()[:80])
    return {"saved": True}


@tool("write", "Pull fresh data from Garmin and Hevy in the background (about a minute).")
def sync_now(ctx: Ctx):
    from . import sync
    threading.Thread(target=sync.sync_all, args=(7,), daemon=True).start()
    ctx.done("Started a Garmin + Hevy sync")
    return {"started": True}


# --------------------------------------------------------------------------- confirm tools (only run when the owner clicks)
@tool("confirm", "Delete a logged meal.", **{"meal_id!": ("integer", "")})
def delete_meal(ctx: Ctx, meal_id: int):
    if not nutrition.delete_meal(ctx.db, meal_id): raise ValueError("meal not found")
    ctx.done("Deleted meal")
    return {"deleted": meal_id}


@tool("confirm", "Delete a weigh-in.", **{"date!": ("string", "YYYY-MM-DD")})
def delete_weight(ctx: Ctx, date: str):  # noqa: A002
    if not weight_svc.delete_weight(ctx.db, _date(date)): raise ValueError("no weigh-in on that date")
    ctx.done(f"Deleted weigh-in for {date}")
    return {"deleted": date}


@tool("confirm", "Remove a race from the list. Give its name when more than one race is on file.",
      name=("string", "name of the race to remove"))
def clear_race_goal(ctx: Ctx, name: str | None = None):
    races = cardio_extras.list_races(ctx.db)
    hit = [r for r in races if name and r["name"].strip().lower() == name.strip().lower()] or (races if len(races) == 1 else [])
    if not hit:
        return {"error": "Several races are on file; say which one to remove.", "races": [r["name"] for r in races]}
    cardio_extras.clear_race_goal(ctx.db, hit[0]["id"])
    ctx.done(f"Removed race {hit[0]['name']}")
    return {"cleared": hit[0]["name"]}


# --------------------------------------------------------------------------- ui tools (what the owner sees)
@tool("ui", "Show a real chart of a metric. Data is fetched server-side, never type values yourself. Add `target` for a reference line "
            "(e.g. the long run a race needs).", **{"metric!": ("string", "", _METRIC_ENUM), "days": ("integer", "default 30"),
                                                    "title": ("string", "optional heading"), "target": ("number", "optional reference line value"),
                                                    "target_label": ("string", "label for the reference line")})
def show_chart(ctx: Ctx, metric: str, days: int = 30, title: str | None = None, target: float | None = None, target_label: str | None = None):
    s = _series(ctx.db, metric, days)
    if len(s["points"]) < 2: return {"error": "not enough data points to chart"}
    ctx.emit({"type": "chart", "title": title or s["label"], "metric": metric, "unit": s["unit"], "kind": s["kind"],
              "points": s["points"], "target": target, "target_label": target_label})
    return {"shown": True, "stats": s["stats"]}


@tool("ui", "Show 2-4 headline numbers as tiles. tone colours the tile: good, warn, bad or neutral.",
      **{"items!": {"type": "array", "items": {"type": "object", "properties": {
          "label": {"type": "string"}, "value": {"type": "string"}, "unit": {"type": "string"}, "note": {"type": "string"},
          "tone": {"type": "string", "enum": ["good", "warn", "bad", "neutral"]}}, "required": ["label", "value"]}}})
def show_stats(ctx: Ctx, items: list):
    ctx.emit({"type": "stats", "items": items[:6]})
    return {"shown": True}


@tool("ui", "Show a dated list of sessions/steps. Set apply=true to add an 'Add to my plan' button that writes the rows into the planner "
            "(rows then need kind run|strength|recovery|rest|race).",
      **{"title!": ("string", ""), "rows!": {"type": "array", "items": _SESSION_ITEM}, "apply": ("boolean", "offer the add-to-plan button")})
def show_plan(ctx: Ctx, title: str, rows: list, apply: bool = False):
    block = {"type": "plan", "title": title, "rows": rows}
    if apply: block["apply"] = {"label": "Add to my plan", "tool": "schedule_sessions", "args": {"sessions": rows}}
    ctx.emit(block)
    return {"shown": True}


@tool("ui", "Highlight one important point (a warning, a verdict, a caveat).",
      **{"tone!": ("string", "", ["info", "good", "warn", "bad"]), "title!": ("string", "5 words or fewer"), "text!": ("string", "one or two sentences")})
def show_callout(ctx: Ctx, tone: str, title: str, text: str):
    ctx.emit({"type": "callout", "tone": tone, "title": title, "text": text})
    return {"shown": True}


@tool("ui", "Offer 1-3 buttons. Each does exactly one thing: run a write/confirm tool with fixed args (label says what it does), open a screen "
            "(`view`: dashboard, planner, training, strength, sleep, nutrition, lab, reports, settings), or send a follow-up question (`prompt`). "
            "Destructive tools (kind confirm) are only ever run through a button.",
      **{"actions!": {"type": "array", "items": {"type": "object", "properties": {
          "label": {"type": "string"}, "tool": {"type": "string"}, "args": {"type": "object"},
          "view": {"type": "string"}, "prompt": {"type": "string"}}, "required": ["label"]}}})
def offer_actions(ctx: Ctx, actions: list):
    items = []
    for a in actions[:3]:
        t = TOOLS.get(a.get("tool") or "")
        if a.get("tool") and not (t and t.kind in ("write", "confirm")): continue
        item = {"label": str(a["label"])[:60], "tool": a.get("tool"), "args": a.get("args") or {}, "view": a.get("view"),
                "prompt": a.get("prompt"), "confirm": bool(t and t.kind == "confirm")}
        key = json.dumps([item["tool"], item["args"]], sort_keys=True, default=str)
        if item["tool"] and key in ctx.offered: continue  # the same button was already shown this turn
        if item["tool"]: ctx.offered.add(key)
        items.append(item)
    if items: ctx.emit({"type": "actions", "items": items})
    return {"shown": len(items)}


@tool("ui", "Show up to 3 short follow-up questions the owner can tap.", **{"options!": {"type": "array", "items": {"type": "string"}}})
def suggest_replies(ctx: Ctx, options: list):
    ctx.emit({"type": "replies", "items": [str(o)[:80] for o in options[:3]]})
    return {"shown": True}


@tool("ui", "Call this when the reply needs no chart, plan, tiles, callout or buttons.")
def nothing_to_add(ctx: Ctx):
    return {"ok": True}


def execute(db: Session, name: str, args: dict) -> dict:
    """Run a write/confirm tool on behalf of a button click."""
    t = TOOLS.get(name)
    if not t or t.kind not in ("write", "confirm"): raise ValueError("not an executable action")
    ctx = Ctx(db)
    out = json.loads(ctx.run(name, args, trusted=True))
    if isinstance(out, dict) and "error" in out and len(out) == 1: raise ValueError(out["error"])
    return {"ok": True, "summary": ctx.notes[-1] if ctx.notes else "Done", "result": out}


# --------------------------------------------------------------------------- prompt
SYSTEM = """You are Pulse Coach, the intelligence inside the owner's personal health app (Garmin + Hevy + nutrition + planner).
You can read all of the app's data with tools, change it with action tools, and show charts, tiles, plans and buttons. Use them.

HOW TO ANSWER
- Verdict first. The first sentence answers the question or gives the recommendation, with the number behind it. No greeting, no restating the question, no sign-off, no emoji, no praise or pep talk.
- Be specific: dates, distances, HRV against baseline, pace. "Your recovery looks good" is a failure; "Recovery 71 (HRV 52 vs 46 baseline)" is the standard. If you cannot be specific, you have not looked: call a tool.
- Answer what was asked, plus at most one thing they did not ask but must know. Do not recap today's training, protein or sleep unless that is the question.
- Short. Usually 40-120 words. Do not narrate numbers a chart or tile already shows. Use a block when it beats a paragraph; use none when a sentence will do.
- Separate what the data says from what you infer, and say what is missing (no run logged is not the same as no run done). Never invent data. Do not claim an action unless a tool call succeeded. A plan you propose is only proposed (it arrives with an "Add to my plan" button): say "here is a plan", never "I've created/added it".
- Do not announce tool use ("let me check"). Just call the tools, then answer.

HOW TO THINK
- Safety first: injury, then illness, then the race, then everything else. You are not a doctor. Give conservative, sport-level guidance, and send loading decisions and red flags (numbness, night pain, swelling, pain that is rising or radiating, loss of grip) to a physio or hand/sports doctor. If the owner has an upper-limb injury such as a wrist problem (TFCC): running itself is usually compatible, but flag handheld bottles (use a vest), planks, push-ups, gym grip work, and any fall risk.
- Be honest about feasibility. If the data says a goal is at risk, say so plainly, then lay out the real options (for example: run/walk the distance, drop to a shorter one, defer) and say which you recommend and why. Never reassure without evidence.
- Race timing beats the daily recovery call. Inside ~10 days of a race, never recommend a new hard session or a jump in volume: fitness cannot be built that late, only lost or injured. Good recovery numbers then mean "stay fresh", not "train hard".
- Be proactive. After answering, surface the one or two things the owner did not ask but needs: a planned session that conflicts with an injury, a race with no plan, a missing check-in, stale data. Check overview or race_readiness_report before saying anything about readiness, the plan, or the race.
- Act, don't instruct. If the owner states something that implies a change (food eaten, an injury, a race, "move my run", a preference), do it with the tool and confirm in one line. Ask only for details you truly cannot infer, all in one message. Destructive changes (deleting a meal, weigh-in or race) need the item's id from a lookup first (nutrition_report, weight_report), then say plainly what will be deleted; the confirm button is attached for you.
- When an injury is mentioned and none is logged, log it (convert "3 weeks ago" to a date), then re-check the plan and race.
- Several races can be on file (all_races in overview); the soonest upcoming one is the one tracked. If the owner mentions a race that is not on file, or whose date or distance differs, add or fix it with set_race_goal first (the same name updates it), then assess that race by name. Never replace one race with another unless they ask. Never talk about a race distance that is not the owner's.

BLOCKS. Your text is only the short verdict and advice. Plans, charts, tiles, callouts and buttons are attached in a second step after you finish writing, built from your reply and the tool results. So in the text never write dated lists, tables, step lists or "would you like me to..." lines; say the thing once and let the blocks carry the detail. Never refer to the blocks ("I'll show", "see below", "here is a chart"). Because a chart is attached when you discuss a trend, give only the takeaway (direction, latest value against baseline) and leave min/max/average to the chart; do not recite numbers a tile would show.

EXAMPLE of the standard. Owner: "will I be ok for my 25k?" You call race_readiness_report, then reply only:
"Not ready to run 25 km continuously. Your longest run in 6 weeks is 6.0 km (24% of the distance) and 9 days leaves room for one more ~7 km long run at most. Fitness can't be built now, only protected. Realistic options: run/walk it (recommended), drop to the half, or defer."
The second step then attaches a callout, the bridge plan with an "Add to my plan" button, and a button for the next step.

FORMAT: light Markdown. Bullets only for three or more parallel items. Units: km, kg, min/km, 24-hour dates like "Sat 19 Oct"."""

BRIEFING_PROMPT = (
    "Write my briefing for today. Call overview and race_readiness_report first. Write at most 70 words of prose, no lists: "
    "sentence 1 is today's call (train as planned / go easy / rest) with the two numbers that decide it; "
    "if a race is set, sentences 2-3 are the honest 'will I be OK' verdict with the longest-run and days-left numbers; "
    "if an injury is logged, one sentence on what it changes today. Nothing else. No advice about food or sleep unless a number is clearly off.")


def standing_context(db: Session, page: str | None) -> str:
    now = datetime.now()
    lines = [f"Now: {now:%A %d %B %Y, %H:%M}. The owner is on the '{page or 'coach'}' screen."]
    if mem := insights.get_memory(db): lines.append(f"Owner notes: {mem}")
    inj = injury_svc.list_all(db)
    lines.append("Injuries: " + ("; ".join(f"[{i['id']}] {i['area']} {i['side'] or ''} {i['status']}, day {i['days_since_onset']}, pain {i['pain']}/10, limits: {', '.join(i['restrictions'])}"
                                            for i in inj) if inj else "none logged"))
    rr = race_readiness.assess(db)
    lines.append(f"Race: {rr['race']['name']} {rr['race']['distance_km']:g} km on {rr['race']['race_date']} ({rr['race']['days_left']} days). "
                 f"Verdict: {rr['label']}. {rr['headline']}" if rr else "Race: none set")
    last = db.scalar(select(func.max(Activity.date)))
    lines.append(f"Latest synced activity: {last or 'none'}.")
    return "\n".join(lines)


def _history(db: Session, scope: str, limit: int = 14) -> list[dict]:
    rows = list(reversed(db.execute(select(Insight).where(Insight.scope == scope).order_by(Insight.id.desc()).limit(limit)).scalars().all()))
    out: list[dict] = []
    for r in rows:
        text = r.content + (("\n[Actions taken: " + "; ".join(n for n in (r.blocks or []) if isinstance(n, str)) + "]") if False else "")
        if out and out[-1]["role"] == r.role: out[-1]["content"] += "\n" + text
        else: out.append({"role": r.role, "content": text})
    while out and out[0]["role"] != "user": out.pop(0)
    return out


COMPOSE = ("Now attach blocks, tools only, no new prose. Attach ONLY what your reply above actually discussed. If it was a simple confirmation "
           "(something logged or changed) or a short answer, call nothing_to_add. Never add a plan, chart or callout the reply did not mention. "
           "show_plan: only when the reply refers to a plan; copy its rows from the tool results (race_readiness_report.bridge_plan, week_plan) "
           "or from sessions the reply itself described, never invent sessions or intensities; set apply=true when it is a proposal for the owner's plan. "
           "show_chart: only for a trend the reply discussed (target = reference line). show_stats: up to 4 numbers the reply cited. "
           "show_callout: the one warning the reply made. offer_actions: only a next step that follows from the reply, each button doing exactly what "
           "its label says (tool+args, view or prompt). Otherwise suggest_replies with 2-3 natural follow-ups, or nothing_to_add.")

_STATUS = {"overview": "Reading today's numbers", "race_readiness_report": "Assessing race readiness", "get_series": "Pulling the trend",
           "recent_activities": "Checking recent sessions", "run_analysis": "Analysing your runs", "week_plan": "Reading your plan",
           "nutrition_report": "Checking nutrition", "sleep_report": "Checking sleep", "weight_report": "Checking weight",
           "strength": "Reviewing strength work", "training_load": "Reviewing training load", "recovery_forecast": "Forecasting recovery",
           "injuries": "Checking injuries"}


def _status(name: str, kind: str) -> str | None:
    if kind == "ui": return None
    return _STATUS.get(name) or ("Updating the app" if kind in ("write", "confirm") else name.replace("_", " "))


# --------------------------------------------------------------------------- provider loops
def _drain(ctx: Ctx) -> Iterator[dict]:
    while ctx.events:
        yield {"t": "block", "b": ctx.events.pop(0)}


def _tool_events(ctx: Ctx, name: str) -> Iterator[dict]:
    t = TOOLS.get(name)
    if t and (s := _status(name, t.kind)): yield {"t": "status", "text": s}


def _specs():
    ui = [t for t in TOOLS.values() if t.kind == "ui"]
    main = [t for t in TOOLS.values() if t.kind != "ui"]  # blocks are attached in the compose step, never mid-reasoning
    return main, ui


def _anthropic_loop(ctx: Ctx, system: str, history: list[dict]) -> Iterator[dict]:
    client = insights._anthropic_client()
    fmt = lambda ts: [{"name": t.name, "description": t.desc, "input_schema": t.params} for t in ts]
    main, ui = _specs()
    msgs, composing, last_text = list(history), False, ""
    for _ in range(MAX_STEPS + 1):
        kw = {"tools": fmt(ui), "tool_choice": {"type": "any"}} if composing else {"tools": fmt(main)}
        with client.messages.stream(model=settings.anthropic_model, max_tokens=2000, system=system, messages=msgs, **kw) as s:
            for chunk in ([] if composing else s.text_stream):
                last_text += chunk
                yield {"t": "text", "d": chunk}
            final = s.get_final_message()
        uses = [b for b in final.content if b.type == "tool_use"]
        if composing:
            for u in uses: ctx.run(u.name, u.input)
            yield from _drain(ctx)
            return
        if not uses:
            if ctx.ui_shown or not last_text.strip(): return
            msgs += [{"role": "assistant", "content": last_text}, {"role": "user", "content": COMPOSE}]
            composing = True
            continue
        msgs.append({"role": "assistant", "content": [
            {"type": "text", "text": b.text} if b.type == "text" else {"type": "tool_use", "id": b.id, "name": b.name, "input": b.input}
            for b in final.content if b.type in ("text", "tool_use") and (b.type != "text" or b.text)]})
        results = []
        for u in uses:
            yield from _tool_events(ctx, u.name)
            results.append({"type": "tool_result", "tool_use_id": u.id, "content": ctx.run(u.name, u.input)})
            yield from _drain(ctx)
        msgs.append({"role": "user", "content": results})
        last_text = ""


def _openai_loop(ctx: Ctx, system: str, history: list[dict]) -> Iterator[dict]:
    client = insights._openai_client()
    fmt = lambda ts: [{"type": "function", "function": {"name": t.name, "description": t.desc, "parameters": t.params}} for t in ts]
    main, ui = _specs()
    msgs, composing = [{"role": "system", "content": system}] + history, False
    for _ in range(MAX_STEPS + 1):
        kw = {"tools": fmt(ui), "tool_choice": "required"} if composing else {"tools": fmt(main)}
        stream = client.chat.completions.create(model=settings.openai_model, max_tokens=2000, messages=msgs, stream=True, **kw)
        text, calls = "", {}
        for ch in stream:
            if not ch.choices: continue
            d = ch.choices[0].delta
            if d.content and not composing:
                text += d.content
                yield {"t": "text", "d": d.content}
            for tc in d.tool_calls or []:
                c = calls.setdefault(tc.index, {"id": "", "name": "", "args": ""})
                c["id"] = tc.id or c["id"]
                if tc.function:
                    c["name"] += tc.function.name or ""
                    c["args"] += tc.function.arguments or ""
        args_of = lambda c: json.loads(c["args"] or "{}") if _valid_json(c["args"]) else {}
        if composing:
            for c in calls.values(): ctx.run(c["name"], args_of(c))
            yield from _drain(ctx)
            return
        if not calls:
            if ctx.ui_shown or not text.strip(): return
            msgs += [{"role": "assistant", "content": text}, {"role": "user", "content": COMPOSE}]
            composing = True
            continue
        msgs.append({"role": "assistant", "content": text or None, "tool_calls": [
            {"id": c["id"], "type": "function", "function": {"name": c["name"], "arguments": c["args"] or "{}"}} for c in calls.values()]})
        for c in calls.values():
            yield from _tool_events(ctx, c["name"])
            msgs.append({"role": "tool", "tool_call_id": c["id"], "content": ctx.run(c["name"], args_of(c))})
            yield from _drain(ctx)


def _valid_json(s: str) -> bool:
    try:
        json.loads(s or "{}")
        return True
    except json.JSONDecodeError:
        return False


# --------------------------------------------------------------------------- turn
def run_turn(db: Session, message: str, page: str | None = None, provider: str | None = None,
             scope: str = CHAT_SCOPE, use_history: bool = True) -> Iterator[dict]:
    """Yield stream events; persists the user message (chat only) and the assistant reply."""
    history = _history(db, scope) if scope == CHAT_SCOPE and use_history else []
    if scope == CHAT_SCOPE: db.add(Insight(scope=scope, role="user", content=message)); db.commit()
    if history and history[-1]["role"] == "user": history.pop()  # an earlier question that never got a reply
    history.append({"role": "user", "content": message})
    system = SYSTEM + "\n\nSTANDING CONTEXT\n" + standing_context(db, page)

    ctx = Ctx(db)
    segments: list[dict] = []   # ordered blocks as the owner sees them

    def note(ev: dict) -> dict:
        if ev["t"] == "text":
            if segments and segments[-1]["type"] == "text": segments[-1]["text"] += ev["d"]
            else: segments.append({"type": "text", "text": ev["d"]})
        elif ev["t"] == "block":
            segments.append(ev["b"])
        return ev

    resolved = insights._resolve_provider(provider)
    order = [resolved] + [p for p, ok in insights.available_providers().items() if ok and p != resolved]
    errors, used = [], None
    for name in order:
        loop = _openai_loop if name == "openai" else _anthropic_loop
        started = False
        try:
            for ev in loop(ctx, system, history):
                started = True
                yield note(ev)
            used = name
            break
        except Exception as exc:
            errors.append(f"{name}: {type(exc).__name__}: {exc}")
            log.warning("agent provider %s failed: %s", name, exc)
            if started: break   # partial output already shown; do not restart under it
    if used is None and not segments:
        yield {"t": "error", "message": "; ".join(errors) or "No AI provider configured. Add OPENAI_API_KEY or ANTHROPIC_API_KEY to .env."}
        return

    text = "".join(s["text"] for s in segments if s["type"] == "text").strip()
    if ctx.notes: text += "\n[Actions taken: " + "; ".join(ctx.notes) + "]"
    row = Insight(scope=scope, role="assistant", provider=used, model=settings.openai_model if used == "openai" else settings.anthropic_model,
                  content=text or "(no reply)", blocks=segments)
    db.add(row); db.commit(); db.refresh(row)
    if errors and used is None: yield {"t": "error", "message": errors[-1]}
    yield {"t": "end", "id": row.id, "mutated": ctx.mutated}


def history_view(db: Session, limit: int = 40, scope: str = CHAT_SCOPE) -> list[dict]:
    rows = db.execute(select(Insight).where(Insight.scope == scope).order_by(Insight.id.desc()).limit(limit)).scalars().all()
    return [{"id": r.id, "role": r.role, "created_at": r.created_at.isoformat(),
             "blocks": r.blocks or [{"type": "text", "text": r.content}]} for r in reversed(rows)]


def _stale(db: Session, since: datetime) -> bool:
    """Has anything the briefing depends on changed since it was written?"""
    newest = [db.scalar(select(func.max(Injury.updated_at))), db.scalar(select(func.max(RaceGoal.created_at))),
              db.scalar(select(func.max(CoachMemory.updated_at)))]
    return any(t and t > since for t in newest)


def briefing(db: Session, force: bool = False) -> dict:
    """One proactive briefing per day, regenerated when an injury, the race or the owner's notes change."""
    if not force:
        start = datetime.combine(date.today(), datetime.min.time())
        row = db.execute(select(Insight).where(Insight.scope == BRIEFING_SCOPE, Insight.created_at >= start)
                         .order_by(Insight.id.desc()).limit(1)).scalar_one_or_none()
        if row and not _stale(db, row.created_at):
            return {"id": row.id, "created_at": row.created_at.isoformat(), "blocks": row.blocks or []}
    end = None
    for ev in run_turn(db, BRIEFING_PROMPT, page="today", scope=BRIEFING_SCOPE, use_history=False):
        if ev["t"] == "error": raise RuntimeError(ev["message"])
        if ev["t"] == "end": end = ev
    row = db.get(Insight, end["id"])
    return {"id": row.id, "created_at": row.created_at.isoformat(), "blocks": row.blocks or []}
