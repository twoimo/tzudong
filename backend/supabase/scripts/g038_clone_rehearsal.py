#!/usr/bin/env python3
"""Source-bound, local-only dual-clone rehearsal for the G038 40-to-42 plan.

This module deliberately has no Docker, libpq, G035, or G040 imports.  A
source-inventoried controller supplies already verified immutable restore and
live-custody projections, owns every transaction, and gives the executor only
its cursor.  Consequently this file cannot acquire hosted or production
connection authority.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Callable, Mapping

from g038_successor_contract import SELECTED_VERSIONS, canonical_json_bytes
PUBLIC_KEY_PEM = """-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA4ppm7yBWop11OYryCnV+TnmsjnzDTVkDfDTvfRJVbZM=
-----END PUBLIC KEY-----
"""
PUBLIC_KEY_SHA256 = "5ceabd8a91a352125eb3ec9bbfa6c20854c4100a4efbe8df6f471dade133c022"

SCHEMA = "g038-dual-clone-rehearsal-v1"
KIND = "fresh-backup-lineage-bound-40-to-42"
IMAGE = "supabase/postgres:17.6.1.147"
IMAGE_DIGEST = "supabase/postgres@sha256:ac581882596ed0e46937ea6dd53a627d09f53e005d7264c2082a7ff7b62eaaca"
IMAGE_ID = "sha256:ac581882596ed0e46937ea6dd53a627d09f53e005d7264c2082a7ff7b62eaaca"
MAX_RECEIPT_BYTES = 1_048_576
MAX_ARCHIVE_BYTES = 1 << 40
MAX_FREEZE_SECONDS = 900
_HEX = re.compile(r"^[0-9a-f]{64}$")
_COMMIT = re.compile(r"^[0-9a-f]{40}$")
_SAFE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{15,127}$")


class CloneRehearsalError(RuntimeError):
    """A sanitized, fail-closed clone rehearsal error."""


@dataclass(frozen=True)
class CloneHandle:
    """Opaque controller handle plus its immutable, verified custody proof."""

    subject: Any
    clone_nonce: str
    system_identifier: str
    database_oid: str
    service_file_sha256: str
    endpoint_sha256: str
    container_id_sha256: str
    image_id_sha256: str
    image_digest_sha256: str
    container_custody_sha256: str
    network_custody_sha256: str
    restore_receipt_sha256: str


_STATE_SEAL = object()


@dataclass(frozen=True, init=False)
class State:
    classification: str
    rows: int
    ledger_root: str
    catalog_root: str
    acl_root: str
    data_root: str
    _seal: object

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        _fail("state_contract")


@dataclass(frozen=True)
class Applied:
    """State observed by the controller before its commit or rollback."""

    state: State
    execution_evidence_sha256: str


_RESULT_SEAL = object()


@dataclass(frozen=True, init=False)
class SealedRehearsal:
    """Unsigned, canonical rehearsal evidence produced only after cleanup."""

    body: Mapping[str, Any]
    unsigned: bytes
    _seal: object

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        _fail("rehearsal_contract")


def _sealed_rehearsal(body: dict[str, Any]) -> SealedRehearsal:
    value = object.__new__(SealedRehearsal)
    object.__setattr__(value, "body", MappingProxyType(body))
    object.__setattr__(value, "unsigned", canonical_json_bytes(
        {"schema": SCHEMA, "kind": KIND, "body": body}
    ))
    object.__setattr__(value, "_seal", _RESULT_SEAL)
    return value


def _fail(code: str) -> None:
    raise CloneRehearsalError(code) from None


def _new_state(
    classification: str, rows: int, ledger_root: str, catalog_root: str,
    acl_root: str, data_root: str,
) -> State:
    value = object.__new__(State)
    for name, item in (
        ("classification", classification), ("rows", rows), ("ledger_root", ledger_root),
        ("catalog_root", catalog_root), ("acl_root", acl_root), ("data_root", data_root),
        ("_seal", _STATE_SEAL),
    ):
        object.__setattr__(value, name, item)
    return value


def _sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _hex(value: Any) -> bool:
    return type(value) is str and bool(_HEX.fullmatch(value))


def _canonical(value: Any) -> bytes:
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode("ascii")
    except Exception:
        _fail("canonical_json")


def _pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in items:
        if type(key) is not str or key in result:
            _fail("receipt_invalid")
        result[key] = value
    return result


def _state(value: Any, *, classification: str, rows: int, roots: Mapping[str, Any]) -> State:
    if type(value) is not State or getattr(value, "_seal", None) is not _STATE_SEAL:
        _fail("state_contract")
    if (value.classification != classification or value.rows != rows
            or any(getattr(value, f"{name}_root") != roots[name] for name in ("ledger", "catalog", "acl", "data"))):
        _fail("state_mismatch")
    if any(not _hex(getattr(value, f"{name}_root")) for name in ("ledger", "catalog", "acl", "data")):
        _fail("state_contract")
    return value


def _observed_state(value: Any, *, classification: str, rows: int) -> State:
    if (type(value) is not State or getattr(value, "_seal", None) is not _STATE_SEAL
            or value.classification != classification or value.rows != rows):
        _fail("state_mismatch")
    if any(not _hex(getattr(value, f"{name}_root")) for name in ("ledger", "catalog", "acl", "data")):
        _fail("state_contract")
    return value


def _state_body(value: State) -> dict[str, Any]:
    return {
        "classification": value.classification,
        "rows": value.rows,
        "ledger_root": value.ledger_root,
        "catalog_root": value.catalog_root,
        "acl_root": value.acl_root,
        "data_root": value.data_root,
        "state_sha256": _sha(_canonical({
            "classification": value.classification, "rows": value.rows,
            "ledger_root": value.ledger_root, "catalog_root": value.catalog_root,
            "acl_root": value.acl_root, "data_root": value.data_root,
        })),
    }


def _validate_bindings(value: Mapping[str, Any], *, now: int) -> dict[str, Any]:
    fields = {
        "source_commit", "runtime_source_root", "source_root", "manifest_root", "vector_root",
        "terminal_spec_root", "exclusions_root", "inventory_root", "target_fingerprint",
        "tool_identity_root", "docker_daemon_root", "predecessor_report_sha256",
        "predecessor_outcome_sha256", "predecessor_readback_sha256",
        "backup_receipt_sha256", "capture_receipt_sha256", "archive_sha256", "archive_bytes",
        "freeze_root", "freeze_expires_at", "starting_ledger_root", "starting_catalog_root",
        "starting_acl_root", "starting_data_root", "selected_versions",
    }
    if type(value) is not dict or set(value) != fields:
        _fail("binding_contract")
    result = dict(value)
    if not _COMMIT.fullmatch(result["source_commit"] if type(result["source_commit"]) is str else ""):
        _fail("binding_contract")
    hash_fields = fields - {"source_commit", "archive_bytes", "freeze_expires_at", "selected_versions"}
    if any(not _hex(result[key]) for key in hash_fields):
        _fail("binding_contract")
    if (type(result["archive_bytes"]) is not int or not 0 < result["archive_bytes"] <= MAX_ARCHIVE_BYTES
            or type(result["freeze_expires_at"]) is not int
            or not now < result["freeze_expires_at"] <= now + MAX_FREEZE_SECONDS
            or type(result["selected_versions"]) is not list
            or tuple(result["selected_versions"]) != SELECTED_VERSIONS):
        _fail("binding_contract")
    return result


def stable_container_custody(inspect: Mapping[str, Any]) -> Mapping[str, Any]:
    """Return the current immutable local-clone projection; health/log state is excluded."""
    config = inspect.get("Config") if type(inspect) is dict else None
    host = inspect.get("HostConfig") if type(inspect) is dict else None
    settings = inspect.get("NetworkSettings") if type(inspect) is dict else None
    return MappingProxyType({
        "Id": inspect.get("Id") if type(inspect) is dict else None,
        "Image": inspect.get("Image") if type(inspect) is dict else None,
        "Config": {key: config.get(key) if type(config) is dict else None for key in (
            "Image", "ExposedPorts", "Labels", "Env", "Entrypoint", "Cmd", "User",
            "WorkingDir", "Volumes", "Healthcheck",
        )},
        "HostConfig": {key: host.get(key) if type(host) is dict else None for key in (
            "NetworkMode", "Privileged", "Binds", "Mounts", "CapAdd", "CapDrop", "PortBindings",
            "SecurityOpt", "ReadonlyRootfs", "AutoRemove", "PublishAllPorts",
        )},
        "Mounts": inspect.get("Mounts") if type(inspect) is dict else None,
        "NetworkSettings": {key: settings.get(key) if type(settings) is dict else None for key in ("Networks", "Ports")},
    })


def stable_network_custody(inspect: Mapping[str, Any]) -> Mapping[str, Any]:
    return MappingProxyType({key: inspect.get(key) if type(inspect) is dict else None for key in (
        "Id", "Internal", "Attachable", "Labels", "Containers",
    )})


def custody_sha256(value: Mapping[str, Any], *, network: bool = False) -> str:
    projection = stable_network_custody(value) if network else stable_container_custody(value)
    return _sha(_canonical(dict(projection)))


def _clone(value: CloneHandle) -> dict[str, Any]:
    if type(value) is not CloneHandle or not _SAFE.fullmatch(value.clone_nonce or ""):
        _fail("clone_contract")
    hashes = (
        value.service_file_sha256, value.endpoint_sha256, value.container_id_sha256,
        value.image_id_sha256, value.image_digest_sha256, value.container_custody_sha256,
        value.network_custody_sha256, value.restore_receipt_sha256,
    )
    if (any(not _hex(item) for item in hashes) or type(value.system_identifier) is not str
            or not value.system_identifier.isdigit() or type(value.database_oid) is not str
            or not (value.database_oid.isdigit()
                    or value.database_oid.count(":") == 1
                    and all(part.isdigit() for part in value.database_oid.split(":")))
            or value.image_id_sha256 != _sha(IMAGE_ID.encode("ascii"))
            or value.image_digest_sha256 != _sha(IMAGE_DIGEST.encode("ascii"))):
        _fail("clone_contract")
    return {
        "clone_nonce_sha256": _sha(value.clone_nonce.encode("ascii")),
        "system_identifier_sha256": _sha(value.system_identifier.encode("ascii")),
        "database_oid_sha256": _sha(value.database_oid.encode("ascii")),
        "service_file_sha256": value.service_file_sha256,
        "endpoint_sha256": value.endpoint_sha256,
        "container_id_sha256": value.container_id_sha256,
        "image_id_sha256": value.image_id_sha256,
        "image_digest_sha256": value.image_digest_sha256,
        "container_custody_sha256": value.container_custody_sha256,
        "network_custody_sha256": value.network_custody_sha256,
        "restore_receipt_sha256": value.restore_receipt_sha256,
    }


def _independent(first: CloneHandle, second: CloneHandle) -> None:
    if first.subject is second.subject:
        _fail("clone_identity")
    for field in ("clone_nonce", "system_identifier", "database_oid", "service_file_sha256", "endpoint_sha256", "container_id_sha256", "container_custody_sha256", "network_custody_sha256", "restore_receipt_sha256"):
        if getattr(first, field) == getattr(second, field):
            _fail("clone_identity")


def _publish(path: str | Path, raw: bytes) -> None:
    target = Path(path)
    temporary: Path | None = None
    try:
        if target.exists() or target.is_symlink():
            _fail("output_exists")
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.parent / f".{target.name}.{os.getpid()}.{time.time_ns()}.tmp"
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, target)
        except FileExistsError:
            _fail("output_exists")
        os.unlink(temporary)
        temporary = None
    except CloneRehearsalError:
        raise
    except Exception:
        _fail("output_write")
    finally:
        if temporary is not None:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass


def _verify_signature(unsigned: bytes, signature: bytes) -> None:
    try:
        public_key_pem = PUBLIC_KEY_PEM.encode("ascii")
        if _sha(public_key_pem) != PUBLIC_KEY_SHA256:
            _fail("receipt_signature")
        from cryptography.hazmat.primitives.serialization import load_pem_public_key
        load_pem_public_key(public_key_pem).verify(signature, unsigned)
    except CloneRehearsalError:
        raise
    except Exception:
        _fail("receipt_signature")


def run_dual_clone_rehearsal(
    *, bindings: Mapping[str, Any], first: CloneHandle, second: CloneHandle,
    read_state: Callable[[Any], State],
    transaction_owner: Callable[[Any, bool, Callable[[Any], Any]], Applied],
    apply_cursor: Callable[[Any], Any], cleanup: Callable[[], None],
    now: int | None = None,
) -> SealedRehearsal:
    """Orchestrate both live clones and return unsigned evidence after cleanup.

    ``transaction_owner`` must open one RW repeatable-read transaction, invoke
    the supplied callback with only its cursor, observe the returned EXACT_42
    state inside that transaction, and then perform the requested commit/rollback.
    """
    current = int(time.time()) if now is None else now
    if (type(current) is not int or not callable(read_state) or not callable(transaction_owner)
            or not callable(apply_cursor) or not callable(cleanup)):
        _fail("rehearsal_contract")
    bound = _validate_bindings(bindings, now=current)
    first_body, second_body = _clone(first), _clone(second)
    _independent(first, second)
    start_roots = {name: bound[f"starting_{name}_root"] for name in ("ledger", "catalog", "acl", "data")}
    def execute(subject: Any, commit: bool) -> Applied:
        calls = 0

        def cursor_only(cursor: Any) -> Any:
            nonlocal calls
            calls += 1
            if calls != 1:
                _fail("transaction_contract")
            return apply_cursor(cursor)

        result = transaction_owner(subject, commit, cursor_only)
        if calls != 1:
            _fail("transaction_contract")
        return result

    before_first = _state(read_state(first.subject), classification="EXACT_40", rows=40, roots=start_roots)
    applied_first = execute(first.subject, False)
    if type(applied_first) is not Applied or not _hex(applied_first.execution_evidence_sha256):
        _fail("transaction_contract")
    inside_first = _observed_state(applied_first.state, classification="EXACT_42", rows=42)
    target_roots = {name: getattr(inside_first, f"{name}_root") for name in ("ledger", "catalog", "acl", "data")}
    for name, value in target_roots.items():
        bound[f"target_{name}_root"] = value
    rolled_back = _state(read_state(first.subject), classification="EXACT_40", rows=40, roots=start_roots)

    before_second = _state(read_state(second.subject), classification="EXACT_40", rows=40, roots=start_roots)
    applied_second = execute(second.subject, True)
    if type(applied_second) is not Applied or not _hex(applied_second.execution_evidence_sha256):
        _fail("transaction_contract")
    inside_second = _state(applied_second.state, classification="EXACT_42", rows=42, roots=target_roots)
    terminal = _state(read_state(second.subject), classification="EXACT_42", rows=42, roots=target_roots)

    first_body.update({
        "before": _state_body(before_first), "inside_after": _state_body(inside_first),
        "rollback_readback": _state_body(rolled_back),
        "execution_evidence_sha256": applied_first.execution_evidence_sha256, "outcome": "ROLLED_BACK_EXACT_40",
    })
    second_body.update({
        "before": _state_body(before_second), "inside_after": _state_body(inside_second),
        "terminal_readback": _state_body(terminal),
        "execution_evidence_sha256": applied_second.execution_evidence_sha256, "outcome": "COMMITTED_EXACT_42",
    })
    equality = {
        "before_roots_equal": _state_body(before_first)["state_sha256"] == _state_body(before_second)["state_sha256"],
        "inside_after_roots_equal": _state_body(inside_first)["state_sha256"] == _state_body(inside_second)["state_sha256"],
        "rollback_equals_original": _state_body(rolled_back)["state_sha256"] == _state_body(before_first)["state_sha256"],
        "terminal_equals_inside_after": _state_body(terminal)["state_sha256"] == _state_body(inside_second)["state_sha256"],
    }
    if set(equality.values()) != {True}:
        _fail("clone_divergence")
    try:
        cleanup()
    except CloneRehearsalError:
        raise
    except Exception:
        _fail("cleanup_survivors")
    body = {
        **bound, "schema": SCHEMA, "kind": KIND, "issued_at": current,
        "postgres_image": IMAGE, "postgres_server_version_num": 170006,
        "first_clone": first_body, "second_clone": second_body,
        "exact_equality": equality,
    }
    body["convergence_sha256"] = _sha(_canonical({
        "starting": start_roots, "target": target_roots,
        "first_after": first_body["inside_after"]["state_sha256"],
        "second_after": second_body["inside_after"]["state_sha256"],
    }))
    return _sealed_rehearsal(body)


def verify_dual_clone_receipt(path: str | Path, *, expected: Mapping[str, Any]) -> Mapping[str, Any]:
    """Re-read, authenticate, and enforce exact binding equality."""
    try:
        raw = Path(path).read_bytes()
        if not 0 < len(raw) <= MAX_RECEIPT_BYTES or not raw.endswith(b"\n"):
            _fail("receipt_invalid")
        value = json.loads(raw[:-1].decode("ascii"), object_pairs_hook=_pairs)
        if (type(value) is not dict or set(value) != {"schema", "kind", "body", "signature_b64"}
                or value["schema"] != SCHEMA or value["kind"] != KIND or type(value["body"]) is not dict
                or raw != canonical_json_bytes(value) + b"\n"):
            _fail("receipt_invalid")
        signature = base64.b64decode(value["signature_b64"], validate=True)
        unsigned = canonical_json_bytes({"schema": SCHEMA, "kind": KIND, "body": value["body"]})
        _verify_signature(unsigned, signature)
        body = value["body"]
        if type(body.get("issued_at")) is not int:
            _fail("receipt_invalid")
        expected_bindings = _validate_bindings(expected, now=body["issued_at"])
        if any(body.get(key) != item for key, item in expected_bindings.items()):
            _fail("receipt_binding")
        if (body.get("schema") != SCHEMA or body.get("kind") != KIND
                or body.get("postgres_image") != IMAGE or body.get("postgres_server_version_num") != 170006
                or body.get("first_clone", {}).get("outcome") != "ROLLED_BACK_EXACT_40"
                or body.get("second_clone", {}).get("outcome") != "COMMITTED_EXACT_42"
                or type(body.get("exact_equality")) is not dict
                or set(body["exact_equality"]) != {
                    "before_roots_equal", "inside_after_roots_equal",
                    "rollback_equals_original", "terminal_equals_inside_after",
                }
                or set(body["exact_equality"].values()) != {True}):
            _fail("receipt_invalid")
        return MappingProxyType({"schema": SCHEMA, "receipt_sha256": _sha(raw), "body": MappingProxyType(body)})
    except CloneRehearsalError:
        raise
    except Exception:
        _fail("receipt_invalid")


__all__ = [
    "Applied", "CloneHandle", "CloneRehearsalError", "IMAGE", "IMAGE_DIGEST",
    "IMAGE_ID", "KIND", "SCHEMA", "SealedRehearsal", "State", "custody_sha256",
    "run_dual_clone_rehearsal", "stable_container_custody",
    "stable_network_custody", "verify_dual_clone_receipt",
]
