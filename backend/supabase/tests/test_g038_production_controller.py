from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from argparse import Namespace
from contextlib import ExitStack, redirect_stderr
from pathlib import Path
from unittest.mock import Mock, call, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import g038_production_controller as controller

ROOT = Path(__file__).resolve().parents[3]
H = "a" * 64


class Cursor:
    def __init__(self, rows=None):
        self.calls = []; self.rows = list(rows or [])
    def execute(self, sql, params=()): self.calls.append((sql, params))
    def fetchone(self): return self.rows.pop(0)
    def fetchall(self): return [self.rows.pop(0)]
    def close(self): self.calls.append(("CLOSE", ()))


class ControllerTests(unittest.TestCase):
    def test_public_surface_is_fixed_target_and_has_no_g040_parameterization(self):
        self.assertEqual(controller.MODES, frozenset(("validate-source", "observe", "production-backup", "prepare", "execute", "readback")))
        base = ["observe", "--repository-root", "/checkout", "--source-commit", "b" * 40,
            "--source-receipt", "/source-receipt",
            "--predecessor-report", "/p", "--predecessor-final-receipt", "/f",
            "--predecessor-readback-receipt", "/r", "--service-file", "/s",
            "--service-name", "locked", "--observation-receipt", "/o"]
        for option in ("--target-fingerprint", "--g040-commit", "--database-url", "--journal-directory"):
            stream = io.StringIO()
            with redirect_stderr(stream), self.assertRaises(SystemExit): controller.main([*base, option, "secret"])
            self.assertNotIn("secret", stream.getvalue())
    def test_runbook_pins_non_authorizing_controller_recovery_and_ambiguity_handling(self):
        runbook = (
            Path(__file__).resolve().parents[1]
            / "docs/g038-account-deletion-successor-runbook.md"
        ).read_text(encoding="utf-8")
        self.assertIn("## Non-authorizing production controller recovery sequence", runbook)
        sequence = (
            "`g038_production_controller.py validate-source`",
            "`observe` read-only",
            "`production-backup`",
            "two genuinely separate disposable local clones",
            "Run `prepare`",
            "external, explicit, unexpired one-shot authorization",
            "Run `execute` exactly once",
            "`readback` mode as mandatory historical verification",
        )
        positions = [runbook.index(item) for item in sequence]
        self.assertEqual(positions, sorted(positions))
        for required in (
            "/var/lib/tzudong-recovery/g038-successor-attempt-journal",
            "~/.g038-successor/g038-receipt-signing-key.pem",
            "Maintain freeze continuity",
            "Retain the source-validation",
            "`commit_ambiguous_readback_only`",
            "do not roll back, rerun `execute`",
            "use only historical `readback`",
            "does not grant approval",
        ):
            self.assertIn(required, runbook)

    def test_predecessor_report_byte_tampering_is_rejected_before_json_or_receipts(self):
        args = Namespace(repository_root="/checkout", predecessor_report="/report")
        root = Path("/checkout")
        with patch.object(controller, "_root", return_value=root), patch.object(controller, "_outside", return_value=Path("/report")), \
                patch.object(controller, "_stable_bytes", return_value=b"tampered"), patch.object(controller, "_decode") as decode:
            with self.assertRaisesRegex(controller.ControllerError, "predecessor_report"): controller._predecessor(args)
        decode.assert_not_called()

    def test_fixed_g040_and_g038_receipt_keys_are_distinct_and_pinned(self):
        self.assertEqual(hashlib.sha256(controller._G040_PUBLIC_KEY_PEM.encode("ascii")).hexdigest(), controller._G040_PUBLIC_KEY_SHA256)
        self.assertEqual(hashlib.sha256(controller._RECEIPT_PUBLIC_KEY_PEM.encode("ascii")).hexdigest(), controller._RECEIPT_PUBLIC_KEY_SHA256)
        self.assertNotEqual(controller._G040_PUBLIC_KEY_PEM, controller._RECEIPT_PUBLIC_KEY_PEM)
        self.assertNotEqual(controller.authority.PUBLIC_KEY_PEM, controller._RECEIPT_PUBLIC_KEY_PEM)


    def test_validate_source_publishes_canonical_unsigned_provenance_without_key_access(self):
        source = type("S", (), {"final_commit": "b" * 40, "runtime_source_root": "1" * 64})()
        manifest = type("M", (), {
            "statement_vector_root": "4" * 64,
            "terminal_spec_root": "5" * 64,
        })()
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw) / "checkout"
            receipts = Path(raw) / "receipts"
            root.mkdir(mode=0o700)
            receipts.mkdir(mode=0o700)
            receipt = receipts / "receipt.json"
            provenance = {
                "GITHUB_REPOSITORY": controller._SOURCE_REPOSITORY,
                "GITHUB_REF": controller._SOURCE_REF,
                "GITHUB_WORKFLOW": controller._SOURCE_WORKFLOW,
                "GITHUB_SHA": source.final_commit,
                "GITHUB_WORKSPACE": os.fspath(root),
                "GITHUB_RUN_ID": "12345678901234567890",
                "GITHUB_RUN_ATTEMPT": "2",
            }
            args = Namespace(
                repository_root=root,
                source_commit=source.final_commit,
                source_receipt=receipt,
            )
            with patch.dict(os.environ, provenance, clear=True), \
                    patch.object(controller, "_source", return_value=source), \
                    patch.object(controller, "validate_sources", return_value=manifest), \
                    patch.object(controller, "_manifest_roots", return_value=("2" * 64, "3" * 64)), \
                    patch.object(controller, "_sign_receipt", side_effect=AssertionError("key accessed")), \
                    patch.object(controller.time, "time", return_value=1700000000):
                result = controller.validate_source(args)

            raw_receipt = receipt.read_bytes()
            value = json.loads(raw_receipt.decode("ascii"))
            self.assertEqual(raw_receipt, controller.canonical_json_bytes(value) + b"\n")
            self.assertEqual(set(value), {
                "schema", "status", "source_commit", "runtime_source_root",
                "manifest_root", "source_root", "vector_root", "terminal_spec_root",
                "selected_versions", "repository", "ref", "workflow", "run_id",
                "run_attempt", "artifact_name", "issued_at", "receipt_sha256",
            })
            self.assertEqual(value["schema"], "g038-source-validation-receipt-v2")
            self.assertEqual(value["status"], "source-valid")
            self.assertEqual(value["repository"], "twoimo/tzudong")
            self.assertEqual(value["ref"], "refs/heads/main")
            self.assertEqual(value["workflow"], controller._SOURCE_WORKFLOW)
            self.assertEqual(value["run_id"], int(provenance["GITHUB_RUN_ID"]))
            self.assertEqual(value["run_attempt"], int(provenance["GITHUB_RUN_ATTEMPT"]))
            self.assertEqual(value["artifact_name"], controller._SOURCE_ARTIFACT)
            unsigned = dict(value)
            self_hash = unsigned.pop("receipt_sha256")
            self.assertEqual(self_hash, controller.canonical_sha256(unsigned))
            self.assertEqual(result["receipt_sha256"], hashlib.sha256(raw_receipt).hexdigest())

    def test_source_receipt_loading_is_exact_duplicate_safe_and_self_hashed(self):
        source = type("S", (), {"final_commit": "b" * 40, "runtime_source_root": "1" * 64})()
        manifest = type("M", (), {
            "statement_vector_root": "4" * 64,
            "terminal_spec_root": "5" * 64,
        })()
        body = {
            "schema": controller._SOURCE_RECEIPT_SCHEMA,
            "status": "source-valid",
            "source_commit": source.final_commit,
            "runtime_source_root": source.runtime_source_root,
            "manifest_root": "2" * 64,
            "source_root": "3" * 64,
            "vector_root": manifest.statement_vector_root,
            "terminal_spec_root": manifest.terminal_spec_root,
            "selected_versions": list(controller.SELECTED_VERSIONS),
            "repository": controller._SOURCE_REPOSITORY,
            "ref": controller._SOURCE_REF,
            "workflow": controller._SOURCE_WORKFLOW,
            "run_id": 123,
            "run_attempt": 2,
            "artifact_name": controller._SOURCE_ARTIFACT,
            "issued_at": 1700000000,
        }
        body["receipt_sha256"] = controller.canonical_sha256(body)
        valid = controller.canonical_json_bytes(body) + b"\n"
        args = Namespace(repository_root="/checkout", source_receipt="/receipt")
        mutations = (
            {},
            {"repository": "fork/tzudong"},
            {"ref": "refs/pull/1/merge"},
            {"workflow": "other"},
            {"artifact_name": "other"},
            {"source_commit": "c" * 40},
            {"runtime_source_root": "6" * 64},
            {"manifest_root": "6" * 64},
            {"source_root": "6" * 64},
            {"vector_root": "6" * 64},
            {"terminal_spec_root": "6" * 64},
            {"selected_versions": list(reversed(controller.SELECTED_VERSIONS))},
            {"run_id": "123"},
            {"run_attempt": 0},
            {"issued_at": True},
            {"receipt_sha256": "0" * 64},
        )
        for mutation in mutations:
            changed = {**body, **mutation}
            raw = valid if not mutation else controller.canonical_json_bytes(changed) + b"\n"
            evidence = controller.SourceEvidence(hashlib.sha256(raw).hexdigest(), "7" * 64, "8" * 64, "9" * 64)
            with self.subTest(mutation=mutation), patch.object(controller, "_root", return_value=Path("/checkout")), \
                    patch.object(controller, "_outside", return_value=Path("/receipt")), \
                    patch.object(controller, "_stable_bytes", return_value=raw), \
                    patch.object(controller, "_manifest_roots", return_value=("2" * 64, "3" * 64)), \
                    patch.object(controller.time, "time", return_value=1700000000), \
                    patch.object(controller, "_verify_source_attestation", return_value=evidence) as verify:
                if mutation:
                    with self.assertRaisesRegex(controller.ControllerError, "source_receipt_invalid"):
                        controller._load_source_receipt(args, source, manifest)
                else:
                    self.assertEqual(controller._load_source_receipt(args, source, manifest), evidence)
                    verify.assert_called_once_with(args, Path("/checkout"), Path("/receipt"), hashlib.sha256(valid).hexdigest(), source.final_commit)
        missing = dict(body)
        del missing["artifact_name"]
        with patch.object(controller, "_root", return_value=Path("/checkout")), \
                patch.object(controller, "_outside", return_value=Path("/receipt")), \
                patch.object(controller, "_stable_bytes", return_value=controller.canonical_json_bytes(missing) + b"\n"), \
                patch.object(controller, "_manifest_roots", return_value=("2" * 64, "3" * 64)), \
                self.assertRaisesRegex(controller.ControllerError, "source_receipt_invalid"):
            controller._load_source_receipt(args, source, manifest)
        duplicate = valid.replace(b'{"artifact_name"', b'{"schema":"duplicate","artifact_name"', 1)
        with patch.object(controller, "_root", return_value=Path("/checkout")), \
                patch.object(controller, "_outside", return_value=Path("/receipt")), \
                patch.object(controller, "_stable_bytes", return_value=duplicate), \
                self.assertRaisesRegex(controller.ControllerError, "artifact_invalid"):
            controller._load_source_receipt(args, source, manifest)

    def test_source_provenance_fails_closed_on_absence_mismatch_and_noncanonical_ids(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw).resolve()
            valid = {
                "GITHUB_REPOSITORY": controller._SOURCE_REPOSITORY,
                "GITHUB_REF": controller._SOURCE_REF,
                "GITHUB_WORKFLOW": controller._SOURCE_WORKFLOW,
                "GITHUB_SHA": "b" * 40,
                "GITHUB_WORKSPACE": os.fspath(root),
                "GITHUB_RUN_ID": "123",
                "GITHUB_RUN_ATTEMPT": "1",
            }
            mutations = (
                {"GITHUB_REPOSITORY": ""},
                {"GITHUB_SHA": "a" * 40},
                {"GITHUB_WORKSPACE": os.fspath(root / "other")},
                {"GITHUB_RUN_ID": "0"},
                {"GITHUB_RUN_ID": "01"},
                {"GITHUB_RUN_ATTEMPT": "+1"},
            )
            for mutation in mutations:
                environment = {**valid, **mutation}
                with self.subTest(mutation=mutation), patch.dict(os.environ, environment, clear=True), \
                        self.assertRaisesRegex(controller.ControllerError, "source_provenance"):
                    controller._github_source_provenance(root, "b" * 40)

    def test_hosted_observation_rejects_cross_mode_source_receipt_substitution(self):
        source = type("S", (), {"final_commit": "b" * 40, "runtime_source_root": "1" * 64})()
        predecessor = type("P", (), {"report_sha256": controller.PREDECESSOR_REPORT_SHA256})()
        state = controller.LiveState(
            controller.EXACT_40, 40, "2" * 64, "3" * 64, "4" * 64, "5" * 64,
        )
        evidence = controller.SourceEvidence(H, "7" * 64, "8" * 64, "6" * 64)
        body = controller._observation_body(state, source, predecessor, evidence, issued_at=1000)
        args = Namespace(repository_root="/checkout", observation="/observation")
        with patch.object(controller, "_root", return_value=Path("/checkout")), \
                patch.object(controller, "_outside", return_value=Path("/observation")), \
                patch.object(controller, "_stable_bytes", return_value=b"signed"), \
                patch.object(controller, "_signed_document", return_value=body), \
                patch.object(controller.time, "time", return_value=1001):
            loaded, _ = controller._load_observation(args, source, evidence)
            self.assertEqual(loaded.source_validation_receipt_sha256, evidence.binding_sha256)
            substituted = controller.SourceEvidence(H, evidence.bundle_sha256, evidence.provenance_sha256, "9" * 64)
            with self.assertRaisesRegex(controller.ControllerError, "observation_invalid"):
                controller._load_observation(args, source, substituted)

    def test_signed_runtime_receipts_still_use_the_fixed_private_key_path(self):
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "receipt.json"
            with patch.object(controller, "_sign_receipt", return_value=b"s" * 64) as sign, \
                    patch.object(controller, "_publish_restrictive") as publish:
                controller._write_signed(path, "hosted-observation", {"status": "observed"}, repository_root=Path("/checkout"))
            sign.assert_called_once()
            self.assertEqual(sign.call_args.args[1], Path("/checkout"))
            document = json.loads(publish.call_args.args[1].decode("ascii"))
            self.assertEqual(document["schema"], controller.SCHEMA)
            self.assertEqual(document["kind"], "hosted-observation")
            self.assertEqual(document["signature_b64"], "c3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzc3Nzcw==")


    def test_exact_workflow_command_succeeds_on_fresh_detached_runner_without_signing_key(self):
        manifest = json.loads((ROOT / ".github/g038-account-deletion-successor.v1.json").read_text(encoding="ascii"))
        inventory = manifest["runtimeInventory"]
        with tempfile.TemporaryDirectory() as raw:
            temporary = Path(raw).resolve()
            checkout = temporary / "checkout"
            receipts = temporary / "receipts"
            home = temporary / "home"
            checkout.mkdir()
            receipts.mkdir(mode=0o700)
            home.mkdir(mode=0o700)

            subprocess.run(["git", "init", "-q", os.fspath(checkout)], check=True)
            subprocess.run(
                ["git", "-C", os.fspath(checkout), "fetch", "-q", "--no-tags",
                 os.fspath(ROOT), controller.PREDECESSOR_COMMIT],
                check=True,
            )
            subprocess.run(
                ["git", "-C", os.fspath(checkout), "checkout", "-q", "--detach", "FETCH_HEAD"],
                check=True,
            )
            for relative in inventory:
                destination = checkout / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / relative, destination)
            subprocess.run(
                ["git", "-C", os.fspath(checkout), "add", "--", *inventory],
                check=True,
            )
            subprocess.run(
                [
                    "git", "-C", os.fspath(checkout),
                    "-c", "user.name=G038 Source Test",
                    "-c", "user.email=g038-source-test@example.invalid",
                    "commit", "-q", "-m", "fresh runner source",
                ],
                check=True,
            )
            commit = subprocess.run(
                ["git", "-C", os.fspath(checkout), "rev-parse", "HEAD"],
                check=True, capture_output=True, text=True,
            ).stdout.strip()
            receipt = receipts / "receipt.json"
            environment = {
                **os.environ,
                "HOME": os.fspath(home),
                "GITHUB_REPOSITORY": controller._SOURCE_REPOSITORY,
                "GITHUB_REF": controller._SOURCE_REF,
                "GITHUB_WORKFLOW": controller._SOURCE_WORKFLOW,
                "GITHUB_SHA": commit,
                "GITHUB_WORKSPACE": os.fspath(checkout),
                "GITHUB_RUN_ID": "9876543210123456789",
                "GITHUB_RUN_ATTEMPT": "1",
            }
            command = [
                sys.executable,
                "-I",
                "backend/supabase/scripts/g038_isolated_bootstrap.py",
                "--repository-root", os.fspath(checkout),
                "--authorized-final-commit", commit,
                "--entrypoint", "backend/supabase/scripts/g038_production_controller.py",
                "validate-source",
                "--repository-root", os.fspath(checkout),
                "--source-commit", commit,
                "--source-receipt", os.fspath(receipt),
            ]
            completed = subprocess.run(
                command,
                cwd=checkout,
                env=environment,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertFalse((home / ".g038-successor").exists())
            result = json.loads(completed.stdout)
            self.assertEqual(result["status"], "source-valid")

            raw_receipt = receipt.read_bytes()
            value = json.loads(raw_receipt.decode("ascii"))
            self.assertEqual(raw_receipt, controller.canonical_json_bytes(value) + b"\n")
            self.assertNotIn("signature_b64", value)
            self.assertEqual(value["source_commit"], commit)
            self.assertEqual(value["run_id"], int(environment["GITHUB_RUN_ID"]))
            self.assertEqual(value["run_attempt"], int(environment["GITHUB_RUN_ATTEMPT"]))
            unsigned = dict(value)
            self.assertEqual(unsigned.pop("receipt_sha256"), controller.canonical_sha256(unsigned))
            self.assertEqual(result["receipt_sha256"], hashlib.sha256(raw_receipt).hexdigest())

    def test_controller_begins_one_repeatable_read_transaction(self):
        cursor = Cursor([{"transaction_read_only": "off", "transaction_isolation": "repeatable read"}])
        deadline = controller.time.monotonic() + 10
        controller._begin_controller_transaction(
            cursor, readonly=False, deadline_monotonic=deadline,
        )
        sql = [entry[0] for entry in cursor.calls]
        begin = "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ WRITE"
        self.assertEqual(sql.count(begin), 1)
        self.assertEqual(sql[0:3], ["SELECT pg_catalog.set_config('statement_timeout', %s, true)", begin, "SELECT pg_catalog.set_config('statement_timeout', %s, true)"])
        self.assertFalse(any(statement in {"COMMIT", "ROLLBACK"} for statement in sql))

    def test_controller_binds_exact_attempt_locally_and_forces_xid_assignment(self):
        verified = type("V", (), {
            "authorization_id": "authorization", "attempt_id": "attempt",
            "authorization_sha256": H, "signature_sha256": H, "bindings_sha256": H,
        })()
        attempt = type("A", (), {
            "authorization_id": "authorization", "attempt_id": "attempt",
            "authorization_sha256": H, "signature_sha256": H, "bindings_sha256": H,
            "receipt_sha256": H,
        })()
        binding = controller._transaction_attempt_binding(verified, attempt)
        cursor = Cursor([{"attempt_binding": binding, "transaction_id": "123"}])
        controller._bind_controller_transaction(
            cursor, verified, attempt,
            deadline_monotonic=controller.time.monotonic() + 10,
        )
        self.assertEqual(cursor.calls[0][0], "SELECT pg_catalog.set_config('statement_timeout', %s, true)")
        sql, params = cursor.calls[1]
        self.assertIn("set_config('g038.attempt_binding', %s, true)", sql)
        self.assertIn("pg_catalog.pg_current_xact_id()::text", sql)
        self.assertEqual(params, (binding,))

    def test_expired_deadline_blocks_setup_identity_and_binding_before_sql(self):
        cursor = Cursor()
        expired = controller.time.monotonic()
        with self.assertRaisesRegex(controller.SuccessorError, "deadline"):
            controller._begin_controller_transaction(
                cursor, readonly=False, deadline_monotonic=expired,
            )
        with self.assertRaisesRegex(controller.SuccessorError, "deadline"):
            controller._require_live_target(cursor, deadline_monotonic=expired)
        verified = type("V", (), {
            "authorization_id": "authorization", "attempt_id": "attempt",
            "authorization_sha256": H, "signature_sha256": H, "bindings_sha256": H,
        })()
        attempt = type("A", (), {
            "authorization_id": "authorization", "attempt_id": "attempt",
            "authorization_sha256": H, "signature_sha256": H,
            "bindings_sha256": H, "receipt_sha256": H,
        })()
        with self.assertRaisesRegex(controller.SuccessorError, "deadline"):
            controller._bind_controller_transaction(
                cursor, verified, attempt, deadline_monotonic=expired,
            )
        self.assertEqual(cursor.calls, [])

    def _execute_fixture(self):
        source = type("S", (), {"final_commit": "b" * 40, "runtime_source_root": H})()
        source_evidence = controller.SourceEvidence(H, "6" * 64, "7" * 64, H)
        freeze = type("F", (), {"issued_at": 900, "expires_at": 2000, "root": H})()
        backup = {"expires_at": 2000}
        verified = type("V", (), {
            "expires_at": 2000, "freeze_expires_at": 2000,
            "source_validation_receipt_sha256": H, "authorization_sha256": H,
            "target_ledger_root": H, "target_catalog_root": H,
            "target_acl_root": H, "target_data_root": H, "target_spec_sha256": H,
        })()
        material = (source, source_evidence, object(), object(), object(), H, freeze, backup, H, object(), H, {})
        return source, source_evidence, freeze, backup, verified, material

    def test_execute_requires_precommit_before_commit_and_postreadback_before_terminal(self):
        events = []; checkpoint_calls = []
        source, source_evidence, freeze, backup, verified, material = self._execute_fixture()
        conn = Mock(); conn.cursor.return_value = Mock()
        attempt = type("A", (), {"receipt_sha256": H})()
        evidence = type("E", (), {"evidence_sha256": H})()
        state = controller._terminal_state(verified)
        pre = type("C", (), {"receipt_sha256": "1" * 64, "continuity_epoch": 900,
            "state_sha256": controller.canonical_sha256(state), "checkpoint": "precommit"})()
        post = type("C", (), {"receipt_sha256": "2" * 64, "continuity_epoch": 900,
            "state_sha256": controller.canonical_sha256(state), "checkpoint": "postcommit-terminal-readback"})()
        def checkpoint(*args, **kwargs):
            events.append(kwargs["name"])
            checkpoint_calls.append(kwargs)
            return pre if kwargs["name"] == "precommit" else post
        conn.commit.side_effect = lambda: events.append("commit")
        args = Namespace(repository_root="/checkout", prepared_receipt="/prepared", final_receipt="/final",
            precommit_checkpoint_receipt="/pre", postcommit_checkpoint_receipt="/post",
            freeze_monitor_socket="/monitor")
        with patch.object(controller, "_prepare_material", return_value=material), \
                patch.object(controller, "_root", return_value=Path("/checkout")), \
                patch.object(controller, "_authorization", return_value=verified), \
                patch.object(controller, "compile_plan", return_value=object()), \
                patch.object(controller, "_outside", side_effect=[Path("/prepared"), Path("/final")]), \
                patch.object(controller, "preflight_checkpoint_path", side_effect=[Path("/pre"), Path("/post")]), \
                patch.object(controller, "_connect_service", return_value=conn), \
                patch.object(controller, "_begin_controller_transaction"), \
                patch.object(controller, "_bind_controller_transaction"), \
                patch.object(controller, "_require_live_target"), \
                patch.object(controller, "_load_backup", return_value=(backup, H)), \
                patch.object(controller, "_revalidate_backup_artifacts"), \
                patch.object(controller, "_prepared_body", return_value={}), \
                patch.object(controller, "_write_signed", return_value=H), \
                patch.object(controller.authority, "consume_one_shot_attempt", return_value=(attempt, evidence)), \
                patch.object(controller, "_checkpoint", side_effect=checkpoint), \
                patch.object(controller, "_terminal_readback", side_effect=lambda *a: events.append("readback") or state), \
                patch.object(controller, "_write_terminal", side_effect=lambda *a: events.append("terminal") or H), \
                patch.object(controller.time, "time", return_value=1000), \
                patch.object(controller.time, "monotonic", side_effect=[100, 101, 102]):
            result = controller.execute(args)
        self.assertEqual(events, ["precommit", "commit", "readback", "postcommit-terminal-readback", "terminal"])
        self.assertEqual(result["precommit_checkpoint_sha256"], pre.receipt_sha256)
        self.assertEqual(result["postcommit_checkpoint_sha256"], post.receipt_sha256)
        self.assertEqual(
            [(call["name"], call["continuity_epoch"], call["parent_sha"])
             for call in checkpoint_calls],
            [("precommit", freeze.issued_at, freeze.root),
             ("postcommit-terminal-readback", pre.continuity_epoch, pre.receipt_sha256)],
        )

    def test_precommit_denial_rolls_back_and_postcommit_denial_is_ambiguous(self):
        for deny_at, expected_rollback in (("precommit", True), ("postcommit-terminal-readback", False)):
            if True:
                source, source_evidence, freeze, backup, verified, material = self._execute_fixture()
                conn = Mock(); conn.cursor.return_value = Mock()
                attempt = type("A", (), {"receipt_sha256": H})()
                evidence = type("E", (), {"evidence_sha256": H})()
                state = controller._terminal_state(verified)
                pre = type("C", (), {"receipt_sha256": "1" * 64,
                    "continuity_epoch": freeze.issued_at,
                    "state_sha256": controller.canonical_sha256(state), "checkpoint": "precommit"})()
                def checkpoint(*args, **kwargs):
                    if kwargs["name"] == deny_at: raise controller.ControllerError("freeze_continuity")
                    return pre
                args = Namespace(repository_root="/checkout", prepared_receipt="/prepared", final_receipt="/final",
                    precommit_checkpoint_receipt="/pre", postcommit_checkpoint_receipt="/post",
                    freeze_monitor_socket="/monitor")
                with ExitStack() as stack:
                    stack.enter_context(patch.object(controller, "_prepare_material", return_value=material))
                    stack.enter_context(patch.object(controller, "_root", return_value=Path("/checkout")))
                    stack.enter_context(patch.object(controller, "_authorization", return_value=verified))
                    stack.enter_context(patch.object(controller, "compile_plan", return_value=object()))
                    stack.enter_context(patch.object(controller, "_outside", side_effect=[Path("/prepared"), Path("/final")]))
                    stack.enter_context(patch.object(controller, "preflight_checkpoint_path", side_effect=[Path("/pre"), Path("/post")]))
                    stack.enter_context(patch.object(controller, "_connect_service", return_value=conn))
                    stack.enter_context(patch.object(controller, "_begin_controller_transaction"))
                    stack.enter_context(patch.object(controller, "_bind_controller_transaction"))
                    stack.enter_context(patch.object(controller, "_require_live_target"))
                    stack.enter_context(patch.object(controller, "_load_backup", return_value=(backup, H)))
                    stack.enter_context(patch.object(controller, "_revalidate_backup_artifacts"))
                    stack.enter_context(patch.object(controller, "_prepared_body", return_value={}))
                    stack.enter_context(patch.object(controller, "_write_signed", return_value=H))
                    stack.enter_context(patch.object(controller.authority, "consume_one_shot_attempt", return_value=(attempt, evidence)))
                    stack.enter_context(patch.object(controller, "_checkpoint", side_effect=checkpoint))
                    stack.enter_context(patch.object(controller, "_terminal_readback", return_value=state))
                    stack.enter_context(patch.object(controller.time, "time", return_value=1000))
                    stack.enter_context(patch.object(controller.time, "monotonic", side_effect=[100, 101, 102]))
                    code = "freeze_continuity" if expected_rollback else "commit_ambiguous_readback_only"
                    try:
                        controller.execute(args)
                    except controller.ControllerError as exc:
                        self.assertEqual(str(exc), code)
                    else:
                        self.fail(f"expected {code}")
                self.assertEqual(bool(conn.rollback.called), expected_rollback)
                self.assertEqual(conn.commit.called, not expected_rollback)

    def test_terminal_receipt_binds_exact_continuity_evidence(self):
        observed = {"row_count": 42, "ledger_root": "1" * 64, "catalog_root": "2" * 64,
            "acl_root": "3" * 64, "data_root": "4" * 64, "terminal_spec_root": "5" * 64}
        source = type("S", (), {"final_commit": "b" * 40})()
        verified = type("V", (), {"authorization_id": "authorization", "attempt_id": "attempt",
            "source_validation_receipt_sha256": H, "authorization_sha256": H})()
        manifest = type("M", (), {"migrations": tuple(type("I", (), {
            "version": version, "sha256": str(index) * 64})()
            for index, version in enumerate(controller.SELECTED_VERSIONS, 1))})()
        checkpoint = type("C", (), {"receipt_sha256": "6" * 64,
            "continuity_epoch": 900,
            "checkpoint": "historical-terminal-readback", "freeze_root": "8" * 64,
            "parent_evidence_sha256": "9" * 64,
            "executor_evidence_sha256": "7" * 64,
            "state_sha256": controller.canonical_sha256(observed)})()
        captured = {}
        with patch.object(controller, "_root", return_value=Path("/checkout")), \
                patch.object(controller, "_write_signed",
                    side_effect=lambda _p, _k, body, **_kw: captured.update(body) or H):
            controller._write_terminal(Namespace(), source,
                controller.SourceEvidence(H, "a" * 64, "b" * 64, H),
                manifest, verified, H, H, observed, "7" * 64, "8" * 64, "9" * 64,
                900, checkpoint, "historical", Path("/final"))
        self.assertEqual(captured["readback_kind"], "historical")
        self.assertEqual(captured["terminal_state_sha256"], controller.canonical_sha256(observed))
        self.assertEqual(captured["executor_evidence_sha256"], "7" * 64)
        self.assertEqual(captured["static_freeze_root"], "8" * 64)
        self.assertEqual(captured["continuity_parent_sha256"], "9" * 64)
        self.assertEqual(captured["checkpoint_receipt_sha256"], "6" * 64)
        self.assertEqual(captured["checkpoint_name"], "historical-terminal-readback")
        self.assertEqual(captured["source_attestation_bundle_sha256"], "a" * 64)
        self.assertEqual(captured["verified_source_provenance_sha256"], "b" * 64)
        checkpoint.continuity_epoch = 901
        with patch.object(controller, "_root", return_value=Path("/checkout")), \
                self.assertRaisesRegex(controller.ControllerError, "freeze_continuity"):
            controller._write_terminal(Namespace(), source,
                controller.SourceEvidence(H, "a" * 64, "b" * 64, H),
                manifest, verified, H, H, observed, "7" * 64, "8" * 64, "9" * 64,
                900, checkpoint, "historical", Path("/final"))

    def _attestation_result(self, receipt_sha=H, commit="b" * 40):
        certificate = {
            "issuer": "https://token.actions.githubusercontent.com",
            "subjectAlternativeName": (
                "https://github.com/twoimo/tzudong/.github/workflows/"
                "g038-account-deletion-successor.yml@refs/heads/main"
            ),
            "sourceRepositoryURI": "https://github.com/twoimo/tzudong",
            "sourceRepositoryDigest": commit,
            "sourceRepositoryRef": "refs/heads/main",
            "runnerEnvironment": "github-hosted",
        }
        statement = {
            "_type": "https://in-toto.io/Statement/v1",
            "subject": [{"name": "receipt.json", "digest": {"sha256": receipt_sha}}],
            "predicateType": "https://slsa.dev/provenance/v1",
            "predicate": {},
        }
        return [{"attestation": {"bundle": "opaque"}, "verificationResult": {
            "signature": {"certificate": certificate},
            "verifiedTimestamps": [{"type": "rekor"}],
            "statement": statement,
        }}]

    def test_attestation_verification_uses_exact_offline_cli_policy_and_binds_bundle(self):
        result = self._attestation_result()
        calls = []
        args = Namespace(source_attestation_bundle="/bundle", gh_path="/gh")
        with patch.object(controller, "_outside", side_effect=lambda value, _root: Path(value)), \
                patch.object(controller, "_stable_bytes", return_value=b"exact bundle"), \
                patch.object(controller, "_pinned_gh", return_value=Path("/gh")), \
                patch.object(controller, "_run_gh",
                    side_effect=lambda command: calls.append(command) or json.dumps(result).encode("utf-8")):
            evidence = controller._verify_source_attestation(
                args, Path("/checkout"), Path("/receipt.json"), H, "b" * 40,
            )
        self.assertEqual(calls, [[
            "/gh", "attestation", "verify", "/receipt.json",
            "--bundle", "/bundle",
            "--repo", "twoimo/tzudong",
            "--signer-workflow", controller._SOURCE_SIGNER_WORKFLOW,
            "--source-ref", "refs/heads/main",
            "--source-digest", "b" * 40,
            "--deny-self-hosted-runners",
            "--format", "json",
        ]])
        self.assertEqual(evidence.bundle_sha256, hashlib.sha256(b"exact bundle").hexdigest())
        self.assertEqual(evidence.receipt_sha256, H)
        self.assertEqual(evidence.binding_sha256, controller.canonical_sha256({
            "source_validation_receipt_sha256": H,
            "source_attestation_bundle_sha256": evidence.bundle_sha256,
            "verified_source_provenance_sha256": evidence.provenance_sha256,
        }))

    def test_attestation_rejects_forged_replayed_or_wrong_provenance(self):
        mutations = (
            ("subject", lambda value: value[0]["verificationResult"]["statement"]["subject"][0]["digest"].update(sha256="0" * 64)),
            ("signer", lambda value: value[0]["verificationResult"]["signature"]["certificate"].update(subjectAlternativeName="https://github.com/evil/repo/.github/workflows/a.yml@refs/heads/main")),
            ("ref", lambda value: value[0]["verificationResult"]["signature"]["certificate"].update(sourceRepositoryRef="refs/heads/release")),
            ("source", lambda value: value[0]["verificationResult"]["signature"]["certificate"].update(sourceRepositoryDigest="c" * 40)),
            ("repository", lambda value: value[0]["verificationResult"]["signature"]["certificate"].update(sourceRepositoryURI="https://github.com/evil/repo")),
            ("runner", lambda value: value[0]["verificationResult"]["signature"]["certificate"].update(runnerEnvironment="self-hosted")),
        )
        for name, mutate in mutations:
            result = self._attestation_result()
            mutate(result)
            with self.subTest(name=name), patch.object(controller, "_outside", side_effect=lambda value, _root: Path(value)), \
                    patch.object(controller, "_stable_bytes", return_value=b"bundle"), \
                    patch.object(controller, "_pinned_gh", return_value=Path("/gh")), \
                    patch.object(controller, "_run_gh", return_value=json.dumps(result).encode("utf-8")), \
                    self.assertRaisesRegex(controller.ControllerError, "source_attestation"):
                controller._verify_source_attestation(
                    Namespace(source_attestation_bundle="/bundle", gh_path="/gh"),
                    Path("/checkout"), Path("/receipt.json"), H, "b" * 40,
                )

    def test_pinned_gh_rejects_replacement_mode_and_version(self):
        self.assertEqual(controller._GH_SHA256, "02d2d4a85241c6a8c0b77ebb1ec76fc723caf7fb128e00915b306b968847cba1")
        with tempfile.TemporaryDirectory() as raw:
            parent = Path(raw)
            parent.chmod(0o700)
            checkout = parent / "checkout"
            checkout.mkdir(mode=0o700)
            executable = parent / "gh"
            executable.write_bytes(b"trusted gh")
            executable.chmod(0o700)
            digest = hashlib.sha256(executable.read_bytes()).hexdigest()
            args = Namespace(gh_path=executable)
            with patch.object(controller, "_GH_SHA256", digest), \
                    patch.object(controller, "_run_gh", return_value=controller._GH_VERSION_OUTPUT.encode("ascii")):
                self.assertEqual(controller._pinned_gh(args, checkout), executable)
            executable.chmod(0o755)
            with patch.object(controller, "_GH_SHA256", digest), \
                    self.assertRaisesRegex(controller.ControllerError, "source_attestation"):
                controller._pinned_gh(args, checkout)
            executable.chmod(0o700)
            executable.write_bytes(b"replacement")
            with patch.object(controller, "_GH_SHA256", digest), \
                    self.assertRaisesRegex(controller.ControllerError, "source_attestation"):
                controller._pinned_gh(args, checkout)
            executable.write_bytes(b"trusted gh")
            with patch.object(controller, "_GH_SHA256", digest), \
                    patch.object(controller, "_run_gh", return_value=b"gh version 2.96.1\n"), \
                    self.assertRaisesRegex(controller.ControllerError, "source_attestation"):
                controller._pinned_gh(args, checkout)

    def test_every_post_validation_mode_requires_attestation_bundle_and_pinned_gh(self):
        for mode in controller.MODES - {"validate-source"}:
            with self.subTest(mode=mode):
                self.assertIn("source-receipt", controller._MODE_OPTIONS[mode])
                self.assertIn("source-attestation-bundle", controller._MODE_OPTIONS[mode])
                self.assertIn("gh-path", controller._MODE_OPTIONS[mode])
    def test_cli_requires_exact_monitor_checkpoint_paths(self):
        execute = controller._MODE_OPTIONS["execute"]
        readback = controller._MODE_OPTIONS["readback"]
        self.assertIn("freeze-monitor-socket", execute)
        self.assertIn("precommit-checkpoint-receipt", execute)
        self.assertIn("postcommit-checkpoint-receipt", execute)
        self.assertIn("continuity-parent-receipt", readback)
        self.assertIn("historical-checkpoint-receipt", readback)

if __name__ == "__main__": unittest.main()
