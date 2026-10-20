#!/usr/bin/env python3
"""Evaluate youtube IDs that hosted restaurants do not already have.

Collects URLs, keeps only IDs absent from hosted, then runs numbered
scripts for those videos. Does not write to hosted Supabase.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend" / "supabase" / "scripts"))
sys.path.insert(0, str(REPO_ROOT / "backend"))

from utils.stage_cache import certified  # noqa: E402

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


class _BatchFailure(Exception):
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


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


def _last_record(path: Path) -> dict | None:
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
        value = json.loads(lines[-1])
        return value if isinstance(value, dict) else None
    except (OSError, IndexError, UnicodeError, json.JSONDecodeError):
        return None


def _transformed_names(evaluation: Path) -> dict[str, set[str]]:
    """Use only the transform's committed, hash-matched snapshot."""
    base = evaluation / "evaluation"
    output = base / "transforms.jsonl"
    receipt = base / ".receipts" / "transform.json"
    try:
        ledger = json.loads(receipt.read_text(encoding="utf-8"))
        snapshot = output.read_bytes()
        if hashlib.sha256(snapshot).hexdigest() != ledger.get("outputHash"):
            return {}
        rows = {}
        for line in snapshot.decode("utf-8").splitlines():
            if line.strip():
                row = json.loads(line)
                if isinstance(row, dict) and isinstance(row.get("trace_id"), str):
                    rows[row["trace_id"]] = row
        result: dict[str, set[str]] = {}
        for identity, group in ledger.get("groups", {}).items():
            if not identity.startswith("results:") or not isinstance(group, dict):
                continue
            video_id = identity.removeprefix("results:")
            result[video_id] = {
                row["origin_name"]
                for trace in group.get("records", [])
                if isinstance((row := rows.get(trace)), dict)
                and isinstance(row.get("origin_name"), str)
                and not row.get("is_missing")
                and not row.get("is_notSelected")
            }
        return result
    except (OSError, UnicodeError, ValueError, TypeError, AttributeError):
        return {}


def _video_state(
    crawling: Path, evaluation: Path, video_id: str, transformed: dict[str, set[str]]
) -> str:
    """A 09 selection alone is never a completed evaluation."""
    crawl_output = crawling / "crawling" / f"{video_id}.jsonl"
    if not certified(crawling / "crawling" / ".receipts" / f"{video_id}.json", [crawl_output]):
        return "extraction_incomplete"
    base = evaluation / "evaluation"
    selection = base / "selection" / f"{video_id}.jsonl"
    not_selection = base / "notSelection" / f"{video_id}.jsonl"
    outputs = [path for path in (selection, not_selection) if path.is_file()]
    if not certified(base / "selection" / ".receipts" / f"{video_id}.json", outputs):
        return "selection_incomplete"
    record = _last_record(selection if selection.is_file() else not_selection)
    if record is None or not isinstance(record.get("evaluation_target"), dict):
        return "selection_incomplete"
    targets = {name for name, chosen in record["evaluation_target"].items() if chosen is True}
    if not targets:
        if record.get("notSelected_reason") in {"no_restaurants", "all_names_null"}:
            return "no_extraction"
        return "no_evaluable_target"
    for stage in ("rule_results", "laaj_results"):
        output = base / stage / f"{video_id}.jsonl"
        if not certified(base / stage / ".receipts" / f"{video_id}.json", [output]):
            return f"{stage}_incomplete"
    if not targets.issubset(transformed.get(video_id, set())):
        return "transform_incomplete"
    return "completed"


def _locally_evaluated_ids(evaluation: Path, crawling: Path | None = None) -> set[str]:
    """Skip only certified terminal outcomes; incomplete videos retry next tick."""
    base = evaluation / "evaluation"
    candidates = {
        path.stem
        for folder in ("selection", "notSelection")
        for path in (base / folder).glob("*.jsonl")
    }
    transformed = _transformed_names(evaluation)
    crawling = crawling or REPO_ROOT / "backend/restaurant-crawling/data" / evaluation.name
    completed = {
        video_id for video_id in candidates
        if _video_state(crawling, evaluation, video_id, transformed)
        in {"completed", "no_extraction", "no_evaluable_target"}
    }
    for path in (base / "notSelection").glob("*.jsonl"):
        row = _last_record(path)
        if (row and row.get("notSelected_reason") == "shorts:is_shorts_le_180"
                and _is_short_video(crawling, path.stem)):
            completed.add(path.stem)
    return completed


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
    local_done = _locally_evaluated_ids(evaluation, crawling)
    before = _load_urls(urls_path)
    collect_exit = _run(
        [python, str(SCRIPTS["collect_urls"]), "--channel", args.channel, "--latest-first"],
        env,
        required=False,
    )
    if collect_exit != 0:
        print("collect=failed")
        print("completedVideoCount=0")
        print("excludedVideoCount=0")
        print("failedVideoCount=0")
        return collect_exit
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
        print("completedVideoCount=0")
        print("excludedVideoCount=0")
        print("failedVideoCount=0")
        print("evaluate=skipped")
        return 0

    _write_urls(urls_path, new_urls)
    new_ids = [item for item in (extract_youtube_video_id(item) for item in new_urls) if item]
    stage_failures: dict[str, list[str]] = {video_id: [] for video_id in new_ids}
    evaluable_ids = new_ids
    short_ids: list[str] = []
    chunk_exit = 0
    transform_exit = 0
    try:
        if _run([python, str(SCRIPTS["collect_meta"]), "--channel", args.channel], env, required=False):
            raise _BatchFailure("metadata_failed")
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
            if _run(["node", str(SCRIPTS["transcript"]), "--channel", args.channel], env, required=False):
                raise _BatchFailure("transcript_failed")
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
            crawl_output = crawling / "crawling" / f"{video_id}.jsonl"
            if not certified(crawling / "crawling" / ".receipts" / f"{video_id}.json", [crawl_output]):
                stage_failures[video_id].append("extraction_incomplete")
                continue
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
                    stage_failures[video_id].append(f"{script_key}_failed")
                    break
                if script_key == "target":
                    state = _video_state(crawling, evaluation, video_id, {})
                    if state in {"no_extraction", "no_evaluable_target"}:
                        break
                    if state == "selection_incomplete":
                        stage_failures[video_id].append(state)
                        break
            if stage_failures[video_id] or _video_state(crawling, evaluation, video_id, {}) in {
                "no_extraction", "no_evaluable_target"
            }:
                continue
            if env.get("TZUDONG_LAAJ_PROVIDER") == "opencode-go":
                print(f"laaj=deferred provider=opencode-go video={video_id}")
                stage_failures[video_id].append("laaj_deferred")
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
                    stage_failures[video_id].append("laaj_failed")
        transform_exit = _run(
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
    except _BatchFailure as exc:
        for video_id in evaluable_ids:
            stage_failures[video_id].append(exc.reason)
    except OSError:
        for video_id in evaluable_ids:
            stage_failures[video_id].append("runtime_failed")
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
    transformed = _transformed_names(evaluation)
    failures = 0
    completed = 0
    excluded = len(short_ids)
    for video_id in evaluable_ids:
        state = _video_state(crawling, evaluation, video_id, transformed)
        reasons = stage_failures[video_id]
        if transform_exit != 0 and state != "no_extraction":
            reasons.append("transform_failed")
        if state not in {"completed", "no_extraction", "no_evaluable_target"}:
            reasons.append(state)
        if reasons:
            failures += 1
            print(f"videoFailed={video_id} reasons={','.join(dict.fromkeys(reasons))}")
        else:
            if state == "completed":
                completed += 1
            else:
                excluded += 1
            print(f"videoCompleted={video_id} outcome={state}")
    print(f"completedVideoCount={completed}")
    print(f"excludedVideoCount={excluded}")
    print(f"failedVideoCount={failures}")
    if failures:
        print(f"evaluate=failed videoCount={failures}")
        return 1
    print("evaluate=ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
