#!/usr/bin/env python3
"""Read a hosted Supabase migration ledger without exposing database details."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlsplit

SCHEMA_VERSION = 1
RELATION = "supabase_migrations.schema_migrations"
MAX_ROWS = 1000
TIMEOUT_MS = 10_000
VERSION_PATTERN = re.compile(r"^[0-9]{1,64}$")
NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$")


def _is_postgresql_uri(value: str) -> bool:
    parsed = urlsplit(value)
    return parsed.scheme in {"postgres", "postgresql"} and bool(parsed.hostname)


# These are the only supported Supabase ledger layouts. The probe deliberately
# targets the ledger relation directly and never inspects PostgreSQL catalogs.
LEDGER_QUERIES = (
    ("version_name", "SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version ASC, name ASC LIMIT 1001"),
    ("version_migration_name", "SELECT version, migration_name FROM supabase_migrations.schema_migrations ORDER BY version ASC, migration_name ASC LIMIT 1001"),
)


class Cursor(Protocol):
    def execute(self, query: str) -> Any: ...

    def fetchall(self) -> list[tuple[Any, Any]]: ...

    def close(self) -> None: ...


class Connection(Protocol):
    def cursor(self) -> Cursor: ...

    def close(self) -> None: ...


def _canonical_bytes(rows: list[dict[str, str]]) -> bytes:
    return json.dumps(rows, ensure_ascii=True, separators=(",", ":"), sort_keys=True).encode("utf-8")


def _validate_rows(raw_rows: list[tuple[Any, Any]]) -> list[dict[str, str]]:
    if not raw_rows:
        raise ValueError("migration ledger is empty")
    if len(raw_rows) > MAX_ROWS:
        raise ValueError("migration ledger exceeds maximum row count")

    rows: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for raw in raw_rows:
        if not isinstance(raw, (tuple, list)) or len(raw) != 2:
            raise ValueError("migration ledger row has an unknown shape")
        version, name = raw
        if not isinstance(version, str) or not VERSION_PATTERN.fullmatch(version):
            raise ValueError("migration ledger contains an invalid version identifier")
        if not isinstance(name, str) or not NAME_PATTERN.fullmatch(name):
            raise ValueError("migration ledger contains an invalid name identifier")
        identifier = (version, name)
        if identifier in seen:
            raise ValueError("migration ledger contains duplicate identifiers")
        seen.add(identifier)
        rows.append({"version": version, "name": name})
    return rows


def build_artifact(rows: list[dict[str, str]]) -> dict[str, Any]:
    canonical_rows = _canonical_bytes(rows)
    return {
        "schemaVersion": SCHEMA_VERSION,
        "relation": RELATION,
        "migrations": rows,
        "rowCount": len(rows),
        "sha256": hashlib.sha256(canonical_rows).hexdigest(),
    }


def read_ledger(connection: Connection) -> dict[str, Any]:
    cursor = connection.cursor()
    try:
        # The connection is additionally opened with default_transaction_read_only.
        cursor.execute("BEGIN READ ONLY")
        cursor.execute(f"SET LOCAL statement_timeout = '{TIMEOUT_MS}ms'")
        cursor.execute(f"SET LOCAL lock_timeout = '{TIMEOUT_MS}ms'")
        cursor.execute(f"SET LOCAL idle_in_transaction_session_timeout = '{TIMEOUT_MS}ms'")

        last_error: Exception | None = None
        for variant, query in LEDGER_QUERIES:
            savepoint = f"ledger_variant_{variant}"
            cursor.execute(f"SAVEPOINT {savepoint}")
            try:
                cursor.execute(query)
                artifact = build_artifact(_validate_rows(cursor.fetchall()))
            except Exception as error:
                # Roll back a failed column probe before attempting the next known
                # variant; PostgreSQL otherwise marks the transaction aborted.
                cursor.execute(f"ROLLBACK TO SAVEPOINT {savepoint}")
                last_error = error
            else:
                cursor.execute(f"RELEASE SAVEPOINT {savepoint}")
                return artifact
        raise ValueError("migration ledger does not match a supported schema") from last_error
    finally:
        cursor.close()


def validate_artifact(artifact: Any) -> None:
    if not isinstance(artifact, dict) or set(artifact) != {
        "schemaVersion", "relation", "migrations", "rowCount", "sha256"
    }:
        raise ValueError("artifact has an unknown shape")
    if artifact["schemaVersion"] != SCHEMA_VERSION or artifact["relation"] != RELATION:
        raise ValueError("artifact has an unsupported schema or relation")
    if not isinstance(artifact["migrations"], list) or artifact["rowCount"] != len(artifact["migrations"]):
        raise ValueError("artifact row count is invalid")
    raw_rows = [(row.get("version"), row.get("name")) if isinstance(row, dict) else () for row in artifact["migrations"]]
    rows = _validate_rows(raw_rows)
    expected_hash = hashlib.sha256(_canonical_bytes(rows)).hexdigest()
    if not isinstance(artifact["sha256"], str) or artifact["sha256"] != expected_hash:
        raise ValueError("artifact hash is invalid")


def write_artifact(path: Path, artifact: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        json.dump(artifact, handle, ensure_ascii=True, separators=(",", ":"), sort_keys=True)
        handle.write("\n")
        temporary_path = Path(handle.name)
    temporary_path.replace(path)


def connect_from_environment() -> Connection:
    dsn = os.environ.get("SUPABASE_DB_URL")
    if not dsn or not _is_postgresql_uri(dsn):
        raise ValueError("SUPABASE_DB_URL must be a PostgreSQL URI")
    try:
        import psycopg
    except ImportError as error:
        raise RuntimeError("the pinned psycopg driver is required") from error
    return psycopg.connect(dsn, autocommit=False, options="-c default_transaction_read_only=on")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Read hosted Supabase migration-ledger metadata.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--output", type=Path, help="sanitized JSON artifact destination")
    group.add_argument("--validate-artifact", type=Path, help="validate an existing sanitized artifact")
    args = parser.parse_args(argv)

    try:
        if args.validate_artifact:
            with args.validate_artifact.open(encoding="utf-8") as handle:
                validate_artifact(json.load(handle))
        else:
            connection = connect_from_environment()
            try:
                write_artifact(args.output, read_ledger(connection))
            finally:
                connection.close()
    except Exception:
        # Do not render driver exceptions: they can include connection strings.
        print("hosted migration ledger audit failed", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
