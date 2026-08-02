"""One-time Garmin authentication. Run this ONCE, interactively:

    cd backend
    python -m app.auth_garmin

It logs into Garmin Connect (handling MFA / 2FA if enabled) and writes long-lived
OAuth tokens to backend/data/garmin_tokens. The server then reuses those tokens and
never needs your password again (tokens auto-refresh for ~1 year).

You can either be prompted for credentials, or set GARMIN_EMAIL / GARMIN_PASSWORD
in .env for a non-interactive first login (MFA still prompts).
"""
import getpass
import sys

from .config import settings


def main():
    try:
        from garminconnect import Garmin
    except ImportError:
        sys.exit("garminconnect not installed. Run: pip install -r requirements.txt")

    email = settings.garmin_email or input("Garmin email: ").strip()
    password = settings.garmin_password or getpass.getpass("Garmin password: ")

    print("Logging in to Garmin Connect...")
    # return_on_mfa lets us feed the code interactively.
    garmin = Garmin(email=email, password=password, return_on_mfa=True)
    result1, result2 = garmin.login()

    if result1 == "needs_mfa":
        code = input("Enter the MFA / 2FA code Garmin just sent you: ").strip()
        garmin.resume_login(result2, code)

    garmin.client.dump(settings.garmin_token_store)
    print(f"\n✅ Success. Tokens saved to: {settings.garmin_token_store}")
    print("You can now start the server and sync. This step won't be needed again for ~1 year.")


if __name__ == "__main__":
    main()
