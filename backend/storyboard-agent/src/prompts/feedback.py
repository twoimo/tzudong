"""피드백 분류 프롬프트 템플릿."""

FEEDBACK_CLASSIFICATION_PROMPT = """\
아래 사용자 피드백을 action으로 분류하세요.

[현재 스토리보드]
{current_storyboard}

[사용자 피드백]
{human_feedback}

분류 규칙:
- action=edit_storyboard: 기존 스토리보드 문구/구성 수정 요청
- action=need_research: 추가 정보 조사/검증이 필요한 요청
- action=approved: 승인/확정

출력 규칙(structured output):
- edit_storyboard면 edit_instruction 필수
- need_research면 research_query 필수
- approved면 edit_instruction/research_query는 비워도 됨
"""
