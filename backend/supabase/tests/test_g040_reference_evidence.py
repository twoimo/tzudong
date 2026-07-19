from __future__ import annotations

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
        def pair(identity, nonce, receipt):
            shared = {"clone_identity": identity, "clone_nonce": nonce, "restore_receipt_sha256": receipt, "ledger_prefix_sha256": "d" * 64}
            return MappingProxyType({**shared, "state": "absent", "catalog_sha256": "a" * 64}), MappingProxyType({**shared, "state": "full", "catalog_sha256": "b" * 64, "data_sha256": "c" * 64})
        return evidence.build_clone_run(*pair("clone-first-identity", "clone-first-nonce", "e" * 64)), evidence.build_clone_run(*pair("clone-second-ident", "clone-second-nonce", "f" * 64))

    def body(self, *, issued=100, expires=200):
        first, second = self.clones()
        return evidence.build_reference_body(final_commit="1" * 40, runtime_source_root="2" * 64, target_fingerprint="3" * 64, observation_nonce="single-use-observation", issued_at_unix=issued, expires_at_unix=expires, first_clone=first, second_clone=second)

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

    def test_verified_reference_exact_type(self):
        class Derived(evidence.VerifiedReference):
            pass
        value = evidence.VerifiedReference(**dict(self.body()), signature_b64="AA==", receipt_sha256="f" * 64)
        self.assertIs(type(value), evidence.VerifiedReference)
        self.assertNotEqual(type(Derived(**value.__dict__)), evidence.VerifiedReference)

if __name__ == "__main__":
    unittest.main()
