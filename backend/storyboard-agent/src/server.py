"""FastAPI server for the storyboard agent."""

from __future__ import annotations

import os
import time
from collections import defaultdict, deque, OrderedDict
from datetime import datetime, timezone
from pathlib import Path
import logging
import asyncio
import threading
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel
from pydantic import field_validator
import uvicorn
from dotenv import load_dotenv


logger = logging.getLogger(__name__)


def _load_dotenv():
    for env_path in (Path(__file__).resolve().parents[1] / ".env", Path(__file__).resolve().parents[1] / ".env.local"):
        if env_path.exists():
            load_dotenv(dotenv_path=env_path, override=False)
            logger.info("Loaded env file: %s", env_path)


_load_dotenv()


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    try:
        return default if raw is None else int(raw)
    except (TypeError, ValueError):
        logger.warning("Invalid int value for %s, fallback: %s", name, default)
        return default


CACHE_TTL_SECONDS = int(os.getenv("STORYBOARD_AGENT_CACHE_TTL_SECONDS", "120"))
CACHE_MAX_ENTRIES = int(os.getenv("STORYBOARD_AGENT_CACHE_MAX_ENTRIES", "200"))
TOOL_PREWARM = os.getenv("STORYBOARD_AGENT_PREWARM", "false").lower() in (
    "1",
    "true",
    "yes",
)

_tools_module: Any | None = None
_tools_lock = threading.Lock()
_boot_timestamp = time.time()
_cache: OrderedDict[str, tuple[float, "StoryboardChatResponse"]] = OrderedDict()
_cache_lock = threading.Lock()
_inflight_requests: dict[str, asyncio.Future["StoryboardChatResponse"]] = {}
_inflight_lock = asyncio.Lock()
_tool_circuit_lock = threading.Lock()

_metrics_history_size = _env_int("STORYBOARD_AGENT_METRICS_HISTORY_SIZE", 300)
if _metrics_history_size <= 0:
    _metrics_history_size = 300

_metrics_lock = threading.Lock()
_metrics_requests_total = 0
_metrics_requests_errors = 0
_metrics_requests_latency_ms_sum = 0.0
_metrics_requests_latency_ms_count = 0
_metrics_cache_hits = 0
_metrics_cache_misses = 0
_metrics_fallback_total = 0
_metrics_request_latency_ms: deque[float] = deque(maxlen=_metrics_history_size)
_metrics_tool_latency_ms: defaultdict[str, deque[float]] = defaultdict(lambda: deque(maxlen=_metrics_history_size))
_metrics_tool_calls = defaultdict(int)
_metrics_tool_errors = defaultdict(int)
_metrics_tool_latency_ms_sum = defaultdict(float)
_metrics_tool_latency_ms_count = defaultdict(int)
_metrics_tool_latency_ms_max = defaultdict(float)
_metrics_tool_circuit_opens = defaultdict(int)
_metrics_request_error_reasons = defaultdict(int)

STORYBOARD_AGENT_REQUEST_TIMEOUT_MS = _env_int("STORYBOARD_AGENT_REQUEST_TIMEOUT_MS", 12000)
if STORYBOARD_AGENT_REQUEST_TIMEOUT_MS < 200:
    STORYBOARD_AGENT_REQUEST_TIMEOUT_MS = 200

STORYBOARD_AGENT_CIRCUIT_BREAKER_ENABLED = os.getenv(
    "STORYBOARD_AGENT_CIRCUIT_BREAKER_ENABLED",
    "true",
).lower() in ("1", "true", "yes", "on")
STORYBOARD_AGENT_CIRCUIT_BREAKER_THRESHOLD = _env_int("STORYBOARD_AGENT_CIRCUIT_BREAKER_THRESHOLD", 3)
if STORYBOARD_AGENT_CIRCUIT_BREAKER_THRESHOLD <= 0:
    STORYBOARD_AGENT_CIRCUIT_BREAKER_THRESHOLD = 3
STORYBOARD_AGENT_CIRCUIT_BREAKER_RESET_SECONDS = _env_int("STORYBOARD_AGENT_CIRCUIT_BREAKER_RESET_SECONDS", 30)
if STORYBOARD_AGENT_CIRCUIT_BREAKER_RESET_SECONDS <= 0:
    STORYBOARD_AGENT_CIRCUIT_BREAKER_RESET_SECONDS = 30

_tool_circuit_failures: dict[str, int] = {}
_tool_circuit_open_until: dict[str, float] = {}


def _metrics_record_request(duration_ms: float, error_reason: str | None) -> None:
    global _metrics_requests_total
    global _metrics_requests_errors
    global _metrics_requests_latency_ms_sum
    global _metrics_requests_latency_ms_count
    with _metrics_lock:
        _metrics_requests_total += 1
        _metrics_requests_latency_ms_sum += duration_ms
        _metrics_requests_latency_ms_count += 1
        _metrics_request_latency_ms.append(duration_ms)
        if error_reason:
            _metrics_requests_errors += 1
            _metrics_request_error_reasons[error_reason] += 1


def _record_tool_circuit_open(tool_name: str) -> None:
    with _metrics_lock:
        _metrics_tool_circuit_opens[tool_name] += 1


def _metrics_record_fallback() -> None:
    global _metrics_fallback_total
    with _metrics_lock:
        _metrics_fallback_total += 1


def _percentile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    if q <= 0:
        return values[0]
    if q >= 1:
        return values[-1]

    idx = int((len(values) - 1) * q)
    return float(values[idx])


def _metrics_record_cache_hit(hit: bool) -> None:
    global _metrics_cache_hits
    global _metrics_cache_misses
    with _metrics_lock:
        if hit:
            _metrics_cache_hits += 1
        else:
            _metrics_cache_misses += 1


def _metrics_record_tool_call(tool_name: str, latency_ms: float, failed: bool) -> None:
    with _metrics_lock:
        _metrics_tool_calls[tool_name] += 1
        if failed:
            _metrics_tool_errors[tool_name] += 1
        _metrics_tool_latency_ms_sum[tool_name] += latency_ms
        _metrics_tool_latency_ms_count[tool_name] += 1
        _metrics_tool_latency_ms[tool_name].append(latency_ms)
        if latency_ms > _metrics_tool_latency_ms_max[tool_name]:
            _metrics_tool_latency_ms_max[tool_name] = latency_ms


def _metric_uptime_seconds() -> int:
    return max(0, int(time.time() - _boot_timestamp))


def _get_metrics_snapshot() -> dict[str, Any]:
    with _cache_lock:
        cache_size = len(_cache)

    with _metrics_lock:
        request_latencies = sorted(_metrics_request_latency_ms)
        tool_names = set(_metrics_tool_calls.keys()) | set(_metrics_tool_latency_ms_count.keys()) | set(_metrics_tool_errors.keys())
        tool_stats = []
        for name in sorted(tool_names):
            calls = _metrics_tool_calls[name]
            if calls <= 0:
                continue
            latencies = sorted(_metrics_tool_latency_ms[name])
            latency_sum = _metrics_tool_latency_ms_sum[name]
            latency_count = _metrics_tool_latency_ms_count[name]
            avg_ms = (latency_sum / latency_count) if latency_count else 0
            tool_stats.append(
                {
                    "name": name,
                    "calls": calls,
                    "errors": _metrics_tool_errors[name],
                    "avgLatencyMs": round(avg_ms, 2),
                    "maxLatencyMs": round(_metrics_tool_latency_ms_max[name], 2),
                    "p50LatencyMs": round(_percentile(latencies, 0.50), 2),
                    "p90LatencyMs": round(_percentile(latencies, 0.90), 2),
                    "p95LatencyMs": round(_percentile(latencies, 0.95), 2),
                    "circuitOpenCount": _metrics_tool_circuit_opens[name],
                }
            )

    request_count = _metrics_requests_total
    request_error_count = _metrics_requests_errors
    request_latency_count = _metrics_requests_latency_ms_count
    request_latency_sum = _metrics_requests_latency_ms_sum
    request_error_reasons = {
        reason: count
        for reason, count in sorted(_metrics_request_error_reasons.items(), key=lambda item: item[0])
    }
    request_avg_latency_ms = (request_latency_sum / request_latency_count) if request_latency_count else 0

    return {
        "service": "storyboard-agent",
        "uptimeSeconds": _metric_uptime_seconds(),
        "requests": {
            "total": request_count,
            "errors": request_error_count,
            "success": request_count - request_error_count,
            "fallbacks": _metrics_fallback_total,
            "inflight": len(_inflight_requests),
            "errorReasons": request_error_reasons,
            "cacheHits": _metrics_cache_hits,
            "cacheMisses": _metrics_cache_misses,
            "avgLatencyMs": round(request_avg_latency_ms, 2),
            "p50LatencyMs": round(_percentile(request_latencies, 0.50), 2),
            "p90LatencyMs": round(_percentile(request_latencies, 0.90), 2),
            "p95LatencyMs": round(_percentile(request_latencies, 0.95), 2),
        },
        "cache": {
            "size": cache_size,
            "maxEntries": CACHE_MAX_ENTRIES,
            "ttlSeconds": CACHE_TTL_SECONDS,
            "historySize": _metrics_history_size,
        },
        "tools": tool_stats,
    }


def _cache_get(cache_key: str) -> "StoryboardChatResponse | None":
    if CACHE_TTL_SECONDS <= 0:
        return None

    with _cache_lock:
        entry = _cache.get(cache_key)
        if not entry:
            _metrics_record_cache_hit(False)
            return None

        created_at, payload = entry
        now = datetime.now(timezone.utc).timestamp()
        if now - created_at > CACHE_TTL_SECONDS:
            _cache.pop(cache_key, None)
            _metrics_record_cache_hit(False)
            return None

        _cache.move_to_end(cache_key)
        _metrics_record_cache_hit(True)
        return payload


def _cache_set(cache_key: str, payload: "StoryboardChatResponse") -> None:
    if CACHE_MAX_ENTRIES <= 0:
        return
    with _cache_lock:
        if cache_key in _cache:
            _cache.pop(cache_key, None)
        elif CACHE_MAX_ENTRIES > 0 and len(_cache) >= CACHE_MAX_ENTRIES:
            _cache.popitem(last=False)

        _cache[cache_key] = (datetime.now(timezone.utc).timestamp(), payload)


def _resolve_environment() -> None:
    """Backward-compatible env mapping for existing repository variable names."""
    if not os.getenv("PUBLIC_SUPABASE_URL") and os.getenv("SUPABASE_URL"):
        os.environ["PUBLIC_SUPABASE_URL"] = os.getenv("SUPABASE_URL", "")

    if not os.getenv("PUBLIC_SUPABASE_SERVICE_ROLE_KEY") and os.getenv("SUPABASE_SERVICE_ROLE_KEY"):
        os.environ["PUBLIC_SUPABASE_SERVICE_ROLE_KEY"] = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

    if not os.getenv("SUPABASE_SERVICE_ROLE_KEY") and os.getenv("PUBLIC_SUPABASE_SERVICE_ROLE_KEY"):
        os.environ["SUPABASE_SERVICE_ROLE_KEY"] = os.getenv(
            "PUBLIC_SUPABASE_SERVICE_ROLE_KEY",
            "",
        )

    if not os.getenv("PUBLIC_OPENAI_API_KEY") and os.getenv("OPENAI_API_KEY"):
        os.environ["PUBLIC_OPENAI_API_KEY"] = os.getenv("OPENAI_API_KEY", "")

    if not os.getenv("OPENAI_API_KEY") and os.getenv("PUBLIC_OPENAI_API_KEY"):
        os.environ["OPENAI_API_KEY"] = os.getenv("PUBLIC_OPENAI_API_KEY", "")

    if not os.getenv("TAVILY_API_KEY") and os.getenv("PUBLIC_TAVILY_API_KEY"):
        os.environ["TAVILY_API_KEY"] = os.getenv("PUBLIC_TAVILY_API_KEY", "")

    if not os.getenv("PUBLIC_TAVILY_API_KEY") and os.getenv("TAVILY_API_KEY"):
        os.environ["PUBLIC_TAVILY_API_KEY"] = os.getenv("TAVILY_API_KEY", "")


def _load_tools_module():
    global _tools_module
    if _tools_module is not None:
        return _tools_module

    with _tools_lock:
        if _tools_module is not None:
            return _tools_module

        _resolve_environment()
        logger.info("Loading storyboard tools module.")

        try:
            from src import tools
        except Exception as exc:
            raise RuntimeError(f"스토리보드 도구 모듈을 불러오지 못했습니다: {exc}") from exc

        _tools_module = tools
        return tools

    return _tools_module


def _is_tool_open_for_requests(tool_name: str) -> bool:
    if not STORYBOARD_AGENT_CIRCUIT_BREAKER_ENABLED:
        return True

    now = time.time()
    with _tool_circuit_lock:
        open_until = _tool_circuit_open_until.get(tool_name)
        if open_until is None:
            return True
        if now >= open_until:
            _tool_circuit_open_until.pop(tool_name, None)
            _tool_circuit_failures[tool_name] = 0
            return True
        return False


def _mark_tool_success(tool_name: str) -> None:
    if not STORYBOARD_AGENT_CIRCUIT_BREAKER_ENABLED:
        return
    with _tool_circuit_lock:
        _tool_circuit_failures[tool_name] = 0


def _mark_tool_failure(tool_name: str) -> None:
    if not STORYBOARD_AGENT_CIRCUIT_BREAKER_ENABLED:
        return
    with _tool_circuit_lock:
        fail_count = _tool_circuit_failures.get(tool_name, 0) + 1
        _tool_circuit_failures[tool_name] = fail_count
        if fail_count >= STORYBOARD_AGENT_CIRCUIT_BREAKER_THRESHOLD:
            _tool_circuit_open_until[tool_name] = time.time() + STORYBOARD_AGENT_CIRCUIT_BREAKER_RESET_SECONDS
            _record_tool_circuit_open(tool_name)


def _invoke_tool(tool: Any, payload: dict[str, Any]) -> Any:
    started_at = time.perf_counter()
    tool_name = getattr(tool, "__name__", tool.__class__.__name__ if hasattr(tool, "__class__") else "tool")
    failed = False

    try:
        if not _is_tool_open_for_requests(tool_name):
            raise RuntimeError(f"Tool circuit open: {tool_name}")
        if hasattr(tool, "invoke"):
            return tool.invoke(payload)
        if callable(tool):
            return tool(**payload)
        raise RuntimeError("Tool is not callable.")
    except Exception:
        failed = True
        _mark_tool_failure(tool_name)
        raise
    finally:
        if not failed:
            _mark_tool_success(tool_name)
        elapsed_ms = (time.perf_counter() - started_at) * 1000
        _metrics_record_tool_call(tool_name, elapsed_ms, failed)


def _parse_text(value: Any, max_len: int = 220) -> str:
    if value is None:
        return "-"
    text = str(value).strip().replace("\n", " ")
    if len(text) <= max_len:
        return text
    return f"{text[: max_len].rstrip()}..."


def _parse_timestamp(value: Any) -> str:
    if value is None:
        return "-"
    try:
        total_sec = int(float(value))
    except (TypeError, ValueError):
        return "-"

    if total_sec < 0:
        total_sec = 0

    mins, secs = divmod(total_sec, 60)
    hrs, mins = divmod(mins, 60)
    if hrs > 0:
        return f"{hrs:02d}:{mins:02d}:{secs:02d}"
    return f"{mins:02d}:{secs:02d}"


def _to_seconds_range(start: Any, end: Any) -> str:
    start_sec = _parse_timestamp(start)
    end_sec = _parse_timestamp(end)
    return f"{start_sec} ~ {end_sec}"


def _extract_caption(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return _parse_text(value, 300)
    if isinstance(value, list):
        chunks = []
        for item in value[:3]:
            if isinstance(item, dict):
                for key in ("caption", "text", "content", "summary"):
                    if key in item and item[key]:
                        chunks.append(str(item[key]).strip())
                        break
            elif isinstance(item, str):
                chunks.append(item.strip())
        return _parse_text(" | ".join([chunk for chunk in chunks if chunk]), 300)
    if isinstance(value, dict):
        for key in ("caption", "text", "content", "summary"):
            if isinstance(value.get(key), str):
                return _parse_text(value[key], 300)
    return ""


def _normalize_query(message: str) -> str:
    return message.lower().strip()


def _extract_video_ids(payload: Any) -> list[str]:
    if not isinstance(payload, dict):
        return []

    data = payload.get("video_ids")
    if isinstance(data, list):
        return [str(item["video_id"]) if isinstance(item, dict) and item.get("video_id") else str(item) for item in data]

    data = payload.get("data")
    if isinstance(data, list):
        return [str(item["video_id"]) if isinstance(item, dict) and item.get("video_id") else str(item) for item in data]

    return []


def _extract_transcripts(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        return []
    data = payload.get("transcripts")
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    return []


def _build_storyboard_content(query: str, transcripts: list[dict[str, Any]]) -> str:
    if not transcripts:
        return (
            f"요청하신 `{query}`에 대한 스토리보드 후보를 DB에서 바로 찾지 못했습니다.\n\n"
            "아래를 확인해 주세요.\n\n"
            "1) 키워드(메뉴, 메뉴명, 분위기, 장소명)를 더 구체적으로 입력\n"
            "2) 샷 구성(인사/메뉴 소개/반응/클로징)처럼 단계별로 질문\n"
            "3) 필요 시 내부/외부 검색이 가능한 형태로 재요청"
        )

    lines: list[str] = [
        f"요청하신 **`{query}`** 기준으로 추천한 스토리보드 초안입니다.",
        "",
        "## 추천 씬 구성",
    ]

    for idx, doc in enumerate(transcripts[:5], start=1):
        page_content = _parse_text(doc.get("page_content", ""), 180)
        metadata = doc.get("metadata", {}) if isinstance(doc.get("metadata"), dict) else {}
        title = (
            metadata.get("video_title")
            or metadata.get("title")
            or "참고 영상"
        )
        time_range = _to_seconds_range(metadata.get("start_time"), metadata.get("end_time"))
        caption = _extract_caption(metadata.get("caption"))
        direction = caption or "특징이 뚜렷한 샷으로 빠른 컷 전환 권장"
        visual = (
            f"- 시각 연출: {direction}"
        )
        script = f"- 대사/자막: {page_content}"
        lines.extend(
            [
                f"### 씬 {idx}: `{title}`",
                f"- 구간: {time_range}",
                visual,
                script,
                "",
            ]
        )

    lines.extend(
        [
            "## 촬영 흐름 체크리스트",
            "- 오프닝 3초: 훅이 되는 먹기 반응 또는 메뉴 클로즈업",
            "- 인터미션: 메뉴의 특징 1개를 강하게 텍스트 오버랩",
            "- 클로징: 리액션 마무리 + 다음 컷 예고 문구",
        ]
    )
    return "\n".join(lines)


def _build_sources(transcripts: list[dict[str, Any]]) -> list[dict[str, str]]:
    sources = []
    for item in transcripts:
        metadata = item.get("metadata", {}) if isinstance(item.get("metadata"), dict) else {}
        video_id = item.get("video_id") or metadata.get("video_id") or ""
        video_title = (
            metadata.get("video_title")
            or metadata.get("title")
            or "스토리보드 참고 소스"
        )
        raw_link = metadata.get("youtube_url") or metadata.get("youtubeLink")
        if raw_link:
            youtube_link = str(raw_link).strip()
        else:
            youtube_link = f"https://www.youtube.com/watch?v={video_id}" if video_id else ""

        timestamp = _to_seconds_range(metadata.get("start_time"), metadata.get("end_time"))
        text = _parse_text(
            metadata.get("caption")
            or item.get("page_content")
            or metadata.get("snippet")
            or "",
            220,
        )

        sources.append(
            {
                "videoTitle": video_title,
                "youtubeLink": youtube_link,
                "timestamp": timestamp,
                "text": text,
            }
        )

    return sources[:6]


class StoryboardChatRequest(BaseModel):
    message: str
    role: str | None = None
    channel: str | None = None

    @field_validator("message")
    @classmethod
    def normalize_message(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("message는 비어 있을 수 없습니다.")
        return normalized


class StoryboardChatSource(BaseModel):
    videoTitle: str
    youtubeLink: str
    timestamp: str
    text: str


class StoryboardChatResponse(BaseModel):
    asOf: str
    content: str
    sources: list[StoryboardChatSource]
    visualComponent: str | None = None


def _build_fallback(message: str, message_for_user: str, sources: list[dict[str, str]]) -> StoryboardChatResponse:
    return StoryboardChatResponse(
        asOf=datetime.now(timezone.utc).isoformat(),
        content=_build_storyboard_content(message_for_user, []),
        sources=[StoryboardChatSource(**item) for item in sources],
        visualComponent=None,
    )


def _prepare_response(message: str, cache_key: str) -> StoryboardChatResponse:
    try:
        tools = _load_tools_module()

        try_transcripts_payload = _invoke_tool(
            tools.search_transcripts_hybrid,
            {"query": message, "intent": "storyboard", "match_count": 15, "mmr_k": 8, "rerank_top_k": 5},
        )
        transcripts = _extract_transcripts(try_transcripts_payload)

        if not transcripts:
            fallback_ids_payload = _invoke_tool(
                tools.search_video_ids_by_query,
                {"query": message, "match_count": 12},
            )
            video_ids = _extract_video_ids(fallback_ids_payload)
            if video_ids:
                fallback_payload = _invoke_tool(
                    tools.search_transcripts_hybrid,
                    {
                        "query": message,
                        "video_ids": video_ids[:12],
                        "intent": "storyboard",
                        "match_count": 15,
                        "mmr_k": 8,
                        "rerank_top_k": 5,
                    },
                )
                transcripts = _extract_transcripts(fallback_payload)

        content = _build_storyboard_content(message, transcripts)
        sources = _build_sources(transcripts)

        response = StoryboardChatResponse(
            asOf=datetime.now(timezone.utc).isoformat(),
            content=content,
            sources=[StoryboardChatSource(**item) for item in sources],
            visualComponent=None,
        )
        _cache_set(cache_key, response)
        return response
    except RuntimeError as exc:
        logger.warning("스토리보드 도구 로드 실패: %s", exc)
        _metrics_record_fallback()
        response = _build_fallback(
            message,
            message,
            [],
        )
        _cache_set(cache_key, response)
        return response
    except Exception as exc:
        logger.exception("스토리보드 응답 생성 실패: %s", exc)
        _metrics_record_fallback()
        response = _build_fallback(
            message,
            message,
            [],
        )
        _cache_set(cache_key, response)
        return response


async def _prepare_response_async(message: str) -> StoryboardChatResponse:
    cache_key = _normalize_query(message)
    started_at = time.perf_counter()
    error_reason: str | None = None
    response: StoryboardChatResponse | None = None
    is_leader = False
    future: asyncio.Future[StoryboardChatResponse] | None = None

    cached = _cache_get(cache_key)
    if cached is not None:
        _metrics_record_request((time.perf_counter() - started_at) * 1000, None)
        return cached

    loop = asyncio.get_running_loop()
    async with _inflight_lock:
        existing = _inflight_requests.get(cache_key)
        if existing is not None:
            future = existing
        else:
            future = loop.create_future()
            _inflight_requests[cache_key] = future
            is_leader = True

    try:
        if is_leader:
            try:
                response = await asyncio.wait_for(
                    asyncio.to_thread(_prepare_response, message, cache_key),
                    timeout=STORYBOARD_AGENT_REQUEST_TIMEOUT_MS / 1000,
                )
                if future and not future.done():
                    future.set_result(response)
            except asyncio.TimeoutError:
                response = _build_fallback(message, message, [])
                _metrics_record_fallback()
                error_reason = "timeout"
                if future and not future.done():
                    future.set_result(response)
            except Exception as exc:
                logger.exception("Storyboard chat failed: %s", exc)
                response = _build_fallback(message, message, [])
                _metrics_record_fallback()
                error_reason = exc.__class__.__name__
                if future and not future.done():
                    future.set_result(response)
            finally:
                _cache_set(cache_key, response if response else _build_fallback(message, message, []))

            return response

        if future is None:
            response = _build_fallback(message, message, [])
            error_reason = "missing_future"
            return response

        return await future
    except Exception as exc:
        if error_reason is None:
            error_reason = exc.__class__.__name__
        logger.exception("Storyboard chat async failure: %s", exc)
        fallback = _build_fallback(message, message, [])
        _metrics_record_fallback()
        _cache_set(cache_key, fallback)
        if future is not None and not future.done():
            future.set_result(fallback)
        return fallback
    finally:
        if is_leader:
            async with _inflight_lock:
                _inflight_requests.pop(cache_key, None)
        _metrics_record_request((time.perf_counter() - started_at) * 1000, error_reason)



app = FastAPI(
    title="Tzuyang Storyboard Agent",
    description="Admin insight storyboard assistant API",
    version="1.0.0",
)


@app.on_event("startup")
async def _startup() -> None:
    if TOOL_PREWARM:
        try:
            await asyncio.to_thread(_load_tools_module)
            logger.info("Storyboard tools preloaded.")
        except Exception as exc:
            logger.warning("Tools preload failed: %s", exc)


@app.get("/health")
def health():
    return {"ok": True, "service": "storyboard-agent"}


@app.get("/metrics")
def metrics():
    return _get_metrics_snapshot()


@app.get("/")
def root():
    return {"service": "storyboard-agent", "chat_path": "/chat", "health_path": "/health"}


@app.post("/chat", response_model=StoryboardChatResponse)
async def chat(payload: StoryboardChatRequest):
    return await _prepare_response_async(payload.message)


if __name__ == "__main__":
    host = os.getenv("STORYBOARD_AGENT_HOST", "0.0.0.0")
    port = int(os.getenv("STORYBOARD_AGENT_PORT", "8001"))
    reload = os.getenv("STORYBOARD_AGENT_RELOAD", "false").lower() in ("1", "true", "yes")
    log_level = os.getenv("STORYBOARD_AGENT_LOG_LEVEL", "info")
    logging.basicConfig(level=log_level.upper())

    uvicorn.run(
        "src.server:app",
        host=host,
        port=port,
        reload=reload,
        log_level=log_level,
        app_dir=str(Path(__file__).resolve().parents[1]),
    )
