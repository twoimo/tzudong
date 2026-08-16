#!/usr/bin/env python3
"""Validate and apply the data-only daily publication bundle.

This validator is executed from the trusted workflow checkout, never from the
artifact or data branch.  It only parses manifest bytes, hashes data bytes, and
copies regular data files; it never imports, executes, or shells out to bundle
contents.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import sys
import tarfile
from pathlib import Path
from typing import Dict, Iterable, List, Tuple


SCHEMA_VERSION = 1
BUNDLE_NAME = "daily-data-publication.tar"
MANIFEST_NAME = "publication-manifest.json"
MANIFEST_SHA256_NAME = "publication-manifest.sha256"
MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024
MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024
ALLOWED_ROOTS = (
    "backend/restaurant-crawling/data/",
    "backend/restaurant-evaluation/data/",
)
ALLOWED_SUFFIXES = (".json", ".jsonl", ".txt")
EXCLUDED_BASENAMES = {"credentials.json", "cookies.txt"}
ALLOWED_MODES = {"0600", "0640", "0644", "0660", "0664"}
FORBIDDEN_COMPONENTS = {"frames", "video_cache", "temp_video", "thumbnails", "log", "logs"}
FORBIDDEN_NAME_PARTS = ("credential", "cookie", "secret", "token", "password", "log")
FORBIDDEN_NAME_RE = re.compile(
    r"(?:^|[_\-.])(?:" + "|".join(re.escape(p) for p in FORBIDDEN_NAME_PARTS) + r")s?(?:[_\-.]|$)",
    re.IGNORECASE,
)
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
SHA1_RE = re.compile(r"^[0-9a-f]{40}$")
ARTIFACT_DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")


def _reject_duplicate_keys(pairs: Iterable[Tuple[str, object]]) -> dict:
    payload = {}
    for key, value in pairs:
        if key in payload:
            raise ValueError("duplicate JSON key")
        payload[key] = value
    return payload


def _load_json(path: Path) -> dict:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_reject_duplicate_keys)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("invalid manifest JSON") from exc
    if not isinstance(payload, dict):
        raise ValueError("manifest must be an object")
    return payload


def _sha256_file(path: Path) -> Tuple[int, str]:
    file_stat = os.lstat(path)
    if not stat.S_ISREG(file_stat.st_mode) or stat.S_ISLNK(file_stat.st_mode):
        raise ValueError(f"{path.name} must be a regular non-symlink file")
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as source:
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            digest.update(chunk)
    if size != file_stat.st_size:
        raise ValueError(f"{path.name} changed while being hashed")
    return size, digest.hexdigest()


def _portable_path(value: object) -> str:
    if not isinstance(value, str) or not value or "\\" in value:
        raise ValueError("manifest path must be a non-empty portable relative path")
    parts = value.split("/")
    if any(not part or part in {".", ".."} for part in parts):
        raise ValueError("manifest path contains an unsafe component")
    if value.startswith("/") or ":" in parts[0]:
        raise ValueError("manifest path must not be absolute")
    return value


def _is_allowed_data_path(path: str) -> bool:
    components = path.split("/")
    stem = Path(path).stem
    return (
        path.startswith(ALLOWED_ROOTS)
        and path.endswith(ALLOWED_SUFFIXES)
        and Path(path).name not in EXCLUDED_BASENAMES
        and not any(component.lower() in FORBIDDEN_COMPONENTS for component in components)
        and not bool(FORBIDDEN_NAME_RE.search(stem))
    )


def _require_exact_keys(payload: dict, expected: set, label: str) -> None:
    if set(payload) != expected:
        raise ValueError(f"{label} has unexpected or missing fields")


def _validate_file_entry(entry: object) -> dict:
    if not isinstance(entry, dict):
        raise ValueError("manifest file entry must be an object")
    _require_exact_keys(entry, {"path", "mode", "size", "sha256"}, "manifest file entry")
    path = _portable_path(entry["path"])
    if not _is_allowed_data_path(path):
        raise ValueError("manifest contains a non-allowlisted data path")
    mode = entry["mode"]
    if mode not in ALLOWED_MODES:
        raise ValueError("manifest file mode is not permitted")
    size = entry["size"]
    if isinstance(size, bool) or not isinstance(size, int) or size < 0 or size > MAX_FILE_BYTES:
        raise ValueError("manifest file size is outside permitted bounds")
    digest = entry["sha256"]
    if not isinstance(digest, str) or not SHA256_RE.fullmatch(digest):
        raise ValueError("manifest file sha256 is invalid")
    return {"path": path, "mode": mode, "size": size, "sha256": digest}


def _validate_artifact_directory(manifest_path: Path, manifest_sha256_path: Path, bundle_path: Path) -> None:
    expected = {MANIFEST_NAME, MANIFEST_SHA256_NAME, BUNDLE_NAME}
    if (
        manifest_path.name != MANIFEST_NAME
        or manifest_sha256_path.name != MANIFEST_SHA256_NAME
        or bundle_path.name != BUNDLE_NAME
        or manifest_path.parent != manifest_sha256_path.parent
        or manifest_path.parent != bundle_path.parent
    ):
        raise ValueError("publication artifact names or parent are invalid")
    try:
        entries = {entry.name: entry for entry in manifest_path.parent.iterdir()}
    except OSError as exc:
        raise ValueError("publication artifact directory is unavailable") from exc
    if set(entries) != expected:
        raise ValueError("publication artifact contains unexpected paths")
    for entry in entries.values():
        file_stat = os.lstat(entry)
        if stat.S_ISLNK(file_stat.st_mode) or not stat.S_ISREG(file_stat.st_mode):
            raise ValueError("publication artifact member is unsafe")


def validate_manifest(
    manifest_path: Path,
    manifest_sha256_path: Path,
    bundle_path: Path,
    expected_repository: str,
    expected_execution_sha: str,
    expected_target_branch: str,
    expected_base_sha: str,
    expected_base_tree: str,
    expected_compute_manifest_sha256: str,
    expected_artifact_digest: str,
) -> dict:
    if not SHA256_RE.fullmatch(expected_compute_manifest_sha256):
        raise ValueError("compute manifest SHA-256 is invalid")
    if not ARTIFACT_DIGEST_RE.fullmatch(expected_artifact_digest):
        raise ValueError("GitHub artifact digest is invalid")
    manifest_size, manifest_digest = _sha256_file(manifest_path)
    if manifest_digest != expected_compute_manifest_sha256:
        raise ValueError("downloaded manifest does not match the compute-bound SHA-256")
    if manifest_size > 8 * 1024 * 1024:
        raise ValueError("manifest is too large")
    _validate_artifact_directory(manifest_path, manifest_sha256_path, bundle_path)
    try:
        sidecar = manifest_sha256_path.read_text(encoding="ascii")
    except (OSError, UnicodeDecodeError) as exc:
        raise ValueError("manifest sha256 sidecar is unavailable") from exc
    if sidecar != f"{manifest_digest}  {MANIFEST_NAME}\n":
        raise ValueError("manifest sha256 sidecar does not bind this manifest")

    payload = _load_json(manifest_path)
    _require_exact_keys(
        payload,
        {"schemaVersion", "kind", "repository", "executionSha", "base", "targetBranch", "bundle", "files"},
        "publication manifest",
    )
    if payload["schemaVersion"] != SCHEMA_VERSION or payload["kind"] != "daily-data-publication":
        raise ValueError("publication manifest schema is unsupported")
    if payload["repository"] != expected_repository:
        raise ValueError("publication manifest repository does not match this workflow")
    if payload["executionSha"] != expected_execution_sha or not SHA1_RE.fullmatch(payload["executionSha"]):
        raise ValueError("publication manifest execution SHA does not match the triggering SHA")
    if payload["targetBranch"] != expected_target_branch:
        raise ValueError("publication manifest target branch does not match")
    base = payload["base"]
    if not isinstance(base, dict):
        raise ValueError("publication manifest base must be an object")
    _require_exact_keys(base, {"sha", "tree"}, "publication manifest base")
    if base["sha"] != expected_base_sha or base["tree"] != expected_base_tree:
        raise ValueError("publication manifest base does not match the verified target")
    if not SHA1_RE.fullmatch(base["sha"]) or not SHA1_RE.fullmatch(base["tree"]):
        raise ValueError("publication manifest base identifiers are invalid")

    bundle = payload["bundle"]
    if not isinstance(bundle, dict):
        raise ValueError("publication manifest bundle must be an object")
    _require_exact_keys(bundle, {"path", "size", "sha256"}, "publication manifest bundle")
    if bundle["path"] != BUNDLE_NAME:
        raise ValueError("publication manifest bundle name is invalid")
    if isinstance(bundle["size"], bool) or not isinstance(bundle["size"], int) or bundle["size"] < 0:
        raise ValueError("publication manifest bundle size is invalid")
    if not isinstance(bundle["sha256"], str) or not SHA256_RE.fullmatch(bundle["sha256"]):
        raise ValueError("publication manifest bundle sha256 is invalid")
    bundle_size, bundle_digest = _sha256_file(bundle_path)
    if bundle_size != bundle["size"] or bundle_digest != bundle["sha256"]:
        raise ValueError("publication bundle does not match its manifest")

    entries = payload["files"]
    if not isinstance(entries, list):
        raise ValueError("publication manifest files must be a list")
    validated = [_validate_file_entry(entry) for entry in entries]
    paths = [entry["path"] for entry in validated]
    if paths != sorted(paths) or len(paths) != len(set(paths)):
        raise ValueError("publication manifest paths must be sorted and unique")
    if sum(entry["size"] for entry in validated) > MAX_TOTAL_BYTES:
        raise ValueError("publication bundle data exceeds the allowed total size")
    payload["files"] = validated
    payload["manifestSha256"] = manifest_digest
    payload["artifactDigest"] = expected_artifact_digest
    return payload


def _mkdir_no_symlink(path: Path) -> None:
    if path.exists() or path.is_symlink():
        file_stat = os.lstat(path)
        if not stat.S_ISDIR(file_stat.st_mode) or stat.S_ISLNK(file_stat.st_mode):
            raise ValueError(f"unsafe destination directory: {path}")
        return
    path.mkdir(mode=0o700)
    file_stat = os.lstat(path)
    if not stat.S_ISDIR(file_stat.st_mode) or stat.S_ISLNK(file_stat.st_mode):
        raise ValueError(f"unsafe destination directory: {path}")


def _destination_for(root: Path, relative_path: str) -> Path:
    target = root
    for component in relative_path.split("/")[:-1]:
        target = target / component
        _mkdir_no_symlink(target)
    return target / relative_path.split("/")[-1]


def extract_bundle(payload: dict, bundle_path: Path, destination: Path) -> None:
    if destination.exists() or destination.is_symlink():
        raise ValueError("extraction destination must not already exist")
    _mkdir_no_symlink(destination)
    expected: Dict[str, dict] = {entry["path"]: entry for entry in payload["files"]}
    extracted = set()
    try:
        with tarfile.open(bundle_path, mode="r:") as archive:
            for member in archive:
                if member.name not in expected:
                    raise ValueError("publication bundle contains an unexpected member")
                if member.name in extracted or not member.isreg() or member.issym() or member.islnk():
                    raise ValueError("publication bundle member type is unsafe")
                entry = expected[member.name]
                if member.size != entry["size"] or format(member.mode, "04o") != entry["mode"]:
                    raise ValueError("publication bundle member metadata does not match the manifest")
                source = archive.extractfile(member)
                if source is None:
                    raise ValueError("publication bundle member cannot be read")
                target = _destination_for(destination, member.name)
                descriptor = os.open(str(target), os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
                digest = hashlib.sha256()
                written = 0
                try:
                    with os.fdopen(descriptor, "wb", closefd=True) as output:
                        while True:
                            chunk = source.read(1024 * 1024)
                            if not chunk:
                                break
                            written += len(chunk)
                            if written > entry["size"]:
                                raise ValueError("publication bundle member exceeds its declared size")
                            digest.update(chunk)
                            output.write(chunk)
                        output.flush()
                        os.fsync(output.fileno())
                finally:
                    source.close()
                if written != entry["size"] or digest.hexdigest() != entry["sha256"]:
                    raise ValueError("publication bundle member digest does not match the manifest")
                os.chmod(target, int(entry["mode"], 8))
                extracted.add(member.name)
    except (tarfile.TarError, OSError) as exc:
        raise ValueError("publication bundle extraction failed") from exc
    if extracted != set(expected):
        raise ValueError("publication bundle is missing manifest members")


def _iter_managed_target_files(root: Path) -> Iterable[Tuple[str, Path]]:
    for allowed_root in ALLOWED_ROOTS:
        current = root / allowed_root.rstrip("/")
        if not current.exists():
            continue
        if current.is_symlink() or not current.is_dir():
            raise ValueError("target data root is unsafe")
        for directory, directories, filenames in os.walk(current, followlinks=False):
            directory_path = Path(directory)
            for name in directories:
                candidate = directory_path / name
                if candidate.is_symlink():
                    raise ValueError("target data directory symlink is unsafe")
            for name in filenames:
                candidate = directory_path / name
                relative = candidate.relative_to(root).as_posix()
                if _is_allowed_data_path(relative):
                    if candidate.is_symlink() or not candidate.is_file():
                        raise ValueError("target data file is unsafe")
                    yield relative, candidate


def apply_bundle(payload: dict, extracted_root: Path, target_root: Path) -> None:
    if target_root.is_symlink() or not target_root.is_dir():
        raise ValueError("target repository root is unsafe")
    expected: Dict[str, dict] = {entry["path"]: entry for entry in payload["files"]}
    for relative, target in _iter_managed_target_files(target_root):
        if relative not in expected:
            target.unlink()
    for relative, entry in expected.items():
        source = extracted_root / relative
        source_size, source_digest = _sha256_file(source)
        if source_size != entry["size"] or source_digest != entry["sha256"]:
            raise ValueError("validated extraction changed before publication")
        target = _destination_for(target_root, relative)
        if target.exists() or target.is_symlink():
            target_stat = os.lstat(target)
            if stat.S_ISLNK(target_stat.st_mode) or not stat.S_ISREG(target_stat.st_mode):
                raise ValueError("target publication path is unsafe")
        temporary = target.with_name(f".{target.name}.publish.tmp")
        if temporary.exists() or temporary.is_symlink():
            raise ValueError("publication temporary path already exists")
        with source.open("rb") as input_file, temporary.open("xb") as output_file:
            while True:
                chunk = input_file.read(1024 * 1024)
                if not chunk:
                    break
                output_file.write(chunk)
            output_file.flush()
            os.fsync(output_file.fileno())
        os.chmod(temporary, int(entry["mode"], 8))
        os.replace(temporary, target)


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("verify", "extract"):
        command_parser = subparsers.add_parser(command)
        command_parser.add_argument("--manifest", required=True)
        command_parser.add_argument("--manifest-sha256", required=True)
        command_parser.add_argument("--bundle", required=True)
        command_parser.add_argument("--expected-repository", required=True)
        command_parser.add_argument("--expected-execution-sha", required=True)
        command_parser.add_argument("--expected-target-branch", required=True)
        command_parser.add_argument("--expected-base-sha", required=True)
        command_parser.add_argument("--expected-base-tree", required=True)
        command_parser.add_argument("--expected-compute-manifest-sha256", required=True)
        command_parser.add_argument("--expected-artifact-digest", required=True)
        if command == "extract":
            command_parser.add_argument("--destination", required=True)
    apply_parser = subparsers.add_parser("apply")
    apply_parser.add_argument("--manifest", required=True)
    apply_parser.add_argument("--source", required=True)
    apply_parser.add_argument("--target", required=True)
    return parser.parse_args()


def main() -> int:
    args = _arguments()
    try:
        if args.command == "apply":
            payload = _load_json(Path(args.manifest))
            files = payload.get("files") if isinstance(payload, dict) else None
            if not isinstance(files, list):
                raise ValueError("publication manifest files are unavailable")
            entries = [_validate_file_entry(entry) for entry in files]
            paths = [entry["path"] for entry in entries]
            if paths != sorted(paths) or len(paths) != len(set(paths)):
                raise ValueError("publication manifest paths must be sorted and unique")
            if sum(entry["size"] for entry in entries) > MAX_TOTAL_BYTES:
                raise ValueError("publication bundle data exceeds the allowed total size")
            payload["files"] = entries
            apply_bundle(payload, Path(args.source), Path(args.target))
        else:
            payload = validate_manifest(
                Path(args.manifest),
                Path(args.manifest_sha256),
                Path(args.bundle),
                args.expected_repository,
                args.expected_execution_sha,
                args.expected_target_branch,
                args.expected_base_sha,
                args.expected_base_tree,
                args.expected_compute_manifest_sha256,
                args.expected_artifact_digest,
            )
            if args.command == "extract":
                extract_bundle(payload, Path(args.bundle), Path(args.destination))
            else:
                print(json.dumps({"manifestSha256": payload["manifestSha256"], "artifactDigest": payload["artifactDigest"]}, sort_keys=True))
    except ValueError as exc:
        print(f"[ERROR] daily publication bundle rejected: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
