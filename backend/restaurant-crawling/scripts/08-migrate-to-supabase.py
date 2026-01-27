#!/usr/bin/env python3
"""
08-migrate-to-supabase.py

tzuyang 메타 데이터를 Supabase PostgreSQL로 마이그레이션.
/data/tzuyang/meta 폴더의 JSONL 파일만 처리합니다.

사용법:
    python3 08-migrate-to-supabase.py --channel tzuyang
    python3 08-migrate-to-supabase.py --channel tzuyang --drop-existing
    python3 08-migrate-to-supabase.py --verify-only
    python3 08-migrate-to-supabase.py --test-queries
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

try:
    import psycopg2
    from psycopg2.extras import execute_values, Json
except ImportError:
    print("psycopg2 패키지가 필요합니다: pip install psycopg2-binary")
    sys.exit(1)

from dotenv import load_dotenv

# 경로 설정
SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR.parent / "data"
BACKEND_ENV = SCRIPT_DIR.parent.parent / ".env"
SUPABASE_ENV = SCRIPT_DIR.parent.parent.parent / "supabase-project" / ".env"

load_dotenv(BACKEND_ENV)
load_dotenv(SUPABASE_ENV)


# ============================================================================
# 테이블 스키마 (메타 데이터 전용)
# ============================================================================

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS videos (
    -- 1. 식별자 (Text)
    id TEXT PRIMARY KEY,
    
    -- 2. Fixed-Width Types (Storage Optimization)
    published_at TIMESTAMPTZ,
    duration INTEGER,
    view_count BIGINT,
    like_count INTEGER,
    comment_count INTEGER,
    latest_recollect_id INTEGER DEFAULT 0,
    is_shorts BOOLEAN DEFAULT FALSE,
    is_ads BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- 3. Variable-Width Types (Text)
    youtube_link TEXT NOT NULL,
    channel_name TEXT NOT NULL,
    title TEXT,
    description TEXT,
    category TEXT,
    thumbnail_url TEXT,
    thumbnail_hash TEXT,
    
    -- 4. Arrays & JSONB (Variable)
    advertisers TEXT[],
    tags TEXT[],
    recollect_vars TEXT[],
    meta_history JSONB DEFAULT '[]'
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_videos_channel ON videos(channel_name);
CREATE INDEX IF NOT EXISTS idx_videos_published ON videos(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_views ON videos(view_count DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_videos_tags ON videos USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_videos_recollect_vars ON videos USING GIN(recollect_vars);
CREATE INDEX IF NOT EXISTS idx_videos_title_fts ON videos USING GIN(to_tsvector('simple', coalesce(title, '')));
CREATE INDEX IF NOT EXISTS idx_videos_desc_fts ON videos USING GIN(to_tsvector('simple', coalesce(description, '')));
"""


def get_db_connection():
    """DB 연결"""
    return psycopg2.connect(
        host=os.getenv("SUPABASE_DB_HOST", "localhost"),
        port=os.getenv("SUPABASE_DB_PORT", "54322"),
        database=os.getenv("SUPABASE_DB_NAME", "postgres"),
        user=os.getenv("SUPABASE_DB_USER", "postgres"),
        password=os.getenv("SUPABASE_DB_PASSWORD", os.getenv("POSTGRES_PASSWORD", ""))
    )


def parse_timestamp(ts_str: Optional[str]) -> Optional[datetime]:
    """타임스탬프 파싱"""
    if not ts_str:
        return None
    try:
        if "+" in ts_str or ts_str.endswith("Z"):
            return datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        return datetime.fromisoformat(ts_str)
    except Exception:
        return None


def migrate_meta(conn, channel: str):
    """메타 데이터 마이그레이션"""
    meta_dir = DATA_DIR / channel / "meta"
    if not meta_dir.exists():
        print(f"❌ 메타 디렉토리 없음: {meta_dir}")
        return 0
    
    print(f"📂 메타 데이터 로드: {meta_dir}")
    
    videos_data = []
    jsonl_files = list(meta_dir.glob("*.jsonl"))
    total = len(jsonl_files)
    
    for idx, jsonl_file in enumerate(jsonl_files, 1):
        if idx % 200 == 0:
            print(f"  처리 중: {idx}/{total}")
        
        video_id = jsonl_file.stem
        
        with open(jsonl_file, "r", encoding="utf-8") as f:
            lines = [line.strip() for line in f if line.strip()]
        
        if not lines:
            continue
        
        # meta_history 수집 (stats + metadata)
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
                        # 메타 데이터 이력 추가
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
        
        # 튜플 순서: 스키마 순서와 일치해야 함
        videos_data.append((
            # 1. ID
            video_id,
            
            # 2. Fixed-Width
            parse_timestamp(latest_record.get("published_at")),
            latest_record.get("duration"),
            latest_stats.get("view_count"),
            latest_stats.get("like_count"),
            latest_stats.get("comment_count"),
            latest_record.get("recollect_id", 0),
            latest_record.get("is_shorts", False),
            ads_info.get("is_ads", False),
            
            # 3. Variable-Width
            latest_record.get("youtube_link", f"https://www.youtube.com/watch?v={video_id}"),
            latest_record.get("channel_name", channel),
            latest_record.get("title"),
            latest_record.get("description"),
            latest_record.get("category"),
            latest_record.get("thumbnail_url"),
            latest_record.get("thumbnail_hash"),
            
            # 4. Arrays/JSON
            ads_info.get("what_ads") or [],
            latest_record.get("tags", []),
            latest_record.get("recollect_vars", []),
            Json(meta_history)
        ))
    
    print(f"  ✅ {len(videos_data)}개 비디오 로드")
    
    # DB 삽입
    print(f"\n📥 데이터베이스 삽입 중...")
    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO videos (
                id,
                published_at, duration, view_count, like_count, comment_count, latest_recollect_id, is_shorts, is_ads,
                youtube_link, channel_name, title, description, category, thumbnail_url, thumbnail_hash,
                advertisers, tags, recollect_vars, meta_history
            ) VALUES %s
            ON CONFLICT (id) DO UPDATE SET
                published_at = EXCLUDED.published_at,
                duration = EXCLUDED.duration,
                view_count = EXCLUDED.view_count,
                like_count = EXCLUDED.like_count,
                comment_count = EXCLUDED.comment_count,
                latest_recollect_id = EXCLUDED.latest_recollect_id,
                is_shorts = EXCLUDED.is_shorts,
                is_ads = EXCLUDED.is_ads,
                
                youtube_link = EXCLUDED.youtube_link,
                channel_name = EXCLUDED.channel_name,
                title = EXCLUDED.title,
                description = EXCLUDED.description,
                category = EXCLUDED.category,
                thumbnail_url = EXCLUDED.thumbnail_url,
                thumbnail_hash = EXCLUDED.thumbnail_hash,
                
                advertisers = EXCLUDED.advertisers,
                tags = EXCLUDED.tags,
                recollect_vars = EXCLUDED.recollect_vars,
                meta_history = EXCLUDED.meta_history,
                
                updated_at = NOW()
            """,
            videos_data,
            page_size=200
        )
    conn.commit()
    print(f"✅ {len(videos_data)}개 삽입 완료")
    return len(videos_data)


def verify_data(conn, channel: str):
    """데이터 검증"""
    print("\n🔍 데이터 검증...")
    
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM videos WHERE channel_name = %s", (channel,))
        count = cur.fetchone()[0]
        print(f"  videos 테이블: {count:,}개")
        
        cur.execute("""
            SELECT COUNT(*) FROM videos 
            WHERE channel_name = %s AND view_count IS NOT NULL
        """, (channel,))
        with_stats = cur.fetchone()[0]
        print(f"  통계 있는 비디오: {with_stats:,}개")
        
        cur.execute("""
            SELECT COUNT(*) FROM videos 
            WHERE channel_name = %s AND is_ads = true
        """, (channel,))
        with_ads = cur.fetchone()[0]
        print(f"  광고 포함 비디오: {with_ads:,}개")
        



def test_queries(conn):
    """쿼리 테스트"""
    print("\n🧪 RAG 쿼리 테스트...\n")
    
    with conn.cursor() as cur:
        # 1. 제목 검색
        print("1️⃣ 제목에 '치킨' 포함:")
        cur.execute("""
            SELECT id, title, view_count FROM videos 
            WHERE title ILIKE '%치킨%' 
            ORDER BY view_count DESC NULLS LAST LIMIT 3
        """)
        for row in cur.fetchall():
            views = f"{row[2]:,}" if row[2] else "N/A"
            print(f"  [{row[0]}] {row[1][:40]}... ({views} views)")
        
        # 2. 태그 검색
        print("\n2️⃣ '먹방' 태그:")
        cur.execute("SELECT id, title FROM videos WHERE '먹방' = ANY(tags) LIMIT 3")
        for row in cur.fetchall():
            print(f"  [{row[0]}] {row[1][:50]}...")
        
        # 3. 광고주 검색
        print("\n3️⃣ 광고주별 비디오:")
        cur.execute("""
            SELECT unnest(advertisers) as advertiser, COUNT(*) 
            FROM videos WHERE is_ads = true
            GROUP BY advertiser ORDER BY COUNT(*) DESC LIMIT 5
        """)
        for row in cur.fetchall():
            print(f"  {row[0]}: {row[1]}개 비디오")
        

    
    print("\n✅ 쿼리 테스트 완료")


def main():
    parser = argparse.ArgumentParser(description="tzuyang 메타 데이터 Supabase 마이그레이션")
    parser.add_argument("--channel", type=str, default="tzuyang")
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--test-queries", action="store_true")
    parser.add_argument("--drop-existing", action="store_true")
    
    args = parser.parse_args()
    
    print("=" * 50)
    print("🚀 Supabase 메타 데이터 마이그레이션")
    print("=" * 50)
    
    try:
        conn = get_db_connection()
        print("✅ DB 연결 성공\n")
    except Exception as e:
        print(f"❌ 연결 실패: {e}")
        sys.exit(1)
    
    try:
        if args.verify_only:
            verify_data(conn, args.channel)
        elif args.test_queries:
            test_queries(conn)
        else:
            if args.drop_existing:
                print("🗑️  기존 테이블 삭제...")
                with conn.cursor() as cur:
                    cur.execute("DROP TABLE IF EXISTS videos CASCADE")
                conn.commit()
            
            print("📦 테이블 생성...")
            with conn.cursor() as cur:
                cur.execute(CREATE_TABLE_SQL)
            conn.commit()
            
            migrate_meta(conn, args.channel)
            verify_data(conn, args.channel)
        
        print("\n🎉 완료!")
        
    except Exception as e:
        print(f"\n❌ 오류: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
