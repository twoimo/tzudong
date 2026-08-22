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
HOSTED_PROJECT_REF = "aqlcofblfxdrjhhdmarw"
HOSTED_REST_REJECTED = "hosted_rest_rejected"


class SupabaseRestConfigurationError(RuntimeError):
    """Fixed, credential-safe error for invalid privileged REST configuration."""

    def __init__(self) -> None:
        super().__init__(SUPABASE_REST_CONFIGURATION_ERROR)


class HostedRestRejected(SupabaseRestConfigurationError):
    """Raised when local_db or live pipeline would use hosted Supabase REST."""

    def __init__(self) -> None:
        RuntimeError.__init__(self, HOSTED_REST_REJECTED)


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
    if str(environment.get("TZUDONG_DATA_ENV") or "").strip() == "local_db":
        return True
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


def rest_url_is_hosted(url: str) -> bool:
    """True when a REST URL targets hosted supabase.co, including the locked project ref."""

    parsed = urlsplit(url)
    host = (parsed.hostname or "").lower()
    return host.endswith(".supabase.co") or HOSTED_PROJECT_REF in host


def live_pipeline_enabled(environment: Mapping[str, object] | None = None) -> bool:
    env = os.environ if environment is None else environment
    return str(env.get("TZUDONG_PIPELINE_LIVE") or "").strip().lower() in {"1", "true", "yes"}


def local_or_live_forbids_hosted_rest(environment: Mapping[str, object] | None = None) -> bool:
    env = os.environ if environment is None else environment
    data_env = str(env.get("TZUDONG_DATA_ENV") or "").strip()
    return data_env == "local_db" or live_pipeline_enabled(env)


def hosted_rest_exit_code(environment: Mapping[str, object] | None = None) -> int:
    """Hosted REST is fail-closed for live and local_db alike."""

    return 1


def live_insert_quota(environment: Mapping[str, object] | None = None) -> int | None:
    """Max new live writes, or None when the pipeline is not live."""

    env = os.environ if environment is None else environment
    if not live_pipeline_enabled(env):
        return None
    raw = str(env.get("LIVE_MAX_NEW_ITEMS") or "1").strip()
    return int(raw) if raw.isdigit() else 1


def bind_local_rest_environment(
    environment: Mapping[str, object] | None = None,
) -> dict[str, object]:
    """Prefer operator loopback REST when local_db or live forbids hosted writes."""

    bound: dict[str, object] = dict(os.environ if environment is None else environment)
    if not local_or_live_forbids_hosted_rest(bound):
        return bound
    local_url = bound.get("TZUDONG_LOCAL_SUPABASE_URL")
    local_key = bound.get("TZUDONG_LOCAL_SUPABASE_SERVICE_ROLE_KEY")
    if isinstance(local_url, str) and local_url.strip():
        bound["SUPABASE_URL"] = local_url.strip()
    if isinstance(local_key, str) and local_key.strip():
        bound["SUPABASE_SERVICE_ROLE_KEY"] = local_key.strip()
    return bound


def resolve_privileged_supabase_rest_credentials(
    environment: Mapping[str, object] | None = None,
) -> SupabaseRestCredentials:
    """Resolve the sole privileged Supabase endpoint/key pair or fail closed.

    Only ``SUPABASE_URL`` and ``SUPABASE_SERVICE_ROLE_KEY`` are accepted. HTTP is
    limited to explicitly enabled loopback development or test runtimes. When
    ``TZUDONG_DATA_ENV=local_db`` or live pipeline is on, hosted supabase.co is
    rejected and ``TZUDONG_LOCAL_SUPABASE_URL`` wins over dotenv hosted URL.
    """

    resolved_environment = bind_local_rest_environment(environment)
    url = _environment_value(resolved_environment, "SUPABASE_URL")
    key = _validate_service_role_key(resolved_environment)
    parsed = _parse_url(url)

    canonical_url = _production_url(parsed)
    if canonical_url is None and _loopback_http_is_explicitly_allowed(resolved_environment):
        canonical_url = _loopback_url(parsed)
    if canonical_url is None:
        _configuration_error()
    if local_or_live_forbids_hosted_rest(resolved_environment) and rest_url_is_hosted(canonical_url):
        raise HostedRestRejected()
    return SupabaseRestCredentials(url=canonical_url, service_role_key=key)
