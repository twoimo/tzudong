#!/usr/bin/env python3
"""
Supabase 데이터 삽입 스크립트
transforms.jsonl 데이터를 Supabase에 삽입합니다.

- trace_id 기반 exact upsert
- reviewed/admin lock 필드 보존
- reviewed row의 bounded trace_id rebind
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

try:
    from dotenv import load_dotenv
except Exception:
    load_dotenv = None

# shared utils import (backend/utils)
BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from utils.runtime_paths import load_backend_env, resolve_backend_root

SUPABASE_IMPORT_ERROR = None
try:
    from supabase import Client, create_client
except ImportError as exc:
    SUPABASE_IMPORT_ERROR = exc
    Client = Any
    create_client = None

# 한국 시간대
KST = timezone(timedelta(hours=9))

ROW_OWNED_FIELDS = (
    "created_at",
    "review_count",
)

REVIEW_OWNED_FIELDS = (
    "status",
    "approved_name",
    "phone",
    "categories",
    "tzuyang_review",
    "road_address",
    "jibun_address",
    "english_address",
    "address_elements",
    "lat",
    "lng",
    "geocoding_success",
    "geocoding_false_stage",
    "updated_by_admin_id",
)

PIPELINE_REFRESH_FIELDS = (
    "youtube_meta",
    "evaluation_results",
    "origin_name",
    "naver_name",
    "google_name",
    "trace_id_name_source",
    "reasoning_basis",
    "origin_address",
    "source_type",
    "description_map_url",
    "recollect_version",
    "is_missing",
    "is_not_selected",
    "channel_name",
    "youtube_link",
)

LEGACY_REVIEW_LOCK_STATUSES = {"approved", "deleted"}
OPTIONAL_SCHEMA_COMPAT_FIELDS = {"google_name"}
MISSING_SCHEMA_COLUMN_RE = re.compile(r"Could not find the '([^']+)' column of '([^']+)' in the schema cache")
MAX_RETRIES = 2
RETRY_DELAY = 2


def unique_non_empty(values: Iterable[Any]) -> list[Any]:
    seen: set[Any] = set()
    ordered: list[Any] = []
    for value in values:
        if value in (None, "") or value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered


def has_admin_lock_marker(row: dict[str, Any]) -> bool:
    marker = row.get("updated_by_admin_id")
    return marker not in (None, "")


def is_legacy_review_locked(row: dict[str, Any]) -> bool:
    return (not has_admin_lock_marker(row)) and row.get("status") in LEGACY_REVIEW_LOCK_STATUSES


def is_review_locked(row: dict[str, Any]) -> bool:
    return has_admin_lock_marker(row) or is_legacy_review_locked(row)


def preserve_row_owned_fields(existing: dict[str, Any], merged: dict[str, Any]) -> dict[str, Any]:
    for field in ROW_OWNED_FIELDS:
        if field in existing:
            merged[field] = existing.get(field)
    return merged


def preserve_review_owned_fields(existing: dict[str, Any], merged: dict[str, Any]) -> dict[str, Any]:
    for field in REVIEW_OWNED_FIELDS:
        if field in existing or field in merged:
            merged[field] = existing.get(field)
    return merged


def merge_refreshable_pipeline_fields(
    existing: dict[str, Any], incoming: dict[str, Any], merged: dict[str, Any]
) -> dict[str, Any]:
    for field in PIPELINE_REFRESH_FIELDS:
        if field in incoming:
            merged[field] = incoming.get(field)
        elif field in existing:
            merged[field] = existing.get(field)
    return merged


def merge_restaurant_record(
    existing: dict[str, Any], incoming: dict[str, Any], *, rebind_trace_id: bool = False
) -> dict[str, Any]:
    merged = dict(incoming)
    merge_refreshable_pipeline_fields(existing, incoming, merged)
    preserve_row_owned_fields(existing, merged)

    if is_review_locked(existing):
        preserve_review_owned_fields(existing, merged)

    if rebind_trace_id or "trace_id" not in merged:
        merged["trace_id"] = incoming.get("trace_id")

    return merged


def build_review_rebind_candidate_map(existing_rows: list[dict[str, Any]]) -> dict[tuple[str, str], list[dict[str, Any]]]:
    candidate_map: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for row in existing_rows:
        if not is_review_locked(row):
            continue

        youtube_link = row.get("youtube_link")
        origin_name = row.get("origin_name")
        if not youtube_link or not origin_name:
            continue

        candidate_map.setdefault((youtube_link, origin_name), []).append(row)

    return candidate_map


def note_review_lock(existing: dict[str, Any], stats: dict[str, int], *, exact_match: bool) -> None:
    if not is_review_locked(existing):
        return
    if exact_match:
        stats["exact_review_locks"] += 1
    if is_legacy_review_locked(existing):
        stats["legacy_review_locks"] += 1


def classify_batch_operations(
    batch_data: list[dict[str, Any]],
    existing_map: dict[str, dict[str, Any]],
    review_candidate_map: dict[tuple[str, str], list[dict[str, Any]]],
    stats: dict[str, int],
) -> tuple[list[dict[str, Any]], list[tuple[str, dict[str, Any]]]]:
    upsert_rows: list[dict[str, Any]] = []
    rebind_updates: list[tuple[str, dict[str, Any]]] = []

    for item in batch_data:
        trace_id = item.get("trace_id")
        existing = existing_map.get(trace_id) if trace_id else None
        if existing:
            upsert_rows.append(merge_restaurant_record(existing, item))
            note_review_lock(existing, stats, exact_match=True)
            continue

        youtube_link = item.get("youtube_link")
        origin_name = item.get("origin_name")
        candidates = review_candidate_map.get((youtube_link, origin_name), []) if youtube_link and origin_name else []

        if len(candidates) == 1 and candidates[0].get("id"):
            reviewed_row = candidates[0]
            rebind_updates.append((reviewed_row["id"], merge_restaurant_record(reviewed_row, item, rebind_trace_id=True)))
            stats["trace_rebinds"] += 1
            note_review_lock(reviewed_row, stats, exact_match=False)
            continue

        if len(candidates) > 1:
            stats["ambiguous_rebind_skips"] += 1
            print(
                "[WARN] reviewed row rebind skipped: "
                f"trace_id={trace_id} youtube_link={youtube_link} origin_name={origin_name} candidates={len(candidates)}"
            )

        upsert_rows.append(item)

    return upsert_rows, rebind_updates


def fetch_existing_rows_by_trace_id(supabase: Client, trace_ids: list[str]) -> dict[str, dict[str, Any]]:
    if not trace_ids:
        return {}

    response = supabase.table("restaurants").select("*").in_("trace_id", trace_ids).execute()
    if not response.data:
        return {}

    return {row["trace_id"]: row for row in response.data if row.get("trace_id")}


def fetch_review_rebind_candidates(supabase: Client, youtube_links: list[str]) -> dict[tuple[str, str], list[dict[str, Any]]]:
    if not youtube_links:
        return {}

    response = supabase.table("restaurants").select("*").in_("youtube_link", youtube_links).execute()
    if not response.data:
        return {}

    return build_review_rebind_candidate_map(response.data)


def extract_missing_schema_column(exc: Exception, table_name: str = "restaurants") -> str | None:
    match = MISSING_SCHEMA_COLUMN_RE.search(str(exc))
    if not match:
        return None

    column_name, missing_table = match.groups()
    if missing_table != table_name:
        return None

    return column_name


def drop_optional_schema_field_from_rows(
    rows: list[dict[str, Any]],
    field_name: str,
) -> tuple[list[dict[str, Any]], bool]:
    stripped = False
    sanitized_rows: list[dict[str, Any]] = []

    for row in rows:
        if field_name in row:
            sanitized_rows.append({key: value for key, value in row.items() if key != field_name})
            stripped = True
        else:
            sanitized_rows.append(dict(row))

    return sanitized_rows, stripped


def handle_optional_schema_mismatch_for_rows(
    exc: Exception,
    rows: list[dict[str, Any]],
    omitted_columns: set[str],
) -> tuple[list[dict[str, Any]], bool]:
    missing_column = extract_missing_schema_column(exc)
    if not missing_column or missing_column not in OPTIONAL_SCHEMA_COMPAT_FIELDS:
        return rows, False
    if missing_column in omitted_columns:
        return rows, False

    sanitized_rows, stripped = drop_optional_schema_field_from_rows(rows, missing_column)
    if not stripped:
        return rows, False

    omitted_columns.add(missing_column)
    print(
        f"[WARN] restaurants 스키마에 optional 컬럼 '{missing_column}' 이 없어 해당 필드를 제외하고 재시도합니다."
    )
    return sanitized_rows, True


def execute_upsert_rows(
    supabase: Client,
    rows: list[dict[str, Any]],
    dry_run: bool,
    stats: dict[str, int],
) -> None:
    if not rows:
        return

    if dry_run:
        stats["inserted"] += len(rows)
        return

    upsert_rows = [dict(row) for row in rows]
    omitted_columns: set[str] = set()
    attempt = 1

    while attempt <= MAX_RETRIES + 1:
        try:
            supabase.table("restaurants").upsert(upsert_rows, on_conflict="trace_id").execute()
            stats["inserted"] += len(upsert_rows)
            return
        except Exception as exc:
            upsert_rows, handled = handle_optional_schema_mismatch_for_rows(exc, upsert_rows, omitted_columns)
            if handled:
                continue

            if attempt <= MAX_RETRIES:
                print(f"[WARN] 배치 Upsert 실패 (시도 {attempt}/{MAX_RETRIES + 1}): {exc}")
                time.sleep(RETRY_DELAY)
                attempt += 1
            else:
                print(f"[ERROR] 배치 Upsert 최종 실패 ({MAX_RETRIES + 1}회 시도 후): {exc}")
                stats["errors"] += len(upsert_rows)
                return


def execute_rebind_updates(
    supabase: Client,
    updates: list[tuple[str, dict[str, Any]]],
    dry_run: bool,
    stats: dict[str, int],
) -> None:
    if not updates:
        return

    if dry_run:
        stats["inserted"] += len(updates)
        return

    for row_id, payload in updates:
        update_payload = dict(payload)
        omitted_columns: set[str] = set()
        attempt = 1

        while attempt <= MAX_RETRIES + 1:
            try:
                supabase.table("restaurants").update(update_payload).eq("id", row_id).execute()
                stats["inserted"] += 1
                break
            except Exception as exc:
                sanitized_rows, handled = handle_optional_schema_mismatch_for_rows(
                    exc,
                    [update_payload],
                    omitted_columns,
                )
                if handled:
                    update_payload = sanitized_rows[0]
                    continue

                if attempt <= MAX_RETRIES:
                    print(
                        f"[WARN] trace_id rebind 실패 (id={row_id}, 시도 {attempt}/{MAX_RETRIES + 1}): {exc}"
                    )
                    time.sleep(RETRY_DELAY)
                    attempt += 1
                else:
                    print(f"[ERROR] trace_id rebind 최종 실패 (id={row_id}): {exc}")
                    stats["errors"] += 1
                    break


def process_and_upsert(
    supabase: Client,
    batch_data: list[dict[str, Any]],
    dry_run: bool,
    stats: dict[str, int],
) -> None:
    if not batch_data:
        return

    trace_ids = unique_non_empty(item.get("trace_id") for item in batch_data)
    youtube_links = unique_non_empty(item.get("youtube_link") for item in batch_data)

    existing_map: dict[str, dict[str, Any]] = {}
    if trace_ids:
        try:
            existing_map = fetch_existing_rows_by_trace_id(supabase, trace_ids)
        except Exception as exc:
            print(f"[WARN] 기존 trace_id 데이터 조회 실패 (Batch): {exc}")

    review_candidate_map: dict[tuple[str, str], list[dict[str, Any]]] = {}
    if youtube_links:
        try:
            review_candidate_map = fetch_review_rebind_candidates(supabase, youtube_links)
        except Exception as exc:
            print(f"[WARN] reviewed row 후보 조회 실패 (Batch): {exc}")

    upsert_rows, rebind_updates = classify_batch_operations(
        batch_data,
        existing_map,
        review_candidate_map,
        stats,
    )

    execute_rebind_updates(supabase, rebind_updates, dry_run, stats)
    execute_upsert_rows(supabase, upsert_rows, dry_run, stats)

    if upsert_rows or rebind_updates:
        print(
            f"   {stats['inserted']}개 처리 완료 "
            f"(Upsert {len(upsert_rows)} / Rebind {len(rebind_updates)})..."
        )


def build_record(data: dict[str, Any], channel: str) -> dict[str, Any]:
    categories = data.get("categories")
    if categories is None:
        category = data.get("category")
        categories = [category] if category else []
    elif not isinstance(categories, list):
        categories = [categories]

    youtube_meta = data.get("youtube_meta")
    record_created_at = datetime.now(KST).isoformat()
    if youtube_meta and youtube_meta.get("publishedAt"):
        record_created_at = youtube_meta.get("publishedAt")

    return {
        "trace_id": data.get("trace_id"),
        "youtube_link": data.get("youtube_link"),
        "channel_name": data.get("channel_name") or channel,
        "status": data.get("status", "pending"),
        "origin_name": data.get("origin_name"),
        "naver_name": data.get("naver_name"),
        "google_name": data.get("google_name"),
        "trace_id_name_source": data.get("trace_id_name_source"),
        "categories": categories,
        "reasoning_basis": data.get("reasoning_basis"),
        "tzuyang_review": data.get("youtuber_review"),  # youtuber_review -> tzuyang_review 매핑
        "origin_address": data.get("origin_address"),
        "road_address": data.get("roadAddress"),
        "jibun_address": data.get("jibunAddress"),
        "english_address": data.get("englishAddress"),
        "address_elements": data.get("addressElements") or {},
        "lat": data.get("lat"),
        "lng": data.get("lng"),
        "geocoding_success": data.get("geocoding_success", False),
        "geocoding_false_stage": data.get("geocoding_false_stage"),
        "is_missing": data.get("is_missing", False),
        "is_not_selected": data.get("is_notSelected", False),
        "evaluation_results": data.get("evaluation_results"),
        "youtube_meta": youtube_meta,
        "source_type": data.get("source_type"),
        "description_map_url": data.get("description_map_url"),
        "recollect_version": data.get("recollect_version"),
        "review_count": 0,
        "created_at": record_created_at,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Supabase 데이터 삽입 (Transform 결과 기반)")
    parser.add_argument("--channel", "-c", required=True, help="채널 이름 (예: tzuyang)")
    parser.add_argument("--evaluation-path", required=True, help="평가 데이터 결과 경로")
    parser.add_argument(
        "--dry-run", action="store_true", help="실제 DB 반영 없이 삽입 대상만 확인"
    )
    args = parser.parse_args()

    channel = args.channel
    evaluation_path = Path(args.evaluation_path)
    dry_run = args.dry_run

    # .env 로드
    # 1) legacy: backend/restaurant-evaluation/.env
    legacy_env = Path(__file__).parent.parent / ".env"
    if legacy_env.exists() and load_dotenv is not None:
        load_dotenv(legacy_env)

    # 2) 표준: backend/.env (없으면 .env.local fallback)
    backend_root = resolve_backend_root(Path(__file__).resolve())
    loaded_env = load_backend_env(backend_root, prefer_local=False)
    if loaded_env is not None:
        print(f"[{datetime.now(KST).strftime('%H:%M:%S')}] [OK] .env 로드: {loaded_env}")

    if create_client is None:
        print("[ERROR] supabase 패키지가 설치되지 않았습니다.")
        print("   pip install supabase 실행")
        if SUPABASE_IMPORT_ERROR is not None:
            print(f"   상세: {SUPABASE_IMPORT_ERROR}")
        sys.exit(1)

    # Supabase 설정
    supabase_url = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv(
        "VITE_SUPABASE_PUBLISHABLE_KEY"
    )

    if not supabase_url or not supabase_key:
        print("[ERROR] SUPABASE_URL 또는 SUPABASE_KEY 환경변수가 설정되지 않았습니다.")
        sys.exit(1)

    print(f"[{datetime.now(KST).strftime('%H:%M:%S')}] [OK] Supabase 설정 완료")
    print(f"   URL: {supabase_url}")

    # Supabase 클라이언트 생성
    supabase: Client = create_client(supabase_url, supabase_key)

    # 입력 파일
    input_file = evaluation_path / "evaluation" / "transforms.jsonl"

    if not input_file.exists():
        print(f"[WARN] transforms 파일 없음: {input_file} (데이터 없음으로 간주)")
        print(f"\n{'=' * 50}")
        print("[OK] Supabase 삽입 완료! (SKIP)")
        print("   총 레코드: 0개")
        print(f"{'=' * 50}")
        return

    print(f"[{datetime.now(KST).strftime('%H:%M:%S')}] 입력 파일: {input_file}")
    print(f"[{datetime.now(KST).strftime('%H:%M:%S')}] 데이터 처리 시작 (review lock 병합 정책 적용)...")

    stats = {
        "total_records": 0,
        "inserted": 0,
        "skipped": 0,
        "errors": 0,
        "exact_review_locks": 0,
        "legacy_review_locks": 0,
        "trace_rebinds": 0,
        "ambiguous_rebind_skips": 0,
    }

    batch_size = 200
    batch: list[dict[str, Any]] = []

    with open(input_file, "r", encoding="utf-8") as f:
        for line in f:
            stats["total_records"] += 1

            try:
                data = json.loads(line.strip())
                batch.append(build_record(data, channel))

                if len(batch) >= batch_size:
                    process_and_upsert(supabase, batch, dry_run, stats)
                    batch = []

            except json.JSONDecodeError:
                stats["errors"] += 1

    if batch:
        process_and_upsert(supabase, batch, dry_run, stats)

    print(f"\n{'=' * 50}")
    if stats["errors"] > 0:
        print("[ERROR] Supabase 삽입 완료 (일부 실패)")
    else:
        print("[OK] Supabase 삽입 완료!")
    print(f"   총 레코드: {stats['total_records']}개")
    print(f"   성공 (Insert): {stats['inserted']}개")
    print(f"   건너뜀 (중복): {stats['skipped']}개")
    print(f"   exact_review_locks: {stats['exact_review_locks']}")
    print(f"   legacy_review_locks: {stats['legacy_review_locks']}")
    print(f"   trace_rebinds: {stats['trace_rebinds']}")
    print(f"   ambiguous_rebind_skips: {stats['ambiguous_rebind_skips']}")
    print(f"   배치 크기: {batch_size}")
    if stats["errors"] > 0:
        print(f"   오류: {stats['errors']}개")
    if dry_run:
        print("   [DRY RUN 모드 - 실제 삽입 안됨]")
    print(f"{'=' * 50}")

    if stats["errors"] > 0:
        print("[ERROR] 일부 레코드를 Supabase에 반영하지 못했습니다.")
        sys.exit(1)


if __name__ == "__main__":
    main()
