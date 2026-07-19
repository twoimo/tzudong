"""Contract tests for G040's canonical destructive-authority boundary."""
from __future__ import annotations

from contextlib import ExitStack
import ctypes
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

    def test_windows_acl_uses_stable_sids_and_rejects_unsafe_aces(self):
        class Kernel32:
            def __init__(self): self.freed = []
            def LocalFree(self, value): self.freed.append(value.value); return None

        class Advapi32:
            def __init__(self, aces, status=0):
                self.aces, self.status = aces, status
                self.buffers = []
            def GetNamedSecurityInfoW(self, path, kind, flags, owner, group, dacl, sacl, descriptor):
                ctypes.cast(owner, ctypes.POINTER(ctypes.c_void_p)).contents.value = 0x1111
                ctypes.cast(dacl, ctypes.POINTER(ctypes.c_void_p)).contents.value = 0x2222
                ctypes.cast(descriptor, ctypes.POINTER(ctypes.c_void_p)).contents.value = 0x3333
                return self.status
            def CreateWellKnownSid(self, sid_type, domain, buffer, size):
                ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)).contents.value = 2 if sid_type == g040._WIN_LOCAL_SYSTEM_SID else 3
                return 1
            def GetAclInformation(self, dacl, info, size, info_class):
                ctypes.cast(info, ctypes.POINTER(g040._AclSizeInformation)).contents.ace_count = len(self.aces)
                return 1
            def GetAce(self, dacl, index, ace):
                ctypes.cast(ace, ctypes.POINTER(ctypes.c_void_p)).contents.value = ctypes.addressof(self.aces[index])
                return 1
            def EqualSid(self, left, right):
                left_value = left.value if hasattr(left, "value") else ctypes.cast(left, ctypes.c_void_p).value
                right_value = right.value if hasattr(right, "value") else ctypes.cast(right, ctypes.c_void_p).value
                if left_value == 0x1111:
                    return ctypes.c_ubyte.from_address(right_value).value == 1
                return ctypes.c_ubyte.from_address(left_value).value == ctypes.c_ubyte.from_address(right_value).value

        def ace(sid, mask=0x001F01FF, flags=0):
            value = ctypes.create_string_buffer(16)
            header = g040._AceHeader.from_buffer(value)
            header.ace_type, header.ace_flags, header.ace_size = g040._ACCESS_ALLOWED_ACE_TYPE, flags, 16
            ctypes.c_uint32.from_buffer(value, 4).value = mask
            ctypes.c_ubyte.from_buffer(value, 8).value = sid
            return value

        cases = (
            ("localized_owner_name_is_irrelevant", [ace(1), ace(2), ace(3)], 0, True),
            ("broad_sid_is_denied", [ace(1), ace(4)], 0, False),
            ("inherited_write_is_denied", [ace(1, flags=g040._INHERITED_ACE)], 0, False),
            ("api_failure_is_denied", [ace(1)], 5, False),
        )
        for name, aces, status, expected in cases:
            with self.subTest(name=name):
                kernel32, advapi32 = Kernel32(), Advapi32(aces, status)
                with patch.object(g040, "_windows_api", return_value=(kernel32, advapi32)):
                    self.assertIs(g040._windows_restrictive(Path(r"C:\한글\authority")), expected)
                self.assertEqual(kernel32.freed, [0x3333])

    def test_windows_flush_preserves_x64_handle_and_closes_on_failure(self):
        class Kernel32:
            def __init__(self, flush): self.flush, self.closed = flush, []
            def CreateFileW(self, *args): return 0x1_0000_0001
            def FlushFileBuffers(self, handle): return self.flush
            def CloseHandle(self, handle): self.closed.append(handle); return 1

        for flush, raises in ((1, False), (0, True)):
            with self.subTest(flush=flush):
                kernel32 = Kernel32(flush)
                with patch.object(g040.os, "name", "nt"), patch.object(g040, "_windows_api", return_value=(kernel32, object())):
                    if raises:
                        with self.assertRaises(g040.AuthorizationError):
                            g040._fsync_directory(Path(r"C:\journal"))
                    else:
                        g040._fsync_directory(Path(r"C:\journal"))
                self.assertEqual(kernel32.closed, [0x1_0000_0001])

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
