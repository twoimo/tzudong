#!/usr/bin/env python3
"""
Supabase 데이터 삽입 스크립트
transforms.jsonl 데이터를 Supabase에 삽입합니다.

- trace_id 기반 중복 검사
- 배치 삽입
"""

import json
import os
import sys
import argparse
from pathlib import Path
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv

try:
    from supabase import create_client, Client
except ImportError:
    print("❌ supabase 패키지가 설치되지 않았습니다.")
    print("   pip install supabase 실행")
    sys.exit(1)

# 한국 시간대
KST = timezone(timedelta(hours=9))


def main():
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
    # .env 로드 (backend/.env)
    # 1. backend/restaurant-evaluation/.env (기존)
    env_path = Path(__file__).parent.parent / ".env"
    if env_path.exists():
        load_dotenv(env_path)
    
    # 2. backend/.env (표준)
    env_path_backend = Path(__file__).parent.parent.parent / ".env"
    if env_path_backend.exists():
        load_dotenv(env_path_backend)
        print(f"[{datetime.now(KST).strftime('%H:%M:%S')}] ✅ .env 로드: {env_path_backend}")

    # Supabase 설정
    supabase_url = os.getenv("SUPABASE_URL") or os.getenv("VITE_SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv(
        "VITE_SUPABASE_PUBLISHABLE_KEY"
    )

    if not supabase_url or not supabase_key:
        print(f"❌ SUPABASE_URL 또는 SUPABASE_KEY 환경변수가 설정되지 않았습니다.")
        sys.exit(1)

    print(f"[{datetime.now(KST).strftime('%H:%M:%S')}] ✅ Supabase 설정 완료")
    print(f"   URL: {supabase_url}")

    # Supabase 클라이언트 생성
    supabase: Client = create_client(supabase_url, supabase_key)

    # 입력 파일
    input_file = evaluation_path / "evaluation" / "transforms.jsonl"

    if not input_file.exists():
        print(f"⚠️ transforms 파일 없음: {input_file} (데이터 없음으로 간주)")
        # 0건 처리로 종료
        print(f"\n{'='*50}")
        print(f"✅ Supabase 삽입 완료! (SKIP)")
        print(f"   총 레코드: 0개")
        print(f"{'='*50}")
        return

    print(f"[{datetime.now(KST).strftime('%H:%M:%S')}] 📂 입력 파일: {input_file}")

    # 기존 trace_id 조회
    print(f"[{datetime.now(KST).strftime('%H:%M:%S')}] 🔍 기존 데이터 조회 중...")

    existing_ids = set()
    try:
        offset = 0
        limit = 1000
        while True:
            response = (
                supabase.table("restaurants")
                .select("trace_id")
                .eq("channel_name", channel)
                .range(offset, offset + limit - 1)
                .execute()
            )
            
            if not response.data:
                break
                
            batch_ids = {row["trace_id"] for row in response.data if row.get("trace_id")}
            existing_ids.update(batch_ids)
            
            if len(response.data) < limit:
                break
                
            offset += limit
            print(f"   ...{len(existing_ids)}개 로드 중")

        print(f"   기존 레코드: {len(existing_ids)}개 (전체 로드 완료)")
    except Exception as e:
        print(f"⚠️ 기존 데이터 조회 실패: {e}")

    # 통계
    stats = {"total_records": 0, "inserted": 0, "skipped": 0, "errors": 0}

    # 데이터 읽기 및 삽입
    batch_size = 50
    batch = []

    with open(input_file, "r", encoding="utf-8") as f:
        for line in f:
            stats["total_records"] += 1

            try:
                data = json.loads(line.strip())
                trace_id = data.get("trace_id")

                # 이미 있는 데이터도 업데이트를 위해 upsert 진행 (기존 skipped 카운트 제거)
                # if trace_id in existing_ids:
                #     stats["skipped"] += 1
                #     continue

                # 데이터 변환 (필요한 필드만)
                # category → categories 배열로 변환
                category = data.get("category")
                categories = [category] if category else []

                # youtube_meta에서 publishedAt 추출하여 created_at으로 사용 (UI 표시용)
                youtube_meta = data.get("youtube_meta")
                record_created_at = datetime.now(KST).isoformat()
                if youtube_meta and youtube_meta.get("publishedAt"):
                    record_created_at = youtube_meta.get("publishedAt")

                record = {
                    "trace_id": trace_id,
                    "youtube_link": data.get("youtube_link"),
                    "channel_name": data.get("channel_name") or channel,
                    "status": data.get("status", "pending"),
                    "origin_name": data.get("origin_name"),
                    "naver_name": data.get("naver_name"),
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

                # upsert 시도 (데이터 업데이트 포함)
                batch.append(record)

                # 배치 삽입
                if len(batch) >= batch_size:
                    if not dry_run:
                        try:
                            # trace_id 기반 upsert
                            supabase.table("restaurants").upsert(batch, on_conflict="trace_id").execute()
                            stats["inserted"] += len(batch)
                            print(f"   {stats['inserted']}개 처리 완료 (Upsert)...")
                        except Exception as e:
                            print(f"⚠️ 배치 Upsert 오류: {e}")
                            stats["errors"] += len(batch)
                    else:
                        stats["inserted"] += len(batch)
                    batch = []

            except json.JSONDecodeError:
                stats["errors"] += 1

    # 남은 배치 삽입
    if batch:
        if not dry_run:
            try:
                supabase.table("restaurants").upsert(batch, on_conflict="trace_id").execute()
                stats["inserted"] += len(batch)
            except Exception as e:
                print(f"⚠️ 마지막 배치 Upsert 오류: {e}")
                stats["errors"] += len(batch)
        else:
            stats["inserted"] += len(batch)

    # 결과 출력
    print(f"\n{'='*50}")
    print(f"✅ Supabase 삽입 완료!")
    print(f"   총 레코드: {stats['total_records']}개")
    print(f"   삽입됨: {stats['inserted']}개")
    print(f"   건너뜀 (중복): {stats['skipped']}개")
    if stats["errors"] > 0:
        print(f"   오류: {stats['errors']}개")
    if dry_run:
        print(f"   [DRY RUN 모드 - 실제 삽입 안됨]")
    print(f"{'='*50}")


if __name__ == "__main__":
    main()
