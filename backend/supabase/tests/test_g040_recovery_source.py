from __future__ import annotations

import json
import importlib.util
import marshal
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import g040_recovery_source as source

EXPECTED_RUNTIME_FILES = (
    "backend/supabase/scripts/g040_prefix_recovery.py",
    "backend/supabase/scripts/g040_recovery_authorization.py",
    "backend/supabase/scripts/g040_reverse_00400.py",
    "backend/supabase/scripts/g040_recovery_source.py",
    "backend/supabase/scripts/g040_isolated_bootstrap.py",
    "backend/supabase/scripts/g040_reference_evidence.py",
    "backend/supabase/scripts/g040_production_controller.py",
    "backend/supabase/scripts/g040_clone_rehearsal.py",
    "backend/supabase/scripts/g040_prefix_executor.py",
    "backend/supabase/scripts/g037_hosted_closure_contract.py",
    "backend/supabase/scripts/g037_hosted_closure_executor.py",
    "backend/supabase/scripts/g037_write_freeze.py",
    "backend/supabase/scripts/g037_managed_recovery.py",
    "backend/supabase/scripts/g037_production_controller.py",
    "backend/supabase/scripts/g037_remediation_authorization.py",
    "backend/supabase/scripts/g037_supabase_statement_vector.mjs",
    "backend/supabase/scripts/g037-parser-oracle/go.mod",
    "backend/supabase/scripts/g037-parser-oracle/go.sum",
    "backend/supabase/scripts/g037-parser-oracle/main.go",
    "backend/supabase/scripts/g035_hosted_recovery.py",
    "backend/supabase/scripts/g035_hosted_recovery_contract.py",
    "backend/supabase/scripts/preflight_g034_hosted_migration_closure.py",
    ".github/g034-hosted-migration-closure.v1.json",
    ".github/workflows/g040-prefix-recovery.yml",
)


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
        self.g035_runtime = "backend/supabase/scripts/g035_hosted_recovery.py"
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
        for relative in EXPECTED_RUNTIME_FILES:
            if relative == ".github/g034-hosted-migration-closure.v1.json":
                continue
            path = self.root / relative
            if not path.exists():
                path.parent.mkdir(parents=True, exist_ok=True)
                if relative in (
                    "backend/supabase/scripts/g040_isolated_bootstrap.py",
                    "backend/supabase/scripts/g040_recovery_source.py",
                ):
                    source_path = Path(__file__).resolve().parents[1] / "scripts" / Path(relative).name
                    path.write_bytes(source_path.read_bytes())
                elif relative == "backend/supabase/scripts/g035_hosted_recovery.py":
                    path.write_bytes(
                        b"import sys\n"
                        b"sys.modules['g040_recovery_source'].assert_isolated_bootstrap()\n"
                        b"if '--benign-test-mode' not in sys.argv: raise SystemExit(3)\n"
                        b"print('g035-bootstrap-ok')\n"
                    )
                else:
                    path.write_bytes(b"runtime binding\n")
        manifest = self.root / ".github/g034-hosted-migration-closure.v1.json"
        manifest.parent.mkdir(parents=True, exist_ok=True)
        manifest.write_bytes((json.dumps({
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
        }, indent=2) + "\n").encode("ascii"))
        self.git("add", ".")
        self.git("commit", "-qm", "source")
        self.commit = self.git("rev-parse", "HEAD").strip()
        self.git("checkout", "--detach", "-q")
        self.inventory = tuple(sorted(set((*EXPECTED_RUNTIME_FILES, *self.fragments))))

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.run(["git", "-c", "core.autocrlf=false", "-C", str(self.root), *args], check=True, capture_output=True, text=True).stdout

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
    def test_production_requires_trusted_in_process_bootstrap_capability(self):
        with patch.object(source, "_bootstrap_capability", None):
            self.denied(production=True)
            with patch.object(source.sys, "flags", SimpleNamespace(isolated=1, safe_path=True)):
                with self.assertRaises(source.RecoverySourceError):
                    source._production_bootstrap()
    def test_entrypoint_assertion_rejects_non_capability_tokens(self):
        for token in (None, True, False, "trusted", "a" * 64):
            with patch.object(source, "_bootstrap_capability", token):
                with self.assertRaisesRegex(source.RecoverySourceError, "^protected recovery source verification failed$"):
                    source.assert_isolated_bootstrap()
        with patch.object(source, "_bootstrap_capability", source._CAPABILITY):
            source.assert_isolated_bootstrap()
    def test_isolated_stdin_bootstrap_executes_verified_fixture(self):
        bootstrap = subprocess.run(
            ["git", "-C", str(self.root), "show", f"{self.commit}:backend/supabase/scripts/g040_isolated_bootstrap.py"],
            check=True,
            capture_output=True,
        ).stdout
        result = subprocess.run(
            [
                sys.executable, "-I", "-", "--repository-root", str(self.root),
                "--authorized-final-commit", self.commit,
                "--entrypoint", "backend/supabase/scripts/g040_recovery_source.py",
            ],
            input=bootstrap,
            capture_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", "replace"))
    def test_isolated_stdin_bootstrap_loads_g035_benign_entrypoint(self):
        bootstrap = subprocess.run(
            ["git", "-C", str(self.root), "show", f"{self.commit}:backend/supabase/scripts/g040_isolated_bootstrap.py"],
            check=True,
            capture_output=True,
        ).stdout
        result = subprocess.run(
            [
                sys.executable, "-I", "-", "--repository-root", str(self.root),
                "--authorized-final-commit", self.commit,
                "--entrypoint", "backend/supabase/scripts/g035_hosted_recovery.py",
                "--", "--benign-test-mode",
            ],
            input=bootstrap,
            capture_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", "replace"))
        self.assertEqual(result.stdout.decode("utf-8", "replace").strip(), "g035-bootstrap-ok")

    def test_isolated_stdin_bootstrap_rejects_ignored_pyc_before_entrypoint(self):
        (self.root / "json.pyc").write_bytes(b"malicious")
        (self.root / ".git" / "info" / "exclude").write_text("json.pyc\n")
        bootstrap = subprocess.run(
            ["git", "-C", str(self.root), "show", f"{self.commit}:backend/supabase/scripts/g040_isolated_bootstrap.py"],
            check=True,
            capture_output=True,
        ).stdout
        result = subprocess.run(
            [
                sys.executable, "-I", "-", "--repository-root", str(self.root),
                "--authorized-final-commit", self.commit,
                "--entrypoint", "backend/supabase/scripts/g040_recovery_source.py",
            ],
            input=bootstrap,
            capture_output=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stderr.decode("utf-8", "replace").strip(), "protected recovery source verification failed")

    def test_ignored_sourceless_shadow_is_rejected_before_payload_execution(self):
        marker = self.root / "payload-executed"
        shadow = self.root / "json.pyc"
        shadow.write_bytes(
            importlib.util.MAGIC_NUMBER
            + b"\0" * 12
            + marshal.dumps(compile(f"open({str(marker)!r}, 'w').write('executed')", "json.py", "exec"))
        )
        (self.root / ".git" / "info" / "exclude").write_text("json.pyc\n")
        self.assertEqual(self.git("status", "--porcelain", "--ignored", "--", "json.pyc").strip(), "!! json.pyc")
        with patch.object(source, "_production_bootstrap") as bootstrap:
            self.denied(production=True)
        bootstrap.assert_called_once_with()
        self.assertFalse(marker.exists())

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
        self.assertEqual(self.verify().runtime_source_root, baseline)
    def test_reference_evidence_byte_and_mode_changes_are_rejected(self):
        baseline = self.verify().runtime_source_root
        reference = self.root / self.reference
        reference.write_bytes(b"changed reference evidence\n")
        self.denied()
        self.git("checkout", "--", self.reference)
        self.assertEqual(self.verify().runtime_source_root, baseline)

    def test_dirty_g035_runtime_and_unrelated_import_shadow_are_denied(self):
        runtime = self.root / self.g035_runtime
        runtime.write_bytes(b"changed g035 runtime\n")
        self.denied()
        self.git("checkout", "--", self.g035_runtime)
        shadow = self.root / "g040_recovery_source.py"
        shadow.write_bytes(b"import shadow\n")
        self.denied()

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

    def test_literal_inventory_is_exact_and_all_entries_are_required(self):
        baseline = self.verify()
        self.assertEqual(source.recovery_source_inventory(self.root), self.inventory)
        self.assertIn(self.vector, self.inventory)
        self.assertIn(self.g035_runtime, self.inventory)
        self.assertIn("backend/supabase/scripts/g040_reverse_00400.py", self.inventory)

        for relative in self.inventory:
            with self.subTest(required_path=relative):
                path = self.root / relative
                path.unlink()
                self.denied()
                self.git("checkout", "--", relative)

                original = path.read_bytes()
                path.write_bytes(original + b"mutation\n")
                self.denied()
                self.git("checkout", "--", relative)

        self.assertEqual(source.recovery_source_inventory(self.root), self.inventory)
        self.assertEqual(self.verify(), baseline)
        entries = (("a", "100644", "00" * 32),)
        self.assertNotEqual(source._canonical_root(entries), source._canonical_root((("a", "100755", "00" * 32),)))
        self.assertNotEqual(source._canonical_root(entries), source._canonical_root((("b", "100644", "00" * 32),)))

    def test_any_unscoped_status_output_is_denied(self):
        def status_output(argv, **kwargs):
            self.assertNotIn("--", argv[6:])
            return subprocess.CompletedProcess(argv, 0, b"?? shadow.py\x00", b"")

        with self.assertRaises(source.RecoverySourceError):
            source._no_worktree_shadow(self.root, status_output)

    def test_unrelated_untracked_import_shadow_is_denied(self):
        (self.root / "g035_hosted_recovery_contract.py").write_text("shadow\n")
        self.denied()

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
        manifest = self.root / ".github/g034-hosted-migration-closure.v1.json"
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
        canonical = json.dumps(payload, separators=(",", ":")).encode("ascii")
        manifest.write_bytes(canonical)
        inventory = source.recovery_source_inventory(self.root)
        self.assertEqual(inventory, self.inventory)
        manifest.write_bytes(canonical + b"\n")
        self.assertEqual(source.recovery_source_inventory(self.root), inventory)
        manifest.write_bytes(canonical + b"\n\n")
        with self.assertRaises(source.RecoverySourceError):
            source.recovery_source_inventory(self.root)
        manifest.write_text('{"schemaVersion":1,"schemaVersion":1}')
        with self.assertRaises(source.RecoverySourceError):
            source.recovery_source_inventory(self.root)
        manifest.write_text(json.dumps(payload, indent=2))
        self.assertEqual(source.recovery_source_inventory(self.root), inventory)
        manifest.write_text(json.dumps(payload, indent=4))
        with self.assertRaises(source.RecoverySourceError):
            source.recovery_source_inventory(self.root)


if __name__ == "__main__":
    unittest.main()
