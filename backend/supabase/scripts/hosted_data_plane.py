#!/usr/bin/env python3
"""Operation-bound hosted data-plane planner.

Local Docker restaurants are a disjoint test set and must never replace hosted
production rows. Evaluation jsonl may contain geocoded pending candidates that
hosted does not yet have. Oversized crawl artifacts are classified for R2, not
Postgres. Environment variables alone never enable writes; preview hash plus
TZUDONG_HOSTED_DATA_PLANE_APPROVED=1 plus hosted readback are required.
Pending review inserts do not consult G037_WRITE_FREEZE. That freeze still
blocks account deletion, retention, migration apply, and approved-row refresh.
PIPELINE_HOSTED_APPLY_ENABLED stays untouched. Inserts are always status pending.
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
TRACE_ID_RE = re.compile(r"[0-9a-f]{64}")


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
    *,
    hosted_trace_ids: Iterable[str] | None = None,
    hosted_ambiguous_youtube_ids: Iterable[str] = (),
) -> str:
    video_id = row_youtube_id(row)
    if not video_id:
        return "skip_no_video"
    if hosted_trace_ids is not None:
        if video_id in hosted_ambiguous_youtube_ids:
            return "skip_hosted_identity_ambiguous"
        trace_id = row.get("trace_id")
        if not isinstance(trace_id, str) or not TRACE_ID_RE.fullmatch(trace_id):
            return "skip_invalid_identity"
        if trace_id in hosted_trace_ids:
            return "skip_already_on_hosted"
    elif video_id in hosted_youtube_ids:
        return "skip_already_on_hosted"
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
            return "apply_candidate_pending_review"
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


APPLY_CANDIDATE_LABELS = frozenset(
    {"apply_candidate_pending_geocoded", "apply_candidate_pending_review"}
)


def preview_hash(payload: Mapping[str, Any]) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode(
        "utf-8"
    )
    return hashlib.sha256(canonical).hexdigest()


def _preview_body(preview: Mapping[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in preview.items() if key != "previewSha256"}


def apply_payload_sha256(
    rows: Iterable[Mapping[str, Any]],
    hosted_youtube_ids: Iterable[str],
    *,
    hosted_trace_ids: Iterable[str] | None = None,
    hosted_ambiguous_youtube_ids: Iterable[str] = (),
) -> str:
    """Hash only the rows that preview would insert, in a stable order."""
    if hosted_trace_ids is not None:
        hosted_trace_ids = set(hosted_trace_ids)
    payloads = [
        pending_insert_payload(row)
        for row in rows
        if classify_evaluation_row(
            row, hosted_youtube_ids, hosted_trace_ids=hosted_trace_ids,
            hosted_ambiguous_youtube_ids=hosted_ambiguous_youtube_ids,
        ) in APPLY_CANDIDATE_LABELS
    ]
    payloads.sort(
        key=lambda item: (
            str(item.get("youtube_link") or ""),
            str(item.get("trace_id") or ""),
            str(item.get("origin_name") or ""),
        )
    )
    return preview_hash({"payloads": payloads})


def build_apply_preview(
    *,
    local_restaurant_ids: Iterable[str],
    hosted_restaurant_ids: Iterable[str],
    hosted_youtube_ids: Iterable[str],
    evaluation_rows: Iterable[Mapping[str, Any]],
    hosted_trace_ids: Iterable[str] | None = None,
    hosted_ambiguous_youtube_ids: Iterable[str] = (),
) -> dict[str, Any]:
    hosted_ambiguous_youtube_ids = list(hosted_ambiguous_youtube_ids)
    if hosted_ambiguous_youtube_ids and hosted_trace_ids is None:
        _deny("hosted_identity_mode_required")
    if any(
        not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{11}", value)
        for value in hosted_ambiguous_youtube_ids
    ):
        _deny("hosted_video_identity_invalid")
    hosted_ambiguous_youtube_ids = set(hosted_ambiguous_youtube_ids)
    if hosted_trace_ids is not None:
        hosted_trace_ids = list(hosted_trace_ids)
        if any(
            not isinstance(value, str) or not TRACE_ID_RE.fullmatch(value)
            for value in hosted_trace_ids
        ):
            _deny("hosted_identity_invalid")
        hosted_trace_ids = set(hosted_trace_ids)
    docker_class = classify_local_docker_restaurants(
        local_restaurant_ids, hosted_restaurant_ids
    )
    rows_list = list(evaluation_rows)
    candidates: list[str] = []
    trace_candidates: list[str] = []
    classes: dict[str, int] = {}
    for row in rows_list:
        label = classify_evaluation_row(
            row, hosted_youtube_ids, hosted_trace_ids=hosted_trace_ids,
            hosted_ambiguous_youtube_ids=hosted_ambiguous_youtube_ids,
        )
        classes[label] = classes.get(label, 0) + 1
        if label in APPLY_CANDIDATE_LABELS:
            video_id = row_youtube_id(row)
            if video_id:
                candidates.append(video_id)
                if hosted_trace_ids is not None:
                    trace_candidates.append(row["trace_id"])
    candidates = sorted(set(candidates))
    if len(trace_candidates) != len(set(trace_candidates)):
        _deny("candidate_identity_duplicate")
    payload = {
        "schemaVersion": 2 if hosted_trace_ids is not None else 1,
        "hostedProjectRef": HOSTED_PROJECT_REF,
        "dockerRestaurantClass": docker_class,
        "dockerRestaurantApply": [],
        "evaluationClasses": classes,
        "applyCandidateVideoIds": candidates,
        "applyCandidateCount": len(trace_candidates) if hosted_trace_ids is not None else len(candidates),
        "applyPayloadSha256": apply_payload_sha256(
            rows_list, hosted_youtube_ids, hosted_trace_ids=hosted_trace_ids,
            hosted_ambiguous_youtube_ids=hosted_ambiguous_youtube_ids,
        ),
        "insertStatus": "pending",
        "overwriteApprovedForbidden": True,
    }
    if hosted_trace_ids is not None:
        payload["candidateIdentity"] = "trace_id"
        payload["applyCandidateTraceIds"] = sorted(trace_candidates)
        payload["hostedAmbiguousVideoIds"] = sorted(hosted_ambiguous_youtube_ids)
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
    recomputed = preview_hash(_preview_body(preview))
    if (
        not isinstance(expected, str)
        or expected != recomputed
        or expected != presented_preview_sha256
    ):
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
        "evaluation_results": row.get("evaluation_results")
        if isinstance(row.get("evaluation_results"), Mapping)
        else None,
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
    from urllib.error import HTTPError, URLError

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
            try:
                parsed = json.loads(raw.decode("utf-8")) if raw else None
            except json.JSONDecodeError:
                _deny("hosted_response_invalid")
            return int(response.status), parsed
    except HostedDataPlaneError:
        raise
    except HTTPError as exc:
        raw = exc.read()
        try:
            parsed = json.loads(raw.decode("utf-8")) if raw else None
        except json.JSONDecodeError:
            parsed = None
        return int(exc.code), parsed
    except (URLError, TimeoutError, OSError):
        _deny("hosted_request_failed")


def fetch_hosted_restaurant_snapshot(
    *,
    url: str,
    service_role_key: str,
    include_trace_ids: bool = False,
) -> tuple[list[str], list[str]] | tuple[list[str], list[str], list[str], list[str]]:
    """Default to the legacy pair; identity mode adds valid traces and blocked videos.

    A hosted row with a malformed trace blocks only its known video. If its
    video cannot be identified, no safe scope exists and the snapshot fails.
    """
    assert_hosted_target(url)
    if not service_role_key.strip():
        _deny("hosted_key_missing")
    rows: list[dict[str, Any]] = []
    start = 0
    page = 1000
    while True:
        end = start + page - 1
        select = "id,youtube_link,youtube_meta,trace_id" if include_trace_ids else "id,youtube_link,youtube_meta"
        status, payload = _json_request(
            f"{url.rstrip('/')}/rest/v1/restaurants?select={select}&order=id.asc",
            key=service_role_key,
            extra_headers={"Range": f"{start}-{end}", "Prefer": "count=exact"},
        )
        if status not in {200, 206}:
            _deny("hosted_snapshot_failed")
        if not isinstance(payload, list):
            _deny("hosted_snapshot_failed")
        if any(not isinstance(item, dict) for item in payload):
            _deny("hosted_snapshot_failed")
        rows.extend(payload)
        if len(payload) < page:
            break
        start += page
        if start > 50_000:
            _deny("hosted_snapshot_unbounded")
    ids = [str(row["id"]) for row in rows if row.get("id")]
    youtube_ids = [vid for row in rows if (vid := row_youtube_id(row))]
    if include_trace_ids:
        trace_ids: list[str] = []
        ambiguous_video_ids: set[str] = set()
        for row in rows:
            value = row.get("trace_id")
            if isinstance(value, str) and TRACE_ID_RE.fullmatch(value):
                trace_ids.append(value)
            else:
                video_ids = {
                    video_id for video_id in (
                        row_youtube_id(row),
                        extract_youtube_video_id(row.get("youtube_link")),
                    ) if video_id is not None
                }
                if not video_ids:
                    _deny("hosted_identity_unscoped")
                ambiguous_video_ids.update(video_ids)
        return ids, youtube_ids, trace_ids, sorted(ambiguous_video_ids)
    return ids, youtube_ids


def load_evaluation_rows(path: str) -> list[dict[str, Any]]:
    source = Path(path)
    if not source.is_file():
        return []
    rows: list[dict[str, Any]] = []
    for line in source.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            _deny("evaluation_row_invalid")
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
    trace_mode = preview.get("schemaVersion") == 2
    if trace_mode and preview.get("candidateIdentity") != "trace_id":
        _deny("candidate_identity_invalid")
    allowed = set(preview.get("applyCandidateVideoIds") or [])
    allowed_traces = set(preview.get("applyCandidateTraceIds") or []) if trace_mode else set()
    ambiguous_videos = set(preview.get("hostedAmbiguousVideoIds") or []) if trace_mode else set()
    if trace_mode and (
        any(not isinstance(value, str) or not TRACE_ID_RE.fullmatch(value) for value in allowed_traces)
        or len(preview.get("applyCandidateTraceIds") or []) != len(allowed_traces)
    ):
        _deny("candidate_identity_invalid")
    if preview.get("applyCandidateCount") != (len(allowed_traces) if trace_mode else len(allowed)):
        _deny("candidate_count_mismatch")
    if trace_mode and (
        allowed & ambiguous_videos
        or any(not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{11}", value)
               for value in ambiguous_videos)
    ):
        _deny("candidate_identity_ambiguous")
    if preview.get("dockerRestaurantApply"):
        _deny("forbidden_local_docker_apply")
    rows_list = list(evaluation_rows)
    hosted_for_rows = [
        video_id for row in rows_list
        if (video_id := row_youtube_id(row)) and video_id not in allowed
    ] if not trace_mode else []
    hosted_traces = {
        trace_id for row in rows_list
        if isinstance((trace_id := row.get("trace_id")), str)
        and TRACE_ID_RE.fullmatch(trace_id) and trace_id not in allowed_traces
    } if trace_mode else None
    if trace_mode:
        selected = [
            row for row in rows_list
            if isinstance(row.get("trace_id"), str)
            and row["trace_id"] in allowed_traces
        ]
        if len(selected) != len(allowed_traces) or any(
            row_youtube_id(row) not in allowed for row in selected
        ):
            _deny("candidate_identity_mismatch")
    if apply_payload_sha256(
        rows_list, hosted_for_rows, hosted_trace_ids=hosted_traces,
        hosted_ambiguous_youtube_ids=ambiguous_videos,
    ) != preview.get("applyPayloadSha256"):
        _deny("apply_payload_mismatch")
    inserted: list[str] = []
    skipped: list[str] = []
    unresolved: list[str] = []
    row_receipts: list[dict[str, str]] = []
    # Legacy reflection has one row per video. Trace mode keeps the video-level
    # contract but lets any unresolved restaurant dominate partial success.
    _APPLIED, _PRESENT, _UNRESOLVED = 3, 2, 1
    outcome: dict[str, int] = {}
    requester = fetch or _json_request
    for row in rows_list:
        video_id = row_youtube_id(row)
        if video_id is None or video_id not in allowed:
            continue
        trace_id = row.get("trace_id")
        if trace_mode and (
            not isinstance(trace_id, str) or trace_id not in allowed_traces
        ):
            continue
        if classify_evaluation_row(
            row, hosted_for_rows, hosted_trace_ids=hosted_traces,
            hosted_ambiguous_youtube_ids=ambiguous_videos,
        ) not in APPLY_CANDIDATE_LABELS:
            continue
        payload = pending_insert_payload(row)
        if payload["status"] != "pending":
            _deny("approved_status_forbidden")
        try:
            status, body = requester(
                f"{url.rstrip('/')}/rest/v1/restaurants?on_conflict=trace_id",
                key=service_role_key,
                method="POST",
                payload=payload,
                extra_headers={
                    "Prefer": (
                        "return=representation,resolution=ignore-duplicates"
                        if trace_mode else "return=minimal,resolution=ignore-duplicates"
                    ),
                },
            )
        except HostedDataPlaneError:
            if not trace_mode:
                raise
            status, body = 0, None
        if trace_mode:
            # A successful HTTP response can be an ignored duplicate. Confirm
            # the exact row on hosted, and use representation to prove creation.
            try:
                read_status, read_rows = requester(
                    f"{url.rstrip('/')}/rest/v1/restaurants?select=id,trace_id,status&trace_id=eq.{trace_id}",
                    key=service_role_key,
                )
            except HostedDataPlaneError:
                read_status, read_rows = 0, None
            present_rows = (
                read_rows if read_status in {200, 206} and isinstance(read_rows, list)
                else []
            )
            present = (
                len(present_rows) == 1
                and isinstance(present_rows[0], dict)
                and present_rows[0].get("trace_id") == trace_id
                and bool(present_rows[0].get("id"))
                and isinstance(present_rows[0].get("status"), str)
                and bool(present_rows[0]["status"].strip())
            )
            created = (
                status in {200, 201}
                and isinstance(body, list)
                and len(body) == 1
                and isinstance(body[0], dict)
                and body[0].get("trace_id") == trace_id
                and bool(body[0].get("id"))
                and body[0].get("status") == "pending"
                and present
                and body[0]["id"] == present_rows[0]["id"]
                and present_rows[0]["status"] == "pending"
            )
            already_present = present and (
                status == 409
                or status in {200, 201} and body == []
            )
            if created:
                rank = _APPLIED
                inserted.append(video_id)
                row_outcome = "applied"
            elif already_present:
                rank = _PRESENT
                skipped.append(video_id)
                row_outcome = "skippedAlreadyPresent"
            else:
                rank = _UNRESOLVED
                unresolved.append(video_id)
                row_outcome = "unresolved"
            row_receipts.append({
                "videoId": video_id,
                "traceId": trace_id,
                "outcome": row_outcome,
                "postStatus": str(status),
                "readbackStatus": str(read_status),
                "hostedStatus": present_rows[0]["status"] if present else "unverified",
            })
        elif status in {201, 200}:
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
        if trace_mode:
            replace_outcome = rank == _UNRESOLVED or (
                outcome.get(video_id) != _UNRESOLVED
                and rank > outcome.get(video_id, 0)
            )
        else:
            replace_outcome = rank > outcome.get(video_id, 0)
        if replace_outcome:
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
    if trace_mode:
        # Keep the established per-video reflection while exposing each row's
        # result, including partial success within one video.
        reflection["applied"] = sorted(
            video_id for video_id in allowed
            if outcome.get(video_id) == _APPLIED
        )
        reflection["skippedAlreadyPresent"] = sorted(
            video_id for video_id in allowed
            if outcome.get(video_id) == _PRESENT
        )
        reflection["unresolved"] = sorted(
            video_id for video_id in allowed
            if outcome.get(video_id) == _UNRESOLVED
        )
    return {
        "insertedVideoIds": sorted(set(inserted)) if trace_mode else inserted,
        "skippedExistingVideoIds": sorted(set(skipped)) if trace_mode else skipped,
        "insertedCount": len(inserted),
        "previewSha256": presented_preview_sha256,
        "reflection": reflection,
        **({"rowReceipts": row_receipts} if trace_mode else {}),
    }
