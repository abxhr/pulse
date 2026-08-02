"""Database tables. One row per day for health/sleep; one row per activity/workout."""
from datetime import datetime, date as date_t
from sqlalchemy import String, Integer, Float, Date, DateTime, JSON, Text
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base


class DailyHealth(Base):
    """All-day Garmin wellness metrics, keyed by calendar date."""
    __tablename__ = "daily_health"

    date: Mapped[date_t] = mapped_column(Date, primary_key=True)
    steps: Mapped[int | None] = mapped_column(Integer)
    step_goal: Mapped[int | None] = mapped_column(Integer)
    floors_climbed: Mapped[int | None] = mapped_column(Integer)
    distance_m: Mapped[float | None] = mapped_column(Float)
    calories_total: Mapped[int | None] = mapped_column(Integer)
    calories_active: Mapped[int | None] = mapped_column(Integer)
    resting_hr: Mapped[int | None] = mapped_column(Integer)
    max_hr: Mapped[int | None] = mapped_column(Integer)
    min_hr: Mapped[int | None] = mapped_column(Integer)
    avg_stress: Mapped[int | None] = mapped_column(Integer)
    max_stress: Mapped[int | None] = mapped_column(Integer)
    body_battery_high: Mapped[int | None] = mapped_column(Integer)
    body_battery_low: Mapped[int | None] = mapped_column(Integer)
    avg_spo2: Mapped[int | None] = mapped_column(Integer)
    avg_respiration: Mapped[float | None] = mapped_column(Float)
    intensity_minutes: Mapped[int | None] = mapped_column(Integer)
    vo2max: Mapped[float | None] = mapped_column(Float)
    training_readiness: Mapped[int | None] = mapped_column(Integer)
    training_readiness_label: Mapped[str | None] = mapped_column(String(64))
    training_status: Mapped[str | None] = mapped_column(String(64))
    acute_load: Mapped[float | None] = mapped_column(Float)
    hrv_last_night: Mapped[int | None] = mapped_column(Integer)
    hrv_status: Mapped[str | None] = mapped_column(String(32))
    fitness_age: Mapped[float | None] = mapped_column(Float)
    chronological_age: Mapped[int | None] = mapped_column(Integer)
    raw: Mapped[dict | None] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Sleep(Base):
    """One row per night, keyed by the calendar date the night ends on."""
    __tablename__ = "sleep"

    date: Mapped[date_t] = mapped_column(Date, primary_key=True)
    total_seconds: Mapped[int | None] = mapped_column(Integer)
    deep_seconds: Mapped[int | None] = mapped_column(Integer)
    light_seconds: Mapped[int | None] = mapped_column(Integer)
    rem_seconds: Mapped[int | None] = mapped_column(Integer)
    awake_seconds: Mapped[int | None] = mapped_column(Integer)
    sleep_score: Mapped[int | None] = mapped_column(Integer)
    sleep_quality: Mapped[str | None] = mapped_column(String(32))
    resting_hr: Mapped[int | None] = mapped_column(Integer)
    avg_spo2: Mapped[int | None] = mapped_column(Integer)
    lowest_spo2: Mapped[int | None] = mapped_column(Integer)
    avg_respiration: Mapped[float | None] = mapped_column(Float)
    avg_stress: Mapped[int | None] = mapped_column(Integer)
    hrv_avg: Mapped[int | None] = mapped_column(Integer)
    body_battery_change: Mapped[int | None] = mapped_column(Integer)
    start_time: Mapped[datetime | None] = mapped_column(DateTime)   # bedtime
    end_time: Mapped[datetime | None] = mapped_column(DateTime)     # wake time
    avg_hr: Mapped[int | None] = mapped_column(Integer)             # overnight avg HR
    awake_count: Mapped[int | None] = mapped_column(Integer)
    score_feedback: Mapped[str | None] = mapped_column(String(64))  # Garmin's own qualifier, e.g. NEGATIVE_LONG_BUT_DISCONTINUOUS
    raw: Mapped[dict | None] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Activity(Base):
    """A Garmin activity (run, ride, swim, etc.)."""
    __tablename__ = "activity"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # garmin activityId
    date: Mapped[date_t] = mapped_column(Date, index=True)
    start_time: Mapped[datetime | None] = mapped_column(DateTime)
    activity_type: Mapped[str | None] = mapped_column(String(64))
    name: Mapped[str | None] = mapped_column(String(255))
    distance_m: Mapped[float | None] = mapped_column(Float)
    duration_s: Mapped[float | None] = mapped_column(Float)
    moving_duration_s: Mapped[float | None] = mapped_column(Float)
    avg_hr: Mapped[int | None] = mapped_column(Integer)
    max_hr: Mapped[int | None] = mapped_column(Integer)
    avg_pace_s_per_km: Mapped[float | None] = mapped_column(Float)
    avg_speed_mps: Mapped[float | None] = mapped_column(Float)
    calories: Mapped[int | None] = mapped_column(Integer)
    elevation_gain_m: Mapped[float | None] = mapped_column(Float)
    avg_cadence: Mapped[float | None] = mapped_column(Float)
    aerobic_te: Mapped[float | None] = mapped_column(Float)
    anaerobic_te: Mapped[float | None] = mapped_column(Float)
    vo2max: Mapped[float | None] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(16), default="garmin")
    raw: Mapped[dict | None] = mapped_column(JSON)


class Workout(Base):
    """A Hevy strength workout. Exercises/sets stored as JSON."""
    __tablename__ = "workout"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # hevy uuid
    date: Mapped[date_t] = mapped_column(Date, index=True)
    start_time: Mapped[datetime | None] = mapped_column(DateTime)
    end_time: Mapped[datetime | None] = mapped_column(DateTime)
    title: Mapped[str | None] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    duration_s: Mapped[float | None] = mapped_column(Float)
    volume_kg: Mapped[float | None] = mapped_column(Float)
    set_count: Mapped[int | None] = mapped_column(Integer)
    exercise_count: Mapped[int | None] = mapped_column(Integer)
    exercises: Mapped[list | None] = mapped_column(JSON)  # normalized list
    source: Mapped[str] = mapped_column(String(16), default="hevy")
    raw: Mapped[dict | None] = mapped_column(JSON)


class SyncLog(Base):
    __tablename__ = "sync_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(32))
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)
    status: Mapped[str] = mapped_column(String(16), default="running")  # running|ok|error
    records: Mapped[int] = mapped_column(Integer, default=0)
    message: Mapped[str | None] = mapped_column(Text)


class Meal(Base):
    """A single logged meal / food entry. Manual macro tracking."""
    __tablename__ = "meal"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date: Mapped[date_t] = mapped_column(Date, index=True)
    time: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    meal_type: Mapped[str | None] = mapped_column(String(16))  # breakfast|lunch|dinner|snack
    name: Mapped[str] = mapped_column(String(255))
    calories: Mapped[float | None] = mapped_column(Float)
    protein_g: Mapped[float | None] = mapped_column(Float)
    carbs_g: Mapped[float | None] = mapped_column(Float)
    fat_g: Mapped[float | None] = mapped_column(Float)
    fiber_g: Mapped[float | None] = mapped_column(Float)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class NutritionGoal(Base):
    """Single-row table of current daily macro targets."""
    __tablename__ = "nutrition_goal"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    calories: Mapped[float | None] = mapped_column(Float)
    protein_g: Mapped[float | None] = mapped_column(Float)
    carbs_g: Mapped[float | None] = mapped_column(Float)
    fat_g: Mapped[float | None] = mapped_column(Float)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Insight(Base):
    __tablename__ = "insight"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    scope: Mapped[str | None] = mapped_column(String(64))  # e.g. "weekly", "sleep", "chat"
    role: Mapped[str] = mapped_column(String(16), default="assistant")  # user|assistant
    provider: Mapped[str | None] = mapped_column(String(32))
    model: Mapped[str | None] = mapped_column(String(64))
    content: Mapped[str] = mapped_column(Text)
