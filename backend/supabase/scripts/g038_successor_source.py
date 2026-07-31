"""Fail-closed checkout binding for the G038 successor runtime."""
from __future__ import annotations

import hashlib
import os
import re
import stat
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Callable, Sequence

from g038_successor_contract import RUNTIME_INVENTORY, SuccessorContractError, load_manifest


class SuccessorSourceError(RuntimeError):
    """The checkout cannot prove the exact G038 successor source."""


_COMMIT = re.compile(r"^[0-9a-f]{40}$")
_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_DOMAIN = b"g038-successor-source-root-v1\x00"


@dataclass(frozen=True)
class SourceBinding:
    final_commit: str
    runtime_source_root: str


_CAPABILITY = object()
_bootstrap_capability: object | None = None
_bootstrap_root: Path | None = None
_bootstrap_commit: str | None = None
_bootstrap_source_root: str | None = None


def _fail() -> None:
    raise SuccessorSourceError("G038 successor source verification failed") from None


def _relative(value: str) -> str:
    if type(value) is not str or not value or "\\" in value:
        _fail()
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ("", ".", "..") for part in path.parts):
        _fail()
    return value


def _establish_isolated_bootstrap(root: Path, authorized_commit: str, source_root: str) -> None:
    """Accept the one in-process capability established by the isolated bootstrap."""
    global _bootstrap_capability, _bootstrap_root, _bootstrap_commit, _bootstrap_source_root
    if (_bootstrap_capability is not None or not isinstance(root, Path)
            or type(authorized_commit) is not str or not _COMMIT.fullmatch(authorized_commit)
            or type(source_root) is not str or not _HEX64.fullmatch(source_root)):
        _fail()
    _bootstrap_capability = _CAPABILITY
    _bootstrap_root = root
    _bootstrap_commit = authorized_commit
    _bootstrap_source_root = source_root


def assert_isolated_bootstrap() -> None:
    if _bootstrap_capability is not _CAPABILITY:
        _fail()


def successor_source_inventory(repository_root: Path | str) -> tuple[str, ...]:
    try:
        root = Path(repository_root)
        manifest = load_manifest(root)
    except (TypeError, ValueError, SuccessorContractError):
        _fail()
    inventory = manifest.runtime_inventory
    if inventory != RUNTIME_INVENTORY or tuple(sorted(inventory)) != inventory or len(inventory) != len(set(inventory)):
        _fail()
    for path in inventory:
        _relative(path)
    return inventory


def _git(root: Path, args: Sequence[str], runner: Callable[..., subprocess.CompletedProcess[bytes]]) -> bytes:
    try:
        result = runner(["git", "-C", os.fspath(root), *args], capture_output=True, check=False)
    except Exception:
        _fail()
    if not isinstance(result, subprocess.CompletedProcess) or result.returncode != 0 or type(result.stdout) is not bytes:
        _fail()
    return result.stdout


def _detached_head(root: Path, runner: Callable[..., subprocess.CompletedProcess[bytes]]) -> str:
    try:
        symbolic = runner(["git", "-C", os.fspath(root), "symbolic-ref", "-q", "HEAD"], capture_output=True, check=False)
    except Exception:
        _fail()
    if not isinstance(symbolic, subprocess.CompletedProcess) or symbolic.returncode != 1 or symbolic.stdout not in (b"", None):
        _fail()
    raw = _git(root, ("rev-parse", "--verify", "HEAD^{commit}"), runner)
    if not re.fullmatch(rb"[0-9a-f]{40}\n", raw):
        _fail()
    return raw[:-1].decode("ascii")


def _tree_entry(root: Path, path: str, runner: Callable[..., subprocess.CompletedProcess[bytes]]) -> tuple[str, bytes]:
    raw = _git(root, ("ls-tree", "-z", "HEAD", "--", path), runner)
    suffix = b"\t" + path.encode("utf-8") + b"\x00"
    if not raw.endswith(suffix) or raw.count(b"\x00") != 1:
        _fail()
    try:
        header = raw[:-1].split(b"\t", 1)[0]
        mode, kind, object_id = header.split(b" ")
    except ValueError:
        _fail()
    if mode not in (b"100644", b"100755") or kind != b"blob" or not re.fullmatch(rb"[0-9a-f]{40}", object_id):
        _fail()
    return mode.decode("ascii"), _git(root, ("show", f"HEAD:{path}"), runner)


def _verify_path(root: Path, path: str, runner: Callable[..., subprocess.CompletedProcess[bytes]]) -> tuple[str, str, str]:
    _relative(path)
    _git(root, ("ls-files", "--error-unmatch", "--", path), runner)
    mode, committed = _tree_entry(root, path, runner)
    local = root / Path(*PurePosixPath(path).parts)
    try:
        info = local.lstat()
        valid = (stat.S_ISREG(info.st_mode) and not stat.S_ISLNK(info.st_mode)
                 and bool(info.st_mode & stat.S_IXUSR) == (mode == "100755")
                 and local.read_bytes() == committed)
    except OSError:
        valid = False
    if not valid:
        _fail()
    return path, mode, hashlib.sha256(committed).hexdigest()


def _canonical_root(entries: Sequence[tuple[str, str, str]]) -> str:
    digest = hashlib.sha256(_DOMAIN)
    for path, mode, blob_sha256 in entries:
        encoded = path.encode("utf-8")
        digest.update(len(encoded).to_bytes(4, "big"))
        digest.update(encoded)
        digest.update(mode.encode("ascii"))
        digest.update(bytes.fromhex(blob_sha256))
    return digest.hexdigest()


def _production_bootstrap() -> None:
    flags = sys.flags
    if (getattr(flags, "isolated", 0) != 1 or not getattr(flags, "safe_path", False)
            or _bootstrap_capability is not _CAPABILITY):
        _fail()


def _tracked(root: Path, path: Path, runner: Callable[..., subprocess.CompletedProcess[bytes]]) -> bool:
    try:
        relative = path.relative_to(root).as_posix()
        result = runner(["git", "-C", os.fspath(root), "ls-files", "--error-unmatch", "--", relative], capture_output=True, check=False)
    except Exception:
        _fail()
    return isinstance(result, subprocess.CompletedProcess) and result.returncode == 0


def _no_importable_shadow(root: Path, runner: Callable[..., subprocess.CompletedProcess[bytes]]) -> None:
    for import_root in (root, root / "backend/supabase/scripts"):
        try:
            entries = tuple(import_root.iterdir())
        except OSError:
            _fail()
        for entry in entries:
            try:
                info = entry.lstat()
                if stat.S_ISLNK(info.st_mode):
                    _fail()
                importable = entry.suffix in (".py", ".pyc") or (entry.is_dir() and any((entry / name).is_file() for name in ("__init__.py", "__init__.pyc")))
            except OSError:
                _fail()
            if importable and not _tracked(root, entry, runner):
                _fail()


def verify_successor_source(
    repository_root: Path | str,
    authorized_commit: str,
    *,
    production: bool = False,
    runner: Callable[..., subprocess.CompletedProcess[bytes]] = subprocess.run,
) -> SourceBinding:
    try:
        root = Path(repository_root).resolve(strict=True)
    except (OSError, TypeError, ValueError):
        _fail()
    if type(authorized_commit) is not str or not _COMMIT.fullmatch(authorized_commit) or type(production) is not bool:
        _fail()
    if production:
        _production_bootstrap()
        _no_importable_shadow(root, runner)
    inventory = successor_source_inventory(root)
    head = _detached_head(root, runner)
    if head != authorized_commit:
        _fail()
    if _git(root, ("status", "--porcelain=v1", "-z", "--untracked-files=all"), runner):
        _fail()
    entries = tuple(_verify_path(root, path, runner) for path in inventory)
    source_root = _canonical_root(entries)
    if production and (_bootstrap_root != root or _bootstrap_commit != head or _bootstrap_source_root != source_root):
        _fail()
    return SourceBinding(head, source_root)


__all__ = [
    "SourceBinding", "SuccessorSourceError", "assert_isolated_bootstrap",
    "successor_source_inventory", "verify_successor_source",
]
