# Pulse — your body, instrumented

A local dashboard that pulls **all** your Garmin Forerunner 970 health data and your
**Hevy** strength workouts into one place, visualizes everything, generates reports,
and lets you talk to an AI coach (Claude *or* GPT) that reads your actual numbers.

Runs on your machine (or a Raspberry Pi on your home network). Your health data lives
in a local SQLite file and never leaves your network — except the compact summary you
choose to send to the AI.

---

## What's in the box

- **Garmin sync** — sleep + stages, HRV, training readiness, body battery, stress,
  SpO2, respiration, resting HR, VO2max, training status, steps, intensity minutes,
  calories, floors, and every activity.
- **Hevy sync — no Pro required** (see below): free CSV import *or* automated free sync.
- **Dashboard, Sleep, Cardio, Strength** views — charts, trends, muscle-group volume,
  a signature readiness ring.
- **Nutrition** — manual macro tracking: log meals (calories/protein/carbs/fat), set daily
  targets, see today's totals vs. goal and a 14-day calorie trend. Fast enough to use from
  your phone right after eating.
- **Coach** — an AI chat that reads your last 30 days and answers with real figures.
- **Reports** — 1 / 4 / 12-week report with an AI narrative; print to PDF.
- **Demo mode** — ships pre-seeded with 90 days of realistic data so everything works
  before you connect anything.

Stack: **FastAPI + SQLite** backend, **React (Vite) + Tailwind + Recharts** frontend.

---

## Hevy without Pro

The official public API needs Hevy Pro. You don't. Set `HEVY_MODE` in `.env` to one of:

### `csv` (recommended — reliable, official, always works)
Hevy lets any account export its full history for free:
**Hevy app/website -> Settings -> Export & Import Data -> Export Workouts** -> you get a CSV.

Pulse ingests it three ways:
- **Drop it in a folder:** put the CSV in `backend/data/imports/` and hit Sync (or let the
  scheduler run). Processed files move to `imports/archive/`.
- **Upload from the app:** the "Import CSV" button in the header (great from your phone).
- **CLI / cron:** `python -m app.import_hevy /path/to/export.csv`

The parser groups rows into workouts -> exercises -> sets, computes volume, and infers a
muscle group per exercise so the by-muscle charts work.

### `unofficial` (fully automated)
Uses the `hevy-unofficial` client — the same private `api.hevyapp.com` endpoints the Hevy
**web app** uses, which work on a free account. Hands-off recurring sync, no manual export,
no CSV step ever again — the scheduler picks up new workouts automatically.

> Trade-off: it's an alpha library hitting undocumented endpoints, so it can break. If it
> does, `csv` mode still works. Use at your own risk and respect Hevy's terms.

Setup — run once, interactively, in your own terminal (opens a real browser window):
```bash
pip install 'hevy-unofficial[core]'
python -m playwright install chromium   # one-time browser binary download (~150MB)
cd backend && python -m app.hevy_auth
```
A Chrome window opens on hevy.com — log in there normally (your password goes straight to
Hevy's real site, never through this app). Once logged in, your session tokens are captured
and saved to `backend/data/hevy_tokens.json` (gitignored). The client auto-refreshes them and
re-persists the refreshed pair after that — no token to manually rotate, ever.

Then set in `.env`:
```
HEVY_MODE=unofficial
HEVY_EMAIL=you@example.com   # whatever you entered during the browser login — the storage key
```
Restart the server and hit **Sync** — from then on the 30-minute scheduler keeps your
workouts current with zero manual steps.

(Legacy fallback: set `HEVY_ACCESS_TOKEN` / `HEVY_REFRESH_TOKEN` directly in `.env`, grabbed
from hevy.com's DevTools, if you'd rather skip the browser-login flow. These don't
auto-persist on refresh the way the browser-login flow does.)

### `pro`
If you ever get Hevy Pro: `HEVY_MODE=pro` + `HEVY_API_KEY=...` from
https://hevy.com/settings?developer.

---

## Setup

### Prerequisites
Python 3.10+, Node.js 18+, your Garmin login. (No Hevy Pro needed.)

### 1. Backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure
```bash
cd .. && cp .env.example .env
```
Set `HEVY_MODE` (+ its fields) and `AI_PROVIDER` + key.

### 3. Garmin (once, handles 2FA)
```bash
cd backend && python -m app.auth_garmin
```

### 4. Frontend
```bash
cd ../frontend && npm install
```

### 5. Run (development — two processes, hot reload)
```bash
./dev.sh          # mac/linux    (or dev.bat on windows)
```
Open http://localhost:5173, hit **Sync**.

> Demo data is pre-seeded — just run it to look around. Reset with
> `cd backend && python -m app.seed --wipe`.

---

## Self-hosting (single process, phone access from anywhere)

Run it as **one process**: FastAPI serves the built frontend, so there's a single URL and
no CORS to worry about. Works the same whether the host is a Raspberry Pi or, as set up
here, an always-on Windows PC.

```bash
# 1. Build the frontend once (produces frontend/dist)
cd frontend && npm install && npm run build

# 2. Run the backend — it auto-serves frontend/dist and binds to your LAN
cd ../backend && python -m app.main          # uses HOST/PORT from .env (0.0.0.0:8080)
```
Open `http://<host-ip>:8080` (or `http://raspberrypi.local:8080`) from your phone on the
same Wi-Fi.

Notes:
- **Automated sync:** `ENABLE_SCHEDULER=true` (default in the template) runs a full
  Garmin + Hevy sync every `SYNC_INTERVAL_HOURS`. With `unofficial` mode or the CSV folder
  watch, this is genuinely hands-off.
- **`garminconnect`** is pure Python and runs fine on ARM.
- **`hevy-unofficial[core]`** avoids the heavy Playwright/Chromium dependency — use it on
  a Pi. (Full browser login is only for the one-time token grab; do that on your laptop.)
- **Keep it running on boot:**
  - Linux/Pi — a `systemd` service:
    ```ini
    [Unit]
    Description=Pulse
    After=network-online.target
    [Service]
    WorkingDirectory=/home/pi/pulse/backend
    ExecStart=/home/pi/pulse/backend/.venv/bin/python -m app.main
    Restart=always
    [Install]
    WantedBy=multi-user.target
    ```
  - Windows — `backend/start_server.bat` (activates the venv and runs `python -m app.main`).
    A shortcut to `backend/start_server_hidden.vbs` (runs the batch file with no console
    window) in `shell:startup` launches it silently at every login.

### Reaching it from your phone anywhere (not just home Wi-Fi) — Tailscale

[Tailscale](https://tailscale.com) puts your phone and host machine on the same private
mesh network — no open ports, nothing public. This repo is configured to use it:

1. Install Tailscale on the host machine and on your phone, sign in with the same account
   on both.
2. On the host, run `tailscale serve --bg 8080` once (needs **Serve** enabled for your
   tailnet — the CLI prints a one-time enable link the first time). This gives you a stable
   private HTTPS URL like `https://<device-name>.<tailnet>.ts.net` that proxies to the app —
   HTTPS is required for the installable PWA / offline shell to work.
3. Open that URL on your phone (with Tailscale connected) and use **Add to Home Screen**
   (iOS Safari: Share → Add to Home Screen) — the app installs with its own icon and opens
   full-screen, no browser chrome, from anywhere you have signal.

`tailscale serve` config persists across reboots of the host automatically; you only need
to keep the backend process itself running (see "Keep it running on boot" above).

---

## How the pieces fit

```
frontend (dev :5173, or served by backend in prod)
      |  /api/*
      v
backend (FastAPI :8080)
      |- integrations/garmin_client.py     -> garminconnect (cached OAuth tokens)
      |- integrations/hevy_csv.py          -> free CSV export parser + muscle classifier
      |- integrations/hevy_free_client.py  -> unofficial private API (free auto-sync)
      |- integrations/hevy_client.py       -> official public API (pro mode)
      |- services/sync.py                  -> mode dispatch + folder import + upsert
      |- services/analytics.py             -> dashboard aggregations & trends
      |- services/insights.py              -> Claude / GPT (compact summary only)
      |- services/reports.py               -> performance reports
      v
SQLite (backend/data/pulse.db)   <- all your data, local
```

Privacy: the AI only ever receives the summarized JSON from
`services/insights.py::build_context` — daily aggregates and trends, not raw records.

---

## Roadmap

- Per-night sleep timeline (movement/HR overlay).
- Per-exercise progression + 1RM estimates + PR detection.
- Intraday HR / stress / body-battery curves (raw arrays already stored).
- Correlations panel (sleep -> next-day readiness, volume -> resting HR).
- Server-side PDF export (`pip install markdown weasyprint`, finish `reports.build_pdf`).
- Optional native shell via Tauri.

---

## Troubleshooting

- **Garmin MFA loop** — rerun `python -m app.auth_garmin`.
- **Empty readiness / HRV / body battery** — needs a compatible device (the FR970 has all);
  very old dates may be blank.
- **Hevy CSV imported 0 workouts** — make sure it's the *Workouts* export (has
  `title,start_time,...,weight_kg,reps,...`), not a routines export.
- **`unofficial` mode fails** — tokens likely expired/invalid; grab fresh ones or switch to
  `csv`. It's experimental by nature.
- **Can't reach it from your phone** — confirm `HOST=0.0.0.0`, you built the frontend, and
  the Pi firewall allows the port on your LAN.
