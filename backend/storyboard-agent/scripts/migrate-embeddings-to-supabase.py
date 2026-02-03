#!/usr/bin/env python3
"""
Docker PostgreSQL의 document_embeddings 테이블을 Supabase로 마이그레이션

Source: Docker PostgreSQL document_embeddings (자막 + 임베딩)
Target: Supabase document_embeddings

Usage:
    python migrate-embeddings-to-supabase.py
"""

import os
import sys
from pathlib import Path
from datetime import datetime
import psycopg2
from psycopg2.extras import RealDictCursor
from supabase import create_client, Client
from dotenv import load_dotenv
from tqdm import tqdm

# 출력 버퍼링 비활성화
sys.stdout.reconfigure(line_buffering=True)

# .env 로드
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)

# Docker PostgreSQL 설정
LOCAL_DB = {
    "host": "localhost",
    "port": 5432,
    "database": "tzudong",
    "user": "postgres",
    "password": "password",
}

# Supabase 설정
SUPABASE_URL = os.getenv("PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

# Supabase에서 실행해야 할 CREATE TABLE SQL
CREATE_TABLE_SQL = """
-- pgvector 확장 활성화 (Supabase에서는 기본 제공)
CREATE EXTENSION IF NOT EXISTS vector;

-- document_embeddings 테이블 생성
CREATE TABLE IF NOT EXISTS document_embeddings (
    id SERIAL PRIMARY KEY,
    video_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    recollect_id INTEGER NOT NULL DEFAULT 0,
    page_content TEXT NOT NULL,
    embedding vector(1536),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE (video_id, chunk_index, recollect_id)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_embeddings_video_id ON document_embeddings(video_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_recollect ON document_embeddings(video_id, recollect_id);

-- HNSW 인덱스 (벡터 검색용) - 선택사항, 데이터 적재 후 생성 권장
-- CREATE INDEX IF NOT EXISTS idx_embeddings_vector ON document_embeddings 
--     USING hnsw (embedding vector_cosine_ops);
"""


def get_local_data_count():
    """Docker PostgreSQL에서 총 레코드 수 확인"""
    conn = psycopg2.connect(**LOCAL_DB)
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM document_embeddings")
    count = cursor.fetchone()[0]
    conn.close()
    return count


def get_local_data_batch(offset: int, limit: int):
    """Docker PostgreSQL에서 배치 단위로 데이터 가져오기"""
    conn = psycopg2.connect(**LOCAL_DB)
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    cursor.execute(
        """
        SELECT id, video_id, chunk_index, recollect_id, page_content, 
               embedding::text as embedding, metadata, created_at, updated_at
        FROM document_embeddings 
        ORDER BY id
        OFFSET %s LIMIT %s
        """,
        (offset, limit),
    )
    rows = cursor.fetchall()
    conn.close()
    return rows


def convert_for_supabase(row: dict) -> dict:
    """Supabase에 맞게 데이터 변환"""
    converted = {}

    for key, value in row.items():
        if value is None:
            converted[key] = None
        elif isinstance(value, datetime):
            converted[key] = value.isoformat()
        elif key == "embedding" and value:
            # embedding은 문자열로 변환됨 - Supabase에서 자동 처리
            converted[key] = value
        elif isinstance(value, dict):
            converted[key] = value
        else:
            converted[key] = value

    # id는 제외 (Supabase에서 자동 생성)
    if "id" in converted:
        del converted["id"]

    return converted


def check_supabase_table(supabase: Client) -> bool:
    """Supabase에 document_embeddings 테이블 존재 여부 확인"""
    print("🔧 Supabase 테이블 확인 중...")

    try:
        result = supabase.table("document_embeddings").select("id").limit(1).execute()
        print("✅ document_embeddings 테이블이 이미 존재합니다")
        return True
    except Exception as e:
        error_str = str(e)
        if "PGRST205" in error_str or "does not exist" in error_str:
            print("❌ document_embeddings 테이블이 없습니다.")
            print("\n⚠️  Supabase SQL Editor에서 다음 SQL을 먼저 실행하세요:")
            print("=" * 60)
            print(CREATE_TABLE_SQL)
            print("=" * 60)
            return False
        else:
            print(f"⚠️ 테이블 확인 중 오류: {e}")
            return True


def migrate_data(supabase: Client, total_count: int):
    """데이터 마이그레이션 (배치 처리, resume 지원)"""

    # 이미 마이그레이션된 개수 확인
    existing_result = (
        supabase.table("document_embeddings").select("id", count="exact").execute()
    )
    already_migrated = existing_result.count or 0

    if already_migrated >= total_count:
        print(f"✅ 이미 모든 데이터가 마이그레이션됨 ({already_migrated}개)")
        return

    start_offset = already_migrated
    remaining = total_count - start_offset

    print(f"\n📤 Resume 마이그레이션: {start_offset}개 완료됨, {remaining}개 남음")

    batch_size = 50
    success = 0
    errors = 0

    pbar = tqdm(total=remaining, desc="마이그레이션")

    for offset in range(start_offset, total_count, batch_size):
        # 배치 데이터 가져오기
        rows = get_local_data_batch(offset, batch_size)
        converted_batch = [convert_for_supabase(row) for row in rows]

        try:
            # upsert로 중복 처리 (버전별 저장)
            result = (
                supabase.table("document_embeddings")
                .upsert(
                    converted_batch, on_conflict="video_id,chunk_index,recollect_id"
                )
                .execute()
            )
            success += len(rows)
        except Exception as e:
            print(f"\n⚠️ 배치 오류 (offset {offset}): {e}")
            errors += len(rows)

            # 개별 삽입 시도
            for row in converted_batch:
                try:
                    supabase.table("document_embeddings").upsert(
                        row, on_conflict="video_id,chunk_index,recollect_id"
                    ).execute()
                    success += 1
                    errors -= 1
                except Exception as e2:
                    print(
                        f"  - 개별 오류 (video_id={row.get('video_id')}, chunk={row.get('chunk_index')}): {str(e2)[:100]}"
                    )

        pbar.update(len(rows))

    pbar.close()
    print(f"\n✅ 마이그레이션 완료: {success}개 성공, {errors}개 실패")


def verify_migration(supabase: Client, original_count: int):
    """마이그레이션 검증"""
    print("\n🔍 마이그레이션 검증 중...")

    try:
        result = (
            supabase.table("document_embeddings").select("id", count="exact").execute()
        )
        supabase_count = result.count

        print(f"  Docker PostgreSQL: {original_count}개")
        print(f"  Supabase: {supabase_count}개")

        if supabase_count >= original_count:
            print("✅ 마이그레이션 성공!")
        else:
            print(f"⚠️ {original_count - supabase_count}개 누락")

        # 샘플 데이터 확인
        sample = (
            supabase.table("document_embeddings")
            .select("video_id, chunk_index, page_content")
            .limit(3)
            .execute()
        )
        print("\n📋 샘플 데이터:")
        for row in sample.data:
            content_preview = row.get("page_content", "")[:60]
            print(
                f"  - {row.get('video_id')} [chunk {row.get('chunk_index')}]: {content_preview}..."
            )

    except Exception as e:
        print(f"❌ 검증 오류: {e}")


def main():
    print("=" * 60)
    print("Docker PostgreSQL → Supabase 마이그레이션 (document_embeddings)")
    print("=" * 60)

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("❌ SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 없습니다")
        return

    print(f"\n🔌 Supabase 연결: {SUPABASE_URL}")
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    # 1. 테이블 확인
    if not check_supabase_table(supabase):
        return

    # 2. 총 레코드 수 확인
    total_count = get_local_data_count()
    print(f"📥 Docker PostgreSQL 레코드 수: {total_count}개")

    if total_count == 0:
        print("❌ 마이그레이션할 데이터가 없습니다")
        return

    # 3. 데이터 마이그레이션
    migrate_data(supabase, total_count)

    # 4. 검증
    verify_migration(supabase, total_count)

    print("\n" + "=" * 60)
    print("✅ 완료!")
    print("=" * 60)


if __name__ == "__main__":
    main()
