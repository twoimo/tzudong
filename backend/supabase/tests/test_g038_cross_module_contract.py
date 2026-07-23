from __future__ import annotations

import hashlib
import importlib
import inspect
import sys
import unittest
from dataclasses import fields
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import g038_production_controller as controller
import g038_clone_rehearsal as clone_rehearsal
import g038_successor_authorization as authorization
import g038_successor_executor as executor
import g038_write_freeze as write_freeze


class CrossModuleContractTests(unittest.TestCase):
    def test_controller_authorization_and_executor_share_one_exact_binding_vocabulary(self):
        expected = {
            "target_fingerprint", "target_acl_root", "g038_source_commit", "runtime_source_root",
            "source_validation_receipt_sha256",
            "source_root", "manifest_root", "vector_root", "predecessor_commit",
            "predecessor_report_sha256", "predecessor_outcome_sha256", "predecessor_readback_sha256",
            "predecessor_rows", "target_rows", "starting_ledger_root", "starting_catalog_root",
            "starting_acl_root", "starting_data_root", "target_ledger_root", "target_catalog_root",
            "target_data_root", "target_spec_sha256", "observation_receipt_sha256",
            "backup_receipt_sha256", "capture_receipt_sha256", "dual_clone_receipt_sha256",
            "archive_sha256", "archive_bytes", "freeze_expires_at", "freeze_root", "inventory_root",
            "selected_versions", "exclusions_root", "disposable_runtime_subject_sha256",
            "disposable_runtime_proof_contract_sha256",
        }
        self.assertEqual(authorization._BINDINGS, expected)
        verified_fields = {field.name for field in fields(authorization.VerifiedAuthorization)}
        self.assertTrue(expected <= verified_fields)
        source = inspect.getsource(executor._authorization)
        for canonical in ("vector_root", "target_spec_sha256", "exclusions_root", "starting_acl_root", "predecessor_rows", "target_rows"):
            self.assertIn(canonical, source)
        for retired in ("statement_vector_root\"", "terminal_spec_root\"", "excluded_root\""):
            self.assertNotIn(retired, source)
        self.assertIn("source_validation_receipt_sha256", authorization._RECEIPT_FIELDS)
        self.assertIn("source_validation_receipt_sha256", controller.HostedObservation.__annotations__)
        for mode in controller.MODES - {"validate-source"}:
            self.assertIn("source-receipt", controller._MODE_OPTIONS[mode])

    def test_executor_is_cursor_only_and_has_no_transaction_outcome_api(self):
        signature = inspect.signature(executor.apply_cursor)
        self.assertEqual(tuple(signature.parameters), ("cursor", "plan", "authorization", "attempt", "deadline_monotonic"))
        source = inspect.getsource(executor.apply_cursor)
        self.assertNotIn(".commit(", source); self.assertNotIn(".rollback(", source)
        self.assertNotIn("cursor.execute(", source)

    def test_fixed_target_versions_and_exclusions_are_identical_across_modules(self):
        self.assertEqual(controller.TARGET_FINGERPRINT, authorization.__dict__.get("TARGET_FINGERPRINT", controller.TARGET_FINGERPRINT))
        self.assertEqual(controller.SELECTED_VERSIONS, authorization.SELECTED_VERSIONS)
        self.assertEqual(controller.PREDECESSOR_REPORT_SHA256, authorization.PREDECESSOR_REPORT_SHA256)
        self.assertEqual(controller.EXCLUDED_ROOT, executor.EXCLUDED_ROOT)
        self.assertEqual(controller.STATEMENT_VECTOR_ROOT, executor.STATEMENT_VECTOR_ROOT)
        self.assertEqual(controller.TERMINAL_SPEC_ROOT, executor.TERMINAL_SPEC_ROOT)

    def test_g038_signing_keys_are_fixed_and_pairwise_domain_separate(self):
        importlib.reload(clone_rehearsal)
        keys = (
            authorization.PUBLIC_KEY_PEM,
            clone_rehearsal.PUBLIC_KEY_PEM,
            write_freeze.PUBLIC_KEY_PEM,
            controller._RECEIPT_PUBLIC_KEY_PEM,
        )
        self.assertEqual(len(set(keys)), 4)
        self.assertNotEqual(keys[0], keys[1])
        self.assertNotEqual(keys[0], keys[2])
        self.assertNotEqual(keys[0], keys[3])
        self.assertNotEqual(keys[1], keys[2])
        self.assertNotEqual(keys[1], keys[3])
        self.assertNotEqual(keys[2], keys[3])
        self.assertEqual(clone_rehearsal.PUBLIC_KEY_SHA256, "5ceabd8a91a352125eb3ec9bbfa6c20854c4100a4efbe8df6f471dade133c022")
        self.assertEqual(authorization.PUBLIC_KEY_SHA256, "723cae40a86087e1206ca0449e34cbc14a3233bb53c7ae04710b97952e405473")
        self.assertEqual(hashlib.sha256(keys[0].encode("ascii")).hexdigest(), authorization.PUBLIC_KEY_SHA256)
        self.assertEqual(hashlib.sha256(keys[1].encode("ascii")).hexdigest(), clone_rehearsal.PUBLIC_KEY_SHA256)
        self.assertEqual(hashlib.sha256(keys[2].encode("ascii")).hexdigest(), write_freeze.PUBLIC_KEY_SHA256)
        self.assertEqual(hashlib.sha256(keys[3].encode("ascii")).hexdigest(), controller._RECEIPT_PUBLIC_KEY_SHA256)
        self.assertEqual(write_freeze.PUBLIC_KEY_SHA256, "562357382214576ef4647037618a0b7069e234373521651e239cde862596c873")
        self.assertEqual(controller._RECEIPT_PUBLIC_KEY_SHA256, "30a92ba630d53655e7489351d20c9b049033a56fed07d5bd2e340f7d5aa4c56b")
        self.assertNotEqual(controller._RECEIPT_SIGNING_KEY, authorization.CANONICAL_JOURNAL_DIRECTORY)

    def test_cross_domain_signature_is_rejected(self):
        try:
            from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
            from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
        except ModuleNotFoundError:
            self.skipTest("cryptography is unavailable")

        clone_key = Ed25519PrivateKey.generate()
        freeze_key = Ed25519PrivateKey.generate()
        clone_public = clone_key.public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo).decode("ascii")
        freeze_public = freeze_key.public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo).decode("ascii")
        payload = b"domain-bound-receipt"
        clone_signature = clone_key.sign(payload)
        freeze_signature = freeze_key.sign(payload)
        with self.assertRaisesRegex(controller.ControllerError, "cross_domain"):
            controller._verify_signature(payload, clone_signature, pem=freeze_public,
                digest=hashlib.sha256(freeze_public.encode("ascii")).hexdigest(), code="cross_domain")
        with self.assertRaisesRegex(controller.ControllerError, "cross_domain"):
            controller._verify_signature(payload, freeze_signature, pem=clone_public,
                digest=hashlib.sha256(clone_public.encode("ascii")).hexdigest(), code="cross_domain")


if __name__ == "__main__": unittest.main()
