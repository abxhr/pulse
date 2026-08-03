"""Best-effort content fetchers for recipe extraction from a URL.

YouTube: reliable — public oEmbed for title, a page-scrape for the description
(where most recipe ingredient lists actually live), and auto-captions via
youtube-transcript-api when available.

Instagram: inherently unreliable — Instagram blocks most unauthenticated scraping
and there's no public API for this. We try the public post page's og:description
meta tag (works for some posts, not others) and fail gracefully with a clear
message when it doesn't, since there's no legitimate way to guarantee this works.
"""
from __future__ import annotations
import html
import logging
import re

import requests

log = logging.getLogger("pulse.recipe_sources")

_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"


def _youtube_id(url: str) -> str | None:
    m = re.search(r"(?:v=|youtu\.be/|shorts/)([A-Za-z0-9_-]{11})", url)
    return m.group(1) if m else None


def fetch_youtube_content(url: str) -> dict:
    vid = _youtube_id(url)
    if not vid:
        raise ValueError("Doesn't look like a YouTube URL")

    title = None
    try:
        r = requests.get("https://www.youtube.com/oembed", params={"url": url, "format": "json"}, timeout=10)
        if r.ok:
            title = r.json().get("title")
    except Exception as e:
        log.debug("oembed failed: %s", e)

    description = None
    try:
        r = requests.get(f"https://www.youtube.com/watch?v={vid}", headers={"User-Agent": _UA}, timeout=10)
        m = re.search(r'"shortDescription":"(.*?)","isCrawlable"', r.text)
        if m:
            description = html.unescape(m.group(1).encode().decode("unicode_escape"))
    except Exception as e:
        log.debug("description scrape failed: %s", e)

    transcript = None
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        api = YouTubeTranscriptApi()
        entries = api.fetch(vid)
        transcript = " ".join(e.text for e in entries)
    except Exception as e:
        log.debug("transcript fetch failed: %s", e)

    if not title and not description and not transcript:
        raise ValueError("Couldn't read anything from this video — it may be private or age-restricted.")

    return {"title": title, "description": description, "transcript": transcript}


def fetch_instagram_content(url: str) -> dict:
    try:
        r = requests.get(url, headers={"User-Agent": _UA}, timeout=10)
    except Exception as e:
        raise ValueError(f"Couldn't reach Instagram: {e}")

    caption = None
    m = re.search(r'<meta property="og:description" content="([^"]*)"', r.text)
    if m:
        caption = html.unescape(m.group(1))
    m2 = re.search(r'<meta property="og:title" content="([^"]*)"', r.text)
    title = html.unescape(m2.group(1)) if m2 else None

    if not caption:
        raise ValueError(
            "Instagram blocked reading this post's caption (very common — it usually "
            "requires login). Paste the recipe caption text in manually instead."
        )
    return {"title": title, "caption": caption}
