#!/usr/bin/env python3
"""
자막 문서 임베딩 생성 및 Supabase pgvector 저장

BGE-M3 모델을 사용하여 임베딩을 생성하고
Supabase의 pgvector에 저장합니다.

기능:
- 신규 문서만 임베딩 생성 (video_id + recollect_id 비교)
- 모든 문서의 metadata.restaurants 최신화 (DB에서 음식점 조회)
- 업데이트된 문서 (recollect_id 증가) 재임베딩

사용법:
    python 03-bge-embed-and-store-supabase.py
    python 03-bge-embed-and-store-supabase.py --batch-size 50
"""

import json
import os
import sys
import re

# 출력 버퍼링 비활성화 (즉시 출력) - 최상단 배치
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

print("🚀 프로그램 초기화 중... (1/2)", flush=True)
import subprocess
import argparse
from pathlib import Path
from collections import defaultdict
from datetime import datetime
from tqdm import tqdm
from supabase import create_client, Client
from dotenv import load_dotenv

# 무거운 라이브러리는 메시지 출력 후 로딩
print("🚀 라이브러리(Torch/BGE) 로딩 중... (2/2)", flush=True)
from FlagEmbedding import BGEM3FlagModel
import torch


# .env 로드
load_dotenv()

# Embedding Model 설정 (BGE-M3)
EMBEDDING_MODEL = "BAAI/bge-m3"
EMBEDDING_DIMENSION = 1024

# Supabase 설정 (Lazy Load)
SUPABASE_URL = os.getenv("PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")


# 경로 설정
SCRIPT_DIR = Path(__file__).parent.resolve()
INPUT_DIR = (
    SCRIPT_DIR / "../../restaurant-crawling/data/tzuyang/transcript-document-with-meta"
)


# 전역 변수 초기화 (즉시 로딩)
print("🚀 BGE-M3 모델 로딩 중...", flush=True)

device = "cpu"
if torch.backends.mps.is_available():
    device = "mps"
elif torch.cuda.is_available():
    device = "cuda"

print(f"🚀 Using device: {device}", flush=True)

# use_fp16=True: 메모리 절약 및 속도 향상
bge_model = BGEM3FlagModel(EMBEDDING_MODEL, use_fp16=True, device=device)


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


def fetch_data_from_git(branch: str, target_path: Path):
    """지정된 브랜치에서 데이터 폴더를 체크아웃"""
    print(f"📥 '{branch}' 브랜치에서 데이터 가져오는 중...", flush=True)

    # git root 찾기 (단순히 현재 스크립트의 상위 경로들을 탐색하거나, 실행 위치 가정)
    # 여기서는 SCRIPT_DIR 기준으로 상대 경로를 계산해서 git 명령어를 실행합니다.
    # target_path는 절대 경로이므로, git 명령어 실행 시에는 repo root 기준 상대 경로가 필요하거나
    # git cwd를 설정해야 합니다.

    try:
        # 1. Repo Root 찾기 (git rev-parse --show-toplevel)
        repo_root = (
            subprocess.check_output(
                ["git", "rev-parse", "--show-toplevel"], stderr=subprocess.STDOUT
            )
            .decode()
            .strip()
        )

        # 2. target_path를 Repo Root 기준 상대 경로로 변환
        rel_path = target_path.relative_to(repo_root)

        # 3. git checkout 실행
        subprocess.run(
            ["git", "checkout", branch, "--", str(rel_path)],
            cwd=repo_root,
            check=True,
            capture_output=True,
        )
        print(f"✅ 데이터 체크아웃 완료: {rel_path}", flush=True)

    except subprocess.CalledProcessError as e:
        print(
            f"⚠️ 데이터 가져오기 실패: {e.output.decode() if e.output else str(e)}",
            flush=True,
        )
        # 실패하더라도 일단 진행 (로컬 데이터 사용)하거나 종료할 수 있음.
        # 여기서는 경고만 하고 진행.
    except Exception as e:
        print(f"⚠️ 데이터 가져오기 중 오류: {e}", flush=True)


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
            supabase.table("transcript_embeddings_bge")
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


def get_embeddings(texts: list[str]) -> tuple[list[list[float]], list[dict]]:
    """
    BGE-M3 모델로 Dense + Sparse 임베딩 생성

    Returns:
        (dense_vecs, sparse_vecs) 튜플
        dense_vecs: 1024차원 벡터 리스트
        sparse_vecs: {token_id: weight} 딕셔너리 리스트
    """
    bge_encoded = bge_model.encode(texts, return_dense=True, return_sparse=True)

    dense_vecs = [vec.tolist() for vec in bge_encoded["dense_vecs"]]
    sparse_vecs = []

    for sparse in bge_encoded["lexical_weights"]:
        # {token_id: weight} 형태로 변환 (JSON 직렬화 가능하게)
        sparse_dict = {str(k): float(v) for k, v in sparse.items()}
        sparse_vecs.append(sparse_dict)

    return dense_vecs, sparse_vecs


def load_documents():
    """문서 로드 (이미 메타데이터에 음식점 정보 포함됨)"""
    print("📥 문서 로드 중...", flush=True)

    documents = []

    if not INPUT_DIR.exists():
        print(f"❌ 입력 디렉토리 없음: {INPUT_DIR}", flush=True)
        return documents

    input_files = list(INPUT_DIR.glob("*.jsonl"))

    for input_file in tqdm(input_files, desc="파일 로드"):
        video_id = input_file.stem

        with open(input_file, "r", encoding="utf-8") as f:
            for line in f:
                try:
                    docs = json.loads(line.strip())

                    if isinstance(docs, list):
                        for doc in docs:
                            metadata = doc.get("metadata", {})

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

    for i in tqdm(
        range(0, len(documents), batch_size),
        desc="메타데이터 업데이트",
    ):
        batch = documents[i : i + batch_size]

        for doc in batch:
            try:
                supabase.table("transcript_embeddings_bge").update(
                    {
                        "metadata": doc["metadata"],
                        "updated_at": datetime.now().isoformat(),
                    }
                ).eq("video_id", doc["video_id"]).eq(
                    "chunk_index", doc["chunk_index"]
                ).eq(
                    "recollect_id", doc["recollect_id"]
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
        range(0, len(documents), batch_size),
        desc="임베딩",
        total=total_batches,
    ):
        batch = documents[i : i + batch_size]

        try:
            # 1. 임베딩 생성 (Dense + Sparse)
            texts = [doc["page_content"] for doc in batch]
            dense_vecs, sparse_vecs = get_embeddings(texts)

            # 2. Supabase에 저장
            records = []
            for doc, dense_emb, sparse_emb in zip(batch, dense_vecs, sparse_vecs):
                records.append(
                    {
                        "video_id": doc["video_id"],
                        "chunk_index": doc["chunk_index"],
                        "recollect_id": doc["recollect_id"],
                        "page_content": doc["page_content"],
                        "embedding": dense_emb,
                        "sparse_embedding": sparse_emb,  # Sparse 임베딩 추가
                        "metadata": doc["metadata"],
                    }
                )

            # upsert로 중복 처리 (버전별 저장)
            supabase.table("transcript_embeddings_bge").upsert(
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
    result = (
        supabase.table("transcript_embeddings_bge")
        .select("id", count="exact")
        .execute()
    )
    count = result.count
    print(f"  총 임베딩: {count}개", flush=True)

    # 샘플 데이터 확인
    sample = (
        supabase.table("transcript_embeddings_bge")
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

    # 3. 기존 임베딩 조회
    try:
        existing = get_existing_embeddings(supabase)
    except Exception:
        print(
            "⚠️ 기존 테이블 조회 실패(아마도 첫 실행). 빈 상태로 시작합니다.", flush=True
        )
        existing = {}

    # 3.5. 데이터 브랜치에서 데이터 가져오기 (코드 레벨에서 강제)
    fetch_data_from_git("data", INPUT_DIR)

    # 4. 문서 로드
    documents = load_documents()

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
