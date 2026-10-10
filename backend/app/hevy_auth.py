"""One-time Hevy authentication for automated free-account sync. Run this ONCE,
interactively, in your own terminal (it opens a real, visible browser window):

    cd backend
    python -m app.hevy_auth

A Chrome window opens on hevy.com. Log in there normally - your password goes
straight to Hevy's real site, never through this app. Once logged in, this
captures the session tokens and saves them locally (backend/data/hevy_tokens.json,
already gitignored). The client auto-refreshes and re-persists them after that,
so this won't be needed again unless you log out of Hevy everywhere.

Needs the browser binary once: `python -m playwright install chromium`
"""
import argparse
import sys

from .config import settings
from .services import hevy_mode


def main(argv=None):
    parser = argparse.ArgumentParser(description="One-time Hevy login for automatic sync")
    parser.add_argument("--label", default=None, help="local key for the saved login (default: automatic)")
    args = parser.parse_args(argv)

    try:
        from hevy_unofficial import capture_tokens_via_browser, CredentialStore
    except ImportError:
        sys.exit("hevy-unofficial not installed. Run: pip install 'hevy-unofficial[core]'")

    label = args.label or settings.hevy_email or hevy_mode.DEFAULT_LABEL

    print("Opening a browser window - log into Hevy there. Waiting up to 5 minutes...", flush=True)
    try:
        tokens = capture_tokens_via_browser(timeout_sec=300)
    except Exception as e:
        sys.exit(
            f"Couldn't capture a login session: {e}
"
            "If this is the first run, you may need: python -m playwright install chromium"
        )

    store = CredentialStore(path=settings.hevy_token_store)
    store.save(label, tokens)
    print(f"Success. Login saved to {settings.hevy_token_store}. Hevy now syncs automatically.", flush=True)


if __name__ == "__main__":
    main()
