#!/usr/bin/env python3
"""Fail-closed comparison for independent G024 clean reconstruction candidates."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

SCOPE = "source-only reconstruction candidate; not historical application proof or hosted-state evidence"
SHA256 = re.compile(r"^[0-9a-f]{64}$")
ARTIFACT_MANIFEST = "artifact-manifest.txt"
SHA256SUMS = "SHA256SUMS"
CANONICAL_FILENAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
MINIMUM_ARTIFACTS = frozenset((
    "metadata.json", "migration-chain.txt", "catalog-manifest.jsonl",
    "catalog-manifest-tuples.sql", "initialization-inputs.sha256",
    "pre-20260214-overlap-classification.jsonl", "RECONSTRUCTION_SOURCES.v1.zip",
    "RECONSTRUCTION_SOURCES.v1.json", "reconstruction-source-members.tsv",
    "reconstruction-compatibility-exclusions.jsonl",
    "reconstruction-compatibility-relocations.jsonl", "evidence-scope.txt",
    "G026_RECONSTRUCTION_BUNDLE.v4.json", "G026_RECONSTRUCTION_TRANSITION.v4.sql",
    "G026_RECONSTRUCTION_REPAIRS.v4.sql", "g026-validation-ledger.json",
    "g026-semantic-receipt.json", "g026-readback-receipt.json",
    "g026-behavior-receipt.json",
))
REQUIRED_METADATA = frozenset((
    "source_sha", "migration_chain_sha256", "jsonl_sha256", "tuple_evidence_sha256",
    "declared_image", "resolved_image_id", "resolved_image_digest", "server_version",
    "storage_declared_image", "storage_index_digest", "storage_amd64_manifest_digest",
    "storage_resolved_image_id", "storage_resolved_repo_digests", "storage_inventory_sha256",
    "storage_ledger_sha256", "storage_native_source_map_sha256",
    "storage_inventory_source_map_sha256", "storage_native_file_expected_ledger_sha256",
    "storage_container_files_sha256", "gotrue_declared_image", "gotrue_index_digest",
    "gotrue_amd64_manifest_digest", "gotrue_resolved_image_id",
    "gotrue_resolved_repo_digests", "gotrue_manifest_sha256", "gotrue_inventory_sha256",
    "gotrue_ledger_sha256", "gotrue_expected_ledger_sha256",
    "gotrue_container_files_sha256", "gotrue_inventory_files_sha256",
    "psql_client_version", "partition_version", "reconstruction_archive_sha256",
    "reconstruction_manifest_sha256", "reconstruction_members_sha256",
    "reconstruction_compatibility_exclusions_sha256",
    "reconstruction_compatibility_relocations_sha256",
    "reconstruction_entries", "reconstruction_compatibility_exclusions",
    "reconstruction_compatibility_relocations", "overlap_report_sha256", "evidence_scope",
    "reconstruction_authorized", "platform_auth_inventory_sha256",
    "platform_auth_source_sha256", "platform_auth_image_sha256",
    "platform_auth_expected_ledger_sha256", "auth_expected_ledger_sha256",
    "auth_ledger_sha256", "initialization_inputs_sha256", "row_count",
    "g026_bundle_sha256", "g026_transition_sha256", "g026_repairs_sha256",
    "g026_validation_ledger_sha256", "g026_semantic_receipt_sha256",
    "g026_readback_receipt_sha256", "g026_behavior_receipt_sha256",
    "g026_slots", "g026_validation_ledger",
))
HASH_FIELDS = frozenset(name for name in REQUIRED_METADATA if name.endswith("_sha256"))
FORBIDDEN = re.compile(r"(?:https?://|\b(?:password|credential|secret|token|api[_-]?key)\b|\b(?:authorized|historical|hosted)(?:[ _-]?(?:proof|state|evidence|application))?\b)", re.I)


class ComparisonError(ValueError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise ComparisonError(f"cannot read {path.name}") from exc


def _valid_hash(value: Any, field: str) -> str:
    if not isinstance(value, str) or not SHA256.fullmatch(value):
        raise ComparisonError(f"malformed {field}")
    return value


def _reject_unsafe_entry_values(value: Any) -> None:
    if isinstance(value, dict):
        for child in value.values():
            _reject_unsafe_entry_values(child)
    elif isinstance(value, list):
        for child in value:
            _reject_unsafe_entry_values(child)
    elif isinstance(value, str) and (
        re.search(r"https?://|\b(?:password|credential|secret|token|api[_-]?key)\b", value, re.I)
        or re.search(r"(?:^[A-Za-z]:[\\/]|^/|[\\/](?:tmp|var|home|Users)[\\/])", value)
        or re.search(r"\b\d{4}-\d{2}-\d{2}[T ][0-2]\d:", value)
    ):
        raise ComparisonError("reconstruction entries contain unsafe run-local or claim data")


def _parse_manifest(path: Path) -> tuple[str, ...]:
    text = _read_text(path)
    if not text.endswith("\n"):
        raise ComparisonError("artifact manifest must end with a newline")
    names = tuple(text.splitlines())
    if (
        not names
        or any(not CANONICAL_FILENAME.fullmatch(name) or name == SHA256SUMS for name in names)
        or len(set(names)) != len(names)
        or names != tuple(sorted(names))
    ):
        raise ComparisonError("artifact manifest is not a canonical filename list")
    return names


def _parse_sums(path: Path, manifest: tuple[str, ...]) -> dict[str, str]:
    entries: dict[str, str] = {}
    names: list[str] = []
    for line in _read_text(path).splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  ([A-Za-z0-9][A-Za-z0-9._-]*)", line)
        if not match:
            raise ComparisonError("malformed SHA256SUMS")
        digest, name = match.groups()
        if name in entries:
            raise ComparisonError("duplicate SHA256SUMS entry")
        entries[name] = digest
        names.append(name)
    if tuple(names) != manifest:
        raise ComparisonError("SHA256SUMS entries are not in canonical manifest order")
    return entries


def _row_count(path: Path) -> int:
    rows = [line for line in _read_text(path).splitlines() if line.strip()]
    if not rows:
        raise ComparisonError("catalog manifest is empty")
    for line in rows:
        try:
            if not isinstance(json.loads(line), dict):
                raise ValueError
        except ValueError as exc:
            raise ComparisonError("malformed catalog JSONL") from exc
    return len(rows)


def load_candidate(directory: Path) -> dict[str, Any]:
    if not directory.is_dir():
        raise ComparisonError(f"input is not a directory: {directory}")
    manifest_path = directory / ARTIFACT_MANIFEST
    if not manifest_path.is_file() or manifest_path.is_symlink():
        raise ComparisonError("missing regular artifact manifest")
    manifest = _parse_manifest(manifest_path)
    if not MINIMUM_ARTIFACTS <= set(manifest):
        raise ComparisonError("artifact manifest omits required comparison invariants")
    expected_root = set(manifest) | {ARTIFACT_MANIFEST, SHA256SUMS}
    actual_root = set()
    for path in directory.iterdir():
        if path.is_symlink() or not path.is_file():
            raise ComparisonError("candidate root contains a directory, symlink, or nonregular entry")
        actual_root.add(path.name)
    if actual_root != expected_root:
        raise ComparisonError("candidate root entries do not exactly match artifact manifest")
    try:
        metadata = json.loads(_read_text(directory / "metadata.json"))
    except json.JSONDecodeError as exc:
        raise ComparisonError("malformed metadata.json") from exc
    if not isinstance(metadata, dict):
        raise ComparisonError("metadata.json must be an object")
    unknown = set(metadata) - REQUIRED_METADATA
    missing_keys = REQUIRED_METADATA - set(metadata)
    if unknown or missing_keys:
        raise ComparisonError("unknown or missing comparison metadata keys")
    if metadata["evidence_scope"] != SCOPE or _read_text(directory / "evidence-scope.txt").strip() != SCOPE:
        raise ComparisonError("evidence scope is not the exact reconstruction-candidate wording")
    if metadata["reconstruction_authorized"] is not False:
        raise ComparisonError("candidate must not claim authorization")
    if metadata["g026_slots"] != {
        "phaseAAfterOrdinal": 2,
        "phaseBBeforeMigration": "20260713002000_g014_public_api_private_boundary.sql",
    } or metadata["g026_validation_ledger"] != [
        {"ordinal": 0, "mode": "off", "kind": "preexisting_ordinal0_body_deferral"},
        {"ordinal": 6, "mode": "off", "kind": "g026_ordinal6_quarantine"},
    ]:
        raise ComparisonError("G026 slots or validation ledger drifted")
    for field in HASH_FIELDS:
        _valid_hash(metadata[field], field)
    if not isinstance(metadata["reconstruction_entries"], list) or not metadata["reconstruction_entries"]:
        raise ComparisonError("reconstruction_entries must be a non-empty list")
    _reject_unsafe_entry_values(metadata["reconstruction_entries"])
    for field in ("reconstruction_compatibility_exclusions", "reconstruction_compatibility_relocations"):
        if not isinstance(metadata[field], list):
            raise ComparisonError(f"{field} must be a list")
        _reject_unsafe_entry_values(metadata[field])
    if not isinstance(metadata["row_count"], int) or metadata["row_count"] <= 0:
        raise ComparisonError("row_count must be positive")
    if not re.fullmatch(r"[0-9a-f]{40}", metadata["source_sha"] if isinstance(metadata["source_sha"], str) else ""):
        raise ComparisonError("malformed source_sha")
    identity_fields = (
        "declared_image", "resolved_image_id", "resolved_image_digest", "server_version",
        "storage_declared_image", "storage_index_digest", "storage_amd64_manifest_digest",
        "storage_resolved_image_id", "storage_resolved_repo_digests", "gotrue_declared_image",
        "gotrue_index_digest", "gotrue_amd64_manifest_digest", "gotrue_resolved_image_id",
        "gotrue_resolved_repo_digests", "psql_client_version", "partition_version",
    )
    for field in identity_fields:
        value = metadata[field]
        if (
            not isinstance(value, str)
            or not value.strip()
            or FORBIDDEN.search(value)
            or re.search(r"(?:^[A-Za-z]:[\\/]|^/|[\\/](?:tmp|var|home|Users)[\\/])", value)
        ):
            raise ComparisonError(f"invalid {field}")
    text_reports = set(manifest) - {"metadata.json", "RECONSTRUCTION_SOURCES.v1.zip"}
    for name in text_reports:
        if not _read_text(directory / name).strip():
            raise ComparisonError(f"empty required report: {name}")
    if (directory / "RECONSTRUCTION_SOURCES.v1.zip").stat().st_size == 0:
        raise ComparisonError("reconstruction source archive is empty")
    # Binary archive is checked by digest and intentionally not decoded as text.
    hashes = {name: sha256_file(directory / name) for name in manifest}
    expected = _parse_sums(directory / SHA256SUMS, manifest)
    for name, digest in hashes.items():
        if expected[name] != digest:
            raise ComparisonError(f"SHA256SUMS mismatch for {name}")
    expected_hashes = {
        "migration_chain_sha256": hashes["migration-chain.txt"],
        "jsonl_sha256": hashes["catalog-manifest.jsonl"],
        "tuple_evidence_sha256": hashes["catalog-manifest-tuples.sql"],
        "initialization_inputs_sha256": hashes["initialization-inputs.sha256"],
        "reconstruction_archive_sha256": hashes["RECONSTRUCTION_SOURCES.v1.zip"],
        "reconstruction_manifest_sha256": hashes["RECONSTRUCTION_SOURCES.v1.json"],
        "reconstruction_members_sha256": hashes["reconstruction-source-members.tsv"],
        "overlap_report_sha256": hashes["pre-20260214-overlap-classification.jsonl"],
        "reconstruction_compatibility_exclusions_sha256": hashes["reconstruction-compatibility-exclusions.jsonl"],
        "reconstruction_compatibility_relocations_sha256": hashes["reconstruction-compatibility-relocations.jsonl"],
        "g026_bundle_sha256": hashes["G026_RECONSTRUCTION_BUNDLE.v4.json"],
        "g026_transition_sha256": hashes["G026_RECONSTRUCTION_TRANSITION.v4.sql"],
        "g026_repairs_sha256": hashes["G026_RECONSTRUCTION_REPAIRS.v4.sql"],
        "g026_validation_ledger_sha256": hashes["g026-validation-ledger.json"],
        "g026_semantic_receipt_sha256": hashes["g026-semantic-receipt.json"],
        "g026_readback_receipt_sha256": hashes["g026-readback-receipt.json"],
        "g026_behavior_receipt_sha256": hashes["g026-behavior-receipt.json"],
    }
    for field, digest in expected_hashes.items():
        if metadata[field] != digest:
            raise ComparisonError(f"metadata hash mismatch: {field}")
    count = _row_count(directory / "catalog-manifest.jsonl")
    if metadata["row_count"] != count:
        raise ComparisonError("catalog row count mismatch")
    overlap_rows = [line for line in _read_text(directory / "pre-20260214-overlap-classification.jsonl").splitlines() if line.strip()]
    if not overlap_rows:
        raise ComparisonError("overlap report is empty")
    for line in overlap_rows:
        try:
            if not isinstance(json.loads(line), dict):
                raise ValueError
        except ValueError as exc:
            raise ComparisonError("malformed overlap report") from exc
    manifest_bytes = manifest_path.read_bytes()
    sums_bytes = (directory / SHA256SUMS).read_bytes()
    return {
        "metadata": metadata,
        "hashes": hashes,
        "artifact_manifest": hashlib.sha256(manifest_bytes).hexdigest(),
        "artifact_manifest_bytes": manifest_bytes,
        "sha256sums": hashlib.sha256(sums_bytes).hexdigest(),
        "sha256sums_bytes": sums_bytes,
    }


def compare(left: Path, right: Path, output: Path) -> dict[str, Any]:
    left = left.resolve()
    right = right.resolve()
    output = output.resolve()
    if output.is_relative_to(left) or output.is_relative_to(right):
        raise ComparisonError("output must be outside both input directories")
    left_data, right_data = load_candidate(left), load_candidate(right)
    metadata_differences = sorted(
        key for key in REQUIRED_METADATA
        if left_data["metadata"][key] != right_data["metadata"][key]
    )
    artifact_differences = {
        key
        for key in left_data["hashes"].keys() | right_data["hashes"].keys()
        if left_data["hashes"].get(key) != right_data["hashes"].get(key)
    }
    if (
        left_data["artifact_manifest"] != right_data["artifact_manifest"]
        or left_data["artifact_manifest_bytes"] != right_data["artifact_manifest_bytes"]
    ):
        artifact_differences.add(ARTIFACT_MANIFEST)
    if (
        left_data["sha256sums"] != right_data["sha256sums"]
        or left_data["sha256sums_bytes"] != right_data["sha256sums_bytes"]
    ):
        artifact_differences.add(SHA256SUMS)
    artifact_differences = sorted(artifact_differences)
    if metadata_differences or artifact_differences:
        raise ComparisonError(
            "clean replay candidates differ: metadata="
            + ",".join(metadata_differences)
            + "; artifacts="
            + ",".join(artifact_differences)
        )
    result = {
        "schemaVersion": 1,
        "kind": "g024-dual-clean-replay-reconstruction-candidate",
        "sourceGitOid": left_data["metadata"]["source_sha"],
        "sourceGitOidAlgorithm": "sha1",
        "comparedHashes": {**left_data["hashes"], "SHA256SUMS": left_data["sha256sums"]},
        "verdict": "passed",
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=output.parent, delete=False) as handle:
        json.dump(result, handle, sort_keys=True, separators=(",", ":"))
        handle.write("\n")
        temp_name = handle.name
    os.replace(temp_name, output)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--left", required=True, type=Path)
    parser.add_argument("--right", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        compare(args.left, args.right, args.output)
    except ComparisonError as exc:
        parser.error(str(exc))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
