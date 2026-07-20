"""Behavioral private-seam coverage of the G040 controller orchestration."""
from __future__ import annotations

import ast
import json
import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import g035_hosted_recovery as recovery
import g037_production_controller as g037_controller
import g037_remediation_authorization as remediation
import g040_clone_rehearsal as rehearsal
import g040_production_controller as controller
import g040_recovery_source as source
from g040_reference_evidence import DERIVATION_MODE, REVERSE_VECTOR_SHA256

H = "a" * 64
def digest(label):
    return controller._hash({"semantic_fixture": label})


def obs(status="UNAPPLIED", data=None):
    value = dict(status=status, target_fingerprint=H, final_commit="b" * 40, runtime_source_root="c" * 64,
        reference_receipt_sha256="d" * 64, derivation_mode=DERIVATION_MODE,
        reverse_vector_sha256=REVERSE_VECTOR_SHA256, observation_nonce="nonce_0123456789",
        ledger_prefix_sha256="e" * 64, catalog_sha256="f" * 64, data_sha256=data,
        classification_sha256="0" * 64)
    value["classification_sha256"] = controller._hash({k: v for k, v in value.items() if k != "classification_sha256"})
    return controller.prefix.PrefixObservation(**value)
def full_data(**overrides):
    value = {
        "classes_count": 10,
        "exact_seed_count": 10,
        "seed_rows_exact": True,
        "class_source_count": 0,
        "legal_hold_count": 0,
        "work_item_count": 0,
        "retained_record_count": 0,
        "run_count": 0,
        "run_item_count": 0,
        "runtime_tables_empty": True,
        "seed_projection_sha256": H,
        "data_shape_sha256": H,
    }
    value.update(overrides)
    return value


class G040CrossModuleContractTests(unittest.TestCase):
    def test_bindings_preserve_absent_sentinel_and_full_escaped_data_exactly(self):
        source = SimpleNamespace(final_commit="b" * 40, runtime_source_root="c" * 64)
        reference = SimpleNamespace(base_commit="d" * 40, manifest_sha256=H, migration_source_sha256=H,
            ledger_prefix_sha256=H, full_catalog_sha256=H, probe_text_sha256=H, target_fingerprint=H)
        custody = controller.RecoveryCustody(
            target_fingerprint=H, freeze_root=H, freeze_expires_at=1, target_acl_root=H,
            backup_receipt_sha256=H, capture_receipt_sha256=H, archive_sha256=H, archive_bytes=1,
            clone_rehearsal_receipt_sha256=H, inventory_root=H, target_ledger_root=H,
            target_catalog_root=H, target_data_root=H,
            expires_at=2,
        )
        migrations = tuple(SimpleNamespace(version=str(i), name="m", sha256=H) for i in range(20))
        manifest = SimpleNamespace(migrations=migrations)
        unapplied = controller._bindings(source, reference, obs(), custody, manifest, H)
        full = controller._bindings(source, reference, obs("FULL_ESCAPED", H), custody, manifest, H)
        self.assertEqual(unapplied["selected_branch"], "execute-00400-then-suffix")
        self.assertEqual(unapplied["starting_data_root"], controller._ABSENT_DATA_ROOT)
        self.assertEqual(full["selected_branch"], "adopt-00400-vector-then-suffix")
        self.assertEqual(full["starting_data_root"], H)
        self.assertEqual(set(unapplied), set(full))
    def test_runtime_source_boundaries_require_production_verification(self):
        binding = SimpleNamespace(final_commit="b" * 40, runtime_source_root="c" * 64)
        with patch.object(source, "verify_recovery_source", return_value=binding) as g035_verify, \
                patch.object(controller, "verify_recovery_source", return_value=binding) as controller_verify, \
                patch.object(rehearsal, "verify_recovery_source", return_value=binding) as rehearsal_verify:
            self.assertEqual(recovery._recovery_source_binding(Path("/checkout"), binding.final_commit)["repository_commit"], binding.final_commit)
            self.assertIs(controller._source(Namespace(repository_root="/checkout", source_commit=binding.final_commit)), binding)
            self.assertIs(rehearsal._source("/checkout", binding.final_commit), binding)
        for verifier in (g035_verify, controller_verify, rehearsal_verify):
            verifier.assert_called_once_with(unittest.mock.ANY, binding.final_commit, production=True)

    def test_source_contract_rejects_omitted_or_downgraded_production_mode_and_matches_runbook(self):
        root = Path(__file__).resolve().parents[3]
        sources = (
            root / "backend/supabase/scripts/g035_hosted_recovery.py",
            root / "backend/supabase/scripts/g040_production_controller.py",
            root / "backend/supabase/scripts/g040_clone_rehearsal.py",
        )
        for path in sources:
            with self.subTest(path=path.name):
                calls = [
                    node for node in ast.walk(ast.parse(path.read_text("utf-8")))
                    if isinstance(node, ast.Call)
                    and ((isinstance(node.func, ast.Name) and node.func.id == "verify_recovery_source")
                         or (isinstance(node.func, ast.Attribute) and node.func.attr == "verify_recovery_source"))
                ]
                self.assertEqual(len(calls), 1)
                self.assertEqual(
                    [(keyword.arg, getattr(keyword.value, "value", None)) for keyword in calls[0].keywords],
                    [("production", True)],
                )
        runbook = (root / "backend/supabase/docs/g040-prefix-recovery-runbook.md").read_text("utf-8")
        self.assertIn("python3 -I", runbook)
        self.assertIn('git show "$AUTHORIZED_COMMIT":backend/supabase/scripts/g040_isolated_bootstrap.py | python3 -I -', runbook)

    def test_controller_authorization_calls_are_path_only_and_root_bounded(self):
        path = Path(controller.__file__)
        tree = ast.parse(path.read_text("utf-8"))
        expected = {
            "authenticate_recovery_authorization": (
                ["args.authorization", "args.authorization_signature"],
                ("repository_root", "_root(args)"),
            ),
            "authenticate_outcome_authorization": (
                ["args.authorization", "args.authorization_signature"],
                ("repository_root", "_root(args)"),
            ),
        }
        for function_name, (arguments, required_keyword) in expected.items():
            calls = [
                node for node in ast.walk(tree)
                if isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == function_name
            ]
            self.assertEqual(len(calls), 1)
            self.assertEqual([ast.unparse(argument) for argument in calls[0].args], arguments)
            self.assertIn(required_keyword, [
                (keyword.arg, ast.unparse(keyword.value)) for keyword in calls[0].keywords
            ])

    def test_authorization_loader_passes_only_authorization_paths_with_repository_root(self):
        args = Namespace(repository_root="/checkout", authorization="/authority", authorization_signature="/signature")
        bindings = {"bound": H}
        envelope, verified = object(), object()
        with patch.object(controller.authority, "authenticate_recovery_authorization", return_value=envelope) as authenticate, \
                patch.object(controller.authority, "reverify_destructive_stage", return_value=verified) as reverify:
            self.assertIs(controller._authorization(args, bindings), verified)
        authenticate.assert_called_once_with("/authority", "/signature", expected_bindings=bindings,
                                            repository_root=Path("/checkout").resolve())
        reverify.assert_called_once_with(envelope, expected_bindings=bindings)
    def test_execute_and_readback_link_fresh_proof_receipts_into_final_receipts(self):
        tree = ast.parse(Path(controller.__file__).read_text("utf-8"))
        functions = {node.name: node for node in tree.body if isinstance(node, ast.FunctionDef)}
        for name in ("execute", "readback"):
            calls = [
                node for node in ast.walk(functions[name])
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "_write_proof"
            ]
            self.assertEqual(len(calls), 1)
            self.assertEqual([ast.unparse(argument) for argument in calls[0].args], [
                "args", "source", "reference", "manifest", "verified", "readback" if name == "execute" else "value",
            ])
        self.assertEqual(Path(controller.__file__).read_text("utf-8").count('"proof_receipt_sha256": proof_hash'), 4)
    def test_prepare_writes_flat_exact_authority_template(self):
        source = SimpleNamespace(final_commit="b" * 40, runtime_source_root=digest("runtime-source-root"))
        reference = SimpleNamespace(base_commit="d" * 40, manifest_sha256=digest("manifest-root"), migration_source_sha256=digest("migration-source-root"),
            ledger_prefix_sha256=digest("prefix-root"), full_catalog_sha256=digest("projection-root"), probe_text_sha256=digest("probe-root"), target_fingerprint=digest("target-fingerprint"))
        custody = controller.RecoveryCustody(
            target_fingerprint=digest("custody-target"), freeze_root=digest("custody-freeze"),
            freeze_expires_at=2, target_acl_root=digest("custody-acl"),
            backup_receipt_sha256=digest("custody-backup"), capture_receipt_sha256=digest("custody-capture"),
            archive_sha256=digest("custody-archive"), archive_bytes=1,
            clone_rehearsal_receipt_sha256=digest("custody-rehearsal"),
            inventory_root=digest("custody-inventory"), target_ledger_root=digest("custody-ledger"),
            target_catalog_root=digest("custody-catalog"), target_data_root=digest("custody-data"),
            expires_at=3,
        )
        manifest = SimpleNamespace(migrations=tuple(SimpleNamespace(version=str(i), name="m", sha256=digest(f"migration-{i}")) for i in range(20)))
        observation = obs()
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as outside:
            path = Path(outside) / "authority.json"; args = Namespace(repository_root=root, authority_template=path)
            with patch.object(controller, "_source", return_value=source), patch.object(controller, "_reference", return_value=reference), patch.object(controller, "_load_observation", return_value=(observation, digest("observation-receipt"))), patch.object(controller, "_custody", return_value=custody), patch.object(controller, "validate_sources", return_value=manifest), patch.object(controller, "_outside", return_value=path), patch.object(controller.authority, "_fsync_directory") as fsync:
                result = controller.prepare(args)
            self.assertEqual(fsync.call_count, 2)
            prepared_bindings = json.loads(path.read_text("ascii"))
            with patch.object(controller.authority, "_windows_restrictive", return_value=True):
                admitted_bindings = controller.authority._bindings_from_path(path, root)
        bindings = controller._bindings(source, reference, observation, custody, manifest, digest("observation-receipt"))
        self.assertEqual(result["status"], "prepared")
        self.assertEqual(prepared_bindings, bindings)
        self.assertEqual(admitted_bindings, bindings)
        self.assertEqual(set(prepared_bindings), set(controller.authority._BINDINGS))
        self.assertEqual(prepared_bindings["prefix_classification"], "UNAPPLIED")

    def test_finalized_assertion_bytes_cross_g037_builder_and_g040_freeze_exactly(self):
        channels = ("no_owner_write", "no_dashboard_write", "no_provider_write", "no_out_of_band_write", "producer_stop")
        evidence = {channel: f"{channel}-evidence".encode("ascii") for channel in channels}
        request = {
            "schema": "g037-write-freeze-assertion-v1",
            "freeze_id": "freeze-0001",
            "origin": "https://abcdefghijklmnopqrst.supabase.co",
            "commit": "b" * 40,
            "manifest_sha256": "1" * 64,
            "relation_root": "2" * 64,
            "acl_root": "3" * 64,
            "source_root": "c" * 64,
            "terminal_spec": "4" * 64,
            "issued_at": 100,
            "expires_at": 200,
            "attestations": {channel: {"status": True, "evidence_sha256": __import__("hashlib").sha256(evidence[channel]).hexdigest(), "observed_at": 100} for channel in channels},
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            finalized = root / "finalized.json"
            def temporary(data, *_args, **_kwargs):
                path = root / "temporary"
                path.write_bytes(data)
                return path
            with patch.object(g037_controller, "_outside_fresh", side_effect=lambda path, _label: Path(path)), \
                    patch.object(g037_controller, "_fsync_directory"), \
                    patch.object(g037_controller, "_signed", return_value=request), \
                    patch.object(g037_controller.recovery, "_temporary_bytes", side_effect=temporary), \
                    patch.object(g037_controller.recovery, "_cleanup_temporary_files", side_effect=lambda path: Path(path).unlink(missing_ok=True)):
                g037_controller._write_finalized_assertion(finalized, request, b"signature")
            raw = finalized.read_bytes()
            self.assertEqual(remediation._read_operator_assertion(finalized), {**request, "signature": __import__("base64").b64encode(b"signature").decode("ascii")})
            args = Namespace(repository_root=directory, freeze_assertion=finalized, freeze_evidence=[root / channel for channel in channels])
            source_binding = SimpleNamespace(final_commit="b" * 40, runtime_source_root="c" * 64)
            def stable(path, _repository_root):
                candidate = Path(path)
                return raw if candidate == finalized else evidence[candidate.name]
            with patch.object(controller, "_outside", side_effect=lambda path, *_args, **_kwargs: Path(path)), \
                    patch.object(controller, "_stable_bytes", side_effect=stable), \
                    patch.object(controller, "validate_operator_assertion"), \
                    patch.object(controller, "terminal_spec", return_value="4" * 64), \
                    patch.object(controller.time, "time", return_value=100):
                freeze_root, _, _, _ = controller._backup_freeze(args, source_binding, object())
            self.assertEqual(freeze_root, __import__("hashlib").sha256(raw).hexdigest())
            for suffix in (b"\n", b"\r\n", b" "):
                finalized.write_bytes(raw + suffix)
                with self.assertRaises(remediation.ContractError):
                    remediation._read_operator_assertion(finalized)
                with patch.object(controller, "_outside", side_effect=lambda path, *_args, **_kwargs: Path(path)), \
                        patch.object(controller, "_stable_bytes", side_effect=lambda path, _root: finalized.read_bytes() if Path(path) == finalized else evidence[Path(path).name]):
                    with self.assertRaises(controller.ControllerError):
                        controller._backup_freeze(args, source_binding, object())

    def test_expired_authority_is_denied_by_custody_revalidation_before_one_shot_marker(self):
        source = SimpleNamespace(final_commit="b" * 40, runtime_source_root="c" * 64)
        reference = SimpleNamespace(receipt_sha256=H, target_fingerprint=H, expires_at_unix=1)
        verified = SimpleNamespace(
            target_fingerprint=H,
            expires_at=0,
            freeze_expires_at=1,
            authorization_sha256=H,
            target_ledger_root=H,
            target_catalog_root=H,
            target_acl_root=H,
            target_data_root=H,
            terminal_root=H,
        )
        plan = SimpleNamespace(branch="execute-00400-then-suffix", terminal_spec_root=H, reference=reference, authorization=verified)
        statements = []
        cursor = SimpleNamespace(execute=lambda sql: statements.append(sql), close=lambda: None)
        connection = SimpleNamespace(cursor=lambda: cursor, close=lambda: None, rollback=lambda: None, commit=lambda: None)
        args = Namespace(repository_root="/checkout", prepared_receipt="/prepared", final_receipt="/final")
        with patch.object(controller, "_source", return_value=source), patch.object(controller, "_reference", return_value=reference), patch.object(controller, "_load_observation", return_value=(obs(), H)), patch.object(controller, "_custody", return_value=SimpleNamespace(expires_at=1, freeze_expires_at=1)), patch.object(controller, "validate_sources", return_value=object()), patch.object(controller, "_bindings", return_value={}), patch.object(controller, "_authorization", return_value=verified), patch.object(controller, "build_execution_plan", return_value=plan), patch.object(controller, "_outside", side_effect=[Path("/prepared"), Path("/final")]), patch.object(controller, "_connect_service", return_value=connection), patch.object(controller, "_require_live_target"), patch.object(controller, "_write_signed", return_value=H) as write_signed, patch.object(controller.authority, "consume_one_shot_attempt") as consume:
            with self.assertRaisesRegex(controller.ControllerError, "authority_expired"): controller.execute(args)
        write_signed.assert_not_called()
        consume.assert_not_called()
        self.assertNotIn("BEGIN", statements)
        self.assertFalse(any("g040" in statement.lower() or "INSERT" in statement for statement in statements))

    def test_readback_marker_requires_complete_immutable_authority_binding(self):
        values = {name: digest(name) for name in ("target", "ledger", "catalog", "data", "terminal", "authorization", "signature", "bindings", "prefix-state", "observation")}
        verified = SimpleNamespace(
            authorization_id="00000000-0000-4000-8000-000000000001", attempt_id="00000000-0000-4000-8000-000000000002",
            issued_at=10, expires_at=20, target_fingerprint=values["target"], runtime_source_root=digest("runtime-source"),
            prefix_state_receipt_sha256=values["prefix-state"], observation_receipt_sha256=values["observation"],
            prefix_classification="UNAPPLIED", selected_branch="execute-00400-then-suffix",
            authorization_sha256=values["authorization"], signature_sha256=values["signature"], bindings_sha256=values["bindings"],
        )
        marker = {
            "schema": controller.authority.JOURNAL_SCHEMA, "event": "attempt-started",
            "authorization_id": verified.authorization_id, "attempt_id": verified.attempt_id, "at": 15,
            "target_fingerprint": verified.target_fingerprint, "runtime_source_root": verified.runtime_source_root,
            "prefix_state_receipt_sha256": verified.prefix_state_receipt_sha256, "observation_receipt_sha256": verified.observation_receipt_sha256,
            "prefix_classification": verified.prefix_classification, "selected_branch": verified.selected_branch,
            "authorization_sha256": verified.authorization_sha256, "signature_sha256": verified.signature_sha256,
            "bindings_sha256": verified.bindings_sha256,
        }
        marker["receipt_sha256"] = controller.authority.canonical_sha256(marker)
        self.assertEqual(controller._require_attempt_marker(marker, verified), marker)
        adversarial = []
        missing = dict(marker); del missing["signature_sha256"]; missing["receipt_sha256"] = controller.authority.canonical_sha256(missing); adversarial.append(missing)
        extra = dict(marker, injected=digest("injected")); extra["receipt_sha256"] = controller.authority.canonical_sha256({key: value for key, value in extra.items() if key != "receipt_sha256"}); adversarial.append(extra)
        for field, value in (("event", "other-event"), ("authorization_id", "00000000-0000-4000-8000-000000000003"), ("at", 21), ("prefix_classification", "FULL_ESCAPED"), ("selected_branch", "adopt-00400-vector-then-suffix"), ("signature_sha256", digest("other-signature")), ("bindings_sha256", digest("other-bindings"))):
            forged = dict(marker, **{field: value})
            forged["receipt_sha256"] = controller.authority.canonical_sha256({key: item for key, item in forged.items() if key != "receipt_sha256"})
            adversarial.append(forged)
        for forged in adversarial:
            with self.subTest(forged=forged):
                with self.assertRaisesRegex(controller.ControllerError, "outcome_anchor"):
                    controller._require_attempt_marker(forged, verified)
    def test_full_data_validator_rejects_false_flags_wrong_types_missing_seed_timestamps_runtime_rows_and_root_mismatches(self):
        cases = (
            ("false seed flag", full_data(seed_rows_exact=False), H),
            ("false runtime flag", full_data(runtime_tables_empty=False), H),
            ("boolean seed flag", full_data(seed_rows_exact=1), H),
            ("boolean count", full_data(classes_count=True), H),
            ("missing seed timestamp", full_data(exact_seed_count=9, seed_rows_exact=False), H),
            ("nonzero runtime table", full_data(run_count=1, runtime_tables_empty=False), H),
            ("expected root mismatch", full_data(), "b" * 64),
        )
        for label, data, expected_root in cases:
            with self.subTest(label=label):
                with self.assertRaisesRegex(controller.prefix.Denial, "partial_or_ambiguous|data_shape"):
                    controller.prefix.validate_full_data_root(data, expected_root)

    def test_outcome_readback_uses_the_normal_terminal_data_validator_under_the_same_deadline_budget(self):
        source = SimpleNamespace(final_commit="b" * 40, runtime_source_root="c" * 64)
        reference = SimpleNamespace()
        authorization = SimpleNamespace(target_fingerprint=H, target_catalog_root=H, target_ledger_root=H, target_acl_root=H, target_data_root=H, terminal_root=H)
        calls = []
        native = SimpleNamespace(
            execute=lambda sql: calls.append(sql),
            close=lambda: None,
            fetchall=lambda: [],
            fetchone=lambda: {"transaction_read_only": "on", "transaction_isolation": "repeatable read"},
            description=(),
        )
        connection = SimpleNamespace(cursor=lambda: native, rollback=lambda: None, close=lambda: None)
        terminal = {"catalog_root": H, "acl_root": H, "ledger_root": H, "terminal_spec": H}
        def assert_terminal(cur, root, manifest, *, deadline):
            self.assertEqual(deadline, 230)
            cur.execute("SELECT terminal")
            return terminal
        args = Namespace(repository_root="/checkout")
        with patch.object(controller, "_connect_service", return_value=connection), \
                patch.object(controller.prefix, "begin_read_only_snapshot"), \
                patch.object(controller, "_require_live_target"), \
                patch.object(controller, "terminal_readback_assert", side_effect=assert_terminal), \
                patch.object(controller.prefix, "probe_full_data_root", return_value=H) as validate_data, \
                patch.object(controller.time, "monotonic", return_value=100), \
                patch.object(controller.time, "time", return_value=200):
            controller._terminal_readback(args, source, reference, object(), authorization)
        validate_data.assert_called_once()
        self.assertIs(validate_data.call_args.args[1], reference)
        self.assertEqual(calls, [
            "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
            "SELECT current_setting('transaction_read_only', true) AS transaction_read_only, current_setting('transaction_isolation', true) AS transaction_isolation",
            "SET LOCAL lock_timeout = '5s'",
            "SET LOCAL statement_timeout = '30s'",
            "SET LOCAL idle_in_transaction_session_timeout = '35s'",
            "SET LOCAL search_path = pg_catalog, public",
            "SET LOCAL statement_timeout = '30000ms'",
            "SELECT terminal",
        ])


if __name__ == "__main__": unittest.main()
