#!/usr/bin/env python3
"""Source-pinned G038 40-to-42 executor; transaction outcome belongs to its controller."""
from __future__ import annotations

import hashlib
import math
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from g038_successor_contract import (
    EXCLUDED_ROOT,
    PREDECESSOR_PAIRS,
    SELECTED_VERSIONS,
    STATEMENT_VECTOR_ROOT,
    TERMINAL_SPEC_ROOT,
    Manifest,
    Migration,
    canonical_sha256,
    statement_vectors,
)
from g038_successor_authorization import AttemptStarted, VerifiedAuthorization

EXACT_40 = "EXACT_40"
EXACT_42 = "EXACT_42"
PARTIAL_OR_AMBIGUOUS = "PARTIAL_OR_AMBIGUOUS"

_LEDGER_SQL = "SELECT version,name,statements FROM supabase_migrations.schema_migrations ORDER BY version,name"
_LEDGER_INSERT_SQL = "INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES (%s,%s,%s)"
_TIMEOUT_SQL = "SELECT pg_catalog.set_config('statement_timeout', %s, true)"
_LOCK_TIMEOUT_SQL = "SELECT pg_catalog.set_config('lock_timeout', %s, true)"
_IDLE_TIMEOUT_SQL = "SELECT pg_catalog.set_config('idle_in_transaction_session_timeout', %s, true)"
_AUTHORITY_PRECONDITION_SQL = (
    "DO $g038_authority_precondition$ BEGIN "
    "IF current_user <> 'postgres' OR session_user <> 'postgres' "
    "OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_auth_members AS membership "
    "JOIN pg_catalog.pg_roles AS role ON role.oid=membership.roleid "
    "JOIN pg_catalog.pg_roles AS member ON member.oid=membership.member "
    "WHERE role.rolname='privacy_workflow_owner' AND member.rolname='postgres') <> 1 "
    "OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members AS membership "
    "JOIN pg_catalog.pg_roles AS role ON role.oid=membership.roleid "
    "JOIN pg_catalog.pg_roles AS member ON member.oid=membership.member "
    "JOIN pg_catalog.pg_roles AS grantor ON grantor.oid=membership.grantor "
    "WHERE role.rolname='privacy_workflow_owner' AND member.rolname='postgres' "
    "AND grantor.rolname='supabase_admin' AND membership.admin_option "
    "AND NOT membership.inherit_option AND NOT membership.set_option) "
    "THEN RAISE EXCEPTION 'G038 workflow-owner authority precondition drift'; END IF; "
    "END $g038_authority_precondition$"
)
_AUTHORITY_PRELUDE_SQL = (
    "GRANT privacy_workflow_owner TO postgres "
    "WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY postgres"
)
_AUTHORITY_POSTCONDITION_SQL = (
    "DO $g038_authority_postcondition$ BEGIN "
    "IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_auth_members AS membership "
    "JOIN pg_catalog.pg_roles AS role ON role.oid=membership.roleid "
    "JOIN pg_catalog.pg_roles AS member ON member.oid=membership.member "
    "WHERE role.rolname='privacy_workflow_owner' AND member.rolname='postgres') <> 2 "
    "OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members AS membership "
    "JOIN pg_catalog.pg_roles AS role ON role.oid=membership.roleid "
    "JOIN pg_catalog.pg_roles AS member ON member.oid=membership.member "
    "JOIN pg_catalog.pg_roles AS grantor ON grantor.oid=membership.grantor "
    "WHERE role.rolname='privacy_workflow_owner' AND member.rolname='postgres' "
    "AND grantor.rolname='supabase_admin' AND membership.admin_option "
    "AND NOT membership.inherit_option AND NOT membership.set_option) "
    "OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members AS membership "
    "JOIN pg_catalog.pg_roles AS role ON role.oid=membership.roleid "
    "JOIN pg_catalog.pg_roles AS member ON member.oid=membership.member "
    "JOIN pg_catalog.pg_roles AS grantor ON grantor.oid=membership.grantor "
    "WHERE role.rolname='privacy_workflow_owner' AND member.rolname='postgres' "
    "AND grantor.rolname='postgres' AND NOT membership.admin_option "
    "AND membership.inherit_option AND membership.set_option) "
    "THEN RAISE EXCEPTION 'G038 workflow-owner authority postcondition drift'; END IF; "
    "END $g038_authority_postcondition$"
)
_STABLE_SCHEMAS = (
    "public", "auth", "storage", "shortener_private", "ocr_private",
    "provider_budget_private", "privacy_retention", "account_deletion_private",
)
_CATALOG_SQL = (
    "SELECT n.nspname AS schema_name,c.relname AS relation_name,c.relkind AS relation_kind,"
    "pg_catalog.pg_get_userbyid(c.relowner) AS relation_owner "
    "FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace "
    "WHERE n.nspname=ANY(%s) AND c.relkind IN ('r','p') ORDER BY 1,2,3,4"
)
_ACL_SQL = (
    "SELECT n.nspname AS schema_name,c.relname AS relation_name,"
    "COALESCE(grantor.rolname,'PUBLIC') AS grantor_name,"
    "COALESCE(grantee.rolname,'PUBLIC') AS grantee_name,"
    "x.privilege_type AS privilege_type,x.is_grantable AS is_grantable "
    "FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace "
    "CROSS JOIN LATERAL pg_catalog.aclexplode("
    "COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) x "
    "LEFT JOIN pg_catalog.pg_roles grantor ON grantor.oid=x.grantor "
    "LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid=x.grantee "
    "WHERE n.nspname=ANY(%s) AND c.relkind IN ('r','p') ORDER BY 1,2,3,4,5,6"
)
_DATA_IDENTITY_SQL = (
    "SELECT ((SELECT count(*) FROM pg_catalog.pg_proc candidate "
    "JOIN pg_catalog.pg_namespace candidate_namespace ON candidate_namespace.oid=candidate.pronamespace "
    "WHERE candidate_namespace.nspname='privacy_retention' "
    "AND candidate.proname='g040_terminal_data_probe')=1 "
    "AND pg_catalog.pg_get_userbyid(p.proowner)='privacy_workflow_owner' "
    "AND p.prosecdef AND p.prokind='f' "
    "AND pg_catalog.pg_get_function_identity_arguments(p.oid)='' "
    "AND p.proconfig=ARRAY['search_path=\"\"']::text[] "
    "AND (SELECT count(*)=2 AND count(*) FILTER (WHERE e.privilege_type='EXECUTE' "
    "AND NOT e.is_grantable AND e.grantee IN (p.proowner,"
    "(SELECT oid FROM pg_catalog.pg_roles WHERE rolname='postgres')))=2 "
    "FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) e)) "
    "identity_ok FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace "
    "WHERE n.nspname='privacy_retention' AND p.proname='g040_terminal_data_probe'"
)
_DATA_SQL = "SELECT * FROM privacy_retention.g040_terminal_data_probe()"
_DATA_FIELDS = (
    "classes_count", "exact_seed_count", "seed_rows_exact", "class_source_count",
    "legal_hold_count", "work_item_count", "retained_record_count", "run_count",
    "run_item_count", "runtime_tables_empty", "seed_projection_sha256", "data_shape_sha256",
)
_RUNTIME_DATA_FIELDS = (
    "class_source_count", "legal_hold_count", "work_item_count",
    "retained_record_count", "run_count", "run_item_count",
)
_TERMINAL_SEED_PROJECTION_SHA256 = "bd536808115c924350aac3403c9a679e7c1a0386c86c012f9d9fc7df840cf038"
_TERMINAL_DATA_SHA256 = "2e21ebee5faf4e926e63685db60dd23a7ce26b858ffb68ca668ac9d7904663ce"
_TRANSACTION_SQL = (
    "SELECT current_setting('transaction_read_only', true) AS transaction_read_only, "
    "current_setting('g038.attempt_binding', true) AS attempt_binding, "
    "pg_catalog.pg_current_xact_id_if_assigned() IS NOT NULL AS xid_assigned"
)
_LOCK_SQL = (
    "SELECT pg_catalog.pg_advisory_xact_lock(6038, 40)",
    "LOCK TABLE supabase_migrations.schema_migrations IN ACCESS EXCLUSIVE MODE",
    "LOCK TABLE privacy_retention.g014_public_rpc_allowlist IN SHARE ROW EXCLUSIVE MODE",
    "LOCK TABLE public.account_deletion_requests IN SHARE ROW EXCLUSIVE MODE",
    "LOCK TABLE public.account_deletion_request_items IN SHARE ROW EXCLUSIVE MODE",
    "LOCK TABLE storage.objects IN SHARE ROW EXCLUSIVE MODE",
)
_TERMINAL_FIELDS = (
    "schema_exact", "schema_acl_exact", "table_exact", "table_acl_exact",
    "policies_exact", "indices_exact", "rpc_overloads_exact", "rpc_set_exact",
    "rpc_owner_search_path_exact", "rpc_acl_exact", "old_status_overload_absent",
    "transient_membership_absent", "terminal_memberships_exact",
    "reauth_proofs_empty_exact",
)
_MAX_TIMEOUT_MS = 2_147_483_647
_HEX64 = frozenset("0123456789abcdef")
_COMPATIBILITY_VERSION = "20260713002700"
_COMPATIBILITY_SOURCE_SHA256 = "ea2866a78e39a5a3d54c5ff5bb8f7517a3aeca38d8bae7c592750a6d58d223fc"
_COMPATIBILITY_TRANSFORMED_SOURCE_SHA256 = "b3b883c081deb4a59d260005a7a278bfd8ad7655957aa85b411eaf31ca3aebfb"
_COMPATIBILITY_START = 18070
_COMPATIBILITY_END = 18234
_COMPATIBILITY_OLD = b"  IF pg_catalog.pg_has_role('postgres', 'privacy_workflow_owner', 'MEMBER') THEN RAISE EXCEPTION 'G028 temporary workflow-owner membership was not revoked'; END IF;"
_COMPATIBILITY_NEW = b"""  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS role ON role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS member ON member.oid = membership.member
    JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = membership.grantor
    WHERE role.rolname = 'privacy_workflow_owner'
      AND member.rolname = 'postgres'
      AND grantor.rolname = 'postgres'
  ) THEN RAISE EXCEPTION 'G028 temporary workflow-owner membership was not revoked'; END IF;
  IF EXISTS (
    (VALUES
      ('privacy_workflow_owner', 'postgres', 'supabase_admin', true, false, false),
      ('privacy_retention_operator_approver', 'postgres', 'supabase_admin', true, false, false),
      ('privacy_retention_legal_approver', 'postgres', 'supabase_admin', true, false, false),
      ('privacy_retention_activation_operator', 'postgres', 'supabase_admin', true, false, false)
    ) EXCEPT
    SELECT role.rolname, member.rolname, grantor.rolname,
      membership.admin_option, membership.inherit_option, membership.set_option
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS role ON role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS member ON member.oid = membership.member
    JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = membership.grantor
    WHERE role.rolname IN ('privacy_workflow_owner', 'privacy_retention_operator_approver', 'privacy_retention_legal_approver', 'privacy_retention_activation_operator')
       OR member.rolname IN ('privacy_workflow_owner', 'privacy_retention_operator_approver', 'privacy_retention_legal_approver', 'privacy_retention_activation_operator')
  ) OR EXISTS (
    SELECT role.rolname, member.rolname, grantor.rolname,
      membership.admin_option, membership.inherit_option, membership.set_option
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS role ON role.oid = membership.roleid
    JOIN pg_catalog.pg_roles AS member ON member.oid = membership.member
    JOIN pg_catalog.pg_roles AS grantor ON grantor.oid = membership.grantor
    WHERE role.rolname IN ('privacy_workflow_owner', 'privacy_retention_operator_approver', 'privacy_retention_legal_approver', 'privacy_retention_activation_operator')
       OR member.rolname IN ('privacy_workflow_owner', 'privacy_retention_operator_approver', 'privacy_retention_legal_approver', 'privacy_retention_activation_operator')
    EXCEPT
    VALUES
      ('privacy_workflow_owner', 'postgres', 'supabase_admin', true, false, false),
      ('privacy_retention_operator_approver', 'postgres', 'supabase_admin', true, false, false),
      ('privacy_retention_legal_approver', 'postgres', 'supabase_admin', true, false, false),
      ('privacy_retention_activation_operator', 'postgres', 'supabase_admin', true, false, false)
  ) THEN RAISE EXCEPTION 'G028 terminal workflow-owner membership matrix drift'; END IF;"""
_COMPATIBILITY_OLD_SHA256 = "ee40481961212966aec4963a8406928a28b4280a4adf6b778ee27f63d7d1f148"
_COMPATIBILITY_NEW_SHA256 = "e88f54011bdd2745af2d1d32bf94c7e7227f2bb177b9f6c7d3dbffe1e5716bd5"


class SuccessorError(RuntimeError):
    """Bounded fail-closed executor error."""

    def __init__(self, code: str, *, version: str | None = None, ordinal: int | None = None,
                 statement_sha256: str | None = None):
        self.code = code
        self.evidence = {
            key: value for key, value in (
                ("version", version), ("ordinal", ordinal),
                ("statement_sha256", statement_sha256),
            ) if value is not None
        }
        super().__init__(code)


@dataclass(frozen=True)
class CompiledMigration:
    migration: Migration
    original: tuple[str, ...]
    executable: tuple[str, ...]


@dataclass(frozen=True)
class SuccessorPlan:
    repository_root: Path
    manifest: Manifest
    compiled: tuple[CompiledMigration, ...]
    statement_vector_root: str
    terminal_spec_root: str
    excluded_root: str

@dataclass(frozen=True)
class LiveState:
    """Exact immutable state derived from one live database snapshot."""

    classification: str
    rows: int
    ledger_root: str
    catalog_root: str
    acl_root: str
    data_root: str

@dataclass(frozen=True)
class ExecutionEvidence:
    classification: str
    target_fingerprint: str
    attempt_id: str
    inserted_rows: int
    executed_statements: int
    terminal_ledger_root: str
    statement_vector_root: str
    terminal_spec_root: str
    evidence_sha256: str

_REHEARSAL_SEAL = object()


@dataclass(frozen=True, init=False)
class RehearsalCapability:
    """Clone-only admission minted by the local adapter, never by hosted authority."""

    plan: SuccessorPlan
    starting: LiveState
    target: LiveState | None
    transaction_sentinel: str
    transaction_xid: str
    deadline_monotonic: float
    _seal: object

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        _fail("rehearsal_capability")


def _fail(code: str) -> None:
    raise SuccessorError(code) from None


def _hex64(value: Any) -> bool:
    return type(value) is str and len(value) == 64 and set(value) <= _HEX64


def _transaction_attempt_binding(authorization: VerifiedAuthorization, attempt: AttemptStarted) -> str:
    fields = {
        "authorization_id": getattr(authorization, "authorization_id", None),
        "attempt_id": getattr(authorization, "attempt_id", None),
        "authorization_sha256": getattr(authorization, "authorization_sha256", None),
        "signature_sha256": getattr(authorization, "signature_sha256", None),
        "bindings_sha256": getattr(authorization, "bindings_sha256", None),
        "attempt_receipt_sha256": getattr(attempt, "receipt_sha256", None),
    }
    if (any(type(fields[key]) is not str or not fields[key] for key in ("authorization_id", "attempt_id"))
            or any(not _hex64(fields[key]) for key in (
                "authorization_sha256", "signature_sha256", "bindings_sha256", "attempt_receipt_sha256",
            ))
            or getattr(attempt, "authorization_id", None) != fields["authorization_id"]
            or getattr(attempt, "attempt_id", None) != fields["attempt_id"]
            or any(getattr(attempt, key, None) != fields[key] for key in (
                "authorization_sha256", "signature_sha256", "bindings_sha256",
            ))):
        _fail("attempt_binding")
    return canonical_sha256({"schema": "g038-controller-transaction-binding-v1", **fields})


def _new_rehearsal_capability(
    *, plan: SuccessorPlan, starting: LiveState, target: LiveState | None,
    transaction_sentinel: str, transaction_xid: str, deadline_monotonic: float,
) -> RehearsalCapability:
    """Internal constructor for the local adapter's controller-owned transaction."""
    if (type(plan) is not SuccessorPlan or type(starting) is not LiveState
            or (target is not None and type(target) is not LiveState)
            or type(transaction_sentinel) is not str or len(transaction_sentinel) < 32
            or type(transaction_xid) is not str or not transaction_xid.isdigit()):
        _fail("rehearsal_capability")
    _deadline(deadline_monotonic)
    value = object.__new__(RehearsalCapability)
    for name, item in (
        ("plan", plan), ("starting", starting), ("target", target),
        ("transaction_sentinel", transaction_sentinel), ("transaction_xid", transaction_xid),
        ("deadline_monotonic", deadline_monotonic), ("_seal", _REHEARSAL_SEAL),
    ):
        object.__setattr__(value, name, item)
    return value


def _deadline(deadline_monotonic: Any) -> int:
    if (type(deadline_monotonic) not in (int, float)
            or (type(deadline_monotonic) is float and not math.isfinite(deadline_monotonic))):
        _fail("deadline")
    remaining = int((deadline_monotonic - time.monotonic()) * 1000)
    if remaining <= 1:
        _fail("deadline")
    return min(remaining - 1, _MAX_TIMEOUT_MS)


def _execute(cursor: Any, sql: str, params: tuple[Any, ...] = (), *, deadline_monotonic: float,
             version: str | None = None, ordinal: int | None = None) -> None:
    try:
        cursor.execute(_TIMEOUT_SQL, (str(_deadline(deadline_monotonic)),))
        cursor.execute(sql, params) if params else cursor.execute(sql)
    except SuccessorError:
        raise
    except Exception:
        if version is not None and ordinal is not None:
            raise SuccessorError(
                "statement_failure", version=version, ordinal=ordinal,
                statement_sha256=hashlib.sha256(sql.encode("utf-8")).hexdigest(),
            ) from None
        _fail("database_failure")


def _query(cursor: Any, sql: str, params: tuple[Any, ...] = (), *, deadline_monotonic: float) -> list[Any]:
    _execute(cursor, sql, params, deadline_monotonic=deadline_monotonic)
    try:
        return list(cursor.fetchall())
    except Exception:
        _fail("database_read")


def _decode_ledger(rows: list[Any]) -> tuple[tuple[str, str, tuple[str, ...]], ...]:
    decoded = []
    for row in rows:
        if type(row) is dict and set(row) == {"version", "name", "statements"}:
            version, name, statements = row["version"], row["name"], row["statements"]
        elif type(row) in (tuple, list) and len(row) == 3:
            version, name, statements = row
        else:
            _fail("ledger_shape")
        if (type(version) is not str or not version or type(name) is not str or not name
                or type(statements) not in (tuple, list) or not statements
                or any(type(statement) is not str or not statement.strip() for statement in statements)):
            _fail("ledger_shape")
        decoded.append((version, name, tuple(statements)))
    result = tuple(decoded)
    if len({(version, name) for version, name, _ in result}) != len(result):
        _fail("ledger_shape")
    return result


def _ledger(cursor: Any, *, deadline_monotonic: float) -> tuple[tuple[str, str, tuple[str, ...]], ...]:
    return _decode_ledger(_query(cursor, _LEDGER_SQL, deadline_monotonic=deadline_monotonic))


def _projection_rows(rows: list[Any], fields: tuple[str, ...], code: str) -> tuple[tuple[Any, ...], ...]:
    decoded = []
    for row in rows:
        if type(row) is dict and set(row) == set(fields):
            values = tuple(row[field] for field in fields)
        elif type(row) in (tuple, list) and len(row) == len(fields):
            values = tuple(row)
        else:
            _fail(code)
        decoded.append(values)
    result = tuple(decoded)
    if len(result) != len(set(result)):
        _fail(code)
    return result


def _one_row(cursor: Any, sql: str, fields: tuple[str, ...], *, deadline_monotonic: float,
             code: str) -> dict[str, Any]:
    rows = _projection_rows(_query(cursor, sql, deadline_monotonic=deadline_monotonic), fields, code)
    if len(rows) != 1:
        _fail(code)
    return dict(zip(fields, rows[0]))


def observe_live_state(cursor: Any, *, plan: SuccessorPlan, predecessor_ledger_root: str,
                       target_ledger_root: str, deadline_monotonic: float) -> LiveState:
    """Derive the canonical ledger, catalog, ACL, and data roots from the live cursor."""
    if type(plan) is not SuccessorPlan or not _hex64(predecessor_ledger_root) or not _hex64(target_ledger_root):
        _fail("observation_contract")
    ledger_rows = _ledger(cursor, deadline_monotonic=deadline_monotonic)
    pairs = tuple((version, name) for version, name, _ in ledger_rows)
    ledger_root = canonical_sha256(pairs)
    predecessor_pairs = tuple(PREDECESSOR_PAIRS)
    target_pairs = predecessor_pairs + tuple(
        (entry.migration.version, entry.migration.name) for entry in plan.compiled
    )
    if len(ledger_rows) == 40 and pairs == predecessor_pairs and ledger_root == predecessor_ledger_root:
        classification = EXACT_40
    elif (len(ledger_rows) == 42 and pairs == target_pairs and ledger_root == target_ledger_root
          and tuple(row[2] for row in ledger_rows[-2:]) == tuple(entry.original for entry in plan.compiled)):
        classification = EXACT_42
    else:
        classification = PARTIAL_OR_AMBIGUOUS

    catalog = _projection_rows(
        _query(cursor, _CATALOG_SQL, (list(_STABLE_SCHEMAS),), deadline_monotonic=deadline_monotonic),
        ("schema_name", "relation_name", "relation_kind", "relation_owner"), "catalog_shape",
    )
    if not catalog:
        _fail("catalog_shape")
    catalog_rows = tuple(sorted(tuple(str(value) for value in row) for row in catalog))
    acl = _projection_rows(
        _query(cursor, _ACL_SQL, (list(_STABLE_SCHEMAS),), deadline_monotonic=deadline_monotonic),
        ("schema_name", "relation_name", "grantor_name", "grantee_name",
         "privilege_type", "is_grantable"), "acl_shape",
    )
    acl_rows = tuple(sorted(tuple(str(value) for value in row) for row in acl))

    identity = _one_row(
        cursor, _DATA_IDENTITY_SQL, ("identity_ok",),
        deadline_monotonic=deadline_monotonic, code="data_probe_identity",
    )
    if identity != {"identity_ok": True}:
        _fail("data_probe_identity")
    data = _one_row(
        cursor, _DATA_SQL, _DATA_FIELDS, deadline_monotonic=deadline_monotonic, code="data_shape",
    )
    count_fields = set(_DATA_FIELDS) - {
        "seed_rows_exact", "runtime_tables_empty", "seed_projection_sha256", "data_shape_sha256",
    }
    if (any(type(data[field]) is not int for field in count_fields)
            or type(data["seed_rows_exact"]) is not bool
            or type(data["runtime_tables_empty"]) is not bool
            or not _hex64(data["seed_projection_sha256"])
            or not _hex64(data["data_shape_sha256"])):
        _fail("data_shape")
    if not (data["classes_count"] == 12 and data["exact_seed_count"] == 12
            and data["seed_rows_exact"] is True and data["runtime_tables_empty"] is True
            and data["seed_projection_sha256"] == _TERMINAL_SEED_PROJECTION_SHA256
            and all(data[field] == 0 for field in _RUNTIME_DATA_FIELDS)
            and data["data_shape_sha256"] == _TERMINAL_DATA_SHA256):
        _fail("data_drift")
    return LiveState(
        classification=classification, rows=len(ledger_rows), ledger_root=ledger_root,
        catalog_root=canonical_sha256(catalog_rows), acl_root=canonical_sha256(acl_rows),
        data_root=data["data_shape_sha256"],
    )


def compile_plan(repository_root: Path, manifest: Manifest) -> SuccessorPlan:
    """Compile both pinned vectors before any database admission or mutation."""
    if type(repository_root) is not type(Path()) or type(manifest) is not Manifest:
        _fail("source_contract")
    if (tuple(item.version for item in manifest.migrations) != SELECTED_VERSIONS
            or manifest.statement_vector_root != STATEMENT_VECTOR_ROOT
            or manifest.terminal_spec_root != TERMINAL_SPEC_ROOT
            or manifest.excluded_root != EXCLUDED_ROOT
            or manifest.predecessor_rows != 40 or manifest.target_rows != 42):
        _fail("source_contract")
    compiled = []
    for item in manifest.migrations:
        try:
            path = repository_root / item.path
            raw = path.read_bytes()
            original = statement_vectors(repository_root, item)
            executable = original if item.version == SELECTED_VERSIONS[0] else original[1:-1]
        except Exception:
            _fail("source_contract")
        if (type(raw) is not bytes or not raw or len(raw) != item.size
                or hashlib.sha256(raw).hexdigest() != item.sha256
                or type(original) is not tuple or type(executable) is not tuple
                or not original or not executable
                or any(type(statement) is not str or not statement.strip() for statement in original + executable)
                or canonical_sha256(list(original)) != item.vector_sha256):
            _fail("vector_contract")
        if item.version == SELECTED_VERSIONS[0]:
            if original != executable or any(_transaction_control(statement) for statement in executable):
                _fail("02600_transaction_control")
        elif item.version == SELECTED_VERSIONS[1]:
            if (len(original) < 3 or original[0].strip().upper() != "BEGIN"
                    or original[-1].strip().upper() != "COMMIT"
                    or executable != original[1:-1]
                    or any(_transaction_control(statement) for statement in executable)):
                _fail("02700_wrapper")
            executable = _compatibility_executable(raw, executable)
        else:
            _fail("forbidden_version")
        compiled.append(CompiledMigration(item, original, executable))
    vector_root = canonical_sha256([[entry.migration.version, entry.migration.vector_sha256] for entry in compiled])
    if vector_root != STATEMENT_VECTOR_ROOT:
        _fail("vector_root")
    return SuccessorPlan(repository_root, manifest, tuple(compiled), vector_root, TERMINAL_SPEC_ROOT, EXCLUDED_ROOT)


def _transaction_control(statement: str) -> bool:
    # Contract parsing has already isolated statements.  Only the leading executable word matters here.
    token = statement.lstrip().split(None, 2)
    if not token:
        return False
    first = token[0].rstrip(";").lower()
    second = token[1].rstrip(";").lower() if len(token) > 1 else ""
    return first in {"abort", "begin", "commit", "end", "rollback", "savepoint", "release"} or (first, second) in {
        ("prepare", "transaction"), ("start", "transaction")
    }
def _compatibility_executable(raw: bytes, executable: tuple[str, ...]) -> tuple[str, ...]:
    if (hashlib.sha256(_COMPATIBILITY_OLD).hexdigest() != _COMPATIBILITY_OLD_SHA256
            or hashlib.sha256(_COMPATIBILITY_NEW).hexdigest() != _COMPATIBILITY_NEW_SHA256
            or hashlib.sha256(raw).hexdigest() != _COMPATIBILITY_SOURCE_SHA256
            or len(raw) < _COMPATIBILITY_END
            or raw[_COMPATIBILITY_START:_COMPATIBILITY_END] != _COMPATIBILITY_OLD
            or raw.count(_COMPATIBILITY_OLD) != 1):
        _fail("02700_compatibility_source")
    transformed_source = raw[:_COMPATIBILITY_START] + _COMPATIBILITY_NEW + raw[_COMPATIBILITY_END:]
    if hashlib.sha256(transformed_source).hexdigest() != _COMPATIBILITY_TRANSFORMED_SOURCE_SHA256:
        _fail("02700_compatibility_transform")
    old = _COMPATIBILITY_OLD.decode("ascii")
    new = _COMPATIBILITY_NEW.decode("ascii")
    occurrences = sum(statement.count(old) for statement in executable)
    if occurrences != 1:
        _fail("02700_compatibility_occurrence")
    transformed = tuple(statement.replace(old, new) for statement in executable)
    if sum(statement.count(new) for statement in transformed) != 1:
        _fail("02700_compatibility_transform")
    return transformed


def classify_cursor(cursor: Any, *, plan: SuccessorPlan, predecessor_ledger_root: str,
                    target_ledger_root: str, deadline_monotonic: float) -> str:
    """Read-only ledger classifier retained for non-hosted compatibility callers."""
    if type(plan) is not SuccessorPlan or not _hex64(predecessor_ledger_root) or not _hex64(target_ledger_root):
        _fail("classification_contract")
    rows = _ledger(cursor, deadline_monotonic=deadline_monotonic)
    pairs = tuple((version, name) for version, name, _ in rows)
    root = canonical_sha256(pairs)
    predecessor_pairs = tuple(PREDECESSOR_PAIRS)
    target_pairs = predecessor_pairs + tuple((entry.migration.version, entry.migration.name) for entry in plan.compiled)
    if len(rows) == 40 and pairs == predecessor_pairs and root == predecessor_ledger_root:
        return EXACT_40
    if (len(rows) == 42 and pairs == target_pairs and root == target_ledger_root
            and tuple(rows[-2 + index][2] for index in range(2)) == tuple(entry.original for entry in plan.compiled)):
        return EXACT_42
    return PARTIAL_OR_AMBIGUOUS


def _authorization(plan: SuccessorPlan, authorization: VerifiedAuthorization, attempt: AttemptStarted) -> None:
    if type(authorization) is not VerifiedAuthorization or type(attempt) is not AttemptStarted:
        _fail("authorization")
    manifest = plan.manifest
    expected = {
        "predecessor_report_sha256": manifest.predecessor_report_sha256,
        "target_fingerprint": manifest.target_fingerprint,
        "predecessor_rows": 40,
        "target_rows": 42,
        "selected_versions": list(SELECTED_VERSIONS),
        "vector_root": plan.statement_vector_root,
        "target_spec_sha256": plan.terminal_spec_root,
        "exclusions_root": plan.excluded_root,
    }
    if any(getattr(authorization, field, None) != value for field, value in expected.items()):
        _fail("authorization_binding")
    for field in (
        "starting_ledger_root", "starting_catalog_root", "starting_acl_root", "starting_data_root",
        "target_ledger_root", "target_catalog_root", "target_acl_root", "target_data_root",
        "runtime_source_root",
    ):
        if not _hex64(getattr(authorization, field, None)):
            _fail("authorization_binding")
    if (type(authorization.expires_at) is not int or authorization.expires_at <= int(time.time())
            or type(authorization.attempt_id) is not str or not authorization.attempt_id):
        _fail("authorization_binding")
    if (getattr(attempt, "authorization_id", None) != authorization.authorization_id
            or getattr(attempt, "attempt_id", None) != authorization.attempt_id
            or getattr(attempt, "target_fingerprint", None) != authorization.target_fingerprint
            or getattr(attempt, "runtime_source_root", None) != authorization.runtime_source_root
            or getattr(attempt, "authorization_sha256", None) != getattr(authorization, "authorization_sha256", None)
            or getattr(attempt, "signature_sha256", None) != getattr(authorization, "signature_sha256", None)
            or getattr(attempt, "bindings_sha256", None) != getattr(authorization, "bindings_sha256", None)
            or not _hex64(getattr(attempt, "receipt_sha256", None))):
        _fail("attempt_binding")


def _controller_transaction(cursor: Any, authorization: VerifiedAuthorization, attempt: AttemptStarted, *,
                            deadline_monotonic: float) -> None:
    expected_binding = _transaction_attempt_binding(authorization, attempt)
    rows = _query(cursor, _TRANSACTION_SQL, deadline_monotonic=deadline_monotonic)
    if len(rows) != 1:
        _fail("transaction_ownership")
    row = rows[0]
    if type(row) is dict and set(row) == {"transaction_read_only", "attempt_binding", "xid_assigned"}:
        values = (row["transaction_read_only"], row["attempt_binding"], row["xid_assigned"])
    elif type(row) in (tuple, list):
        values = tuple(row)
    else:
        _fail("transaction_ownership")
    if (len(values) != 3 or values[0] != "off" or values[1] != expected_binding
            or values[2] is not True):
        _fail("transaction_ownership")


def _locks(cursor: Any, *, deadline_monotonic: float) -> None:
    remaining = str(_deadline(deadline_monotonic))
    _execute(cursor, _LOCK_TIMEOUT_SQL, (remaining,), deadline_monotonic=deadline_monotonic)
    _execute(cursor, _IDLE_TIMEOUT_SQL, (remaining,), deadline_monotonic=deadline_monotonic)
    _execute(cursor, _LOCK_SQL[0], deadline_monotonic=deadline_monotonic)
    _execute(cursor, _AUTHORITY_PRECONDITION_SQL, deadline_monotonic=deadline_monotonic)
    _execute(cursor, _AUTHORITY_PRELUDE_SQL, deadline_monotonic=deadline_monotonic)
    _execute(cursor, _AUTHORITY_POSTCONDITION_SQL, deadline_monotonic=deadline_monotonic)
    for statement in _LOCK_SQL[1:]:
        _execute(cursor, statement, deadline_monotonic=deadline_monotonic)


def assert_terminal_readback(cursor: Any, plan: SuccessorPlan, *,
                             deadline_monotonic: float) -> None:
    """Run the source-pinned semantic terminal assertions without owning a transaction."""
    readback_path = plan.repository_root / "backend/supabase/tests/g038_terminal_readback.sql"
    try:
        sql = readback_path.read_text(encoding="utf-8")
    except Exception:
        _fail("terminal_readback_source")
    result = _projection_rows(
        _query(cursor, sql, deadline_monotonic=deadline_monotonic),
        _TERMINAL_FIELDS, "terminal_readback",
    )
    if len(result) != 1 or result[0] != (True,) * len(_TERMINAL_FIELDS):
        _fail("terminal_readback")


def classify_rows(rows: tuple[tuple[str, str, tuple[str, ...]], ...], plan: SuccessorPlan,
                  target_ledger_root: str) -> str:
    target_pairs = tuple(PREDECESSOR_PAIRS) + tuple((entry.migration.version, entry.migration.name) for entry in plan.compiled)
    if (len(rows) == 42 and tuple((version, name) for version, name, _ in rows) == target_pairs
            and canonical_sha256(target_pairs) == target_ledger_root
            and tuple(row[2] for row in rows[-2:]) == tuple(entry.original for entry in plan.compiled)):
        return EXACT_42
    return PARTIAL_OR_AMBIGUOUS


def _execute_plan_mutation(cursor: Any, plan: SuccessorPlan, *, deadline_monotonic: float) -> int:
    executed = 0
    for entry in plan.compiled:
        for ordinal, statement in enumerate(entry.executable, 1):
            _execute(cursor, statement, deadline_monotonic=deadline_monotonic,
                     version=entry.migration.version, ordinal=ordinal)
            executed += 1
        _execute(cursor, _LEDGER_INSERT_SQL,
                 (entry.migration.version, entry.migration.name, list(entry.original)),
                 deadline_monotonic=deadline_monotonic,
                 version=entry.migration.version, ordinal=len(entry.executable) + 1)
    return executed


def _rehearsal_transaction(cursor: Any, capability: RehearsalCapability) -> None:
    sql = (
        "SELECT current_setting('transaction_read_only', true), "
        "current_setting('g038.rehearsal_sentinel', true), "
        "pg_catalog.pg_current_xact_id_if_assigned()::text"
    )
    rows = _query(cursor, sql, deadline_monotonic=capability.deadline_monotonic)
    if len(rows) != 1:
        _fail("rehearsal_transaction")
    row = rows[0]
    values = tuple(row.values()) if type(row) is dict else tuple(row) if type(row) in (tuple, list) else ()
    if values != ("off", capability.transaction_sentinel, capability.transaction_xid):
        _fail("rehearsal_transaction")


def apply_rehearsal_cursor(cursor: Any, *, capability: RehearsalCapability) -> ExecutionEvidence:
    """Apply once to an admitted local clone cursor without transaction ownership."""
    if (type(capability) is not RehearsalCapability or getattr(capability, "_seal", None) is not _REHEARSAL_SEAL
            or type(capability.plan) is not SuccessorPlan or type(capability.starting) is not LiveState):
        _fail("rehearsal_capability")
    deadline = capability.deadline_monotonic
    _deadline(deadline)
    _rehearsal_transaction(cursor, capability)
    _locks(cursor, deadline_monotonic=deadline)
    starting = observe_live_state(
        cursor, plan=capability.plan, predecessor_ledger_root=capability.starting.ledger_root,
        target_ledger_root=canonical_sha256(tuple(PREDECESSOR_PAIRS) + tuple(
            (entry.migration.version, entry.migration.name) for entry in capability.plan.compiled
        )), deadline_monotonic=deadline,
    )
    if starting != capability.starting or starting.classification != EXACT_40 or starting.rows != 40:
        _fail("destructive_admission")
    executed = _execute_plan_mutation(cursor, capability.plan, deadline_monotonic=deadline)
    target_ledger_root = canonical_sha256(tuple(PREDECESSOR_PAIRS) + tuple(
        (entry.migration.version, entry.migration.name) for entry in capability.plan.compiled
    ))
    terminal = observe_live_state(
        cursor, plan=capability.plan, predecessor_ledger_root=starting.ledger_root,
        target_ledger_root=target_ledger_root, deadline_monotonic=deadline,
    )
    if terminal.classification != EXACT_42 or terminal.rows != 42:
        _fail("terminal_roots")
    if capability.target is not None and terminal != capability.target:
        _fail("terminal_roots")
    assert_terminal_readback(cursor, capability.plan, deadline_monotonic=deadline)
    fingerprint = canonical_sha256({
        "ledger_root": terminal.ledger_root, "catalog_root": terminal.catalog_root,
        "acl_root": terminal.acl_root, "data_root": terminal.data_root,
    })
    evidence = {
        "classification": EXACT_42, "target_fingerprint": fingerprint,
        "attempt_id": capability.transaction_sentinel, "inserted_rows": 2,
        "executed_statements": executed, "terminal_ledger_root": terminal.ledger_root,
        "statement_vector_root": capability.plan.statement_vector_root,
        "terminal_spec_root": capability.plan.terminal_spec_root,
    }
    return ExecutionEvidence(**evidence, evidence_sha256=canonical_sha256(evidence))


def apply_cursor(cursor: Any, *, plan: SuccessorPlan, authorization: VerifiedAuthorization,
                 attempt: AttemptStarted, deadline_monotonic: float) -> ExecutionEvidence:
    """Apply once through a controller-owned cursor; never BEGIN, COMMIT, reconnect, or retry."""
    _authorization(plan, authorization, attempt)
    _deadline(deadline_monotonic)
    _controller_transaction(cursor, authorization, attempt, deadline_monotonic=deadline_monotonic)
    _locks(cursor, deadline_monotonic=deadline_monotonic)
    starting = observe_live_state(
        cursor, plan=plan, predecessor_ledger_root=authorization.starting_ledger_root,
        target_ledger_root=authorization.target_ledger_root, deadline_monotonic=deadline_monotonic,
    )
    expected_starting = (
        EXACT_40, 40, authorization.starting_ledger_root, authorization.starting_catalog_root,
        authorization.starting_acl_root, authorization.starting_data_root,
    )
    if (
        starting.classification, starting.rows, starting.ledger_root, starting.catalog_root,
        starting.acl_root, starting.data_root,
    ) != expected_starting:
        _fail("destructive_admission")
    executed = _execute_plan_mutation(cursor, plan, deadline_monotonic=deadline_monotonic)
    terminal = observe_live_state(
        cursor, plan=plan, predecessor_ledger_root=authorization.starting_ledger_root,
        target_ledger_root=authorization.target_ledger_root, deadline_monotonic=deadline_monotonic,
    )
    expected_terminal = (
        EXACT_42, 42, authorization.target_ledger_root, authorization.target_catalog_root,
        authorization.target_acl_root, authorization.target_data_root,
    )
    if (
        terminal.classification, terminal.rows, terminal.ledger_root, terminal.catalog_root,
        terminal.acl_root, terminal.data_root,
    ) != expected_terminal:
        _fail("terminal_roots")
    assert_terminal_readback(cursor, plan, deadline_monotonic=deadline_monotonic)
    evidence = {
        "classification": EXACT_42,
        "target_fingerprint": authorization.target_fingerprint,
        "attempt_id": authorization.attempt_id,
        "inserted_rows": 2,
        "executed_statements": executed,
        "terminal_ledger_root": terminal.ledger_root,
        "statement_vector_root": plan.statement_vector_root,
        "terminal_spec_root": plan.terminal_spec_root,
    }
    return ExecutionEvidence(**evidence, evidence_sha256=canonical_sha256(evidence))
