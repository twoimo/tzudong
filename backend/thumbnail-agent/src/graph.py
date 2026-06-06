"""Thumbnail backend agent LangGraph.

This graph is intentionally orchestration-only: it plans concept/layout/review
metadata for the web provider layer. Actual image generation remains in the
Next.js `openai-gpt-image` provider so exact `gpt-image-2` provenance is not
blurred by a backend command.
"""

from __future__ import annotations

from typing import Any, TypedDict

from langgraph.graph import END, START, StateGraph


class ThumbnailAgentState(TypedDict, total=False):
    request: dict[str, Any]
    referenceImages: list[dict[str, Any]]
    basePrompt: str
    concept: str
    layoutBrief: str
    promptAddendum: str
    safetyReview: str
    nextActions: list[str]
    warnings: list[str]
    diagnostics: dict[str, Any]


def _request(state: ThumbnailAgentState) -> dict[str, Any]:
    request = state.get("request")
    return request if isinstance(request, dict) else {}


def _references(state: ThumbnailAgentState) -> list[dict[str, Any]]:
    refs = state.get("referenceImages")
    return refs if isinstance(refs, list) else []


def concept_node(state: ThumbnailAgentState) -> ThumbnailAgentState:
    request = _request(state)
    headline = str(request.get("headline") or "메인 문구")[:80]
    topic = str(request.get("topic") or "먹방 썸네일")[:180]
    return {
        "concept": f"{headline} 중심의 고대비 먹방 썸네일: {topic}을 클릭 전 1초 안에 이해시키는 음식/리액션 콜라주.",
    }


def layout_node(state: ThumbnailAgentState) -> ThumbnailAgentState:
    request = _request(state)
    refs = _references(state)
    headline = str(request.get("headline") or "메인 문구")[:80]
    sub_headline = str(request.get("subHeadline") or "").strip()[:80]
    reference_summary = ", ".join(
        f"{idx + 1}:{ref.get('role', 'other')}" for idx, ref in enumerate(refs[:8])
    ) or "no references"
    sticker = f" 보조 문구 '{sub_headline}'는 작은 스티커 영역으로 분리한다." if sub_headline else ""
    return {
        "layoutBrief": (
            "하단 40~50%는 음식 클로즈업, 우측 또는 좌상단은 리액션 존, 중앙/하단은 "
            f"'{headline}' 편집 가능 안전 영역으로 남긴다.{sticker} 참고 이미지 역할: {reference_summary}."
        )
    }


def review_node(state: ThumbnailAgentState) -> ThumbnailAgentState:
    concept = state.get("concept") or "thumbnail concept"
    layout = state.get("layoutBrief") or "thumbnail layout"
    prompt_addendum = "\n".join(
        [
            "Backend thumbnail agent orchestration brief:",
            f"Concept: {concept}",
            f"Layout: {layout}",
            "Quality gate: no real logos, no readable signage, no exact prices/contact data, no identifiable crowd faces, reserve editable Korean headline safe area.",
        ]
    )
    return {
        "promptAddendum": prompt_addendum,
        "safetyReview": "검수 포인트: 과장 문구/브랜드/가격/연락처/실존 인물 식별성을 확인하고, PNG 저장 전 사람이 승인한다.",
        "nextActions": ["생성 이미지 검수", "캔버스 문구 조정", "경고 확인 후 PNG 저장"],
        "warnings": ["thumbnail_agent_graph: LangGraph orchestration brief only; exact image provider remains in Next.js."],
        "diagnostics": {
            "graph": "thumbnail-agent",
            "referenceImageCount": len(_references(state)),
            "basePromptLength": len(str(state.get("basePrompt") or "")),
        },
    }


def build_graph():
    builder = StateGraph(ThumbnailAgentState)
    builder.add_node("concept", concept_node)
    builder.add_node("layout", layout_node)
    builder.add_node("review", review_node)
    builder.add_edge(START, "concept")
    builder.add_edge("concept", "layout")
    builder.add_edge("layout", "review")
    builder.add_edge("review", END)
    return builder.compile()


__all__ = ["build_graph"]
