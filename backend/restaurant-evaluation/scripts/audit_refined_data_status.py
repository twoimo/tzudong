#!/usr/bin/env python3
"""Audit refined evaluation data and optionally compare with Supabase.

This script is intentionally read-only.  It never writes to Supabase or mutates
`transforms.jsonl`; it produces local reports/queues that make the next cleanup
work explicit while preserving admin-reviewed DB state as the source of truth.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

try:
    from dotenv import load_dotenv
except Exception:  # pragma: no cover - optional runtime dependency
    load_dotenv = None

BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from utils.runtime_paths import load_backend_env, resolve_backend_root

try:
    from supabase import create_client
except Exception:  # pragma: no cover - optional runtime dependency
    create_client = None

DEFAULT_TRANSFORMS = Path("restaurant-evaluation/data/tzuyang/evaluation/transforms.jsonl")
DEFAULT_REPORT_DIR = Path("../.omx/reports/refined-data")
DB_FIELDS = (
    "id,trace_id,status,approved_name,origin_name,naver_name,google_name,"
    "updated_by_admin_id,geocoding_success,geocoding_false_stage,"
    "is_missing,is_not_selected,youtube_link"
)
REVIEW_LOCK_STATUSES = {"approved", "deleted"}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def nested_get(record: dict[str, Any], dotted: str) -> Any:
    current: Any = record
    for part in dotted.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


def is_not_selected(record: dict[str, Any]) -> bool:
    return record.get("is_notSelected") is True or record.get("is_not_selected") is True


def is_ready_for_approval(record: dict[str, Any]) -> bool:
    return (
        nested_get(record, "evaluation_results.visit_authenticity.eval_value") == 1
        and nested_get(record, "evaluation_results.rb_inference_score.eval_value") == 1
        and nested_get(record, "evaluation_results.rb_grounding_TF.eval_value") is True
        and nested_get(record, "evaluation_results.review_faithfulness_score.eval_value") == 1
        and record.get("geocoding_success") is True
        and nested_get(record, "evaluation_results.category_validity_TF.eval_value") is True
        and nested_get(record, "evaluation_results.category_TF.eval_value") is True
        and record.get("status") in {"pending", "hold"}
    )


def string_or_empty(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def origin_address_text(record: dict[str, Any]) -> str:
    origin_address = record.get("origin_address")
    if isinstance(origin_address, dict):
        for key in ("address", "roadAddress", "jibunAddress"):
            value = string_or_empty(origin_address.get(key))
            if value:
                return value
    return string_or_empty(origin_address)


def geocoding_failure_bucket(record: dict[str, Any]) -> str:
    if record.get("geocoding_success") is True:
        return "geocoding_success"
    if record.get("is_missing") is True:
        return "missing"
    if is_not_selected(record):
        return "not_selected"

    false_stage = record.get("geocoding_false_stage")
    if false_stage is None:
        return "geocoder_failed_or_no_result"
    if false_stage == 0:
        return "not_evaluation_target"
    if false_stage == 1:
        return "source_location_unresolved"
    if false_stage == 2:
        return "candidate_location_mismatch"
    return f"unknown_stage_{false_stage}"


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            row = json.loads(line)
            row["_line"] = line_number
            rows.append(row)
    return rows


def safe_record_view(record: dict[str, Any]) -> dict[str, Any]:
    address_text = origin_address_text(record)
    return {
        "line": record.get("_line"),
        "trace_id": record.get("trace_id"),
        "status": record.get("status"),
        "origin_name": record.get("origin_name"),
        "naver_name": record.get("naver_name"),
        "google_name": record.get("google_name"),
        "youtube_link": record.get("youtube_link"),
        "geocoding_success": record.get("geocoding_success"),
        "geocoding_false_stage": record.get("geocoding_false_stage"),
        "geocoding_failure_bucket": geocoding_failure_bucket(record),
        "has_origin_address": bool(address_text),
        "has_description_map_url": bool(string_or_empty(record.get("description_map_url"))),
        "is_missing": record.get("is_missing"),
        "is_not_selected": is_not_selected(record),
        "origin_address_text": address_text,
        "ready_for_approval": is_ready_for_approval(record),
        "source_type": record.get("source_type"),
    }



def stringify_counter(counter: Counter[Any]) -> dict[str, int]:
    return {str(key): value for key, value in counter.items()}

def local_counts(records: list[dict[str, Any]]) -> dict[str, Any]:
    geocoding_failed = [row for row in records if not bool(row.get("geocoding_success"))]
    missing = [row for row in records if row.get("is_missing") is True]
    not_selected = [row for row in records if is_not_selected(row)]
    pure_geocoding_failures = [
        row
        for row in geocoding_failed
        if row.get("is_missing") is not True and not is_not_selected(row)
    ]
    ready = [row for row in records if is_ready_for_approval(row)]
    return {
        "total": len(records),
        "pending": sum(row.get("status") == "pending" for row in records),
        "approved": sum(row.get("status") == "approved" for row in records),
        "deleted": sum(row.get("status") == "deleted" for row in records),
        "ready_for_approval": len(ready),
        "missing": len(missing),
        "not_selected": len(not_selected),
        "geocoding_failed": len(geocoding_failed),
        "pure_geocoding_failed": len(pure_geocoding_failures),
        "status_counter": stringify_counter(Counter(row.get("status") for row in records)),
        "geocoding_success_counter": stringify_counter(Counter(row.get("geocoding_success") for row in records)),
        "geocoding_false_stage_counter": stringify_counter(Counter(row.get("geocoding_false_stage") for row in records)),
    }


def queue_records(records: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    return {
        "01_pure_geocoding_failures": [
            safe_record_view(row)
            for row in records
            if not bool(row.get("geocoding_success"))
            and row.get("is_missing") is not True
            and not is_not_selected(row)
        ],
        "02_approval_ready": [safe_record_view(row) for row in records if is_ready_for_approval(row)],
        "03_missing_recovery": [safe_record_view(row) for row in records if row.get("is_missing") is True],
        "04_not_selected_audit": [safe_record_view(row) for row in records if is_not_selected(row)],
    }


def chunked(values: list[str], size: int) -> Iterable[list[str]]:
    for index in range(0, len(values), size):
        yield values[index : index + size]


def load_supabase_client() -> Any | None:
    if create_client is None:
        return None

    backend_root = resolve_backend_root(Path(__file__).resolve())
    legacy_env = Path(__file__).parent.parent / ".env"
    if legacy_env.exists() and load_dotenv is not None:
        load_dotenv(legacy_env)
    load_backend_env(backend_root, prefer_local=False)

    url = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("VITE_SUPABASE_PUBLISHABLE_KEY")
    if not url or not key:
        return None
    return create_client(url, key)


def fetch_db_rows_by_trace_id(trace_ids: list[str], chunk_size: int = 100) -> dict[str, dict[str, Any]]:
    client = load_supabase_client()
    if client is None:
        return {}

    rows: dict[str, dict[str, Any]] = {}
    for chunk in chunked(trace_ids, chunk_size):
        response = client.table("restaurants").select(DB_FIELDS).in_("trace_id", chunk).execute()
        for row in response.data or []:
            trace_id = row.get("trace_id")
            if trace_id:
                rows[trace_id] = row
    return rows


def has_admin_lock(row: dict[str, Any]) -> bool:
    return bool(row.get("updated_by_admin_id")) or row.get("status") in REVIEW_LOCK_STATUSES


def compare_with_db(records: list[dict[str, Any]], db_rows: dict[str, dict[str, Any]]) -> dict[str, Any]:
    matched = 0
    status_drift: Counter[str] = Counter()
    locked_by_queue: dict[str, int] = Counter()
    db_status: Counter[str] = Counter()
    local_by_trace = {row.get("trace_id"): row for row in records if row.get("trace_id")}

    queues = queue_records(records)
    queue_membership: dict[str, set[str]] = {}
    for queue_name, rows in queues.items():
        for row in rows:
            if row.get("trace_id"):
                queue_membership.setdefault(str(row["trace_id"]), set()).add(queue_name)

    reviewed_rows: list[dict[str, Any]] = []
    db_missing_rows: list[dict[str, Any]] = []
    locked_trace_ids_by_queue: dict[str, set[str]] = {name: set() for name in queues}
    trace_ids_with_db_rows = set(db_rows)

    for trace_id, local_row in local_by_trace.items():
        if trace_id not in trace_ids_with_db_rows:
            db_missing_rows.append(safe_record_view(local_row))

    for trace_id, db_row in db_rows.items():
        local_row = local_by_trace.get(trace_id)
        if not local_row:
            continue
        matched += 1
        db_status[str(db_row.get("status"))] += 1
        local_status = local_row.get("status")
        remote_status = db_row.get("status")
        if local_status != remote_status:
            status_drift[f"{local_status}->{remote_status}"] += 1
        if has_admin_lock(db_row):
            for queue_name in queue_membership.get(trace_id, set()):
                locked_by_queue[queue_name] += 1
                locked_trace_ids_by_queue.setdefault(queue_name, set()).add(trace_id)
            reviewed_rows.append(
                {
                    "trace_id": trace_id,
                    "local_status": local_status,
                    "db_status": remote_status,
                    "approved_name": db_row.get("approved_name"),
                    "origin_name": db_row.get("origin_name"),
                    "youtube_link": db_row.get("youtube_link"),
                    "admin_locked": has_admin_lock(db_row),
                }
            )

    queue_counts = {name: len(rows) for name, rows in queues.items()}
    actionable_after_db_lock = {
        name: count - len(locked_trace_ids_by_queue.get(name, set()))
        for name, count in queue_counts.items()
    }
    actionable_trace_ids_by_queue = {
        name: sorted(
            str(row["trace_id"])
            for row in rows
            if row.get("trace_id")
            and str(row["trace_id"]) not in locked_trace_ids_by_queue.get(name, set())
        )
        for name, rows in queues.items()
    }

    return {
        "db_enabled": True,
        "db_matched_by_trace_id": matched,
        "db_missing_for_local_trace_id": len(local_by_trace) - matched,
        "db_status_counter": dict(db_status),
        "local_to_db_status_drift": dict(status_drift),
        "admin_locked_rows": len(reviewed_rows),
        "admin_locked_by_queue": dict(locked_by_queue),
        "actionable_queue_counts_after_db_lock": actionable_after_db_lock,
        "actionable_trace_ids_by_queue": actionable_trace_ids_by_queue,
        "db_missing_local_records": db_missing_rows,
        "reviewed_rows_sample": reviewed_rows[:50],
        "reviewed_rows": reviewed_rows,
    }


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def filter_rows_by_trace_ids(rows: list[dict[str, Any]], trace_ids: set[str]) -> list[dict[str, Any]]:
    return [row for row in rows if row.get("trace_id") and str(row["trace_id"]) in trace_ids]


def write_supabase_overlay_outputs(
    report_dir: Path,
    queues: dict[str, list[dict[str, Any]]],
    comparison: dict[str, Any] | None,
) -> None:
    if not comparison or not comparison.get("db_enabled"):
        return

    actionable_dir = report_dir / "actionable_after_db_lock"
    actionable_dir.mkdir(parents=True, exist_ok=True)
    trace_ids_by_queue = comparison.get("actionable_trace_ids_by_queue", {})

    for queue_name, rows in queues.items():
        trace_ids = set(trace_ids_by_queue.get(queue_name, []))
        write_jsonl(actionable_dir / f"{queue_name}.jsonl", filter_rows_by_trace_ids(rows, trace_ids))

    write_jsonl(report_dir / "supabase_missing_local_records.jsonl", comparison.get("db_missing_local_records", []))
    write_jsonl(report_dir / "supabase_admin_locked_rows.jsonl", comparison.get("reviewed_rows", []))


def write_markdown(path: Path, payload: dict[str, Any]) -> None:
    local = payload["local_counts"]
    db = payload.get("supabase_comparison") or {"db_enabled": False}
    lines = [
        "# Refined Data Reduction Audit",
        "",
        f"- generated_at: `{payload['generated_at']}`",
        f"- source: `{payload['source']}`",
        f"- mode: `{'local+supabase-readonly' if db.get('db_enabled') else 'local-only'}`",
        "",
        "## Local refined counts",
        "",
        "| Metric | Count |",
        "|---|---:|",
    ]
    for key in (
        "total",
        "pending",
        "approved",
        "deleted",
        "ready_for_approval",
        "missing",
        "not_selected",
        "geocoding_failed",
        "pure_geocoding_failed",
    ):
        lines.append(f"| {key} | {local[key]} |")

    lines += ["", "## Priority queues", ""]
    for queue_name, count in payload["queue_counts"].items():
        lines.append(f"- `{queue_name}`: {count}")

    if db.get("db_enabled"):
        lines += [
            "",
            "## Supabase read-only comparison",
            "",
            f"- matched_by_trace_id: {db['db_matched_by_trace_id']}",
            f"- missing_for_local_trace_id: {db['db_missing_for_local_trace_id']}",
            f"- admin_locked_rows: {db['admin_locked_rows']}",
            f"- db_status_counter: `{json.dumps(db['db_status_counter'], ensure_ascii=False, sort_keys=True)}`",
            f"- local_to_db_status_drift: `{json.dumps(db['local_to_db_status_drift'], ensure_ascii=False, sort_keys=True)}`",
            f"- admin_locked_by_queue: `{json.dumps(db['admin_locked_by_queue'], ensure_ascii=False, sort_keys=True)}`",
            f"- actionable_queue_counts_after_db_lock: `{json.dumps(db.get('actionable_queue_counts_after_db_lock', {}), ensure_ascii=False, sort_keys=True)}`",
            "",
            "Actionable queue files are written under `actionable_after_db_lock/` and exclude Supabase admin-locked rows.",
            "`supabase_missing_local_records.jsonl` lists local records with no matching DB trace_id.",
        ]
    else:
        lines += [
            "",
            "## Supabase read-only comparison",
            "",
            "Skipped: Supabase client/env was unavailable or `--include-supabase` was not set.",
        ]

    lines += [
        "",
        "## Operating conclusion",
        "",
        "Do not overwrite Supabase from the data branch. Use Supabase admin-reviewed rows as the review-state source of truth and use the generated queues for reversible follow-up work.",
    ]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit refined evaluation data status counts and queues")
    parser.add_argument("--transforms", type=Path, default=DEFAULT_TRANSFORMS)
    parser.add_argument("--report-dir", type=Path, default=DEFAULT_REPORT_DIR)
    parser.add_argument("--include-supabase", action="store_true", help="Read Supabase rows by trace_id for comparison only")
    parser.add_argument("--json", dest="json_output", type=Path, default=None, help="Optional explicit JSON report path")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    transforms = args.transforms
    if not transforms.exists():
        raise SystemExit(f"transforms file not found: {transforms}")

    records = load_jsonl(transforms)
    queues = queue_records(records)
    report_dir = args.report_dir
    report_dir.mkdir(parents=True, exist_ok=True)

    for queue_name, rows in queues.items():
        write_jsonl(report_dir / f"{queue_name}.jsonl", rows)

    comparison: dict[str, Any] | None = None
    if args.include_supabase:
        trace_ids = sorted({str(row["trace_id"]) for row in records if row.get("trace_id")})
        db_rows = fetch_db_rows_by_trace_id(trace_ids)
        comparison = compare_with_db(records, db_rows) if db_rows else {"db_enabled": False, "reason": "no db rows or client unavailable"}
        write_supabase_overlay_outputs(report_dir, queues, comparison)

    payload = {
        "generated_at": utc_now(),
        "source": str(transforms),
        "local_counts": local_counts(records),
        "queue_counts": {name: len(rows) for name, rows in queues.items()},
        "supabase_comparison": comparison,
        "report_dir": str(report_dir),
    }

    json_path = args.json_output or (report_dir / "refined-data-audit.json")
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    write_markdown(report_dir / "refined-data-audit.md", payload)

    print(json.dumps(payload, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
