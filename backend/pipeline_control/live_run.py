"""Operator live runner: enqueue + claim on one MemoryStore, local DB only."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from backend.pipeline_control.dsn_guard import admit_dsn
from backend.pipeline_control.file_store import FileStore
from backend.pipeline_control.manifest import is_live_execution_success, load_json
from backend.pipeline_control.store import MemoryStore
from backend.pipeline_control.profiles import resolve_compute_profile
from backend.pipeline_control.targets import assert_admitted
from backend.pipeline_control.worker import process_one, write_run_manifest
from backend.pipeline_control.queue import drain

REPO_ROOT = Path(__file__).resolve().parents[2]
CANDIDATE_DIR = REPO_ROOT / "backend" / "log" / "cron" / "live-runs"


def run_once(
    store: MemoryStore,
    *,
    target: str,
    index: int,
    live: bool,
    runner=None,
    queued_dry_run: bool | None = None,
) -> str:
    use_live = live and queued_dry_run is not True
    assert_admitted(target)
    admit_dsn(
        data_env=os.environ.get("TZUDONG_DATA_ENV", "local_db"),
        dsn=os.environ["PIPELINE_CONTROL_DSN"],
    )
    CANDIDATE_DIR.mkdir(parents=True, exist_ok=True)
    manifest = CANDIDATE_DIR / f"run-{index}-current-summary.json"
    try:
        run, _created = store.create_run(
            target=target,
            profile=resolve_compute_profile(),
            idempotency_key=f"liverun{index:02d}-{target}",
            payload={"index": index, "live": live},
            actor="live_run",
            request_id=f"live-{index}",
            dry_run=not use_live,
        )
    except Exception:
        for held in list(store.locks.values()):
            store.finish_failed(held, "stale_live_retry")
        run, _created = store.create_run(
            target=target,
            profile=resolve_compute_profile(),
            idempotency_key=f"liverun{index:02d}-{target}-retry",
            payload={"index": index, "live": live, "retry": True},
            actor="live_run",
            request_id=f"live-{index}",
            dry_run=not use_live,
        )
    result = process_one(
        store,
        live=use_live,
        runner=runner,
        manifest_path=manifest,
    )
    if result is None:
        write_run_manifest("Failed", manifest)
        return "Failed"
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", default=os.environ.get("TZUDONG_PIPELINE_TARGET", "tzuyang"))
    parser.add_argument("--count", type=int, default=int(os.environ.get("TZUDONG_PIPELINE_COUNT", "1")))
    parser.add_argument("--live", action="store_true")
    args = parser.parse_args(argv)
    if "PIPELINE_CONTROL_DSN" not in os.environ:
        raise SystemExit("PIPELINE_CONTROL_DSN required")
    live = bool(args.live) or os.environ.get("TZUDONG_PIPELINE_LIVE", "").strip() in {
        "1",
        "true",
        "TRUE",
        "yes",
    }
    store: MemoryStore = FileStore()
    queued = drain()
    results: list[str] = []
    last_live_manifest = None
    jobs: list[dict] = [{"queued": False} for _ in range(args.count)]
    jobs.extend({"queued": True, **job} for job in queued)
    if not jobs:
        jobs = [{"queued": False}]
    for index, job in enumerate(jobs, start=1):
        target = str(job.get("target") or args.target)
        queued_dry = job.get("dry_run") if job.get("queued") else None
        result = run_once(
            store,
            target=target,
            index=index,
            live=live,
            queued_dry_run=queued_dry,
        )
        results.append(result)
        manifest = CANDIDATE_DIR / f"run-{index}-current-summary.json"
        if manifest.exists():
            try:
                candidate = load_json(manifest)
            except (OSError, ValueError):
                candidate = {}
            if is_live_execution_success(candidate):
                last_live_manifest = manifest
    if last_live_manifest is not None:
        default = Path(__file__).resolve().parents[2] / "backend" / "log" / "cron" / "current-summary.json"
        default.parent.mkdir(parents=True, exist_ok=True)
        default.write_text(last_live_manifest.read_text(encoding="utf-8"), encoding="utf-8")
    print(",".join(results))
    return 0 if all(item == "Succeeded" for item in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
