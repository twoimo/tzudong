"""FastAPI RAG worker for storyboard Custom GPT / Next.js integration.

The worker owns every heavy model execution path. Next.js routes must only
validate/authenticate requests, call Supabase RPCs, and proxy model work here.
Missing models, OAuth files, Ollama aliases, or invalid worker responses are
hard failures; callers must not synthesize fake retrieval results.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import urllib.error
import urllib.request
import platform
import time
from collections import Counter
from threading import Lock
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

BGE_MODEL_ID = os.environ.get("STORYBOARD_RAG_BGE_MODEL", "BAAI/bge-m3")
RERANKER_MODEL_ID = os.environ.get(
    "STORYBOARD_RAG_RERANKER_MODEL", "BAAI/bge-reranker-v2-m3"
)
LLAVA_MODEL_ID = os.environ.get(
    "STORYBOARD_RAG_LLAVA_MODEL", "llava-hf/LLaVA-NeXT-Video-7B-hf"
)
CONTEXT_MODEL_ID = os.environ.get(
    "STORYBOARD_RAG_CONTEXT_MODEL", "cookieshake/a.x-4.0-light-imatrix:Q8_0"
)
OLLAMA_JUDGE_MODELS = tuple(
    item.strip()
    for item in os.environ.get(
        "STORYBOARD_RAG_OLLAMA_JUDGE_MODELS",
        "exaone3.5:7.8b,bnksys/eeve:10.8b-korean-instruct-q8-v1,qwen3:8b,solar:10.7b-instruct-v1-q5_0",
    ).split(",")
    if item.strip()
)
DEFAULT_TIMEOUT_SECONDS = float(os.environ.get("STORYBOARD_RAG_WORKER_TIMEOUT_SECONDS", "120"))
DEFAULT_BATCH_SIZE = int(os.environ.get("STORYBOARD_RAG_BGE_BATCH_SIZE", "8"))
DEFAULT_MAX_LENGTH = int(os.environ.get("STORYBOARD_RAG_BGE_MAX_LENGTH", "8192"))
DEFAULT_DEVICE = os.environ.get("STORYBOARD_RAG_DEVICE", "cpu")
REMOTE_LLAVA_WORKER_URL = (
    os.environ.get("STORYBOARD_RAG_LLAVA_WORKER_URL")
    or os.environ.get("STORYBOARD_RAG_GPU_WORKER_URL")
    or ""
).rstrip("/")
ALLOW_LOCAL_LLAVA_WARMUP = os.environ.get("STORYBOARD_RAG_LLAVA_LOCAL_WARMUP") == "1"
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
    texts: list[str] = Field(min_length=1, max_length=64)
    batchSize: int = Field(default=DEFAULT_BATCH_SIZE, ge=1, le=64)
    maxLength: int = Field(default=DEFAULT_MAX_LENGTH, ge=32, le=8192)

    @field_validator("texts")
    @classmethod
    def validate_texts(cls, value: list[str]) -> list[str]:
        cleaned = [item.strip() for item in value]
        if any(not item for item in cleaned):
            raise ValueError("texts must not contain empty strings")
        return cleaned


class EmbeddingItem(BaseModel):
    dense: list[float]
    sparse: dict[str, float]


class EmbedResponse(BaseModel):
    schemaVersion: Literal[1] = 1
    provider: Literal["bge-m3"] = "bge-m3"
    model: str
    dimensions: int
    items: list[EmbeddingItem]
    timings: OperationTimings | None = None


class RerankCandidate(BaseModel):
    id: str
    content: str
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


class RerankRequest(BaseModel):
    query: str = Field(min_length=1)
    candidates: list[RerankCandidate] = Field(min_length=1, max_length=50)
    topK: int = Field(default=3, ge=1, le=10)


class RerankResult(BaseModel):
    id: str
    content: str
    metadata: dict[str, Any]
    denseScore: float | None = None
    sparseScore: float | None = None
    weightedScore: float | None = None
    rerankScore: float


class RerankResponse(BaseModel):
    schemaVersion: Literal[1] = 1
    provider: Literal["bge-reranker-v2-m3"] = "bge-reranker-v2-m3"
    model: str
    results: list[RerankResult]
    timings: OperationTimings | None = None


class CaptionRequest(BaseModel):
    framePaths: list[str] = Field(min_length=1, max_length=8)
    prompt: str = Field(default="Describe the food, place, action, and creator-useful storyboard cues in Korean.")


class CaptionResponse(BaseModel):
    schemaVersion: Literal[1] = 1
    provider: Literal["llava-next-video"] = "llava-next-video"
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
        "Required local model worker for storyboard RAG. Heavy embedding, "
        "reranking, and caption readiness stay outside Vercel/Next.js."
    ),
)


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
        "localLlavaWarmupEnabled": ALLOW_LOCAL_LLAVA_WARMUP,
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
    cuda_available = False
    try:
        import torch  # type: ignore

        cuda_available = bool(torch.cuda.is_available())
    except Exception:  # noqa: BLE001 - torch is optional until a provider is loaded.
        cuda_available = False
    return {
        "platform": platform.platform(),
        "python": platform.python_version(),
        "cpuCount": os.cpu_count(),
        "configuredDevice": DEFAULT_DEVICE,
        "resolvedDevice": _resolve_device(),
        "cudaAvailable": cuda_available,
        "remoteLlavaConfigured": bool(REMOTE_LLAVA_WORKER_URL),
        "remoteLlavaUrl": REMOTE_LLAVA_WORKER_URL or None,
        "localLlavaWarmupEnabled": ALLOW_LOCAL_LLAVA_WARMUP,
    }


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
        _COMPATIBILITY_LAST_ERROR[key] = f"{type(error).__name__}:{error}"

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
        except asyncio.TimeoutError as exc:
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
            ) from exc
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
    future = loop.run_in_executor(None, fn, *args)
    release_on_exit = True
    try:
        try:
            result = await asyncio.wait_for(asyncio.shield(future), timeout=_timeout())
        except asyncio.TimeoutError as exc:
            release_on_exit = False
            future.add_done_callback(release_capacity_when_done)
            _record_observation(operation, "timeout")
            raise HTTPException(status_code=504, detail="required_model_timeout") from exc
        except RagWorkerError as exc:
            _record_observation(operation, str(exc))
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except Exception as exc:  # noqa: BLE001 - convert provider exceptions into fail-closed API errors.
            cause = f"required_model_failed:{type(exc).__name__}"
            _record_observation(operation, cause)
            raise HTTPException(status_code=503, detail=cause) from exc
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


def _normalize_dense(value: Any) -> list[float]:
    if hasattr(value, "tolist"):
        value = value.tolist()
    if not isinstance(value, list):
        value = list(value)
    return [float(item) for item in value]


def _normalize_sparse(value: Any) -> dict[str, float]:
    if value is None:
        raise RagWorkerError("required_bge_sparse_weights_missing")
    if hasattr(value, "items"):
        sparse = {str(key): float(weight) for key, weight in value.items() if float(weight) != 0.0}
        if not sparse:
            raise RagWorkerError("required_bge_sparse_weights_empty")
        return sparse
    raise RagWorkerError("required_bge_sparse_weights_missing")


def _as_sequence(value: Any) -> list[Any]:
    if hasattr(value, "tolist"):
        value = value.tolist()
    if isinstance(value, list):
        return value
    return list(value)


def _resolve_device() -> str:
    if DEFAULT_DEVICE != "auto":
        return DEFAULT_DEVICE
    try:
        import torch  # type: ignore

        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        return "cpu"


def _is_unsupported_keyword_error(error: TypeError, keyword: str) -> bool:
    message = str(error).lower()
    return keyword.lower() in message and (
        "unexpected" in message
        or "unsupported" in message
        or "got an invalid" in message
        or "got an unexpected" in message
    )

@lru_cache(maxsize=1)
def _load_bge_model() -> Any:
    try:
        from FlagEmbedding import BGEM3FlagModel  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise RagWorkerError("required_flagembedding_missing") from exc
    try:
        return BGEM3FlagModel(BGE_MODEL_ID, use_fp16=False, device=_resolve_device())
    except TypeError as exc:
        if not _is_unsupported_keyword_error(exc, "device"):
            raise
        _record_compatibility_fallback("bge.device_keyword", exc)
        return BGEM3FlagModel(BGE_MODEL_ID, use_fp16=False)


@lru_cache(maxsize=1)
def _load_reranker() -> Any:
    try:
        from FlagEmbedding import FlagReranker  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise RagWorkerError("required_flagembedding_missing") from exc
    try:
        return FlagReranker(RERANKER_MODEL_ID, use_fp16=False, device=_resolve_device())
    except TypeError as exc:
        if not _is_unsupported_keyword_error(exc, "device"):
            raise
        _record_compatibility_fallback("reranker.device_keyword", exc)
        return FlagReranker(RERANKER_MODEL_ID, use_fp16=False)


@lru_cache(maxsize=1)
def _load_llava_components() -> tuple[Any, Any]:
    try:
        from transformers import AutoProcessor, LlavaNextVideoForConditionalGeneration  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise RagWorkerError("required_llava_transformers_missing") from exc
    processor = AutoProcessor.from_pretrained(LLAVA_MODEL_ID)
    model = LlavaNextVideoForConditionalGeneration.from_pretrained(LLAVA_MODEL_ID)
    return processor, model


def _encode_texts(request: EmbedRequest) -> EmbedResponse:
    model = _load_bge_model()
    encoded = model.encode(
        request.texts,
        batch_size=request.batchSize,
        max_length=request.maxLength,
        return_dense=True,
        return_sparse=True,
        return_colbert_vecs=False,
    )
    dense_values = _as_sequence(encoded.get("dense_vecs"))
    sparse_values = _as_sequence(encoded.get("lexical_weights"))
    if len(dense_values) != len(request.texts) or len(sparse_values) != len(request.texts):
        raise RagWorkerError("required_bge_output_shape_invalid")
    items = [
        EmbeddingItem(dense=_normalize_dense(dense), sparse=_normalize_sparse(sparse))
        for dense, sparse in zip(dense_values, sparse_values, strict=True)
    ]
    dimensions = len(items[0].dense) if items else 0
    if dimensions != 1024:
        raise RagWorkerError(f"required_bge_dimension_invalid:{dimensions}")
    return EmbedResponse(model=BGE_MODEL_ID, dimensions=dimensions, items=items)


def _rerank(request: RerankRequest) -> RerankResponse:
    reranker = _load_reranker()
    pairs = [[request.query, candidate.content] for candidate in request.candidates]
    try:
        raw_scores = reranker.compute_score(pairs, normalize=True)
    except TypeError as exc:
        if not _is_unsupported_keyword_error(exc, "normalize"):
            raise
        _record_compatibility_fallback("reranker.normalize_keyword", exc)
        raw_scores = reranker.compute_score(pairs)
    scores = _as_sequence(raw_scores)
    if len(scores) != len(request.candidates):
        raise RagWorkerError("required_reranker_output_shape_invalid")
    ranked = sorted(
        zip(request.candidates, scores, strict=True),
        key=lambda item: float(item[1]),
        reverse=True,
    )[: request.topK]
    return RerankResponse(
        model=RERANKER_MODEL_ID,
        results=[
            RerankResult(
                id=candidate.id,
                content=candidate.content,
                metadata=candidate.metadata,
                denseScore=candidate.denseScore,
                sparseScore=candidate.sparseScore,
                weightedScore=candidate.weightedScore,
                rerankScore=float(score),
            )
            for candidate, score in ranked
        ],
    )

def _post_remote_json(url: str, payload: dict[str, Any], timeout_seconds: float) -> dict[str, Any]:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:  # noqa: S310 - operator-provided internal worker URL
            if response.status < 200 or response.status >= 300:
                raise RagWorkerError(f"required_remote_worker_failed:{response.status}")
            parsed = json.loads(response.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        raise RagWorkerError("required_remote_worker_unavailable") from exc
    except json.JSONDecodeError as exc:
        raise RagWorkerError("required_remote_worker_invalid_json") from exc
    if not isinstance(parsed, dict):
        raise RagWorkerError("required_remote_worker_invalid_response")
    return parsed


def _remote_caption(request: CaptionRequest) -> CaptionResponse:
    if not REMOTE_LLAVA_WORKER_URL:
        raise RagWorkerError("required_llava_remote_worker_missing")
    payload = request.model_dump()
    parsed = _post_remote_json(
        f"{REMOTE_LLAVA_WORKER_URL}/caption",
        payload,
        DEFAULT_TIMEOUT_SECONDS,
    )
    try:
        response = CaptionResponse(**parsed)
    except Exception as exc:  # noqa: BLE001
        raise RagWorkerError("required_llava_remote_contract_invalid") from exc
    if response.model != LLAVA_MODEL_ID or not response.caption.strip():
        raise RagWorkerError("required_llava_remote_contract_invalid")
    return response



def _caption_frames(request: CaptionRequest) -> CaptionResponse:
    if REMOTE_LLAVA_WORKER_URL:
        return _remote_caption(request)
    frame_paths = [Path(raw_path).expanduser() for raw_path in request.framePaths]
    if any(not frame_path.is_file() for frame_path in frame_paths):
        raise RagWorkerError("required_llava_frame_missing")
    processor, model = _load_llava_components()
    try:
        from PIL import Image  # type: ignore
        import torch  # type: ignore
    except Exception as exc:  # noqa: BLE001
        raise RagWorkerError("required_llava_runtime_dependencies_missing") from exc

    frames = [Image.open(frame_path).convert("RGB") for frame_path in frame_paths]

    prompt = f"USER: <video>\n{request.prompt.strip()}\nASSISTANT:"
    model.eval()
    inputs = processor(text=prompt, videos=[frames], return_tensors="pt")
    model_device = getattr(model, "device", None)
    if model_device is not None and hasattr(inputs, "to"):
        inputs = inputs.to(model_device)

    with torch.no_grad():
        generated_ids = model.generate(**inputs, max_new_tokens=160, do_sample=False)

    decoded = processor.batch_decode(generated_ids, skip_special_tokens=True)[0].strip()
    caption = decoded.split("ASSISTANT:", 1)[-1].strip() if "ASSISTANT:" in decoded else decoded
    if not caption:
        raise RagWorkerError("required_llava_caption_empty")
    return CaptionResponse(model=LLAVA_MODEL_ID, caption=caption, frameCount=len(frames))


def _ollama_models() -> set[str]:
    executable = shutil.which("ollama")
    if not executable:
        raise RagWorkerError("required_ollama_cli_missing")
    completed = subprocess.run(
        [executable, "list"],
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if completed.returncode != 0:
        raise RagWorkerError("required_ollama_list_failed")
    models: set[str] = set()
    for line in completed.stdout.splitlines()[1:]:
        parts = line.split()
        if parts:
            models.add(parts[0])
    return models


def _oauth_file_exists(path_value: str) -> bool:
    return Path(path_value).expanduser().exists()

def _remote_worker_health_ready(base_url: str) -> bool:
    if not base_url:
        return False
    try:
        with urllib.request.urlopen(f"{base_url}/health", timeout=10) as response:  # noqa: S310 - operator-provided internal worker URL
            return 200 <= response.status < 300
    except Exception:  # noqa: BLE001
        return False



def _provider_readiness(load_required_models: bool) -> ProviderReadinessResponse:
    providers: list[ProviderState] = []

    def add_provider(provider_id: str, ready: bool, reason: str | None = None) -> None:
        providers.append(ProviderState(id=provider_id, ready=ready, reason=reason))

    if not load_required_models:
        add_provider(BGE_MODEL_ID, False, "load_not_requested")
        add_provider(RERANKER_MODEL_ID, False, "load_not_requested")
        add_provider(LLAVA_MODEL_ID, False, "load_not_requested")
    else:
        try:
            _load_bge_model()
            add_provider(BGE_MODEL_ID, True)
        except Exception as exc:  # noqa: BLE001
            add_provider(BGE_MODEL_ID, False, str(exc))

        try:
            _load_reranker()
            add_provider(RERANKER_MODEL_ID, True)
        except Exception as exc:  # noqa: BLE001
            add_provider(RERANKER_MODEL_ID, False, str(exc))

        if REMOTE_LLAVA_WORKER_URL:
            remote_ready = _remote_worker_health_ready(REMOTE_LLAVA_WORKER_URL)
            add_provider(
                LLAVA_MODEL_ID,
                remote_ready,
                None if remote_ready else "required_llava_remote_worker_unavailable",
            )
        elif not ALLOW_LOCAL_LLAVA_WARMUP:
            add_provider(LLAVA_MODEL_ID, False, "required_llava_local_warmup_disabled")
        else:
            try:
                _load_llava_components()
                add_provider(LLAVA_MODEL_ID, True)
            except Exception as exc:  # noqa: BLE001
                add_provider(LLAVA_MODEL_ID, False, str(exc))

    try:
        installed = _ollama_models()
        required_ollama = (CONTEXT_MODEL_ID, *OLLAMA_JUDGE_MODELS)
        for model_id in required_ollama:
            add_provider(model_id, model_id in installed, None if model_id in installed else "required_ollama_model_missing")
    except Exception as exc:  # noqa: BLE001
        for model_id in (CONTEXT_MODEL_ID, *OLLAMA_JUDGE_MODELS):
            add_provider(model_id, False, str(exc))

    gemini_oauth = os.environ.get("GEMINI_OAUTH_FILE", "~/.gemini/oauth_creds.json")
    openai_oauth = os.environ.get("OPENAI_CODEX_AUTH_FILE", "~/.codex/auth.json")
    add_provider("gemini-cli-oauth", _oauth_file_exists(gemini_oauth), "required_gemini_oauth_missing" if not _oauth_file_exists(gemini_oauth) else None)
    add_provider("openai-codex-oauth", _oauth_file_exists(openai_oauth), "required_openai_oauth_missing" if not _oauth_file_exists(openai_oauth) else None)

    return ProviderReadinessResponse(
        ready=all(provider.ready for provider in providers),
        providers=providers,
    )


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
async def models(load: bool = Query(default=True, description="Load heavyweight models before reporting readiness.")) -> ProviderReadinessResponse:
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
