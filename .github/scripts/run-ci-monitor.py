#!/usr/bin/env python3
"""One bounded CI observation tick; no reruns or remote writes.

The native heartbeat invokes this deterministic entrypoint. The heartbeat
itself may consume model quota; this program does not call any model.
"""
from __future__ import annotations

import argparse
import fcntl
import importlib.util
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("ci_monitor", HERE / "monitor-ci-performance.py")
MONITOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MONITOR)
REFERENCE_SPEC = importlib.util.spec_from_file_location(
    "ci_reference", HERE / "prepare-ci-reference.py"
)
REFERENCE = importlib.util.module_from_spec(REFERENCE_SPEC)
REFERENCE_SPEC.loader.exec_module(REFERENCE)


class TickError(RuntimeError):
    pass


BASELINE_TERMINAL_CONCLUSIONS = (
    set(MONITOR.VALID_CONCLUSIONS) - {"missing", "stale"}
)


def state_receipt_ref(state_dir: Path, path: Path) -> str:
    """Return a relocatable receipt reference without an operator home path."""
    try:
        relative = path.resolve().relative_to(state_dir.resolve())
    except ValueError:
        raise TickError("RECEIPT_OUTSIDE_STATE_ROOT") from None
    if not relative.parts or any(part in {"", ".", ".."} for part in relative.parts):
        raise TickError("INVALID_STATE_RECEIPT_REF")
    return "state://" + relative.as_posix()


def resolve_state_receipt_ref(state_dir: Path, reference: str) -> Path:
    """Resolve only references emitted by :func:`state_receipt_ref`."""
    if not isinstance(reference, str) or not reference.startswith("state://"):
        raise TickError("INVALID_STATE_RECEIPT_REF")
    relative = Path(reference.removeprefix("state://"))
    if relative.is_absolute() or not relative.parts or any(
        part in {"", ".", ".."} for part in relative.parts
    ):
        raise TickError("INVALID_STATE_RECEIPT_REF")
    candidate = (state_dir / relative).resolve()
    try:
        candidate.relative_to(state_dir.resolve())
    except ValueError:
        raise TickError("RECEIPT_OUTSIDE_STATE_ROOT") from None
    return candidate


def validate_frozen_baseline(payload) -> list[dict]:
    """Require terminal attempts and complete timing evidence for successes."""
    try:
        records, metadata = MONITOR.extract_records(payload)
        workflow_metadata_verified = metadata.get("workflow") is not None
        workflow = MONITOR.safe_workflow(
            metadata.get("workflow"), ".github/workflows/web-admin-ci.yml"
        )
    except (MONITOR.MonitorError, KeyError, TypeError, ValueError):
        raise TickError("BASELINE_TERMINAL_EVIDENCE_INCOMPLETE") from None
    for record in records:
        status = str(MONITOR.get_first(record, "status") or "missing").lower()
        conclusion = str(MONITOR.get_first(record, "conclusion") or "missing").lower()
        if status != "completed" or conclusion not in BASELINE_TERMINAL_CONCLUSIONS:
            raise TickError("BASELINE_TERMINAL_EVIDENCE_INCOMPLETE")
        try:
            observation = MONITOR.analyze_record(
                record,
                "before",
                workflow,
                workflow_metadata_verified,
                MONITOR.sha256_bytes(MONITOR.canonical_json(record)),
            )
        except (MONITOR.MonitorError, KeyError, TypeError, ValueError):
            raise TickError("BASELINE_TERMINAL_EVIDENCE_INCOMPLETE") from None
        if not observation.get("terminalOutcomeComplete"):
            raise TickError("BASELINE_TERMINAL_EVIDENCE_INCOMPLETE")
        if conclusion == "success" and not observation.get("timingUsable"):
            raise TickError("BASELINE_TERMINAL_EVIDENCE_INCOMPLETE")
    return records


def load_authenticated_baseline(path: Path, expected_sha256: str) -> dict:
    """Verify and parse the exact same baseline byte snapshot."""
    try:
        payload = path.read_bytes()
    except OSError:
        raise TickError("BASELINE_READ_FAILED") from None
    if MONITOR.sha256_bytes(payload) != expected_sha256:
        raise TickError("BASELINE_HASH_MISMATCH")
    try:
        baseline = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise TickError("BASELINE_INVALID_JSON") from None
    if not isinstance(baseline, dict):
        raise TickError("BASELINE_INVALID_JSON")
    return baseline


def future_observations(payload, baseline):
    """Do not mislabel an older pagination catch-up as an after sample."""
    cutoff = MONITOR.COLLECTOR.parse_timestamp(baseline["capturedAtUtc"])
    baseline_keys = {(r["id"], r["attempt"]) for r in baseline["runs"]}
    baseline_attempts = {}
    for run_id, attempt in baseline_keys:
        baseline_attempts[run_id] = max(attempt, baseline_attempts.get(run_id, 0))
    included, excluded, uncertain = [], 0, 0
    for record in payload["runs"]:
        run_id = record["id"]
        attempt = MONITOR.run_attempt(record)
        if (run_id, attempt) in baseline_keys:
            continue
        prior_attempt = baseline_attempts.get(run_id)
        rerun = attempt > 1
        if rerun:
            # createdAt belongs to the original workflow run. For a rerun,
            # startedAt is the phase clock; updatedAt is only the fallback for
            # an attempt cancelled before a runner starts. A post-cutoff
            # original creation is also sufficient because the rerun cannot
            # predate it. Missing attempt clocks remain pending.
            started = record.get("startedAt")
            updated = record.get("updatedAt")
            created = record.get("createdAt")
            if started:
                boundary_verified = (
                    MONITOR.COLLECTOR.parse_timestamp(started) > cutoff
                )
            elif updated:
                boundary_verified = (
                    MONITOR.COLLECTOR.parse_timestamp(updated) > cutoff
                )
            elif created and MONITOR.COLLECTOR.parse_timestamp(created) > cutoff:
                boundary_verified = True
            else:
                included.append(dict(record, attemptBoundaryVerified=False))
                uncertain += 1
                continue
            if boundary_verified:
                included.append(dict(record, attemptBoundaryVerified=True))
            else:
                excluded += 1
            continue
        started = record.get("startedAt")
        created = record.get("createdAt") if prior_attempt is None else None
        boundary_verified = any(
            value
            and MONITOR.COLLECTOR.parse_timestamp(value) > cutoff
            for value in (started, created)
        )
        if not boundary_verified:
            excluded += 1
            continue
        included.append(dict(record, attemptBoundaryVerified=True))
    return {
        "workflow": payload["workflow"], "runs": included,
        "sourceExportSha256": MONITOR.sha256_bytes(MONITOR.canonical_json(payload)),
        "baselineCutoffUtc": baseline["capturedAtUtc"],
        "excludedHistoricalAttempts": excluded,
        "uncertainAttemptBoundaryCount": uncertain,
    }


def execute(command, timeout, failure_code):
    try:
        result = subprocess.run(command, capture_output=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        raise TickError(failure_code + "_TIMEOUT") from None
    if result.returncode:
        raise TickError(failure_code)


def tick(args):
    args.state_dir.mkdir(parents=True, exist_ok=True)
    with (args.state_dir / "tick.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise TickError("MONITOR_ALREADY_RUNNING") from None
        baseline = load_authenticated_baseline(args.baseline, args.baseline_sha256)
        records = validate_frozen_baseline(baseline)
        if len(records) > 100:
            raise TickError("BASELINE_ATTEMPT_BOUND")
        config = {
            "baselineSha256": args.baseline_sha256,
            "repository": "twoimo/tzudong", "workflow": "web-admin-ci.yml",
            "limit": 20, "maximumPages": 5,
            "maximumKnownTerminalRunRefreshes": 20,
            "maximumInputAttempts": 2300,
            "maximumBaselineAttempts": 100,
            "sourceSha256": {
                name: MONITOR.sha256_file(HERE / name) for name in (
                    "collect-ci-performance.py", "collect-ci-monitor.py",
                    "monitor-ci-performance.py", "prepare-ci-reference.py",
                    "run-ci-monitor.py",
                )
            },
        }
        config_path = args.state_dir / "monitor-config.json"
        if config_path.exists() and MONITOR.load_json(config_path) != config:
            raise TickError("MONITOR_CONFIG_CHANGED_PRESERVE_WINDOW")
        if not config_path.exists():
            MONITOR.atomic_write_json(config_path, config)
        tick_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
        directory = args.state_dir / "ticks" / tick_id
        directory.mkdir(parents=True)
        baseline_snapshot_path = directory / "baseline.json"
        MONITOR.atomic_write_json(baseline_snapshot_path, baseline)
        export_path = directory / "export.json"
        if args.input:
            export = MONITOR.load_json(args.input)
            MONITOR.atomic_write_json(export_path, export)
        else:
            execute([
                sys.executable, str(HERE / "collect-ci-monitor.py"),
                "--cache", str(args.state_dir / "collection.sqlite"),
                "--output", str(export_path), "--limit", "20", "--max-pages", "5",
            ], 300, "COLLECTION_FAILED")
            export = MONITOR.load_json(export_path)
        current = future_observations(export, baseline)
        current_path = directory / "current.json"
        MONITOR.atomic_write_json(current_path, current)
        receipt_path = directory / "analysis.json"
        execute([
            sys.executable, str(HERE / "monitor-ci-performance.py"),
            "--before-input", str(baseline_snapshot_path),
            "--after-input", str(current_path),
            "--checkpoint", str(args.state_dir / "analysis-state.json"),
            "--receipt", str(receipt_path), "--max-input-runs", "2300",
        ], 60, "ANALYSIS_FAILED")
        receipt = MONITOR.load_json(receipt_path)
        checkpoint = MONITOR.load_json(args.state_dir / "analysis-state.json")
        analysis = receipt["analysis"]
        alerts = {"coverage:" + code for code in export.get("coverage", {}).get("alerts", [])}
        for observation in checkpoint["runs"].values():
            if observation["phase"] == "after" and observation["conclusion"] in MONITOR.FAILURE_CONCLUSIONS:
                alerts.add(f"failure:{observation['runId']}:{observation['attempt']}")
            if observation["phase"] == "after":
                for code in observation.get("chronologyIssueCodes", []):
                    alerts.add(
                        f"chronology:{observation['runId']}:"
                        f"{observation['attempt']}:{code}"
                    )
        for cohort in analysis["cohorts"]:
            cohort_id = MONITOR.sha256_bytes(MONITOR.canonical_json(cohort["cohortKey"]))[:16]
            for metric, evidence in cohort["metrics"].items():
                signal = evidence.get("signal", "")
                if signal in {"exploratory_improvement_signal", "exploratory_regression_signal"}:
                    alerts.add(f"{signal}:{cohort_id}:{metric}")
        last_path = args.state_dir / "last-tick.json"
        previous = MONITOR.load_json(last_path) if last_path.exists() else {}
        new_alerts = sorted(alerts - set(previous.get("activeAlertKeys", [])))
        result = {
            "schema": "tzudong-ci-monitor-tick/v1", "status": "observed",
            "mode": "offline_replay" if args.input else "live_read",
            "apiRequestsThisTick": 0 if args.input else export.get("collection", {}).get("apiRequests"),
            "observedAtUtc": export.get("capturedAtUtc"), "tickId": tick_id,
            "collection": export.get("collection", {}),
            "coverage": export.get("coverage", {}),
            "admittedAttemptCount": receipt["admittedRunCount"],
            "duplicateAttemptCount": receipt["duplicateRunIdCount"],
            "excludedHistoricalAttempts": current["excludedHistoricalAttempts"],
            "uncertainAttemptBoundaryCount": current["uncertainAttemptBoundaryCount"],
            "conclusions": analysis["runConclusionCounts"],
            "chronologyInvalidAttemptCount": analysis["chronologyInvalidRunCount"],
            "cohortCount": len(analysis["cohorts"]),
            "activeAlertKeys": sorted(alerts), "newAlertKeys": new_alerts,
            "shouldNotify": bool(new_alerts), "causalClaimAllowed": False,
            "modelsInvokedByProgram": 0, "remoteMutations": 0,
            "configSha256": MONITOR.sha256_bytes(MONITOR.canonical_json(config)),
            "exportSha256": MONITOR.sha256_file(export_path),
            "analysisSha256": MONITOR.sha256_file(receipt_path),
            "checkpointSha256": MONITOR.sha256_file(
                args.state_dir / "analysis-state.json"
            ),
            "receiptPath": state_receipt_ref(args.state_dir, receipt_path),
        }
        # The provisional receipt lets the reference evaluator authenticate the
        # current export. It is rewritten atomically after readiness is known.
        tick_path = directory / "tick.json"
        MONITOR.atomic_write_json(tick_path, result)
        reference = REFERENCE.evaluate_reference(
            args.state_dir,
            args.state_dir / "analysis-state.json",
            tick_id,
        )
        reference_key = reference.get("notificationKey")
        if reference_key:
            alerts.add(reference_key)
        new_alerts = sorted(alerts - set(previous.get("activeAlertKeys", [])))
        result.update(
            activeAlertKeys=sorted(alerts),
            newAlertKeys=new_alerts,
            shouldNotify=bool(new_alerts),
            referenceReadiness={
                key: reference[key]
                for key in (
                    "status", "cohortId", "successCount",
                    "distinctSourceTreeCount", "pendingSameCohortCount",
                    "potentialSameCohortPendingCount", "blockingPendingCount",
                    "verifiedDifferentPendingCount", "pendingReasonCounts",
                    "chronologyInvalidAttemptCount", "chronologyIssueCodeCounts",
                    "timingExcludedTerminalCount", "timingExclusionReasonCounts",
                    "collectionComplete", "candidateBaselineSha256",
                    "candidateBaselinePath", "readinessReceiptPath",
                )
                if key in reference
            },
        )
        MONITOR.atomic_write_json(tick_path, result)
        MONITOR.atomic_write_json(last_path, result)
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--baseline-sha256", required=True)
    parser.add_argument("--input", type=Path, help="Retained sanitized export; makes this tick offline")
    args = parser.parse_args(argv)
    try:
        print(json.dumps(tick(args), sort_keys=True))
        return 0
    except TickError as error:
        print(json.dumps({"status": "failed", "code": str(error), "remoteMutations": 0}))
        return 2
    except (MONITOR.MonitorError, REFERENCE.ReferenceError, KeyError, ValueError, OSError):
        print(json.dumps({"status": "failed", "code": "MONITOR_TICK_FAILED", "remoteMutations": 0}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
