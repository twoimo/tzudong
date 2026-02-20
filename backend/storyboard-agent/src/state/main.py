"""State 모듈 — SharedState + 에이전트별 Private State

설계 문서 §4 기반.
- SharedState: 모든 에이전트가 공유하는 최소한의 필드
- *Private: 각 에이전트 서브그래프 내부에서만 사용하는 필드
- *State: 서브그래프용 조합 State (Shared + Private)
"""

from __future__ import annotations

from typing import Annotated, Optional

from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages

from state.models import Task
from state.slots import StoryboardSlots


# ---------------------------------------------------------------------------
# Reducer
# ---------------------------------------------------------------------------
def _merge_dicts(left: dict, right: dict) -> dict:
    """dict 필드용 reducer. 키별 병합 (list 값은 append)."""
    merged = {**left}
    for k, v in right.items():
        if k in merged and isinstance(merged[k], list) and isinstance(v, list):
            merged[k] = merged[k] + v
        else:
            merged[k] = v
    return merged


def _append_list(left: list, right: list) -> list:
    """list 필드용 reducer. 단순 append."""
    return left + right


# ---------------------------------------------------------------------------
# SharedState — 에이전트 간 공유
# ---------------------------------------------------------------------------
from typing import TypedDict


class SharedState(TypedDict):
    """모든 에이전트가 읽고 쓸 수 있는 공유 State"""

    messages: Annotated[list[BaseMessage], add_messages]
    slots: Optional[StoryboardSlots]
    is_approved: bool
    final_output: Optional[str]
    intern_request: Optional[str]  # Researcher → Supervisor → Intern 도구/RPC 생성 요청
    researcher_context: Optional[list[BaseMessage]]  # Researcher 대화 보존용
    intern_result: Optional[str]  # Intern 완료 요약(문자열). Supervisor 판단용


# ---------------------------------------------------------------------------
# 에이전트별 Private State
# ---------------------------------------------------------------------------
class SupervisorPrivate(TypedDict):
    """Supervisor 서브그래프 내부용"""

    tasks: list[Task]
    loop_count: int
    human_feedback: Optional[str]


class ResearcherPrivate(TypedDict):
    """Researcher 서브그래프 내부용"""

    research_results: Annotated[dict, _merge_dicts]
    previous_queries: Annotated[dict, _merge_dicts]  # {"scene": [...], "web": [...]}
    intern_request: Optional[str]  # 도구/RPC 부족 시 Intern에게 요청할 내용
    loop_count: int  # evaluate에서 +1, 최대 3회


class InternPrivate(TypedDict):
    """Intern 서브그래프 내부용"""

    intern_reports: Annotated[list[dict], _append_list]
    intern_plan: Optional[dict]  # {"goal": str, "steps": [...], "last_updated": str}
    intern_action: Optional[
        str
    ]  # "create_tool" | "create_rpc_sql" | "delete_tool" | "delete_rpc_sql" | "report"
    created_artifacts: Annotated[
        list[dict], _append_list
    ]  # [{"type": "tool", "name": "xxx"}]


class DesignerPrivate(TypedDict):
    """Designer 서브그래프 내부용"""

    storyboard_history: Annotated[list[str], _append_list]
    human_feedback: Optional[str]
    conversation_summary: Optional[str]
    feedback_action: Optional[str]


# ---------------------------------------------------------------------------
# 서브그래프용 조합 State (Shared + Private)
# ---------------------------------------------------------------------------
class SupervisorState(TypedDict):
    """Supervisor 서브그래프 State"""

    # Shared
    messages: Annotated[list[BaseMessage], add_messages]
    slots: Optional[StoryboardSlots]
    is_approved: bool
    final_output: Optional[str]
    # Private
    tasks: list[Task]
    loop_count: int
    human_feedback: Optional[str]
    researcher_context: Optional[list[BaseMessage]]  # Researcher 대화 보존용


class ResearcherState(TypedDict):
    """Researcher 서브그래프 State (slots 직접 참조 않음)"""

    # Shared
    messages: Annotated[list[BaseMessage], add_messages]
    intern_request: Optional[str]
    researcher_context: Optional[list[BaseMessage]]
    # Private
    research_results: Annotated[dict, _merge_dicts]
    previous_queries: Annotated[dict, _merge_dicts]  # {"scene": [...], "web": [...]}
    loop_count: int


class InternState(TypedDict):
    """Intern 서브그래프 State"""

    # Shared
    messages: Annotated[list[BaseMessage], add_messages]
    intern_request: Optional[str]  # Supervisor/Researcher에서 전달된 Intern 작업 요청
    researcher_context: Optional[list[BaseMessage]]  # Researcher 대화 보존용(재시도 시)
    intern_result: Optional[str]  # Intern 완료 요약(문자열). Supervisor 판단용
    # Private
    intern_reports: Annotated[list[dict], _append_list]
    intern_plan: Optional[dict]  # {"goal": str, "steps": [...], "last_updated": str}
    intern_action: Optional[
        str
    ]  # "create_tool" | "create_rpc_sql" | "delete_tool" | "delete_rpc_sql" | "report"
    created_artifacts: Annotated[
        list[dict], _append_list
    ]  # [{"type": "tool", "name": "xxx"}]


class DesignerState(TypedDict):
    """Designer 서브그래프 State"""

    # Shared
    messages: Annotated[list[BaseMessage], add_messages]
    slots: Optional[StoryboardSlots]
    final_output: Optional[str]
    # Private
    storyboard_history: Annotated[list[str], _append_list]
    human_feedback: Optional[str]
    conversation_summary: Optional[str]
    feedback_action: Optional[str]
