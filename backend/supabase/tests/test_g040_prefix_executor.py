"""Offline contract tests for the canonical G040 locked cursor executor."""
from __future__ import annotations

import sys
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
import g040_prefix_executor as executor
from g037_hosted_closure_contract import BASELINE_PAIRS, Manifest, Migration
from g040_prefix_recovery import Denial, PrefixObservation
from g040_recovery_authorization import AttemptStarted, VerifiedAuthorization
from g040_recovery_source import SourceBinding
from g040_reference_evidence import VerifiedReference

H = "a" * 64
COMMIT = "b" * 40
ROOT = Path("C:/pinned")
SPEC = "c" * 64
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


class Cursor:
    def __init__(self, *, fail_at=None):
        self.calls = []
        self.ledger_rows = []
        self.fail_at = fail_at

    def execute(self, sql, params=()):
        self.calls.append((sql, params))
        if self.fail_at == len(self.calls):
            raise RuntimeError("provider target=secret")

    def fetchone(self):
        return ("off",)

    def fetchall(self):
        return self.ledger_rows

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
        if sql != executor._STATEMENT_TIMEOUT_SQL:
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
    source = SourceBinding(final_commit=COMMIT, runtime_source_root=H)
    reference = VerifiedReference(
        schema="g040-prefix-reference-v1",
        base_commit=COMMIT,
        final_commit=COMMIT,
        runtime_source_root=H,
        manifest_sha256=H,
        migration_source_sha256=H,
        pg_identity="PostgreSQL 17.6",
        probe_text_sha256=H,
        absent_catalog_sha256=H,
        full_catalog_sha256=H,
        full_data_sha256=H,
        ledger_prefix_sha256=H,
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
        reference_public_key_sha256=H,
        signature_b64="sig",
        receipt_sha256="d" * 64,
    )
    observation = PrefixObservation(
        status=branch,
        target_fingerprint=reference.target_fingerprint,
        final_commit=source.final_commit,
        runtime_source_root=source.runtime_source_root,
        reference_receipt_sha256=reference.receipt_sha256,
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
        base_commit=COMMIT,
        runtime_source_root=source.runtime_source_root,
        manifest_root=H,
        source_root=H,
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
        with patch.object(executor, "validate_sources", return_value=m), patch.object(executor, "terminal_spec", return_value=SPEC), patch.object(executor, "_compiled", return_value=vectors), patch.object(executor, "classify_mutation_cursor", return_value=locked or observation) as classify, patch.object(executor, "probe_full_data_root", return_value=authorization.target_data_root), patch.object(executor, "terminal_readback_assert", return_value=terminal):
            plan = executor.build_execution_plan(ROOT, m, source=source, reference=reference, observation=observation, authorization=authorization)
            result = executor.apply_locked_cursor(cursor, plan=plan, attempt=attempt, deadline_monotonic=time.monotonic() + 60)
        return result, cursor, vectors, classify

    def test_timeout_refresh_uses_parameterized_set_config_with_bounded_decimal_milliseconds(self):
        clock = FakeClock()
        cursor = Cursor()
        with patch.object(executor.time, "monotonic", clock.monotonic):
            executor._execute(cursor, "target-statement", deadline_monotonic=1.0)
            self.assertEqual(
                cursor.calls,
                [
                    (executor._STATEMENT_TIMEOUT_SQL, ("999",)),
                    ("target-statement", ()),
                ],
            )
            self.assertEqual(
                executor._remaining_milliseconds(executor._MAX_STATEMENT_TIMEOUT_MILLISECONDS + 2.0),
                str(executor._MAX_STATEMENT_TIMEOUT_MILLISECONDS),
            )

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
                (executor._STATEMENT_TIMEOUT_SQL, ("999",)),
                ("nested-first", ()),
                (executor._STATEMENT_TIMEOUT_SQL, ("999",)),
                ("nested-second", ("parameter",)),
            ],
        )
    def test_unapplied_executes_stripped_00400_once_then_ledgers_full_vector(self):
        result, cursor, vectors, _ = self.invoke()
        sql = [call[0] for call in cursor.calls]
        self.assertEqual(sql.count("00400-inner"), 1)
        inserts = [call for call in cursor.calls if call[0].startswith("INSERT INTO")]
        self.assertEqual(inserts[0][1][2], list(vectors[16][1]))
        self.assertEqual([params[0] for _, params in inserts], [item.version for item, _, _ in vectors[16:]])
        self.assertEqual(result.terminal_rows, 40)
        self.assertEqual(result.applied_statement_count, sum(len(executable) for _, _, executable in vectors[16:]))
        with self.assertRaises(Exception):
            result.branch = "FULL_ESCAPED"

    def test_full_escaped_executes_zero_00400_sql_and_ledgers_full_vector(self):
        _, cursor, vectors, _ = self.invoke("FULL_ESCAPED")
        sql = [call[0] for call in cursor.calls]
        self.assertNotIn("00400-inner", sql)
        self.assertFalse(any(statement in vectors[16][1] for statement in sql))
        self.assertEqual([params[0] for sql, params in cursor.calls if sql.startswith("INSERT INTO")], [item.version for item, _, _ in vectors[16:]])

    def test_locks_precede_reclassification_and_executor_never_controls_transaction(self):
        cursor = Cursor()
        seen = []
        source, reference, observation, authorization, attempt = artifacts("FULL_ESCAPED")
        m = manifest(); vectors = compiled(m)
        cursor.ledger_rows = [(version, name, (f"base-{index}",)) for index, (version, name) in enumerate(BASELINE_PAIRS)] + [(item.version, item.name, full) for item, full, _ in vectors[:16]]
        def locked(*_args, **_kwargs):
            seen.extend(sql for sql, _ in cursor.calls)
            return observation
        with patch.object(executor, "validate_sources", return_value=m), patch.object(executor, "terminal_spec", return_value=SPEC), patch.object(executor, "_compiled", return_value=vectors), patch.object(executor, "classify_mutation_cursor", side_effect=locked), patch.object(executor, "probe_full_data_root", return_value=authorization.target_data_root), patch.object(executor, "terminal_readback_assert", return_value={"catalog_root": authorization.target_catalog_root, "acl_root": H, "ledger_root": authorization.target_ledger_root, "terminal_spec": SPEC}):
            plan = executor.build_execution_plan(ROOT, m, source=source, reference=reference, observation=observation, authorization=authorization)
            executor.apply_locked_cursor(cursor, plan=plan, attempt=attempt, deadline_monotonic=time.monotonic() + 60)
        lock_calls = [
            sql
            for sql in seen
            if sql in executor._LOCK_SQL or sql in executor._DATA_LOCK_SQL
        ]
        self.assertEqual(lock_calls, list(executor._LOCK_SQL + executor._DATA_LOCK_SQL))
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
                (executor._STATEMENT_TIMEOUT_SQL, ("999",)),
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


if __name__ == "__main__":
    unittest.main()
