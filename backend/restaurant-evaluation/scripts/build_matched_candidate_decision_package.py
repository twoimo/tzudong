#!/usr/bin/env python3
"""Build a report-only decision package for matched rule-rerun candidates.

This script does not promote matches, edit transforms.jsonl, or write Supabase.
It prepares P0 matched_review_candidate rows for human/downstream decisions by
making risk gates explicit and splitting candidates into safe follow-up queues.
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

VERY_LARGE_DISTANCE_FLAG = "very_large_distance_over_1000m"
LARGE_DISTANCE_FLAG = "large_distance_over_200m"
STAGE_RECOVERY_FLAG = "stage1_then_stage2_recovered"


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
        [path for path in root.glob("rule-rerun-*") if (path / "matched-review-candidates.jsonl").exists()],
        key=lambda path: path.name,
        reverse=True,
    )
    if not candidates:
        raise FileNotFoundError(f"matched review package not found under {root}")
    return candidates[0]


def load_ledger_review_ids(ledger_dir: Path | None) -> dict[str, str]:
    if ledger_dir is None:
        return {}
    ids: dict[str, str] = {}
    for row in load_jsonl(ledger_dir / "review-execution-ledger.jsonl"):
        if row.get("job_kind") == "matched_review_candidate" and row.get("trace_id"):
            ids[str(row["trace_id"])] = str(row.get("review_id") or "")
    return ids


def risk_level(flags: list[str]) -> str:
    if VERY_LARGE_DISTANCE_FLAG in flags:
        return "critical"
    if LARGE_DISTANCE_FLAG in flags:
        return "high"
    if STAGE_RECOVERY_FLAG in flags:
        return "medium"
    return "low"


def suggested_decision(flags: list[str]) -> str:
    if VERY_LARGE_DISTANCE_FLAG in flags:
        return "needs_more_evidence_before_approval"
    if LARGE_DISTANCE_FLAG in flags:
        return "manual_distance_review_required"
    if STAGE_RECOVERY_FLAG in flags:
        return "approval_candidate_after_stage_recovery_spot_check"
    return "approval_candidate_after_spot_check"


def required_checks(flags: list[str]) -> list[str]:
    checks = ["verify_video_place_identity", "verify_matched_provider_address"]
    if VERY_LARGE_DISTANCE_FLAG in flags:
        checks.extend(["verify_source_coordinates", "verify_large_distance_explanation", "reject_if_no_video_address_evidence"])
    elif LARGE_DISTANCE_FLAG in flags:
        checks.extend(["verify_distance_reason", "confirm_no_closer_same-name_candidate"])
    if STAGE_RECOVERY_FLAG in flags:
        checks.append("verify_stage1_recovered_source_geocode")
    return checks


def decision_queue(flags: list[str]) -> str:
    if VERY_LARGE_DISTANCE_FLAG in flags:
        return "critical_distance_evidence_review"
    if LARGE_DISTANCE_FLAG in flags:
        return "manual_distance_review"
    if STAGE_RECOVERY_FLAG in flags:
        return "stage_recovery_spot_check"
    return "approval_ready_spot_check"


def build_decision_rows(
    matched_rows: list[dict[str, Any]],
    *,
    ledger_review_ids: dict[str, str] | None = None,
) -> list[dict[str, Any]]:
    ledger_review_ids = ledger_review_ids or {}
    output: list[dict[str, Any]] = []
    for index, row in enumerate(matched_rows, 1):
        trace_id = str(row.get("trace_id") or "")
        flags = sorted(set(row.get("risk_flags") or []))
        output.append(
            {
                "decision_id": f"MCD-{index:04d}-{trace_id[:12]}",
                "review_id": ledger_review_ids.get(trace_id, ""),
                "trace_id": trace_id,
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
                "risk_flags": flags,
                "risk_level": risk_level(flags),
                "suggested_decision": suggested_decision(flags),
                "decision_queue": decision_queue(flags),
                "decision_status": "pending",
                "required_checks": required_checks(flags),
                "operator_decision_options": ["approve_sync", "reject_match", "needs_more_evidence"],
                "operator_decision": "",
                "operator_notes": "",
                "proposed_sync_fields": row.get("proposed_sync_fields") or {},
                "evidence_summary": row.get("evidence_summary"),
            }
        )
    return output


def csv_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "decision_id": row.get("decision_id"),
        "review_id": row.get("review_id"),
        "risk_level": row.get("risk_level"),
        "decision_queue": row.get("decision_queue"),
        "suggested_decision": row.get("suggested_decision"),
        "decision_status": row.get("decision_status"),
        "operator_decision": row.get("operator_decision"),
        "origin_name": row.get("origin_name"),
        "naver_name": row.get("naver_name"),
        "matched_distance_m": row.get("matched_distance_m"),
        "matched_road_address": row.get("matched_road_address"),
        "risk_flags": ";".join(row.get("risk_flags") or []),
        "required_checks": " ; ".join(row.get("required_checks") or []),
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
        "# Matched Candidate Decision Package",
        "",
        "이 패키지는 P0 matched 후보를 DB/원본 반영 전 승인/거절/추가증거 필요로 판단하기 위한 report-only 검수 자료입니다.",
        "",
        f"- generated_at: `{summary['generated_at']}`",
        f"- source_review_package_dir: `{summary['source_review_package_dir']}`",
        f"- total_candidates: {summary['total_candidates']}",
        "",
        "## Decision queues",
        "",
    ]
    for queue, count in sorted(summary["decision_queue_counter"].items()):
        lines.append(f"- `{queue}`: {count}")
    lines += [
        "",
        "## Candidates",
        "",
        "| decision_id | review_id | risk | queue | origin | distance_m | suggested_decision | flags | youtube |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in rows:
        lines.append(
            "| "
            + " | ".join(
                [
                    markdown_cell(row.get("decision_id")),
                    markdown_cell(row.get("review_id")),
                    markdown_cell(row.get("risk_level")),
                    markdown_cell(row.get("decision_queue")),
                    markdown_cell(row.get("origin_name")),
                    markdown_cell(row.get("matched_distance_m")),
                    markdown_cell(row.get("suggested_decision")),
                    markdown_cell(row.get("risk_flags")),
                    markdown_cell(row.get("youtube_link")),
                ]
            )
            + " |"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_queue_exports(output_dir: Path, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    queue_dir = output_dir / "decision_queues"
    manifests: list[dict[str, Any]] = []
    for queue in sorted({row["decision_queue"] for row in rows}):
        queue_rows = [row for row in rows if row["decision_queue"] == queue]
        path = queue_dir / f"{queue}.jsonl"
        write_jsonl(path, queue_rows)
        manifests.append({"queue": queue, "count": len(queue_rows), "path": str(path)})
    (queue_dir / "manifest.json").write_text(
        json.dumps(manifests, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return manifests


def write_decision_package(review_package_dir: Path, output_dir: Path, ledger_dir: Path | None = None) -> dict[str, Any]:
    matched_rows = load_jsonl(review_package_dir / "matched-review-candidates.jsonl")
    rows = build_decision_rows(matched_rows, ledger_review_ids=load_ledger_review_ids(ledger_dir))
    output_dir.mkdir(parents=True, exist_ok=True)
    write_jsonl(output_dir / "matched-candidate-decisions.jsonl", rows)
    write_csv(output_dir / "matched-candidate-decisions.csv", rows)
    queue_manifest = write_queue_exports(output_dir, rows)
    summary = {
        "generated_at": utc_now(),
        "source_review_package_dir": str(review_package_dir),
        "source_ledger_dir": str(ledger_dir) if ledger_dir else None,
        "output_dir": str(output_dir),
        "total_candidates": len(rows),
        "risk_level_counter": dict(Counter(row["risk_level"] for row in rows)),
        "decision_queue_counter": dict(Counter(row["decision_queue"] for row in rows)),
        "suggested_decision_counter": dict(Counter(row["suggested_decision"] for row in rows)),
        "pending_decisions": sum(1 for row in rows if row["decision_status"] == "pending"),
        "queue_manifest": queue_manifest,
        "decisions_jsonl": str(output_dir / "matched-candidate-decisions.jsonl"),
        "decisions_csv": str(output_dir / "matched-candidate-decisions.csv"),
        "decisions_markdown": str(output_dir / "matched-candidate-decisions.md"),
    }
    (output_dir / "matched-candidate-decision-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    write_markdown(output_dir / "matched-candidate-decisions.md", rows, summary)
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build P0 matched candidate decision package")
    parser.add_argument("--review-package-dir", type=Path)
    parser.add_argument("--ledger-dir", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    review_package_dir = args.review_package_dir or latest_review_package(DEFAULT_REPORT_ROOT)
    summary = write_decision_package(review_package_dir, args.output_dir, args.ledger_dir)
    print(json.dumps(summary, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
