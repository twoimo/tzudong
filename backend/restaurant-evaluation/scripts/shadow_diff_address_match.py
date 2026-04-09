#!/usr/bin/env python3
"""Generate shadow-diff audit artifacts for address-match rollout verification."""

from __future__ import annotations

import argparse
import json
import random
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REVIEW_SAMPLE_LIMIT = 50
REVIEW_SAMPLE_SEED = 42
REVIEW_BUCKET_ORDER = (
    "overseas",
    "alias_mismatch",
    "cross_country",
    "ambiguous_chain",
    "multi_candidate",
)
FOREIGN_HINTS = (
    "태국",
    "일본",
    "중국",
    "홍콩",
    "대만",
    "베트남",
    "싱가포르",
    "미국",
    "bangkok",
    "thailand",
    "japan",
    "china",
    "hong kong",
    "taiwan",
    "vietnam",
    "singapore",
    "united states",
    "usa",
)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def normalize_name(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"[^\w가-힣]+", "", value).lower()


def first_present(*values: Any) -> Any:
    for value in values:
        if value not in (None, "", [], {}):
            return value
    return None


def stringify_address(value: Any) -> str | None:
    if isinstance(value, str):
        text = value.strip()
        return text or None
    if isinstance(value, list):
        for item in value:
            text = stringify_address(item)
            if text:
                return text
        return None
    if isinstance(value, dict):
        if isinstance(value.get("address"), str) and value["address"].strip():
            return value["address"].strip()
        parts = []
        for key in ("roadAddress", "jibunAddress", "englishAddress"):
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate.strip():
                parts.append(candidate.strip())
        if parts:
            return " | ".join(parts)
    return None


def ensure_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    output: list[str] = []
    for item in value:
        if isinstance(item, str) and item.strip():
            output.append(item.strip())
    return output


def extract_location_match(payload: dict[str, Any], origin_name: str | None) -> dict[str, Any]:
    eval_results = payload.get("evaluation_results")
    if not isinstance(eval_results, dict):
        return {}

    location_match = eval_results.get("location_match_TF")
    if isinstance(location_match, dict):
        return location_match
    if isinstance(location_match, list):
        if origin_name:
            for item in location_match:
                if isinstance(item, dict) and item.get("origin_name") == origin_name:
                    return item
        for item in location_match:
            if isinstance(item, dict):
                return item
    return {}


def standardize_record(
    payload: dict[str, Any],
    source_path: Path,
    line_no: int,
    *,
    restaurant: dict[str, Any] | None = None,
    loc_override: dict[str, Any] | None = None,
    expanded_index: int | None = None,
) -> dict[str, Any]:
    restaurant = restaurant or {}
    origin_name = first_present(
        payload.get("origin_name"),
        restaurant.get("origin_name"),
        restaurant.get("name"),
    )
    loc = loc_override or extract_location_match(payload, origin_name)

    matched_address = first_present(
        loc.get("matched_address"),
        loc.get("naver_address"),
    )
    matched_name = first_present(
        loc.get("matched_name"),
        loc.get("naver_name"),
        loc.get("google_name"),
        payload.get("matched_name"),
    )
    naver_name = first_present(loc.get("naver_name"), payload.get("naver_name"), restaurant.get("naver_name"))
    google_name = first_present(loc.get("google_name"), payload.get("google_name"), restaurant.get("google_name"))
    second_pass = loc.get("second_pass") if isinstance(loc.get("second_pass"), dict) else {}

    return {
        "comparison_anchor": first_present(payload.get("youtube_link"), payload.get("trace_id"), source_path.as_posix()),
        "youtube_link": payload.get("youtube_link"),
        "trace_id": payload.get("trace_id"),
        "origin_name": origin_name,
        "trace_id_name_source": payload.get("trace_id_name_source"),
        "eval_value": loc.get("eval_value"),
        "match_status": loc.get("match_status"),
        "pending_reason": loc.get("pending_reason"),
        "false_message": loc.get("falseMessage"),
        "matched_provider": loc.get("matched_provider"),
        "matched_name": matched_name,
        "naver_name": naver_name,
        "google_name": google_name,
        "origin_address_text": stringify_address(
            first_present(payload.get("origin_address"), loc.get("origin_address"), restaurant.get("address"))
        ),
        "matched_address_text": stringify_address(matched_address),
        "evidence_summary": ensure_string_list(loc.get("evidence_summary")),
        "evidence_families": ensure_string_list(loc.get("evidence_families")),
        "second_pass": {
            "attempted": bool(second_pass.get("attempted")),
            "provider": second_pass.get("provider"),
            "timed_out": bool(second_pass.get("timed_out")),
            "rate_limited": bool(second_pass.get("rate_limited")),
            "duration_ms": second_pass.get("duration_ms"),
        },
        "source_file": source_path.as_posix(),
        "source_line": line_no,
        "expanded_index": expanded_index,
    }


def expand_payload_records(payload: dict[str, Any], source_path: Path, line_no: int) -> list[dict[str, Any]]:
    if payload.get("origin_name") or payload.get("trace_id"):
        return [standardize_record(payload, source_path, line_no)]

    restaurants = payload.get("restaurants")
    eval_results = payload.get("evaluation_results") if isinstance(payload.get("evaluation_results"), dict) else {}
    location_list = eval_results.get("location_match_TF")
    location_index: dict[str, dict[str, Any]] = {}
    if isinstance(location_list, list):
        for item in location_list:
            if isinstance(item, dict) and item.get("origin_name"):
                location_index[item["origin_name"]] = item

    expanded: list[dict[str, Any]] = []
    if isinstance(restaurants, list):
        for idx, restaurant in enumerate(restaurants):
            if not isinstance(restaurant, dict):
                continue
            origin_name = first_present(restaurant.get("origin_name"), restaurant.get("name"))
            if not origin_name:
                continue
            expanded.append(
                standardize_record(
                    payload,
                    source_path,
                    line_no,
                    restaurant=restaurant,
                    loc_override=location_index.get(origin_name),
                    expanded_index=idx,
                )
            )
        if expanded:
            return expanded

    if isinstance(location_list, list):
        for idx, item in enumerate(location_list):
            if isinstance(item, dict) and item.get("origin_name"):
                expanded.append(
                    standardize_record(
                        payload,
                        source_path,
                        line_no,
                        restaurant={"origin_name": item.get("origin_name")},
                        loc_override=item,
                        expanded_index=idx,
                    )
                )
    return expanded or [standardize_record(payload, source_path, line_no)]


def load_jsonl_records(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_no, raw_line in enumerate(handle, start=1):
            line = raw_line.strip()
            if not line:
                continue
            payload = json.loads(line)
            if not isinstance(payload, dict):
                continue
            records.extend(expand_payload_records(payload, path, line_no))
    return records


def comparison_key(record: dict[str, Any]) -> str:
    anchor = record.get("comparison_anchor") or "unknown-anchor"
    origin_name = record.get("origin_name") or "unknown-origin"
    return f"{anchor}::{origin_name}"


def build_record_index(records: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    indexed: dict[str, dict[str, Any]] = {}
    for record in records:
        indexed[comparison_key(record)] = record
    return indexed


def record_state(record: dict[str, Any] | None) -> str:
    if not record:
        return "missing"
    if record.get("eval_value") is True:
        return "true"
    if record.get("match_status") == "pending" or record.get("pending_reason"):
        return "pending"
    if record.get("match_status") == "failed":
        return "failed"
    if record.get("eval_value") is False:
        return "non_true"
    return "unknown"


def is_true(record: dict[str, Any] | None) -> bool:
    return bool(record and record.get("eval_value") is True)


def detect_overseas(record: dict[str, Any] | None) -> bool:
    if not record:
        return False
    haystack = " ".join(
        filter(
            None,
            [
                str(record.get("origin_address_text") or "").lower(),
                str(record.get("matched_address_text") or "").lower(),
            ],
        )
    )
    return any(token in haystack for token in FOREIGN_HINTS)


def reason_haystack(*records: dict[str, Any] | None) -> str:
    tokens: list[str] = []
    for record in records:
        if not record:
            continue
        for value in (record.get("pending_reason"), record.get("false_message")):
            if isinstance(value, str) and value.strip():
                tokens.append(value.strip().lower())
    return " | ".join(tokens)


def review_buckets_for_pair(
    baseline: dict[str, Any] | None,
    candidate: dict[str, Any],
) -> list[str]:
    buckets: list[str] = []
    if detect_overseas(candidate) or detect_overseas(baseline):
        buckets.append("overseas")

    origin_name = normalize_name(candidate.get("origin_name"))
    matched_name = normalize_name(
        first_present(candidate.get("matched_name"), candidate.get("naver_name"), candidate.get("google_name"))
    )
    if origin_name and matched_name and origin_name != matched_name:
        buckets.append("alias_mismatch")

    reasons = reason_haystack(baseline, candidate)
    if "cross_country_mismatch" in reasons or "cross country" in reasons:
        buckets.append("cross_country")
    if "ambiguous_chain" in reasons or " chain" in reasons or "체인" in reasons:
        buckets.append("ambiguous_chain")
    if "multi_candidate" in reasons or "multiple candidate" in reasons or "복수 후보" in reasons:
        buckets.append("multi_candidate")

    ordered: list[str] = []
    for bucket in REVIEW_BUCKET_ORDER:
        if bucket in buckets:
            ordered.append(bucket)
    return ordered


def promotion_entry(
    key: str,
    baseline: dict[str, Any] | None,
    candidate: dict[str, Any],
) -> dict[str, Any]:
    return {
        "comparison_key": key,
        "youtube_link": candidate.get("youtube_link"),
        "origin_name": candidate.get("origin_name"),
        "baseline_state": record_state(baseline),
        "candidate_state": record_state(candidate),
        "baseline_trace_id": baseline.get("trace_id") if baseline else None,
        "candidate_trace_id": candidate.get("trace_id"),
        "baseline_trace_id_name_source": baseline.get("trace_id_name_source") if baseline else None,
        "candidate_trace_id_name_source": candidate.get("trace_id_name_source"),
        "trace_id_changed": bool(baseline and baseline.get("trace_id") != candidate.get("trace_id")),
        "trace_id_name_source_changed": bool(
            baseline and baseline.get("trace_id_name_source") != candidate.get("trace_id_name_source")
        ),
        "matched_provider": candidate.get("matched_provider"),
        "matched_name": candidate.get("matched_name"),
        "naver_name": candidate.get("naver_name"),
        "google_name": candidate.get("google_name"),
        "origin_address": candidate.get("origin_address_text"),
        "matched_address": candidate.get("matched_address_text"),
        "evidence_families": candidate.get("evidence_families", []),
        "evidence_summary": candidate.get("evidence_summary", []),
        "second_pass": candidate.get("second_pass", {}),
        "review_buckets": review_buckets_for_pair(baseline, candidate),
        "baseline_false_message": baseline.get("false_message") if baseline else None,
        "baseline_pending_reason": baseline.get("pending_reason") if baseline else None,
    }


def select_sample_review(
    promotions: list[dict[str, Any]],
    *,
    limit: int = REVIEW_SAMPLE_LIMIT,
    seed: int = REVIEW_SAMPLE_SEED,
) -> list[dict[str, Any]]:
    if len(promotions) <= limit:
        return promotions

    edge_case_promotions = [item for item in promotions if item.get("review_buckets")]
    edge_case_keys = {item["comparison_key"] for item in edge_case_promotions}
    remainder = [item for item in promotions if item["comparison_key"] not in edge_case_keys]

    if len(edge_case_promotions) >= limit:
        return edge_case_promotions

    rng = random.Random(seed)
    sample_count = min(limit - len(edge_case_promotions), len(remainder))
    sampled = rng.sample(remainder, k=sample_count)
    selected_keys = edge_case_keys | {item["comparison_key"] for item in sampled}
    return [item for item in promotions if item["comparison_key"] in selected_keys]


def detect_duplicate_risks(candidate_records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in candidate_records:
        if is_true(record) and record.get("trace_id"):
            grouped[str(record["trace_id"])].append(record)

    risks: list[dict[str, Any]] = []
    for trace_id, group in grouped.items():
        origin_names = sorted(
            {str(record.get("origin_name")) for record in group if record.get("origin_name")}
        )
        if len(origin_names) <= 1:
            continue
        risks.append(
            {
                "trace_id": trace_id,
                "count": len(group),
                "origin_names": origin_names,
                "matched_names": sorted(
                    {
                        str(record.get("matched_name"))
                        for record in group
                        if record.get("matched_name")
                    }
                ),
            }
        )

    return sorted(risks, key=lambda item: (-item["count"], item["trace_id"]))


def compute_second_pass_counters(
    candidate_records: list[dict[str, Any]],
    baseline_index: dict[str, dict[str, Any]],
) -> dict[str, int]:
    counts = Counter(
        {
            "second_pass_attempted": 0,
            "second_pass_promoted_true": 0,
            "second_pass_timeout": 0,
            "second_pass_rate_limited": 0,
            "second_pass_left_pending": 0,
        }
    )

    for record in candidate_records:
        second_pass = record.get("second_pass") or {}
        if not second_pass.get("attempted"):
            continue

        counts["second_pass_attempted"] += 1
        baseline = baseline_index.get(comparison_key(record))

        if second_pass.get("timed_out"):
            counts["second_pass_timeout"] += 1
        if second_pass.get("rate_limited"):
            counts["second_pass_rate_limited"] += 1
        if is_true(record) and not is_true(baseline):
            counts["second_pass_promoted_true"] += 1
        if not is_true(record):
            counts["second_pass_left_pending"] += 1

    return dict(counts)


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def run_shadow_diff(baseline_path: Path, candidate_path: Path, out_dir: Path) -> dict[str, Any]:
    baseline_records = load_jsonl_records(baseline_path)
    candidate_records = load_jsonl_records(candidate_path)
    baseline_index = build_record_index(baseline_records)
    candidate_index = build_record_index(candidate_records)

    promotions: list[dict[str, Any]] = []
    regressions: list[dict[str, Any]] = []
    source_changes: list[dict[str, Any]] = []
    candidate_only: list[dict[str, Any]] = []
    baseline_only: list[dict[str, Any]] = []

    for key in sorted(set(baseline_index) | set(candidate_index)):
        baseline = baseline_index.get(key)
        candidate = candidate_index.get(key)

        if baseline and not candidate:
            baseline_only.append(
                {
                    "comparison_key": key,
                    "youtube_link": baseline.get("youtube_link"),
                    "origin_name": baseline.get("origin_name"),
                    "trace_id": baseline.get("trace_id"),
                }
            )
            continue

        if candidate and not baseline:
            candidate_only.append(
                {
                    "comparison_key": key,
                    "youtube_link": candidate.get("youtube_link"),
                    "origin_name": candidate.get("origin_name"),
                    "trace_id": candidate.get("trace_id"),
                    "candidate_state": record_state(candidate),
                }
            )

        if candidate and is_true(candidate) and not is_true(baseline):
            promotions.append(promotion_entry(key, baseline, candidate))

        if baseline and is_true(baseline) and not is_true(candidate):
            regressions.append(
                {
                    "comparison_key": key,
                    "youtube_link": baseline.get("youtube_link"),
                    "origin_name": baseline.get("origin_name"),
                    "baseline_state": record_state(baseline),
                    "candidate_state": record_state(candidate),
                    "baseline_trace_id": baseline.get("trace_id"),
                    "candidate_trace_id": candidate.get("trace_id") if candidate else None,
                    "baseline_trace_id_name_source": baseline.get("trace_id_name_source"),
                    "candidate_trace_id_name_source": candidate.get("trace_id_name_source") if candidate else None,
                }
            )

        if baseline and candidate:
            if (
                baseline.get("trace_id_name_source") != candidate.get("trace_id_name_source")
                or baseline.get("trace_id") != candidate.get("trace_id")
            ):
                source_changes.append(
                    {
                        "comparison_key": key,
                        "youtube_link": candidate.get("youtube_link") or baseline.get("youtube_link"),
                        "origin_name": candidate.get("origin_name") or baseline.get("origin_name"),
                        "baseline_trace_id": baseline.get("trace_id"),
                        "candidate_trace_id": candidate.get("trace_id"),
                        "baseline_trace_id_name_source": baseline.get("trace_id_name_source"),
                        "candidate_trace_id_name_source": candidate.get("trace_id_name_source"),
                    }
                )

    sample_review = select_sample_review(promotions)
    duplicate_risks = detect_duplicate_risks(candidate_records)
    second_pass_counters = compute_second_pass_counters(candidate_records, baseline_index)

    out_dir.mkdir(parents=True, exist_ok=True)
    write_jsonl(out_dir / "promotions.jsonl", promotions)
    write_jsonl(out_dir / "sample-review.jsonl", sample_review)
    write_json(out_dir / "second-pass-counters.json", second_pass_counters)

    summary = {
        "generated_at": utc_now_iso(),
        "baseline_path": baseline_path.as_posix(),
        "candidate_path": candidate_path.as_posix(),
        "comparison_key_strategy": "youtube_link+origin_name fallback trace_id+origin_name",
        "baseline_records": len(baseline_records),
        "candidate_records": len(candidate_records),
        "baseline_indexed_records": len(baseline_index),
        "candidate_indexed_records": len(candidate_index),
        "candidate_only_records": len(candidate_only),
        "baseline_only_records": len(baseline_only),
        "added_true": len(promotions),
        "promoted_to_true": len(promotions),
        "removed_true": len(regressions),
        "trace_id_name_source_changes": len(source_changes),
        "duplicate_risk_candidates_count": len(duplicate_risks),
        "duplicate_risk_candidates": duplicate_risks,
        "sample_review_size": len(sample_review),
        "sample_review_seed": REVIEW_SAMPLE_SEED,
        "second_pass_counters": second_pass_counters,
        "promotion_edge_bucket_counts": dict(
            Counter(bucket for item in promotions for bucket in item.get("review_buckets", []))
        ),
        "baseline_only_examples": baseline_only[:10],
        "candidate_only_examples": candidate_only[:10],
        "regressions": regressions,
        "source_changes": source_changes,
    }
    write_json(out_dir / "summary.json", summary)
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Generate address-match shadow diff audit artifacts")
    parser.add_argument("--baseline", required=True, help="Baseline JSONL path")
    parser.add_argument("--candidate", required=True, help="Candidate JSONL path")
    parser.add_argument("--out-dir", required=True, help="Output directory for audit artifacts")
    args = parser.parse_args(argv)

    summary = run_shadow_diff(
        baseline_path=Path(args.baseline),
        candidate_path=Path(args.candidate),
        out_dir=Path(args.out_dir),
    )
    print(
        json.dumps(
            {
                "out_dir": str(args.out_dir),
                "added_true": summary["added_true"],
                "removed_true": summary["removed_true"],
                "trace_id_name_source_changes": summary["trace_id_name_source_changes"],
                "duplicate_risk_candidates_count": summary["duplicate_risk_candidates_count"],
                "sample_review_size": summary["sample_review_size"],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
