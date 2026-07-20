#!/usr/bin/env python3
"""G040 locked prefix reconciliation; transaction outcome belongs to the controller."""
from __future__ import annotations

import hashlib
import math
import time
from dataclasses import dataclass
from typing import Any, Mapping
from pathlib import Path

from g037_hosted_closure_contract import BASELINE_PAIRS, Manifest, canonical_bytes, terminal_spec, validate_sources
from g037_hosted_closure_executor import ClosureError, terminal_readback_assert, vectors
from g040_prefix_recovery import Denial, PrefixObservation, SOURCE_COMMIT, TABLES, classify_mutation_cursor, probe_full_data_root
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
class _CloneAdmission:
    """Exact-type verifier result, deliberately not a caller supplied marker."""
    clone_identity: str
    clone_nonce: str
    target_fingerprint: str
    live_identity_sha256: str
    port: int


@dataclass(frozen=True)
class VerifiedCloneCapability:
    """Local-only clone admission bound to an observed PostgreSQL identity."""
    _admission: _CloneAdmission
    clone_identity: str
    clone_nonce: str
    target_fingerprint: str

    @classmethod
    def _admit(cls, *, clone_identity: str, clone_nonce: str, target_fingerprint: str,
               live_identity_sha256: str, port: int) -> "VerifiedCloneCapability":
        if (not isinstance(clone_nonce, str) or type(port) is not int or not 1 <= port <= 65535
                or any(type(value) is not str or len(value) != 64
                       for value in (clone_identity, target_fingerprint, live_identity_sha256))):
            _deny("clone_capability")
        admission = _CloneAdmission(clone_identity, clone_nonce, target_fingerprint,
                                    live_identity_sha256, port)
        return cls(admission, clone_identity, clone_nonce, target_fingerprint)


def admit_verified_clone(*, clone_identity: str, clone_nonce: str, target_fingerprint: str,
                         live_identity_sha256: str, port: int) -> VerifiedCloneCapability:
    """Create a capability only after the caller's clone verifier has checked custody."""
    return VerifiedCloneCapability._admit(
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
class _LocalExecutionAuthorization:
    target_data_root: str
    target_catalog_root: str = ""
    target_ledger_root: str = ""
    authorization_sha256: str = ""
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


def _execute(cursor: Any, sql: str, params: tuple[Any, ...] = (), *, deadline_monotonic: float | None = None, version: str | None = None, ordinal: int | None = None) -> None:
    try:
        if deadline_monotonic is not None:
            cursor.execute(_STATEMENT_TIMEOUT_SQL, (_remaining_milliseconds(deadline_monotonic),))
        cursor.execute(sql, params)
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
        result = tuple((str(version), str(name), tuple(statements)) for version, name, statements in rows)
    except Denial:
        raise
    except Exception:
        _deny("ledger_read")
    if any(not version or not name or any(type(statement) is not str or not statement.strip() for statement in statements) for version, name, statements in result):
        _deny("ledger_shape")
    return result


def _compiled(root: Path, manifest: Manifest) -> tuple[tuple[Any, tuple[str, ...], tuple[str, ...]], ...]:
    result = []
    seen_versions: set[str] = set()
    seen_vectors: set[tuple[str, ...]] = set()
    try:
        for item in manifest.migrations:
            full, executable = vectors(root, item)
            if not full or not executable:
                _deny("vector_empty")
            if item.version in seen_versions or full in seen_vectors:
                _deny("vector_duplicate")
            seen_versions.add(item.version)
            seen_vectors.add(full)
            result.append((item, full, executable))
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


def _validated_local_clone_identity(cursor: Any, capability: VerifiedCloneCapability) -> None:
    admission = capability._admission
    if (type(admission) is not _CloneAdmission
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


def apply_rehearsal_locked_cursor(cursor: Any, *, plan: RehearsalExecutionPlan,
                                  verified_clone_capability: VerifiedCloneCapability,
                                  deadline_monotonic: float) -> ExecutorEvidence:
    """Replay on an admitted local clone through the same locked mutation core."""
    if (type(plan) is not RehearsalExecutionPlan
            or type(verified_clone_capability) is not VerifiedCloneCapability
            or verified_clone_capability.target_fingerprint != plan.reference.target_fingerprint):
        _deny("clone_capability")
    _validated_local_clone_identity(cursor, verified_clone_capability)
    local_plan = RecoveryExecutionPlan(
        plan.repository_root, plan.manifest, plan.source, plan.reference, plan.observation,
        _LocalExecutionAuthorization(plan.reference.full_data_sha256), plan.branch,
        plan.compiled, plan.terminal_spec_root)
    return apply_locked_cursor(cursor, plan=local_plan, attempt=None,
                               deadline_monotonic=deadline_monotonic)


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


def apply_locked_cursor(cursor: Any, *, plan: RecoveryExecutionPlan, attempt: AttemptStarted | None,
                        deadline_monotonic: float) -> ExecutorEvidence:
    """Apply an admitted production or local plan in a caller-owned transaction."""
    preflight_deadline(deadline_monotonic)
    if attempt is None:
        if type(plan.authorization) is not _LocalExecutionAuthorization:
            _deny("attempt_type")
    else:
        attempt = _validate_attempt(plan, attempt)
    timed_cursor = _DeadlineCursor(cursor, deadline_monotonic)
    _execute(cursor, "SELECT current_setting('transaction_read_only', true)", deadline_monotonic=deadline_monotonic)
    try:
        state = cursor.fetchone()
    except Exception:
        _deny("transaction_state")
    if state not in (("off",), {"transaction_read_only": "off"}):
        _deny("not_read_write")
    for sql in _LOCK_SQL:
        _execute(cursor, sql, deadline_monotonic=deadline_monotonic)
    if plan.branch == "FULL_ESCAPED":
        for sql in _DATA_LOCK_SQL:
            _execute(cursor, sql, deadline_monotonic=deadline_monotonic)
    locked = classify_mutation_cursor(
        timed_cursor,
        plan.reference,
        expected_prior=plan.observation,
        statement_executor=timed_cursor.execute,
    )
    if type(locked) is not PrefixObservation or locked != plan.observation or locked.status != plan.branch:
        _deny("branch_mismatch")
    rows = _ledger(timed_cursor)
    expected_prefix = BASELINE_PAIRS + tuple((item.version, item.name) for item, _, _ in plan.compiled[:16])
    expected_vectors = tuple((item.version, item.name, full) for item, full, _ in plan.compiled[:16])
    if (len(rows) != _PREFIX_COUNT or tuple((version, name) for version, name, _ in rows) != expected_prefix
            or rows[len(BASELINE_PAIRS):] != expected_vectors
            or any(version == _V00400[0] for version, _, _ in rows)):
        _deny("ledger_conflict")
    v00400 = plan.compiled[16]
    applied = 0
    if plan.branch == "UNAPPLIED":
        for ordinal, statement in enumerate(v00400[2], start=1):
            _execute(cursor, statement, deadline_monotonic=deadline_monotonic, version=v00400[0].version, ordinal=ordinal)
            applied += 1
        for sql in _DATA_LOCK_SQL:
            _execute(cursor, sql, deadline_monotonic=deadline_monotonic)
    data_root = probe_full_data_root(
        timed_cursor,
        plan.reference,
        statement_executor=timed_cursor.execute,
    )
    if data_root != plan.authorization.target_data_root:
        _deny("terminal_data_mismatch")
    _insert(cursor, v00400[0], v00400[1], deadline_monotonic=deadline_monotonic)
    for item, full, executable in plan.compiled[17:]:
        for ordinal, statement in enumerate(executable, start=1):
            _execute(cursor, statement, deadline_monotonic=deadline_monotonic, version=item.version, ordinal=ordinal)
            applied += 1
        _insert(cursor, item, full, deadline_monotonic=deadline_monotonic)
    _deadline(deadline_monotonic)
    try:
        terminal = terminal_readback_assert(timed_cursor, plan.repository_root, plan.manifest)
    except Denial:
        raise
    except Exception:
        _deny("terminal_mismatch")
    required = {"catalog_root", "acl_root", "ledger_root", "terminal_spec"}
    if (type(terminal) is not dict or set(terminal) != required
            or (attempt is None and terminal["terminal_spec"] != plan.terminal_spec_root)
            or (attempt is not None and (
                terminal["catalog_root"] != plan.authorization.target_catalog_root
                or terminal["acl_root"] != plan.authorization.target_acl_root
                or terminal["ledger_root"] != plan.authorization.target_ledger_root
                or data_root != plan.authorization.target_data_root
                or terminal["terminal_spec"] != plan.authorization.terminal_root
            ))):
        _deny("terminal_mismatch")
    payload = {
        "branch": plan.branch, "target_fingerprint": plan.reference.target_fingerprint,
        "source_commit": plan.source.final_commit, "source_root": plan.source.runtime_source_root,
        "reference_receipt_sha256": plan.reference.receipt_sha256,
        "classification_sha256": plan.observation.classification_sha256,
        "authorization_sha256": plan.authorization.authorization_sha256,
        "attempt_receipt_sha256": "" if attempt is None else attempt.receipt_sha256, "applied_statement_count": applied,
        "terminal_rows": _TERMINAL_ROWS, "terminal_catalog_root": terminal["catalog_root"],
        "terminal_acl_root": terminal["acl_root"], "terminal_ledger_root": terminal["ledger_root"],
        "terminal_spec_root": terminal["terminal_spec"], "terminal_data_root": data_root,
    }
    return ExecutorEvidence(**payload, evidence_sha256=hashlib.sha256(canonical_bytes(payload)).hexdigest())


__all__ = ["ExecutionDenial", "ExecutorEvidence", "RecoveryExecutionPlan",
           "RehearsalExecutionPlan", "SourceValidationPlan", "VerifiedCloneCapability",
           "admit_verified_clone", "apply_locked_cursor", "apply_rehearsal_locked_cursor",
           "build_execution_plan", "build_source_validation_plan", "compile_branch_plan",
           "preflight_deadline"]
