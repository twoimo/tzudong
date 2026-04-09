#!/usr/bin/env python3
"""Shadow diff reporting for address-match precision experiments."""

from __future__ import annotations

import argparse
import json
import random
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

REVIEW_SAMPLE_SEED = 42


def iter_jsonl_records(path: Path) -> Iterable[tuple[Path, dict[str, Any]]]:
    files = sorted(path.rglob("*.jsonl")) if path.is_dir() else [path]
    for file_path in files:
        if not file_path.exists():
            continue
        with open(file_path, "r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    payload = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(payload, dict):
                    yield file_path, payload


def _matched_address(loc: dict[str, Any]) -> dict[str, Any] | None:
    matched = loc.get("matched_address")
    if isinstance(matched, dict):
        return matched

    legacy = loc.get("naver_address")
    if isinstance(legacy, list) and legacy and isinstance(legacy[0], dict):
        return legacy[0]

    return None


def normalize_location_row(source_file: Path, parent: dict[str, Any], loc: dict[str, Any]) -> dict[str, Any]:
    origin_name = loc.get("origin_name") or parent.get("origin_name") or "unknown"
    trace_id = parent.get("trace_id") or parent.get("youtube_link") or f"{source_file}:{origin_name}"
    matched_address = _matched_address(loc) or {}
    second_pass = loc.get("second_pass") if isinstance(loc.get("second_pass"), dict) else {}
    return {
        "key": f"{trace_id}::{origin_name}",
        "trace_id": trace_id,
        "origin_name": origin_name,
        "youtube_link": parent.get("youtube_link"),
        "trace_id_name_source": parent.get("trace_id_name_source"),
        "eval_value": bool(loc.get("eval_value")),
        "matched_provider": loc.get("matched_provider"),
        "matched_name": loc.get("matched_name") or loc.get("naver_name") or loc.get("google_name"),
        "naver_name": loc.get("naver_name"),
        "google_name": loc.get("google_name"),
        "pending_reason": loc.get("pending_reason"),
        "falseMessage": loc.get("falseMessage"),
        "evidence_families": loc.get("evidence_families") if isinstance(loc.get("evidence_families"), list) else [],
        "roadAddress": matched_address.get("roadAddress"),
        "jibunAddress": matched_address.get("jibunAddress"),
        "second_pass": {
            "attempted": bool(second_pass.get("attempted")),
            "provider": second_pass.get("provider"),
            "timed_out": bool(second_pass.get("timed_out")),
            "rate_limited": bool(second_pass.get("rate_limited")),
            "duration_ms": second_pass.get("duration_ms"),
        },
    }


def load_location_rows(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for source_file, payload in iter_jsonl_records(path):
        eval_results = payload.get("evaluation_results")
        if not isinstance(eval_results, dict):
            continue

        loc = eval_results.get("location_match_TF")
        if isinstance(loc, list):
            for item in loc:
                if isinstance(item, dict):
                    rows.append(normalize_location_row(source_file, payload, item))
        elif isinstance(loc, dict):
            rows.append(normalize_location_row(source_file, payload, loc))

    return rows


def compute_second_pass_counters(rows: list[dict[str, Any]]) -> dict[str, int]:
    counters = {
        "attempted": 0,
        "promoted_true": 0,
        "timed_out": 0,
        "rate_limited": 0,
        "left_pending": 0,
    }
    for row in rows:
        second_pass = row.get("second_pass") or {}
        if not second_pass.get("attempted"):
            continue
        counters["attempted"] += 1
        if row.get("eval_value") is True:
            counters["promoted_true"] += 1
        else:
            counters["left_pending"] += 1
        if second_pass.get("timed_out"):
            counters["timed_out"] += 1
        if second_pass.get("rate_limited"):
            counters["rate_limited"] += 1
    return counters


def compute_duplicate_risk(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if row.get("eval_value") is not True:
            continue
        matched_name = str(row.get("matched_name") or "").strip().lower()
        address = str(row.get("roadAddress") or row.get("jibunAddress") or "").strip().lower()
        if not matched_name or not address:
            continue
        grouped[(matched_name, address)].append(row)

    risks: list[dict[str, Any]] = []
    for (matched_name, address), group in sorted(grouped.items()):
        if len(group) < 2:
            continue
        risks.append(
            {
                "matched_name": matched_name,
                "address": address,
                "count": len(group),
                "records": [
                    {
                        "key": row["key"],
                        "origin_name": row["origin_name"],
                        "trace_id": row["trace_id"],
                    }
                    for row in group
                ],
            }
        )
    return risks


def build_sample_review(promotions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(promotions) <= 50:
        return promotions

    rng = random.Random(REVIEW_SAMPLE_SEED)
    sample = rng.sample(promotions, 50)
    return sorted(sample, key=lambda item: item["candidate"]["key"])


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Shadow diff address-match outputs")
    parser.add_argument("--baseline", required=True, help="Baseline JSONL file or directory")
    parser.add_argument("--candidate", required=True, help="Candidate JSONL file or directory")
    parser.add_argument("--out-dir", required=True, help="Output directory for shadow diff artifacts")
    args = parser.parse_args()

    baseline_path = Path(args.baseline)
    candidate_path = Path(args.candidate)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    baseline_rows = load_location_rows(baseline_path)
    candidate_rows = load_location_rows(candidate_path)

    baseline_by_key = {row["key"]: row for row in baseline_rows}
    candidate_by_key = {row["key"]: row for row in candidate_rows}
    all_keys = sorted(set(baseline_by_key) | set(candidate_by_key))

    promotions: list[dict[str, Any]] = []
    regressions: list[dict[str, Any]] = []
    source_churn: list[dict[str, Any]] = []

    for key in all_keys:
        baseline_row = baseline_by_key.get(key)
        candidate_row = candidate_by_key.get(key)
        baseline_true = bool(baseline_row and baseline_row.get("eval_value"))
        candidate_true = bool(candidate_row and candidate_row.get("eval_value"))

        if candidate_true and not baseline_true and candidate_row:
            promotions.append({"key": key, "baseline": baseline_row, "candidate": candidate_row})
        if baseline_true and not candidate_true and baseline_row:
            regressions.append({"key": key, "baseline": baseline_row, "candidate": candidate_row})
        if baseline_row and candidate_row and baseline_row.get("trace_id_name_source") != candidate_row.get("trace_id_name_source"):
            source_churn.append(
                {
                    "key": key,
                    "baseline": baseline_row.get("trace_id_name_source"),
                    "candidate": candidate_row.get("trace_id_name_source"),
                }
            )

    duplicate_risk = compute_duplicate_risk(candidate_rows)
    second_pass_counters = compute_second_pass_counters(candidate_rows)
    sample_review = build_sample_review(promotions)

    summary = {
        "baseline_rows": len(baseline_rows),
        "candidate_rows": len(candidate_rows),
        "baseline_true": sum(1 for row in baseline_rows if row.get("eval_value") is True),
        "candidate_true": sum(1 for row in candidate_rows if row.get("eval_value") is True),
        "added_true": len(promotions),
        "removed_true": len(regressions),
        "source_churn": len(source_churn),
        "duplicate_risk_candidates": len(duplicate_risk),
        "review_sample_size": len(sample_review),
        "sample_seed": REVIEW_SAMPLE_SEED,
        "second_pass_counters": second_pass_counters,
        "duplicate_risk_examples": duplicate_risk[:20],
    }

    with open(out_dir / "summary.json", "w", encoding="utf-8") as handle:
        json.dump(summary, handle, ensure_ascii=False, indent=2)
    write_jsonl(out_dir / "promotions.jsonl", promotions)
    write_jsonl(out_dir / "sample-review.jsonl", sample_review)
    with open(out_dir / "second-pass-counters.json", "w", encoding="utf-8") as handle:
        json.dump(second_pass_counters, handle, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
