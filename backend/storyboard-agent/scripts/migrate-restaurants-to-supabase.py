#!/usr/bin/env python3
"""
Docker PostgreSQL의 restaurants 테이블을 Supabase로 마이그레이션

Usage:
    python migrate-restaurants-to-supabase.py
"""

import os
import sys
import json
from pathlib import Path
from datetime import datetime
from decimal import Decimal
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


def get_local_data():
    """Docker PostgreSQL에서 restaurants 데이터 가져오기"""
    print("📥 Docker PostgreSQL에서 데이터 조회 중...")

    conn = psycopg2.connect(**LOCAL_DB)
    cursor = conn.cursor(cursor_factory=RealDictCursor)

    cursor.execute("SELECT * FROM restaurants ORDER BY created_at")
    rows = cursor.fetchall()

    conn.close()

    print(f"✅ {len(rows)}개 레코드 조회됨")
    return rows


def convert_for_supabase(row: dict) -> dict:
    """Supabase에 맞게 데이터 변환"""
    converted = {}

    for key, value in row.items():
        if value is None:
            converted[key] = None
        elif isinstance(value, Decimal):
            converted[key] = float(value)
        elif isinstance(value, datetime):
            converted[key] = value.isoformat()
        elif isinstance(value, list):
            converted[key] = value
        elif isinstance(value, dict):
            converted[key] = value
        else:
            converted[key] = value

    return converted


def create_supabase_table(supabase: Client):
    """Supabase에 restaurants 테이블 생성 (SQL RPC 사용)"""
    print("🔧 Supabase에 테이블 생성 중...")

    # Supabase SQL Editor에서 실행해야 할 SQL
    create_table_sql = """
    -- restaurants 테이블 생성
    CREATE TABLE IF NOT EXISTS restaurants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        approved_name TEXT,
        phone TEXT,
        categories TEXT[],
        lat NUMERIC,
        lng NUMERIC,
        road_address TEXT,
        jibun_address TEXT,
        english_address TEXT,
        address_elements JSONB DEFAULT '{}',
        origin_address JSONB,
        youtube_meta JSONB,
        trace_id TEXT UNIQUE,
        reasoning_basis TEXT,
        evaluation_results JSONB,
        source_type TEXT,
        geocoding_success BOOLEAN DEFAULT FALSE,
        geocoding_false_stage INTEGER,
        status TEXT DEFAULT 'pending',
        is_missing BOOLEAN DEFAULT FALSE,
        is_not_selected BOOLEAN DEFAULT FALSE,
        review_count INTEGER DEFAULT 0,
        created_by UUID,
        updated_by_admin_id UUID,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        db_error_message TEXT,
        db_error_details JSONB,
        tzuyang_review TEXT,
        youtube_link TEXT,
        search_count INTEGER DEFAULT 0,
        weekly_search_count INTEGER DEFAULT 0,
        origin_name TEXT,
        naver_name TEXT,
        trace_id_name_source TEXT,
        channel_name TEXT,
        description_map_url TEXT,
        recollect_version JSONB
    );

    -- 인덱스 생성
    CREATE INDEX IF NOT EXISTS idx_restaurants_created_at ON restaurants(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_restaurants_name ON restaurants(approved_name);
    CREATE INDEX IF NOT EXISTS idx_restaurants_review_count ON restaurants(review_count DESC);
    CREATE INDEX IF NOT EXISTS idx_restaurants_status ON restaurants(status);
    CREATE INDEX IF NOT EXISTS idx_restaurants_unique_id ON restaurants(trace_id);
    """

    print("⚠️  Supabase SQL Editor에서 다음 SQL을 먼저 실행하세요:")
    print("=" * 60)
    print(create_table_sql)
    print("=" * 60)

    # 테이블 존재 여부 확인
    try:
        result = supabase.table("restaurants").select("id").limit(1).execute()
        print("✅ restaurants 테이블이 이미 존재합니다")
        return True
    except Exception as e:
        if "does not exist" in str(e) or "relation" in str(e).lower():
            print("❌ restaurants 테이블이 없습니다. 위 SQL을 먼저 실행해주세요.")
            return False
        else:
            # 다른 에러 (권한 등) - 테이블은 존재할 수 있음
            print(f"⚠️ 테이블 확인 중 오류: {e}")
            return True


def migrate_data(supabase: Client, rows: list):
    """데이터 마이그레이션"""
    print(f"\n📤 Supabase로 {len(rows)}개 레코드 삽입 중...")

    # 배치 크기
    batch_size = 100
    success = 0
    errors = 0

    for i in tqdm(range(0, len(rows), batch_size), desc="마이그레이션"):
        batch = rows[i : i + batch_size]
        converted_batch = [convert_for_supabase(row) for row in batch]

        try:
            # upsert로 중복 처리 (trace_id 기준)
            result = (
                supabase.table("restaurants")
                .upsert(converted_batch, on_conflict="trace_id")
                .execute()
            )
            success += len(batch)
        except Exception as e:
            print(f"\n⚠️ 배치 오류 (인덱스 {i}): {e}")
            errors += len(batch)

            # 개별 삽입 시도
            for row in converted_batch:
                try:
                    supabase.table("restaurants").upsert(
                        row, on_conflict="trace_id"
                    ).execute()
                    success += 1
                    errors -= 1
                except Exception as e2:
                    print(f"  - 개별 오류 (trace_id={row.get('trace_id')}): {e2}")

    print(f"\n✅ 마이그레이션 완료: {success}개 성공, {errors}개 실패")


def verify_migration(supabase: Client, original_count: int):
    """마이그레이션 검증"""
    print("\n🔍 마이그레이션 검증 중...")

    try:
        # 총 개수 확인
        result = supabase.table("restaurants").select("id", count="exact").execute()
        supabase_count = result.count

        print(f"  Docker PostgreSQL: {original_count}개")
        print(f"  Supabase: {supabase_count}개")

        if supabase_count >= original_count:
            print("✅ 마이그레이션 성공!")
        else:
            print(f"⚠️ {original_count - supabase_count}개 누락")

        # 샘플 데이터 확인
        sample = supabase.table("restaurants").select("*").limit(3).execute()
        print("\n📋 샘플 데이터:")
        for row in sample.data:
            print(
                f"  - {row.get('approved_name') or row.get('origin_name')}: {row.get('status')}"
            )

    except Exception as e:
        print(f"❌ 검증 오류: {e}")


def main():
    print("=" * 60)
    print("Docker PostgreSQL → Supabase 마이그레이션")
    print("=" * 60)

    # Supabase 클라이언트 초기화
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("❌ SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 없습니다")
        return

    print(f"\n🔌 Supabase 연결: {SUPABASE_URL}")
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    # 1. 테이블 생성 확인
    if not create_supabase_table(supabase):
        return

    # 테이블이 있으면 바로 진행

    # 2. 로컬 데이터 가져오기
    rows = get_local_data()

    if not rows:
        print("❌ 마이그레이션할 데이터가 없습니다")
        return

    # 3. 데이터 마이그레이션
    migrate_data(supabase, rows)

    # 4. 검증
    verify_migration(supabase, len(rows))

    print("\n" + "=" * 60)
    print("✅ 완료!")
    print("=" * 60)


if __name__ == "__main__":
    main()
