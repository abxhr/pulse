"""Validated HTTP request contracts.

Service functions still accept dictionaries so imports and local tooling remain simple;
the public API boundary converts only validated models to those dictionaries.
"""
from __future__ import annotations

from datetime import date as date_t
from typing import Literal

from pydantic import BaseModel, Field, HttpUrl, field_validator


class PasswordBody(BaseModel):
    password: str = Field(min_length=10, max_length=256)


class MealBody(BaseModel):
    date: date_t | None = None
    meal_type: Literal["breakfast", "lunch", "dinner", "snack"] | None = None
    name: str = Field(min_length=1, max_length=255)
    calories: float | None = Field(default=None, ge=0, le=20_000)
    protein_g: float | None = Field(default=None, ge=0, le=2_000)
    carbs_g: float | None = Field(default=None, ge=0, le=3_000)
    fat_g: float | None = Field(default=None, ge=0, le=1_000)
    fiber_g: float | None = Field(default=None, ge=0, le=500)
    satiety: Literal["hungry", "satisfied", "very_full"] | None = None
    notes: str | None = Field(default=None, max_length=4_000)


class WeightBody(BaseModel):
    date: date_t | None = None
    weight_kg: float = Field(gt=20, lt=500)
    body_fat_pct: float | None = Field(default=None, ge=1, le=75)
    notes: str | None = Field(default=None, max_length=2_000)


class ShoeBody(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    start_date: date_t | None = None
    target_km: float = Field(default=700, gt=0, le=10_000)


class RestoreBackupBody(BaseModel):
    name: str = Field(pattern=r"^pulse-\d{8}-\d{6}\.db$")


class RecipeExtractUrl(BaseModel):
    url: HttpUrl

    @field_validator("url")
    @classmethod
    def supported_host(cls, value: HttpUrl) -> HttpUrl:
        host = (value.host or "").lower()
        allowed = ("youtube.com", "youtu.be", "instagram.com", "tiktok.com")
        if not any(host == item or host.endswith("." + item) for item in allowed):
            raise ValueError("URL must be from YouTube, Instagram, or TikTok")
        return value
