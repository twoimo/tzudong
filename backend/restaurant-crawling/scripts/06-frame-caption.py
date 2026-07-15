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

from __future__ import annotations

import json
import os
import sys

# MPS 메모리 제한 해제 (시스템 메모리 최대한 사용)
os.environ["PYTORCH_MPS_HIGH_WATERMARK_RATIO"] = "0.0"

import re
import argparse
from pathlib import Path
from tqdm import tqdm
from PIL import Image

# Shared backend utilities must be imported through the repository root.
SCRIPT_DIR = Path(__file__).parent.resolve()
BACKEND_ROOT = SCRIPT_DIR.parents[1]
REPO_ROOT = BACKEND_ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.utils.privacy_log import safe_error_name

STORYBOARD_AGENT_SRC = (SCRIPT_DIR / "../../storyboard-agent/src").resolve()
if str(STORYBOARD_AGENT_SRC) not in sys.path:
    sys.path.insert(0, str(STORYBOARD_AGENT_SRC))

from vision_captioning import CaptionRequest, get_provider, resolve_provider_id
from vision_captioning.providers import CaptionProviderError, CaptionProviderUnavailable


BASE_DATA_DIR = SCRIPT_DIR / "../data"


def get_device() -> str:
    """디바이스 자동 감지 (우선순위: cuda > mps > cpu)"""
    import torch

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


def frame_sort_key(path: Path) -> tuple[int, str]:
    """Sort direct legacy numeric frames and nested frame_N files chronologically."""
    match = re.search(r"(\d+)(?!.*\d)", path.stem)
    frame_index = int(match.group(1)) if match else 0
    return (frame_index, str(path))


def list_frame_files(segment_path: Path) -> list[Path]:
    """Return frame files from legacy direct layout or nested quality/format layout."""
    frame_files = [
        *segment_path.rglob("*.webp"),
        *segment_path.rglob("*.jpg"),
        *segment_path.rglob("*.jpeg"),
        *segment_path.rglob("*.png"),
    ]
    return sorted({f.resolve() for f in frame_files if f.is_file()}, key=frame_sort_key)


def load_frames_from_segment(segment_path: Path) -> list[Image.Image]:
    """
    세그먼트 폴더에서 모든 jpg 프레임 로드 (시간순 정렬)
    """
    frame_files = list_frame_files(segment_path)
    frames = []
    for f in frame_files:
        try:
            img = Image.open(f).convert("RGB")
            frames.append(img)
        except Exception as error:
            print(f"op=frame_load_failed error={safe_error_name(error)}")
    return frames


def get_frame_paths(segment_path: Path) -> list[str]:
    """세그먼트 폴더 내 프레임 경로 목록 반환"""
    frame_files = list_frame_files(segment_path)
    return [str(f) for f in frame_files]


def get_duration_from_meta(
    meta_dir: Path, video_id: str, recollect_id: int
) -> int | None:
    """
    메타 파일에서 해당 video_id와 recollect_id에 맞는 duration 조회
    meta/{video_id}.jsonl에서 recollect_id가 일치하는 줄의 duration 반환
    """
    meta_file = meta_dir / f"{video_id}.jsonl"
    if not meta_file.exists():
        return None

    try:
        with open(meta_file, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    data = json.loads(line)
                    if data.get("recollect_id") == recollect_id:
                        return data.get("duration")
    except Exception as error:
        print(f"op=metadata_duration_read_failed error={safe_error_name(error)}")

    return None


def load_model(model_id: str, device: str = None):
    """
    LLaVA-NeXT-Video 모델 및 프로세서 로드
    MPS/CUDA/CPU 자동 감지
    """
    import torch
    from transformers import (
        LlavaNextVideoProcessor,
        LlavaNextVideoForConditionalGeneration,
    )

    if device is None:
        device = get_device()

    print("op=caption_model_loading")

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

    print("op=caption_model_loaded")
    return model, processor


def generate_caption(
    model,
    processor,
    frames: list[Image.Image],
    prompt: str = "이 장면의 촬영 구도와 상황(누가, 무엇을, 어떻게)을 한국어로 자세하게 설명해주세요.",
) -> str:
    """
    프레임들을 기반으로 캡션 생성
    """
    import torch

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
    ).to(model.device, dtype=torch.float16)

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
    meta_dir: Path,
    caption_provider,
    prompt: str,
):
    """
    단일 video_id의 모든 세그먼트 처리
    """
    video_frames_path = frames_dir / video_id
    if not video_frames_path.exists():
        print("op=frame_directory_missing")
        return 0

    output_dir.mkdir(parents=True, exist_ok=True)
    caption_path = output_dir / f"{video_id}.jsonl"

    # 이미 처리된 세그먼트 확인
    existing_segments = get_existing_segments(caption_path)

    processed_count = 0

    # 병렬 처리를 위한 작업 큐 생성
    tasks = []

    # 1. 모든 작업 수집
    for recollect_folder in sorted(video_frames_path.iterdir()):
        if not recollect_folder.is_dir():
            continue

        try:
            recollect_id = int(recollect_folder.name)
        except ValueError:
            continue

        for segment_folder in sorted(recollect_folder.iterdir()):
            if not segment_folder.is_dir():
                continue

            segment_info = parse_segment_folder(segment_folder.name)
            if not segment_info:
                continue

            rank = segment_info["rank"]
            if (recollect_id, rank) in existing_segments:
                continue

            # 메타에서 duration 조회
            duration = get_duration_from_meta(meta_dir, video_id, recollect_id)

            tasks.append(
                {
                    "video_id": video_id,
                    "recollect_id": recollect_id,
                    "rank": rank,
                    "start_sec": segment_info["start_sec"],
                    "end_sec": segment_info["end_sec"],
                    "duration": duration,
                    "folder": segment_folder,
                }
            )

    if not tasks:
        return 0

    processed_count = 0

    print(f"op=caption_tasks_collected segments={len(tasks)}", flush=True)

    for task in tasks:
        try:
            frame_paths = get_frame_paths(task["folder"])
            if not frame_paths:
                print("op=segment_frames_missing")
                continue

            print(f"op=caption_task_started frames={len(frame_paths)}")

            caption_result = caption_provider.generate(
                CaptionRequest(
                    video_id=task["video_id"],
                    recollect_id=task["recollect_id"],
                    rank=task["rank"],
                    start_sec=task["start_sec"],
                    end_sec=task["end_sec"],
                    duration=task["duration"],
                    frame_paths=frame_paths,
                    prompt=prompt,
                    locale="ko-KR",
                )
            )
            result = caption_result.to_jsonl_record()
            result["frames"] = frame_paths
            print(f"op=caption_task_generated frames={len(frame_paths)}")

            with open(caption_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(result, ensure_ascii=False) + "\n")

            processed_count += 1

        except (CaptionProviderUnavailable, CaptionProviderError):
            raise
        except Exception as error:
            print(f"op=caption_task_failed error={safe_error_name(error)}")
            raise RuntimeError("frame_caption_task_failed") from None

    return processed_count


def preflight_caption_provider(caption_provider, provider_id: str) -> None:
    """Fail fast for provider-level auth/runtime gates before segment loops."""
    if provider_id == "openai_vision_gpt55" and not os.environ.get("OPENAI_API_KEY"):
        raise CaptionProviderUnavailable("openai_vision_gpt55 requires OPENAI_API_KEY")
    if provider_id == "codex_cli_vision_gpt55":
        require_local_trust = getattr(caption_provider, "_require_local_trust", None)
        if callable(require_local_trust):
            require_local_trust()


def resolve_frames_dir(data_dir: Path, base_data_dir: Path = BASE_DATA_DIR) -> Path:
    """Resolve frames root across legacy per-channel and current shared layouts."""
    env_frames_root = os.environ.get("FRAMES_ROOT_DIR")
    if env_frames_root:
        return Path(env_frames_root).expanduser().resolve()

    channel_frames = data_dir / "frames"
    if channel_frames.exists():
        return channel_frames

    shared_frames = base_data_dir / "frames"
    if shared_frames.exists():
        return shared_frames

    return channel_frames


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
        help="Legacy LLaVA HuggingFace model ID (used only by llava_next_video provider)",
    )
    parser.add_argument(
        "--provider",
        type=str,
        default=None,
        choices=["llava_next_video", "openai_vision_gpt55", "codex_cli_vision_gpt55"],
        help="Caption provider. Defaults to STORYBOARD_CAPTION_PROVIDER or llava_next_video.",
    )
    parser.add_argument(
        "--prompt",
        type=str,
        default="이 장면의 촬영 구도와 상황(누가, 무엇을, 어떻게)을 한국어로 자세하게 설명해주세요.",
        help="Caption generation prompt",
    )
    parser.add_argument(
        "--device",
        type=str,
        default=None,
        help="Device (cuda, mps, or cpu). If not specified, auto-detects.",
    )
    parser.add_argument(
        "--video_id",
        type=str,
        help="Specific video ID to process (optional)",
    )
    args = parser.parse_args()

    # 경로 설정
    data_dir = BASE_DATA_DIR / args.youtuber
    frames_dir = resolve_frames_dir(data_dir)
    output_dir = data_dir / "frame-caption"
    meta_dir = data_dir / "meta"

    if not frames_dir.exists():
        print("op=frames_root_missing")
        return

    if not meta_dir.exists():
        print("op=metadata_directory_missing")

    provider_id = args.provider or resolve_provider_id()
    if provider_id == "llava_next_video":
        os.environ.setdefault("STORYBOARD_CAPTION_LLAVA_MODEL", args.model)
    caption_provider = get_provider(provider_id, device=args.device)
    preflight_caption_provider(caption_provider, provider_id)

    # video_id 폴더 목록
    if args.video_id:
        video_ids = [args.video_id]
        if not (frames_dir / args.video_id).exists():
            print("op=video_directory_missing")
            return
    else:
        video_ids = [
            d.name
            for d in sorted(frames_dir.iterdir())
            if d.is_dir() and d.name != ".DS_Store"
        ]

    print(f"op=caption_batch_start videos={len(video_ids)}")

    total_processed = 0

    for video_id in tqdm(video_ids, desc="Processing videos"):
        count = process_video_frames(
            video_id=video_id,
            frames_dir=frames_dir,
            output_dir=output_dir,
            meta_dir=meta_dir,
            caption_provider=caption_provider,
            prompt=args.prompt,
        )
        total_processed += count

    print(f"op=caption_batch_complete segments={total_processed}")


if __name__ == "__main__":
    try:
        main()
    except CaptionProviderUnavailable as error:
        print(
            f"op=caption_provider_unavailable error={safe_error_name(error)}",
            file=sys.stderr,
        )
        sys.exit(2)
    except Exception as error:
        print(
            f"op=caption_generation_failed error={safe_error_name(error)}",
            file=sys.stderr,
        )
        sys.exit(1)
