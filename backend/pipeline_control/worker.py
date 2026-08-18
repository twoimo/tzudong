"""Claim loop. Default dry-run; TZUDONG_PIPELINE_LIVE=1 enables numbered-script invocation."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

from backend.pipeline_control.adapter import (
    CANONICAL_STEP_NAMES,
    SKIP_HEAVY_REASON,
    execute_steps,
    noop_event_sink,
)
from backend.pipeline_control.events import KafkaPublishError
from backend.pipeline_control.manifest import write_compatible_summary
from backend.pipeline_control.store import MemoryStore

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = REPO_ROOT / "backend" / "log" / "cron" / "current-summary.json"


def heavy_local_runtime_ready(root: Path | None = None) -> dict[str, bool]:
    base = root or REPO_ROOT
    return {
        "scripts": (base / "backend" / "restaurant-crawling" / "scripts").is_dir(),
        "evaluation": (base / "backend" / "restaurant-evaluation" / "scripts").is_dir(),
        "helpers": (base / "backend" / "utils" / "run_daily_helpers.py").is_file(),
        "nodeHint": True,
        "ffmpegHint": True,
    }


def live_enabled() -> bool:
    return os.environ.get("TZUDONG_PIPELINE_LIVE", "").strip() in {"1", "true", "TRUE", "yes"}


def write_run_manifest(
    run_status: str,
    path: Path | None = None,
    *,
    events: list[dict] | None = None,
) -> Path:
    destination = path or DEFAULT_MANIFEST
    ok = run_status == "Succeeded"
    step_events = []
    optional = []
    failed = []
    downstream = []
    failed_slug = None
    for item in reversed(events or []):
        if item.get("type") == "run.lifecycle" and item.get("status") == "Failed":
            failed_slug = item.get("step")
            break
    saw_group = False
    emitted_migrate = False
    for event in events or []:
        if event.get("type") != "step.progress":
            continue
        slug = str(event.get("step") or "unknown")
        name = CANONICAL_STEP_NAMES.get(slug, slug)
        if slug in {"02-1-migrate", "02-5-cleanup"}:
            if emitted_migrate:
                continue
            emitted_migrate = True
            name = "Step 2.1+2.5 (Migration+Cleanup)"
        if event.get("skipped"):
            step_events.append({"name": name, "status": "optional_skipped", "reason": SKIP_HEAVY_REASON})
            optional.append(f"{name} - {SKIP_HEAVY_REASON}")
        else:
            status = "failed" if run_status == "Failed" and slug == failed_slug else "completed"
            if run_status != "Failed":
                status = "completed"
            step_events.append({"name": name, "status": status})
            if status == "failed":
                failed.append(name)
        if slug in {"03-transcript", "03-1-context", "04-frames"}:
            saw_group = True
    if saw_group:
        step_events.append(
            {
                "name": "Step 3+4 (Transcript+Frames+Context)",
                "status": "completed" if run_status != "Failed" else "failed",
            }
        )
    if not step_events:
        step_events = [{"name": "pipeline-control-adapter", "status": "completed" if ok else "failed"}]
        if not ok:
            failed = [f"adapter {run_status}"]
    payload = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "finalStatus": "OK" if ok else "ERROR",
        "finalExitCode": 0 if ok else 1,
        "failedRequiredSteps": failed,
        "optionalSkips": optional,
        "downstreamSkips": downstream,
        "latestLogPath": "backend/log/cron/pipeline-control.log",
        "summaryPath": "summary.md",
        "noWorkShortCircuit": False,
        "policyMode": os.environ.get("RUN_DAILY_POLICY_MODE", "end_to_end"),
        "stepEvents": step_events,
        "runtime": {
            "executionBranch": "pipeline-control",
            "targetBranch": os.environ.get("RUN_DAILY_TARGET_BRANCH", "data"),
        },
    }
    return write_compatible_summary(destination, payload)


def process_one(
    store: MemoryStore,
    *,
    live: bool | None = None,
    runner=None,
    manifest_path: Path | None = None,
) -> str | None:
    run = store.claim()
    if run is None:
        return None

    def should_stop() -> str | None:
        current = store.get(run.id)
        if current.status == "Cancelled":
            return "Cancelled"
        if current.status == "Paused":
            return "Paused"
        store.beat(run.id)
        return None

    use_live = live_enabled() if live is None else live
    collected: list[dict] = []

    def emit(event: dict) -> None:
        collected.append(event)
        noop_event_sink(event)

    try:
        result = execute_steps(
            run,
            should_stop=should_stop,
            emit=emit,
            live=use_live and not run.dry_run,
            runner=runner,
        )
    except KafkaPublishError as exc:
        store.finish_failed(run.id, exc.code)
        write_run_manifest("Failed", manifest_path, events=collected)
        return "Failed"
    if result == "Succeeded":
        store.finish_dry_run(run.id)
    elif result == "Failed":
        store.finish_failed(run.id)
    write_run_manifest(result, manifest_path, events=collected)
    return result


def main() -> int:
    from backend.pipeline_control.live_run import main as live_main

    profile = os.environ.get("TZUDONG_COMPUTE_PROFILE", "heavy_local")
    if profile == "heavy_local" and not all(heavy_local_runtime_ready().values()):
        raise SystemExit("heavy_local_runtime_missing")
    return live_main()


if __name__ == "__main__":
    raise SystemExit(main())
