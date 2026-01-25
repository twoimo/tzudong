#!/usr/bin/env python3
"""
자막 문서에 음식점 정보 추가

Docker PostgreSQL에서 approved 음식점을 조회하여
자막 문서의 metadata에 restaurants 키로 추가합니다.

사용법:
    python 01-add-restaurants-to-documents.py
"""

import json
import os
import re
from pathlib import Path
from collections import defaultdict
import os
import re
from pathlib import Path
from collections import defaultdict
from supabase import create_client, Client
from dotenv import load_dotenv

# .env 로드
load_dotenv()

# Supabase 설정
SUPABASE_URL = os.getenv("PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

# 경로 설정
SCRIPT_DIR = Path(__file__).parent.resolve()
INPUT_DIR = (
    SCRIPT_DIR
    / "../../restaurant-crawling/data/tzuyang/transcript-document-with-context"
)
OUTPUT_DIR = SCRIPT_DIR / "../data/tzuyang/documents-with-restaurants"


def extract_video_id_from_youtube_link(youtube_link: str) -> str | None:
    """YouTube 링크에서 video_id 추출"""
    if not youtube_link:
        return None

    # https://www.youtube.com/watch?v=VIDEO_ID 형식
    match = re.search(r"[?&]v=([a-zA-Z0-9_-]+)", youtube_link)
    if match:
        return match.group(1)

    # https://youtu.be/VIDEO_ID 형식
    match = re.search(r"youtu\.be/([a-zA-Z0-9_-]+)", youtube_link)
    if match:
        return match.group(1)

    return None


def get_restaurants_by_video_id(supabase: Client) -> dict[str, list[dict]]:
    """
    Supabase에서 approved 음식점을 video_id별로 그룹화하여 반환

    Returns:
        {video_id: [{"origin_name": "...", "approved_name": "..."}, ...]}
    """
    print("📥 Supabase에서 음식점 조회 중...")

    # approved 상태인 음식점만 조회
    result = (
        supabase.table("restaurants")
        .select("youtube_link, origin_name, approved_name")
        .eq("status", "approved")
        .not_.is_("youtube_link", "null")
        .execute()
    )

    rows = result.data
    print(f"  총 {len(rows)}개 approved 음식점 조회됨")

    # video_id별로 그룹화
    video_restaurants = defaultdict(list)

    for row in rows:
        video_id = extract_video_id_from_youtube_link(row["youtube_link"])
        if video_id:
            video_restaurants[video_id].append(
                {
                    "origin_name": row["origin_name"],
                    "approved_name": row["approved_name"],
                }
            )

    # 딕셔너리로 변환하여 반환
    print(f"  {len(video_restaurants)}개 video_id에 음식점 매핑됨")
    return dict(video_restaurants)


def process_documents(video_restaurants: dict[str, list[dict]]):
    """자막 문서에 음식점 정보 추가"""
    print("\n📝 자막 문서 처리 중...")

    # 출력 디렉토리 생성
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    if not INPUT_DIR.exists():
        print(f"❌ 입력 디렉토리 없음: {INPUT_DIR}")
        return

    input_files = list(INPUT_DIR.glob("*.jsonl"))
    print(f"  입력 파일: {len(input_files)}개")

    stats = {
        "total_files": 0,
        "total_docs": 0,
        "docs_with_restaurants": 0,
        "docs_without_restaurants": 0,
    }

    for input_file in input_files:
        video_id = input_file.stem  # 파일명에서 video_id 추출
        stats["total_files"] += 1

        # 해당 video_id의 음식점 목록
        restaurants = video_restaurants.get(video_id, [])

        # 음식점 이름 리스트 (approved_name 우선, 없으면 origin_name)
        restaurant_names = []
        for r in restaurants:
            name = r.get("approved_name") or r.get("origin_name")
            if name and name not in restaurant_names:
                restaurant_names.append(name)

        # 입력 파일 읽기
        output_file = OUTPUT_DIR / input_file.name

        with open(input_file, "r", encoding="utf-8") as f_in, open(
            output_file, "w", encoding="utf-8"
        ) as f_out:

            for line in f_in:
                try:
                    # 한 줄에 Document 리스트가 있는 형태
                    docs = json.loads(line.strip())

                    if isinstance(docs, list):
                        # 각 문서의 metadata에 restaurants 추가
                        for doc in docs:
                            if "metadata" not in doc:
                                doc["metadata"] = {}
                            doc["metadata"]["restaurants"] = restaurant_names
                            stats["total_docs"] += 1

                            if restaurant_names:
                                stats["docs_with_restaurants"] += 1
                            else:
                                stats["docs_without_restaurants"] += 1

                        f_out.write(json.dumps(docs, ensure_ascii=False) + "\n")
                    else:
                        # 단일 문서인 경우
                        if "metadata" not in docs:
                            docs["metadata"] = {}
                        docs["metadata"]["restaurants"] = restaurant_names
                        stats["total_docs"] += 1

                        if restaurant_names:
                            stats["docs_with_restaurants"] += 1
                        else:
                            stats["docs_without_restaurants"] += 1

                        f_out.write(json.dumps(docs, ensure_ascii=False) + "\n")

                except json.JSONDecodeError:
                    continue

        if stats["total_files"] % 100 == 0:
            print(f"    처리 진행: {stats['total_files']}개 파일")

    print(f"\n✅ 처리 완료!")
    print(f"   총 파일: {stats['total_files']}개")
    print(f"   총 문서: {stats['total_docs']}개")
    print(f"   음식점 있는 문서: {stats['docs_with_restaurants']}개")
    print(f"   음식점 없는 문서: {stats['docs_without_restaurants']}개")
    print(f"   출력 경로: {OUTPUT_DIR}")


def verify_output():
    """출력 결과 검증"""
    print("\n🔍 결과 검증...")

    sample_files = list(OUTPUT_DIR.glob("*.jsonl"))[:3]

    for f in sample_files:
        with open(f, "r", encoding="utf-8") as file:
            line = file.readline()
            if line:
                docs = json.loads(line.strip())
                if isinstance(docs, list) and len(docs) > 0:
                    doc = docs[0]
                    restaurants = doc.get("metadata", {}).get("restaurants", [])
                    print(f"  {f.name}: {len(restaurants)}개 음식점")
                    if restaurants:
                        print(f"    → {restaurants[:3]}...")


def main():
    print("=" * 60)
    print("자막 문서에 음식점 정보 추가 (Supabase)")
    print("=" * 60)

    # 1. Supabase 연결
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("❌ SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 없습니다")
        return

    print(f"\n🔌 Supabase 연결: {SUPABASE_URL}")
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    print("✅ 연결 성공")

    # 2. 음식점 조회
    video_restaurants = get_restaurants_by_video_id(supabase)

    # 3. 문서 처리
    process_documents(video_restaurants)

    # 4. 검증
    verify_output()

    print("\n" + "=" * 60)
    print("✅ 완료!")
    print("=" * 60)


if __name__ == "__main__":
    main()
