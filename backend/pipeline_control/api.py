"""stdlib HTTP control-plane. Returns 202 immediately; workers claim jobs."""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import re
import signal
import threading
import uuid
from typing import Any
from urllib.parse import urlparse

from backend.pipeline_control.dsn_guard import DsnGuardError, admit_dsn
from backend.pipeline_control.persist import PersistError
from backend.pipeline_control.state_machine import ControlPlaneError
from backend.pipeline_control.file_store import FileStore
from backend.pipeline_control.targets import assert_admitted, load_targets
from backend.utils.privacy_log import safe_error_name, sanitize_log_value
from backend.pipeline_control.queue import enqueue

STORE = FileStore()
_REQUEST_ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")


def build_store():
    mode = os.environ.get("TZUDONG_PIPELINE_STORE", "file").strip() or "file"
    if mode == "postgres":
        from backend.pipeline_control.pg_store import PostgresStore

        return PostgresStore()
    if mode not in {"file", "memory"}:
        raise ControlPlaneError("store_mode_invalid", 400)
    if mode == "memory":
        from backend.pipeline_control.store import MemoryStore

        return MemoryStore()
    return FileStore()


def current_store():
    return STORE


def _bounded_request_id(value: object) -> str:
    """Return an echo-safe request ID or a server-generated replacement.

    ``BaseHTTPRequestHandler.send_header`` does not reject CR/LF itself.  Keep
    the explicit replacements here so response-header safety does not depend on
    caller behavior, then apply a narrow ASCII allowlist and length bound.
    """

    if not isinstance(value, str):
        return str(uuid.uuid4())
    sanitized = value.replace("\n", "").replace("\r", "")
    if sanitized != value or _REQUEST_ID_RE.fullmatch(sanitized) is None:
        return str(uuid.uuid4())
    return sanitized


def _json(handler: BaseHTTPRequestHandler, status: int, body: dict[str, Any]) -> None:
    payload = json.dumps(sanitize_log_value(body), ensure_ascii=True).encode("utf-8")
    request_id = _bounded_request_id(handler.headers.get("X-Request-Id"))
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("X-Request-Id", request_id)
    handler.send_header("Content-Length", str(len(payload)))
    handler.end_headers()
    handler.wfile.write(payload)


def _read_json(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("Content-Length") or "0")
    if length <= 0 or length > 16_384:
        return {}
    raw = handler.rfile.read(length)
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise ControlPlaneError("invalid_json", 400) from exc
    if not isinstance(parsed, dict):
        raise ControlPlaneError("invalid_json", 400)
    return parsed


class PipelineApiHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def do_GET(self) -> None:  # noqa: N802
        try:
            path = urlparse(self.path).path
            if path == "/healthz":
                return _json(self, 200, {"ok": True})
            if path == "/readyz":
                admit_dsn(
                    data_env=os.environ.get("TZUDONG_DATA_ENV", "local_db"),
                    dsn=os.environ.get("PIPELINE_CONTROL_DSN", "postgresql://tzudong@127.0.0.1:5432/postgres"),
                )
                return _json(self, 200, {"ready": True})
            if path == "/v1/targets":
                return _json(self, 200, current_store().operator_snapshot(load_targets()))
            if path == "/v1/runs":
                snap = current_store().operator_snapshot(load_targets())
                return _json(
                    self,
                    200,
                    {"jobs": snap["jobs"], "failures": snap["failures"]},
                )
            if path.startswith("/v1/runs/"):
                run_id = path.rsplit("/", 1)[-1]
                store = current_store()
                run = store.get(run_id)
                return _json(self, 200, store.public_run(run))
            return _json(self, 404, {"error": "not_found"})
        except (ControlPlaneError, DsnGuardError, PersistError, ValueError) as exc:
            return self._error(exc)

    def do_POST(self) -> None:  # noqa: N802
        try:
            path = urlparse(self.path).path
            request_id = _bounded_request_id(self.headers.get("X-Request-Id"))
            actor = self.headers.get("X-Actor") or "anonymous"
            if path == "/v1/runs":
                body = _read_json(self)
                admit_dsn(
                    data_env=os.environ.get("TZUDONG_DATA_ENV", "local_db"),
                    dsn=os.environ.get(
                        "PIPELINE_CONTROL_DSN",
                        "postgresql://tzudong@127.0.0.1:5432/postgres",
                    ),
                )
                target = assert_admitted(str(body.get("target") or ""))
                profile = str(body.get("profile") or "heavy_local")
                if profile not in {"heavy_local", "lite_gha"}:
                    raise ControlPlaneError("profile_invalid", 400)
                key = self.headers.get("Idempotency-Key") or body.get("idempotencyKey")
                if not key or not (8 <= len(str(key)) <= 128):
                    raise ControlPlaneError("idempotency_key_invalid", 400)
                store = current_store()
                run, created = store.create_run(
                    target=target,
                    profile=profile,  # type: ignore[arg-type]
                    idempotency_key=str(key),
                    payload=body,
                    actor=actor,
                    request_id=request_id,
                    dry_run=bool(body.get("dryRun", True)),
                )
                if created:
                    enqueue(
                        {
                            "id": run.id,
                            "target": run.target,
                            "profile": run.profile,
                            "idempotency_key": run.idempotency_key,
                            "dry_run": run.dry_run,
                            "actor": run.actor,
                            "request_id": run.request_id,
                        }
                    )
                return _json(self, 202 if created else 202, store.public_run(run))
            if path.endswith("/pause") or path.endswith("/resume") or path.endswith("/cancel"):
                action = path.rsplit("/", 1)[-1]
                run_id = path.split("/")[3]
                store = current_store()
                run = store.control(run_id, action, actor=actor, request_id=request_id)
                return _json(self, 200, store.public_run(run))
            return _json(self, 404, {"error": "not_found"})
        except (ControlPlaneError, DsnGuardError, PersistError, ValueError) as exc:
            return self._error(exc)

    def _error(self, exc: Exception) -> None:
        if isinstance(exc, ControlPlaneError):
            return _json(self, exc.http_status, {"error": exc.code})
        if isinstance(exc, DsnGuardError):
            return _json(self, 403, {"error": exc.code})
        if isinstance(exc, PersistError):
            return _json(self, 503, {"error": exc.code})
        if isinstance(exc, ValueError):
            return _json(self, 400, {"error": str(exc)})
        return _json(self, 500, {"error": safe_error_name(exc)})


ALLOWED_API_BIND_HOSTS = frozenset({"127.0.0.1", "localhost", "::1", "0.0.0.0"})


def api_bind_host(raw: str | None = None) -> str:
    value = (raw if raw is not None else os.environ.get("PIPELINE_API_HOST", "127.0.0.1")).strip() or "127.0.0.1"
    if value not in ALLOWED_API_BIND_HOSTS:
        raise ValueError("pipeline_api_host_rejected")
    return value


def serve(host: str = "127.0.0.1", port: int = 8091) -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, port), PipelineApiHandler)


def main() -> None:
    server = serve(host=api_bind_host())
    def _stop(_signum: int, _frame: object) -> None:
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    server.serve_forever()


if __name__ == "__main__":
    globals()["STORE"] = build_store()
    main()
