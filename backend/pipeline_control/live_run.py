"""Operator live runner: enqueue + claim on one MemoryStore, local DB only."""

from __future__ import annotations

import argparse
import os
from datetime import datetime, timezone
from pathlib import Path

from backend.pipeline_control.dsn_guard import admit_dsn
from backend.pipeline_control.file_store import FileStore
from backend.pipeline_control.manifest import (
    compare_policy,
    is_live_execution_success,
    load_json,
    record_parity_attempt,
    write_compatible_summary,
)
from backend.pipeline_control.state_machine import ControlPlaneError
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
    queued_run_id: str | None = None,
) -> str:
    use_live = live and queued_dry_run is not True
    assert_admitted(target)
    admit_dsn(
        data_env=os.environ.get("TZUDONG_DATA_ENV", "local_db"),
        dsn=os.environ["PIPELINE_CONTROL_DSN"],
    )
    CANDIDATE_DIR.mkdir(parents=True, exist_ok=True)
    manifest = CANDIDATE_DIR / f"run-{index}-current-summary.json"
    if queued_run_id is not None:
        claimed_id = str(queued_run_id).strip()
        if not claimed_id:
            write_run_manifest(
                "Failed",
                manifest,
                execution_mode="dry_run",
                store=store,
                job_id_scope="api_run",
            )
            return "Failed"
        result = process_one(
            store,
            live=use_live,
            runner=runner,
            manifest_path=manifest,
            run_id=claimed_id,
            job_id_scope="api_run",
        )
        if result is None:
            write_run_manifest(
                "Failed",
                manifest,
                execution_mode="dry_run",
                store=store,
                job_id_scope="api_run",
            )
            return "Failed"
        return result
    profile = resolve_compute_profile()
    mode = "live" if use_live else "dry"
    utc_date = datetime.fromtimestamp(store.now(), timezone.utc).strftime("%Y-%m-%d")
    try:
        run, _created = store.create_run(
            target=target,
            profile=profile,
            idempotency_key=f"liverun{index:02d}-{target}-{profile}-{mode}-{utc_date}",
            payload={"index": index, "live": use_live},
            actor="live_run",
            request_id=f"live-{index}",
            dry_run=not use_live,
        )
    except ControlPlaneError as exc:
        if exc.code != "lock_held":
            raise
        print(f"operation=live_run_refused code={exc.code}")
        write_run_manifest(
            "Failed",
            manifest,
            store=store,
            job_id_scope="worker_execution",
        )
        return "Failed"
    result = process_one(
        store,
        live=use_live,
        runner=runner,
        manifest_path=manifest,
        run_id=run.id,
        job_id_scope="worker_execution",
    )
    if result is None:
        write_run_manifest(
            "Failed",
            manifest,
            run=run,
            store=store,
            job_id_scope="worker_execution",
        )
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
    jobs: list[dict] = []
    queued_jobs = [{"queued": True, **job} for job in queued]
    if queued_jobs:
        jobs.extend(queued_jobs)
    else:
        jobs.extend({"queued": False} for _ in range(args.count))
    if not jobs:
        jobs = [{"queued": False}]
    for index, job in enumerate(jobs, start=1):
        target = str(job.get("target") or args.target)
        queued_dry = job.get("dry_run") if job.get("queued") else None
        queued_id = str(job.get("id") or "").strip() if job.get("queued") else None
        result = run_once(
            store,
            target=target,
            index=index,
            live=live,
            queued_dry_run=queued_dry,
            queued_run_id=queued_id or None,
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
                baseline_path = REPO_ROOT / "backend" / "log" / "cron" / "sh-baseline-current-summary.json"
                ledger_path = REPO_ROOT / "backend" / "log" / "cron" / "pipeline-parity-ledger.json"
                policy_matched = True
                if baseline_path.exists():
                    try:
                        policy_matched = (
                            compare_policy(load_json(baseline_path), candidate).get(
                                "policyMatched"
                            )
                            is True
                        )
                    except (OSError, ValueError, TypeError):
                        policy_matched = False
                record_parity_attempt(
                    ledger_path,
                    matched=policy_matched,
                    candidate=candidate,
                )
    if last_live_manifest is not None:
        default = Path(__file__).resolve().parents[2] / "backend" / "log" / "cron" / "current-summary.json"
        write_compatible_summary(default, load_json(last_live_manifest))
    print(",".join(results))
    return 0 if all(item == "Succeeded" for item in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
