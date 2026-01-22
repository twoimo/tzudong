#!/usr/bin/env python3
"""
YouTube 가장 많이 본 장면(heatmap) 프레임 캡셔닝 스크립트

frames/{video_id}/{recollect_id}/{순번}_{시작초}_{끝초}/*.jpg 디렉터리 구조에서
프레임들을 읽어 LLaVA-NeXT-Video 모델로 캡셔닝하고,
frame-caption/{video_id}.jsonl로 저장합니다.

저장 형식 (JSONL):
- 각 줄: {"video_id": ..., "recollect_id": ..., "rank": ..., "start_sec": ..., "end_sec": ..., "frames": [...], "caption": ...}

사용법:
    python 06-frame-caption.py --youtuber tzuyang
    python 06-frame-caption.py --youtuber tzuyang --model llava-hf/LLaVA-NeXT-Video-7B-hf
"""

import json
import os
import re
import glob
import argparse
from pathlib import Path
from tqdm import tqdm
from PIL import Image
import torch
from transformers import (
    LlavaNextVideoProcessor,
    LlavaNextVideoForConditionalGeneration,
)

# 경로 설정
SCRIPT_DIR = Path(__file__).parent.resolve()


def get_device() -> str:
    """디바이스 자동 감지 (우선순위: cuda > mps > cpu)"""
    if torch.cuda.is_available():
        return "cuda"
    elif torch.backends.mps.is_available():
        return "mps"
    else:
        return "cpu"


def parse_segment_folder(folder_name: str) -> dict | None:
    """
    폴더명에서 순번, 시작초, 끝초 파싱
    예: "1_351_383" -> {"rank": 1, "start_sec": 351, "end_sec": 383}
    """
    match = re.match(r"^(\d+)_(\d+)_(\d+)$", folder_name)
    if match:
        return {
            "rank": int(match.group(1)),
            "start_sec": int(match.group(2)),
            "end_sec": int(match.group(3)),
        }
    return None


def load_frames_from_segment(segment_path: Path) -> list[Image.Image]:
    """
    세그먼트 폴더에서 모든 jpg 프레임 로드 (시간순 정렬)
    """
    frame_files = sorted(segment_path.glob("*.jpg"), key=lambda x: int(x.stem))
    frames = []
    for f in frame_files:
        try:
            img = Image.open(f).convert("RGB")
            frames.append(img)
        except Exception as e:
            print(f"⚠️ 프레임 로드 실패 {f}: {e}")
    return frames


def get_frame_paths(segment_path: Path) -> list[str]:
    """세그먼트 폴더 내 프레임 경로 목록 반환"""
    frame_files = sorted(segment_path.glob("*.jpg"), key=lambda x: int(x.stem))
    return [str(f) for f in frame_files]


def load_model(model_id: str, device: str = None):
    """
    LLaVA-NeXT-Video 모델 및 프로세서 로드
    MPS/CUDA/CPU 자동 감지
    """
    if device is None:
        device = get_device()

    print(f"🚀 모델 로딩 중: {model_id}")
    print(f"📱 디바이스: {device}")

    processor = LlavaNextVideoProcessor.from_pretrained(model_id)

    # MPS는 float16 부분 지원 (M3 Pro 18GB 이상 권장)
    # CPU 모드는 float32 사용 (느리지만 안정적)
    if device == "mps":
        model = LlavaNextVideoForConditionalGeneration.from_pretrained(
            model_id,
            torch_dtype=torch.float16,
            low_cpu_mem_usage=True,
        ).to(device)
    elif device == "cuda":
        # CUDA: float16 사용 (device_map 자동)
        model = LlavaNextVideoForConditionalGeneration.from_pretrained(
            model_id,
            torch_dtype=torch.float16,
            device_map="auto",
        )
    else:
        # CPU 폴백 (float32)
        model = LlavaNextVideoForConditionalGeneration.from_pretrained(
            model_id,
            torch_dtype=torch.float32,
            low_cpu_mem_usage=True,
        )

    print(f"✅ 모델 로드 완료 ({device})")
    return model, processor


def generate_caption(
    model,
    processor,
    frames: list[Image.Image],
    prompt: str = "이 장면은 어떤 상황인지 한국어로 간결하게 설명해주세요.",
) -> str:
    """
    프레임들을 기반으로 캡션 생성
    """
    # 대화 형식 구성
    conversation = [
        {
            "role": "user",
            "content": [
                {"type": "video"},
                {"type": "text", "text": prompt},
            ],
        },
    ]

    # 프롬프트 적용
    formatted_prompt = processor.apply_chat_template(
        conversation, add_generation_prompt=True
    )

    # 입력 처리 (프레임들을 비디오로 처리)
    inputs = processor(
        text=formatted_prompt,
        videos=[frames],  # 프레임 리스트를 비디오로 전달
        return_tensors="pt",
        padding=True,
    ).to(model.device)

    # 생성
    with torch.no_grad():
        output_ids = model.generate(
            **inputs,
            max_new_tokens=256,
            do_sample=True,
            temperature=0.7,
        )

    # 디코딩
    generated_text = processor.batch_decode(
        output_ids, skip_special_tokens=True, clean_up_tokenization_spaces=True
    )[0]

    # 프롬프트 부분 제거 (모델 출력만 추출)
    # LLaVA-NeXT-Video는 보통 assistant 응답 부분만 반환
    return generated_text.strip()


def get_existing_segments(caption_path: Path) -> set[tuple]:
    """
    이미 캡셔닝된 세그먼트 (recollect_id, rank) 튜플 집합 반환
    """
    existing = set()
    if caption_path.exists():
        with open(caption_path, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    data = json.loads(line)
                    existing.add((data["recollect_id"], data["rank"]))
    return existing


def process_video_frames(
    video_id: str,
    frames_dir: Path,
    output_dir: Path,
    model,
    processor,
    prompt: str,
):
    """
    단일 video_id의 모든 세그먼트 처리
    """
    video_frames_path = frames_dir / video_id
    if not video_frames_path.exists():
        print(f"⚠️ 프레임 디렉토리 없음: {video_frames_path}")
        return 0

    output_dir.mkdir(parents=True, exist_ok=True)
    caption_path = output_dir / f"{video_id}.jsonl"

    # 이미 처리된 세그먼트 확인
    existing_segments = get_existing_segments(caption_path)

    processed_count = 0

    # recollect_id 폴더들 순회
    for recollect_folder in sorted(video_frames_path.iterdir()):
        if not recollect_folder.is_dir():
            continue

        try:
            recollect_id = int(recollect_folder.name)
        except ValueError:
            continue

        # 세그먼트 폴더들 순회 (순번_시작초_끝초)
        for segment_folder in sorted(recollect_folder.iterdir()):
            if not segment_folder.is_dir():
                continue

            segment_info = parse_segment_folder(segment_folder.name)
            if not segment_info:
                print(f"⚠️ 잘못된 세그먼트 폴더명: {segment_folder.name}")
                continue

            rank = segment_info["rank"]

            # 이미 처리된 세그먼트는 스킵
            if (recollect_id, rank) in existing_segments:
                print(
                    f"⏭️ 스킵 {video_id}/{recollect_id}/{segment_folder.name} (이미 처리됨)"
                )
                continue

            # 프레임 로드
            frames = load_frames_from_segment(segment_folder)
            if not frames:
                print(f"⚠️ 프레임 없음: {segment_folder}")
                continue

            frame_paths = get_frame_paths(segment_folder)

            print(
                f"📸 처리 중 {video_id}/{recollect_id}/{segment_folder.name} ({len(frames)}개 프레임)"
            )

            # 캡션 생성
            try:
                caption = generate_caption(model, processor, frames, prompt)
                print(f"   💬 캡션: {caption[:100]}...")
            except Exception as e:
                print(f"❌ 캡션 생성 실패: {e}")
                caption = ""

            # 결과 저장
            result = {
                "video_id": video_id,
                "recollect_id": recollect_id,
                "rank": rank,
                "start_sec": segment_info["start_sec"],
                "end_sec": segment_info["end_sec"],
                "frames": frame_paths,
                "caption": caption,
            }

            with open(caption_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(result, ensure_ascii=False) + "\n")

            processed_count += 1

    return processed_count


def main():
    parser = argparse.ArgumentParser(
        description="Generate captions for most-viewed scene frames using LLaVA-NeXT-Video"
    )
    parser.add_argument(
        "--youtuber",
        type=str,
        default="tzuyang",
        help="YouTuber folder name (default: tzuyang)",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="llava-hf/LLaVA-NeXT-Video-7B-hf",
        help="HuggingFace model ID",
    )
    parser.add_argument(
        "--prompt",
        type=str,
        default="이 음식 영상 장면에서 무엇이 보이는지 한국어로 간결하게 설명해주세요. 음식, 장소, 상황을 포함해 주세요.",
        help="Caption generation prompt",
    )
    parser.add_argument(
        "--device",
        type=str,
        default="cuda",
        help="Device (cuda or cpu)",
    )
    parser.add_argument(
        "--video_id",
        type=str,
        help="Specific video ID to process (optional)",
    )
    args = parser.parse_args()

    # 경로 설정
    data_dir = SCRIPT_DIR / f"../data/{args.youtuber}"
    frames_dir = data_dir / "frames"
    output_dir = data_dir / "frame-caption"

    if not frames_dir.exists():
        print(f"❌ Frames directory not found: {frames_dir}")
        return

    # 모델 로드
    model, processor = load_model(args.model, args.device)

    # video_id 폴더 목록
    if args.video_id:
        video_ids = [args.video_id]
        if not (frames_dir / args.video_id).exists():
            print(f"❌ Video directory not found: {frames_dir / args.video_id}")
            return
    else:
        video_ids = [
            d.name
            for d in sorted(frames_dir.iterdir())
            if d.is_dir() and d.name != ".DS_Store"
        ]

    print(f"\n{'='*60}")
    print(f"{len(video_ids)}개 비디오 폴더 발견: {frames_dir}")
    print(f"모델: {args.model}")
    print(f"출력 경로: {output_dir}")
    print(f"{'='*60}\n")

    total_processed = 0

    for video_id in tqdm(video_ids, desc="Processing videos"):
        count = process_video_frames(
            video_id=video_id,
            frames_dir=frames_dir,
            output_dir=output_dir,
            model=model,
            processor=processor,
            prompt=args.prompt,
        )
        total_processed += count

    print(f"\n{'='*60}")
    print(f"✅ 완료: {total_processed}개 세그먼트 처리")
    print(f"📁 저장 경로: {output_dir}")


if __name__ == "__main__":
    main()
