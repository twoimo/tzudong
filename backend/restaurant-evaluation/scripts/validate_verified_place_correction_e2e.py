#!/usr/bin/env python3
"""Validate a verified place correction across crawler, evaluation, transform, and DB.

This is a deterministic single-video validation harness for incidents where a
manual on-screen place correction must survive the local pipeline artifacts and
Supabase approved row metadata.
"""

from __future__ import annotations

import argparse
import importlib.util
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
    SUPABASE_REST_CONFIGURATION_ERROR,
    SupabaseRestConfigurationError,
    resolve_privileged_supabase_rest_credentials,
)

try:  # pragma: no cover
    from supabase import create_client
except Exception:  # pragma: no cover
    create_client = None  # type: ignore[assignment]

DEFAULT_REPORT_ROOT = PROJECT_ROOT.parent / ".omx" / "reports" / "refined-data"
DEFAULT_CORRECTIONS = PROJECT_ROOT / "restaurant-crawling" / "data" / "manual_place_corrections.json"


def timestamp_slug() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def load_jsonl_first(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                return json.loads(line)
    raise ValueError(f"empty jsonl: {path}")


def load_transform_row(path: Path, youtube_link: str) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            if row.get("youtube_link") == youtube_link:
                return row
    raise ValueError(f"transform row not found: {youtube_link}")


def load_parse_result_module() -> Any:
    module_path = PROJECT_ROOT / "restaurant-crawling" / "scripts" / "parse_result.py"
    spec = importlib.util.spec_from_file_location("parse_result_validation", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


def get_restaurant(record: dict[str, Any]) -> dict[str, Any]:
    restaurants = record.get("restaurants")
    if not isinstance(restaurants, list) or len(restaurants) != 1:
        raise AssertionError("expected exactly one restaurant")
    restaurant = restaurants[0]
    if not isinstance(restaurant, dict):
        raise AssertionError("restaurant must be object")
    return restaurant


def check_restaurant(stage: str, restaurant: dict[str, Any], expected_name: str, expected_address_fragment: str) -> dict[str, Any]:
    name = restaurant.get("origin_name")
    address = str(restaurant.get("address") or restaurant.get("roadAddress") or restaurant.get("road_address") or "")
    ok = name == expected_name and expected_address_fragment in address
    return {"stage": stage, "ok": ok, "name": name, "address": address}


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


def supabase_check(youtube_link: str, expected_name: str, expected_address_fragment: str) -> dict[str, Any]:
    if create_client is None:
        return {"enabled": False, "ok": False, "reason": "SUPABASE_CLIENT_UNAVAILABLE"}
    load_env()
    try:
        credentials = resolve_privileged_supabase_rest_credentials()
    except SupabaseRestConfigurationError:
        return {"enabled": False, "ok": False, "reason": SUPABASE_REST_CONFIGURATION_ERROR}
    client = create_client(credentials.url, credentials.service_role_key)
    rows = (
        client.table("restaurants")
        .select("id,status,approved_name,origin_name,naver_name,categories,road_address,youtube_link")
        .eq("youtube_link", youtube_link)
        .execute()
        .data
        or []
    )
    active = [row for row in rows if row.get("status") != "deleted"]
    ok = (
        len(active) == 1
        and active[0].get("approved_name") == expected_name
        and active[0].get("origin_name") == expected_name
        and active[0].get("naver_name") == expected_name
        and expected_address_fragment in str(active[0].get("road_address") or "")
        and active[0].get("categories") == ["한식", "분식"]
    )
    return {"enabled": True, "ok": ok, "active_count": len(active), "active": active}


def validate(corrections_path: Path, youtube_link: str, output_dir: Path) -> dict[str, Any]:
    corrections = json.loads(corrections_path.read_text(encoding="utf-8"))
    correction = corrections[youtube_link]
    expected = correction["restaurants"][0]
    expected_name = expected["origin_name"]
    expected_address_fragment = "왕산로37길 50"
    video_id = youtube_link.split("v=", 1)[1].split("&", 1)[0]

    stages: list[dict[str, Any]] = []
    parse_result = load_parse_result_module()
    simulated = parse_result.apply_manual_place_correction(youtube_link, {"restaurants": [{"origin_name": "청량리 할머니 냉면", "address": "서울특별시 동대문구 제기동 457", "category": ["한식"]}]})
    stages.append(check_restaurant("parse_result_manual_correction", get_restaurant(simulated), expected_name, expected_address_fragment))

    stage_paths = {
        "crawling": PROJECT_ROOT / "restaurant-crawling" / "data" / "tzuyang" / "crawling" / f"{video_id}.jsonl",
        "selection": PROJECT_ROOT / "restaurant-evaluation" / "data" / "tzuyang" / "evaluation" / "selection" / f"{video_id}.jsonl",
        "rule_results": PROJECT_ROOT / "restaurant-evaluation" / "data" / "tzuyang" / "evaluation" / "rule_results" / f"{video_id}.jsonl",
        "laaj_results": PROJECT_ROOT / "restaurant-evaluation" / "data" / "tzuyang" / "evaluation" / "laaj_results" / f"{video_id}.jsonl",
    }
    for stage, path in stage_paths.items():
        stages.append(check_restaurant(stage, get_restaurant(load_jsonl_first(path)), expected_name, expected_address_fragment))

    transform = load_transform_row(PROJECT_ROOT / "restaurant-evaluation" / "data" / "tzuyang" / "evaluation" / "transforms.jsonl", youtube_link)
    stages.append({
        "stage": "transforms",
        "ok": transform.get("origin_name") == expected_name
        and expected_address_fragment in str(transform.get("roadAddress") or "")
        and transform.get("geocoding_success") is True
        and (transform.get("evaluation_results") or {}).get("location_match_TF", {}).get("eval_value") is True,
        "name": transform.get("origin_name"),
        "address": transform.get("roadAddress"),
        "geocoding_success": transform.get("geocoding_success"),
    })

    db = supabase_check(youtube_link, expected_name, expected_address_fragment)
    ok = all(stage["ok"] for stage in stages) and (not db.get("enabled") or db.get("ok"))

    summary = {
        "youtube_link": youtube_link,
        "expected_name": expected_name,
        "expected_address_fragment": expected_address_fragment,
        "ok": ok,
        "stages": stages,
        "supabase": db,
        "output_dir": str(output_dir),
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    lines = [
        "# Verified place correction E2E validation",
        "",
        f"- youtube_link: `{youtube_link}`",
        f"- expected: `{expected_name}` / `{expected_address_fragment}`",
        f"- verdict: `{'PASS' if ok else 'FAIL'}`",
        "",
        "## Stages",
    ]
    for stage in stages:
        lines.append(f"- {stage['stage']}: `{'PASS' if stage['ok'] else 'FAIL'}` name=`{stage.get('name')}` address=`{stage.get('address')}`")
    lines.extend(["", "## Supabase", f"- enabled: `{db.get('enabled')}`", f"- ok: `{db.get('ok')}`"])
    (output_dir / "README.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    if not ok:
        raise SystemExit(json.dumps(summary, ensure_ascii=False, indent=2, default=str))
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate verified place correction across local artifacts and Supabase")
    parser.add_argument("--corrections", type=Path, default=DEFAULT_CORRECTIONS)
    parser.add_argument("--youtube-link", default="https://www.youtube.com/watch?v=GQyNACahbyM")
    parser.add_argument("--output-dir", type=Path)
    args = parser.parse_args()
    output_dir = args.output_dir or DEFAULT_REPORT_ROOT / f"verified-place-correction-e2e-{timestamp_slug()}"
    print(json.dumps(validate(args.corrections, args.youtube_link, output_dir), ensure_ascii=False, indent=2, default=str))


if __name__ == "__main__":
    main()
