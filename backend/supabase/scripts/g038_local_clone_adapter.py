#!/usr/bin/env python3
"""Executable local-only Docker adapter for the G038 dual-clone rehearsal.

The command intentionally exposes no database address, image, migration, Docker
context, service, or repository-layout override.  All database authority is
created inside two labelled disposable clone resources.
"""
from __future__ import annotations

import argparse
import errno
import hashlib
import json
import math
import os
import secrets
import stat
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType, SimpleNamespace
from typing import Any, Callable, Mapping, Sequence

import g035_hosted_recovery as g035
import g038_clone_rehearsal as receipt
import g038_production_controller as production
import g038_successor_executor as executor
from g038_successor_contract import (
    EXCLUDED_ROOT, RUNTIME_INVENTORY_ROOT, STATEMENT_VECTOR_ROOT,
    TARGET_FINGERPRINT, TERMINAL_SPEC_ROOT, canonical_sha256, load_manifest,
    repository_root,
)
import g038_successor_source
import g038_write_freeze

IMAGE = receipt.IMAGE
IMAGE_ID = receipt.IMAGE_ID
IMAGE_DIGEST = receipt.IMAGE_DIGEST
RUN_LABEL = "io.tzudong.g038.rehearsal"
CLONE_LABEL = "io.tzudong.g038.clone"
SERVICE = "g035-local"
DATABASE = "g035_local"
_TOOL_CUSTODY = {
    "docker": ("eade1c3a5dda47534dc776f2f534c99cc94cfcf9ce07c4bf09e98258d13e7d7a", ("--version",), "Docker version 29.6.2, build dfc4efb1e2"),
    "git": ("179301dcb41ea78accc3fa0048a7e6f6710d891945a751a34addd622020c1818", ("--version",), "git version 2.50.1 (Apple Git-155)"),
    "age": ("f52e5ee772e1c0e3c6be5bf837b469a40346df3515db9a1b41230376fdff6a76", ("--version",), "v1.3.1"),
    "pg_restore": ("6dc5fa5b2d2dfff6ae9919162f50cede4408475f1caf05e3da8e960354f60115", ("--version",), "pg_restore (PostgreSQL) 17.10 (Homebrew)"),
}


class LocalCloneError(RuntimeError):
    """Sanitized, fail-closed adapter error."""


def _fail(code: str) -> None:
    raise LocalCloneError(code) from None


def _sha_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
    except Exception:
        _fail("input_custody")
    return digest.hexdigest()


def _deadline(deadline_epoch: Any) -> float:
    if type(deadline_epoch) not in (int, float) or not math.isfinite(deadline_epoch):
        _fail("deadline")
    remaining = deadline_epoch - time.time()
    if remaining <= 1:
        _fail("deadline")
    return time.monotonic() + remaining


def _external_file(value: str, *, repository: Path, writable: bool = False) -> Path:
    try:
        path = Path(value)
        if not path.is_absolute() or path.is_symlink():
            _fail("input_custody")
        resolved = path.resolve(strict=True)
        info = resolved.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            _fail("input_custody")
        if resolved == repository or repository in resolved.parents:
            _fail("input_location")
        if writable and not os.access(resolved, os.W_OK):
            _fail("input_custody")
        return resolved
    except LocalCloneError:
        raise
    except Exception:
        _fail("input_custody")


def _fresh_output(value: str, *, repository: Path) -> Path:
    try:
        path = Path(value)
        if not path.is_absolute() or path.exists() or path.is_symlink():
            _fail("output_exists")
        parent = path.parent.resolve(strict=True)
        if parent == repository or repository in parent.parents:
            _fail("input_location")
        info = parent.stat()
        if info.st_uid != os.getuid() or info.st_mode & 0o077 or not os.access(parent, os.W_OK):
            _fail("input_custody")
        return parent / path.name
    except LocalCloneError:
        raise
    except Exception:
        _fail("input_custody")


def _fd(value: str | None) -> int:
    try:
        result = int(value or "", 10)
        if result < 3:
            _fail("channel")
        os.fstat(result)
        return result
    except LocalCloneError:
        raise
    except Exception:
        _fail("channel")


def _channel(fd_value: str | None, handle_value: str | None) -> int:
    original = -1
    try:
        if fd_value is not None:
            if os.name == "nt":
                _fail("channel")
            original = _fd(fd_value)
            import fcntl
            info = os.fstat(original)
            if not stat.S_ISFIFO(info.st_mode):
                _fail("channel")
            flags = fcntl.fcntl(original, fcntl.F_GETFL)
            if flags & os.O_ACCMODE != os.O_RDONLY:
                _fail("channel")
        else:
            if os.name != "nt":
                _fail("channel")
            import msvcrt
            handle = int(handle_value or "", 10)
            if handle <= 0:
                _fail("channel")
            original = msvcrt.open_osfhandle(handle, os.O_RDONLY)
        owned = os.dup(original)
        os.set_inheritable(owned, False)
        os.close(original)
        return owned
    except LocalCloneError:
        if original >= 0:
            try:
                os.close(original)
            except OSError:
                pass
        raise
    except Exception:
        if original >= 0:
            try:
                os.close(original)
            except OSError:
                pass
        _fail("channel")


def _read_channel(fd: int, *, maximum: int = 65536) -> bytes:
    chunks: list[bytes] = []
    total = 0
    try:
        while True:
            chunk = os.read(fd, min(8192, maximum + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > maximum:
                _fail("channel")
    except LocalCloneError:
        raise
    except Exception:
        _fail("channel")
    finally:
        try:
            os.close(fd)
        except OSError:
            pass
    raw = b"".join(chunks)
    if not raw:
        _fail("channel")
    return raw


def _tool(value: str, kind: str) -> str:
    try:
        path = Path(value)
        if not path.is_absolute():
            _fail("tool_custody")
        resolved = path.resolve(strict=True)
        info = resolved.stat()
        if (not stat.S_ISREG(info.st_mode) or info.st_uid not in (0, os.getuid())
                or info.st_mode & 0o022 or not os.access(resolved, os.X_OK)):
            _fail("tool_custody")
        expected_sha, version_args, expected_version = _TOOL_CUSTODY[kind]
        if _sha_file(resolved) != expected_sha:
            _fail("tool_custody")
        observed = subprocess.run(
            (os.fspath(resolved), *version_args), check=True, capture_output=True,
            text=True, timeout=10, env={"PATH": ""},
        )
        if (observed.stdout or observed.stderr).strip() != expected_version:
            _fail("tool_custody")
        return os.fspath(resolved)
    except LocalCloneError:
        raise
    except Exception:
        _fail("tool_custody")


def _json(path: Path) -> dict[str, Any]:
    try:
        raw = path.read_bytes()
        value = json.loads(raw)
        if type(value) is not dict or len(raw) > receipt.MAX_RECEIPT_BYTES:
            _fail("artifact_contract")
        return value
    except LocalCloneError:
        raise
    except Exception:
        _fail("artifact_contract")


def _evidence(value: Mapping[str, Any]) -> Mapping[str, Any]:
    candidate = value.get("evidence")
    if type(candidate) is not dict:
        candidate = value.get("body")
    if type(candidate) is not dict:
        _fail("artifact_contract")
    return candidate


@dataclass(frozen=True)
class Inputs:
    source_root: Path
    run_root: Path
    source_receipt: Path
    source_attestation_bundle: Path
    gh_path: Path
    archive: Path
    capture: Path
    backup: Path
    predecessor: Path
    predecessor_final: Path
    predecessor_readback: Path
    freeze: Path
    output: Path
    identity_channels: tuple[int, int]
    signing_channel: int
    deadline_monotonic: float
    docker: str
    git: str
    age: str
    pg_restore: str


class LocalCloneOps:
    """Real subprocess/database boundary; tests replace this whole boundary."""

    def __init__(self, inputs: Inputs, run_nonce: str):
        self.inputs = inputs
        self.run_nonce = run_nonce

    def command(self, argv: Sequence[str], *, check: bool = True,
                enforce_deadline: bool = True) -> subprocess.CompletedProcess[str]:
        if enforce_deadline and time.monotonic() >= self.inputs.deadline_monotonic:
            _fail("deadline")
        timeout = max(1, self.inputs.deadline_monotonic - time.monotonic()) if enforce_deadline else 30
        try:
            result = subprocess.run(list(argv), check=False, capture_output=True, text=True, timeout=timeout,
                                    env={"PATH": os.environ.get("PATH", "")})
        except Exception:
            _fail("tool_failure")
        if check and result.returncode != 0:
            _fail("tool_failure")
        return result

    def assert_local_docker(self) -> None:
        if any(os.environ.get(name) for name in ("DOCKER_HOST", "DOCKER_CONTEXT")):
            _fail("remote_docker")
        context = self.command((self.inputs.docker, "context", "show")).stdout.strip()
        if not context or any(character in context for character in "\r\n\0"):
            _fail("remote_docker")
        detail = self.command((self.inputs.docker, "context", "inspect", context)).stdout
        try:
            value = json.loads(detail)
            endpoint = value[0]["Endpoints"]["docker"]["Host"]
        except Exception:
            _fail("remote_docker")
        if not (type(endpoint) is str and (
                endpoint.startswith("unix://") or endpoint.startswith("npipe://"))):
            _fail("remote_docker")
        if endpoint.startswith("unix://") and type(self) is LocalCloneOps:
            socket_path = Path(endpoint.removeprefix("unix://")).resolve(strict=True)
            socket_info = socket_path.stat()
            if (not stat.S_ISSOCK(socket_info.st_mode)
                    or socket_info.st_uid != os.getuid() or socket_info.st_mode & 0o077):
                _fail("remote_docker")
            socket_identity: Mapping[str, Any] = {
                "path": os.fspath(socket_path), "uid": socket_info.st_uid,
                "device": socket_info.st_dev, "inode": socket_info.st_ino,
            }
        else:
            socket_identity = {"local_endpoint": endpoint}
        image = json.loads(self.command((self.inputs.docker, "image", "inspect", IMAGE)).stdout)[0]
        if image.get("Id") != IMAGE_ID or IMAGE_DIGEST not in image.get("RepoDigests", []):
            _fail("image_identity")
        server_raw = self.command((
            self.inputs.docker, "version", "--format", "{{json .Server}}",
        )).stdout.strip()
        try:
            server_identity = json.loads(server_raw)
        except Exception:
            _fail("remote_docker")
        object.__setattr__(self.inputs, "docker_identity_root", canonical_sha256({
            "context": context, "endpoint": endpoint,
            "socket_identity": socket_identity, "server": server_identity,
        }))

    def create_clone(self, slot: int) -> dict[str, Any]:
        network = f"g038-{self.run_nonce}-{slot}-net"
        container = f"g038-{self.run_nonce}-{slot}-db"
        labels = ("--label", f"{RUN_LABEL}={self.run_nonce}", "--label", f"{CLONE_LABEL}={slot}")
        network_options = (
            "--driver", "bridge",
            "--opt", "com.docker.network.bridge.enable_ip_masquerade=false",
            "--opt", "com.docker.network.bridge.enable_icc=false",
        )
        self.command((self.inputs.docker, "network", "create", *network_options, *labels, network))
        self.command((self.inputs.docker, "run", "-d", "--name", container, "--network", network,
                      "-p", "127.0.0.1::5432", "--user", "postgres", *labels, "--cap-drop=ALL",
                      "--security-opt=no-new-privileges", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", IMAGE))
        container_value = json.loads(self.command((self.inputs.docker, "inspect", container)).stdout)[0]
        network_value = json.loads(self.command((self.inputs.docker, "network", "inspect", network)).stdout)[0]
        host = container_value.get("HostConfig", {})
        config = container_value.get("Config", {})
        expected_labels = {RUN_LABEL: self.run_nonce, CLONE_LABEL: str(slot)}
        labels_ok = all(config.get("Labels", {}).get(key) == value for key, value in expected_labels.items())
        network_labels_ok = all(network_value.get("Labels", {}).get(key) == value for key, value in expected_labels.items())
        expected_network_options = {
            "com.docker.network.bridge.enable_ip_masquerade": "false",
            "com.docker.network.bridge.enable_icc": "false",
        }
        requested_bindings = host.get("PortBindings", {}).get("5432/tcp", [])
        assigned_bindings = container_value.get("NetworkSettings", {}).get("Ports", {}).get("5432/tcp", [])
        if (container_value.get("Image") != IMAGE_ID or config.get("Image") != IMAGE
                or config.get("User") != "postgres" or not labels_ok
                or host.get("Privileged") is not False or host.get("Binds") not in (None, [])
                or host.get("Mounts") not in (None, []) or host.get("CapAdd") not in (None, [])
                or host.get("CapDrop") != ["ALL"] or container_value.get("Mounts") != []
                or host.get("SecurityOpt") != ["no-new-privileges"]
                or network_value.get("Driver") != "bridge" or network_value.get("Internal") is not False
                or network_value.get("Attachable") is not False
                or network_value.get("Options") != expected_network_options or not network_labels_ok
                or requested_bindings != [{"HostIp": "127.0.0.1", "HostPort": ""}]):
            _fail("custody_drift")
        if (type(assigned_bindings) is not list or len(assigned_bindings) != 1
                or assigned_bindings[0].get("HostIp") != "127.0.0.1"
                or not str(assigned_bindings[0].get("HostPort", "")).isdigit()
                or int(assigned_bindings[0]["HostPort"]) <= 0):
            _fail("endpoint_custody")
        return {"slot": slot, "network": network, "container": container,
                "port": int(assigned_bindings[0]["HostPort"]),
                "container_inspect": container_value, "network_inspect": network_value}

    def assert_clone_custody(self, clone: Mapping[str, Any]) -> None:
        current_container = json.loads(self.command((self.inputs.docker, "inspect", str(clone["container"]))).stdout)[0]
        current_network = json.loads(self.command((self.inputs.docker, "network", "inspect", str(clone["network"]))).stdout)[0]
        if (receipt.custody_sha256(current_container) != receipt.custody_sha256(clone["container_inspect"])
                or receipt.custody_sha256(current_network, network=True)
                != receipt.custody_sha256(clone["network_inspect"], network=True)):
            _fail("custody_drift")

    def wait_ready(self, clone: Mapping[str, Any]) -> None:
        while time.monotonic() < self.inputs.deadline_monotonic:
            init = self.command(
                (self.inputs.docker, "exec", str(clone["container"]), "cat", "/proc/1/comm"),
                check=False,
            )
            if init.returncode == 0 and init.stdout == "postgres\n":
                ready = self.command(
                    (self.inputs.docker, "exec", str(clone["container"]), "pg_isready",
                     "-U", "postgres", "-d", "postgres"),
                    check=False,
                )
                if ready.returncode == 0:
                    return
            time.sleep(min(0.1, max(0.0, self.inputs.deadline_monotonic - time.monotonic())))
        _fail("deadline")

    def service_file(self, clone: Mapping[str, Any]) -> Path:
        self.command((self.inputs.docker, "exec", str(clone["container"]),
                      "createdb", "-U", "postgres", DATABASE))
        path = self.inputs.run_root / f"service-{clone['slot']}"
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        raw = f"[{SERVICE}]\nhost=127.0.0.1\nport={clone['port']}\ndbname={DATABASE}\nuser=postgres\napplication_name={SERVICE}\nsslmode=disable\n".encode("ascii")
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        return path

    def restore(self, clone: Mapping[str, Any], service: Path, identity_fd: int, restore_path: Path, manifest: Any) -> Mapping[str, Any]:
        if os.name == "nt":
            import msvcrt
            identity_fd_value, identity_handle_value = None, str(msvcrt.get_osfhandle(identity_fd))
        else:
            identity_fd_value, identity_handle_value = str(identity_fd), None
        args = SimpleNamespace(dump=str(self.inputs.archive), capture_receipt=str(self.inputs.capture),
                               restore_receipt=str(restore_path), service_file=str(service), destination_service=SERVICE,
                               identity_fd=identity_fd_value, identity_handle=identity_handle_value,
                               decrypt_command=self.inputs.age, pg_restore=self.inputs.pg_restore)
        evidence = g035.run_restore_verify(args, manifest)
        g035._publish_restore_receipt(args, evidence)
        return _json(restore_path)

    def connect(self, service: Path, *, autocommit: bool = False):
        try:
            import psycopg
            return psycopg.connect(
                f"service={SERVICE}", servicefile=str(service), autocommit=autocommit,
            )
        except Exception:
            _fail("database_connection")

    def rehearsal_connection(self, service: Path):
        return self.connect(service, autocommit=True)

    def begin_rehearsal_transaction(self, cursor: Any) -> None:
        cursor.execute("BEGIN ISOLATION LEVEL REPEATABLE READ")
        cursor.execute("SHOW transaction_isolation")
        row = cursor.fetchone()
        values = (tuple(row.values()) if type(row) is dict
                  else tuple(row) if type(row) in (tuple, list) else ())
        if values != ("repeatable read",):
            _fail("transaction_isolation")

    def database_identity(self, service: Path) -> tuple[str, str]:
        with self.connect(service) as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    "SELECT (SELECT system_identifier::text FROM pg_catalog.pg_control_system()), "
                    "(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=current_database())"
                )
                row = cursor.fetchone()
        values = tuple(row.values()) if type(row) is dict else tuple(row) if type(row) in (tuple, list) else ()
        if len(values) != 2 or any(type(value) is not str or not value.isdigit() for value in values):
            _fail("database_identity")
        return values[0], f"{values[0]}:{values[1]}"

    def survivors(self) -> tuple[str, ...]:
        result: list[str] = []
        failed = False
        for slot in ("1", "2"):
            filters = ("--filter", f"label={RUN_LABEL}={self.run_nonce}",
                       "--filter", f"label={CLONE_LABEL}={slot}")
            for query in (
                (self.inputs.docker, "ps", "-aq", *filters),
                (self.inputs.docker, "network", "ls", "-q", *filters),
            ):
                try:
                    result.extend(self.command(
                        query, check=False, enforce_deadline=False,
                    ).stdout.split())
                except Exception:
                    failed = True
        if failed:
            _fail("cleanup_survivors")
        return tuple(result)

    def cleanup(self) -> None:
        failed = False
        for slot in ("1", "2"):
            filters = ("--filter", f"label={RUN_LABEL}={self.run_nonce}",
                       "--filter", f"label={CLONE_LABEL}={slot}")
            try:
                containers = tuple(self.command(
                    (self.inputs.docker, "ps", "-aq", *filters),
                    check=False, enforce_deadline=False,
                ).stdout.split())
            except Exception:
                failed = True
                containers = ()
            try:
                networks = tuple(self.command(
                    (self.inputs.docker, "network", "ls", "-q", *filters),
                    check=False, enforce_deadline=False,
                ).stdout.split())
            except Exception:
                failed = True
                networks = ()
            for item in containers:
                try:
                    inspected = json.loads(self.command(
                        (self.inputs.docker, "inspect", item),
                        enforce_deadline=False,
                    ).stdout)[0]
                    labels = inspected.get("Config", {}).get("Labels", {})
                    if labels.get(RUN_LABEL) != self.run_nonce or labels.get(CLONE_LABEL) != slot:
                        raise LocalCloneError("cleanup_custody")
                    self.command(
                        (self.inputs.docker, "rm", "-f", item),
                        enforce_deadline=False,
                    )
                except Exception:
                    failed = True
            for item in networks:
                try:
                    inspected = json.loads(self.command(
                        (self.inputs.docker, "network", "inspect", item),
                        enforce_deadline=False,
                    ).stdout)[0]
                    labels = inspected.get("Labels", {})
                    if labels.get(RUN_LABEL) != self.run_nonce or labels.get(CLONE_LABEL) != slot:
                        raise LocalCloneError("cleanup_custody")
                    self.command(
                        (self.inputs.docker, "network", "rm", item),
                        enforce_deadline=False,
                    )
                except Exception:
                    failed = True
        try:
            if self.survivors():
                failed = True
        except Exception:
            failed = True
        if failed:
            _fail("cleanup_survivors")


class _StrictCleanup:
    """Idempotent owner for every private resource created or consumed by a run."""

    def __init__(self, inputs: Inputs, ops: LocalCloneOps):
        self.inputs = inputs
        self.ops = ops
        self.descriptors = set((*inputs.identity_channels, inputs.signing_channel))
        self.paths = tuple(
            inputs.run_root / name
            for name in ("service-1", "service-2", "restore-1.json", "restore-2.json")
        )

        self.external_admitted = False
        self.external_clean = False

    def admit_external_cleanup(self) -> None:
        self.external_admitted = True

    def handoff(self, descriptor: int) -> None:
        self.descriptors.discard(descriptor)

    def run(self, *, keep_signing: bool = False) -> None:
        failed = False
        external_failed = False
        if self.external_admitted and not self.external_clean:
            try:
                self.ops.cleanup()
            except Exception:
                failed = True
                external_failed = True
        for path in self.paths:
            try:
                path.unlink()
            except FileNotFoundError:
                pass
            except Exception:
                failed = True
        retained = {self.inputs.signing_channel} if keep_signing else set()
        for descriptor in tuple(self.descriptors - retained):
            try:
                os.close(descriptor)
            except OSError as exc:
                self.descriptors.discard(descriptor)
                if exc.errno != errno.EBADF:
                    failed = True
            else:
                self.descriptors.discard(descriptor)
        if self.external_admitted and not self.external_clean:
            try:
                if self.ops.survivors():
                    failed = True
                    external_failed = True
            except Exception:
                failed = True
                external_failed = True
            if not external_failed:
                self.external_clean = True
        if failed:
            _fail("cleanup_survivors")


def _state(value: executor.LiveState) -> receipt.State:
    if type(value) is not executor.LiveState:
        _fail("observation_contract")
    return receipt._new_state(
        value.classification, value.rows, value.ledger_root, value.catalog_root,
        value.acl_root, value.data_root,
    )


def _load_signer(fd: int) -> Callable[[bytes], bytes]:
    raw = bytearray(_read_channel(fd))
    try:
        from cryptography.hazmat.primitives.serialization import load_pem_private_key
        key = load_pem_private_key(bytes(raw), password=None)
        public = key.public_key().public_bytes_raw()
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
        if type(key.public_key()) is not Ed25519PublicKey:
            _fail("signing_key")
        expected = receipt.PUBLIC_KEY_PEM.encode("ascii")
        from cryptography.hazmat.primitives.serialization import load_pem_public_key
        if load_pem_public_key(expected).public_bytes_raw() != public:
            _fail("signing_key")
        return key.sign
    except LocalCloneError:
        raise
    except Exception:
        _fail("signing_key")
    finally:
        raw[:] = b"\0" * len(raw)


def _sign_and_publish(
    result: receipt.SealedRehearsal, *, signing_channel: int, output: Path,
) -> Mapping[str, Any]:
    if (type(result) is not receipt.SealedRehearsal
            or getattr(result, "_seal", None) is not receipt._RESULT_SEAL):
        _fail("rehearsal_contract")
    signer = _load_signer(signing_channel)
    try:
        signature = signer(result.unsigned)
    except Exception:
        _fail("receipt_signature")
    if type(signature) is not bytes or len(signature) != 64:
        _fail("receipt_signature")
    receipt._verify_signature(result.unsigned, signature)
    unsigned_value = json.loads(result.unsigned)
    if (type(unsigned_value) is not dict or unsigned_value.get("schema") != receipt.SCHEMA
            or unsigned_value.get("kind") != receipt.KIND
            or type(unsigned_value.get("body")) is not dict
            or executor.canonical_json_bytes(unsigned_value) != result.unsigned):
        _fail("rehearsal_contract")
    envelope = {
        "schema": receipt.SCHEMA, "kind": receipt.KIND,
        "body": unsigned_value["body"],
        "signature_b64": __import__("base64").b64encode(signature).decode("ascii"),
    }
    raw = executor.canonical_json_bytes(envelope) + b"\n"
    if len(raw) > receipt.MAX_RECEIPT_BYTES:
        _fail("receipt_bounds")
    receipt._publish(output, raw)
    return MappingProxyType({
        "schema": receipt.SCHEMA,
        "receipt_sha256": hashlib.sha256(raw).hexdigest(),
    })


def _backup_hash(body: Mapping[str, Any], field: str) -> str:
    value = body.get(field)
    if (type(value) is not str or len(value) != 64
            or any(character not in "0123456789abcdef" for character in value)):
        _fail("artifact_contract")
    return value


def _admit_backup(
    inputs: Inputs, source: Any, manifest: Any, verified_freeze: Any,
) -> tuple[dict[str, Any], str, production.SourceEvidence]:
    backup_args = SimpleNamespace(
        repository_root=str(inputs.source_root),
        source_receipt=str(inputs.source_receipt),
        source_attestation_bundle=str(inputs.source_attestation_bundle),
        gh_path=str(inputs.gh_path),
        backup_receipt=str(inputs.backup),
        capture_receipt=str(inputs.capture),
        archive=str(inputs.archive),
    )
    source_evidence = production._load_source_receipt(
        backup_args, source, manifest,
    )
    if type(source_evidence) is not production.SourceEvidence:
        _fail("source_evidence")
    backup_raw = production._stable_bytes(inputs.backup, inputs.source_root)
    preliminary = production._signed_document(
        backup_raw, schema=production.SCHEMA, kind="production-backup",
        pem=production._RECEIPT_PUBLIC_KEY_PEM,
        key_sha256=production._RECEIPT_PUBLIC_KEY_SHA256,
    )
    observation_sha = _backup_hash(preliminary, "observation_receipt_sha256")
    backup, backup_sha = production._load_backup(
        backup_args, source, source_evidence, observation_sha, verified_freeze,
    )
    expected_source_hashes = {
        "source_validation_receipt_sha256": source_evidence.binding_sha256,
        "source_attestation_bundle_sha256": source_evidence.bundle_sha256,
        "verified_source_provenance_sha256": source_evidence.provenance_sha256,
    }
    if any(backup.get(field) != value for field, value in expected_source_hashes.items()):
        _fail("source_evidence")
    production._revalidate_backup_artifacts(backup_args, backup)
    return backup, backup_sha, source_evidence


def _bindings(
    inputs: Inputs, source: Any, manifest: Any,
    artifacts: Mapping[str, Mapping[str, Any]], starting: executor.LiveState,
) -> dict[str, Any]:
    archive_sha = _sha_file(inputs.archive)
    predecessor = production._predecessor(SimpleNamespace(
        repository_root=str(inputs.source_root),
        predecessor_report=str(inputs.predecessor),
        predecessor_final_receipt=str(inputs.predecessor_final),
        predecessor_readback_receipt=str(inputs.predecessor_readback),
    ))
    starting_roots = {
        "ledger": starting.ledger_root, "catalog": starting.catalog_root,
        "acl": starting.acl_root, "data": starting.data_root,
        "spec": predecessor.roots["spec"],
    }
    manifest_root, source_root = production._manifest_roots(inputs.source_root, manifest)
    verified_freeze = g038_write_freeze.verify_freeze_assertion(
        artifacts["freeze"], source_commit=source.final_commit,
        runtime_source_root=source.runtime_source_root,
        manifest_root=manifest_root, starting_roots=starting_roots,
    )
    backup, backup_sha, _ = _admit_backup(
        inputs, source, manifest, verified_freeze,
    )
    capture = g035.read_json_receipt(inputs.capture)
    if capture.get("mode") != "capture" or capture.get("receipt_sha256") != backup["g035_receipt_sha256"]:
        _fail("artifact_contract")
    return {
        "source_commit": source.final_commit,
        "runtime_source_root": source.runtime_source_root,
        "source_root": source_root,
        "manifest_root": manifest_root,
        "vector_root": STATEMENT_VECTOR_ROOT,
        "terminal_spec_root": TERMINAL_SPEC_ROOT,
        "exclusions_root": EXCLUDED_ROOT,
        "inventory_root": RUNTIME_INVENTORY_ROOT,
        "target_fingerprint": TARGET_FINGERPRINT,
        "tool_identity_root": canonical_sha256({
            name: {"sha256": custody[0], "version": custody[2]}
            for name, custody in sorted(_TOOL_CUSTODY.items())
        }),
        "docker_daemon_root": getattr(inputs, "docker_identity_root", None),
        "predecessor_report_sha256": predecessor.report_sha256,
        "predecessor_outcome_sha256": predecessor.final_receipt_sha256,
        "predecessor_readback_sha256": predecessor.readback_receipt_sha256,
        "backup_receipt_sha256": backup_sha,
        "capture_receipt_sha256": _sha_file(inputs.capture),
        "archive_sha256": archive_sha,
        "archive_bytes": inputs.archive.stat().st_size,
        "freeze_root": verified_freeze.root,
        "freeze_expires_at": verified_freeze.expires_at,
        **{f"starting_{name}_root": getattr(starting, f"{name}_root") for name in ("ledger", "catalog", "acl", "data")},
        "selected_versions": list(executor.SELECTED_VERSIONS),
    }


def run(inputs: Inputs, *, ops_factory: Callable[[Inputs, str], LocalCloneOps] = LocalCloneOps) -> Mapping[str, Any]:
    run_nonce = secrets.token_hex(16)
    ops = ops_factory(inputs, run_nonce)
    cleanup = _StrictCleanup(inputs, ops)
    clones: list[dict[str, Any]] = []
    services: list[Path] = []
    service_hashes: list[str] = []
    try:
        if time.monotonic() >= inputs.deadline_monotonic:
            _fail("deadline")
        g038_successor_source.assert_isolated_bootstrap()
        def git_runner(argv: Sequence[str], **kwargs: Any):
            return subprocess.run((inputs.git, *argv[1:]), **kwargs)
        exact_head = git_runner(
            ("git", "-C", str(inputs.source_root), "rev-parse", "--verify", "HEAD^{commit}"),
            check=True, capture_output=True, text=True,
        ).stdout.strip()
        source = g038_successor_source.verify_successor_source(
            inputs.source_root, exact_head, production=True, runner=git_runner,
        )
        cleanup.admit_external_cleanup()
        ops.assert_local_docker()

        manifest = load_manifest(inputs.source_root)
        plan = executor.compile_plan(inputs.source_root, manifest)
        artifacts = {name: _json(path) for name, path in (("capture", inputs.capture), ("backup", inputs.backup), ("predecessor", inputs.predecessor), ("freeze", inputs.freeze))}
        predecessor = production._predecessor(SimpleNamespace(
            repository_root=str(inputs.source_root),
            predecessor_report=str(inputs.predecessor),
            predecessor_final_receipt=str(inputs.predecessor_final),
            predecessor_readback_receipt=str(inputs.predecessor_readback),
        ))
        claimed_start = executor.LiveState(
            executor.EXACT_40, 40, predecessor.roots["ledger"],
            predecessor.roots["catalog"], predecessor.roots["acl"],
            predecessor.roots["data"],
        )
        authenticated_bindings = _bindings(
            inputs, source, manifest, artifacts, claimed_start,
        )
        for slot in (1, 2):
            clone = ops.create_clone(slot)
            ops.wait_ready(clone)
            service = ops.service_file(clone)
            restore_path = inputs.run_root / f"restore-{slot}.json"
            restored = ops.restore(clone, service, inputs.identity_channels[slot - 1], restore_path, manifest)
            ops.assert_clone_custody(clone)
            clone["restore"] = restored
            clones.append(clone)
            services.append(service)
            service_hashes.append(_sha_file(service))
        if inputs.identity_channels[0] == inputs.identity_channels[1]:
            _fail("duplicate_identity")
        capture_receipt_id = artifacts["capture"].get("receipt_sha256")
        restore_lineages = [clone["restore"].get("prior_receipt_sha256") for clone in clones]
        if (type(capture_receipt_id) is not str or len(capture_receipt_id) != 64
                or restore_lineages != [[capture_receipt_id], [capture_receipt_id]]):
            _fail("restore_lineage")

        target_holder: list[executor.LiveState] = []
        current_capability: list[executor.RehearsalCapability] = []
        def observe(slot: int) -> receipt.State:
            ops.assert_clone_custody(clones[slot])
            if _sha_file(services[slot]) != service_hashes[slot]:
                _fail("custody_drift")
            with ops.connect(services[slot]) as conn:
                with conn.cursor() as cursor:
                    live = executor.observe_live_state(cursor, plan=plan,
                        predecessor_ledger_root=canonical_sha256(tuple(executor.PREDECESSOR_PAIRS)),
                        target_ledger_root=canonical_sha256(tuple(executor.PREDECESSOR_PAIRS) + tuple((e.migration.version, e.migration.name) for e in plan.compiled)),
                        deadline_monotonic=inputs.deadline_monotonic)
                    return _state(live)
        starting_live: list[executor.LiveState] = []
        for slot in (0, 1):
            value = observe(slot)
            starting_live.append(executor.LiveState(
                value.classification, value.rows, value.ledger_root, value.catalog_root,
                value.acl_root, value.data_root,
            ))
        if starting_live[0] != starting_live[1]:
            _fail("mixed_roots")

        def owner(subject: Any, commit: bool, callback: Callable[[Any], Any]) -> receipt.Applied:
            slot = int(subject)
            ops.assert_clone_custody(clones[slot])
            if _sha_file(services[slot]) != service_hashes[slot]:
                _fail("custody_drift")
            with ops.rehearsal_connection(services[slot]) as conn:
                try:
                    with conn.cursor() as cursor:
                        ops.begin_rehearsal_transaction(cursor)
                        sentinel = secrets.token_hex(32)
                        cursor.execute("SELECT pg_catalog.set_config('g038.rehearsal_sentinel', %s, true)", (sentinel,))
                        cursor.execute("SELECT pg_catalog.pg_current_xact_id()::text")
                        row = cursor.fetchone()
                        xid = str(row[0] if type(row) in (tuple, list) else next(iter(row.values())))
                        target = target_holder[0] if slot == 1 and target_holder else None
                        capability = executor._new_rehearsal_capability(plan=plan, starting=starting_live[slot], target=target,
                            transaction_sentinel=sentinel, transaction_xid=xid, deadline_monotonic=inputs.deadline_monotonic)
                        current_capability[:] = [capability]
                        evidence = callback(cursor)
                        terminal = executor.observe_live_state(cursor, plan=plan,
                            predecessor_ledger_root=starting_live[slot].ledger_root,
                            target_ledger_root=canonical_sha256(tuple(executor.PREDECESSOR_PAIRS) + tuple((e.migration.version, e.migration.name) for e in plan.compiled)),
                            deadline_monotonic=inputs.deadline_monotonic)
                        if slot == 0:
                            target_holder[:] = [terminal]
                        if commit:
                            conn.commit()
                        else:
                            conn.rollback()
                        ops.assert_clone_custody(clones[slot])
                        if _sha_file(services[slot]) != service_hashes[slot]:
                            _fail("custody_drift")
                        return receipt.Applied(_state(terminal), evidence.evidence_sha256)
                except Exception:
                    try: conn.rollback()
                    except Exception: pass
                    raise
        def apply(cursor: Any) -> executor.ExecutionEvidence:
            if len(current_capability) != 1:
                _fail("transaction_order")
            return executor.apply_rehearsal_cursor(cursor, capability=current_capability.pop())

        # Handles contain only hashes; private service and endpoint material never enters the receipt.
        handles = []
        for slot, clone in enumerate(clones, 1):
            ci, ni = clone["container_inspect"], clone["network_inspect"]
            restore_sha = canonical_sha256({
                "schema": "g038-local-restore-identity-v1",
                "g035_restore_receipt_sha256": _sha_file(inputs.run_root / f"restore-{slot}.json"),
                "service_file_sha256": service_hashes[slot - 1],
                "clone_nonce": f"g038-clone-{slot}-{run_nonce}",
            })
            system_identifier, database_oid = ops.database_identity(services[slot - 1])
            handles.append(receipt.CloneHandle(subject=slot - 1, clone_nonce=f"g038-clone-{slot}-{run_nonce}",
                system_identifier=system_identifier, database_oid=database_oid,
                service_file_sha256=_sha_file(services[slot - 1]), endpoint_sha256=hashlib.sha256(f"127.0.0.1:{clone['port']}".encode()).hexdigest(),
                container_id_sha256=hashlib.sha256(str(ci.get("Id")).encode()).hexdigest(), image_id_sha256=hashlib.sha256(IMAGE_ID.encode()).hexdigest(),
                image_digest_sha256=hashlib.sha256(IMAGE_DIGEST.encode()).hexdigest(), container_custody_sha256=receipt.custody_sha256(ci),
                network_custody_sha256=receipt.custody_sha256(ni, network=True), restore_receipt_sha256=restore_sha))
        if starting_live[0] != claimed_start:
            _fail("mixed_roots")
        bound = authenticated_bindings

        def cleanup_gate() -> None:
            cleanup.run(keep_signing=True)

        sealed = receipt.run_dual_clone_rehearsal(
            bindings=bound, first=handles[0], second=handles[1],
            read_state=lambda subject: observe(int(subject)), transaction_owner=owner,
            apply_cursor=apply, cleanup=cleanup_gate, now=int(time.time()),
        )
        cleanup.handoff(inputs.signing_channel)
        try:
            return _sign_and_publish(
                sealed, signing_channel=inputs.signing_channel, output=inputs.output,
            )
        finally:
            try:
                os.close(inputs.signing_channel)
            except OSError:
                pass
    finally:
        cleanup.run()


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(allow_abbrev=False)
    for name in ("source-root", "run-root", "source-receipt", "source-attestation-bundle", "gh-path", "archive", "capture-receipt", "backup-receipt", "predecessor-report", "predecessor-final-receipt", "predecessor-readback-receipt", "freeze-receipt", "output"):
        p.add_argument(f"--{name}", required=True)
    identity1 = p.add_mutually_exclusive_group(required=True); identity1.add_argument("--identity-fd-1"); identity1.add_argument("--identity-handle-1")
    identity2 = p.add_mutually_exclusive_group(required=True); identity2.add_argument("--identity-fd-2"); identity2.add_argument("--identity-handle-2")
    signing = p.add_mutually_exclusive_group(required=True); signing.add_argument("--clone-signing-key-fd"); signing.add_argument("--clone-signing-key-handle")
    p.add_argument("--deadline-epoch", required=True, type=float)
    p.add_argument("--docker", required=True); p.add_argument("--git", required=True)
    p.add_argument("--age", required=True); p.add_argument("--pg-restore", required=True)
    return p


def _inputs(args: argparse.Namespace) -> Inputs:
    repo = repository_root(Path(__file__).resolve()).resolve(strict=True)
    source_path = Path(args.source_root)
    run_path = Path(args.run_root)
    if source_path.is_symlink() or run_path.is_symlink():
        _fail("input_custody")
    source = source_path.resolve(strict=True)
    run_root = run_path.resolve(strict=True)
    if source != repo or run_root == repo or repo in run_root.parents:
        _fail("input_location")
    source_info = source.stat()
    run_info = run_root.stat()
    if (not source.is_dir() or source_info.st_uid != os.getuid() or source_info.st_mode & 0o077
            or not run_root.is_dir() or run_info.st_uid != os.getuid() or run_info.st_mode & 0o077):
        _fail("input_custody")
    source_artifacts = [
        _external_file(value, repository=repo)
        for value in (
            args.source_receipt, args.source_attestation_bundle, args.gh_path,
        )
    ]
    artifacts = [_external_file(value, repository=repo) for value in (args.archive, args.capture_receipt, args.backup_receipt, args.predecessor_report, args.predecessor_final_receipt, args.predecessor_readback_receipt, args.freeze_receipt)]
    archive_size = artifacts[0].stat().st_size
    if not 0 < archive_size <= receipt.MAX_ARCHIVE_BYTES:
        _fail("artifact_contract")
    channel1 = _channel(args.identity_fd_1, args.identity_handle_1)
    channel2 = _channel(args.identity_fd_2, args.identity_handle_2)
    signing = _channel(args.clone_signing_key_fd, args.clone_signing_key_handle)
    identities = tuple((os.fstat(fd).st_dev, os.fstat(fd).st_ino) for fd in (channel1, channel2, signing))
    if len(set(identities)) != 3:
        for fd in (channel1, channel2, signing):
            try:
                os.close(fd)
            except OSError:
                pass
        _fail("duplicate_identity")
    return Inputs(source, run_root, *source_artifacts, *artifacts, _fresh_output(args.output, repository=repo), (channel1, channel2), signing,
                  _deadline(args.deadline_epoch), _tool(args.docker, "docker"), _tool(args.git, "git"),
                  _tool(args.age, "age"), _tool(args.pg_restore, "pg_restore"))


def main(argv: Sequence[str] | None = None) -> int:
    try:
        args = parser().parse_args(argv)
    except SystemExit as exc:
        return exc.code if type(exc.code) is int else 2
    try:
        g038_successor_source.assert_isolated_bootstrap()
    except Exception:
        return 1
    try:
        run(_inputs(args))
        return 0
    except Exception:
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
