#!/usr/bin/env python3
"""Evaluate youtube IDs that hosted restaurants do not already have.

Collects URLs, keeps only IDs absent from hosted, then runs numbered
scripts for those videos. Does not write to hosted Supabase.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend" / "supabase" / "scripts"))

from hosted_data_plane import (  # noqa: E402
    HostedDataPlaneError,
    assert_hosted_target,
    extract_youtube_video_id,
    fetch_hosted_restaurant_snapshot,
)


SCRIPTS = {
    "collect_urls": REPO_ROOT / "backend/restaurant-crawling/scripts/01-collect-urls.py",
    "collect_meta": REPO_ROOT / "backend/restaurant-crawling/scripts/02-collect-meta.py",
    "transcript": REPO_ROOT / "backend/restaurant-crawling/scripts/03-collect-transcript.js",
    "context": REPO_ROOT / "backend/restaurant-crawling/scripts/03-1-generate-transcript-context.py",
    "chunk": REPO_ROOT / "backend/restaurant-crawling/scripts/08-chunk-multimodal-crawling.sh",
    "target": REPO_ROOT / "backend/restaurant-evaluation/scripts/09-target-selection.py",
    "rule": REPO_ROOT / "backend/restaurant-evaluation/scripts/10-rule-evaluation.py",
    "laaj": REPO_ROOT / "backend/restaurant-evaluation/scripts/11-laaj-evaluation.sh",
    "transform": REPO_ROOT / "backend/restaurant-evaluation/scripts/12-transform.py",
}


def _run(argv: list[str], env: dict[str, str], *, required: bool = True) -> int:
    completed = subprocess.run(argv, cwd=REPO_ROOT, env=env, check=False)
    if required and completed.returncode != 0:
        raise SystemExit(completed.returncode)
    return completed.returncode


def _load_urls(path: Path) -> list[str]:
    if not path.is_file():
        return []
    rows: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        url = line.strip()
        if url:
            rows.append(url)
    return rows


def _write_urls(path: Path, urls: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(urls) + ("\n" if urls else ""), encoding="utf-8")


def _is_short_video(crawling: Path, video_id: str) -> bool:
    meta_path = crawling / "meta" / f"{video_id}.jsonl"
    if not meta_path.is_file():
        return False
    try:
        last = meta_path.read_text(encoding="utf-8").splitlines()[-1]
        meta = json.loads(last)
    except (OSError, IndexError, json.JSONDecodeError):
        return False
    if meta.get("is_shorts") is True:
        return True
    duration = meta.get("duration")
    return isinstance(duration, (int, float)) and duration <= 180


def _mark_crawl_not_selected(evaluation: Path, video_id: str, reason: str) -> None:
    directory = evaluation / "evaluation" / "notSelection"
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{video_id}.jsonl"
    if path.exists():
        return
    path.write_text(
        json.dumps(
            {
                "youtube_link": f"https://www.youtube.com/watch?v={video_id}",
                "is_notSelected": True,
                "notSelected_reason": reason,
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )


def _locally_evaluated_ids(evaluation: Path) -> set[str]:
    """IDs 09 already wrote (selection or notSelection).

    Foreign restaurants never reach hosted youtube ids, so they would
    re-qualify as new every night and consume --limit.
    """
    ids: set[str] = set()
    for folder in ("selection", "notSelection"):
        directory = evaluation / "evaluation" / folder
        if not directory.is_dir():
            continue
        ids.update(path.stem for path in directory.glob("*.jsonl"))
    return ids


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--channel", default="tzuyang")
    parser.add_argument("--limit", type=int, default=1)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    if args.limit < 1 or args.limit > 3:
        print("error=limit_invalid")
        return 2

    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    try:
        assert_hosted_target(url)
        _hosted_ids, hosted_youtube = fetch_hosted_restaurant_snapshot(
            url=url, service_role_key=key
        )
    except HostedDataPlaneError as exc:
        print(f"error={exc}")
        return 2

    hosted = set(hosted_youtube)
    env = os.environ.copy()
    python = env.get("PYTHON_CMD", "python3")
    crawling = REPO_ROOT / "backend/restaurant-crawling/data" / args.channel
    evaluation = REPO_ROOT / "backend/restaurant-evaluation/data" / args.channel
    urls_path = crawling / "urls.txt"
    local_done = _locally_evaluated_ids(evaluation)
    before = _load_urls(urls_path)
    _run([python, str(SCRIPTS["collect_urls"]), "--channel", args.channel], env)
    after = _load_urls(urls_path)
    new_urls: list[str] = []
    seen: set[str] = set()
    for item in after:
        video_id = extract_youtube_video_id(item)
        if (
            video_id is None
            or video_id in hosted
            or video_id in seen
            or video_id in local_done
        ):
            continue
        seen.add(video_id)
        new_urls.append(f"https://www.youtube.com/watch?v={video_id}")
        if len(new_urls) >= args.limit:
            break
    print(f"hostedYoutubeIds={len(hosted)}")
    print(f"localEvaluatedIds={len(local_done)}")
    print(f"newVideoCount={len(new_urls)}")
    print(f"newVideoIds={[extract_youtube_video_id(item) for item in new_urls]}")
    if args.dry_run or not new_urls:
        _write_urls(urls_path, before)
        print("evaluate=skipped")
        return 0

    _write_urls(urls_path, new_urls)
    new_ids = [item for item in (extract_youtube_video_id(item) for item in new_urls) if item]
    try:
        _run([python, str(SCRIPTS["collect_meta"]), "--channel", args.channel], env)
        short_ids = [video_id for video_id in new_ids if _is_short_video(crawling, video_id)]
        for video_id in short_ids:
            _mark_crawl_not_selected(evaluation, video_id, "shorts:is_shorts_le_180")
        evaluable_ids = [video_id for video_id in new_ids if video_id not in set(short_ids)]
        _write_urls(
            urls_path,
            [f"https://www.youtube.com/watch?v={video_id}" for video_id in evaluable_ids],
        )
        print(f"shortVideoIds={short_ids}")
        print(f"evaluableVideoIds={evaluable_ids}")
        if evaluable_ids:
            _run(["node", str(SCRIPTS["transcript"]), "--channel", args.channel], env)
            context_exit = _run(
                [
                    python,
                    str(SCRIPTS["context"]),
                    "--max-videos",
                    str(len(evaluable_ids)),
                ],
                env,
                required=False,
            )
            if context_exit != 0:
                print(f"transcript_context=skipped exit={context_exit}")
            else:
                print("transcript_context=ok")
            chunk_exit = _run(
                ["bash", str(SCRIPTS["chunk"]), "--channel", args.channel],
                env,
                required=False,
            )
            if chunk_exit != 0:
                print(f"chunk=continued exit={chunk_exit}")
        for video_id in evaluable_ids:
            for script_key in ("target", "rule"):
                command = [
                    python,
                    str(SCRIPTS[script_key]),
                    "--channel",
                    args.channel,
                    "--evaluation-path",
                    str(evaluation),
                    "--video-id",
                    video_id,
                ]
                if script_key == "target":
                    command[4:4] = ["--crawling-path", str(crawling)]
                step_exit = _run(command, env, required=False)
                if step_exit != 0:
                    print(f"{script_key}=skipped video={video_id} exit={step_exit}")
            if env.get("TZUDONG_LAAJ_PROVIDER") == "opencode-go":
                print(f"laaj=deferred provider=opencode-go video={video_id}")
            else:
                laaj_exit = _run(
                    [
                        "bash",
                        str(SCRIPTS["laaj"]),
                        "--channel",
                        args.channel,
                        "--crawling-path",
                        str(crawling),
                        "--evaluation-path",
                        str(evaluation),
                        "--video-id",
                        video_id,
                    ],
                    env,
                    required=False,
                )
                if laaj_exit != 0:
                    print(f"laaj=skipped video={video_id} exit={laaj_exit}")
        _run(
            [
                python,
                str(SCRIPTS["transform"]),
                "--channel",
                args.channel,
                "--crawling-path",
                str(crawling),
                "--evaluation-path",
                str(evaluation),
            ],
            env,
            required=False,
        )
    finally:
        merged = list(new_urls)
        known = {extract_youtube_video_id(item) for item in merged}
        for item in before + after:
            video_id = extract_youtube_video_id(item)
            if video_id is None or video_id in known:
                continue
            known.add(video_id)
            merged.append(item)
        _write_urls(urls_path, merged)
    print("evaluate=ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
