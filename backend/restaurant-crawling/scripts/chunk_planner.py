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
from typing import List, Optional

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
from utils.chunk_utils import format_time, Segment


def compute_chunk_duration(total_duration: float) -> float:
    """영상 길이에 따른 적응형 청크 크기 (초 단위)

    360p mp4 비트레이트 ~500-1000kbps 기준, Gemini File API 업로드 제한(~20MB) 고려.
    """
    if total_duration <= 180:
        return total_duration
    elif total_duration <= 600:
        return 120
    elif total_duration <= 1200:
        return 180
    elif total_duration <= 2400:
        return 240
    else:
        return 300


def align_to_subtitle_boundary(
    target_sec: float, segments: List[Segment], tolerance: float = 10.0
) -> float:
    """목표 시간을 가장 가까운 자막 세그먼트 시작점에 정렬"""
    if not segments:
        return target_sec

    best = target_sec
    best_dist = tolerance + 1

    for seg in segments:
        dist = abs(seg["start"] - target_sec)
        if dist < best_dist and dist <= tolerance:
            best = seg["start"]
            best_dist = dist

    return best


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
            if seg_dur and seg_start + seg_dur <= start_sec:
                continue
            if not seg_dur:
                continue
        lines.append(f"[{format_time(seg_start)}] {seg['text']}")
    return "\n".join(lines)


def plan_chunks(
    video_id: str, duration: float, segments: List[Segment]
) -> List[dict]:
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
        raw_end = min(current_start + chunk_sec, duration)

        if 0 < duration - raw_end < 30:
            raw_end = duration

        aligned_end = (
            align_to_subtitle_boundary(raw_end, segments)
            if raw_end < duration
            else duration
        )

        if aligned_end <= current_start:
            aligned_end = raw_end

        transcript_text = format_transcript_range(segments, current_start, aligned_end)

        chunks.append(
            {
                "chunk_index": chunk_index,
                "start_sec": round(current_start, 1),
                "end_sec": round(aligned_end, 1),
                "transcript_text": transcript_text,
            }
        )

        current_start = aligned_end
        chunk_index += 1

    return chunks


def load_transcript_segments(transcript_file: Path) -> List[Segment]:
    if not transcript_file.exists():
        return []

    with open(transcript_file, "r", encoding="utf-8") as f:
        lines = f.readlines()

    if not lines:
        return []

    data = json.loads(lines[-1])
    raw_segments = data.get("transcript", [])

    result: List[Segment] = []
    for raw in raw_segments:
        result.append(
            Segment(
                start=float(raw.get("start", 0)),
                duration=(
                    float(raw["duration"])
                    if raw.get("duration") is not None
                    else None
                ),
                text=raw.get("text", ""),
            )
        )
    return result


def main():
    parser = argparse.ArgumentParser(description="Adaptive video chunk planner")
    parser.add_argument("--video-id", required=True)
    parser.add_argument("--duration", required=True, type=float, help="Video duration in seconds")
    parser.add_argument("--transcript-file", required=True, help="Path to transcript JSONL")
    parser.add_argument("--output", default=None, help="Output file path (default: stdout)")
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
