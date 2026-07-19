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
import subprocess
import sys
import time
from pathlib import Path
from types import MappingProxyType, SimpleNamespace
from typing import Any, Mapping

import g037_managed_recovery as crypto
import g035_hosted_recovery as g035
import g040_production_controller as controller
from g037_hosted_closure_contract import validate_sources
from g037_hosted_closure_executor import vectors
from g040_prefix_recovery import CATALOG_PROBE, DATA_PROBE, begin_read_only_snapshot
from g040_recovery_source import SourceBinding, verify_recovery_source
from g040_reference_evidence import (
    PUBLIC_KEY_PEM as REFERENCE_PUBLIC_KEY_PEM,
    PUBLIC_KEY_SHA256 as REFERENCE_PUBLIC_KEY_SHA256,
    build_clone_run,
    build_reference_body,
    sign_reference,
    verify_reference,
)

_HEX = re.compile(r"^[0-9a-f]{64}$")
_SAFE = re.compile(r"^[A-Za-z0-9_-]{16,128}$")
_IMAGE = "supabase/postgres:17.6.1.147"
_LABEL = "com.tzudong.g040.rehearsal"
_MAX_ARTIFACT = 1_048_576
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
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() or target.is_symlink():
            _fail("output_exists")
        data = _canonical(dict(value))
        if len(data) > _MAX_ARTIFACT:
            _fail("artifact_bounds")
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
    except RehearsalError:
        raise
    except Exception:
        _fail("artifact_write")


def _sha(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _hash_file(path: str | Path) -> str:
    try:
        return _sha(Path(path).read_bytes())
    except Exception:
        _fail("artifact_read")
def _custody_bytes(path: str | Path, root: str | Path) -> bytes:
    try:
        return controller._stable_bytes(controller._outside(path, Path(root).resolve()))
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
    required = {"host", "port", "dbname", "application_name", "sslmode", "password"}
    if (set(values) != required or values["host"] != "127.0.0.1" or not values["port"].isdigit()
            or not 1 <= int(values["port"]) <= 65535 or values["dbname"] != "g035_local"
            or values["sslmode"] != "disable" or "g035-local" not in values["application_name"]):
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
        raw = controller._stable_bytes(candidate)
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
        cur.execute("SELECT current_setting('server_version_num')::integer")
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


def _docker_clone_proof(container: str, service_port: int, docker: str = "docker") -> Mapping[str, Any]:
    if not _SAFE.fullmatch(container or "") or type(service_port) is not int or not 1 <= service_port <= 65535:
        _fail("docker_identity")
    try:
        item = json.loads(subprocess.run([docker, "inspect", "--type", "container", container], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=20, check=True).stdout.decode("utf-8"))
        if type(item) is not list or len(item) != 1 or type(item[0]) is not dict:
            _fail("docker_identity")
        item = item[0]; config, settings = item.get("Config"), item.get("NetworkSettings")
        labels = config.get("Labels") if type(config) is dict else None
        networks = settings.get("Networks") if type(settings) is dict else None
        ports = settings.get("Ports") if type(settings) is dict else None
        binding = ports.get("5432/tcp") if type(ports) is dict and set(ports) == {"5432/tcp"} else None
        container_id, image_id = item.get("Id"), item.get("Image")
        if (type(labels) is not dict or labels.get(_LABEL) != "true" or config.get("Image") != _IMAGE
                or item.get("HostConfig", {}).get("NetworkMode") == "host" or type(networks) is not dict or not networks
                or type(binding) is not list or len(binding) != 1 or type(binding[0]) is not dict
                or binding[0].get("HostIp") != "127.0.0.1" or binding[0].get("HostPort") != str(service_port)
                or type(container_id) is not str or not re.fullmatch(r"[0-9a-f]{64}", container_id)
                or type(image_id) is not str or not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id)
                or any(not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", name) or any(word in name.lower() for word in ("tunnel", "remote", "proxy")) for name in networks)):
            _fail("docker_endpoint")
        image = json.loads(subprocess.run([docker, "image", "inspect", image_id], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=20, check=True).stdout.decode("utf-8"))
        digests = image[0].get("RepoDigests") if type(image) is list and len(image) == 1 and type(image[0]) is dict else None
        if type(digests) is not list or len(digests) != 1 or not isinstance(digests[0], str) or not re.fullmatch(r"supabase/postgres@sha256:[0-9a-f]{64}", digests[0]):
            _fail("docker_identity")
        return MappingProxyType({"container_id_sha256": _sha(container_id.encode()), "image_id_sha256": _sha(image_id.encode()), "image_digest_sha256": _sha(digests[0].encode()), "endpoint_sha256": _sha(_canonical({"host": "127.0.0.1", "port": service_port}))})
    except RehearsalError:
        raise
    except Exception:
        _fail("docker_identity")


def _restore_lineage(*, capture_path: str | Path, restore_path: str | Path, encrypted_dump: str | Path, repository_root: str | Path) -> Mapping[str, Any]:
    capture_raw = _custody_bytes(capture_path, repository_root)
    restore_raw = _custody_bytes(restore_path, repository_root)
    dump_raw = _custody_bytes(encrypted_dump, repository_root)
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
            or capture_evidence.get("dump_sha256") != _sha(dump_raw) or capture_evidence.get("dump_bytes") != len(dump_raw)
            or not _HEX.fullmatch(capture_evidence.get("source_sha256", ""))
            or any(capture_evidence.get(key) != restore_evidence.get(key) for key in ledger)):
        _fail("restore_lineage")
    return MappingProxyType({"g035_restore_receipt_sha256": restore_receipt, "g035_capture_receipt_sha256": capture_receipt, "restored_archive_sha256": _sha(dump_raw), "capture_receipt_bytes_sha256": _sha(capture_raw), "restore_receipt_bytes_sha256": _sha(restore_raw), "archive_bytes": len(dump_raw), "g035_manifest_sha256": capture["manifest_sha256"], "source_sha256": capture_evidence["source_sha256"]})


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
    lineage = _restore_lineage(capture_path=capture_receipt, restore_path=restore_receipt, encrypted_dump=encrypted_dump, repository_root=root)
    before = tuple(_hash_file(path) for path in (capture_receipt, restore_receipt, encrypted_dump))
    conn, service = _connect_service(service_file, service_name, readonly=True, repository_root=root)
    try:
        live = _live_identity(conn)
    finally:
        try: conn.rollback(); conn.close()
        except Exception: pass
    proof, now = _docker_clone_proof(container, service["port"], docker), int(time.time()) if now_unix is None else now_unix
    attestation_path = controller._outside(lineage_attestation, root)
    signature_path = controller._outside(lineage_signature, root)
    attested = _load_bytes(_custody_bytes(attestation_path, root))
    expected = {"schema": _LINEAGE_SCHEMA, "clone_nonce": clone_nonce, "issued_at_unix": attested.get("issued_at_unix"), "expires_at_unix": attested.get("expires_at_unix"), "lineage_public_key_sha256": _LINEAGE_PUBLIC_KEY_SHA256, **dict(lineage), "live_identity_sha256": _sha(_canonical(dict(live))), **dict(proof)}
    attestation_hashes = _verify_lineage_attestation(attestation=attestation_path, signature=signature_path, expected=expected, repository_root=root, now_unix=now)
    if before != tuple(_hash_file(path) for path in (capture_receipt, restore_receipt, encrypted_dump)):
        _fail("lineage_replacement")
    live_sha = _sha(_canonical(dict(live)))
    clone_identity = _sha(_canonical({"live_identity_sha256": live_sha, **dict(proof)}))
    body = {"schema": "g040-clone-restore-binding-v4", "clone_identity": clone_identity, "clone_nonce": clone_nonce, "live_identity_sha256": live_sha, "capture_receipt_path": str(Path(capture_receipt).resolve()), "restore_receipt_path": str(Path(restore_receipt).resolve()), "encrypted_dump_path": str(Path(encrypted_dump).resolve()), "lineage_attestation_path": str(attestation_path), "lineage_signature_path": str(signature_path), **dict(proof), **dict(lineage), **dict(attestation_hashes)}
    try:
        path = controller._outside(output, root, fresh=True)
        receipt = controller._write_signed(path, {"schema": controller.SCHEMA, "kind": "local-clone-binding", "body": body})
    except Exception:
        _fail("clone_binding")
    return MappingProxyType({**body, "binding_receipt_sha256": receipt})


def _binding(path: str | Path, repository_root: str | Path) -> Mapping[str, Any]:
    root = Path(repository_root).resolve()
    try:
        raw = controller._stable_bytes(controller._outside(path, root))
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
    return MappingProxyType(value)


def _observation(binding: Mapping[str, Any], state: str, catalog: str, ledger: str, data: str | None = None) -> dict[str, Any]:
    keys = ("clone_identity", "clone_nonce", "live_identity_sha256", "container_id_sha256", "image_id_sha256", "image_digest_sha256", "endpoint_sha256", "g035_restore_receipt_sha256", "g035_capture_receipt_sha256", "restored_archive_sha256", "capture_receipt_bytes_sha256", "restore_receipt_bytes_sha256", "archive_bytes", "g035_manifest_sha256", "source_sha256", "lineage_attestation_path", "lineage_signature_path", "lineage_attestation_sha256", "lineage_signature_sha256")
    result = {key: binding[key] for key in keys} | {"state": state, "ledger_prefix_sha256": ledger, "catalog_sha256": catalog}
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


def _assert_observation_binding(binding: Mapping[str, Any], *, verified_port: int, container: str, docker: str, conn: Any, repository_root: str | Path) -> None:
    root = Path(repository_root).resolve()
    lineage = _restore_lineage(capture_path=binding["capture_receipt_path"], restore_path=binding["restore_receipt_path"], encrypted_dump=binding["encrypted_dump_path"], repository_root=root)
    if any(binding[key] != lineage[key] for key in lineage):
        _fail("observation_binding")
    info = conn.info
    if info.host != "127.0.0.1" or info.port != verified_port:
        _fail("service_endpoint")
    proof = _docker_clone_proof(container, verified_port, docker)
    live = _live_identity(conn)
    live_sha = _sha(_canonical(dict(live)))
    if any(binding[key] != proof[key] for key in proof) or binding["live_identity_sha256"] != live_sha:
        _fail("observation_binding")
    attested = _load_bytes(_custody_bytes(binding["lineage_attestation_path"], root))
    expected = {"schema": _LINEAGE_SCHEMA, "clone_nonce": binding["clone_nonce"], "issued_at_unix": attested.get("issued_at_unix"), "expires_at_unix": attested.get("expires_at_unix"), "lineage_public_key_sha256": _LINEAGE_PUBLIC_KEY_SHA256, **dict(lineage), "live_identity_sha256": live_sha, **dict(proof)}
    hashes = _verify_lineage_attestation(attestation=binding["lineage_attestation_path"], signature=binding["lineage_signature_path"], expected=expected, repository_root=root, now_unix=int(time.time()))
    if any(binding[key] != hashes[key] for key in hashes):
        _fail("observation_binding")


def observe_reference(*, repository_root: str | Path, binding_path: str | Path, service_file: str | Path,
                      service_name: str, source_commit: str, absent_output: str | Path, full_output: str | Path,
                      container: str, docker: str = "docker") -> None:
    """Run the exact source-pinned 00400 vector under rollback, then re-prove absence."""
    binding = _binding(binding_path, repository_root)
    root = Path(repository_root).resolve()
    _source(root, source_commit)
    manifest = validate_sources(root)
    item = manifest.migrations[16]
    if (item.version, item.name) != ("20260712000400", "g010_retention_separation"):
        _fail("source_drift")
    _, executable = vectors(root, item)
    conn, service = _connect_service(service_file, service_name, readonly=False, repository_root=root)
    cur = None
    try:
        cur = conn.cursor()
        _assert_observation_binding(binding, verified_port=service["port"], container=container, docker=docker, conn=conn, repository_root=repository_root)
        conn.rollback()
        begin_read_only_snapshot(cur)
        absent = _query_one(cur, CATALOG_PROBE)
        cur.execute("ROLLBACK")
        _valid_probe(absent, full=False)
        if absent.get("ledger_count") != 28 or absent.get("v00400_count") != 0:
            _fail("partial_state")
        _assert_observation_binding(binding, verified_port=service["port"], container=container, docker=docker, conn=conn, repository_root=repository_root)
        conn.rollback()
        cur.execute("BEGIN")
        cur.execute("LOCK TABLE supabase_migrations.schema_migrations IN ACCESS EXCLUSIVE MODE")
        for statement in executable:
            cur.execute(statement)
        full = _query_one(cur, CATALOG_PROBE)
        data = _query_one(cur, DATA_PROBE)
        cur.execute("ROLLBACK")
        _valid_probe(full, full=True)
        _valid_data(data)
        if full.get("ledger_count") != 28 or full.get("v00400_count") != 0 or full["ledger_sha256"] != absent["ledger_sha256"]:
            _fail("partial_state")
        _assert_observation_binding(binding, verified_port=service["port"], container=container, docker=docker, conn=conn, repository_root=repository_root)
        conn.rollback()
        begin_read_only_snapshot(cur)
        after = _query_one(cur, CATALOG_PROBE)
        cur.execute("ROLLBACK")
        _valid_probe(after, full=False)
        if after.get("v00400_count") != 0 or after["catalog_sha256"] != absent["catalog_sha256"] or after["ledger_sha256"] != absent["ledger_sha256"]:
            _fail("rollback_invariant")
        _write(absent_output, _observation(binding, "absent", absent["catalog_sha256"], absent["ledger_sha256"]))
        _write(full_output, _observation(binding, "full", full["catalog_sha256"], full["ledger_sha256"], data["data_shape_sha256"]))
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
def _reference_signer(private_key: str | Path, *, repository_root: str | Path | None = None) -> Any:
    try:
        key_path = Path(private_key).resolve()
        if repository_root is not None:
            root = Path(repository_root).resolve()
            if key_path == root or root in key_path.parents:
                _fail("reference_signing_key")
        key = crypto.require_file(key_path, "reference signing key")
        public = subprocess.run(
            [crypto.command("openssl"), "pkey", "-in", str(key), "-pubout"],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            timeout=crypto.TIMEOUT, check=True,
        ).stdout
        if _sha(public) != REFERENCE_PUBLIC_KEY_SHA256:
            _fail("reference_signing_key")
        return lambda payload: crypto.openssl_sign(crypto.command("openssl"), key, payload)
    except RehearsalError:
        raise
    except Exception:
        _fail("reference_signing_key")


def build_aggregate_custody(args: argparse.Namespace) -> Mapping[str, Any]:
    """Write the controller's exact receipt-signed aggregate-custody document."""
    source = _source(args.repository_root, args.source_commit)
    reference = controller._reference(_controller_args(args), source)
    if type(args.valid_seconds) is not int or not 1 <= args.valid_seconds <= 900:
        _fail("aggregate_custody")
    issued = int(time.time())
    hashes = (
        "freeze_root", "backup_receipt_sha256", "capture_receipt_sha256",
        "clone_rehearsal_receipt_sha256", "inventory_root", "target_ledger_root",
        "target_catalog_root", "target_data_root",
    )
    values = {key: getattr(args, key) for key in hashes}
    if any(type(value) is not str or not _HEX.fullmatch(value) for value in values.values()):
        _fail("aggregate_custody")
    body = {
        "issued_at": issued,
        "expires_at": issued + args.valid_seconds,
        "final_recovery_commit": source.final_commit,
        "runtime_source_root": source.runtime_source_root,
        "reference_receipt_sha256": reference.receipt_sha256,
        "target_fingerprint": reference.target_fingerprint,
        **values,
    }
    root = Path(args.repository_root).resolve()
    path = controller._outside(args.output, root, fresh=True)
    receipt = controller._write_signed(path, {"schema": controller.SCHEMA, "kind": "aggregate-custody", "body": body})
    return MappingProxyType({"schema": controller.SCHEMA, "receipt_sha256": receipt})

def verify_aggregate_custody(args: argparse.Namespace) -> Mapping[str, Any]:
    source = _source(args.repository_root, args.source_commit)
    reference = controller._reference(_controller_args(args), source)
    verified = controller._custody(_controller_args(args), source, reference)
    return MappingProxyType({"schema": controller.SCHEMA, "target_fingerprint": verified.target_fingerprint})


def _revalidate_observation_lineage(observation: Mapping[str, Any], repository_root: str | Path) -> Mapping[str, Any]:
    root = Path(repository_root).resolve()
    required = {"clone_nonce", "live_identity_sha256", "container_id_sha256", "image_id_sha256", "image_digest_sha256", "endpoint_sha256", "g035_restore_receipt_sha256", "g035_capture_receipt_sha256", "restored_archive_sha256", "capture_receipt_bytes_sha256", "restore_receipt_bytes_sha256", "archive_bytes", "g035_manifest_sha256", "source_sha256", "lineage_attestation_path", "lineage_signature_path", "lineage_attestation_sha256", "lineage_signature_sha256"}
    if not required <= set(observation):
        _fail("reference_input")
    attested = _load_bytes(_custody_bytes(observation["lineage_attestation_path"], root))
    expected = {"schema": _LINEAGE_SCHEMA, "clone_nonce": observation["clone_nonce"], "issued_at_unix": attested.get("issued_at_unix"), "expires_at_unix": attested.get("expires_at_unix"), "lineage_public_key_sha256": _LINEAGE_PUBLIC_KEY_SHA256, **{key: observation[key] for key in ("g035_restore_receipt_sha256", "g035_capture_receipt_sha256", "restored_archive_sha256", "capture_receipt_bytes_sha256", "restore_receipt_bytes_sha256", "archive_bytes", "g035_manifest_sha256", "source_sha256", "live_identity_sha256", "container_id_sha256", "image_id_sha256", "image_digest_sha256", "endpoint_sha256")}}
    hashes = _verify_lineage_attestation(attestation=observation["lineage_attestation_path"], signature=observation["lineage_signature_path"], expected=expected, repository_root=root, now_unix=int(time.time()))
    if any(observation[key] != hashes[key] for key in hashes):
        _fail("reference_input")
    return MappingProxyType({key: observation[key] for key in ("clone_identity", "clone_nonce", "live_identity_sha256", "container_id_sha256", "image_id_sha256", "image_digest_sha256", "endpoint_sha256", "g035_restore_receipt_sha256", "g035_capture_receipt_sha256", "restored_archive_sha256", "capture_receipt_bytes_sha256", "restore_receipt_bytes_sha256", "lineage_attestation_sha256", "lineage_signature_sha256", "state", "ledger_prefix_sha256", "catalog_sha256", "data_sha256") if key in observation})
def build_reference(*, source: SourceBinding, target_fingerprint: str, nonce: str, first_absent: str | Path,
                    first_full: str | Path, second_absent: str | Path, second_full: str | Path,
                    private_key: str | Path, output: str | Path, repository_root: str | Path | None = None, now: int | None = None, valid_seconds: int = 600) -> None:
    if type(valid_seconds) is not int or not 1 <= valid_seconds <= 900 or not _HEX.fullmatch(target_fingerprint or "") or not _SAFE.fullmatch(nonce or "") or repository_root is None:
        _fail("reference_input")
    first = build_clone_run(_revalidate_observation_lineage(_load(first_absent), repository_root), _revalidate_observation_lineage(_load(first_full), repository_root))
    second = build_clone_run(_revalidate_observation_lineage(_load(second_absent), repository_root), _revalidate_observation_lineage(_load(second_full), repository_root))
    if (first["clone_identity"] == second["clone_identity"] or first["clone_nonce"] == second["clone_nonce"]
            or first["g035_restore_receipt_sha256"] == second["g035_restore_receipt_sha256"]):
        _fail("clone_binding")
    issued = int(time.time()) if now is None else now
    body = build_reference_body(final_commit=source.final_commit, runtime_source_root=source.runtime_source_root,
                                target_fingerprint=target_fingerprint, observation_nonce=nonce,
                                issued_at_unix=issued, expires_at_unix=issued + valid_seconds,
                                first_clone=first, second_clone=second)
    signed = sign_reference(body, _reference_signer(private_key, repository_root=repository_root))
    raw = _canonical(dict(signed))
    verify_reference(raw, now_unix=issued, expected_source=source, expected_target_fingerprint=target_fingerprint)
    _write(output, signed)


def _source(root: str | Path, commit: str) -> SourceBinding:
    try:
        return verify_recovery_source(Path(root).resolve(), commit)
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



def prepare_branch(args: argparse.Namespace) -> Mapping[str, Any]:
    parse_local_service(args.service_file, args.service_name)
    if args.selected_branch not in {"UNAPPLIED", "FULL_ESCAPED"}:
        _fail("branch_state")
    _, receipt = _selected_observation(args)
    controller_args = _controller_args(args)
    controller_args.observation_receipt_sha256 = receipt
    result = controller.prepare(controller_args)
    return {"schema": "g040-clone-prepare-v1", "selected_branch": args.selected_branch, "bindings_sha256": result["bindings_sha256"]}


def apply_branch(args: argparse.Namespace) -> Mapping[str, Any]:
    parse_local_service(args.service_file, args.service_name)
    if args.selected_branch not in {"UNAPPLIED", "FULL_ESCAPED"}:
        _fail("branch_state")
    _, receipt = _selected_observation(args)
    controller_args = _controller_args(args)
    controller_args.observation_receipt_sha256 = receipt
    result = controller.execute(controller_args)
    return {"schema": "g040-clone-apply-v1", "selected_branch": args.selected_branch,
            "prepared_receipt_sha256": result["prepared_receipt_sha256"], "final_receipt_sha256": result["final_receipt_sha256"]}


def terminal_readback(args: argparse.Namespace) -> Mapping[str, Any]:
    parse_local_service(args.service_file, args.service_name)
    source = _source(args.repository_root, args.source_commit)
    controller_args = _controller_args(args)
    reference = controller._reference(controller_args, source)
    observation, receipt = controller._load_observation(controller_args, source, reference)
    custody = controller._custody(controller_args, source, reference)
    manifest = validate_sources(Path(args.repository_root).resolve())
    bindings = controller._bindings(source, reference, observation, custody, manifest, receipt)
    authorization = controller._authorization(controller_args, bindings)
    terminal = controller._final_readback(controller_args, source, reference, manifest, authorization)
    if args.selected_branch != observation.status:
        _fail("branch_state")
    return {
        "schema": "g040-clone-terminal-v1",
        "selected_branch": observation.status,
        "terminal_rows": terminal["terminal_rows"],
        "ledger_sha256": terminal["ledger_root"],
        "catalog_sha256": terminal["catalog_root"],
        "acl_sha256": terminal["acl_root"],
        "data_sha256": terminal["data_root"],
        "terminal_spec_root": terminal["terminal_spec_root"],
    }


def compare_terminal(first: Mapping[str, Any], second: Mapping[str, Any]) -> Mapping[str, Any]:
    required = {"schema", "selected_branch", "terminal_rows", "ledger_sha256", "catalog_sha256", "acl_sha256", "data_sha256", "terminal_spec_root"}
    if set(first) != required or set(second) != required or first["schema"] != "g040-clone-terminal-v1" or second["schema"] != "g040-clone-terminal-v1" or first["selected_branch"] not in {"UNAPPLIED", "FULL_ESCAPED"} or first["selected_branch"] != second["selected_branch"]:
        _fail("terminal_receipt")
    if first["terminal_rows"] != 40 or second["terminal_rows"] != 40:
        _fail("terminal_rows")
    if any(type(first[key]) is not str or not _HEX.fullmatch(first[key]) or first[key] != second[key] for key in required - {"schema", "selected_branch", "terminal_rows"}):
        _fail("terminal_mismatch")
    return MappingProxyType(dict(first))


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
    p = sub.add_parser("observe-reference", parents=[common]); p.add_argument("--repository-root", required=True); p.add_argument("--source-commit", required=True); p.add_argument("--binding", required=True); p.add_argument("--container", required=True); p.add_argument("--docker", default="docker"); p.add_argument("--absent-output", required=True); p.add_argument("--full-output", required=True)
    p = sub.add_parser("build-reference"); p.add_argument("--repository-root", required=True); p.add_argument("--source-commit", required=True); p.add_argument("--target-fingerprint", required=True); p.add_argument("--nonce", required=True); p.add_argument("--first-absent", required=True); p.add_argument("--first-full", required=True); p.add_argument("--second-absent", required=True); p.add_argument("--second-full", required=True); p.add_argument("--private-key", required=True); p.add_argument("--valid-seconds", type=int, default=600); p.add_argument("--output", required=True)
    for name in ("prepare-branch", "apply-branch", "terminal-readback"):
        p = sub.add_parser(name, parents=[common]); p.add_argument("--repository-root", required=True); p.add_argument("--source-commit", required=True); p.add_argument("--target-fingerprint", required=True); p.add_argument("--reference", required=True); p.add_argument("--observation", required=True); p.add_argument("--observation-receipt-sha256", required=True); p.add_argument("--custody", required=True); p.add_argument("--authorization", required=True); p.add_argument("--authorization-signature", required=True); p.add_argument("--selected-branch", choices=("UNAPPLIED", "FULL_ESCAPED")); p.add_argument("--journal-dir"); p.add_argument("--authority-template"); p.add_argument("--prepared-receipt"); p.add_argument("--final-receipt"); p.add_argument("--output")
    p = sub.add_parser("aggregate-custody"); p.add_argument("--repository-root", required=True); p.add_argument("--source-commit", required=True); p.add_argument("--target-fingerprint", required=True); p.add_argument("--reference", required=True); p.add_argument("--freeze-root", required=True); p.add_argument("--backup-receipt-sha256", required=True); p.add_argument("--capture-receipt-sha256", required=True); p.add_argument("--clone-rehearsal-receipt-sha256", required=True); p.add_argument("--inventory-root", required=True); p.add_argument("--target-ledger-root", required=True); p.add_argument("--target-catalog-root", required=True); p.add_argument("--target-data-root", required=True); p.add_argument("--valid-seconds", type=int, default=600); p.add_argument("--output", required=True)
    p = sub.add_parser("verify-aggregate-custody"); p.add_argument("--repository-root", required=True); p.add_argument("--source-commit", required=True); p.add_argument("--target-fingerprint", required=True); p.add_argument("--reference", required=True); p.add_argument("--custody", required=True); p.add_argument("--custody-receipt-sha256")
    p = sub.add_parser("index"); p.add_argument("--artifact-dir", required=True); p.add_argument("--file", action="append", required=True); p.add_argument("--output", required=True)
    p = sub.add_parser("compare-terminal"); p.add_argument("--first", required=True); p.add_argument("--second", required=True); p.add_argument("--output", required=True)
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
            observe_reference(repository_root=args.repository_root, source_commit=args.source_commit, binding_path=args.binding, service_file=args.service_file, service_name=args.service_name, container=args.container, docker=args.docker, absent_output=args.absent_output, full_output=args.full_output); result = {"status": "observed"}
        elif args.mode == "build-reference":
            build_reference(source=_source(args.repository_root, args.source_commit), target_fingerprint=args.target_fingerprint, nonce=args.nonce, first_absent=args.first_absent, first_full=args.first_full, second_absent=args.second_absent, second_full=args.second_full, private_key=args.private_key, valid_seconds=args.valid_seconds, output=args.output, repository_root=args.repository_root); result = {"status": "reference_built"}
        elif args.mode == "prepare-branch": result = prepare_branch(args)
        elif args.mode == "apply-branch": result = apply_branch(args)
        elif args.mode == "terminal-readback":
            if not args.output:
                _fail("terminal_output")
            result = terminal_readback(args); _write(args.output, result)
        elif args.mode == "aggregate-custody":
            result = build_aggregate_custody(args)
        elif args.mode == "verify-aggregate-custody":
            result = dict(verify_aggregate_custody(args))
        elif args.mode == "compare-terminal": result = dict(compare_terminal(_load(args.first), _load(args.second))); _write(args.output, result)
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
