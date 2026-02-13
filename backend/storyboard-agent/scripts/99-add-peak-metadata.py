#!/usr/bin/env python3
"""
문서에 is_peak 메타데이터 추가

Heatmap 데이터를 기반으로 각 문서 구간이 Peak인지 판단합니다.
Peak 기준: 해당 구간의 평균 intensityScoreNormalized가 상위 20% 이상

사용법:
    python 02-add-peak-metadata.py
    python 02-add-peak-metadata.py --channel tzuyang
"""

import json
import argparse
from pathlib import Path
from tqdm import tqdm


# 경로 설정
SCRIPT_DIR = Path(__file__).parent.resolve()
BASE_DIR = SCRIPT_DIR / ".."


def get_paths(channel: str) -> tuple[Path, Path]:
    """채널별 경로 반환"""
    docs_dir = BASE_DIR / f"data/{channel}/documents-with-restaurants"
    heatmap_dir = SCRIPT_DIR / f"../../restaurant-crawling/data/{channel}/heatmap"
    return docs_dir.resolve(), heatmap_dir.resolve()


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

    Args:
        most_replayed_markers: heatmap 데이터의 most_replayed_markers 배열
                              각 마커: { startMillis, endMillis, peakMillis, label }

    Returns:
        세그먼트 배열: [{ 'start_sec', 'end_sec', 'peak_sec', 'peak_intensity' }, ...]
    """
    if not most_replayed_markers:
        return []

    segments = []

    for marker in most_replayed_markers:
        start_millis = marker.get("startMillis", 0)
        end_millis = marker.get("endMillis", 0)
        peak_millis = marker.get("peakMillis", start_millis)

        start_sec = int(start_millis / 1000)  # Math.floor
        end_sec = int(end_millis / 1000) + 1  # Math.ceil
        peak_sec = peak_millis / 1000

        segments.append(
            {
                "start_sec": start_sec,
                "end_sec": end_sec,
                "peak_sec": peak_sec,
                "peak_intensity": 1.0,  # 명시적 마커는 최고 강도로 간주
            }
        )

    # 시작 시간 기준 정렬
    segments.sort(key=lambda x: x["start_sec"])

    return segments


def check_overlap_with_peak_segments(
    doc_start: float | None,
    doc_end: float | None,
    peak_segments: list[dict],
) -> tuple[bool, float]:
    """
    문서 구간이 피크 세그먼트와 겹치는지 확인

    Args:
        doc_start: 문서 시작 시간 (초)
        doc_end: 문서 종료 시간 (초)
        peak_segments: find_interest_segments에서 반환된 세그먼트 배열

    Returns:
        (is_peak, max_peak_intensity): 겹치면 True와 가장 높은 peak_intensity
    """
    if doc_start is None or doc_end is None:
        return False, 0.0

    if not peak_segments:
        return False, 0.0

    max_intensity = 0.0
    is_overlapping = False

    for seg in peak_segments:
        seg_start = seg["start_sec"]
        seg_end = seg["end_sec"]

        # 구간이 겹치는지 확인
        if doc_end > seg_start and doc_start < seg_end:
            is_overlapping = True
            if seg["peak_intensity"] > max_intensity:
                max_intensity = seg["peak_intensity"]

    return is_overlapping, max_intensity


def add_peak_metadata_to_documents(docs_dir: Path, heatmap_dir: Path) -> dict:
    """
    모든 문서에 is_peak, peak_score 메타데이터 추가
    문서의 recollect_id와 매칭되는 heatmap 데이터를 사용

    Returns:
        처리 통계
    """
    stats = {
        "total_files": 0,
        "processed_files": 0,
        "skipped_no_heatmap": 0,
        "skipped_no_matching_recollect": 0,
        "total_docs": 0,
        "peak_docs": 0,
        "non_peak_docs": 0,
    }

    if not docs_dir.exists():
        print(f"❌ 문서 디렉토리 없음: {docs_dir}")
        return stats

    doc_files = list(docs_dir.glob("*.jsonl"))
    stats["total_files"] = len(doc_files)

    print(f"📁 문서 파일: {len(doc_files)}개")
    print(f"📁 Heatmap 디렉토리: {heatmap_dir}")

    for doc_file in tqdm(doc_files, desc="문서 처리"):
        video_id = doc_file.stem
        heatmap_path = heatmap_dir / f"{video_id}.jsonl"

        # Heatmap을 recollect_id별로 로드
        heatmap_by_id = load_heatmap_by_recollect_id(heatmap_path)
        if not heatmap_by_id:
            stats["skipped_no_heatmap"] += 1
            continue

        # 문서 읽기 및 처리
        updated_docs = []
        file_has_matching_heatmap = False

        try:
            with open(doc_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue

                    docs = json.loads(line)

                    # 배열인 경우 (한 줄에 여러 문서)
                    if isinstance(docs, list):
                        if not docs:
                            updated_docs.append(docs)
                            continue

                        # 첫 번째 문서에서 recollect_id 추출
                        first_metadata = docs[0].get("metadata", {})
                        doc_recollect_id = first_metadata.get("recollect_id", 0)

                        # 해당 recollect_id의 heatmap 찾기
                        heatmap_data = heatmap_by_id.get(doc_recollect_id)
                        matched_recollect_id = (
                            doc_recollect_id if heatmap_data else None
                        )

                        # fallback 로직: 매칭되는 heatmap이 없으면 duration이 같은 *가장 최신(recollect_id가 큰)* 히트맵 찾기
                        if not heatmap_data:
                            # 문서의 duration 확인 (첫 번째 문서 기준)
                            doc_duration = docs[0].get("metadata", {}).get("duration")

                            if doc_duration:
                                # heatmap_by_id 키(recollect_id)를 정렬하여 doc_recollect_id보다 큰 것들 탐색
                                sorted_recollect_ids = sorted(
                                    [
                                        rid
                                        for rid in heatmap_by_id.keys()
                                        if rid > doc_recollect_id
                                    ]
                                )

                                for rid in sorted_recollect_ids:
                                    candidate_data = heatmap_by_id[rid]
                                    candidate_duration = candidate_data.get("duration")

                                    # duration이 같으면 후보로 채택하고 계속 탐색 (더 큰 ID가 있을 수 있으므로)
                                    if candidate_duration == doc_duration:
                                        heatmap_data = candidate_data
                                        matched_recollect_id = rid

                                    # duration이 달라지는 순간, 그 이후는 다른 버전이므로 탐색 중단
                                    elif (
                                        candidate_duration is not None
                                        and candidate_duration != doc_duration
                                    ):
                                        break

                        # (로그용) Fallback 매칭 확인
                        # if matched_recollect_id and matched_recollect_id != doc_recollect_id:
                        #     print(f"  ↪️ Fallback 매칭 ({video_id}): doc={doc_recollect_id} -> heatmap={matched_recollect_id}")

                        if not heatmap_data:
                            # 여전히 매칭되는 heatmap이 없으면 기본값 설정
                            for doc in docs:
                                metadata = doc.get("metadata", {})
                                metadata["is_peak"] = False
                                metadata["peak_score"] = 0.0
                                metadata["matched_heatmap_recollect_id"] = None
                                doc["metadata"] = metadata
                                stats["total_docs"] += 1
                                stats["non_peak_docs"] += 1
                            updated_docs.append(docs)
                            continue

                        file_has_matching_heatmap = True
                        most_replayed_markers = heatmap_data.get(
                            "most_replayed_markers", []
                        )

                        # 피크 세그먼트 찾기 (most_replayed_markers 기반)
                        peak_segments = find_interest_segments(most_replayed_markers)

                        for doc in docs:
                            metadata = doc.get("metadata", {})
                            start_time = metadata.get("start_time")
                            end_time = metadata.get("end_time")

                            # 문서 구간이 피크 세그먼트와 겹치는지 확인
                            is_peak, peak_score = check_overlap_with_peak_segments(
                                start_time, end_time, peak_segments
                            )

                            metadata["is_peak"] = is_peak
                            metadata["peak_score"] = round(peak_score, 4)
                            metadata["matched_heatmap_recollect_id"] = (
                                matched_recollect_id
                            )
                            doc["metadata"] = metadata

                            stats["total_docs"] += 1
                            if is_peak:
                                stats["peak_docs"] += 1
                            else:
                                stats["non_peak_docs"] += 1

                        updated_docs.append(docs)
                    else:
                        # 단일 문서
                        metadata = docs.get("metadata", {})
                        doc_recollect_id = metadata.get("recollect_id", 0)

                        # 해당 recollect_id의 heatmap 찾기
                        heatmap_data = heatmap_by_id.get(doc_recollect_id)
                        matched_recollect_id = (
                            doc_recollect_id if heatmap_data else None
                        )

                        # fallback 로직 (단일 문서)
                        if not heatmap_data:
                            doc_duration = metadata.get("duration")
                            if doc_duration:
                                sorted_recollect_ids = sorted(
                                    [
                                        rid
                                        for rid in heatmap_by_id.keys()
                                        if rid > doc_recollect_id
                                    ]
                                )
                                for rid in sorted_recollect_ids:
                                    candidate_data = heatmap_by_id[rid]
                                    candidate_duration = candidate_data.get("duration")

                                    # duration이 같으면 후보로 채택 (더 최신 것이 있으면 덮어씀)
                                    if candidate_duration == doc_duration:
                                        heatmap_data = candidate_data
                                        matched_recollect_id = rid

                                    # duration 달라지면 중단
                                    elif (
                                        candidate_duration is not None
                                        and candidate_duration != doc_duration
                                    ):
                                        break

                        if not heatmap_data:
                            metadata["is_peak"] = False
                            metadata["peak_score"] = 0.0
                            metadata["matched_heatmap_recollect_id"] = None
                            docs["metadata"] = metadata
                            stats["total_docs"] += 1
                            stats["non_peak_docs"] += 1
                            updated_docs.append(docs)
                            continue

                        file_has_matching_heatmap = True
                        most_replayed_markers = heatmap_data.get(
                            "most_replayed_markers", []
                        )

                        # 피크 세그먼트 찾기
                        peak_segments = find_interest_segments(most_replayed_markers)

                        start_time = metadata.get("start_time")
                        end_time = metadata.get("end_time")

                        # 문서 구간이 피크 세그먼트와 겹치는지 확인
                        is_peak, peak_score = check_overlap_with_peak_segments(
                            start_time, end_time, peak_segments
                        )

                        metadata["is_peak"] = is_peak
                        metadata["peak_score"] = round(peak_score, 4)
                        metadata["matched_heatmap_recollect_id"] = matched_recollect_id
                        docs["metadata"] = metadata

                        stats["total_docs"] += 1
                        if is_peak:
                            stats["peak_docs"] += 1
                        else:
                            stats["non_peak_docs"] += 1

                        updated_docs.append(docs)

        except (json.JSONDecodeError, IOError) as e:
            print(f"⚠️ 문서 읽기 실패 {doc_file.name}: {e}")
            continue

        if not file_has_matching_heatmap:
            stats["skipped_no_matching_recollect"] += 1

        # 문서 덮어쓰기
        try:
            with open(doc_file, "w", encoding="utf-8") as f:
                for doc in updated_docs:
                    f.write(json.dumps(doc, ensure_ascii=False) + "\n")
            stats["processed_files"] += 1
        except IOError as e:
            print(f"⚠️ 문서 저장 실패 {doc_file.name}: {e}")

    return stats


def verify_results(docs_dir: Path, sample_count: int = 3):
    """결과 검증: 샘플 문서 확인"""
    print("\n🔍 결과 검증...")

    doc_files = list(docs_dir.glob("*.jsonl"))
    if not doc_files:
        print("❌ 문서 파일 없음")
        return

    # 샘플 파일 선택
    import random

    sample_files = random.sample(doc_files, min(sample_count, len(doc_files)))

    for doc_file in sample_files:
        print(f"\n📄 {doc_file.name}:")
        try:
            with open(doc_file, "r", encoding="utf-8") as f:
                lines = f.readlines()
                if lines:
                    first_doc = json.loads(lines[0].strip())
                    if isinstance(first_doc, list):
                        first_doc = first_doc[0] if first_doc else {}

                    metadata = first_doc.get("metadata", {})
                    print(f"   is_peak: {metadata.get('is_peak')}")
                    print(f"   peak_score: {metadata.get('peak_score')}")
                    print(f"   start_time: {metadata.get('start_time')}")
                    print(f"   end_time: {metadata.get('end_time')}")
        except Exception as e:
            print(f"   ⚠️ 읽기 실패: {e}")


def main():
    parser = argparse.ArgumentParser(description="문서에 is_peak 메타데이터 추가")
    parser.add_argument("--channel", type=str, default="tzuyang", help="채널명")
    args = parser.parse_args()

    print("=" * 60)
    print("문서 Peak 메타데이터 추가")
    print(f"채널: {args.channel}")
    print("기준: intensityScoreNormalized 상위 20% (80th percentile)")
    print("=" * 60)

    docs_dir, heatmap_dir = get_paths(args.channel)

    print(f"\n📂 문서 디렉토리: {docs_dir}")
    print(f"📂 Heatmap 디렉토리: {heatmap_dir}")

    # Peak 메타데이터 추가
    stats = add_peak_metadata_to_documents(docs_dir, heatmap_dir)

    # 결과 출력
    print("\n" + "=" * 60)
    print("📊 처리 결과:")
    print(f"   총 파일: {stats['total_files']}개")
    print(f"   처리 완료: {stats['processed_files']}개")
    print(f"   Heatmap 없음: {stats['skipped_no_heatmap']}개")
    print(f"   recollect_id 미매칭: {stats['skipped_no_matching_recollect']}개")
    print(f"   총 문서: {stats['total_docs']}개")
    print(
        f"   Peak 문서: {stats['peak_docs']}개 ({stats['peak_docs'] / max(stats['total_docs'], 1) * 100:.1f}%)"
    )
    print(f"   Non-Peak 문서: {stats['non_peak_docs']}개")
    print("=" * 60)

    # 검증
    verify_results(docs_dir)

    print("\n✅ 완료!")


if __name__ == "__main__":
    main()
