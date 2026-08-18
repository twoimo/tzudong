"""Elasticsearch sink. Default no-op; indexer is opt-in via TZUDONG_PIPELINE_ES=es."""

from __future__ import annotations

import json
import os
from typing import Any
from urllib.parse import urlparse

from backend.utils.privacy_log import safe_error_name, sanitize_log_value

INDICES = {
    "run.lifecycle": "pipeline-logs-v1",
    "step.progress": "pipeline-logs-v1",
    "record.upserted": "pipeline-logs-v1",
    "adapter.raw": "pipeline-raw-v1",
}

ALLOWED_MODES = frozenset({"noop", "es"})
ALLOWED_ES_HOSTS = frozenset({"127.0.0.1", "localhost", "::1", "elasticsearch"})
LOG_ALLOWLIST = frozenset(
    {
        "type",
        "job_id",
        "status",
        "step",
        "index",
        "skipped",
        "target",
        "profile",
        "request_id",
        "ts",
        "timestamp",
    }
)
RAW_ALLOWLIST = frozenset(
    {
        "type",
        "job_id",
        "step",
        "status",
        "skipped",
        "request_id",
        "ts",
        "payload_hash",
    }
)


class EsIndexError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def resolve_index(document: dict[str, Any]) -> str:
    doc_type = document.get("type")
    if not isinstance(doc_type, str) or doc_type not in INDICES:
        raise EsIndexError("es_document_class_unknown")
    return INDICES[doc_type]


def classify_es_mode(raw: str | None) -> str:
    if raw is None:
        return "noop"
    value = str(raw).strip()
    if value == "":
        return "noop"
    if value not in ALLOWED_MODES:
        raise EsIndexError("es_mode_invalid")
    return value


def admit_es_url(*, data_env: str | None, url: str | None) -> str:
    env = (data_env or "local_db").strip() or "local_db"
    if env != "local_db":
        raise EsIndexError("es_url_host_rejected")
    if not url or not str(url).strip():
        raise EsIndexError("es_url_required")
    parsed = urlparse(str(url).strip())
    scheme = (parsed.scheme or "").lower()
    if scheme not in {"http", "https"}:
        raise EsIndexError("es_url_invalid")
    host = (parsed.hostname or "").lower().strip().strip("[]")
    if not host or host not in ALLOWED_ES_HOSTS:
        raise EsIndexError("es_url_host_rejected")
    return str(url).strip().rstrip("/")


def allowlisted_log_doc(document: dict[str, Any]) -> dict[str, Any]:
    return {
        key: sanitize_log_value(value)
        for key, value in document.items()
        if key in LOG_ALLOWLIST
    }


def allowlisted_raw_doc(document: dict[str, Any]) -> dict[str, Any]:
    return {
        key: sanitize_log_value(value)
        for key, value in document.items()
        if key in RAW_ALLOWLIST
    }


def allowlisted_document(document: dict[str, Any]) -> dict[str, Any]:
    index = resolve_index(document)
    if index.startswith("pipeline-raw-"):
        return allowlisted_raw_doc(document)
    return allowlisted_log_doc(document)


class _StdlibEsClient:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")

    def index(self, index: str, document: dict[str, Any]) -> None:
        import urllib.error
        import urllib.request

        class _RefuseRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *_args: object, **_kwargs: object) -> None:
                raise EsIndexError("es_index_failed")

        opener = urllib.request.build_opener(_RefuseRedirect)
        payload = json.dumps(document, sort_keys=True, separators=(",", ":")).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}/{index}/_doc",
            data=payload,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        try:
            with opener.open(request, timeout=5) as response:
                code = int(getattr(response, "status", None) or response.getcode())
                if 300 <= code < 400:
                    raise EsIndexError("es_index_failed")
        except EsIndexError:
            raise
        except urllib.error.HTTPError as exc:
            if 300 <= int(exc.code) < 400:
                raise EsIndexError("es_index_failed") from RuntimeError(safe_error_name(exc))
            raise EsIndexError("es_index_failed") from RuntimeError(safe_error_name(exc))
        except Exception as exc:
            raise EsIndexError("es_index_failed") from RuntimeError(safe_error_name(exc))


def _load_es_client() -> Any:
    return _StdlibEsClient


def index_document(document: dict[str, Any]) -> str:
    index = resolve_index(document)
    mode = classify_es_mode(os.environ.get("TZUDONG_PIPELINE_ES"))
    if mode != "es":
        return f"noop:{index}"
    base_url = admit_es_url(
        data_env=os.environ.get("TZUDONG_DATA_ENV", "local_db"),
        url=os.environ.get("TZUDONG_ES_URL"),
    )
    try:
        client_cls = _load_es_client()
    except ImportError as exc:
        raise EsIndexError("es_client_missing") from exc
    body = allowlisted_document(document)
    try:
        client = client_cls(base_url)
        result = client.index(index, body)
    except EsIndexError:
        raise
    except Exception as exc:
        raise EsIndexError("es_index_failed") from RuntimeError(safe_error_name(exc))
    if isinstance(result, int) and 300 <= result < 400:
        raise EsIndexError("es_index_failed")
    return f"es:{index}"
