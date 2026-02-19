"""FastAPI server for the storyboard agent."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel
from pydantic import field_validator
import uvicorn


def _resolve_environment() -> None:
    """Backward-compatible env mapping for existing repository variable names."""
    if not os.getenv("PUBLIC_SUPABASE_URL") and os.getenv("SUPABASE_URL"):
        os.environ["PUBLIC_SUPABASE_URL"] = os.getenv("SUPABASE_URL", "")

    if not os.getenv("SUPABASE_SERVICE_ROLE_KEY") and os.getenv("PUBLIC_SUPABASE_SERVICE_ROLE_KEY"):
        os.environ["SUPABASE_SERVICE_ROLE_KEY"] = os.getenv(
            "PUBLIC_SUPABASE_SERVICE_ROLE_KEY",
            "",
        )


def _load_tools_module():
    _resolve_environment()

    try:
        from src import tools
    except Exception as exc:
        raise RuntimeError(f"스토리보드 도구 모듈을 불러오지 못했습니다: {exc}") from exc

    return tools


def _invoke_tool(tool: Any, payload: dict[str, Any]) -> Any:
    if hasattr(tool, "invoke"):
        return tool.invoke(payload)
    if callable(tool):
        return tool(**payload)
    raise RuntimeError("Tool is not callable.")


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


def _prepare_response(message: str) -> StoryboardChatResponse:
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

        return StoryboardChatResponse(
            asOf=datetime.now(timezone.utc).isoformat(),
            content=content,
            sources=[StoryboardChatSource(**item) for item in sources],
            visualComponent=None,
        )
    except RuntimeError:
        return _build_fallback(
            message,
            message,
            [],
        )
    except Exception:
        return _build_fallback(
            message,
            message,
            [],
        )


app = FastAPI(
    title="Tzuyang Storyboard Agent",
    description="Admin insight storyboard assistant API",
    version="1.0.0",
)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/chat", response_model=StoryboardChatResponse)
def chat(payload: StoryboardChatRequest):
    return _prepare_response(payload.message)


if __name__ == "__main__":
    host = os.getenv("STORYBOARD_AGENT_HOST", "0.0.0.0")
    port = int(os.getenv("STORYBOARD_AGENT_PORT", "8001"))
    reload = os.getenv("STORYBOARD_AGENT_RELOAD", "false").lower() in ("1", "true", "yes")
    log_level = os.getenv("STORYBOARD_AGENT_LOG_LEVEL", "info")

    uvicorn.run(
        "src.server:app",
        host=host,
        port=port,
        reload=reload,
        log_level=log_level,
        app_dir=str(Path(__file__).resolve().parents[1]),
    )
