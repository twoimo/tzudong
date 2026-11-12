#!/usr/bin/env python3
"""Capture and provision a local database baseline.

The historical migration chain replays at 91 of 161 migrations on PostgreSQL 17, and
the adapter layer only makes it work on 15. Rewriting that layer collides with
applied-migration immutability, so the stack moves by provisioning instead of
replaying:

    capture   - from a verified stack, write schema.sql + manifest.json
    provision - into a fresh cluster, create the roles the schema names, reset the
                schemas the image seeds, restore, and prove every object landed

Both halves are deliberately explicit about what they checked. A provision run that
cannot prove object parity fails instead of reporting success, because the failure
this replaces was a restore that reported "done" while creating nothing.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Sequence

SCHEMA_VERSION = 1
MANIFEST_KIND = "local-baseline-manifest"
# Objects that PostgreSQL 17 will refuse to restore as a non-superuser, and schemas
# the supabase image seeds that this project recreates. Both measured 2026-11-11.
RESTORE_ROLE = "supabase_admin"
SEEDED_SCHEMAS = (
    "auth", "storage", "vault", "extensions", "graphql", "graphql_public",
    "pgbouncer", "realtime", "cron", "net", "pgsodium", "pgtle",
)
EXCLUDED_ROLES = (
    "postgres", "supabase_admin", "supabase_auth_admin", "supabase_storage_admin",
    "authenticator", "dashboard_user", "anon", "authenticated", "service_role",
)

OBJECT_NAMES_SQL = """
SELECT n.nspname || '.' || c.relname FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r','p','v','m','S')
  AND n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
ORDER BY 1;
"""

# A schema-only dump carries no CREATE ROLE, so every statement naming a project role
# fails on a fresh cluster. Policies and default ACLs name roles that own nothing, so
# ownership alone is not enough.
ROLE_STATEMENTS_SQL = f"""
WITH referenced AS (
  SELECT unnest(polroles) AS oid FROM pg_catalog.pg_policy WHERE polroles <> '{{0}}'
  UNION
  SELECT defaclrole FROM pg_catalog.pg_default_acl
  UNION
  SELECT relowner FROM pg_catalog.pg_class
  UNION
  SELECT proowner FROM pg_catalog.pg_proc
)
SELECT format('CREATE ROLE %I NOLOGIN', r.rolname) FROM pg_catalog.pg_roles r
WHERE r.rolname NOT LIKE 'pg\\_%'
  AND r.rolname NOT IN ({",".join(repr(name) for name in EXCLUDED_ROLES)})
  AND (r.oid IN (SELECT oid FROM referenced) OR r.rolname LIKE 'privacy\\_%')
ORDER BY 1;
"""

Runner = Callable[..., subprocess.CompletedProcess]


def _run(command: Sequence[str], *, check: bool = True, capture: bool = True,
         runner: Runner = subprocess.run) -> subprocess.CompletedProcess:
    result = runner(list(command), capture_output=capture)
    if check and result.returncode != 0:
        stderr = (result.stderr or b"").decode("utf-8", "replace").strip().splitlines()
        detail = stderr[-1] if stderr else f"exit {result.returncode}"
        raise SystemExit(f"step failed: {' '.join(command)}: {detail}")
    return result


def psql(container: str, role: str, sql: str, *, database: str = "postgres",
         runner: Runner = subprocess.run) -> str:
    return _run(
        ["docker", "exec", "-i", container, "psql", "-U", role, "-d", database,
         "-q", "-t", "-A", "--set", "ON_ERROR_STOP=1", "-c", sql],
        runner=runner,
    ).stdout.decode("utf-8", "replace")


def object_names(container: str, role: str, database: str,
                 runner: Runner = subprocess.run) -> list[str]:
    return [line for line in psql(container, role, OBJECT_NAMES_SQL, database=database,
                                  runner=runner).splitlines() if line]


def role_statements(container: str, database: str,
                    runner: Runner = subprocess.run) -> list[str]:
    statements = [line for line in psql(container, "postgres", ROLE_STATEMENTS_SQL,
                                        database=database, runner=runner).splitlines() if line]
    # psql needs one terminated statement per line: joined without ';' the file parses
    # as a single broken statement and only the first line runs.
    return [f"{statement.rstrip(';')};" for statement in statements]


def schema_dump(container: str, database: str, runner: Runner = subprocess.run) -> bytes:
    return _run(
        ["docker", "exec", container, "pg_dump", "-U", "postgres", "-d", database,
         "--schema-only", "--no-owner", "--no-privileges", "--clean", "--if-exists"],
        runner=runner,
    ).stdout


def split_errors(stderr: bytes) -> list[str]:
    return [
        line.split("ERROR:")[-1].strip()[:200]
        for line in stderr.decode("utf-8", "replace").splitlines()
        if "ERROR:" in line
    ]


@dataclass(frozen=True)
class Baseline:
    directory: Path
    manifest: dict[str, Any]

    @property
    def schema_path(self) -> Path:
        return self.directory / "schema.sql"


def _digest(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def capture(container: str, database: str, output: Path, *,
            source_image: str, runner: Runner = subprocess.run) -> Baseline:
    names = object_names(container, "postgres", database, runner=runner)
    if not names:
        raise SystemExit("no objects found: refusing to capture an empty baseline")
    dump = schema_dump(container, database, runner=runner)
    roles = role_statements(container, database, runner=runner)
    output.mkdir(parents=True, exist_ok=True)
    schema_path = output / "schema.sql"
    schema_path.write_bytes(dump)
    (output / "objects.txt").write_text("\n".join(names) + "\n", encoding="utf-8")
    # The target cluster has no roles at all, so the baseline carries them rather than
    # reading them from whatever container the restore runs against.
    (output / "roles.sql").write_text("\n".join(roles) + "\n" if roles else "", encoding="utf-8")
    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": MANIFEST_KIND,
        "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sourceImage": source_image,
        "database": database,
        "objectCount": len(names),
        "objectNamesSha256": _digest(("\n".join(names) + "\n").encode()),
        "roleStatementCount": len(roles),
        "rolesSha256": _digest((("\n".join(roles) + "\n") if roles else "").encode()),
        "schemaSha256": _digest(dump),
        "schemaBytes": len(dump),
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return Baseline(output, manifest)


def load_baseline(directory: Path) -> Baseline:
    manifest_path = directory / "manifest.json"
    schema_path = directory / "schema.sql"
    if not manifest_path.is_file() or not schema_path.is_file():
        raise SystemExit(f"baseline incomplete: {directory} needs manifest.json and schema.sql")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("kind") != MANIFEST_KIND:
        raise SystemExit(f"not a baseline manifest: {manifest.get('kind')!r}")
    if manifest.get("schemaVersion") != SCHEMA_VERSION:
        raise SystemExit(f"unsupported baseline schemaVersion: {manifest.get('schemaVersion')!r}")
    if _digest(schema_path.read_bytes()) != manifest.get("schemaSha256"):
        raise SystemExit("baseline schema.sql does not match its manifest digest")
    objects_path = directory / "objects.txt"
    roles_path = directory / "roles.sql"
    for path, digest_key in ((objects_path, "objectNamesSha256"), (roles_path, "rolesSha256")):
        if not path.is_file():
            raise SystemExit(f"baseline incomplete: {directory} needs {path.name}")
        if _digest(path.read_bytes()) != manifest.get(digest_key):
            raise SystemExit(f"baseline {path.name} does not match its manifest digest")
    return Baseline(directory, manifest)


# The object set is the stable signal: it changes when a migration adds, drops or
# renames a table, view, matview or sequence. The raw dump hash is recorded for
# information but is not a gate, because pg_dump output can differ without the schema
# differing.
DRIFT_KEYS = ("objectCount", "objectNamesSha256", "roleStatementCount")


def drift(committed: Baseline, live_manifest: dict[str, Any]) -> list[str]:
    differences = [
        f"{key}: committed {committed.manifest.get(key)!r} vs live {live_manifest.get(key)!r}"
        for key in DRIFT_KEYS
        if committed.manifest.get(key) != live_manifest.get(key)
    ]
    return differences


def provision(baseline: Baseline, container: str, database: str, *,
              role: str = RESTORE_ROLE, runner: Runner = subprocess.run) -> dict[str, Any]:
    schema_bytes = baseline.schema_path.read_bytes()
    roles_sql = (baseline.directory / "roles.sql").read_text(encoding="utf-8")
    role_lines = [line for line in roles_sql.splitlines() if line.strip()]
    setup = role_lines + [
        f"DROP SCHEMA IF EXISTS {schema} CASCADE;" for schema in SEEDED_SCHEMAS
    ]
    # Scratch, not baseline content: a committed baseline directory must contain only
    # the four captured files.
    scratch = tempfile.TemporaryDirectory()
    setup_path = Path(scratch.name) / "provision-setup.sql"
    setup_path.write_text("\n".join(setup) + "\n", encoding="utf-8")
    _run(["docker", "cp", str(setup_path), f"{container}:/tmp/baseline-setup.sql"], runner=runner)
    setup_result = _run(
        ["docker", "exec", "-i", container, "psql", "-U", role, "-d", database,
         "-q", "-v", "ON_ERROR_STOP=0", "-f", "/tmp/baseline-setup.sql"],
        check=False, runner=runner,
    )
    _run(["docker", "cp", str(baseline.schema_path), f"{container}:/tmp/baseline-schema.sql"], runner=runner)
    restore = _run(
        ["docker", "exec", "-i", container, "psql", "-U", role, "-d", database,
         "-q", "-v", "ON_ERROR_STOP=0", "-f", "/tmp/baseline-schema.sql"],
        check=False, runner=runner,
    )
    setup_errors = split_errors(setup_result.stderr or b"")
    restore_errors = split_errors(restore.stderr or b"")
    restored_names = object_names(container, role, database, runner=runner)
    expected_names = _names_from_manifest(baseline)
    missing = sorted(set(expected_names) - set(restored_names))
    record = {
        "schemaVersion": SCHEMA_VERSION,
        "kind": "local-baseline-provision",
        "baselineCapturedAt": baseline.manifest.get("capturedAt"),
        "baselineSourceImage": baseline.manifest.get("sourceImage"),
        "baselineObjectCount": baseline.manifest.get("objectCount"),
        "restoreRole": role,
        "preparedRoleCount": len(role_lines),
        "setupExitCode": setup_result.returncode,
        "setupErrorCount": len(setup_errors),
        "setupErrors": setup_errors[:10],
        "restoreExitCode": restore.returncode,
        "restoreErrorCount": len(restore_errors),
        "restoreErrors": restore_errors[:20],
        "restoredObjectCount": len(restored_names),
        "missingObjectCount": len(missing),
        "missingObjects": missing[:20],
        "provisioned": (
            setup_result.returncode == 0
            and restore.returncode == 0
            and not setup_errors
            and not restore_errors
            and not missing
            and len(restored_names) == baseline.manifest.get("objectCount")
            and len(expected_names) == baseline.manifest.get("objectCount")
        ),
        "schemaSha256": baseline.manifest.get("schemaSha256"),
        "verifiedSchemaBytes": len(schema_bytes),
    }
    return record


def _names_from_manifest(baseline: Baseline) -> list[str]:
    """Object names are captured with the baseline; the manifest stores their digest."""
    names_path = baseline.directory / "objects.txt"
    return [line for line in names_path.read_text(encoding="utf-8").splitlines() if line]


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    cap = sub.add_parser("capture", help="capture a baseline from a verified stack")
    cap.add_argument("--container", required=True)
    cap.add_argument("--database", default="postgres")
    cap.add_argument("--output", required=True, type=Path)
    cap.add_argument("--source-image", required=True)

    prov = sub.add_parser("provision", help="provision a fresh cluster from a baseline")
    prov.add_argument("--container", required=True)
    prov.add_argument("--database", default="postgres")
    prov.add_argument("--baseline", required=True, type=Path)
    prov.add_argument("--role", default=RESTORE_ROLE)
    prov.add_argument("--receipt", type=Path)

    sub.add_parser("verify", help="validate a baseline directory").add_argument(
        "--baseline", required=True, type=Path)

    cmp_parser = sub.add_parser("compare", help="report drift between a committed baseline and a live capture record")
    cmp_parser.add_argument("--baseline", required=True, type=Path)
    cmp_parser.add_argument("--record", required=True, type=Path,
                            help="probe record JSON containing baselineManifest")

    args = parser.parse_args(argv)
    if args.command == "capture":
        baseline = capture(args.container, args.database, args.output,
                           source_image=args.source_image)
        print(json.dumps(baseline.manifest, indent=2))
        return 0
    if args.command == "provision":
        baseline = load_baseline(args.baseline)
        record = provision(baseline, args.container, args.database, role=args.role)
        if args.receipt:
            args.receipt.parent.mkdir(parents=True, exist_ok=True)
            args.receipt.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({key: record[key] for key in (
            "baselineObjectCount", "restoredObjectCount", "missingObjectCount",
            "setupErrorCount", "restoreErrorCount", "provisioned")}))
        return 0 if record["provisioned"] else 1
    if args.command == "compare":
        committed = load_baseline(args.baseline)
        record = json.loads(args.record.read_text(encoding="utf-8"))
        live = record.get("baselineManifest") or {}
        differences = drift(committed, live)
        if differences:
            print(json.dumps({"drift": differences}, indent=2))
            print("regenerate the committed baseline: "
                  f"local_baseline.py capture --container <db> --output {args.baseline}", file=sys.stderr)
            return 1
        print(json.dumps({"drift": [], "objectCount": committed.manifest.get("objectCount")}))
        return 0
    baseline = load_baseline(args.baseline)
    print(json.dumps(baseline.manifest, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
