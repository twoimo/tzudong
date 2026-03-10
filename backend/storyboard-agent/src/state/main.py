"""State 타입 정의 모듈.

- SharedState: 에이전트 간 핸드오프에 필요한 공용 필드
- *Private: 각 에이전트 서브그래프 내부 처리 필드
- *State: 서브그래프에서 실제 사용하는 조합 타입
"""

from __future__ import annotations

from typing import Annotated, Optional

from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages

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
    research_instruction: Optional[str]  # Supervisor -> Researcher 지시문
    research_results: Annotated[dict, _merge_dicts]  # Researcher 구조화 결과
    research_scene_data: list[dict]  # Supervisor가 분리한 장면 데이터
    research_web_summary: Optional[str]  # Supervisor가 분리한 웹 검색 요약
    intern_request: Optional[str]  # Researcher → Intern 도구/RPC 생성 요청
    researcher_context: Optional[list[BaseMessage]]  # Researcher 대화 보존용
    intern_result: Optional[str]  # Intern 완료 요약(문자열). Supervisor 판단용
    research_sufficient: Optional[bool]  # Researcher 충분성 평가 결과
    research_summary: Optional[str]  # Researcher 충분/부족 사유 요약
    researcher_think_count: int  # think 노드 방문 횟수
    researcher_stall_summary: Optional[str]  # 5회 반복 시 정체 요약
    agent_instructions: Annotated[
        dict, _merge_dicts
    ]  # {"researcher":[...], "intern":[...], "designer":[...]} append history
    human_feedback: Optional[str]  # Designer -> Supervisor 재조사 요청 텍스트
    conversation_summary: Optional[str]  # Designer 대화 요약(need_research 복귀용)


# ---------------------------------------------------------------------------
# 에이전트별 Private State
# ---------------------------------------------------------------------------
class SupervisorPrivate(TypedDict):
    """Supervisor 서브그래프 내부용"""

    loop_count: int
    human_feedback: Optional[str]


class ResearcherPrivate(TypedDict):
    """Researcher 서브그래프 내부용"""

    research_results: Annotated[dict, _merge_dicts]
    previous_queries: Annotated[dict, _merge_dicts]  # {"scene": [...], "web": [...]}
    intern_request: Optional[str]  # 도구/RPC 부족 시 Intern에게 요청할 내용
    loop_count: int  # evaluate에서 +1, 최대 3회
    research_sufficient: Optional[bool]  # evaluate에서 충분성 결과 기록
    research_summary: Optional[str]  # evaluate에서 충분/부족 사유 기록


class InternPrivate(TypedDict):
    """Intern 서브그래프 내부용"""

    intern_action: Optional[str]  # "review_create" | "create_modify" | "execute_delete" | "execute" | "update_plan" | "finish" | "end"
    original_tool_calls: Annotated[list[dict], _append_list]  # think에서 최초 생성한 tool_call 원본 로그
    modified_tool_calls: Annotated[dict, _merge_dicts]  # {"tool:foo": {"tool_call": {...}, "status": "...", "version": n}}
    tool_call_order: Annotated[list[str], _append_list]  # modified_tool_calls 순회 순서
    current_tool_key: Optional[str]  # 현재 리뷰/수정 중인 대상 key
    intern_ready_to_end: bool  # finish 수행 완료 플래그(END는 think에서만 분기)
    pending_review_notes: dict[str, str]  # create 코드리뷰 결과 캐시
    pending_execute_calls: list[dict]  # 실행 대기 tool_call (승인된 create/delete + 기타 도구)
    review_statuses: Annotated[dict, _merge_dicts]  # {"tool:foo": "approve/delete/modify"}
    pending_modified_feedback: Annotated[dict, _merge_dicts]  # {"tool:foo": "수정 지시"}
    plan_update_events: Annotated[list[BaseMessage], add_messages]  # plan 자동 업데이트용 이벤트 메시지 버퍼
    created_artifacts: Annotated[
        list[dict], _append_list
    ]  # [{"type": "tool", "name": "xxx"}]
    artifact_statuses: Annotated[dict, _merge_dicts]  # {"tool:foo": "created/deleted/failed"}


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
    research_instruction: Optional[str]
    research_results: Annotated[dict, _merge_dicts]
    research_scene_data: list[dict]
    research_web_summary: Optional[str]
    research_sufficient: Optional[bool]
    research_summary: Optional[str]
    researcher_think_count: int
    researcher_stall_summary: Optional[str]
    agent_instructions: Annotated[dict, _merge_dicts]
    intern_request: Optional[str]
    researcher_context: Optional[list[BaseMessage]]
    intern_result: Optional[str]
    # Private
    loop_count: int
    human_feedback: Optional[str]


class ResearcherState(TypedDict):
    """Researcher 서브그래프 State (slots 직접 참조 않음)"""

    # Shared
    messages: Annotated[list[BaseMessage], add_messages]
    intern_request: Optional[str]
    researcher_context: Optional[list[BaseMessage]]
    research_instruction: Optional[str]
    agent_instructions: Annotated[dict, _merge_dicts]
    # Private
    research_results: Annotated[dict, _merge_dicts]
    previous_queries: Annotated[dict, _merge_dicts]  # {"scene": [...], "web": [...]}
    loop_count: int
    researcher_think_count: int
    researcher_stall_summary: Optional[str]
    research_sufficient: Optional[bool]
    research_summary: Optional[str]


class InternState(TypedDict):
    """Intern 서브그래프 State"""

    # Shared
    messages: Annotated[list[BaseMessage], add_messages]
    intern_request: Optional[str]  # Supervisor/Researcher에서 전달된 Intern 작업 요청
    agent_instructions: Annotated[dict, _merge_dicts]
    researcher_context: Optional[list[BaseMessage]]  # Researcher 대화 보존용(재시도 시)
    intern_result: Optional[str]  # Intern 완료 요약(문자열). Supervisor 판단용
    # Private
    intern_action: Optional[str]  # "review_create" | "create_modify" | "execute_delete" | "execute" | "update_plan" | "finish" | "end"
    original_tool_calls: Annotated[list[dict], _append_list]  # think에서 최초 생성한 tool_call 원본 로그
    modified_tool_calls: Annotated[dict, _merge_dicts]  # {"tool:foo": {"tool_call": {...}, "status": "...", "version": n}}
    tool_call_order: Annotated[list[str], _append_list]  # modified_tool_calls 순회 순서
    current_tool_key: Optional[str]  # 현재 리뷰/수정 중인 대상 key
    intern_ready_to_end: bool  # finish 수행 완료 플래그(END는 think에서만 분기)
    pending_review_notes: dict[str, str]  # create 코드리뷰 결과 캐시
    pending_execute_calls: list[dict]  # 실행 대기 tool_call (승인된 create/delete + 기타 도구)
    review_statuses: Annotated[dict, _merge_dicts]  # {"tool:foo": "approve/delete/modify"}
    pending_modified_feedback: Annotated[dict, _merge_dicts]  # {"tool:foo": "수정 지시"}
    plan_update_events: Annotated[list[BaseMessage], add_messages]  # plan 자동 업데이트용 이벤트 메시지 버퍼
    created_artifacts: Annotated[
        list[dict], _append_list
    ]  # [{"type": "tool", "name": "xxx"}]
    artifact_statuses: Annotated[dict, _merge_dicts]  # {"tool:foo": "created/deleted/failed"}


class DesignerState(TypedDict):
    """Designer 서브그래프 State"""

    # Shared
    messages: Annotated[list[BaseMessage], add_messages]
    slots: Optional[StoryboardSlots]
    research_scene_data: list[dict]
    research_web_summary: Optional[str]
    final_output: Optional[str]
    # Private
    storyboard_history: Annotated[list[str], _append_list]
    human_feedback: Optional[str]
    conversation_summary: Optional[str]
    feedback_action: Optional[str]
