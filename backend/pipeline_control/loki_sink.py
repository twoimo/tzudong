"""Loki push-sink. Loki is the default Log_Sink for the Log_Pipeline.

The primary log path is filelog -> OTel Collector -> Loki (see
``backend/pipeline-control/otel-collector.yaml``). This module is the
Python-side representation of that default sink: it admits the target Loki URL
and can push records directly over Loki's HTTP push API for the pending-queue
retry path.

Fail-closed design (requirement 13.10):

- URL admission reuses :func:`backend.pipeline_control.es_index.admit_es_url`.
  ``loki`` is part of the approved local host set, so only the ``local_db`` data
  environment, an ``http``/``https`` scheme, and an approved local host
  (``127.0.0.1``, ``localhost``, ``::1``, ``elasticsearch``, ``loki``) are
  admitted; every other input yields the fixed code ``es_url_host_rejected``.
- Every record passes through the ``privacy_log`` redaction boundary
  (``sanitize_log_value``) before it can reach the sink, so Forbidden_Log_Field
  values never leave the process.
- Only bounded fixed codes are surfaced; provider and transport diagnostics are
  reduced to a bounded exception type name via ``safe_error_name``.
"""

from __future__ import annotations

import json
import os
from typing import Any

from backend.pipeline_control.es_index import EsIndexError, admit_es_url
from backend.utils.privacy_log import safe_error_name, sanitize_log_value

# Loki's HTTP push endpoint. Combined with the admitted base URL.
LOKI_PUSH_PATH = "/loki/api/v1/push"

# Loki is the default Log_Sink. Operators opt out to a no-op sink with
# ``TZUDONG_LOG_SINK=noop`` (used by CI and unit tests that must not emit).
ALLOWED_MODES = frozenset({"noop", "loki"})
DEFAULT_MODE = "loki"

# Deterministic label keys that become Loki stream labels. Kept tiny and
# low-cardinality; values are still routed through the redaction boundary.
STREAM_LABEL_KEYS = ("component", "severity")


class LokiSinkError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def classify_loki_mode(raw: str | None) -> str:
    """Resolve the sink mode. Absent/empty means the default Loki sink."""
    if raw is None:
        return DEFAULT_MODE
    value = str(raw).strip()
    if value == "":
        return DEFAULT_MODE
    if value not in ALLOWED_MODES:
        raise LokiSinkError("loki_mode_invalid")
    return value


def admit_loki_url(*, data_env: str | None, url: str | None) -> str:
    """Admit a Loki base URL through the shared es_index admission rules.

    Reuses ``admit_es_url`` (``loki`` is in the approved host set) and re-raises
    its fixed codes under :class:`LokiSinkError` so callers of this sink deal
    with a single exception type. The fixed codes are unchanged
    (``es_url_host_rejected``, ``es_url_required``, ``es_url_invalid``).
    """
    try:
        return admit_es_url(data_env=data_env, url=url)
    except EsIndexError as exc:
        raise LokiSinkError(exc.code) from None


def redacted_document(document: dict[str, Any]) -> dict[str, Any]:
    """Route every value through the redaction boundary before it can be sent."""
    sanitized = sanitize_log_value(document)
    if not isinstance(sanitized, dict):
        raise LokiSinkError("loki_record_invalid")
    return sanitized


def _stream_labels(document: dict[str, Any]) -> dict[str, str]:
    labels: dict[str, str] = {}
    for key in STREAM_LABEL_KEYS:
        value = document.get(key)
        if isinstance(value, str) and value:
            labels[key] = value
    labels.setdefault("component", "backend_runtime")
    return labels


def _log_line(document: dict[str, Any]) -> str:
    return json.dumps(document, sort_keys=True, separators=(",", ":"))


def build_push_body(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Build a Loki push body, grouping redacted records by stream labels.

    A monotonic per-body nanosecond timestamp keeps line ordering stable without
    leaking wall-clock precision from the record. Records themselves already
    passed the redaction boundary.
    """
    streams: dict[str, dict[str, Any]] = {}
    counter = 0
    for record in records:
        document = redacted_document(record)
        labels = _stream_labels(document)
        key = json.dumps(labels, sort_keys=True, separators=(",", ":"))
        entry = streams.get(key)
        if entry is None:
            entry = {"stream": labels, "values": []}
            streams[key] = entry
        entry["values"].append([str(counter), _log_line(document)])
        counter += 1
    return {"streams": [streams[key] for key in sorted(streams)]}


class _StdlibLokiClient:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")

    def _opener(self) -> Any:
        import urllib.request

        class _RefuseRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *_args: object, **_kwargs: object) -> None:
                raise LokiSinkError("loki_push_failed")

        return urllib.request.build_opener(_RefuseRedirect)

    def push(self, body: dict[str, Any]) -> None:
        import urllib.error
        import urllib.request

        payload = json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}{LOKI_PUSH_PATH}",
            data=payload,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with self._opener().open(request, timeout=5) as response:
                code = int(getattr(response, "status", None) or response.getcode())
                if 300 <= code < 400:
                    raise LokiSinkError("loki_push_failed")
        except LokiSinkError:
            raise
        except urllib.error.HTTPError as exc:
            raise LokiSinkError("loki_push_failed") from RuntimeError(safe_error_name(exc))
        except Exception as exc:
            raise LokiSinkError("loki_push_failed") from RuntimeError(safe_error_name(exc))


def _load_loki_client() -> Any:
    return _StdlibLokiClient


def push_records(records: list[dict[str, Any]]) -> str:
    """Push redacted records to the default Loki sink.

    Returns a bounded status string. In the no-op mode (opt-out) no client is
    loaded and no network call is attempted.
    """
    if not records:
        return "noop:empty"
    mode = classify_loki_mode(os.environ.get("TZUDONG_LOG_SINK"))
    if mode != "loki":
        return f"noop:{len(records)}"
    base_url = admit_loki_url(
        data_env=os.environ.get("TZUDONG_DATA_ENV", "local_db"),
        url=os.environ.get("TZUDONG_LOKI_URL"),
    )
    body = build_push_body(records)
    try:
        client_cls = _load_loki_client()
    except ImportError as exc:
        raise LokiSinkError("loki_client_missing") from exc
    try:
        client = client_cls(base_url)
        client.push(body)
    except LokiSinkError:
        raise
    except Exception as exc:
        raise LokiSinkError("loki_push_failed") from RuntimeError(safe_error_name(exc))
    return f"loki:{len(records)}"
