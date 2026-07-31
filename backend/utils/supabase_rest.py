"""Fail-closed credentials for privileged Supabase REST clients."""

from __future__ import annotations

import base64
import binascii
import ipaddress
import json
import os
import re
import unicodedata
from dataclasses import dataclass
from typing import Mapping, NoReturn
from urllib.parse import SplitResult, urlsplit


SUPABASE_REST_CONFIGURATION_ERROR = "SUPABASE_REST_CONFIGURATION_INVALID"
SUPABASE_REST_ALLOW_LOOPBACK_HTTP_ENV = "SUPABASE_REST_ALLOW_LOOPBACK_HTTP"
NODE_ENV = "NODE_ENV"
MAX_SERVICE_ROLE_KEY_LENGTH = 4096
PROJECT_HOST_RE = re.compile(r"^[a-z0-9]{20}\.supabase\.co$")


class SupabaseRestConfigurationError(RuntimeError):
    """Fixed, credential-safe error for invalid privileged REST configuration."""

    def __init__(self) -> None:
        super().__init__(SUPABASE_REST_CONFIGURATION_ERROR)


@dataclass(frozen=True)
class SupabaseRestCredentials:
    """Canonical endpoint and service-role key for a privileged REST client."""

    url: str
    service_role_key: str


def _contains_controls(value: str) -> bool:
    return any(unicodedata.category(character) == "Cc" for character in value)


def _configuration_error() -> NoReturn:
    raise SupabaseRestConfigurationError()


def _environment_value(environment: Mapping[str, object], name: str) -> str:
    value = environment.get(name)
    if not isinstance(value, str):
        _configuration_error()
    return value


def _jwt_role(key: str) -> str | None:
    """Return a JWT role claim when the key is a decodable JWT, without logging it."""

    parts = key.split(".")
    if len(parts) != 3:
        return None
    payload = parts[1]
    padding = "=" * (-len(payload) % 4)
    try:
        decoded = base64.urlsafe_b64decode((payload + padding).encode("ascii"))
        claims = json.loads(decoded.decode("utf-8"))
    except (UnicodeEncodeError, UnicodeDecodeError, binascii.Error, json.JSONDecodeError):
        return None
    role = claims.get("role") if isinstance(claims, dict) else None
    return role if isinstance(role, str) else None


def _is_obvious_public_key(key: str) -> bool:
    lowered = key.lower()
    if lowered.startswith(("sb_publishable_", "sb_anon_", "publishable_", "anon_")):
        return True
    return _jwt_role(key) in {"anon", "authenticated"}


def _validate_service_role_key(environment: Mapping[str, object]) -> str:
    key = _environment_value(environment, "SUPABASE_SERVICE_ROLE_KEY")
    if (
        not key
        or key != key.strip()
        or any(character.isspace() for character in key)
        or len(key) > MAX_SERVICE_ROLE_KEY_LENGTH
        or not key.isascii()
        or _contains_controls(key)
        or _is_obvious_public_key(key)
    ):
        _configuration_error()
    return key


def _parse_url(url: str) -> SplitResult:
    if (
        not url
        or url != url.strip()
        or not url.isascii()
        or _contains_controls(url)
        or "?" in url
        or "#" in url
    ):
        _configuration_error()
    try:
        return urlsplit(url)
    except ValueError:
        _configuration_error()


def _has_root_path(parsed: SplitResult) -> bool:
    return parsed.path in ("", "/") and not parsed.query and not parsed.fragment


def _has_no_credentials(parsed: SplitResult) -> bool:
    return parsed.username is None and parsed.password is None


def _production_url(parsed: SplitResult) -> str | None:
    if parsed.scheme != "https" or not _has_root_path(parsed) or not _has_no_credentials(parsed):
        return None
    try:
        port = parsed.port
    except ValueError:
        return None
    host = parsed.hostname
    if port is not None or host is None or parsed.netloc != host or not PROJECT_HOST_RE.fullmatch(host):
        return None
    return f"https://{host}"


def _loopback_http_is_explicitly_allowed(environment: Mapping[str, object]) -> bool:
    return (
        environment.get(SUPABASE_REST_ALLOW_LOOPBACK_HTTP_ENV) == "1"
        and environment.get(NODE_ENV) in {"development", "test"}
    )


def _loopback_url(parsed: SplitResult) -> str | None:
    if parsed.scheme != "http" or not _has_root_path(parsed) or not _has_no_credentials(parsed):
        return None
    try:
        port = parsed.port
        host = parsed.hostname
        address = ipaddress.ip_address(host) if host is not None else None
    except ValueError:
        return None
    if (
        address is None
        or address not in (ipaddress.ip_address("127.0.0.1"), ipaddress.ip_address("::1"))
        or port == 0
    ):
        return None
    rendered_host = f"[{address.compressed}]" if address.version == 6 else address.compressed
    rendered_port = "" if port in (None, 80) else f":{port}"
    return f"http://{rendered_host}{rendered_port}"


def resolve_privileged_supabase_rest_credentials(
    environment: Mapping[str, object] | None = None,
) -> SupabaseRestCredentials:
    """Resolve the sole privileged Supabase endpoint/key pair or fail closed.

    Only ``SUPABASE_URL`` and ``SUPABASE_SERVICE_ROLE_KEY`` are accepted. HTTP is
    limited to explicitly enabled loopback development or test runtimes.
    """

    resolved_environment: Mapping[str, object] = os.environ if environment is None else environment
    url = _environment_value(resolved_environment, "SUPABASE_URL")
    key = _validate_service_role_key(resolved_environment)
    parsed = _parse_url(url)

    canonical_url = _production_url(parsed)
    if canonical_url is None and _loopback_http_is_explicitly_allowed(resolved_environment):
        canonical_url = _loopback_url(parsed)
    if canonical_url is None:
        _configuration_error()
    return SupabaseRestCredentials(url=canonical_url, service_role_key=key)
