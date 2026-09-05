#!/usr/bin/env python3
"""Validate one sanitized G037 Connect-dialog control-map v3 receipt."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import stat
import sys
import uuid
from pathlib import Path


SCHEMA = "g037-session-pooler-control-map-receipt-v3"
VERIFIER_SCHEMA = "g037-session-pooler-control-map-receipt-verifier-v3"
REQUEST_SHA256 = "e0e33500d568d911412c0b0faf4fe2ecf732185655c128f25c6ae6d45c72e9b0"
BROWSER_SOURCE_SHA256 = "6dbf2915400970b6de301a2f9aed5c0736d23bc7572d8a6ec7e8e4ced3a5d96e"
STDOUT_FILTER_SHA256 = "f826640d6004d9baec9870130180fc189e75aa83b982dd14d4b44be8e1082855"
PRIOR_ATTEMPT_SHA256 = "f624f78125c1c3938053569fa27e2d547aa3796f17d621f7707f8eb47580aad5"
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
    "stdoutFilterSha256",
    "priorAttemptSha256",
    "observationSha256",
    "controlShapeSha256",
    "stageCode",
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
    "automaticTransportTitleRetained",
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
    "automaticTransportTitleRetained",
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
    if receipt["fixedCode"] != "g037_session_pooler_control_map_v3_ready":
        raise ReceiptError
    if receipt["stageCode"] != "ready":
        raise ReceiptError
    if receipt["controlMapRequestSha256"] != REQUEST_SHA256:
        raise ReceiptError
    if receipt["browserSourceSha256"] != BROWSER_SOURCE_SHA256:
        raise ReceiptError
    if receipt["stdoutFilterSha256"] != STDOUT_FILTER_SHA256:
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
            emit(fixed_result("denied", "g037_session_pooler_control_map_v3_argument_denied"))
            return 2
        emit(fixed_result("valid", "g037_session_pooler_control_map_v3_source_valid"))
        return 0
    if args.receipt_file is None:
        emit(fixed_result("denied", "g037_session_pooler_control_map_v3_argument_denied"))
        return 2
    try:
        digest = verify_receipt(secure_receipt_bytes(args.receipt_file))
    except ReceiptError:
        emit(fixed_result("denied", "g037_session_pooler_control_map_v3_receipt_denied"))
        return 2
    emit(fixed_result("ready", "g037_session_pooler_control_map_v3_receipt_ready", digest))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
