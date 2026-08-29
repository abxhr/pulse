"""Deterministic daily command centre: no LLM calls, only the owner's data."""
from __future__ import annotations
from collections import defaultdict
from datetime import date, datetime, timedelta
import hashlib
import math
import statistics

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import (Activity, AnomalyState, BodyWeight, CutGoal, DailyCheckIn,
                      DailyHealth, GoalPreference, Meal, NutritionDayStatus,
                      RaceGoal, Sleep, WaterLog, Workout)
from . import analytics, weight as weight_svc

DEFAULT_GOALS = [
    ("health", "Long-term health", 1), ("cut", "Lose fat sustainably", 2),
    ("race", "Half-marathon performance", 3), ("strength", "Preserve strength", 4),
    ("sleep", "Improve sleep consistency", 5),
]

def goals(db: Session) -> list[dict]:
    rows = db.execute(select(GoalPreference)).scalars().all()
    if not rows:
        for key, label, priority in DEFAULT_GOALS:
            db.add(GoalPreference(key=key, label=label, priority=priority, active=True))
        db.commit()
        rows = db.execute(select(GoalPreference)).scalars().all()
    return [{"key": r.key, "label": r.label, "priority": r.priority, "active": r.active}
            for r in sorted(rows, key=lambda x: x.priority)]

def set_goals(db: Session, items: list[dict]) -> list[dict]:
    for item in items:
        key = str(item.get("key", ""))[:32]
        if not key: continue
        row = db.get(GoalPreference, key) or GoalPreference(key=key, label=key.title())
        row.label = str(item.get("label") or row.label)[:96]
        row.priority = max(1, min(20, int(item.get("priority", row.priority or 3))))
        row.active = bool(item.get("active", True)); row.updated_at = datetime.utcnow()
        db.add(row)
    db.commit(); return goals(db)

def save_checkin(db: Session, payload: dict) -> dict:
    d = date.fromisoformat(payload.get("date") or date.today().isoformat())
    phase = payload.get("phase", "morning")
    if phase not in {"morning", "evening"}: raise ValueError("phase must be morning or evening")
    row = db.execute(select(DailyCheckIn).where(DailyCheckIn.date == d, DailyCheckIn.phase == phase)
                     .order_by(DailyCheckIn.created_at.desc())).scalars().first()
    if not row: row = DailyCheckIn(date=d, phase=phase)
    for key in ("energy", "soreness", "mood", "hunger", "stress", "plan_adherence"):
        val = payload.get(key); setattr(row, key, max(1, min(5, int(val))) if val is not None else None)
    mode = payload.get("context_mode", "normal")
    row.context_mode = mode if mode in {"normal", "sick", "travel", "fasting", "injured"} else "normal"
    row.notes = str(payload.get("notes") or "")[:1000] or None
    db.add(row); db.commit(); return serialize_checkin(row)

def serialize_checkin(r) -> dict:
    return {k: (getattr(r, k).isoformat() if k == "date" else getattr(r, k)) for k in
            ("id", "date", "phase", "energy", "soreness", "mood", "hunger", "stress", "plan_adherence", "context_mode", "notes")}

def today_checkins(db: Session) -> list[dict]:
    rows = db.execute(select(DailyCheckIn).where(DailyCheckIn.date == date.today())
                      .order_by(DailyCheckIn.created_at)).scalars().all()
    latest = {r.phase: r for r in rows}
    return [serialize_checkin(r) for r in latest.values()]

def log_water(db: Session, amount_ml: int, d: date | None = None) -> dict:
    if amount_ml < 1 or amount_ml > 5000: raise ValueError("water must be between 1 and 5000 ml")
    db.add(WaterLog(date=d or date.today(), amount_ml=amount_ml)); db.commit()
    return water_today(db, d)

def water_today(db: Session, d: date | None = None) -> dict:
    d = d or date.today(); rows = db.execute(select(WaterLog).where(WaterLog.date == d)).scalars().all()
    return {"date": d.isoformat(), "total_ml": sum(r.amount_ml for r in rows), "entries": len(rows)}

def _latest_checkin(db):
    return db.execute(select(DailyCheckIn).order_by(DailyCheckIn.date.desc(), DailyCheckIn.created_at.desc())).scalars().first()

def daily_plan(db: Session) -> dict:
    snap = analytics.snapshot(db); risk = analytics.overtraining_risk(db); check = _latest_checkin(db)
    readiness = snap.get("training_readiness")
    score = readiness if readiness is not None else max(0, 100 - (risk or {}).get("score", 25))
    reasons, constraints = [], []
    if risk and risk["score"] >= 50: score -= 20; reasons.append(risk["label"])
    if check:
        if check.energy and check.energy <= 2: score -= 15; reasons.append("low self-reported energy")
        if check.soreness and check.soreness >= 4: score -= 15; reasons.append("high soreness")
        if check.context_mode != "normal": score -= 30; constraints.append(check.context_mode)
    score = max(0, min(100, round(score)))
    intensity = "rest" if score < 30 else "easy" if score < 50 else "moderate" if score < 75 else "hard"
    actions = []
    if intensity == "rest": actions.append({"area":"training","title":"Recovery day","detail":"Walk gently and skip structured intensity.","priority":1})
    elif intensity == "easy": actions.append({"area":"training","title":"Keep training easy","detail":"Zone 1–2 cardio or technique-focused lifting; leave 3–4 reps in reserve.","priority":1})
    elif intensity == "moderate": actions.append({"area":"training","title":"Productive, controlled session","detail":"Normal volume; avoid failure and cap hard running at one quality block.","priority":1})
    else: actions.append({"area":"training","title":"High-quality day","detail":"Good window for the week's key run or progressive strength work.","priority":1})
    debt = analytics.sleep_debt(db, days=7)
    if debt["debt_hours"] > 2: actions.append({"area":"sleep","title":"Protect bedtime","detail":f"Your 7-night sleep opportunity gap is {debt['debt_hours']:.1f}h.","priority":2})
    macro = weight_svc.macro_recommendation(db)
    if macro.get("ready"): actions.append({"area":"nutrition","title":f"Aim for {round(macro.get('protein_g') or 0)}g protein", "detail":f"Calorie target {round(macro.get('target_calories') or 0)} kcal; spread protein over 3–5 meals.","priority":2})
    steps = analytics.adaptive_step_goal(db)
    if steps: actions.append({"area":"movement","title":f"Reach {steps['target']:,} steps","detail":"Use low-fatigue movement to support the cut and recovery.","priority":3})
    from . import planner
    today_sessions = [s for s in planner.week(db)["sessions"] if s["date"] == date.today().isoformat() and s["status"] != "skipped"]
    if today_sessions:
        names = " + ".join(s["title"] for s in today_sessions)
        actions.insert(0, {"area":"training","title":names,"detail":"From your adaptive weekly plan; open Plan for targets and completion controls.","priority":0})
    return {"date": date.today().isoformat(), "readiness_score": score, "intensity": intensity,
            "reasons": reasons, "constraints": constraints, "actions": sorted(actions, key=lambda x:x["priority"]),
            "checkins": today_checkins(db), "scheduled_sessions": today_sessions}

def cut_trajectory(db: Session) -> dict | None:
    goal = weight_svc.get_goal(db); projection = weight_svc.weight_projection(db, 42); rows = weight_svc.trend(db, 90)
    if not goal or not rows: return None
    complete = {r.date for r in db.execute(select(NutritionDayStatus).where(NutritionDayStatus.complete.is_(True))).scalars().all()}
    meals = db.execute(select(Meal).where(Meal.date >= date.today()-timedelta(days=30))).scalars().all()
    logged_complete = len({m.date for m in meals} & complete)
    adherence = round(logged_complete / min(30, max(1, (date.today()-max(date.today()-timedelta(days=29), date.fromisoformat(goal.get("start_date") or date.today().isoformat()))).days+1))*100)
    current = rows[-1].get("trend_kg") or rows[-1]["weight_kg"]
    target = goal.get("target_weight_kg"); rate = (projection or {}).get("weekly_rate_kg")
    desired = goal.get("weekly_rate_kg")
    on_track = bool(rate is not None and desired is not None and (rate <= desired * .7 if desired < 0 else rate >= desired * .7))
    return {"current_kg":current,"target_kg":target,"weekly_rate_kg":rate,"planned_rate_kg":desired,
            "eta":(projection or {}).get("eta_at_goal"),"nutrition_adherence_pct":adherence,"complete_days":logged_complete,
            "on_track":on_track,"remaining_kg":round(current-target,1) if target is not None else None}

def strength_preservation(db: Session) -> dict | None:
    start = date.today()-timedelta(days=84); rows=db.execute(select(Workout).where(Workout.date>=start).order_by(Workout.date)).scalars().all()
    if len(rows)<4:return None
    scores=defaultdict(list)
    for w in rows:
        for ex in w.exercises or []:
            name=(ex.get("title") or ex.get("name") or "").lower()
            best=0
            for s in ex.get("sets",[]):
                wt=float(s.get("weight_kg") or s.get("weight") or 0); reps=float(s.get("reps") or 0)
                if wt>0 and reps>0: best=max(best,wt*(1+reps/30))
            if best:scores[name].append((w.date,best))
    changes=[]
    for name, vals in scores.items():
        old=[v for d,v in vals if d<date.today()-timedelta(days=28)]; new=[v for d,v in vals if d>=date.today()-timedelta(days=28)]
        if old and new: changes.append({"exercise":name.title(),"change_pct":round((max(new)/max(old)-1)*100,1)})
    if not changes:return None
    avg=round(statistics.mean(x["change_pct"] for x in changes),1)
    return {"score":max(0,min(100,round(100+avg*4))),"average_change_pct":avg,"status":"preserved" if avg>=-3 else "at risk",
            "exercises":sorted(changes,key=lambda x:x["change_pct"])[:6],"sample_size":len(changes)}

RACE_DIST={"5k":5,"10k":10,"half_marathon":21.0975,"marathon":42.195}
def race_feasibility(db: Session) -> dict | None:
    race=db.execute(select(RaceGoal).where(RaceGoal.active.is_(True)).order_by(RaceGoal.race_date)).scalars().first()
    if not race:return None
    start=date.today()-timedelta(days=42); runs=[a for a in db.execute(select(Activity).where(Activity.date>=start)).scalars().all() if "run" in (a.activity_type or "").lower() and (a.distance_m or 0)>=1000]
    weeks=max(1,42/7); weekly=sum((a.distance_m or 0)/1000 for a in runs)/weeks; longest=max([(a.distance_m or 0)/1000 for a in runs] or [0]); freq=len(runs)/weeks
    dist=RACE_DIST.get(race.distance_type,21.0975); days_left=(race.race_date-date.today()).days
    volume_score=min(40,weekly/max(15,dist)*40); long_score=min(30,longest/(dist*.7)*30); freq_score=min(20,freq/3*20); time_score=min(10,max(0,days_left)/84*10)
    score=round(volume_score+long_score+freq_score+time_score)
    gaps=[]
    if weekly<dist:gaps.append(f"Build weekly mileage from {weekly:.1f} toward at least {dist:.0f} km")
    if longest<dist*.7:gaps.append(f"Extend long run from {longest:.1f} toward {dist*.7:.1f} km")
    if freq<3:gaps.append(f"Increase consistency from {freq:.1f} to about 3 runs/week")
    return {"name":race.name,"race_date":race.race_date.isoformat(),"days_left":days_left,"score":score,
            "label":"strong" if score>=75 else "possible" if score>=50 else "building",
            "weekly_km":round(weekly,1),"longest_km":round(longest,1),"runs_per_week":round(freq,1),"gaps":gaps}

def _detected_anomalies(db: Session) -> list[dict]:
    out=[]
    for a in analytics.anomaly_alerts(db):
        out.append({"kind":a["metric"],"title":f"{a['label']} outside baseline","detail":f"{a['value']} vs {a['baseline_mean']} baseline","severity":a["severity"]})
    risk=analytics.overtraining_risk(db)
    if risk and risk["score"]>=50: out.append({"kind":"recovery_risk","title":risk["label"],"detail":", ".join(f["factor"] for f in risk["factors"][:3]),"severity":"warn"})
    freshness=analytics.data_freshness(db)
    for key,val in (freshness.get("sources") or {}).items():
        if val.get("stale"):out.append({"kind":f"stale_{key}","title":f"{val.get('label',key)} data is stale","detail":f"Last entry: {val.get('latest_date') or 'never'}. Sync or log this source.","severity":"info"})
    for x in out:
        x["fingerprint"]=hashlib.sha1(f"{date.today()}:{x['kind']}".encode()).hexdigest()[:16]
    return out

def anomaly_inbox(db: Session) -> list[dict]:
    states={r.fingerprint:r.status for r in db.execute(select(AnomalyState)).scalars().all()}
    return [{**x,"status":states.get(x["fingerprint"],"open")} for x in _detected_anomalies(db)]

def set_anomaly(db: Session, fingerprint: str, status: str) -> dict:
    if status not in {"open","acknowledged","resolved"}:raise ValueError("invalid status")
    row=db.get(AnomalyState,fingerprint) or AnomalyState(fingerprint=fingerprint)
    row.status=status;row.updated_at=datetime.utcnow();db.add(row);db.commit();return {"fingerprint":fingerprint,"status":status}

def command_center(db: Session) -> dict:
    return {"goals":goals(db),"plan":daily_plan(db),"anomalies":anomaly_inbox(db),
            "cut":cut_trajectory(db),"strength":strength_preservation(db),"race":race_feasibility(db),"water":water_today(db)}
