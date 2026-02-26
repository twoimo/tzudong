"""
YouTube 자막 청크 생성 유틸리티

입력 (Input):
    segments: list[Segment]
        - start: float      # 시작 시간 (초)
        - duration: float   # 지속 시간 (초), None일 수 있음
        - text: str         # 자막 텍스트

출력 (Output):
    chunks: list[Chunk]
        - chunk_index: int       # 청크 순서 (0부터)
        - segments: list         # 포함된 세그먼트들
        - content: str           # "[MM:SS : MM:SS] text" 형식 (duration 없으면 "[MM:SS] text")
        - char_count: int        # 글자 수
        - prev_overlap: str      # 이전 청크에서 가져온 오버랩
        - next_overlap: str      # 다음 청크에서 가져온 오버랩

청크 생성 규칙:
    - 한국어: 300-500자 (최대 620자까지 허용), 오버랩 70-110자(\\n 기준) 또는 80자
    - 기타: 500-700자 (최대 850자까지 허용), 오버랩 90-130자(\\n 기준) 또는 110자
    - 세그먼트는 원자 단위로 유지 (분할 불가)

사용법:
    from utils.chunk_utils import create_chunks_with_overlap
    chunks = create_chunks_with_overlap(segments)
"""

import re
from typing import TypedDict


class Segment(TypedDict):
    start: float
    duration: float
    text: str


class Chunk(TypedDict):
    chunk_index: int
    segments: list[Segment]
    content: str  # 포맷팅된 텍스트
    char_count: int
    prev_overlap: str
    next_overlap: str
    start_time: float  # 청크 시작 시간 (초)
    end_time: (
        float | None
    )  # 청크 끝 시간 (초), 마지막 세그먼트 duration이 null이면 None


# 언어별 설정
CHUNK_CONFIG = {
    "korean": {
        "min_chars": 300,
        "max_chars": 500,  # 목표 최대
        "hard_max": 620,  # 절대 최대 (120자 여유)
        "overlap_min": 70,
        "overlap_max": 110,
        "overlap_fallback": 80,
    },
    "other": {
        "min_chars": 500,
        "max_chars": 700,  # 목표 최대
        "hard_max": 850,  # 절대 최대 (150자 여유)
        "overlap_min": 90,
        "overlap_max": 130,
        "overlap_fallback": 110,
    },
}


def format_time(seconds: float) -> str:
    """초를 MM:SS 형식으로 변환"""
    minutes = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{minutes:02d}:{secs:02d}"


def format_segment(segment: Segment) -> str:
    """세그먼트를 [시작 ~ 끝] 텍스트 형식으로 변환. duration이 None이면 [시작]만 표시"""
    start = segment["start"]
    duration = segment.get("duration")

    if duration is None:
        return f"[{format_time(start)}] {segment['text']}"
    else:
        end = start + duration
        return f"[{format_time(start)} ~ {format_time(end)}] {segment['text']}"


def detect_language(text: str) -> str:
    """텍스트에서 한글 비율로 언어 판단 (30% 이상 → 한국어)"""
    if not text:
        return "other"
    korean_chars = len(re.findall(r"[가-힣]", text))
    total_chars = len(re.findall(r"\S", text))  # 공백 제외
    if total_chars == 0:
        return "other"
    korean_ratio = korean_chars / total_chars
    return "korean" if korean_ratio > 0.3 else "other"


def create_initial_chunks(
    segments: list[Segment], max_chars: int
) -> list[list[Segment]]:
    """
    1차 청크 생성: 세그먼트 단위로 병합하여 최대 글자수 이하로 유지
    세그먼트는 분할하지 않음
    """
    chunks: list[list[Segment]] = []
    current_chunk: list[Segment] = []
    current_length = 0

    for segment in segments:
        formatted = format_segment(segment)
        segment_length = len(formatted)

        # 현재 청크에 추가하면 최대 초과 시 새 청크 시작
        if current_length + segment_length > max_chars and current_chunk:
            chunks.append(current_chunk)
            current_chunk = []
            current_length = 0

        current_chunk.append(segment)
        current_length += segment_length

    # 마지막 청크 추가
    if current_chunk:
        chunks.append(current_chunk)

    return chunks


def get_chunk_length(segments: list[Segment]) -> int:
    """청크의 총 글자수 계산"""
    return sum(len(format_segment(seg)) for seg in segments)


def merge_small_chunks(
    chunks: list[list[Segment]], min_chars: int, max_chars: int, hard_max: int = None
) -> list[list[Segment]]:
    """
    반복적 병합: 모든 청크를 순회하며 최소 글자수 미달 청크 처리
    1. 다음 청크와 병합 가능하면 병합 (max_chars 기준)
    2. 안 되면 hard_max까지 허용하여 병합 시도
    3. 마지막 청크면 이전 청크와 병합 시도
    """
    if hard_max is None:
        hard_max = max_chars + 100  # 기본값: 100자 여유

    if len(chunks) <= 1:
        return chunks

    # 변경 여부를 추적하여 무한 루프 방지
    changed = True
    max_iterations = len(chunks) * 3  # 안전장치
    iteration = 0

    while changed and iteration < max_iterations:
        changed = False
        iteration += 1
        result: list[list[Segment]] = []
        skip_next = False

        for i, current in enumerate(chunks):
            if skip_next:
                skip_next = False
                continue

            current_length = get_chunk_length(current)

            # 최소 이상이면 그대로 추가
            if current_length >= min_chars:
                result.append(current)
                continue

            # 최소 미달: 병합 시도
            # 우선순위 1: 다음 청크와 완전 병합 (max_chars 기준)
            if i < len(chunks) - 1:
                next_chunk = chunks[i + 1]
                combined_length = current_length + get_chunk_length(next_chunk)

                if combined_length <= max_chars:
                    result.append(current + next_chunk)
                    skip_next = True
                    changed = True
                    continue

                # 우선순위 2: hard_max까지 허용하여 병합
                if combined_length <= hard_max:
                    result.append(current + next_chunk)
                    skip_next = True
                    changed = True
                    continue

                # 우선순위 3: 다음 청크에서 세그먼트 빌려오기
                if len(next_chunk) > 1:
                    # 하나씩 빌려와서 최소 충족하거나 최대 도달할 때까지
                    borrowed = []
                    remaining_next = list(next_chunk)
                    new_current = list(current)

                    while remaining_next and len(remaining_next) > 1:
                        candidate = remaining_next[0]
                        new_length = get_chunk_length(new_current + [candidate])
                        if new_length <= hard_max:
                            new_current.append(candidate)
                            borrowed.append(candidate)
                            remaining_next = remaining_next[1:]
                            if get_chunk_length(new_current) >= min_chars:
                                break
                        else:
                            break

                    if borrowed:
                        result.append(new_current)
                        chunks[i + 1] = remaining_next  # 다음 청크 업데이트
                        changed = True
                        continue

            # 우선순위 4: 이전 청크와 병합 (result에서)
            if result:
                prev = result[-1]
                combined_length = get_chunk_length(prev) + current_length

                if combined_length <= hard_max:
                    result[-1] = prev + current
                    changed = True
                    continue

                # 이전 청크에서 세그먼트 빌려오기
                if len(prev) > 1:
                    borrowed_from_prev = prev[-1]
                    new_current = [borrowed_from_prev] + list(current)
                    new_length = get_chunk_length(new_current)

                    if new_length <= hard_max:
                        result[-1] = prev[:-1]
                        result.append(new_current)
                        changed = True
                        continue

            # 병합 불가: 그대로 유지 (최소 미달이어도)
            result.append(current)

        chunks = result

    return chunks


def generate_overlap(
    text: str, is_start: bool, overlap_min: int, overlap_max: int, overlap_fallback: int
) -> str:
    """
    오버랩 생성
    - is_start=True: 텍스트 시작 부분에서 오버랩 추출
    - is_start=False: 텍스트 끝 부분에서 오버랩 추출
    - \n 기준으로 min-max 범위 내에서 추출, 없으면 fallback 글자수
    """
    if not text:
        return ""

    if is_start:
        # 텍스트 시작에서 첫 \n 찾기
        lines = text.split("\n")
        overlap = ""
        for line in lines:
            if len(overlap) + len(line) + 1 > overlap_max:
                break
            overlap += line + "\n"
            if len(overlap) >= overlap_min:
                break

        # \n으로 적절한 오버랩을 못 찾으면 fallback
        if len(overlap.strip()) < overlap_min:
            overlap = text[:overlap_fallback]

        return overlap.strip()
    else:
        # 텍스트 끝에서 마지막 \n 찾기
        lines = text.split("\n")
        overlap = ""
        for line in reversed(lines):
            if len(overlap) + len(line) + 1 > overlap_max:
                break
            overlap = line + "\n" + overlap
            if len(overlap) >= overlap_min:
                break

        # \n으로 적절한 오버랩을 못 찾으면 fallback
        if len(overlap.strip()) < overlap_min:
            overlap = text[-overlap_fallback:]

        return overlap.strip()


def calculate_segment_end_time(
    segment: Segment, next_segment: Segment | None = None
) -> float | None:
    """
    세그먼트의 끝 시간 계산
    - duration이 있으면 start + duration
    - duration이 None이면 다음 세그먼트의 start 사용
    - 다음 세그먼트도 없으면 None 반환
    """
    duration = segment.get("duration")
    if duration is not None:
        return segment["start"] + duration
    elif next_segment is not None:
        return next_segment["start"]
    else:
        return None


def create_chunks_with_overlap(
    segments: list[Segment], language: str = None, video_duration: float = None
) -> list[Chunk]:
    """
    전체 청크 생성 파이프라인
    1. 언어 감지 (자동 또는 지정)
    2. 1차 청크 생성
    3. 재귀적 병합
    4. 오버랩 생성
    5. 타임스탬프 계산 (start_time, end_time)

    Args:
        segments: 자막 세그먼트 리스트
        language: 언어 (None이면 자동 감지)
        video_duration: 영상 전체 길이 (초), 마지막 청크 end_time 계산에 사용
    """
    if not segments:
        return []

    # 언어 감지
    all_text = " ".join(seg["text"] for seg in segments)
    if language is None:
        language = detect_language(all_text)

    config = CHUNK_CONFIG[language]

    # 1차 청크 생성
    raw_chunks = create_initial_chunks(segments, config["max_chars"])

    # 재귀적 병합 (hard_max 허용)
    merged_chunks = merge_small_chunks(
        raw_chunks, config["min_chars"], config["max_chars"], config["hard_max"]
    )

    # 청크 객체 생성 및 오버랩 추가
    result: list[Chunk] = []

    for i, chunk_segments in enumerate(merged_chunks):
        content = "\n".join(format_segment(seg) for seg in chunk_segments)

        # 이전 청크에서 오버랩 가져오기
        prev_overlap = ""
        if i > 0:
            prev_content = "\n".join(
                format_segment(seg) for seg in merged_chunks[i - 1]
            )
            prev_overlap = generate_overlap(
                prev_content,
                is_start=False,
                overlap_min=config["overlap_min"],
                overlap_max=config["overlap_max"],
                overlap_fallback=config["overlap_fallback"],
            )

        # 다음 청크에서 오버랩 가져오기
        next_overlap = ""
        if i < len(merged_chunks) - 1:
            next_content = "\n".join(
                format_segment(seg) for seg in merged_chunks[i + 1]
            )
            next_overlap = generate_overlap(
                next_content,
                is_start=True,
                overlap_min=config["overlap_min"],
                overlap_max=config["overlap_max"],
                overlap_fallback=config["overlap_fallback"],
            )

        # 타임스탬프 계산
        start_time = chunk_segments[0]["start"]

        # end_time 계산: 마지막 세그먼트의 끝 시간
        last_seg = chunk_segments[-1]
        # 다음 청크가 있으면 그 첫 세그먼트를 next_segment로 사용
        next_segment = None
        if i < len(merged_chunks) - 1:
            next_segment = merged_chunks[i + 1][0]

        end_time = calculate_segment_end_time(last_seg, next_segment)

        # 마지막 청크이고 end_time이 None이면 video_duration 사용
        if end_time is None and video_duration is not None:
            end_time = video_duration

        result.append(
            Chunk(
                chunk_index=i,
                segments=chunk_segments,
                content=content,
                char_count=len(content),
                prev_overlap=prev_overlap,
                next_overlap=next_overlap,
                start_time=start_time,
                end_time=end_time,
            )
        )

    return result


# 테스트용 함수
def print_chunks(chunks: list[Chunk]) -> None:
    """청크 정보 출력 (테스트용)"""
    for chunk in chunks:
        print(f"\n{'='*60}")
        print(f"Chunk {chunk['chunk_index']} ({chunk['char_count']}자)")
        print(f"{'='*60}")
        if chunk["prev_overlap"]:
            print(f"[이전 오버랩] {chunk['prev_overlap'][:50]}...")
        print(f"\n{chunk['content'][:200]}...")
        if chunk["next_overlap"]:
            print(f"\n[다음 오버랩] {chunk['next_overlap'][:50]}...")
