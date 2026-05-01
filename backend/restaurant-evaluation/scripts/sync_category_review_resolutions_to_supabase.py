#!/usr/bin/env python3
"""Sync category review resolutions to Supabase with review-lock protection.

Only pending/unlocked rows are eligible. Approved/deleted/admin-updated rows are
reported as locked and left untouched so administrator review remains the source
of truth.
"""

from __future__ import annotations

import argparse
import json
import os
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
        if status in LOCKED_STATUSES or admin_locked:
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
            }
        )
    return eligible, skipped


def fetch_rows(client: Any, trace_ids: list[str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for i in range(0, len(trace_ids), 100):
        response = (
            client.table("restaurants")
            .select("id,trace_id,status,categories,evaluation_results,updated_by_admin_id,origin_name,approved_name")
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
    url = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("VITE_SUPABASE_PUBLISHABLE_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY missing")

    changes = load_jsonl(changes_path)
    trace_ids = [change["trace_id"] for change in changes]
    client = create_client(url, key)
    db_rows = fetch_rows(client, trace_ids)
    eligible, skipped = classify_updates(changes, db_rows)

    mode = "apply" if apply else "dry-run"
    applied: list[dict[str, Any]] = []
    if apply:
        for row in eligible:
            client.table("restaurants").update(row["payload"]).eq("id", row["id"]).execute()
            applied.append({k: row[k] for k in ("id", "trace_id", "origin_name", "source_line", "categories", "status")})

    output_dir.mkdir(parents=True, exist_ok=True)
    eligible_path = output_dir / f"supabase-category-review-{mode}-eligible.jsonl"
    skipped_path = output_dir / f"supabase-category-review-{mode}-skipped.jsonl"
    applied_path = output_dir / f"supabase-category-review-{mode}-applied.jsonl"
    summary_path = output_dir / f"supabase-category-review-{mode}-summary.json"
    write_jsonl(eligible_path, eligible)
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
    summary = sync_to_supabase(args.changes, output_dir, apply=args.apply)
    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
