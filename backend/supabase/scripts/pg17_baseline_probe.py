#!/usr/bin/env python3
"""Measure whether the working local schema restores on PostgreSQL 17.

The adapter layer makes the historical migration chain replay on PG15. Rewriting that
layer is a project of its own, so this probe asks a different question: does the schema
the working pipeline produces restore cleanly on the PG17 image? If it does, the
transition can move to baseline provisioning (see local_baseline.py) instead.

Runs inside the nightly local regression, where the stack is already up:

    python3 backend/supabase/scripts/pg17_baseline_probe.py \
        --database-container "$LOCAL_DB_CONTAINER" --output "$RUNNER_TEMP/pg17-baseline.json"

It never touches the running stack: the capture is read-only and the restore happens
in a disposable PG17 container that is removed afterwards. The work itself is
local_baseline.capture + local_baseline.provision, so a green probe also exercises the
provisioning path that the transition depends on.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent))

import local_baseline as lb  # noqa: E402

PG17_IMAGE = "supabase/postgres:17.11.0.018"
RESTORE_CONTAINER = "tzudong-pg17-baseline"
RESTORE_ROLE = lb.RESTORE_ROLE


def _run(command: Sequence[str], *, check: bool = True) -> subprocess.CompletedProcess:
    result = subprocess.run(command, capture_output=True)
    if check and result.returncode != 0:
        raise SystemExit(f"probe step failed: {' '.join(command)}")
    return result


def _wait_ready(container: str) -> None:
    for _ in range(120):
        ready = subprocess.run(
            ["docker", "exec", container, "pg_isready", "-U", "postgres", "-h", "localhost"],
            capture_output=True,
        )
        if ready.returncode == 0:
            return
        time.sleep(2)
    raise SystemExit("restore container never became ready")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--database-container", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--database", default="postgres")
    parser.add_argument("--restore-role", default=RESTORE_ROLE)
    # Keep the captured baseline instead of discarding it: this is the artifact a
    # provisioned stack needs, and producing it is the same read-only capture.
    parser.add_argument("--baseline-output", type=Path)
    args = parser.parse_args()

    with tempfile.TemporaryDirectory() as workspace:
        target = args.baseline_output if args.baseline_output else Path(workspace) / "baseline"
        baseline = lb.capture(args.database_container, args.database, target,
                              source_image="local stack (working schema, adapters applied)")
        _run(["docker", "rm", "-f", RESTORE_CONTAINER], check=False)
        _run(["docker", "run", "-d", "--name", RESTORE_CONTAINER,
              "-e", "POSTGRES_DB=profile", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", PG17_IMAGE])
        try:
            _wait_ready(RESTORE_CONTAINER)
            provisioned = lb.provision(baseline, RESTORE_CONTAINER, "profile", role=args.restore_role)
        finally:
            _run(["docker", "rm", "-f", RESTORE_CONTAINER], check=False)

    record: dict[str, Any] = {
        "schemaVersion": 1,
        "kind": "local-pg17-baseline-probe",
        "sourceImage": baseline.manifest["sourceImage"],
        "targetImage": PG17_IMAGE,
        "restoreRole": args.restore_role,
        "preparedRoleCount": provisioned["preparedRoleCount"],
        "setupErrorCount": provisioned["setupErrorCount"],
        "setupErrors": provisioned["setupErrors"],
        "sourceObjects": baseline.manifest["objectCount"],
        "restoredObjects": provisioned["restoredObjectCount"],
        "dumpBytes": baseline.manifest["schemaBytes"],
        "restoreErrorCount": provisioned["restoreErrorCount"],
        "restoreErrors": provisioned["restoreErrors"],
        "missingObjectCount": provisioned["missingObjectCount"],
        "missingObjects": provisioned["missingObjects"],
        "restored": provisioned["provisioned"],
        "baselineManifest": baseline.manifest,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: record[key] for key in (
        "sourceObjects", "restoredObjects", "preparedRoleCount", "setupErrorCount",
        "restoreErrorCount", "missingObjectCount", "restored")}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
