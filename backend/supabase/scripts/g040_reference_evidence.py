#!/usr/bin/env python3
"""Offline, source-pinned signed reference evidence for G040."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping

import g037_managed_recovery as _crypto
import g040_prefix_recovery as classifier
from g040_reverse_00400 import DERIVATION_MODE, REVERSE_VECTOR_SHA256
from g040_recovery_source import SourceBinding

SCHEMA = "g040-prefix-reference-v4"
BASE_COMMIT = "92894e41cddb57767c9764d1694992bc0ad9d922"
PG_IDENTITY = "PostgreSQL 17.6"
PUBLIC_KEY_PEM = """-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAPRPfHnLQG7bOEwO3QWARN4UAf+/VEoeIcnZGq7IKJ2M=
-----END PUBLIC KEY-----
"""
PUBLIC_KEY_SHA256 = "c649dd63e8e5b3d0ced61295f4e30ec304a90d1a766e926a4079320658fcea7a"
_MANIFEST_SHA256 = "1f568404418009d191c27a0d8e525306b98b9e1472f4056d1f347907c500a8e1"
_MIGRATION_SOURCE_SHA256 = "e1881677d58017e7075b063190814a11ad0c77de9bf0c360f9bfe10eb484ec68"
_PROBE_TEXT_SHA256 = "bcac01a9b5e4bd5a27287f6486082cabeeb3e46d05912a2abd13820f01d89a5c"
_DERIVATION_MODE = "restored-full_reverse-00400_forward-00400_rollback-full-v1"
_REVERSE_VECTOR_SHA256 = "ee39e90bf6a92ed6c1e1de6d909e93d0d2da0f99df823247a5d138cc4e6b047a"
_HEX = re.compile(r"^[0-9a-f]{64}$")
_COMMIT = re.compile(r"^[0-9a-f]{40}$")
_NONCE = re.compile(r"^[A-Za-z0-9_-]{16,128}$")

_IDENTITY_COMPONENT_FIELDS = (
    "live_identity_sha256", "container_id_sha256", "image_id_sha256",
    "image_digest_sha256", "endpoint_sha256",
)
_CLONE_HASH_FIELDS = (
    "clone_identity", *_IDENTITY_COMPONENT_FIELDS,
    "g035_restore_receipt_sha256", "g035_capture_receipt_sha256",
    "restored_archive_sha256", "capture_receipt_bytes_sha256",
    "restore_receipt_bytes_sha256", "lineage_attestation_sha256",
    "lineage_signature_sha256", "binding_receipt_sha256",
    "observation_receipt_sha256", "absent_catalog_sha256",
    "full_catalog_sha256", "full_data_sha256", "ledger_prefix_sha256",
    "source_plan_sha256", "terminal_ledger_root", "terminal_catalog_root",
    "terminal_acl_root", "terminal_data_root", "terminal_spec_root",
    "terminal_tuple_sha256", "reverse_vector_sha256",
)
_CLONE_FIELDS = (
    "clone_identity", "clone_nonce", *_IDENTITY_COMPONENT_FIELDS,
    "g035_restore_receipt_sha256", "g035_capture_receipt_sha256",
    "restored_archive_sha256", "capture_receipt_bytes_sha256",
    "restore_receipt_bytes_sha256", "lineage_attestation_sha256",
    "lineage_signature_sha256", "binding_receipt_sha256",
    "observation_receipt_sha256", "absent_catalog_sha256",
    "full_catalog_sha256", "full_data_sha256", "ledger_prefix_sha256",
    "derivation_mode", "source_plan_sha256", "terminal_rows",
    "terminal_ledger_root", "terminal_catalog_root", "terminal_acl_root",
    "terminal_data_root", "terminal_spec_root", "terminal_tuple_sha256",
    "reverse_vector_sha256",
)
_CLONE_DISTINCT_FIELDS = (
    "clone_identity", "clone_nonce", "live_identity_sha256",
    "container_id_sha256", "endpoint_sha256", "lineage_attestation_sha256",
    "lineage_signature_sha256", "binding_receipt_sha256",
    "observation_receipt_sha256",
)
_CLONE_EQUAL_FIELDS = tuple(
    key for key in _CLONE_FIELDS
    if key not in set(_CLONE_DISTINCT_FIELDS) | {"derivation_mode"}
)
def _body_clone_field(side: str, key: str) -> str:
    return f"{side}_{'capture_receipt_sha256' if key == 'g035_capture_receipt_sha256' else key}"

_BODY_FIELDS = (
    "schema", "base_commit", "final_commit", "runtime_source_root",
    "manifest_sha256", "migration_source_sha256", "pg_identity",
    "probe_text_sha256", "derivation_mode", "reverse_vector_sha256",
    "absent_catalog_sha256", "full_catalog_sha256", "full_data_sha256",
    "ledger_prefix_sha256", "source_plan_sha256", "terminal_rows",
    "terminal_ledger_root", "terminal_catalog_root", "terminal_acl_root",
    "terminal_data_root", "terminal_spec_root", "terminal_tuple_sha256",
    "target_fingerprint", "observation_nonce", "issued_at_unix", "expires_at_unix",
    *(_body_clone_field("first", key) for key in _CLONE_FIELDS if key not in {"derivation_mode", "reverse_vector_sha256", "absent_catalog_sha256", "full_catalog_sha256", "full_data_sha256", "ledger_prefix_sha256", "source_plan_sha256", "terminal_rows", "terminal_ledger_root", "terminal_catalog_root", "terminal_acl_root", "terminal_data_root", "terminal_spec_root", "terminal_tuple_sha256"}),
    *(_body_clone_field("second", key) for key in _CLONE_FIELDS if key not in {"derivation_mode", "reverse_vector_sha256", "absent_catalog_sha256", "full_catalog_sha256", "full_data_sha256", "ledger_prefix_sha256", "source_plan_sha256", "terminal_rows", "terminal_ledger_root", "terminal_catalog_root", "terminal_acl_root", "terminal_data_root", "terminal_spec_root", "terminal_tuple_sha256"}),
    "reference_public_key_sha256",
)


class ReferenceEvidenceError(RuntimeError):
    pass


def _fail() -> None:
    raise ReferenceEvidenceError("g040 reference evidence verification failed") from None


def canonical_bytes(value: Any) -> bytes:
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode("ascii")
    except Exception:
        _fail()


def _pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if type(key) is not str or key in result:
            _fail()
        result[key] = value
    return result


def _sha(value: Any) -> bool:
    return type(value) is str and bool(_HEX.fullmatch(value))


def _nonce(value: Any) -> bool:
    return type(value) is str and bool(_NONCE.fullmatch(value))


def _assert_constants() -> None:
    if (hashlib.sha256(PUBLIC_KEY_PEM.encode("ascii")).hexdigest() != PUBLIC_KEY_SHA256 or classifier.SOURCE_COMMIT != BASE_COMMIT or classifier.MANIFEST_SHA256 != _MANIFEST_SHA256 or classifier.MIGRATION_SOURCE_SHA256 != _MIGRATION_SOURCE_SHA256 or classifier.PG_IDENTITY != PG_IDENTITY or classifier.PROBE_TEXT_SHA256 != _PROBE_TEXT_SHA256 or DERIVATION_MODE != _DERIVATION_MODE or REVERSE_VECTOR_SHA256 != _REVERSE_VECTOR_SHA256):
        _fail()


@dataclass(frozen=True)
class VerifiedReference:
    schema: str; base_commit: str; final_commit: str; runtime_source_root: str
    manifest_sha256: str; migration_source_sha256: str; pg_identity: str; probe_text_sha256: str; derivation_mode: str; reverse_vector_sha256: str
    absent_catalog_sha256: str; full_catalog_sha256: str; full_data_sha256: str; ledger_prefix_sha256: str
    source_plan_sha256: str; terminal_rows: int; terminal_ledger_root: str; terminal_catalog_root: str; terminal_acl_root: str; terminal_data_root: str; terminal_spec_root: str; terminal_tuple_sha256: str
    target_fingerprint: str; observation_nonce: str; issued_at_unix: int; expires_at_unix: int
    first_clone_identity: str; first_clone_nonce: str; first_live_identity_sha256: str; first_container_id_sha256: str; first_image_id_sha256: str; first_image_digest_sha256: str; first_endpoint_sha256: str; first_g035_restore_receipt_sha256: str; first_capture_receipt_sha256: str; first_restored_archive_sha256: str; first_capture_receipt_bytes_sha256: str; first_restore_receipt_bytes_sha256: str; first_lineage_attestation_sha256: str; first_lineage_signature_sha256: str; first_binding_receipt_sha256: str; first_observation_receipt_sha256: str
    second_clone_identity: str; second_clone_nonce: str; second_live_identity_sha256: str; second_container_id_sha256: str; second_image_id_sha256: str; second_image_digest_sha256: str; second_endpoint_sha256: str; second_g035_restore_receipt_sha256: str; second_capture_receipt_sha256: str; second_restored_archive_sha256: str; second_capture_receipt_bytes_sha256: str; second_restore_receipt_bytes_sha256: str; second_lineage_attestation_sha256: str; second_lineage_signature_sha256: str; second_binding_receipt_sha256: str; second_observation_receipt_sha256: str
    reference_public_key_sha256: str; receipt_sha256: str


def _body_dict(value: VerifiedReference | Mapping[str, Any]) -> dict[str, Any]:
    if type(value) is VerifiedReference:
        return {name: getattr(value, name) for name in _BODY_FIELDS}
    if type(value) not in (dict, MappingProxyType) or set(value) != set(_BODY_FIELDS):
        _fail()
    return dict(value)


def _clone_identity(value: Mapping[str, Any]) -> str:
    return hashlib.sha256(canonical_bytes({key: value[key] for key in _IDENTITY_COMPONENT_FIELDS})).hexdigest()


def _validate_clone(value: Mapping[str, Any]) -> MappingProxyType:
    if type(value) not in (dict, MappingProxyType) or set(value) != set(_CLONE_FIELDS):
        _fail()
    clone = dict(value)
    if (not all(_sha(clone[key]) for key in _CLONE_HASH_FIELDS)
            or not _nonce(clone["clone_nonce"])
            or type(clone["terminal_rows"]) is not int or clone["terminal_rows"] < 1
            or clone["derivation_mode"] != DERIVATION_MODE
            or clone["reverse_vector_sha256"] != REVERSE_VECTOR_SHA256
            or clone["absent_catalog_sha256"] == clone["full_catalog_sha256"]
            or clone["terminal_data_root"] != clone["full_data_sha256"]
            or clone["terminal_tuple_sha256"] != hashlib.sha256(canonical_bytes({
                "terminal_rows": clone["terminal_rows"], "ledger": clone["terminal_ledger_root"],
                "catalog": clone["terminal_catalog_root"], "acl": clone["terminal_acl_root"],
                "data": clone["terminal_data_root"], "terminal_spec": clone["terminal_spec_root"],
            })).hexdigest()
            or clone["clone_identity"] != _clone_identity(clone)):
        _fail()
    return MappingProxyType(clone)


def compare_clone_runs(first: Mapping[str, Any], second: Mapping[str, Any]) -> MappingProxyType:
    first_clone, second_clone = _validate_clone(first), _validate_clone(second)
    if (any(first_clone[key] == second_clone[key] for key in _CLONE_DISTINCT_FIELDS)
            or any(first_clone[key] != second_clone[key] for key in _CLONE_EQUAL_FIELDS)):
        _fail()
    return MappingProxyType({key: first_clone[key] for key in (
        "derivation_mode", "reverse_vector_sha256", "absent_catalog_sha256",
        "full_catalog_sha256", "full_data_sha256", "ledger_prefix_sha256",
        "source_plan_sha256", "terminal_rows", "terminal_ledger_root",
        "terminal_catalog_root", "terminal_acl_root", "terminal_data_root",
        "terminal_spec_root", "terminal_tuple_sha256",
    )})


def validate_reference_body(body: Mapping[str, Any]) -> MappingProxyType:
    _assert_constants()
    value = _body_dict(body)
    hashes = ("runtime_source_root", "absent_catalog_sha256", "full_catalog_sha256", "full_data_sha256", "ledger_prefix_sha256", "source_plan_sha256", "terminal_ledger_root", "terminal_catalog_root", "terminal_acl_root", "terminal_data_root", "terminal_spec_root", "terminal_tuple_sha256", "target_fingerprint")
    if (value["schema"] != SCHEMA or value["base_commit"] != BASE_COMMIT or value["manifest_sha256"] != _MANIFEST_SHA256 or value["migration_source_sha256"] != _MIGRATION_SOURCE_SHA256 or value["pg_identity"] != PG_IDENTITY or value["probe_text_sha256"] != _PROBE_TEXT_SHA256 or value["derivation_mode"] != DERIVATION_MODE or value["reverse_vector_sha256"] != REVERSE_VECTOR_SHA256 or value["reference_public_key_sha256"] != PUBLIC_KEY_SHA256 or type(value["terminal_rows"]) is not int or value["terminal_rows"] < 1 or type(value["final_commit"]) is not str or not _COMMIT.fullmatch(value["final_commit"]) or not all(_sha(value[key]) for key in hashes) or not _nonce(value["observation_nonce"]) or type(value["issued_at_unix"]) is not int or type(value["expires_at_unix"]) is not int or value["issued_at_unix"] < 0 or value["expires_at_unix"] <= value["issued_at_unix"] or value["expires_at_unix"] - value["issued_at_unix"] > 900):
        _fail()
    shared = {"derivation_mode", "reverse_vector_sha256", "absent_catalog_sha256",
              "full_catalog_sha256", "full_data_sha256", "ledger_prefix_sha256",
              "source_plan_sha256", "terminal_rows", "terminal_ledger_root",
              "terminal_catalog_root", "terminal_acl_root", "terminal_data_root",
              "terminal_spec_root", "terminal_tuple_sha256"}
    first = {key: value[_body_clone_field("first", key)] for key in _CLONE_FIELDS if key not in shared} | {key: value[key] for key in shared}
    second = {key: value[_body_clone_field("second", key)] for key in _CLONE_FIELDS if key not in shared} | {key: value[key] for key in shared}
    compare_clone_runs(first, second)
    return MappingProxyType(value)


def load_reference(raw: bytes | str) -> MappingProxyType:
    try:
        text = raw.decode("ascii") if type(raw) is bytes else raw
        if type(text) is not str:
            _fail()
        value = json.loads(text, object_pairs_hook=_pairs)
        if type(value) is not dict or canonical_bytes(value) != text.encode("ascii"):
            _fail()
    except ReferenceEvidenceError:
        raise
    except Exception:
        _fail()
    return MappingProxyType(value)


def build_reference_body(*, final_commit: str, runtime_source_root: str, target_fingerprint: str, observation_nonce: str, issued_at_unix: int, expires_at_unix: int, first_clone: Mapping[str, Any], second_clone: Mapping[str, Any]) -> MappingProxyType:
    roots = compare_clone_runs(first_clone, second_clone)
    body = {"schema": SCHEMA, "base_commit": BASE_COMMIT, "final_commit": final_commit, "runtime_source_root": runtime_source_root, "manifest_sha256": _MANIFEST_SHA256, "migration_source_sha256": _MIGRATION_SOURCE_SHA256, "pg_identity": PG_IDENTITY, "probe_text_sha256": _PROBE_TEXT_SHA256, **dict(roots), "target_fingerprint": target_fingerprint, "observation_nonce": observation_nonce, "issued_at_unix": issued_at_unix, "expires_at_unix": expires_at_unix, **{_body_clone_field("first", key): first_clone[key] for key in _CLONE_FIELDS if key not in {"derivation_mode", "reverse_vector_sha256", "absent_catalog_sha256", "full_catalog_sha256", "full_data_sha256", "ledger_prefix_sha256", "source_plan_sha256", "terminal_rows", "terminal_ledger_root", "terminal_catalog_root", "terminal_acl_root", "terminal_data_root", "terminal_spec_root", "terminal_tuple_sha256"}}, **{_body_clone_field("second", key): second_clone[key] for key in _CLONE_FIELDS if key not in {"derivation_mode", "reverse_vector_sha256", "absent_catalog_sha256", "full_catalog_sha256", "full_data_sha256", "ledger_prefix_sha256", "source_plan_sha256", "terminal_rows", "terminal_ledger_root", "terminal_catalog_root", "terminal_acl_root", "terminal_data_root", "terminal_spec_root", "terminal_tuple_sha256"}}, "reference_public_key_sha256": PUBLIC_KEY_SHA256}
    return validate_reference_body(body)


def _custody_bytes(path: str | Path, repository_root: str | Path) -> bytes:
    try:
        # Import lazily: the controller imports this module to verify final evidence.
        import g040_production_controller as controller
        root = Path(repository_root).resolve()
        return controller._stable_bytes(controller._outside(path, root), root)
    except Exception:
        _fail()


def _write_request(path: str | Path, value: Mapping[str, Any], repository_root: str | Path) -> None:
    try:
        import g040_production_controller as controller
        target = controller._outside(path, Path(repository_root).resolve(), fresh=True)
        data = canonical_bytes(dict(value))
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
    except ReferenceEvidenceError:
        raise
    except Exception:
        _fail()


def build_reference_request(*, source: SourceBinding, target_fingerprint: str, nonce: str,
                            first_observation: str | Path, second_observation: str | Path,
                            output: str | Path, repository_root: str | Path,
                            now_unix: int | None = None, valid_seconds: int = 600) -> Mapping[str, Any]:
    if (type(source) is not SourceBinding or type(valid_seconds) is not int
            or not 1 <= valid_seconds <= 900 or not _sha(target_fingerprint) or not _nonce(nonce)):
        _fail()
    issued = int(__import__("time").time()) if now_unix is None else now_unix
    if type(issued) is not int:
        _fail()
    try:
        # This parser is intentionally shared with the observation producer so request
        # generation validates both controller-signed observations before writing.
        from g040_clone_rehearsal import _verified_observation
        first = _verified_observation(first_observation, source=source,
                                      target_fingerprint=target_fingerprint,
                                      repository_root=repository_root, now=issued)
        second = _verified_observation(second_observation, source=source,
                                       target_fingerprint=target_fingerprint,
                                       repository_root=repository_root, now=issued)
    except ReferenceEvidenceError:
        raise
    except Exception:
        _fail()
    body = build_reference_body(final_commit=source.final_commit,
                                runtime_source_root=source.runtime_source_root,
                                target_fingerprint=target_fingerprint,
                                observation_nonce=nonce, issued_at_unix=issued,
                                expires_at_unix=issued + valid_seconds,
                                first_clone=first, second_clone=second)
    _write_request(output, body, repository_root)
    return MappingProxyType({"schema": SCHEMA,
                             "reference_request_sha256": hashlib.sha256(canonical_bytes(dict(body))).hexdigest(),
                             "expires_at_unix": body["expires_at_unix"]})


def finalize_reference(*, source: SourceBinding, target_fingerprint: str,
                       request: str | Path, signature: str | Path, output: str | Path,
                       repository_root: str | Path, now_unix: int | None = None) -> Mapping[str, str]:
    if type(source) is not SourceBinding or not _sha(target_fingerprint):
        _fail()
    now = int(__import__("time").time()) if now_unix is None else now_unix
    if type(now) is not int:
        _fail()
    raw, detached = _custody_bytes(request, repository_root), _custody_bytes(signature, repository_root)
    body = load_reference(raw)
    if set(body) != set(_BODY_FIELDS):
        _fail()
    body = validate_reference_body(body)
    try:
        signed = {**dict(body), "signature_b64": base64.b64encode(detached).decode("ascii")}
    except Exception:
        _fail()
    final_raw = canonical_bytes(signed)
    verify_reference(final_raw, now_unix=now, expected_source=source,
                     expected_target_fingerprint=target_fingerprint)
    _write_request(output, signed, repository_root)
    return MappingProxyType({"schema": SCHEMA,
                             "reference_receipt_sha256": hashlib.sha256(final_raw).hexdigest()})

def verify_reference(raw: bytes | str, *, now_unix: int, expected_source: SourceBinding, expected_target_fingerprint: str) -> VerifiedReference:
    _assert_constants()
    if type(raw) not in (bytes, str) or type(now_unix) is not int or type(expected_source) is not SourceBinding or not _sha(expected_target_fingerprint):
        _fail()
    value = load_reference(raw)
    if set(value) != set(_BODY_FIELDS) | {"signature_b64"} or type(value["signature_b64"]) is not str:
        _fail()
    body = validate_reference_body({key: value[key] for key in _BODY_FIELDS})
    if body["final_commit"] != expected_source.final_commit or body["runtime_source_root"] != expected_source.runtime_source_root or body["target_fingerprint"] != expected_target_fingerprint or not body["issued_at_unix"] <= now_unix <= body["expires_at_unix"]:
        _fail()
    try:
        signature = base64.b64decode(value["signature_b64"], validate=True)
        with _crypto._source_public_key(PUBLIC_KEY_PEM.encode("ascii")) as key:
            valid = _crypto.openssl_verify(_crypto.command("openssl"), key, canonical_bytes(dict(body)), signature)
            key.validate()
    except Exception:
        _fail()
    if valid is not True:
        _fail()
    return VerifiedReference(**dict(body), receipt_sha256=hashlib.sha256(canonical_bytes(dict(value))).hexdigest())


__all__ = ["ReferenceEvidenceError", "VerifiedReference", "PUBLIC_KEY_PEM", "PUBLIC_KEY_SHA256", "SCHEMA", "DERIVATION_MODE", "REVERSE_VECTOR_SHA256", "compare_clone_runs", "build_reference_body", "build_reference_request", "finalize_reference", "verify_reference", "load_reference", "canonical_bytes"]
