"""Elasticsearch sink. Default no-op; indexer is opt-in via TZUDONG_PIPELINE_ES=es."""

from __future__ import annotations

import signal
import threading

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

CONSUMER_GROUP = "pipeline-indexer"
BULK_LIMIT = 50

ALLOWED_MODES = frozenset({"noop", "es"})
# Loki is the default local Log_Sink. Its admission deliberately reuses this
# local-only guard, so the Docker-network service name belongs to the same
# closed host set as the optional Elasticsearch sink.
ALLOWED_ES_HOSTS = frozenset(
    {"127.0.0.1", "localhost", "::1", "elasticsearch", "loki"}
)
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


def document_id(document: dict[str, Any]) -> str:
    from backend.pipeline_control.outbox import document_id as outbox_document_id

    return outbox_document_id(document)


class _StdlibEsClient:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")

    def _opener(self) -> Any:
        import urllib.request

        class _RefuseRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *_args: object, **_kwargs: object) -> None:
                raise EsIndexError("es_index_failed")

        return urllib.request.build_opener(_RefuseRedirect)

    def index(self, index: str, document: dict[str, Any]) -> None:
        import urllib.error
        import urllib.request

        opener = self._opener()
        doc_id = document_id(document)
        payload = json.dumps(document, sort_keys=True, separators=(",", ":")).encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}/{index}/_doc/{doc_id}",
            data=payload,
            method="PUT",
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


    def bulk(self, documents: list[dict[str, Any]]) -> None:
        import urllib.error
        import urllib.request

        if not documents:
            return
        lines: list[str] = []
        for document in documents:
            index = resolve_index(document)
            body = allowlisted_document(document)
            action = {"index": {"_index": index, "_id": document_id(document)}}
            lines.append(json.dumps(action, sort_keys=True, separators=(",", ":")))
            lines.append(json.dumps(body, sort_keys=True, separators=(",", ":")))
        payload = ("\n".join(lines) + "\n").encode("utf-8")
        request = urllib.request.Request(
            f"{self.base_url}/_bulk",
            data=payload,
            method="POST",
            headers={"Content-Type": "application/x-ndjson"},
        )
        try:
            with self._opener().open(request, timeout=5) as response:
                code = int(getattr(response, "status", None) or response.getcode())
                if 300 <= code < 400:
                    raise EsIndexError("es_index_failed")
        except EsIndexError:
            raise
        except urllib.error.HTTPError as exc:
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


def index_bulk(documents: list[dict[str, Any]]) -> str:
    if not documents:
        return "noop:empty"
    mode = classify_es_mode(os.environ.get("TZUDONG_PIPELINE_ES"))
    if mode != "es":
        return f"noop:{len(documents)}"
    base_url = admit_es_url(
        data_env=os.environ.get("TZUDONG_DATA_ENV", "local_db"),
        url=os.environ.get("TZUDONG_ES_URL"),
    )
    try:
        client_cls = _load_es_client()
    except ImportError as exc:
        raise EsIndexError("es_client_missing") from exc
    client = client_cls(base_url)
    try:
        bulk = getattr(client, "bulk", None)
        if bulk is None:
            for document in documents:
                index_document(document)
        else:
            bulk(documents)
    except EsIndexError:
        raise
    except Exception as exc:
        raise EsIndexError("es_index_failed") from RuntimeError(safe_error_name(exc))
    from backend.pipeline_control.metrics import observe

    observe("tzudong_pipeline_es_rows_per_sec", len(documents))
    return f"es:bulk:{len(documents)}"


def _load_kafka_consumer() -> Any:
    from kafka import KafkaConsumer

    return KafkaConsumer


def consume_once(consumer: Any | None = None, limit: int = BULK_LIMIT) -> int:
    from backend.pipeline_control.events import TOPICS, admit_bootstrap
    from backend.pipeline_control.metrics import observe

    mode = classify_es_mode(os.environ.get("TZUDONG_PIPELINE_ES"))
    if mode != "es":
        return 0
    handle = consumer
    if handle is None:
        bootstrap = os.environ.get("TZUDONG_KAFKA_BOOTSTRAP")
        admit_bootstrap(
            data_env=os.environ.get("TZUDONG_DATA_ENV", "local_db"),
            bootstrap=bootstrap,
        )
        try:
            consumer_cls = _load_kafka_consumer()
        except ImportError as exc:
            raise EsIndexError("es_client_missing") from exc
        handle = consumer_cls(
            *TOPICS.values(),
            bootstrap_servers=str(bootstrap).strip(),
            group_id=CONSUMER_GROUP,
            enable_auto_commit=False,
            consumer_timeout_ms=1000,
        )
    documents: list[dict[str, Any]] = []
    lag = 0
    for message in handle:
        value = message.value
        if isinstance(value, (bytes, bytearray)):
            value = json.loads(value.decode("utf-8"))
        elif isinstance(value, str):
            value = json.loads(value)
        if isinstance(value, dict):
            documents.append(value)
        high = getattr(message, "highwater", None) or getattr(message, "offset", 0)
        offset = getattr(message, "offset", 0)
        try:
            lag = max(lag, int(high) - int(offset))
        except (TypeError, ValueError):
            lag = max(lag, 0)
        if len(documents) >= limit:
            break
    observe("tzudong_pipeline_kafka_lag", lag)
    if documents:
        index_bulk(documents)
        commit = getattr(handle, "commit", None)
        if commit is not None:
            commit()
    return len(documents)


def main() -> int:
    stop = threading.Event()

    def _stop(_signum: int, _frame: object) -> None:
        stop.set()

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    from backend.pipeline_control.metrics import observe_process

    while not stop.is_set():
        observe_process()
        if classify_es_mode(os.environ.get("TZUDONG_PIPELINE_ES")) == "es":
            try:
                consume_once()
            except EsIndexError:
                pass
        if stop.wait(1.0):
            break
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
