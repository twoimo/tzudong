"""Contract tests for G040's canonical destructive-authority boundary."""
from __future__ import annotations

from contextlib import ExitStack
import hashlib
import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE = Path(__file__).parents[1] / "scripts" / "g040_recovery_authorization.py"
spec = importlib.util.spec_from_file_location("g040", MODULE)
g040 = importlib.util.module_from_spec(spec); assert spec.loader; sys.modules[spec.name] = g040; spec.loader.exec_module(g040)

def authority(now: int = 1000):
    value = {key: "a" * 64 for key in g040._ROOT_FIELDS | g040._RECEIPT_FIELDS | {"target_fingerprint"}}
    value.update(schema=g040.SCHEMA, purpose=g040.PURPOSE, policy=g040.POLICY,
        authorization_id="123e4567-e89b-42d3-a456-426614174000", attempt_id="123e4567-e89b-42d3-a456-426614174001",
        issued_at=now, expires_at=now + 900, final_recovery_commit="b" * 40,
        base_commit="92894e41cddb57767c9764d1694992bc0ad9d922", prefix_classification="UNAPPLIED",
        selected_branch="execute-00400-then-suffix")
    return value

def bindings(value): return {key: value[key] for key in g040._BINDINGS}

def verified():
    value = authority()
    return g040.VerifiedAuthorization(**value, authorization_sha256="b" * 64, signature_sha256="c" * 64, bindings_sha256="d" * 64)
def permissive_windows_custody(stack: ExitStack) -> None:
    if os.name == "nt":
        stack.enter_context(patch.object(g040, "_windows_restrictive", return_value=True))
        stack.enter_context(patch.object(g040, "_fsync_directory", return_value=None))

class AuthorizationTests(unittest.TestCase):
    def test_exact_dataclass_and_binding_drift_are_required(self):
        value = authority(); raw = g040.canonical_json_bytes(value)
        with patch.object(g040, "_verify"):
            envelope = g040.authenticate_recovery_authorization(raw, b"sig", expected_bindings=bindings(value), now=1000)
            result = g040.reverify_destructive_stage(envelope, expected_bindings=bindings(value), now=1000)
        self.assertIs(type(result), g040.VerifiedAuthorization)
        self.assertEqual(result.bindings_sha256, g040.canonical_sha256(bindings(value)))
        class Derived(g040.VerifiedAuthorization): pass
        copied = {field.name: getattr(result, field.name) for field in __import__("dataclasses").fields(result)}
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as journal:
            os.chmod(journal, 0o700)
            with self.assertRaises(g040.AuthorizationError):
                g040.consume_one_shot_attempt(journal, repository_root=root, authorization=Derived(**copied), callback=lambda _: None, now=1)
        for key in g040._BINDINGS:
            changed = dict(value); changed[key] = "c" * 64 if key != "selected_branch" else "wrong"
            with self.assertRaises(g040.AuthorizationError): g040._validate(value, bindings(changed), 1000)

    def test_stale_cross_branch_duplicate_and_sanitized_errors(self):
        value = authority()
        with self.assertRaises(g040.AuthorizationError): g040._validate(dict(value, expires_at=1000), bindings(value), 1000)
        with self.assertRaises(g040.AuthorizationError): g040._validate(dict(value, selected_branch="adopt-00400-vector-then-suffix"), bindings(value), 1000)
        with self.assertRaises(g040.AuthorizationError): g040._decode(b'{"schema":"x","schema":"y"}')
        with patch.object(g040, "_verify", side_effect=RuntimeError("provider://private")):
            with self.assertRaises(g040.AuthorizationError) as captured:
                g040.authenticate_recovery_authorization(g040.canonical_json_bytes(value), b"sig", expected_bindings=bindings(value), now=1000)
        self.assertIsNone(captured.exception.__cause__); self.assertIsNone(captured.exception.__context__)

    def test_same_handle_reread_ignores_path_replacement(self):
        value = authority(); raw = g040.canonical_json_bytes(value)
        with tempfile.TemporaryDirectory() as temp:
            auth, sig = Path(temp) / "auth.json", Path(temp) / "auth.sig"
            auth.write_bytes(raw); sig.write_bytes(b"sig"); os.chmod(temp, 0o700); os.chmod(auth, 0o600); os.chmod(sig, 0o600)
            with ExitStack() as stack:
                permissive_windows_custody(stack)
                stack.enter_context(patch.object(g040, "_verify"))
                envelope = g040.authenticate_recovery_authorization(auth, sig, expected_bindings=bindings(value), now=1000)
                replacement = Path(temp) / "replacement.json"
                replacement.write_bytes(b"changed"); os.chmod(replacement, 0o600)
                if os.name == "nt":
                    with self.assertRaises(PermissionError):
                        os.replace(replacement, auth)
                else:
                    os.replace(replacement, auth)
                result = g040.reverify_destructive_stage(envelope, expected_bindings=bindings(value), now=1000)
                self.assertEqual(result.authorization_sha256, hashlib.sha256(raw).hexdigest())
                with self.assertRaises(g040.AuthorizationError):
                    g040.reverify_destructive_stage(envelope, expected_bindings=bindings(value), now=1000)
        self.assertIs(type(result), g040.VerifiedAuthorization)

    def test_windows_acl_rejects_unknown_and_inherited_write(self):
        with patch.object(g040.subprocess, "run") as run:
            run.side_effect = [type("R", (), {"stdout": "owner: OWNER\\ME\n"})(), type("R", (), {"stdout": "OWNER\\ME:(F)\nEVIL:(F)\n"})()]
            self.assertFalse(g040._windows_restrictive(Path("x")))
        with patch.object(g040.subprocess, "run") as run:
            run.side_effect = [type("R", (), {"stdout": "owner: OWNER\\ME\n"})(), type("R", (), {"stdout": "OWNER\\ME:(I)(W)\n"})()]
            self.assertFalse(g040._windows_restrictive(Path("x")))

class JournalTests(unittest.TestCase):
    def test_marker_precedes_callback_and_returns_exact_evidence(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as journal:
            os.chmod(journal, 0o700); seen = []
            def callback(attempt):
                self.assertIs(type(attempt), g040.AttemptStarted)
                seen.append(any(Path(journal).iterdir())); return {"sequenced": True}
            with ExitStack() as stack:
                permissive_windows_custody(stack)
                attempt, evidence = g040.consume_one_shot_attempt(journal, repository_root=root, authorization=verified(), callback=callback, now=1)
                self.assertTrue(seen[0]); self.assertEqual(evidence, {"sequenced": True})
                self.assertEqual(attempt.receipt_sha256, g040.canonical_sha256({key: getattr(attempt, key) for key in attempt.__dataclass_fields__ if key != "receipt_sha256"}))
                with self.assertRaises(g040.AuthorizationError): g040.consume_one_shot_attempt(journal, repository_root=root, authorization=verified(), callback=lambda _: None, now=2)

    def test_callback_failure_retains_marker(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as journal:
            os.chmod(journal, 0o700)
            with ExitStack() as stack:
                permissive_windows_custody(stack)
                with self.assertRaises(RuntimeError):
                    g040.consume_one_shot_attempt(journal, repository_root=root, authorization=verified(), callback=lambda _: (_ for _ in ()).throw(RuntimeError("failure")), now=1)
                self.assertEqual(len(tuple(Path(journal).iterdir())), 1)
                with self.assertRaises(g040.AuthorizationError): g040.consume_one_shot_attempt(journal, repository_root=root, authorization=verified(), callback=lambda _: None, now=2)

if __name__ == "__main__": unittest.main()
