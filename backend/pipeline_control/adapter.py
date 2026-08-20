"""Numbered-script adapters. Dry-run is default; live mode invokes injected runners."""

from __future__ import annotations

import os
import time
from typing import Any, Callable

from backend.pipeline_control.es_index import index_document
from backend.pipeline_control.events import classify_events_mode, publish
from backend.pipeline_control.metrics import observe, record as record_metric
from backend.pipeline_control.graph import (
    ADAPTER_STEPS,
    CANONICAL_STEP_NAMES,
    SKIP_HEAVY_REASON,
    STEP_SPECS,
    AdapterGraphError,
    build_argv,
    validate_graph,
)
from backend.pipeline_control.profiles import skip_reason_for_step
from backend.pipeline_control.state_machine import RunRecord
from backend.pipeline_control.targets import TargetSchemaError, admitted_target

__all__ = [
    "ADAPTER_STEPS",
    "CANONICAL_STEP_NAMES",
    "SKIP_HEAVY_REASON",
    "execute_dry_run",
    "execute_steps",
]


def emit_raw_document(run: RunRecord, *, step: str, status: str, skipped: bool) -> None:
    index_document(
        {
            "type": "adapter.raw",
            "job_id": run.id,
            "step": step,
            "status": status,
            "skipped": skipped,
            "request_id": run.request_id,
            "payload_hash": run.payload_hash,
        }
    )


def noop_event_sink(event: dict[str, Any]) -> None:
    publish(event)
    if event.get("type") in {"run.lifecycle", "step.progress", "record.upserted"}:
        if classify_events_mode(os.environ.get("TZUDONG_PIPELINE_EVENTS")) != "kafka":
            index_document(event)


def run_daily_helper_dry_run(step: str) -> dict[str, str]:
    from backend.utils import run_daily_helpers as helpers

    _ = helpers
    return {"step": step, "mode": "dry_run"}


def default_live_runner(argv: list[str]) -> int:
    import subprocess

    completed = subprocess.run(argv, check=False)
    return int(completed.returncode)


def skipped_live_steps(compute_profile: str | None = None) -> set[str]:
    skipped: set[str] = set()
    frames = os.environ.get("RUN_DAILY_SKIP_FRAMES", "").strip().lower()
    heavy = os.environ.get("RUN_DAILY_SKIP_HEAVY_COMPUTE", "").strip().lower()
    chunk = os.environ.get("RUN_DAILY_SKIP_CHUNK", "").strip().lower()
    truthy = {"1", "true", "yes"}
    if frames in truthy or heavy in truthy or compute_profile == "lite_gha":
        skipped.add("04-frames")
    if chunk in truthy or heavy in truthy or compute_profile == "lite_gha":
        skipped.add("08-chunk")
    return skipped


def execute_steps(
    run: RunRecord,
    *,
    should_stop: Callable[[], str | None],
    emit: Callable[[dict[str, Any]], None] = noop_event_sink,
    live: bool = False,
    runner: Callable[[list[str]], int] | None = None,
    data_sink: str | None = None,
    compute_profile: str | None = None,
) -> str:
    invoke = runner or default_live_runner
    profile = compute_profile or run.profile
    try:
        target = admitted_target(run.target)
        validate_graph()
    except (AdapterGraphError, TargetSchemaError, ValueError):
        emit({"type": "run.lifecycle", "job_id": run.id, "status": "Failed", "step": "graph"})
        return "Failed"
    capabilities = set(target.get("capabilities") or [])
    env_skips = skipped_live_steps() if live else set()
    blocked: set[str] = set(env_skips)
    required_failed = False
    for index, spec in enumerate(STEP_SPECS):
        halt = should_stop()
        if halt:
            return halt
        skip = skip_reason_for_step(
            spec,
            compute_profile=profile,
            data_sink=data_sink,
            skipped_or_failed=blocked,
            capabilities=capabilities,
        )
        if skip is None and spec.id in env_skips:
            skip = ("optional", SKIP_HEAVY_REASON)
        skipped = skip is not None
        kind, reason = skip if skip is not None else (None, None)
        emit(
            {
                "type": "step.progress",
                "job_id": run.id,
                "step": spec.id,
                "index": index,
                "skipped": skipped,
                "skipKind": kind,
                "reason": reason,
            }
        )
        emit_raw_document(
            run,
            step=spec.id,
            status="skipped" if skipped else "ok",
            skipped=skipped,
        )
        if skipped:
            blocked.add(spec.id)
            run.adapter_index = index + 1
            continue
        if live:
            try:
                argv = build_argv(spec, target=run.target)
            except AdapterGraphError:
                emit({"type": "run.lifecycle", "job_id": run.id, "status": "Failed", "step": spec.id})
                return "Failed"
            started = time.monotonic()
            code = invoke(argv)
            observe("tzudong_pipeline_step_duration_seconds", time.monotonic() - started)
            if code != 0:
                record_metric("tzudong_pipeline_step_failures_total")
                blocked.add(spec.id)
                if spec.id == "08-chunk":
                    required_failed = True
                    run.adapter_index = index + 1
                    continue
                emit({"type": "run.lifecycle", "job_id": run.id, "status": "Failed", "step": spec.id})
                return "Failed"
            if spec.id == "13-supabase-insert":
                emit(
                    {
                        "type": "record.upserted",
                        "job_id": run.id,
                        "step": spec.id,
                        "status": "Succeeded",
                        "index": index,
                    }
                )
        else:
            run_daily_helper_dry_run(spec.id)
        run.adapter_index = index + 1
    if required_failed:
        emit({"type": "run.lifecycle", "job_id": run.id, "status": "Failed", "step": "08-chunk"})
        return "Failed"
    emit({"type": "run.lifecycle", "job_id": run.id, "status": "Succeeded"})
    return "Succeeded"


def execute_dry_run(
    run: RunRecord,
    *,
    should_stop: Callable[[], str | None],
    emit: Callable[[dict[str, Any]], None] = noop_event_sink,
) -> str:
    return execute_steps(run, should_stop=should_stop, emit=emit, live=False)
