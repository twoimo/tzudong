#!/usr/bin/env python3
"""Build a report-only before/after diff for category validity rerun.

This projects the current category validator over an existing transforms.jsonl
file and records what would change if category_validity_TF were recomputed. It
never writes back to transforms.jsonl or Supabase.
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
    spec = importlib.util.spec_from_file_location("rule_evaluation_category_diff", RULE_EVAL_PATH)
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


def current_category_result(row: dict[str, Any]) -> dict[str, Any]:
    evaluation_results = row.get("evaluation_results") or {}
    category_result = evaluation_results.get("category_validity_TF")
    return dict(category_result) if isinstance(category_result, dict) else {}


def location_match_value(row: dict[str, Any]) -> Any:
    evaluation_results = row.get("evaluation_results") or {}
    location_result = evaluation_results.get("location_match_TF")
    if isinstance(location_result, dict):
        return location_result.get("eval_value")
    return None


def projected_category_result(row: dict[str, Any]) -> dict[str, Any]:
    category = row.get("category")
    result = current_category_result(row)
    result["eval_value"] = rule_eval.is_valid_category_value(category)
    invalid = rule_eval.invalid_category_values(category)
    if invalid:
        result["invalid_categories"] = invalid
    else:
        result.pop("invalid_categories", None)
    result["normalized_categories"] = rule_eval.normalize_category_values(category)
    result["projection_source"] = "category_multilabel_validator_fix"
    return result


def diff_status(before: Any, after: bool) -> str:
    if before is False and after is True:
        return "false_to_true"
    if before is True and after is False:
        return "true_to_false"
    if before is False and after is False:
        return "still_false"
    if before is True and after is True:
        return "still_true"
    if before is None and after is True:
        return "missing_eval_to_true"
    if before is None and after is False:
        return "missing_eval_to_false"
    return "other"


def review_queue(status: str, projected: dict[str, Any]) -> str:
    if status == "false_to_true":
        return "safe_category_validity_projection"
    if status in {"still_false", "missing_eval_to_false"} and projected.get("invalid_categories"):
        return "taxonomy_review_required"
    if status in {"still_false", "missing_eval_to_false"}:
        return "missing_category_review"
    if status == "true_to_false":
        return "regression_review_required"
    return "no_action"


def build_diff_rows(source_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for source in source_rows:
        before = current_category_validity(source)
        projected = projected_category_result(source)
        after = projected["eval_value"]
        status = diff_status(before, after)
        rows.append(
            {
                "category_diff_id": f"CVD-{len(rows) + 1:04d}-{str(source.get('trace_id') or '')[:12]}",
                "diff_status": status,
                "review_queue": review_queue(status, projected),
                "before_category_validity": before,
                "after_category_validity": after,
                "source_line": source.get("_source_line"),
                "trace_id": source.get("trace_id"),
                "youtube_link": source.get("youtube_link"),
                "origin_name": source.get("origin_name"),
                "naver_name": source.get("naver_name"),
                "status": source.get("status"),
                "category": source.get("category"),
                "normalized_categories": projected.get("normalized_categories") or [],
                "invalid_categories": projected.get("invalid_categories") or [],
                "location_match_TF": location_match_value(source),
                "geocoding_success": source.get("geocoding_success"),
                "projected_category_validity_TF": projected,
            }
        )
    return rows


def csv_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "category_diff_id": row.get("category_diff_id"),
        "diff_status": row.get("diff_status"),
        "review_queue": row.get("review_queue"),
        "before_category_validity": row.get("before_category_validity"),
        "after_category_validity": row.get("after_category_validity"),
        "origin_name": row.get("origin_name"),
        "category": json.dumps(row.get("category"), ensure_ascii=False),
        "normalized_categories": ";".join(row.get("normalized_categories") or []),
        "invalid_categories": ";".join(row.get("invalid_categories") or []),
        "location_match_TF": row.get("location_match_TF"),
        "geocoding_success": row.get("geocoding_success"),
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


def write_markdown(path: Path, changed_rows: list[dict[str, Any]], summary: dict[str, Any]) -> None:
    lines = [
        "# Category Validity Rerun Diff Report",
        "",
        "이 패키지는 수정된 category validator를 현재 transforms에 report-only로 projection한 before/after diff입니다.",
        "Supabase 또는 transforms.jsonl 쓰기는 수행하지 않습니다.",
        "",
        f"- generated_at: `{summary['generated_at']}`",
        f"- transforms_path: `{summary['transforms_path']}`",
        f"- total_rows: {summary['total_rows']}",
        f"- before_false: {summary['before_counter'].get('false', 0)}",
        f"- after_false: {summary['after_counter'].get('false', 0)}",
        f"- false_to_true: {summary['diff_status_counter'].get('false_to_true', 0)}",
        f"- still_false: {summary['diff_status_counter'].get('still_false', 0)}",
        f"- missing_eval_to_true: {summary['diff_status_counter'].get('missing_eval_to_true', 0)}",
        f"- missing_eval_to_false: {summary['diff_status_counter'].get('missing_eval_to_false', 0)}",
        "",
        "| id | diff | queue | origin | category | invalid | before | after |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in changed_rows[:200]:
        lines.append(
            "| "
            + " | ".join(
                [
                    markdown_cell(row.get("category_diff_id")),
                    markdown_cell(row.get("diff_status")),
                    markdown_cell(row.get("review_queue")),
                    markdown_cell(row.get("origin_name")),
                    markdown_cell(row.get("normalized_categories")),
                    markdown_cell(row.get("invalid_categories")),
                    markdown_cell(row.get("before_category_validity")),
                    markdown_cell(row.get("after_category_validity")),
                ]
            )
            + " |"
        )
    if len(changed_rows) > 200:
        lines.extend(["", f"_Markdown preview truncated to 200 of {len(changed_rows)} changed rows. Use JSONL/CSV for full queue._"])
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def counter_key(value: Any) -> str:
    if value is True:
        return "true"
    if value is False:
        return "false"
    if value is None:
        return "missing"
    return str(value)


def write_diff_package(transforms_path: Path, output_dir: Path) -> dict[str, Any]:
    source_rows = load_jsonl(transforms_path)
    rows = build_diff_rows(source_rows)
    changed_rows = [row for row in rows if row["before_category_validity"] != row["after_category_validity"]]
    actionable_rows = [row for row in rows if row["review_queue"] != "no_action"]
    output_dir.mkdir(parents=True, exist_ok=True)
    write_jsonl(output_dir / "category-validity-rerun-diff-all.jsonl", rows)
    write_jsonl(output_dir / "category-validity-rerun-diff-changed.jsonl", changed_rows)
    write_jsonl(output_dir / "category-validity-rerun-diff-actionable.jsonl", actionable_rows)
    for queue in ("safe_category_validity_projection", "taxonomy_review_required", "missing_category_review", "regression_review_required"):
        write_jsonl(output_dir / f"{queue}.jsonl", [row for row in rows if row["review_queue"] == queue])
    write_csv(output_dir / "category-validity-rerun-diff-changed.csv", changed_rows)
    before_counter = Counter(counter_key(row["before_category_validity"]) for row in rows)
    after_counter = Counter(counter_key(row["after_category_validity"]) for row in rows)
    status_counter = Counter(row["diff_status"] for row in rows)
    queue_counter = Counter(row["review_queue"] for row in rows)
    invalid_counter = Counter(value for row in rows for value in row.get("invalid_categories", []))
    summary = {
        "generated_at": utc_now(),
        "transforms_path": str(transforms_path),
        "output_dir": str(output_dir),
        "total_rows": len(rows),
        "changed_rows": len(changed_rows),
        "actionable_rows": len(actionable_rows),
        "before_counter": dict(before_counter),
        "after_counter": dict(after_counter),
        "diff_status_counter": dict(status_counter),
        "review_queue_counter": dict(queue_counter),
        "invalid_category_counter": dict(invalid_counter),
        "diff_all_jsonl": str(output_dir / "category-validity-rerun-diff-all.jsonl"),
        "diff_changed_jsonl": str(output_dir / "category-validity-rerun-diff-changed.jsonl"),
        "diff_actionable_jsonl": str(output_dir / "category-validity-rerun-diff-actionable.jsonl"),
        "diff_changed_csv": str(output_dir / "category-validity-rerun-diff-changed.csv"),
        "diff_markdown": str(output_dir / "category-validity-rerun-diff-report.md"),
        "safety_mode": "report_only_no_mutation",
    }
    (output_dir / "category-validity-rerun-diff-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    write_markdown(output_dir / "category-validity-rerun-diff-report.md", changed_rows, summary)
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build report-only category validity rerun diff")
    parser.add_argument("--transforms", type=Path, default=DEFAULT_TRANSFORMS)
    parser.add_argument("--output-dir", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    summary = write_diff_package(args.transforms, args.output_dir)
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
