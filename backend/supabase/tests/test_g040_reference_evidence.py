from __future__ import annotations

import base64
import hashlib
import sys
import unittest
from pathlib import Path
from types import MappingProxyType
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import g040_reference_evidence as evidence
import g040_prefix_recovery as classifier
from g040_recovery_source import SourceBinding


class ReferenceTests(unittest.TestCase):
    def clone(self, *, marker: str, nonce: str) -> MappingProxyType:
        clone = {
            "clone_nonce": nonce,
            "live_identity_sha256": marker * 64,
            "container_id_sha256": chr(ord(marker) + 1) * 64,
            "image_id_sha256": "5" * 64,
            "image_digest_sha256": "6" * 64,
            "endpoint_sha256": chr(ord(marker) + 2) * 64,
            "g035_restore_receipt_sha256": "e" * 64,
            "g035_capture_receipt_sha256": "7" * 64,
            "restored_archive_sha256": "8" * 64,
            "capture_receipt_bytes_sha256": "9" * 64,
            "restore_receipt_bytes_sha256": "a" * 64,
            "lineage_attestation_sha256": chr(ord(marker) + 3) * 64,
            "lineage_signature_sha256": chr(ord(marker) + 4) * 64,
            "binding_receipt_sha256": chr(ord(marker) + 5) * 64,
            "observation_receipt_sha256": chr(ord(marker) + 6) * 64,
            "absent_catalog_sha256": "a" * 64,
            "full_catalog_sha256": "b" * 64,
            "full_data_sha256": "c" * 64,
            "ledger_prefix_sha256": "d" * 64,
            "derivation_mode": evidence.DERIVATION_MODE,
            "reverse_vector_sha256": evidence.REVERSE_VECTOR_SHA256,
        }
        clone["clone_identity"] = hashlib.sha256(evidence.canonical_bytes({key: clone[key] for key in evidence._IDENTITY_COMPONENT_FIELDS})).hexdigest()
        return MappingProxyType(clone)

    def clones(self):
        return self.clone(marker="1", nonce="clone-first-nonce"), self.clone(marker="2", nonce="clone-second-nonce")

    def body(self, *, issued=100, expires=200):
        first, second = self.clones()
        return evidence.build_reference_body(final_commit="1" * 40, runtime_source_root="2" * 64, target_fingerprint="3" * 64, observation_nonce="single-use-observation", issued_at_unix=issued, expires_at_unix=expires, first_clone=first, second_clone=second)

    def signing_context(self):
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
        private = Ed25519PrivateKey.from_private_bytes(hashlib.sha256(b"g040 deterministic reference test key").digest())
        public = private.public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo).decode("ascii")
        return private, public, SourceBinding("1" * 40, "2" * 64)

    def signed(self, body, private):
        return {**dict(body), "signature_b64": base64.b64encode(private.sign(evidence.canonical_bytes(dict(body)))).decode("ascii")}

    def test_combined_observation_contract_enforces_identity_and_all_builder_drift(self):
        first, second = self.clones()
        evidence.compare_clone_runs(first, second)
        for field in evidence._CLONE_DISTINCT_FIELDS:
            with self.subTest(distinct=field), self.assertRaises(evidence.ReferenceEvidenceError):
                evidence.compare_clone_runs(first, {**dict(second), field: first[field]})
        for field in evidence._CLONE_EQUAL_FIELDS:
            value = "0" * 64 if field != "derivation_mode" else "wrong"
            with self.subTest(equal=field), self.assertRaises(evidence.ReferenceEvidenceError):
                evidence.compare_clone_runs(first, {**dict(second), field: value})
        for field in evidence._IDENTITY_COMPONENT_FIELDS:
            altered = {**dict(second), field: "0" * 64}
            with self.subTest(identity_component=field), self.assertRaises(evidence.ReferenceEvidenceError):
                evidence.compare_clone_runs(first, altered)
        with self.assertRaises(evidence.ReferenceEvidenceError):
            evidence.compare_clone_runs(first, {**dict(second), "clone_identity": first["clone_identity"]})

    def test_rejects_noncombined_legacy_adapter_shape_and_invalid_lifetime(self):
        first, second = self.clones()
        legacy = {**dict(first), "state": "absent", "catalog_sha256": first["absent_catalog_sha256"]}
        with self.assertRaises(evidence.ReferenceEvidenceError):
            evidence.build_reference_body(final_commit="1" * 40, runtime_source_root="2" * 64, target_fingerprint="3" * 64, observation_nonce="single-use-observation", issued_at_unix=100, expires_at_unix=200, first_clone=legacy, second_clone=second)
        with self.assertRaises(evidence.ReferenceEvidenceError):
            self.body(expires=1001)
        self.assertNotIn("build_clone_run", evidence.__all__)
        self.assertFalse(hasattr(evidence, "build_clone_run"))

    def test_canonical_loading_and_constants(self):
        with self.assertRaises(evidence.ReferenceEvidenceError):
            evidence.load_reference(b'{"schema":"x","schema":"y"}')
        with self.assertRaises(evidence.ReferenceEvidenceError):
            evidence.load_reference("{}\n")
        self.assertEqual(hashlib.sha256((classifier.CATALOG_PROBE + "\n" + classifier.DATA_PROBE).encode()).hexdigest(), evidence._PROBE_TEXT_SHA256)

    def test_validly_signed_identity_and_reused_receipt_negatives(self):
        private, public, source = self.signing_context()
        with patch.object(evidence, "PUBLIC_KEY_PEM", public), patch.object(evidence, "PUBLIC_KEY_SHA256", hashlib.sha256(public.encode("ascii")).hexdigest()):
            for field, value in (("second_clone_identity", "0" * 64), ("second_image_digest_sha256", "0" * 64), ("second_binding_receipt_sha256", self.body()["first_binding_receipt_sha256"]), ("second_observation_receipt_sha256", self.body()["first_observation_receipt_sha256"])):
                with self.subTest(field=field), self.assertRaises(evidence.ReferenceEvidenceError):
                    body = {**dict(self.body()), field: value}
                    evidence.verify_reference(evidence.canonical_bytes(self.signed(body, private)), now_unix=150, expected_source=source, expected_target_fingerprint="3" * 64)

    def test_raw_canonical_verification_wrong_key_and_bounded_errors(self):
        private, public, source = self.signing_context()
        with patch.object(evidence, "PUBLIC_KEY_PEM", public), patch.object(evidence, "PUBLIC_KEY_SHA256", hashlib.sha256(public.encode("ascii")).hexdigest()):
            signed = self.signed(self.body(), private)
            raw = evidence.canonical_bytes(dict(signed))
            verified = evidence.verify_reference(raw, now_unix=150, expected_source=source, expected_target_fingerprint="3" * 64)
            self.assertIs(type(verified), evidence.VerifiedReference)
            for malformed in (b"", b"[]", b'{"x":1}', raw + b"\n"):
                with self.subTest(malformed=malformed), self.assertRaises(evidence.ReferenceEvidenceError):
                    evidence.verify_reference(malformed, now_unix=150, expected_source=source, expected_target_fingerprint="3" * 64)
            with self.assertRaises(evidence.ReferenceEvidenceError):
                evidence.verify_reference(signed, now_unix=150, expected_source=source, expected_target_fingerprint="3" * 64)
            from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
            from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
            wrong_public = Ed25519PrivateKey.from_private_bytes(hashlib.sha256(b"g040 deterministic wrong reference test key").digest()).public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo).decode("ascii")
            with patch.object(evidence, "PUBLIC_KEY_PEM", wrong_public), patch.object(evidence, "PUBLIC_KEY_SHA256", hashlib.sha256(wrong_public.encode("ascii")).hexdigest()):
                with self.assertRaises(evidence.ReferenceEvidenceError):
                    evidence.verify_reference(raw, now_unix=150, expected_source=source, expected_target_fingerprint="3" * 64)
            with patch.object(evidence._crypto, "openssl_verify", side_effect=OSError("unexpected verifier detail")):
                with self.assertRaisesRegex(evidence.ReferenceEvidenceError, "^g040 reference evidence verification failed$"):
                    evidence.verify_reference(raw, now_unix=150, expected_source=source, expected_target_fingerprint="3" * 64)


if __name__ == "__main__":
    unittest.main()
