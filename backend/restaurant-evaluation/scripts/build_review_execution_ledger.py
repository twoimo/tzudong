#!/usr/bin/env python3
"""Build a unified report-only execution ledger from rule-rerun review packages.

The ledger is intentionally non-mutating: it does not write canonical data or
Supabase.  It turns multiple review-package job exports into one prioritized
queue that an operator or a later automation step can consume and update.
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

DEFAULT_REPORT_ROOT = Path("../.omx/reports/refined-data")

JOB_SPECS = [
    {
        "kind": "matched_review_candidate",
        "file": "matched-review-candidates.jsonl",
        "priority": 0,
        "default_action": "admin_review_before_sync",
        "decision_options": ["approve_sync", "reject_match", "needs_more_evidence"],
    },
    {
        "kind": "multi_candidate_review",
        "file": "multi-candidate-comparison.jsonl",
        "priority": 1,
        "default_action": "choose_candidate_against_video_evidence",
        "decision_options": ["select_candidate", "reject_all", "needs_recrawl"],
        "aggregate_by_trace": True,
    },
    {
        "kind": "generic_evidence_gap",
        "file": "generic-evidence-gap-jobs.jsonl",
        "priority": 2,
        "default_action": "manual_evidence_enrichment",
        "decision_options": ["recrawl", "correct_source", "tag_non_restaurant", "tag_source_error"],
    },
    {
        "kind": "coarse_address_recrawl",
        "file": "coarse-address-recrawl-jobs.jsonl",
        "priority": 3,
        "default_action": "recrawl_or_enrich_source_address",
        "decision_options": ["precise_address_recovered", "needs_manual_review", "tag_source_error"],
    },
    {
        "kind": "provider_search_review",
        "file": "provider-search-review-jobs.jsonl",
        "priority": 4,
        "default_action": "closed_renamed_or_name_query_review",
        "decision_options": ["closed_or_moved", "correct_name", "recrawl", "manual_review"],
    },
    {
        "kind": "distance_no_candidate_review",
        "file": "distance-no-candidate-review-jobs.jsonl",
        "priority": 5,
        "default_action": "review_source_coordinates_or_expand_radius_with_video_evidence",
        "decision_options": ["correct_coordinates", "recrawl_address", "accept_nearest", "tag_source_error"],
    },
]


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def latest_review_package(root: Path) -> Path:
    candidates = sorted(
        [path for path in root.glob("rule-rerun-*") if (path / "review-package-summary.json").exists()],
        key=lambda path: path.name,
        reverse=True,
    )
    if not candidates:
        raise FileNotFoundError(f"review package not found under {root}")
    return candidates[0]


def short_trace(trace_id: Any) -> str:
    return str(trace_id or "")[:12]


def list_value(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def unique_list(values: Iterable[Any]) -> list[Any]:
    seen: set[str] = set()
    output: list[Any] = []
    for value in values:
        key = json.dumps(value, ensure_ascii=False, sort_keys=True) if isinstance(value, (dict, list)) else str(value)
        if key not in seen:
            seen.add(key)
            output.append(value)
    return output


def aggregate_multi_candidate_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[str(row.get("trace_id") or "")].append(row)

    output: list[dict[str, Any]] = []
    for trace_id, group in sorted(grouped.items()):
        first = group[0]
        candidate_rows = [row for row in group if row.get("candidate_rank") is not None]
        output.append(
            {
                "trace_id": trace_id,
                "video_id": first.get("video_id"),
                "youtube_link": first.get("youtube_link"),
                "origin_name": first.get("origin_name"),
                "origin_address_text": first.get("origin_address_text"),
                "candidate_count": len(candidate_rows),
                "candidate_titles": unique_list(row.get("candidate_title") for row in candidate_rows if row.get("candidate_title")),
                "candidate_distances_m": unique_list(
                    row.get("candidate_distance_m") for row in candidate_rows if row.get("candidate_distance_m") is not None
                ),
                "search_query": first.get("search_query"),
                "review_note": "choose_one_candidate_or_reject_all_against_video_evidence",
            }
        )
    return output


def build_ledger_entry(spec: dict[str, Any], row: dict[str, Any], sequence: int) -> dict[str, Any]:
    trace_id = str(row.get("trace_id") or "")
    action_options = list_value(row.get("next_action_options")) or list(spec["decision_options"])
    problem_tags = unique_list(list_value(row.get("problem_tags")) + list_value(row.get("risk_flags")))
    return {
        "review_id": f"RVW-P{spec['priority']}-{sequence:04d}-{short_trace(trace_id)}",
        "priority": spec["priority"],
        "job_kind": spec["kind"],
        "trace_id": trace_id,
        "source_line": row.get("source_line"),
        "video_id": row.get("video_id"),
        "youtube_link": row.get("youtube_link"),
        "origin_name": row.get("origin_name"),
        "origin_address_text": row.get("origin_address_text") or row.get("current_coarse_address"),
        "default_action": row.get("next_action") or row.get("review_recommendation") or spec["default_action"],
        "decision_status": "pending",
        "decision_options": action_options,
        "problem_tags": problem_tags,
        "suggested_search_queries": list_value(row.get("suggested_search_queries")),
        "required_evidence": list_value(row.get("required_evidence")),
        "candidate_count": row.get("candidate_count"),
        "candidate_titles": list_value(row.get("candidate_titles")),
        "matched_distance_m": row.get("matched_distance_m"),
        "address_precision": row.get("address_precision"),
        "source_lat": row.get("source_lat"),
        "source_lng": row.get("source_lng"),
        "source_selection_file": row.get("source_selection_file"),
        "evidence_text": row.get("evidence_text"),
        "operator_decision": "",
        "operator_notes": "",
        "created_from_file": spec["file"],
    }


def build_ledger_rows(review_package_dir: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    sequence = 1
    for spec in JOB_SPECS:
        source_rows = load_jsonl(review_package_dir / spec["file"])
        if spec.get("aggregate_by_trace"):
            source_rows = aggregate_multi_candidate_rows(source_rows)
        for row in source_rows:
            rows.append(build_ledger_entry(spec, row, sequence))
            sequence += 1
    return sorted(rows, key=lambda row: (row["priority"], row["job_kind"], row["review_id"]))


def csv_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "review_id": row.get("review_id"),
        "priority": row.get("priority"),
        "job_kind": row.get("job_kind"),
        "decision_status": row.get("decision_status"),
        "operator_decision": row.get("operator_decision"),
        "origin_name": row.get("origin_name"),
        "origin_address_text": row.get("origin_address_text"),
        "default_action": row.get("default_action"),
        "decision_options": " ; ".join(str(item) for item in row.get("decision_options") or []),
        "problem_tags": ";".join(str(item) for item in row.get("problem_tags") or []),
        "candidate_count": row.get("candidate_count"),
        "matched_distance_m": row.get("matched_distance_m"),
        "address_precision": row.get("address_precision"),
        "source_line": row.get("source_line"),
        "trace_id": row.get("trace_id"),
        "video_id": row.get("video_id"),
        "youtube_link": row.get("youtube_link"),
        "operator_notes": row.get("operator_notes"),
    }


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    fieldnames = list(csv_row({}).keys())
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(csv_row(row))


def markdown_cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        value = ", ".join(str(item) for item in value)
    return str(value).replace("|", "\\|").replace("\n", " ")


def write_markdown(path: Path, rows: list[dict[str, Any]], summary: dict[str, Any]) -> None:
    lines = [
        "# Review Execution Ledger",
        "",
        "이 ledger는 DB/원본 데이터 반영 전 검수/재처리 작업을 소비하기 위한 report-only 작업 목록입니다.",
        "",
        f"- generated_at: `{summary['generated_at']}`",
        f"- review_package_dir: `{summary['review_package_dir']}`",
        f"- total_jobs: {summary['total_jobs']}",
        "",
        "## Job counts",
        "",
    ]
    for kind, count in sorted(summary["job_kind_counter"].items()):
        lines.append(f"- `{kind}`: {count}")
    lines += [
        "",
        "## Ledger",
        "",
        "| review_id | P | kind | status | origin | action | tags | youtube |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in rows:
        lines.append(
            "| "
            + " | ".join(
                [
                    markdown_cell(row.get("review_id")),
                    markdown_cell(row.get("priority")),
                    markdown_cell(row.get("job_kind")),
                    markdown_cell(row.get("decision_status")),
                    markdown_cell(row.get("origin_name")),
                    markdown_cell(row.get("default_action")),
                    markdown_cell(row.get("problem_tags")),
                    markdown_cell(row.get("youtube_link")),
                ]
            )
            + " |"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_ledger(review_package_dir: Path, output_dir: Path) -> dict[str, Any]:
    rows = build_ledger_rows(review_package_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    write_jsonl(output_dir / "review-execution-ledger.jsonl", rows)
    write_csv(output_dir / "review-execution-ledger.csv", rows)
    summary = {
        "generated_at": utc_now(),
        "review_package_dir": str(review_package_dir),
        "output_dir": str(output_dir),
        "total_jobs": len(rows),
        "job_kind_counter": dict(Counter(row["job_kind"] for row in rows)),
        "priority_counter": dict(Counter(str(row["priority"]) for row in rows)),
        "pending_jobs": sum(1 for row in rows if row["decision_status"] == "pending"),
        "ledger_jsonl": str(output_dir / "review-execution-ledger.jsonl"),
        "ledger_csv": str(output_dir / "review-execution-ledger.csv"),
        "ledger_markdown": str(output_dir / "review-execution-ledger.md"),
    }
    (output_dir / "review-execution-ledger-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    write_markdown(output_dir / "review-execution-ledger.md", rows, summary)
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build unified review execution ledger")
    parser.add_argument("--review-package-dir", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    review_package_dir = args.review_package_dir or latest_review_package(DEFAULT_REPORT_ROOT)
    summary = write_ledger(review_package_dir, args.output_dir)
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
