"""공용 Pydantic 모델 — Task, Intern 보고서 등

모든 에이전트가 공유하는 데이터 모델을 정의한다.
state/ 패키지는 외부 모듈을 import하지 않는다 (pydantic, typing만 사용).
"""

from __future__ import annotations

from typing import Optional, Literal

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Supervisor → Researcher/Intern 업무 분배
# ---------------------------------------------------------------------------
class Task(BaseModel):
    """Supervisor가 생성하는 업무 단위"""

    task_id: str = Field(description="고유 업무 식별자 (예: 'search-떡볶이-01')")
    agent: Literal["researcher", "intern"] = Field(description="업무를 수행할 에이전트")
    instruction: str = Field(description="구체적 지시사항")
    priority: int = Field(
        default=2,
        ge=1,
        le=3,
        description="1=높음, 2=보통, 3=낮음",
    )


# ---------------------------------------------------------------------------
# Intern 산출물 — 불가능 항목 보고서
# ---------------------------------------------------------------------------
class InfeasibleItem(BaseModel):
    """현재 데이터로 구현 불가능한 항목"""

    item_name: str
    item_type: Literal["rpc_function", "tool"]
    reason: str = Field(description="불가 사유")
    required_data: list[str] = Field(
        default_factory=list,
        description="필요하지만 없는 데이터",
    )
    suggested_action: str = Field(description="해결 방안 제안")


class InfeasibilityReport(BaseModel):
    """불가능 항목 종합 보고서"""

    items: list[InfeasibleItem]
    summary: str


# ---------------------------------------------------------------------------
# Intern 산출물 — 메타데이터 구축 제안서
# ---------------------------------------------------------------------------
class MetadataProposal(BaseModel):
    """메타데이터 구축 제안"""

    field_name: str
    source_table: str = Field(description="원본 테이블")
    extraction_method: str = Field(description="추출 방법")
    expected_benefit: str = Field(description="기대 효과")
    implementation_effort: Literal["low", "medium", "high"]


class MetadataProposalReport(BaseModel):
    """메타데이터 구축 제안서"""

    proposals: list[MetadataProposal]
    priority_order: list[str] = Field(description="추천 구축 순서")
    summary: str


# ---------------------------------------------------------------------------
# Designer 피드백 분류
# ---------------------------------------------------------------------------
class StoryboardFeedbackClassification(BaseModel):
    """스토리보드 피드백 분류"""

    action: Literal["edit_storyboard", "need_research", "approved"] = Field(
        description="edit_storyboard: 즉시 수정, need_research: 추가 조사, approved: 승인"
    )
    edit_instruction: Optional[str] = Field(
        default=None,
        description="edit일 때 수정 지시",
    )
    research_query: Optional[str] = Field(
        default=None,
        description="research일 때 조사 내용",
    )
