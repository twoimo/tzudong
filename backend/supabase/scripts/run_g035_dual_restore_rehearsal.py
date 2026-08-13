#!/usr/bin/env python3
"""Produce and verify fail-closed evidence for two isolated G035 restores.

This controller is deliberately local-only.  It launches the tracked G035
``restore-verify`` entrypoint through the G040 isolated bootstrap, restores the
same encrypted production capture into two distinct pinned Postgres 17
containers, compares the independently observed catalogs, proves cleanup, and
retains both canonical G035 receipts beside a canonical aggregate receipt.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import secrets
import signal
import socket
import stat
import subprocess
import sys
import tarfile
import threading
import time
from pathlib import Path, PurePosixPath
from typing import Any, Sequence


RECEIPT_SCHEMA = "local-dual-restore-rehearsal-v2"
RECEIPT_STATUS = "restored_compared_and_cleaned"
G035_RECEIPT_SCHEMA = "g035-local-recovery-receipt-v4"
G035_MANIFEST_SHA256 = "bba79f264f26158d2fd93f62a0632f44ff8a0575619b50928e23ecefccf8ab95"
IMAGE_REFERENCE = "supabase/postgres@sha256:ac581882596ed0e46937ea6dd53a627d09f53e005d7264c2082a7ff7b62eaaca"
IMAGE_ID = "sha256:ac581882596ed0e46937ea6dd53a627d09f53e005d7264c2082a7ff7b62eaaca"
EXPECTED_LEDGER_COUNT = 50
EXPECTED_LEDGER_TERMINAL = ("20260804000500", "g041_auth_workflow_bridge")
EXPECTED_LEDGER_PAIR_SHA256 = "14af921f7aa9e7714ba5e4b88ecdde4fc78f6f7ca40051fe1bc7e860d85a8db1"
EXPECTED_MANAGED_SCHEMAS = ("auth", "storage")
APPLICATION_SCHEMAS = (
    "public",
    "shortener_private",
    "account_deletion_private",
    "privacy_retention",
    "ocr_private",
    "provider_budget_private",
)
RECOVERY_CONTROL_SCHEMAS = ("supabase_migrations",)
RECOVERY_EXTENSIONS = (
    ("pg_trgm", "extensions"),
    ("uuid-ossp", "extensions"),
    ("btree_gin", "extensions"),
    ("vector", "public"),
    ("pgcrypto", "extensions"),
)
MANAGED_TABLE_DATA_EXCLUSIONS = (
    "--exclude-table-data=auth.*",
    "--exclude-table-data=storage.*",
)
APPROVED_AGE_RECIPIENT_SHA256 = "c529b89f584d1d02f2543887e31cf85515b74cbd5a93cffd58efd93e6245ed7f"
RESTORE_COMPATIBILITY_HOOK_SHA256 = "abea81a57b6edb8602563c4c143655aab10cb09bd349de581c7cc2846fa36376"
AUTH_PLACEHOLDER_MAPPING_COUNT = 20
AUTH_PLACEHOLDER_MAPPING_SHA256 = "b8c180d2ddae2aa409e76889015220cbe18504af42fcd2abeb3f28bcf6ffd266"
SCRIPT_PATH = "backend/supabase/scripts/run_g035_dual_restore_rehearsal.py"
BOOTSTRAP_PATH = "backend/supabase/scripts/g040_isolated_bootstrap.py"
G035_ENTRYPOINT = "backend/supabase/scripts/g035_hosted_recovery.py"
FINAL_RECEIPT_NAME = "local-dual-restore.json"
MAX_JSON_BYTES = 2 * 1024 * 1024
MAX_IDENTITY_BYTES = 4096
MAX_ARCHIVE_BYTES = 2**34
RESTORE_TIMEOUT_SECONDS = 1800
CONTAINER_READY_SECONDS = 300
DATABASE_READY_SECONDS = 60
DOCKER_PROBE_TIMEOUT_SECONDS = 30
MAX_EVIDENCE_AGE_SECONDS = 3600
MAX_ACTIVE_REHEARSAL_SECONDS = 4_800
MAX_CLEANUP_SECONDS = 300
MAX_WHOLE_REHEARSAL_SECONDS = MAX_ACTIVE_REHEARSAL_SECONDS + MAX_CLEANUP_SECONDS
PINNED_POSTGRES_UID = "100"
PINNED_POSTGRES_GID = "101"
POSTGRES_ADMIN_ROLE = "supabase_admin"
POSTGRES_CUSTOM_TREE_ROOT = "c564451c6c9bd5b645dcf2dc6ea5e8dc6912bf5ed4e6f51307662bfb129ac9b9"
POSTGRES_CUSTOM_TREE_MEMBERS = 30
POSTGRES_CUSTOM_TREE_BYTES = 17_752
MAX_POSTGRES_CUSTOM_ARCHIVE_BYTES = 1024 * 1024
HARDENED_HBA_PATH = "/etc/postgresql-custom/tzudong-pg_hba.conf"
HARDENED_HBA = (
    b"local all all trust\n"
    b"host all all 0.0.0.0/0 scram-sha-256\n"
    b"host all all ::0/0 scram-sha-256\n"
)
HARDENED_HBA_SHA256 = "7df1787bf22827ce3ea84ff4248dc38c26690af757bdf77e184eeaecf1d70a32"
POSTGRES_CONFIG_FILES = (
    ("/etc/postgresql/postgresql.conf", 28_278, "09dad2996693b60c88b8afa3af4a2d88ab3876bfa8f88ba2d27b2c5e36316d7a"),
    ("/etc/postgresql-custom/wal-g.conf", 463, "b991d795d99f63c958c5ecabbbf70dcaac66a0ce34a07ef341dd4ba02590dc92"),
    ("/etc/postgresql-custom/read-replica.conf", 218, "fc6032dc3b63baabde3ceaa31a3288d0b5e8dadfc09b9e623eb2daa57d395120"),
    ("/etc/postgresql-custom/supautils.conf", 4_947, "41f43f218711d1ba9bc081033e258c95909ad72e8bb7899daeabfeabe383b9c8"),
    (HARDENED_HBA_PATH, len(HARDENED_HBA), HARDENED_HBA_SHA256),
)
POSTGRES_CRITICAL_SOURCES = (
    ("/etc/postgresql/postgresql.conf", 42, "data_directory"),
    ("/etc/postgresql/postgresql.conf", 44, "hba_file"),
    ("/etc/postgresql/postgresql.conf", 67, "unix_socket_directories"),
    ("/etc/postgresql/postgresql.conf", 688, "session_preload_libraries"),
    ("/etc/postgresql-custom/wal-g.conf", 9, "hot_standby"),
    ("/etc/postgresql-custom/supautils.conf", 1, "supautils.extensions_parameter_overrides"),
    ("/etc/postgresql-custom/supautils.conf", 2, "supautils.policy_grants"),
    ("/etc/postgresql-custom/supautils.conf", 3, "supautils.drop_trigger_grants"),
    ("/etc/postgresql-custom/supautils.conf", 10, "supautils.privileged_extensions"),
    ("/etc/postgresql-custom/supautils.conf", 11, "supautils.extension_custom_scripts_path"),
    ("/etc/postgresql-custom/supautils.conf", 12, "supautils.privileged_extensions_superuser"),
    ("/etc/postgresql-custom/supautils.conf", 13, "supautils.privileged_role"),
    ("/etc/postgresql-custom/supautils.conf", 14, "supautils.privileged_role_allowed_configs"),
    ("/etc/postgresql-custom/supautils.conf", 15, "supautils.reserved_memberships"),
    ("/etc/postgresql-custom/supautils.conf", 16, "supautils.reserved_roles"),
    ("/etc/postgresql-custom/supautils.conf", 17, "supautils.hint_roles"),
)
POSTGRES_CRITICAL_SOURCE_SHA256 = "dfc43b0b6ccfd85a615a97ddc2fb15a6b07c1f3f7bc428d94a8e1c44c46d9695"
POSTGRES_CONFIG_FILE_SET_SHA256 = "622b07085399cb9e8037ed2d5cc98fa1364be42d034dc09473bdcae0c57ee843"
EXPECTED_TOOLCHAIN = {
    "python": {
        "path": "/opt/homebrew/Cellar/python@3.14/3.14.6/Frameworks/Python.framework/Versions/3.14/bin/python3.14",
        "bytes": 34_640,
        "uid": 501,
        "nlink": 1,
        "mode": 0o755,
        "sha256": "4f00ea2ad53d62437a6a3946b73c73614a97e8accdc5b96dc095ea1a0d9c6a56",
        "version": "Python 3.14.6",
    },
    "docker": {
        "path": "/opt/homebrew/Cellar/docker/29.7.2/bin/docker",
        "bytes": 27_924_322,
        "uid": 501,
        "nlink": 1,
        "mode": 0o555,
        "sha256": "adb33a6b552536d8219b2d8c32f3c44def98058e76e97c8031498471c8dfdac8",
        "version": "Docker version 29.7.2, build a7dcaa6fdb",
    },
    "age": {
        "path": "/opt/homebrew/Cellar/age/1.3.1/bin/age",
        "bytes": 4_237_186,
        "uid": 501,
        "nlink": 1,
        "mode": 0o555,
        "sha256": "f52e5ee772e1c0e3c6be5bf837b469a40346df3515db9a1b41230376fdff6a76",
        "version": "v1.3.1",
    },
    "pgRestore": {
        "path": "/opt/homebrew/Cellar/postgresql@17/17.10/bin/pg_restore",
        "bytes": 255_520,
        "uid": 501,
        "nlink": 1,
        "mode": 0o555,
        "sha256": "6dc5fa5b2d2dfff6ae9919162f50cede4408475f1caf05e3da8e960354f60115",
        "version": "pg_restore (PostgreSQL) 17.10 (Homebrew)",
    },
}
POSTGRES_START_COMMAND = (
    "while [ ! -f /etc/postgresql-custom/.tzudong-ready ]; do /bin/sleep 0.1; done; "
    "exec /usr/local/bin/docker-entrypoint.sh postgres -D /etc/postgresql "
    f"-c hba_file={HARDENED_HBA_PATH} -c password_encryption=scram-sha-256"
)
HEX = re.compile(r"^[a-f0-9]{64}$")
COMMIT = re.compile(r"^[a-f0-9]{40}$")
NONCE = re.compile(r"^[a-f0-9]{32}$")
SERVER_VERSION = re.compile(r"^17[0-9]{4}$")
SNAPSHOT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_PINNED_DOCKER_ENDPOINT: str | None = None
_PINNED_DOCKER_SOCKET_IDENTITY: tuple[int, int, int] | None = None
_PINNED_DOCKER_BINDING: dict[str, object] | None = None
_ACTIVE_RESTORE_PROCESS: subprocess.Popen[bytes] | None = None
_CANCELLATION_REQUESTED = False
_WHOLE_DEADLINE: float | None = None
_CLEANUP_DEADLINE: float | None = None
_IN_CLEANUP = False
_ACTIVE_IDENTITY: bytearray | None = None


class RehearsalError(RuntimeError):
    """A bounded, non-sensitive dual-restore failure."""


def _request_cancellation(unused_signum: int, unused_frame: object) -> None:
    global _CANCELLATION_REQUESTED
    _CANCELLATION_REQUESTED = True
    process = _ACTIVE_RESTORE_PROCESS
    if process is not None and process.poll() is None:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except OSError:
            pass


def _require_not_cancelled() -> None:
    if _WHOLE_DEADLINE is not None and time.monotonic() >= _WHOLE_DEADLINE:
        _request_cancellation(signal.SIGTERM, None)
    if _CANCELLATION_REQUESTED:
        raise RehearsalError("rehearsal_cancelled")


def _remaining_timeout(cap: float, *, cleanup: bool = False) -> float:
    if cap <= 0:
        raise RehearsalError("invalid_timeout")
    selected_deadline = _CLEANUP_DEADLINE if cleanup else _WHOLE_DEADLINE
    if selected_deadline is None:
        return cap
    remaining = selected_deadline - time.monotonic()
    if remaining <= 0:
        if not cleanup:
            _request_cancellation(signal.SIGTERM, None)
        raise RehearsalError(
            "cleanup_deadline_exceeded" if cleanup else "rehearsal_deadline_exceeded"
        )
    return min(cap, remaining)


class _CloneRelay:
    """Bounded loopback-only blocking relay into an internal-network clone."""

    def __init__(self, docker: str, container_id: str) -> None:
        self.docker = docker
        self.container_id = container_id
        self.stop = threading.Event()
        self.lock = threading.Lock()
        self.connections: set[socket.socket] = set()
        self.processes: set[subprocess.Popen[bytes]] = set()
        self.copy_threads: set[threading.Thread] = set()
        self.workers: list[threading.Thread] = []
        self.closed = False
        self.listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen(4)
        self.listener.settimeout(0.25)
        endpoint = self.listener.getsockname()
        if endpoint[0] != "127.0.0.1" or not 1 <= endpoint[1] <= 65535:
            self.listener.close()
            raise RehearsalError("clone_relay_invalid")
        self.port = endpoint[1]
        self.acceptor = threading.Thread(target=self._accept, name="g035-relay", daemon=True)
        self.acceptor.start()

    def _accept(self) -> None:
        while not self.stop.is_set():
            try:
                connection, address = self.listener.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            if address[0] != "127.0.0.1":
                connection.close()
                continue
            with self.lock:
                active = sum(worker.is_alive() for worker in self.workers)
                if active >= 4:
                    connection.close()
                    continue
                self.connections.add(connection)
                worker = threading.Thread(
                    target=self._serve,
                    args=(connection,),
                    name="g035-relay-worker",
                    daemon=True,
                )
                self.workers.append(worker)
            worker.start()

    def _copy_to_process(
        self,
        connection: socket.socket,
        process: subprocess.Popen[bytes],
        deadline: float,
    ) -> None:
        if process.stdin is None:
            return
        try:
            connection.settimeout(1)
            while not self.stop.is_set() and time.monotonic() < deadline:
                try:
                    chunk = connection.recv(65_536)
                except socket.timeout:
                    continue
                if not chunk:
                    break
                process.stdin.write(chunk)
                process.stdin.flush()
        except (OSError, BrokenPipeError):
            pass
        finally:
            try:
                process.stdin.close()
            except OSError:
                pass

    def _copy_from_process(
        self,
        connection: socket.socket,
        process: subprocess.Popen[bytes],
        deadline: float,
    ) -> None:
        if process.stdout is None:
            return
        try:
            connection.settimeout(30)
            while not self.stop.is_set() and time.monotonic() < deadline:
                chunk = os.read(process.stdout.fileno(), 65_536)
                if not chunk:
                    break
                connection.sendall(chunk)
        except (OSError, BrokenPipeError, socket.timeout):
            pass
        finally:
            try:
                connection.shutdown(socket.SHUT_WR)
            except OSError:
                pass

    def _serve(self, connection: socket.socket) -> None:
        process: subprocess.Popen[bytes] | None = None
        deadline = time.monotonic() + RESTORE_TIMEOUT_SECONDS + 60
        copies: tuple[threading.Thread, threading.Thread] = ()
        try:
            process = subprocess.Popen(
                [self.docker, "exec", "--interactive", self.container_id, "/usr/bin/nc", "127.0.0.1", "5432"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
                close_fds=True,
                env=_docker_environment(),
            )
            with self.lock:
                self.processes.add(process)
            copies = (
                threading.Thread(
                    target=self._copy_to_process,
                    args=(connection, process, deadline),
                    name="g035-relay-copy-in",
                    daemon=True,
                ),
                threading.Thread(
                    target=self._copy_from_process,
                    args=(connection, process, deadline),
                    name="g035-relay-copy-out",
                    daemon=True,
                ),
            )
            with self.lock:
                self.copy_threads.update(copies)
            for copy in copies:
                copy.start()
            while (
                process.poll() is None
                and not self.stop.is_set()
                and time.monotonic() < deadline
            ):
                self.stop.wait(0.25)
            if not self.stop.is_set() and process.poll() is not None:
                for copy in copies:
                    copy.join(timeout=max(0.1, min(30, deadline - time.monotonic())))
        except OSError:
            pass
        finally:
            force = self.stop.is_set() or time.monotonic() >= deadline
            if force:
                try:
                    connection.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
            process_reaped = process is None or process.poll() is not None
            if process is not None and not process_reaped and force:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=_remaining_timeout(5, cleanup=_IN_CLEANUP))
                    process_reaped = process.poll() is not None
                except (OSError, subprocess.SubprocessError):
                    process_reaped = False
            for copy in copies:
                copy.join(timeout=10)
            copies_reaped = all(not copy.is_alive() for copy in copies)
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            connection.close()
            if process is not None:
                for stream in (process.stdin, process.stdout):
                    if stream is not None:
                        try:
                            stream.close()
                        except OSError:
                            pass
                with self.lock:
                    if process_reaped:
                        self.processes.discard(process)
            with self.lock:
                if copies_reaped:
                    self.copy_threads.difference_update(copies)
            with self.lock:
                self.connections.discard(connection)

    def close(self) -> bool:
        self.stop.set()
        try:
            self.listener.close()
        except OSError:
            pass
        with self.lock:
            connections = tuple(self.connections)
            processes = tuple(self.processes)
            copies = tuple(self.copy_threads)
        for connection in connections:
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            connection.close()
        for process in processes:
            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=_remaining_timeout(5, cleanup=True))
                except (OSError, subprocess.SubprocessError, RehearsalError):
                    pass
        self.acceptor.join(timeout=5)
        for worker in tuple(self.workers):
            worker.join(timeout=10)
        for copy in copies:
            copy.join(timeout=10)
        with self.lock:
            self.processes = {
                process for process in self.processes if process.poll() is None
            }
            self.copy_threads = {
                copy for copy in self.copy_threads if copy.is_alive()
            }
            absent = not self.connections and not self.processes and not self.copy_threads
        self.closed = (
            self.listener.fileno() == -1
            and not self.acceptor.is_alive()
            and all(not worker.is_alive() for worker in self.workers)
            and absent
        )
        return self.closed


def _canonical_bytes(value: object) -> bytes:
    try:
        return json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
            allow_nan=False,
        ).encode("ascii")
    except (TypeError, ValueError) as error:
        raise RehearsalError("canonicalization_failed") from error


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _digest(value: object) -> str:
    return _sha256_bytes(_canonical_bytes(value))


def _json_pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise RehearsalError("json_duplicate_key")
        result[key] = value
    return result


def _reject_constant(_: str) -> None:
    raise RehearsalError("json_constant_invalid")


def _same_identity(info: os.stat_result, other: os.stat_result) -> bool:
    return (
        info.st_dev,
        info.st_ino,
        info.st_size,
        info.st_uid,
        info.st_gid,
        info.st_mode,
        info.st_nlink,
    ) == (
        other.st_dev,
        other.st_ino,
        other.st_size,
        other.st_uid,
        other.st_gid,
        other.st_mode,
        other.st_nlink,
    )


def _restrictive_directory(path: Path, label: str) -> os.stat_result:
    try:
        info = path.lstat()
    except OSError as error:
        raise RehearsalError(f"{label}_custody_invalid") from error
    if (
        path.is_symlink()
        or not stat.S_ISDIR(info.st_mode)
        or info.st_uid != os.getuid()
        or stat.S_IMODE(info.st_mode) != 0o700
    ):
        raise RehearsalError(f"{label}_custody_invalid")
    return info


def _owned_file(
    path: Path,
    label: str,
    *,
    maximum: int,
) -> tuple[bytes, os.stat_result]:
    fd: int | None = None
    try:
        before = path.lstat()
        if (
            path.is_symlink()
            or not stat.S_ISREG(before.st_mode)
            or before.st_uid != os.getuid()
            or stat.S_IMODE(before.st_mode) != 0o600
            or before.st_nlink != 1
            or before.st_size <= 0
            or before.st_size > maximum
        ):
            raise RehearsalError(f"{label}_custody_invalid")
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        opened = os.fstat(fd)
        chunks: list[bytes] = []
        size = 0
        while True:
            chunk = os.read(fd, min(1024 * 1024, maximum + 1 - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
            if size > maximum:
                raise RehearsalError(f"{label}_custody_invalid")
        after = path.lstat()
    except (OSError, RehearsalError) as error:
        if isinstance(error, RehearsalError):
            raise
        raise RehearsalError(f"{label}_custody_invalid") from error
    finally:
        if fd is not None:
            os.close(fd)
    if not _same_identity(before, opened) or not _same_identity(before, after) or size != before.st_size:
        raise RehearsalError(f"{label}_custody_changed")
    return b"".join(chunks), before


def _owned_file_digest(
    path: Path,
    label: str,
    *,
    maximum: int,
) -> tuple[str, int, os.stat_result]:
    fd: int | None = None
    try:
        before = path.lstat()
        if (
            path.is_symlink()
            or not stat.S_ISREG(before.st_mode)
            or before.st_uid != os.getuid()
            or stat.S_IMODE(before.st_mode) != 0o600
            or before.st_nlink != 1
            or before.st_size <= 0
            or before.st_size > maximum
        ):
            raise RehearsalError(f"{label}_custody_invalid")
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        opened = os.fstat(fd)
        hasher = hashlib.sha256()
        size = 0
        while True:
            chunk = os.read(fd, 1024 * 1024)
            if not chunk:
                break
            hasher.update(chunk)
            size += len(chunk)
            if size > maximum:
                raise RehearsalError(f"{label}_custody_invalid")
        after = path.lstat()
    except (OSError, RehearsalError) as error:
        if isinstance(error, RehearsalError):
            raise
        raise RehearsalError(f"{label}_custody_invalid") from error
    finally:
        if fd is not None:
            os.close(fd)
    if not _same_identity(before, opened) or not _same_identity(before, after) or size != before.st_size:
        raise RehearsalError(f"{label}_custody_changed")
    return hasher.hexdigest(), size, before


def _file_identity_sha256(info: os.stat_result) -> str:
    return _digest({"device": info.st_dev, "inode": info.st_ino})


def _read_json_receipt(path: Path, label: str) -> tuple[dict[str, object], bytes, os.stat_result]:
    raw, info = _owned_file(path, label, maximum=MAX_JSON_BYTES)
    try:
        value = json.loads(
            raw.decode("ascii"),
            object_pairs_hook=_json_pairs,
            parse_constant=_reject_constant,
        )
    except (UnicodeDecodeError, json.JSONDecodeError, RehearsalError) as error:
        raise RehearsalError(f"{label}_invalid") from error
    if type(value) is not dict or _canonical_bytes(value) != raw:
        raise RehearsalError(f"{label}_invalid")
    return value, raw, info


def _canonical_ledger_pairs(value: object) -> tuple[tuple[str, str], ...]:
    if type(value) not in (list, tuple):
        raise RehearsalError("ledger_invalid")
    pairs: list[tuple[str, str]] = []
    for pair in value:
        if (
            type(pair) not in (list, tuple)
            or len(pair) != 2
            or any(type(item) is not str or not item for item in pair)
        ):
            raise RehearsalError("ledger_invalid")
        pairs.append((pair[0], pair[1]))
    result = tuple(pairs)
    if (
        len(result) != EXPECTED_LEDGER_COUNT
        or result[-1] != EXPECTED_LEDGER_TERMINAL
        or len({version for version, unused_name in result}) != len(result)
        or result != tuple(sorted(result))
        or _sha256_bytes(
            json.dumps(result, ensure_ascii=True, separators=(",", ":")).encode("ascii")
        ) != EXPECTED_LEDGER_PAIR_SHA256
    ):
        raise RehearsalError("ledger_invalid")
    return result


def _ledger_sha256(pairs: Sequence[Sequence[str]]) -> str:
    return _sha256_bytes(json.dumps(tuple(tuple(pair) for pair in pairs), separators=(",", ":")).encode("ascii"))


def _validate_g035_envelope(value: dict[str, object], mode: str, status: str) -> dict[str, object]:
    required = {
        "schema",
        "mode",
        "status",
        "manifest_sha256",
        "prior_receipt_sha256",
        "evidence",
        "receipt_sha256",
    }
    body = dict(value)
    receipt_sha = body.pop("receipt_sha256", None)
    if (
        set(value) != required
        or value.get("schema") != G035_RECEIPT_SCHEMA
        or value.get("mode") != mode
        or value.get("status") != status
        or value.get("manifest_sha256") != G035_MANIFEST_SHA256
        or type(value.get("evidence")) is not dict
        or type(receipt_sha) is not str
        or not HEX.fullmatch(receipt_sha)
        or receipt_sha != _digest(body)
    ):
        raise RehearsalError("g035_receipt_invalid")
    return value["evidence"]  # type: ignore[return-value]


def _fingerprint_evidence(evidence: dict[str, object]) -> dict[str, object]:
    pairs = _canonical_ledger_pairs(evidence.get("ledger_pairs"))
    ledger_sha = _ledger_sha256(pairs)
    managed = evidence.get("managed_metadata_schemas_present")
    if (
        evidence.get("ledger_count") != EXPECTED_LEDGER_COUNT
        or evidence.get("ledger_sha256") != ledger_sha
        or type(evidence.get("restorable_catalog_sha256")) is not str
        or not HEX.fullmatch(evidence["restorable_catalog_sha256"])  # type: ignore[arg-type]
        or type(evidence.get("managed_catalog_sha256")) is not str
        or not HEX.fullmatch(evidence["managed_catalog_sha256"])  # type: ignore[arg-type]
        or type(managed) not in (list, tuple)
        or tuple(managed) != EXPECTED_MANAGED_SCHEMAS
    ):
        raise RehearsalError("g035_fingerprint_invalid")
    return {
        "ledgerPairs": [list(pair) for pair in pairs],
        "ledgerCount": EXPECTED_LEDGER_COUNT,
        "ledgerSha256": ledger_sha,
        "ledgerPairsSha256": _digest([list(pair) for pair in pairs]),
        "restorableCatalogSha256": evidence["restorable_catalog_sha256"],
        "managedCatalogSha256": evidence["managed_catalog_sha256"],
        "managedMetadataSchemasPresent": list(EXPECTED_MANAGED_SCHEMAS),
    }


def _validate_source_evidence(evidence: dict[str, object], expected_commit: str) -> tuple[str, str]:
    commit = evidence.get("repository_commit")
    runtime = evidence.get("runtime_source_root")
    if (
        commit != expected_commit
        or type(runtime) is not str
        or not HEX.fullmatch(runtime)
    ):
        raise RehearsalError("source_binding_invalid")
    return expected_commit, runtime


def _validate_capture_shape(evidence: dict[str, object]) -> None:
    expected_keys = {
        "g034_preflight_receipt_id",
        "repository_commit",
        "runtime_source_root",
        "catalog_sha256",
        "ledger_sha256",
        "source_sha256",
        "capture_readiness_sha256",
        "recipient_fingerprint",
        "dump_sha256",
        "dump_bytes",
        "dump_identity",
        "schema_scope",
        "recovery_control_schema_scope",
        "extension_scope",
        "managed_metadata_schema_scope",
        "managed_table_data_exclusions",
        "snapshot_consumer_argv",
        "ledger_pairs",
        "ledger_count",
        "restorable_catalog_sha256",
        "managed_catalog_sha256",
        "managed_metadata_schemas_present",
        "target_fingerprint",
    }
    hash_fields = (
        "g034_preflight_receipt_id",
        "runtime_source_root",
        "catalog_sha256",
        "ledger_sha256",
        "source_sha256",
        "capture_readiness_sha256",
        "recipient_fingerprint",
        "dump_sha256",
        "restorable_catalog_sha256",
        "managed_catalog_sha256",
        "target_fingerprint",
    )
    argv = evidence.get("snapshot_consumer_argv")
    expected_tail = [
        "--format=custom",
        None,
        "--blobs",
        *[f"--schema={schema}" for schema in (*APPLICATION_SCHEMAS, *RECOVERY_CONTROL_SCHEMAS, *EXPECTED_MANAGED_SCHEMAS)],
        *MANAGED_TABLE_DATA_EXCLUSIONS,
        *[f"--extension={name}" for name, unused_schema in RECOVERY_EXTENSIONS],
        "--dbname=service=g035",
    ]
    if (
        set(evidence) != expected_keys
        or any(type(evidence.get(key)) is not str or not HEX.fullmatch(evidence[key]) for key in hash_fields)
        or evidence.get("recipient_fingerprint") != APPROVED_AGE_RECIPIENT_SHA256
        or evidence.get("schema_scope") != list(APPLICATION_SCHEMAS)
        or evidence.get("recovery_control_schema_scope") != list(RECOVERY_CONTROL_SCHEMAS)
        or evidence.get("extension_scope")
        != [{"name": name, "schema": schema} for name, schema in RECOVERY_EXTENSIONS]
        or evidence.get("managed_metadata_schema_scope") != list(EXPECTED_MANAGED_SCHEMAS)
        or evidence.get("managed_table_data_exclusions") != list(MANAGED_TABLE_DATA_EXCLUSIONS)
        or type(argv) is not list
        or len(argv) != len(expected_tail) + 1
        or any(type(item) is not str for item in argv)
        or not Path(argv[0]).is_absolute()
        or Path(argv[0]).name != "pg_dump"
        or argv[1] != expected_tail[0]
        or not argv[2].startswith("--snapshot=")
        or not SNAPSHOT.fullmatch(argv[2].removeprefix("--snapshot="))
        or argv[3:] != expected_tail[2:]
    ):
        raise RehearsalError("capture_contract_invalid")


def _validate_restore_shape(evidence: dict[str, object]) -> None:
    expected_keys = {
        "repository_commit",
        "runtime_source_root",
        "ledger_pairs",
        "ledger_sha256",
        "ledger_count",
        "restorable_catalog_sha256",
        "managed_catalog_sha256",
        "managed_metadata_schemas_present",
        "restored_vector_schema",
        "restore_compatibility_hook_sha256",
        "managed_metadata_coherence",
        "auth_placeholder_mapping_count",
        "auth_placeholder_mapping_sha256",
    }
    if (
        set(evidence) != expected_keys
        or evidence.get("restore_compatibility_hook_sha256") != RESTORE_COMPATIBILITY_HOOK_SHA256
        or evidence.get("auth_placeholder_mapping_count") != AUTH_PLACEHOLDER_MAPPING_COUNT
        or evidence.get("auth_placeholder_mapping_sha256") != AUTH_PLACEHOLDER_MAPPING_SHA256
    ):
        raise RehearsalError("restore_contract_invalid")


def _validate_capture(
    path: Path,
    archive: Path,
    expected_commit: str,
) -> dict[str, object]:
    capture, raw, receipt_info = _read_json_receipt(path, "capture_receipt")
    evidence = _validate_g035_envelope(capture, "capture", "captured")
    _validate_capture_shape(evidence)
    if capture.get("prior_receipt_sha256") != []:
        raise RehearsalError("capture_receipt_invalid")
    unused_commit, runtime = _validate_source_evidence(evidence, expected_commit)
    fingerprints = _fingerprint_evidence(evidence)
    archive_sha, archive_bytes, archive_info = _owned_file_digest(
        archive,
        "encrypted_archive",
        maximum=MAX_ARCHIVE_BYTES,
    )
    recorded_identity = evidence.get("dump_identity")
    if (
        evidence.get("dump_sha256") != archive_sha
        or evidence.get("dump_bytes") != archive_bytes
        or type(recorded_identity) is not dict
        or set(recorded_identity) != {"device", "inode"}
        or recorded_identity.get("device") != archive_info.st_dev
        or recorded_identity.get("inode") != archive_info.st_ino
        or type(evidence.get("target_fingerprint")) is not str
        or not HEX.fullmatch(evidence["target_fingerprint"])  # type: ignore[arg-type]
    ):
        raise RehearsalError("capture_archive_binding_invalid")
    return {
        "value": capture,
        "evidence": evidence,
        "fingerprints": fingerprints,
        "receiptSha256": capture["receipt_sha256"],
        "receiptBytesSha256": _sha256_bytes(raw),
        "receiptFileIdentitySha256": _file_identity_sha256(receipt_info),
        "captureReceiptMtimeNs": receipt_info.st_mtime_ns,
        "archiveSha256": archive_sha,
        "archiveBytes": archive_bytes,
        "archiveFileIdentitySha256": _file_identity_sha256(archive_info),
        "archiveMtimeNs": archive_info.st_mtime_ns,
        "manifestSha256": G035_MANIFEST_SHA256,
        "runtimeSourceRoot": runtime,
    }


def _require_fresh_input_evidence(capture: dict[str, object]) -> None:
    now = time.time_ns()
    maximum_age = MAX_EVIDENCE_AGE_SECONDS * 1_000_000_000
    for key in ("captureReceiptMtimeNs", "archiveMtimeNs"):
        observed = capture.get(key)
        if (
            type(observed) is not int
            or observed <= 1_700_000_000_000_000_000
            or observed > now + 300 * 1_000_000_000
            or now - observed > maximum_age
        ):
            raise RehearsalError("input_evidence_stale")


def _validate_restore(
    path: Path,
    capture: dict[str, object],
    expected_commit: str,
) -> dict[str, object]:
    restored, raw, info = _read_json_receipt(path, "restore_receipt")
    evidence = _validate_g035_envelope(restored, "restore-verify", "restored")
    _validate_restore_shape(evidence)
    if restored.get("prior_receipt_sha256") != [capture["receiptSha256"]]:
        raise RehearsalError("restore_capture_binding_invalid")
    unused_commit, runtime = _validate_source_evidence(evidence, expected_commit)
    if runtime != capture["runtimeSourceRoot"]:
        raise RehearsalError("restore_source_binding_invalid")
    fingerprints = _fingerprint_evidence(evidence)
    if fingerprints != capture["fingerprints"]:
        raise RehearsalError("restore_comparison_invalid")
    if (
        evidence.get("restored_vector_schema") != "public"
        or evidence.get("restore_compatibility_hook_sha256") != RESTORE_COMPATIBILITY_HOOK_SHA256
        or evidence.get("managed_metadata_coherence")
        != "managed schema DDL restored with hosted catalog parity; managed table data excluded"
    ):
        raise RehearsalError("restore_contract_invalid")
    return {
        "value": restored,
        "fingerprints": fingerprints,
        "receiptSha256": restored["receipt_sha256"],
        "receiptBytesSha256": _sha256_bytes(raw),
        "receiptFileIdentitySha256": _file_identity_sha256(info),
        "restoreReceiptMtimeNs": info.st_mtime_ns,
        "fileIdentity": (info.st_dev, info.st_ino),
    }


def _git(root: Path, *args: str) -> bytes:
    try:
        result = subprocess.run(
            ["/usr/bin/git", "-C", os.fspath(root), *args],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=_remaining_timeout(30, cleanup=_IN_CLEANUP),
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise RehearsalError("source_binding_invalid") from error
    if result.returncode != 0:
        raise RehearsalError("source_binding_invalid")
    return result.stdout


def _source_binding(
    root: Path,
    expected_commit: str,
    *,
    require_detached: bool,
) -> dict[str, str]:
    if not root.is_absolute() or not COMMIT.fullmatch(expected_commit):
        raise RehearsalError("source_binding_invalid")
    try:
        resolved = root.resolve(strict=True)
    except OSError as error:
        raise RehearsalError("source_binding_invalid") from error
    if root != resolved or not root.is_dir() or root.is_symlink():
        raise RehearsalError("source_binding_invalid")
    attached = subprocess.run(
        ["/usr/bin/git", "-C", os.fspath(root), "symbolic-ref", "-q", "HEAD"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=_remaining_timeout(30, cleanup=_IN_CLEANUP),
        check=False,
    )
    if (
        (require_detached and attached.returncode != 1)
        or (not require_detached and attached.returncode not in (0, 1))
        or _git(root, "rev-parse", "--verify", "HEAD^{commit}") != (expected_commit + "\n").encode("ascii")
        or _git(root, "status", "--porcelain=v1", "-z", "--untracked-files=all")
    ):
        raise RehearsalError("source_binding_invalid")
    tracked = _git(root, "show", f"{expected_commit}:{SCRIPT_PATH}")
    local = root / SCRIPT_PATH
    try:
        info = local.lstat()
        local_bytes = local.read_bytes()
    except OSError as error:
        raise RehearsalError("source_binding_invalid") from error
    if local.is_symlink() or not stat.S_ISREG(info.st_mode) or local_bytes != tracked:
        raise RehearsalError("source_binding_invalid")
    return {
        "repositoryCommit": expected_commit,
        "producerSourceSha256": _sha256_bytes(tracked),
    }


def _binary(value: str, label: str) -> str:
    path = Path(value)
    if not path.is_absolute():
        raise RehearsalError(f"{label}_invalid")
    try:
        resolved = path.resolve(strict=True)
        info = resolved.stat()
    except OSError as error:
        raise RehearsalError(f"{label}_invalid") from error
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid not in (0, os.getuid())
        or info.st_nlink != 1
        or info.st_mode & 0o022
        or not os.access(resolved, os.X_OK)
    ):
        raise RehearsalError(f"{label}_invalid")
    return os.fspath(resolved)


def _tool_binding(path: str, name: str) -> dict[str, object]:
    expected = EXPECTED_TOOLCHAIN.get(name)
    if type(expected) is not dict or path != expected.get("path"):
        raise RehearsalError(f"{name}_identity_invalid")
    try:
        info = Path(path).stat()
        argv = [path, "--version"]
        result = subprocess.run(
            argv,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=_remaining_timeout(30, cleanup=_IN_CLEANUP),
            check=False,
            env={"PATH": os.environ.get("PATH", "")},
        )
        after = Path(path).stat()
    except (OSError, subprocess.SubprocessError) as error:
        raise RehearsalError(f"{name}_identity_invalid") from error
    output = result.stdout if result.stdout else result.stderr
    other = result.stderr if result.stdout else result.stdout
    try:
        version = output.decode("ascii").strip()
    except UnicodeDecodeError as error:
        raise RehearsalError(f"{name}_identity_invalid") from error
    if (
        result.returncode != 0
        or other
        or not _same_identity(info, after)
        or info.st_size != expected.get("bytes")
        or info.st_uid != expected.get("uid")
        or info.st_nlink != expected.get("nlink")
        or stat.S_IMODE(info.st_mode) != expected.get("mode")
        or _executable_sha256(path) != expected.get("sha256")
        or version != expected.get("version")
    ):
        raise RehearsalError(f"{name}_identity_invalid")
    body: dict[str, object] = {
        "pathSha256": _sha256_bytes(path.encode("utf-8")),
        "bytes": info.st_size,
        "uid": info.st_uid,
        "nlink": info.st_nlink,
        "mode": stat.S_IMODE(info.st_mode),
        "sha256": expected["sha256"],
        "version": version,
    }
    return {**body, "identityRoot": _digest(body)}


def _expected_tool_binding(name: str) -> dict[str, object]:
    expected = EXPECTED_TOOLCHAIN[name]
    body: dict[str, object] = {
        "pathSha256": _sha256_bytes(str(expected["path"]).encode("utf-8")),
        "bytes": expected["bytes"],
        "uid": expected["uid"],
        "nlink": expected["nlink"],
        "mode": expected["mode"],
        "sha256": expected["sha256"],
        "version": expected["version"],
    }
    return {**body, "identityRoot": _digest(body)}


def _live_toolchain(
    python: str,
    docker: str,
    age: str,
    pg_restore: str,
) -> dict[str, object]:
    return {
        "python": _tool_binding(python, "python"),
        "docker": _tool_binding(docker, "docker"),
        "age": _tool_binding(age, "age"),
        "pgRestore": _tool_binding(pg_restore, "pgRestore"),
    }


def _require_toolchain_unchanged(
    expected: dict[str, object],
    python: str,
    docker: str,
    age: str,
    pg_restore: str,
) -> None:
    if _live_toolchain(python, docker, age, pg_restore) != expected:
        raise RehearsalError("toolchain_identity_changed")


def _docker_environment(endpoint: str | None = None) -> dict[str, str]:
    environment = {"PATH": os.environ.get("PATH", "")}
    selected = endpoint if endpoint is not None else _PINNED_DOCKER_ENDPOINT
    if selected is not None:
        environment["DOCKER_HOST"] = selected
    return environment


def _pin_docker_endpoint(endpoint: str, socket_path: Path, info: os.stat_result) -> None:
    global _PINNED_DOCKER_ENDPOINT, _PINNED_DOCKER_SOCKET_IDENTITY
    candidate = (info.st_dev, info.st_ino, info.st_uid)
    if _PINNED_DOCKER_ENDPOINT is not None or _PINNED_DOCKER_SOCKET_IDENTITY is not None:
        if _PINNED_DOCKER_ENDPOINT == endpoint and _PINNED_DOCKER_SOCKET_IDENTITY == candidate:
            return
        raise RehearsalError("docker_endpoint_already_pinned")
    _PINNED_DOCKER_ENDPOINT = endpoint
    _PINNED_DOCKER_SOCKET_IDENTITY = candidate


def _recheck_pinned_docker_socket() -> None:
    if _PINNED_DOCKER_ENDPOINT is None or _PINNED_DOCKER_SOCKET_IDENTITY is None:
        raise RehearsalError("docker_endpoint_not_pinned")
    try:
        path = Path(_PINNED_DOCKER_ENDPOINT.removeprefix("unix://")).resolve(strict=True)
        info = path.stat()
    except OSError as error:
        raise RehearsalError("docker_socket_invalid") from error
    if (
        not stat.S_ISSOCK(info.st_mode)
        or (info.st_dev, info.st_ino, info.st_uid) != _PINNED_DOCKER_SOCKET_IDENTITY
        or stat.S_IMODE(info.st_mode) & 0o077
    ):
        raise RehearsalError("docker_socket_changed")


def _command(
    argv: Sequence[str],
    *,
    timeout: int = 120,
    input_bytes: bytes | None = None,
) -> bytes:
    try:
        result = subprocess.run(
            list(argv),
            input=input_bytes,
            stdin=subprocess.DEVNULL if input_bytes is None else None,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=_remaining_timeout(timeout, cleanup=_IN_CLEANUP),
            check=False,
            env=_docker_environment(),
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise RehearsalError("local_command_failed") from error
    if result.returncode != 0:
        raise RehearsalError("local_command_failed")
    return result.stdout


def _docker_json(docker: str, *args: str) -> object:
    try:
        return json.loads(_command([docker, *args]).decode("utf-8"), parse_constant=_reject_constant)
    except (UnicodeDecodeError, json.JSONDecodeError, RehearsalError) as error:
        raise RehearsalError("docker_inspect_invalid") from error


def _docker_names(docker: str, kind: str) -> tuple[str, ...]:
    command = (
        [docker, "container", "ls", "--all", "--no-trunc", "--format", "{{.Names}}"]
        if kind == "container"
        else [docker, "network", "ls", "--no-trunc", "--format", "{{.Name}}"]
    )
    try:
        result = subprocess.run(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=_remaining_timeout(DOCKER_PROBE_TIMEOUT_SECONDS, cleanup=_IN_CLEANUP),
            check=False,
            env=_docker_environment(),
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise RehearsalError("docker_inventory_unavailable") from error
    if result.returncode != 0 or result.stderr:
        raise RehearsalError("docker_inventory_unavailable")
    try:
        names = result.stdout.decode("utf-8").splitlines()
    except UnicodeDecodeError as error:
        raise RehearsalError("docker_inventory_unavailable") from error
    if any(not name or "\x00" in name for name in names) or len(names) != len(set(names)):
        raise RehearsalError("docker_inventory_unavailable")
    return tuple(names)


def _docker_absent(docker: str, kind: str, name: str) -> bool:
    return name not in _docker_names(docker, kind)


def _validate_image(docker: str) -> None:
    inspected = _docker_json(docker, "image", "inspect", IMAGE_REFERENCE)
    if type(inspected) is not list or len(inspected) != 1 or type(inspected[0]) is not dict:
        raise RehearsalError("image_identity_invalid")
    image = inspected[0]
    digests = image.get("RepoDigests")
    if (
        image.get("Id") != IMAGE_ID
        or type(digests) is not list
        or IMAGE_REFERENCE not in digests
    ):
        raise RehearsalError("image_identity_invalid")


def _executable_sha256(path: str) -> str:
    try:
        info = Path(path).stat()
        hasher = hashlib.sha256()
        with Path(path).open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                hasher.update(chunk)
        after = Path(path).stat()
    except OSError as error:
        raise RehearsalError("docker_binary_invalid") from error
    if not _same_identity(info, after):
        raise RehearsalError("docker_binary_changed")
    return hasher.hexdigest()


def _local_docker_binding(docker: str) -> dict[str, object]:
    global _PINNED_DOCKER_BINDING
    if any(os.environ.get(name) for name in ("DOCKER_HOST", "DOCKER_CONTEXT")):
        raise RehearsalError("remote_docker_rejected")
    if _PINNED_DOCKER_BINDING is not None:
        _recheck_pinned_docker_socket()
        endpoint = _PINNED_DOCKER_ENDPOINT
        if endpoint is None:
            raise RehearsalError("docker_endpoint_not_pinned")
        try:
            client_result = subprocess.run(
                [docker, "version", "--format", "{{json .Client}}"],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=_remaining_timeout(30, cleanup=_IN_CLEANUP),
                check=False,
                env=_docker_environment(endpoint),
            )
            server_result = subprocess.run(
                [docker, "version", "--format", "{{json .Server}}"],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=_remaining_timeout(30, cleanup=_IN_CLEANUP),
                check=False,
                env=_docker_environment(endpoint),
            )
            if (
                client_result.returncode != 0
                or client_result.stderr
                or server_result.returncode != 0
                or server_result.stderr
            ):
                raise RehearsalError("docker_daemon_identity_invalid")
            client = json.loads(
                client_result.stdout.decode("utf-8"),
                object_pairs_hook=_json_pairs,
                parse_constant=_reject_constant,
            )
            server = json.loads(
                server_result.stdout.decode("utf-8"),
                object_pairs_hook=_json_pairs,
                parse_constant=_reject_constant,
            )
        except (OSError, UnicodeDecodeError, json.JSONDecodeError, subprocess.SubprocessError) as error:
            raise RehearsalError("docker_daemon_identity_invalid") from error
        _recheck_pinned_docker_socket()
        if (
            type(client) is not dict
            or type(server) is not dict
            or _digest(client) != _PINNED_DOCKER_BINDING["clientIdentitySha256"]
            or _digest(server) != _PINNED_DOCKER_BINDING["serverIdentitySha256"]
            or _executable_sha256(docker) != _PINNED_DOCKER_BINDING["binarySha256"]
        ):
            raise RehearsalError("docker_daemon_identity_invalid")
        return dict(_PINNED_DOCKER_BINDING)
    context = _command([docker, "context", "show"], timeout=30).decode("utf-8").strip()
    if not context or any(character in context for character in "\r\n\x00"):
        raise RehearsalError("docker_context_invalid")
    try:
        inspected = json.loads(
            _command([docker, "context", "inspect", context], timeout=30).decode("utf-8"),
            object_pairs_hook=_json_pairs,
            parse_constant=_reject_constant,
        )
        if type(inspected) is not list or len(inspected) != 1 or type(inspected[0]) is not dict:
            raise RehearsalError("docker_context_invalid")
        endpoint = inspected[0]["Endpoints"]["docker"]["Host"]
    except (UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError, RehearsalError) as error:
        raise RehearsalError("docker_context_invalid") from error
    if os.name != "posix" or type(endpoint) is not str or not endpoint.startswith("unix://"):
        raise RehearsalError("remote_docker_rejected")
    raw_socket = Path(endpoint.removeprefix("unix://"))
    try:
        socket_path = raw_socket.resolve(strict=True)
        before = socket_path.stat()
    except OSError as error:
        raise RehearsalError("docker_socket_invalid") from error
    if (
        not socket_path.is_absolute()
        or raw_socket != socket_path
        or not stat.S_ISSOCK(before.st_mode)
        or before.st_uid != os.getuid()
        or stat.S_IMODE(before.st_mode) & 0o077
    ):
        raise RehearsalError("docker_socket_invalid")
    try:
        client = json.loads(
            subprocess.run(
                [docker, "version", "--format", "{{json .Client}}"],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=_remaining_timeout(30, cleanup=_IN_CLEANUP),
                check=True,
                env=_docker_environment(endpoint),
            ).stdout.decode("utf-8"),
            object_pairs_hook=_json_pairs,
            parse_constant=_reject_constant,
        )
        server = json.loads(
            subprocess.run(
                [docker, "version", "--format", "{{json .Server}}"],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=_remaining_timeout(30, cleanup=_IN_CLEANUP),
                check=True,
                env=_docker_environment(endpoint),
            ).stdout.decode("utf-8"),
            object_pairs_hook=_json_pairs,
            parse_constant=_reject_constant,
        )
        after = socket_path.stat()
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, RehearsalError) as error:
        raise RehearsalError("docker_daemon_identity_invalid") from error
    if (
        type(client) is not dict
        or type(server) is not dict
        or client.get("Context") != "default"
        or type(client.get("Version")) is not str
        or type(server.get("Version")) is not str
        or server.get("Os") != "linux"
        or not _same_identity(before, after)
    ):
        raise RehearsalError("docker_daemon_identity_invalid")
    socket_identity = {
        "device": before.st_dev,
        "inode": before.st_ino,
        "uid": before.st_uid,
        "mode": stat.S_IMODE(before.st_mode),
    }
    descriptor = {
        "context": context,
        "endpointSha256": _sha256_bytes(endpoint.encode("utf-8")),
        "socketIdentitySha256": _digest(socket_identity),
        "clientIdentitySha256": _digest(client),
        "serverIdentitySha256": _digest(server),
        "clientVersion": client["Version"],
        "serverVersion": server["Version"],
        "binarySha256": _executable_sha256(docker),
    }
    binding = {**descriptor, "identityRoot": _digest(descriptor)}
    _pin_docker_endpoint(endpoint, socket_path, before)
    _PINNED_DOCKER_BINDING = dict(binding)
    return binding


def _require_expected_password_environment(config: dict[str, object], password: str) -> bool:
    environment = config.get("Env")
    if type(environment) is not list or any(type(item) is not str for item in environment):
        return False
    password_entries = [item for item in environment if item.startswith("POSTGRES_PASSWORD=")]
    auth_entries = [item for item in environment if item.startswith("POSTGRES_HOST_AUTH_METHOD=")]
    return password_entries == [f"POSTGRES_PASSWORD={password}"] and auth_entries == []


def _parse_identity_channel(value: object) -> int:
    if type(value) is not str or not re.fullmatch(r"(?:[3-9]|[1-9][0-9]+)", value):
        raise RehearsalError("identity_channel_invalid")
    channel = int(value, 10)
    if channel > 2**31 - 1:
        raise RehearsalError("identity_channel_invalid")
    return channel


def _read_inherited_identity(value: object) -> bytearray:
    global _ACTIVE_IDENTITY
    if os.name != "posix":
        raise RehearsalError("identity_channel_unavailable")
    channel = _parse_identity_channel(value)
    duplicate: int | None = None
    try:
        import fcntl

        descriptor = os.fstat(channel)
        flags = fcntl.fcntl(channel, fcntl.F_GETFL)
        if not stat.S_ISFIFO(descriptor.st_mode) or flags & os.O_ACCMODE != os.O_RDONLY:
            raise RehearsalError("identity_channel_invalid")
        duplicate = os.dup(channel)
        os.set_inheritable(duplicate, False)
        os.close(channel)
        channel = -1
        identity = bytearray(MAX_IDENTITY_BYTES + 1)
        size = 0
        import select

        poller = select.poll()
        poller.register(duplicate, select.POLLIN | select.POLLHUP | select.POLLERR)
        deadline = time.monotonic() + 30
        if _WHOLE_DEADLINE is not None:
            deadline = min(deadline, _WHOLE_DEADLINE)
        while True:
            _require_not_cancelled()
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not poller.poll(max(1, int(remaining * 1000))):
                raise RehearsalError("identity_channel_timeout")
            view = memoryview(identity)
            try:
                count = os.readv(
                    duplicate,
                    [view[size : size + min(1024, MAX_IDENTITY_BYTES + 1 - size)]],
                )
            finally:
                view.release()
            if count == 0:
                break
            size += count
            if size > MAX_IDENTITY_BYTES:
                raise RehearsalError("identity_channel_invalid")
        if size == 0 or identity.find(b"AGE-SECRET-KEY-", 0, size) < 0:
            raise RehearsalError("identity_channel_invalid")
        identity[size:] = b"\0" * (len(identity) - size)
        del identity[size:]
        _ACTIVE_IDENTITY = identity
        return identity
    except (OSError, ImportError, RehearsalError) as error:
        if "identity" in locals():
            identity[:] = b"\0" * len(identity)
        if isinstance(error, RehearsalError):
            raise
        raise RehearsalError("identity_channel_invalid") from error
    finally:
        if duplicate is not None:
            try:
                os.close(duplicate)
            except OSError:
                pass
        if channel >= 0:
            try:
                os.close(channel)
            except OSError:
                pass


def _secure_mkdir(path: Path, label: str) -> None:
    if path.exists() or path.is_symlink():
        raise RehearsalError(f"{label}_already_exists")
    _restrictive_directory(path.parent, f"{label}_parent")
    try:
        os.mkdir(path, 0o700)
    except OSError as error:
        raise RehearsalError(f"{label}_custody_invalid") from error
    _restrictive_directory(path, label)


def _remove_owned_tree(path: Path, identity: tuple[int, int], label: str) -> bool:
    try:
        root = path.lstat()
        if (
            path.is_symlink()
            or not stat.S_ISDIR(root.st_mode)
            or root.st_uid != os.getuid()
            or stat.S_IMODE(root.st_mode) != 0o700
            or (root.st_dev, root.st_ino) != identity
        ):
            return False
        entries = sorted(path.iterdir(), key=lambda item: item.name, reverse=True)
        for entry in entries:
            info = entry.lstat()
            if (
                stat.S_ISLNK(info.st_mode)
                or info.st_uid != os.getuid()
                or info.st_nlink != 1
                or info.st_dev != root.st_dev
            ):
                return False
            if stat.S_ISDIR(info.st_mode):
                if stat.S_IMODE(info.st_mode) != 0o700:
                    return False
                if not _remove_owned_tree(entry, (info.st_dev, info.st_ino), label):
                    return False
            elif stat.S_ISREG(info.st_mode):
                if stat.S_IMODE(info.st_mode) != 0o600:
                    return False
                entry.unlink()
                if entry.exists() or entry.is_symlink():
                    return False
            else:
                return False
        path.rmdir()
        if path.exists() or path.is_symlink():
            return False
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        return True
    except OSError:
        return False


def _secure_write(path: Path, value: bytes, label: str) -> os.stat_result:
    fd: int | None = None
    try:
        fd = os.open(
            path,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
        offset = 0
        while offset < len(value):
            offset += os.write(fd, value[offset:])
        os.fsync(fd)
        info = os.fstat(fd)
        after = path.lstat()
    except OSError as error:
        raise RehearsalError(f"{label}_persistence_failed") from error
    finally:
        if fd is not None:
            os.close(fd)
    if (
        not stat.S_ISREG(info.st_mode)
        or stat.S_IMODE(info.st_mode) != 0o600
        or not _same_identity(info, after)
        or path.is_symlink()
    ):
        raise RehearsalError(f"{label}_persistence_failed")
    return info


def _publish_receipt(path: Path, value: dict[str, object]) -> None:
    raw = _canonical_bytes(value)
    temporary = path.with_name(f".{path.name}.{secrets.token_hex(16)}.tmp")
    info = _secure_write(temporary, raw, "dual_receipt")
    try:
        os.link(temporary, path, follow_symlinks=False)
        published = path.lstat()
        if not _same_identity(info, published) or path.is_symlink():
            raise RehearsalError("dual_receipt_persistence_failed")
        temporary.unlink()
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        stored, unused_info = _owned_file(path, "dual_receipt", maximum=MAX_JSON_BYTES)
        if stored != raw:
            raise RehearsalError("dual_receipt_persistence_failed")
    except Exception as error:
        try:
            if path.exists() and not path.is_symlink() and path.lstat().st_ino == info.st_ino:
                path.unlink()
        except OSError:
            pass
        try:
            if temporary.exists() and not temporary.is_symlink() and temporary.lstat().st_ino == info.st_ino:
                temporary.unlink()
        except OSError:
            pass
        if isinstance(error, RehearsalError):
            raise
        raise RehearsalError("dual_receipt_persistence_failed") from error


def _bounded_run(argv: Sequence[str], *, timeout: float) -> subprocess.CompletedProcess[bytes]:
    try:
        return subprocess.run(
            list(argv),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=_remaining_timeout(timeout, cleanup=_IN_CLEANUP),
            check=False,
            env=_docker_environment(),
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise RehearsalError("local_command_failed") from error


def _validate_postgres_custom_archive(raw: bytes) -> str:
    if not raw or len(raw) > MAX_POSTGRES_CUSTOM_ARCHIVE_BYTES:
        raise RehearsalError("postgres_custom_source_invalid")
    records: list[dict[str, object]] = []
    seen: set[str] = set()
    total_bytes = 0
    try:
        with tarfile.open(fileobj=io.BytesIO(raw), mode="r:*") as archive:
            for member in archive.getmembers():
                name = "." if member.name in (".", "./") else member.name.removeprefix("./")
                path = PurePosixPath(name)
                if (
                    name in seen
                    or path.is_absolute()
                    or any(part in ("", "..") for part in path.parts)
                    or member.uid != int(PINNED_POSTGRES_UID)
                    or member.gid != int(PINNED_POSTGRES_GID)
                    or member.pax_headers
                ):
                    raise RehearsalError("postgres_custom_source_invalid")
                seen.add(name)
                if member.isdir():
                    if member.mode != 0o755 or member.size != 0:
                        raise RehearsalError("postgres_custom_source_invalid")
                    record: dict[str, object] = {
                        "path": name,
                        "type": "directory",
                        "mode": member.mode,
                        "uid": member.uid,
                        "gid": member.gid,
                        "size": member.size,
                    }
                elif member.isfile():
                    if member.mode != 0o644 or member.size < 0:
                        raise RehearsalError("postgres_custom_source_invalid")
                    stream = archive.extractfile(member)
                    if stream is None:
                        raise RehearsalError("postgres_custom_source_invalid")
                    value = stream.read(MAX_POSTGRES_CUSTOM_ARCHIVE_BYTES + 1)
                    if len(value) != member.size:
                        raise RehearsalError("postgres_custom_source_invalid")
                    total_bytes += len(value)
                    record = {
                        "path": name,
                        "type": "file",
                        "mode": member.mode,
                        "uid": member.uid,
                        "gid": member.gid,
                        "size": member.size,
                        "sha256": _sha256_bytes(value),
                    }
                else:
                    raise RehearsalError("postgres_custom_source_invalid")
                records.append(record)
    except (OSError, tarfile.TarError, RehearsalError) as error:
        if isinstance(error, RehearsalError):
            raise
        raise RehearsalError("postgres_custom_source_invalid") from error
    records.sort(key=lambda item: str(item["path"]))
    root = _digest(records)
    if (
        len(records) != POSTGRES_CUSTOM_TREE_MEMBERS
        or total_bytes != POSTGRES_CUSTOM_TREE_BYTES
        or root != POSTGRES_CUSTOM_TREE_ROOT
    ):
        raise RehearsalError("postgres_custom_source_invalid")
    return root


def _postgres_custom_archive(docker: str, *container_argv: str) -> tuple[bytes, str]:
    raw = _command(
        [
            docker,
            *container_argv,
            "/bin/tar",
            "-C",
            "/etc/postgresql-custom",
            "-cf",
            "-",
            ".",
        ],
        timeout=60,
    )
    return raw, _validate_postgres_custom_archive(raw)


def _postgres_custom_image_archive(
    docker: str,
    run_nonce: str,
    slot: int,
    creation_state: dict[str, object],
) -> tuple[bytes, str]:
    global _IN_CLEANUP
    helper = f"tzudong-g035-{run_nonce[:20]}-{slot}-source"
    labels = {
        "io.tzudong.g035-dual-restore": run_nonce,
        "io.tzudong.g035-dual-restore.slot": str(slot),
        "io.tzudong.g035-dual-restore.purpose": "postgres-custom-source",
    }
    label_argv = [item for key, value in labels.items() for item in ("--label", f"{key}={value}")]
    if not _docker_absent(docker, "container", helper):
        raise RehearsalError("clone_name_already_exists")
    created = _command(
        [
            docker,
            "create",
            "--name",
            helper,
            "--network",
            "none",
            "--read-only",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            *label_argv,
            "--entrypoint",
            "/bin/tar",
            IMAGE_REFERENCE,
            "-C",
            "/etc/postgresql-custom",
            "-cf",
            "-",
            ".",
        ],
        timeout=60,
    )
    try:
        identifier = created.decode("ascii").strip()
    except UnicodeDecodeError as error:
        raise RehearsalError("clone_creation_identity_invalid") from error
    if not HEX.fullmatch(identifier):
        raise RehearsalError("clone_creation_identity_invalid")
    creation_state["sourceHelperName"] = helper
    creation_state["sourceHelperId"] = identifier
    creation_state["sourceHelperLabels"] = labels
    try:
        raw = _command([docker, "start", "--attach", identifier], timeout=60)
        return raw, _validate_postgres_custom_archive(raw)
    finally:
        prior_cleanup = _IN_CLEANUP
        _IN_CLEANUP = True
        try:
            if not _remove_owned_resource(
                docker,
                "container",
                helper,
                labels,
                expected_id=identifier,
            ):
                raise RehearsalError("clone_cleanup_failed")
            creation_state["sourceHelperRemoved"] = True
        finally:
            _IN_CLEANUP = prior_cleanup


def _wait_for_clone(docker: str, container: str, password: str) -> None:
    deadline = time.monotonic() + CONTAINER_READY_SECONDS
    while time.monotonic() < deadline:
        _require_not_cancelled()
        ready = _bounded_run(
            [docker, "exec", container, "pg_isready", "-U", POSTGRES_ADMIN_ROLE, "-d", "postgres"],
            timeout=min(5, deadline - time.monotonic()),
        )
        health = _bounded_run(
            [docker, "inspect", "--format", "{{.State.Health.Status}}", container],
            timeout=min(5, deadline - time.monotonic()),
        )
        if ready.returncode == 0 and health.returncode == 0 and health.stdout == b"healthy\n":
            break
        time.sleep(0.5)
    else:
        raise RehearsalError("clone_not_ready")
    authentication_argv = [
        container,
        "psql",
        "-w",
        "-h",
        "127.0.0.1",
        "-U",
        POSTGRES_ADMIN_ROLE,
        "-d",
        "postgres",
        "--no-psqlrc",
        "--tuples-only",
        "--no-align",
        "--set",
        "ON_ERROR_STOP=1",
        "--command",
        "SELECT 'auth-ok'",
    ]
    no_password = _bounded_run(
        [docker, "exec", *authentication_argv],
        timeout=10,
    )
    wrong_password = _bounded_run(
        [docker, "exec", "--env", "PGPASSWORD=definitely-wrong", *authentication_argv],
        timeout=10,
    )
    correct_password = _bounded_run(
        [docker, "exec", "--env", f"PGPASSWORD={password}", *authentication_argv],
        timeout=10,
    )
    if (
        no_password.returncode == 0
        or wrong_password.returncode == 0
        or correct_password.returncode != 0
        or correct_password.stdout != b"auth-ok\n"
        or correct_password.stderr
    ):
        raise RehearsalError("clone_authentication_boundary_invalid")
    database_deadline = time.monotonic() + DATABASE_READY_SECONDS
    while time.monotonic() < database_deadline:
        _require_not_cancelled()
        created = _bounded_run(
            [
                docker,
                "exec",
                "--env",
                f"PGPASSWORD={password}",
                container,
                "createdb",
                "-h",
                "127.0.0.1",
                "-U",
                POSTGRES_ADMIN_ROLE,
                "g035_local",
            ],
            timeout=min(5, database_deadline - time.monotonic()),
        )
        if created.returncode == 0:
            return
        time.sleep(1)
    raise RehearsalError("clone_database_create_failed")


def _create_clone_unchecked(
    docker: str,
    destination: Path,
    run_nonce: str,
    slot: int,
    creation_state: dict[str, object],
) -> dict[str, object]:
    token = run_nonce[:20]
    container = f"tzudong-g035-{token}-{slot}-db"
    network = f"tzudong-g035-{token}-{slot}-net"
    if not _docker_absent(docker, "container", container) or not _docker_absent(docker, "network", network):
        raise RehearsalError("clone_name_already_exists")
    labels = {
        "io.tzudong.g035-dual-restore": run_nonce,
        "io.tzudong.g035-dual-restore.slot": str(slot),
    }
    password = secrets.token_urlsafe(48)
    label_argv = [item for key, value in labels.items() for item in ("--label", f"{key}={value}")]
    network_created = _command(
        [
            docker,
            "network",
            "create",
            "--driver",
            "bridge",
            "--internal",
            "--opt",
            "com.docker.network.bridge.enable_ip_masquerade=false",
            "--opt",
            "com.docker.network.bridge.enable_icc=false",
            *label_argv,
            network,
        ]
    )
    try:
        network_id_created = network_created.decode("ascii").strip()
    except UnicodeDecodeError as error:
        raise RehearsalError("clone_creation_identity_invalid") from error
    if not HEX.fullmatch(network_id_created):
        raise RehearsalError("clone_creation_identity_invalid")
    creation_state["networkId"] = network_id_created
    _require_not_cancelled()
    try:
        custom_archive, custom_root = _postgres_custom_image_archive(
            docker,
            run_nonce,
            slot,
            creation_state,
        )
        _require_not_cancelled()
        container_created = _command(
            [
                docker,
                "run",
                "-d",
                "--name",
                container,
                "--network",
                network,
                "--user",
                "postgres",
                "--read-only",
                "--tmpfs",
                "/tmp:rw,noexec,nosuid,nodev,size=256m",
                "--tmpfs",
                f"/var/lib/postgresql/data:rw,noexec,nosuid,nodev,size=4g,uid={PINNED_POSTGRES_UID},gid={PINNED_POSTGRES_GID},mode=0700",
                "--tmpfs",
                f"/var/run/postgresql:rw,noexec,nosuid,nodev,size=16m,uid={PINNED_POSTGRES_UID},gid={PINNED_POSTGRES_GID},mode=3775",
                "--tmpfs",
                f"/etc/postgresql-custom:rw,noexec,nosuid,nodev,size=16m,uid={PINNED_POSTGRES_UID},gid={PINNED_POSTGRES_GID},mode=0755",
                *label_argv,
                "--cap-drop=ALL",
                "--security-opt=no-new-privileges",
                "-e",
                f"POSTGRES_PASSWORD={password}",
                "--entrypoint",
                "/bin/sh",
                IMAGE_REFERENCE,
                "-c",
                POSTGRES_START_COMMAND,
            ],
            timeout=120,
        )
        try:
            container_id_created = container_created.decode("ascii").strip()
        except UnicodeDecodeError as error:
            raise RehearsalError("clone_creation_identity_invalid") from error
        if not HEX.fullmatch(container_id_created):
            raise RehearsalError("clone_creation_identity_invalid")
        creation_state["containerId"] = container_id_created
        _require_not_cancelled()
        unpacked = subprocess.run(
            [docker, "exec", "--interactive", container, "/bin/tar", "-C", "/etc/postgresql-custom", "-xf", "-"],
            input=custom_archive,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=_remaining_timeout(60, cleanup=_IN_CLEANUP),
            check=False,
            env=_docker_environment(),
        )
        if unpacked.returncode != 0 or unpacked.stdout or unpacked.stderr:
            raise RehearsalError("postgres_custom_source_invalid")
        _require_not_cancelled()
        unused_readback, readback_root = _postgres_custom_archive(docker, "exec", container)
        if readback_root != custom_root:
            raise RehearsalError("postgres_custom_source_invalid")
        _require_not_cancelled()
        hardened = subprocess.run(
            [
                docker,
                "exec",
                "--interactive",
                container,
                "/bin/sh",
                "-c",
                f"umask 077; /bin/cat > {HARDENED_HBA_PATH}",
            ],
            input=HARDENED_HBA,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=_remaining_timeout(30, cleanup=_IN_CLEANUP),
            check=False,
            env=_docker_environment(),
        )
        if (
            hardened.returncode != 0
            or hardened.stdout
            or hardened.stderr
            or _sha256_bytes(HARDENED_HBA) != HARDENED_HBA_SHA256
        ):
            raise RehearsalError("postgres_hba_hardening_failed")
        _require_not_cancelled()
        _command(
            [docker, "exec", container, "/bin/sh", "-c", "umask 077; : > /etc/postgresql-custom/.tzudong-ready"],
            timeout=30,
        )
    except Exception:
        raise
    if (
        _command([docker, "exec", container, "id", "-u", "postgres"], timeout=30)
        != (PINNED_POSTGRES_UID + "\n").encode("ascii")
        or _command([docker, "exec", container, "id", "-g", "postgres"], timeout=30)
        != (PINNED_POSTGRES_GID + "\n").encode("ascii")
    ):
        raise RehearsalError("pinned_image_postgres_identity_invalid")
    nc_identity = _command(
        [
            docker,
            "exec",
            container,
            "/bin/sh",
            "-c",
            "test \"$(command -v nc)\" = /usr/bin/nc && "
            "test \"$(readlink /usr/bin/nc)\" = /bin/busybox && "
            "test \"$(readlink -f /usr/bin/nc)\" = /bin/busybox && "
            "stat -Lc '%f:%u:%g:%s' /usr/bin/nc && sha256sum /bin/busybox",
        ],
        timeout=30,
    )
    if nc_identity != (
        b"81ed:0:0:804616\n"
        b"f3547b3d78d08a028a4833ddb83b77cf012838c078bfd2b76355f53d1d8bba62  /bin/busybox\n"
    ):
        raise RehearsalError("pinned_image_relay_tool_invalid")
    creation_state["relayToolSha256"] = _sha256_bytes(nc_identity)
    _require_not_cancelled()
    _wait_for_clone(docker, container, password)
    _require_not_cancelled()
    inspected = _docker_json(docker, "inspect", container)
    network_inspected = _docker_json(docker, "network", "inspect", network)
    if (
        type(inspected) is not list
        or len(inspected) != 1
        or type(inspected[0]) is not dict
        or type(network_inspected) is not list
        or len(network_inspected) != 1
        or type(network_inspected[0]) is not dict
    ):
        raise RehearsalError("clone_custody_invalid")
    item = inspected[0]
    network_item = network_inspected[0]
    config = item.get("Config")
    host = item.get("HostConfig")
    network_settings = item.get("NetworkSettings")
    if type(config) is not dict or type(host) is not dict or type(network_settings) is not dict:
        raise RehearsalError("clone_custody_invalid")
    ports = network_settings.get("Ports")
    binding = ports.get("5432/tcp") if type(ports) is dict else None
    requested_ports = host.get("PortBindings")
    requested_binding = requested_ports.get("5432/tcp") if type(requested_ports) is dict else None
    container_id = item.get("Id")
    network_id = network_item.get("Id")
    container_networks = network_settings.get("Networks")
    container_network = container_networks.get(network) if type(container_networks) is dict else None
    network_containers = network_item.get("Containers")
    network_container = network_containers.get(container_id) if type(network_containers) is dict and type(container_id) is str else None
    if (
        type(container_id) is not str
        or not HEX.fullmatch(container_id)
        or type(network_id) is not str
        or not HEX.fullmatch(network_id)
        or container_id != creation_state.get("containerId")
        or network_id != creation_state.get("networkId")
        or item.get("Name") != f"/{container}"
        or item.get("Image") != IMAGE_ID
        or config.get("Image") != IMAGE_REFERENCE
        or config.get("User") != "postgres"
        or config.get("Entrypoint") != ["/bin/sh"]
        or config.get("Cmd") != ["-c", POSTGRES_START_COMMAND]
        or config.get("Volumes") not in (None, {})
        or config.get("ExposedPorts") != {"5432/tcp": {}}
        or not _require_expected_password_environment(config, password)
        or type(config.get("Labels")) is not dict
        or any(config["Labels"].get(key) != value for key, value in labels.items())  # type: ignore[index]
        or host.get("CapDrop") != ["ALL"]
        or host.get("CapAdd") not in (None, [])
        or host.get("SecurityOpt") != ["no-new-privileges"]
        or host.get("NetworkMode") != network
        or host.get("Privileged") is not False
        or host.get("PublishAllPorts") is not False
        or host.get("AutoRemove") is not False
        or host.get("ReadonlyRootfs") is not True
        or host.get("Binds") not in (None, [])
        or host.get("Mounts") not in (None, [])
        or type(host.get("Tmpfs")) is not dict
        or host["Tmpfs"] != {  # type: ignore[comparison-overlap]
            "/tmp": "rw,noexec,nosuid,nodev,size=256m",
            "/var/lib/postgresql/data": (
                "rw,noexec,nosuid,nodev,size=4g,"
                f"uid={PINNED_POSTGRES_UID},gid={PINNED_POSTGRES_GID},mode=0700"
            ),
            "/var/run/postgresql": (
                "rw,noexec,nosuid,nodev,size=16m,"
                f"uid={PINNED_POSTGRES_UID},gid={PINNED_POSTGRES_GID},mode=3775"
            ),
            "/etc/postgresql-custom": (
                "rw,noexec,nosuid,nodev,size=16m,"
                f"uid={PINNED_POSTGRES_UID},gid={PINNED_POSTGRES_GID},mode=0755"
            ),
        }
        or type(item.get("Mounts")) is not list
        or len(item["Mounts"]) != 0  # type: ignore[arg-type]
        or requested_ports not in (None, {})
        or requested_binding is not None
        or type(ports) is not dict
        or set(ports) != {"5432/tcp"}
        or binding is not None
        or network_item.get("Name") != network
        or network_item.get("Driver") != "bridge"
        or network_item.get("Internal") is not True
        or network_item.get("Attachable") is not False
        or network_item.get("Options") != {
            "com.docker.network.bridge.enable_ip_masquerade": "false",
            "com.docker.network.bridge.enable_icc": "false",
        }
        or type(network_item.get("Labels")) is not dict
        or any(network_item["Labels"].get(key) != value for key, value in labels.items())  # type: ignore[index]
        or type(network_item.get("Containers")) is not dict
        or set(network_item["Containers"]) != {container_id}  # type: ignore[arg-type]
        or type(container_networks) is not dict
        or set(container_networks) != {network}
        or type(container_network) is not dict
        or type(network_container) is not dict
        or container_network.get("NetworkID") != network_id
        or container_network.get("EndpointID") != network_container.get("EndpointID")
        or container_network.get("MacAddress") != network_container.get("MacAddress")
        or container_network.get("IPAddress") != network_container.get("IPv4Address", "").split("/", 1)[0]
    ):
        raise RehearsalError("clone_custody_invalid")
    relay = _CloneRelay(docker, container_id)
    creation_state["relay"] = relay
    port = relay.port
    clone_nonce = secrets.token_hex(16)
    directory = destination / f"clone-{slot}"
    _secure_mkdir(directory, f"clone_{slot}_directory")
    service = directory / "pg_service.conf"
    restore_receipt = directory / "restore.json"
    service_raw = (
        "[g035-local]\n"
        "host=127.0.0.1\n"
        f"port={port}\n"
        "dbname=g035_local\n"
        f"user={POSTGRES_ADMIN_ROLE}\n"
        f"password={password}\n"
        "sslmode=disable\n"
        f"application_name=g035-local-{slot}-{clone_nonce[:16]}\n"
    ).encode("ascii")
    service_info = _secure_write(service, service_raw, f"clone_{slot}_service")
    return {
        "slot": slot,
        "runNonce": run_nonce,
        "cloneNonce": clone_nonce,
        "container": container,
        "network": network,
        "sourceHelper": creation_state["sourceHelperName"],
        "containerId": container_id,
        "networkId": network_id,
        "port": port,
        "relay": relay,
        "password": password,
        "service": service,
        "directory": directory,
        "serviceIdentity": (service_info.st_dev, service_info.st_ino),
        "restoreReceipt": restore_receipt,
        "networkEndpointSha256": _digest({
            "endpointId": container_network["EndpointID"],
            "macAddress": container_network["MacAddress"],
            "ipAddress": container_network["IPAddress"],
        }),
        "postgresCustomTreeRoot": custom_root,
        "relayToolIdentitySha256": creation_state["relayToolSha256"],
    }


def _recheck_clone_isolation(docker: str, clone: dict[str, object]) -> None:
    inspected = _docker_json(docker, "inspect", str(clone["container"]))
    network = _docker_json(docker, "network", "inspect", str(clone["network"]))
    if (
        type(inspected) is not list
        or len(inspected) != 1
        or type(inspected[0]) is not dict
        or inspected[0].get("Id") != clone["containerId"]
        or type(network) is not list
        or len(network) != 1
        or type(network[0]) is not dict
        or network[0].get("Id") != clone["networkId"]
    ):
        raise RehearsalError("clone_isolation_changed")
    item = inspected[0]
    network_item = network[0]
    config = item.get("Config")
    host = item.get("HostConfig")
    state = item.get("State")
    settings = item.get("NetworkSettings")
    networks = settings.get("Networks") if type(settings) is dict else None
    endpoint = networks.get(str(clone["network"])) if type(networks) is dict else None
    ports = settings.get("Ports") if type(settings) is dict else None
    binding = ports.get("5432/tcp") if type(ports) is dict else None
    requested_ports = host.get("PortBindings") if type(host) is dict else None
    network_containers = network_item.get("Containers")
    network_endpoint = (
        network_containers.get(str(clone["containerId"]))
        if type(network_containers) is dict
        else None
    )
    labels = {
        "io.tzudong.g035-dual-restore": str(clone["runNonce"]),
        "io.tzudong.g035-dual-restore.slot": str(clone["slot"]),
    }
    expected_tmpfs = {
        "/tmp": "rw,noexec,nosuid,nodev,size=256m",
        "/var/lib/postgresql/data": (
            "rw,noexec,nosuid,nodev,size=4g,"
            f"uid={PINNED_POSTGRES_UID},gid={PINNED_POSTGRES_GID},mode=0700"
        ),
        "/var/run/postgresql": (
            "rw,noexec,nosuid,nodev,size=16m,"
            f"uid={PINNED_POSTGRES_UID},gid={PINNED_POSTGRES_GID},mode=3775"
        ),
        "/etc/postgresql-custom": (
            "rw,noexec,nosuid,nodev,size=16m,"
            f"uid={PINNED_POSTGRES_UID},gid={PINNED_POSTGRES_GID},mode=0755"
        ),
    }
    if (
        type(config) is not dict
        or type(host) is not dict
        or type(state) is not dict
        or state.get("Running") is not True
        or type(state.get("Health")) is not dict
        or state["Health"].get("Status") != "healthy"
        or item.get("Name") != f"/{clone['container']}"
        or item.get("Image") != IMAGE_ID
        or config.get("Image") != IMAGE_REFERENCE
        or config.get("User") != "postgres"
        or config.get("Entrypoint") != ["/bin/sh"]
        or config.get("Cmd") != ["-c", POSTGRES_START_COMMAND]
        or config.get("Volumes") not in (None, {})
        or config.get("ExposedPorts") != {"5432/tcp": {}}
        or not _require_expected_password_environment(config, str(clone["password"]))
        or type(config.get("Labels")) is not dict
        or any(config["Labels"].get(key) != value for key, value in labels.items())
        or host.get("CapDrop") != ["ALL"]
        or host.get("CapAdd") not in (None, [])
        or host.get("SecurityOpt") != ["no-new-privileges"]
        or host.get("NetworkMode") != clone["network"]
        or host.get("Privileged") is not False
        or host.get("PublishAllPorts") is not False
        or host.get("AutoRemove") is not False
        or host.get("ReadonlyRootfs") is not True
        or host.get("Binds") not in (None, [])
        or host.get("Mounts") not in (None, [])
        or host.get("Tmpfs") != expected_tmpfs
        or item.get("Mounts") != []
        or requested_ports not in (None, {})
        or type(ports) is not dict
        or set(ports) != {"5432/tcp"}
        or binding is not None
        or type(networks) is not dict
        or set(networks) != {clone["network"]}
        or type(endpoint) is not dict
        or endpoint.get("NetworkID") != clone["networkId"]
        or network_item.get("Name") != clone["network"]
        or network_item.get("Driver") != "bridge"
        or network_item.get("Internal") is not True
        or network_item.get("Attachable") is not False
        or network_item.get("Options") != {
            "com.docker.network.bridge.enable_ip_masquerade": "false",
            "com.docker.network.bridge.enable_icc": "false",
        }
        or type(network_item.get("Labels")) is not dict
        or any(network_item["Labels"].get(key) != value for key, value in labels.items())
        or type(network_containers) is not dict
        or set(network_containers) != {clone["containerId"]}
        or type(network_endpoint) is not dict
        or endpoint.get("EndpointID") != network_endpoint.get("EndpointID")
        or endpoint.get("MacAddress") != network_endpoint.get("MacAddress")
        or endpoint.get("IPAddress")
        != str(network_endpoint.get("IPv4Address", "")).split("/", 1)[0]
        or _digest({
        "endpointId": endpoint.get("EndpointID"),
        "macAddress": endpoint.get("MacAddress"),
        "ipAddress": endpoint.get("IPAddress"),
        }) != clone["networkEndpointSha256"]
    ):
        raise RehearsalError("clone_isolation_changed")
    relay = clone.get("relay")
    if (
        not isinstance(relay, _CloneRelay)
        or relay.closed
        or relay.listener.fileno() < 0
        or relay.listener.getsockname() != ("127.0.0.1", clone["port"])
        or relay.stop.is_set()
    ):
        raise RehearsalError("clone_isolation_changed")


def _resource_labels(
    docker: str,
    kind: str,
    name: str,
) -> tuple[str, dict[str, object]] | None:
    names = _docker_names(docker, kind)
    if name not in names:
        return None
    try:
        inspected = (
            _docker_json(docker, "inspect", name)
            if kind == "container"
            else _docker_json(docker, "network", "inspect", name)
        )
    except RehearsalError:
        raise RehearsalError("clone_cleanup_failed") from None
    if type(inspected) is not list or len(inspected) != 1 or type(inspected[0]) is not dict:
        raise RehearsalError("clone_cleanup_failed")
    item = inspected[0]
    config = item.get("Config")
    labels = config.get("Labels") if kind == "container" and type(config) is dict else item.get("Labels")
    identifier = item.get("Id")
    if type(identifier) is not str or not HEX.fullmatch(identifier) or type(labels) is not dict:
        raise RehearsalError("clone_cleanup_failed")
    return identifier, labels


def _remove_owned_resource(
    docker: str,
    kind: str,
    name: str,
    labels: dict[str, str],
    *,
    expected_id: str | None,
) -> bool:
    try:
        _recheck_pinned_docker_socket()
    except RehearsalError:
        return False
    observed = _resource_labels(docker, kind, name)
    if observed is None:
        return True
    identifier, actual_labels = observed
    if (
        expected_id is None
        or identifier != expected_id
        or any(actual_labels.get(key) != value for key, value in labels.items())
    ):
        return False
    argv = (
        [docker, "rm", "-f", identifier]
        if kind == "container"
        else [docker, "network", "rm", identifier]
    )
    try:
        result = subprocess.run(
            argv,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=_remaining_timeout(60, cleanup=_IN_CLEANUP),
            check=False,
            env=_docker_environment(),
        )
    except (OSError, subprocess.SubprocessError):
        return False
    if result.returncode != 0 or result.stderr:
        return False
    try:
        return name not in _docker_names(docker, kind)
    except RehearsalError:
        return False


def _create_clone(
    docker: str,
    destination: Path,
    run_nonce: str,
    slot: int,
) -> dict[str, object]:
    global _IN_CLEANUP
    token = run_nonce[:20]
    container = f"tzudong-g035-{token}-{slot}-db"
    network = f"tzudong-g035-{token}-{slot}-net"
    labels = {
        "io.tzudong.g035-dual-restore": run_nonce,
        "io.tzudong.g035-dual-restore.slot": str(slot),
    }
    creation_state: dict[str, object] = {}
    try:
        return _create_clone_unchecked(docker, destination, run_nonce, slot, creation_state)
    except Exception as error:
        prior_cleanup = _IN_CLEANUP
        _IN_CLEANUP = True
        try:
            relay = creation_state.get("relay")
            relay_removed = relay.close() if isinstance(relay, _CloneRelay) else True
            helper_labels = creation_state.get("sourceHelperLabels")
            helper_removed = (
                _remove_owned_resource(
                    docker,
                    "container",
                    str(creation_state["sourceHelperName"]),
                    helper_labels,
                    expected_id=str(creation_state["sourceHelperId"]),
                )
                if (
                    "sourceHelperId" in creation_state
                    and type(helper_labels) is dict
                    and creation_state.get("sourceHelperRemoved") is not True
                )
                else _docker_absent(
                    docker,
                    "container",
                    f"tzudong-g035-{token}-{slot}-source",
                )
            )
            container_removed = (
                _remove_owned_resource(
                    docker,
                    "container",
                    container,
                    labels,
                    expected_id=str(creation_state["containerId"]),
                )
                if "containerId" in creation_state
                else _docker_absent(docker, "container", container)
            )
            network_removed = (
                _remove_owned_resource(
                    docker,
                    "network",
                    network,
                    labels,
                    expected_id=str(creation_state["networkId"]),
                )
                if "networkId" in creation_state
                else _docker_absent(docker, "network", network)
            )
        except RehearsalError as cleanup_error:
            raise RehearsalError("clone_cleanup_failed") from cleanup_error
        finally:
            _IN_CLEANUP = prior_cleanup
        service = destination / f"clone-{slot}" / "pg_service.conf"
        try:
            if service.exists() and not service.is_symlink():
                service_info = service.lstat()
                if stat.S_ISREG(service_info.st_mode) and service_info.st_uid == os.getuid():
                    service.unlink()
                else:
                    container_removed = False
        except OSError:
            container_removed = False
        if not helper_removed or not relay_removed or not container_removed or not network_removed:
            raise RehearsalError("clone_cleanup_failed") from error
        raise


def _restore_clone(
    clone: dict[str, object],
    *,
    python: str,
    repository_root: Path,
    commit: str,
    bootstrap: bytes,
    capture_receipt: Path,
    archive: Path,
    identity: bytearray,
    age: str,
    pg_restore: str,
) -> None:
    global _ACTIVE_RESTORE_PROCESS
    if os.name != "posix":
        raise RehearsalError("identity_channel_unavailable")
    read_fd, write_fd = os.pipe()
    process: subprocess.Popen[bytes] | None = None
    workspace_root = Path(clone["directory"]) / "restore-runtime"
    _secure_mkdir(workspace_root, f"clone_{clone['slot']}_restore_runtime")
    workspace_info = workspace_root.lstat()
    clone["plaintextWorkspace"] = workspace_root
    clone["plaintextWorkspaceIdentity"] = (workspace_info.st_dev, workspace_info.st_ino)
    child_environment = {
        "PATH": os.environ.get("PATH", ""),
        "HOME": os.fspath(workspace_root),
        "TMPDIR": os.fspath(workspace_root),
        "TMP": os.fspath(workspace_root),
        "TEMP": os.fspath(workspace_root),
    }
    try:
        os.set_inheritable(read_fd, True)
        argv = [
            python,
            "-I",
            "-B",
            "-",
            "--repository-root",
            os.fspath(repository_root),
            "--authorized-final-commit",
            commit,
            "--entrypoint",
            G035_ENTRYPOINT,
            "--",
            "restore-verify",
            "--dump",
            os.fspath(archive),
            "--capture-receipt",
            os.fspath(capture_receipt),
            "--restore-receipt",
            os.fspath(clone["restoreReceipt"]),
            "--service-file",
            os.fspath(clone["service"]),
            "--destination-service",
            "g035-local",
            "--identity-fd",
            str(read_fd),
            "--decrypt-command",
            age,
            "--pg-restore",
            pg_restore,
        ]
        previous_mask: set[signal.Signals] | None = None
        if hasattr(signal, "pthread_sigmask"):
            previous_mask = signal.pthread_sigmask(
                signal.SIG_BLOCK,
                {signal.SIGTERM, signal.SIGINT},
            )
        try:
            process = subprocess.Popen(
                argv,
                cwd=repository_root,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                pass_fds=(read_fd,),
                start_new_session=True,
                env=child_environment,
            )
            _ACTIVE_RESTORE_PROCESS = process
        finally:
            if previous_mask is not None:
                signal.pthread_sigmask(signal.SIG_SETMASK, previous_mask)
        if _CANCELLATION_REQUESTED:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except OSError:
                pass
        os.close(read_fd)
        read_fd = -1
        offset = 0
        view = memoryview(identity)
        while offset < len(view):
            offset += os.write(write_fd, view[offset:])
        view.release()
        os.close(write_fd)
        write_fd = -1
        local_deadline = time.monotonic() + RESTORE_TIMEOUT_SECONDS
        deadline = (
            min(local_deadline, _WHOLE_DEADLINE)
            if _WHOLE_DEADLINE is not None
            else local_deadline
        )
        pending_input: bytes | None = bootstrap
        while True:
            try:
                _require_not_cancelled()
                communicate_timeout = _remaining_timeout(
                    min(1, max(0.001, deadline - time.monotonic()))
                )
            except RehearsalError:
                communicate_timeout = 0
            try:
                if communicate_timeout > 0:
                    stdout, stderr = process.communicate(
                        input=pending_input,
                        timeout=communicate_timeout,
                    )
                    break
            except subprocess.TimeoutExpired:
                pending_input = None
                if (
                    not _CANCELLATION_REQUESTED
                    and time.monotonic() < deadline
                    and (_WHOLE_DEADLINE is None or time.monotonic() < _WHOLE_DEADLINE)
                ):
                    continue
            _request_cancellation(signal.SIGTERM, None)
            try:
                stdout, stderr = process.communicate(
                    timeout=_remaining_timeout(10, cleanup=True)
                )
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except (OSError, ProcessLookupError):
                    pass
                try:
                    stdout, stderr = process.communicate(
                        timeout=_remaining_timeout(10, cleanup=True)
                    )
                except subprocess.TimeoutExpired as error:
                    raise RehearsalError("restore_reap_failed") from error
            raise RehearsalError("restore_cancelled") from None
    except (OSError, subprocess.SubprocessError) as error:
        if process is not None and process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except (OSError, ProcessLookupError):
                pass
            try:
                process.communicate(timeout=_remaining_timeout(10, cleanup=True))
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except (OSError, ProcessLookupError):
                    pass
                try:
                    process.communicate(timeout=_remaining_timeout(10, cleanup=True))
                except subprocess.TimeoutExpired as reap_error:
                    raise RehearsalError("restore_reap_failed") from reap_error
        raise RehearsalError("restore_execution_failed") from error
    finally:
        if _ACTIVE_RESTORE_PROCESS is process:
            _ACTIVE_RESTORE_PROCESS = None
        if read_fd >= 0:
            os.close(read_fd)
        if write_fd >= 0:
            os.close(write_fd)
    if _CANCELLATION_REQUESTED:
        raise RehearsalError("restore_cancelled")
    if process is None or process.returncode != 0 or stdout or stderr:
        raise RehearsalError("restore_execution_failed")


def _database_identity(docker: str, container: str, password: str) -> tuple[str, str]:
    sql = (
        "SELECT pg_catalog.json_build_array("
        "(pg_catalog.pg_control_system()).system_identifier::text,"
        "(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=current_database()),"
        "current_setting('server_version_num'),current_database())::text"
    )
    raw = _command(
        [
            docker,
            "exec",
            "--env",
            f"PGPASSWORD={password}",
            container,
            "psql",
            "-h",
            "127.0.0.1",
            "-U",
            POSTGRES_ADMIN_ROLE,
            "-d",
            "g035_local",
            "--no-psqlrc",
            "--tuples-only",
            "--no-align",
            "--set",
            "ON_ERROR_STOP=1",
            "--command",
            sql,
        ],
        timeout=60,
    )
    try:
        value = json.loads(raw.decode("ascii").strip(), parse_constant=_reject_constant)
    except (UnicodeDecodeError, json.JSONDecodeError, RehearsalError) as error:
        raise RehearsalError("database_identity_invalid") from error
    if (
        type(value) is not list
        or len(value) != 4
        or any(type(item) is not str or not item for item in value)
        or not value[0].isdigit()
        or not value[1].isdigit()
        or not SERVER_VERSION.fullmatch(value[2])
        or value[3] != "g035_local"
    ):
        raise RehearsalError("database_identity_invalid")
    return _digest(value), value[2]


def _runtime_configuration(docker: str, container: str) -> dict[str, object]:
    sql = b"""SELECT pg_catalog.json_build_object(
'configFile', current_setting('config_file'),
'dataDirectory', current_setting('data_directory'),
'hbaFile', current_setting('hba_file'),
'unixSocketDirectories', current_setting('unix_socket_directories'),
'sessionPreloadLibraries', current_setting('session_preload_libraries'),
'serverVersionNum', current_setting('server_version_num'),
'fileSettingsEntries', (SELECT count(*) FROM pg_catalog.pg_file_settings),
'fileSettingsErrors', (SELECT count(*) FROM pg_catalog.pg_file_settings WHERE error IS NOT NULL),
'fileSettingsNotApplied', (SELECT count(*) FROM pg_catalog.pg_file_settings WHERE NOT applied),
'criticalSources', (
 SELECT pg_catalog.json_agg(pg_catalog.json_build_object(
  'sourcefile', sourcefile, 'sourceline', sourceline, 'name', name,
  'applied', applied, 'errorFree', error IS NULL
 ) ORDER BY CASE sourcefile
  WHEN '/etc/postgresql/postgresql.conf' THEN 1
  WHEN '/etc/postgresql-custom/wal-g.conf' THEN 2
  WHEN '/etc/postgresql-custom/supautils.conf' THEN 3
  ELSE 4 END, sourceline, name)
 FROM pg_catalog.pg_file_settings
 WHERE (sourcefile='/etc/postgresql/postgresql.conf' AND name IN
  ('data_directory','hba_file','unix_socket_directories','session_preload_libraries'))
 OR (sourcefile='/etc/postgresql-custom/wal-g.conf' AND name='hot_standby')
 OR (sourcefile='/etc/postgresql-custom/supautils.conf')
),
'criticalSourceCount', (SELECT count(*) FROM pg_catalog.pg_file_settings
 WHERE (sourcefile='/etc/postgresql/postgresql.conf' AND name IN
  ('data_directory','hba_file','unix_socket_directories','session_preload_libraries'))
 OR (sourcefile='/etc/postgresql-custom/wal-g.conf' AND name='hot_standby')
 OR (sourcefile='/etc/postgresql-custom/supautils.conf')),
'hbaBytes', (pg_catalog.pg_stat_file(current_setting('hba_file'))).size,
'hbaSha256', encode(pg_catalog.sha256(pg_catalog.pg_read_binary_file(
 current_setting('hba_file'), 0, (pg_catalog.pg_stat_file(current_setting('hba_file'))).size, false
)), 'hex'),
'configFiles', (SELECT pg_catalog.json_agg(pg_catalog.json_build_object(
 'path', path, 'bytes', expected_bytes,
 'sha256', encode(pg_catalog.sha256(pg_catalog.pg_read_binary_file(
  path, 0, (pg_catalog.pg_stat_file(path)).size, false
 )), 'hex')
) ORDER BY ordinal)
FROM (VALUES
 (1, '/etc/postgresql/postgresql.conf', 28278),
 (2, '/etc/postgresql-custom/wal-g.conf', 463),
 (3, '/etc/postgresql-custom/read-replica.conf', 218),
 (4, '/etc/postgresql-custom/supautils.conf', 4947),
 (5, '/etc/postgresql-custom/tzudong-pg_hba.conf', 90)
) AS expected(ordinal, path, expected_bytes)
WHERE (pg_catalog.pg_stat_file(path)).size=expected_bytes)
)::text;\n"""
    try:
        result = subprocess.run(
            [
                docker,
                "exec",
                "--interactive",
                container,
                "psql",
                "-U",
                POSTGRES_ADMIN_ROLE,
                "-d",
                "g035_local",
                "--no-psqlrc",
                "--tuples-only",
                "--no-align",
                "--set",
                "ON_ERROR_STOP=1",
                "--file",
                "-",
            ],
            input=sql,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=_remaining_timeout(60, cleanup=_IN_CLEANUP),
            check=False,
            env=_docker_environment(),
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise RehearsalError("runtime_configuration_invalid") from error
    if result.returncode != 0 or result.stderr or not 1 <= len(result.stdout) <= 4096:
        raise RehearsalError("runtime_configuration_invalid")
    try:
        value = json.loads(
            result.stdout.decode("ascii").strip(),
            object_pairs_hook=_json_pairs,
            parse_constant=_reject_constant,
        )
    except (UnicodeDecodeError, json.JSONDecodeError, RehearsalError) as error:
        raise RehearsalError("runtime_configuration_invalid") from error
    required = {
        "configFile",
        "dataDirectory",
        "hbaFile",
        "unixSocketDirectories",
        "sessionPreloadLibraries",
        "serverVersionNum",
        "fileSettingsEntries",
        "fileSettingsErrors",
        "fileSettingsNotApplied",
        "criticalSources",
        "criticalSourceCount",
        "hbaBytes",
        "hbaSha256",
        "configFiles",
    }
    if (
        type(value) is not dict
        or set(value) != required
        or value.get("configFile") != "/etc/postgresql/postgresql.conf"
        or value.get("dataDirectory") != "/var/lib/postgresql/data"
        or value.get("hbaFile") != HARDENED_HBA_PATH
        or value.get("unixSocketDirectories") != "/var/run/postgresql"
        or value.get("sessionPreloadLibraries") != "supautils"
        or value.get("serverVersionNum") != "170006"
        or value.get("fileSettingsEntries") != 61
        or value.get("fileSettingsErrors") != 1
        or value.get("fileSettingsNotApplied") != 1
        or value.get("criticalSourceCount") != 16
        or value.get("criticalSources") != [
            {
                "sourcefile": path,
                "sourceline": line,
                "name": name,
                "applied": path != "/etc/postgresql/postgresql.conf" or name != "hba_file",
                "errorFree": path != "/etc/postgresql/postgresql.conf" or name != "hba_file",
            }
            for path, line, name in POSTGRES_CRITICAL_SOURCES
        ]
        or value.get("hbaBytes") != len(HARDENED_HBA)
        or value.get("hbaSha256") != HARDENED_HBA_SHA256
        or value.get("configFiles") != [
            {"path": path, "bytes": size, "sha256": digest}
            for path, size, digest in POSTGRES_CONFIG_FILES
        ]
    ):
        raise RehearsalError("runtime_configuration_invalid")
    critical_sources = value.pop("criticalSources")
    config_files = value["configFiles"]
    body: dict[str, object] = {
        "contract": "pinned-postgres-runtime-v1",
        **value,
        "criticalSourceSha256": _digest(critical_sources),
        "postgresCustomTreeRoot": POSTGRES_CUSTOM_TREE_ROOT,
        "configFileSetSha256": _digest(config_files),
    }
    return {**body, "runtimeConfigurationSha256": _digest(body)}


def _validate_runtime_configuration(value: object) -> dict[str, object]:
    if type(value) is not dict:
        raise RehearsalError("runtime_configuration_invalid")
    body = dict(value)
    root = body.pop("runtimeConfigurationSha256", None)
    expected_keys = {
        "contract", "configFile", "dataDirectory", "hbaFile",
        "unixSocketDirectories", "sessionPreloadLibraries", "serverVersionNum",
        "fileSettingsEntries", "fileSettingsErrors", "fileSettingsNotApplied",
        "criticalSourceSha256", "criticalSourceCount", "hbaBytes", "hbaSha256",
        "postgresCustomTreeRoot", "configFileSetSha256", "configFiles",
    }
    if (
        set(body) != expected_keys
        or body.get("contract") != "pinned-postgres-runtime-v1"
        or body.get("configFile") != "/etc/postgresql/postgresql.conf"
        or body.get("dataDirectory") != "/var/lib/postgresql/data"
        or body.get("hbaFile") != HARDENED_HBA_PATH
        or body.get("unixSocketDirectories") != "/var/run/postgresql"
        or body.get("sessionPreloadLibraries") != "supautils"
        or body.get("serverVersionNum") != "170006"
        or body.get("fileSettingsEntries") != 61
        or body.get("fileSettingsErrors") != 1
        or body.get("fileSettingsNotApplied") != 1
        or body.get("criticalSourceCount") != 16
        or body.get("criticalSourceSha256") != POSTGRES_CRITICAL_SOURCE_SHA256
        or body.get("hbaBytes") != len(HARDENED_HBA)
        or body.get("hbaSha256") != HARDENED_HBA_SHA256
        or body.get("postgresCustomTreeRoot") != POSTGRES_CUSTOM_TREE_ROOT
        or body.get("configFileSetSha256") != POSTGRES_CONFIG_FILE_SET_SHA256
        or body.get("configFiles") != [
            {"path": path, "bytes": size, "sha256": digest}
            for path, size, digest in POSTGRES_CONFIG_FILES
        ]
        or type(root) is not str
        or root != _digest(body)
    ):
        raise RehearsalError("runtime_configuration_invalid")
    return value


def _restore_run_receipt_id(
    source_commit: str,
    capture_receipt_sha256: str,
    clone: dict[str, object],
) -> str:
    payload = {
        "domain": "local-dual-restore-run-v2",
        "sourceCommit": source_commit,
        "captureReceiptSha256": capture_receipt_sha256,
        **{key: value for key, value in clone.items() if key != "restoreRunReceiptId"},
    }
    return _digest(payload)


def _public_clone_evidence(
    clone: dict[str, object],
    restored: dict[str, object],
    database_identity_sha256: str,
    server_version: str,
    source_commit: str,
    capture_receipt_sha256: str,
) -> dict[str, object]:
    slot = clone["slot"]
    relative = f"clone-{slot}/restore.json"
    evidence: dict[str, object] = {
        "slot": slot,
        "cloneNonce": clone["cloneNonce"],
        "containerName": clone["container"],
        "containerNameSha256": _sha256_bytes(str(clone["container"]).encode("ascii")),
        "containerIdSha256": _sha256_bytes(str(clone["containerId"]).encode("ascii")),
        "networkName": clone["network"],
        "networkNameSha256": _sha256_bytes(str(clone["network"]).encode("ascii")),
        "networkIdSha256": _sha256_bytes(str(clone["networkId"]).encode("ascii")),
        "endpointSha256": _digest({"host": "127.0.0.1", "port": clone["port"]}),
        "databaseIdentitySha256": database_identity_sha256,
        "serverVersionNum": server_version,
        "restoreReceiptRelativePath": relative,
        "restoreReceiptFileIdentitySha256": restored["receiptFileIdentitySha256"],
        "restoreReceiptMtimeNs": restored["restoreReceiptMtimeNs"],
        "g035RestoreReceiptSha256": restored["receiptSha256"],
        "restoreReceiptBytesSha256": restored["receiptBytesSha256"],
        "runtimeConfiguration": clone["runtimeConfiguration"],
    }
    evidence["restoreRunReceiptId"] = _restore_run_receipt_id(
        source_commit,
        capture_receipt_sha256,
        evidence,
    )
    return evidence


def _comparison(fingerprints: dict[str, object]) -> dict[str, object]:
    value = {
        key: fingerprints[key]
        for key in (
            "ledgerCount",
            "ledgerSha256",
            "ledgerPairsSha256",
            "restorableCatalogSha256",
            "managedCatalogSha256",
            "managedMetadataSchemasPresent",
        )
    }
    return {**value, "comparisonSha256": _digest(value)}


def _cleanup_clones(docker: str, clones: Sequence[dict[str, object]]) -> dict[str, object]:
    operations_ok = True
    relays_absent = True
    service_absent = True
    plaintext_absent = True
    for clone in reversed(clones):
        container = str(clone["container"])
        network = str(clone["network"])
        labels = {
            "io.tzudong.g035-dual-restore": str(clone["runNonce"]),
            "io.tzudong.g035-dual-restore.slot": str(clone["slot"]),
        }
        relay = clone.get("relay")
        relays_absent = (
            isinstance(relay, _CloneRelay)
            and relay.close()
            and relay.closed
            and relays_absent
        )
        try:
            operations_ok = _remove_owned_resource(
                docker,
                "container",
                container,
                labels,
                expected_id=str(clone["containerId"]),
            ) and operations_ok
            operations_ok = _remove_owned_resource(
                docker,
                "network",
                network,
                labels,
                expected_id=str(clone["networkId"]),
            ) and operations_ok
        except RehearsalError:
            operations_ok = False
        service = Path(clone["service"])
        try:
            info = service.lstat()
            expected = clone["serviceIdentity"]
            if (
                service.is_symlink()
                or not stat.S_ISREG(info.st_mode)
                or (info.st_dev, info.st_ino) != expected
                or info.st_uid != os.getuid()
                or info.st_nlink != 1
                or stat.S_IMODE(info.st_mode) != 0o600
            ):
                service_absent = False
            else:
                service.unlink()
                if service.exists() or service.is_symlink():
                    service_absent = False
                else:
                    directory_fd = os.open(service.parent, os.O_RDONLY)
                    try:
                        os.fsync(directory_fd)
                    finally:
                        os.close(directory_fd)
        except FileNotFoundError:
            pass
        except OSError:
            service_absent = False
        service_absent = service_absent and not service.exists() and not service.is_symlink()
        workspace = clone.get("plaintextWorkspace")
        workspace_identity = clone.get("plaintextWorkspaceIdentity")
        if workspace is not None or workspace_identity is not None:
            if (
                not isinstance(workspace, Path)
                or type(workspace_identity) is not tuple
                or len(workspace_identity) != 2
                or any(type(value) is not int for value in workspace_identity)
            ):
                plaintext_absent = False
            elif workspace.exists() or workspace.is_symlink():
                plaintext_absent = _remove_owned_tree(
                    workspace,
                    workspace_identity,
                    f"clone_{clone['slot']}_restore_runtime",
                ) and plaintext_absent
            plaintext_absent = plaintext_absent and not workspace.exists() and not workspace.is_symlink()
    try:
        containers = set(_docker_names(docker, "container"))
        networks = set(_docker_names(docker, "network"))
        containers_absent = all(str(clone["container"]) not in containers for clone in clones)
        source_helpers_absent = all(
            str(clone["sourceHelper"]) not in containers for clone in clones
        )
        networks_absent = all(str(clone["network"]) not in networks for clone in clones)
    except RehearsalError:
        containers_absent = False
        source_helpers_absent = False
        networks_absent = False
    body: dict[str, object] = {
        "containerNames": [str(clone["container"]) for clone in clones],
        "containerNameSha256": [
            _sha256_bytes(str(clone["container"]).encode("ascii")) for clone in clones
        ],
        "sourceHelperNames": [str(clone["sourceHelper"]) for clone in clones],
        "sourceHelperNameSha256": [
            _sha256_bytes(str(clone["sourceHelper"]).encode("ascii")) for clone in clones
        ],
        "networkNames": [str(clone["network"]) for clone in clones],
        "networkNameSha256": [
            _sha256_bytes(str(clone["network"]).encode("ascii")) for clone in clones
        ],
        "operationsSucceeded": operations_ok,
        "relaysAbsent": relays_absent,
        "containersAbsent": containers_absent,
        "sourceHelpersAbsent": source_helpers_absent,
        "networksAbsent": networks_absent,
        "serviceFilesAbsent": service_absent,
        "plaintextWorkspacesAbsent": plaintext_absent,
    }
    body["cleanupReceiptSha256"] = _digest(body)
    if not all((
        operations_ok,
        relays_absent,
        containers_absent,
        source_helpers_absent,
        networks_absent,
        service_absent,
        plaintext_absent,
    )):
        raise RehearsalError("clone_cleanup_failed")
    return body


def _assemble_receipt(
    source: dict[str, object],
    capture: dict[str, object],
    comparison: dict[str, object],
    clones: list[dict[str, object]],
    cleanup: dict[str, object],
    observed_at_unix_seconds: int,
) -> dict[str, object]:
    body: dict[str, object] = {
        "schema": RECEIPT_SCHEMA,
        "status": RECEIPT_STATUS,
        "recoveryScope": "local_encrypted_capture_and_dual_restore",
        "hostedMutations": 0,
        "managedPitrUsed": False,
        "observedAtUnixSeconds": observed_at_unix_seconds,
        "source": {**source, "runtimeSourceRoot": capture["runtimeSourceRoot"]},
        "capture": {
            key: capture[key]
            for key in (
                "receiptSha256",
                "receiptBytesSha256",
                "receiptFileIdentitySha256",
                "archiveSha256",
                "archiveBytes",
                "archiveFileIdentitySha256",
                "captureReceiptMtimeNs",
                "archiveMtimeNs",
                "manifestSha256",
            )
        },
        "image": {
            "reference": IMAGE_REFERENCE,
            "id": IMAGE_ID,
        },
        "comparison": comparison,
        "clones": clones,
        "cleanup": cleanup,
    }
    return {**body, "receiptSha256": _digest(body)}


def _relative_restore_path(parent: Path, value: object, slot: int) -> Path:
    expected = f"clone-{slot}/restore.json"
    if type(value) is not str or value != expected:
        raise RehearsalError("dual_receipt_invalid")
    pure = PurePosixPath(value)
    if pure.is_absolute() or any(part in ("", ".", "..") for part in pure.parts):
        raise RehearsalError("dual_receipt_invalid")
    directory = parent / pure.parts[0]
    _restrictive_directory(directory, f"clone_{slot}_directory")
    path = directory / pure.parts[1]
    try:
        resolved = path.resolve(strict=True)
    except OSError as error:
        raise RehearsalError("dual_receipt_invalid") from error
    if resolved != path or resolved.parent != directory:
        raise RehearsalError("dual_receipt_invalid")
    return path


def validate_dual_restore_receipt(
    receipt_path: Path,
    capture_path: Path,
    archive_path: Path,
    repository_root: Path,
    authorized_final_commit: str,
    *,
    docker_binary: str | None = None,
) -> dict[str, object]:
    """Validate the aggregate receipt and both retained G035 receipts."""
    evidence_paths = (receipt_path, capture_path, archive_path)
    if any(not path.is_absolute() for path in evidence_paths):
        raise RehearsalError("evidence_path_invalid")
    try:
        resolved_paths = tuple(path.resolve(strict=True) for path in evidence_paths)
    except OSError as error:
        raise RehearsalError("evidence_path_invalid") from error
    if resolved_paths != evidence_paths or any(
        repository_root == path or repository_root in path.parents for path in evidence_paths
    ):
        raise RehearsalError("evidence_path_invalid")
    source = _source_binding(
        repository_root,
        authorized_final_commit,
        require_detached=False,
    )
    if (
        set(source) != {"repositoryCommit", "producerSourceSha256"}
        or source.get("repositoryCommit") != authorized_final_commit
        or type(source.get("producerSourceSha256")) is not str
        or not HEX.fullmatch(source["producerSourceSha256"])
    ):
        raise RehearsalError("source_binding_invalid")
    capture = _validate_capture(capture_path, archive_path, authorized_final_commit)
    receipt, raw, unused_info = _read_json_receipt(receipt_path, "dual_receipt")
    required = {
        "schema",
        "status",
        "recoveryScope",
        "hostedMutations",
        "managedPitrUsed",
        "observedAtUnixSeconds",
        "source",
        "capture",
        "image",
        "comparison",
        "clones",
        "cleanup",
        "receiptSha256",
    }
    body = dict(receipt)
    receipt_sha = body.pop("receiptSha256", None)
    if (
        set(receipt) != required
        or receipt.get("schema") != RECEIPT_SCHEMA
        or receipt.get("status") != RECEIPT_STATUS
        or receipt.get("recoveryScope") != "local_encrypted_capture_and_dual_restore"
        or receipt.get("hostedMutations") != 0
        or receipt.get("managedPitrUsed") is not False
        or type(receipt.get("observedAtUnixSeconds")) is not int
        or not 1_700_000_000 <= receipt["observedAtUnixSeconds"] <= int(time.time()) + 300
        or receipt.get("image") != {"reference": IMAGE_REFERENCE, "id": IMAGE_ID}
        or type(receipt_sha) is not str
        or not HEX.fullmatch(receipt_sha)
        or receipt_sha != _digest(body)
    ):
        raise RehearsalError("dual_receipt_invalid")
    recorded_source = receipt.get("source")
    if type(recorded_source) is not dict or set(recorded_source) != {
        "repositoryCommit", "producerSourceSha256", "runtimeSourceRoot", "docker", "tools",
    }:
        raise RehearsalError("dual_receipt_invalid")
    recorded_tools = recorded_source.get("tools")
    expected_tools = {
        name: _expected_tool_binding(name)
        for name in ("python", "docker", "age", "pgRestore")
    }
    if recorded_tools != expected_tools:
        raise RehearsalError("toolchain_identity_invalid")
    recorded_docker = recorded_source.get("docker")
    docker_keys = {
        "context", "endpointSha256", "socketIdentitySha256", "clientIdentitySha256",
        "serverIdentitySha256", "clientVersion", "serverVersion", "binarySha256",
        "identityRoot",
    }
    if (
        type(recorded_docker) is not dict
        or set(recorded_docker) != docker_keys
        or type(recorded_docker.get("context")) is not str
        or any(
            type(recorded_docker.get(key)) is not str or not HEX.fullmatch(recorded_docker[key])
            for key in (
                "endpointSha256", "socketIdentitySha256", "clientIdentitySha256",
                "serverIdentitySha256", "binarySha256", "identityRoot",
            )
        )
        or any(type(recorded_docker.get(key)) is not str or not recorded_docker[key] for key in ("clientVersion", "serverVersion"))
        or recorded_docker["identityRoot"]
        != _digest({key: recorded_docker[key] for key in docker_keys if key != "identityRoot"})
    ):
        raise RehearsalError("docker_daemon_identity_invalid")
    live_docker: dict[str, object] = recorded_docker
    canonical_docker: str | None = None
    if docker_binary is not None:
        canonical_docker = _binary(docker_binary, "docker")
        live_docker = _local_docker_binding(canonical_docker)
        _validate_image(canonical_docker)
        if live_docker != recorded_docker:
            raise RehearsalError("docker_daemon_identity_invalid")
    expected_source = {
        **source,
        "runtimeSourceRoot": capture["runtimeSourceRoot"],
        "docker": live_docker,
        "tools": expected_tools,
    }
    expected_capture = {
        key: capture[key]
        for key in (
            "receiptSha256",
            "receiptBytesSha256",
            "receiptFileIdentitySha256",
            "archiveSha256",
            "archiveBytes",
            "archiveFileIdentitySha256",
            "captureReceiptMtimeNs",
            "archiveMtimeNs",
            "manifestSha256",
        )
    }
    if receipt.get("source") != expected_source or receipt.get("capture") != expected_capture:
        raise RehearsalError("dual_receipt_invalid")
    observed_at = receipt["observedAtUnixSeconds"]
    capture_seconds = expected_capture["captureReceiptMtimeNs"] // 1_000_000_000
    archive_seconds = expected_capture["archiveMtimeNs"] // 1_000_000_000
    newest_evidence_seconds = max(capture_seconds, archive_seconds)
    now = int(time.time())
    if (
        any(seconds <= 1_700_000_000 or seconds > observed_at for seconds in (capture_seconds, archive_seconds))
        or any(observed_at - seconds > MAX_EVIDENCE_AGE_SECONDS for seconds in (capture_seconds, archive_seconds))
        or now - observed_at > MAX_EVIDENCE_AGE_SECONDS
    ):
        raise RehearsalError("dual_receipt_freshness_invalid")
    clones = receipt.get("clones")
    if type(clones) is not list or len(clones) != 2 or any(type(clone) is not dict for clone in clones):
        raise RehearsalError("dual_receipt_invalid")
    expected_clone_keys = {
        "slot",
        "cloneNonce",
        "containerName",
        "containerNameSha256",
        "containerIdSha256",
        "networkName",
        "networkNameSha256",
        "networkIdSha256",
        "endpointSha256",
        "databaseIdentitySha256",
        "serverVersionNum",
        "restoreReceiptRelativePath",
        "restoreReceiptFileIdentitySha256",
        "restoreReceiptMtimeNs",
        "g035RestoreReceiptSha256",
        "restoreReceiptBytesSha256",
        "runtimeConfiguration",
        "restoreRunReceiptId",
    }
    restored_values: list[dict[str, object]] = []
    identities: list[tuple[int, int]] = []
    for slot, clone_value in enumerate(clones, 1):
        clone = clone_value  # type: ignore[assignment]
        if (
            set(clone) != expected_clone_keys
            or clone.get("slot") != slot
            or type(clone.get("cloneNonce")) is not str
            or not NONCE.fullmatch(clone["cloneNonce"])
            or type(clone.get("serverVersionNum")) is not str
            or not SERVER_VERSION.fullmatch(clone["serverVersionNum"])
            or clone.get("serverVersionNum") != "170006"
            or type(clone.get("restoreReceiptMtimeNs")) is not int
            or clone["restoreReceiptMtimeNs"] <= 0
            or type(clone.get("containerName")) is not str
            or not re.fullmatch(r"tzudong-g035-[a-f0-9]{20}-[12]-db", clone["containerName"])
            or type(clone.get("networkName")) is not str
            or not re.fullmatch(r"tzudong-g035-[a-f0-9]{20}-[12]-net", clone["networkName"])
            or clone.get("containerNameSha256")
            != _sha256_bytes(str(clone.get("containerName")).encode("ascii"))
            or clone.get("networkNameSha256")
            != _sha256_bytes(str(clone.get("networkName")).encode("ascii"))
            or any(
                type(clone.get(key)) is not str or not HEX.fullmatch(clone[key])
                for key in (
                    "containerNameSha256",
                    "containerIdSha256",
                    "networkNameSha256",
                    "networkIdSha256",
                    "endpointSha256",
                    "databaseIdentitySha256",
                    "restoreReceiptFileIdentitySha256",
                    "g035RestoreReceiptSha256",
                    "restoreReceiptBytesSha256",
                    "restoreRunReceiptId",
                )
            )
        ):
            raise RehearsalError("dual_receipt_invalid")
        _validate_runtime_configuration(clone["runtimeConfiguration"])
        if (
            clone["serverVersionNum"]
            != clone["runtimeConfiguration"]["serverVersionNum"]
        ):
            raise RehearsalError("runtime_configuration_invalid")
        restore_path = _relative_restore_path(receipt_path.parent, clone["restoreReceiptRelativePath"], slot)
        restored = _validate_restore(restore_path, capture, authorized_final_commit)
        if (
            clone["restoreReceiptFileIdentitySha256"] != restored["receiptFileIdentitySha256"]
            or clone["restoreReceiptMtimeNs"] != restored["restoreReceiptMtimeNs"]
            or clone["g035RestoreReceiptSha256"] != restored["receiptSha256"]
            or clone["restoreReceiptBytesSha256"] != restored["receiptBytesSha256"]
            or clone["restoreRunReceiptId"]
            != _restore_run_receipt_id(
                authorized_final_commit,
                capture["receiptSha256"],
                clone,
            )
        ):
            raise RehearsalError("dual_receipt_invalid")
        restored_values.append(restored)
        identities.append(restored["fileIdentity"])  # type: ignore[arg-type]
    if any(
        clone["restoreReceiptMtimeNs"] < max(
            expected_capture["captureReceiptMtimeNs"],
            expected_capture["archiveMtimeNs"],
        )
        or clone["restoreReceiptMtimeNs"] // 1_000_000_000 > observed_at
        or observed_at - clone["restoreReceiptMtimeNs"] // 1_000_000_000
        > MAX_EVIDENCE_AGE_SECONDS
        for clone in clones
    ):
        raise RehearsalError("dual_receipt_freshness_invalid")
    if identities[0] == identities[1] or any(
        clones[0][key] == clones[1][key]
        for key in (
            "cloneNonce",
            "containerNameSha256",
            "containerIdSha256",
            "networkNameSha256",
            "networkIdSha256",
            "endpointSha256",
            "databaseIdentitySha256",
            "restoreReceiptFileIdentitySha256",
            "restoreRunReceiptId",
        )
    ):
        raise RehearsalError("dual_restore_not_distinct")
    if restored_values[0]["fingerprints"] != restored_values[1]["fingerprints"]:
        raise RehearsalError("dual_restore_comparison_invalid")
    if clones[0]["runtimeConfiguration"] != clones[1]["runtimeConfiguration"]:
        raise RehearsalError("runtime_configuration_invalid")
    expected_comparison = _comparison(capture["fingerprints"])  # type: ignore[arg-type]
    if receipt.get("comparison") != expected_comparison:
        raise RehearsalError("dual_restore_comparison_invalid")
    cleanup = receipt.get("cleanup")
    if type(cleanup) is not dict:
        raise RehearsalError("cleanup_evidence_invalid")
    cleanup_body = dict(cleanup)
    cleanup_sha = cleanup_body.pop("cleanupReceiptSha256", None)
    expected_source_helpers = [
        str(clone["containerName"])[:-2] + "source" for clone in clones
    ]
    expected_cleanup_keys = {
        "containerNames",
        "containerNameSha256",
        "sourceHelperNames",
        "sourceHelperNameSha256",
        "networkNames",
        "networkNameSha256",
        "operationsSucceeded",
        "relaysAbsent",
        "containersAbsent",
        "sourceHelpersAbsent",
        "networksAbsent",
        "serviceFilesAbsent",
        "plaintextWorkspacesAbsent",
    }
    if (
        set(cleanup_body) != expected_cleanup_keys
        or cleanup_body.get("containerNames")
        != [clone["containerName"] for clone in clones]
        or cleanup_body.get("containerNameSha256")
        != [clone["containerNameSha256"] for clone in clones]
        or cleanup_body.get("sourceHelperNames") != expected_source_helpers
        or cleanup_body.get("sourceHelperNameSha256")
        != [
            _sha256_bytes(name.encode("ascii")) for name in expected_source_helpers
        ]
        or cleanup_body.get("networkNames")
        != [clone["networkName"] for clone in clones]
        or cleanup_body.get("networkNameSha256")
        != [clone["networkNameSha256"] for clone in clones]
        or any(
            cleanup_body.get(key) is not True
            for key in (
                "operationsSucceeded",
                "relaysAbsent",
                "containersAbsent",
                "sourceHelpersAbsent",
                "networksAbsent",
                "serviceFilesAbsent",
                "plaintextWorkspacesAbsent",
            )
        )
        or type(cleanup_sha) is not str
        or cleanup_sha != _digest(cleanup_body)
    ):
        raise RehearsalError("cleanup_evidence_invalid")
    if canonical_docker is not None:
        if any(
            not _docker_absent(canonical_docker, "container", str(clone["containerName"]))
            or not _docker_absent(
                canonical_docker,
                "container",
                expected_source_helpers[index],
            )
            or not _docker_absent(canonical_docker, "network", str(clone["networkName"]))
            for index, clone in enumerate(clones)
        ):
            raise RehearsalError("cleanup_live_readback_invalid")
    return {
        "schema": RECEIPT_SCHEMA,
        "status": RECEIPT_STATUS,
        "receiptSha256": receipt_sha,
        "sourceCommit": authorized_final_commit,
        "runtimeSourceRoot": capture["runtimeSourceRoot"],
        "captureReceiptSha256": capture["receiptSha256"],
        "archiveSha256": capture["archiveSha256"],
        "captureReceiptMtimeNs": capture["captureReceiptMtimeNs"],
        "archiveMtimeNs": capture["archiveMtimeNs"],
        "ledgerCount": expected_comparison["ledgerCount"],
        "ledgerSha256": expected_comparison["ledgerSha256"],
        "restorableCatalogSha256": expected_comparison["restorableCatalogSha256"],
        "managedCatalogSha256": expected_comparison["managedCatalogSha256"],
        "restoreRunReceiptIds": [clone["restoreRunReceiptId"] for clone in clones],
        "g035RestoreReceiptSha256": [clone["g035RestoreReceiptSha256"] for clone in clones],
        "restoreReceiptBytesSha256": [clone["restoreReceiptBytesSha256"] for clone in clones],
        "restoreReceiptMtimeNs": [clone["restoreReceiptMtimeNs"] for clone in clones],
        "runtimeConfigurationSha256": [
            clone["runtimeConfiguration"]["runtimeConfigurationSha256"] for clone in clones
        ],
        "postgresCustomTreeRoot": POSTGRES_CUSTOM_TREE_ROOT,
        "cleanupReceiptSha256": cleanup_sha,
        "cleanupLiveReadback": docker_binary is not None,
        "observedAtUnixSeconds": receipt["observedAtUnixSeconds"],
        "hostedMutations": 0,
    }


def _run_rehearsal_impl(args: argparse.Namespace) -> dict[str, object]:
    global _PINNED_DOCKER_ENDPOINT, _PINNED_DOCKER_SOCKET_IDENTITY, _PINNED_DOCKER_BINDING
    global _CANCELLATION_REQUESTED, _WHOLE_DEADLINE, _CLEANUP_DEADLINE, _IN_CLEANUP
    os.umask(0o077)
    _PINNED_DOCKER_ENDPOINT = None
    _PINNED_DOCKER_SOCKET_IDENTITY = None
    _PINNED_DOCKER_BINDING = None
    _CANCELLATION_REQUESTED = False
    _IN_CLEANUP = False
    started = time.monotonic()
    _WHOLE_DEADLINE = started + MAX_ACTIVE_REHEARSAL_SECONDS
    _CLEANUP_DEADLINE = started + MAX_WHOLE_REHEARSAL_SECONDS
    if type(args.run_nonce) is not str or not NONCE.fullmatch(args.run_nonce):
        raise RehearsalError("run_nonce_invalid")
    root = args.repository_root
    source = _source_binding(
        root,
        args.authorized_final_commit,
        require_detached=True,
    )
    if any(not path.is_absolute() for path in (args.capture_receipt, args.archive, args.destination)):
        raise RehearsalError("evidence_path_invalid")
    capture_path = args.capture_receipt.resolve(strict=True)
    archive_path = args.archive.resolve(strict=True)
    if capture_path != args.capture_receipt or archive_path != args.archive:
        raise RehearsalError("evidence_path_invalid")
    if root == capture_path or root in capture_path.parents or root == archive_path or root in archive_path.parents:
        raise RehearsalError("evidence_path_invalid")
    capture = _validate_capture(capture_path, archive_path, args.authorized_final_commit)
    _require_fresh_input_evidence(capture)
    identity = _read_inherited_identity(args.identity_fd)
    python = _binary(args.python, "python")
    docker = _binary(args.docker, "docker")
    age = _binary(args.age, "age")
    pg_restore = _binary(args.pg_restore, "pg_restore")
    toolchain = _live_toolchain(python, docker, age, pg_restore)
    docker_binding = _local_docker_binding(docker)
    _validate_image(docker)
    receipt_source = {**source, "docker": docker_binding, "tools": toolchain}
    bootstrap = _git(root, "show", f"{args.authorized_final_commit}:{BOOTSTRAP_PATH}")
    destination = args.destination
    if not destination.is_absolute() or root == destination or root in destination.parents:
        raise RehearsalError("destination_invalid")
    _secure_mkdir(destination, "destination")
    run_nonce = args.run_nonce
    clones: list[dict[str, object]] = []
    restored: list[dict[str, object]] = []
    cleanup: dict[str, object] | None = None
    failure: Exception | None = None
    previous_sigterm = signal.signal(signal.SIGTERM, _request_cancellation)
    previous_sigint = signal.signal(signal.SIGINT, _request_cancellation)
    try:
        _require_not_cancelled()
        for slot in (1, 2):
            _require_not_cancelled()
            clones.append(_create_clone(docker, destination, run_nonce, slot))
        if (
            clones[0]["containerId"] == clones[1]["containerId"]
            or clones[0]["networkId"] == clones[1]["networkId"]
            or clones[0]["port"] == clones[1]["port"]
        ):
            raise RehearsalError("dual_restore_not_distinct")
        for clone in clones:
            _require_not_cancelled()
            _recheck_clone_isolation(docker, clone)
            _require_toolchain_unchanged(
                toolchain,
                python,
                docker,
                age,
                pg_restore,
            )
            _restore_clone(
                clone,
                python=python,
                repository_root=root,
                commit=args.authorized_final_commit,
                bootstrap=bootstrap,
                capture_receipt=capture_path,
                archive=archive_path,
                identity=identity,
                age=age,
                pg_restore=pg_restore,
            )
            verified = _validate_restore(
                Path(clone["restoreReceipt"]),
                capture,
                args.authorized_final_commit,
            )
            _recheck_clone_isolation(docker, clone)
            clone["runtimeConfiguration"] = _runtime_configuration(
                docker,
                str(clone["container"]),
            )
            database_identity, server_version = _database_identity(
                docker,
                str(clone["container"]),
                str(clone["password"]),
            )
            clone["databaseIdentitySha256"] = database_identity
            clone["serverVersionNum"] = server_version
            _require_not_cancelled()
            restored.append(verified)
        if (
            restored[0]["fingerprints"] != restored[1]["fingerprints"]
            or clones[0]["databaseIdentitySha256"] == clones[1]["databaseIdentitySha256"]
            or restored[0]["fileIdentity"] == restored[1]["fileIdentity"]
            or clones[0]["runtimeConfiguration"] != clones[1]["runtimeConfiguration"]
        ):
            raise RehearsalError("dual_restore_comparison_invalid")
    except Exception as error:
        failure = error
    finally:
        _IN_CLEANUP = True
        try:
            cleanup = _cleanup_clones(docker, clones)
        except Exception as cleanup_error:
            failure = cleanup_error
        signal.signal(signal.SIGTERM, previous_sigterm)
        signal.signal(signal.SIGINT, previous_sigint)
    if failure is not None:
        if isinstance(failure, RehearsalError):
            raise failure
        raise RehearsalError("dual_restore_failed") from failure
    if cleanup is None or len(restored) != 2:
        raise RehearsalError("dual_restore_failed")
    _require_toolchain_unchanged(toolchain, python, docker, age, pg_restore)
    for clone in clones:
        clone["password"] = ""
    public_clones = [
        _public_clone_evidence(
            clone,
            verified,
            str(clone["databaseIdentitySha256"]),
            str(clone["serverVersionNum"]),
            args.authorized_final_commit,
            str(capture["receiptSha256"]),
        )
        for clone, verified in zip(clones, restored)
    ]
    value = _assemble_receipt(
        receipt_source,
        capture,
        _comparison(capture["fingerprints"]),  # type: ignore[arg-type]
        public_clones,
        cleanup,
        int(time.time()),
    )
    target = destination / FINAL_RECEIPT_NAME
    _publish_receipt(target, value)
    return validate_dual_restore_receipt(
        target,
        capture_path,
        archive_path,
        root,
        args.authorized_final_commit,
        docker_binary=docker,
    )


def run_rehearsal(args: argparse.Namespace) -> dict[str, object]:
    global _ACTIVE_IDENTITY, _WHOLE_DEADLINE, _CLEANUP_DEADLINE, _IN_CLEANUP
    try:
        return _run_rehearsal_impl(args)
    finally:
        if _ACTIVE_IDENTITY is not None:
            _ACTIVE_IDENTITY[:] = b"\0" * len(_ACTIVE_IDENTITY)
            _ACTIVE_IDENTITY = None
        _WHOLE_DEADLINE = None
        _CLEANUP_DEADLINE = None
        _IN_CLEANUP = False


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser()
    subparsers = result.add_subparsers(dest="mode", required=True)
    run = subparsers.add_parser("run")
    run.add_argument("--repository-root", type=Path, required=True)
    run.add_argument("--authorized-final-commit", required=True)
    run.add_argument("--capture-receipt", type=Path, required=True)
    run.add_argument("--archive", type=Path, required=True)
    run.add_argument("--identity-fd", required=True)
    run.add_argument("--run-nonce", required=True)
    run.add_argument("--destination", type=Path, required=True)
    run.add_argument("--python", required=True)
    run.add_argument("--docker", required=True)
    run.add_argument("--age", required=True)
    run.add_argument("--pg-restore", required=True)
    validate = subparsers.add_parser("validate")
    validate.add_argument("--repository-root", type=Path, required=True)
    validate.add_argument("--authorized-final-commit", required=True)
    validate.add_argument("--capture-receipt", type=Path, required=True)
    validate.add_argument("--archive", type=Path, required=True)
    validate.add_argument("--receipt", type=Path, required=True)
    validate.add_argument("--docker")
    return result


def main(argv: Sequence[str] | None = None) -> int:
    global _PINNED_DOCKER_ENDPOINT, _PINNED_DOCKER_SOCKET_IDENTITY, _PINNED_DOCKER_BINDING
    _PINNED_DOCKER_ENDPOINT = None
    _PINNED_DOCKER_SOCKET_IDENTITY = None
    _PINNED_DOCKER_BINDING = None
    args = parser().parse_args(argv)
    try:
        if args.mode == "run":
            summary = run_rehearsal(args)
        else:
            summary = validate_dual_restore_receipt(
                args.receipt,
                args.capture_receipt,
                args.archive,
                args.repository_root,
                args.authorized_final_commit,
                docker_binary=args.docker,
            )
        sys.stdout.buffer.write(_canonical_bytes(summary) + b"\n")
        return 0
    except RehearsalError:
        sys.stderr.write("local_dual_restore_rehearsal_failed\n")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
