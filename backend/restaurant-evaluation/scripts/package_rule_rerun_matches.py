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
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

DEFAULT_TRANSFORMS = Path("restaurant-evaluation/data/tzuyang/evaluation/transforms.jsonl")
DEFAULT_REPORT_ROOT = Path("../.omx/reports/refined-data")
LARGE_DISTANCE_M = 200.0
VERY_LARGE_DISTANCE_M = 1000.0


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


def package_report(rule_rerun_report_dir: Path, transforms_path: Path, output_dir: Path) -> dict[str, Any]:
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
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Package rule-rerun matches for admin review")
    parser.add_argument("--rule-rerun-report-dir", type=Path)
    parser.add_argument("--transforms", type=Path, default=DEFAULT_TRANSFORMS)
    parser.add_argument("--output-dir", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    report_dir = args.rule_rerun_report_dir or latest_rule_rerun_report(DEFAULT_REPORT_ROOT)
    summary = package_report(report_dir, args.transforms, args.output_dir)
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
