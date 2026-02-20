"""피드백 분류 프롬프트 템플릿

설계 문서: STORYBOARD_NEXT_STEP_DESIGN_v2.md §3.4
"""

# TODO: 아래 프롬프트 템플릿 구현

# ---------------------------------------------------------------------------
# 1. FEEDBACK_CLASSIFICATION_PROMPT — 피드백 → StoryboardFeedbackClassification
# ---------------------------------------------------------------------------
# - Human 피드백을 3가지 action 중 하나로 분류
# - LLM structured output용 (with_structured_output(StoryboardFeedbackClassification))
#
# 분류 기준:
# - "edit_storyboard": 스토리보드 내용 자체를 수정하는 피드백
#   → 예: "3번 씬의 대사를 바꿔줘", "색감을 따뜻하게 해줘"
#   → edit_instruction 필드에 수정 지시 저장
#
# - "need_research": 추가 자료 조사가 필요한 피드백
#   → 예: "이 식당의 대표 메뉴를 추가해줘", "다른 영상의 캡션도 참고해줘"
#   → research_query 필드에 조사 내용 저장
#
# - "approved": 승인
#   → 예: "좋아요", "이대로 진행해주세요", "확정"
#
# 변수 삽입: {human_feedback}, {current_storyboard}
