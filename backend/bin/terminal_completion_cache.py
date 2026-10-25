#!/usr/bin/env python3
"""Transport public terminal inputs between trusted scheduled runners.

A cache hit never authorizes a video skip. The evaluator still checks current
producer recipes, source content, receipts and terminal outputs after restore.
Only explicit Shorts/absent-restaurant outcomes are exported; no credentials,
provider logs, delivery receipts, media or restaurant write state are included.
"""
from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
MAX_BYTES = 16 * 1024 * 1024
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_FILES = 1600
MAX_VIDEOS = 200
REASONS = {"shorts:is_shorts_le_180", "no_restaurants", "all_names_null"}
VIDEO = re.compile(r"[A-Za-z0-9_-]{11}")


def _paths(video: str) -> tuple[str, ...]:
    crawl = "backend/restaurant-crawling/data/tzuyang"
    evaluation = "backend/restaurant-evaluation/data/tzuyang/evaluation"
    return (
        f"{crawl}/meta/{video}.jsonl",
        f"{crawl}/transcript/{video}.jsonl",
        f"{crawl}/crawling/{video}.jsonl",
        f"{crawl}/crawling/.receipts/{video}.json",
        f"{crawl}/visual-location/{video}.jsonl",
        f"{evaluation}/notSelection/{video}.jsonl",
        f"{evaluation}/selection/{video}.jsonl",
        f"{evaluation}/selection/.receipts/{video}.json",
    )


def _latest(path: Path) -> dict:
    with path.open("rb") as source:
        content = source.read(MAX_FILE_BYTES + 1)
    if len(content) > MAX_FILE_BYTES:
        raise ValueError("terminal_cache_invalid")
    rows = [line for line in content.decode("utf-8").splitlines() if line.strip()]
    value = json.loads(rows[-1])
    if not isinstance(value, dict):
        raise ValueError("terminal_cache_invalid")
    return value


def _safe_target(root: Path, relative: str) -> Path:
    root = root.resolve()
    path = root / relative
    for parent in (path, *path.parents):
        if parent == root:
            break
        if parent.is_symlink():
            raise ValueError("terminal_cache_symlink")
        if parent != path and parent.exists() and not parent.is_dir():
            raise ValueError("terminal_cache_conflict")
    if not path.resolve().is_relative_to(root):
        raise ValueError("terminal_cache_path_invalid")
    return path


def fresh_ids(root: Path, environment: dict[str, str]) -> set[str]:
    # Import the actual evaluator, rather than duplicating its completion rules.
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    spec = importlib.util.spec_from_file_location(
        "terminal_cache_evaluator", root / "backend/bin/evaluate_new_youtube_videos.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module._fresh_locally_evaluated_ids(
        root / "backend/restaurant-evaluation/data/tzuyang",
        root / "backend/restaurant-crawling/data/tzuyang", "tzuyang", environment)


def export_cache(root: Path, cache: Path, environment: dict[str, str]) -> dict:
    candidates = fresh_ids(root, environment)
    urls = root / "backend/restaurant-crawling/data/tzuyang/urls.txt"
    order = []
    if urls.is_file():
        for line in urls.read_text(encoding="utf-8").splitlines():
            match = re.fullmatch(r"https://www.youtube.com/watch\?v=([A-Za-z0-9_-]{11})", line)
            if match and match[1] in candidates and match[1] not in order:
                order.append(match[1])
    order.extend(sorted(candidates - set(order)))
    packet = {"schemaVersion": 1, "videos": [], "files": []}
    serialized_size = len(json.dumps(packet, separators=(",", ":")).encode())
    skipped = 0
    for video in order:
        if not VIDEO.fullmatch(video) or len(packet["videos"]) >= MAX_VIDEOS:
            skipped += 1
            continue
        marker = _safe_target(root, _paths(video)[5])
        if not marker.is_file():
            continue
        if marker.stat().st_size > MAX_FILE_BYTES:
            skipped += 1
            continue
        if _latest(marker).get("notSelected_reason") not in REASONS:
            continue
        entries = []
        for relative in _paths(video):
            source = _safe_target(root, relative)
            if not source.is_file():
                continue
            if source.stat().st_size > MAX_FILE_BYTES:
                entries = []
                break
            with source.open("rb") as stream:
                content = stream.read(MAX_FILE_BYTES + 1)
            if len(content) > MAX_FILE_BYTES:
                entries = []
                break
            entries.append({"path": relative, "sha256": hashlib.sha256(content).hexdigest(),
                            "content": base64.b64encode(content).decode("ascii")})
        # Account for each encoded entry once, instead of reserializing an
        # ever-growing packet for every video (quadratic in the packet size).
        addition = len(json.dumps(video).encode()) + bool(packet["videos"])
        addition += sum(len(json.dumps(entry, separators=(",", ":")).encode()) for entry in entries)
        addition += len(entries) - (1 if entries and not packet["files"] else 0)
        if (not entries or len(packet["files"]) + len(entries) > MAX_FILES
                or serialized_size + addition > MAX_BYTES):
            skipped += 1
            continue
        packet["videos"].append(video)
        packet["files"].extend(entries)
        serialized_size += addition
    encoded = json.dumps(packet, separators=(",", ":")).encode()
    if len(encoded) != serialized_size or len(encoded) > MAX_BYTES:
        raise ValueError("terminal_cache_invalid")
    cache.parent.mkdir(parents=True, exist_ok=True)
    if cache.is_symlink():
        raise ValueError("terminal_cache_symlink")
    descriptor, name = tempfile.mkstemp(prefix=".terminal-cache-", dir=cache.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(gzip.compress(encoded, mtime=0))
        temporary.replace(cache)
    finally:
        temporary.unlink(missing_ok=True)
    return {"videos": len(packet["videos"]), "files": len(packet["files"]),
            "bytes": cache.stat().st_size, "skippedByBounds": skipped}


def restore_cache(root: Path, cache: Path) -> dict:
    if not cache.is_file():
        return {"transportedVideos": 0, "files": 0, "cacheMissing": True}
    if cache.is_symlink() or cache.stat().st_size > MAX_BYTES:
        raise ValueError("terminal_cache_invalid")
    with gzip.open(cache, "rb") as source:
        encoded = source.read(MAX_BYTES + 1)
    if len(encoded) > MAX_BYTES:
        raise ValueError("terminal_cache_invalid")
    packet = json.loads(encoded)
    if (not isinstance(packet, dict) or set(packet) != {"schemaVersion", "videos", "files"}
            or type(packet["schemaVersion"]) is not int or packet["schemaVersion"] != 1
            or not isinstance(packet["videos"], list) or not isinstance(packet["files"], list)
            or len(packet["videos"]) > MAX_VIDEOS or len(packet["files"]) > MAX_FILES):
        raise ValueError("terminal_cache_invalid")
    videos = packet["videos"]
    if (any(not isinstance(video, str) or not VIDEO.fullmatch(video) for video in videos)
            or len(set(videos)) != len(videos)):
        raise ValueError("terminal_cache_invalid")
    allowed = {path for video in videos for path in _paths(video)}
    planned, seen = [], set()
    # Validate the entire bounded packet before writing any file. Existing local
    # evidence wins; a conflicting cache is rejected, never merged or overwritten.
    for entry in packet["files"]:
        if not isinstance(entry, dict) or set(entry) != {"path", "sha256", "content"}:
            raise ValueError("terminal_cache_invalid")
        relative, digest, content = (entry[key] for key in ("path", "sha256", "content"))
        if (not isinstance(relative, str) or relative not in allowed or relative in seen
                or PurePosixPath(relative).as_posix() != relative
                or not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest)
                or not isinstance(content, str) or len(content) > MAX_FILE_BYTES * 2):
            raise ValueError("terminal_cache_invalid")
        decoded = base64.b64decode(content, validate=True)
        if len(decoded) > MAX_FILE_BYTES or hashlib.sha256(decoded).hexdigest() != digest:
            raise ValueError("terminal_cache_invalid")
        target = _safe_target(root, relative)
        if target.exists() and (not target.is_file() or target.read_bytes() != decoded):
            raise ValueError("terminal_cache_conflict")
        seen.add(relative)
        planned.append((target, decoded))
    for target, content in planned:
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("xb") as output:
                output.write(content)
    return {"transportedVideos": len(videos), "files": len(planned), "cacheMissing": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["export", "restore"])
    parser.add_argument("--cache-file", required=True, type=Path)
    args = parser.parse_args()
    try:
        result = (export_cache(ROOT, args.cache_file, os.environ.copy())
                  if args.action == "export" else restore_cache(ROOT, args.cache_file))
        print(json.dumps(result, sort_keys=True))
        return 0
    except (ValueError, OSError, EOFError, IndexError, TypeError, RuntimeError, ImportError, AttributeError):
        print("error=terminal_cache_invalid")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
