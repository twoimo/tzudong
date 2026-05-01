#!/usr/bin/env python3
"""Materialize stage-reprocess candidates into focused rule-evaluation inputs.

Read-only by design: this script copies source selection records into a local
report directory and narrows them to the restaurants that stage-reprocess marked
as rerunnable.  It does not mutate canonical data or Supabase.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

DEFAULT_SELECTION_DIR = Path("restaurant-evaluation/data/tzuyang/evaluation/selection")
DEFAULT_REPORT_ROOT = Path("../.omx/reports/refined-data")
RERUN_ACTIONS = {
    "rerun_rule_evaluation_with_recovered_source_geocode",
    "rerun_rule_evaluation_with_candidate_review",
    "rerun_stage1_source_geocode_then_stage2",
}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def latest_stage_report(root: Path) -> Path:
    candidates = sorted(root.glob("stage-reprocess-live-next-*"), reverse=True)
    if not candidates:
        candidates = sorted(root.glob("stage-reprocess-live-*"), reverse=True)
    if not candidates:
        raise FileNotFoundError(f"stage-reprocess report not found under {root}")
    return candidates[0]


def default_queue_paths(stage_report_dir: Path) -> list[Path]:
    queue_dir = stage_report_dir / "next_action_queues"
    if queue_dir.exists():
        manifest_path = queue_dir / "manifest.json"
        if manifest_path.exists():
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            return [
                Path(item["path"])
                for item in manifest
                if item.get("action") in RERUN_ACTIONS and int(item.get("count") or 0) > 0
            ]
        return sorted(queue_dir.glob("1*.jsonl")) + sorted(queue_dir.glob("2*.jsonl")) + sorted(queue_dir.glob("3*.jsonl"))
    return [stage_report_dir / "reprocess_candidates.jsonl"]


def video_id_from_url(url: str) -> str:
    patterns = (
        r"[?&]v=([^&]+)",
        r"youtu\.be/([^?&/]+)",
        r"/shorts/([^?&/]+)",
        r"/embed/([^?&/]+)",
    )
    for pattern in patterns:
        match = re.search(pattern, url or "")
        if match:
            return match.group(1)
    raise ValueError(f"cannot extract video id from youtube_link: {url}")


def load_last_jsonl(path: Path) -> dict[str, Any]:
    last: dict[str, Any] | None = None
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                last = json.loads(line)
    if last is None:
        raise ValueError(f"empty jsonl file: {path}")
    return last


def restaurant_matches(row: dict[str, Any], restaurant: dict[str, Any]) -> bool:
    return (
        restaurant.get("origin_name") == row.get("origin_name")
        or restaurant.get("address") == row.get("origin_address_text")
    )


def select_restaurant(row: dict[str, Any], restaurants: list[dict[str, Any]]) -> dict[str, Any] | None:
    exact_name_matches = [restaurant for restaurant in restaurants if restaurant.get("origin_name") == row.get("origin_name")]
    if exact_name_matches:
        return exact_name_matches[0]
    address_matches = [restaurant for restaurant in restaurants if restaurant.get("address") == row.get("origin_address_text")]
    if address_matches:
        return address_matches[0]
    return None


def materialize_selection_record(source_record: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any]:
    selected: list[dict[str, Any]] = []
    evaluation_target: dict[str, bool] = {}
    seen_keys: set[tuple[str, str]] = set()
    restaurants = source_record.get("restaurants", [])
    if not isinstance(restaurants, list):
        restaurants = []
    for row in rows:
        restaurant = select_restaurant(row, restaurants)
        if restaurant is None:
            continue
        name = str(restaurant.get("origin_name") or row.get("origin_name") or "")
        key = (name, str(restaurant.get("address") or ""))
        if key in seen_keys:
            continue
        selected.append(restaurant)
        evaluation_target[name] = True
        seen_keys.add(key)
    if not selected:
        raise ValueError(f"no matching restaurants in source selection: {source_record.get('youtube_link')}")

    recollect_version = source_record.get("recollect_version")
    if not isinstance(recollect_version, dict):
        recollect_version = {}
    recollect_version = {
        **recollect_version,
        "rule_rerun_materialized_at": utc_now(),
        "rule_rerun_trace_ids": [row.get("trace_id") for row in rows],
    }

    return {
        "youtube_link": source_record.get("youtube_link"),
        "channel_name": source_record.get("channel_name"),
        "evaluation_target": evaluation_target,
        "restaurants": selected,
        "recollect_version": recollect_version,
    }


def load_queue_rows(queue_paths: list[Path]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path in queue_paths:
        for row in load_jsonl(path):
            if row.get("recommended_action") in RERUN_ACTIONS:
                rows.append(row)
    return rows


def materialize_inputs(
    queue_rows: list[dict[str, Any]],
    selection_dir: Path,
    output_dir: Path,
) -> dict[str, Any]:
    selection_output_dir = output_dir / "evaluation" / "selection"
    selection_output_dir.mkdir(parents=True, exist_ok=True)
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in queue_rows:
        grouped[video_id_from_url(str(row.get("youtube_link") or ""))].append(row)

    manifest_rows: list[dict[str, Any]] = []
    missing_selection: list[dict[str, Any]] = []
    for video_id, rows in sorted(grouped.items()):
        source_path = selection_dir / f"{video_id}.jsonl"
        if not source_path.exists():
            for row in rows:
                missing_selection.append({"trace_id": row.get("trace_id"), "video_id": video_id, "source_path": str(source_path)})
            continue
        source_record = load_last_jsonl(source_path)
        rerun_record = materialize_selection_record(source_record, rows)
        output_path = selection_output_dir / f"{video_id}.jsonl"
        write_jsonl(output_path, [rerun_record])
        for row in rows:
            manifest_rows.append(
                {
                    "trace_id": row.get("trace_id"),
                    "video_id": video_id,
                    "youtube_link": row.get("youtube_link"),
                    "origin_name": row.get("origin_name"),
                    "origin_address_text": row.get("origin_address_text"),
                    "stage": row.get("stage"),
                    "recommended_action": row.get("recommended_action"),
                    "selection_file": str(output_path),
                    "source_selection_file": str(source_path),
                }
            )

    summary = {
        "generated_at": utc_now(),
        "input_rows": len(queue_rows),
        "materialized_trace_ids": len(manifest_rows),
        "materialized_videos": len({row["video_id"] for row in manifest_rows}),
        "missing_selection": len(missing_selection),
        "output_dir": str(output_dir),
        "selection_dir": str(selection_output_dir),
        "by_action": dict(Counter(row["recommended_action"] for row in manifest_rows)),
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    write_jsonl(output_dir / "rerun-input-manifest.jsonl", manifest_rows)
    write_jsonl(output_dir / "missing-selection.jsonl", missing_selection)
    (output_dir / "rerun-input-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    write_input_markdown(output_dir / "rerun-input-summary.md", summary)
    return {"summary": summary, "manifest_rows": manifest_rows, "missing_selection": missing_selection}


def find_location_result(result_record: dict[str, Any], manifest_row: dict[str, Any]) -> dict[str, Any] | None:
    evaluations = (
        result_record.get("evaluation_results", {})
        .get("location_match_TF", [])
    )
    for item in evaluations:
        if item.get("origin_name") == manifest_row.get("origin_name"):
            return item
    return None


def summarize_rule_results(output_dir: Path, manifest_rows: list[dict[str, Any]]) -> dict[str, Any]:
    rule_results_dir = output_dir / "evaluation" / "rule_results"
    rows: list[dict[str, Any]] = []
    for manifest_row in manifest_rows:
        result_path = rule_results_dir / f"{manifest_row['video_id']}.jsonl"
        if not result_path.exists():
            rows.append({**manifest_row, "rerun_status": "missing_rule_result", "eval_value": None})
            continue
        result_record = load_last_jsonl(result_path)
        location_result = find_location_result(result_record, manifest_row)
        if location_result is None:
            rows.append({**manifest_row, "rerun_status": "missing_location_result", "eval_value": None})
            continue
        eval_value = location_result.get("eval_value")
        rows.append(
            {
                **manifest_row,
                "rerun_status": "matched" if eval_value is True else "still_unresolved",
                "eval_value": eval_value,
                "match_status": location_result.get("match_status"),
                "pending_reason": location_result.get("pending_reason"),
                "false_message": location_result.get("false_message"),
                "naver_name": location_result.get("naver_name"),
                "google_name": location_result.get("google_name"),
                "evidence_summary": location_result.get("evidence_summary"),
            }
        )

    summary = {
        "generated_at": utc_now(),
        "total": len(rows),
        "by_rerun_status": dict(Counter(row["rerun_status"] for row in rows)),
        "by_action_status": {},
        "output_dir": str(output_dir),
        "rule_results_dir": str(rule_results_dir),
    }
    by_action_status: dict[str, Counter[str]] = defaultdict(Counter)
    for row in rows:
        by_action_status[str(row.get("recommended_action"))][str(row.get("rerun_status"))] += 1
    summary["by_action_status"] = {action: dict(counter) for action, counter in by_action_status.items()}

    write_jsonl(output_dir / "rule-rerun-results.jsonl", rows)
    write_jsonl(output_dir / "matched-rule-rerun-candidates.jsonl", [row for row in rows if row["rerun_status"] == "matched"])
    write_jsonl(
        output_dir / "still-unresolved-after-rule-rerun.jsonl",
        [row for row in rows if row["rerun_status"] != "matched"],
    )
    (output_dir / "rule-rerun-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    write_rule_markdown(output_dir / "rule-rerun-summary.md", summary)
    return summary


def write_input_markdown(path: Path, summary: dict[str, Any]) -> None:
    lines = [
        "# Rule Rerun Input Materialization",
        "",
        f"- generated_at: `{summary['generated_at']}`",
        f"- input_rows: {summary['input_rows']}",
        f"- materialized_trace_ids: {summary['materialized_trace_ids']}",
        f"- materialized_videos: {summary['materialized_videos']}",
        f"- missing_selection: {summary['missing_selection']}",
        f"- selection_dir: `{summary['selection_dir']}`",
        "",
        "## By action",
        "",
    ]
    for action, count in sorted(summary["by_action"].items()):
        lines.append(f"- `{action}`: {count}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_rule_markdown(path: Path, summary: dict[str, Any]) -> None:
    lines = [
        "# Rule Rerun Result Summary",
        "",
        f"- generated_at: `{summary['generated_at']}`",
        f"- total: {summary['total']}",
        f"- rule_results_dir: `{summary['rule_results_dir']}`",
        "",
        "## Output files",
        "",
        "- `rule-rerun-results.jsonl`: all manifest rows with rerun status",
        "- `matched-rule-rerun-candidates.jsonl`: rows that passed rule rerun",
        "- `still-unresolved-after-rule-rerun.jsonl`: rows still blocked after rule rerun",
        "",
        "## Status",
        "",
    ]
    for status, count in sorted(summary["by_rerun_status"].items()):
        lines.append(f"- `{status}`: {count}")
    lines += ["", "## By action/status", ""]
    for action, counter in sorted(summary["by_action_status"].items()):
        lines.append(f"- `{action}`")
        for status, count in sorted(counter.items()):
            lines.append(f"  - `{status}`: {count}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Materialize focused rule rerun inputs from stage reprocess queues")
    parser.add_argument("--stage-report-dir", type=Path)
    parser.add_argument("--queue", type=Path, action="append", default=[])
    parser.add_argument("--selection-dir", type=Path, default=DEFAULT_SELECTION_DIR)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--summarize-rule-results", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    stage_report_dir = args.stage_report_dir or latest_stage_report(DEFAULT_REPORT_ROOT)
    queue_paths = args.queue or default_queue_paths(stage_report_dir)
    queue_rows = load_queue_rows(queue_paths)
    result = materialize_inputs(queue_rows, args.selection_dir, args.output_dir)
    payload = {
        "stage_report_dir": str(stage_report_dir),
        "queue_paths": [str(path) for path in queue_paths],
        "summary": result["summary"],
    }
    if args.summarize_rule_results:
        payload["rule_summary"] = summarize_rule_results(args.output_dir, result["manifest_rows"])
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
