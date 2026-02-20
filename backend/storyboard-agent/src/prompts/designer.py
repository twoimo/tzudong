"""Designer 프롬프트 템플릿

설계 문서: STORYBOARD_NEXT_STEP_DESIGN_v2.md §3.4
"""

# TODO: 아래 프롬프트 템플릿 구현

# ---------------------------------------------------------------------------
# 1. STORYBOARD_GENERATION_PROMPT — 스토리보드 생성
# ---------------------------------------------------------------------------
# - 슬롯 데이터를 기반으로 스토리보드를 생성
# - 각 씬에 포함할 요소:
#   - 시각적 묘사 (visual_references 기반)
#   - 대사/나레이션 (transcript_context 기반)
#   - 장소/음식 정보 (food_restaurant_info 기반)
#   - 카메라 앵글/전환 제안
#   - 효과음/BGM 힌트 (audio_cues 기반)
# - target_scene_count에 맞춰 씬 수 조절
# - storyboard_history가 있으면 이전 버전 참고 (수정 흐름)
#
# 변수 삽입: {slots_data}, {target_scene_count}, {storyboard_history}

# ---------------------------------------------------------------------------
# 2. STORYBOARD_EDIT_PROMPT — 피드백 기반 수정
# ---------------------------------------------------------------------------
# - human_feedback.edit_instruction을 기반으로 기존 스토리보드 수정
# - 전체 재생성이 아닌 부분 수정 지향
# - 수정 전/후 차이를 명확히 표시
#
# 변수 삽입: {current_storyboard}, {edit_instruction}
