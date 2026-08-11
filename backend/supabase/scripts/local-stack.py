#!/usr/bin/env python3
"""Bounded, local-only lifecycle for the pinned Supabase Compose stack.

The command surface is intentionally small: render, start, stop, reset, and
status.  No repository .env file, Supabase CLI, reset helper, cloud endpoint, or
unscoped Docker cleanup is ever consulted.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import re
import os
import secrets
import shutil
import socket
import signal
import ssl
import stat
import subprocess
import sys
import time
import unicodedata
from pathlib import Path
from typing import Any, Iterable, Mapping
from urllib.parse import urlparse
from urllib.error import HTTPError
from urllib.request import HTTPSHandler, HTTPRedirectHandler, Request, build_opener

COMPOSE_VERSION = "v2.39.4"
GENERATOR_VERSION = "local-stack-v1"
COMPOSE_START_TIMEOUT_SECONDS = 600
EXPECTED_SERVICES = (
    "analytics", "auth", "db", "functions", "imgproxy", "kong", "mail",
    "meta", "realtime", "rest", "storage", "studio", "supavisor", "vector",
)
TRACKED_SQL = {
    "db-realtime.sql": "volumes/db/realtime.sql",
    "db-webhooks.sql": "volumes/db/webhooks.sql",
    "db-roles.sql": "volumes/db/roles.sql",
    "db-jwt.sql": "volumes/db/jwt.sql",
    "db-supabase.sql": "volumes/db/_supabase.sql",
    "db-logs.sql": "volumes/db/logs.sql",
    "db-pooler.sql": "volumes/db/pooler.sql",
}
DESTINATIONS = {
    "/home/kong/temp.yml", "/etc/vector/vector.yml", "/etc/pooler/pooler.exs",
    "/var/lib/postgresql/data", "/etc/postgresql-custom", "/var/lib/storage",
    "/home/deno/functions", "/docker-entrypoint-initdb.d/migrations/99-realtime.sql",
    "/docker-entrypoint-initdb.d/init-scripts/98-webhooks.sql",
    "/docker-entrypoint-initdb.d/init-scripts/99-roles.sql",
    "/docker-entrypoint-initdb.d/init-scripts/99-jwt.sql",
    "/docker-entrypoint-initdb.d/migrations/97-_supabase.sql",
    "/docker-entrypoint-initdb.d/migrations/99-logs.sql",
    "/docker-entrypoint-initdb.d/migrations/99-pooler.sql",
}
PORT_KEYS = (
    "KONG_HTTP_PORT", "KONG_HTTPS_PORT", "STUDIO_PORT", "META_PORT",
    "ANALYTICS_PORT", "POSTGRES_HOST_PORT", "POOLER_PROXY_PORT_TRANSACTION",
    "MAIL_SMTP_PORT", "MAIL_WEB_PORT", "MAIL_POP3_PORT",
)
INTERNAL_PORT_KEYS = ("POSTGRES_PORT",)
LOCAL_URL_KEYS = ("SITE_URL", "API_EXTERNAL_URL", "SUPABASE_PUBLIC_URL")
DOCKER_SOCKET_DEFAULT = Path("/var/run/docker.sock")
DOCKER_SOCKET_DOCKER_DESKTOP = ".docker/run/docker.sock"
DOCKER_SOCKET_COLIMA = ".colima/default/docker.sock"
TARGET_VOLUME_SUFFIXES = ("db-data", "db-config", "storage-data")
DOCKER_PROJECT_LABEL = "com.docker.compose.project"
DOCKER_VOLUME_LABEL = "com.docker.compose.volume"
DOCKER_SERVICE_LABEL = "com.docker.compose.service"

TRACKED_INPUT_MANIFEST = "local-inputs/manifest.v1.json"
INPUT_MANIFEST_SCHEMA = "local-stack-input-manifest-v1"
LOCAL_INPUT_FILES = ("kong.yml", "vector.yml", "pooler.exs", "functions/main/index.ts")
FUNCTIONS_ROOT = "functions"
FUNCTIONS_FILES = ("functions/main/index.ts",)

READINESS_ENDPOINTS = {
    "db": ("pg_isready", "-U", "postgres", "-h", "127.0.0.1", "-p", "5432"),
    "kong": ("wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:8000/auth/v1/health"),
    "rest": ("wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:3000/"),
    "auth": ("wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:9999/health"),
    "storage": ("wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:5000/status"),
    "realtime": ("curl", "-fsS", "-o", "/dev/null", "http://127.0.0.1:4000/api/tenants/realtime-dev/health"),
    "studio": ("node", "-e", "fetch('http://127.0.0.1:3000/api/platform/profile').then((r) => {if (!r.ok) process.exit(1)})"),
    "meta": ("wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:8080/"),
    "analytics": ("curl", "-fsS", "-o", "/dev/null", "http://127.0.0.1:4000/health"),
    "supavisor": ("curl", "-fsS", "-o", "/dev/null", "http://127.0.0.1:4000/api/health"),
    "vector": ("wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:9001/health"),
    "functions": ("wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:9000/"),
    "imgproxy": ("imgproxy", "health"),
    "mail": ("wget", "--no-verbose", "--tries=1", "--spider", "http://127.0.0.1:9000/"),
}
READINESS_REQUIRED = tuple(READINESS_ENDPOINTS)
CORE_REQUIRED = tuple(service for service in READINESS_REQUIRED if service != "studio")
CORE_SERVICES = tuple(service for service in EXPECTED_SERVICES if service != "studio")
_ACTIVE_COMMAND: list[str] | None = None


class _NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(
        self,
        _request: Request,
        _file: Any,
        _code: int,
        _message: str,
        _headers: Any,
        _new_url: str,
    ) -> None:
        return None


_NO_REDIRECT_OPENER = build_opener(_NoRedirectHandler)
_LOCAL_HTTPS_NO_REDIRECT_OPENER = build_opener(
    _NoRedirectHandler,
    HTTPSHandler(context=ssl._create_unverified_context()),
)

class LocalStackError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _fail(code: str) -> None:
    raise LocalStackError(code)


def _hash_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _hash_file(path: Path) -> str:
    try:
        with path.open("rb") as handle:
            digest = hashlib.sha256()
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
            return digest.hexdigest()
    except OSError:
        _fail("input_read")
    return ""  # unreachable


def _regular_owned(path: Path, *, mode: int | None = None) -> os.stat_result:
    try:
        info = path.lstat()
    except OSError:
        _fail("input_missing")
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        _fail("input_not_regular")
    if info.st_uid != os.getuid():
        _fail("input_owner")
    if mode is not None and stat.S_IMODE(info.st_mode) != mode:
        _fail("input_mode")
    return info


def _secure_dir(path: Path) -> None:
    try:
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
            _fail("state_root")
        if info.st_uid != os.getuid():
            _fail("state_owner")
    except FileNotFoundError:
        try:
            path.mkdir(mode=0o700, parents=False)
        except OSError:
            _fail("state_create")
        return
    except OSError:
        _fail("state_root")
    try:
        path.chmod(0o700)
    except OSError:
        _fail("state_mode")


def _atomic_write(path: Path, content: bytes, mode: int = 0o600) -> None:
    _secure_dir(path.parent)
    try:
        existing = path.lstat()
    except FileNotFoundError:
        existing = None
    except OSError:
        _fail("state_write")
    if existing is not None and (stat.S_ISLNK(existing.st_mode) or not stat.S_ISREG(existing.st_mode) or existing.st_uid != os.getuid()):
        _fail("state_write")
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        if tmp.exists() or tmp.is_symlink():
            tmp.unlink()
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
        with os.fdopen(fd, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
        path.chmod(mode)
    except OSError:
        try:
            tmp.unlink()
        except OSError:
            pass
        _fail("state_write")


def _repository_root(value: str | None) -> Path:
    path = Path(value).expanduser() if value else Path(__file__).resolve().parents[3]
    try:
        path = path.resolve(strict=True)
    except OSError:
        _fail("repository_root")
    if not (path / "backend" / "supabase" / "docker-compose.yml").is_file():
        _fail("repository_root")
    return path


def _project_name(root: Path) -> str:
    return "tzudong-local-" + hashlib.sha256(str(root).encode("utf-8")).hexdigest()[:12]


def _state_root(root: Path, project: str) -> Path:
    parent = root / "backend" / "supabase" / "volumes" / ".local-stack"
    try:
        parent_info = parent.lstat()
    except FileNotFoundError:
        parent_info = None
    except OSError:
        _fail("state_root")
    if parent_info is not None and (stat.S_ISLNK(parent_info.st_mode) or not stat.S_ISDIR(parent_info.st_mode)):
        _fail("state_root")
    _secure_dir(parent)
    path = parent / project
    try:
        state_info = path.lstat()
    except FileNotFoundError:
        state_info = None
    except OSError:
        _fail("state_root")
    if state_info is not None and stat.S_ISLNK(state_info.st_mode):
        _fail("state_root")
    try:
        path = path.resolve()
        parent = parent.resolve()
    except OSError:
        _fail("state_root")
    if path.parent != parent or path == parent or path == root:
        _fail("state_root")
    return path


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _jwt(secret: str, role: str) -> str:
    header = _b64(b'{"alg":"HS256","typ":"JWT"}')
    payload = _b64(json.dumps({"role": role, "iss": "supabase", "exp": 4102444800}, separators=(",", ":")).encode("ascii"))
    message = f"{header}.{payload}".encode("ascii")
    signature = _b64(hmac.new(secret.encode("ascii"), message, hashlib.sha256).digest())
    return f"{header}.{payload}.{signature}"


def _env_values(root: Path, project: str, state: Path) -> dict[str, str]:
    jwt_secret = secrets.token_urlsafe(48)
    try:
        port_base = int(os.environ.get("LOCAL_STACK_PORT_BASE", "8000"))
    except ValueError:
        _fail("port_shape")
    if not 1024 <= port_base <= 55000:
        _fail("port_shape")
    ports = {
        "KONG_HTTP_PORT": port_base,
        "KONG_HTTPS_PORT": port_base + 443,
        "STUDIO_PORT": port_base + 1000,
        "META_PORT": port_base + 555,
        "ANALYTICS_PORT": port_base + 4000,
        "POSTGRES_HOST_PORT": port_base + 5432,
        "POOLER_PROXY_PORT_TRANSACTION": port_base + 6543 if port_base != 8000 else 6543,
        "MAIL_SMTP_PORT": port_base + 2500,
        "MAIL_WEB_PORT": port_base + 900,
        "MAIL_POP3_PORT": port_base + 1100,
    }
    if any(port > 65535 for port in ports.values()) or len(set(ports.values())) != len(ports):
        _fail("port_shape")
    values = {
        "PROJECT_NAME": project,
        "LOCAL_STATE_ROOT": str(state),
        "LOCAL_INPUT_ROOT": str(state / "inputs"),
        "POSTGRES_PASSWORD": secrets.token_urlsafe(32),
        "NIGHTLY_ADMIN_EMAIL": "nightly-ci@local.invalid",
        "NIGHTLY_ADMIN_PASSWORD": secrets.token_urlsafe(24),
        "JWT_SECRET": jwt_secret,
        "ANON_KEY": _jwt(jwt_secret, "anon"),
        "SERVICE_ROLE_KEY": _jwt(jwt_secret, "service_role"),
        "DASHBOARD_USERNAME": "supabase",
        "DASHBOARD_PASSWORD": secrets.token_urlsafe(24),
        "SECRET_KEY_BASE": secrets.token_hex(48),
        "VAULT_ENC_KEY": secrets.token_hex(16),
        "PG_META_CRYPTO_KEY": secrets.token_hex(16),
        "POSTGRES_HOST": "db",
        "POSTGRES_DB": "postgres",
        "POSTGRES_PORT": "5432",
        "POSTGRES_HOST_PORT": str(ports["POSTGRES_HOST_PORT"]),
        "POOLER_PROXY_PORT_TRANSACTION": str(ports["POOLER_PROXY_PORT_TRANSACTION"]),
        "POOLER_DEFAULT_POOL_SIZE": "20",
        "POOLER_MAX_CLIENT_CONN": "100",
        "POOLER_TENANT_ID": "local",
        "POOLER_DB_POOL_SIZE": "5",
        "KONG_HTTP_PORT": str(ports["KONG_HTTP_PORT"]),
        "KONG_HTTPS_PORT": str(ports["KONG_HTTPS_PORT"]),
        "STUDIO_PORT": str(ports["STUDIO_PORT"]),
        "META_PORT": str(ports["META_PORT"]),
        "ANALYTICS_PORT": str(ports["ANALYTICS_PORT"]),
        "PGRST_DB_SCHEMAS": "public,storage,graphql_public",
        "SITE_URL": "http://127.0.0.1:3000",
        "ADDITIONAL_REDIRECT_URLS": "http://127.0.0.1:3000",
        "JWT_EXPIRY": "3600",
        "DISABLE_SIGNUP": "false",
        "API_EXTERNAL_URL": f"http://127.0.0.1:{ports['KONG_HTTP_PORT']}",
        "MAILER_URLPATHS_CONFIRMATION": "/auth/v1/verify",
        "MAILER_URLPATHS_INVITE": "/auth/v1/verify",
        "MAILER_URLPATHS_RECOVERY": "/auth/v1/verify",
        "MAILER_URLPATHS_EMAIL_CHANGE": "/auth/v1/verify",
        "ENABLE_EMAIL_SIGNUP": "true",
        "ENABLE_EMAIL_AUTOCONFIRM": "false",
        "SMTP_ADMIN_EMAIL": "admin@local.invalid",
        "SMTP_HOST": "mail",
        "SMTP_PORT": "2500",
        "SMTP_USER": "local",
        "SMTP_PASS": secrets.token_urlsafe(20),
        "SMTP_SENDER_NAME": "local",
        "ENABLE_ANONYMOUS_USERS": "false",
        "ENABLE_PHONE_SIGNUP": "false",
        "ENABLE_PHONE_AUTOCONFIRM": "false",
        "STUDIO_DEFAULT_ORGANIZATION": "Local",
        "STUDIO_DEFAULT_PROJECT": "Local",
        "SUPABASE_PUBLIC_URL": f"http://127.0.0.1:{ports['KONG_HTTP_PORT']}",
        "IMGPROXY_ENABLE_WEBP_DETECTION": "true",
        "OPENAI_API_KEY": "",
        "FUNCTIONS_VERIFY_JWT": "false",
        "LOGFLARE_PUBLIC_ACCESS_TOKEN": secrets.token_urlsafe(24),
        "LOGFLARE_PRIVATE_ACCESS_TOKEN": secrets.token_urlsafe(24),
        # The local overlay removes the base socket mount.  This sentinel is
        # intentionally not a host socket and is never emitted in the model.
        "DOCKER_SOCKET_LOCATION": "/var/empty/local-stack.sock",
        "LOCAL_STACK_GENERATOR_VERSION": GENERATOR_VERSION,
        "MAIL_SMTP_PORT": str(ports["MAIL_SMTP_PORT"]),
        "MAIL_WEB_PORT": str(ports["MAIL_WEB_PORT"]),
        "MAIL_POP3_PORT": str(ports["MAIL_POP3_PORT"]),
        "NIGHTLY_LOCAL_ENV_ONLY": "1",
        "NIGHTLY_ENV_FILE_ONLY": "1",
        "NODE_ENV": "test",
    }
    values["SUPABASE_DB_URL"] = (
        f"postgresql://postgres:{values['POSTGRES_PASSWORD']}@127.0.0.1:"
        f"{values['POSTGRES_HOST_PORT']}/postgres"
    )
    return values


def _write_env(root: Path, project: str, state: Path) -> tuple[Path, dict[str, str]]:
    _secure_dir(state)
    inputs = state / "inputs"
    _secure_dir(inputs)
    env_path = state / "stack.env"
    values = _env_values(root, project, state)
    lines = [f"{key}={values[key]}" for key in sorted(values)]
    raw = ("\n".join(lines) + "\n").encode("utf-8")
    _atomic_write(env_path, raw, 0o600)
    provenance = {
        "schema": "local-stack-env-provenance-v1",
        "generator_version": GENERATOR_VERSION,
        "project_name": project,
        "env_file": "stack.env",
        "env_file_sha256": _hash_bytes(raw),
        "env_file_mode": "0600",
        "keys": sorted(values),
        "local_url_keys": list(LOCAL_URL_KEYS),
        "secret_values_included": False,
    }
    _atomic_write(state / "stack.env.provenance.json", (json.dumps(provenance, sort_keys=True, separators=(",", ":")) + "\n").encode("ascii"), 0o600)
    return env_path, values


def _parse_env(path: Path) -> dict[str, str]:
    _regular_owned(path, mode=0o600)
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError):
        _fail("env_read")
    values: dict[str, str] = {}
    for line in lines:
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            _fail("env_shape")
        key, value = line.split("=", 1)
        if not key or key in values or any(ch not in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_" for ch in key):
            _fail("env_shape")
        values[key] = value
    return values


def _validate_env(values: dict[str, str], project: str, state: Path) -> None:
    required = {"PROJECT_NAME", "LOCAL_STATE_ROOT", "LOCAL_INPUT_ROOT", *PORT_KEYS, *INTERNAL_PORT_KEYS, *LOCAL_URL_KEYS, "SUPABASE_DB_URL"}
    if not required.issubset(values) or values["PROJECT_NAME"] != project:
        _fail("env_provenance")
    if set(values) != set(_env_values(Path("."), project, state)):
        _fail("env_provenance")
    fixed_values = {
        "PROJECT_NAME": project,
        "POSTGRES_HOST": "db",
        "POSTGRES_DB": "postgres",
        "POSTGRES_PORT": "5432",
        "NIGHTLY_ADMIN_EMAIL": "nightly-ci@local.invalid",
        "OPENAI_API_KEY": "",
        "DOCKER_SOCKET_LOCATION": "/var/empty/local-stack.sock",
        "LOCAL_STACK_GENERATOR_VERSION": GENERATOR_VERSION,
        "NIGHTLY_LOCAL_ENV_ONLY": "1",
        "NIGHTLY_ENV_FILE_ONLY": "1",
        "NODE_ENV": "test",
    }
    if any(values.get(key) != expected for key, expected in fixed_values.items()):
        _fail("env_provenance")
    if Path(values["LOCAL_STATE_ROOT"]).resolve() != state.resolve() or Path(values["LOCAL_INPUT_ROOT"]).resolve() != (state / "inputs").resolve():
        _fail("env_provenance")
    for key in LOCAL_URL_KEYS:
        parsed = urlparse(values[key])
        if parsed.scheme != "http" or parsed.hostname != "127.0.0.1":
            _fail("non_loopback_url")
    if values.get("POSTGRES_HOST") != "db" or values.get("POSTGRES_PORT") != "5432" or values.get("DOCKER_SOCKET_LOCATION", "").startswith("/var/run/docker.sock"):
        _fail("env_provenance")
    database = urlparse(values["SUPABASE_DB_URL"])
    if (
        database.scheme not in {"postgres", "postgresql"}
        or database.hostname != "127.0.0.1"
        or database.username != "postgres"
        or database.password != values["POSTGRES_PASSWORD"]
        or int(database.port or 5432) != int(values["POSTGRES_HOST_PORT"])
    ):
        _fail("env_provenance")
    ports: list[int] = []
    for key in (*PORT_KEYS, *INTERNAL_PORT_KEYS):
        try:
            port = int(values[key])
        except ValueError:
            _fail("port_shape")
        if not 1 <= port <= 65535:
            _fail("port_shape")
        if key in PORT_KEYS:
            ports.append(port)
    if len(ports) != len(set(ports)) or int(values["POSTGRES_HOST_PORT"]) == int(values["POSTGRES_PORT"]):
        _fail("port_shape")


def _ensure_env(root: Path, project: str, state: Path, *, regenerate: bool = False) -> tuple[Path, dict[str, str]]:
    _secure_dir(state)
    env_path = state / "stack.env"
    provenance_path = state / "stack.env.provenance.json"
    if regenerate or not env_path.exists():
        return _write_env(root, project, state)
    values = _parse_env(env_path)
    _regular_owned(provenance_path, mode=0o600)
    try:
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, UnicodeError):
        _fail("env_provenance")
    if provenance.get("schema") != "local-stack-env-provenance-v1" or provenance.get("project_name") != project or provenance.get("env_file_sha256") != _hash_file(env_path) or provenance.get("secret_values_included") is not False:
        _fail("env_provenance")
    _validate_env(values, project, state)
    return env_path, values


def _template_root(root: Path) -> Path:
    return root / "backend" / "supabase" / "local-inputs"


def _load_input_manifest(root: Path) -> tuple[Path, dict[str, Any]]:
    path = _template_root(root) / "manifest.v1.json"
    _regular_owned(path)
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError):
        _fail("input_manifest")
    if not isinstance(document, dict) or document.get("schema") != INPUT_MANIFEST_SCHEMA or document.get("generator_version") != GENERATOR_VERSION:
        _fail("input_manifest")
    inputs = document.get("inputs")
    mounts = document.get("mounts")
    functions = document.get("functions")
    if not isinstance(inputs, list) or not isinstance(mounts, list) or not isinstance(functions, dict):
        _fail("input_manifest")
    compose_files = document.get("compose_files")
    if not isinstance(compose_files, list) or len(compose_files) != 3:
        _fail("input_manifest")
    expected_compose_files = {
        "backend/supabase/docker-compose.yml",
        "backend/supabase/docker-compose.local.yml",
        "backend/supabase/docker-compose.mail.yml",
    }
    seen_compose_files: set[str] = set()
    for entry in compose_files:
        if (
            not isinstance(entry, dict)
            or not isinstance(entry.get("path"), str)
            or not isinstance(entry.get("sha256"), str)
            or not re.fullmatch(r"[0-9a-f]{64}", entry["sha256"])
            or entry["path"] not in expected_compose_files
            or entry["path"] in seen_compose_files
        ):
            _fail("input_manifest")
        seen_compose_files.add(entry["path"])
    if seen_compose_files != expected_compose_files:
        _fail("input_manifest")
    outputs: set[str] = set()
    for entry in inputs:
        if not isinstance(entry, dict) or not isinstance(entry.get("output"), str) or entry["output"] in outputs:
            _fail("input_manifest")
        output = Path(entry["output"])
        if output.is_absolute() or ".." in output.parts:
            _fail("input_manifest")
        if entry.get("kind") not in {"template", "source"} or not isinstance(entry.get("service"), str) or not isinstance(entry.get("destination"), str):
            _fail("input_manifest")
        if entry.get("output_mode") != "0600" or not isinstance(entry.get("output_sha256"), str):
            _fail("input_manifest")
        outputs.add(entry["output"])
        if entry["kind"] == "template":
            if not isinstance(entry.get("template"), str) or not isinstance(entry.get("template_sha256"), str) or not isinstance(entry.get("template_mode"), str):
                _fail("input_manifest")
            template = Path(entry["template"])
            if template.is_absolute() or ".." in template.parts:
                _fail("input_manifest")
        elif not isinstance(entry.get("source"), str) or not isinstance(entry.get("source_sha256"), str) or not isinstance(entry.get("source_mode"), str):
            _fail("input_manifest")
        else:
            source = Path(entry["source"])
            if source.is_absolute() or ".." in source.parts:
                _fail("input_manifest")
        if entry["output_sha256"] != (entry.get("template_sha256") or entry.get("source_sha256")):
            _fail("input_manifest")
    if outputs != set(LOCAL_INPUT_FILES) | set(TRACKED_SQL):
        _fail("input_manifest")
    expected_functions = functions.get("files")
    if not isinstance(expected_functions, list) or functions.get("root") != FUNCTIONS_ROOT or expected_functions != list(FUNCTIONS_FILES) or any(item not in outputs for item in expected_functions):
        _fail("input_manifest")
    if any(not isinstance(item, dict) or item.get("type") not in {"bind", "volume"} or not isinstance(item.get("service"), str) or not isinstance(item.get("source"), str) or not isinstance(item.get("destination"), str) for item in mounts):
        _fail("input_manifest")
    if len({(item["service"], item["destination"]) for item in mounts}) != len(mounts):
        _fail("input_manifest")
    return path, document


def _assert_input_tree(input_root: Path, outputs: set[str]) -> None:
    expected_files = {Path(item) for item in outputs}
    expected_dirs = {Path("."), Path(FUNCTIONS_ROOT), Path(FUNCTIONS_ROOT) / "main"}
    try:
        entries = list(input_root.rglob("*"))
    except OSError:
        _fail("input_tree")
    for path in entries:
        relative = path.relative_to(input_root)
        try:
            info = path.lstat()
        except OSError:
            _fail("input_tree")
        if stat.S_ISLNK(info.st_mode):
            _fail("input_tree")
        if stat.S_ISDIR(info.st_mode):
            if relative not in expected_dirs or info.st_uid != os.getuid():
                _fail("input_tree")
        elif relative not in expected_files or info.st_uid != os.getuid() or not stat.S_ISREG(info.st_mode):
            _fail("input_tree")
def _validate_output(path: Path, expected_sha256: str) -> None:
    try:
        info = path.lstat()
    except FileNotFoundError:
        return
    except OSError:
        _fail("input_output")
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
        _fail("input_output")
    if _hash_file(path) != expected_sha256:
        _fail("input_output_mismatch")


def _write_input(
    path: Path,
    content: bytes,
    records: list[dict[str, Any]],
    *,
    entry: dict[str, Any],
    source_mode: str,
    template_mode: str | None = None,
    source_sha256: str,
    template_sha256: str | None = None,
) -> None:
    _atomic_write(path, content, 0o600)
    output_sha256 = _hash_bytes(content)
    record: dict[str, Any] = {
        "path": entry["output"],
        "source": entry.get("source") or entry.get("template"),
        "source_sha256": source_sha256,
        "source_mode": source_mode,
        "output_sha256": output_sha256,
        "sha256": output_sha256,
        "output_mode": "0600",
        "bytes": len(content),
        "service": entry["service"],
        "destination": entry["destination"],
    }
    if template_sha256 is not None:
        record.update({"template_sha256": template_sha256, "template_mode": template_mode})
    records.append(record)


def _ensure_inputs(root: Path, project: str, state: Path) -> dict[str, Any]:
    manifest_path, source_manifest = _load_input_manifest(root)
    input_root = state / "inputs"
    _secure_dir(input_root)
    outputs = {entry["output"] for entry in source_manifest["inputs"]}
    _assert_input_tree(input_root, outputs)
    for output in outputs:
        current = input_root
        relative_parent = (input_root / output).parent.relative_to(input_root)
        for part in relative_parent.parts:
            current = current / part
            _secure_dir(current)
    records: list[dict[str, Any]] = []
    template_root = _template_root(root)
    supabase_root = root / "backend" / "supabase"
    for entry in source_manifest["inputs"]:
        if entry["kind"] == "template":
            source_path = template_root / entry["template"]
            info = _regular_owned(source_path)
            actual_mode = f"{stat.S_IMODE(info.st_mode):04o}"
            if actual_mode != entry["template_mode"] or _hash_file(source_path) != entry["template_sha256"]:
                _fail("input_template_mismatch")
            source_bytes = source_path.read_bytes()
            source_hash = entry["template_sha256"]
            source_mode = actual_mode
            template_hash = source_hash
            template_mode = actual_mode
        else:
            source_path = supabase_root / entry["source"]
            info = _regular_owned(source_path)
            actual_mode = f"{stat.S_IMODE(info.st_mode):04o}"
            if actual_mode != entry["source_mode"] or _hash_file(source_path) != entry["source_sha256"]:
                _fail("input_source_mismatch")
            source_bytes = source_path.read_bytes()
            source_hash = entry["source_sha256"]
            source_mode = actual_mode
            template_hash = None
            template_mode = None
        output_path = input_root / entry["output"]
        _validate_output(output_path, source_hash)
        _write_input(
            output_path,
            source_bytes,
            records,
            entry=entry,
            source_mode=source_mode,
            template_mode=template_mode,
            source_sha256=source_hash,
            template_sha256=template_hash,
        )
    provenance = {
        "schema": "local-stack-input-provenance-v2",
        "generator_version": GENERATOR_VERSION,
        "project_name": project,
        "input_root": "inputs",
        "source_manifest": TRACKED_INPUT_MANIFEST,
        "source_manifest_sha256": _hash_file(manifest_path),
        "source_manifest_mode": f"{stat.S_IMODE(manifest_path.stat().st_mode):04o}",
        "socket_mount": "removed",
        "functions_root": FUNCTIONS_ROOT,
        "functions_files": list(FUNCTIONS_FILES),
        "mount_inventory": source_manifest["mounts"],
        "compose_files": source_manifest["compose_files"],
        "records": records,
    }
    _atomic_write(state / "stack.inputs.provenance.json", (json.dumps(provenance, sort_keys=True, separators=(",", ":")) + "\n").encode("ascii"), 0o600)
    return provenance


def _state(root: Path) -> tuple[str, Path]:
    project = _project_name(root)
    return project, _state_root(root, project)


def _compose_files(root: Path) -> tuple[Path, Path, Path]:
    supabase = root / "backend" / "supabase"
    return supabase / "docker-compose.yml", supabase / "docker-compose.local.yml", supabase / "docker-compose.mail.yml"


def _compose(project: str, env: Path, files: Iterable[Path], *args: str) -> list[str]:
    command = ["docker", "compose", "--project-name", project, "--env-file", str(env)]
    for compose_file in files:
        command.extend(("-f", str(compose_file)))
    command.extend(args)
    return command


def _safe_process_environment() -> dict[str, str]:
    """Drop host Compose/Docker overrides and repository env fallbacks."""
    keep = {"PATH", "HOME", "USER", "TMPDIR", "LANG", "LC_ALL", "TERM"}
    environment = {key: value for key, value in os.environ.items() if key in keep}
    environment.setdefault("PATH", "/usr/bin:/bin")
    environment.setdefault("HOME", str(Path.home()))
    # The filtered environment drops remote DOCKER_HOST and DOCKER_CONTEXT
    # overrides while Docker still uses its locally configured context.
    return environment

def _run(
    command: list[str],
    *,
    timeout: int = 120,
    error_code: str = "compose_command",
) -> subprocess.CompletedProcess[str]:
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False, env=_safe_process_environment())
    except FileNotFoundError:
        _fail("docker_not_found")
    except subprocess.TimeoutExpired:
        _fail("docker_timeout")
    if result.returncode != 0:
        _fail(error_code)
    return result
def _handle_signal(signum: int, _frame: Any) -> None:
    global _ACTIVE_COMMAND
    command = _ACTIVE_COMMAND
    if command is not None:
        try:
            _run(command + ["down", "--remove-orphans"])
        except (LocalStackError, OSError, ValueError):
            pass
        finally:
            _ACTIVE_COMMAND = None
    raise KeyboardInterrupt


def _docker_socket_candidates() -> tuple[Path, ...]:
    home = Path.home()
    return (
        DOCKER_SOCKET_DEFAULT,
        home / DOCKER_SOCKET_DOCKER_DESKTOP,
        home / DOCKER_SOCKET_COLIMA,
    )
def _github_actions_root_owned_socket(path: Path, owner: int) -> bool:
    return (
        path == DOCKER_SOCKET_DEFAULT
        and owner == 0
        and os.environ.get("GITHUB_ACTIONS") == "true"
        and os.environ.get("CI") == "true"
    )


def _local_docker_socket(endpoint: str) -> Path:
    try:
        parsed = urlparse(endpoint)
    except ValueError:
        _fail("docker_context")
    if parsed.scheme != "unix" or parsed.netloc or parsed.params or parsed.query or parsed.fragment:
        _fail("docker_context")
    path = Path(parsed.path)
    if not path.is_absolute() or path not in set(_docker_socket_candidates()):
        _fail("docker_context")
    try:
        info = path.lstat()
    except OSError:
        _fail("docker_context")
    owned_by_current_user = info.st_uid == os.getuid()
    owned_by_disposable_ci_root = _github_actions_root_owned_socket(path, info.st_uid)
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISSOCK(info.st_mode) or not (owned_by_current_user or owned_by_disposable_ci_root):
        _fail("docker_context")
    return path


def _assert_local_docker_context() -> None:
    environment = _safe_process_environment()
    try:
        selected = subprocess.run(
            ["docker", "context", "show"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
            env=environment,
        )
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
        _fail("docker_context")
    context = selected.stdout.strip()
    if selected.returncode != 0 or not context or any(char in context for char in "\r\n\t "):
        _fail("docker_context")
    try:
        inspected = subprocess.run(
            ["docker", "context", "inspect", context],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
            env=environment,
        )
        payload = json.loads(inspected.stdout)
        endpoint = payload[0]["Endpoints"]["docker"]["Host"] if payload else None
    except (OSError, subprocess.TimeoutExpired, ValueError, TypeError, KeyError, IndexError):
        _fail("docker_context")
    if inspected.returncode != 0 or not endpoint:
        _fail("docker_context")
    _local_docker_socket(str(endpoint))

def _check_renderer() -> None:
    environment = _safe_process_environment()
    try:
        short_result = subprocess.run(
            ["docker", "compose", "version", "--short"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
            env=environment,
        )
        full_result = subprocess.run(
            ["docker", "compose", "version"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
            env=environment,
        )
    except FileNotFoundError:
        _fail("docker_not_found")
    except subprocess.TimeoutExpired:
        _fail("renderer_version")
    expected_short = COMPOSE_VERSION.removeprefix("v")
    expected_full = f"Docker Compose version {COMPOSE_VERSION}"
    if short_result.returncode != 0 or short_result.stdout.strip() != expected_short or full_result.returncode != 0 or full_result.stdout.strip() != expected_full:
        _fail("renderer_version")
    _assert_local_docker_context()


def _load_model(command: list[str]) -> dict[str, Any]:
    result = _run(command + ["config", "--format", "json"])
    try:
        model = json.loads(result.stdout)
    except (ValueError, TypeError):
        _fail("compose_model")
    if not isinstance(model, dict):
        _fail("compose_model")
    return model


def _loopback_port(value: Any) -> tuple[str | None, int | None]:
    if isinstance(value, dict):
        host_ip = value.get("host_ip")
        published = value.get("published")
        try:
            return (str(host_ip) if host_ip is not None else None, int(published) if published is not None else None)
        except (TypeError, ValueError):
            return None, None
    if not isinstance(value, str):
        return None, None
    raw = value.split("/", 1)[0]
    bits = raw.split(":")
    if len(bits) < 2:
        return None, None
    try:
        return (bits[-3] if len(bits) >= 3 else None, int(bits[-2] if len(bits) >= 3 else bits[-2]))
    except (TypeError, ValueError):
        return None, None


def _walk_strings(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for key, item in value.items():
            yield from _walk_strings(key)
            yield from _walk_strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _walk_strings(item)
_SECRET_MODEL_KEY = re.compile(r"(?i)(?:password|pass|secret|token|key|credential|dsn|database_url)")
_SECRET_URL_CREDENTIAL = re.compile(r"(?i)(://[^:/\s]+:)[^@\s]+(@)")
_DYNAMIC_JWT = re.compile(r"(?i)(?:bearer\s+)?eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")

def _redact_model(value: Any, key: str = "") -> Any:
    if isinstance(value, dict):
        return {str(item_key): _redact_model(item_value, str(item_key)) for item_key, item_value in value.items()}
    if isinstance(value, list):
        return [_redact_model(item, key) for item in value]
    if isinstance(value, str):
        if _SECRET_MODEL_KEY.search(key):
            return "<redacted>"
        return _DYNAMIC_JWT.sub("<jwt-redacted>", _SECRET_URL_CREDENTIAL.sub(r"\1<redacted>\2", value))
    return value


def _scan_model(model: dict[str, Any], project: str, state: Path, values: dict[str, str], input_manifest: dict[str, Any]) -> str:
    if model.get("name") != project:
        _fail("model_project")
    services = model.get("services")
    if not isinstance(services, dict) or set(services) != set(EXPECTED_SERVICES):
        _fail("model_services")
    if model.get("configs") or model.get("secrets"):
        _fail("model_source")
    mount_records = input_manifest.get("mount_inventory")
    if not isinstance(mount_records, list):
        _fail("model_mount_inventory")
    expected_mount_inventory = {
        (item["service"], item["source"], item["type"], item["destination"])
        for item in mount_records
        if isinstance(item, dict)
    }
    actual_mount_inventory: set[tuple[str, str, str, str]] = set()
    expected_named_volumes = {item["source"] for item in mount_records if isinstance(item, dict) and item["type"] == "volume"}
    expected_ports = {int(values[key]) for key in PORT_KEYS}
    published_ports: list[int] = []
    for service_name, service in services.items():
        if not isinstance(service, dict):
            _fail("model_service")
        if "container_name" in service:
            _fail("model_container_name")
        if "build" in service:
            _fail("model_build")
        if "devices" in service:
            _fail("model_device")
        if service.get("network_mode") in {"host", "container"}:
            _fail("model_network")
        if service.get("env_file"):
            _fail("model_env_file")
        if service_name == "mail" and service.get("image") != "inbucket/inbucket:3.0.3":
            _fail("model_mail_image")
        for port in service.get("ports", []) or []:
            host_ip, published = _loopback_port(port)
            if published is None or published not in expected_ports or host_ip != "127.0.0.1":
                _fail("model_port")
            published_ports.append(published)
        for mount in service.get("volumes", []) or []:
            if isinstance(mount, dict):
                source, destination, kind = mount.get("source"), mount.get("target"), mount.get("type")
            elif isinstance(mount, str):
                bits = mount.split(":")
                source, destination, kind = bits[0], (bits[1].split(":", 1)[0] if len(bits) > 1 else None), "bind" if mount.startswith("/") else "volume"
            else:
                _fail("model_mount")
            if destination not in DESTINATIONS:
                _fail("model_destination")
            expected_mounts = [
                item for item in mount_records
                if item.get("service") == service_name and item.get("destination") == destination
            ]
            if len(expected_mounts) != 1 or expected_mounts[0].get("type") != kind:
                _fail("model_mount_inventory")
            expected_mount = expected_mounts[0]
            if kind == "bind":
                if not isinstance(source, str):
                    _fail("model_source")
                try:
                    source_path = Path(source)
                    source_info = source_path.lstat()
                    if stat.S_ISLNK(source_info.st_mode):
                        _fail("model_source")
                    resolved = source_path.resolve()
                    expected_source = (state / "inputs" / expected_mount["source"]).resolve()
                except OSError:
                    _fail("model_source")
                if resolved != expected_source or state not in resolved.parents or source_info.st_uid != os.getuid() or not stat.S_ISREG(source_info.st_mode) and not stat.S_ISDIR(source_info.st_mode):
                    _fail("model_source")
                if isinstance(mount, dict) and mount.get("read_only") is not True:
                    _fail("model_mount_inventory")
            elif kind == "volume":
                if source != expected_mount["source"]:
                    _fail("model_volume")
            else:
                _fail("model_mount")
            actual_mount_inventory.add((service_name, expected_mount["source"], kind, destination))
        for item in _walk_strings(service):
            if "docker.sock" in item or "/var/run/docker" in item or item.startswith("0.0.0.0:"):
                _fail("model_socket_or_bind")
            if "://" in item:
                parsed = urlparse(item)
                if parsed.scheme in {"http", "https"} and parsed.hostname not in {"localhost", "127.0.0.1", "::1", *EXPECTED_SERVICES}:
                    _fail("model_cloud_url")
    if actual_mount_inventory != expected_mount_inventory:
        _fail("model_mount_inventory")
    volumes = model.get("volumes") or {}
    if not isinstance(volumes, dict) or set(volumes) != expected_named_volumes:
        _fail("model_volume")
    for volume_name, volume in volumes.items():
        if volume_name not in expected_named_volumes or not isinstance(volume, dict):
            _fail("model_volume")
        actual_name = volume.get("name")
        if actual_name not in {f"{project}-db-data", f"{project}-db-config", f"{project}-storage-data"}:
            _fail("model_volume")
    if sorted(published_ports) != sorted(expected_ports):
        _fail("model_ports")
    return _hash_bytes(json.dumps(_redact_model(model), sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("ascii"))


def _prepare(root: Path, project: str, state: Path) -> tuple[Path, dict[str, str], dict[str, Any], tuple[Path, Path, Path]]:
    env_path, values = _ensure_env(root, project, state)
    _validate_env(values, project, state)
    manifest = _ensure_inputs(root, project, state)
    files = _compose_files(root)
    for path in files:
        _regular_owned(path)
    compose_manifest = {
        entry["path"]: entry["sha256"]
        for entry in manifest["compose_files"]
    }
    for path in files:
        relative = str(path.resolve().relative_to(root.resolve()))
        if compose_manifest.get(relative) != _hash_file(path):
            _fail("compose_input_mismatch")
    return env_path, values, manifest, files


def _render(root: Path, project: str, state: Path) -> tuple[str, dict[str, str], dict[str, Any]]:
    env_path, values, manifest, files = _prepare(root, project, state)
    command = _compose(project, env_path, files)
    model = _load_model(command)
    digest = _scan_model(model, project, state, values, manifest)
    return digest, values, {"env": env_path, "manifest": manifest, "files": files, "model": model}


def _artifact_digest(path: Path) -> str:
    _regular_owned(path, mode=0o600)
    return _hash_file(path)

def _normalize_receipt(value: Any) -> Any:
    if isinstance(value, str):
        return unicodedata.normalize("NFC", value)
    if isinstance(value, list):
        return [_normalize_receipt(item) for item in value]
    if isinstance(value, dict):
        return {_normalize_receipt(key): _normalize_receipt(item) for key, item in value.items()}
    return value


def _write_receipt(
    state: Path,
    action: str,
    *,
    ok: bool,
    project: str,
    config_sha256: str | None = None,
    input_provenance_sha256: str | None = None,
    env_provenance_sha256: str | None = None,
    services: list[dict[str, str]] | None = None,
    error_code: str | None = None,
) -> dict[str, Any]:
    receipt: dict[str, Any] = {
        "schema": "local-stack-receipt-v1",
        "action": action,
        "ok": ok,
        "project_name": project,
        "renderer": COMPOSE_VERSION,
        "generator_version": GENERATOR_VERSION,
        "config_sha256": config_sha256,
        "input_provenance_sha256": input_provenance_sha256,
        "env_provenance_sha256": env_provenance_sha256,
        "services": services or [],
        "error_code": error_code,
    }
    receipt = _normalize_receipt(receipt)
    _atomic_write(state / "last-receipt.json", (json.dumps(receipt, sort_keys=True, separators=(",", ":")) + "\n").encode("ascii"), 0o600)
    return receipt


def _emit(receipt: dict[str, Any]) -> None:
    print(json.dumps(receipt, sort_keys=True, separators=(",", ":")))


def _port_preflight(values: dict[str, str]) -> None:
    for key in PORT_KEYS:
        port = int(values[key])
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
            sock.bind(("127.0.0.1", port))
        except OSError:
            _fail("port_in_use")
        finally:
            sock.close()


def _ps(command: list[str]) -> list[dict[str, Any]]:
    result = _run(command + ["ps", "--all", "--format", "json"])
    raw = result.stdout.strip()
    if not raw:
        return []
    try:
        parsed = json.loads(raw) if raw.startswith("[") else [json.loads(line) for line in raw.splitlines()]
    except (ValueError, TypeError):
        _fail("status_model")
    if not isinstance(parsed, list):
        _fail("status_model")
    return [item for item in parsed if isinstance(item, dict)]


def _service_receipts(rows: list[dict[str, Any]]) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    by_service: dict[str, dict[str, Any]] = {}
    for row in rows:
        service = row.get("Service") or row.get("service")
        if isinstance(service, str):
            by_service[service] = row
    for service in EXPECTED_SERVICES:
        row = by_service.get(service, {})
        state = str(row.get("State") or row.get("state") or "absent").lower()
        health = str(row.get("Health") or row.get("health") or "").lower()
        result.append({"service": service, "state": state if state in {"running", "exited", "created", "restarting", "paused", "absent"} else "unknown", "health": health if health in {"healthy", "unhealthy", "starting", ""} else "unknown"})
    return result


def _provenance_digests(state: Path) -> tuple[str, str]:
    return (
        _artifact_digest(state / "stack.inputs.provenance.json"),
        _artifact_digest(state / "stack.env.provenance.json"),
    )


def _probe_endpoint(command: list[str], service: str, probe: tuple[str, ...], timeout: int = 5) -> bool:
    try:
        result = subprocess.run(
            command + ["exec", "-T", service, *probe],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            env=_safe_process_environment(),
        )
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0
def _probe_response_url(response: Any) -> str | None:
    try:
        geturl = getattr(response, "geturl", None)
        if callable(geturl):
            value = geturl()
        else:
            value = getattr(response, "url", None)
    except (AttributeError, OSError, TypeError, ValueError):
        return None
    return value if isinstance(value, str) else None


def _probe_response_evidence(response: Any, expected_url: str) -> tuple[int | None, str, bool]:
    try:
        raw_status = getattr(response, "status", None)
        if raw_status is None and isinstance(response, HTTPError):
            raw_status = response.code
        status = int(raw_status)
    except (AttributeError, OSError, TypeError, ValueError, OverflowError):
        status = None
    status_class = f"{status // 100}xx" if status is not None and 100 <= status <= 599 else "invalid"
    return status, status_class, _probe_response_url(response) == expected_url


def _probe_host_url(
    scheme: str,
    port: int,
    path: str,
    opener: Any,
    *,
    headers: Mapping[str, str] | None = None,
    expected_status: int = 200,
    timeout: int = 5,
) -> bool:
    if scheme not in {"http", "https"}:
        return False
    expected_url = f"{scheme}://127.0.0.1:{port}{path}"
    expected_class = f"{expected_status // 100}xx"
    try:
        request = Request(
            expected_url,
            headers={"User-Agent": "tzudong-local-readiness", **(headers or {})},
        )
        with opener.open(request, timeout=timeout) as response:
            status, status_class, exact_url = _probe_response_evidence(response, expected_url)
            return status == expected_status and status_class == expected_class and exact_url
    except HTTPError as error:
        status, status_class, exact_url = _probe_response_evidence(error, expected_url)
        if status_class == "3xx":
            return False
        return status == expected_status and status_class == expected_class and exact_url
    except (OSError, ValueError):
        return False


def _probe_host_http(
    port: int,
    path: str,
    *,
    headers: Mapping[str, str] | None = None,
    expected_status: int = 200,
    timeout: int = 5,
) -> bool:
    return _probe_host_url(
        "http",
        port,
        path,
        _NO_REDIRECT_OPENER,
        headers=headers,
        expected_status=expected_status,
        timeout=timeout,
    )


def _probe_host_https(
    port: int,
    path: str,
    *,
    headers: Mapping[str, str] | None = None,
    expected_status: int = 200,
    timeout: int = 5,
) -> bool:
    return _probe_host_url(
        "https",
        port,
        path,
        _LOCAL_HTTPS_NO_REDIRECT_OPENER,
        headers=headers,
        expected_status=expected_status,
        timeout=timeout,
    )

def _probe_host_tcp(port: int, timeout: int = 5) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout):
            return True
    except OSError:
        return False

def _probe_service(command: list[str], values: dict[str, str], service: str, timeout: int = 5) -> bool:
    if service == "db":
        return _probe_endpoint(command, service, READINESS_ENDPOINTS[service], timeout)
    if service == "kong":
        return _probe_host_http(int(values["KONG_HTTP_PORT"]), "/auth/v1/health", timeout=timeout)
    if service == "rest":
        return (
            _probe_host_http(int(values["KONG_HTTP_PORT"]), "/rest/v1/", timeout=timeout)
            and _probe_host_https(int(values["KONG_HTTPS_PORT"]), "/rest/v1/", timeout=timeout)
        )
    if service == "auth":
        return (
            _probe_host_http(int(values["KONG_HTTP_PORT"]), "/auth/v1/health", timeout=timeout)
            and _probe_host_https(int(values["KONG_HTTPS_PORT"]), "/auth/v1/health", timeout=timeout)
        )
    if service == "storage":
        return _probe_host_http(
            int(values["KONG_HTTP_PORT"]),
            "/storage/v1/bucket",
            headers={"apikey": values["ANON_KEY"], "Authorization": "Bearer " + values["ANON_KEY"]},
            timeout=timeout,
        )
    if service == "realtime":
        return _probe_host_http(int(values["KONG_HTTP_PORT"]), "/realtime/v1/", timeout=timeout)
    if service == "studio":
        return _probe_host_http(int(values["STUDIO_PORT"]), "/api/platform/profile", timeout=timeout)
    if service == "meta":
        return _probe_host_http(int(values["META_PORT"]), "/", timeout=timeout)
    if service == "analytics":
        return _probe_host_http(int(values["ANALYTICS_PORT"]), "/health", timeout=timeout)
    if service == "supavisor":
        return _probe_host_tcp(int(values["POOLER_PROXY_PORT_TRANSACTION"]), timeout) and _probe_endpoint(
            command, service, READINESS_ENDPOINTS[service], timeout,
        )
    if service == "functions":
        return _probe_host_http(int(values["KONG_HTTP_PORT"]), "/functions/v1/main", timeout=timeout)
    if service == "mail":
        return _probe_host_http(int(values["MAIL_WEB_PORT"]), "/", timeout=timeout)
    return _probe_endpoint(command, service, READINESS_ENDPOINTS[service], timeout)


def _wait_ready(
    command: list[str],
    values: dict[str, str],
    timeout: int = 300,
    required: Iterable[str] = READINESS_REQUIRED,
) -> list[dict[str, str]]:
    required_services = tuple(required)
    if any(service not in READINESS_ENDPOINTS for service in required_services):
        _fail("readiness_contract")
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        rows = _ps(command)
        services = _service_receipts(rows)
        by_service = {item["service"]: item for item in services}
        if all(by_service.get(service, {}).get("state") == "running" for service in required_services):
            if all(_probe_service(command, values, service) for service in required_services):
                for item in services:
                    if item["service"] in required_services and item["health"] in {"", "starting"}:
                        item["health"] = "healthy"
                return services
        time.sleep(1)
    _fail("readiness_timeout")
    return []


def _docker_json_rows(command: list[str], error_code: str) -> list[dict[str, Any]]:
    try:
        result = _run(command)
    except LocalStackError:
        _fail(error_code)
    if not isinstance(result.stdout, str):
        _fail(error_code)
    rows: list[dict[str, Any]] = []
    for line in result.stdout.splitlines():
        raw = line.strip()
        if not raw:
            continue
        try:
            value = json.loads(raw)
        except (TypeError, ValueError):
            _fail(error_code)
        if not isinstance(value, dict):
            _fail(error_code)
        rows.append(value)
    return rows


def _docker_labels(value: Any) -> dict[str, str]:
    if isinstance(value, dict):
        return {str(key): str(item) for key, item in value.items()}
    if not isinstance(value, str):
        return {}
    labels: dict[str, str] = {}
    for item in value.split(","):
        key, separator, label_value = item.partition("=")
        if separator and key:
            labels[key] = label_value
    return labels


def _target_volume_names(project: str) -> tuple[str, ...]:
    return tuple(f"{project}-{suffix}" for suffix in TARGET_VOLUME_SUFFIXES)


def _volume_label_name(volume_name: str, project: str) -> str:
    prefix = project + "-"
    if not volume_name.startswith(prefix):
        _fail("docker_volume")
    suffix = volume_name[len(prefix):]
    if suffix not in TARGET_VOLUME_SUFFIXES:
        _fail("docker_volume")
    return "local-" + suffix

def _assert_project_volumes(command: list[str], project: str, *, require_existing: bool = False) -> None:
    targets = set(_target_volume_names(project))
    volume_rows = _docker_json_rows(
        ["docker", "volume", "ls", "--format", "{{json .}}"],
        "docker_volume",
    )
    present: set[str] = set()
    for row in volume_rows:
        value = row.get("Name") or row.get("name")
        if value is None:
            _fail("docker_volume")
        name = str(value)
        labels = _docker_labels(row.get("Labels"))
        if labels.get(DOCKER_PROJECT_LABEL) == project and name not in targets:
            _fail("docker_volume")
        present.add(name)
    present_targets = present & targets
    unexpected = {
        name for name in present
        if name.startswith(project + "-") and name not in targets
    }
    if unexpected or (require_existing and present_targets != targets):
        _fail("docker_volume")
    if present_targets:
        inspect = _docker_json_rows(
            ["docker", "volume", "inspect", "--format", "{{json .}}", *sorted(present_targets)],
            "docker_volume",
        )
        if {str(row.get("Name")) for row in inspect} != present_targets:
            _fail("docker_volume")
        for row in inspect:
            name = row.get("Name")
            labels = _docker_labels(row.get("Labels"))
            if (
                not isinstance(name, str)
                or labels.get(DOCKER_PROJECT_LABEL) != project
                or labels.get(DOCKER_VOLUME_LABEL) != _volume_label_name(name, project)
            ):
                _fail("docker_volume")
    for volume_name in sorted(present_targets):
        rows = _docker_json_rows(
            ["docker", "ps", "-a", "--filter", f"volume={volume_name}", "--format", "{{json .}}"],
            "docker_container",
        )
        for row in rows:
            labels = _docker_labels(row.get("Labels"))
            if labels.get(DOCKER_PROJECT_LABEL) != project or labels.get(DOCKER_SERVICE_LABEL) not in EXPECTED_SERVICES:
                _fail("docker_container")

def _action_render(root: Path, project: str, state: Path) -> dict[str, Any]:
    digest, _, _ = _render(root, project, state)
    input_digest, env_digest = _provenance_digests(state)
    return _write_receipt(
        state, "render", ok=True, project=project, config_sha256=digest,
        input_provenance_sha256=input_digest, env_provenance_sha256=env_digest,
    )


def _action_start(root: Path, project: str, state: Path) -> dict[str, Any]:
    global _ACTIVE_COMMAND
    digest, values, meta = _render(root, project, state)
    files = meta["files"]
    env_path = state / "stack.env"
    command = _compose(project, env_path, files)
    _run(command + ["config", "--quiet"], error_code="compose_config")
    _assert_project_volumes(command, project)
    _port_preflight(values)
    started = False
    try:
        _ACTIVE_COMMAND = command
        started = True
        _run(
            command + ["up", "-d", *CORE_SERVICES],
            timeout=COMPOSE_START_TIMEOUT_SECONDS,
            error_code="compose_core_start",
        )
        _wait_ready(command, values, required=CORE_REQUIRED)
        _run(
            command + ["up", "-d", "studio"],
            timeout=COMPOSE_START_TIMEOUT_SECONDS,
            error_code="compose_studio_start",
        )
        services = _wait_ready(command, values)
    except (LocalStackError, OSError, ValueError):
        if started:
            try:
                _run(command + ["down", "--remove-orphans"])
            except (LocalStackError, OSError, ValueError):
                pass
        raise
    finally:
        _ACTIVE_COMMAND = None
    input_digest, env_digest = _provenance_digests(state)
    return _write_receipt(
        state, "start", ok=True, project=project, config_sha256=digest,
        input_provenance_sha256=input_digest, env_provenance_sha256=env_digest, services=services,
    )


def _action_stop(root: Path, project: str, state: Path) -> dict[str, Any]:
    global _ACTIVE_COMMAND
    digest, _, meta = _render(root, project, state)
    env_path = state / "stack.env"
    files = meta["files"]
    command = _compose(project, env_path, files)
    try:
        _ACTIVE_COMMAND = command
        _run(command + ["down", "--remove-orphans"])
    finally:
        _ACTIVE_COMMAND = None
    input_digest, env_digest = _provenance_digests(state)
    return _write_receipt(
        state, "stop", ok=True, project=project, config_sha256=digest,
        input_provenance_sha256=input_digest, env_provenance_sha256=env_digest,
    )


def _action_status(root: Path, project: str, state: Path) -> dict[str, Any]:
    digest, _, meta = _render(root, project, state)
    env_path = state / "stack.env"
    files = meta["files"]
    command = _compose(project, env_path, files)
    rows = _ps(command)
    input_digest, env_digest = _provenance_digests(state)
    return _write_receipt(
        state, "status", ok=True, project=project, config_sha256=digest,
        input_provenance_sha256=input_digest, env_provenance_sha256=env_digest,
        services=_service_receipts(rows),
    )


def _remove_state(state: Path) -> None:
    try:
        info = state.lstat()
    except FileNotFoundError:
        return
    except OSError:
        _fail("state_root")
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
        _fail("state_root")
    try:
        shutil.rmtree(state)
    except OSError:
        _fail("state_remove")


def _action_reset(root: Path, project: str, state: Path) -> dict[str, Any]:
    global _ACTIVE_COMMAND
    _, _, meta = _render(root, project, state)
    env_path = state / "stack.env"
    command = _compose(project, env_path, meta["files"])
    _assert_project_volumes(command, project)
    try:
        _ACTIVE_COMMAND = command
        _run(command + ["down", "-v", "--remove-orphans"])
    finally:
        _ACTIVE_COMMAND = None
    _remove_state(state)
    _secure_dir(state)
    # Reset is intentionally a fresh generated environment followed by start;
    # no generic reset helper or global cleanup is reachable from this path.
    started = _action_start(root, project, state)
    return _write_receipt(
        state, "reset", ok=True, project=project, config_sha256=started["config_sha256"],
        input_provenance_sha256=started["input_provenance_sha256"],
        env_provenance_sha256=started["env_provenance_sha256"], services=started["services"],
    )


def _error_receipt(action: str, project: str, state: Path | None, code: str) -> dict[str, Any]:
    receipt = {
        "schema": "local-stack-receipt-v1",
        "action": action,
        "ok": False,
        "project_name": project,
        "renderer": COMPOSE_VERSION,
        "generator_version": GENERATOR_VERSION,
        "config_sha256": None,
        "input_provenance_sha256": None,
        "env_provenance_sha256": None,
        "services": [],
        "error_code": code,
    }
    if state is not None:
        try:
            _atomic_write(state / "last-receipt.json", (json.dumps(receipt, sort_keys=True, separators=(",", ":")) + "\n").encode("ascii"), 0o600)
        except LocalStackError:
            pass
    return receipt


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("render", "start", "stop", "reset", "status"))
    parser.add_argument("--repository-root", default=None)
    args = parser.parse_args(argv)
    action = args.action
    project = "unknown"
    state: Path | None = None
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)
    try:
        # Renderer identity is checked before state/env access or Docker side effects.
        _check_renderer()
        root = _repository_root(args.repository_root)
        project, state = _state(root)
        if action == "render":
            receipt = _action_render(root, project, state)
        elif action == "start":
            receipt = _action_start(root, project, state)
        elif action == "stop":
            receipt = _action_stop(root, project, state)
        elif action == "status":
            receipt = _action_status(root, project, state)
        else:
            receipt = _action_reset(root, project, state)
        _emit(receipt)
        return 0
    except (LocalStackError, OSError, ValueError):
        code = "local_stack_error"
        exc = sys.exc_info()[1]
        if isinstance(exc, LocalStackError):
            code = exc.code
        _emit(_error_receipt(action, project, state, code))
        return 2
    except KeyboardInterrupt:
        _emit(_error_receipt(action, project, state, "interrupted"))
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
