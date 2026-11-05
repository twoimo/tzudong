#!/usr/bin/env python3
"""Incrementally monitor sanitized GitHub Actions timing observations.

The monitor accepts retained JSON exports; it never calls GitHub, retries a
workflow, or mutates remote state.  It stores only bounded timing/count
metadata in an atomic checkpoint and receipt.  Previously retained baselines
are inputs and are never rewritten.

For ``r`` newly supplied runs, ``j`` jobs, and ``s`` steps, normalization and
aggregation are O(r * (j + s)).  A checkpoint makes each duplicate lookup O(1)
and avoids re-reading earlier input artifacts; the bounded JSON checkpoint
still costs O(H) to read and write for H retained runs.  Bootstrap comparison
is separate and costs O(B * (n_before + n_after)) for B bounded resamples and
the selected source-tree clusters.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
import re
import statistics
import sys
import tempfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence


SCRIPT_DIR = Path(__file__).resolve().parent
COLLECTOR_PATH = SCRIPT_DIR / "collect-ci-performance.py"
SCHEMA_VERSION = "tzudong-ci-performance-monitor/v1"
DEFAULT_MAX_INPUT_RUNS = 100
MAX_INPUT_RUNS = 2_500  # 2,000 collector attempts plus a bounded frozen baseline.
DEFAULT_MAX_CHECKPOINT_RUNS = 5_000
DEFAULT_BOOTSTRAP_RESAMPLES = 10_000
DEFAULT_BOOTSTRAP_SEED = 20_261_011
MIN_COHORT_SUCCESSES = 7
DEFAULT_MIN_SOURCE_CLUSTERS = 7
DEFAULT_P95_SOURCE_CLUSTERS = 20
MAX_BOOTSTRAP_RESAMPLES = 100_000
SAFE_WORKFLOW_PATH = re.compile(r"^[A-Za-z0-9_./-]{1,200}$")
SAFE_SHA = re.compile(r"^[0-9a-fA-F]{40}$")
SAFE_GIT_OBJECT_ID = re.compile(r"^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$")
SAFE_SHA256 = re.compile(r"^[0-9a-fA-F]{64}$")
SAFE_EVENT = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
VERIFIED_WORKFLOW_EVENTS = {
    "pull_request",
    "push",
    "schedule",
    "workflow_dispatch",
}
MONITORED_JOB_NAMES = {
    "Admin",
    "Install",
    "Ubuntu Bun",
    "Ubuntu npm",
    "Windows Bun",
    "Windows npm",
}
PLATFORM_JOB_NAMES = {"Ubuntu Bun", "Ubuntu npm", "Windows Bun", "Windows npm"}
VALID_CONCLUSIONS = {
    "success",
    "failure",
    "cancelled",
    "skipped",
    "timed_out",
    "action_required",
    "neutral",
    "stale",
    "startup_failure",
    "missing",
}
TERMINAL_CONCLUSIONS = VALID_CONCLUSIONS - {"missing"}
FAILURE_CONCLUSIONS = {
    "failure",
    "cancelled",
    "timed_out",
    "action_required",
    "stale",
    "startup_failure",
}


class MonitorError(RuntimeError):
    """Raised when an input cannot be safely admitted."""


class ChronologyError(MonitorError):
    """Raised when run and job timestamps violate their required ordering."""


CHRONOLOGY_CODES = {
    "CRITICAL_PATH_NEGATIVE",
    "JOB_COMPLETION_PRECEDES_JOB_CREATION",
    "JOB_COMPLETION_PRECEDES_JOB_START",
    "JOB_START_PRECEDES_JOB_CREATION",
    "JOB_START_PRECEDES_RUN_START",
    "JOB_COMPLETION_FOLLOWS_RUN_UPDATE",
    "JOB_TIMESTAMP_PRECEDES_RUN_CREATION",
    "RUN_START_PRECEDES_RUN_CREATION",
    "RUN_UPDATE_PRECEDES_RUN_CREATION",
    "RUN_UPDATE_PRECEDES_RUN_START",
    "STEP_COMPLETION_PRECEDES_STEP_START",
    "STEP_TIMESTAMP_FOLLOWS_JOB_COMPLETION",
    "STEP_TIMESTAMP_PRECEDES_JOB_START",
    "STEP_TIMESTAMP_PRECEDES_RUN_CREATION",
}


def record_chronology_issue(
    issue_codes: set[str], phase: str, code: str
) -> None:
    """Fail closed for frozen input; retain current-window defects as codes."""
    if code not in CHRONOLOGY_CODES:
        raise MonitorError("unknown chronology issue code")
    if phase == "before":
        raise ChronologyError(code)
    issue_codes.add(code)


def _load_collector() -> Any:
    spec = importlib.util.spec_from_file_location("tzudong_collect_ci", COLLECTOR_PATH)
    if spec is None or spec.loader is None:
        raise MonitorError("unable to load the existing CI collector")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


COLLECTOR = _load_collector()


DEFAULT_THRESHOLDS = {
    "criticalPathSeconds": {"absoluteSeconds": 30.0, "relativePercent": 5.0},
    "runnerOccupiedSeconds": {"absoluteSeconds": 120.0, "relativePercent": 5.0},
    "maxQueueSeconds": {"absoluteSeconds": 20.0, "relativePercent": 25.0},
}


def canonical_json(value: Any) -> bytes:
    return COLLECTOR.canonical_json(value)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = canonical_json(value)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        directory_descriptor = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    finally:
        if temporary.exists():
            temporary.unlink()


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise MonitorError(f"invalid JSON input: {path}") from error


def get_first(mapping: dict[str, Any], *names: str) -> Any:
    for name in names:
        if name in mapping:
            return mapping[name]
    return None


def run_attempt(mapping: dict[str, Any]) -> int:
    """Default an absent attempt to one, but reject an invalid supplied value."""
    for name in ("attempt", "run_attempt", "runAttempt"):
        if name in mapping:
            attempt = mapping[name]
            break
    else:
        attempt = 1
    if not isinstance(attempt, int) or isinstance(attempt, bool) or attempt < 1:
        raise MonitorError("run attempt must be a positive integer")
    return attempt


def safe_workflow(value: Any, fallback: str) -> str:
    candidate = str(value or fallback)
    if not SAFE_WORKFLOW_PATH.fullmatch(candidate) or ".." in candidate.split("/"):
        raise MonitorError("workflow identifier contains unsafe characters")
    return candidate


def safe_event(value: Any) -> str:
    candidate = str(value or "unknown")
    return candidate if SAFE_EVENT.fullmatch(candidate) else "unknown"


def safe_sha(value: Any) -> str | None:
    candidate = str(value or "")
    return candidate.lower() if SAFE_SHA.fullmatch(candidate) else None


def safe_git_object_id(value: Any) -> str | None:
    candidate = str(value or "")
    return candidate.lower() if SAFE_GIT_OBJECT_ID.fullmatch(candidate) else None


def safe_sha256(value: Any) -> str | None:
    candidate = str(value or "")
    return candidate.lower() if SAFE_SHA256.fullmatch(candidate) else None


def runner_family(labels: Iterable[Any]) -> str:
    lowered = " ".join(str(label).lower() for label in labels if label)
    if "ubuntu" in lowered or "linux" in lowered:
        return "linux"
    if "windows" in lowered:
        return "windows"
    if "macos" in lowered or "darwin" in lowered:
        return "macos"
    if "self-hosted" in lowered:
        return "self-hosted"
    return "unknown"


def parse_timestamp(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as error:
        raise MonitorError("malformed timestamp") from error
    if parsed.tzinfo is None:
        raise MonitorError("timestamp lacks timezone")
    return parsed.astimezone(timezone.utc)


def duration_seconds(start: Any, end: Any) -> float | None:
    start_time = parse_timestamp(start)
    end_time = parse_timestamp(end)
    if start_time is None or end_time is None:
        return None
    duration = (end_time - start_time).total_seconds()
    if duration < 0:
        raise MonitorError("negative duration")
    return duration


def normalize_step(step: dict[str, Any]) -> dict[str, Any]:
    # Names are sanitized for classification only and are never persisted.
    name = COLLECTOR.sanitize_step_name(get_first(step, "name") or "")
    return {
        "name": name,
        "status": str(get_first(step, "status") or "missing"),
        "conclusion": str(get_first(step, "conclusion") or "missing"),
        "startedAt": get_first(step, "startedAt", "started_at"),
        "completedAt": get_first(step, "completedAt", "completed_at"),
    }


def normalize_job(job: dict[str, Any]) -> dict[str, Any]:
    labels = get_first(job, "runnerLabels", "labels") or []
    if not isinstance(labels, list):
        labels = []
    steps = get_first(job, "steps")
    if steps is None:
        steps = []
    if not isinstance(steps, list):
        raise MonitorError("job steps must be a list")
    if any(not isinstance(step, dict) for step in steps):
        raise MonitorError("job steps must contain only objects")
    raw_name = str(get_first(job, "name") or "")
    return {
        "name": raw_name if raw_name in MONITORED_JOB_NAMES else "Other job",
        "status": str(get_first(job, "status") or "missing"),
        "conclusion": str(get_first(job, "conclusion") or "missing"),
        "createdAt": get_first(job, "createdAt", "created_at"),
        "startedAt": get_first(job, "startedAt", "started_at"),
        "completedAt": get_first(job, "completedAt", "completed_at"),
        "runnerFamily": runner_family(labels),
        "steps": [normalize_step(step) for step in steps],
    }


def incremental_digest(value: Any) -> str:
    payload = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
    return sha256_bytes(payload)


def derived_execution_mode(jobs: list[dict[str, Any]]) -> str:
    platform_jobs = [job for job in jobs if job["name"] in PLATFORM_JOB_NAMES]
    if {job["name"] for job in platform_jobs} != PLATFORM_JOB_NAMES:
        return "unknown"
    benchmark_jobs = {
        job["name"]
        for job in platform_jobs
        if any(
            COLLECTOR.classify_step(step["name"]) == "benchmark_report"
            and step["conclusion"] not in {"missing", "skipped"}
            for step in job["steps"]
        )
    }
    diagnostic_jobs = {
        job["name"]
        for job in platform_jobs
        if any(
            COLLECTOR.classify_step(step["name"]) == "typecheck"
            and step["conclusion"] not in {"missing", "skipped"}
            for step in job["steps"]
        )
    }
    if benchmark_jobs == PLATFORM_JOB_NAMES:
        return "full_benchmark"
    if not benchmark_jobs and diagnostic_jobs == PLATFORM_JOB_NAMES:
        return "diagnostic"
    return "unknown"


def require_object_list(value: Any, context: str) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise MonitorError(f"{context} must be a list")
    if any(not isinstance(item, dict) for item in value):
        raise MonitorError(f"{context} must contain only objects")
    return value


def extract_records(payload: Any) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    metadata: dict[str, Any] = {}
    if isinstance(payload, list):
        return require_object_list(payload, "run list"), metadata
    if not isinstance(payload, dict):
        raise MonitorError("input root must be an object or run list")

    workflow = payload.get("workflow")
    if isinstance(workflow, dict):
        metadata["workflow"] = workflow.get("path") or workflow.get("id")
    elif workflow:
        metadata["workflow"] = workflow

    if "workflow_runs" in payload:
        workflow_runs = require_object_list(payload["workflow_runs"], "workflow_runs")
        jobs_by_run = payload.get("jobsByRunId") or payload.get("jobs_by_run_id") or {}
        records = []
        for item in workflow_runs:
            record = dict(item)
            run_id = str(get_first(record, "id", "databaseId") or "")
            if not record.get("jobs") and isinstance(jobs_by_run, dict):
                record["jobs"] = jobs_by_run.get(run_id) or jobs_by_run.get(
                    get_first(record, "id", "databaseId")
                ) or []
            records.append(record)
        return records, metadata

    if "observations" in payload:
        observations = require_object_list(payload["observations"], "observations")
        records = []
        for item in observations:
            run = item.get("run")
            if not isinstance(run, dict):
                raise MonitorError("observation run must be an object")
            records.append(run)
        return records, metadata
    if "runs" in payload:
        return require_object_list(payload["runs"], "runs"), metadata
    if get_first(payload, "id", "databaseId") is not None:
        return [payload], metadata
    raise MonitorError("input contains no recognizable runs")


def analyze_record(
    record: dict[str, Any],
    phase: str,
    workflow: str,
    workflow_metadata_verified: bool,
    source_fingerprint: str,
) -> dict[str, Any]:
    run_id = get_first(record, "id", "databaseId", "runId")
    if not isinstance(run_id, int) or isinstance(run_id, bool) or run_id < 1:
        raise MonitorError("run id must be a positive integer")
    conclusion = str(get_first(record, "conclusion") or "missing").lower()
    if conclusion not in VALID_CONCLUSIONS:
        conclusion = "missing"
    status = str(get_first(record, "status") or "missing").lower()
    attempt = run_attempt(record)
    event = safe_event(get_first(record, "event"))
    head_sha = safe_sha(get_first(record, "headSha", "head_sha", "headShaOid"))
    source_tree = safe_git_object_id(get_first(record, "sourceTree", "source_tree"))
    workflow_revision = safe_git_object_id(
        get_first(record, "workflowRevision", "workflow_revision")
    )
    claimed_job_topology = safe_sha256(
        get_first(record, "jobTopology", "job_topology")
    )
    claimed_execution_mode = str(
        get_first(record, "executionMode", "execution_mode") or "unknown"
    )
    if claimed_execution_mode not in {"full_benchmark", "diagnostic", "unknown"}:
        claimed_execution_mode = "unknown"
    tombstone = bool(get_first(record, "tombstone"))
    jobs_container = get_first(record, "jobs")
    jobs_total_count = get_first(record, "jobsTotalCount", "jobs_total_count")
    if isinstance(jobs_container, dict):
        jobs_total_count = get_first(jobs_container, "total_count", "totalCount")
        jobs_raw = jobs_container.get("jobs")
    else:
        jobs_raw = jobs_container
    jobs_raw = require_object_list(jobs_raw, "run jobs")
    jobs_attempt = get_first(record, "jobsAttempt", "jobs_attempt")
    jobs_complete = bool(
        isinstance(jobs_total_count, int)
        and not isinstance(jobs_total_count, bool)
        and jobs_total_count == len(jobs_raw)
        and isinstance(jobs_attempt, int)
        and not isinstance(jobs_attempt, bool)
        and jobs_attempt > 0
        and jobs_attempt == attempt
    )
    jobs = [normalize_job(job) for job in jobs_raw]
    derived_job_topology = incremental_digest(
        sorted(job["name"] for job in jobs)
    )
    derived_mode = derived_execution_mode(jobs)
    job_topology = (
        derived_job_topology
        if claimed_job_topology == derived_job_topology
        else None
    )
    execution_mode = (
        derived_mode if claimed_execution_mode == derived_mode else "unknown"
    )
    attempt_boundary_verified = get_first(
        record, "attemptBoundaryVerified", "attempt_boundary_verified"
    )
    if attempt_boundary_verified is None:
        attempt_boundary_verified = True
    if not isinstance(attempt_boundary_verified, bool):
        raise MonitorError("attempt boundary verification must be boolean")

    collector_timing_record = {
        "createdAt": get_first(record, "createdAt", "created_at"),
        "startedAt": get_first(record, "startedAt", "started_at", "run_started_at"),
        "updatedAt": get_first(record, "updatedAt", "updated_at"),
        "jobs": jobs,
    }
    timing_exclusion_reasons = set(
        COLLECTOR.timing_exclusion_reasons(collector_timing_record)
    )
    if not jobs_complete:
        timing_exclusion_reasons.add("incomplete_job_set")
    if not attempt_boundary_verified:
        timing_exclusion_reasons.add("attempt_boundary_unverified")

    malformed_timestamp = False
    incomplete_job_count = 0
    incomplete_step_count = 0
    failed_job_count = 0
    failed_step_count = 0
    chronology_issue_codes: set[str] = set()
    job_durations: list[float] = []
    queue_durations: list[float] = []
    job_completion_times: list[datetime] = []
    stage_seconds: Counter[str] = Counter()

    try:
        created_at = parse_timestamp(get_first(record, "createdAt", "created_at"))
        started_at = parse_timestamp(
            get_first(record, "startedAt", "started_at", "run_started_at")
        )
        updated_at = parse_timestamp(get_first(record, "updatedAt", "updated_at"))
        if created_at is not None and started_at is not None and started_at < created_at:
            record_chronology_issue(
                chronology_issue_codes, phase, "RUN_START_PRECEDES_RUN_CREATION"
            )
        if created_at is not None and updated_at is not None and updated_at < created_at:
            record_chronology_issue(
                chronology_issue_codes, phase, "RUN_UPDATE_PRECEDES_RUN_CREATION"
            )
        if started_at is not None and updated_at is not None and updated_at < started_at:
            record_chronology_issue(
                chronology_issue_codes, phase, "RUN_UPDATE_PRECEDES_RUN_START"
            )
        for job in jobs:
            job_chronology_valid = True
            if job["conclusion"] in FAILURE_CONCLUSIONS:
                failed_job_count += 1
            job_created_at = parse_timestamp(job["createdAt"])
            job_started_at = parse_timestamp(job["startedAt"])
            job_completed_at = parse_timestamp(job["completedAt"])
            if created_at is not None:
                for job_time in (job_created_at, job_started_at, job_completed_at):
                    if job_time is not None and job_time < created_at:
                        record_chronology_issue(
                            chronology_issue_codes,
                            phase,
                            "JOB_TIMESTAMP_PRECEDES_RUN_CREATION",
                        )
                        job_chronology_valid = False
            if (
                started_at is not None
                and job_started_at is not None
                and job_started_at < started_at
            ):
                record_chronology_issue(
                    chronology_issue_codes,
                    phase,
                    "JOB_START_PRECEDES_RUN_START",
                )
                job_chronology_valid = False
            if (
                updated_at is not None
                and job_completed_at is not None
                and job_completed_at > updated_at
            ):
                record_chronology_issue(
                    chronology_issue_codes,
                    phase,
                    "JOB_COMPLETION_FOLLOWS_RUN_UPDATE",
                )
                job_chronology_valid = False
            if (
                job_created_at is not None
                and job_started_at is not None
                and job_started_at < job_created_at
            ):
                record_chronology_issue(
                    chronology_issue_codes,
                    phase,
                    "JOB_START_PRECEDES_JOB_CREATION",
                )
                job_chronology_valid = False
            if (
                job_started_at is not None
                and job_completed_at is not None
                and job_completed_at < job_started_at
            ):
                record_chronology_issue(
                    chronology_issue_codes,
                    phase,
                    "JOB_COMPLETION_PRECEDES_JOB_START",
                )
                job_chronology_valid = False
            if (
                job_created_at is not None
                and job_completed_at is not None
                and job_completed_at < job_created_at
            ):
                record_chronology_issue(
                    chronology_issue_codes,
                    phase,
                    "JOB_COMPLETION_PRECEDES_JOB_CREATION",
                )
                job_chronology_valid = False
            job_has_complete_timing = bool(
                job_created_at is not None
                and job_started_at is not None
                and job_completed_at is not None
            )
            if not job_has_complete_timing:
                incomplete_job_count += 1
            elif job_chronology_valid:
                job_durations.append(
                    (job_completed_at - job_started_at).total_seconds()
                )
                queue_durations.append(
                    (job_started_at - job_created_at).total_seconds()
                )
                job_completion_times.append(job_completed_at)
            for step in job["steps"]:
                step_chronology_valid = True
                if step["conclusion"] in FAILURE_CONCLUSIONS:
                    failed_step_count += 1
                step_started_at = parse_timestamp(step["startedAt"])
                step_completed_at = parse_timestamp(step["completedAt"])
                if created_at is not None:
                    for step_time in (step_started_at, step_completed_at):
                        if step_time is not None and step_time < created_at:
                            record_chronology_issue(
                                chronology_issue_codes,
                                phase,
                                "STEP_TIMESTAMP_PRECEDES_RUN_CREATION",
                            )
                            step_chronology_valid = False
                if job_started_at is not None:
                    for step_time in (step_started_at, step_completed_at):
                        if step_time is not None and step_time < job_started_at:
                            record_chronology_issue(
                                chronology_issue_codes,
                                phase,
                                "STEP_TIMESTAMP_PRECEDES_JOB_START",
                            )
                            step_chronology_valid = False
                if job_completed_at is not None:
                    for step_time in (step_started_at, step_completed_at):
                        if step_time is not None and step_time > job_completed_at:
                            record_chronology_issue(
                                chronology_issue_codes,
                                phase,
                                "STEP_TIMESTAMP_FOLLOWS_JOB_COMPLETION",
                            )
                            step_chronology_valid = False
                if (
                    step_started_at is not None
                    and step_completed_at is not None
                    and step_completed_at < step_started_at
                ):
                    record_chronology_issue(
                        chronology_issue_codes,
                        phase,
                        "STEP_COMPLETION_PRECEDES_STEP_START",
                    )
                    step_chronology_valid = False

                step_is_skipped = step["conclusion"] == "skipped"
                step_is_terminal = bool(
                    step["status"] == "completed"
                    and step["conclusion"] in TERMINAL_CONCLUSIONS
                )
                step_has_complete_timing = bool(
                    step_started_at is not None and step_completed_at is not None
                )
                step_has_partial_timing = bool(
                    (step_started_at is None) != (step_completed_at is None)
                )
                step_is_complete = bool(
                    step_is_terminal
                    and (
                        (step_is_skipped and not step_has_partial_timing)
                        or (not step_is_skipped and step_has_complete_timing)
                    )
                )
                if not step_is_complete:
                    incomplete_step_count += 1
                elif not step_is_skipped and step_chronology_valid:
                    step_duration = (
                        step_completed_at - step_started_at
                    ).total_seconds()
                    stage_seconds[COLLECTOR.classify_step(step["name"])] += step_duration
    except ChronologyError:
        raise
    except MonitorError:
        malformed_timestamp = True
        created_at = None
        timing_exclusion_reasons.add("malformed_timing")

    chronology_valid = not chronology_issue_codes
    run_outcome_terminal = bool(
        status == "completed"
        and conclusion in TERMINAL_CONCLUSIONS
    )
    job_outcomes_terminal = all(
        job["status"] == "completed"
        and job["conclusion"] in TERMINAL_CONCLUSIONS
        for job in jobs
    )
    step_outcomes_terminal = all(
        step["status"] == "completed"
        and step["conclusion"] in TERMINAL_CONCLUSIONS
        for job in jobs
        for step in job["steps"]
    )
    terminal_outcome_complete = bool(
        run_outcome_terminal
        and jobs_complete
        and (
            (
                jobs
                and job_outcomes_terminal
                and step_outcomes_terminal
                and all(
                    job["conclusion"] != "success" or job["steps"]
                    for job in jobs
                )
            )
            or (not jobs and conclusion != "success")
        )
    )
    timing_usable = bool(
        conclusion == "success"
        and not tombstone
        and terminal_outcome_complete
        and attempt_boundary_verified
        and chronology_valid
        and not timing_exclusion_reasons
        and not malformed_timestamp
        and created_at is not None
        and job_completion_times
    )
    critical_path = (
        (max(job_completion_times) - created_at).total_seconds()
        if timing_usable and created_at is not None
        else None
    )
    if critical_path is not None and critical_path < 0:
        record_chronology_issue(
            chronology_issue_codes, phase, "CRITICAL_PATH_NEGATIVE"
        )
        chronology_valid = False
        timing_usable = False
        timing_exclusion_reasons.add("invalid_timing_order")
        critical_path = None
    families = sorted({job["runnerFamily"] for job in jobs})
    cohort_metadata_verified = bool(
        workflow_metadata_verified
        and event in VERIFIED_WORKFLOW_EVENTS
        and source_tree
        and workflow_revision
        and job_topology
        and execution_mode != "unknown"
        and families
        and "unknown" not in families
    )
    cohort_key = "|".join(
        [
            workflow,
            event,
            ",".join(families),
            workflow_revision or "unverified-workflow-revision",
            execution_mode,
            job_topology or "unverified-job-topology",
        ]
    )
    return {
        "runId": run_id,
        "attempt": attempt,
        "phase": phase,
        "workflow": workflow,
        "event": event,
        "headSha": head_sha,
        "sourceTree": source_tree,
        "workflowRevision": workflow_revision,
        "executionMode": execution_mode,
        "jobTopology": job_topology,
        "status": status,
        "conclusion": conclusion,
        "cohortKey": cohort_key,
        "cohortMetadataVerified": cohort_metadata_verified,
        "sourceFingerprint": source_fingerprint,
        "runnerFamilies": families,
        "timingUsable": timing_usable,
        "timingExclusionReasons": sorted(timing_exclusion_reasons),
        "chronologyValid": chronology_valid,
        "chronologyIssueCodes": sorted(chronology_issue_codes),
        "attemptJobSetComplete": jobs_complete,
        "attemptBoundaryVerified": attempt_boundary_verified,
        "terminalOutcomeComplete": terminal_outcome_complete,
        # Compatibility field for existing checkpoint readers. Timing
        # eligibility is represented only by timingUsable.
        "terminalEvidenceComplete": terminal_outcome_complete,
        "snapshotImmutable": bool(
            tombstone
            or (
                attempt_boundary_verified
                and terminal_outcome_complete
                and (conclusion != "success" or timing_usable)
            )
        ),
        "tombstone": tombstone,
        "malformedTimestamp": malformed_timestamp,
        "jobCount": len(jobs),
        "stepCount": sum(len(job["steps"]) for job in jobs),
        "failedJobCount": failed_job_count,
        "failedStepCount": failed_step_count,
        "incompleteJobCount": incomplete_job_count,
        "incompleteStepCount": incomplete_step_count,
        "criticalPathSeconds": round(critical_path, 6) if critical_path is not None else None,
        "runnerOccupiedSeconds": round(sum(job_durations), 6) if timing_usable else None,
        "totalQueueSeconds": round(sum(queue_durations), 6) if timing_usable else None,
        "maxQueueSeconds": round(max(queue_durations), 6) if timing_usable else None,
        "stageSeconds": (
            {key: round(value, 6) for key, value in sorted(stage_seconds.items())}
            if timing_usable
            else {}
        ),
    }


def load_checkpoint(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"schema": f"{SCHEMA_VERSION}/checkpoint", "runs": {}}
    checkpoint = load_json(path)
    if checkpoint.get("schema") != f"{SCHEMA_VERSION}/checkpoint":
        raise MonitorError("unsupported or damaged checkpoint schema")
    runs = checkpoint.get("runs")
    if not isinstance(runs, dict):
        raise MonitorError("damaged checkpoint run index")
    return checkpoint


def load_thresholds(path: Path | None) -> tuple[dict[str, Any], str]:
    if path is None:
        return DEFAULT_THRESHOLDS, (
            "conservative analytical defaults; the retained baseline declared no "
            "acceptance noise budget; these values are not a required release gate"
        )
    payload = load_json(path)
    if not isinstance(payload, dict):
        raise MonitorError("threshold config must be an object")
    thresholds = payload.get("thresholds", payload)
    if not isinstance(thresholds, dict):
        raise MonitorError("thresholds must be an object")
    validated: dict[str, Any] = {}
    for metric, defaults in DEFAULT_THRESHOLDS.items():
        candidate = thresholds.get(metric, defaults)
        if not isinstance(candidate, dict):
            raise MonitorError(f"invalid threshold for {metric}")
        absolute = candidate.get("absoluteSeconds")
        relative = candidate.get("relativePercent")
        try:
            absolute_finite = math.isfinite(float(absolute))
        except (OverflowError, TypeError, ValueError):
            absolute_finite = False
        if (
            isinstance(absolute, bool)
            or not isinstance(absolute, (int, float))
            or not absolute_finite
            or absolute <= 0
        ):
            raise MonitorError(f"invalid absolute threshold for {metric}")
        try:
            relative_finite = math.isfinite(float(relative))
        except (OverflowError, TypeError, ValueError):
            relative_finite = False
        if (
            isinstance(relative, bool)
            or not isinstance(relative, (int, float))
            or not relative_finite
            or relative <= 0
        ):
            raise MonitorError(f"invalid relative threshold for {metric}")
        validated[metric] = {
            "absoluteSeconds": float(absolute),
            "relativePercent": float(relative),
        }
    return validated, "operator-supplied analytical thresholds"


def percentile(values: Sequence[float], fraction: float) -> float:
    return float(COLLECTOR.percentile(values, fraction))


def metric_distribution(
    values: Sequence[float], source_cluster_count: int, p95_source_clusters: int
) -> dict[str, Any]:
    return {
        "n": len(values),
        "p50": round(percentile(values, 0.5), 6),
        "p95": round(percentile(values, 0.95), 6)
        if source_cluster_count >= p95_source_clusters
        else None,
        "p95Status": "descriptive_only"
        if source_cluster_count >= p95_source_clusters
        else "insufficient_source_clusters",
        "mean": round(statistics.fmean(values), 6),
    }


def bootstrap_mean_change(
    before: Sequence[float], after: Sequence[float], resamples: int, seed: int
) -> dict[str, Any]:
    rng = COLLECTOR.SplitMix64(seed)
    absolute_changes: list[float] = []
    relative_changes: list[float] = []
    # A zero cluster can produce zero-mean bootstrap draws even when the full
    # cohort mean is positive, so relative inference is only defined when
    # every non-negative timing baseline is strictly positive.
    relative_defined = all(value != 0.0 for value in before)
    for _ in range(resamples):
        sampled_before = [before[rng.index(len(before))] for _ in before]
        sampled_after = [after[rng.index(len(after))] for _ in after]
        before_mean = statistics.fmean(sampled_before)
        after_mean = statistics.fmean(sampled_after)
        reduction = before_mean - after_mean
        absolute_changes.append(reduction)
        if relative_defined:
            relative_changes.append(100 * reduction / before_mean)
    return {
        "absoluteReductionSeconds95Ci": [
            round(percentile(absolute_changes, 0.025), 6),
            round(percentile(absolute_changes, 0.975), 6),
        ],
        "relativeReductionPercent95Ci": (
            [
                round(percentile(relative_changes, 0.025), 6),
                round(percentile(relative_changes, 0.975), 6),
            ]
            if relative_defined
            else None
        ),
        "relativeReductionStatus": (
            "defined" if relative_defined else "undefined_zero_baseline"
        ),
    }


def classify_signal(
    before: Sequence[float],
    after: Sequence[float],
    interval: dict[str, Any],
    threshold: dict[str, float],
) -> str:
    absolute_ci = interval["absoluteReductionSeconds95Ci"]
    relative_ci = interval["relativeReductionPercent95Ci"]
    if relative_ci is None:
        if absolute_ci[0] >= threshold["absoluteSeconds"]:
            return "improvement_signal"
        if absolute_ci[1] <= -threshold["absoluteSeconds"]:
            return "regression_signal"
        return "inconclusive"
    if (
        absolute_ci[0] >= threshold["absoluteSeconds"]
        and relative_ci[0] >= threshold["relativePercent"]
    ):
        return "improvement_signal"
    if (
        absolute_ci[1] <= -threshold["absoluteSeconds"]
        and relative_ci[1] <= -threshold["relativePercent"]
    ):
        return "regression_signal"
    return "inconclusive"


def failure_rate(runs: Sequence[dict[str, Any]]) -> dict[str, Any]:
    terminal_runs = [
        run
        for run in runs
        if run["status"] == "completed"
        and run["conclusion"] in TERMINAL_CONCLUSIONS
    ]
    unfinished_attempts = sum(run["status"] != "completed" for run in runs)
    incomplete_terminal_attempts = sum(
        run["status"] == "completed"
        and run["conclusion"] not in TERMINAL_CONCLUSIONS
        for run in runs
    )
    failures = sum(
        run["conclusion"] in FAILURE_CONCLUSIONS for run in terminal_runs
    )
    return {
        "n": len(terminal_runs),
        "terminalAttempts": len(terminal_runs),
        "unfinishedAttempts": unfinished_attempts,
        "incompleteTerminalAttempts": incomplete_terminal_attempts,
        "totalAttempts": len(runs),
        "failures": failures,
        "percent": (
            round(100 * failures / len(terminal_runs), 6) if terminal_runs else None
        ),
    }


def attempt_resolved_for_analysis(run: dict[str, Any]) -> bool:
    if run.get("attemptBoundaryVerified", True) is not True:
        return False
    if run.get("tombstone"):
        return True
    if run.get("conclusion") == "success":
        return run.get("snapshotImmutable") is True
    return run.get("terminalOutcomeComplete") is True


def stage_profile(runs: Sequence[dict[str, Any]]) -> dict[str, Any]:
    stage_names = sorted(
        {stage for run in runs for stage in run.get("stageSeconds", {})}
    )
    profile: dict[str, Any] = {}
    for stage in stage_names:
        by_tree: dict[str, list[float]] = defaultdict(list)
        for run in runs:
            by_tree[run["sourceTree"] or "unverified-source-tree"].append(
                float(run.get("stageSeconds", {}).get(stage, 0.0))
            )
        cluster_medians = [
            statistics.median(values) for _, values in sorted(by_tree.items())
        ]
        profile[stage] = {
            "sourceTreeClusters": len(cluster_medians),
            "clusterMedianSecondsP50": round(percentile(cluster_medians, 0.5), 6),
            "clusterMedianSecondsMean": round(statistics.fmean(cluster_medians), 6),
        }
    return profile


def build_analysis(
    observations: Sequence[dict[str, Any]],
    thresholds: dict[str, Any],
    threshold_basis: str,
    resamples: int,
    seed: int,
    duplicate_count: int,
    prior_receipt_count: int,
    min_source_clusters: int,
    p95_source_clusters: int,
) -> dict[str, Any]:
    grouped: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(
        lambda: {"before": [], "after": []}
    )
    for observation in observations:
        grouped[observation["cohortKey"]][observation["phase"]].append(observation)

    cohorts = []
    for cohort_key in sorted(grouped):
        phases = grouped[cohort_key]
        before_success = [run for run in phases["before"] if run["timingUsable"]]
        after_success = [run for run in phases["after"] if run["timingUsable"]]
        warnings: list[str] = []
        if any(not run["cohortMetadataVerified"] for run in phases["before"] + phases["after"]):
            warnings.append("workflow_cohort_metadata_unverified")
        cohort_attempts_resolved = all(
            attempt_resolved_for_analysis(run)
            for run in phases["before"] + phases["after"]
        )
        if not cohort_attempts_resolved:
            warnings.append("unresolved_cohort_attempts")
        if len(before_success) < MIN_COHORT_SUCCESSES or len(after_success) < MIN_COHORT_SUCCESSES:
            warnings.append("minimum_7_before_and_7_after_successes_not_met")
        before_shas = {run["sourceTree"] for run in before_success if run["sourceTree"]}
        after_shas = {run["sourceTree"] for run in after_success if run["sourceTree"]}
        if any(run["sourceTree"] is None for run in before_success + after_success):
            warnings.append("source_tree_identity_missing")
        if len(before_shas) < min_source_clusters or len(after_shas) < min_source_clusters:
            warnings.append("minimum_source_tree_clusters_not_met")
        metrics: dict[str, Any] = {}
        if not warnings:
            if len(before_success) >= MIN_COHORT_SUCCESSES and len(after_success) >= MIN_COHORT_SUCCESSES:
                for metric, threshold in thresholds.items():
                    before_by_tree: dict[str, list[float]] = defaultdict(list)
                    after_by_tree: dict[str, list[float]] = defaultdict(list)
                    for run in before_success:
                        before_by_tree[run["sourceTree"]].append(float(run[metric]))
                    for run in after_success:
                        after_by_tree[run["sourceTree"]].append(float(run[metric]))
                    before_values = [
                        statistics.median(values)
                        for _, values in sorted(before_by_tree.items())
                    ]
                    after_values = [
                        statistics.median(values)
                        for _, values in sorted(after_by_tree.items())
                    ]
                    interval = bootstrap_mean_change(
                        before_values,
                        after_values,
                        resamples,
                        COLLECTOR.stable_seed(seed, f"{cohort_key}:{metric}"),
                    )
                    metrics[metric] = {
                        "before": metric_distribution(
                            before_values, len(before_values), p95_source_clusters
                        ),
                        "after": metric_distribution(
                            after_values, len(after_values), p95_source_clusters
                        ),
                        **interval,
                        "threshold": threshold,
                        "signal": "exploratory_"
                        + classify_signal(before_values, after_values, interval, threshold),
                    }

        boundary_verified = {
            phase: [
                run
                for run in phases[phase]
                if run.get("attemptBoundaryVerified", True) is True
            ]
            for phase in ("before", "after")
        }
        before_failure = failure_rate(boundary_verified["before"])
        after_failure = failure_rate(boundary_verified["after"])
        failure_signal = "insufficient_samples"
        cohort_metadata_verified = all(
            run["cohortMetadataVerified"]
            for run in phases["before"] + phases["after"]
        )
        attempt_boundaries_verified = all(
            run.get("attemptBoundaryVerified", True) is True
            for run in phases["before"] + phases["after"]
        )
        if (
            cohort_metadata_verified
            and attempt_boundaries_verified
            and cohort_attempts_resolved
            and before_failure["n"] >= MIN_COHORT_SUCCESSES
            and after_failure["n"] >= MIN_COHORT_SUCCESSES
        ):
            if after_failure["percent"] > before_failure["percent"]:
                failure_signal = "failure_rate_increased"
            elif after_failure["percent"] < before_failure["percent"]:
                failure_signal = "failure_rate_decreased"
            else:
                failure_signal = "no_failure_rate_change"
        cohorts.append(
            {
                "cohortKey": cohort_key,
                "beforeRunCount": len(phases["before"]),
                "afterRunCount": len(phases["after"]),
                "beforeTimingSuccessCount": len(before_success),
                "afterTimingSuccessCount": len(after_success),
                "beforeSourceTreeCount": len(before_shas),
                "afterSourceTreeCount": len(after_shas),
                "beforeFailureRate": before_failure,
                "afterFailureRate": after_failure,
                "failureSignal": failure_signal,
                "beforeStageProfile": stage_profile(before_success),
                "afterStageProfile": stage_profile(after_success),
                "metrics": metrics,
                "warnings": warnings,
                "causalClaimAllowed": False,
                "effectiveSampleUnit": "source_tree_cluster_median",
            }
        )

    before_keys = {key for key, phases in grouped.items() if phases["before"]}
    after_keys = {key for key, phases in grouped.items() if phases["after"]}
    global_warnings = [
        "observational_signal_is_not_causal_performance_proof",
        "repeated_monitoring_inflates_false_positive_risk_without_sequential_correction",
    ]
    if not (before_keys & after_keys):
        global_warnings.append("no_comparable_workflow_event_runner_cohort")
    if prior_receipt_count or len(cohorts) > 1:
        global_warnings.append("multiple_looks_detected")

    return {
        "schema": f"{SCHEMA_VERSION}/analysis",
        "algorithmicCost": {
            "offlineAggregation": "O(r * (j + s)) for newly supplied runs",
            "duplicateCheckpointLookup": "O(1) average per run ID",
            "boundedCheckpointReadWrite": "O(H), with H limited by maxCheckpointRuns",
            "bootstrap": "O(B * (n_before + n_after)) per comparable metric and cohort",
            "upstreamApiCollection": "not performed; report collector API cost separately",
        },
        "thresholdBasis": threshold_basis,
        "thresholds": thresholds,
        "minimumSuccessfulRunsPerPhase": MIN_COHORT_SUCCESSES,
        "minimumSourceTreeClustersPerPhase": min_source_clusters,
        "p95MinimumSourceTreeClusters": p95_source_clusters,
        "bootstrap": {
            "method": "deterministic independent source-tree-cluster percentile bootstrap of mean cluster-median reductions",
            "confidenceLevel": 0.95,
            "resamples": resamples,
            "seed": seed,
        },
        "runConclusionCounts": dict(
            sorted(Counter(run["conclusion"] for run in observations).items())
        ),
        "timingUsableRunCount": sum(run["timingUsable"] for run in observations),
        "chronologyInvalidRunCount": sum(
            run.get("chronologyValid") is False for run in observations
        ),
        "chronologyIssueCodeCounts": dict(sorted(Counter(
            code
            for run in observations
            for code in run.get("chronologyIssueCodes", [])
        ).items())),
        "incompleteAttemptJobSetRunCount": sum(
            not run["attemptJobSetComplete"] for run in observations
        ),
        "censoredRunCount": sum(
            run["conclusion"] in FAILURE_CONCLUSIONS
            or run["status"] != "completed"
            or run["conclusion"] not in TERMINAL_CONCLUSIONS
            for run in observations
        ),
        "malformedTimestampRunCount": sum(run["malformedTimestamp"] for run in observations),
        "incompleteStepCount": sum(run["incompleteStepCount"] for run in observations),
        "failedJobCount": sum(run["failedJobCount"] for run in observations),
        "failedStepCount": sum(run["failedStepCount"] for run in observations),
        "duplicateRunIdCountThisInvocation": duplicate_count,
        "cohorts": cohorts,
        "warnings": global_warnings,
        "modelsInvoked": 0,
        "remoteMutations": 0,
        "rawLogsFetched": False,
        "actorsRetained": False,
        "jobOrStepNamesRetained": False,
    }


def parse_arguments(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--before-input", action="append", default=[], type=Path)
    parser.add_argument("--after-input", action="append", default=[], type=Path)
    parser.add_argument("--workflow", default="web-admin-ci.yml")
    parser.add_argument("--checkpoint", required=True, type=Path)
    parser.add_argument("--receipt", required=True, type=Path)
    parser.add_argument("--threshold-config", type=Path)
    parser.add_argument("--max-input-runs", type=int, default=DEFAULT_MAX_INPUT_RUNS)
    parser.add_argument(
        "--max-checkpoint-runs", type=int, default=DEFAULT_MAX_CHECKPOINT_RUNS
    )
    parser.add_argument("--bootstrap-resamples", type=int, default=DEFAULT_BOOTSTRAP_RESAMPLES)
    parser.add_argument("--bootstrap-seed", type=int, default=DEFAULT_BOOTSTRAP_SEED)
    parser.add_argument("--min-source-clusters", type=int, default=DEFAULT_MIN_SOURCE_CLUSTERS)
    parser.add_argument("--p95-source-clusters", type=int, default=DEFAULT_P95_SOURCE_CLUSTERS)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_arguments(argv)
    if not args.before_input and not args.after_input:
        raise MonitorError("at least one before or after input is required")
    if not 1 <= args.max_input_runs <= MAX_INPUT_RUNS:
        raise MonitorError("--max-input-runs must be between 1 and 2500")
    if not 100 <= args.max_checkpoint_runs <= 100_000:
        raise MonitorError("--max-checkpoint-runs must be between 100 and 100000")
    if not 1_000 <= args.bootstrap_resamples <= MAX_BOOTSTRAP_RESAMPLES:
        raise MonitorError("--bootstrap-resamples must be between 1000 and 100000")
    if not 2 <= args.min_source_clusters <= 100:
        raise MonitorError("--min-source-clusters must be between 2 and 100")
    if not args.min_source_clusters <= args.p95_source_clusters <= 1_000:
        raise MonitorError(
            "--p95-source-clusters must be between min source clusters and 1000"
        )

    default_workflow = safe_workflow(args.workflow, "web-admin-ci.yml")
    thresholds, threshold_basis = load_thresholds(args.threshold_config)
    config = {
        "workflowFallback": default_workflow,
        "maxInputRuns": args.max_input_runs,
        "maxCheckpointRuns": args.max_checkpoint_runs,
        "bootstrapResamples": args.bootstrap_resamples,
        "bootstrapSeed": args.bootstrap_seed,
        "thresholds": thresholds,
        "thresholdBasis": threshold_basis,
        "minSourceClusters": args.min_source_clusters,
        "p95SourceClusters": args.p95_source_clusters,
    }
    config_hash = sha256_bytes(canonical_json(config))
    checkpoint_before_hash = sha256_file(args.checkpoint) if args.checkpoint.exists() else None
    checkpoint = load_checkpoint(args.checkpoint)
    if checkpoint.get("configHash") not in (None, config_hash):
        raise MonitorError("checkpoint configuration hash does not match this invocation")
    run_index = dict(checkpoint["runs"])
    input_receipts = []
    duplicate_count = 0
    admitted_count = 0
    total_input_runs = 0

    for phase, paths in (("before", args.before_input), ("after", args.after_input)):
        for path in paths:
            payload = load_json(path)
            records, metadata = extract_records(payload)
            total_input_runs += len(records)
            if total_input_runs > args.max_input_runs:
                raise MonitorError("combined input run count exceeds --max-input-runs")
            workflow_metadata_verified = metadata.get("workflow") is not None
            workflow = safe_workflow(metadata.get("workflow"), default_workflow)
            input_receipts.append(
                {
                    "phase": phase,
                    "sha256": sha256_file(path),
                    "runCount": len(records),
                }
            )
            for record in records:
                run_id = get_first(record, "id", "databaseId", "runId")
                if not isinstance(run_id, int) or isinstance(run_id, bool) or run_id < 1:
                    raise MonitorError("run id must be a positive integer")
                attempt = run_attempt(record)
                key = f"{run_id}:{attempt}"
                analysis_fingerprint = sha256_bytes(canonical_json(record))
                source_record = dict(record)
                source_record.pop("attemptBoundaryVerified", None)
                source_record.pop("attempt_boundary_verified", None)
                source_fingerprint = sha256_bytes(canonical_json(source_record))
                if key in run_index:
                    prior_observation = run_index[key]
                    if prior_observation.get("phase") != phase:
                        raise MonitorError("a run attempt cannot move between before and after")
                    prior_analysis_fingerprint = prior_observation.get(
                        "analysisFingerprint"
                    )
                    if prior_analysis_fingerprint == analysis_fingerprint:
                        duplicate_count += 1
                        continue
                    legacy_same_source = bool(
                        prior_analysis_fingerprint is None
                        and prior_observation.get("sourceFingerprint")
                        == source_fingerprint
                    )
                    if not legacy_same_source:
                        immutable = prior_observation.get("snapshotImmutable")
                        if immutable is None:
                            # Backward-compatible read of checkpoints written before
                            # outcome and timing eligibility were split.
                            immutable = (
                                prior_observation.get("terminalEvidenceComplete") is True
                            )
                        if immutable:
                            raise MonitorError(
                                "completed run attempt changed after becoming immutable"
                            )
                observation = analyze_record(
                    record,
                    phase,
                    workflow,
                    workflow_metadata_verified,
                    source_fingerprint,
                )
                observation["analysisFingerprint"] = analysis_fingerprint
                run_index[key] = observation
                admitted_count += 1

    if len(run_index) > args.max_checkpoint_runs:
        raise MonitorError(
            "checkpoint run bound exceeded; preserve the checkpoint as an archive and "
            "start a new explicitly versioned monitoring window"
        )

    observations = [
        run_index[key]
        for key in sorted(
            run_index,
            key=lambda value: tuple(int(part) for part in value.split(":")),
        )
    ]
    prior_receipt_count = int(checkpoint.get("receiptCount") or 0)
    analysis = build_analysis(
        observations,
        thresholds,
        threshold_basis,
        args.bootstrap_resamples,
        args.bootstrap_seed,
        duplicate_count,
        prior_receipt_count,
        args.min_source_clusters,
        args.p95_source_clusters,
    )
    active_run_keys = sorted(
        (
            f"{run['runId']}:{run['attempt']}"
            for run in observations
            if run["status"] != "completed"
        ),
        key=lambda value: tuple(int(part) for part in value.split(":")),
    )
    next_checkpoint = {
        "schema": f"{SCHEMA_VERSION}/checkpoint",
        "configHash": config_hash,
        "receiptCount": prior_receipt_count + 1,
        "watermarkRunId": max((run["runId"] for run in observations), default=None),
        "activeRunKeys": active_run_keys,
        "runs": run_index,
    }
    checkpoint_after_hash = sha256_bytes(canonical_json(next_checkpoint))
    receipt = {
        "schema": f"{SCHEMA_VERSION}/receipt",
        "configHash": config_hash,
        "checkpointBeforeSha256": checkpoint_before_hash,
        "checkpointAfterSha256": checkpoint_after_hash,
        "inputs": input_receipts,
        "inputRunCount": total_input_runs,
        "admittedRunCount": admitted_count,
        "duplicateRunIdCount": duplicate_count,
        "analysis": analysis,
    }

    # The checkpoint is the durable state.  The receipt is written only after
    # that state is durable, so a retry deduplicates every admitted run.
    atomic_write_json(args.checkpoint, next_checkpoint)
    atomic_write_json(args.receipt, receipt)
    print(json.dumps({
        "admittedRunCount": admitted_count,
        "duplicateRunIdCount": duplicate_count,
        "cohortCount": len(analysis["cohorts"]),
        "receiptSha256": sha256_file(args.receipt),
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except MonitorError as error:
        print(f"monitor-ci-performance: {error}", file=sys.stderr)
        raise SystemExit(2)
