"""Fail-closed DSN / data-env admission. Host classes match verified-pg-client.mjs."""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from backend.utils.privacy_log import safe_error_name, sanitize_log_value

FIXTURE_PATH = (
    Path(__file__).resolve().parents[1]
    / "deploy"
    / "pipeline-control"
    / "fixtures"
    / "pg-host-classes.v1.json"
)
HOSTED_PROJECT_REF = "aqlcofblfxdrjhhdmarw"
ALLOWED_DATA_ENVS = frozenset({"local_db", "hosting_db"})

_DIRECT_RE: re.Pattern[str] | None = None
_POOLER_RE: re.Pattern[str] | None = None
_FIXTURE: dict[str, Any] | None = None


class DsnGuardError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def load_host_class_fixture() -> dict[str, Any]:
    global _FIXTURE, _DIRECT_RE, _POOLER_RE
    if _FIXTURE is None:
        _FIXTURE = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
        _DIRECT_RE = re.compile(str(_FIXTURE["directDatabaseHostPattern"]))
        _POOLER_RE = re.compile(str(_FIXTURE["poolerHostPattern"]))
    return _FIXTURE


def normalize_hostname(hostname: str) -> str:
    return str(hostname or "").lower().strip().strip("[]")


def is_loopback_pg_host(hostname: str) -> bool:
    fixture = load_host_class_fixture()
    host = normalize_hostname(hostname)
    if host in fixture["loopbackExact"]:
        return True
    octets = host.split(".")
    if len(octets) != 4:
        return False
    try:
        parts = [int(part) for part in octets]
    except ValueError:
        return False
    return all(0 <= part <= 255 for part in parts) and parts[0] == int(
        fixture["loopbackIpv4Octet0"]
    )


def is_supabase_production_pg_host(hostname: str) -> bool:
    load_host_class_fixture()
    host = normalize_hostname(hostname)
    assert _DIRECT_RE is not None and _POOLER_RE is not None
    return bool(_DIRECT_RE.fullmatch(host) or _POOLER_RE.fullmatch(host))


def extract_project_ref(hostname: str, username: str = "") -> str | None:
    load_host_class_fixture()
    host = normalize_hostname(hostname)
    assert _DIRECT_RE is not None
    match = _DIRECT_RE.fullmatch(host)
    if match:
        return host.split(".")[1]
    user = unquote(username or "")
    if user.startswith("postgres.") and len(user) > len("postgres."):
        return user.split(".", 1)[1]
    return None


def classify_data_env(raw: str | None) -> str:
    value = (raw or "").strip()
    if value not in ALLOWED_DATA_ENVS:
        raise DsnGuardError("data_env_invalid")
    return value


def admit_dsn(*, data_env: str | None, dsn: str | None) -> dict[str, Any]:
    env = classify_data_env(data_env)
    if not dsn or not str(dsn).strip():
        raise DsnGuardError("dsn_required")
    try:
        parsed = urlparse(str(dsn).strip())
    except Exception as exc:
        raise DsnGuardError("dsn_invalid") from exc
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise DsnGuardError("dsn_invalid")
    host = normalize_hostname(parsed.hostname or "")
    if not host:
        raise DsnGuardError("dsn_invalid")
    ref = extract_project_ref(host, parsed.username or "")
    if env == "local_db":
        forbidden = set(load_host_class_fixture()["forbiddenLocalProjectRefs"])
        if ref in forbidden or (ref is None and is_supabase_production_pg_host(host)):
            raise DsnGuardError("hosted_dsn_rejected")
        if not is_loopback_pg_host(host):
            raise DsnGuardError("local_dsn_host_rejected")
    return {
        "dataEnv": env,
        "hostClass": "loopback" if is_loopback_pg_host(host) else "remote",
        "projectRefAdmitted": ref not in set(
            load_host_class_fixture()["forbiddenLocalProjectRefs"]
        )
        if env == "local_db"
        else True,
    }


def bounded_error(code: str) -> dict[str, str]:
    return {"error": sanitize_log_value(code), "errorName": safe_error_name(DsnGuardError(code))}
