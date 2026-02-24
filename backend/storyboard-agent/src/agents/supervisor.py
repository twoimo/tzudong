"""Supervisor 에이전트.

역할:
- researcher 결과를 `research_sufficient` 기준으로만 승인/재조사 분기
- researcher 재시도 instruction 생성/append
- designer에 전달할 research 산출물(scene/web_summary) 정리
"""

from __future__ import annotations

import json

from langchain_openai import ChatOpenAI
from pydantic import BaseModel

from prompts.supervisor import SUPERVISOR_INITIAL_PROMPT, SUPERVISOR_RESEARCH_FALSE_PROMPT
from state.main import SupervisorState
from state.slots import StoryboardSlots

llm_supervisor = ChatOpenAI(model="gpt-4o")


class _InitialInstruction(BaseModel):
    """첫 사용자 입력에서 researcher 초기 instruction 생성용 모델."""

    research_instruction: str


class _RetryInstruction(BaseModel):
    """research_sufficient=False 재시도 instruction 생성용 모델."""

    research_instruction: str


def _latest_user_text(state: SupervisorState) -> str:
    """현재 대화의 최신 사용자 텍스트를 읽는다."""
    if not state.get("messages"):
        return ""
    return str(state["messages"][-1].content or "").strip()


def _latest_instruction(state: SupervisorState, agent: str, fallback: str = "") -> str:
    """agent별 최신 instruction을 반환한다."""
    history = (state.get("agent_instructions") or {}).get(agent) or []
    return str(history[-1]).strip() if history else fallback


def _append_instruction(result: dict, agent: str, instruction: str) -> None:
    """result에 agent instruction append payload를 기록한다."""
    text = (instruction or "").strip()
    if not text:
        return
    result.setdefault("agent_instructions", {})
    result["agent_instructions"][agent] = [text]


def _state_summary_for_prompt(state: SupervisorState) -> str:
    """LLM 프롬프트에 넣을 상태 요약을 만든다."""
    snapshot = {
        "research_sufficient": state.get("research_sufficient"),
        "research_summary": state.get("research_summary"),
        "researcher_think_count": state.get("researcher_think_count"),
        "researcher_stall_summary": state.get("researcher_stall_summary"),
        "intern_request": state.get("intern_request"),
        "intern_result": state.get("intern_result"),
        "human_feedback": state.get("human_feedback"),
        "conversation_summary": state.get("conversation_summary"),
        "research_results_keys": sorted(list((state.get("research_results") or {}).keys())),
        "agent_instructions": state.get("agent_instructions") or {},
    }
    return json.dumps(snapshot, ensure_ascii=False, default=str)[:4000]


def _has_research_signal(state: SupervisorState, scene_count: int, web_summary: str) -> bool:
    """첫 요청인지(초기), 이미 research가 돌았는지(재시도) 판단한다."""
    return any(
        [
            state.get("research_sufficient") is not None,
            bool(state.get("research_summary")),
            bool(state.get("researcher_stall_summary")),
            bool(state.get("intern_result")),
            bool(state.get("intern_request")),
            scene_count > 0,
            bool(web_summary.strip()),
        ]
    )


def extract_slots(state: SupervisorState) -> dict:
    """초기 슬롯 기본값을 1회만 생성한다."""
    if state.get("slots") is not None:
        return {}
    return {"slots": StoryboardSlots(user_intent=_latest_user_text(state), target_scene_count=6)}


def _decide_initial_research_instruction(state: SupervisorState) -> str:
    """첫 턴 researcher instruction을 생성한다."""
    user_request = _latest_user_text(state)
    prompt = "\n\n".join(
        [
            SUPERVISOR_INITIAL_PROMPT.format(user_request=user_request),
            "[전체 상태 요약]",
            _state_summary_for_prompt(state),
        ]
    )
    data = llm_supervisor.with_structured_output(_InitialInstruction).invoke(prompt)
    return (data.research_instruction or "").strip()


def _decide_retry_research_instruction(
    state: SupervisorState,
    scene_count: int,
    web_summary: str,
    trigger: str,
    feedback: str,
) -> str:
    """research_sufficient=False 상태에서 researcher 재시도 instruction을 생성한다."""
    prompt = "\n\n".join(
        [
            SUPERVISOR_RESEARCH_FALSE_PROMPT.format(
                research_sufficient=state.get("research_sufficient"),
                think_count=state.get("researcher_think_count", 0),
                research_summary=state.get("research_summary") or "",
                stall_summary=state.get("researcher_stall_summary") or "",
                latest_research_instruction=_latest_instruction(
                    state, "researcher", state.get("research_instruction") or _latest_user_text(state)
                ),
                intern_result=state.get("intern_result") or "",
                scene_count=scene_count,
                web_summary=web_summary[:1200],
                trigger=trigger,
                feedback=feedback,
            ),
            "[전체 상태 요약]",
            _state_summary_for_prompt(state),
        ]
    )
    data = llm_supervisor.with_structured_output(_RetryInstruction).invoke(prompt)
    return (data.research_instruction or "").strip()


def supervisor_node(state: SupervisorState) -> dict:
    """Supervisor 본체.

    규칙:
    - `research_sufficient=True` 이면 승인(designer 이동)
    - 그 외에는 researcher 재지시
    """
    result: dict = {}
    if state.get("slots") is None:
        result.update(extract_slots(state))

    research_results = state.get("research_results") or {}
    scene_data = research_results.get("scene_data") or research_results.get("transcripts") or []
    web_summary = str(research_results.get("web_summary") or "").strip()
    result["research_scene_data"] = scene_data
    result["research_web_summary"] = web_summary

    feedback = str(state.get("human_feedback") or state.get("conversation_summary") or "").strip()
    if feedback:
        instruction = _decide_retry_research_instruction(
            state=state,
            scene_count=len(scene_data),
            web_summary=web_summary,
            trigger="designer_feedback",
            feedback=feedback,
        )
        if not instruction:
            instruction = _latest_instruction(state, "researcher", _latest_user_text(state)) or _latest_user_text(state)
        result.update(
            {
                "is_approved": False,
                "research_sufficient": False,
                "research_instruction": instruction,
                "intern_request": None,
                "human_feedback": None,
                "conversation_summary": None,
                "intern_result": None,
            }
        )
        _append_instruction(result, "researcher", instruction)
        return result

    if state.get("research_sufficient") is True:
        result.update(
            {
                "is_approved": True,
                "intern_request": None,
                "intern_result": None,
                "human_feedback": None,
                "conversation_summary": None,
            }
        )
        return result

    has_signal = _has_research_signal(state, scene_count=len(scene_data), web_summary=web_summary)
    if not has_signal:
        instruction = _decide_initial_research_instruction(state)
    else:
        trigger = "research_false"
        instruction = _decide_retry_research_instruction(
            state=state,
            scene_count=len(scene_data),
            web_summary=web_summary,
            trigger=trigger,
            feedback=feedback,
        )

    if not instruction:
        instruction = _latest_instruction(state, "researcher", _latest_user_text(state)) or _latest_user_text(state)

    result.update(
        {
            "is_approved": False,
            "research_sufficient": False,
            "research_instruction": instruction,
            "intern_request": None,
            "human_feedback": None,
            "conversation_summary": None,
            "intern_result": None,
        }
    )
    _append_instruction(result, "researcher", instruction)
    return result


def route_supervisor(state: SupervisorState) -> str:
    """Supervisor 분기: 승인 시 designer, 아니면 researcher."""
    return "designer" if state.get("is_approved") else "researcher"
