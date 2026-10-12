"""Adaptive weekly planning built entirely from local health/training data."""
from __future__ import annotations
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from itertools import combinations
import math

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Activity, DailyHealth, PlannedSession, PlannerSettings, RaceGoal, Workout
from . import analytics, injury, weight as weight_svc

RUN_TYPES = {"running", "run", "trail_running", "treadmill_running", "indoor_running"}

def _week_start(d: date | None = None) -> date:
    d = d or date.today(); return d - timedelta(days=d.weekday())

def settings(db: Session) -> dict:
    row = db.get(PlannerSettings, 1)
    if not row:
        row = PlannerSettings(id=1); db.add(row); db.commit()
    return {"run_days": row.run_days, "strength_days": row.strength_days,
            "long_run_weekday": row.long_run_weekday, "preferred_rest_weekday": row.preferred_rest_weekday}

def update_settings(db: Session, payload: dict) -> dict:
    row = db.get(PlannerSettings, 1) or PlannerSettings(id=1)
    row.run_days = max(1, min(6, int(payload.get("run_days", row.run_days or 3))))
    row.strength_days = max(1, min(6, int(payload.get("strength_days", row.strength_days or 3))))
    row.long_run_weekday = max(0, min(6, int(payload.get("long_run_weekday", row.long_run_weekday or 6))))
    row.preferred_rest_weekday = max(0, min(6, int(payload.get("preferred_rest_weekday", row.preferred_rest_weekday or 4))))
    row.updated_at = datetime.utcnow(); db.add(row); db.commit(); return settings(db)

def _preferred_days(db: Session, model, count: int, exclude: set[int] | None = None) -> list[int]:
    start = date.today() - timedelta(days=84)
    rows = db.execute(select(model).where(model.date >= start)).scalars().all()
    freq = Counter(r.date.weekday() for r in rows if r.date)
    exclude = exclude or set()
    ranked = [d for d,_ in sorted(freq.items(), key=lambda x:(-x[1], x[0])) if d not in exclude]
    ranked += [d for d in range(7) if d not in exclude and d not in ranked]
    return ranked[:count]

def _preferred_run_days(db: Session, count: int, long_day: int, rest_day: int) -> list[int]:
    start = date.today() - timedelta(days=84)
    rows = db.execute(select(Activity).where(Activity.date >= start)).scalars().all()
    freq = Counter(r.date.weekday() for r in rows if r.date and "run" in (r.activity_type or "").lower())
    candidates = [d for d in range(7) if d != rest_day] if count <= 6 else list(range(7))
    choices = [c for c in combinations(candidates, min(count, len(candidates))) if long_day in c]
    if not choices:
        return sorted(candidates[:count])
    def score(days):
        # Respect real-life preference, but strongly discourage back-to-back run
        # days when the requested frequency leaves enough room to avoid them.
        adjacency = sum(1 for d in days if (d + 1) % 7 in days)
        return sum(freq.get(d, 0) * 3 for d in days) - adjacency * 20
    return list(max(choices, key=score))

def _race_context(db: Session) -> dict | None:
    race = db.execute(select(RaceGoal).where(RaceGoal.active.is_(True)).order_by(RaceGoal.race_date)).scalars().first()
    if not race: return None
    days = (race.race_date-date.today()).days
    acts = [a for a in db.execute(select(Activity).where(Activity.date >= date.today()-timedelta(days=42))).scalars().all()
            if "run" in (a.activity_type or "").lower()]
    weekly_km = sum((a.distance_m or 0)/1000 for a in acts)/6
    longest = max([(a.distance_m or 0)/1000 for a in acts] or [0])
    return {"days_left":days,"weekly_km":weekly_km,"longest_km":longest,"distance_type":race.distance_type}

def deload_advice(db: Session) -> dict:
    risk = analytics.overtraining_risk(db) or {"score":0,"factors":[]}
    tsb = analytics.training_stress_balance(db, 60)
    form = tsb[-1]["form"] if tsb else 0
    load = analytics.training_load(db, 8)
    recent = [w["run_km"] + w["strength_volume"]/1000 for w in load[-4:]]
    rising = len(recent)>=4 and all(recent[i]>=recent[i-1]*.95 for i in range(1,len(recent)))
    needed = risk["score"]>=50 or form < -20 or (rising and risk["score"]>=35)
    reasons=[]
    if risk["score"]>=50: reasons.append(f"recovery risk {risk['score']}/100")
    if form < -20: reasons.append(f"form {form:.1f} shows accumulated fatigue")
    if rising and risk["score"]>=35: reasons.append("four progressive load weeks without a clear down week")
    return {"recommended":needed,"volume_multiplier":.6 if needed else 1.0,"form":round(form,1),"reasons":reasons}

def _template(db: Session, start: date) -> list[dict]:
    cfg=settings(db); deload=deload_advice(db); mult=deload["volume_multiplier"]; race=_race_context(db)
    long_day=cfg["long_run_weekday"]
    run_days=_preferred_run_days(db, cfg["run_days"], long_day, cfg["preferred_rest_weekday"])
    strength_days=_preferred_days(db, Workout, cfg["strength_days"], set(run_days) | {cfg["preferred_rest_weekday"]})
    weekly_km=(race or {}).get("weekly_km") or 15
    target_km=max(12, weekly_km * (1.05 if not deload["recommended"] else .65))
    long_km=max(5, min(target_km*.45, ((race or {}).get("longest_km") or 8)*1.08))*mult
    remaining=max(4,target_km-long_km); easy_km=remaining/max(1,len(run_days)-1)
    sessions=[]
    ordered=sorted(run_days)
    quality_day=next((d for d in ordered if d!=long_day),ordered[0])
    for d in ordered:
        if d==long_day: title="Long easy run"; km=long_km; detail="Conversational effort. Build durability, not fatigue."
        elif d==quality_day and not deload["recommended"]: title="Quality run"; km=easy_km; detail="Warm up, one controlled tempo/interval block, cool down. Stop before form deteriorates."
        else: title="Easy aerobic run"; km=easy_km; detail="Zone 2, relaxed and repeatable."
        sessions.append({"date":start+timedelta(days=d),"kind":"run","title":title,"details":detail,
                         "target":{"distance_km":round(km,1),"effort":"easy" if "Easy" in title or "Long" in title else "quality"},"planned_load":round(km*10)})
    strength_titles=["Upper strength","Lower strength","Full-body retention","Accessory strength","Technique strength","Strength session"]
    safe=injury.constraints(db)["avoid_upper_loading"]
    if safe: strength_titles=["Lower-body strength","Single-leg + core","Lower-body strength","Core + mobility"]
    for i,d in enumerate(strength_days):
        sessions.append({"date":start+timedelta(days=d),"kind":"strength","title":strength_titles[min(i,len(strength_titles)-1)],
                         "details":("Injury-safe: legs and core only, no grip or loaded wrist/arm work. " if safe else "")+("Deload: halve hard sets and keep 4 reps in reserve." if deload["recommended"] else "Keep key compounds; finish most sets with 2–3 reps in reserve."),
                         "target":{"duration_min":round(50*mult),"rir":4 if deload["recommended"] else 2},"planned_load":round(35*mult)})
    rest=start+timedelta(days=cfg["preferred_rest_weekday"])
    sessions.append({"date":rest,"kind":"recovery","title":"Recovery focus","details":"Easy walking, mobility, food prep, and an earlier sleep opportunity.","target":{"steps":"adaptive","mobility_min":10},"planned_load":5})
    return sorted(sessions,key=lambda x:(x["date"],x["kind"]))

def ensure_week(db: Session, start: date | None = None) -> None:
    start=_week_start(start); end=start+timedelta(days=6)
    if db.execute(select(PlannedSession).where(PlannedSession.date>=start,PlannedSession.date<=end)).scalars().first(): return
    for item in _template(db,start): db.add(PlannedSession(**item))
    db.commit()

def _actuals(db: Session,start:date,end:date):
    run_days={a.date for a in db.execute(select(Activity).where(Activity.date>=start,Activity.date<=end)).scalars().all() if "run" in (a.activity_type or "").lower()}
    lift_days={w.date for w in db.execute(select(Workout).where(Workout.date>=start,Workout.date<=end)).scalars().all()}
    return run_days,lift_days

def nutrition_periodization(db: Session, sessions: list[dict]) -> list[dict]:
    macro=weight_svc.macro_recommendation(db)
    if not macro.get("ready"): return []
    base=macro["target_calories"]; protein=macro["protein_g"]
    by_day=defaultdict(list)
    for s in sessions: by_day[s["date"]].append(s["kind"])
    offsets={d:(150 if "run" in kinds and any(x.get("title")=="Quality run" or x.get("title")=="Long easy run" for x in sessions if x["date"]==d) else 75 if "strength" in kinds else -100) for d,kinds in by_day.items()}
    # Force the seven-day average to remain equal to the cut target.
    all_days=[_week_start(date.fromisoformat(sessions[0]["date"]))+timedelta(days=i) for i in range(7)] if sessions else []
    mean_offset=sum(offsets.get(d.isoformat(),-100) for d in all_days)/7 if all_days else 0
    out=[]
    for d in all_days:
        off=offsets.get(d.isoformat(),-100)-mean_offset
        kcal=round(base+off); fat=macro["fat_g"]; carbs=max(0,round((kcal-protein*4-fat*9)/4))
        out.append({"date":d.isoformat(),"calories":kcal,"protein_g":protein,"carbs_g":carbs,"fat_g":fat,
                    "day_type":"high fuel" if off>80 else "training" if off>0 else "rest/recovery"})
    return out

def week(db: Session, start: date | None = None) -> dict:
    start=_week_start(start); ensure_week(db,start); end=start+timedelta(days=6)
    rows=db.execute(select(PlannedSession).where(PlannedSession.date>=start,PlannedSession.date<=end).order_by(PlannedSession.date,PlannedSession.id)).scalars().all()
    run_days,lift_days=_actuals(db,start,end); items=[]
    for r in rows:
        auto=(r.kind=="run" and r.date in run_days) or (r.kind=="strength" and r.date in lift_days)
        effective="completed" if auto and r.status=="planned" else r.status
        items.append({"id":r.id,"date":r.date.isoformat(),"kind":r.kind,"title":r.title,"details":r.details,"target":r.target,
                      "planned_load":r.planned_load,"status":effective,"stored_status":r.status,"auto_completed":auto})
    actionable=[x for x in items if x["kind"] in {"run","strength"}]
    done=sum(x["status"]=="completed" for x in actionable); elapsed=sum(date.fromisoformat(x["date"])<=date.today() for x in actionable)
    adherence=round(done/max(1,elapsed)*100) if elapsed else None
    return {"start":start.isoformat(),"end":end.isoformat(),"sessions":items,"adherence_pct":adherence,
            "completed":done,"due":elapsed,"deload":deload_advice(db),"nutrition_targets":nutrition_periodization(db,items),"settings":settings(db)}

def update_session(db: Session, session_id:int, payload:dict)->dict:
    row=db.get(PlannedSession,session_id)
    if not row: raise ValueError("planned session not found")
    if "status" in payload:
        if payload["status"] not in {"planned","completed","skipped"}:raise ValueError("invalid status")
        row.status=payload["status"]
    if payload.get("date"): row.date=date.fromisoformat(payload["date"])
    row.updated_at=datetime.utcnow();db.commit();return {"id":row.id,"status":row.status,"date":row.date.isoformat()}

def regenerate(db:Session,start:date|None=None)->dict:
    start=_week_start(start);end=start+timedelta(days=6)
    rows=db.execute(select(PlannedSession).where(PlannedSession.date>=start,PlannedSession.date<=end)).scalars().all()
    for r in rows:
        if r.status=="planned" and r.date>=date.today() and r.source!="coach":db.delete(r)
    db.commit()
    # If past rows remain, fill only entirely absent future dates from fresh template.
    existing={(r.date,r.kind) for r in db.execute(select(PlannedSession).where(PlannedSession.date>=start,PlannedSession.date<=end)).scalars().all()}
    for item in _template(db,start):
        if item["date"]>=date.today() and (item["date"],item["kind"]) not in existing:db.add(PlannedSession(**item))
    db.commit();return week(db,start)

def recovery_forecast(db:Session)->list[dict]:
    current=analytics.training_stress_balance(db,60); fitness=current[-1]["fitness"] if current else 0; fatigue=current[-1]["fatigue"] if current else 0
    plan=week(db); loads=defaultdict(float)
    for s in plan["sessions"]:loads[s["date"]]+=s["planned_load"] or 0
    out=[]
    for i in range(7):
        d=date.today()+timedelta(days=i); load=loads[d.isoformat()]; fitness += (load-fitness)*(2/43); fatigue += (load-fatigue)*(2/8); form=fitness-fatigue
        out.append({"date":d.isoformat(),"planned_load":round(load,1),"fitness":round(fitness,1),"fatigue":round(fatigue,1),"form":round(form,1),"readiness":"fresh" if form>5 else "balanced" if form>-10 else "fatigued" if form>-20 else "overreached"})
    return out


def run_compliance(db: Session, weeks: int = 6) -> list[dict]:
    """Planned vs actual running per week (oldest first). Only weeks that have
    a stored plan appear - we never generate plans for the past. Skipped
    sessions are excluded; for the current week only sessions already due count."""
    this = _week_start()
    out = []
    for i in range(weeks - 1, -1, -1):
        start = this - timedelta(weeks=i); end = start + timedelta(days=6)
        rows = [r for r in db.execute(select(PlannedSession).where(
            PlannedSession.date >= start, PlannedSession.date <= end, PlannedSession.kind == "run",
        )).scalars().all() if r.status != "skipped" and r.date <= date.today()]
        if not rows:
            continue
        acts = [a for a in db.execute(select(Activity).where(Activity.date >= start, Activity.date <= end)).scalars().all()
                if "run" in (a.activity_type or "").lower()]
        run_days = {a.date for a in acts}
        planned_km = sum((r.target or {}).get("distance_km") or 0 for r in rows)
        done = sum(1 for r in rows if r.date in run_days or r.status == "completed")
        actual_km = sum((a.distance_m or 0) for a in acts) / 1000
        out.append({"week": start.isoformat(), "planned_runs": len(rows), "runs_done": done,
                    "planned_km": round(planned_km, 1), "actual_km": round(actual_km, 1),
                    "km_pct": round(actual_km / planned_km * 100) if planned_km else None})
    return out
