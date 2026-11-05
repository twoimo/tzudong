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


class TickError(RuntimeError):
    pass


def future_observations(payload, baseline):
    """Do not mislabel an older pagination catch-up as an after sample."""
    cutoff = MONITOR.COLLECTOR.parse_timestamp(baseline["capturedAtUtc"])
    baseline_keys = {(r["id"], r["attempt"]) for r in baseline["runs"]}
    included, excluded = [], 0
    for record in payload["runs"]:
        if (record["id"], record["attempt"]) in baseline_keys:
            continue
        started = record.get("startedAt") or record.get("createdAt")
        if started and MONITOR.COLLECTOR.parse_timestamp(started) > cutoff:
            included.append(record)
        else:
            excluded += 1
    return {
        "workflow": payload["workflow"], "runs": included,
        "sourceExportSha256": MONITOR.sha256_bytes(MONITOR.canonical_json(payload)),
        "baselineCutoffUtc": baseline["capturedAtUtc"],
        "excludedHistoricalAttempts": excluded,
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
        if MONITOR.sha256_file(args.baseline) != args.baseline_sha256:
            raise TickError("BASELINE_HASH_MISMATCH")
        baseline = MONITOR.load_json(args.baseline)
        if not isinstance(baseline.get("runs"), list) or len(baseline["runs"]) > 100:
            raise TickError("BASELINE_ATTEMPT_BOUND")
        config = {
            "baselineSha256": args.baseline_sha256,
            "repository": "twoimo/tzudong", "workflow": "web-admin-ci.yml",
            "limit": 20, "maximumPages": 5, "maximumInputAttempts": 2100,
            "maximumBaselineAttempts": 100,
            "sourceSha256": {
                name: MONITOR.sha256_file(HERE / name) for name in (
                    "collect-ci-performance.py", "collect-ci-monitor.py",
                    "monitor-ci-performance.py", "run-ci-monitor.py",
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
            "--before-input", str(args.baseline), "--after-input", str(current_path),
            "--checkpoint", str(args.state_dir / "analysis-state.json"),
            "--receipt", str(receipt_path), "--max-input-runs", "2100",
        ], 60, "ANALYSIS_FAILED")
        receipt = MONITOR.load_json(receipt_path)
        checkpoint = MONITOR.load_json(args.state_dir / "analysis-state.json")
        analysis = receipt["analysis"]
        alerts = {"coverage:" + code for code in export.get("coverage", {}).get("alerts", [])}
        for observation in checkpoint["runs"].values():
            if observation["phase"] == "after" and observation["conclusion"] in MONITOR.FAILURE_CONCLUSIONS:
                alerts.add(f"failure:{observation['runId']}:{observation['attempt']}")
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
            "observedAtUtc": export.get("capturedAtUtc"), "tickId": tick_id,
            "collection": export.get("collection", {}),
            "coverage": export.get("coverage", {}),
            "admittedAttemptCount": receipt["admittedRunCount"],
            "duplicateAttemptCount": receipt["duplicateRunIdCount"],
            "excludedHistoricalAttempts": current["excludedHistoricalAttempts"],
            "conclusions": analysis["runConclusionCounts"],
            "cohortCount": len(analysis["cohorts"]),
            "activeAlertKeys": sorted(alerts), "newAlertKeys": new_alerts,
            "shouldNotify": bool(new_alerts), "causalClaimAllowed": False,
            "modelsInvokedByProgram": 0, "remoteMutations": 0,
            "configSha256": MONITOR.sha256_bytes(MONITOR.canonical_json(config)),
            "exportSha256": MONITOR.sha256_file(export_path),
            "analysisSha256": MONITOR.sha256_file(receipt_path),
            "receiptPath": str(receipt_path),
        }
        MONITOR.atomic_write_json(directory / "tick.json", result)
        MONITOR.atomic_write_json(last_path, result)
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--baseline-sha256", required=True)
    parser.add_argument("--input", type=Path, help="Retained sanitized export; makes this tick offline")
    args = parser.parse_args()
    try:
        print(json.dumps(tick(args), sort_keys=True))
        return 0
    except TickError as error:
        print(json.dumps({"status": "failed", "code": str(error), "remoteMutations": 0}))
        return 2
    except (MONITOR.MonitorError, KeyError, ValueError, OSError):
        print(json.dumps({"status": "failed", "code": "MONITOR_TICK_FAILED", "remoteMutations": 0}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
