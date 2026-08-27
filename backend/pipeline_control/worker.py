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
from backend.pipeline_control.live_evidence import (
    canonical_sha256,
    independent_local_db_snapshots,
    same_run_id_verified,
)
from backend.pipeline_control.manifest import (
    LIVE_EVIDENCE_FIELDS,
    LIVE_EVIDENCE_SCHEMA,
    build_operator_summary,
    cadence_window_for_profile,
    derive_window_overrun,
    empty_reflection_accounting,
    final_status_for,
    is_live_evidence_eligible,
    is_live_execution_success,
    map_hosted_gate_rejection_code,
    normalize_missed_window_count,
    normalize_reflection_accounting,
    validate_hosted_gate_rejection_code,
    write_compatible_summary,
)
from backend.pipeline_control.schedule import (
    ERROR_WINDOW_SHAPE_INVALID,
    validate_cadence,
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
DEFAULT_CADENCE_CONFIG = REPO_ROOT / "backend" / "pipeline_control" / "cadence.schedule.json"
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


def _load_cadence_config(path: Path) -> object:
    """Read the committed cadence config, fail closed on any read/parse error.

    A missing, unreadable, or non-JSON config is not a valid schedule, so the
    caller must treat it as a rejection rather than proceeding. No provider or
    filesystem diagnostics are surfaced.
    """

    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return None


def cadence_preflight(path: Path | None = None) -> None:
    """Fail-closed cadence preflight for the runner/entrypoint.

    Validates the committed cadence configuration before any runner or step is
    triggered. On rejection the process halts and surfaces only the bounded
    ``errorCode`` and the conflicting window labels — no provider, filesystem,
    or free-form diagnostics.
    """

    config = _load_cadence_config(path or DEFAULT_CADENCE_CONFIG)
    result = validate_cadence(config)
    if result.get("ok"):
        return
    error_code = result.get("errorCode") or ERROR_WINDOW_SHAPE_INVALID
    conflicting = result.get("conflictingWindows") or []
    windows = ",".join(str(label) for label in conflicting)
    raise SystemExit(f"cadence_invalid:{error_code}:{windows}")


def _load_env_contract_module():
    """Load ``backend/bin/check_env_contract.py`` as a module.

    ``backend/bin`` is a script directory (not a package), so the env-contract
    validator is loaded by file location the same way its tests do. Returns
    ``None`` when the checker cannot be located/loaded so the caller fails
    closed.
    """

    import importlib.util

    checker_path = REPO_ROOT / "backend" / "bin" / "check_env_contract.py"
    spec = importlib.util.spec_from_file_location(
        "check_env_contract", checker_path
    )
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def env_contract_preflight(profile: str = "pipeline-control") -> None:
    """Fail-closed env-contract preflight for the runner/entrypoint (R6.10, R7.2).

    Validates the mapped env-contract profile before any pipeline step. On a
    missing required secret or a forbidden legacy name the process halts and
    surfaces only canonical secret names (never any value), matching the
    contract validator's names+presence-only reporting.
    """

    module = _load_env_contract_module()
    if module is None:
        raise SystemExit("env_contract_unavailable")
    report = module.validate(profile, dict(os.environ))
    if report.get("ok"):
        return
    missing = ",".join(report.get("missingRequired") or [])
    forbidden = ",".join(report.get("forbiddenPresent") or [])
    raise SystemExit(
        f"env_contract_invalid:{profile}:missing={missing}:forbidden={forbidden}"
    )


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
    store: MemoryStore | None = None,
    job_id_scope: str = "worker_execution",
    hosted_gate_rejection_code: str | None = None,
    missed_window_count: int = 0,
    reflection: dict | None = None,
    cadence_config_path: Path | None = None,
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
        "finalStatus": final_status_for(run_status),
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
        "jobIdScope": (
            job_id_scope if job_id_scope in {"api_run", "worker_execution"} else "worker_execution"
        ),
        # FileStore GET SoT: true only when enqueue, claim, and success share
        # one job id on the same store. Overlay compose must not add Postgres.
        "sameRunIdVerified": same_run_id_verified(store, run),
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
    input_provenance = payload["hashProvenance"]["inputSha256"]
    output_provenance = payload["hashProvenance"]["outputSha256"]
    if ok and execution_mode == "live" and data_sink == "local_db":
        snapshots = independent_local_db_snapshots()
        if (
            len(snapshots) == 3
            and snapshots[0] == snapshots[1] == snapshots[2]
        ):
            baseline_sha, baseline_count = snapshots[0]
            candidate_sha, candidate_count = snapshots[1]
            readback_sha, readback_count = snapshots[2]
            payload["evidenceSchemaVersion"] = LIVE_EVIDENCE_SCHEMA
            payload["baselineSha256"] = baseline_sha
            payload["candidateSha256"] = candidate_sha
            payload["readbackSha256"] = readback_sha
            payload["baselineRowCount"] = baseline_count
            payload["candidateRowCount"] = candidate_count
            payload["readbackRowCount"] = readback_count
            if payload["inputSha256"] is None:
                payload["inputSha256"] = baseline_sha
                input_provenance = "local_db.restaurants.snapshot"
            if payload["outputSha256"] is None:
                payload["outputSha256"] = readback_sha
                output_provenance = "local_db.restaurants.snapshot"
    payload["hashProvenance"]["inputSha256"] = input_provenance
    payload["hashProvenance"]["outputSha256"] = output_provenance
    receipt_fields = {
        field: payload.get(field)
        for field in LIVE_EVIDENCE_FIELDS
        if field != "evidenceReceiptSha256"
    }
    if payload.get("evidenceSchemaVersion") == LIVE_EVIDENCE_SCHEMA:
        payload["evidenceReceiptSha256"] = canonical_sha256(receipt_fields)
    payload["liveExecutionSucceeded"] = is_live_execution_success(payload)
    payload["liveEvidenceEligible"] = is_live_evidence_eligible(payload)

    # Additive, bounded, secret-free orchestration fields (R5.8, R3.7, R1.7,
    # R6.2, R4.4). ``failedRequiredSteps`` already records failed required steps
    # by fixed canonical id only; the summary reports their count.
    compute_profile = run.profile if run is not None else None
    window_start, window_end = cadence_window_for_profile(
        compute_profile, config_path=cadence_config_path
    )
    payload["windowStart"] = window_start
    payload["windowEnd"] = window_end
    payload["windowOverrun"] = derive_window_overrun(
        window_end, payload["generatedAt"]
    )
    payload["hostedGateRejectionCode"] = validate_hosted_gate_rejection_code(
        hosted_gate_rejection_code
    )
    payload["missedWindowCount"] = normalize_missed_window_count(missed_window_count)
    payload["reflection"] = (
        empty_reflection_accounting()
        if reflection is None
        else normalize_reflection_accounting(reflection)
    )
    payload["operatorSummary"] = build_operator_summary(
        final_status=payload["finalStatus"],
        execution_mode=execution_mode,
        data_sink=data_sink,
        failed_required_count=len(failed),
    )
    return write_compatible_summary(destination, payload)


def process_one(
    store: MemoryStore,
    *,
    live: bool | None = None,
    runner=None,
    manifest_path: Path | None = None,
    run_id: str | None = None,
    job_id_scope: str = "worker_execution",
) -> str | None:
    run = store.claim(run_id) if run_id is not None else store.claim()
    if run is None:
        return None
    if run_id is not None and run.id != run_id:
        store.finish_failed(run.id, "run_id_mismatch")
        write_run_manifest(
            "Failed",
            manifest_path,
            run=run,
            execution_mode="dry_run",
            store=store,
            job_id_scope="api_run",
        )
        return "Failed"

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
        rejection_code = map_hosted_gate_rejection_code(
            profile=run.profile,
            execution_mode=execution_mode,
        )
        write_run_manifest(
            "Failed",
            manifest_path,
            run=run,
            execution_mode=execution_mode,
            store=store,
            job_id_scope=job_id_scope,
            hosted_gate_rejection_code=rejection_code,
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
            store=store,
            job_id_scope=job_id_scope,
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
            store=store,
            job_id_scope=job_id_scope,
        )
        return "Failed"
    if result == "Succeeded":
        if execution_mode == "live":
            store.finish_succeeded(run.id)
        else:
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
        store=store,
        job_id_scope=job_id_scope,
    )
    return result


def main() -> int:
    from backend.pipeline_control.live_run import main as live_main
    from backend.pipeline_control.health import write_health_report

    # Fail-closed preflight (before any step): reject an invalid cadence config
    # (R1.6) and an unsatisfied env contract (R6.10, R7.2).
    cadence_preflight()
    env_contract_preflight("pipeline-control")
    profile = resolve_compute_profile()
    if profile == "heavy_local" and not all(heavy_local_runtime_ready().values()):
        raise SystemExit("heavy_local_runtime_missing")
    exit_code = live_main()
    # Govern run-health reporting with the staleness/absence rule (R5.7): a
    # stale or absent Run_Manifest is reported as not-Succeeded. Writing the
    # health outcome must never mask the pipeline's own exit code.
    try:
        write_health_report()
    except Exception:
        pass
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
