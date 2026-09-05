from __future__ import annotations
import base64
import hashlib
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parents[1] / "scripts"))
import g035_hosted_recovery_contract as g035
import g037_hosted_closure_contract as closure
import g037_remediation_authorization as c
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat


class G037AuthorityTests(unittest.TestCase):
    now = 1_700_000_000

    def setUp(self):
        self.key = Ed25519PrivateKey.generate()
        self.pem = self.key.public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo).decode()
        self.patches = [
            patch.object(c, "PUBLIC_KEY_PEM", self.pem),
            patch.object(c, "PUBLIC_KEY_SHA256", hashlib.sha256(self.pem.encode()).hexdigest()),
            patch.object(g035, "REMEDIATION_PUBLIC_KEY_PEM", self.pem),
            patch.object(g035, "REMEDIATION_PUBLIC_KEY_SHA256", hashlib.sha256(self.pem.encode()).hexdigest()),
        ]
        for item in self.patches:
            item.start()
        self.addCleanup(lambda: [item.stop() for item in reversed(self.patches)])

    def digest(self, char): return char * 64
    def custody(self, path, label):
        if not Path(path).is_file(): raise c.ContractError(label)

    def receipt(self, mode, status, prior):
        value = {"schema": c.RECEIPT_SCHEMA, "mode": mode, "status": status,
                 "manifest_sha256": c.MANIFEST_SHA256, "prior_receipt_sha256": prior,
                 "evidence": self.evidence(), "receipt_sha256": ""}
        value["receipt_sha256"] = c.canonical_sha256({k: v for k, v in value.items() if k != "receipt_sha256"})
        return value

    def evidence(self):
        return {"selection_spec_sha256": self.digest("1"), "short_urls_catalog_sha256": self.digest("2"),
                "pre_short_urls_rowset_sha256": self.digest("3"), "duplicate_group_count": 1,
                "duplicate_victim_count": 1, "duplicate_victims_sha256": self.digest("4"),
                "victim_descriptors_sha256": self.digest("5")}
    def authorization_vector(self):
        return {**self.evidence(), "batch_id": "11111111-1111-4111-8111-111111111111"}

    def files(self, directory, mutate=None):
        capture = self.receipt("capture", "captured", [])
        restore = self.receipt("restore-verify", "restored", [capture["receipt_sha256"]])
        inspection = self.receipt("short-url-remediation-inspect", "validated", [restore["receipt_sha256"]])
        auth = {"schema": g035.REMEDIATION_AUTHORIZATION_SCHEMA, "capture_receipt_sha256": capture["receipt_sha256"],
                "restore_receipt_sha256": restore["receipt_sha256"], "inspection_receipt_sha256": inspection["receipt_sha256"],
                "manifest_sha256": c.MANIFEST_SHA256, "repository_commit": "e" * 40, **self.authorization_vector()}
        if mutate: mutate(capture, restore, inspection, auth)
        paths = []
        for name, value in (("capture", capture), ("restore", restore), ("inspection", inspection), ("legacy", auth)):
            path = Path(directory) / name
            path.write_bytes(c.canonical_json_bytes(value)); paths.append(path)
        sig = Path(directory) / "legacy.sig"; sig.write_bytes(self.key.sign(paths[-1].read_bytes())); paths.append(sig)
        return paths

    def chain(self, directory):
        return c.verify_legacy_remediation_chain(*self.files(directory), require_custody=self.custody)

    def value(self, chain=None):
        chain = chain or c.VerifiedLegacyRemediationChain(self.digest("a"), self.digest("b"), self.digest("c"), "e" * 40, self.digest("d"), self.digest("e"), tuple(self.authorization_vector().items()))
        return c.build_execution_authorization_template(chain, origin="https://abcdefghijklmnopqrst.supabase.co", project="abcdefghijklmnopqrst", current_commit="f" * 40, manifest_sha256=c.MANIFEST_SHA256, source_root=self.digest("1"), terminal_spec=self.digest("2"), freeze_id="freeze-0001", operator_assertion_sha256=self.digest("3"), operator_assertion_expires_at=self.now + 1000, recipient_fingerprint=self.digest("4"), recovery_public_key_fingerprint=self.digest("5"), capture_scope_sha256=self.digest("6"), authorization_id="11111111-1111-4111-8111-111111111111", issued_at=self.now, expires_at=self.now + 100)

    def bindings(self, value): return {key: value[key] for key in c._BINDINGS}
    def envelope(self, directory, value=None):
        value = value or self.value(); auth = Path(directory) / "execution"; sig = Path(directory) / "execution.sig"
        auth.write_bytes(c.canonical_json_bytes(value)); sig.write_bytes(self.key.sign(auth.read_bytes()))
        return auth, sig, value

    def test_real_signed_full_authority_flow(self):
        with tempfile.TemporaryDirectory() as directory:
            chain = self.chain(directory); self.assertEqual(chain.legacy_repository_commit, "e" * 40); self.assertEqual(dict(chain.legacy_vector)["batch_id"], "11111111-1111-4111-8111-111111111111")
            auth, sig, value = self.envelope(directory, self.value(chain))
            result = c.verify_execution_authorization(auth, sig, require_custody=self.custody, expected_bindings=self.bindings(value), now=self.now + 1, baseline_is_exact=lambda: True)
            self.assertEqual(result["current_commit"], "f" * 40); self.assertEqual(result["legacy_repository_commit"], "e" * 40)
            with self.assertRaises(TypeError): result["legacy_vector"]["batch_id"] = "x"

    def test_execution_duplicate_extra_missing_and_noncanonical_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            auth, sig, value = self.envelope(directory)
            cases = [b'{"schema":"x","schema":"y"}', c.canonical_json_bytes({**value, "extra": 1}), c.canonical_json_bytes({k:v for k,v in value.items() if k != "policy"}), b'{"x":NaN}', b'{"x":Infinity}']
            for raw in cases:
                with self.subTest(raw=raw):
                    auth.write_bytes(raw); sig.write_bytes(self.key.sign(raw))
                    with self.assertRaises(c.ContractError): c.authenticate_execution_authorization_document(auth, sig, require_custody=self.custody, expected_bindings=self.bindings(value), now=self.now)

    def test_receipt_schema_mode_status_manifest_prior_evidence_and_digest_drift_rejected(self):
        cases = [("schema", "bad"), ("mode", "bad"), ("status", "bad"), ("manifest_sha256", self.digest("0")), ("prior_receipt_sha256", ["x"]), ("evidence", []), ("receipt_sha256", self.digest("0"))]
        for key, replacement in cases:
            with self.subTest(key=key), tempfile.TemporaryDirectory() as directory:
                def mutate(capture, restore, inspection, auth): capture[key] = replacement
                with self.assertRaises(c.ContractError): self.chain_with(directory, mutate)

    def chain_with(self, directory, mutate):
        return c.verify_legacy_remediation_chain(*self.files(directory, mutate), require_custody=self.custody)

    def test_legacy_authorization_batch_id_signature_and_commit_drift_rejected(self):
        for key, replacement in [("manifest_sha256", self.digest("0")), ("repository_commit", "z" * 40)]:
            with self.subTest(key=key), tempfile.TemporaryDirectory() as directory:
                def mutate(capture, restore, inspection, auth): auth[key] = replacement
                with self.assertRaises(c.ContractError): self.chain_with(directory, mutate)
        for key, replacement in [("missing", None), ("invalid", "not-uuid")]:
            with self.subTest(key=key), tempfile.TemporaryDirectory() as directory:
                def mutate(capture, restore, inspection, auth):
                    if key == "missing": del auth["batch_id"]
                    else: auth["batch_id"] = replacement
                with self.assertRaises(c.ContractError): self.chain_with(directory, mutate)
        with tempfile.TemporaryDirectory() as directory:
            paths = self.files(directory); paths[-1].write_bytes(b"substituted")
            with self.assertRaises(c.ContractError): c.verify_legacy_remediation_chain(*paths, require_custody=self.custody)

    def test_legacy_inspection_requires_exact_seven_field_schema_and_auth_match(self):
        for key, replacement in [("selection_spec_sha256", self.digest("0")), ("short_urls_catalog_sha256", self.digest("0")), ("pre_short_urls_rowset_sha256", self.digest("0")), ("duplicate_group_count", 2), ("duplicate_victim_count", 2), ("duplicate_victims_sha256", self.digest("0")), ("victim_descriptors_sha256", self.digest("0"))]:
            with self.subTest(key=key), tempfile.TemporaryDirectory() as directory:
                def mutate(capture, restore, inspection, auth): auth[key] = replacement
                with self.assertRaises(c.ContractError): self.chain_with(directory, mutate)
        with tempfile.TemporaryDirectory() as directory:
            def mutate(capture, restore, inspection, auth):
                inspection["evidence"]["batch_id"] = auth["batch_id"]
                inspection["receipt_sha256"] = c.canonical_sha256({k: v for k, v in inspection.items() if k != "receipt_sha256"})
                auth["inspection_receipt_sha256"] = inspection["receipt_sha256"]
            with self.assertRaises(c.ContractError): self.chain_with(directory, mutate)

    def test_legacy_path_replacement_during_verification_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = self.files(directory); original = c._verify
            def replace(raw, signature, pem):
                paths[3].write_bytes(b"{}"); original(raw, signature, pem)
            with patch.object(c, "_verify", side_effect=replace), self.assertRaises(c.ContractError):
                c.verify_legacy_remediation_chain(*paths, require_custody=self.custody)

    def test_template_rejects_wrong_target_bindings(self):
        with tempfile.TemporaryDirectory() as directory:
            chain = self.chain(directory); base = dict(origin="https://abcdefghijklmnopqrst.supabase.co", project="abcdefghijklmnopqrst", current_commit="f"*40, manifest_sha256=c.MANIFEST_SHA256, source_root=self.digest("1"), terminal_spec=self.digest("2"), freeze_id="freeze-0001", operator_assertion_sha256=self.digest("3"), operator_assertion_expires_at=self.now+1000, recipient_fingerprint=self.digest("4"), recovery_public_key_fingerprint=self.digest("5"), capture_scope_sha256=self.digest("6"), authorization_id="11111111-1111-4111-8111-111111111111", issued_at=self.now, expires_at=self.now+100)
            for key, bad in [("origin", "https://bad.supabase.co"), ("project", "bad"), ("current_commit", "z"*40), ("freeze_id", "bad"), ("operator_assertion_sha256", "x"), ("source_root", "x"), ("recipient_fingerprint", "x"), ("recovery_public_key_fingerprint", "x"), ("capture_scope_sha256", "x"), ("authorization_id", "not-uuid"), ("manifest_sha256", self.digest("0"))]:
                with self.subTest(key=key), self.assertRaises(c.ContractError): c.build_execution_authorization_template(chain, **{**base, key: bad})

    def test_template_rejects_future_fields_and_policy_drift(self):
        value = self.value()
        for change in ({"future_ciphertext_sha256": self.digest("a")}, {"policy": "other"}, {"purpose": "other"}):
            with self.subTest(change=change), self.assertRaises(c.ContractError): c._validate({**value, **change}, self.bindings(value), self.now)

    def test_time_windows_fail_closed(self):
        value = self.value()
        for change in ({"expires_at": self.now}, {"issued_at": self.now+31, "expires_at": self.now+100}, {"expires_at": self.now+901}, {"expires_at": self.now+1001}):
            with self.subTest(change=change), self.assertRaises(c.ContractError): c._validate({**value, **change}, self.bindings(value), self.now)

    def test_hostile_envelope_types_and_subclasses_rejected(self):
        class Bytes(bytes): pass
        value = self.value()
        for envelope in (object(), c.ExecutionAuthorizationEnvelope(Bytes(b"{}"), b"x"), c.ExecutionAuthorizationEnvelope(b"{}", Bytes(b"x"))):
            with self.subTest(envelope=type(envelope)), self.assertRaises(c.ContractError): c.authorize_exact_baseline(envelope, expected_bindings=self.bindings(value), now=self.now, baseline_is_exact=lambda: True)

    def test_substituted_execution_raw_and_signature_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            auth, sig, value = self.envelope(directory)
            env = c.authenticate_execution_authorization_document(auth, sig, require_custody=self.custody, expected_bindings=self.bindings(value), now=self.now)
            for bad in (c.ExecutionAuthorizationEnvelope(env.raw + b" ", env.signature), c.ExecutionAuthorizationEnvelope(env.raw, b"x")):
                with self.subTest(bad=bad), self.assertRaises(c.ContractError): c.authorize_exact_baseline(bad, expected_bindings=self.bindings(value), now=self.now, baseline_is_exact=lambda: True)

    def test_nonexact_baseline_rejected_after_real_verification(self):
        with tempfile.TemporaryDirectory() as directory:
            auth, sig, value = self.envelope(directory)
            with self.assertRaises(c.ContractError): c.verify_execution_authorization(auth, sig, require_custody=self.custody, expected_bindings=self.bindings(value), now=self.now, baseline_is_exact=lambda: 1)

    def test_real_ed25519_wrong_key_rejected(self):
        wrong = Ed25519PrivateKey.generate().public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo).decode()
        with self.assertRaises(c.ContractError): c._verify(b"x", self.key.sign(b"x"), wrong)

    def test_posix_output_is_restrictive_and_readback_checked(self):
        if os.name == "nt": self.skipTest("POSIX only")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "output"; c._write_fresh_restrictive(path, b"payload", Path(directory) / "repository")
            self.assertEqual(path.read_bytes(), b"payload"); self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        with tempfile.TemporaryDirectory() as directory, patch.object(c.os, "read", return_value=b"wrong"):
            path = Path(directory) / "output"
            with self.assertRaises(c.ContractError): c._write_fresh_restrictive(path, b"payload", Path(directory) / "repository")
            self.assertFalse(path.exists())

    def test_windows_acl_precedes_write_and_failures_cleanup(self):
        events = []
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "output"; repository = Path(directory) / "repository"; real_open = c.os.open; real_write = c.os.write
            def tracked_open(*args): events.append("open"); return real_open(*args)
            with patch.object(c.os, "name", "nt"), patch.object(c, "_windows_restrictive_directory", return_value=True), patch("g035_hosted_recovery._windows_current_sid", return_value="S-1-5-21"), patch.object(c.subprocess, "run", side_effect=lambda *a, **k: events.append(("icacls", a[0]))), patch.object(c, "restrictive_regular_file", side_effect=lambda *a: events.append("validate")), patch.object(c.os, "open", side_effect=tracked_open), patch.object(c.os, "write", side_effect=lambda fd, data: (events.append("write") or real_write(fd, data))):
                c._write_fresh_restrictive(path, b"x", repository)
            commands = [event[1] for event in events if isinstance(event, tuple)]
            resolved_path = str(path.resolve())
            self.assertEqual(commands, [["icacls", resolved_path, "/reset"], ["icacls", resolved_path, "/inheritance:r", "/remove:g", "SYSTEM", "Administrators", "OWNER RIGHTS", "/grant:r", "*S-1-5-21:F", "SYSTEM:F", "Administrators:F"]]); self.assertLess(events.index(("icacls", commands[1])), events.index("write"))
        for failing in ("write", "fsync"):
            with self.subTest(failing=failing), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "output"; repository = Path(directory) / "repository"
                with patch.object(c.os, "name", "nt"), patch.object(c, "_windows_restrictive_directory", return_value=True), patch("g035_hosted_recovery._windows_current_sid", return_value="S-1-5-21"), patch.object(c.subprocess, "run"), patch.object(c, "restrictive_regular_file"), patch.object(c.os, failing, side_effect=OSError()), self.assertRaises(OSError):
                    c._write_fresh_restrictive(path, b"x", repository)
                self.assertFalse(path.exists())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "output"; repository = Path(directory) / "repository"
            with patch.object(c.os, "name", "nt"), patch.object(c, "_windows_restrictive_directory", return_value=True), patch("g035_hosted_recovery._windows_current_sid", return_value="S-1-5-21"), patch.object(c.subprocess, "run"), patch.object(c, "restrictive_regular_file"), patch.object(c.os, "read", side_effect=OSError()), self.assertRaises(OSError):
                c._write_fresh_restrictive(path, b"x", repository)
            self.assertFalse(path.exists())
        for failure in (0, 1):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "output"; repository = Path(directory) / "repository"
                def fail_on_call(*args, **kwargs):
                    if fail_on_call.calls == failure: raise OSError()
                    fail_on_call.calls += 1
                fail_on_call.calls = 0
                with patch.object(c.os, "name", "nt"), patch.object(c, "_windows_restrictive_directory", return_value=True), patch("g035_hosted_recovery._windows_current_sid", return_value="S-1-5-21"), patch.object(c.subprocess, "run", side_effect=fail_on_call), self.assertRaises(OSError):
                    c._write_fresh_restrictive(path, b"x", repository)
                self.assertFalse(path.exists())
    def test_windows_binary_output_round_trips_hostile_bytes(self):
        payload = b"\x00\x01\x0a\x0d\x1a\x7f\x80\xff\x0a\x0d"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "output"; repository = Path(directory) / "repository"
            with patch.object(c.os, "name", "nt"), patch.object(c, "_windows_restrictive_directory", return_value=True), patch("g035_hosted_recovery._windows_current_sid", return_value="S-1-5-21"), patch.object(c.subprocess, "run"), patch.object(c, "restrictive_regular_file"):
                c._write_fresh_restrictive(path, payload, repository)
            self.assertEqual(path.read_bytes(), payload)

    def test_windows_output_open_flags_include_binary_mode(self):
        source = Path(c.__file__).read_text(encoding="utf8")
        self.assertIn('os.O_RDWR|os.O_CREAT|os.O_EXCL|getattr(os,"O_BINARY",0)', source)
    def test_output_replacement_symlink_and_hardlink_races_fail_closed(self):
        if os.name == "nt": self.skipTest("POSIX race fixtures")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "output"; replacement = Path(directory) / "replacement"
            replacement.write_bytes(b"replacement")
            def swap(fd):
                os.replace(replacement, path)
            with patch.object(c.os, "fsync", side_effect=swap), self.assertRaises(c.ContractError):
                c._write_fresh_restrictive(path, b"payload", Path(directory) / "repository")
            self.assertEqual(path.read_bytes(), b"replacement")
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "output"; target = Path(directory) / "target"
            target.write_bytes(b"target")
            def symlink_swap(fd):
                path.unlink()
                path.symlink_to(target)
            with patch.object(c.os, "fsync", side_effect=symlink_swap), self.assertRaises(c.ContractError):
                c._write_fresh_restrictive(path, b"payload", Path(directory) / "repository")
            self.assertTrue(path.is_symlink())
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "output"; link = Path(directory) / "link"
            def hardlink(fd):
                os.link(path, link)
            with patch.object(c.os, "fsync", side_effect=hardlink), self.assertRaises(c.ContractError):
                c._write_fresh_restrictive(path, b"payload", Path(directory) / "repository")
            self.assertFalse(path.exists())
            self.assertTrue(link.exists())

    def test_output_parent_and_short_write_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory) / "repository"; repository.mkdir()
            with self.assertRaises(c.ContractError):
                c._write_fresh_restrictive(repository / "output", b"x", repository)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "output"
            with patch.object(c.os, "write", return_value=0), self.assertRaises(c.ContractError):
                c._write_fresh_restrictive(path, b"x", Path(directory) / "repository")
            self.assertFalse(path.exists())

    def test_windows_identity_checks_surround_acl_and_write(self):
        events = []
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "output"; repository = Path(directory) / "repository"; real_write = c.os.write
            original = c._same_output_file
            def identity(fd, candidate):
                events.append("identity")
                return original(fd, candidate)
            with patch.object(c.os, "name", "nt"), patch.object(c, "_windows_restrictive_directory", return_value=True), patch("g035_hosted_recovery._windows_current_sid", return_value="S-1-5-21"), patch.object(c.subprocess, "run", side_effect=lambda *a, **k: events.append("acl")), patch.object(c, "restrictive_regular_file"), patch.object(c, "_same_output_file", side_effect=identity), patch.object(c.os, "write", side_effect=lambda fd, data: (events.append("write") or real_write(fd, data))):
                c._write_fresh_restrictive(path, b"x", repository)
            self.assertGreaterEqual(events.count("identity"), 5)
            self.assertLess(events.index("acl"), events.index("write"))
    def test_windows_directory_acl_custody_delegates_to_native_g035_inspection(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory) / "parent"; parent.mkdir(); path = parent / "output"; repository = Path(directory) / "repository"
            with patch.object(c.os, "name", "nt"), patch("g035_hosted_recovery._windows_dacl_restrictive", return_value=True) as inspect, patch("g035_hosted_recovery._windows_current_sid", return_value="S-1-5-21"), patch.object(c.subprocess, "run", return_value=SimpleNamespace(returncode=0)), patch.object(c, "restrictive_regular_file"):
                c._write_fresh_restrictive(path, b"payload", repository)
            inspect.assert_called_once_with(parent.resolve(), directory=True)
            self.assertEqual(path.read_bytes(), b"payload")
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory) / "parent"; parent.mkdir(); path = parent / "output"; repository = Path(directory) / "repository"
            with patch.object(c.os, "name", "nt"), patch("g035_hosted_recovery._windows_dacl_restrictive", return_value=False) as inspect, patch.object(c.subprocess, "run", return_value=SimpleNamespace(returncode=0)) as run:
                with self.assertRaises(c.ContractError): c._write_fresh_restrictive(path, b"payload", repository)
            inspect.assert_called_once_with(parent.resolve(), directory=True)
            self.assertFalse(path.exists())
            self.assertEqual(run.call_count, 0)
    def test_windows_directory_acl_rejects_non_directory_before_native_inspection(self):
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory) / "missing"
            with patch("g035_hosted_recovery._windows_dacl_restrictive") as inspect:
                self.assertFalse(c._windows_restrictive_directory(missing))
            inspect.assert_not_called()

    def test_cli_has_no_private_key_or_secret_argument(self):
        source = Path(c.__file__).read_text(encoding="utf8")
        self.assertNotIn("private-key", source); self.assertNotIn("--secret", source)

    def test_parser_build_template_is_functional(self):
        now = int(time.time())
        with tempfile.TemporaryDirectory() as directory, patch.object(closure, "AUTHORIZATION_PUBLIC_KEY_PEM", self.pem), patch.object(c, "_windows_restrictive_directory", return_value=True), patch("g035_hosted_recovery._restrictive", return_value=True), patch("g035_hosted_recovery._windows_current_sid", return_value="S-1-5-21"), patch.object(c.subprocess, "run"):
            paths = self.files(directory)
            origin = "https://abcdefghijklmnopqrst.supabase.co"
            assertion = {"schema": closure._FREEZE_ASSERTION_SCHEMA, "freeze_id": "freeze-0001", "origin": origin,
                         "commit": "f" * 40, "manifest_sha256": c.MANIFEST_SHA256, "relation_root": self.digest("7"),
                         "acl_root": self.digest("8"), "source_root": self.digest("1"), "terminal_spec": self.digest("2"),
                         "issued_at": now, "expires_at": now + 100, "attestations": {}}
            assertion["attestations"] = {name: {"status": True, "evidence_sha256": self.digest("9"), "observed_at": now}
                                         for name in ("no_owner_write", "no_dashboard_write", "no_provider_write", "no_out_of_band_write", "producer_stop")}
            assertion["signature"] = base64.b64encode(self.key.sign(closure.canonical_bytes(assertion))).decode()
            assertion_path = Path(directory) / "assertion"; assertion_path.write_bytes(closure.canonical_bytes(assertion))
            for path in (*paths, assertion_path): os.chmod(path, 0o600)
            output = Path(directory) / "output"
            args = ["build-template", "--capture-receipt", str(paths[0]), "--restore-receipt", str(paths[1]), "--inspection-receipt", str(paths[2]), "--legacy-authorization", str(paths[3]), "--legacy-signature", str(paths[4]), "--operator-assertion", str(assertion_path), "--output", str(output), "--origin", origin, "--project", "abcdefghijklmnopqrst", "--current-commit", "f" * 40, "--source-root", self.digest("1"), "--terminal-spec", self.digest("2"), "--freeze-id", "freeze-0001", "--relation-root", self.digest("7"), "--acl-root", self.digest("8"), "--recipient-fingerprint", self.digest("4"), "--recovery-public-key-fingerprint", self.digest("5"), "--capture-scope-sha256", self.digest("6"), "--authorization-id", "11111111-1111-4111-8111-111111111111", "--issued-at", str(now), "--expires-at", str(now + 100)]
            self.assertEqual(c.main(args), 0)
            self.assertEqual(json.loads(output.read_text())["current_commit"], "f" * 40); self.assertEqual(json.loads(output.read_text())["operator_assertion_sha256"], closure.digest(assertion))
    def test_operator_assertion_reader_accepts_exact_controller_bytes_only(self):
        assertion = {"schema": "test", "signature": "test"}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "assertion"
            exact = closure.canonical_bytes(assertion)
            path.write_bytes(exact)
            self.assertEqual(c._read_operator_assertion(path), assertion)
            for raw in (exact + b"\n", exact + b"\r\n", exact + b" ", b'{"schema":"test","schema":"test","signature":"test"}'):
                with self.subTest(raw=raw):
                    path.write_bytes(raw)
                    with self.assertRaises(c.ContractError): c._read_operator_assertion(path)
    def test_baseline_callback_is_required(self):
        with tempfile.TemporaryDirectory() as directory:
            auth, sig, value = self.envelope(directory)
            env = c.authenticate_execution_authorization_document(auth, sig, require_custody=self.custody, expected_bindings=self.bindings(value), now=self.now)
            with self.assertRaises(c.ContractError):
                c.authorize_exact_baseline(env, expected_bindings=self.bindings(value), now=self.now, baseline_is_exact=None)

    def test_freeze_and_vector_are_immutable(self):
        frozen = c._freeze({"nested": [{"x": 1}]})
        with self.assertRaises(TypeError): frozen["nested"] = ()
        self.assertIsInstance(frozen["nested"], tuple)

    def test_origin_uuid_count_and_digest_type_rejections(self):
        value = self.value()
        for change in ({"origin": "https://abcdefghijklmnopqrst.supabase.co/"}, {"authorization_id": True}, {"issued_at": True}, {"legacy_vector": {**value["legacy_vector"], "duplicate_group_count": True}}, {"source_root": "A" * 64}):
            with self.subTest(change=change), self.assertRaises(c.ContractError): c._validate({**value, **change}, self.bindings(value), self.now)

    def test_verify_api_rechecks_bindings_at_use(self):
        with tempfile.TemporaryDirectory() as directory:
            auth, sig, value = self.envelope(directory)
            env = c.authenticate_execution_authorization_document(auth, sig, require_custody=self.custody, expected_bindings=self.bindings(value), now=self.now)
            altered = {**self.bindings(value), "current_commit": "a" * 40}
            with self.assertRaises(c.ContractError): c.authorize_exact_baseline(env, expected_bindings=altered, now=self.now, baseline_is_exact=lambda: True)


class G037RotatedAuthorityFixtureTests(unittest.TestCase):
    operator_pem = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAZccE77vdHuSmTLuFobhH+JR3KQEWpf9x1z+BuVFSzpI=\n-----END PUBLIC KEY-----\n"
    operator_sha256 = "a9fd31ab443aea51d0f71ec63603c4cd46cdcc343b6b50df48f47902cbf95491"
    execution_pem = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAAGquC2wytyVU4OEh4Xa3Ks8curo/xWybEkkgJu1GP+w=\n-----END PUBLIC KEY-----\n"
    execution_sha256 = "2ad4754cca38c52eb5daa592a879c7018cde3d716b2290f43bfe5796ac061150"

    def test_rotated_public_manifest_fixtures_are_exact_and_domain_separated(self):
        self.assertEqual(closure.AUTHORIZATION_PUBLIC_KEY_PEM, self.operator_pem)
        self.assertEqual(closure.AUTHORIZATION_PUBLIC_KEY_SHA256, self.operator_sha256)
        self.assertEqual(c.PUBLIC_KEY_PEM, self.execution_pem)
        self.assertEqual(c.PUBLIC_KEY_SHA256, self.execution_sha256)
        self.assertEqual(hashlib.sha256(self.operator_pem.encode()).hexdigest(), self.operator_sha256)
        self.assertEqual(hashlib.sha256(self.execution_pem.encode()).hexdigest(), self.execution_sha256)
        self.assertNotEqual(closure.AUTHORIZATION_PUBLIC_KEY_PEM, c.PUBLIC_KEY_PEM)
        self.assertNotEqual(closure.AUTHORIZATION_PUBLIC_KEY_SHA256, c.PUBLIC_KEY_SHA256)

    def test_signature_from_superseded_authority_is_rejected_by_both_domains(self):
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives.serialization import load_pem_public_key

        superseded_authority = Ed25519PrivateKey.generate()
        payload = b"superseded-g037-authority"
        signature = superseded_authority.sign(payload)
        with self.assertRaises(c.ContractError):
            c._verify(payload, signature, c.PUBLIC_KEY_PEM)
        with self.assertRaises(InvalidSignature):
            load_pem_public_key(closure.AUTHORIZATION_PUBLIC_KEY_PEM.encode()).verify(signature, payload)

if __name__ == "__main__":
    unittest.main()
