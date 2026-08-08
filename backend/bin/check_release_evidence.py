#!/usr/bin/env python3
"""Fail-closed checker for the observed G003 release-evidence artifact.

This checker validates the shape of a local observation artifact.  It does not
verify the claims in that artifact, resolve external references, or establish
legal/operator approval.  A zero exit status only means that every declared
release gate was *recorded* with status ``verified`` and a safe, non-empty
reference; authenticity remains outside this tool's authority.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Optional, Sequence

MAX_BYTES = 1_048_576
MAX_DIAGNOSTICS = 32
MAX_STRING = 1024
MAX_EVIDENCE_REFERENCE = 512

REQUIRED_EXTERNAL_GATES = (
    "privacyLegalReview",
    "retentionOperatorApprovalAndPitr",
    "hostedSupabaseCatalogRlsRpcTypesAndKeyManagement",
    "marketingProviderAndProductionCapability",
    "locationBusinessFilingOrNonApplicability",
    "under14GuardianProvider",
    "incidentNoticeApprovalAndReceipt",
    "releaseDecision",
)

ROOT_KEYS = {
    "schemaVersion",
    "kind",
    "generatedAt",
    "repository",
    "github",
    "vercel",
    "localVerification",
    "releaseGateStatus",
}
REPOSITORY_KEYS = {"name", "branch", "head", "workingTree", "push"}
GITHUB_KEYS = {"defaultBranch", "viewerPermission", "commitStatus", "commitStatusEvidence"}
VERCEL_KEYS = {
    "project",
    "projectId",
    "rootDirectory",
    "deploymentId",
    "target",
    "status",
    "aliases",
    "productionReadback",
}
LOCAL_KEYS = {
    "backendValidators",
    "backendDataContracts",
    "backendDailyRegression",
    "environmentContract",
}
GATE_STATUSES = {"verified", "not evidenced", "blocked"}
UTC_TIMESTAMP = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$")
JWT = re.compile(r"^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$")
FORBIDDEN_REFERENCE_MARKERS = (
    "-----begin",
    "private key",
    "secret",
    "credential",
    "password",
    "api_key",
    "apikey",
    "service_role",
    "access_token",
    "refresh_token",
    "authorization",
    "token",
    "bearer ",
    "cookie",
    "ghp_",
    "github_pat_",
    "sk-",
    "xoxb-",
    "AIza",
    "sb_",
)


class DuplicateKey(ValueError):
    """Raised when a JSON object repeats a key."""


class SchemaError(ValueError):
    def __init__(self, code: str, path: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.path = path
        self.message = message


def _pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise DuplicateKey(key)
        result[key] = value
    return result


def _diagnostic(code: str, path: str, message: str, *, observed_status: Optional[str] = None) -> dict[str, Any]:
    row: dict[str, Any] = {
        "code": code[:80],
        "path": path[:160],
        "message": message[:240],
    }
    if observed_status is not None:
        row["observedStatus"] = observed_status[:120]
    return row


def _report(
    status: str,
    diagnostics: list[dict[str, Any]],
    gate_statuses: Optional[dict[str, str]] = None,
    *,
    checked_path: Optional[str] = None,
) -> dict[str, Any]:
    rows = diagnostics[:MAX_DIAGNOSTICS]
    if len(diagnostics) > MAX_DIAGNOSTICS:
        rows[-1] = _diagnostic("DIAGNOSTICS_TRUNCATED", "$", "diagnostics were bounded")
    payload: dict[str, Any] = {
        "schemaVersion": 1,
        "kind": "release-evidence-check",
        "status": status,
        "allExternalGatesVerified": status == "observed_all_gates_verified",
        "productionRelease": "not certified",
        "authenticity": "not established",
        "gateStatuses": gate_statuses or {},
        "diagnostics": rows,
        "limitations": [
            "observations were checked locally; external references were not resolved",
            "this checker never establishes legal compliance, operator approval, hosted state, or authenticity",
            "code, tests, GitHub, and Vercel observations cannot substitute for an external release gate",
        ],
    }
    if checked_path is not None:
        payload["path"] = checked_path[:MAX_STRING]
    return payload


def _exact_keys(value: Any, expected: set[str], path: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SchemaError("SCHEMA_TYPE", path, "expected an object")
    keys = set(value)
    if keys != expected:
        unknown = sorted(keys - expected)
        missing = sorted(expected - keys)
        detail = []
        if unknown:
            detail.append("unknown=" + ",".join(unknown[:4]))
        if missing:
            detail.append("missing=" + ",".join(missing[:4]))
        raise SchemaError("SCHEMA_KEYS", path, "closed object keys mismatch" + (" (" + "; ".join(detail) + ")" if detail else ""))
    return value


def _string(value: Any, path: str, *, maximum: int = MAX_STRING) -> str:
    if not isinstance(value, str) or not value or len(value) > maximum or any(ord(ch) < 32 or ord(ch) == 127 for ch in value):
        raise SchemaError("SCHEMA_STRING", path, "expected a bounded non-empty printable string")
    return value


def _timestamp(value: Any, path: str) -> str:
    text = _string(value, path, maximum=40)
    if not UTC_TIMESTAMP.fullmatch(text):
        raise SchemaError("SCHEMA_TIMESTAMP", path, "expected a UTC RFC3339 timestamp")
    try:
        datetime.strptime(text.replace("Z", "+00:00"), "%Y-%m-%dT%H:%M:%S%z" if "." not in text else "%Y-%m-%dT%H:%M:%S.%f%z")
    except ValueError as exc:
        raise SchemaError("SCHEMA_TIMESTAMP", path, "invalid UTC timestamp") from exc
    return text


def _check_technical(doc: dict[str, Any]) -> None:
    _exact_keys(doc, ROOT_KEYS, "$")
    if not isinstance(doc["schemaVersion"], int) or isinstance(doc["schemaVersion"], bool) or doc["schemaVersion"] != 1:
        raise SchemaError("SCHEMA_VERSION", "schemaVersion", "expected schemaVersion 1")
    if doc["kind"] != "release-evidence":
        raise SchemaError("SCHEMA_KIND", "kind", "expected kind release-evidence")
    _timestamp(doc["generatedAt"], "generatedAt")

    repository = _exact_keys(doc["repository"], REPOSITORY_KEYS, "repository")
    for key in REPOSITORY_KEYS:
        _string(repository[key], f"repository.{key}")

    github = _exact_keys(doc["github"], GITHUB_KEYS, "github")
    for key in GITHUB_KEYS:
        _string(github[key], f"github.{key}")

    vercel = _exact_keys(doc["vercel"], VERCEL_KEYS, "vercel")
    for key in VERCEL_KEYS - {"aliases"}:
        _string(vercel[key], f"vercel.{key}")
    aliases = vercel["aliases"]
    if not isinstance(aliases, list) or not 1 <= len(aliases) <= 8:
        raise SchemaError("SCHEMA_ARRAY", "vercel.aliases", "expected one to eight aliases")
    for index, alias in enumerate(aliases):
        _string(alias, f"vercel.aliases[{index}]")

    local = _exact_keys(doc["localVerification"], LOCAL_KEYS, "localVerification")
    for key in LOCAL_KEYS:
        _string(local[key], f"localVerification.{key}")


def _safe_evidence_reference(value: Any, path: str) -> str:
    reference = _string(value, path, maximum=MAX_EVIDENCE_REFERENCE)
    if not reference.strip():
        raise SchemaError("GATE_REFERENCE_REQUIRED", path, "evidenceRef must not be blank")
    lowered = reference.lower()
    if JWT.fullmatch(reference) or any(marker.lower() in lowered for marker in FORBIDDEN_REFERENCE_MARKERS):
        raise SchemaError("EVIDENCE_REFERENCE_SECRET", path, "credentials or secrets are not evidence references")
    return reference


def _gate_observation(value: Any, gate: str) -> tuple[str, Optional[str]]:
    path = f"releaseGateStatus.{gate}"
    if isinstance(value, str):
        value = _string(value, path)
        # The checked-in observation predates the structured gate form.  Keep
        # its blocked/not-evidenced state visible, but never treat it as proof.
        if value == "not evidenced":
            return value, None
        if value == "blocked" or (gate == "releaseDecision" and value.startswith("blocked;")):
            return "blocked", None
        raise SchemaError("GATE_SHAPE", path, "verified gates require an object with evidenceRef")
    entry = _exact_keys(value, {"status", "evidenceRef"}, path)
    status = entry["status"]
    if not isinstance(status, str) or status not in GATE_STATUSES:
        raise SchemaError("GATE_STATUS", f"{path}.status", "status must be verified, not evidenced, or blocked")
    evidence_ref = entry["evidenceRef"]
    if evidence_ref is not None and not isinstance(evidence_ref, str):
        raise SchemaError("GATE_REFERENCE", f"{path}.evidenceRef", "evidenceRef must be a string or null")
    if status == "verified":
        if not evidence_ref:
            raise SchemaError("GATE_REFERENCE_REQUIRED", f"{path}.evidenceRef", "verified requires a non-empty evidenceRef")
        _safe_evidence_reference(evidence_ref, f"{path}.evidenceRef")
    elif evidence_ref:
        _safe_evidence_reference(evidence_ref, f"{path}.evidenceRef")
    return status, evidence_ref


def validate_document(doc: Any) -> tuple[dict[str, str], list[dict[str, Any]]]:
    if not isinstance(doc, dict):
        raise SchemaError("SCHEMA_TYPE", "$", "root must be an object")
    _check_technical(doc)
    gate_statuses: dict[str, str] = {}
    diagnostics: list[dict[str, Any]] = []
    gate_values = _exact_keys(doc["releaseGateStatus"], set(REQUIRED_EXTERNAL_GATES), "releaseGateStatus")
    for gate in REQUIRED_EXTERNAL_GATES:
        try:
            status, _ = _gate_observation(gate_values[gate], gate)
        except SchemaError as exc:
            # Preserve a useful blocked/not-evidenced observation even when a
            # malformed entry prevents a release decision.
            if isinstance(gate_values[gate], str):
                gate_statuses[gate] = "blocked" if gate == "releaseDecision" and gate_values[gate].startswith("blocked;") else gate_values[gate]
            diagnostics.append(_diagnostic(exc.code, exc.path, exc.message))
            continue
        gate_statuses[gate] = status
        if status != "verified":
            diagnostics.append(_diagnostic("GATE_NOT_VERIFIED", f"releaseGateStatus.{gate}", "external release gate is not verified", observed_status=status))
    return gate_statuses, diagnostics


def parse_document(raw: bytes) -> Any:
    if len(raw) > MAX_BYTES:
        raise SchemaError("INPUT_TOO_LARGE", "$", "input exceeds the bounded byte limit")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise SchemaError("JSON_INVALID", "$", "input is not valid UTF-8 JSON") from exc
    if text.startswith("\ufeff"):
        raise SchemaError("JSON_INVALID", "$", "UTF-8 BOM is not accepted")
    try:
        return json.loads(text, object_pairs_hook=_pairs, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
    except (DuplicateKey, json.JSONDecodeError, ValueError, TypeError) as exc:
        raise SchemaError("JSON_INVALID", "$", "input is malformed JSON") from exc


def check(path: Path) -> tuple[dict[str, Any], int]:
    display_path = str(path)
    try:
        if not path.is_file():
            return _report("missing", [_diagnostic("FILE_MISSING", "$", "release-evidence file does not exist")], checked_path=display_path), 1
        if path.stat().st_size > MAX_BYTES:
            return _report("invalid", [_diagnostic("INPUT_TOO_LARGE", "$", "input exceeds the bounded byte limit")], checked_path=display_path), 2
        raw = path.read_bytes()
    except OSError:
        return _report("invalid", [_diagnostic("FILE_UNREADABLE", "$", "release-evidence file could not be read")], checked_path=display_path), 2
    try:
        document = parse_document(raw)
        gate_statuses, diagnostics = validate_document(document)
    except SchemaError as exc:
        return _report("invalid", [_diagnostic(exc.code, exc.path, exc.message)], checked_path=display_path), 2
    if diagnostics:
        return _report("blocked", diagnostics, gate_statuses, checked_path=display_path), 1
    return _report("observed_all_gates_verified", [], gate_statuses, checked_path=display_path), 0


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Fail-closed check of observed G003 release evidence")
    parser.add_argument("path", nargs="?", help="release-evidence JSON path")
    parser.add_argument("--evidence", "--input", dest="evidence_path", help="release-evidence JSON path (option form)")
    args = parser.parse_args(argv)
    raw_path = args.evidence_path or args.path
    if not raw_path or (args.evidence_path and args.path):
        parser.error("provide exactly one release-evidence JSON path")
    payload, code = check(Path(raw_path))
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
