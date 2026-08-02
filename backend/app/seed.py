"""Seed the DB with ~90 days of realistic synthetic data so you can explore the
whole app before connecting Garmin/Hevy. Run:  python -m app.seed
Clear it anytime by deleting backend/data/pulse.db, or run with --wipe."""
from __future__ import annotations
import math
import random
import sys
from datetime import date, datetime, timedelta

from .db import SessionLocal, init_db
from .models import DailyHealth, Sleep, Activity, Workout

random.seed(7)

EXERCISES = {
    "Bench Press (Barbell)": ("chest", 80),
    "Squat (Barbell)": ("quadriceps", 110),
    "Deadlift (Barbell)": ("back", 140),
    "Overhead Press (Barbell)": ("shoulders", 50),
    "Pull Up": ("back", 0),
    "Lat Pulldown (Cable)": ("back", 60),
    "Incline Bench Press (Dumbbell)": ("chest", 30),
    "Romanian Deadlift (Barbell)": ("hamstrings", 90),
    "Bicep Curl (Dumbbell)": ("biceps", 16),
    "Leg Press": ("quadriceps", 200),
}
SPLIT = [
    ["Bench Press (Barbell)", "Incline Bench Press (Dumbbell)", "Overhead Press (Barbell)"],
    ["Squat (Barbell)", "Romanian Deadlift (Barbell)", "Leg Press"],
    ["Deadlift (Barbell)", "Pull Up", "Lat Pulldown (Cable)", "Bicep Curl (Dumbbell)"],
]


def gen(days: int = 90):
    db = SessionLocal()
    today = date.today()
    fitness = 44.0
    for i in range(days):
        d = today - timedelta(days=i)
        prog = (days - i) / days
        # circadian-ish waves for variety
        wave = math.sin(i / 6.0)
        sleep_h = max(4.8, min(8.6, 7.1 + wave * 0.8 + random.uniform(-0.5, 0.5)))
        total = int(sleep_h * 3600)
        deep = int(total * random.uniform(0.16, 0.24))
        rem = int(total * random.uniform(0.18, 0.26))
        awake = int(total * random.uniform(0.03, 0.08))
        light = total - deep - rem - awake
        score = int(max(45, min(95, 74 + wave * 10 + (sleep_h - 7) * 6 + random.uniform(-6, 6))))
        rhr = int(48 - prog * 3 + random.uniform(-2, 3) - (sleep_h - 7))
        hrv = int(58 + prog * 8 + wave * 6 + random.uniform(-5, 5))
        readiness = int(max(20, min(99, score * 0.5 + hrv * 0.6 + random.uniform(-8, 8))))
        fitness += random.uniform(-0.05, 0.09)

        db.merge(Sleep(
            date=d, total_seconds=total, deep_seconds=deep, light_seconds=light,
            rem_seconds=rem, awake_seconds=awake, sleep_score=score,
            sleep_quality="good" if score > 75 else "fair",
            resting_hr=rhr, avg_spo2=random.randint(94, 98),
            lowest_spo2=random.randint(88, 93), avg_respiration=round(random.uniform(13, 16), 1),
            avg_stress=random.randint(14, 30), hrv_avg=hrv,
            body_battery_change=random.randint(30, 70), raw={"demo": True},
        ))
        db.merge(DailyHealth(
            date=d, steps=random.randint(5000, 14000), step_goal=10000,
            floors_climbed=random.randint(3, 22), distance_m=random.uniform(4000, 11000),
            calories_total=random.randint(2300, 3100), calories_active=random.randint(500, 1200),
            resting_hr=rhr, max_hr=random.randint(150, 185), min_hr=random.randint(42, 50),
            avg_stress=random.randint(22, 42), max_stress=random.randint(70, 95),
            body_battery_high=random.randint(70, 100), body_battery_low=random.randint(5, 30),
            avg_spo2=random.randint(95, 98), avg_respiration=round(random.uniform(13, 16), 1),
            intensity_minutes=random.randint(20, 120), vo2max=round(fitness, 1),
            training_readiness=readiness,
            training_readiness_label="High" if readiness > 75 else ("Moderate" if readiness > 50 else "Low"),
            training_status=random.choice(["Productive", "Maintaining", "Productive", "Recovery", "Peaking"]),
            hrv_last_night=hrv, hrv_status=random.choice(["Balanced", "Balanced", "Unbalanced"]),
            raw={"demo": True},
        ))

        # ~3 runs per week
        if random.random() < 0.42:
            dist = random.uniform(4000, 14000)
            dur = dist / random.uniform(2.6, 3.2)  # ~ pace
            db.merge(Activity(
                id=f"demo-run-{d.isoformat()}", date=d,
                start_time=datetime.combine(d, datetime.min.time()) + timedelta(hours=7),
                activity_type="running", name=random.choice(["Morning Run", "Easy Run", "Tempo Run", "Long Run"]),
                distance_m=dist, duration_s=dur, moving_duration_s=dur * 0.98,
                avg_hr=random.randint(138, 168), max_hr=random.randint(170, 188),
                avg_pace_s_per_km=dur / (dist / 1000), avg_speed_mps=dist / dur,
                calories=int(dist / 1000 * 65), elevation_gain_m=random.uniform(10, 120),
                avg_cadence=random.uniform(168, 182),
                aerobic_te=round(random.uniform(2.0, 4.2), 1),
                anaerobic_te=round(random.uniform(0.2, 2.0), 1),
                vo2max=round(fitness, 1), source="garmin", raw={"demo": True},
            ))

        # ~4 lifts per week
        if random.random() < 0.55:
            day_ex = SPLIT[i % 3]
            exercises, vol, sets_total = [], 0.0, 0
            for name in day_ex:
                muscle, base = EXERCISES[name]
                base_w = base * (0.85 + prog * 0.2)
                sets = []
                for _ in range(random.randint(3, 4)):
                    w = round(base_w + random.uniform(-5, 5), 1) if base else 0
                    reps = random.randint(5, 10)
                    vol += w * reps
                    sets_total += 1
                    sets.append({"type": "normal", "weight_kg": w, "reps": reps, "rpe": random.randint(6, 9)})
                exercises.append({"title": name, "muscle_group": muscle, "equipment": "barbell", "sets": sets})
            start = datetime.combine(d, datetime.min.time()) + timedelta(hours=18)
            db.merge(Workout(
                id=f"demo-lift-{d.isoformat()}", date=d, start_time=start,
                end_time=start + timedelta(minutes=random.randint(45, 75)),
                title=["Push", "Legs", "Pull"][i % 3], duration_s=random.randint(2700, 4500),
                volume_kg=round(vol, 1), set_count=sets_total, exercise_count=len(exercises),
                exercises=exercises, source="hevy", raw={"demo": True},
            ))
    db.commit()
    db.close()
    print(f"✅ Seeded {days} days of demo data. Start the server and open the dashboard.")


if __name__ == "__main__":
    init_db()
    if "--wipe" in sys.argv:
        from .db import engine, Base
        Base.metadata.drop_all(engine)
        init_db()
        print("Wiped existing tables.")
        if "--seed" not in sys.argv:
            print("Skipping reseed (pass --seed to also generate demo data).")
            sys.exit(0)
    gen()
