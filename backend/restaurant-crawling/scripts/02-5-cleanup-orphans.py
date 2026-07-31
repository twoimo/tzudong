#!/usr/bin/env python3
"""Preview and guarded cleanup for orphan transcript JSONL files.

The script reports a canonical preview by default. Deletion requires a digest
bound to that exact preview and is only available through a no-follow
filesystem boundary.
"""

import argparse
import ctypes
import errno
import hashlib
import hmac
import json
import ntpath
import os
import re
import secrets
import stat
import sys

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import yaml


BACKEND_ROOT = Path(__file__).resolve().parents[2]
CHANNELS_CONFIG_PATH = BACKEND_ROOT / "config" / "channels.yaml"
MANIFEST_VERSION = 1
MAX_OPENED_FILE_BYTES = 8 * 1024 * 1024
MAX_JSONL_LINE_BYTES = 1024 * 1024
MAX_JSONL_LINES_PER_FILE = 50_000
MAX_AGGREGATE_PARSE_BYTES = 32 * 1024 * 1024
MAX_AGGREGATE_PARSE_LINES = 100_000
READ_CHUNK_BYTES = 64 * 1024
QUARANTINE_NAME_PREFIX = ".orphan-cleanup-quarantine-"
QUARANTINE_ATTEMPTS = 16
RENAME_NOREPLACE = 1
PREVIEW_DIGEST_RE = re.compile(r"[0-9a-f]{64}\Z")
WINDOWS_DEVICE_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "CONIN$",
    "CONOUT$",
    "CLOCK$",
    *(f"COM{number}" for number in range(1, 10)),
    *(f"LPT{number}" for number in range(1, 10)),
}
REPARSE_POINT_ATTRIBUTE = 0x0400


class CleanupFailure(Exception):
    """A fixed, privacy-safe failure code suitable for operator output."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class FileIdentity:
    device: int
    inode: int

    @classmethod
    def from_stat(cls, value: os.stat_result) -> "FileIdentity":
        return cls(device=value.st_dev, inode=value.st_ino)

    def manifest_value(self) -> Dict[str, int]:
        return {"device": self.device, "inode": self.inode}


@dataclass(frozen=True)
class FileSnapshot:
    identity: FileIdentity
    size: int
    mtime_ns: int
    sha256: str


@dataclass(frozen=True)
class LoadedFile:
    snapshot: FileSnapshot


@dataclass
class ParseBudget:
    bytes_used: int = 0
    lines_used: int = 0

    def consume_bytes(self, count: int) -> None:
        self.bytes_used += count
        if self.bytes_used > MAX_AGGREGATE_PARSE_BYTES:
            raise CleanupFailure("orphan_cleanup_entry_limits_exceeded")

    def consume_line(self) -> None:
        self.lines_used += 1
        if self.lines_used > MAX_AGGREGATE_PARSE_LINES:
            raise CleanupFailure("orphan_cleanup_entry_limits_exceeded")

@dataclass
class SafeDirectory:
    path: Path
    identity: FileIdentity
    fd: Optional[int]


@dataclass
class DirectoryBoundary:
    channel: SafeDirectory
    transcript: SafeDirectory
    meta: Optional[SafeDirectory]

    def close(self) -> None:
        for directory in (self.meta, self.transcript, self.channel):
            if directory is not None and directory.fd is not None:
                try:
                    os.close(directory.fd)
                except OSError:
                    pass
                directory.fd = None


@dataclass(frozen=True)
class OrphanCandidate:
    name: str
    reason: str
    transcript: FileSnapshot
    metadata: Optional[FileSnapshot]
    metadata_directory_missing: bool


@dataclass
class ScanResult:
    boundary: DirectoryBoundary
    transcript_names: Tuple[str, ...]
    candidates: List[OrphanCandidate]


@dataclass(frozen=True)
class ResolvedChannel:
    selector: str
    data_directory: Path


def _emit_error(code: str) -> None:
    print(f"[ERROR] code={code}", file=sys.stderr)


def _emit_status(code: str, **fields: Any) -> None:
    details = " ".join(f"{key}={value}" for key, value in sorted(fields.items()))
    suffix = f" {details}" if details else ""
    print(f"[OK] code={code}{suffix}", file=sys.stderr)


def _canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


def _preview_digest(manifest: Dict[str, Any]) -> str:
    return hashlib.sha256(_canonical_json(manifest).encode("ascii")).hexdigest()


def _is_reparse_point(value: os.stat_result) -> bool:
    return bool(getattr(value, "st_file_attributes", 0) & REPARSE_POINT_ATTRIBUTE)


def _is_safe_directory_stat(value: os.stat_result) -> bool:
    return stat.S_ISDIR(value.st_mode) and not _is_reparse_point(value)


def _is_safe_regular_file_stat(value: os.stat_result) -> bool:
    return (
        stat.S_ISREG(value.st_mode)
        and not _is_reparse_point(value)
        and value.st_nlink == 1
    )


def _supports_no_follow_directory_boundary() -> bool:
    """Return whether Python can hold and unlink through no-follow dir FDs."""
    return (
        os.name == "posix"
        and hasattr(os, "O_DIRECTORY")
        and hasattr(os, "O_NOFOLLOW")
        and os.open in os.supports_dir_fd
        and os.lstat in os.supports_dir_fd
        and os.unlink in os.supports_dir_fd
        and os.listdir in os.supports_fd
    )


def _channel_selector_is_safe(channel: str) -> bool:
    if not channel or any(ord(character) < 32 or ord(character) == 127 for character in channel):
        return False
    if "/" in channel or "\\" in channel or ":" in channel:
        return False
    if os.path.isabs(channel) or ntpath.isabs(channel) or ntpath.splitdrive(channel)[0]:
        return False
    device_stem = channel.split(".", 1)[0].rstrip(" .").upper()
    return device_stem not in WINDOWS_DEVICE_NAMES


def _load_canonical_channels() -> Dict[str, Dict[str, Any]]:
    try:
        with CHANNELS_CONFIG_PATH.open("r", encoding="utf-8") as config_file:
            configuration = yaml.safe_load(config_file)
    except Exception:
        raise CleanupFailure("orphan_cleanup_channel_config_unavailable")

    channels = configuration.get("channels") if isinstance(configuration, dict) else None
    if not isinstance(channels, dict):
        raise CleanupFailure("orphan_cleanup_channel_config_invalid")

    result: Dict[str, Dict[str, Any]] = {}
    for key, value in channels.items():
        if isinstance(key, str) and isinstance(value, dict):
            result[key] = value
    return result


def _configured_relative_path(value: Any) -> Optional[Path]:
    if not isinstance(value, str) or not value or "\x00" in value:
        return None
    if os.path.isabs(value) or ntpath.isabs(value) or ntpath.splitdrive(value)[0]:
        return None

    parts = value.replace("\\", "/").split("/")
    if any(part in {"", ".", ".."} for part in parts):
        return None
    return Path(*parts)


def resolve_channel(channel: str) -> ResolvedChannel:
    if not _channel_selector_is_safe(channel):
        raise CleanupFailure("orphan_cleanup_channel_invalid")

    channels = _load_canonical_channels()
    entry = channels.get(channel)
    if entry is None:
        raise CleanupFailure("orphan_cleanup_channel_unconfigured")

    relative_data_path = _configured_relative_path(entry.get("data_path"))
    if relative_data_path is None:
        raise CleanupFailure("orphan_cleanup_channel_config_invalid")

    return ResolvedChannel(selector=channel, data_directory=BACKEND_ROOT / relative_data_path)


def _path_lstat(path: Path, missing_code: str, allow_missing: bool = False) -> Optional[os.stat_result]:
    try:
        return os.lstat(path)
    except FileNotFoundError:
        if allow_missing:
            return None
        raise CleanupFailure(missing_code)
    except OSError:
        raise CleanupFailure(missing_code)


def _required_directory(path: Path, missing_code: str, unsafe_code: str) -> os.stat_result:
    value = _path_lstat(path, missing_code)
    assert value is not None
    if not _is_safe_directory_stat(value):
        raise CleanupFailure(unsafe_code)
    return value


def _optional_directory(path: Path, unsafe_code: str) -> Optional[os.stat_result]:
    value = _path_lstat(path, unsafe_code, allow_missing=True)
    if value is not None and not _is_safe_directory_stat(value):
        raise CleanupFailure(unsafe_code)
    return value


def _directory_flags() -> int:
    return os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0)


def _open_directory(
    path: Path,
    expected: os.stat_result,
    error_code: str,
    parent_fd: Optional[int] = None,
    name: Optional[str] = None,
) -> SafeDirectory:
    try:
        if parent_fd is None:
            descriptor = os.open(os.fspath(path), _directory_flags())
        else:
            assert name is not None
            descriptor = os.open(name, _directory_flags(), dir_fd=parent_fd)
    except OSError:
        raise CleanupFailure(error_code)

    try:
        actual = os.fstat(descriptor)
        if not _is_safe_directory_stat(actual) or FileIdentity.from_stat(actual) != FileIdentity.from_stat(expected):
            raise CleanupFailure(error_code)
        return SafeDirectory(path=path, identity=FileIdentity.from_stat(actual), fd=descriptor)
    except CleanupFailure:
        try:
            os.close(descriptor)
        except OSError:
            pass
        raise
    except OSError:
        try:
            os.close(descriptor)
        except OSError:
            pass
        raise CleanupFailure(error_code)


def _channel_path_parts(data_directory: Path) -> Tuple[str, ...]:
    try:
        relative = data_directory.relative_to(BACKEND_ROOT)
    except ValueError:
        raise CleanupFailure("orphan_cleanup_channel_config_invalid")
    if not relative.parts:
        raise CleanupFailure("orphan_cleanup_channel_config_invalid")
    return relative.parts


def _validated_channel_directory(data_directory: Path) -> Tuple[os.stat_result, Tuple[str, ...]]:
    parts = _channel_path_parts(data_directory)
    current = BACKEND_ROOT
    current_stat = _required_directory(
        current,
        "orphan_cleanup_channel_directory_missing",
        "orphan_cleanup_channel_directory_unsafe",
    )
    for part in parts:
        current = current / part
        current_stat = _required_directory(
            current,
            "orphan_cleanup_channel_directory_missing",
            "orphan_cleanup_channel_directory_unsafe",
        )
    return current_stat, parts


def _close_directory_fd(directory: SafeDirectory) -> None:
    if directory.fd is not None:
        try:
            os.close(directory.fd)
        except OSError:
            pass
        directory.fd = None


def _open_channel_directory(data_directory: Path, parts: Tuple[str, ...]) -> SafeDirectory:
    root_stat = _required_directory(
        BACKEND_ROOT,
        "orphan_cleanup_channel_directory_missing",
        "orphan_cleanup_channel_directory_unsafe",
    )
    current = _open_directory(
        BACKEND_ROOT,
        root_stat,
        "orphan_cleanup_channel_directory_unsafe",
    )
    current_path = BACKEND_ROOT
    try:
        for part in parts:
            current_path = current_path / part
            expected = _required_directory(
                current_path,
                "orphan_cleanup_channel_directory_missing",
                "orphan_cleanup_channel_directory_unsafe",
            )
            next_directory = _open_directory(
                current_path,
                expected,
                "orphan_cleanup_channel_directory_unsafe",
                parent_fd=current.fd,
                name=part,
            )
            _close_directory_fd(current)
            current = next_directory
        if current.path != data_directory:
            raise CleanupFailure("orphan_cleanup_channel_config_invalid")
        return current
    except Exception:
        _close_directory_fd(current)
        raise


def _open_directory_boundary(data_directory: Path) -> DirectoryBoundary:
    channel_stat, channel_parts = _validated_channel_directory(data_directory)
    transcript_path = data_directory / "transcript"
    transcript_stat = _required_directory(
        transcript_path,
        "orphan_cleanup_transcript_directory_missing",
        "orphan_cleanup_transcript_directory_unsafe",
    )
    meta_path = data_directory / "meta"
    meta_stat = _optional_directory(meta_path, "orphan_cleanup_meta_directory_unsafe")

    if not _supports_no_follow_directory_boundary():
        return DirectoryBoundary(
            channel=SafeDirectory(data_directory, FileIdentity.from_stat(channel_stat), None),
            transcript=SafeDirectory(transcript_path, FileIdentity.from_stat(transcript_stat), None),
            meta=(
                SafeDirectory(meta_path, FileIdentity.from_stat(meta_stat), None)
                if meta_stat is not None
                else None
            ),
        )

    channel = _open_channel_directory(data_directory, channel_parts)
    try:
        transcript = _open_directory(
            transcript_path,
            transcript_stat,
            "orphan_cleanup_transcript_directory_unsafe",
            parent_fd=channel.fd,
            name="transcript",
        )
        try:
            meta = (
                _open_directory(
                    meta_path,
                    meta_stat,
                    "orphan_cleanup_meta_directory_unsafe",
                    parent_fd=channel.fd,
                    name="meta",
                )
                if meta_stat is not None
                else None
            )
        except Exception:
            _close_directory_fd(transcript)
            raise
    except Exception:
        _close_directory_fd(channel)
        raise

    return DirectoryBoundary(channel=channel, transcript=transcript, meta=meta)


def _lstat_child(directory: SafeDirectory, name: str) -> Optional[os.stat_result]:
    try:
        if directory.fd is not None:
            return os.lstat(name, dir_fd=directory.fd)
        return os.lstat(directory.path / name)
    except FileNotFoundError:
        return None
    except OSError:
        raise CleanupFailure("orphan_cleanup_entry_unavailable")


def _read_regular_file(
    directory: SafeDirectory,
    name: str,
    budget: ParseBudget,
    line_consumer: Optional[Callable[[bytes], None]] = None,
) -> Optional[LoadedFile]:
    before = _lstat_child(directory, name)
    if before is None:
        return None
    if not _is_safe_regular_file_stat(before):
        raise CleanupFailure("orphan_cleanup_entry_unsafe")

    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    if directory.fd is not None:
        flags |= os.O_NOFOLLOW

    try:
        if directory.fd is not None:
            descriptor = os.open(name, flags, dir_fd=directory.fd)
        else:
            descriptor = os.open(os.fspath(directory.path / name), flags)
    except OSError:
        raise CleanupFailure("orphan_cleanup_entry_unavailable")

    try:
        opened = os.fstat(descriptor)
        if not _is_safe_regular_file_stat(opened) or FileIdentity.from_stat(opened) != FileIdentity.from_stat(before):
            raise CleanupFailure("orphan_cleanup_entry_unsafe")
        if opened.st_size > MAX_OPENED_FILE_BYTES:
            raise CleanupFailure("orphan_cleanup_entry_limits_exceeded")

        digest = hashlib.sha256()
        line_buffer = bytearray()
        file_line_count = 0

        def consume_line(line: bytes) -> None:
            nonlocal file_line_count
            file_line_count += 1
            if file_line_count > MAX_JSONL_LINES_PER_FILE:
                raise CleanupFailure("orphan_cleanup_entry_limits_exceeded")
            budget.consume_line()
            if line_consumer is not None:
                line_consumer(line)

        while True:
            chunk = os.read(descriptor, READ_CHUNK_BYTES)
            if not chunk:
                break
            budget.consume_bytes(len(chunk))
            digest.update(chunk)

            parts = chunk.split(b"\n")
            for segment in parts[:-1]:
                if len(line_buffer) + len(segment) > MAX_JSONL_LINE_BYTES:
                    raise CleanupFailure("orphan_cleanup_entry_limits_exceeded")
                line_buffer.extend(segment)
                consume_line(bytes(line_buffer))
                line_buffer.clear()
            if len(line_buffer) + len(parts[-1]) > MAX_JSONL_LINE_BYTES:
                raise CleanupFailure("orphan_cleanup_entry_limits_exceeded")
            line_buffer.extend(parts[-1])

        if line_buffer:
            consume_line(bytes(line_buffer))

        after = os.fstat(descriptor)
        path_after = _lstat_child(directory, name)
        if (
            path_after is None
            or not _is_safe_regular_file_stat(after)
            or FileIdentity.from_stat(after) != FileIdentity.from_stat(before)
            or FileIdentity.from_stat(path_after) != FileIdentity.from_stat(before)
            or after.st_size != opened.st_size
            or after.st_mtime_ns != opened.st_mtime_ns
        ):
            raise CleanupFailure("orphan_cleanup_entry_changed")

        snapshot = FileSnapshot(
            identity=FileIdentity.from_stat(after),
            size=after.st_size,
            mtime_ns=after.st_mtime_ns,
            sha256=digest.hexdigest(),
        )
        return LoadedFile(snapshot=snapshot)
    except CleanupFailure:
        raise
    except OSError:
        raise CleanupFailure("orphan_cleanup_entry_unavailable")
    finally:
        try:
            os.close(descriptor)
        except OSError:
            pass


def _last_json_object_line(line: Optional[bytes]) -> Optional[Dict[str, Any]]:
    if line is None:
        return None
    try:
        value = json.loads(line)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) and value else None


def _read_transcript_file(
    directory: SafeDirectory,
    name: str,
    budget: ParseBudget,
) -> Tuple[Optional[LoadedFile], Optional[Dict[str, Any]]]:
    last_line: Optional[bytes] = None

    def capture_last_line(line: bytes) -> None:
        nonlocal last_line
        last_line = line

    loaded = _read_regular_file(directory, name, budget, capture_last_line)
    return loaded, _last_json_object_line(last_line)


def _read_metadata_file(
    directory: SafeDirectory,
    name: str,
    budget: ParseBudget,
    recollect_id: Any,
    parse_recollect_id: bool,
) -> Tuple[Optional[LoadedFile], bool]:
    matched = False

    def match_recollect_id(line: bytes) -> None:
        nonlocal matched
        if matched or not line.strip():
            return
        try:
            metadata = json.loads(line)
        except (UnicodeDecodeError, json.JSONDecodeError):
            return
        if isinstance(metadata, dict) and metadata.get("recollect_id") == recollect_id:
            matched = True

    loaded = _read_regular_file(
        directory,
        name,
        budget,
        match_recollect_id if parse_recollect_id else None,
    )
    return loaded, matched


def _scan_candidate(
    boundary: DirectoryBoundary,
    name: str,
    budget: ParseBudget,
) -> Optional[OrphanCandidate]:
    transcript, transcript_data = _read_transcript_file(boundary.transcript, name, budget)
    if transcript is None:
        raise CleanupFailure("orphan_cleanup_entry_changed")

    metadata_directory_missing = boundary.meta is None
    metadata: Optional[LoadedFile]
    metadata_matches = False
    if boundary.meta is None:
        metadata = None
    else:
        metadata, metadata_matches = _read_metadata_file(
            boundary.meta,
            name,
            budget,
            transcript_data.get("recollect_id", 0) if transcript_data is not None else None,
            transcript_data is not None,
        )
    if boundary.meta is None or metadata is None:
        return OrphanCandidate(
            name=name,
            reason="metadata_missing",
            transcript=transcript.snapshot,
            metadata=None,
            metadata_directory_missing=metadata_directory_missing,
        )

    if transcript_data is None:
        return OrphanCandidate(
            name=name,
            reason="transcript_invalid",
            transcript=transcript.snapshot,
            metadata=metadata.snapshot,
            metadata_directory_missing=False,
        )

    if not metadata_matches:
        return OrphanCandidate(
            name=name,
            reason="metadata_recollect_id_missing",
            transcript=transcript.snapshot,
            metadata=metadata.snapshot,
            metadata_directory_missing=False,
        )
    return None


def _direct_jsonl_names(directory: SafeDirectory) -> Tuple[str, ...]:
    try:
        names = os.listdir(directory.fd) if directory.fd is not None else os.listdir(directory.path)
    except OSError:
        raise CleanupFailure("orphan_cleanup_transcript_directory_unavailable")
    return tuple(sorted(name for name in names if name.endswith(".jsonl")))


def scan_orphans(boundary: DirectoryBoundary) -> ScanResult:
    transcript_names = _direct_jsonl_names(boundary.transcript)
    candidates: List[OrphanCandidate] = []
    budget = ParseBudget()
    for name in transcript_names:
        candidate = _scan_candidate(boundary, name, budget)
        if candidate is not None:
            candidates.append(candidate)
    return ScanResult(boundary=boundary, transcript_names=transcript_names, candidates=candidates)


def preview_manifest(channel: str, candidates: Sequence[OrphanCandidate]) -> Dict[str, Any]:
    return {
        "candidates": [
            {
                "identity": candidate.transcript.identity.manifest_value(),
                "name": candidate.name,
                "reason": candidate.reason,
                "sha256": candidate.transcript.sha256,
                "size": candidate.transcript.size,
            }
            for candidate in sorted(candidates, key=lambda candidate: candidate.name)
        ],
        "channel": channel,
        "version": MANIFEST_VERSION,
    }


def _same_snapshot(left: FileSnapshot, right: FileSnapshot) -> bool:
    return (
        left.identity == right.identity
        and left.size == right.size
        and left.mtime_ns == right.mtime_ns
        and hmac.compare_digest(left.sha256, right.sha256)
    )


def _directory_matches(path: Path, expected: FileIdentity) -> bool:
    try:
        current = os.lstat(path)
    except OSError:
        return False
    return _is_safe_directory_stat(current) and FileIdentity.from_stat(current) == expected


def _revalidate_boundary(boundary: DirectoryBoundary) -> None:
    try:
        current_channel = _open_channel_directory(
            boundary.channel.path,
            _channel_path_parts(boundary.channel.path),
        )
    except CleanupFailure:
        raise CleanupFailure("orphan_cleanup_apply_revalidation_failed")

    try:
        if current_channel.identity != boundary.channel.identity:
            raise CleanupFailure("orphan_cleanup_apply_revalidation_failed")
    finally:
        _close_directory_fd(current_channel)

    if not _directory_matches(boundary.transcript.path, boundary.transcript.identity):
        raise CleanupFailure("orphan_cleanup_apply_revalidation_failed")

    if boundary.meta is None:
        if _path_lstat(
            boundary.channel.path / "meta",
            "orphan_cleanup_apply_revalidation_failed",
            allow_missing=True,
        ) is not None:
            raise CleanupFailure("orphan_cleanup_apply_revalidation_failed")
    elif not _directory_matches(boundary.meta.path, boundary.meta.identity):
        raise CleanupFailure("orphan_cleanup_apply_revalidation_failed")


def _candidate_reason(
    transcript_data: Optional[Dict[str, Any]],
    metadata: Optional[LoadedFile],
    metadata_matches: bool,
) -> str:
    if metadata is None:
        return "metadata_missing"
    if transcript_data is None:
        return "transcript_invalid"
    if not metadata_matches:
        return "metadata_recollect_id_missing"
    return "not_orphan"


def _revalidate_candidate(
    boundary: DirectoryBoundary,
    candidate: OrphanCandidate,
    transcript_name: str,
    budget: ParseBudget,
) -> None:
    _revalidate_boundary(boundary)
    transcript, transcript_data = _read_transcript_file(
        boundary.transcript,
        transcript_name,
        budget,
    )
    if transcript is None or not _same_snapshot(transcript.snapshot, candidate.transcript):
        raise CleanupFailure("orphan_cleanup_apply_revalidation_failed")

    metadata_matches = False
    if candidate.metadata_directory_missing:
        if boundary.meta is not None:
            raise CleanupFailure("orphan_cleanup_apply_revalidation_failed")
        metadata = None
    else:
        if boundary.meta is None:
            raise CleanupFailure("orphan_cleanup_apply_revalidation_failed")
        metadata, metadata_matches = _read_metadata_file(
            boundary.meta,
            candidate.name,
            budget,
            transcript_data.get("recollect_id", 0) if transcript_data is not None else None,
            transcript_data is not None,
        )
        if candidate.metadata is None:
            if metadata is not None:
                raise CleanupFailure("orphan_cleanup_apply_revalidation_failed")
        elif metadata is None or not _same_snapshot(metadata.snapshot, candidate.metadata):
            raise CleanupFailure("orphan_cleanup_apply_revalidation_failed")

    if _candidate_reason(transcript_data, metadata, metadata_matches) != candidate.reason:
        raise CleanupFailure("orphan_cleanup_apply_revalidation_failed")


def _rename_no_replace(directory: SafeDirectory, source: str, destination: str) -> bool:
    """Move within the held directory without overwriting a quarantine collision."""
    if directory.fd is None or os.name != "posix":
        raise CleanupFailure("orphan_cleanup_quarantine_unavailable")
    try:
        renameat2 = ctypes.CDLL(None, use_errno=True).renameat2
    except (AttributeError, OSError):
        raise CleanupFailure("orphan_cleanup_quarantine_unavailable")

    renameat2.argtypes = [
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_int,
        ctypes.c_char_p,
        ctypes.c_uint,
    ]
    renameat2.restype = ctypes.c_int
    if renameat2(
        directory.fd,
        os.fsencode(source),
        directory.fd,
        os.fsencode(destination),
        RENAME_NOREPLACE,
    ) == 0:
        return True

    failure = ctypes.get_errno()
    if failure == errno.EEXIST:
        return False
    if failure in {errno.ENOSYS, errno.EINVAL, errno.ENOTSUP}:
        raise CleanupFailure("orphan_cleanup_quarantine_unavailable")
    raise CleanupFailure("orphan_cleanup_quarantine_failed")


def _quarantine_candidate(boundary: DirectoryBoundary, candidate: OrphanCandidate) -> str:
    for _ in range(QUARANTINE_ATTEMPTS):
        quarantine_name = QUARANTINE_NAME_PREFIX + secrets.token_hex(32)
        try:
            moved = _rename_no_replace(boundary.transcript, candidate.name, quarantine_name)
        except CleanupFailure as error:
            if error.code == "orphan_cleanup_quarantine_unavailable":
                raise
            raise CleanupFailure("orphan_cleanup_apply_revalidation_failed")
        if moved:
            return quarantine_name
    raise CleanupFailure("orphan_cleanup_quarantine_collision")


def _restore_quarantine(
    boundary: DirectoryBoundary,
    quarantine_name: str,
    candidate_name: str,
) -> None:
    try:
        quarantined = _lstat_child(boundary.transcript, quarantine_name)
        if quarantined is None or not _is_safe_regular_file_stat(quarantined):
            return
        _rename_no_replace(boundary.transcript, quarantine_name, candidate_name)
    except CleanupFailure:
        return


def _restore_staged_candidates(
    boundary: DirectoryBoundary,
    staged: Sequence[Tuple[OrphanCandidate, str]],
) -> None:
    for candidate, quarantine_name in reversed(staged):
        _restore_quarantine(boundary, quarantine_name, candidate.name)


def apply_preview(scan: ScanResult) -> int:
    boundary = scan.boundary
    if not _supports_no_follow_directory_boundary() or boundary.transcript.fd is None:
        raise CleanupFailure("orphan_cleanup_apply_no_follow_unavailable")

    remaining_names = set(scan.transcript_names)
    staged: List[Tuple[OrphanCandidate, str]] = []
    budget = ParseBudget()
    try:
        for candidate in sorted(scan.candidates, key=lambda value: value.name):
            _revalidate_boundary(boundary)
            if set(_direct_jsonl_names(boundary.transcript)) != remaining_names:
                raise CleanupFailure("orphan_cleanup_apply_revalidation_failed")

            quarantine_name = _quarantine_candidate(boundary, candidate)
            try:
                _revalidate_candidate(boundary, candidate, quarantine_name, budget)
            except CleanupFailure:
                _restore_quarantine(boundary, quarantine_name, candidate.name)
                raise CleanupFailure("orphan_cleanup_apply_revalidation_failed")
            staged.append((candidate, quarantine_name))
            remaining_names.remove(candidate.name)
    except CleanupFailure:
        _restore_staged_candidates(boundary, staged)
        raise

    for _, quarantine_name in staged:
        try:
            os.unlink(quarantine_name, dir_fd=boundary.transcript.fd)
        except OSError:
            _restore_staged_candidates(boundary, staged)
            raise CleanupFailure("orphan_cleanup_delete_failed")
    return len(staged)


def _parse_args(argv: Optional[Sequence[str]]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Preview guarded orphan transcript cleanup")
    parser.add_argument("--channel", default="tzuyang", help="Exact configured channel identifier")
    parser.add_argument("--apply", action="store_true", help="Delete only after preview digest verification")
    parser.add_argument("--preview-digest", help="Exact SHA-256 digest from a prior preview")
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = _parse_args(argv)
    if args.apply and args.preview_digest is None:
        _emit_error("orphan_cleanup_preview_digest_required")
        return 1
    if not args.apply and args.preview_digest is not None:
        _emit_error("orphan_cleanup_apply_required")
        return 1
    if args.preview_digest is not None and PREVIEW_DIGEST_RE.fullmatch(args.preview_digest) is None:
        _emit_error("orphan_cleanup_preview_digest_invalid")
        return 1

    boundary: Optional[DirectoryBoundary] = None
    try:
        resolved = resolve_channel(args.channel)
        boundary = _open_directory_boundary(resolved.data_directory)
        scan = scan_orphans(boundary)
        manifest = preview_manifest(resolved.selector, scan.candidates)
        digest = _preview_digest(manifest)
        print(_canonical_json({"manifest": manifest, "preview_digest": digest}))

        if not args.apply:
            _emit_status(
                "orphan_cleanup_preview_complete",
                candidate_count=len(scan.candidates),
                deleted_count=0,
            )
            return 0

        if not hmac.compare_digest(args.preview_digest, digest):
            raise CleanupFailure("orphan_cleanup_preview_digest_mismatch")

        deleted_count = apply_preview(scan)
        _emit_status("orphan_cleanup_apply_complete", deleted_count=deleted_count)
        return 0
    except CleanupFailure as error:
        _emit_error(error.code)
        return 1
    except Exception:
        _emit_error("orphan_cleanup_unavailable")
        return 1
    finally:
        if boundary is not None:
            boundary.close()


if __name__ == "__main__":
    raise SystemExit(main())
