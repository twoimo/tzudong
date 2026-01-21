#!/usr/bin/env python3
"""
자막 문서 임베딩 생성 및 pgvector 저장

OpenAI text-embedding-3-small 모델을 사용하여 임베딩을 생성하고
Docker PostgreSQL의 pgvector에 저장합니다.

기능:
- 신규 문서만 임베딩 생성 (video_id + recollect_id 비교)
- 모든 문서의 metadata.restaurants 최신화 (DB에서 음식점 조회)
- 업데이트된 문서 (recollect_id 증가) 재임베딩

사용법:
    python 02-embed-and-store-pgvector.py
    python 02-embed-and-store-pgvector.py --batch-size 100
"""

import json
import os
import re
import argparse
from pathlib import Path
from collections import defaultdict
from tqdm import tqdm
import psycopg2
from psycopg2.extras import Json, execute_values, RealDictCursor
from openai import OpenAI
from dotenv import load_dotenv

# .env 로드
load_dotenv()

# OpenAI 설정
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSION = 1536

# 로컬 PostgreSQL 설정
LOCAL_DB = {
    "host": "localhost",
    "port": 5432,
    "database": "tzudong",
    "user": "postgres",
    "password": "password",
}

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


def create_embeddings_table(conn):
    """임베딩 테이블 생성 (없으면)"""
    cursor = conn.cursor()

    # pgvector 확장 활성화
    cursor.execute("CREATE EXTENSION IF NOT EXISTS vector;")

    # 테이블 존재 여부 확인
    cursor.execute(
        """
        SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = 'document_embeddings'
        );
    """
    )
    exists = cursor.fetchone()[0]

    if not exists:
        print("🔧 임베딩 테이블 생성 중...")
        cursor.execute(
            f"""
            CREATE TABLE document_embeddings (
                id SERIAL PRIMARY KEY,
                video_id TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                recollect_id INTEGER NOT NULL DEFAULT 0,
                page_content TEXT NOT NULL,
                embedding vector({EMBEDDING_DIMENSION}),
                metadata JSONB DEFAULT '{{}}',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                
                UNIQUE (video_id, chunk_index)
            );
        """
        )
        cursor.execute(
            "CREATE INDEX idx_embeddings_video_id ON document_embeddings(video_id);"
        )
        cursor.execute(
            "CREATE INDEX idx_embeddings_recollect ON document_embeddings(video_id, recollect_id);"
        )
        conn.commit()
        print("✅ 테이블 생성 완료")
    else:
        print("✅ 임베딩 테이블 이미 존재")

    conn.commit()


def get_restaurants_by_video_id(conn) -> dict[str, list[str]]:
    """DB에서 approved 음식점을 video_id별로 조회"""
    print("📥 DB에서 음식점 조회 중...")

    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute(
        """
        SELECT youtube_link, origin_name, approved_name
        FROM restaurants 
        WHERE status = 'approved' AND youtube_link IS NOT NULL
    """
    )

    rows = cursor.fetchall()

    video_restaurants = defaultdict(list)
    for row in rows:
        video_id = extract_video_id_from_youtube_link(row["youtube_link"])
        if video_id:
            name = row.get("approved_name") or row.get("origin_name")
            if name and name not in video_restaurants[video_id]:
                video_restaurants[video_id].append(name)

    print(f"  {len(video_restaurants)}개 video_id에 음식점 매핑됨")
    return dict(video_restaurants)


def get_existing_embeddings(conn) -> dict[tuple, dict]:
    """
    기존 임베딩의 (video_id, chunk_index) → {recollect_id} 맵 반환
    """
    print("📥 기존 임베딩 조회 중...")

    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT video_id, chunk_index, recollect_id FROM document_embeddings
    """
    )

    existing = {}
    for video_id, chunk_index, recollect_id in cursor.fetchall():
        existing[(video_id, chunk_index)] = {"recollect_id": recollect_id}

    print(f"  기존 임베딩: {len(existing)}개")
    return existing


def get_embeddings(texts: list[str]) -> list[list[float]]:
    """OpenAI API로 임베딩 생성"""
    response = client.embeddings.create(model=EMBEDDING_MODEL, input=texts)
    return [item.embedding for item in response.data]


def load_documents(video_restaurants: dict[str, list[str]]):
    """문서 로드 및 음식점 정보 추가"""
    print("📥 문서 로드 중...")

    documents = []

    if not INPUT_DIR.exists():
        print(f"❌ 입력 디렉토리 없음: {INPUT_DIR}")
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
                            metadata["restaurants"] = restaurants  # 최신 음식점 정보

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

    print(f"✅ {len(documents)}개 문서 로드됨")
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
            # 신규 문서 → 임베딩 필요
            to_embed.append(doc)
        elif doc["recollect_id"] > existing[key]["recollect_id"]:
            # recollect_id 증가 → 재임베딩 필요
            to_embed.append(doc)
        else:
            # 동일 recollect_id → 메타데이터만 업데이트
            to_update_metadata.append(doc)

    return to_embed, to_update_metadata


def update_metadata_only(conn, documents: list[dict]):
    """메타데이터만 업데이트 (임베딩 재생성 없이)"""
    if not documents:
        return

    print(f"\n📝 메타데이터 업데이트 중: {len(documents)}개")

    cursor = conn.cursor()

    for i, doc in enumerate(tqdm(documents, desc="메타데이터 업데이트")):
        try:
            cursor.execute(
                """
                UPDATE document_embeddings 
                SET metadata = %s, updated_at = NOW()
                WHERE video_id = %s AND chunk_index = %s
            """,
                (Json(doc["metadata"]), doc["video_id"], doc["chunk_index"]),
            )

            if (i + 1) % 500 == 0:
                conn.commit()
        except Exception as e:
            print(f"⚠️ 메타데이터 업데이트 실패: {e}")

    conn.commit()
    print(f"✅ 메타데이터 업데이트 완료")


def embed_and_store(conn, documents: list[dict], batch_size: int = 100):
    """임베딩 생성 및 저장"""
    if not documents:
        print("\n📝 임베딩할 문서 없음 (모두 최신 상태)")
        return

    print(f"\n📝 임베딩 생성 및 저장 중: {len(documents)}개 (배치 크기: {batch_size})")

    cursor = conn.cursor()
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

            # 2. DB에 저장
            values = []
            for doc, embedding in zip(batch, embeddings):
                values.append(
                    (
                        doc["video_id"],
                        doc["chunk_index"],
                        doc["recollect_id"],
                        doc["page_content"],
                        embedding,
                        Json(doc["metadata"]),
                    )
                )

            execute_values(
                cursor,
                """
                INSERT INTO document_embeddings 
                    (video_id, chunk_index, recollect_id, page_content, embedding, metadata)
                VALUES %s
                ON CONFLICT (video_id, chunk_index) DO UPDATE SET
                    recollect_id = EXCLUDED.recollect_id,
                    page_content = EXCLUDED.page_content,
                    embedding = EXCLUDED.embedding,
                    metadata = EXCLUDED.metadata,
                    updated_at = NOW()
                """,
                values,
                template="(%s, %s, %s, %s, %s::vector, %s)",
            )

            conn.commit()
            inserted += len(batch)

        except Exception as e:
            print(f"\n⚠️ 배치 오류: {e}")
            errors += len(batch)
            conn.rollback()

    print(f"\n✅ 임베딩 완료: {inserted}개 성공, {errors}개 실패")


def verify_embeddings(conn):
    """임베딩 검증"""
    print("\n🔍 임베딩 검증...")

    cursor = conn.cursor()

    # 총 개수
    cursor.execute("SELECT COUNT(*) FROM document_embeddings;")
    count = cursor.fetchone()[0]
    print(f"  총 임베딩: {count}개")

    # 음식점 있는 문서 수
    cursor.execute(
        """
        SELECT COUNT(*) FROM document_embeddings 
        WHERE metadata->'restaurants' IS NOT NULL 
        AND jsonb_array_length(metadata->'restaurants') > 0
    """
    )
    with_restaurants = cursor.fetchone()[0]
    print(f"  음식점 있는 문서: {with_restaurants}개")

    # 샘플 유사도 검색 테스트
    if count > 0:
        print("\n  🔎 유사도 검색 테스트: '짜장면 맛집'")

        test_embedding = get_embeddings(["짜장면 맛집"])[0]

        cursor.execute(
            """
            SELECT video_id, page_content, 
                   1 - (embedding <=> %s::vector) as similarity,
                   metadata->'restaurants' as restaurants
            FROM document_embeddings
            ORDER BY embedding <=> %s::vector
            LIMIT 3
        """,
            (test_embedding, test_embedding),
        )

        results = cursor.fetchall()
        for vid, content, sim, restaurants in results:
            print(f"    [{sim:.3f}] {vid}")
            print(f"      내용: {content[:80]}...")
            print(f"      음식점: {restaurants}")


def main():
    parser = argparse.ArgumentParser(description="문서 임베딩 및 pgvector 저장")
    parser.add_argument("--batch-size", type=int, default=100, help="배치 크기")
    args = parser.parse_args()

    print("=" * 60)
    print("문서 임베딩 및 pgvector 저장")
    print(f"모델: {EMBEDDING_MODEL} ({EMBEDDING_DIMENSION}차원)")
    print("=" * 60)

    # 1. PostgreSQL 연결
    print("\n🔌 Docker PostgreSQL 연결 중...")
    conn = psycopg2.connect(**LOCAL_DB)
    print("✅ 연결 성공")

    try:
        # 2. 테이블 생성 (없으면)
        create_embeddings_table(conn)

        # 3. 음식점 정보 조회 (매번 최신화)
        video_restaurants = get_restaurants_by_video_id(conn)

        # 4. 기존 임베딩 조회
        existing = get_existing_embeddings(conn)

        # 5. 문서 로드 (음식점 정보 포함)
        documents = load_documents(video_restaurants)

        if not documents:
            print("❌ 문서가 없습니다!")
            return

        # 6. 신규/업데이트 문서 필터링
        to_embed, to_update_metadata = filter_documents_to_embed(documents, existing)

        print(f"\n📊 처리 요약:")
        print(f"   신규/업데이트 (임베딩 필요): {len(to_embed)}개")
        print(f"   메타데이터만 업데이트: {len(to_update_metadata)}개")
        print(
            f"   스킵 (변경 없음): {len(documents) - len(to_embed) - len(to_update_metadata)}개"
        )

        # 7. 메타데이터만 업데이트
        update_metadata_only(conn, to_update_metadata)

        # 8. 임베딩 생성 및 저장
        embed_and_store(conn, to_embed, batch_size=args.batch_size)

        # 9. 검증
        verify_embeddings(conn)

        print("\n" + "=" * 60)
        print("✅ 완료!")
        print("=" * 60)

    finally:
        conn.close()


if __name__ == "__main__":
    main()
