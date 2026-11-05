#!/usr/bin/env python3
"""Publish a path-sanitized compiler provenance rerun."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path
from typing import Any


PLACEHOLDER = "<shared-node-modules-root>"
CONFIG_REDACTIONS = ["/expectedNodeModulesTarget"]
RAW_REDACTIONS = [
    "/metadata/experimentConfig/expectedNodeModulesTarget",
    "/metadata/nodeModulesTarget",
]


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def private_path_pointers(value: Any, pointer: str = "") -> list[str]:
    paths: list[str] = []
    if isinstance(value, dict):
        for key, item in value.items():
            paths.extend(private_path_pointers(item, f"{pointer}/{key}"))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            paths.extend(private_path_pointers(item, f"{pointer}/{index}"))
    elif isinstance(value, str) and "/Users/" in value:
        paths.append(pointer)
    return paths


def sanitize(document: dict[str, Any], pointers: list[str]) -> dict[str, Any]:
    result = json.loads(json.dumps(document))
    observed = sorted(private_path_pointers(result))
    if observed != sorted(pointers):
        raise RuntimeError(
            f"private path inventory differs from declared redactions: {observed}"
        )
    for pointer in pointers:
        current: Any = result
        parts = pointer.removeprefix("/").split("/")
        for part in parts[:-1]:
            current = current[part]
        if not isinstance(current.get(parts[-1]), str):
            raise RuntimeError(f"invalid redaction pointer: {pointer}")
        current[parts[-1]] = PLACEHOLDER
    if private_path_pointers(result):
        raise RuntimeError("sanitized evidence still contains a private path")
    return result


def provenance_inventory(raw: dict[str, Any]) -> dict[str, Any]:
    metadata = raw["metadata"]
    config = metadata["experimentConfig"]
    expected = config["expectedDependencyHashes"]
    if not (
        expected
        == metadata["dependencyHashes"]
        == metadata["snapshotDependencyHashes"]
    ):
        raise RuntimeError("dependency hashes changed across the measurement")
    roles = metadata["compilerProvenance"]
    if set(roles) != set(config["compilerProvenance"]):
        raise RuntimeError("compiler provenance roles changed during measurement")
    for role, relative in config["compilerProvenance"].items():
        if roles[role] != {"path": relative, "sha256": expected[relative]}:
            raise RuntimeError(f"compiler provenance role mismatch: {role}")
    body = {
        "schema": "tzudong-ci-performance/v1/compiler-provenance-inventory",
        "gitHead": metadata["gitHead"],
        "sourceTreeSha": metadata["sourceTreeSha"],
        "sourceContractUnchanged": metadata["sourceContractUnchanged"],
        "dependencyFiles": [
            {"path": path, "sha256": digest}
            for path, digest in sorted(expected.items())
        ],
        "executedCompilerRoles": [
            {"role": role, **roles[role]}
            for role in sorted(roles)
        ],
    }
    return {
        **body,
        "dependencyFileCount": len(body["dependencyFiles"]),
        "executedCompilerRoleCount": len(body["executedCompilerRoles"]),
        "inventorySha256": sha256_bytes(canonical_json(body).encode("utf-8")),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--private-results", type=Path, required=True)
    parser.add_argument("--input-manifest", type=Path, required=True)
    parser.add_argument("--public-dir", type=Path, required=True)
    args = parser.parse_args()
    private = args.private_results.resolve(strict=True)
    input_manifest = args.input_manifest.resolve(strict=True)
    public = args.public_dir.resolve(strict=True)
    generated = (
        "configuration.json",
        "raw.json",
        "summary.json",
        "report.md",
        "input-manifest.json",
        "compiler-provenance-inventory.json",
        "sanitization-receipt.json",
    )
    if any((public / name).exists() for name in generated):
        raise RuntimeError("refusing to overwrite generated public evidence")

    private_config_path = private / "configuration.json"
    private_raw_path = private / "raw.json"
    private_summary_path = private / "summary.json"
    private_report_path = private / "report.md"
    private_config = json.loads(private_config_path.read_text(encoding="utf-8"))
    private_raw = json.loads(private_raw_path.read_text(encoding="utf-8"))
    public_config = sanitize(private_config, CONFIG_REDACTIONS)
    public_raw = sanitize(private_raw, RAW_REDACTIONS)
    (public / "configuration.json").write_text(
        canonical_json(public_config), encoding="utf-8"
    )
    (public / "raw.json").write_text(canonical_json(public_raw), encoding="utf-8")
    shutil.copyfile(private_summary_path, public / "summary.json")
    shutil.copyfile(private_report_path, public / "report.md")
    shutil.copyfile(input_manifest, public / "input-manifest.json")
    inventory = provenance_inventory(private_raw)
    (public / "compiler-provenance-inventory.json").write_text(
        canonical_json(inventory), encoding="utf-8"
    )

    public_paths = {
        name: public / name
        for name in generated
        if name != "sanitization-receipt.json"
    }
    receipt = {
        "schema": "tzudong-ci-performance/v1/path-sanitization-receipt",
        "placeholder": PLACEHOLDER,
        "redactedJsonPointers": {
            "configuration.json": CONFIG_REDACTIONS,
            "raw.json": RAW_REDACTIONS,
        },
        "privateHashes": {
            "configuration.json": sha256_file(private_config_path),
            "raw.json": sha256_file(private_raw_path),
            "summary.json": sha256_file(private_summary_path),
            "report.md": sha256_file(private_report_path),
            "input-manifest.json": sha256_file(input_manifest),
        },
        "publicHashes": {
            name: sha256_file(path) for name, path in sorted(public_paths.items())
        },
        "privatePathsRemainingInPublicEvidence": 0,
        "privateOriginalsRetained": True,
    }
    (public / "sanitization-receipt.json").write_text(
        canonical_json(receipt), encoding="utf-8"
    )
    for name in generated:
        path = public / name
        if b"/Users/" in path.read_bytes():
            raise RuntimeError(f"private path remains in public evidence: {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
