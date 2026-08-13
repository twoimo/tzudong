#!/usr/bin/env python3
"""Launch the committed G035 dual restore with POSIX anonymous-pipe custody."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pwd
import re
import secrets
import signal
import stat
import subprocess
import sys
import time
from pathlib import Path
from typing import NamedTuple, Sequence


LAUNCHER_PATH = "backend/supabase/scripts/g035_dual_restore_custody_launcher.py"
PRODUCER_PATH = "backend/supabase/scripts/run_g035_dual_restore_rehearsal.py"
EXPECTED_PRODUCER_SHA256 = "ab4b0c8c05a82a574ad662fc530899af721ec1506deb8b8aa0fd3aa3627891a2"
MAX_CONFIG_BYTES = 4096
MAX_IDENTITY_BYTES = 4096
MAX_PRODUCER_BYTES = 4 * 1024 * 1024
SOURCE_CHECK_TIMEOUT_SECONDS = 30
PRODUCER_TIMEOUT_SECONDS = 5400
COOPERATIVE_CLEANUP_GRACE_SECONDS = 600
REAP_TIMEOUT_SECONDS = 30
DOCKER_TIMEOUT_SECONDS = 60
MAX_DOCKER_OUTPUT_BYTES = 2 * 1024 * 1024
COMMIT = re.compile(r"^[0-9a-f]{40}$")
HEX = re.compile(r"^[0-9a-f]{64}$")
NONCE = re.compile(r"^[0-9a-f]{32}$")
IMAGE_REFERENCE = "supabase/postgres@sha256:ac581882596ed0e46937ea6dd53a627d09f53e005d7264c2082a7ff7b62eaaca"
IMAGE_ID = "sha256:ac581882596ed0e46937ea6dd53a627d09f53e005d7264c2082a7ff7b62eaaca"
OWNERSHIP_LABEL = "io.tzudong.g035-dual-restore"
SLOT_LABEL = "io.tzudong.g035-dual-restore.slot"
PURPOSE_LABEL = "io.tzudong.g035-dual-restore.purpose"
PINNED_PYTHON_PATH = "/opt/homebrew/Cellar/python@3.14/3.14.6/Frameworks/Python.framework/Versions/3.14/bin/python3.14"
PINNED_PYTHON_BYTES = 34_640
PINNED_PYTHON_UID = 501
PINNED_PYTHON_MODE = 0o755
PINNED_PYTHON_SHA256 = "4f00ea2ad53d62437a6a3946b73c73614a97e8accdc5b96dc095ea1a0d9c6a56"
PINNED_PYTHON_VERSION = b"Python 3.14.6\n"
_ACTIVE_PRODUCER: subprocess.Popen[bytes] | None = None
_LAUNCHER_CANCELLATION_REQUESTED = False


class CustodyError(RuntimeError):
    """A bounded error that never carries a custody path or identity bytes."""


class _PythonBinding(NamedTuple):
    path: str
    snapshot: tuple[int, ...]


class _BoundedArgumentParser(argparse.ArgumentParser):
    def error(self, unused_message: str) -> None:
        raise CustodyError("arguments_invalid")


def _request_cancellation(unused_signum: int, unused_frame: object) -> None:
    global _LAUNCHER_CANCELLATION_REQUESTED
    _LAUNCHER_CANCELLATION_REQUESTED = True
    process = _ACTIVE_PRODUCER
    if process is not None and process.poll() is None:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except OSError:
            pass


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _snapshot(info: os.stat_result) -> tuple[int, ...]:
    return (
        info.st_dev,
        info.st_ino,
        info.st_mode,
        info.st_uid,
        info.st_gid,
        info.st_nlink,
        info.st_size,
        info.st_mtime_ns,
        info.st_ctime_ns,
    )


def _zero(value: bytearray) -> None:
    for index in range(len(value)):
        value[index] = 0


def _external_canonical_path(path: Path, repository_root: Path, label: str) -> Path:
    if not path.is_absolute():
        raise CustodyError(f"{label}_invalid")
    try:
        resolved = path.resolve(strict=True)
    except OSError as error:
        raise CustodyError(f"{label}_invalid") from error
    if (
        resolved != path
        or path == repository_root
        or repository_root in path.parents
    ):
        raise CustodyError(f"{label}_invalid")
    return path


def _owned_parent(path: Path, label: str) -> tuple[int, ...]:
    parent = path.parent
    try:
        resolved = parent.resolve(strict=True)
        info = parent.lstat()
    except OSError as error:
        raise CustodyError(f"{label}_invalid") from error
    if (
        resolved != parent
        or stat.S_ISLNK(info.st_mode)
        or not stat.S_ISDIR(info.st_mode)
        or info.st_uid != os.getuid()
        or stat.S_IMODE(info.st_mode) != 0o700
    ):
        raise CustodyError(f"{label}_invalid")
    return _snapshot(info)


def _read_owned_regular(
    path: Path,
    label: str,
    maximum: int,
) -> tuple[bytearray, tuple[int, ...]]:
    if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_CLOEXEC"):
        raise CustodyError("posix_open_flags_unavailable")
    parent_snapshot = _owned_parent(path, f"{label}_parent")
    fd: int | None = None
    value = bytearray()
    try:
        before = path.lstat()
        if (
            stat.S_ISLNK(before.st_mode)
            or not stat.S_ISREG(before.st_mode)
            or before.st_uid != os.getuid()
            or stat.S_IMODE(before.st_mode) != 0o600
            or before.st_nlink != 1
            or before.st_size <= 0
            or before.st_size > maximum
        ):
            raise CustodyError(f"{label}_invalid")
        flags = os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW
        fd = os.open(path, flags)
        opened = os.fstat(fd)
        if _snapshot(opened) != _snapshot(before):
            raise CustodyError(f"{label}_changed")
        if not hasattr(os, "readv"):
            raise CustodyError("posix_readv_unavailable")
        value = bytearray(opened.st_size)
        offset = 0
        while offset < len(value):
            view = memoryview(value)[offset:]
            try:
                count = os.readv(fd, [view])
            finally:
                view.release()
            if count <= 0:
                raise CustodyError(f"{label}_changed")
            offset += count
        probe = bytearray(1)
        try:
            if os.readv(fd, [probe]) != 0:
                raise CustodyError(f"{label}_changed")
        finally:
            _zero(probe)
        after_fd = os.fstat(fd)
        after_path = path.lstat()
        after_parent = path.parent.lstat()
        if (
            _snapshot(after_fd) != _snapshot(before)
            or _snapshot(after_path) != _snapshot(before)
            or _snapshot(after_parent) != parent_snapshot
        ):
            raise CustodyError(f"{label}_changed")
        return value, _snapshot(before)
    except CustodyError:
        _zero(value)
        raise
    except OSError as error:
        _zero(value)
        raise CustodyError(f"{label}_invalid") from error
    finally:
        if fd is not None:
            try:
                os.close(fd)
            except OSError:
                pass


def _json_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate")
        result[key] = value
    return result


def _load_identity(config_path: Path, repository_root: Path) -> bytearray:
    config = _external_canonical_path(config_path, repository_root, "custody_config")
    raw = bytearray()
    try:
        raw, config_snapshot = _read_owned_regular(config, "custody_config", MAX_CONFIG_BYTES)
        try:
            payload = json.loads(
                raw.decode("ascii"),
                object_pairs_hook=_json_object,
                parse_constant=lambda unused: (_ for _ in ()).throw(ValueError("constant")),
            )
            canonical = (
                json.dumps(
                    payload,
                    sort_keys=True,
                    separators=(",", ":"),
                    ensure_ascii=True,
                    allow_nan=False,
                ).encode("ascii")
                + b"\n"
            )
        except (UnicodeDecodeError, ValueError, TypeError) as error:
            raise CustodyError("custody_config_invalid") from error
        if (
            type(payload) is not dict
            or set(payload) != {"identityPath"}
            or type(payload.get("identityPath")) is not str
            or not payload["identityPath"]
            or "\x00" in payload["identityPath"]
            or "\n" in payload["identityPath"]
            or "\r" in payload["identityPath"]
            or len(payload["identityPath"]) > 2048
            or raw != canonical
        ):
            raise CustodyError("custody_config_invalid")
        identity_path = _external_canonical_path(
            Path(payload["identityPath"]), repository_root, "identity"
        )
        identity, identity_snapshot = _read_owned_regular(
            identity_path, "identity", MAX_IDENTITY_BYTES
        )
        if (
            identity_snapshot[:2] == config_snapshot[:2]
            or 0 in identity
            or identity.find(b"AGE-SECRET-KEY-") < 0
        ):
            _zero(identity)
            raise CustodyError("identity_invalid")
        return identity
    finally:
        _zero(raw)


def _run_git(repository_root: Path, *args: str) -> subprocess.CompletedProcess[bytes]:
    try:
        return subprocess.run(
            ["/usr/bin/git", "-C", os.fspath(repository_root), *args],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=SOURCE_CHECK_TIMEOUT_SECONDS,
            check=False,
            env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"},
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise CustodyError("source_binding_invalid") from error


def _git(repository_root: Path, *args: str) -> bytes:
    result = _run_git(repository_root, *args)
    if result.returncode != 0:
        raise CustodyError("source_binding_invalid")
    return result.stdout


def _committed_blob(repository_root: Path, commit: str, relative_path: str) -> bytes:
    encoded_path = relative_path.encode("ascii")
    tree = _git(repository_root, "ls-tree", "-z", commit, "--", relative_path)
    suffix = b"\t" + encoded_path + b"\0"
    if tree.count(b"\0") != 1 or not tree.endswith(suffix):
        raise CustodyError("source_binding_invalid")
    try:
        mode, kind, object_id = tree[: -len(suffix)].split(b" ")
    except ValueError as error:
        raise CustodyError("source_binding_invalid") from error
    if (
        mode not in (b"100644", b"100755")
        or kind != b"blob"
        or re.fullmatch(rb"[0-9a-f]{40}", object_id) is None
    ):
        raise CustodyError("source_binding_invalid")
    value = _git(repository_root, "show", f"{commit}:{relative_path}")
    if not value or len(value) > MAX_PRODUCER_BYTES:
        raise CustodyError("source_binding_invalid")
    local = repository_root.joinpath(*relative_path.split("/"))
    try:
        info = local.lstat()
        local_value = local.read_bytes()
        after = local.lstat()
    except OSError as error:
        raise CustodyError("source_binding_invalid") from error
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISREG(info.st_mode)
        or info.st_uid not in (0, os.getuid())
        or info.st_mode & 0o022
        or bool(info.st_mode & stat.S_IXUSR) != (mode == b"100755")
        or _snapshot(info) != _snapshot(after)
        or local_value != value
    ):
        raise CustodyError("source_binding_invalid")
    return value


def _committed_producer(repository_root: Path, commit: str) -> bytes:
    if (
        os.name != "posix"
        or not repository_root.is_absolute()
        or COMMIT.fullmatch(commit) is None
    ):
        raise CustodyError("source_binding_invalid")
    try:
        resolved = repository_root.resolve(strict=True)
        root_info = repository_root.lstat()
    except OSError as error:
        raise CustodyError("source_binding_invalid") from error
    if (
        resolved != repository_root
        or stat.S_ISLNK(root_info.st_mode)
        or not stat.S_ISDIR(root_info.st_mode)
    ):
        raise CustodyError("source_binding_invalid")
    attached = _run_git(repository_root, "symbolic-ref", "-q", "HEAD")
    if (
        attached.returncode != 1
        or _git(repository_root, "rev-parse", "--verify", "HEAD^{commit}")
        != (commit + "\n").encode("ascii")
        or _git(repository_root, "status", "--porcelain=v1", "-z", "--untracked-files=all")
    ):
        raise CustodyError("source_binding_invalid")
    _committed_blob(repository_root, commit, LAUNCHER_PATH)
    producer = _committed_blob(repository_root, commit, PRODUCER_PATH)
    if (
        type(EXPECTED_PRODUCER_SHA256) is not str
        or HEX.fullmatch(EXPECTED_PRODUCER_SHA256) is None
        or _sha256(producer) != EXPECTED_PRODUCER_SHA256
    ):
        raise CustodyError("producer_hash_invalid")
    return producer


def _binary(value: str, label: str) -> str:
    path = Path(value)
    if not path.is_absolute():
        raise CustodyError(f"{label}_invalid")
    try:
        resolved = path.resolve(strict=True)
        info = resolved.stat()
    except OSError as error:
        raise CustodyError(f"{label}_invalid") from error
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid not in (0, os.getuid())
        or info.st_nlink != 1
        or info.st_mode & 0o022
        or not os.access(resolved, os.X_OK)
    ):
        raise CustodyError(f"{label}_invalid")
    return os.fspath(resolved)


def _python_file_identity(path: Path) -> tuple[tuple[int, ...], str]:
    if not hasattr(os, "O_NOFOLLOW") or not hasattr(os, "O_CLOEXEC"):
        raise CustodyError("python_identity_invalid")
    fd: int | None = None
    try:
        before = path.lstat()
        if (
            path.resolve(strict=True) != path
            or stat.S_ISLNK(before.st_mode)
            or not stat.S_ISREG(before.st_mode)
            or before.st_uid != PINNED_PYTHON_UID
            or before.st_nlink != 1
            or stat.S_IMODE(before.st_mode) != PINNED_PYTHON_MODE
            or before.st_size != PINNED_PYTHON_BYTES
        ):
            raise CustodyError("python_identity_invalid")
        fd = os.open(path, os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW)
        opened = os.fstat(fd)
        if _snapshot(opened) != _snapshot(before):
            raise CustodyError("python_identity_changed")
        hasher = hashlib.sha256()
        while True:
            chunk = os.read(fd, 65_536)
            if not chunk:
                break
            hasher.update(chunk)
        after_fd = os.fstat(fd)
        after_path = path.lstat()
        if (
            _snapshot(after_fd) != _snapshot(before)
            or _snapshot(after_path) != _snapshot(before)
            or hasher.hexdigest() != PINNED_PYTHON_SHA256
        ):
            raise CustodyError("python_identity_changed")
        return _snapshot(before), hasher.hexdigest()
    except CustodyError:
        raise
    except OSError as error:
        raise CustodyError("python_identity_invalid") from error
    finally:
        if fd is not None:
            _close(fd)


def _pinned_python(value: str) -> _PythonBinding:
    if value != PINNED_PYTHON_PATH:
        raise CustodyError("python_identity_invalid")
    path = Path(value)
    before, unused_digest = _python_file_identity(path)
    try:
        result = subprocess.run(
            [value, "--version"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10,
            check=False,
            env=_base_environment(),
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise CustodyError("python_identity_invalid") from error
    after, unused_after_digest = _python_file_identity(path)
    if (
        result.returncode != 0
        or result.stdout != PINNED_PYTHON_VERSION
        or result.stderr
        or after != before
    ):
        raise CustodyError("python_identity_invalid")
    return _PythonBinding(value, before)


def _recheck_pinned_python(binding: _PythonBinding) -> str:
    if type(binding) is not _PythonBinding or binding.path != PINNED_PYTHON_PATH:
        raise CustodyError("python_identity_invalid")
    observed, unused_digest = _python_file_identity(Path(binding.path))
    if observed != binding.snapshot:
        raise CustodyError("python_identity_changed")
    return binding.path


def _base_environment() -> dict[str, str]:
    try:
        home = pwd.getpwuid(os.getuid()).pw_dir
    except KeyError as error:
        raise CustodyError("local_environment_invalid") from error
    if not home or "\x00" in home:
        raise CustodyError("local_environment_invalid")
    return {
        "HOME": home,
        "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
        "LANG": "C",
        "LC_ALL": "C",
    }


def _docker_probe(
    argv: Sequence[str],
    *,
    environment: dict[str, str],
    timeout: int = DOCKER_TIMEOUT_SECONDS,
) -> subprocess.CompletedProcess[bytes]:
    try:
        result = subprocess.run(
            list(argv),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=timeout,
            check=False,
            env=environment,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise CustodyError("docker_cleanup_unavailable") from error
    if len(result.stdout) > MAX_DOCKER_OUTPUT_BYTES:
        raise CustodyError("docker_cleanup_unavailable")
    return result


def _docker_cleanup_binding(docker: str) -> dict[str, object]:
    environment = _base_environment()
    context_result = _docker_probe(
        [docker, "context", "show"],
        environment=environment,
    )
    try:
        context = context_result.stdout.decode("ascii").strip()
    except UnicodeDecodeError as error:
        raise CustodyError("docker_cleanup_unavailable") from error
    if (
        context_result.returncode != 0
        or not context
        or len(context) > 128
        or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", context) is None
    ):
        raise CustodyError("docker_cleanup_unavailable")
    inspect_result = _docker_probe(
        [docker, "context", "inspect", context],
        environment=environment,
    )
    if inspect_result.returncode != 0:
        raise CustodyError("docker_cleanup_unavailable")
    try:
        value = json.loads(
            inspect_result.stdout.decode("utf-8"),
            object_pairs_hook=_json_object,
            parse_constant=lambda unused: (_ for _ in ()).throw(ValueError("constant")),
        )
        endpoint = value[0]["Endpoints"]["docker"]["Host"]
    except (UnicodeDecodeError, ValueError, KeyError, IndexError, TypeError) as error:
        raise CustodyError("docker_cleanup_unavailable") from error
    if (
        type(value) is not list
        or len(value) != 1
        or type(value[0]) is not dict
        or type(endpoint) is not str
        or not endpoint.startswith("unix://")
    ):
        raise CustodyError("docker_cleanup_unavailable")
    raw_path = Path(endpoint.removeprefix("unix://"))
    try:
        socket_path = raw_path.resolve(strict=True)
        info = socket_path.stat()
    except OSError as error:
        raise CustodyError("docker_cleanup_unavailable") from error
    if (
        not socket_path.is_absolute()
        or raw_path != socket_path
        or not stat.S_ISSOCK(info.st_mode)
        or info.st_uid != os.getuid()
        or stat.S_IMODE(info.st_mode) & 0o077
    ):
        raise CustodyError("docker_cleanup_unavailable")
    return {
        "context": context,
        "endpoint": endpoint,
        "socketPath": socket_path,
        "socketIdentity": (info.st_dev, info.st_ino, info.st_uid),
    }


def _recheck_cleanup_socket(binding: dict[str, object]) -> None:
    path = binding.get("socketPath")
    expected = binding.get("socketIdentity")
    if not isinstance(path, Path) or type(expected) is not tuple or len(expected) != 3:
        raise CustodyError("docker_cleanup_unavailable")
    try:
        info = path.stat()
    except OSError as error:
        raise CustodyError("docker_cleanup_unavailable") from error
    if (
        not stat.S_ISSOCK(info.st_mode)
        or info.st_uid != os.getuid()
        or stat.S_IMODE(info.st_mode) & 0o077
        or (info.st_dev, info.st_ino, info.st_uid) != expected
    ):
        raise CustodyError("docker_cleanup_unavailable")


def _docker_call(
    docker: str,
    binding: dict[str, object],
    *args: str,
    timeout: int = DOCKER_TIMEOUT_SECONDS,
) -> subprocess.CompletedProcess[bytes]:
    _recheck_cleanup_socket(binding)
    endpoint = binding.get("endpoint")
    if type(endpoint) is not str:
        raise CustodyError("docker_cleanup_unavailable")
    environment = {**_base_environment(), "DOCKER_HOST": endpoint}
    return _docker_probe(
        [docker, "--host", endpoint, *args],
        environment=environment,
        timeout=timeout,
    )


def _docker_label_inventory(
    docker: str,
    binding: dict[str, object],
    kind: str,
    run_nonce: str,
) -> tuple[tuple[str, str], ...]:
    argv = (
        (
            "container", "ls", "--all", "--no-trunc",
            "--filter", f"label={OWNERSHIP_LABEL}={run_nonce}",
            "--format", "{{.ID}}\t{{.Names}}",
        )
        if kind == "container"
        else (
            "network", "ls", "--no-trunc",
            "--filter", f"label={OWNERSHIP_LABEL}={run_nonce}",
            "--format", "{{.ID}}\t{{.Name}}",
        )
    )
    result = _docker_call(docker, binding, *argv)
    if result.returncode != 0:
        raise CustodyError("docker_cleanup_unavailable")
    try:
        lines = result.stdout.decode("utf-8").splitlines()
        rows = tuple(tuple(line.split("\t", 1)) for line in lines)
    except UnicodeDecodeError as error:
        raise CustodyError("docker_cleanup_unavailable") from error
    expected_names = {
        f"tzudong-g035-{run_nonce[:20]}-{slot}-{suffix}"
        for slot in (1, 2)
        for suffix in (("db", "source") if kind == "container" else ("net",))
    }
    if (
        len(rows) > (4 if kind == "container" else 2)
        or any(
            len(row) != 2
            or HEX.fullmatch(row[0]) is None
            or row[1] not in expected_names
            for row in rows
        )
        or len({row[0] for row in rows}) != len(rows)
        or len({row[1] for row in rows}) != len(rows)
    ):
        raise CustodyError("docker_cleanup_ownership_invalid")
    return rows  # type: ignore[return-value]


def _inspect_cleanup_resource(
    docker: str,
    binding: dict[str, object],
    kind: str,
    identifier: str,
    name: str,
    run_nonce: str,
) -> None:
    command = ("container", "inspect", identifier) if kind == "container" else ("network", "inspect", identifier)
    result = _docker_call(docker, binding, *command)
    if result.returncode != 0:
        raise CustodyError("docker_cleanup_ownership_invalid")
    try:
        value = json.loads(
            result.stdout.decode("utf-8"),
            object_pairs_hook=_json_object,
            parse_constant=lambda unused: (_ for _ in ()).throw(ValueError("constant")),
        )
    except (UnicodeDecodeError, ValueError, TypeError) as error:
        raise CustodyError("docker_cleanup_ownership_invalid") from error
    if type(value) is not list or len(value) != 1 or type(value[0]) is not dict:
        raise CustodyError("docker_cleanup_ownership_invalid")
    item = value[0]
    matched = re.fullmatch(
        rf"tzudong-g035-{run_nonce[:20]}-([12])-(db|source|net)",
        name,
    )
    if matched is None:
        raise CustodyError("docker_cleanup_ownership_invalid")
    slot, purpose = matched.groups()
    expected_labels = {OWNERSHIP_LABEL: run_nonce, SLOT_LABEL: slot}
    if kind == "container":
        config = item.get("Config")
        host = item.get("HostConfig")
        labels = config.get("Labels") if type(config) is dict else None
        if purpose == "db":
            expected_network = name.removesuffix("-db") + "-net"
            purpose_valid = labels.get(PURPOSE_LABEL) is None if type(labels) is dict else False
            command_valid = True
        else:
            expected_network = "none"
            expected_labels[PURPOSE_LABEL] = "postgres-custom-source"
            purpose_valid = (
                type(labels) is dict
                and labels == expected_labels
            )
            command_valid = (
                type(config) is dict
                and config.get("Entrypoint") == ["/bin/tar"]
                and config.get("Cmd")
                == ["-C", "/etc/postgresql-custom", "-cf", "-", "."]
                and config.get("Volumes") in (None, {})
                and type(host) is dict
                and host.get("ReadonlyRootfs") is True
                and host.get("CapDrop") == ["ALL"]
                and host.get("CapAdd") in (None, [])
                and host.get("SecurityOpt") == ["no-new-privileges"]
                and host.get("Privileged") is False
                and host.get("Binds") in (None, [])
                and host.get("Mounts") in (None, [])
                and item.get("Mounts") == []
            )
        if (
            item.get("Id") != identifier
            or item.get("Name") != f"/{name}"
            or item.get("Image") != IMAGE_ID
            or type(config) is not dict
            or config.get("Image") != IMAGE_REFERENCE
            or type(labels) is not dict
            or labels != expected_labels
            or not purpose_valid
            or type(host) is not dict
            or host.get("NetworkMode") != expected_network
            or not command_valid
        ):
            raise CustodyError("docker_cleanup_ownership_invalid")
    else:
        labels = item.get("Labels")
        if (
            item.get("Id") != identifier
            or item.get("Name") != name
            or item.get("Driver") != "bridge"
            or item.get("Internal") is not True
            or item.get("Attachable") is not False
            or item.get("Options") != {
                "com.docker.network.bridge.enable_ip_masquerade": "false",
                "com.docker.network.bridge.enable_icc": "false",
            }
            or type(labels) is not dict
            or labels != expected_labels
            or item.get("Containers") not in (None, {})
        ):
            raise CustodyError("docker_cleanup_ownership_invalid")


def _all_docker_names(
    docker: str,
    binding: dict[str, object],
    kind: str,
) -> set[str]:
    argv = (
        ("container", "ls", "--all", "--no-trunc", "--format", "{{.Names}}")
        if kind == "container"
        else ("network", "ls", "--no-trunc", "--format", "{{.Name}}")
    )
    result = _docker_call(docker, binding, *argv)
    if result.returncode != 0:
        raise CustodyError("docker_cleanup_unavailable")
    try:
        names = result.stdout.decode("utf-8").splitlines()
    except UnicodeDecodeError as error:
        raise CustodyError("docker_cleanup_unavailable") from error
    if len(names) != len(set(names)) or any(not name or "\x00" in name for name in names):
        raise CustodyError("docker_cleanup_unavailable")
    return set(names)


def _last_resort_cleanup(
    docker: str,
    binding: dict[str, object],
    run_nonce: str,
) -> None:
    if NONCE.fullmatch(run_nonce) is None:
        raise CustodyError("docker_cleanup_ownership_invalid")
    containers = _docker_label_inventory(docker, binding, "container", run_nonce)
    for identifier, name in containers:
        _inspect_cleanup_resource(docker, binding, "container", identifier, name, run_nonce)
    for identifier, unused_name in containers:
        removed = _docker_call(docker, binding, "rm", "-f", identifier)
        if removed.returncode != 0:
            raise CustodyError("docker_cleanup_failed")
    networks = _docker_label_inventory(docker, binding, "network", run_nonce)
    for identifier, name in networks:
        _inspect_cleanup_resource(docker, binding, "network", identifier, name, run_nonce)
    for identifier, unused_name in networks:
        removed = _docker_call(docker, binding, "network", "rm", identifier)
        if removed.returncode != 0:
            raise CustodyError("docker_cleanup_failed")
    if (
        _docker_label_inventory(docker, binding, "container", run_nonce)
        or _docker_label_inventory(docker, binding, "network", run_nonce)
    ):
        raise CustodyError("docker_cleanup_failed")
    expected_containers = {
        f"tzudong-g035-{run_nonce[:20]}-{slot}-{purpose}"
        for slot in (1, 2)
        for purpose in ("db", "source")
    }
    expected_networks = {
        f"tzudong-g035-{run_nonce[:20]}-{slot}-net" for slot in (1, 2)
    }
    if (
        expected_containers & _all_docker_names(docker, binding, "container")
        or expected_networks & _all_docker_names(docker, binding, "network")
    ):
        raise CustodyError("docker_cleanup_failed")


def _close(fd: int) -> None:
    if fd >= 0:
        try:
            os.close(fd)
        except OSError:
            pass


def _kill_and_reap(process: subprocess.Popen[bytes]) -> None:
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except (OSError, ProcessLookupError):
        pass
    try:
        process.communicate(timeout=REAP_TIMEOUT_SECONDS)
    except subprocess.TimeoutExpired as error:
        raise CustodyError("producer_reap_failed") from error


def _terminate_and_reap(process: subprocess.Popen[bytes]) -> None:
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except (OSError, ProcessLookupError):
        pass
    try:
        process.communicate(timeout=COOPERATIVE_CLEANUP_GRACE_SECONDS)
    except subprocess.TimeoutExpired:
        _kill_and_reap(process)


def _invoke_producer(
    args: argparse.Namespace,
    producer: bytes,
    identity: bytearray,
    python_binding: _PythonBinding,
    docker: str,
    docker_binding: dict[str, object],
    age: str,
    pg_restore: str,
    run_nonce: str,
) -> None:
    global _ACTIVE_PRODUCER
    read_fd = -1
    write_fd = -1
    process: subprocess.Popen[bytes] | None = None
    failure: CustodyError | None = None
    timed_out = False
    termination_attempted = False
    try:
        if NONCE.fullmatch(run_nonce) is None:
            raise CustodyError("run_nonce_invalid")
        python = python_binding.path
        if hasattr(os, "pipe2"):
            read_fd, write_fd = os.pipe2(getattr(os, "O_CLOEXEC", 0))
        else:
            read_fd, write_fd = os.pipe()
            os.set_inheritable(read_fd, False)
            os.set_inheritable(write_fd, False)
        child_argv = [
            python,
            "-I",
            "-B",
            "-",
            "run",
            "--repository-root",
            os.fspath(args.repository_root),
            "--authorized-final-commit",
            args.authorized_final_commit,
            "--run-nonce",
            run_nonce,
            "--capture-receipt",
            os.fspath(args.capture_receipt),
            "--archive",
            os.fspath(args.archive),
            "--identity-fd",
            str(read_fd),
            "--destination",
            os.fspath(args.destination),
            "--python",
            python,
            "--docker",
            docker,
            "--age",
            age,
            "--pg-restore",
            pg_restore,
        ]
        child_environment = _base_environment()
        python = _recheck_pinned_python(python_binding)
        child_argv[0] = python
        process = subprocess.Popen(
            child_argv,
            cwd=args.repository_root,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
            pass_fds=(read_fd,),
            start_new_session=True,
            env=child_environment,
        )
        _ACTIVE_PRODUCER = process
        if _LAUNCHER_CANCELLATION_REQUESTED:
            raise CustodyError("launcher_cancelled")
        _close(read_fd)
        read_fd = -1
        offset = 0
        while offset < len(identity):
            view = memoryview(identity)[offset:]
            try:
                count = os.write(write_fd, view)
            finally:
                view.release()
            if count <= 0:
                raise CustodyError("identity_pipe_failed")
            offset += count
            if _LAUNCHER_CANCELLATION_REQUESTED:
                raise CustodyError("launcher_cancelled")
        _close(write_fd)
        write_fd = -1
        _zero(identity)
        deadline = time.monotonic() + PRODUCER_TIMEOUT_SECONDS
        pending_source: bytes | None = producer
        while True:
            if _LAUNCHER_CANCELLATION_REQUESTED:
                raise CustodyError("launcher_cancelled")
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                timed_out = True
                termination_attempted = True
                _terminate_and_reap(process)
                break
            try:
                process.communicate(input=pending_source, timeout=min(1.0, remaining))
                break
            except subprocess.TimeoutExpired:
                pending_source = None
        if timed_out:
            failure = CustodyError("producer_timeout")
        elif process.returncode != 0:
            failure = CustodyError("producer_failed")
    except CustodyError as error:
        if (
            not termination_attempted
            and process is not None
            and process.poll() is None
        ):
            try:
                termination_attempted = True
                _terminate_and_reap(process)
            except CustodyError as termination_error:
                failure = termination_error
        if failure is None:
            failure = error
    except (OSError, KeyError, subprocess.SubprocessError) as error:
        if (
            not termination_attempted
            and process is not None
            and process.poll() is None
        ):
            try:
                termination_attempted = True
                _terminate_and_reap(process)
            except CustodyError as termination_error:
                failure = termination_error
        if failure is None:
            failure = CustodyError("producer_launch_failed")
            failure.__cause__ = error
    finally:
        if _ACTIVE_PRODUCER is process:
            _ACTIVE_PRODUCER = None
        _close(read_fd)
        _close(write_fd)
        _zero(identity)
    try:
        _last_resort_cleanup(docker, docker_binding, run_nonce)
    except CustodyError as cleanup_error:
        raise CustodyError("producer_cleanup_failed") from cleanup_error
    if failure is not None:
        raise failure


def run(args: argparse.Namespace) -> None:
    producer = _committed_producer(
        args.repository_root,
        args.authorized_final_commit,
    )
    python_binding = _pinned_python(args.python)
    python = python_binding.path
    docker = _binary(args.docker, "docker")
    age = _binary(args.age, "age")
    pg_restore = _binary(args.pg_restore, "pg_restore")
    docker_binding = _docker_cleanup_binding(docker)
    run_nonce = secrets.token_hex(16)
    if NONCE.fullmatch(run_nonce) is None:
        raise CustodyError("run_nonce_invalid")
    identity = _load_identity(args.custody_config, args.repository_root)
    try:
        _invoke_producer(
            args,
            producer,
            identity,
            python_binding,
            docker,
            docker_binding,
            age,
            pg_restore,
            run_nonce,
        )
    finally:
        _zero(identity)


def parser() -> argparse.ArgumentParser:
    result = _BoundedArgumentParser(add_help=False)
    result.add_argument("--repository-root", type=Path, required=True)
    result.add_argument("--authorized-final-commit", required=True)
    result.add_argument("--custody-config", type=Path, required=True)
    result.add_argument("--capture-receipt", type=Path, required=True)
    result.add_argument("--archive", type=Path, required=True)
    result.add_argument("--destination", type=Path, required=True)
    result.add_argument("--python", required=True)
    result.add_argument("--docker", required=True)
    result.add_argument("--age", required=True)
    result.add_argument("--pg-restore", required=True)
    return result


def main(argv: Sequence[str] | None = None) -> int:
    global _ACTIVE_PRODUCER, _LAUNCHER_CANCELLATION_REQUESTED
    previous_sigterm: object | None = None
    previous_sigint: object | None = None
    try:
        _ACTIVE_PRODUCER = None
        _LAUNCHER_CANCELLATION_REQUESTED = False
        previous_sigterm = signal.signal(signal.SIGTERM, _request_cancellation)
        previous_sigint = signal.signal(signal.SIGINT, _request_cancellation)
        args = parser().parse_args(argv)
        run(args)
        return 0
    except BaseException:
        sys.stderr.write("g035_dual_restore_custody_failed\n")
        return 2
    finally:
        if previous_sigterm is not None:
            signal.signal(signal.SIGTERM, previous_sigterm)
        if previous_sigint is not None:
            signal.signal(signal.SIGINT, previous_sigint)
        _ACTIVE_PRODUCER = None
        _LAUNCHER_CANCELLATION_REQUESTED = False


if __name__ == "__main__":
    raise SystemExit(main())
