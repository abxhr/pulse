# Changelog

## 0.5.0 — Intelligence pass: stats/ML features across the app

**Added**
- Training Stress Balance chart (Fitness/Fatigue/Form) using a Banister impulse-response model, same math as TrainingPeaks' PMC
- Composite illness/overtraining risk score blending HRV, resting HR, sleep debt, and acute:chronic training load
- Personalized HR zones (Karvonen method, using your actual resting HR) plus sessions bucketed into them
- All-time GPS route heatmap across every run, with a background sync button to backfill older routes
- Cross-metric correlation miner — automatically surfaces statistically meaningful relationships between sleep, training, nutrition, and recovery metrics (e.g. body battery vs. resting HR)
- Personalized sleep need pulled from Garmin's own adaptive sleep-need field, replacing the flat 8h default
- Bayesian/EWMA-smoothed TDEE estimate — blends new readings with prior estimate instead of hard-replacing it
- Adaptive step goal — trailing 14-day average +5%, instead of a fixed 10k
- Muscle days-since-trained heatmap (toggle alongside the existing weekly volume heatmap) on Strength
- GitHub-style activity calendar heatmap (12 months, cardio/strength/nutrition/weight logging density) on Reports
- Real background push notifications (body battery low, weight not logged) via the Web Push API — works even when the app isn't open, replacing the old foreground-only reminders
- Weight-entry outlier guard — warns and requires confirmation if a new entry deviates sharply from your trend
- Nightly database backup with 14-day rotation, viewable/triggerable from Reports
- Route/HR data now filtered against physiologically plausible ranges to drop sensor glitches (bad cadence, absurd HR spikes)

**Changed**
- Frontend now code-splits by route — initial load dropped from ~1.2MB to ~11KB gzipped, with chart libraries loading only when a chart page opens

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
