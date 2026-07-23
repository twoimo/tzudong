#!/usr/bin/env python3
"""Exact, signed G038 producer-stop continuity contract.

This module only validates operator evidence.  It has no API that can start a
producer, mutate hosted configuration, or toggle a GitHub variable.
"""
from __future__ import annotations

import base64
import hashlib
import re
import time
from dataclasses import dataclass
from typing import Any, Mapping
import json
import os
import secrets
import socket
import tempfile
import stat
from pathlib import Path

from g038_successor_contract import PREDECESSOR_REPORT_SHA256, TARGET_FINGERPRINT, canonical_json_bytes
PUBLIC_KEY_PEM = """-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAqwaMT8P8I7zv2DXNNooiGbj2zfrK+9OlIJg5obwm8jg=
-----END PUBLIC KEY-----
"""
PUBLIC_KEY_SHA256 = "562357382214576ef4647037618a0b7069e234373521651e239cde862596c873"

SCHEMA = "g038-write-freeze-v1"
MONITOR_REQUEST_SCHEMA = "g038-freeze-monitor-request-v1"
MONITOR_RESPONSE_SCHEMA = "g038-freeze-monitor-response-v1"
CHECKPOINTS = frozenset((
    "precommit", "postcommit-terminal-readback", "historical-terminal-readback",
))
_REQUEST_FIELDS = frozenset((
    "schema", "challenge", "checkpoint", "continuity_epoch", "requested_at", "deadline",
    "source_commit", "runtime_source_root", "target_fingerprint", "freeze_root",
    "authorization_sha256", "attempt_receipt_sha256", "prepared_receipt_sha256",
    "executor_evidence_sha256", "state_sha256", "parent_evidence_sha256",
    "request_sha256",
))
_RESPONSE_FIELDS = frozenset((*_REQUEST_FIELDS, "observed_at",
    "expires_at", "residual_channels", "no_active_writers",
    "all_residual_channels_stopped", "freeze_continuity_maintained",
    "worker_state_sha256", "signature_b64"))
_MAX_MONITOR_MESSAGE = 65536
SCOPED_OPERATIONS = (
    "migration_40_to_42",
    "disposable_account_runtime_proof",
    "zero_eligible_retention_proof",
)
RESIDUAL_CHANNELS = (
    "no_owner_write",
    "no_dashboard_write",
    "no_provider_write",
    "no_out_of_band_write",
    "producer_stop",
)
_FIELDS = frozenset((
    "schema", "freeze_id", "source_commit", "runtime_source_root", "manifest_root",
    "predecessor_report_sha256", "target_fingerprint", "starting_roots",
    "relation_root", "acl_root", "inventory_root", "issued_at", "expires_at",
    "residual_channels", "scoped_operations", "github_variable_toggled", "signature_b64",
))
_ROOT_KEYS = frozenset(("ledger", "catalog", "acl", "data", "spec"))
_HEX = re.compile(r"^[0-9a-f]{64}$")
_COMMIT = re.compile(r"^[0-9a-f]{40}$")
_FREEZE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{7,127}$")


class FreezeError(ValueError):
    """Sanitized freeze-custody failure."""


@dataclass(frozen=True)
class VerifiedFreeze:
    freeze_id: str
    source_commit: str
    runtime_source_root: str
    manifest_root: str
    predecessor_report_sha256: str
    target_fingerprint: str
    starting_roots: Mapping[str, str]
    relation_root: str
    acl_root: str
    inventory_root: str
    issued_at: int
    expires_at: int
    root: str


def _fail(code: str) -> None:
    raise FreezeError(code) from None


def _hex(value: Any) -> bool:
    return type(value) is str and bool(_HEX.fullmatch(value))


def _validate_payload(value: Any, *, source_commit: str, runtime_source_root: str,
                      manifest_root: str, starting_roots: Mapping[str, str], now: int) -> None:
    if type(value) is not dict or set(value) != _FIELDS:
        _fail("freeze_fields")
    if (value["schema"] != SCHEMA or type(value["freeze_id"]) is not str
            or not _FREEZE_ID.fullmatch(value["freeze_id"])
            or type(source_commit) is not str or not _COMMIT.fullmatch(source_commit)
            or value["source_commit"] != source_commit
            or value["runtime_source_root"] != runtime_source_root
            or value["manifest_root"] != manifest_root
            or value["predecessor_report_sha256"] != PREDECESSOR_REPORT_SHA256
            or value["target_fingerprint"] != TARGET_FINGERPRINT):
        _fail("freeze_binding")
    if (type(starting_roots) is not dict or set(starting_roots) != _ROOT_KEYS
            or type(value["starting_roots"]) is not dict or value["starting_roots"] != starting_roots
            or any(not _hex(item) for item in starting_roots.values())
            or any(not _hex(value[key]) for key in ("runtime_source_root", "manifest_root", "relation_root", "acl_root", "inventory_root"))):
        _fail("freeze_roots")
    issued, expires = value["issued_at"], value["expires_at"]
    if (type(issued) is not int or type(expires) is not int or issued > now + 30
            or issued < now - 900 or expires <= now or expires <= issued or expires - issued > 900):
        _fail("freeze_stale")
    if (type(value["scoped_operations"]) is not list
            or tuple(value["scoped_operations"]) != SCOPED_OPERATIONS
            or value["github_variable_toggled"] is not False):
        _fail("freeze_scope")
    channels = value["residual_channels"]
    if type(channels) is not dict or tuple(sorted(channels)) != tuple(sorted(RESIDUAL_CHANNELS)):
        _fail("freeze_channels")
    for name in RESIDUAL_CHANNELS:
        evidence = channels[name]
        if (type(evidence) is not dict or set(evidence) != {"status", "active_writers", "evidence_sha256", "observed_at"}
                or evidence["status"] != "stopped" or evidence["active_writers"] != 0
                or type(evidence["active_writers"]) is not int or not _hex(evidence["evidence_sha256"])
                or type(evidence["observed_at"]) is not int or evidence["observed_at"] > now + 30
                or evidence["observed_at"] < now - 900 or evidence["observed_at"] > issued):
            _fail("freeze_channels")
    if type(value["signature_b64"]) is not str:
        _fail("freeze_signature")


def verify_freeze_assertion(value: Any, *, source_commit: str, runtime_source_root: str,
                            manifest_root: str, starting_roots: Mapping[str, str],
                            now: int | None = None) -> VerifiedFreeze:
    """Verify exact source, roots, scope, producer stops, freshness, and signature."""
    point = int(time.time()) if now is None else now
    _validate_payload(value, source_commit=source_commit, runtime_source_root=runtime_source_root,
                      manifest_root=manifest_root, starting_roots=starting_roots, now=point)
    unsigned = {key: item for key, item in value.items() if key != "signature_b64"}
    try:
        if hashlib.sha256(PUBLIC_KEY_PEM.encode("ascii")).hexdigest() != PUBLIC_KEY_SHA256:
            _fail("freeze_signature")
        from cryptography.hazmat.primitives.serialization import load_pem_public_key
        load_pem_public_key(PUBLIC_KEY_PEM.encode("ascii")).verify(
            base64.b64decode(value["signature_b64"], validate=True), canonical_json_bytes(unsigned))
    except FreezeError:
        raise
    except Exception:
        _fail("freeze_signature")
    return VerifiedFreeze(
        freeze_id=value["freeze_id"], source_commit=value["source_commit"],
        runtime_source_root=value["runtime_source_root"], manifest_root=value["manifest_root"],
        predecessor_report_sha256=value["predecessor_report_sha256"],
        target_fingerprint=value["target_fingerprint"], starting_roots=dict(value["starting_roots"]),
        relation_root=value["relation_root"], acl_root=value["acl_root"],
        inventory_root=value["inventory_root"], issued_at=value["issued_at"],
        expires_at=value["expires_at"], root=hashlib.sha256(canonical_json_bytes(value)).hexdigest(),
    )

@dataclass(frozen=True)
class VerifiedCheckpoint:
    checkpoint: str
    continuity_epoch: int
    freeze_root: str
    parent_evidence_sha256: str
    executor_evidence_sha256: str
    state_sha256: str
    receipt_sha256: str
    body: Mapping[str, Any]


def _socket_path(path: Path, repository_root: Path) -> Path:
    try:
        root = repository_root.resolve(strict=True)
        candidate = path.expanduser()
        parent = candidate.parent.resolve(strict=True)
        resolved = parent / candidate.name
        if root == resolved or root in resolved.parents or stat.S_ISLNK(os.lstat(resolved).st_mode):
            _fail("monitor_custody")
        socket_stat = os.lstat(resolved)
        parent_stat = os.stat(parent, follow_symlinks=False)
        if (not stat.S_ISSOCK(socket_stat.st_mode) or socket_stat.st_uid != os.getuid()
                or socket_stat.st_mode & 0o077 or parent_stat.st_uid != os.getuid()
                or parent_stat.st_mode & 0o077):
            _fail("monitor_custody")
        return resolved
    except FreezeError:
        raise
    except Exception:
        _fail("monitor_custody")


def _checkpoint_path(path: Path, repository_root: Path) -> Path:
    try:
        root = repository_root.resolve(strict=True)
        candidate = path.expanduser()
        parent = candidate.parent.resolve(strict=True)
        resolved = parent / candidate.name
        parent_stat = os.stat(parent, follow_symlinks=False)
        if (root == resolved or root in resolved.parents or parent_stat.st_uid != os.getuid()
                or parent_stat.st_mode & 0o077 or resolved.exists() or resolved.is_symlink()):
            _fail("checkpoint_custody")
        return resolved
    except FreezeError:
        raise
    except Exception:
        _fail("checkpoint_custody")


def preflight_checkpoint_path(path: Path, *, repository_root: Path) -> Path:
    """Validate create-once checkpoint custody without creating the receipt."""
    return _checkpoint_path(path, repository_root)


def _validate_request(request: Any) -> None:
    if (type(request) is not dict or set(request) != _REQUEST_FIELDS
            or request["schema"] != MONITOR_REQUEST_SCHEMA
            or request["checkpoint"] not in CHECKPOINTS
            or not _hex(request["challenge"])
            or type(request["requested_at"]) is not int or type(request["deadline"]) is not int
            or type(request["continuity_epoch"]) is not int or request["continuity_epoch"] <= 0
            or request["deadline"] <= request["requested_at"]
            or request["deadline"] - request["requested_at"] > 30
            or type(request["source_commit"]) is not str or not _COMMIT.fullmatch(request["source_commit"])
            or request["target_fingerprint"] != TARGET_FINGERPRINT
            or any(not _hex(request[key]) for key in _REQUEST_FIELDS
                   if key.endswith("_sha256") or key.endswith("_root"))):
        _fail("monitor_request")
    unsigned = {key: item for key, item in request.items() if key != "request_sha256"}
    if request["request_sha256"] != hashlib.sha256(canonical_json_bytes(unsigned)).hexdigest():
        _fail("monitor_request")


def _verify_monitor_signature(value: Mapping[str, Any]) -> None:
    unsigned = {key: item for key, item in value.items() if key != "signature_b64"}
    try:
        if hashlib.sha256(PUBLIC_KEY_PEM.encode("ascii")).hexdigest() != PUBLIC_KEY_SHA256:
            _fail("monitor_signature")
        from cryptography.hazmat.primitives.serialization import load_pem_public_key
        load_pem_public_key(PUBLIC_KEY_PEM.encode("ascii")).verify(
            base64.b64decode(value["signature_b64"], validate=True), canonical_json_bytes(unsigned))
    except FreezeError:
        raise
    except Exception:
        _fail("monitor_signature")


def _verify_checkpoint_response(value: Any, request: Mapping[str, Any] | None, *,
                                now: int, require_fresh: bool) -> Mapping[str, Any]:
    if type(value) is not dict or set(value) != _RESPONSE_FIELDS or value.get("schema") != MONITOR_RESPONSE_SCHEMA:
        _fail("monitor_response")
    request_shape = {key: value[key] for key in _REQUEST_FIELDS}
    request_shape["schema"] = MONITOR_REQUEST_SCHEMA
    _validate_request(request_shape)
    if request is not None and any(value.get(key) != item for key, item in request.items() if key != "schema"):
        _fail("monitor_challenge")
    if (value.get("checkpoint") not in CHECKPOINTS or not _hex(value.get("challenge"))
            or type(value.get("continuity_epoch")) is not int or value["continuity_epoch"] <= 0
            or type(value.get("observed_at")) is not int or type(value.get("expires_at")) is not int
            or value["observed_at"] < value["requested_at"]
            or value["observed_at"] > value["deadline"] or value["expires_at"] > value["deadline"]
            or value["expires_at"] <= value["observed_at"] or value["expires_at"] - value["observed_at"] > 30
            or (require_fresh and (value["observed_at"] < now - 5 or value["observed_at"] > now
                                   or value["expires_at"] <= now))
            or any(value.get(key) is not True for key in (
                "no_active_writers", "all_residual_channels_stopped", "freeze_continuity_maintained"))
            or not _hex(value.get("worker_state_sha256"))):
        _fail("monitor_stale")
    channels = value.get("residual_channels")
    if type(channels) is not dict or set(channels) != set(RESIDUAL_CHANNELS):
        _fail("monitor_channels")
    for item in channels.values():
        if (type(item) is not dict
                or set(item) != {"status", "active_writers", "evidence_sha256", "observed_at"}
                or item["status"] != "stopped" or type(item["active_writers"]) is not int
                or item["active_writers"] != 0 or not _hex(item["evidence_sha256"])
                or type(item["observed_at"]) is not int
                or item["observed_at"] < value["requested_at"] or item["observed_at"] > value["observed_at"]):
            _fail("monitor_channels")
    if value["worker_state_sha256"] != hashlib.sha256(canonical_json_bytes(channels)).hexdigest():
        _fail("monitor_channels")
    _verify_monitor_signature(value)
    return value


def request_checkpoint(*, socket_path: Path, receipt_path: Path, repository_root: Path,
                       checkpoint: str, source_commit: str, runtime_source_root: str,
                       freeze_root: str, authorization_sha256: str,
                       attempt_receipt_sha256: str, prepared_receipt_sha256: str,
                       executor_evidence_sha256: str, state_sha256: str,
                       parent_evidence_sha256: str, continuity_epoch: int,
                       now: int | None = None) -> VerifiedCheckpoint:
    """Obtain and create-once persist a fresh, signed, read-only monitor checkpoint."""
    point = int(time.time()) if now is None else now
    destination = _checkpoint_path(receipt_path, repository_root)
    endpoint = _socket_path(socket_path, repository_root)
    request = {
        "schema": MONITOR_REQUEST_SCHEMA, "challenge": secrets.token_hex(32),
        "checkpoint": checkpoint, "continuity_epoch": continuity_epoch,
        "requested_at": point, "deadline": point + 30,
        "source_commit": source_commit, "runtime_source_root": runtime_source_root,
        "target_fingerprint": TARGET_FINGERPRINT, "freeze_root": freeze_root,
        "authorization_sha256": authorization_sha256,
        "attempt_receipt_sha256": attempt_receipt_sha256,
        "prepared_receipt_sha256": prepared_receipt_sha256,
        "executor_evidence_sha256": executor_evidence_sha256, "state_sha256": state_sha256,
        "parent_evidence_sha256": parent_evidence_sha256,
    }
    request["request_sha256"] = hashlib.sha256(canonical_json_bytes(request)).hexdigest()
    socket_info = os.lstat(endpoint)
    _validate_request(request)
    raw_request = canonical_json_bytes(request) + b"\n"
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        client.settimeout(5)
        client.connect(str(endpoint))
        connected_info = os.lstat(endpoint)
        if (connected_info.st_dev, connected_info.st_ino) != (socket_info.st_dev, socket_info.st_ino):
            _fail("monitor_custody")
        client.sendall(raw_request)
        received = bytearray()
        while b"\n" not in received:
            chunk = client.recv(min(4096, _MAX_MONITOR_MESSAGE + 1 - len(received)))
            if not chunk:
                _fail("monitor_response")
            received.extend(chunk)
            if len(received) > _MAX_MONITOR_MESSAGE:
                _fail("monitor_response")
        line, remainder = bytes(received).split(b"\n", 1)
        if remainder:
            _fail("monitor_response")
    except FreezeError:
        raise
    except Exception:
        _fail("monitor_unavailable")
    finally:
        client.close()
    try:
        value = json.loads(line.decode("utf-8"))
        if canonical_json_bytes(value) != line:
            _fail("monitor_response")
    except FreezeError:
        raise
    except Exception:
        _fail("monitor_response")
    verified = _verify_checkpoint_response(
        value, request, now=(point if now is not None else int(time.time())), require_fresh=True)
    raw = line + b"\n"
    temporary: Path | None = None
    try:
        fd, name = tempfile.mkstemp(prefix=f".{destination.name}.", dir=destination.parent)
        temporary = Path(name)
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, destination, follow_symlinks=False)
        directory_fd = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except Exception:
        _fail("checkpoint_custody")
    finally:
        if temporary is not None:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass
    digest = hashlib.sha256(raw).hexdigest()
    return VerifiedCheckpoint(checkpoint, verified["continuity_epoch"], freeze_root,
                              parent_evidence_sha256, executor_evidence_sha256,
                              state_sha256, digest, dict(verified))


def load_checkpoint(path: Path, *, repository_root: Path,
                    allowed_checkpoints: frozenset[str]) -> VerifiedCheckpoint:
    """Verify a retained signed checkpoint as a historical continuity parent."""
    try:
        root = repository_root.resolve(strict=True)
        candidate = path.expanduser()
        resolved = candidate.parent.resolve(strict=True) / candidate.name
        info = os.lstat(resolved)
        if stat.S_ISLNK(info.st_mode):
            _fail("checkpoint_custody")
        parent_info = os.stat(resolved.parent, follow_symlinks=False)
        if (root == resolved or root in resolved.parents or not stat.S_ISREG(info.st_mode)
                or info.st_uid != os.getuid() or info.st_mode & 0o077
                or parent_info.st_uid != os.getuid() or parent_info.st_mode & 0o077):
            _fail("checkpoint_custody")
        raw = resolved.read_bytes()
        if not raw.endswith(b"\n") or raw.count(b"\n") != 1:
            _fail("monitor_response")
        value = json.loads(raw.decode("utf-8"))
        if canonical_json_bytes(value) + b"\n" != raw:
            _fail("monitor_response")
    except FreezeError:
        raise
    except Exception:
        _fail("checkpoint_custody")
    verified = _verify_checkpoint_response(value, None, now=int(time.time()), require_fresh=False)
    if verified["checkpoint"] not in allowed_checkpoints:
        _fail("monitor_parent")
    digest = hashlib.sha256(raw).hexdigest()
    return VerifiedCheckpoint(verified["checkpoint"], verified["continuity_epoch"],
                              verified["freeze_root"], verified["parent_evidence_sha256"],
                              verified["executor_evidence_sha256"],
                              verified["state_sha256"], digest, dict(verified))

__all__ = [
    "CHECKPOINTS", "FreezeError", "MONITOR_REQUEST_SCHEMA", "MONITOR_RESPONSE_SCHEMA",
    "RESIDUAL_CHANNELS", "SCHEMA", "SCOPED_OPERATIONS", "VerifiedCheckpoint",
    "VerifiedFreeze", "load_checkpoint", "preflight_checkpoint_path", "request_checkpoint",
    "verify_freeze_assertion",
]
