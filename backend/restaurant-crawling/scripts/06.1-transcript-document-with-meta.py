#!/usr/bin/env python3
"""
자막 문서에 음식점 정보 + Peak 메타데이터 추가

1. Supabase에서 approved 음식점 조회 → documents에 restaurants 필드 추가
2. Heatmap 데이터 기반 → is_peak, peak_score 메타데이터 추가

입력: transcript-document-with-context/{video_id}.jsonl
출력: transcript-document-with-meta/{video_id}.jsonl

사용법:
    python 06.1-transcript-document-with-meta.py
    python 06.1-transcript-document-with-meta.py --channel tzuyang
"""

import json
import os
import re
import argparse
from pathlib import Path
from collections import defaultdict
from tqdm import tqdm
from supabase import create_client, Client
from dotenv import load_dotenv

# .env 로드
load_dotenv()

# Supabase 설정
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

# 경로 설정
SCRIPT_DIR = Path(__file__).parent.resolve()


def get_paths(channel: str) -> tuple[Path, Path, Path]:
    """채널별 경로 반환"""
    input_dir = SCRIPT_DIR / f"../data/{channel}/transcript-document-with-context"
    output_dir = SCRIPT_DIR / f"../data/{channel}/transcript-documents-with-meta"
    heatmap_dir = SCRIPT_DIR / f"../data/{channel}/heatmap"
    return input_dir.resolve(), output_dir.resolve(), heatmap_dir.resolve()


# =============================================================================
# 1. 음식점 정보 관련 함수 (Supabase)
# =============================================================================


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


def get_restaurants_by_video_id(supabase: Client) -> dict[str, list[str]]:
    """
    Supabase에서 approved 음식점을 video_id별로 그룹화하여 반환
    approved_name만 사용 (origin_name 제외)

    Returns:
        {video_id: ["음식점명1", "음식점명2", ...]}
    """
    print("📥 Supabase에서 음식점 조회 중...")

    # approved 상태인 음식점만 조회
    result = (
        supabase.table("restaurants")
        .select("youtube_link, approved_name")
        .eq("status", "approved")
        .not_.is_("youtube_link", "null")
        .not_.is_("approved_name", "null")
        .execute()
    )

    rows = result.data
    print(f"  총 {len(rows)}개 approved 음식점 조회됨")

    # video_id별로 그룹화 (approved_name만)
    video_restaurants = defaultdict(list)

    for row in rows:
        video_id = extract_video_id_from_youtube_link(row["youtube_link"])
        approved_name = row.get("approved_name")
        if video_id and approved_name:
            # 중복 방지
            if approved_name not in video_restaurants[video_id]:
                video_restaurants[video_id].append(approved_name)

    print(f"  {len(video_restaurants)}개 video_id에 음식점 매핑됨")
    return dict(video_restaurants)


# =============================================================================
# 2. Peak 메타데이터 관련 함수 (Heatmap)
# =============================================================================


def load_heatmap_by_recollect_id(heatmap_path: Path) -> dict[int, dict]:
    """
    Heatmap JSONL 파일에서 recollect_id별로 데이터 로드

    Returns:
        {recollect_id: heatmap_data} 딕셔너리
    """
    if not heatmap_path.exists():
        return {}

    heatmap_by_id = {}

    try:
        with open(heatmap_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue

                try:
                    data = json.loads(line)

                    # 성공 상태이고 interaction_data가 있는 경우만
                    if data.get("status") == "success" and data.get("interaction_data"):
                        recollect_id = data.get("recollect_id", 0)
                        heatmap_by_id[recollect_id] = data
                except json.JSONDecodeError:
                    continue

        return heatmap_by_id
    except IOError as e:
        print(f"⚠️ Heatmap 로드 실패 {heatmap_path.name}: {e}")
        return {}


def find_interest_segments(most_replayed_markers: list[dict] | None) -> list[dict]:
    """
    "가장 많이 다시 본 장면" 구간 식별
    YouTube의 timedMarkerDecorations에서 명시적으로 지정된 구간만 사용
    """
    if not most_replayed_markers:
        return []

    segments = []

    for marker in most_replayed_markers:
        start_millis = marker.get("startMillis", 0)
        end_millis = marker.get("endMillis", 0)
        peak_millis = marker.get("peakMillis", start_millis)

        start_sec = int(start_millis / 1000)
        end_sec = int(end_millis / 1000) + 1
        peak_sec = peak_millis / 1000

        segments.append(
            {
                "start_sec": start_sec,
                "end_sec": end_sec,
                "peak_sec": peak_sec,
                "peak_intensity": 1.0,
            }
        )

    segments.sort(key=lambda x: x["start_sec"])
    return segments


def check_overlap_with_peak_segments(
    doc_start: float | None,
    doc_end: float | None,
    peak_segments: list[dict],
) -> tuple[bool, float]:
    """문서 구간이 피크 세그먼트와 겹치는지 확인"""
    if doc_start is None or doc_end is None:
        return False, 0.0

    if not peak_segments:
        return False, 0.0

    max_intensity = 0.0
    is_overlapping = False

    for seg in peak_segments:
        seg_start = seg["start_sec"]
        seg_end = seg["end_sec"]

        if doc_end > seg_start and doc_start < seg_end:
            is_overlapping = True
            if seg["peak_intensity"] > max_intensity:
                max_intensity = seg["peak_intensity"]

    return is_overlapping, max_intensity


def get_heatmap_for_doc(
    doc_recollect_id: int,
    doc_duration: float | None,
    heatmap_by_id: dict[int, dict],
) -> tuple[dict | None, int | None]:
    """
    문서의 recollect_id와 매칭되는 heatmap 찾기

    로직:
    - recollect_id >= doc_recollect_id인 모든 히트맵 중
    - duration이 같은 가장 최신(큰 recollect_id) 데이터 사용
    - duration이 같은 한 계속 업데이트됨
    """
    if not doc_duration:
        # duration 정보가 없으면 정확히 일치하는 recollect_id만 사용
        heatmap_data = heatmap_by_id.get(doc_recollect_id)
        if heatmap_data:
            return heatmap_data, doc_recollect_id
        return None, None

    # recollect_id >= doc_recollect_id인 것들 중 duration이 같은 가장 최신 것 찾기
    sorted_recollect_ids = sorted(
        [rid for rid in heatmap_by_id.keys() if rid >= doc_recollect_id],
        reverse=True,  # 큰 것부터 (최신부터)
    )

    for rid in sorted_recollect_ids:
        candidate_data = heatmap_by_id[rid]
        candidate_duration = candidate_data.get("duration")

        if candidate_duration == doc_duration:
            # duration이 같은 가장 최신 것 발견
            return candidate_data, rid

    return None, None


# =============================================================================
# 3. 중복 검사 함수
# =============================================================================


def get_processed_recollect_ids(output_file: Path) -> set[int]:
    """
    출력 파일에서 이미 처리된 recollect_id 목록 반환
    """
    if not output_file.exists():
        return set()

    processed_ids = set()

    try:
        with open(output_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue

                try:
                    docs = json.loads(line)
                    if isinstance(docs, list) and docs:
                        recollect_id = docs[0].get("metadata", {}).get("recollect_id")
                        if recollect_id is not None:
                            processed_ids.add(recollect_id)
                    elif isinstance(docs, dict):
                        recollect_id = docs.get("metadata", {}).get("recollect_id")
                        if recollect_id is not None:
                            processed_ids.add(recollect_id)
                except json.JSONDecodeError:
                    continue
    except IOError:
        pass

    return processed_ids


# =============================================================================
# 4. 메인 처리 로직
# =============================================================================


def process_documents(
    input_dir: Path,
    output_dir: Path,
    heatmap_dir: Path,
    video_restaurants: dict[str, list[str]],
) -> dict:
    """문서에 음식점 정보 + Peak 메타데이터 추가"""
    print("\n📝 문서 처리 중...")

    output_dir.mkdir(parents=True, exist_ok=True)

    if not input_dir.exists():
        print(f"❌ 입력 디렉토리 없음: {input_dir}")
        return {}

    input_files = list(input_dir.glob("*.jsonl"))
    print(f"  입력 파일: {len(input_files)}개")

    stats = {
        "total_files": 0,
        "processed_files": 0,
        "skipped_files": 0,
        "total_docs": 0,
        "docs_with_restaurants": 0,
        "peak_docs": 0,
        "non_peak_docs": 0,
    }

    for input_file in tqdm(input_files, desc="문서 처리"):
        video_id = input_file.stem
        stats["total_files"] += 1

        output_file = output_dir / input_file.name

        # 중복 검사: 이미 처리된 recollect_id 확인
        processed_ids = get_processed_recollect_ids(output_file)

        # 음식점 정보 (approved_name만)
        restaurant_names = video_restaurants.get(video_id, [])

        # Heatmap 로드
        heatmap_path = heatmap_dir / f"{video_id}.jsonl"
        heatmap_by_id = load_heatmap_by_recollect_id(heatmap_path)

        # 입력 파일 읽기
        new_docs_to_write = []
        file_processed = False

        try:
            with open(input_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue

                    try:
                        docs = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    # 배열인 경우
                    if isinstance(docs, list):
                        if not docs:
                            continue

                        # recollect_id 추출
                        first_metadata = docs[0].get("metadata", {})
                        doc_recollect_id = first_metadata.get("recollect_id", 0)

                        # 이미 처리됨 → 스킵
                        if doc_recollect_id in processed_ids:
                            continue

                        file_processed = True
                        doc_duration = first_metadata.get("duration")

                        # Heatmap 찾기
                        heatmap_data, matched_heatmap_id = get_heatmap_for_doc(
                            doc_recollect_id, doc_duration, heatmap_by_id
                        )

                        # Peak 세그먼트 찾기
                        peak_segments = []
                        if heatmap_data:
                            most_replayed_markers = heatmap_data.get(
                                "most_replayed_markers", []
                            )
                            peak_segments = find_interest_segments(
                                most_replayed_markers
                            )

                        # 각 문서에 메타데이터 추가
                        for doc in docs:
                            metadata = doc.get("metadata", {})

                            # 음식점 추가
                            metadata["restaurants"] = restaurant_names
                            if restaurant_names:
                                stats["docs_with_restaurants"] += 1

                            # Peak 메타데이터 추가
                            start_time = metadata.get("start_time")
                            end_time = metadata.get("end_time")

                            is_peak, peak_score = check_overlap_with_peak_segments(
                                start_time, end_time, peak_segments
                            )

                            metadata["is_peak"] = is_peak
                            metadata["peak_score"] = round(peak_score, 4)
                            metadata["matched_heatmap_recollect_id"] = (
                                matched_heatmap_id
                            )

                            doc["metadata"] = metadata
                            stats["total_docs"] += 1

                            if is_peak:
                                stats["peak_docs"] += 1
                            else:
                                stats["non_peak_docs"] += 1

                        new_docs_to_write.append(docs)

                    else:
                        # 단일 문서
                        metadata = docs.get("metadata", {})
                        doc_recollect_id = metadata.get("recollect_id", 0)

                        if doc_recollect_id in processed_ids:
                            continue

                        file_processed = True
                        doc_duration = metadata.get("duration")

                        # Heatmap 찾기
                        heatmap_data, matched_heatmap_id = get_heatmap_for_doc(
                            doc_recollect_id, doc_duration, heatmap_by_id
                        )

                        # Peak 세그먼트 찾기
                        peak_segments = []
                        if heatmap_data:
                            most_replayed_markers = heatmap_data.get(
                                "most_replayed_markers", []
                            )
                            peak_segments = find_interest_segments(
                                most_replayed_markers
                            )

                        # 음식점 추가
                        metadata["restaurants"] = restaurant_names
                        if restaurant_names:
                            stats["docs_with_restaurants"] += 1

                        # Peak 메타데이터 추가
                        start_time = metadata.get("start_time")
                        end_time = metadata.get("end_time")

                        is_peak, peak_score = check_overlap_with_peak_segments(
                            start_time, end_time, peak_segments
                        )

                        metadata["is_peak"] = is_peak
                        metadata["peak_score"] = round(peak_score, 4)
                        metadata["matched_heatmap_recollect_id"] = matched_heatmap_id

                        docs["metadata"] = metadata
                        stats["total_docs"] += 1

                        if is_peak:
                            stats["peak_docs"] += 1
                        else:
                            stats["non_peak_docs"] += 1

                        new_docs_to_write.append(docs)

        except IOError as e:
            print(f"⚠️ 파일 읽기 실패 {input_file.name}: {e}")
            continue

        # 새로운 문서가 있으면 append 모드로 저장
        if new_docs_to_write:
            try:
                with open(output_file, "a", encoding="utf-8") as f:
                    for doc in new_docs_to_write:
                        f.write(json.dumps(doc, ensure_ascii=False) + "\n")
                stats["processed_files"] += 1
            except IOError as e:
                print(f"⚠️ 파일 저장 실패 {output_file.name}: {e}")
        elif not file_processed:
            stats["skipped_files"] += 1

    return stats


def verify_output(output_dir: Path, sample_count: int = 3):
    """출력 결과 검증"""
    print("\n🔍 결과 검증...")

    sample_files = list(output_dir.glob("*.jsonl"))[:sample_count]

    for f in sample_files:
        with open(f, "r", encoding="utf-8") as file:
            line = file.readline()
            if line:
                docs = json.loads(line.strip())
                if isinstance(docs, list) and len(docs) > 0:
                    doc = docs[0]
                    metadata = doc.get("metadata", {})
                    restaurants = metadata.get("restaurants", [])
                    is_peak = metadata.get("is_peak")
                    print(f"  {f.name}:")
                    print(f"    restaurants: {restaurants[:3]}...")
                    print(f"    is_peak: {is_peak}")


def main():
    parser = argparse.ArgumentParser(
        description="자막 문서에 음식점 정보 + Peak 메타데이터 추가"
    )
    parser.add_argument("--channel", type=str, default="tzuyang", help="채널명")
    args = parser.parse_args()

    print("=" * 60)
    print("자막 문서에 메타데이터 추가 (음식점 + Peak)")
    print(f"채널: {args.channel}")
    print("=" * 60)

    # 1. Supabase 연결
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("❌ SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 없습니다")
        print("CI/CD 모드: Supabase 미설정으로 인해 작업을 건너뜁니다.")
        return

    print(f"\n🔌 Supabase 연결: {SUPABASE_URL}")
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    print("✅ 연결 성공")

    # 2. 음식점 조회
    video_restaurants = get_restaurants_by_video_id(supabase)

    # 3. 경로 설정
    input_dir, output_dir, heatmap_dir = get_paths(args.channel)
    print(f"\n📂 입력: {input_dir}")
    print(f"📂 출력: {output_dir}")
    print(f"📂 Heatmap: {heatmap_dir}")

    # 4. 문서 처리
    stats = process_documents(input_dir, output_dir, heatmap_dir, video_restaurants)

    # 5. 결과 출력
    print("\n" + "=" * 60)
    print("📊 처리 결과:")
    print(f"   총 파일: {stats.get('total_files', 0)}개")
    print(f"   처리 완료: {stats.get('processed_files', 0)}개")
    print(f"   스킵 (이미 처리됨): {stats.get('skipped_files', 0)}개")
    print(f"   총 문서: {stats.get('total_docs', 0)}개")
    print(f"   음식점 있는 문서: {stats.get('docs_with_restaurants', 0)}개")
    total_docs = max(stats.get("total_docs", 1), 1)
    peak_docs = stats.get("peak_docs", 0)
    print(f"   Peak 문서: {peak_docs}개 ({peak_docs / total_docs * 100:.1f}%)")
    print(f"   Non-Peak 문서: {stats.get('non_peak_docs', 0)}개")
    print("=" * 60)

    # 6. 검증
    verify_output(output_dir)

    print("\n✅ 완료!")


if __name__ == "__main__":
    main()
