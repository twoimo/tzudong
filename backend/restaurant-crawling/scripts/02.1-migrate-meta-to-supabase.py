#!/usr/bin/env python3
"""
02.1-migrate-meta-to-supabase.py

tzuyang 메타 데이터를 Supabase로 마이그레이션.
/data/tzuyang/meta 폴더의 JSONL 파일만 처리합니다.

사용법:
    python3 02.1-migrate-meta-to-supabase.py --channel tzuyang
    python3 02.1-migrate-meta-to-supabase.py --dry-run
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List

try:
    from supabase import create_client, Client
except ImportError:
    print("supabase 패키지가 필요합니다: pip install supabase")
    sys.exit(1)

from dotenv import load_dotenv

# 경로 설정
SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR.parent / "data"
# 상위 레벨 .env 우선 로드
ENV_FILES = [
    SCRIPT_DIR.parent.parent.parent / ".env",
    SCRIPT_DIR.parent.parent / ".env"
]
for env_file in ENV_FILES:
    if env_file.exists():
        load_dotenv(env_file)

def get_supabase_client() -> Client:
    """Supabase 클라이언트 생성"""
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
    
    if not url or not key:
        print("[ERROR] Supabase 환경변수 (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) 가 설정되지 않았습니다.")
        sys.exit(1)
        
    return create_client(url, key)

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

def migrate_meta(supabase: Client, channel: str, dry_run: bool = False):
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
    
    for idx, jsonl_file in enumerate(jsonl_files, 1):
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
        
        if len(batch_data) >= batch_size:
            if not dry_run:
                try:
                    supabase.table("videos").upsert(batch_data).execute()
                    total_upserted += len(batch_data)
                except Exception as e:
                    print(f"[WARN] 배치 업서트 실패 ({len(batch_data)}개): {e}")
            batch_data = []
            
    # 남은 데이터 처리
    if batch_data:
        if not dry_run:
            try:
                supabase.table("videos").upsert(batch_data).execute()
                total_upserted += len(batch_data)
            except Exception as e:
                print(f"[WARN] 마지막 배치 업서트 실패: {e}")
                
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
        
    except Exception as e:
        print(f"[WARN] 검증 쿼리 실패: {e}")

def main():
    parser = argparse.ArgumentParser(description="Supabase 메타 데이터 마이그레이션")
    parser.add_argument("--channel", type=str, default="tzuyang")
    parser.add_argument("--dry-run", action="store_true")
    
    args = parser.parse_args()
    
    print("=" * 50)
    print("Supabase 메타 데이터 마이그레이션 (API)")
    print("=" * 50)
    
    try:
        supabase = get_supabase_client()
        print("[OK] Client 연결 성공\n")
        
        migrate_meta(supabase, args.channel, args.dry_run)
        
        if not args.dry_run:
            verify_data(supabase, args.channel)
            
        print("\n완료!")
        
    except Exception as e:
        print(f"\n[ERROR] 오류: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
