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
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:  # pragma: no cover - exercised in live smoke, not unit tests
    from supabase import create_client
except Exception as exc:  # pragma: no cover
    create_client = None  # type: ignore[assignment]
    SUPABASE_IMPORT_ERROR = exc
else:  # pragma: no cover
    SUPABASE_IMPORT_ERROR = None

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CORRECTIONS = PROJECT_ROOT / "restaurant-crawling" / "data" / "manual_place_corrections.json"
DEFAULT_REPORT_ROOT = PROJECT_ROOT.parent / ".omx" / "reports" / "refined-data"


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
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not key:
        raise RuntimeError("SUPABASE_URL and a Supabase key are required")
    return create_client(url, key)


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
            .select("id,status,approved_name,origin_name,naver_name,categories,evaluation_results,road_address,jibun_address,updated_by_admin_id,youtube_link")
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
        }
        eligible.append(eligible_row)
        if apply:
            client.table("restaurants").update(payload).eq("id", row["id"]).execute()
            applied.append({k: eligible_row[k] for k in ("youtube_link", "id", "approved_name", "before")})

    write_jsonl(output_dir / "eligible.jsonl", eligible)
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
    print(json.dumps(sync(args.corrections, output_dir, apply=args.apply), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
