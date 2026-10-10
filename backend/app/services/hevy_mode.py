"""Which Hevy source is actually in use, and whether hands-free sync is connected.

HEVY_MODE=auto (default) picks the best available source so nobody has to edit
.env after logging in:  Pro API key  >  saved free-account login  >  CSV folder.
An explicit "csv" / "unofficial" / "pro" is still respected.
"""
from __future__ import annotations

from pathlib import Path

from ..config import settings

DEFAULT_LABEL = "default"  # local key for the saved login; the account email is never needed


def saved_labels() -> list[str]:
    """Labels of logins saved in the token store (empty if none / library missing)."""
    path = Path(settings.hevy_token_store)
    if not path.exists():
        return []
    try:
        from hevy_unofficial import CredentialStore
        return list(CredentialStore(path=path).list_emails())
    except Exception:
        return []


def login_label() -> str:
    """Which saved login to use: the configured email if present, else the first one saved."""
    labels = saved_labels()
    if settings.hevy_email and settings.hevy_email in labels:
        return settings.hevy_email
    return labels[0] if labels else (settings.hevy_email or DEFAULT_LABEL)


def has_saved_login() -> bool:
    if settings.hevy_access_token and settings.hevy_refresh_token:
        return True
    return bool(saved_labels())


def effective_mode() -> str:
    mode = settings.hevy_mode.lower()
    if mode != "auto":
        return mode
    if settings.hevy_api_key:
        return "pro"
    return "unofficial" if has_saved_login() else "csv"
