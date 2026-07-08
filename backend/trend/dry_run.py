"""Backend-only trend collector/scorer dry-run orchestration."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence

from .scoring import score_trend_candidate
from .web_provider import (
    collect_google_cse_fixture_observations,
    load_google_cse_fixture,
    normalize_allowed_domains,
    resolve_google_cse_provider_status,
)


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def run_trend_dry_run(
    *,
    candidates: Sequence[Mapping[str, Any]],
    fixture_path: str | Path | None = None,
    env: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Return dry-run artifacts without mutating Supabase or approved overlays."""

    provider_status = resolve_google_cse_provider_status(env)
    allowed_domains = normalize_allowed_domains((env or {}).get("TREND_WEB_SEARCH_ALLOWED_DOMAINS"))
    observations: list[dict[str, Any]] = []
    discarded: list[dict[str, Any]] = []
    web_summary = {"allowedResultCount": 0, "discardedDisallowedDomainCount": 0}

    if fixture_path is not None:
        fixture = load_google_cse_fixture(fixture_path)
        collected = collect_google_cse_fixture_observations(fixture, allowed_domains=allowed_domains)
        observations = collected["observations"]
        discarded = collected["discarded"]
        web_summary = collected["summary"]

    provider_warning = None
    if provider_status["status"] in {"web_search_disabled", "web_search_provider_missing"}:
        provider_warning = provider_status["status"]

    proposals: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for candidate in candidates:
        enriched = dict(candidate)
        if "allowedWebResultCount" not in enriched:
            enriched["allowedWebResultCount"] = web_summary["allowedResultCount"]
        score_breakdown = score_trend_candidate(enriched, provider_warning=provider_warning)
        candidate_id = str(enriched.get("id") or enriched.get("restaurant", {}).get("id") or "candidate")
        if score_breakdown["isProposal"]:
            proposals.append(
                {
                    "candidateId": candidate_id,
                    "restaurantId": enriched.get("restaurant", {}).get("id"),
                    "overlayType": enriched.get("overlayType", "trend"),
                    "proposalStatus": "pending",
                    "score": score_breakdown["score"],
                    "scoreBreakdown": score_breakdown,
                    "evidence": {
                        "mode": "dry_run",
                        "webObservationCount": web_summary["allowedResultCount"],
                        "discardedDisallowedDomainCount": web_summary["discardedDisallowedDomainCount"],
                    },
                }
            )
        else:
            skipped.append(
                {
                    "candidateId": candidate_id,
                    "score": score_breakdown["score"],
                    "blockedReasons": score_breakdown["blockedReasons"],
                    "warnings": score_breakdown["warnings"],
                }
            )

    return {
        "schemaVersion": 1,
        "mode": "dry_run",
        "generatedAt": _iso_now(),
        "providerStatus": provider_status,
        "observations": observations,
        "discardedObservations": discarded,
        "proposals": proposals,
        "skippedCandidates": skipped,
        "approvedOverlayWrites": [],
        "summary": {
            "candidateCount": len(candidates),
            "proposalCount": len(proposals),
            "skippedCount": len(skipped),
            **web_summary,
        },
    }
