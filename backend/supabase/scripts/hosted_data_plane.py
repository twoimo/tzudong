#!/usr/bin/env python3
"""Operation-bound hosted data-plane planner.

Local Docker restaurants are a disjoint test set and must never replace hosted
production rows. Evaluation jsonl may contain geocoded pending candidates that
hosted does not yet have. Oversized crawl artifacts are classified for R2, not
Postgres. Environment variables alone never enable writes; preview hash plus
TZUDONG_HOSTED_DATA_PLANE_APPROVED=1 plus hosted readback are required.
PIPELINE_HOSTED_APPLY_ENABLED stays untouched.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Iterable, Mapping
from urllib.parse import urlsplit

HOSTED_PROJECT_REF = "aqlcofblfxdrjhhdmarw"
HOSTED_URL = f"https://{HOSTED_PROJECT_REF}.supabase.co"
APPROVAL_ENV = "TZUDONG_HOSTED_DATA_PLANE_APPROVED"
SYNTHETIC_UUID_RE = re.compile(
    r"^00000000-0000-4000-8000-[0-9a-f]{12}$",
    re.IGNORECASE,
)
YOUTUBE_ID_RE = re.compile(
    r"(?:v=|/shorts/|/live/|youtu\.be/)([A-Za-z0-9_-]{11})"
)
R2_MIN_BYTES = 1_000_000


class HostedDataPlaneError(RuntimeError):
    """Credential-safe planner/apply failure."""


def _deny(code: str) -> None:
    raise HostedDataPlaneError(code) from None


def extract_youtube_video_id(raw: Any) -> str | None:
    if not isinstance(raw, str) or not raw.strip():
        return None
    match = YOUTUBE_ID_RE.search(raw)
    if match:
        return match.group(1)
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", raw.strip()):
        return raw.strip()
    return None


def row_youtube_id(row: Mapping[str, Any]) -> str | None:
    meta = row.get("youtube_meta")
    if isinstance(meta, dict):
        for key in ("video_id", "id"):
            value = meta.get(key)
            if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]{11}", value):
                return value
    return extract_youtube_video_id(row.get("youtube_link"))


def classify_local_docker_restaurants(
    local_ids: Iterable[str],
    hosted_ids: Iterable[str],
) -> str:
    local = [str(item) for item in local_ids]
    hosted = set(str(item) for item in hosted_ids)
    if not local:
        return "empty"
    if set(local) & hosted:
        return "overlap_review_required"
    if any(SYNTHETIC_UUID_RE.fullmatch(item) for item in local):
        return "forbidden_disjoint_local_test_db"
    return "forbidden_disjoint_local_db"


def classify_evaluation_row(
    row: Mapping[str, Any],
    hosted_youtube_ids: Iterable[str],
) -> str:
    hosted = set(hosted_youtube_ids)
    video_id = row_youtube_id(row)
    if video_id and video_id in hosted:
        return "skip_already_on_hosted"
    if not video_id:
        return "skip_no_video"
    if bool(row.get("is_missing")):
        return "skip_missing"
    if bool(row.get("is_notSelected") or row.get("is_not_selected")):
        return "skip_notSelected"
    geo = bool(row.get("geocoding_success"))
    has_coords = row.get("lat") not in (None, "") and row.get("lng") not in (None, "")
    if not geo or not has_coords:
        return "skip_no_geocode"
    return "apply_candidate_pending_geocoded"


def classify_blob(path: str, size_bytes: int) -> str:
    if size_bytes >= R2_MIN_BYTES:
        return "r2_offload"
    if path.endswith((".jsonl", ".mp4", ".jpg", ".jpeg", ".png", ".webp", ".tar.gz")):
        if "restaurant-crawling" in path or "heatmap" in path or "transcript" in path:
            return "local_pipeline_artifact"
    return "postgres_ok"


def preview_hash(payload: Mapping[str, Any]) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def build_apply_preview(
    *,
    local_restaurant_ids: Iterable[str],
    hosted_restaurant_ids: Iterable[str],
    hosted_youtube_ids: Iterable[str],
    evaluation_rows: Iterable[Mapping[str, Any]],
) -> dict[str, Any]:
    docker_class = classify_local_docker_restaurants(
        local_restaurant_ids, hosted_restaurant_ids
    )
    candidates: list[str] = []
    classes: dict[str, int] = {}
    for row in evaluation_rows:
        label = classify_evaluation_row(row, hosted_youtube_ids)
        classes[label] = classes.get(label, 0) + 1
        if label == "apply_candidate_pending_geocoded":
            video_id = row_youtube_id(row)
            if video_id:
                candidates.append(video_id)
    candidates = sorted(set(candidates))
    payload = {
        "schemaVersion": 1,
        "hostedProjectRef": HOSTED_PROJECT_REF,
        "dockerRestaurantClass": docker_class,
        "dockerRestaurantApply": [],
        "evaluationClasses": classes,
        "applyCandidateVideoIds": candidates,
        "applyCandidateCount": len(candidates),
        "insertStatus": "pending",
        "overwriteApprovedForbidden": True,
    }
    payload["previewSha256"] = preview_hash(
        {key: value for key, value in payload.items() if key != "previewSha256"}
    )
    return payload


def assert_hosted_target(url: str) -> None:
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname != f"{HOSTED_PROJECT_REF}.supabase.co":
        _deny("hosted_target_mismatch")
    if parsed.path not in ("", "/"):
        _deny("hosted_target_mismatch")


def assert_apply_authorized(
    preview: Mapping[str, Any],
    *,
    environment: Mapping[str, str],
    presented_preview_sha256: str,
) -> None:
    if preview.get("dockerRestaurantClass", "").startswith("forbidden"):
        if preview.get("dockerRestaurantApply"):
            _deny("forbidden_local_docker_apply")
    expected = preview.get("previewSha256")
    if not isinstance(expected, str) or expected != presented_preview_sha256:
        _deny("preview_hash_mismatch")
    if environment.get(APPROVAL_ENV) != "1":
        _deny("approval_missing")
    if preview.get("insertStatus") != "pending":
        _deny("approved_status_forbidden")
    if preview.get("overwriteApprovedForbidden") is not True:
        _deny("overwrite_guard_missing")


def pending_insert_payload(row: Mapping[str, Any]) -> dict[str, Any]:
    """Map an evaluation row to a pending restaurant insert. Never marks approved."""
    video_id = row_youtube_id(row)
    if not video_id:
        _deny("missing_video_id")
    return {
        "trace_id": row.get("trace_id"),
        "youtube_link": f"https://www.youtube.com/watch?v={video_id}",
        "status": "pending",
        "origin_name": row.get("origin_name"),
        "naver_name": row.get("naver_name"),
        "google_name": row.get("google_name"),
        "categories": row.get("category") if isinstance(row.get("category"), list) else [],
        "tzuyang_review": row.get("youtuber_review"),
        "origin_address": row.get("origin_address"),
        "road_address": row.get("roadAddress"),
        "jibun_address": row.get("jibunAddress"),
        "english_address": row.get("englishAddress"),
        "lat": row.get("lat"),
        "lng": row.get("lng"),
        "geocoding_success": bool(row.get("geocoding_success")),
        "is_missing": bool(row.get("is_missing")),
        "is_not_selected": bool(row.get("is_notSelected") or row.get("is_not_selected")),
        "youtube_meta": row.get("youtube_meta"),
        "source_type": row.get("source_type"),
        "review_count": 0,
    }


def r2_public_object_url(account_hash: str, key: str) -> str:
    """Use Cloudflare-issued r2.dev, never an invented DNS name."""
    if not re.fullmatch(r"[a-z0-9]{8,64}", account_hash):
        _deny("r2_public_host_invalid")
    if not key or key.startswith("/") or ".." in key:
        _deny("r2_key_invalid")
    return f"https://pub-{account_hash}.r2.dev/{key}"
