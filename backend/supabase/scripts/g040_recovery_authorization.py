#!/usr/bin/env python3
"""G040 recovery-only signed authority and durable one-shot attempt journal."""
from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import subprocess
import errno
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Callable, Mapping

SCHEMA = "g040-prefix-recovery-authorization-v1"
PURPOSE = "g040-prefix-recovery"
POLICY = "g040-exact-source-pinned-one-shot-v1"
# This is deliberately independent of every G035/G037 key and policy.
PUBLIC_KEY_PEM = """-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAgy8M88hrM04SdOcI3H/fNre+IFZ08tSl7KOQWkQH9K0=
-----END PUBLIC KEY-----
"""
PUBLIC_KEY_SHA256 = "6232368a02ebacafc21d4b99f6c9b8af07a716dd0dba2addd5e36a2d6cae5878"
JOURNAL_SCHEMA = "g040-recovery-attempt-started-v1"
_HEX = re.compile(r"^[a-f0-9]{64}$")
_COMMIT = re.compile(r"^[a-f0-9]{40}$")
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")

_FIELDS = frozenset((
    "schema", "purpose", "policy", "authorization_id", "attempt_id", "issued_at", "expires_at",
    "final_recovery_commit", "base_commit", "runtime_source_root", "manifest_root", "source_root",
    "terminal_root", "prefix_root", "suffix_root", "projection_root", "probe_root",
    "prefix_state_receipt_sha256", "prefix_classification", "target_fingerprint", "selected_branch",
    "backup_receipt_sha256", "capture_receipt_sha256", "clone_rehearsal_receipt_sha256",
    "freeze_root", "inventory_root", "starting_ledger_root", "target_ledger_root",
    "starting_catalog_root", "target_catalog_root", "starting_data_root", "target_data_root",
))
_BINDINGS = frozenset(_FIELDS - {"schema", "purpose", "policy", "authorization_id", "attempt_id", "issued_at", "expires_at"})
_ROOT_FIELDS = frozenset(("runtime_source_root", "manifest_root", "source_root", "terminal_root", "prefix_root", "suffix_root", "projection_root", "probe_root", "freeze_root", "inventory_root", "starting_ledger_root", "target_ledger_root", "starting_catalog_root", "target_catalog_root", "starting_data_root", "target_data_root"))
_RECEIPT_FIELDS = frozenset(("prefix_state_receipt_sha256", "backup_receipt_sha256", "capture_receipt_sha256", "clone_rehearsal_receipt_sha256"))
_CLASSIFICATION_BRANCHES = MappingProxyType({
    "UNAPPLIED": "execute-00400-then-suffix",
    "FULL_ESCAPED": "adopt-00400-vector-then-suffix",
})
_EVIDENCE_FIELDS = frozenset(("authorization_sha256", "signature_sha256", "bindings_sha256"))

class AuthorizationError(ValueError):
    """Deliberately non-diagnostic failure suitable for destructive callers."""

@dataclass(frozen=True)
class AuthorizationEnvelope:
    raw: bytes
    signature: bytes


def canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode("ascii")

def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()

def _pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            raise AuthorizationError("invalid authorization")
        out[key] = value
    return out

def _constant(_: str) -> None:
    raise AuthorizationError("invalid authorization")

def _load_canonical(path: Path) -> tuple[bytes, dict[str, Any]]:
    failed = False
    try:
        raw = path.read_bytes()
        value = json.loads(raw.decode("ascii"), object_pairs_hook=_pairs, parse_constant=_constant)
        if type(value) is not dict or raw != canonical_json_bytes(value):
            failed = True
    except Exception:
        failed = True
    if failed:
        raise AuthorizationError("invalid authorization")
    return raw, value

def _hex(value: Any) -> bool:
    return type(value) is str and bool(_HEX.fullmatch(value))

def _id(value: Any) -> bool:
    return type(value) is str and bool(_UUID.fullmatch(value))

def _verify(raw: bytes, signature: bytes) -> None:
    if hashlib.sha256(PUBLIC_KEY_PEM.encode("ascii")).hexdigest() != PUBLIC_KEY_SHA256:
        raise AuthorizationError("invalid authorization")
    failed = False
    try:
        from cryptography.hazmat.primitives.serialization import load_pem_public_key
        load_pem_public_key(PUBLIC_KEY_PEM.encode("ascii")).verify(signature, raw)
    except Exception:
        failed = True
    if failed:
        raise AuthorizationError("invalid authorization")

def _validate(value: Any, expected_bindings: Mapping[str, Any], now: int) -> None:
    if type(value) is not dict or type(expected_bindings) is not dict or set(value) != _FIELDS or set(expected_bindings) != _BINDINGS:
        raise AuthorizationError("invalid authorization")
    if value["schema"] != SCHEMA or value["purpose"] != PURPOSE or value["policy"] != POLICY:
        raise AuthorizationError("invalid authorization")
    if not _id(value["authorization_id"]) or not _id(value["attempt_id"]):
        raise AuthorizationError("invalid authorization")
    if value["base_commit"] != "92894e41cddb57767c9764d1694992bc0ad9d922" or not (type(value["final_recovery_commit"]) is str and _COMMIT.fullmatch(value["final_recovery_commit"])):
        raise AuthorizationError("invalid authorization")
    if any(not _hex(value[k]) for k in _ROOT_FIELDS | _RECEIPT_FIELDS | {"target_fingerprint"}):
        raise AuthorizationError("invalid authorization")
    if (
        type(value["prefix_classification"]) is not str
        or type(value["selected_branch"]) is not str
        or _CLASSIFICATION_BRANCHES.get(value["prefix_classification"]) != value["selected_branch"]
    ):
        raise AuthorizationError("invalid authorization")
    issued, expires = value["issued_at"], value["expires_at"]
    if type(issued) is not int or type(expires) is not int or issued > now + 30 or expires <= now or expires <= issued or expires - issued > 900:
        raise AuthorizationError("invalid authorization")
    if any(value[k] != expected_bindings[k] for k in _BINDINGS):
        raise AuthorizationError("invalid authorization")

def _freeze(value: Any) -> Any:
    if type(value) is dict:
        return MappingProxyType({key: _freeze(child) for key, child in value.items()})
    if type(value) is list:
        return tuple(_freeze(child) for child in value)
    if type(value) in (str, int, float, bool, type(None)):
        return value
    raise AuthorizationError("invalid authorization")

def restrictive_regular_file(path: str | Path, label: str, repository_root: str | Path | None = None) -> Path:
    failed = False
    try:
        candidate = Path(path)
    except Exception:
        failed = True
    if failed:
        raise AuthorizationError("custody failure")
    try:
        info = candidate.stat(follow_symlinks=False)
        resolved = candidate.resolve(strict=True)
        root = Path(repository_root).resolve(strict=True) if repository_root is not None else None
        is_symlink = candidate.is_symlink()
    except Exception:
        failed = True
    if failed:
        raise AuthorizationError("custody failure")
    if is_symlink or not stat.S_ISREG(info.st_mode) or (root is not None and (resolved == root or root in resolved.parents)):
        raise AuthorizationError("custody failure")
    if os.name == "nt":
        if not _windows_restrictive(candidate):
            raise AuthorizationError("custody failure")
    elif info.st_mode & 0o077:
        raise AuthorizationError("custody failure")
    return candidate

def _windows_restrictive(path: Path) -> bool:
    """Fail closed: an explicit protected ACL limited to current owner/system/admin."""
    try:
        result = subprocess.run(["icacls", str(path)], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", timeout=10, check=True)
        text = result.stdout
        return "(F)" in text and "Everyone:" not in text and "BUILTIN\\Users:" not in text
    except (OSError, subprocess.SubprocessError):
        return False

def authenticate_recovery_authorization(authorization: str | Path, signature: str | Path, *, require_custody: Callable[[Path, str], Any], expected_bindings: dict[str, Any], now: int | None = None) -> AuthorizationEnvelope:
    if not callable(require_custody):
        raise AuthorizationError("custody failure")
    path_failed = False
    try:
        auth_path, signature_path = Path(authorization), Path(signature)
    except Exception:
        path_failed = True
    if path_failed:
        raise AuthorizationError("custody failure")
    custody_failed = False
    try:
        require_custody(auth_path, "authorization")
        require_custody(signature_path, "authorization signature")
    except Exception:
        custody_failed = True
    if custody_failed:
        raise AuthorizationError("custody failure")
    invalid = False
    custody_failed = False
    try:
        raw, value = _load_canonical(auth_path)
        sig = signature_path.read_bytes()
    except AuthorizationError:
        invalid = True
    except Exception:
        custody_failed = True
    if invalid:
        raise AuthorizationError("invalid authorization")
    if custody_failed:
        raise AuthorizationError("custody failure")
    _verify(raw, sig)
    _validate(value, expected_bindings, int(time.time()) if now is None else now)
    return AuthorizationEnvelope(bytes(raw), bytes(sig))

def reverify_destructive_stage(envelope: AuthorizationEnvelope, *, expected_bindings: dict[str, Any], now: int | None = None, source_is_exact: Callable[[], bool]) -> Mapping[str, Any]:
    if type(envelope) is not AuthorizationEnvelope or type(envelope.raw) is not bytes or type(envelope.signature) is not bytes or not callable(source_is_exact):
        raise AuthorizationError("invalid authorization")
    invalid = False
    try:
        value = json.loads(envelope.raw.decode("ascii"), object_pairs_hook=_pairs, parse_constant=_constant)
        if type(value) is not dict or envelope.raw != canonical_json_bytes(value):
            invalid = True
    except Exception:
        invalid = True
    if invalid:
        raise AuthorizationError("invalid authorization")
    _verify(envelope.raw, envelope.signature)
    _validate(value, expected_bindings, int(time.time()) if now is None else now)
    source_failed = False
    try:
        exact = source_is_exact()
    except Exception:
        source_failed = True
    if source_failed or exact is not True:
        raise AuthorizationError("source verification failed")
    evidence = {
        **value,
        "authorization_sha256": hashlib.sha256(envelope.raw).hexdigest(),
        "signature_sha256": hashlib.sha256(envelope.signature).hexdigest(),
        "bindings_sha256": canonical_sha256({key: value[key] for key in _BINDINGS}),
    }
    return _freeze(evidence)

def verify_recovery_authorization(authorization: str | Path, signature: str | Path, *, require_custody: Callable[[Path, str], Any], expected_bindings: dict[str, Any], source_is_exact: Callable[[], bool], now: int | None = None) -> Mapping[str, Any]:
    return reverify_destructive_stage(authenticate_recovery_authorization(authorization, signature, require_custody=require_custody, expected_bindings=expected_bindings, now=now), expected_bindings=expected_bindings, source_is_exact=source_is_exact, now=now)

def _journal_parent(path: Path, repository_root: Path) -> Path:
    failed = False
    try:
        parent = path.parent.resolve(strict=True)
        root = repository_root.resolve(strict=True)
        info = parent.stat(follow_symlinks=False)
        is_symlink = parent.is_symlink()
    except Exception:
        failed = True
    if failed:
        raise AuthorizationError("journal custody failure")
    if is_symlink or not stat.S_ISDIR(info.st_mode) or parent == root or root in parent.parents:
        raise AuthorizationError("journal custody failure")
    if os.name == "nt":
        if not _windows_restrictive(parent):
            raise AuthorizationError("journal custody failure")
    elif info.st_mode & 0o077:
        raise AuthorizationError("journal custody failure")
    return parent

def _write_all(fd: int, data: bytes) -> None:
    offset = 0
    while offset < len(data):
        written = os.write(fd, data[offset:])
        if type(written) is not int or written <= 0:
            raise AuthorizationError("journal write failure")
        offset += written


def _fsync_directory(path: Path) -> None:
    if os.name == "nt":
        return
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
    failed = False
    try:
        fd = os.open(path, flags)
    except OSError:
        failed = True
    if failed:
        raise AuthorizationError("journal write failure")
    failed = False
    try:
        os.fsync(fd)
    except OSError as exc:
        failed = exc.errno not in {errno.EINVAL, getattr(errno, "ENOTSUP", errno.EINVAL)}
    finally:
        try:
            os.close(fd)
        except OSError:
            pass
    if failed:
        raise AuthorizationError("journal write failure")


def consume_one_shot_attempt(journal_dir: str | Path, *, repository_root: str | Path, authorization: Mapping[str, Any], callback: Callable[[], Any], now: int | None = None) -> Mapping[str, Any]:
    """Persist consumption before invoking callback; failures never remove the marker."""
    if type(authorization) is not MappingProxyType or not callable(callback):
        raise AuthorizationError("invalid authorization")
    required = {
        "authorization_id", "attempt_id", "target_fingerprint", "runtime_source_root",
        "prefix_state_receipt_sha256", "prefix_classification", "selected_branch",
        *_EVIDENCE_FIELDS,
    }
    if (
        set(authorization) != _FIELDS | _EVIDENCE_FIELDS
        or not required <= set(authorization)
        or not _id(authorization["authorization_id"])
        or not _id(authorization["attempt_id"])
        or not _hex(authorization["target_fingerprint"])
        or not _hex(authorization["runtime_source_root"])
        or not _hex(authorization["prefix_state_receipt_sha256"])
        or any(not _hex(authorization[key]) for key in _EVIDENCE_FIELDS)
        or type(authorization["prefix_classification"]) is not str
        or type(authorization["selected_branch"]) is not str
        or _CLASSIFICATION_BRANCHES.get(authorization["prefix_classification"]) != authorization["selected_branch"]
    ):
        raise AuthorizationError("invalid authorization")
    path_failed = False
    try:
        journal_path = Path(journal_dir)
        root_path = Path(repository_root)
    except Exception:
        path_failed = True
    if path_failed:
        raise AuthorizationError("journal custody failure")
    parent = _journal_parent(journal_path / "marker", root_path)
    marker = parent / (authorization["authorization_id"] + "-" + authorization["attempt_id"] + ".json")
    receipt = {
        "schema": JOURNAL_SCHEMA,
        "event": "attempt-started",
        "authorization_id": authorization["authorization_id"],
        "attempt_id": authorization["attempt_id"],
        "at": int(time.time()) if now is None else now,
        "target_fingerprint": authorization["target_fingerprint"],
        "runtime_source_root": authorization["runtime_source_root"],
        "prefix_state_receipt_sha256": authorization["prefix_state_receipt_sha256"],
        "prefix_classification": authorization["prefix_classification"],
        "selected_branch": authorization["selected_branch"],
        "authorization_sha256": authorization["authorization_sha256"],
        "signature_sha256": authorization["signature_sha256"],
        "bindings_sha256": authorization["bindings_sha256"],
    }
    receipt["receipt_sha256"] = canonical_sha256(receipt)
    data = canonical_json_bytes(receipt)
    open_failed = False
    try:
        fd = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600)
    except OSError:
        open_failed = True
    if open_failed:
        raise AuthorizationError("attempt already consumed or journal unavailable")
    write_failed = False
    try:
        if os.name != "nt":
            os.fchmod(fd, 0o600)
            if os.fstat(fd).st_mode & 0o077:
                write_failed = True
        _write_all(fd, data)
        os.fsync(fd)
        if os.name == "nt" and not _windows_restrictive(marker):
            write_failed = True
    except Exception:
        write_failed = True
    finally:
        try:
            os.close(fd)
        except OSError:
            pass
    if write_failed:
        raise AuthorizationError("journal write failure")
    _fsync_directory(parent)
    # The marker is intentionally retained even if this raises or returns false.
    callback()
    return _freeze(receipt)
