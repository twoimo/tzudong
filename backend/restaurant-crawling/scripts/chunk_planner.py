#!/usr/bin/env python3
"""
영상 길이 기반 적응형 청크 계획 생성기

Gemini 비디오 분석에 최적화된 시간 기반 청크로 영상을 분할합니다.
자막 세그먼트 경계에 정렬하여 문장이 중간에 끊기지 않도록 합니다.

사용법:
    python chunk_planner.py --video-id VIDEO_ID --duration SECONDS --transcript-file PATH

출력 (stdout JSON):
    [{"chunk_index": 0, "start_sec": 0.0, "end_sec": 180.0, "transcript_text": "..."}, ...]
"""

import json
import sys
import argparse
from pathlib import Path
from typing import List

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
from utils.chunk_utils import format_time, Segment


def compute_chunk_duration(total_duration: float) -> float:
    """영상 길이에 따른 적응형 청크 크기 반환 (초 단위)

    Gemini API 1.5/3.1 (Context Window 1M+ 토큰) 스펙에 맞추어
    최대 30분(1800초) 단위로 청크를 크게 가져갑니다.
    대부분의 영상은 이보다 작으므로 1개의 청크로 처리되어 RPD를 크게 아낍니다.
    """
    if total_duration <= 1800:
        return total_duration
    elif total_duration <= 3600:
        return 1800
    else:
        return 1800



def align_to_subtitle_boundary(
    target_sec: float, segments: List[Segment], tolerance: float = 10.0
) -> float:
    """목표 시간을 가장 가까운 자막 세그먼트 시작점에 정렬"""
    if not segments:
        return target_sec

    within_tolerance = [
        seg["start"] for seg in segments
        if abs(seg["start"] - target_sec) <= tolerance
    ]
    if not within_tolerance:
        return target_sec

    return min(within_tolerance, key=lambda s: abs(s - target_sec))


def format_transcript_range(
    segments: List[Segment], start_sec: float, end_sec: float
) -> str:
    """시간 범위 내 자막을 [MM:SS] 형식 텍스트로 변환"""
    lines = []
    for seg in segments:
        seg_start = seg["start"]
        if seg_start >= end_sec:
            break
        if seg_start < start_sec:
            seg_dur = seg.get("duration")
            if not seg_dur or seg_start + seg_dur <= start_sec:
                continue
        lines.append(f"[{format_time(seg_start)}] {seg['text']}")
    return "\n".join(lines)


def plan_chunks(
    video_id: str, duration: float, segments: List[Segment], overlap_sec: float = 10.0
) -> List[dict]:
    """영상을 자막 경계에 맞춰 청크 목록으로 분할하며 앞뒤 문맥 연결을 위해 오버랩을 둡니다."""
    chunk_sec = compute_chunk_duration(duration)

    if chunk_sec >= duration:
        return [
            {
                "chunk_index": 0,
                "start_sec": 0.0,
                "end_sec": round(duration, 1),
                "transcript_text": format_transcript_range(segments, 0.0, duration),
            }
        ]

    chunks = []
    current_start = 0.0
    chunk_index = 0

    while current_start < duration:
        raw_end = min(current_start + chunk_sec + overlap_sec, duration)

        if 0 < duration - raw_end < 30:
            raw_end = duration

        aligned_end = (
            align_to_subtitle_boundary(raw_end, segments)
            if raw_end < duration
            else duration
        )

        if aligned_end <= current_start:
            aligned_end = raw_end

        chunks.append(
            {
                "chunk_index": chunk_index,
                "start_sec": round(current_start, 1),
                "end_sec": round(aligned_end, 1),
                "transcript_text": format_transcript_range(
                    segments, current_start, aligned_end
                ),
            }
        )

        # 오버랩을 위해 다음 청크의 시작 지점을 현재 청크 끝에서 overlap_sec 만큼 뒤로 당깁니다.
        next_start = aligned_end - overlap_sec
        current_start = max(current_start + 1.0, next_start)
        
        # 만약 다음 시작점이 duration과 너무 가깝다면 루프 종료
        if duration - current_start < 10:
            break

        chunk_index += 1

    return chunks


def load_transcript_segments(transcript_file: Path) -> List[Segment]:
    """자막 JSONL 파일의 마지막 줄에서 세그먼트 목록을 로드"""
    if not transcript_file.exists():
        return []

    with open(transcript_file, "r", encoding="utf-8") as f:
        lines = f.readlines()

    if not lines:
        return []

    data = json.loads(lines[-1])
    raw_segments = data.get("transcript", [])

    return [
        Segment(
            start=float(raw.get("start", 0)),
            duration=(
                float(raw["duration"])
                if raw.get("duration") is not None
                else None
            ),
            text=raw.get("text", ""),
        )
        for raw in raw_segments
    ]


def main():
    parser = argparse.ArgumentParser(
        description="적응형 영상 청크 계획 생성기"
    )
    parser.add_argument("--video-id", required=True, help="영상 ID")
    parser.add_argument(
        "--duration", required=True, type=float, help="영상 길이 (초)"
    )
    parser.add_argument(
        "--transcript-file", required=True, help="자막 JSONL 파일 경로"
    )
    parser.add_argument(
        "--output", default=None, help="출력 파일 경로 (기본값: stdout)"
    )
    args = parser.parse_args()

    segments = load_transcript_segments(Path(args.transcript_file))
    chunks = plan_chunks(args.video_id, args.duration, segments)

    if args.output:
        Path(args.output).parent.mkdir(parents=True, exist_ok=True)
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(chunks, f, ensure_ascii=False)
    else:
        json.dump(chunks, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
