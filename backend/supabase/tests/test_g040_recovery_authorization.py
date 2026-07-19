"""Focused contract coverage for the isolated G040 authorization boundary."""
from __future__ import annotations
import importlib.util
import json
import os
import tempfile
import threading
import unittest
import subprocess
import sys
from pathlib import Path
from types import MappingProxyType
from unittest.mock import patch

MODULE = Path(__file__).parents[1] / "scripts" / "g040_recovery_authorization.py"
spec = importlib.util.spec_from_file_location("g040", MODULE)
g040 = importlib.util.module_from_spec(spec); assert spec.loader; sys.modules[spec.name] = g040; spec.loader.exec_module(g040)


def authority(now=1000):
    value = {k: "a" * 64 for k in g040._ROOT_FIELDS | g040._RECEIPT_FIELDS | {"target_fingerprint"}}
    value.update(schema=g040.SCHEMA, purpose=g040.PURPOSE, policy=g040.POLICY,
        authorization_id="123e4567-e89b-42d3-a456-426614174000", attempt_id="123e4567-e89b-42d3-a456-426614174001",
        issued_at=now, expires_at=now + 900, final_recovery_commit="b" * 40,
        base_commit="92894e41cddb57767c9764d1694992bc0ad9d922", prefix_classification="UNAPPLIED", selected_branch="execute-00400-then-suffix")
    return value

def bindings(value): return {key: value[key] for key in g040._BINDINGS}
def journal_authority():
    value = authority()
    value.update(
        authorization_sha256="b" * 64,
        signature_sha256="c" * 64,
        bindings_sha256="d" * 64,
    )
    return MappingProxyType(value)


class G040AuthorizationTests(unittest.TestCase):
    def test_schema_and_all_bindings_reject_drift(self):
        value = authority(); expected = bindings(value)
        g040._validate(value, expected, 1000)
        for field in g040._BINDINGS:
            changed = dict(value); changed[field] = "c" * 64 if field != "selected_branch" else "other"
            with self.assertRaises(g040.AuthorizationError): g040._validate(changed, expected, 1000)
        for old in ("g035-local-recovery-receipt-v4", "g037-production-remediation-authorization-v1"):
            changed = dict(value, schema=old)
            with self.assertRaises(g040.AuthorizationError): g040._validate(changed, expected, 1000)
        for field, old in (("purpose", "g037-production-short-url-remediation"), ("policy", "exact-baseline-to-terminal-ledger-single-commit-v1")):
            with self.assertRaises(g040.AuthorizationError): g040._validate(dict(value, **{field: old}), expected, 1000)
    def test_classification_branch_pairs_are_exact(self):
        value = authority()
        expected = bindings(value)
        for classification, branch in g040._CLASSIFICATION_BRANCHES.items():
            candidate = dict(value, prefix_classification=classification, selected_branch=branch)
            g040._validate(candidate, bindings(candidate), 1000)
        for classification, branch in (
            ("UNAPPLIED", "adopt-00400-vector-then-suffix"),
            ("FULL_ESCAPED", "execute-00400-then-suffix"),
            ("recoverable", "execute-00400-then-suffix"),
            ("UNAPPLIED", "recovery/g040"),
        ):
            with self.assertRaises(g040.AuthorizationError):
                g040._validate(dict(value, prefix_classification=classification, selected_branch=branch), expected, 1000)


    def test_missing_unknown_duplicate_and_expiry_are_rejected(self):
        value = authority(); expected = bindings(value)
        with self.assertRaises(g040.AuthorizationError): g040._validate({k:v for k,v in value.items() if k != "probe_root"}, expected, 1000)
        with self.assertRaises(g040.AuthorizationError): g040._validate(dict(value, extra="x"), expected, 1000)
        with self.assertRaises(g040.AuthorizationError): g040._validate(dict(value, expires_at=1000), expected, 1000)
        with self.assertRaises(g040.AuthorizationError): g040._pairs([("x", 1), ("x", 2)])

    def test_exact_types_and_immutable_stage_result(self):
        value = authority(); expected = bindings(value)
        class EvilDict(dict): pass
        with self.assertRaises(g040.AuthorizationError): g040._validate(EvilDict(value), expected, 1000)
        envelope = g040.AuthorizationEnvelope(g040.canonical_json_bytes(value), b"signature")
        with patch.object(g040, "_verify"), self.assertRaises(g040.AuthorizationError):
            g040.reverify_destructive_stage(envelope, expected_bindings=EvilDict(expected), now=1000, source_is_exact=lambda: True)
        with patch.object(g040, "_verify"):
            frozen = g040.reverify_destructive_stage(envelope, expected_bindings=expected, now=1000, source_is_exact=lambda: True)
        self.assertIs(type(frozen), MappingProxyType)
        with self.assertRaises(TypeError): frozen["schema"] = "x"
        self.assertEqual(frozen["authorization_sha256"], g040.hashlib.sha256(envelope.raw).hexdigest())
        self.assertEqual(frozen["signature_sha256"], g040.hashlib.sha256(envelope.signature).hexdigest())
        self.assertEqual(frozen["bindings_sha256"], g040.canonical_sha256(bindings(value)))
        class EvilString(str): pass
        with self.assertRaises(g040.AuthorizationError):
            g040._validate(dict(value, prefix_classification=EvilString("UNAPPLIED")), expected, 1000)

    def test_provider_exception_is_sanitized(self):
        value = authority(); envelope = g040.AuthorizationEnvelope(g040.canonical_json_bytes(value), b"s")
        with patch.object(g040, "_verify"), self.assertRaisesRegex(g040.AuthorizationError, "source verification failed") as captured:
            g040.reverify_destructive_stage(envelope, expected_bindings=bindings(value), now=1000, source_is_exact=lambda: (_ for _ in ()).throw(RuntimeError("https://secret.example/sql")))
        self.assertIsNone(captured.exception.__cause__)
        self.assertIsNone(captured.exception.__context__)

    def test_parser_and_journal_custody_failures_are_sanitized(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "bad.json"; path.write_bytes(b"{")
            with self.assertRaises(g040.AuthorizationError) as captured:
                g040._load_canonical(path)
        self.assertIsNone(captured.exception.__cause__)
        self.assertIsNone(captured.exception.__context__)
        with patch.object(Path, "resolve", side_effect=RuntimeError("sensitive path")):
            with self.assertRaises(g040.AuthorizationError) as captured:
                g040._journal_parent(Path("journal") / "marker", Path("repo"))
        self.assertIsNone(captured.exception.__cause__)
        self.assertIsNone(captured.exception.__context__)
    def test_custody_and_journal_io_failures_have_no_exception_context(self):
        value = authority()
        def assert_sanitized(operation):
            with self.assertRaises(g040.AuthorizationError) as captured:
                operation()
            self.assertIsNone(captured.exception.__cause__)
            self.assertIsNone(captured.exception.__context__)
        assert_sanitized(lambda: g040.authenticate_recovery_authorization(
            "authorization.json", "signature.bin",
            require_custody=lambda *_: (_ for _ in ()).throw(RuntimeError("sensitive provider error")),
            expected_bindings=bindings(value), now=1000,
        ))
        assert_sanitized(lambda: g040.restrictive_regular_file("authorization.json", "authorization"))
        with tempfile.TemporaryDirectory() as temp:
            journal = Path(temp) / "journal"
            journal.mkdir()
            os.chmod(journal, 0o700)
            assert_sanitized(lambda: g040.consume_one_shot_attempt(
                journal, repository_root=Path(temp) / "repository",
                authorization=journal_authority(), callback=lambda: None, now=1000,
            ))

    def test_canonical_document_rejects_raw_target_and_duplicates(self):
        self.assertNotIn("origin", g040._FIELDS); self.assertNotIn("project", g040._FIELDS); self.assertNotIn("url", g040._FIELDS)
        raw = b'{"schema":"x","schema":"y"}'
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "a.json"; path.write_bytes(raw)
            with self.assertRaises(g040.AuthorizationError): g040._load_canonical(path)
    def test_openssl_sign_verify_when_external_key_path_is_explicit(self):
        key = os.environ.get("G040_OPENSSL_SIGNING_KEY")
        if not key:
            self.skipTest("set G040_OPENSSL_SIGNING_KEY to run the external-key fixture")
        value = authority()
        with tempfile.TemporaryDirectory() as temp:
            auth, signature = Path(temp) / "authorization.json", Path(temp) / "authorization.sig"
            auth.write_bytes(g040.canonical_json_bytes(value))
            subprocess.run(
                ["openssl", "pkeyutl", "-sign", "-inkey", key, "-rawin", "-in", str(auth), "-out", str(signature)],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=True,
            )
            envelope = g040.authenticate_recovery_authorization(
                auth,
                signature,
                require_custody=lambda *_: None,
                expected_bindings=bindings(value),
                now=1000,
            )
        self.assertEqual(envelope.raw, g040.canonical_json_bytes(value))


class G040JournalTests(unittest.TestCase):
    def _frozen(self): return journal_authority()
    def test_marker_precedes_callback_and_replay_is_denied(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as journal:
            os.chmod(journal, 0o700); seen = []
            def callback():
                seen.append(any(Path(journal).iterdir()))
            receipt = g040.consume_one_shot_attempt(journal, repository_root=root, authorization=self._frozen(), callback=callback, now=1)
            self.assertEqual(receipt["event"], "attempt-started")
            self.assertEqual(receipt["receipt_sha256"], g040.canonical_sha256({k: v for k, v in receipt.items() if k != "receipt_sha256"}))
            self.assertEqual(seen, [True])
            self.assertEqual(receipt["authorization_sha256"], "b" * 64)
            self.assertEqual(receipt["signature_sha256"], "c" * 64)
            self.assertEqual(receipt["bindings_sha256"], "d" * 64)
            self.assertIs(type(receipt), MappingProxyType)
            with self.assertRaises(g040.AuthorizationError): g040.consume_one_shot_attempt(journal, repository_root=root, authorization=self._frozen(), callback=lambda: None, now=2)
    def test_callback_failure_and_partial_write_remain_consumed(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as journal:
            os.chmod(journal, 0o700)
            with self.assertRaises(RuntimeError): g040.consume_one_shot_attempt(journal, repository_root=root, authorization=self._frozen(), callback=lambda: (_ for _ in ()).throw(RuntimeError("failure")), now=1)
            with self.assertRaises(g040.AuthorizationError): g040.consume_one_shot_attempt(journal, repository_root=root, authorization=self._frozen(), callback=lambda: None, now=2)
    def test_partial_write_marker_remains_consumed(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as journal:
            os.chmod(journal, 0o700)
            with patch.object(g040.os, "write", return_value=0):
                with self.assertRaises(g040.AuthorizationError):
                    g040.consume_one_shot_attempt(journal, repository_root=root, authorization=self._frozen(), callback=lambda: None, now=1)
            self.assertTrue(any(Path(journal).iterdir()))
            with self.assertRaises(g040.AuthorizationError):
                g040.consume_one_shot_attempt(journal, repository_root=root, authorization=self._frozen(), callback=lambda: None, now=2)
    def test_concurrent_consumers_have_exactly_one_winner(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as journal:
            os.chmod(journal, 0o700); outcomes = []
            def consume():
                try:
                    g040.consume_one_shot_attempt(journal, repository_root=root, authorization=self._frozen(), callback=lambda: None, now=1)
                    outcomes.append("won")
                except g040.AuthorizationError:
                    outcomes.append("denied")
            workers = [threading.Thread(target=consume) for _ in range(8)]
            for worker in workers: worker.start()
            for worker in workers: worker.join()
            self.assertEqual(outcomes.count("won"), 1)
            self.assertEqual(outcomes.count("denied"), 7)
    def test_journal_rejects_crossed_branch_pair(self):
        value = dict(journal_authority(), prefix_classification="FULL_ESCAPED", selected_branch="execute-00400-then-suffix")
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as journal:
            os.chmod(journal, 0o700)
            with self.assertRaises(g040.AuthorizationError):
                g040.consume_one_shot_attempt(journal, repository_root=root, authorization=MappingProxyType(value), callback=lambda: None, now=1)
    def test_repo_journal_and_windows_posix_custody_fail_closed(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(g040.AuthorizationError): g040.consume_one_shot_attempt(root, repository_root=root, authorization=self._frozen(), callback=lambda: None, now=1)
        with patch.object(g040.os, "name", "nt"), patch.object(g040, "_windows_restrictive", return_value=False):
            with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as journal:
                with self.assertRaises(g040.AuthorizationError): g040.consume_one_shot_attempt(journal, repository_root=root, authorization=self._frozen(), callback=lambda: None, now=1)

if __name__ == "__main__": unittest.main()
