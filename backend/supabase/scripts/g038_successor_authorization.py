#!/usr/bin/env python3
"""G038's fixed-key successor authorization and durable one-shot authority boundary."""
from __future__ import annotations

import argparse
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

SCHEMA = "g038-account-deletion-successor-authorization-v1"
PURPOSE = "g038-account-deletion-successor-40-to-42"
POLICY = "g038-exact-source-pinned-one-shot-v1"
PUBLIC_KEY_PEM = """-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAfXabraZsV+AqqaFjH32scMPqBGC8TQmgrVna9j4SEZ8=
-----END PUBLIC KEY-----
"""
PUBLIC_KEY_SHA256 = "723cae40a86087e1206ca0449e34cbc14a3233bb53c7ae04710b97952e405473"
JOURNAL_SCHEMA = "g038-successor-attempt-started-v1"
CANONICAL_JOURNAL_DIRECTORY = Path("C:/ProgramData/TzudongRecovery/g038-successor-attempt-journal") if os.name == "nt" else Path("/var/lib/tzudong-recovery/g038-successor-attempt-journal")
PREDECESSOR_COMMIT = "664cee04a4f239d6cf8fe2eebab8de9c8404b316"
PREDECESSOR_REPORT_SHA256 = "85f6b1e6e34e3311bbffd7146232ca41d6393bdd43688d4ebd7b230bdf929114"
SELECTED_VERSIONS = ("20260713002600", "20260713002700")
_HEX = re.compile(r"^[a-f0-9]{64}$")
_COMMIT = re.compile(r"^[a-f0-9]{40}$")
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
_FIELDS = frozenset((
    "schema", "purpose", "policy", "authorization_id", "attempt_id", "issued_at", "expires_at",
    "target_fingerprint", "target_acl_root", "g038_source_commit", "runtime_source_root",
    "source_validation_receipt_sha256",
    "source_root", "manifest_root", "vector_root", "predecessor_commit",
    "predecessor_report_sha256", "predecessor_outcome_sha256", "predecessor_readback_sha256",
    "predecessor_rows", "target_rows",
    "starting_ledger_root", "starting_catalog_root", "starting_acl_root", "starting_data_root",
    "target_ledger_root", "target_catalog_root", "target_data_root", "target_spec_sha256",
    "observation_receipt_sha256", "backup_receipt_sha256", "capture_receipt_sha256",
    "dual_clone_receipt_sha256", "archive_sha256", "archive_bytes", "freeze_expires_at",
    "freeze_root", "inventory_root", "selected_versions", "exclusions_root",
    "disposable_runtime_subject_sha256", "disposable_runtime_proof_contract_sha256",
))
_BINDINGS = frozenset(_FIELDS - {"schema", "purpose", "policy", "authorization_id", "attempt_id", "issued_at", "expires_at"})
_ROOT_FIELDS = frozenset((
    "target_fingerprint", "target_acl_root", "runtime_source_root", "source_root", "manifest_root",
    "vector_root", "starting_ledger_root", "starting_catalog_root", "starting_acl_root",
    "starting_data_root", "target_ledger_root", "target_catalog_root", "target_data_root",
    "freeze_root", "inventory_root", "exclusions_root",
))
_RECEIPT_FIELDS = frozenset((
    "predecessor_report_sha256", "predecessor_outcome_sha256", "predecessor_readback_sha256",
    "source_validation_receipt_sha256",
    "target_spec_sha256", "observation_receipt_sha256", "backup_receipt_sha256",
    "capture_receipt_sha256", "dual_clone_receipt_sha256", "archive_sha256",
    "disposable_runtime_subject_sha256", "disposable_runtime_proof_contract_sha256",
))

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
        if type(PUBLIC_KEY_PEM) is not str or type(PUBLIC_KEY_SHA256) is not str or hashlib.sha256(PUBLIC_KEY_PEM.encode("ascii")).hexdigest() != PUBLIC_KEY_SHA256:
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
    if value["schema"] != SCHEMA or value["purpose"] != PURPOSE or value["policy"] != POLICY or not _id(value["authorization_id"]) or not _id(value["attempt_id"]) or value["authorization_id"] == value["attempt_id"]:
        _fail("invalid authorization")
    if (value["predecessor_commit"] != PREDECESSOR_COMMIT
            or value["predecessor_report_sha256"] != PREDECESSOR_REPORT_SHA256
            or type(value["g038_source_commit"]) is not str
            or not _COMMIT.fullmatch(value["g038_source_commit"])):
        _fail("invalid authorization")
    if any(not _hex(value[key]) for key in _ROOT_FIELDS | _RECEIPT_FIELDS):
        _fail("invalid authorization")
    if type(value["selected_versions"]) is not list or tuple(value["selected_versions"]) != SELECTED_VERSIONS or any(type(item) is not str for item in value["selected_versions"]):
        _fail("invalid authorization")
    if (type(value["issued_at"]) is not int or type(value["expires_at"]) is not int
            or type(value["freeze_expires_at"]) is not int or type(value["archive_bytes"]) is not int
            or type(value["predecessor_rows"]) is not int or type(value["target_rows"]) is not int
            or value["predecessor_rows"] != 40 or value["target_rows"] != 42
            or value["archive_bytes"] < 0 or value["freeze_expires_at"] <= value["issued_at"]
            or value["expires_at"] <= value["issued_at"] or value["expires_at"] - value["issued_at"] > 900):
        _fail("invalid authorization")
    if require_fresh and (value["issued_at"] > now + 30 or value["expires_at"] <= now or value["freeze_expires_at"] <= now):
        _fail("invalid authorization")
    if any(value[key] != expected_bindings[key] or type(value[key]) is not type(expected_bindings[key]) for key in _BINDINGS):
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

@dataclass(frozen=True, repr=False)
class AuthorizationEnvelope:
    authorization_fd: int
    signature_fd: int
    authorization_size: int
    signature_size: int
    authorization_sha256: str
    signature_sha256: str

@dataclass(frozen=True)
class VerifiedAuthorization:
    schema: str; purpose: str; policy: str; authorization_id: str; attempt_id: str; issued_at: int; expires_at: int
    target_fingerprint: str; target_acl_root: str; g038_source_commit: str; runtime_source_root: str
    source_validation_receipt_sha256: str
    source_root: str; manifest_root: str; vector_root: str; predecessor_commit: str
    predecessor_report_sha256: str; predecessor_outcome_sha256: str; predecessor_readback_sha256: str
    predecessor_rows: int; target_rows: int
    starting_ledger_root: str; starting_catalog_root: str; starting_acl_root: str; starting_data_root: str
    target_ledger_root: str; target_catalog_root: str; target_data_root: str; target_spec_sha256: str
    observation_receipt_sha256: str; backup_receipt_sha256: str; capture_receipt_sha256: str
    dual_clone_receipt_sha256: str; archive_sha256: str; archive_bytes: int; freeze_expires_at: int
    freeze_root: str; inventory_root: str; selected_versions: list[str]; exclusions_root: str
    disposable_runtime_subject_sha256: str; disposable_runtime_proof_contract_sha256: str
    authorization_sha256: str; signature_sha256: str; bindings_sha256: str

@dataclass(frozen=True)
class AttemptStarted:
    schema: str; event: str; authorization_id: str; attempt_id: str; at: int
    target_fingerprint: str; runtime_source_root: str; source_validation_receipt_sha256: str
    predecessor_report_sha256: str
    observation_receipt_sha256: str; disposable_runtime_subject_sha256: str
    authorization_sha256: str; signature_sha256: str; bindings_sha256: str; receipt_sha256: str

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

def _open_custody(path: str | Path, repository_root: str | Path) -> tuple[int, bytes]:
    fd: int | None = None
    try:
        candidate = restrictive_regular_file(path, repository_root=repository_root)
        flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(candidate, flags)
        restrictive_regular_file(candidate, repository_root=repository_root)
        before = os.stat(candidate, follow_symlinks=False); opened = os.fstat(fd)
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

def _write_external_request(output: str | Path, data: bytes, repository_root: str | Path) -> None:
    fd: int | None = None
    try:
        candidate = Path(output)
        _parent_restrictive(candidate)
        root = Path(repository_root).resolve(strict=True)
        resolved_parent = candidate.parent.resolve(strict=True)
        if resolved_parent == root or root in resolved_parent.parents: _fail("custody failure")
        fd = os.open(candidate, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0), 0o600)
        if os.name != "nt": os.fchmod(fd, 0o600)
        _write_all(fd, data); os.fsync(fd)
        if os.name == "nt" and not _windows_restrictive(candidate): _fail("custody failure")
    except AuthorizationError:
        raise
    except Exception:
        _fail("request write failure")
    finally:
        if fd is not None:
            try: os.close(fd)
            except Exception: pass

def build_authorization_request(*, authorization_id: str, attempt_id: str, expected_bindings: Mapping[str, Any], output: str | Path, repository_root: str | Path, now_unix: int | None = None, valid_seconds: int = 600) -> Mapping[str, Any]:
    now = int(time.time()) if now_unix is None else now_unix
    if type(expected_bindings) is not dict or set(expected_bindings) != _BINDINGS or type(valid_seconds) is not int or not 1 <= valid_seconds <= 900:
        _fail("invalid authorization")
    value = dict(schema=SCHEMA, purpose=PURPOSE, policy=POLICY, authorization_id=authorization_id, attempt_id=attempt_id, issued_at=now, expires_at=now + valid_seconds, **expected_bindings)
    freeze_expires_at = value.get("freeze_expires_at")
    if type(freeze_expires_at) is not int:
        _fail("invalid authorization")
    value["expires_at"] = min(value["expires_at"], freeze_expires_at)
    _validate(value, dict(expected_bindings), now, require_fresh=False)
    data = canonical_json_bytes(value)
    _write_external_request(output, data, repository_root)
    return {"schema": SCHEMA, "authorization_sha256": hashlib.sha256(data).hexdigest(), "bindings_sha256": canonical_sha256(expected_bindings), "expires_at": value["expires_at"]}

def _authenticate_path_only(authorization: str | Path, signature: str | Path, *, repository_root: str | Path) -> tuple[AuthorizationEnvelope, dict[str, Any]]:
    auth_fd: int | None = None; sig_fd: int | None = None
    try:
        if not isinstance(authorization, (str, Path)) or not isinstance(signature, (str, Path)):
            _fail("invalid authorization")
        auth_fd, raw = _open_custody(authorization, repository_root)
        sig_fd, sig = _open_custody(signature, repository_root)
        value = _decode(raw); _verify(raw, sig)
        envelope = AuthorizationEnvelope(auth_fd, sig_fd, len(raw), len(sig), hashlib.sha256(raw).hexdigest(), hashlib.sha256(sig).hexdigest())
        return envelope, value
    except AuthorizationError:
        for fd in (auth_fd, sig_fd):
            if fd is not None: os.close(fd)
        raise
    except Exception:
        for fd in (auth_fd, sig_fd):
            if fd is not None:
                try: os.close(fd)
                except Exception: pass
    raise AuthorizationError("invalid authorization")

def authenticate_successor_authorization(authorization: str | Path, signature: str | Path, *, expected_bindings: dict[str, Any], repository_root: str | Path, now: int | None = None, require_fresh: bool = True) -> AuthorizationEnvelope:
    if type(expected_bindings) is not dict:
        _fail("invalid authorization")
    envelope, value = _authenticate_path_only(authorization, signature, repository_root=repository_root)
    try:
        _validate(value, expected_bindings, int(time.time()) if now is None else now, require_fresh=require_fresh)
        return envelope
    except Exception:
        for field in ("authorization_fd", "signature_fd"):
            fd = getattr(envelope, field)
            if type(fd) is int and fd >= 0: os.close(fd)
            object.__setattr__(envelope, field, -1)
        raise

def authenticate_outcome_authorization(authorization: str | Path, signature: str | Path, *, repository_root: str | Path, now: int | None = None) -> AuthorizationEnvelope:
    """Admit historical outcome evidence from held descriptors without caller bindings."""
    envelope, value = _authenticate_path_only(authorization, signature, repository_root=repository_root)
    try:
        immutable = {key: value[key] for key in _BINDINGS} if type(value) is dict and set(value) == _FIELDS else None
        _validate(value, immutable, int(time.time()) if now is None else now, require_fresh=False)
        return envelope
    except Exception:
        for field in ("authorization_fd", "signature_fd"):
            fd = getattr(envelope, field)
            if type(fd) is int and fd >= 0: os.close(fd)
            object.__setattr__(envelope, field, -1)
        raise



def _reread(envelope: AuthorizationEnvelope) -> tuple[bytes, bytes]:
    try:
        def current(fd: int, size: int, digest: str) -> bytes:
            if type(fd) is not int or fd < 0 or os.fstat(fd).st_size != size: _fail("source verification failed")
            if hasattr(os, "pread"):
                raw = os.pread(fd, size + 1, 0)
            else:
                os.lseek(fd, 0, os.SEEK_SET)
                raw = os.read(fd, size + 1)
            if len(raw) != size or hashlib.sha256(raw).hexdigest() != digest: _fail("source verification failed")
            return raw
        result = current(envelope.authorization_fd, envelope.authorization_size, envelope.authorization_sha256), current(envelope.signature_fd, envelope.signature_size, envelope.signature_sha256)
    except AuthorizationError:
        raise
    except Exception:
        result = None
    if result is None:
        raise AuthorizationError("source verification failed")
    return result

def reverify_destructive_stage(envelope: AuthorizationEnvelope, *, expected_bindings: dict[str, Any], now: int | None = None) -> VerifiedAuthorization:
    if type(envelope) is not AuthorizationEnvelope:
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
def _validate_held_journal_directory(fd: int, path: Path) -> None:
    try:
        held = os.fstat(fd)
        current = path.stat(follow_symlinks=False)
        if (
            not stat.S_ISDIR(held.st_mode)
            or not stat.S_ISDIR(current.st_mode)
            or held.st_dev != current.st_dev
            or held.st_ino != current.st_ino
            or held.st_mode & 0o077
            or current.st_mode & 0o077
        ):
            _fail("journal custody failure")
    except AuthorizationError:
        raise
    except Exception:
        _fail("journal custody failure")


def _open_journal_directory(repository_root: str | Path) -> tuple[Path, int]:
    if os.name == "nt":
        # Python does not expose a Windows create-relative-to-directory operation.
        # Path-based creation would lose custody if the directory were replaced.
        _fail("journal custody failure")
    parent = canonical_journal_parent(repository_root)
    no_follow = getattr(os, "O_NOFOLLOW", None)
    directory = getattr(os, "O_DIRECTORY", None)
    if no_follow is None or directory is None:
        _fail("journal custody failure")
    fd: int | None = None
    try:
        fd = os.open(parent, os.O_RDONLY | directory | no_follow)
        _validate_held_journal_directory(fd, parent)
        return parent, fd
    except AuthorizationError:
        if fd is not None:
            try:
                os.close(fd)
            except Exception:
                pass
        raise
    except Exception:
        if fd is not None:
            try:
                os.close(fd)
            except Exception:
                pass
        _fail("journal custody failure")


def _write_journal_marker(directory_fd: int, name: str, data: bytes) -> None:
    no_follow = getattr(os, "O_NOFOLLOW", None)
    if no_follow is None:
        _fail("journal write failure")
    fd: int | None = None
    try:
        fd = os.open(
            name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | no_follow | getattr(os, "O_BINARY", 0),
            0o600,
            dir_fd=directory_fd,
        )
    except Exception:
        _fail("attempt already consumed or journal unavailable")
    try:
        os.fchmod(fd, 0o600)
        opened = os.fstat(fd)
        named = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        if (
            not stat.S_ISREG(opened.st_mode)
            or not stat.S_ISREG(named.st_mode)
            or opened.st_nlink != 1
            or named.st_nlink != 1
            or stat.S_IMODE(opened.st_mode) != 0o600
            or stat.S_IMODE(named.st_mode) != 0o600
            or opened.st_dev != named.st_dev
            or opened.st_ino != named.st_ino
        ):
            _fail("journal write failure")
        _write_all(fd, data)
        os.fsync(fd)
        opened = os.fstat(fd)
        named = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        if (
            not stat.S_ISREG(opened.st_mode)
            or not stat.S_ISREG(named.st_mode)
            or opened.st_nlink != 1
            or named.st_nlink != 1
            or stat.S_IMODE(opened.st_mode) != 0o600
            or stat.S_IMODE(named.st_mode) != 0o600
            or opened.st_dev != named.st_dev
            or opened.st_ino != named.st_ino
        ):
            _fail("journal write failure")
    except AuthorizationError:
        raise
    except Exception:
        _fail("journal write failure")
    finally:
        if fd is not None:
            try:
                os.close(fd)
            except Exception:
                pass
    try:
        os.fsync(directory_fd)
    except Exception:
        _fail("journal write failure")


def _write_all(fd: int, data: bytes) -> None:
    offset = 0
    while offset < len(data):
        written = os.write(fd, data[offset:])
        if type(written) is not int or written <= 0:
            _fail("journal write failure")
        offset += written

def canonical_journal_parent(repository_root: str | Path) -> Path:
    try:
        return _journal_parent(CANONICAL_JOURNAL_DIRECTORY, Path(repository_root))
    except AuthorizationError:
        raise
    except Exception:
        _fail("journal custody failure")

def consume_one_shot_attempt(*, repository_root: str | Path, authorization: VerifiedAuthorization, callback: Callable[[AttemptStarted], Any], now: int | None = None) -> tuple[AttemptStarted, Any]:
    if type(authorization) is not VerifiedAuthorization or not callable(callback): _fail("invalid authorization")
    parent, directory_fd = _open_journal_directory(repository_root)
    try:
        body = {"schema": JOURNAL_SCHEMA, "event": "attempt-started", "authorization_id": authorization.authorization_id, "attempt_id": authorization.attempt_id, "at": int(time.time()) if now is None else now, "target_fingerprint": authorization.target_fingerprint, "runtime_source_root": authorization.runtime_source_root, "source_validation_receipt_sha256": authorization.source_validation_receipt_sha256, "predecessor_report_sha256": authorization.predecessor_report_sha256, "observation_receipt_sha256": authorization.observation_receipt_sha256, "disposable_runtime_subject_sha256": authorization.disposable_runtime_subject_sha256, "authorization_sha256": authorization.authorization_sha256, "signature_sha256": authorization.signature_sha256, "bindings_sha256": authorization.bindings_sha256}
        body["receipt_sha256"] = canonical_sha256(body)
        attempt = AttemptStarted(**body); data = canonical_json_bytes(body)
        markers = (
            f"authorization-{authorization.authorization_id}.json",
            f"attempt-{authorization.attempt_id}.json",
        )
        for marker in markers:
            _validate_held_journal_directory(directory_fd, parent)
            _write_journal_marker(directory_fd, marker, data)
            _validate_held_journal_directory(directory_fd, parent)
        _validate_held_journal_directory(directory_fd, parent)
        result = callback(attempt)
        return attempt, result
    finally:
        try:
            os.close(directory_fd)
        except Exception:
            pass
def _bindings_from_path(path: str | Path, repository_root: str | Path) -> dict[str, Any]:
    fd: int | None = None
    try:
        fd, raw = _open_custody(path, repository_root)
        value = _decode(raw)
        if type(value) is not dict or set(value) != _BINDINGS:
            _fail("invalid authorization")
        return value
    finally:
        if fd is not None:
            try: os.close(fd)
            except Exception: pass

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Build or verify G038 successor authorization.")
    commands = parser.add_subparsers(dest="command", required=True)
    request = commands.add_parser("build-request")
    request.add_argument("--repository-root", required=True)
    request.add_argument("--bindings", required=True)
    request.add_argument("--authorization-id", required=True)
    request.add_argument("--attempt-id", required=True)
    request.add_argument("--valid-seconds", type=int, default=600)
    request.add_argument("--output", required=True)
    verify = commands.add_parser("verify")
    verify.add_argument("--repository-root", required=True)
    verify.add_argument("--bindings", required=True)
    verify.add_argument("--authorization", required=True)
    verify.add_argument("--signature", required=True)
    return parser

def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    bindings = _bindings_from_path(args.bindings, args.repository_root)
    if args.command == "build-request":
        result = build_authorization_request(
            authorization_id=args.authorization_id, attempt_id=args.attempt_id, expected_bindings=bindings,
            output=args.output, repository_root=args.repository_root, valid_seconds=args.valid_seconds)
    else:
        envelope = authenticate_successor_authorization(
            args.authorization, args.signature, expected_bindings=bindings, repository_root=args.repository_root)
        verified = reverify_destructive_stage(envelope, expected_bindings=bindings)
        result = {"schema": verified.schema, "authorization_sha256": verified.authorization_sha256,
                  "signature_sha256": verified.signature_sha256, "bindings_sha256": verified.bindings_sha256,
                  "expires_at": verified.expires_at}
    print(canonical_json_bytes(result).decode("ascii"))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
