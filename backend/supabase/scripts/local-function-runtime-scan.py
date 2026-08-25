#!/usr/bin/env python3
"""Fail-closed local function closure scanner and RPC smoke runner.

``scan`` remains a database-free source scan unless a local Compose database is
explicitly requested.  ``generate`` writes a source-bound SQL patch, ``apply``
executes that patch only in the repository-derived local db container, and
``rescan`` verifies that the runtime closure is complete.  No canonical
migration is edited and receipts contain hashes/statuses only.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import importlib.util
import json
import os
import re
import shutil
import stat
import subprocess
import sys
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence
from urllib.parse import urlparse

EXPECTED_SOURCE = Path("backend/supabase/migrations")
EXPECTED_PREREQUISITE = Path("backend/supabase/baselines/local/application-prerequisites.sql")
SCHEMA_VERSION = "local-function-runtime-scan/v1"
PATCH_SCHEMA = "local-function-closure-patch/v1"
TOOL_VERSION = "local-function-runtime-scan-v2"
TRUSTED_EXTENSIONS = (
    ("btree_gin", "extensions"),
    ("fuzzystrmatch", "extensions"),
    ("pgcrypto", "extensions"),
    ("pg_trgm", "extensions"),
    ("uuid-ossp", "extensions"),
    ("vector", "extensions"),
)
FIXED_SUBJECT = "00000000-0000-4000-8000-000000000001"
FIXED_REQUEST = "00000000-0000-4000-8000-000000000002"
_CREATE_SCHEMA = re.compile(
    r"(?is)\bCREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?(?P<name>[A-Za-z_][A-Za-z0-9_$]*)\b"
)
_CREATE_EXTENSION_SCHEMA = re.compile(
    r"(?is)\bCREATE\s+EXTENSION\b[^;]*?\bWITH\s+SCHEMA\s+(?P<name>[A-Za-z_][A-Za-z0-9_$]*)\b"
)
_SYSTEM_SCHEMAS = frozenset({"pg_catalog", "pg_toast", "information_schema"})
_CLOUD_INPUT = re.compile(
    r"(?i)(?:postgres(?:ql)?://|supabase\.co|\.supabase\.in|PGHOST\s*=|DATABASE_URL\s*=|aws\.amazonaws\.com|cloud\.google\.com)"
)
_PSQL_META = re.compile(r"(?m)^\s*\\[A-Za-z!][^\r\n]*")
_FUNCTION = re.compile(
    r"(?is)\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?P<name>(?:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*)\s*\((?P<args>.*?)\)(?P<body>.*?)(?=\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b|\Z)"
)
_FUNCTION_START = re.compile(
    r"(?is)\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?P<name>(?:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*)\s*\("
)
_SEARCH_PATH = re.compile(r"(?is)\bSET\s+search_path\s+(?:TO|=)\s*([^;]+)")
_TRUSTED_SEARCH_PATH_TOKENS = ("", "pg_catalog", "public", "extensions", "pg_temp")
_TRUSTED_SEARCH_PATH_SQL_TOKEN = r'(""|pg_catalog|public|extensions|pg_temp)'
_TRUSTED_SEARCH_PATH_SQL_PATTERN = (
    r"^search_path="
    + _TRUSTED_SEARCH_PATH_SQL_TOKEN
    + r"([[:space:]]*,[[:space:]]*"
    + _TRUSTED_SEARCH_PATH_SQL_TOKEN
    + r")*$"
)
_FUNCTION_OPERATION_START = re.compile(r"(?is)\b(?:ALTER|DROP)\s+FUNCTION\b")
_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_REMOTE_DOCKER_ENV = ("DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH", "DOCKER_CONFIG", "COMPOSE_PROJECT_NAME", "COMPOSE_FILE", "DATABASE_URL", "SUPABASE_URL", "PGHOST")
DOCKER_SOCKET_ADMISSION_ENV = "TZUDONG_DOCKER_SOCKET_ADMISSION_FILE"
GITHUB_ACTIONS_REPOSITORY = "twoimo/tzudong"
_GITHUB_ACTIONS_ADMISSION_PATH = re.compile(
    r"^/run/tzudong-nightly-local-admission-([1-9][0-9]*)-([1-9][0-9]*)$"
)
LOCAL_STACK_GENERATOR_VERSION = "local-stack-v1"
LOCAL_ENV_PROVENANCE_SCHEMA = "local-stack-env-provenance-v1"
LOCAL_INPUT_PROVENANCE_SCHEMA = "local-stack-input-provenance-v2"
LOCAL_STACK_RECEIPT_SCHEMA = "local-stack-receipt-v1"
LOCAL_STACK_COMPOSE_VERSION = "v2.39.4"
LOCAL_STACK_SERVICES = (
    "analytics", "auth", "db", "functions", "imgproxy", "kong", "mail",
    "meta", "realtime", "rest", "storage", "studio", "supavisor", "vector",
)


class RuntimeScanError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode("ascii")


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def repository_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _validated_source_path(path: Path, code: str) -> Path:
    """Validate a declared source file before resolving or reading it."""
    try:
        info = path.lstat()
    except OSError as error:
        raise RuntimeScanError(code) from error
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
        raise RuntimeScanError(code)
    try:
        resolved = path.resolve(strict=True)
    except OSError as error:
        raise RuntimeScanError(code) from error
    return resolved


def source_root() -> Path:
    root = repository_root()
    expected = (root / EXPECTED_SOURCE).resolve(strict=True)
    if expected != root / EXPECTED_SOURCE or not expected.is_dir():
        raise RuntimeScanError("source_root_not_canonical")
    return expected


def local_project_name(root: Path | None = None) -> str:
    root = (root or repository_root()).resolve(strict=True)
    return "tzudong-local-" + _sha256(str(root).encode("utf-8"))[:12]


def _mask_sql(text: str) -> str:
    out: list[str] = []
    i = 0
    while i < len(text):
        if text.startswith("--", i):
            end = text.find("\n", i + 2)
            end = len(text) if end < 0 else end
            out.append("".join("\n" if c == "\n" else " " for c in text[i:end]))
            i = end
        elif text.startswith("/*", i):
            end = text.find("*/", i + 2)
            end = len(text) - 2 if end < 0 else end
            chunk = text[i : end + 2]
            out.append("".join("\n" if c == "\n" else " " for c in chunk))
            i = end + 2
        elif text[i] in ("'", '"'):
            quote = text[i]
            end = i + 1
            while end < len(text):
                if text[end] == quote:
                    if end + 1 < len(text) and text[end + 1] == quote:
                        end += 2
                        continue
                    end += 1
                    break
                end += 1
            chunk = text[i:end]
            out.append("".join("\n" if c == "\n" else " " for c in chunk))
            i = end
        elif text[i] == "$":
            match = re.match(r"\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$", text[i:])
            if match:
                tag = match.group(0)
                end = text.find(tag, i + len(tag))
                end = len(text) - len(tag) if end < 0 else end
                chunk = text[i : end + len(tag)]
                out.append("".join("\n" if c == "\n" else " " for c in chunk))
                i = end + len(tag)
            else:
                out.append(text[i])
                i += 1
        else:
            out.append(text[i])
            i += 1
    return "".join(out)


def _split_top_level(value: str) -> list[str]:
    parts: list[str] = []
    start = 0
    depth = 0
    quote: str | None = None
    i = 0
    while i < len(value):
        char = value[i]
        if quote:
            if char == quote:
                if i + 1 < len(value) and value[i + 1] == quote:
                    i += 2
                    continue
                quote = None
        elif char in ("'", '"'):
            quote = char
        elif char == "(":
            depth += 1
        elif char == ")":
            depth = max(0, depth - 1)
        elif char == "," and depth == 0:
            parts.append(value[start:i].strip())
            start = i + 1
        i += 1
    tail = value[start:].strip()
    if tail:
        parts.append(tail)
    return parts
def _parse_trusted_search_path(value: str) -> list[str]:
    tokens: list[str] = []
    for raw_token in _split_top_level(value):
        token = raw_token.strip()
        if len(token) >= 2 and token[0] == token[-1] and token[0] in {"'", '"'}:
            quote = token[0]
            token = token[1:-1].replace(quote * 2, quote)
        if token not in _TRUSTED_SEARCH_PATH_TOKENS:
            raise RuntimeScanError("search_path_untrusted")
        tokens.append(token)
    if not tokens:
        raise RuntimeScanError("search_path_untrusted")
    return tokens


def _strip_default(value: str) -> str:
    depth = 0
    quote: str | None = None
    for i, char in enumerate(value):
        if quote:
            if char == quote:
                quote = None
            continue
        if char in ("'", '"'):
            quote = char
        elif char == "(":
            depth += 1
        elif char == ")":
            depth = max(0, depth - 1)
        elif depth == 0 and (value[i : i + 7].upper() == "DEFAULT" or value[i : i + 2] == ":="):
            return value[:i].strip()
    return value.strip()
def _normalize_identity_arguments(value: str) -> str:
    """Normalize PostgreSQL identity types while retaining their schema names."""
    normalized: list[str] = []
    for argument in _split_top_level(value):
        item = re.sub(r"\s+", " ", argument).strip()
        # PostgreSQL function identity stores type OIDs, not typmods.  Remove
        # only type modifiers; schema qualification remains part of identity.
        item = re.sub(r"\s*\([^()]*\)", "", item)
        item = re.sub(r"\s*\[\s*\]", "[]", item)
        if not item:
            raise RuntimeScanError("function_arguments_unresolved")
        normalized.append(item)
    return ",".join(normalized)


def _identity_arguments(args: str) -> str:
    """Derive PostgreSQL identity argument types without accepting defaults."""
    known_first = {
        "bigint", "bigserial", "bit", "boolean", "bool", "box", "bytea", "char", "character",
        "cidr", "date", "decimal", "double", "float", "inet", "integer", "interval", "json",
        "jsonb", "line", "lseg", "macaddr", "money", "numeric", "path", "pg_lsn", "point",
        "real", "serial", "smallint", "text", "time", "timestamp", "timetz", "tsquery",
        "tsvector", "uuid", "varbit", "varchar", "void", "xml", "vector",
    }
    types: list[str] = []
    for argument in _split_top_level(args):
        item = _strip_default(argument)
        item = re.sub(r"^(?:INOUT|IN|OUT|VARIADIC)\s+", "", item, flags=re.I)
        words = item.split(None, 1)
        if len(words) > 1 and re.fullmatch(r"[A-Za-z_][A-Za-z0-9_$]*", words[0]) and "." not in words[0] and words[0].lower() not in known_first:
            item = words[1]
        item = re.sub(r"\s+", " ", item).strip()
        if not item:
            raise RuntimeScanError("function_arguments_unresolved")
        types.append(item)
    return ",".join(types)


def _sql_literal(value: str) -> str:
    if "\x00" in value or "'" in value:
        return "'" + value.replace("'", "''") + "'"
    return "'" + value + "'"


def _source_documents() -> list[Path]:
    root = source_root()
    migration_paths = sorted(root.glob("*.sql"), key=lambda item: item.name.encode("utf-8"))
    migration_paths = [
        _validated_source_path(path, "source_file_not_regular")
        for path in migration_paths
    ]
    prerequisite_declared = repository_root() / EXPECTED_PREREQUISITE
    prerequisite = _validated_source_path(prerequisite_declared, "prerequisite_source_invalid")
    if prerequisite != prerequisite_declared:
        raise RuntimeScanError("prerequisite_source_invalid")
    return [*migration_paths, prerequisite]
def _application_schemas(functions: Iterable[dict[str, Any]] | None = None) -> tuple[str, ...]:
    """Derive application schemas from canonical schema/function declarations."""
    schemas = {"public"}
    extension_schemas: set[str] = set()
    for path in _source_documents():
        path = _validated_source_path(path, "source_file_not_regular")
        try:
            text = path.read_bytes().decode("utf-8")
        except (OSError, UnicodeDecodeError) as error:
            raise RuntimeScanError("source_not_utf8") from error
        if _CLOUD_INPUT.search(text):
            raise RuntimeScanError("cloud_input_rejected")
        if _PSQL_META.search(text):
            raise RuntimeScanError("psql_meta_command_rejected")
        masked = _mask_sql(text)
        schemas.update(match.group("name").lower() for match in _CREATE_SCHEMA.finditer(masked))
        extension_schemas.update(match.group("name").lower() for match in _CREATE_EXTENSION_SCHEMA.finditer(masked))
    if functions is not None:
        schemas.update(str(function["schema"]).lower() for function in functions)
    schemas.difference_update(_SYSTEM_SCHEMAS)
    schemas.difference_update(extension_schemas)
    return tuple(sorted(schemas, key=lambda value: value.encode("utf-8")))


def _source_inventory() -> list[dict[str, Any]]:
    functions: list[dict[str, Any]] = []
    for document_index, path in enumerate(_source_documents()):
        path = _validated_source_path(path, "source_file_not_regular")
        data = path.read_bytes()
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError as error:
            raise RuntimeScanError("source_not_utf8") from error
        if _CLOUD_INPUT.search(text):
            raise RuntimeScanError("cloud_input_rejected")
        if _PSQL_META.search(text):
            raise RuntimeScanError("psql_meta_command_rejected")
        masked = _mask_sql(text)
        starts = list(_FUNCTION_START.finditer(masked))
        for index, match in enumerate(starts):
            opening = match.end() - 1
            depth = 1
            closing = opening + 1
            while closing < len(masked) and depth:
                if masked[closing] == "(":
                    depth += 1
                elif masked[closing] == ")":
                    depth -= 1
                closing += 1
            if depth:
                raise RuntimeScanError("function_arguments_unresolved")
            closing -= 1
            next_start = starts[index + 1].start() if index + 1 < len(starts) else len(text)
            name = re.sub(r"\s+", " ", match.group("name")).strip()
            args = re.sub(r"\s+", " ", text[opening + 1 : closing]).strip()
            body = text[closing + 1 : next_start]
            declaration = re.split(r"\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$", body, maxsplit=1)[0]
            search = _SEARCH_PATH.search(declaration)
            search_value = search.group(1).strip() if search else None
            if search_value is not None:
                search_value = re.split(r"\b(?:AS|LANGUAGE|SECURITY|IMMUTABLE|STABLE|VOLATILE|CALLED|RETURNS)\b", search_value, maxsplit=1, flags=re.I)[0].strip()
            functions.append(
                {
                    "path": str(path.relative_to(repository_root())).replace(os.sep, "/"),
                    "name": name,
                    "schema": name.split(".", 1)[0] if "." in name else "public",
                    "proname": name.rsplit(".", 1)[-1],
                    "args": args,
                    "identityArguments": _identity_arguments(args),
                    "signature": name + "(" + args + ")",
                    "body": body,
                    "searchPath": search_value,
                    "hasSearchPath": search is not None,
                    "_sourceOrder": (document_index, match.start()),
                }
            )
    return functions


def _balanced_close(text: str, opening: int) -> int:
    depth = 1
    index = opening + 1
    while index < len(text) and depth:
        if text[index] == "(":
            depth += 1
        elif text[index] == ")":
            depth -= 1
        index += 1
    if depth:
        raise RuntimeScanError("function_arguments_unresolved")
    return index - 1


def _source_function_lifecycle() -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for document_index, path in enumerate(_source_documents()):
        path = _validated_source_path(path, "source_file_not_regular")
        try:
            text = path.read_bytes().decode("utf-8")
        except (OSError, UnicodeDecodeError) as error:
            raise RuntimeScanError("source_not_utf8") from error
        masked = _mask_sql(text)
        for match in _FUNCTION_OPERATION_START.finditer(masked):
            operation = match.group(0).split()[0].upper()
            cursor = match.end()
            if operation == "DROP":
                optional_exists = re.match(r"\s+IF\s+EXISTS\b", masked[cursor:], flags=re.I)
                if optional_exists:
                    cursor += optional_exists.end()
            name_match = re.match(
                r"\s*(?P<name>(?:[A-Za-z_][A-Za-z0-9_$]*\.)?[A-Za-z_][A-Za-z0-9_$]*)\s*",
                masked[cursor:],
            )
            if name_match is None:
                raise RuntimeScanError("function_reference_unresolved")
            name = name_match.group("name")
            cursor += name_match.end()
            opening = masked.find("(", cursor)
            if opening < 0:
                raise RuntimeScanError("function_reference_unresolved")
            closing = _balanced_close(masked, opening)
            args = masked[opening + 1 : closing]
            identity = _normalize_identity_arguments(_identity_arguments(args))
            schema, proname = name.rsplit(".", 1) if "." in name else ("public", name)
            key = (schema, proname, identity)
            statement_end = masked.find(";", closing + 1)
            if statement_end < 0:
                raise RuntimeScanError("function_reference_unresolved")
            tail = masked[closing + 1 : statement_end]
            event: dict[str, Any] = {
                "order": (document_index, match.start()),
                "key": key,
                "action": operation.lower(),
            }
            if operation == "ALTER":
                schema_match = re.search(
                    r"(?is)\bSET\s+SCHEMA\s+(?P<schema>[A-Za-z_][A-Za-z0-9_$]*)\b",
                    tail,
                )
                rename_match = re.search(
                    r"(?is)\bRENAME\s+TO\s+(?P<name>[A-Za-z_][A-Za-z0-9_$]*)\b",
                    tail,
                )
                if schema_match:
                    event["action"] = "move"
                    event["newKey"] = (schema_match.group("schema"), proname, identity)
                elif rename_match:
                    event["action"] = "move"
                    event["newKey"] = (schema, rename_match.group("name"), identity)
                else:
                    continue
            elif operation != "DROP":
                continue
            events.append(event)
    return events


def _source_manifest() -> dict[str, Any]:
    files: list[dict[str, Any]] = []
    for path in _source_documents():
        path = _validated_source_path(path, "source_file_not_regular")
        data = path.read_bytes()
        files.append({
            "path": str(path.relative_to(repository_root())).replace(os.sep, "/"),
            "byteLength": len(data),
            "sha256": _sha256(data),
        })
    chain = b"".join(item["path"].encode() + b"\0" + item["sha256"].encode() + b"\n" for item in files)
    migration_count = sum(item["path"].startswith(EXPECTED_SOURCE.as_posix() + "/") for item in files)
    manifest = {
        "root": EXPECTED_SOURCE.as_posix(),
        "additionalRoots": [EXPECTED_PREREQUISITE.as_posix()],
        "migrationCount": migration_count,
        "sourceFileCount": len(files),
        "files": files,
        "chainSha256": _sha256(chain),
    }
    manifest["manifestSha256"] = _sha256(canonical_json(manifest))
    return manifest


def _trusted_extension_manifest_sha256() -> str:
    return _sha256(canonical_json([{"name": name, "schema": schema} for name, schema in TRUSTED_EXTENSIONS]))


def _tool_sha256() -> str:
    try:
        return _sha256(Path(__file__).read_bytes())
    except OSError as error:
        raise RuntimeScanError("tool_hash_unavailable") from error


def _candidate_functions(functions: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    unique: dict[tuple[str, str], dict[str, Any]] = {}
    lifecycle = _source_function_lifecycle()
    for function in functions:
        if str(function["schema"]).lower() in _SYSTEM_SCHEMAS:
            continue
        current_key = (
            str(function["schema"]),
            str(function["proname"]),
            str(function["identityArguments"]),
        )
        retired = False
        source_order = tuple(function.get("_sourceOrder", (0, 0)))
        for event in lifecycle:
            if tuple(event["order"]) <= source_order or tuple(event["key"]) != current_key:
                continue
            if event["action"] == "drop":
                retired = True
                break
            current_key = tuple(event["newKey"])
        if retired:
            continue
        final_schema, final_proname, final_identity = current_key
        search = function["searchPath"]
        if search is None:
            desired = "public, extensions, pg_catalog"
            reason = "missing_search_path"
        else:
            if "extensions." not in function["body"]:
                continue
            tokens = _parse_trusted_search_path(search)
            if not any(tokens):
                continue
            if "extensions" in tokens:
                continue
            tokens.append("extensions")
            desired = ", ".join(dict.fromkeys(token for token in tokens if token))
            # This is a source/runtime resolution candidate, not authority to
            # widen an already valid runtime path.  The generated patch below
            # changes only a runtime identity with no search_path setting.
            reason = "trusted_extension_omitted"
        key = (final_schema + "." + final_proname, final_identity)
        unique[key] = {
            "name": final_schema + "." + final_proname,
            "schema": final_schema,
            "proname": final_proname,
            "identityArguments": final_identity,
            "identityArgumentsNormalized": _normalize_identity_arguments(final_identity),
            "signature": final_schema + "." + final_proname + "(" + function["args"] + ")",
            "desiredSearchPath": desired,
            "reason": reason,
        }
    return [unique[key] for key in sorted(unique)]


def scan_source() -> dict[str, Any]:
    functions = _source_inventory()
    signatures = sorted(item["signature"] for item in functions)
    missing = sorted(item["signature"] for item in functions if not item["hasSearchPath"])
    return {
        "schemaVersion": SCHEMA_VERSION,
        "mode": "source",
        "sourceRoot": EXPECTED_SOURCE.as_posix(),
        "migrationFileCount": _source_manifest()["migrationCount"],
        "sourceFileCount": _source_manifest()["sourceFileCount"],
        "functionCount": len(signatures),
        "localSearchPathCount": len(signatures) - len(missing),
        "missingLocalSearchPathCount": len(missing),
        "signatureSetSha256": _sha256("\n".join(signatures).encode("utf-8")),
        "missingSignatureSetSha256": _sha256("\n".join(missing).encode("utf-8")),
        "sourceManifestSha256": _source_manifest()["manifestSha256"],
        "trustedExtensionManifestSha256": _trusted_extension_manifest_sha256(),
        "closureCandidates": len(_candidate_functions(functions)),
        "closureSmoke": {"status": "not_run", "reason": "database_not_requested"},
    }


def _identity_oid_array_sql(identity_arguments: str) -> str:
    if not identity_arguments:
        return "ARRAY[]::oid[]"
    return (
        "ARRAY("
        "SELECT pg_catalog.to_regtype(pg_catalog.btrim(argument))::oid "
        "FROM pg_catalog.unnest(pg_catalog.string_to_array("
        + _sql_literal(identity_arguments)
        + ", ',')) WITH ORDINALITY AS arguments(argument, ordinal) "
        "ORDER BY ordinal)"
    )
def _identity_condition_sql(identity_arguments: str) -> str:
    if not identity_arguments:
        return "p.pronargs = 0"
    return (
        "array_to_string(p.proargtypes::oid[], ',') = array_to_string("
        + _identity_oid_array_sql(identity_arguments)
        + ", ',')"
    )

def _patch_sql(
    source_manifest_sha256: str,
    candidates: list[dict[str, Any]],
    tool_sha256: str,
    patch_sha256: str | None = None,
) -> str:
    metadata = {
        "schemaVersion": PATCH_SCHEMA,
        "sourceManifestSha256": source_manifest_sha256,
        "toolSha256": tool_sha256,
        "trustedExtensionManifestSha256": _trusted_extension_manifest_sha256(),
        "candidateSetSha256": _sha256(canonical_json(candidates)),
        "candidateCount": len(candidates),
    }
    if patch_sha256 is not None:
        metadata["patchSha256"] = patch_sha256
    lines = ["-- local-function-closure-patch-v1", "-- metadata: " + canonical_json(metadata).decode("ascii"), "BEGIN;"]
    lines.extend(
        [
            "DO $local_function_closure_path_guard$",
            "DECLARE duplicate_path_count integer;",
            "BEGIN",
            "  SELECT count(*) FILTER (WHERE setting ~* '" + _TRUSTED_SEARCH_PATH_SQL_PATTERN + "')::integer",
            "    INTO duplicate_path_count",
            "    FROM pg_catalog.unnest(ARRAY['search_path=\"\"','search_path=public']::text[]) AS setting;",
            "  IF NOT ('search_path=\"\"' ~* '" + _TRUSTED_SEARCH_PATH_SQL_PATTERN + "')",
            "     OR NOT ('search_path=public, extensions' ~* '" + _TRUSTED_SEARCH_PATH_SQL_PATTERN + "')",
            "     OR 'search_path=auth' ~* '" + _TRUSTED_SEARCH_PATH_SQL_PATTERN + "'",
            "     OR duplicate_path_count <> 2 THEN",
            "    RAISE EXCEPTION 'local_closure_runtime_path_guard_invalid';",
            "  END IF;",
            "END $local_function_closure_path_guard$;",
        ]
    )
    for candidate in candidates:
        lines.extend(
            [
                "DO $local_function_closure$",
                "DECLARE target_oid oid; target_count integer; target_path_count integer; target_valid_path_count integer;",
                "BEGIN",
                "  SELECT count(*)::integer, min(p.oid) INTO target_count, target_oid",
                "    FROM pg_catalog.pg_proc AS p",
                "    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace",
                "   WHERE n.nspname = " + _sql_literal(candidate["schema"]) + "",
                "     AND p.proname = " + _sql_literal(candidate["proname"]) + "",
                "     AND p.prokind IN ('f', 'p')",
                "     AND " + _identity_condition_sql(candidate["identityArgumentsNormalized"]) + "",
                "     AND NOT EXISTS (",
                "       SELECT 1 FROM pg_catalog.pg_depend AS dependency",
                "        WHERE dependency.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass",
                "          AND dependency.objid = p.oid",
                "          AND dependency.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass",
                "          AND dependency.deptype = 'e'",
                "     );",
                "  IF target_count = 0 THEN RAISE EXCEPTION 'local_closure_missing'; END IF;",
                "  IF target_count > 1 THEN RAISE EXCEPTION 'local_closure_ambiguous'; END IF;",
                "  SELECT count(*) FILTER (WHERE setting.value ~* '^search_path=')::integer,",
                "         count(*) FILTER (WHERE setting.value ~* '" + _TRUSTED_SEARCH_PATH_SQL_PATTERN + "')::integer",
                "    INTO target_path_count, target_valid_path_count",
                "    FROM pg_catalog.pg_proc AS procedure",
                "    LEFT JOIN LATERAL pg_catalog.unnest(COALESCE(procedure.proconfig, ARRAY[]::text[])) AS setting(value) ON true",
                "   WHERE procedure.oid = target_oid;",
                "  IF target_path_count = 0 OR target_valid_path_count <> 1 THEN",
                "    EXECUTE pg_catalog.format('ALTER FUNCTION %s SET search_path TO " + candidate["desiredSearchPath"] + "', target_oid::regprocedure);",
                "  ELSIF target_path_count <> 1 THEN",
                "    RAISE EXCEPTION 'local_closure_runtime_path_invalid';",
                "  END IF;",
                "END $local_function_closure$;",
            ]
        )
    lines.extend(
        [
            "DO $local_function_closure_g014$",
            "BEGIN",
            "  IF pg_catalog.to_regprocedure('privacy_retention.assert_g014_definer_contract()') IS NULL",
            "     OR pg_catalog.to_regprocedure('privacy_retention.assert_g014_catalog_contract()') IS NULL THEN",
            "    RAISE EXCEPTION 'local_closure_g014_contract_missing';",
            "  END IF;",
            "  PERFORM privacy_retention.assert_g014_definer_contract();",
            "  PERFORM privacy_retention.assert_g014_catalog_contract();",
            "END $local_function_closure_g014$;",
        ]
    )
    lines.extend(["COMMIT;", ""])
    return "\n".join(lines)
def _patch_executable_body(data: bytes) -> bytes:
    prefix = b"-- local-function-closure-patch-v1\n"
    if not data.startswith(prefix):
        raise RuntimeScanError("patch_invalid")
    metadata_end = data.find(b"\n", len(prefix))
    if metadata_end < 0:
        raise RuntimeScanError("patch_invalid")
    return data[metadata_end + 1:]


def _patch_body_sha256(data: bytes) -> str:
    return _sha256(_patch_executable_body(data))



def generate_patch() -> tuple[str, dict[str, Any]]:
    functions = _source_inventory()
    manifest = _source_manifest()
    candidates = _candidate_functions(functions)
    tool = _tool_sha256()
    sql = _patch_sql(manifest["manifestSha256"], candidates, tool)
    patch_sha256 = _patch_body_sha256(sql.encode("utf-8"))
    sql = _patch_sql(manifest["manifestSha256"], candidates, tool, patch_sha256)
    metadata_line = next(line for line in sql.splitlines() if line.startswith("-- metadata: "))
    metadata = json.loads(metadata_line.removeprefix("-- metadata: "))
    metadata["sourceFunctionCount"] = len(functions)
    return sql, metadata


def _regular_file(path: Path, *, max_bytes: int = 8 * 1024 * 1024) -> bytes:
    try:
        info = path.lstat()
    except OSError as error:
        raise RuntimeScanError("patch_missing") from error
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_size > max_bytes:
        raise RuntimeScanError("patch_invalid")
    try:
        return path.read_bytes()
    except OSError as error:
        raise RuntimeScanError("patch_read_failed") from error


def _read_patch(path: Path) -> tuple[str, dict[str, Any]]:
    data = _regular_file(path)
    try:
        sql = data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise RuntimeScanError("patch_not_utf8") from error
    if _CLOUD_INPUT.search(sql):
        raise RuntimeScanError("cloud_input_rejected")
    if _PSQL_META.search(sql):
        raise RuntimeScanError("psql_meta_command_rejected")
    if not sql.startswith("-- local-function-closure-patch-v1\n") or "\nBEGIN;\n" not in sql or not sql.rstrip().endswith("COMMIT;"):
        raise RuntimeScanError("patch_invalid")
    try:
        line = next(line for line in sql.splitlines() if line.startswith("-- metadata: "))
        metadata = json.loads(line.removeprefix("-- metadata: "))
    except (StopIteration, json.JSONDecodeError) as error:
        raise RuntimeScanError("patch_metadata_invalid") from error
    if metadata.get("schemaVersion") != PATCH_SCHEMA:
        raise RuntimeScanError("patch_metadata_invalid")
    for key in (
        "sourceManifestSha256",
        "toolSha256",
        "trustedExtensionManifestSha256",
        "candidateSetSha256",
        "patchSha256",
    ):
        if not isinstance(metadata.get(key), str) or not _HEX64.fullmatch(metadata[key]):
            raise RuntimeScanError("patch_metadata_invalid")
    if metadata["patchSha256"] != _patch_body_sha256(data):
        raise RuntimeScanError("patch_body_drift")
    try:
        expected_sql, _ = generate_patch()
        expected_data = expected_sql.encode("utf-8")
        supplied_body = _patch_executable_body(data)
        expected_body = _patch_executable_body(expected_data)
    except RuntimeScanError:
        raise
    except (OSError, UnicodeError, ValueError, TypeError) as error:
        raise RuntimeScanError("patch_canonical_generation_failed") from error
    if (
        _patch_body_sha256(data) != _patch_body_sha256(expected_data)
        or not hmac.compare_digest(supplied_body, expected_body)
    ):
        raise RuntimeScanError("patch_body_drift")
    expected_line = next(line for line in expected_sql.splitlines() if line.startswith("-- metadata: "))
    expected_metadata = json.loads(expected_line.removeprefix("-- metadata: "))
    for key in (
        "schemaVersion",
        "sourceManifestSha256",
        "toolSha256",
        "trustedExtensionManifestSha256",
        "candidateSetSha256",
        "candidateCount",
        "patchSha256",
    ):
        if metadata.get(key) != expected_metadata.get(key):
            raise RuntimeScanError("patch_metadata_drift")
    return sql, metadata


def _filtered_environment() -> dict[str, str]:
    keep = {"PATH", "HOME", "USER", "TMPDIR", "LANG", "LC_ALL", "TERM"}
    result = {key: value for key, value in os.environ.items() if key in keep}
    result.setdefault("PATH", "/usr/bin:/bin")
    result.setdefault("HOME", str(Path.home()))
    return result


def _github_actions_root_socket_admission() -> bool:
    admission_value = os.environ.get(DOCKER_SOCKET_ADMISSION_ENV, "")
    repository = os.environ.get("GITHUB_REPOSITORY", "")
    run_id = os.environ.get("GITHUB_RUN_ID", "")
    run_attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "")
    if (
        os.environ.get("GITHUB_ACTIONS") != "true"
        or os.environ.get("CI") != "true"
        or repository != GITHUB_ACTIONS_REPOSITORY
        or re.fullmatch(r"[1-9][0-9]*", run_id) is None
        or re.fullmatch(r"[1-9][0-9]*", run_attempt) is None
    ):
        return False
    match = _GITHUB_ACTIONS_ADMISSION_PATH.fullmatch(admission_value)
    if (
        match is None
        or match.groups() != (run_id, run_attempt)
        or admission_value
        != f"/run/tzudong-nightly-local-admission-{run_id}-{run_attempt}"
    ):
        return False
    admission_path = Path(admission_value)
    try:
        info = admission_path.lstat()
    except OSError:
        return False
    try:
        read_result = subprocess.run(
            ["/usr/bin/sudo", "-n", "--", "/bin/cat", admission_value],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=5,
            check=False,
            env={"PATH": "/usr/bin:/bin", "LANG": "C"},
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    payload = read_result.stdout
    expected = (
        f"repo={repository}\n"
        f"run_id={run_id}\n"
        f"run_attempt={run_attempt}\n"
    ).encode("ascii")
    return (
        not stat.S_ISLNK(info.st_mode)
        and stat.S_ISREG(info.st_mode)
        and info.st_uid == 0
        and stat.S_IMODE(info.st_mode) == 0o400
        and read_result.returncode == 0
        and len(payload) <= 256
        and payload == expected
    )


def _github_actions_root_owned_socket(path: Path, owner: int) -> bool:
    return (
        path == Path("/var/run/docker.sock")
        and owner == 0
        and _github_actions_root_socket_admission()
    )


def _assert_local_docker_context(docker: str) -> None:
    environment = _filtered_environment()
    try:
        selected = subprocess.run(
            [docker, "context", "show"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
            env=environment,
        )
        context = selected.stdout.strip()
        if selected.returncode != 0 or not context or any(char in context for char in "\r\n\t "):
            raise RuntimeScanError("docker_context")
        inspected = subprocess.run(
            [docker, "context", "inspect", context],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
            env=environment,
        )
        payload = json.loads(inspected.stdout)
        endpoint = payload[0]["Endpoints"]["docker"]["Host"] if payload else None
    except (OSError, subprocess.TimeoutExpired, ValueError, TypeError, KeyError, IndexError) as error:
        raise RuntimeScanError("docker_context") from error
    if inspected.returncode != 0 or not endpoint:
        raise RuntimeScanError("docker_context")
    parsed = urlparse(str(endpoint))
    if parsed.scheme != "unix" or parsed.netloc or parsed.params or parsed.query or parsed.fragment:
        raise RuntimeScanError("docker_context")
    socket_path = Path(parsed.path)
    allowed = {
        Path("/var/run/docker.sock"),
        Path.home() / ".docker" / "run" / "docker.sock",
        Path.home() / ".colima" / "default" / "docker.sock",
    }
    if socket_path not in allowed:
        raise RuntimeScanError("docker_context")
    try:
        info = socket_path.lstat()
    except OSError as error:
        raise RuntimeScanError("docker_context") from error
    owned_by_current_user = info.st_uid == os.getuid()
    owned_by_disposable_ci_root = _github_actions_root_owned_socket(socket_path, info.st_uid)
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISSOCK(info.st_mode)
        or not (owned_by_current_user or owned_by_disposable_ci_root)
    ):
        raise RuntimeScanError("docker_context")
def _validate_endpoint_environment() -> None:
    if any(os.environ.get(key) for key in _REMOTE_DOCKER_ENV):
        raise RuntimeScanError("docker_endpoint_override")


def _load_local_contract_module(filename: str, module_name: str) -> Any:
    path = repository_root() / "backend" / "supabase" / "scripts" / filename
    try:
        info = path.lstat()
    except OSError as error:
        raise RuntimeScanError("local_contract_missing") from error
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
        raise RuntimeScanError("local_contract_invalid")
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeScanError("local_contract_invalid")
    module = importlib.util.module_from_spec(spec)
    sys.modules.setdefault(module_name, module)
    try:
        spec.loader.exec_module(module)
    except Exception as error:
        raise RuntimeScanError("local_contract_invalid") from error
    return module


def _local_state_dir(root: Path, project: str) -> Path:
    parent = root / "backend" / "supabase" / "volumes" / ".local-stack"
    try:
        parent_info = parent.lstat()
    except OSError as error:
        raise RuntimeScanError("local_state_root") from error
    if (
        stat.S_ISLNK(parent_info.st_mode)
        or not stat.S_ISDIR(parent_info.st_mode)
        or parent_info.st_uid != os.getuid()
        or stat.S_IMODE(parent_info.st_mode) != 0o700
    ):
        raise RuntimeScanError("local_state_root")
    state = parent / project
    try:
        state_info = state.lstat()
        resolved = state.resolve(strict=True)
        parent_resolved = parent.resolve(strict=True)
    except OSError as error:
        raise RuntimeScanError("local_state_missing") from error
    if (
        stat.S_ISLNK(state_info.st_mode)
        or not stat.S_ISDIR(state_info.st_mode)
        or state_info.st_uid != os.getuid()
        or stat.S_IMODE(state_info.st_mode) != 0o700
        or resolved != parent_resolved / project
        or resolved.parent != parent_resolved
        or resolved == root.resolve()
    ):
        raise RuntimeScanError("local_state_root")
    return resolved


def _read_state_json(path: Path, code: str) -> dict[str, Any]:
    try:
        info = path.lstat()
        if (
            stat.S_ISLNK(info.st_mode)
            or not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) != 0o600
        ):
            raise RuntimeScanError(code)
        value = json.loads(path.read_text(encoding="utf-8"))
    except RuntimeScanError:
        raise
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeScanError(code) from error
    if not isinstance(value, dict):
        raise RuntimeScanError(code)
    return value


def _validate_local_stack_state(
    root: Path,
    project: str,
    docker: str,
    database: str,
    container: str | None,
    timeout: float,
) -> tuple[Path, dict[str, str], dict[str, str], dict[str, Any]]:
    state = _local_state_dir(root, project)
    migrate = _load_local_contract_module("local-migrate.py", "_tzudong_local_migrate_contract")
    try:
        executor = migrate.PsqlExecutor(
            docker,
            container or "",
            database,
            timeout,
            project=project,
            state_dir=state,
        )
        bound_project, bound_state, values = executor._binding()
    except Exception as error:
        raise RuntimeScanError("local_state_provenance") from error
    if bound_project != project or bound_state != state:
        raise RuntimeScanError("local_state_provenance")
    try:
        current = migrate._current_source_bindings()
        generated = migrate._generated_input_evidence(state, project)
    except Exception as error:
        raise RuntimeScanError("local_source_binding") from error
    for key in (
        "input_source_manifest_sha256",
        "input_evidence_sha256",
        "compose_evidence_sha256",
        "function_source_sha256",
    ):
        if generated.get(key) != current.get(key):
            raise RuntimeScanError("local_input_binding")
    receipt = _read_state_json(state / "last-receipt.json", "local_state_provenance")
    if (
        receipt.get("schema") != LOCAL_STACK_RECEIPT_SCHEMA
        or receipt.get("action") not in {"start", "reset", "status"}
        or receipt.get("ok") is not True
        or receipt.get("project_name") != project
        or receipt.get("renderer") not in {LOCAL_STACK_COMPOSE_VERSION, LOCAL_STACK_COMPOSE_VERSION.removeprefix("v")}
        or receipt.get("generator_version") != LOCAL_STACK_GENERATOR_VERSION
        or any(
            not isinstance(receipt.get(key), str) or not _HEX64.fullmatch(receipt[key])
            for key in ("config_sha256", "input_provenance_sha256", "env_provenance_sha256")
        )
        or receipt.get("input_provenance_sha256") != _sha256((state / "stack.inputs.provenance.json").read_bytes())
        or receipt.get("env_provenance_sha256") != _sha256((state / "stack.env.provenance.json").read_bytes())
    ):
        raise RuntimeScanError("local_state_provenance")
    services = receipt.get("services")
    if (
        not isinstance(services, list)
        or len(services) != len(LOCAL_STACK_SERVICES)
        or {item.get("service") for item in services if isinstance(item, dict)} != set(LOCAL_STACK_SERVICES)
        or any(not isinstance(item, dict) for item in services)
    ):
        raise RuntimeScanError("local_stack_receipt")
    db_receipt = next(item for item in services if item.get("service") == "db")
    if db_receipt.get("state") != "running":
        raise RuntimeScanError("local_stack_stale")
    return state, values, current, receipt


def _expected_database_mounts(root: Path, state: Path) -> set[tuple[str, str, str]]:
    input_root = state / "inputs"
    try:
        input_info = input_root.lstat()
    except OSError as error:
        raise RuntimeScanError("local_input_binding") from error
    if (
        stat.S_ISLNK(input_info.st_mode)
        or not stat.S_ISDIR(input_info.st_mode)
        or input_info.st_uid != os.getuid()
        or stat.S_IMODE(input_info.st_mode) != 0o700
    ):
        raise RuntimeScanError("local_input_binding")


    path = root / "backend" / "supabase" / "local-inputs" / "manifest.v1.json"
    try:
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid():
            raise RuntimeScanError("local_input_manifest")
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except RuntimeScanError:
        raise
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeScanError("local_input_manifest") from error
    if (
        not isinstance(manifest, dict)
        or manifest.get("schema") != "local-stack-input-manifest-v1"
        or manifest.get("generator_version") != LOCAL_STACK_GENERATOR_VERSION
        or not isinstance(manifest.get("inputs"), list)
        or not isinstance(manifest.get("mounts"), list)
    ):
        raise RuntimeScanError("local_input_manifest")
    for mount in manifest.get("mounts", []):
        if not isinstance(mount, dict) or mount.get("service") != "db":
            continue
        source, destination = mount.get("source"), mount.get("destination")
        if (
            mount.get("type") != "volume"
            or not isinstance(source, str)
            or not source.startswith("local-")
            or not isinstance(destination, str)
        ):
            raise RuntimeScanError("local_input_manifest")
    mounts: set[tuple[str, str, str]] = set()
    project = local_project_name(root)
    for mount in manifest["mounts"]:
        if not isinstance(mount, dict) or mount.get("service") != "db":
            continue
        source = mount["source"]
        destination = mount["destination"]
        mounts.add(("volume", destination, f"{project}-{source.removeprefix('local-')}"))
    for entry in manifest["inputs"]:
        if not isinstance(entry, dict) or entry.get("service") != "db":
            continue
        output, destination = entry.get("output"), entry.get("destination")
        if (
            not isinstance(output, str)
            or not isinstance(destination, str)
            or Path(output).is_absolute()
            or ".." in Path(output).parts
        ):
            raise RuntimeScanError("local_input_manifest")
        output_path = state / "inputs" / output
        try:
            output_info = output_path.lstat()
            output_resolved = output_path.resolve(strict=True)
        except OSError as error:
            raise RuntimeScanError("local_input_binding") from error
        if (
            stat.S_ISLNK(output_info.st_mode)
            or not stat.S_ISREG(output_info.st_mode)
            or output_info.st_uid != os.getuid()
            or stat.S_IMODE(output_info.st_mode) != 0o600
            or output_resolved.parent != (state / "inputs").resolve()
        ):
            raise RuntimeScanError("local_input_binding")
    if not mounts:
        raise RuntimeScanError("local_input_manifest")
    return mounts


def _current_stack_config_sha256(
    root: Path,
    project: str,
    state: Path,
    values: Mapping[str, str],
    docker: str,
    timeout: float,
) -> str:
    stack = _load_local_contract_module("local-stack.py", "_tzudong_local_stack_contract")
    try:
        manifest = _read_state_json(state / "stack.inputs.provenance.json", "local_state_provenance")
        files = stack._compose_files(root)
        command = [
            docker,
            "compose",
            "--project-name",
            project,
            "--env-file",
            str(state / "stack.env"),
        ]
        for path in files:
            command.extend(["-f", str(path)])
        command.extend(["config", "--format", "json"])
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            env=_filtered_environment(),
        )
        if result.returncode != 0:
            raise RuntimeScanError("local_stack_config")
        model = json.loads(result.stdout)
        digest = stack._scan_model(model, project, state, dict(values), manifest)
    except RuntimeScanError:
        raise
    except (OSError, subprocess.TimeoutExpired, UnicodeDecodeError, ValueError, TypeError, KeyError) as error:
        raise RuntimeScanError("local_stack_config") from error
    except Exception as error:
        raise RuntimeScanError("local_stack_config") from error
    if not isinstance(digest, str) or not _HEX64.fullmatch(digest):
        raise RuntimeScanError("local_stack_config")
    return digest
class LocalPsql:
    def __init__(self, docker: str, container: str | None, database: str, timeout: float = 60.0, root: Path | None = None) -> None:
        self.docker, self.container, self.database, self.timeout = docker, container, database, timeout
        self.root = (root or repository_root()).resolve(strict=True)
        self.project = local_project_name(self.root)

    def _run(self, command: list[str], *, input_bytes: bytes | None = None, timeout: float | None = None) -> subprocess.CompletedProcess[bytes]:
        try:
            return subprocess.run(
                command,
                input=input_bytes,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=timeout or self.timeout,
                env=_filtered_environment(),
            )
        except subprocess.TimeoutExpired as error:
            raise RuntimeScanError("docker_timeout") from error
        except OSError as error:
            raise RuntimeScanError("docker_unavailable") from error

    def _validate(self) -> None:
        _validate_endpoint_environment()
        if self.container and (any(c.isspace() for c in self.container) or "/" in self.container):
            raise RuntimeScanError("container_invalid")
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", self.database):
            raise RuntimeScanError("database_invalid")
        state, values, _, receipt = _validate_local_stack_state(
            self.root, self.project, self.docker, self.database, self.container, self.timeout
        )
        self._expected_mounts = _expected_database_mounts(self.root, state)
        _assert_local_docker_context(self.docker)
        if not shutil.which(self.docker) and not Path(self.docker).is_file():
            raise RuntimeScanError("docker_unavailable")
        if receipt["config_sha256"] != _current_stack_config_sha256(
            self.root, self.project, state, values, self.docker, self.timeout
        ):
            raise RuntimeScanError("local_stack_stale")
        listing = self._run(
            [self.docker, "ps", "--all", "--filter", "label=com.docker.compose.project=" + self.project, "--filter", "label=com.docker.compose.service=db", "--format", "{{.ID}}\t{{.Names}}"],
            timeout=10,
        )
        if listing.returncode != 0:
            raise RuntimeScanError("docker_list_failed")
        rows = [line.split("\t", 1) for line in listing.stdout.decode("utf-8", "strict").splitlines() if line.strip()]
        if len(rows) != 1 or len(rows[0]) != 2 or not rows[0][0]:
            raise RuntimeScanError("local_db_container_ambiguous")
        discovered_id, discovered_name = rows[0]
        if discovered_name != f"{self.project}-db-1":
            raise RuntimeScanError("container_not_canonical_local_db")
        if self.container and self.container not in {discovered_id, discovered_name}:
            raise RuntimeScanError("container_not_repository_db")
        self.container = discovered_id
        inspected = self._run([self.docker, "inspect", "--format", "{{json .}}", discovered_id], timeout=10)
        if inspected.returncode != 0:
            raise RuntimeScanError("docker_inspect_failed")
        try:
            payload = json.loads(inspected.stdout.decode("utf-8"))
            item = payload[0] if isinstance(payload, list) else payload
            labels = item["Config"]["Labels"] or {}
            network = item.get("HostConfig", {}).get("NetworkMode")
            item_name = str(item.get("Name", "")).rstrip("/").split("/")[-1]
            mounts = item.get("Mounts")
        except (ValueError, IndexError, KeyError, TypeError, UnicodeDecodeError) as error:
            raise RuntimeScanError("container_metadata_invalid") from error
        if (
            labels.get("com.docker.compose.project") != self.project
            or labels.get("com.docker.compose.service") != "db"
            or labels.get("com.docker.compose.container-number") != "1"
            or item_name != f"{self.project}-db-1"
            or network in {"host", "container"}
        ):
            raise RuntimeScanError("container_not_local_compose")
        config_files = labels.get("com.docker.compose.project.config_files")
        expected_files = {
            str(self.root / "backend" / "supabase" / name)
            for name in ("docker-compose.yml", "docker-compose.local.yml", "docker-compose.mail.yml")
        }
        if not config_files or set(config_files.split(",")) != expected_files:
            raise RuntimeScanError("container_compose_config_mismatch")
        expected_dir = str((self.root / "backend" / "supabase").resolve())
        working_dir = labels.get("com.docker.compose.project.working_dir")
        if not working_dir or Path(working_dir).resolve() != Path(expected_dir):
            raise RuntimeScanError("container_not_repository_compose")
        if not isinstance(mounts, list):
            raise RuntimeScanError("container_input_mounts")
        actual_mounts: set[tuple[str, str, str]] = set()
        for mount in mounts:
            if (
                isinstance(mount, dict)
                and mount.get("Type") == "volume"
                and isinstance(mount.get("Destination"), str)
                and isinstance(mount.get("Name"), str)
            ):
                actual_mounts.add(("volume", mount["Destination"], mount["Name"]))
        if not self._expected_mounts.issubset(actual_mounts):
            raise RuntimeScanError("container_input_mounts")

    def _psql_command(self) -> list[str]:
        return [
            self.docker,
            "exec",
            "--interactive",
            self.container or "",
            "psql",
            "-X",
            "--no-password",
            "--quiet",
            "--no-align",
            "--tuples-only",
            "--username",
            "supabase_admin",
            "--set",
            "ON_ERROR_STOP=1",
            "--dbname",
            self.database,
        ]

    def _admit_database(self, expected_closure_binding: str | None = None) -> None:
        bindings = _current_migration_bindings()
        result = self._run(
            self._psql_command(),
            input_bytes=_migration_admission_sql(bindings),
        )
        if result.returncode != 0:
            raise RuntimeScanError("local_migration_binding")
        try:
            values = [json.loads(line) for line in result.stdout.decode("utf-8").splitlines() if line.strip()]
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise RuntimeScanError("local_migration_binding") from error
        if len(values) != 1 or not isinstance(values[0], dict):
            raise RuntimeScanError("local_migration_binding")
        _validate_database_admission(values[0], bindings, expected_closure_binding)

    def execute(self, sql: bytes, *, expected_closure_binding: str | None = None) -> None:
        self._validate()
        self._admit_database(expected_closure_binding)
        result = self._run(self._psql_command(), input_bytes=sql)
        if result.returncode == 127:
            raise RuntimeScanError("psql_unavailable")
        if result.returncode < 0 or any(term in result.stderr.decode("utf-8", "ignore").lower() for term in ("disconnect", "connection", "broken pipe", "server closed", "eof")):
            raise RuntimeScanError("closure_patch_ambiguous")
        if result.returncode != 0:
            raise RuntimeScanError("closure_patch_failed")

    def query(self, sql: bytes, *, expected_closure_binding: str | None = None) -> dict[str, Any]:
        self._validate()
        self._admit_database(expected_closure_binding)
        result = self._run(self._psql_command(), input_bytes=sql)
        if result.returncode == 127:
            raise RuntimeScanError("psql_unavailable")
        if result.returncode < 0 or any(term in result.stderr.decode("utf-8", "ignore").lower() for term in ("disconnect", "connection", "broken pipe", "server closed", "eof")):
            raise RuntimeScanError("runtime_scan_ambiguous")
        if result.returncode != 0:
            raise RuntimeScanError("runtime_scan_failed")
        try:
            values = [json.loads(line) for line in result.stdout.decode("utf-8").splitlines() if line.strip()]
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise RuntimeScanError("runtime_receipt_invalid") from error
        if not values or any(not isinstance(value, dict) for value in values):
            raise RuntimeScanError("runtime_receipt_invalid")
        merged: dict[str, Any] = {}
        for value in values:
            merged.update(value)
        if merged.get("schemaVersion") != SCHEMA_VERSION and "rpcSmoke" not in merged:
            raise RuntimeScanError("runtime_receipt_invalid")
        return merged


def _current_migration_bindings() -> dict[str, Any]:
    migrate = _load_local_contract_module("local-migrate.py", "_tzudong_local_migrate_manifest")
    try:
        manifest = migrate.verify_manifest()
        source = manifest["source"]
        files = source["files"]
        current = migrate._current_source_bindings()
        manifest_sha256 = migrate.manifest_digest(manifest)
        chain_sha256 = source["chainSha256"]
        prerequisite_sha256 = current["prerequisite_sha256"]
        platform_bootstrap_evidence_sha256 = current.get("platform_bootstrap_evidence_sha256")
        seed_source_sha256 = current.get("seed_source_sha256")
    except Exception as error:
        raise RuntimeScanError("local_source_binding") from error
    if (
        not isinstance(files, list)
        or not isinstance(manifest_sha256, str)
        or not _HEX64.fullmatch(manifest_sha256)
        or not isinstance(chain_sha256, str)
        or not _HEX64.fullmatch(chain_sha256)
        or not isinstance(prerequisite_sha256, str)
        or not _HEX64.fullmatch(prerequisite_sha256)
        or not isinstance(platform_bootstrap_evidence_sha256, str)
        or not _HEX64.fullmatch(platform_bootstrap_evidence_sha256)
        or not isinstance(seed_source_sha256, str)
        or not _HEX64.fullmatch(seed_source_sha256)
    ):
        raise RuntimeScanError("local_source_binding")
    expected_files: list[dict[str, Any]] = []
    for item in files:
        if (
            not isinstance(item, dict)
            or not isinstance(item.get("path"), str)
            or not isinstance(item.get("ordinal"), int)
            or not isinstance(item.get("sha256"), str)
            or not _HEX64.fullmatch(item["sha256"])
            or not isinstance(item.get("byteLength"), int)
            or not isinstance(item.get("transaction"), dict)
            or not isinstance(item["transaction"].get("class"), str)
        ):
            raise RuntimeScanError("local_source_binding")
        expected_files.append(
            {
                "path": item["path"],
                "ordinal": item["ordinal"],
                "sha256": item["sha256"],
                "byteLength": item["byteLength"],
                "transactionClass": item["transaction"]["class"],
            }
        )
    if not expected_files:
        raise RuntimeScanError("local_source_binding")
    return {
        "manifestSha256": manifest_sha256,
        "sourceChainSha256": chain_sha256,
        "prerequisiteSha256": prerequisite_sha256,
        "platformBootstrapEvidenceSha256": platform_bootstrap_evidence_sha256,
        "seedSourceSha256": seed_source_sha256,
        "files": expected_files,
    }


def _migration_admission_sql(bindings: Mapping[str, Any]) -> bytes:
    del bindings
    return b"""BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT jsonb_build_object(
  'ledger', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'migrationId', migration_id,
      'ordinal', ordinal,
      'sourceSha256', source_sha256,
      'sourceByteLength', source_byte_length,
      'transactionClass', transaction_class,
      'status', status
    ) ORDER BY ordinal, migration_id)
      FROM _tzudong_local.migration_ledger
  ), '[]'::jsonb),
  'sequence', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'marker', marker,
      'ordinal', ordinal,
      'evidenceSha256', evidence_sha256,
      'sourceManifestSha256', source_manifest_sha256,
      'closureBindingSha256', COALESCE(closure_binding_sha256, '')
    ) ORDER BY ordinal, marker)
      FROM _tzudong_local.execution_sequence
  ), '[]'::jsonb)
)::text;
COMMIT;
"""


def _validate_database_admission(
    value: dict[str, Any],
    bindings: Mapping[str, Any],
    expected_closure_binding: str | None,
) -> None:
    ledger = value.get("ledger")
    expected_files = bindings.get("files")
    if not isinstance(ledger, list) or not isinstance(expected_files, list) or len(ledger) != len(expected_files):
        raise RuntimeScanError("local_migration_binding")
    for actual, expected in zip(ledger, expected_files):
        if (
            not isinstance(actual, dict)
            or actual.get("migrationId") != expected["path"]
            or actual.get("ordinal") != expected["ordinal"]
            or actual.get("sourceSha256") != expected["sha256"]
            or actual.get("sourceByteLength") != expected["byteLength"]
            or actual.get("transactionClass") != expected["transactionClass"]
            or actual.get("status") != "applied"
        ):
            raise RuntimeScanError("local_migration_binding")
    sequence = value.get("sequence")
    if not isinstance(sequence, list) or len(sequence) not in {2, 3, 4, 5}:
        raise RuntimeScanError("local_sequence_binding")
    manifest_sha256 = bindings.get("manifestSha256")
    chain_sha256 = bindings.get("sourceChainSha256")
    prerequisite_sha256 = bindings.get("prerequisiteSha256")
    platform_bootstrap_evidence_sha256 = bindings.get("platformBootstrapEvidenceSha256")
    seed_source_sha256 = bindings.get("seedSourceSha256")
    if (
        not isinstance(manifest_sha256, str)
        or not _HEX64.fullmatch(manifest_sha256)
        or not isinstance(chain_sha256, str)
        or not _HEX64.fullmatch(chain_sha256)
        or not isinstance(prerequisite_sha256, str)
        or not _HEX64.fullmatch(prerequisite_sha256)
        or not isinstance(platform_bootstrap_evidence_sha256, str)
        or not _HEX64.fullmatch(platform_bootstrap_evidence_sha256)
        or not isinstance(seed_source_sha256, str)
        or not _HEX64.fullmatch(seed_source_sha256)
    ):
        raise RuntimeScanError("local_source_binding")
    expected_ordinals = {
        "prerequisite": 1,
        "migration": 2,
        "closure": 3,
        "platform-bootstrap": 4,
        "seed": 5,
    }
    expected_evidence = {
        "prerequisite": prerequisite_sha256,
        "migration": chain_sha256,
        "platform-bootstrap": platform_bootstrap_evidence_sha256,
        "seed": seed_source_sha256,
    }
    seen: set[str] = set()
    for actual in sequence:
        if not isinstance(actual, dict):
            raise RuntimeScanError("local_sequence_binding")
        marker = actual.get("marker")
        ordinal = actual.get("ordinal")
        if (
            not isinstance(marker, str)
            or marker not in expected_ordinals
            or marker in seen
            or ordinal != expected_ordinals[marker]
            or actual.get("sourceManifestSha256") != manifest_sha256
            or not isinstance(actual.get("evidenceSha256"), str)
            or not _HEX64.fullmatch(actual["evidenceSha256"])
        ):
            raise RuntimeScanError("local_sequence_binding")
        seen.add(marker)
        if marker in expected_evidence and actual["evidenceSha256"] != expected_evidence[marker]:
            raise RuntimeScanError("local_sequence_binding")
        if marker == "closure":
            closure_binding = actual.get("closureBindingSha256")
            if not isinstance(closure_binding, str) or not _HEX64.fullmatch(closure_binding):
                raise RuntimeScanError("local_sequence_binding")
            if expected_closure_binding is not None and closure_binding != expected_closure_binding:
                raise RuntimeScanError("local_sequence_binding")
        elif actual.get("closureBindingSha256") != "":
            raise RuntimeScanError("local_sequence_binding")
    if not {"prerequisite", "migration"}.issubset(seen):
        raise RuntimeScanError("local_sequence_binding")
    if "seed" in seen and not {"closure", "platform-bootstrap"}.issubset(seen):
        raise RuntimeScanError("local_sequence_binding")
def _candidate_resolution_sql(candidates: Sequence[dict[str, Any]]) -> str:
    if not candidates:
        return """,
candidate_agg AS (
  SELECT 0::bigint AS candidate_count, 0::bigint AS resolved_count,
         0::bigint AS missing_count, 0::bigint AS ambiguous_count
)"""
    values = ",\n".join(
        "("
        + ", ".join(
            _sql_literal(str(candidate[key]))
            for key in ("schema", "proname", "identityArgumentsNormalized", "signature")
        )
        + ")"
        for candidate in candidates
    )
    return f""",
candidates(schema_name, proname, identity_args, signature) AS (
  VALUES {values}
), resolution AS (
  SELECT c.signature, count(p.oid)::bigint AS resolved_count
    FROM candidates AS c
    LEFT JOIN pg_catalog.pg_proc AS p
      ON p.proname = c.proname
     AND p.prokind IN ('f', 'p')
     AND (
       (c.identity_args = '' AND p.pronargs = 0)
       OR (c.identity_args <> '' AND array_to_string(p.proargtypes::oid[], ',') = array_to_string(ARRAY(
         SELECT pg_catalog.to_regtype(pg_catalog.btrim(argument))::oid
           FROM pg_catalog.unnest(pg_catalog.string_to_array(c.identity_args, ',')) WITH ORDINALITY AS arguments(argument, ordinal)
          ORDER BY ordinal
       ), ','))
     )
     AND EXISTS (
       SELECT 1
         FROM pg_catalog.pg_namespace AS n
        WHERE n.oid = p.pronamespace
          AND n.nspname = c.schema_name
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_depend AS dependency
        WHERE dependency.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
          AND dependency.objid = p.oid
          AND dependency.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
          AND dependency.deptype = 'e'
     )
   GROUP BY c.signature
), candidate_agg AS (
  SELECT count(*)::bigint AS candidate_count,
         count(*) FILTER (WHERE resolved_count = 1)::bigint AS resolved_count,
         count(*) FILTER (WHERE resolved_count = 0)::bigint AS missing_count,
         count(*) FILTER (WHERE resolved_count > 1)::bigint AS ambiguous_count
    FROM resolution
)"""


def _runtime_sql(*, candidates: Sequence[dict[str, Any]] = (), smoke: bool = False) -> bytes:
    candidate_resolution = _candidate_resolution_sql(candidates)
    application_schemas = _application_schemas(_source_inventory())
    schema_values = ", ".join(_sql_literal(schema) for schema in application_schemas)
    sql = f"""BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH funcs AS (
  SELECT n.nspname AS schema_name, p.proname,
         pg_catalog.btrim(pg_catalog.regexp_replace(
           pg_catalog.pg_get_function_identity_arguments(p.oid),
           '[[:space:]]+', ' ', 'g'
         )) AS identity_args,
         p.prosecdef, COALESCE(p.proconfig, ARRAY[]::text[]) AS config,
         pg_catalog.pg_get_functiondef(p.oid) AS definition
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
   WHERE n.nspname IN ({schema_values})
     AND p.prokind IN ('f', 'p')
     AND NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_depend AS dependency
        WHERE dependency.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
          AND dependency.objid = p.oid
          AND dependency.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
          AND dependency.deptype = 'e'
     )
), path_stats AS (
  SELECT funcs.*,
         (SELECT count(*) FROM unnest(config) s(value) WHERE s.value ~* '^search_path=') AS path_count,
         (SELECT count(*) FROM unnest(config) s(value)
          WHERE s.value ~* '{_TRUSTED_SEARCH_PATH_SQL_PATTERN}') AS valid_path_count
    FROM funcs
), external_effect_counts AS (
  SELECT
    (SELECT count(*)::bigint
       FROM pg_catalog.pg_extension AS e
       JOIN pg_catalog.pg_namespace AS n ON n.oid = e.extnamespace
      WHERE e.extname IN ('http', 'pg_net', 'dblink', 'aws_s3')
        AND n.nspname IN ({schema_values})) AS extension_count,
    (SELECT count(*)::bigint
       FROM pg_catalog.pg_proc AS p
       JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
       JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname IN ({schema_values})
        AND l.lanname NOT IN ('sql', 'plpgsql', 'internal', 'c')) AS language_count,
    (SELECT count(*)::bigint
       FROM pg_catalog.pg_proc AS p
       JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname IN ({schema_values})
        AND p.prosrc ~* '(http(_post|_get)?[[:space:]]*[(]|net[.]http|dblink[[:space:]]*[(]|copy[[:space:]]+[^;]*[[:space:]]program)') AS source_count
), external_effect AS (
  SELECT external_effect_counts.*,
    encode(extensions.digest(convert_to(
      extension_count::text || ':' || language_count::text || ':' || source_count::text,
      'UTF8'
    ), 'sha256'), 'hex') AS binding_sha256
  FROM external_effect_counts
), agg AS (
  SELECT count(*)::bigint AS function_count,
         count(*) FILTER (WHERE path_count = 1 AND valid_path_count = 1)::bigint AS local_search_path_count,
         count(*) FILTER (WHERE path_count = 0 OR valid_path_count = 0)::bigint AS unresolved_path_count,
         count(*) FILTER (WHERE path_count > 1)::bigint AS ambiguous_path_count,
         count(*) FILTER (WHERE prosecdef AND (path_count = 0 OR valid_path_count = 0))::bigint AS definer_missing_search_path_count,
         encode(extensions.digest(convert_to(COALESCE(string_agg(schema_name || '.' || proname || '(' || identity_args || ')|' || prosecdef::text || '|' || array_to_string(config, ',', '') || '|' || md5(definition), E'\\n' ORDER BY schema_name, proname, identity_args), ''), 'UTF8'), 'sha256'), 'hex') AS function_metadata_digest,
         encode(extensions.digest(convert_to(COALESCE(string_agg(md5(definition), E'\\n' ORDER BY schema_name, proname, identity_args), ''), 'UTF8'), 'sha256'), 'hex') AS definition_hash
    FROM path_stats
), unresolved AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'schema', schema_name,
           'proname', proname,
           'identityArguments', identity_args,
           'pathCount', path_count,
           'validPathCount', valid_path_count,
           'securityDefiner', prosecdef
         ) ORDER BY schema_name, proname, identity_args), '[]'::jsonb) AS functions
    FROM path_stats
   WHERE path_count = 0 OR valid_path_count = 0
), extensions AS (
  SELECT encode(extensions.digest(convert_to(COALESCE(string_agg(n.nspname || '.' || e.extname || '@' || COALESCE(e.extversion, ''), E'\\n' ORDER BY n.nspname, e.extname), ''), 'UTF8'), 'sha256'), 'hex') AS extension_catalog_sha256
    FROM pg_catalog.pg_extension e JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
){candidate_resolution},
g014_contract AS MATERIALIZED (
  SELECT privacy_retention.assert_g014_definer_contract(),
         privacy_retention.assert_g014_catalog_contract(),
         1::integer AS passed
)
SELECT jsonb_build_object(
  'schemaVersion', 'local-function-runtime-scan/v1', 'mode', 'runtime',
  'functionCount', agg.function_count, 'localSearchPathCount', agg.local_search_path_count,
  'unresolvedPathCount', agg.unresolved_path_count, 'ambiguousPathCount', agg.ambiguous_path_count,
  'definerMissingSearchPathCount', agg.definer_missing_search_path_count,
  'functionMetadataDigest', agg.function_metadata_digest,
  'definitionHash', encode(extensions.digest(convert_to(
    agg.definition_hash || ':' || external_effect.binding_sha256, 'UTF8'
  ), 'sha256'), 'hex'),
  'extensionCatalogSha256', extensions.extension_catalog_sha256,
  'externalEffectBindingSha256', external_effect.binding_sha256,
  'candidateResolution', jsonb_build_object(
    'candidateCount', candidate_agg.candidate_count,
    'resolvedCount', candidate_agg.resolved_count,
    'missingCount', candidate_agg.missing_count,
    'ambiguousCount', candidate_agg.ambiguous_count
  ),
  'closureSmoke', jsonb_build_object(
    'status', CASE WHEN agg.unresolved_path_count = 0 AND agg.ambiguous_path_count = 0
        AND candidate_agg.missing_count = 0 AND candidate_agg.ambiguous_count = 0
        AND g014_contract.passed = 1
      THEN 'passed' ELSE 'failed' END,
    'unresolvedPathCount', agg.unresolved_path_count,
    'ambiguousPathCount', agg.ambiguous_path_count,
    'candidateMissingCount', candidate_agg.missing_count,
    'candidateAmbiguousCount', candidate_agg.ambiguous_count
  ),
  'rpcSmoke', jsonb_build_object(
    'status', CASE
      WHEN external_effect.extension_count = 0
       AND external_effect.language_count = 0
       AND external_effect.source_count = 0
      THEN 'passed' ELSE 'failed' END,
    'passed', CASE
      WHEN external_effect.extension_count = 0
       AND external_effect.language_count = 0
       AND external_effect.source_count = 0
      THEN 1 ELSE 0 END,
    'failed', CASE
      WHEN external_effect.extension_count = 0
       AND external_effect.language_count = 0
       AND external_effect.source_count = 0
      THEN 0 ELSE 1 END,
    'ambiguous', 0,
    'cases', jsonb_build_array(jsonb_build_object(
      'rpc', 'external_effect_branches',
      'class', 'external',
      'status', CASE
        WHEN external_effect.extension_count = 0
         AND external_effect.language_count = 0
         AND external_effect.source_count = 0
        THEN 'passed' ELSE 'failed' END,
      'errorClass', CASE
        WHEN external_effect.extension_count = 0
         AND external_effect.language_count = 0
         AND external_effect.source_count = 0
        THEN 'external_effect_blocked' ELSE 'external_effect_surface_present' END
    ))
  ),
  'unresolvedFunctions', unresolved.functions
)::text FROM agg CROSS JOIN extensions CROSS JOIN candidate_agg CROSS JOIN external_effect
  CROSS JOIN g014_contract CROSS JOIN unresolved;
COMMIT;
"""
    if smoke:
        sql += _smoke_sql(candidates)
    return sql.encode("utf-8")


def _sql_identifier(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_$]*", value):
        raise RuntimeScanError("smoke_identifier_invalid")
    return '"' + value.replace('"', '""') + '"'


# Candidate smoke permits only exact source-signature guard outcomes. Every
# candidate not listed here must either return successfully or fail the smoke.
EXPECTED_CANDIDATE_SQLSTATES: dict[tuple[str, str, str], tuple[str, ...]] = {
    ("pipeline_control", "_job_json", "pipeline_control.jobs"): ("42804", "22P02", "42883"),
    ("pipeline_control", "ack_outbox", "bigint[],uuid"): ("22023", "42501"),
    ("pipeline_control", "checkpoint_job", "uuid,integer,text,jsonb"): ("P0001", "42501"),
    ("pipeline_control", "claim_job", "text"): ("42501",),
    ("pipeline_control", "claim_outbox", "integer,uuid"): ("22023", "42501"),
    ("pipeline_control", "control_job", "uuid,text,text,text"): ("P0001", "42501"),
    ("pipeline_control", "enqueue_job", "text,text,text,text,text,text,boolean,text,text"): ("42501", "22023", "23502", "P0001"),
    ("pipeline_control", "enqueue_outbox", "jsonb"): ("22023", "42501"),
    ("privacy_retention", "g014_confirm_privacy_onboarding_legacy", "uuid,text,uuid,text,uuid"): ("42501",),
    ("public", "apply_admin_user_db_mutation", "uuid,uuid,text,text,jsonb,jsonb,uuid,jsonb,text,text,text,text,text"): ("22023",),
    ("public", "approve_edit_submission_item", "uuid,uuid,jsonb"): ("42501",),
    ("public", "approve_submission_item", "uuid,uuid,jsonb"): ("42501",),
    ("public", "canonicalize_youtube_link", "text"): ("22023",),
    ("public", "check_restaurant_duplicate", "text,text,text"): ("42703",),
    ("public", "extract_youtube_video_id", "text"): ("22023",),
    ("public", "generate_unique_id", "text,text,text"): ("22023", "23505"),
    ("public", "get_all_approved_restaurant_names", ""): ("42501",),
    ("public", "get_categories_by_restaurant_name_or_youtube_url", "text,text"): ("42501",),
    ("public", "get_ncp_monthly_usage", "text,date"): ("42P01",),
    ("public", "get_table_sizes", ""): ("42501",),
    ("public", "get_video_captions_for_range", "text,integer,integer,integer"): ("42501",),
    ("public", "get_video_metadata_filtered", "integer,integer,text"): ("42501",),
    ("public", "mark_notification_read", "uuid"): ("P0001",),
    ("public", "match_documents_bge", "extensions.vector,double precision,integer,jsonb"): ("22023", "42883"),
    ("public", "match_documents_hybrid", "extensions.vector,jsonb,double precision,double precision,integer"): ("22023", "42883"),
    ("public", "match_storyboard_documents_hybrid", "uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb"): ("P0001",),
    ("public", "match_storyboard_documents_hybrid_v2", "uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb"): ("P0001",),
    ("public", "match_storyboard_documents_hybrid", "uuid,vector,jsonb,double precision,integer,integer,jsonb"): ("P0001",),
    ("public", "match_storyboard_documents_hybrid_v2", "uuid,vector,jsonb,double precision,integer,integer,jsonb"): ("P0001",),
    ("public", "normalize_restaurant_identity_name", "text"): ("22023",),
    ("public", "preflight_release_auth_session_family", "uuid,uuid,uuid,text,bigint"): ("42501",),
    ("public", "prevent_last_active_admin_status_change", ""): ("0A000",),
    ("public", "prevent_last_admin_role_delete", ""): ("0A000",),
    ("public", "prevent_last_admin_role_update", ""): ("0A000",),
    ("public", "prevent_profile_role_client_change", ""): ("0A000",),
    ("public", "preview_privacy_incident_transition", "uuid,uuid,public.privacy_incident_status,timestamptz,text,jsonb,uuid"): ("P0001",),
    ("public", "privacy_append_audit_event", "text,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb"): ("42501",),
    ("public", "privacy_incident_input_hash", "jsonb"): ("22023",),
    ("public", "resolve_restaurant_identity_name", "text,text,text,text"): ("22023",),
    ("public", "search_restaurants_by_category", "text,integer"): ("42501",),
    ("public", "search_restaurants_by_name", "text,integer"): ("42501",),
    ("public", "search_restaurants_by_name", "text,text[],integer,boolean,boolean"): ("42501",),
    ("public", "search_restaurants_by_youtube_title", "text,integer,boolean,boolean"): ("42501",),
    ("public", "search_video_ids_by_query", "extensions.vector,jsonb,double precision,double precision,integer"): ("22023", "42883"),
    ("public", "set_admin_ai_updated_at", ""): ("0A000",),
    ("public", "set_admin_restaurant_map_overlays_updated_at", ""): ("0A000",),
    ("public", "set_admin_trend_schema_foundation_updated_at", ""): ("0A000",),
    ("public", "set_admin_user_preferences_updated_at", ""): ("0A000",),
    ("public", "set_documents_updated_at", ""): ("0A000",),
    ("public", "storyboard_sparse_dot_product", "jsonb,jsonb"): ("22023",),
    ("public", "update_announcements_updated_at", ""): ("0A000",),
    ("public", "verify_review_like_counts", ""): ("0A000", "P0001"),
}


def _smoke_candidate_blocks(candidates: Sequence[dict[str, Any]]) -> str:
    blocks: list[str] = []
    for candidate in candidates:
        schema_name = str(candidate["schema"])
        proname_name = str(candidate["proname"])
        schema = _sql_identifier(schema_name)
        proname = _sql_identifier(proname_name)
        identity_arguments = str(candidate["identityArgumentsNormalized"])
        typed_args = []
        for argument in _split_top_level(identity_arguments):
            item = argument.strip()
            if not item:
                continue
            if item == "vector":
                item = "extensions.vector"
            typed_args.append("NULL::" + item)
        argument_values = ", ".join(typed_args)
        if proname_name in {
            "enqueue_job",
            "get_all_approved_restaurant_names",
            "get_categories_by_restaurant_name_or_youtube_url",
            "get_ncp_monthly_usage",
            "get_table_sizes",
            "get_video_captions_for_range",
            "get_video_metadata_filtered",
            "search_restaurants_by_category",
            "search_restaurants_by_name",
            "search_restaurants_by_youtube_title",
            "search_video_ids_by_query",
        }:
            call = f"SELECT * FROM {schema}.{proname}({argument_values})"
        else:
            call = f"SELECT {schema}.{proname}({argument_values})"
        signature = str(candidate["signature"])
        expected_states = EXPECTED_CANDIDATE_SQLSTATES.get(
            (schema_name, proname_name, identity_arguments),
            (),
        )
        if expected_states:
            expected_state_sql = ", ".join(_sql_literal(state) for state in expected_states)
            exception_body = (
                f"    IF SQLSTATE IN ({expected_state_sql}) THEN\n"
                f"      INSERT INTO _local_rpc_smoke VALUES ({_sql_literal(signature)}, 'closure_candidate', 'passed', 'expected_sqlstate_' || SQLSTATE);\n"
                "    ELSE\n"
                f"      INSERT INTO _local_rpc_smoke VALUES ({_sql_literal(signature)}, 'closure_candidate', 'failed', 'sqlstate_' || SQLSTATE);\n"
                "    END IF;\n"
            )
        else:
            exception_body = (
                f"    INSERT INTO _local_rpc_smoke VALUES ({_sql_literal(signature)}, 'closure_candidate', 'failed', 'sqlstate_' || SQLSTATE);\n"
            )
        blocks.append(
            "  BEGIN\n"
            f"    EXECUTE {_sql_literal(call)} INTO ignored;\n"
            f"    INSERT INTO _local_rpc_smoke VALUES ({_sql_literal(signature)}, 'closure_candidate', 'passed', NULL);\n"
            "  EXCEPTION WHEN OTHERS THEN\n"
            + exception_body
            + "  END;"
        )
    return "\n".join(blocks)


def _smoke_sql(candidates: Sequence[dict[str, Any]]) -> str:
    application_schemas = _application_schemas(candidates)
    schema_values = ", ".join(_sql_literal(schema) for schema in application_schemas)
    candidate_blocks = _smoke_candidate_blocks(candidates)
    return f"""BEGIN;
SET LOCAL statement_timeout = '2s';
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000001';
SET LOCAL "request.jwt.claim.role" = 'authenticated';
SET LOCAL "request.jwt.claims" = '{{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}}';
CREATE TEMP TABLE _local_rpc_smoke (rpc text, class text, status text, error_class text) ON COMMIT DROP;
GRANT INSERT, SELECT ON TABLE _local_rpc_smoke TO service_role;
DO $local_candidate_smoke$
DECLARE ignored text;
BEGIN
{candidate_blocks}
END $local_candidate_smoke$;
RESET ROLE;
SET LOCAL ROLE service_role;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000001';
SET LOCAL "request.jwt.claim.role" = 'service_role';
SET LOCAL "request.jwt.claims" = '{{"sub":"00000000-0000-4000-8000-000000000001","role":"service_role"}}';
DO $local_privacy_incident_guard_smoke$
DECLARE ignored text;
BEGIN
  BEGIN
    EXECUTE 'SELECT public.preview_privacy_incident_transition(NULL::uuid,NULL::uuid,NULL::public.privacy_incident_status,NULL::timestamptz,NULL::text,NULL::jsonb,NULL::uuid)' INTO ignored;
    INSERT INTO _local_rpc_smoke VALUES ('public.preview_privacy_incident_transition:service_role_guard', 'in_function_guard', 'failed', 'guard_did_not_reject');
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' THEN
      INSERT INTO _local_rpc_smoke VALUES ('public.preview_privacy_incident_transition:service_role_guard', 'in_function_guard', 'passed', 'in_function_sqlstate_P0001');
    ELSE
      INSERT INTO _local_rpc_smoke VALUES ('public.preview_privacy_incident_transition:service_role_guard', 'in_function_guard', 'failed', 'sqlstate_' || SQLSTATE);
    END IF;
  END;
END $local_privacy_incident_guard_smoke$;
RESET ROLE;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-4000-8000-000000000001';
SET LOCAL "request.jwt.claim.role" = 'authenticated';
SET LOCAL "request.jwt.claims" = '{{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}}';
DO $local_rpc_smoke$
DECLARE ignored text;
  external_extension_count integer;
  external_language_count integer;
  external_source_count integer;
BEGIN
  -- Read-only calls execute directly under fixed local claims.
  IF pg_catalog.to_regprocedure('public.get_all_approved_restaurant_names()') IS NULL THEN
    INSERT INTO _local_rpc_smoke VALUES ('public.get_all_approved_restaurant_names()', 'read_only', 'ambiguous', 'unknown_function');
  ELSE
    BEGIN
      EXECUTE 'SELECT public.get_all_approved_restaurant_names()' INTO ignored;
      INSERT INTO _local_rpc_smoke VALUES ('public.get_all_approved_restaurant_names()', 'read_only', 'passed', NULL);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO _local_rpc_smoke VALUES ('public.get_all_approved_restaurant_names()', 'read_only', 'failed', 'sqlstate_' || SQLSTATE);
    END;
  END IF;
  IF pg_catalog.to_regprocedure('public.preview_privacy_retention_run(text,timestamptz,integer,integer)') IS NULL THEN
    INSERT INTO _local_rpc_smoke VALUES ('public.preview_privacy_retention_run(text,timestamptz,integer,integer)', 'mutating', 'ambiguous', 'unknown_function');
  ELSE
    BEGIN
      EXECUTE 'SELECT public.preview_privacy_retention_run(''local-contract'', now(), 1, 1)' INTO ignored;
      INSERT INTO _local_rpc_smoke VALUES ('public.preview_privacy_retention_run(text,timestamptz,integer,integer)', 'mutating', 'passed', NULL);
    EXCEPTION WHEN OTHERS THEN
      IF SQLSTATE IN ('P0001', 'P0002', '42501') THEN
        INSERT INTO _local_rpc_smoke VALUES ('public.preview_privacy_retention_run(text,timestamptz,integer,integer)', 'mutating', 'passed', 'expected_sqlstate_' || SQLSTATE);
      ELSE
        INSERT INTO _local_rpc_smoke VALUES ('public.preview_privacy_retention_run(text,timestamptz,integer,integer)', 'mutating', 'failed', 'sqlstate_' || SQLSTATE);
      END IF;
    END;
  END IF;
  -- External-effect paths are denied by construction and checked in the live catalog.
  SELECT count(*) INTO external_extension_count
    FROM pg_catalog.pg_extension e
    JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
   WHERE e.extname IN ('http', 'pg_net', 'dblink', 'aws_s3')
     AND n.nspname IN ({schema_values});
  SELECT count(*) INTO external_language_count
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_language l ON l.oid = p.prolang
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ({schema_values})
     AND l.lanname NOT IN ('sql', 'plpgsql', 'internal', 'c');
  SELECT count(*) INTO external_source_count
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ({schema_values})
     AND p.prosrc ~* '(http(_post|_get)?[[:space:]]*[(]|net[.]http|dblink[[:space:]]*[(]|copy[[:space:]]+[^;]*[[:space:]]program)';
  IF external_extension_count = 0
     AND external_language_count = 0
     AND external_source_count = 0 THEN
    INSERT INTO _local_rpc_smoke VALUES ('external_effect_branches', 'external', 'passed', 'external_effect_blocked');
  ELSE
    INSERT INTO _local_rpc_smoke VALUES ('external_effect_branches', 'external', 'failed', 'external_effect_surface_present');
  END IF;
END $local_rpc_smoke$;
SELECT jsonb_build_object(
  'rpcSmoke', jsonb_build_object(
    'status', CASE
      WHEN bool_and(status = 'passed') FILTER (WHERE class <> 'closure_candidate') THEN 'passed'
      WHEN bool_or(status = 'ambiguous') FILTER (WHERE class <> 'closure_candidate') THEN 'ambiguous'
      ELSE 'failed'
    END,
    'passed', count(*) FILTER (WHERE class <> 'closure_candidate' AND status = 'passed'),
    'failed', count(*) FILTER (WHERE class <> 'closure_candidate' AND status = 'failed'),
    'ambiguous', count(*) FILTER (WHERE class <> 'closure_candidate' AND status = 'ambiguous'),
    'cases', jsonb_agg(jsonb_build_object('rpc', rpc, 'class', class, 'status', status, 'errorClass', error_class) ORDER BY rpc)
  ),
  'candidateRpcSmoke', jsonb_build_object(
    'status', CASE
      WHEN count(*) FILTER (WHERE class = 'closure_candidate') = {len(candidates)}
       AND count(*) FILTER (WHERE class = 'closure_candidate' AND status = 'passed') = {len(candidates)}
      THEN 'passed' ELSE 'failed'
    END,
    'candidateCount', count(*) FILTER (WHERE class = 'closure_candidate'),
    'passed', count(*) FILTER (WHERE class = 'closure_candidate' AND status = 'passed'),
    'failed', count(*) FILTER (WHERE class = 'closure_candidate' AND status = 'failed'),
    'cases', jsonb_agg(jsonb_build_object('rpc', rpc, 'status', status, 'errorClass', error_class) ORDER BY rpc) FILTER (WHERE class = 'closure_candidate')
  )
)::text FROM _local_rpc_smoke;
ROLLBACK;
"""


def _validate_runtime(value: dict[str, Any], *, require_smoke: bool = False) -> None:
    if not isinstance(value, dict):
        raise RuntimeScanError("runtime_receipt_invalid")
    rpc_smoke = value.get("rpcSmoke")
    if not isinstance(rpc_smoke, dict) or rpc_smoke.get("status") != "passed":
        raise RuntimeScanError("runtime_rpc_smoke_failed")
    cases = rpc_smoke.get("cases")
    if not isinstance(cases, list) or any(not isinstance(case, dict) for case in cases):
        raise RuntimeScanError("runtime_rpc_smoke_failed")
    external_cases = [
        case for case in cases
        if isinstance(case, dict) and case.get("rpc") == "external_effect_branches"
    ]
    if len(external_cases) != 1:
        raise RuntimeScanError("runtime_external_effect_failed")
    external_case = external_cases[0]
    if (
        external_case.get("status") != "passed"
        or external_case.get("errorClass") != "external_effect_blocked"
    ):
        raise RuntimeScanError("runtime_external_effect_failed")

    # Static apply/rescan closure validation intentionally does not invoke RPC
    # bodies.  Dedicated smoke validation must prove that the permitted service
    # principal entered the incident RPC and reached its P0001 guard (rather
    # than being rejected by a GRANT first).
    if require_smoke:
        guard_cases = [
            case for case in cases
            if isinstance(case, dict)
            and case.get("rpc") ==
                "public.preview_privacy_incident_transition:service_role_guard"
        ]
        if len(guard_cases) != 1:
            raise RuntimeScanError("runtime_privacy_incident_guard_failed")
        guard_case = guard_cases[0]
        if (
            guard_case.get("class") != "in_function_guard"
            or guard_case.get("status") != "passed"
            or guard_case.get("errorClass") != "in_function_sqlstate_P0001"
        ):
            raise RuntimeScanError("runtime_privacy_incident_guard_failed")

    closure = value.get("closureSmoke")
    candidate_resolution = value.get("candidateResolution")
    if not isinstance(closure, dict) or not isinstance(candidate_resolution, dict):
        raise RuntimeScanError("runtime_receipt_invalid")
    if (
        closure.get("status") != "passed"
        or type(value.get("unresolvedPathCount")) is not int
        or value["unresolvedPathCount"] != 0
        or type(value.get("ambiguousPathCount")) is not int
        or value["ambiguousPathCount"] != 0
        or type(candidate_resolution.get("missingCount")) is not int
        or candidate_resolution["missingCount"] != 0
        or type(candidate_resolution.get("ambiguousCount")) is not int
        or candidate_resolution["ambiguousCount"] != 0
        or type(candidate_resolution.get("resolvedCount")) is not int
        or type(candidate_resolution.get("candidateCount")) is not int
        or candidate_resolution["resolvedCount"] != candidate_resolution["candidateCount"]
    ):
        raise RuntimeScanError("runtime_closure_unresolved")
    candidate_smoke = value.get("candidateRpcSmoke")
    if require_smoke and candidate_smoke is not None and (
        not isinstance(candidate_smoke, dict)
        or candidate_smoke.get("status") != "passed"
        or type(candidate_smoke.get("candidateCount")) is not int
        or candidate_smoke["candidateCount"] != candidate_resolution["candidateCount"]
        or type(candidate_smoke.get("passed")) is not int
        or candidate_smoke["passed"] != candidate_smoke["candidateCount"]
        or type(candidate_smoke.get("failed")) is not int
        or candidate_smoke["failed"] != 0
    ):
        raise RuntimeScanError("runtime_candidate_smoke_failed")
def _closure_binding_sha256(metadata: Mapping[str, Any], definition_hash: str) -> str:
    if not _HEX64.fullmatch(definition_hash):
        raise RuntimeScanError("runtime_receipt_invalid")
    fields = {
        key: metadata.get(key)
        for key in (
            "sourceManifestSha256",
            "toolSha256",
            "trustedExtensionManifestSha256",
            "candidateSetSha256",
            "patchSha256",
        )
    }
    if any(not isinstance(value, str) or not _HEX64.fullmatch(value) for value in fields.values()):
        raise RuntimeScanError("patch_binding_invalid")
    return _sha256(canonical_json({**fields, "definitionHash": definition_hash}))


def _mark_closure_sequence(client: LocalPsql, evidence: str, binding: str) -> None:
    if not _HEX64.fullmatch(evidence) or not _HEX64.fullmatch(binding):
        raise RuntimeScanError("runtime_receipt_invalid")
    expected_manifest = _current_migration_bindings()["manifestSha256"]
    sql = f"""BEGIN;
DO $local_closure_sequence$
DECLARE migration_manifest text;
BEGIN
  SELECT source_manifest_sha256
    INTO migration_manifest
    FROM _tzudong_local.execution_sequence
   WHERE marker = 'migration' AND ordinal = 2;
  IF migration_manifest IS NULL OR migration_manifest <> {_sql_literal(expected_manifest)} THEN
    RAISE EXCEPTION 'sequence_migration_source_mismatch';
  END IF;
  INSERT INTO _tzudong_local.execution_sequence(marker, ordinal, evidence_sha256, source_manifest_sha256, closure_binding_sha256)
  VALUES ('closure', 3, '{evidence}', migration_manifest, '{binding}')
  ON CONFLICT (marker) DO UPDATE
    SET ordinal = EXCLUDED.ordinal,
        evidence_sha256 = EXCLUDED.evidence_sha256,
        source_manifest_sha256 = EXCLUDED.source_manifest_sha256,
        closure_binding_sha256 = EXCLUDED.closure_binding_sha256,
        updated_at = clock_timestamp();
END $local_closure_sequence$;
COMMIT;
"""
    client.execute(sql.encode("utf-8"))



def _write_owner_only(path: Path, data: bytes) -> None:
    try:
        path.resolve(strict=False).relative_to(source_root())
    except ValueError:
        pass
    else:
        raise RuntimeScanError("output_in_source_tree")
    if path.exists() or path.is_symlink():
        raise RuntimeScanError("output_exists")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
    except OSError as error:
        raise RuntimeScanError("output_write_failed") from error


def _validate_patch_binding(metadata: dict[str, Any]) -> list[dict[str, Any]]:
    manifest = _source_manifest()
    if metadata.get("sourceManifestSha256") != manifest["manifestSha256"]:
        raise RuntimeScanError("patch_source_drift")
    if metadata.get("toolSha256") != _tool_sha256():
        raise RuntimeScanError("patch_tool_drift")
    if metadata.get("trustedExtensionManifestSha256") != _trusted_extension_manifest_sha256():
        raise RuntimeScanError("patch_extension_drift")
    candidates = _candidate_functions(_source_inventory())
    if metadata.get("candidateSetSha256") != _sha256(canonical_json(candidates)):
        raise RuntimeScanError("patch_candidate_drift")
    if int(metadata.get("candidateCount", -1)) != len(candidates):
        raise RuntimeScanError("patch_candidate_drift")
    return candidates


def _common_arguments(parser: argparse.ArgumentParser, *, container_required: bool = False) -> None:
    parser.add_argument("--container", required=container_required)
    parser.add_argument("--database", default="postgres")
    parser.add_argument("--docker", default="docker")
    parser.add_argument("--timeout", type=float, default=60.0)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="local-function-runtime-scan.py", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    scan = sub.add_parser("scan", help="scan source and optionally the exact local db")
    _common_arguments(scan)
    smoke = sub.add_parser("smoke", help="run local read-only and rollback smoke cases")
    _common_arguments(smoke)
    generate = sub.add_parser("generate", help="generate a source-bound local path patch")
    generate.add_argument("--output", "--patch", dest="output")
    apply = sub.add_parser("apply", help="apply a source-bound patch in the exact local db")
    _common_arguments(apply, container_required=False)
    apply.add_argument("--patch", required=True)
    rescan = sub.add_parser("rescan", help="rescan runtime closure after patch application")
    _common_arguments(rescan, container_required=False)
    rescan.add_argument("--patch")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        if args.command == "generate":
            sql, metadata = generate_patch()
            if args.output:
                _write_owner_only(Path(args.output), sql.encode("utf-8"))
                output: dict[str, Any] = {"schemaVersion": PATCH_SCHEMA, "mode": "generate", "patchPath": str(Path(args.output)), **metadata}
            else:
                output = {"schemaVersion": PATCH_SCHEMA, "mode": "generate", "patchSql": sql, **metadata}
            sys.stdout.buffer.write(canonical_json(output) + b"\n")
            return 0
        if args.command == "scan":
            source = scan_source()
            if args.container:
                candidates = _candidate_functions(_source_inventory())
                runtime = LocalPsql(args.docker, args.container, args.database, args.timeout).query(
                    _runtime_sql(candidates=candidates)
                )
                source["runtime"] = runtime
            sys.stdout.buffer.write(canonical_json(source) + b"\n")
            return 0
        if args.command == "rescan":
            client = LocalPsql(args.docker, args.container, args.database, args.timeout)
            candidates: Sequence[dict[str, Any]] = ()
            metadata: dict[str, Any] | None = None
            if args.patch:
                _, metadata = _read_patch(Path(args.patch))
                candidates = _validate_patch_binding(metadata)
            runtime = client.query(_runtime_sql(candidates=candidates))
            if metadata is None:
                raise RuntimeScanError("rescan_patch_required")
            definition_hash = str(runtime.get("definitionHash", ""))
            binding_sha256 = _closure_binding_sha256(metadata, definition_hash)
            runtime["closureBinding"] = {
                key: metadata[key]
                for key in (
                    "sourceManifestSha256",
                    "toolSha256",
                    "trustedExtensionManifestSha256",
                    "candidateSetSha256",
                    "patchSha256",
                )
            }
            runtime["closureBinding"]["bindingSha256"] = binding_sha256
            _validate_runtime(runtime)
            _mark_closure_sequence(client, definition_hash, binding_sha256)
            sys.stdout.buffer.write(canonical_json(runtime) + b"\n")
            return 0
        if args.command == "smoke":
            client = LocalPsql(args.docker, args.container, args.database, args.timeout)
            candidates = _candidate_functions(_source_inventory())
            runtime = client.query(_runtime_sql(candidates=candidates, smoke=True))
            smoke_cases = ((runtime.get("candidateRpcSmoke") or {}).get("cases")) or []
            failed_cases = [
                case
                for case in smoke_cases
                if isinstance(case, dict) and case.get("status") != "passed"
            ]
            if failed_cases:
                print(
                    "candidate_smoke_failed="
                    + ",".join(
                        f"{case.get('rpc')}:{case.get('errorClass')}"
                        for case in failed_cases
                    ),
                    file=sys.stderr,
                )
            smoke_status = runtime.get("rpcSmoke", {}).get("status")
            sys.stdout.buffer.write(canonical_json(runtime) + b"\n")
            _validate_runtime(runtime, require_smoke=True)
            return 0 if smoke_status == "passed" else 2
        if args.command == "apply":
            sql, metadata = _read_patch(Path(args.patch))
            candidates = _validate_patch_binding(metadata)
            client = LocalPsql(args.docker, args.container, args.database, args.timeout)
            before = client.query(_runtime_sql(candidates=candidates))
            expected_closure_binding = _closure_binding_sha256(metadata, str(before.get("definitionHash", "")))
            client.execute(
                sql.encode("utf-8"),
                expected_closure_binding=expected_closure_binding,
            )
            after = client.query(_runtime_sql(candidates=candidates))
            unresolved = after.get("unresolvedFunctions") or []
            if unresolved:
                print(
                    "unresolved_functions="
                    + ",".join(
                        f"{item.get('schema')}.{item.get('proname')}({item.get('identityArguments')})"
                        for item in unresolved
                        if isinstance(item, dict)
                    ),
                    file=sys.stderr,
                )
            print(
                "candidate_resolution="
                + json.dumps(after.get("candidateResolution"), separators=(",", ":"), default=str),
                file=sys.stderr,
            )
            _validate_runtime(after)
            receipt = {
                "schemaVersion": SCHEMA_VERSION,
                "mode": "apply",
                "status": "passed",
                "sourceManifestSha256": metadata["sourceManifestSha256"],
                "toolSha256": metadata["toolSha256"],
                "trustedExtensionManifestSha256": metadata["trustedExtensionManifestSha256"],
                "candidateSetSha256": metadata["candidateSetSha256"],
                "patchSha256": metadata["patchSha256"],
                "beforeDefinitionHash": before.get("definitionHash"),
                "afterDefinitionHash": after.get("definitionHash"),
                "beforeExtensionCatalogSha256": before.get("extensionCatalogSha256"),
                "afterExtensionCatalogSha256": after.get("extensionCatalogSha256"),
                "unresolvedPathCount": after.get("unresolvedPathCount"),
                "ambiguousPathCount": after.get("ambiguousPathCount"),
            }
            sys.stdout.buffer.write(canonical_json(receipt) + b"\n")
            return 0
    except (RuntimeScanError, OSError, ValueError, TypeError) as error:
        code = error.code if isinstance(error, RuntimeScanError) else "input_invalid"
        print("local-function-runtime-scan: " + code, file=sys.stderr)
        return 2
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
