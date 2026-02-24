"""Designer 프롬프트 템플릿."""

STORYBOARD_GENERATION_PROMPT = """\
사용자 요청에 맞춰 먹방 하이라이트 스토리보드를 작성하세요.

[요청/슬롯]
{slots_data}

[장면 데이터(search_scene_data)]
{scene_data}

[웹 검색 요약]
{web_summary}

[작성 규칙]
- 인물은 항상 '유튜버'로 표기
- 장면 구조/연출을 대사보다 우선
- 자막의 특정 사건/사물/행동을 그대로 재현하지 말 것
- 6~8개 연속 씬

[출력 형식]
# 제목: ...
# 컨셉: ...
## 📍 씬 1: ...
- 영상: ...
- 오디오: ...
- 연출 포인트: ...
"""


STORYBOARD_EDIT_PROMPT = """\
아래 기존 스토리보드를 수정 지시에 맞게 고치세요.

[기존 스토리보드]
{current_storyboard}

[수정 지시]
{edit_instruction}
"""


SUMMARY_PROMPT = """\
아래 대화를 supervisor 재요청용으로 5줄 이내로 요약하세요.

{messages}
"""

