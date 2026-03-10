"""StoryboardSlots — 슬롯 필링 기반 데이터 검증

고정 임계값(캡션 ≥ 3) 대신, 스토리보드 제작에 필요한 정보 유형(슬롯)별
충족 상태를 기준으로 검증한다. 상세 설계: STORYBOARD_NEXT_STEP_DESIGN_v2.md §12
"""

from __future__ import annotations

from typing import Optional, Literal, Any

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# 슬롯 내부 데이터 단위
# ---------------------------------------------------------------------------
class VisualReference(BaseModel):
    """시각 참조 데이터 (캡션 기반)"""

    video_id: str
    start_sec: int
    end_sec: int
    caption: str = Field(description="장면의 시각적 묘사")
    is_peak: bool = True


class TranscriptChunk(BaseModel):
    """자막 청크"""

    video_id: str
    start_sec: int
    end_sec: int
    text: str = Field(description="자막 텍스트")
    context: Optional[str] = Field(
        default=None,
        description="주변 문맥 자막",
    )


class FoodRestaurantInfo(BaseModel):
    """음식/식당 정보"""

    restaurant_name: Optional[str] = None
    categories: list[str] = Field(default_factory=list)
    video_id: Optional[str] = None
    review: Optional[str] = None


class VideoMeta(BaseModel):
    """비디오 메타데이터"""

    video_id: str
    title: Optional[str] = None
    view_count: Optional[int] = None
    published_at: Optional[str] = None


class AudioCue(BaseModel):
    """오디오 큐 (효과음/BGM 힌트)"""

    description: str
    source: Literal["transcript", "caption", "web"] = "transcript"


# ---------------------------------------------------------------------------
# StoryboardSlots — 메인 슬롯 컨테이너
# ---------------------------------------------------------------------------
class StoryboardSlots(BaseModel):
    """스토리보드 제작에 필요한 정보 슬롯

    Supervisor가 사용자 요청을 분석하여 초기 슬롯을 생성하고,
    Researcher가 데이터를 수집하면서 슬롯을 채운다.
    """

    # --- 필수 슬롯 ---
    visual_references: list[VisualReference] = Field(
        default_factory=list,
        description="캡션 데이터 (is_peak 구간). 최소 1개 권장.",
    )
    transcript_context: list[TranscriptChunk] = Field(
        default_factory=list,
        description="자막 텍스트. 최소 1개 필수.",
    )
    food_restaurant_info: list[FoodRestaurantInfo] = Field(
        default_factory=list,
        description="카테고리, 식당명, 메뉴 등.",
    )

    # --- 보조 슬롯 ---
    video_metadata: list[VideoMeta] = Field(
        default_factory=list,
        description="조회수, 제목, 업로드일 등 참고 정보.",
    )
    web_search_results: list[dict[str, Any]] = Field(
        default_factory=list,
        description="외부 검색 결과 (트렌드, 배경 지식).",
    )
    audio_cues: list[AudioCue] = Field(
        default_factory=list,
        description="효과음, BGM 힌트.",
    )

    # --- 메타 ---
    user_intent: str = Field(
        default="",
        description="사용자 원본 요청",
    )
    target_scene_count: int = Field(
        default=6,
        ge=4,
        le=12,
        description="목표 씬 수 (기본 6~8)",
    )

    # -----------------------------------------------------------------
    # 슬롯 충족도 평가
    # -----------------------------------------------------------------
    def unfilled_required(self) -> list[str]:
        """미충족 필수 슬롯 이름 반환"""
        missing = []
        if not self.transcript_context:
            missing.append("transcript_context")
        # visual_references는 0개여도 transcript로 대체 가능하므로 경고만
        if not self.visual_references:
            missing.append("visual_references")
        if not self.food_restaurant_info:
            missing.append("food_restaurant_info")
        return missing

    def is_sufficient(self) -> bool:
        """최소 조건 충족 여부: transcript 1개 이상이면 pass"""
        return len(self.transcript_context) >= 1

    def summary(self) -> str:
        """현재 슬롯 상태 요약 문자열"""
        lines = [
            f"visual_references: {len(self.visual_references)}개",
            f"transcript_context: {len(self.transcript_context)}개",
            f"food_restaurant_info: {len(self.food_restaurant_info)}개",
            f"video_metadata: {len(self.video_metadata)}개",
            f"web_search_results: {len(self.web_search_results)}개",
            f"audio_cues: {len(self.audio_cues)}개",
        ]
        unfilled = self.unfilled_required()
        if unfilled:
            lines.append(f"미충족 슬롯: {', '.join(unfilled)}")
        else:
            lines.append("모든 필수 슬롯 충족")
        return "\n".join(lines)
