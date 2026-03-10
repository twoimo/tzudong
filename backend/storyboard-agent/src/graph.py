"""Storyboard Agent 최상위 그래프.

라우팅:
- supervisor -> researcher|designer
- researcher -> intern|supervisor
- intern -> researcher
- designer -> supervisor|END
"""

from __future__ import annotations

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from agents.designer import build_designer_subgraph
from agents.intern import build_intern_subgraph
from agents.researcher import build_researcher_subgraph
from agents.supervisor import extract_slots, route_supervisor, supervisor_node
from state.main import SharedState


def route_after_designer(state: SharedState) -> str:
    """Designer 종료 후 분기.

    - need_research 경로: summarize_and_reset에서 human_feedback를 채우고 supervisor로 복귀
    - approved 경로: 추가 피드백이 없으므로 전체 종료
    """
    if state.get("human_feedback") or state.get("conversation_summary"):
        return "supervisor"
    return "end"


def route_after_researcher(state: SharedState) -> str:
    """Researcher 종료 후 분기.

    - intern_request가 있으면 intern으로 전달
    - 없으면 supervisor로 복귀
    """
    return "intern" if state.get("intern_request") else "supervisor"


def build_graph():
    """최상위 멀티에이전트 그래프를 구성/컴파일한다."""
    builder = StateGraph(SharedState)
    builder.add_node("extract_slots", extract_slots)
    builder.add_node("supervisor", supervisor_node)
    builder.add_node("researcher", build_researcher_subgraph())
    builder.add_node("intern", build_intern_subgraph())
    builder.add_node("designer", build_designer_subgraph())

    builder.add_edge(START, "extract_slots")
    builder.add_edge("extract_slots", "supervisor")
    builder.add_conditional_edges(
        "supervisor",
        route_supervisor,
        {"researcher": "researcher", "designer": "designer"},
    )
    builder.add_conditional_edges(
        "researcher",
        route_after_researcher,
        {"intern": "intern", "supervisor": "supervisor"},
    )
    builder.add_edge("intern", "researcher")
    builder.add_conditional_edges("designer", route_after_designer, {"supervisor": "supervisor", "end": END})

    return builder.compile(checkpointer=MemorySaver())


__all__ = ["build_graph"]
