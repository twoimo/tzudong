#!/usr/bin/env python3
"""Stage-aware reprocess/tagging for unresolved geocoding failures.

Read-only by design: this script reads the DB-aware actionable queue from the
refined-data audit, optionally retries NCP geocoding/Naver local search, and
writes local triage reports.  It never mutates transforms.jsonl or Supabase.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable

import requests

BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from utils.runtime_paths import load_backend_env, resolve_backend_root

DEFAULT_TRANSFORMS = Path("restaurant-evaluation/data/tzuyang/evaluation/transforms.jsonl")
DEFAULT_QUEUE = Path(
    "../.omx/reports/refined-data/final-actionable/actionable_after_db_lock/01_pure_geocoding_failures.jsonl"
)
DEFAULT_REPORT_DIR = Path("../.omx/reports/refined-data/stage-reprocess")
LOCAL_URL = "https://openapi.naver.com/v1/search/local.json"
GEOCODE_URL = "https://maps.apigw.ntruss.com/map-geocode/v2/geocode"
COARSE_SUFFIX_RE = re.compile(r"(동|읍|면|리|구|시|군)$")
STREET_OR_LOT_RE = re.compile(r"(\d|로\b|길\b|번지|산\s*\d)")
HTML_TAG_RE = re.compile(r"<[^>]+>")


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def norm_space(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"\s+", " ", HTML_TAG_RE.sub("", value)).strip()


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            row = json.loads(line)
            row.setdefault("_line", line_number)
            rows.append(row)
    return rows


def trace_id_set(rows: Iterable[dict[str, Any]]) -> set[str]:
    return {str(row["trace_id"]) for row in rows if row.get("trace_id")}


def origin_address_text(record: dict[str, Any]) -> str:
    origin_address = record.get("origin_address")
    if isinstance(origin_address, dict):
        for key in ("address", "roadAddress", "jibunAddress"):
            value = norm_space(origin_address.get(key))
            if value:
                return value
    return norm_space(origin_address)


def first_nonempty(record: dict[str, Any], fields: tuple[str, ...]) -> str:
    for field in fields:
        value = norm_space(record.get(field))
        if value:
            return value
    return ""


def is_address_coarse(address: str) -> bool:
    address = norm_space(address)
    if not address:
        return True
    parts = address.split()
    if len(parts) <= 3 and COARSE_SUFFIX_RE.search(parts[-1] if parts else ""):
        return True
    return not bool(STREET_OR_LOT_RE.search(address))


def float_or_none(value: Any) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def source_coordinates(record: dict[str, Any]) -> tuple[float | None, float | None]:
    lat = float_or_none(record.get("lat"))
    lng = float_or_none(record.get("lng"))
    if lat is not None and lng is not None:
        return lat, lng
    origin_address = record.get("origin_address")
    if isinstance(origin_address, dict):
        return float_or_none(origin_address.get("lat")), float_or_none(origin_address.get("lng"))
    return None, None


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def load_env() -> None:
    load_backend_env(resolve_backend_root(Path(__file__).resolve()), prefer_local=False)


def api_headers() -> tuple[dict[str, str], dict[str, str]]:
    return (
        {
            "X-Naver-Client-Id": os.getenv("NAVER_CLIENT_ID_BYEON", ""),
            "X-Naver-Client-Secret": os.getenv("NAVER_CLIENT_SECRET_BYEON", ""),
        },
        {
            "X-NCP-APIGW-API-KEY-ID": os.getenv("NCP_MAPS_KEY_ID_BYEON", ""),
            "X-NCP-APIGW-API-KEY": os.getenv("NCP_MAPS_KEY_BYEON", ""),
        },
    )


def has_required_api_env() -> bool:
    return all(
        os.getenv(name)
        for name in ("NAVER_CLIENT_ID_BYEON", "NAVER_CLIENT_SECRET_BYEON", "NCP_MAPS_KEY_ID_BYEON", "NCP_MAPS_KEY_BYEON")
    )


def ncp_geocode(query: str, headers_ncp: dict[str, str], timeout: float) -> dict[str, Any]:
    if not query:
        return {"ok": False, "status": "empty_query", "addresses": []}
    try:
        response = requests.get(GEOCODE_URL, headers=headers_ncp, params={"query": query}, timeout=timeout)
        response.raise_for_status()
        payload = response.json() if response.content else {}
        addresses = payload.get("addresses", []) if isinstance(payload, dict) else []
        return {"ok": bool(addresses), "status": "ok" if addresses else "no_result", "addresses": addresses[:3]}
    except Exception as exc:  # noqa: BLE001 - report only, no secret values
        return {"ok": False, "status": "api_error", "error_type": exc.__class__.__name__, "addresses": []}


def naver_local_search(query: str, headers_local: dict[str, str], timeout: float, display: int = 5) -> dict[str, Any]:
    if not query:
        return {"ok": False, "status": "empty_query", "items": []}
    try:
        response = requests.get(
            LOCAL_URL,
            headers=headers_local,
            params={"query": query, "display": display, "sort": "comment"},
            timeout=timeout,
        )
        response.raise_for_status()
        payload = response.json() if response.content else {}
        raw_items = payload.get("items", []) if isinstance(payload, dict) else []
        items = []
        for item in raw_items[:display]:
            items.append(
                {
                    "title": norm_space(item.get("title")),
                    "category": norm_space(item.get("category")),
                    "address": norm_space(item.get("address")),
                    "roadAddress": norm_space(item.get("roadAddress")),
                    "mapx": item.get("mapx"),
                    "mapy": item.get("mapy"),
                }
            )
        return {"ok": bool(items), "status": "ok" if items else "no_result", "items": items}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "status": "api_error", "error_type": exc.__class__.__name__, "items": []}


def build_search_query(name: str, address: str) -> str:
    if name and address:
        parts = address.split()
        locality = " ".join(parts[:2]) if len(parts) >= 2 else address
        return f"{name} {locality}"
    return name or address


def candidate_distance_summary(record: dict[str, Any], candidates: list[dict[str, Any]]) -> dict[str, Any]:
    source_lat, source_lng = source_coordinates(record)
    if source_lat is None or source_lng is None:
        return {"has_source_coordinates": False, "nearest_distance_m": None}

    distances: list[float] = []
    for candidate in candidates:
        # Naver local mapx/mapy are scaled integer longitude/latitude values.
        cand_lng = float_or_none(candidate.get("mapx"))
        cand_lat = float_or_none(candidate.get("mapy"))
        if cand_lng is None or cand_lat is None:
            continue
        if abs(cand_lat) > 1000:
            cand_lat /= 10000000.0
        if abs(cand_lng) > 1000:
            cand_lng /= 10000000.0
        distances.append(haversine_m(source_lat, source_lng, cand_lat, cand_lng))
    return {
        "has_source_coordinates": True,
        "nearest_distance_m": round(min(distances), 1) if distances else None,
    }


def tag_stage1(record: dict[str, Any], geocode_result: dict[str, Any], live_api: bool) -> tuple[str, list[str], str]:
    address = origin_address_text(record)
    if live_api and geocode_result.get("ok"):
        return "reprocess_candidate", ["source_geocode_recovered", "retry_location_match"], "rerun_rule_evaluation_with_recovered_source_geocode"
    tags = ["source_location_unresolved"]
    if is_address_coarse(address):
        tags.extend(["source_address_too_coarse", "recrawl_target"])
        action = "recrawl_or_manual_source_address_enrichment"
    elif live_api and geocode_result.get("status") == "no_result":
        tags.extend(["geocoder_no_result", "possible_bad_source_address"])
        action = "manual_address_review_or_recrawl"
    elif live_api and geocode_result.get("status") == "api_error":
        tags.extend(["geocoder_api_error", "retry_later"])
        action = "retry_geocoder_after_api_check"
    else:
        tags.append("needs_live_geocode_retry" if not live_api else "manual_address_review")
        action = "retry_stage1_geocode"
    return "unresolved", tags, action


def tag_stage2(
    record: dict[str, Any],
    search_result: dict[str, Any],
    distance_summary: dict[str, Any],
    live_api: bool,
) -> tuple[str, list[str], str]:
    tags = ["candidate_location_mismatch"]
    if not live_api:
        tags.append("needs_live_local_search_retry")
        return "unresolved", tags, "retry_stage2_local_search"

    if search_result.get("status") == "api_error":
        tags.extend(["naver_local_api_error", "retry_later"])
        return "unresolved", tags, "retry_local_search_after_api_check"

    items = search_result.get("items") or []
    if not items:
        tags.extend(["naver_local_no_candidate", "possibly_closed_or_renamed"])
        return "unresolved", tags, "manual_search_or_closed_business_check"

    nearest_distance = distance_summary.get("nearest_distance_m")
    if nearest_distance is None:
        tags.extend(["source_coordinates_missing", "retry_source_geocode"])
        return "unresolved", tags, "rerun_stage1_source_geocode_then_stage2"
    if nearest_distance <= 50:
        tags.extend(["nearby_candidate_found", "retry_location_match_threshold_review"])
        return "reprocess_candidate", tags, "rerun_rule_evaluation_with_candidate_review"
    if len(items) > 1:
        tags.extend(["multiple_candidates", "manual_disambiguation"])
    if nearest_distance > 1000:
        tags.extend(["candidate_far_from_source", "bad_source_data_or_wrong_restaurant", "recrawl_target"])
        return "unresolved", tags, "recrawl_source_evidence_or_manual_geocode"
    tags.extend(["candidate_distance_mismatch", "manual_location_review"])
    return "unresolved", tags, "manual_distance_review"


def tag_geocoder_failed(record: dict[str, Any], geocode_result: dict[str, Any], live_api: bool) -> tuple[str, list[str], str]:
    if live_api and geocode_result.get("ok"):
        return "reprocess_candidate", ["geocoder_retry_recovered", "retry_location_match"], "rerun_rule_evaluation_with_recovered_geocode"
    tags = ["geocoder_failed_or_no_result"]
    if live_api and geocode_result.get("status") == "api_error":
        tags.extend(["geocoder_api_error", "retry_later"])
        action = "retry_geocoder_after_api_check"
    elif is_address_coarse(origin_address_text(record)):
        tags.extend(["source_address_too_coarse", "recrawl_target"])
        action = "recrawl_or_manual_source_address_enrichment"
    else:
        tags.extend(["geocoder_no_result", "manual_address_review"])
        action = "manual_address_review_or_recrawl"
    return "unresolved", tags, action


def classify_record(
    record: dict[str, Any],
    queue_row: dict[str, Any],
    live_api: bool,
    headers_local: dict[str, str],
    headers_ncp: dict[str, str],
    timeout: float,
) -> dict[str, Any]:
    stage = queue_row.get("geocoding_failure_bucket") or "unknown"
    name = first_nonempty(record, ("origin_name", "naver_name", "google_name"))
    address = origin_address_text(record)
    geocode_result: dict[str, Any] = {"status": "skipped", "addresses": []}
    search_result: dict[str, Any] = {"status": "skipped", "items": []}
    source_lat, source_lng = source_coordinates(record)
    distance_summary = {"has_source_coordinates": source_lat is not None and source_lng is not None, "nearest_distance_m": None}

    if live_api and stage in {"source_location_unresolved", "geocoder_failed_or_no_result"}:
        geocode_result = ncp_geocode(address, headers_ncp, timeout)
        time.sleep(0.03)
    if live_api and stage == "candidate_location_mismatch":
        search_result = naver_local_search(build_search_query(name, address), headers_local, timeout)
        distance_summary = candidate_distance_summary(record, search_result.get("items") or [])
        time.sleep(0.03)

    if stage == "source_location_unresolved":
        resolution_status, tags, action = tag_stage1(record, geocode_result, live_api)
    elif stage == "candidate_location_mismatch":
        resolution_status, tags, action = tag_stage2(record, search_result, distance_summary, live_api)
    elif stage == "geocoder_failed_or_no_result":
        resolution_status, tags, action = tag_geocoder_failed(record, geocode_result, live_api)
    else:
        resolution_status, tags, action = "unresolved", ["unknown_stage", "manual_review"], "manual_review"

    return {
        "trace_id": record.get("trace_id"),
        "line": record.get("_line"),
        "stage": stage,
        "resolution_status": resolution_status,
        "problem_tags": sorted(set(tags)),
        "recommended_action": action,
        "origin_name": record.get("origin_name"),
        "naver_name": record.get("naver_name"),
        "google_name": record.get("google_name"),
        "origin_address_text": address,
        "address_is_coarse": is_address_coarse(address),
        "source_lat": source_lat,
        "source_lng": source_lng,
        "youtube_link": record.get("youtube_link"),
        "live_api": live_api,
        "geocode_retry_status": geocode_result.get("status"),
        "geocode_retry_address_count": len(geocode_result.get("addresses") or []),
        "local_search_status": search_result.get("status"),
        "local_search_candidate_count": len(search_result.get("items") or []),
        "nearest_candidate_distance_m": distance_summary.get("nearest_distance_m"),
        "candidate_samples": (search_result.get("items") or [])[:3],
        "geocode_samples": (geocode_result.get("addresses") or [])[:2],
    }


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    tag_counter: Counter[str] = Counter(tag for row in rows for tag in row.get("problem_tags", []))
    action_counter = Counter(row.get("recommended_action") for row in rows)
    stage_counter = Counter(row.get("stage") for row in rows)
    status_counter = Counter(row.get("resolution_status") for row in rows)
    by_stage_status: dict[str, Counter[str]] = defaultdict(Counter)
    by_stage_action: dict[str, Counter[str]] = defaultdict(Counter)
    for row in rows:
        by_stage_status[row.get("stage")][row.get("resolution_status")] += 1
        by_stage_action[row.get("stage")][row.get("recommended_action")] += 1
    return {
        "total": len(rows),
        "stage_counter": dict(stage_counter),
        "resolution_status_counter": dict(status_counter),
        "problem_tag_counter": dict(tag_counter),
        "recommended_action_counter": dict(action_counter),
        "by_stage_status": {stage: dict(counter) for stage, counter in by_stage_status.items()},
        "by_stage_action": {stage: dict(counter) for stage, counter in by_stage_action.items()},
    }


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def write_markdown(path: Path, payload: dict[str, Any]) -> None:
    summary = payload["summary"]
    lines = [
        "# Stage Reprocess Tagging Report",
        "",
        f"- generated_at: `{payload['generated_at']}`",
        f"- mode: `{'live-api' if payload['live_api'] else 'offline-tagging'}`",
        f"- total: {summary['total']}",
        "",
        "## Stage counts",
        "",
    ]
    for key, value in sorted(summary["stage_counter"].items()):
        lines.append(f"- `{key}`: {value}")
    lines += ["", "## Resolution status", ""]
    for key, value in sorted(summary["resolution_status_counter"].items()):
        lines.append(f"- `{key}`: {value}")
    lines += ["", "## Recommended actions", ""]
    for key, value in sorted(summary["recommended_action_counter"].items()):
        lines.append(f"- `{key}`: {value}")
    lines += ["", "## Top problem tags", ""]
    for key, value in sorted(summary["problem_tag_counter"].items(), key=lambda item: (-item[1], item[0]))[:30]:
        lines.append(f"- `{key}`: {value}")
    lines += [
        "",
        "## Output files",
        "",
        "- `stage-reprocess-tags.jsonl`: all tagged records",
        "- `reprocess_candidates.jsonl`: rows that recovered enough evidence to rerun rule evaluation",
        "- `unresolved_tagged.jsonl`: rows still needing manual review/recrawl/closed-business checks",
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Tag stage-specific unresolved geocoding failures")
    parser.add_argument("--transforms", type=Path, default=DEFAULT_TRANSFORMS)
    parser.add_argument("--queue", type=Path, default=DEFAULT_QUEUE)
    parser.add_argument("--report-dir", type=Path, default=DEFAULT_REPORT_DIR)
    parser.add_argument("--live-api", action="store_true", help="Retry NCP/Naver read APIs before tagging")
    parser.add_argument("--timeout", type=float, default=8.0)
    parser.add_argument("--limit", type=int, default=0, help="Limit processed rows for smoke tests")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.live_api:
        load_env()
        if not has_required_api_env():
            raise SystemExit("required Naver/NCP API env vars are missing")
    headers_local, headers_ncp = api_headers()

    transforms = load_jsonl(args.transforms)
    records_by_trace = {str(row["trace_id"]): row for row in transforms if row.get("trace_id")}
    queue_rows = load_jsonl(args.queue)
    if args.limit and args.limit > 0:
        queue_rows = queue_rows[: args.limit]

    results = []
    for queue_row in queue_rows:
        trace_id = str(queue_row.get("trace_id") or "")
        record = records_by_trace.get(trace_id)
        if not record:
            results.append(
                {
                    "trace_id": trace_id,
                    "stage": queue_row.get("geocoding_failure_bucket") or "unknown",
                    "resolution_status": "unresolved",
                    "problem_tags": ["missing_transform_record", "recrawl_target"],
                    "recommended_action": "recover_transform_or_recrawl",
                    "live_api": args.live_api,
                }
            )
            continue
        results.append(classify_record(record, queue_row, args.live_api, headers_local, headers_ncp, args.timeout))

    report_dir = args.report_dir
    report_dir.mkdir(parents=True, exist_ok=True)
    reprocess_candidates = [row for row in results if row.get("resolution_status") == "reprocess_candidate"]
    unresolved = [row for row in results if row.get("resolution_status") != "reprocess_candidate"]
    payload = {
        "generated_at": utc_now(),
        "live_api": args.live_api,
        "source_queue": str(args.queue),
        "source_transforms": str(args.transforms),
        "report_dir": str(report_dir),
        "summary": summarize(results),
    }

    write_jsonl(report_dir / "stage-reprocess-tags.jsonl", results)
    write_jsonl(report_dir / "reprocess_candidates.jsonl", reprocess_candidates)
    write_jsonl(report_dir / "unresolved_tagged.jsonl", unresolved)
    (report_dir / "stage-reprocess-summary.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    write_markdown(report_dir / "stage-reprocess-summary.md", payload)
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
