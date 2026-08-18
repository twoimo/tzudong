"""Numbered-script adapters. Dry-run is default; live mode invokes injected runners."""

from __future__ import annotations
import os

from typing import Any, Callable

from backend.pipeline_control.state_machine import ADAPTER_STEPS, RunRecord
from backend.pipeline_control.events import publish
from backend.pipeline_control.es_index import index_document

STEP_COMMANDS = {
    "01-collect-urls": ["{python}", "backend/restaurant-crawling/scripts/01-collect-urls.py", "--channel", "{target}"],
    "02-collect-meta": ["{python}", "backend/restaurant-crawling/scripts/02-collect-meta.py", "--channel", "{target}"],
    "02-1-migrate": ["{python}", "backend/restaurant-crawling/scripts/02-1-migrate-meta-to-supabase.py", "--channel", "{target}"],
    "02-5-cleanup": ["{python}", "backend/restaurant-crawling/scripts/02-5-cleanup-orphans.py", "--channel", "{target}"],
    "03-transcript": ["node", "backend/restaurant-crawling/scripts/03-collect-transcript.js", "--channel", "{target}"],
    "03-1-context": ["{python}", "backend/restaurant-crawling/scripts/03-1-generate-transcript-context.py", "--channel", "{target}"],
    "04-frames": ["node", "backend/restaurant-crawling/scripts/04-heatmap-and-frames.js", "--channel", "{target}"],
    "06-1-enrich": ["{python}", "backend/restaurant-crawling/scripts/06-1-transcript-document-with-meta.py", "--channel", "{target}"],
    "08-chunk": ["bash", "backend/restaurant-crawling/scripts/08-chunk-multimodal-crawling.sh", "--channel", "{target}"],
    "09-target": ["{python}", "backend/restaurant-evaluation/scripts/09-target-selection.py", "--channel", "{target}", "--crawling-path", "backend/restaurant-crawling/data/{target}", "--evaluation-path", "backend/restaurant-evaluation/data/{target}"],
    "10-rule": ["{python}", "backend/restaurant-evaluation/scripts/10-rule-evaluation.py", "--channel", "{target}", "--evaluation-path", "backend/restaurant-evaluation/data/{target}"],
    "11-laaj": ["bash", "backend/restaurant-evaluation/scripts/11-laaj-evaluation.sh", "--channel", "{target}", "--crawling-path", "backend/restaurant-crawling/data/{target}", "--evaluation-path", "backend/restaurant-evaluation/data/{target}"],
    "12-transform": ["{python}", "backend/restaurant-evaluation/scripts/12-transform.py", "--channel", "{target}", "--crawling-path", "backend/restaurant-crawling/data/{target}", "--evaluation-path", "backend/restaurant-evaluation/data/{target}"],
    "13-supabase-insert": ["{python}", "backend/restaurant-evaluation/scripts/13-supabase-insert.py", "--channel", "{target}", "--evaluation-path", "backend/restaurant-evaluation/data/{target}"],
}

CANONICAL_STEP_NAMES = {
    "01-collect-urls": "Step 1 (URL Collection)",
    "02-collect-meta": "Step 2 (Metadata)",
    "02-1-migrate": "Step 2.1+2.5 (Migration+Cleanup)",
    "02-5-cleanup": "Step 2.1+2.5 (Migration+Cleanup)",
    "03-transcript": "Step 3 (Transcript)",
    "03-1-context": "Step 3.1 (Context Generation)",
    "04-frames": "Step 4 (Heatmap & Frames)",
    "06-1-enrich": "Step 6.1 (Enrich)",
    "08-chunk": "Step 08 (Chunk Multimodal)",
    "09-target": "Step 09 (Target)",
    "10-rule": "Step 10 (Rule Eval)",
    "11-laaj": "Step 11 (LAAJ Evaluation)",
    "12-transform": "Step 12 (Transform)",
    "13-supabase-insert": "Step 13 (Supabase)",
}

SKIP_HEAVY_REASON = "경량 모드(SKIP_HEAVY_COMPUTE) — 로컬 머신에서 실행"


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
        index_document(event)


def run_daily_helper_dry_run(step: str) -> dict[str, str]:
    from backend.utils import run_daily_helpers as helpers

    _ = helpers
    return {"step": step, "mode": "dry_run"}


def default_live_runner(argv: list[str]) -> int:
    import subprocess

    completed = subprocess.run(argv, check=False)
    return int(completed.returncode)
def skipped_live_steps() -> set[str]:
    skipped: set[str] = set()
    frames = os.environ.get("RUN_DAILY_SKIP_FRAMES", "").strip().lower()
    heavy = os.environ.get("RUN_DAILY_SKIP_HEAVY_COMPUTE", "").strip().lower()
    chunk = os.environ.get("RUN_DAILY_SKIP_CHUNK", "").strip().lower()
    truthy = {"1", "true", "yes"}
    if frames in truthy or heavy in truthy:
        skipped.add("04-frames")
    if chunk in truthy or heavy in truthy:
        skipped.add("08-chunk")
    return skipped


def execute_steps(
    run: RunRecord,
    *,
    should_stop: Callable[[], str | None],
    emit: Callable[[dict[str, Any]], None] = noop_event_sink,
    live: bool = False,
    runner: Callable[[list[str]], int] | None = None,
) -> str:
    invoke = runner or default_live_runner
    for index, step in enumerate(ADAPTER_STEPS):
        halt = should_stop()
        if halt:
            return halt
        skipped = live and step in skipped_live_steps()
        emit(
            {
                "type": "step.progress",
                "job_id": run.id,
                "step": step,
                "index": index,
                "skipped": skipped,
            }
        )
        emit_raw_document(
            run,
            step=step,
            status="skipped" if skipped else "ok",
            skipped=skipped,
        )
        if skipped:
            run.adapter_index = index + 1
            continue
        if live:
            python = os.environ.get("PYTHON_CMD", "python3")
            argv = [part.format(target=run.target, python=python) for part in STEP_COMMANDS[step]]
            code = invoke(argv)
            if code != 0:
                emit({"type": "run.lifecycle", "job_id": run.id, "status": "Failed", "step": step})
                return "Failed"
            if step == "13-supabase-insert":
                emit(
                    {
                        "type": "record.upserted",
                        "job_id": run.id,
                        "step": step,
                        "status": "Succeeded",
                        "index": index,
                    }
                )
        else:
            run_daily_helper_dry_run(step)
        run.adapter_index = index + 1
    emit({"type": "run.lifecycle", "job_id": run.id, "status": "Succeeded"})
    return "Succeeded"


def execute_dry_run(
    run: RunRecord,
    *,
    should_stop: Callable[[], str | None],
    emit: Callable[[dict[str, Any]], None] = noop_event_sink,
) -> str:
    return execute_steps(run, should_stop=should_stop, emit=emit, live=False)
