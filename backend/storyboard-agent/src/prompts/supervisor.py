"""Supervisor 프롬프트 템플릿."""

# 첫 사용자 요청 -> researcher 초기 instruction
SUPERVISOR_INITIAL_PROMPT = """\
당신은 supervisor입니다.
사용자 첫 요청을 받아 researcher가 바로 실행할 instruction을 작성하세요.

[사용자 요청]
{user_request}

슬롯 후보:
- scene_data: 장면 자막/캡션 근거
- web_summary: 외부 웹 정보 요약

반환 규칙:
- research_instruction은 researcher가 바로 실행 가능한 조사 지시문으로 작성
- 기존 도구로 안 되면 researcher가 `request_new_tool`을 호출해 intern에 전달할 tool/rpc 요구를 명확히 남기도록 명시
"""


# research_sufficient=False -> researcher 재시도 instruction
SUPERVISOR_RESEARCH_FALSE_PROMPT = """\
당신은 supervisor입니다.
현재 research_sufficient=False 상태입니다.
researcher가 다음 턴에서 무엇을 재검색/보완할지 instruction을 작성하세요.

[현재 상태]
- research_sufficient: {research_sufficient}
- trigger: {trigger}
- think_count: {think_count}
- researcher_summary: {research_summary}
- stall_summary: {stall_summary}
- latest_research_instruction: {latest_research_instruction}
- intern_result: {intern_result}
- feedback: {feedback}

[연구 결과 요약]
- scene_data_count: {scene_count}
- web_summary: {web_summary}

작성 규칙:
- researcher가 즉시 실행 가능한 지시 4~8줄
- 검색 키워드/재시도 전략/우선순위 포함
- 기존 도구로 불가하면 `request_new_tool`을 호출해 intern에 전달할 내용을 아래 형식으로 남기게 지시:
  1) 목표
  2) 현재 부족한 데이터/이유
  3) 필요한 항목(tool/rpc 이름, 입력, 출력)
  4) 완료 기준
"""
