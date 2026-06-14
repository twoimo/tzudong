"""Thumbnail backend agent LangGraph.

This graph is intentionally orchestration-only: it plans concept/layout/review
metadata for the web provider layer. Actual image generation remains in the
Next.js `openai-gpt-image` provider so exact `gpt-image-2` provenance is not
blurred by a backend command.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, TypedDict

try:
    from langgraph.graph import END, START, StateGraph

    LANGGRAPH_AVAILABLE = True
except ModuleNotFoundError as exc:  # pragma: no cover - exercised in local envs without langgraph
    missing_module = exc.name or ""
    if missing_module != "langgraph" and not missing_module.startswith("langgraph."):
        raise
    END = "__end__"
    START = "__start__"
    LANGGRAPH_AVAILABLE = False

    class _FallbackCompiledGraph:
        def __init__(self, nodes: dict[str, Callable[[dict[str, Any]], dict[str, Any]]], edges: dict[str, str]):
            self._nodes = nodes
            self._edges = edges

        def invoke(self, state: dict[str, Any]) -> dict[str, Any]:
            current = self._edges.get(START)
            next_state = dict(state)
            visited = 0
            while current and current != END:
                visited += 1
                if visited > len(self._nodes) + 2:
                    raise RuntimeError("thumbnail fallback graph cycle detected")
                node = self._nodes.get(current)
                if node is None:
                    raise RuntimeError(f"thumbnail fallback graph missing node: {current}")
                update = node(next_state)
                if isinstance(update, dict):
                    next_state.update(update)
                current = self._edges.get(current, END)
            return next_state

    class StateGraph:  # type: ignore[no-redef]
        def __init__(self, _state_type: object):
            self._nodes: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {}
            self._edges: dict[str, str] = {}

        def add_node(self, name: str, node: Callable[[dict[str, Any]], dict[str, Any]]) -> None:
            self._nodes[name] = node

        def add_edge(self, source: str, target: str) -> None:
            self._edges[source] = target

        def compile(self) -> _FallbackCompiledGraph:
            return _FallbackCompiledGraph(self._nodes, self._edges)


class ThumbnailAgentState(TypedDict, total=False):
    request: dict[str, Any]
    referenceImages: list[dict[str, Any]]
    retrievalEvidence: list[dict[str, Any]]
    retrievalDiagnostics: dict[str, Any]
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


def _retrieval_evidence(state: ThumbnailAgentState) -> list[dict[str, Any]]:
    refs = state.get("retrievalEvidence")
    return refs if isinstance(refs, list) else []


def _retrieval_diagnostics(state: ThumbnailAgentState) -> dict[str, Any]:
    diagnostics = state.get("retrievalDiagnostics")
    return diagnostics if isinstance(diagnostics, dict) else {}


def _retrieval_summary(state: ThumbnailAgentState) -> str:
    evidence = _retrieval_evidence(state)
    if not evidence:
        return "no retrieval evidence"
    rows = []
    for idx, item in enumerate(evidence[:4]):
        title = str(item.get("title") or item.get("id") or "reference")[:120]
        intent = str(item.get("intent") or "style")
        role = str(item.get("uploadRole") or "other")
        score = item.get("rerankScore", item.get("hybridScore", "n/a"))
        rows.append(f"{idx + 1}:{intent}/{role}/{score}/{title}")
    return "; ".join(rows)


def _retrieval_proof(state: ThumbnailAgentState) -> str:
    diagnostics = _retrieval_diagnostics(state)
    models = diagnostics.get("usedModels") if isinstance(diagnostics.get("usedModels"), dict) else {}
    operations = diagnostics.get("operations") if isinstance(diagnostics.get("operations"), dict) else {}
    parts = [
        f"status={diagnostics.get('status', 'unknown')}",
        f"runtime={diagnostics.get('commandRuntime', 'none')}",
    ]
    if models.get("embedding"):
        parts.append(f"embedding={models.get('embedding')}")
    if models.get("reranker"):
        parts.append(f"reranker={models.get('reranker')}")
    for key in ("denseSparseHybrid", "mmrApplied", "rerankerApplied", "localVectorSearch", "lexicalRerank"):
        if operations.get(key) is True:
            parts.append(f"{key}=true")
    return ", ".join(parts)


def concept_node(state: ThumbnailAgentState) -> ThumbnailAgentState:
    request = _request(state)
    headline = str(request.get("headline") or "메인 문구")[:80]
    topic = str(request.get("topic") or "먹방 썸네일")[:180]
    retrieval_summary = _retrieval_summary(state)
    return {
        "concept": f"{headline} 중심의 고대비 먹방 썸네일: {topic}을 검색 레퍼런스({retrieval_summary}) 기반으로 클릭 전 1초 안에 이해시키는 음식/리액션 콜라주.",
    }


def layout_node(state: ThumbnailAgentState) -> ThumbnailAgentState:
    request = _request(state)
    refs = _references(state)
    headline = str(request.get("headline") or "메인 문구")[:80]
    sub_headline = str(request.get("subHeadline") or "").strip()[:80]
    reference_summary = ", ".join(
        f"{idx + 1}:{ref.get('role', 'other')}" for idx, ref in enumerate(refs[:8])
    ) or "no uploaded references"
    retrieval_summary = _retrieval_summary(state)
    sticker = f" 보조 문구 '{sub_headline}'는 작은 스티커 영역으로 분리한다." if sub_headline else ""
    return {
        "layoutBrief": (
            "하단 40~50%는 retrieval food evidence와 맞는 음식 클로즈업, 우측 또는 좌상단은 리액션/후킹 존, 중앙/하단은 "
            f"'{headline}' 편집 가능 안전 영역으로 남긴다.{sticker} 업로드 참고 역할: {reference_summary}. 자동 검색 참고: {retrieval_summary}."
        )
    }


def review_node(state: ThumbnailAgentState) -> ThumbnailAgentState:
    concept = state.get("concept") or "thumbnail concept"
    layout = state.get("layoutBrief") or "thumbnail layout"
    retrieval_summary = _retrieval_summary(state)
    retrieval_proof = _retrieval_proof(state)
    prompt_addendum = "\n".join(
        [
            "Backend thumbnail agent orchestration brief:",
            f"Concept: {concept}",
            f"Layout: {layout}",
            f"Retrieved references: {retrieval_summary}",
            f"Retrieval proof: {retrieval_proof}",
            "Quality gate: no real logos, no readable signage, no exact prices/contact data, no identifiable crowd faces, reserve editable Korean headline safe area, and never treat automatic style/food retrieval as host/person likeness permission.",
        ]
    )
    return {
        "promptAddendum": prompt_addendum,
        "safetyReview": "검수 포인트: 과장 문구/브랜드/가격/연락처/실존 인물 식별성을 확인하고, PNG 저장 전 사람이 승인한다.",
        "nextActions": ["생성 이미지 검수", "캔버스 문구 조정", "경고 확인 후 PNG 저장"],
        "warnings": [
            (
                "thumbnail_agent_graph: LangGraph orchestration brief only; exact image provider remains in Next.js."
                if LANGGRAPH_AVAILABLE
                else "thumbnail_agent_graph: LangGraph-compatible fallback used because python langgraph package is unavailable; exact image provider remains in Next.js."
            )
        ],
        "diagnostics": {
            "graph": "thumbnail-agent",
            "graphRuntime": "langgraph" if LANGGRAPH_AVAILABLE else "langgraph-compatible-fallback",
            "retrievalEvidenceCount": len(_retrieval_evidence(state)),
            "retrievalProof": _retrieval_proof(state),
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
