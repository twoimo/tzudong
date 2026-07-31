#!/usr/bin/env python3
"""Fail-closed verifier for the unauthorized G024 reconstruction candidate."""

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

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / "backend/supabase/baselines/historical/pre-20260214-application"
HISTORICAL_ARCHIVE = BASE / "HISTORICAL_SOURCES.v1.zip"
HISTORICAL_MANIFEST = BASE / "HISTORICAL_SOURCES.v1.json"
HISTORICAL_MEMBER = "supabase/migrations/temp/20251107_complete_migration.sql"
HISTORICAL_PREREQUISITE_MEMBER = "supabase/migrations/temp/20251210_redesign_submissions_v2.sql"
PURPOSE = "source-only reconstruction candidate; not historical application proof or hosted-state evidence"
GAPS = ["platform_prerequisites", "overlap_classification", "dual_clean_replay"]
RECONSTRUCTION_ARCHIVE_SHA256 = "21a2b4b6050c05f405a158bf81287b56d4de349189abcb6419090f4dc54c3fc3"
HISTORICAL_ARCHIVE_SHA256 = "1b221e44a5a7de028a6a3eeec160562f7dc6172c6b7eb83c630a00c7149e5e11"
ROOT_KEYS = {
    "schemaVersion", "archiveSha256", "historicalSourceArchiveSha256",
    "status", "reconstructionAuthorized", "unresolvedGaps", "purpose", "compatibilityExclusions", "compatibilityRelocations", "entries",
}
ENTRY_KEYS = {"ordinal", "path", "blobSha1", "byteLength", "sha256", "role"}
EXCLUSION_KEYS = {
    "ordinal", "sourcePath", "sourceGitBlobSha1", "sourceSha256", "startLine", "endLine",
    "byteLength", "sha256", "objectType", "objectIdentity", "reasonCode", "disposition", "evidenceScope",
}
RELOCATION_KEYS = {
    "ordinal", "sourcePath", "sourceGitBlobSha1", "sourceSha256", "startLine", "endLine",
    "byteLength", "sha256", "identities", "reasonCode", "disposition", "evidenceScope",
}
COMPATIBILITY_RELOCATIONS = (
    {
        "ordinal": 0, "sourcePath": HISTORICAL_MEMBER,
        "sourceGitBlobSha1": "b286fb1589b46203a0010d44c29ce65a39188fbc",
        "sourceSha256": "23de25dcbe84612ca032b680608d671ffdfa0a72eac44b823e8d001b59919f33",
        "startLine": 1802, "endLine": 1819, "byteLength": 860,
        "sha256": "3c34d8721bcf7454e59b2dd15bc0895ec7bb91aed8e8caafe20acf423bc0ceb4",
        "identities": ["extensions schema", "pg_trgm", "uuid-ossp", "btree_gin"],
        "reasonCode": "extension_prerequisites_declared_after_dependents",
        "disposition": "relocated_before_source_without_modification", "evidenceScope": "candidate_only",
    },
)
COMPATIBILITY_EXCLUSIONS = (
    {
        "ordinal": 0, "sourcePath": HISTORICAL_MEMBER,
        "sourceGitBlobSha1": "b286fb1589b46203a0010d44c29ce65a39188fbc",
        "sourceSha256": "23de25dcbe84612ca032b680608d671ffdfa0a72eac44b823e8d001b59919f33",
        "startLine": 916, "endLine": 954, "byteLength": 1252,
        "sha256": "e30512d59c749072280bd463d932cf54fba534b8d7244740a60ff0c4fa3603e0",
        "objectType": "function", "objectIdentity": "public.batch_insert_restaurants_from_jsonl(jsonb[])",
        "reasonCode": "truncated_legacy_function_source",
        "disposition": "excluded_without_replacement", "evidenceScope": "candidate_only",
    },
)
ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)
ZIP_MODE = 0o100644
CURRENT_PATHS = (
    "apps/web/supabase/migrations/20251219_db_performance_optimization.sql",
    "apps/web/supabase/migrations/20260118_create_ocr_logs.sql",
    "backend/supabase/migrations/20260124_create_document_embeddings_bge.sql",
    "backend/supabase/migrations/20260124_create_restaurants.sql",
    "backend/supabase/migrations/20260124_fix_approved_name_sync.sql",
    "backend/supabase/migrations/20260124_update_embeddings_constraint.sql",
    "backend/supabase/migrations/20260131_fix_search_rpc.sql",
    "backend/supabase/migrations/20260213_create_announcements_table_and_seed.sql",
)
EXPECTED_PATHS = (HISTORICAL_MEMBER, HISTORICAL_PREREQUISITE_MEMBER, *CURRENT_PATHS)


class VerificationError(Exception):
    pass


def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise VerificationError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def require_hex(value: Any, length: int, label: str) -> None:
    if (not isinstance(value, str) or len(value) != length
            or value.lower() != value):
        raise VerificationError(f"invalid {label}")
    try:
        int(value, 16)
    except ValueError as error:
        raise VerificationError(f"invalid {label}") from error


def reject_prohibited_words(value: Any) -> None:
    if isinstance(value, dict):
        for item in value.values():
            reject_prohibited_words(item)
    elif isinstance(value, list):
        for item in value:
            reject_prohibited_words(item)
    elif isinstance(value, str):
        normalized = value.lower().replace("/", "-").replace("_", "-").replace(" ", "-")
        if "dump" in normalized or "live" in normalized or "self-baseline" in normalized:
            raise VerificationError("prohibited dump/live/self-baseline wording or path")


def load_manifest(path: Path) -> dict[str, Any]:
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicate_keys)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise VerificationError(f"invalid manifest: {error}") from error
    if not isinstance(manifest, dict) or set(manifest) != ROOT_KEYS:
        raise VerificationError("manifest keys do not match the v1 schema")
    reject_prohibited_words(manifest)
    return manifest


def validate_manifest(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    if manifest["schemaVersion"] != 1:
        raise VerificationError("unsupported schema version")
    require_hex(manifest["archiveSha256"], 64, "archive SHA-256")
    require_hex(manifest["historicalSourceArchiveSha256"], 64, "historical source archive SHA-256")
    if (manifest["archiveSha256"] != RECONSTRUCTION_ARCHIVE_SHA256
            or manifest["historicalSourceArchiveSha256"] != HISTORICAL_ARCHIVE_SHA256
            or manifest["status"] != "candidate_ordered"
            or manifest["reconstructionAuthorized"] is not False):
        raise VerificationError("candidate constants drifted or candidate was authorized")
    if manifest["unresolvedGaps"] != GAPS or manifest["purpose"] != PURPOSE:
        raise VerificationError("candidate contract drifted")
    expected_roles = (
        "historical_baseline_candidate",
        "historical_prerequisite_candidate",
        *("current_recovery_candidate" for _ in CURRENT_PATHS),
    )
    entries = manifest["entries"]
    if not isinstance(entries, list) or len(entries) != len(EXPECTED_PATHS):
        raise VerificationError("candidate must contain exactly ten entries")
    for ordinal, entry in enumerate(entries):
        if not isinstance(entry, dict) or set(entry) != ENTRY_KEYS:
            raise VerificationError("entry keys do not match the v1 schema")
        if entry["ordinal"] != ordinal or entry["path"] != EXPECTED_PATHS[ordinal]:
            raise VerificationError("candidate order mutated")
        if not isinstance(entry["path"], str) or not entry["path"].endswith(".sql") or "\\" in entry["path"]:
            raise VerificationError("unsafe entry path")
        parts = entry["path"].split("/")
        if Path(entry["path"]).is_absolute() or any(part in {"", ".", ".."} for part in parts):
            raise VerificationError("unsafe entry path")
        if entry["role"] != expected_roles[ordinal]:
            raise VerificationError("entry role drifted")
        require_hex(entry["blobSha1"], 40, "blob SHA-1")
        require_hex(entry["sha256"], 64, "entry SHA-256")
        if not isinstance(entry["byteLength"], int) or isinstance(entry["byteLength"], bool) or entry["byteLength"] < 0:
            raise VerificationError("invalid byte length")
    exclusions = manifest["compatibilityExclusions"]
    if (not isinstance(exclusions, list) or len(exclusions) != len(COMPATIBILITY_EXCLUSIONS)
            or any(not isinstance(exclusion, dict) or set(exclusion) != EXCLUSION_KEYS for exclusion in exclusions)
            or tuple(exclusions) != COMPATIBILITY_EXCLUSIONS):
        raise VerificationError("compatibility exclusion contract drifted")
    relocations = manifest["compatibilityRelocations"]
    if (not isinstance(relocations, list) or len(relocations) != len(COMPATIBILITY_RELOCATIONS)
            or any(not isinstance(relocation, dict) or set(relocation) != RELOCATION_KEYS for relocation in relocations)
            or tuple(relocations) != COMPATIBILITY_RELOCATIONS):
        raise VerificationError("compatibility relocation contract drifted")
    return entries


def blob_sha1(data: bytes) -> str:
    return hashlib.sha1(f"blob {len(data)}\0".encode("ascii") + data).hexdigest()


def verify_compatibility_blocks(source: bytes, exclusions: list[dict[str, Any]], relocations: list[dict[str, Any]]) -> None:
    previous_end = 0
    for block in [*exclusions, *relocations]:
        start_line = block["startLine"]
        end_line = block["endLine"]
        lines = source.splitlines(keepends=True)
        if start_line < 1 or end_line < start_line or end_line > len(lines) or start_line <= previous_end:
            raise VerificationError("compatibility block range is invalid or overlaps")
        content = b"".join(lines[start_line - 1:end_line])
        if (len(content) != block["byteLength"]
                or hashlib.sha256(content).hexdigest() != block["sha256"]):
            raise VerificationError("compatibility block bytes mismatch")
        previous_end = end_line


def verify_compatibility_exclusions(source: bytes, exclusions: list[dict[str, Any]]) -> None:
    verify_compatibility_blocks(source, exclusions, [])


def verify_zip(archive: Path, manifest: dict[str, Any], entries: list[dict[str, Any]]) -> None:
    try:
        if hashlib.sha256(archive.read_bytes()).hexdigest() != manifest["archiveSha256"]:
            raise VerificationError("archive SHA-256 mismatch")
        with zipfile.ZipFile(archive) as source:
            if source.comment:
                raise VerificationError("archive comment is not permitted")
            infos = source.infolist()
            if [info.filename for info in infos] != list(EXPECTED_PATHS):
                raise VerificationError("archive members or order mutated")
            for info, entry in zip(infos, entries, strict=True):
                mode = (info.external_attr >> 16) & 0xFFFF
                if (info.is_dir() or info.filename.endswith("/") or stat.S_IFMT(mode) == stat.S_IFLNK
                        or mode != ZIP_MODE or info.compress_type != zipfile.ZIP_STORED
                        or info.date_time != ZIP_TIMESTAMP or info.flag_bits != 0 or info.extra):
                    raise VerificationError("unsafe ZIP metadata")
                data = source.read(info)
                if (len(data) != entry["byteLength"] or hashlib.sha256(data).hexdigest() != entry["sha256"]
                        or blob_sha1(data) != entry["blobSha1"]):
                    raise VerificationError("archive entry metadata mismatch")
                if entry["ordinal"] == 0:
                    verify_compatibility_blocks(data, manifest["compatibilityExclusions"], manifest["compatibilityRelocations"])
    except (OSError, zipfile.BadZipFile, RuntimeError) as error:
        raise VerificationError(f"invalid archive: {error}") from error


def verify_historical_sources(entries: list[dict[str, Any]]) -> None:
    try:
        historical_manifest = json.loads(
            HISTORICAL_MANIFEST.read_text(encoding="utf-8"),
            object_pairs_hook=reject_duplicate_keys,
        )
        if (not isinstance(historical_manifest, dict)
                or historical_manifest.get("archiveSha256") != HISTORICAL_ARCHIVE_SHA256
                or not isinstance(historical_manifest.get("entries"), list)):
            raise VerificationError("historical source manifest drifted")
        archive_data = HISTORICAL_ARCHIVE.read_bytes()
        if hashlib.sha256(archive_data).hexdigest() != HISTORICAL_ARCHIVE_SHA256:
            raise VerificationError("historical source archive hash mismatch")
        with zipfile.ZipFile(HISTORICAL_ARCHIVE) as source:
            for entry in entries[:2]:
                historical_entries = [
                    item for item in historical_manifest["entries"]
                    if isinstance(item, dict) and item.get("path") == entry["path"]
                ]
                if len(historical_entries) != 1 or any(
                        historical_entries[0].get(key) != entry[key]
                        for key in ("path", "blobSha1", "byteLength", "sha256")):
                    raise VerificationError("historical source does not match source manifest")
                data = source.read(entry["path"])
                if (len(data) != entry["byteLength"]
                        or hashlib.sha256(data).hexdigest() != entry["sha256"]
                        or blob_sha1(data) != entry["blobSha1"]):
                    raise VerificationError("historical source does not match verified source archive")
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, KeyError, zipfile.BadZipFile) as error:
        raise VerificationError("historical source archive or manifest is unavailable") from error

def git_output(*args: str) -> str:
    try:
        return subprocess.check_output(["git", *args], cwd=ROOT, text=True, encoding="utf-8", stderr=subprocess.PIPE).strip()
    except (OSError, subprocess.CalledProcessError) as error:
        raise VerificationError("Git source verification failed") from error


def verify_current_git(entries: list[dict[str, Any]]) -> None:
    for entry in entries[2:]:
        path = entry["path"]
        if git_output("status", "--porcelain", "--", path):
            raise VerificationError("current recovery source is dirty or untracked")
        index = git_output("ls-files", "-s", "--", path).split()
        if len(index) < 2 or index[0] != "100644" or index[1] != entry["blobSha1"]:
            raise VerificationError("current recovery source index identity mismatch")
        if git_output("rev-parse", f"HEAD:{path}") != entry["blobSha1"]:
            raise VerificationError("current recovery source HEAD identity mismatch")
        try:
            data = (ROOT / path).read_bytes()
        except OSError as error:
            raise VerificationError("current recovery source is unavailable") from error
        if len(data) != entry["byteLength"] or hashlib.sha256(data).hexdigest() != entry["sha256"] or blob_sha1(data) != entry["blobSha1"]:
            raise VerificationError("current recovery source bytes mismatch")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, default=BASE / "RECONSTRUCTION_SOURCES.v1.zip")
    parser.add_argument("--manifest", type=Path, default=BASE / "RECONSTRUCTION_SOURCES.v1.json")
    args = parser.parse_args()
    try:
        manifest = load_manifest(args.manifest)
        entries = validate_manifest(manifest)
        verify_zip(args.archive, manifest, entries)
        verify_historical_sources(entries)
        verify_current_git(entries)
    except VerificationError as error:
        print(f"verification failed: {error}", file=sys.stderr)
        return 1
    print(f"verified {len(entries)} unauthorized ordered reconstruction source entries")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
