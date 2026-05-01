#!/usr/bin/env python3
"""Build a report-only category validity recovery package.

The current refined data contains many category_validity_TF=false rows because
legacy rule evaluation treated multi-label category lists as invalid.  This
script does not mutate transforms.jsonl or Supabase; it projects the corrected
category validator over an existing transforms file and emits review queues.
"""

from __future__ import annotations

import argparse
import csv
import importlib.util
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

SCRIPT_DIR = Path(__file__).resolve().parent
RULE_EVAL_PATH = SCRIPT_DIR / "10-rule-evaluation.py"
DEFAULT_TRANSFORMS = SCRIPT_DIR.parents[0] / "data" / "tzuyang" / "evaluation" / "transforms.jsonl"


def load_rule_eval_module():
    spec = importlib.util.spec_from_file_location("rule_evaluation_category_recovery", RULE_EVAL_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


rule_eval = load_rule_eval_module()


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise FileNotFoundError(path)
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, 1):
            if not line.strip():
                continue
            row = json.loads(line)
            row["_source_line"] = line_no
            rows.append(row)
    return rows


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def current_category_validity(row: dict[str, Any]) -> Any:
    evaluation_results = row.get("evaluation_results") or {}
    category_result = evaluation_results.get("category_validity_TF")
    if isinstance(category_result, dict):
        return category_result.get("eval_value")
    return None


def location_match_value(row: dict[str, Any]) -> Any:
    evaluation_results = row.get("evaluation_results") or {}
    location_result = evaluation_results.get("location_match_TF")
    if isinstance(location_result, dict):
        return location_result.get("eval_value")
    return None


def classify_false_row(row: dict[str, Any]) -> tuple[str, list[str], list[str], bool]:
    category = row.get("category")
    normalized = rule_eval.normalize_category_values(category)
    invalid = rule_eval.invalid_category_values(category)
    projected_valid = rule_eval.is_valid_category_value(category)
    if projected_valid:
        return "auto_recoverable_list_valid", normalized, invalid, projected_valid
    if invalid:
        return "taxonomy_review_required", normalized, invalid, projected_valid
    return "missing_category", normalized, invalid, projected_valid


def build_report_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    report_rows: list[dict[str, Any]] = []
    for row in rows:
        current = current_category_validity(row)
        if current is not False:
            continue
        queue, normalized, invalid, projected_valid = classify_false_row(row)
        report_rows.append(
            {
                "category_recovery_id": f"CVR-{len(report_rows) + 1:04d}-{str(row.get('trace_id') or '')[:12]}",
                "review_queue": queue,
                "projected_category_validity": projected_valid,
                "current_category_validity": current,
                "source_line": row.get("_source_line"),
                "trace_id": row.get("trace_id"),
                "video_id": (row.get("youtube_link") or "").split("v=")[-1] if row.get("youtube_link") else None,
                "youtube_link": row.get("youtube_link"),
                "origin_name": row.get("origin_name"),
                "naver_name": row.get("naver_name"),
                "status": row.get("status"),
                "category": row.get("category"),
                "normalized_categories": normalized,
                "invalid_categories": invalid,
                "location_match_TF": location_match_value(row),
                "geocoding_success": row.get("geocoding_success"),
                "geocoding_false_stage": row.get("geocoding_false_stage"),
                "is_missing": row.get("is_missing"),
                "is_notSelected": row.get("is_notSelected"),
                "recommended_action": recommended_action(queue, invalid),
            }
        )
    return report_rows


def recommended_action(queue: str, invalid: list[str]) -> str:
    if queue == "auto_recoverable_list_valid":
        return "rerun_rule_evaluation_after_multilabel_validator_fix"
    if queue == "taxonomy_review_required":
        return "review_taxonomy_or_alias:" + ",".join(invalid)
    return "reextract_or_manual_category_review"


def csv_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "category_recovery_id": row.get("category_recovery_id"),
        "review_queue": row.get("review_queue"),
        "projected_category_validity": row.get("projected_category_validity"),
        "origin_name": row.get("origin_name"),
        "category": json.dumps(row.get("category"), ensure_ascii=False),
        "normalized_categories": ";".join(row.get("normalized_categories") or []),
        "invalid_categories": ";".join(row.get("invalid_categories") or []),
        "location_match_TF": row.get("location_match_TF"),
        "geocoding_success": row.get("geocoding_success"),
        "source_line": row.get("source_line"),
        "trace_id": row.get("trace_id"),
        "youtube_link": row.get("youtube_link"),
        "recommended_action": row.get("recommended_action"),
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
        "# Category Validity Recovery Report",
        "",
        "이 패키지는 category_validity_TF=false 행을 report-only로 재분류합니다.",
        "Supabase 또는 transforms.jsonl 쓰기는 수행하지 않습니다.",
        "",
        f"- generated_at: `{summary['generated_at']}`",
        f"- transforms_path: `{summary['transforms_path']}`",
        f"- total_rows: {summary['total_rows']}",
        f"- current_false_rows: {summary['current_false_rows']}",
        f"- auto_recoverable_list_valid: {summary['queue_counter'].get('auto_recoverable_list_valid', 0)}",
        f"- taxonomy_review_required: {summary['queue_counter'].get('taxonomy_review_required', 0)}",
        f"- missing_category: {summary['queue_counter'].get('missing_category', 0)}",
        "",
        "| id | queue | projected | origin | category | invalid | location | action |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in rows[:200]:
        lines.append(
            "| "
            + " | ".join(
                [
                    markdown_cell(row.get("category_recovery_id")),
                    markdown_cell(row.get("review_queue")),
                    markdown_cell(row.get("projected_category_validity")),
                    markdown_cell(row.get("origin_name")),
                    markdown_cell(row.get("normalized_categories")),
                    markdown_cell(row.get("invalid_categories")),
                    markdown_cell(row.get("location_match_TF")),
                    markdown_cell(row.get("recommended_action")),
                ]
            )
            + " |"
        )
    if len(rows) > 200:
        lines.extend(["", f"_Markdown preview truncated to 200 of {len(rows)} rows. Use JSONL/CSV for full queue._"])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_recovery_package(transforms_path: Path, output_dir: Path) -> dict[str, Any]:
    source_rows = load_jsonl(transforms_path)
    report_rows = build_report_rows(source_rows)
    queue_counter = Counter(row["review_queue"] for row in report_rows)
    invalid_counter = Counter(value for row in report_rows for value in row.get("invalid_categories", []))
    output_dir.mkdir(parents=True, exist_ok=True)
    write_jsonl(output_dir / "category-validity-recovery-rows.jsonl", report_rows)
    for queue in ("auto_recoverable_list_valid", "taxonomy_review_required", "missing_category"):
        write_jsonl(output_dir / f"{queue}.jsonl", [row for row in report_rows if row["review_queue"] == queue])
    write_csv(output_dir / "category-validity-recovery-rows.csv", report_rows)
    summary = {
        "generated_at": utc_now(),
        "transforms_path": str(transforms_path),
        "output_dir": str(output_dir),
        "total_rows": len(source_rows),
        "current_false_rows": len(report_rows),
        "queue_counter": dict(queue_counter),
        "invalid_category_counter": dict(invalid_counter),
        "projected_false_after_validator_fix": queue_counter.get("taxonomy_review_required", 0) + queue_counter.get("missing_category", 0),
        "projected_auto_recovered": queue_counter.get("auto_recoverable_list_valid", 0),
        "recovery_jsonl": str(output_dir / "category-validity-recovery-rows.jsonl"),
        "recovery_csv": str(output_dir / "category-validity-recovery-rows.csv"),
        "recovery_markdown": str(output_dir / "category-validity-recovery-report.md"),
        "safety_mode": "report_only_no_mutation",
    }
    (output_dir / "category-validity-recovery-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    write_markdown(output_dir / "category-validity-recovery-report.md", report_rows, summary)
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build category validity recovery report")
    parser.add_argument("--transforms", type=Path, default=DEFAULT_TRANSFORMS)
    parser.add_argument("--output-dir", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    summary = write_recovery_package(args.transforms, args.output_dir)
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
