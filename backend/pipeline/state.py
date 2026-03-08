"""
파이프라인 그래프 상태(State) 정의.

PipelineState: Phase 3 전체 그래프의 공유 상태.
VideoState: 개별 비디오 처리 결과 추적.
ValidationError: 검증 실패 상세 정보.
ReviewItem: 관리자 리뷰 큐 항목.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Annotated, Any, TypedDict

from operator import add


# ─── 열거형 ───────────────────────────────────────────────

class StepName(str, Enum):
    """파이프라인 단계 이름"""
    ENRICH = "enrich"              # Step 6.1
    GEMINI = "gemini_crawling"     # Step 7
    TARGET = "target_selection"    # Step 8
    RULE = "rule_evaluation"       # Step 9
    LAAJ = "laaj_evaluation"       # Step 10
    TRANSFORM = "transform"       # Step 11
    INSERT = "supabase_insert"    # Step 12


class ValidationSeverity(str, Enum):
    """검증 실패 심각도"""
    ERROR = "error"      # 진행 불가 - 리뷰 큐로 이동
    WARNING = "warning"  # 경고만, 진행 가능
    INFO = "info"        # 참고 정보


class ReviewStatus(str, Enum):
    """리뷰 큐 항목 상태"""
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    MODIFIED = "modified"


# ─── 데이터 클래스 ─────────────────────────────────────────

@dataclass
class ValidationError:
    """개별 검증 실패 상세"""
    step: str
    video_id: str
    restaurant_name: str | None
    severity: str            # ValidationSeverity value
    rule: str                # 검증 규칙 이름 (예: "required_field", "coordinate_range")
    message: str             # 사람이 읽을 수 있는 설명
    field_path: str = ""     # 문제 필드 경로 (예: "restaurants[0].address")
    actual_value: Any = None # 실제 값


@dataclass
class ReviewItem:
    """관리자 리뷰 대기 항목"""
    video_id: str
    step: str
    errors: list[dict]       # ValidationError를 dict로 직렬화한 목록
    original_data: dict      # 원본 데이터
    status: str = ReviewStatus.PENDING.value
    admin_note: str = ""
    modified_data: dict | None = None


# ─── LangGraph State ──────────────────────────────────────

class PipelineState(TypedDict):
    """Phase 3 LangGraph StateGraph 상태 정의"""

    # ── 입력 (불변) ──
    channel: str
    crawling_path: str
    evaluation_path: str
    dry_run: bool
    max_videos: int               # -1 = 전체

    # ── 단계별 처리 대상 video_id 목록 ──
    video_ids: list[str]          # 전체 대상

    # ── 현재 진행 상태 ──
    current_step: str             # StepName value

    # ── 단계별 처리 결과 (성공 video_id 목록, append) ──
    completed_enrich: Annotated[list[str], add]
    completed_gemini: Annotated[list[str], add]
    completed_target: Annotated[list[str], add]
    completed_rule: Annotated[list[str], add]
    completed_laaj: Annotated[list[str], add]
    completed_transform: Annotated[list[str], add]
    completed_insert: Annotated[list[str], add]

    # ── 검증 결과 ──
    validation_errors: Annotated[list[dict], add]  # ValidationError as dict
    review_queue: Annotated[list[dict], add]        # ReviewItem as dict
    failed_video_ids: Annotated[list[str], add]     # 검증 실패로 제외된 video_id

    # ── 품질 메트릭 ──
    total_restaurants: int
    validated_restaurants: int
    quality_score: float          # 0.0 ~ 1.0

    # ── 실행 리포트 ──
    step_timings: Annotated[list[dict], add]  # {"step": str, "duration_sec": float}
    summary: str                  # 최종 리포트 텍스트


def create_initial_state(
    channel: str,
    crawling_path: str,
    evaluation_path: str,
    dry_run: bool = False,
    max_videos: int = -1,
) -> PipelineState:
    """초기 상태 생성"""
    return PipelineState(
        channel=channel,
        crawling_path=crawling_path,
        evaluation_path=evaluation_path,
        dry_run=dry_run,
        max_videos=max_videos,
        video_ids=[],
        current_step="",
        completed_enrich=[],
        completed_gemini=[],
        completed_target=[],
        completed_rule=[],
        completed_laaj=[],
        completed_transform=[],
        completed_insert=[],
        validation_errors=[],
        review_queue=[],
        failed_video_ids=[],
        total_restaurants=0,
        validated_restaurants=0,
        quality_score=1.0,
        step_timings=[],
        summary="",
    )
