"""Injuries the owner is carrying. The planner and the Coach both read these, so a
sore wrist stops producing "Upper strength" sessions and a sore knee flags the race."""
from __future__ import annotations
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Injury

_UPPER = ("wrist", "hand", "finger", "thumb", "forearm", "elbow", "shoulder", "arm", "bicep",
          "tricep", "tfcc", "pec", "chest", "neck", "rotator", "grip")
_LOWER = ("foot", "ankle", "achilles", "calf", "shin", "knee", "hip", "hamstring", "quad", "glute",
          "thigh", "groin", "leg", "plantar", "itb", "it band", "heel", "toe", "pelvis", "adductor")
STATUSES = {"active", "recovering", "resolved"}

# Plain-language defaults when the Coach doesn't spell restrictions out itself.
_DEFAULT_RESTRICTIONS = {
    "upper": ["no loaded wrist/grip or pressing work that aggravates it", "running and lower-body work are fine if pain-free"],
    "lower": ["no impact or running until pain-free walking", "upper-body work is fine"],
    "other": ["train around it; stop anything that reproduces the pain"],
}


def region(area: str) -> str:
    a = (area or "").lower()
    if any(k in a for k in _LOWER): return "lower"
    if any(k in a for k in _UPPER): return "upper"
    return "other"


def serialize(r: Injury) -> dict:
    return {"id": r.id, "area": r.area, "side": r.side, "started": r.started.isoformat(), "status": r.status,
            "pain": r.pain, "restrictions": r.restrictions or [], "notes": r.notes, "region": region(r.area),
            "days_since_onset": (date.today() - r.started).days}


def list_all(db: Session, include_resolved: bool = False) -> list[dict]:
    q = select(Injury).order_by(Injury.started.desc())
    if not include_resolved: q = q.where(Injury.status != "resolved")
    return [serialize(r) for r in db.execute(q).scalars().all()]


def add(db: Session, p: dict) -> dict:
    area = str(p.get("area") or "").strip()[:64]
    if not area: raise ValueError("area is required")
    reg = region(area)
    row = Injury(area=area, side=(p.get("side") or None), status="active", pain=_pain(p.get("pain")),
                 started=date.fromisoformat(p["started"]) if p.get("started") else date.today(),
                 restrictions=_clean(p.get("restrictions")) or _DEFAULT_RESTRICTIONS[reg],
                 notes=str(p.get("notes") or "")[:2000] or None)
    db.add(row); db.commit(); db.refresh(row)
    _replan(db)
    return serialize(row)


def _replan(db: Session) -> None:
    """Rebuild this week's unstarted adaptive sessions so they respect the injury (Coach-scheduled ones are kept)."""
    from . import planner  # local: planner imports this module
    planner.regenerate(db)


def update(db: Session, injury_id: int, p: dict) -> dict:
    row = db.get(Injury, injury_id)
    if not row: raise ValueError("injury not found")
    if "status" in p:
        if p["status"] not in STATUSES: raise ValueError("status must be active, recovering or resolved")
        row.status = p["status"]
    if "pain" in p: row.pain = _pain(p["pain"])
    if p.get("restrictions") is not None: row.restrictions = _clean(p["restrictions"])
    if p.get("notes") is not None: row.notes = str(p["notes"])[:2000] or None
    row.updated_at = datetime.utcnow(); db.commit()
    _replan(db)
    return serialize(row)


def _pain(v) -> int | None:
    return None if v is None else max(0, min(10, int(v)))


def _clean(items) -> list[str] | None:
    if not items: return None
    return [str(i).strip()[:160] for i in items if str(i).strip()][:8] or None


def constraints(db: Session) -> dict:
    """What the planner must respect right now. Resolved injuries are ignored; 'recovering'
    still restricts upper-body loading but no longer blocks running."""
    live = [i for i in list_all(db) if i["status"] != "resolved"]
    upper = [i for i in live if i["region"] == "upper"]
    lower_active = [i for i in live if i["region"] == "lower" and i["status"] == "active"]
    return {"injuries": live, "avoid_upper_loading": bool(upper), "running_at_risk": bool(lower_active),
            "labels": [f"{i['area']} ({i['status']})" for i in live]}
