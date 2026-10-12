"""HTTP surface for the Coach agent, injuries and race readiness."""
from __future__ import annotations
import json

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .db import SessionLocal, get_session
from .models import Insight
from .services import agent, injury, race_readiness

router = APIRouter(prefix="/api")


class ChatBody(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    page: str | None = Field(default=None, max_length=32)
    provider: str | None = Field(default=None, max_length=16)


class ExecuteBody(BaseModel):
    tool: str = Field(max_length=64)
    args: dict = Field(default_factory=dict)


@router.post("/agent/chat")
def agent_chat(body: ChatBody):
    def stream():
        db = SessionLocal()  # own session: the request-scoped one may close before the stream ends
        try:
            for ev in agent.run_turn(db, body.message, body.page, body.provider):
                yield json.dumps(ev, default=str) + "\n"
        except Exception as e:
            yield json.dumps({"t": "error", "message": f"{type(e).__name__}: {e}"}) + "\n"
        finally:
            db.close()
    return StreamingResponse(stream(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/agent/history")
def agent_history(limit: int = 40, db: Session = Depends(get_session)):
    return agent.history_view(db, min(max(limit, 1), 200))


@router.delete("/agent/history")
def agent_clear(db: Session = Depends(get_session)):
    db.query(Insight).filter(Insight.scope == agent.CHAT_SCOPE).delete()
    db.commit()
    return {"ok": True}


@router.post("/agent/execute")
def agent_execute(body: ExecuteBody, db: Session = Depends(get_session)):
    try:
        return agent.execute(db, body.tool, body.args)
    except (ValueError, TypeError, KeyError) as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.get("/agent/briefing")
def agent_briefing(db: Session = Depends(get_session)):
    try:
        return agent.briefing(db)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI call failed: {e}")


@router.post("/agent/briefing/refresh")
def agent_briefing_refresh(db: Session = Depends(get_session)):
    try:
        return agent.briefing(db, force=True)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI call failed: {e}")


@router.get("/race/readiness")
def race_readiness_route(db: Session = Depends(get_session)):
    return race_readiness.assess(db) or {}


@router.get("/injuries")
def injuries_list(all: bool = False, db: Session = Depends(get_session)):
    return injury.list_all(db, include_resolved=all)


@router.post("/injuries")
def injuries_add(payload: dict = Body(...), db: Session = Depends(get_session)):
    try:
        return injury.add(db, payload)
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.put("/injuries/{injury_id}")
def injuries_update(injury_id: int, payload: dict = Body(...), db: Session = Depends(get_session)):
    try:
        return injury.update(db, injury_id, payload)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
