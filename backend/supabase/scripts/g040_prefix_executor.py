#!/usr/bin/env python3
"""G040 locked prefix reconciliation; transaction outcome belongs to the controller."""
from __future__ import annotations

import hashlib
import math
import time
from dataclasses import dataclass
from typing import Any, Mapping
from pathlib import Path

from g037_hosted_closure_contract import BASELINE_PAIRS, ROLE_PROTOCOL_EPILOGUE, STATIC_RPC_MATRIX, Manifest, canonical_bytes, terminal_spec, validate_sources
from g037_hosted_closure_executor import ClosureError, _precompute_execution_plan, terminal_readback_assert
from g035_hosted_recovery import _compatibility_sql
from g040_prefix_recovery import DATA_PROBE, Denial, PrefixObservation, SOURCE_COMMIT, TABLES, TERMINAL_DATA_IDENTITY_PROBE, TERMINAL_DATA_PROBE, TERMINAL_DATA_PROJECTION, classify_mutation_cursor, probe_full_data_root, validate_full_data_root, validate_terminal_data_probe_identity, validate_terminal_data_root
from g040_recovery_authorization import AttemptStarted, VerifiedAuthorization
from g040_recovery_source import SourceBinding
from g040_reference_evidence import VerifiedReference

_PREFIX_COUNT = 28
_TERMINAL_ROWS = 40
_V00400 = ("20260712000400", "g010_retention_separation")
_MAX_STATEMENT_TIMEOUT_MILLISECONDS = 2_147_483_647
_STATEMENT_TIMEOUT_SQL = "SELECT pg_catalog.set_config('statement_timeout', %s, true)"
_SUFFIX = (
    ("20260712000500", "g010_incident_workflow"),
    ("20260712000600", "g010_ocr_log_minimization"),
    ("20260713000100", "g013_short_url_security"),
    ("20260713000200", "g013_ocr_quota_security"),
    ("20260713000300", "g013_admin_provider_budgets"),
    ("20260713000450", "g013_address_admin_approval"),
    ("20260713002000", "g014_public_api_private_boundary"),
    ("20260713002100", "g014_privacy_workflows"),
    ("20260713002200", "g014_marketing_state_machine"),
    ("20260713002300", "g014_account_deletion_state_machine"),
    ("20260713002400", "g014_retention_adapters_receipts"),
)
_LOCK_SQL = (
    "SELECT pg_catalog.pg_advisory_xact_lock(6040, 400)",
    "LOCK TABLE supabase_migrations.schema_migrations IN ACCESS EXCLUSIVE MODE",
)
_DATA_LOCK_SQL = tuple(
    f"LOCK TABLE privacy_retention.{table} IN SHARE ROW EXCLUSIVE MODE" for table in TABLES
)
_TERMINAL_DATA_PROBE_INSTALL = (
    """CREATE OR REPLACE FUNCTION privacy_retention.g040_terminal_data_probe()
RETURNS TABLE (
  classes_count bigint,
  exact_seed_count bigint,
  seed_rows_exact boolean,
  class_source_count bigint,
  legal_hold_count bigint,
  work_item_count bigint,
  retained_record_count bigint,
  run_count bigint,
  run_item_count bigint,
  runtime_tables_empty boolean,
  seed_projection_sha256 text,
  data_shape_sha256 text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $g040$
""" + TERMINAL_DATA_PROJECTION + """
$g040$""",
    "ALTER FUNCTION privacy_retention.g040_terminal_data_probe() OWNER TO privacy_workflow_owner",
    "REVOKE ALL ON FUNCTION privacy_retention.g040_terminal_data_probe() FROM PUBLIC, anon, authenticated, service_role, supabase_admin",
    "GRANT EXECUTE ON FUNCTION privacy_retention.g040_terminal_data_probe() TO postgres",
)
_PROVIDER_VECTOR_SCHEMA_OCCURRENCES = {
    "20260713002000": 4,
    "20260713002400": 4,
}
_PROVIDER_POLICY_VERSION = "20260713002000"
_PROVIDER_OWNER_PREDICATE = "pg_catalog.pg_get_userbyid(procedure.proowner) NOT IN ('postgres', 'privacy_workflow_owner')"
_PROVIDER_EFFECTIVE_ACL_PREDICATE = """WHERE namespace.nspname = 'public'
      AND pg_catalog.has_function_privilege(role_matrix.grantee, procedure.oid, 'EXECUTE')"""
_PROVIDER_PUBLIC_ACL_PREDICATE = """WHERE namespace.nspname = 'public'
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'"""
_PROVIDER_VECTOR_EXTENSION_MEMBER = """pg_catalog.pg_get_userbyid(procedure.proowner) = 'supabase_admin'
          AND EXISTS (
            SELECT 1
            FROM pg_catalog.pg_depend AS dependency
            JOIN pg_catalog.pg_extension AS extension
              ON extension.oid = dependency.refobjid
            JOIN pg_catalog.pg_namespace AS extension_namespace
              ON extension_namespace.oid = extension.extnamespace
            WHERE dependency.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
              AND dependency.objid = procedure.oid
              AND dependency.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
              AND dependency.deptype = 'e'
              AND extension.extname = 'vector'
              AND extension_namespace.nspname = 'public'
              AND pg_catalog.pg_get_userbyid(extension.extowner) = 'supabase_admin'
          )"""
_PROVIDER_OWNER_REPLACEMENT = f"""NOT (
        pg_catalog.pg_get_userbyid(procedure.proowner) IN ('postgres', 'privacy_workflow_owner')
        OR (
          {_PROVIDER_VECTOR_EXTENSION_MEMBER}
        )
      )"""
_PROVIDER_EFFECTIVE_ACL_REPLACEMENT = f"""WHERE namespace.nspname = 'public'
      AND NOT (
          {_PROVIDER_VECTOR_EXTENSION_MEMBER}
      )
      AND pg_catalog.has_function_privilege(role_matrix.grantee, procedure.oid, 'EXECUTE')"""
_PROVIDER_PUBLIC_ACL_REPLACEMENT = f"""WHERE namespace.nspname = 'public'
      AND NOT (
          {_PROVIDER_VECTOR_EXTENSION_MEMBER}
      )
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'"""
_G040_VECTOR_RPC_SIGNATURES = (
    "public.match_storyboard_documents_hybrid(uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb)",
    "public.match_storyboard_documents_hybrid_v2(uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb)",
)


def g040_runtime_rpc_matrix() -> tuple[tuple[str, str], ...]:
    """Return the exact runtime ACL matrix after the source-pinned vector-schema transform."""
    transformed = tuple(
        (
            signature.replace("(uuid,extensions.vector,", "(uuid,public.vector,", 1)
            if signature in _G040_VECTOR_RPC_SIGNATURES
            else signature,
            grantee,
        )
        for signature, grantee in STATIC_RPC_MATRIX
    )
    changed = tuple(
        (before, after)
        for before, after in zip(STATIC_RPC_MATRIX, transformed, strict=True)
        if before != after
    )
    if (
        len(changed) != 4
        or {before[0] for before, _ in changed} != set(_G040_VECTOR_RPC_SIGNATURES)
        or any(after[0].count("public.vector") != 1 for _, after in changed)
        or len(transformed) != len(set(transformed))
    ):
        _deny("runtime_rpc_matrix")
    return transformed


_CLONE_CAPABILITIES: dict[int, Any] = {}


class ExecutionDenial(Denial):
    """Provider failure carrying only replay-safe statement identity."""

    def __init__(self, *, version: str, ordinal: int, statement: str):
        self.evidence = {
            "version": version,
            "ordinal": ordinal,
            "statement_sha256": hashlib.sha256(statement.encode("utf-8")).hexdigest(),
        }
        super().__init__("execution_failed")


@dataclass(frozen=True)
class RecoveryExecutionPlan:
    repository_root: Path
    manifest: Manifest
    source: SourceBinding
    reference: VerifiedReference
    observation: PrefixObservation
    authorization: VerifiedAuthorization
    branch: str
    compiled: tuple[tuple[Any, tuple[str, ...], tuple[str, ...]], ...]
    terminal_spec_root: str
@dataclass(frozen=True)
class SourceValidationPlan:
    repository_root: Path
    manifest: Manifest
    source: SourceBinding
    compiled: tuple[tuple[Any, tuple[str, ...], tuple[str, ...]], ...]
    terminal_spec_root: str
    migration_count: int
    terminal_rows: int
@dataclass(frozen=True)
class DerivedTerminalExpectation:
    terminal_rows: int
    terminal_ledger_root: str
    terminal_catalog_root: str
    terminal_acl_root: str
    terminal_data_root: str
    terminal_spec_root: str
    plan_sha256: str

@dataclass(frozen=True)
class _CloneAdmission:
    """Exact-type verifier result, deliberately not a caller supplied marker."""
    clone_identity: str
    clone_nonce: str
    target_fingerprint: str
    live_identity_sha256: str
    port: int


@dataclass(frozen=True)
class _VerifiedCloneCapability:
    """Local-only clone admission bound to an observed PostgreSQL identity."""
    _admission: _CloneAdmission
    clone_identity: str
    clone_nonce: str
    target_fingerprint: str

    @classmethod
    def _admit(cls, *, clone_identity: str, clone_nonce: str, target_fingerprint: str,
               live_identity_sha256: str, port: int) -> "_VerifiedCloneCapability":
        if (not isinstance(clone_nonce, str) or type(port) is not int or not 1 <= port <= 65535
                or any(type(value) is not str or len(value) != 64
                       for value in (clone_identity, target_fingerprint, live_identity_sha256))):
            _deny("clone_capability")
        admission = _CloneAdmission(clone_identity, clone_nonce, target_fingerprint,
                                    live_identity_sha256, port)
        capability = cls(admission, clone_identity, clone_nonce, target_fingerprint)
        _CLONE_CAPABILITIES[id(capability)] = capability
        return capability


def _admit_verified_clone(*, clone_identity: str, clone_nonce: str, target_fingerprint: str,
                          live_identity_sha256: str, port: int) -> _VerifiedCloneCapability:
    """Mint an internal clone capability after custody verification."""
    return _VerifiedCloneCapability._admit(
        clone_identity=clone_identity, clone_nonce=clone_nonce,
        target_fingerprint=target_fingerprint, live_identity_sha256=live_identity_sha256,
        port=port,
    )

@dataclass(frozen=True)
class RehearsalExecutionPlan:
    repository_root: Path
    manifest: Manifest
    source: SourceBinding
    reference: VerifiedReference
    observation: PrefixObservation
    branch: str
    compiled: tuple[tuple[Any, tuple[str, ...], tuple[str, ...]], ...]
    terminal_spec_root: str

@dataclass(frozen=True)
class ExecutorEvidence:
    branch: str
    target_fingerprint: str
    source_commit: str
    source_root: str
    reference_receipt_sha256: str
    classification_sha256: str
    authorization_sha256: str
    attempt_receipt_sha256: str
    applied_statement_count: int
    terminal_rows: int
    terminal_catalog_root: str
    terminal_acl_root: str
    terminal_ledger_root: str
    terminal_spec_root: str
    terminal_data_root: str
    evidence_sha256: str


def _deny(code: str) -> None:
    raise Denial(code)


def preflight_deadline(deadline_monotonic: Any) -> None:
    if (type(deadline_monotonic) not in (int, float)
            or (type(deadline_monotonic) is float and not math.isfinite(deadline_monotonic))
            or time.monotonic() >= deadline_monotonic):
        _deny("deadline")


def _deadline(deadline_monotonic: Any) -> None:
    preflight_deadline(deadline_monotonic)


def _remaining_milliseconds(deadline_monotonic: float) -> str:
    _deadline(deadline_monotonic)
    remaining = int((deadline_monotonic - time.monotonic()) * 1000)
    if remaining <= 1:
        _deny("deadline")
    timeout_milliseconds = min(remaining - 1, _MAX_STATEMENT_TIMEOUT_MILLISECONDS)
    if timeout_milliseconds <= 0:
        _deny("deadline")
    return str(timeout_milliseconds)


class _DeadlineCursor:
    """Cursor adapter which refreshes a fail-closed timeout for every nested statement."""

    def __init__(self, cursor: Any, deadline_monotonic: float):
        self._cursor = cursor
        self._deadline_monotonic = deadline_monotonic

    def execute(self, sql: str, params: tuple[Any, ...] = ()) -> None:
        _execute(
            self._cursor,
            sql,
            params,
            deadline_monotonic=self._deadline_monotonic,
        )

    def __getattr__(self, name: str) -> Any:
        return getattr(self._cursor, name)
class _TupleRowCursor:
    """Present exact ordered tuples to the legacy terminal contract."""

    def __init__(self, cursor: Any):
        self._cursor = cursor

    def execute(self, sql: str, params: tuple[Any, ...] = ()) -> Any:
        return self._cursor.execute(sql, params) if params else self._cursor.execute(sql)

    def _row(self, row: Any) -> tuple[Any, ...]:
        if type(row) is tuple:
            return row
        if type(row) is list:
            return tuple(row)
        if type(row) is not dict:
            _deny("terminal_row_shape")
        description = self._cursor.description
        if not description:
            _deny("terminal_row_shape")
        names = tuple(column.name if hasattr(column, "name") else column[0] for column in description)
        if len(names) != len(set(names)) or set(row) != set(names):
            _deny("terminal_row_shape")
        return tuple(row[name] for name in names)

    def fetchall(self) -> list[tuple[Any, ...]]:
        return [self._row(row) for row in self._cursor.fetchall()]

    def fetchone(self) -> tuple[Any, ...] | None:
        row = self._cursor.fetchone()
        return None if row is None else self._row(row)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._cursor, name)



def _execute(cursor: Any, sql: str, params: tuple[Any, ...] = (), *, deadline_monotonic: float | None = None, version: str | None = None, ordinal: int | None = None) -> None:
    try:
        if deadline_monotonic is not None:
            cursor.execute(_STATEMENT_TIMEOUT_SQL, (_remaining_milliseconds(deadline_monotonic),))
        if params:
            cursor.execute(sql, params)
        else:
            cursor.execute(sql)
    except Denial:
        raise
    except Exception:
        if version is not None and ordinal is not None:
            raise ExecutionDenial(version=version, ordinal=ordinal, statement=sql) from None
        _deny("execution_failed")


def _ledger(cursor: Any) -> tuple[tuple[str, str, tuple[str, ...]], ...]:
    try:
        cursor.execute("SELECT version,name,statements FROM supabase_migrations.schema_migrations ORDER BY version,name")
        rows = cursor.fetchall()
        decoded = []
        for row in rows:
            if type(row) is dict:
                if set(row) != {"version", "name", "statements"}:
                    _deny("ledger_read")
                version, name, statements = row["version"], row["name"], row["statements"]
            elif type(row) in (tuple, list) and len(row) == 3:
                version, name, statements = row
            else:
                _deny("ledger_read")
            decoded.append((str(version), str(name), tuple(statements)))
        result = tuple(decoded)
    except Denial:
        raise
    except Exception:
        _deny("ledger_read")
    if any(not version or not name or any(type(statement) is not str or not statement.strip() for statement in statements) for version, name, statements in result):
        _deny("ledger_shape")
    return result

def _provider_vector_schema_sql(version: str, statements: tuple[str, ...]) -> tuple[str, ...]:
    expected = _PROVIDER_VECTOR_SCHEMA_OCCURRENCES.get(version, 0)
    vector_occurrences = sum(statement.count("extensions.vector") for statement in statements)
    policy_occurrences = tuple(
        sum(statement.count(predicate) for statement in statements)
        for predicate in (
            _PROVIDER_OWNER_PREDICATE,
            _PROVIDER_EFFECTIVE_ACL_PREDICATE,
            _PROVIDER_PUBLIC_ACL_PREDICATE,
        )
    )
    expected_policy_occurrences = (1, 1, 1) if version == _PROVIDER_POLICY_VERSION else (0, 0, 0)
    if vector_occurrences != expected or policy_occurrences != expected_policy_occurrences:
        _deny("vector_compile")
    transformed = tuple(
        statement.replace("extensions.vector", "public.vector")
        .replace(_PROVIDER_OWNER_PREDICATE, _PROVIDER_OWNER_REPLACEMENT)
        .replace(_PROVIDER_EFFECTIVE_ACL_PREDICATE, _PROVIDER_EFFECTIVE_ACL_REPLACEMENT)
        .replace(_PROVIDER_PUBLIC_ACL_PREDICATE, _PROVIDER_PUBLIC_ACL_REPLACEMENT)
        for statement in statements
    )
    if (any("extensions.vector" in statement for statement in transformed)
            or any(predicate in statement for statement in transformed for predicate in (
                _PROVIDER_OWNER_PREDICATE,
                _PROVIDER_EFFECTIVE_ACL_PREDICATE,
                _PROVIDER_PUBLIC_ACL_PREDICATE,
            ))):
        _deny("vector_compile")
    return transformed


def _compiled(root: Path, manifest: Manifest) -> tuple[tuple[Any, tuple[str, ...], tuple[str, ...]], ...]:
    result = []
    seen_versions: set[str] = set()
    seen_vectors: set[tuple[str, ...]] = set()
    try:
        canonical_plan, _ = _precompute_execution_plan(root, manifest)
        for item, original_full, _transformed_full, transformed_inner in canonical_plan:
            compatibility = _compatibility_sql(item.version)
            if not original_full or not transformed_inner:
                _deny("vector_empty")
            if item.version in seen_versions or original_full in seen_vectors:
                _deny("vector_duplicate")
            seen_versions.add(item.version)
            seen_vectors.add(original_full)
            result.append((item, original_full, (*compatibility, *_provider_vector_schema_sql(item.version, transformed_inner))))
    except (ClosureError, OSError, ValueError):
        _deny("vector_compile")
    return tuple(result)


def _validate_source_artifacts(repository_root: Any, manifest: Any, source: Any) -> tuple[Path, str]:
    if not isinstance(repository_root, Path) or type(manifest) is not Manifest or type(source) is not SourceBinding:
        _deny("plan_type")
    try:
        resolved_root = repository_root.resolve(strict=False)
    except OSError:
        _deny("plan_type")
    if not resolved_root.is_absolute() or resolved_root != repository_root or repository_root.is_symlink():
        _deny("plan_type")
    if validate_sources(repository_root) != manifest:
        _deny("source_binding")
    spec = terminal_spec(manifest)
    migrations = manifest.migrations
    if (len(migrations) != 28 or len(BASELINE_PAIRS) != 12 or len(BASELINE_PAIRS) + 16 != _PREFIX_COUNT
            or len(migrations[:16]) != 16 or (migrations[16].version, migrations[16].name) != _V00400
            or tuple((item.version, item.name) for item in migrations[17:]) != _SUFFIX
            or len(BASELINE_PAIRS) + len(migrations) != _TERMINAL_ROWS):
        _deny("manifest_contract")
    return repository_root, spec

def _validate_artifacts(repository_root: Any, manifest: Any, source: Any, reference: Any, observation: Any, authorization: Any) -> tuple[Path, str]:
    root, spec = _validate_source_artifacts(repository_root, manifest, source)
    if type(reference) is not VerifiedReference or type(observation) is not PrefixObservation or type(authorization) is not VerifiedAuthorization:
        _deny("artifact_type")
    if (reference.base_commit != SOURCE_COMMIT
            or authorization.base_commit != SOURCE_COMMIT
            or source.final_commit != reference.final_commit
            or source.runtime_source_root != reference.runtime_source_root
            or observation.status not in ("UNAPPLIED", "FULL_ESCAPED")
            or observation.target_fingerprint != reference.target_fingerprint
            or observation.final_commit != source.final_commit
            or observation.runtime_source_root != source.runtime_source_root
            or observation.reference_receipt_sha256 != reference.receipt_sha256
            or observation.observation_nonce != reference.observation_nonce):
        _deny("artifact_binding")
    if (authorization.final_recovery_commit != source.final_commit
            or authorization.runtime_source_root != source.runtime_source_root
            or authorization.manifest_root != reference.manifest_sha256
            or authorization.source_root != reference.migration_source_sha256
            or authorization.target_fingerprint != reference.target_fingerprint
            or authorization.terminal_root != spec
            or authorization.prefix_state_receipt_sha256 != observation.classification_sha256
            or authorization.prefix_classification != observation.status):
        _deny("authorization_binding")
    if observation.status == "UNAPPLIED":
        if observation.ledger_prefix_sha256 != reference.ledger_prefix_sha256 or observation.catalog_sha256 != reference.absent_catalog_sha256 or observation.data_sha256 is not None:
            _deny("observation_binding")
    elif (observation.ledger_prefix_sha256 != reference.ledger_prefix_sha256
          or observation.catalog_sha256 != reference.full_catalog_sha256
          or observation.data_sha256 != reference.full_data_sha256):
        _deny("observation_binding")
    return root, spec

def build_source_validation_plan(repository_root: Path, manifest: Manifest, *, source: SourceBinding) -> SourceValidationPlan:
    root, spec = _validate_source_artifacts(repository_root, manifest, source)
    compiled = _compiled(root, manifest)
    return SourceValidationPlan(root, manifest, source, compiled, spec, len(manifest.migrations), _TERMINAL_ROWS)


def build_execution_plan(repository_root: Path, manifest: Manifest, *, source: SourceBinding, reference: VerifiedReference, observation: PrefixObservation, authorization: VerifiedAuthorization) -> RecoveryExecutionPlan:
    """Validate every pure source and artifact binding before one-shot consumption."""
    root, spec = _validate_artifacts(repository_root, manifest, source, reference, observation, authorization)
    compiled = _compiled(root, manifest)
    return RecoveryExecutionPlan(root, manifest, source, reference, observation, authorization, observation.status, compiled, spec)
def compile_branch_plan(repository_root: Path, manifest: Manifest, *, source: SourceBinding,
                        reference: VerifiedReference, observation: PrefixObservation) -> RehearsalExecutionPlan:
    """Compile a local replay plan without accepting production authority."""
    root, spec = _validate_source_artifacts(repository_root, manifest, source)
    if (type(reference) is not VerifiedReference or type(observation) is not PrefixObservation
            or reference.base_commit != SOURCE_COMMIT
            or observation.status not in ("UNAPPLIED", "FULL_ESCAPED")
            or source.final_commit != reference.final_commit
            or source.runtime_source_root != reference.runtime_source_root
            or observation.final_commit != source.final_commit
            or observation.runtime_source_root != source.runtime_source_root
            or observation.target_fingerprint != reference.target_fingerprint
            or observation.reference_receipt_sha256 != reference.receipt_sha256):
        _deny("artifact_binding")
    return RehearsalExecutionPlan(root, manifest, source, reference, observation,
                                  observation.status, _compiled(root, manifest), spec)


def _validated_local_clone_identity(cursor: Any, capability: _VerifiedCloneCapability) -> None:
    admission = capability._admission
    if (_CLONE_CAPABILITIES.get(id(capability)) is not capability
            or type(admission) is not _CloneAdmission
            or (capability.clone_identity, capability.clone_nonce, capability.target_fingerprint)
            != (admission.clone_identity, admission.clone_nonce, admission.target_fingerprint)):
        _deny("clone_capability")
    info = getattr(getattr(cursor, "connection", None), "info", None)
    if getattr(info, "host", None) != "127.0.0.1" or getattr(info, "port", None) != admission.port:
        _deny("clone_capability")
    try:
        cursor.execute(
            "SELECT (pg_control_system()).system_identifier::text AS system_identifier, "
            "(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid, "
            "current_database() AS database_name, current_setting('server_version') AS server_version, "
            "current_setting('server_version_num')::integer AS server_version_num"
        )
        row = cursor.fetchone()
    except Exception:
        _deny("clone_capability")
    required = {"system_identifier", "database_oid", "database_name", "server_version", "server_version_num"}
    if (not isinstance(row, Mapping) or set(row) != required or row["database_name"] != "g035_local"
            or row["server_version"] != "17.6" or row["server_version_num"] != 170006
            or not all(type(row[key]) is str and row[key] for key in required - {"server_version_num"})):
        _deny("clone_capability")
    encoded = __import__("json").dumps(dict(row), sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")
    if hashlib.sha256(encoded).hexdigest() != admission.live_identity_sha256:
        _deny("clone_capability")


def _apply_rehearsal_locked_cursor(cursor: Any, *, plan: RehearsalExecutionPlan,
                                   verified_clone_capability: _VerifiedCloneCapability,
                                   deadline_monotonic: float) -> ExecutorEvidence:
    """Replay only after fresh local-clone admission."""
    if (type(plan) is not RehearsalExecutionPlan
            or type(verified_clone_capability) is not _VerifiedCloneCapability
            or verified_clone_capability.target_fingerprint != plan.reference.target_fingerprint):
        _deny("clone_capability")
    _validated_local_clone_identity(cursor, verified_clone_capability)
    return _apply_mutation_locked_cursor(
        cursor, plan=plan, expected_data_root=plan.reference.terminal_data_root,
        authorization_sha256="", attempt_receipt_sha256="",
        expected_catalog_root=plan.reference.terminal_catalog_root,
        expected_acl_root=plan.reference.terminal_acl_root,
        expected_ledger_root=plan.reference.terminal_ledger_root,
        deadline_monotonic=deadline_monotonic,
    )


def _insert(cursor: Any, item: Any, full: tuple[str, ...], *, deadline_monotonic: float) -> None:
    _execute(cursor, "INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES (%s,%s,%s)", (item.version, item.name, list(full)), deadline_monotonic=deadline_monotonic)


def _validate_attempt(plan: RecoveryExecutionPlan, attempt: Any) -> AttemptStarted:
    if type(plan) is not RecoveryExecutionPlan or type(attempt) is not AttemptStarted:
        _deny("attempt_type")
    auth = plan.authorization
    if (attempt.authorization_id != auth.authorization_id or attempt.attempt_id != auth.attempt_id
            or attempt.target_fingerprint != plan.reference.target_fingerprint
            or attempt.runtime_source_root != plan.source.runtime_source_root
            or attempt.prefix_state_receipt_sha256 != plan.observation.classification_sha256
            or attempt.prefix_classification != plan.branch
            or attempt.selected_branch != auth.selected_branch
            or attempt.authorization_sha256 != auth.authorization_sha256
            or attempt.signature_sha256 != auth.signature_sha256
            or attempt.bindings_sha256 != auth.bindings_sha256):
        _deny("attempt_binding")
    return attempt


def _assert_prefix_ledger(cursor: Any, compiled: tuple[tuple[Any, tuple[str, ...], tuple[str, ...]], ...]) -> None:
    rows = _ledger(cursor)
    expected_prefix = BASELINE_PAIRS + tuple((item.version, item.name) for item, _, _ in compiled[:16])
    expected_vectors = tuple((item.version, item.name, full) for item, full, _ in compiled[:16])
    if (len(rows) != _PREFIX_COUNT or tuple((version, name) for version, name, _ in rows) != expected_prefix
            or rows[len(BASELINE_PAIRS):] != expected_vectors
            or any(version == _V00400[0] for version, _, _ in rows)):
        _deny("ledger_conflict")

def _source_initial_data_root(cursor: Any, expected_data_root: str, *, deadline_monotonic: float) -> str:
    _execute(cursor, DATA_PROBE, deadline_monotonic=deadline_monotonic)
    try:
        data = cursor.fetchone()
    except Exception:
        _deny("probe_error")
    return validate_full_data_root(data, expected_data_root)


def _source_full_data_root(cursor: Any, expected_data_root: str, *, deadline_monotonic: float) -> str:
    _execute(cursor, TERMINAL_DATA_IDENTITY_PROBE, deadline_monotonic=deadline_monotonic)
    try:
        identity = cursor.fetchone()
    except Exception:
        _deny("probe_error")
    validate_terminal_data_probe_identity(identity)
    _execute(cursor, TERMINAL_DATA_PROBE, deadline_monotonic=deadline_monotonic)
    try:
        data = cursor.fetchone()
    except Exception:
        _deny("probe_error")
    return validate_terminal_data_root(data, expected_data_root)


def _terminal_mutation_core(cursor: Any, *, compiled: tuple[tuple[Any, tuple[str, ...], tuple[str, ...]], ...],
                            branch: str, initial_data_root_reader: Any, terminal_data_root_reader: Any,
                            expected_initial_data_root: str, expected_terminal_data_root: str,
                            deadline_monotonic: float) -> tuple[int, str]:
    v00400 = compiled[16]
    applied = 0
    if branch == "FULL_ESCAPED":
        data_root = initial_data_root_reader()
        if data_root != expected_initial_data_root:
            _deny("terminal_data_mismatch")
    if branch == "UNAPPLIED":
        for ordinal, statement in enumerate(v00400[2], start=1):
            _execute(cursor, statement, deadline_monotonic=deadline_monotonic,
                     version=v00400[0].version, ordinal=ordinal)
            applied += 1
        for sql in _DATA_LOCK_SQL:
            _execute(cursor, sql, deadline_monotonic=deadline_monotonic)
        data_root = initial_data_root_reader()
        if data_root != expected_initial_data_root:
            _deny("terminal_data_mismatch")
    _insert(cursor, v00400[0], v00400[1], deadline_monotonic=deadline_monotonic)
    for item, full, executable in compiled[17:]:
        for ordinal, statement in enumerate(executable, start=1):
            _execute(cursor, statement, deadline_monotonic=deadline_monotonic,
                     version=item.version, ordinal=ordinal)
            applied += 1
        _insert(cursor, item, full, deadline_monotonic=deadline_monotonic)
    for ordinal, statement in enumerate(_TERMINAL_DATA_PROBE_INSTALL, start=1):
        _execute(
            cursor,
            statement,
            deadline_monotonic=deadline_monotonic,
            version="g040-terminal-data-probe",
            ordinal=ordinal,
        )
        applied += 1
    _execute(
        cursor,
        ROLE_PROTOCOL_EPILOGUE.decode("ascii"),
        deadline_monotonic=deadline_monotonic,
        version="20260718003700",
        ordinal=1,
    )
    applied += 1
    data_root = terminal_data_root_reader()
    if data_root != expected_terminal_data_root:
        _deny("terminal_data_mismatch")
    _deadline(deadline_monotonic)
    return applied, data_root


def _terminal_readback(cursor: Any, *, repository_root: Path, manifest: Manifest,
                       terminal_spec_root: str) -> dict[str, str]:
    try:
        terminal = terminal_readback_assert(
            _TupleRowCursor(cursor),
            repository_root,
            manifest,
            runtime_rpc_matrix=g040_runtime_rpc_matrix(),
            allow_provider_vector_extension_members=True,
        )
    except Denial:
        raise
    except Exception:
        _deny("terminal_mismatch")
    required = {"catalog_root", "acl_root", "ledger_root", "terminal_spec"}
    if (type(terminal) is not dict or set(terminal) != required
            or terminal["terminal_spec"] != terminal_spec_root):
        _deny("terminal_mismatch")
    return terminal


def _validate_source_plan(plan: Any) -> SourceValidationPlan:
    if type(plan) is not SourceValidationPlan:
        _deny("plan_type")
    root, spec = _validate_source_artifacts(plan.repository_root, plan.manifest, plan.source)
    compiled = _compiled(root, plan.manifest)
    if (plan.repository_root != root or plan.compiled != compiled
            or plan.terminal_spec_root != spec
            or plan.migration_count != len(plan.manifest.migrations)
            or plan.terminal_rows != _TERMINAL_ROWS):
        _deny("plan_binding")
    return plan


def _derivation_plan_sha256(plan: SourceValidationPlan, *, branch: str,
                            expected_initial_data_root: str, expected_terminal_data_root: str) -> str:
    payload = {
        "branch": branch,
        "compiled": tuple({
            "version": item.version, "name": item.name, "path": item.path,
            "sha256": item.sha256, "full": full, "executable": executable,
        } for item, full, executable in plan.compiled),
        "expected_initial_data_root": expected_initial_data_root,
        "expected_terminal_data_root": expected_terminal_data_root,
        "terminal_data_probe_install": _TERMINAL_DATA_PROBE_INSTALL,
        "source": {
            "final_commit": plan.source.final_commit,
            "runtime_source_root": plan.source.runtime_source_root,
        },
        "terminal_rows": plan.terminal_rows,
        "terminal_spec_root": plan.terminal_spec_root,
    }
    return hashlib.sha256(canonical_bytes(payload)).hexdigest()


def _derive_terminal_locked_cursor(cursor: Any, *, plan: SourceValidationPlan, branch: str,
                                   expected_initial_data_root: str, expected_terminal_data_root: str,
                                   deadline_monotonic: float) -> DerivedTerminalExpectation:
    plan = _validate_source_plan(plan)
    if branch not in ("UNAPPLIED", "FULL_ESCAPED"):
        _deny("branch")
    if any(type(root) is not str or len(root) != 64
           or any(character not in "0123456789abcdef" for character in root)
           for root in (expected_initial_data_root, expected_terminal_data_root)):
        _deny("data_root")
    timed_cursor = _DeadlineCursor(cursor, deadline_monotonic)
    _execute(cursor, "SELECT current_setting('transaction_read_only', true) AS transaction_read_only",
             deadline_monotonic=deadline_monotonic)
    try:
        state = cursor.fetchone()
    except Exception:
        _deny("transaction_state")
    if state not in (("off",), {"transaction_read_only": "off"}):
        _deny("not_read_write")
    for sql in _LOCK_SQL:
        _execute(cursor, sql, deadline_monotonic=deadline_monotonic)
    if branch == "FULL_ESCAPED":
        for sql in _DATA_LOCK_SQL:
            _execute(cursor, sql, deadline_monotonic=deadline_monotonic)
    _assert_prefix_ledger(timed_cursor, plan.compiled)
    _, data_root = _terminal_mutation_core(
        cursor, compiled=plan.compiled, branch=branch,
        initial_data_root_reader=lambda: _source_initial_data_root(
            timed_cursor, expected_initial_data_root, deadline_monotonic=deadline_monotonic),
        terminal_data_root_reader=lambda: _source_full_data_root(
            timed_cursor, expected_terminal_data_root, deadline_monotonic=deadline_monotonic),
        expected_initial_data_root=expected_initial_data_root,
        expected_terminal_data_root=expected_terminal_data_root,
        deadline_monotonic=deadline_monotonic,
    )
    terminal = _terminal_readback(timed_cursor, repository_root=plan.repository_root,
                                  manifest=plan.manifest,
                                  terminal_spec_root=plan.terminal_spec_root)
    return DerivedTerminalExpectation(
        terminal_rows=plan.terminal_rows, terminal_ledger_root=terminal["ledger_root"],
        terminal_catalog_root=terminal["catalog_root"], terminal_acl_root=terminal["acl_root"],
        terminal_data_root=data_root, terminal_spec_root=terminal["terminal_spec"],
        plan_sha256=_derivation_plan_sha256(
            plan, branch=branch, expected_initial_data_root=expected_initial_data_root,
            expected_terminal_data_root=expected_terminal_data_root),
    )


def _derive_clone_terminal_expectation(connection: Any, *, source_plan: SourceValidationPlan,
                                       verified_clone_capability: _VerifiedCloneCapability,
                                       branch: str, expected_initial_data_root: str,
                                       expected_terminal_data_root: str,
                                       deadline_monotonic: float) -> DerivedTerminalExpectation:
    """Derive clone terminal roots in a transaction this boundary always rolls back."""
    preflight_deadline(deadline_monotonic)
    if (type(source_plan) is not SourceValidationPlan
            or type(verified_clone_capability) is not _VerifiedCloneCapability
            or not callable(getattr(connection, "cursor", None))
            or not callable(getattr(connection, "rollback", None))):
        _deny("clone_capability")
    cursor = None
    try:
        cursor = connection.cursor()
        if getattr(cursor, "connection", None) is not connection:
            _deny("clone_capability")
        _execute(cursor, "BEGIN", deadline_monotonic=deadline_monotonic)
        _validated_local_clone_identity(cursor, verified_clone_capability)
        return _derive_terminal_locked_cursor(
            cursor, plan=source_plan, branch=branch,
            expected_initial_data_root=expected_initial_data_root,
            expected_terminal_data_root=expected_terminal_data_root,
            deadline_monotonic=deadline_monotonic,
        )
    finally:
        connection.rollback()


def _apply_mutation_locked_cursor(cursor: Any, *, plan: RecoveryExecutionPlan | RehearsalExecutionPlan,
                                  expected_data_root: str, authorization_sha256: str,
                                  attempt_receipt_sha256: str, expected_catalog_root: str,
                                  expected_acl_root: str, expected_ledger_root: str,
                                  deadline_monotonic: float) -> ExecutorEvidence:
    """Shared locked mutation path; admission belongs to its production or clone caller."""
    timed_cursor = _DeadlineCursor(cursor, deadline_monotonic)
    _execute(cursor, "SELECT current_setting('transaction_read_only', true) AS transaction_read_only",
             deadline_monotonic=deadline_monotonic, version="g040-runtime", ordinal=0)
    try:
        state = cursor.fetchone()
    except Exception:
        _deny("transaction_state")
    if state not in (("off",), {"transaction_read_only": "off"}):
        _deny("not_read_write")
    for ordinal, sql in enumerate(_LOCK_SQL, 1):
        _execute(cursor, sql, deadline_monotonic=deadline_monotonic, version="g040-lock", ordinal=ordinal)
    if plan.branch == "FULL_ESCAPED":
        for ordinal, sql in enumerate(_DATA_LOCK_SQL, 1):
            _execute(cursor, sql, deadline_monotonic=deadline_monotonic, version="g040-data-lock", ordinal=ordinal)
    locked = classify_mutation_cursor(
        timed_cursor, plan.reference, expected_prior=plan.observation,
        statement_executor=timed_cursor.execute,
    )
    if type(locked) is not PrefixObservation or locked != plan.observation or locked.status != plan.branch:
        _deny("branch_mismatch")
    _assert_prefix_ledger(timed_cursor, plan.compiled)
    applied, data_root = _terminal_mutation_core(
        cursor, compiled=plan.compiled, branch=plan.branch,
        initial_data_root_reader=lambda: probe_full_data_root(
            timed_cursor, plan.reference, statement_executor=timed_cursor.execute),
        terminal_data_root_reader=lambda: _source_full_data_root(
            timed_cursor, expected_data_root, deadline_monotonic=deadline_monotonic),
        expected_initial_data_root=plan.reference.full_data_sha256,
        expected_terminal_data_root=expected_data_root,
        deadline_monotonic=deadline_monotonic,
    )
    terminal = _terminal_readback(timed_cursor, repository_root=plan.repository_root,
                                  manifest=plan.manifest,
                                  terminal_spec_root=plan.terminal_spec_root)
    if (terminal["catalog_root"] != expected_catalog_root
            or terminal["acl_root"] != expected_acl_root
            or terminal["ledger_root"] != expected_ledger_root
            or data_root != expected_data_root
            or terminal["terminal_spec"] != plan.terminal_spec_root):
        _deny("terminal_mismatch")
    payload = {
        "branch": plan.branch, "target_fingerprint": plan.reference.target_fingerprint,
        "source_commit": plan.source.final_commit, "source_root": plan.source.runtime_source_root,
        "reference_receipt_sha256": plan.reference.receipt_sha256,
        "classification_sha256": plan.observation.classification_sha256,
        "authorization_sha256": authorization_sha256,
        "attempt_receipt_sha256": attempt_receipt_sha256,
        "applied_statement_count": applied, "terminal_rows": _TERMINAL_ROWS,
        "terminal_catalog_root": terminal["catalog_root"],
        "terminal_acl_root": terminal["acl_root"], "terminal_ledger_root": terminal["ledger_root"],
        "terminal_spec_root": terminal["terminal_spec"], "terminal_data_root": data_root,
    }
    return ExecutorEvidence(**payload, evidence_sha256=hashlib.sha256(canonical_bytes(payload)).hexdigest())


def apply_locked_cursor(cursor: Any, *, plan: RecoveryExecutionPlan, attempt: AttemptStarted,
                        deadline_monotonic: float) -> ExecutorEvidence:
    """Apply a production plan after exact one-shot attempt authorization."""
    preflight_deadline(deadline_monotonic)
    attempt = _validate_attempt(plan, attempt)
    return _apply_mutation_locked_cursor(
        cursor, plan=plan, expected_data_root=plan.authorization.target_data_root,
        authorization_sha256=plan.authorization.authorization_sha256,
        attempt_receipt_sha256=attempt.receipt_sha256,
        expected_catalog_root=plan.authorization.target_catalog_root,
        expected_acl_root=plan.authorization.target_acl_root,
        expected_ledger_root=plan.authorization.target_ledger_root,
        deadline_monotonic=deadline_monotonic,
    )


__all__ = ["DerivedTerminalExpectation", "ExecutionDenial", "ExecutorEvidence",
           "RecoveryExecutionPlan", "RehearsalExecutionPlan", "SourceValidationPlan",
           "apply_locked_cursor", "build_execution_plan", "build_source_validation_plan",
           "compile_branch_plan", "preflight_deadline"]
