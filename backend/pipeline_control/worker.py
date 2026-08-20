"""Claim loop. Default dry-run; TZUDONG_PIPELINE_LIVE=1 enables numbered-script invocation."""

from __future__ import annotations

from contextlib import contextmanager
from hashlib import sha256
import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from backend.pipeline_control.adapter import (
    CANONICAL_STEP_NAMES,
    SKIP_HEAVY_REASON,
    execute_steps,
    noop_event_sink,
)
from backend.pipeline_control.graph import AdapterGraphError
from backend.pipeline_control.profiles import ProfileError, resolve_compute_profile
from backend.pipeline_control.events import KafkaPublishError
from backend.pipeline_control.es_index import EsIndexError
from backend.pipeline_control.manifest import (
    is_live_evidence_eligible,
    is_live_execution_success,
    write_compatible_summary,
)
from backend.pipeline_control.state_machine import RunRecord
from backend.pipeline_control.store import MemoryStore
from backend.utils.supabase_rest import (
    PIPELINE_COMPUTE_PROFILE_ENV,
    PIPELINE_DATA_SINK_ENV,
    PIPELINE_EXECUTION_MODE_ENV,
    SupabaseRestConfigurationError,
    admit_pipeline_supabase_boundary,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = REPO_ROOT / "backend" / "log" / "cron" / "current-summary.json"
_SHA256_RE = re.compile(r"[0-9a-f]{64}")
_GIT_SHA_RE = re.compile(r"(?:[0-9a-f]{40}|[0-9a-f]{64})")
_MISSING_ENVIRONMENT_VALUE = object()


@contextmanager
def _bound_pipeline_execution_environment(
    *,
    data_sink: str,
    execution_mode: str,
    compute_profile: str,
):
    """Bind the admitted boundary for every numbered-script subprocess.

    Some legacy scripts load ``backend/.env`` only after the worker preflight.
    Keeping the authoritative classification in the inherited environment
    ensures their shared credential resolver still rejects a late hosted URL
    before importing a network-capable Supabase SDK. Exact prior values are
    restored so an injected runner or failed step cannot leak classification
    into a later job.
    """

    bindings = {
        PIPELINE_DATA_SINK_ENV: data_sink,
        PIPELINE_EXECUTION_MODE_ENV: execution_mode,
        PIPELINE_COMPUTE_PROFILE_ENV: compute_profile,
    }
    previous: dict[str, str | object] = {
        name: os.environ.get(name, _MISSING_ENVIRONMENT_VALUE) for name in bindings
    }
    os.environ.update(bindings)
    try:
        yield
    finally:
        for name, value in previous.items():
            if value is _MISSING_ENVIRONMENT_VALUE:
                os.environ.pop(name, None)
            else:
                os.environ[name] = str(value)


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


def _bounded_sha256(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    return normalized if _SHA256_RE.fullmatch(normalized) is not None else None


def _git_sha() -> str | None:
    configured = os.environ.get("RUN_DAILY_EXECUTION_SHA")
    if configured is not None:
        normalized = configured.strip().lower()
        return normalized if _GIT_SHA_RE.fullmatch(normalized) is not None else None
    try:
        completed = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=REPO_ROOT,
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    normalized = completed.stdout.strip().lower()
    if completed.returncode != 0 or _GIT_SHA_RE.fullmatch(normalized) is None:
        return None
    return normalized


def _step_evidence_sha256(run_status: str, step_events: list[dict]) -> str:
    canonical = json.dumps(
        {"runStatus": run_status, "stepEvents": step_events},
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    )
    return sha256(canonical.encode("utf-8")).hexdigest()


def write_run_manifest(
    run_status: str,
    path: Path | None = None,
    *,
    events: list[dict] | None = None,
    run: RunRecord | None = None,
    execution_mode: str = "dry_run",
    data_sink: str | None = None,
) -> Path:
    if execution_mode not in {"dry_run", "live"}:
        raise ValueError("execution_mode_invalid")
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
            skip_kind = event.get("skipKind") or "optional"
            reason = str(event.get("reason") or SKIP_HEAVY_REASON)
            status = "downstream_skipped" if skip_kind == "downstream" else "optional_skipped"
            step_events.append({"name": name, "status": status, "reason": reason})
            if status == "downstream_skipped":
                downstream.append(f"{name} - {reason}")
            else:
                optional.append(f"{name} - {reason}")
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
    input_sha = _bounded_sha256(os.environ.get("RUN_DAILY_INPUT_SHA256"))
    output_sha = _bounded_sha256(os.environ.get("RUN_DAILY_OUTPUT_SHA256"))
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
        "jobId": run.id if run is not None else None,
        "jobIdScope": "worker_execution",
        # The Slice-0 FileStore/queue bridge does not preserve the API-created
        # ID.  P2 must set this true only after one PostgreSQL run ID survives
        # enqueue, claim, checkpoint, manifest, readback, and audit.
        "sameRunIdVerified": False,
        "executionMode": execution_mode,
        "dataSink": data_sink,
        "computeProfile": run.profile if run is not None else None,
        "target": run.target if run is not None else None,
        "gitSha": _git_sha(),
        # These fields are reserved for hashes of frozen pipeline input and
        # verified output/readback.  Never substitute a request or manifest hash
        # and accidentally make incomplete evidence look like N=3 proof.
        "inputSha256": input_sha,
        "outputSha256": output_sha,
        "evidenceSchemaVersion": None,
        "baselineSha256": None,
        "candidateSha256": None,
        "readbackSha256": None,
        "evidenceReceiptSha256": None,
        "baselineRowCount": None,
        "candidateRowCount": None,
        "readbackRowCount": None,
        "requestPayloadSha256": _bounded_sha256(
            run.payload_hash if run is not None else None
        ),
        "stepEvidenceSha256": _step_evidence_sha256(run_status, step_events),
        "hashProvenance": {
            "inputSha256": "RUN_DAILY_INPUT_SHA256" if input_sha is not None else "unavailable",
            "outputSha256": "RUN_DAILY_OUTPUT_SHA256" if output_sha is not None else "unavailable",
        },
        "runtime": {
            "executionBranch": "pipeline-control",
            "targetBranch": os.environ.get("RUN_DAILY_TARGET_BRANCH", "data"),
        },
    }
    payload["liveExecutionSucceeded"] = is_live_execution_success(payload)
    payload["liveEvidenceEligible"] = is_live_evidence_eligible(payload)
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
        checkpoint = getattr(store, "checkpoint", None)
        if checkpoint is not None:
            current = checkpoint(run.id, adapter_index=run.adapter_index)
        else:
            current = store.get(run.id)
            store.beat(run.id)
        if current.status == "Cancelled":
            return "Cancelled"
        if current.status == "Paused":
            return "Paused"
        return None

    use_live = live_enabled() if live is None else live
    execution_mode = "live" if use_live and not run.dry_run else "dry_run"
    try:
        boundary = admit_pipeline_supabase_boundary(
            profile=run.profile,
            execution_mode=execution_mode,
        )
        data_sink = boundary.data_sink
    except SupabaseRestConfigurationError:
        store.finish_failed(run.id, "supabase_data_boundary_rejected")
        write_run_manifest(
            "Failed",
            manifest_path,
            run=run,
            execution_mode=execution_mode,
        )
        return "Failed"
    collected: list[dict] = []

    def emit(event: dict) -> None:
        collected.append(event)
        noop_event_sink(event)

    try:
        with _bound_pipeline_execution_environment(
            data_sink=data_sink,
            execution_mode=execution_mode,
            compute_profile=run.profile,
        ):
            result = execute_steps(
                run,
                should_stop=should_stop,
                emit=emit,
                live=use_live and not run.dry_run,
                runner=runner,
                data_sink=data_sink,
                compute_profile=run.profile,
            )
    except (KafkaPublishError, AdapterGraphError, ProfileError) as exc:
        store.finish_failed(run.id, exc.code)
        write_run_manifest(
            "Failed",
            manifest_path,
            events=collected,
            run=run,
            execution_mode=execution_mode,
            data_sink=data_sink,
        )
        return "Failed"
    except EsIndexError as exc:
        store.finish_failed(run.id, exc.code)
        write_run_manifest(
            "Failed",
            manifest_path,
            events=collected,
            run=run,
            execution_mode=execution_mode,
            data_sink=data_sink,
        )
        return "Failed"
    if result == "Succeeded":
        store.finish_dry_run(run.id)
    elif result == "Failed":
        store.finish_failed(run.id)
    write_run_manifest(
        result,
        manifest_path,
        events=collected,
        run=run,
        execution_mode=execution_mode,
        data_sink=data_sink,
    )
    return result


def main() -> int:
    from backend.pipeline_control.live_run import main as live_main

    profile = resolve_compute_profile()
    if profile == "heavy_local" and not all(heavy_local_runtime_ready().values()):
        raise SystemExit("heavy_local_runtime_missing")
    return live_main()


if __name__ == "__main__":
    raise SystemExit(main())
