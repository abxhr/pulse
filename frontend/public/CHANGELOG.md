# Changelog

## 0.4.0 — Cardio, strength, cut tracking, daily briefing

**Added**
- Weight & cut tracking: daily weigh-ins, goal weight + weekly rate, TDEE estimated from your actual logged calories vs. real weight change (falls back to Garmin's own calorie-burn estimate until there's enough history), recommended daily macros, weight trend projection with goal ETA, AI progress analysis
- Predicted race times (5K/10K/half/marathon) from current VO₂max
- Exercise progression tracking — estimated 1RM (Epley) per exercise over time, picked from a dropdown
- Heart rate analytics on Cardio: resting vs. max HR trend, time-in-HR-zone breakdown across recent activities, pace trend over your last 30 runs
- Hourly stress & body battery chart with a day picker (last 7 days)
- Push a logged workout to Garmin Connect and your watch, with best-effort exercise-catalog matching
- Auto-generated daily AI briefing on the Overview page — no click required, refreshable, regenerates once per day automatically at 6am
- Edit button on logged meals
- Server restart button (top right)
- Changelog viewer (this page)

**Fixed**
- Sleep bedtime/wake times were shifted by your timezone offset applied twice
- SpO2/respiration in sleep records were reading from fields Garmin leaves empty; fixed to read the correct nested data
- Dashboard VO2max/fitness age showed blank or stale values by picking whichever day happened to have other vitals, instead of the day that metric actually last updated
- "Invalid Date" in the Training Load chart tooltip
- Nutrition macro inputs didn't show a persistent label, so typed numbers were hard to identify
- iOS "Add to Home Screen" content hidden under the status bar

**Changed**
- Sync now runs a fast quick-sync (last 7 days, parallelized) automatically every 30 minutes, instead of one slow full backfill
- Sync no longer writes an empty placeholder row for days Garmin has zero data for
- Chart Y-axes now show units, and multi-series charts have a clickable legend to isolate one line

## 0.3.0 — Real data, AI multi-provider, activity/workout detail

**Added**
- Activity and workout detail modals with full breakdowns (HR zones, training effect, splits, GPS route map for runs)
- Weekly muscle-heatmap body diagram on Strength (Monday–Sunday)
- Per-request AI provider picker (Claude / GPT), sidebar shows both keys' status separately
- Meal photo/text AI macro estimation ("scan a meal")

**Fixed**
- Garmin token save was writing to the wrong (deprecated) library format, so auth silently never persisted
- Dashboard status incorrectly showed "connected" for Garmin based on folder existence, not real tokens

## 0.2.0 — Nutrition tracking, phone access

**Added**
- Manual meal/macro logging with daily targets
- PWA support (installable, offline app shell)
- Private phone access via Tailscale Serve (HTTPS, tailnet-only)

## 0.1.0 — Initial

- Garmin + Hevy sync, Dashboard/Sleep/Cardio/Strength views, AI Coach, weekly/monthly reports
