#!/usr/bin/env python3
"""Package rule-rerun matches for admin review without mutating source data.

This script consumes a scratch rule-rerun report and writes review artifacts:
- matched candidates that can be inspected before any DB/data sync
- unresolved follow-up queues split by pending reason
- a summary that makes promotion risk explicit

It is intentionally report-only.  It never writes to transforms.jsonl or
Supabase.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import requests

BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from utils.runtime_paths import load_backend_env, resolve_backend_root

DEFAULT_TRANSFORMS = Path("restaurant-evaluation/data/tzuyang/evaluation/transforms.jsonl")
DEFAULT_REPORT_ROOT = Path("../.omx/reports/refined-data")
LOCAL_URL = "https://openapi.naver.com/v1/search/local.json"
LARGE_DISTANCE_M = 200.0
VERY_LARGE_DISTANCE_M = 1000.0
HTML_TAG_RE = re.compile(r"<[^>]+>")
COARSE_SUFFIX_RE = re.compile(r"(동|읍|면|리|구|시|군)$")
STREET_OR_LOT_RE = re.compile(r"(\d|로\b|길\b|번지|산\s*\d)")


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def load_last_jsonl(path: Path) -> dict[str, Any]:
    last: dict[str, Any] | None = None
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                last = json.loads(line)
    if last is None:
        raise ValueError(f"empty jsonl file: {path}")
    return last


def latest_rule_rerun_report(root: Path) -> Path:
    candidates = sorted(root.glob("rule-rerun-expanded-*"), reverse=True)
    if not candidates:
        candidates = sorted(root.glob("rule-rerun-*"), reverse=True)
    if not candidates:
        raise FileNotFoundError(f"rule rerun report not found under {root}")
    return candidates[0]


def transforms_by_trace(path: Path) -> dict[str, dict[str, Any]]:
    indexed: dict[str, dict[str, Any]] = {}
    for line_number, row in enumerate(load_jsonl(path), 1):
        trace_id = row.get("trace_id")
        if trace_id:
            indexed[str(trace_id)] = {**row, "_line": line_number}
    return indexed


def find_location_result(rule_result: dict[str, Any], origin_name: str) -> dict[str, Any] | None:
    evaluations = rule_result.get("evaluation_results", {}).get("location_match_TF", [])
    if not isinstance(evaluations, list):
        return None
    for item in evaluations:
        if item.get("origin_name") == origin_name:
            return item
    return None


def matched_distance_m(location_result: dict[str, Any]) -> float | None:
    matched_address = location_result.get("matched_address")
    if isinstance(matched_address, dict):
        value = matched_address.get("distance")
        if isinstance(value, (int, float)):
            return float(value)
    naver_address = location_result.get("naver_address")
    if isinstance(naver_address, list) and naver_address and isinstance(naver_address[0], dict):
        value = naver_address[0].get("distance")
        if isinstance(value, (int, float)):
            return float(value)
    return None


def norm_space(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"\s+", " ", HTML_TAG_RE.sub("", value)).strip()


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


def origin_address_text(record: dict[str, Any]) -> str:
    origin_address = record.get("origin_address")
    if isinstance(origin_address, dict):
        for key in ("address", "roadAddress", "jibunAddress"):
            value = norm_space(origin_address.get(key))
            if value:
                return value
    return norm_space(origin_address)


def is_address_coarse(address: str) -> bool:
    address = norm_space(address)
    if not address:
        return True
    parts = address.split()
    if len(parts) <= 3 and COARSE_SUFFIX_RE.search(parts[-1] if parts else ""):
        return True
    return not bool(STREET_OR_LOT_RE.search(address))


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


def local_api_headers() -> dict[str, str]:
    return {
        "X-Naver-Client-Id": os.getenv("NAVER_CLIENT_ID_BYEON", ""),
        "X-Naver-Client-Secret": os.getenv("NAVER_CLIENT_SECRET_BYEON", ""),
    }


def has_local_api_env() -> bool:
    return bool(os.getenv("NAVER_CLIENT_ID_BYEON") and os.getenv("NAVER_CLIENT_SECRET_BYEON"))


def naver_local_search(query: str, headers: dict[str, str], timeout: float, display: int = 5) -> dict[str, Any]:
    if not query:
        return {"ok": False, "status": "empty_query", "items": []}
    try:
        response = requests.get(
            LOCAL_URL,
            headers=headers,
            params={"query": query, "display": display, "sort": "comment"},
            timeout=timeout,
        )
        response.raise_for_status()
        payload = response.json() if response.content else {}
        items = payload.get("items", [])
        return {"ok": bool(items), "status": "ok" if items else "no_result", "items": items[:display]}
    except Exception as exc:  # noqa: BLE001 - report status only, never secrets
        return {"ok": False, "status": "api_error", "error_type": exc.__class__.__name__, "items": []}


def multi_candidate_query(row: dict[str, Any]) -> str:
    return norm_space(f"{row.get('origin_name') or ''} {row.get('origin_address_text') or ''}")


def candidate_distance_m(source_record: dict[str, Any], candidate: dict[str, Any]) -> float | None:
    source_lat, source_lng = source_coordinates(source_record)
    cand_lng = float_or_none(candidate.get("mapx"))
    cand_lat = float_or_none(candidate.get("mapy"))
    if source_lat is None or source_lng is None or cand_lat is None or cand_lng is None:
        return None
    if abs(cand_lat) > 1000:
        cand_lat /= 10000000.0
    if abs(cand_lng) > 1000:
        cand_lng /= 10000000.0
    return round(haversine_m(source_lat, source_lng, cand_lat, cand_lng), 1)


def risk_flags(matched_row: dict[str, Any], source_record: dict[str, Any], location_result: dict[str, Any]) -> list[str]:
    flags: list[str] = []
    distance = matched_distance_m(location_result)
    if distance is not None and distance > VERY_LARGE_DISTANCE_M:
        flags.append("very_large_distance_over_1000m")
    elif distance is not None and distance > LARGE_DISTANCE_M:
        flags.append("large_distance_over_200m")

    if location_result.get("matched_provider") != "naver":
        flags.append("non_naver_match_provider")
    if location_result.get("pending_reason"):
        flags.append("has_pending_reason")
    if source_record.get("status") not in {"pending", "hold"}:
        flags.append("source_status_not_pending_or_hold")
    if source_record.get("geocoding_success") is True:
        flags.append("source_already_geocoding_success")
    if matched_row.get("recommended_action") == "rerun_stage1_source_geocode_then_stage2":
        flags.append("stage1_then_stage2_recovered")

    origin_name = str(matched_row.get("origin_name") or "")
    naver_name = str(location_result.get("naver_name") or "")
    if origin_name and naver_name and origin_name != naver_name:
        flags.append("matched_name_differs_from_origin_name")
    return sorted(set(flags))


def build_review_candidate(
    matched_row: dict[str, Any],
    source_record: dict[str, Any],
    location_result: dict[str, Any],
    rule_result_file: Path,
) -> dict[str, Any]:
    flags = risk_flags(matched_row, source_record, location_result)
    matched_address = location_result.get("matched_address")
    if not isinstance(matched_address, dict):
        matched_address = {}
    return {
        "trace_id": matched_row.get("trace_id"),
        "source_line": source_record.get("_line"),
        "youtube_link": matched_row.get("youtube_link"),
        "video_id": matched_row.get("video_id"),
        "origin_name": matched_row.get("origin_name"),
        "origin_address_text": matched_row.get("origin_address_text"),
        "source_status": source_record.get("status"),
        "source_geocoding_success": source_record.get("geocoding_success"),
        "source_geocoding_false_stage": source_record.get("geocoding_false_stage"),
        "recommended_action": matched_row.get("recommended_action"),
        "rule_result_file": str(rule_result_file),
        "review_recommendation": "admin_review_before_sync",
        "risk_flags": flags,
        "requires_manual_review": bool(flags),
        "matched_provider": location_result.get("matched_provider"),
        "matched_name": location_result.get("matched_name"),
        "naver_name": location_result.get("naver_name"),
        "google_name": location_result.get("google_name"),
        "matched_distance_m": matched_distance_m(location_result),
        "matched_road_address": matched_address.get("roadAddress"),
        "matched_jibun_address": matched_address.get("jibunAddress"),
        "evidence_summary": location_result.get("evidence_summary"),
        "evidence_families": location_result.get("evidence_families"),
        "proposed_sync_fields": {
            "geocoding_success": True,
            "geocoding_false_stage": None,
            "naver_name": location_result.get("naver_name"),
            "google_name": location_result.get("google_name"),
            "matched_provider": location_result.get("matched_provider"),
            "matched_name": location_result.get("matched_name"),
            "matched_address": location_result.get("matched_address"),
            "evidence_summary": location_result.get("evidence_summary"),
            "evidence_families": location_result.get("evidence_families"),
            "match_status": location_result.get("match_status"),
        },
}


def review_csv_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "trace_id": row.get("trace_id"),
        "source_line": row.get("source_line"),
        "origin_name": row.get("origin_name"),
        "naver_name": row.get("naver_name"),
        "matched_name": row.get("matched_name"),
        "origin_address_text": row.get("origin_address_text"),
        "matched_road_address": row.get("matched_road_address"),
        "matched_jibun_address": row.get("matched_jibun_address"),
        "matched_distance_m": row.get("matched_distance_m"),
        "recommended_action": row.get("recommended_action"),
        "risk_flags": ";".join(row.get("risk_flags") or []),
        "requires_manual_review": row.get("requires_manual_review"),
        "youtube_link": row.get("youtube_link"),
    }


def write_review_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    fieldnames = list(review_csv_row({}).keys())
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(review_csv_row(row))


def markdown_cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        value = ", ".join(str(item) for item in value)
    return str(value).replace("|", "\\|").replace("\n", " ")


def write_review_table(path: Path, rows: list[dict[str, Any]]) -> None:
    columns = (
        ("trace_id", "trace_id"),
        ("source_line", "line"),
        ("origin_name", "origin"),
        ("naver_name", "naver"),
        ("matched_distance_m", "distance_m"),
        ("risk_flags", "risk_flags"),
        ("youtube_link", "youtube"),
    )
    lines = [
        "# Matched Rule Rerun Review Table",
        "",
        "이 표는 DB/원본 데이터 반영 전 검수용 산출물입니다.",
        "",
        "| " + " | ".join(header for _, header in columns) + " |",
        "| " + " | ".join("---" for _ in columns) + " |",
    ]
    for row in rows:
        values = []
        for key, _ in columns:
            value = row.get(key)
            if key == "trace_id" and isinstance(value, str):
                value = value[:12]
            values.append(markdown_cell(value))
        lines.append("| " + " | ".join(values) + " |")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def unresolved_slug(row: dict[str, Any]) -> str:
    reason = row.get("pending_reason") or row.get("match_status") or "unknown"
    return str(reason).replace(" ", "_").replace("/", "_")


def write_unresolved_followups(output_dir: Path, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    queue_dir = output_dir / "unresolved_followup_queues"
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[unresolved_slug(row)].append(row)

    manifest = []
    for slug, queue_rows in sorted(grouped.items()):
        path = queue_dir / f"{slug}.jsonl"
        write_jsonl(path, queue_rows)
        manifest.append({"slug": slug, "count": len(queue_rows), "path": str(path)})
    (queue_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return manifest


def build_multi_candidate_comparisons(
    multi_rows: list[dict[str, Any]],
    transform_index: dict[str, dict[str, Any]],
    headers: dict[str, str],
    timeout: float,
) -> list[dict[str, Any]]:
    comparison_rows: list[dict[str, Any]] = []
    for row in multi_rows:
        trace_id = str(row.get("trace_id") or "")
        source_record = transform_index.get(trace_id, {})
        query = multi_candidate_query(row)
        result = naver_local_search(query, headers, timeout)
        items = result.get("items") or []
        if not items:
            comparison_rows.append(
                {
                    "trace_id": trace_id,
                    "video_id": row.get("video_id"),
                    "origin_name": row.get("origin_name"),
                    "origin_address_text": row.get("origin_address_text"),
                    "youtube_link": row.get("youtube_link"),
                    "search_query": query,
                    "search_status": result.get("status"),
                    "candidate_rank": None,
                    "candidate_title": None,
                    "candidate_category": None,
                    "candidate_road_address": None,
                    "candidate_jibun_address": None,
                    "candidate_distance_m": None,
                    "review_note": "no_live_candidate_returned",
                }
            )
            continue
        for rank, item in enumerate(items, 1):
            distance = candidate_distance_m(source_record, item)
            comparison_rows.append(
                {
                    "trace_id": trace_id,
                    "video_id": row.get("video_id"),
                    "origin_name": row.get("origin_name"),
                    "origin_address_text": row.get("origin_address_text"),
                    "youtube_link": row.get("youtube_link"),
                    "search_query": query,
                    "search_status": result.get("status"),
                    "candidate_rank": rank,
                    "candidate_title": norm_space(item.get("title")),
                    "candidate_category": norm_space(item.get("category")),
                    "candidate_road_address": norm_space(item.get("roadAddress")),
                    "candidate_jibun_address": norm_space(item.get("address")),
                    "candidate_distance_m": distance,
                    "review_note": "compare_candidate_against_video_evidence",
                }
            )
    return comparison_rows


def write_dict_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({field: row.get(field) for field in fieldnames})


def write_multi_candidate_tables(output_dir: Path, rows: list[dict[str, Any]]) -> dict[str, Any]:
    fieldnames = [
        "trace_id",
        "video_id",
        "origin_name",
        "origin_address_text",
        "search_query",
        "candidate_rank",
        "candidate_title",
        "candidate_category",
        "candidate_road_address",
        "candidate_jibun_address",
        "candidate_distance_m",
        "review_note",
        "youtube_link",
    ]
    write_jsonl(output_dir / "multi-candidate-comparison.jsonl", rows)
    write_dict_csv(output_dir / "multi-candidate-comparison.csv", rows, fieldnames)
    lines = [
        "# Multi-candidate Comparison Table",
        "",
        "이 표는 multi_candidate 후속 검수용 산출물이며 DB/원본 데이터 반영 전 검토 자료입니다.",
        "",
        "| trace_id | origin | rank | candidate | category | distance_m | road_address | youtube |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in rows:
        lines.append(
            "| "
            + " | ".join(
                [
                    markdown_cell(str(row.get("trace_id") or "")[:12]),
                    markdown_cell(row.get("origin_name")),
                    markdown_cell(row.get("candidate_rank")),
                    markdown_cell(row.get("candidate_title")),
                    markdown_cell(row.get("candidate_category")),
                    markdown_cell(row.get("candidate_distance_m")),
                    markdown_cell(row.get("candidate_road_address")),
                    markdown_cell(row.get("youtube_link")),
                ]
            )
            + " |"
        )
    (output_dir / "multi-candidate-comparison.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return {
        "multi_candidate_rows": len({row.get("trace_id") for row in rows}),
        "multi_candidate_comparison_rows": len(rows),
        "multi_candidate_trace_ids_with_live_candidates": len(
            {row.get("trace_id") for row in rows if row.get("candidate_rank") is not None}
        ),
    }



def address_region_tokens(address: str, limit: int = 3) -> str:
    return " ".join(norm_space(address).split()[:limit])


def coarse_address_level(address: str) -> str:
    """Classify how precise a source address is for recrawl triage."""
    address = norm_space(address)
    if not address:
        return "missing"
    if STREET_OR_LOT_RE.search(address):
        return "road_or_lot_present"
    parts = address.split()
    if not parts:
        return "missing"
    last = parts[-1]
    if last.endswith(("동", "읍", "면", "리")):
        return "dong_level"
    if last.endswith(("구", "시", "군")):
        return "district_or_city_level"
    return "coarse_unknown_level"


def is_private_or_masked_name(name: Any) -> bool:
    text = norm_space(name)
    return any(marker in text for marker in ("[비공개]", "비공개", "비공개 식당", "***"))


def searchable_name_hint(name: Any) -> str:
    text = norm_space(name)
    text = text.replace("[비공개]", " ").replace("비공개", " ").replace("***", " ")
    return norm_space(text)


def build_suggested_queries(row: dict[str, Any]) -> list[str]:
    name = norm_space(row.get("origin_name"))
    search_name = searchable_name_hint(name) or name
    address = norm_space(row.get("origin_address_text"))
    region = address_region_tokens(address)
    candidates = [
        f"{search_name} {address}",
        f"{search_name} {region}",
        f"{search_name} 맛집",
    ]
    if is_private_or_masked_name(name) and region:
        candidates.append(f"{region} {search_name}")
        candidates.append(f"{region} 맛집")
    seen: set[str] = set()
    queries: list[str] = []
    for query in candidates:
        query = norm_space(query)
        if query and query not in seen:
            seen.add(query)
            queries.append(query)
    return queries


def build_coarse_address_recrawl_jobs(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    jobs: list[dict[str, Any]] = []
    for row in rows:
        if row.get("recrawl_bucket") != "coarse_source_address_recrawl":
            continue
        address = norm_space(row.get("origin_address_text"))
        private_or_masked = is_private_or_masked_name(row.get("origin_name"))
        problem_tags = sorted(
            set(row.get("problem_tags") or [])
            | ({"private_masked_name_manual_review"} if private_or_masked else set())
        )
        jobs.append(
            {
                "trace_id": row.get("trace_id"),
                "source_line": row.get("source_line"),
                "video_id": row.get("video_id"),
                "youtube_link": row.get("youtube_link"),
                "origin_name": row.get("origin_name"),
                "current_coarse_address": address,
                "address_precision": coarse_address_level(address),
                "is_private_or_masked_name": private_or_masked,
                "source_selection_file": row.get("source_selection_file") or row.get("selection_file"),
                "suggested_search_queries": build_suggested_queries(row),
                "recrawl_instruction": "recover_precise_road_or_jibun_address_from_video_evidence",
                "required_evidence": [
                    "address_subtitle_or_caption",
                    "map_link_or_place_name",
                    "road_or_jibun_detail",
                    "candidate_source_timestamp_if_possible",
                ],
                "next_action": "recrawl_or_enrich_source_address_then_rerun_stage1_stage2",
                "problem_tags": problem_tags,
                "evidence_text": row.get("evidence_text"),
            }
        )
    return jobs


def coarse_address_recrawl_csv_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "trace_id": row.get("trace_id"),
        "source_line": row.get("source_line"),
        "origin_name": row.get("origin_name"),
        "current_coarse_address": row.get("current_coarse_address"),
        "address_precision": row.get("address_precision"),
        "is_private_or_masked_name": row.get("is_private_or_masked_name"),
        "suggested_search_queries": " ; ".join(row.get("suggested_search_queries") or []),
        "required_evidence": " ; ".join(row.get("required_evidence") or []),
        "problem_tags": ";".join(row.get("problem_tags") or []),
        "source_selection_file": row.get("source_selection_file"),
        "youtube_link": row.get("youtube_link"),
    }


def write_coarse_address_recrawl_outputs(output_dir: Path, rows: list[dict[str, Any]]) -> dict[str, Any]:
    jobs = build_coarse_address_recrawl_jobs(rows)
    write_jsonl(output_dir / "coarse-address-recrawl-jobs.jsonl", jobs)
    fieldnames = list(coarse_address_recrawl_csv_row({}).keys())
    write_dict_csv(
        output_dir / "coarse-address-recrawl-jobs.csv",
        [coarse_address_recrawl_csv_row(row) for row in jobs],
        fieldnames,
    )
    lines = [
        "# Coarse Address Recrawl Jobs",
        "",
        "이 표는 coarse_source_address_recrawl 버킷을 영상/출처 재확인 작업으로 실행하기 위한 report-only 작업 패키지입니다.",
        "",
        "| trace_id | origin | coarse_address | precision | private_or_masked | queries | youtube |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in jobs:
        lines.append(
            "| "
            + " | ".join(
                [
                    markdown_cell(str(row.get("trace_id") or "")[:12]),
                    markdown_cell(row.get("origin_name")),
                    markdown_cell(row.get("current_coarse_address")),
                    markdown_cell(row.get("address_precision")),
                    markdown_cell(row.get("is_private_or_masked_name")),
                    markdown_cell(row.get("suggested_search_queries")),
                    markdown_cell(row.get("youtube_link")),
                ]
            )
            + " |"
        )
    (output_dir / "coarse-address-recrawl-jobs.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    manifest = {
        "slug": "coarse_address_recrawl_jobs",
        "count": len(jobs),
        "jsonl_path": str(output_dir / "coarse-address-recrawl-jobs.jsonl"),
        "csv_path": str(output_dir / "coarse-address-recrawl-jobs.csv"),
        "markdown_path": str(output_dir / "coarse-address-recrawl-jobs.md"),
        "private_or_masked_count": sum(1 for row in jobs if row.get("is_private_or_masked_name")),
        "address_precision_counter": dict(Counter(row.get("address_precision") for row in jobs)),
    }
    (output_dir / "coarse-address-recrawl-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return {
        "coarse_address_recrawl_jobs": len(jobs),
        "coarse_address_private_or_masked": manifest["private_or_masked_count"],
        "coarse_address_precision_counter": manifest["address_precision_counter"],
        "coarse_address_recrawl_outputs": manifest,
    }


def name_query_variants(name: Any) -> list[str]:
    clean = searchable_name_hint(name)
    if not clean:
        return []
    candidates = [clean]
    parts = clean.split()
    if len(parts) > 1 and parts[-1].endswith(("점", "본점", "직영점")):
        candidates.append(" ".join(parts[:-1]))
    compact = re.sub(r"\s+", "", clean)
    if compact != clean:
        candidates.append(compact)
    seen: set[str] = set()
    variants: list[str] = []
    for candidate in candidates:
        candidate = norm_space(candidate)
        if candidate and candidate not in seen:
            seen.add(candidate)
            variants.append(candidate)
    return variants


def provider_search_queries(row: dict[str, Any]) -> list[str]:
    address = norm_space(row.get("origin_address_text"))
    region = address_region_tokens(address)
    candidates: list[str] = []
    for name in name_query_variants(row.get("origin_name")):
        candidates.extend(
            [
                f"{name} {address}",
                f"{name} {region}",
                name,
                f"{region} {name}",
            ]
        )
    seen: set[str] = set()
    queries: list[str] = []
    for query in candidates:
        query = norm_space(query)
        if query and query not in seen:
            seen.add(query)
            queries.append(query)
    return queries


def provider_name_review_flags(row: dict[str, Any]) -> list[str]:
    flags = {"closed_or_renamed_check", "provider_search_no_result"}
    variants = name_query_variants(row.get("origin_name"))
    if len(variants) > 1:
        flags.add("name_variant_query_check")
    if is_private_or_masked_name(row.get("origin_name")):
        flags.add("private_masked_name_manual_review")
    if is_address_coarse(norm_space(row.get("origin_address_text"))):
        flags.add("coarse_address_context")
    return sorted(flags)


def build_provider_search_review_jobs(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    jobs: list[dict[str, Any]] = []
    for row in rows:
        if row.get("recrawl_bucket") != "provider_search_no_result":
            continue
        problem_tags = sorted(set(row.get("problem_tags") or []) | set(provider_name_review_flags(row)))
        jobs.append(
            {
                "trace_id": row.get("trace_id"),
                "source_line": row.get("source_line"),
                "video_id": row.get("video_id"),
                "youtube_link": row.get("youtube_link"),
                "origin_name": row.get("origin_name"),
                "origin_address_text": norm_space(row.get("origin_address_text")),
                "address_precision": coarse_address_level(norm_space(row.get("origin_address_text"))),
                "source_selection_file": row.get("source_selection_file") or row.get("selection_file"),
                "suggested_search_queries": provider_search_queries(row),
                "review_instruction": "verify_closed_renamed_or_name_query_issue_before_recrawl",
                "required_evidence": [
                    "current_provider_listing_or_absence",
                    "closed_or_renamed_signal",
                    "video_place_name_or_address_evidence",
                    "alternative_name_candidate_if_found",
                ],
                "next_action_options": [
                    "tag_closed_or_moved",
                    "correct_source_name_then_rerun_stage1_stage2",
                    "recrawl_video_source_evidence",
                    "manual_provider_search_review",
                ],
                "problem_tags": problem_tags,
                "evidence_text": row.get("evidence_text"),
            }
        )
    return jobs


def provider_search_review_csv_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "trace_id": row.get("trace_id"),
        "source_line": row.get("source_line"),
        "origin_name": row.get("origin_name"),
        "origin_address_text": row.get("origin_address_text"),
        "address_precision": row.get("address_precision"),
        "suggested_search_queries": " ; ".join(row.get("suggested_search_queries") or []),
        "next_action_options": " ; ".join(row.get("next_action_options") or []),
        "problem_tags": ";".join(row.get("problem_tags") or []),
        "source_selection_file": row.get("source_selection_file"),
        "youtube_link": row.get("youtube_link"),
    }


def write_provider_search_review_outputs(output_dir: Path, rows: list[dict[str, Any]]) -> dict[str, Any]:
    jobs = build_provider_search_review_jobs(rows)
    write_jsonl(output_dir / "provider-search-review-jobs.jsonl", jobs)
    fieldnames = list(provider_search_review_csv_row({}).keys())
    write_dict_csv(
        output_dir / "provider-search-review-jobs.csv",
        [provider_search_review_csv_row(row) for row in jobs],
        fieldnames,
    )
    lines = [
        "# Provider Search No-result Review Jobs",
        "",
        "이 표는 provider_search_no_result 버킷을 폐업/이전/상호변경/검색어 문제 검토 작업으로 실행하기 위한 report-only 작업 패키지입니다.",
        "",
        "| trace_id | origin | address | precision | queries | action_options | youtube |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in jobs:
        lines.append(
            "| "
            + " | ".join(
                [
                    markdown_cell(str(row.get("trace_id") or "")[:12]),
                    markdown_cell(row.get("origin_name")),
                    markdown_cell(row.get("origin_address_text")),
                    markdown_cell(row.get("address_precision")),
                    markdown_cell(row.get("suggested_search_queries")),
                    markdown_cell(row.get("next_action_options")),
                    markdown_cell(row.get("youtube_link")),
                ]
            )
            + " |"
        )
    (output_dir / "provider-search-review-jobs.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    manifest = {
        "slug": "provider_search_review_jobs",
        "count": len(jobs),
        "jsonl_path": str(output_dir / "provider-search-review-jobs.jsonl"),
        "csv_path": str(output_dir / "provider-search-review-jobs.csv"),
        "markdown_path": str(output_dir / "provider-search-review-jobs.md"),
        "address_precision_counter": dict(Counter(row.get("address_precision") for row in jobs)),
        "problem_tag_counter": dict(Counter(tag for row in jobs for tag in row.get("problem_tags", []))),
    }
    (output_dir / "provider-search-review-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return {
        "provider_search_review_jobs": len(jobs),
        "provider_search_precision_counter": manifest["address_precision_counter"],
        "provider_search_problem_tag_counter": manifest["problem_tag_counter"],
        "provider_search_review_outputs": manifest,
    }



def distance_review_flags(row: dict[str, Any]) -> list[str]:
    flags = {"distance_threshold_review", "no_candidate_within_20m"}
    if row.get("source_lat") is None or row.get("source_lng") is None:
        flags.add("missing_source_coordinates")
    if is_address_coarse(norm_space(row.get("origin_address_text"))):
        flags.add("coarse_address_context")
    if "google_no_usable_candidate" in set(row.get("problem_tags") or []):
        flags.add("google_no_usable_candidate")
    return sorted(flags)


def build_distance_no_candidate_review_jobs(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    jobs: list[dict[str, Any]] = []
    for row in rows:
        if row.get("recrawl_bucket") != "distance_no_candidate_review":
            continue
        address = norm_space(row.get("origin_address_text"))
        problem_tags = sorted(set(row.get("problem_tags") or []) | set(distance_review_flags(row)))
        jobs.append(
            {
                "trace_id": row.get("trace_id"),
                "source_line": row.get("source_line"),
                "video_id": row.get("video_id"),
                "youtube_link": row.get("youtube_link"),
                "origin_name": row.get("origin_name"),
                "origin_address_text": address,
                "address_precision": coarse_address_level(address),
                "source_lat": row.get("source_lat"),
                "source_lng": row.get("source_lng"),
                "source_selection_file": row.get("source_selection_file") or row.get("selection_file"),
                "suggested_search_queries": provider_search_queries(row) or build_suggested_queries(row),
                "review_instruction": "verify_source_coordinates_radius_or_video_evidence_before_accepting_distance_exception",
                "distance_threshold_m": 20,
                "suggested_review_radius_m": [50, 100, 200, 500],
                "required_evidence": [
                    "video_address_or_map_evidence",
                    "source_coordinate_origin_and_precision",
                    "nearest_provider_candidate_distance_and_address",
                    "reason_to_accept_or_reject_distance_exception",
                ],
                "next_action_options": [
                    "correct_source_coordinates_then_rerun_stage2",
                    "recrawl_precise_address_then_rerun_stage1_stage2",
                    "accept_nearest_candidate_with_manual_evidence",
                    "tag_source_data_error_or_manual_review",
                ],
                "problem_tags": problem_tags,
                "evidence_text": row.get("evidence_text"),
            }
        )
    return jobs


def distance_no_candidate_csv_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "trace_id": row.get("trace_id"),
        "source_line": row.get("source_line"),
        "origin_name": row.get("origin_name"),
        "origin_address_text": row.get("origin_address_text"),
        "address_precision": row.get("address_precision"),
        "source_lat": row.get("source_lat"),
        "source_lng": row.get("source_lng"),
        "distance_threshold_m": row.get("distance_threshold_m"),
        "suggested_review_radius_m": " ; ".join(str(item) for item in row.get("suggested_review_radius_m") or []),
        "suggested_search_queries": " ; ".join(row.get("suggested_search_queries") or []),
        "next_action_options": " ; ".join(row.get("next_action_options") or []),
        "problem_tags": ";".join(row.get("problem_tags") or []),
        "source_selection_file": row.get("source_selection_file"),
        "youtube_link": row.get("youtube_link"),
    }


def write_distance_no_candidate_review_outputs(output_dir: Path, rows: list[dict[str, Any]]) -> dict[str, Any]:
    jobs = build_distance_no_candidate_review_jobs(rows)
    write_jsonl(output_dir / "distance-no-candidate-review-jobs.jsonl", jobs)
    fieldnames = list(distance_no_candidate_csv_row({}).keys())
    write_dict_csv(
        output_dir / "distance-no-candidate-review-jobs.csv",
        [distance_no_candidate_csv_row(row) for row in jobs],
        fieldnames,
    )
    lines = [
        "# Distance No-candidate Review Jobs",
        "",
        "이 표는 distance_no_candidate_review 버킷을 좌표/반경/영상 증거 검토 작업으로 실행하기 위한 report-only 작업 패키지입니다.",
        "",
        "| trace_id | origin | address | precision | source_coord | radius_m | action_options | youtube |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in jobs:
        source_coord = ""
        if row.get("source_lat") is not None and row.get("source_lng") is not None:
            source_coord = f"{row.get('source_lat')},{row.get('source_lng')}"
        lines.append(
            "| "
            + " | ".join(
                [
                    markdown_cell(str(row.get("trace_id") or "")[:12]),
                    markdown_cell(row.get("origin_name")),
                    markdown_cell(row.get("origin_address_text")),
                    markdown_cell(row.get("address_precision")),
                    markdown_cell(source_coord),
                    markdown_cell(row.get("suggested_review_radius_m")),
                    markdown_cell(row.get("next_action_options")),
                    markdown_cell(row.get("youtube_link")),
                ]
            )
            + " |"
        )
    (output_dir / "distance-no-candidate-review-jobs.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    manifest = {
        "slug": "distance_no_candidate_review_jobs",
        "count": len(jobs),
        "jsonl_path": str(output_dir / "distance-no-candidate-review-jobs.jsonl"),
        "csv_path": str(output_dir / "distance-no-candidate-review-jobs.csv"),
        "markdown_path": str(output_dir / "distance-no-candidate-review-jobs.md"),
        "address_precision_counter": dict(Counter(row.get("address_precision") for row in jobs)),
        "missing_source_coordinates": sum(1 for row in jobs if row.get("source_lat") is None or row.get("source_lng") is None),
        "problem_tag_counter": dict(Counter(tag for row in jobs for tag in row.get("problem_tags", []))),
    }
    (output_dir / "distance-no-candidate-review-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return {
        "distance_no_candidate_review_jobs": len(jobs),
        "distance_no_candidate_missing_source_coordinates": manifest["missing_source_coordinates"],
        "distance_no_candidate_precision_counter": manifest["address_precision_counter"],
        "distance_no_candidate_problem_tag_counter": manifest["problem_tag_counter"],
        "distance_no_candidate_review_outputs": manifest,
    }



def generic_evidence_gap_flags(row: dict[str, Any]) -> list[str]:
    flags = {"generic_evidence_gap", "manual_evidence_enrichment"}
    evidence = norm_space(row.get("evidence_text"))
    if "non-restaurant" in evidence or "비음식" in evidence:
        flags.add("non_restaurant_candidate_check")
    if row.get("source_lat") is None or row.get("source_lng") is None:
        flags.add("missing_source_coordinates")
    if is_address_coarse(norm_space(row.get("origin_address_text"))):
        flags.add("coarse_address_context")
    return sorted(flags)


def build_generic_evidence_gap_jobs(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    jobs: list[dict[str, Any]] = []
    for row in rows:
        if row.get("recrawl_bucket") != "generic_evidence_gap":
            continue
        address = norm_space(row.get("origin_address_text"))
        problem_tags = sorted(set(row.get("problem_tags") or []) | set(generic_evidence_gap_flags(row)))
        jobs.append(
            {
                "trace_id": row.get("trace_id"),
                "source_line": row.get("source_line"),
                "video_id": row.get("video_id"),
                "youtube_link": row.get("youtube_link"),
                "origin_name": row.get("origin_name"),
                "origin_address_text": address,
                "address_precision": coarse_address_level(address),
                "source_lat": row.get("source_lat"),
                "source_lng": row.get("source_lng"),
                "source_selection_file": row.get("source_selection_file") or row.get("selection_file"),
                "suggested_search_queries": provider_search_queries(row) or build_suggested_queries(row),
                "review_instruction": "manually_enrich_video_or_source_evidence_and_classify_final_blocker",
                "required_evidence": [
                    "video_place_name_or_address_evidence",
                    "provider_listing_or_non_restaurant_signal",
                    "source_address_and_coordinate_origin",
                    "final_classification_reason",
                ],
                "next_action_options": [
                    "recrawl_video_source_evidence",
                    "correct_source_name_or_address_then_rerun",
                    "tag_non_restaurant_or_out_of_scope",
                    "tag_source_data_error_or_manual_review",
                ],
                "problem_tags": problem_tags,
                "evidence_text": row.get("evidence_text"),
                "recommended_action": row.get("recommended_action"),
            }
        )
    return jobs


def generic_evidence_gap_csv_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "trace_id": row.get("trace_id"),
        "source_line": row.get("source_line"),
        "origin_name": row.get("origin_name"),
        "origin_address_text": row.get("origin_address_text"),
        "address_precision": row.get("address_precision"),
        "source_lat": row.get("source_lat"),
        "source_lng": row.get("source_lng"),
        "suggested_search_queries": " ; ".join(row.get("suggested_search_queries") or []),
        "next_action_options": " ; ".join(row.get("next_action_options") or []),
        "problem_tags": ";".join(row.get("problem_tags") or []),
        "evidence_text": row.get("evidence_text"),
        "source_selection_file": row.get("source_selection_file"),
        "youtube_link": row.get("youtube_link"),
    }


def write_generic_evidence_gap_outputs(output_dir: Path, rows: list[dict[str, Any]]) -> dict[str, Any]:
    jobs = build_generic_evidence_gap_jobs(rows)
    write_jsonl(output_dir / "generic-evidence-gap-jobs.jsonl", jobs)
    fieldnames = list(generic_evidence_gap_csv_row({}).keys())
    write_dict_csv(
        output_dir / "generic-evidence-gap-jobs.csv",
        [generic_evidence_gap_csv_row(row) for row in jobs],
        fieldnames,
    )
    lines = [
        "# Generic Evidence Gap Jobs",
        "",
        "이 표는 남은 generic_evidence_gap 버킷을 수동 증거 보강/재크롤링/데이터 오류 태깅 작업으로 마무리하기 위한 report-only 작업 패키지입니다.",
        "",
        "| trace_id | origin | address | evidence | tags | action_options | youtube |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in jobs:
        lines.append(
            "| "
            + " | ".join(
                [
                    markdown_cell(str(row.get("trace_id") or "")[:12]),
                    markdown_cell(row.get("origin_name")),
                    markdown_cell(row.get("origin_address_text")),
                    markdown_cell(row.get("evidence_text")),
                    markdown_cell(row.get("problem_tags")),
                    markdown_cell(row.get("next_action_options")),
                    markdown_cell(row.get("youtube_link")),
                ]
            )
            + " |"
        )
    (output_dir / "generic-evidence-gap-jobs.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    manifest = {
        "slug": "generic_evidence_gap_jobs",
        "count": len(jobs),
        "jsonl_path": str(output_dir / "generic-evidence-gap-jobs.jsonl"),
        "csv_path": str(output_dir / "generic-evidence-gap-jobs.csv"),
        "markdown_path": str(output_dir / "generic-evidence-gap-jobs.md"),
        "address_precision_counter": dict(Counter(row.get("address_precision") for row in jobs)),
        "problem_tag_counter": dict(Counter(tag for row in jobs for tag in row.get("problem_tags", []))),
    }
    (output_dir / "generic-evidence-gap-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return {
        "generic_evidence_gap_jobs": len(jobs),
        "generic_evidence_gap_precision_counter": manifest["address_precision_counter"],
        "generic_evidence_gap_problem_tag_counter": manifest["problem_tag_counter"],
        "generic_evidence_gap_outputs": manifest,
    }

def evidence_text(row: dict[str, Any]) -> str:
    summary = row.get("evidence_summary")
    if isinstance(summary, list):
        return " | ".join(norm_space(item) for item in summary)
    return norm_space(summary)


def insufficient_evidence_bucket(row: dict[str, Any], source_record: dict[str, Any]) -> tuple[str, str, list[str]]:
    evidence = evidence_text(row)
    address = norm_space(row.get("origin_address_text")) or origin_address_text(source_record)
    tags: list[str] = []
    if is_address_coarse(address):
        tags.append("coarse_source_address")
    if "Google search returned no usable candidate" in evidence:
        tags.append("google_no_usable_candidate")
    if "검색 결과 없음" in evidence:
        tags.append("naver_search_no_result")
    if "20m 이내 후보 없음" in evidence:
        tags.append("no_candidate_within_20m")

    action = row.get("recommended_action")
    if "no_candidate_within_20m" in tags:
        return "distance_no_candidate_review", "review_source_coordinates_or_expand_radius_with_video_evidence", tags
    if action == "rerun_rule_evaluation_with_candidate_review":
        return "candidate_review_still_insufficient", "manual_candidate_review_against_video_evidence", tags
    if "coarse_source_address" in tags:
        return "coarse_source_address_recrawl", "recrawl_or_enrich_source_address", tags
    if "naver_search_no_result" in tags:
        return "provider_search_no_result", "closed_renamed_or_name_query_review", tags
    return "generic_evidence_gap", "manual_evidence_enrichment", tags


def build_insufficient_evidence_rows(
    unresolved_rows: list[dict[str, Any]],
    transform_index: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    output_rows: list[dict[str, Any]] = []
    for row in unresolved_rows:
        if row.get("pending_reason") != "insufficient_evidence":
            continue
        trace_id = str(row.get("trace_id") or "")
        source_record = transform_index.get(trace_id, {})
        bucket, next_action, tags = insufficient_evidence_bucket(row, source_record)
        source_lat, source_lng = source_coordinates(source_record)
        output_rows.append(
            {
                "trace_id": trace_id,
                "source_line": source_record.get("_line"),
                "video_id": row.get("video_id"),
                "youtube_link": row.get("youtube_link"),
                "origin_name": row.get("origin_name"),
                "origin_address_text": row.get("origin_address_text") or origin_address_text(source_record),
                "stage": row.get("stage"),
                "recommended_action": row.get("recommended_action"),
                "pending_reason": row.get("pending_reason"),
                "evidence_text": evidence_text(row),
                "recrawl_bucket": bucket,
                "next_action": next_action,
                "problem_tags": sorted(set(tags)),
                "source_lat": source_lat,
                "source_lng": source_lng,
                "source_selection_file": row.get("source_selection_file"),
                "selection_file": row.get("selection_file"),
            }
        )
    return output_rows


def write_insufficient_evidence_outputs(output_dir: Path, rows: list[dict[str, Any]]) -> dict[str, Any]:
    queue_dir = output_dir / "insufficient_evidence_recrawl_queues"
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[str(row.get("recrawl_bucket") or "generic_evidence_gap")].append(row)

    manifest = []
    for slug, queue_rows in sorted(grouped.items()):
        path = queue_dir / f"{slug}.jsonl"
        write_jsonl(path, queue_rows)
        manifest.append({"slug": slug, "count": len(queue_rows), "path": str(path)})

    fieldnames = [
        "trace_id",
        "source_line",
        "origin_name",
        "origin_address_text",
        "recrawl_bucket",
        "next_action",
        "problem_tags",
        "stage",
        "recommended_action",
        "evidence_text",
        "youtube_link",
    ]
    csv_rows = [{**row, "problem_tags": ";".join(row.get("problem_tags") or [])} for row in rows]
    write_jsonl(output_dir / "insufficient-evidence-recrawl-table.jsonl", rows)
    write_dict_csv(output_dir / "insufficient-evidence-recrawl-table.csv", csv_rows, fieldnames)
    lines = [
        "# Insufficient Evidence Recrawl Table",
        "",
        "이 표는 insufficient_evidence 112개를 재크롤링/증거 보강 작업 큐로 나눈 report-only 산출물입니다.",
        "",
        "| trace_id | origin | bucket | next_action | tags | youtube |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for row in rows:
        lines.append(
            "| "
            + " | ".join(
                [
                    markdown_cell(str(row.get("trace_id") or "")[:12]),
                    markdown_cell(row.get("origin_name")),
                    markdown_cell(row.get("recrawl_bucket")),
                    markdown_cell(row.get("next_action")),
                    markdown_cell(row.get("problem_tags")),
                    markdown_cell(row.get("youtube_link")),
                ]
            )
            + " |"
        )
    (output_dir / "insufficient-evidence-recrawl-table.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (queue_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return {
        "insufficient_evidence_rows": len(rows),
        "insufficient_evidence_manifest": manifest,
        "insufficient_evidence_bucket_counter": dict(Counter(row["recrawl_bucket"] for row in rows)),
    }


def package_report(
    rule_rerun_report_dir: Path,
    transforms_path: Path,
    output_dir: Path,
    *,
    with_live_multi_candidates: bool = False,
    timeout: float = 8.0,
) -> dict[str, Any]:
    matched_rows = load_jsonl(rule_rerun_report_dir / "matched-rule-rerun-candidates.jsonl")
    unresolved_rows = load_jsonl(rule_rerun_report_dir / "still-unresolved-after-rule-rerun.jsonl")
    transform_index = transforms_by_trace(transforms_path)

    review_candidates: list[dict[str, Any]] = []
    missing_source: list[dict[str, Any]] = []
    missing_rule_result: list[dict[str, Any]] = []
    for matched_row in matched_rows:
        trace_id = str(matched_row.get("trace_id") or "")
        source_record = transform_index.get(trace_id)
        if not source_record:
            missing_source.append(matched_row)
            continue
        rule_result_file = rule_rerun_report_dir / "evaluation" / "rule_results" / f"{matched_row['video_id']}.jsonl"
        if not rule_result_file.exists():
            missing_rule_result.append(matched_row)
            continue
        rule_result = load_last_jsonl(rule_result_file)
        location_result = find_location_result(rule_result, str(matched_row.get("origin_name") or ""))
        if not location_result:
            missing_rule_result.append(matched_row)
            continue
        review_candidates.append(build_review_candidate(matched_row, source_record, location_result, rule_result_file))

    output_dir.mkdir(parents=True, exist_ok=True)
    write_jsonl(output_dir / "matched-review-candidates.jsonl", review_candidates)
    write_review_csv(output_dir / "matched-review-candidates.csv", review_candidates)
    write_review_table(output_dir / "matched-review-table.md", review_candidates)
    write_jsonl(output_dir / "missing-source-transform.jsonl", missing_source)
    write_jsonl(output_dir / "missing-rule-result.jsonl", missing_rule_result)
    unresolved_manifest = write_unresolved_followups(output_dir, unresolved_rows)
    multi_candidate_summary = {
        "multi_candidate_rows": len([row for row in unresolved_rows if row.get("pending_reason") == "multi_candidate"]),
        "multi_candidate_comparison_rows": 0,
        "multi_candidate_trace_ids_with_live_candidates": 0,
        "multi_candidate_live_lookup": False,
    }
    if with_live_multi_candidates:
        load_env()
        if not has_local_api_env():
            raise SystemExit("required Naver local API env vars are missing")
        multi_rows = [row for row in unresolved_rows if row.get("pending_reason") == "multi_candidate"]
        comparison_rows = build_multi_candidate_comparisons(multi_rows, transform_index, local_api_headers(), timeout)
        multi_candidate_summary = {
            **write_multi_candidate_tables(output_dir, comparison_rows),
            "multi_candidate_live_lookup": True,
        }
    insufficient_evidence_rows = build_insufficient_evidence_rows(unresolved_rows, transform_index)
    insufficient_evidence_summary = write_insufficient_evidence_outputs(output_dir, insufficient_evidence_rows)
    coarse_address_summary = write_coarse_address_recrawl_outputs(output_dir, insufficient_evidence_rows)
    provider_search_summary = write_provider_search_review_outputs(output_dir, insufficient_evidence_rows)
    distance_no_candidate_summary = write_distance_no_candidate_review_outputs(output_dir, insufficient_evidence_rows)
    generic_evidence_gap_summary = write_generic_evidence_gap_outputs(output_dir, insufficient_evidence_rows)

    summary = {
        "generated_at": utc_now(),
        "rule_rerun_report_dir": str(rule_rerun_report_dir),
        "transforms_path": str(transforms_path),
        "output_dir": str(output_dir),
        "matched_input_rows": len(matched_rows),
        "review_candidates": len(review_candidates),
        "review_candidates_requiring_manual_review": sum(1 for row in review_candidates if row["requires_manual_review"]),
        "missing_source_transform": len(missing_source),
        "missing_rule_result": len(missing_rule_result),
        "unresolved_input_rows": len(unresolved_rows),
        "unresolved_followup_manifest": unresolved_manifest,
        **multi_candidate_summary,
        **insufficient_evidence_summary,
        **coarse_address_summary,
        **provider_search_summary,
        **distance_no_candidate_summary,
        **generic_evidence_gap_summary,
        "risk_flag_counter": dict(Counter(flag for row in review_candidates for flag in row["risk_flags"])),
        "unresolved_pending_reason_counter": dict(Counter(row.get("pending_reason") or "unknown" for row in unresolved_rows)),
    }
    (output_dir / "review-package-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    write_markdown(output_dir / "review-package-summary.md", summary)
    return summary


def write_markdown(path: Path, summary: dict[str, Any]) -> None:
    lines = [
        "# Rule Rerun Review Package",
        "",
        f"- generated_at: `{summary['generated_at']}`",
        f"- rule_rerun_report_dir: `{summary['rule_rerun_report_dir']}`",
        f"- matched_input_rows: {summary['matched_input_rows']}",
        f"- review_candidates: {summary['review_candidates']}",
        f"- review_candidates_requiring_manual_review: {summary['review_candidates_requiring_manual_review']}",
        f"- unresolved_input_rows: {summary['unresolved_input_rows']}",
        "",
        "## Output files",
        "",
        "- `matched-review-candidates.jsonl`: matched rows packaged for admin review before sync",
        "- `matched-review-candidates.csv`: spreadsheet-friendly review table",
        "- `matched-review-table.md`: Markdown review table for quick inspection",
        "- `multi-candidate-comparison.*`: optional live Naver candidate comparison exports when enabled",
        "- `insufficient-evidence-recrawl-table.*`: recrawl/evidence-enrichment table for insufficient-evidence rows",
        "- `insufficient_evidence_recrawl_queues/`: insufficient-evidence rows split by recrawl bucket",
        "- `coarse-address-recrawl-jobs.*`: actionable source-address enrichment jobs for coarse addresses",
        "- `coarse-address-recrawl-manifest.json`: coarse-address job counts and precision breakdown",
        "- `provider-search-review-jobs.*`: closed/renamed/name-query review jobs for provider no-result rows",
        "- `provider-search-review-manifest.json`: provider no-result job counts and tag breakdown",
        "- `distance-no-candidate-review-jobs.*`: source-coordinate/radius/video-evidence review jobs",
        "- `distance-no-candidate-review-manifest.json`: distance no-candidate job counts and tag breakdown",
        "- `generic-evidence-gap-jobs.*`: final manual evidence enrichment jobs for uncategorized gaps",
        "- `generic-evidence-gap-manifest.json`: generic evidence gap job counts and tag breakdown",
        "- `missing-source-transform.jsonl`: matched rows not found in source transforms",
        "- `missing-rule-result.jsonl`: matched rows whose scratch rule output could not be loaded",
        "- `unresolved_followup_queues/`: unresolved rows split by pending reason",
        "",
        "## Risk flags",
        "",
    ]
    for flag, count in sorted(summary["risk_flag_counter"].items()):
        lines.append(f"- `{flag}`: {count}")
    lines += ["", "## Unresolved pending reasons", ""]
    for reason, count in sorted(summary["unresolved_pending_reason_counter"].items()):
        lines.append(f"- `{reason}`: {count}")
    lines += ["", "## Unresolved follow-up queues", ""]
    for item in summary["unresolved_followup_manifest"]:
        lines.append(f"- `{item['slug']}`: {item['count']} rows → `{item['path']}`")
    lines += [
        "",
        "## Multi-candidate comparison",
        "",
        f"- live_lookup: {summary['multi_candidate_live_lookup']}",
        f"- multi_candidate_rows: {summary['multi_candidate_rows']}",
        f"- comparison_rows: {summary['multi_candidate_comparison_rows']}",
        f"- trace_ids_with_live_candidates: {summary['multi_candidate_trace_ids_with_live_candidates']}",
    ]
    lines += ["", "## Insufficient evidence recrawl queues", ""]
    for bucket, count in sorted(summary["insufficient_evidence_bucket_counter"].items()):
        lines.append(f"- `{bucket}`: {count}")
    lines += ["", "## Insufficient evidence queue files", ""]
    for item in summary["insufficient_evidence_manifest"]:
        lines.append(f"- `{item['slug']}`: {item['count']} rows → `{item['path']}`")
    lines += ["", "## Coarse address recrawl jobs", ""]
    lines.append(f"- jobs: {summary['coarse_address_recrawl_jobs']}")
    lines.append(f"- private_or_masked: {summary['coarse_address_private_or_masked']}")
    for precision, count in sorted(summary["coarse_address_precision_counter"].items()):
        lines.append(f"- `{precision}`: {count}")
    lines.append(f"- jsonl: `{summary['coarse_address_recrawl_outputs']['jsonl_path']}`")
    lines.append(f"- csv: `{summary['coarse_address_recrawl_outputs']['csv_path']}`")
    lines.append(f"- markdown: `{summary['coarse_address_recrawl_outputs']['markdown_path']}`")
    lines += ["", "## Provider search no-result review jobs", ""]
    lines.append(f"- jobs: {summary['provider_search_review_jobs']}")
    for precision, count in sorted(summary["provider_search_precision_counter"].items()):
        lines.append(f"- `{precision}`: {count}")
    lines.append("- problem_tags:")
    for tag, count in sorted(summary["provider_search_problem_tag_counter"].items()):
        lines.append(f"  - `{tag}`: {count}")
    lines.append(f"- jsonl: `{summary['provider_search_review_outputs']['jsonl_path']}`")
    lines.append(f"- csv: `{summary['provider_search_review_outputs']['csv_path']}`")
    lines.append(f"- markdown: `{summary['provider_search_review_outputs']['markdown_path']}`")
    lines += ["", "## Distance no-candidate review jobs", ""]
    lines.append(f"- jobs: {summary['distance_no_candidate_review_jobs']}")
    lines.append(f"- missing_source_coordinates: {summary['distance_no_candidate_missing_source_coordinates']}")
    for precision, count in sorted(summary["distance_no_candidate_precision_counter"].items()):
        lines.append(f"- `{precision}`: {count}")
    lines.append("- problem_tags:")
    for tag, count in sorted(summary["distance_no_candidate_problem_tag_counter"].items()):
        lines.append(f"  - `{tag}`: {count}")
    lines.append(f"- jsonl: `{summary['distance_no_candidate_review_outputs']['jsonl_path']}`")
    lines.append(f"- csv: `{summary['distance_no_candidate_review_outputs']['csv_path']}`")
    lines.append(f"- markdown: `{summary['distance_no_candidate_review_outputs']['markdown_path']}`")
    lines += ["", "## Generic evidence gap jobs", ""]
    lines.append(f"- jobs: {summary['generic_evidence_gap_jobs']}")
    for precision, count in sorted(summary["generic_evidence_gap_precision_counter"].items()):
        lines.append(f"- `{precision}`: {count}")
    lines.append("- problem_tags:")
    for tag, count in sorted(summary["generic_evidence_gap_problem_tag_counter"].items()):
        lines.append(f"  - `{tag}`: {count}")
    lines.append(f"- jsonl: `{summary['generic_evidence_gap_outputs']['jsonl_path']}`")
    lines.append(f"- csv: `{summary['generic_evidence_gap_outputs']['csv_path']}`")
    lines.append(f"- markdown: `{summary['generic_evidence_gap_outputs']['markdown_path']}`")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Package rule-rerun matches for admin review")
    parser.add_argument("--rule-rerun-report-dir", type=Path)
    parser.add_argument("--transforms", type=Path, default=DEFAULT_TRANSFORMS)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--with-live-multi-candidates", action="store_true")
    parser.add_argument("--timeout", type=float, default=8.0)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    report_dir = args.rule_rerun_report_dir or latest_rule_rerun_report(DEFAULT_REPORT_ROOT)
    summary = package_report(
        report_dir,
        args.transforms,
        args.output_dir,
        with_live_multi_candidates=args.with_live_multi_candidates,
        timeout=args.timeout,
    )
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
