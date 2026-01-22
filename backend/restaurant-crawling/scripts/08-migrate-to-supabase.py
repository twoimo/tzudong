#!/usr/bin/env python3
"""
08-migrate-to-supabase.py

tzuyang 크롤링 데이터를 Supabase PostgreSQL 단일 테이블로 마이그레이션.
메타, 히트맵, 트랜스크립트를 videos 테이블 하나에 JSONB로 저장.

사용법:
    python3 08-migrate-to-supabase.py --channel tzuyang
    python3 08-migrate-to-supabase.py --channel tzuyang --verify-only
    python3 08-migrate-to-supabase.py --channel tzuyang --test-queries
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

# 프로젝트 루트 경로 설정
SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR.parent / "data"
BACKEND_ENV = SCRIPT_DIR.parent.parent / ".env"
SUPABASE_ENV = SCRIPT_DIR.parent.parent.parent / "supabase-project" / ".env"

# 환경 변수 로드
load_dotenv(BACKEND_ENV)
load_dotenv(SUPABASE_ENV)


# ============================================================================
# 단일 테이블 스키마 SQL
# ============================================================================

CREATE_TABLE_SQL = """
-- 기존 테이블 삭제 (필요시 주석 해제)
-- DROP TABLE IF EXISTS videos CASCADE;

-- videos: 모든 데이터를 담는 단일 테이블
CREATE TABLE IF NOT EXISTS videos (
    -- 기본 식별자
    id TEXT PRIMARY KEY,
    youtube_link TEXT NOT NULL,
    channel_name TEXT NOT NULL,
    
    -- 비디오 메타데이터
    title TEXT,
    description TEXT,
    published_at TIMESTAMPTZ,
    duration INTEGER,
    is_shorts BOOLEAN DEFAULT FALSE,
    category TEXT,
    thumbnail_url TEXT,
    
    -- 광고 정보
    is_ads BOOLEAN DEFAULT FALSE,
    advertisers TEXT[],  -- 광고주 배열
    
    -- 태그
    tags TEXT[],
    
    -- 최신 통계
    view_count BIGINT,
    like_count INTEGER,
    comment_count INTEGER,
    
    -- 히스토리 데이터 (JSONB)
    stats_history JSONB DEFAULT '[]',  -- [{collected_at, view_count, like_count, comment_count}]
    
    -- 히트맵 데이터 (JSONB)
    heatmap_segments JSONB DEFAULT '[]',  -- [{start_millis, intensity_score, formatted_time}]
    most_replayed_markers JSONB DEFAULT '[]',
    
    -- 트랜스크립트 (JSONB)
    transcript JSONB DEFAULT '[]',  -- [{start, duration, text}]
    transcript_language TEXT,
    
    -- 메타
    latest_recollect_id INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_videos_channel ON videos(channel_name);
CREATE INDEX IF NOT EXISTS idx_videos_published ON videos(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_videos_views ON videos(view_count DESC NULLS LAST);

-- 태그 검색용 GIN 인덱스
CREATE INDEX IF NOT EXISTS idx_videos_tags ON videos USING GIN(tags);

-- 제목 풀텍스트 검색
CREATE INDEX IF NOT EXISTS idx_videos_title_fts ON videos USING GIN(to_tsvector('simple', title));

-- JSONB 검색용 인덱스
CREATE INDEX IF NOT EXISTS idx_videos_heatmap ON videos USING GIN(heatmap_segments);
CREATE INDEX IF NOT EXISTS idx_videos_transcript ON videos USING GIN(transcript);
"""


def get_db_connection():
    """Supabase PostgreSQL 연결"""
    supabase_url = os.getenv("SUPABASE_DB_URL")
    if supabase_url:
        return psycopg2.connect(supabase_url)
    
    return psycopg2.connect(
        host=os.getenv("SUPABASE_DB_HOST", "localhost"),
        port=os.getenv("SUPABASE_DB_PORT", "54322"),
        database=os.getenv("SUPABASE_DB_NAME", "postgres"),
        user=os.getenv("SUPABASE_DB_USER", "postgres"),
        password=os.getenv("SUPABASE_DB_PASSWORD", os.getenv("POSTGRES_PASSWORD", ""))
    )


def create_table(conn):
    """테이블 생성"""
    print("📦 테이블 생성 중...")
    with conn.cursor() as cur:
        cur.execute(CREATE_TABLE_SQL)
    conn.commit()
    print("✅ 테이블 생성 완료")


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


def load_meta_data(channel: str) -> dict:
    """메타 데이터 로드"""
    meta_dir = DATA_DIR / channel / "meta"
    if not meta_dir.exists():
        return {}
    
    print(f"📂 메타 데이터 로드: {meta_dir}")
    videos = {}
    
    for jsonl_file in meta_dir.glob("*.jsonl"):
        video_id = jsonl_file.stem
        
        with open(jsonl_file, "r", encoding="utf-8") as f:
            lines = [line.strip() for line in f if line.strip()]
        
        if not lines:
            continue
        
        # 모든 레코드에서 stats_history 수집
        stats_history = []
        latest_record = None
        
        for line in lines:
            try:
                record = json.loads(line)
                latest_record = record
                
                stats = record.get("stats", {})
                collected_at = record.get("collected_at")
                
                if collected_at and stats.get("view_count") is not None:
                    stats_history.append({
                        "collected_at": collected_at,
                        "view_count": stats.get("view_count"),
                        "like_count": stats.get("like_count"),
                        "comment_count": stats.get("comment_count"),
                        "recollect_id": record.get("recollect_id", 0)
                    })
            except json.JSONDecodeError:
                continue
        
        if not latest_record:
            continue
        
        ads_info = latest_record.get("ads_info", {})
        latest_stats = latest_record.get("stats", {})
        
        videos[video_id] = {
            "id": video_id,
            "youtube_link": latest_record.get("youtube_link", f"https://www.youtube.com/watch?v={video_id}"),
            "channel_name": latest_record.get("channel_name", channel),
            "title": latest_record.get("title"),
            "description": latest_record.get("description"),
            "published_at": parse_timestamp(latest_record.get("published_at")),
            "duration": latest_record.get("duration"),
            "is_shorts": latest_record.get("is_shorts", False),
            "category": latest_record.get("category"),
            "thumbnail_url": latest_record.get("thumbnail_url"),
            "is_ads": ads_info.get("is_ads", False),
            "advertisers": ads_info.get("what_ads") or [],
            "tags": latest_record.get("tags", []),
            "view_count": latest_stats.get("view_count"),
            "like_count": latest_stats.get("like_count"),
            "comment_count": latest_stats.get("comment_count"),
            "stats_history": stats_history,
            "latest_recollect_id": latest_record.get("recollect_id", 0),
            # 히트맵/트랜스크립트는 별도 로드
            "heatmap_segments": [],
            "most_replayed_markers": [],
            "transcript": [],
            "transcript_language": None
        }
    
    print(f"  ✅ {len(videos)}개 비디오 로드")
    return videos


def load_heatmap_data(channel: str, videos: dict):
    """히트맵 데이터 로드"""
    heatmap_dir = DATA_DIR / channel / "heatmap"
    if not heatmap_dir.exists():
        return
    
    print(f"📂 히트맵 데이터 로드: {heatmap_dir}")
    count = 0
    
    for jsonl_file in heatmap_dir.glob("*.jsonl"):
        video_id = jsonl_file.stem
        
        if video_id not in videos:
            continue
        
        with open(jsonl_file, "r", encoding="utf-8") as f:
            lines = [line.strip() for line in f if line.strip()]
        
        # 마지막 레코드 사용 (최신)
        for line in reversed(lines):
            try:
                record = json.loads(line)
                
                # 세그먼트 데이터
                segments = []
                for seg in record.get("interaction_data", []):
                    segments.append({
                        "start_millis": int(seg.get("startMillis", 0)),
                        "duration_millis": int(seg.get("durationMillis", 0)),
                        "intensity_score": float(seg.get("intensityScoreNormalized", 0)),
                        "formatted_time": seg.get("formatted_time")
                    })
                
                videos[video_id]["heatmap_segments"] = segments
                videos[video_id]["most_replayed_markers"] = record.get("most_replayed_markers", [])
                count += 1
                break
            except (json.JSONDecodeError, ValueError):
                continue
    
    print(f"  ✅ {count}개 히트맵 로드")


def load_transcript_data(channel: str, videos: dict):
    """트랜스크립트 데이터 로드"""
    transcript_dir = DATA_DIR / channel / "transcript"
    if not transcript_dir.exists():
        return
    
    print(f"📂 트랜스크립트 데이터 로드: {transcript_dir}")
    count = 0
    
    for jsonl_file in transcript_dir.glob("*.jsonl"):
        video_id = jsonl_file.stem
        
        if video_id not in videos:
            continue
        
        with open(jsonl_file, "r", encoding="utf-8") as f:
            lines = [line.strip() for line in f if line.strip()]
        
        # 마지막 레코드 사용 (최신)
        for line in reversed(lines):
            try:
                record = json.loads(line)
                
                # 세그먼트 데이터
                segments = []
                for seg in record.get("transcript", []):
                    if seg.get("text"):
                        segments.append({
                            "start": float(seg.get("start") or 0),
                            "duration": float(seg.get("duration") or 0),
                            "text": seg.get("text", "")
                        })
                
                videos[video_id]["transcript"] = segments
                videos[video_id]["transcript_language"] = record.get("language", "korean")
                count += 1
                break
            except (json.JSONDecodeError, ValueError):
                continue
    
    print(f"  ✅ {count}개 트랜스크립트 로드")


def migrate_data(conn, videos: dict):
    """데이터 마이그레이션"""
    print(f"\n📥 데이터베이스에 {len(videos)}개 비디오 삽입 중...")
    
    data = []
    for v in videos.values():
        data.append((
            v["id"],
            v["youtube_link"],
            v["channel_name"],
            v["title"],
            v["description"],
            v["published_at"],
            v["duration"],
            v["is_shorts"],
            v["category"],
            v["thumbnail_url"],
            v["is_ads"],
            v["advertisers"],
            v["tags"],
            v["view_count"],
            v["like_count"],
            v["comment_count"],
            Json(v["stats_history"]),
            Json(v["heatmap_segments"]),
            Json(v["most_replayed_markers"]),
            Json(v["transcript"]),
            v["transcript_language"],
            v["latest_recollect_id"]
        ))
    
    with conn.cursor() as cur:
        execute_values(
            cur,
            """
            INSERT INTO videos (
                id, youtube_link, channel_name, title, description,
                published_at, duration, is_shorts, category, thumbnail_url,
                is_ads, advertisers, tags, view_count, like_count, comment_count,
                stats_history, heatmap_segments, most_replayed_markers,
                transcript, transcript_language, latest_recollect_id
            ) VALUES %s
            ON CONFLICT (id) DO UPDATE SET
                title = EXCLUDED.title,
                description = EXCLUDED.description,
                duration = EXCLUDED.duration,
                thumbnail_url = EXCLUDED.thumbnail_url,
                is_ads = EXCLUDED.is_ads,
                advertisers = EXCLUDED.advertisers,
                tags = EXCLUDED.tags,
                view_count = EXCLUDED.view_count,
                like_count = EXCLUDED.like_count,
                comment_count = EXCLUDED.comment_count,
                stats_history = EXCLUDED.stats_history,
                heatmap_segments = EXCLUDED.heatmap_segments,
                most_replayed_markers = EXCLUDED.most_replayed_markers,
                transcript = EXCLUDED.transcript,
                transcript_language = EXCLUDED.transcript_language,
                latest_recollect_id = EXCLUDED.latest_recollect_id,
                updated_at = NOW()
            """,
            data,
            page_size=100
        )
    
    conn.commit()
    print("✅ 데이터 삽입 완료")


def verify_data(conn, channel: str):
    """데이터 검증"""
    print("\n🔍 데이터 검증...")
    
    with conn.cursor() as cur:
        # 기본 통계
        cur.execute("SELECT COUNT(*) FROM videos WHERE channel_name = %s", (channel,))
        count = cur.fetchone()[0]
        print(f"  videos 테이블: {count:,}개")
        
        # 히트맵 있는 비디오 수
        cur.execute("""
            SELECT COUNT(*) FROM videos 
            WHERE channel_name = %s AND jsonb_array_length(heatmap_segments) > 0
        """, (channel,))
        heatmap_count = cur.fetchone()[0]
        print(f"  히트맵 있는 비디오: {heatmap_count:,}개")
        
        # 트랜스크립트 있는 비디오 수
        cur.execute("""
            SELECT COUNT(*) FROM videos 
            WHERE channel_name = %s AND jsonb_array_length(transcript) > 0
        """, (channel,))
        transcript_count = cur.fetchone()[0]
        print(f"  트랜스크립트 있는 비디오: {transcript_count:,}개")
        
        # 소스 파일 수와 비교
        meta_dir = DATA_DIR / channel / "meta"
        if meta_dir.exists():
            file_count = len(list(meta_dir.glob("*.jsonl")))
            print(f"\n📁 소스 파일: {file_count}개 → DB: {count}개")
            if file_count == count:
                print("  ✅ 일치")
            else:
                print(f"  ⚠️  차이: {file_count - count}개")


def test_queries(conn):
    """RAG 쿼리 테스트"""
    print("\n🧪 RAG 쿼리 테스트...\n")
    
    with conn.cursor() as cur:
        # 1. 제목 검색
        print("1️⃣ 제목에 '치킨' 포함:")
        cur.execute("""
            SELECT id, title, view_count, array_length(tags, 1) as tag_count
            FROM videos WHERE title ILIKE '%치킨%' LIMIT 3
        """)
        for row in cur.fetchall():
            views = f"{row[2]:,}" if row[2] else "N/A"
            print(f"  [{row[0]}] {row[1]} (views: {views}, tags: {row[3] or 0})")
        
        # 2. 히트맵 피크 검색 (JSONB)
        print("\n2️⃣ 가장 인기있는 구간 (intensity > 0.9):")
        cur.execute("""
            SELECT id, title, 
                   seg->>'formatted_time' as peak_time,
                   (seg->>'intensity_score')::float as score
            FROM videos,
            LATERAL jsonb_array_elements(heatmap_segments) as seg
            WHERE (seg->>'intensity_score')::float > 0.9
            ORDER BY (seg->>'intensity_score')::float DESC
            LIMIT 3
        """)
        for row in cur.fetchall():
            print(f"  [{row[0]}] {row[1]} @ {row[2]} (score: {row[3]:.2f})")
        
        # 3. 트랜스크립트 검색 (JSONB)
        print("\n3️⃣ 트랜스크립트에서 '맛있' 검색:")
        cur.execute("""
            SELECT id, title,
                   seg->>'start' as start_time,
                   LEFT(seg->>'text', 50) as text_preview
            FROM videos,
            LATERAL jsonb_array_elements(transcript) as seg
            WHERE seg->>'text' ILIKE '%맛있%'
            LIMIT 3
        """)
        for row in cur.fetchall():
            print(f"  [{row[0]}] @ {float(row[2]):.1f}s: {row[3]}...")
        
        # 4. 태그 검색
        print("\n4️⃣ '먹방' 태그가 있는 비디오:")
        cur.execute("""
            SELECT id, title, tags
            FROM videos WHERE '먹방' = ANY(tags)
            LIMIT 3
        """)
        for row in cur.fetchall():
            print(f"  [{row[0]}] {row[1]}")
    
    print("\n✅ 쿼리 테스트 완료")


def main():
    parser = argparse.ArgumentParser(description="tzuyang 데이터를 Supabase 단일 테이블로 마이그레이션")
    parser.add_argument("--channel", type=str, default="tzuyang", help="채널 이름")
    parser.add_argument("--verify-only", action="store_true", help="검증만 수행")
    parser.add_argument("--test-queries", action="store_true", help="쿼리 테스트")
    parser.add_argument("--skip-create-table", action="store_true", help="테이블 생성 건너뛰기")
    parser.add_argument("--drop-existing", action="store_true", help="기존 테이블 삭제 후 재생성")
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("🚀 Supabase 단일 테이블 마이그레이션")
    print("=" * 60)
    print(f"채널: {args.channel}")
    print()
    
    try:
        conn = get_db_connection()
        print("✅ 데이터베이스 연결 성공\n")
    except Exception as e:
        print(f"❌ 연결 실패: {e}")
        sys.exit(1)
    
    try:
        if args.verify_only:
            verify_data(conn, args.channel)
        elif args.test_queries:
            test_queries(conn)
        else:
            # 기존 테이블 삭제 (옵션)
            if args.drop_existing:
                print("🗑️  기존 테이블 삭제 중...")
                with conn.cursor() as cur:
                    cur.execute("DROP TABLE IF EXISTS videos CASCADE")
                    # 기존 정규화 테이블도 삭제
                    cur.execute("DROP TABLE IF EXISTS transcript_segments CASCADE")
                    cur.execute("DROP TABLE IF EXISTS video_transcripts CASCADE")
                    cur.execute("DROP TABLE IF EXISTS heatmap_segments CASCADE")
                    cur.execute("DROP TABLE IF EXISTS video_heatmaps CASCADE")
                    cur.execute("DROP TABLE IF EXISTS video_ads CASCADE")
                    cur.execute("DROP TABLE IF EXISTS video_tags CASCADE")
                    cur.execute("DROP TABLE IF EXISTS video_stats_history CASCADE")
                conn.commit()
                print("✅ 기존 테이블 삭제 완료\n")
            
            # 테이블 생성
            if not args.skip_create_table:
                create_table(conn)
            
            # 데이터 로드
            videos = load_meta_data(args.channel)
            load_heatmap_data(args.channel, videos)
            load_transcript_data(args.channel, videos)
            
            # 마이그레이션
            migrate_data(conn, videos)
            
            # 검증
            verify_data(conn, args.channel)
        
        print("\n" + "=" * 60)
        print("🎉 완료!")
        print("=" * 60)
        
    except Exception as e:
        print(f"\n❌ 오류: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
