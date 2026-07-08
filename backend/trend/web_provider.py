"""Google CSE fixture/provider helpers for trend dry-runs.

This module intentionally performs no network access. Live Google CSE execution is
implemented only in later backend worker packages; Package F/G callers can use
these helpers to prove disabled/no-key/fixture behavior without raw page fetches.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Mapping

GOOGLE_CSE_PROVIDER = "google_cse"
DEFAULT_ALLOWED_DOMAINS = (
    "korean.visitkorea.or.kr",
    "www.korea.net",
    "www.mafra.go.kr",
    "www.kma.go.kr",
    "www.nongsaro.go.kr",
    "www.foodsafetykorea.go.kr",
    "www.mcst.go.kr",
    "www.youtube.com",
)
RAW_CONTENT_KEYS = {"rawHtml", "html", "body", "rawContent", "pageContent", "raw", "content"}


def normalize_allowed_domains(value: str | None = None) -> set[str]:
    if value is None:
        return set(DEFAULT_ALLOWED_DOMAINS)
    domains = {item.strip().lower() for item in value.split(",") if item.strip()}
    return domains or set(DEFAULT_ALLOWED_DOMAINS)


def resolve_google_cse_provider_status(env: Mapping[str, str] | None = None) -> dict[str, Any]:
    environ = env or os.environ
    enabled = environ.get("TREND_WEB_SEARCH_ENABLED", "0") == "1"
    provider = environ.get("TREND_WEB_SEARCH_PROVIDER", "disabled")
    if not enabled:
        return {"provider": GOOGLE_CSE_PROVIDER, "enabled": False, "status": "web_search_disabled", "fatal": False}
    if provider != GOOGLE_CSE_PROVIDER:
        return {"provider": provider, "enabled": False, "status": "web_search_provider_invalid", "fatal": True}
    if not environ.get("GOOGLE_CSE_API_KEY") or not environ.get("GOOGLE_CSE_CX"):
        return {"provider": GOOGLE_CSE_PROVIDER, "enabled": True, "status": "web_search_provider_missing", "fatal": False}
    return {"provider": GOOGLE_CSE_PROVIDER, "enabled": True, "status": "ready", "fatal": False}


def load_google_cse_fixture(path: str | Path) -> dict[str, Any]:
    fixture = json.loads(Path(path).read_text(encoding="utf-8"))
    if fixture.get("provider") != GOOGLE_CSE_PROVIDER:
        raise ValueError("trend_web_fixture_provider_invalid")
    _assert_no_raw_content_keys(fixture)
    return fixture


def _assert_no_raw_content_keys(value: Any) -> None:
    if isinstance(value, list):
        for item in value:
            _assert_no_raw_content_keys(item)
        return
    if not isinstance(value, dict):
        return
    forbidden = RAW_CONTENT_KEYS.intersection(value.keys())
    if forbidden:
        raise ValueError(f"trend_web_fixture_raw_content_forbidden:{sorted(forbidden)[0]}")
    for item in value.values():
        _assert_no_raw_content_keys(item)


def collect_google_cse_fixture_observations(
    fixture: Mapping[str, Any],
    *,
    allowed_domains: set[str] | None = None,
) -> dict[str, Any]:
    domains = allowed_domains or set(DEFAULT_ALLOWED_DOMAINS)
    observations: list[dict[str, Any]] = []
    discarded: list[dict[str, Any]] = []

    for query in fixture.get("queries", []):
        template_id = query.get("templateId")
        rendered_query = query.get("renderedQuery")
        for item in query.get("response", {}).get("items", []):
            display_link = str(item.get("displayLink") or "").lower()
            observation = {
                "source_type": "web_search",
                "signal_key": f"google_cse:{template_id}",
                "source_url": item.get("link"),
                "raw_excerpt": str(item.get("snippet") or "")[:500],
                "provenance": {
                    "provider": GOOGLE_CSE_PROVIDER,
                    "templateId": template_id,
                    "renderedQuery": rendered_query,
                    "displayLink": display_link,
                    "title": item.get("title"),
                    "allowlisted": display_link in domains,
                },
            }
            if display_link in domains:
                observations.append(observation)
            else:
                discarded.append({**observation, "discardReason": "discarded_disallowed_domain"})

    return {
        "observations": observations,
        "discarded": discarded,
        "summary": {
            "allowedResultCount": len(observations),
            "discardedDisallowedDomainCount": len(discarded),
        },
    }
