"""Central configuration. Reads from environment / .env file."""
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent  # backend/
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)
(DATA_DIR / "imports").mkdir(exist_ok=True)
(DATA_DIR / "imports" / "archive").mkdir(exist_ok=True)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR.parent / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Database ---
    database_url: str = f"sqlite:///{DATA_DIR / 'pulse.db'}"

    # --- Garmin ---
    # Tokens are created once via `python -m app.auth_garmin` and cached here.
    garmin_token_store: str = str(DATA_DIR / "garmin_tokens")
    garmin_email: str | None = None      # only used by the one-time auth bootstrap
    garmin_password: str | None = None   # only used by the one-time auth bootstrap

    # --- Hevy ---
    # mode: "csv" (free export, reliable) | "unofficial" (free auto-sync) | "pro" (paid API key)
    hevy_mode: str = "csv"
    hevy_import_dir: str = str(DATA_DIR / "imports")
    hevy_api_key: str | None = None          # pro mode
    hevy_base_url: str = "https://api.hevyapp.com"
    hevy_token_store: str = str(DATA_DIR / "hevy_tokens.json")  # unofficial mode — set up via `python -m app.hevy_auth`
    hevy_access_token: str | None = None     # unofficial mode legacy fallback (paste tokens directly)
    hevy_refresh_token: str | None = None    # unofficial mode legacy fallback
    hevy_email: str | None = None            # unofficial mode — key into hevy_token_store

    # --- AI provider: "anthropic" or "openai" ---
    ai_provider: str = "anthropic"
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-opus-4-8"
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o"

    # --- Sync scheduler ---
    enable_scheduler: bool = False
    sync_interval_minutes: int = 30   # how often the background scheduler runs a quick sync
    quick_sync_days: int = 7          # window a quick sync (scheduler + the UI Sync button) covers
    default_backfill_days: int = 90   # window a full/explicit backfill covers

    # --- Server / self-hosting (e.g. Raspberry Pi) ---
    host: str = "0.0.0.0"          # bind to all interfaces so your phone can reach it on the LAN
    port: int = 8000
    serve_frontend: bool = True    # serve the built frontend from FastAPI (single process, one URL)
    cors_origins: str = "*"        # with single-process serving, same-origin; "*" is fine on a home LAN

    # --- Overview extras ---
    sleep_target_hours: float = 8.0   # nightly sleep need used for the sleep-debt tracker
    latitude: float | None = None     # set these to enable the weather card on the readiness panel
    longitude: float | None = None    # (Open-Meteo needs no API key, just a location)


settings = Settings()
