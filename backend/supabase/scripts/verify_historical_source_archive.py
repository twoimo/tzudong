#!/usr/bin/env python3
"""Fail-closed verifier for the G024 historical-source inventory artifact."""

from __future__ import annotations

import argparse
import hashlib
import json
import stat
import subprocess
import sys
import zipfile
from pathlib import Path
from typing import Any

ROOT_KEYS = {
    "schemaVersion",
    "repository",
    "commit",
    "tree",
    "archiveSha256",
    "status",
    "reconstructionAuthorized",
    "unresolvedGaps",
    "entries",
}
ENTRY_KEYS = {"path", "blobSha1", "byteLength", "sha256", "classification"}
ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)
ZIP_MODE = 0o100644
BASELINE_PATH = "supabase/migrations/temp/20251107_complete_migration.sql"


class VerificationError(Exception):
    pass


def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise VerificationError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def load_manifest(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicate_keys)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise VerificationError(f"invalid manifest: {error}") from error
    if not isinstance(value, dict) or set(value) != ROOT_KEYS:
        raise VerificationError("manifest keys do not match the v1 schema")
    return value


def require_hex(value: Any, length: int, label: str) -> None:
    if not isinstance(value, str) or len(value) != length:
        raise VerificationError(f"invalid {label}")
    try:
        int(value, 16)
    except ValueError as error:
        raise VerificationError(f"invalid {label}") from error


def validate_manifest(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    if manifest["schemaVersion"] != 1:
        raise VerificationError("unsupported schema version")
    if not isinstance(manifest["repository"], str) or manifest["repository"].count("/") != 1:
        raise VerificationError("invalid repository")
    require_hex(manifest["commit"], 40, "commit")
    require_hex(manifest["tree"], 40, "tree")
    require_hex(manifest["archiveSha256"], 64, "archive SHA-256")
    if manifest["status"] != "inventory_only" or manifest["reconstructionAuthorized"] is not False:
        raise VerificationError("manifest must remain an unauthorized inventory")
    if manifest["unresolvedGaps"] != ["migration_order", "overlap", "platform_history"]:
        raise VerificationError("unresolved gaps drifted")
    entries = manifest["entries"]
    if not isinstance(entries, list) or not entries:
        raise VerificationError("entries must be a non-empty list")
    paths: list[str] = []
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != ENTRY_KEYS:
            raise VerificationError("entry keys do not match the v1 schema")
        path = entry["path"]
        if not isinstance(path, str) or not path.startswith("supabase/migrations/temp/") or not path.endswith(".sql"):
            raise VerificationError("invalid entry path")
        if Path(path).is_absolute() or "\\" in path or any(part in {"", ".", ".."} for part in path.split("/")):
            raise VerificationError("unsafe entry path")
        require_hex(entry["blobSha1"], 40, "blob SHA-1")
        require_hex(entry["sha256"], 64, "entry SHA-256")
        if not isinstance(entry["byteLength"], int) or isinstance(entry["byteLength"], bool) or entry["byteLength"] < 0:
            raise VerificationError("invalid byte length")
        expected_classification = "candidate_baseline" if path == BASELINE_PATH else "candidate_unordered"
        if entry["classification"] != expected_classification:
            raise VerificationError("invalid entry classification")
        paths.append(path)
    if paths != sorted(paths) or len(paths) != len(set(paths)):
        raise VerificationError("entries must be uniquely sorted")
    if BASELINE_PATH not in paths:
        raise VerificationError("baseline entry is missing")
    return entries


def verify_archive(archive: Path, manifest: dict[str, Any], entries: list[dict[str, Any]]) -> None:
    try:
        archive_hash = hashlib.sha256(archive.read_bytes()).hexdigest()
    except OSError as error:
        raise VerificationError(f"cannot read archive: {error}") from error
    if archive_hash != manifest["archiveSha256"]:
        raise VerificationError("archive SHA-256 mismatch")
    expected = {entry["path"]: entry for entry in entries}
    try:
        with zipfile.ZipFile(archive) as source:
            infos = source.infolist()
            names = [info.filename for info in infos]
            if len(names) != len(set(names)) or set(names) != set(expected):
                raise VerificationError("archive has duplicate, missing, or extra entries")
            for info in infos:
                if info.is_dir() or info.filename.endswith("/"):
                    raise VerificationError("archive contains a directory")
                mode = (info.external_attr >> 16) & 0xFFFF
                if stat.S_IFMT(mode) == stat.S_IFLNK:
                    raise VerificationError("archive contains a symlink")
                if mode != ZIP_MODE or info.compress_type != zipfile.ZIP_STORED or info.date_time != ZIP_TIMESTAMP:
                    raise VerificationError("archive metadata drifted")
                entry = expected[info.filename]
                data = source.read(info)
                if len(data) != entry["byteLength"] or hashlib.sha256(data).hexdigest() != entry["sha256"]:
                    raise VerificationError("archive byte metadata mismatch")
                blob_sha1 = hashlib.sha1(f"blob {len(data)}\0".encode("ascii") + data).hexdigest()
                if blob_sha1 != entry["blobSha1"]:
                    raise VerificationError("archive Git blob SHA-1 mismatch")
    except (OSError, zipfile.BadZipFile, RuntimeError) as error:
        raise VerificationError(f"invalid archive: {error}") from error


def gh_json(endpoint: str) -> Any:
    try:
        output = subprocess.check_output(["gh", "api", endpoint], text=True, encoding="utf-8", stderr=subprocess.PIPE)
        return json.loads(output)
    except (OSError, subprocess.CalledProcessError, json.JSONDecodeError) as error:
        raise VerificationError("remote verification failed") from error


def verify_remote(manifest: dict[str, Any], entries: list[dict[str, Any]]) -> None:
    commit = gh_json(f"repos/{manifest['repository']}/commits/{manifest['commit']}")
    if commit.get("sha") != manifest["commit"] or commit.get("commit", {}).get("tree", {}).get("sha") != manifest["tree"]:
        raise VerificationError("remote commit/tree metadata mismatch")
    tree = gh_json(f"repos/{manifest['repository']}/git/trees/{manifest['tree']}?recursive=1")
    if tree.get("truncated") is not False:
        raise VerificationError("remote tree is incomplete")
    blobs = {item.get("path"): item.get("sha") for item in tree.get("tree", []) if item.get("type") == "blob"}
    for entry in entries:
        if blobs.get(entry["path"]) != entry["blobSha1"]:
            raise VerificationError("remote blob metadata mismatch")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    base = Path(__file__).resolve().parents[1] / "baselines/historical/pre-20260214-application"
    parser.add_argument("--archive", type=Path, default=base / "HISTORICAL_SOURCES.v1.zip")
    parser.add_argument("--manifest", type=Path, default=base / "HISTORICAL_SOURCES.v1.json")
    parser.add_argument("--remote", action="store_true", help="verify commit/tree/blob metadata through authenticated gh API")
    args = parser.parse_args()
    try:
        manifest = load_manifest(args.manifest)
        entries = validate_manifest(manifest)
        verify_archive(args.archive, manifest, entries)
        if args.remote:
            verify_remote(manifest, entries)
    except VerificationError as error:
        print(f"verification failed: {error}", file=sys.stderr)
        return 1
    print(f"verified {len(entries)} inventory-only source entries")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
