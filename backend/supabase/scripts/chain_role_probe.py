#!/usr/bin/env python3
"""Probe the migration chain and record an ownership profile.

The PostgreSQL 17 transition needs a repeatable way to ask one question: with the
same prerequisites file and the same migration set, does a server reach the same
objects with the same owners? A psql one-liner cannot answer it, because the
result depends on which role applied the prerequisites and which role ran each
migration body.

This is a probe, not the pipeline. It deliberately skips the GoTrue/storage
bundles and the adapter layer, so its output is a comparator for a role or version
change - never evidence that the real local stack agrees. The acceptance signal
for the transition stays the nightly run.

Usage:
    python3 backend/supabase/scripts/chain_role_probe.py \
        --image supabase/postgres:15.8.1.085 \
        --output backend/supabase/baselines/local/pg15-chain-probe.json
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Sequence

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
MIGRATIONS = REPOSITORY_ROOT / "backend/supabase/migrations"
PREREQUISITES = REPOSITORY_ROOT / "backend/supabase/baselines/local/application-prerequisites.sql"
PROBE_NAME = "tzudong-chain-probe"
OWNERSHIP_SQL = """
SELECT coalesce(json_agg(row_to_json(row) ORDER BY row.schema, row.name), '[]'::json)
FROM (
  SELECT n.nspname AS schema, c.relname AS name,
         pg_get_userbyid(c.relowner) AS owner,
         CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned'
                        WHEN 'v' THEN 'view' WHEN 'm' THEN 'matview'
                        WHEN 'S' THEN 'sequence' ELSE c.relkind::text END AS kind
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r','p','v','m','S')
    AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
    AND n.nspname !~ '^pg_temp'
) AS row;
"""


def run(command: Sequence[str], *, check: bool = True, stdin: bytes | None = None) -> subprocess.CompletedProcess[bytes]:
    result = subprocess.run(command, input=stdin, capture_output=True)
    if check and result.returncode != 0:
        raise SystemExit(
            f"probe failed: {' '.join(command)}\n{result.stdout.decode('utf-8', 'replace')}\n{result.stderr.decode('utf-8', 'replace')}"
        )
    return result


def psql(container: str, role: str, sql: bytes | None = None, *, file: str | None = None, check: bool = True, tcp: bool = False) -> subprocess.CompletedProcess[bytes]:
    command = [
        "docker", "exec", "-i", "-e", "PGPASSWORD=probe", container,
        "psql", "-U", role, "-d", "postgres", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1",
    ]
    if tcp:
        command.extend(["-h", "localhost"])
    if file is not None:
        command.extend(["-f", file])
    return run(command, check=check, stdin=sql)


def wait_ready(container: str) -> None:
    for _ in range(120):
        if run(["docker", "exec", container, "pg_isready", "-U", "postgres", "-h", "localhost"], check=False).returncode == 0:
            return
        time.sleep(2)
    raise SystemExit("probe database did not become ready")


def cleanup(container: str) -> None:
    run(["docker", "rm", "-f", container], check=False)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--image", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--prerequisite-role", default="supabase_admin")
    parser.add_argument("--migration-role", default="postgres")
    parser.add_argument("--keep", action="store_true", help="keep the container for inspection")
    parser.add_argument(
        "--mixed-privileged",
        action="store_true",
        help="run migrations that mention SUPERUSER as the privileged role and everything else as the migration role",
    )
    parser.add_argument(
        "--gotrue-migrations",
        default=None,
        help="host directory of rendered GoTrue migrations, applied before the chain",
    )
    parser.add_argument(
        "--gotrue-role",
        default="supabase_auth_admin",
        help="role that applies the GoTrue bootstrap",
    )
    parser.add_argument(
        "--staged-grants",
        action="store_true",
        help="apply --grant-file before each migration whenever the guarded schema exists (stage ordering)",
    )
    parser.add_argument(
        "--grant-file",
        default=None,
        help="SQL file applied as the privileged role after every migration (ownership normalisation)",
    )
    parser.add_argument(
        "--privileged-role",
        default="supabase_admin",
        help="role that replays the statements the prerequisite bundle cannot run as the migration role",
    )
    parser.add_argument(
        "--prerequisite-continue",
        action="store_true",
        help="apply the prerequisite bundle with ON_ERROR_STOP=0 and record the statements that need a privileged role",
    )
    args = parser.parse_args()

    container = PROBE_NAME
    cleanup(container)
    run([
        "docker", "run", "-d", "--name", container,
        "-e", "POSTGRES_PASSWORD=probe", "-e", "POSTGRES_DB=postgres", "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
        args.image,
    ])
    try:
        wait_ready(container)
        run(["docker", "exec", container, "mkdir", "-p", "/probe/migrations"])
        run(["docker", "cp", f"{MIGRATIONS}/.", f"{container}:/probe/migrations"])
        run(["docker", "cp", str(PREREQUISITES), f"{container}:/probe/prerequisites.sql"])

        if args.prerequisite_continue:
            command = [
                "docker", "exec", "-i", "-e", "PGPASSWORD=probe", container,
                "psql", "-U", args.prerequisite_role, "-d", "postgres", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=0",
                "-f", "/probe/prerequisites.sql",
            ]
            prerequisite = run(command, check=False)
        else:
            prerequisite = psql(container, args.prerequisite_role, file="/probe/prerequisites.sql")
        privileged_replay: dict[str, Any] = {"statements": 0, "role": args.privileged_role, "applied": False}
        if args.prerequisite_continue:
            # Statements that need membership in a privileged role cannot run as the
            # migration role. Replay them as that role so the rest of the bundle keeps
            # postgres ownership of everything it creates.
            privileged_lines = [
                index for index, line in enumerate(Path(PREREQUISITES).read_text(encoding="utf-8").splitlines(), start=1)
                if line.lstrip().upper().startswith("ALTER DEFAULT PRIVILEGES")
            ]
            if privileged_lines:
                source = Path(PREREQUISITES).read_text(encoding="utf-8").splitlines()
                statements = []
                for index in privileged_lines:
                    block = [source[index - 1]]
                    cursor = index
                    while not block[-1].rstrip().endswith(";") and cursor < len(source):
                        block.append(source[cursor])
                        cursor += 1
                    statements.append("\n".join(block))
                replay = psql(container, args.privileged_role, ("\n".join(statements) + "\n").encode(), check=False)
                privileged_replay = {
                    "statements": len(statements),
                    "role": args.privileged_role,
                    "applied": replay.returncode == 0,
                }
        prerequisite_ok = prerequisite.returncode == 0
        prerequisite_errors = [
            line.split("ERROR:")[-1].strip()[:160]
            for line in prerequisite.stderr.decode("utf-8", "replace").splitlines()
            if "ERROR:" in line
        ]
        prerequisite_error = prerequisite_errors

        applied: list[str] = []
        failed: list[dict[str, str]] = []
        listing = run(["docker", "exec", container, "sh", "-c", "ls /probe/migrations/*.sql | sort"]).stdout.decode().split()
        grant_sql: bytes | None = None
        if args.grant_file:
            grant_sql = Path(args.grant_file).read_bytes()

        privileged_names: set[str] = set()
        if args.mixed_privileged:
            manifest_path = REPOSITORY_ROOT / "backend/supabase/baselines/local/LOCAL_PRIVILEGED_BODIES.v1.json"
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                for key in ("migrations", "roleScopedMigrations"):
                    entries = manifest.get(key)
                    if isinstance(entries, list):
                        privileged_names.update(item for item in entries if isinstance(item, str))
            except (OSError, ValueError):
                privileged_names = set()

        gotrue: dict[str, Any] = {"applied": 0, "failed": 0}
        if args.gotrue_migrations:
            run(["docker", "exec", container, "mkdir", "-p", "/probe/gotrue"])
            run(["docker", "cp", f"{args.gotrue_migrations}/.", f"{container}:/probe/gotrue"])
            gotrue_listing = run(["docker", "exec", container, "sh", "-c", "ls /probe/gotrue/*.sql | sort"]).stdout.decode().split()
            for path in gotrue_listing:
                result = psql(container, args.gotrue_role, file=path, check=False, tcp=True)
                if result.returncode == 0:
                    gotrue["applied"] += 1
                else:
                    gotrue["failed"] += 1

        schema_present = (
            "SELECT to_regclass('privacy_retention.g014_catalog_contract_manifest') IS NOT NULL"
            " OR to_regnamespace('privacy_retention') IS NOT NULL;"
        )
        for path in listing:
            # A failed migration is data, not a probe failure: it is what the
            # profile is meant to show.
            role = args.migration_role
            if args.mixed_privileged:
                # The manifest is the single source of truth for which bodies the
                # migration role cannot run (SUPERUSER statements and SET ROLE to a
                # principal it is not a member of).
                if Path(path).name in privileged_names:
                    role = args.privileged_role
            if grant_sql is not None:
                if args.staged_grants:
                    # Stage ordering: normalise ownership whenever the guarded schema
                    # exists, before the body that needs it runs.
                    exists = psql(container, args.migration_role, schema_present.encode(), check=False, tcp=True)
                    if b"t" in exists.stdout:
                        psql(container, args.privileged_role, grant_sql, check=False)
                elif role != args.migration_role:
                    psql(container, args.privileged_role, grant_sql, check=False)
            result = psql(container, role, file=path, check=False)
            name = Path(path).name
            if result.returncode == 0:
                applied.append(name)
            else:
                message = next((line for line in result.stderr.decode("utf-8", "replace").splitlines() if "ERROR:" in line), "")
                failed.append({"migration": name, "error": message.split("ERROR:")[-1].strip()[:160]})

        ownership = json.loads(psql(container, args.migration_role, OWNERSHIP_SQL.encode()).stdout.decode() or "[]")

        record: dict[str, Any] = {
            "schemaVersion": 1,
            "kind": "local-chain-role-probe",
            "image": args.image,
            "prerequisiteRole": args.prerequisite_role,
            "migrationRole": args.migration_role,
            "prerequisiteApplied": prerequisite_ok,
            "prerequisiteContinue": bool(args.prerequisite_continue),
            "privilegedReplay": privileged_replay,
            "mixedPrivileged": bool(args.mixed_privileged),
            "stagedGrants": bool(args.staged_grants),
            "gotrue": gotrue,
            "grantFile": args.grant_file,
            "prerequisiteErrors": prerequisite_error,
            "migrationCount": len(listing),
            "appliedCount": len(applied),
            "failedCount": len(failed),
            "failed": failed,
            "ownership": ownership,
        }
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(record, indent=2, sort_keys=False) + "\n", encoding="utf-8")
        print(json.dumps({key: record[key] for key in ("image", "prerequisiteApplied", "migrationCount", "appliedCount", "failedCount")}))
        return 0
    finally:
        if not args.keep:
            cleanup(container)


if __name__ == "__main__":
    sys.exit(main())
