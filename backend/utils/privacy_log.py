"""Dependency-free, bounded redaction for backend log boundaries."""

from __future__ import annotations

import re
from typing import Any


DEFAULT_MAX_DEPTH = 6
DEFAULT_MAX_ENTRIES = 100
DEFAULT_MAX_STRING_LENGTH = 4096
REDACTED = "[REDACTED]"
TRUNCATED = "[TRUNCATED]"

_PRIVATE_KEY_RE = re.compile(
    r"-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----.*?-----END(?: [A-Z0-9]+)* PRIVATE KEY-----",
    re.IGNORECASE | re.DOTALL,
)
_COOKIE_HEADER_RE = re.compile(r"(?im)((?:set-)?cookie\s*:\s*)[^\r\n]*")
_RAW_OCR_RE = re.compile(
    r"(?is)(\b(?:raw[_ -]?ocr|ocr(?:[_ -]?(?:text|output|result|content))?)\b\s*[:=]\s*).*"
)
_URL_USERINFO_RE = re.compile(r"(?i)([a-z][a-z0-9+.-]*://)[^/?#\s@]+@")
_SECRET_QUERY_RE = re.compile(
    r"(?i)([?&;](?:api[_-]?key|access[_-]?key|password|passwd|pwd|secret|"
    r"token|access[_-]?token|refresh[_-]?token|id[_-]?token|session(?:[_-]?id)?|"
    r"sid|authorization|credential|service[_-]?role|private[_-]?key)=[^&#\s]*)"
)
_BEARER_RE = re.compile(r"(?i)\bbearer\s+[a-z0-9._~+/=-]+")
_JWT_RE = re.compile(r"\beyJ[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b")
_KNOWN_SECRET_RE = re.compile(
    r"\b(?:AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|"
    r"gh[pousr]_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|"
    r"sk-(?:proj-)?[A-Za-z0-9_-]{16,})\b"
)
_SENSITIVE_FIELD_RE = re.compile(
    r"""(?ix)
    (?P<label>
        [\"']?(?:
            [a-z0-9_-]*(?:x[-_ ]?api[-_ ]?key|api[-_ ]?key|access[-_ ]?key|password|passwd|pwd|
            secret|token|authorization|credentials?|cookie|session|sid)[a-z0-9_-]*
            |[a-z0-9_-]*(?:service[-_ ]?role|private[-_ ]?key)(?:[-_ ]?key)?[a-z0-9_-]*
        )[\"']?
    )
    (?P<separator>\s*(?::|=)\s*)
    (?P<quote>[\"']?)
    (?P<value>[^\r\n]*)
    """
)
_RRN_RE = re.compile(r"(?<!\d)\d{6}[-\s]?[1-8]\d{6}(?!\d)")
_KOREAN_PHONE_RE = re.compile(
    r"(?<!\d)(?:\+?82[-.\s]?)?(?:0?1[016789]|0?2|0?[3-6][1-5]|0?70)"
    r"[-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)"
)
_INTERNATIONAL_PHONE_RE = re.compile(
    r"(?<![\w+])\+\d{1,3}(?:[-.\s]?\(?\d{1,4}\)?){2,4}(?!\d)"
)
_EMAIL_RE = re.compile(r"(?i)(?<![\w.+-])[\w.+-]+@[\w.-]+\.(?:[a-z가-힣]{2,})(?![\w.-])")
_COORDINATE_PAIR_RE = re.compile(
    r"(?i)((?:[\"']?(?:coordinates?|coords?)[\"']?|좌표)\s*[:=]?\s*)"
    r"[+-]?\d{1,3}\.\d{4,}\s*,\s*[+-]?\d{1,3}\.\d{4,}"
)
_LABELED_COORDINATE_RE = re.compile(
    r"(?i)((?:[\"']?(?:lat(?:itude)?|lng|lon(?:gitude)?)[\"']?|위도|경도|좌표)\s*[:=]\s*)"
    r"[+-]?\d{1,3}\.\d{4,}"
)
_SENSITIVE_KEYS = frozenset(
    {
        "key",
        "apikey",
        "xapikey",
        "accesskey",
        "password",
        "passwd",
        "pwd",
        "secret",
        "token",
        "accesstoken",
        "refreshtoken",
        "idtoken",
        "authorization",
        "credential",
        "credentials",
        "servicerole",
        "servicerolekey",
        "privatekey",
        "cookie",
        "setcookie",
        "session",
        "sessionid",
        "sid",
        "rawocr",
        "ocr",
        "ocrtext",
        "ocroutput",
        "ocrresult",
        "ocrcontent",
    }
)
_COORDINATE_KEYS = frozenset(
    {"lat", "latitude", "lng", "lon", "longitude", "위도", "경도", "좌표", "coordinate", "coordinates", "coord", "coords"}
)


def _normalise_limit(value: Any, default: int) -> int:
    if type(value) is not int:
        return default
    return max(0, value)


def _redact_text(text: str) -> str:
    text = _PRIVATE_KEY_RE.sub(REDACTED, text)
    text = _COOKIE_HEADER_RE.sub(lambda match: f"{match.group(1)}{REDACTED}", text)
    text = _RAW_OCR_RE.sub(lambda match: f"{match.group(1)}{REDACTED}", text)
    text = _URL_USERINFO_RE.sub(lambda match: f"{match.group(1)}{REDACTED}@", text)
    text = _SECRET_QUERY_RE.sub(lambda match: f"{match.group(1).split('=', 1)[0]}={REDACTED}", text)
    text = _BEARER_RE.sub(f"Bearer {REDACTED}", text)
    text = _JWT_RE.sub(REDACTED, text)
    text = _KNOWN_SECRET_RE.sub(REDACTED, text)

    def redact_field(match: re.Match[str]) -> str:
        quote = match.group("quote")
        return f"{match.group('label')}{match.group('separator')}{quote}{REDACTED}{quote}"

    text = _SENSITIVE_FIELD_RE.sub(redact_field, text)
    text = _RRN_RE.sub(REDACTED, text)
    text = _KOREAN_PHONE_RE.sub(REDACTED, text)
    text = _INTERNATIONAL_PHONE_RE.sub(REDACTED, text)
    text = _EMAIL_RE.sub(REDACTED, text)
    text = _COORDINATE_PAIR_RE.sub(lambda match: f"{match.group(1)}{REDACTED}", text)
    return _LABELED_COORDINATE_RE.sub(lambda match: f"{match.group(1)}{REDACTED}", text)


def _safe_type_name(value: Any) -> str:
    try:
        name = type(value).__name__
    except BaseException:
        return "object"
    if type(name) is not str:
        return "object"
    return _redact_text(name)[:128] or "object"


def _truncate(text: str, max_length: int) -> str:
    if len(text) <= max_length:
        return text
    if max_length <= len(TRUNCATED):
        return TRUNCATED[:max_length]
    return f"{text[:max_length - len(TRUNCATED)]}{TRUNCATED}"


def redact_log_text(value: Any, max_length: int = DEFAULT_MAX_STRING_LENGTH) -> str:
    """Return a bounded, redacted text value without stringifying arbitrary objects."""
    limit = _normalise_limit(max_length, DEFAULT_MAX_STRING_LENGTH)
    if type(value) is not str:
        return _truncate(f"<{_safe_type_name(value)}>", limit)
    return _truncate(_redact_text(value), limit)


def safe_error_name(error: Any) -> str:
    """Return only a bounded exception type name, never an exception message."""
    return redact_log_text(_safe_type_name(error), max_length=128)


def _normalise_key(key: str) -> str:
    return "".join(char for char in key.lower() if char.isalnum())


def _is_sensitive_key(key: str) -> bool:
    normalised = _normalise_key(key)
    return normalised in _SENSITIVE_KEYS or any(
        marker in normalised
        for marker in (
            "apikey",
            "accesskey",
            "password",
            "passwd",
            "secret",
            "token",
            "credential",
            "servicerole",
            "privatekey",
            "cookie",
            "session",
        )
    )


def _is_coordinate_key(key: str) -> bool:
    return _normalise_key(key) in _COORDINATE_KEYS


def sanitize_log_value(
    value: Any,
    max_depth: int = DEFAULT_MAX_DEPTH,
    max_entries: int = DEFAULT_MAX_ENTRIES,
    max_string_length: int = DEFAULT_MAX_STRING_LENGTH,
) -> Any:
    """Convert values into bounded JSON-safe primitives without unsafe object coercion."""
    depth_limit = _normalise_limit(max_depth, DEFAULT_MAX_DEPTH)
    entry_limit = _normalise_limit(max_entries, DEFAULT_MAX_ENTRIES)
    string_limit = _normalise_limit(max_string_length, DEFAULT_MAX_STRING_LENGTH)
    remaining = [entry_limit]
    active_containers: set[int] = set()

    def consume_entry() -> bool:
        if remaining[0] <= 0:
            return False
        remaining[0] -= 1
        return True

    def mapping_key(key: Any, index: int) -> str:
        if type(key) is str:
            return redact_log_text(key, max_length=min(string_limit, 256))
        return f"<key-{index}:{_safe_type_name(key)}>"

    def unique_key(result: dict[str, Any], key: str) -> str:
        if key not in result:
            return key
        suffix = 2
        while f"{key}#{suffix}" in result:
            suffix += 1
        return f"{key}#{suffix}"

    def sanitize(current: Any, depth: int) -> Any:
        if type(current) is str:
            return redact_log_text(current, max_length=string_limit)
        if current is None or type(current) in (bool, int, float):
            return current
        if isinstance(current, BaseException):
            return {"error": safe_error_name(current)}
        if type(current) not in (dict, list, tuple, set, frozenset):
            return f"<{_safe_type_name(current)}>"
        if depth >= depth_limit:
            return "<max-depth>"

        container_id = id(current)
        if container_id in active_containers:
            return "<cycle>"
        active_containers.add(container_id)
        try:
            if type(current) is dict:
                sanitized: dict[str, Any] = {}
                last_key: str | None = None
                for index, (key, item) in enumerate(current.items(), 1):
                    if not consume_entry():
                        if last_key is not None:
                            sanitized[last_key] = TRUNCATED
                        break
                    raw_key = mapping_key(key, index)
                    safe_key = unique_key(sanitized, raw_key)
                    if _is_sensitive_key(raw_key) or _is_coordinate_key(raw_key):
                        sanitized[safe_key] = REDACTED
                    else:
                        sanitized[safe_key] = sanitize(item, depth + 1)
                    last_key = safe_key
                return sanitized

            sanitized_items: list[Any] = []
            for item in current:
                if not consume_entry():
                    if sanitized_items:
                        sanitized_items[-1] = TRUNCATED
                    break
                sanitized_items.append(sanitize(item, depth + 1))
            return sanitized_items
        finally:
            active_containers.remove(container_id)

    return sanitize(value, 0)
