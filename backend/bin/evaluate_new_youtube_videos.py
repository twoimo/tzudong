#!/usr/bin/env python3
"""Evaluate youtube IDs that hosted restaurants do not already have.

Collects URLs, keeps only IDs absent from hosted, then runs numbered
scripts for those videos. Does not write to hosted Supabase.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend" / "supabase" / "scripts"))
sys.path.insert(0, str(REPO_ROOT))

from hosted_data_plane import (  # noqa: E402
    HostedDataPlaneError,
    assert_hosted_target,
    extract_youtube_video_id,
    fetch_hosted_restaurant_snapshot,
    load_evaluation_rows,
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
    if not isinstance(meta, dict):
        return False
    if meta.get("is_shorts") is True:
        return True
    duration = meta.get("duration")
    return type(duration) in (int, float) and 0 <= duration <= 180


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


def _latest_object(path: Path) -> dict | None:
    try:
        lines = [line for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
        record = json.loads(lines[-1])
    except (OSError, ValueError, IndexError):
        return None
    return record if isinstance(record, dict) else None


def _has_terminal_evaluation(record: dict) -> bool:
    """Check completion, not approval: valid negative scores/matches still count."""
    if record.get("is_notSelected") is not False or record.get("is_missing") is not False:
        return False
    results = record.get("evaluation_results")
    if not isinstance(results, dict):
        return False
    # Canonical flattened Rule/LAAJ fields; ranges match pipeline/validators.py.
    for key in ("location_match_TF", "category_validity_TF", "rb_grounding_TF", "category_TF"):
        item = results.get(key)
        if not isinstance(item, dict) or type(item.get("eval_value")) is not bool:
            return False
    if results["location_match_TF"].get("match_status") == "failed":
        return False
    for key, maximum in (("visit_authenticity", 2), ("rb_inference_score", 2),
                         ("review_faithfulness_score", 1)):
        item = results.get(key)
        value = item.get("eval_value") if isinstance(item, dict) else None
        if (type(value) not in (int, float) or not 0 <= value <= maximum
                or not math.isfinite(value)):
            return False
    return True


def _permanent_no_transcript_ids() -> set[str]:
    # Same JSON array, canonical URL and any-qualifying-duplicate policy as 03.
    ledger = REPO_ROOT / "backend/data/no_transcript_link/no_transcript_permanent.json"
    try:
        entries = json.loads(ledger.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return set()
    if not isinstance(entries, list):
        return set()
    ids: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        video_id = extract_youtube_video_id(entry.get("youtube_link"))
        retry_num = entry.get("retry_num")
        if (video_id and entry.get("youtube_link") == f"https://www.youtube.com/watch?v={video_id}"
                and type(retry_num) is int and retry_num >= 3):
            ids.add(video_id)
    return ids


def _locally_evaluated_ids(evaluation: Path) -> set[str]:
    """Only terminal outcomes are reusable; selection alone is intermediate."""
    ids: set[str] = set()
    directory = evaluation / "evaluation" / "notSelection"
    for path in directory.glob("*.jsonl"):
        record = _latest_object(path)
        if (
            isinstance(record, dict)
            and extract_youtube_video_id(record.get("youtube_link", "")) == path.stem
            and record.get("is_notSelected") is True
            and isinstance(record.get("notSelected_reason"), str)
            and record["notSelected_reason"].strip()
            and isinstance(record.get("evaluation_target", {}), dict)
            and not any(value is True for value in record.get("evaluation_target", {}).values())
        ):
            ids.add(path.stem)
    explicitly_excluded = set(ids)
    transformed: dict[str, list[dict]] = {}
    invalid_identity: set[str] = set()
    for record in load_evaluation_rows(str(evaluation / "evaluation" / "transforms.jsonl")):
        video_id = extract_youtube_video_id(record.get("youtube_link", ""))
        if video_id and all(isinstance(record.get(key), str) and record[key].strip()
                            for key in ("trace_id", "origin_name")):
            ids.add(video_id)
            transformed.setdefault(video_id, []).append(record)
        elif video_id:
            invalid_identity.add(video_id)
    for video_id, rows in transformed.items():
        selection_path = evaluation / "evaluation" / "selection" / f"{video_id}.jsonl"
        if (video_id not in explicitly_excluded and not selection_path.is_file()
                and (video_id in invalid_identity or not all(_has_terminal_evaluation(row) for row in rows))):
            ids.discard(video_id)
    for path in (evaluation / "evaluation" / "selection").glob("*.jsonl"):
        selection = _latest_object(path)
        targets = selection.get("evaluation_target") if selection else None
        if (not selection or extract_youtube_video_id(selection.get("youtube_link")) != path.stem
                or not isinstance(targets, dict)
                or any(not isinstance(name, str) or not name.strip() or type(value) is not bool
                       for name, value in targets.items())):
            ids.discard(path.stem)
            continue
        required_names = {name for name, selected in targets.items() if selected is True}
        completed_names = {row["origin_name"] for row in transformed.get(path.stem, [])
                           if _has_terminal_evaluation(row)}
        if not required_names.issubset(completed_names):
            ids.discard(path.stem)
    return ids


def _cache_probe(command: list[str], env: dict[str, str]) -> bool:
    # Probe modes exit before credentials repair, provider calls or publication.
    # Do not echo child stdout/stderr (env loaders can contain private paths).
    try:
        result = subprocess.run(command, env={**env, 'PYTHONDONTWRITEBYTECODE': '1'},
                                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, timeout=15, check=False)
        return result.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def _cache_probe_many(command: list[str], videos: list[str], env: dict[str, str]) -> set[str]:
    if not videos:
        return set()
    try:
        result = subprocess.run(command, env={**env, 'PYTHONDONTWRITEBYTECODE': '1'},
                                input=json.dumps(videos), text=True, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, timeout=15, check=False)
        if result.returncode or len(result.stdout) > 256_000:
            return set()
        # Trusted env loaders may print diagnostics; never publish their output.
        value = json.loads(result.stdout.strip().splitlines()[-1])
        hits = value.get('cacheHits') if isinstance(value, dict) and set(value) == {'cacheHits'} else None
        if (not isinstance(hits, list) or any(not isinstance(v, str) for v in hits)
                or len(set(hits)) != len(hits) or not set(hits).issubset(videos)):
            return set()
        return set(hits)
    except (OSError, subprocess.SubprocessError, ValueError, IndexError):
        return set()


def _cache_snapshot(crawling: Path, evaluation: Path, videos, env: dict[str, str] | None = None) -> dict:
    from backend.utils.pipeline_cache_contracts import stage_inputs, transform_groups
    paths = set()
    for video in ([videos] if isinstance(videos, str) else videos):
        for stage in ('crawl', 'selection', 'rule', 'laaj'):
            # 08 captures CONFIG_NAME from its inherited environment before
            # loading .env; watch that same file across all stage probes.
            plan = stage_inputs(stage, REPO_ROOT / 'backend', crawling, evaluation, video, [],
                                channel_config=(env or {}).get('CHANNELS_CONFIG') or 'channels.yaml')
            for field in ('inputs', 'assets', 'metadata'):
                paths.update(plan[field])
        for directory in ('selection', 'notSelection', 'rule_results', 'laaj_results'):
            paths.add(evaluation / 'evaluation' / directory / (video + '.jsonl'))
            paths.add(evaluation / 'evaluation' / directory / '.receipts' / (video + '.json'))
        paths.add(crawling / 'crawling' / (video + '.jsonl'))
        paths.add(crawling / 'crawling/.receipts' / (video + '.json'))
    paths.update((evaluation / 'evaluation/transforms.jsonl',
                  evaluation / 'evaluation/.receipts/transform.json'))
    for _, item, inputs in transform_groups(crawling, evaluation):
        paths.update(inputs)
        paths.add(crawling / 'meta' / (item + '.jsonl'))
    paths.update((REPO_ROOT / 'backend/.env', REPO_ROOT / '.env', REPO_ROOT.parent / '.env',
                  REPO_ROOT / 'backend/.env.local',
                  REPO_ROOT / 'backend/restaurant-evaluation/scripts/12-transform.py',
                  REPO_ROOT / 'backend/restaurant-evaluation/scripts/evaluation_results_boundary.py'))
    result = {}
    for path in paths:
        try:
            stat = path.stat()
            result[path] = (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
        except FileNotFoundError:
            result[path] = None
    return result


def _fresh_locally_evaluated_ids(evaluation: Path, crawling: Path, channel: str,
                                 env: dict[str, str]) -> set[str]:
    """One current content-validated batch, bounded by whole-batch stat snapshots."""
    videos = sorted(_locally_evaluated_ids(evaluation))
    if not videos:
        return set()
    python = env.get('PYTHON_CMD', sys.executable)
    try:
        before = _cache_snapshot(crawling, evaluation, videos, env)
        markers = {video: _latest_object(evaluation / 'evaluation/notSelection' / (video + '.jsonl'))
                   for video in videos}
        shorts = {video for video, marker in markers.items()
                  if marker and marker.get('notSelected_reason') == 'shorts:is_shorts_le_180'}
        fresh = {video for video in shorts if _is_short_video(crawling, video)}
        pending = sorted(set(videos) - shorts)
        crawl_hits = _cache_probe_many(
            ['bash', str(SCRIPTS['chunk']), '--cache-check-many', str(crawling)], pending, env)
        selection_hits = _cache_probe_many(
            [python, str(SCRIPTS['target']), '--cache-check-many', '--channel', channel,
             '--crawling-path', str(crawling), '--evaluation-path', str(evaluation)],
            sorted(crawl_hits), env)
        selected, transform_needed = set(), set()
        for video in sorted(selection_hits):
            marker = markers[video]
            selection = _latest_object(evaluation / 'evaluation/selection' / (video + '.jsonl')) or marker
            targets = selection.get('evaluation_target') if selection else None
            if not isinstance(targets, dict):
                continue
            if any(value is True for value in targets.values()):
                selected.add(video)
            elif marker and marker.get('notSelected_reason') in ('no_restaurants', 'all_names_null'):
                crawl = _latest_object(crawling / 'crawling' / (video + '.jsonl'))
                restaurants = crawl.get('restaurants') if crawl else None
                if marker['notSelected_reason'] == 'no_restaurants':
                    reason = crawl.get('no_restaurant_reason') if crawl else None
                    if restaurants == [] and isinstance(reason, str) and reason.strip():
                        fresh.add(video)
                elif (isinstance(restaurants, list) and restaurants
                      and all(isinstance(row, dict) and not row.get('origin_name') for row in restaurants)):
                    fresh.add(video)
            else:
                transform_needed.add(video)
        rule_hits = _cache_probe_many(
            [python, str(SCRIPTS['rule']), '--cache-check-many', '--channel', channel,
             '--evaluation-path', str(evaluation)], sorted(selected), env)
        laaj_hits = _cache_probe_many(
            ['bash', str(SCRIPTS['laaj']), '--cache-check-many', str(crawling), str(evaluation)],
            sorted(rule_hits), env)
        transform_needed.update(laaj_hits)
        if transform_needed and _cache_probe(
            [python, str(SCRIPTS['transform']), '--cache-check', '--channel', channel,
             '--crawling-path', str(crawling), '--evaluation-path', str(evaluation)], env):
            fresh.update(transform_needed)
        # Stat signatures only detect changes around real content-hash probes;
        # they never authorize reuse by themselves or persist between calls.
        terminal = _locally_evaluated_ids(evaluation)
        return (fresh & terminal if before == _cache_snapshot(crawling, evaluation, videos, env)
                else set())
    except (OSError, ValueError, TypeError):
        return set()


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
    try:
        local_done = _fresh_locally_evaluated_ids(evaluation, crawling, args.channel, env)
    except HostedDataPlaneError:
        print("error=evaluation_output_invalid")
        return 2
    permanent_no_transcript = _permanent_no_transcript_ids()
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
            or video_id in permanent_no_transcript
        ):
            continue
        seen.add(video_id)
        new_urls.append(f"https://www.youtube.com/watch?v={video_id}")
        if len(new_urls) >= args.limit:
            break
    print(f"hostedYoutubeIds={len(hosted)}")
    print(f"localEvaluatedIds={len(local_done)}")
    print(f"permanentNoTranscriptIds={len(permanent_no_transcript)}")
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
    try:
        completed = _fresh_locally_evaluated_ids(evaluation, crawling, args.channel, env)
    except HostedDataPlaneError:
        print("error=evaluation_output_invalid")
        return 2
    incomplete = set(new_ids) - completed
    print(f"completedVideoCount={len(set(new_ids) & completed)}")
    print(f"incompleteVideoCount={len(incomplete)}")
    if incomplete:
        print("error=evaluation_output_incomplete")
        return 1
    print("evaluate=ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
