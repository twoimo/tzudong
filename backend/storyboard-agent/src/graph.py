"""전체 그래프 빌드 — build_graph → compile

설계 문서: STORYBOARD_NEXT_STEP_DESIGN_v2.md §5
구현 파일: graph.py (진입점. 모든 모듈을 조립)
"""

# TODO: 아래 순서대로 구현

# ---------------------------------------------------------------------------
# import 목록
# ---------------------------------------------------------------------------
# from langgraph.graph import StateGraph, START, END
# from langgraph.types import Send, interrupt, Command
# from langgraph.prebuilt import ToolNode
# from langgraph.checkpoint.memory import MemorySaver
#
# from state import SharedState, SupervisorState, ResearcherState, InternState, DesignerState
# from agents.supervisor import supervisor_node, route_supervisor, extract_slots
# from agents.researcher import build_researcher_subgraph
# from agents.intern import intern_node, route_intern
# from agents.designer import designer_node, feedback_classifier_node, route_feedback, summarize_and_reset_node
# from tools import load_tools

# ---------------------------------------------------------------------------
# 1. build_graph() → CompiledGraph
# ---------------------------------------------------------------------------
# def build_graph():
#     TOOLS, ADMIN_TOOLS = load_tools()
#
#     builder = StateGraph(SharedState)  # 최상위: SharedState
#
#     # --- 노드 등록 ---
#     # builder.add_node("extract_slots", extract_slots)         # 초기 슬롯 추출
#     # builder.add_node("supervisor", supervisor_node)           # ReAct 루프
#     # builder.add_node("researcher", build_researcher_subgraph(TOOLS))  # 서브그래프
#     # builder.add_node("intern_node", intern_node)
#     # builder.add_node("intern_tools", ToolNode(ADMIN_TOOLS))  # interrupt_before
#     # builder.add_node("designer", designer_node)               # interrupt_after
#     # builder.add_node("feedback_classifier", feedback_classifier_node)
#     # builder.add_node("summarize_and_reset", summarize_and_reset_node)
#
#     # --- 엣지 ---
#     # builder.add_edge(START, "extract_slots")
#     # builder.add_edge("extract_slots", "supervisor")
#     # builder.add_conditional_edges("supervisor", route_supervisor)
#     # builder.add_edge("researcher", "supervisor")           # Researcher → Supervisor 복귀
#     # builder.add_conditional_edges("intern_node", route_intern)
#     # builder.add_edge("intern_tools", "supervisor")         # Intern → Supervisor 복귀
#     # builder.add_edge("designer", route_after_designer)      # Designer 서브그래프 종료 후 라우팅
#
#     # route_after_designer:
#     #   conversation_summary 있으면 → "supervisor" (need_research 복귀)
#     #   없으면 → END (approved)
#
#     # --- interrupt 설정 ---
#     # interrupt_before: intern_tools (코드 실행 전 human 확인)
#     # interrupt_after:  designer    (스토리보드 생성 후 human 확인)
#
#     # --- 컴파일 ---
#     # checkpointer = MemorySaver()  # TODO: SqliteSaver로 교체 (.storyboard-agent/memory/short-term/)
#     # return builder.compile(
#     #     checkpointer=checkpointer,
#     #     interrupt_before=["intern_tools"],
#     #     interrupt_after=["designer"],
#     # )

# ---------------------------------------------------------------------------
# 2. 그래프 흐름 요약
# ---------------------------------------------------------------------------
# START → extract_slots → supervisor ─┬→ researcher (Send, 병렬) → supervisor
#                                      ├→ intern_node → intern_tools → supervisor
#                                      ├→ intern (intern_request 처리) → supervisor → researcher 재시도
#                                      └→ designer 서브그래프
#                                            ├→ edit_storyboard → designer (내부 루프)
#                                            ├→ need_research → summarize_and_reset → END
#                                            │    → 부모: route_after_designer → supervisor
#                                            └→ approved → END
#                                                 → 부모: route_after_designer → END
