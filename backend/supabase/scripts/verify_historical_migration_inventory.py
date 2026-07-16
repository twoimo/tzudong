"""Fail-closed offline structural validation for the historical migration inventory."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

_MANIFEST_PATH = (
    Path(__file__).resolve().parents[1]
    / "baselines/historical/pre-20260214-application/MIGRATION_INVENTORY.v1.json"
)
_HASH = re.compile(r"^[0-9a-f]{40}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_REQUIRED_GAPS = [
    "complete connecting DAG",
    "application order",
    "overlap classification",
    "platform prerequisites",
]
_ANCHOR = {
    "commit": "a15558368ac86c86835d8f105746cf553c18ddf9",
    "tree": "f96999e1653c39f68dfc6833a70f9de2a4577c7e",
    "parents": [
        "3744fb957ce33d2945234411fc9281ede453080f",
        "d42088e8c8ffd6917a721e17f5ca211de4e68c49",
    ],
}
_CUTOFF = {
    "commit": "6087fc0294a2bbdc1bfc5453015dff301a8e0c85",
    "tree": "1a7a6501090d99b4a2de9f39bf749121082d4626",
    "parents": [
        "56d1b74337c66db3b27249fe4952f81d4781be67",
        "36ee0c2ea084d4ee7fd5b5112b805f72b6f9a904",
    ],
}
_RECORD = {
    "path": "supabase/migrations/temp/20251107_complete_migration.sql",
    "blob": "b286fb1589b46203a0010d44c29ce65a39188fbc",
    "byteLength": 79793,
    "sha256": "23de25dcbe84612ca032b680608d671ffdfa0a72eac44b823e8d001b59919f33",
}


def _require_keys(value: Any, keys: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        raise ValueError(f"{label} must contain exactly {sorted(keys)}")
    return value


def _require_hash(value: Any, label: str) -> str:
    if not isinstance(value, str) or not _HASH.fullmatch(value):
        raise ValueError(f"{label} must be a lowercase 40-character hexadecimal hash")
    return value


def _require_sha256(value: Any, label: str) -> str:
    if not isinstance(value, str) or not _SHA256.fullmatch(value):
        raise ValueError(f"{label} must be a lowercase 64-character hexadecimal SHA-256")
    return value


def _validate_endpoint(value: Any, expected: dict[str, Any], label: str) -> None:
    endpoint = _require_keys(value, {"commit", "tree", "parents"}, label)
    _require_hash(endpoint["commit"], f"{label}.commit")
    _require_hash(endpoint["tree"], f"{label}.tree")
    if not isinstance(endpoint["parents"], list):
        raise ValueError(f"{label}.parents must be a list")
    for index, parent in enumerate(endpoint["parents"]):
        _require_hash(parent, f"{label}.parents[{index}]")
    if endpoint != expected:
        raise ValueError(f"{label} does not match the authenticated endpoint metadata")


def validate_inventory(document: Any) -> None:
    manifest = _require_keys(
        document,
        {"schemaVersion", "status", "replayAuthorized", "endpointMetadata", "records", "unresolvedGaps"},
        "manifest",
    )
    if manifest["schemaVersion"] != "historical-migration-inventory/v1":
        raise ValueError("schemaVersion is not historical-migration-inventory/v1")
    if manifest["status"] != "inventory_only":
        raise ValueError("status must be inventory_only")
    if manifest["replayAuthorized"] is not False:
        raise ValueError("replayAuthorized must be false")

    metadata = _require_keys(manifest["endpointMetadata"], {"anchor", "cutoff"}, "endpointMetadata")
    _validate_endpoint(metadata["anchor"], _ANCHOR, "endpointMetadata.anchor")
    _validate_endpoint(metadata["cutoff"], _CUTOFF, "endpointMetadata.cutoff")

    records = manifest["records"]
    if not isinstance(records, list):
        raise ValueError("records must be a list")
    seen_paths: set[str] = set()
    for index, record in enumerate(records):
        item = _require_keys(record, {"path", "blob", "byteLength", "sha256"}, f"records[{index}]")
        if not isinstance(item["path"], str) or not item["path"]:
            raise ValueError(f"records[{index}].path must be a non-empty string")
        _require_hash(item["blob"], f"records[{index}].blob")
        _require_sha256(item["sha256"], f"records[{index}].sha256")
        if not isinstance(item["byteLength"], int) or isinstance(item["byteLength"], bool) or item["byteLength"] < 0:
            raise ValueError(f"records[{index}].byteLength must be a non-negative integer")
        if item["path"] in seen_paths:
            raise ValueError(f"records[{index}].path is duplicated")
        seen_paths.add(item["path"])
    if records != [_RECORD]:
        raise ValueError("records do not match the authenticated inventory")

    if manifest["unresolvedGaps"] != _REQUIRED_GAPS:
        raise ValueError("unresolvedGaps must exactly preserve the known replay blockers")


def load_and_validate(path: Path) -> None:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"cannot read valid JSON manifest: {error}") from error
    validate_inventory(document)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=_MANIFEST_PATH)
    args = parser.parse_args(argv)
    try:
        load_and_validate(args.manifest)
    except ValueError as error:
        print(f"historical migration inventory rejected: {error}", file=sys.stderr)
        return 1
    print("historical migration inventory verified (inventory_only; replay unauthorized)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
