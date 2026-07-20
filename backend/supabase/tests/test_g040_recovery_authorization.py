"""Contract tests for G040's canonical destructive-authority boundary."""
from __future__ import annotations

from contextlib import ExitStack, contextmanager, nullcontext
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
        issued_at=now, expires_at=now + 900, freeze_expires_at=now + 900, archive_bytes=0,
        final_recovery_commit="b" * 40, base_commit="92894e41cddb57767c9764d1694992bc0ad9d922",
        prefix_classification="UNAPPLIED", selected_branch="execute-00400-then-suffix")
    return value

def bindings(value): return {key: value[key] for key in g040._BINDINGS}

def verified():
    value = authority()
    return g040.VerifiedAuthorization(**value, authorization_sha256="b" * 64, signature_sha256="c" * 64, bindings_sha256="d" * 64)
def permissive_windows_custody(stack: ExitStack) -> None:
    if os.name == "nt":
        stack.enter_context(patch.object(g040, "_windows_restrictive", return_value=True))
        stack.enter_context(patch.object(g040, "_fsync_directory", return_value=None))
@contextmanager
def authorization_files(raw: bytes, signature: bytes = b"sig"):
    with tempfile.TemporaryDirectory() as repository, tempfile.TemporaryDirectory() as custody, ExitStack() as stack:
        if os.name == "nt":
            stack.enter_context(patch.object(g040, "_windows_restrictive", return_value=True))
        auth, sig = Path(custody) / "auth.json", Path(custody) / "auth.sig"
        auth.write_bytes(raw); sig.write_bytes(signature)
        os.chmod(repository, 0o700); os.chmod(custody, 0o700); os.chmod(auth, 0o600); os.chmod(sig, 0o600)
        yield Path(repository), auth, sig

class AuthorizationTests(unittest.TestCase):
    def test_exact_dataclass_and_binding_drift_are_required(self):
        value = authority(); raw = g040.canonical_json_bytes(value)
        with authorization_files(raw) as (repository, auth, sig), patch.object(g040, "_verify"):
            envelope = g040.authenticate_recovery_authorization(auth, sig, expected_bindings=bindings(value), repository_root=repository, now=1000)
            result = g040.reverify_destructive_stage(envelope, expected_bindings=bindings(value), now=1000)
        self.assertIs(type(result), g040.VerifiedAuthorization)
        self.assertEqual(result.bindings_sha256, g040.canonical_sha256(bindings(value)))
        class Derived(g040.VerifiedAuthorization): pass
        copied = {field.name: getattr(result, field.name) for field in __import__("dataclasses").fields(result)}
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(g040.AuthorizationError):
                g040.consume_one_shot_attempt(repository_root=root, authorization=Derived(**copied), callback=lambda _: None, now=1)
        for key in g040._BINDINGS:
            changed = dict(value); changed[key] = "c" * 64 if key != "selected_branch" else "wrong"
            with self.assertRaises(g040.AuthorizationError): g040._validate(value, bindings(changed), 1000)
    def test_new_authorization_fields_are_exact_and_individually_enforced(self):
        cases = (
            ("freeze_expires_at", "not-an-integer", 900),
            ("target_acl_root", "not-a-sha256", "c" * 64),
            ("backup_receipt_sha256", "not-a-sha256", "c" * 64),
            ("capture_receipt_sha256", "not-a-sha256", "c" * 64),
            ("archive_sha256", "not-a-sha256", "c" * 64),
            ("archive_bytes", "not-an-integer", 1),
        )
        for field, malformed, mismatched in cases:
            with self.subTest(field=field, condition="present_in_exact_schema"):
                self.assertIn(field, g040._FIELDS)
                self.assertIn(field, g040._BINDINGS)
                self.assertIn(field, g040.VerifiedAuthorization.__dataclass_fields__)
            with self.subTest(field=field, condition="absent"):
                value = authority(); value.pop(field)
                with self.assertRaises(g040.AuthorizationError):
                    g040._validate(value, bindings(authority()), 1000)
            with self.subTest(field=field, condition="malformed"):
                value = authority(); value[field] = malformed
                with self.assertRaises(g040.AuthorizationError):
                    g040._validate(value, bindings(value), 1000)
            with self.subTest(field=field, condition="binding_mismatch"):
                value = authority(); expected = bindings(value); expected[field] = mismatched
                with self.assertRaises(g040.AuthorizationError):
                    g040._validate(value, expected, 1000)

    def test_authorization_and_freeze_expiry_boundaries_are_denied(self):
        value = authority()
        with self.assertRaises(g040.AuthorizationError):
            g040._validate(dict(value, expires_at=1000), bindings(value), 1000)
        value = authority(now=0)
        value["freeze_expires_at"] = 800
        with self.assertRaises(g040.AuthorizationError):
            g040._validate(value, bindings(value), 800)

    def test_stale_cross_branch_duplicate_and_sanitized_errors(self):
        value = authority()
        with self.assertRaises(g040.AuthorizationError): g040._validate(dict(value, expires_at=1000), bindings(value), 1000)
        with self.assertRaises(g040.AuthorizationError): g040._validate(dict(value, selected_branch="adopt-00400-vector-then-suffix"), bindings(value), 1000)
        with self.assertRaises(g040.AuthorizationError): g040._decode(b'{"schema":"x","schema":"y"}')
        with authorization_files(g040.canonical_json_bytes(value)) as (repository, auth, sig):
            with patch.object(g040, "_verify", side_effect=RuntimeError("provider://private")):
                with self.assertRaises(g040.AuthorizationError) as captured:
                    g040.authenticate_recovery_authorization(auth, sig, expected_bindings=bindings(value), repository_root=repository, now=1000)
        self.assertIsNone(captured.exception.__cause__); self.assertIsNone(captured.exception.__context__)

    def test_same_handle_reread_ignores_path_replacement(self):
        value = authority(); raw = g040.canonical_json_bytes(value)
        with tempfile.TemporaryDirectory() as repository, tempfile.TemporaryDirectory() as temp:
            auth, sig = Path(temp) / "auth.json", Path(temp) / "auth.sig"
            auth.write_bytes(raw); sig.write_bytes(b"sig"); os.chmod(repository, 0o700); os.chmod(temp, 0o700); os.chmod(auth, 0o600); os.chmod(sig, 0o600)
            with ExitStack() as stack:
                permissive_windows_custody(stack)
                stack.enter_context(patch.object(g040, "_verify"))
                envelope = g040.authenticate_recovery_authorization(auth, sig, expected_bindings=bindings(value), repository_root=repository, now=1000)
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
    def test_request_is_exact_canonical_and_capped_by_freeze(self):
        value = authority(now=1000); expected = bindings(value)
        expected["freeze_expires_at"] = 1400
        with tempfile.TemporaryDirectory() as repository, tempfile.TemporaryDirectory() as custody:
            output = Path(custody) / "request.json"
            os.chmod(repository, 0o700); os.chmod(custody, 0o700)
            custody_check = patch.object(g040, "_windows_restrictive", return_value=True) if os.name == "nt" else nullcontext()
            with custody_check:
                receipt = g040.build_authorization_request(
                    authorization_id=value["authorization_id"], attempt_id=value["attempt_id"], expected_bindings=expected,
                    output=output, repository_root=repository, now_unix=1000, valid_seconds=900)
            raw = output.read_bytes(); parsed = g040._decode(raw)
        self.assertEqual(parsed, dict(schema=g040.SCHEMA, purpose=g040.PURPOSE, policy=g040.POLICY,
                                      authorization_id=value["authorization_id"], attempt_id=value["attempt_id"],
                                      issued_at=1000, expires_at=1400, **expected))
        self.assertEqual(receipt["authorization_sha256"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(receipt["expires_at"], 1400)
        self.assertFalse(raw.endswith(b"\n"))

    def test_request_rejects_invalid_bindings_or_repository_output(self):
        value = authority()
        with tempfile.TemporaryDirectory() as repository, tempfile.TemporaryDirectory() as custody:
            os.chmod(repository, 0o700); os.chmod(custody, 0o700)
            custody_check = patch.object(g040, "_windows_restrictive", return_value=True) if os.name == "nt" else nullcontext()
            with custody_check:
                bad = bindings(value); bad.pop("archive_sha256")
                with self.assertRaises(g040.AuthorizationError):
                    g040.build_authorization_request(authorization_id=value["authorization_id"], attempt_id=value["attempt_id"],
                        expected_bindings=bad, output=Path(custody) / "missing.json", repository_root=repository, now_unix=1000)
                with self.assertRaises(g040.AuthorizationError):
                    g040.build_authorization_request(authorization_id=value["authorization_id"], attempt_id=value["attempt_id"],
                        expected_bindings=bindings(value), output=Path(repository) / "inside.json", repository_root=repository, now_unix=1000)
            self.assertFalse((Path(custody) / "missing.json").exists())

    def test_authentication_is_path_only_and_envelope_exposes_no_raw_material(self):
        value = authority(); raw = g040.canonical_json_bytes(value)
        with authorization_files(raw) as (repository, auth, sig), patch.object(g040, "_verify"):
            for authorization, signature, expected in ((raw, sig, bindings(value)), (auth, b"sig", bindings(value)), (auth, sig, None)):
                with self.subTest(authorization_type=type(authorization).__name__, expected=expected is None):
                    with self.assertRaises(g040.AuthorizationError):
                        g040.authenticate_recovery_authorization(authorization, signature, expected_bindings=expected, repository_root=repository, now=1000)
            envelope = g040.authenticate_recovery_authorization(auth, sig, expected_bindings=bindings(value), repository_root=repository, now=1000)
            self.assertNotIn("raw", envelope.__dataclass_fields__)
            self.assertNotIn("signature", envelope.__dataclass_fields__)
            self.assertNotIn(hashlib.sha256(raw).hexdigest(), repr(envelope))
            g040.reverify_destructive_stage(envelope, expected_bindings=bindings(value), now=1000)
            outcome = g040.authenticate_outcome_authorization(auth, sig, repository_root=repository, now=999999)
            self.assertEqual(g040.verify_outcome_authorization(outcome, now=999999).authorization_sha256, hashlib.sha256(raw).hexdigest())
            broken = dict(value, policy="wrong-policy")
            auth.write_bytes(g040.canonical_json_bytes(broken))
            with self.assertRaises(g040.AuthorizationError):
                g040.authenticate_outcome_authorization(auth, sig, repository_root=repository, now=999999)

    def test_parser_has_request_and_verify_without_private_key_surface(self):
        parser = g040.build_parser()
        request = parser.parse_args(["build-request", "--repository-root", "root", "--bindings", "bindings.json",
                                     "--authorization-id", authority()["authorization_id"], "--attempt-id", authority()["attempt_id"],
                                     "--output", "request.json"])
        self.assertEqual(request.command, "build-request")
        with self.assertRaises(SystemExit):
            parser.parse_args(["build-request", "--private-key", "secret", "--repository-root", "root", "--bindings", "b",
                               "--authorization-id", authority()["authorization_id"], "--attempt-id", authority()["attempt_id"], "--output", "o"])

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
    def test_default_journal_root_is_fixed_and_missing_root_is_not_created(self):
        expected = Path("C:/ProgramData/TzudongRecovery/g040-attempt-journal") if os.name == "nt" else Path("/var/lib/tzudong-recovery/g040-attempt-journal")
        self.assertEqual(g040.CANONICAL_JOURNAL_DIRECTORY, expected)
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as parent:
            missing = Path(parent) / "missing"
            with patch.object(g040, "CANONICAL_JOURNAL_DIRECTORY", missing):
                with self.assertRaises(g040.AuthorizationError):
                    g040.canonical_journal_parent(root)
            self.assertFalse(missing.exists())
    def test_marker_precedes_callback_and_returns_exact_evidence(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as journal, tempfile.TemporaryDirectory() as alternate:
            os.chmod(journal, 0o700); os.chmod(alternate, 0o700); seen = []
            def callback(attempt):
                self.assertIs(type(attempt), g040.AttemptStarted)
                seen.append(any(Path(journal).iterdir())); return {"sequenced": True}
            with ExitStack() as stack:
                permissive_windows_custody(stack)
                stack.enter_context(patch.object(g040, "CANONICAL_JOURNAL_DIRECTORY", Path(journal)))
                attempt, evidence = g040.consume_one_shot_attempt(repository_root=root, authorization=verified(), callback=callback, now=1)
                self.assertTrue(seen[0]); self.assertEqual(evidence, {"sequenced": True})
                self.assertEqual(attempt.receipt_sha256, g040.canonical_sha256({key: getattr(attempt, key) for key in attempt.__dataclass_fields__ if key != "receipt_sha256"}))
                with self.assertRaises(TypeError):
                    g040.consume_one_shot_attempt(alternate, repository_root=root, authorization=verified(), callback=lambda _: None, now=2)
                self.assertEqual(tuple(Path(alternate).iterdir()), ())
                with self.assertRaises(g040.AuthorizationError):
                    g040.consume_one_shot_attempt(repository_root=root, authorization=verified(), callback=lambda _: None, now=2)

    def test_callback_failure_retains_marker(self):
        with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as journal:
            os.chmod(journal, 0o700)
            with ExitStack() as stack:
                permissive_windows_custody(stack)
                stack.enter_context(patch.object(g040, "CANONICAL_JOURNAL_DIRECTORY", Path(journal)))
                with self.assertRaises(RuntimeError):
                    g040.consume_one_shot_attempt(repository_root=root, authorization=verified(), callback=lambda _: (_ for _ in ()).throw(RuntimeError("failure")), now=1)
                self.assertEqual(len(tuple(Path(journal).iterdir())), 1)
                with self.assertRaises(g040.AuthorizationError):
                    g040.consume_one_shot_attempt(repository_root=root, authorization=verified(), callback=lambda _: None, now=2)

if __name__ == "__main__": unittest.main()
