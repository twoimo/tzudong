#!/usr/bin/env python3
"""G040's fixed-key authorization and durable one-shot authority boundary."""
from __future__ import annotations

import ctypes
import hashlib
import json
import os
import re
import stat
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping

SCHEMA = "g040-prefix-recovery-authorization-v1"
PURPOSE = "g040-prefix-recovery"
POLICY = "g040-exact-source-pinned-one-shot-v1"
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
    "prefix_state_receipt_sha256", "observation_receipt_sha256", "prefix_classification", "target_fingerprint", "selected_branch",
    "backup_receipt_sha256", "capture_receipt_sha256", "clone_rehearsal_receipt_sha256",
    "freeze_root", "inventory_root", "starting_ledger_root", "target_ledger_root",
    "starting_catalog_root", "target_catalog_root", "starting_data_root", "target_data_root",
))
_BINDINGS = frozenset(_FIELDS - {"schema", "purpose", "policy", "authorization_id", "attempt_id", "issued_at", "expires_at"})
_ROOT_FIELDS = frozenset(("runtime_source_root", "manifest_root", "source_root", "terminal_root", "prefix_root", "suffix_root", "projection_root", "probe_root", "freeze_root", "inventory_root", "starting_ledger_root", "target_ledger_root", "starting_catalog_root", "target_catalog_root", "starting_data_root", "target_data_root"))
_RECEIPT_FIELDS = frozenset(("prefix_state_receipt_sha256", "observation_receipt_sha256", "backup_receipt_sha256", "capture_receipt_sha256", "clone_rehearsal_receipt_sha256"))
_CLASSIFICATION_BRANCHES = {"UNAPPLIED": "execute-00400-then-suffix", "FULL_ESCAPED": "adopt-00400-vector-then-suffix"}

class AuthorizationError(ValueError):
    """Sanitized destructive-boundary failure."""

def canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode("ascii")

def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()

def _pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise AuthorizationError("invalid authorization")
        result[key] = value
    return result

def _constant(_: str) -> None:
    raise AuthorizationError("invalid authorization")

def _fail(message: str) -> None:
    raise AuthorizationError(message) from None

def _hex(value: Any) -> bool:
    return type(value) is str and bool(_HEX.fullmatch(value))

def _id(value: Any) -> bool:
    return type(value) is str and bool(_UUID.fullmatch(value))

def _decode(raw: bytes) -> dict[str, Any]:
    try:
        value = json.loads(raw.decode("ascii"), object_pairs_hook=_pairs, parse_constant=_constant)
        if type(value) is not dict or raw != canonical_json_bytes(value):
            _fail("invalid authorization")
    except AuthorizationError:
        raise
    except Exception:
        value = None
    if type(value) is not dict:
        raise AuthorizationError("invalid authorization")
    return value

def _verify(raw: bytes, signature: bytes) -> None:
    try:
        if hashlib.sha256(PUBLIC_KEY_PEM.encode("ascii")).hexdigest() != PUBLIC_KEY_SHA256:
            _fail("invalid authorization")
        from cryptography.hazmat.primitives.serialization import load_pem_public_key
        load_pem_public_key(PUBLIC_KEY_PEM.encode("ascii")).verify(signature, raw)
    except AuthorizationError:
        raise
    except Exception:
        pass
    else:
        return
    raise AuthorizationError("invalid authorization")

def _validate(value: Any, expected_bindings: Mapping[str, Any], now: int, *, require_fresh: bool = True) -> None:
    if type(value) is not dict or type(expected_bindings) is not dict or set(value) != _FIELDS or set(expected_bindings) != _BINDINGS:
        _fail("invalid authorization")
    if value["schema"] != SCHEMA or value["purpose"] != PURPOSE or value["policy"] != POLICY or not _id(value["authorization_id"]) or not _id(value["attempt_id"]):
        _fail("invalid authorization")
    if value["base_commit"] != "92894e41cddb57767c9764d1694992bc0ad9d922" or type(value["final_recovery_commit"]) is not str or not _COMMIT.fullmatch(value["final_recovery_commit"]):
        _fail("invalid authorization")
    if any(not _hex(value[key]) for key in _ROOT_FIELDS | _RECEIPT_FIELDS | {"target_fingerprint"}):
        _fail("invalid authorization")
    if type(value["prefix_classification"]) is not str or type(value["selected_branch"]) is not str or _CLASSIFICATION_BRANCHES.get(value["prefix_classification"]) != value["selected_branch"]:
        _fail("invalid authorization")
    if type(value["issued_at"]) is not int or type(value["expires_at"]) is not int or value["expires_at"] <= value["issued_at"] or value["expires_at"] - value["issued_at"] > 900:
        _fail("invalid authorization")
    if require_fresh and (value["issued_at"] > now + 30 or value["expires_at"] <= now):
        _fail("invalid authorization")
    if any(value[key] != expected_bindings[key] for key in _BINDINGS):
        _fail("invalid authorization")
def verify_outcome_authorization(envelope: AuthorizationEnvelope, *, now: int | None = None) -> VerifiedAuthorization:
    """Verify the fixed signed authorization document for non-mutating readback.

    Immutable binding equality is deliberately performed by the prepared-intent
    anchor, rather than against caller supplied current artifacts.
    """
    if type(envelope) is not AuthorizationEnvelope:
        _fail("invalid authorization")
    try:
        raw, sig = _reread(envelope)
        value = _decode(raw)
        _verify(raw, sig)
        immutable = {key: value[key] for key in _BINDINGS} if type(value) is dict and set(value) == _FIELDS else None
        _validate(value, immutable, int(time.time()) if now is None else now, require_fresh=False)
        return VerifiedAuthorization(**dict(value, authorization_sha256=hashlib.sha256(raw).hexdigest(), signature_sha256=hashlib.sha256(sig).hexdigest(), bindings_sha256=canonical_sha256(immutable)))
    finally:
        for field in ("authorization_fd", "signature_fd"):
            fd = getattr(envelope, field)
            try:
                if type(fd) is int and fd >= 0:
                    os.close(fd)
            except Exception:
                pass
            finally:
                object.__setattr__(envelope, field, -1)

@dataclass(frozen=True)
class AuthorizationEnvelope:
    raw: bytes
    signature: bytes
    authorization_fd: int | None = None
    signature_fd: int | None = None

@dataclass(frozen=True)
class VerifiedAuthorization:
    schema: str; purpose: str; policy: str; authorization_id: str; attempt_id: str; issued_at: int; expires_at: int
    final_recovery_commit: str; base_commit: str; runtime_source_root: str; manifest_root: str; source_root: str
    terminal_root: str; prefix_root: str; suffix_root: str; projection_root: str; probe_root: str
    prefix_state_receipt_sha256: str; observation_receipt_sha256: str; prefix_classification: str; target_fingerprint: str; selected_branch: str
    backup_receipt_sha256: str; capture_receipt_sha256: str; clone_rehearsal_receipt_sha256: str
    freeze_root: str; inventory_root: str; starting_ledger_root: str; target_ledger_root: str
    starting_catalog_root: str; target_catalog_root: str; starting_data_root: str; target_data_root: str
    authorization_sha256: str; signature_sha256: str; bindings_sha256: str

@dataclass(frozen=True)
class AttemptStarted:
    schema: str; event: str; authorization_id: str; attempt_id: str; at: int
    target_fingerprint: str; runtime_source_root: str; prefix_state_receipt_sha256: str; observation_receipt_sha256: str
    prefix_classification: str; selected_branch: str; authorization_sha256: str
    signature_sha256: str; bindings_sha256: str; receipt_sha256: str

def _parent_restrictive(path: Path) -> None:
    try:
        parent = path.parent
        info = parent.stat(follow_symlinks=False)
        if parent.is_symlink() or not stat.S_ISDIR(info.st_mode):
            _fail("custody failure")
        if os.name == "nt":
            if not _windows_restrictive(parent): _fail("custody failure")
        elif info.st_mode & 0o077:
            _fail("custody failure")
    except AuthorizationError:
        raise
    except Exception:
        _fail("custody failure")

class _AclSizeInformation(ctypes.Structure):
    _fields_ = (("ace_count", ctypes.c_uint32), ("sbz1", ctypes.c_uint32), ("sbz2", ctypes.c_uint32))


class _AceHeader(ctypes.Structure):
    _fields_ = (("ace_type", ctypes.c_ubyte), ("ace_flags", ctypes.c_ubyte), ("ace_size", ctypes.c_uint16))


_INVALID_HANDLE_VALUE = ctypes.c_void_p(-1).value
_SE_FILE_OBJECT = 1
_OWNER_SECURITY_INFORMATION = 0x00000001
_DACL_SECURITY_INFORMATION = 0x00000004
_ACL_SIZE_INFORMATION = 2
_ACCESS_ALLOWED_ACE_TYPE = 0
_INHERITED_ACE = 0x10
_WRITE_AUTHORITY_MASK = 0x10000000 | 0x40000000 | 0x00010000 | 0x00040000 | 0x00080000 | 0x00000156
_WIN_LOCAL_SYSTEM_SID = 22
_WIN_BUILTIN_ADMINISTRATORS_SID = 26


def _windows_api() -> tuple[Any, Any]:
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel32.CreateFileW.argtypes = (ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p)
    kernel32.CreateFileW.restype = ctypes.c_void_p
    kernel32.FlushFileBuffers.argtypes = (ctypes.c_void_p,)
    kernel32.FlushFileBuffers.restype = ctypes.c_int
    kernel32.CloseHandle.argtypes = (ctypes.c_void_p,)
    kernel32.CloseHandle.restype = ctypes.c_int
    kernel32.LocalFree.argtypes = (ctypes.c_void_p,)
    kernel32.LocalFree.restype = ctypes.c_void_p
    advapi32.GetNamedSecurityInfoW.argtypes = (ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p))
    advapi32.GetNamedSecurityInfoW.restype = ctypes.c_uint32
    advapi32.GetAclInformation.argtypes = (ctypes.c_void_p, ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int)
    advapi32.GetAclInformation.restype = ctypes.c_int
    advapi32.GetAce.argtypes = (ctypes.c_void_p, ctypes.c_uint32, ctypes.POINTER(ctypes.c_void_p))
    advapi32.GetAce.restype = ctypes.c_int
    advapi32.CreateWellKnownSid.argtypes = (ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32))
    advapi32.CreateWellKnownSid.restype = ctypes.c_int
    advapi32.EqualSid.argtypes = (ctypes.c_void_p, ctypes.c_void_p)
    advapi32.EqualSid.restype = ctypes.c_int
    return kernel32, advapi32


def _well_known_sid(advapi32: Any, sid_type: int) -> Any | None:
    buffer = ctypes.create_string_buffer(68)
    size = ctypes.c_uint32(len(buffer))
    if not advapi32.CreateWellKnownSid(sid_type, None, buffer, ctypes.byref(size)):
        return None
    return buffer


def _windows_restrictive(path: Path) -> bool:
    """Accept an explicit allow-only DACL for owner, SYSTEM, and Administrators."""
    descriptor = ctypes.c_void_p()
    try:
        kernel32, advapi32 = _windows_api()
        owner = ctypes.c_void_p()
        dacl = ctypes.c_void_p()
        if advapi32.GetNamedSecurityInfoW(str(path), _SE_FILE_OBJECT, _OWNER_SECURITY_INFORMATION | _DACL_SECURITY_INFORMATION, ctypes.byref(owner), None, ctypes.byref(dacl), None, ctypes.byref(descriptor)) != 0:
            return False
        if not owner.value or not dacl.value:
            return False
        system = _well_known_sid(advapi32, _WIN_LOCAL_SYSTEM_SID)
        administrators = _well_known_sid(advapi32, _WIN_BUILTIN_ADMINISTRATORS_SID)
        if system is None or administrators is None:
            return False
        info = _AclSizeInformation()
        if not advapi32.GetAclInformation(dacl, ctypes.byref(info), ctypes.sizeof(info), _ACL_SIZE_INFORMATION) or info.ace_count == 0:
            return False
        for index in range(info.ace_count):
            ace = ctypes.c_void_p()
            if not advapi32.GetAce(dacl, index, ctypes.byref(ace)) or not ace.value:
                return False
            header = ctypes.cast(ace, ctypes.POINTER(_AceHeader)).contents
            if header.ace_type != _ACCESS_ALLOWED_ACE_TYPE or header.ace_size < 8:
                return False
            mask = ctypes.c_uint32.from_address(ace.value + 4).value
            sid = ctypes.c_void_p(ace.value + 8)
            permitted = bool(advapi32.EqualSid(owner, sid) or advapi32.EqualSid(ctypes.cast(system, ctypes.c_void_p), sid) or advapi32.EqualSid(ctypes.cast(administrators, ctypes.c_void_p), sid))
            if not permitted or ((header.ace_flags & _INHERITED_ACE) and (mask & _WRITE_AUTHORITY_MASK)):
                return False
        return True
    except Exception:
        return False
    finally:
        if descriptor.value:
            try:
                kernel32.LocalFree(descriptor)
            except Exception:
                pass

def restrictive_regular_file(path: str | Path, label: str = "authorization", repository_root: str | Path | None = None) -> Path:
    try:
        candidate = Path(path)
        _parent_restrictive(candidate)
        info = candidate.stat(follow_symlinks=False)
        if candidate.is_symlink() or not stat.S_ISREG(info.st_mode) or (os.name != "nt" and info.st_mode & 0o077): _fail("custody failure")
        if repository_root is not None:
            root, resolved = Path(repository_root).resolve(strict=True), candidate.resolve(strict=True)
            if resolved == root or root in resolved.parents: _fail("custody failure")
        if os.name == "nt" and not _windows_restrictive(candidate): _fail("custody failure")
        return candidate
    except AuthorizationError:
        raise
    except Exception:
        _fail("custody failure")

def _open_custody(path: Path) -> tuple[int, bytes]:
    fd: int | None = None
    try:
        restrictive_regular_file(path)
        flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(path, flags)
        restrictive_regular_file(path)
        before = os.stat(path, follow_symlinks=False); opened = os.fstat(fd)
        if not stat.S_ISREG(opened.st_mode) or (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino): _fail("custody failure")
        if os.name != "nt" and opened.st_mode & 0o077: _fail("custody failure")
        raw = os.read(fd, opened.st_size + 1)
        if len(raw) != opened.st_size: _fail("custody failure")
    except AuthorizationError:
        if fd is not None: os.close(fd)
        raise
    except Exception:
        if fd is not None:
            try: os.close(fd)
            except Exception: pass
    else:
        return fd, raw
    raise AuthorizationError("custody failure")


def authenticate_recovery_authorization(authorization: bytes | str | Path, signature: bytes | str | Path, *, expected_bindings: dict[str, Any] | None, now: int | None = None, require_fresh: bool = True) -> AuthorizationEnvelope:
    auth_fd: int | None = None; sig_fd: int | None = None
    try:
        if type(authorization) is bytes: raw = bytes(authorization)
        else: auth_fd, raw = _open_custody(Path(authorization))
        if type(signature) is bytes: sig = bytes(signature)
        else: sig_fd, sig = _open_custody(Path(signature))
        value = _decode(raw); _verify(raw, sig)
        if expected_bindings is not None:
            _validate(value, expected_bindings, int(time.time()) if now is None else now, require_fresh=require_fresh)
    except AuthorizationError:
        for fd in (auth_fd, sig_fd):
            if fd is not None: os.close(fd)
        raise
    except Exception:
        for fd in (auth_fd, sig_fd):
            if fd is not None:
                try: os.close(fd)
                except Exception: pass
    else:
        return AuthorizationEnvelope(raw, sig, auth_fd, sig_fd)
    raise AuthorizationError("invalid authorization")

def _reread(envelope: AuthorizationEnvelope) -> tuple[bytes, bytes]:
    try:
        def current(fd: int | None, saved: bytes) -> bytes:
            if fd is None: return saved
            size = os.fstat(fd).st_size
            if hasattr(os, "pread"):
                raw = os.pread(fd, size + 1, 0)
            else:
                os.lseek(fd, 0, os.SEEK_SET)
                raw = os.read(fd, size + 1)
            if len(raw) != size or raw != saved: _fail("source verification failed")
            return raw
        result = current(envelope.authorization_fd, envelope.raw), current(envelope.signature_fd, envelope.signature)
    except AuthorizationError:
        raise
    except Exception:
        result = None
    if result is None:
        raise AuthorizationError("source verification failed")
    return result

def reverify_destructive_stage(envelope: AuthorizationEnvelope, *, expected_bindings: dict[str, Any], now: int | None = None) -> VerifiedAuthorization:
    if type(envelope) is not AuthorizationEnvelope or type(envelope.raw) is not bytes or type(envelope.signature) is not bytes:
        _fail("invalid authorization")
    try:
        raw, sig = _reread(envelope); value = _decode(raw); _verify(raw, sig); _validate(value, expected_bindings, int(time.time()) if now is None else now)
        evidence = dict(value, authorization_sha256=hashlib.sha256(raw).hexdigest(), signature_sha256=hashlib.sha256(sig).hexdigest(), bindings_sha256=canonical_sha256({key: value[key] for key in _BINDINGS}))
        try:
            result = VerifiedAuthorization(**evidence)
        except Exception:
            result = None
        if result is None:
            raise AuthorizationError("invalid authorization")
        return result
    finally:
        for field in ("authorization_fd", "signature_fd"):
            fd = getattr(envelope, field)
            try:
                if type(fd) is int and fd >= 0:
                    os.close(fd)
            except Exception:
                pass
            finally:
                object.__setattr__(envelope, field, -1)


def _journal_parent(directory: Path, repository_root: Path) -> Path:
    try:
        parent, root = directory.resolve(strict=True), repository_root.resolve(strict=True)
        info = parent.stat(follow_symlinks=False)
        if parent.is_symlink() or not stat.S_ISDIR(info.st_mode) or parent == root or root in parent.parents: _fail("journal custody failure")
        if os.name == "nt":
            if not _windows_restrictive(parent): _fail("journal custody failure")
        elif info.st_mode & 0o077: _fail("journal custody failure")
        return parent
    except AuthorizationError: raise
    except Exception: _fail("journal custody failure")

def _fsync_directory(path: Path) -> None:
    handle: Any = None
    try:
        if os.name == "nt":
            kernel32, _ = _windows_api()
            handle = kernel32.CreateFileW(str(path), 0x40000000, 0x7, None, 3, 0x02000000, None)
            if handle in (None, _INVALID_HANDLE_VALUE) or not kernel32.FlushFileBuffers(handle):
                _fail("journal write failure")
            return
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    except AuthorizationError:
        raise
    except Exception:
        _fail("journal write failure")
    finally:
        if os.name == "nt" and handle not in (None, _INVALID_HANDLE_VALUE):
            try:
                kernel32.CloseHandle(handle)
            except Exception:
                pass

def _write_all(fd: int, data: bytes) -> None:
    offset = 0
    while offset < len(data):
        written = os.write(fd, data[offset:])
        if type(written) is not int or written <= 0:
            _fail("journal write failure")
        offset += written

def consume_one_shot_attempt(journal_dir: str | Path, *, repository_root: str | Path, authorization: VerifiedAuthorization, callback: Callable[[AttemptStarted], Any], now: int | None = None) -> tuple[AttemptStarted, Any]:
    if type(authorization) is not VerifiedAuthorization or not callable(callback): _fail("invalid authorization")
    parent = _journal_parent(Path(journal_dir), Path(repository_root))
    marker = parent / f"{authorization.authorization_id}-{authorization.attempt_id}.json"
    body = {"schema": JOURNAL_SCHEMA, "event": "attempt-started", "authorization_id": authorization.authorization_id, "attempt_id": authorization.attempt_id, "at": int(time.time()) if now is None else now, "target_fingerprint": authorization.target_fingerprint, "runtime_source_root": authorization.runtime_source_root, "prefix_state_receipt_sha256": authorization.prefix_state_receipt_sha256, "observation_receipt_sha256": authorization.observation_receipt_sha256, "prefix_classification": authorization.prefix_classification, "selected_branch": authorization.selected_branch, "authorization_sha256": authorization.authorization_sha256, "signature_sha256": authorization.signature_sha256, "bindings_sha256": authorization.bindings_sha256}
    body["receipt_sha256"] = canonical_sha256(body)
    attempt = AttemptStarted(**body); data = canonical_json_bytes(body)
    try:
        fd = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600)
    except Exception: _fail("attempt already consumed or journal unavailable")
    try:
        if os.name != "nt": os.fchmod(fd, 0o600)
        _write_all(fd, data); os.fsync(fd)
        if os.name == "nt" and not _windows_restrictive(marker): _fail("journal write failure")
    except Exception: _fail("journal write failure")
    finally:
        try: os.close(fd)
        except Exception: pass
    _fsync_directory(parent)
    return attempt, callback(attempt)
