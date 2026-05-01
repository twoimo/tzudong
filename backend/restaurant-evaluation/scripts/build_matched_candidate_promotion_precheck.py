#!/usr/bin/env python3
"""Build a report-only promotion precheck package for safest matched candidates.

The package separates P0 matched decision rows into sync-candidate and hold
queues.  It intentionally does not mutate transforms.jsonl or Supabase; it only
prepares operator/automation inputs for the eventual sync step.
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
PROMOTION_QUEUE = "approval_ready_spot_check"
STAGE_HOLD_QUEUE = "stage_recovery_spot_check"


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


def latest_decision_package(root: Path) -> Path:
    candidates = sorted(
        [path for path in root.glob("matched-candidate-decisions-*") if (path / "matched-candidate-decisions.jsonl").exists()],
        key=lambda path: path.name,
        reverse=True,
    )
    if not candidates:
        raise FileNotFoundError(f"matched candidate decision package not found under {root}")
    return candidates[0]


def precheck_status(row: dict[str, Any]) -> str:
    queue = row.get("decision_queue")
    if queue == PROMOTION_QUEUE:
        return "sync_candidate_pending_operator_spot_check"
    if queue == STAGE_HOLD_QUEUE:
        return "hold_pending_stage_recovery_spot_check"
    return "not_promotion_precheck_candidate"


def precheck_checks(row: dict[str, Any]) -> list[str]:
    base = ["confirm_video_place_identity", "confirm_matched_address", "confirm_no_obvious_duplicate"]
    if row.get("decision_queue") == STAGE_HOLD_QUEUE:
        base.extend(["confirm_stage1_recovered_geocode", "confirm_stage_recovery_evidence"])
    return base


def build_precheck_rows(decision_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    for row in decision_rows:
        if row.get("decision_queue") not in {PROMOTION_QUEUE, STAGE_HOLD_QUEUE}:
            continue
        output.append(
            {
                "precheck_id": f"MCP-{len(output) + 1:04d}-{str(row.get('trace_id') or '')[:12]}",
                "decision_id": row.get("decision_id"),
                "review_id": row.get("review_id"),
                "trace_id": row.get("trace_id"),
                "source_line": row.get("source_line"),
                "video_id": row.get("video_id"),
                "youtube_link": row.get("youtube_link"),
                "origin_name": row.get("origin_name"),
                "origin_address_text": row.get("origin_address_text"),
                "naver_name": row.get("naver_name"),
                "matched_name": row.get("matched_name"),
                "matched_provider": row.get("matched_provider"),
                "matched_distance_m": row.get("matched_distance_m"),
                "matched_road_address": row.get("matched_road_address"),
                "matched_jibun_address": row.get("matched_jibun_address"),
                "risk_level": row.get("risk_level"),
                "risk_flags": row.get("risk_flags") or [],
                "decision_queue": row.get("decision_queue"),
                "precheck_status": precheck_status(row),
                "operator_sync_decision": "pending",
                "operator_sync_decision_options": ["approve_for_sync", "hold", "reject"],
                "required_precheck": precheck_checks(row),
                "proposed_sync_fields": row.get("proposed_sync_fields") or {},
                "operator_notes": "",
            }
        )
    return output


def split_precheck_rows(rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    sync_candidates = [row for row in rows if row["precheck_status"] == "sync_candidate_pending_operator_spot_check"]
    hold_candidates = [row for row in rows if row["precheck_status"] != "sync_candidate_pending_operator_spot_check"]
    return sync_candidates, hold_candidates


def csv_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "precheck_id": row.get("precheck_id"),
        "decision_id": row.get("decision_id"),
        "review_id": row.get("review_id"),
        "precheck_status": row.get("precheck_status"),
        "operator_sync_decision": row.get("operator_sync_decision"),
        "origin_name": row.get("origin_name"),
        "naver_name": row.get("naver_name"),
        "matched_distance_m": row.get("matched_distance_m"),
        "matched_road_address": row.get("matched_road_address"),
        "risk_level": row.get("risk_level"),
        "risk_flags": ";".join(row.get("risk_flags") or []),
        "required_precheck": " ; ".join(row.get("required_precheck") or []),
        "trace_id": row.get("trace_id"),
        "source_line": row.get("source_line"),
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
        "# Matched Candidate Promotion Precheck",
        "",
        "이 패키지는 matched 후보 중 가장 안전한 후보를 sync 후보와 보류 후보로 나누는 report-only 사전검수 자료입니다.",
        "",
        f"- generated_at: `{summary['generated_at']}`",
        f"- source_decision_package_dir: `{summary['source_decision_package_dir']}`",
        f"- total_precheck_candidates: {summary['total_precheck_candidates']}",
        f"- sync_candidates_pending_spot_check: {summary['sync_candidates_pending_spot_check']}",
        f"- hold_candidates_pending_spot_check: {summary['hold_candidates_pending_spot_check']}",
        "",
        "| precheck_id | status | origin | risk | distance_m | required_precheck | youtube |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in rows:
        lines.append(
            "| "
            + " | ".join(
                [
                    markdown_cell(row.get("precheck_id")),
                    markdown_cell(row.get("precheck_status")),
                    markdown_cell(row.get("origin_name")),
                    markdown_cell(row.get("risk_level")),
                    markdown_cell(row.get("matched_distance_m")),
                    markdown_cell(row.get("required_precheck")),
                    markdown_cell(row.get("youtube_link")),
                ]
            )
            + " |"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_precheck_package(decision_package_dir: Path, output_dir: Path) -> dict[str, Any]:
    decision_rows = load_jsonl(decision_package_dir / "matched-candidate-decisions.jsonl")
    rows = build_precheck_rows(decision_rows)
    sync_candidates, hold_candidates = split_precheck_rows(rows)
    output_dir.mkdir(parents=True, exist_ok=True)
    write_jsonl(output_dir / "matched-candidate-promotion-precheck.jsonl", rows)
    write_jsonl(output_dir / "sync-candidates-pending-spot-check.jsonl", sync_candidates)
    write_jsonl(output_dir / "hold-candidates-pending-spot-check.jsonl", hold_candidates)
    write_csv(output_dir / "matched-candidate-promotion-precheck.csv", rows)
    summary = {
        "generated_at": utc_now(),
        "source_decision_package_dir": str(decision_package_dir),
        "output_dir": str(output_dir),
        "total_precheck_candidates": len(rows),
        "sync_candidates_pending_spot_check": len(sync_candidates),
        "hold_candidates_pending_spot_check": len(hold_candidates),
        "precheck_status_counter": dict(Counter(row["precheck_status"] for row in rows)),
        "risk_level_counter": dict(Counter(row.get("risk_level") or "unknown" for row in rows)),
        "precheck_jsonl": str(output_dir / "matched-candidate-promotion-precheck.jsonl"),
        "precheck_csv": str(output_dir / "matched-candidate-promotion-precheck.csv"),
        "precheck_markdown": str(output_dir / "matched-candidate-promotion-precheck.md"),
        "sync_candidates_jsonl": str(output_dir / "sync-candidates-pending-spot-check.jsonl"),
        "hold_candidates_jsonl": str(output_dir / "hold-candidates-pending-spot-check.jsonl"),
    }
    (output_dir / "matched-candidate-promotion-precheck-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    write_markdown(output_dir / "matched-candidate-promotion-precheck.md", rows, summary)
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build matched candidate promotion precheck package")
    parser.add_argument("--decision-package-dir", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    decision_package_dir = args.decision_package_dir or latest_decision_package(DEFAULT_REPORT_ROOT)
    summary = write_precheck_package(decision_package_dir, args.output_dir)
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
