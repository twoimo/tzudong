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
# The supabase image does not give `postgres` DDL rights: restoring as it fails with
# "permission denied for database <name>" on every statement. supabase_admin owns the
# catalogue, so the restore and the object count both run as that role.
RESTORE_ROLE = "supabase_admin"
SCHEMAS = ("public", "privacy_retention", "ocr_private", "private", "storage", "auth")
OBJECT_COUNT_SQL = """
SELECT pg_catalog.count(*) FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r','p','v','m','S') AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast');
"""
# A schema-only dump carries no CREATE ROLE, so every statement that names a
# project role fails on a fresh cluster. Measured: 119 of 120 genuine errors were
# 'role "privacy_workflow_owner" does not exist' - a row-level security policy
# naming the role, which the owner-only query did not cover.
ROLE_STATEMENTS_SQL = """
WITH referenced AS (
  SELECT unnest(polroles) AS oid FROM pg_catalog.pg_policy WHERE polroles <> '{0}'
  UNION
  SELECT defaclrole FROM pg_catalog.pg_default_acl
  UNION
  SELECT relowner FROM pg_catalog.pg_class
  UNION
  SELECT proowner FROM pg_catalog.pg_proc
)
SELECT format('CREATE ROLE %I NOLOGIN', r.rolname) FROM pg_catalog.pg_roles r
WHERE r.rolname NOT LIKE 'pg\\_%'
  AND r.rolname NOT IN ('postgres','supabase_admin','supabase_auth_admin','supabase_storage_admin',
                        'authenticator','dashboard_user','anon','authenticated','service_role')
  AND (r.oid IN (SELECT oid FROM referenced) OR r.rolname LIKE 'privacy\\_%')
ORDER BY 1;
"""
# The supabase image seeds schemas this project also creates, and --clean cannot drop
# them because the image's own objects depend on them. Drop them first so the dump
# owns the state it describes.
SEEDED_SCHEMAS = ("auth", "storage", "vault", "extensions", "graphql", "graphql_public",
                  "pgbouncer", "realtime", "cron", "net", "pgsodium", "pgtle")
OBJECT_NAMES_SQL = """
SELECT n.nspname || '.' || c.relname FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r','p','v','m','S') AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
ORDER BY 1;
"""


def run(command: Sequence[str], *, check: bool = True, capture: bool = False) -> subprocess.CompletedProcess[bytes]:
    result = subprocess.run(command, capture_output=capture)
    if check and result.returncode != 0:
        raise SystemExit(f"probe step failed: {' '.join(command)}")
    return result


def _is_already_exists(error: str) -> bool:
    return "already exists" in error


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
    parser.add_argument("--restore-role", default=RESTORE_ROLE)
    args = parser.parse_args()

    source_objects = int(psql(args.database_container, "postgres", OBJECT_COUNT_SQL).decode().strip() or 0)

    dump_path = args.output.with_suffix(".sql")
    dump = run([
        "docker", "exec", args.database_container,
        "pg_dump", "-U", "postgres", "-d", args.database, "--schema-only",
        "--no-owner", "--no-privileges", "--clean", "--if-exists",
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
        role_statements = [
            line for line in psql(args.database_container, "postgres", ROLE_STATEMENTS_SQL).decode().splitlines() if line
        ]
        setup_statements = role_statements + [
            f"DROP SCHEMA IF EXISTS {schema} CASCADE;" for schema in SEEDED_SCHEMAS
        ]
        setup_path = args.output.with_suffix(".setup.sql")
        setup_path.write_text("\n".join(setup_statements) + "\n", encoding="utf-8")
        run(["docker", "cp", str(setup_path), f"{RESTORE_CONTAINER}:/tmp/setup.sql"])
        run([
            "docker", "exec", "-i", RESTORE_CONTAINER,
            "psql", "-U", args.restore_role, "-d", "profile", "-q", "-v", "ON_ERROR_STOP=0", "-f", "/tmp/setup.sql",
        ], check=False, capture=True)
        setup_path.unlink(missing_ok=True)
        run(["docker", "cp", str(dump_path), f"{RESTORE_CONTAINER}:/tmp/dump.sql"])
        restore = run([
            "docker", "exec", "-i", RESTORE_CONTAINER,
            "psql", "-U", args.restore_role, "-d", "profile", "-q", "-v", "ON_ERROR_STOP=0", "-f", "/tmp/dump.sql",
        ], check=False, capture=True)
        all_errors = [
            line.split("ERROR:")[-1].strip()[:200]
            for line in restore.stderr.decode("utf-8", "replace").splitlines()
            if "ERROR:" in line
        ]
        # The supabase image ships its own auth, storage, vault, extensions, graphql,
        # realtime and pgbouncer schemas, so a restore into it reports "already exists"
        # for objects this project also creates. Those are not incompatibilities and
        # must not be counted as such.
        preexisting = [error for error in all_errors if _is_already_exists(error)]
        restore_errors = [error for error in all_errors if not _is_already_exists(error)]
        source_names = {line for line in psql(args.database_container, "postgres", OBJECT_NAMES_SQL).decode().splitlines() if line}
        restored_names = {line for line in psql(RESTORE_CONTAINER, args.restore_role, OBJECT_NAMES_SQL, database="profile").decode().splitlines() if line}
        missing = sorted(source_names - restored_names)
        restored_objects = int(psql(RESTORE_CONTAINER, args.restore_role, OBJECT_COUNT_SQL, database="profile").decode().strip() or 0)
        record: dict[str, Any] = {
            "schemaVersion": 1,
            "kind": "local-pg17-baseline-probe",
            "sourceImage": "local stack (working schema, adapters applied)",
            "targetImage": PG17_IMAGE,
            "restoreRole": args.restore_role,
            "preparedRoleCount": len(role_statements),
            "sourceObjects": source_objects,
            "restoredObjects": restored_objects,
            "dumpBytes": len(dump),
            "restoreExitCode": restore.returncode,
            "preexistingObjectCount": len(preexisting),
            "restoreErrorCount": len(restore_errors),
            "restoreErrors": restore_errors[:50],
            "missingObjectCount": len(missing),
            "missingObjects": missing[:50],
            "restored": source_objects > 0 and not restore_errors and not missing,
        }
    finally:
        run(["docker", "rm", "-f", RESTORE_CONTAINER], check=False)
        dump_path.unlink(missing_ok=True)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: record[key] for key in (
        "sourceObjects", "restoredObjects", "preexistingObjectCount", "restoreErrorCount",
        "missingObjectCount", "restored")}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
