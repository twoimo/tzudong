#!/usr/bin/env python3
"""Measure whether the working local schema restores on PostgreSQL 17.

The adapter layer makes the historical migration chain replay on PG15. Rewriting
that layer is a project of its own, so this probe asks a different question: does
the schema the working pipeline produces restore cleanly on the PG17 image? If it
does, the transition can move to a baseline restore instead of an adapter rewrite.

Runs inside the nightly local regression, where the stack is already up:

    python3 backend/supabase/scripts/pg17_baseline_probe.py \
        --database-container "$LOCAL_DB_CONTAINER" --output "$RUNNER_TEMP/pg17-baseline.json"

It never touches the running stack: the dump is read-only and the restore happens
in a disposable PG17 container that is removed afterwards.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Sequence

PG17_IMAGE = "supabase/postgres:17.11.0.018"
RESTORE_CONTAINER = "tzudong-pg17-baseline"
SCHEMAS = ("public", "privacy_retention", "ocr_private", "private", "storage", "auth")
OBJECT_COUNT_SQL = """
SELECT pg_catalog.count(*) FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r','p','v','m','S') AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast');
"""


def run(command: Sequence[str], *, check: bool = True, capture: bool = False) -> subprocess.CompletedProcess[bytes]:
    result = subprocess.run(command, capture_output=capture)
    if check and result.returncode != 0:
        raise SystemExit(f"probe step failed: {' '.join(command)}")
    return result


def psql(container: str, role: str, sql: str, *, database: str = "postgres") -> bytes:
    return run([
        "docker", "exec", "-i", container,
        "psql", "-U", role, "-d", database, "-q", "-t", "-A", "--set", "ON_ERROR_STOP=1", "-c", sql,
    ], capture=True).stdout


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--database-container", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--database", default="postgres")
    args = parser.parse_args()

    source_objects = int(psql(args.database_container, "postgres", OBJECT_COUNT_SQL).decode().strip() or 0)

    dump_path = args.output.with_suffix(".sql")
    dump = run([
        "docker", "exec", args.database_container,
        "pg_dump", "-U", "postgres", "-d", args.database, "--schema-only",
        "--no-owner", "--no-privileges",
    ], capture=True).stdout
    dump_path.write_bytes(dump)

    run(["docker", "rm", "-f", RESTORE_CONTAINER], check=False)
    run([
        "docker", "run", "-d", "--name", RESTORE_CONTAINER,
        "-e", "POSTGRES_DB=profile", "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
        PG17_IMAGE,
    ])
    try:
        for _ in range(120):
            ready = subprocess.run(
                ["docker", "exec", RESTORE_CONTAINER, "pg_isready", "-U", "postgres", "-h", "localhost"],
                capture_output=True,
            )
            if ready.returncode == 0:
                break
            time.sleep(2)
        run(["docker", "cp", str(dump_path), f"{RESTORE_CONTAINER}:/tmp/dump.sql"])
        restore = run([
            "docker", "exec", "-i", RESTORE_CONTAINER,
            "psql", "-U", "postgres", "-d", "profile", "-q", "-v", "ON_ERROR_STOP=0", "-f", "/tmp/dump.sql",
        ], check=False, capture=True)
        restore_errors = [
            line.split("ERROR:")[-1].strip()[:160]
            for line in restore.stderr.decode("utf-8", "replace").splitlines()
            if "ERROR:" in line
        ]
        restored_objects = int(psql(RESTORE_CONTAINER, "postgres", OBJECT_COUNT_SQL, database="profile").decode().strip() or 0)
        record: dict[str, Any] = {
            "schemaVersion": 1,
            "kind": "local-pg17-baseline-probe",
            "sourceImage": "local stack (working schema, adapters applied)",
            "targetImage": PG17_IMAGE,
            "sourceObjects": source_objects,
            "restoredObjects": restored_objects,
            "dumpBytes": len(dump),
            "restoreExitCode": restore.returncode,
            "restoreErrorCount": len(restore_errors),
            "restoreErrors": restore_errors[:20],
            "restored": source_objects > 0 and restored_objects == source_objects and not restore_errors,
        }
    finally:
        run(["docker", "rm", "-f", RESTORE_CONTAINER], check=False)
        dump_path.unlink(missing_ok=True)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: record[key] for key in ("sourceObjects", "restoredObjects", "restoreErrorCount", "restored")}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
