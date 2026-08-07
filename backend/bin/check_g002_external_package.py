#!/usr/bin/env python3
"""Fail-closed structural verifier for externally supplied G002 packages.

This program never establishes authenticity.  Its strongest result is
``locally_consistent_unverified`` and every package result is non-successful.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import stat
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, Optional, Sequence

REPO_ROOT = Path(__file__).resolve().parents[2]
POLICY_PATH = REPO_ROOT / "backend/fixtures/g002-external-package/required-artifacts.v1.json"
INVENTORY_NAME = "g002-external-package.json"
TERMINAL = "LOCAL_QUALIFIED_ONLY"
DOES_NOT_UNBLOCK = ["G002", "G003", "aggregate"]
SYNTHETIC_LABEL = "SYNTHETIC_CONTRACT_FIXTURE_NOT_EXTERNAL_EVIDENCE"
HEX64 = re.compile(r"^[0-9a-f]{64}$")
FILENAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
SLUGS = {
    "packageId": re.compile(r"^pkg:[a-z0-9][a-z0-9-]{0,63}$"),
    "actionId": re.compile(r"^action:[a-z0-9][a-z0-9-]{0,63}$"),
    "targetId": re.compile(r"^target:[a-z0-9][a-z0-9-]{0,63}$"),
    "providerId": re.compile(r"^provider:[a-z0-9][a-z0-9-]{0,63}$"),
    "deploymentId": re.compile(r"^deployment:[a-z0-9][a-z0-9-]{0,63}$"),
    "environmentId": re.compile(r"^environment:[a-z0-9][a-z0-9-]{0,63}$"),
    "eventId": re.compile(r"^event:[a-z0-9][a-z0-9-]{0,63}$"),
    "durableStoreId": re.compile(r"^store:[a-z0-9][a-z0-9-]{0,63}$"),
    "recordId": re.compile(r"^record:[a-z0-9][a-z0-9-]{0,63}$"),
    "observerReferenceId": re.compile(r"^observer:[a-z0-9][a-z0-9-]{0,63}$"),
    "issuerReferenceId": re.compile(r"^issuer:[a-z0-9][a-z0-9-]{0,63}$"),
    "principalId": re.compile(r"^principal:[a-z0-9][a-z0-9-]{0,63}$"),
    "verifierId": re.compile(r"^verifier:[a-z0-9][a-z0-9-]{0,63}$"),
    "keyReferenceId": re.compile(r"^keyref:[a-z0-9][a-z0-9-]{0,63}$"),
    "keyProviderReferenceId": re.compile(r"^keyref:[a-z0-9][a-z0-9-]{0,63}$"),
    "keyId": re.compile(r"^keyref:[a-z0-9][a-z0-9-]{0,63}$"),
    "rootReferenceId": re.compile(r"^rootref:[a-z0-9][a-z0-9-]{0,63}$"),
    "attestationReferenceId": re.compile(r"^attest:[a-z0-9][a-z0-9-]{0,63}$"),
}
COMPONENT = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")
SCOPE = re.compile(r"^[a-z0-9][a-z0-9:-]{0,127}$")
JWT = re.compile(r"^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$")
FORBIDDEN_MARKERS = ("-----BEGIN", "-----END", "ssh-", "AKIA", '"kty"', "PRIVATE KEY")

POLICY: dict[str, Any] = {
    "schemaVersion": 1,
    "policyId": "g002-external-package-local-structural",
    "policyVersion": 1,
    "policyAuthority": "local-structural-only",
    "canEstablishAuthenticity": False,
    "canonicalClasses": [
        "outside_rooted_signature_key_registry",
        "hmac_verifier_provisioning",
        "target_stack_measurement",
        "induced_event_durability_receipt",
        "authorization_scope_issuer",
    ],
    "algorithms": {"signature": ["Ed25519", "ECDSA-P256-SHA256"], "hmac": ["HMAC-SHA256"]},
    "rootReferenceTypes": [
        "provider_control_plane",
        "independent_transparency_log",
        "organization_key_registry",
    ],
    "keyStatuses": ["active"],
    "targetClasses": ["protected_target"],
    "audience": "g038-protected-successor",
    "requiredScopes": ["g038:deploy", "g038:durability:observe", "g038:verify"],
    "authorizationWindowSeconds": 86400,
    "limits": {
        "maxFiles": 64,
        "maxFileBytes": 4194304,
        "maxTotalBytes": 16777216,
        "maxDepth": 16,
        "maxScalars": 2048,
        "maxStringLength": 4096,
        "maxDiagnostics": 100,
    },
    "statuses": ["empty", "locally_consistent_unverified", "invalid"],
    "exitCodes": {"empty": 1, "locally_consistent_unverified": 1, "invalid": 2},
}

COMMON_KEYS = {
    "schemaVersion", "class", "packageId", "actionId", "requestDigest",
    "subjectDigest", "targetId", "issuedAt",
}
CLASS_KEYS: dict[str, set[str]] = {
    "outside_rooted_signature_key_registry": {
        "rootReferenceId", "rootReferenceType", "rootFingerprint", "registrySnapshotDigest",
        "keyId", "keyStatus", "algorithm", "signedSubjectDigest", "verifierReceiptDigest",
    },
    "hmac_verifier_provisioning": {
        "verifierId", "verifierVersion", "algorithm", "keyReferenceId",
        "keyProviderReferenceId", "verifiedSubjectDigest", "verificationOutcome",
        "verifierReceiptDigest", "keyMaterialIncluded",
    },
    "target_stack_measurement": {
        "providerId", "deploymentId", "environmentId", "targetClass", "componentDigests",
        "measurementMechanism", "attestationReferenceId", "attestationDigest", "capturedAt",
    },
    "induced_event_durability_receipt": {
        "eventId", "eventType", "acceptedAt", "committedAt", "observedAt", "durableStoreId",
        "recordId", "observationReceiptDigest", "observerReferenceId", "simulation", "replay",
    },
    "authorization_scope_issuer": {
        "issuerReferenceId", "principalId", "audience", "grantedScopes",
        "authorizationFingerprint", "expiresAt", "authorizationReceiptDigest",
    },
}

MESSAGES = {
    "G002_EMPTY_INBOX": "external package inbox is empty",
    "G002_POLICY_INVALID": "verifier policy is unavailable or invalid",
    "G002_INVENTORY_MISSING": "package inventory is missing",
    "G002_JSON_INVALID": "JSON input is invalid",
    "G002_DUPLICATE_KEY": "JSON object contains a duplicate key",
    "G002_SCHEMA_FIELD": "JSON object fields do not match the closed schema",
    "G002_TYPE_OR_RANGE": "field type or range is invalid",
    "G002_LIMIT_EXCEEDED": "input limit was exceeded",
    "G002_PATH_INVALID": "artifact filename is invalid",
    "G002_PLATFORM_UNSAFE_OPEN": "safe file opening is unavailable",
    "G002_FILESET_MISMATCH": "inbox file set does not match the inventory",
    "G002_FILE_UNSAFE": "input file is not one stable regular file",
    "G002_FILE_CHANGED": "input file changed while being read",
    "G002_DIGEST_OR_SIZE": "artifact digest or size does not match",
    "G002_CLASS_SET": "required evidence classes are incomplete or duplicated",
    "G002_BINDING_MISMATCH": "cross-document action binding is inconsistent",
    "G002_TIME_INVALID": "claimed chronology is invalid",
    "G002_ROOT_EMBEDDED": "claimed external root is embedded in the package",
    "G002_FORBIDDEN_VALUE_SHAPE": "field contains a forbidden credential or key material shape",
    "G002_LOCAL_TARGET": "target measurement is not structurally protected-target evidence",
    "G002_SIMULATION": "durability receipt is simulated or replayed",
    "G002_SCOPE_INVALID": "authorization scope or audience is inconsistent",
    "G002_SYNTHETIC_NON_EVIDENCE": "synthetic fixture is not external evidence",
    "G002_OUTPUT_FAILURE": "report output could not be written safely",
    "G002_DIAGNOSTICS_TRUNCATED": "additional diagnostics were omitted",
}

class DuplicateKey(ValueError):
    pass

@dataclass(frozen=True)
class Finding:
    code: str
    path: str
    evidence_class: Optional[str] = None
    severity: str = "error"

    def row(self) -> dict[str, Any]:
        return {
            "code": self.code,
            "severity": self.severity,
            "class": self.evidence_class,
            "path": self.path,
            "message": MESSAGES[self.code],
        }

class InvalidPackage(Exception):
    def __init__(self, finding: Finding):
        super().__init__(finding.code)
        self.finding = finding


def _pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            raise DuplicateKey(key)
        out[key] = value
    return out


def _reject_constant(_: str) -> None:
    raise ValueError("non-finite number")


def _shape(value: Any, *, depth: int = 0, counters: Optional[list[int]] = None) -> None:
    counters = counters or [0]
    if depth > POLICY["limits"]["maxDepth"]:
        raise InvalidPackage(Finding("G002_LIMIT_EXCEEDED", "$"))
    if isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str) or len(key) > POLICY["limits"]["maxStringLength"]:
                raise InvalidPackage(Finding("G002_LIMIT_EXCEEDED", "$"))
            _shape(child, depth=depth + 1, counters=counters)
    elif isinstance(value, list):
        for child in value:
            _shape(child, depth=depth + 1, counters=counters)
    else:
        counters[0] += 1
        if counters[0] > POLICY["limits"]["maxScalars"]:
            raise InvalidPackage(Finding("G002_LIMIT_EXCEEDED", "$"))
        if isinstance(value, str) and len(value) > POLICY["limits"]["maxStringLength"]:
            raise InvalidPackage(Finding("G002_LIMIT_EXCEEDED", "$"))
        if isinstance(value, float) and not math.isfinite(value):
            raise InvalidPackage(Finding("G002_JSON_INVALID", "$"))


def parse_json(raw: bytes, path: str) -> dict[str, Any]:
    try:
        text = raw.decode("utf-8")
        value = json.loads(text, object_pairs_hook=_pairs, parse_constant=_reject_constant)
    except DuplicateKey as exc:
        raise InvalidPackage(Finding("G002_DUPLICATE_KEY", path)) from exc
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise InvalidPackage(Finding("G002_JSON_INVALID", path)) from exc
    if not isinstance(value, dict):
        raise InvalidPackage(Finding("G002_SCHEMA_FIELD", path))
    _shape(value)
    return value


def _exact(obj: dict[str, Any], keys: Iterable[str], path: str, cls: Optional[str] = None) -> None:
    if set(obj) != set(keys):
        raise InvalidPackage(Finding("G002_SCHEMA_FIELD", path, cls))


def _hex(value: Any, path: str, cls: Optional[str] = None) -> str:
    if not isinstance(value, str) or not HEX64.fullmatch(value):
        raise InvalidPackage(Finding("G002_TYPE_OR_RANGE", path, cls))
    return value


def _slug(field: str, value: Any, path: str, cls: Optional[str] = None) -> str:
    regex = SLUGS.get(field)
    if not isinstance(value, str) or regex is None or not regex.fullmatch(value):
        raise InvalidPackage(Finding("G002_TYPE_OR_RANGE", path, cls))
    _safe_string(value, path, cls)
    return value


def _safe_string(value: str, path: str, cls: Optional[str] = None) -> None:
    if any(ch.isspace() or ord(ch) < 32 for ch in value):
        raise InvalidPackage(Finding("G002_FORBIDDEN_VALUE_SHAPE", path, cls))
    if any(marker in value for marker in FORBIDDEN_MARKERS) or JWT.fullmatch(value) or value.endswith("="):
        raise InvalidPackage(Finding("G002_FORBIDDEN_VALUE_SHAPE", path, cls))
    if "/" in value or "\\" in value or "://" in value:
        raise InvalidPackage(Finding("G002_FORBIDDEN_VALUE_SHAPE", path, cls))


def _time(value: Any, path: str, cls: Optional[str] = None) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise InvalidPackage(Finding("G002_TIME_INVALID", path, cls))
    try:
        return datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise InvalidPackage(Finding("G002_TIME_INVALID", path, cls)) from exc


def _filename(value: Any, path: str) -> str:
    if not isinstance(value, str) or not FILENAME.fullmatch(value) or value in {".", ".."} or ":" in value:
        raise InvalidPackage(Finding("G002_PATH_INVALID", path))
    return value


def _policy() -> tuple[dict[str, Any], str]:
    try:
        raw = POLICY_PATH.read_bytes()
        value = parse_json(raw, "policy")
    except (OSError, InvalidPackage) as exc:
        raise InvalidPackage(Finding("G002_POLICY_INVALID", "policy")) from exc
    if value != POLICY:
        raise InvalidPackage(Finding("G002_POLICY_INVALID", "policy"))
    return value, hashlib.sha256(raw).hexdigest()


def _safe_primitives() -> None:
    if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_CLOEXEC") or os.open not in os.supports_dir_fd:
        raise InvalidPackage(Finding("G002_PLATFORM_UNSAFE_OPEN", "$"))


def _read_fd(dir_fd: int, name: str, max_bytes: int, total: list[int]) -> tuple[bytes, os.stat_result]:
    _safe_primitives()
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC
    try:
        fd = os.open(name, flags, dir_fd=dir_fd)
    except OSError as exc:
        raise InvalidPackage(Finding("G002_FILE_UNSAFE", name)) from exc
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > max_bytes:
            raise InvalidPackage(Finding("G002_FILE_UNSAFE", name))
        raw = b""
        while len(raw) <= before.st_size:
            chunk = os.read(fd, min(65536, before.st_size + 1 - len(raw)))
            if not chunk:
                break
            raw += chunk
            if len(raw) > max_bytes:
                raise InvalidPackage(Finding("G002_LIMIT_EXCEEDED", name))
        after = os.fstat(fd)
        if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns) != (
            after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns
        ) or len(raw) != before.st_size:
            raise InvalidPackage(Finding("G002_FILE_CHANGED", name))
        total[0] += len(raw)
        return raw, before
    finally:
        os.close(fd)


def _inventory(value: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    _exact(value, {"schemaVersion", "packageId", "synthetic", "nonEvidenceLabel", "actionBinding", "entries"}, "inventory")
    if value["schemaVersion"] != 1:
        raise InvalidPackage(Finding("G002_TYPE_OR_RANGE", "inventory.schemaVersion"))
    _slug("packageId", value["packageId"], "inventory.packageId")
    if not isinstance(value["synthetic"], bool):
        raise InvalidPackage(Finding("G002_TYPE_OR_RANGE", "inventory.synthetic"))
    if value["synthetic"]:
        if value["nonEvidenceLabel"] != SYNTHETIC_LABEL:
            raise InvalidPackage(Finding("G002_SYNTHETIC_NON_EVIDENCE", "inventory.nonEvidenceLabel"))
    elif value["nonEvidenceLabel"] is not None:
        raise InvalidPackage(Finding("G002_SCHEMA_FIELD", "inventory.nonEvidenceLabel"))
    binding = value["actionBinding"]
    if not isinstance(binding, dict):
        raise InvalidPackage(Finding("G002_SCHEMA_FIELD", "inventory.actionBinding"))
    _exact(binding, {"actionId", "requestDigest", "subjectDigest", "targetId", "audience", "requiredScopes", "notBefore", "expiresAt"}, "inventory.actionBinding")
    _slug("actionId", binding["actionId"], "inventory.actionBinding.actionId")
    _slug("targetId", binding["targetId"], "inventory.actionBinding.targetId")
    _hex(binding["requestDigest"], "inventory.actionBinding.requestDigest")
    _hex(binding["subjectDigest"], "inventory.actionBinding.subjectDigest")
    if binding["audience"] != POLICY["audience"] or binding["requiredScopes"] != POLICY["requiredScopes"]:
        raise InvalidPackage(Finding("G002_SCOPE_INVALID", "inventory.actionBinding"))
    start, end = _time(binding["notBefore"], "inventory.actionBinding.notBefore"), _time(binding["expiresAt"], "inventory.actionBinding.expiresAt")
    if not start < end or (end - start).total_seconds() > POLICY["authorizationWindowSeconds"]:
        raise InvalidPackage(Finding("G002_TIME_INVALID", "inventory.actionBinding"))
    entries = value["entries"]
    if not isinstance(entries, list) or len(entries) != 5:
        raise InvalidPackage(Finding("G002_CLASS_SET", "inventory.entries"))
    classes: list[str] = []
    paths: list[str] = []
    for index, row in enumerate(entries):
        if not isinstance(row, dict):
            raise InvalidPackage(Finding("G002_SCHEMA_FIELD", f"inventory.entries[{index}]"))
        _exact(row, {"class", "path", "sha256", "sizeBytes"}, f"inventory.entries[{index}]")
        classes.append(row["class"])
        paths.append(_filename(row["path"], f"inventory.entries[{index}].path"))
        _hex(row["sha256"], f"inventory.entries[{index}].sha256")
        if not isinstance(row["sizeBytes"], int) or isinstance(row["sizeBytes"], bool) or row["sizeBytes"] < 1:
            raise InvalidPackage(Finding("G002_TYPE_OR_RANGE", f"inventory.entries[{index}].sizeBytes"))
    if classes != POLICY["canonicalClasses"] or len(set(paths)) != 5 or INVENTORY_NAME in paths:
        raise InvalidPackage(Finding("G002_CLASS_SET", "inventory.entries"))
    return binding, entries


def _common(doc: dict[str, Any], cls: str, package_id: str, binding: dict[str, Any]) -> None:
    _exact(doc, COMMON_KEYS | CLASS_KEYS[cls], cls, cls)
    if doc["schemaVersion"] != 1 or doc["class"] != cls or doc["packageId"] != package_id:
        raise InvalidPackage(Finding("G002_BINDING_MISMATCH", cls, cls))
    for field in ("actionId", "requestDigest", "subjectDigest", "targetId"):
        if doc[field] != binding[field]:
            raise InvalidPackage(Finding("G002_BINDING_MISMATCH", f"{cls}.{field}", cls))
    issued = _time(doc["issuedAt"], f"{cls}.issuedAt", cls)
    window_start = _time(binding["notBefore"], "binding.notBefore")
    window_end = _time(binding["expiresAt"], "binding.expiresAt")
    if not window_start <= issued <= window_end:
        raise InvalidPackage(Finding("G002_TIME_INVALID", f"{cls}.issuedAt", cls))


def _doc(doc: dict[str, Any], cls: str, package_id: str, binding: dict[str, Any], file_digests: set[str]) -> dict[str, Any]:
    _common(doc, cls, package_id, binding)
    if cls == "outside_rooted_signature_key_registry":
        for field in ("rootReferenceId", "keyId"):
            _slug(field, doc[field], f"{cls}.{field}", cls)
        for field in ("rootFingerprint", "registrySnapshotDigest", "signedSubjectDigest", "verifierReceiptDigest"):
            _hex(doc[field], f"{cls}.{field}", cls)
        if doc["rootReferenceType"] not in POLICY["rootReferenceTypes"] or doc["keyStatus"] not in POLICY["keyStatuses"] or doc["algorithm"] not in POLICY["algorithms"]["signature"]:
            raise InvalidPackage(Finding("G002_TYPE_OR_RANGE", cls, cls))
        if doc["signedSubjectDigest"] != binding["subjectDigest"]:
            raise InvalidPackage(Finding("G002_BINDING_MISMATCH", f"{cls}.signedSubjectDigest", cls))
        if doc["rootFingerprint"] in file_digests:
            raise InvalidPackage(Finding("G002_ROOT_EMBEDDED", f"{cls}.rootFingerprint", cls))
        return {"externalRootReferenceUnverified": True}
    if cls == "hmac_verifier_provisioning":
        for field in ("verifierId", "keyReferenceId", "keyProviderReferenceId"):
            _slug(field, doc[field], f"{cls}.{field}", cls)
        for field in ("verifiedSubjectDigest", "verifierReceiptDigest"):
            _hex(doc[field], f"{cls}.{field}", cls)
        if not isinstance(doc["verifierVersion"], int) or isinstance(doc["verifierVersion"], bool) or not 1 <= doc["verifierVersion"] <= 65535:
            raise InvalidPackage(Finding("G002_TYPE_OR_RANGE", f"{cls}.verifierVersion", cls))
        if doc["algorithm"] not in POLICY["algorithms"]["hmac"] or doc["verificationOutcome"] != "claimed_verified" or doc["keyMaterialIncluded"] is not False or doc["verifiedSubjectDigest"] != binding["subjectDigest"]:
            raise InvalidPackage(Finding("G002_BINDING_MISMATCH", cls, cls))
        return {"hmacVerificationClaimUnverified": True}
    if cls == "target_stack_measurement":
        for field in ("providerId", "deploymentId", "environmentId", "attestationReferenceId"):
            _slug(field, doc[field], f"{cls}.{field}", cls)
        comps = doc["componentDigests"]
        if not isinstance(comps, dict) or not 1 <= len(comps) <= 32:
            raise InvalidPackage(Finding("G002_TYPE_OR_RANGE", f"{cls}.componentDigests", cls))
        for name, digest in comps.items():
            if not COMPONENT.fullmatch(name):
                raise InvalidPackage(Finding("G002_TYPE_OR_RANGE", f"{cls}.componentDigests", cls))
            _hex(digest, f"{cls}.componentDigests.{name}", cls)
        if doc["targetClass"] not in POLICY["targetClasses"] or doc["measurementMechanism"] not in {"provider_attestation", "measured_boot_receipt", "signed_build_manifest"}:
            raise InvalidPackage(Finding("G002_LOCAL_TARGET", cls, cls))
        _hex(doc["attestationDigest"], f"{cls}.attestationDigest", cls)
        captured = _time(doc["capturedAt"], f"{cls}.capturedAt", cls)
        if not _time(binding["notBefore"], "binding.notBefore") <= captured <= _time(binding["expiresAt"], "binding.expiresAt"):
            raise InvalidPackage(Finding("G002_TIME_INVALID", f"{cls}.capturedAt", cls))
        return {"targetMeasurementClaimUnverified": True}
    if cls == "induced_event_durability_receipt":
        for field in ("eventId", "durableStoreId", "recordId", "observerReferenceId"):
            _slug(field, doc[field], f"{cls}.{field}", cls)
        if doc["eventType"] not in {"process_crash", "service_restart", "filesystem_sync", "power_loss"}:
            raise InvalidPackage(Finding("G002_TYPE_OR_RANGE", f"{cls}.eventType", cls))
        if doc["simulation"] is not False or doc["replay"] is not False:
            raise InvalidPackage(Finding("G002_SIMULATION", cls, cls))
        accepted, committed, observed = (_time(doc[field], f"{cls}.{field}", cls) for field in ("acceptedAt", "committedAt", "observedAt"))
        window_start, window_end = _time(binding["notBefore"], "binding.notBefore"), _time(binding["expiresAt"], "binding.expiresAt")
        if not (window_start <= accepted <= committed < observed <= window_end):
            raise InvalidPackage(Finding("G002_TIME_INVALID", cls, cls))
        _hex(doc["observationReceiptDigest"], f"{cls}.observationReceiptDigest", cls)
        return {"durabilityChronologyClaimUnverified": True}
    if cls == "authorization_scope_issuer":
        for field in ("issuerReferenceId", "principalId"):
            _slug(field, doc[field], f"{cls}.{field}", cls)
        if doc["audience"] != POLICY["audience"] or doc["grantedScopes"] != POLICY["requiredScopes"]:
            raise InvalidPackage(Finding("G002_SCOPE_INVALID", cls, cls))
        issued, expires = _time(doc["issuedAt"], f"{cls}.issuedAt", cls), _time(doc["expiresAt"], f"{cls}.expiresAt", cls)
        if not (issued <= _time(binding["notBefore"], "binding.notBefore") and expires >= _time(binding["expiresAt"], "binding.expiresAt")):
            raise InvalidPackage(Finding("G002_TIME_INVALID", cls, cls))
        for field in ("authorizationFingerprint", "authorizationReceiptDigest"):
            _hex(doc[field], f"{cls}.{field}", cls)
        return {"authorizationClaimUnverified": True}
    raise InvalidPackage(Finding("G002_CLASS_SET", cls, cls))


def _report(status: str, policy_digest: Optional[str], package_id: Optional[str], synthetic: Optional[bool], findings: list[Finding], class_results: list[dict[str, Any]], files_seen: int, checked_at: Optional[str]) -> dict[str, Any]:
    rows = [item.row() for item in findings]
    rank = {name: index for index, name in enumerate(POLICY["canonicalClasses"])}
    rows.sort(key=lambda row: (rank.get(row["class"], 99), row["code"], row["path"], row["message"]))
    limit = POLICY["limits"]["maxDiagnostics"]
    if len(rows) > limit:
        rows = rows[:limit] + [Finding("G002_DIAGNOSTICS_TRUNCATED", "$", severity="warning").row()]
    payload: dict[str, Any] = {
        "schemaVersion": 1,
        "status": status,
        "terminal": TERMINAL,
        "satisfies": [],
        "doesNotCompleteOrUnblock": DOES_NOT_UNBLOCK,
        "policy": None if policy_digest is None else {"policyId": POLICY["policyId"], "policyVersion": 1, "sha256": policy_digest, "canEstablishAuthenticity": False},
        "packageId": package_id,
        "synthetic": synthetic,
        "counts": {"filesSeen": files_seen, "classesPresent": len(class_results), "errors": sum(row["severity"] == "error" for row in rows), "warnings": sum(row["severity"] == "warning" for row in rows)},
        "classResults": class_results,
        "diagnostics": rows,
        "limitations": [
            "no cryptographic verification or external root resolution was performed",
            "no issuer authorization, protected target, or durability truth was established",
            "this result cannot complete or unblock G002, G003, or the aggregate",
        ],
    }
    if checked_at is not None:
        _time(checked_at, "checkedAt")
        payload["checkedAt"] = checked_at
    return payload


def verify(inbox: Path, *, max_files: int, max_file_bytes: int, max_total_bytes: int, checked_at: Optional[str] = None) -> tuple[dict[str, Any], int]:
    policy_digest: Optional[str] = None
    try:
        _, policy_digest = _policy()
    except InvalidPackage as exc:
        return _report("invalid", None, None, None, [exc.finding], [], 0, checked_at), 2
    if not inbox.exists():
        finding = Finding("G002_EMPTY_INBOX", "$", severity="info")
        return _report("empty", policy_digest, None, None, [finding], [], 0, checked_at), 1
    try:
        _safe_primitives()
        dir_flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | os.O_NOFOLLOW | os.O_CLOEXEC
        dir_fd = os.open(inbox, dir_flags)
        if not stat.S_ISDIR(os.fstat(dir_fd).st_mode):
            os.close(dir_fd)
            raise OSError("inbox is not a directory")
    except (OSError, InvalidPackage):
        finding = Finding("G002_FILE_UNSAFE", "$", severity="error")
        return _report("invalid", policy_digest, None, None, [finding], [], 0, checked_at), 2
    try:
        names = sorted(os.listdir(dir_fd))
        if not names:
            finding = Finding("G002_EMPTY_INBOX", "$", severity="info")
            return _report("empty", policy_digest, None, None, [finding], [], 0, checked_at), 1
        if len(names) > max_files:
            raise InvalidPackage(Finding("G002_LIMIT_EXCEEDED", "$"))
        if INVENTORY_NAME not in names:
            raise InvalidPackage(Finding("G002_INVENTORY_MISSING", INVENTORY_NAME))
        total = [0]
        raw_inventory, _ = _read_fd(dir_fd, INVENTORY_NAME, max_file_bytes, total)
        if total[0] > max_total_bytes:
            raise InvalidPackage(Finding("G002_LIMIT_EXCEEDED", "$"))
        inventory = parse_json(raw_inventory, INVENTORY_NAME)
        binding, entries = _inventory(inventory)
        expected = sorted([INVENTORY_NAME, *[row["path"] for row in entries]])
        if names != expected:
            raise InvalidPackage(Finding("G002_FILESET_MISMATCH", "$"))
        docs: list[tuple[str, dict[str, Any], str]] = []
        for row in entries:
            raw, _ = _read_fd(dir_fd, row["path"], max_file_bytes, total)
            if total[0] > max_total_bytes:
                raise InvalidPackage(Finding("G002_LIMIT_EXCEEDED", "$"))
            digest = hashlib.sha256(raw).hexdigest()
            if digest != row["sha256"] or len(raw) != row["sizeBytes"]:
                raise InvalidPackage(Finding("G002_DIGEST_OR_SIZE", row["path"], row["class"]))
            docs.append((row["class"], parse_json(raw, row["path"]), digest))
        file_digests = {hashlib.sha256(raw_inventory).hexdigest(), *[digest for _, _, digest in docs]}
        results = []
        for cls, doc, _ in docs:
            detail = _doc(doc, cls, inventory["packageId"], binding, file_digests)
            results.append({"class": cls, "status": "locally_consistent_unverified", **detail})
        if inventory["synthetic"]:
            raise InvalidPackage(Finding("G002_SYNTHETIC_NON_EVIDENCE", "inventory.synthetic"))
        report = _report("locally_consistent_unverified", policy_digest, inventory["packageId"], False, [], results, len(names), checked_at)
        return report, 1
    except InvalidPackage as exc:
        return _report("invalid", policy_digest, None, None, [exc.finding], [], len(names) if "names" in locals() else 0, checked_at), 2
    finally:
        os.close(dir_fd)


def _encode(payload: dict[str, Any]) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def _bounded_int(minimum: int, maximum: int):
    def parse(value: str) -> int:
        try:
            parsed = int(value)
        except ValueError as exc:
            raise argparse.ArgumentTypeError("expected integer") from exc
        if not minimum <= parsed <= maximum:
            raise argparse.ArgumentTypeError(f"expected {minimum}..{maximum}")
        return parsed
    return parse


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Structurally validate a G002 external package without establishing authenticity")
    parser.add_argument("--inbox", required=True)
    parser.add_argument("--inventory", default=INVENTORY_NAME, choices=[INVENTORY_NAME])
    parser.add_argument("--output", default="")
    parser.add_argument("--max-files", type=_bounded_int(6, 64), default=32)
    parser.add_argument("--max-file-bytes", type=_bounded_int(1, 4194304), default=1048576)
    parser.add_argument("--max-total-bytes", type=_bounded_int(1, 16777216), default=8388608)
    parser.add_argument("--checked-at", default=None)
    args = parser.parse_args(argv)
    inbox = Path(args.inbox)
    if args.output:
        output = Path(args.output)
        try:
            if output.resolve(strict=False).is_relative_to(inbox.resolve(strict=False)):
                raise OSError("output inside inbox")
        except (OSError, RuntimeError):
            payload = _report("invalid", None, None, None, [Finding("G002_OUTPUT_FAILURE", "output")], [], 0, args.checked_at)
            sys.stdout.buffer.write(_encode(payload))
            return 2
    payload, code = verify(inbox, max_files=args.max_files, max_file_bytes=args.max_file_bytes, max_total_bytes=args.max_total_bytes, checked_at=args.checked_at)
    encoded = _encode(payload)
    if not args.output:
        sys.stdout.buffer.write(encoded)
        return code
    try:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(args.output, flags, 0o600)
        try:
            os.write(fd, encoded)
            os.fsync(fd)
        finally:
            os.close(fd)
    except OSError:
        failure = _report("invalid", payload.get("policy", {}).get("sha256") if isinstance(payload.get("policy"), dict) else None, payload.get("packageId"), payload.get("synthetic"), [Finding("G002_OUTPUT_FAILURE", "output")], [], 0, args.checked_at)
        sys.stdout.buffer.write(_encode(failure))
        return 2
    return code


if __name__ == "__main__":
    raise SystemExit(main())
