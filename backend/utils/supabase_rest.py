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
PIPELINE_DATA_SINK_ENV = "TZUDONG_DATA_SINK"
PIPELINE_EXECUTION_MODE_ENV = "TZUDONG_EXECUTION_MODE"
PIPELINE_COMPUTE_PROFILE_ENV = "TZUDONG_COMPUTE_PROFILE"
PIPELINE_HOSTED_APPLY_APPROVED_ENV = "TZUDONG_HOSTED_APPLY_APPROVED"
PIPELINE_HOSTED_PROJECT_REF_ENV = "TZUDONG_HOSTED_PROJECT_REF"
MAX_SERVICE_ROLE_KEY_LENGTH = 4096
PROJECT_HOST_RE = re.compile(r"^[a-z0-9]{20}\.supabase\.co$")
PROJECT_REF_RE = re.compile(r"^[a-z0-9]{20}$")
PIPELINE_DATA_SINKS = frozenset({"local_db", "artifact_only", "hosted_apply"})
PIPELINE_EXECUTION_MODES = frozenset({"dry_run", "live"})
PIPELINE_COMPUTE_PROFILES = frozenset({"heavy_local", "lite_gha"})
PIPELINE_CONTEXT_ENV_NAMES = frozenset(
    {
        PIPELINE_DATA_SINK_ENV,
        PIPELINE_EXECUTION_MODE_ENV,
        PIPELINE_COMPUTE_PROFILE_ENV,
        "TZUDONG_DATA_ENV",
        "TZUDONG_PIPELINE_LIVE",
    }
)
# Hosted data mutation is deliberately outside the automated P1 scope.  A
# later slice may remove this latch only together with operation-bound preview,
# approval, capability, and hosted readback receipts.  Environment variables
# alone must never enable it.
PIPELINE_HOSTED_APPLY_ENABLED = False


class SupabaseRestConfigurationError(RuntimeError):
    """Fixed, credential-safe error for invalid privileged REST configuration."""

    def __init__(self) -> None:
        super().__init__(SUPABASE_REST_CONFIGURATION_ERROR)


@dataclass(frozen=True)
class SupabaseRestCredentials:
    """Canonical endpoint and service-role key for a privileged REST client."""

    url: str
    service_role_key: str


@dataclass(frozen=True)
class PipelineSupabaseBoundary:
    """Non-secret pipeline execution classification used before REST clients."""

    data_sink: str | None
    execution_mode: str | None


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


def _optional_pipeline_value(
    environment: Mapping[str, object],
    name: str,
) -> str | None:
    value = environment.get(name)
    if value is None:
        return None
    if not isinstance(value, str) or not value or value != value.strip():
        _configuration_error()
    return value


def _resolve_pipeline_data_sink(
    environment: Mapping[str, object],
    profile: str | None,
) -> str | None:
    resolved_profile = profile
    if resolved_profile is None:
        resolved_profile = _optional_pipeline_value(
            environment,
            PIPELINE_COMPUTE_PROFILE_ENV,
        )
    if (
        resolved_profile is not None
        and resolved_profile not in PIPELINE_COMPUTE_PROFILES
    ):
        _configuration_error()
    configured = _optional_pipeline_value(environment, PIPELINE_DATA_SINK_ENV)
    if configured is None:
        if resolved_profile == "lite_gha":
            configured = "artifact_only"
        elif resolved_profile == "heavy_local":
            configured = "local_db"
        elif environment.get("TZUDONG_DATA_ENV") == "local_db":
            # Backward-compatible safety for the existing pipeline environment.
            # This intentionally treats the old control-DB flag as a local data
            # boundary until every caller supplies TZUDONG_DATA_SINK explicitly.
            configured = "local_db"
    if configured is not None and configured not in PIPELINE_DATA_SINKS:
        _configuration_error()
    return configured


def _resolve_pipeline_execution_mode(
    environment: Mapping[str, object],
    execution_mode: str | None,
) -> str | None:
    configured = execution_mode
    if configured is None:
        configured = _optional_pipeline_value(environment, PIPELINE_EXECUTION_MODE_ENV)
    if configured is not None and configured not in PIPELINE_EXECUTION_MODES:
        _configuration_error()
    return configured


def admit_pipeline_supabase_boundary(
    environment: Mapping[str, object] | None = None,
    *,
    profile: str | None = None,
    execution_mode: str | None = None,
) -> PipelineSupabaseBoundary:
    """Fail closed on a hosted REST endpoint before any pipeline client use.

    Local and artifact-only executions may carry no Supabase URL or an explicit
    loopback URL.  A hosted endpoint is admitted only by the separately named
    ``hosted_apply`` sink with an exact project-ref binding and explicit runtime
    approval.  The function performs no network access and never returns keys.
    """

    resolved_environment: Mapping[str, object] = (
        os.environ if environment is None else environment
    )
    data_sink = _resolve_pipeline_data_sink(resolved_environment, profile)
    mode = _resolve_pipeline_execution_mode(resolved_environment, execution_mode)
    pipeline_context = bool(
        profile is not None
        or execution_mode is not None
        or any(name in resolved_environment for name in PIPELINE_CONTEXT_ENV_NAMES)
    )
    raw_url = resolved_environment.get("SUPABASE_URL")

    if raw_url is None or raw_url == "":
        if data_sink == "hosted_apply":
            _configuration_error()
        return PipelineSupabaseBoundary(data_sink=data_sink, execution_mode=mode)
    if not isinstance(raw_url, str):
        _configuration_error()
    parsed = _parse_url(raw_url)

    # A hosted endpoint in any explicitly marked pipeline context must never
    # fall through the ordinary non-pipeline hosted client path.  Every
    # pipeline caller must classify its sink before a client or runner exists.
    if pipeline_context and data_sink is None:
        _configuration_error()

    if data_sink in {"local_db", "artifact_only"}:
        if _loopback_url(parsed) is None:
            _configuration_error()
    elif data_sink == "hosted_apply":
        if not PIPELINE_HOSTED_APPLY_ENABLED:
            _configuration_error()
        canonical_url = _production_url(parsed)
        project_ref = _optional_pipeline_value(
            resolved_environment,
            PIPELINE_HOSTED_PROJECT_REF_ENV,
        )
        expected_url = (
            f"https://{project_ref}.supabase.co"
            if project_ref is not None and PROJECT_REF_RE.fullmatch(project_ref)
            else None
        )
        if (
            mode != "live"
            or resolved_environment.get(PIPELINE_HOSTED_APPLY_APPROVED_ENV) != "1"
            or canonical_url is None
            or canonical_url != expected_url
        ):
            _configuration_error()

    return PipelineSupabaseBoundary(data_sink=data_sink, execution_mode=mode)



HOSTED_PROJECT_REF = "aqlcofblfxdrjhhdmarw"
HOSTED_REST_REJECTED = "hosted_rest_rejected"


class HostedRestRejected(SupabaseRestConfigurationError):
    """Hosted REST is refused for local_db or live pipeline execution."""

    def __init__(self) -> None:
        super().__init__(HOSTED_REST_REJECTED)


def live_pipeline_enabled(environment: Mapping[str, object] | None = None) -> bool:
    env = os.environ if environment is None else environment
    return str(env.get("TZUDONG_PIPELINE_LIVE") or "").strip() == "1"


def local_or_live_forbids_hosted_rest(environment: Mapping[str, object] | None = None) -> bool:
    env = os.environ if environment is None else environment
    return str(env.get("TZUDONG_DATA_ENV") or "").strip() == "local_db" or live_pipeline_enabled(env)


def hosted_rest_exit_code(environment: Mapping[str, object] | None = None) -> int:
    return 1


def live_insert_quota(environment: Mapping[str, object] | None = None) -> int | None:
    """Max new live writes, or None when the pipeline is not live."""

    env = os.environ if environment is None else environment
    if not live_pipeline_enabled(env):
        return None
    raw = str(env.get("LIVE_MAX_NEW_ITEMS") or "1").strip()
    return int(raw) if raw.isdigit() else 1


def rest_url_is_hosted(url: str) -> bool:
    host = url.split("://", 1)[-1].split("/", 1)[0].split(":", 1)[0].lower()
    return host.endswith(".supabase.co") or HOSTED_PROJECT_REF in host


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
    limited to explicitly enabled loopback development or test runtimes.
    """

    resolved_environment = bind_local_rest_environment(environment)
    url = _environment_value(resolved_environment, "SUPABASE_URL")
    key = _validate_service_role_key(resolved_environment)
    parsed = _parse_url(url)

    # The pipeline boundary is deliberately checked inside the shared resolver
    # as defense in depth.  Numbered scripts cannot construct a privileged
    # client with a hosted URL while classified local/artifact-only even if a
    # worker preflight was accidentally skipped.
    admit_pipeline_supabase_boundary(resolved_environment)

    canonical_url = _production_url(parsed)
    if canonical_url is None and _loopback_http_is_explicitly_allowed(resolved_environment):
        canonical_url = _loopback_url(parsed)
    if canonical_url is None:
        _configuration_error()
    if local_or_live_forbids_hosted_rest(resolved_environment) and rest_url_is_hosted(canonical_url):
        raise HostedRestRejected()
    return SupabaseRestCredentials(url=canonical_url, service_role_key=key)
