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
from pathlib import Path
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
    pending_reason = None
    location_match = row.get("evaluation_results")
    if isinstance(location_match, Mapping):
        location_match = location_match.get("location_match_TF")
    if isinstance(location_match, Mapping):
        raw_reason = location_match.get("pending_reason")
        pending_reason = raw_reason if isinstance(raw_reason, str) else None
    match_status = None
    if isinstance(location_match, Mapping):
        raw_status = location_match.get("match_status")
        match_status = raw_status if isinstance(raw_status, str) else None
    if pending_reason in {"ambiguous_chain", "multi_candidate", "insufficient_evidence"}:
        if match_status != "confirmed_from_video":
            return "skip_unconfirmed_map"
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


def _json_request(
    url: str,
    *,
    key: str,
    method: str = "GET",
    payload: Mapping[str, Any] | None = None,
    extra_headers: Mapping[str, str] | None = None,
) -> tuple[int, Any]:
    from urllib.request import Request, urlopen
    from urllib.error import HTTPError

    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
    }
    if extra_headers:
        headers.update(extra_headers)
    body = None
    if payload is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = Request(url, data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=30) as response:
            raw = response.read()
            parsed = json.loads(raw.decode("utf-8")) if raw else None
            return int(response.status), parsed
    except HTTPError as exc:
        raw = exc.read()
        try:
            parsed = json.loads(raw.decode("utf-8")) if raw else None
        except ValueError:
            parsed = None
        return int(exc.code), parsed


def fetch_hosted_restaurant_snapshot(
    *,
    url: str,
    service_role_key: str,
) -> tuple[list[str], list[str]]:
    assert_hosted_target(url)
    if not service_role_key.strip():
        _deny("hosted_key_missing")
    rows: list[dict[str, Any]] = []
    start = 0
    page = 1000
    while True:
        end = start + page - 1
        status, payload = _json_request(
            f"{url.rstrip('/')}/rest/v1/restaurants?select=id,youtube_link,youtube_meta&order=id.asc",
            key=service_role_key,
            extra_headers={"Range": f"{start}-{end}", "Prefer": "count=exact"},
        )
        if status not in {200, 206}:
            _deny("hosted_snapshot_failed")
        if not isinstance(payload, list):
            _deny("hosted_snapshot_failed")
        rows.extend(item for item in payload if isinstance(item, dict))
        if len(payload) < page:
            break
        start += page
        if start > 50_000:
            _deny("hosted_snapshot_unbounded")
    ids = [str(row["id"]) for row in rows if row.get("id")]
    youtube_ids = [vid for row in rows if (vid := row_youtube_id(row))]
    return ids, youtube_ids


def load_evaluation_rows(path: str) -> list[dict[str, Any]]:
    source = Path(path)
    if not source.is_file():
        return []
    rows: list[dict[str, Any]] = []
    for line in source.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        parsed = json.loads(line)
        if isinstance(parsed, dict):
            rows.append(parsed)
    return rows


def apply_pending_candidates(
    *,
    preview: Mapping[str, Any],
    evaluation_rows: Iterable[Mapping[str, Any]],
    url: str,
    service_role_key: str,
    environment: Mapping[str, str],
    presented_preview_sha256: str,
    fetch=None,
) -> dict[str, Any]:
    """Insert preview-selected pending rows only. Never overwrite existing restaurants."""
    assert_hosted_target(url)
    assert_apply_authorized(
        preview,
        environment=environment,
        presented_preview_sha256=presented_preview_sha256,
    )
    allowed = set(preview.get("applyCandidateVideoIds") or [])
    if preview.get("applyCandidateCount") != len(allowed):
        _deny("candidate_count_mismatch")
    if preview.get("dockerRestaurantApply"):
        _deny("forbidden_local_docker_apply")
    inserted: list[str] = []
    skipped: list[str] = []
    unresolved: list[str] = []
    # Per-candidate mutually-exclusive outcome by stable identity (video id).
    # Precedence keeps a candidate in exactly one bucket when duplicate rows map
    # to the same identity: an applied record dominates an already-present skip,
    # which dominates an unresolved classification (R4.4).
    _APPLIED, _PRESENT, _UNRESOLVED = 3, 2, 1
    outcome: dict[str, int] = {}
    requester = fetch or _json_request
    for row in evaluation_rows:
        video_id = row_youtube_id(row)
        if video_id is None or video_id not in allowed:
            continue
        payload = pending_insert_payload(row)
        if payload["status"] != "pending":
            _deny("approved_status_forbidden")
        status, _body = requester(
            f"{url.rstrip('/')}/rest/v1/restaurants?on_conflict=trace_id",
            key=service_role_key,
            method="POST",
            payload=payload,
            extra_headers={
                "Prefer": "return=minimal,resolution=ignore-duplicates",
            },
        )
        if status in {201, 200}:
            inserted.append(video_id)
            rank = _APPLIED
        elif status == 409:
            # Already present on hosted (insert-if-absent): skip, never duplicate.
            skipped.append(video_id)
            rank = _PRESENT
        else:
            # Hosted presence could not be determined for this candidate. Skip it
            # without creating a record and classify as unresolved rather than
            # aborting the whole run; applied records are never rolled back
            # (R4.6, R4.7).
            unresolved.append(video_id)
            rank = _UNRESOLVED
        if rank > outcome.get(video_id, 0):
            outcome[video_id] = rank
    # Every admitted candidate must have been processed into some bucket; the
    # three reflection lists then partition the processed set (R4.4).
    unexpected = sorted(allowed - set(outcome))
    if unexpected:
        _deny("candidate_not_applied")
    reflection = {
        "applied": sorted(v for v, r in outcome.items() if r == _APPLIED),
        "skippedAlreadyPresent": sorted(
            v for v, r in outcome.items() if r == _PRESENT
        ),
        "unresolved": sorted(v for v, r in outcome.items() if r == _UNRESOLVED),
    }
    return {
        "insertedVideoIds": inserted,
        "skippedExistingVideoIds": skipped,
        "insertedCount": len(inserted),
        "previewSha256": presented_preview_sha256,
        "reflection": reflection,
    }
