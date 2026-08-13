#!/usr/bin/env python3
"""Persist one bounded, row-free local-nightly lifecycle stage receipt."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
from typing import Final


SCHEMA: Final = "nightly-lifecycle-stage-v1"
MAX_RECEIPT_BYTES: Final = 1024
OUTPUT_RELATIVE_PATH: Final = Path(
    "nightly-artifacts/failure-diagnostics/local-lifecycle-stage.json"
)
UPLOAD_RELATIVE_PATH: Final = Path(
    "nightly-artifacts/validated-failure-diagnostics/local-lifecycle-stage.json"
)
STAGES: Final = (
    "prerequisite_verify",
    "manifest",
    "source_verify",
    "prerequisite_apply",
    "migration_apply",
    "closure_generate",
    "closure_apply",
    "closure_rescan",
    "closure_smoke",
    "seed",
    "schema_convergence",
    "profile_read",
    "profile_leaderboard",
    "profile_mutation",
    "receipt",
)
STATUSES: Final = frozenset({"running", "passed", "failed"})
RECEIPT_FIELDS: Final = frozenset(
    {
        "attempt_count",
        "exit_code",
        "failure_class",
        "schema",
        "stage",
        "stage_index",
        "status",
    }
)


class LifecycleReceiptError(RuntimeError):
    """A fixed-diagnostic lifecycle receipt contract failure."""


class FixedArgumentParser(argparse.ArgumentParser):
    """Reject invalid fixed workflow arguments without echoing their values."""

    def error(self, message: str) -> None:  # noqa: ARG002 - argparse callback contract
        raise LifecycleReceiptError("arguments_invalid")


def build_receipt(
    *, stage_index: int, stage: str, status: str, exit_code: int | None
) -> dict[str, object]:
    if (
        not isinstance(stage, str)
        or type(stage_index) is not int
        or stage not in STAGES
        or stage_index != STAGES.index(stage) + 1
    ):
        raise LifecycleReceiptError("stage_mismatch")
    if not isinstance(status, str) or status not in STATUSES:
        raise LifecycleReceiptError("status_invalid")
    if status == "running":
        if exit_code is not None:
            raise LifecycleReceiptError("running_exit_code_invalid")
        failure_class = "none"
    elif status == "passed":
        if type(exit_code) is not int or exit_code != 0:
            raise LifecycleReceiptError("passed_exit_code_invalid")
        failure_class = "none"
    else:
        if type(exit_code) is not int or not 1 <= exit_code <= 255:
            raise LifecycleReceiptError("failed_exit_code_invalid")
        if exit_code == 124:
            failure_class = "timeout"
        elif exit_code >= 128:
            failure_class = "signal"
        else:
            failure_class = "command_failed"
    receipt: dict[str, object] = {
        "schema": SCHEMA,
        "stage_index": stage_index,
        "stage": stage,
        "status": status,
        "exit_code": exit_code,
        "failure_class": failure_class,
        "attempt_count": 1,
    }
    if frozenset(receipt) != RECEIPT_FIELDS:
        raise LifecycleReceiptError("receipt_fields_invalid")
    return receipt


def _validate_directory(path: Path) -> None:
    info = path.lstat()
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISDIR(info.st_mode)
        or info.st_uid != os.getuid()
        or stat.S_IMODE(info.st_mode) != 0o700
    ):
        raise LifecycleReceiptError("directory_custody_invalid")


def _prepare_directory(path: Path, *, create: bool) -> None:
    if path.exists() or path.is_symlink():
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
            raise LifecycleReceiptError("directory_custody_invalid")
        path.chmod(0o700)
    elif create:
        path.mkdir(mode=0o700)
    else:
        raise LifecycleReceiptError("directory_missing")
    _validate_directory(path)


def _validate_regular_file(info: os.stat_result, *, size_limit: int) -> None:
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid != os.getuid()
        or stat.S_IMODE(info.st_mode) != 0o600
        or info.st_nlink != 1
        or info.st_size > size_limit
    ):
        raise LifecycleReceiptError("receipt_custody_invalid")


def _validate_existing_target(path: Path) -> None:
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode):
        raise LifecycleReceiptError("receipt_custody_invalid")
    _validate_regular_file(info, size_limit=MAX_RECEIPT_BYTES)


def _validate_receipt(receipt: dict[str, object]) -> None:
    if not isinstance(receipt, dict) or frozenset(receipt) != RECEIPT_FIELDS:
        raise LifecycleReceiptError("receipt_fields_invalid")
    expected = build_receipt(
        stage_index=receipt["stage_index"],  # type: ignore[arg-type]
        stage=receipt["stage"],  # type: ignore[arg-type]
        status=receipt["status"],  # type: ignore[arg-type]
        exit_code=receipt["exit_code"],  # type: ignore[arg-type]
    )
    if receipt != expected:
        raise LifecycleReceiptError("receipt_values_invalid")


def _readback_target(path: Path) -> bytes:
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        _validate_regular_file(os.fstat(descriptor), size_limit=MAX_RECEIPT_BYTES)
        chunks: list[bytes] = []
        remaining = MAX_RECEIPT_BYTES + 1
        while remaining:
            chunk = os.read(descriptor, remaining)
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)
    finally:
        os.close(descriptor)


def _fsync_directory(path: Path) -> None:
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
            raise LifecycleReceiptError("directory_custody_invalid")
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_receipt(diagnostics_root: Path, receipt: dict[str, object]) -> Path:
    _validate_receipt(receipt)
    artifacts_root = diagnostics_root.parent
    _prepare_directory(artifacts_root, create=False)
    _prepare_directory(diagnostics_root, create=True)

    target = diagnostics_root / OUTPUT_RELATIVE_PATH.name
    if target.exists() or target.is_symlink():
        _validate_existing_target(target)
    payload = json.dumps(receipt, sort_keys=True, separators=(",", ":")).encode("utf-8") + b"\n"
    if len(payload) > MAX_RECEIPT_BYTES:
        raise LifecycleReceiptError("receipt_size_invalid")

    descriptor, temporary_name = tempfile.mkstemp(
        prefix=".local-lifecycle-stage-",
        dir=diagnostics_root,
    )
    temporary = Path(temporary_name)
    descriptor_open = True
    try:
        os.fchmod(descriptor, 0o600)
        written = 0
        while written < len(payload):
            written += os.write(descriptor, payload[written:])
        os.fsync(descriptor)
        _validate_regular_file(os.fstat(descriptor), size_limit=MAX_RECEIPT_BYTES)
        os.close(descriptor)
        descriptor_open = False
        os.replace(temporary, target)
        _fsync_directory(diagnostics_root)
    finally:
        if descriptor_open:
            os.close(descriptor)
        if temporary.exists() or temporary.is_symlink():
            temporary.unlink()

    if _readback_target(target) != payload:
        raise LifecycleReceiptError("receipt_readback_failed")
    return target


def _decode_canonical_receipt(payload: bytes) -> dict[str, object]:
    if not payload or len(payload) > MAX_RECEIPT_BYTES:
        raise LifecycleReceiptError("receipt_size_invalid")
    try:
        decoded = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise LifecycleReceiptError("receipt_json_invalid") from error
    if not isinstance(decoded, dict):
        raise LifecycleReceiptError("receipt_fields_invalid")
    _validate_receipt(decoded)
    canonical = json.dumps(decoded, sort_keys=True, separators=(",", ":")).encode("utf-8") + b"\n"
    if payload != canonical:
        raise LifecycleReceiptError("receipt_encoding_invalid")
    return decoded


def prepare_upload_copy(repository_root: Path) -> Path | None:
    source = repository_root / OUTPUT_RELATIVE_PATH
    if not source.exists() and not source.is_symlink():
        return None
    _validate_directory(source.parent.parent)
    _validate_directory(source.parent)
    receipt = _decode_canonical_receipt(_readback_target(source))

    upload_root = repository_root / UPLOAD_RELATIVE_PATH.parts[0]
    _prepare_directory(upload_root, create=True)
    upload_diagnostics = upload_root / UPLOAD_RELATIVE_PATH.parts[1]
    target = write_receipt(upload_diagnostics, receipt)
    if target != repository_root / UPLOAD_RELATIVE_PATH:
        raise LifecycleReceiptError("upload_target_invalid")
    return target


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = FixedArgumentParser(add_help=False)
    parser.add_argument("--prepare-upload", action="store_true")
    parser.add_argument("--stage-index", type=int)
    parser.add_argument("--stage", choices=STAGES)
    parser.add_argument("--status", choices=sorted(STATUSES))
    parser.add_argument("--exit-code", type=int)
    args = parser.parse_args(argv)
    lifecycle_values = (args.stage_index, args.stage, args.status, args.exit_code)
    if args.prepare_upload:
        if any(value is not None for value in lifecycle_values):
            raise LifecycleReceiptError("arguments_invalid")
    elif args.stage_index is None or args.stage is None or args.status is None:
        raise LifecycleReceiptError("arguments_invalid")
    return args


def main(argv: list[str] | None = None) -> int:
    try:
        args = parse_args(sys.argv[1:] if argv is None else argv)
        if args.prepare_upload:
            target = prepare_upload_copy(Path.cwd())
            print("prepared" if target is not None else "absent")
        else:
            receipt = build_receipt(
                stage_index=args.stage_index,
                stage=args.stage,
                status=args.status,
                exit_code=args.exit_code,
            )
            write_receipt(
                Path.cwd() / OUTPUT_RELATIVE_PATH.parent,
                receipt,
            )
        return 0
    except (LifecycleReceiptError, OSError, TypeError, ValueError):
        print("nightly-lifecycle-stage: write_failed", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
