"""Behavioral private-seam coverage of the G040 controller orchestration."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import g040_production_controller as controller

H = "a" * 64


def obs(status="UNAPPLIED", data=None):
    value = dict(status=status, target_fingerprint=H, final_commit="b" * 40, runtime_source_root="c" * 64,
        reference_receipt_sha256="d" * 64, observation_nonce="nonce_0123456789", ledger_prefix_sha256="e" * 64,
        catalog_sha256="f" * 64, data_sha256=data, classification_sha256="0" * 64)
    value["classification_sha256"] = controller._hash({k: v for k, v in value.items() if k != "classification_sha256"})
    return controller.prefix.PrefixObservation(**value)


class G040CrossModuleContractTests(unittest.TestCase):
    def test_bindings_preserve_absent_sentinel_and_full_escaped_data_exactly(self):
        source = SimpleNamespace(final_commit="b" * 40, runtime_source_root="c" * 64)
        reference = SimpleNamespace(base_commit="d" * 40, manifest_sha256=H, migration_source_sha256=H,
            ledger_prefix_sha256=H, full_catalog_sha256=H, probe_text_sha256=H, target_fingerprint=H)
        custody = controller.RecoveryCustody(*([H] * 9))
        migrations = tuple(SimpleNamespace(version=str(i), name="m", sha256=H) for i in range(20))
        manifest = SimpleNamespace(migrations=migrations)
        unapplied = controller._bindings(source, reference, obs(), custody, manifest, H)
        full = controller._bindings(source, reference, obs("FULL_ESCAPED", H), custody, manifest, H)
        self.assertEqual(unapplied["selected_branch"], "execute-00400-then-suffix")
        self.assertEqual(unapplied["starting_data_root"], controller._ABSENT_DATA_ROOT)
        self.assertEqual(full["selected_branch"], "adopt-00400-vector-then-suffix")
        self.assertEqual(full["starting_data_root"], H)
        self.assertEqual(set(unapplied), set(full))

    def test_prepare_writes_flat_exact_authority_template(self):
        source = SimpleNamespace(final_commit="b" * 40, runtime_source_root="c" * 64)
        reference = SimpleNamespace(base_commit="d" * 40, manifest_sha256=H, migration_source_sha256=H,
            ledger_prefix_sha256=H, full_catalog_sha256=H, probe_text_sha256=H, target_fingerprint=H)
        custody = controller.RecoveryCustody(*([H] * 9)); manifest = SimpleNamespace(migrations=tuple(SimpleNamespace(version=str(i), name="m", sha256=H) for i in range(20)))
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "authority.json"; args = Namespace(repository_root=root, authority_template=path)
            with patch.object(controller, "_source", return_value=source), patch.object(controller, "_reference", return_value=reference), patch.object(controller, "_load_observation", return_value=(obs(), H)), patch.object(controller, "_custody", return_value=custody), patch.object(controller, "validate_sources", return_value=manifest), patch.object(controller, "_outside", return_value=path), patch.object(controller.authority, "_fsync_directory"):
                result = controller.prepare(args)
            template = json.loads(path.read_text("ascii"))
        self.assertEqual(result["status"], "prepared")
        self.assertEqual(set(template), set(controller.authority._FIELDS))
        self.assertNotIn("body", template); self.assertEqual(template["prefix_classification"], "UNAPPLIED")

    def test_expired_authority_is_denied_after_prepared_intent_before_one_shot_marker(self):
        source = SimpleNamespace(final_commit="b" * 40, runtime_source_root="c" * 64)
        reference = SimpleNamespace(receipt_sha256=H, target_fingerprint=H)
        verified = SimpleNamespace(
            target_fingerprint=H,
            expires_at=0,
            authorization_sha256=H,
            target_ledger_root=H,
            target_catalog_root=H,
            target_data_root=H,
            terminal_root=H,
        )
        plan = SimpleNamespace(branch="execute-00400-then-suffix", terminal_spec_root=H, reference=reference, authorization=verified)
        cursor = SimpleNamespace(execute=lambda _: None, close=lambda: None)
        connection = SimpleNamespace(cursor=lambda: cursor, close=lambda: None, rollback=lambda: None, commit=lambda: None)
        args = Namespace(repository_root="/checkout", prepared_receipt="/prepared", final_receipt="/final")
        with patch.object(controller, "_source", return_value=source), patch.object(controller, "_reference", return_value=reference), patch.object(controller, "_load_observation", return_value=(obs(), H)), patch.object(controller, "_custody", return_value=object()), patch.object(controller, "validate_sources", return_value=object()), patch.object(controller, "_bindings", return_value={}), patch.object(controller, "_authorization", return_value=verified), patch.object(controller, "build_execution_plan", return_value=plan), patch.object(controller, "_outside", side_effect=[Path("/prepared"), Path("/final")]), patch.object(controller, "_connect_service", return_value=connection), patch.object(controller, "_require_live_target"), patch.object(controller, "_write_signed", return_value=H), patch.object(controller.authority, "consume_one_shot_attempt") as consume:
            with self.assertRaisesRegex(controller.ControllerError, "authority_expired"): controller.execute(args)
        consume.assert_not_called()

    def test_readback_requires_signed_prepared_intent_and_untampered_spent_marker(self):
        source = SimpleNamespace(final_commit="b" * 40)
        verified = SimpleNamespace(target_ledger_root=H, target_catalog_root=H, target_data_root=H, terminal_root=H,
            target_fingerprint=H, authorization_sha256=H, prefix_state_receipt_sha256=H, observation_receipt_sha256=H,
            authorization_id="id", attempt_id="attempt", runtime_source_root="c" * 64)
        prepared = {"source_commit": source.final_commit, "target_fingerprint": H, "reference_receipt_sha256": H,
            "classification_sha256": H, "observation_receipt_sha256": H, "authorization_sha256": H,
            "expected_roots": {"ledger": H, "catalog": H, "data": H, "terminal": H}, "plan_sha256": H}
        marker = {"authorization_sha256": H, "target_fingerprint": H, "runtime_source_root": "c" * 64,
            "prefix_state_receipt_sha256": H, "observation_receipt_sha256": H, "receipt_sha256": "tampered"}
        args = Namespace(repository_root="/checkout", authorization="/auth", authorization_signature="/sig", prepared_receipt="/prepared", journal_dir="/journal", final_receipt="/final")
        envelope = object()
        with patch.object(controller, "_source", return_value=source), patch.object(controller, "validate_sources", return_value=object()), patch.object(controller.authority, "authenticate_recovery_authorization", return_value=envelope), patch.object(controller.authority, "verify_outcome_authorization", return_value=verified), patch.object(controller, "_stable_bytes", return_value=b"prepared"), patch.object(controller, "_outside", return_value=Path("/prepared")), patch.object(controller, "_signed_document", return_value=prepared), patch.object(controller.authority, "_journal_parent", return_value=Path("/journal")), patch.object(controller.authority, "_decode", return_value=marker), patch.object(controller, "_outcome_readback") as outcome:
            with self.assertRaisesRegex(controller.ControllerError, "outcome_anchor"): controller.readback(args)
        outcome.assert_not_called()
    def test_outcome_readback_passes_g037_a_utc_deadline_under_a_monotonic_statement_budget(self):
        source = SimpleNamespace(final_commit="b" * 40, runtime_source_root="c" * 64)
        authorization = SimpleNamespace(target_fingerprint=H, target_catalog_root=H, target_ledger_root=H, target_data_root=H, terminal_root=H)
        calls = []
        native = SimpleNamespace(
            execute=lambda sql: calls.append(sql),
            close=lambda: None,
            fetchall=lambda: [],
            description=(),
        )
        connection = SimpleNamespace(cursor=lambda: native, rollback=lambda: None, close=lambda: None)
        terminal = {"catalog_root": H, "acl_root": H, "ledger_root": H, "terminal_spec": H}
        data = {"classes_count": 1, "exact_seed_count": 1, "seed_rows_exact": 1, "class_source_count": 1, "legal_hold_count": 1, "work_item_count": 1, "retained_record_count": 1, "run_count": 1, "run_item_count": 1, "runtime_tables_empty": 1, "seed_projection_sha256": H, "data_shape_sha256": H}
        def assert_terminal(cur, root, manifest, *, deadline):
            self.assertEqual(deadline, 230)
            cur.execute("SELECT terminal")
            return terminal
        args = Namespace(repository_root="/checkout")
        with patch.object(controller, "_connect_service", return_value=connection), \
                patch.object(controller.prefix, "begin_read_only_snapshot"), \
                patch.object(controller, "_require_live_target"), \
                patch.object(controller, "terminal_readback_assert", side_effect=assert_terminal), \
                patch.object(controller.prefix, "_row", return_value=data), \
                patch.object(controller.time, "monotonic", return_value=100), \
                patch.object(controller.time, "time", return_value=200):
            controller._outcome_readback(args, source, object(), authorization)
        self.assertEqual(calls, ["SET LOCAL statement_timeout = '30000ms'", "SELECT terminal"])


if __name__ == "__main__": unittest.main()
