# Changelog

## 0.9.0 — Phase 4: personal intelligence lab

**Added**

- A Personal Intelligence Lab for running structured n-of-1 health, sleep, nutrition, and training experiments.
- Daily intervention-adherence logging with baseline-vs-intervention averages, effect size, direction, and confidence.
- A tomorrow-readiness forecast using nearest historical days matched on HRV, resting HR, and sleep score.
- Health timeline annotations for travel, illness, injury, medication, races, and lifestyle changes.
- A non-generating AI provider probe available from Coach to test authentication and connectivity without spending tokens.

**Fixed**

- Replaced externally tiled Leaflet maps with a creative local route atlas, so GPS routes remain visible offline, on iPhone, and when OpenStreetMap tiles fail.
- Distant route areas are clustered into selectable views instead of shrinking every route into tiny marks.
- Individual activity routes now use the same local atlas with clear start and finish markers.
- AI clients now bypass stale inherited proxies, use explicit connection/read timeouts, retry transient failures, and fall back to the other configured provider.
- PWA navigation HTML is never cached again, preventing stale bundle references and blank screens after deployment; older hashed assets remain available to already-open tabs.

**Changed**

- Removed the runtime dependency on external map tiles and substantially reduced the Cardio JavaScript chunk.

## 0.8.0 — Phase 3: adaptive planning and execution

**Added**

- A dedicated, phone-ready Plan page with a stable Monday–Sunday schedule, day cards, targets, and execution controls.
- Adaptive weekly running and strength prescriptions based on recent training habits, race context, and configured weekly frequency.
- Automatic Garmin/Hevy completion matching plus manual complete, skip, and reschedule actions.
- A seven-day Banister fitness/fatigue/form forecast using the load of the generated plan.
- Multi-signal deload detection with automatic volume reduction when recovery risk, form, and progressive-load history agree.
- Training-day calorie and carbohydrate periodization while preserving the same seven-day calorie average and protein target.
- Planning settings for run frequency, strength frequency, long-run day, and recovery day.
- Weekly plan adherence that only judges sessions due so far rather than penalizing future workouts.

**Changed**

- The Overview daily action plan now includes the actual sessions scheduled for today.
- Mobile navigation accommodates the new Plan destination without clipping page labels.

## 0.7.0 — Phase 2: goal-driven command center

**Added**

- A redesigned Overview command center that turns recovery, training, nutrition, and goal data into a prioritized daily action plan without using paid AI.
- A ranked goal hierarchy so health, cutting, race performance, strength retention, and sleep can be reordered or paused when priorities change.
- Morning and evening check-ins for energy, soreness, mood, hunger, stress, adherence, notes, and sick/travel/fasting/injured context.
- A persistent anomaly inbox with acknowledge and resolve actions for physiological deviations, recovery risk, and stale data.
- Cut trajectory, complete-day nutrition adherence, race-feasibility, training-gap, and estimated strength-retention scoring.
- A global phone-friendly quick-log button for weight, water, and meal entry from any page.
- Manual hydration storage and command-center APIs for all Phase 2 data.

**Changed**

- Overview now leads with decisions and goal progress before lower-level telemetry charts.
- Subjective check-in context can safely downgrade a Garmin-derived training recommendation.

## 0.6.0 — Phase 1: trust, mobile, security, and data quality

**Added**
- Single-owner password protection for every health-data API, with 90-day secure sessions, lock/logout, localhost-only first setup, and localhost-only password recovery
- Shared source/freshness/completeness metadata with stale-data warnings and accurate “as of” labels
- Locally persisted hourly stress and body-battery cache for the latest seven days, refreshed during Garmin sync
- Explicit nutrition “day complete” state so partial meal logs are never presented as a real calorie deficit
- Hevy automation diagnostics showing mode, latest detailed workout, staleness, last sync, and the exact hands-free setup action
- Foundational regression suite covering authentication, sleep safeguards, activity classification, nutrition completeness, freshness, and display formatting

**Fixed**
- Global iPhone horizontal overflow and clipped values/controls; added a compact phone header, overflow action sheet, and bottom navigation
- “Today,” “Stress now,” and “Body battery now” labels no longer disguise stale daily aggregates as live readings
- Swimming, paddling, hiking, strength, and other sports no longer pollute run counts or pace analytics
- Invalid swimming pace and short treadmill-distance artifacts are removed from historical data and rejected on future syncs
- Garmin sleep need is smoothed and safety-floored; sleep opportunity-gap and bedtime math are now internally consistent
- Tiny running baselines no longer create absurd percentage overload warnings
- Assisted pull-ups are excluded from invalid e1RM/plateau calculations, and plateau alerts are ranked/capped
- Empty nutrition history shows an explanation instead of a meaningless 0–4 calorie chart
- PWA service-worker updates now bypass browser cache; `sw.js` is no longer served as an immutable year-long asset

**Changed**
- Race estimates now use a conservative blend of VO₂max and actual recent performances, include uncertainty ranges, and expose evidence/confidence
- CORS is restricted and responses include CSP, anti-framing, no-sniff, referrer, and permissions-policy headers

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
# 0.10.0 — Stabilize

- Hardened password setup/reset against reverse-proxy trust confusion.
- Added login throttling and proxy-safe mutation origin checks.
- Added typed validation for critical health-data inputs and bounded list queries.
- Secured Hevy CSV uploads with safe filenames, size limits, and failure cleanup.
- Prevented overlapping Garmin and Hevy sync runs.
- Added verified backups and a local-only restore path with an emergency snapshot.
- Added backend/frontend CI and Release 0.10 regression coverage.
