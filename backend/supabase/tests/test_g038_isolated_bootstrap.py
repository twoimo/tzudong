"""Contract tests for G038's isolated safe-path source bootstrap."""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import shutil
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).parents[3]
MANIFEST = ROOT / ".github" / "g038-account-deletion-successor.v1.json"
MODULE = Path(__file__).parents[1] / "scripts" / "g038_isolated_bootstrap.py"
spec = importlib.util.spec_from_file_location("g038_isolated_bootstrap_under_test", MODULE)
bootstrap = importlib.util.module_from_spec(spec); assert spec.loader
sys.modules[spec.name] = bootstrap; spec.loader.exec_module(bootstrap)


def manifest(*, runtime=None, selected=None, excluded=None, extra=None) -> bytes:
    value = json.loads(MANIFEST.read_text(encoding="ascii"))
    if runtime is not None:
        value["runtimeInventory"] = runtime
    if selected is not None:
        by_version = {row["version"]: row for row in value["migrations"]}
        rows = []
        for version in selected:
            row = dict(by_version.get(version, value["migrations"][0]))
            if version not in by_version:
                row["version"] = version
                row["path"] = f"backend/supabase/migrations/{version}_{row['name']}.sql"
            rows.append(row)
        value["migrations"] = rows
    if excluded is not None:
        value["excludedSources"] = excluded
    if extra is not None:
        value[extra] = True
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii") + b"\n"


class ManifestTests(unittest.TestCase):
    def test_manifest_requires_complete_exact_production_inventory(self):
        inventory = bootstrap.manifest_inventory(manifest())
        self.assertTrue(bootstrap.REQUIRED_RUNTIME_FILES.issubset(inventory))
        self.assertEqual(inventory, tuple(sorted(inventory)))
        for required in (
            "backend/supabase/scripts/g038_production_controller.py",
            "backend/supabase/scripts/g038_clone_rehearsal.py",
            "backend/supabase/scripts/g038_write_freeze.py",
            ".github/workflows/g038-account-deletion-successor.yml",
            "backend/supabase/tests/g038_terminal_readback.sql",
            ".github/g034-hosted-migration-closure.v1.json",
            "backend/supabase/scripts/g035_hosted_recovery.py",
            "backend/supabase/scripts/g035_hosted_recovery_contract.py",
            "backend/supabase/scripts/g037_hosted_closure_contract.py",
            "backend/supabase/scripts/preflight_g034_hosted_migration_closure.py",
        ):
            self.assertIn(required, inventory)

    def test_missing_inventory_selected_versions_exclusions_and_extra_keys_fail(self):
        cases = (
            manifest(runtime=[]),
            manifest(selected=list(reversed(bootstrap.SELECTED_VERSIONS))),
            manifest(selected=[*bootstrap.SELECTED_VERSIONS, "20260713002500"]),
            manifest(excluded=["20260713002500"]),
            manifest(extra="fallback"),
        )
        for raw in cases:
            with self.subTest(raw=raw), self.assertRaises(RuntimeError):
                bootstrap.manifest_inventory(raw)

    def test_duplicate_json_noncanonical_and_path_escape_fail(self):
        raw = manifest()
        duplicate = b'{"schema":"g038-account-deletion-successor-v1","schema":"g038-account-deletion-successor-v1"}'
        noncanonical = raw + b"\n"
        value = json.loads(raw); value["runtimeInventory"][0] = "../escape.py"
        escape = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("ascii")
        for candidate in (duplicate, noncanonical, escape):
            with self.subTest(candidate=candidate[:30]), self.assertRaises(RuntimeError):
                bootstrap.manifest_inventory(candidate)

    def test_manifest_never_admits_02500_or_reconstructed_g026_as_migrations(self):
        value = json.loads(manifest())
        value["migrations"][0]["version"] = "20260713002500"
        raw = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("ascii") + b"\n"
        with self.assertRaises(RuntimeError):
            bootstrap.manifest_inventory(raw)


class IsolationTests(unittest.TestCase):
    def test_verify_requires_safe_path_absolute_real_root_exact_commit_and_entrypoint(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            unsafe_sys = types.SimpleNamespace(flags=types.SimpleNamespace(safe_path=False))
            with patch.object(bootstrap, "sys", unsafe_sys), self.assertRaises(RuntimeError):
                bootstrap.verify(root, "a" * 40, next(iter(bootstrap.ENTRYPOINTS)))
            with self.assertRaises(RuntimeError):
                bootstrap.verify(Path("relative"), "a" * 40, next(iter(bootstrap.ENTRYPOINTS)))
            with self.assertRaises(RuntimeError):
                bootstrap.verify(root, "not-a-commit", next(iter(bootstrap.ENTRYPOINTS)))
            with self.assertRaises(RuntimeError):
                bootstrap.verify(root, "a" * 40, "backend/supabase/scripts/arbitrary.py")

    def test_import_shadowing_and_symlinks_fail_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); scripts = root / "backend" / "supabase" / "scripts"
            scripts.mkdir(parents=True)
            shadow = scripts / "json.py"; shadow.write_text("raise RuntimeError\n")
            completed = subprocess.CompletedProcess([], 0, b"", b"")
            with patch.object(bootstrap.subprocess, "run", return_value=completed), self.assertRaises(RuntimeError):
                bootstrap._reject_import_shadows(root, frozenset())
            shadow.unlink()
            if os.name != "nt":
                (scripts / "shadow.py").symlink_to(root / "missing")
                with self.assertRaises(RuntimeError):
                    bootstrap._reject_import_shadows(root, frozenset())

    def test_untracked_importable_file_is_rejected_even_when_not_stdlib_named(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); scripts = root / "backend" / "supabase" / "scripts"
            scripts.mkdir(parents=True); (scripts / "provider_shadow.py").write_text("secret = True\n")
            untracked = subprocess.CompletedProcess([], 1, b"", b"")
            with patch.object(bootstrap.subprocess, "run", return_value=untracked), self.assertRaises(RuntimeError):
                bootstrap._reject_import_shadows(root, frozenset())

    def test_object_entry_rejects_tree_ambiguity_and_non_blob(self):
        root = Path("/repository")
        with patch.object(bootstrap, "git", return_value=b"100644 blob " + b"a" * 40 + b"\twrong\0"), self.assertRaises(RuntimeError):
            bootstrap.object_entry(root, "b" * 40, "expected")
        tree = b"040000 tree " + b"a" * 40 + b"\texpected\0"
        with patch.object(bootstrap, "git", return_value=tree), self.assertRaises(RuntimeError):
            bootstrap.object_entry(root, "b" * 40, "expected")

    def test_verified_importer_uses_captured_bytes_and_rejects_unclosed_local_imports(self):
        closed = {
            "backend/supabase/scripts/closed_a.py": b"import closed_b\nVALUE = closed_b.VALUE\n",
            "backend/supabase/scripts/closed_b.py": b"VALUE = 'verified'\n",
        }
        protected = bootstrap._protected_modules(closed, frozenset(("closed_a", "closed_b")))
        with self.assertRaises(RuntimeError):
            bootstrap._protected_modules(
                {"backend/supabase/scripts/closed_a.py": b"import omitted_local\n"},
                frozenset(("closed_a", "omitted_local")),
            )
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "closed_b.py").write_text("VALUE = 'checkout'\n")
            importer = bootstrap.VerifiedImporter(root, "a" * 40, protected, frozenset(("closed_a", "closed_b")))
            sys.meta_path.insert(0, importer)
            sys.path.insert(0, temp)
            try:
                module = importlib.import_module("closed_a")
                self.assertEqual(module.VALUE, "verified")
                self.assertEqual(sys.modules["closed_b"].VALUE, "verified")
            finally:
                sys.meta_path.remove(importer)
                sys.path.remove(temp)
                sys.modules.pop("closed_a", None)
                sys.modules.pop("closed_b", None)

    def test_public_entrypoints_are_only_production_controller_runtime_proof_and_local_clone(self):
        self.assertEqual(bootstrap.ENTRYPOINTS, frozenset((
            "backend/supabase/scripts/g038_production_controller.py",
            "backend/supabase/scripts/g038_local_clone_adapter.py",
            "backend/supabase/scripts/g038_runtime_proof.py",
        )))
        self.assertEqual(
            {"backend/supabase/scripts/g040_recovery_source.py"},
            {
                path
                for path in bootstrap.REQUIRED_RUNTIME_FILES
                if "g040" in path
            },
        )

    def test_documented_separator_is_stripped_before_adapter_dispatch(self):
        root = Path("/exact-main-root")
        entrypoint = "backend/supabase/scripts/g038_local_clone_adapter.py"
        source = types.SimpleNamespace(_establish_isolated_bootstrap=lambda *args: None)
        recovery = types.SimpleNamespace(
            verify_recovery_source=lambda *args, **kwargs: types.SimpleNamespace(
                runtime_source_root="b" * 64,
            ),
            _establish_isolated_bootstrap=lambda *args: None,
        )
        observed: list[str] = []

        def observe_load(*args, **kwargs):
            observed.extend(bootstrap.sys.argv)
            return types.ModuleType("__main__")

        with (
            patch.object(
                bootstrap,
                "verify",
                return_value=(b"", "a" * 64, {}, frozenset()),
            ),
            patch.object(
                bootstrap.importlib,
                "import_module",
                side_effect=(source, recovery),
            ),
            patch.object(bootstrap, "load", side_effect=observe_load),
            patch.object(bootstrap.sys, "path", list(bootstrap.sys.path)),
            patch.object(bootstrap.sys, "meta_path", list(bootstrap.sys.meta_path)),
            patch.object(bootstrap.sys, "argv", list(bootstrap.sys.argv)),
        ):
            bootstrap.main([
                "--repository-root", os.fspath(root),
                "--authorized-final-commit", "c" * 40,
                "--entrypoint", entrypoint,
                "--",
                "--source-root", os.fspath(root),
                "--run-root", "/private/run",
            ])

        self.assertEqual(
            observed,
            [
                os.fspath(root / entrypoint),
                "--source-root", os.fspath(root),
                "--run-root", "/private/run",
            ],
        )

    def test_repeated_or_misplaced_separator_fails_closed(self):
        hostile = (
            ["--", "--", "--source-root", "/exact-main-root"],
            ["--", "--source-root", "/exact-main-root", "--"],
            ["--source-root", "/exact-main-root", "--"],
        )
        for entry_args in hostile:
            with self.subTest(entry_args=entry_args), self.assertRaises(RuntimeError):
                bootstrap._entrypoint_args(entry_args)

    def test_real_detached_repository_verifies_actual_committed_manifest(self):
        inventory = json.loads(MANIFEST.read_text(encoding="ascii"))["runtimeInventory"]
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            for relative in inventory:
                target = root / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / relative, target)
            environment = {
                **os.environ,
                "GIT_AUTHOR_NAME": "G038 Test",
                "GIT_AUTHOR_EMAIL": "g038@example.invalid",
                "GIT_COMMITTER_NAME": "G038 Test",
                "GIT_COMMITTER_EMAIL": "g038@example.invalid",
            }
            for command in (
                ("git", "init", "-q"),
                ("git", "add", "--all"),
                ("git", "commit", "-q", "-m", "detached source"),
                ("git", "checkout", "-q", "--detach", "HEAD"),
            ):
                subprocess.run(command, cwd=root, env=environment, check=True)
            code = """
import importlib.util, json, pathlib, subprocess, sys
root = pathlib.Path(sys.argv[1]).resolve()
path = root / "backend/supabase/scripts/g038_isolated_bootstrap.py"
spec = importlib.util.spec_from_file_location("detached_bootstrap", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
commit = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
entry, source_root, protected, local = module.verify(root, commit, sys.argv[2])
print(json.dumps({"entry": len(entry), "root": source_root, "protected": sorted(protected)}))
"""
            result = subprocess.run(
                [
                    sys.executable, "-P", "-B", "-c", code, os.fspath(root),
                    "backend/supabase/scripts/g038_runtime_proof.py",
                ],
                cwd="/", env=environment, capture_output=True, text=True, check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            observed = json.loads(result.stdout)
            self.assertGreater(observed["entry"], 0)
            self.assertRegex(observed["root"], r"^[0-9a-f]{64}$")
            self.assertIn("g035_hosted_recovery", observed["protected"])
            self.assertIn("g037_hosted_closure_contract", observed["protected"])
            commit = subprocess.check_output(
                ["git", "-C", os.fspath(root), "rev-parse", "HEAD"],
                text=True,
            ).strip()
            dispatch_code = """
import importlib, importlib.util, pathlib, sys
root = pathlib.Path(sys.argv[1]).resolve()
entrypoint = "backend/supabase/scripts/g038_local_clone_adapter.py"
path = root / "backend/supabase/scripts/g038_isolated_bootstrap.py"
spec = importlib.util.spec_from_file_location("detached_dispatch", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
entry, source_root, protected, local = module.verify(root, sys.argv[2], entrypoint)
sys.path[:] = [item for item in sys.path if item and module._outside_repository(item, root)]
sys.meta_path.insert(0, module.VerifiedImporter(root, sys.argv[2], protected, local))
source = importlib.import_module("g038_successor_source")
source._establish_isolated_bootstrap(root, sys.argv[2], source_root)
recovery = importlib.import_module("g040_recovery_source")
recovery._establish_isolated_bootstrap(root, sys.argv[2], "b" * 64)
sys.argv = [str(root / entrypoint), "--help"]
module.load("__main__", entry, str(root / entrypoint), main=True)
"""
            dispatch = subprocess.run(
                [sys.executable, "-I", "-B", "-c", dispatch_code, os.fspath(root), commit],
                cwd="/", env=environment, capture_output=True, text=True, check=False,
            )
            self.assertEqual(dispatch.returncode, 0, dispatch.stderr)
            self.assertIn("--source-root", dispatch.stdout)


if __name__ == "__main__":
    unittest.main()
