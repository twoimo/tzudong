#!/usr/bin/env python3
"""Sync category review resolutions to Supabase with review-lock protection.

Only pending/unlocked rows are eligible. Approved/deleted/admin-updated rows are
reported as locked and left untouched so administrator review remains the source
of truth.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from dotenv import load_dotenv
except Exception:  # pragma: no cover
    load_dotenv = None

BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from utils.runtime_paths import load_backend_env, resolve_backend_root
from utils.supabase_rest import (
    SupabaseRestConfigurationError,
    resolve_privileged_supabase_rest_credentials,
)

try:
    from supabase import create_client
except Exception as exc:  # pragma: no cover
    create_client = None
    SUPABASE_IMPORT_ERROR = exc
else:  # pragma: no cover
    SUPABASE_IMPORT_ERROR = None

DEFAULT_CHANGES_PATH = Path(
    "../.omx/reports/refined-data/category-review-resolution-apply-20260501T1435Z/"
    "category-review-resolution-apply-changes.jsonl"
)
DEFAULT_REPORT_ROOT = Path("../.omx/reports/refined-data")
LOCKED_STATUSES = {"approved", "deleted"}
COMPARE_AND_SET_CONFLICT = "compare_and_set_conflict"
CATEGORY_REVIEW_FIELDS = (
    "id",
    "status",
    "updated_by_admin_id",
    "updated_at",
    "categories",
    "evaluation_results",
)
CATEGORY_READBACK_FIELDS = "id,status,updated_by_admin_id,updated_at,categories,evaluation_results"


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def timestamp_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise FileNotFoundError(path)
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows), encoding="utf-8")


def normalize_categories(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value] if value else []
    if isinstance(value, list):
        output: list[str] = []
        for item in value:
            if isinstance(item, str) and item and item not in output:
                output.append(item)
        return output
    return []


def merge_evaluation_results(existing: Any, category_validity: dict[str, Any]) -> dict[str, Any]:
    merged = dict(existing) if isinstance(existing, dict) else {}
    merged["category_validity_TF"] = category_validity
    return merged


def is_review_locked(row: dict[str, Any]) -> bool:
    return row.get("status") in LOCKED_STATUSES or bool(row.get("updated_by_admin_id"))


def reviewed_fields(row: dict[str, Any]) -> dict[str, Any]:
    return {field: row.get(field) for field in CATEGORY_REVIEW_FIELDS}


def json_filter_value(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def text_array_filter_value(value: list[Any]) -> str:
    entries = []
    for item in value:
        if item is None:
            entries.append("NULL")
        else:
            entries.append('"' + str(item).replace("\\", "\\\\").replace('"', '\\"') + '"')
    return "{" + ",".join(entries) + "}"


def bind_exact_value(query: Any, column: str, value: Any, *, text_array: bool = False, jsonb: bool = False) -> Any:
    if value is None:
        return query.is_(column, None)
    if text_array:
        return query.eq(column, text_array_filter_value(value))
    if jsonb:
        return query.eq(column, json_filter_value(value))
    return query.eq(column, value)


def bind_category_compare_and_set(query: Any, reviewed: dict[str, Any]) -> Any:
    query = bind_exact_value(query, "id", reviewed["id"])
    query = bind_exact_value(query, "status", reviewed["status"])
    query = bind_exact_value(query, "updated_by_admin_id", reviewed["updated_by_admin_id"])
    query = bind_exact_value(query, "updated_at", reviewed["updated_at"])
    query = bind_exact_value(query, "categories", reviewed["categories"], text_array=True)
    return bind_exact_value(query, "evaluation_results", reviewed["evaluation_results"], jsonb=True)


def category_row_matches_reviewed(row: dict[str, Any], reviewed: dict[str, Any]) -> bool:
    return all(row.get(field) == reviewed[field] for field in CATEGORY_REVIEW_FIELDS)


def category_readback_matches_payload(row: dict[str, Any], reviewed: dict[str, Any], payload: dict[str, Any]) -> bool:
    return (
        all(row.get(field) == reviewed[field] for field in ("id", "status", "updated_by_admin_id"))
        and row.get("categories") == payload["categories"]
        and row.get("evaluation_results") == payload["evaluation_results"]
    )


def conflict_record(row: dict[str, Any], stage: str) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "trace_id": row.get("trace_id"),
        "origin_name": row.get("origin_name"),
        "source_line": row.get("source_line"),
        "skip_reason": COMPARE_AND_SET_CONFLICT,
        "conflict_stage": stage,
    }


def apply_category_compare_and_set(client: Any, row: dict[str, Any]) -> tuple[bool, dict[str, Any] | None]:
    reviewed = row["reviewed"]
    recheck = (
        client.table("restaurants")
        .select(CATEGORY_READBACK_FIELDS)
        .eq("id", reviewed["id"])
        .execute()
        .data
        or []
    )
    if len(recheck) != 1:
        return False, conflict_record(row, "recheck_not_exactly_one")
    current = recheck[0]
    if is_review_locked(current):
        return False, conflict_record(row, "protective_lock_changed")
    if not category_row_matches_reviewed(current, reviewed):
        return False, conflict_record(row, "reviewed_values_changed")

    affected = bind_category_compare_and_set(
        client.table("restaurants").update(row["payload"]),
        reviewed,
    ).execute().data or []
    if len(affected) != 1:
        return False, conflict_record(row, "affected_row_count_not_one")

    readback = (
        client.table("restaurants")
        .select(CATEGORY_READBACK_FIELDS)
        .eq("id", reviewed["id"])
        .execute()
        .data
        or []
    )
    if len(readback) != 1 or not category_readback_matches_payload(readback[0], reviewed, row["payload"]):
        return False, conflict_record(row, "readback_not_exactly_one_or_mismatched")
    return True, None


def public_eligible_row(row: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in row.items() if key != "reviewed"}


def classify_updates(changes: list[dict[str, Any]], db_rows: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    db_by_trace = {row.get("trace_id"): row for row in db_rows}
    eligible: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for change in changes:
        trace_id = change.get("trace_id")
        db_row = db_by_trace.get(trace_id)
        categories = normalize_categories(change.get("after_category"))
        category_validity = change.get("after_category_validity_TF")
        base = {
            "trace_id": trace_id,
            "origin_name": change.get("origin_name"),
            "source_line": change.get("source_line"),
            "categories": categories,
            "category_validity_TF": category_validity,
        }
        if not db_row:
            skipped.append({**base, "skip_reason": "missing_in_supabase"})
            continue
        status = db_row.get("status")
        admin_locked = bool(db_row.get("updated_by_admin_id"))
        if is_review_locked(db_row):
            skipped.append({**base, "skip_reason": "review_locked", "status": status, "admin_locked": admin_locked})
            continue
        eligible.append(
            {
                **base,
                "id": db_row.get("id"),
                "status": status,
                "payload": {
                    "categories": categories,
                    "evaluation_results": merge_evaluation_results(db_row.get("evaluation_results"), category_validity),
                },
                "reviewed": reviewed_fields(db_row),
            }
        )
    return eligible, skipped


def fetch_rows(client: Any, trace_ids: list[str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for i in range(0, len(trace_ids), 100):
        response = (
            client.table("restaurants")
            .select("id,trace_id,status,categories,evaluation_results,updated_by_admin_id,updated_at,origin_name,approved_name")
            .in_("trace_id", trace_ids[i : i + 100])
            .execute()
        )
        rows.extend(response.data or [])
    return rows


def sync_to_supabase(changes_path: Path, output_dir: Path, *, apply: bool) -> dict[str, Any]:
    if create_client is None:
        raise RuntimeError(f"supabase package unavailable: {SUPABASE_IMPORT_ERROR}")
    backend_root = resolve_backend_root(Path(__file__).resolve())
    legacy_env = Path(__file__).parent.parent / ".env"
    if legacy_env.exists() and load_dotenv is not None:
        load_dotenv(legacy_env)
    load_backend_env(backend_root, prefer_local=False)
    credentials = resolve_privileged_supabase_rest_credentials()
    changes = load_jsonl(changes_path)
    trace_ids = [change["trace_id"] for change in changes]
    client = create_client(credentials.url, credentials.service_role_key)
    db_rows = fetch_rows(client, trace_ids)
    eligible, skipped = classify_updates(changes, db_rows)

    mode = "apply" if apply else "dry-run"
    applied: list[dict[str, Any]] = []
    if apply:
        for row in eligible:
            applied_exactly_once, conflict = apply_category_compare_and_set(client, row)
            if not applied_exactly_once:
                assert conflict is not None
                skipped.append(conflict)
                continue
            applied.append({k: row[k] for k in ("id", "trace_id", "origin_name", "source_line", "categories", "status")})

    output_dir.mkdir(parents=True, exist_ok=True)
    eligible_path = output_dir / f"supabase-category-review-{mode}-eligible.jsonl"
    skipped_path = output_dir / f"supabase-category-review-{mode}-skipped.jsonl"
    applied_path = output_dir / f"supabase-category-review-{mode}-applied.jsonl"
    summary_path = output_dir / f"supabase-category-review-{mode}-summary.json"
    write_jsonl(eligible_path, [public_eligible_row(row) for row in eligible])
    write_jsonl(skipped_path, skipped)
    write_jsonl(applied_path, applied)
    summary = {
        "generated_at": utc_now(),
        "mode": mode,
        "safety_scope": "pending_unlocked_categories_and_category_validity_only",
        "changes_path": str(changes_path),
        "output_dir": str(output_dir),
        "change_rows": len(changes),
        "supabase_rows_found": len(db_rows),
        "eligible_pending_unlocked": len(eligible),
        "skipped_locked_or_missing": len(skipped),
        "applied_updates": len(applied),
        "eligible_status_counter": dict(Counter(row.get("status") for row in eligible)),
        "skipped_reason_counter": dict(Counter(row.get("skip_reason") for row in skipped)),
        "skipped_status_counter": dict(Counter(row.get("status") for row in skipped)),
        "eligible_jsonl": str(eligible_path),
        "skipped_jsonl": str(skipped_path),
        "applied_jsonl": str(applied_path),
        "summary_json": str(summary_path),
    }
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--changes", type=Path, default=DEFAULT_CHANGES_PATH)
    parser.add_argument("--output-dir", type=Path, default=None)
    parser.add_argument("--apply", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_dir = args.output_dir or DEFAULT_REPORT_ROOT / f"supabase-category-review-sync-{timestamp_slug()}"
    try:
        summary = sync_to_supabase(args.changes, output_dir, apply=args.apply)
    except SupabaseRestConfigurationError:
        print("[ERROR] Supabase REST configuration invalid.")
        sys.exit(1)
    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
