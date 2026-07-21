#!/usr/bin/env python3
"""Local-only, two-clone G040 rehearsal evidence runner.

The command accepts service names plus libpq service files, never a DSN or URL.
All operator-visible receipts are compact canonical JSON containing roots, never
connection settings, rows, passwords, keys, or Docker inspect output.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import time
from pathlib import Path
from types import MappingProxyType, SimpleNamespace
from typing import Any, Mapping

import g037_managed_recovery as crypto
import g035_hosted_recovery as g035
import g040_production_controller as controller
from g037_hosted_closure_contract import terminal_spec, validate_operator_assertion, validate_sources
import g040_prefix_recovery as prefix
from g037_hosted_closure_executor import vectors
import g040_prefix_executor as executor
from g040_prefix_executor import (
    _admit_verified_clone,
    _apply_rehearsal_locked_cursor,
    _derive_clone_terminal_expectation,
    build_source_validation_plan,
    compile_branch_plan,
)
from g040_prefix_recovery import CATALOG_PROBE, DATA_PROBE, begin_read_only_snapshot, probe_full_data_root, validate_full_data_root
from g040_recovery_source import SourceBinding, verify_recovery_source
from g037_hosted_closure_executor import terminal_readback_assert
from g040_reverse_00400 import DERIVATION_MODE, REVERSE_VECTOR, REVERSE_VECTOR_SHA256
from g040_reference_evidence import (
    PUBLIC_KEY_PEM as REFERENCE_PUBLIC_KEY_PEM,
    PUBLIC_KEY_SHA256 as REFERENCE_PUBLIC_KEY_SHA256,
    build_reference_request,
    finalize_reference,
    verify_reference,
)

_HEX = re.compile(r"^[0-9a-f]{64}$")
_SAFE = re.compile(r"^[A-Za-z0-9_-]{16,128}$")
_IMAGE = "supabase/postgres:17.6.1.147"
_IMAGE_DIGEST = "supabase/postgres@sha256:ac581882596ed0e46937ea6dd53a627d09f53e005d7264c2082a7ff7b62eaaca"
_IMAGE_ID = "sha256:ac581882596ed0e46937ea6dd53a627d09f53e005d7264c2082a7ff7b62eaaca"
_LABEL = "com.tzudong.g040.rehearsal"
_RUN_LABEL = "com.tzudong.g040.run"
_SLOT_LABEL = "com.tzudong.g040.slot"
_G040_LABELS = frozenset({_LABEL, _RUN_LABEL, _SLOT_LABEL})
_ARCHIVE_CHUNK = 64 * 1024
_MAX_ARTIFACT = 1_048_576
_LOCAL_MUTATION_TIMEOUT_SECONDS = 300
_REFERENCE_CUSTODY_QUERY = (
    "SELECT session_user AS session_user, current_user AS current_user, "
    "current_database() AS database_name"
)
_LINEAGE_PUBLIC_KEY_PEM = b"""-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAqQPGXBPVi3se+xn9DUdVgXHeAgG82FSeWByugLeMqaQ=
-----END PUBLIC KEY-----
"""
_LINEAGE_PUBLIC_KEY_SHA256 = "de810d6b46b4032803f0a28d8febf9f574738df86ff3dd0a90e703c680018c28"
_LINEAGE_SCHEMA = "g040-offline-clone-lineage-v1"


class RehearsalError(RuntimeError):
    pass


def _fail(code: str) -> None:
    raise RehearsalError(code) from None


def _canonical(value: Any) -> bytes:
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode("ascii")
    except Exception:
        _fail("canonical_json")


def _pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if type(key) is not str or key in result:
            _fail("noncanonical_json")
        result[key] = value
    return result


def _load(path: str | Path) -> Mapping[str, Any]:
    try:
        raw = Path(path).read_bytes()
        if len(raw) > _MAX_ARTIFACT:
            _fail("artifact_bounds")
        value = json.loads(raw.decode("ascii"), object_pairs_hook=_pairs)
        if type(value) is not dict or raw != _canonical(value):
            _fail("noncanonical_json")
        return MappingProxyType(value)
    except RehearsalError:
        raise
    except Exception:
        _fail("artifact_read")


def _write(path: str | Path, value: Mapping[str, Any]) -> None:
    target = Path(path)
    temporary: Path | None = None
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() or target.is_symlink():
            _fail("output_exists")
        data = _canonical(dict(value))
        if len(data) > _MAX_ARTIFACT:
            _fail("artifact_bounds")
        temporary = target.parent / f".{target.name}.{os.getpid()}.{time.time_ns()}.tmp"
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        try:
            os.link(temporary, target)
        except FileExistsError:
            _fail("output_exists")
        os.unlink(temporary)
        temporary = None
    except RehearsalError:
        raise
    except Exception:
        _fail("artifact_write")
    finally:
        if temporary is not None:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass


def _sha(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _hash_file(path: str | Path) -> str:
    try:
        return _sha(Path(path).read_bytes())
    except Exception:
        _fail("artifact_read")
def _custody_bytes(path: str | Path, root: str | Path) -> bytes:
    try:
        resolved_root = Path(root).resolve()
        return controller._stable_bytes(controller._outside(path, resolved_root), resolved_root)
    except Exception:
        _fail("lineage_custody")


def _load_bytes(raw: bytes) -> Mapping[str, Any]:
    try:
        value = json.loads(raw.decode("ascii"), object_pairs_hook=_pairs)
        if type(value) is not dict or raw != _canonical(value):
            _fail("noncanonical_json")
        return MappingProxyType(value)
    except RehearsalError:
        raise
    except Exception:
        _fail("artifact_read")


def _parse_local_service(raw: bytes, service_name: str) -> Mapping[str, Any]:
    if service_name != "g035-local":
        _fail("service_name")
    try:
        lines = raw.decode("utf-8").splitlines()
    except Exception:
        _fail("service_file")
    values: dict[str, str] = {}
    active = False
    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith(("#", ";")):
            continue
        if line.startswith("[") and line.endswith("]"):
            active = line[1:-1] == service_name
        elif active and "=" in line:
            key, value = (part.strip() for part in line.split("=", 1))
            if not key or key in values:
                _fail("service_file")
            values[key] = value
    required = {"host", "port", "dbname", "user", "application_name", "sslmode", "password"}
    if (set(values) != required or values["host"] != "127.0.0.1" or not values["port"].isdigit()
            or not 1 <= int(values["port"]) <= 65535 or values["dbname"] != "g035_local"
            or values["user"] != "supabase_admin" or values["sslmode"] != "disable"
            or "g035-local" not in values["application_name"]):
        _fail("nonlocal_service")
    if any("//" in values[key] for key in ("host", "dbname", "application_name")):
        _fail("service_file")
    return MappingProxyType({"service": service_name, "port": int(values["port"]), "application_name_sha256": _sha(values["application_name"].encode())})


def parse_local_service(path: str | Path, service_name: str = "g035-local") -> Mapping[str, Any]:
    """Validate one local libpq service stanza without exposing credentials."""
    try:
        return _parse_local_service(Path(path).read_bytes(), service_name)
    except RehearsalError:
        raise
    except Exception:
        _fail("service_file")


def _service_custody(path: str | Path, repository_root: str | Path) -> tuple[Path, bytes, tuple[int, int]]:
    try:
        candidate = controller.authority.restrictive_regular_file(path, "service file", repository_root)
        raw = controller._stable_bytes(candidate, Path(repository_root).resolve())
        info = candidate.stat(follow_symlinks=False)
        return candidate, raw, (info.st_dev, info.st_ino)
    except Exception:
        _fail("service_file")


def _connect_service(service_file: str | Path, service_name: str, *, readonly: bool,
                     repository_root: str | Path | None = None) -> tuple[Any, Mapping[str, Any]]:
    root = Path(repository_root).resolve() if repository_root is not None else Path(__file__).resolve().parents[3]
    path, before, identity = _service_custody(service_file, root)
    service = _parse_local_service(before, service_name)
    conn = None
    try:
        import psycopg
        from psycopg.rows import dict_row
        identity_variables = (
            "PGSERVICE", "PGUSER", "PGPASSWORD", "PGPASSFILE", "PGDATABASE",
            "PGHOST", "PGHOSTADDR", "PGPORT", "PGOPTIONS",
        )
        prior_environment = {key: os.environ.pop(key, None) for key in identity_variables}
        prior_service_file = os.environ.get("PGSERVICEFILE")
        os.environ["PGSERVICEFILE"] = str(path)
        try:
            conn = psycopg.connect(service=service_name, autocommit=False,
                                   connect_timeout=20, row_factory=dict_row,
                                   options="-c default_transaction_read_only=on" if readonly else None)
        finally:
            if prior_service_file is None:
                os.environ.pop("PGSERVICEFILE", None)
            else:
                os.environ["PGSERVICEFILE"] = prior_service_file
            for key, value in prior_environment.items():
                if value is not None:
                    os.environ[key] = value
        after_path, after, after_identity = _service_custody(path, root)
        if after_path != path or after != before or after_identity != identity:
            _fail("service_replaced")
        info = conn.info
        if info.host != "127.0.0.1" or info.port != service["port"]:
            _fail("service_endpoint")
        return conn, service
    except RehearsalError:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
        raise
    except Exception:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
        _fail("connection_unavailable")


def _query_one(cursor: Any, sql: str) -> Mapping[str, Any]:
    cursor.execute(sql)
    row = cursor.fetchone()
    if not isinstance(row, Mapping):
        _fail("probe_result")
    return row


def admit_image(image: str, metadata: Mapping[str, Any]) -> Mapping[str, Any]:
    if image != _IMAGE or metadata.get("server_version_num") != 170006:
        _fail("image_admission")
    extensions, roles = metadata.get("extensions"), metadata.get("roles")
    if (not isinstance(extensions, (list, tuple, set)) or not isinstance(roles, (list, tuple, set))
            or not {"pg_trgm", "uuid-ossp", "btree_gin", "vector", "pgcrypto"} <= set(extensions)
            or not {"postgres", "supabase_admin"} <= set(roles)):
        _fail("image_admission")
    return MappingProxyType({"image": image, "server_version_num": 170006, "extensions_admitted": True, "roles_admitted": True})


def preflight(*, service_file: str | Path, service_name: str, image: str, image_metadata: str | Path) -> Mapping[str, Any]:
    metadata = dict(_load(image_metadata))
    if metadata.get("image") != image:
        _fail("image_admission")
    conn, _ = _connect_service(service_file, service_name, readonly=True)
    cur = None
    try:
        cur = conn.cursor()
        cur.execute("SELECT current_setting('server_version_num')::integer AS server_version_num")
        row = cur.fetchone()
        version = row[0] if isinstance(row, tuple) else row.get("server_version_num")
        cur.execute("SELECT extname FROM pg_extension")
        extensions = {str(item[0] if isinstance(item, tuple) else item["extname"]) for item in cur.fetchall()}
        cur.execute("SELECT rolname FROM pg_roles")
        roles = {str(item[0] if isinstance(item, tuple) else item["rolname"]) for item in cur.fetchall()}
        checked = admit_image(image, {**metadata, "server_version_num": version, "extensions": extensions, "roles": roles})
        return {"schema": "g040-clone-preflight-v1", **checked, "service": service_name}
    except RehearsalError:
        raise
    except Exception:
        _fail("preflight_failed")
    finally:
        if cur:
            cur.close()
        try:
            conn.rollback(); conn.close()
        except Exception:
            pass


def _live_identity(conn: Any) -> Mapping[str, Any]:
    cursor = conn.cursor()
    try:
        row = _query_one(cursor, "SELECT (pg_control_system()).system_identifier::text AS system_identifier, (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid, current_database() AS database_name, current_setting('server_version') AS server_version, current_setting('server_version_num')::integer AS server_version_num")
    finally:
        cursor.close()
    required = {"system_identifier", "database_oid", "database_name", "server_version", "server_version_num"}
    if (set(row) != required or row["server_version"] != "17.6" or row["server_version_num"] != 170006
            or not all(type(row[key]) is str and row[key] for key in required - {"server_version_num"})):
        _fail("live_identity")
    return MappingProxyType(dict(row))


_INTERNAL_IDENTITY_QUERY = (
    "SELECT (pg_control_system()).system_identifier::text, "
    "(SELECT oid::text FROM pg_database WHERE datname=current_database()), "
    "current_database(), current_setting('server_version'), "
    "current_setting('server_version_num')::integer"
)


def _internal_exec_identity(container: str, docker: str) -> Mapping[str, Any]:
    result = subprocess.run(
        [docker, "exec", container, "/usr/bin/env", "-i", "PATH=/usr/bin:/bin", "/usr/bin/psql",
         "-X", "--host", "/var/run/postgresql", "--port", "5432",
         "--username", "supabase_admin", "--dbname", "g035_local",
         "-A", "-t", "-F", "\x1f", "-c", _INTERNAL_IDENTITY_QUERY],
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        timeout=20, check=True,
    )
    raw = result.stdout
    if (not isinstance(raw, bytes) or not raw.endswith(b"\n") or raw.count(b"\n") != 1
            or b"\r" in raw):
        _fail("docker_identity")
    try:
        fields = raw[:-1].decode("ascii").split("\x1f")
    except UnicodeDecodeError:
        _fail("docker_identity")
    keys = ("system_identifier", "database_oid", "database_name", "server_version", "server_version_num")
    if (len(fields) != len(keys) or any(not value or any(ord(char) < 32 or ord(char) > 126 for char in value)
                                        for value in fields)
            or not fields[-1].isdigit()):
        _fail("docker_identity")
    return MappingProxyType({**dict(zip(keys[:-1], fields[:-1])), "server_version_num": int(fields[-1])})


def _docker_clone_proof(container: str, service_port: int, live_identity: Mapping[str, Any] | None = None,
                        docker: str = "docker") -> Mapping[str, Any]:
    if not _SAFE.fullmatch(container or "") or type(service_port) is not int or not 1 <= service_port <= 65535:
        _fail("docker_identity")
    try:
        item = json.loads(subprocess.run([docker, "inspect", "--type", "container", container], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=20, check=True).stdout.decode("utf-8"))
        if type(item) is not list or len(item) != 1 or type(item[0]) is not dict:
            _fail("docker_identity")
        item = item[0]; config, settings, host = item.get("Config"), item.get("NetworkSettings"), item.get("HostConfig")
        labels = config.get("Labels") if type(config) is dict else None
        networks = settings.get("Networks") if type(settings) is dict else None
        ports = settings.get("Ports") if type(settings) is dict else None
        container_id, image_id = item.get("Id"), item.get("Image")
        g040_labels = {key: value for key, value in labels.items() if key.startswith("com.tzudong.g040.")} if type(labels) is dict else {}
        common_invalid = (
            type(labels) is not dict or set(g040_labels) != _G040_LABELS or labels.get(_LABEL) != "true"
            or not _SAFE.fullmatch(labels.get(_RUN_LABEL, "")) or not _SAFE.fullmatch(labels.get(_SLOT_LABEL, ""))
            or config.get("Image") != _IMAGE or config.get("ExposedPorts") != {"5432/tcp": {}}
            or type(host) is not dict or host.get("NetworkMode") in {"host", "bridge", "default"}
            or host.get("Privileged") is not False or host.get("Binds") not in (None, []) or item.get("Mounts") not in (None, [])
            or host.get("Mounts") not in (None, []) or host.get("CapAdd") not in (None, [])
            or host.get("CapDrop") not in (None, []) or type(networks) is not dict or len(networks) != 1
            or type(container_id) is not str or not re.fullmatch(r"[0-9a-f]{64}", container_id)
            or image_id != _IMAGE_ID
        )
        published = (
            host.get("PortBindings") == {"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": str(service_port)}]}
            and ports == {"5432/tcp": [{"HostIp": "127.0.0.1", "HostPort": str(service_port)}]}
        )
        internal = host.get("PortBindings") in (None, {}) and ports == {"5432/tcp": None}
        if common_invalid or not (published or internal):
            _fail("docker_endpoint")
        network_name, network_attachment = next(iter(networks.items()))
        network_id = network_attachment.get("NetworkID") if type(network_attachment) is dict else None
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", network_name or "") or not isinstance(network_id, str):
            _fail("docker_endpoint")
        network = json.loads(subprocess.run([docker, "network", "inspect", network_id], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=20, check=True).stdout.decode("utf-8"))
        if type(network) is not list or len(network) != 1 or type(network[0]) is not dict:
            _fail("docker_identity")
        network = network[0]
        network_labels, attached = network.get("Labels"), network.get("Containers")
        if (network.get("Id") != network_id or network.get("Internal") is not True or network.get("Attachable") is not False
                or type(network_labels) is not dict or {key: value for key, value in network_labels.items() if key.startswith("com.tzudong.g040.")} != g040_labels
                or type(attached) is not dict or set(attached) != {container_id}):
            _fail("docker_endpoint")
        image = json.loads(subprocess.run([docker, "image", "inspect", image_id], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=20, check=True).stdout.decode("utf-8"))
        if (type(image) is not list or len(image) != 1 or type(image[0]) is not dict
                or image[0].get("Id") != _IMAGE_ID or image[0].get("RepoDigests") != [_IMAGE_DIGEST]):
            _fail("docker_identity")
        container_hash = _sha(container_id.encode())
        if internal:
            if live_identity is None or _internal_exec_identity(container_id, docker) != dict(live_identity):
                _fail("docker_identity")
            rechecked_item = json.loads(subprocess.run(
                [docker, "inspect", "--type", "container", container_id],
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                timeout=20, check=True,
            ).stdout.decode("utf-8"))
            rechecked_network = json.loads(subprocess.run(
                [docker, "network", "inspect", network_id],
                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                timeout=20, check=True,
            ).stdout.decode("utf-8"))
            if rechecked_item != [item] or rechecked_network != [network]:
                _fail("docker_identity")
            endpoint = _sha(_canonical({
                "domain": "internal-docker-exec-proxy-v1", "host": "127.0.0.1",
                "port": service_port, "container_id_sha256": container_hash,
            }))
        else:
            endpoint = _sha(_canonical({"host": "127.0.0.1", "port": service_port}))
        return MappingProxyType({"container_id_sha256": container_hash, "image_id_sha256": _sha(image_id.encode()), "image_digest_sha256": _sha(_IMAGE_DIGEST.encode()), "endpoint_sha256": endpoint})
    except RehearsalError:
        raise
    except Exception:
        _fail("docker_identity")


def _archive_digest(path: str | Path, repository_root: str | Path) -> tuple[str, int, tuple[int, int]]:
    fd: int | None = None
    try:
        archive = controller.authority.restrictive_regular_file(path, "encrypted archive", repository_root)
        fd = os.open(archive, os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0))
        before, opened = archive.stat(follow_symlinks=False), os.fstat(fd)
        identity = (opened.st_dev, opened.st_ino)
        if (not stat.S_ISREG(opened.st_mode) or (before.st_dev, before.st_ino) != identity
                or before.st_size != opened.st_size):
            _fail("lineage_custody")
        digest, count = hashlib.sha256(), 0
        while chunk := os.read(fd, _ARCHIVE_CHUNK):
            digest.update(chunk)
            count += len(chunk)
        after_opened, after_path = os.fstat(fd), archive.stat(follow_symlinks=False)
        if (count != opened.st_size or (after_opened.st_dev, after_opened.st_ino) != identity
                or after_opened.st_size != opened.st_size or (after_path.st_dev, after_path.st_ino) != identity
                or after_path.st_size != opened.st_size):
            _fail("lineage_replacement")
        return digest.hexdigest(), count, identity
    except RehearsalError:
        raise
    except Exception:
        _fail("lineage_custody")
    finally:
        if fd is not None:
            try:
                os.close(fd)
            except Exception:
                pass

def _assert_archive_identity(path: str | Path, repository_root: str | Path, expected: tuple[str, int, tuple[int, int]]) -> None:
    try:
        archive = controller.authority.restrictive_regular_file(path, "encrypted archive", repository_root)
        info = archive.stat(follow_symlinks=False)
        if (info.st_dev, info.st_ino) != expected[2] or info.st_size != expected[1]:
            _fail("lineage_replacement")
    except RehearsalError:
        raise
    except Exception:
        _fail("lineage_custody")



def _restore_lineage(*, capture_path: str | Path, restore_path: str | Path, encrypted_dump: str | Path, repository_root: str | Path, archive: tuple[str, int, tuple[int, int]] | None = None) -> Mapping[str, Any]:
    capture_raw = _custody_bytes(capture_path, repository_root)
    restore_raw = _custody_bytes(restore_path, repository_root)
    dump_sha, dump_bytes, _ = archive if archive is not None else _archive_digest(encrypted_dump, repository_root)
    capture, restore = _load_bytes(capture_raw), _load_bytes(restore_raw)
    capture_unsigned, restore_unsigned = dict(capture), dict(restore)
    capture_receipt, restore_receipt = capture_unsigned.pop("receipt_sha256", None), restore_unsigned.pop("receipt_sha256", None)
    capture_evidence, restore_evidence = capture.get("evidence"), restore.get("evidence")
    ledger = ("ledger_pairs", "ledger_sha256", "ledger_count", "restorable_catalog_sha256", "managed_catalog_sha256")
    if (set(capture) != {"schema", "mode", "status", "manifest_sha256", "prior_receipt_sha256", "evidence", "receipt_sha256"}
            or set(restore) != set(capture) or capture["mode"] != "capture" or capture["status"] != "captured"
            or restore["mode"] != "restore-verify" or restore["status"] != "restored"
            or capture["schema"] != g035.RECEIPT_SCHEMA or capture["manifest_sha256"] != g035.MANIFEST_SHA256
            or capture["schema"] != restore["schema"] or capture["manifest_sha256"] != restore["manifest_sha256"]
            or not all(type(value) is str and _HEX.fullmatch(value) for value in (capture["manifest_sha256"], capture_receipt, restore_receipt))
            or capture_receipt != _sha(_canonical(capture_unsigned)) or restore_receipt != _sha(_canonical(restore_unsigned))
            or restore.get("prior_receipt_sha256") != [capture_receipt] or capture.get("prior_receipt_sha256") != []
            or type(capture_evidence) is not dict or type(restore_evidence) is not dict
            or capture_evidence.get("dump_sha256") != dump_sha or capture_evidence.get("dump_bytes") != dump_bytes
            or not _HEX.fullmatch(capture_evidence.get("source_sha256", ""))
            or any(capture_evidence.get(key) != restore_evidence.get(key) for key in ledger)):
        _fail("restore_lineage")
    return MappingProxyType({"g035_restore_receipt_sha256": restore_receipt, "g035_capture_receipt_sha256": capture_receipt, "restored_archive_sha256": dump_sha, "capture_receipt_bytes_sha256": _sha(capture_raw), "restore_receipt_bytes_sha256": _sha(restore_raw), "archive_bytes": dump_bytes, "g035_manifest_sha256": capture["manifest_sha256"], "source_sha256": capture_evidence["source_sha256"]})
def build_clone_lineage_request(*, clone_nonce: str, capture_receipt: str | Path,
                                restore_receipt: str | Path, encrypted_dump: str | Path,
                                repository_root: str | Path, service_file: str | Path,
                                service_name: str = "g035-local", container: str = "",
                                docker: str = "docker", output: str | Path,
                                now_unix: int | None = None,
                                valid_seconds: int = 600) -> Mapping[str, Any]:
    if not _SAFE.fullmatch(clone_nonce or "") or type(valid_seconds) is not int or not 1 <= valid_seconds <= 900:
        _fail("lineage_attestation")
    root = Path(repository_root).resolve()
    archive = _archive_digest(encrypted_dump, root)
    lineage = _restore_lineage(capture_path=capture_receipt, restore_path=restore_receipt,
                               encrypted_dump=encrypted_dump, repository_root=root, archive=archive)
    conn, service = _connect_service(service_file, service_name, readonly=True, repository_root=root)
    try:
        live = _live_identity(conn)
    finally:
        try: conn.rollback(); conn.close()
        except Exception: pass
    issued = int(time.time()) if now_unix is None else now_unix
    if type(issued) is not int:
        _fail("lineage_attestation")
    proof = _docker_clone_proof(container, service["port"], live, docker)
    body = {"schema": _LINEAGE_SCHEMA, "clone_nonce": clone_nonce,
            "issued_at_unix": issued, "expires_at_unix": issued + valid_seconds,
            "lineage_public_key_sha256": _LINEAGE_PUBLIC_KEY_SHA256,
            **dict(lineage), "live_identity_sha256": _sha(_canonical(dict(live))), **dict(proof)}
    _write(controller._outside(output, root, fresh=True), body)
    return MappingProxyType({"schema": _LINEAGE_SCHEMA,
                             "lineage_attestation_sha256": _sha(_canonical(body)),
                             "expires_at_unix": body["expires_at_unix"]})


def _verify_lineage_attestation(*, attestation: str | Path, signature: str | Path, expected: Mapping[str, Any], repository_root: str | Path, now_unix: int) -> Mapping[str, str]:
    raw, signature_raw = _custody_bytes(attestation, repository_root), _custody_bytes(signature, repository_root)
    value = _load_bytes(raw)
    if hashlib.sha256(_LINEAGE_PUBLIC_KEY_PEM).hexdigest() != _LINEAGE_PUBLIC_KEY_SHA256:
        _fail("lineage_attestation")
    if (raw != _canonical(dict(value)) or dict(value) != dict(expected)
            or value.get("schema") != _LINEAGE_SCHEMA or value.get("lineage_public_key_sha256") != _LINEAGE_PUBLIC_KEY_SHA256
            or type(value.get("issued_at_unix")) is not int or type(value.get("expires_at_unix")) is not int
            or value["expires_at_unix"] <= value["issued_at_unix"] or value["expires_at_unix"] - value["issued_at_unix"] > 900
            or not value["issued_at_unix"] <= now_unix <= value["expires_at_unix"]):
        _fail("lineage_attestation")
    try:
        with crypto._source_public_key(_LINEAGE_PUBLIC_KEY_PEM) as key:
            valid = crypto.openssl_verify(crypto.command("openssl"), key, raw, signature_raw)
            key.validate()
    except Exception:
        _fail("lineage_attestation")
    if valid is not True:
        _fail("lineage_attestation")
    return MappingProxyType({"lineage_attestation_sha256": _sha(raw), "lineage_signature_sha256": _sha(signature_raw)})


def bind_restore(*, clone_nonce: str, capture_receipt: str | Path, restore_receipt: str | Path,
                 encrypted_dump: str | Path, lineage_attestation: str | Path, lineage_signature: str | Path,
                 repository_root: str | Path, service_file: str | Path, service_name: str = "g035-local",
                 container: str = "", docker: str = "docker", output: str | Path, now_unix: int | None = None) -> Mapping[str, Any]:
    if not _SAFE.fullmatch(clone_nonce or ""):
        _fail("clone_binding")
    root = Path(repository_root).resolve()
    archive = _archive_digest(encrypted_dump, root)
    lineage = _restore_lineage(capture_path=capture_receipt, restore_path=restore_receipt, encrypted_dump=encrypted_dump, repository_root=root, archive=archive)
    before = tuple(_hash_file(path) for path in (capture_receipt, restore_receipt))
    conn, service = _connect_service(service_file, service_name, readonly=True, repository_root=root)
    try:
        live = _live_identity(conn)
    finally:
        try: conn.rollback(); conn.close()
        except Exception: pass
    proof, now = _docker_clone_proof(container, service["port"], live, docker), int(time.time()) if now_unix is None else now_unix
    attestation_path = controller._outside(lineage_attestation, root)
    signature_path = controller._outside(lineage_signature, root)
    attested = _load_bytes(_custody_bytes(attestation_path, root))
    expected = {"schema": _LINEAGE_SCHEMA, "clone_nonce": clone_nonce, "issued_at_unix": attested.get("issued_at_unix"), "expires_at_unix": attested.get("expires_at_unix"), "lineage_public_key_sha256": _LINEAGE_PUBLIC_KEY_SHA256, **dict(lineage), "live_identity_sha256": _sha(_canonical(dict(live))), **dict(proof)}
    attestation_hashes = _verify_lineage_attestation(attestation=attestation_path, signature=signature_path, expected=expected, repository_root=root, now_unix=now)
    if before != tuple(_hash_file(path) for path in (capture_receipt, restore_receipt)):
        _fail("lineage_replacement")
    _assert_archive_identity(encrypted_dump, root, archive)
    live_sha = _sha(_canonical(dict(live)))
    clone_identity = _sha(_canonical({"live_identity_sha256": live_sha, **dict(proof)}))
    body = {"schema": "g040-clone-restore-binding-v4", "clone_identity": clone_identity, "clone_nonce": clone_nonce, "live_identity_sha256": live_sha, "capture_receipt_path": str(Path(capture_receipt).resolve()), "restore_receipt_path": str(Path(restore_receipt).resolve()), "encrypted_dump_path": str(Path(encrypted_dump).resolve()), "lineage_attestation_path": str(attestation_path), "lineage_signature_path": str(signature_path), **dict(proof), **dict(lineage), **dict(attestation_hashes)}
    try:
        path = controller._outside(output, root, fresh=True)
        receipt = controller._write_signed(path, {"schema": controller.SCHEMA, "kind": "local-clone-binding", "body": body}, repository_root=root)
    except Exception:
        _fail("clone_binding")
    return MappingProxyType({**body, "binding_receipt_sha256": receipt})


def _binding(path: str | Path, repository_root: str | Path) -> Mapping[str, Any]:
    root = Path(repository_root).resolve()
    try:
        raw = controller._stable_bytes(controller._outside(path, root), root)
        value = controller._signed_document(raw, "local-clone-binding")
    except Exception:
        _fail("clone_binding")
    required = {"schema", "clone_identity", "clone_nonce", "live_identity_sha256", "capture_receipt_path", "restore_receipt_path", "encrypted_dump_path", "lineage_attestation_path", "lineage_signature_path", "container_id_sha256", "image_id_sha256", "image_digest_sha256", "endpoint_sha256", "g035_restore_receipt_sha256", "g035_capture_receipt_sha256", "restored_archive_sha256", "capture_receipt_bytes_sha256", "restore_receipt_bytes_sha256", "archive_bytes", "g035_manifest_sha256", "source_sha256", "lineage_attestation_sha256", "lineage_signature_sha256"}
    if (set(value) != required or value["schema"] != "g040-clone-restore-binding-v4" or not _HEX.fullmatch(value["clone_identity"]) or not _SAFE.fullmatch(value["clone_nonce"])
            or type(value["archive_bytes"]) is not int or value["archive_bytes"] <= 0
            or any(type(value[key]) is not str for key in ("capture_receipt_path", "restore_receipt_path", "encrypted_dump_path", "lineage_attestation_path", "lineage_signature_path"))
            or any(not _HEX.fullmatch(value[key]) for key in required - {"schema", "clone_identity", "capture_receipt_path", "restore_receipt_path", "encrypted_dump_path", "lineage_attestation_path", "lineage_signature_path", "clone_nonce", "archive_bytes"})
            or value["clone_identity"] != _sha(_canonical({key: value[key] for key in ("live_identity_sha256", "container_id_sha256", "image_id_sha256", "image_digest_sha256", "endpoint_sha256")}))):
        _fail("clone_binding")
    try:
        for key in ("capture_receipt_path", "restore_receipt_path", "encrypted_dump_path", "lineage_attestation_path", "lineage_signature_path"):
            controller._outside(value[key], root)
    except Exception:
        _fail("clone_binding")
    return MappingProxyType({**dict(value), "binding_receipt_sha256": _sha(raw)})


def _observation(binding: Mapping[str, Any], state: str, catalog: str, ledger: str, data: str | None = None) -> dict[str, Any]:
    keys = ("clone_identity", "clone_nonce", "live_identity_sha256", "container_id_sha256", "image_id_sha256", "image_digest_sha256", "endpoint_sha256", "g035_restore_receipt_sha256", "g035_capture_receipt_sha256", "restored_archive_sha256", "capture_receipt_bytes_sha256", "restore_receipt_bytes_sha256", "archive_bytes", "g035_manifest_sha256", "source_sha256", "lineage_attestation_path", "lineage_signature_path", "lineage_attestation_sha256", "lineage_signature_sha256")
    result = {key: binding[key] for key in keys} | {
        "state": state,
        "ledger_prefix_sha256": ledger,
        "catalog_sha256": catalog,
        "derivation_mode": DERIVATION_MODE,
        "reverse_vector_sha256": REVERSE_VECTOR_SHA256,
    }
    if data is not None:
        result["data_sha256"] = data
    return result


def _valid_probe(row: Mapping[str, Any], *, full: bool) -> None:
    required = {
        "ledger_count", "v00400_count", "ledger_prefix_shape_ok", "ledger_sha256",
        "schema_exists", "expected_table_count", "schema_table_count",
        "schema_index_count", "column_count", "schema_other_relation_count",
        "touched_function_count", "schema_trigger_count", "rls_table_count",
        "policy_count", "acl_contract_ok", "exact_pg", "server_version_num",
        "catalog_sha256",
    }
    booleans = {"ledger_prefix_shape_ok", "schema_exists", "acl_contract_ok", "exact_pg"}
    hashes = {"ledger_sha256", "catalog_sha256"}
    counts = required - booleans - hashes
    if (set(row) != required or any(type(row[key]) is not int for key in counts)
            or any(type(row[key]) is not bool for key in booleans)
            or any(type(row[key]) is not str or not _HEX.fullmatch(row[key]) for key in hashes)
            or row["ledger_count"] != 28 or row["v00400_count"] != 0
            or row["ledger_prefix_shape_ok"] is not True or row["exact_pg"] is not True
            or row["server_version_num"] != 170006):
        _fail("probe_result")
    expected = (
        (True, 7, 7, 14, 102, 0, 14, 7, 7, 0, True)
        if full else
        (False, 0, 0, 0, 0, 0, 0, 0, 0, 0, True)
    )
    actual = tuple(row[key] for key in (
        "schema_exists", "expected_table_count", "schema_table_count",
        "schema_index_count", "column_count", "schema_other_relation_count",
        "touched_function_count", "schema_trigger_count", "rls_table_count",
        "policy_count", "acl_contract_ok",
    ))
    if actual != expected:
        _fail("partial_state")

def _valid_data(row: Mapping[str, Any]) -> None:
    required = {"classes_count", "exact_seed_count", "seed_rows_exact", "class_source_count", "legal_hold_count", "work_item_count", "retained_record_count", "run_count", "run_item_count", "runtime_tables_empty", "seed_projection_sha256", "data_shape_sha256"}
    if (set(row) != required or row.get("seed_rows_exact") is not True or row.get("runtime_tables_empty") is not True
            or any(type(row[key]) is not int for key in required - {"seed_rows_exact", "runtime_tables_empty", "seed_projection_sha256", "data_shape_sha256"})
            or any(type(row[key]) is not str or not _HEX.fullmatch(row[key]) for key in ("seed_projection_sha256", "data_shape_sha256"))
            or tuple(row[key] for key in ("classes_count", "exact_seed_count", "class_source_count", "legal_hold_count", "work_item_count", "retained_record_count", "run_count", "run_item_count")) != (10, 10, 0, 0, 0, 0, 0, 0)):
        _fail("probe_result")


def _assert_observation_binding(binding: Mapping[str, Any], *, verified_port: int, container: str, docker: str, conn: Any, repository_root: str | Path, now_unix: int | None = None) -> None:
    root = Path(repository_root).resolve()
    lineage = _restore_lineage(capture_path=binding["capture_receipt_path"], restore_path=binding["restore_receipt_path"], encrypted_dump=binding["encrypted_dump_path"], repository_root=root)
    if any(binding[key] != lineage[key] for key in lineage):
        _fail("observation_binding")
    info = conn.info
    if info.host != "127.0.0.1" or info.port != verified_port:
        _fail("service_endpoint")
    live = _live_identity(conn)
    proof = _docker_clone_proof(container, verified_port, live, docker)
    live_sha = _sha(_canonical(dict(live)))
    if any(binding[key] != proof[key] for key in proof) or binding["live_identity_sha256"] != live_sha:
        _fail("observation_binding")
    attested = _load_bytes(_custody_bytes(binding["lineage_attestation_path"], root))
    expected = {"schema": _LINEAGE_SCHEMA, "clone_nonce": binding["clone_nonce"], "issued_at_unix": attested.get("issued_at_unix"), "expires_at_unix": attested.get("expires_at_unix"), "lineage_public_key_sha256": _LINEAGE_PUBLIC_KEY_SHA256, **dict(lineage), "live_identity_sha256": live_sha, **dict(proof)}
    hashes = _verify_lineage_attestation(attestation=binding["lineage_attestation_path"], signature=binding["lineage_signature_path"], expected=expected, repository_root=root, now_unix=int(time.time()) if now_unix is None else now_unix)
    if any(binding[key] != hashes[key] for key in hashes):
        _fail("observation_binding")
    rechecked_lineage = _restore_lineage(
        capture_path=binding["capture_receipt_path"], restore_path=binding["restore_receipt_path"],
        encrypted_dump=binding["encrypted_dump_path"], repository_root=root)
    if dict(rechecked_lineage) != dict(lineage):
        _fail("observation_binding")

def _open_read_only_snapshot(conn: Any, cur: Any) -> None:
    """Start the only accepted readback transaction after custody queries."""
    conn.rollback()
    cur.execute("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
    begin_read_only_snapshot(cur)

def _assert_reference_custody(cursor: Any, *, current_user: str) -> None:
    row = _query_one(cursor, _REFERENCE_CUSTODY_QUERY)
    if (
        row.get("session_user") != "supabase_admin"
        or row.get("current_user") != current_user
        or row.get("database_name") != "g035_local"
    ):
        _fail("reference_custody")


def _admit_custody_verified_clone(binding: Mapping[str, Any], *, verified_port: int,
                                  target_fingerprint: str) -> Any:
    """Mint internal clone authority only after the orchestrator verifies custody."""
    return _admit_verified_clone(
        clone_identity=binding["clone_identity"], clone_nonce=binding["clone_nonce"],
        target_fingerprint=target_fingerprint,
        live_identity_sha256=binding["live_identity_sha256"], port=verified_port)


def observe_reference(*, repository_root: str | Path, binding_path: str | Path, service_file: str | Path,
                      service_name: str, source_commit: str, target_fingerprint: str, output: str | Path,
                      container: str, docker: str = "docker") -> None:
    """Emit one signed rollback observation after all four clone states validate."""
    binding = _binding(binding_path, repository_root)
    root = Path(repository_root).resolve()
    source = _source(root, source_commit)
    if not _HEX.fullmatch(target_fingerprint):
        _fail("reference_input")
    manifest = validate_sources(root)
    source_plan = build_source_validation_plan(root, manifest, source=source)
    item = manifest.migrations[16]
    if (item.version, item.name) != ("20260712000400", "g010_retention_separation"):
        _fail("source_drift")
    _, executable = vectors(root, item)
    conn, service = _connect_service(service_file, service_name, readonly=False, repository_root=root)
    cur = None
    try:
        cur = conn.cursor()
        _assert_observation_binding(binding, verified_port=service["port"], container=container, docker=docker, conn=conn, repository_root=root)
        _open_read_only_snapshot(conn, cur)
        initial_full = _query_one(cur, CATALOG_PROBE)
        initial_data = _query_one(cur, DATA_PROBE)
        cur.execute("ROLLBACK")
        _valid_probe(initial_full, full=True)
        _valid_data(initial_data)
        validate_full_data_root(dict(initial_data), initial_data["data_shape_sha256"])
        initial_ledger = initial_full["ledger_sha256"]
        initial_catalog = initial_full["catalog_sha256"]
        initial_data_root = initial_data["data_shape_sha256"]

        _assert_observation_binding(binding, verified_port=service["port"], container=container, docker=docker, conn=conn, repository_root=root)
        capability = _admit_custody_verified_clone(
            binding, verified_port=service["port"], target_fingerprint=target_fingerprint)
        conn.rollback()
        cur.execute("BEGIN")
        cur.execute("SET LOCAL statement_timeout = '10000ms'")
        cur.execute("SET LOCAL lock_timeout = '5000ms'")
        locked_full = _query_one(cur, CATALOG_PROBE)
        locked_data = _query_one(cur, DATA_PROBE)
        _valid_probe(locked_full, full=True)
        _valid_data(locked_data)
        validate_full_data_root(dict(locked_data), locked_data["data_shape_sha256"])
        if (locked_full["ledger_sha256"], locked_full["catalog_sha256"], locked_data["data_shape_sha256"]) != (initial_ledger, initial_catalog, initial_data_root):
            _fail("initial_drift")
        for statement in REVERSE_VECTOR:
            cur.execute(statement)
        absent = _query_one(cur, CATALOG_PROBE)
        _valid_probe(absent, full=False)
        if absent["ledger_sha256"] != initial_ledger:
            _fail("ledger_drift")
        terminal = _derive_clone_terminal_expectation(
            conn, source_plan=source_plan, verified_clone_capability=capability,
            branch="UNAPPLIED", expected_initial_data_root=initial_data_root,
            expected_terminal_data_root=prefix.TERMINAL_DATA_SHA256,
            deadline_monotonic=time.monotonic() + _LOCAL_MUTATION_TIMEOUT_SECONDS,
        )
        recreated_full = _query_one(cur, CATALOG_PROBE)
        recreated_data = _query_one(cur, DATA_PROBE)
        _valid_probe(recreated_full, full=True)
        _valid_data(recreated_data)
        validate_full_data_root(dict(recreated_data), recreated_data["data_shape_sha256"])
        if (recreated_full["ledger_sha256"], recreated_full["catalog_sha256"], recreated_data["data_shape_sha256"]) != (initial_ledger, initial_catalog, initial_data_root):
            _fail("forward_drift")
        cur.execute("ROLLBACK")
        _assert_observation_binding(binding, verified_port=service["port"], container=container, docker=docker, conn=conn, repository_root=root)
        _open_read_only_snapshot(conn, cur)
        final_full = _query_one(cur, CATALOG_PROBE)
        final_data = _query_one(cur, DATA_PROBE)
        cur.execute("ROLLBACK")
        _valid_probe(final_full, full=True)
        _valid_data(final_data)
        validate_full_data_root(dict(final_data), final_data["data_shape_sha256"])
        if (final_full["ledger_sha256"], final_full["catalog_sha256"], final_data["data_shape_sha256"]) != (initial_ledger, initial_catalog, initial_data_root):
            _fail("rollback_invariant")
        issued_at = int(time.time())
        body = {
            "schema": "g040-clone-observation-v2",
            "issued_at": issued_at,
            "expires_at": issued_at + 900,
            "final_recovery_commit": source.final_commit,
            "runtime_source_root": source.runtime_source_root,
            "manifest_sha256": prefix.MANIFEST_SHA256,
            "migration_source_sha256": prefix.MIGRATION_SOURCE_SHA256,
            "probe_text_sha256": prefix.PROBE_TEXT_SHA256,
            "target_fingerprint": target_fingerprint,
            "binding_receipt_sha256": binding["binding_receipt_sha256"],
            **{key: binding[key] for key in ("clone_identity", "clone_nonce", "live_identity_sha256", "container_id_sha256", "image_id_sha256", "image_digest_sha256", "endpoint_sha256", "g035_restore_receipt_sha256", "g035_capture_receipt_sha256", "restored_archive_sha256", "capture_receipt_bytes_sha256", "restore_receipt_bytes_sha256", "lineage_attestation_sha256", "lineage_signature_sha256")},
            "derivation_mode": DERIVATION_MODE,
            "reverse_vector_sha256": REVERSE_VECTOR_SHA256,
            "initial_full_ledger_sha256": initial_ledger,
            "initial_full_catalog_sha256": initial_catalog,
            "initial_full_data_sha256": initial_data_root,
            "absent_ledger_sha256": absent["ledger_sha256"],
            "absent_catalog_sha256": absent["catalog_sha256"],
            "recreated_full_ledger_sha256": recreated_full["ledger_sha256"],
            "recreated_full_catalog_sha256": recreated_full["catalog_sha256"],
            "recreated_full_data_sha256": recreated_data["data_shape_sha256"],
            "post_rollback_ledger_sha256": final_full["ledger_sha256"],
            "post_rollback_catalog_sha256": final_full["catalog_sha256"],
            "post_rollback_data_sha256": final_data["data_shape_sha256"],
            "source_plan_sha256": terminal.plan_sha256,
            "terminal_rows": terminal.terminal_rows,
            "terminal_ledger_root": terminal.terminal_ledger_root,
            "terminal_catalog_root": terminal.terminal_catalog_root,
            "terminal_acl_root": terminal.terminal_acl_root,
            "terminal_data_root": terminal.terminal_data_root,
            "terminal_spec_root": terminal.terminal_spec_root,
            "terminal_tuple_sha256": _sha(_canonical({
                "terminal_rows": terminal.terminal_rows,
                "ledger": terminal.terminal_ledger_root,
                "catalog": terminal.terminal_catalog_root,
                "acl": terminal.terminal_acl_root,
                "data": terminal.terminal_data_root,
                "terminal_spec": terminal.terminal_spec_root,
            })),
        }
        controller._write_signed(controller._outside(output, root, fresh=True), {"schema": controller.SCHEMA, "kind": "local-clone-observation", "body": body}, repository_root=root)
    except RehearsalError:
        raise
    except Exception:
        _fail("observation_failed")
    finally:
        if cur:
            cur.close()
        try:
            conn.rollback(); conn.close()
        except Exception:
            pass


def _aggregate_signed(path: str | Path, kind: str, root: Path) -> tuple[Mapping[str, Any], str]:
    try:
        raw = controller._stable_bytes(controller._outside(path, root), root)
        return MappingProxyType(controller._signed_document(raw, kind)), _sha(raw)
    except Exception:
        _fail("aggregate_custody")

def _aggregate_freeze(args: argparse.Namespace, source: SourceBinding, root: Path, now: int) -> tuple[str, str, int, str, int]:
    raw = controller._stable_bytes(controller._outside(args.freeze_assertion, root), root)
    try:
        assertion = json.loads(raw.decode("ascii"), object_pairs_hook=_pairs)
        if raw != _canonical(assertion) + b"\n" or assertion.get("freeze_id") == "40b54cf8-e59f-4eb3-a37c-88e3bf983442":
            _fail("aggregate_custody")
        validate_operator_assertion(assertion, freeze_id=assertion["freeze_id"], origin=assertion["origin"],
            relation_root=assertion["relation_root"], acl_root=assertion["acl_root"], commit=source.final_commit,
            source_root=source.runtime_source_root, terminal_spec=terminal_spec(validate_sources(root)), now=now)
        files = args.freeze_evidence
        channels = ("no_owner_write", "no_dashboard_write", "no_provider_write", "no_out_of_band_write", "producer_stop")
        if type(files) is not list or len(files) != 5:
            _fail("aggregate_custody")
        digests = {_sha(controller._stable_bytes(controller._outside(path, root), root)) for path in files}
        if len(digests) != 5 or digests != {assertion["attestations"][channel]["evidence_sha256"] for channel in channels}:
            _fail("aggregate_custody")
        evidence_started = max(assertion["issued_at"],
                               *(assertion["attestations"][channel]["observed_at"] for channel in channels))
        return (_sha(raw),
                _sha(_canonical({"g040-freeze-inventory-v1": {"relation_root": assertion["relation_root"], "acl_root": assertion["acl_root"]}})),
                assertion["expires_at"], assertion["acl_root"], evidence_started)
    except Exception:
        _fail("aggregate_custody")

def build_aggregate_custody(args: argparse.Namespace) -> Mapping[str, Any]:
    source = _source(args.repository_root, args.source_commit)
    root = Path(args.repository_root).resolve()
    reference = controller._reference(_controller_args(args), source)
    now = int(time.time())
    hosted, hosted_sha = _aggregate_signed(args.hosted_observation, "prefix-observation", root)
    hosted_required = {
        "status", "target_fingerprint", "final_commit", "runtime_source_root",
        "reference_receipt_sha256", "derivation_mode", "reverse_vector_sha256",
        "observation_nonce", "ledger_prefix_sha256", "catalog_sha256", "data_sha256",
        "classification_sha256", "issued_at", "expires_at",
    }
    hosted_payload = {key: hosted[key] for key in hosted_required - {"classification_sha256"}} if set(hosted) == hosted_required else {}
    expected_hosted = {
        "UNAPPLIED": (reference.ledger_prefix_sha256, reference.absent_catalog_sha256, None),
        "FULL_ESCAPED": (reference.ledger_prefix_sha256, reference.full_catalog_sha256, reference.full_data_sha256),
    }
    if (set(hosted) != hosted_required or hosted.get("status") not in expected_hosted
            or hosted.get("final_commit") != source.final_commit
            or hosted.get("runtime_source_root") != source.runtime_source_root
            or hosted.get("reference_receipt_sha256") != reference.receipt_sha256
            or hosted.get("target_fingerprint") != reference.target_fingerprint
            or hosted.get("derivation_mode") != reference.derivation_mode
            or hosted.get("reverse_vector_sha256") != reference.reverse_vector_sha256
            or type(hosted.get("observation_nonce")) is not str or not _SAFE.fullmatch(hosted["observation_nonce"])
            or hosted["observation_nonce"] != reference.observation_nonce
            or type(hosted.get("issued_at")) is not int or type(hosted.get("expires_at")) is not int
            or hosted["issued_at"] < 0 or hosted["expires_at"] <= hosted["issued_at"]
            or hosted["issued_at"] < reference.issued_at_unix
            or not hosted["issued_at"] <= now < hosted["expires_at"]
            or hosted["expires_at"] - hosted["issued_at"] > 900
            or any(type(hosted[key]) is not str or not _HEX.fullmatch(hosted[key]) for key in (
                "target_fingerprint", "reference_receipt_sha256", "reverse_vector_sha256",
                "ledger_prefix_sha256", "catalog_sha256", "classification_sha256"))
            or (hosted["data_sha256"] is not None and (type(hosted["data_sha256"]) is not str or not _HEX.fullmatch(hosted["data_sha256"])))
            or (hosted["ledger_prefix_sha256"], hosted["catalog_sha256"], hosted["data_sha256"]) != expected_hosted[hosted["status"]]
            or hosted["classification_sha256"] != _sha(prefix.canonical_bytes(hosted_payload))):
        _fail("aggregate_custody")
    freeze_root, inventory_root, freeze_expires_at, target_acl_root, freeze_started = _aggregate_freeze(args, source, root, now)
    backup, backup_sha = _aggregate_signed(args.production_backup, "g040-production-backup-v1", root)
    capture_raw = controller._stable_bytes(controller._outside(args.g035_capture, root), root)
    archive_sha, archive_bytes, _ = _archive_digest(args.g035_archive, root)
    try:
        capture = _load_bytes(capture_raw)
        unsigned = dict(capture); capture_receipt = unsigned.pop("receipt_sha256")
        if (capture.get("schema") != g035.RECEIPT_SCHEMA or capture.get("mode") != "capture" or capture.get("status") != "captured"
                or capture_receipt != _sha(_canonical(unsigned)) or capture["evidence"]["dump_sha256"] != archive_sha
                or capture["evidence"]["dump_bytes"] != archive_bytes or backup["capture_receipt_sha256"] != _sha(capture_raw)
                or backup["g035_receipt_sha256"] != capture_receipt or backup["archive_sha256"] != archive_sha
                or backup["archive_bytes"] != archive_bytes):
            _fail("aggregate_custody")
        required_backup = {"issued_at","expires_at","freeze_expires_at","target_acl_root","final_recovery_commit","runtime_source_root","reference_receipt_sha256","target_fingerprint","hosted_observation_receipt_sha256","hosted_observation_classification_sha256","freeze_root","inventory_root","capture_receipt_sha256","g035_receipt_sha256","archive_sha256","archive_bytes","g035_manifest_sha256","g035_source_sha256"}
        if (set(backup) != required_backup
                or type(backup["issued_at"]) is not int or type(backup["expires_at"]) is not int
                or type(backup["freeze_expires_at"]) is not int or type(backup["archive_bytes"]) is not int
                or backup["issued_at"] < 0 or backup["expires_at"] <= backup["issued_at"]
                or not backup["issued_at"] <= now < backup["expires_at"]
                or backup["expires_at"] - backup["issued_at"] > 900
                or backup["issued_at"] < max(hosted["issued_at"], freeze_started)
                or backup["expires_at"] > freeze_expires_at or backup["expires_at"] > hosted["expires_at"]
                or backup["final_recovery_commit"] != source.final_commit or backup["runtime_source_root"] != source.runtime_source_root or backup["reference_receipt_sha256"] != reference.receipt_sha256 or backup["target_fingerprint"] != reference.target_fingerprint or backup["hosted_observation_receipt_sha256"] != hosted_sha or backup["hosted_observation_classification_sha256"] != hosted["classification_sha256"] or backup["freeze_root"] != freeze_root or backup["inventory_root"] != inventory_root or backup["freeze_expires_at"] != freeze_expires_at or backup["target_acl_root"] != target_acl_root or backup["g035_manifest_sha256"] != g035.MANIFEST_SHA256 or backup["g035_source_sha256"] != g035._source_fingerprint(g035.validate_sources(root))):
            _fail("aggregate_custody")
    except Exception:
        _fail("aggregate_custody")
    rehearsal, rehearsal_sha = _aggregate_signed(args.clone_rehearsal, "clone-rehearsal", root)
    replays = [_aggregate_signed(path, "local-branch-replay", root)
               for path in (args.first_replay, args.second_replay)]
    try:
        rehearsal_required = {
            "schema", "issued_at", "expires_at", "final_recovery_commit", "runtime_source_root",
            "reference_receipt_sha256", "hosted_observation_receipt_sha256", "target_fingerprint",
            "full_replay_receipt_sha256", "unapplied_replay_receipt_sha256",
            "full_clone_identity", "unapplied_clone_identity", "terminal_rows",
            "terminal_ledger_root", "terminal_catalog_root", "terminal_acl_root",
            "terminal_data_root", "terminal_spec_root",
        }
        if (set(rehearsal) != rehearsal_required
                or rehearsal["schema"] != "g040-clone-rehearsal-v1"
                or type(rehearsal["issued_at"]) is not int or type(rehearsal["expires_at"]) is not int
                or rehearsal["issued_at"] < max(hosted["issued_at"], reference.issued_at_unix)
                or not rehearsal["issued_at"] <= now <= rehearsal["expires_at"]
                or rehearsal["expires_at"] - rehearsal["issued_at"] > 900
                or any(rehearsal[key] != value for key, value in {
                    "final_recovery_commit": source.final_commit,
                    "runtime_source_root": source.runtime_source_root,
                    "reference_receipt_sha256": reference.receipt_sha256,
                    "hosted_observation_receipt_sha256": hosted_sha,
                    "target_fingerprint": reference.target_fingerprint,
                }.items())
                or type(rehearsal["terminal_rows"]) is not int
                or rehearsal["terminal_rows"] != executor._TERMINAL_ROWS
                or any(type(rehearsal[key]) is not str or not _HEX.fullmatch(rehearsal[key]) for key in (
                    "full_replay_receipt_sha256", "unapplied_replay_receipt_sha256",
                    "full_clone_identity", "unapplied_clone_identity", "terminal_ledger_root",
                    "terminal_catalog_root", "terminal_acl_root", "terminal_data_root",
                    "terminal_spec_root"))):
            _fail("aggregate_custody")
        validated = []
        for replay, _ in replays:
            branch = replay.get("selected_branch")
            validated.append(_validated_replay(
                replay, source=source, reference=reference,
                hosted=SimpleNamespace(status=hosted["status"]),
                hosted_receipt=hosted_sha, now=now, repository_root=root))
        if (any(replay[key] != value for replay in validated for key, value in {
            "reference_receipt_sha256": reference.receipt_sha256,
            "target_fingerprint": reference.target_fingerprint,
        }.items())
                or any(replay["issued_at"] < reference.issued_at_unix for replay in validated)
                or any(replay["issued_at"] < hosted["issued_at"]
                       or replay["hosted_observation_receipt_sha256"] != hosted_sha
                       for replay in validated if replay["selected_branch"] == "UNAPPLIED")):
            _fail("aggregate_custody")
        by_branch = {replay["selected_branch"]: (replay, receipt)
                     for replay, (_, receipt) in zip(validated, replays)}
        if (set(by_branch) != {"FULL_ESCAPED", "UNAPPLIED"}
                or rehearsal["full_replay_receipt_sha256"] != by_branch["FULL_ESCAPED"][1]
                or rehearsal["unapplied_replay_receipt_sha256"] != by_branch["UNAPPLIED"][1]
                or rehearsal["full_clone_identity"] != by_branch["FULL_ESCAPED"][0]["clone_identity"]
                or rehearsal["unapplied_clone_identity"] != by_branch["UNAPPLIED"][0]["clone_identity"]
                or rehearsal["issued_at"] < max(replay["issued_at"] for replay in validated)):
            _fail("aggregate_custody")
        full, unapplied = by_branch["FULL_ESCAPED"][0], by_branch["UNAPPLIED"][0]
        if ((full["starting_roots"]["ledger"], full["starting_roots"]["catalog"],
             full["starting_roots"]["data"])
                    != (reference.ledger_prefix_sha256, reference.full_catalog_sha256,
                        reference.full_data_sha256)
                or (unapplied["starting_roots"]["ledger"], unapplied["starting_roots"]["catalog"],
                    unapplied["starting_roots"]["data"])
                    != (reference.ledger_prefix_sha256, reference.absent_catalog_sha256, None)
                or any(full[key] != unapplied[key] for key in (
                    "terminal_rows", "terminal_ledger_root", "terminal_catalog_root",
                    "terminal_acl_root", "terminal_data_root", "terminal_spec_root"))
                or any(rehearsal[key] != full[key] for key in (
                    "terminal_rows", "terminal_ledger_root", "terminal_catalog_root",
                    "terminal_acl_root", "terminal_data_root", "terminal_spec_root"))
                or full["terminal_acl_root"] != target_acl_root):
            _fail("aggregate_custody")
        terminal = full
    except Exception:
        _fail("aggregate_custody")
    if type(args.valid_seconds) is not int or not 1 <= args.valid_seconds <= 900:
        _fail("aggregate_custody")
    expires_at = min(now + args.valid_seconds, freeze_expires_at, backup["expires_at"], *(replay["expires_at"] for replay, _ in replays), rehearsal["expires_at"], hosted["expires_at"])
    if expires_at <= now or now < max(reference.issued_at_unix, freeze_started, hosted["issued_at"],
                                      backup["issued_at"], rehearsal["issued_at"],
                                      *(replay["issued_at"] for replay, _ in replays)):
        _fail("aggregate_custody")
    body = {"issued_at": now, "expires_at": expires_at, "final_recovery_commit": source.final_commit, "runtime_source_root": source.runtime_source_root, "reference_receipt_sha256": reference.receipt_sha256, "target_fingerprint": reference.target_fingerprint, "freeze_root": freeze_root, "freeze_expires_at": freeze_expires_at, "target_acl_root": target_acl_root, "inventory_root": inventory_root, "backup_receipt_sha256": backup_sha, "capture_receipt_sha256": _sha(capture_raw), "archive_sha256": archive_sha, "archive_bytes": archive_bytes, "clone_rehearsal_receipt_sha256": rehearsal_sha, "target_ledger_root": terminal["terminal_ledger_root"], "target_catalog_root": terminal["terminal_catalog_root"], "target_data_root": terminal["terminal_data_root"]}
    receipt = controller._write_signed(controller._outside(args.output, root, fresh=True), {"schema": controller.SCHEMA, "kind": "aggregate-custody", "body": body}, repository_root=root)
    return MappingProxyType({"schema": controller.SCHEMA, "receipt_sha256": receipt})

def verify_aggregate_custody(args: argparse.Namespace) -> Mapping[str, Any]:
    source = _source(args.repository_root, args.source_commit)
    reference = controller._reference(_controller_args(args), source)
    verified = controller._custody(_controller_args(args), source, reference)
    return MappingProxyType({"schema": controller.SCHEMA, "target_fingerprint": verified.target_fingerprint})


def _verified_observation(path: str | Path, *, source: SourceBinding, target_fingerprint: str, repository_root: str | Path, now: int) -> Mapping[str, Any]:
    try:
        resolved_root = Path(repository_root).resolve()
        raw = controller._stable_bytes(controller._outside(path, resolved_root), resolved_root)
        value = controller._signed_document(raw, "local-clone-observation")
    except Exception:
        _fail("reference_input")
    hashes = ("runtime_source_root", "manifest_sha256", "migration_source_sha256", "probe_text_sha256", "target_fingerprint", "binding_receipt_sha256", "clone_identity", "live_identity_sha256", "container_id_sha256", "image_id_sha256", "image_digest_sha256", "endpoint_sha256", "g035_restore_receipt_sha256", "g035_capture_receipt_sha256", "restored_archive_sha256", "capture_receipt_bytes_sha256", "restore_receipt_bytes_sha256", "lineage_attestation_sha256", "lineage_signature_sha256", "initial_full_ledger_sha256", "initial_full_catalog_sha256", "initial_full_data_sha256", "absent_ledger_sha256", "absent_catalog_sha256", "recreated_full_ledger_sha256", "recreated_full_catalog_sha256", "recreated_full_data_sha256", "post_rollback_ledger_sha256", "post_rollback_catalog_sha256", "post_rollback_data_sha256", "source_plan_sha256", "terminal_ledger_root", "terminal_catalog_root", "terminal_acl_root", "terminal_data_root", "terminal_spec_root", "terminal_tuple_sha256", "reverse_vector_sha256")
    required = set(hashes) | {"schema", "issued_at", "expires_at", "final_recovery_commit", "clone_nonce", "derivation_mode", "terminal_rows"}
    if (set(value) != required or value["schema"] != "g040-clone-observation-v2" or value["final_recovery_commit"] != source.final_commit or value["runtime_source_root"] != source.runtime_source_root or value["manifest_sha256"] != prefix.MANIFEST_SHA256 or value["migration_source_sha256"] != prefix.MIGRATION_SOURCE_SHA256 or value["probe_text_sha256"] != prefix.PROBE_TEXT_SHA256 or value["target_fingerprint"] != target_fingerprint or type(value["issued_at"]) is not int or type(value["expires_at"]) is not int or value["expires_at"] - value["issued_at"] > 900 or not value["issued_at"] <= now <= value["expires_at"] or not _SAFE.fullmatch(value["clone_nonce"]) or type(value["terminal_rows"]) is not int or value["terminal_rows"] != executor._TERMINAL_ROWS or value["derivation_mode"] != DERIVATION_MODE or value["reverse_vector_sha256"] != REVERSE_VECTOR_SHA256 or any(type(value[key]) is not str or not _HEX.fullmatch(value[key]) for key in hashes) or value["terminal_data_root"] != prefix.TERMINAL_DATA_SHA256 or value["terminal_tuple_sha256"] != _sha(_canonical({"terminal_rows": value["terminal_rows"], "ledger": value["terminal_ledger_root"], "catalog": value["terminal_catalog_root"], "acl": value["terminal_acl_root"], "data": value["terminal_data_root"], "terminal_spec": value["terminal_spec_root"]})) or value["clone_identity"] != _sha(_canonical({key: value[key] for key in ("live_identity_sha256", "container_id_sha256", "image_id_sha256", "image_digest_sha256", "endpoint_sha256")})) or (value["initial_full_ledger_sha256"], value["initial_full_catalog_sha256"], value["initial_full_data_sha256"]) != (value["recreated_full_ledger_sha256"], value["recreated_full_catalog_sha256"], value["recreated_full_data_sha256"]) or (value["initial_full_ledger_sha256"], value["initial_full_catalog_sha256"], value["initial_full_data_sha256"]) != (value["post_rollback_ledger_sha256"], value["post_rollback_catalog_sha256"], value["post_rollback_data_sha256"]) or value["absent_ledger_sha256"] != value["initial_full_ledger_sha256"] or value["absent_catalog_sha256"] == value["initial_full_catalog_sha256"]):
        _fail("reference_input")
    proof = {key: value[key] for key in ("clone_identity", "clone_nonce", "live_identity_sha256", "container_id_sha256", "image_id_sha256", "image_digest_sha256", "endpoint_sha256", "g035_restore_receipt_sha256", "g035_capture_receipt_sha256", "restored_archive_sha256", "capture_receipt_bytes_sha256", "restore_receipt_bytes_sha256", "lineage_attestation_sha256", "lineage_signature_sha256")}
    return MappingProxyType({**proof, "binding_receipt_sha256": value["binding_receipt_sha256"], "observation_receipt_sha256": _sha(raw), "issued_at": value["issued_at"], "expires_at": value["expires_at"], "absent_catalog_sha256": value["absent_catalog_sha256"], "full_catalog_sha256": value["initial_full_catalog_sha256"], "full_data_sha256": value["initial_full_data_sha256"], "ledger_prefix_sha256": value["initial_full_ledger_sha256"], "derivation_mode": value["derivation_mode"], **{key: value[key] for key in ("source_plan_sha256", "terminal_rows", "terminal_ledger_root", "terminal_catalog_root", "terminal_acl_root", "terminal_data_root", "terminal_spec_root", "terminal_tuple_sha256", "reverse_vector_sha256")}})

def build_reference_request_file(*, source: SourceBinding, target_fingerprint: str,
                                 nonce: str, first_observation: str | Path,
                                 second_observation: str | Path, output: str | Path,
                                 repository_root: str | Path, now: int | None = None,
                                 valid_seconds: int = 600) -> Mapping[str, Any]:
    return build_reference_request(source=source, target_fingerprint=target_fingerprint,
                                   nonce=nonce, first_observation=first_observation,
                                   second_observation=second_observation, output=output,
                                   repository_root=repository_root, now_unix=now,
                                   valid_seconds=valid_seconds)


def finalize_reference_file(*, source: SourceBinding, target_fingerprint: str,
                            request: str | Path, signature: str | Path, output: str | Path,
                            repository_root: str | Path, now: int | None = None) -> Mapping[str, str]:
    return finalize_reference(source=source, target_fingerprint=target_fingerprint,
                              request=request, signature=signature, output=output,
                              repository_root=repository_root, now_unix=now)


def _source(root: str | Path, commit: str) -> SourceBinding:
    try:
        return verify_recovery_source(Path(root).resolve(), commit, production=True)
    except Exception:
        _fail("source_drift")


def _controller_args(args: argparse.Namespace) -> SimpleNamespace:
    values = vars(args).copy()
    values.setdefault("database_url", None); values.setdefault("dsn", None)
    values["service_name"] = "g035-local"
    return SimpleNamespace(**values)
def _selected_observation(args: argparse.Namespace) -> tuple[Any, str]:
    source = _source(args.repository_root, args.source_commit)
    try:
        reference = controller._reference(_controller_args(args), source)
        observation, receipt = controller._load_observation(_controller_args(args), source, reference)
    except Exception:
        _fail("observation_binding")
    if observation.status != args.selected_branch:
        _fail("branch_state")
    return observation, receipt


def _expected_prefix(reference: Any, status: str, ledger: str, catalog: str,
                     data: str | None) -> Any:
    return prefix._observation(reference, status, ledger, catalog, data)
def _terminal_tuple(reference: Any) -> dict[str, Any]:
    """The v4 reference terminal state is the only terminal authority."""
    return {
        "terminal_rows": reference.terminal_rows,
        "terminal_ledger_root": reference.terminal_ledger_root,
        "terminal_catalog_root": reference.terminal_catalog_root,
        "terminal_acl_root": reference.terminal_acl_root,
        "terminal_data_root": reference.terminal_data_root,
        "terminal_spec_root": reference.terminal_spec_root,
        "terminal_tuple_sha256": reference.terminal_tuple_sha256,
    }


def _intent_body_sha256(body: Mapping[str, Any]) -> str:
    return _sha(_canonical({key: value for key, value in body.items()
                            if key != "intent_body_sha256"}))


def _replay_plan_sha256(plan: Any, source_plan_sha256: str) -> str:
    return _sha(_canonical({
        "source_plan_sha256": source_plan_sha256,
        "branch": getattr(plan, "branch", None),
        "terminal_spec_root": getattr(plan, "terminal_spec_root", None),
        "compiled": [(item.version, item.name, full, executable)
                     for item, full, executable in getattr(plan, "compiled", ())],
    }))


def _verify_intent_interval(intent: Mapping[str, Any]) -> None:
    if (type(intent.get("issued_at")) is not int
            or type(intent.get("expires_at")) is not int
            or intent["expires_at"] <= intent["issued_at"]
            or intent["expires_at"] - intent["issued_at"] > 900):
        _fail("intent_receipt")
def _write_intent(path: str | Path, root: Path, kind: str, body: Mapping[str, Any]) -> str:
    return controller._write_signed(controller._outside(path, root, fresh=True),
                                    {"schema": controller.SCHEMA, "kind": kind, "body": dict(body)},
                                    repository_root=root)


def _signed_intent(path: str | Path, root: Path, kind: str) -> tuple[Mapping[str, Any], str]:
    try:
        raw = controller._stable_bytes(controller._outside(path, root), root)
        return MappingProxyType(controller._signed_document(raw, kind)), _sha(raw)
    except Exception:
        _fail("intent_receipt")


def _historical_anchor_valid(intent: Mapping[str, Any], reference: Any,
                             hosted: Any, clone: Mapping[str, Any]) -> None:
    _verify_intent_interval(intent)
    issued = intent["issued_at"]
    if (not reference.issued_at_unix <= issued < reference.expires_at_unix
            or not hosted.issued_at <= issued < hosted.expires_at
            or not clone["issued_at"] <= issued < clone["expires_at"]):
        _fail("intent_receipt")


def _preparation_terminal_body(intent: Mapping[str, Any], intent_sha: str,
                               readback: Mapping[str, Any]) -> Mapping[str, Any]:
    body = {
        "schema": "g040-local-state-preparation-v3",
        "issued_at": intent["issued_at"], "expires_at": intent["expires_at"],
        "final_recovery_commit": intent["final_recovery_commit"],
        "runtime_source_root": intent["runtime_source_root"],
        "reference_receipt_sha256": intent["reference_receipt_sha256"],
        "hosted_observation_receipt_sha256": intent["hosted_observation_receipt_sha256"],
        "clone_binding_receipt_sha256": intent["clone_binding_receipt_sha256"],
        "clone_observation_receipt_sha256": intent["clone_observation_receipt_sha256"],
        "clone_identity": intent["clone_identity"], "clone_nonce": intent["clone_nonce"],
        "reverse_vector_sha256": intent["reverse_vector_sha256"],
        "starting_ledger_root": intent["starting_roots"]["ledger"],
        "starting_catalog_root": intent["starting_roots"]["catalog"],
        "starting_data_root": intent["starting_roots"]["data"],
        "resulting_ledger_root": readback["ledger"],
        "resulting_catalog_root": readback["catalog"],
        "resulting_data_root": readback["data"],
        "preparation_intent_receipt_sha256": intent_sha,
        "preparation_intent_body_sha256": _intent_body_sha256(intent),
        "terminal_readback_sha256": readback["terminal_readback_sha256"],
        "target_fingerprint": intent["target_fingerprint"],
        "live_identity_sha256": intent["live_identity_sha256"],
        "container_id_sha256": intent["container_id_sha256"],
        "endpoint_sha256": intent["endpoint_sha256"],
        "intent_body_sha256": intent["intent_body_sha256"],
    }
    return MappingProxyType(body)


def _publish_or_verify_terminal(path: str | Path, root: Path, kind: str,
                                body: Mapping[str, Any]) -> str:
    output = controller._outside(path, root)
    try:
        if output.exists():
            raw = controller._stable_bytes(output, root)
            if controller._signed_document(raw, kind) != body:
                _fail("terminal_receipt_conflict")
            return _sha(raw)
    except RehearsalError:
        raise
    except Exception:
        _fail("terminal_receipt_conflict")
    return controller._write_signed(controller._outside(path, root, fresh=True),
                                    {"schema": controller.SCHEMA, "kind": kind, "body": dict(body)},
                                    repository_root=root)
def _classify_read_only_state(cur: Any, reference: Any, *, start: Mapping[str, Any],
                              terminal: Mapping[str, Any], manifest: Any | None = None) -> str:
    """Classify one fresh read-only snapshot without mutation-only probes."""
    try:
        if _query_one(cur, "SELECT current_setting('transaction_read_only', true) AS transaction_read_only") != {"transaction_read_only": "on"}:
            return "AMBIGUOUS"
        catalog = _query_one(cur, CATALOG_PROBE)
        start_catalog = (catalog.get("ledger_sha256"), catalog.get("catalog_sha256"))
        if start_catalog == (start["ledger"], start["catalog"]):
            if start["data"] is None or probe_full_data_root(cur, reference) == start["data"]:
                return "START"
            return "AMBIGUOUS"
        if manifest is None:
            if start_catalog == (terminal["ledger"], terminal["catalog"]):
                _valid_probe(catalog, full=False)
                return "TERMINAL"
            return "AMBIGUOUS"
        terminal_readback = terminal_readback_assert(cur, Path(__file__).resolve().parents[3], manifest)
        data_root = probe_full_data_root(cur, reference)
        observed_terminal = {
            "terminal_rows": executor._TERMINAL_ROWS, "ledger": terminal_readback["ledger_root"],
            "catalog": terminal_readback["catalog_root"], "acl": terminal_readback["acl_root"],
            "data": data_root, "terminal_spec": terminal_readback["terminal_spec"],
        }
        if observed_terminal == dict(terminal):
            return "TERMINAL"
    except Exception:
        pass
    return "AMBIGUOUS"


def _preparation_readback(args: argparse.Namespace, root: Path, binding: Mapping[str, Any],
                          reference: Any, *, lineage_now: int | None = None) -> Mapping[str, Any]:
    """Classify one fresh read-only preparation snapshot without mutation capability."""
    conn = cur = None
    try:
        conn, service = _connect_service(args.service_file, args.service_name, readonly=True,
                                         repository_root=root)
        cur = controller._G037TupleFetchallCursor(conn.cursor())
        _assert_observation_binding(binding, verified_port=service["port"], container=args.container,
                                    docker=args.docker, conn=conn, repository_root=root,
                                    now_unix=lineage_now)
        _open_read_only_snapshot(conn, cur)
        start = {"ledger": reference.ledger_prefix_sha256, "catalog": reference.full_catalog_sha256,
                 "data": reference.full_data_sha256}
        terminal = {"ledger": reference.ledger_prefix_sha256, "catalog": reference.absent_catalog_sha256,
                    "data": controller._ABSENT_DATA_ROOT}
        state = _classify_read_only_state(cur, reference, start=start, terminal=terminal)
        cur.execute("ROLLBACK")
        if state == "TERMINAL":
            value = {"state": "UNAPPLIED", **terminal}
            return MappingProxyType({
                "classifier_state": state, **value,
                "terminal_readback_sha256": _sha(_canonical(value)),
            })
        return MappingProxyType({"classifier_state": state})
    except RehearsalError:
        raise
    except Exception:
        return MappingProxyType({"classifier_state": "AMBIGUOUS"})
    finally:
        if cur:
            cur.close()
        if conn:
            try:
                conn.rollback(); conn.close()
            except Exception:
                pass


def _verified_preparation(path: str | Path, *, source: SourceBinding, reference: Any,
                          hosted_receipt: str, binding: Mapping[str, Any],
                          clone: Mapping[str, Any], repository_root: Path,
                          now: int) -> Mapping[str, Any]:
    try:
        raw = controller._stable_bytes(controller._outside(path, repository_root), repository_root)
        value = controller._signed_document(raw, "local-state-preparation")
    except Exception:
        _fail("preparation_receipt")
    required = {
        "schema", "issued_at", "expires_at", "final_recovery_commit",
        "runtime_source_root", "reference_receipt_sha256",
        "hosted_observation_receipt_sha256", "clone_binding_receipt_sha256",
        "clone_observation_receipt_sha256", "clone_identity", "clone_nonce",
        "reverse_vector_sha256", "starting_ledger_root", "starting_catalog_root",
        "starting_data_root", "resulting_ledger_root", "resulting_catalog_root",
        "resulting_data_root", "preparation_intent_receipt_sha256",
        "preparation_intent_body_sha256", "terminal_readback_sha256",
        "target_fingerprint", "live_identity_sha256", "container_id_sha256",
        "endpoint_sha256", "intent_body_sha256",
    }
    hashes = required - {"schema", "issued_at", "expires_at", "final_recovery_commit",
                         "clone_nonce"}
    if (set(value) != required or value["schema"] != "g040-local-state-preparation-v3"
            or type(value["issued_at"]) is not int or type(value["expires_at"]) is not int
            or not value["issued_at"] <= now <= value["expires_at"]
            or value["expires_at"] - value["issued_at"] > 900
            or value["final_recovery_commit"] != source.final_commit
            or value["runtime_source_root"] != source.runtime_source_root
            or any(type(value[key]) is not str or not _HEX.fullmatch(value[key])
                   for key in hashes)
            or value["reference_receipt_sha256"] != reference.receipt_sha256
            or value["hosted_observation_receipt_sha256"] != hosted_receipt
            or value["clone_binding_receipt_sha256"] != binding["binding_receipt_sha256"]
            or value["clone_observation_receipt_sha256"] != clone["observation_receipt_sha256"]
            or value["clone_identity"] != binding["clone_identity"]
            or value["clone_nonce"] != binding["clone_nonce"]
            or value["reverse_vector_sha256"] != REVERSE_VECTOR_SHA256
            or value["target_fingerprint"] != reference.target_fingerprint
            or any(value[key] != binding[key] for key in (
                "live_identity_sha256", "container_id_sha256", "endpoint_sha256"))
            or (value["starting_ledger_root"], value["starting_catalog_root"],
                value["starting_data_root"]) != (reference.ledger_prefix_sha256,
                                                  reference.full_catalog_sha256,
                                                  reference.full_data_sha256)
            or (value["resulting_ledger_root"], value["resulting_catalog_root"],
                value["resulting_data_root"]) != (reference.ledger_prefix_sha256,
                                                   reference.absent_catalog_sha256,
                                                   controller._ABSENT_DATA_ROOT)
            or value["preparation_intent_body_sha256"] != value["intent_body_sha256"]
            or value["terminal_readback_sha256"] != _sha(_canonical({
                "state": "UNAPPLIED", "ledger": value["resulting_ledger_root"],
                "catalog": value["resulting_catalog_root"], "data": value["resulting_data_root"]}))):
        _fail("preparation_receipt")
    return MappingProxyType({**value, "preparation_receipt_sha256": _sha(raw)})


def prepare_local_state(args: argparse.Namespace) -> Mapping[str, Any]:
    """Atomically restore one admitted local FULL clone to signed exact UNAPPLIED."""
    root = Path(args.repository_root).resolve()
    source = _source(root, args.source_commit)
    reference = controller._reference(_controller_args(args), source)
    hosted, hosted_receipt = controller._load_observation(_controller_args(args), source, reference)
    if hosted.status != "FULL_ESCAPED":
        _fail("branch_state")
    clone = _verified_observation(args.clone_observation, source=source,
                                  target_fingerprint=reference.target_fingerprint,
                                  repository_root=root, now=int(time.time()))
    binding = _binding(args.binding, root)
    if (binding["binding_receipt_sha256"] != clone["binding_receipt_sha256"]
            or binding["clone_identity"] != clone["clone_identity"]
            or binding["clone_nonce"] != clone["clone_nonce"]
            or (clone["ledger_prefix_sha256"], clone["full_catalog_sha256"],
                clone["full_data_sha256"]) != (reference.ledger_prefix_sha256,
                                                reference.full_catalog_sha256,
                                                reference.full_data_sha256)
            or (hosted.ledger_prefix_sha256, hosted.catalog_sha256, hosted.data_sha256)
            != (reference.ledger_prefix_sha256, reference.full_catalog_sha256,
                reference.full_data_sha256)):
        _fail("preparation_binding")
    conn, service = _connect_service(args.service_file, args.service_name, readonly=False,
                                     repository_root=root)
    cur = None
    commit_attempted = False
    try:
        cur = controller._G037TupleFetchallCursor(conn.cursor())
        _assert_observation_binding(binding, verified_port=service["port"],
                                    container=args.container, docker=args.docker, conn=conn,
                                    repository_root=root)
        cur.execute("BEGIN")
        for sql in executor._LOCK_SQL + executor._DATA_LOCK_SQL:
            cur.execute(sql)
        full = _expected_prefix(reference, "FULL_ESCAPED", reference.ledger_prefix_sha256,
                                reference.full_catalog_sha256, reference.full_data_sha256)
        if prefix.classify_mutation_cursor(cur, reference, expected_prior=full) != full:
            _fail("preparation_state")
        issued = int(time.time())
        intent = {
            "schema": "g040-local-state-preparation-intent-v2", "issued_at": issued,
            "expires_at": min(issued + 900, reference.expires_at_unix),
            "final_recovery_commit": source.final_commit, "runtime_source_root": source.runtime_source_root,
            "target_fingerprint": reference.target_fingerprint,
            "reference_receipt_sha256": reference.receipt_sha256,
            "hosted_observation_receipt_sha256": hosted_receipt,
            "clone_binding_receipt_sha256": binding["binding_receipt_sha256"],
            "clone_observation_receipt_sha256": clone["observation_receipt_sha256"],
            "clone_identity": binding["clone_identity"], "clone_nonce": binding["clone_nonce"],
            "live_identity_sha256": binding["live_identity_sha256"],
            "container_id_sha256": binding["container_id_sha256"],
            "endpoint_sha256": binding["endpoint_sha256"], "reverse_vector_sha256": REVERSE_VECTOR_SHA256,
            "starting_roots": {"ledger": reference.ledger_prefix_sha256,
                               "catalog": reference.full_catalog_sha256, "data": reference.full_data_sha256},
            "expected_terminal": {"state": "UNAPPLIED", "ledger": reference.ledger_prefix_sha256,
                                  "catalog": reference.absent_catalog_sha256,
                                  "data": controller._ABSENT_DATA_ROOT},
        }
        intent["intent_body_sha256"] = _intent_body_sha256(intent)
        if intent["expires_at"] <= issued:
            _fail("intent_expired")
        intent_receipt = _write_intent(args.intent_output, root, "local-state-preparation-intent", intent)
        for statement in REVERSE_VECTOR:
            cur.execute(statement)
        absent = _expected_prefix(reference, "UNAPPLIED", reference.ledger_prefix_sha256,
                                  reference.absent_catalog_sha256, None)
        if prefix.classify_mutation_cursor(cur, reference, expected_prior=absent) != absent:
            _fail("preparation_state")
        commit_attempted = True
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        _fail("preparation_commit_ambiguous_readback_only" if commit_attempted else "preparation_failed")
    finally:
        if cur:
            cur.close()
        try:
            conn.close()
        except Exception:
            pass
    readback = _preparation_readback(args, root, binding, reference)
    if readback["classifier_state"] != "TERMINAL":
        _fail("preparation_commit_ambiguous_readback_only")
    body = _preparation_terminal_body(intent, intent_receipt, readback)
    try:
        receipt = _publish_or_verify_terminal(args.output, root, "local-state-preparation", body)
    except Exception:
        _fail("preparation_commit_ambiguous_readback_only")
    return MappingProxyType({"schema": body["schema"], "receipt_sha256": receipt})


def recover_local_state(args: argparse.Namespace) -> Mapping[str, Any]:
    """Read-only terminal receipt recovery; this path has no mutation capability."""
    root = Path(args.repository_root).resolve()
    source = _source(root, args.source_commit)
    reference = controller._reference(_controller_args(args), source, historical=True)
    hosted, hosted_receipt = controller._load_observation(
        _controller_args(args), source, reference, require_fresh=False)
    binding = _binding(args.binding, root)
    intent, intent_sha = _signed_intent(args.intent, root, "local-state-preparation-intent")
    clone = _verified_observation(args.clone_observation, source=source,
                                  target_fingerprint=reference.target_fingerprint,
                                  repository_root=root, now=intent.get("issued_at", -1))
    required = {"schema", "issued_at", "expires_at", "final_recovery_commit", "runtime_source_root",
                "target_fingerprint", "reference_receipt_sha256", "hosted_observation_receipt_sha256",
                "clone_binding_receipt_sha256", "clone_observation_receipt_sha256", "clone_identity",
                "clone_nonce", "live_identity_sha256", "container_id_sha256", "endpoint_sha256",
                "reverse_vector_sha256", "starting_roots", "expected_terminal", "intent_body_sha256"}
    if (set(intent) != required or intent["schema"] != "g040-local-state-preparation-intent-v2"
            or intent["final_recovery_commit"] != source.final_commit
            or intent["runtime_source_root"] != source.runtime_source_root
            or intent["target_fingerprint"] != reference.target_fingerprint
            or intent["reference_receipt_sha256"] != reference.receipt_sha256
            or intent["hosted_observation_receipt_sha256"] != hosted_receipt
            or intent["clone_binding_receipt_sha256"] != binding["binding_receipt_sha256"]
            or intent["clone_observation_receipt_sha256"] != clone["observation_receipt_sha256"]
            or intent["clone_identity"] != binding["clone_identity"]
            or intent["clone_nonce"] != binding["clone_nonce"]
            or any(intent[key] != binding[key] for key in (
                "live_identity_sha256", "container_id_sha256", "endpoint_sha256"))
            or type(intent["starting_roots"]) is not dict
            or intent["starting_roots"] != {"ledger": reference.ledger_prefix_sha256,
                                             "catalog": reference.full_catalog_sha256,
                                             "data": reference.full_data_sha256}
            or type(intent["expected_terminal"]) is not dict
            or intent["expected_terminal"] != {"state": "UNAPPLIED",
                                                "ledger": reference.ledger_prefix_sha256,
                                                "catalog": reference.absent_catalog_sha256,
                                                "data": controller._ABSENT_DATA_ROOT}
            or intent["reverse_vector_sha256"] != REVERSE_VECTOR_SHA256
            or intent["intent_body_sha256"] != _intent_body_sha256(intent)):
        _fail("intent_receipt")
    _historical_anchor_valid(intent, reference, hosted, clone)
    readback = _preparation_readback(args, root, binding, reference, lineage_now=intent["issued_at"])
    if readback["classifier_state"] == "START":
        _fail("preparation_not_committed")
    if readback["classifier_state"] != "TERMINAL":
        _fail("preparation_recovery_ambiguous")
    body = _preparation_terminal_body(intent, intent_sha, readback)
    try:
        receipt = _publish_or_verify_terminal(args.output, root, "local-state-preparation", body)
    except Exception:
        _fail("preparation_recovery_ambiguous")
    return MappingProxyType({"schema": body["schema"], "receipt_sha256": receipt})


def _replay_readback(args: argparse.Namespace, root: Path, binding: Mapping[str, Any],
                     reference: Any, manifest: Any, start: Mapping[str, Any],
                     expected: Mapping[str, Any], *, lineage_now: int | None = None) -> Mapping[str, Any]:
    """Read terminal roots from a newly opened, read-only clone connection."""
    conn, service = _connect_service(args.service_file, args.service_name, readonly=True,
                                     repository_root=root)
    cur = None
    try:
        cur = controller._G037TupleFetchallCursor(conn.cursor())
        _assert_observation_binding(binding, verified_port=service["port"], container=args.container,
                                    docker=args.docker, conn=conn, repository_root=root,
                                    now_unix=lineage_now)
        _open_read_only_snapshot(conn, cur)
        state = _classify_read_only_state(cur, reference, start=start, terminal=expected,
                                          manifest=manifest)
        cur.execute("ROLLBACK")
        if state != "TERMINAL":
            _fail("replay_recovery_ambiguous")
        value = dict(expected)
        return MappingProxyType({**value, "terminal_readback_sha256": _sha(_canonical(value))})
    except RehearsalError:
        raise
    except Exception:
        _fail("replay_recovery_ambiguous")
    finally:
        if cur:
            cur.close()
        try:
            conn.rollback()
            conn.close()
        except Exception:
            pass


def _replay_terminal_body(intent: Mapping[str, Any], intent_sha: str,
                           readback: Mapping[str, Any]) -> Mapping[str, Any]:
    body = dict(intent)
    body.update({
        "schema": "g040-local-branch-replay-v3",
        "replay_intent_receipt_sha256": intent_sha,
        "terminal_readback_sha256": readback["terminal_readback_sha256"],
        "terminal_rows": readback["terminal_rows"],
        "terminal_ledger_root": readback["ledger"],
        "terminal_catalog_root": readback["catalog"],
        "terminal_acl_root": readback["acl"],
        "terminal_data_root": readback["data"],
        "terminal_spec_root": readback["terminal_spec"],
    })
    body["terminal_tuple_sha256"] = intent["terminal_tuple_sha256"]
    return MappingProxyType(body)

def recover_branch(args: argparse.Namespace) -> Mapping[str, Any]:
    """Read-only replay recovery. This path never obtains mutation capability."""
    root = Path(args.repository_root).resolve()
    source = _source(root, args.source_commit)
    reference = controller._reference(_controller_args(args), source, historical=True)
    hosted, hosted_receipt = controller._load_observation(
        _controller_args(args), source, reference, require_fresh=False)
    binding = _binding(args.binding, root)
    intent, intent_sha = _signed_intent(args.intent, root, "local-branch-replay-intent")
    clone = _verified_observation(args.clone_observation, source=source,
                                  target_fingerprint=reference.target_fingerprint,
                                  repository_root=root, now=intent.get("issued_at", -1))
    required = {
        "schema", "issued_at", "expires_at", "final_recovery_commit", "runtime_source_root",
        "target_fingerprint", "reference_receipt_sha256", "hosted_observation_receipt_sha256",
        "clone_binding_receipt_sha256", "clone_observation_receipt_sha256", "clone_identity",
        "clone_nonce", "live_identity_sha256", "container_id_sha256", "endpoint_sha256",
        "prefix_classification", "selected_branch", "starting_roots", "source_plan_sha256",
        "replay_plan_sha256", "intent_body_sha256", "terminal_tuple_sha256", "terminal_rows",
        "terminal_ledger_root", "terminal_catalog_root", "terminal_acl_root",
        "terminal_data_root", "terminal_spec_root",
    }
    branch = intent.get("selected_branch")
    if branch == "UNAPPLIED":
        required.add("unapplied_provenance")
        if intent.get("unapplied_provenance") == "prepared-from-full-escaped":
            required.add("preparation_receipt_sha256")
    hashes = required - {"schema", "issued_at", "expires_at", "final_recovery_commit",
                         "runtime_source_root", "clone_nonce", "prefix_classification",
                         "selected_branch", "starting_roots", "terminal_rows",
                         "unapplied_provenance"}
    full = {"ledger": reference.ledger_prefix_sha256, "catalog": reference.full_catalog_sha256,
            "data": reference.full_data_sha256}
    absent = {"ledger": reference.ledger_prefix_sha256, "catalog": reference.absent_catalog_sha256,
              "data": None}
    expected_terminal = {
        "terminal_rows": reference.terminal_rows, "ledger": reference.terminal_ledger_root,
        "catalog": reference.terminal_catalog_root, "acl": reference.terminal_acl_root,
        "data": reference.terminal_data_root, "terminal_spec": reference.terminal_spec_root,
    }
    if (set(intent) != required or intent.get("schema") != "g040-local-branch-replay-intent-v2"
            or any(type(intent.get(key)) is not int for key in ("issued_at", "expires_at"))
            or any(type(intent[key]) is not str or not _HEX.fullmatch(intent[key]) for key in hashes)
            or not _SAFE.fullmatch(intent.get("clone_nonce", ""))
            or intent["final_recovery_commit"] != source.final_commit
            or intent["runtime_source_root"] != source.runtime_source_root
            or intent["target_fingerprint"] != reference.target_fingerprint
            or intent["reference_receipt_sha256"] != reference.receipt_sha256
            or intent["hosted_observation_receipt_sha256"] != hosted_receipt
            or any(intent[key] != binding[key] for key in (
                "clone_identity", "clone_nonce", "live_identity_sha256",
                "container_id_sha256", "endpoint_sha256"))
            or intent["clone_binding_receipt_sha256"] != binding["binding_receipt_sha256"]
            or intent["clone_observation_receipt_sha256"] != clone["observation_receipt_sha256"]
            or type(intent["starting_roots"]) is not dict
            or set(intent["starting_roots"]) != {"ledger", "catalog", "data"}
            or branch not in {"FULL_ESCAPED", "UNAPPLIED"}
            or intent["prefix_classification"] != branch
            or (branch == "FULL_ESCAPED" and (
                "unapplied_provenance" in intent or "preparation_receipt_sha256" in intent
                or intent["starting_roots"] != full))
            or (branch == "UNAPPLIED" and (
                intent.get("unapplied_provenance") not in {
                    "native-hosted-unapplied", "prepared-from-full-escaped"}
                or intent["starting_roots"] != absent
                or (intent["unapplied_provenance"] == "native-hosted-unapplied"
                    and hosted.status != "UNAPPLIED")
                or (intent["unapplied_provenance"] == "prepared-from-full-escaped"
                    and hosted.status != "FULL_ESCAPED")))
            or intent["source_plan_sha256"] != reference.source_plan_sha256
            or any(intent[key] != value for key, value in _terminal_tuple(reference).items())
            or intent["intent_body_sha256"] != _intent_body_sha256(intent)):
        _fail("intent_receipt")
    _historical_anchor_valid(intent, reference, hosted, clone)
    if intent.get("unapplied_provenance") == "prepared-from-full-escaped":
        preparation = _verified_preparation(
            args.preparation, source=source, reference=reference, hosted_receipt=hosted_receipt,
            binding=binding, clone=clone, repository_root=root, now=intent["issued_at"])
        if preparation["preparation_receipt_sha256"] != intent["preparation_receipt_sha256"]:
            _fail("intent_receipt")
    manifest = validate_sources(root)
    recompiled = compile_branch_plan(
        root, manifest, source=source, reference=reference,
        observation=_expected_prefix(reference, branch, **intent["starting_roots"]))
    if _replay_plan_sha256(recompiled, reference.source_plan_sha256) != intent["replay_plan_sha256"]:
        _fail("intent_receipt")
    try:
        readback = _replay_readback(args, root, binding, reference, manifest, intent["starting_roots"], expected_terminal,
                                    lineage_now=intent["issued_at"])
    except Exception:
        conn, service = _connect_service(args.service_file, args.service_name, readonly=True,
                                         repository_root=root)
        cur = None
        try:
            cur = controller._G037TupleFetchallCursor(conn.cursor())
            _assert_observation_binding(binding, verified_port=service["port"], container=args.container,
                                        docker=args.docker, conn=conn, repository_root=root,
                                        now_unix=intent["issued_at"])
            _open_read_only_snapshot(conn, cur)
            observed = _classify_read_only_state(
                cur, reference, start=intent["starting_roots"], terminal=expected_terminal,
                manifest=validate_sources(root))
            cur.execute("ROLLBACK")
            if observed == "START":
                _fail("replay_not_committed")
        except RehearsalError:
            raise
        except Exception:
            pass
        finally:
            if cur:
                cur.close()
            try:
                conn.rollback(); conn.close()
            except Exception:
                pass
        _fail("replay_recovery_ambiguous")
    body = _replay_terminal_body(intent, intent_sha, readback)
    receipt = _publish_or_verify_terminal(args.output, root, "local-branch-replay", body)
    return MappingProxyType({"schema": body["schema"], "receipt_sha256": receipt})
def replay_branch(args: argparse.Namespace) -> Mapping[str, Any]:
    """Commit one branch on an admitted local clone and sign its terminal receipt."""
    root = Path(args.repository_root).resolve()
    source = _source(root, args.source_commit)
    reference = controller._reference(_controller_args(args), source)
    hosted, hosted_receipt = controller._load_observation(_controller_args(args), source, reference)
    if args.selected_branch == "FULL_ESCAPED":
        if getattr(args, "preparation", None):
            _fail("preparation_forbidden")
    elif args.selected_branch == "UNAPPLIED":
        if hosted.status == "UNAPPLIED":
            if getattr(args, "preparation", None):
                _fail("preparation_forbidden")
        elif hosted.status != "FULL_ESCAPED" or not getattr(args, "preparation", None):
            _fail("preparation_required")
    else:
        _fail("branch_state")
    clone_observation = _verified_observation(
        args.clone_observation, source=source, target_fingerprint=reference.target_fingerprint,
        repository_root=root, now=int(time.time()))
    binding = _binding(args.binding, root)
    if (binding["binding_receipt_sha256"] != clone_observation["binding_receipt_sha256"]
            or binding["clone_identity"] != clone_observation["clone_identity"]
            or binding["clone_nonce"] != clone_observation["clone_nonce"]):
        _fail("replay_binding")
    preparation_receipt = None
    preparation_expires_at = None
    if args.selected_branch == "FULL_ESCAPED":
        if (clone_observation["ledger_prefix_sha256"],
                clone_observation["full_catalog_sha256"],
                clone_observation["full_data_sha256"]) != (
                    reference.ledger_prefix_sha256, reference.full_catalog_sha256,
                    reference.full_data_sha256):
            _fail("replay_binding")
        local_observation = _expected_prefix(
            reference, "FULL_ESCAPED", reference.ledger_prefix_sha256,
            reference.full_catalog_sha256, reference.full_data_sha256,
        )
    elif hosted.status == "FULL_ESCAPED":
        preparation = _verified_preparation(
            args.preparation, source=source, reference=reference, hosted_receipt=hosted_receipt,
            binding=binding, clone=clone_observation, repository_root=root, now=int(time.time()),
        )
        preparation_receipt = preparation["preparation_receipt_sha256"]
        preparation_expires_at = preparation["expires_at"]
        local_observation = _expected_prefix(
            reference, "UNAPPLIED", reference.ledger_prefix_sha256,
            reference.absent_catalog_sha256, None,
        )
    else:
        local_observation = hosted
    manifest = validate_sources(root)
    conn, service = _connect_service(args.service_file, args.service_name, readonly=False,
                                     repository_root=root)
    cur = None
    commit_attempted = False
    try:
        cur = controller._G037TupleFetchallCursor(conn.cursor())
        _assert_observation_binding(binding, verified_port=service["port"],
                                    container=args.container, docker=args.docker, conn=conn,
                                    repository_root=root)
        capability = _admit_custody_verified_clone(
            binding, verified_port=service["port"],
            target_fingerprint=reference.target_fingerprint)
        plan = compile_branch_plan(root, manifest, source=source, reference=reference,
                                   observation=local_observation)
        cur.execute("BEGIN")
        if type(plan) is executor.RehearsalExecutionPlan:
            for sql in executor._LOCK_SQL + (executor._DATA_LOCK_SQL if plan.branch == "FULL_ESCAPED" else ()):
                cur.execute(sql)
            if prefix.classify_mutation_cursor(cur, reference, expected_prior=local_observation) != local_observation:
                _fail("replay_state")
        issued = int(time.time())
        terminal = _terminal_tuple(reference)
        intent = {
            "schema": "g040-local-branch-replay-intent-v2", "issued_at": issued,
            "expires_at": min(issued + 900, reference.expires_at_unix,
                              *(value for value in (preparation_expires_at,) if value is not None)),
            "final_recovery_commit": source.final_commit, "runtime_source_root": source.runtime_source_root,
            "target_fingerprint": reference.target_fingerprint,
            "reference_receipt_sha256": reference.receipt_sha256,
            "hosted_observation_receipt_sha256": hosted_receipt,
            "clone_binding_receipt_sha256": binding["binding_receipt_sha256"],
            "clone_observation_receipt_sha256": clone_observation["observation_receipt_sha256"],
            "clone_identity": binding["clone_identity"], "clone_nonce": binding["clone_nonce"],
            "live_identity_sha256": binding["live_identity_sha256"],
            "container_id_sha256": binding["container_id_sha256"], "endpoint_sha256": binding["endpoint_sha256"],
            "prefix_classification": local_observation.status, "selected_branch": args.selected_branch,
            "starting_roots": {"ledger": local_observation.ledger_prefix_sha256,
                               "catalog": local_observation.catalog_sha256, "data": local_observation.data_sha256},
            "source_plan_sha256": reference.source_plan_sha256,
            "replay_plan_sha256": _replay_plan_sha256(plan, reference.source_plan_sha256),
            **terminal,
            **({"unapplied_provenance": "prepared-from-full-escaped",
                "preparation_receipt_sha256": preparation_receipt}
               if preparation_receipt is not None else
               ({"unapplied_provenance": "native-hosted-unapplied"}
                if args.selected_branch == "UNAPPLIED" else {})),
        }
        intent["intent_body_sha256"] = _intent_body_sha256(intent)
        if intent["expires_at"] <= issued:
            _fail("intent_expired")
        intent_receipt = _write_intent(getattr(args, "intent_output", f"{args.output}.intent"),
                                       root, "local-branch-replay-intent", intent)
        evidence = _apply_rehearsal_locked_cursor(
            cur, plan=plan, verified_clone_capability=capability,
            deadline_monotonic=time.monotonic() + _LOCAL_MUTATION_TIMEOUT_SECONDS)
        if (evidence.terminal_rows != intent["terminal_rows"]
                or evidence.terminal_ledger_root != intent["terminal_ledger_root"]
                or evidence.terminal_catalog_root != intent["terminal_catalog_root"]
                or evidence.terminal_acl_root != intent["terminal_acl_root"]
                or evidence.terminal_data_root != intent["terminal_data_root"]
                or evidence.terminal_spec_root != intent["terminal_spec_root"]):
            _fail("replay_terminal_evidence")
        commit_attempted = True
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        _fail("replay_commit_ambiguous_readback_only" if commit_attempted else "replay_failed")
    finally:
        if cur:
            cur.close()
        try:
            conn.close()
        except Exception:
            pass
    expected_terminal = {
        "terminal_rows": intent["terminal_rows"],
        "ledger": intent["terminal_ledger_root"],
        "catalog": intent["terminal_catalog_root"],
        "acl": intent["terminal_acl_root"],
        "data": intent["terminal_data_root"],
        "terminal_spec": intent["terminal_spec_root"],
    }
    if any(getattr(evidence, field) != expected_terminal[key] for field, key in (
            ("terminal_rows", "terminal_rows"), ("terminal_ledger_root", "ledger"),
            ("terminal_catalog_root", "catalog"), ("terminal_acl_root", "acl"),
            ("terminal_data_root", "data"), ("terminal_spec_root", "terminal_spec"))):
        _fail("replay_commit_ambiguous_readback_only")
    try:
        readback = _replay_readback(args, root, binding, reference, manifest, intent["starting_roots"], expected_terminal)
    except Exception:
        _fail("replay_commit_ambiguous_readback_only")
    body = _replay_terminal_body(intent, intent_receipt, readback)
    try:
        receipt = _publish_or_verify_terminal(args.output, root, "local-branch-replay", body)
    except Exception:
        _fail("replay_commit_ambiguous_readback_only")
    return MappingProxyType({"schema": body["schema"], "receipt_sha256": receipt})


def _validated_replay(body: Mapping[str, Any], *, source: SourceBinding, reference: Any,
                      hosted: Any, hosted_receipt: str, now: int, repository_root: Path | None = None) -> Mapping[str, Any]:
    required = {
        "schema", "issued_at", "expires_at", "final_recovery_commit", "runtime_source_root",
        "target_fingerprint", "reference_receipt_sha256", "hosted_observation_receipt_sha256",
        "clone_binding_receipt_sha256", "clone_observation_receipt_sha256", "clone_identity",
        "clone_nonce", "live_identity_sha256", "container_id_sha256", "endpoint_sha256",
        "prefix_classification", "selected_branch", "starting_roots", "source_plan_sha256",
        "replay_plan_sha256", "intent_body_sha256", "terminal_tuple_sha256",
        "replay_intent_receipt_sha256", "terminal_readback_sha256", "terminal_rows",
        "terminal_ledger_root", "terminal_catalog_root", "terminal_acl_root",
        "terminal_data_root", "terminal_spec_root",
    }
    branch = body.get("selected_branch")
    provenance = body.get("unapplied_provenance")
    if branch == "UNAPPLIED":
        required.add("unapplied_provenance")
        if provenance == "prepared-from-full-escaped":
            required.add("preparation_receipt_sha256")
    hashes = required - {"schema", "issued_at", "expires_at", "final_recovery_commit",
                         "runtime_source_root", "prefix_classification", "selected_branch",
                         "clone_nonce", "starting_roots", "terminal_rows", "unapplied_provenance"}
    absent = {"ledger": reference.ledger_prefix_sha256, "catalog": reference.absent_catalog_sha256, "data": None}
    full = {"ledger": reference.ledger_prefix_sha256, "catalog": reference.full_catalog_sha256, "data": reference.full_data_sha256}
    terminal_readback = {"terminal_rows": body.get("terminal_rows"), "ledger": body.get("terminal_ledger_root"),
                         "catalog": body.get("terminal_catalog_root"), "acl": body.get("terminal_acl_root"),
                         "data": body.get("terminal_data_root"), "terminal_spec": body.get("terminal_spec_root")}
    terminal = _terminal_tuple(reference)
    intent_body = {
        **{key: value for key, value in body.items() if key not in {
            "replay_intent_receipt_sha256", "terminal_readback_sha256"}},
        "schema": "g040-local-branch-replay-intent-v2",
    }
    if (set(body) != required or body.get("schema") != "g040-local-branch-replay-v3"
            or type(body.get("issued_at")) is not int or type(body.get("expires_at")) is not int
            or not body["issued_at"] <= now <= body["expires_at"]
            or body["expires_at"] - body["issued_at"] > 900
            or body["final_recovery_commit"] != source.final_commit
            or body["runtime_source_root"] != source.runtime_source_root
            or body["target_fingerprint"] != reference.target_fingerprint
            or body["reference_receipt_sha256"] != reference.receipt_sha256
            or body["hosted_observation_receipt_sha256"] != hosted_receipt
            or not _SAFE.fullmatch(body["clone_nonce"])
            or any(type(body[key]) is not str or not _HEX.fullmatch(body[key]) for key in hashes)
            or type(body["terminal_rows"]) is not int
            or any(body[key] != value for key, value in terminal.items())
            or body["terminal_tuple_sha256"] != reference.terminal_tuple_sha256
            or body["terminal_readback_sha256"] != _sha(_canonical(terminal_readback))
            or body["intent_body_sha256"] != _intent_body_sha256(intent_body)
            or body["source_plan_sha256"] != reference.source_plan_sha256
            or (type(body["starting_roots"]) is not dict or set(body["starting_roots"]) != {"ledger", "catalog", "data"})
            or branch not in {"FULL_ESCAPED", "UNAPPLIED"}
            or body["prefix_classification"] != branch
            or (branch == "FULL_ESCAPED" and (provenance is not None or "preparation_receipt_sha256" in body or body["starting_roots"] != full))
            or (branch == "UNAPPLIED" and (provenance not in {"native-hosted-unapplied", "prepared-from-full-escaped"}
                or body["starting_roots"] != absent
                or (provenance == "native-hosted-unapplied" and ("preparation_receipt_sha256" in body or hosted.status != "UNAPPLIED"))
                or (provenance == "prepared-from-full-escaped" and ("preparation_receipt_sha256" not in body or hosted.status != "FULL_ESCAPED"))))):
        _fail("replay_comparison")
    if repository_root is not None:
        recompiled = compile_branch_plan(
            repository_root, validate_sources(repository_root), source=source, reference=reference,
            observation=_expected_prefix(reference, branch, **body["starting_roots"]))
        if body["replay_plan_sha256"] != _replay_plan_sha256(recompiled, reference.source_plan_sha256):
            _fail("replay_comparison")
    return body


def compare_replays(args: argparse.Namespace) -> Mapping[str, Any]:
    root = Path(args.repository_root).resolve()
    source = _source(root, args.source_commit)
    controller_args = _controller_args(SimpleNamespace(**vars(args), observation=args.hosted_observation))
    reference = controller._reference(controller_args, source)
    hosted, hosted_receipt = controller._load_observation(controller_args, source, reference)
    issued = int(time.time())
    receipts = []
    try:
        for path in (args.first_replay, args.second_replay):
            raw = controller._stable_bytes(controller._outside(path, root), root)
            replay = controller._signed_document(raw, "local-branch-replay")
            body = _validated_replay(
                replay, source=source, reference=reference, hosted=hosted,
                hosted_receipt=hosted_receipt, now=issued, repository_root=root)
            receipts.append((body, _sha(raw)))
    except Exception:
        _fail("replay_comparison")
    first, second = receipts[0][0], receipts[1][0]
    lineage = ("final_recovery_commit", "runtime_source_root", "reference_receipt_sha256",
               "target_fingerprint")
    terminal_roots = ("terminal_ledger_root", "terminal_catalog_root", "terminal_acl_root",
                      "terminal_data_root", "terminal_spec_root")
    signed_terminal_tuple = ("terminal_rows", *terminal_roots)
    distinct_clone_fields = ("clone_identity", "clone_nonce", "live_identity_sha256",
                             "container_id_sha256", "endpoint_sha256",
                             "clone_binding_receipt_sha256", "clone_observation_receipt_sha256")
    if (receipts[0][1] == receipts[1][1]
            or {first["selected_branch"], second["selected_branch"]} != {"FULL_ESCAPED", "UNAPPLIED"}
            or any(first[key] != second[key] for key in lineage + signed_terminal_tuple)
            or any(first[key] == second[key] for key in distinct_clone_fields)):
        _fail("replay_comparison")
    expires_at = min(issued + 900, first["expires_at"], second["expires_at"])
    if expires_at <= issued:
        _fail("replay_comparison")
    full = first if first["selected_branch"] == "FULL_ESCAPED" else second
    unapplied = second if full is first else first
    body = {
        "schema": "g040-clone-rehearsal-v1", "issued_at": issued, "expires_at": expires_at,
        "final_recovery_commit": source.final_commit, "runtime_source_root": source.runtime_source_root,
        "reference_receipt_sha256": first["reference_receipt_sha256"],
        "hosted_observation_receipt_sha256": unapplied["hosted_observation_receipt_sha256"],
        "target_fingerprint": first["target_fingerprint"],
        "full_replay_receipt_sha256": receipts[0][1] if full is first else receipts[1][1],
        "unapplied_replay_receipt_sha256": receipts[0][1] if unapplied is first else receipts[1][1],
        "full_clone_identity": full["clone_identity"],
        "unapplied_clone_identity": unapplied["clone_identity"],
        **{key: first[key] for key in signed_terminal_tuple},
    }
    receipt = controller._write_signed(controller._outside(args.output, root, fresh=True),
                                       {"schema": controller.SCHEMA, "kind": "clone-rehearsal", "body": body},
                                       repository_root=root)
    return MappingProxyType({"schema": body["schema"], "receipt_sha256": receipt})


def index_artifacts(artifact_dir: str | Path, allowlist: list[str], output: str | Path) -> None:
    root = Path(artifact_dir).resolve()
    if not 0 < len(allowlist) <= 24 or len(set(allowlist)) != len(allowlist):
        _fail("artifact_bounds")
    files = []
    for relative in allowlist:
        path = (root / relative).resolve()
        if not path.is_relative_to(root) or not path.is_file() or path.is_symlink() or path.stat().st_size > _MAX_ARTIFACT:
            _fail("artifact_bounds")
        files.append({"path": relative, "bytes": path.stat().st_size, "sha256": _hash_file(path)})
    _write(output, {"schema": "g040-clone-artifact-index-v1", "files": files})


def cleanup(run_id: str, docker: str = "docker") -> Mapping[str, Any]:
    if not _SAFE.fullmatch(run_id or ""):
        _fail("cleanup_guard")
    labels = ["--filter", f"label={_LABEL}=true", "--filter", f"label=com.tzudong.g040.run={run_id}"]
    removed: dict[str, int] = {}
    for kind, command in (("container", [docker, "ps", "-aq"]), ("volume", [docker, "volume", "ls", "-q"]), ("network", [docker, "network", "ls", "-q"])):
        try:
            result = subprocess.run([*command, *labels], capture_output=True, text=True, check=True)
            ids = [line for line in result.stdout.splitlines() if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", line)]
            if len(ids) != len(result.stdout.splitlines()):
                _fail("cleanup_guard")
            for identity in ids:
                subprocess.run([docker, "rm", "-f", identity] if kind == "container" else [docker, kind, "rm", identity], capture_output=True, check=True)
            removed[kind] = len(ids)
        except RehearsalError:
            raise
        except Exception:
            _fail("cleanup_failed")
    return {"schema": "g040-clone-cleanup-v1", "run_id_sha256": _sha(run_id.encode()), "removed": removed}


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="g040-clone-rehearsal")
    sub = parser.add_subparsers(dest="mode", required=True)
    common = argparse.ArgumentParser(add_help=False); common.add_argument("--service-file", required=True); common.add_argument("--service-name", default="g035-local")
    p = sub.add_parser("preflight", parents=[common]); p.add_argument("--image", required=True); p.add_argument("--image-metadata", required=True); p.add_argument("--output", required=True)
    p = sub.add_parser("bind-restore", parents=[common]); p.add_argument("--clone-nonce", required=True); p.add_argument("--capture-receipt", required=True); p.add_argument("--restore-receipt", required=True); p.add_argument("--encrypted-dump", required=True); p.add_argument("--lineage-attestation", required=True); p.add_argument("--lineage-signature", required=True); p.add_argument("--repository-root", required=True); p.add_argument("--container", required=True); p.add_argument("--docker", default="docker"); p.add_argument("--output", required=True)
    p = sub.add_parser("observe-reference", parents=[common]); p.add_argument("--repository-root", required=True); p.add_argument("--source-commit", required=True); p.add_argument("--target-fingerprint", required=True); p.add_argument("--binding", required=True); p.add_argument("--container", required=True); p.add_argument("--docker", default="docker"); p.add_argument("--output", required=True)
    p = sub.add_parser("build-reference-request"); p.add_argument("--repository-root", required=True); p.add_argument("--source-commit", required=True); p.add_argument("--target-fingerprint", required=True); p.add_argument("--nonce", required=True); p.add_argument("--first-observation", required=True); p.add_argument("--second-observation", required=True); p.add_argument("--valid-seconds", type=int, default=600); p.add_argument("--output", required=True)
    p = sub.add_parser("finalize-reference"); p.add_argument("--repository-root", required=True); p.add_argument("--source-commit", required=True); p.add_argument("--target-fingerprint", required=True); p.add_argument("--request", required=True); p.add_argument("--signature", required=True); p.add_argument("--output", required=True)
    p = sub.add_parser("build-lineage-request", parents=[common]); p.add_argument("--repository-root", required=True); p.add_argument("--clone-nonce", required=True); p.add_argument("--capture-receipt", required=True); p.add_argument("--restore-receipt", required=True); p.add_argument("--encrypted-dump", required=True); p.add_argument("--container", required=True); p.add_argument("--docker", default="docker"); p.add_argument("--valid-seconds", type=int, default=600); p.add_argument("--output", required=True)
    p = sub.add_parser("prepare-local-state", parents=[common]); p.add_argument("--repository-root", required=True); p.add_argument("--source-commit", required=True); p.add_argument("--target-fingerprint", required=True); p.add_argument("--reference", required=True); p.add_argument("--observation", required=True); p.add_argument("--binding", required=True); p.add_argument("--clone-observation", required=True); p.add_argument("--container", required=True); p.add_argument("--docker", default="docker"); p.add_argument("--intent-output", required=True); p.add_argument("--output", required=True)
    p = sub.add_parser("replay-branch", parents=[common]); p.add_argument("--repository-root", required=True); p.add_argument("--source-commit", required=True); p.add_argument("--target-fingerprint", required=True); p.add_argument("--reference", required=True); p.add_argument("--observation", required=True); p.add_argument("--binding", required=True); p.add_argument("--clone-observation", required=True); p.add_argument("--container", required=True); p.add_argument("--docker", default="docker"); p.add_argument("--selected-branch", choices=("UNAPPLIED", "FULL_ESCAPED"), required=True); p.add_argument("--preparation"); p.add_argument("--intent-output", required=True); p.add_argument("--output", required=True)
    p = sub.add_parser("recover-local-state", parents=[common]); p.add_argument("--repository-root", required=True); p.add_argument("--source-commit", required=True); p.add_argument("--target-fingerprint", required=True); p.add_argument("--reference", required=True); p.add_argument("--observation", required=True); p.add_argument("--binding", required=True); p.add_argument("--clone-observation", required=True); p.add_argument("--container", required=True); p.add_argument("--docker", default="docker"); p.add_argument("--intent", required=True); p.add_argument("--output", required=True)
    p = sub.add_parser("recover-branch", parents=[common]); p.add_argument("--repository-root", required=True); p.add_argument("--source-commit", required=True); p.add_argument("--target-fingerprint", required=True); p.add_argument("--reference", required=True); p.add_argument("--observation", required=True); p.add_argument("--binding", required=True); p.add_argument("--clone-observation", required=True); p.add_argument("--container", required=True); p.add_argument("--docker", default="docker"); p.add_argument("--preparation"); p.add_argument("--intent", required=True); p.add_argument("--output", required=True)
    p = sub.add_parser("compare-replays"); p.add_argument("--repository-root", required=True); p.add_argument("--source-commit", required=True); p.add_argument("--target-fingerprint", required=True); p.add_argument("--reference", required=True); p.add_argument("--hosted-observation", required=True); p.add_argument("--first-replay", required=True); p.add_argument("--second-replay", required=True); p.add_argument("--output", required=True)
    p = sub.add_parser("aggregate-custody"); p.add_argument("--repository-root", required=True); p.add_argument("--source-commit", required=True); p.add_argument("--target-fingerprint", required=True); p.add_argument("--reference", required=True); p.add_argument("--hosted-observation", required=True); p.add_argument("--freeze-assertion", required=True); p.add_argument("--freeze-evidence", action="append", required=True); p.add_argument("--production-backup", required=True); p.add_argument("--g035-capture", required=True); p.add_argument("--g035-archive", required=True); p.add_argument("--clone-rehearsal", required=True); p.add_argument("--first-replay", required=True); p.add_argument("--second-replay", required=True); p.add_argument("--valid-seconds", type=int, default=600); p.add_argument("--output", required=True)
    p = sub.add_parser("verify-aggregate-custody"); p.add_argument("--repository-root", required=True); p.add_argument("--source-commit", required=True); p.add_argument("--target-fingerprint", required=True); p.add_argument("--reference", required=True); p.add_argument("--custody", required=True)
    p = sub.add_parser("index"); p.add_argument("--artifact-dir", required=True); p.add_argument("--file", action="append", required=True); p.add_argument("--output", required=True)
    p = sub.add_parser("cleanup"); p.add_argument("--run-id", required=True); p.add_argument("--docker", default="docker")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.mode == "preflight":
            result = preflight(service_file=args.service_file, service_name=args.service_name, image=args.image, image_metadata=args.image_metadata); _write(args.output, result)
        elif args.mode == "bind-restore":
            result = dict(bind_restore(clone_nonce=args.clone_nonce, capture_receipt=args.capture_receipt, restore_receipt=args.restore_receipt, encrypted_dump=args.encrypted_dump, lineage_attestation=args.lineage_attestation, lineage_signature=args.lineage_signature, repository_root=args.repository_root, service_file=args.service_file, service_name=args.service_name, container=args.container, docker=args.docker, output=args.output))
        elif args.mode == "observe-reference":
            observe_reference(repository_root=args.repository_root, source_commit=args.source_commit, target_fingerprint=args.target_fingerprint, binding_path=args.binding, service_file=args.service_file, service_name=args.service_name, container=args.container, docker=args.docker, output=args.output); result = {"status": "observed"}
        elif args.mode == "build-reference-request":
            result = dict(build_reference_request_file(source=_source(args.repository_root, args.source_commit), target_fingerprint=args.target_fingerprint, nonce=args.nonce, first_observation=args.first_observation, second_observation=args.second_observation, valid_seconds=args.valid_seconds, output=args.output, repository_root=args.repository_root))
        elif args.mode == "finalize-reference":
            result = dict(finalize_reference_file(source=_source(args.repository_root, args.source_commit), target_fingerprint=args.target_fingerprint, request=args.request, signature=args.signature, output=args.output, repository_root=args.repository_root))
        elif args.mode == "build-lineage-request":
            result = dict(build_clone_lineage_request(clone_nonce=args.clone_nonce, capture_receipt=args.capture_receipt, restore_receipt=args.restore_receipt, encrypted_dump=args.encrypted_dump, repository_root=args.repository_root, service_file=args.service_file, service_name=args.service_name, container=args.container, docker=args.docker, valid_seconds=args.valid_seconds, output=args.output))
        elif args.mode == "prepare-local-state":
            result = dict(prepare_local_state(args))
        elif args.mode == "replay-branch":
            result = dict(replay_branch(args))
        elif args.mode == "recover-local-state":
            result = dict(recover_local_state(args))
        elif args.mode == "recover-branch":
            result = dict(recover_branch(args))
        elif args.mode == "compare-replays":
            result = dict(compare_replays(args))
        elif args.mode == "aggregate-custody":
            result = build_aggregate_custody(args)
        elif args.mode == "verify-aggregate-custody":
            result = dict(verify_aggregate_custody(args))
        elif args.mode == "index": index_artifacts(args.artifact_dir, args.file, args.output); result = {"status": "indexed"}
        else: result = cleanup(args.run_id, args.docker)
        print(json.dumps(result, sort_keys=True, separators=(",", ":")))
        return 0
    except RehearsalError as error:
        print(json.dumps({"status": "denied", "code": str(error)}, separators=(",", ":")))
        return 2
    except Exception:
        print(json.dumps({"status": "denied", "code": "operation_failed"}, separators=(",", ":")))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
