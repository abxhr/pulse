"""AI insights. Builds a compact, privacy-conscious summary of your recent data
and sends ONLY that summary (not raw records) to Claude or GPT.

Switch providers with AI_PROVIDER=anthropic|openai in .env.
"""
from __future__ import annotations
from datetime import datetime
import json
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Insight
from . import analytics, nutrition, weight as weight_svc

log = logging.getLogger("pulse.insights")

SYSTEM_PROMPT = """You are Pulse, a sharp, encouraging personal performance analyst.
You are given a structured JSON summary of the user's recent Garmin health metrics,
Hevy strength workouts, nutrition log, and (if they're tracking a cut/bulk) their
weight trend and macro targets. Analyze it like a great coach + sports scientist would:

- Lead with what matters. Call out the 2-3 most important signals first.
- Connect the dots across domains (e.g. poor sleep -> low readiness -> lighter session;
  or calorie/protein intake vs. weight trend vs. training volume during a cut).
- Be specific and quantitative; cite the actual numbers from the data.
- Give concrete, actionable suggestions for the next few days.
- Flag anything that looks like overtraining, under-recovery, an anomaly, or (if cutting)
  losing weight too fast/slow relative to their target rate.
- Never invent data you weren't given. If something is missing, say so briefly.
- Be concise and scannable. Use short paragraphs and tight bullets.
You are not a doctor; avoid medical diagnosis and note when something warrants a professional."""


def build_context(db: Session, days: int = 30) -> dict:
    """Compact JSON the model can reason over."""
    ctx = {
        "generated_at": datetime.utcnow().isoformat(),
        "today": analytics.snapshot(db),
        "health_trend_30d": analytics.health_trend(db, days),
        "sleep_trend_30d": analytics.sleep_trend(db, days),
        "recent_activities": analytics.recent_activities(db, 10),
        "training_load_12w": analytics.training_load(db, 12),
        "strength_summary_8w": analytics.strength_summary(db, 8),
    }
    w_trend = weight_svc.trend(db, days)
    if w_trend:
        ctx["weight_trend"] = w_trend
        ctx["weight_goal"] = weight_svc.get_goal(db)
        ctx["macro_recommendation"] = weight_svc.macro_recommendation(db)
    n_trend = nutrition.trend(db, 14)
    if any(d["totals"]["calories"] for d in n_trend):
        ctx["nutrition_trend_14d"] = n_trend
        ctx["nutrition_goal"] = nutrition.get_goal(db)
    return ctx


def _call_anthropic(system: str, messages: list[dict]) -> str:
    import anthropic
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    resp = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=1500,
        system=system,
        messages=messages,
    )
    return "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")


def _call_openai(system: str, messages: list[dict]) -> str:
    from openai import OpenAI
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY not set")
    client = OpenAI(api_key=settings.openai_api_key)
    resp = client.chat.completions.create(
        model=settings.openai_model,
        max_tokens=1500,
        messages=[{"role": "system", "content": system}] + messages,
    )
    return resp.choices[0].message.content or ""


def available_providers() -> dict:
    return {
        "anthropic": bool(settings.anthropic_api_key),
        "openai": bool(settings.openai_api_key),
    }


def _resolve_provider(provider: str | None) -> str:
    """Pick the provider to use: an explicit request override if configured,
    else the default from .env, else whichever key is actually set."""
    avail = available_providers()
    if provider and provider in avail and avail[provider]:
        return provider
    default = settings.ai_provider.lower()
    if avail.get(default):
        return default
    for name, ok in avail.items():
        if ok:
            return name
    return default  # nothing configured; let the call fail with a clear error


def _dispatch(system: str, messages: list[dict], provider: str | None = None) -> tuple[str, str, str]:
    resolved = _resolve_provider(provider)
    if resolved == "openai":
        return _call_openai(system, messages), "openai", settings.openai_model
    return _call_anthropic(system, messages), "anthropic", settings.anthropic_model


MEAL_VISION_SYSTEM = """You are a precise nutrition estimator. You are given a photo of a
meal and/or the user's own description of what's in it (which may include measured
weights, e.g. "150g rice, 200g chicken breast").

Rules:
- If the user gives explicit quantities (grams, cups, "1 medium", etc.), use those as the
  primary basis for your estimate — they are more reliable than a visual guess.
- If only a photo is given, estimate portion sizes visually as carefully as you can using
  plate/utensil scale as a size reference.
- Sum macros across every distinct food item you can identify.
- Respond with ONLY a single JSON object, no markdown fences, no commentary outside it:
  {"name": "short meal name", "calories": number, "protein_g": number, "carbs_g": number,
   "fat_g": number, "fiber_g": number, "confidence": "low"|"medium"|"high",
   "notes": "one short sentence on key assumptions you made"}
All numeric fields are your best-estimate totals for the whole meal, in grams (or kcal for
calories). Use 0 if a macro is genuinely negligible, never omit a field."""


def _analyze_anthropic(image_b64: str | None, media_type: str | None, notes: str | None) -> str:
    import anthropic
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    content: list[dict] = []
    if image_b64:
        content.append({
            "type": "image",
            "source": {"type": "base64", "media_type": media_type or "image/jpeg", "data": image_b64},
        })
    content.append({"type": "text", "text": notes or "Estimate the macros for this meal."})
    resp = client.messages.create(
        model=settings.anthropic_model, max_tokens=500,
        system=MEAL_VISION_SYSTEM, messages=[{"role": "user", "content": content}],
    )
    return "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")


def _analyze_openai(image_b64: str | None, media_type: str | None, notes: str | None) -> str:
    from openai import OpenAI
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY not set")
    client = OpenAI(api_key=settings.openai_api_key)
    content: list[dict] = [{"type": "text", "text": notes or "Estimate the macros for this meal."}]
    if image_b64:
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:{media_type or 'image/jpeg'};base64,{image_b64}"},
        })
    resp = client.chat.completions.create(
        model=settings.openai_model, max_tokens=500,
        messages=[{"role": "system", "content": MEAL_VISION_SYSTEM}, {"role": "user", "content": content}],
    )
    return resp.choices[0].message.content or ""


def analyze_meal(image_b64: str | None, media_type: str | None, notes: str | None,
                  provider: str | None = None) -> dict:
    """Estimate macros for a meal from an optional photo + optional free-text notes.
    Returns a dict ready to prefill the meal-add form; the user still confirms/edits before saving."""
    if not image_b64 and not (notes or "").strip():
        raise ValueError("Provide a photo, a description, or both.")
    resolved = _resolve_provider(provider)
    raw = _analyze_openai(image_b64, media_type, notes) if resolved == "openai" \
        else _analyze_anthropic(image_b64, media_type, notes)

    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise RuntimeError(f"Model didn't return JSON: {raw[:200]}")
    data = json.loads(text[start:end + 1])
    return {
        "name": data.get("name") or "Scanned meal",
        "calories": data.get("calories"),
        "protein_g": data.get("protein_g"),
        "carbs_g": data.get("carbs_g"),
        "fat_g": data.get("fat_g"),
        "fiber_g": data.get("fiber_g"),
        "confidence": data.get("confidence"),
        "notes": data.get("notes"),
    }


RECIPE_SYSTEM = """You are a precise recipe reader and nutrition estimator. You're given some
combination of: photos of a recipe (screenshots, a cookbook page, a video frame), a video
transcript/description, a social caption, or pasted text. Your job:

1. Extract the recipe: a clear name, ingredient list (with quantities as given), and a short
   instructions summary.
2. Estimate total nutrition for the WHOLE recipe as written, then divide by the number of
   servings to get per-serving macros. Infer a sensible serving count if not stated (e.g. from
   ingredient quantities/typical portion sizes) and say what you assumed.
3. If sources conflict (e.g. a video transcript says one thing, an on-screen photo shows
   another), prefer the most concrete/quantified source.

Respond with ONLY a single JSON object, no markdown fences, no commentary outside it:
{"name": "recipe name", "servings": number, "ingredients": ["1 cup rice", "200g chicken", ...],
 "instructions": "short numbered or step-by-step summary",
 "calories": number, "protein_g": number, "carbs_g": number, "fat_g": number, "fiber_g": number,
 "confidence": "low"|"medium"|"high", "notes": "assumptions you made, e.g. serving count"}
calories/protein_g/carbs_g/fat_g/fiber_g are PER SERVING. Never omit a field; use your best
estimate. If you truly can't identify a recipe from what's given, set "name" to null."""


def _vision_content_blocks(provider: str, images_b64: list[tuple[str, str]], text: str) -> list[dict]:
    """images_b64: list of (base64_data, media_type). Shared block-builder for both providers."""
    blocks = []
    for data, media_type in images_b64:
        if provider == "openai":
            blocks.append({"type": "image_url", "image_url": {"url": f"data:{media_type};base64,{data}"}})
        else:
            blocks.append({"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data}})
    text_block = {"type": "text", "text": text}
    return (blocks + [text_block]) if provider == "anthropic" else ([text_block] + blocks)


def _analyze_recipe_anthropic(images_b64: list[tuple[str, str]], text: str) -> str:
    import anthropic
    if not settings.anthropic_api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not set")
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    content = _vision_content_blocks("anthropic", images_b64, text)
    resp = client.messages.create(
        model=settings.anthropic_model, max_tokens=1200,
        system=RECIPE_SYSTEM, messages=[{"role": "user", "content": content}],
    )
    return "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")


def _analyze_recipe_openai(images_b64: list[tuple[str, str]], text: str) -> str:
    from openai import OpenAI
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY not set")
    client = OpenAI(api_key=settings.openai_api_key)
    content = _vision_content_blocks("openai", images_b64, text)
    resp = client.chat.completions.create(
        model=settings.openai_model, max_tokens=1200,
        messages=[{"role": "system", "content": RECIPE_SYSTEM}, {"role": "user", "content": content}],
    )
    return resp.choices[0].message.content or ""


def _parse_json_response(raw: str) -> dict:
    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise RuntimeError(f"Model didn't return JSON: {raw[:200]}")
    return json.loads(text[start:end + 1])


def analyze_recipe(images_b64: list[tuple[str, str]], text: str, provider: str | None = None) -> dict:
    """Extract a structured recipe + per-serving macros from photos and/or text
    (pasted caption, video transcript/description, or free-form notes)."""
    if not images_b64 and not text.strip():
        raise ValueError("Provide at least one screenshot or some text/URL content.")
    resolved = _resolve_provider(provider)
    raw = _analyze_recipe_openai(images_b64, text) if resolved == "openai" \
        else _analyze_recipe_anthropic(images_b64, text)
    data = _parse_json_response(raw)
    if not data.get("name"):
        raise ValueError("Couldn't identify a recipe from what was given.")
    return {
        "name": data.get("name"),
        "servings": data.get("servings") or 1,
        "ingredients": data.get("ingredients") or [],
        "instructions": data.get("instructions"),
        "calories": data.get("calories"), "protein_g": data.get("protein_g"),
        "carbs_g": data.get("carbs_g"), "fat_g": data.get("fat_g"), "fiber_g": data.get("fiber_g"),
        "confidence": data.get("confidence"), "notes": data.get("notes"),
    }


def extract_recipe_from_text(text: str, provider: str | None = None) -> dict:
    """Recipe extraction from pure text (e.g. a Coach chat message)."""
    return analyze_recipe([], text, provider)


def generate_insight(db: Session, question: str | None = None, scope: str = "chat",
                     history: list[dict] | None = None, provider: str | None = None) -> dict:
    """Ask the model for analysis. `history` is prior [{role, content}] turns."""
    context = build_context(db)
    user_msg = (
        f"Here is my data summary:\n```json\n{json.dumps(context, default=str)}\n```\n\n"
        + (question or "Give me a full analysis of my current form, recovery, "
                       "sleep, and training. What should I do this week?")
    )
    messages = (history or []) + [{"role": "user", "content": user_msg}]

    if question:
        db.add(Insight(scope=scope, role="user", content=question))
        db.commit()

    text, provider, model = _dispatch(SYSTEM_PROMPT, messages, provider)

    row = Insight(scope=scope, role="assistant", provider=provider, model=model, content=text)
    db.add(row)
    db.commit()
    db.refresh(row)
    return {
        "id": row.id,
        "content": text,
        "provider": provider,
        "model": model,
        "created_at": row.created_at.isoformat(),
    }


DAILY_SCOPE = "daily_auto"
DAILY_QUESTION = (
    "Give me my daily briefing: the 2-3 things that matter most right now across recovery, "
    "sleep, training, and (if I'm logging it) nutrition/weight vs. my cut goal. Be direct and "
    "specific with numbers. Keep it tight — this is a daily-glance summary, not a full report."
)


def get_or_generate_daily(db: Session, force: bool = False) -> dict:
    """One AI insight per calendar day, cached — regenerated only when forced or
    when today's doesn't exist yet. Keeps the Overview page showing something
    without hammering the API on every page load."""
    if not force:
        today_start = datetime.combine(datetime.utcnow().date(), datetime.min.time())
        existing = db.execute(
            select(Insight)
            .where(Insight.scope == DAILY_SCOPE, Insight.role == "assistant", Insight.created_at >= today_start)
            .order_by(Insight.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()
        if existing:
            return {
                "id": existing.id, "content": existing.content, "provider": existing.provider,
                "model": existing.model, "created_at": existing.created_at.isoformat(),
            }
    return generate_insight(db, question=DAILY_QUESTION, scope=DAILY_SCOPE)
