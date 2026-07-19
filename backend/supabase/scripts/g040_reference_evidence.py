#!/usr/bin/env python3
"""Offline, source-pinned signed reference evidence for G040."""
from __future__ import annotations

import base64
import hashlib
import json
import re
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Callable, Mapping

import g037_managed_recovery as _crypto
import g040_prefix_recovery as classifier
from g040_reverse_00400 import DERIVATION_MODE, REVERSE_VECTOR_SHA256
from g040_recovery_source import SourceBinding

SCHEMA = "g040-prefix-reference-v2"
BASE_COMMIT = "92894e41cddb57767c9764d1694992bc0ad9d922"
PG_IDENTITY = "PostgreSQL 17.6"
PUBLIC_KEY_PEM = """-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAPRPfHnLQG7bOEwO3QWARN4UAf+/VEoeIcnZGq7IKJ2M=
-----END PUBLIC KEY-----
"""
PUBLIC_KEY_SHA256 = "c649dd63e8e5b3d0ced61295f4e30ec304a90d1a766e926a4079320658fcea7a"
_MANIFEST_SHA256 = "1f568404418009d191c27a0d8e525306b98b9e1472f4056d1f347907c500a8e1"
_MIGRATION_SOURCE_SHA256 = "e1881677d58017e7075b063190814a11ad0c77de9bf0c360f9bfe10eb484ec68"
_PROBE_TEXT_SHA256 = "4da3520e5d913eb6aeaf1466286f66bad99596ed4b6b5885ff1b6080db663c6f"
_DERIVATION_MODE = "restored-full_reverse-00400_forward-00400_rollback-full-v1"
_REVERSE_VECTOR_SHA256 = "ee39e90bf6a92ed6c1e1de6d909e93d0d2da0f99df823247a5d138cc4e6b047a"
_HEX = re.compile(r"^[0-9a-f]{64}$")
_COMMIT = re.compile(r"^[0-9a-f]{40}$")
_NONCE = re.compile(r"^[A-Za-z0-9_-]{16,128}$")
_BODY_FIELDS = ("schema", "base_commit", "final_commit", "runtime_source_root", "manifest_sha256", "migration_source_sha256", "pg_identity", "probe_text_sha256", "derivation_mode", "reverse_vector_sha256", "absent_catalog_sha256", "full_catalog_sha256", "full_data_sha256", "ledger_prefix_sha256", "target_fingerprint", "observation_nonce", "issued_at_unix", "expires_at_unix", "first_clone_identity", "first_clone_nonce", "first_live_identity_sha256", "first_container_id_sha256", "first_image_id_sha256", "first_image_digest_sha256", "first_endpoint_sha256", "first_g035_restore_receipt_sha256", "first_capture_receipt_sha256", "first_restored_archive_sha256", "first_capture_receipt_bytes_sha256", "first_restore_receipt_bytes_sha256", "first_lineage_attestation_sha256", "first_lineage_signature_sha256", "second_clone_identity", "second_clone_nonce", "second_live_identity_sha256", "second_container_id_sha256", "second_image_id_sha256", "second_image_digest_sha256", "second_endpoint_sha256", "second_g035_restore_receipt_sha256", "second_capture_receipt_sha256", "second_restored_archive_sha256", "second_capture_receipt_bytes_sha256", "second_restore_receipt_bytes_sha256", "second_lineage_attestation_sha256", "second_lineage_signature_sha256", "reference_public_key_sha256")

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
    if (hashlib.sha256(PUBLIC_KEY_PEM.encode("ascii")).hexdigest() != PUBLIC_KEY_SHA256 or classifier.SOURCE_COMMIT != BASE_COMMIT or classifier.RECEIPT_SCHEMA != SCHEMA or classifier.MANIFEST_SHA256 != _MANIFEST_SHA256 or classifier.MIGRATION_SOURCE_SHA256 != _MIGRATION_SOURCE_SHA256 or classifier.PG_IDENTITY != PG_IDENTITY or classifier.PROBE_TEXT_SHA256 != _PROBE_TEXT_SHA256 or DERIVATION_MODE != _DERIVATION_MODE or REVERSE_VECTOR_SHA256 != _REVERSE_VECTOR_SHA256):
        _fail()

@dataclass(frozen=True)
class VerifiedReference:
    schema: str; base_commit: str; final_commit: str; runtime_source_root: str
    manifest_sha256: str; migration_source_sha256: str; pg_identity: str; probe_text_sha256: str; derivation_mode: str; reverse_vector_sha256: str
    absent_catalog_sha256: str; full_catalog_sha256: str; full_data_sha256: str; ledger_prefix_sha256: str
    target_fingerprint: str; observation_nonce: str; issued_at_unix: int; expires_at_unix: int
    first_clone_identity: str; first_clone_nonce: str; first_live_identity_sha256: str; first_container_id_sha256: str; first_image_id_sha256: str; first_image_digest_sha256: str; first_endpoint_sha256: str; first_g035_restore_receipt_sha256: str; first_capture_receipt_sha256: str; first_restored_archive_sha256: str; first_capture_receipt_bytes_sha256: str; first_restore_receipt_bytes_sha256: str; first_lineage_attestation_sha256: str; first_lineage_signature_sha256: str
    second_clone_identity: str; second_clone_nonce: str; second_live_identity_sha256: str; second_container_id_sha256: str; second_image_id_sha256: str; second_image_digest_sha256: str; second_endpoint_sha256: str; second_g035_restore_receipt_sha256: str; second_capture_receipt_sha256: str; second_restored_archive_sha256: str; second_capture_receipt_bytes_sha256: str; second_restore_receipt_bytes_sha256: str; second_lineage_attestation_sha256: str; second_lineage_signature_sha256: str
    reference_public_key_sha256: str; signature_b64: str; receipt_sha256: str

def _body_dict(value: VerifiedReference | Mapping[str, Any]) -> dict[str, Any]:
    if type(value) is VerifiedReference:
        return {name: getattr(value, name) for name in _BODY_FIELDS}
    if type(value) is not MappingProxyType and type(value) is not dict:
        _fail()
    if set(value) != set(_BODY_FIELDS):
        _fail()
    return dict(value)

def validate_reference_body(body: Mapping[str, Any]) -> MappingProxyType:
    _assert_constants(); value = _body_dict(body)
    hashes = ("runtime_source_root", "absent_catalog_sha256", "full_catalog_sha256", "full_data_sha256", "ledger_prefix_sha256", "target_fingerprint", "first_live_identity_sha256", "first_container_id_sha256", "first_image_id_sha256", "first_image_digest_sha256", "first_endpoint_sha256", "first_g035_restore_receipt_sha256", "first_capture_receipt_sha256", "first_restored_archive_sha256", "first_capture_receipt_bytes_sha256", "first_restore_receipt_bytes_sha256", "first_lineage_attestation_sha256", "first_lineage_signature_sha256", "second_live_identity_sha256", "second_container_id_sha256", "second_image_id_sha256", "second_image_digest_sha256", "second_endpoint_sha256", "second_g035_restore_receipt_sha256", "second_capture_receipt_sha256", "second_restored_archive_sha256", "second_capture_receipt_bytes_sha256", "second_restore_receipt_bytes_sha256", "second_lineage_attestation_sha256", "second_lineage_signature_sha256")
    if (value["schema"] != SCHEMA or value["base_commit"] != BASE_COMMIT or value["manifest_sha256"] != _MANIFEST_SHA256 or value["migration_source_sha256"] != _MIGRATION_SOURCE_SHA256 or value["pg_identity"] != PG_IDENTITY or value["probe_text_sha256"] != _PROBE_TEXT_SHA256 or value["derivation_mode"] != DERIVATION_MODE or value["reverse_vector_sha256"] != REVERSE_VECTOR_SHA256 or value["reference_public_key_sha256"] != PUBLIC_KEY_SHA256 or type(value["final_commit"]) is not str or not _COMMIT.fullmatch(value["final_commit"]) or not all(_sha(value[key]) for key in hashes) or not all(_nonce(value[key]) for key in ("observation_nonce", "first_clone_nonce", "second_clone_nonce")) or not all(_sha(value[key]) for key in ("first_clone_identity", "second_clone_identity")) or type(value["issued_at_unix"]) is not int or type(value["expires_at_unix"]) is not int or value["issued_at_unix"] < 0 or value["expires_at_unix"] <= value["issued_at_unix"] or value["expires_at_unix"] - value["issued_at_unix"] > 900):
        _fail()
    if len({value["first_clone_identity"], value["second_clone_identity"]}) != 2 or len({value["first_clone_nonce"], value["second_clone_nonce"]}) != 2 or len({value["first_live_identity_sha256"], value["second_live_identity_sha256"]}) != 2 or len({value["first_container_id_sha256"], value["second_container_id_sha256"]}) != 2 or len({value["first_g035_restore_receipt_sha256"], value["second_g035_restore_receipt_sha256"]}) != 2 or len({value["first_lineage_attestation_sha256"], value["second_lineage_attestation_sha256"]}) != 2 or len({value["first_lineage_signature_sha256"], value["second_lineage_signature_sha256"]}) != 2:
        _fail()
    return MappingProxyType(value)


def load_reference(raw: bytes | str) -> MappingProxyType:
    try:
        text = raw.decode("ascii") if type(raw) is bytes else raw
        if type(text) is not str: _fail()
        value = json.loads(text, object_pairs_hook=_pairs)
        if type(value) is not dict or canonical_bytes(value) != text.encode("ascii"): _fail()
    except ReferenceEvidenceError: raise
    except Exception: _fail()
    return MappingProxyType(value)


def build_clone_run(absent: Mapping[str, Any], full: Mapping[str, Any]) -> MappingProxyType:
    proof = {"clone_identity", "clone_nonce", "live_identity_sha256", "container_id_sha256", "image_id_sha256", "image_digest_sha256", "endpoint_sha256", "g035_restore_receipt_sha256", "g035_capture_receipt_sha256", "restored_archive_sha256", "capture_receipt_bytes_sha256", "restore_receipt_bytes_sha256", "lineage_attestation_sha256", "lineage_signature_sha256"}
    required = proof | {"state", "ledger_prefix_sha256", "catalog_sha256", "derivation_mode", "reverse_vector_sha256"}
    if type(absent) is not MappingProxyType or type(full) is not MappingProxyType or set(absent) != required or set(full) != required | {"data_sha256"} or absent["state"] != "absent" or full["state"] != "full" or absent["catalog_sha256"] == full["catalog_sha256"] or any(absent[key] != full[key] for key in proof | {"ledger_prefix_sha256", "derivation_mode", "reverse_vector_sha256"}) or absent["derivation_mode"] != DERIVATION_MODE or absent["reverse_vector_sha256"] != REVERSE_VECTOR_SHA256: _fail()
    result = {key: absent[key] for key in proof} | {"absent_catalog_sha256": absent["catalog_sha256"], "full_catalog_sha256": full["catalog_sha256"], "full_data_sha256": full["data_sha256"], "ledger_prefix_sha256": absent["ledger_prefix_sha256"], "derivation_mode": absent["derivation_mode"], "reverse_vector_sha256": absent["reverse_vector_sha256"]}
    if not _nonce(result["clone_nonce"]) or any(not _sha(result[key]) for key in result if key not in {"clone_nonce", "derivation_mode"}): _fail()
    return MappingProxyType(result)


def compare_clone_runs(first: Mapping[str, Any], second: Mapping[str, Any]) -> MappingProxyType:
    fields = {"clone_identity", "clone_nonce", "live_identity_sha256", "container_id_sha256", "image_id_sha256", "image_digest_sha256", "endpoint_sha256", "g035_restore_receipt_sha256", "g035_capture_receipt_sha256", "restored_archive_sha256", "capture_receipt_bytes_sha256", "restore_receipt_bytes_sha256", "lineage_attestation_sha256", "lineage_signature_sha256", "absent_catalog_sha256", "full_catalog_sha256", "full_data_sha256", "ledger_prefix_sha256", "derivation_mode", "reverse_vector_sha256"}
    distinct = {"clone_identity", "clone_nonce", "g035_restore_receipt_sha256", "live_identity_sha256", "container_id_sha256", "lineage_attestation_sha256", "lineage_signature_sha256"}
    if type(first) not in (dict, MappingProxyType) or type(second) not in (dict, MappingProxyType) or set(first) != fields or set(second) != fields or first["derivation_mode"] != DERIVATION_MODE or second["derivation_mode"] != DERIVATION_MODE or first["reverse_vector_sha256"] != REVERSE_VECTOR_SHA256 or second["reverse_vector_sha256"] != REVERSE_VECTOR_SHA256 or first["absent_catalog_sha256"] == first["full_catalog_sha256"] or second["absent_catalog_sha256"] == second["full_catalog_sha256"] or any(first[key] == second[key] for key in distinct) or any(first[key] != second[key] for key in fields - distinct): _fail()
    return MappingProxyType({key: first[key] for key in ("derivation_mode", "reverse_vector_sha256", "absent_catalog_sha256", "full_catalog_sha256", "full_data_sha256", "ledger_prefix_sha256")})


def build_reference_body(*, final_commit: str, runtime_source_root: str, target_fingerprint: str, observation_nonce: str, issued_at_unix: int, expires_at_unix: int, first_clone: Mapping[str, Any], second_clone: Mapping[str, Any]) -> MappingProxyType:
    roots = compare_clone_runs(first_clone, second_clone)
    body = {"schema": SCHEMA, "base_commit": BASE_COMMIT, "final_commit": final_commit, "runtime_source_root": runtime_source_root, "manifest_sha256": _MANIFEST_SHA256, "migration_source_sha256": _MIGRATION_SOURCE_SHA256, "pg_identity": PG_IDENTITY, "probe_text_sha256": _PROBE_TEXT_SHA256, **dict(roots), "target_fingerprint": target_fingerprint, "observation_nonce": observation_nonce, "issued_at_unix": issued_at_unix, "expires_at_unix": expires_at_unix, **{f"first_{key.removeprefix('g035_')}": first_clone[key] for key in ("clone_identity", "clone_nonce", "live_identity_sha256", "container_id_sha256", "image_id_sha256", "image_digest_sha256", "endpoint_sha256", "g035_capture_receipt_sha256", "restored_archive_sha256", "capture_receipt_bytes_sha256", "restore_receipt_bytes_sha256", "lineage_attestation_sha256", "lineage_signature_sha256")}, "first_g035_restore_receipt_sha256": first_clone["g035_restore_receipt_sha256"], **{f"second_{key.removeprefix('g035_')}": second_clone[key] for key in ("clone_identity", "clone_nonce", "live_identity_sha256", "container_id_sha256", "image_id_sha256", "image_digest_sha256", "endpoint_sha256", "g035_capture_receipt_sha256", "restored_archive_sha256", "capture_receipt_bytes_sha256", "restore_receipt_bytes_sha256", "lineage_attestation_sha256", "lineage_signature_sha256")}, "second_g035_restore_receipt_sha256": second_clone["g035_restore_receipt_sha256"], "reference_public_key_sha256": PUBLIC_KEY_SHA256}
    return validate_reference_body(body)

def sign_reference(body: Mapping[str, Any], signer: Callable[[bytes], bytes]) -> MappingProxyType:
    if not callable(signer): _fail()
    unsigned = validate_reference_body(body)
    try: signature = signer(canonical_bytes(dict(unsigned)))
    except Exception: _fail()
    if type(signature) is not bytes or not signature: _fail()
    return MappingProxyType({**dict(unsigned), "signature_b64": base64.b64encode(signature).decode("ascii")})

def verify_reference(raw: bytes | str | Mapping[str, Any], *, now_unix: int, expected_source: SourceBinding, expected_target_fingerprint: str) -> VerifiedReference:
    _assert_constants()
    if type(now_unix) is not int or type(expected_source) is not SourceBinding or not _sha(expected_target_fingerprint): _fail()
    value = load_reference(raw) if type(raw) in (bytes, str) else raw
    if type(value) not in (dict, MappingProxyType) or set(value) != set(_BODY_FIELDS) | {"signature_b64"} or type(value["signature_b64"]) is not str: _fail()
    body = validate_reference_body({key: value[key] for key in _BODY_FIELDS})
    if body["final_commit"] != expected_source.final_commit or body["runtime_source_root"] != expected_source.runtime_source_root or body["target_fingerprint"] != expected_target_fingerprint or not body["issued_at_unix"] <= now_unix <= body["expires_at_unix"]: _fail()
    try:
        signature = base64.b64decode(value["signature_b64"], validate=True)
        with _crypto._source_public_key(PUBLIC_KEY_PEM.encode("ascii")) as key:
            valid = _crypto.openssl_verify(_crypto.command("openssl"), key, canonical_bytes(dict(body)), signature)
            key.validate()
    except Exception: _fail()
    if valid is not True: _fail()
    receipt_sha256 = hashlib.sha256(canonical_bytes(dict(value))).hexdigest()
    return VerifiedReference(**dict(body), signature_b64=value["signature_b64"], receipt_sha256=receipt_sha256)

__all__ = ["ReferenceEvidenceError", "VerifiedReference", "PUBLIC_KEY_PEM", "PUBLIC_KEY_SHA256", "SCHEMA", "DERIVATION_MODE", "REVERSE_VECTOR_SHA256", "build_clone_run", "compare_clone_runs", "build_reference_body", "sign_reference", "verify_reference", "load_reference", "canonical_bytes"]
