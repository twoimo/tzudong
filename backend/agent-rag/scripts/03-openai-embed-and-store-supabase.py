#!/usr/bin/env python3
"""
자막 문서 임베딩 생성 및 Supabase pgvector 저장

OpenAI text-embedding-3-small 모델을 사용하여 임베딩을 생성하고
Supabase의 pgvector에 저장합니다.

기능:
- 신규 문서만 임베딩 생성 (video_id + recollect_id 비교)
- 모든 문서의 metadata.restaurants 최신화 (DB에서 음식점 조회)
- 업데이트된 문서 (recollect_id 증가) 재임베딩

사용법:
    python 03-embed-and-store-supabase.py
    python 03-embed-and-store-supabase.py --batch-size 50
"""

import json
import os
import sys
import re
import argparse
from pathlib import Path
from collections import defaultdict
from datetime import datetime
from tqdm import tqdm
from openai import OpenAI
from supabase import create_client, Client
from dotenv import load_dotenv

# 출력 버퍼링 비활성화
sys.stdout.reconfigure(line_buffering=True)

# .env 로드
load_dotenv()

# OpenAI 설정
openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSION = 1536

# Supabase 설정
SUPABASE_URL = os.getenv("PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

# 경로 설정
SCRIPT_DIR = Path(__file__).parent.resolve()
INPUT_DIR = (
    SCRIPT_DIR
    / "../../restaurant-crawling/data/tzuyang/transcript-document-with-context"
)


def extract_video_id_from_youtube_link(youtube_link: str) -> str | None:
    """YouTube 링크에서 video_id 추출"""
    if not youtube_link:
        return None
    match = re.search(r"[?&]v=([a-zA-Z0-9_-]+)", youtube_link)
    if match:
        return match.group(1)
    match = re.search(r"youtu\.be/([a-zA-Z0-9_-]+)", youtube_link)
    if match:
        return match.group(1)
    return None


def get_restaurants_by_video_id(supabase: Client) -> dict[str, list[str]]:
    """Supabase에서 approved 음식점을 video_id별로 조회"""
    print("📥 Supabase에서 음식점 조회 중...", flush=True)

    result = (
        supabase.table("restaurants")
        .select("youtube_link, origin_name, approved_name")
        .eq("status", "approved")
        .not_.is_("youtube_link", "null")
        .execute()
    )

    video_restaurants = defaultdict(list)
    for row in result.data:
        video_id = extract_video_id_from_youtube_link(row.get("youtube_link"))
        if video_id:
            name = row.get("approved_name") or row.get("origin_name")
            if name and name not in video_restaurants[video_id]:
                video_restaurants[video_id].append(name)

    print(f"  {len(video_restaurants)}개 video_id에 음식점 매핑됨", flush=True)
    return dict(video_restaurants)


def get_existing_embeddings(supabase: Client) -> dict[tuple, dict]:
    """
    기존 임베딩의 (video_id, chunk_index) → {recollect_id} 맵 반환
    """
    print("📥 기존 임베딩 조회 중...", flush=True)

    existing = {}
    offset = 0
    batch_size = 1000

    while True:
        result = (
            supabase.table("document_embeddings")
            .select("video_id, chunk_index, recollect_id")
            .range(offset, offset + batch_size - 1)
            .execute()
        )

        if not result.data:
            break

        for row in result.data:
            key = (row["video_id"], row["chunk_index"])
            existing[key] = {"recollect_id": row["recollect_id"]}

        if len(result.data) < batch_size:
            break
        offset += batch_size

    print(f"  기존 임베딩: {len(existing)}개", flush=True)
    return existing


def get_embeddings(texts: list[str]) -> list[list[float]]:
    """OpenAI API로 임베딩 생성"""
    response = openai_client.embeddings.create(model=EMBEDDING_MODEL, input=texts)
    return [item.embedding for item in response.data]


def load_documents(video_restaurants: dict[str, list[str]]):
    """문서 로드 및 음식점 정보 추가"""
    print("📥 문서 로드 중...", flush=True)

    documents = []

    if not INPUT_DIR.exists():
        print(f"❌ 입력 디렉토리 없음: {INPUT_DIR}", flush=True)
        return documents

    input_files = list(INPUT_DIR.glob("*.jsonl"))

    for input_file in tqdm(input_files, desc="파일 로드"):
        video_id = input_file.stem
        restaurants = video_restaurants.get(video_id, [])

        with open(input_file, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    docs = json.loads(line.strip())

                    if isinstance(docs, list):
                        for doc in docs:
                            metadata = doc.get("metadata", {})
                            metadata["restaurants"] = restaurants

                            documents.append(
                                {
                                    "video_id": video_id,
                                    "chunk_index": metadata.get("chunk_index", 0),
                                    "recollect_id": metadata.get("recollect_id", 0),
                                    "page_content": doc.get("page_content", ""),
                                    "metadata": metadata,
                                }
                            )
                    else:
                        metadata = docs.get("metadata", {})
                        metadata["restaurants"] = restaurants

                        documents.append(
                            {
                                "video_id": video_id,
                                "chunk_index": metadata.get("chunk_index", 0),
                                "recollect_id": metadata.get("recollect_id", 0),
                                "page_content": docs.get("page_content", ""),
                                "metadata": metadata,
                            }
                        )
                except json.JSONDecodeError:
                    continue

    print(f"✅ {len(documents)}개 문서 로드됨", flush=True)
    return documents


def filter_documents_to_embed(
    documents: list[dict], existing: dict[tuple, dict]
) -> tuple[list[dict], list[dict]]:
    """
    신규/업데이트 문서와 메타데이터만 업데이트할 문서 분리

    Returns:
        (to_embed, to_update_metadata)
    """
    to_embed = []
    to_update_metadata = []

    for doc in documents:
        key = (doc["video_id"], doc["chunk_index"])

        if key not in existing:
            to_embed.append(doc)
        elif doc["recollect_id"] > existing[key]["recollect_id"]:
            to_embed.append(doc)
        else:
            to_update_metadata.append(doc)

    return to_embed, to_update_metadata


def update_metadata_only(supabase: Client, documents: list[dict]):
    """메타데이터만 업데이트 (임베딩 재생성 없이)"""
    if not documents:
        return

    print(f"\n📝 메타데이터 업데이트 중: {len(documents)}개", flush=True)

    batch_size = 50
    success = 0
    errors = 0

    for i in tqdm(range(0, len(documents), batch_size), desc="메타데이터 업데이트"):
        batch = documents[i : i + batch_size]

        for doc in batch:
            try:
                supabase.table("document_embeddings").update(
                    {
                        "metadata": doc["metadata"],
                        "updated_at": datetime.now().isoformat(),
                    }
                ).eq("video_id", doc["video_id"]).eq(
                    "chunk_index", doc["chunk_index"]
                ).execute()
                success += 1
            except Exception as e:
                print(f"⚠️ 메타데이터 업데이트 실패: {e}", flush=True)
                errors += 1

    print(f"✅ 메타데이터 업데이트 완료: {success}개 성공, {errors}개 실패", flush=True)


def embed_and_store(supabase: Client, documents: list[dict], batch_size: int = 50):
    """임베딩 생성 및 Supabase에 저장"""
    if not documents:
        print("\n📝 임베딩할 문서 없음 (모두 최신 상태)", flush=True)
        return

    print(
        f"\n📝 임베딩 생성 및 저장 중: {len(documents)}개 (배치 크기: {batch_size})",
        flush=True,
    )

    total_batches = (len(documents) + batch_size - 1) // batch_size

    inserted = 0
    errors = 0

    for i in tqdm(
        range(0, len(documents), batch_size), desc="임베딩", total=total_batches
    ):
        batch = documents[i : i + batch_size]

        try:
            # 1. 임베딩 생성
            texts = [doc["page_content"] for doc in batch]
            embeddings = get_embeddings(texts)

            # 2. Supabase에 저장
            records = []
            for doc, embedding in zip(batch, embeddings):
                records.append(
                    {
                        "video_id": doc["video_id"],
                        "chunk_index": doc["chunk_index"],
                        "recollect_id": doc["recollect_id"],
                        "page_content": doc["page_content"],
                        "embedding": embedding,
                        "metadata": doc["metadata"],
                    }
                )

            # upsert로 중복 처리 (버전별 저장)
            supabase.table("document_embeddings").upsert(
                records, on_conflict="video_id,chunk_index,recollect_id"
            ).execute()

            inserted += len(batch)

        except Exception as e:
            print(f"\n⚠️ 배치 오류: {e}", flush=True)
            errors += len(batch)

    print(f"\n✅ 임베딩 완료: {inserted}개 성공, {errors}개 실패", flush=True)


def verify_embeddings(supabase: Client):
    """임베딩 검증"""
    print("\n🔍 임베딩 검증...", flush=True)

    # 총 개수
    result = supabase.table("document_embeddings").select("id", count="exact").execute()
    count = result.count
    print(f"  총 임베딩: {count}개", flush=True)

    # 샘플 데이터 확인
    sample = (
        supabase.table("document_embeddings")
        .select("video_id, page_content, metadata")
        .limit(3)
        .execute()
    )

    print("\n📋 샘플 데이터:", flush=True)
    for row in sample.data:
        content_preview = row.get("page_content", "")[:60]
        restaurants = row.get("metadata", {}).get("restaurants", [])
        print(f"  - {row.get('video_id')}: {content_preview}...", flush=True)
        print(f"    음식점: {restaurants}", flush=True)


def main():
    parser = argparse.ArgumentParser(
        description="문서 임베딩 및 Supabase pgvector 저장"
    )
    parser.add_argument("--batch-size", type=int, default=50, help="배치 크기")
    args = parser.parse_args()

    print("=" * 60, flush=True)
    print("문서 임베딩 및 Supabase pgvector 저장", flush=True)
    print(f"모델: {EMBEDDING_MODEL} ({EMBEDDING_DIMENSION}차원)", flush=True)
    print("=" * 60, flush=True)

    # 1. Supabase 연결
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("❌ SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 없습니다", flush=True)
        return

    print(f"\n🔌 Supabase 연결: {SUPABASE_URL}", flush=True)
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    print("✅ 연결 성공", flush=True)

    # 2. 음식점 정보 조회 (매번 최신화)
    video_restaurants = get_restaurants_by_video_id(supabase)

    # 3. 기존 임베딩 조회
    existing = get_existing_embeddings(supabase)

    # 4. 문서 로드 (음식점 정보 포함)
    documents = load_documents(video_restaurants)

    if not documents:
        print("❌ 문서가 없습니다!", flush=True)
        return

    # 5. 신규/업데이트 문서 필터링
    to_embed, to_update_metadata = filter_documents_to_embed(documents, existing)

    print(f"\n📊 처리 요약:", flush=True)
    print(f"   신규/업데이트 (임베딩 필요): {len(to_embed)}개", flush=True)
    print(f"   메타데이터만 업데이트: {len(to_update_metadata)}개", flush=True)
    print(
        f"   스킵 (변경 없음): {len(documents) - len(to_embed) - len(to_update_metadata)}개",
        flush=True,
    )

    # 6. 메타데이터만 업데이트
    update_metadata_only(supabase, to_update_metadata)

    # 7. 임베딩 생성 및 저장
    embed_and_store(supabase, to_embed, batch_size=args.batch_size)

    # 8. 검증
    verify_embeddings(supabase)

    print("\n" + "=" * 60, flush=True)
    print("✅ 완료!", flush=True)
    print("=" * 60, flush=True)


if __name__ == "__main__":
    main()
