"""Supervisor 프롬프트 템플릿

설계 문서: STORYBOARD_NEXT_STEP_DESIGN_v2.md §3.1
"""

# TODO: 아래 프롬프트 템플릿 구현

# ---------------------------------------------------------------------------
# 1. SLOT_EXTRACTION_PROMPT — 사용자 입력 → StoryboardSlots 초기 추출
# ---------------------------------------------------------------------------
# - 사용자 입력에서 스토리보드 제작에 필요한 정보를 슬롯 구조로 추출
# - user_intent, target_scene_count 등 메타 필드 추출
# - LLM structured output용 (with_structured_output(StoryboardSlots))
#
# 포함해야 할 지시사항:
# - "사용자의 요청을 분석하여 어떤 종류의 데이터가 필요한지 파악하시오"
# - "음식/식당 관련이면 food_restaurant_info 슬롯 활성화"
# - "영상 참조가 필요하면 visual_references 슬롯 활성화"

# ---------------------------------------------------------------------------
# 2. SLOT_EVALUATION_PROMPT — ReAct Observe 단계: 충족도 평가
# ---------------------------------------------------------------------------
# - 현재 slots.summary()와 research_results를 입력으로 받음
# - 슬롯 충족도를 판단하고 다음 행동 결정
# - "충분하다" 또는 "어떤 슬롯이 부족하고 어떤 검색이 필요하다"
#
# 변수 삽입: {slot_summary}, {research_results_summary}, {loop_count}

# ---------------------------------------------------------------------------
# 3. TASK_GENERATION_PROMPT — ReAct Act 단계: Task 목록 생성
# ---------------------------------------------------------------------------
# - 미충족 슬롯 기반으로 구체적인 Task(업무) 목록 생성
# - LLM structured output용 (list[Task])
# - 각 Task에 어떤 도구를 쓸지 힌트 포함 (Researcher가 참고)
#
# 포함해야 할 지시사항:
# - "중복 검색을 피하시오. 이전 쿼리: {previous_queries}"
# - "각 Task의 instruction에 검색 키워드와 의도를 명확히 기술하시오"
# - "Intern에게는 RPC/도구 생성 또는 불가 항목 문서화만 할당하시오"
