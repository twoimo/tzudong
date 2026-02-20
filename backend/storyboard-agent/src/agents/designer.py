"""Designer 에이전트 — 스토리보드 제작·수정, 피드백 처리

설계 문서: STORYBOARD_NEXT_STEP_DESIGN_v2.md §3.4
구현 파일: agents/designer.py + prompts/designer.py + prompts/feedback.py
"""

# TODO: 아래 순서대로 구현

# ---------------------------------------------------------------------------
# 1. designer_node (스토리보드 생성)
# ---------------------------------------------------------------------------
# - is_approved == True일 때만 실행
# - slots + research_results를 기반으로 스토리보드 생성
# - storyboard_history에 이전 버전 보관 (재생성 시 참고)
# - human_feedback가 있으면 수정 지시사항과 이전 버전을 함께 참조
#
# 입력: DesignerState
# 출력: {"messages": [...], "storyboard_history": [생성된 스토리보드], "final_output": ...}
#
# 참고: prompts/designer.py의 STORYBOARD_GENERATION_PROMPT 사용
# - slots.visual_references → 캡션 기반 시각 묘사
# - slots.transcript_context → 대사/말투 참고
# - slots.food_restaurant_info → 음식/장소 정보
# - target_scene_count에 맞춰 씬 수 조절

# ---------------------------------------------------------------------------
# 2. feedback_classifier_node (피드백 분류)
# ---------------------------------------------------------------------------
# - interrupt_after로 받은 human 피드백을 분류
# - LLM structured output → StoryboardFeedbackClassification
#   - "edit_storyboard": 즉시 수정 (Designer로 다시)
#   - "need_research": 추가 조사 필요 (summarize_and_reset → Supervisor)
#   - "approved": 승인 (END)
#
# 입력: DesignerState (human_feedback 포함)
# 출력: {"messages": [...]} + 라우팅 정보
#
# 참고: prompts/feedback.py의 FEEDBACK_CLASSIFICATION_PROMPT 사용

# ---------------------------------------------------------------------------
# 3. route_feedback (조건부 라우팅)
# ---------------------------------------------------------------------------
# - StoryboardFeedbackClassification.action 기반
#   - "edit_storyboard" → "designer"
#   - "need_research" → "summarize_and_reset"
#   - "approved" → END

# ---------------------------------------------------------------------------
# 4. summarize_and_reset_node (대화 요약 후 Supervisor 복귀)
# ---------------------------------------------------------------------------
# - 현재까지의 대화(messages)를 한 문단으로 요약 (LLM)
# - 기존 메시지 삭제 (RemoveMessage)
# - 요약 + human_feedback(research_query)을 Supervisor에 전달
# - conversation_summary에 저장
#
# 입력: DesignerState
# 출력: {
#     "messages": [RemoveMessage(id=...) for each old msg],
#     "conversation_summary": "요약 텍스트",
#     "human_feedback": research_query,  # Supervisor가 참조
# }
#
# 주의: RemoveMessage는 langgraph.graph.message에서 import
# from langchain_core.messages import RemoveMessage

from langgraph.graph import START, END, StateGraph
from typing import TypedDict
from langgraph.checkpoint.memory import MemorySaver
from langchain_core.messages import RemoveMessage
from state.main import DesignerState
from state.models import StoryboardFeedbackClassification
from prompts.designer import STORYBOARD_GENERATION_PROMPT, STORYBOARD_EDIT_PROMPT, SUMMARY_PROMPT
from prompts.feedback import FEEDBACK_CLASSIFICATION_PROMPT
from langchain_openai import ChatOpenAI

memory = MemorySaver()
llm_designer = ChatOpenAI(model="gpt-4o-mini")


# designer 피드백 분류 노드
def feedback_classifier_node(state: DesignerState) -> dict:
    """human 피드백을 분류만 한다."""
    feedback = state["messages"][-1].content  # interrupt_after로 받은 human 메시지
    
    classification = llm_designer.with_structured_output(
        StoryboardFeedbackClassification
    ).invoke(FEEDBACK_CLASSIFICATION_PROMPT.format(
        human_feedback=feedback,
        current_storyboard=state["final_output"],
    ))
    

    if classification.action == "edit_storyboard":
        return {"feedback_action": "edit_storyboard", "human_feedback": classification.edit_instruction}
    elif classification.action == "need_research":
        return {"feedback_action": "need_research", "human_feedback": classification.research_query}
    else:
        return {"feedback_action": "approved"}


# designer 노드
def designer_node(state: DesignerState):
    """스토리보드 생성 또는 수정"""
    feedback = state.get("human_feedback")
    
    if feedback:
        # 피드백 기반 수정 (edit_storyboard로 분류된 경우만 여기 옴)
        prompt = STORYBOARD_EDIT_PROMPT.format(
            current_storyboard=state["storyboard_history"][-1],
            edit_instruction=feedback,
        )
    else:
        # 신규 생성
        prompt = STORYBOARD_GENERATION_PROMPT.format(
            slots_data=state["slots"],
        )
    
    result = llm_designer.invoke(prompt)
    
    return {
        "messages": [result],
        "storyboard_history": [result.content],
        "final_output": result.content,
        "human_feedback": None,  # 소비 후 초기화
    }


# designer 요약 노드
def summarize_and_reset_node(state: DesignerState) -> dict:
    """대화 요약 후 Supervisor 복귀"""

    # 1. 현재까지의 대화(messages)를 한 문단으로 요약 (LLM)
    conversation_summary = llm_designer.invoke(SUMMARY_PROMPT.format(
        messages=state["messages"],
    ))

    # 2. 기존 메시지 삭제 (RemoveMessage)
    messages_to_remove = [RemoveMessage(id=msg.id) for msg in state["messages"]]

    # 3. 요약 + human_feedback(research_query)을 Supervisor에 전달
    return {
        "messages": messages_to_remove,
        "conversation_summary": conversation_summary.content,
        "human_feedback": state.get("human_feedback"),
    }


# designer 분기 함수
def route_feedback(state: DesignerState) -> str:
    """피드백 분류 결과에 따라 라우팅"""
    action = state.get("feedback_action")
    if action == "edit_storyboard":
        return "designer_node"
    elif action == "need_research":
        return "summarize_and_reset_node"
    else:
        return END



def main():
    # designer 서브그래프
    subgraph_builder = StateGraph(DesignerState)
    subgraph_builder.add_node("designer_node", designer_node)
    subgraph_builder.add_node("feedback_classifier_node", feedback_classifier_node)
    subgraph_builder.add_node("summarize_and_reset_node", summarize_and_reset_node)

    subgraph_builder.add_edge(START, "designer_node")
    subgraph_builder.add_edge("designer_node", "feedback_classifier_node")
    subgraph_builder.add_conditional_edges("feedback_classifier_node", route_feedback)
    subgraph_builder.add_edge("summarize_and_reset_node", END)

    return subgraph_builder.compile(checkpointer=memory, interrupt_after=["designer_node"])


if __name__ == "__main__":
    main()
