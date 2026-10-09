"""Fail-closed sanitizer for one future Gemini schema diagnostic response.

Raw bodies are accepted as in-memory bytes and never returned. Every returned
string is selected from a fixed allowlist or rebuilt from the submitted schema.
"""
from __future__ import annotations

import json
import re

MAX_ERROR_BYTES = 64 * 1024

INTERACTIONS_CODES = frozenset({
    "invalid_request", "failed_precondition", "out_of_range", "parameter_unknown",
    "authentication", "payment_required", "permission_denied", "not_found",
    "model_not_found", "already_exists", "aborted", "rate_limit_exceeded",
    "quota_exceeded", "too_many_requests", "cancelled", "api_error",
    "unimplemented", "service_unavailable", "deadline_exceeded",
})
RPC_CODES = frozenset({
    "INVALID_ARGUMENT", "FAILED_PRECONDITION", "OUT_OF_RANGE", "UNAUTHENTICATED",
    "PERMISSION_DENIED", "RESOURCE_EXHAUSTED", "NOT_FOUND", "ALREADY_EXISTS",
    "ABORTED", "CANCELLED", "INTERNAL", "UNIMPLEMENTED", "UNAVAILABLE",
    "DEADLINE_EXCEEDED", "DATA_LOSS",
})
OFFICIAL_CODES = INTERACTIONS_CODES | RPC_CODES
SCHEMA_KEYWORDS = frozenset({
    "$ref", "type", "enum", "minimum", "maximum", "required",
    "additionalProperties", "maxItems", "properties", "items", "description",
})
FIXED_CATEGORIES = frozenset({
    "schema_complexity", "unsupported_keyword", "type_mismatch",
    "schema_constraint", "auth_or_permission", "quota", "server_error", "unknown",
})

_FIELD_PATH = re.compile(
    r"(?i)\bat\s+(['\"])(response_format\.schema(?:\.[A-Za-z_$][A-Za-z0-9_$]*|\[[0-9]+\])*)\1"
)
_PATH_NAME = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*")
_MESSAGE_PATH_MARKERS = (
    "is not supported for", "unknown parameter", "invalid value for",
    "expected type", "type mismatch", "must be of type", "failed schema constraint",
)
_COMPLEXITY_MARKERS = (
    "schema is too complex", "schema too complex", "schema is too deeply nested",
    "schema is too large", "too many schema states",
)
_TYPE_MARKERS = ("expected type", "type mismatch", "must be of type")
_CONSTRAINT_MARKERS = (
    "failed schema constraint", "must be less than or equal",
    "must be greater than or equal", "required field", "additional properties",
)
_UNSUPPORTED_MARKERS = ("is not supported for", "unsupported schema", "unknown parameter")


def _schema_paths(value, path=()):
    paths = {path}
    if isinstance(value, dict):
        for key, child in value.items():
            if not isinstance(key, str):
                continue
            paths.update(_schema_paths(child, path + (key,)))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            paths.update(_schema_paths(child, path + (index,)))
    return paths


def _parse_wire_path(value, valid_paths):
    if not isinstance(value, str):
        return None
    prefix = next((candidate for candidate in ("response_format.schema", "responseFormat.schema")
                   if value.startswith(candidate)), None)
    if prefix is None:
        return None
    rest = value[len(prefix):]
    tokens = []
    offset = 0
    while offset < len(rest):
        if rest[offset] == ".":
            match = _PATH_NAME.match(rest, offset + 1)
            if match is None:
                return None
            tokens.append(match.group(0))
            offset = match.end()
        elif rest[offset] == "[":
            close = rest.find("]", offset + 1)
            digits = rest[offset + 1:close] if close >= 0 else ""
            if close < 0 or not digits.isdigit() or len(digits) > 6:
                return None
            tokens.append(int(digits))
            offset = close + 1
        else:
            return None
    candidate = tuple(tokens)
    return candidate if candidate in valid_paths else None


def _typed_paths(error, valid_paths):
    details = error.get("details")
    if not isinstance(details, list):
        return set()
    found = set()
    for detail in details[:16]:
        if not isinstance(detail, dict):
            continue
        if detail.get("@type") != "type.googleapis.com/google.rpc.BadRequest":
            continue
        violations = detail.get("fieldViolations", detail.get("field_violations"))
        if not isinstance(violations, list):
            continue
        for violation in violations[:32]:
            if not isinstance(violation, dict):
                continue
            parsed = _parse_wire_path(violation.get("field"), valid_paths)
            if parsed is not None:
                found.add(parsed)
    return found


def _message_paths(message, valid_paths):
    if not isinstance(message, str):
        return set()
    lowered = message[:8192].casefold()
    if not any(marker in lowered for marker in _MESSAGE_PATH_MARKERS):
        return set()
    found = set()
    for match in _FIELD_PATH.finditer(message[:8192]):
        parsed = _parse_wire_path(match.group(2), valid_paths)
        if parsed is not None:
            found.add(parsed)
    return found


def _safe_code(error):
    for key in ("code", "status"):
        value = error.get(key)
        if isinstance(value, str) and value in OFFICIAL_CODES:
            return value
    return None


def _keyword(path):
    if path is None:
        return None
    for token in reversed(path):
        if isinstance(token, str) and token in SCHEMA_KEYWORDS:
            return token
    return None


def _category(status, code, message, path):
    if code in {"authentication", "permission_denied", "UNAUTHENTICATED", "PERMISSION_DENIED"}:
        return "auth_or_permission"
    if code in {"payment_required", "rate_limit_exceeded", "quota_exceeded", "too_many_requests", "RESOURCE_EXHAUSTED"}:
        return "quota"
    if code in {"api_error", "service_unavailable", "INTERNAL", "UNAVAILABLE", "DATA_LOSS"}:
        return "server_error"
    if code is None:
        if status in (401, 403):
            return "auth_or_permission"
        if status in (402, 429):
            return "quota"
        if status is not None and 500 <= status <= 599:
            return "server_error"
        return "unknown"

    invalid = code in {"invalid_request", "parameter_unknown", "out_of_range", "INVALID_ARGUMENT", "OUT_OF_RANGE"}
    if not invalid:
        return "unknown"
    lowered = message[:8192].casefold() if isinstance(message, str) else ""
    if any(marker in lowered for marker in _COMPLEXITY_MARKERS):
        return "schema_complexity"
    if path is not None and (code == "parameter_unknown" or any(marker in lowered for marker in _UNSUPPORTED_MARKERS)):
        return "unsupported_keyword"
    if path is not None and any(marker in lowered for marker in _TYPE_MARKERS):
        return "type_mismatch"
    if path is not None and (code in {"out_of_range", "OUT_OF_RANGE"} or any(marker in lowered for marker in _CONSTRAINT_MARKERS)):
        return "schema_constraint"
    return "unknown"


def sanitize_error(http_status, raw_body, submitted_schema):
    """Return only fixed values and a path rebuilt from ``submitted_schema``."""
    status = http_status if type(http_status) is int and 100 <= http_status <= 599 else None
    valid_paths = _schema_paths(submitted_schema)
    error = {}
    if isinstance(raw_body, bytes) and len(raw_body) <= MAX_ERROR_BYTES:
        try:
            document = json.loads(raw_body)
            candidate = document.get("error") if isinstance(document, dict) else None
            if isinstance(candidate, dict):
                error = candidate
        except (UnicodeError, ValueError, TypeError, RecursionError):
            pass

    code = _safe_code(error)
    message = error.get("message") if isinstance(error.get("message"), str) else ""
    typed = _typed_paths(error, valid_paths)
    marked = _message_paths(message, valid_paths) if not typed else set()
    selected = typed if len(typed) == 1 else marked if len(marked) == 1 else set()
    path = next(iter(selected)) if selected else None
    source = "typed_detail" if path is not None and typed else "message_marker" if path is not None else None
    category = _category(status, code, message, path)
    if category not in FIXED_CATEGORIES:
        category = "unknown"

    # No value below is copied from message/body except an exact allowlisted code.
    # Path tokens are the canonical objects already present in valid_paths.
    result = {
        "httpStatus": status,
        "officialCode": code,
        "category": category,
        "schemaPath": list(path) if path is not None else None,
        "schemaPathSource": source,
        "schemaKeyword": _keyword(path),
    }
    del message, error
    return result
