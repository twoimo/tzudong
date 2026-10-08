"""Gemini-only FastAPI RAG worker; routes retain their existing URL and ownership.

Official REST implements embedding, cosine ranking and frame captioning. No local
models or alternate provider execution. Warmup checks configuration only, never
spends credits. Existing queue/timeouts remain; lost responses require explicit retry.
"""

from __future__ import annotations

import asyncio
import json
import math
import base64
import mimetypes
import sqlite3
from contextlib import contextmanager
import os
import sys
import urllib.error
import urllib.request
import platform
import time
from collections import Counter
from threading import Lock, local
from pathlib import Path
from typing import Any, Literal
CANONICAL_BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(CANONICAL_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(CANONICAL_BACKEND_ROOT))

from utils.privacy_log import safe_error_name
from utils.provider_budget import ProjectBudget, budget_path, positive_int
from utils.request_budget import retry_after_seconds


from fastapi import FastAPI, HTTPException, Query
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

# Stable text retrieval model, official embedContent contract. No local model downloads.
EMBED_MODEL_ID = "gemini-embedding-001"
EMBED_FINGERPRINT = "gemini-embedding-001:1024:retrieval:l2:v1"
CAPTION_MODEL_ID = "gemini-3.8-flash"
_OPERATION_DEADLINE = local()
_GEMINI_CALL_LOCK = Lock()  # One paid call per worker process, matching project concurrency=1.
DEFAULT_TIMEOUT_SECONDS = float(os.environ.get("STORYBOARD_RAG_WORKER_TIMEOUT_SECONDS", "120"))
DEFAULT_BATCH_SIZE = int(os.environ.get("STORYBOARD_RAG_BGE_BATCH_SIZE", "8"))
DEFAULT_MAX_LENGTH = int(os.environ.get("STORYBOARD_RAG_BGE_MAX_LENGTH", "8192"))
DEFAULT_DEVICE = os.environ.get("STORYBOARD_RAG_DEVICE", "cpu")
QUEUE_TIMEOUT_SECONDS = float(os.environ.get("STORYBOARD_RAG_QUEUE_TIMEOUT_SECONDS", "15"))
MEMORY_BUDGET_MB = int(os.environ.get("STORYBOARD_RAG_MEMORY_BUDGET_MB", "0") or "0")
WORKLOAD_CONCURRENCY_LIMITS = {
    "models": max(1, int(os.environ.get("STORYBOARD_RAG_MODELS_CONCURRENCY", "1"))),
    "embed": max(1, int(os.environ.get("STORYBOARD_RAG_EMBED_CONCURRENCY", "1"))),
    "rerank": max(1, int(os.environ.get("STORYBOARD_RAG_RERANK_CONCURRENCY", "1"))),
    "caption": max(1, int(os.environ.get("STORYBOARD_RAG_CAPTION_CONCURRENCY", "1"))),
}
_WORKLOAD_SEMAPHORES: dict[str, asyncio.Semaphore] = {}
_WORKLOAD_QUEUED: Counter[str] = Counter()
_WORKLOAD_INFLIGHT: Counter[str] = Counter()
_OPERATION_CALLS: Counter[str] = Counter()
_OPERATION_FAILURES: Counter[str] = Counter()
_OPERATION_TIMEOUTS: Counter[str] = Counter()
_OPERATION_QUEUE_TIMEOUTS: Counter[str] = Counter()
_OPERATION_LAST_ERROR: dict[str, str] = {}
_COMPATIBILITY_FALLBACKS: Counter[str] = Counter()
_COMPATIBILITY_LAST_ERROR: dict[str, str] = {}
_COUNTER_LOCK = Lock()


class RagWorkerError(RuntimeError):
    """Worker-visible provider failure."""


_SAFE_RAG_REASON_CODES = frozenset(
    {
        "required_bge_sparse_weights_missing",
        "required_bge_sparse_weights_empty",
        "required_flagembedding_missing",
        "required_llava_transformers_missing",
        "required_bge_output_shape_invalid",
        "required_bge_dimension_invalid",
        "required_reranker_output_shape_invalid",
        "required_remote_worker_failed",
        "required_remote_worker_unavailable",
        "required_remote_worker_invalid_json",
        "required_remote_worker_invalid_response",
        "required_llava_remote_worker_missing",
        "required_llava_remote_contract_invalid",
        "required_llava_frame_missing",
        "required_llava_runtime_dependencies_missing",
        "required_llava_caption_empty",
        "required_ollama_cli_missing",
        "required_ollama_list_failed",
        "required_bge_model_load_failed",
        "required_reranker_model_load_failed",
        "required_reranker_score_failed",
        "required_gemini_response_uncertain", "required_gemini_response_invalid",
        "required_gemini_frame_invalid", "required_model_auth_failed",
        "required_provider_budget_unavailable", "required_provider_budget_timeout",
        "required_model_quota_exhausted", "required_model_failed", "required_worker_queue_timeout",
    }
)


def _error_status(error: BaseException) -> int | None:
    for attribute in ("status", "status_code", "code"):
        try:
            value = getattr(error, attribute, None)
        except Exception:  # noqa: BLE001 - provider attributes can be properties.
            continue
        if type(value) is int:
            return value
    return None


def _exception_message_text(error: BaseException) -> str:
    """Inspect textual exception arguments only for internal classification."""
    try:
        return "\n".join(value for value in error.args if type(value) is str).lower()
    except Exception:  # noqa: BLE001 - malformed provider errors are classified generically.
        return ""


def _classify_provider_error(error: BaseException) -> str:
    if isinstance(error, RagWorkerError):
        try:
            reason = error.args[0] if error.args else None
        except Exception:  # noqa: BLE001 - malformed provider errors are classified generically.
            reason = None
        if type(reason) is str and reason in _SAFE_RAG_REASON_CODES:
            return reason

    status = _error_status(error)
    message = _exception_message_text(error)
    if status == 429 or any(
        marker in message for marker in ("quota", "resource_exhausted", "rate limit", "429")
    ):
        return "required_model_quota_exhausted"
    if status in (401, 403) or any(
        marker in message
        for marker in ("unauthenticated", "unauthorized", "forbidden", "api key", "permission denied")
    ):
        return "required_model_auth_failed"
    return "required_model_failed"


def _provider_error_reason(error: BaseException) -> str:
    reason = _classify_provider_error(error)
    if isinstance(error, RagWorkerError) and reason in _SAFE_RAG_REASON_CODES:
        return reason
    return f"{reason}:{safe_error_name(error)}"

class OperationTimings(BaseModel):
    operation: str
    workload: str
    queueMs: float
    executionMs: float
    totalMs: float
    timeoutMs: float
    queueTimeoutMs: float
    concurrencyLimit: int
    queueDepthBefore: int


class WarmupRequest(BaseModel):
    load: bool = True


class EmbedRequest(BaseModel):
    task: Literal["RETRIEVAL_DOCUMENT", "RETRIEVAL_QUERY"] = "RETRIEVAL_DOCUMENT"
    texts: list[str] = Field(min_length=1, max_length=64)
    batchSize: int = Field(default=DEFAULT_BATCH_SIZE, ge=1, le=64)
    maxLength: int = Field(default=DEFAULT_MAX_LENGTH, ge=32, le=8192)

    @field_validator("texts")
    @classmethod
    def validate_texts(cls, value: list[str]) -> list[str]:
        cleaned = [item.strip() for item in value]
        if any(len(item) > 20000 for item in cleaned):
            raise ValueError("text length exceeded")
        if any(not item for item in cleaned):
            raise ValueError("texts must not contain empty strings")
        return cleaned


class EmbeddingItem(BaseModel):
    dense: list[float]
    sparse: dict[str, float]


class EmbedResponse(BaseModel):
    schemaVersion: Literal[1] = 1
    provider: Literal["gemini-api"] = "gemini-api"
    fingerprint: str = EMBED_FINGERPRINT
    model: str
    dimensions: int
    items: list[EmbeddingItem]
    timings: OperationTimings | None = None


class RerankCandidate(BaseModel):
    id: str
    content: str = Field(max_length=20202)
    metadata: dict[str, Any] = Field(default_factory=dict)
    denseScore: float | None = None
    sparseScore: float | None = None
    weightedScore: float | None = None

    @field_validator("content")
    @classmethod
    def validate_content(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("candidate content must not be empty")
        return cleaned


class QueryEmbedding(BaseModel):
    fingerprint: Literal["gemini-embedding-001:1024:retrieval:l2:v1"]
    dense: list[float]

    @field_validator("dense", mode="before")
    @classmethod
    def validate_dense(cls, value: Any) -> Any:
        _validate_query_vector(value)
        return value


class RerankRequest(BaseModel):
    queryEmbedding: QueryEmbedding | None = None
    query: str = Field(min_length=1, max_length=2000)
    candidates: list[RerankCandidate] = Field(min_length=1, max_length=50)
    topK: int = Field(default=3, ge=1, le=10)


class RerankResult(BaseModel):
    id: str
    content: str = Field(max_length=20202)
    metadata: dict[str, Any]
    denseScore: float | None = None
    sparseScore: float | None = None
    weightedScore: float | None = None
    rerankScore: float


class RerankResponse(BaseModel):
    schemaVersion: Literal[1] = 1
    provider: Literal["gemini-api"] = "gemini-api"
    fingerprint: str = EMBED_FINGERPRINT
    method: Literal["embedding_cosine"] = "embedding_cosine"
    model: str
    results: list[RerankResult]
    timings: OperationTimings | None = None


class CaptionRequest(BaseModel):
    framePaths: list[str] = Field(min_length=1, max_length=8)
    prompt: str = Field(default="Describe the food, place, action, and creator-useful storyboard cues in Korean.")


class CaptionResponse(BaseModel):
    schemaVersion: Literal[1] = 1
    provider: Literal["gemini-api"] = "gemini-api"
    model: str
    caption: str
    frameCount: int
    timings: OperationTimings | None = None


class ProviderState(BaseModel):
    id: str
    required: bool = True
    ready: bool
    reason: str | None = None


class ProviderReadinessResponse(BaseModel):
    schemaVersion: Literal[1] = 1
    ready: bool
    providers: list[ProviderState]
    timings: OperationTimings | None = None
    settings: dict[str, Any] = Field(default_factory=dict)
    runtimeProfile: dict[str, Any] = Field(default_factory=dict)
    memoryProfile: dict[str, Any] = Field(default_factory=dict)
    counters: dict[str, Any] = Field(default_factory=dict)


app = FastAPI(
    title="Tzudong Storyboard RAG Worker",
    version="1.1.1",
    description=(
        "Gemini API worker for storyboard RAG. Embedding, candidate ranking and "
        "frame captioning stay outside Vercel/Next.js."
    ),
)


@app.exception_handler(RequestValidationError)
async def invalid_request(_request: Any, _error: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"error": "invalid_storyboard_rag_request"})


def _timeout() -> float:
    return max(1.0, DEFAULT_TIMEOUT_SECONDS)


def _queue_timeout() -> float:
    return max(0.05, min(max(0.05, QUEUE_TIMEOUT_SECONDS), _timeout()))


def _round_ms(value: float) -> float:
    return round(value * 1000.0, 3)


def _get_semaphore(workload: str) -> asyncio.Semaphore:
    semaphore = _WORKLOAD_SEMAPHORES.get(workload)
    if semaphore is None:
        semaphore = asyncio.Semaphore(WORKLOAD_CONCURRENCY_LIMITS.get(workload, 1))
        _WORKLOAD_SEMAPHORES[workload] = semaphore
    return semaphore


def _worker_settings() -> dict[str, Any]:
    return {
        "timeoutSeconds": _timeout(),
        "queueTimeoutSeconds": _queue_timeout(),
        "batchSizeDefault": DEFAULT_BATCH_SIZE,
        "maxLengthDefault": DEFAULT_MAX_LENGTH,
        "device": DEFAULT_DEVICE,
        "concurrency": dict(WORKLOAD_CONCURRENCY_LIMITS),
        "memoryBudgetMb": MEMORY_BUDGET_MB or None,
        "provider": "gemini-api",
        "providerConcurrency": 1,
        "automaticRetry": False,
        "readinessMode": "configuration-only",
    }


def _memory_profile() -> dict[str, Any]:
    process_rss_mb: float | None = None
    try:
        import psutil  # type: ignore

        process_rss_mb = psutil.Process(os.getpid()).memory_info().rss / 1024 / 1024
    except Exception:  # noqa: BLE001 - optional observability dependency.
        try:
            import resource  # type: ignore

            rss = float(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
            process_rss_mb = rss / 1024 if platform.system() != "Darwin" else rss / 1024 / 1024
        except Exception:  # noqa: BLE001
            process_rss_mb = None
    over_budget = (
        bool(MEMORY_BUDGET_MB)
        and process_rss_mb is not None
        and process_rss_mb > float(MEMORY_BUDGET_MB)
    )
    return {
        "budgetMb": MEMORY_BUDGET_MB or None,
        "processRssMb": round(process_rss_mb, 3) if process_rss_mb is not None else None,
        "overBudget": over_budget,
        "budgetPolicy": "warn",
    }


def _runtime_profile() -> dict[str, Any]:
    return {"platform": platform.platform(), "python": platform.python_version(),
            "cpuCount": os.cpu_count(), "configuredDevice": "official-api",
            "resolvedDevice": "official-api", "cudaAvailable": False,
            "provider": "gemini-api", "embeddingFingerprint": EMBED_FINGERPRINT}


def _worker_counters_snapshot() -> dict[str, Any]:
    with _COUNTER_LOCK:
        operations = sorted(
            set(_OPERATION_CALLS)
            | set(_OPERATION_FAILURES)
            | set(_OPERATION_TIMEOUTS)
            | set(_OPERATION_QUEUE_TIMEOUTS)
        )
        return {
            "operations": {
                operation: {
                    "calls": _OPERATION_CALLS[operation],
                    "failures": _OPERATION_FAILURES[operation],
                    "timeouts": _OPERATION_TIMEOUTS[operation],
                    "queueTimeouts": _OPERATION_QUEUE_TIMEOUTS[operation],
                    "lastError": _OPERATION_LAST_ERROR.get(operation),
                }
                for operation in operations
            },
            "queued": dict(_WORKLOAD_QUEUED),
            "inflight": dict(_WORKLOAD_INFLIGHT),
            "compatibilityFallbacks": {
                key: {"count": _COMPATIBILITY_FALLBACKS[key], "lastError": _COMPATIBILITY_LAST_ERROR.get(key)}
                for key in sorted(_COMPATIBILITY_FALLBACKS)
            },
        }


def _record_observation(operation: str, cause: str | None = None) -> None:
    with _COUNTER_LOCK:
        _OPERATION_CALLS[operation] += 1
        if cause:
            _OPERATION_FAILURES[operation] += 1
            _OPERATION_LAST_ERROR[operation] = cause
            if cause == "timeout":
                _OPERATION_TIMEOUTS[operation] += 1
            if cause == "queue_timeout":
                _OPERATION_QUEUE_TIMEOUTS[operation] += 1


def _record_compatibility_fallback(key: str, error: Exception) -> None:
    with _COUNTER_LOCK:
        _COMPATIBILITY_FALLBACKS[key] += 1
        _COMPATIBILITY_LAST_ERROR[key] = (
            f"compatibility_keyword_unsupported:{safe_error_name(error)}"
        )

def _attach_observability(result: Any, timings: OperationTimings) -> Any:
    if isinstance(result, BaseModel):
        if hasattr(result, "timings"):
            setattr(result, "timings", timings)
        if hasattr(result, "settings"):
            setattr(result, "settings", _worker_settings())
        if hasattr(result, "runtimeProfile"):
            setattr(result, "runtimeProfile", _runtime_profile())
        if hasattr(result, "memoryProfile"):
            setattr(result, "memoryProfile", _memory_profile())
        if hasattr(result, "counters"):
            setattr(result, "counters", _worker_counters_snapshot())
    return result


async def _run_blocking(operation: str, workload: str, fn, *args: Any) -> Any:
    total_started = time.perf_counter()
    queue_started = total_started
    queue_depth_before = _WORKLOAD_QUEUED[workload]
    semaphore = _get_semaphore(workload)
    with _COUNTER_LOCK:
        _WORKLOAD_QUEUED[workload] += 1
    try:
        try:
            await asyncio.wait_for(semaphore.acquire(), timeout=_queue_timeout())
        except asyncio.TimeoutError:
            timings = OperationTimings(
                operation=operation,
                workload=workload,
                queueMs=_round_ms(time.perf_counter() - queue_started),
                executionMs=0.0,
                totalMs=_round_ms(time.perf_counter() - total_started),
                timeoutMs=_round_ms(_timeout()),
                queueTimeoutMs=_round_ms(_queue_timeout()),
                concurrencyLimit=WORKLOAD_CONCURRENCY_LIMITS.get(workload, 1),
                queueDepthBefore=queue_depth_before,
            )
            _record_observation(operation, "queue_timeout")
            raise HTTPException(
                status_code=503,
                detail={"error": "required_worker_queue_timeout", "timings": timings.model_dump()},
            ) from None
    finally:
        with _COUNTER_LOCK:
            _WORKLOAD_QUEUED[workload] -= 1

    execution_started = time.perf_counter()
    with _COUNTER_LOCK:
        _WORKLOAD_INFLIGHT[workload] += 1

    capacity_released = False

    def release_capacity() -> None:
        nonlocal capacity_released
        if capacity_released:
            return
        with _COUNTER_LOCK:
            _WORKLOAD_INFLIGHT[workload] -= 1
        semaphore.release()
        capacity_released = True

    def release_capacity_when_done(done_future: asyncio.Future) -> None:
        try:
            done_future.exception()
        except Exception:  # noqa: BLE001 - best-effort exception consumption for timed-out background work.
            pass
        release_capacity()

    loop = asyncio.get_running_loop()
    def execute() -> Any:
        _OPERATION_DEADLINE.value = time.monotonic() + _timeout()
        try:
            return fn(*args)
        finally:
            del _OPERATION_DEADLINE.value

    future = loop.run_in_executor(None, execute)
    release_on_exit = True
    try:
        try:
            result = await asyncio.wait_for(asyncio.shield(future), timeout=_timeout())
        except asyncio.TimeoutError:
            release_on_exit = False
            future.add_done_callback(release_capacity_when_done)
            _record_observation(operation, "timeout")
            raise HTTPException(status_code=504, detail="required_model_timeout") from None
        except RagWorkerError as exc:
            cause = _provider_error_reason(exc)
            _record_observation(operation, cause)
            raise HTTPException(status_code=503, detail=cause) from None
        except Exception as exc:  # noqa: BLE001 - convert provider exceptions into fail-closed API errors.
            cause = _provider_error_reason(exc)
            _record_observation(operation, cause)
            raise HTTPException(status_code=503, detail=cause) from None
        timings = OperationTimings(
            operation=operation,
            workload=workload,
            queueMs=_round_ms(execution_started - queue_started),
            executionMs=_round_ms(time.perf_counter() - execution_started),
            totalMs=_round_ms(time.perf_counter() - total_started),
            timeoutMs=_round_ms(_timeout()),
            queueTimeoutMs=_round_ms(_queue_timeout()),
            concurrencyLimit=WORKLOAD_CONCURRENCY_LIMITS.get(workload, 1),
            queueDepthBefore=queue_depth_before,
        )
        _record_observation(operation)
        return _attach_observability(result, timings)
    finally:
        if release_on_exit:
            release_capacity()


def _gemini_key() -> str:
    key = next((os.environ.get(name, "").strip() for name in
                ("GEMINI_CREDITS_API_KEY", "STORYBOARD_GEMINI_API_KEY", "GEMINI_API_KEY")
                if os.environ.get(name, "").strip()), "")
    if not key:
        raise RagWorkerError("required_model_auth_failed")
    return key


class _DeadlineProjectBudget(ProjectBudget):
    """Keep shared pacing/lease semantics; cap SQLite busy waits during acquire."""

    def __init__(self, deadline: float):
        self.acquire_deadline: float | None = deadline
        super().__init__(budget_path(), os.getenv("GEMINI_BUDGET_PROJECT", "configured-project"),
                         rpm=positive_int(os.getenv("GEMINI_REQUESTS_PER_MINUTE"), 30, 100000),
                         concurrency=positive_int(os.getenv("GEMINI_MAX_INFLIGHT"), 1, 8))

    @contextmanager
    def connect(self):
        timeout = 30.0
        if self.acquire_deadline is not None:
            timeout = min(timeout, self.acquire_deadline - time.monotonic())
            if timeout <= 0:
                raise TimeoutError("provider_budget_timeout")
        db = sqlite3.connect(self.path, timeout=timeout, isolation_level=None)
        try:
            yield db
        finally:
            db.close()


def _gemini_call(model: str, operation: str, payload: dict[str, Any]) -> dict[str, Any]:
    # Official REST, one attempt. Same project/scope/path and RPM/MAX_INFLIGHT as
    # other workers/crawlers; no credentials, prompts or provider responses in SQLite.
    key = _gemini_key()
    deadline = getattr(_OPERATION_DEADLINE, "value", time.monotonic() + _timeout())
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise RagWorkerError("required_gemini_response_uncertain")
    if not _GEMINI_CALL_LOCK.acquire(timeout=min(_queue_timeout(), remaining)):
        raise RagWorkerError("required_worker_queue_timeout")
    budget: _DeadlineProjectBudget | None = None
    lease: str | None = None
    try:
        try:
            budget = _DeadlineProjectBudget(deadline)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("provider_budget_timeout")
            lease = budget.acquire(os.getpid(), timeout=remaining)
            # Cleanup/cooldown retain the shared budget's original connection rules.
            budget.acquire_deadline = None
        except TimeoutError:
            raise RagWorkerError("required_provider_budget_timeout") from None
        except (OSError, ValueError, sqlite3.Error):
            raise RagWorkerError("required_provider_budget_unavailable") from None
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise RagWorkerError("required_gemini_response_uncertain")
        request = urllib.request.Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:{operation}",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "x-goog-api-key": key}, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=remaining) as response:
                result = json.loads(response.read(4 * 1024 * 1024 + 1))
        except urllib.error.HTTPError as error:
            if error.code == 429:
                delay = retry_after_seconds(error.headers.get("Retry-After") if error.headers else None)
                if delay is not None:
                    try:
                        budget.cooldown(delay)
                    except (OSError, ValueError, sqlite3.Error):
                        raise RagWorkerError("required_provider_budget_unavailable") from None
            raise RagWorkerError("required_model_quota_exhausted" if error.code == 429 else
                                 "required_model_auth_failed" if error.code in (401, 403) else
                                 "required_model_failed") from None
        except Exception:
            raise RagWorkerError("required_gemini_response_uncertain") from None
        if not isinstance(result, dict):
            raise RagWorkerError("required_gemini_response_invalid")
        return result
    finally:
        try:
            if budget is not None and lease is not None:
                budget.release(lease)
        except (OSError, ValueError, sqlite3.Error):
            # Never silently repeat completed paid work; the retained lease fails
            # closed until explicit recovery/restart if cleanup cannot be persisted.
            raise RagWorkerError("required_provider_budget_unavailable") from None
        finally:
            _GEMINI_CALL_LOCK.release()


def _embedding_values(value: Any) -> list[float]:
    if not isinstance(value, list) or len(value) != 1024 or any(
            type(item) not in (int, float) or not math.isfinite(item) for item in value):
        raise RagWorkerError("required_gemini_response_invalid")
    norm = math.sqrt(sum(item * item for item in value))
    if not math.isfinite(norm) or norm <= 0:
        raise RagWorkerError("required_gemini_response_invalid")
    return [item / norm for item in value]


def _encode_texts(request: EmbedRequest) -> EmbedResponse:
    response = _gemini_call(EMBED_MODEL_ID, "batchEmbedContents", {"requests": [
        {"model": f"models/{EMBED_MODEL_ID}", "content": {"parts": [{"text": text}]},
         "taskType": request.task, "outputDimensionality": 1024} for text in request.texts]})
    embeddings = response.get("embeddings")
    if not isinstance(embeddings, list) or len(embeddings) != len(request.texts):
        raise RagWorkerError("required_gemini_response_invalid")
    return EmbedResponse(model=EMBED_MODEL_ID, dimensions=1024, items=[
        EmbeddingItem(dense=_embedding_values(item.get("values") if isinstance(item, dict) else None),
                      sparse={}) for item in embeddings])


def _validate_query_vector(value: Any) -> None:
    if not isinstance(value, list) or len(value) != 1024 or any(
            type(item) not in (int, float) or not math.isfinite(item) for item in value):
        raise ValueError("invalid_gemini_query_embedding")
    norm_squared = sum(item * item for item in value)
    if not math.isfinite(norm_squared) or abs(norm_squared - 1.0) > 0.00001:
        raise ValueError("invalid_gemini_query_embedding")


def _rerank(request: RerankRequest) -> RerankResponse:
    # Gemini has no dedicated reranking API. Re-embed bounded candidate text in one
    # batch and rank normalized document/query vectors, including legacy documents.
    # Never compare a stored BGE vector with a Gemini query.
    if request.queryEmbedding is not None:
        try:
            if request.queryEmbedding.fingerprint != EMBED_FINGERPRINT:
                raise ValueError("invalid_gemini_query_embedding")
            _validate_query_vector(request.queryEmbedding.dense)
        except ValueError:
            raise RagWorkerError("required_gemini_response_invalid") from None
        query = request.queryEmbedding.dense
    else:
        query = _encode_texts(EmbedRequest(texts=[request.query], task="RETRIEVAL_QUERY")).items[0].dense
    docs = _encode_texts(EmbedRequest(texts=[item.content for item in request.candidates])).items
    scored = [(candidate, sum(a*b for a, b in zip(query, embedding.dense, strict=True)))
              for candidate, embedding in zip(request.candidates, docs, strict=True)]
    return RerankResponse(model=EMBED_MODEL_ID, results=[RerankResult(
        **candidate.model_dump(), rerankScore=score) for candidate, score in
        sorted(scored, key=lambda item: item[1], reverse=True)[:request.topK]])


def _caption_frames(request: CaptionRequest) -> CaptionResponse:
    parts: list[dict[str, Any]] = [{"text": request.prompt[:2000]}]
    total = 0
    for raw_path in request.framePaths:
        frame = Path(raw_path).expanduser()
        mime = mimetypes.guess_type(frame.name)[0]
        if not frame.is_file() or mime not in ("image/png", "image/jpeg", "image/webp"):
            raise RagWorkerError("required_gemini_frame_invalid")
        total += frame.stat().st_size
        if total > 8 * 1024 * 1024:
            raise RagWorkerError("required_gemini_frame_invalid")
        data = frame.read_bytes()
        parts.append({"inlineData": {"mimeType": mime, "data": base64.b64encode(data).decode("ascii")}})
    response = _gemini_call(CAPTION_MODEL_ID, "generateContent", {
        "contents": [{"role": "user", "parts": parts}], "generationConfig": {"maxOutputTokens": 512}})
    try:
        caption = "".join(item.get("text", "") for item in response["candidates"][0]["content"]["parts"]).strip()
    except (KeyError, IndexError, TypeError):
        raise RagWorkerError("required_gemini_response_invalid") from None
    if not caption:
        raise RagWorkerError("required_gemini_response_invalid")
    return CaptionResponse(model=CAPTION_MODEL_ID, caption=caption, frameCount=len(request.framePaths))


def _provider_readiness(load_required_models: bool) -> ProviderReadinessResponse:
    # Configuration readiness only; warmup never spends credits or downloads models.
    try:
        _gemini_key()
        ready = True
    except RagWorkerError:
        ready = False
    return ProviderReadinessResponse(ready=ready, providers=[ProviderState(
        id=model, ready=ready, reason=None if ready else "required_model_auth_failed")
        for model in (EMBED_MODEL_ID, CAPTION_MODEL_ID)])


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "storyboard-rag-worker",
        "schemaVersion": 1,
        "settings": _worker_settings(),
        "runtimeProfile": _runtime_profile(),
        "memoryProfile": _memory_profile(),
        "counters": _worker_counters_snapshot(),
        "readinessEndpoint": "/models?load=true",
    }


@app.get("/models", response_model=ProviderReadinessResponse)
async def models(load: bool = Query(default=True, description="Configuration readiness only; never invokes a paid provider.")) -> ProviderReadinessResponse:
    return await _run_blocking("models.load" if load else "models.peek", "models", _provider_readiness, load)


@app.post("/warmup", response_model=ProviderReadinessResponse)
async def warmup(request: WarmupRequest) -> ProviderReadinessResponse:
    return await _run_blocking("warmup.load" if request.load else "warmup.peek", "models", _provider_readiness, request.load)

@app.post("/embed", response_model=EmbedResponse)
async def embed(request: EmbedRequest) -> EmbedResponse:
    return await _run_blocking("embed", "embed", _encode_texts, request)


@app.post("/rerank", response_model=RerankResponse)
async def rerank(request: RerankRequest) -> RerankResponse:
    return await _run_blocking("rerank", "rerank", _rerank, request)


@app.post("/caption", response_model=CaptionResponse)
async def caption(request: CaptionRequest) -> CaptionResponse:
    return await _run_blocking("caption", "caption", _caption_frames, request)
