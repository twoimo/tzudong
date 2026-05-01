#!/usr/bin/env python3
"""Build a report-only safe apply package for category validity projections.

This is the final pre-apply safety boundary for the multi-label category
validity fix.  It accepts only rows that were previously false and project to
true via the corrected validator.  It does not mutate transforms.jsonl or
Supabase.
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

DEFAULT_REPORT_ROOT = Path("../.omx/reports/refined-data")
SAFE_QUEUE = "safe_category_validity_projection"
SAFE_DIFF_STATUS = "false_to_true"


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise FileNotFoundError(path)
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def latest_diff_package(root: Path) -> Path:
    candidates = sorted(
        [
            path
            for path in root.glob("category-validity-rerun-diff-*")
            if (path / "category-validity-rerun-diff-actionable.jsonl").exists()
        ],
        key=lambda path: path.name,
        reverse=True,
    )
    if not candidates:
        raise FileNotFoundError(f"category validity rerun diff package not found under {root}")
    return candidates[0]


def is_safe_apply_candidate(row: dict[str, Any]) -> bool:
    return (
        row.get("review_queue") == SAFE_QUEUE
        and row.get("diff_status") == SAFE_DIFF_STATUS
        and row.get("before_category_validity") is False
        and row.get("after_category_validity") is True
        and bool(row.get("projected_category_validity_TF"))
    )


def blocked_reasons(row: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    if row.get("review_queue") != SAFE_QUEUE:
        reasons.append(f"review_queue_not_safe:{row.get('review_queue')}")
    if row.get("diff_status") != SAFE_DIFF_STATUS:
        reasons.append(f"diff_status_not_false_to_true:{row.get('diff_status')}")
    if row.get("before_category_validity") is not False:
        reasons.append("before_category_validity_not_false")
    if row.get("after_category_validity") is not True:
        reasons.append("after_category_validity_not_true")
    if not row.get("projected_category_validity_TF"):
        reasons.append("missing_projected_category_validity_TF")
    return reasons


def build_package_rows(diff_rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    apply_rows: list[dict[str, Any]] = []
    blocked_rows: list[dict[str, Any]] = []
    for row in diff_rows:
        base = {
            "safe_apply_id": f"CVSA-{len(apply_rows) + len(blocked_rows) + 1:04d}-{str(row.get('trace_id') or '')[:12]}",
            "category_diff_id": row.get("category_diff_id"),
            "trace_id": row.get("trace_id"),
            "source_line": row.get("source_line"),
            "youtube_link": row.get("youtube_link"),
            "origin_name": row.get("origin_name"),
            "naver_name": row.get("naver_name"),
            "status": row.get("status"),
            "category": row.get("category"),
            "normalized_categories": row.get("normalized_categories") or [],
            "invalid_categories": row.get("invalid_categories") or [],
            "before_category_validity": row.get("before_category_validity"),
            "after_category_validity": row.get("after_category_validity"),
            "diff_status": row.get("diff_status"),
            "review_queue": row.get("review_queue"),
            "location_match_TF": row.get("location_match_TF"),
            "geocoding_success": row.get("geocoding_success"),
            "projected_category_validity_TF": row.get("projected_category_validity_TF") or {},
        }
        if is_safe_apply_candidate(row):
            apply_rows.append(
                {
                    **base,
                    "safe_apply_status": "ready_for_operator_approved_apply",
                    "write_mode": "report_only_no_mutation",
                    "required_preconditions": [
                        "operator_approval_required_before_any_write",
                        "apply_only_category_validity_TF_projection",
                        "do_not_change_category_taxonomy_or_location_fields",
                    ],
                    "blocked_reasons": [],
                }
            )
        else:
            blocked_rows.append(
                {
                    **base,
                    "safe_apply_status": "blocked_from_safe_apply",
                    "write_mode": "report_only_no_mutation",
                    "required_preconditions": [],
                    "blocked_reasons": blocked_reasons(row),
                }
            )
    return apply_rows, blocked_rows


def csv_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "safe_apply_id": row.get("safe_apply_id"),
        "safe_apply_status": row.get("safe_apply_status"),
        "blocked_reasons": ";".join(row.get("blocked_reasons") or []),
        "category_diff_id": row.get("category_diff_id"),
        "origin_name": row.get("origin_name"),
        "category": json.dumps(row.get("category"), ensure_ascii=False),
        "normalized_categories": ";".join(row.get("normalized_categories") or []),
        "before_category_validity": row.get("before_category_validity"),
        "after_category_validity": row.get("after_category_validity"),
        "source_line": row.get("source_line"),
        "trace_id": row.get("trace_id"),
        "youtube_link": row.get("youtube_link"),
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


def write_markdown(path: Path, apply_rows: list[dict[str, Any]], blocked_rows: list[dict[str, Any]], summary: dict[str, Any]) -> None:
    lines = [
        "# Category Validity Safe Apply Package",
        "",
        "이 패키지는 false→true로 검증된 category_validity_TF projection만 future apply 후보로 분리합니다.",
        "실제 Supabase 또는 transforms.jsonl 쓰기는 수행하지 않습니다.",
        "",
        f"- generated_at: `{summary['generated_at']}`",
        f"- source_diff_package_dir: `{summary['source_diff_package_dir']}`",
        f"- total_actionable_rows: {summary['total_actionable_rows']}",
        f"- ready_for_operator_approved_apply: {summary['ready_for_operator_approved_apply']}",
        f"- blocked_from_safe_apply: {summary['blocked_from_safe_apply']}",
        "",
        "| id | status | origin | category | before | after | reasons |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in (apply_rows + blocked_rows)[:200]:
        lines.append(
            "| "
            + " | ".join(
                [
                    markdown_cell(row.get("safe_apply_id")),
                    markdown_cell(row.get("safe_apply_status")),
                    markdown_cell(row.get("origin_name")),
                    markdown_cell(row.get("normalized_categories")),
                    markdown_cell(row.get("before_category_validity")),
                    markdown_cell(row.get("after_category_validity")),
                    markdown_cell(row.get("blocked_reasons")),
                ]
            )
            + " |"
        )
    if len(apply_rows) + len(blocked_rows) > 200:
        lines.extend(["", f"_Markdown preview truncated to 200 of {len(apply_rows) + len(blocked_rows)} rows. Use JSONL/CSV for full queues._"])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_safe_apply_package(diff_package_dir: Path, output_dir: Path) -> dict[str, Any]:
    diff_rows = load_jsonl(diff_package_dir / "category-validity-rerun-diff-actionable.jsonl")
    apply_rows, blocked_rows = build_package_rows(diff_rows)
    output_dir.mkdir(parents=True, exist_ok=True)
    write_jsonl(output_dir / "category-validity-safe-apply-candidates-report-only.jsonl", apply_rows)
    write_jsonl(output_dir / "category-validity-safe-apply-blocked.jsonl", blocked_rows)
    write_jsonl(output_dir / "category-validity-safe-apply-all.jsonl", apply_rows + blocked_rows)
    write_csv(output_dir / "category-validity-safe-apply-candidates-report-only.csv", apply_rows)
    write_csv(output_dir / "category-validity-safe-apply-blocked.csv", blocked_rows)
    status_counter = Counter(row["safe_apply_status"] for row in apply_rows + blocked_rows)
    blocked_reason_counter = Counter(reason for row in blocked_rows for reason in row.get("blocked_reasons", []))
    summary = {
        "generated_at": utc_now(),
        "source_diff_package_dir": str(diff_package_dir),
        "output_dir": str(output_dir),
        "total_actionable_rows": len(diff_rows),
        "ready_for_operator_approved_apply": len(apply_rows),
        "blocked_from_safe_apply": len(blocked_rows),
        "safe_apply_status_counter": dict(status_counter),
        "blocked_reason_counter": dict(blocked_reason_counter),
        "apply_candidates_jsonl": str(output_dir / "category-validity-safe-apply-candidates-report-only.jsonl"),
        "blocked_jsonl": str(output_dir / "category-validity-safe-apply-blocked.jsonl"),
        "all_jsonl": str(output_dir / "category-validity-safe-apply-all.jsonl"),
        "apply_candidates_csv": str(output_dir / "category-validity-safe-apply-candidates-report-only.csv"),
        "blocked_csv": str(output_dir / "category-validity-safe-apply-blocked.csv"),
        "markdown": str(output_dir / "category-validity-safe-apply-package.md"),
        "safety_mode": "report_only_no_mutation",
    }
    (output_dir / "category-validity-safe-apply-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    write_markdown(output_dir / "category-validity-safe-apply-package.md", apply_rows, blocked_rows, summary)
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build report-only category validity safe apply package")
    parser.add_argument("--diff-package-dir", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    diff_package_dir = args.diff_package_dir or latest_diff_package(DEFAULT_REPORT_ROOT)
    summary = write_safe_apply_package(diff_package_dir, args.output_dir)
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
