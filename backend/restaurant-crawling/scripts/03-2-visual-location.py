#!/usr/bin/env python3
"""First-party location-hint extractor.

Samples opening, heatmap-peak, and ending windows. Does not confirm addresses.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_ROOT = SCRIPT_DIR.parents[1]
REPO_ROOT = BACKEND_ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.utils.privacy_log import safe_error_name

YOUTUBE_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
SAFE_CHANNEL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
SIGN_HINT_RE = re.compile(
    r"(요기라면|참참|24시\s*무인라면|24시\s*무인|무인라면|아이스크림)",
)
KOREAN_OR_LATIN_RE = re.compile(r"[가-힣A-Za-z0-9&]{2,}")
NOISE_HINT_RE = re.compile(
    r"(subscribe|youtube|views|www\.|http|조회수|구독|좋아요|shorts)",
    re.IGNORECASE,
)
OPENING_SECONDS = 90
ENDING_SECONDS = 30
PEAK_PAD_SECONDS = 5
FRAME_INTERVAL_SECONDS = 3
MAX_SAMPLED_SECONDS = 80
VISION_SWIFT = SCRIPT_DIR / "03-2-visual-ocr.swift"


def fail(code: str) -> None:
    raise SystemExit(code)


def resolve_tool(name: str) -> str:
    path = shutil.which(name)
    if not path:
        fail(f"tool_missing_{name}")
    return path


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract opening-screen location evidence")
    parser.add_argument("--channel", default="tzuyang")
    parser.add_argument("--video-id", default="", help="Single YouTube id. Omit to batch from urls.txt / meta / crawling.")
    parser.add_argument("--source-video", help="Reuse a local video instead of downloading")
    parser.add_argument("--cookies", help="yt-dlp cookies file")
    parser.add_argument("--data-root", help="Override restaurant-crawling data root")
    parser.add_argument("--keep-frames", action="store_true")
    parser.add_argument("--limit", type=int, default=0, help="Max videos in channel batch. 0 means all discovered ids.")
    return parser.parse_args(argv)


def validate_args(args: argparse.Namespace) -> None:
    if not SAFE_CHANNEL_RE.fullmatch(args.channel):
        fail("channel_invalid")
    if args.video_id and not YOUTUBE_VIDEO_ID_RE.fullmatch(args.video_id):
        fail("video_id_invalid")
    if args.source_video:
        source = Path(args.source_video)
        if not source.is_file() or source.stat().st_size < 1:
            fail("source_video_missing")
    if args.cookies:
        cookies = Path(args.cookies)
        if not cookies.is_file():
            fail("cookies_missing")


def data_root_for(args: argparse.Namespace) -> Path:
    if args.data_root:
        return Path(args.data_root)
    return BACKEND_ROOT / "restaurant-crawling" / "data" / args.channel


def default_cookies_path() -> Path | None:
    candidate = BACKEND_ROOT / "restaurant-crawling" / "data" / "cookies.txt"
    return candidate if candidate.is_file() else None


def last_jsonl(path: Path) -> dict | None:
    if not path.is_file():
        return None
    last = None
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if line.strip():
            try:
                last = json.loads(line)
            except json.JSONDecodeError:
                continue
    return last if isinstance(last, dict) else None


def video_duration_seconds(data_root: Path, video_id: str) -> int | None:
    meta = last_jsonl(data_root / "meta" / f"{video_id}.jsonl")
    if not meta:
        return None
    duration = meta.get("duration")
    if isinstance(duration, (int, float)) and duration > 0:
        return int(duration)
    return None


def heatmap_peak_seconds(data_root: Path, video_id: str) -> list[int]:
    heat = last_jsonl(data_root / "heatmap" / f"{video_id}.jsonl")
    if not heat:
        return []
    markers = heat.get("most_replayed_markers")
    if not isinstance(markers, list):
        return []
    peaks: list[int] = []
    for marker in markers[:3]:
        if not isinstance(marker, dict):
            continue
        millis = marker.get("peakMillis")
        if isinstance(millis, (int, float)) and millis >= 0:
            peaks.append(int(millis / 1000))
    return peaks


def sample_seconds(duration: int | None, peaks: list[int]) -> list[int]:
    seconds: list[int] = []
    seen: set[int] = set()

    def add(value: int) -> None:
        if value < 0:
            return
        if duration is not None and value > duration:
            return
        if value not in seen:
            seen.add(value)
            seconds.append(value)

    for second in range(0, OPENING_SECONDS + 1, FRAME_INTERVAL_SECONDS):
        add(second)
    for peak in peaks:
        for second in range(max(0, peak - PEAK_PAD_SECONDS), peak + PEAK_PAD_SECONDS + 1, FRAME_INTERVAL_SECONDS):
            add(second)
    if duration and duration > OPENING_SECONDS:
        start = max(0, duration - ENDING_SECONDS)
        for second in range(start, duration + 1, FRAME_INTERVAL_SECONDS):
            add(second)
    seconds.sort()
    if len(seconds) > MAX_SAMPLED_SECONDS:
        opening = [s for s in seconds if s <= OPENING_SECONDS]
        rest = [s for s in seconds if s > OPENING_SECONDS]
        keep_rest = MAX_SAMPLED_SECONDS - len(opening)
        if keep_rest < 0:
            return opening[:MAX_SAMPLED_SECONDS]
        step = max(1, len(rest) // keep_rest) if rest and keep_rest else 1
        return opening + rest[::step][:keep_rest]
    return seconds


def download_sampled_video(video_id: str, dest: Path, cookies: Path | None, duration: int | None, peaks: list[int]) -> Path:
    yt_dlp = resolve_tool("yt-dlp")
    output = dest / "sample.%(ext)s"
    command = [
        yt_dlp,
        "--no-playlist",
        "-f",
        "best[height<=720]/best",
        "-o",
        str(output),
        f"https://www.youtube.com/watch?v={video_id}",
    ]
    if cookies:
        command[1:1] = ["--cookies", str(cookies)]
    needs_full = bool(peaks) or (duration is not None and duration > OPENING_SECONDS)
    if not needs_full:
        command[1:1] = ["--download-sections", f"*0-{OPENING_SECONDS}"]
    result = subprocess.run(command, cwd=dest, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        fail("download_failed")
    videos = sorted(dest.glob("sample.*"))
    if not videos:
        fail("download_missing")
    return videos[0]


def extract_frames(video_path: Path, frames_dir: Path, seconds: list[int]) -> list[tuple[int, Path]]:
    ffmpeg = resolve_tool("ffmpeg")
    frames_dir.mkdir(parents=True, exist_ok=True)
    extracted: list[tuple[int, Path]] = []
    for second in seconds:
        frame = frames_dir / f"t{second:04d}.jpg"
        result = subprocess.run(
            [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-ss",
                str(second),
                "-i",
                str(video_path),
                "-frames:v",
                "1",
                "-q:v",
                "3",
                str(frame),
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode == 0 and frame.is_file() and frame.stat().st_size > 0:
            extracted.append((second, frame))
    if not extracted:
        fail("frames_missing")
    return extracted


def ocr_frame_with_vision(frame: Path) -> list[str]:
    if not VISION_SWIFT.is_file():
        return []
    swift = shutil.which("swift")
    if not swift:
        return []
    result = subprocess.run(
        [swift, str(VISION_SWIFT), str(frame)],
        capture_output=True,
        text=True,
        timeout=45,
    )
    if result.returncode != 0 or not result.stdout.strip():
        return []
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError:
        return []
    texts = payload.get("texts") if isinstance(payload, dict) else None
    if not isinstance(texts, list):
        return []
    cleaned: list[str] = []
    for item in texts:
        if not isinstance(item, str):
            continue
        value = " ".join(item.split())
        if value and KOREAN_OR_LATIN_RE.search(value):
            cleaned.append(value)
    return cleaned


def collect_sign_hints(texts: list[str]) -> list[str]:
    hints: list[str] = []
    seen: set[str] = set()
    for text in texts:
        for match in SIGN_HINT_RE.findall(text):
            normalized = re.sub(r"\s+", "", match)
            if normalized not in seen:
                seen.add(normalized)
                hints.append(normalized)
        cleaned = " ".join(text.split())
        if (
            KOREAN_OR_LATIN_RE.search(cleaned)
            and not NOISE_HINT_RE.search(cleaned)
            and 2 <= len(cleaned) <= 40
        ):
            if cleaned not in seen:
                seen.add(cleaned)
                hints.append(cleaned)
    return hints


def choose_origin_name(hints: list[str]) -> str | None:
    if "요기라면" in hints:
        return "요기라면"
    if "24시무인라면" in hints or "무인라면" in hints:
        return "24시 무인라면"
    for hint in hints:
        if SIGN_HINT_RE.search(hint):
            continue
        if NOISE_HINT_RE.search(hint):
            continue
        if KOREAN_OR_LATIN_RE.search(hint):
            return hint
    return None


def discover_channel_video_ids(data_root: Path) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    urls = data_root / "urls.txt"
    if urls.is_file():
        for line in urls.read_text(encoding="utf-8", errors="replace").splitlines():
            match = re.search(r"(?:v=|/shorts/|youtu\.be/)([A-Za-z0-9_-]{11})", line)
            if match and match.group(1) not in seen:
                seen.add(match.group(1))
                found.append(match.group(1))
    for folder in ("meta", "crawling", "transcript"):
        directory = data_root / folder
        if not directory.is_dir():
            continue
        for path in sorted(directory.glob("*.jsonl")):
            if YOUTUBE_VIDEO_ID_RE.fullmatch(path.stem) and path.stem not in seen:
                seen.add(path.stem)
                found.append(path.stem)
    return found


def write_jsonl(path: Path, record: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def build_record(video_id: str, frames: list[tuple[int, Path, list[str]]]) -> dict:
    evidence = []
    all_texts: list[str] = []
    for second, frame, texts in frames:
        all_texts.extend(texts)
        evidence.append(
            {
                "t": second,
                "frame": frame.name,
                "texts": texts,
            }
        )
    hints = collect_sign_hints(all_texts)
    origin_name = choose_origin_name(hints)
    windows = sorted({
        "opening" if second <= OPENING_SECONDS else "later"
        for second, _frame, _texts in frames
    })
    return {
        "video_id": video_id,
        "youtube_link": f"https://www.youtube.com/watch?v={video_id}",
        "window_seconds": OPENING_SECONDS,
        "sampled_seconds": [second for second, _frame, _texts in frames],
        "windows": windows,
        "origin_name": origin_name,
        "sign_hints": hints,
        "address_status": "unknown",
        "address": None,
        "evidence": {
            "visual": evidence,
            "caption": [],
            "external": [],
        },
        "source": "03-2-visual-location",
    }


def run(args: argparse.Namespace) -> dict:
    validate_args(args)
    cookies = Path(args.cookies) if args.cookies else default_cookies_path()
    output_path = data_root_for(args) / "visual-location" / f"{args.video_id}.jsonl"
    with tempfile.TemporaryDirectory(prefix="tzudong-visual-") as temp:
        work = Path(temp)
        data_root = data_root_for(args)
        duration = video_duration_seconds(data_root, args.video_id)
        peaks = heatmap_peak_seconds(data_root, args.video_id)
        seconds = sample_seconds(duration, peaks)
        if args.source_video:
            video = Path(args.source_video)
        else:
            video = download_sampled_video(args.video_id, work, cookies, duration, peaks)
        frames_dir = work / "frames"
        extracted = extract_frames(video, frames_dir, seconds)
        framed: list[tuple[int, Path, list[str]]] = []
        keep_dir = None
        if args.keep_frames:
            keep_dir = data_root_for(args) / "visual-location" / "frames" / args.video_id
            keep_dir.mkdir(parents=True, exist_ok=True)
        for second, frame in extracted:
            texts = ocr_frame_with_vision(frame)
            if keep_dir:
                shutil.copy2(frame, keep_dir / frame.name)
            framed.append((second, frame, texts))
        record = build_record(args.video_id, framed)
        write_jsonl(output_path, record)
        return record


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    video_ids = [args.video_id] if args.video_id else discover_channel_video_ids(data_root_for(args))
    if args.limit and args.limit > 0:
        video_ids = video_ids[: args.limit]
    if not video_ids:
        print("op=visual_location_skipped error=no_channel_videos")
        return 0
    failures = 0
    for video_id in video_ids:
        single = argparse.Namespace(**vars(args))
        single.video_id = video_id
        try:
            record = run(single)
        except SystemExit as error:
            code = error.code if isinstance(error.code, str) else "visual_location_failed"
            print(f"op=visual_location_failed video_id={video_id} error={code}")
            failures += 1
            continue
        except Exception as error:
            print(f"op=visual_location_failed video_id={video_id} error={safe_error_name(error)}")
            failures += 1
            continue
        print(
            "op=visual_location_ok "
            f"video_id={record['video_id']} "
            f"hints={len(record['sign_hints'])} "
            f"origin_name={record['origin_name'] or 'none'}"
        )
    return 2 if failures and failures == len(video_ids) else 0


if __name__ == "__main__":
    raise SystemExit(main())
