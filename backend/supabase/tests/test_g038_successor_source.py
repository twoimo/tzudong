from __future__ import annotations

import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import g038_successor_contract as contract
import g038_successor_source as source


class G038SuccessorSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.repository = Path(__file__).resolve().parents[3]

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        for relative in contract.RUNTIME_INVENTORY:
            origin = self.repository / relative
            destination = self.root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(origin, destination)
            destination.chmod(origin.stat().st_mode & 0o777)
        self.git("init", "-q")
        self.git("config", "user.email", "g038@example.invalid")
        self.git("config", "user.name", "G038 Source Test")
        self.git("add", ".")
        self.git("commit", "-qm", "exact source")
        self.commit = self.git("rev-parse", "HEAD").strip()
        self.branch = self.git("symbolic-ref", "--short", "HEAD").strip()
        self.git("checkout", "--detach", "-q")

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args):
        return subprocess.run(
            ["git", "-c", "core.autocrlf=false", "-C", str(self.root), *args],
            check=True, capture_output=True, text=True,
        ).stdout

    def verify(self, **kwargs):
        return source.verify_successor_source(self.root, self.commit, **kwargs)

    def denied(self, callback):
        with self.assertRaisesRegex(source.SuccessorSourceError, "^G038 successor source verification failed$"):
            callback()

    def test_inventory_is_exact_sorted_unique_runtime_test_and_import_closure(self):
        inventory = source.successor_source_inventory(self.root)
        self.assertEqual(inventory, contract.RUNTIME_INVENTORY)
        self.assertEqual(inventory, tuple(sorted(inventory)))
        self.assertIn("backend/supabase/scripts/g037_supabase_statement_vector.mjs", inventory)
        self.assertIn("backend/supabase/tests/g038_terminal_readback.sql", inventory)
        self.assertEqual(contract.canonical_sha256(list(inventory)), contract.RUNTIME_INVENTORY_ROOT)

    def test_exact_clean_detached_commit_returns_stable_binding(self):
        first = self.verify()
        second = self.verify()
        self.assertEqual(first, second)
        self.assertEqual(first.final_commit, self.commit)
        self.assertRegex(first.runtime_source_root, r"^[0-9a-f]{64}$")
        self.assertNotIn(str(self.root), repr(first))

    def test_rejects_attached_wrong_malformed_and_ambiguous_head(self):
        self.git("checkout", "-q", self.branch)
        self.denied(self.verify)
        self.git("checkout", "--detach", "-q")
        self.denied(lambda: source.verify_successor_source(self.root, "A" * 40))
        self.denied(lambda: source.verify_successor_source(self.root, "0" * 40))

    def test_rejects_tracked_modified_deleted_untracked_and_ignored_changes(self):
        path = self.root / contract.RUNTIME_INVENTORY[4]
        path.write_bytes(path.read_bytes() + b"\n")
        self.denied(self.verify)
        self.git("checkout", "--", ".")
        path.unlink()
        self.denied(self.verify)
        self.git("checkout", "--", ".")
        (self.root / "untracked.txt").write_text("x")
        self.denied(self.verify)
        (self.root / "untracked.txt").unlink()
        (self.root / ".gitignore").write_text("ignored.py\n")
        self.git("add", ".gitignore")
        self.git("commit", "-qm", "ignore rule")
        self.commit = self.git("rev-parse", "HEAD").strip()
        binding = self.verify()
        (self.root / "ignored.py").write_text("x")
        with patch.multiple(source, _bootstrap_capability=source._CAPABILITY, _bootstrap_root=self.root, _bootstrap_commit=self.commit, _bootstrap_source_root=binding.runtime_source_root), patch.object(source.sys, "flags", SimpleNamespace(isolated=1, safe_path=True)):
            self.denied(lambda: self.verify(production=True))

    def test_rejects_symlink_nonregular_and_executable_mode_drift(self):
        relative = contract.RUNTIME_INVENTORY[4]
        path = self.root / relative
        original = path.read_bytes()
        path.unlink()
        path.symlink_to(self.repository / relative)
        self.denied(self.verify)
        path.unlink()
        path.write_bytes(original)
        path.chmod(path.stat().st_mode | stat.S_IXUSR)
        self.denied(self.verify)

    def test_rejects_manifest_inventory_duplicate_extra_missing_and_order_drift(self):
        manifest = self.root / contract.MANIFEST_RELATIVE_PATH
        import json
        value = json.loads(manifest.read_bytes())
        variants = (
            value["runtimeInventory"] + [value["runtimeInventory"][0]],
            value["runtimeInventory"] + ["extra.py"],
            value["runtimeInventory"][:-1],
            list(reversed(value["runtimeInventory"])),
        )
        for inventory in variants:
            with self.subTest(length=len(inventory)):
                changed = dict(value)
                changed["runtimeInventory"] = inventory
                manifest.write_bytes(contract.canonical_json_bytes(changed) + b"\n")
                self.denied(lambda: source.successor_source_inventory(self.root))
        manifest.write_bytes(contract.canonical_json_bytes(value) + b"\n")

    def test_production_requires_isolated_nonforgeable_bootstrap(self):
        with patch.object(source, "_bootstrap_capability", None):
            self.denied(lambda: self.verify(production=True))
        for token in (None, True, "trusted", object()):
            with patch.object(source, "_bootstrap_capability", token):
                self.denied(source.assert_isolated_bootstrap)
        with patch.object(source, "_bootstrap_capability", source._CAPABILITY):
            source.assert_isolated_bootstrap()

    def test_production_accepts_only_matching_bootstrap_tuple(self):
        binding = self.verify()
        for root, commit, digest in (
            (self.root.parent, self.commit, binding.runtime_source_root),
            (self.root, "0" * 40, binding.runtime_source_root),
            (self.root, self.commit, "0" * 64),
        ):
            with patch.multiple(source, _bootstrap_capability=source._CAPABILITY, _bootstrap_root=root, _bootstrap_commit=commit, _bootstrap_source_root=digest), patch.object(source.sys, "flags", SimpleNamespace(isolated=1, safe_path=True)):
                self.denied(lambda: self.verify(production=True))
        with patch.multiple(source, _bootstrap_capability=source._CAPABILITY, _bootstrap_root=self.root, _bootstrap_commit=self.commit, _bootstrap_source_root=binding.runtime_source_root), patch.object(source.sys, "flags", SimpleNamespace(isolated=1, safe_path=True)):
            self.assertEqual(self.verify(production=True), binding)

    def test_production_rejects_importable_symlink_and_untracked_shadow(self):
        binding = self.verify()
        kwargs = dict(_bootstrap_capability=source._CAPABILITY, _bootstrap_root=self.root, _bootstrap_commit=self.commit, _bootstrap_source_root=binding.runtime_source_root)
        shadow = self.root / "backend/supabase/scripts/shadow.py"
        shadow.write_text("pass\n")
        with patch.multiple(source, **kwargs), patch.object(source.sys, "flags", SimpleNamespace(isolated=1, safe_path=True)):
            self.denied(lambda: self.verify(production=True))
        shadow.unlink()
        link = self.root / "backend/supabase/scripts/shadow"
        link.symlink_to(self.root / "backend/supabase/scripts")
        with patch.multiple(source, **kwargs), patch.object(source.sys, "flags", SimpleNamespace(isolated=1, safe_path=True)):
            self.denied(lambda: self.verify(production=True))

    def test_runner_failures_and_malformed_git_outputs_fail_closed(self):
        def raising(*args, **kwargs):
            raise OSError("git unavailable")
        self.denied(lambda: self.verify(runner=raising))

        def attached(argv, **kwargs):
            return subprocess.CompletedProcess(argv, 0, b"refs/heads/main\n", b"")
        self.denied(lambda: self.verify(runner=attached))

    def test_bootstrap_establishment_is_one_shot_and_strictly_typed(self):
        binding = self.verify()
        with patch.multiple(source, _bootstrap_capability=None, _bootstrap_root=None, _bootstrap_commit=None, _bootstrap_source_root=None):
            source._establish_isolated_bootstrap(self.root, self.commit, binding.runtime_source_root)
            self.denied(lambda: source._establish_isolated_bootstrap(self.root, self.commit, binding.runtime_source_root))
        for root, commit, digest in ((str(self.root), self.commit, binding.runtime_source_root), (self.root, True, binding.runtime_source_root), (self.root, self.commit, True)):
            with patch.object(source, "_bootstrap_capability", None):
                self.denied(lambda root=root, commit=commit, digest=digest: source._establish_isolated_bootstrap(root, commit, digest))


if __name__ == "__main__":
    unittest.main()
