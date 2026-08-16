#!/usr/bin/env python3
"""Small stdlib helpers for ``backend/run_daily.sh``.

The helpers are intentionally Python 3.8-compatible because some backend worker
lanes still run with Python 3.8. Keep this file dependency-free: it is called by
cron/GitHub Actions before the rest of the Python environment is guaranteed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import secrets
import sys
import stat
import tarfile
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, NamedTuple, Optional, Sequence, Set, Tuple, Union


MAX_GDRIVE_MEDIA_BYTES = 512 * 1024 * 1024
MAX_GDRIVE_PATH_SEGMENT_BYTES = 128
MAX_GDRIVE_RELATIVE_PATH_BYTES = 1024
WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    "CLOCK$",
    *(f"COM{index}" for index in range(1, 10)),
    *(f"LPT{index}" for index in range(1, 10)),
}
FRAME_UPLOAD_EXTENSIONS = {".jpg", ".jpeg", ".webp"}
UPLOAD_SCHEMA_VERSION = 2
STRONG_COMPLETION_PROOFS = {"remote_manifest_check"}
QUEUE_STATES = {"pending_local", "staged", "missing_local", "remote_verified", "failed_permanent"}
TOP_LEVEL_STATUSES = {"skipped", "complete", "partial", "backfill_required", "backfill_complete", "failed"}
STEP_EVENT_STATUSES = {"completed", "failed", "optional_skipped", "downstream_skipped"}
MAX_GDRIVE_RECEIPT_BYTES = 8 * 1024 * 1024
MAX_RESIDUAL_QUEUE_BYTES = 8 * 1024 * 1024
REMOTE_VERIFICATION_RECEIPT_TYPE = "gdrive_remote_verification"
STAGING_MANIFEST_RECEIPT_TYPE = "gdrive_staging_manifest"
STAGING_ARCHIVE_RECEIPT_TYPE = "gdrive_staging_archive"
MIRROR_FILE_SUFFIXES = (".jsonl", ".json", ".txt")
MIRROR_EXCLUDED_NAMES = {"credentials.json", "cookies.txt"}
MAX_MIRROR_FILES = 50_000
MAX_MIRROR_BYTES = 2 * 1024 * 1024 * 1024
MIRROR_COPY_CHUNK_BYTES = 1024 * 1024

class _MirrorError(ValueError):
    def __init__(self, operation: str, detail: str) -> None:
        super().__init__(detail)
        self.operation = operation
        self.detail = detail


class _WindowsHandleInfo(NamedTuple):
    volume_serial: int
    file_index: int
    attributes: int
    reparse_tag: int
    link_count: int


class _RuntimeEntry(NamedTuple):
    stat: os.stat_result
    windows_info: Optional[_WindowsHandleInfo]


class _WindowsTrustedRoot(NamedTuple):
    path: Path
    descriptor: int
    entry: _RuntimeEntry
    handles: Tuple[int, ...]
    components: Tuple[str, ...]
    entries: Tuple[_RuntimeEntry, ...]

_ENTRY_UNCHECKED = object()
_WINDOWS_RUNTIME_TEST_HOOK = None
_WINDOWS_API = None


def _secure_dirfd_supported() -> bool:
    return bool(
        os.name == "posix"
        and getattr(os, "O_NOFOLLOW", 0)
        and os.open in os.supports_dir_fd
        and os.mkdir in os.supports_dir_fd
        and os.stat in os.supports_dir_fd
        and os.rename in os.supports_dir_fd
        and os.unlink in os.supports_dir_fd
        and os.link in os.supports_dir_fd
        and os.symlink in os.supports_dir_fd
        and os.readlink in os.supports_dir_fd
    )


def _windows_api() -> dict:
    global _WINDOWS_API
    if os.name != "nt":
        raise ValueError("Windows runtime primitives are unavailable")
    if _WINDOWS_API is not None:
        return _WINDOWS_API

    import ctypes
    import msvcrt
    from ctypes import wintypes

    class _FileTime(ctypes.Structure):
        _fields_ = [("low", wintypes.DWORD), ("high", wintypes.DWORD)]

    class _ByHandleFileInformation(ctypes.Structure):
        _fields_ = [
            ("attributes", wintypes.DWORD),
            ("creation_time", _FileTime),
            ("last_access_time", _FileTime),
            ("last_write_time", _FileTime),
            ("volume_serial", wintypes.DWORD),
            ("size_high", wintypes.DWORD),
            ("size_low", wintypes.DWORD),
            ("link_count", wintypes.DWORD),
            ("file_index_high", wintypes.DWORD),
            ("file_index_low", wintypes.DWORD),
        ]

    class _FileAttributeTagInfo(ctypes.Structure):
        _fields_ = [("attributes", wintypes.DWORD), ("reparse_tag", wintypes.DWORD)]

    class _SidAndAttributes(ctypes.Structure):
        _fields_ = [("sid", wintypes.LPVOID), ("attributes", wintypes.DWORD)]

    class _TokenUser(ctypes.Structure):
        _fields_ = [("user", _SidAndAttributes)]

    class _TokenOwner(ctypes.Structure):
        _fields_ = [("owner", wintypes.LPVOID)]

    class _TokenGroups(ctypes.Structure):
        _fields_ = [("count", wintypes.DWORD), ("groups", _SidAndAttributes * 1)]

    class _UnicodeString(ctypes.Structure):
        _fields_ = [
            ("length", wintypes.USHORT),
            ("maximum_length", wintypes.USHORT),
            ("buffer", wintypes.LPWSTR),
        ]

    class _ObjectAttributes(ctypes.Structure):
        _fields_ = [
            ("length", wintypes.ULONG),
            ("root_directory", wintypes.HANDLE),
            ("object_name", ctypes.POINTER(_UnicodeString)),
            ("attributes", wintypes.ULONG),
            ("security_descriptor", wintypes.LPVOID),
            ("security_quality_of_service", wintypes.LPVOID),
        ]

    class _IoStatusBlock(ctypes.Structure):
        _fields_ = [
            ("status", ctypes.c_long),
            ("information", ctypes.c_size_t),
        ]

    class _FileRenameInfo(ctypes.Structure):
        _fields_ = [
            ("replace_if_exists", wintypes.BOOL),
            ("root_directory", wintypes.HANDLE),
            ("file_name_length", wintypes.DWORD),
            ("file_name", wintypes.WCHAR * 1),
        ]

    class _FileDispositionInfo(ctypes.Structure):
        _fields_ = [("delete_file", wintypes.BOOL)]



    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
    ntdll = ctypes.WinDLL("ntdll", use_last_error=True)
    CreateFileW = kernel32.CreateFileW
    CreateFileW.argtypes = [
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.LPVOID,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    ]
    CreateFileW.restype = wintypes.HANDLE
    GetFileInformationByHandle = kernel32.GetFileInformationByHandle
    GetFileInformationByHandle.argtypes = [wintypes.HANDLE, ctypes.POINTER(_ByHandleFileInformation)]
    GetFileInformationByHandle.restype = wintypes.BOOL
    GetFileInformationByHandleEx = kernel32.GetFileInformationByHandleEx
    GetFileInformationByHandleEx.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        wintypes.LPVOID,
        wintypes.DWORD,
    ]
    GetFileInformationByHandleEx.restype = wintypes.BOOL
    GetFinalPathNameByHandleW = kernel32.GetFinalPathNameByHandleW
    GetFinalPathNameByHandleW.argtypes = [
        wintypes.HANDLE,
        wintypes.LPWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
    ]
    GetFinalPathNameByHandleW.restype = wintypes.DWORD
    MoveFileExW = kernel32.MoveFileExW
    MoveFileExW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD]
    MoveFileExW.restype = wintypes.BOOL
    DeleteFileW = kernel32.DeleteFileW
    DeleteFileW.argtypes = [wintypes.LPCWSTR]
    DeleteFileW.restype = wintypes.BOOL
    CloseHandle = kernel32.CloseHandle
    CloseHandle.argtypes = [wintypes.HANDLE]
    CloseHandle.restype = wintypes.BOOL
    OpenProcessToken = advapi32.OpenProcessToken
    OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
    OpenProcessToken.restype = wintypes.BOOL
    GetTokenInformation = advapi32.GetTokenInformation
    GetTokenInformation.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        wintypes.LPVOID,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD),
    ]
    GetTokenInformation.restype = wintypes.BOOL
    GetSecurityInfo = advapi32.GetSecurityInfo
    GetSecurityInfo.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        wintypes.DWORD,
        ctypes.POINTER(wintypes.LPVOID),
        wintypes.LPVOID,
        wintypes.LPVOID,
        wintypes.LPVOID,
        ctypes.POINTER(wintypes.LPVOID),
    ]
    GetSecurityInfo.restype = wintypes.DWORD
    EqualSid = advapi32.EqualSid
    EqualSid.argtypes = [wintypes.LPVOID, wintypes.LPVOID]
    EqualSid.restype = wintypes.BOOL
    LocalFree = kernel32.LocalFree
    LocalFree.argtypes = [wintypes.HLOCAL]
    LocalFree.restype = wintypes.HLOCAL
    SetFileInformationByHandle = kernel32.SetFileInformationByHandle
    SetFileInformationByHandle.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        wintypes.LPVOID,
        wintypes.DWORD,
    ]
    SetFileInformationByHandle.restype = wintypes.BOOL
    NtCreateFile = ntdll.NtCreateFile
    NtCreateFile.argtypes = [
        ctypes.POINTER(wintypes.HANDLE),
        wintypes.DWORD,
        ctypes.POINTER(_ObjectAttributes),
        ctypes.POINTER(_IoStatusBlock),
        wintypes.LPVOID,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.LPVOID,
        wintypes.ULONG,
    ]
    NtCreateFile.restype = ctypes.c_long
    RtlNtStatusToDosError = ntdll.RtlNtStatusToDosError
    RtlNtStatusToDosError.argtypes = [ctypes.c_long]
    RtlNtStatusToDosError.restype = wintypes.ULONG
    _WINDOWS_API = {
        "ctypes": ctypes,
        "msvcrt": msvcrt,
        "wintypes": wintypes,
        "ByHandleFileInformation": _ByHandleFileInformation,
        "FileAttributeTagInfo": _FileAttributeTagInfo,
        "FileRenameInfo": _FileRenameInfo,
        "FileDispositionInfo": _FileDispositionInfo,
        "UnicodeString": _UnicodeString,
        "ObjectAttributes": _ObjectAttributes,
        "IoStatusBlock": _IoStatusBlock,
        "TokenUser": _TokenUser,
        "TokenOwner": _TokenOwner,
        "TokenGroups": _TokenGroups,
        "CreateFileW": CreateFileW,
        "GetFileInformationByHandle": GetFileInformationByHandle,
        "GetFileInformationByHandleEx": GetFileInformationByHandleEx,
        "GetFinalPathNameByHandleW": GetFinalPathNameByHandleW,
        "MoveFileExW": MoveFileExW,
        "DeleteFileW": DeleteFileW,
        "SetFileInformationByHandle": SetFileInformationByHandle,
        "NtCreateFile": NtCreateFile,
        "RtlNtStatusToDosError": RtlNtStatusToDosError,
        "CloseHandle": CloseHandle,
        "OpenProcessToken": OpenProcessToken,
        "GetTokenInformation": GetTokenInformation,
        "GetSecurityInfo": GetSecurityInfo,
        "EqualSid": EqualSid,
        "LocalFree": LocalFree,
        "GENERIC_READ": 0x80000000,
        "GENERIC_WRITE": 0x40000000,
        "DELETE": 0x00010000,
        "READ_CONTROL": 0x00020000,
        "SYNCHRONIZE": 0x00100000,
        "FILE_SHARE_READ": 0x00000001,
        "FILE_SHARE_WRITE": 0x00000002,
        "FILE_SHARE_DELETE": 0x00000004,
        "CREATE_NEW": 1,
        "OPEN_EXISTING": 3,
        "FILE_OPEN": 1,
        "FILE_CREATE": 2,
        "FILE_ATTRIBUTE_NORMAL": 0x00000080,
        "FILE_ATTRIBUTE_REPARSE_POINT": 0x00000400,
        "FILE_FLAG_BACKUP_SEMANTICS": 0x02000000,
        "FILE_FLAG_OPEN_REPARSE_POINT": 0x00200000,
        "FILE_OPEN_REPARSE_POINT": 0x00200000,
        "FILE_NAME_NORMALIZED": 0x0,
        "FILE_ATTRIBUTE_DIRECTORY": 0x00000010,
        "FILE_DIRECTORY_FILE": 0x00000001,
        "FILE_NON_DIRECTORY_FILE": 0x00000040,
        "FILE_SYNCHRONOUS_IO_NONALERT": 0x00000020,
        "OBJ_CASE_INSENSITIVE": 0x00000040,
        "FILE_RENAME_INFO": 3,
        "FILE_DISPOSITION_INFO": 4,
        "FILE_ATTRIBUTE_TAG_INFO": 9,
        "MOVEFILE_REPLACE_EXISTING": 0x00000001,
        "MOVEFILE_WRITE_THROUGH": 0x00000008,
        "TOKEN_QUERY": 0x0008,
        "TOKEN_USER": 1,
        "TOKEN_OWNER": 4,
        "TOKEN_GROUPS": 2,
        "OWNER_SECURITY_INFORMATION": 0x00000001,
        "SE_FILE_OBJECT": 1,
        "ERROR_FILE_NOT_FOUND": 2,
        "ERROR_PATH_NOT_FOUND": 3,
        "ERROR_FILE_EXISTS": 80,
        "ERROR_ALREADY_EXISTS": 183,
        "ERROR_INSUFFICIENT_BUFFER": 122,
    }
    return _WINDOWS_API


def _windows_runtime_supported() -> bool:
    if os.name != "nt":
        return False
    try:
        _windows_api()
    except (AttributeError, ImportError, OSError):
        return False
    return True


def _raise_windows_error(path: Path, error: int) -> None:
    api = _windows_api()
    message = api["ctypes"].FormatError(error)
    if error in {api["ERROR_FILE_NOT_FOUND"], api["ERROR_PATH_NOT_FOUND"]}:
        raise FileNotFoundError(error, message, str(path))
    if error in {5, 32}:
        raise PermissionError(error, message, str(path))
    if error in {api["ERROR_FILE_EXISTS"], api["ERROR_ALREADY_EXISTS"]}:
        raise FileExistsError(error, message, str(path))
    raise OSError(error, message, str(path))


def _windows_handle_info(file_descriptor: int) -> _WindowsHandleInfo:
    api = _windows_api()
    raw_handle = api["msvcrt"].get_osfhandle(file_descriptor)
    if raw_handle == -1:
        raise ValueError("Windows runtime handle is unavailable")
    file_info = api["ByHandleFileInformation"]()
    if not api["GetFileInformationByHandle"](raw_handle, api["ctypes"].byref(file_info)):
        _raise_windows_error(Path("<runtime handle>"), api["ctypes"].get_last_error())
    tag_info = api["FileAttributeTagInfo"]()
    if not api["GetFileInformationByHandleEx"](
        raw_handle,
        api["FILE_ATTRIBUTE_TAG_INFO"],
        api["ctypes"].byref(tag_info),
        api["ctypes"].sizeof(tag_info),
    ):
        _raise_windows_error(Path("<runtime handle>"), api["ctypes"].get_last_error())
    return _WindowsHandleInfo(
        int(file_info.volume_serial),
        (int(file_info.file_index_high) << 32) | int(file_info.file_index_low),
        int(tag_info.attributes),
        int(tag_info.reparse_tag),
        int(file_info.link_count),
    )


def _windows_open_path(
    path: Path,
    *,
    access: int,
    disposition: int,
    descriptor_flags: int,
) -> Tuple[int, _RuntimeEntry]:
    api = _windows_api()
    raw_handle = api["CreateFileW"](
        str(path),
        access,
        api["FILE_SHARE_READ"] | api["FILE_SHARE_WRITE"],
        None,
        disposition,
        api["FILE_FLAG_BACKUP_SEMANTICS"] | api["FILE_FLAG_OPEN_REPARSE_POINT"],
        None,
    )
    invalid_handle = api["ctypes"].c_void_p(-1).value
    if raw_handle == invalid_handle:
        _raise_windows_error(path, api["ctypes"].get_last_error())
    try:
        file_descriptor = api["msvcrt"].open_osfhandle(raw_handle, descriptor_flags | getattr(os, "O_BINARY", 0))
    except BaseException:
        api["CloseHandle"](raw_handle)
        raise
    try:
        return file_descriptor, _RuntimeEntry(os.fstat(file_descriptor), _windows_handle_info(file_descriptor))
    except BaseException:
        os.close(file_descriptor)
        raise


def _windows_final_path(file_descriptor: int) -> Path:
    api = _windows_api()
    raw_handle = api["msvcrt"].get_osfhandle(file_descriptor)
    required = api["GetFinalPathNameByHandleW"](
        raw_handle,
        None,
        0,
        api["FILE_NAME_NORMALIZED"],
    )
    if not required:
        _raise_windows_error(Path("<runtime handle>"), api["ctypes"].get_last_error())
    buffer = api["ctypes"].create_unicode_buffer(required + 1)
    written = api["GetFinalPathNameByHandleW"](
        raw_handle,
        buffer,
        len(buffer),
        api["FILE_NAME_NORMALIZED"],
    )
    if not written or written >= len(buffer):
        _raise_windows_error(Path("<runtime handle>"), api["ctypes"].get_last_error())
    value = buffer.value
    if value.startswith("\\\\?\\UNC\\"):
        value = "\\\\" + value[8:]
    elif value.startswith("\\\\?\\"):
        value = value[4:]
    return Path(value)


def _windows_operator_owns(file_descriptor: int) -> bool:
    api = _windows_api()
    ctypes = api["ctypes"]
    wintypes = api["wintypes"]
    token = wintypes.HANDLE()
    if not api["OpenProcessToken"](
        ctypes.windll.kernel32.GetCurrentProcess(),
        api["TOKEN_QUERY"],
        ctypes.byref(token),
    ):
        _raise_windows_error(Path("<current process>"), ctypes.get_last_error())
    descriptor = wintypes.LPVOID()
    try:
        def token_payload(info_class: int) -> object:
            needed = wintypes.DWORD()
            if api["GetTokenInformation"](token, info_class, None, 0, ctypes.byref(needed)):
                raise ValueError("Windows token information query returned no payload")
            if ctypes.get_last_error() != api["ERROR_INSUFFICIENT_BUFFER"] or not needed.value:
                _raise_windows_error(Path("<current process>"), ctypes.get_last_error())
            payload = (ctypes.c_byte * needed.value)()
            if not api["GetTokenInformation"](
                token,
                info_class,
                ctypes.byref(payload),
                needed.value,
                ctypes.byref(needed),
            ):
                _raise_windows_error(Path("<current process>"), ctypes.get_last_error())
            return payload

        user_payload = token_payload(api["TOKEN_USER"])
        user_info = ctypes.cast(
            ctypes.byref(user_payload),
            ctypes.POINTER(api["TokenUser"]),
        ).contents
        owner_payload = token_payload(api["TOKEN_OWNER"])
        owner_info = ctypes.cast(
            ctypes.byref(owner_payload),
            ctypes.POINTER(api["TokenOwner"]),
        ).contents
        groups_payload = token_payload(api["TOKEN_GROUPS"])
        groups_info = ctypes.cast(
            ctypes.byref(groups_payload),
            ctypes.POINTER(api["TokenGroups"]),
        ).contents
        group_base = ctypes.addressof(groups_info.groups[0])
        group_type = type(groups_info.groups[0]) * int(groups_info.count)
        group_sids = [group.sid for group in group_type.from_address(group_base)]
        owner = wintypes.LPVOID()
        result = api["GetSecurityInfo"](
            api["msvcrt"].get_osfhandle(file_descriptor),
            api["SE_FILE_OBJECT"],
            api["OWNER_SECURITY_INFORMATION"],
            ctypes.byref(owner),
            None,
            None,
            None,
            ctypes.byref(descriptor),
        )
        if result:
            _raise_windows_error(Path("<runtime root>"), int(result))
        return bool(
            owner
            and (
                api["EqualSid"](user_info.user.sid, owner)
                or api["EqualSid"](owner_info.owner, owner)
                or any(api["EqualSid"](group_sid, owner) for group_sid in group_sids)
            )
        )
    finally:
        if descriptor:
            api["LocalFree"](descriptor)
        api["CloseHandle"](token)


def _run_windows_runtime_hook(stage: str, path: Path) -> None:
    if os.name == "nt" and _WINDOWS_RUNTIME_TEST_HOOK is not None:
        _WINDOWS_RUNTIME_TEST_HOOK(stage, path)


def _absolute_runtime_path(value: str) -> Path:
    path = Path(value)
    if not path.is_absolute():
        raise ValueError("runtime path must be absolute")
    normalized = Path(os.path.abspath(str(path)))
    # macOS exposes its private temporary trees through two root-owned system
    # aliases. Walking /var or /tmp with O_NOFOLLOW rejects those aliases
    # before the operator-owned descendant can be pinned. Canonicalize only
    # the exact protected targets; arbitrary links remain fail-closed below.
    if sys.platform == "darwin" and len(normalized.parts) > 1:
        alias_targets = {
            "var": Path("/private/var"),
            "tmp": Path("/private/tmp"),
        }
        expected = alias_targets.get(normalized.parts[1])
        alias = Path(normalized.anchor) / normalized.parts[1]
        if (
            expected is not None
            and alias.is_symlink()
            and Path(os.path.realpath(str(alias))) == expected
        ):
            normalized = expected.joinpath(*normalized.parts[2:])
    return normalized


def _reject_runtime_link_or_reparse(file_stat: os.stat_result, label: str) -> None:
    if stat.S_ISLNK(file_stat.st_mode):
        raise ValueError(f"{label} must not be a symbolic link")
    if _is_reparse_point(file_stat):
        raise ValueError(f"{label} must not be a Windows reparse point")


def _runtime_state(file_stat: os.stat_result) -> Tuple[int, int, int, int, int, int]:
    return (
        int(file_stat.st_dev),
        int(file_stat.st_ino),
        int(file_stat.st_mode),
        int(file_stat.st_nlink),
        int(file_stat.st_size),
        _mtime_ns(file_stat),
    )


def _same_runtime_state(left: os.stat_result, right: os.stat_result) -> bool:
    return _runtime_state(left) == _runtime_state(right)


def _same_runtime_entry(left: _RuntimeEntry, right: _RuntimeEntry) -> bool:
    return _same_runtime_state(left.stat, right.stat) and left.windows_info == right.windows_info


def _same_runtime_entry_identity(left: _RuntimeEntry, right: _RuntimeEntry) -> bool:
    if not _same_filesystem_object(left.stat, right.stat):
        return False
    if left.windows_info is None or right.windows_info is None:
        return left.windows_info is right.windows_info
    return (
        left.windows_info.volume_serial == right.windows_info.volume_serial
        and left.windows_info.file_index == right.windows_info.file_index
    )


def _validate_windows_runtime_entry(
    entry: _RuntimeEntry,
    label: str,
    *,
    regular_file: bool,
) -> None:
    if entry.windows_info is None:
        return
    info = entry.windows_info
    if (
        info.attributes & _windows_api()["FILE_ATTRIBUTE_REPARSE_POINT"]
        or info.reparse_tag
    ):
        raise ValueError(f"{label} must not be a Windows reparse point")
    if int(entry.stat.st_nlink) != info.link_count:
        raise ValueError(f"{label} Windows link count changed while it was opened")
    if regular_file and info.link_count != 1:
        raise ValueError(f"{label} must not have hard links")


def _validate_runtime_directory(file_stat: os.stat_result, label: str) -> None:
    _reject_runtime_link_or_reparse(file_stat, label)
    if not stat.S_ISDIR(file_stat.st_mode):
        raise ValueError(f"{label} must be a directory")


def _validate_runtime_regular_file(file_stat: os.stat_result, label: str) -> None:
    _reject_runtime_link_or_reparse(file_stat, label)
    if not stat.S_ISREG(file_stat.st_mode):
        raise ValueError(f"{label} must be a regular file")
    if int(file_stat.st_nlink) != 1:
        raise ValueError(f"{label} must not have hard links")


def _validate_directory_entry(entry: _RuntimeEntry, label: str) -> None:
    _validate_runtime_directory(entry.stat, label)
    _validate_windows_runtime_entry(entry, label, regular_file=False)


def _validate_regular_entry(entry: _RuntimeEntry, label: str) -> None:
    _validate_runtime_regular_file(entry.stat, label)
    _validate_windows_runtime_entry(entry, label, regular_file=True)
def _windows_open_relative(
    parent_descriptor: int,
    name: str,
    *,
    access: int,
    disposition: int,
    descriptor_flags: int,
    directory: bool,
    share_delete: bool = False,
) -> Tuple[int, _RuntimeEntry]:
    if os.name != "nt" or not _windows_runtime_supported():
        raise ValueError("secure Windows GDrive filesystem primitives are unavailable")
    if not name or "\x00" in name or "\\" in name or "/" in name:
        raise ValueError("Windows relative handle component is invalid")
    api = _windows_api()
    ctypes = api["ctypes"]
    name_buffer = ctypes.create_unicode_buffer(name)
    encoded_name = name.encode("utf-16-le")
    name_length = len(encoded_name)
    maximum_name_length = name_length + ctypes.sizeof(api["wintypes"].WCHAR)
    if maximum_name_length > 0xFFFF:
        raise ValueError("Windows relative handle component is too long")
    unicode_name = api["UnicodeString"](
        name_length,
        maximum_name_length,
        ctypes.cast(name_buffer, api["wintypes"].LPWSTR),
    )
    attributes = api["ObjectAttributes"](
        ctypes.sizeof(api["ObjectAttributes"]),
        api["msvcrt"].get_osfhandle(parent_descriptor),
        ctypes.pointer(unicode_name),
        api["OBJ_CASE_INSENSITIVE"],
        None,
        None,
    )
    io_status = api["IoStatusBlock"]()
    raw_handle = api["wintypes"].HANDLE()
    options = (
        api["FILE_OPEN_REPARSE_POINT"]
        | api["FILE_SYNCHRONOUS_IO_NONALERT"]
        | (api["FILE_DIRECTORY_FILE"] if directory else api["FILE_NON_DIRECTORY_FILE"])
    )
    desired_access = access | api["SYNCHRONIZE"]
    status = int(
        api["NtCreateFile"](
            ctypes.byref(raw_handle),
            desired_access,
            ctypes.byref(attributes),
            ctypes.byref(io_status),
            None,
            api["FILE_ATTRIBUTE_NORMAL"],
            api["FILE_SHARE_READ"]
            | api["FILE_SHARE_WRITE"]
            | (api["FILE_SHARE_DELETE"] if share_delete else 0),
            disposition,
            options,
            None,
            0,
        )
    )
    if status < 0:
        _raise_windows_error(
            Path("<trusted Windows directory>") / name,
            int(api["RtlNtStatusToDosError"](status)),
        )
    try:
        file_descriptor = api["msvcrt"].open_osfhandle(
            raw_handle.value,
            descriptor_flags | getattr(os, "O_BINARY", 0),
        )
    except BaseException:
        api["CloseHandle"](raw_handle)
        raise
    try:
        return file_descriptor, _entry_from_open_descriptor(file_descriptor)
    except BaseException:
        os.close(file_descriptor)
        raise


def _windows_assert_trusted_root(root: _WindowsTrustedRoot) -> None:
    current = _entry_from_open_descriptor(root.descriptor)
    _validate_directory_entry(current, "trusted Windows GDrive root")
    if not _same_runtime_entry_identity(current, root.entry):
        raise ValueError("trusted Windows GDrive root identity changed")
    for index, component in enumerate(root.components):
        descriptor, opened = _windows_open_relative(
            root.handles[index],
            component,
            access=_windows_api()["GENERIC_READ"],
            disposition=_windows_api()["FILE_OPEN"],
            descriptor_flags=os.O_RDONLY,
            directory=True,
        )
        try:
            _validate_directory_entry(opened, "trusted Windows GDrive root component")
            if not _same_runtime_entry_identity(opened, root.entries[index + 1]):
                raise ValueError("trusted Windows GDrive root path changed")
        finally:
            os.close(descriptor)


def _windows_open_gdrive_root(
    value: Path,
    *,
    create: bool,
    hook_stage: str,
) -> _WindowsTrustedRoot:
    path = Path(os.path.abspath(str(value)))
    if not _windows_runtime_supported():
        raise ValueError("secure Windows GDrive filesystem primitives are unavailable")
    anchor = Path(path.anchor)
    if not str(anchor):
        raise ValueError("Windows GDrive root has no filesystem anchor")
    handles: List[int] = []
    entries: List[_RuntimeEntry] = []
    try:
        anchor_descriptor, anchor_entry = _windows_open_directory_component(
            anchor,
            operator_owned=False,
        )
        handles.append(anchor_descriptor)
        entries.append(anchor_entry)
        components = path.parts[1:]
        for index, component in enumerate(components):
            access = _windows_api()["GENERIC_READ"]
            if create and index == len(components) - 1:
                access |= _windows_api()["GENERIC_WRITE"]
            try:
                child_descriptor, child_entry = _windows_open_relative(
                    handles[-1],
                    component,
                    access=access,
                    disposition=_windows_api()["FILE_OPEN"],
                    descriptor_flags=os.O_RDONLY,
                    directory=True,
                )
            except FileNotFoundError:
                if not create:
                    raise
                child_descriptor, child_entry = _windows_open_relative(
                    handles[-1],
                    component,
                    access=_windows_api()["GENERIC_READ"] | _windows_api()["GENERIC_WRITE"],
                    disposition=_windows_api()["FILE_CREATE"],
                    descriptor_flags=os.O_RDONLY,
                    directory=True,
                )
            try:
                _validate_directory_entry(child_entry, "Windows GDrive root component")
                handles.append(child_descriptor)
                entries.append(child_entry)
            except BaseException:
                os.close(child_descriptor)
                raise
        root = _WindowsTrustedRoot(
            _windows_final_path(handles[-1]),
            handles[-1],
            entries[-1],
            tuple(handles),
            tuple(path.parts[1:]),
            tuple(entries),
        )
        _windows_assert_trusted_root(root)
        _run_windows_runtime_hook(hook_stage, root.path)
        _windows_assert_trusted_root(root)
        return root
    except BaseException:
        for descriptor in reversed(handles):
            os.close(descriptor)
        raise


def _close_windows_trusted_root(root: Optional[_WindowsTrustedRoot]) -> None:
    if root is None:
        return
    for descriptor in reversed(root.handles):
        os.close(descriptor)


def _windows_open_gdrive_relative_file(
    root: _WindowsTrustedRoot,
    components: Sequence[str],
    *,
    access: int,
    descriptor_flags: int,
    hook_stage: str,
) -> Tuple[int, _RuntimeEntry]:
    if not components:
        raise ValueError("GDrive relative path is required")
    _windows_assert_trusted_root(root)
    opened_directories: List[int] = []
    parent_descriptor = root.descriptor
    try:
        for component in components[:-1]:
            child_descriptor, child_entry = _windows_open_relative(
                parent_descriptor,
                component,
                access=_windows_api()["GENERIC_READ"],
                disposition=_windows_api()["FILE_OPEN"],
                descriptor_flags=os.O_RDONLY,
                directory=True,
            )
            try:
                _validate_directory_entry(child_entry, "GDrive source directory")
                opened_directories.append(child_descriptor)
                parent_descriptor = child_descriptor
                _run_windows_runtime_hook(
                    "gdrive-source-child-pinned",
                    _windows_final_path(child_descriptor),
                )
                _windows_assert_trusted_root(root)
            except BaseException:
                os.close(child_descriptor)
                raise
        file_descriptor, entry = _windows_open_relative(
            parent_descriptor,
            components[-1],
            access=access,
            disposition=_windows_api()["FILE_OPEN"],
            descriptor_flags=descriptor_flags,
            directory=False,
        )
        try:
            _validate_regular_entry(entry, "GDrive input")
            _run_windows_runtime_hook(hook_stage, _windows_final_path(file_descriptor))
            _windows_assert_trusted_root(root)
            return file_descriptor, entry
        except BaseException:
            os.close(file_descriptor)
            raise
    finally:
        for descriptor in reversed(opened_directories):
            os.close(descriptor)


def _windows_open_checked_relative_file(
    root: Union[Path, _WindowsTrustedRoot],
    relative_path: object,
) -> int:
    _normalized, components = _portable_relative_path(relative_path)
    owned_root: Optional[_WindowsTrustedRoot] = None
    trusted_root: _WindowsTrustedRoot
    if isinstance(root, _WindowsTrustedRoot):
        trusted_root = root
    else:
        owned_root = _windows_open_gdrive_root(
            root,
            create=False,
            hook_stage="gdrive-root-pinned",
        )
        trusted_root = owned_root
    try:
        descriptor, _entry = _windows_open_gdrive_relative_file(
            trusted_root,
            components,
            access=_windows_api()["GENERIC_READ"],
            descriptor_flags=_readonly_open_flags(),
            hook_stage="gdrive-file-pinned",
        )
        return descriptor
    finally:
        _close_windows_trusted_root(owned_root)



def _windows_open_directory_component(
    path: Path,
    *,
    operator_owned: bool,
) -> Tuple[int, _RuntimeEntry]:
    api = _windows_api()
    access = api["GENERIC_READ"] | (api["READ_CONTROL"] if operator_owned else 0)
    descriptor, entry = _windows_open_path(
        path,
        access=access,
        disposition=api["OPEN_EXISTING"],
        descriptor_flags=os.O_RDONLY,
    )
    try:
        _validate_directory_entry(entry, "runtime root component")
        if operator_owned and not _windows_operator_owns(descriptor):
            raise ValueError("runtime root must be owned by the invoking operator")
        return descriptor, entry
    except BaseException:
        os.close(descriptor)
        raise


def _open_or_create_runtime_root(value: str, *, create: bool, operator_owned: bool) -> dict:
    path = _absolute_runtime_path(value)
    if _secure_dirfd_supported():
        root_fd = os.open(
            path.anchor,
            os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW,
        )
        try:
            current_fd = root_fd
            for component in path.parts[1:]:
                try:
                    before = os.stat(component, dir_fd=current_fd, follow_symlinks=False)
                except FileNotFoundError:
                    if not create:
                        raise
                    os.mkdir(component, 0o700, dir_fd=current_fd)
                    before = os.stat(component, dir_fd=current_fd, follow_symlinks=False)
                _validate_runtime_directory(before, "runtime root component")
                child_fd = os.open(
                    component,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW,
                    dir_fd=current_fd,
                )
                opened = os.fstat(child_fd)
                if not _same_filesystem_object(before, opened):
                    os.close(child_fd)
                    raise ValueError("runtime root changed while it was opened")
                if current_fd != root_fd:
                    os.close(current_fd)
                current_fd = child_fd
            root_stat = os.fstat(current_fd)
            _validate_runtime_directory(root_stat, "runtime root")
            if operator_owned and hasattr(os, "getuid") and root_stat.st_uid != os.getuid():
                raise ValueError("runtime root must be owned by the invoking operator")
            resolved = Path(os.path.realpath(str(path)))
            if current_fd != root_fd:
                os.close(root_fd)
            return {"path": resolved, "fd": current_fd, "stat": root_stat, "mode": "posix"}
        except BaseException:
            if "current_fd" in locals() and current_fd != root_fd:
                os.close(current_fd)
            os.close(root_fd)
            raise

    if os.name != "nt" or not _windows_runtime_supported():
        raise ValueError("secure runtime filesystem primitives are unavailable")

    current_path = Path(path.anchor)
    handles: List[int] = []
    try:
        anchor_fd, _anchor_entry = _windows_open_directory_component(
            current_path,
            operator_owned=False,
        )
        handles.append(anchor_fd)
        current_entry = _anchor_entry
        for index, component in enumerate(path.parts[1:]):
            child_path = current_path / component
            try:
                before = os.lstat(str(child_path))
            except FileNotFoundError:
                if not create:
                    raise
                os.mkdir(str(child_path), mode=0o700)
                before = os.lstat(str(child_path))
            _validate_runtime_directory(before, "runtime root component")
            child_fd, opened = _windows_open_directory_component(
                child_path,
                operator_owned=operator_owned and index == len(path.parts[1:]) - 1,
            )
            try:
                after = os.lstat(str(child_path))
                if not _same_runtime_state(before, after) or not _same_filesystem_object(after, opened.stat):
                    raise ValueError("runtime root changed while it was opened")
                handles.append(child_fd)
                current_path = child_path
                current_entry = opened
            except BaseException:
                os.close(child_fd)
                raise
        canonical_path = _windows_final_path(handles[-1])
        root_entry = _RuntimeEntry(os.fstat(handles[-1]), _windows_handle_info(handles[-1]))
        _validate_directory_entry(root_entry, "runtime root")
        if not _same_runtime_entry(current_entry, root_entry):
            raise ValueError("runtime root identity changed while it was pinned")
        _run_windows_runtime_hook("root-pinned", canonical_path)
        return {
            "path": canonical_path,
            "fd": handles[-1],
            "stat": root_entry.stat,
            "entry": root_entry,
            "handles": tuple(handles),
            "mode": "windows",
        }
    except BaseException:
        for handle in reversed(handles):
            os.close(handle)
        raise


def _close_runtime_root(root: Optional[dict]) -> None:
    if not root:
        return
    if root.get("mode") == "windows":
        for handle in reversed(root["handles"]):
            os.close(handle)
    elif root["fd"] is not None:
        os.close(root["fd"])


def _open_runtime_directory(
    root: dict,
    components: Sequence[str],
    *,
    create: bool,
) -> Tuple[Optional[int], Path, Tuple[int, ...]]:
    current_path = root["path"]
    if root["mode"] == "windows":
        handles: List[int] = []
        try:
            base_fd, _base_entry = _windows_open_directory_component(
                current_path,
                operator_owned=False,
            )
            handles.append(base_fd)
            for component in components:
                child_path = current_path / component
                try:
                    before = os.lstat(str(child_path))
                except FileNotFoundError:
                    if not create:
                        raise
                    os.mkdir(str(child_path), mode=0o700)
                    before = os.lstat(str(child_path))
                _validate_runtime_directory(before, "runtime path component")
                child_fd, opened = _windows_open_directory_component(
                    child_path,
                    operator_owned=False,
                )
                try:
                    after = os.lstat(str(child_path))
                    if not _same_runtime_state(before, after) or not _same_filesystem_object(after, opened.stat):
                        raise ValueError("runtime directory changed while it was opened")
                    handles.append(child_fd)
                    current_path = child_path
                except BaseException:
                    os.close(child_fd)
                    raise
            _run_windows_runtime_hook("directory-pinned", current_path)
            return handles[-1], current_path, tuple(handles)
        except BaseException:
            for handle in reversed(handles):
                os.close(handle)
            raise

    if root["mode"] != "posix":
        raise ValueError("secure runtime filesystem primitives are unavailable")
    current_fd = os.dup(root["fd"])
    try:
        for component in components:
            current_path = current_path / component
            try:
                before = os.stat(component, dir_fd=current_fd, follow_symlinks=False)
            except FileNotFoundError:
                if not create:
                    raise
                os.mkdir(component, 0o700, dir_fd=current_fd)
                before = os.stat(component, dir_fd=current_fd, follow_symlinks=False)
            _validate_runtime_directory(before, "runtime path component")
            child_fd = os.open(
                component,
                os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC | os.O_NOFOLLOW,
                dir_fd=current_fd,
            )
            opened = os.fstat(child_fd)
            if not _same_filesystem_object(before, opened):
                os.close(child_fd)
                raise ValueError("runtime directory changed while it was opened")
            os.close(current_fd)
            current_fd = child_fd
        return current_fd, current_path, ()
    except BaseException:
        os.close(current_fd)
        raise


def _close_runtime_directory(handle: Tuple[Optional[int], Path, Tuple[int, ...]]) -> None:
    if handle[2]:
        for descriptor in reversed(handle[2]):
            os.close(descriptor)
    elif handle[0] is not None:
        os.close(handle[0])


def _runtime_lstat_at(directory: Tuple[Optional[int], Path, Tuple[int, ...]], name: str) -> os.stat_result:
    directory_fd, directory_path, _handles = directory
    if directory_fd is None:
        raise ValueError("secure runtime filesystem primitives are unavailable")
    if os.name == "nt":
        return os.lstat(str(directory_path / name))
    return os.stat(name, dir_fd=directory_fd, follow_symlinks=False)


def _runtime_entry_at(
    directory: Tuple[Optional[int], Path, Tuple[int, ...]],
    name: str,
) -> _RuntimeEntry:
    before = _runtime_lstat_at(directory, name)
    if os.name != "nt":
        return _RuntimeEntry(before, None)
    path = directory[1] / name
    descriptor, opened = _windows_open_path(
        path,
        access=_windows_api()["GENERIC_READ"],
        disposition=_windows_api()["OPEN_EXISTING"],
        descriptor_flags=os.O_RDONLY,
    )
    try:
        after = _runtime_lstat_at(directory, name)
        if not _same_runtime_state(before, after) or not _same_filesystem_object(after, opened.stat):
            raise ValueError("runtime entry changed while it was opened")
        return _RuntimeEntry(after, opened.windows_info)
    finally:
        os.close(descriptor)


def _entry_from_open_descriptor(file_descriptor: int) -> _RuntimeEntry:
    return _RuntimeEntry(
        os.fstat(file_descriptor),
        _windows_handle_info(file_descriptor) if os.name == "nt" else None,
    )


def _runtime_open_file(
    root: dict,
    components: Sequence[str],
    flags: int,
) -> Tuple[int, _RuntimeEntry]:
    if not components:
        raise ValueError("runtime file path is required")
    parent = _open_runtime_directory(root, components[:-1], create=False)
    try:
        before = _runtime_entry_at(parent, components[-1])
        _validate_regular_entry(before, "runtime file")
        open_flags = flags | getattr(os, "O_BINARY", 0) | getattr(os, "O_CLOEXEC", 0)
        if root["mode"] == "posix":
            file_descriptor = os.open(components[-1], open_flags | os.O_NOFOLLOW, dir_fd=parent[0])
        elif root["mode"] == "windows":
            api = _windows_api()
            access = api["GENERIC_WRITE"] if flags & (os.O_WRONLY | os.O_RDWR) else api["GENERIC_READ"]
            if flags & os.O_RDWR:
                access |= api["GENERIC_READ"]
            file_descriptor, opened = _windows_open_path(
                parent[1] / components[-1],
                access=access,
                disposition=api["OPEN_EXISTING"],
                descriptor_flags=open_flags,
            )
        else:
            raise ValueError("secure runtime filesystem primitives are unavailable")
        try:
            opened = _entry_from_open_descriptor(file_descriptor)
            after = _runtime_entry_at(parent, components[-1])
            _validate_regular_entry(after, "runtime file")
            if not _same_runtime_entry(before, after) or not _same_runtime_entry(before, opened):
                raise ValueError("runtime file changed while it was opened")
            return file_descriptor, opened
        except BaseException:
            os.close(file_descriptor)
            raise
    finally:
        _close_runtime_directory(parent)


def _verify_runtime_entry(root: dict, components: Sequence[str], expected: _RuntimeEntry) -> None:
    parent = _open_runtime_directory(root, components[:-1], create=False)
    try:
        current = _runtime_entry_at(parent, components[-1])
        _validate_regular_entry(current, "runtime file")
        if not _same_runtime_entry(current, expected):
            raise ValueError("runtime file identity changed")
    finally:
        _close_runtime_directory(parent)


def _new_runtime_temp_name(prefix: str) -> str:
    return f".{prefix}.{secrets.token_hex(16)}.tmp"


def _create_runtime_temp(
    directory: Tuple[Optional[int], Path, Tuple[int, ...]],
    *,
    prefix: str,
) -> Tuple[int, str]:
    flags = (
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_BINARY", 0)
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    for _ in range(32):
        name = _new_runtime_temp_name(prefix)
        try:
            if os.name == "nt":
                file_descriptor, opened = _windows_open_path(
                    directory[1] / name,
                    access=_windows_api()["GENERIC_WRITE"],
                    disposition=_windows_api()["CREATE_NEW"],
                    descriptor_flags=flags,
                )
            else:
                file_descriptor = os.open(name, flags, 0o600, dir_fd=directory[0])
                opened = _entry_from_open_descriptor(file_descriptor)
        except FileExistsError:
            continue
        try:
            _validate_regular_entry(opened, "temporary runtime file")
            return file_descriptor, name
        except BaseException:
            os.close(file_descriptor)
            raise
    raise ValueError("could not allocate an exclusive temporary file")


def _windows_checked_entry(
    directory: Tuple[Optional[int], Path, Tuple[int, ...]],
    name: str,
    expected: object,
) -> Optional[_RuntimeEntry]:
    try:
        entry = _runtime_entry_at(directory, name)
    except FileNotFoundError:
        if expected is None or expected is _ENTRY_UNCHECKED:
            return None
        raise
    if expected is None:
        raise ValueError("runtime entry appeared unexpectedly")
    if expected is not _ENTRY_UNCHECKED and not _same_runtime_entry(entry, expected):
        raise ValueError("runtime entry identity changed before mutation")
    return entry


def _unlink_runtime_entry(
    directory: Tuple[Optional[int], Path, Tuple[int, ...]],
    name: str,
    *,
    expected: object = _ENTRY_UNCHECKED,
) -> None:
    if os.name != "nt":
        if expected is not _ENTRY_UNCHECKED:
            _windows_checked_entry(directory, name, expected)
        os.unlink(name, dir_fd=directory[0])
        return
    before = _windows_checked_entry(directory, name, expected)
    if before is None:
        return
    _run_windows_runtime_hook("before-mutation", directory[1])
    if not _same_runtime_entry(before, _windows_checked_entry(directory, name, before)):
        raise ValueError("runtime entry identity changed before removal")
    api = _windows_api()
    if not api["DeleteFileW"](str(directory[1] / name)):
        _raise_windows_error(directory[1] / name, api["ctypes"].get_last_error())
    try:
        _runtime_lstat_at(directory, name)
    except FileNotFoundError:
        return
    raise ValueError("runtime entry still exists after removal")


def _replace_runtime_entry(
    directory: Tuple[Optional[int], Path, Tuple[int, ...]],
    source_name: str,
    target_name: str,
    *,
    expected_source: Optional[_RuntimeEntry] = None,
    expected_target: object = _ENTRY_UNCHECKED,
) -> _RuntimeEntry:
    if os.name != "nt":
        source_before = _windows_checked_entry(
            directory,
            source_name,
            expected_source or _ENTRY_UNCHECKED,
        )
        if source_before is None:
            raise ValueError("runtime replacement source is missing")
        _windows_checked_entry(directory, target_name, expected_target)
        os.rename(
            source_name,
            target_name,
            src_dir_fd=directory[0],
            dst_dir_fd=directory[0],
        )
        published = _RuntimeEntry(_runtime_lstat_at(directory, target_name), None)
        if not _same_runtime_entry_identity(source_before, published):
            raise ValueError("published runtime entry identity mismatch")
        return published

    source_before = _windows_checked_entry(directory, source_name, expected_source or _ENTRY_UNCHECKED)
    if source_before is None:
        raise ValueError("runtime replacement source is missing")
    target_before = _windows_checked_entry(directory, target_name, expected_target)
    _run_windows_runtime_hook("before-mutation", directory[1])
    source_now = _windows_checked_entry(directory, source_name, source_before)
    target_now = _windows_checked_entry(directory, target_name, target_before)
    if source_now is None or not _same_runtime_entry(source_before, source_now):
        raise ValueError("runtime replacement source identity changed")
    if target_before is not None and (target_now is None or not _same_runtime_entry(target_before, target_now)):
        raise ValueError("runtime replacement target identity changed")
    api = _windows_api()
    if not api["MoveFileExW"](
        str(directory[1] / source_name),
        str(directory[1] / target_name),
        api["MOVEFILE_REPLACE_EXISTING"] | api["MOVEFILE_WRITE_THROUGH"],
    ):
        _raise_windows_error(directory[1] / target_name, api["ctypes"].get_last_error())
    published = _runtime_entry_at(directory, target_name)
    if not _same_runtime_entry_identity(source_before, published):
        raise ValueError("published runtime entry identity mismatch")
    return published


def _link_runtime_entry(
    directory: Tuple[Optional[int], Path, Tuple[int, ...]],
    source_name: str,
    target_name: str,
    *,
    expected_source: Optional[_RuntimeEntry] = None,
) -> _RuntimeEntry:
    if os.name != "nt":
        source_before = _windows_checked_entry(
            directory,
            source_name,
            expected_source or _ENTRY_UNCHECKED,
        )
        if source_before is None:
            raise ValueError("runtime link source is missing")
        _windows_checked_entry(directory, target_name, None)
        os.link(
            source_name,
            target_name,
            src_dir_fd=directory[0],
            dst_dir_fd=directory[0],
            follow_symlinks=False,
        )
        published = _RuntimeEntry(_runtime_lstat_at(directory, target_name), None)
        if not _same_runtime_entry_identity(source_before, published):
            raise ValueError("published runtime link identity mismatch")
        return published

    source_before = _windows_checked_entry(directory, source_name, expected_source or _ENTRY_UNCHECKED)
    if source_before is None:
        raise ValueError("runtime link source is missing")
    _windows_checked_entry(directory, target_name, None)
    _run_windows_runtime_hook("before-mutation", directory[1])
    source_now = _windows_checked_entry(directory, source_name, source_before)
    _windows_checked_entry(directory, target_name, None)
    if source_now is None or not _same_runtime_entry(source_before, source_now):
        raise ValueError("runtime link source identity changed")
    os.link(str(directory[1] / source_name), str(directory[1] / target_name), follow_symlinks=False)
    published = _runtime_entry_at(directory, target_name)
    if not _same_runtime_entry_identity(source_before, published):
        raise ValueError("published runtime link identity mismatch")
    return published


def _fsync_runtime_directory(directory: Tuple[Optional[int], Path, Tuple[int, ...]]) -> None:
    if os.name == "posix":
        os.fsync(directory[0])

def _digest_runtime_file(file_descriptor: int, expected: _RuntimeEntry) -> str:
    before = _entry_from_open_descriptor(file_descriptor)
    _validate_regular_entry(before, "retained file")
    if not _same_runtime_entry(before, expected):
        raise ValueError("retained file identity changed")
    digest = hashlib.sha256()
    os.lseek(file_descriptor, 0, os.SEEK_SET)
    while True:
        chunk = os.read(file_descriptor, MIRROR_COPY_CHUNK_BYTES)
        if not chunk:
            break
        digest.update(chunk)
    after = _entry_from_open_descriptor(file_descriptor)
    _validate_regular_entry(after, "retained file")
    if not _same_runtime_entry(before, after):
        raise ValueError("retained file changed while it was read")
    return digest.hexdigest()


def _copy_runtime_file(
    source_descriptor: int,
    source_entry: _RuntimeEntry,
    target_descriptor: int,
) -> str:
    before = _entry_from_open_descriptor(source_descriptor)
    _validate_regular_entry(before, "retained source")
    if not _same_runtime_entry(before, source_entry):
        raise ValueError("retained source identity changed")
    digest = hashlib.sha256()
    os.lseek(source_descriptor, 0, os.SEEK_SET)
    total = 0
    while True:
        chunk = os.read(source_descriptor, MIRROR_COPY_CHUNK_BYTES)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_MIRROR_BYTES:
            raise ValueError("mirror file exceeds the permitted size")
        digest.update(chunk)
        offset = 0
        while offset < len(chunk):
            written = os.write(target_descriptor, chunk[offset:])
            if written <= 0:
                raise OSError("could not write mirror temporary file")
            offset += written
    after = _entry_from_open_descriptor(source_descriptor)
    _validate_regular_entry(after, "retained source")
    if not _same_runtime_entry(before, after):
        raise ValueError("retained source changed while it was copied")
    return digest.hexdigest()


def _mirror_inventory(root: dict) -> Dict[str, _RuntimeEntry]:
    inventory: Dict[str, _RuntimeEntry] = {}
    total_bytes = 0

    def visit(components: Tuple[str, ...]) -> None:
        nonlocal total_bytes
        directory = _open_runtime_directory(root, components, create=False)
        try:
            names = sorted(
                os.listdir(directory[0]) if root["mode"] == "posix" else os.listdir(str(directory[1]))
            )
            for name in names:
                if not name or name in {".", ".."}:
                    raise ValueError("invalid mirror directory entry")
                entry = _runtime_entry_at(directory, name)
                _reject_runtime_link_or_reparse(entry.stat, "mirror input")
                _validate_windows_runtime_entry(entry, "mirror input", regular_file=False)
                child_components = components + (name,)
                if stat.S_ISDIR(entry.stat.st_mode):
                    visit(child_components)
                    continue
                if not stat.S_ISREG(entry.stat.st_mode):
                    raise ValueError("mirror input must contain only regular files and directories")
                _validate_regular_entry(entry, "mirror input")
                relative_path = "/".join(child_components)
                _portable_relative_path(relative_path)
                if name in MIRROR_EXCLUDED_NAMES or not name.endswith(MIRROR_FILE_SUFFIXES):
                    continue
                if len(inventory) >= MAX_MIRROR_FILES:
                    raise ValueError("mirror inventory exceeds the permitted file count")
                total_bytes += int(entry.stat.st_size)
                if total_bytes > MAX_MIRROR_BYTES:
                    raise ValueError("mirror inventory exceeds the permitted byte count")
                inventory[relative_path] = entry
        finally:
            _close_runtime_directory(directory)

    visit(())
    return inventory


def _mirror_file_components(relative_path: str) -> Tuple[str, ...]:
    _normalized, components = _portable_relative_path(relative_path)
    return components


def _mirror_copy_one(
    source_root: dict,
    target_root: dict,
    relative_path: str,
    expected_source: _RuntimeEntry,
    expected_target: Optional[_RuntimeEntry],
) -> None:
    components = _mirror_file_components(relative_path)
    source_descriptor, source_entry = _runtime_open_file(source_root, components, os.O_RDONLY)
    try:
        if not _same_runtime_entry(source_entry, expected_source):
            raise ValueError("mirror source identity changed after inventory")
        source_digest = _digest_runtime_file(source_descriptor, source_entry)
        if expected_target is not None:
            target_descriptor, target_entry = _runtime_open_file(target_root, components, os.O_RDONLY)
            try:
                if not _same_runtime_entry(target_entry, expected_target):
                    raise ValueError("mirror target identity changed after inventory")
                if source_digest == _digest_runtime_file(target_descriptor, target_entry):
                    _verify_runtime_entry(source_root, components, source_entry)
                    _verify_runtime_entry(target_root, components, target_entry)
                    return
            finally:
                os.close(target_descriptor)

        target_directory = _open_runtime_directory(target_root, components[:-1], create=True)
        temporary_descriptor = -1
        temporary_name = ""
        try:
            temporary_descriptor, temporary_name = _create_runtime_temp(
                target_directory,
                prefix="run-daily-mirror",
            )
            copied_digest = _copy_runtime_file(source_descriptor, source_entry, temporary_descriptor)
            if copied_digest != source_digest:
                raise ValueError("mirror source digest changed while it was copied")
            os.fsync(temporary_descriptor)
            temporary_entry = _entry_from_open_descriptor(temporary_descriptor)
            _validate_regular_entry(temporary_entry, "mirror temporary file")
            _verify_runtime_entry(source_root, components, source_entry)
            if expected_target is None:
                expected_publication_target: object = None
            else:
                current_target = _runtime_entry_at(target_directory, components[-1])
                _validate_regular_entry(current_target, "mirror target")
                if not _same_runtime_entry(current_target, expected_target):
                    raise ValueError("mirror target identity changed before publication")
                expected_publication_target = expected_target
            os.close(temporary_descriptor)
            temporary_descriptor = -1
            published = _replace_runtime_entry(
                target_directory,
                temporary_name,
                components[-1],
                expected_source=temporary_entry,
                expected_target=expected_publication_target,
            )
            temporary_name = ""
            _validate_regular_entry(published, "published mirror file")
            if not _same_runtime_entry_identity(published, temporary_entry):
                raise ValueError("published mirror file identity mismatch")
            _fsync_runtime_directory(target_directory)
        finally:
            if temporary_descriptor >= 0:
                os.close(temporary_descriptor)
            if temporary_name:
                try:
                    _unlink_runtime_entry(target_directory, temporary_name)
                except FileNotFoundError:
                    pass
            _close_runtime_directory(target_directory)
    finally:
        os.close(source_descriptor)


def _mirror_remove_one(target_root: dict, relative_path: str, expected_target: _RuntimeEntry) -> None:
    components = _mirror_file_components(relative_path)
    target_directory = _open_runtime_directory(target_root, components[:-1], create=False)
    try:
        current = _runtime_entry_at(target_directory, components[-1])
        _validate_regular_entry(current, "stale mirror target")
        if not _same_runtime_entry(current, expected_target):
            raise ValueError("stale mirror target identity changed before removal")
        _unlink_runtime_entry(target_directory, components[-1], expected=current)
        try:
            _runtime_lstat_at(target_directory, components[-1])
        except FileNotFoundError:
            pass
        else:
            raise ValueError("stale mirror target still exists after removal")
        _fsync_runtime_directory(target_directory)
    finally:
        _close_runtime_directory(target_directory)


def mirror_data_root(source_root_value: str, target_root_value: str) -> None:
    source_root: Optional[dict] = None
    target_root: Optional[dict] = None
    try:
        try:
            source_root = _open_or_create_runtime_root(
                source_root_value,
                create=False,
                operator_owned=False,
            )
        except FileNotFoundError:
            source_root = None
        except (OSError, ValueError) as exc:
            raise _MirrorError("source_list", str(exc)) from exc

        try:
            target_root = _open_or_create_runtime_root(
                target_root_value,
                create=True,
                operator_owned=False,
            )
        except (OSError, ValueError) as exc:
            raise _MirrorError("target_root", str(exc)) from exc

        try:
            source_inventory = _mirror_inventory(source_root) if source_root is not None else {}
        except (OSError, ValueError) as exc:
            raise _MirrorError("source_list", str(exc)) from exc
        try:
            target_inventory = _mirror_inventory(target_root)
        except (OSError, ValueError) as exc:
            raise _MirrorError("target_list", str(exc)) from exc

        for relative_path in sorted(source_inventory):
            try:
                _mirror_copy_one(
                    source_root,
                    target_root,
                    relative_path,
                    source_inventory[relative_path],
                    target_inventory.get(relative_path),
                )
            except FileNotFoundError as exc:
                raise _MirrorError("copy", f"{relative_path}: {exc}") from exc
            except (OSError, ValueError) as exc:
                if "runtime path component" in str(exc):
                    raise _MirrorError("target_directory", f"{relative_path}: {exc}") from exc
                raise _MirrorError("copy", f"{relative_path}: {exc}") from exc

        for relative_path in sorted(set(target_inventory) - set(source_inventory)):
            try:
                _mirror_remove_one(target_root, relative_path, target_inventory[relative_path])
            except (OSError, ValueError) as exc:
                raise _MirrorError("stale_remove", f"{relative_path}: {exc}") from exc
    finally:
        _close_runtime_root(source_root)
        _close_runtime_root(target_root)


def _copy_open_log_to_archive(
    root: dict,
    log_name: str,
    log_entry: _RuntimeEntry,
    archive_components: Sequence[str],
    archive_name: str,
) -> None:
    source_descriptor, source_entry = _runtime_open_file(root, (log_name,), os.O_RDONLY)
    archive_directory = _open_runtime_directory(root, archive_components, create=True)
    temporary_descriptor = -1
    temporary_name = ""
    try:
        if not _same_runtime_entry(source_entry, log_entry):
            raise ValueError("daily log identity changed before archiving")
        source_digest = _digest_runtime_file(source_descriptor, source_entry)
        temporary_descriptor, temporary_name = _create_runtime_temp(
            archive_directory,
            prefix="run-daily-log-archive",
        )
        if _copy_runtime_file(source_descriptor, source_entry, temporary_descriptor) != source_digest:
            raise ValueError("daily log digest changed while it was archived")
        os.fsync(temporary_descriptor)
        temporary_entry = _entry_from_open_descriptor(temporary_descriptor)
        _validate_regular_entry(temporary_entry, "daily log archive temporary file")
        _verify_runtime_entry(root, (log_name,), source_entry)
        try:
            _runtime_entry_at(archive_directory, archive_name)
        except FileNotFoundError:
            pass
        else:
            raise FileExistsError(archive_name)
        os.close(temporary_descriptor)
        temporary_descriptor = -1
        _link_runtime_entry(
            archive_directory,
            temporary_name,
            archive_name,
            expected_source=temporary_entry,
        )
        temporary_after_link = _runtime_entry_at(archive_directory, temporary_name)
        _unlink_runtime_entry(
            archive_directory,
            temporary_name,
            expected=temporary_after_link,
        )
        temporary_name = ""
        archived = _runtime_entry_at(archive_directory, archive_name)
        _validate_regular_entry(archived, "daily log archive")
        if not _same_runtime_entry_identity(archived, temporary_entry):
            raise ValueError("published daily log archive identity mismatch")
        _fsync_runtime_directory(archive_directory)
        os.close(source_descriptor)
        source_descriptor = -1
        _mirror_remove_one(root, log_name, source_entry)
    finally:
        if temporary_descriptor >= 0:
            os.close(temporary_descriptor)
        if temporary_name:
            try:
                _unlink_runtime_entry(archive_directory, temporary_name)
            except FileNotFoundError:
                pass
        _close_runtime_directory(archive_directory)
        if source_descriptor >= 0:
            os.close(source_descriptor)


def _create_private_log(root: dict, log_name: str) -> None:
    directory = _open_runtime_directory(root, (), create=False)
    file_descriptor = -1
    temporary_name = ""
    try:
        try:
            file_descriptor, existing = _runtime_open_file(root, (log_name,), os.O_WRONLY | os.O_APPEND)
        except FileNotFoundError:
            file_descriptor, temporary_name = _create_runtime_temp(directory, prefix="run-daily-log")
            if os.name == "posix":
                os.fchmod(file_descriptor, 0o600)
            os.fsync(file_descriptor)
            temporary_entry = _entry_from_open_descriptor(file_descriptor)
            _validate_regular_entry(temporary_entry, "daily log temporary file")
            os.close(file_descriptor)
            file_descriptor = -1
            _link_runtime_entry(
                directory,
                temporary_name,
                log_name,
                expected_source=temporary_entry,
            )
            temporary_after_link = _runtime_entry_at(directory, temporary_name)
            _unlink_runtime_entry(directory, temporary_name, expected=temporary_after_link)
            temporary_name = ""
            file_descriptor, existing = _runtime_open_file(root, (log_name,), os.O_WRONLY | os.O_APPEND)
        else:
            _validate_regular_entry(existing, "daily log")
            if int(existing.stat.st_size) != 0:
                raise ValueError("daily log must be archived before reuse")
        if os.name == "posix":
            os.fchmod(file_descriptor, 0o600)
        os.fsync(file_descriptor)
        _verify_runtime_entry(root, (log_name,), _entry_from_open_descriptor(file_descriptor))
    finally:
        if file_descriptor >= 0:
            os.close(file_descriptor)
        if temporary_name:
            try:
                _unlink_runtime_entry(directory, temporary_name)
            except FileNotFoundError:
                pass
        _close_runtime_directory(directory)


def _publish_current_log(root: dict, current_components: Sequence[str], log_name: str) -> None:
    directory = _open_runtime_directory(root, current_components[:-1], create=True)
    temporary_name = _new_runtime_temp_name("run-daily-current")
    try:
        target = os.path.relpath(
            log_name,
            os.path.join(*current_components[:-1]) if current_components[:-1] else ".",
        )
        if root["mode"] == "posix":
            os.symlink(target, temporary_name, dir_fd=directory[0])
        elif root["mode"] == "windows":
            os.symlink(target, str(directory[1] / temporary_name))
        else:
            raise ValueError("secure runtime filesystem primitives are unavailable")
        temporary_entry = _runtime_entry_at(directory, temporary_name)
        if not stat.S_ISLNK(temporary_entry.stat.st_mode):
            raise ValueError("current log temporary reference is unsafe")
        _replace_runtime_entry(
            directory,
            temporary_name,
            current_components[-1],
            expected_source=temporary_entry,
        )
        temporary_name = ""
        published = _runtime_lstat_at(directory, current_components[-1])
        if not stat.S_ISLNK(published.st_mode):
            raise ValueError("current log reference is unsafe")
        if root["mode"] == "posix":
            reference = os.readlink(current_components[-1], dir_fd=directory[0])
        else:
            reference = os.readlink(str(directory[1] / current_components[-1]))
        if reference != target:
            raise ValueError("current log reference target changed")
        _fsync_runtime_directory(directory)
    finally:
        if temporary_name:
            try:
                _unlink_runtime_entry(directory, temporary_name)
            except FileNotFoundError:
                pass
        _close_runtime_directory(directory)


def prepare_daily_log(
    log_root_value: str,
    archive_relative_value: str,
    current_log_relative_value: str,
    date_value: str,
) -> Tuple[str, int, int]:
    try:
        datetime.strptime(date_value, "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError("daily log date is invalid") from exc
    root = _open_or_create_runtime_root(
        log_root_value,
        create=True,
        operator_owned=True,
    )
    try:
        _archive_normalized, archive_components = _portable_relative_path(archive_relative_value)
        _current_normalized, current_components = _portable_relative_path(current_log_relative_value)
        log_name = f"daily_{date_value}.log"
        archived_relative = ""
        try:
            log_descriptor, log_entry = _runtime_open_file(root, (log_name,), os.O_RDONLY)
        except FileNotFoundError:
            log_descriptor = -1
            log_entry = None
        if log_descriptor >= 0:
            try:
                if int(log_entry.stat.st_size) > 0:
                    os.close(log_descriptor)
                    log_descriptor = -1
                    timestamp = time.strftime("%H%M%S")
                    for suffix in range(100):
                        archive_name = (
                            f"daily_{date_value}_{timestamp}.log"
                            if suffix == 0
                            else f"daily_{date_value}_{timestamp}-{suffix}.log"
                        )
                        try:
                            _copy_open_log_to_archive(
                                root,
                                log_name,
                                log_entry,
                                archive_components,
                                archive_name,
                            )
                        except FileExistsError:
                            continue
                        archived_relative = "/".join(archive_components + (archive_name,))
                        break
                    else:
                        raise ValueError("could not allocate an exclusive log archive name")
            finally:
                if log_descriptor >= 0:
                    os.close(log_descriptor)
        _create_private_log(root, log_name)
        try:
            _publish_current_log(root, current_components, log_name)
        except (OSError, ValueError) as exc:
            print(f"[WARN] current.log 링크 갱신 실패 (warn-only): {exc}", file=sys.stderr)
        return (
            archived_relative,
            int(root["stat"].st_dev),
            int(root["stat"].st_ino),
        )
    finally:
        _close_runtime_root(root)


def append_daily_log(
    log_root_value: str,
    log_name: str,
    expected_root_device: int,
    expected_root_inode: int,
    emit_stdout: bool,
) -> None:
    _normalized, components = _portable_relative_path(log_name)
    if len(components) != 1 or not log_name.startswith("daily_") or not log_name.endswith(".log"):
        raise ValueError("daily log name is invalid")
    root = _open_or_create_runtime_root(
        log_root_value,
        create=False,
        operator_owned=True,
    )
    try:
        if (
            int(root["stat"].st_dev) != expected_root_device
            or int(root["stat"].st_ino) != expected_root_inode
        ):
            raise ValueError("daily log root identity changed")
        file_descriptor, opened = _runtime_open_file(root, components, os.O_WRONLY | os.O_APPEND)
        try:
            if os.name == "posix":
                os.fchmod(file_descriptor, 0o600)
            total = 0
            input_stream = sys.stdin.buffer
            output_stream = sys.stdout.buffer
            while True:
                chunk = input_stream.read(MIRROR_COPY_CHUNK_BYTES)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_MIRROR_BYTES:
                    raise ValueError("daily log append exceeds the permitted size")
                offset = 0
                while offset < len(chunk):
                    written = os.write(file_descriptor, chunk[offset:])
                    if written <= 0:
                        raise OSError("could not append to daily log")
                    offset += written
                if emit_stdout:
                    output_stream.write(chunk)
            if emit_stdout:
                output_stream.flush()
            os.fsync(file_descriptor)
            after = _entry_from_open_descriptor(file_descriptor)
            _validate_regular_entry(after, "daily log")
            if not _same_runtime_entry_identity(opened, after):
                raise ValueError("daily log identity changed while it was appended")
            _verify_runtime_entry(root, components, after)
        finally:
            os.close(file_descriptor)
    finally:
        _close_runtime_root(root)


def _portable_relative_path(value: object) -> Tuple[str, Tuple[str, ...]]:
    """Parse the one portable path grammar accepted in GDrive manifests."""
    if not isinstance(value, str) or not value:
        raise ValueError("GDrive relative path is required")
    if value.startswith(("/", "\\")) or "\\" in value:
        raise ValueError("GDrive relative path must use portable slash separators")
    if len(value) >= 2 and value[0].isalpha() and value[1] == ":":
        raise ValueError("GDrive relative path must not use a drive prefix")
    try:
        if len(value.encode("utf-8")) > MAX_GDRIVE_RELATIVE_PATH_BYTES:
            raise ValueError("GDrive relative path is too long")
    except UnicodeEncodeError as exc:
        raise ValueError("GDrive relative path is not valid UTF-8 text") from exc

    components = value.split("/")
    for component in components:
        if not component or component in {".", ".."}:
            raise ValueError("GDrive relative path contains an empty or traversal component")
        try:
            if len(component.encode("utf-8")) > MAX_GDRIVE_PATH_SEGMENT_BYTES:
                raise ValueError("GDrive relative path component is too long")
        except UnicodeEncodeError as exc:
            raise ValueError("GDrive relative path component is not valid UTF-8 text") from exc
        if any(ord(character) < 32 or ord(character) == 127 for character in component):
            raise ValueError("GDrive relative path contains a control character")
        if any(character in '<>:"\\|?*' for character in component):
            raise ValueError("GDrive relative path contains a platform-reserved character")
        if component.endswith((" ", ".")):
            raise ValueError("GDrive relative path component has a Windows-unsafe suffix")
        if component.split(".", 1)[0].rstrip(" ").upper() in WINDOWS_RESERVED_NAMES:
            raise ValueError("GDrive relative path contains a Windows-reserved name")
    return value, tuple(components)


def _is_reparse_point(file_stat: os.stat_result) -> bool:
    if os.name != "nt":
        return False
    return bool(
        getattr(file_stat, "st_file_attributes", 0)
        & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x0400)
    )


def _reject_link_or_reparse(file_stat: os.stat_result) -> None:
    if stat.S_ISLNK(file_stat.st_mode):
        raise ValueError("symbolic links are not allowed in GDrive frame inputs")
    if _is_reparse_point(file_stat):
        raise ValueError("Windows reparse points are not allowed in GDrive frame inputs")


def _same_filesystem_object(left: os.stat_result, right: os.stat_result) -> bool:
    return int(left.st_dev) == int(right.st_dev) and int(left.st_ino) == int(right.st_ino)


def _resolve_owner_root(value: Path) -> Path:
    root_stat = os.lstat(str(value))
    _reject_link_or_reparse(root_stat)
    if not stat.S_ISDIR(root_stat.st_mode):
        raise ValueError("GDrive source root must be a directory")
    root = value.resolve(strict=True)
    resolved_stat = os.lstat(str(root))
    _reject_link_or_reparse(resolved_stat)
    if not stat.S_ISDIR(resolved_stat.st_mode):
        raise ValueError("GDrive source root must resolve to a directory")
    return root


def _safe_join_under_root(root: Path, relative_path: object) -> Tuple[Path, str, Tuple[str, ...]]:
    normalized, components = _portable_relative_path(relative_path)
    candidate = root.joinpath(*components)
    try:
        candidate.resolve(strict=True).relative_to(root)
    except FileNotFoundError:
        pass
    except (OSError, RuntimeError, ValueError) as exc:
        raise ValueError("GDrive path escapes its source root") from exc
    return candidate, normalized, components


def _assert_path_components_not_links(root: Path, components: Sequence[str]) -> os.stat_result:
    current = root
    for index, component in enumerate(components):
        current = current / component
        file_stat = os.lstat(str(current))
        _reject_link_or_reparse(file_stat)
        if index < len(components) - 1 and not stat.S_ISDIR(file_stat.st_mode):
            raise ValueError("GDrive path contains a non-directory component")
    return file_stat


def _readonly_open_flags() -> int:
    return (
        os.O_RDONLY
        | getattr(os, "O_BINARY", 0)
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NONBLOCK", 0)
    )


def _open_posix_relative_file(root: Path, components: Sequence[str]) -> int:
    flags = _readonly_open_flags()
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    directory = getattr(os, "O_DIRECTORY", 0)
    root_fd = os.open(str(root), flags | directory | nofollow)
    try:
        current_fd = root_fd
        for index, component in enumerate(components):
            is_final = index == len(components) - 1
            child_flags = flags | nofollow
            if not is_final:
                child_flags |= directory
            child_fd = os.open(component, child_flags, dir_fd=current_fd)
            if current_fd != root_fd:
                os.close(current_fd)
            current_fd = child_fd
        if current_fd == root_fd:
            raise ValueError("GDrive relative path is required")
        return current_fd
    except BaseException:
        if "current_fd" in locals() and current_fd != root_fd:
            os.close(current_fd)
        raise
    finally:
        os.close(root_fd)


def _open_checked_relative_file(
    root: Union[Path, _WindowsTrustedRoot],
    relative_path: object,
) -> int:
    if os.name == "nt":
        return _windows_open_checked_relative_file(root, relative_path)
    if not isinstance(root, Path):
        raise ValueError("GDrive source root is invalid")
    candidate, _normalized, components = _safe_join_under_root(root, relative_path)
    if os.name == "posix" and getattr(os, "O_NOFOLLOW", 0) and os.open in os.supports_dir_fd:
        return _open_posix_relative_file(root, components)

    root_before = os.stat(str(root))
    before = _assert_path_components_not_links(root, components)
    file_descriptor = os.open(str(candidate), _readonly_open_flags())
    try:
        opened = os.fstat(file_descriptor)
        root_after = os.stat(str(root))
        after = _assert_path_components_not_links(root, components)
        candidate.resolve(strict=True).relative_to(root)
        if not _same_filesystem_object(root_before, root_after) or not _same_filesystem_object(before, after):
            raise ValueError("GDrive path changed while it was opened")
        if not _same_filesystem_object(after, opened):
            raise ValueError("opened GDrive handle does not match its path")
        return file_descriptor
    except BaseException:
        os.close(file_descriptor)
        raise


def _mtime_ns(file_stat: os.stat_result) -> int:
    return int(getattr(file_stat, "st_mtime_ns", int(file_stat.st_mtime * 1_000_000_000)))


def _ctime_ns(file_stat: os.stat_result) -> int:
    return int(getattr(file_stat, "st_ctime_ns", int(file_stat.st_ctime * 1_000_000_000)))


def _validate_open_regular_file(file_stat: os.stat_result) -> None:
    if not stat.S_ISREG(file_stat.st_mode):
        raise ValueError("GDrive input must be a regular file")
    if int(file_stat.st_nlink) != 1:
        raise ValueError("GDrive input must have exactly one filesystem link")
    if int(file_stat.st_size) < 0 or int(file_stat.st_size) > MAX_GDRIVE_MEDIA_BYTES:
        raise ValueError("GDrive input exceeds the permitted size")
    if int(file_stat.st_ino) <= 0:
        raise ValueError("GDrive input has no stable filesystem identity")


def _same_open_file_state(left: os.stat_result, right: os.stat_result) -> bool:
    return (
        _same_filesystem_object(left, right)
        and int(left.st_mode) == int(right.st_mode)
        and int(left.st_nlink) == int(right.st_nlink)
        and int(left.st_size) == int(right.st_size)
        and _mtime_ns(left) == _mtime_ns(right)
        and _ctime_ns(left) == _ctime_ns(right)
    )


def _snapshot_from_open_file(file_descriptor: int) -> dict:
    before = os.fstat(file_descriptor)
    _validate_open_regular_file(before)
    os.lseek(file_descriptor, 0, os.SEEK_SET)
    digest = hashlib.md5()  # noqa: S324 - file identity for rclone/GDrive proof.
    total = 0
    while True:
        chunk = os.read(file_descriptor, 1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > int(before.st_size):
            raise ValueError("GDrive input changed while it was hashed")
        digest.update(chunk)
    after = os.fstat(file_descriptor)
    _validate_open_regular_file(after)
    if total != int(before.st_size) or not _same_open_file_state(before, after):
        raise ValueError("GDrive input changed while it was hashed")
    return {
        "size": int(before.st_size),
        "mtimeEpoch": _mtime_ns(before) // 1_000_000_000,
        "md5": digest.hexdigest(),
        "fileIdentity": {
            "device": int(before.st_dev),
            "inode": int(before.st_ino),
            "mtimeNs": _mtime_ns(before),
            "ctimeNs": _ctime_ns(before),
        },
    }


def _snapshot_local_file(root: Union[Path, _WindowsTrustedRoot], relative_path: object) -> dict:
    file_descriptor = _open_checked_relative_file(root, relative_path)
    try:
        return _snapshot_from_open_file(file_descriptor)
    finally:
        os.close(file_descriptor)


def _manifest_relative_path(item: dict) -> str:
    if not isinstance(item, dict):
        raise ValueError("GDrive manifest item must be an object")
    normalized, _components = _portable_relative_path(item.get("relativePath"))
    return normalized


def _strict_int(value: object, field_name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"GDrive manifest {field_name} must be an integer")
    return int(value)


def _validate_manifest_item_contract(item: dict, relative_path: str) -> Tuple[int, int]:
    size = _strict_int(item.get("size"), "size")
    mtime_epoch = _strict_int(item.get("mtimeEpoch"), "mtimeEpoch")
    md5 = item.get("md5")
    identity = item.get("fileIdentity")
    if size < 0 or size > MAX_GDRIVE_MEDIA_BYTES:
        raise ValueError("GDrive manifest item size is outside permitted bounds")
    if mtime_epoch < 0:
        raise ValueError("GDrive manifest mtimeEpoch is outside permitted bounds")
    if (
        not isinstance(md5, str)
        or md5 != md5.lower()
        or len(md5) != 32
        or any(character not in "0123456789abcdef" for character in md5)
    ):
        raise ValueError("GDrive manifest md5 must be a lowercase hexadecimal digest")
    if not isinstance(identity, dict):
        raise ValueError("GDrive manifest fileIdentity is required")
    for field in ("device", "inode", "mtimeNs", "ctimeNs"):
        _strict_int(identity.get(field), f"fileIdentity.{field}")
    if item.get("dedupeKey") != _dedupe_key(relative_path, size, mtime_epoch):
        raise ValueError("GDrive manifest dedupeKey does not bind its file identity")
    if not isinstance(item.get("required"), bool):
        raise ValueError("GDrive manifest required must be a boolean")
    if not isinstance(item.get("reason"), str) or not item["reason"]:
        raise ValueError("GDrive manifest reason is required")
    if item.get("sourceState") not in {"local", "missing_local"}:
        raise ValueError("GDrive manifest sourceState is invalid")
    if item.get("state") not in QUEUE_STATES:
        raise ValueError("GDrive manifest state is invalid")
    staging_shard = item.get("stagingShard")
    if staging_shard is not None and (not isinstance(staging_shard, str) or not staging_shard):
        raise ValueError("GDrive manifest stagingShard is invalid")
    remote_path = item.get("remotePath")
    if remote_path is not None and not isinstance(remote_path, str):
        raise ValueError("GDrive manifest remotePath is invalid")
    return size, mtime_epoch


def _manifest_item_matches_snapshot(item: dict, relative_path: str, snapshot: dict) -> bool:
    size, mtime_epoch = _validate_manifest_item_contract(item, relative_path)
    return (
        size == snapshot["size"]
        and mtime_epoch == snapshot["mtimeEpoch"]
        and item["md5"] == snapshot["md5"]
        and item["fileIdentity"] == snapshot["fileIdentity"]
    )


def _open_manifest_file(
    root: Union[Path, _WindowsTrustedRoot],
    item: dict,
) -> Tuple[int, dict, str]:
    relative_path = _manifest_relative_path(item)
    file_descriptor = _open_checked_relative_file(root, relative_path)
    try:
        snapshot = _snapshot_from_open_file(file_descriptor)
        if not _manifest_item_matches_snapshot(item, relative_path, snapshot):
            raise ValueError("GDrive manifest item no longer matches its opened file")
        os.lseek(file_descriptor, 0, os.SEEK_SET)
        return file_descriptor, snapshot, relative_path
    except BaseException:
        os.close(file_descriptor)
        raise


def _validate_manifest_items(
    items: Sequence[dict],
    root: Optional[Union[Path, _WindowsTrustedRoot]] = None,
) -> List[dict]:
    validated: List[dict] = []
    seen_paths: Set[str] = set()
    for item in items:
        relative_path = _manifest_relative_path(item)
        portable_key = relative_path.casefold()
        if portable_key in seen_paths:
            raise ValueError("GDrive manifest contains duplicate portable paths")
        seen_paths.add(portable_key)
        _validate_manifest_item_contract(item, relative_path)
        if root is not None and _is_uploadable_item(item):
            file_descriptor, _snapshot, _relative_path = _open_manifest_file(root, item)
            os.close(file_descriptor)
        validated.append(item)
    return validated


def _local_regular_file_exists(root: Path, relative_path: object) -> bool:
    try:
        _snapshot_local_file(root, relative_path)
    except FileNotFoundError:
        return False
    return True


def _resolve_manifest_source_root(configured_root: Optional[str], expected: dict) -> Path:
    configured = _optional_path(configured_root)
    expected_root = expected.get("sourceRoot")
    if configured is None and not isinstance(expected_root, str):
        raise ValueError("GDrive manifest sourceRoot is required")
    root = _resolve_owner_root(Path(configured or expected_root))
    if configured is not None and isinstance(expected_root, str) and expected_root:
        manifest_root = _resolve_owner_root(Path(expected_root))
        if not _same_filesystem_object(os.stat(str(root)), os.stat(str(manifest_root))):
            raise ValueError("configured GDrive source root does not match its manifest")
    return root


def _remote_join(root: Optional[str], relative_path: str) -> Optional[str]:
    if not root:
        return None
    normalized, _components = _portable_relative_path(relative_path)
    return f"{root.rstrip('/')}/{normalized}"


def _frame_candidate_paths(frames_dir: Path, recent_minutes: int, now_epoch: Optional[float] = None) -> Iterable[Tuple[Path, str]]:
    if not frames_dir.is_dir():
        return []

    root = _resolve_owner_root(frames_dir)
    now = time.time() if now_epoch is None else now_epoch
    cutoff = now - (recent_minutes * 60)
    candidates: List[Tuple[Path, str]] = []
    for path in root.rglob("*"):
        try:
            file_stat = os.lstat(str(path))
        except OSError:
            continue
        _reject_link_or_reparse(file_stat)
        if not stat.S_ISREG(file_stat.st_mode):
            continue
        relative_path = path.relative_to(root).as_posix()
        _portable_relative_path(relative_path)
        if Path(relative_path).suffix.lower() not in FRAME_UPLOAD_EXTENSIONS:
            continue
        if int(file_stat.st_nlink) != 1:
            raise ValueError("GDrive input must have exactly one filesystem link")
        if int(file_stat.st_size) > MAX_GDRIVE_MEDIA_BYTES:
            raise ValueError("GDrive input exceeds the permitted size")
        if file_stat.st_mtime >= cutoff:
            candidates.append((path, "new_frame"))
    return candidates


def _dedupe_key(relative_path: str, size: int, mtime_epoch: int) -> str:
    normalized, _components = _portable_relative_path(relative_path)
    return f"{normalized}:{size}:{mtime_epoch}"


def _file_md5(path: Path) -> str:
    """Return an MD5 digest for remote manifest comparison."""
    root = _resolve_owner_root(path.parent)
    return _snapshot_local_file(root, path.name)["md5"]


def _manifest_item(path: Path, frames_dir: Path, reason: str, required: bool = True, remote_root: Optional[str] = None) -> dict:
    root = _resolve_owner_root(frames_dir)
    try:
        relative_path = path.relative_to(root).as_posix()
    except ValueError as exc:
        raise ValueError("GDrive input path escapes its source root") from exc
    relative_path, _components = _portable_relative_path(relative_path)
    snapshot = _snapshot_local_file(root, relative_path)
    return {
        "relativePath": relative_path,
        "size": snapshot["size"],
        "mtimeEpoch": snapshot["mtimeEpoch"],
        "dedupeKey": _dedupe_key(relative_path, snapshot["size"], snapshot["mtimeEpoch"]),
        "md5": snapshot["md5"],
        "fileIdentity": snapshot["fileIdentity"],
        "required": bool(required),
        "reason": reason,
        "sourceState": "local",
        "state": "pending_local",
        "stagingShard": None,
        "remotePath": _remote_join(remote_root, relative_path),
    }


def _copy_item(item: dict) -> dict:
    copied = dict(item)
    relative_path = _manifest_relative_path(copied)
    _validate_manifest_item_contract(copied, relative_path)
    copied["dedupeKey"] = _dedupe_key(
        relative_path,
        _strict_int(copied["size"], "size"),
        _strict_int(copied["mtimeEpoch"], "mtimeEpoch"),
    )
    copied.setdefault("required", True)
    copied.setdefault("reason", "residual_retry")
    copied.setdefault("sourceState", "missing_local")
    copied.setdefault("state", "missing_local")
    copied.setdefault("stagingShard", None)
    copied.setdefault("remotePath", None)
    return copied


def _reject_duplicate_json_keys(pairs: Sequence[Tuple[str, object]]) -> dict:
    payload: dict = {}
    for key, value in pairs:
        if key in payload:
            raise ValueError("duplicate JSON object key")
        payload[key] = value
    return payload

def _queue_record_error(line_number: int, code: str) -> ValueError:
    return ValueError(
        f"GDRIVE_RESIDUAL_QUEUE_INVALID_RECORD line={line_number} code={code}"
    )


def _validate_queue_entry(entry: dict, line_number: int) -> None:
    try:
        schema_version = _strict_int(entry.get("schemaVersion"), "schemaVersion")
    except ValueError as exc:
        raise _queue_record_error(line_number, "SCHEMA_VERSION") from exc
    if schema_version != UPLOAD_SCHEMA_VERSION:
        raise _queue_record_error(line_number, "SCHEMA_VERSION")
    for field_name in ("firstSeenAt", "lastAttemptAt"):
        value = entry.get(field_name)
        if not isinstance(value, str) or not value.strip():
            raise _queue_record_error(line_number, "REQUIRED_FIELD")
    try:
        first_seen_epoch = _strict_int(entry.get("firstSeenEpoch"), "firstSeenEpoch")
        attempts = _strict_int(entry.get("attempts"), "attempts")
        _strict_int(entry.get("lastExitCode"), "lastExitCode")
    except ValueError as exc:
        raise _queue_record_error(line_number, "INTEGER_FIELD") from exc
    if first_seen_epoch < 0 or attempts < 0:
        raise _queue_record_error(line_number, "INTEGER_RANGE")
    item = entry.get("item")
    if not isinstance(item, dict):
        raise _queue_record_error(line_number, "ITEM")
    try:
        _validate_manifest_items([item])
    except (TypeError, ValueError) as exc:
        raise _queue_record_error(line_number, "ITEM") from exc
    state = entry.get("state")
    if state is not None and state not in QUEUE_STATES:
        raise _queue_record_error(line_number, "STATE")
    staging_shard = entry.get("stagingShard")
    if staging_shard is not None and not isinstance(staging_shard, str):
        raise _queue_record_error(line_number, "STAGING_SHARD")


def _load_queue_entries(path: Path) -> List[dict]:
    if not path.is_file():
        return []
    entries: List[dict] = []
    for line_number, raw_line in enumerate(path.read_bytes().splitlines(), start=1):
        try:
            line = raw_line.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise _queue_record_error(line_number, "UTF8") from exc
        if not line.strip():
            continue
        try:
            entry = json.loads(
                line,
                object_pairs_hook=_reject_duplicate_json_keys,
                parse_constant=lambda _value: (_ for _ in ()).throw(ValueError()),
            )
        except (json.JSONDecodeError, ValueError) as exc:
            raise _queue_record_error(line_number, "JSON") from exc
        if not isinstance(entry, dict):
            raise _queue_record_error(line_number, "OBJECT")
        _validate_queue_entry(entry, line_number)
        entries.append(entry)
    return entries


def _load_residual_items(path: Optional[Path], frames_dir: Path, now_epoch: Optional[float] = None, retention_days: int = 7, remote_root: Optional[str] = None) -> List[dict]:
    if path is None or not path.is_file():
        return []

    root = _resolve_owner_root(frames_dir)
    now = time.time() if now_epoch is None else now_epoch
    retention_seconds = retention_days * 24 * 60 * 60
    items: List[dict] = []
    for entry in _load_queue_entries(path):
        item = entry.get("item") if isinstance(entry, dict) else None
        if not isinstance(item, dict):
            continue
        relative_path = _manifest_relative_path(item)
        first_seen_epoch = _safe_int(str(entry.get("firstSeenEpoch", "")), int(now))
        state = str(entry.get("state") or item.get("state") or "")
        staging_shard = entry.get("stagingShard") or item.get("stagingShard")
        durable_state = state in {"staged", "missing_local", "failed_permanent"} or bool(staging_shard)
        local_snapshot: Optional[dict]
        try:
            local_snapshot = _snapshot_local_file(root, relative_path)
        except FileNotFoundError:
            local_snapshot = None
        if not durable_state and local_snapshot is not None and now - first_seen_epoch > retention_seconds:
            continue
        if local_snapshot is not None:
            fresh_item = _manifest_item(root.joinpath(*_portable_relative_path(relative_path)[1]), root, "residual_retry", bool(item.get("required", True)), remote_root)
            fresh_item["attempts"] = _safe_int(str(entry.get("attempts", "0")), 0)
            items.append(fresh_item)
            continue
        missing_item = _copy_item(item)
        missing_item["reason"] = "residual_retry"
        missing_item["sourceState"] = "missing_local"
        if staging_shard:
            missing_item["state"] = "staged"
            missing_item["stagingShard"] = staging_shard
        else:
            missing_item["state"] = "missing_local"
        if not missing_item.get("remotePath"):
            missing_item["remotePath"] = _remote_join(remote_root, relative_path)
        missing_item["attempts"] = _safe_int(str(entry.get("attempts", "0")), 0)
        items.append(missing_item)
    return items


def count_pending_jsonl(source_dir: Path, target_dir: Path) -> int:
    """Count ``*.jsonl`` basenames present in source but missing in target."""
    if not source_dir.is_dir():
        return 0

    source_names = {path.name for path in source_dir.glob("*.jsonl") if path.is_file()}
    if not source_names:
        return 0

    target_names = set()
    if target_dir.is_dir():
        target_names = {path.name for path in target_dir.glob("*.jsonl") if path.is_file()}

    return len(source_names - target_names)


def count_frame_files(frames_dir: Path) -> int:
    """Count frame image files below ``frames_dir`` for run_daily metrics."""
    if not frames_dir.is_dir():
        return 0

    count = 0
    for _root, _dirs, files in os.walk(str(frames_dir), onerror=lambda _exc: None):
        for filename in files:
            if Path(filename).suffix.lower() in FRAME_UPLOAD_EXTENSIONS:
                count += 1
    return count


def _truthy(value: str) -> bool:
    return _parse_bool(value)


def _optional_path(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _parse_bool(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _safe_int(value: Optional[str], default: int = 0) -> int:
    if value is None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default




def _is_uploadable_item(item: dict) -> bool:
    return str(item.get("sourceState")) == "local" or str(item.get("state")) == "pending_local"


def _is_strong_proof(value: str) -> bool:
    return value in STRONG_COMPLETION_PROOFS




def _load_staging_manifest(
    path: Optional[str],
    expected: dict,
    requested_run_id: Optional[str],
) -> Dict[str, dict]:
    resolved = _optional_path(path)
    if not resolved:
        return {}
    manifest_path = Path(resolved)
    payload = _bounded_receipt_json(manifest_path, _staging_receipt_error)
    run_id, expected_manifest_sha256 = _expected_receipt_context(expected, requested_run_id)
    _validate_staging_manifest_receipt(
        payload,
        expected,
        run_id,
        expected_manifest_sha256,
    )
    staged: Dict[str, dict] = {}
    for shard in payload["shards"]:
        archive_path = Path(shard["archivePath"])
        archive_root = _resolve_owner_root(archive_path.parent)
        _verify_published_staging_archive(
            archive_root,
            shard["archiveName"],
            shard["items"],
            shard,
        )
        remote_shard = shard["remoteShard"]
        shard_id = shard["shardId"]
        for item in shard["items"]:
            relative_path = _manifest_relative_path(item)
            if relative_path in staged:
                raise _staging_receipt_error("DUPLICATE")
            staged[relative_path] = {"stagingShard": remote_shard, "shardId": shard_id}
    return staged


def _remote_md5_from_entry(entry: dict) -> Optional[str]:
    hashes = entry.get("Hashes") if isinstance(entry.get("Hashes"), dict) else {}
    value = hashes.get("MD5") or hashes.get("md5")
    if not value:
        return None
    return str(value).lower()


def build_gdrive_remote_verification(args: argparse.Namespace) -> dict:
    expected = _load_expected_manifest(Path(args.expected_manifest))
    run_id, expected_manifest_sha256 = _expected_receipt_context(expected, args.run_id)
    expected_items = _validate_manifest_items(
        [item for item in expected.get("items", []) if isinstance(item, dict)]
    )
    try:
        remote_entries = json.loads(
            Path(args.remote_list).read_text(encoding="utf-8"),
            object_pairs_hook=_reject_duplicate_json_keys,
            parse_constant=lambda _value: (_ for _ in ()).throw(ValueError()),
        )
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        raise ValueError("remote list must be valid JSON from rclone lsjson") from exc
    if not isinstance(remote_entries, list):
        raise ValueError("remote list must be a JSON array from rclone lsjson")

    remote_records: Dict[str, Tuple[str, int]] = {}
    remote_hash_count = 0
    for entry in remote_entries:
        if not isinstance(entry, dict):
            continue
        raw_relative_path = entry.get("Path")
        if not isinstance(raw_relative_path, str):
            continue
        try:
            relative_path, _components = _portable_relative_path(raw_relative_path)
        except ValueError:
            continue
        md5 = _remote_md5_from_entry(entry)
        if md5 is None:
            continue
        remote_hash_count += 1
        try:
            remote_size = _strict_int(entry.get("Size"), "remote Size")
        except ValueError:
            continue
        if remote_size < 0:
            continue
        if relative_path in remote_records:
            raise ValueError("remote list contains duplicate hashed paths")
        remote_records[relative_path] = (md5, remote_size)

    verified: List[str] = []
    missing_expected_hash: List[str] = []
    missing_remote_hash: List[str] = []
    mismatched_hash: List[str] = []
    item_receipts: List[dict] = []
    for item in expected_items:
        relative_path = _manifest_relative_path(item)
        expected_md5 = str(item.get("md5") or "").lower()
        if not expected_md5:
            missing_expected_hash.append(relative_path)
            continue
        remote_record = remote_records.get(relative_path)
        if remote_record is None:
            missing_remote_hash.append(relative_path)
            continue
        remote_md5, remote_size = remote_record
        if remote_md5 == expected_md5 and remote_size == _strict_int(item.get("size"), "size"):
            verified.append(relative_path)
            item_receipts.append(
                _remote_item_receipt(item, run_id, expected_manifest_sha256, remote_md5)
            )
        else:
            mismatched_hash.append(relative_path)

    payload = {
        "schemaVersion": UPLOAD_SCHEMA_VERSION,
        "receiptType": REMOTE_VERIFICATION_RECEIPT_TYPE,
        "generatedAt": args.generated_at or _utc_now_iso(),
        "runId": run_id,
        "expectedManifestSha256": expected_manifest_sha256,
        "expectedCount": len(expected_items),
        "remoteListedCount": len(remote_entries),
        "remoteHashCount": remote_hash_count,
        "verifiedCount": len(verified),
        "receiptCount": len(item_receipts),
        "missingExpectedHashCount": len(missing_expected_hash),
        "missingRemoteHashCount": len(missing_remote_hash),
        "mismatchedHashCount": len(mismatched_hash),
        "verifiedRelativePaths": sorted(verified),
        "missingExpectedHashRelativePaths": sorted(missing_expected_hash),
        "missingRemoteHashRelativePaths": sorted(missing_remote_hash),
        "mismatchedHashRelativePaths": sorted(mismatched_hash),
        "itemReceipts": sorted(item_receipts, key=lambda item: item["relativePath"]),
    }
    verified_output = _optional_path(args.verified_files_output)
    if verified_output:
        target = Path(verified_output)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(_canonical_json_bytes(payload) + b"\n")
    return payload



def resolve_policy_action(
    step_name: str,
    issue_kind: str,
    policy_mode: str = "end_to_end",
    pending_step08_work: int = 0,
) -> str:
    """Resolve run_daily policy actions for known step/issue pairs.

    Unknown pairs intentionally fail closed so the shell runner records them as
    required failures instead of silently treating new failure modes as optional.
    """
    key = (step_name, issue_kind)
    if key in {
        ("Step 1 (URL Collection)", "missing_external_dependency"),
        ("Step 2 (Metadata)", "missing_external_dependency"),
        ("Step 2.1 (Meta Migration)", "missing_external_dependency"),
        ("Step 13 (Supabase)", "missing_external_dependency"),
    }:
        return "optional_skip"

    if key == ("Step 08 (Chunk Multimodal)", "quota_exhausted"):
        if policy_mode == "end_to_end" and pending_step08_work > 0:
            return "required_failure"
        return "optional_skip"

    if key in {
        ("Phase 3", "timeout_incomplete"),
        ("Step 11 (LAAJ Evaluation)", "timeout_incomplete"),
    }:
        if policy_mode == "end_to_end":
            return "required_failure"
        return "optional_skip"

    return "required_failure:unknown"


def render_timeout_guard_message(elapsed_minutes: int, max_minutes: int) -> str:
    """Return the shell-visible timeout guard message.

    Keeping this text in the helper makes timeout/fail-closed operator wording
    testable without changing the shell's fallback behavior.
    """
    return f"파이프라인 시간 제한 도달 ({elapsed_minutes}m/{max_minutes}m). 남은 단계 건너뜁니다."


def render_unknown_policy_warning(step_name: str, issue_kind: str) -> str:
    """Return the fail-closed warning for unexpected policy matrix keys."""
    return (
        "정의되지 않은 정책 키를 감지했습니다. fail-closed로 required_failure 처리합니다. "
        f"({step_name}|{issue_kind})"
    )


def render_policy_summary_note(step_name: str, issue_kind: str) -> str:
    """Return a compact summary note for known policy issues."""
    if (step_name, issue_kind) == ("Phase 3", "timeout_incomplete"):
        return "Phase 3 skipped before entry (timeout_incomplete)"
    return f"{step_name} {issue_kind}"


def render_step08_message(message_kind: str, detail: str = "") -> str:
    """Return Step 08 operator/manifest wording used by run_daily.sh."""
    messages = {
        "node-prerequisite-failure": (
            f"필수 Node 패키지 누락({detail})으로 실행 생략. 먼저 'cd backend && npm ci' 를 실행하세요."
        ),
        "node-prerequisite-downstream-reason": "Step 08 Node prerequisite 미충족",
        "gemini-runtime-prerequisite-failure": (
            "Gemini API 키 또는 Web fallback 세션(gemini_cookies.json/camoufox_profile) 미설정으로 실행 생략"
        ),
        "gemini-runtime-prerequisite-downstream-reason": "Step 08 Gemini runtime prerequisite 미충족",
        "quota-detected-warning": (
            "할당량 초과(Quota Error) 감지됨. 데이터 일관성을 위해 이후 평가 단계(Step 09~13)를 모두 건너뜁니다."
        ),
        "quota-policy-issue": "Gemini quota 초과 (exit=42)",
        "quota-downstream-reason": "Step 08 quota 초과",
        "login-expired-failure": "Google 로그인 세션 만료 (exit=44)",
        "login-expired-downstream-reason": "Step 08 로그인 prerequisite 미충족",
        "login-expired-action": "해결 방법: 'python backend/restaurant-crawling/scripts/gemini_scrapling_fallback.py --login' 을 실행하여 수동 로그인하세요.",
        "generic-failure-required": f"Step 08 실패 (exit={detail})" if detail else "Step 08 실패",
        "generic-failure-downstream-reason": "Step 08 실패",
    }
    if message_kind not in messages:
        raise ValueError(f"unknown Step 08 message kind: {message_kind}")
    return messages[message_kind]


def build_gdrive_upload_expected(args: argparse.Namespace) -> dict:
    generated_at = args.generated_at or _utc_now_iso()
    frames_dir = _resolve_owner_root(Path(args.frames_dir))
    configured_source_root = _optional_path(args.source_root)
    if configured_source_root:
        source_root = _resolve_owner_root(Path(configured_source_root))
        if not _same_filesystem_object(os.stat(str(frames_dir)), os.stat(str(source_root))):
            raise ValueError("configured GDrive source root does not match frames-dir")
    residual_queue_path = Path(args.residual_queue) if args.residual_queue else None
    items_by_key: Dict[str, dict] = {}

    for path, reason in _frame_candidate_paths(frames_dir, args.recent_minutes):
        item = _manifest_item(path, frames_dir, reason, remote_root=args.remote_root)
        items_by_key[item["dedupeKey"]] = item

    for item in _load_residual_items(
        residual_queue_path,
        frames_dir,
        retention_days=args.retention_days,
        remote_root=args.remote_root,
    ):
        items_by_key[item["dedupeKey"]] = item

    all_items = sorted(items_by_key.values(), key=lambda item: _manifest_relative_path(item))
    max_items = max(0, int(args.max_items or 0))
    if max_items:
        items = all_items[:max_items]
        overflow_items = all_items[max_items:]
        _persist_overflow_queue_items(residual_queue_path, overflow_items, generated_at, frames_dir, args.retention_days)
    else:
        items = all_items
        overflow_items = []
    _validate_manifest_items(items, frames_dir)
    uploadable_count = sum(1 for item in items if _is_uploadable_item(item))
    missing_count = sum(1 for item in items if str(item.get("state")) == "missing_local")
    staged_count = sum(1 for item in items if str(item.get("state")) == "staged")
    return {
        "schemaVersion": UPLOAD_SCHEMA_VERSION,
        "generatedAt": generated_at,
        "runId": args.run_id,
        "sourceRoot": str(frames_dir),
        "remoteRoot": args.remote_root,
        "recentMinutes": args.recent_minutes,
        "maxItems": max_items,
        "overflowCount": len(overflow_items),
        "residualQueuePath": str(residual_queue_path) if residual_queue_path else None,
        "dedupeKey": "relativePath:size:mtime",
        "expectedCount": len(items),
        "uploadableCount": uploadable_count,
        "missingLocalCount": missing_count,
        "stagedShardItemCount": staged_count,
        "items": items,
    }


def _write_files_from(
    path: Path,
    items: Sequence[dict],
    source_root: Optional[Path] = None,
    only_uploadable: bool = True,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    source_items = [item for item in items if (not only_uploadable or _is_uploadable_item(item))]
    lines: List[str] = []
    for item in source_items:
        relative_path = _manifest_relative_path(item)
        if source_root is not None and _is_uploadable_item(item):
            file_descriptor, _snapshot, _relative_path = _open_manifest_file(source_root, item)
            os.close(file_descriptor)
        lines.append(relative_path)
    path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")


def _expected_manifest_error(code: str) -> ValueError:
    return ValueError(f"GDRIVE_EXPECTED_MANIFEST_INVALID code={code}")


def _load_expected_manifest(path: Path) -> dict:
    if not path.is_file():
        raise _expected_manifest_error("MISSING")
    try:
        payload = json.loads(
            path.read_bytes().decode("utf-8"),
            object_pairs_hook=_reject_duplicate_json_keys,
            parse_constant=lambda _value: (_ for _ in ()).throw(ValueError()),
        )
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise _expected_manifest_error("JSON") from exc
    if not isinstance(payload, dict):
        raise _expected_manifest_error("OBJECT")
    try:
        schema_version = _strict_int(payload.get("schemaVersion"), "schemaVersion")
    except ValueError as exc:
        raise _expected_manifest_error("SCHEMA_VERSION") from exc
    if schema_version != UPLOAD_SCHEMA_VERSION:
        raise _expected_manifest_error("SCHEMA_VERSION")
    items = payload.get("items")
    if not isinstance(items, list) or not all(isinstance(item, dict) for item in items):
        raise _expected_manifest_error("ITEMS")
    try:
        expected_count = _strict_int(payload.get("expectedCount"), "expectedCount")
        uploadable_count = _strict_int(payload.get("uploadableCount"), "uploadableCount")
    except ValueError as exc:
        raise _expected_manifest_error("COUNT") from exc
    if expected_count != len(items) or uploadable_count != sum(
        1 for item in items if _is_uploadable_item(item)
    ):
        raise _expected_manifest_error("COUNT")
    try:
        _validate_manifest_items(items)
    except (TypeError, ValueError) as exc:
        raise _expected_manifest_error("ITEMS") from exc
    return payload
def _canonical_json_bytes(payload: object) -> bytes:
    return json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def _sha256_digest(payload: object) -> str:
    return hashlib.sha256(_canonical_json_bytes(payload)).hexdigest()


def _receipt_error(code: str) -> ValueError:
    return ValueError(f"GDRIVE_VERIFICATION_RECEIPT_INVALID code={code}")


def _staging_receipt_error(code: str) -> ValueError:
    return ValueError(f"GDRIVE_STAGING_RECEIPT_INVALID code={code}")


def _is_lower_hex_digest(value: object, length: int) -> bool:
    return (
        isinstance(value, str)
        and value == value.lower()
        and len(value) == length
        and all(character in "0123456789abcdef" for character in value)
    )


def _expected_receipt_context(expected: dict, requested_run_id: Optional[str]) -> Tuple[str, str]:
    run_id = expected.get("runId")
    if not isinstance(run_id, str) or not run_id.strip():
        raise _receipt_error("RUN_ID")
    requested = _optional_path(requested_run_id)
    if requested is not None and requested != run_id:
        raise _receipt_error("RUN_ID")
    return run_id, _sha256_digest(expected)


def _manifest_item_receipt_binding(item: dict) -> dict:
    relative_path = _manifest_relative_path(item)
    _validate_manifest_item_contract(item, relative_path)
    return {
        "relativePath": relative_path,
        "size": item["size"],
        "mtimeEpoch": item["mtimeEpoch"],
        "dedupeKey": item["dedupeKey"],
        "md5": item["md5"],
        "fileIdentity": item["fileIdentity"],
    }


def _manifest_item_receipt(
    item: dict,
    run_id: str,
    expected_manifest_sha256: str,
) -> dict:
    binding = _manifest_item_receipt_binding(item)
    return {
        "runId": run_id,
        "expectedManifestSha256": expected_manifest_sha256,
        **binding,
        "itemSha256": _sha256_digest(binding),
    }


def _remote_item_receipt(
    item: dict,
    run_id: str,
    expected_manifest_sha256: str,
    remote_md5: str,
) -> dict:
    receipt = _manifest_item_receipt(item, run_id, expected_manifest_sha256)
    receipt["remoteMd5"] = remote_md5
    return receipt


def _bounded_receipt_json(path: Path, error_factory) -> dict:
    try:
        with path.open("rb") as source:
            raw = source.read(MAX_GDRIVE_RECEIPT_BYTES + 1)
    except OSError as exc:
        raise error_factory("MISSING") from exc
    if len(raw) > MAX_GDRIVE_RECEIPT_BYTES:
        raise error_factory("SIZE")
    if not raw.lstrip().startswith(b"{"):
        raise error_factory("PATH_ONLY")
    try:
        payload = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=_reject_duplicate_json_keys,
            parse_constant=lambda _value: (_ for _ in ()).throw(ValueError()),
        )
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise error_factory("JSON") from exc
    if not isinstance(payload, dict):
        raise error_factory("PATH_ONLY")
    return payload


def _require_receipt_fields(payload: dict, required: Set[str], error_factory) -> None:
    keys = set(payload)
    if keys - required:
        raise error_factory("EXTRA_FIELD")
    if required - keys:
        raise error_factory("REQUIRED_FIELD")


def _receipt_item_error(error_factory, code: str) -> ValueError:
    return error_factory(code)


def _validate_manifest_item_receipt(
    receipt: object,
    expected_by_path: Dict[str, dict],
    run_id: str,
    expected_manifest_sha256: str,
    error_factory,
    *,
    remote: bool,
) -> str:
    if not isinstance(receipt, dict):
        raise _receipt_item_error(error_factory, "ITEM")
    fields = {
        "runId",
        "expectedManifestSha256",
        "relativePath",
        "size",
        "mtimeEpoch",
        "dedupeKey",
        "md5",
        "fileIdentity",
        "itemSha256",
    }
    if remote:
        fields.add("remoteMd5")
    _require_receipt_fields(receipt, fields, error_factory)
    if receipt["runId"] != run_id or receipt["expectedManifestSha256"] != expected_manifest_sha256:
        raise _receipt_item_error(error_factory, "STALE")
    try:
        relative_path = _manifest_relative_path(receipt)
        _strict_int(receipt["size"], "receipt.size")
        _strict_int(receipt["mtimeEpoch"], "receipt.mtimeEpoch")
        identity = receipt["fileIdentity"]
        if not isinstance(identity, dict):
            raise ValueError("receipt.fileIdentity")
        for field in ("device", "inode", "mtimeNs", "ctimeNs"):
            _strict_int(identity.get(field), f"receipt.fileIdentity.{field}")
    except (TypeError, ValueError) as exc:
        raise _receipt_item_error(error_factory, "ITEM") from exc
    expected_item = expected_by_path.get(relative_path)
    if expected_item is None:
        raise _receipt_item_error(error_factory, "EXTRA")
    binding = _manifest_item_receipt_binding(expected_item)
    for field, expected_value in binding.items():
        if receipt.get(field) != expected_value:
            raise _receipt_item_error(error_factory, "IDENTITY")
    if not _is_lower_hex_digest(receipt.get("itemSha256"), 64):
        raise _receipt_item_error(error_factory, "ITEM_SHA256")
    if receipt["itemSha256"] != _sha256_digest(binding):
        raise _receipt_item_error(error_factory, "IDENTITY")
    if remote:
        remote_md5 = receipt.get("remoteMd5")
        if not _is_lower_hex_digest(remote_md5, 32) or remote_md5 != binding["md5"]:
            raise _receipt_item_error(error_factory, "IDENTITY")
    return relative_path


def _path_set_from_receipt_values(values: object, error_factory) -> Set[str]:
    if not isinstance(values, list) or not all(isinstance(value, str) for value in values):
        raise error_factory("PATHS")
    paths: Set[str] = set()
    for value in values:
        try:
            normalized, _components = _portable_relative_path(value)
        except ValueError as exc:
            raise error_factory("PATHS") from exc
        if normalized in paths:
            raise error_factory("DUPLICATE")
        paths.add(normalized)
    return paths


def _load_remote_verification_receipt(
    path: Path,
    expected: dict,
    requested_run_id: Optional[str],
) -> Set[str]:
    run_id, expected_manifest_sha256 = _expected_receipt_context(expected, requested_run_id)
    payload = _bounded_receipt_json(path, _receipt_error)
    fields = {
        "schemaVersion",
        "receiptType",
        "generatedAt",
        "runId",
        "expectedManifestSha256",
        "expectedCount",
        "remoteListedCount",
        "remoteHashCount",
        "verifiedCount",
        "receiptCount",
        "missingExpectedHashCount",
        "missingRemoteHashCount",
        "mismatchedHashCount",
        "verifiedRelativePaths",
        "missingExpectedHashRelativePaths",
        "missingRemoteHashRelativePaths",
        "mismatchedHashRelativePaths",
        "itemReceipts",
    }
    _require_receipt_fields(payload, fields, _receipt_error)
    try:
        schema_version = _strict_int(payload["schemaVersion"], "schemaVersion")
        expected_count = _strict_int(payload["expectedCount"], "expectedCount")
        remote_listed_count = _strict_int(payload["remoteListedCount"], "remoteListedCount")
        remote_hash_count = _strict_int(payload["remoteHashCount"], "remoteHashCount")
        verified_count = _strict_int(payload["verifiedCount"], "verifiedCount")
        receipt_count = _strict_int(payload["receiptCount"], "receiptCount")
        missing_expected_hash_count = _strict_int(
            payload["missingExpectedHashCount"], "missingExpectedHashCount"
        )
        missing_remote_hash_count = _strict_int(
            payload["missingRemoteHashCount"], "missingRemoteHashCount"
        )
        mismatched_hash_count = _strict_int(payload["mismatchedHashCount"], "mismatchedHashCount")
    except ValueError as exc:
        raise _receipt_error("INTEGER") from exc
    if (
        schema_version != UPLOAD_SCHEMA_VERSION
        or payload["receiptType"] != REMOTE_VERIFICATION_RECEIPT_TYPE
        or payload["runId"] != run_id
        or payload["expectedManifestSha256"] != expected_manifest_sha256
        or not isinstance(payload["generatedAt"], str)
        or not payload["generatedAt"].strip()
        or expected_count != len(expected["items"])
        or min(
            remote_listed_count,
            remote_hash_count,
            verified_count,
            receipt_count,
            missing_expected_hash_count,
            missing_remote_hash_count,
            mismatched_hash_count,
        )
        < 0
    ):
        raise _receipt_error("BINDING")
    expected_by_path = {
        _manifest_relative_path(item): item for item in _validate_manifest_items(expected["items"])
    }
    verified_paths = _path_set_from_receipt_values(payload["verifiedRelativePaths"], _receipt_error)
    missing_expected_paths = _path_set_from_receipt_values(
        payload["missingExpectedHashRelativePaths"], _receipt_error
    )
    missing_remote_paths = _path_set_from_receipt_values(
        payload["missingRemoteHashRelativePaths"], _receipt_error
    )
    mismatched_paths = _path_set_from_receipt_values(
        payload["mismatchedHashRelativePaths"], _receipt_error
    )
    if (
        len(verified_paths) != verified_count
        or verified_count != receipt_count
        or len(missing_expected_paths) != missing_expected_hash_count
        or len(missing_remote_paths) != missing_remote_hash_count
        or len(mismatched_paths) != mismatched_hash_count
    ):
        raise _receipt_error("COUNT")
    categories = (
        verified_paths,
        missing_expected_paths,
        missing_remote_paths,
        mismatched_paths,
    )
    if any(paths - set(expected_by_path) for paths in categories):
        raise _receipt_error("EXTRA")
    if sum(len(paths) for paths in categories) != len(set().union(*categories)):
        raise _receipt_error("DUPLICATE")
    if set().union(*categories) != set(expected_by_path):
        raise _receipt_error("COVERAGE")
    receipts = payload["itemReceipts"]
    if not isinstance(receipts, list) or len(receipts) != receipt_count:
        raise _receipt_error("COUNT")
    receipt_paths: Set[str] = set()
    for receipt in receipts:
        relative_path = _validate_manifest_item_receipt(
            receipt,
            expected_by_path,
            run_id,
            expected_manifest_sha256,
            _receipt_error,
            remote=True,
        )
        if relative_path in receipt_paths:
            raise _receipt_error("DUPLICATE")
        receipt_paths.add(relative_path)
    if receipt_paths != verified_paths:
        raise _receipt_error("IDENTITY")
    return receipt_paths


def _verification_receipt_path(args: argparse.Namespace) -> Optional[Path]:
    explicit = _optional_path(getattr(args, "verification_receipt", ""))
    legacy = _optional_path(getattr(args, "verified_files_from", ""))
    if explicit and legacy and Path(explicit) != Path(legacy):
        raise _receipt_error("CONFLICT")
    if explicit:
        return Path(explicit)
    if legacy:
        legacy_path = Path(legacy)
        try:
            if legacy_path.is_file() and legacy_path.stat().st_size == 0:
                return None
        except OSError as exc:
            raise _receipt_error("MISSING") from exc
        return legacy_path
    return None


def _load_verified_receipt_paths(args: argparse.Namespace, expected: dict) -> Set[str]:
    path = _verification_receipt_path(args)
    if path is None:
        return set()
    return _load_remote_verification_receipt(path, expected, getattr(args, "run_id", ""))


def _queue_payload_bytes(entries: Sequence[dict]) -> bytes:
    chunks: List[bytes] = []
    total = 0
    for entry in entries:
        encoded = (
            json.dumps(entry, ensure_ascii=False, sort_keys=True, allow_nan=False) + "\n"
        ).encode("utf-8")
        total += len(encoded)
        if total > MAX_RESIDUAL_QUEUE_BYTES:
            raise ValueError("GDRIVE_RESIDUAL_QUEUE_INVALID code=SIZE")
        chunks.append(encoded)
    return b"".join(chunks)


def _write_all(file_descriptor: int, payload: bytes) -> None:
    offset = 0
    while offset < len(payload):
        written = os.write(file_descriptor, payload[offset:])
        if not isinstance(written, int) or written <= 0:
            raise OSError("residual queue write did not advance")
        offset += written


def _unlink_owned_temp(path: Optional[Path]) -> None:
    if path is None:
        return
    try:
        os.unlink(str(path))
    except FileNotFoundError:
        pass


def _write_queue_temp(path: Path, payload: bytes) -> Path:
    file_descriptor = -1
    temporary_path: Optional[Path] = None
    try:
        file_descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{path.name}.",
            suffix=".tmp",
            dir=str(path.parent),
        )
        temporary_path = Path(temporary_name)
        _write_all(file_descriptor, payload)
        os.fsync(file_descriptor)
        os.close(file_descriptor)
        file_descriptor = -1
        return temporary_path
    except BaseException:
        if file_descriptor >= 0:
            try:
                os.close(file_descriptor)
            except OSError:
                pass
        _unlink_owned_temp(temporary_path)
        raise


def _fsync_parent_directory(path: Path) -> None:
    if os.name == "nt":
        return
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_CLOEXEC", 0)
    directory_descriptor = os.open(str(path.parent), flags)
    try:
        os.fsync(directory_descriptor)
    finally:
        os.close(directory_descriptor)


def _restore_queue_after_directory_sync_failure(
    path: Path,
    prior_payload: bytes,
    prior_exists: bool,
) -> None:
    if prior_exists:
        temporary_path = _write_queue_temp(path, prior_payload)
        try:
            os.replace(str(temporary_path), str(path))
            temporary_path = None
            _fsync_parent_directory(path)
        finally:
            _unlink_owned_temp(temporary_path)
        return
    try:
        os.unlink(str(path))
    except FileNotFoundError:
        pass
    _fsync_parent_directory(path)


def _write_queue(path: Path, entries: Sequence[dict]) -> None:
    payload = _queue_payload_bytes(entries)
    path.parent.mkdir(parents=True, exist_ok=True)
    prior_exists = path.exists()
    prior_payload = b""
    if prior_exists:
        with path.open("rb") as source:
            prior_payload = source.read(MAX_RESIDUAL_QUEUE_BYTES + 1)
        if len(prior_payload) > MAX_RESIDUAL_QUEUE_BYTES:
            raise ValueError("GDRIVE_RESIDUAL_QUEUE_INVALID code=SIZE")

    temporary_path = _write_queue_temp(path, payload)
    replaced = False
    try:
        os.replace(str(temporary_path), str(path))
        temporary_path = None
        replaced = True
        _fsync_parent_directory(path)
    except BaseException:
        if replaced:
            try:
                _restore_queue_after_directory_sync_failure(
                    path,
                    prior_payload,
                    prior_exists,
                )
            except BaseException:
                pass
        raise
    finally:
        _unlink_owned_temp(temporary_path)


def _queue_entry(
    item: dict,
    generated_at: str,
    now_epoch: int,
    *,
    previous: Optional[dict] = None,
    attempts_increment: int = 0,
    last_exit_code: int = 0,
) -> dict:
    previous = previous or {}
    attempts = _safe_int(str(previous.get("attempts", "0")), 0) + attempts_increment
    return {
        "schemaVersion": UPLOAD_SCHEMA_VERSION,
        "firstSeenAt": previous.get("firstSeenAt") or generated_at,
        "firstSeenEpoch": previous.get("firstSeenEpoch") or now_epoch,
        "lastAttemptAt": generated_at,
        "attempts": attempts,
        "lastExitCode": last_exit_code,
        "item": item,
    }


def _persist_overflow_queue_items(
    residual_queue_path: Optional[Path],
    items: Sequence[dict],
    generated_at: str,
    frames_dir: Path,
    retention_days: int,
) -> None:
    """Keep unattempted upload overflow durable for the next bounded run."""

    if residual_queue_path is None or not items:
        return

    previous_entries = _prune_queue_entries(_load_queue_entries(residual_queue_path), frames_dir, retention_days)
    previous_by_key = {
        str((entry.get("item") or {}).get("dedupeKey", "")): entry
        for entry in previous_entries
        if isinstance(entry.get("item"), dict)
    }
    overflow_keys = {str(item.get("dedupeKey", "")) for item in items}
    retained = [
        entry
        for entry in previous_entries
        if str((entry.get("item") or {}).get("dedupeKey", "")) not in overflow_keys
    ]
    now_epoch = int(time.time())
    for item in items:
        key = str(item.get("dedupeKey", ""))
        retained.append(
            _queue_entry(
                item,
                generated_at,
                now_epoch,
                previous=previous_by_key.get(key),
                attempts_increment=0,
                last_exit_code=0,
            )
        )
    _write_queue(residual_queue_path, retained)


def _prune_queue_entries(entries: Sequence[dict], frames_dir: Path, retention_days: int) -> List[dict]:
    root = _resolve_owner_root(frames_dir)
    now = int(time.time())
    retention_seconds = retention_days * 24 * 60 * 60
    retained: List[dict] = []
    for entry in entries:
        item = entry.get("item")
        if not isinstance(item, dict):
            continue
        relative_path = _manifest_relative_path(item)
        state = str(entry.get("state") or item.get("state") or "")
        staging_shard = entry.get("stagingShard") or item.get("stagingShard")
        if state in {"staged", "missing_local", "failed_permanent"} or staging_shard:
            retained_entry = dict(entry)
            retained_entry["state"] = state if state else "staged"
            retained.append(retained_entry)
            continue
        if not _local_regular_file_exists(root, relative_path):
            retained_entry = dict(entry)
            retained_entry["state"] = "missing_local"
            retained_entry["rehydrateStrategy"] = "manual"
            retained.append(retained_entry)
            continue
        first_seen_epoch = _safe_int(str(entry.get("firstSeenEpoch", "")), now)
        if now - first_seen_epoch > retention_seconds:
            continue
        retained.append(entry)
    return retained


def _batch_uploadable_items(items: Sequence[dict], max_files: int, max_bytes: int) -> List[List[dict]]:
    batches: List[List[dict]] = []
    current: List[dict] = []
    current_bytes = 0
    max_files = max(1, max_files)
    max_bytes = max(1, max_bytes)
    for item in [item for item in items if _is_uploadable_item(item)]:
        item_size = _strict_int(item.get("size"), "size")
        if item_size < 0 or item_size > MAX_GDRIVE_MEDIA_BYTES:
            raise ValueError("GDrive manifest item size is outside permitted bounds")
        would_exceed_files = len(current) >= max_files
        would_exceed_bytes = current and current_bytes + item_size > max_bytes
        if would_exceed_files or would_exceed_bytes:
            batches.append(current)
            current = []
            current_bytes = 0
        current.append(item)
        current_bytes += item_size
    if current:
        batches.append(current)
    return batches


def build_gdrive_upload_batches(args: argparse.Namespace) -> dict:
    expected = _load_expected_manifest(Path(args.expected_manifest))
    source_root = _resolve_manifest_source_root(args.source_root, expected)
    items = _validate_manifest_items(
        [item for item in expected.get("items", []) if isinstance(item, dict)],
        source_root,
    )
    batches = _batch_uploadable_items(items, args.max_files, args.max_bytes)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_batches: List[dict] = []
    for index, batch_items in enumerate(batches, start=1):
        batch_id = f"batch-{index:04d}"
        files_from = output_dir / f"{batch_id}.txt"
        _write_files_from(files_from, batch_items, source_root, only_uploadable=False)
        manifest_batches.append(
            {
                "batchId": batch_id,
                "filesFrom": str(files_from),
                "itemCount": len(batch_items),
                "byteCount": sum(_strict_int(item.get("size"), "size") for item in batch_items),
                "items": batch_items,
            }
        )
    return {
        "schemaVersion": UPLOAD_SCHEMA_VERSION,
        "generatedAt": args.generated_at or _utc_now_iso(),
        "runId": args.run_id or expected.get("runId", ""),
        "sourceRoot": str(source_root),
        "remoteRoot": args.remote_root or expected.get("remoteRoot"),
        "batchCount": len(manifest_batches),
        "uploadableCount": sum(batch["itemCount"] for batch in manifest_batches),
        "batches": manifest_batches,
    }


class _ArchiveDigestReader:
    def __init__(self, source) -> None:
        self.source = source
        self.digest = hashlib.md5()  # noqa: S324 - archive byte identity for rclone/GDrive proof.
        self.size = 0

    def read(self, size: int = -1) -> bytes:
        chunk = self.source.read(size)
        self.size += len(chunk)
        self.digest.update(chunk)
        return chunk


def _archive_add_manifest_item(
    archive: tarfile.TarFile,
    source_root: Union[Path, _WindowsTrustedRoot],
    item: dict,
) -> None:
    file_descriptor, snapshot, relative_path = _open_manifest_file(source_root, item)
    source = os.fdopen(file_descriptor, "rb", closefd=True)
    try:
        archive_name = "/".join(_portable_relative_path(relative_path)[1])
        archive_info = tarfile.TarInfo(name=archive_name)
        archive_info.size = snapshot["size"]
        archive_info.mode = 0o644
        archive_info.mtime = snapshot["mtimeEpoch"]
        archive_info.uid = 0
        archive_info.gid = 0
        archive_info.uname = ""
        archive_info.gname = ""
        reader = _ArchiveDigestReader(source)
        archive.addfile(archive_info, reader)
        after = os.fstat(source.fileno())
        _validate_open_regular_file(after)
        if (
            reader.size != snapshot["size"]
            or reader.digest.hexdigest() != snapshot["md5"]
            or int(after.st_size) != snapshot["size"]
            or _mtime_ns(after) != snapshot["fileIdentity"]["mtimeNs"]
            or _ctime_ns(after) != snapshot["fileIdentity"]["ctimeNs"]
            or int(after.st_dev) != snapshot["fileIdentity"]["device"]
            or int(after.st_ino) != snapshot["fileIdentity"]["inode"]
        ):
            raise ValueError("GDrive input changed while it was archived")
    finally:
        source.close()


class _StagingArchiveError(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(f"GDRIVE_STAGING_ARCHIVE_INVALID code={code}")


def _max_staging_archive_bytes(items: Sequence[dict]) -> int:
    item_bytes = sum(_strict_int(item.get("size"), "size") for item in items)
    return item_bytes + max(8 * 1024 * 1024, item_bytes // 100) + (len(items) * 1024)


def _validate_open_archive_file(file_stat: os.stat_result, max_bytes: int) -> None:
    if not stat.S_ISREG(file_stat.st_mode):
        raise ValueError("staging archive must be a regular file")
    if int(file_stat.st_nlink) != 1:
        raise ValueError("staging archive must have exactly one filesystem link")
    if int(file_stat.st_ino) <= 0:
        raise ValueError("staging archive has no stable filesystem identity")
    if int(file_stat.st_size) < 0 or int(file_stat.st_size) > max_bytes:
        raise ValueError("staging archive size is outside permitted bounds")


def _same_open_archive_state(left: os.stat_result, right: os.stat_result) -> bool:
    return (
        _same_filesystem_object(left, right)
        and int(left.st_mode) == int(right.st_mode)
        and int(left.st_nlink) == int(right.st_nlink)
        and int(left.st_size) == int(right.st_size)
        and _mtime_ns(left) == _mtime_ns(right)
        and _ctime_ns(left) == _ctime_ns(right)
    )


def _snapshot_staging_archive(file_descriptor: int, max_bytes: int) -> dict:
    before = os.fstat(file_descriptor)
    _validate_open_archive_file(before, max_bytes)
    os.lseek(file_descriptor, 0, os.SEEK_SET)
    digest = hashlib.sha256()
    total = 0
    while True:
        chunk = os.read(file_descriptor, 1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > int(before.st_size):
            raise ValueError("staging archive changed while it was hashed")
        digest.update(chunk)
    after = os.fstat(file_descriptor)
    _validate_open_archive_file(after, max_bytes)
    if total != int(before.st_size) or not _same_open_archive_state(before, after):
        raise ValueError("staging archive changed while it was hashed")
    return {
        "archiveSha256": digest.hexdigest(),
        "archiveSize": int(before.st_size),
        "archiveIdentity": {
            "device": int(before.st_dev),
            "inode": int(before.st_ino),
            "mode": int(before.st_mode),
        },
    }


def _validate_staging_archive_members(file_descriptor: int, items: Sequence[dict]) -> None:
    expected_items = {
        _manifest_relative_path(item): item for item in _validate_manifest_items(items)
    }
    if len(expected_items) != len(items):
        raise _StagingArchiveError("MEMBER_DUPLICATE")
    os.lseek(file_descriptor, 0, os.SEEK_SET)
    archive_file = os.fdopen(os.dup(file_descriptor), "rb", closefd=True)
    try:
        try:
            with tarfile.open(fileobj=archive_file, mode="r:gz") as archive:
                seen_paths: Set[str] = set()
                for member in archive.getmembers():
                    if not member.isfile():
                        raise _StagingArchiveError("MEMBER_TYPE")
                    try:
                        relative_path, components = _portable_relative_path(member.name)
                    except ValueError as exc:
                        raise _StagingArchiveError("MEMBER_PATH") from exc
                    if relative_path != member.name or len(components) != len(member.name.split("/")):
                        raise _StagingArchiveError("MEMBER_PATH")
                    portable_key = relative_path.casefold()
                    if portable_key in seen_paths:
                        raise _StagingArchiveError("MEMBER_DUPLICATE")
                    seen_paths.add(portable_key)
                    item = expected_items.pop(relative_path, None)
                    if item is None:
                        raise _StagingArchiveError("MEMBER_SET")
                    if member.size != _strict_int(item.get("size"), "size"):
                        raise _StagingArchiveError("MEMBER_SIZE")
                    source = archive.extractfile(member)
                    if source is None:
                        raise _StagingArchiveError("MEMBER_TYPE")
                    try:
                        digest = hashlib.md5()  # noqa: S324 - matches the GDrive item manifest.
                        total = 0
                        while True:
                            chunk = source.read(1024 * 1024)
                            if not chunk:
                                break
                            total += len(chunk)
                            if total > member.size:
                                raise _StagingArchiveError("MEMBER_SIZE")
                            digest.update(chunk)
                    finally:
                        source.close()
                    if total != member.size or digest.hexdigest() != item.get("md5"):
                        raise _StagingArchiveError("MEMBER_DIGEST")
                if expected_items:
                    raise _StagingArchiveError("MEMBER_SET")
        except _StagingArchiveError:
            raise
        except (OSError, EOFError, tarfile.TarError) as exc:
            raise _StagingArchiveError("TAR") from exc
    finally:
        archive_file.close()


def _validate_staging_archive_binding(binding: dict) -> None:
    digest = binding.get("archiveSha256")
    if (
        not isinstance(digest, str)
        or digest != digest.lower()
        or len(digest) != 64
        or any(character not in "0123456789abcdef" for character in digest)
    ):
        raise _StagingArchiveError("BINDING_SHA256")
    try:
        archive_size = _strict_int(binding.get("archiveSize"), "archiveSize")
    except ValueError as exc:
        raise _StagingArchiveError("BINDING_SIZE") from exc
    if archive_size < 0:
        raise _StagingArchiveError("BINDING_SIZE")
    identity = binding.get("archiveIdentity")
    if not isinstance(identity, dict):
        raise _StagingArchiveError("BINDING_IDENTITY")
    try:
        for field in ("device", "inode", "mode"):
            _strict_int(identity.get(field), f"archiveIdentity.{field}")
    except ValueError as exc:
        raise _StagingArchiveError("BINDING_IDENTITY") from exc
def _windows_set_file_information(
    file_descriptor: int,
    information_class: int,
    information: object,
    size: int,
) -> None:
    api = _windows_api()
    if not api["SetFileInformationByHandle"](
        api["msvcrt"].get_osfhandle(file_descriptor),
        information_class,
        api["ctypes"].byref(information),
        size,
    ):
        _raise_windows_error(
            Path("<trusted Windows file handle>"),
            api["ctypes"].get_last_error(),
        )


def _windows_checked_archive_target(root: _WindowsTrustedRoot, name: str) -> None:
    try:
        descriptor, entry = _windows_open_gdrive_relative_file(
            root,
            (name,),
            access=_windows_api()["GENERIC_READ"],
            descriptor_flags=_readonly_open_flags(),
            hook_stage="gdrive-final-archive-pinned",
        )
    except FileNotFoundError:
        return
    try:
        _validate_regular_entry(entry, "staging archive publication target")
    finally:
        os.close(descriptor)
def _windows_assert_staging_relative_entry(
    root: _WindowsTrustedRoot,
    name: str,
    expected: _RuntimeEntry,
) -> None:
    _windows_assert_trusted_root(root)
    descriptor, entry = _windows_open_relative(
        root.descriptor,
        name,
        access=_windows_api()["GENERIC_READ"],
        disposition=_windows_api()["FILE_OPEN"],
        descriptor_flags=_readonly_open_flags(),
        directory=False,
        share_delete=True,
    )
    try:
        _validate_regular_entry(entry, "trusted staging archive entry")
        if not _same_runtime_entry(entry, expected):
            raise ValueError("trusted staging archive entry identity changed")
    finally:
        os.close(descriptor)
    _windows_assert_trusted_root(root)




def _windows_replace_staging_archive(
    root: _WindowsTrustedRoot,
    source_descriptor: int,
    source_name: str,
    expected_source: _RuntimeEntry,
    target_name: str,
) -> _RuntimeEntry:
    _normalized, target_components = _portable_relative_path(target_name)
    if len(target_components) != 1:
        raise ValueError("staging archive name is invalid")
    before = _entry_from_open_descriptor(source_descriptor)
    _validate_regular_entry(before, "staging archive temporary file")
    if not _same_runtime_entry(before, expected_source):
        raise ValueError("staging archive temporary file identity changed")
    _windows_assert_staging_relative_entry(root, source_name, expected_source)
    _windows_checked_archive_target(root, target_name)
    _run_windows_runtime_hook("gdrive-before-archive-replace", root.path)
    _windows_assert_trusted_root(root)
    after_hook = _entry_from_open_descriptor(source_descriptor)
    _validate_regular_entry(after_hook, "staging archive temporary file")
    if not _same_runtime_entry(after_hook, expected_source):
        raise ValueError("staging archive temporary file changed before publication")
    _windows_assert_staging_relative_entry(root, source_name, expected_source)
    _windows_checked_archive_target(root, target_name)
    api = _windows_api()
    target_path = root.path / target_name
    encoded_name = str(target_path).encode("utf-16-le")
    file_name_offset = api["FileRenameInfo"].file_name.offset
    payload = (
        api["ctypes"].c_byte
        * (file_name_offset + len(encoded_name) + api["ctypes"].sizeof(api["wintypes"].WCHAR))
    )()
    rename_info = api["ctypes"].cast(
        payload,
        api["ctypes"].POINTER(api["FileRenameInfo"]),
    ).contents
    rename_info.replace_if_exists = True
    rename_info.root_directory = None
    rename_info.file_name_length = len(encoded_name)
    api["ctypes"].memmove(
        api["ctypes"].addressof(payload) + file_name_offset,
        encoded_name,
        len(encoded_name),
    )
    _windows_set_file_information(
        source_descriptor,
        api["FILE_RENAME_INFO"],
        payload,
        len(payload),
    )
    published = _entry_from_open_descriptor(source_descriptor)
    _validate_regular_entry(published, "published staging archive")
    if not _same_runtime_entry_identity(published, expected_source):
        raise ValueError("published staging archive identity changed")
    _windows_assert_trusted_root(root)
    return published


def _windows_delete_staging_temporary(file_descriptor: int) -> None:
    api = _windows_api()
    disposition = api["FileDispositionInfo"](True)
    _windows_set_file_information(
        file_descriptor,
        api["FILE_DISPOSITION_INFO"],
        disposition,
        api["ctypes"].sizeof(disposition),
    )


def _windows_create_staging_temporary(
    root: _WindowsTrustedRoot,
    prefix: str,
    *,
    hook_stage: str,
) -> Tuple[int, str, _RuntimeEntry]:
    for _ in range(32):
        name = _new_runtime_temp_name(prefix)
        try:
            descriptor, entry = _windows_open_relative(
                root.descriptor,
                name,
                access=(
                    _windows_api()["GENERIC_READ"]
                    | _windows_api()["GENERIC_WRITE"]
                    | _windows_api()["DELETE"]
                ),
                disposition=_windows_api()["FILE_CREATE"],
                descriptor_flags=os.O_RDWR,
                directory=False,
            )
        except FileExistsError:
            continue
        try:
            _validate_regular_entry(entry, "staging archive temporary file")
            _run_windows_runtime_hook(hook_stage, _windows_final_path(descriptor))
            _windows_assert_trusted_root(root)
            return descriptor, name, entry
        except BaseException:
            os.close(descriptor)
            raise
    raise ValueError("could not allocate a staging archive temporary file")


def _write_windows_staging_sidecar(
    root: _WindowsTrustedRoot,
    name: str,
    payload: bytes,
) -> None:
    descriptor = -1
    temporary_name = ""
    published = False
    try:
        descriptor, temporary_name, temporary_entry = _windows_create_staging_temporary(
            root,
            "gdrive-staging-manifest",
            hook_stage="gdrive-sidecar-pinned",
        )
        offset = 0
        while offset < len(payload):
            written = os.write(descriptor, payload[offset:])
            if written <= 0:
                raise OSError("could not write staging archive sidecar")
            offset += written
        os.fsync(descriptor)
        final_temporary_entry = _entry_from_open_descriptor(descriptor)
        _validate_regular_entry(final_temporary_entry, "staging archive sidecar")
        if not _same_runtime_entry_identity(final_temporary_entry, temporary_entry):
            raise ValueError("staging archive sidecar identity changed")
        _windows_replace_staging_archive(
            root,
            descriptor,
            temporary_name,
            final_temporary_entry,
            name,
        )
        published = True
    finally:
        if descriptor >= 0:
            try:
                if not published:
                    _windows_delete_staging_temporary(descriptor)
            finally:
                os.close(descriptor)



def _verify_published_staging_archive(
    archive_root: Union[Path, _WindowsTrustedRoot],
    archive_name: str,
    items: Sequence[dict],
    binding: Optional[dict] = None,
    pinned_descriptor: Optional[int] = None,
) -> dict:
    try:
        normalized_name, components = _portable_relative_path(archive_name)
    except ValueError as exc:
        raise _StagingArchiveError("ARCHIVE_NAME") from exc
    if normalized_name != archive_name or len(components) != 1:
        raise _StagingArchiveError("ARCHIVE_NAME")
    owned_root: Optional[_WindowsTrustedRoot] = None
    trusted_root: Union[Path, _WindowsTrustedRoot] = archive_root
    if os.name == "nt":
        try:
            if isinstance(archive_root, _WindowsTrustedRoot):
                _run_windows_runtime_hook("gdrive-verification-root-pinned", archive_root.path)
                _windows_assert_trusted_root(archive_root)
            else:
                owned_root = _windows_open_gdrive_root(
                    archive_root,
                    create=False,
                    hook_stage="gdrive-verification-root-pinned",
                )
            trusted_root = owned_root or archive_root
        except (OSError, ValueError) as exc:
            raise _StagingArchiveError("OPEN") from exc
    try:
        try:
            file_descriptor = (
                os.dup(pinned_descriptor)
                if pinned_descriptor is not None
                else _open_checked_relative_file(trusted_root, archive_name)
            )
        except (OSError, ValueError) as exc:
            raise _StagingArchiveError("OPEN") from exc
        try:
            if os.name == "nt":
                _run_windows_runtime_hook(
                    "gdrive-verification-archive-pinned",
                    _windows_final_path(file_descriptor),
                )
                if not isinstance(trusted_root, _WindowsTrustedRoot):
                    raise _StagingArchiveError("OPEN")
                _windows_assert_trusted_root(trusted_root)
                _windows_assert_staging_relative_entry(
                    trusted_root,
                    archive_name,
                    _entry_from_open_descriptor(file_descriptor),
                )
            try:
                snapshot = _snapshot_staging_archive(
                    file_descriptor,
                    _max_staging_archive_bytes(items),
                )
            except (OSError, ValueError) as exc:
                raise _StagingArchiveError("READ") from exc
            _validate_staging_archive_members(file_descriptor, items)
            after_members = os.fstat(file_descriptor)
            if (
                int(after_members.st_dev) != snapshot["archiveIdentity"]["device"]
                or int(after_members.st_ino) != snapshot["archiveIdentity"]["inode"]
                or int(after_members.st_mode) != snapshot["archiveIdentity"]["mode"]
                or int(after_members.st_size) != snapshot["archiveSize"]
            ):
                raise _StagingArchiveError("REPLACED")
            if binding is not None:
                _validate_staging_archive_binding(binding)
                if snapshot["archiveSha256"] != binding["archiveSha256"]:
                    raise _StagingArchiveError("SHA256")
                if snapshot["archiveSize"] != binding["archiveSize"]:
                    raise _StagingArchiveError("SIZE")
                if snapshot["archiveIdentity"] != binding["archiveIdentity"]:
                    raise _StagingArchiveError("IDENTITY")
            return snapshot
        finally:
            os.close(file_descriptor)
    finally:
        _close_windows_trusted_root(owned_root)


def _validate_staging_shard_contract(shard: object) -> dict:
    if not isinstance(shard, dict):
        raise _StagingArchiveError("SHARD")
    fields = {
        "shardId",
        "archivePath",
        "archiveName",
        "remoteShard",
        "archiveSha256",
        "archiveSize",
        "archiveIdentity",
        "itemCount",
        "byteCount",
        "items",
        "archiveReceipt",
    }
    if set(shard) != fields:
        raise _StagingArchiveError("SHARD")
    archive_name = shard.get("archiveName")
    archive_path = shard.get("archivePath")
    items = shard.get("items")
    if not isinstance(archive_name, str) or not isinstance(archive_path, str) or not isinstance(items, list):
        raise _StagingArchiveError("SHARD")
    try:
        normalized_name, components = _portable_relative_path(archive_name)
    except ValueError as exc:
        raise _StagingArchiveError("ARCHIVE_NAME") from exc
    if normalized_name != archive_name or len(components) != 1 or Path(archive_path).name != archive_name:
        raise _StagingArchiveError("ARCHIVE_NAME")
    if not all(isinstance(item, dict) for item in items):
        raise _StagingArchiveError("ITEMS")
    try:
        _validate_manifest_items(items)
        item_count = _strict_int(shard.get("itemCount"), "itemCount")
        byte_count = _strict_int(shard.get("byteCount"), "byteCount")
    except (TypeError, ValueError) as exc:
        raise _StagingArchiveError("ITEMS") from exc
    if item_count != len(items) or byte_count != sum(
        _strict_int(item.get("size"), "size") for item in items
    ):
        raise _StagingArchiveError("ITEMS")
    _validate_staging_archive_binding(shard)
    return shard
def _validate_staging_archive_receipt(
    receipt: object,
    shard: dict,
    expected_by_path: Dict[str, dict],
    run_id: str,
    expected_manifest_sha256: str,
) -> Set[str]:
    if not isinstance(receipt, dict):
        raise _staging_receipt_error("ARCHIVE_RECEIPT")
    fields = {
        "receiptType",
        "runId",
        "expectedManifestSha256",
        "shardId",
        "archiveName",
        "archiveSha256",
        "archiveSize",
        "archiveIdentity",
        "itemReceipts",
    }
    _require_receipt_fields(receipt, fields, _staging_receipt_error)
    try:
        _validate_staging_archive_binding(receipt)
    except _StagingArchiveError as exc:
        raise _staging_receipt_error("ARCHIVE_BINDING") from exc
    if (
        receipt["receiptType"] != STAGING_ARCHIVE_RECEIPT_TYPE
        or receipt["runId"] != run_id
        or receipt["expectedManifestSha256"] != expected_manifest_sha256
        or receipt["shardId"] != shard["shardId"]
        or receipt["archiveName"] != shard["archiveName"]
        or receipt["archiveSha256"] != shard["archiveSha256"]
        or receipt["archiveSize"] != shard["archiveSize"]
        or receipt["archiveIdentity"] != shard["archiveIdentity"]
    ):
        raise _staging_receipt_error("STALE")
    item_receipts = receipt["itemReceipts"]
    if not isinstance(item_receipts, list) or len(item_receipts) != len(shard["items"]):
        raise _staging_receipt_error("ARCHIVE_COUNT")
    receipt_paths: Set[str] = set()
    for item_receipt in item_receipts:
        relative_path = _validate_manifest_item_receipt(
            item_receipt,
            expected_by_path,
            run_id,
            expected_manifest_sha256,
            _staging_receipt_error,
            remote=False,
        )
        if relative_path in receipt_paths:
            raise _staging_receipt_error("DUPLICATE")
        receipt_paths.add(relative_path)
    shard_paths = {_manifest_relative_path(item) for item in shard["items"]}
    if receipt_paths != shard_paths:
        raise _staging_receipt_error("ARCHIVE_IDENTITY")
    return receipt_paths


def _validate_staging_manifest_receipt(
    payload: object,
    expected: dict,
    run_id: str,
    expected_manifest_sha256: str,
) -> None:
    if not isinstance(payload, dict):
        raise _staging_receipt_error("OBJECT")
    fields = {
        "schemaVersion",
        "receiptType",
        "generatedAt",
        "runId",
        "expectedManifestSha256",
        "sourceRoot",
        "remoteStagingRoot",
        "verifiedCount",
        "stagedShardCount",
        "stagedShardItemCount",
        "missingLocalCount",
        "shards",
        "missingItems",
        "verifiedItemReceipts",
        "missingItemReceipts",
    }
    _require_receipt_fields(payload, fields, _staging_receipt_error)
    try:
        schema_version = _strict_int(payload["schemaVersion"], "schemaVersion")
        verified_count = _strict_int(payload["verifiedCount"], "verifiedCount")
        staged_shard_count = _strict_int(payload["stagedShardCount"], "stagedShardCount")
        staged_item_count = _strict_int(payload["stagedShardItemCount"], "stagedShardItemCount")
        missing_local_count = _strict_int(payload["missingLocalCount"], "missingLocalCount")
    except ValueError as exc:
        raise _staging_receipt_error("INTEGER") from exc
    if (
        schema_version != UPLOAD_SCHEMA_VERSION
        or payload["receiptType"] != STAGING_MANIFEST_RECEIPT_TYPE
        or payload["runId"] != run_id
        or payload["expectedManifestSha256"] != expected_manifest_sha256
        or not isinstance(payload["generatedAt"], str)
        or not payload["generatedAt"].strip()
        or not isinstance(payload["sourceRoot"], str)
        or not isinstance(payload["remoteStagingRoot"], str)
        or min(verified_count, staged_shard_count, staged_item_count, missing_local_count) < 0
    ):
        raise _staging_receipt_error("BINDING")
    expected_items = _validate_manifest_items(expected["items"])
    expected_by_path = {_manifest_relative_path(item): item for item in expected_items}
    shards = payload["shards"]
    missing_items = payload["missingItems"]
    verified_receipts = payload["verifiedItemReceipts"]
    missing_receipts = payload["missingItemReceipts"]
    if (
        not isinstance(shards, list)
        or not isinstance(missing_items, list)
        or not isinstance(verified_receipts, list)
        or not isinstance(missing_receipts, list)
        or staged_shard_count != len(shards)
        or verified_count != len(verified_receipts)
        or missing_local_count != len(missing_items)
        or missing_local_count != len(missing_receipts)
    ):
        raise _staging_receipt_error("COUNT")

    verified_paths: Set[str] = set()
    for receipt in verified_receipts:
        relative_path = _validate_manifest_item_receipt(
            receipt,
            expected_by_path,
            run_id,
            expected_manifest_sha256,
            _staging_receipt_error,
            remote=True,
        )
        if relative_path in verified_paths:
            raise _staging_receipt_error("DUPLICATE")
        verified_paths.add(relative_path)

    missing_paths: Set[str] = set()
    for item, receipt in zip(missing_items, missing_receipts):
        if not isinstance(item, dict):
            raise _staging_receipt_error("MISSING_ITEM")
        try:
            relative_path = _manifest_relative_path(item)
        except ValueError as exc:
            raise _staging_receipt_error("MISSING_ITEM") from exc
        expected_item = expected_by_path.get(relative_path)
        if expected_item is None or item != expected_item:
            raise _staging_receipt_error("MISSING_IDENTITY")
        receipt_path = _validate_manifest_item_receipt(
            receipt,
            expected_by_path,
            run_id,
            expected_manifest_sha256,
            _staging_receipt_error,
            remote=False,
        )
        if receipt_path != relative_path or relative_path in missing_paths:
            raise _staging_receipt_error("DUPLICATE")
        missing_paths.add(relative_path)

    staged_paths: Set[str] = set()
    counted_items = 0
    for raw_shard in shards:
        shard = _validate_staging_shard_contract(raw_shard)
        shard_id = shard.get("shardId")
        remote_shard = shard.get("remoteShard")
        if not isinstance(shard_id, str) or not shard_id:
            raise _staging_receipt_error("SHARD_ID")
        if remote_shard is not None and not isinstance(remote_shard, str):
            raise _staging_receipt_error("REMOTE_SHARD")
        shard_paths = _validate_staging_archive_receipt(
            shard.get("archiveReceipt"),
            shard,
            expected_by_path,
            run_id,
            expected_manifest_sha256,
        )
        if staged_paths & shard_paths:
            raise _staging_receipt_error("DUPLICATE")
        for item in shard["items"]:
            relative_path = _manifest_relative_path(item)
            if item != expected_by_path[relative_path]:
                raise _staging_receipt_error("ARCHIVE_IDENTITY")
        staged_paths.update(shard_paths)
        counted_items += len(shard_paths)
    if counted_items != staged_item_count:
        raise _staging_receipt_error("COUNT")
    all_paths = verified_paths | staged_paths | missing_paths
    if (
        len(all_paths) != len(verified_paths) + len(staged_paths) + len(missing_paths)
        or all_paths != set(expected_by_path)
    ):
        raise _staging_receipt_error("COVERAGE")


def verify_gdrive_staging_shards(args: argparse.Namespace) -> int:
    expected = _load_expected_manifest(Path(args.expected_manifest))
    run_id, expected_manifest_sha256 = _expected_receipt_context(expected, args.run_id)
    payload = _bounded_receipt_json(
        Path(args.staging_manifest),
        _staging_receipt_error,
    )
    _validate_staging_manifest_receipt(
        payload,
        expected,
        run_id,
        expected_manifest_sha256,
    )
    for shard in payload["shards"]:
        archive_path = Path(shard["archivePath"])
        try:
            archive_root = _resolve_owner_root(archive_path.parent)
        except (OSError, ValueError) as exc:
            raise _StagingArchiveError("ARCHIVE_ROOT") from exc
        _verify_published_staging_archive(
            archive_root,
            shard["archiveName"],
            shard["items"],
            shard,
        )
    return len(payload["shards"])
def _load_backfill_shard_contract(path: Path, expected: dict) -> dict:
    run_id, expected_manifest_sha256 = _expected_receipt_context(expected, None)
    payload = _bounded_receipt_json(path, _staging_receipt_error)
    shard = _validate_staging_shard_contract(payload)
    expected_items = _validate_manifest_items(
        [item for item in expected.get("items", []) if isinstance(item, dict)]
    )
    expected_by_path = {
        _manifest_relative_path(item): item for item in expected_items
    }
    _validate_staging_archive_receipt(
        shard["archiveReceipt"],
        shard,
        expected_by_path,
        run_id,
        expected_manifest_sha256,
    )
    return shard


def _load_backfill_selected_paths(path: Path, shard: dict) -> List[str]:
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise _StagingArchiveError("FILES_FROM") from exc
    if len(raw) > MAX_GDRIVE_RECEIPT_BYTES:
        raise _StagingArchiveError("FILES_FROM")
    try:
        lines = raw.decode("utf-8").splitlines()
    except UnicodeDecodeError as exc:
        raise _StagingArchiveError("FILES_FROM") from exc
    allowed = {
        _manifest_relative_path(item): item
        for item in _validate_manifest_items(shard["items"])
    }
    selected: List[str] = []
    seen_paths: Set[str] = set()
    for line in lines:
        if not line:
            continue
        try:
            relative_path, _components = _portable_relative_path(line)
        except ValueError as exc:
            raise _StagingArchiveError("FILES_FROM") from exc
        if relative_path != line:
            raise _StagingArchiveError("FILES_FROM")
        portable_key = relative_path.casefold()
        if portable_key in seen_paths or relative_path not in allowed:
            raise _StagingArchiveError("FILES_FROM")
        seen_paths.add(portable_key)
        selected.append(relative_path)
    if not selected:
        raise _StagingArchiveError("FILES_FROM")
    return selected


def _create_fresh_backfill_extract_dir(path: Path) -> Path:
    try:
        os.lstat(str(path))
    except FileNotFoundError:
        pass
    else:
        raise _StagingArchiveError("EXTRACT_ROOT")
    try:
        _resolve_owner_root(path.parent)
        os.mkdir(str(path), 0o700)
        return _resolve_owner_root(path)
    except (OSError, ValueError) as exc:
        raise _StagingArchiveError("EXTRACT_ROOT") from exc


def _open_fresh_backfill_extract_target(
    root: Path,
    components: Sequence[str],
) -> int:
    if not components:
        raise _StagingArchiveError("MEMBER_PATH")
    if _secure_dirfd_supported():
        root_descriptor = os.open(
            str(root),
            _readonly_open_flags()
            | getattr(os, "O_DIRECTORY", 0)
            | getattr(os, "O_NOFOLLOW", 0),
        )
        current_descriptor = root_descriptor
        try:
            for component in components[:-1]:
                try:
                    os.mkdir(component, 0o700, dir_fd=current_descriptor)
                except FileExistsError:
                    pass
                child_descriptor = os.open(
                    component,
                    _readonly_open_flags()
                    | getattr(os, "O_DIRECTORY", 0)
                    | getattr(os, "O_NOFOLLOW", 0),
                    dir_fd=current_descriptor,
                )
                try:
                    child_stat = os.fstat(child_descriptor)
                    if not stat.S_ISDIR(child_stat.st_mode):
                        raise _StagingArchiveError("MEMBER_PATH")
                except BaseException:
                    os.close(child_descriptor)
                    raise
                if current_descriptor != root_descriptor:
                    os.close(current_descriptor)
                current_descriptor = child_descriptor
            descriptor = os.open(
                components[-1],
                os.O_WRONLY
                | os.O_CREAT
                | os.O_EXCL
                | getattr(os, "O_BINARY", 0)
                | getattr(os, "O_CLOEXEC", 0)
                | getattr(os, "O_NOFOLLOW", 0),
                0o600,
                dir_fd=current_descriptor,
            )
            try:
                _validate_open_regular_file(os.fstat(descriptor))
                return descriptor
            except BaseException:
                os.close(descriptor)
                raise
        except _StagingArchiveError:
            raise
        except OSError as exc:
            raise _StagingArchiveError("EXTRACT_OPEN") from exc
        finally:
            if current_descriptor != root_descriptor:
                os.close(current_descriptor)
            os.close(root_descriptor)

    target = root.joinpath(*components)
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        if components[:-1]:
            _assert_path_components_not_links(root, components[:-1])
        descriptor = os.open(
            str(target),
            os.O_WRONLY
            | os.O_CREAT
            | os.O_EXCL
            | getattr(os, "O_BINARY", 0)
            | getattr(os, "O_CLOEXEC", 0),
            0o600,
        )
    except (OSError, ValueError) as exc:
        raise _StagingArchiveError("EXTRACT_OPEN") from exc
    try:
        _validate_open_regular_file(os.fstat(descriptor))
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def _write_backfill_archive_member(
    source,
    item: dict,
    extract_root: Path,
    components: Sequence[str],
) -> dict:
    expected_size = _strict_int(item.get("size"), "size")
    expected_digest = item.get("md5")
    descriptor = _open_fresh_backfill_extract_target(extract_root, components)
    digest = hashlib.md5()  # noqa: S324 - matches the GDrive item manifest.
    total = 0
    try:
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk:
                break
            total += len(chunk)
            if total > expected_size:
                raise _StagingArchiveError("MEMBER_SIZE")
            digest.update(chunk)
            offset = 0
            while offset < len(chunk):
                written = os.write(descriptor, chunk[offset:])
                if written <= 0:
                    raise OSError("could not write extracted staging member")
                offset += written
        os.fsync(descriptor)
        file_stat = os.fstat(descriptor)
        _validate_open_regular_file(file_stat)
        if (
            total != expected_size
            or digest.hexdigest() != expected_digest
            or int(file_stat.st_size) != expected_size
        ):
            raise _StagingArchiveError("MEMBER_DIGEST")
        return {
            "size": total,
            "md5": digest.hexdigest(),
            "fileIdentity": {
                "device": int(file_stat.st_dev),
                "inode": int(file_stat.st_ino),
                "mtimeNs": _mtime_ns(file_stat),
                "ctimeNs": _ctime_ns(file_stat),
            },
        }
    except _StagingArchiveError:
        raise
    except OSError as exc:
        raise _StagingArchiveError("EXTRACT_WRITE") from exc
    finally:
        os.close(descriptor)


def _stream_extract_backfill_archive(
    file_descriptor: int,
    shard: dict,
    extract_root: Path,
) -> Dict[str, dict]:
    expected_items = {
        _manifest_relative_path(item): item
        for item in _validate_manifest_items(shard["items"])
    }
    expected_count = _strict_int(shard["itemCount"], "itemCount")
    expected_bytes = _strict_int(shard["byteCount"], "byteCount")
    if len(expected_items) != expected_count:
        raise _StagingArchiveError("MEMBER_COUNT")
    seen_paths: Set[str] = set()
    extracted: Dict[str, dict] = {}
    member_count = 0
    aggregate_size = 0
    os.lseek(file_descriptor, 0, os.SEEK_SET)
    archive_file = os.fdopen(os.dup(file_descriptor), "rb", closefd=True)
    try:
        try:
            with tarfile.open(fileobj=archive_file, mode="r|gz") as archive:
                while True:
                    member = archive.next()
                    if member is None:
                        break
                    if not member.isreg() or member.issym() or member.islnk():
                        raise _StagingArchiveError("MEMBER_TYPE")
                    try:
                        relative_path, components = _portable_relative_path(member.name)
                    except ValueError as exc:
                        raise _StagingArchiveError("MEMBER_PATH") from exc
                    if (
                        relative_path != member.name
                        or len(components) != len(member.name.split("/"))
                    ):
                        raise _StagingArchiveError("MEMBER_PATH")
                    portable_key = relative_path.casefold()
                    if portable_key in seen_paths:
                        raise _StagingArchiveError("MEMBER_DUPLICATE")
                    seen_paths.add(portable_key)
                    member_count += 1
                    if member_count > expected_count:
                        raise _StagingArchiveError("MEMBER_COUNT")
                    item = expected_items.pop(relative_path, None)
                    if item is None:
                        raise _StagingArchiveError("MEMBER_SET")
                    expected_size = _strict_int(item.get("size"), "size")
                    if member.size != expected_size:
                        raise _StagingArchiveError("MEMBER_SIZE")
                    aggregate_size += member.size
                    if aggregate_size > expected_bytes:
                        raise _StagingArchiveError("MEMBER_AGGREGATE")
                    source = archive.extractfile(member)
                    if source is None:
                        raise _StagingArchiveError("MEMBER_TYPE")
                    try:
                        extracted[relative_path] = _write_backfill_archive_member(
                            source,
                            item,
                            extract_root,
                            components,
                        )
                    finally:
                        source.close()
        except _StagingArchiveError:
            raise
        except (OSError, EOFError, tarfile.TarError) as exc:
            raise _StagingArchiveError("TAR") from exc
    finally:
        archive_file.close()
    if expected_items:
        raise _StagingArchiveError("MEMBER_SET")
    if member_count != expected_count:
        raise _StagingArchiveError("MEMBER_COUNT")
    if aggregate_size != expected_bytes:
        raise _StagingArchiveError("MEMBER_AGGREGATE")
    return extracted


def _list_backfill_extract_files(root: Path) -> Set[str]:
    paths: Set[str] = set()
    try:
        for current_root, directory_names, file_names in os.walk(
            str(root),
            followlinks=False,
        ):
            current_path = Path(current_root)
            for directory_name in directory_names:
                directory_path = current_path / directory_name
                directory_stat = os.lstat(str(directory_path))
                _reject_link_or_reparse(directory_stat)
                if not stat.S_ISDIR(directory_stat.st_mode):
                    raise _StagingArchiveError("EXTRACT_TREE")
            for file_name in file_names:
                file_path = current_path / file_name
                file_stat = os.lstat(str(file_path))
                _reject_link_or_reparse(file_stat)
                if not stat.S_ISREG(file_stat.st_mode):
                    raise _StagingArchiveError("EXTRACT_TREE")
                relative_path = file_path.relative_to(root).as_posix()
                normalized, _components = _portable_relative_path(relative_path)
                if normalized != relative_path:
                    raise _StagingArchiveError("EXTRACT_TREE")
                portable_key = normalized.casefold()
                if portable_key in paths:
                    raise _StagingArchiveError("EXTRACT_TREE")
                paths.add(portable_key)
    except _StagingArchiveError:
        raise
    except (OSError, ValueError) as exc:
        raise _StagingArchiveError("EXTRACT_TREE") from exc
    return paths


def _verify_backfill_extracted_files(
    extract_root: Path,
    shard: dict,
    extracted: Dict[str, dict],
) -> None:
    expected_items = {
        _manifest_relative_path(item): item
        for item in _validate_manifest_items(shard["items"])
    }
    expected_keys = {relative_path.casefold() for relative_path in expected_items}
    if _list_backfill_extract_files(extract_root) != expected_keys:
        raise _StagingArchiveError("EXTRACT_TREE")
    if set(extracted) != set(expected_items):
        raise _StagingArchiveError("EXTRACT_TREE")
    for relative_path, item in expected_items.items():
        try:
            descriptor = _open_checked_relative_file(extract_root, relative_path)
        except (OSError, ValueError) as exc:
            raise _StagingArchiveError("EXTRACT_OPEN") from exc
        try:
            snapshot = _snapshot_from_open_file(descriptor)
            if (
                snapshot["size"] != _strict_int(item.get("size"), "size")
                or snapshot["md5"] != item.get("md5")
                or snapshot["fileIdentity"] != extracted[relative_path]["fileIdentity"]
            ):
                raise _StagingArchiveError("EXTRACT_IDENTITY")
        except _StagingArchiveError:
            raise
        except (OSError, ValueError) as exc:
            raise _StagingArchiveError("EXTRACT_IDENTITY") from exc
        finally:
            os.close(descriptor)


def extract_gdrive_backfill_shard(args: argparse.Namespace) -> dict:
    expected = _load_expected_manifest(Path(args.expected_manifest))
    shard = _load_backfill_shard_contract(Path(args.shard_contract), expected)
    _load_backfill_selected_paths(Path(args.files_from), shard)
    extract_root = _create_fresh_backfill_extract_dir(Path(args.output_dir))
    archive_path = Path(args.archive)
    archive_root_handle: Optional[_WindowsTrustedRoot] = None
    try:
        try:
            archive_root = _resolve_owner_root(archive_path.parent)
            trusted_archive_root: Union[Path, _WindowsTrustedRoot] = archive_root
            if os.name == "nt":
                archive_root_handle = _windows_open_gdrive_root(
                    archive_root,
                    create=False,
                    hook_stage="gdrive-backfill-archive-pinned",
                )
                trusted_archive_root = archive_root_handle
            file_descriptor = _open_checked_relative_file(
                trusted_archive_root,
                archive_path.name,
            )
        except (OSError, ValueError) as exc:
            raise _StagingArchiveError("ARCHIVE_OPEN") from exc
        try:
            max_archive_bytes = _max_staging_archive_bytes(shard["items"])
            snapshot = _snapshot_staging_archive(file_descriptor, max_archive_bytes)
            if (
                snapshot["archiveSha256"] != shard["archiveSha256"]
                or snapshot["archiveSize"] != shard["archiveSize"]
            ):
                raise _StagingArchiveError("ARCHIVE_DIGEST")
            extracted = _stream_extract_backfill_archive(
                file_descriptor,
                shard,
                extract_root,
            )
            after = _snapshot_staging_archive(file_descriptor, max_archive_bytes)
            if (
                after["archiveSha256"] != shard["archiveSha256"]
                or after["archiveSize"] != shard["archiveSize"]
                or after["archiveSha256"] != snapshot["archiveSha256"]
                or after["archiveSize"] != snapshot["archiveSize"]
            ):
                raise _StagingArchiveError("ARCHIVE_REPLACED")
            _verify_backfill_extracted_files(extract_root, shard, extracted)
        except _StagingArchiveError:
            raise
        except (OSError, ValueError) as exc:
            raise _StagingArchiveError("EXTRACT") from exc
        finally:
            os.close(file_descriptor)
    finally:
        _close_windows_trusted_root(archive_root_handle)
    return {
        "schemaVersion": UPLOAD_SCHEMA_VERSION,
        "shardId": shard["shardId"],
        "archiveSha256": shard["archiveSha256"],
        "archiveSize": shard["archiveSize"],
        "itemCount": shard["itemCount"],
        "byteCount": shard["byteCount"],
        "items": shard["items"],
        "sourceManifestBinding": {
            "runId": shard["archiveReceipt"]["runId"],
            "expectedManifestSha256": shard["archiveReceipt"][
                "expectedManifestSha256"
            ],
        },
        "extractRoot": str(extract_root),
    }

def _create_windows_gdrive_staging_archive(
    output_root: _WindowsTrustedRoot,
    source_root: _WindowsTrustedRoot,
    shard_id: str,
    shard_items: Sequence[dict],
) -> Tuple[Path, dict]:
    archive_name = f"{shard_id}.tar.gz"
    descriptor = -1
    published = False
    try:
        descriptor, temporary_name, temporary_entry = _windows_create_staging_temporary(
            output_root,
            f"{shard_id}.tar.gz",
            hook_stage="gdrive-temp-archive-pinned",
        )
        with os.fdopen(os.dup(descriptor), "wb", closefd=True) as archive_file:
            with tarfile.open(
                fileobj=archive_file,
                mode="w:gz",
                format=tarfile.PAX_FORMAT,
            ) as archive:
                for item in shard_items:
                    _archive_add_manifest_item(archive, source_root, item)
        os.fsync(descriptor)
        final_temporary_entry = _entry_from_open_descriptor(descriptor)
        _validate_regular_entry(final_temporary_entry, "staging archive temporary file")
        if not _same_runtime_entry_identity(final_temporary_entry, temporary_entry):
            raise ValueError("staging archive temporary file identity changed")
        _windows_replace_staging_archive(
            output_root,
            descriptor,
            temporary_name,
            final_temporary_entry,
            archive_name,
        )
        published = True
        _run_windows_runtime_hook(
            "gdrive-final-archive-pinned",
            _windows_final_path(descriptor),
        )
        _windows_assert_trusted_root(output_root)
        _windows_assert_staging_relative_entry(
            output_root,
            archive_name,
            _entry_from_open_descriptor(descriptor),
        )
        return (
            output_root.path / archive_name,
            _verify_published_staging_archive(
                output_root,
                archive_name,
                shard_items,
                pinned_descriptor=descriptor,
            ),
        )
    finally:
        if descriptor >= 0:
            try:
                if not published:
                    _windows_delete_staging_temporary(descriptor)
            finally:
                os.close(descriptor)



def create_gdrive_staging_shards(args: argparse.Namespace) -> dict:
    expected = _load_expected_manifest(Path(args.expected_manifest))
    run_id, expected_manifest_sha256 = _expected_receipt_context(expected, args.run_id)
    verified_paths = _load_verified_receipt_paths(args, expected)
    source_root = _resolve_manifest_source_root(args.source_root, expected)
    source_handle: Optional[_WindowsTrustedRoot] = None
    output_handle: Optional[_WindowsTrustedRoot] = None
    try:
        source_for_operations: Union[Path, _WindowsTrustedRoot] = source_root
        if os.name == "nt":
            source_handle = _windows_open_gdrive_root(
                source_root,
                create=False,
                hook_stage="gdrive-source-root-pinned",
            )
            source_for_operations = source_handle
        items = _validate_manifest_items(
            [item for item in expected.get("items", []) if isinstance(item, dict)],
            source_for_operations,
        )
        requested_output_dir = Path(args.output_dir)
        if os.name == "nt":
            output_handle = _windows_open_gdrive_root(
                requested_output_dir,
                create=True,
                hook_stage="gdrive-output-root-pinned",
            )
            output_dir = output_handle.path
        else:
            requested_output_dir.mkdir(parents=True, exist_ok=True)
            output_dir = _resolve_owner_root(requested_output_dir)
        residual_local_items: List[dict] = []
        missing_items: List[dict] = []
        for item in items:
            relative_path = _manifest_relative_path(item)
            if relative_path in verified_paths:
                continue
            if _is_uploadable_item(item):
                residual_local_items.append(item)
            else:
                missing_items.append(item)
        batches = _batch_uploadable_items(residual_local_items, args.max_files, args.max_bytes)
        shards: List[dict] = []
        for index, shard_items in enumerate(batches, start=1):
            shard_id = f"shard-{index:04d}"
            archive_name = f"{shard_id}.tar.gz"
            if os.name == "nt":
                if source_handle is None or output_handle is None:
                    raise ValueError("secure Windows GDrive filesystem primitives are unavailable")
                archive_path, archive_binding = _create_windows_gdrive_staging_archive(
                    output_handle,
                    source_handle,
                    shard_id,
                    shard_items,
                )
            else:
                archive_path = output_dir / archive_name
                temporary_file_descriptor, temporary_name = tempfile.mkstemp(
                    prefix=f"{shard_id}-",
                    suffix=".tar.gz.tmp",
                    dir=str(output_dir),
                )
                os.close(temporary_file_descriptor)
                temporary_path = Path(temporary_name)
                try:
                    with tarfile.open(str(temporary_path), "w:gz", format=tarfile.PAX_FORMAT) as archive:
                        for item in shard_items:
                            _archive_add_manifest_item(archive, source_for_operations, item)
                    os.replace(str(temporary_path), str(archive_path))
                except BaseException:
                    try:
                        temporary_path.unlink()
                    except FileNotFoundError:
                        pass
                    raise
                archive_binding = _verify_published_staging_archive(
                    output_dir,
                    archive_path.name,
                    shard_items,
                )
            remote_shard = _remote_join(args.remote_staging_root, archive_path.name)
            shard_payload = {
                "shardId": shard_id,
                "archivePath": str(archive_path),
                "archiveName": archive_path.name,
                "remoteShard": remote_shard,
                "archiveSha256": archive_binding["archiveSha256"],
                "archiveSize": archive_binding["archiveSize"],
                "archiveIdentity": archive_binding["archiveIdentity"],
                "itemCount": len(shard_items),
                "byteCount": sum(_strict_int(item.get("size"), "size") for item in shard_items),
                "items": shard_items,
                "archiveReceipt": {
                    "receiptType": STAGING_ARCHIVE_RECEIPT_TYPE,
                    "runId": run_id,
                    "expectedManifestSha256": expected_manifest_sha256,
                    "shardId": shard_id,
                    "archiveName": archive_path.name,
                    "archiveSha256": archive_binding["archiveSha256"],
                    "archiveSize": archive_binding["archiveSize"],
                    "archiveIdentity": archive_binding["archiveIdentity"],
                    "itemReceipts": [
                        _manifest_item_receipt(item, run_id, expected_manifest_sha256)
                        for item in shard_items
                    ],
                },
            }
            sidecar_payload = (
                json.dumps(shard_payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
            ).encode("utf-8")
            if os.name == "nt":
                if output_handle is None:
                    raise ValueError("secure Windows GDrive filesystem primitives are unavailable")
                _write_windows_staging_sidecar(
                    output_handle,
                    f"{shard_id}.manifest.json",
                    sidecar_payload,
                )
            else:
                (output_dir / f"{shard_id}.manifest.json").write_bytes(sidecar_payload)
            shards.append(shard_payload)
        return {
            "schemaVersion": UPLOAD_SCHEMA_VERSION,
            "receiptType": STAGING_MANIFEST_RECEIPT_TYPE,
            "generatedAt": args.generated_at or _utc_now_iso(),
            "runId": run_id,
            "expectedManifestSha256": expected_manifest_sha256,
            "sourceRoot": str(source_root),
            "remoteStagingRoot": args.remote_staging_root,
            "verifiedCount": len(verified_paths),
            "stagedShardCount": len(shards),
            "stagedShardItemCount": sum(shard["itemCount"] for shard in shards),
            "missingLocalCount": len(missing_items),
            "shards": shards,
            "missingItems": missing_items,
            "verifiedItemReceipts": [
                _remote_item_receipt(
                    item,
                    run_id,
                    expected_manifest_sha256,
                    item["md5"],
                )
                for item in items
                if _manifest_relative_path(item) in verified_paths
            ],
            "missingItemReceipts": [
                _manifest_item_receipt(item, run_id, expected_manifest_sha256)
                for item in missing_items
            ],
        }
    finally:
        _close_windows_trusted_root(output_handle)
        _close_windows_trusted_root(source_handle)




def build_gdrive_upload_operator_message(payload: dict) -> dict:
    """Build a compact operator-facing status message for GDrive upload payloads."""
    status = str(payload.get("status") or "unknown")
    expected = _safe_int(str(payload.get("expectedCount", "0")), 0)
    verified = _safe_int(str(payload.get("verifiedCount", "0")), 0)
    residual = _safe_int(str(payload.get("residualCount", "0")), 0)
    pending = _safe_int(str(payload.get("pendingBacklogCount", "0")), 0)
    proof = str(payload.get("completionProof") or "none")

    facts = (
        f"status={status}, expected={expected}, verified={verified}, "
        f"residual={residual}, pending={pending}, proof={proof}"
    )
    if status in {"complete", "backfill_complete"}:
        return {
            "severity": "ok",
            "summary": f"GDrive upload verified ({facts})",
            "action": "No operator action required.",
        }
    if status == "skipped":
        return {
            "severity": "info",
            "summary": f"GDrive upload skipped ({facts})",
            "action": "No upload candidates were detected for this run.",
        }
    if status == "backfill_required":
        return {
            "severity": "warning",
            "summary": f"GDrive upload requires backfill ({facts})",
            "action": "Run the GDrive frame backfill workflow or verify remote proof before treating upload as complete.",
        }
    if status == "partial":
        return {
            "severity": "warning",
            "summary": f"GDrive upload completed partially ({facts})",
            "action": "Review the residual queue and rerun upload/backfill until remote proof is strong.",
        }
    if status == "failed":
        return {
            "severity": "error",
            "summary": f"GDrive upload status failed ({facts})",
            "action": "Inspect upload logs, residual queue, and accounting invariant notes before retrying.",
        }
    return {
        "severity": "warning",
        "summary": f"GDrive upload status is unknown ({facts})",
        "action": "Inspect the upload status artifact before relying on frame availability.",
    }


def _derive_policy(status: str, input_policy: str, missing_local_count: int, failed_permanent_count: int, max_residual_attempts: int, threshold: int) -> str:
    if status == "backfill_required":
        return "backfill_required"
    if missing_local_count > 0 or failed_permanent_count > 0:
        return "backfill_required"
    if max_residual_attempts >= threshold and max_residual_attempts > 0:
        return "backfill_required"
    if input_policy == "required":
        return "required"
    return "warn"


def _validate_status_policy(status: str, policy: str) -> None:
    if status not in TOP_LEVEL_STATUSES:
        raise ValueError(f"invalid upload status: {status}")
    if status == "backfill_required" and policy != "backfill_required":
        raise ValueError("status=backfill_required requires policy=backfill_required")
    if policy == "backfill_required" and status in {"complete", "backfill_complete", "skipped"}:
        raise ValueError(f"policy=backfill_required conflicts with status={status}")


def build_gdrive_upload_status(args: argparse.Namespace) -> dict:
    generated_at = args.completed_at or _utc_now_iso()
    expected = _load_expected_manifest(Path(args.expected_manifest))
    source_root = _resolve_manifest_source_root(args.source_root, expected)
    expected_items = _validate_manifest_items(
        [item for item in expected.get("items", []) if isinstance(item, dict)]
    )
    expected_count = len(expected_items)
    completion_proof = args.completion_proof
    strong_proof = _is_strong_proof(completion_proof)
    receipt_path = _verification_receipt_path(args)
    if receipt_path is not None and not strong_proof:
        raise _receipt_error("PROOF_TYPE")
    if receipt_path is None:
        if strong_proof and expected_count:
            raise _receipt_error("MISSING")
        verified_paths: Set[str] = set()
    else:
        verified_paths = _load_remote_verification_receipt(
            receipt_path,
            expected,
            args.run_id,
        )
    upload_mode = args.upload_mode
    exit_code = args.exit_code
    timed_out = _parse_bool(args.timeout)
    skipped = _parse_bool(args.skipped)
    staging_by_path = _load_staging_manifest(
        args.staging_manifest,
        expected,
        args.run_id,
    )

    verified_items = [
        item
        for item in expected_items
        if _manifest_relative_path(item) in verified_paths and strong_proof
    ]
    verified_count = len(verified_items)
    verified_path_set = {_manifest_relative_path(item) for item in verified_items}
    residual_items = [
        item for item in expected_items if _manifest_relative_path(item) not in verified_path_set
    ]
    residual_count = len(residual_items)
    terminal_status = "backfill_complete" if upload_mode == "backfill" else "complete"

    if skipped and expected_count == 0:
        status = "skipped"
        attempted_count = 0
        residual_items = []
        residual_count = 0
    elif expected_count == 0:
        status = "skipped"
        attempted_count = 0
    elif residual_count == 0 and strong_proof:
        status = terminal_status
        attempted_count = expected.get("uploadableCount", expected_count)
    elif timed_out or exit_code != 0:
        status = "partial"
        attempted_count = expected.get("uploadableCount", expected_count)
    else:
        # A clean copy exit without a remote proof is not a terminal success.
        status = "backfill_required"
        attempted_count = expected.get("uploadableCount", expected_count)
        if completion_proof == "none":
            completion_proof = "rclone_exit_zero" if exit_code == 0 else "none"

    residual_queue_path = Path(args.residual_queue) if args.residual_queue else None
    max_residual_attempts = 0
    pending_local_count = 0
    staged_shard_item_count = 0
    missing_local_count = 0
    failed_permanent_count = 0
    retained_unmatched_count = 0
    if residual_queue_path is not None:
        previous_entries = _load_queue_entries(residual_queue_path)
        previous_entries = _prune_queue_entries(previous_entries, source_root, args.retention_days)
        current_keys = {str(item.get("dedupeKey", "")) for item in expected_items}
        retained = [entry for entry in previous_entries if str((entry.get("item") or {}).get("dedupeKey", "")) not in current_keys]
        retained_unmatched_count = len(retained)
        now_epoch = int(time.time())
        previous_by_key = {
            str((entry.get("item") or {}).get("dedupeKey", "")): entry
            for entry in previous_entries
            if isinstance(entry.get("item"), dict)
        }
        for item in residual_items:
            key = str(item.get("dedupeKey", ""))
            relative_path = _manifest_relative_path(item)
            previous = previous_by_key.get(key, {})
            attempts = _safe_int(str(previous.get("attempts", item.get("attempts", "0"))), 0)
            if not skipped:
                attempts += 1
            max_residual_attempts = max(max_residual_attempts, attempts)
            queue_item = _copy_item(item)
            staged_info = staging_by_path.get(relative_path)
            if staged_info and staged_info.get("stagingShard"):
                state = "staged"
                queue_item["state"] = state
                queue_item["sourceState"] = "missing_local"
                queue_item["stagingShard"] = staged_info.get("stagingShard")
                rehydrate_strategy = "staging_shard"
            elif str(item.get("state")) == "staged" and item.get("stagingShard"):
                state = "staged"
                queue_item["state"] = state
                queue_item["sourceState"] = "missing_local"
                queue_item["stagingShard"] = item.get("stagingShard")
                rehydrate_strategy = "staging_shard"
            elif _is_uploadable_item(item) and _local_regular_file_exists(source_root, relative_path):
                state = "pending_local"
                queue_item["state"] = state
                queue_item["sourceState"] = "local"
                rehydrate_strategy = "local"
            else:
                state = "missing_local"
                queue_item["state"] = state
                queue_item["sourceState"] = "missing_local"
                rehydrate_strategy = "manual"
            if state not in QUEUE_STATES:
                raise ValueError(f"invalid queue state: {state}")
            if completion_proof == "rclone_exit_zero":
                queue_item["verificationRequired"] = True
            entry = {
                "schemaVersion": UPLOAD_SCHEMA_VERSION,
                "firstSeenAt": previous.get("firstSeenAt") or generated_at,
                "firstSeenEpoch": previous.get("firstSeenEpoch") or now_epoch,
                "lastAttemptAt": generated_at,
                "attempts": attempts,
                "state": state,
                "lastExitCode": exit_code,
                "item": queue_item,
                "stagingShard": queue_item.get("stagingShard"),
                "rehydrateStrategy": rehydrate_strategy,
            }
            retained.append(entry)
        for entry in retained:
            max_residual_attempts = max(max_residual_attempts, _safe_int(str(entry.get("attempts", "0")), 0))
            state = str(entry.get("state") or (entry.get("item") or {}).get("state") or "")
            if state == "pending_local":
                pending_local_count += 1
            elif state == "staged":
                staged_shard_item_count += 1
            elif state == "missing_local":
                missing_local_count += 1
            elif state == "failed_permanent":
                failed_permanent_count += 1
        _write_queue(residual_queue_path, retained)
    else:
        for item in residual_items:
            state = str(item.get("state") or "")
            if state == "pending_local" or _is_uploadable_item(item):
                pending_local_count += 1
            elif state == "staged":
                staged_shard_item_count += 1
            else:
                missing_local_count += 1

    effective_expected_count = expected_count + retained_unmatched_count
    residual_count = residual_count + retained_unmatched_count
    if status == "skipped" and retained_unmatched_count > 0:
        status = "backfill_required"
    if status == "complete" and retained_unmatched_count > 0:
        status = "backfill_required"
    if status == "partial" and (missing_local_count > 0 or staged_shard_item_count > 0 or max_residual_attempts >= args.backfill_threshold_attempts):
        status = "backfill_required"

    policy = _derive_policy(status, args.policy, missing_local_count, failed_permanent_count, max_residual_attempts, args.backfill_threshold_attempts)
    _validate_status_policy(status, policy)

    uploaded_count = 0
    uploaded_confidence = "unknown" if expected_count else "exact"
    skipped_existing_count = 0
    pending_backlog_count = pending_local_count + staged_shard_item_count + missing_local_count
    terminal_incomplete = status in {"partial", "backfill_required", "failed"}
    payload = {
        "schemaVersion": UPLOAD_SCHEMA_VERSION,
        "runId": args.run_id or expected.get("runId", ""),
        "policy": policy,
        "inputPolicy": args.policy,
        "sourceRoot": str(source_root),
        "remoteRoot": args.remote_root or expected.get("remoteRoot"),
        "startedAt": args.started_at or None,
        "completedAt": generated_at,
        "uploadMode": upload_mode,
        "expectedCount": effective_expected_count,
        "attemptedCount": attempted_count,
        "uploadedCount": uploaded_count,
        "uploadedCountConfidence": uploaded_confidence,
        "skippedExistingCount": skipped_existing_count,
        "verifiedCount": verified_count,
        "residualCount": residual_count,
        "pendingBacklogCount": pending_backlog_count,
        "pendingLocalCount": pending_local_count,
        "stagedShardItemCount": staged_shard_item_count,
        "missingLocalCount": missing_local_count,
        "stagedShardCount": len({info.get("shardId") for info in staging_by_path.values() if info.get("shardId")}),
        "maxResidualAttempts": max_residual_attempts,
        "backfillThresholdAttempts": args.backfill_threshold_attempts,
        "timeout": timed_out,
        "exitCode": exit_code,
        "status": status,
        "terminalIncomplete": terminal_incomplete,
        "completionProof": completion_proof,
        "verificationRequired": bool(residual_count and completion_proof == "rclone_exit_zero"),
        "dedupeKey": "relativePath:size:mtime",
        "residualQueuePath": str(residual_queue_path) if residual_queue_path else None,
        "notes": list(args.note or []),
    }
    if completion_proof == "rclone_exit_zero":
        payload["notes"].append("rclone copy exited zero but remote proof is required before terminal success")
    if payload["expectedCount"] != payload["verifiedCount"] + payload["skippedExistingCount"] + payload["residualCount"]:
        payload["status"] = "failed"
        payload["terminalIncomplete"] = True
        payload["notes"].append("accounting invariant failed")
    if payload["status"] in {"complete", "backfill_complete"} and not _is_strong_proof(payload["completionProof"]):
        payload["status"] = "failed"
        payload["terminalIncomplete"] = True
        payload["notes"].append("terminal status requires strong remote completion proof")
    payload["operatorMessage"] = build_gdrive_upload_operator_message(payload)
    return payload


def _repair_cli_text(value: str) -> str:
    """Repair UTF-8 argv text mojibaked by Windows bash/native Python boundaries."""
    if not any(marker in value for marker in ("Ã", "Â", "â", "ë", "ì", "ê", "í")):
        return value
    try:
        return value.encode("latin-1").decode("utf-8")
    except UnicodeError:
        return value


def _optional_string(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    normalized = _repair_cli_text(str(value)).strip()
    return normalized or None


def _build_runtime_telemetry(args: argparse.Namespace) -> dict:
    runtime = {
        "githubRunId": _optional_string(args.github_run_id),
        "githubRunAttempt": _optional_string(args.github_run_attempt),
        "githubRunUrl": _optional_string(args.github_run_url),
        "githubWorkflow": _optional_string(args.github_workflow),
        "githubSha": _optional_string(args.github_sha),
        "githubRef": _optional_string(args.github_ref),
        "githubEventName": _optional_string(args.github_event_name),
        "executionBranch": _optional_string(args.execution_branch),
        "targetBranch": _optional_string(args.target_branch),
    }
    return {key: value for key, value in runtime.items() if value is not None}


def _parse_step_event(value: str) -> dict:
    """Parse a tab-delimited step event emitted by run_daily.sh."""
    parts = value.split("\t")
    if len(parts) > 5:
        raise ValueError("step event must have at most five tab-delimited fields")
    while len(parts) < 5:
        parts.append("")

    status, name, duration_seconds, reason, upstream_step = (
        _repair_cli_text(part).strip() for part in parts
    )
    if not status:
        raise ValueError("step event status is required")
    if status not in STEP_EVENT_STATUSES:
        raise ValueError(f"invalid step event status: {status}")
    if not name:
        raise ValueError("step event name is required")

    event = {
        "name": name,
        "status": status,
    }
    normalized_duration = duration_seconds.strip()
    if normalized_duration:
        try:
            event["durationSeconds"] = int(normalized_duration)
        except ValueError as exc:
            raise ValueError(f"invalid step event duration: {duration_seconds}") from exc
    normalized_reason = _optional_string(reason)
    if normalized_reason:
        event["reason"] = normalized_reason
    normalized_upstream = _optional_string(upstream_step)
    if normalized_upstream:
        event["upstreamStep"] = normalized_upstream
    return event


def build_summary_manifest(args: argparse.Namespace) -> dict:
    """Build the stable run_daily summary manifest payload."""
    generated_at = args.generated_at or _utc_now_iso()
    manifest = {
        "generatedAt": generated_at,
        "date": args.date,
        "finalStatus": args.final_status,
        "finalExitCode": args.final_exit_code,
        "failedRequiredSteps": [
            _repair_cli_text(item) for item in list(args.failed_required_step or [])
        ],
        "optionalSkips": [
            _repair_cli_text(item) for item in list(args.optional_skip or [])
        ],
        "downstreamSkips": [
            _repair_cli_text(item) for item in list(args.downstream_skip or [])
        ],
        "latestLogPath": _optional_path(args.latest_log_path),
        "summaryPath": _optional_path(args.summary_path),
        "noWorkShortCircuit": _truthy(args.no_work_short_circuit),
        "policyMode": args.policy_mode,
        "stepEvents": [_parse_step_event(item) for item in (args.step_event or [])],
    }
    runtime = _build_runtime_telemetry(args)
    if runtime:
        manifest["runtime"] = runtime
    return manifest

def validate_summary_manifest_payload(payload: object) -> None:
    """Validate the bounded schema run_daily.sh must read back after writing."""
    if not isinstance(payload, dict):
        raise ValueError("summary manifest must be a JSON object")
    final_status = payload.get("finalStatus")
    if final_status not in {"OK", "WARN", "ERROR"}:
        raise ValueError(f"invalid summary finalStatus: {final_status}")
    if not isinstance(payload.get("finalExitCode"), int):
        raise ValueError("summary finalExitCode must be an integer")
    for field in ("failedRequiredSteps", "optionalSkips", "downstreamSkips"):
        value = payload.get(field)
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            raise ValueError(f"summary {field} must be a string list")
    step_events = payload.get("stepEvents")
    if not isinstance(step_events, list):
        raise ValueError("summary stepEvents must be a list")
    for index, event in enumerate(step_events):
        if not isinstance(event, dict):
            raise ValueError(f"summary stepEvents[{index}] must be an object")
        name = event.get("name")
        status = event.get("status")
        if not isinstance(name, str) or not name.strip():
            raise ValueError(f"summary stepEvents[{index}].name must be a non-empty string")
        if status not in STEP_EVENT_STATUSES:
            raise ValueError(f"summary stepEvents[{index}].status is invalid: {status}")
        if "durationSeconds" in event:
            duration = event["durationSeconds"]
            if not isinstance(duration, int) or duration < 0:
                raise ValueError(f"summary stepEvents[{index}].durationSeconds must be a non-negative integer")
        for field in ("reason", "upstreamStep"):
            if field in event and not isinstance(event[field], str):
                raise ValueError(f"summary stepEvents[{index}].{field} must be a string")



def render_summary_flow_guide() -> str:
    """Return the beginner-facing static pipeline flow block for summary.md."""
    return """+----------------------------------------------------------------------------------------------------------+
|                                    TZUDONG PIPELINE FLOW (데이터 자동 수집)                                |
+----------------------------------------------------------------------------------------------------------+
|                                                                                                          |
|  [Phase 1: 데이터 수집 준비]                                                                             |
|  1. 최신 영상/누락 영상의 주소를 찾습니다.                                                                 |
|  2. 제목, 재생시간 등 껍데기(메타데이터) 정보를 채워 넣습니다.                                               |
|                                                                                                          |
|  [Phase 2: 영상 본문 뜯어오기]                                                                             |
|  3. 영상의 자막과 영상 캡처 화면(프레임)을 추출합니다.                                                       |
|                                                                                                          |
|  [Phase 3: 인공지능(AI) 식당 탐색 & 검증]                                                                  |
|  4. Gemini AI에게 자막과 화면을 보여주고 "어떤 식당을 방문했는지" 찾게 시킵니다.                             |
|  5. AI가 찾은 정보가 맞는지, 이상한 말은 없는지 규칙과 다른 AI(LAAJ 평가)로 두 번, 세 번 검증합니다.             |
|                                                                                                          |
|  [Phase 4: 데이터베이스 등록]                                                                              |
|  6. 최종적으로 합격한 식당 정보들만 모아서 서비스 데이터베이스(Supabase)에 정식으로 올립니다! 🎉             |
|                                                                                                          |
+----------------------------------------------------------------------------------------------------------+
"""


PUBLICATION_SCHEMA_VERSION = 1
PUBLICATION_BUNDLE_NAME = "daily-data-publication.tar"
PUBLICATION_MANIFEST_NAME = "publication-manifest.json"
PUBLICATION_ALLOWED_ROOTS = (
    "backend/restaurant-crawling/data",
    "backend/restaurant-evaluation/data",
)
PUBLICATION_ALLOWED_SUFFIXES = (".json", ".jsonl", ".txt")
PUBLICATION_ALLOWED_MODES = {0o600, 0o640, 0o644, 0o660, 0o664}
PUBLICATION_MAX_FILES = 50_000
PUBLICATION_MAX_BYTES = 2 * 1024 * 1024 * 1024
PUBLICATION_FORBIDDEN_COMPONENTS = {
    "frames",
    "video_cache",
    "temp_video",
    "thumbnails",
    "log",
    "logs",
}
PUBLICATION_FORBIDDEN_NAME_PARTS = ("credential", "cookie", "secret", "token", "password", "log")
# Match forbidden keywords at separator boundaries (_, -, ., start, end) with
# optional trailing 's'.  This avoids false positives on YouTube video IDs where
# keywords like 'log' appear embedded in Base64-like alphanumeric strings.
_PUBLICATION_FORBIDDEN_NAME_RE = re.compile(
    r"(?:^|[_\-.])(?:" + "|".join(re.escape(p) for p in PUBLICATION_FORBIDDEN_NAME_PARTS) + r")s?(?:[_\-.]|$)",
    re.IGNORECASE,
)


def _publication_error(code: str) -> ValueError:
    return ValueError(f"DAILY_PUBLICATION_BUNDLE_INVALID code={code}")


def _publication_sha1(value: object) -> str:
    if not isinstance(value, str) or len(value) != 40 or any(char not in "0123456789abcdef" for char in value):
        raise _publication_error("SHA")
    return value


def _publication_relative_path(path: Path, root: Path) -> str:
    relative = path.relative_to(root).as_posix()
    _normalized, _components = _portable_relative_path(relative)
    return relative


def _publication_file_entry(path: Path, project_root: Path) -> dict:
    file_stat = os.lstat(path)
    if stat.S_ISLNK(file_stat.st_mode) or not stat.S_ISREG(file_stat.st_mode):
        raise _publication_error("FILE_TYPE")
    mode = stat.S_IMODE(file_stat.st_mode)
    if mode not in PUBLICATION_ALLOWED_MODES:
        raise _publication_error("FILE_MODE")
    if file_stat.st_size < 0 or file_stat.st_size > PUBLICATION_MAX_BYTES:
        raise _publication_error("FILE_SIZE")
    digest = hashlib.sha256()
    copied_size = 0
    descriptor = os.open(str(path), _readonly_open_flags())
    try:
        opened_stat = os.fstat(descriptor)
        if not _same_filesystem_object(file_stat, opened_stat) or _mtime_ns(file_stat) != _mtime_ns(opened_stat):
            raise _publication_error("FILE_RACE")
        with os.fdopen(descriptor, "rb", closefd=False) as source:
            while True:
                chunk = source.read(MIRROR_COPY_CHUNK_BYTES)
                if not chunk:
                    break
                copied_size += len(chunk)
                digest.update(chunk)
        after_stat = os.fstat(descriptor)
    finally:
        os.close(descriptor)
    current_stat = os.lstat(path)
    if (
        copied_size != file_stat.st_size
        or not _same_filesystem_object(file_stat, after_stat)
        or _mtime_ns(file_stat) != _mtime_ns(after_stat)
        or not _same_filesystem_object(file_stat, current_stat)
        or _mtime_ns(file_stat) != _mtime_ns(current_stat)
    ):
        raise _publication_error("FILE_RACE")
    relative = _publication_relative_path(path, project_root)
    relative_components = relative.split("/")
    if (
        not relative.startswith(tuple(f"{root}/" for root in PUBLICATION_ALLOWED_ROOTS))
        or not relative.endswith(PUBLICATION_ALLOWED_SUFFIXES)
        or path.name in MIRROR_EXCLUDED_NAMES
        or any(component.lower() in PUBLICATION_FORBIDDEN_COMPONENTS for component in relative_components)
        or bool(_PUBLICATION_FORBIDDEN_NAME_RE.search(path.stem))
    ):
        raise _publication_error("PATH")
    return {
        "path": relative,
        "mode": format(mode, "04o"),
        "size": copied_size,
        "sha256": digest.hexdigest(),
    }


def _publication_inventory(project_root: Path) -> List[dict]:
    entries: List[dict] = []
    for relative_root in PUBLICATION_ALLOWED_ROOTS:
        data_root = project_root / relative_root
        root_stat = os.lstat(data_root)
        if stat.S_ISLNK(root_stat.st_mode) or not stat.S_ISDIR(root_stat.st_mode):
            raise _publication_error("ROOT")
        for directory, directories, filenames in os.walk(data_root, followlinks=False):
            directory_path = Path(directory)
            directories.sort()
            filenames.sort()
            directories[:] = [
                d for d in directories
                if d.lower() not in PUBLICATION_FORBIDDEN_COMPONENTS
                and not stat.S_ISLNK(os.lstat(directory_path / d).st_mode)
            ]
            for filename in filenames:
                candidate = directory_path / filename
                if not filename.endswith(PUBLICATION_ALLOWED_SUFFIXES) or filename in MIRROR_EXCLUDED_NAMES:
                    continue
                # Skip files whose stem matches forbidden name patterns
                if bool(_PUBLICATION_FORBIDDEN_NAME_RE.search(Path(filename).stem)):
                    continue
                entries.append(_publication_file_entry(candidate, project_root))
                if len(entries) > PUBLICATION_MAX_FILES:
                    raise _publication_error("FILE_COUNT")
    entries.sort(key=lambda entry: entry["path"])
    if len({entry["path"] for entry in entries}) != len(entries):
        raise _publication_error("DUPLICATE_PATH")
    if sum(entry["size"] for entry in entries) > PUBLICATION_MAX_BYTES:
        raise _publication_error("TOTAL_SIZE")
    return entries


def _publication_hash_file(path: Path) -> Tuple[int, str]:
    file_stat = os.lstat(path)
    if stat.S_ISLNK(file_stat.st_mode) or not stat.S_ISREG(file_stat.st_mode):
        raise _publication_error("BUNDLE_TYPE")
    digest = hashlib.sha256()
    copied_size = 0
    with path.open("rb") as source:
        while True:
            chunk = source.read(MIRROR_COPY_CHUNK_BYTES)
            if not chunk:
                break
            copied_size += len(chunk)
            digest.update(chunk)
    if copied_size != file_stat.st_size:
        raise _publication_error("BUNDLE_RACE")
    return copied_size, digest.hexdigest()


def _publication_write_bundle(bundle_path: Path, project_root: Path, entries: Sequence[dict]) -> Tuple[int, str]:
    temporary_path = bundle_path.with_name(f".{bundle_path.name}.{secrets.token_hex(16)}.tmp")
    try:
        with tarfile.open(temporary_path, mode="w", format=tarfile.GNU_FORMAT) as archive:
            for entry in entries:
                source_path = project_root / entry["path"]
                source_stat = os.lstat(source_path)
                if stat.S_ISLNK(source_stat.st_mode) or not stat.S_ISREG(source_stat.st_mode):
                    raise _publication_error("FILE_TYPE")
                if stat.S_IMODE(source_stat.st_mode) != int(entry["mode"], 8):
                    raise _publication_error("FILE_RACE")
                descriptor = os.open(str(source_path), _readonly_open_flags())
                try:
                    opened_stat = os.fstat(descriptor)
                    if (
                        not _same_filesystem_object(source_stat, opened_stat)
                        or _mtime_ns(source_stat) != _mtime_ns(opened_stat)
                        or opened_stat.st_size != entry["size"]
                    ):
                        raise _publication_error("FILE_RACE")
                    tar_info = tarfile.TarInfo(name=entry["path"])
                    tar_info.size = entry["size"]
                    tar_info.mode = int(entry["mode"], 8)
                    tar_info.mtime = 0
                    tar_info.uid = 0
                    tar_info.gid = 0
                    tar_info.uname = ""
                    tar_info.gname = ""
                    with os.fdopen(descriptor, "rb", closefd=False) as source:
                        archive.addfile(tar_info, source)
                    after_stat = os.fstat(descriptor)
                finally:
                    os.close(descriptor)
                current_stat = os.lstat(source_path)
                if (
                    not _same_filesystem_object(source_stat, after_stat)
                    or _mtime_ns(source_stat) != _mtime_ns(after_stat)
                    or not _same_filesystem_object(source_stat, current_stat)
                    or _mtime_ns(source_stat) != _mtime_ns(current_stat)
                ):
                    raise _publication_error("FILE_RACE")
        os.replace(str(temporary_path), str(bundle_path))
    except Exception:
        temporary_path.unlink(missing_ok=True)
        raise
    size, digest = _publication_hash_file(bundle_path)
    return size, digest


def build_daily_publication_bundle(args: argparse.Namespace) -> dict:
    project_root = Path(args.project_root).resolve(strict=True)
    if project_root.is_symlink() or not project_root.is_dir():
        raise _publication_error("PROJECT_ROOT")
    execution_sha = _publication_sha1(args.execution_sha)
    base_sha = _publication_sha1(args.base_sha)
    base_tree = _publication_sha1(args.base_tree)
    if args.target_branch != "data":
        raise _publication_error("TARGET_BRANCH")
    if not isinstance(args.repository, str) or not args.repository or "/" not in args.repository:
        raise _publication_error("REPOSITORY")
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_stat = os.lstat(output_dir)
    if stat.S_ISLNK(output_stat.st_mode) or not stat.S_ISDIR(output_stat.st_mode):
        raise _publication_error("OUTPUT_DIR")
    entries = _publication_inventory(project_root)
    bundle_path = output_dir / PUBLICATION_BUNDLE_NAME
    if bundle_path.exists() or bundle_path.is_symlink():
        bundle_path.unlink()
    bundle_size, bundle_digest = _publication_write_bundle(bundle_path, project_root, entries)
    manifest = {
        "schemaVersion": PUBLICATION_SCHEMA_VERSION,
        "kind": "daily-data-publication",
        "repository": args.repository,
        "executionSha": execution_sha,
        "base": {"sha": base_sha, "tree": base_tree},
        "targetBranch": args.target_branch,
        "bundle": {
            "path": PUBLICATION_BUNDLE_NAME,
            "size": bundle_size,
            "sha256": bundle_digest,
        },
        "files": entries,
    }
    write_json(output_dir / PUBLICATION_MANIFEST_NAME, manifest)
    return manifest

def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(path.name + ".tmp")
    tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.replace(str(tmp_path), str(path))


def _add_manifest_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--output", required=True)
    parser.add_argument("--date", required=True)
    parser.add_argument("--final-status", required=True, choices=("OK", "WARN", "ERROR"))
    parser.add_argument("--final-exit-code", required=True, type=int)
    parser.add_argument("--latest-log-path", default="")
    parser.add_argument("--summary-path", default="")
    parser.add_argument("--no-work-short-circuit", default="false")
    parser.add_argument("--policy-mode", default="end_to_end")
    parser.add_argument("--generated-at", default="")
    parser.add_argument("--github-run-id", default=os.environ.get("GITHUB_RUN_ID", ""))
    parser.add_argument("--github-run-attempt", default=os.environ.get("GITHUB_RUN_ATTEMPT", ""))
    parser.add_argument("--github-run-url", default="")
    parser.add_argument("--github-workflow", default=os.environ.get("GITHUB_WORKFLOW", ""))
    parser.add_argument("--github-sha", default=os.environ.get("GITHUB_SHA", ""))
    parser.add_argument("--github-ref", default=os.environ.get("GITHUB_REF", ""))
    parser.add_argument("--github-event-name", default=os.environ.get("GITHUB_EVENT_NAME", ""))
    parser.add_argument("--execution-branch", default=os.environ.get("RUN_DAILY_EXECUTION_BRANCH", ""))
    parser.add_argument("--target-branch", default=os.environ.get("RUN_DAILY_TARGET_BRANCH", ""))
    parser.add_argument("--failed-required-step", action="append", default=[])
    parser.add_argument("--optional-skip", action="append", default=[])
    parser.add_argument("--downstream-skip", action="append", default=[])
    parser.add_argument("--step-event", action="append", default=[])


def _add_gdrive_expected_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--frames-dir", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--files-from-output", required=True)
    parser.add_argument("--residual-queue", default="")
    parser.add_argument("--run-id", default="")
    parser.add_argument("--source-root", default="")
    parser.add_argument("--remote-root", default="")
    parser.add_argument("--recent-minutes", type=int, default=120)
    parser.add_argument("--retention-days", type=int, default=7)
    parser.add_argument("--max-items", type=int, default=0)
    parser.add_argument("--generated-at", default="")


def _add_gdrive_batches_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--expected-manifest", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--run-id", default="")
    parser.add_argument("--source-root", default="")
    parser.add_argument("--remote-root", default="")
    parser.add_argument("--max-files", type=int, default=400)
    parser.add_argument("--max-bytes", type=int, default=384 * 1024 * 1024)
    parser.add_argument("--generated-at", default="")


def _add_gdrive_staging_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--expected-manifest", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--verified-files-from", default="")
    parser.add_argument("--verification-receipt", default="")
    parser.add_argument("--run-id", default="")
    parser.add_argument("--source-root", default="")
    parser.add_argument("--remote-staging-root", default="")
    parser.add_argument("--max-files", type=int, default=1000)
    parser.add_argument("--max-bytes", type=int, default=512 * 1024 * 1024)
    parser.add_argument("--generated-at", default="")


def _add_gdrive_status_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--expected-manifest", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--summary-manifest", default="")
    parser.add_argument("--residual-queue", default="")
    parser.add_argument("--verified-files-from", default="")
    parser.add_argument("--verification-receipt", default="")
    parser.add_argument("--staging-manifest", default="")
    parser.add_argument("--run-id", default="")
    parser.add_argument("--policy", choices=("required", "warn", "backfill_required"), default="warn")
    parser.add_argument("--upload-mode", choices=("direct_batch", "backfill", "skip"), default="direct_batch")
    parser.add_argument("--completion-proof", choices=("none", "rclone_exit_zero", "remote_size_check", "remote_manifest_check"), default="none")
    parser.add_argument("--source-root", default="")
    parser.add_argument("--remote-root", default="")
    parser.add_argument("--started-at", default="")
    parser.add_argument("--completed-at", default="")
    parser.add_argument("--exit-code", required=True, type=int)
    parser.add_argument("--timeout", default="false")
    parser.add_argument("--skipped", default="false")
    parser.add_argument("--retention-days", type=int, default=7)
    parser.add_argument("--backfill-threshold-attempts", type=int, default=3)
    parser.add_argument("--note", action="append", default=[])

def _add_gdrive_remote_verification_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--expected-manifest", required=True)
    parser.add_argument("--remote-list", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--verified-files-output", default="")
    parser.add_argument("--run-id", default="")
    parser.add_argument("--generated-at", default="")


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="run_daily.sh helper commands")
    subparsers = parser.add_subparsers(dest="command", required=True)
    mirror_parser = subparsers.add_parser("mirror-data-root")
    mirror_parser.add_argument("--source-root", required=True)
    mirror_parser.add_argument("--target-root", required=True)

    prepare_log_parser = subparsers.add_parser("prepare-daily-log")
    prepare_log_parser.add_argument("--log-root", required=True)
    prepare_log_parser.add_argument("--archive-relative", required=True)
    prepare_log_parser.add_argument("--current-log-relative", required=True)
    prepare_log_parser.add_argument("--date", required=True)

    append_log_parser = subparsers.add_parser("append-daily-log")
    append_log_parser.add_argument("--log-root", required=True)
    append_log_parser.add_argument("--log-name", required=True)
    append_log_parser.add_argument("--root-device", required=True, type=int)
    append_log_parser.add_argument("--root-inode", required=True, type=int)
    append_log_parser.add_argument("--no-stdout", action="store_true")

    count_parser = subparsers.add_parser("count-pending-jsonl")
    count_parser.add_argument("--source-dir", required=True)
    count_parser.add_argument("--target-dir", required=True)

    count_frames_parser = subparsers.add_parser("count-frame-files")
    count_frames_parser.add_argument("--frames-dir", required=True)

    policy_parser = subparsers.add_parser("resolve-policy-action")
    policy_parser.add_argument("--step-name", required=True)
    policy_parser.add_argument("--issue-kind", required=True)
    policy_parser.add_argument("--policy-mode", default="end_to_end")
    policy_parser.add_argument("--pending-step08-work", type=int, default=0)

    timeout_parser = subparsers.add_parser("render-timeout-guard-message")
    timeout_parser.add_argument("--elapsed-minutes", required=True, type=int)
    timeout_parser.add_argument("--max-minutes", required=True, type=int)

    unknown_policy_parser = subparsers.add_parser("render-policy-unknown-warning")
    unknown_policy_parser.add_argument("--step-name", required=True)
    unknown_policy_parser.add_argument("--issue-kind", required=True)

    policy_note_parser = subparsers.add_parser("render-policy-summary-note")
    policy_note_parser.add_argument("--step-name", required=True)
    policy_note_parser.add_argument("--issue-kind", required=True)

    step08_message_parser = subparsers.add_parser("render-step08-message")
    step08_message_parser.add_argument("--message-kind", required=True)
    step08_message_parser.add_argument("--detail", default="")

    subparsers.add_parser("print-summary-flow-guide")

    manifest_parser = subparsers.add_parser("write-summary-manifest")
    _add_manifest_args(manifest_parser)
    publication_bundle_parser = subparsers.add_parser("write-daily-publication-bundle")
    publication_bundle_parser.add_argument("--project-root", required=True)
    publication_bundle_parser.add_argument("--output-dir", required=True)
    publication_bundle_parser.add_argument("--repository", required=True)
    publication_bundle_parser.add_argument("--execution-sha", required=True)
    publication_bundle_parser.add_argument("--base-sha", required=True)
    publication_bundle_parser.add_argument("--base-tree", required=True)
    publication_bundle_parser.add_argument("--target-branch", required=True)

    gdrive_expected_parser = subparsers.add_parser("write-gdrive-upload-expected")
    _add_gdrive_expected_args(gdrive_expected_parser)

    gdrive_batches_parser = subparsers.add_parser("write-gdrive-upload-batches")
    _add_gdrive_batches_args(gdrive_batches_parser)

    validate_summary_parser = subparsers.add_parser("validate-summary-manifest")
    validate_summary_parser.add_argument("--input", required=True)

    gdrive_staging_parser = subparsers.add_parser("write-gdrive-staging-shards")
    _add_gdrive_staging_args(gdrive_staging_parser)
    verify_gdrive_staging_parser = subparsers.add_parser("verify-gdrive-staging-shards")
    verify_gdrive_staging_parser.add_argument("--staging-manifest", required=True)
    verify_gdrive_staging_parser.add_argument("--expected-manifest", required=True)
    verify_gdrive_staging_parser.add_argument("--run-id", default="")
    extract_gdrive_backfill_parser = subparsers.add_parser("extract-gdrive-backfill-shard")
    extract_gdrive_backfill_parser.add_argument("--archive", required=True)
    extract_gdrive_backfill_parser.add_argument("--shard-contract", required=True)
    extract_gdrive_backfill_parser.add_argument("--expected-manifest", required=True)
    extract_gdrive_backfill_parser.add_argument("--files-from", required=True)
    extract_gdrive_backfill_parser.add_argument("--output-dir", required=True)
    extract_gdrive_backfill_parser.add_argument("--output-receipt", default="")



    gdrive_status_parser = subparsers.add_parser("write-gdrive-upload-status")
    _add_gdrive_status_args(gdrive_status_parser)

    gdrive_remote_verification_parser = subparsers.add_parser("write-gdrive-remote-verification")
    _add_gdrive_remote_verification_args(gdrive_remote_verification_parser)

    args = parser.parse_args(argv)
    if args.command == "mirror-data-root":
        try:
            mirror_data_root(args.source_root, args.target_root)
        except _MirrorError as exc:
            messages = {
                "target_root": "데이터 미러링 대상 디렉터리 생성 실패",
                "source_list": "데이터 미러링 소스 목록 생성 실패",
                "target_list": "데이터 미러링 대상 목록 생성 실패",
                "target_directory": "데이터 미러링 하위 디렉터리 생성 실패",
                "copy": "데이터 미러링 파일 복사 실패",
                "stale_remove": "데이터 미러링 stale 파일 제거 실패",
            }
            print(f"[ERROR] {messages[exc.operation]}: {exc.detail}", file=sys.stderr)
            return 1
        return 0

    if args.command == "prepare-daily-log":
        try:
            archived_relative, root_device, root_inode = prepare_daily_log(
                args.log_root,
                args.archive_relative,
                args.current_log_relative,
                args.date,
            )
            print(f"{archived_relative}|{root_device}|{root_inode}")
        except (OSError, ValueError) as exc:
            print(f"[ERROR] 안전한 일일 로그 생성 실패: {exc}", file=sys.stderr)
            return 1
        return 0

    if args.command == "append-daily-log":
        try:
            append_daily_log(
                args.log_root,
                args.log_name,
                args.root_device,
                args.root_inode,
                not args.no_stdout,
            )
        except (OSError, ValueError) as exc:
            print(f"[ERROR] 안전한 일일 로그 추가 실패: {exc}", file=sys.stderr)
            return 1
        return 0

    if args.command == "count-pending-jsonl":
        print(count_pending_jsonl(Path(args.source_dir), Path(args.target_dir)))
        return 0

    if args.command == "count-frame-files":
        print(count_frame_files(Path(args.frames_dir)))
        return 0

    if args.command == "resolve-policy-action":
        print(
            resolve_policy_action(
                args.step_name,
                args.issue_kind,
                args.policy_mode,
                args.pending_step08_work,
            )
        )
        return 0

    if args.command == "render-timeout-guard-message":
        print(render_timeout_guard_message(args.elapsed_minutes, args.max_minutes))
        return 0

    if args.command == "render-policy-unknown-warning":
        print(render_unknown_policy_warning(args.step_name, args.issue_kind))
        return 0

    if args.command == "render-policy-summary-note":
        print(render_policy_summary_note(args.step_name, args.issue_kind))
        return 0

    if args.command == "render-step08-message":
        print(render_step08_message(args.message_kind, args.detail))
        return 0

    if args.command == "print-summary-flow-guide":
        print(render_summary_flow_guide(), end="")
        return 0

    if args.command == "write-summary-manifest":
        payload = build_summary_manifest(args)
        write_json(Path(args.output), payload)
        return 0
    if args.command == "write-daily-publication-bundle":
        payload = build_daily_publication_bundle(args)
        print(json.dumps(payload["bundle"], sort_keys=True))
        return 0

    if args.command == "validate-summary-manifest":
        payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
        validate_summary_manifest_payload(payload)
        print("ok")
        return 0

    if args.command == "write-gdrive-upload-expected":
        payload = build_gdrive_upload_expected(args)
        _write_files_from(
            Path(args.files_from_output),
            payload["items"],
            _resolve_owner_root(Path(payload["sourceRoot"])),
        )
        write_json(Path(args.output), payload)
        return 0

    if args.command == "write-gdrive-upload-batches":
        payload = build_gdrive_upload_batches(args)
        write_json(Path(args.output), payload)
        return 0

    if args.command == "write-gdrive-staging-shards":
        payload = create_gdrive_staging_shards(args)
        write_json(Path(args.output), payload)
        verify_gdrive_staging_shards(
            argparse.Namespace(
                staging_manifest=args.output,
                expected_manifest=args.expected_manifest,
                run_id=args.run_id,
            )
        )
        return 0
    if args.command == "verify-gdrive-staging-shards":
        verify_gdrive_staging_shards(args)
        print("ok")
        return 0
    if args.command == "extract-gdrive-backfill-shard":
        payload = extract_gdrive_backfill_shard(args)
        output_receipt = _optional_path(args.output_receipt)
        if output_receipt:
            write_json(Path(output_receipt), payload)
        print(json.dumps(payload, ensure_ascii=False, sort_keys=True))
        return 0

    if args.command == "write-gdrive-remote-verification":
        payload = build_gdrive_remote_verification(args)
        write_json(Path(args.output), payload)
        return 0

    if args.command == "write-gdrive-upload-status":
        payload = build_gdrive_upload_status(args)
        write_json(Path(args.output), payload)
        summary_manifest = _optional_path(args.summary_manifest)
        if summary_manifest:
            summary_path = Path(summary_manifest)
            summary_payload = {}
            if summary_path.is_file():
                summary_payload = json.loads(summary_path.read_text(encoding="utf-8"))
                if not isinstance(summary_payload, dict):
                    raise ValueError("summary manifest must be a JSON object")
            summary_payload["gdriveUpload"] = payload
            write_json(summary_path, summary_payload)
        return 0

    parser.error("unknown command")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
