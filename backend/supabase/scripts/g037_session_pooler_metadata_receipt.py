#!/usr/bin/env python3
"""Validate one sanitized, externally retained G037 pooler-metadata receipt."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import stat
import sys
import uuid
from pathlib import Path


SCHEMA = "g037-session-pooler-metadata-receipt-v1"
VERIFIER_SCHEMA = "g037-session-pooler-metadata-receipt-verifier-v1"
PREVIEW_SHA256 = "cdf4bd8f9c05eb2fd789228cdfffa563cf8b5dbf7e68f940b1c9689db8d8214e"
REQUEST_SHA256 = "f8101542b4f10bc8acaeb1bd657f7d5c0c1add9fbf30ccd456523255db9bcc22"
MAX_RECEIPT_BYTES = 8_192
HEX64 = re.compile(r"[0-9a-f]{64}")
RFC3339_UTC = re.compile(r"20[0-9]{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z")
EXPECTED_KEYS = {
    "schema",
    "status",
    "fixedCode",
    "operationId",
    "observedAt",
    "alternativePreviewSha256",
    "metadataRequestSha256",
    "hostnameSha256",
    "usernameShapeSha256",
    "projectReferenceMatched",
    "regionMatched",
    "sharedSessionModeSelected",
    "port5432Matched",
    "port6543Absent",
    "databasePostgresMatched",
    "hostnameShapeMatched",
    "usernameSuffixMatched",
    "serverRootCertificateAvailable",
    "passwordPlaceholderOnly",
    "credentialRead",
    "rawDsnRetained",
    "clipboardUsed",
    "screenshotCaptured",
    "browserStorageInspected",
    "databaseAuthenticationAttempted",
    "sqlExecuted",
    "networkProbeExecuted",
    "persistentStateChanged",
}
TRUE_KEYS = {
    "projectReferenceMatched",
    "regionMatched",
    "sharedSessionModeSelected",
    "port5432Matched",
    "port6543Absent",
    "databasePostgresMatched",
    "hostnameShapeMatched",
    "usernameSuffixMatched",
    "serverRootCertificateAvailable",
    "passwordPlaceholderOnly",
}
FALSE_KEYS = {
    "credentialRead",
    "rawDsnRetained",
    "clipboardUsed",
    "screenshotCaptured",
    "browserStorageInspected",
    "databaseAuthenticationAttempted",
    "sqlExecuted",
    "networkProbeExecuted",
    "persistentStateChanged",
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


def fixed_result(status: str, fixed_code: str, receipt_sha256: str | None = None) -> dict[str, object]:
    result: dict[str, object] = {
        "schema": VERIFIER_SCHEMA,
        "status": status,
        "fixedCode": fixed_code,
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
    if receipt["fixedCode"] != "g037_session_pooler_metadata_ready":
        raise ReceiptError
    if receipt["alternativePreviewSha256"] != PREVIEW_SHA256:
        raise ReceiptError
    if receipt["metadataRequestSha256"] != REQUEST_SHA256:
        raise ReceiptError
    if not valid_operation_id(receipt["operationId"]):
        raise ReceiptError
    if not isinstance(receipt["observedAt"], str) or not RFC3339_UTC.fullmatch(
        receipt["observedAt"]
    ):
        raise ReceiptError
    for key in ("hostnameSha256", "usernameShapeSha256"):
        if not isinstance(receipt[key], str) or not HEX64.fullmatch(receipt[key]):
            raise ReceiptError
        if receipt[key] == "0" * 64:
            raise ReceiptError
    if any(receipt[key] is not True for key in TRUE_KEYS):
        raise ReceiptError
    if any(receipt[key] is not False for key in FALSE_KEYS):
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
            emit(fixed_result("denied", "g037_session_pooler_metadata_argument_denied"))
            return 2
        emit(fixed_result("valid", "g037_session_pooler_metadata_source_valid"))
        return 0
    if args.receipt_file is None:
        emit(fixed_result("denied", "g037_session_pooler_metadata_argument_denied"))
        return 2
    try:
        digest = verify_receipt(secure_receipt_bytes(args.receipt_file))
    except ReceiptError:
        emit(fixed_result("denied", "g037_session_pooler_metadata_receipt_denied"))
        return 2
    emit(fixed_result("ready", "g037_session_pooler_metadata_receipt_ready", digest))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
