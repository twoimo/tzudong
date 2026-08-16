#!/usr/bin/env python3
"""Local-only G038 controller for the exact 40-to-42 successor.

The controller owns the sole production transaction.  The executor receives
only its cursor and cannot begin, commit, roll back, reconnect, or retry.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, Mapping

import g035_hosted_recovery as g035
import g038_clone_rehearsal as clone_rehearsal
import g038_successor_authorization as authority
from g037_hosted_closure_contract import validate_sources as validate_g040_sources
from g038_successor_contract import (
    EXCLUDED_ROOT, MANIFEST_RELATIVE_PATH, PREDECESSOR_COMMIT, PREDECESSOR_LEDGER_ROOT,
    PREDECESSOR_REPORT_SHA256, PREDECESSOR_ROWS, RUNTIME_INVENTORY_ROOT,
    SELECTED_VERSIONS, STATEMENT_VECTOR_ROOT, TARGET_FINGERPRINT,
    TERMINAL_SPEC_ROOT, canonical_json_bytes, canonical_sha256, validate_sources,
)
from g038_successor_executor import (
    EXACT_40, EXACT_42, PARTIAL_OR_AMBIGUOUS, LiveState, SuccessorError,
    _deadline, _execute, _query, _transaction_attempt_binding, apply_cursor,
    assert_terminal_readback, compile_plan, observe_live_state,
)
from g038_successor_source import SourceBinding, SuccessorSourceError, verify_successor_source
from g038_write_freeze import (
    FreezeError, VerifiedFreeze, load_checkpoint, preflight_checkpoint_path,
    request_checkpoint, verify_freeze_assertion,
)

SCHEMA = "g038-production-controller-v1"
MODES = frozenset(("validate-source", "observe", "production-backup", "prepare", "execute", "readback"))
_RECEIPT_SIGNING_KEY = Path.home() / ".g038-successor" / "g038-receipt-signing-key.pem"
_RECEIPT_PUBLIC_KEY_PEM = """-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAtPb9mJNAIIDxnA8HcWVBgdhoP5sPNstBM9H99Wmx37s=
-----END PUBLIC KEY-----
"""
_RECEIPT_PUBLIC_KEY_SHA256 = "30a92ba630d53655e7489351d20c9b049033a56fed07d5bd2e340f7d5aa4c56b"
_G040_RECEIPT_SCHEMA = "g040-production-controller-v2"
_G040_PUBLIC_KEY_PEM = """-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA/zrWSA2h9sKfuVsBWJllBsxjX9hjo6Jk+WWqHr84f2k=
-----END PUBLIC KEY-----
"""
_G040_PUBLIC_KEY_SHA256 = "cd576d9c8558c067e987193394627abbbfc37e75df8183039a13efaea3f8c498"
_PREDECESSOR_SCHEMA = "g047-hosted-recovery-completion-v1"
_OBSERVATION_SCHEMA = "g038-hosted-observation-v1"
_BACKUP_SCHEMA = "g038-production-backup-v1"
_PREPARED_SCHEMA = "g038-prepared-intent-v1"
_TERMINAL_SCHEMA = "g038-terminal-readback-v1"
_SOURCE_RECEIPT_SCHEMA = "g038-source-validation-receipt-v2"
_SOURCE_REPOSITORY = "twoimo/tzudong"
_SOURCE_REF = "refs/heads/main"
_SOURCE_WORKFLOW = "Successor"
_SOURCE_ARTIFACT = "g038-account-deletion-successor-source-receipt"
_SOURCE_SIGNER_WORKFLOW = "github.com/twoimo/tzudong/.github/workflows/g038-account-deletion-successor.yml"
_GH_SHA256 = "02d2d4a85241c6a8c0b77ebb1ec76fc723caf7fb128e00915b306b968847cba1"
_GH_VERSION_OUTPUT = "gh version 2.96.0 (2026-07-02)\nhttps://github.com/cli/cli/releases/tag/v2.96.0\n"
_PG_DUMP_SHA256 = "aa71717b27a8eddaab4efee4bca9b529c68b051947421ae71caa592757f5b22d"
_PG_DUMP_VERSION_OUTPUT = "pg_dump (PostgreSQL) 17.10 (Homebrew)\n"
_AGE_SHA256 = "f52e5ee772e1c0e3c6be5bf837b469a40346df3515db9a1b41230376fdff6a76"
_AGE_VERSION_OUTPUT = "v1.3.1\n"
_TOOL_MAX_OUTPUT = 4096
_ATTESTATION_MAX_OUTPUT = 1024 * 1024
_SOURCE_RECEIPT_MAX_AGE = 24 * 60 * 60
_HEX = frozenset("0123456789abcdef")
_ROOT_KEYS = frozenset(("ledger", "catalog", "acl", "data", "spec"))


class ControllerError(RuntimeError):
    """Sanitized controller failure."""


def _deny(code: str) -> None:
    raise ControllerError(code) from None


def _hex(value: Any) -> str:
    if type(value) is not str or len(value) != 64 or any(char not in _HEX for char in value):
        _deny("artifact_shape")
    return value


def _root(args: Any) -> Path:
    value = getattr(args, "repository_root", None)
    if not isinstance(value, (str, Path)):
        _deny("repository_root_required")
    try:
        return Path(value).resolve(strict=True)
    except Exception:
        _deny("repository_root_required")


def _outside(path: Any, root: Path, *, fresh: bool = False, directory: bool = False) -> Path:
    if not isinstance(path, (str, Path)):
        _deny("artifact_path")
    try:
        value = Path(path)
        resolved = value.resolve(strict=not fresh)
        parent = (resolved if directory else resolved.parent).resolve(strict=True)
        if resolved == root or root in resolved.parents or parent == root or root in parent.parents:
            _deny("artifact_custody")
        if fresh and (value.exists() or value.is_symlink()):
            _deny("receipt_exists")
        if not directory:
            authority._parent_restrictive(value)
        return value
    except ControllerError:
        raise
    except Exception:
        _deny("artifact_custody")


def _stable_bytes(path: Path, repository_root: Path) -> bytes:
    fd: int | None = None
    try:
        fd, raw = authority._open_custody(path, repository_root)
        before = os.fstat(fd)
        after = path.stat(follow_symlinks=False)
        if (before.st_dev, before.st_ino, before.st_size) != (after.st_dev, after.st_ino, after.st_size):
            _deny("artifact_custody")
        return raw
    except ControllerError:
        raise
    except Exception:
        _deny("artifact_custody")
    finally:
        if fd is not None:
            try: os.close(fd)
            except Exception: pass


def _decode(raw: bytes, *, newline: bool = False) -> dict[str, Any]:
    try:
        value = json.loads(raw.decode("ascii"), object_pairs_hook=authority._pairs, parse_constant=authority._constant)
        expected = canonical_json_bytes(value) + (b"\n" if newline else b"")
        if type(value) is not dict or raw != expected:
            _deny("artifact_invalid")
        return value
    except ControllerError:
        raise
    except Exception:
        _deny("artifact_invalid")


def _source(args: Any) -> SourceBinding:
    try:
        return verify_successor_source(_root(args), args.source_commit, production=True)
    except (SuccessorSourceError, OSError, ValueError):
        _deny("source_verification")


def _manifest_roots(root: Path, manifest: Any) -> tuple[str, str]:
    manifest_root = hashlib.sha256((root / MANIFEST_RELATIVE_PATH).read_bytes()).hexdigest()
    source_root = canonical_sha256([[item.path, item.sha256] for item in manifest.migrations])
    return manifest_root, source_root


def _verify_signature(payload: bytes, signature: bytes, *, pem: str, digest: str, code: str) -> None:
    try:
        if hashlib.sha256(pem.encode("ascii")).hexdigest() != digest:
            _deny(code)
        from cryptography.hazmat.primitives.serialization import load_pem_public_key
        load_pem_public_key(pem.encode("ascii")).verify(signature, payload)
    except ControllerError:
        raise
    except Exception:
        _deny(code)


def _signed_document(raw: bytes, *, schema: str, kind: str, pem: str, key_sha256: str) -> dict[str, Any]:
    try:
        value = _decode(raw, newline=True)
        if set(value) != {"schema", "kind", "body", "signature_b64"} or value["schema"] != schema or value["kind"] != kind or type(value["body"]) is not dict or type(value["signature_b64"]) is not str:
            _deny("receipt_invalid")
        unsigned = canonical_json_bytes({"schema": schema, "kind": kind, "body": value["body"]})
        _verify_signature(unsigned, base64.b64decode(value["signature_b64"], validate=True), pem=pem, digest=key_sha256, code="receipt_invalid")
        return value["body"]
    except ControllerError:
        raise
    except Exception:
        _deny("receipt_invalid")


def _sign_receipt(payload: bytes, repository_root: Path) -> bytes:
    fd: int | None = None
    try:
        path = authority.restrictive_regular_file(_RECEIPT_SIGNING_KEY, "G038 receipt signing key", repository_root)
        fd, raw = authority._open_custody(path, repository_root)
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


def _temporary_identity(fd: int, path: Path) -> bool:
    try:
        opened, named = os.fstat(fd), path.lstat()
        return stat.S_ISREG(opened.st_mode) and stat.S_ISREG(named.st_mode) and (opened.st_dev, opened.st_ino) == (named.st_dev, named.st_ino)
    except OSError:
        return False


def _publish_restrictive(path: Path, raw: bytes) -> None:
    fd: int | None = None
    temporary: Path | None = None
    try:
        fd, name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
        temporary = Path(name)
        if os.name == "nt": g035._windows_restrict_temporary_file(temporary)
        else: os.fchmod(fd, 0o600)
        if not _temporary_identity(fd, temporary): _deny("receipt_custody")
        authority._write_all(fd, raw); os.fsync(fd)
        if not _temporary_identity(fd, temporary): _deny("receipt_custody")
        os.close(fd); fd = None
        os.link(temporary, path)
        if path.lstat().st_ino != temporary.lstat().st_ino: _deny("receipt_custody")
        authority._fsync_directory(path.parent)
        temporary.unlink(); authority._fsync_directory(path.parent)
    except FileExistsError:
        _deny("receipt_exists")
    except ControllerError:
        raise
    except Exception:
        _deny("receipt_write")
    finally:
        if fd is not None:
            try: os.close(fd)
            except Exception: pass
        if temporary is not None:
            try: temporary.unlink()
            except Exception: pass


def _write_signed(path: Path, kind: str, body: Mapping[str, Any], *, repository_root: Path) -> str:
    unsigned = canonical_json_bytes({"schema": SCHEMA, "kind": kind, "body": dict(body)})
    signature = _sign_receipt(unsigned, repository_root)
    raw = canonical_json_bytes({"schema": SCHEMA, "kind": kind, "body": dict(body), "signature_b64": base64.b64encode(signature).decode("ascii")}) + b"\n"
    _publish_restrictive(path, raw)
    return hashlib.sha256(raw).hexdigest()


def _github_source_provenance(repository_root: Path, source_commit: str) -> dict[str, Any]:
    expected = {
        "GITHUB_REPOSITORY": _SOURCE_REPOSITORY,
        "GITHUB_REF": _SOURCE_REF,
        "GITHUB_WORKFLOW": _SOURCE_WORKFLOW,
        "GITHUB_SHA": source_commit,
    }
    if any(os.environ.get(name) != value for name, value in expected.items()):
        _deny("source_provenance")
    try:
        workspace = Path(os.environ["GITHUB_WORKSPACE"]).resolve(strict=True)
    except (KeyError, OSError, RuntimeError, ValueError):
        _deny("source_provenance")
    if workspace != repository_root:
        _deny("source_provenance")
    identifiers: dict[str, int] = {}
    for field, name in (("run_id", "GITHUB_RUN_ID"), ("run_attempt", "GITHUB_RUN_ATTEMPT")):
        raw = os.environ.get(name)
        if type(raw) is not str or re.fullmatch(r"[1-9][0-9]*", raw) is None:
            _deny("source_provenance")
        identifiers[field] = int(raw)
    return {
        "repository": _SOURCE_REPOSITORY,
        "ref": _SOURCE_REF,
        "workflow": _SOURCE_WORKFLOW,
        **identifiers,
        "artifact_name": _SOURCE_ARTIFACT,
    }


_SOURCE_RECEIPT_FIELDS = frozenset((
    "schema", "status", "source_commit", "runtime_source_root", "manifest_root",
    "source_root", "vector_root", "terminal_spec_root", "selected_versions",
    "repository", "ref", "workflow", "run_id", "run_attempt", "artifact_name",
    "issued_at", "receipt_sha256",
))

@dataclass(frozen=True)
class SourceEvidence:
    receipt_sha256: str
    bundle_sha256: str
    provenance_sha256: str
    binding_sha256: str


def _run_gh(command: list[str]) -> bytes:
    try:
        with tempfile.TemporaryDirectory(prefix="g038-gh-") as raw:
            home = Path(raw)
            os.chmod(home, 0o700)
            completed = subprocess.run(
                command,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env={
                    "GH_CONFIG_DIR": os.fspath(home),
                    "GH_NO_UPDATE_NOTIFIER": "1",
                    "HOME": os.fspath(home),
                    "NO_COLOR": "1",
                    "XDG_CONFIG_HOME": os.fspath(home),
                    "XDG_DATA_HOME": os.fspath(home),
                    "XDG_STATE_HOME": os.fspath(home),
                },
                shell=False,
                timeout=30,
                check=False,
            )
    except (OSError, subprocess.SubprocessError):
        _deny("source_attestation")
    if (completed.returncode != 0 or len(completed.stdout) > _ATTESTATION_MAX_OUTPUT
            or len(completed.stderr) > _ATTESTATION_MAX_OUTPUT):
        _deny("source_attestation")
    return completed.stdout


def _pinned_gh(args: Any, root: Path) -> Path:
    path = _outside(args.gh_path, root)
    try:
        named = path.lstat()
        if (not stat.S_ISREG(named.st_mode) or named.st_uid != os.getuid()
                or stat.S_IMODE(named.st_mode) != 0o700
                or not os.access(path, os.X_OK)
                or hashlib.sha256(_stable_bytes(path, root)).hexdigest() != _GH_SHA256):
            _deny("source_attestation")
    except ControllerError:
        raise
    except Exception:
        _deny("source_attestation")
    version = _run_gh([os.fspath(path), "version"])
    if version != _GH_VERSION_OUTPUT.encode("ascii"):
        _deny("source_attestation")
    return path


def _run_pg_dump_version(path: Path) -> bytes:
    try:
        completed = subprocess.run(
            [os.fspath(path), "--version"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env={"LANG": "C", "LC_ALL": "C", "NO_COLOR": "1"},
            shell=False,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        _deny("backup_tool")
    if (completed.returncode != 0 or len(completed.stdout) > _TOOL_MAX_OUTPUT
            or len(completed.stderr) > _TOOL_MAX_OUTPUT or completed.stderr):
        _deny("backup_tool")
    return completed.stdout


def _pinned_pg_dump(args: Any, root: Path) -> Path:
    try:
        requested = Path(args.pg_dump)
        if not requested.is_absolute():
            _deny("backup_tool")
        path = _outside(requested, root)
        named = path.lstat()
        if (not stat.S_ISREG(named.st_mode) or stat.S_ISLNK(named.st_mode)
                or named.st_uid != os.getuid() or stat.S_IMODE(named.st_mode) != 0o700
                or not os.access(path, os.X_OK)
                or hashlib.sha256(_stable_bytes(path, root)).hexdigest() != _PG_DUMP_SHA256
                or _run_pg_dump_version(path) != _PG_DUMP_VERSION_OUTPUT.encode("ascii")):
            _deny("backup_tool")
        return path
    except ControllerError:
        _deny("backup_tool")
    except Exception:
        _deny("backup_tool")


def _run_age_version(path: Path) -> bytes:
    try:
        completed = subprocess.run(
            [os.fspath(path), "--version"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env={"LANG": "C", "LC_ALL": "C", "NO_COLOR": "1"},
            shell=False,
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        _deny("backup_encryptor")
    if (completed.returncode != 0 or len(completed.stdout) > _TOOL_MAX_OUTPUT
            or len(completed.stderr) > _TOOL_MAX_OUTPUT or completed.stderr):
        _deny("backup_encryptor")
    return completed.stdout


def _pinned_encryptor(args: Any, root: Path) -> Path:
    try:
        requested = Path(args.encrypt_executable)
        if not requested.is_absolute():
            _deny("backup_encryptor")
        path = _outside(requested, root)
        named = path.lstat()
        if (not stat.S_ISREG(named.st_mode) or stat.S_ISLNK(named.st_mode)
                or named.st_uid != os.getuid() or stat.S_IMODE(named.st_mode) != 0o700
                or not os.access(path, os.X_OK)
                or hashlib.sha256(_stable_bytes(path, root)).hexdigest() != _AGE_SHA256
                or _run_age_version(path) != _AGE_VERSION_OUTPUT.encode("ascii")):
            _deny("backup_encryptor")
        return path
    except ControllerError:
        _deny("backup_encryptor")
    except Exception:
        _deny("backup_encryptor")


def _certificate_value(certificate: Mapping[str, Any], *names: str) -> Any:
    wanted = {name.casefold() for name in names}
    pending: list[Any] = [certificate]
    while pending:
        current = pending.pop()
        if type(current) is dict:
            for key, value in current.items():
                if type(key) is str and key.casefold() in wanted:
                    return value
                pending.append(value)
        elif type(current) is list:
            pending.extend(current)
    return None


def _verify_source_attestation(args: Any, root: Path, receipt: Path, receipt_sha256: str,
                               source_commit: str) -> SourceEvidence:
    bundle = _outside(args.source_attestation_bundle, root)
    bundle_raw = _stable_bytes(bundle, root)
    gh = _pinned_gh(args, root)
    command = [
        os.fspath(gh), "attestation", "verify", os.fspath(receipt),
        "--bundle", os.fspath(bundle),
        "--repo", _SOURCE_REPOSITORY,
        "--signer-workflow", _SOURCE_SIGNER_WORKFLOW,
        "--source-ref", _SOURCE_REF,
        "--source-digest", source_commit,
        "--deny-self-hosted-runners",
        "--format", "json",
    ]
    raw = _run_gh(command)
    try:
        results = json.loads(raw.decode("utf-8"), object_pairs_hook=authority._pairs,
                             parse_constant=authority._constant)
        if type(results) is not list or len(results) != 1 or type(results[0]) is not dict:
            _deny("source_attestation")
        result = results[0]
        if set(result) != {"attestation", "verificationResult"} or type(result["attestation"]) is not dict:
            _deny("source_attestation")
        verification = result["verificationResult"]
        signature = verification["signature"]
        certificate = signature["certificate"]
        timestamps = verification["verifiedTimestamps"]
        statement = verification["statement"]
        if (type(verification) is not dict or type(signature) is not dict
                or type(certificate) is not dict or type(timestamps) is not list
                or not timestamps or any(type(item) is not dict for item in timestamps)
                or type(statement) is not dict):
            _deny("source_attestation")
        expected_identity = f"https://github.com/{_SOURCE_REPOSITORY}/.github/workflows/g038-account-deletion-successor.yml@{_SOURCE_REF}"
        if (_certificate_value(certificate, "issuer") != "https://token.actions.githubusercontent.com"
                or _certificate_value(certificate, "subjectAlternativeName", "subject_alternative_name") != expected_identity
                or _certificate_value(certificate, "sourceRepositoryURI", "source_repository_uri") != f"https://github.com/{_SOURCE_REPOSITORY}"
                or _certificate_value(certificate, "sourceRepositoryDigest", "source_repository_digest") != source_commit
                or _certificate_value(certificate, "sourceRepositoryRef", "source_repository_ref") != _SOURCE_REF
                or _certificate_value(certificate, "runnerEnvironment", "runner_environment") != "github-hosted"):
            _deny("source_attestation")
        subjects = statement.get("subject")
        if (statement.get("_type") != "https://in-toto.io/Statement/v1"
                or statement.get("predicateType") != "https://slsa.dev/provenance/v1"
                or type(subjects) is not list or len(subjects) != 1
                or type(subjects[0]) is not dict or set(subjects[0]) != {"name", "digest"}
                or subjects[0]["name"] != receipt.name
                or subjects[0]["digest"] != {"sha256": receipt_sha256}):
            _deny("source_attestation")
    except ControllerError:
        raise
    except Exception:
        _deny("source_attestation")
    bundle_sha = hashlib.sha256(bundle_raw).hexdigest()
    provenance_sha = canonical_sha256({"certificate": certificate, "statement": statement})
    binding_sha = canonical_sha256({
        "source_validation_receipt_sha256": receipt_sha256,
        "source_attestation_bundle_sha256": bundle_sha,
        "verified_source_provenance_sha256": provenance_sha,
    })
    return SourceEvidence(receipt_sha256, bundle_sha, provenance_sha, binding_sha)


def _load_source_receipt(args: Any, source: SourceBinding, manifest: Any, *,
                         require_fresh: bool = True) -> SourceEvidence:
    root = _root(args)
    receipt_path = _outside(args.source_receipt, root)
    raw = _stable_bytes(receipt_path, root)
    body = _decode(raw, newline=True)
    manifest_root, source_root = _manifest_roots(root, manifest)
    unsigned = {key: value for key, value in body.items() if key != "receipt_sha256"}
    expected = {
        "schema": _SOURCE_RECEIPT_SCHEMA,
        "status": "source-valid",
        "source_commit": source.final_commit,
        "runtime_source_root": source.runtime_source_root,
        "manifest_root": manifest_root,
        "source_root": source_root,
        "vector_root": manifest.statement_vector_root,
        "terminal_spec_root": manifest.terminal_spec_root,
        "selected_versions": list(SELECTED_VERSIONS),
        "repository": _SOURCE_REPOSITORY,
        "ref": _SOURCE_REF,
        "workflow": _SOURCE_WORKFLOW,
        "artifact_name": _SOURCE_ARTIFACT,
    }
    now = int(time.time())
    if (set(body) != _SOURCE_RECEIPT_FIELDS
            or any(body.get(key) != value or type(body.get(key)) is not type(value)
                   for key, value in expected.items())
            or type(body.get("run_id")) is not int or body["run_id"] <= 0
            or type(body.get("run_attempt")) is not int or body["run_attempt"] <= 0
            or type(body.get("issued_at")) is not int or body["issued_at"] <= 0
            or body["issued_at"] > now + 30
            or (require_fresh and now - body["issued_at"] > _SOURCE_RECEIPT_MAX_AGE)
            or body.get("receipt_sha256") != canonical_sha256(unsigned)):
        _deny("source_receipt_invalid")
    receipt_sha = hashlib.sha256(raw).hexdigest()
    return _verify_source_attestation(args, root, receipt_path, receipt_sha, source.final_commit)


def _write_source_receipt(path: Path, body: Mapping[str, Any]) -> str:
    unsigned = dict(body)
    unsigned["receipt_sha256"] = canonical_sha256(unsigned)
    raw = canonical_json_bytes(unsigned) + b"\n"
    _publish_restrictive(path, raw)
    return hashlib.sha256(raw).hexdigest()


@dataclass(frozen=True)
class PredecessorEvidence:
    report_sha256: str
    final_receipt_sha256: str
    readback_receipt_sha256: str
    readback_sha256: str
    roots: Mapping[str, str]


def _g040_envelope(raw: bytes, kind: str) -> dict[str, Any]:
    return _signed_document(raw, schema=_G040_RECEIPT_SCHEMA, kind=kind, pem=_G040_PUBLIC_KEY_PEM, key_sha256=_G040_PUBLIC_KEY_SHA256)


def _predecessor(args: Any) -> PredecessorEvidence:
    root = _root(args)
    report_raw = _stable_bytes(_outside(args.predecessor_report, root), root)
    if hashlib.sha256(report_raw).hexdigest() != PREDECESSOR_REPORT_SHA256:
        _deny("predecessor_report")
    report = _decode(report_raw)
    required = {
        "schema", "exact_main_commit", "target_fingerprint", "execute",
        "postcommit_readback", "dual_clone", "precommit_gates",
        "producer_stop_retained", "source_receipt_sha256",
        "evidence_index_sha256", "github", "clone_cleanup", "tests",
    }
    execute = report.get("execute")
    postcommit = report.get("postcommit_readback")
    dual_clone = report.get("dual_clone")
    gates = report.get("precommit_gates")
    if (set(report) != required or report["schema"] != _PREDECESSOR_SCHEMA
            or report["exact_main_commit"] != PREDECESSOR_COMMIT
            or report["target_fingerprint"] != TARGET_FINGERPRINT
            or type(execute) is not dict or execute.get("status") != "committed"
            or type(postcommit) is not dict or postcommit.get("status") != "terminal"
            or type(dual_clone) is not dict or dual_clone.get("terminal_rows") != PREDECESSOR_ROWS
            or type(gates) is not dict or gates.get("freeze_active") is not True
            or gates.get("active_writer_runs") != 0
            or report["producer_stop_retained"] is not True):
        _deny("predecessor_report")
    final_raw = _stable_bytes(_outside(args.predecessor_final_receipt, root), root)
    readback_raw = _stable_bytes(_outside(args.predecessor_readback_receipt, root), root)
    final_sha, readback_sha = hashlib.sha256(final_raw).hexdigest(), hashlib.sha256(readback_raw).hexdigest()
    if final_sha != execute.get("final_receipt_sha256") or readback_sha != postcommit.get("final_receipt_sha256"):
        _deny("predecessor_receipts")
    final = _g040_envelope(final_raw, "final")
    outcome = _g040_envelope(readback_raw, "outcome")
    keys = ("ledger_root", "catalog_root", "acl_root", "data_root", "terminal_spec_root")
    if (any(final.get(key) != outcome.get(key) or not isinstance(final.get(key), str) for key in keys)
            or final.get("terminal_rows") != PREDECESSOR_ROWS or outcome.get("terminal_rows") != PREDECESSOR_ROWS
            or final.get("target_fingerprint") != TARGET_FINGERPRINT or outcome.get("target_fingerprint") != TARGET_FINGERPRINT
            or final.get("source_commit") != PREDECESSOR_COMMIT or outcome.get("source_commit") != PREDECESSOR_COMMIT
            or final.get("readback_sha256") != outcome.get("readback_sha256")):
        _deny("predecessor_receipts")
    roots = {"ledger": final["ledger_root"], "catalog": final["catalog_root"], "acl": final["acl_root"], "data": final["data_root"], "spec": final["terminal_spec_root"]}
    if any(not _hex(value) for value in roots.values()):
        _deny("predecessor_receipts")
    # G040's signed final receipt used its historical ledger-root projection.
    # G038 classifies the same fixed 40-row ledger by its canonical
    # (version, name) pair vector, whose root is source-pinned separately.
    roots["ledger"] = PREDECESSOR_LEDGER_ROOT
    return PredecessorEvidence(PREDECESSOR_REPORT_SHA256, final_sha, readback_sha, _hex(final["readback_sha256"]), MappingProxyType(roots))


def _connect_service(args: Any, *, readonly: bool, deadline_monotonic: float) -> Any:
    root = _root(args); connection = None
    try:
        remaining_ms = _deadline(deadline_monotonic)
        service = authority.restrictive_regular_file(args.service_file, "postgres service file", root)
        before = _stable_bytes(service, root)
        import psycopg
        remaining_ms = _deadline(deadline_monotonic)
        prior = os.environ.get("PGSERVICEFILE")
        os.environ["PGSERVICEFILE"] = os.fspath(service.resolve())
        try:
            connection = psycopg.connect(
                service=args.service_name, autocommit=True,
                connect_timeout=max(1, min(20, (remaining_ms + 999) // 1000)),
                options=(
                    f"-c default_transaction_read_only={'on' if readonly else 'off'} "
                    f"-c statement_timeout={remaining_ms}"
                ),
                row_factory=psycopg.rows.dict_row,
            )
        finally:
            if prior is None: os.environ.pop("PGSERVICEFILE", None)
            else: os.environ["PGSERVICEFILE"] = prior
        _deadline(deadline_monotonic)
        if _stable_bytes(service, root) != before:
            try: connection.close()
            except Exception: pass
            _deny("service_replaced")
        return connection
    except ControllerError:
        raise
    except SuccessorError:
        _deny("authority_expired")
    except Exception:
        if connection is not None:
            try: connection.close()
            except Exception: pass
        _deny("connection_unavailable")


def _begin_controller_transaction(cursor: Any, *, readonly: bool, deadline_monotonic: float) -> None:
    try:
        _execute(
            cursor,
            f"BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ {'READ ONLY' if readonly else 'READ WRITE'}",
            deadline_monotonic=deadline_monotonic,
        )
        rows = _query(
            cursor,
            "SELECT current_setting('transaction_read_only', true) AS transaction_read_only, current_setting('transaction_isolation', true) AS transaction_isolation",
            deadline_monotonic=deadline_monotonic,
        )
        if rows != [{"transaction_read_only": "on" if readonly else "off", "transaction_isolation": "repeatable read"}]:
            _deny("transaction_setup")
        remaining = str(_deadline(deadline_monotonic))
        _execute(cursor, "SELECT pg_catalog.set_config('lock_timeout', %s, true)", (remaining,),
                 deadline_monotonic=deadline_monotonic)
        _execute(cursor, "SELECT pg_catalog.set_config('idle_in_transaction_session_timeout', %s, true)",
                 (remaining,), deadline_monotonic=deadline_monotonic)
        _execute(cursor, "SET LOCAL search_path = pg_catalog, public",
                 deadline_monotonic=deadline_monotonic)
    except (ControllerError, SuccessorError):
        raise
    except Exception:
        _deny("transaction_setup")


def _bind_controller_transaction(cursor: Any, verified: authority.VerifiedAuthorization,
                                 attempt: authority.AttemptStarted, *, deadline_monotonic: float) -> None:
    binding = _transaction_attempt_binding(verified, attempt)
    try:
        rows = _query(
            cursor,
            "SELECT pg_catalog.set_config('g038.attempt_binding', %s, true) AS attempt_binding, "
            "pg_catalog.pg_current_xact_id()::text AS transaction_id",
            (binding,),
            deadline_monotonic=deadline_monotonic,
        )
        if (len(rows) != 1 or type(rows[0]) is not dict
                or set(rows[0]) != {"attempt_binding", "transaction_id"}
                or rows[0]["attempt_binding"] != binding
                or type(rows[0]["transaction_id"]) is not str
                or not rows[0]["transaction_id"].isdigit()):
            _deny("transaction_setup")
    except (ControllerError, SuccessorError):
        raise
    except Exception:
        _deny("transaction_setup")


def _live_target(cursor: Any, *, deadline_monotonic: float) -> str:
    try:
        rows = _query(
            cursor,
            "SELECT (pg_catalog.pg_control_system()).system_identifier::text AS system_identifier, (SELECT oid::text FROM pg_catalog.pg_database WHERE datname = current_database()) AS database_oid, current_setting('server_version_num') AS server_version_num",
            deadline_monotonic=deadline_monotonic,
        )
        if len(rows) != 1 or type(rows[0]) is not dict:
            _deny("live_target")
        row = rows[0]
        if set(row) != {"system_identifier", "database_oid", "server_version_num"} or any(type(value) is not str for value in row.values()):
            _deny("live_target")
        return canonical_sha256(tuple(row[key] for key in ("system_identifier", "database_oid", "server_version_num")))
    except (ControllerError, SuccessorError):
        raise
    except Exception:
        _deny("live_target")


def _require_live_target(cursor: Any, *, deadline_monotonic: float) -> None:
    if _live_target(cursor, deadline_monotonic=deadline_monotonic) != TARGET_FINGERPRINT:
        _deny("live_target")


@dataclass(frozen=True)
class HostedObservation:
    schema: str; status: str; target_fingerprint: str; source_commit: str; runtime_source_root: str
    source_validation_receipt_sha256: str; source_attestation_bundle_sha256: str
    verified_source_provenance_sha256: str
    ledger_rows: int; ledger_root: str; catalog_root: str; acl_root: str; data_root: str
    terminal_spec_root: str; predecessor_report_sha256: str
    issued_at: int; expires_at: int; receipt_sha256: str


def _observation_body(state: LiveState, source: SourceBinding,
                      predecessor: PredecessorEvidence, evidence: SourceEvidence,
                      *, issued_at: int) -> dict[str, Any]:
    if type(state) is not LiveState:
        _deny("observation_failed")
    body = {"schema": _OBSERVATION_SCHEMA, "status": state.classification,
        "target_fingerprint": TARGET_FINGERPRINT, "source_commit": source.final_commit,
        "runtime_source_root": source.runtime_source_root,
        "source_validation_receipt_sha256": evidence.binding_sha256,
        "source_attestation_bundle_sha256": evidence.bundle_sha256,
        "verified_source_provenance_sha256": evidence.provenance_sha256,
        "ledger_rows": state.rows,
        "ledger_root": state.ledger_root, "catalog_root": state.catalog_root,
        "acl_root": state.acl_root, "data_root": state.data_root,
        "terminal_spec_root": TERMINAL_SPEC_ROOT,
        "predecessor_report_sha256": predecessor.report_sha256,
        "issued_at": issued_at, "expires_at": issued_at + 900}
    body["receipt_sha256"] = canonical_sha256(body)
    return body


def _load_observation(args: Any, source: SourceBinding, evidence: SourceEvidence, *, require_fresh: bool = True) -> tuple[HostedObservation, str]:
    root = _root(args); raw = _stable_bytes(_outside(args.observation, root), root)
    body = _signed_document(raw, schema=SCHEMA, kind="hosted-observation", pem=_RECEIPT_PUBLIC_KEY_PEM, key_sha256=_RECEIPT_PUBLIC_KEY_SHA256)
    try:
        value = HostedObservation(**body)
    except Exception:
        _deny("observation_invalid")
    unsigned = {key: item for key, item in body.items() if key != "receipt_sha256"}
    now = int(time.time())
    expected_rows = {EXACT_40: 40, EXACT_42: 42, PARTIAL_OR_AMBIGUOUS: value.ledger_rows}
    if (set(body) != set(HostedObservation.__annotations__) or value.receipt_sha256 != canonical_sha256(unsigned)
            or value.schema != _OBSERVATION_SCHEMA or value.status not in expected_rows
            or value.ledger_rows != expected_rows[value.status]
            or value.target_fingerprint != TARGET_FINGERPRINT or value.source_commit != source.final_commit
            or value.runtime_source_root != source.runtime_source_root or value.predecessor_report_sha256 != PREDECESSOR_REPORT_SHA256
            or value.source_validation_receipt_sha256 != evidence.binding_sha256
            or value.source_attestation_bundle_sha256 != evidence.bundle_sha256
            or value.verified_source_provenance_sha256 != evidence.provenance_sha256
            or any(not _hex(getattr(value, field)) for field in (
                "ledger_root", "catalog_root", "acl_root", "data_root", "terminal_spec_root",
            ))
            or value.terminal_spec_root != TERMINAL_SPEC_ROOT
            or value.expires_at <= value.issued_at or value.expires_at - value.issued_at > 900
            or (require_fresh and (value.issued_at > now + 30 or value.expires_at <= now))):
        _deny("observation_invalid")
    return value, hashlib.sha256(raw).hexdigest()


def _freeze(args: Any, source: SourceBinding, manifest: Any, predecessor: PredecessorEvidence) -> VerifiedFreeze:
    root = _root(args); raw = _stable_bytes(_outside(args.freeze_assertion, root), root)
    value = _decode(raw)
    manifest_root, _ = _manifest_roots(root, manifest)
    try:
        return verify_freeze_assertion(value, source_commit=source.final_commit, runtime_source_root=source.runtime_source_root,
            manifest_root=manifest_root, starting_roots=dict(predecessor.roots), now=int(time.time()))
    except FreezeError:
        _deny("freeze_invalid")


def _require_freeze_continuity(captured: VerifiedFreeze, current: VerifiedFreeze) -> None:
    if type(captured) is not VerifiedFreeze or type(current) is not VerifiedFreeze:
        _deny("freeze_continuity")
    text_fields = (
        "source_commit", "runtime_source_root", "target_fingerprint",
        "inventory_root", "root",
    )
    integer_fields = ("issued_at", "expires_at")
    if (any(type(getattr(value, field)) is not str for value in (captured, current) for field in text_fields)
            or any(type(getattr(value, field)) is not int for value in (captured, current) for field in integer_fields)
            or any(getattr(captured, field) != getattr(current, field) for field in (*text_fields, *integer_fields))):
        _deny("freeze_continuity")


def validate_source(args: Any) -> Mapping[str, Any]:
    root = _root(args)
    source = _source(args)
    manifest = validate_sources(root)
    manifest_root, source_root = _manifest_roots(root, manifest)
    body = {
        "schema": _SOURCE_RECEIPT_SCHEMA,
        "status": "source-valid",
        "source_commit": source.final_commit,
        "runtime_source_root": source.runtime_source_root,
        "manifest_root": manifest_root,
        "source_root": source_root,
        "vector_root": manifest.statement_vector_root,
        "terminal_spec_root": manifest.terminal_spec_root,
        "selected_versions": list(SELECTED_VERSIONS),
        **_github_source_provenance(root, source.final_commit),
        "issued_at": int(time.time()),
    }
    digest = _write_source_receipt(
        _outside(args.source_receipt, root, fresh=True),
        body,
    )
    return MappingProxyType({
        "schema": SCHEMA,
        "mode": "validate-source",
        "status": "source-valid",
        "source_commit": source.final_commit,
        "receipt_sha256": digest,
    })


def observe(args: Any) -> Mapping[str, Any]:
    source = _source(args); predecessor = _predecessor(args); manifest = validate_sources(_root(args)); source_evidence = _load_source_receipt(args, source, manifest); plan = compile_plan(_root(args), manifest)
    deadline = time.monotonic() + 30
    conn = _connect_service(args, readonly=True, deadline_monotonic=deadline); cursor = None
    target_ledger = canonical_sha256(tuple((version, name) for version, name in __import__("g038_successor_contract").PREDECESSOR_PAIRS) + tuple((item.migration.version, item.migration.name) for item in plan.compiled))
    try:
        cursor = conn.cursor()
        _begin_controller_transaction(cursor, readonly=True, deadline_monotonic=deadline)
        _require_live_target(cursor, deadline_monotonic=deadline)
        state = observe_live_state(
            cursor, plan=plan, predecessor_ledger_root=PREDECESSOR_LEDGER_ROOT,
            target_ledger_root=target_ledger, deadline_monotonic=deadline,
        )
    except (ControllerError, SuccessorError):
        raise
    except Exception:
        _deny("observation_failed")
    finally:
        if cursor is not None:
            try: cursor.close()
            except Exception: pass
        try: conn.rollback(); conn.close()
        except Exception: pass
    body = _observation_body(state, source, predecessor, source_evidence, issued_at=int(time.time()))
    receipt = _write_signed(_outside(args.observation_receipt, _root(args), fresh=True), "hosted-observation", body, repository_root=_root(args))
    return MappingProxyType({"schema": SCHEMA, "mode": "observe", "status": state.classification, "observation_receipt_sha256": receipt})


def _archive_digest(path: Path, root: Path) -> tuple[str, int]:
    fd: int | None = None
    try:
        path = authority.restrictive_regular_file(path, "encrypted G035 archive", root)
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0))
        opened = os.fstat(fd); digest = hashlib.sha256(); count = 0
        while True:
            chunk = os.read(fd, 64 * 1024)
            if not chunk: break
            digest.update(chunk); count += len(chunk)
        named = path.stat(follow_symlinks=False)
        if not stat.S_ISREG(opened.st_mode) or (opened.st_dev, opened.st_ino, opened.st_size) != (named.st_dev, named.st_ino, named.st_size) or count != opened.st_size:
            _deny("backup_capture")
        return digest.hexdigest(), count
    except ControllerError:
        raise
    except Exception:
        _deny("backup_capture")
    finally:
        if fd is not None:
            try: os.close(fd)
            except Exception: pass


def production_backup(args: Any) -> Mapping[str, Any]:
    root = _root(args)
    output_path = _outside(args.output, root, fresh=True)
    destination = _outside(args.destination, root, directory=True).resolve(strict=True)
    archive_path = _outside(args.archive, root, fresh=True)
    if archive_path.resolve(strict=False) != destination / "g035-dump.enc":
        _deny("backup_archive")
    capture_receipt_path = _outside(args.capture_receipt, root, fresh=True)
    pg_dump = _pinned_pg_dump(args, root)
    encryptor = _pinned_encryptor(args, root)
    source = _source(args); predecessor = _predecessor(args); successor_manifest = validate_sources(root)
    source_evidence = _load_source_receipt(args, source, successor_manifest)
    observation, observation_sha = _load_observation(args, source, source_evidence)
    if observation.status != EXACT_40 or observation.ledger_root != predecessor.roots["ledger"]: _deny("observation_invalid")
    freeze = _freeze(args, source, successor_manifest, predecessor)
    try:
        g040_manifest = validate_g040_sources(_root(args))
        capture_args = argparse.Namespace(destination=destination, capture_receipt=capture_receipt_path, service_file=args.service_file,
            recipient=args.recipient, g034_artifact=args.g034_artifact, pg_dump=os.fspath(pg_dump),
            encrypt_command=os.fspath(encryptor))
        captured = g035.capture_to_custody(capture_args, g040_manifest)
        capture_raw = _stable_bytes(capture_receipt_path, root)
        archive_sha, archive_bytes = _archive_digest(archive_path, root)
        evidence = captured["evidence"]
        if (capture_raw != g035.canonical_bytes(captured) or captured["receipt_sha256"] != g035.digest({key: item for key, item in captured.items() if key != "receipt_sha256"})
                or evidence.get("target_fingerprint") != TARGET_FINGERPRINT or evidence.get("dump_sha256") != archive_sha or evidence.get("dump_bytes") != archive_bytes):
            _deny("backup_capture")
        current_freeze = _freeze(args, source, successor_manifest, predecessor)
        _require_freeze_continuity(freeze, current_freeze)
        issued = int(time.time()); expires = min(issued + 900, freeze.expires_at, observation.expires_at)
        if expires <= issued: _deny("backup_stale")
        body = {"schema": _BACKUP_SCHEMA, "source_commit": source.final_commit, "runtime_source_root": source.runtime_source_root,
            "source_validation_receipt_sha256": source_evidence.binding_sha256,
            "source_attestation_bundle_sha256": source_evidence.bundle_sha256,
            "verified_source_provenance_sha256": source_evidence.provenance_sha256,
            "target_fingerprint": TARGET_FINGERPRINT, "observation_receipt_sha256": observation_sha,
            "freeze_root": freeze.root, "inventory_root": freeze.inventory_root, "freeze_expires_at": freeze.expires_at,
            "capture_receipt_sha256": hashlib.sha256(capture_raw).hexdigest(), "g035_receipt_sha256": captured["receipt_sha256"],
            "archive_sha256": archive_sha, "archive_bytes": archive_bytes, "issued_at": issued, "expires_at": expires}
        body["receipt_sha256"] = canonical_sha256(body)
        receipt = _write_signed(output_path, "production-backup", body, repository_root=root)
        return MappingProxyType({"schema": SCHEMA, "mode": "production-backup", "status": "captured", "receipt_sha256": receipt})
    except ControllerError:
        raise
    except Exception:
        _deny("backup_capture")


def _load_backup(args: Any, source: SourceBinding, evidence: SourceEvidence, observation_sha: str, freeze: VerifiedFreeze, *, require_fresh: bool = True) -> tuple[dict[str, Any], str]:
    root = _root(args); raw = _stable_bytes(_outside(args.backup_receipt, root), root)
    body = _signed_document(raw, schema=SCHEMA, kind="production-backup", pem=_RECEIPT_PUBLIC_KEY_PEM, key_sha256=_RECEIPT_PUBLIC_KEY_SHA256)
    required = {"schema", "source_commit", "runtime_source_root", "source_validation_receipt_sha256", "source_attestation_bundle_sha256", "verified_source_provenance_sha256", "target_fingerprint", "observation_receipt_sha256", "freeze_root", "inventory_root", "freeze_expires_at", "capture_receipt_sha256", "g035_receipt_sha256", "archive_sha256", "archive_bytes", "issued_at", "expires_at", "receipt_sha256"}
    unsigned = {key: item for key, item in body.items() if key != "receipt_sha256"}
    now = int(time.time())
    if (set(body) != required or body.get("schema") != _BACKUP_SCHEMA or body.get("receipt_sha256") != canonical_sha256(unsigned)
            or body.get("source_commit") != source.final_commit or body.get("runtime_source_root") != source.runtime_source_root
            or body.get("source_validation_receipt_sha256") != evidence.binding_sha256
            or body.get("source_attestation_bundle_sha256") != evidence.bundle_sha256
            or body.get("verified_source_provenance_sha256") != evidence.provenance_sha256
            or body.get("target_fingerprint") != TARGET_FINGERPRINT or body.get("observation_receipt_sha256") != observation_sha
            or body.get("freeze_root") != freeze.root or body.get("inventory_root") != freeze.inventory_root
            or body.get("freeze_expires_at") != freeze.expires_at or type(body.get("archive_bytes")) is not int
            or (require_fresh and (body.get("expires_at", 0) <= now or body.get("freeze_expires_at", 0) <= now))):
        _deny("backup_invalid")
    return body, hashlib.sha256(raw).hexdigest()


def _revalidate_backup_artifacts(args: Any, backup: Mapping[str, Any]) -> None:
    root = _root(args)
    capture_raw = _stable_bytes(_outside(args.capture_receipt, root), root)
    archive_sha, archive_bytes = _archive_digest(_outside(args.archive, root), root)
    try:
        capture = g035.read_json_receipt(_outside(args.capture_receipt, root))
        evidence = capture["evidence"]
        if (hashlib.sha256(capture_raw).hexdigest() != backup["capture_receipt_sha256"]
                or capture_raw != g035.canonical_bytes(capture)
                or capture.get("receipt_sha256") != backup["g035_receipt_sha256"]
                or capture.get("receipt_sha256") != g035.digest({key: item for key, item in capture.items() if key != "receipt_sha256"})
                or evidence.get("target_fingerprint") != TARGET_FINGERPRINT
                or evidence.get("dump_sha256") != archive_sha or evidence.get("dump_bytes") != archive_bytes
                or archive_sha != backup["archive_sha256"] or archive_bytes != backup["archive_bytes"]):
            _deny("backup_invalid")
    except ControllerError:
        raise
    except Exception:
        _deny("backup_invalid")


def _load_clone(args: Any, source: SourceBinding, manifest: Any, predecessor: PredecessorEvidence,
                freeze: VerifiedFreeze, backup_sha: str, backup: Mapping[str, Any]) -> tuple[dict[str, Any], str]:
    root = _root(args)
    path = _outside(args.dual_clone_receipt, root)
    raw = _stable_bytes(path, root)
    body = _signed_document(raw, schema=clone_rehearsal.SCHEMA, kind=clone_rehearsal.KIND,
        pem=clone_rehearsal.PUBLIC_KEY_PEM, key_sha256=clone_rehearsal.PUBLIC_KEY_SHA256)
    manifest_root, source_root = _manifest_roots(root, manifest)
    trusted = {
        "source_commit": source.final_commit, "runtime_source_root": source.runtime_source_root,
        "source_root": source_root, "manifest_root": manifest_root, "vector_root": STATEMENT_VECTOR_ROOT,
        "terminal_spec_root": TERMINAL_SPEC_ROOT, "exclusions_root": EXCLUDED_ROOT,
        "inventory_root": RUNTIME_INVENTORY_ROOT, "target_fingerprint": TARGET_FINGERPRINT,
        "predecessor_report_sha256": predecessor.report_sha256,
        "predecessor_outcome_sha256": predecessor.final_receipt_sha256,
        "predecessor_readback_sha256": predecessor.readback_receipt_sha256,
        "backup_receipt_sha256": backup_sha, "capture_receipt_sha256": backup["capture_receipt_sha256"],
        "archive_sha256": backup["archive_sha256"], "archive_bytes": backup["archive_bytes"],
        "freeze_root": freeze.root, "freeze_expires_at": freeze.expires_at,
        "starting_ledger_root": predecessor.roots["ledger"], "starting_catalog_root": predecessor.roots["catalog"],
        "starting_acl_root": predecessor.roots["acl"], "starting_data_root": predecessor.roots["data"],
        "selected_versions": list(SELECTED_VERSIONS),
    }
    binding_root_fields = ("tool_identity_root", "docker_daemon_root")
    target_fields = ("target_ledger_root", "target_catalog_root", "target_acl_root", "target_data_root")
    try:
        receipt_roots = {key: _hex(body.get(key)) for key in (*binding_root_fields, *target_fields)}
    except ControllerError:
        _deny("clone_invalid")
    expected = {**trusted, **{key: receipt_roots[key] for key in binding_root_fields}}
    if any(body.get(key) != item for key, item in trusted.items()):
        _deny("clone_invalid")
    try:
        verified = clone_rehearsal.verify_dual_clone_receipt(path, expected=expected)
    except clone_rehearsal.CloneRehearsalError:
        _deny("clone_invalid")
    receipt_sha = hashlib.sha256(raw).hexdigest()
    if verified["receipt_sha256"] != receipt_sha:
        _deny("clone_invalid")
    before = dict(predecessor.roots)
    after = {"ledger": body["target_ledger_root"], "catalog": body["target_catalog_root"],
        "acl": body["target_acl_root"], "data": body["target_data_root"], "spec": TERMINAL_SPEC_ROOT}
    return {"status": "rehearsed", "before_roots": before, "after_roots": after,
            "rollback_roots": before, "receipt_body": body}, receipt_sha




def _exact_bindings(root: Path, source: SourceBinding, evidence: SourceEvidence, manifest: Any, predecessor: PredecessorEvidence,
                    observation_sha: str, freeze: VerifiedFreeze, backup: Mapping[str, Any], backup_sha: str,
                    clone: Mapping[str, Any], clone_sha: str, disposable_subject_sha: str, runtime_contract_sha: str) -> dict[str, Any]:
    manifest_root, source_root = _manifest_roots(root, manifest)
    before, after = clone["before_roots"], clone["after_roots"]
    if before != dict(predecessor.roots): _deny("clone_invalid")
    return {
        "target_fingerprint": TARGET_FINGERPRINT, "target_acl_root": after["acl"],
        "g038_source_commit": source.final_commit, "runtime_source_root": source.runtime_source_root,
        "source_validation_receipt_sha256": evidence.binding_sha256,
        "source_root": source_root, "manifest_root": manifest_root, "vector_root": STATEMENT_VECTOR_ROOT,
        "predecessor_commit": PREDECESSOR_COMMIT, "predecessor_report_sha256": predecessor.report_sha256,
        "predecessor_outcome_sha256": predecessor.final_receipt_sha256, "predecessor_readback_sha256": predecessor.readback_receipt_sha256,
        "predecessor_rows": 40, "target_rows": 42,
        "starting_ledger_root": before["ledger"], "starting_catalog_root": before["catalog"], "starting_acl_root": before["acl"], "starting_data_root": before["data"],
        "target_ledger_root": after["ledger"], "target_catalog_root": after["catalog"], "target_data_root": after["data"], "target_spec_sha256": after["spec"],
        "observation_receipt_sha256": observation_sha, "backup_receipt_sha256": backup_sha,
        "capture_receipt_sha256": backup["capture_receipt_sha256"], "dual_clone_receipt_sha256": clone_sha,
        "archive_sha256": backup["archive_sha256"], "archive_bytes": backup["archive_bytes"],
        "freeze_expires_at": freeze.expires_at, "freeze_root": freeze.root, "inventory_root": freeze.inventory_root,
        "selected_versions": list(SELECTED_VERSIONS), "exclusions_root": EXCLUDED_ROOT,
        "disposable_runtime_subject_sha256": _hex(disposable_subject_sha),
        "disposable_runtime_proof_contract_sha256": _hex(runtime_contract_sha),
    }


def _prepare_material(args: Any, *, fresh: bool) -> tuple[Any, ...]:
    source = _source(args); predecessor = _predecessor(args); manifest = validate_sources(_root(args))
    source_evidence = _load_source_receipt(args, source, manifest)
    observation, observation_sha = _load_observation(args, source, source_evidence, require_fresh=fresh)
    observed_roots = {
        "ledger": observation.ledger_root, "catalog": observation.catalog_root,
        "acl": observation.acl_root, "data": observation.data_root,
    }
    predecessor_roots = {
        key: predecessor.roots[key] for key in observed_roots
    }
    if (observation.status != EXACT_40 or observation.ledger_rows != 40
            or observed_roots != predecessor_roots):
        _deny("destructive_admission")
    freeze = _freeze(args, source, manifest, predecessor)
    backup, backup_sha = _load_backup(args, source, source_evidence, observation_sha, freeze, require_fresh=fresh)
    clone, clone_sha = _load_clone(args, source, manifest, predecessor, freeze, backup_sha, backup)
    bindings = _exact_bindings(_root(args), source, source_evidence, manifest, predecessor, observation_sha, freeze, backup, backup_sha, clone, clone_sha,
        args.disposable_runtime_subject_sha256, args.disposable_runtime_proof_contract_sha256)
    _revalidate_backup_artifacts(args, backup)
    return source, source_evidence, predecessor, manifest, observation, observation_sha, freeze, backup, backup_sha, clone, clone_sha, bindings


def prepare(args: Any) -> Mapping[str, Any]:
    *_, bindings = _prepare_material(args, fresh=True)
    _publish_restrictive(_outside(args.authority_template, _root(args), fresh=True), canonical_json_bytes(bindings))
    return MappingProxyType({"schema": SCHEMA, "mode": "prepare", "status": "prepared", "bindings_sha256": canonical_sha256(bindings)})


def _authorization(args: Any, bindings: dict[str, Any], *, historical: bool = False) -> authority.VerifiedAuthorization:
    try:
        if historical:
            return authority.verify_outcome_authorization(authority.authenticate_outcome_authorization(args.authorization, args.authorization_signature, repository_root=_root(args)))
        envelope = authority.authenticate_successor_authorization(args.authorization, args.authorization_signature, expected_bindings=bindings, repository_root=_root(args))
        return authority.reverify_destructive_stage(envelope, expected_bindings=bindings)
    except Exception:
        _deny("authority_verification")


def _prepared_body(source: SourceBinding, source_evidence: SourceEvidence,
                   predecessor: PredecessorEvidence, verified: authority.VerifiedAuthorization,
                   freeze: VerifiedFreeze, backup_sha: str) -> dict[str, Any]:
    body = {"schema": _PREPARED_SCHEMA, "source_commit": source.final_commit, "target_fingerprint": TARGET_FINGERPRINT,
        "source_validation_receipt_sha256": verified.source_validation_receipt_sha256,
        "source_attestation_bundle_sha256": source_evidence.bundle_sha256,
        "verified_source_provenance_sha256": source_evidence.provenance_sha256,
        "authorization_id": verified.authorization_id, "attempt_id": verified.attempt_id, "authorization_sha256": verified.authorization_sha256,
        "starting_roots": dict(predecessor.roots),
        "target_roots": {"ledger": verified.target_ledger_root, "catalog": verified.target_catalog_root, "acl": verified.target_acl_root, "data": verified.target_data_root, "spec": verified.target_spec_sha256},
        "selected_versions": list(SELECTED_VERSIONS), "vector_root": verified.vector_root, "freeze_root": freeze.root,
        "backup_receipt_sha256": backup_sha, "issued_at": int(time.time())}
    body["receipt_sha256"] = canonical_sha256(body)
    return body


def _terminal_state(verified: authority.VerifiedAuthorization) -> dict[str, Any]:
    return {
        "row_count": 42, "ledger_root": verified.target_ledger_root,
        "catalog_root": verified.target_catalog_root, "acl_root": verified.target_acl_root,
        "data_root": verified.target_data_root, "terminal_spec_root": verified.target_spec_sha256,
    }


def _checkpoint(args: Any, *, name: str, receipt_path: Path, source: SourceBinding,
                verified: authority.VerifiedAuthorization, freeze_root: str,
                prepared_sha: str, attempt_sha: str, executor_sha: str,
                state_sha: str, parent_sha: str, continuity_epoch: int) -> Any:
    try:
        return request_checkpoint(
            socket_path=Path(args.freeze_monitor_socket), receipt_path=receipt_path,
            repository_root=_root(args), checkpoint=name, source_commit=source.final_commit,
            runtime_source_root=source.runtime_source_root, freeze_root=freeze_root,
            authorization_sha256=verified.authorization_sha256,
            attempt_receipt_sha256=attempt_sha, prepared_receipt_sha256=prepared_sha,
            executor_evidence_sha256=executor_sha, state_sha256=state_sha,
            parent_evidence_sha256=parent_sha, continuity_epoch=continuity_epoch,
        )
    except FreezeError:
        _deny("freeze_continuity")


def _terminal_readback(args: Any, source: SourceBinding, manifest: Any, verified: authority.VerifiedAuthorization) -> dict[str, Any]:
    plan = compile_plan(_root(args), manifest)
    deadline = time.monotonic() + 30
    conn = _connect_service(args, readonly=True, deadline_monotonic=deadline); cursor = None
    try:
        cursor = conn.cursor()
        _begin_controller_transaction(cursor, readonly=True, deadline_monotonic=deadline)
        _require_live_target(cursor, deadline_monotonic=deadline)
        state = observe_live_state(
            cursor, plan=plan, predecessor_ledger_root=verified.starting_ledger_root,
            target_ledger_root=verified.target_ledger_root, deadline_monotonic=deadline,
        )
        expected = (
            EXACT_42, 42, verified.target_ledger_root, verified.target_catalog_root,
            verified.target_acl_root, verified.target_data_root,
        )
        if (
            state.classification, state.rows, state.ledger_root, state.catalog_root,
            state.acl_root, state.data_root,
        ) != expected:
            _deny("terminal_readback")
        assert_terminal_readback(cursor, plan, deadline_monotonic=deadline)
        terminal = {"row_count": state.rows, "ledger_root": state.ledger_root,
            "catalog_root": state.catalog_root, "acl_root": state.acl_root,
            "data_root": state.data_root, "terminal_spec_root": verified.target_spec_sha256}
        if canonical_sha256(terminal) != canonical_sha256(_terminal_state(verified)):
            _deny("terminal_readback")
        return terminal
    except (ControllerError, SuccessorError):
        raise
    except Exception:
        _deny("terminal_readback")
    finally:
        if cursor is not None:
            try: cursor.close()
            except Exception: pass
        try: conn.rollback(); conn.close()
        except Exception: pass


def _write_terminal(args: Any, source: SourceBinding, source_evidence: SourceEvidence, manifest: Any, verified: authority.VerifiedAuthorization,
                    prepared_sha: str, attempt_sha: str, terminal: Mapping[str, Any],
                    executor_sha: str, freeze_root: str, continuity_parent_sha: str,
                    continuity_epoch: int, checkpoint: Any, readback_kind: str,
                    final_path: Path) -> str:
    expected_checkpoint = (
        "historical-terminal-readback" if readback_kind == "historical"
        else "postcommit-terminal-readback"
    )
    if (checkpoint.checkpoint != expected_checkpoint
            or checkpoint.freeze_root != freeze_root
            or checkpoint.parent_evidence_sha256 != continuity_parent_sha
            or checkpoint.continuity_epoch != continuity_epoch
            or checkpoint.executor_evidence_sha256 != executor_sha
            or checkpoint.state_sha256 != canonical_sha256(dict(terminal))):
        _deny("freeze_continuity")
    migration_hashes = {item.version: item.sha256 for item in manifest.migrations}
    if set(migration_hashes) != set(SELECTED_VERSIONS):
        _deny("terminal_readback")
    terminal_sha = canonical_sha256(dict(terminal))
    body = {"schema": _TERMINAL_SCHEMA, "source_commit": source.final_commit, "target_fingerprint": TARGET_FINGERPRINT,
        "source_validation_receipt_sha256": verified.source_validation_receipt_sha256,
        "source_attestation_bundle_sha256": source_evidence.bundle_sha256,
        "verified_source_provenance_sha256": source_evidence.provenance_sha256,
        "authorization_id": verified.authorization_id, "attempt_id": verified.attempt_id, "authorization_sha256": verified.authorization_sha256,
        "prepared_receipt_sha256": prepared_sha, "attempt_receipt_sha256": attempt_sha, **dict(terminal),
        "migration_hashes": migration_hashes, "vector_root": STATEMENT_VECTOR_ROOT,
        "readback_kind": readback_kind, "terminal_state_sha256": terminal_sha,
        "executor_evidence_sha256": executor_sha, "static_freeze_root": freeze_root,
        "continuity_parent_sha256": continuity_parent_sha,
        "checkpoint_receipt_sha256": checkpoint.receipt_sha256,
        "checkpoint_name": checkpoint.checkpoint}
    readback = dict(body); body["readback_sha256"] = canonical_sha256(readback); body["receipt_sha256"] = canonical_sha256(body)
    return _write_signed(final_path, "terminal-readback", body, repository_root=_root(args))


def execute(args: Any) -> Mapping[str, Any]:
    source, source_evidence, predecessor, manifest, observation, observation_sha, freeze, backup, backup_sha, clone, clone_sha, bindings = _prepare_material(args, fresh=True)
    verified = _authorization(args, bindings); plan = compile_plan(_root(args), manifest)
    prepared_path = _outside(args.prepared_receipt, _root(args), fresh=True)
    final_path = _outside(args.final_receipt, _root(args), fresh=True)
    try:
        precommit_path = preflight_checkpoint_path(Path(args.precommit_checkpoint_receipt), repository_root=_root(args))
        postcommit_path = preflight_checkpoint_path(Path(args.postcommit_checkpoint_receipt), repository_root=_root(args))
    except FreezeError:
        _deny("checkpoint_custody")
    deadline = time.monotonic() + (
        min(verified.expires_at, verified.freeze_expires_at, freeze.expires_at, backup["expires_at"])
        - time.time()
    )
    if deadline <= time.monotonic():
        _deny("authority_expired")
    conn = _connect_service(args, readonly=False, deadline_monotonic=deadline); cursor = None; commit_attempted = False
    try:
        cursor = conn.cursor()
        _begin_controller_transaction(cursor, readonly=False, deadline_monotonic=deadline)
        _require_live_target(cursor, deadline_monotonic=deadline)
        current_backup, current_backup_sha = _load_backup(args, source, source_evidence, observation_sha, freeze)
        _revalidate_backup_artifacts(args, current_backup)
        if current_backup != backup or current_backup_sha != backup_sha: _deny("backup_invalid")
        prepared = _prepared_body(source, source_evidence, predecessor, verified, freeze, backup_sha)
        prepared_sha = _write_signed(prepared_path, "prepared-intent", prepared, repository_root=_root(args))
        def apply_attempt(marker: authority.AttemptStarted) -> Any:
            _bind_controller_transaction(cursor, verified, marker, deadline_monotonic=deadline)
            return apply_cursor(cursor, plan=plan, authorization=verified, attempt=marker, deadline_monotonic=deadline)
        attempt, evidence = authority.consume_one_shot_attempt(
            repository_root=_root(args), authorization=verified, callback=apply_attempt,
        )
        state_sha = canonical_sha256(_terminal_state(verified))
        precommit = _checkpoint(
            args, name="precommit", receipt_path=precommit_path, source=source,
            verified=verified, freeze_root=freeze.root, prepared_sha=prepared_sha,
            attempt_sha=attempt.receipt_sha256, executor_sha=evidence.evidence_sha256,
            state_sha=state_sha, parent_sha=freeze.root,
            continuity_epoch=freeze.issued_at,
        )
        if time.monotonic() >= deadline: _deny("authority_expired")
        commit_attempted = True; conn.commit()
    except ControllerError:
        if not commit_attempted:
            try: conn.rollback()
            except Exception: pass
        raise
    except SuccessorError as exc:
        if not commit_attempted:
            try: conn.rollback()
            except Exception: pass
        _deny(f"executor_{exc.code}" if exc.code in {"authorization_binding", "attempt_binding", "destructive_admission", "terminal_roots", "deadline", "transaction_ownership"} else "execute_failed")
    except Exception:
        if commit_attempted: _deny("commit_ambiguous_readback_only")
        try: conn.rollback()
        except Exception: pass
        _deny("execute_failed")
    finally:
        if cursor is not None:
            try: cursor.close()
            except Exception: pass
        try: conn.close()
        except Exception: pass
    try:
        terminal = _terminal_readback(args, source, manifest, verified)
        terminal_sha = canonical_sha256(terminal)
        if terminal_sha != precommit.state_sha256: _deny("terminal_readback")
        postcommit = _checkpoint(
            args, name="postcommit-terminal-readback", receipt_path=postcommit_path,
            source=source, verified=verified, freeze_root=freeze.root,
            prepared_sha=prepared_sha, attempt_sha=attempt.receipt_sha256,
            executor_sha=evidence.evidence_sha256, state_sha=terminal_sha,
            parent_sha=precommit.receipt_sha256,
            continuity_epoch=precommit.continuity_epoch,
        )
        final_sha = _write_terminal(
            args, source, source_evidence, manifest, verified, prepared_sha, attempt.receipt_sha256,
            terminal, evidence.evidence_sha256, freeze.root, precommit.receipt_sha256,
            precommit.continuity_epoch, postcommit, "execute", final_path,
        )
    except Exception:
        _deny("commit_ambiguous_readback_only")
    return MappingProxyType({"schema": SCHEMA, "mode": "execute", "status": "committed",
        "prepared_receipt_sha256": prepared_sha,
        "executor_evidence_sha256": evidence.evidence_sha256,
        "precommit_checkpoint_sha256": precommit.receipt_sha256,
        "postcommit_checkpoint_sha256": postcommit.receipt_sha256,
        "final_receipt_sha256": final_sha})


def _load_prepared(args: Any, source: SourceBinding, source_evidence: SourceEvidence, verified: authority.VerifiedAuthorization) -> tuple[dict[str, Any], str]:
    raw = _stable_bytes(_outside(args.prepared_receipt, _root(args)), _root(args)); body = _signed_document(raw, schema=SCHEMA, kind="prepared-intent", pem=_RECEIPT_PUBLIC_KEY_PEM, key_sha256=_RECEIPT_PUBLIC_KEY_SHA256)
    required = {"schema", "source_commit", "source_validation_receipt_sha256", "source_attestation_bundle_sha256", "verified_source_provenance_sha256", "target_fingerprint", "authorization_id", "attempt_id", "authorization_sha256", "starting_roots", "target_roots", "selected_versions", "vector_root", "freeze_root", "backup_receipt_sha256", "issued_at", "receipt_sha256"}
    starting = body.get("starting_roots")
    target = body.get("target_roots")
    if (set(body) != required or body.get("schema") != _PREPARED_SCHEMA or body.get("source_commit") != source.final_commit
            or body.get("source_validation_receipt_sha256") != verified.source_validation_receipt_sha256
            or body.get("source_attestation_bundle_sha256") != source_evidence.bundle_sha256
            or body.get("verified_source_provenance_sha256") != source_evidence.provenance_sha256
            or body.get("target_fingerprint") != TARGET_FINGERPRINT or body.get("authorization_id") != verified.authorization_id
            or body.get("attempt_id") != verified.attempt_id or body.get("authorization_sha256") != verified.authorization_sha256
            or type(starting) is not dict or set(starting) != _ROOT_KEYS
            or starting.get("ledger") != verified.starting_ledger_root
            or starting.get("catalog") != verified.starting_catalog_root
            or starting.get("acl") != verified.starting_acl_root
            or starting.get("data") != verified.starting_data_root or not _hex(starting.get("spec"))
            or target != {"ledger": verified.target_ledger_root, "catalog": verified.target_catalog_root,
                          "acl": verified.target_acl_root, "data": verified.target_data_root,
                          "spec": verified.target_spec_sha256}
            or body.get("selected_versions") != list(SELECTED_VERSIONS) or body.get("vector_root") != verified.vector_root
            or body.get("freeze_root") != verified.freeze_root or body.get("backup_receipt_sha256") != verified.backup_receipt_sha256
            or type(body.get("issued_at")) is not int
            or body.get("receipt_sha256") != canonical_sha256({key: item for key, item in body.items() if key != "receipt_sha256"})):
        _deny("outcome_anchor")
    return body, hashlib.sha256(raw).hexdigest()


def readback(args: Any) -> Mapping[str, Any]:
    source = _source(args); manifest = validate_sources(_root(args)); source_evidence = _load_source_receipt(args, source, manifest, require_fresh=False); verified = _authorization(args, {}, historical=True)
    final_path = _outside(args.final_receipt, _root(args), fresh=True)
    try:
        historical_path = preflight_checkpoint_path(
            Path(args.historical_checkpoint_receipt), repository_root=_root(args))
        continuity_parent = load_checkpoint(
            Path(args.continuity_parent_receipt), repository_root=_root(args),
            allowed_checkpoints=frozenset(("precommit", "postcommit-terminal-readback")),
        )
    except FreezeError:
        _deny("outcome_anchor")
    manifest_root, source_root = _manifest_roots(_root(args), manifest)
    if (verified.g038_source_commit != source.final_commit or verified.runtime_source_root != source.runtime_source_root
            or verified.source_validation_receipt_sha256 != source_evidence.binding_sha256
            or verified.target_fingerprint != TARGET_FINGERPRINT or verified.vector_root != STATEMENT_VECTOR_ROOT
            or verified.target_spec_sha256 != TERMINAL_SPEC_ROOT or verified.selected_versions != list(SELECTED_VERSIONS)
            or verified.predecessor_commit != PREDECESSOR_COMMIT or verified.predecessor_report_sha256 != PREDECESSOR_REPORT_SHA256
            or verified.predecessor_rows != 40 or verified.target_rows != 42 or verified.exclusions_root != EXCLUDED_ROOT
            or verified.manifest_root != manifest_root or verified.source_root != source_root):
        _deny("outcome_anchor")
    prepared, prepared_sha = _load_prepared(args, source, source_evidence, verified)
    parent = authority.canonical_journal_parent(_root(args)); marker_path = parent / f"authorization-{verified.authorization_id}.json"
    marker = authority._decode(_stable_bytes(marker_path, _root(args)))
    marker_unsigned = {key: item for key, item in marker.items() if key != "receipt_sha256"}
    marker_expected = {
        "schema": authority.JOURNAL_SCHEMA, "event": "attempt-started",
        "authorization_id": verified.authorization_id, "attempt_id": verified.attempt_id,
        "target_fingerprint": verified.target_fingerprint, "runtime_source_root": verified.runtime_source_root,
        "source_validation_receipt_sha256": verified.source_validation_receipt_sha256,
        "predecessor_report_sha256": verified.predecessor_report_sha256,
        "observation_receipt_sha256": verified.observation_receipt_sha256,
        "disposable_runtime_subject_sha256": verified.disposable_runtime_subject_sha256,
        "authorization_sha256": verified.authorization_sha256, "signature_sha256": verified.signature_sha256,
        "bindings_sha256": verified.bindings_sha256,
    }
    if (set(marker) != set(authority.AttemptStarted.__annotations__)
            or any(marker.get(key) != item for key, item in marker_expected.items())
            or type(marker.get("at")) is not int or not verified.issued_at <= marker["at"] <= verified.expires_at
            or marker.get("receipt_sha256") != authority.canonical_sha256(marker_unsigned)):
        _deny("outcome_anchor")
    parent_body = continuity_parent.body
    if (continuity_parent.freeze_root != verified.freeze_root
            or parent_body.get("source_commit") != source.final_commit
            or parent_body.get("runtime_source_root") != source.runtime_source_root
            or parent_body.get("target_fingerprint") != TARGET_FINGERPRINT
            or parent_body.get("authorization_sha256") != verified.authorization_sha256
            or parent_body.get("prepared_receipt_sha256") != prepared_sha
            or parent_body.get("attempt_receipt_sha256") != marker["receipt_sha256"]):
        _deny("outcome_anchor")
    terminal = _terminal_readback(args, source, manifest, verified)
    terminal_sha = canonical_sha256(terminal)
    if terminal_sha != continuity_parent.state_sha256:
        _deny("outcome_anchor")
    checkpoint = _checkpoint(
        args, name="historical-terminal-readback", receipt_path=historical_path,
        source=source, verified=verified, freeze_root=continuity_parent.freeze_root,
        prepared_sha=prepared_sha, attempt_sha=marker["receipt_sha256"],
        executor_sha=continuity_parent.executor_evidence_sha256,
        state_sha=terminal_sha, parent_sha=continuity_parent.receipt_sha256,
        continuity_epoch=continuity_parent.continuity_epoch,
    )
    final_sha = _write_terminal(
        args, source, source_evidence, manifest, verified, prepared_sha, marker["receipt_sha256"],
        terminal, continuity_parent.executor_evidence_sha256,
        continuity_parent.freeze_root, continuity_parent.receipt_sha256,
        continuity_parent.continuity_epoch, checkpoint, "historical", final_path,
    )
    return MappingProxyType({"schema": SCHEMA, "mode": "readback", "status": "terminal",
        "continuity_parent_sha256": continuity_parent.receipt_sha256,
        "historical_checkpoint_sha256": checkpoint.receipt_sha256,
        "final_receipt_sha256": final_sha})


_COMMON_PREDECESSOR = ("predecessor-report", "predecessor-final-receipt", "predecessor-readback-receipt")
_SOURCE_AUTHENTICATION = ("source-receipt", "source-attestation-bundle", "gh-path")
_MATERIAL = (*_COMMON_PREDECESSOR, "observation", "freeze-assertion", "backup-receipt", "capture-receipt", "archive", "dual-clone-receipt", "disposable-runtime-subject-sha256", "disposable-runtime-proof-contract-sha256")
_MODE_OPTIONS = MappingProxyType({
    "validate-source": ("repository-root", "source-commit", "source-receipt"),
    "observe": ("repository-root", "source-commit", *_SOURCE_AUTHENTICATION, *_COMMON_PREDECESSOR, "service-file", "service-name", "observation-receipt"),
    "production-backup": ("repository-root", "source-commit", *_SOURCE_AUTHENTICATION, *_COMMON_PREDECESSOR, "observation", "freeze-assertion", "destination", "capture-receipt", "archive", "service-file", "recipient", "g034-artifact", "pg-dump", "encrypt-executable", "output"),
    "prepare": ("repository-root", "source-commit", *_SOURCE_AUTHENTICATION, *_MATERIAL, "authority-template"),
    "execute": ("repository-root", "source-commit", *_SOURCE_AUTHENTICATION, *_MATERIAL, "service-file", "service-name", "authorization", "authorization-signature", "freeze-monitor-socket", "precommit-checkpoint-receipt", "postcommit-checkpoint-receipt", "prepared-receipt", "final-receipt"),
    "readback": ("repository-root", "source-commit", *_SOURCE_AUTHENTICATION, "service-file", "service-name", "authorization", "authorization-signature", "freeze-monitor-socket", "continuity-parent-receipt", "historical-checkpoint-receipt", "prepared-receipt", "final-receipt"),
})
_HANDLERS = MappingProxyType({"validate-source": validate_source, "observe": observe, "production-backup": production_backup, "prepare": prepare, "execute": execute, "readback": readback})


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if not argv or argv[0] not in MODES:
        argparse.ArgumentParser(prog="g038-production-controller").error("invalid_arguments")
    mode = argv[0]; parser = argparse.ArgumentParser(prog="g038-production-controller", add_help=False)
    parser.add_argument("mode", choices=(mode,))
    for option in _MODE_OPTIONS[mode]: parser.add_argument(f"--{option}", required=True)
    args, unknown = parser.parse_known_args(argv)
    if unknown or any(sum(token == f"--{option}" or token.startswith(f"--{option}=") for token in argv[1:]) != 1 for option in _MODE_OPTIONS[mode]):
        parser.error("invalid_arguments")
    try:
        print(json.dumps(dict(_HANDLERS[mode](args)), sort_keys=True)); return 0
    except ControllerError as exc:
        print(json.dumps({"schema": SCHEMA, "status": str(exc)}, sort_keys=True)); return 2


if __name__ == "__main__":
    raise SystemExit(main())
