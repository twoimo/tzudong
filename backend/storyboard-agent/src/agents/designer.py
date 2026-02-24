"""Designer 서브그래프.

역할:
- research 결과를 바탕으로 스토리보드를 생성/수정
- interrupt_after 이후 사용자 피드백을 분류
- 추가 조사가 필요하면 대화를 요약해 supervisor로 복귀
"""

from langchain_openai import ChatOpenAI
from langchain_core.messages import RemoveMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

import prompts.feedback as feedback_prompts
from prompts.designer import STORYBOARD_GENERATION_PROMPT, STORYBOARD_EDIT_PROMPT, SUMMARY_PROMPT
from state.main import DesignerState
from state.models import StoryboardFeedbackClassification

memory = MemorySaver()
llm_designer = ChatOpenAI(model="gpt-4o")
FEEDBACK_CLASSIFICATION_PROMPT = getattr(
    feedback_prompts,
    "FEEDBACK_CLASSIFICATION_PROMPT",
    "사용자 피드백을 edit_storyboard / need_research / approved 중 하나로 분류하세요.",
)


def feedback_classifier_node(state: DesignerState) -> dict:
    """interrupt_after로 받은 human 피드백을 action으로 분류한다."""
    feedback = state["messages"][-1].content
    classification = llm_designer.with_structured_output(StoryboardFeedbackClassification).invoke(
        FEEDBACK_CLASSIFICATION_PROMPT.format(
            human_feedback=feedback,
            current_storyboard=state["final_output"],
        )
    )

    if classification.action == "edit_storyboard":
        return {"feedback_action": "edit_storyboard", "human_feedback": classification.edit_instruction}
    if classification.action == "need_research":
        return {"feedback_action": "need_research", "human_feedback": classification.research_query}
    return {"feedback_action": "approved"}


def designer_node(state: DesignerState):
    """스토리보드 생성 또는 수정 결과를 반환한다."""
    feedback = state.get("human_feedback")

    if feedback and state.get("storyboard_history"):
        prompt = STORYBOARD_EDIT_PROMPT.format(
            current_storyboard=state["storyboard_history"][-1],
            edit_instruction=feedback,
        )
    else:
        prompt = STORYBOARD_GENERATION_PROMPT.format(
            slots_data=state["slots"],
            scene_data=state.get("research_scene_data", []),
            web_summary=state.get("research_web_summary", ""),
        )

    result = llm_designer.invoke(prompt)

    return {
        "messages": [result],
        "storyboard_history": [result.content],
        "final_output": result.content,
        "human_feedback": None,
    }


def summarize_and_reset_node(state: DesignerState) -> dict:
    """현재 대화를 요약하고 기존 messages를 정리해 supervisor로 복귀한다."""
    conversation_summary = llm_designer.invoke(
        SUMMARY_PROMPT.format(
            messages=state["messages"],
        )
    )

    messages_to_remove = [RemoveMessage(id=msg.id) for msg in state["messages"] if getattr(msg, "id", None)]

    return {
        "messages": messages_to_remove,
        "conversation_summary": conversation_summary.content,
        "human_feedback": state.get("human_feedback"),
    }


def route_feedback(state: DesignerState) -> str:
    """피드백 분류 결과를 다음 노드로 매핑한다."""
    action = state.get("feedback_action")
    if action == "edit_storyboard":
        return "designer_node"
    if action == "need_research":
        return "summarize_and_reset_node"
    return END


def build_designer_subgraph():
    """Designer 서브그래프를 빌드/컴파일한다."""
    subgraph_builder = StateGraph(DesignerState)
    subgraph_builder.add_node("designer_node", designer_node)
    subgraph_builder.add_node("feedback_classifier_node", feedback_classifier_node)
    subgraph_builder.add_node("summarize_and_reset_node", summarize_and_reset_node)

    subgraph_builder.add_edge(START, "designer_node")
    subgraph_builder.add_edge("designer_node", "feedback_classifier_node")
    subgraph_builder.add_conditional_edges("feedback_classifier_node", route_feedback)
    subgraph_builder.add_edge("summarize_and_reset_node", END)

    return subgraph_builder.compile(checkpointer=memory, interrupt_after=["designer_node"])


def main():
    return build_designer_subgraph()


if __name__ == "__main__":
    main()
