"""Contract tests for G038's separate fixed-key successor authority."""
from __future__ import annotations

from contextlib import ExitStack, contextmanager, nullcontext
from dataclasses import fields
import hashlib
import importlib.util
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

MODULE = Path(__file__).parents[1] / "scripts" / "g038_successor_authorization.py"
spec = importlib.util.spec_from_file_location("g038_successor_authorization_under_test", MODULE)
g038 = importlib.util.module_from_spec(spec); assert spec.loader
sys.modules[spec.name] = g038; spec.loader.exec_module(g038)


def authority(now: int = 1000, *, authorization_id: str = "123e4567-e89b-42d3-a456-426614174000", attempt_id: str = "123e4567-e89b-42d3-a456-426614174001") -> dict[str, object]:
    value: dict[str, object] = {key: "a" * 64 for key in g038._ROOT_FIELDS | g038._RECEIPT_FIELDS}
    value.update(
        schema=g038.SCHEMA, purpose=g038.PURPOSE, policy=g038.POLICY,
        authorization_id=authorization_id, attempt_id=attempt_id, issued_at=now, expires_at=now + 600,
        target_fingerprint="a" * 64, target_acl_root="a" * 64,
        g038_source_commit="b" * 40, predecessor_commit=g038.PREDECESSOR_COMMIT,
        predecessor_report_sha256=g038.PREDECESSOR_REPORT_SHA256,
        archive_bytes=42, freeze_expires_at=now + 600,
        predecessor_rows=40, target_rows=42,
        selected_versions=list(g038.SELECTED_VERSIONS),
    )
    return value


def bindings(value: dict[str, object]) -> dict[str, object]:
    return {key: value[key] for key in g038._BINDINGS}


def verified(**changes: object):
    value = authority(); value.update(changes)
    return g038.VerifiedAuthorization(**value, authorization_sha256="b" * 64, signature_sha256="c" * 64, bindings_sha256="d" * 64)


@contextmanager
def authorization_files(raw: bytes, signature: bytes = b"signature"):
    with tempfile.TemporaryDirectory() as repository, tempfile.TemporaryDirectory() as custody, ExitStack() as stack:
        if os.name == "nt":
            stack.enter_context(patch.object(g038, "_windows_restrictive", return_value=True))
        auth = Path(custody) / "authorization.json"; sig = Path(custody) / "authorization.sig"
        auth.write_bytes(raw); sig.write_bytes(signature)
        os.chmod(repository, 0o700); os.chmod(custody, 0o700); os.chmod(auth, 0o600); os.chmod(sig, 0o600)
        yield Path(repository), auth, sig


class AuthorizationTests(unittest.TestCase):
    def test_domain_key_exact_schema_and_every_binding_are_separate(self):
        self.assertNotIn("g040", g038.SCHEMA + g038.PURPOSE + g038.POLICY + str(g038.CANONICAL_JOURNAL_DIRECTORY))
        self.assertTrue(g038.PUBLIC_KEY_PEM.startswith("-----BEGIN PUBLIC KEY-----"))
        self.assertEqual(
            hashlib.sha256(g038.PUBLIC_KEY_PEM.encode("ascii")).hexdigest(),
            g038.PUBLIC_KEY_SHA256,
        )
        expected_journal = (
            Path("C:/ProgramData/TzudongRecovery/g038-successor-attempt-journal")
            if os.name == "nt"
            else (
                Path.home()
                / "Library/Application Support/TzudongRecovery/g038-successor-attempt-journal"
                if sys.platform == "darwin"
                else Path("/var/lib/tzudong-recovery/g038-successor-attempt-journal")
            )
        )
        self.assertEqual(g038.CANONICAL_JOURNAL_DIRECTORY, expected_journal)
        value = authority()
        for name in ("schema", "purpose", "policy"):
            changed = dict(value); changed[name] = "wrong-domain"
            with self.subTest(name=name), self.assertRaises(g038.AuthorizationError):
                g038._validate(changed, bindings(value), 1000)
        for name in g038._BINDINGS:
            expected = bindings(value)
            expected[name] = list(reversed(g038.SELECTED_VERSIONS)) if name == "selected_versions" else "c" * (40 if name in {"g038_source_commit", "predecessor_commit"} else 64)
            with self.subTest(binding=name), self.assertRaises(g038.AuthorizationError):
                g038._validate(value, expected, 1000)
        missing = bindings(value)
        del missing["source_validation_receipt_sha256"]
        with self.assertRaises(g038.AuthorizationError):
            g038._validate(value, missing, 1000)
        omitted = dict(value)
        del omitted["source_validation_receipt_sha256"]
        with self.assertRaises(g038.AuthorizationError):
            g038._validate(omitted, bindings(value), 1000)

    def test_wrong_fixed_key_and_signature_fail_closed(self):
        value = authority(); raw = g038.canonical_json_bytes(value)
        with patch.object(g038, "PUBLIC_KEY_SHA256", "0" * 64), self.assertRaises(g038.AuthorizationError):
            g038._verify(raw, b"not-a-signature")
        with self.assertRaises(g038.AuthorizationError):
            g038._verify(raw, b"not-a-signature")

    def test_exact_types_selected_versions_and_subclasses_are_rejected(self):
        value = authority()
        for name, malformed in (("archive_bytes", True), ("issued_at", 1000.0), ("g038_source_commit", "b" * 39), ("selected_versions", tuple(g038.SELECTED_VERSIONS)), ("selected_versions", [*g038.SELECTED_VERSIONS, "20260713002500"])):
            changed = dict(value); changed[name] = malformed
            with self.subTest(name=name, malformed=malformed), self.assertRaises(g038.AuthorizationError):
                g038._validate(changed, bindings(changed), 1000)
        class DictSubclass(dict): pass
        with self.assertRaises(g038.AuthorizationError):
            g038._validate(DictSubclass(value), bindings(value), 1000)
        class Derived(g038.VerifiedAuthorization): pass
        copied = {field.name: getattr(verified(), field.name) for field in fields(g038.VerifiedAuthorization)}
        with tempfile.TemporaryDirectory() as root, self.assertRaises(g038.AuthorizationError):
            g038.consume_one_shot_attempt(repository_root=root, authorization=Derived(**copied), callback=lambda _: None)

    def test_duplicate_noncanonical_and_nonfinite_json_are_rejected(self):
        for raw in (b'{"schema":"a","schema":"b"}', b'{"x": NaN}', b'{"x":1 }', b'\xff'):
            with self.subTest(raw=raw), self.assertRaises(g038.AuthorizationError):
                g038._decode(raw)

    def test_expiry_future_time_and_freeze_boundaries_are_denied(self):
        value = authority()
        for changed in (
            dict(value, expires_at=1000),
            dict(value, freeze_expires_at=1000),
            dict(value, issued_at=1031, expires_at=1200, freeze_expires_at=1200),
            dict(value, expires_at=1901, freeze_expires_at=1901),
        ):
            with self.assertRaises(g038.AuthorizationError):
                g038._validate(changed, bindings(changed), 1000)

    def test_path_only_same_handle_reverification_survives_path_replacement(self):
        value = authority(); raw = g038.canonical_json_bytes(value)
        with authorization_files(raw) as (repository, auth, sig), patch.object(g038, "_verify"):
            envelope = g038.authenticate_successor_authorization(auth, sig, expected_bindings=bindings(value), repository_root=repository, now=1000)
            replacement = auth.with_name("replacement.json"); replacement.write_bytes(b"changed"); os.chmod(replacement, 0o600)
            if os.name == "nt":
                with self.assertRaises(PermissionError): os.replace(replacement, auth)
            else:
                os.replace(replacement, auth)
            result = g038.reverify_destructive_stage(envelope, expected_bindings=bindings(value), now=1000)
            self.assertEqual(result.authorization_sha256, hashlib.sha256(raw).hexdigest())
            with self.assertRaises(g038.AuthorizationError):
                g038.reverify_destructive_stage(envelope, expected_bindings=bindings(value), now=1000)

    def test_authentication_rejects_bytes_and_historical_readback_is_separate(self):
        value = authority(); raw = g038.canonical_json_bytes(value)
        with authorization_files(raw) as (repository, auth, sig), patch.object(g038, "_verify"):
            with self.assertRaises(g038.AuthorizationError):
                g038.authenticate_successor_authorization(raw, sig, expected_bindings=bindings(value), repository_root=repository, now=1000)
            destructive = g038.authenticate_successor_authorization(auth, sig, expected_bindings=bindings(value), repository_root=repository, now=1000)
            self.assertIs(type(g038.reverify_destructive_stage(destructive, expected_bindings=bindings(value), now=1000)), g038.VerifiedAuthorization)
            historical = g038.authenticate_outcome_authorization(auth, sig, repository_root=repository, now=999999)
            self.assertIs(type(g038.verify_outcome_authorization(historical, now=999999)), g038.VerifiedAuthorization)

    def test_request_is_canonical_external_no_clobber_and_has_no_signer_surface(self):
        value = authority(); expected = bindings(value)
        with tempfile.TemporaryDirectory() as repository, tempfile.TemporaryDirectory() as custody:
            os.chmod(repository, 0o700); os.chmod(custody, 0o700)
            output = Path(custody) / "request.json"
            custody_check = patch.object(g038, "_windows_restrictive", return_value=True) if os.name == "nt" else nullcontext()
            with custody_check:
                g038.build_authorization_request(authorization_id=value["authorization_id"], attempt_id=value["attempt_id"], expected_bindings=expected, output=output, repository_root=repository, now_unix=1000)
                with self.assertRaises(g038.AuthorizationError):
                    g038.build_authorization_request(authorization_id=value["authorization_id"], attempt_id=value["attempt_id"], expected_bindings=expected, output=output, repository_root=repository, now_unix=1000)
            self.assertEqual(output.read_bytes(), g038.canonical_json_bytes(g038._decode(output.read_bytes())))
        parser = g038.build_parser()
        with self.assertRaises(SystemExit):
            parser.parse_args(["build-request", "--private-key", "secret"])


class JournalTests(unittest.TestCase):
    def _consume(self, directory: Path, authorization, callback=lambda _: "called"):
        with patch.object(g038, "CANONICAL_JOURNAL_DIRECTORY", directory):
            return g038.consume_one_shot_attempt(repository_root=directory.parent / "repository", authorization=authorization, callback=callback, now=1001)

    def test_marker_is_restrictive_durable_and_precedes_database_callback(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); repository = root / "repository"; journal = root / "journal"
            repository.mkdir(mode=0o700); journal.mkdir(mode=0o700)
            observed: list[tuple[str, ...]] = []
            def callback(_):
                observed.append(tuple(sorted(path.name for path in journal.iterdir())))
                return "db-admitted"
            attempt, result = self._consume(journal, verified(), callback)
            self.assertEqual(result, "db-admitted")
            self.assertEqual(len(observed[0]), 2)
            for marker in journal.iterdir():
                self.assertEqual(stat.S_IMODE(marker.stat().st_mode), 0o600)
                self.assertEqual(g038._decode(marker.read_bytes())["receipt_sha256"], attempt.receipt_sha256)

    def test_authorization_and_attempt_ids_are_independently_one_shot_without_clobber(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); repository = root / "repository"; journal = root / "journal"
            repository.mkdir(mode=0o700); journal.mkdir(mode=0o700)
            first = verified()
            self._consume(journal, first)
            marker_bytes = {path.name: path.read_bytes() for path in journal.iterdir()}
            reused_authorization = verified(attempt_id="123e4567-e89b-42d3-a456-426614174002")
            reused_attempt = verified(authorization_id="123e4567-e89b-42d3-a456-426614174003")
            for candidate in (first, reused_authorization, reused_attempt):
                with self.assertRaises(g038.AuthorizationError):
                    self._consume(journal, candidate)
            for name, raw in marker_bytes.items():
                self.assertEqual((journal / name).read_bytes(), raw)

    def test_missing_or_permissive_journal_is_never_created_or_used(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); repository = root / "repository"; repository.mkdir(mode=0o700)
            missing = root / "missing"
            with patch.object(g038, "CANONICAL_JOURNAL_DIRECTORY", missing), self.assertRaises(g038.AuthorizationError):
                g038.consume_one_shot_attempt(repository_root=repository, authorization=verified(), callback=lambda _: None)
            self.assertFalse(missing.exists())
            permissive = root / "permissive"; permissive.mkdir(mode=0o755); os.chmod(permissive, 0o755)
            if os.name != "nt":
                with patch.object(g038, "CANONICAL_JOURNAL_DIRECTORY", permissive), self.assertRaises(g038.AuthorizationError):
                    g038.consume_one_shot_attempt(repository_root=repository, authorization=verified(), callback=lambda _: None)

    @unittest.skipIf(os.name == "nt", "POSIX descriptor-relative race contract")
    def test_parent_replacement_before_first_marker_fails_closed_in_held_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); repository = root / "repository"; journal = root / "journal"
            displaced = root / "displaced"; replacement = root / "replacement"
            repository.mkdir(mode=0o700); journal.mkdir(mode=0o700)
            callback_called = False
            original_open = os.open
            replaced = False

            def racing_open(path, flags, mode=0o777, *, dir_fd=None):
                nonlocal replaced
                if dir_fd is not None and flags & os.O_CREAT and not replaced:
                    journal.rename(displaced)
                    replacement.mkdir(mode=0o700)
                    replacement.rename(journal)
                    replaced = True
                return original_open(path, flags, mode, dir_fd=dir_fd)

            def callback(_):
                nonlocal callback_called
                callback_called = True

            with patch.object(g038.os, "open", side_effect=racing_open), self.assertRaises(g038.AuthorizationError):
                self._consume(journal, verified(), callback)
            self.assertFalse(callback_called)
            self.assertEqual(list(journal.iterdir()), [])
            self.assertEqual(len(list(displaced.iterdir())), 1)

            journal.rename(replacement)
            displaced.rename(journal)
            with self.assertRaises(g038.AuthorizationError):
                self._consume(journal, verified())

    @unittest.skipIf(os.name == "nt", "POSIX descriptor-relative race contract")
    def test_parent_replacement_between_markers_fails_closed_and_remains_consumed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); repository = root / "repository"; journal = root / "journal"
            displaced = root / "displaced"; replacement = root / "replacement"
            repository.mkdir(mode=0o700); journal.mkdir(mode=0o700)
            callback_called = False
            original_write_all = g038._write_all
            replaced = False

            def racing_write(fd, data):
                nonlocal replaced
                original_write_all(fd, data)
                if not replaced:
                    journal.rename(displaced)
                    replacement.mkdir(mode=0o700)
                    replacement.rename(journal)
                    replaced = True

            def callback(_):
                nonlocal callback_called
                callback_called = True

            with patch.object(g038, "_write_all", side_effect=racing_write), self.assertRaises(g038.AuthorizationError):
                self._consume(journal, verified(), callback)
            self.assertFalse(callback_called)
            self.assertEqual(list(journal.iterdir()), [])
            self.assertEqual(len(list(displaced.iterdir())), 1)

            journal.rename(replacement)
            displaced.rename(journal)
            with self.assertRaises(g038.AuthorizationError):
                self._consume(journal, verified())


if __name__ == "__main__":
    unittest.main()
