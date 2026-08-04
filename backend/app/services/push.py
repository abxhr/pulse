"""Real background push notifications via the Web Push protocol (VAPID) — works
even when the app tab is closed, unlike the foreground-only Notification API."""
from __future__ import annotations
from datetime import date
import json
import logging

from pywebpush import webpush, WebPushException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import PushSubscription, PushLog

log = logging.getLogger("pulse.push")


def add_subscription(db: Session, endpoint: str, p256dh: str, auth: str) -> None:
    existing = db.execute(select(PushSubscription).where(PushSubscription.endpoint == endpoint)).scalar_one_or_none()
    if existing:
        return
    db.add(PushSubscription(endpoint=endpoint, p256dh=p256dh, auth=auth))
    db.commit()


def remove_subscription(db: Session, endpoint: str) -> None:
    db.execute(PushSubscription.__table__.delete().where(PushSubscription.endpoint == endpoint))
    db.commit()


def _private_key_path() -> str | None:
    from pathlib import Path
    path = Path(settings.vapid_private_key_path)
    # pywebpush accepts a path to the PEM file directly (it reads it via
    # Vapid.from_file) — passing the file's *contents* instead makes it try to
    # parse the PEM text as a raw base64url-encoded DER key, which fails.
    return str(path) if path.exists() else None


def send_to_all(db: Session, title: str, body: str, tag: str | None = None) -> int:
    """Sends one notification to every subscribed browser. Dead subscriptions
    (expired, user revoked permission, uninstalled) are pruned automatically
    on a 404/410 response — otherwise they'd accumulate forever."""
    priv = _private_key_path()
    if not priv or not settings.vapid_public_key:
        log.warning("push: VAPID keys not configured, skipping")
        return 0
    subs = db.execute(select(PushSubscription)).scalars().all()
    sent = 0
    for sub in subs:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                },
                data=json.dumps({"title": title, "body": body, "tag": tag or "pulse"}),
                vapid_private_key=priv,
                vapid_claims={"sub": settings.vapid_subject},
            )
            sent += 1
        except WebPushException as e:
            status = getattr(e.response, "status_code", None)
            if status in (404, 410):
                remove_subscription(db, sub.endpoint)
            else:
                log.warning("push failed for one subscriber: %s", e)
    return sent


def _already_sent_today(db: Session, kind: str) -> bool:
    today = date.today()
    return db.execute(
        select(PushLog).where(PushLog.kind == kind, PushLog.date == today)
    ).scalar_one_or_none() is not None


def _mark_sent(db: Session, kind: str) -> None:
    db.add(PushLog(kind=kind, date=date.today()))
    db.commit()


def run_checks(db: Session) -> None:
    """Called on a schedule (see main.py) — evaluates the same conditions the
    old foreground-only reminders used, but works even if no tab is open."""
    from .. import models
    from sqlalchemy import select as _select

    if not db.execute(_select(PushSubscription)).first():
        return  # nobody's subscribed — skip the Garmin calls entirely

    # Body battery low
    if not _already_sent_today(db, "battery"):
        try:
            from ..integrations import garmin_client as gc
            client = gc.make_client()
            current = gc.fetch_current_reading(client)
            bb = current.get("body_battery")
            if bb is not None and bb < 20:
                if send_to_all(db, "Body battery low", f"Down to {bb} — consider easing off training today.", tag="battery"):
                    _mark_sent(db, "battery")
        except Exception as e:
            log.debug("push battery check skipped: %s", e)

    # Weight not logged today, checked only in the evening
    from datetime import datetime
    if datetime.now().hour >= 20 and not _already_sent_today(db, "weight"):
        today = date.today()
        logged = db.execute(
            _select(models.BodyWeight).where(models.BodyWeight.date == today)
        ).scalar_one_or_none()
        if not logged:
            if send_to_all(db, "Log your weight", "Haven't seen a weigh-in today yet.", tag="weight"):
                _mark_sent(db, "weight")
