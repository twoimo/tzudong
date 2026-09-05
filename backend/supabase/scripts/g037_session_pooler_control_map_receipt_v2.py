#!/usr/bin/env python3
"""Validate one sanitized G037 Connect-dialog control-map v2 receipt."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import stat
import sys
import uuid
from pathlib import Path


SCHEMA = "g037-session-pooler-control-map-receipt-v2"
VERIFIER_SCHEMA = "g037-session-pooler-control-map-receipt-verifier-v2"
REQUEST_SHA256 = "e74e85936b4d44776ffacf878a65604c03e91ac03b91f4416090ed5efecd0a08"
BROWSER_SOURCE_SHA256 = "a07dd10e07c0cd0a1db050230206b6e5ebfd4402c172556d1a159b571e3044bc"
PRIOR_ATTEMPT_SHA256 = "9bcf5eec76211f11113172b08a1133a67a9824d77874212d6a57c0254dce669c"
MAX_RECEIPT_BYTES = 8_192
HEX64 = re.compile(r"[0-9a-f]{64}")
RFC3339_UTC = re.compile(
    r"20[0-9]{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])"
    r"T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z"
)
EXPECTED_KEYS = {
    "schema",
    "status",
    "fixedCode",
    "operationId",
    "observedAt",
    "controlMapRequestSha256",
    "browserSourceSha256",
    "priorAttemptSha256",
    "observationSha256",
    "controlShapeSha256",
    "dashboardOpenCount",
    "controlSnapshotCount",
    "controlClickCount",
    "connectDialogMatched",
    "directConnectionEntryMatched",
    "directConnectionEntryClicked",
    "sessionPoolerControlIdentified",
    "metadataValueRead",
    "sessionPoolerControlClicked",
    "screenshotCaptured",
    "clipboardUsed",
    "valueBearingNodeObserved",
    "projectOverviewObserved",
    "organizationMetadataObserved",
    "rawControlTreeRetained",
    "controlNamesRetained",
    "locatorRefsRetained",
    "passwordOrCredentialRead",
    "browserStorageInspected",
    "networkHeadersInspected",
    "databaseAuthenticationAttempted",
    "sqlExecuted",
    "networkProbeExecuted",
    "persistentStateChanged",
}
TRUE_KEYS = {
    "connectDialogMatched",
    "directConnectionEntryMatched",
    "directConnectionEntryClicked",
    "sessionPoolerControlIdentified",
}
FALSE_KEYS = {
    "metadataValueRead",
    "sessionPoolerControlClicked",
    "screenshotCaptured",
    "clipboardUsed",
    "valueBearingNodeObserved",
    "projectOverviewObserved",
    "organizationMetadataObserved",
    "rawControlTreeRetained",
    "controlNamesRetained",
    "locatorRefsRetained",
    "passwordOrCredentialRead",
    "browserStorageInspected",
    "networkHeadersInspected",
    "databaseAuthenticationAttempted",
    "sqlExecuted",
    "networkProbeExecuted",
    "persistentStateChanged",
}
EXPECTED_COUNTS = {
    "dashboardOpenCount": 1,
    "controlSnapshotCount": 2,
    "controlClickCount": 1,
}


class ReceiptError(Exception):
    """A deliberately detail-free receipt denial."""


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
        + "\n"
    ).encode("ascii")


def emit(value: dict[str, object]) -> None:
    sys.stdout.buffer.write(canonical_bytes(value))


def fixed_result(
    status: str, fixed_code: str, receipt_sha256: str | None = None
) -> dict[str, object]:
    result: dict[str, object] = {
        "schema": VERIFIER_SCHEMA,
        "status": status,
        "fixedCode": fixed_code,
        "metadataValueRead": False,
        "credentialUsed": False,
        "databaseAuthenticationAttempted": False,
        "sqlExecuted": False,
        "networkAccessed": False,
        "persistentStateChanged": False,
    }
    if receipt_sha256 is not None:
        result["receiptSha256"] = receipt_sha256
    return result


def secure_receipt_bytes(path_value: str) -> bytes:
    path = Path(path_value)
    if not path.is_absolute() or path.is_symlink():
        raise ReceiptError
    try:
        metadata = path.stat()
    except OSError as exc:
        raise ReceiptError from exc
    if not stat.S_ISREG(metadata.st_mode) or stat.S_IMODE(metadata.st_mode) & 0o077:
        raise ReceiptError
    if metadata.st_size <= 0 or metadata.st_size > MAX_RECEIPT_BYTES:
        raise ReceiptError
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise ReceiptError from exc
    if len(data) != metadata.st_size:
        raise ReceiptError
    return data


def valid_operation_id(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parsed = uuid.UUID(value)
    except (ValueError, AttributeError):
        return False
    return parsed.version == 4 and str(parsed) == value


def verify_receipt(data: bytes) -> str:
    try:
        receipt = json.loads(data)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ReceiptError from exc
    if not isinstance(receipt, dict) or set(receipt) != EXPECTED_KEYS:
        raise ReceiptError
    if canonical_bytes(receipt) != data:
        raise ReceiptError
    if receipt["schema"] != SCHEMA or receipt["status"] != "ready":
        raise ReceiptError
    if receipt["fixedCode"] != "g037_session_pooler_control_map_v2_ready":
        raise ReceiptError
    if receipt["controlMapRequestSha256"] != REQUEST_SHA256:
        raise ReceiptError
    if receipt["browserSourceSha256"] != BROWSER_SOURCE_SHA256:
        raise ReceiptError
    if receipt["priorAttemptSha256"] != PRIOR_ATTEMPT_SHA256:
        raise ReceiptError
    if not valid_operation_id(receipt["operationId"]):
        raise ReceiptError
    if not isinstance(receipt["observedAt"], str) or not RFC3339_UTC.fullmatch(
        receipt["observedAt"]
    ):
        raise ReceiptError
    for key in ("observationSha256", "controlShapeSha256"):
        if not isinstance(receipt[key], str) or not HEX64.fullmatch(receipt[key]):
            raise ReceiptError
        if receipt[key] == "0" * 64:
            raise ReceiptError
    if any(receipt[key] is not True for key in TRUE_KEYS):
        raise ReceiptError
    if any(receipt[key] is not False for key in FALSE_KEYS):
        raise ReceiptError
    if any(receipt[key] != value for key, value in EXPECTED_COUNTS.items()):
        raise ReceiptError
    return hashlib.sha256(data).hexdigest()


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser()
    result.add_argument("mode", choices=("validate", "verify"))
    result.add_argument("--receipt-file")
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    if args.mode == "validate":
        if args.receipt_file is not None:
            emit(fixed_result("denied", "g037_session_pooler_control_map_v2_argument_denied"))
            return 2
        emit(fixed_result("valid", "g037_session_pooler_control_map_v2_source_valid"))
        return 0
    if args.receipt_file is None:
        emit(fixed_result("denied", "g037_session_pooler_control_map_v2_argument_denied"))
        return 2
    try:
        digest = verify_receipt(secure_receipt_bytes(args.receipt_file))
    except ReceiptError:
        emit(fixed_result("denied", "g037_session_pooler_control_map_v2_receipt_denied"))
        return 2
    emit(fixed_result("ready", "g037_session_pooler_control_map_v2_receipt_ready", digest))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
