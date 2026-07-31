#!/usr/bin/env python3
"""Guarded Supabase sync for manually verified place corrections.

This script is intentionally narrow: it updates only already-approved active rows
whose approved_name matches a manual correction for the same YouTube link. It is
used to remove stale origin/naver/category/evaluation metadata after an operator
has verified the canonical place.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from utils.supabase_rest import (
    SupabaseRestConfigurationError,
    resolve_privileged_supabase_rest_credentials,
)

try:  # pragma: no cover - exercised in live smoke, not unit tests
    from supabase import create_client
except Exception as exc:  # pragma: no cover
    create_client = None  # type: ignore[assignment]
    SUPABASE_IMPORT_ERROR = exc
else:  # pragma: no cover
    SUPABASE_IMPORT_ERROR = None

DEFAULT_CORRECTIONS = PROJECT_ROOT / "restaurant-crawling" / "data" / "manual_place_corrections.json"
DEFAULT_REPORT_ROOT = PROJECT_ROOT.parent / ".omx" / "reports" / "refined-data"
COMPARE_AND_SET_CONFLICT = "compare_and_set_conflict"
VERIFIED_REVIEW_FIELDS = (
    "id",
    "status",
    "updated_by_admin_id",
    "updated_at",
    "youtube_link",
    "approved_name",
    "origin_name",
    "naver_name",
    "categories",
    "evaluation_results",
    "jibun_address",
    "db_error_message",
    "db_error_details",
)
VERIFIED_READBACK_FIELDS = ",".join(VERIFIED_REVIEW_FIELDS)


def timestamp_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def load_env() -> None:
    for path in (PROJECT_ROOT / ".env", PROJECT_ROOT.parent / ".env"):
        if not path.exists():
            continue
        for raw in path.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def get_client() -> Any:
    if create_client is None:  # pragma: no cover
        raise RuntimeError(f"supabase package unavailable: {SUPABASE_IMPORT_ERROR}")
    load_env()
    credentials = resolve_privileged_supabase_rest_credentials()
    return create_client(credentials.url, credentials.service_role_key)


def flatten_categories(value: Any) -> list[str]:
    output: list[str] = []

    def visit(item: Any) -> None:
        if isinstance(item, list):
            for child in item:
                visit(child)
            return
        text = str(item or "").strip()
        if text and text not in output:
            output.append(text)

    visit(value)
    return output


def first_restaurant(correction: dict[str, Any]) -> dict[str, Any] | None:
    restaurants = correction.get("restaurants")
    if not isinstance(restaurants, list) or not restaurants:
        return None
    restaurant = restaurants[0]
    return restaurant if isinstance(restaurant, dict) else None


def build_evaluation_results(existing: dict[str, Any], restaurant: dict[str, Any]) -> dict[str, Any]:
    existing_eval = existing.get("evaluation_results")
    evaluation_results = dict(existing_eval) if isinstance(existing_eval, dict) else {}
    name = str(restaurant.get("origin_name") or "").strip()
    address = str(restaurant.get("address") or "").strip()
    categories = flatten_categories(restaurant.get("category"))
    lat = restaurant.get("lat")
    lng = restaurant.get("lng")

    if name and address:
        evaluation_results["location_match_TF"] = {
            "origin_name": name,
            "naver_name": name,
            "eval_value": True,
            "origin_address": address,
            "naver_address": address,
            "match_status": "matched",
            "matched_provider": "naver",
            "matched_name": name,
            "matched_address": {
                "roadAddress": address,
                "jibunAddress": existing.get("jibun_address"),
                "x": str(lng) if lng is not None else None,
                "y": str(lat) if lat is not None else None,
            },
            "evidence_summary": ["manual_verified_place_correction", "naver_place_11867713"],
            "evidence_families": ["browser_verification", "provider_candidate"],
        }
    if categories:
        evaluation_results["category_validity_TF"] = {
            "name": name,
            "eval_value": True,
            "normalized_categories": categories,
            "projection_source": "manual_place_correction_supabase_sync",
        }
    return evaluation_results


def build_payload(existing: dict[str, Any], correction: dict[str, Any]) -> dict[str, Any] | None:
    restaurant = first_restaurant(correction)
    if not restaurant:
        return None
    name = str(restaurant.get("origin_name") or "").strip()
    if not name or existing.get("approved_name") != name:
        return None
    categories = flatten_categories(restaurant.get("category"))
    now = datetime.now(timezone.utc).isoformat()
    payload: dict[str, Any] = {
        "origin_name": name,
        "naver_name": name,
        "categories": categories,
        "evaluation_results": build_evaluation_results(existing, restaurant),
        "updated_at": now,
        "db_error_message": None,
        "db_error_details": None,
    }
    return payload


def load_corrections(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.write_text("".join(json.dumps(row, ensure_ascii=False, default=str) + "\n" for row in rows), encoding="utf-8")


def reviewed_fields(row: dict[str, Any]) -> dict[str, Any]:
    return {field: row.get(field) for field in VERIFIED_REVIEW_FIELDS}


def is_review_locked(row: dict[str, Any]) -> bool:
    return row.get("status") != "approved" or bool(row.get("updated_by_admin_id"))


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


def bind_verified_compare_and_set(query: Any, reviewed: dict[str, Any]) -> Any:
    for field in ("id", "status", "updated_by_admin_id", "updated_at", "youtube_link", "approved_name", "origin_name", "naver_name", "jibun_address", "db_error_message"):
        query = bind_exact_value(query, field, reviewed[field])
    query = bind_exact_value(query, "categories", reviewed["categories"], text_array=True)
    query = bind_exact_value(query, "evaluation_results", reviewed["evaluation_results"], jsonb=True)
    return bind_exact_value(query, "db_error_details", reviewed["db_error_details"], jsonb=True)


def verified_row_matches_reviewed(row: dict[str, Any], reviewed: dict[str, Any]) -> bool:
    return all(row.get(field) == reviewed[field] for field in VERIFIED_REVIEW_FIELDS)


def verified_readback_matches_payload(row: dict[str, Any], reviewed: dict[str, Any], payload: dict[str, Any]) -> bool:
    protected_fields = ("id", "status", "updated_by_admin_id", "youtube_link", "approved_name", "jibun_address")
    return (
        all(row.get(field) == reviewed[field] for field in protected_fields)
        and all(row.get(field) == payload[field] for field in payload)
    )


def conflict_record(row: dict[str, Any], stage: str) -> dict[str, Any]:
    return {
        "youtube_link": row.get("youtube_link"),
        "id": row.get("id"),
        "approved_name": row.get("approved_name"),
        "skip_reason": COMPARE_AND_SET_CONFLICT,
        "conflict_stage": stage,
    }


def apply_verified_compare_and_set(client: Any, row: dict[str, Any]) -> tuple[bool, dict[str, Any] | None]:
    reviewed = row["reviewed"]
    recheck = (
        client.table("restaurants")
        .select(VERIFIED_READBACK_FIELDS)
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
    if not verified_row_matches_reviewed(current, reviewed):
        return False, conflict_record(row, "reviewed_values_changed")

    affected = bind_verified_compare_and_set(
        client.table("restaurants").update(row["payload"]),
        reviewed,
    ).execute().data or []
    if len(affected) != 1:
        return False, conflict_record(row, "affected_row_count_not_one")

    readback = (
        client.table("restaurants")
        .select(VERIFIED_READBACK_FIELDS)
        .eq("id", reviewed["id"])
        .execute()
        .data
        or []
    )
    if len(readback) != 1 or not verified_readback_matches_payload(readback[0], reviewed, row["payload"]):
        return False, conflict_record(row, "readback_not_exactly_one_or_mismatched")
    return True, None


def public_eligible_row(row: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in row.items() if key != "reviewed"}


def sync(corrections_path: Path, output_dir: Path, *, apply: bool) -> dict[str, Any]:
    client = get_client()
    corrections = load_corrections(corrections_path)
    output_dir.mkdir(parents=True, exist_ok=True)

    eligible: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    applied: list[dict[str, Any]] = []

    for youtube_link, correction in corrections.items():
        restaurant = first_restaurant(correction if isinstance(correction, dict) else {})
        expected_name = str((restaurant or {}).get("origin_name") or "").strip()
        if not expected_name:
            skipped.append({"youtube_link": youtube_link, "skip_reason": "missing_correction_restaurant_name"})
            continue

        rows = (
            client.table("restaurants")
            .select("id,status,approved_name,origin_name,naver_name,categories,evaluation_results,road_address,jibun_address,updated_by_admin_id,updated_at,db_error_message,db_error_details,youtube_link")
            .eq("youtube_link", youtube_link)
            .neq("status", "deleted")
            .execute()
            .data
            or []
        )
        matches = [row for row in rows if row.get("status") == "approved" and row.get("approved_name") == expected_name]
        if len(matches) != 1:
            skipped.append({"youtube_link": youtube_link, "expected_name": expected_name, "skip_reason": "approved_match_count_not_one", "match_count": len(matches)})
            continue

        row = matches[0]
        if is_review_locked(row):
            skipped.append({"youtube_link": youtube_link, "expected_name": expected_name, "skip_reason": "review_locked", "id": row.get("id")})
            continue
        payload = build_payload(row, correction)
        if payload is None:
            skipped.append({"youtube_link": youtube_link, "expected_name": expected_name, "skip_reason": "payload_guard_failed", "id": row.get("id")})
            continue

        eligible_row = {
            "youtube_link": youtube_link,
            "id": row.get("id"),
            "approved_name": row.get("approved_name"),
            "before": {
                "origin_name": row.get("origin_name"),
                "naver_name": row.get("naver_name"),
                "categories": row.get("categories"),
            },
            "payload": payload,
            "reviewed": reviewed_fields(row),
        }
        eligible.append(eligible_row)
        if apply:
            applied_exactly_once, conflict = apply_verified_compare_and_set(client, eligible_row)
            if not applied_exactly_once:
                assert conflict is not None
                skipped.append(conflict)
                continue
            applied.append({k: eligible_row[k] for k in ("youtube_link", "id", "approved_name", "before")})

    write_jsonl(output_dir / "eligible.jsonl", [public_eligible_row(row) for row in eligible])
    write_jsonl(output_dir / "skipped.jsonl", skipped)
    write_jsonl(output_dir / "applied.jsonl", applied)
    summary = {
        "mode": "apply" if apply else "dry_run",
        "corrections_path": str(corrections_path),
        "eligible": len(eligible),
        "skipped": len(skipped),
        "applied": len(applied),
        "output_dir": str(output_dir),
    }
    (output_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Guarded sync for verified place corrections into Supabase approved rows")
    parser.add_argument("--corrections", type=Path, default=DEFAULT_CORRECTIONS)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    output_dir = args.output_dir or DEFAULT_REPORT_ROOT / f"verified-place-correction-supabase-sync-{timestamp_slug()}"
    try:
        summary = sync(args.corrections, output_dir, apply=args.apply)
    except SupabaseRestConfigurationError:
        print("[ERROR] Supabase REST configuration invalid.")
        sys.exit(1)
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
