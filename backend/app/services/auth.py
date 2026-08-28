"""Single-user password authentication using stdlib cryptography."""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..models import AppAuth, AuthSession

SESSION_DAYS = 90


def configured(db: Session) -> bool:
    return db.get(AppAuth, 1) is not None


def _hash_password(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)


def set_password(db: Session, password: str) -> None:
    if len(password) < 10:
        raise ValueError("Use at least 10 characters")
    salt = secrets.token_bytes(16)
    digest = _hash_password(password, salt)
    row = db.get(AppAuth, 1)
    if row:
        row.salt = base64.b64encode(salt).decode()
        row.password_hash = base64.b64encode(digest).decode()
        row.updated_at = datetime.utcnow()
    else:
        db.add(AppAuth(id=1, salt=base64.b64encode(salt).decode(), password_hash=base64.b64encode(digest).decode()))
    db.execute(delete(AuthSession))
    db.commit()


def verify_password(db: Session, password: str) -> bool:
    row = db.get(AppAuth, 1)
    if not row:
        return False
    try:
        actual = _hash_password(password, base64.b64decode(row.salt))
        return hmac.compare_digest(base64.b64decode(row.password_hash), actual)
    except Exception:
        return False


def create_session(db: Session) -> str:
    raw = secrets.token_urlsafe(32)
    db.add(AuthSession(token_hash=hashlib.sha256(raw.encode()).hexdigest(), expires_at=datetime.utcnow() + timedelta(days=SESSION_DAYS)))
    db.commit()
    return raw


def valid_session(db: Session, raw: str | None) -> bool:
    if not raw:
        return False
    row = db.scalar(select(AuthSession).where(
        AuthSession.token_hash == hashlib.sha256(raw.encode()).hexdigest(),
        AuthSession.expires_at > datetime.utcnow(),
    ))
    return row is not None


def revoke_session(db: Session, raw: str | None) -> None:
    if raw:
        db.execute(delete(AuthSession).where(AuthSession.token_hash == hashlib.sha256(raw.encode()).hexdigest()))
        db.commit()
