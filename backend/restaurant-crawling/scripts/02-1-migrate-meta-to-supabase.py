#!/usr/bin/env python3
"""
02-1-migrate-meta-to-supabase.py

tzuyang 메타 데이터를 Supabase로 마이그레이션.
/data/tzuyang/meta 폴더의 JSONL 파일만 처리합니다.

사용법:
    python3 02-1-migrate-meta-to-supabase.py --channel tzuyang
    python3 02-1-migrate-meta-to-supabase.py --dry-run
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List

# shared utils import (backend/utils)
BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from utils.privacy_log import safe_error_name
from utils.runtime_paths import load_backend_env, resolve_backend_root
from utils.supabase_rest import (
    HostedRestRejected,
    SupabaseRestConfigurationError,
    hosted_rest_exit_code,
    live_insert_quota,
    resolve_privileged_supabase_rest_credentials,
)

# 경로 설정
SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR.parent / "data"

# .env 로드 (backend/.env 우선)
backend_root = resolve_backend_root(Path(__file__).resolve())
loaded_env = load_backend_env(backend_root, prefer_local=False)
if loaded_env is not None:
    print("[INFO] .env 로드 완료")

Client = Any
create_client = None
SUPABASE_IMPORT_ERROR = None


def _load_supabase_runtime() -> None:
    """Import the network-capable SDK only after configuration admission."""

    global Client, create_client, SUPABASE_IMPORT_ERROR
    if create_client is not None:
        return
    try:
        from supabase import Client as SupabaseClient, create_client as supabase_create_client
    except ImportError as error:
        SUPABASE_IMPORT_ERROR = error
        raise
    Client = SupabaseClient
    create_client = supabase_create_client

def get_supabase_client() -> Client:
    """Create a client only from validated privileged REST credentials."""
    credentials = resolve_privileged_supabase_rest_credentials()
    try:
        _load_supabase_runtime()
    except ImportError as error:
        raise RuntimeError("supabase_dependency_missing") from error
    if create_client is None:
        raise RuntimeError("supabase_dependency_missing")
    return create_client(credentials.url, credentials.service_role_key)

def parse_timestamp(ts_str: Optional[str]) -> Optional[str]:
    """타임스탬프 파싱 및 ISO 포맷 반환"""
    if not ts_str:
        return None
    try:
        # 이미 ISO 형식이면 그대로 사용하되 Z만 치환
        if "+" in ts_str or ts_str.endswith("Z"):
            return ts_str.replace("Z", "+00:00")
        return datetime.fromisoformat(ts_str).isoformat()
    except Exception:
        return None

def migrate_meta(supabase: Optional[Client], channel: str, dry_run: bool = False):
    """메타 데이터 마이그레이션 (Upsert)"""
    meta_dir = DATA_DIR / channel / "meta"
    if not meta_dir.exists():
        print(f"[ERROR] 메타 디렉토리 없음: {meta_dir}")
        return 0
    
    print(f"메타 데이터 로드: {meta_dir}")
    
    jsonl_files = list(meta_dir.glob("*.jsonl"))
    total = len(jsonl_files)
    
    batch_size = 50
    batch_data = []
    total_processed = 0
    total_upserted = 0
    quota = live_insert_quota()
    flush_at = 1 if quota is not None else batch_size
    
    for idx, jsonl_file in enumerate(jsonl_files, 1):
        if quota is not None and total_upserted >= quota:
            print(f"[INFO] live_bounded: reached LIVE_MAX_NEW_ITEMS={quota}; remaining videos skipped")
            break
        if idx % 50 == 0:
            print(f"  처리 중: {idx}/{total}")
        
        video_id = jsonl_file.stem
        
        with open(jsonl_file, "r", encoding="utf-8") as f:
            lines = [line.strip() for line in f if line.strip()]
        
        if not lines:
            continue
        
        # meta_history 수집
        meta_history = []
        latest_record = None
        
        for line in lines:
            try:
                record = json.loads(line)
                latest_record = record
                
                stats = record.get("stats", {})
                collected_at = record.get("collected_at")
                
                if collected_at and stats.get("view_count") is not None:
                    history_entry = {
                        "collected_at": collected_at,
                        "view_count": stats.get("view_count"),
                        "like_count": stats.get("like_count"),
                        "comment_count": stats.get("comment_count"),
                        "recollect_id": record.get("recollect_id", 0),
                        "title": record.get("title"),
                        "duration": record.get("duration"),
                        "thumbnail_url": record.get("thumbnail_url")
                    }
                    meta_history.append(history_entry)
            except json.JSONDecodeError:
                continue
        
        if not latest_record:
            continue
        
        ads_info = latest_record.get("ads_info", {})
        latest_stats = latest_record.get("stats", {})
        
        # 데이터 구성 (Supabase 테이블 컬럼명과 일치해야 함)
        row_data = {
            "id": video_id,
            "published_at": parse_timestamp(latest_record.get("published_at")),
            "duration": latest_record.get("duration"),
            "view_count": latest_stats.get("view_count"),
            "like_count": latest_stats.get("like_count"),
            "comment_count": latest_stats.get("comment_count"),
            "latest_recollect_id": latest_record.get("recollect_id", 0),
            "is_shorts": latest_record.get("is_shorts", False),
            "is_ads": ads_info.get("is_ads", False),
            "youtube_link": latest_record.get("youtube_link", f"https://www.youtube.com/watch?v={video_id}"),
            "channel_name": latest_record.get("channel_name", channel),
            "title": latest_record.get("title"),
            "description": latest_record.get("description"),
            "category": latest_record.get("category"),
            "thumbnail_url": latest_record.get("thumbnail_url"),
            "thumbnail_hash": latest_record.get("thumbnail_hash"),
            "advertisers": ads_info.get("what_ads") or [],
            "tags": latest_record.get("tags", []),
            "recollect_vars": latest_record.get("recollect_vars", []),
            "meta_history": meta_history,
            "updated_at": datetime.now().isoformat()
        }
        
        batch_data.append(row_data)
        
        if len(batch_data) >= flush_at:
            if not dry_run:
                try:
                    supabase.table("videos").upsert(batch_data).execute()
                    total_upserted += len(batch_data)
                except Exception as error:
                    print(f"[ERROR] 배치 업서트 실패 ({len(batch_data)}개): {safe_error_name(error)}")
                    raise
            batch_data = []
            
    # 남은 데이터 처리
    if batch_data:
        if not dry_run:
            try:
                supabase.table("videos").upsert(batch_data).execute()
                total_upserted += len(batch_data)
            except Exception as error:
                print(f"[ERROR] 마지막 배치 업서트 실패: {safe_error_name(error)}")
                raise
                
    print(f"[OK] 총 {total_upserted}개 비디오 메타데이터 마이그레이션 완료")

def verify_data(supabase: Client, channel: str):
    """데이터 검증"""
    print("\n[SCAN] 데이터 검증...")
    try:
        # count() 메서드 사용시 head=True
        res = supabase.table("videos").select("id", count="exact", head=True).eq("channel_name", channel).execute()
        count = res.count
        print(f"  videos 테이블: {count}개")
        
        res_ads = supabase.table("videos").select("id", count="exact", head=True).eq("channel_name", channel).eq("is_ads", True).execute()
        print(f"  광고 포함 비디오: {res_ads.count}개")
        
    except Exception as error:
        print(f"[WARN] 검증 쿼리 실패: {safe_error_name(error)}")

def main():
    parser = argparse.ArgumentParser(description="Supabase 메타 데이터 마이그레이션")
    parser.add_argument("--channel", type=str, default="tzuyang")
    parser.add_argument("--dry-run", action="store_true")
    
    args = parser.parse_args()
    
    print("=" * 50)
    print("Supabase 메타 데이터 마이그레이션 (API)")
    print("=" * 50)
    
    if args.dry_run:
        migrate_meta(None, args.channel, dry_run=True)
        print("\n완료!")
        return

    try:
        supabase = get_supabase_client()
        print("[OK] Client 연결 성공\n")

        migrate_meta(supabase, args.channel, dry_run=False)
        verify_data(supabase, args.channel)

        print("\n완료!")

    except HostedRestRejected:
        print("\n[WARN] hosted_rest_rejected: refusing hosted Supabase REST writes")
        sys.exit(hosted_rest_exit_code())
    except SupabaseRestConfigurationError:
        print("\n[ERROR] Supabase REST configuration invalid.")
        sys.exit(1)
    except Exception as error:
        print(f"\n[ERROR] 오류: {safe_error_name(error)}")
        sys.exit(1)

if __name__ == "__main__":
    main()
