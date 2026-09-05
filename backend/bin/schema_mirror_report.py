#!/usr/bin/env python3
"""Schema_Mirror_Report for the platform-modernization spec (Requirement 9).

This is the schema-mirroring surface described in design section C5 ("스키마
미러링과 Local_Only_Schema"). After the ``backend/supabase/migrations/`` set is
applied to the Local_Database, this report is generated in the SAME run and
compares the Local_Database schema against the Hosted_Database schema. Hosted
access is a SCHEMA-READ-ONLY query only; this module never writes to the
Hosted_Database.

It enumerates the five difference classes design C5 requires, recording every
class — including classes with zero items (Requirement 9.3):

  1. tables present only in Local          (``localOnlyTables``)
  2. tables present only in Hosted         (``hostedOnlyTables``)
  3. tables in both with differing columns (``columnSetDifferences``)
  4. tables in both with differing constraints (``constraintDifferences``)
  5. RPC name differences                  (``rpcNameDifferences``)

Each reported item carries a schema name, an object name, and a difference
classification.

Mirroring verdict (Requirement 9.4, 9.5):

  * A defect (``schema_mirror_defect``) is raised when any Hosted-only item
    exists (a Hosted-only table, a Hosted-only column, a Hosted-only
    constraint, or a Hosted-only RPC) OR when a Local-only table is NOT
    enumerated in the Local_Only_Schema.
  * A Local-only table that IS enumerated in the Local_Only_Schema
    (``local_analytics``) is marked as an approved local-only item with its
    operator-approval reference and is NOT treated as a defect.

Availability (Requirement 9.9, 9.10):

  * The report is generated in the same run that finishes applying migrations,
    and the Hosted comparison uses schema-read-only queries.
  * If the Hosted schema read fails or does not complete, the report is marked
    incomplete, the fixed code ``hosted_schema_read_unavailable`` is returned,
    and the mirroring verdict is NOT recorded as passing.

Publication isolation (Requirement 9.6): the count of Local_Only_Schema ×
Publication_Set intersection checks is recorded in the report, and the
intersection must be empty.

``backend/bin`` scripts are standalone (no ``__init__.py``); this module is
loaded by path by its callers/tests. The Hosted/Local schema readers are
injectable so the pure report logic is unit-testable without a live database
and without network I/O. The report contains only bounded schema identifiers
(schema names, object names, column/constraint names); it never records
provider diagnostics, database error strings, free-form error text, or any
Forbidden_Log_Field.
"""

from __future__ import annotations

import json
import hashlib
from pathlib import Path
from typing import Callable, Mapping, NamedTuple, Sequence

# ---------------------------------------------------------------------------
# Fixed codes (design C5; error-code catalog rows 9.4 / 9.10).
# ---------------------------------------------------------------------------

# Hosted-only items exist, or a Local-only table is not enumerated in the
# Local_Only_Schema (Requirement 9.4).
SCHEMA_MIRROR_DEFECT = "schema_mirror_defect"

# The Hosted schema read failed or did not complete (Requirement 9.10).
HOSTED_SCHEMA_READ_UNAVAILABLE = "hosted_schema_read_unavailable"

# Report artifact version stamp.
SCHEMA_MIRROR_REPORT_SCHEMA_VERSION = 1

# ---------------------------------------------------------------------------
# Local_Only_Schema (design C5). The single schema that is intentionally
# local-only and must have a zero-size intersection with the Publication_Set
# (Requirement 9.6). Its base tables are defined by the immutable
# ``20260901000100_local_analytics_schema.sql`` migration; a Local-only table
# enumerated here is an APPROVED local-only item, not a mirroring defect
# (Requirement 9.5).
# ---------------------------------------------------------------------------

LOCAL_ONLY_SCHEMA_NAME = "local_analytics"

# The migration file that creates the Local_Only_Schema is the operator-approval
# reference recorded against each approved local-only table. It is the immutable
# source of record for the schema (Requirement 9.5); it carries no approver name
# by itself, which is honest about the unresolved approval ledger state.
LOCAL_ONLY_APPROVAL_REFERENCE = (
    "backend/supabase/migrations/20260901000100_local_analytics_schema.sql"
)

LOCAL_ONLY_TABLE_NAMES: tuple[str, ...] = (
    "staging_restaurants",
    "staging_videos",
    "crawl_evidence",
    "parity_results",
    "benchmark_runs",
    "publish_jobs",
    "publish_history",
    "publish_audit_events",
    "phase_reports",
    "agent_action_records",
    "agent_action_results",
    "agent_action_budget_claims",
)

LOCAL_ONLY_APPROVAL_REFERENCES = {
    'local_analytics.agent_action_budget_claims':
        'backend/supabase/migrations/20260905000200_local_agent_rate_budget.sql',
    'local_analytics.agent_action_results':
        'backend/supabase/migrations/20260905000100_local_agent_terminal_results.sql',
}

# Fully-qualified ``schema.table`` identifiers for the Local_Only_Schema tables.
LOCAL_ONLY_QUALIFIED_TABLES: frozenset[str] = frozenset(
    f"{LOCAL_ONLY_SCHEMA_NAME}.{name}" for name in LOCAL_ONLY_TABLE_NAMES
)

# Default location of the Publication_Set ledger (design D5, created by Task 11).
# It may not exist yet; the loader treats an absent ledger as an empty set so
# the isolation check still records a bounded count.
PUBLICATION_SET_LEDGER_PATH = "backend/deploy/publication-set.v1.json"

# ---------------------------------------------------------------------------
# Difference classifications (the ``differenceClass`` field on each item).
# ---------------------------------------------------------------------------

DIFF_TABLE_ONLY_IN_LOCAL = "table_only_in_local"
DIFF_TABLE_ONLY_IN_HOSTED = "table_only_in_hosted"
DIFF_COLUMN_SET_DIFFERS = "column_set_differs"
DIFF_CONSTRAINT_SET_DIFFERS = "constraint_set_differs"
DIFF_RPC_ONLY_IN_LOCAL = "rpc_only_in_local"
DIFF_RPC_ONLY_IN_HOSTED = "rpc_only_in_hosted"

# The five difference-class category keys, in design C5 order. Every report
# includes all five, even when a category has zero items (Requirement 9.3).
CATEGORY_KEYS: tuple[str, ...] = (
    "localOnlyTables",
    "hostedOnlyTables",
    "columnSetDifferences",
    "constraintDifferences",
    "rpcNameDifferences",
)


# ---------------------------------------------------------------------------
# Schema snapshot model. A snapshot is what a schema-read-only query returns;
# it holds only bounded identifiers (never row values or diagnostics).
# ---------------------------------------------------------------------------


class TableShape(NamedTuple):
    """Identifiers and catalog-definition hashes; never stored row values."""

    columns: frozenset[str]
    constraints: frozenset[str]
    constraint_signatures: Mapping[str, str] | None = None
    not_null_columns: frozenset[str] = frozenset()


class SchemaSnapshot(NamedTuple):
    """A schema snapshot: qualified tables and qualified RPC names.

    Attributes:
        tables: Mapping of ``"schema.table"`` -> ``TableShape``.
        rpcs: Set of ``"schema.rpc_name"`` identifiers.
    """

    tables: Mapping[str, TableShape]
    rpcs: frozenset[str]


# A reader is a zero-argument callable returning a ``SchemaSnapshot``. The
# Hosted reader may raise; a raised Hosted reader means the schema read is
# unavailable (Requirement 9.10).
SchemaReader = Callable[[], SchemaSnapshot]


# ---------------------------------------------------------------------------
# Helpers.
# ---------------------------------------------------------------------------


def _split_qualified(qualified: str) -> tuple[str, str]:
    """Split ``"schema.object"`` into ``(schema, object)``.

    An identifier without a dot is treated as living in the ``public`` schema,
    matching the platform default.
    """

    if "." in qualified:
        schema, _, obj = qualified.partition(".")
        return schema, obj
    return "public", qualified


def normalize_local_only(
    local_only_tables: Sequence[str] | None,
) -> frozenset[str]:
    """Return the Local_Only_Schema qualified table set.

    ``None`` selects the built-in ``local_analytics`` enumeration. A supplied
    sequence (used by tests / property checks) is normalized to a frozenset.
    """

    if local_only_tables is None:
        return LOCAL_ONLY_QUALIFIED_TABLES
    return frozenset(local_only_tables)


def load_publication_set_tables(
    *,
    repo_root: Path | None = None,
    ledger_path: str = PUBLICATION_SET_LEDGER_PATH,
) -> frozenset[str]:
    """Load the Publication_Set qualified table names from the ledger.

    Returns an empty set when the ledger does not exist yet (the Publication_Set
    ledger is authored in a later phase). Table names are normalized to
    ``schema.table``; a bare table name is assumed to be in ``public``.
    """

    root = repo_root or _repo_root()
    path = root / ledger_path
    if not path.exists():
        return frozenset()
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        # A malformed/unreadable ledger must not leak parser diagnostics; treat
        # it as no admitted publication targets for the isolation count.
        return frozenset()

    names: set[str] = set()
    for entry in document.get("tables", []) or []:
        if not isinstance(entry, dict):
            continue
        table = entry.get("table") or entry.get("name")
        if not isinstance(table, str) or not table:
            continue
        schema, obj = _split_qualified(table)
        names.add(f"{schema}.{obj}")
    return frozenset(names)


# ---------------------------------------------------------------------------
# Category builders (each returns a list of bounded item dicts).
# ---------------------------------------------------------------------------


def _table_item(qualified: str, difference_class: str) -> dict:
    schema, obj = _split_qualified(qualified)
    return {
        "schemaName": schema,
        "objectName": obj,
        "differenceClass": difference_class,
    }


def _build_local_only_tables(
    *,
    local_tables: frozenset[str],
    hosted_tables: frozenset[str],
    local_only_enumeration: frozenset[str],
) -> list[dict]:
    """Category 1: tables present only in Local.

    Each item is flagged ``approvedLocalOnly`` when the table is enumerated in
    the Local_Only_Schema, and carries the operator-approval reference in that
    case (Requirement 9.5). An unapproved local-only table is a defect
    (Requirement 9.4).
    """

    items: list[dict] = []
    for qualified in sorted(local_tables - hosted_tables):
        item = _table_item(qualified, DIFF_TABLE_ONLY_IN_LOCAL)
        approved = qualified in local_only_enumeration
        item["approvedLocalOnly"] = approved
        item["operatorApprovalReference"] = (
            LOCAL_ONLY_APPROVAL_REFERENCES.get(qualified, LOCAL_ONLY_APPROVAL_REFERENCE) if approved else None
        )
        items.append(item)
    return items


def _build_hosted_only_tables(
    *,
    local_tables: frozenset[str],
    hosted_tables: frozenset[str],
) -> list[dict]:
    """Category 2: tables present only in Hosted (always a Hosted-only item)."""

    return [
        _table_item(qualified, DIFF_TABLE_ONLY_IN_HOSTED)
        for qualified in sorted(hosted_tables - local_tables)
    ]


def _build_column_set_differences(
    *,
    local: SchemaSnapshot,
    hosted: SchemaSnapshot,
    shared_tables: list[str],
) -> list[dict]:
    """Category 3: tables in both whose column sets differ.

    The item records the local-only and hosted-only column names so the defect
    determination can detect a Hosted-only column without exploding the
    one-item-per-table shape.
    """

    items: list[dict] = []
    for qualified in shared_tables:
        local_cols = local.tables[qualified].columns
        hosted_cols = hosted.tables[qualified].columns
        if local_cols == hosted_cols:
            continue
        schema, obj = _split_qualified(qualified)
        items.append(
            {
                "schemaName": schema,
                "objectName": obj,
                "differenceClass": DIFF_COLUMN_SET_DIFFERS,
                "localOnlyColumns": sorted(local_cols - hosted_cols),
                "hostedOnlyColumns": sorted(hosted_cols - local_cols),
            }
        )
    return items


def _build_constraint_differences(
    *,
    local: SchemaSnapshot,
    hosted: SchemaSnapshot,
    shared_tables: list[str],
) -> list[dict]:
    """Category 4: tables in both whose constraint sets differ."""

    items: list[dict] = []
    for qualified in shared_tables:
        local_cons = local.tables[qualified].constraints
        hosted_cons = hosted.tables[qualified].constraints
        local_signatures = local.tables[qualified].constraint_signatures or {}
        hosted_signatures = hosted.tables[qualified].constraint_signatures or {}
        changed = {name for name in local_cons & hosted_cons
                   if local_signatures.get(name) != hosted_signatures.get(name)}
        nullability_changed = (local.tables[qualified].not_null_columns
                               ^ hosted.tables[qualified].not_null_columns)
        if local_cons == hosted_cons and not changed and not nullability_changed:
            continue
        schema, obj = _split_qualified(qualified)
        items.append(
            {
                "schemaName": schema,
                "objectName": obj,
                "differenceClass": DIFF_CONSTRAINT_SET_DIFFERS,
                "localOnlyConstraints": sorted(local_cons - hosted_cons),
                "hostedOnlyConstraints": sorted(hosted_cons - local_cons),
                "definitionDifferences": sorted(changed),
                "nullabilityDifferences": sorted(nullability_changed),
            }
        )
    return items


def _build_rpc_differences(
    *,
    local: SchemaSnapshot,
    hosted: SchemaSnapshot,
) -> list[dict]:
    """Category 5: RPC name differences (present in exactly one side)."""

    items: list[dict] = []
    for qualified in sorted(local.rpcs - hosted.rpcs):
        items.append(_table_item(qualified, DIFF_RPC_ONLY_IN_LOCAL))
    for qualified in sorted(hosted.rpcs - local.rpcs):
        items.append(_table_item(qualified, DIFF_RPC_ONLY_IN_HOSTED))
    return items


# ---------------------------------------------------------------------------
# Publication isolation (Requirement 9.6).
# ---------------------------------------------------------------------------


def _build_publication_isolation(
    *,
    local_only_enumeration: frozenset[str],
    publication_set_tables: frozenset[str],
) -> dict:
    """Compute the Local_Only_Schema × Publication_Set isolation summary.

    ``intersectionCheckCount`` is the number of membership checks performed —
    one per Local_Only_Schema table evaluated against the Publication_Set — and
    is recorded regardless of the outcome (Requirement 9.6). ``isolated`` is
    True only when the intersection is empty.
    """

    intersection = sorted(local_only_enumeration & publication_set_tables)
    return {
        "localOnlyTableCount": len(local_only_enumeration),
        "publicationSetTableCount": len(publication_set_tables),
        "intersectionCheckCount": len(local_only_enumeration),
        "intersectionTables": intersection,
        "intersectionSize": len(intersection),
        "isolated": not intersection,
    }


# ---------------------------------------------------------------------------
# Pure report builder (design C5; Requirements 9.3, 9.4, 9.5, 9.6).
# ---------------------------------------------------------------------------


def build_schema_mirror_report(
    *,
    local: SchemaSnapshot,
    hosted: SchemaSnapshot | None,
    local_only_tables: Sequence[str] | None = None,
    publication_set_tables: Sequence[str] | None = None,
    hosted_read_ok: bool = True,
) -> dict:
    """Build the Schema_Mirror_Report from Local and Hosted schema snapshots.

    When ``hosted`` is ``None`` or ``hosted_read_ok`` is False, the Hosted
    schema read is treated as unavailable: the report is marked incomplete, the
    fixed code ``hosted_schema_read_unavailable`` is returned, and the verdict
    is NOT recorded as passing (Requirement 9.10). The publication-isolation
    summary is still computed because it does not depend on the Hosted read.

    Otherwise all five difference classes are enumerated (each present even at
    zero count), Hosted-only items and unenumerated Local-only tables are
    classified as defects, and ``mirrorPass`` is True only when the report is
    complete and defect-free (Requirements 9.3, 9.4, 9.5).
    """

    local_only_enumeration = normalize_local_only(local_only_tables)
    publication_set = (
        frozenset(publication_set_tables)
        if publication_set_tables is not None
        else frozenset()
    )
    isolation = _build_publication_isolation(
        local_only_enumeration=local_only_enumeration,
        publication_set_tables=publication_set,
    )

    # Hosted schema read unavailable: fail closed, do not pass the verdict.
    if hosted is None or not hosted_read_ok:
        empty = {"count": 0, "items": []}
        return {
            "schemaVersion": SCHEMA_MIRROR_REPORT_SCHEMA_VERSION,
            "complete": False,
            "mirrorPass": False,
            "errorCode": HOSTED_SCHEMA_READ_UNAVAILABLE,
            "categories": {key: dict(empty) for key in CATEGORY_KEYS},
            "defects": [],
            "localOnlySchema": {
                "schemaName": LOCAL_ONLY_SCHEMA_NAME,
                "approvalReference": LOCAL_ONLY_APPROVAL_REFERENCE,
                "approvedTables": sorted(local_only_enumeration),
            },
            "publicationIsolation": isolation,
        }

    local_tables = frozenset(local.tables.keys())
    hosted_tables = frozenset(hosted.tables.keys())
    shared_tables = sorted(local_tables & hosted_tables)

    local_only_items = _build_local_only_tables(
        local_tables=local_tables,
        hosted_tables=hosted_tables,
        local_only_enumeration=local_only_enumeration,
    )
    hosted_only_items = _build_hosted_only_tables(
        local_tables=local_tables,
        hosted_tables=hosted_tables,
    )
    column_items = _build_column_set_differences(
        local=local, hosted=hosted, shared_tables=shared_tables
    )
    constraint_items = _build_constraint_differences(
        local=local, hosted=hosted, shared_tables=shared_tables
    )
    rpc_items = _build_rpc_differences(local=local, hosted=hosted)

    categories = {
        "localOnlyTables": {"count": len(local_only_items), "items": local_only_items},
        "hostedOnlyTables": {
            "count": len(hosted_only_items),
            "items": hosted_only_items,
        },
        "columnSetDifferences": {"count": len(column_items), "items": column_items},
        "constraintDifferences": {
            "count": len(constraint_items),
            "items": constraint_items,
        },
        "rpcNameDifferences": {"count": len(rpc_items), "items": rpc_items},
    }

    # Defect determination (Requirement 9.4, 9.5).
    defects: list[dict] = []

    # Unenumerated Local-only tables are defects; enumerated ones are approved.
    for item in local_only_items:
        if not item["approvedLocalOnly"]:
            defects.append(dict(item))

    # Every Hosted-only table is a Hosted-only item.
    for item in hosted_only_items:
        defects.append(dict(item))

    # A shared-table column/constraint difference is a Hosted-only item only
    # when it introduces a Hosted-only column/constraint.
    for item in column_items:
        if item["hostedOnlyColumns"]:
            defects.append(dict(item))
    for item in constraint_items:
        if (item["hostedOnlyConstraints"] or item["definitionDifferences"]
                or item["nullabilityDifferences"]):
            defects.append(dict(item))

    # A Hosted-only RPC is a Hosted-only item.
    for item in rpc_items:
        if item["differenceClass"] == DIFF_RPC_ONLY_IN_HOSTED:
            defects.append(dict(item))

    has_defect = bool(defects)

    return {
        "schemaVersion": SCHEMA_MIRROR_REPORT_SCHEMA_VERSION,
        "complete": True,
        "mirrorPass": not has_defect,
        "errorCode": SCHEMA_MIRROR_DEFECT if has_defect else None,
        "categories": categories,
        "defects": defects,
        "localOnlySchema": {
            "schemaName": LOCAL_ONLY_SCHEMA_NAME,
            "approvalReference": LOCAL_ONLY_APPROVAL_REFERENCE,
            "approvedTables": sorted(local_only_enumeration),
        },
        "publicationIsolation": isolation,
    }


# ---------------------------------------------------------------------------
# Orchestrator: read schemas (Hosted read-only) and build the report.
# ---------------------------------------------------------------------------


def generate_report(
    *,
    local_reader: SchemaReader,
    hosted_reader: SchemaReader,
    local_only_tables: Sequence[str] | None = None,
    publication_set_tables: Sequence[str] | None = None,
) -> dict:
    """Read both schemas and build the report; fail closed on Hosted read.

    ``hosted_reader`` performs a schema-read-only query against the
    Hosted_Database. Any exception it raises is treated as an unavailable Hosted
    schema read: the report is marked incomplete with
    ``hosted_schema_read_unavailable`` and no provider diagnostics or database
    error strings are propagated (Requirement 9.10). The exception object is
    intentionally discarded so its message never reaches the bounded report.
    """

    local = local_reader()

    hosted: SchemaSnapshot | None
    hosted_read_ok: bool
    try:
        hosted = hosted_reader()
        hosted_read_ok = True
    except Exception:  # noqa: BLE001 - any hosted read failure fails closed
        hosted = None
        hosted_read_ok = False

    return build_schema_mirror_report(
        local=local,
        hosted=hosted,
        local_only_tables=local_only_tables,
        publication_set_tables=publication_set_tables,
        hosted_read_ok=hosted_read_ok,
    )


# ---------------------------------------------------------------------------
# Default database schema reader (schema-read-only). Used by the CLI only; the
# pure logic above is what tests exercise, so no live database is required.
# ---------------------------------------------------------------------------

# Schemas excluded from the mirror comparison: Postgres/Supabase system and
# extension schemas that are not migration-defined application schema.
_SYSTEM_SCHEMAS: frozenset[str] = frozenset(
    {
        "pg_catalog",
        "information_schema",
        "pg_toast",
        "auth",
        "storage",
        "extensions",
        "graphql",
        "graphql_public",
        "realtime",
        "supabase_functions",
        "supabase_migrations",
        "vault",
        "pgsodium",
        "pgsodium_masks",
        "net",
        "cron",
    }
)

# Schema-read-only catalog queries. Definitions are hashed in memory and never
# included in the report; these queries never read row data or mutate it.
_TABLES_SQL = (
    "SELECT table_schema, table_name FROM information_schema.tables "
    "WHERE table_type = 'BASE TABLE' AND table_schema <> ALL(%s)"
)
_COLUMNS_SQL = (
    "SELECT table_schema, table_name, column_name, is_nullable FROM information_schema.columns "
    "WHERE table_schema <> ALL(%s)"
)
_CONSTRAINTS_SQL = (
    "SELECT n.nspname, t.relname, c.conname, c.contype, c.convalidated, "
    "c.condeferrable, c.condeferred, c.connoinherit, "
    "pg_catalog.pg_get_constraintdef(c.oid, false) "
    "FROM pg_catalog.pg_constraint c "
    "JOIN pg_catalog.pg_class t ON t.oid = c.conrelid "
    "JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace "
    "WHERE n.nspname <> ALL(%s)"
)
_RPC_SQL = (
    "SELECT n.nspname, p.proname FROM pg_catalog.pg_proc p "
    "JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace "
    "WHERE n.nspname <> ALL(%s)"
)


def read_schema_snapshot(connection) -> SchemaSnapshot:
    """Read a ``SchemaSnapshot`` from a live connection using catalog queries.

    Uses only read-only catalog SELECTs (object, column, and constraint names,
    and RPC names). No row data is read and nothing is mutated, satisfying the
    schema-read-only Hosted access constraint (Requirement 9.9). The connection
    is a psycopg2-style object exposing ``cursor()``.
    """

    excluded = list(_SYSTEM_SCHEMAS)
    columns: dict[str, set[str]] = {}
    constraints: dict[str, set[str]] = {}
    signatures: dict[str, dict[str, str]] = {}
    not_null: dict[str, set[str]] = {}
    table_keys: set[str] = set()
    rpcs: set[str] = set()

    with connection.cursor() as cur:
        cur.execute(_TABLES_SQL, (excluded,))
        for schema, table in cur.fetchall():
            table_keys.add(f"{schema}.{table}")

        cur.execute(_COLUMNS_SQL, (excluded,))
        for schema, table, column, nullable in cur.fetchall():
            key = f"{schema}.{table}"
            if key in table_keys:
                columns.setdefault(key, set()).add(column)
                # PostgreSQL 17 keeps NOT NULL in pg_attribute, outside
                # pg_constraint. Compare the column identity, not an OID-based
                # information_schema synthetic constraint name.
                if nullable == 'NO':
                    not_null.setdefault(key, set()).add(column)

        cur.execute(_CONSTRAINTS_SQL, (excluded,))
        for schema, table, constraint, *definition in cur.fetchall():
            key = f"{schema}.{table}"
            if key in table_keys:
                constraints.setdefault(key, set()).add(constraint)
                signatures.setdefault(key, {})[constraint] = hashlib.sha256(
                    json.dumps(definition, separators=(",", ":")).encode()
                ).hexdigest()

        cur.execute(_RPC_SQL, (excluded,))
        for schema, proc in cur.fetchall():
            rpcs.add(f"{schema}.{proc}")

    tables = {
        key: TableShape(
            columns=frozenset(columns.get(key, set())),
            constraints=frozenset(constraints.get(key, set())),
            constraint_signatures=signatures.get(key, {}),
            not_null_columns=frozenset(not_null.get(key, set())),
        )
        for key in table_keys
    }
    return SchemaSnapshot(tables=tables, rpcs=frozenset(rpcs))


# ---------------------------------------------------------------------------
# Repo-root resolution and artifact writing.
# ---------------------------------------------------------------------------


def _repo_root() -> Path:
    # backend/bin/schema_mirror_report.py -> backend/bin -> backend -> <repo>
    return Path(__file__).resolve().parents[2]


def write_report(report: dict, *, repo_root: Path | None = None) -> Path:
    """Write the report to ``backend/log/schema-mirror-report.json`` and return it.

    The JSON contains only the bounded report — schema/object/column/constraint
    identifiers and counts — with no diagnostics or Forbidden_Log_Field content.
    """

    root = repo_root or _repo_root()
    out_dir = root / "backend" / "log"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "schema-mirror-report.json"
    out_path.write_text(
        json.dumps(report, ensure_ascii=True, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return out_path


# ---------------------------------------------------------------------------
# CLI entrypoint.
# ---------------------------------------------------------------------------


def main(argv: Sequence[str] | None = None) -> int:
    """CLI: generate the Schema_Mirror_Report against a local + hosted DSN.

    Exit code 0 when the mirror passes; 1 when the report is incomplete
    (``hosted_schema_read_unavailable``) or a defect is present
    (``schema_mirror_defect``). Prints only the bounded verdict and, when
    present, the fixed error code — never captured diagnostics.

    Requires ``psycopg2`` and two DSNs. This path is exercised operationally in
    the same run that applies migrations; the report logic itself is verified by
    the unit tests without a database.
    """

    import argparse
    import os

    parser = argparse.ArgumentParser(
        description="Generate the Local vs Hosted Schema_Mirror_Report"
    )
    parser.add_argument(
        "--local-dsn-env",
        default="TZUDONG_LOCAL_DB_DSN",
        help="env var holding the Local_Database DSN",
    )
    parser.add_argument(
        "--hosted-dsn-env",
        default="TZUDONG_HOSTED_DB_DSN",
        help="env var holding the Hosted_Database DSN (schema read only)",
    )
    parser.add_argument(
        "--json", action="store_true", help="print only machine-readable JSON"
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    try:
        import psycopg2  # type: ignore
    except Exception:  # noqa: BLE001
        print("result code: heavy_local_runtime_missing")
        return 1

    local_dsn = os.environ.get(args.local_dsn_env, "")
    hosted_dsn = os.environ.get(args.hosted_dsn_env, "")

    def _reader(dsn: str) -> SchemaReader:
        def read() -> SchemaSnapshot:
            conn = psycopg2.connect(dsn, options="-c search_path=pg_catalog")
            try:
                # Read-only transaction guards against any accidental write.
                conn.set_session(readonly=True, autocommit=True)
                return read_schema_snapshot(conn)
            finally:
                conn.close()

        return read

    report = generate_report(
        local_reader=_reader(local_dsn),
        hosted_reader=_reader(hosted_dsn),
        publication_set_tables=sorted(load_publication_set_tables()),
    )
    write_report(report)

    if args.json:
        print(json.dumps(report, ensure_ascii=True, sort_keys=True))
    else:
        print(
            "schema-mirror complete={complete} pass={passed}".format(
                complete=str(report["complete"]).lower(),
                passed=str(report["mirrorPass"]).lower(),
            )
        )
        if report["errorCode"]:
            print(f"result code: {report['errorCode']}")

    return 0 if report["mirrorPass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
