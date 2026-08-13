#!/usr/bin/env python3
"""Fail-closed protected-source binding for the G040 recovery runtime.

This module intentionally accepts no inferred branch or remote identity.  A caller
must supply the exact protected commit it expects to authorize.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Callable, Sequence


class RecoverySourceError(RuntimeError):
    """The local checkout cannot prove the requested immutable source state."""


COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
MANIFEST_PATH = ".github/g034-hosted-migration-closure.v1.json"
DOMAIN = b"g040-recovery-source-root-v1\x00"
_RUNTIME_FILES = (
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
    MANIFEST_PATH,
    ".github/workflows/g040-prefix-recovery.yml",
)
_G014_ALLOWLIST_SOURCE_FILES = (
    "backend/supabase/migrations/20260713002000_g014_public_api_private_boundary.sql",
    "backend/supabase/migrations/20260713002100_g014_privacy_workflows.sql",
    "backend/supabase/migrations/20260713002200_g014_marketing_state_machine.sql",
    "backend/supabase/migrations/20260713002300_g014_account_deletion_state_machine.sql",
    "backend/supabase/migrations/20260713002400_g014_retention_adapters_receipts.sql",
)
_MIGRATION_KEYS = ("version", "name", "path", "sha256")
_MANIFEST_KEYS = (
    "schemaVersion",
    "ledgerTerminalVersion",
    "closureTerminalVersion",
    "requiredLaterPromotionGate",
    "migrations",
    "excludedVersions",
    "cloneBackupRecoveryRequired",
)


@dataclass(frozen=True)
class SourceBinding:
    final_commit: str
    runtime_source_root: str

_CAPABILITY = object()
_bootstrap_capability: object | None = None
_bootstrap_root: Path | None = None
_bootstrap_commit: str | None = None
_bootstrap_source_root: str | None = None


def _establish_isolated_bootstrap(root: Path, commit: str, source_root: str) -> None:
    """Accept the non-forgeable in-process proof established by the trusted bootstrap."""
    global _bootstrap_capability, _bootstrap_root, _bootstrap_commit, _bootstrap_source_root
    if (
        _bootstrap_capability is not None
        or not isinstance(root, Path)
        or not COMMIT_RE.fullmatch(commit)
        or not re.fullmatch(r"[0-9a-f]{64}", source_root)
    ):
        _fail()
    _bootstrap_capability = _CAPABILITY
    _bootstrap_root = root
    _bootstrap_commit = commit
    _bootstrap_source_root = source_root
def assert_isolated_bootstrap() -> None:
    """Require the opaque bootstrap capability without accepting caller tokens."""
    if _bootstrap_capability is not _CAPABILITY:
        _fail()
def _fail() -> None:
    raise RecoverySourceError("protected recovery source verification failed") from None


def _relative_path(value: str) -> str:
    if not isinstance(value, str) or not value or "\\" in value:
        _fail()
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ("", ".", "..") for part in path.parts):
        _fail()
    return value


def _no_duplicate_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if not isinstance(key, str) or key in result:
            _fail()
        result[key] = value
    return result


def _manifest_migrations(root: Path) -> tuple[str, ...]:
    path = root / MANIFEST_PATH
    payload: object | None = None
    try:
        if path.is_symlink() or not path.is_file():
            _fail()
        raw = path.read_bytes()
        payload = json.loads(raw.decode("ascii"), object_pairs_hook=_no_duplicate_object)
        canonical = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("ascii")
        pretty = json.dumps(payload, indent=2, ensure_ascii=True).encode("ascii")
        if raw not in (canonical, canonical + b"\n", pretty, pretty + b"\n"):
            _fail()
    except Exception:
        payload = None
    if type(payload) is not dict or tuple(payload) != _MANIFEST_KEYS:
        _fail()
    if type(payload["schemaVersion"]) is not int or payload["schemaVersion"] != 1:
        _fail()
    if any(not isinstance(payload[key], str) or not payload[key] for key in _MANIFEST_KEYS[1:4]):
        _fail()
    if type(payload["cloneBackupRecoveryRequired"]) is not bool:
        _fail()
    excluded = payload["excludedVersions"]
    if not isinstance(excluded, list) or not excluded or any(not isinstance(value, str) or not value for value in excluded) or len(excluded) != len(set(excluded)):
        _fail()
    rows = payload["migrations"]
    if not isinstance(rows, list) or not rows:
        _fail()
    paths: list[str] = []
    versions: list[str] = []
    for row in rows:
        if type(row) is not dict or tuple(row) != _MIGRATION_KEYS:
            _fail()
        version, name, value, sha256 = (row[key] for key in _MIGRATION_KEYS)
        if any(not isinstance(item, str) or not item for item in (version, name, value)) or not re.fullmatch(r"[0-9a-f]{64}", sha256):
            _fail()
        if not value.startswith("backend/supabase/migrations/"):
            _fail()
        _relative_path(value)
        if value in paths or version in versions:
            _fail()
        paths.append(value)
        versions.append(version)
    if versions != sorted(versions):
        _fail()
    return tuple(paths)


def recovery_source_inventory(repository_root: Path | str) -> tuple[str, ...]:
    """Return the complete, sorted finite G040 runtime source inventory."""
    root: Path | None = None
    try:
        root = Path(repository_root)
    except Exception:
        pass
    if root is None:
        _fail()
    required = (*_RUNTIME_FILES, *_G014_ALLOWLIST_SOURCE_FILES)
    if len(required) != len(set(required)):
        _fail()
    inventory = tuple(sorted(set((*required, *_manifest_migrations(root)))))
    return inventory


def _git(root: Path, args: Sequence[str], runner: Callable[..., subprocess.CompletedProcess[bytes]]) -> bytes:
    result: object | None = None
    try:
        result = runner(["git", "-C", os.fspath(root), *args], capture_output=True, check=False)
        valid = isinstance(result, subprocess.CompletedProcess) and result.returncode == 0 and isinstance(result.stdout, bytes)
    except Exception:
        valid = False
    if not valid or not isinstance(result, subprocess.CompletedProcess):
        _fail()
    return result.stdout


def _head(root: Path, runner: Callable[..., subprocess.CompletedProcess[bytes]]) -> str:
    # A branch name is not authority: require a detached HEAD resolving to one full commit.
    attached: object | None = None
    try:
        attached = runner(["git", "-C", os.fspath(root), "symbolic-ref", "-q", "HEAD"], capture_output=True, check=False)
        detached = isinstance(attached, subprocess.CompletedProcess) and attached.returncode == 1
    except Exception:
        detached = False
    if not detached:
        _fail()
    value = _git(root, ("rev-parse", "--verify", "HEAD^{commit}"), runner)
    if not re.fullmatch(rb"[0-9a-f]{40}\n", value):
        _fail()
    return value[:-1].decode("ascii")


def _tree_entry(root: Path, path: str, runner: Callable[..., subprocess.CompletedProcess[bytes]]) -> tuple[str, bytes]:
    output = _git(root, ("ls-tree", "-z", "HEAD", "--", path), runner)
    expected_prefix = b"100"
    expected_suffix = b"\t" + path.encode("utf-8") + b"\x00"
    if not output.startswith(expected_prefix) or not output.endswith(expected_suffix) or output.count(b"\x00") != 1:
        _fail()
    parts: list[bytes] | None = None
    try:
        header, _ = output[:-1].split(b"\t", 1)
        parts = header.split(b" ")
    except ValueError:
        pass
    if parts is None or len(parts) != 3:
        _fail()
    mode, kind, object_id = parts
    if mode not in (b"100644", b"100755") or kind != b"blob" or not re.fullmatch(rb"[0-9a-f]{40}", object_id):
        _fail()
    return mode.decode("ascii"), _git(root, ("show", f"HEAD:{path}"), runner)


def _verify_path(root: Path, path: str, runner: Callable[..., subprocess.CompletedProcess[bytes]]) -> tuple[str, str, str]:
    _relative_path(path)
    # This checks index tracking independently of tree parsing.
    _git(root, ("ls-files", "--error-unmatch", "--", path), runner)
    mode, committed = _tree_entry(root, path, runner)
    local = root / Path(*PurePosixPath(path).parts)
    valid = False
    try:
        info = local.lstat()
        valid = (
            not stat.S_ISLNK(info.st_mode)
            and stat.S_ISREG(info.st_mode)
            and bool(info.st_mode & stat.S_IXUSR) == (mode == "100755")
            and local.read_bytes() == committed
        )
    except OSError:
        pass
    if not valid:
        _fail()
    return path, mode, hashlib.sha256(committed).hexdigest()
def _production_bootstrap() -> None:
    flags = sys.flags
    if (
        getattr(flags, "isolated", 0) != 1
        or not getattr(flags, "safe_path", False)
        or _bootstrap_capability is not _CAPABILITY
    ):
        _fail()


def _tracked_path(root: Path, path: Path, runner: Callable[..., subprocess.CompletedProcess[bytes]]) -> bool:
    try:
        relative = path.relative_to(root).as_posix()
    except ValueError:
        _fail()
    result: object | None = None
    try:
        result = runner(
            ["git", "-C", os.fspath(root), "ls-files", "--error-unmatch", "--", relative],
            capture_output=True,
            check=False,
        )
    except Exception:
        _fail()
    return isinstance(result, subprocess.CompletedProcess) and result.returncode == 0


def _no_importable_shadow(root: Path, runner: Callable[..., subprocess.CompletedProcess[bytes]]) -> None:
    """Reject untracked import candidates in the only checkout import roots."""
    script_root = root / "backend" / "supabase" / "scripts"
    trusted = {
        root / Path(*PurePosixPath(path).parts)
        for path in _RUNTIME_FILES
        if path.endswith(".py")
    }
    for import_root in (root, script_root):
        try:
            entries = tuple(import_root.iterdir())
        except OSError:
            _fail()
        for entry in entries:
            try:
                info = entry.lstat()
            except OSError:
                _fail()
            if stat.S_ISLNK(info.st_mode):
                _fail()
            is_module = entry.suffix in (".py", ".pyc")
            is_package = entry.is_dir() and any(
                (entry / initializer).is_file()
                for initializer in ("__init__.py", "__init__.pyc")
            )
            if (is_module or is_package) and not _tracked_path(root, entry, runner):
                _fail()


def _no_worktree_shadow(root: Path, runner: Callable[..., subprocess.CompletedProcess[bytes]]) -> None:
    # The recovery runtime is executed from this checkout.  A path-scoped status
    # check cannot prove that an unrelated module cannot shadow an import.
    output = _git(root, ("status", "--porcelain=v1", "-z", "--untracked-files=all"), runner)
    if output:
        _fail()




def _canonical_root(entries: Sequence[tuple[str, str, str]]) -> str:
    digest = hashlib.sha256(DOMAIN)
    for path, mode, blob_sha256 in entries:
        encoded = path.encode("utf-8")
        digest.update(len(encoded).to_bytes(4, "big"))
        digest.update(encoded)
        digest.update(mode.encode("ascii"))
        digest.update(bytes.fromhex(blob_sha256))
    return digest.hexdigest()


def verify_recovery_source(
    repository_root: Path | str,
    authorized_final_commit: str,
    *,
    production: bool = False,
    runner: Callable[..., subprocess.CompletedProcess[bytes]] = subprocess.run,
) -> SourceBinding:
    """Verify an exact detached commit and return its canonical source binding."""
    root = Path(repository_root)
    if type(authorized_final_commit) is not str or not COMMIT_RE.fullmatch(authorized_final_commit):
        _fail()
    if production:
        _production_bootstrap()
        _no_importable_shadow(root, runner)
    selected = recovery_source_inventory(root)
    head = _head(root, runner)
    if head != authorized_final_commit:
        _fail()
    _no_worktree_shadow(root, runner)
    entries = tuple(_verify_path(root, path, runner) for path in selected)
    source_root = _canonical_root(entries)
    if production and (
        _bootstrap_root != root
        or _bootstrap_commit != head
        or _bootstrap_source_root != source_root
    ):
        _fail()
    return SourceBinding(final_commit=head, runtime_source_root=source_root)


__all__ = ["RecoverySourceError", "SourceBinding", "assert_isolated_bootstrap", "recovery_source_inventory", "verify_recovery_source"]
