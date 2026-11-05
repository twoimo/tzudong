#!/usr/bin/env python3
"""Prepare, but never activate, an immutable CI comparison reference.

The newest verified cohort is eligible only after seven successful terminal
attempts from seven distinct source trees. Incomplete collection coverage or
any unresolved non-tombstone attempt in the source window keeps the state at
collecting_reference. The helper never replaces a baseline, checkpoint, or
existing candidate.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import tempfile
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("ci_monitor_reference", HERE / "monitor-ci-performance.py")
MONITOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MONITOR)

SCHEMA = "tzudong-ci-reference/v1"
MAXIMUM_CANDIDATE_ATTEMPTS = 100
BLOCKING_COVERAGE_ALERTS = {
    "ATTEMPT_HISTORY_BOUND",
    "BOUNDED_RECENT_WINDOW",
    "JOB_SET_INCOMPLETE",
    "LIST_BOUNDARY_CHANGED",
    "RECENT_WINDOW_TRUNCATED",
}
SAFE_TICK_ID = re.compile(r"^[0-9A-Za-z][0-9A-Za-z._-]{0,95}$")
REFERENCE_TERMINAL_CONCLUSIONS = (
    set(MONITOR.VALID_CONCLUSIONS) - {"missing", "stale"}
)


class ReferenceError(RuntimeError):
    pass


def authenticated_json(
    path: Path,
    expected_sha256: str | None = None,
    *,
    hash_mismatch_code: str = "RETAINED_EXPORT_HASH_MISMATCH",
) -> tuple[object, str]:
    """Hash and parse one immutable byte snapshot of a retained input."""
    try:
        payload = path.read_bytes()
    except OSError:
        raise ReferenceError("REFERENCE_INPUT_READ_FAILED") from None
    digest = MONITOR.sha256_bytes(payload)
    if expected_sha256 is not None and digest != expected_sha256:
        raise ReferenceError(hash_mismatch_code)
    try:
        return json.loads(payload.decode("utf-8")), digest
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ReferenceError("INVALID_REFERENCE_JSON") from None


def state_ref(state_dir: Path, path: Path) -> str:
    try:
        relative = path.resolve().relative_to(state_dir.resolve())
    except ValueError:
        raise ReferenceError("REFERENCE_PATH_OUTSIDE_STATE_ROOT") from None
    if not relative.parts or any(part in {"", ".", ".."} for part in relative.parts):
        raise ReferenceError("INVALID_REFERENCE_PATH")
    return "state://" + relative.as_posix()


def atomic_create_json(path: Path, value: object) -> None:
    """Create an immutable JSON file; an identical prior candidate is reusable."""
    payload = MONITOR.canonical_json(value)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() == payload:
            return
        raise ReferenceError("REFERENCE_CANDIDATE_ALREADY_EXISTS")
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            if path.read_bytes() != payload:
                raise ReferenceError("REFERENCE_CANDIDATE_ALREADY_EXISTS") from None
        directory_descriptor = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_descriptor)
        finally:
            os.close(directory_descriptor)
    finally:
        if temporary.exists():
            temporary.unlink()


def resolve_state_ref(state_dir: Path, reference: str) -> Path:
    if not isinstance(reference, str) or not reference.startswith("state://"):
        raise ReferenceError("INVALID_REFERENCE_PATH")
    relative = Path(reference.removeprefix("state://"))
    if relative.is_absolute() or not relative.parts or any(
        part in {"", ".", ".."} for part in relative.parts
    ):
        raise ReferenceError("INVALID_REFERENCE_PATH")
    resolved = (state_dir / relative).resolve()
    try:
        resolved.relative_to(state_dir.resolve())
    except ValueError:
        raise ReferenceError("REFERENCE_PATH_OUTSIDE_STATE_ROOT") from None
    return resolved


def candidate_manifest_path(state_dir: Path, cohort_id: str) -> Path:
    return state_dir / "reference-candidates" / f"{cohort_id}.receipt.json"


def prior_candidate(
    state_dir: Path, cohort_id: str | None
) -> tuple[Path, str, dict] | None:
    """Resolve a frozen candidate in O(1) from its cohort-bound manifest."""
    if not cohort_id:
        return None
    manifest_path = candidate_manifest_path(state_dir, cohort_id)
    if not manifest_path.exists():
        return None
    receipt, _ = authenticated_json(manifest_path)
    if not isinstance(receipt, dict):
        raise ReferenceError("INVALID_PRIOR_REFERENCE_RECEIPT")
    if (
        receipt.get("schema") != f"{SCHEMA}/candidate-receipt"
        or receipt.get("cohortId") != cohort_id
    ):
        raise ReferenceError("INVALID_PRIOR_REFERENCE_RECEIPT")
    candidate = resolve_state_ref(state_dir, receipt.get("candidateBaselinePath"))
    digest = receipt.get("candidateBaselineSha256")
    if not isinstance(digest, str) or len(digest) != 64:
        raise ReferenceError("INVALID_PRIOR_REFERENCE_RECEIPT")
    if not candidate.is_file():
        raise ReferenceError("REFERENCE_CANDIDATE_HASH_MISMATCH")
    candidate_payload, _ = authenticated_json(
        candidate,
        digest,
        hash_mismatch_code="REFERENCE_CANDIDATE_HASH_MISMATCH",
    )
    if not isinstance(candidate_payload, dict):
        raise ReferenceError("INVALID_FROZEN_REFERENCE_CANDIDATE")
    return candidate, digest, candidate_payload


def authenticated_checkpoint(path: Path) -> tuple[dict, str]:
    checkpoint, digest = authenticated_json(path)
    if not isinstance(checkpoint, dict):
        raise ReferenceError("INVALID_CHECKPOINT_SCHEMA")
    if checkpoint.get("schema") != f"{MONITOR.SCHEMA_VERSION}/checkpoint":
        raise ReferenceError("INVALID_CHECKPOINT_SCHEMA")
    if not isinstance(checkpoint.get("runs"), dict):
        raise ReferenceError("INVALID_CHECKPOINT_RUNS")
    return checkpoint, digest


def load_checkpoint(path: Path) -> dict:
    return authenticated_checkpoint(path)[0]


def select_tick_directory(state_dir: Path, tick_id: str | None) -> Path:
    tick_root = state_dir / "ticks"
    if tick_id is not None:
        if not SAFE_TICK_ID.fullmatch(tick_id) or tick_id in {".", ".."}:
            raise ReferenceError("INVALID_TICK_ID")
        directory = tick_root / tick_id
        if not directory.is_dir() or directory.resolve().parent != tick_root.resolve():
            raise ReferenceError("TICK_NOT_FOUND")
        return directory
    ticks = []
    for tick_path in tick_root.glob("*/tick.json"):
        directory = tick_path.parent
        if (
            not SAFE_TICK_ID.fullmatch(directory.name)
            or directory.name in {".", ".."}
            or directory.resolve().parent != tick_root.resolve()
        ):
            raise ReferenceError("INVALID_RETAINED_TICK_PATH")
        ticks.append(directory)
    if not ticks:
        raise ReferenceError("NO_RETAINED_TICKS")
    return max(ticks, key=lambda path: path.name)


def authenticated_tick(directory: Path) -> dict:
    tick, _ = authenticated_json(directory / "tick.json")
    if not isinstance(tick, dict):
        raise ReferenceError("INVALID_TICK_SCHEMA")
    if tick.get("schema") != "tzudong-ci-monitor-tick/v1":
        raise ReferenceError("INVALID_TICK_SCHEMA")
    return tick


def authenticated_export(directory: Path) -> tuple[dict, list[dict], str]:
    tick = authenticated_tick(directory)
    export_path = directory / "export.json"
    if not export_path.is_file():
        raise ReferenceError("RETAINED_EXPORT_HASH_MISMATCH")
    export, _ = authenticated_json(export_path, tick.get("exportSha256"))
    if not isinstance(export, dict):
        raise ReferenceError("INVALID_RETAINED_EXPORT")
    try:
        records, metadata = MONITOR.extract_records(export)
    except MONITOR.MonitorError as error:
        raise ReferenceError("INVALID_RETAINED_EXPORT") from error
    workflow = metadata.get("workflow")
    if not isinstance(workflow, str) or not isinstance(records, list):
        raise ReferenceError("INVALID_RETAINED_EXPORT")
    return export, records, workflow


def retained_inputs_for_candidate(
    state_dir: Path,
) -> tuple[list[dict], set[tuple[str, str]]]:
    """Bind source records and authenticated export capture identities once."""
    records_by_key: dict[tuple[int, int], tuple[str, dict]] = {}
    export_captures: set[tuple[str, str]] = set()
    ticks = sorted(path.parent for path in (state_dir / "ticks").glob("*/tick.json"))
    if not ticks:
        raise ReferenceError("NO_RETAINED_TICKS")
    for directory in ticks:
        if directory.resolve().parent != (state_dir / "ticks").resolve():
            raise ReferenceError("INVALID_RETAINED_TICK_PATH")
        export, records, workflow = authenticated_export(directory)
        captured_at = export.get("capturedAtUtc")
        if not isinstance(captured_at, str) or not captured_at:
            raise ReferenceError("INVALID_RETAINED_EXPORT")
        export_captures.add((workflow, captured_at))
        for record in records:
            if not isinstance(record, dict):
                raise ReferenceError("INVALID_RETAINED_RECORD")
            run_id = record.get("id")
            attempt = record.get("attempt", 1)
            if not isinstance(run_id, int) or not isinstance(attempt, int):
                raise ReferenceError("INVALID_RETAINED_RECORD_KEY")
            fingerprint = MONITOR.sha256_bytes(MONITOR.canonical_json(record))
            key = (run_id, attempt)
            prior = records_by_key.get(key)
            if prior and prior[0] != fingerprint:
                records_by_key[key] = (fingerprint, record)
            elif not prior:
                records_by_key[key] = (fingerprint, record)
    return [item[1] for item in records_by_key.values()], export_captures


def authenticate_orphan_candidate(
    candidate_path: Path,
    expected_candidate: dict,
    export_captures: set[tuple[str, str]],
) -> tuple[dict, str]:
    """Adopt only the exact canonical candidate left before receipt publication."""
    try:
        candidate, digest = authenticated_json(candidate_path)
    except ReferenceError as error:
        if str(error) in {"INVALID_REFERENCE_JSON", "REFERENCE_INPUT_READ_FAILED"}:
            raise ReferenceError("REFERENCE_CANDIDATE_ALREADY_EXISTS") from None
        raise
    if not isinstance(candidate, dict):
        raise ReferenceError("INVALID_ORPHAN_REFERENCE_CANDIDATE")
    captured_at = candidate.get("capturedAtUtc")
    workflow = candidate.get("workflow")
    if (workflow, captured_at) not in export_captures:
        raise ReferenceError("ORPHAN_REFERENCE_CANDIDATE_MISMATCH")
    expected_with_original_capture = {
        **expected_candidate,
        "capturedAtUtc": captured_at,
    }
    if MONITOR.sha256_bytes(
        MONITOR.canonical_json(expected_with_original_capture)
    ) != digest:
        raise ReferenceError("ORPHAN_REFERENCE_CANDIDATE_MISMATCH")
    return candidate, digest


def select_current_observation(observations: list[dict]) -> dict | None:
    verified = [
        item
        for item in observations
        if item.get("cohortMetadataVerified")
        and item.get("attemptBoundaryVerified", True)
        and not item.get("tombstone")
        and not (
            attempt_resolved(item)
            and item.get("status") != "completed"
        )
        and item.get("status") != "missing"
    ]
    if not verified:
        return None
    return max(verified, key=lambda item: (item["runId"], item["attempt"]))


def select_current_cohort(observations: list[dict]) -> str | None:
    selected = select_current_observation(observations)
    return selected["cohortKey"] if selected else None


def attempt_resolved(observation: dict) -> bool:
    if observation.get("attemptBoundaryVerified", True) is not True:
        return False
    if observation.get("tombstone"):
        return True
    if observation.get("conclusion") == "success":
        return observation.get("snapshotImmutable") is True
    return bool(
        observation.get(
            "terminalOutcomeComplete",
            observation.get("terminalEvidenceComplete", False),
        )
    )


def reference_terminal(observation: dict) -> bool:
    outcome_complete = observation.get(
        "terminalOutcomeComplete",
        observation.get("terminalEvidenceComplete", False),
    )
    return bool(
        not observation.get("tombstone")
        and observation.get("status") == "completed"
        and observation.get("conclusion") in REFERENCE_TERMINAL_CONCLUSIONS
        and observation.get("cohortMetadataVerified")
        and outcome_complete
        and (
            observation.get("conclusion") != "success"
            or observation.get("timingUsable")
        )
    )


def assess_pending(observation: dict, target: dict) -> dict:
    """Classify unresolved work without guessing its eventual cohort."""
    reason = "exact_cohort_pending"
    potentially_same = True
    if observation.get("attemptBoundaryVerified", True) is not True:
        reason = "attempt_cutoff_unverified"
    elif observation.get("chronologyValid") is False:
        reason = "chronology_invalid_attempt"
    elif observation.get("cohortKey") == target.get("cohortKey"):
        pass
    elif observation.get("workflow") != target.get("workflow"):
        reason, potentially_same = "verified_different_workflow", False
    elif observation.get("event") != target.get("event"):
        reason, potentially_same = "verified_different_event", False
    elif not observation.get("workflowRevision"):
        reason = "potential_same_cohort_revision_unverified"
    elif observation.get("workflowRevision") != target.get("workflowRevision"):
        reason, potentially_same = "verified_different_workflow_revision", False
    elif observation.get("executionMode") == "unknown":
        reason = "potential_same_cohort_execution_mode_unverified"
    elif not observation.get("jobTopology"):
        reason = "potential_same_cohort_job_topology_unverified"
    elif not observation.get("runnerFamilies"):
        reason = "potential_same_cohort_runner_family_unverified"
    elif observation.get("executionMode") != target.get("executionMode"):
        reason, potentially_same = "verified_different_execution_mode", False
    elif observation.get("jobTopology") != target.get("jobTopology"):
        reason, potentially_same = "verified_different_job_topology", False
    elif observation.get("runnerFamilies") != target.get("runnerFamilies"):
        reason, potentially_same = "verified_different_runner_family", False
    else:
        reason = "potential_same_cohort_unclassified"
    return {
        "runId": observation.get("runId"),
        "attempt": observation.get("attempt"),
        "sourceFingerprint": observation.get("sourceFingerprint"),
        "workflow": observation.get("workflow"),
        "event": observation.get("event"),
        "workflowRevision": observation.get("workflowRevision"),
        "executionMode": observation.get("executionMode"),
        "jobTopology": observation.get("jobTopology"),
        "runnerFamilies": observation.get("runnerFamilies"),
        "chronologyIssueCodes": observation.get("chronologyIssueCodes", []),
        "attemptBoundaryVerified": observation.get("attemptBoundaryVerified", True),
        "reason": reason,
        "potentiallySameCohort": potentially_same,
        # Any active attempt can start before the next baseline cutoff. Keep
        # classifications separate, but freeze only after all are resolved.
        "blocksReferenceFreeze": True,
    }


def assess_without_target(observation: dict) -> dict:
    reason = (
        "attempt_cutoff_unverified"
        if observation.get("attemptBoundaryVerified", True) is not True
        else "target_cohort_unavailable"
    )
    return {
        "runId": observation.get("runId"),
        "attempt": observation.get("attempt"),
        "sourceFingerprint": observation.get("sourceFingerprint"),
        "workflow": observation.get("workflow"),
        "event": observation.get("event"),
        "workflowRevision": observation.get("workflowRevision"),
        "executionMode": observation.get("executionMode"),
        "jobTopology": observation.get("jobTopology"),
        "runnerFamilies": observation.get("runnerFamilies"),
        "chronologyIssueCodes": observation.get("chronologyIssueCodes", []),
        "attemptBoundaryVerified": observation.get("attemptBoundaryVerified", True),
        "reason": reason,
        "potentiallySameCohort": True,
        "blocksReferenceFreeze": True,
    }


def evaluate_reference(state_dir: Path, checkpoint_path: Path, tick_id: str | None = None) -> dict:
    checkpoint, current_checkpoint_digest = authenticated_checkpoint(checkpoint_path)
    latest_directory = select_tick_directory(state_dir, tick_id)
    latest_tick = authenticated_tick(latest_directory)
    checkpoint_digest = latest_tick.get("checkpointSha256")
    if (
        not isinstance(checkpoint_digest, str)
        or len(checkpoint_digest) != 64
        or current_checkpoint_digest != checkpoint_digest
    ):
        raise ReferenceError("REFERENCE_CHECKPOINT_MISMATCH")
    latest_export, _, latest_workflow = authenticated_export(latest_directory)
    latest_tick_id = latest_directory.name
    # A rollover reference is grown only from this window's after phase. The
    # frozen before phase belongs to the old comparison and may not exist in
    # retained tick exports in a newly versioned state directory.
    observations = [
        item for item in checkpoint["runs"].values()
        if item.get("phase") == "after"
    ]
    target = select_current_observation(observations)
    cohort_key = target["cohortKey"] if target else None
    cohort_id = (
        MONITOR.sha256_bytes(cohort_key.encode("utf-8"))[:16]
        if cohort_key else None
    )
    cohort = [item for item in observations if item.get("cohortKey") == cohort_key]
    successes = [
        item for item in cohort
        if item.get("status") == "completed"
        and item.get("conclusion") == "success"
        and item.get("timingUsable")
        and item.get("cohortMetadataVerified")
        and item.get("sourceTree")
    ]
    unresolved = [item for item in observations if not attempt_resolved(item)]
    pending_assessments = sorted(
        (
            assess_pending(item, target)
            if target else assess_without_target(item)
            for item in unresolved
        ),
        key=lambda item: (item["runId"], item["attempt"]),
    )
    blocking_pending = list(pending_assessments)
    coverage = latest_export.get("coverage") or {}
    coverage_alerts = set(coverage.get("alerts") or [])
    collection_complete = bool(
        coverage.get("incrementalWindowComplete")
        and not (coverage_alerts & BLOCKING_COVERAGE_ALERTS)
    )
    source_trees = {item["sourceTree"] for item in successes}
    terminal = [
        item for item in cohort
        if reference_terminal(item)
    ]
    timing_excluded_terminal = [
        item
        for item in observations
        if not item.get("tombstone")
        and item.get(
            "terminalOutcomeComplete",
            item.get("terminalEvidenceComplete", False),
        )
        and item.get("conclusion") == "success"
        and not item.get("timingUsable")
    ]
    candidate_within_bound = len(terminal) <= MAXIMUM_CANDIDATE_ATTEMPTS
    ready_now = bool(
        cohort_key
        and collection_complete
        and not unresolved
        and candidate_within_bound
        and len(successes) >= 7
        and len(source_trees) >= 7
    )
    result = {
        "schema": f"{SCHEMA}/readiness",
        "status": "reference_candidate_ready" if ready_now else "collecting_reference",
        "cohortId": cohort_id,
        "successCount": len(successes),
        "distinctSourceTreeCount": len(source_trees),
        "terminalFailureCounts": dict(sorted(Counter(
            item.get("conclusion") for item in cohort
            if reference_terminal(item)
            and item.get("conclusion") != "success"
        ).items())),
        "pendingSameCohortCount": sum(
            item["reason"] == "exact_cohort_pending"
            for item in pending_assessments
        ),
        "potentialSameCohortPendingCount": sum(
            item["potentiallySameCohort"]
            and item["reason"] != "exact_cohort_pending"
            for item in pending_assessments
        ),
        "blockingPendingCount": len(blocking_pending),
        "verifiedDifferentPendingCount": sum(
            not item["potentiallySameCohort"] for item in pending_assessments
        ),
        "pendingReasonCounts": dict(sorted(Counter(
            item["reason"] for item in pending_assessments
        ).items())),
        "chronologyInvalidAttemptCount": sum(
            item.get("chronologyValid") is False for item in observations
        ),
        "chronologyIssueCodeCounts": dict(sorted(Counter(
            code
            for item in observations
            for code in item.get("chronologyIssueCodes", [])
        ).items())),
        "timingExcludedTerminalCount": len(timing_excluded_terminal),
        "timingExclusionReasonCounts": dict(sorted(Counter(
            reason
            for item in timing_excluded_terminal
            for reason in item.get("timingExclusionReasons", [])
        ).items())),
        "pendingAssessments": pending_assessments,
        "collectionComplete": collection_complete,
        "blockingCoverageAlerts": sorted(coverage_alerts & BLOCKING_COVERAGE_ALERTS),
        "minimumSuccessCount": 7,
        "minimumDistinctSourceTreeCount": 7,
        "candidateAttemptCount": len(terminal),
        "maximumCandidateAttempts": MAXIMUM_CANDIDATE_ATTEMPTS,
        "candidateWithinBound": candidate_within_bound,
        "candidateIsImprovementClaim": False,
        "transitionPolicy": {
            "automaticPhaseMoveAllowed": False,
            "preserveSourceWindowForUnresolvedAttempts": bool(unresolved),
            "continuedSourceWindowMonitoringGuaranteedByHelper": False,
            "unresolvedAttemptCount": len(unresolved),
            "trackingBoundary": "original_source_window",
        },
    }
    frozen = prior_candidate(state_dir, cohort_id)
    if frozen:
        candidate_path, candidate_sha, candidate = frozen
        if (
            candidate.get("schema") != f"{SCHEMA}/candidate"
            or (candidate.get("reference") or {}).get("cohortId") != cohort_id
        ):
            raise ReferenceError("INVALID_FROZEN_REFERENCE_CANDIDATE")
        result.update(
            candidateBaselinePath=state_ref(state_dir, candidate_path),
            candidateBaselineSha256=candidate_sha,
        )
        if ready_now:
            result["status"] = "reference_candidate_ready"
            result["notificationKey"] = (
                f"reference_ready:{cohort_id}:{candidate_sha}"
            )
    elif ready_now:
        raw_records, export_captures = retained_inputs_for_candidate(state_dir)
        raw_by_fingerprint = {
            MONITOR.sha256_bytes(MONITOR.canonical_json(record)): record
            for record in raw_records
        }
        candidate_records = []
        for observation in sorted(terminal, key=lambda item: (item["runId"], item["attempt"])):
            raw = raw_by_fingerprint.get(observation.get("sourceFingerprint"))
            if raw is None:
                raise ReferenceError("REFERENCE_SOURCE_RECEIPT_MISSING")
            candidate_records.append(raw)
        candidate = {
            "schema": f"{SCHEMA}/candidate",
            "workflow": latest_workflow,
            "capturedAtUtc": latest_export["capturedAtUtc"],
            "runs": candidate_records,
            "reference": {
                "cohortId": cohort_id,
                "cohortKeySha256": MONITOR.sha256_bytes(cohort_key.encode("utf-8")),
                "successCount": len(successes),
                "distinctSourceTreeCount": len(source_trees),
                "terminalFailureCounts": result["terminalFailureCounts"],
                "pendingSameCohortCount": 0,
                "blockingPendingCount": 0,
                "candidateIsImprovementClaim": False,
            },
        }
        candidate_path = state_dir / "reference-candidates" / f"{cohort_id}.json"
        # Validate confinement before either reading an orphan or creating a new
        # immutable candidate. A crash may leave the candidate after its durable
        # link but before the cohort receipt; authenticate that exact byte object
        # against the current cohort and a retained export instead of rebuilding
        # it with a newer capture timestamp.
        candidate_reference = state_ref(state_dir, candidate_path)
        if candidate_path.exists():
            candidate, candidate_sha = authenticate_orphan_candidate(
                candidate_path, candidate, export_captures
            )
        else:
            candidate_sha = MONITOR.sha256_bytes(MONITOR.canonical_json(candidate))
            try:
                atomic_create_json(candidate_path, candidate)
            except ReferenceError as error:
                if str(error) != "REFERENCE_CANDIDATE_ALREADY_EXISTS":
                    raise
                candidate, candidate_sha = authenticate_orphan_candidate(
                    candidate_path, candidate, export_captures
                )
        manifest_path = candidate_manifest_path(state_dir, cohort_id)
        state_ref(state_dir, manifest_path)
        atomic_create_json(manifest_path, {
            "schema": f"{SCHEMA}/candidate-receipt",
            "cohortId": cohort_id,
            "candidateBaselinePath": candidate_reference,
            "candidateBaselineSha256": candidate_sha,
        })
        result.update(
            candidateBaselinePath=state_ref(state_dir, candidate_path),
            candidateBaselineSha256=candidate_sha,
            notificationKey=f"reference_ready:{cohort_id}:{candidate_sha}",
        )
    if result["status"] == "reference_candidate_ready":
        result["rolloverProcedure"] = [
            "pause_monitor_after_completed_tick",
            "archive_current_state_directory_immutably",
            "start_empty_versioned_state_directory",
            "use_candidate_path_and_sha_as_new_baseline",
            "verify_new_config_and_first_tick_before_resuming",
        ]
    receipt_id = tick_id or latest_tick_id
    receipt_path = state_dir / "reference-readiness" / f"{receipt_id}.json"
    result["readinessReceiptPath"] = state_ref(state_dir, receipt_path)
    atomic_create_json(receipt_path, result)
    return result


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", required=True, type=Path)
    parser.add_argument("--checkpoint", required=True, type=Path)
    parser.add_argument("--tick-id")
    args = parser.parse_args(argv)
    try:
        print(json.dumps(
            evaluate_reference(args.state_dir, args.checkpoint, args.tick_id),
            sort_keys=True,
        ))
        return 0
    except (ReferenceError, MONITOR.MonitorError, OSError, ValueError, KeyError):
        print(json.dumps({"status": "failed", "code": "REFERENCE_PREPARATION_FAILED"}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
