#!/usr/bin/env python3
"""Observability_Stack starter for the platform-modernization spec (Requirement 12).

This is the single-run startup surface described in design section C8
("Observability_Stack 상호연동"). It orchestrates the existing compose overlays
under ``backend/deploy/pipeline-control/`` (the post-P5 owned path) —
``docker-compose.observability.yml`` (otel-collector, prometheus, grafana) plus
the optional kafka / elasticsearch overlays and the Loki log sink — in one run,
then performs per-service readiness checks.

It does not duplicate the compose declarations. The compose files already bind
every host port to ``127.0.0.1`` loopback, keep Grafana anonymous auth and
self sign-up off, read the admin password only from ``GRAFANA_ADMIN_PASSWORD``,
and pin every image to an exact tag. This module reuses and validates those
declarations, fails closed with the bounded fixed codes, and records a startup
artifact that excludes every Forbidden_Log_Field.

Everything is injectable — the compose command runner, the readiness probe, the
clock/sleep, the environment mapping, and the docker context inspector — so the
orchestration and validators are unit-testable with no live Docker, no network,
and no operator secrets. See design Property 25 (tag fixity) and Property 26
(loopback boundary); the dedicated property tests are spec tasks 25.1 / 25.2.

``backend/bin`` scripts are standalone (no ``__init__.py``); this module is
loaded by path by its tests. It performs no direct network I/O and never
records cookies, headers, credentials, provider diagnostics, database error
strings, free-form error strings, or any other Forbidden_Log_Field — only the
bounded fields enumerated in design C8 (Requirement 12.9).
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

# ---------------------------------------------------------------------------
# Bounded fixed codes (design C8 / error-code table). ``None`` means accepted.
# ---------------------------------------------------------------------------

NON_LOOPBACK_BIND_REJECTED = "non_loopback_bind_rejected"  # 12.3
DASHBOARD_CREDENTIAL_MISSING = "dashboard_credential_missing"  # 12.8
SERVICE_READINESS_TIMEOUT = "service_readiness_timeout"  # 12.13
REMOTE_CONTEXT_REJECTED = "remote_context_rejected"  # 12.11

# The full closed set this starter may return. Any other value is a defect.
STARTUP_RESULT_CODES = frozenset(
    {
        None,
        NON_LOOPBACK_BIND_REJECTED,
        DASHBOARD_CREDENTIAL_MISSING,
        SERVICE_READINESS_TIMEOUT,
        REMOTE_CONTEXT_REJECTED,
    }
)

# ---------------------------------------------------------------------------
# Frozen constants (design C8; Requirement 12.2, 12.7, 12.10, 12.12).
# ---------------------------------------------------------------------------

# The only host bind interface any published port may declare.
LOOPBACK_HOST = "127.0.0.1"

# Readiness budget: per service up to 120s, re-checked every 5s (12.1, 12.13).
READINESS_TIMEOUT_SECONDS = 120
READINESS_INTERVAL_SECONDS = 5

# Pinned image references (12.10). These mirror the compose overlays exactly and
# must never be `latest`, untagged, or a movable alias.
PINNED_IMAGES: dict[str, str] = {
    "otel-collector": "otel/opentelemetry-collector:0.120.0",
    "prometheus": "prom/prometheus:v3.2.1",
    "grafana": "grafana/grafana:11.5.2",
}

# The three core services readiness is individually checked for (12.1):
# collector, metrics store, dashboard.
CORE_SERVICES: tuple[str, ...] = ("otel-collector", "prometheus", "grafana")

# The dashboard service whose admin credential is env-only (12.7, 12.8).
DASHBOARD_SERVICE = "grafana"
DASHBOARD_CREDENTIAL_ENV = "GRAFANA_ADMIN_PASSWORD"

# Canonical loopback port publish declarations already present in the compose
# overlays, plus the Loki log sink added at `127.0.0.1:3100` (design C8).
# Format matches docker compose `ports:` short syntax: HOSTIP:HOSTPORT:CONTAINER.
CORE_PORT_DECLARATIONS: dict[str, str] = {
    "otel-collector": "127.0.0.1:4318:4318",
    "prometheus": "127.0.0.1:9090:9090",
    "grafana": "127.0.0.1:3001:3000",
    "loki": "127.0.0.1:3100:3100",
}
OPTIONAL_PORT_DECLARATIONS: dict[str, str] = {
    "kafka": "127.0.0.1:29092:29092",
    "kafka-ui": "127.0.0.1:8088:8080",
    "elasticsearch": "127.0.0.1:9200:9200",
}

# Operator-approved iframe embedding origins: loopback admin origins only
# (12.12). Mirrors the CSP `frame-ancestors http://127.0.0.1:3000` template.
APPROVED_IFRAME_ORIGINS: tuple[str, ...] = ("http://127.0.0.1:3000",)

# Movable alias tags that are never a pinned reference (12.10).
_FLOATING_TAGS = frozenset(
    {"latest", "stable", "edge", "nightly", "main", "master", "dev", "current"}
)

# Reason codes recorded (not returned) when an optional broker / log-search /
# log-sink component is not started; the core result stays successful (12.15).
OPTIONAL_COMPONENT_NOT_STARTED = "optional_component_not_started"


# ---------------------------------------------------------------------------
# Pure result helper (mirrors backend/pipeline_control convention).
# ---------------------------------------------------------------------------


def _result(ok: bool, error_code: Any, **extra: Any) -> dict:
    out: dict = {"ok": ok, "errorCode": error_code}
    out.update(extra)
    return out


# ---------------------------------------------------------------------------
# Image tag fixity (design Property 25; Requirement 12.10).
# ---------------------------------------------------------------------------


def is_pinned_image_reference(reference: Any) -> bool:
    """True iff ``reference`` pins an image to an exact tag or a digest.

    Accepts a name with a concrete tag (e.g. ``prom/prometheus:v3.2.1``) or a
    digest (e.g. ``name@sha256:<64 hex>``). Rejects untagged references,
    ``latest``, and movable alias tags. A registry ``host:port`` prefix is
    tolerated because the tag is taken from the final path segment only.
    """

    if not isinstance(reference, str) or not reference.strip():
        return False
    ref = reference.strip()

    # Digest pin: name@sha256:<hex>. Accept a well-formed sha256 digest.
    if "@" in ref:
        name, _, digest = ref.partition("@")
        if not name:
            return False
        algo, sep, hexpart = digest.partition(":")
        if algo != "sha256" or sep != ":":
            return False
        if len(hexpart) != 64 or any(c not in "0123456789abcdef" for c in hexpart):
            return False
        return True

    # Tag pin: take the segment after the last '/', then split its ':'.
    last_segment = ref.rsplit("/", 1)[-1]
    if ":" not in last_segment:
        return False  # untagged
    _, _, tag = last_segment.rpartition(":")
    if not tag:
        return False
    if tag.lower() in _FLOATING_TAGS:
        return False
    return True


def validate_image_references(images: Mapping[str, Any]) -> dict:
    """Validate that every declared image is pinned (12.10).

    Returns ``{"ok": bool, "errorCode": None, "notPinned": [...]}``. This is an
    internal configuration guard: the module's own :data:`PINNED_IMAGES` always
    pass, so a non-pinned entry indicates a defective injected declaration.
    ``errorCode`` stays ``None`` (Requirement 12 enumerates no tag-fixity code);
    ``ok=False`` with the offending service names lets the caller fail closed.
    """

    not_pinned = sorted(
        name for name, ref in images.items() if not is_pinned_image_reference(ref)
    )
    return _result(not not_pinned, None, notPinned=not_pinned)


# ---------------------------------------------------------------------------
# Loopback exposure boundary (design Property 26; Requirement 12.2, 12.3, 12.12).
# ---------------------------------------------------------------------------


def is_loopback_port_declaration(declaration: Any) -> bool:
    """True iff a docker compose port publish string binds ``127.0.0.1`` only.

    The short syntax is ``[HOSTIP:][HOSTPORT:]CONTAINERPORT[/proto]``. A missing
    host IP publishes on all interfaces and is rejected. Only the exact literal
    ``127.0.0.1`` host IP is accepted; ``0.0.0.0``, ``::``, ``[::1]``,
    ``localhost``, private, and public addresses are rejected.
    """

    if not isinstance(declaration, str) or not declaration.strip():
        return False
    spec = declaration.strip().split("/", 1)[0]  # drop optional /proto

    # Bracketed IPv6 host (e.g. [::1]:80:80 or [::]:80:80) is never loopback-v4.
    if spec.startswith("["):
        return False

    parts = spec.split(":")
    # Only the 3-part form declares an explicit host IP. 1- or 2-part forms
    # bind all interfaces and are rejected.
    if len(parts) != 3:
        return False
    host_ip = parts[0]
    return host_ip == LOOPBACK_HOST


def validate_port_declarations(declarations: Mapping[str, Any]) -> dict:
    """Validate every service port publish is loopback-only (12.2, 12.3).

    Returns ``{"ok", "errorCode", "nonLoopback": [...]}``. On any non-loopback
    declaration, ``errorCode`` is :data:`NON_LOOPBACK_BIND_REJECTED` so the
    caller starts no service at all.
    """

    non_loopback = sorted(
        name
        for name, decl in declarations.items()
        if not is_loopback_port_declaration(decl)
    )
    if non_loopback:
        return _result(False, NON_LOOPBACK_BIND_REJECTED, nonLoopback=non_loopback)
    return _result(True, None, nonLoopback=[])


def is_approved_iframe_origin(origin: Any, allowlist: Sequence[str]) -> bool:
    """True iff ``origin`` is a loopback admin origin present in ``allowlist``.

    Rejects wildcards, non-loopback hosts, and any origin absent from the
    operator-approved allowlist (12.12).
    """

    if not isinstance(origin, str) or not origin.strip():
        return False
    candidate = origin.strip()
    if "*" in candidate:
        return False
    if candidate not in set(allowlist):
        return False
    return _origin_is_loopback(candidate)


def _origin_is_loopback(origin: str) -> bool:
    """True iff ``origin`` is ``http(s)://127.0.0.1[:port]`` with no wildcard."""

    scheme, sep, rest = origin.partition("://")
    if not sep or scheme not in ("http", "https"):
        return False
    if not rest:
        return False
    # Strip any path; keep authority.
    authority = rest.split("/", 1)[0]
    if "*" in authority:
        return False
    host = authority.split(":", 1)[0]
    return host == LOOPBACK_HOST


def validate_iframe_origins(
    allowlist: Sequence[str],
    *,
    approved: Sequence[str] = APPROVED_IFRAME_ORIGINS,
) -> dict:
    """Validate the configured iframe embedding allowlist (12.12).

    Every configured origin must be a loopback admin origin present in the
    operator-approved set. A non-conforming origin is a loopback-boundary
    violation and returns :data:`NON_LOOPBACK_BIND_REJECTED` so the caller fails
    closed rather than exposing embedding to an unapproved origin.
    """

    if not isinstance(allowlist, (list, tuple)) or not allowlist:
        return _result(False, NON_LOOPBACK_BIND_REJECTED, rejectedOrigins=[])
    rejected = [
        origin
        for origin in allowlist
        if not is_approved_iframe_origin(origin, approved)
    ]
    if rejected:
        return _result(
            False, NON_LOOPBACK_BIND_REJECTED, rejectedOrigins=sorted(map(str, rejected))
        )
    return _result(True, None, rejectedOrigins=[])


# ---------------------------------------------------------------------------
# Dashboard credential (env-only; Requirement 12.7, 12.8).
# ---------------------------------------------------------------------------


def validate_dashboard_credential(env: Mapping[str, Any]) -> dict:
    """Validate the dashboard admin credential is present in the environment.

    Reads only :data:`DASHBOARD_CREDENTIAL_ENV`. If absent or empty, returns
    :data:`DASHBOARD_CREDENTIAL_MISSING`; never generates a default or temporary
    credential and never echoes the value (12.8).
    """

    value = env.get(DASHBOARD_CREDENTIAL_ENV)
    if not isinstance(value, str) or value == "":
        return _result(False, DASHBOARD_CREDENTIAL_MISSING)
    return _result(True, None)


# ---------------------------------------------------------------------------
# Remote docker context rejection (Requirement 12.11).
# ---------------------------------------------------------------------------


def is_local_docker_endpoint(endpoint: Any) -> bool:
    """True iff a docker context endpoint is a local socket, not remote.

    Accepts a local unix socket or Windows named pipe. Rejects ssh/tcp/http(s)
    remote endpoints. Matches the ``docker context inspect`` endpoint check in
    design C8.
    """

    if not isinstance(endpoint, str) or not endpoint.strip():
        return False
    value = endpoint.strip().lower()
    return value.startswith("unix://") or value.startswith("npipe://")


def validate_docker_context(context: Mapping[str, Any]) -> dict:
    """Validate the target docker context is local (12.11).

    ``context`` is expected to carry a ``"host"`` (docker endpoint) key, as
    produced by ``docker context inspect``. A non-local endpoint returns
    :data:`REMOTE_CONTEXT_REJECTED`.
    """

    endpoint = None
    if isinstance(context, Mapping):
        endpoint = context.get("host")
    if not is_local_docker_endpoint(endpoint):
        return _result(False, REMOTE_CONTEXT_REJECTED)
    return _result(True, None)


# ---------------------------------------------------------------------------
# Per-service readiness (Requirement 12.1, 12.13).
# ---------------------------------------------------------------------------


def check_service_readiness(
    services: Sequence[str],
    *,
    probe: Callable[[str], bool],
    now: Callable[[], float],
    sleep: Callable[[float], None],
    timeout_seconds: float = READINESS_TIMEOUT_SECONDS,
    interval_seconds: float = READINESS_INTERVAL_SECONDS,
) -> dict:
    """Individually re-check each service for readiness (12.1).

    Each service is probed up to ``timeout_seconds`` at ``interval_seconds``
    cadence. Returns ``{"ok", "errorCode", "readiness": {service: {...}},
    "notReady": [...]}``. If any service fails to become ready within its
    budget, ``errorCode`` is :data:`SERVICE_READINESS_TIMEOUT` and ``notReady``
    lists the un-ready service names (12.13). Elapsed seconds per service are
    recorded for the startup artifact (12.9).
    """

    readiness: dict[str, dict] = {}
    not_ready: list[str] = []

    for service in services:
        start = now()
        ready = False
        while True:
            if probe(service):
                ready = True
                break
            elapsed = now() - start
            if elapsed >= timeout_seconds:
                break
            # Do not overshoot the budget on the final wait.
            remaining = timeout_seconds - elapsed
            sleep(min(interval_seconds, remaining))
        elapsed = round(now() - start, 3)
        readiness[service] = {
            "readyState": "ready" if ready else "not_ready",
            "elapsedSeconds": elapsed,
        }
        if not ready:
            not_ready.append(service)

    if not_ready:
        return _result(
            False,
            SERVICE_READINESS_TIMEOUT,
            readiness=readiness,
            notReady=sorted(not_ready),
        )
    return _result(True, None, readiness=readiness, notReady=[])


# ---------------------------------------------------------------------------
# Orchestration (design C8).
# ---------------------------------------------------------------------------

# Repo layout: backend/bin/observability_up.py -> bin -> backend -> <root>.
_ROOT = Path(__file__).resolve().parents[2]
_COMPOSE_DIR = _ROOT / "backend" / "deploy" / "pipeline-control"

# Compose overlays, in start order (kafka before observability per its header).
COMPOSE_FILES: dict[str, str] = {
    "kafka": "docker-compose.kafka.yml",
    "elasticsearch": "docker-compose.elasticsearch.yml",
    "observability": "docker-compose.observability.yml",
}


def _default_command_runner(cwd: str, argv: Sequence[str]) -> dict:
    """Run a compose command, returning ``{"exitCode": int}`` only.

    Provider stdout/stderr is intentionally not surfaced so no provider
    diagnostic ever reaches the startup artifact (12.9). Overridden in tests.
    """

    import subprocess  # local import: keep module import side-effect free

    completed = subprocess.run(  # noqa: S603 - fixed argv, no shell
        list(argv),
        cwd=cwd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return {"exitCode": completed.returncode}


def start_observability_stack(
    *,
    env: Mapping[str, Any],
    docker_context: Mapping[str, Any],
    probe: Callable[[str], bool],
    now: Callable[[], float] | None = None,
    sleep: Callable[[float], None] | None = None,
    command_runner: Callable[[str, Sequence[str]], dict] | None = None,
    enable_kafka: bool = False,
    enable_elasticsearch: bool = False,
    enable_loki: bool = True,
    images: Mapping[str, str] | None = None,
    iframe_allowlist: Sequence[str] = APPROVED_IFRAME_ORIGINS,
    timeout_seconds: float = READINESS_TIMEOUT_SECONDS,
    interval_seconds: float = READINESS_INTERVAL_SECONDS,
) -> dict:
    """Start the Observability_Stack in one run and return a startup artifact.

    Fail-closed precedence (first failure wins), then compose up + readiness:

      1. remote docker context   -> ``remote_context_rejected`` (12.11)
      2. non-loopback port bind   -> ``non_loopback_bind_rejected`` (12.2, 12.3)
      3. non-loopback iframe origin -> ``non_loopback_bind_rejected`` (12.12)
      4. missing dashboard secret -> ``dashboard_credential_missing`` (12.7, 12.8)
      5. compose up (injected runner)
      6. per-service readiness    -> ``service_readiness_timeout`` (12.1, 12.13)

    The returned artifact records, per service, name / referenced image tag /
    readiness state (``ready``|``not_ready``) / elapsed seconds, plus reason
    codes for any optional component not started (12.15). It excludes every
    Forbidden_Log_Field: only bounded status fields are recorded (12.9).
    """

    now = now or time.monotonic
    sleep = sleep or time.sleep
    command_runner = command_runner or _default_command_runner
    images = dict(images or PINNED_IMAGES)

    artifact: dict[str, Any] = {
        "ok": False,
        "errorCode": None,
        "services": [],
        "notStartedComponents": [],
    }

    # 1. Remote context is rejected before anything is started.
    ctx = validate_docker_context(docker_context)
    if not ctx["ok"]:
        artifact["errorCode"] = ctx["errorCode"]
        return artifact

    # Internal guard: images this run will reference must be pinned (12.10).
    # The module constants always pass; a defective injected map fails closed.
    pinned = validate_image_references(images)
    if not pinned["ok"]:
        # No enumerated fixed code for tag fixity; refuse to start and surface
        # the offending service names without a provider diagnostic.
        artifact["errorCode"] = None
        artifact["notPinnedImages"] = pinned["notPinned"]
        return artifact

    # Assemble the loopback port declarations for the components in scope.
    declarations: dict[str, str] = {}
    for name, decl in CORE_PORT_DECLARATIONS.items():
        if name == "loki" and not enable_loki:
            continue
        declarations[name] = decl
    if enable_kafka:
        declarations["kafka"] = OPTIONAL_PORT_DECLARATIONS["kafka"]
        declarations["kafka-ui"] = OPTIONAL_PORT_DECLARATIONS["kafka-ui"]
    if enable_elasticsearch:
        declarations["elasticsearch"] = OPTIONAL_PORT_DECLARATIONS["elasticsearch"]

    # 2. Every published port must bind 127.0.0.1 only; else start nothing.
    ports = validate_port_declarations(declarations)
    if not ports["ok"]:
        artifact["errorCode"] = ports["errorCode"]
        artifact["nonLoopback"] = ports["nonLoopback"]
        return artifact

    # 3. iframe embedding allowlist must be loopback admin origins only.
    origins = validate_iframe_origins(iframe_allowlist)
    if not origins["ok"]:
        artifact["errorCode"] = origins["errorCode"]
        artifact["rejectedOrigins"] = origins["rejectedOrigins"]
        return artifact

    # 4. Dashboard admin credential is env-only; missing => no dashboard start.
    cred = validate_dashboard_credential(env)
    if not cred["ok"]:
        artifact["errorCode"] = cred["errorCode"]
        return artifact

    # Record optional components that are not started (12.15).
    if not enable_kafka:
        artifact["notStartedComponents"].append(
            {"component": "kafka", "reasonCode": OPTIONAL_COMPONENT_NOT_STARTED}
        )
    if not enable_elasticsearch:
        artifact["notStartedComponents"].append(
            {"component": "elasticsearch", "reasonCode": OPTIONAL_COMPONENT_NOT_STARTED}
        )

    # 5. Bring up the compose overlays in one run (injected runner).
    cwd = str(_COMPOSE_DIR)
    overlays = ["observability"]
    if enable_kafka:
        overlays.insert(0, "kafka")
    if enable_elasticsearch:
        overlays.insert(0, "elasticsearch")
    for overlay in overlays:
        compose_file = COMPOSE_FILES[overlay]
        argv = ("docker", "compose", "-f", compose_file, "up", "-d")
        run = command_runner(cwd, argv)
        if not isinstance(run, Mapping) or run.get("exitCode") != 0:
            # Compose could not bring an overlay up. Surface no provider output.
            artifact["errorCode"] = SERVICE_READINESS_TIMEOUT
            artifact["notReady"] = sorted(CORE_SERVICES)
            artifact["services"] = _service_rows(
                {s: {"readyState": "not_ready", "elapsedSeconds": 0.0} for s in CORE_SERVICES},
                images,
            )
            return artifact

    # 6. Individually re-check readiness for the three core services (12.1).
    readiness = check_service_readiness(
        CORE_SERVICES,
        probe=probe,
        now=now,
        sleep=sleep,
        timeout_seconds=timeout_seconds,
        interval_seconds=interval_seconds,
    )
    artifact["services"] = _service_rows(readiness["readiness"], images)

    if not readiness["ok"]:
        artifact["errorCode"] = readiness["errorCode"]
        artifact["notReady"] = readiness["notReady"]
        return artifact

    artifact["ok"] = True
    return artifact


def _service_rows(
    readiness: Mapping[str, Mapping[str, Any]],
    images: Mapping[str, str],
) -> list[dict]:
    """Build the per-service artifact rows (12.9): name, tag, state, elapsed."""

    rows: list[dict] = []
    for service in CORE_SERVICES:
        state = readiness.get(service, {})
        rows.append(
            {
                "name": service,
                "imageTag": images.get(service),
                "readyState": state.get("readyState", "not_ready"),
                "elapsedSeconds": state.get("elapsedSeconds", 0.0),
            }
        )
    return rows


# ---------------------------------------------------------------------------
# CLI entry point.
# ---------------------------------------------------------------------------


def _inspect_local_docker_context() -> dict:
    """Return ``{"host": <endpoint>}`` for the active docker context.

    Isolated so the CLI path stays thin and the orchestrator stays testable.
    """

    import subprocess  # local import: keep module import side-effect free

    try:
        completed = subprocess.run(  # noqa: S603 - fixed argv, no shell
            ["docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            check=False,
            text=True,
        )
    except OSError:
        return {"host": None}
    if completed.returncode != 0:
        return {"host": None}
    return {"host": (completed.stdout or "").strip()}


def _http_readiness_probe(service: str) -> bool:
    """Best-effort loopback HTTP readiness probe for the core services."""

    import urllib.request  # local import: keep module import side-effect free

    endpoints = {
        "otel-collector": "http://127.0.0.1:4318/",
        "prometheus": "http://127.0.0.1:9090/-/ready",
        "grafana": "http://127.0.0.1:3001/api/health",
    }
    url = endpoints.get(service)
    if url is None:
        return False
    try:
        with urllib.request.urlopen(url, timeout=2) as resp:  # noqa: S310 - loopback
            return 200 <= resp.status < 500
    except Exception:  # noqa: BLE001 - readiness is a boolean, never raise
        return False


def main(argv: Sequence[str] | None = None) -> int:
    import argparse
    import os

    parser = argparse.ArgumentParser(
        description="Start the local Observability_Stack (Requirement 12).",
    )
    parser.add_argument("--enable-kafka", action="store_true")
    parser.add_argument("--enable-elasticsearch", action="store_true")
    parser.add_argument("--no-loki", dest="enable_loki", action="store_false")
    parser.add_argument(
        "--artifact",
        default=str(_ROOT / "backend" / "log" / "observability" / "observability_up-report.json"),
        help="Path to write the startup artifact JSON.",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    artifact = start_observability_stack(
        env=os.environ,
        docker_context=_inspect_local_docker_context(),
        probe=_http_readiness_probe,
        enable_kafka=args.enable_kafka,
        enable_elasticsearch=args.enable_elasticsearch,
        enable_loki=args.enable_loki,
    )

    out_path = Path(args.artifact)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(artifact, indent=2, sort_keys=True), encoding="utf-8")

    return 0 if artifact.get("ok") else 1


if __name__ == "__main__":  # pragma: no cover - thin CLI shim
    raise SystemExit(main())
