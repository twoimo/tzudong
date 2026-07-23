#!/usr/bin/env python3
"""Execute a verified G038 production entrypoint from an isolated safe-path interpreter."""
from __future__ import annotations

import argparse
import ast
import importlib
import importlib.abc
import importlib.util
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import types
from pathlib import Path, PurePosixPath

COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
BLOB_PART_RE = re.compile(r"^[0-9a-f]{10}$")
MANIFEST_PATH = ".github/g038-account-deletion-successor.v1.json"
DOMAIN = b"g038-successor-source-root-v1\x00"
PREDECESSOR_COMMIT = "664cee04a4f239d6cf8fe2eebab8de9c8404b316"
PREDECESSOR_REPORT_SHA256 = "85f6b1e6e34e3311bbffd7146232ca41d6393bdd43688d4ebd7b230bdf929114"
SELECTED_VERSIONS = ("20260713002600", "20260713002700")
EXCLUDED_VERSIONS = ("20260713002500", "G026")
TOKEN_BLOB_PARTS = ("db00843424", "6be335b9f7", "abaf0cb66a", "99a2b40378")
STATE_BLOB_PARTS = ("47775390d1", "731c0ad29e", "10b20fb2fe", "16c8cfcadb")
ENTRYPOINTS = frozenset((
    "backend/supabase/scripts/g038_production_controller.py",
    "backend/supabase/scripts/g038_local_clone_adapter.py",
    "backend/supabase/scripts/g038_runtime_proof.py",
))
REQUIRED_RUNTIME_FILES = frozenset((
    ".github/g034-hosted-migration-closure.v1.json",
    ".github/g038-account-deletion-successor.v1.json",
    ".github/workflows/account-deletion-worker.yml",
    ".github/workflows/g038-account-deletion-successor.yml",
    ".github/workflows/privacy-retention.yml",
    "apps/web/app/api/account/delete/route.ts",
    "apps/web/app/api/internal/account-deletion/route.ts",
    "apps/web/app/api/internal/privacy-retention/route.ts",
    "apps/web/integrations/supabase/types.ts",
    "apps/web/lib/privacy/account-deletion-reauth.ts",
    "apps/web/lib/privacy/account-deletion-worker.ts",
    "apps/web/lib/privacy/account-deletion.ts",
    "apps/web/lib/privacy/retention-runner.ts",
    "apps/web/scripts/run-account-deletion-worker.mjs",
    "apps/web/scripts/run-privacy-retention-schedule.mjs",
    "apps/web/tests-unit/account-deletion-contract.test.ts",
    "apps/web/tests-unit/account-deletion-reauth-contract.test.ts",
    "apps/web/tests-unit/account-deletion-worker.test.ts",
    "apps/web/tests-unit/privacy-retention.test.ts",
    "backend/supabase/docs/g038-account-deletion-successor-runbook.md",
    "backend/supabase/scripts/g035_hosted_recovery.py",
    "backend/supabase/scripts/g035_hosted_recovery_contract.py",
    "backend/supabase/scripts/g037_hosted_closure_contract.py",
    "backend/supabase/scripts/g037_supabase_statement_vector.mjs",
    "backend/supabase/scripts/g038_clone_rehearsal.py",
    "backend/supabase/scripts/g038_isolated_bootstrap.py",
    "backend/supabase/scripts/g038_local_clone_adapter.py",
    "backend/supabase/scripts/g038_production_controller.py",
    "backend/supabase/scripts/g038_runtime_proof.py",
    "backend/supabase/scripts/g038_successor_authorization.py",
    "backend/supabase/scripts/g038_successor_contract.py",
    "backend/supabase/scripts/g038_successor_executor.py",
    "backend/supabase/scripts/g038_successor_source.py",
    "backend/supabase/scripts/g038_write_freeze.py",
    "backend/supabase/scripts/g040_recovery_source.py",
    "backend/supabase/scripts/preflight_g034_hosted_migration_closure.py",
    "backend/supabase/tests/g038_terminal_readback.sql",
    "backend/supabase/tests/test_g038_clone_rehearsal.py",
    "backend/supabase/tests/test_g038_cross_clone_receipt.py",
    "backend/supabase/tests/test_g038_cross_module_contract.py",
    "backend/supabase/tests/test_g038_isolated_bootstrap.py",
    "backend/supabase/tests/test_g038_local_clone_adapter.py",
    "backend/supabase/tests/test_g038_production_controller.py",
    "backend/supabase/tests/test_g038_runtime_proof.py",
    "backend/supabase/tests/test_g038_source_contract.py",
    "backend/supabase/tests/test_g038_successor_authorization.py",
    "backend/supabase/tests/test_g038_successor_contract.py",
    "backend/supabase/tests/test_g038_successor_executor.py",
    "backend/supabase/tests/test_g038_successor_source.py",
    "backend/supabase/tests/test_g038_workflow.py",
    "backend/supabase/tests/test_g038_write_freeze.py",
))


def fail() -> None:
    raise RuntimeError("protected G038 source verification failed")


def git(root: Path, *args: str) -> bytes:
    result = subprocess.run(["git", "-C", os.fspath(root), *args], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False)
    if result.returncode or type(result.stdout) is not bytes:
        fail()
    return result.stdout


def relative(value: object) -> str:
    if type(value) is not str or not value or "\\" in value:
        fail()
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ("", ".", "..") for part in path.parts):
        fail()
    return value


def _pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
    value: dict[str, object] = {}
    for key, item in pairs:
        if key in value:
            fail()
        value[key] = item
    return value
def blob_parts(value: object) -> tuple[str, str, str, str]:
    if (type(value) is not list or len(value) != 4
            or any(type(part) is not str or not BLOB_PART_RE.fullmatch(part) for part in value)):
        fail()
    return value[0], value[1], value[2], value[3]




def manifest_inventory(raw: bytes) -> tuple[str, ...]:
    try:
        payload = json.loads(raw.decode("ascii"), object_pairs_hook=_pairs, parse_constant=lambda _: fail())
        canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode("ascii") + b"\n"
        keys = {
            "schema", "predecessor", "migrations", "excludedSources", "excludedRoot",
            "runtimeInventory", "runtimeInventoryRoot", "statementParser",
            "statementVectorRoot", "targetRows", "terminalSpecRoot",
        }
        if type(payload) is not dict or raw != canonical or set(payload) != keys:
            fail()
        predecessor = payload["predecessor"]
        migrations = payload["migrations"]
        runtime = payload["runtimeInventory"]
        parser = payload["statementParser"]
        if (payload["schema"] != "g038-account-deletion-successor-v1"
                or type(payload["targetRows"]) is not int or payload["targetRows"] != 42
                or payload["excludedSources"] != list(EXCLUDED_VERSIONS)
                or type(predecessor) is not dict
                or set(predecessor) != {"reportSha256", "commit", "targetFingerprint", "rows", "ledgerRoot"}
                or predecessor["rows"] != 40
                or predecessor["commit"] != PREDECESSOR_COMMIT
                or predecessor["reportSha256"] != PREDECESSOR_REPORT_SHA256
                or type(predecessor["targetFingerprint"]) is not str
                or not re.fullmatch(r"[0-9a-f]{64}", predecessor["targetFingerprint"])
                or type(predecessor["ledgerRoot"]) is not str
                or not re.fullmatch(r"[0-9a-f]{64}", predecessor["ledgerRoot"])
                or type(migrations) is not list or type(runtime) is not list
                or type(parser) is not dict
                or set(parser) != {"schema", "stateBlobParts", "statePath", "tokenBlobParts", "tokenPath", "upstreamCommit", "upstreamVersion"}
                or parser["schema"] != "g037-supabase-statement-vector-v1"
                or parser["upstreamCommit"] != "6d4c19870ed213ba7f682f117d0345c8a40bfa94"
                or parser["upstreamVersion"] != "v2.109.1"
                or blob_parts(parser["tokenBlobParts"]) != TOKEN_BLOB_PARTS
                or blob_parts(parser["stateBlobParts"]) != STATE_BLOB_PARTS):
            fail()
        relative(parser["tokenPath"])
        relative(parser["statePath"])
        if (any(type(path) is not str for path in runtime)
                or runtime != sorted(runtime) or len(runtime) != len(set(runtime))):
            fail()
        inventory = tuple(map(relative, runtime))
        migration_paths: list[str] = []
        for row in migrations:
            if type(row) is not dict or set(row) != {
                "version", "name", "path", "sourceSize", "sourceSha256",
                "statementCount", "statementVectorSha256", "transactionControl",
            }:
                fail()
            if (type(row["version"]) is not str or type(row["name"]) is not str or not row["name"]
                    or relative(row["path"]) != f"backend/supabase/migrations/{row['version']}_{row['name']}.sql"
                    or type(row["sourceSize"]) is not int or row["sourceSize"] <= 0
                    or type(row["sourceSha256"]) is not str or not re.fullmatch(r"[0-9a-f]{64}", row["sourceSha256"])
                    or type(row["statementCount"]) is not int or row["statementCount"] <= 0
                    or type(row["statementVectorSha256"]) is not str
                    or not re.fullmatch(r"[0-9a-f]{64}", row["statementVectorSha256"])
                    or type(row["transactionControl"]) is not list
                    or any(type(item) is not str for item in row["transactionControl"])):
                fail()
            migration_paths.append(row["path"])
        if (tuple(row["version"] for row in migrations) != SELECTED_VERSIONS
                or tuple(tuple(row["transactionControl"]) for row in migrations) != ((), ("BEGIN", "COMMIT"))
                or any(path not in inventory for path in migration_paths)
                or MANIFEST_PATH not in inventory
                or not REQUIRED_RUNTIME_FILES.issubset(inventory)):
            fail()
        canonical_value = lambda value: json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")
        inventory_root = hashlib.sha256(canonical_value(list(inventory))).hexdigest()
        excluded_root = hashlib.sha256(canonical_value(list(EXCLUDED_VERSIONS))).hexdigest()
        vector_root = hashlib.sha256(canonical_value([[row["version"], row["statementVectorSha256"]] for row in migrations])).hexdigest()
        terminal = {
            "excludedRoot": excluded_root,
            "predecessorCommit": predecessor["commit"],
            "predecessorLedgerRoot": predecessor["ledgerRoot"],
            "predecessorReportSha256": predecessor["reportSha256"],
            "predecessorRows": predecessor["rows"],
            "runtimeInventoryRoot": inventory_root,
            "statementVectorRoot": vector_root,
            "targetFingerprint": predecessor["targetFingerprint"],
            "targetRows": payload["targetRows"],
        }
        if (payload["runtimeInventoryRoot"] != inventory_root
                or payload["excludedRoot"] != excluded_root
                or payload["statementVectorRoot"] != vector_root
                or payload["terminalSpecRoot"] != hashlib.sha256(canonical_value(terminal)).hexdigest()):
            fail()
        return inventory
    except RuntimeError:
        raise
    except Exception:
        fail()


def object_entry(root: Path, commit: str, path: str) -> tuple[str, bytes]:
    output = git(root, "ls-tree", "-z", commit, "--", path)
    suffix = b"\t" + path.encode("ascii") + b"\0"
    if output.count(b"\0") != 1 or not output.endswith(suffix):
        fail()
    try:
        mode, kind, object_id = output[:-1].split(b"\t", 1)[0].split(b" ")
    except ValueError:
        fail()
    if mode not in (b"100644", b"100755") or kind != b"blob" or not re.fullmatch(rb"[0-9a-f]{40}", object_id):
        fail()
    return mode.decode("ascii"), git(root, "show", f"{commit}:{path}")


def _reject_import_shadows(root: Path, inventory: frozenset[str]) -> None:
    scripts = root / "backend" / "supabase" / "scripts"
    stdlib = getattr(sys, "stdlib_module_names", frozenset())
    for import_root in (root, scripts):
        try:
            candidates = tuple(import_root.iterdir())
        except OSError:
            fail()
        for candidate in candidates:
            try:
                info = candidate.lstat()
            except OSError:
                fail()
            if stat.S_ISLNK(info.st_mode):
                fail()
            package = candidate.is_dir() and any((candidate / name).is_file() for name in ("__init__.py", "__init__.pyc"))
            importable = candidate.suffix in (".py", ".pyc") or package
            if not importable:
                continue
            path = candidate.relative_to(root).as_posix()
            tracked = subprocess.run(["git", "-C", os.fspath(root), "ls-files", "--error-unmatch", "--", path], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False).returncode == 0
            if (not tracked and path not in inventory) or candidate.stem in stdlib:
                fail()


def _tracked_local_modules(root: Path, commit: str) -> frozenset[str]:
    prefix = "backend/supabase/scripts/"
    raw = git(root, "ls-tree", "-rz", "--name-only", commit, "--", prefix)
    try:
        paths = raw.decode("ascii").split("\0")
    except UnicodeError:
        fail()
    modules: set[str] = set()
    for path in paths:
        if not path:
            continue
        pure = PurePosixPath(path)
        if pure.parent.as_posix() == prefix.rstrip("/") and pure.suffix == ".py":
            if not pure.stem.isidentifier() or pure.stem in modules:
                fail()
            modules.add(pure.stem)
    return frozenset(modules)


def _protected_modules(
    inventory_bytes: dict[str, bytes],
    local_modules: frozenset[str],
) -> dict[str, tuple[str, bytes]]:
    prefix = PurePosixPath("backend/supabase/scripts")
    protected: dict[str, tuple[str, bytes]] = {}
    for path, data in inventory_bytes.items():
        pure = PurePosixPath(path)
        if pure.parent == prefix and pure.suffix == ".py":
            if not pure.stem.isidentifier() or pure.stem in protected:
                fail()
            protected[pure.stem] = (path, data)
    for path, data in tuple(protected.values()):
        try:
            tree = ast.parse(data, filename=path)
        except (SyntaxError, ValueError):
            fail()
        for node in ast.walk(tree):
            names: tuple[str, ...] = ()
            if isinstance(node, ast.Import):
                names = tuple(alias.name.partition(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                if node.level:
                    fail()
                names = (() if node.module is None else (node.module.partition(".")[0],))
            if any(name in local_modules and name not in protected for name in names):
                fail()
    return protected


class VerifiedImporter(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def __init__(
        self,
        root: Path,
        commit: str,
        protected: dict[str, tuple[str, bytes]],
        local_modules: frozenset[str],
    ) -> None:
        self.root = root
        self.commit = commit
        self.protected = protected
        self.local_modules = local_modules

    def find_spec(self, fullname: str, path: object = None, target: object = None) -> importlib.machinery.ModuleSpec | None:
        if "." in fullname:
            return None
        if fullname in self.protected:
            relative_path, _ = self.protected[fullname]
            return importlib.util.spec_from_loader(
                fullname, self, origin=os.fspath(self.root / relative_path),
            )
        if fullname in self.local_modules:
            raise ImportError("protected local import is outside verified closure")
        return None

    def create_module(self, spec: importlib.machinery.ModuleSpec) -> None:
        return None

    def exec_module(self, module: types.ModuleType) -> None:
        relative_path, data = self.protected[module.__name__]
        filename = os.fspath(self.root / relative_path)
        module.__file__ = filename
        module.__package__ = ""
        exec(compile(data, filename, "exec"), module.__dict__)


def _outside_repository(item: str, root: Path) -> bool:
    try:
        candidate = Path(item).resolve(strict=False)
    except (OSError, ValueError):
        return False
    return candidate != root and root not in candidate.parents


def verify(
    root: Path,
    commit: str,
    entrypoint: str,
) -> tuple[bytes, str, dict[str, tuple[str, bytes]], frozenset[str]]:
    if not getattr(sys.flags, "safe_path", False) or not root.is_absolute() or not COMMIT_RE.fullmatch(commit) or entrypoint not in ENTRYPOINTS:
        fail()
    try:
        resolved = root.resolve(strict=True)
        info = root.lstat()
    except OSError:
        fail()
    if resolved != root or stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
        fail()
    attached = subprocess.run(["git", "-C", os.fspath(root), "symbolic-ref", "-q", "HEAD"], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=False)
    if attached.returncode != 1 or git(root, "rev-parse", "--verify", "HEAD^{commit}") != (commit + "\n").encode("ascii") or git(root, "status", "--porcelain=v1", "-z", "--untracked-files=all"):
        fail()
    _, manifest = object_entry(root, commit, MANIFEST_PATH)
    inventory = manifest_inventory(manifest)
    entries: list[tuple[str, str, str]] = []
    entry_bytes: bytes | None = None
    inventory_bytes: dict[str, bytes] = {}
    for path in inventory:
        mode, data = object_entry(root, commit, path)
        local = root.joinpath(*PurePosixPath(path).parts)
        try:
            local_info = local.lstat()
            if stat.S_ISLNK(local_info.st_mode) or not stat.S_ISREG(local_info.st_mode) or bool(local_info.st_mode & stat.S_IXUSR) != (mode == "100755") or local.read_bytes() != data:
                fail()
        except OSError:
            fail()
        entries.append((path, mode, hashlib.sha256(data).hexdigest()))
        inventory_bytes[path] = data
        if path == entrypoint:
            entry_bytes = data
    _reject_import_shadows(root, frozenset(inventory))
    local_modules = _tracked_local_modules(root, commit)
    protected = _protected_modules(inventory_bytes, local_modules)
    digest = hashlib.sha256(DOMAIN)
    for path, mode, blob in entries:
        encoded = path.encode("ascii")
        digest.update(len(encoded).to_bytes(4, "big")); digest.update(encoded); digest.update(mode.encode("ascii")); digest.update(bytes.fromhex(blob))
    if entry_bytes is None:
        fail()
    return entry_bytes, digest.hexdigest(), protected, local_modules


def load(name: str, data: bytes, filename: str, *, main: bool = False) -> types.ModuleType:
    module = types.ModuleType("__main__" if main else name)
    module.__file__ = filename
    module.__package__ = None
    if not main:
        sys.modules[name] = module
    exec(compile(data, filename, "exec"), module.__dict__)
    return module


def _entrypoint_args(values: list[str]) -> list[str]:
    normalized = values[1:] if values[:1] == ["--"] else values
    if "--" in normalized:
        fail()
    return normalized


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--repository-root", required=True)
    parser.add_argument("--authorized-final-commit", required=True)
    parser.add_argument("--entrypoint", required=True)
    parser.add_argument("entry_args", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    root = Path(args.repository_root)
    entry_bytes, source_root, protected, local_modules = verify(
        root, args.authorized_final_commit, args.entrypoint,
    )
    if any(name in sys.modules for name in protected):
        fail()
    sys.path[:] = [item for item in sys.path if item and _outside_repository(item, root)]
    importer = VerifiedImporter(root, args.authorized_final_commit, protected, local_modules)
    sys.meta_path.insert(0, importer)
    source = importlib.import_module("g038_successor_source")
    source._establish_isolated_bootstrap(root, args.authorized_final_commit, source_root)
    if args.entrypoint in {
        "backend/supabase/scripts/g038_production_controller.py",
        "backend/supabase/scripts/g038_local_clone_adapter.py",
    }:
        recovery_source = importlib.import_module("g040_recovery_source")
        recovery_binding = recovery_source.verify_recovery_source(
            root, args.authorized_final_commit, production=False,
        )
        recovery_source._establish_isolated_bootstrap(
            root, args.authorized_final_commit, recovery_binding.runtime_source_root,
        )
    sys.argv = [os.fspath(root / args.entrypoint), *_entrypoint_args(args.entry_args)]
    load("__main__", entry_bytes, os.fspath(root / args.entrypoint), main=True)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("protected G038 source verification failed") from None
