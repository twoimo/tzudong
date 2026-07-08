"""Deterministic v1 scoring for backend-only trend overlay proposals."""

from __future__ import annotations

from datetime import datetime, timezone
from math import log1p
from statistics import median
from typing import Any, Mapping

SCORING_VERSION = "trend_overlay_scoring_v1"
PROPOSAL_THRESHOLD = 65.0
HIGH_CONFIDENCE_THRESHOLD = 82.0

COMPONENT_WEIGHTS = {
    "youtubeKpi": 0.45,
    "proposalRecurrence": 0.20,
    "seasonality": 0.20,
    "webContext": 0.10,
    "adminReviewActivity": 0.05,
}

FAIL_CLOSED_BLOCKERS = (
    "restaurant_not_approved",
    "restaurant_deleted",
    "restaurant_coordinates_missing",
    "restaurant_video_match_ambiguous",
    "insufficient_evidence",
    "active_overlay_exists",
)


def clamp100(value: float) -> float:
    if value < 0:
        return 0.0
    if value > 100:
        return 100.0
    return float(value)


def _round2(value: float) -> float:
    return round(float(value), 2)


def _parse_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not isinstance(value, str) or not value:
        return None
    normalized = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _recency_score(published_at: Any, now: datetime | None = None) -> float:
    published = _parse_datetime(published_at)
    if published is None:
        return 20.0
    current = now or datetime.now(timezone.utc)
    age_days = max(0.0, (current - published).total_seconds() / 86400)
    if age_days <= 7:
        return 100.0
    if age_days <= 30:
        return 60.0
    return 20.0


def score_youtube_kpi_with_comparison(snapshot: Mapping[str, Any], now: datetime | None = None) -> dict[str, Any]:
    current_views = max(0.0, float(snapshot.get("currentViews") or 0))
    previous_views = max(0.0, float(snapshot.get("previousViews") or 0))
    current_engagement = max(0.0, float(snapshot.get("currentLikes") or 0) + float(snapshot.get("currentComments") or 0))
    previous_engagement = max(0.0, float(snapshot.get("previousLikes") or 0) + float(snapshot.get("previousComments") or 0))

    view_velocity = clamp100((current_views - previous_views) / max(previous_views, 1.0) * 100)
    engagement_velocity = clamp100((current_engagement - previous_engagement) / max(previous_engagement, 1.0) * 100)
    recency = _recency_score(snapshot.get("publishedAt"), now)
    score = _round2(0.55 * view_velocity + 0.30 * engagement_velocity + 0.15 * recency)
    return {
        "score": score,
        "warnings": [],
        "debug": {
            "viewVelocity": _round2(view_velocity),
            "engagementVelocity": _round2(engagement_velocity),
            "recencyBoost": recency,
        },
    }


def score_latest_only_youtube_kpi(
    *,
    latest_views: float,
    benchmark_views: float,
    latest_likes: float = 0,
    latest_comments: float = 0,
    benchmark_engagement: float = 1,
    published_at: Any = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Score latest-only KPI fallback capped at 55 per pass-7 contract."""

    safe_benchmark_views = max(float(benchmark_views or 0), 1.0)
    safe_benchmark_engagement = max(float(benchmark_engagement or 0), 1.0)
    safe_latest_views = max(float(latest_views or 0), 0.0)
    safe_latest_engagement = max(float(latest_likes or 0) + float(latest_comments or 0), 0.0)

    latest_only_view_score = min(55.0, _round2(55.0 * log1p(safe_latest_views) / log1p(safe_benchmark_views)))
    latest_only_engagement_score = min(
        35.0,
        _round2(35.0 * log1p(safe_latest_engagement) / log1p(safe_benchmark_engagement)),
    )
    recency = _recency_score(published_at, now)
    component = min(
        55.0,
        _round2(0.70 * latest_only_view_score + 0.20 * latest_only_engagement_score + 0.10 * recency),
    )
    return {
        "score": component,
        "warnings": ["youtube_comparison_missing", "youtube_latest_only_capped_55"],
        "debug": {
            "latestOnlyViewScore": latest_only_view_score,
            "latestOnlyEngagementScore": latest_only_engagement_score,
            "recencyScore": recency,
        },
    }


def score_youtube_kpi(snapshots: list[Mapping[str, Any]], now: datetime | None = None) -> dict[str, Any]:
    if not snapshots:
        return {"score": 0.0, "warnings": ["youtube_kpi_missing"], "debug": {}}

    comparable = [item for item in snapshots if item.get("previousViews") is not None]
    if comparable:
        scored = [score_youtube_kpi_with_comparison(item, now) for item in comparable]
        return max(scored, key=lambda item: item["score"])

    positive_views = [max(0.0, float(item.get("latestViews") or item.get("currentViews") or 0)) for item in snapshots]
    positive_views = [item for item in positive_views if item > 0]
    benchmark_views = median(positive_views) if positive_views else 1.0
    positive_engagement = [
        max(0.0, float(item.get("latestLikes") or item.get("currentLikes") or 0) + float(item.get("latestComments") or item.get("currentComments") or 0))
        for item in snapshots
    ]
    positive_engagement = [item for item in positive_engagement if item > 0]
    benchmark_engagement = median(positive_engagement) if positive_engagement else 1.0
    scored = [
        score_latest_only_youtube_kpi(
            latest_views=float(item.get("latestViews") or item.get("currentViews") or 0),
            benchmark_views=benchmark_views,
            latest_likes=float(item.get("latestLikes") or item.get("currentLikes") or 0),
            latest_comments=float(item.get("latestComments") or item.get("currentComments") or 0),
            benchmark_engagement=benchmark_engagement,
            published_at=item.get("publishedAt"),
            now=now,
        )
        for item in snapshots
    ]
    return max(scored, key=lambda item: item["score"])


def score_web_context(allowed_result_count: int, provider_warning: str | None = None) -> dict[str, Any]:
    score = min(max(int(allowed_result_count), 0), 5) * 20.0
    warnings = [provider_warning] if provider_warning else []
    return {"score": score, "warnings": warnings, "debug": {"allowedResultCount": min(max(int(allowed_result_count), 0), 5)}}


def _component_from_candidate(candidate: Mapping[str, Any], key: str, fallback: float = 0.0) -> dict[str, Any]:
    component_scores = candidate.get("componentScores")
    if isinstance(component_scores, Mapping) and key in component_scores:
        return {"score": clamp100(float(component_scores[key])), "warnings": [], "debug": {}}
    return {"score": clamp100(float(candidate.get(key, fallback) or 0)), "warnings": [], "debug": {}}


def _blocked_reasons(candidate: Mapping[str, Any], web_score: float) -> list[str]:
    blockers: list[str] = []
    restaurant = candidate.get("restaurant") if isinstance(candidate.get("restaurant"), Mapping) else {}
    if restaurant.get("status") != "approved":
        blockers.append("restaurant_not_approved")
    if restaurant.get("deleted") is True or restaurant.get("is_deleted") is True:
        blockers.append("restaurant_deleted")
    if restaurant.get("lat") is None or restaurant.get("lng") is None:
        blockers.append("restaurant_coordinates_missing")
    if candidate.get("ambiguousVideoMatch") is True and "needs_identity_review" not in candidate.get("warnings", []):
        blockers.append("restaurant_video_match_ambiguous")
    if candidate.get("activeOverlayExists") is True and candidate.get("supersedeIntent") is not True:
        blockers.append("active_overlay_exists")
    non_web_components = [
        candidate.get("componentScores", {}).get("youtubeKpi", 0) if isinstance(candidate.get("componentScores"), Mapping) else candidate.get("youtubeKpi", 0),
        candidate.get("componentScores", {}).get("proposalRecurrence", 0) if isinstance(candidate.get("componentScores"), Mapping) else candidate.get("proposalRecurrence", 0),
        candidate.get("componentScores", {}).get("seasonality", 0) if isinstance(candidate.get("componentScores"), Mapping) else candidate.get("seasonality", 0),
        candidate.get("componentScores", {}).get("adminReviewActivity", 0) if isinstance(candidate.get("componentScores"), Mapping) else candidate.get("adminReviewActivity", 0),
    ]
    if web_score > 0 and all(float(value or 0) <= 0 for value in non_web_components):
        blockers.append("insufficient_evidence")
    blockers.extend(str(item) for item in candidate.get("blockedReasons", []) if item in FAIL_CLOSED_BLOCKERS)
    return sorted(set(blockers))


def score_trend_candidate(candidate: Mapping[str, Any], *, provider_warning: str | None = None, now: datetime | None = None) -> dict[str, Any]:
    youtube = (
        score_youtube_kpi(candidate.get("youtubeKpiSnapshots", []), now)
        if candidate.get("youtubeKpiSnapshots") is not None
        else _component_from_candidate(candidate, "youtubeKpi")
    )
    recurrence = _component_from_candidate(candidate, "proposalRecurrence")
    seasonality = _component_from_candidate(candidate, "seasonality")
    if isinstance(candidate.get("componentScores"), Mapping) and "webContext" in candidate["componentScores"]:
        web_context = {"score": clamp100(float(candidate["componentScores"]["webContext"])), "warnings": [provider_warning] if provider_warning else [], "debug": {}}
    else:
        web_context = score_web_context(int(candidate.get("allowedWebResultCount") or 0), provider_warning)
    admin = _component_from_candidate(candidate, "adminReviewActivity")

    components = {
        "youtubeKpi": youtube,
        "proposalRecurrence": recurrence,
        "seasonality": seasonality,
        "webContext": web_context,
        "adminReviewActivity": admin,
    }
    total = round(
        sum(COMPONENT_WEIGHTS[name] * float(components[name]["score"]) for name in COMPONENT_WEIGHTS),
        4,
    )
    warnings = sorted({warning for component in components.values() for warning in component.get("warnings", [])} | set(candidate.get("warnings", [])))
    blockers = _blocked_reasons(candidate, float(web_context["score"]))
    is_proposal = total >= PROPOSAL_THRESHOLD and not blockers

    return {
        "version": SCORING_VERSION,
        "score": total,
        "thresholds": {"proposal": PROPOSAL_THRESHOLD, "highConfidence": HIGH_CONFIDENCE_THRESHOLD},
        "components": {
            name: {
                "weight": COMPONENT_WEIGHTS[name],
                "score": float(components[name]["score"]),
                "evidenceObservationIds": sorted(candidate.get("evidenceObservationIds", {}).get(name, []))
                if isinstance(candidate.get("evidenceObservationIds"), Mapping)
                else [],
                "warnings": components[name].get("warnings", []),
            }
            for name in COMPONENT_WEIGHTS
        },
        "blockedReasons": blockers,
        "warnings": warnings,
        "isProposal": is_proposal,
        "confidence": "high" if total >= HIGH_CONFIDENCE_THRESHOLD and not blockers else "normal",
    }
