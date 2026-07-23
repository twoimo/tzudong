"""Offline contract tests for the canonical G040 locked cursor executor."""
from __future__ import annotations

import hashlib
import json
import sys
import time
import os
import unittest
from dataclasses import FrozenInstanceError, replace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
import g040_prefix_executor as executor
from g037_hosted_closure_contract import BASELINE_PAIRS, Manifest, Migration
from g040_prefix_recovery import Denial, PrefixObservation
from g040_recovery_authorization import AttemptStarted, VerifiedAuthorization
from g040_recovery_source import SourceBinding
from g040_reference_evidence import DERIVATION_MODE, REVERSE_VECTOR_SHA256, SCHEMA as REFERENCE_SCHEMA, VerifiedReference

H = "a" * 64
COMMIT = "b" * 40
BASE_COMMIT = executor.SOURCE_COMMIT
ROOT = Path("C:/pinned") if os.name == "nt" else Path("/pinned")
SPEC = "c" * 64
RUNTIME_SOURCE_ROOT = "d" * 64
MANIFEST_ROOT = "e" * 64
MIGRATION_SOURCE_ROOT = "f" * 64
SUFFIX = (
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
READ_WRITE_SQL = "SELECT current_setting('transaction_read_only', true) AS transaction_read_only"
STATEMENT_TIMEOUT_SQL = "SELECT pg_catalog.set_config('statement_timeout', %s, true)"
LOCK_ORDER = (
    "SELECT pg_catalog.pg_advisory_xact_lock(6040, 400)",
    "LOCK TABLE supabase_migrations.schema_migrations IN ACCESS EXCLUSIVE MODE",
)
DATA_LOCK_ORDER = (
    "LOCK TABLE privacy_retention.privacy_retention_classes IN SHARE ROW EXCLUSIVE MODE",
    "LOCK TABLE privacy_retention.privacy_retention_class_sources IN SHARE ROW EXCLUSIVE MODE",
    "LOCK TABLE privacy_retention.privacy_legal_holds IN SHARE ROW EXCLUSIVE MODE",
    "LOCK TABLE privacy_retention.privacy_retention_work_items IN SHARE ROW EXCLUSIVE MODE",
    "LOCK TABLE privacy_retention.privacy_retained_records IN SHARE ROW EXCLUSIVE MODE",
    "LOCK TABLE privacy_retention.privacy_retention_runs IN SHARE ROW EXCLUSIVE MODE",
    "LOCK TABLE privacy_retention.privacy_retention_run_items IN SHARE ROW EXCLUSIVE MODE",
)
LEDGER_SQL = "SELECT version,name,statements FROM supabase_migrations.schema_migrations ORDER BY version,name"
LEDGER_INSERT_SQL = "INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES (%s,%s,%s)"



class Cursor:
    def __init__(self, *, fail_at=None, fail_sql=None, transaction_state=("off",)):
        self.calls = []
        self.ledger_rows = []
        self.fail_at = fail_at
        self.fail_sql = fail_sql
        self.transaction_state = transaction_state

    def execute(self, sql, params=()):
        self.calls.append((sql, params))
        if self.fail_at == len(self.calls) or sql == self.fail_sql:
            raise RuntimeError("provider target=secret")

    def fetchone(self):
        return self.transaction_state

    def fetchall(self):
        return self.ledger_rows

class DerivationCursor(Cursor):
    def __init__(self):
        super().__init__()
        self.fetchone_values = [
            ("off",),
            {"data_shape_sha256": H},
            {"identity_ok": True},
            {"data_shape_sha256": H},
        ]

    def fetchone(self):
        return self.fetchone_values.pop(0)
class CloneConnection:
    def __init__(self, cursor, port=55401):
        self._cursor = cursor
        self.info = SimpleNamespace(host="127.0.0.1", port=port)
        self.rollbacks = 0
        cursor.connection = self

    def cursor(self):
        return self._cursor

    def rollback(self):
        self.rollbacks += 1


class CloneDerivationCursor(DerivationCursor):
    def __init__(self, identity):
        super().__init__()
        self.fetchone_values = [
            identity,
            {"transaction_read_only": "off"},
            {"data_shape_sha256": H},
            {"identity_ok": True},
            {"data_shape_sha256": H},
        ]
        self.connection = None


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def monotonic(self):
        return self.now


class ExpiringCursor(Cursor):
    def __init__(self, clock):
        super().__init__()
        self.clock = clock

    def execute(self, sql, params=()):
        super().execute(sql, params)
        if sql != STATEMENT_TIMEOUT_SQL:
            self.clock.now = 1.0

def manifest():
    prefix = tuple(Migration(f"20260711{i:06d}", f"m{i}", f"m{i}.sql", f"{i:064x}") for i in range(16))
    recovery = Migration("20260712000400", "g010_retention_separation", "m16.sql", f"{16:064x}")
    suffix = tuple(Migration(version, name, f"m{index}.sql", f"{index + 17:064x}") for index, (version, name) in enumerate(SUFFIX))
    migrations = prefix + (recovery,) + suffix
    return Manifest(migrations, frozenset(), migrations[-1].version, migrations[-1].version)


def compiled(m):
    result = []
    for index, item in enumerate(m.migrations):
        full = (f"full-{index}-a", f"full-{index}-b")
        executable = full
        if index == 16:
            full, executable = ("BEGIN", "00400-inner", "COMMIT"), ("00400-inner",)
        result.append((item, full, executable))
    return tuple(result)


def artifacts(branch="UNAPPLIED"):
    source = SourceBinding(final_commit=COMMIT, runtime_source_root=RUNTIME_SOURCE_ROOT)
    reference = VerifiedReference(
        schema=REFERENCE_SCHEMA,
        base_commit=BASE_COMMIT,
        final_commit=COMMIT,
        runtime_source_root=RUNTIME_SOURCE_ROOT,
        manifest_sha256=MANIFEST_ROOT,
        migration_source_sha256=MIGRATION_SOURCE_ROOT,
        pg_identity="PostgreSQL 17.6",
        probe_text_sha256=H,
        absent_catalog_sha256=H,
        derivation_mode=DERIVATION_MODE,
        reverse_vector_sha256=REVERSE_VECTOR_SHA256,
        full_catalog_sha256=H,
        full_data_sha256=H,
        ledger_prefix_sha256=H,
        source_plan_sha256=H,
        terminal_rows=40,
        terminal_ledger_root="f" * 64,
        terminal_catalog_root="2" * 64,
        terminal_acl_root=H,
        terminal_data_root="4" * 64,
        terminal_spec_root=SPEC,
        terminal_tuple_sha256="dc5e91b742cef4647870e263c1defa5a63d482810102584e47a665bc123fdcac",
        target_fingerprint=H,
        observation_nonce="n" * 16,
        issued_at_unix=1,
        expires_at_unix=2,
        first_clone_identity="1" * 16,
        first_clone_nonce="2" * 16,
        first_live_identity_sha256="1" * 64,
        first_container_id_sha256="2" * 64,
        first_image_id_sha256="3" * 64,
        first_image_digest_sha256="4" * 64,
        first_endpoint_sha256="5" * 64,
        first_g035_restore_receipt_sha256="6" * 64,
        first_capture_receipt_sha256="7" * 64,
        first_restored_archive_sha256="8" * 64,
        first_capture_receipt_bytes_sha256="9" * 64,
        first_restore_receipt_bytes_sha256="a" * 64,
        first_lineage_attestation_sha256="b" * 64,
        first_lineage_signature_sha256="c" * 64,
        first_binding_receipt_sha256="1111111111111111111111111111111111111111111111111111111111111111",
        first_observation_receipt_sha256="2222222222222222222222222222222222222222222222222222222222222222",
        second_clone_identity="3" * 16,
        second_clone_nonce="4" * 16,
        second_live_identity_sha256="8" * 64,
        second_container_id_sha256="9" * 64,
        second_image_id_sha256="3" * 64,
        second_image_digest_sha256="4" * 64,
        second_endpoint_sha256="b" * 64,
        second_g035_restore_receipt_sha256="c" * 64,
        second_capture_receipt_sha256="7" * 64,
        second_restored_archive_sha256="8" * 64,
        second_capture_receipt_bytes_sha256="d" * 64,
        second_restore_receipt_bytes_sha256="e" * 64,
        second_lineage_attestation_sha256="f" * 64,
        second_lineage_signature_sha256="0" * 64,
        second_binding_receipt_sha256="3333333333333333333333333333333333333333333333333333333333333333",
        second_observation_receipt_sha256="4444444444444444444444444444444444444444444444444444444444444444",
        reference_public_key_sha256=H,
        receipt_sha256="d" * 64,
    )
    observation = PrefixObservation(
        status=branch,
        target_fingerprint=reference.target_fingerprint,
        final_commit=source.final_commit,
        runtime_source_root=source.runtime_source_root,
        reference_receipt_sha256=reference.receipt_sha256,
        derivation_mode=reference.derivation_mode,
        reverse_vector_sha256=reference.reverse_vector_sha256,
        observation_nonce=reference.observation_nonce,
        ledger_prefix_sha256=reference.ledger_prefix_sha256,
        catalog_sha256=reference.absent_catalog_sha256 if branch == "UNAPPLIED" else reference.full_catalog_sha256,
        data_sha256=None if branch == "UNAPPLIED" else reference.full_data_sha256,
        classification_sha256="e" * 64,
    )
    selected = "execute-00400-then-suffix" if branch == "UNAPPLIED" else "adopt-00400-vector-then-suffix"
    authorization = VerifiedAuthorization(
        schema="g040-prefix-recovery-authorization-v1",
        purpose="g040-prefix-recovery",
        policy="g040-exact-source-pinned-one-shot-v1",
        authorization_id="11111111-1111-4111-8111-111111111111",
        attempt_id="22222222-2222-4222-8222-222222222222",
        issued_at=1,
        expires_at=2,
        final_recovery_commit=source.final_commit,
        base_commit=BASE_COMMIT,
        runtime_source_root=source.runtime_source_root,
        manifest_root=MANIFEST_ROOT,
        source_root=MIGRATION_SOURCE_ROOT,
        terminal_root=SPEC,
        prefix_root=H,
        suffix_root=H,
        projection_root=H,
        probe_root=H,
        prefix_state_receipt_sha256=observation.classification_sha256,
        observation_receipt_sha256="9" * 64,
        prefix_classification=observation.status,
        target_fingerprint=reference.target_fingerprint,
        selected_branch=selected,
        backup_receipt_sha256=H,
        capture_receipt_sha256=reference.receipt_sha256,
        clone_rehearsal_receipt_sha256=H,
        freeze_root=H,
        inventory_root=H,
        freeze_expires_at=2,
        target_acl_root=H,
        archive_sha256=H,
        archive_bytes=1,
        starting_ledger_root=H,
        target_ledger_root="f" * 64,
        starting_catalog_root="1" * 64,
        target_catalog_root="2" * 64,
        starting_data_root="3" * 64,
        target_data_root="4" * 64,
        authorization_sha256="5" * 64,
        signature_sha256="6" * 64,
        bindings_sha256="7" * 64,
    )
    attempt = AttemptStarted(
        schema="g040-recovery-attempt-started-v1",
        event="attempt-started",
        authorization_id=authorization.authorization_id,
        attempt_id=authorization.attempt_id,
        at=1,
        target_fingerprint=authorization.target_fingerprint,
        runtime_source_root=authorization.runtime_source_root,
        prefix_state_receipt_sha256=authorization.prefix_state_receipt_sha256,
        observation_receipt_sha256=authorization.observation_receipt_sha256,
        prefix_classification=authorization.prefix_classification,
        selected_branch=authorization.selected_branch,
        authorization_sha256=authorization.authorization_sha256,
        signature_sha256=authorization.signature_sha256,
        bindings_sha256=authorization.bindings_sha256,
        receipt_sha256="8" * 64,
    )
    return source, reference, observation, authorization, attempt


class ExecutorTests(unittest.TestCase):
    def invoke(self, branch="UNAPPLIED", *, cursor=None, locked=None, terminal=None):
        m = manifest()
        source, reference, observation, authorization, attempt = artifacts(branch)
        vectors = compiled(m)
        cursor = cursor or Cursor()
        cursor.ledger_rows = [(version, name, (f"base-{index}",)) for index, (version, name) in enumerate(BASELINE_PAIRS)] + [(item.version, item.name, full) for item, full, _ in vectors[:16]]
        terminal = terminal or {"catalog_root": authorization.target_catalog_root, "acl_root": H, "ledger_root": authorization.target_ledger_root, "terminal_spec": SPEC}
        with patch.object(executor, "validate_sources", return_value=m), patch.object(executor, "terminal_spec", return_value=SPEC), patch.object(executor, "_compiled", return_value=vectors), patch.object(executor, "classify_mutation_cursor", return_value=locked or observation) as classify, patch.object(executor, "probe_full_data_root", return_value=reference.full_data_sha256), patch.object(executor, "_source_full_data_root", return_value=authorization.target_data_root), patch.object(executor, "terminal_readback_assert", return_value=terminal):
            plan = executor.build_execution_plan(ROOT, m, source=source, reference=reference, observation=observation, authorization=authorization)
            result = executor.apply_locked_cursor(cursor, plan=plan, attempt=attempt, deadline_monotonic=time.monotonic() + 60)
        return result, cursor, vectors, classify
    def build_plan(self, branch="UNAPPLIED"):
        m = manifest()
        source, reference, observation, authorization, attempt = artifacts(branch)
        vectors = compiled(m)
        with patch.object(executor, "validate_sources", return_value=m), patch.object(executor, "terminal_spec", return_value=SPEC), patch.object(executor, "_compiled", return_value=vectors):
            plan = executor.build_execution_plan(ROOT, m, source=source, reference=reference, observation=observation, authorization=authorization)
        return plan, attempt, observation, authorization, vectors

    def test_timeout_refresh_uses_parameterized_set_config_with_bounded_decimal_milliseconds(self):
        clock = FakeClock()
        cursor = Cursor()
        with patch.object(executor.time, "monotonic", clock.monotonic):
            executor._execute(cursor, "target-statement", deadline_monotonic=1.0)
            self.assertEqual(
                cursor.calls,
                [
                    (STATEMENT_TIMEOUT_SQL, ("999",)),
                    ("target-statement", ()),
                ],
            )
            self.assertEqual(
                executor._remaining_milliseconds(2147483649.0),
                "2147483647",
            )
    def test_compiled_plan_prepends_compatibility_to_canonical_transformed_vectors(self):
        migration_manifest = manifest()
        canonical = tuple(
            (item, (item.version,), (f"transformed-full-{item.version}",), (f"transformed-{item.version}",))
            for item in migration_manifest.migrations
        )
        with patch.object(executor, "_precompute_execution_plan", return_value=(canonical, object())) as canonical_plan, \
                patch.object(executor, "_compatibility_sql", side_effect=lambda version: (f"hook-{version}",)), \
                patch.object(executor, "_provider_vector_schema_sql", side_effect=lambda _version, statements: statements):
            compiled = executor._compiled(ROOT, migration_manifest)
        canonical_plan.assert_called_once_with(ROOT, migration_manifest)
        self.assertEqual(len(compiled), len(migration_manifest.migrations))
        for item, full, executable in compiled:
            self.assertEqual(full, (item.version,))
            self.assertEqual(executable, (f"hook-{item.version}", f"transformed-{item.version}"))

    def test_provider_vector_schema_transform_is_exact_and_fail_closed(self):
        source_02000 = (
            "before extensions.vector middle extensions.vector after",
            "extensions.vector extensions.vector " + executor._PROVIDER_OWNER_PREDICATE,
            executor._PROVIDER_EFFECTIVE_ACL_PREDICATE,
            executor._PROVIDER_PUBLIC_ACL_PREDICATE,
        )
        source_02400 = ("extensions.vector", "extensions.vector extensions.vector", "extensions.vector")
        self.assertEqual(
            executor._provider_vector_schema_sql("20260713002000", source_02000),
            tuple(
                statement.replace("extensions.vector", "public.vector")
                .replace(
                    executor._PROVIDER_OWNER_PREDICATE,
                    executor._PROVIDER_OWNER_REPLACEMENT,
                )
                .replace(
                    executor._PROVIDER_EFFECTIVE_ACL_PREDICATE,
                    executor._PROVIDER_EFFECTIVE_ACL_REPLACEMENT,
                )
                .replace(
                    executor._PROVIDER_PUBLIC_ACL_PREDICATE,
                    executor._PROVIDER_PUBLIC_ACL_REPLACEMENT,
                )
                for statement in source_02000
            ),
        )
        transformed = executor._provider_vector_schema_sql("20260713002000", source_02000)
        transformed_owner = transformed[1]
        self.assertIn("dependency.deptype = 'e'", transformed_owner)
        self.assertIn("extension.extname = 'vector'", transformed_owner)
        self.assertIn("extension_namespace.nspname = 'public'", transformed_owner)
        self.assertIn("pg_get_userbyid(extension.extowner) = 'supabase_admin'", transformed_owner)
        for acl_statement in transformed[2:]:
            self.assertIn("AND NOT (", acl_statement)
            self.assertIn(executor._PROVIDER_VECTOR_EXTENSION_MEMBER, acl_statement)
        self.assertEqual(
            executor._provider_vector_schema_sql("20260713002400", source_02400),
            tuple(statement.replace("extensions.vector", "public.vector") for statement in source_02400),
        )
        for version, statements in (
            ("20260713002000", (
                "extensions.vector " * 4,
                executor._PROVIDER_OWNER_PREDICATE,
                executor._PROVIDER_EFFECTIVE_ACL_PREDICATE,
            )),
            ("20260713002400", ("public.vector",)),
            ("20260713002300", ("extensions.vector",)),
            ("20260713002300", (executor._PROVIDER_OWNER_PREDICATE,)),
            ("20260713002300", (executor._PROVIDER_EFFECTIVE_ACL_PREDICATE,)),
        ):
            with self.subTest(version=version):
                with self.assertRaisesRegex(Denial, "vector_compile"):
                    executor._provider_vector_schema_sql(version, statements)
    def test_runtime_rpc_matrix_tracks_exact_vector_schema_transform(self):
        runtime = executor.g040_runtime_rpc_matrix()
        self.assertEqual(len(runtime), len(executor.STATIC_RPC_MATRIX))
        changed = tuple(
            (source, target)
            for source, target in zip(executor.STATIC_RPC_MATRIX, runtime, strict=True)
            if source != target
        )
        self.assertEqual(len(changed), 4)
        self.assertEqual(
            {source[0] for source, _ in changed},
            set(executor._G040_VECTOR_RPC_SIGNATURES),
        )
        for source, target in changed:
            self.assertEqual(source[1], target[1])
            self.assertEqual(
                target[0],
                source[0].replace(
                    "(uuid,extensions.vector,",
                    "(uuid,public.vector,",
                    1,
                ),
            )
        self.assertFalse(
            any(
                signature in executor._G040_VECTOR_RPC_SIGNATURES
                for signature, _ in runtime
            )
        )
    def test_empty_params_do_not_activate_psycopg_percent_placeholder_parsing(self):
        class StrictCursor:
            def __init__(self):
                self.calls = []

            def execute(self, *args):
                if len(args) == 2 and args[1] == () and "%" in args[0]:
                    raise ValueError("empty params activated placeholder parsing")
                self.calls.append(args)

        cursor = StrictCursor()
        executor._execute(cursor, "SELECT '100%'")
        self.assertEqual(cursor.calls, [("SELECT '100%'",)])

    def test_deadline_cursor_refreshes_timeout_before_every_nested_statement(self):
        clock = FakeClock()
        cursor = Cursor()
        timed = executor._DeadlineCursor(cursor, 1.0)
        with patch.object(executor.time, "monotonic", clock.monotonic):
            timed.execute("nested-first")
            timed.execute("nested-second", ("parameter",))
        self.assertEqual(
            cursor.calls,
            [
                (STATEMENT_TIMEOUT_SQL, ("999",)),
                ("nested-first", ()),
                (STATEMENT_TIMEOUT_SQL, ("999",)),
                ("nested-second", ("parameter",)),
            ],
        )
    def assert_complete_execution_order(self, branch, cursor, vectors):
        calls = [call for call in cursor.calls if call[0] != STATEMENT_TIMEOUT_SQL]
        expected_sql = [READ_WRITE_SQL, *LOCK_ORDER]
        if branch == "FULL_ESCAPED":
            expected_sql.extend(DATA_LOCK_ORDER)
        expected_sql.append(LEDGER_SQL)
        if branch == "UNAPPLIED":
            expected_sql.extend(vectors[16][2])
            expected_sql.extend(DATA_LOCK_ORDER)
        expected_sql.append(LEDGER_INSERT_SQL)
        for _, _, executable in vectors[17:]:
            expected_sql.extend(executable)
            expected_sql.append(LEDGER_INSERT_SQL)
        expected_sql.extend(executor._TERMINAL_DATA_PROBE_INSTALL)
        expected_sql.append(executor.ROLE_PROTOCOL_EPILOGUE.decode("ascii"))
        self.assertEqual([sql for sql, _ in calls], expected_sql)

        inserts = [params for sql, params in calls if sql == LEDGER_INSERT_SQL]
        expected_rows = [(item.version, item.name, list(full)) for item, full, _ in vectors[16:]]
        self.assertEqual(inserts, expected_rows)

    def test_unapplied_executes_stripped_00400_then_ledgers_matching_full_vectors(self):
        result, cursor, vectors, _ = self.invoke()
        self.assert_complete_execution_order("UNAPPLIED", cursor, vectors)
        self.assertEqual(result.terminal_rows, 40)
        self.assertEqual(result.applied_statement_count, sum(len(executable) for _, _, executable in vectors[16:]) + len(executor._TERMINAL_DATA_PROBE_INSTALL) + 1)
        with self.assertRaises(FrozenInstanceError):
            result.branch = "FULL_ESCAPED"

    def test_full_escaped_ledgers_matching_full_vectors_without_00400_sql(self):
        result, cursor, vectors, _ = self.invoke("FULL_ESCAPED")
        self.assert_complete_execution_order("FULL_ESCAPED", cursor, vectors)
        self.assertEqual(result.applied_statement_count, sum(len(executable) for _, _, executable in vectors[17:]) + len(executor._TERMINAL_DATA_PROBE_INSTALL) + 1)

    def test_terminal_probe_install_is_source_pinned_least_privilege_and_precedes_epilogue(self):
        create, owner, revoke, grant = executor._TERMINAL_DATA_PROBE_INSTALL
        self.assertIn(executor.TERMINAL_DATA_PROJECTION, create)
        self.assertIn("SECURITY DEFINER", create)
        self.assertIn("SET search_path = ''", create)
        self.assertIn("OWNER TO privacy_workflow_owner", owner)
        self.assertEqual(
            revoke,
            "REVOKE ALL ON FUNCTION privacy_retention.g040_terminal_data_probe() FROM PUBLIC, anon, authenticated, service_role, supabase_admin",
        )
        self.assertEqual(
            grant,
            "GRANT EXECUTE ON FUNCTION privacy_retention.g040_terminal_data_probe() TO postgres",
        )
        _, cursor, _, _ = self.invoke()
        sql = [statement for statement, _ in cursor.calls if statement != STATEMENT_TIMEOUT_SQL]
        self.assertLess(sql.index(grant), sql.index(executor.ROLE_PROTOCOL_EPILOGUE.decode("ascii")))
        self.assertIn("pg_catalog.aclexplode", executor.TERMINAL_DATA_IDENTITY_PROBE)
        self.assertIn("privacy_workflow_owner", executor.TERMINAL_DATA_IDENTITY_PROBE)

    def test_exact_locks_precede_reclassification_and_executor_never_controls_transaction(self):
        cursor = Cursor()
        seen = []
        source, reference, observation, authorization, attempt = artifacts("FULL_ESCAPED")
        m = manifest(); vectors = compiled(m)
        cursor.ledger_rows = [(version, name, (f"base-{index}",)) for index, (version, name) in enumerate(BASELINE_PAIRS)] + [(item.version, item.name, full) for item, full, _ in vectors[:16]]
        def locked(*_args, **_kwargs):
            seen.extend(sql for sql, _ in cursor.calls if sql != STATEMENT_TIMEOUT_SQL)
            return observation
        with patch.object(executor, "validate_sources", return_value=m), patch.object(executor, "terminal_spec", return_value=SPEC), patch.object(executor, "_compiled", return_value=vectors), patch.object(executor, "classify_mutation_cursor", side_effect=locked), patch.object(executor, "probe_full_data_root", return_value=reference.full_data_sha256), patch.object(executor, "_source_full_data_root", return_value=authorization.target_data_root), patch.object(executor, "terminal_readback_assert", return_value={"catalog_root": authorization.target_catalog_root, "acl_root": H, "ledger_root": authorization.target_ledger_root, "terminal_spec": SPEC}):
            plan = executor.build_execution_plan(ROOT, m, source=source, reference=reference, observation=observation, authorization=authorization)
            executor.apply_locked_cursor(cursor, plan=plan, attempt=attempt, deadline_monotonic=time.monotonic() + 60)
        self.assertEqual(seen, [READ_WRITE_SQL, *LOCK_ORDER, *DATA_LOCK_ORDER])
        self.assertFalse(any(sql.upper().startswith(("BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT")) for sql, _ in cursor.calls))

    def test_data_root_mismatch_denies_before_marker_insert(self):
        source, reference, observation, authorization, attempt = artifacts()
        m = manifest()
        vectors = compiled(m)
        cursor = Cursor()
        cursor.ledger_rows = [(version, name, (f"base-{index}",)) for index, (version, name) in enumerate(BASELINE_PAIRS)] + [(item.version, item.name, full) for item, full, _ in vectors[:16]]
        with patch.object(executor, "validate_sources", return_value=m), patch.object(executor, "terminal_spec", return_value=SPEC), patch.object(executor, "_compiled", return_value=vectors), patch.object(executor, "classify_mutation_cursor", return_value=observation), patch.object(executor, "probe_full_data_root", return_value="9" * 64):
            plan = executor.build_execution_plan(ROOT, m, source=source, reference=reference, observation=observation, authorization=authorization)
            with self.assertRaises(Denial) as error:
                executor.apply_locked_cursor(cursor, plan=plan, attempt=attempt, deadline_monotonic=time.monotonic() + 60)
        self.assertEqual(error.exception.code, "terminal_data_mismatch")
        self.assertFalse(any(sql.startswith("INSERT INTO") for sql, _ in cursor.calls))
    def test_branch_mismatch_stops_after_exact_locks_before_ledger_or_insert(self):
        plan, attempt, observation, _, _ = self.build_plan()
        cursor = Cursor()
        locked = PrefixObservation(**{**observation.__dict__, "status": "FULL_ESCAPED"})
        with patch.object(executor, "classify_mutation_cursor", return_value=locked):
            with self.assertRaises(Denial) as error:
                executor.apply_locked_cursor(cursor, plan=plan, attempt=attempt, deadline_monotonic=time.monotonic() + 60)
        self.assertEqual(error.exception.code, "branch_mismatch")
        self.assertEqual([sql for sql, _ in cursor.calls if sql != STATEMENT_TIMEOUT_SQL], [READ_WRITE_SQL, *LOCK_ORDER])
        self.assertFalse(any(sql == LEDGER_INSERT_SQL for sql, _ in cursor.calls))

    def test_read_only_transaction_stops_before_locks_or_insert(self):
        plan, attempt, _, _, _ = self.build_plan()
        cursor = Cursor(transaction_state=("on",))
        with self.assertRaises(Denial) as error:
            executor.apply_locked_cursor(cursor, plan=plan, attempt=attempt, deadline_monotonic=time.monotonic() + 60)
        self.assertEqual(error.exception.code, "not_read_write")
        self.assertEqual([sql for sql, _ in cursor.calls if sql != STATEMENT_TIMEOUT_SQL], [READ_WRITE_SQL])
        self.assertFalse(any(sql == LEDGER_INSERT_SQL for sql, _ in cursor.calls))
    def test_dict_row_transaction_state_requires_aliased_key(self):
        result, _, _, _ = self.invoke(cursor=Cursor(transaction_state={"transaction_read_only": "off"}))
        self.assertEqual(result.terminal_rows, 40)

        plan, attempt, _, _, _ = self.build_plan()
        cursor = Cursor(transaction_state={"current_setting": "off"})
        with self.assertRaises(Denial) as error:
            executor.apply_locked_cursor(cursor, plan=plan, attempt=attempt,
                                         deadline_monotonic=time.monotonic() + 60)
        self.assertEqual(error.exception.code, "not_read_write")
        self.assertEqual(
            [sql for sql, _ in cursor.calls if sql != STATEMENT_TIMEOUT_SQL],
            [READ_WRITE_SQL],
        )
    def test_ledger_accepts_exact_aliased_dict_rows(self):
        cursor = Cursor()
        cursor.ledger_rows = [
            {"version": "20260712000100", "name": "privacy", "statements": ["SELECT 1"]},
        ]
        self.assertEqual(
            executor._ledger(cursor),
            (("20260712000100", "privacy", ("SELECT 1",)),),
        )

    def test_ledger_rejects_wrong_or_hostile_mapping_shapes(self):
        class HostileRow(dict):
            pass

        for row in (
            {"version": "1", "name": "privacy", "statements": ["SELECT 1"], "extra": "x"},
            {"current_setting": "off"},
            HostileRow(version="1", name="privacy", statements=["SELECT 1"]),
        ):
            cursor = Cursor()
            cursor.ledger_rows = [row]
            with self.assertRaises(Denial) as error:
                executor._ledger(cursor)
            self.assertEqual(error.exception.code, "ledger_read")
    def test_terminal_tuple_adapter_uses_description_order_and_omits_empty_params(self):
        class Column:
            def __init__(self, name):
                self.name = name

        class DictCursor:
            description = (Column("version"), Column("name"))

            def __init__(self):
                self.calls = []

            def execute(self, *args):
                self.calls.append(args)

            def fetchall(self):
                return [{"name": "privacy", "version": "1"}]

            def fetchone(self):
                return {"name": "privacy", "version": "1"}

        cursor = DictCursor()
        adapter = executor._TupleRowCursor(cursor)
        adapter.execute("SELECT '100%'")
        self.assertEqual(cursor.calls, [("SELECT '100%'",)])
        self.assertEqual(adapter.fetchall(), [("1", "privacy")])
        self.assertEqual(adapter.fetchone(), ("1", "privacy"))

    def test_terminal_tuple_adapter_rejects_mapping_subclasses(self):
        class HostileRow(dict):
            pass

        class DictCursor:
            description = (("version",),)

            def fetchone(self):
                return HostileRow(version="1")

        with self.assertRaisesRegex(Denial, "terminal_row_shape"):
            executor._TupleRowCursor(DictCursor()).fetchone()

    def test_terminal_shape_rejects_nonexact_readback_fields_after_all_ledgers(self):
        plan, attempt, observation, authorization, vectors = self.build_plan()
        terminal = {
            "catalog_root": authorization.target_catalog_root,
            "acl_root": H,
            "ledger_root": authorization.target_ledger_root,
        }
        cursor = Cursor()
        cursor.ledger_rows = [(version, name, (f"base-{index}",)) for index, (version, name) in enumerate(BASELINE_PAIRS)] + [(item.version, item.name, full) for item, full, _ in vectors[:16]]
        with patch.object(executor, "classify_mutation_cursor", return_value=observation), patch.object(executor, "probe_full_data_root", return_value=plan.reference.full_data_sha256), patch.object(executor, "_source_full_data_root", return_value=authorization.target_data_root), patch.object(executor, "terminal_readback_assert", return_value=terminal):
            with self.assertRaises(Denial) as error:
                executor.apply_locked_cursor(cursor, plan=plan, attempt=attempt, deadline_monotonic=time.monotonic() + 60)
        self.assertEqual(error.exception.code, "terminal_mismatch")
        self.assertEqual([params for sql, params in cursor.calls if sql == LEDGER_INSERT_SQL], [(item.version, item.name, list(full)) for item, full, _ in vectors[16:]])

    def test_each_terminal_root_and_spec_mismatch_is_denied_after_all_ledgers(self):
        plan, attempt, observation, authorization, vectors = self.build_plan()
        expected_terminal = {
            "catalog_root": authorization.target_catalog_root,
            "acl_root": H,
            "ledger_root": authorization.target_ledger_root,
            "terminal_spec": SPEC,
        }
        for field, value in (
            ("catalog_root", "9" * 64),
            ("acl_root", "9" * 64),
            ("ledger_root", "9" * 64),
            ("terminal_spec", "9" * 64),
        ):
            with self.subTest(field=field):
                cursor = Cursor()
                cursor.ledger_rows = [(version, name, (f"base-{index}",)) for index, (version, name) in enumerate(BASELINE_PAIRS)] + [(item.version, item.name, full) for item, full, _ in vectors[:16]]
                terminal = {**expected_terminal, field: value}
                with patch.object(executor, "classify_mutation_cursor", return_value=observation), patch.object(executor, "probe_full_data_root", return_value=plan.reference.full_data_sha256), patch.object(executor, "_source_full_data_root", return_value=authorization.target_data_root), patch.object(executor, "terminal_readback_assert", return_value=terminal):
                    with self.assertRaises(Denial) as error:
                        executor.apply_locked_cursor(cursor, plan=plan, attempt=attempt, deadline_monotonic=time.monotonic() + 60)
                self.assertEqual(error.exception.code, "terminal_mismatch")
                self.assertEqual([params for sql, params in cursor.calls if sql == LEDGER_INSERT_SQL], [(item.version, item.name, list(full)) for item, full, _ in vectors[16:]])

    def test_provider_failure_is_sanitized_and_stops_before_marker_or_later_sql(self):
        plan, attempt, observation, authorization, vectors = self.build_plan()
        cursor = Cursor(fail_sql="00400-inner")
        cursor.ledger_rows = [(version, name, (f"base-{index}",)) for index, (version, name) in enumerate(BASELINE_PAIRS)] + [(item.version, item.name, full) for item, full, _ in vectors[:16]]
        with patch.object(executor, "classify_mutation_cursor", return_value=observation), patch.object(executor, "probe_full_data_root", return_value=plan.reference.full_data_sha256), patch.object(executor, "_source_full_data_root", return_value=authorization.target_data_root):
            with self.assertRaises(executor.ExecutionDenial) as error:
                executor.apply_locked_cursor(cursor, plan=plan, attempt=attempt, deadline_monotonic=time.monotonic() + 60)
        self.assertEqual(error.exception.code, "execution_failed")
        self.assertEqual(error.exception.evidence["version"], "20260712000400")
        self.assertEqual(error.exception.evidence["ordinal"], 1)
        self.assertNotIn("secret", str(error.exception))
        self.assertEqual(cursor.calls[-1][0], "00400-inner")
        self.assertFalse(any(sql == LEDGER_INSERT_SQL for sql, _ in cursor.calls))
    def test_lock_failure_has_bounded_exact_statement_identity(self):
        plan, attempt, observation, _, _ = self.build_plan()
        cursor = Cursor(fail_sql=executor._LOCK_SQL[1])
        with self.assertRaises(executor.ExecutionDenial) as error:
            executor.apply_locked_cursor(
                cursor,
                plan=plan,
                attempt=attempt,
                deadline_monotonic=time.monotonic() + 60,
            )
        self.assertEqual(error.exception.evidence, {
            "version": "g040-lock",
            "ordinal": 2,
            "statement_sha256": hashlib.sha256(
                executor._LOCK_SQL[1].encode("utf-8")
            ).hexdigest(),
        })
        self.assertEqual(str(error.exception), "execution_failed")
    def test_source_pin_drift_is_denied_before_compilation_or_cursor_mutation(self):
        m = manifest()
        source, reference, observation, authorization, _ = artifacts()
        mutations = (
            ("reference_final_commit", source, replace(reference, final_commit="9" * 40), observation, authorization),
            ("reference_base_commit", source, replace(reference, base_commit="9" * 40), observation, authorization),
            ("observation_final_commit", source, reference, replace(observation, final_commit="9" * 40), authorization),
            ("authorization_final_commit", source, reference, observation, replace(authorization, final_recovery_commit="9" * 40)),
            ("authorization_base_commit", source, reference, observation, replace(authorization, base_commit="9" * 40)),
            ("reference_runtime_source_root", source, replace(reference, runtime_source_root="9" * 64), observation, authorization),
            ("observation_runtime_source_root", source, reference, replace(observation, runtime_source_root="9" * 64), authorization),
            ("authorization_runtime_source_root", source, reference, observation, replace(authorization, runtime_source_root="9" * 64)),
            ("reference_manifest_root", source, replace(reference, manifest_sha256="9" * 64), observation, authorization),
            ("reference_migration_source_root", source, replace(reference, migration_source_sha256="9" * 64), observation, authorization),
            ("authorization_manifest_root", source, reference, observation, replace(authorization, manifest_root="9" * 64)),
            ("authorization_migration_source_root", source, reference, observation, replace(authorization, source_root="9" * 64)),
            ("authorization_terminal_source_spec", source, reference, observation, replace(authorization, terminal_root="9" * 64)),
        )
        for name, candidate_source, candidate_reference, candidate_observation, candidate_authorization in mutations:
            with self.subTest(name=name), patch.object(executor, "validate_sources", return_value=m), patch.object(executor, "terminal_spec", return_value=SPEC), patch.object(executor, "_compiled") as compile_vectors:
                cursor = Cursor()
                with self.assertRaises(Denial):
                    executor.build_execution_plan(
                        ROOT,
                        m,
                        source=candidate_source,
                        reference=candidate_reference,
                        observation=candidate_observation,
                        authorization=candidate_authorization,
                    )
                self.assertFalse(compile_vectors.called)
                self.assertEqual(cursor.calls, [])
    def test_plan_rejects_noncanonical_types_and_drift_before_cursor_or_marker(self):
        m = manifest(); source, reference, observation, authorization, _ = artifacts()
        with patch.object(executor, "validate_sources", return_value=m), patch.object(executor, "terminal_spec", return_value=SPEC), patch.object(executor, "_compiled") as compile_vectors:
            with self.assertRaises(Denial):
                executor.build_execution_plan(ROOT, m, source=object(), reference=reference, observation=observation, authorization=authorization)
            self.assertFalse(compile_vectors.called)
            with self.assertRaises(Denial):
                executor.build_execution_plan(ROOT, m, source=source, reference=reference, observation=observation, authorization=authorization.__class__(**{**authorization.__dict__, "target_fingerprint": "9" * 64}))

    def test_exact_prefix_vectors_attempt_and_terminal_mismatches_fail_without_transaction_control(self):
        source, reference, observation, authorization, attempt = artifacts(); m = manifest(); vectors = compiled(m)
        cursor = Cursor(); cursor.ledger_rows = [(version, name, (f"base-{index}",)) for index, (version, name) in enumerate(BASELINE_PAIRS)] + [(item.version, item.name, full) for item, full, _ in vectors[:16]]
        cursor.ledger_rows[-1] = (*cursor.ledger_rows[-1][:2], ("tampered",))
        with patch.object(executor, "validate_sources", return_value=m), patch.object(executor, "terminal_spec", return_value=SPEC), patch.object(executor, "_compiled", return_value=vectors):
            plan = executor.build_execution_plan(ROOT, m, source=source, reference=reference, observation=observation, authorization=authorization)
            with patch.object(executor, "classify_mutation_cursor", return_value=observation):
                with self.assertRaises(Denial) as error:
                    executor.apply_locked_cursor(cursor, plan=plan, attempt=attempt, deadline_monotonic=time.monotonic() + 60)
        self.assertEqual(error.exception.code, "ledger_conflict")
        self.assertFalse(any(sql.upper().startswith(("COMMIT", "ROLLBACK", "SAVEPOINT")) for sql, _ in cursor.calls))

    def test_nested_classification_statement_deadline_stops_before_next_sql(self):
        clock = FakeClock()
        cursor = ExpiringCursor(clock)
        timed = executor._DeadlineCursor(cursor, 1.0)
        with patch.object(executor.time, "monotonic", clock.monotonic):
            timed.execute("classification-first")
            with self.assertRaisesRegex(Denial, "deadline"):
                timed.execute("classification-second")
        self.assertEqual(
            cursor.calls,
            [
                (STATEMENT_TIMEOUT_SQL, ("999",)),
                ("classification-first", ()),
            ],
        )

    def test_terminal_readback_adapter_stops_before_next_sql(self):
        clock = FakeClock()
        cursor = ExpiringCursor(clock)
        timed = executor._DeadlineCursor(cursor, 1.0)

        def terminal_readback(cursor):
            cursor.execute("terminal-first")
            cursor.execute("terminal-second")

        with patch.object(executor.time, "monotonic", clock.monotonic):
            with self.assertRaisesRegex(Denial, "deadline"):
                terminal_readback(timed)
        self.assertIn("terminal-first", [sql for sql, _ in cursor.calls])
        self.assertNotIn("terminal-second", [sql for sql, _ in cursor.calls])
    def test_expired_deadline_and_attempt_reuse_are_denied(self):
        source, reference, observation, authorization, attempt = artifacts(); m = manifest(); vectors = compiled(m)
        with patch.object(executor, "validate_sources", return_value=m), patch.object(executor, "terminal_spec", return_value=SPEC), patch.object(executor, "_compiled", return_value=vectors):
            plan = executor.build_execution_plan(ROOT, m, source=source, reference=reference, observation=observation, authorization=authorization)
        with self.assertRaises(Denial) as error:
            executor.apply_locked_cursor(Cursor(), plan=plan, attempt=attempt, deadline_monotonic=time.monotonic() - 1)
        self.assertEqual(error.exception.code, "deadline")
        reused = AttemptStarted(**{**attempt.__dict__, "attempt_id": "33333333-3333-4333-8333-333333333333"})
        with self.assertRaises(Denial) as error:
            executor.apply_locked_cursor(Cursor(), plan=plan, attempt=reused, deadline_monotonic=time.monotonic() + 60)
        self.assertEqual(error.exception.code, "attempt_binding")


    def _clone_capability(self):
        identity = {
            "system_identifier": "system",
            "database_oid": "1",
            "database_name": "g035_local",
            "server_version": "17.6",
            "server_version_num": 170006,
        }
        encoded = json.dumps(identity, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")
        capability = executor._admit_verified_clone(
            clone_identity=H, clone_nonce="nonce", target_fingerprint=H,
            live_identity_sha256=hashlib.sha256(encoded).hexdigest(), port=55401,
        )
        return identity, capability

    def test_production_rejects_none_and_subclassed_attempt_or_plan_before_cursor_mutation(self):
        plan, attempt, _, _, _ = self.build_plan()
        class AttemptSubclass(AttemptStarted):
            pass
        class PlanSubclass(executor.RecoveryExecutionPlan):
            pass
        for candidate_plan, candidate_attempt in (
                (plan, None),
                (plan, AttemptSubclass(**attempt.__dict__)),
                (PlanSubclass(**plan.__dict__), attempt)):
            with self.subTest(attempt=type(candidate_attempt).__name__):
                cursor = Cursor()
                with self.assertRaises(Denial) as error:
                    executor.apply_locked_cursor(
                        cursor, plan=candidate_plan, attempt=candidate_attempt,
                        deadline_monotonic=time.monotonic() + 60,
                    )
                self.assertEqual(error.exception.code, "attempt_type")
                self.assertEqual(cursor.calls, [])

    def test_clone_authority_is_private_and_raw_or_subclassed_capabilities_are_denied(self):
        self.assertFalse(
            {"VerifiedCloneCapability", "admit_verified_clone",
             "apply_rehearsal_locked_cursor", "derive_clone_terminal_expectation"}
            & set(executor.__all__))
        self.assertFalse(any(
            hasattr(executor, name)
            for name in ("VerifiedCloneCapability", "admit_verified_clone",
                         "apply_rehearsal_locked_cursor",
                         "derive_clone_terminal_expectation")))
        identity, capability = self._clone_capability()
        forged = executor._VerifiedCloneCapability(
            capability._admission, capability.clone_identity, capability.clone_nonce,
            capability.target_fingerprint)
        class CapabilitySubclass(executor._VerifiedCloneCapability):
            pass
        for candidate in (forged, CapabilitySubclass(**capability.__dict__)):
            with self.subTest(candidate=type(candidate).__name__):
                with self.assertRaises(Denial) as error:
                    executor._validated_local_clone_identity(Cursor(), candidate)
                self.assertEqual(error.exception.code, "clone_capability")

    def test_rehearsal_never_enters_production_apply_path(self):
        m = manifest()
        source, reference, observation, _, _ = artifacts()
        vectors = compiled(m)
        identity, capability = self._clone_capability()
        cursor = Cursor()
        cursor.connection = SimpleNamespace(info=SimpleNamespace(host="127.0.0.1", port=55401))
        with patch.object(executor, "validate_sources", return_value=m), \
                patch.object(executor, "terminal_spec", return_value=SPEC), \
                patch.object(executor, "_compiled", return_value=vectors), \
                patch.object(executor, "_validated_local_clone_identity"), \
                patch.object(executor, "_apply_mutation_locked_cursor", return_value=object()) as core, \
                patch.object(executor, "apply_locked_cursor", side_effect=AssertionError("production path")):
            plan = executor.compile_branch_plan(ROOT, m, source=source, reference=reference,
                                               observation=observation)
            executor._apply_rehearsal_locked_cursor(
                cursor, plan=plan, verified_clone_capability=capability,
                deadline_monotonic=time.monotonic() + 60,
            )
        self.assertTrue(core.called)

    def test_clone_derivation_begins_verifies_and_always_rolls_back(self):
        m = manifest()
        source, _, _, authorization, _ = artifacts()
        vectors = compiled(m)
        identity, capability = self._clone_capability()
        cursor = CloneDerivationCursor(identity)
        connection = CloneConnection(cursor)
        cursor.ledger_rows = (
            [(version, name, (f"base-{index}",)) for index, (version, name) in enumerate(BASELINE_PAIRS)]
            + [(item.version, item.name, full) for item, full, _ in vectors[:16]]
        )
        terminal = {
            "catalog_root": authorization.target_catalog_root, "acl_root": H,
            "ledger_root": authorization.target_ledger_root, "terminal_spec": SPEC,
        }
        with patch.object(executor, "validate_sources", return_value=m), \
                patch.object(executor, "terminal_spec", return_value=SPEC), \
                patch.object(executor, "_compiled", return_value=vectors), \
                patch.object(executor, "validate_terminal_data_root", return_value=H), \
                patch.object(executor, "validate_full_data_root", return_value=H), \
                patch.object(executor, "terminal_readback_assert", return_value=terminal):
            plan = executor.build_source_validation_plan(ROOT, m, source=source)
            result = executor._derive_clone_terminal_expectation(
                connection, source_plan=plan, verified_clone_capability=capability,
                branch="UNAPPLIED", expected_initial_data_root=H,
                expected_terminal_data_root=H,
                deadline_monotonic=time.monotonic() + 60,
            )
        self.assertEqual(result.terminal_data_root, H)
        self.assertEqual(connection.rollbacks, 1)
        self.assertEqual([sql for sql, _ in cursor.calls if sql != STATEMENT_TIMEOUT_SQL][0], "BEGIN")
        self.assertIn(executor.TERMINAL_DATA_PROBE, [sql for sql, _ in cursor.calls])

    def test_clone_derivation_rejects_cursor_and_forged_capability_and_rolls_back_on_failure(self):
        m = manifest()
        source, _, _, authorization, _ = artifacts()
        vectors = compiled(m)
        identity, capability = self._clone_capability()
        cursor = CloneDerivationCursor(identity)
        connection = CloneConnection(cursor)
        cursor.ledger_rows = (
            [(version, name, (f"base-{index}",)) for index, (version, name) in enumerate(BASELINE_PAIRS)]
            + [(item.version, item.name, full) for item, full, _ in vectors[:16]]
        )
        with self.assertRaises(Denial):
            executor._derive_clone_terminal_expectation(
                cursor, source_plan=object(), verified_clone_capability=capability,
                branch="UNAPPLIED", expected_initial_data_root=H,
                expected_terminal_data_root=H,
                deadline_monotonic=time.monotonic() + 60,
            )
        forged = executor._VerifiedCloneCapability(
            capability._admission, capability.clone_identity, capability.clone_nonce,
            capability.target_fingerprint,
        )
        with patch.object(executor, "validate_sources", return_value=m), \
                patch.object(executor, "terminal_spec", return_value=SPEC), \
                patch.object(executor, "_compiled", return_value=vectors):
            plan = executor.build_source_validation_plan(ROOT, m, source=source)
            with self.assertRaises(Denial) as error:
                executor._derive_clone_terminal_expectation(
                    connection, source_plan=plan, verified_clone_capability=forged,
                    branch="UNAPPLIED", expected_initial_data_root=H,
                    expected_terminal_data_root=H,
                    deadline_monotonic=time.monotonic() + 60,
                )
        self.assertEqual(error.exception.code, "clone_capability")
        self.assertEqual(connection.rollbacks, 1)
        self.assertEqual([sql for sql, _ in cursor.calls if sql != STATEMENT_TIMEOUT_SQL][0], "BEGIN")
if __name__ == "__main__":
    unittest.main()
