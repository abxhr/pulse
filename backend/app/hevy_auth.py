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
import sys

from .config import settings


def main():
    try:
        from hevy_unofficial import capture_tokens_via_browser, CredentialStore
    except ImportError:
        sys.exit("hevy-unofficial not installed. Run: pip install 'hevy-unofficial[core]'")

    email = settings.hevy_email or input("Hevy account email (just used as a local storage key): ").strip()

    print("Opening a browser window - log into Hevy there. Waiting up to 5 minutes...")
    try:
        tokens = capture_tokens_via_browser(timeout_sec=300)
    except Exception as e:
        sys.exit(
            f"Couldn't capture a login session: {e}\n"
            "If this is the first run, you may need: python -m playwright install chromium"
        )

    store = CredentialStore(path=settings.hevy_token_store)
    store.save(email, tokens)
    print(f"\n✅ Success. Tokens saved to: {settings.hevy_token_store}")
    print(f"Set these in .env, then hit Sync:\n  HEVY_MODE=unofficial\n  HEVY_EMAIL={email}")


if __name__ == "__main__":
    main()
