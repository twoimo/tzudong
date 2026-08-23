#!/usr/bin/env python3
"""First-party opening-screen location extractor.

Downloads only the first 90 seconds of a YouTube video, extracts frames with
ffmpeg, and records on-screen text into visual-location/{video_id}.jsonl.

This owns the opening-screen method in-repo. Heatmaps are unused.
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
FRAME_INTERVAL_SECONDS = 3
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


def download_opening(video_id: str, dest: Path, cookies: Path | None) -> Path:
    yt_dlp = resolve_tool("yt-dlp")
    output = dest / "opening.%(ext)s"
    command = [
        yt_dlp,
        "--no-playlist",
        "--download-sections",
        f"*0-{OPENING_SECONDS}",
        "-f",
        "best[height<=720]/best",
        "-o",
        str(output),
        f"https://www.youtube.com/watch?v={video_id}",
    ]
    if cookies:
        command[1:1] = ["--cookies", str(cookies)]
    result = subprocess.run(command, cwd=dest, capture_output=True, text=True, timeout=180)
    if result.returncode != 0:
        fail("download_failed")
    videos = sorted(dest.glob("opening.*"))
    if not videos:
        fail("download_missing")
    return videos[0]


def extract_frames(video_path: Path, frames_dir: Path) -> list[tuple[int, Path]]:
    ffmpeg = resolve_tool("ffmpeg")
    frames_dir.mkdir(parents=True, exist_ok=True)
    extracted: list[tuple[int, Path]] = []
    for second in range(0, OPENING_SECONDS + 1, FRAME_INTERVAL_SECONDS):
        frame = frames_dir / f"t{second:02d}.jpg"
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
    return {
        "video_id": video_id,
        "youtube_link": f"https://www.youtube.com/watch?v={video_id}",
        "window_seconds": OPENING_SECONDS,
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
        if args.source_video:
            video = Path(args.source_video)
        else:
            video = download_opening(args.video_id, work, cookies)
        frames_dir = work / "frames"
        extracted = extract_frames(video, frames_dir)
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
