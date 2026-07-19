from __future__ import annotations

import base64
import os
import sys
import unittest
from pathlib import Path
from types import MappingProxyType

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import g037_managed_recovery as crypto
import g040_reference_evidence as evidence
from g040_recovery_source import SourceBinding

class ReferenceTests(unittest.TestCase):
    def clones(self):
        def pair(identity, nonce, receipt, live, container):
            shared = {"clone_identity": identity, "clone_nonce": nonce, "live_identity_sha256": live, "container_id_sha256": container, "image_id_sha256": "5" * 64, "image_digest_sha256": "6" * 64, "endpoint_sha256": "0" * 64, "g035_restore_receipt_sha256": receipt, "g035_capture_receipt_sha256": "7" * 64, "restored_archive_sha256": "8" * 64, "capture_receipt_bytes_sha256": "9" * 64, "restore_receipt_bytes_sha256": "a" * 64, "lineage_attestation_sha256": identity, "lineage_signature_sha256": receipt, "ledger_prefix_sha256": "d" * 64, "derivation_mode": evidence.DERIVATION_MODE, "reverse_vector_sha256": evidence.REVERSE_VECTOR_SHA256}
            return MappingProxyType({**shared, "state": "absent", "catalog_sha256": "a" * 64}), MappingProxyType({**shared, "state": "full", "catalog_sha256": "b" * 64, "data_sha256": "c" * 64})
        return evidence.build_clone_run(*pair("9" * 64, "clone-first-nonce", "e" * 64, "1" * 64, "3" * 64)), evidence.build_clone_run(*pair("a" * 64, "clone-second-nonce", "f" * 64, "2" * 64, "4" * 64))

    def body(self, *, issued=100, expires=200):
        first, second = self.clones()
        return evidence.build_reference_body(final_commit="1" * 40, runtime_source_root="2" * 64, target_fingerprint="3" * 64, observation_nonce="single-use-observation", issued_at_unix=issued, expires_at_unix=expires, first_clone=first, second_clone=second)

    def test_rejects_reused_live_clone_or_restore_proof(self):
        first, second = self.clones()
        reused = dict(second)
        reused["container_id_sha256"] = first["container_id_sha256"]
        with self.assertRaises(evidence.ReferenceEvidenceError):
            evidence.compare_clone_runs(first, reused)
        reused = dict(second)
        reused["g035_restore_receipt_sha256"] = first["g035_restore_receipt_sha256"]
        with self.assertRaises(evidence.ReferenceEvidenceError):
            evidence.compare_clone_runs(first, reused)
    def test_rejects_v1_and_invalid_derivation_artifacts(self):
        first, second = self.clones()
        for changes in (
            {"schema": "g040-prefix-reference-v1"},
            {"derivation_mode": "wrong"},
            {"reverse_vector_sha256": "0" * 64},
        ):
            with self.subTest(changes=changes), self.assertRaises(evidence.ReferenceEvidenceError):
                evidence.validate_reference_body({**dict(self.body()), **changes})
        body = dict(self.body())
        del body["derivation_mode"]
        with self.assertRaises(evidence.ReferenceEvidenceError):
            evidence.validate_reference_body(body)
        for field, value in (("derivation_mode", "wrong"), ("reverse_vector_sha256", "0" * 64)):
            with self.subTest(field=field), self.assertRaises(evidence.ReferenceEvidenceError):
                evidence.compare_clone_runs(first, {**dict(second), field: value})
    def test_build_clone_run_rejects_missing_or_equal_catalog_roots(self):
        absent = MappingProxyType({"clone_identity": "9" * 64, "clone_nonce": "clone-artifact-nonce", "live_identity_sha256": "1" * 64, "container_id_sha256": "2" * 64, "image_id_sha256": "3" * 64, "image_digest_sha256": "4" * 64, "endpoint_sha256": "5" * 64, "g035_restore_receipt_sha256": "6" * 64, "g035_capture_receipt_sha256": "7" * 64, "restored_archive_sha256": "8" * 64, "capture_receipt_bytes_sha256": "9" * 64, "restore_receipt_bytes_sha256": "a" * 64, "lineage_attestation_sha256": "b" * 64, "lineage_signature_sha256": "c" * 64, "ledger_prefix_sha256": "d" * 64, "derivation_mode": evidence.DERIVATION_MODE, "reverse_vector_sha256": evidence.REVERSE_VECTOR_SHA256, "state": "absent", "catalog_sha256": "e" * 64})
        full = MappingProxyType({**dict(absent), "state": "full", "catalog_sha256": "f" * 64, "data_sha256": "0" * 64})
        with self.assertRaises(evidence.ReferenceEvidenceError):
            evidence.build_clone_run(absent, MappingProxyType({**dict(full), "catalog_sha256": absent["catalog_sha256"]}))
        for field, value in (("derivation_mode", None), ("derivation_mode", "wrong"), ("reverse_vector_sha256", "0" * 64)):
            with self.subTest(field=field, value=value), self.assertRaises(evidence.ReferenceEvidenceError):
                evidence.build_clone_run(
                    MappingProxyType({key: item for key, item in dict(absent).items() if key != field} if value is None else {**dict(absent), field: value}),
                    MappingProxyType({key: item for key, item in dict(full).items() if key != field} if value is None else {**dict(full), field: value}),
                )
    def test_build_reference_body_uses_clone_run_mapping_items(self):
        first, second = self.clones()
        body = evidence.build_reference_body(
            final_commit="1" * 40,
            runtime_source_root="2" * 64,
            target_fingerprint="3" * 64,
            observation_nonce="single-use-observation",
            issued_at_unix=100,
            expires_at_unix=200,
            first_clone=first,
            second_clone=second,
        )
        self.assertEqual(body["first_clone_identity"], first["clone_identity"])
        self.assertEqual(body["second_clone_identity"], second["clone_identity"])
    def test_canonical_duplicate_and_lifetime_rejection(self):
        with self.assertRaises(evidence.ReferenceEvidenceError): evidence.load_reference(b'{"schema":"x","schema":"y"}')
        with self.assertRaises(evidence.ReferenceEvidenceError): self.body(expires=1001)
        self.assertIs(type(self.body()), MappingProxyType)

    def test_external_fixed_key_vector_binds_source_target_and_freshness(self):
        key = os.environ.get("G040_OPENSSL_SIGNING_KEY")
        if not key:
            self.skipTest("set G040_OPENSSL_SIGNING_KEY to run the external fixed-key fixture")
        signed = evidence.sign_reference(self.body(), lambda raw: crypto.openssl_sign(crypto.command("openssl"), Path(key), raw))
        source = SourceBinding("1" * 40, "2" * 64)
        verified = evidence.verify_reference(evidence.canonical_bytes(dict(signed)), now_unix=150, expected_source=source, expected_target_fingerprint="3" * 64)
        self.assertIs(type(verified), evidence.VerifiedReference)
        for now, source_arg, target in ((99, source, "3" * 64), (201, source, "3" * 64), (150, SourceBinding("0" * 40, "2" * 64), "3" * 64), (150, source, "4" * 64)):
            with self.subTest(now=now, target=target):
                with self.assertRaises(evidence.ReferenceEvidenceError): evidence.verify_reference(signed, now_unix=now, expected_source=source_arg, expected_target_fingerprint=target)
    def test_verify_reference_rejects_validly_signed_reused_lineage_proof(self):
        key = os.environ.get("G040_OPENSSL_SIGNING_KEY")
        if not key:
            self.skipTest("set G040_OPENSSL_SIGNING_KEY to run the external fixed-key fixture")
        source = SourceBinding("1" * 40, "2" * 64)
        for field in ("lineage_attestation_sha256", "lineage_signature_sha256"):
            with self.subTest(field=field):
                body = dict(self.body())
                body[f"second_{field}"] = body[f"first_{field}"]
                signature = crypto.openssl_sign(crypto.command("openssl"), Path(key), evidence.canonical_bytes(body))
                signed = {**body, "signature_b64": base64.b64encode(signature).decode("ascii")}
                with self.assertRaises(evidence.ReferenceEvidenceError):
                    evidence.verify_reference(
                        evidence.canonical_bytes(signed),
                        now_unix=150,
                        expected_source=source,
                        expected_target_fingerprint="3" * 64,
                    )

    def test_verified_reference_exact_type(self):
        class Derived(evidence.VerifiedReference):
            pass
        value = evidence.VerifiedReference(**dict(self.body()), signature_b64="AA==", receipt_sha256="f" * 64)
        self.assertIs(type(value), evidence.VerifiedReference)
        self.assertNotEqual(type(Derived(**value.__dict__)), evidence.VerifiedReference)

if __name__ == "__main__":
    unittest.main()
