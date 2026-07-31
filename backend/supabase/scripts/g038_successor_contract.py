"""Immutable source contract for the two-migration G038 successor."""
from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import subprocess
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Sequence


class SuccessorContractError(ValueError):
    """The G038 successor source contract is not exact."""


MANIFEST_RELATIVE_PATH = ".github/g038-account-deletion-successor.v1.json"
PREDECESSOR_REPORT_SHA256 = "85f6b1e6e34e3311bbffd7146232ca41d6393bdd43688d4ebd7b230bdf929114"
PREDECESSOR_COMMIT = "664cee04a4f239d6cf8fe2eebab8de9c8404b316"
TARGET_FINGERPRINT = "defdf3cc65753b4b4dcaa321b16b4347278239ae08e41f19a2d98fec9f3a0331"
PREDECESSOR_ROWS = 40
TARGET_ROWS = 42
SELECTED_VERSIONS = ("20260713002600", "20260713002700")
EXCLUDED_SOURCES = ("20260713002500", "G026")
PREDECESSOR_LEDGER_ROOT = "5694f8d8a7316a89c2eba84fdcf2c327fa82cce736de22c64de5d14309eedb32"
STATEMENT_VECTOR_ROOT = "593ec2ed8c95bdd237d0d0b5644ecd956c8ceef608a12c6b1a14883e3e5ff347"
EXCLUDED_ROOT = "38d3c58faaaebfb0dda64507e7aff4b46d65041e71f506e2cf0c170d5b981fa0"
RUNTIME_INVENTORY_ROOT = "0aff716115841e416ff6b7fd1f19f5acf6e308de7dd0ba45aa601094124d902d"
TERMINAL_SPEC_ROOT = "68db33d91a5ec0d4db91ec470fc8b6dbf636c443f2dafdf7a43ff5c9f7ab11e5"

PREDECESSOR_PAIRS = (
    ("20251219", "db_performance_optimization"),
    ("20260118", "create_ocr_logs"),
    ("20260425", "allow_ocr_logs_user_insert"),
    ("20260506065538", "optimize_auth_user_state_indexes"),
    ("20260506085634", "optimize_app_query_indexes"),
    ("20260509000100", "drop_server_costs"),
    ("20260509000200", "drop_admin_ai_settings"),
    ("20260523093000", "create_restaurant_popular_rank_snapshots"),
    ("20260525143908", "create_youtube_kpi_snapshots"),
    ("20260526083932", "add_youtube_channel_growth_snapshot_deltas"),
    ("20260531084217", "harden_public_api_grants_and_rpcs"),
    ("20260531084516", "tighten_public_table_data_api_grants"),
    ("20260627080000", "storyboard_custom_gpt_rag_documents"),
    ("20260627153000", "storyboard_documents_hybrid_v2_indexes"),
    ("20260627154500", "storyboard_documents_hybrid_rrf_type_fix"),
    ("20260702000100", "restaurant_request_review_lifecycle"),
    ("20260704000100", "restaurant_submission_submit_contract"),
    ("20260704000200", "restaurant_destructive_admin_audit"),
    ("20260707000100", "admin_restaurant_map_overlays"),
    ("20260707000200", "admin_restaurant_map_overlay_audit_apply"),
    ("20260707000300", "admin_trend_schema_foundation"),
    ("20260707000400", "admin_trend_job_request_rpcs"),
    ("20260707000500", "admin_trend_proposal_review_rpc"),
    ("20260707000600", "admin_trend_proposal_approval_rpc"),
    ("20260711000100", "release_auth_session_revocation"),
    ("20260712000100", "g010_privacy_foundation"),
    ("20260712000200", "g010_notification_marketing"),
    ("20260712000300", "g010_account_deletion"),
    ("20260712000400", "g010_retention_separation"),
    ("20260712000500", "g010_incident_workflow"),
    ("20260712000600", "g010_ocr_log_minimization"),
    ("20260713000100", "g013_short_url_security"),
    ("20260713000200", "g013_ocr_quota_security"),
    ("20260713000300", "g013_admin_provider_budgets"),
    ("20260713000450", "g013_address_admin_approval"),
    ("20260713002000", "g014_public_api_private_boundary"),
    ("20260713002100", "g014_privacy_workflows"),
    ("20260713002200", "g014_marketing_state_machine"),
    ("20260713002300", "g014_account_deletion_state_machine"),
    ("20260713002400", "g014_retention_adapters_receipts"),
)

RUNTIME_INVENTORY = (
    ".github/g034-hosted-migration-closure.v1.json",
    ".github/g038-account-deletion-successor.v1.json",
    ".github/workflows/account-deletion-worker.yml",
    ".github/workflows/g038-account-deletion-successor.yml",
    ".github/workflows/privacy-retention.yml",
    "apps/web/app/api/account/delete/route.ts",
    "apps/web/app/api/internal/account-deletion/route.ts",
    "apps/web/app/api/internal/privacy-retention/route.ts",
    "apps/web/integrations/supabase/types.ts",
    "apps/web/lib/privacy/account-deletion-reauth.ts",
    "apps/web/lib/privacy/account-deletion-worker.ts",
    "apps/web/lib/privacy/account-deletion.ts",
    "apps/web/lib/privacy/retention-runner.ts",
    "apps/web/scripts/run-account-deletion-worker.mjs",
    "apps/web/scripts/run-privacy-retention-schedule.mjs",
    "apps/web/tests-unit/account-deletion-contract.test.ts",
    "apps/web/tests-unit/account-deletion-reauth-contract.test.ts",
    "apps/web/tests-unit/account-deletion-worker.test.ts",
    "apps/web/tests-unit/privacy-retention.test.ts",
    "backend/supabase/docs/g038-account-deletion-successor-runbook.md",
    "backend/supabase/migrations/20260713002600_g014_account_deletion_receipt_parity.sql",
    "backend/supabase/migrations/20260713002700_g028_account_deletion_reauth_proof.sql",
    "backend/supabase/scripts/g035_hosted_recovery.py",
    "backend/supabase/scripts/g035_hosted_recovery_contract.py",
    "backend/supabase/scripts/g037_hosted_closure_contract.py",
    "backend/supabase/scripts/g037_supabase_statement_vector.mjs",
    "backend/supabase/scripts/g038_clone_rehearsal.py",
    "backend/supabase/scripts/g038_isolated_bootstrap.py",
    "backend/supabase/scripts/g038_local_clone_adapter.py",
    "backend/supabase/scripts/g038_production_controller.py",
    "backend/supabase/scripts/g038_runtime_proof.py",
    "backend/supabase/scripts/g038_successor_authorization.py",
    "backend/supabase/scripts/g038_successor_contract.py",
    "backend/supabase/scripts/g038_successor_executor.py",
    "backend/supabase/scripts/g038_successor_source.py",
    "backend/supabase/scripts/g038_write_freeze.py",
    "backend/supabase/scripts/g040_recovery_source.py",
    "backend/supabase/scripts/preflight_g034_hosted_migration_closure.py",
    "backend/supabase/tests/g038_terminal_readback.sql",
    "backend/supabase/tests/test_g038_clone_rehearsal.py",
    "backend/supabase/tests/test_g038_cross_clone_receipt.py",
    "backend/supabase/tests/test_g038_cross_module_contract.py",
    "backend/supabase/tests/test_g038_isolated_bootstrap.py",
    "backend/supabase/tests/test_g038_local_clone_adapter.py",
    "backend/supabase/tests/test_g038_production_controller.py",
    "backend/supabase/tests/test_g038_runtime_proof.py",
    "backend/supabase/tests/test_g038_source_contract.py",
    "backend/supabase/tests/test_g038_successor_authorization.py",
    "backend/supabase/tests/test_g038_successor_contract.py",
    "backend/supabase/tests/test_g038_successor_executor.py",
    "backend/supabase/tests/test_g038_successor_source.py",
    "backend/supabase/tests/test_g038_workflow.py",
    "backend/supabase/tests/test_g038_write_freeze.py",
)

TOKEN_BLOB_PARTS = ("db00843424", "6be335b9f7", "abaf0cb66a", "99a2b40378")
STATE_BLOB_PARTS = ("47775390d1", "731c0ad29e", "10b20fb2fe", "16c8cfcadb")

PARSER_SPEC = {
    "schema": "g037-supabase-statement-vector-v1",
    "stateBlobParts": list(STATE_BLOB_PARTS),
    "statePath": "apps/cli-go/pkg/parser/state.go",
    "tokenBlobParts": list(TOKEN_BLOB_PARTS),
    "tokenPath": "apps/cli-go/pkg/parser/token.go",
    "upstreamCommit": "6d4c19870ed213ba7f682f117d0345c8a40bfa94",
    "upstreamVersion": "v2.109.1",
}

_MANIFEST_KEYS = frozenset(("schema", "predecessor", "migrations", "excludedSources", "excludedRoot", "runtimeInventory", "runtimeInventoryRoot", "statementParser", "statementVectorRoot", "targetRows", "terminalSpecRoot"))
_PREDECESSOR_KEYS = frozenset(("reportSha256", "commit", "targetFingerprint", "rows", "ledgerRoot"))
_MIGRATION_KEYS = frozenset(("version", "name", "path", "sourceSize", "sourceSha256", "statementCount", "statementVectorSha256", "transactionControl"))
_HEX10 = re.compile(r"^[0-9a-f]{10}$")
_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_VERSION = re.compile(r"^[0-9]{14}$")


@dataclass(frozen=True)
class Migration:
    version: str
    name: str
    path: str
    sha256: str
    size: int
    statement_count: int
    vector_sha256: str
    transaction_control: tuple[str, ...]


@dataclass(frozen=True)
class Manifest:
    migrations: tuple[Migration, ...]
    predecessor_report_sha256: str
    predecessor_commit: str
    target_fingerprint: str
    predecessor_rows: int
    target_rows: int
    predecessor_ledger_root: str
    statement_vector_root: str
    terminal_spec_root: str
    excluded_root: str
    runtime_inventory_root: str
    runtime_inventory: tuple[str, ...]


def canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii")


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def _fail() -> None:
    raise SuccessorContractError("G038 successor contract verification failed") from None


def _no_duplicate_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if type(key) is not str or key in result:
            _fail()
        result[key] = value
    return result


def _relative_path(value: Any) -> str:
    if type(value) is not str or not value or "\\" in value:
        _fail()
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ("", ".", "..") for part in path.parts):
        _fail()
    return value

def _blob_parts(value: Any) -> tuple[str, str, str, str]:
    if (type(value) is not list or len(value) != 4
            or any(type(part) is not str or not _HEX10.fullmatch(part) for part in value)):
        _fail()
    return value[0], value[1], value[2], value[3]


def _parser_blob(value: Any, expected: tuple[str, str, str, str]) -> str:
    parts = _blob_parts(value)
    if parts != expected:
        _fail()
    return "".join(parts)


def repository_root(start: Path | str) -> Path:
    try:
        resolved = Path(start).resolve(strict=True)
    except (OSError, TypeError, ValueError):
        _fail()
    if resolved.is_file():
        resolved = resolved.parent
    for candidate in (resolved, *resolved.parents):
        path = candidate / MANIFEST_RELATIVE_PATH
        if path.is_file() and not path.is_symlink():
            return candidate
    _fail()


def _load_json(path: Path) -> dict[str, Any]:
    try:
        if path.is_symlink() or not path.is_file():
            _fail()
        raw = path.read_bytes()
        value = json.loads(raw.decode("ascii"), object_pairs_hook=_no_duplicate_object)
        if type(value) is not dict or raw != canonical_json_bytes(value) + b"\n":
            _fail()
        return value
    except (OSError, UnicodeError, json.JSONDecodeError):
        _fail()


def _expected_terminal_root() -> str:
    return canonical_sha256({
        "excludedRoot": EXCLUDED_ROOT,
        "predecessorCommit": PREDECESSOR_COMMIT,
        "predecessorLedgerRoot": PREDECESSOR_LEDGER_ROOT,
        "predecessorReportSha256": PREDECESSOR_REPORT_SHA256,
        "predecessorRows": PREDECESSOR_ROWS,
        "runtimeInventoryRoot": RUNTIME_INVENTORY_ROOT,
        "statementVectorRoot": STATEMENT_VECTOR_ROOT,
        "targetFingerprint": TARGET_FINGERPRINT,
        "targetRows": TARGET_ROWS,
    })


def load_manifest(root: Path | str) -> Manifest:
    try:
        base = Path(root)
    except (TypeError, ValueError):
        _fail()
    data = _load_json(base / MANIFEST_RELATIVE_PATH)
    if set(data) != _MANIFEST_KEYS or data.get("schema") != "g038-account-deletion-successor-v1":
        _fail()
    predecessor = data.get("predecessor")
    if type(predecessor) is not dict or set(predecessor) != _PREDECESSOR_KEYS:
        _fail()
    expected_predecessor = {
        "reportSha256": PREDECESSOR_REPORT_SHA256,
        "commit": PREDECESSOR_COMMIT,
        "targetFingerprint": TARGET_FINGERPRINT,
        "rows": PREDECESSOR_ROWS,
        "ledgerRoot": PREDECESSOR_LEDGER_ROOT,
    }
    if predecessor != expected_predecessor:
        _fail()
    if canonical_sha256(PREDECESSOR_PAIRS) != PREDECESSOR_LEDGER_ROOT or len(PREDECESSOR_PAIRS) != PREDECESSOR_ROWS:
        _fail()
    if data.get("excludedSources") != list(EXCLUDED_SOURCES) or data.get("excludedRoot") != EXCLUDED_ROOT or canonical_sha256(list(EXCLUDED_SOURCES)) != EXCLUDED_ROOT:
        _fail()
    if data.get("runtimeInventory") != list(RUNTIME_INVENTORY) or data.get("runtimeInventoryRoot") != RUNTIME_INVENTORY_ROOT or canonical_sha256(list(RUNTIME_INVENTORY)) != RUNTIME_INVENTORY_ROOT:
        _fail()
    parser = data.get("statementParser")
    if (type(parser) is not dict or set(parser) != set(PARSER_SPEC)
            or _blob_parts(parser.get("tokenBlobParts")) != TOKEN_BLOB_PARTS
            or _blob_parts(parser.get("stateBlobParts")) != STATE_BLOB_PARTS
            or parser != PARSER_SPEC
            or data.get("statementVectorRoot") != STATEMENT_VECTOR_ROOT):
        _fail()
    if type(data.get("targetRows")) is not int or data["targetRows"] != TARGET_ROWS:
        _fail()
    if data.get("terminalSpecRoot") != TERMINAL_SPEC_ROOT or _expected_terminal_root() != TERMINAL_SPEC_ROOT:
        _fail()
    rows = data.get("migrations")
    if type(rows) is not list or len(rows) != 2:
        _fail()
    migrations: list[Migration] = []
    seen_versions: set[str] = set()
    seen_paths: set[str] = set()
    for row in rows:
        if type(row) is not dict or set(row) != _MIGRATION_KEYS:
            _fail()
        version = row.get("version")
        name = row.get("name")
        path = row.get("path")
        size = row.get("sourceSize")
        sha256 = row.get("sourceSha256")
        count = row.get("statementCount")
        vector_sha256 = row.get("statementVectorSha256")
        control = row.get("transactionControl")
        if (type(version) is not str or not _VERSION.fullmatch(version)
                or type(name) is not str or not name
                or _relative_path(path) != f"backend/supabase/migrations/{version}_{name}.sql"
                or type(size) is not int or size <= 0
                or type(count) is not int or count <= 0
                or type(sha256) is not str or not _HEX64.fullmatch(sha256)
                or type(vector_sha256) is not str or not _HEX64.fullmatch(vector_sha256)
                or type(control) is not list or any(type(item) is not str for item in control)
                or version in seen_versions or path in seen_paths):
            _fail()
        seen_versions.add(version)
        seen_paths.add(path)
        migrations.append(Migration(version, name, path, sha256, size, count, vector_sha256, tuple(control)))
    if tuple(item.version for item in migrations) != SELECTED_VERSIONS:
        _fail()
    exact = (
        ("20260713002600", "g014_account_deletion_receipt_parity", 9938, "1b26641587c3c4d47abed57403642cb631b79c068c548c37f8d5dfa59b83c904", 10, "3452f5ae651c7dabb742547e4c8b136a56d00458f076252a7f189ce90970af0a", ()),
        ("20260713002700", "g028_account_deletion_reauth_proof", 18304, "ea2866a78e39a5a3d54c5ff5bb8f7517a3aeca38d8bae7c592750a6d58d223fc", 32, "869dc6e3635da02c4cca88c3061605812d188b30e761c1a92b8f12b7ab1df3bb", ("BEGIN", "COMMIT")),
    )
    if tuple((item.version, item.name, item.size, item.sha256, item.statement_count, item.vector_sha256, item.transaction_control) for item in migrations) != exact:
        _fail()
    if canonical_sha256([[item.version, item.vector_sha256] for item in migrations]) != STATEMENT_VECTOR_ROOT:
        _fail()
    return Manifest(tuple(migrations), PREDECESSOR_REPORT_SHA256, PREDECESSOR_COMMIT, TARGET_FINGERPRINT, PREDECESSOR_ROWS, TARGET_ROWS, PREDECESSOR_LEDGER_ROOT, STATEMENT_VECTOR_ROOT, TERMINAL_SPEC_ROOT, EXCLUDED_ROOT, RUNTIME_INVENTORY_ROOT, RUNTIME_INVENTORY)


def _regular_bytes(path: Path) -> bytes:
    try:
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
            _fail()
        return path.read_bytes()
    except OSError:
        _fail()


def sha256_file(path: Path) -> str:
    return hashlib.sha256(_regular_bytes(path)).hexdigest()


def _top_level_tokens(statement: str, *, limit: int = 3) -> tuple[str, ...]:
    tokens: list[str] = []
    offset = depth = 0
    while offset < len(statement) and len(tokens) < limit:
        char = statement[offset]
        if char.isspace():
            offset += 1
        elif statement.startswith("--", offset):
            newline = re.search(r"[\r\n]", statement[offset + 2:])
            offset = len(statement) if newline is None else offset + 2 + newline.end()
        elif statement.startswith("/*", offset):
            comment_depth = 1
            offset += 2
            while offset < len(statement) and comment_depth:
                if statement.startswith("/*", offset):
                    comment_depth += 1
                    offset += 2
                elif statement.startswith("*/", offset):
                    comment_depth -= 1
                    offset += 2
                else:
                    offset += 1
            if comment_depth:
                _fail()
        elif char in "'\"":
            delimiter = char
            offset += 1
            while offset < len(statement):
                if statement[offset] == delimiter:
                    if offset + 1 < len(statement) and statement[offset + 1] == delimiter:
                        offset += 2
                    else:
                        offset += 1
                        break
                else:
                    offset += 1
        elif char == "$":
            match = re.match(r"\$[A-Za-z0-9_]*\$", statement[offset:])
            if not match:
                offset += 1
                continue
            delimiter = match.group(0)
            close = statement.find(delimiter, offset + len(delimiter))
            if close < 0:
                _fail()
            offset = close + len(delimiter)
        elif char == "(":
            depth += 1
            offset += 1
        elif char == ")":
            depth = max(0, depth - 1)
            offset += 1
        elif char.isalpha() or char == "_":
            end = offset + 1
            while end < len(statement) and (statement[end].isalnum() or statement[end] in "_$"):
                end += 1
            if not depth:
                tokens.append(statement[offset:end].lower())
            offset = end
        else:
            offset += 1
    return tuple(tokens)


def _transaction_control(statement: str) -> str | None:
    tokens = _top_level_tokens(statement)
    if not tokens:
        return None
    if tokens[0] in {"abort", "begin", "commit", "end", "rollback", "savepoint", "release"}:
        return tokens[0].upper()
    if len(tokens) >= 2 and tokens[:2] in {("prepare", "transaction"), ("start", "transaction")}:
        return " ".join(tokens[:2]).upper()
    return None


def statement_vectors(
    root: Path | str,
    migration: Migration,
    *,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> tuple[str, ...]:
    base = Path(root)
    tool = base / "backend/supabase/scripts/g037_supabase_statement_vector.mjs"
    source = base / migration.path
    _regular_bytes(tool)
    try:
        result = runner(
            ["node", os.fspath(tool), "--source", os.fspath(source), "--version", migration.version,
             "--sha256", migration.sha256, "--size", str(migration.size)],
            capture_output=True, text=True, check=False, timeout=60,
        )
    except Exception:
        _fail()
    if not isinstance(result, subprocess.CompletedProcess) or result.returncode != 0 or type(result.stdout) is not str:
        _fail()
    try:
        raw = result.stdout.encode("ascii")
        data = json.loads(result.stdout, object_pairs_hook=_no_duplicate_object)
    except (UnicodeError, json.JSONDecodeError):
        _fail()
    upstream = {
        "commit": PARSER_SPEC["upstreamCommit"], "version": PARSER_SPEC["upstreamVersion"],
        "token": {"path": PARSER_SPEC["tokenPath"], "blob": _parser_blob(PARSER_SPEC["tokenBlobParts"], TOKEN_BLOB_PARTS)},
        "state": {"path": PARSER_SPEC["statePath"], "blob": _parser_blob(PARSER_SPEC["stateBlobParts"], STATE_BLOB_PARTS)},
    }
    if (type(data) is not dict
            or set(data) != {"schema", "upstream", "version", "source_sha256", "source_size", "statements"}
            or raw != canonical_json_bytes(data) + b"\n"
            or data["schema"] != PARSER_SPEC["schema"] or data["upstream"] != upstream
            or data["version"] != migration.version or data["source_sha256"] != migration.sha256
            or data["source_size"] != migration.size or type(data["statements"]) is not list
            or len(data["statements"]) != migration.statement_count
            or any(type(item) is not str or not item.strip() for item in data["statements"])
            or canonical_sha256(data["statements"]) != migration.vector_sha256):
        _fail()
    statements = tuple(data["statements"])
    observed = tuple(control for statement in statements if (control := _transaction_control(statement)) is not None)
    if observed != migration.transaction_control:
        _fail()
    if migration.version == "20260713002700" and (statements[0].strip().upper(), statements[-1].strip().upper()) != ("BEGIN", "COMMIT"):
        _fail()
    if migration.version == "20260713002600" and observed:
        _fail()
    return statements


def validate_sources(
    root: Path | str,
    *,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> Manifest:
    base = Path(root)
    manifest = load_manifest(base)
    migration_directory = base / "backend/supabase/migrations"
    try:
        directory_identity = migration_directory.resolve(strict=True)
    except OSError:
        _fail()
    for migration in manifest.migrations:
        path = base / migration.path
        raw = _regular_bytes(path)
        try:
            if path.parent.resolve(strict=True) != directory_identity:
                _fail()
        except OSError:
            _fail()
        if len(raw) != migration.size or hashlib.sha256(raw).hexdigest() != migration.sha256:
            _fail()
        statement_vectors(base, migration, runner=runner)
    return manifest


__all__ = [
    "EXCLUDED_ROOT", "EXCLUDED_SOURCES", "Manifest", "Migration", "PREDECESSOR_COMMIT",
    "PREDECESSOR_LEDGER_ROOT", "PREDECESSOR_PAIRS", "PREDECESSOR_REPORT_SHA256",
    "PREDECESSOR_ROWS", "RUNTIME_INVENTORY", "RUNTIME_INVENTORY_ROOT", "SELECTED_VERSIONS",
    "STATEMENT_VECTOR_ROOT", "SuccessorContractError", "TARGET_FINGERPRINT", "TARGET_ROWS",
    "TERMINAL_SPEC_ROOT", "canonical_json_bytes", "canonical_sha256", "load_manifest",
    "repository_root", "sha256_file", "statement_vectors", "validate_sources",
]
