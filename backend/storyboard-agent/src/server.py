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
import json
import urllib.error
import urllib.parse
import urllib.request
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Literal

from fastapi import FastAPI
from pydantic import BaseModel
from pydantic import field_validator
import uvicorn
from dotenv import load_dotenv


logger = logging.getLogger(__name__)


def _load_dotenv():
    env_candidates = (
        Path(__file__).resolve().parents[1] / ".env",
        Path(__file__).resolve().parents[1] / ".env.local",
        Path(__file__).resolve().parents[2] / ".env",
        Path(__file__).resolve().parents[2] / ".env.local",
    )

    for env_path in env_candidates:
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


def _env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _ensure_positive(name: str, value: int, fallback: int) -> int:
    if value > 0:
        return value
    logger.warning("Invalid non-positive value for %s, fallback: %s", name, fallback)
    return fallback


CACHE_TTL_SECONDS = _env_int("STORYBOARD_AGENT_CACHE_TTL_SECONDS", 120)
CACHE_MAX_ENTRIES = _ensure_positive(
    "STORYBOARD_AGENT_CACHE_MAX_ENTRIES",
    _env_int("STORYBOARD_AGENT_CACHE_MAX_ENTRIES", 200),
    200,
)
TOOL_PREWARM = _env_bool("STORYBOARD_AGENT_PREWARM", False)

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

STORYBOARD_AGENT_LLM_MODEL = (
    os.getenv("STORYBOARD_AGENT_LLM_MODEL", "gemini-3-flash-preview").strip()
    or "gemini-3-flash-preview"
)
STORYBOARD_AGENT_LLM_TIMEOUT_MS = _env_int(
    "STORYBOARD_AGENT_LLM_TIMEOUT_MS",
    STORYBOARD_AGENT_REQUEST_TIMEOUT_MS,
)
if STORYBOARD_AGENT_LLM_TIMEOUT_MS < 200:
    STORYBOARD_AGENT_LLM_TIMEOUT_MS = 200
STORYBOARD_AGENT_USE_LLM = _env_bool("STORYBOARD_AGENT_USE_LLM", True)
STORYBOARD_AGENT_GEMINI_API_KEY = (
    os.getenv("STORYBOARD_AGENT_GEMINI_API_KEY")
    or os.getenv("GEMINI_API_KEY")
    or os.getenv("GOOGLE_API_KEY")
    or os.getenv("NEXT_PUBLIC_GOOGLE_API_KEY")
    or ""
)
STORYBOARD_AGENT_NANO_BANANA_MODEL = (
    os.getenv("STORYBOARD_AGENT_NANO_BANANA_MODEL")
    or os.getenv("NANO_BANANA_MODEL")
    or "gemini-2.5-flash-preview"
).strip()
STORYBOARD_AGENT_NANO_BANANA_PRO_MODEL = (
    os.getenv("STORYBOARD_AGENT_NANO_BANANA_PRO_MODEL")
    or os.getenv("NANO_BANANA_PRO_MODEL")
    or "gemini-2.5-pro-preview"
).strip()
STORYBOARD_AGENT_MODEL_FALLBACK = (
    os.getenv("STORYBOARD_AGENT_MODEL_FALLBACK")
    or STORYBOARD_AGENT_NANO_BANANA_MODEL
).strip()

STORYBOARD_AGENT_BMAD_ENABLED = _env_bool("STORYBOARD_AGENT_BMAD_ENABLED", True)
STORYBOARD_AGENT_DEFAULT_PROFILE = (
    os.getenv("STORYBOARD_AGENT_DEFAULT_PROFILE", "nanobanana").strip()
    or "nanobanana"
)
STORYBOARD_AGENT_BMAD_MAX_AGENTS = _ensure_positive(
    "STORYBOARD_AGENT_BMAD_MAX_AGENTS",
    _env_int("STORYBOARD_AGENT_BMAD_MAX_AGENTS", 3),
    3,
)
STORYBOARD_AGENT_MAX_RESEARCH_QUERIES = _ensure_positive(
    "STORYBOARD_AGENT_MAX_RESEARCH_QUERIES",
    _env_int("STORYBOARD_AGENT_MAX_RESEARCH_QUERIES", 3),
    3,
)
STORYBOARD_AGENT_BMAD_TRANSCRIPT_LIMIT = _ensure_positive(
    "STORYBOARD_AGENT_BMAD_TRANSCRIPT_LIMIT",
    _env_int("STORYBOARD_AGENT_BMAD_TRANSCRIPT_LIMIT", 12),
    12,
)

STORYBOARD_AGENT_CIRCUIT_BREAKER_ENABLED = _env_bool("STORYBOARD_AGENT_CIRCUIT_BREAKER_ENABLED", True)
STORYBOARD_AGENT_CIRCUIT_BREAKER_THRESHOLD = _ensure_positive(
    "STORYBOARD_AGENT_CIRCUIT_BREAKER_THRESHOLD",
    _env_int("STORYBOARD_AGENT_CIRCUIT_BREAKER_THRESHOLD", 3),
    3,
)
STORYBOARD_AGENT_CIRCUIT_BREAKER_RESET_SECONDS = _ensure_positive(
    "STORYBOARD_AGENT_CIRCUIT_BREAKER_RESET_SECONDS",
    _env_int("STORYBOARD_AGENT_CIRCUIT_BREAKER_RESET_SECONDS", 30),
    30,
)

_tool_circuit_failures: dict[str, int] = {}
_tool_circuit_open_until: dict[str, float] = {}

StoryboardModelProfile = Literal["nanobanana", "nanobanana_pro"]


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


def _normalize_storyboard_profile(profile: str | None) -> StoryboardModelProfile:
    if profile == "nanobanana_pro":
        return "nanobanana_pro"
    if profile == "nanobanana":
        return "nanobanana"

    fallback = STORYBOARD_AGENT_DEFAULT_PROFILE.strip().lower()
    if fallback == "nanobanana_pro":
        return "nanobanana_pro"
    return "nanobanana"


def _resolve_storyboard_model(profile: StoryboardModelProfile | None) -> str:
    return (
        STORYBOARD_AGENT_NANO_BANANA_PRO_MODEL
        if profile == "nanobanana_pro"
        else STORYBOARD_AGENT_NANO_BANANA_MODEL
    )


def _build_storyboard_prompt(
    query: str,
    transcripts: list[dict[str, Any]],
    planning_notes: dict[str, Any] | None,
) -> str:
    lines = [
        "너는 먹방/맛집 콘텐츠를 위한 실전형 촬영 스토리보드 조수야.",
        "사용자 질문 기반으로 구체적인 장면 흐름, 카메라 연출, 멘트/타이밍 아이디어를 한국어로 작성해.",
        "근거는 아래 검색된 장면 단락만 사용해 과장 없이 실무적으로 정리해.",
        "",
        f"질문: {query}",
        "",
        "검색 근거(최대 8개):",
    ]

    if planning_notes:
        intent_summary = planning_notes.get("intent_summary")
        focus = planning_notes.get("focus") or []
        if intent_summary:
            lines.append(f"- 요청 요약: {intent_summary}")
        if focus:
            lines.append(f"- 집중 키워드: {', '.join(focus[:3])}")

    for idx, doc in enumerate(transcripts[:8], start=1):
        metadata = doc.get("metadata", {}) if isinstance(doc.get("metadata"), dict) else {}
        title = metadata.get("video_title") or metadata.get("title") or "참고 영상"
        time_range = _to_seconds_range(metadata.get("start_time"), metadata.get("end_time"))
        caption = _extract_caption(metadata.get("caption"))
        text = _parse_text(doc.get("page_content", ""), 180)
        lines.append(f"{idx}. [{title}] {time_range} - {caption or text}")

    lines.extend(
        [
            "",
            "요청사항:",
            "- Markdown 형식 사용",
            "- 씬별로 제목(### 씬 1...)과 핵심 포인트를 2~3줄 내외로 정리",
            "- 시각 연출, 멘트/카메라, 체크리스트 섹션 반드시 포함",
            "- 허위나 과도한 수치/추정을 금지하고, 근거 없는 장면 디테일은 추측하지 말 것",
            "",
            "출력 형식:",
            "- ## 추천 씬 구성",
            "- ## 촬영 흐름 체크리스트",
            "- 필요 시 마지막에 ## 참고 포인트",
        ],
    )

    return "\n".join(lines)


def _build_storyboard_plan(message: str) -> dict[str, Any]:
    cleaned = message.strip()
    base = cleaned.lower()
    focus_words = [part for part in re.split(r"[\s,，/.!?()]+", base) if len(part) > 1]

    focus_candidates = []
    for token in focus_words:
        trimmed = token.strip()
        if trimmed and len(trimmed) > 1 and trimmed not in focus_candidates:
            focus_candidates.append(trimmed)
        if len(focus_candidates) >= 6:
            break

    queries: list[str] = []
    if cleaned:
        queries.append(cleaned)
        if "먹방" not in base:
            queries.append(f"{cleaned} 먹방 스토리보드")
        if "연출" not in base:
            queries.append(f"{cleaned} 촬영 연출")
        for token in focus_candidates[:2]:
            queries.append(f"{token} 씬 구성")
            queries.append(f"{token} 촬영")

    deduped = []
    for query in queries:
        normalized = query.strip()
        if normalized and normalized not in deduped:
            deduped.append(normalized)
    deduped = deduped[:STORYBOARD_AGENT_MAX_RESEARCH_QUERIES]

    if not deduped:
        deduped = [message.strip()]

    return {
        "intent_summary": _parse_text(cleaned, 120),
        "focus": focus_candidates[:3],
        "queries": deduped,
    }


def _storyboard_transcript_key(doc: dict[str, Any]) -> str:
    metadata = doc.get("metadata", {})
    video_id = doc.get("video_id") or metadata.get("video_id") or "-"
    start_time = metadata.get("start_time")
    end_time = metadata.get("end_time")
    if start_time is None or end_time is None:
        fallback_text = _parse_text(doc.get("page_content", ""), 48)
        return f"{video_id}:{fallback_text}"
    return f"{video_id}:{start_time}:{end_time}"


def _search_storyboard_by_query(
    tools: Any,
    query: str,
    query_position: int,
) -> list[tuple[dict[str, Any], int]]:
    try:
        payload = _invoke_tool(
            tools.search_transcripts_hybrid,
            {
                "query": query,
                "intent": "storyboard",
                "match_count": STORYBOARD_AGENT_BMAD_TRANSCRIPT_LIMIT * 4,
                "mmr_k": max(4, STORYBOARD_AGENT_BMAD_TRANSCRIPT_LIMIT + 2),
                "rerank_top_k": max(4, STORYBOARD_AGENT_BMAD_TRANSCRIPT_LIMIT),
            },
        )
        transcripts = _extract_transcripts(payload)
    except Exception:
        logger.debug("Storyboard query search failed: %s", query)
        return []

    output = []
    for rank, doc in enumerate(transcripts):
        if not isinstance(doc, dict):
            continue
        normalized = dict(doc)
        metadata = normalized.get("metadata", {})
        if not isinstance(metadata, dict):
            metadata = {}
            normalized["metadata"] = metadata
        is_peak = bool(metadata.get("is_peak"))
        text = normalized.get("page_content", "")
        score = (STORYBOARD_AGENT_MAX_RESEARCH_QUERIES - query_position) * 14
        score += max(0, 12 - rank)
        score += len(str(text)) / 120.0
        if is_peak:
            score += 10
        normalized["__searchScore"] = score
        normalized["__queryWeight"] = query_position
        output.append((normalized, int(query_position)))
    return output


def _research_storyboard_transcripts(
    message: str,
    planning_notes: dict[str, Any],
) -> list[dict[str, Any]]:
    planning_notes_queries = planning_notes.get("queries", [])
    queries = [str(item).strip() for item in planning_notes_queries if isinstance(item, str) and item.strip()]
    if not queries:
        queries = [message]

    queries = queries[:STORYBOARD_AGENT_MAX_RESEARCH_QUERIES]

    tools = _load_tools_module()
    merged: dict[str, dict[str, Any]] = {}
    max_workers = min(len(queries), max(1, STORYBOARD_AGENT_BMAD_MAX_AGENTS))

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_map = {
            executor.submit(_search_storyboard_by_query, tools, query, idx): idx
            for idx, query in enumerate(queries)
        }
        for future in as_completed(future_map):
            try:
                results = future.result(timeout=max(1, STORYBOARD_AGENT_REQUEST_TIMEOUT_MS / 1000))
            except Exception:
                logger.debug("Storyboard planner/research task failed: %s", future_map[future])
                continue
            for item, query_position in results:
                key = _storyboard_transcript_key(item)
                existing = merged.get(key)
                if existing is None:
                    merged[key] = item
                    continue
                current_score = item.get("__searchScore", 0)
                existing_score = existing.get("__searchScore", 0)
                if current_score > existing_score or (
                    current_score == existing_score
                    and query_position
                    < existing.get("__queryWeight", query_position)
                ):
                    merged[key] = item

    if not merged:
        try:
            fallback_ids_payload = _invoke_tool(
                tools.search_video_ids_by_query,
                {"query": message, "match_count": 12},
            )
            fallback_ids = _extract_video_ids(fallback_ids_payload)
            if fallback_ids:
                try:
                    fallback_payload = _invoke_tool(
                        tools.search_transcripts_hybrid,
                        {
                            "query": message,
                            "video_ids": fallback_ids[:12],
                            "intent": "storyboard",
                            "match_count": 15,
                            "mmr_k": 8,
                            "rerank_top_k": 5,
                        },
                    )
                    fallback_transcripts = _extract_transcripts(fallback_payload)
                    for doc in fallback_transcripts:
                        if not isinstance(doc, dict):
                            continue
                        key = _storyboard_transcript_key(doc)
                        if key not in merged:
                            normalized = dict(doc)
                            normalized["__searchScore"] = 0
                            merged[key] = normalized
                except Exception:
                    logger.debug("Storyboard fallback transcript search failed.")
        except Exception:
            logger.debug("Storyboard fallback video-id search failed.")

    ranked = sorted(
        merged.values(),
        key=lambda d: (
            float(d.get("__searchScore", 0)),
            1 if (d.get("metadata") or {}).get("is_peak") else 0,
        ),
        reverse=True,
    )
    return ranked[:STORYBOARD_AGENT_BMAD_TRANSCRIPT_LIMIT * 2]


def _is_valid_storyboard_output(content: str | None) -> bool:
    if not content:
        return False
    normalized = content.strip()
    if len(normalized) < 260:
        return False
    return (
        "## 추천 씬 구성" in normalized
        or "### 씬" in normalized
    ) and "## 촬영 흐름 체크리스트" in normalized


def _build_storyboard_content(
    query: str,
    transcripts: list[dict[str, Any]],
    storyboard_profile: StoryboardModelProfile | None = None,
    planning_notes: dict[str, Any] | None = None,
) -> str:
    if not transcripts:
        return (
            f"요청하신 `{query}`에 대한 스토리보드 후보를 DB에서 바로 찾지 못했습니다.\n\n"
            "아래를 확인해 주세요.\n\n"
            "1) 키워드(메뉴, 메뉴명, 분위기, 장소명)를 더 구체적으로 입력\n"
            "2) 샷 구성(인사/메뉴 소개/반응/클로징)처럼 단계별로 질문\n"
            "3) 필요 시 내부/외부 검색이 가능한 형태로 재요청"
        )

    prompt = _build_storyboard_prompt(query, transcripts, planning_notes)
    generated = _generate_storyboard_from_llm(prompt, storyboard_profile)
    if _is_valid_storyboard_output(generated):
        return generated

    return _build_storyboard_content_fallback(query, transcripts)


def _prepare_storyboard_content(
    query: str,
    profile: StoryboardModelProfile | None,
) -> tuple[list[dict[str, Any]], str]:
    planning_notes = _build_storyboard_plan(query)
    transcripts = _research_storyboard_transcripts(query, planning_notes)
    content = _build_storyboard_content(query, transcripts, profile, planning_notes)
    return transcripts, content


def _call_gemini_storyboard_model(prompt: str, model_name: str | None = None) -> str | None:
    selected_model = (model_name or STORYBOARD_AGENT_LLM_MODEL).strip() or STORYBOARD_AGENT_LLM_MODEL

    if not STORYBOARD_AGENT_USE_LLM:
        return None

    if not STORYBOARD_AGENT_GEMINI_API_KEY.strip():
        logger.warning("Gemini API key not found. Skip LLM generation and fallback.")
        return None

    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{urllib.parse.quote(selected_model, safe='.-_')}:generateContent"
    query = urllib.parse.urlencode({"key": STORYBOARD_AGENT_GEMINI_API_KEY.strip()})
    url = f"{endpoint}?{query}"
    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": prompt,
                    },
                ],
            },
        ],
        "generationConfig": {
            "temperature": 0.35,
            "topP": 0.95,
            "maxOutputTokens": 2200,
        },
    }

    request = urllib.request.Request(
        url,
        method="POST",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
        },
    )

    started_at = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=STORYBOARD_AGENT_LLM_TIMEOUT_MS / 1000) as response:
            raw = response.read().decode("utf-8")
            body = json.loads(raw)
            _metrics_record_tool_call("gemini_generate", (time.perf_counter() - started_at) * 1000, False)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8") if exc.fp else ""
        logger.error("Gemini HTTP error [%s]: %s", exc.code, raw)
        _metrics_record_tool_call("gemini_generate", (time.perf_counter() - started_at) * 1000, True)
        return None
    except Exception:
        logger.exception("Gemini request failed")
        _metrics_record_tool_call("gemini_generate", (time.perf_counter() - started_at) * 1000, True)
        return None

    candidates = (
        body.get("candidates")
        if isinstance(body, dict)
        else None
    )
    if not isinstance(candidates, list) or not candidates:
        logger.warning("Gemini response has no candidates.")
        return None

    first = candidates[0]
    content = first.get("content") if isinstance(first, dict) else None
    parts = content.get("parts") if isinstance(content, dict) else None
    if isinstance(parts, list):
        for part in parts:
            text = part.get("text") if isinstance(part, dict) else None
            if isinstance(text, str) and text.strip():
                return text.strip()

    logger.warning("Gemini response parsing failed.")
    return None


def _generate_storyboard_from_llm(
    prompt: str,
    storyboard_profile: StoryboardModelProfile | None,
) -> str | None:
    return _call_gemini_storyboard_model(prompt, _resolve_storyboard_model(storyboard_profile))


def _build_storyboard_content_fallback(query: str, transcripts: list[dict[str, Any]]) -> str:
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
    imageModelProfile: StoryboardModelProfile | None = None
    storyboardModelProfile: StoryboardModelProfile | None = None

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


def _build_fallback(
    message: str,
    message_for_user: str,
    sources: list[dict[str, str]],
    storyboard_model_profile: StoryboardModelProfile | None = None,
) -> StoryboardChatResponse:
    return StoryboardChatResponse(
        asOf=datetime.now(timezone.utc).isoformat(),
        content=_build_storyboard_content(message_for_user, [], storyboard_model_profile),
        sources=[StoryboardChatSource(**item) for item in sources],
        visualComponent=None,
    )


def _prepare_response(
    message: str,
    cache_key: str,
    storyboard_model_profile: StoryboardModelProfile | None = None,
) -> StoryboardChatResponse:
    normalized_profile = _normalize_storyboard_model(storyboard_model_profile)
    try:
        if STORYBOARD_AGENT_BMAD_ENABLED:
            transcripts, content = _prepare_storyboard_content(message, normalized_profile)
        else:
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

            content = _build_storyboard_content(message, transcripts, normalized_profile)

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
            normalized_profile,
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
            normalized_profile,
        )
        _cache_set(cache_key, response)
        return response


async def _prepare_response_async(
    message: str,
    storyboard_model_profile: StoryboardModelProfile | None = None,
) -> StoryboardChatResponse:
    normalized_profile = _normalize_storyboard_model(storyboard_model_profile)
    cache_key = f"{_normalize_query(message)}|{normalized_profile}"
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
                    asyncio.to_thread(_prepare_response, message, cache_key, normalized_profile),
                    timeout=STORYBOARD_AGENT_REQUEST_TIMEOUT_MS / 1000,
                )
                if future and not future.done():
                    future.set_result(response)
            except asyncio.TimeoutError:
                response = _build_fallback(message, message, [], normalized_profile)
                _metrics_record_fallback()
                error_reason = "timeout"
                if future and not future.done():
                    future.set_result(response)
            except Exception as exc:
                logger.exception("Storyboard chat failed: %s", exc)
                response = _build_fallback(message, message, [], normalized_profile)
                _metrics_record_fallback()
                error_reason = exc.__class__.__name__
                if future and not future.done():
                    future.set_result(response)
            finally:
                _cache_set(cache_key, response if response else _build_fallback(message, message, [], normalized_profile))

            return response

        if future is None:
            response = _build_fallback(message, message, [], normalized_profile)
            error_reason = "missing_future"
            return response

        return await future
    except Exception as exc:
        if error_reason is None:
            error_reason = exc.__class__.__name__
        logger.exception("Storyboard chat async failure: %s", exc)
        fallback = _build_fallback(message, message, [], normalized_profile)
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
    requested_profile = payload.imageModelProfile or payload.storyboardModelProfile
    return await _prepare_response_async(payload.message, requested_profile)


if __name__ == "__main__":
    host = os.getenv("STORYBOARD_AGENT_HOST", "0.0.0.0")
    port = int(os.getenv("STORYBOARD_AGENT_PORT", "8001"))
    reload = _env_bool("STORYBOARD_AGENT_RELOAD", False)
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
