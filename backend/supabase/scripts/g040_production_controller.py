#!/usr/bin/env python3
"""Local-only controller for the canonical G040 recovery artifacts.

All external artifacts are files.  Database access is exclusively through a
restrictive libpq service file; test seams are private module functions.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import stat
import subprocess
import sys
import time
import tempfile
from dataclasses import dataclass, asdict
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping

import g040_prefix_recovery as prefix
import g040_recovery_authorization as authority
from g037_hosted_closure_contract import terminal_spec, validate_operator_assertion, validate_sources
from g037_hosted_closure_executor import terminal_readback_assert
from g040_prefix_executor import ExecutorEvidence, SourceValidationPlan, apply_locked_cursor, build_execution_plan, build_source_validation_plan
from g040_recovery_source import RecoverySourceError, SourceBinding, verify_recovery_source
from g040_reference_evidence import VerifiedReference, load_reference, verify_reference
import g035_hosted_recovery as g035

SCHEMA = "g040-production-controller-v2"
MODES = frozenset(("validate-source", "validate", "diagnose", "prepare", "execute", "readback", "production-backup"))
_HEX = frozenset("0123456789abcdef")
_RECEIPT_SIGNING_KEY = Path.home() / ".g040-recovery" / "receipt-signing-key.pem"
_RECEIPT_PUBLIC_KEY_PEM = """-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAc22+PiN+MZGTH2hHfmIi9l4YOTEMQsDM1v3s/sYZIIc=
-----END PUBLIC KEY-----
"""
_RECEIPT_PUBLIC_KEY_SHA256 = "94f70fa95b361dd51e765d6e597d2e13149e3489124198df6adcce931149735a"
_ABSENT_DATA_ROOT = hashlib.sha256(b"g040-prefix-observation:no-data-root").hexdigest()

class ControllerError(RuntimeError): pass

def _deny(code: str) -> None: raise ControllerError(code)
def _hash(value: Any) -> str:
    try: return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode("ascii")).hexdigest()
    except Exception: _deny("canonical_value")
def _hex(value: Any) -> str:
    if type(value) is not str or len(value) != 64 or any(c not in _HEX for c in value): _deny("artifact_shape")
    return value

def _root(args: Any) -> Path:
    value = getattr(args, "repository_root", None)
    if not isinstance(value, (str, Path)): _deny("repository_root_required")
    return Path(value).resolve()
def _outside(path: Any, root: Path, *, fresh: bool = False) -> Path:
    if not isinstance(path, (str, Path)): _deny("artifact_file_required")
    value = Path(path).resolve()
    if value == root or root in value.parents or (fresh and value.exists()): _deny("outside_receipt_required")
    try: authority._parent_restrictive(value)
    except Exception: _deny("receipt_custody")
    return value

def _source(args: Any) -> SourceBinding:
    commit = getattr(args, "source_commit", None)
    try: return verify_recovery_source(_root(args), commit, production=True)
    except (RecoverySourceError, OSError, ValueError): _deny("source_verification")
def _reference(args: Any, source: SourceBinding, *, historical: bool = False) -> VerifiedReference:
    target = _hex(getattr(args, "target_fingerprint", None))
    try:
        raw = _stable_bytes(_outside(args.reference, _root(args)), _root(args))
        now = int(time.time())
        if historical:
            now = load_reference(raw)["issued_at_unix"]
        return verify_reference(raw, now_unix=now, expected_source=source, expected_target_fingerprint=target)
    except Exception: _deny("reference_verification")


@dataclass(frozen=True)
class LoadedObservation:
    observation: prefix.PrefixObservation
    receipt_sha256: str
    issued_at: int
    expires_at: int

    def __iter__(self):
        return iter((self.observation, self.receipt_sha256))

    def __getattr__(self, name: str) -> Any:
        return getattr(self.observation, name)


@dataclass(frozen=True)
class RecoveryCustody:
    target_fingerprint: str
    freeze_root: str
    freeze_expires_at: int
    target_acl_root: str
    backup_receipt_sha256: str
    capture_receipt_sha256: str
    archive_sha256: str
    archive_bytes: int
    clone_rehearsal_receipt_sha256: str
    inventory_root: str
    target_ledger_root: str
    target_catalog_root: str
    target_data_root: str
    expires_at: int

def _custody(args: Any, source: SourceBinding, reference: VerifiedReference, *, require_fresh: bool = True) -> RecoveryCustody:
    raw = _stable_bytes(_outside(args.custody, _root(args)), _root(args))
    try:
        value = _signed_document(raw, "aggregate-custody")
        required = set(RecoveryCustody.__annotations__) | {"issued_at", "expires_at", "final_recovery_commit", "runtime_source_root", "reference_receipt_sha256"}
        if (set(value) != required or type(value["issued_at"]) is not int or type(value["expires_at"]) is not int
                or type(value["freeze_expires_at"]) is not int or type(value["archive_bytes"]) is not int
                or value["archive_bytes"] < 0 or value["freeze_expires_at"] <= value["issued_at"]
                or value["expires_at"] <= value["issued_at"] or value["expires_at"] - value["issued_at"] > 900
                or (require_fresh and (value["issued_at"] > int(time.time()) + 30 or value["expires_at"] <= int(time.time())))
                or value["final_recovery_commit"] != source.final_commit or value["runtime_source_root"] != source.runtime_source_root
                or value["reference_receipt_sha256"] != reference.receipt_sha256 or value["target_fingerprint"] != reference.target_fingerprint):
            _deny("custody_binding")
        custody = RecoveryCustody(**{key: value[key] if key in {"freeze_expires_at", "archive_bytes", "expires_at"} else _hex(value[key]) for key in RecoveryCustody.__annotations__})
        return custody
    except ControllerError:
        raise
    except Exception:
        _deny("custody_binding")

def _nonce_store(args: Any, root: Path):
    directory = _outside(args.nonce_dir, root)
    try:
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        directory = authority._journal_parent(directory, root)
    except Exception:
        _deny("nonce_custody")
    def consume(nonce: str) -> bool:
        path = directory / (hashlib.sha256(nonce.encode("ascii")).hexdigest() + ".nonce")
        try:
            fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            try:
                authority._write_all(fd, nonce.encode("ascii")); os.fsync(fd)
            finally: os.close(fd)
            authority._fsync_directory(directory); return True
        except FileExistsError: return False
        except Exception: _deny("nonce_write")
    return consume

def _stable_bytes(path: Path, repository_root: Path) -> bytes:
    try:
        fd, raw = authority._open_custody(path, repository_root)
        try:
            return raw
        finally:
            os.close(fd)
    except Exception:
        _deny("artifact_custody")


def _archive_digest(path: Path, root: Path) -> tuple[str, int]:
    """Hash a custody-bound encrypted archive without retaining ciphertext."""
    fd: int | None = None
    try:
        archive = authority.restrictive_regular_file(path, "encrypted archive", root)
        fd = os.open(archive, os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0))
        before, opened = archive.stat(follow_symlinks=False), os.fstat(fd)
        identity = (opened.st_dev, opened.st_ino)
        if (not stat.S_ISREG(before.st_mode) or not stat.S_ISREG(opened.st_mode)
                or (before.st_dev, before.st_ino) != identity
                or before.st_size != opened.st_size):
            _deny("backup_capture")
        digest, count = hashlib.sha256(), 0
        while chunk := os.read(fd, 64 * 1024):
            digest.update(chunk)
            count += len(chunk)
        after_opened, after_path = os.fstat(fd), archive.stat(follow_symlinks=False)
        if (count != opened.st_size or (after_opened.st_dev, after_opened.st_ino) != identity
                or after_opened.st_size != opened.st_size or (after_path.st_dev, after_path.st_ino) != identity
                or after_path.st_size != opened.st_size):
            _deny("backup_capture")
        return digest.hexdigest(), count
    except ControllerError:
        raise
    except Exception:
        _deny("backup_capture")
    finally:
        if fd is not None:
            try:
                os.close(fd)
            except Exception:
                pass

def _connect_service(args: Any, *, readonly: bool) -> Any:
    root = _root(args)
    if getattr(args, "database_url", None) is not None or getattr(args, "dsn", None) is not None: _deny("raw_connection_string_forbidden")
    service_file, service_name = getattr(args, "service_file", None), getattr(args, "service_name", None)
    if not isinstance(service_name, str) or not service_name: _deny("restrictive_service_required")
    service_path = authority.restrictive_regular_file(service_file, "service file", root).resolve()
    before = _stable_bytes(service_path, root)
    try:
        import psycopg
        had_service_file = "PGSERVICEFILE" in os.environ
        prior_service_file = os.environ.get("PGSERVICEFILE")
        try:
            os.environ["PGSERVICEFILE"] = str(service_path)
            conn = psycopg.connect(service=service_name, autocommit=True, connect_timeout=20, options="-c default_transaction_read_only=on" if readonly else None, row_factory=psycopg.rows.dict_row)
        finally:
            if had_service_file:
                os.environ["PGSERVICEFILE"] = prior_service_file
            else:
                os.environ.pop("PGSERVICEFILE", None)
        if hashlib.sha256(before).digest() != hashlib.sha256(_stable_bytes(service_path, root)).digest():
            try: conn.close()
            finally: _deny("service_replaced")
        return conn
    except ControllerError: raise
    except Exception: _deny("connection_unavailable")
def _g037_tuple_value(row: Mapping[str, Any], description: Any) -> tuple[Any, ...]:
    try:
        return tuple(row[column.name] for column in description)
    except Exception:
        _deny("terminal_row_shape")
class _G037TupleFetchallCursor:
    """Keep canonical probes mapped while adapting the tuple-only G037 reader."""
    def __init__(self, cursor: Any):
        self._cursor = cursor
    def __getattr__(self, name: str) -> Any:
        return getattr(self._cursor, name)
    def fetchall(self) -> list[Any]:
        rows = self._cursor.fetchall()
        if type(rows) is not list or any(type(row) is not dict for row in rows):
            _deny("terminal_row_shape")
        return [_g037_tuple_value(row, self._cursor.description) for row in rows]
class _DeadlineBoundG037Cursor:
    """Apply the G040 monotonic budget to every readback cursor statement."""
    def __init__(self, cursor: Any, deadline_monotonic: float):
        self._cursor = cursor
        self._deadline_monotonic = deadline_monotonic
    def __getattr__(self, name: str) -> Any:
        return getattr(self._cursor, name)
    def execute(self, sql: str, params: Any = None) -> Any:
        remaining = self._deadline_monotonic - time.monotonic()
        if remaining <= 0:
            _deny("terminal_readback")
        remaining_ms = max(1, int(remaining * 1000))
        self._cursor.execute(f"SET LOCAL statement_timeout = '{remaining_ms}ms'")
        if time.monotonic() >= self._deadline_monotonic:
            _deny("terminal_readback")
        return self._cursor.execute(sql) if params is None else self._cursor.execute(sql, params)
def _readback_deadlines() -> tuple[float, float]:
    """Return paired absolute monotonic and UTC deadlines for G040 and G037."""
    monotonic_deadline = time.monotonic() + 30
    return monotonic_deadline, time.time() + (monotonic_deadline - time.monotonic())

def _signed_document(raw: bytes, kind: str) -> dict[str, Any]:
    try:
        value = json.loads(raw.decode("ascii"), object_pairs_hook=authority._pairs, parse_constant=authority._constant)
        if type(value) is not dict or set(value) != {"schema", "kind", "body", "signature_b64"} or value["schema"] != SCHEMA or value["kind"] != kind or type(value["body"]) is not dict or type(value["signature_b64"]) is not str:
            _deny("receipt_invalid")
        unsigned = authority.canonical_json_bytes({"schema": value["schema"], "kind": value["kind"], "body": value["body"]})
        if raw != authority.canonical_json_bytes(value) + b"\n":
            _deny("receipt_invalid")
        _verify_receipt(unsigned, base64.b64decode(value["signature_b64"], validate=True))
        return value["body"]
    except ControllerError: raise
    except Exception: _deny("receipt_invalid")

def _observation_receipt(args: Any, root: Path, observation: prefix.PrefixObservation, reference: VerifiedReference) -> str:
    issued_at = int(time.time())
    expires_at = min(issued_at + 900, reference.expires_at_unix)
    if expires_at <= issued_at:
        _deny("observation_expired")
    path = _outside(args.observation_receipt, root, fresh=True)
    body = {**asdict(observation), "issued_at": issued_at, "expires_at": expires_at}
    return _write_signed(path, {"schema": SCHEMA, "kind": "prefix-observation", "body": body}, repository_root=root)
def _temporary_identity(fd: int, path: Path) -> bool:
    try:
        opened, named = os.fstat(fd), path.lstat()
        return (stat.S_ISREG(opened.st_mode) and stat.S_ISREG(named.st_mode)
                and (opened.st_dev, opened.st_ino) == (named.st_dev, named.st_ino))
    except OSError:
        return False

def _publish_restrictive(path: Path, raw: bytes) -> None:
    fd: int | None = None
    temporary: Path | None = None
    try:
        fd, name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
        temporary = Path(name)
        if os.name == "nt":
            g035._windows_restrict_temporary_file(temporary)
        else:
            os.fchmod(fd, 0o600)
        if not _temporary_identity(fd, temporary):
            _deny("receipt_custody")
        authority._write_all(fd, raw)
        os.fsync(fd)
        if not _temporary_identity(fd, temporary):
            _deny("receipt_custody")
        os.close(fd)
        fd = None
        os.link(temporary, path)
        published = path.lstat()
        staged = temporary.lstat()
        if (not stat.S_ISREG(published.st_mode) or not stat.S_ISREG(staged.st_mode)
                or (published.st_dev, published.st_ino) != (staged.st_dev, staged.st_ino)):
            _deny("receipt_custody")
        authority._fsync_directory(path.parent)
        temporary.unlink()
        authority._fsync_directory(path.parent)
    except FileExistsError:
        _deny("receipt_exists")
    except ControllerError:
        raise
    except Exception:
        _deny("receipt_write")
    finally:
        if fd is not None:
            try:
                os.close(fd)
            except Exception:
                pass
        if temporary is not None:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass
            except Exception:
                pass

def _write_signed(path: Path, value: Mapping[str, Any], *, repository_root: Path) -> str:
    unsigned = authority.canonical_json_bytes(dict(value))
    signature = _sign_receipt(unsigned, repository_root)
    raw = authority.canonical_json_bytes({**dict(value), "signature_b64": base64.b64encode(signature).decode("ascii")}) + b"\n"
    _publish_restrictive(path, raw)
    return hashlib.sha256(raw).hexdigest()
def _verify_receipt(payload: bytes, signature: bytes) -> None:
    try:
        if hashlib.sha256(_RECEIPT_PUBLIC_KEY_PEM.encode("ascii")).hexdigest() != _RECEIPT_PUBLIC_KEY_SHA256:
            _deny("receipt_invalid")
        from cryptography.hazmat.primitives.serialization import load_pem_public_key
        load_pem_public_key(_RECEIPT_PUBLIC_KEY_PEM.encode("ascii")).verify(signature, payload)
    except ControllerError:
        raise
    except Exception:
        _deny("receipt_invalid")

def _sign_receipt(payload: bytes, repository_root: Path) -> bytes:
    # This online key signs receipts only; destructive authorization remains offline.
    fd: int | None = None
    try:
        key_path = authority.restrictive_regular_file(_RECEIPT_SIGNING_KEY, "recovery receipt signing key", repository_root)
        fd, raw = authority._open_custody(key_path, repository_root)
        from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat, load_pem_private_key
        private = load_pem_private_key(raw, password=None)
        public = private.public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo)
        if public != _RECEIPT_PUBLIC_KEY_PEM.encode("ascii") or hashlib.sha256(public).hexdigest() != _RECEIPT_PUBLIC_KEY_SHA256:
            _deny("receipt_signing")
        signature = private.sign(payload)
        if type(signature) is not bytes or len(signature) != 64:
            _deny("receipt_signing")
        return signature
    except ControllerError:
        raise
    except Exception:
        _deny("receipt_signing")
    finally:
        if fd is not None:
            try: os.close(fd)
            except Exception: pass

def _bindings(source: SourceBinding, reference: VerifiedReference, observation: prefix.PrefixObservation, custody: RecoveryCustody, manifest: Any, observation_receipt_sha256: str) -> dict[str, Any]:
    suffix = tuple((item.version, item.name, item.sha256) for item in manifest.migrations[17:])
    return {"final_recovery_commit": source.final_commit, "base_commit": reference.base_commit, "runtime_source_root": source.runtime_source_root, "manifest_root": reference.manifest_sha256, "source_root": reference.migration_source_sha256, "terminal_root": terminal_spec(manifest), "prefix_root": reference.ledger_prefix_sha256, "suffix_root": _hash(suffix), "projection_root": reference.full_catalog_sha256, "probe_root": reference.probe_text_sha256, "prefix_state_receipt_sha256": observation.classification_sha256, "observation_receipt_sha256": observation_receipt_sha256, "prefix_classification": observation.status, "target_fingerprint": reference.target_fingerprint, "selected_branch": {"UNAPPLIED": "execute-00400-then-suffix", "FULL_ESCAPED": "adopt-00400-vector-then-suffix"}.get(observation.status), "backup_receipt_sha256": custody.backup_receipt_sha256, "capture_receipt_sha256": custody.capture_receipt_sha256, "clone_rehearsal_receipt_sha256": custody.clone_rehearsal_receipt_sha256, "freeze_expires_at": custody.freeze_expires_at, "target_acl_root": custody.target_acl_root, "archive_sha256": custody.archive_sha256, "archive_bytes": custody.archive_bytes, "freeze_root": custody.freeze_root, "inventory_root": custody.inventory_root, "starting_ledger_root": observation.ledger_prefix_sha256, "target_ledger_root": custody.target_ledger_root, "starting_catalog_root": observation.catalog_sha256, "target_catalog_root": custody.target_catalog_root, "starting_data_root": observation.data_sha256 if observation.status == "FULL_ESCAPED" else _ABSENT_DATA_ROOT, "target_data_root": custody.target_data_root}
def _authorization(args: Any, bindings: dict[str, Any]) -> authority.VerifiedAuthorization:
    try:
        envelope = authority.authenticate_recovery_authorization(args.authorization, args.authorization_signature, expected_bindings=bindings, repository_root=_root(args))
        return authority.reverify_destructive_stage(envelope, expected_bindings=bindings)
    except Exception: _deny("authority_verification")
_ATTEMPT_MARKER_FIELDS = frozenset(("schema", "event", "authorization_id", "attempt_id", "at", "target_fingerprint", "runtime_source_root", "prefix_state_receipt_sha256", "observation_receipt_sha256", "prefix_classification", "selected_branch", "authorization_sha256", "signature_sha256", "bindings_sha256", "receipt_sha256"))

def _require_attempt_marker(marker: Any, authorization: authority.VerifiedAuthorization) -> dict[str, Any]:
    if type(marker) is not dict or set(marker) != _ATTEMPT_MARKER_FIELDS:
        _deny("outcome_anchor")
    expected = {
        "schema": authority.JOURNAL_SCHEMA,
        "event": "attempt-started",
        "authorization_id": authorization.authorization_id,
        "attempt_id": authorization.attempt_id,
        "target_fingerprint": authorization.target_fingerprint,
        "runtime_source_root": authorization.runtime_source_root,
        "prefix_state_receipt_sha256": authorization.prefix_state_receipt_sha256,
        "observation_receipt_sha256": authorization.observation_receipt_sha256,
        "prefix_classification": authorization.prefix_classification,
        "selected_branch": authorization.selected_branch,
        "authorization_sha256": authorization.authorization_sha256,
        "signature_sha256": authorization.signature_sha256,
        "bindings_sha256": authorization.bindings_sha256,
    }
    if (type(marker["at"]) is not int or not authorization.issued_at <= marker["at"] <= authorization.expires_at
            or any(marker[key] != value for key, value in expected.items())
            or marker["receipt_sha256"] != authority.canonical_sha256({key: value for key, value in marker.items() if key != "receipt_sha256"})):
        _deny("outcome_anchor")
    return marker

def _live_target(cursor: Any) -> str:
    try:
        cursor.execute("SELECT (pg_catalog.pg_control_system()).system_identifier::text AS system_identifier, (SELECT oid::text FROM pg_catalog.pg_database WHERE datname = current_database()) AS database_oid, current_setting('server_version_num') AS server_version_num")
        row = cursor.fetchone()
        if type(row) is not dict or set(row) != {"system_identifier", "database_oid", "server_version_num"}:
            _deny("live_target")
        value = tuple(row[key] for key in ("system_identifier", "database_oid", "server_version_num"))
        if any(type(item) is not str for item in value):
            _deny("live_target")
        return _hash(value)
    except ControllerError:
        raise
    except Exception:
        _deny("live_target")

def _require_live_target(cursor: Any, expected: str) -> None:
    if _live_target(cursor) != expected:
        _deny("live_target")
def _begin_controller_transaction(cursor: Any, *, readonly: bool) -> None:
    try:
        cursor.execute(f"BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ {'READ ONLY' if readonly else 'READ WRITE'}")
        cursor.execute("SELECT current_setting('transaction_read_only', true) AS transaction_read_only, current_setting('transaction_isolation', true) AS transaction_isolation")
        if cursor.fetchone() != {"transaction_read_only": "on" if readonly else "off", "transaction_isolation": "repeatable read"}:
            _deny("transaction_setup")
        if readonly:
            prefix.begin_read_only_snapshot(cursor)
        for statement in ("SET LOCAL lock_timeout = '5s'", "SET LOCAL statement_timeout = '30s'", "SET LOCAL idle_in_transaction_session_timeout = '35s'", "SET LOCAL search_path = pg_catalog, public"):
            cursor.execute(statement)
    except ControllerError:
        raise
    except Exception:
        _deny("transaction_setup")


def _diagnose(args: Any, source: SourceBinding, reference: VerifiedReference) -> tuple[prefix.PrefixObservation, str]:
    conn = _connect_service(args, readonly=True); cur = None
    try:
        cur = _G037TupleFetchallCursor(conn.cursor()); _begin_controller_transaction(cur, readonly=True); _require_live_target(cur, reference.target_fingerprint)
        observed = prefix.classify_locked_cursor(cur, reference, consume_nonce=_nonce_store(args, _root(args)))
        receipt = _observation_receipt(args, _root(args), observed, reference)
        return observed, receipt
    except ControllerError: raise
    except Exception: _deny("diagnose_failed")
    finally:
        if cur: cur.close()
        try: conn.rollback(); conn.close()
        except Exception: pass

def validate(args: Any) -> Mapping[str, Any]:
    source = _source(args); reference = _reference(args, source)
    return MappingProxyType({"schema": SCHEMA, "mode": "validate", "status": "valid", "source_commit": source.final_commit, "reference_receipt_sha256": reference.receipt_sha256})
def _source_validation_body(plan: Any) -> dict[str, Any]:
    if (type(plan) is not SourceValidationPlan or type(plan.migration_count) is not int
            or type(plan.terminal_rows) is not int or plan.migration_count != 28
            or plan.terminal_rows != 40):
        _deny("source_validation")
    suffix = tuple((item.version, item.name, item.sha256) for item in plan.manifest.migrations[17:])
    body = {"schema": "g040-source-validation-v1", "issued_at": int(time.time()),
            "final_recovery_commit": plan.source.final_commit,
            "base_commit": prefix.SOURCE_COMMIT,
            "runtime_source_root": plan.source.runtime_source_root,
            "manifest_root": prefix.MANIFEST_SHA256,
            "migration_source_root": prefix.MIGRATION_SOURCE_SHA256,
            "terminal_root": plan.terminal_spec_root,
            "catalog_probe_sha256": prefix.PROBE_TEXT_SHA256,
            "data_probe_sha256": prefix.DATA_PROBE_SHA256,
            "suffix_root": _hash(suffix), "migration_count": plan.migration_count,
            "terminal_rows": plan.terminal_rows}
    if (set(body) != {"schema", "issued_at", "final_recovery_commit", "base_commit",
                     "runtime_source_root", "manifest_root", "migration_source_root",
                     "terminal_root", "catalog_probe_sha256", "data_probe_sha256",
                     "suffix_root", "migration_count", "terminal_rows"}
            or type(body["issued_at"]) is not int or any(type(body[key]) is not str for key in body if key not in ("issued_at", "migration_count", "terminal_rows"))):
        _deny("source_validation")
    return {**body, "validation_sha256": _hash(body)}

def validate_source(args: Any) -> Mapping[str, Any]:
    source = _source(args)
    plan = build_source_validation_plan(_root(args), validate_sources(_root(args)), source=source)
    body = _source_validation_body(plan)
    receipt = _write_signed(_outside(args.source_receipt, _root(args), fresh=True),
                            {"schema": SCHEMA, "kind": "source-validation-v1", "body": body}, repository_root=_root(args))
    return MappingProxyType({"schema": SCHEMA, "mode": "validate-source", "status": "source-valid",
                             "source_commit": source.final_commit,
                             "runtime_source_root": source.runtime_source_root,
                             "source_validation_sha256": body["validation_sha256"],
                             "source_receipt_sha256": receipt})
def diagnose(args: Any) -> Mapping[str, Any]:
    source = _source(args); reference = _reference(args, source); observation, receipt = _diagnose(args, source, reference)
    return MappingProxyType({"schema": SCHEMA, "mode": "diagnose", "status": observation.status, "observation_receipt_sha256": receipt})
def prepare(args: Any) -> Mapping[str, Any]:
    source = _source(args); reference = _reference(args, source); observation, receipt = _load_observation(args, source, reference); custody = _custody(args, source, reference); manifest = validate_sources(_root(args)); bindings = _bindings(source, reference, observation, custody, manifest, receipt)
    path = _outside(args.authority_template, _root(args), fresh=True)
    _publish_restrictive(path, authority.canonical_json_bytes(bindings))
    return MappingProxyType({"schema": SCHEMA, "mode": "prepare", "status": "prepared", "bindings_sha256": _hash(bindings)})
def _load_observation(args: Any, source: SourceBinding, reference: VerifiedReference, *, require_fresh: bool = True) -> LoadedObservation:
    raw = _stable_bytes(_outside(args.observation, _root(args)), _root(args))
    receipt = hashlib.sha256(raw).hexdigest()
    fields = frozenset(prefix.PrefixObservation.__annotations__)
    try:
        data = _signed_document(raw, "prefix-observation")
        if (set(data) != fields | {"issued_at", "expires_at"}
                or type(data["issued_at"]) is not int
                or type(data["expires_at"]) is not int
                or (require_fresh and (data["issued_at"] > int(time.time()) + 30 or data["expires_at"] <= int(time.time())))
                or data["expires_at"] <= data["issued_at"]
                or data["expires_at"] - data["issued_at"] > 900
                or data["issued_at"] < reference.issued_at_unix
                or data["expires_at"] > reference.expires_at_unix):
            _deny("observation_invalid")
        observed = prefix.PrefixObservation(**{key: data[key] for key in fields})
        if observed.classification_sha256 != _hash({key: value for key, value in asdict(observed).items() if key != "classification_sha256"}):
            _deny("observation_invalid")
    except ControllerError:
        raise
    except Exception:
        _deny("observation_invalid")
    if observed.final_commit != source.final_commit or observed.runtime_source_root != source.runtime_source_root or observed.reference_receipt_sha256 != reference.receipt_sha256:
        _deny("observation_binding")
    return LoadedObservation(observed, receipt, data["issued_at"], data["expires_at"])
def _backup_freeze(args: Any, source: SourceBinding, manifest: Any) -> tuple[str, str, int, str]:
    try:
        raw = _stable_bytes(_outside(args.freeze_assertion, _root(args)), _root(args))
        value = json.loads(raw.decode("ascii"), object_pairs_hook=authority._pairs, parse_constant=authority._constant)
        channels = ("no_owner_write", "no_dashboard_write", "no_provider_write", "no_out_of_band_write", "producer_stop")
        if raw != authority.canonical_json_bytes(value) or value.get("freeze_id") == "40b54cf8-e59f-4eb3-a37c-88e3bf983442" or type(args.freeze_evidence) is not list or len(args.freeze_evidence) != 5:
            _deny("backup_freeze")
        validate_operator_assertion(value, freeze_id=value["freeze_id"], origin=value["origin"], relation_root=value["relation_root"], acl_root=value["acl_root"], commit=source.final_commit, source_root=source.runtime_source_root, terminal_spec=terminal_spec(manifest), now=int(time.time()))
        observed = {hashlib.sha256(_stable_bytes(_outside(path, _root(args)), _root(args))).hexdigest() for path in args.freeze_evidence}
        if len(observed) != 5 or observed != {value["attestations"][channel]["evidence_sha256"] for channel in channels}:
            _deny("backup_freeze")
        return hashlib.sha256(raw).hexdigest(), _hash({"g040-freeze-inventory-v1": {"relation_root": value["relation_root"], "acl_root": value["acl_root"]}}), value["expires_at"], value["acl_root"]
    except ControllerError:
        raise
    except Exception:
        _deny("backup_freeze")

def production_backup(args: Any) -> Mapping[str, Any]:
    """Capture a fresh G035 dump and immediately bind it to current G040 lineage."""
    source = _source(args); reference = _reference(args, source)
    observation, observation_sha256 = _load_observation(args, source, reference)
    manifest = validate_sources(_root(args))
    freeze_root, inventory_root, freeze_expires_at, target_acl_root = _backup_freeze(args, source, manifest)
    try:
        capture_args = argparse.Namespace(destination=args.destination, capture_receipt=args.capture_receipt, service_file=args.service_file, recipient=args.recipient, g034_artifact=args.g034_artifact, pg_dump=args.pg_dump, encrypt_command=args.encrypt_command)
        captured = g035.capture_to_custody(capture_args, manifest)
        capture_raw = _stable_bytes(_outside(args.capture_receipt, _root(args)), _root(args))
        archive_sha256, archive_bytes = _archive_digest(
            _outside(args.destination, _root(args)) / "g035-dump.enc",
            _root(args),
        )
        evidence = captured["evidence"]
        if (capture_raw != g035.canonical_bytes(captured) or captured["receipt_sha256"] != g035.digest({key: value for key, value in captured.items() if key != "receipt_sha256"})
                or evidence.get("target_fingerprint") != reference.target_fingerprint):
            _deny("backup_capture")
        if evidence.get("dump_sha256") != archive_sha256 or evidence.get("dump_bytes") != archive_bytes:
            _deny("backup_capture")
        issued = int(time.time())
        expires = min(issued + 900, freeze_expires_at)
        if expires <= issued:
            _deny("backup_freeze")
        body = {"issued_at": issued, "expires_at": expires, "freeze_expires_at": freeze_expires_at, "target_acl_root": target_acl_root, "final_recovery_commit": source.final_commit, "runtime_source_root": source.runtime_source_root, "reference_receipt_sha256": reference.receipt_sha256, "target_fingerprint": reference.target_fingerprint, "hosted_observation_receipt_sha256": observation_sha256, "hosted_observation_classification_sha256": observation.classification_sha256, "freeze_root": freeze_root, "inventory_root": inventory_root, "capture_receipt_sha256": hashlib.sha256(capture_raw).hexdigest(), "g035_receipt_sha256": captured["receipt_sha256"], "archive_sha256": archive_sha256, "archive_bytes": archive_bytes, "g035_manifest_sha256": captured["manifest_sha256"], "g035_source_sha256": evidence["source_sha256"]}
        receipt = _write_signed(_outside(args.output, _root(args), fresh=True), {"schema": SCHEMA, "kind": "g040-production-backup-v1", "body": body}, repository_root=_root(args))
        return MappingProxyType({"schema": SCHEMA, "mode": "production-backup", "status": "captured", "receipt_sha256": receipt})
    except ControllerError:
        raise
    except Exception:
        _deny("backup_capture")

def _terminal_readback(args: Any, source: SourceBinding, reference: VerifiedReference, manifest: Any, authorization: authority.VerifiedAuthorization) -> dict[str, Any]:
    deadline_monotonic, deadline_utc = _readback_deadlines(); conn = _connect_service(args, readonly=True); cur = None
    try:
        native = _G037TupleFetchallCursor(conn.cursor()); _begin_controller_transaction(native, readonly=True); cur = _DeadlineBoundG037Cursor(native, deadline_monotonic); _require_live_target(cur, authorization.target_fingerprint); terminal = terminal_readback_assert(cur, _root(args), manifest, deadline=deadline_utc)
        data_root = prefix.probe_full_data_root(cur, reference)
        if type(terminal) is not dict or set(terminal) != {"catalog_root", "acl_root", "ledger_root", "terminal_spec"} or terminal["catalog_root"] != authorization.target_catalog_root or terminal["acl_root"] != authorization.target_acl_root or terminal["ledger_root"] != authorization.target_ledger_root or terminal["terminal_spec"] != authorization.terminal_root or data_root != authorization.target_data_root: _deny("terminal_readback")
        value = {"target_fingerprint": authorization.target_fingerprint, "final_commit": source.final_commit, "runtime_source_root": source.runtime_source_root, "terminal_rows": 40, "catalog_root": terminal["catalog_root"], "acl_root": terminal["acl_root"], "ledger_root": terminal["ledger_root"], "data_root": data_root, "terminal_spec_root": terminal["terminal_spec"]}; return {**value, "readback_sha256": _hash(value)}
    except ControllerError: raise
    except Exception: _deny("terminal_readback")
    finally:
        if cur: cur.close()
        try: conn.rollback(); conn.close()
        except Exception: pass

def _write_proof(args: Any, source: SourceBinding, reference: VerifiedReference, manifest: Any, authorization: authority.VerifiedAuthorization, readback: Mapping[str, Any]) -> str:
    migrations = {(item.version, item.name): item for item in manifest.migrations}
    try: deletion, separation, adapters = (migrations[("20260713002300", "g014_account_deletion_state_machine")], migrations[("20260712000400", "g010_retention_separation")], migrations[("20260713002400", "g014_retention_adapters_receipts")])
    except Exception: _deny("proof_binding")
    body = {"schema": "account-deletion-privacy-retention-proof-v1", "issued_at": int(time.time()), "target_fingerprint": authorization.target_fingerprint, "final_recovery_commit": source.final_commit, "runtime_source_root": source.runtime_source_root, "reference_receipt_sha256": reference.receipt_sha256, "authorization_sha256": authorization.authorization_sha256, "terminal_readback_sha256": readback["readback_sha256"], "terminal_rows": readback["terminal_rows"], "terminal_catalog_root": readback["catalog_root"], "terminal_acl_root": readback["acl_root"], "terminal_ledger_root": readback["ledger_root"], "terminal_data_root": readback["data_root"], "terminal_spec_root": readback["terminal_spec_root"], "privacy_retention": {"coverage": "fixed-terminal-data-and-source-pinned-terminal-closure-v1", "separation_migration": {"version": separation.version, "name": separation.name, "source_sha256": separation.sha256}, "adapters_migration": {"version": adapters.version, "name": adapters.name, "source_sha256": adapters.sha256}, "data_probe_sha256": prefix.DATA_PROBE_SHA256, "seed_projection_sha256": prefix.SEED_PROJECTION_SHA256, "data_root": readback["data_root"]}, "account_deletion": {"coverage": "disabled-audit-seed-and-source-pinned-terminal-closure-v1", "migration": {"version": deletion.version, "name": deletion.name, "source_sha256": deletion.sha256}, "audit_seed_code": "privacy_account_deletion_audit", "data_probe_sha256": prefix.DATA_PROBE_SHA256, "data_root": readback["data_root"]}}
    body["proof_sha256"] = _hash(body)
    return _write_signed(_outside(args.proof_receipt, _root(args), fresh=True), {"schema": SCHEMA, "kind": "account-deletion-privacy-retention-proof-v1", "body": body}, repository_root=_root(args))
def _revalidate_production_custody(args: Any, source: SourceBinding, manifest: Any, custody: RecoveryCustody, verified: authority.VerifiedAuthorization) -> int:
    now = int(time.time())
    if min(custody.freeze_expires_at, verified.freeze_expires_at, verified.expires_at) <= now:
        _deny("backup_freeze")
    freeze_root, inventory_root, freeze_expires_at, target_acl_root = _backup_freeze(args, source, manifest)
    if (freeze_root != custody.freeze_root or inventory_root != custody.inventory_root or freeze_expires_at != custody.freeze_expires_at or target_acl_root != custody.target_acl_root):
        _deny("backup_freeze")
    backup_raw = _stable_bytes(_outside(args.backup_receipt, _root(args)), _root(args))
    if hashlib.sha256(backup_raw).hexdigest() != custody.backup_receipt_sha256:
        _deny("backup_capture")
    backup = _signed_document(backup_raw, "g040-production-backup-v1")
    required = {"issued_at", "expires_at", "freeze_expires_at", "target_acl_root", "final_recovery_commit", "runtime_source_root", "reference_receipt_sha256", "target_fingerprint", "hosted_observation_receipt_sha256", "hosted_observation_classification_sha256", "freeze_root", "inventory_root", "capture_receipt_sha256", "g035_receipt_sha256", "archive_sha256", "archive_bytes", "g035_manifest_sha256", "g035_source_sha256"}
    if (set(backup) != required or backup["expires_at"] <= now or any(backup[key] != getattr(custody, key) for key in ("freeze_expires_at", "target_acl_root", "freeze_root", "inventory_root", "capture_receipt_sha256", "archive_sha256", "archive_bytes")) or backup["final_recovery_commit"] != source.final_commit or backup["target_fingerprint"] != verified.target_fingerprint):
        _deny("backup_capture")
    capture_raw = _stable_bytes(_outside(args.capture_receipt, _root(args)), _root(args))
    if hashlib.sha256(capture_raw).hexdigest() != custody.capture_receipt_sha256:
        _deny("backup_capture")
    capture = g035.read_json_receipt(_outside(args.capture_receipt, _root(args)))
    archive_sha256, archive_bytes = _archive_digest(_outside(args.archive, _root(args)), _root(args))
    if (capture.get("mode") != "capture" or capture.get("status") != "captured" or capture.get("receipt_sha256") != backup["g035_receipt_sha256"] or capture.get("evidence", {}).get("target_fingerprint") != verified.target_fingerprint or archive_sha256 != custody.archive_sha256 or archive_bytes != custody.archive_bytes or capture.get("evidence", {}).get("dump_sha256") != archive_sha256 or capture.get("evidence", {}).get("dump_bytes") != archive_bytes):
        _deny("backup_capture")
    return backup["expires_at"]

def _execution_deadline(reference: VerifiedReference, custody: RecoveryCustody, verified: authority.VerifiedAuthorization) -> float:
    expiries = (reference.expires_at_unix, custody.expires_at, custody.freeze_expires_at,
                verified.expires_at, verified.freeze_expires_at)
    now_wall, now_monotonic = time.time(), time.monotonic()
    if any(type(expiry) is not int for expiry in expiries) or min(expiries) <= now_wall:
        _deny("authority_expired")
    return now_monotonic + (min(expiries) - now_wall)

def execute(args: Any) -> Mapping[str, Any]:
    source = _source(args); reference = _reference(args, source); observation, receipt = _load_observation(args, source, reference); custody = _custody(args, source, reference); manifest = validate_sources(_root(args)); bindings = _bindings(source, reference, observation, custody, manifest, receipt); verified = _authorization(args, bindings); plan = build_execution_plan(_root(args), manifest, source=source, reference=reference, observation=observation, authorization=verified)
    prepared_path = _outside(args.prepared_receipt, _root(args), fresh=True); final_path = _outside(args.final_receipt, _root(args), fresh=True); deadline = _execution_deadline(reference, custody, verified); conn = _connect_service(args, readonly=False); cur = None; committed = False; commit_attempted = False
    try:
        cur = _G037TupleFetchallCursor(conn.cursor()); backup_expires_at = _revalidate_production_custody(args, source, manifest, custody, verified); deadline = min(deadline, time.monotonic() + (backup_expires_at - time.time())); _begin_controller_transaction(cur, readonly=False); _require_live_target(cur, verified.target_fingerprint)
        prepared_hash = _write_signed(prepared_path, {"schema": SCHEMA, "kind": "prepared-intent", "body": {"source_commit": source.final_commit, "target_fingerprint": verified.target_fingerprint, "reference_receipt_sha256": reference.receipt_sha256, "classification_sha256": observation.classification_sha256, "observation_receipt_sha256": receipt, "authorization_sha256": verified.authorization_sha256, "expected_roots": {"ledger": verified.target_ledger_root, "catalog": verified.target_catalog_root, "acl": verified.target_acl_root, "data": verified.target_data_root, "terminal": verified.terminal_root}, "plan_sha256": _hash({"branch": plan.branch, "terminal_spec_root": plan.terminal_spec_root, "reference_receipt_sha256": plan.reference.receipt_sha256, "authorization_sha256": plan.authorization.authorization_sha256})}}, repository_root=_root(args))
        if time.monotonic() >= deadline or min(verified.expires_at, verified.freeze_expires_at, custody.expires_at, custody.freeze_expires_at, reference.expires_at_unix, backup_expires_at) <= time.time():
            _deny("authority_expired")
        attempt, evidence = authority.consume_one_shot_attempt(repository_root=_root(args), authorization=verified, callback=lambda attempt: apply_locked_cursor(cur, plan=plan, attempt=attempt, deadline_monotonic=deadline))
        if time.monotonic() >= deadline or min(verified.expires_at, verified.freeze_expires_at, custody.expires_at, custody.freeze_expires_at, reference.expires_at_unix, backup_expires_at) <= time.time():
            _deny("authority_expired")
        commit_attempted = True; conn.commit(); committed = True
    except ControllerError:
        if not committed:
            try: conn.rollback()
            except Exception: pass
        raise
    except Exception:
        if committed or commit_attempted: _deny("commit_ambiguous_readback_only")
        try: conn.rollback()
        except Exception: pass
        _deny("execute_failed")
    finally:
        if cur: cur.close()
        try: conn.close()
        except Exception: pass
    try:
        readback = _terminal_readback(args, source, reference, manifest, verified)
        proof_hash = _write_proof(args, source, reference, manifest, verified, readback)
        final_hash = _write_signed(final_path, {"schema": SCHEMA, "kind": "final", "body": {"source_commit": source.final_commit, "target_fingerprint": reference.target_fingerprint, "reference_receipt_sha256": reference.receipt_sha256, "classification_sha256": observation.classification_sha256, "observation_receipt_sha256": receipt, "authorization_sha256": verified.authorization_sha256, "attempt_receipt_sha256": attempt.receipt_sha256, "executor_evidence_sha256": evidence.evidence_sha256, "prepared_receipt_sha256": prepared_hash, "proof_receipt_sha256": proof_hash, **readback}}, repository_root=_root(args))
    except Exception:
        _deny("commit_ambiguous_readback_only")
    return MappingProxyType({"schema": SCHEMA, "mode": "execute", "status": "committed", "prepared_receipt_sha256": prepared_hash, "proof_receipt_sha256": proof_hash, "final_receipt_sha256": final_hash})
def readback(args: Any) -> Mapping[str, Any]:
    source = _source(args)
    try:
        envelope = authority.authenticate_outcome_authorization(args.authorization, args.authorization_signature, repository_root=_root(args))
        verified = authority.verify_outcome_authorization(envelope)
        reference = _reference(args, source, historical=True); observation, receipt = _load_observation(args, source, reference, require_fresh=False)
        custody = _custody(args, source, reference, require_fresh=False); manifest = validate_sources(_root(args)); bindings = _bindings(source, reference, observation, custody, manifest, receipt)
        if any(getattr(verified, key) != value for key, value in bindings.items()):
            _deny("outcome_anchor")
        plan = build_execution_plan(_root(args), manifest, source=source, reference=reference, observation=observation, authorization=verified)
        prepared_raw = _stable_bytes(_outside(args.prepared_receipt, _root(args)), _root(args))
        prepared = _signed_document(prepared_raw, "prepared-intent")
        parent = authority.canonical_journal_parent(_root(args))
        marker_data = _require_attempt_marker(authority._decode(_stable_bytes(parent / f"{verified.authorization_id}-{verified.attempt_id}.json", _root(args))), verified)
        roots = {"ledger": verified.target_ledger_root, "catalog": verified.target_catalog_root, "acl": verified.target_acl_root, "data": verified.target_data_root, "terminal": verified.terminal_root}
        required = {"source_commit", "target_fingerprint", "reference_receipt_sha256", "classification_sha256", "observation_receipt_sha256", "authorization_sha256", "expected_roots", "plan_sha256"}
        if (set(prepared) != required or prepared["source_commit"] != source.final_commit
                or prepared["target_fingerprint"] != verified.target_fingerprint
                or prepared["reference_receipt_sha256"] != reference.receipt_sha256
                or prepared["authorization_sha256"] != verified.authorization_sha256
                or prepared["classification_sha256"] != verified.prefix_state_receipt_sha256
                or prepared["observation_receipt_sha256"] != verified.observation_receipt_sha256
                or prepared["expected_roots"] != roots
                or prepared["plan_sha256"] != _hash({"branch": plan.branch, "terminal_spec_root": plan.terminal_spec_root, "reference_receipt_sha256": plan.reference.receipt_sha256, "authorization_sha256": plan.authorization.authorization_sha256})):
            _deny("outcome_anchor")
    except ControllerError:
        raise
    except Exception:
        _deny("outcome_anchor")
    value = _terminal_readback(args, source, reference, manifest, verified)
    proof_hash = _write_proof(args, source, reference, manifest, verified, value)
    final_path = _outside(args.final_receipt, _root(args), fresh=True)
    final_hash = _write_signed(final_path, {"schema": SCHEMA, "kind": "outcome", "body": {"source_commit": source.final_commit, "target_fingerprint": verified.target_fingerprint, "authorization_sha256": verified.authorization_sha256, "prepared_receipt_sha256": hashlib.sha256(prepared_raw).hexdigest(), "attempt_receipt_sha256": marker_data["receipt_sha256"], "proof_receipt_sha256": proof_hash, **value}}, repository_root=_root(args))
    return MappingProxyType({"schema": SCHEMA, "mode": "readback", "status": "terminal", "final_readback_sha256": value["readback_sha256"], "proof_receipt_sha256": proof_hash, "final_receipt_sha256": final_hash})

_HANDLERS = MappingProxyType({"validate-source": validate_source, "validate": validate, "diagnose": diagnose, "prepare": prepare, "execute": execute, "readback": readback, "production-backup": production_backup})
_MODE_OPTIONS = MappingProxyType({
    "validate-source": ("repository-root", "source-commit", "source-receipt"),
    "validate": ("repository-root", "source-commit", "target-fingerprint", "reference"),
    "diagnose": ("repository-root", "source-commit", "target-fingerprint", "reference", "service-file", "service-name", "nonce-dir", "observation-receipt"),
    "prepare": ("repository-root", "source-commit", "target-fingerprint", "reference", "observation", "custody", "authority-template"),
    "execute": ("repository-root", "source-commit", "target-fingerprint", "reference", "service-file", "service-name", "observation", "custody", "authorization", "authorization-signature", "prepared-receipt", "final-receipt", "proof-receipt", "backup-receipt", "capture-receipt", "archive", "freeze-assertion", "freeze-evidence"),
    "readback": ("repository-root", "source-commit", "target-fingerprint", "reference", "service-file", "service-name", "observation", "custody", "authorization", "authorization-signature", "prepared-receipt", "final-receipt", "proof-receipt"),
    "production-backup": ("repository-root", "source-commit", "target-fingerprint", "reference", "observation", "destination", "capture-receipt", "service-file", "recipient", "g034-artifact", "encrypt-command", "freeze-assertion", "freeze-evidence", "output"),
})
def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if not argv or argv[0] not in MODES:
        argparse.ArgumentParser(prog="g040-production-controller").error("invalid_arguments")
    mode = argv[0]; parser = argparse.ArgumentParser(prog="g040-production-controller", add_help=False)
    parser.add_argument("mode", choices=(mode,))
    for option in _MODE_OPTIONS[mode]:
        parser.add_argument(f"--{option}", required=option != "freeze-evidence", action="append" if option == "freeze-evidence" else None)
    args, unknown = parser.parse_known_args(argv)
    if mode == "production-backup":
        args.pg_dump = "pg_dump"
    if any(sum(token == f"--{option}" or token.startswith(f"--{option}=") for token in argv[1:]) != 1
           for option in _MODE_OPTIONS[mode] if option != "freeze-evidence"):
        parser.error("invalid_arguments")
    if unknown or (hasattr(args, "freeze_evidence") and (type(args.freeze_evidence) is not list or len(args.freeze_evidence) != 5)):
        parser.error("invalid_arguments")
    try: print(json.dumps(dict(_HANDLERS[args.mode](args)), sort_keys=True)); return 0
    except ControllerError as exc: print(json.dumps({"schema": SCHEMA, "status": str(exc)})); return 2
if __name__ == "__main__": raise SystemExit(main())
