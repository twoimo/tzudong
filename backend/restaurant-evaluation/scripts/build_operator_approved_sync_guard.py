#!/usr/bin/env python3
"""Build a report-only sync guard package for operator-approved candidates.

This script is the final safety gate before any future write path.  It never
mutates transforms.jsonl or Supabase; it only separates rows that are explicitly
operator-approved from rows that must remain blocked.
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
APPROVED_DECISION = "approve_for_sync"
SYNC_PRECHECK_STATUS = "sync_candidate_pending_operator_spot_check"
REQUIRED_ID_FIELDS = ("precheck_id", "decision_id", "review_id", "trace_id")


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


def latest_precheck_package(root: Path) -> Path:
    candidates = sorted(
        [
            path
            for path in root.glob("matched-candidate-promotion-precheck-*")
            if (path / "matched-candidate-promotion-precheck.jsonl").exists()
        ],
        key=lambda path: path.name,
        reverse=True,
    )
    if not candidates:
        raise FileNotFoundError(f"matched candidate promotion precheck package not found under {root}")
    return candidates[0]


def blocked_reasons(row: dict[str, Any]) -> list[str]:
    reasons: list[str] = []
    if row.get("precheck_status") != SYNC_PRECHECK_STATUS:
        reasons.append("not_sync_precheck_candidate")
    if row.get("operator_sync_decision") != APPROVED_DECISION:
        reasons.append("operator_decision_not_approve_for_sync")
    missing_ids = [field for field in REQUIRED_ID_FIELDS if not row.get(field)]
    if missing_ids:
        reasons.append("missing_required_ids:" + ",".join(missing_ids))
    proposed_fields = row.get("proposed_sync_fields") or {}
    if not isinstance(proposed_fields, dict) or not proposed_fields:
        reasons.append("missing_proposed_sync_fields")
    return reasons


def build_guard_rows(precheck_rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    approved: list[dict[str, Any]] = []
    blocked: list[dict[str, Any]] = []
    for row in precheck_rows:
        reasons = blocked_reasons(row)
        base = {
            "guard_id": f"ASG-{len(approved) + len(blocked) + 1:04d}-{str(row.get('trace_id') or '')[:12]}",
            "precheck_id": row.get("precheck_id"),
            "decision_id": row.get("decision_id"),
            "review_id": row.get("review_id"),
            "trace_id": row.get("trace_id"),
            "source_line": row.get("source_line"),
            "video_id": row.get("video_id"),
            "youtube_link": row.get("youtube_link"),
            "origin_name": row.get("origin_name"),
            "origin_address_text": row.get("origin_address_text"),
            "matched_name": row.get("matched_name"),
            "matched_provider": row.get("matched_provider"),
            "matched_distance_m": row.get("matched_distance_m"),
            "matched_road_address": row.get("matched_road_address"),
            "matched_jibun_address": row.get("matched_jibun_address"),
            "risk_level": row.get("risk_level"),
            "risk_flags": row.get("risk_flags") or [],
            "precheck_status": row.get("precheck_status"),
            "operator_sync_decision": row.get("operator_sync_decision"),
            "proposed_sync_fields": row.get("proposed_sync_fields") or {},
            "required_precheck": row.get("required_precheck") or [],
        }
        if reasons:
            blocked.append({**base, "guard_status": "blocked", "blocked_reasons": reasons})
        else:
            approved.append(
                {
                    **base,
                    "guard_status": "approved_for_future_sync_input",
                    "write_mode": "report_only_no_mutation",
                    "blocked_reasons": [],
                }
            )
    return approved, blocked


def csv_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "guard_id": row.get("guard_id"),
        "guard_status": row.get("guard_status"),
        "blocked_reasons": ";".join(row.get("blocked_reasons") or []),
        "operator_sync_decision": row.get("operator_sync_decision"),
        "precheck_status": row.get("precheck_status"),
        "origin_name": row.get("origin_name"),
        "matched_name": row.get("matched_name"),
        "matched_distance_m": row.get("matched_distance_m"),
        "risk_level": row.get("risk_level"),
        "precheck_id": row.get("precheck_id"),
        "decision_id": row.get("decision_id"),
        "review_id": row.get("review_id"),
        "trace_id": row.get("trace_id"),
        "source_line": row.get("source_line"),
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


def write_markdown(path: Path, approved: list[dict[str, Any]], blocked: list[dict[str, Any]], summary: dict[str, Any]) -> None:
    lines = [
        "# Operator Approved Sync Guard",
        "",
        "이 패키지는 operator_sync_decision=approve_for_sync 행만 future sync input으로 분리하는 report-only 안전장치입니다.",
        "실제 Supabase 또는 transforms.jsonl 쓰기는 수행하지 않습니다.",
        "",
        f"- generated_at: `{summary['generated_at']}`",
        f"- source_precheck_package_dir: `{summary['source_precheck_package_dir']}`",
        f"- total_precheck_rows: {summary['total_precheck_rows']}",
        f"- approved_for_future_sync_input: {summary['approved_for_future_sync_input']}",
        f"- blocked_rows: {summary['blocked_rows']}",
        "",
        "| guard_id | status | origin | decision | reasons | distance_m | risk |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in approved + blocked:
        lines.append(
            "| "
            + " | ".join(
                [
                    markdown_cell(row.get("guard_id")),
                    markdown_cell(row.get("guard_status")),
                    markdown_cell(row.get("origin_name")),
                    markdown_cell(row.get("operator_sync_decision")),
                    markdown_cell(row.get("blocked_reasons")),
                    markdown_cell(row.get("matched_distance_m")),
                    markdown_cell(row.get("risk_level")),
                ]
            )
            + " |"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_guard_package(precheck_package_dir: Path, output_dir: Path) -> dict[str, Any]:
    precheck_rows = load_jsonl(precheck_package_dir / "matched-candidate-promotion-precheck.jsonl")
    approved, blocked = build_guard_rows(precheck_rows)
    all_rows = approved + blocked
    output_dir.mkdir(parents=True, exist_ok=True)
    write_jsonl(output_dir / "approved-sync-candidates-report-only.jsonl", approved)
    write_jsonl(output_dir / "blocked-sync-candidates.jsonl", blocked)
    write_jsonl(output_dir / "operator-approved-sync-guard.jsonl", all_rows)
    write_csv(output_dir / "operator-approved-sync-guard.csv", all_rows)
    summary = {
        "generated_at": utc_now(),
        "source_precheck_package_dir": str(precheck_package_dir),
        "output_dir": str(output_dir),
        "total_precheck_rows": len(precheck_rows),
        "approved_for_future_sync_input": len(approved),
        "blocked_rows": len(blocked),
        "guard_status_counter": dict(Counter(row["guard_status"] for row in all_rows)),
        "blocked_reason_counter": dict(Counter(reason for row in blocked for reason in row.get("blocked_reasons", []))),
        "approved_jsonl": str(output_dir / "approved-sync-candidates-report-only.jsonl"),
        "blocked_jsonl": str(output_dir / "blocked-sync-candidates.jsonl"),
        "guard_jsonl": str(output_dir / "operator-approved-sync-guard.jsonl"),
        "guard_csv": str(output_dir / "operator-approved-sync-guard.csv"),
        "guard_markdown": str(output_dir / "operator-approved-sync-guard.md"),
        "safety_mode": "report_only_no_mutation",
    }
    (output_dir / "operator-approved-sync-guard-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    write_markdown(output_dir / "operator-approved-sync-guard.md", approved, blocked, summary)
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build report-only operator-approved sync guard package")
    parser.add_argument("--precheck-package-dir", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    precheck_package_dir = args.precheck_package_dir or latest_precheck_package(DEFAULT_REPORT_ROOT)
    summary = write_guard_package(precheck_package_dir, args.output_dir)
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
