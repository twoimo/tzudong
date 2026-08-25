#!/usr/bin/env python3
"""Validate private nightly evidence and emit a row-free publication summary."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
LOCAL_MIGRATE_PATH = REPOSITORY_ROOT / "backend" / "supabase" / "scripts" / "local-migrate.py"
PUBLICATION_VERIFIER_PATH = REPOSITORY_ROOT / ".github" / "scripts" / "verify-nightly-local-publication.py"
EXPECTED_LEDGER_UNITS = 83
HEX64 = re.compile(r"[a-f0-9]{64}")
LOCAL_PROJECT = re.compile(r"tzudong-local-[a-f0-9]{12}")
SUMMARY_FIELDS = {
    "catalog_sha256",
    "closure_binding_sha256",
    "commit_sha256",
    "config_sha256",
    "environment_contract_sha256",
    "env_provenance_sha256",
    "function_source_sha256",
    "input_provenance_sha256",
    "ledger_count",
    "ledger_sha256",
    "platform_bootstrap_evidence_sha256",
    "platform_bootstrap_sha256",
    "prerequisite_sha256",
    "project_name",
    "readback_row_count",
    "readback_section_counts",
    "readback_sha256",
    "readback_sql_sha256",
    "schema",
    "seed_sha256",
    "seed_source_sha256",
    "sequence",
    "sequence_sha256",
    "service",
    "service_sha256",
    "source_chain_sha256",
    "source_manifest_sha256",
}
BOUNDARY_MARKER = b"Local-only sanitized receipts; stack.env and credentials excluded.\n"


def fail(message: str) -> None:
    raise SystemExit(message)


def canonical_json(value: object) -> bytes:
    try:
        return json.dumps(
            value,
            ensure_ascii=True,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("ascii")
    except (TypeError, ValueError, UnicodeEncodeError) as error:
        raise SystemExit("private nightly receipt was not canonical") from error


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def owned_regular_file(path: Path, label: str, *, max_bytes: int) -> Path:
    try:
        info = path.lstat()
    except OSError as error:
        raise SystemExit(f"{label} is missing") from error
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISREG(info.st_mode)
        or info.st_uid != os.getuid()
        or info.st_size <= 0
        or info.st_size > max_bytes
    ):
        fail(f"{label} custody mismatch")
    return path


def load_json(path: Path, label: str, *, max_bytes: int) -> dict[str, object]:
    path = owned_regular_file(path, label, max_bytes=max_bytes)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SystemExit(f"{label} is invalid JSON") from error
    if not isinstance(value, dict):
        fail(f"{label} is not an object")
    return value


def load_local_migrate() -> object:
    spec = importlib.util.spec_from_file_location(
        "nightly_publication_local_migrate",
        LOCAL_MIGRATE_PATH,
    )
    if spec is None or spec.loader is None:
        fail("canonical local receipt validator is unavailable")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def load_publication_verifier() -> object:
    spec = importlib.util.spec_from_file_location(
        "nightly_publication_builder_verifier",
        PUBLICATION_VERIFIER_PATH,
    )
    if spec is None or spec.loader is None:
        fail("publication verifier is unavailable")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def assert_state_root(path: Path) -> Path:
    try:
        resolved = path.resolve(strict=True)
        expected_parent = (
            REPOSITORY_ROOT / "backend" / "supabase" / "volumes" / ".local-stack"
        ).resolve(strict=True)
        resolved.relative_to(expected_parent)
        info = resolved.lstat()
    except (OSError, ValueError) as error:
        raise SystemExit("local state root is outside the canonical project state") from error
    if (
        not stat.S_ISDIR(info.st_mode)
        or stat.S_ISLNK(info.st_mode)
        or info.st_uid != os.getuid()
        or LOCAL_PROJECT.fullmatch(resolved.name) is None
    ):
        fail("local state root custody mismatch")
    return resolved


def assert_artifacts_root(path: Path) -> Path:
    try:
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
        resolved = path.resolve(strict=True)
        resolved.relative_to(REPOSITORY_ROOT.resolve(strict=True))
        info = resolved.lstat()
    except (OSError, ValueError) as error:
        raise SystemExit("nightly artifact root is unsafe") from error
    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode) or info.st_uid != os.getuid():
        fail("nightly artifact root custody mismatch")
    return resolved


def build_summary(state_root: Path) -> dict[str, object]:
    receipt_path = owned_regular_file(
        state_root / "local-receipt-v1.json",
        "private local migration receipt",
        max_bytes=2 * 1024 * 1024,
    )
    receipt = load_json(
        receipt_path,
        "private local migration receipt",
        max_bytes=2 * 1024 * 1024,
    )
    local_migrate = load_local_migrate()
    try:
        validated = local_migrate._load_receipt_file(receipt_path)
    except Exception as error:
        raise SystemExit("private local migration receipt failed canonical validation") from error
    if validated != receipt:
        fail("private local migration receipt changed during validation")

    manifest_path = owned_regular_file(
        state_root / "local-migration-manifest.json",
        "local migration manifest",
        max_bytes=256 * 1024,
    )
    manifest = load_json(
        manifest_path,
        "local migration manifest",
        max_bytes=256 * 1024,
    )
    if (
        local_migrate.verify_manifest(manifest_path) != manifest
        or receipt.get("source_manifest_sha256") != hashlib.sha256(
            canonical_json(manifest)
        ).hexdigest()
    ):
        fail("local migration manifest binding mismatch")

    readback = receipt.get("readback")
    ledger = receipt.get("ledger")
    sequence = receipt.get("sequence")
    service = receipt.get("service")
    if (
        not isinstance(readback, list)
        or not isinstance(ledger, list)
        or len(ledger) != EXPECTED_LEDGER_UNITS
        or not isinstance(sequence, list)
        or len(sequence) != 5
        or service != [["service", "150008", "UTF8", "UTC"]]
    ):
        fail("private local migration receipt summary source mismatch")
    section_counts = {section: 0 for section in local_migrate.READBACK_SECTIONS}
    for row in readback:
        if not isinstance(row, list) or not row or row[0] not in section_counts:
            fail("private local migration readback shape mismatch")
        section_counts[row[0]] += 1

    seed_path = REPOSITORY_ROOT / local_migrate.SEED_SOURCE
    if receipt.get("seed_source_sha256") != sha256_file(seed_path):
        fail("local seed source binding mismatch")
    safe_sequence = []
    for row in sequence:
        if (
            not isinstance(row, list)
            or len(row) != 5
            or row[0] != "sequence"
            or not isinstance(row[1], str)
            or type(row[2]) is not int
            or not isinstance(row[3], str)
            or HEX64.fullmatch(row[3]) is None
            or not isinstance(row[4], str)
            or HEX64.fullmatch(row[4]) is None
        ):
            fail("private local migration sequence mismatch")
        safe_sequence.append({
            "marker": row[1],
            "ordinal": row[2],
            "evidence_sha256": row[3],
            "source_manifest_sha256": row[4],
        })

    summary = {
        "schema": "local-migration-publication-summary-v1",
        "project_name": receipt["project_name"],
        "commit_sha256": receipt["commit_sha256"],
        "config_sha256": receipt["config_sha256"],
        "input_provenance_sha256": receipt["input_provenance_sha256"],
        "env_provenance_sha256": receipt["env_provenance_sha256"],
        "environment_contract_sha256": receipt["environment_contract_sha256"],
        "source_manifest_sha256": receipt["source_manifest_sha256"],
        "source_chain_sha256": receipt["source_chain_sha256"],
        "seed_source_sha256": receipt["seed_source_sha256"],
        "function_source_sha256": receipt["function_source_sha256"],
        "platform_bootstrap_evidence_sha256": receipt["platform_bootstrap_evidence_sha256"],
        "platform_bootstrap_sha256": receipt["platform_bootstrap_sha256"],
        "prerequisite_sha256": receipt["prerequisite_sha256"],
        "closure_binding_sha256": receipt["closure_binding_sha256"],
        "ledger_count": len(ledger),
        "ledger_sha256": receipt["ledger_sha256"],
        "readback_row_count": len(readback),
        "readback_section_counts": section_counts,
        "readback_sha256": receipt["readback_sha256"],
        "readback_sql_sha256": receipt["readback_sql_sha256"],
        "catalog_sha256": receipt["catalog_sha256"],
        "seed_sha256": receipt["seed_sha256"],
        "sequence": safe_sequence,
        "sequence_sha256": receipt["sequence_sha256"],
        "service": {
            "server_version_num": service[0][1],
            "server_encoding": service[0][2],
            "timezone": service[0][3],
        },
        "service_sha256": receipt["service_sha256"],
    }
    if set(summary) != SUMMARY_FIELDS:
        fail("local migration publication summary schema mismatch")
    return summary


def write_owner_only(path: Path, payload: dict[str, object]) -> None:
    body = canonical_json(payload) + b"\n"
    if len(body) > 256 * 1024:
        fail("local migration publication summary exceeds its size bound")
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        fd = os.open(path, flags, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(body)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(path, 0o600)
    except OSError as error:
        raise SystemExit("local migration publication summary write failed") from error


def write_owner_only_bytes(path: Path, body: bytes, label: str) -> None:
    if not body or len(body) > 256 * 1024:
        fail(f"{label} exceeds its size bound")
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        fd = os.open(path, flags, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(body)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(path, 0o600)
    except OSError as error:
        raise SystemExit(f"{label} write failed") from error


def copy_safe_evidence(
    state_root: Path,
    browser_source: Path,
    artifacts_root: Path,
) -> None:
    try:
        expected_browser = (
            REPOSITORY_ROOT / "apps" / "web" / "test-results"
            / "local-browser-route-diagnostics.json"
        ).resolve(strict=True)
        resolved_browser = browser_source.resolve(strict=True)
    except OSError as error:
        raise SystemExit("local browser publication evidence is missing") from error
    if resolved_browser != expected_browser:
        fail("local browser publication evidence path mismatch")

    verifier = load_publication_verifier()
    evidence = (
        (
            state_root / "local-stack-status.json",
            "local-stack-status.json",
            verifier.verify_stack_receipt,
        ),
        (
            state_root / "local-migration-manifest.json",
            "local-migration-manifest.json",
            lambda payload, _name: verifier.verify_manifest(payload),
        ),
        (
            state_root / "local-closure-rescan.json",
            "local-closure-rescan.json",
            verifier.verify_runtime_receipt,
        ),
        (
            state_root / "local-closure-smoke.json",
            "local-closure-smoke.json",
            verifier.verify_runtime_receipt,
        ),
        (
            resolved_browser,
            "local-browser-route-diagnostics.json",
            lambda payload, _name: verifier.verify_browser_diagnostics(payload),
        ),
    )
    for source, name, validator in evidence:
        payload = load_json(source, name, max_bytes=256 * 1024)
        expected_fields = verifier.EXPECTED_FIELDS[name]
        marker_key, marker_value = verifier.EXPECTED_MARKERS[name]
        if set(payload) != expected_fields or payload.get(marker_key) != marker_value:
            fail(f"safe publication evidence schema mismatch: {name}")
        validator(payload, name)
        serialized = json.dumps(payload, separators=(",", ":"))
        if (
            "[REDACTED]" in serialized
            or verifier.CREDENTIAL_VALUE.search(serialized)
        ):
            fail(f"safe publication evidence contains a credential-shaped value: {name}")
        verifier.reject_credential_fields(payload, name)
        write_owner_only(artifacts_root / name, payload)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state-root", required=True)
    parser.add_argument("--artifacts-root", required=True)
    parser.add_argument("--browser-source", required=True)
    args = parser.parse_args()
    state_root = assert_state_root(Path(args.state_root))
    artifacts_root = assert_artifacts_root(Path(args.artifacts_root))
    write_owner_only(
        artifacts_root / "local-migration-summary.json",
        build_summary(state_root),
    )
    copy_safe_evidence(
        state_root,
        Path(args.browser_source),
        artifacts_root,
    )
    write_owner_only_bytes(
        artifacts_root / "publication-boundary.txt",
        BOUNDARY_MARKER,
        "publication boundary",
    )


if __name__ == "__main__":
    main()
