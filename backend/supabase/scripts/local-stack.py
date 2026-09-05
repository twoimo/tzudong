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
import shlex
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
COMPOSE_START_RETRIES = 2
COMPOSE_SERVICE_START_TIMEOUT_SECONDS = 180
COMPOSE_SERVICE_START_RETRIES = 2
COMPOSE_DATABASE_BOOTSTRAP_TIMEOUT_SECONDS = 900
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
STAGED_INPUT_FILES = (
    ("kong.yml", "kong-config", "temp.yml"),
    ("vector.yml", "vector-config", "vector.yml"),
    ("pooler.exs", "pooler-config", "pooler.exs"),
    ("functions/main/index.ts", "functions", "main/index.ts"),
    ("functions/naver-geocode/index.ts", "functions", "naver-geocode/index.ts"),
    ("db-supabase.sql", "db-init-migrations", "97-_supabase.sql"),
    ("db-logs.sql", "db-init-migrations", "99-logs.sql"),
    ("db-pooler.sql", "db-init-migrations", "99-pooler.sql"),
    ("db-realtime.sql", "db-init-migrations", "99-realtime.sql"),
    ("db-webhooks.sql", "db-init-scripts", "98-webhooks.sql"),
    ("db-roles.sql", "db-init-scripts", "99-roles.sql"),
    ("db-jwt.sql", "db-init-scripts", "99-jwt.sql"),
)
IMAGE_INIT_SCRIPT_SHA256 = (
    ("00-schema.sql", "806cd84d145206bfeec0fdd48f95a7a00fc789d1d6b87787e9e9c944062f6a47"),
    ("00000000000000-initial-schema.sql", "02b75be81f69e8446fcc12864926b71f0c3de05009bfeab1a75cddede005b56a"),
    ("00000000000001-auth-schema.sql", "65a4a55ba3248716eb4946a8677be41c94bc90eafaa22c0eb95b09908f96fa4f"),
    ("00000000000002-storage-schema.sql", "587ac737db8102bfedcf7da342f0cab1e073297fc5ccbc6c6ca103f30c56e2b6"),
    ("00000000000003-post-setup.sql", "bfec6b91b703bf2227d8d30d00516145730040e198e601c83dce780e833d091a"),
    ("README.md", "9f9d3306727cca8561912551bc98d78042e0dae2c74f89601e113317cbb87522"),
)
IMAGE_MIGRATION_SHA256 = (
    ("00-extension.sql", "a12e0eb4192d188e0dc5058e888ec981c1fd619d5542235d5b692ea0a1d751b2"),
    ("10000000000000_demote-postgres.sql", "13d98bc08bb8eabbb4c2cb8d4cbfa7cca807f6db0edb7eaf169e39d163883927"),
    ("20211115181400_update-auth-permissions.sql", "bbaa44bc707538e6c67ae8c71a386c41e136cd30fcde563db39c9d0fbde9bdcb"),
    ("20211118015519_create-realtime-schema.sql", "1d6cd4858a0fa50bf910bfd6c11a3436941a5fecdc4bdc02b9b067e8e0b7f566"),
    ("20211122051245_update-realtime-permissions.sql", "9fd431e8f1a3fc0f2e1e427d4f526562c1fe8627e12302974215373885b5254b"),
    ("20211124212715_update-auth-owner.sql", "9698f481ad9cb159df6cefd5cc4b94f4b9db0eda475317aaa057b1e9a54409e0"),
    ("20211130151719_update-realtime-permissions.sql", "6b5d190c93b35a2f804703ed7872946b51fded3272bed0ef9a6585187b0dc2b4"),
    ("20220118070449_enable-safeupdate-postgrest.sql", "2bffffbf1e5a677ef8c8cbba9afc5a66bc77113ee9b2e2b4d2a56629a381cea4"),
    ("20220126121436_finer-postgrest-triggers.sql", "85dc26173d7254490d0c20389bc7e3ac7f7752b872c99bb714167cb01b231312"),
    ("20220224211803_fix-postgrest-supautils.sql", "744ed5c5ae1527c6c73ad4214c11d903eafdc5803eb69183b3b3325b7a65c5bc"),
    ("20220317095840_pg_graphql.sql", "e9b74b1950d48f3a61f2ec16e78e50d8b430aaa6b971e5f474411001914eb7f2"),
    ("20220321174452_fix-postgrest-alter-type-event-trigger.sql", "674bfe11a9cb828c55ca7c9e00d4f4edcbcb0003d956d8866c9563810e7f0f0e"),
    ("20220322085208_gotrue-session-limit.sql", "ab2f834addee3115c96edddda927ef9f5d8641c3939d2be82b8ce1e890cf4921"),
    ("20220404205710_pg_graphql-on-by-default.sql", "02ef3e3e6c03032a6ccb828ef1e1b297d9b34ad1947a673756c3c95dd86a01d1"),
    ("20220609081115_grant-supabase-auth-admin-and-supabase-storage-admin-to-postgres.sql", "ff540703d411416925a21553bead344a9cebdec4cb0e53fb93f99973874f1e59"),
    ("20220613123923_pg_graphql-pg-dump-perms.sql", "ab244687d0123859d9d9c6a79b34897e8cdd8f1698bdccd1bef7f7e0ced82334"),
    ("20220713082019_pg_cron-pg_net-temp-perms-fix.sql", "143d6e664f2f508f76964fbaaa018c6ee262464c8c7a881201ae56e025787c94"),
    ("20221028101028_set_authenticator_timeout.sql", "393dd66aee71a99d3956c6c6655e3c010afe9bd3f9a819b03746850ba70f9680"),
    ("20221103090837_revoke_admin.sql", "8fff945cd6f11ab68b2f300c64d43a38ef69d61987aaf596a1d00bfa225234e8"),
    ("20221207154255_create_pgsodium_and_vault.sql", "cb8877c69b6913153776b865093e85768053daed283dec6835fdac728978d76c"),
    ("20230201083204_grant_auth_roles_to_postgres.sql", "b06d2bdfe4d60e9e2183c2296511a4b83d97cebb71cb2d714cd863081990857e"),
    ("20230224042246_grant_extensions_perms_for_postgres.sql", "9e1e777fb8317dcccdb88ead19201a5670c890fa69dfc51c8d7b369229c3ca8d"),
    ("20230306081037_grant_pg_monitor_to_postgres.sql", "5d80fb49faaf96712ecb23896a36a03122ca352b5046ab8480fee914a054cdec"),
    ("20230327032006_grant_auth_roles_to_supabase_storage_admin.sql", "9f8985b3676ff2c3709b3193736e17fcfd20264953eba7dcbc94056ea26bac0e"),
    ("20230529180330_alter_api_roles_for_inherit.sql", "e78a67f8e6ae847765a80898824d404ab370daa3d6f6dbf61ea6d9e0a69144f3"),
    ("20231013070755_grant_authenticator_to_supabase_storage_admin.sql", "48d9feb2734125f79eb67bd0522fee9ad3916888172c7023a84241260687620f"),
    ("20231017062225_grant_pg_graphql_permissions_for_custom_roles.sql", "1833af7170c97bc444cfe9f823be73d3ff3f9b18e47c2ee1181ff33a1fbbb673"),
    ("20231020085357_revoke_writes_on_cron_job_from_postgres.sql", "6c37208218a84c3ab40e5e0369b86d31a6ddc56fbfe95c03800776b3fa9ce4b7"),
    ("20231130133139_set_lock_timeout_to_authenticator_role.sql", "5d2cc80fdb26cbda32d8398bf8486cccc4e2f6b911b5719f146d0167551f6a00"),
    ("20240124080435_alter_lo_export_lo_import_owner.sql", "1060763d9f69d39c5027c632aa634b3b8d9d021dd7150f6efdbe1d9d7679e655"),
    ("20240606060239_grant_predefined_roles_to_postgres.sql", "11b87064890ffe3f3d14336b712c310966d09458c5eef7203e7251cc9156f59e"),
    ("20241031003909_create_orioledb.sql", "119405b66ee3c57cb81849e0cb20423ca059d9f54a4ef8607313ff4db48c8082"),
    ("20241215003910_backfill_pgmq_metadata.sql", "4220830feda72a98a2ec804a6ef9250507ca22cd4ccf4f17a0036c4d771e6adf"),
    ("20250205060043_disable_log_statement_on_internal_roles.sql", "720d2ecb3ae5d43eb8d0e071fa489dec472d54ff27e4fa46f8d17c8070cbb13f"),
    ("20250205144616_move_orioledb_to_extensions_schema.sql", "9ea55607791aa8c8b55982cee9f006129149e3f4e10bd320bfedcbeb945e5230"),
    ("20250218031949_pgsodium_mask_role.sql", "24cf783d3c039d90a67225eef1fbfe688fda8b3fd88610bea59abc6590db3382"),
    ("20250220051611_pg_net_perms_fix.sql", "7e700959a7583b857a5738c71777682e509f4414272390f20ac5d86f999ae6c1"),
    ("20250312095419_pgbouncer_ownership.sql", "fd95765def92461de68b550eb65587babd9944cee142cac0bec4df3c277adec8"),
    ("20250402065937_alter_internal_event_triggers_owner_to_supabase_admin.sql", "1197d727fb7a8ddf8a61c992ff5698d81a5e908e677cc3a4d835b079aeacb8f1"),
    ("20250417190610_update_pgbouncer_get_auth.sql", "c7a26bdcb8b48941bbe5ead7c347a06b9261f7a461abeeea0bfe129f20625745"),
    ("20250421084701_revoke_admin_roles_from_postgres.sql", "3cf67f8694599dc69c763181c830fa7c967643e7fbc16360f23ad0719385398c"),
)
STAGED_VOLUME_PATHS = {
    "kong-config": "/kong",
    "vector-config": "/vector",
    "pooler-config": "/pooler",
    "functions": "/functions",
    "db-init-migrations": "/migrations",
    "db-init-scripts": "/scripts",
}
DATABASE_STAGED_VOLUME_PATHS = {
    "db-init-migrations": "/docker-entrypoint-initdb.d/migrations",
    "db-init-scripts": "/docker-entrypoint-initdb.d/init-scripts",
}
DESTINATIONS = {
    "/home/kong", "/home/kong/temp.yml", "/etc/vector", "/etc/vector/vector.yml",
    "/etc/pooler", "/etc/pooler/pooler.exs",
    "/var/lib/postgresql/data", "/etc/postgresql-custom", "/var/lib/storage",
    "/docker-entrypoint-initdb.d/migrations",
    "/docker-entrypoint-initdb.d/init-scripts",
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
LOCAL_BROWSER_ORIGINS = (
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://127.0.0.1:8080",
    "http://localhost:8080",
    "http://127.0.0.1:18080",
    "http://localhost:18080",
)
LOCAL_ADDITIONAL_REDIRECT_URLS = ",".join(LOCAL_BROWSER_ORIGINS)
PREVIOUS_LOCAL_ADDITIONAL_REDIRECT_URLS = (
    "http://127.0.0.1:8080,http://localhost:8080,http://127.0.0.1:18080"
)
LOCAL_CORS_TARGET_HOSTS = ("127.0.0.1", "localhost")
LOCAL_CORS_METHODS = ("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
LOCAL_AUTH_CORS_HEADERS = (
    "apikey",
    "authorization",
    "content-type",
    "x-client-info",
    "x-supabase-api-version",
)
LOCAL_AUTH_CORS_EXPOSED_HEADERS = (
    "x-total-count",
    "link",
    "x-supabase-api-version",
)
LOCAL_REST_CORS_HEADERS = (
    "apikey",
    "authorization",
    "content-type",
    "x-client-info",
    "x-retry-count",
    "accept-profile",
    "content-profile",
    "prefer",
    "range",
)
LOCAL_REST_CORS_EXPOSED_HEADERS = ("content-range",)
LOCAL_STORAGE_CORS_METHODS = ("GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS")
LOCAL_STORAGE_CORS_HEADERS = (
    "apikey",
    "authorization",
    "content-type",
    "x-client-info",
    "x-upsert",
    "cache-control",
)
LOCAL_STORAGE_CORS_EXPOSED_HEADERS = (
    "content-length",
    "content-range",
    "etag",
)
LOCAL_FUNCTION_CORS_METHODS = ("POST", "OPTIONS")
LOCAL_FUNCTION_CORS_HEADERS = (
    "apikey",
    "authorization",
    "content-type",
    "x-client-info",
)
LOCAL_FUNCTION_CORS_EXPOSED_HEADERS = ("x-tzudong-local-fixture",)
LOCAL_CORS_REJECTED_ORIGIN = "http://127.0.0.1:18081"
LOCAL_CORS_MAX_AGE = "600"
LOCAL_CORS_PREFLIGHT_VARY_TOKENS = frozenset(("origin",))
LOCAL_CORS_ACTUAL_VARY_TOKEN_SETS = frozenset((
    frozenset(("origin",)),
    frozenset(("accept-encoding", "origin")),
))
LOCAL_REALTIME_TENANT_HOST = "realtime-dev.supabase-realtime"
LOCAL_REALTIME_READINESS_TIMEOUT_SECONDS = 8
LOCAL_READINESS_DURATION_MAX_MS = 30_000
LOCAL_READINESS_RESULTS = frozenset(("not_probed", "not_running", "not_ready", "ready"))
LOCAL_REALTIME_READINESS_SCRIPT = r"""
const fs = require('node:fs');
const config = JSON.parse(fs.readFileSync(0, 'utf8'));
const WebSocket = require(config.wsModule);
const { RealtimeClient } = require(config.realtimeModule);
class LocalOriginWebSocket extends WebSocket {
  constructor(address, protocols) {
    super(address, protocols, { origin: config.origin });
  }
}
const client = new RealtimeClient(
  `ws://${config.targetHost}:${config.port}/realtime/v1`,
  {
    transport: LocalOriginWebSocket,
    params: { apikey: config.apikey },
    timeout: 4000,
    heartbeatIntervalMs: 2000,
    reconnectAfterMs: () => 10000,
  },
);
const marker = `local-${process.pid}-${Date.now()}`;
const topic = `local-readiness-${process.pid}-${Date.now()}`;
const channel = client.channel(topic, {
  config: {
    broadcast: { ack: true, self: true },
    presence: { key: '' },
    private: false,
  },
});
let subscribed = false;
let sent = false;
let received = false;
let settled = false;
const finish = async (ok) => {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  try { await client.removeChannel(channel); } catch {}
  try { await client.disconnect(); } catch {}
  process.exit(ok ? 0 : 1);
};
const timer = setTimeout(() => finish(false), 7000);
channel.on('broadcast', { event: 'local_fixture' }, (message) => {
  received = message?.event === 'local_fixture' &&
    message?.payload?.marker === marker;
  if (received && sent) finish(subscribed);
});
channel.subscribe(async (status) => {
  if (status === 'SUBSCRIBED') {
    subscribed = true;
    sent = await channel.send({
      type: 'broadcast',
      event: 'local_fixture',
      payload: { marker },
    }) === 'ok';
    if (!sent) finish(false);
    if (received && sent) finish(true);
  } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
    finish(false);
  }
});
"""
LEGACY_RESET_ENV_KEYS = frozenset(("NIGHTLY_LOCAL_ENV_ONLY", "NIGHTLY_ENV_FILE_ONLY", "NODE_ENV"))
STORAGE_SERVICE_KEY_ENV = "STORAGE_SERVICE_KEY"
STORAGE_INTERNAL_ROLE = "supabase_storage_admin"
DOCKER_SOCKET_DEFAULT = Path("/var/run/docker.sock")
DOCKER_SOCKET_DOCKER_DESKTOP = ".docker/run/docker.sock"
DOCKER_SOCKET_COLIMA = ".colima/default/docker.sock"
TARGET_VOLUME_SUFFIXES = (
    "db-data",
    "db-config",
    "db-init-migrations",
    "db-init-scripts",
    "functions",
    "kong-config",
    "pooler-config",
    "storage-data",
    "vector-config",
)
DOCKER_PROJECT_LABEL = "com.docker.compose.project"
DOCKER_VOLUME_LABEL = "com.docker.compose.volume"
DOCKER_SERVICE_LABEL = "com.docker.compose.service"
DOCKER_SOCKET_ADMISSION_ENV = "TZUDONG_DOCKER_SOCKET_ADMISSION_FILE"
DOCKER_SOCKET_ADMISSION_REPOSITORY = "twoimo/tzudong"

TRACKED_INPUT_MANIFEST = "local-inputs/manifest.v1.json"
INPUT_MANIFEST_SCHEMA = "local-stack-input-manifest-v1"
LOCAL_INPUT_FILES = (
    "kong.yml",
    "vector.yml",
    "pooler.exs",
    "functions/main/index.ts",
    "functions/naver-geocode/index.ts",
)
FUNCTIONS_ROOT = "functions"
FUNCTIONS_FILES = ("functions/main/index.ts", "functions/naver-geocode/index.ts")

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
LOCAL_FUNCTION_READINESS_MAX_BYTES = 4096
LOCAL_FUNCTION_MAIN_RESPONSE = {
    "status": "ok",
    "source": "LOCAL_TEST_ONLY:NOT_PRODUCTION:edge-dispatcher-v1",
}
LOCAL_NAVER_READINESS_REQUEST = {
    "query": "서울특별시 중구 세종대로 110",
    "count": 1,
}
LOCAL_NAVER_READINESS_RESPONSE = {
    "addresses": [
        {
            "roadAddress": "서울특별시 중구 세종대로 110",
            "jibunAddress": "서울특별시 중구 태평로1가 31",
            "englishAddress": "110 Sejong-daero, Jung-gu, Seoul",
            "addressElements": [
                {
                    "types": ["SIDO"],
                    "longName": "서울특별시",
                    "shortName": "서울",
                    "code": "11",
                },
                {
                    "types": ["SIGUGUN"],
                    "longName": "중구",
                    "shortName": "중구",
                    "code": "11140",
                },
                {
                    "types": ["ROAD_NAME"],
                    "longName": "세종대로",
                    "shortName": "세종대로",
                    "code": "",
                },
                {
                    "types": ["BUILDING_NUMBER"],
                    "longName": "110",
                    "shortName": "110",
                    "code": "",
                },
            ],
            "x": "126.978",
            "y": "37.5665",
        }
    ],
}
LOCAL_NAVER_FIXTURE_PROVENANCE = (
    "LOCAL_TEST_ONLY:NOT_PRODUCTION:nightly-ci:naver-geocode-fixture-v1"
)
CORE_START_PHASES = (
    (("vector",), ("vector",)),
    (("db",), ("db",)),
    (("analytics",), ("analytics",)),
    (("imgproxy",), ()),
    (("auth", "functions", "kong", "mail", "meta", "realtime", "rest", "storage", "supavisor"), ()),
)
_ACTIVE_COMMAND: list[str] | None = None
_LAST_READINESS_DIAGNOSTICS: tuple[dict[str, object], ...] = ()


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
    def __init__(
        self,
        code: str,
        *,
        readiness: tuple[dict[str, object], ...] = (),
    ):
        super().__init__(code)
        self.code = code
        self.readiness = readiness


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
        "STORAGE_SERVICE_KEY": _jwt(jwt_secret, STORAGE_INTERNAL_ROLE),
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
        # local_analytics is exposed only by the generated local stack so the
        # guarded admin queue route can reach it. SQL grants still restrict the
        # schema and its tables to service_role; hosted configuration is not
        # changed by this local environment generator.
        "PGRST_DB_SCHEMAS": "public,storage,graphql_public,local_analytics",
        "SITE_URL": "http://127.0.0.1:8080",
        "ADDITIONAL_REDIRECT_URLS": LOCAL_ADDITIONAL_REDIRECT_URLS,
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
    for key in LOCAL_URL_KEYS:
        parsed = urlparse(values[key])
        if parsed.scheme != "http" or parsed.hostname != "127.0.0.1":
            _fail("non_loopback_url")
    fixed_values = {
        "PROJECT_NAME": project,
        "POSTGRES_HOST": "db",
        "POSTGRES_DB": "postgres",
        "POSTGRES_PORT": "5432",
        "NIGHTLY_ADMIN_EMAIL": "nightly-ci@local.invalid",
        "SITE_URL": "http://127.0.0.1:8080",
        "ADDITIONAL_REDIRECT_URLS": LOCAL_ADDITIONAL_REDIRECT_URLS,
        "OPENAI_API_KEY": "",
        "DOCKER_SOCKET_LOCATION": "/var/empty/local-stack.sock",
        "LOCAL_STACK_GENERATOR_VERSION": GENERATOR_VERSION,
    }
    if any(values.get(key) != expected for key, expected in fixed_values.items()):
        _fail("env_provenance")
    if (
        values.get("ANON_KEY") != _jwt(values.get("JWT_SECRET", ""), "anon")
        or values.get("SERVICE_ROLE_KEY")
            != _jwt(values.get("JWT_SECRET", ""), "service_role")
        or values.get(STORAGE_SERVICE_KEY_ENV)
            != _jwt(values.get("JWT_SECRET", ""), STORAGE_INTERNAL_ROLE)
        or len({
            values.get("ANON_KEY"),
            values.get("SERVICE_ROLE_KEY"),
            values.get(STORAGE_SERVICE_KEY_ENV),
        }) != 3
    ):
        _fail("env_provenance")
    if Path(values["LOCAL_STATE_ROOT"]).resolve() != state.resolve() or Path(values["LOCAL_INPUT_ROOT"]).resolve() != (state / "inputs").resolve():
        _fail("env_provenance")
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


def _admit_legacy_env_for_reset(root: Path, project: str, state: Path) -> None:
    """Admit only the immediately preceding generated env contract for reset."""
    env_path = state / "stack.env"
    provenance_path = state / "stack.env.provenance.json"
    values = _parse_env(env_path)
    _regular_owned(provenance_path, mode=0o600)
    try:
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, UnicodeError):
        _fail("env_provenance")
    current_keys = set(_env_values(root, project, state))
    if (
        set(values) != current_keys | LEGACY_RESET_ENV_KEYS
        or provenance.get("schema") != "local-stack-env-provenance-v1"
        or provenance.get("generator_version") != GENERATOR_VERSION
        or provenance.get("project_name") != project
        or provenance.get("env_file") != "stack.env"
        or provenance.get("env_file_sha256") != _hash_file(env_path)
        or provenance.get("env_file_mode") != "0600"
        or provenance.get("keys") != sorted(values)
        or provenance.get("local_url_keys") != list(LOCAL_URL_KEYS)
        or provenance.get("secret_values_included") is not False
        or values.get("NIGHTLY_LOCAL_ENV_ONLY") != "1"
        or values.get("NIGHTLY_ENV_FILE_ONLY") != "1"
        or values.get("NODE_ENV") != "test"
        or values.get("SITE_URL") != "http://127.0.0.1:3000"
        or values.get("ADDITIONAL_REDIRECT_URLS") != "http://127.0.0.1:3000"
    ):
        _fail("env_provenance")
    normalized = dict(values)
    for key in LEGACY_RESET_ENV_KEYS:
        normalized.pop(key, None)
    normalized["SITE_URL"] = "http://127.0.0.1:8080"
    normalized["ADDITIONAL_REDIRECT_URLS"] = LOCAL_ADDITIONAL_REDIRECT_URLS
    _validate_env(normalized, project, state)


def _admit_reset_env(root: Path, project: str, state: Path) -> Path:
    """Admit a current or immediately preceding generated env without rewriting it."""
    env_path = state / "stack.env"
    provenance_path = state / "stack.env.provenance.json"
    values = _parse_env(env_path)
    _regular_owned(provenance_path, mode=0o600)
    try:
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError):
        _fail("reset_state_provenance")
    if (
        not isinstance(provenance, dict)
        or set(provenance) != {
            "schema", "generator_version", "project_name", "env_file",
            "env_file_sha256", "env_file_mode", "keys", "local_url_keys",
            "secret_values_included",
        }
        or provenance.get("schema") != "local-stack-env-provenance-v1"
        or provenance.get("generator_version") != GENERATOR_VERSION
        or provenance.get("project_name") != project
        or provenance.get("env_file") != "stack.env"
        or provenance.get("env_file_sha256") != _hash_file(env_path)
        or provenance.get("env_file_mode") != "0600"
        or provenance.get("keys") != sorted(values)
        or provenance.get("local_url_keys") != list(LOCAL_URL_KEYS)
        or provenance.get("secret_values_included") is not False
    ):
        _fail("reset_state_provenance")
    try:
        _validate_env(values, project, state)
    except LocalStackError as error:
        if error.code not in {"env_provenance", "non_loopback_url", "port_shape"}:
            raise
        if (
            set(values) == set(_env_values(root, project, state))
            and values.get("ADDITIONAL_REDIRECT_URLS")
                == PREVIOUS_LOCAL_ADDITIONAL_REDIRECT_URLS
        ):
            normalized = dict(values)
            normalized["ADDITIONAL_REDIRECT_URLS"] = LOCAL_ADDITIONAL_REDIRECT_URLS
            _validate_env(normalized, project, state)
        elif set(values) == (
            set(_env_values(root, project, state)) - {STORAGE_SERVICE_KEY_ENV}
        ):
            # Reset-only admission for the immediately preceding generated
            # contract. Reconstruct the missing derived key in memory solely
            # to validate the old owner-bound 0600 state before scoped teardown.
            normalized = dict(values)
            normalized[STORAGE_SERVICE_KEY_ENV] = _jwt(
                normalized["JWT_SECRET"], STORAGE_INTERNAL_ROLE
            )
            _validate_env(normalized, project, state)
        else:
            _admit_legacy_env_for_reset(root, project, state)
    return env_path


def _safe_relative_input(value: Any) -> Path | None:
    if not isinstance(value, str) or not value or "\\" in value:
        return None
    path = Path(value)
    if path.is_absolute() or ".." in path.parts or any(part in {"", "."} for part in path.parts):
        return None
    return path


def _admit_stale_input_provenance(project: str, state: Path) -> None:
    """Validate the prior generated input tree for reset-only replacement."""
    provenance_path = state / "stack.inputs.provenance.json"
    _regular_owned(provenance_path, mode=0o600)
    try:
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, ValueError):
        _fail("reset_input_provenance")
    if (
        not isinstance(provenance, dict)
        or set(provenance) != {
            "schema", "generator_version", "project_name", "input_root",
            "source_manifest", "source_manifest_sha256", "source_manifest_mode",
            "socket_mount", "functions_root", "functions_files", "mount_inventory",
            "compose_files", "records",
        }
        or provenance.get("schema") != "local-stack-input-provenance-v2"
        or provenance.get("generator_version") != GENERATOR_VERSION
        or provenance.get("project_name") != project
        or provenance.get("input_root") != "inputs"
        or provenance.get("source_manifest") != TRACKED_INPUT_MANIFEST
        or provenance.get("source_manifest_mode") != "0644"
        or not isinstance(provenance.get("source_manifest_sha256"), str)
        or re.fullmatch(r"[0-9a-f]{64}", provenance["source_manifest_sha256"]) is None
        or provenance.get("socket_mount") != "removed"
        or provenance.get("functions_root") != FUNCTIONS_ROOT
    ):
        _fail("reset_input_provenance")

    compose_files = provenance.get("compose_files")
    expected_compose_paths = [
        "backend/supabase/docker-compose.yml",
        "backend/supabase/docker-compose.local.yml",
        "backend/supabase/docker-compose.mail.yml",
    ]
    if (
        not isinstance(compose_files, list)
        or len(compose_files) != len(expected_compose_paths)
        or any(
            not isinstance(item, dict)
            or set(item) != {"path", "sha256"}
            or item.get("path") != expected_compose_paths[index]
            or not isinstance(item.get("sha256"), str)
            or re.fullmatch(r"[0-9a-f]{64}", item["sha256"]) is None
            for index, item in enumerate(compose_files)
        )
    ):
        _fail("reset_input_provenance")

    mounts = provenance.get("mount_inventory")
    if not isinstance(mounts, list) or not mounts:
        _fail("reset_input_provenance")
    seen_mounts: set[tuple[str, str]] = set()
    for mount in mounts:
        if (
            not isinstance(mount, dict)
            or set(mount) != {"service", "source", "type", "destination"}
            or mount.get("service") not in EXPECTED_SERVICES
            or mount.get("type") != "volume"
            or mount.get("source") not in {
                "local-" + suffix for suffix in TARGET_VOLUME_SUFFIXES
            }
            or mount.get("destination") not in DESTINATIONS
        ):
            _fail("reset_input_provenance")
        identity = (mount["service"], mount["destination"])
        if identity in seen_mounts:
            _fail("reset_input_provenance")
        seen_mounts.add(identity)

    records = provenance.get("records")
    if not isinstance(records, list) or not 1 <= len(records) <= 64:
        _fail("reset_input_provenance")
    input_root = state / "inputs"
    try:
        input_info = input_root.lstat()
    except OSError:
        _fail("reset_input_provenance")
    if (
        stat.S_ISLNK(input_info.st_mode)
        or not stat.S_ISDIR(input_info.st_mode)
        or input_info.st_uid != os.getuid()
        or stat.S_IMODE(input_info.st_mode) != 0o700
    ):
        _fail("reset_input_provenance")
    expected_paths: set[Path] = set()
    for record in records:
        if not isinstance(record, dict):
            _fail("reset_input_provenance")
        expected_keys = {
            "path", "source", "source_sha256", "source_mode", "output_sha256",
            "sha256", "output_mode", "bytes", "service", "destination",
        }
        if "template_sha256" in record or "template_mode" in record:
            expected_keys |= {"template_sha256", "template_mode"}
        relative = _safe_relative_input(record.get("path"))
        source = _safe_relative_input(record.get("source"))
        if (
            set(record) != expected_keys
            or relative is None
            or source is None
            or relative in expected_paths
            or not isinstance(record.get("source_sha256"), str)
            or re.fullmatch(r"[0-9a-f]{64}", record["source_sha256"]) is None
            or record.get("output_sha256") != record["source_sha256"]
            or record.get("sha256") != record["source_sha256"]
            or record.get("source_mode") != "0644"
            or record.get("output_mode") != "0600"
            or type(record.get("bytes")) is not int
            or not 0 < record["bytes"] <= 4 * 1024 * 1024
            or record.get("service") not in EXPECTED_SERVICES
            or record.get("destination") not in DESTINATIONS
            or (
                "template_sha256" in record
                and (
                    record.get("template_sha256") != record["source_sha256"]
                    or record.get("template_mode") != "0644"
                )
            )
        ):
            _fail("reset_input_provenance")
        path = input_root / relative
        _regular_owned(path, mode=0o600)
        try:
            if path.stat().st_size != record["bytes"] or _hash_file(path) != record["sha256"]:
                _fail("reset_input_provenance")
        except OSError:
            _fail("reset_input_provenance")
        expected_paths.add(relative)

    functions_files = provenance.get("functions_files")
    if (
        not isinstance(functions_files, list)
        or not functions_files
        or len(functions_files) != len(set(functions_files))
        or any(
            _safe_relative_input(item) not in expected_paths
            or not item.startswith(FUNCTIONS_ROOT + "/")
            for item in functions_files
        )
    ):
        _fail("reset_input_provenance")

    actual_files: set[Path] = set()
    try:
        for path in input_root.rglob("*"):
            info = path.lstat()
            relative = path.relative_to(input_root)
            if stat.S_ISLNK(info.st_mode) or info.st_uid != os.getuid():
                _fail("reset_input_provenance")
            if stat.S_ISDIR(info.st_mode):
                if stat.S_IMODE(info.st_mode) != 0o700:
                    _fail("reset_input_provenance")
            elif stat.S_ISREG(info.st_mode):
                actual_files.add(relative)
            else:
                _fail("reset_input_provenance")
    except OSError:
        _fail("reset_input_provenance")
    if actual_files != expected_paths:
        _fail("reset_input_provenance")


def _admit_stale_reset_state(root: Path, project: str, state: Path) -> Path:
    try:
        info = state.lstat()
    except OSError:
        _fail("reset_state_provenance")
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISDIR(info.st_mode)
        or info.st_uid != os.getuid()
        or stat.S_IMODE(info.st_mode) != 0o700
        or state.name != project
        or state != _state_root(root, project)
    ):
        _fail("reset_state_provenance")
    env_path = _admit_reset_env(root, project, state)
    _admit_stale_input_provenance(project, state)
    return env_path


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
    expected_dirs = {
        parent
        for path in expected_files
        for parent in path.parents
        if str(parent) != "."
    } | {Path(".")}
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
_COMPOSE_ERROR_MARKERS = (
    ("image_rate_limited", ("toomanyrequests", "rate limit", "429 too many")),
    ("image_unavailable", ("manifest unknown", "pull access denied", "repository does not exist")),
    ("disk_full", ("no space left on device",)),
    ("port_conflict", ("address already in use", "port is already allocated")),
    ("permission_denied", ("permission denied", "operation not permitted")),
    ("network_unavailable", ("network is unreachable", "temporary failure in name resolution", "connection reset")),
)


def _compose_error_suffix(stderr: str) -> str:
    normalized = stderr.casefold()
    for suffix, markers in _COMPOSE_ERROR_MARKERS:
        if any(marker in normalized for marker in markers):
            return suffix
    return "unknown"



def _run(
    command: list[str],
    *,
    timeout: int = 120,
    error_code: str = "compose_command",
    retries: int = 0,
) -> subprocess.CompletedProcess[str]:
    environment = _safe_process_environment()
    for attempt in range(retries + 1):
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False, env=environment)
        except FileNotFoundError:
            _fail("docker_not_found")
        except subprocess.TimeoutExpired:
            if attempt < retries:
                time.sleep(10)
                continue
            _fail(f"{error_code}_timeout")
        if result.returncode == 0:
            return result
        if attempt < retries:
            time.sleep(10)
            continue
        _fail(f"{error_code}_{_compose_error_suffix(result.stderr)}")
    raise AssertionError("unreachable compose retry state")
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


def _docker_socket_admission_bytes(run_id: str, run_attempt: str) -> bytes:
    return (
        f"repo={DOCKER_SOCKET_ADMISSION_REPOSITORY}\n"
        f"run_id={run_id}\n"
        f"run_attempt={run_attempt}\n"
    ).encode("ascii")


def _github_actions_root_owned_socket(path: Path, owner: int) -> bool:
    run_id = os.environ.get("GITHUB_RUN_ID", "")
    run_attempt = os.environ.get("GITHUB_RUN_ATTEMPT", "")
    repository = os.environ.get("GITHUB_REPOSITORY", "")
    admission_value = os.environ.get(DOCKER_SOCKET_ADMISSION_ENV, "")
    if (
        path != DOCKER_SOCKET_DEFAULT
        or owner != 0
        or os.environ.get("GITHUB_ACTIONS") != "true"
        or os.environ.get("CI") != "true"
        or repository != DOCKER_SOCKET_ADMISSION_REPOSITORY
        or re.fullmatch(r"[1-9][0-9]*", run_id) is None
        or re.fullmatch(r"[1-9][0-9]*", run_attempt) is None
    ):
        return False
    expected_path = Path(f"/run/tzudong-nightly-local-admission-{run_id}-{run_attempt}")
    admission_path = Path(admission_value)
    if not admission_path.is_absolute() or admission_path != expected_path:
        return False
    try:
        info = admission_path.lstat()
    except OSError:
        return False
    if (
        not stat.S_ISREG(info.st_mode)
        or stat.S_ISLNK(info.st_mode)
        or info.st_uid != 0
        or stat.S_IMODE(info.st_mode) != 0o400
    ):
        return False
    try:
        readback = subprocess.run(
            ["/usr/bin/sudo", "-n", "--", "/bin/cat", str(admission_path)],
            capture_output=True,
            timeout=5,
            check=False,
            env={"PATH": "/usr/bin:/bin", "LANG": "C"},
        )
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired):
        return False
    raw = readback.stdout
    return (
        readback.returncode == 0
        and isinstance(raw, bytes)
        and readback.stderr == b""
        and len(raw) <= 256
        and hmac.compare_digest(raw, _docker_socket_admission_bytes(run_id, run_attempt))
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
                if parsed.scheme in {"http", "https"} and parsed.hostname not in {"localhost", "127.0.0.1", "::1", LOCAL_REALTIME_TENANT_HOST, *EXPECTED_SERVICES}:
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
        if actual_name not in {f"{project}-{suffix}" for suffix in TARGET_VOLUME_SUFFIXES}:
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


def _probe_response_header_values(response: Any, name: str) -> tuple[str, ...] | None:
    try:
        headers = getattr(response, "headers")
        get_all = getattr(headers, "get_all", None)
        if callable(get_all):
            raw_values = get_all(name) or get_all(name.lower()) or []
        else:
            value = headers.get(name)
            if value is None:
                value = headers.get(name.lower())
            raw_values = [] if value is None else [value]
    except (AttributeError, OSError, TypeError, ValueError):
        return None
    values: list[str] = []
    for value in raw_values:
        if not isinstance(value, str) or not value.strip():
            return None
        values.append(value.strip())
    return tuple(values)


def _probe_response_header(response: Any, name: str) -> str | None:
    values = _probe_response_header_values(response, name)
    if values is None or len(values) != 1:
        return None
    return values[0]


def _probe_header_tokens(
    response: Any,
    name: str,
    *,
    normalize: str,
    allow_duplicate_tokens: bool = False,
) -> frozenset[str] | None:
    values = _probe_response_header_values(response, name)
    if values is None:
        return None
    if not values:
        return frozenset()
    parts = tuple(
        part.strip()
        for value in values
        for part in value.split(",")
    )
    if not parts or any(not part for part in parts):
        return None
    if normalize == "lower":
        normalized = tuple(part.lower() for part in parts)
    elif normalize == "upper":
        normalized = tuple(part.upper() for part in parts)
    else:
        return None
    if not allow_duplicate_tokens and len(normalized) != len(set(normalized)):
        return None
    return frozenset(normalized)


def _probe_cors_vary(
    response: Any,
    expected_token_sets: frozenset[frozenset[str]],
) -> frozenset[str] | None:
    vary = _probe_header_tokens(
        response,
        "Vary",
        normalize="lower",
        allow_duplicate_tokens=True,
    )
    if vary is None or vary not in expected_token_sets:
        return None
    return vary


def _probe_local_cors_preflight(
    port: int,
    path: str,
    *,
    target_host: str,
    origin: str,
    request_method: str,
    request_headers: tuple[str, ...],
    expected_methods: tuple[str, ...],
    expected_credentials: bool,
    expected_allowed: bool,
    timeout: int = 5,
) -> bool:
    if (
        target_host not in LOCAL_CORS_TARGET_HOSTS
        or origin not in (*LOCAL_BROWSER_ORIGINS, LOCAL_CORS_REJECTED_ORIGIN)
        or request_method not in expected_methods
        or not expected_methods
        or len(expected_methods) != len(set(expected_methods))
        or any(method != method.upper() for method in expected_methods)
        or not path.startswith("/")
        or "\r" in path
        or "\n" in path
        or not request_headers
        or len(request_headers) != len(set(request_headers))
        or any(header != header.lower() for header in request_headers)
    ):
        return False
    expected_url = f"http://{target_host}:{port}{path}"
    try:
        request = Request(
            expected_url,
            headers={
                "User-Agent": "tzudong-local-readiness",
                "Origin": origin,
                "Access-Control-Request-Method": request_method,
                "Access-Control-Request-Headers": ", ".join(request_headers),
            },
            method="OPTIONS",
        )
        with _NO_REDIRECT_OPENER.open(request, timeout=timeout) as response:
            status, status_class, exact_url = _probe_response_evidence(
                response, expected_url
            )
            allowed_methods = _probe_header_tokens(
                response, "Access-Control-Allow-Methods", normalize="upper"
            )
            allowed_headers = _probe_header_tokens(
                response, "Access-Control-Allow-Headers", normalize="lower"
            )
            vary = _probe_cors_vary(
                response,
                frozenset((LOCAL_CORS_PREFLIGHT_VARY_TOKENS,)),
            )
            allow_origin = _probe_response_header(
                response, "Access-Control-Allow-Origin"
            )
            allow_credentials = _probe_response_header(
                response, "Access-Control-Allow-Credentials"
            )
            if (
                status != 200
                or status_class != "2xx"
                or not exact_url
                or allowed_methods != frozenset(expected_methods)
                or allowed_headers != frozenset(request_headers)
                or vary is None
                or _probe_response_header(response, "Access-Control-Max-Age")
                    != LOCAL_CORS_MAX_AGE
                or allow_credentials
                    != ("true" if expected_credentials else None)
            ):
                return False
            return allow_origin == origin if expected_allowed else allow_origin is None
    except (HTTPError, OSError, ValueError):
        return False


def _probe_local_cors_actual_response(
    port: int,
    path: str,
    *,
    target_host: str,
    origin: str,
    request_method: str,
    request_headers: Mapping[str, str] | None,
    request_body: bytes | None,
    expected_exposed_headers: tuple[str, ...],
    expected_credentials: bool,
    timeout: int = 5,
) -> bool:
    if (
        target_host not in LOCAL_CORS_TARGET_HOSTS
        or origin not in LOCAL_BROWSER_ORIGINS
        or request_method not in LOCAL_CORS_METHODS
        or not path.startswith("/")
        or "\r" in path
        or "\n" in path
    ):
        return False
    expected_url = f"http://{target_host}:{port}{path}"
    try:
        request = Request(
            expected_url,
            headers={
                "User-Agent": "tzudong-local-readiness",
                "Origin": origin,
                **(request_headers or {}),
            },
            data=request_body,
            method=request_method,
        )
        with _NO_REDIRECT_OPENER.open(request, timeout=timeout) as response:
            status, status_class, exact_url = _probe_response_evidence(
                response, expected_url
            )
            vary = _probe_cors_vary(
                response,
                LOCAL_CORS_ACTUAL_VARY_TOKEN_SETS,
            )
            exposed = _probe_header_tokens(
                response, "Access-Control-Expose-Headers", normalize="lower"
            )
            return (
                status == 200
                and status_class == "2xx"
                and exact_url
                and _probe_response_header(
                    response, "Access-Control-Allow-Origin"
                ) == origin
                and _probe_response_header(
                    response, "Access-Control-Allow-Credentials"
                ) == ("true" if expected_credentials else None)
                and vary is not None
                and exposed == frozenset(expected_exposed_headers)
            )
    except (HTTPError, OSError, ValueError):
        return False


def _probe_local_cors_contract(
    port: int,
    service: str,
    *,
    timeout: int = 5,
) -> bool:
    if service == "auth":
        preflight_paths = ("/auth/v1/token?grant_type=password",)
        request_method = "POST"
        request_headers = LOCAL_AUTH_CORS_HEADERS
        expected_methods = LOCAL_CORS_METHODS
        expected_credentials = True
        actual_path = "/auth/v1/health"
        actual_method = "GET"
        actual_headers: Mapping[str, str] | None = None
        actual_body = None
        exposed_headers = LOCAL_AUTH_CORS_EXPOSED_HEADERS
    elif service == "rest":
        preflight_paths = (
            "/rest/v1/announcements?select=id&limit=1",
            "/rest/v1/ad_banners?select=id&limit=1",
        )
        request_method = "GET"
        request_headers = LOCAL_REST_CORS_HEADERS
        expected_methods = LOCAL_CORS_METHODS
        expected_credentials = False
        actual_path = "/rest/v1/"
        actual_method = "GET"
        actual_headers = None
        actual_body = None
        exposed_headers = LOCAL_REST_CORS_EXPOSED_HEADERS
    elif service == "storage":
        preflight_paths = (
            "/storage/v1/object/review-photos/local-cors-probe",
            "/storage/v1/object/public/review-photos/local-cors-probe",
        )
        request_method = "POST"
        request_headers = LOCAL_STORAGE_CORS_HEADERS
        expected_methods = LOCAL_STORAGE_CORS_METHODS
        expected_credentials = False
        actual_path = "/storage/v1/status"
        actual_method = "GET"
        actual_headers = None
        actual_body = None
        exposed_headers = LOCAL_STORAGE_CORS_EXPOSED_HEADERS
    elif service == "functions":
        preflight_paths = ("/functions/v1/naver-geocode",)
        request_method = "POST"
        request_headers = LOCAL_FUNCTION_CORS_HEADERS
        expected_methods = LOCAL_FUNCTION_CORS_METHODS
        expected_credentials = False
        actual_path = "/functions/v1/naver-geocode"
        actual_method = "POST"
        actual_headers = {"Content-Type": "application/json"}
        actual_body = json.dumps(
            LOCAL_NAVER_READINESS_REQUEST,
            ensure_ascii=True,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("ascii")
        exposed_headers = LOCAL_FUNCTION_CORS_EXPOSED_HEADERS
    else:
        return False
    for target_host in LOCAL_CORS_TARGET_HOSTS:
        for origin in LOCAL_BROWSER_ORIGINS:
            for path in preflight_paths:
                if not _probe_local_cors_preflight(
                    port,
                    path,
                    target_host=target_host,
                    origin=origin,
                    request_method=request_method,
                    request_headers=request_headers,
                    expected_methods=expected_methods,
                    expected_credentials=expected_credentials,
                    expected_allowed=True,
                    timeout=timeout,
                ):
                    return False
            if not _probe_local_cors_actual_response(
                port,
                actual_path,
                target_host=target_host,
                origin=origin,
                request_method=actual_method,
                request_headers=actual_headers,
                request_body=actual_body,
                expected_exposed_headers=exposed_headers,
                expected_credentials=expected_credentials,
                timeout=timeout,
            ):
                return False
        if not _probe_local_cors_preflight(
            port,
            preflight_paths[0],
            target_host=target_host,
            origin=LOCAL_CORS_REJECTED_ORIGIN,
            request_method=request_method,
            request_headers=request_headers,
            expected_methods=expected_methods,
            expected_credentials=expected_credentials,
            expected_allowed=False,
            timeout=timeout,
        ):
            return False
    return True


def _probe_host_tcp(port: int, timeout: int = 5) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=timeout):
            return True
    except OSError:
        return False


def _probe_local_realtime_websocket(
    port: int,
    anon_key: str,
    *,
    timeout: int = LOCAL_REALTIME_READINESS_TIMEOUT_SECONDS,
) -> bool:
    root = Path(__file__).resolve().parents[3]
    ws_module = root / "apps/web/node_modules/ws"
    realtime_module = (
        root
        / "apps/web/node_modules/@supabase/realtime-js/dist/main/index.js"
    )
    if (
        not isinstance(port, int)
        or port < 1
        or port > 65535
        or not isinstance(anon_key, str)
        or not anon_key
        or timeout < 1
        or timeout > LOCAL_REALTIME_READINESS_TIMEOUT_SECONDS
    ):
        return False
    try:
        _regular_owned(ws_module / "package.json")
        _regular_owned(realtime_module)
        payload = json.dumps(
            {
                "targetHost": "127.0.0.1",
                "port": port,
                "apikey": anon_key,
                "origin": LOCAL_BROWSER_ORIGINS[0],
                "wsModule": str(ws_module),
                "realtimeModule": str(realtime_module),
            },
            ensure_ascii=True,
            sort_keys=True,
            separators=(",", ":"),
        )
        result = subprocess.run(
            ["node", "-e", LOCAL_REALTIME_READINESS_SCRIPT],
            input=payload,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            env=_safe_process_environment(),
        )
    except (FileNotFoundError, OSError, subprocess.TimeoutExpired, ValueError):
        return False
    return result.returncode == 0 and not result.stdout and not result.stderr


def _probe_local_function_json(
    port: int,
    path: str,
    *,
    expected_payload: object,
    request_payload: object | None = None,
    fixture_provenance: str | None = None,
    timeout: int = 5,
) -> bool:
    expected_url = f"http://127.0.0.1:{port}{path}"
    body = None
    method = "GET"
    headers = {"User-Agent": "tzudong-local-readiness"}
    if request_payload is not None:
        body = json.dumps(
            request_payload,
            ensure_ascii=True,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("ascii")
        method = "POST"
        headers["Content-Type"] = "application/json"
    try:
        request = Request(expected_url, data=body, headers=headers, method=method)
        with _NO_REDIRECT_OPENER.open(request, timeout=timeout) as response:
            status, status_class, exact_url = _probe_response_evidence(
                response, expected_url
            )
            raw = response.read(LOCAL_FUNCTION_READINESS_MAX_BYTES + 1)
            if (
                status != 200
                or status_class != "2xx"
                or not exact_url
                or len(raw) > LOCAL_FUNCTION_READINESS_MAX_BYTES
                or response.headers.get("content-type")
                    != "application/json; charset=utf-8"
                or response.headers.get("cache-control") != "no-store"
                or (
                    fixture_provenance is not None
                    and response.headers.get("x-tzudong-local-fixture")
                        != fixture_provenance
                )
            ):
                return False
            parsed = json.loads(raw.decode("utf-8", errors="strict"))
            return parsed == expected_payload
    except (
        HTTPError,
        json.JSONDecodeError,
        OSError,
        UnicodeDecodeError,
        ValueError,
    ):
        return False

def _probe_database_bootstrap(command: list[str], timeout: int = 5) -> bool:
    try:
        result = subprocess.run(
            command + [
                "exec", "-T", "db",
                "psql", "-U", "postgres", "-d", "_supabase",
                "-Atqc", "select 1 from pg_namespace where nspname = '_analytics'",
            ],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            env=_safe_process_environment(),
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0 and result.stdout.strip() == "1"


def _ensure_local_analytics_namespace(command: list[str]) -> None:
    """Create only the local Data API namespace before PostgREST starts.

    Application tables and service-role grants remain owned by the canonical
    migration. This ordering bridge prevents a fresh PostgREST instance from
    failing its schema cache before local-migrate can connect to the stack.
    """
    sql = """
BEGIN;
DO $local_analytics_namespace$
DECLARE
  v_owner name;
BEGIN
  SELECT pg_catalog.pg_get_userbyid(namespace.nspowner)
    INTO v_owner
    FROM pg_catalog.pg_namespace AS namespace
   WHERE namespace.nspname = 'local_analytics';
  IF v_owner IS NULL THEN
    CREATE SCHEMA local_analytics AUTHORIZATION postgres;
  ELSIF v_owner <> 'postgres' THEN
    RAISE EXCEPTION 'local_analytics_namespace_owner_drift';
  END IF;
END;
$local_analytics_namespace$;
REVOKE ALL ON SCHEMA local_analytics FROM PUBLIC;
COMMIT;
SELECT pg_catalog.count(*)
  FROM pg_catalog.pg_namespace AS namespace
 WHERE namespace.nspname = 'local_analytics'
   AND pg_catalog.pg_get_userbyid(namespace.nspowner) = 'postgres'
   AND NOT pg_catalog.has_schema_privilege('anon', namespace.oid, 'CREATE')
   AND NOT pg_catalog.has_schema_privilege('authenticated', namespace.oid, 'CREATE')
   AND NOT pg_catalog.has_schema_privilege('service_role', namespace.oid, 'CREATE')
   AND NOT EXISTS (
     SELECT 1
       FROM pg_catalog.aclexplode(
         COALESCE(
           namespace.nspacl,
           pg_catalog.acldefault('n', namespace.nspowner)
         )
       ) AS acl
      WHERE acl.grantee = 0
        AND acl.privilege_type IN ('USAGE', 'CREATE')
   );
"""
    result = _run(
        command + [
            "exec", "-T", "db", "psql", "-X", "-v", "ON_ERROR_STOP=1",
            "-U", "postgres", "-d", "postgres", "-Atqc", sql,
        ],
        timeout=30,
        error_code="compose_local_analytics_namespace",
    )
    if result.stdout.strip() != "1":
        _fail("compose_local_analytics_namespace_readback")

def _probe_service(command: list[str], values: dict[str, str], service: str, timeout: int = 5) -> bool:
    if service == "db":
        return (
            _probe_endpoint(command, service, READINESS_ENDPOINTS[service], timeout)
            and _probe_database_bootstrap(command, timeout)
        )
    if service == "kong":
        return _probe_host_http(int(values["KONG_HTTP_PORT"]), "/auth/v1/health", timeout=timeout)
    if service == "rest":
        return (
            _probe_host_http(int(values["KONG_HTTP_PORT"]), "/rest/v1/", timeout=timeout)
            and _probe_host_https(int(values["KONG_HTTPS_PORT"]), "/rest/v1/", timeout=timeout)
            and _probe_local_cors_contract(
                int(values["KONG_HTTP_PORT"]), "rest", timeout=timeout
            )
        )
    if service == "auth":
        return (
            _probe_host_http(int(values["KONG_HTTP_PORT"]), "/auth/v1/health", timeout=timeout)
            and _probe_host_https(int(values["KONG_HTTPS_PORT"]), "/auth/v1/health", timeout=timeout)
            and _probe_local_cors_contract(
                int(values["KONG_HTTP_PORT"]), "auth", timeout=timeout
            )
        )
    if service == "storage":
        return (
            _probe_host_http(
                int(values["KONG_HTTP_PORT"]),
                "/storage/v1/bucket",
                headers={"apikey": values["ANON_KEY"], "Authorization": "Bearer " + values["ANON_KEY"]},
                timeout=timeout,
            )
            and _probe_local_cors_contract(
                int(values["KONG_HTTP_PORT"]), "storage", timeout=timeout
            )
        )
    if service == "realtime":
        return _probe_local_realtime_websocket(
            int(values["KONG_HTTP_PORT"]),
            values["ANON_KEY"],
            timeout=min(timeout + 3, LOCAL_REALTIME_READINESS_TIMEOUT_SECONDS),
        )
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
        return (
            _probe_local_function_json(
                int(values["KONG_HTTP_PORT"]),
                "/functions/v1/main",
                expected_payload=LOCAL_FUNCTION_MAIN_RESPONSE,
                timeout=timeout,
            )
            and _probe_local_function_json(
                int(values["KONG_HTTP_PORT"]),
                "/functions/v1/naver-geocode",
                request_payload=LOCAL_NAVER_READINESS_REQUEST,
                expected_payload=LOCAL_NAVER_READINESS_RESPONSE,
                fixture_provenance=LOCAL_NAVER_FIXTURE_PROVENANCE,
                timeout=timeout,
            )
            and _probe_local_cors_contract(
                int(values["KONG_HTTP_PORT"]), "functions", timeout=timeout
            )
        )
    if service == "mail":
        return _probe_host_http(int(values["MAIL_WEB_PORT"]), "/", timeout=timeout)
    return _probe_endpoint(command, service, READINESS_ENDPOINTS[service], timeout)


def _wait_ready(
    command: list[str],
    values: dict[str, str],
    timeout: int = 300,
    required: Iterable[str] = READINESS_REQUIRED,
) -> list[dict[str, str]]:
    global _LAST_READINESS_DIAGNOSTICS
    required_services = tuple(required)
    if any(service not in READINESS_ENDPOINTS for service in required_services):
        _fail("readiness_contract")
    diagnostics: dict[str, dict[str, object]] = {
        service: {
            "service": service,
            "result": "not_probed",
            "duration_ms": 0,
        }
        for service in required_services
    }
    _LAST_READINESS_DIAGNOSTICS = tuple(
        dict(diagnostics[service]) for service in required_services
    )
    ready_services: set[str] = set()

    def probe(service: str) -> bool:
        global _LAST_READINESS_DIAGNOSTICS
        started = time.monotonic()
        try:
            ready = _probe_service(command, values, service)
        except (LocalStackError, OSError, ValueError):
            ready = False
        duration_ms = min(
            LOCAL_READINESS_DURATION_MAX_MS,
            max(0, int(round((time.monotonic() - started) * 1000))),
        )
        diagnostics[service] = {
            "service": service,
            "result": "ready" if ready else "not_ready",
            "duration_ms": duration_ms,
        }
        if ready:
            ready_services.add(service)
        else:
            ready_services.discard(service)
        _LAST_READINESS_DIAGNOSTICS = tuple(
            dict(diagnostics[item]) for item in required_services
        )
        return ready

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        rows = _ps(command)
        services = _service_receipts(rows)
        by_service = {item["service"]: item for item in services}
        running_services = {
            service
            for service in required_services
            if by_service.get(service, {}).get("state") == "running"
        }
        for service in required_services:
            if service not in running_services:
                ready_services.discard(service)
                diagnostics[service] = {
                    "service": service,
                    "result": "not_running",
                    "duration_ms": 0,
                }
        # Probe every running service independently of absent peers. Successful
        # results are cached only during convergence so an absent service does
        # not force all already-ready probes to repeat on every iteration.
        for service in required_services:
            if service in running_services and service not in ready_services:
                probe(service)
        if (
            len(running_services) == len(required_services)
            and len(ready_services) == len(required_services)
        ):
            # Revalidate the complete set immediately before success. A service
            # that regressed after its cached convergence probe cannot be hidden.
            final_results = [probe(service) for service in required_services]
            final_ready = all(final_results)
            if final_ready:
                for item in services:
                    if item["service"] in required_services and item["health"] in {"", "starting"}:
                        item["health"] = "healthy"
                _LAST_READINESS_DIAGNOSTICS = ()
                return services
        time.sleep(1)
    _LAST_READINESS_DIAGNOSTICS = tuple(
        dict(diagnostics[service]) for service in required_services
    )
    first_failure = next(
        (
            service
            for result in ("not_running", "not_ready", "not_probed")
            for service in required_services
            if diagnostics[service]["result"] == result
        ),
        required_services[0] if required_services else "contract",
    )
    raise LocalStackError(
        f"readiness_timeout_{first_failure}",
        readiness=_LAST_READINESS_DIAGNOSTICS,
    )


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


def _assert_project_runtime_resources(project: str) -> None:
    container_rows = _docker_json_rows(
        [
            "docker", "ps", "-a",
            "--filter", f"label={DOCKER_PROJECT_LABEL}={project}",
            "--format", "{{json .}}",
        ],
        "reset_resource_identity",
    )
    for row in container_rows:
        labels = _docker_labels(row.get("Labels"))
        if (
            labels.get(DOCKER_PROJECT_LABEL) != project
            or labels.get(DOCKER_SERVICE_LABEL) not in EXPECTED_SERVICES
        ):
            _fail("reset_resource_identity")
    network_rows = _docker_json_rows(
        [
            "docker", "network", "ls",
            "--filter", f"label={DOCKER_PROJECT_LABEL}={project}",
            "--format", "{{json .}}",
        ],
        "reset_resource_identity",
    )
    for row in network_rows:
        labels = _docker_labels(row.get("Labels"))
        name = row.get("Name") or row.get("name")
        if labels.get(DOCKER_PROJECT_LABEL) != project or name != f"{project}_default":
            _fail("reset_resource_identity")


def _assert_project_resources_absent(project: str) -> None:
    checks = (
        [
            "docker", "ps", "-aq", "--no-trunc",
            "--filter", f"label={DOCKER_PROJECT_LABEL}={project}",
        ],
        [
            "docker", "volume", "ls", "-q",
            "--filter", f"label={DOCKER_PROJECT_LABEL}={project}",
        ],
        [
            "docker", "network", "ls", "-q",
            "--filter", f"label={DOCKER_PROJECT_LABEL}={project}",
        ],
    )
    for command in checks:
        result = _run(
            command,
            timeout=30,
            error_code="reset_cleanup_readback",
            retries=2,
        )
        if result.stdout.strip():
            _fail("reset_cleanup_residue")
    volume_rows = _docker_json_rows(
        ["docker", "volume", "ls", "--format", "{{json .}}"],
        "reset_cleanup_readback",
    )
    names = {
        str(row.get("Name") or row.get("name"))
        for row in volume_rows
        if row.get("Name") is not None or row.get("name") is not None
    }
    if names & set(_target_volume_names(project)):
        _fail("reset_cleanup_residue")


def _expected_staged_files(state: Path) -> tuple[tuple[str, str, str], ...]:
    records: list[tuple[str, str, str]] = []
    for source_name, volume_suffix, destination_name in STAGED_INPUT_FILES:
        source = state / "inputs" / source_name
        _regular_owned(source, mode=0o600)
        records.append((volume_suffix, destination_name, _hash_file(source)))
    records.extend(
        ("db-init-scripts", destination_name, digest)
        for destination_name, digest in IMAGE_INIT_SCRIPT_SHA256
    )
    records.extend(
        ("db-init-migrations", destination_name, digest)
        for destination_name, digest in IMAGE_MIGRATION_SHA256
    )
    return tuple(sorted(records))


def _staged_verification_commands(
    expected: tuple[tuple[str, str, str], ...],
    volume_paths: Mapping[str, str],
) -> list[str]:
    commands: list[str] = []
    for volume_suffix, root in volume_paths.items():
        files = [item for item in expected if item[0] == volume_suffix]
        if not files:
            _fail("compose_input_readback_model")
        directories = {
            str(parent)
            for _suffix, relative, _digest in files
            for parent in Path(relative).parents
            if str(parent) != "."
        }
        quoted_root = shlex.quote(root)
        commands.extend((
            f'test "$(find {quoted_root} -mindepth 1 -type f | wc -l | tr -d "[:space:]")" = "{len(files)}"',
            f'test "$(find {quoted_root} -mindepth 1 -type d | wc -l | tr -d "[:space:]")" = "{len(directories)}"',
            f'test "$(find {quoted_root} -mindepth 1 -type l | wc -l | tr -d "[:space:]")" = "0"',
        ))
        for _suffix, relative, digest in files:
            destination = shlex.quote(f"{root}/{relative}")
            commands.extend((
                f"test -f {destination}",
                f"test -r {destination}",
                f'test "$(stat -c %a {destination})" = "644"',
                f"printf '%s  %s\\n' {shlex.quote(digest)} {destination} | sha256sum --check --status",
            ))
    return commands


def _remove_volume_helper(helper_name: str, error_code: str) -> None:
    discovery = _run(
        ["docker", "ps", "-aq", "--no-trunc", "--filter", f"name=^/{helper_name}$"],
        timeout=60,
        error_code=f"{error_code}_cleanup_discovery",
        retries=2,
    )
    helper_ids = [line.strip() for line in discovery.stdout.splitlines() if line.strip()]
    if any(re.fullmatch(r"[0-9a-f]{12,64}", item) is None for item in helper_ids):
        _fail(f"{error_code}_cleanup_identity")
    if helper_ids:
        _run(
            ["docker", "rm", "-f", *helper_ids],
            timeout=60,
            error_code=f"{error_code}_cleanup",
            retries=2,
        )
    readback = _run(
        ["docker", "ps", "-aq", "--no-trunc", "--filter", f"name=^/{helper_name}$"],
        timeout=30,
        error_code=f"{error_code}_cleanup_readback",
        retries=2,
    )
    if readback.stdout.strip():
        _fail(f"{error_code}_cleanup_residue")


def _execute_volume_helper(
    project: str,
    state: Path,
    *,
    commands: list[str],
    read_only: bool,
    include_inputs: bool,
    error_code: str,
) -> None:
    helper_name = f"{project}-{error_code.replace('_', '-')}-{secrets.token_hex(6)}"
    volume_args: list[str] = []
    for suffix, path in STAGED_VOLUME_PATHS.items():
        mode = ":ro" if read_only else ""
        volume_args.extend(("-v", f"{project}-{suffix}:{path}{mode}"))
    input_args = (
        ["-v", f"{state / 'inputs'}:/inputs:ro"]
        if include_inputs
        else []
    )
    try:
        result = _run(
            [
                "docker", "create",
                "--name", helper_name,
                "--network", "none",
                "--entrypoint", "sh",
                *input_args,
                *volume_args,
                "supabase/postgres:15.8.1.085",
                "-c", "; ".join(("set -eu", *commands)),
            ],
            error_code=error_code,
        )
        helper_id = result.stdout.strip()
        if not re.fullmatch(r"[0-9a-f]{12,64}", helper_id):
            _fail(error_code)
        _run(["docker", "start", helper_name], error_code=error_code)
        wait_result = _run(["docker", "wait", helper_name], error_code=error_code)
        if wait_result.stdout.strip() != "0":
            _fail(error_code)
    finally:
        _remove_volume_helper(helper_name, error_code)


def _stage_input_files(project: str, state: Path) -> None:
    expected = _expected_staged_files(state)
    commands = [
        *(f"find {shlex.quote(path)} -mindepth 1 -maxdepth 1 -exec rm -rf -- {{}} +" for path in STAGED_VOLUME_PATHS.values()),
        "cp -a /docker-entrypoint-initdb.d/init-scripts/. /scripts/",
        "cp -a /docker-entrypoint-initdb.d/migrations/. /migrations/",
        "mkdir -p /functions/main /functions/naver-geocode",
        *(f"cp {shlex.quote('/inputs/' + source)} {shlex.quote(STAGED_VOLUME_PATHS[suffix] + '/' + destination)}" for source, suffix, destination in STAGED_INPUT_FILES),
        *(f"chmod 0644 {shlex.quote(STAGED_VOLUME_PATHS[suffix] + '/' + destination)}" for suffix, destination, _digest in expected),
        *_staged_verification_commands(expected, STAGED_VOLUME_PATHS),
    ]
    _execute_volume_helper(
        project,
        state,
        commands=commands,
        read_only=False,
        include_inputs=True,
        error_code="compose_input_stage",
    )


def _verify_staged_input_files(project: str, state: Path, command: list[str]) -> None:
    expected = _expected_staged_files(state)
    _execute_volume_helper(
        project,
        state,
        commands=_staged_verification_commands(expected, STAGED_VOLUME_PATHS),
        read_only=True,
        include_inputs=False,
        error_code="compose_input_readback",
    )
    db_result = _run(
        command + ["ps", "-q", "db"],
        timeout=30,
        error_code="compose_input_readback_db_identity",
    )
    db_ids = [line.strip() for line in db_result.stdout.splitlines() if line.strip()]
    if len(db_ids) != 1 or re.fullmatch(r"[0-9a-f]{12,64}", db_ids[0]) is None:
        _fail("compose_input_readback_db_identity")
    db_expected = tuple(item for item in expected if item[0] in DATABASE_STAGED_VOLUME_PATHS)
    _run(
        [
            "docker", "exec", "--user", "postgres", db_ids[0], "sh", "-c",
            "; ".join(("set -eu", *_staged_verification_commands(db_expected, DATABASE_STAGED_VOLUME_PATHS))),
        ],
        timeout=60,
        error_code="compose_input_readback_db_runtime",
    )


def _action_render(root: Path, project: str, state: Path) -> dict[str, Any]:
    digest, _, _ = _render(root, project, state)
    input_digest, env_digest = _provenance_digests(state)
    return _write_receipt(
        state, "render", ok=True, project=project, config_sha256=digest,
        input_provenance_sha256=input_digest, env_provenance_sha256=env_digest,
    )


def _start_core_services(command: list[str], values: dict[str, str]) -> None:
    for services, wait_for in CORE_START_PHASES:
        for service in services:
            _run(
                command + ["start", service],
                timeout=COMPOSE_SERVICE_START_TIMEOUT_SECONDS,
                error_code=f"compose_core_start_{service}",
                retries=COMPOSE_SERVICE_START_RETRIES,
            )
        if wait_for:
            _wait_ready(
                command,
                values,
                timeout=(
                    COMPOSE_DATABASE_BOOTSTRAP_TIMEOUT_SECONDS
                    if wait_for == ("db",)
                    else 300
                ),
                required=wait_for,
            )
            if wait_for == ("db",):
                _ensure_local_analytics_namespace(command)


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
            command + ["create", "--force-recreate", "--pull=missing", *CORE_SERVICES],
            timeout=COMPOSE_START_TIMEOUT_SECONDS,
            error_code="compose_core_create",
            retries=COMPOSE_START_RETRIES,
        )
        _stage_input_files(project, state)
        _start_core_services(command, values)
        _wait_ready(command, values, required=CORE_REQUIRED)
        _run(
            command + ["up", "--no-deps", "--no-start", "--force-recreate", "--pull=missing", "studio"],
            timeout=COMPOSE_START_TIMEOUT_SECONDS,
            error_code="compose_studio_create",
            retries=COMPOSE_START_RETRIES,
        )
        _run(
            command + ["start", "studio"],
            timeout=COMPOSE_SERVICE_START_TIMEOUT_SECONDS,
            error_code="compose_studio_start_studio",
            retries=COMPOSE_SERVICE_START_RETRIES,
        )
        services = _wait_ready(command, values)
        _verify_staged_input_files(project, state, command)
    except (LocalStackError, OSError, ValueError):
        if started and os.environ.get("LOCAL_STACK_PRESERVE_FAILURE_STATE") != "1":
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
    try:
        state.lstat()
        state_exists = True
    except FileNotFoundError:
        state_exists = False
    except OSError:
        _fail("reset_state_provenance")
    if state_exists:
        env_path = _admit_stale_reset_state(root, project, state)
    else:
        env_path, _ = _ensure_env(root, project, state)
    files = _compose_files(root)
    for path in files:
        _regular_owned(path)
    command = _compose(project, env_path, files)
    _run(command + ["config", "--quiet"], error_code="reset_compose_config")
    _assert_project_volumes(command, project)
    _assert_project_runtime_resources(project)
    try:
        _ACTIVE_COMMAND = command
        _run(
            command + ["down", "-v", "--remove-orphans"],
            timeout=COMPOSE_START_TIMEOUT_SECONDS,
            error_code="reset_cleanup",
            retries=COMPOSE_START_RETRIES,
        )
    finally:
        _ACTIVE_COMMAND = None
    _assert_project_resources_absent(project)
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


def _bounded_readiness_diagnostics(
    value: object,
) -> list[dict[str, object]]:
    if not isinstance(value, (list, tuple)) or len(value) > len(READINESS_ENDPOINTS):
        return []
    bounded: list[dict[str, object]] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, dict) or set(item) != {
            "service", "result", "duration_ms",
        }:
            return []
        service = item.get("service")
        result = item.get("result")
        duration_ms = item.get("duration_ms")
        if (
            not isinstance(service, str)
            or service not in READINESS_ENDPOINTS
            or service in seen
            or not isinstance(result, str)
            or result not in LOCAL_READINESS_RESULTS
            or not isinstance(duration_ms, int)
            or isinstance(duration_ms, bool)
            or duration_ms < 0
            or duration_ms > LOCAL_READINESS_DURATION_MAX_MS
        ):
            return []
        seen.add(service)
        bounded.append({
            "service": service,
            "result": result,
            "duration_ms": duration_ms,
        })
    return bounded


def _error_receipt(
    action: str,
    project: str,
    state: Path | None,
    code: str,
    *,
    readiness: object = (),
) -> dict[str, Any]:
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
    bounded_readiness = _bounded_readiness_diagnostics(readiness)
    if bounded_readiness:
        receipt["readiness"] = bounded_readiness
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
        readiness: object = ()
        if isinstance(exc, LocalStackError):
            code = exc.code
            readiness = exc.readiness
        _emit(_error_receipt(
            action,
            project,
            state,
            code,
            readiness=readiness,
        ))
        return 2
    except KeyboardInterrupt:
        _emit(_error_receipt(
            action,
            project,
            state,
            "interrupted",
            readiness=_LAST_READINESS_DIAGNOSTICS,
        ))
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
