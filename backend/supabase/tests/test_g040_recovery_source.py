from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import g040_recovery_source as source


class G040RecoverySourceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.git("init", "-q")
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "user.name", "G040 Test")
        (self.root / "runtime.py").write_bytes(b"runtime\n")
        (self.root / "nested").mkdir()
        (self.root / "nested" / "adapter.py").write_bytes(b"adapter\n")
        self.vector = "backend/supabase/scripts/g037_supabase_statement_vector.mjs"
        self.reference = "backend/supabase/scripts/g040_reference_evidence.py"
        self.fragments = (
            "backend/supabase/migrations/20260713002000_g014_public_api_private_boundary.sql",
            "backend/supabase/migrations/20260713002100_g014_privacy_workflows.sql",
            "backend/supabase/migrations/20260713002200_g014_marketing_state_machine.sql",
            "backend/supabase/migrations/20260713002300_g014_account_deletion_state_machine.sql",
            "backend/supabase/migrations/20260713002400_g014_retention_adapters_receipts.sql",
        )
        self.fragment = self.fragments[0]
        for relative, content in ((self.vector, b"vector\n"), *((fragment, f"fragment {index}\n".encode()) for index, fragment in enumerate(self.fragments))):
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        for relative in source._RUNTIME_FILES:
            if relative == source.MANIFEST_PATH:
                continue
            path = self.root / relative
            if not path.exists():
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"runtime binding\n")
        manifest = self.root / source.MANIFEST_PATH
        manifest.parent.mkdir(parents=True, exist_ok=True)
        manifest.write_bytes(json.dumps({
            "schemaVersion": 1,
            "ledgerTerminalVersion": "20260713002400",
            "closureTerminalVersion": "20260713002400",
            "requiredLaterPromotionGate": "20260713002500_g014_catalog_contract.sql",
            "migrations": [{
                "version": Path(fragment).name.split("_", 1)[0],
                "name": Path(fragment).stem.split("_", 1)[1],
                "path": fragment,
                "sha256": "0" * 64,
            } for fragment in self.fragments],
            "excludedVersions": ["20260713002500"],
            "cloneBackupRecoveryRequired": True,
        }, separators=(",", ":")).encode("ascii"))
        self.git("add", ".")
        self.git("commit", "-qm", "source")
        self.commit = self.git("rev-parse", "HEAD").strip()
        self.git("checkout", "--detach", "-q")
        self.inventory = tuple(sorted(set((*source._RUNTIME_FILES, *self.fragments))))

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.run(["git", "-C", str(self.root), *args], check=True, capture_output=True, text=True).stdout

    def verify(self, **kwargs):
        return source.verify_recovery_source(self.root, self.commit, **kwargs)

    def denied(self, **kwargs):
        with self.assertRaisesRegex(source.RecoverySourceError, "^protected recovery source verification failed$"):
            self.verify(**kwargs)

    def test_exact_clean_success_is_stable_and_safe(self):
        first = self.verify()
        second = self.verify()
        self.assertEqual(first, second)
        self.assertEqual(first.final_commit, self.commit)
        self.assertRegex(first.runtime_source_root, r"^[0-9a-f]{64}$")
        self.assertNotIn(str(self.root), repr(first))

    def test_dirty_staged_and_untracked_inventory_shadow_are_denied(self):
        vector = self.root / self.vector
        vector.write_text("dirty\n")
        self.denied()
        self.git("checkout", "--", self.vector)
        vector.write_text("staged\n")
        self.git("add", self.vector)
        self.denied()
        self.git("reset", "-q", "HEAD", self.vector)
        self.git("checkout", "--", self.vector)
        self.git("rm", "--cached", "-q", self.vector)
        self.denied()
        self.git("reset", "-q", "HEAD", self.vector)
        self.git("checkout", "--", self.vector)

    def test_statement_vector_and_allowlist_fragment_changes_are_rejected(self):
        baseline = self.verify().runtime_source_root
        (self.root / self.vector).write_bytes(b"changed vector\n")
        self.denied()
        self.git("checkout", "--", self.vector)
        for fragment in self.fragments:
            (self.root / fragment).write_bytes(b"changed fragment\n")
            self.denied()
            self.git("checkout", "--", fragment)
        self.assertRegex(baseline, r"^[0-9a-f]{64}$")
    def test_reference_evidence_byte_and_mode_changes_are_rejected(self):
        baseline = self.verify().runtime_source_root
        reference = self.root / self.reference
        reference.write_bytes(b"changed reference evidence\n")
        self.denied()
        self.git("checkout", "--", self.reference)
        reference.chmod(reference.stat().st_mode | stat.S_IXUSR)
        self.denied()
        self.assertRegex(baseline, r"^[0-9a-f]{64}$")

    def test_symlink_path_traversal_missing_and_exact_inventory_are_denied(self):
        vector = self.root / self.vector
        vector.unlink()
        os.symlink(self.root / "nested" / "adapter.py", vector)
        self.denied()
        vector.unlink()
        self.git("checkout", "--", self.vector)
        with self.assertRaises(source.RecoverySourceError):
            source._relative_path("../runtime.py")
        with self.assertRaises(source.RecoverySourceError):
            source._verify_path(self.root, "unused.py", subprocess.run)
        self.assertEqual(source.recovery_source_inventory(self.root), self.inventory)

    def test_mode_hash_and_head_mismatch_are_denied(self):
        vector = self.root / self.vector
        committed = vector.read_bytes()
        digest = b"0" * 40
        mismatched_mode = b"100644" if vector.stat().st_mode & stat.S_IXUSR else b"100755"
        def mode_mismatch(argv, **kwargs):
            if "ls-files" in argv:
                return subprocess.CompletedProcess(argv, 0, b"", b"")
            if "ls-tree" in argv:
                return subprocess.CompletedProcess(argv, 0, mismatched_mode + b" blob " + digest + b"\t" + self.vector.encode() + b"\x00", b"")
            if "show" in argv:
                return subprocess.CompletedProcess(argv, 0, committed, b"")
            raise AssertionError(argv)
        with self.assertRaises(source.RecoverySourceError):
            source._verify_path(self.root, self.vector, mode_mismatch)
        with self.assertRaises(source.RecoverySourceError):
            source.verify_recovery_source(self.root, "0" * 40)
        self.git("checkout", "-q", "-B", "attached")
        self.denied()

    def test_inventory_validation_and_domain_separation(self):
        self.assertIn(self.vector, source.recovery_source_inventory(self.root))
        self.assertTrue(set(self.fragments).issubset(source.recovery_source_inventory(self.root)))
        with self.assertRaises(source.RecoverySourceError):
            source._relative_path("/runtime.py")
        entries = (("a", "100644", "00" * 32),)
        self.assertNotEqual(source._canonical_root(entries), source._canonical_root((("a", "100755", "00" * 32),)))
        self.assertNotEqual(source._canonical_root(entries), source._canonical_root((("b", "100644", "00" * 32),)))

    def test_any_path_scoped_status_output_is_denied(self):
        def status_output(argv, **kwargs):
            return subprocess.CompletedProcess(argv, 0, b"R  unexpected\x00", b"")

        with self.assertRaises(source.RecoverySourceError):
            source._no_inventory_shadow(self.root, self.inventory, status_output)

    def test_malicious_git_output_and_provider_failure_are_sanitized(self):
        class Result:
            def __init__(self, code, output):
                self.returncode, self.stdout = code, output

        def malicious(*args, **kwargs):
            return Result(0, b"https://token@example.invalid/absolute/path\n")

        with self.assertRaisesRegex(source.RecoverySourceError, "^protected recovery source verification failed$"):
            self.verify(runner=malicious)

        def broken(*args, **kwargs):
            raise OSError("credential://leak")

        with self.assertRaises(source.RecoverySourceError) as caught:
            self.verify(runner=broken)
        self.assertIsNone(caught.exception.__cause__)
        self.assertIsNone(caught.exception.__context__)

    def test_manifest_inventory_rejects_duplicate_keys_and_structural_drift(self):
        manifest = self.root / source.MANIFEST_PATH
        manifest.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "schemaVersion": 1,
            "ledgerTerminalVersion": "20260713002400",
            "closureTerminalVersion": "20260713002400",
            "requiredLaterPromotionGate": "20260713002500_g014_catalog_contract.sql",
            "migrations": [{
                "version": Path(fragment).name.split("_", 1)[0],
                "name": Path(fragment).stem.split("_", 1)[1],
                "path": fragment,
                "sha256": "0" * 64,
            } for fragment in self.fragments],
            "excludedVersions": ["20260713002500"],
            "cloneBackupRecoveryRequired": True,
        }
        manifest.write_bytes(json.dumps(payload, separators=(",", ":")).encode("ascii"))
        inventory = source.recovery_source_inventory(self.root)
        self.assertEqual(inventory, tuple(sorted(set((*source._RUNTIME_FILES, *self.fragments)))))
        manifest.write_text('{"schemaVersion":1,"schemaVersion":1}')
        with self.assertRaises(source.RecoverySourceError):
            source.recovery_source_inventory(self.root)
        manifest.write_text(json.dumps(payload, indent=2))
        with self.assertRaises(source.RecoverySourceError):
            source.recovery_source_inventory(self.root)


if __name__ == "__main__":
    unittest.main()
