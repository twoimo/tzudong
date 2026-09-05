"""Ops_Agent監視-조치 경계 로직 (platform-modernization 요구사항 15, 설계 C11 / D8).

이 모듈은 AI 운영 에이전트가 모니터링 신호를 감시하고 정해진 범위 안에서만
조치하도록 강제하는 순수 로직이다. ``backend/pipeline_control`` 전반의 규율
(``deployment_descriptor.py``, ``ledger_validation.py``, ``schedule.py``)을 따른다.

  * ``{"ok", "errorCode", ...}`` 딕셔너리 반환과 닫힌 고정 코드 집합.
  * 공급자·데이터베이스 오류 문자열, 신호 원문 본문, 자유 형식 진단을 절대
    노출하지 않는다 (Forbidden_Log_Field 제외, 요구사항 15.7, 15.11).
  * 실패 시 닫힘(fail closed): 판단할 수 없으면 조치를 수행하지 않는다.

핵심 불변식 (요구사항 15, 설계 C11 결정 흐름):

  1. 감시 입력은 두 원본만: Observability_Stack 알림, Log_Pipeline 심각도.
     폴링 주기는 60초 이하 (요구사항 15.1).
  2. 활성 Watch_Rule(신호 종류 + 심각도 임계값)을 충족하는 신호에 대해서만
     조치 후보가 생기고, **조치 실행 이전에** Agent_Action_Record를 생성한다
     (요구사항 15.2). 기록이 조치보다 먼저다 (요구사항 15.15).
  3. Agent_Action_Allowlist와 **정확히** 일치하는 조치 중 로컬 멱등 조치만
     사람 개별 승인 없이 수행한다. 외부 쓰기인 ``open_github_issue``는 원장에
     있더라도 결속된 사람 승인을 요구한다. 그 밖의 불일치는
     ``agent_action_not_allowlisted`` (요구사항 15.3, 15.4).
  4. 고위험 부류(외부 이슈 쓰기·Hosted 쓰기·마이그레이션·배포·롤백·브랜치
     보호·시크릿·DNS)는
     조치 식별자와 트리거 신호 식별자에 결속된 명명된 사람 승인 참조가 기록된
     이후에만 수행한다. 부재 시 대기 상태를 기록하고
     ``human_approval_required`` (요구사항 15.5, 15.6).
  5. 릴리스 자체 승인·감독기관 통지·정보주체 통지는 **어떤 승인 상태에서도**
     수행하지 않고 명명된 사람의 결정·실행 대기 상태로만 기록한다. Ops_Agent는
     릴리스 증거·배포 영수증·법령 준수 상태·통지 제출·접수 사실을 생성하거나
     충족 상태로 표기하지 않는다 (요구사항 15.13, 15.16).
  6. 동일 (트리거 신호 식별자, 조치 종류 식별자) 조합은 정확히 1회만.
     재요청은 ``agent_action_duplicate``이며, D8의 ``unique`` 제약이 데이터
     계층에서 이를 강제한다 (요구사항 15.8).
  7. 상한(슬라이딩 60분 10건, 일 40건)은 활성 운영자 승인 상한 파일에서만
     읽는다. 초과 시 ``agent_action_rate_limited`` (요구사항 15.9).
  8. 조치 실행 후 결과 확인이 최대 3회·총 60초 이내 성공하지 않으면 실패로
     기록하고 ``agent_action_unverified``를 반환하며 동일 트리거 신호
     식별자에 대한 후속 조치를 중단한다 (요구사항 15.10).
  9. 활성 허용목록을 읽을 수 없으면 ``agent_allowlist_unavailable``,
     Agent_Action_Record 생성이 확정되지 않으면
     ``agent_action_record_unavailable`` (요구사항 15.14, 15.15).

이 모듈은 자체 I/O로 허용목록·상한 파일 텍스트만 읽고(경로로 전달), 환경 변수를
읽지 않으며 원격 대상에 접속하지 않는다. 실제 조치 실행과 결과 확인은 호출자가
주입하는 콜러블에 위임한다.
"""

from __future__ import annotations

import json
import uuid
import threading
import math
import os
import select
import signal
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Mapping, MutableMapping, Optional, Sequence

# ---------------------------------------------------------------------------
# 고정 코드 (설계 C11 / 오류 코드 표). ``None`` == 정상.
# ---------------------------------------------------------------------------
AGENT_ACTION_NOT_ALLOWLISTED = "agent_action_not_allowlisted"  # 15.4
HUMAN_APPROVAL_REQUIRED = "human_approval_required"  # 15.6
AGENT_ACTION_DUPLICATE = "agent_action_duplicate"  # 15.8
AGENT_ACTION_RATE_LIMITED = "agent_action_rate_limited"  # 15.9
AGENT_ACTION_UNVERIFIED = "agent_action_unverified"  # 15.10
AGENT_ALLOWLIST_UNAVAILABLE = "agent_allowlist_unavailable"  # 15.14
AGENT_ACTION_RECORD_UNAVAILABLE = "agent_action_record_unavailable"  # 15.15

# 조치가 실제로 수행되고 결과 확인까지 성공했을 때 기록되는 양성 결과 코드.
# (오류 코드가 아니라 Agent_Action_Record.result_code에 저장되는 성공 토큰이다.)
AGENT_ACTION_PERFORMED = "agent_action_performed"

# 조치가 관측되지 않은(활성 Watch_Rule 미충족) 신호에 대한 내부 상태.
AGENT_ACTION_IDLE = "agent_action_idle"

AGENT_CODES = frozenset(
    {
        None,
        AGENT_ACTION_NOT_ALLOWLISTED,
        HUMAN_APPROVAL_REQUIRED,
        AGENT_ACTION_DUPLICATE,
        AGENT_ACTION_RATE_LIMITED,
        AGENT_ACTION_UNVERIFIED,
        AGENT_ALLOWLIST_UNAVAILABLE,
        AGENT_ACTION_RECORD_UNAVAILABLE,
    }
)

# ---------------------------------------------------------------------------
# 감시 입력 원본 (요구사항 15.1). 이 두 원본만 조치 근거로 쓴다.
# ---------------------------------------------------------------------------
SIGNAL_SOURCE_OBSERVABILITY = "observability_stack"
SIGNAL_SOURCE_LOG_PIPELINE = "log_pipeline"
ADMITTED_SIGNAL_SOURCES = frozenset(
    {SIGNAL_SOURCE_OBSERVABILITY, SIGNAL_SOURCE_LOG_PIPELINE}
)

# 폴링 주기 상한 (요구사항 15.1).
MAX_POLL_INTERVAL_SECONDS = 60

# 결과 확인 경계 (요구사항 15.10).
MAX_VERIFY_ATTEMPTS = 3
MAX_VERIFY_SECONDS = 60

# 심각도 순서 (닫힌 집합). Watch_Rule 임계값 비교에 쓴다.
SEVERITY_ORDER = ("info", "low", "warning", "medium", "high", "critical")
_SEVERITY_RANK = {name: rank for rank, name in enumerate(SEVERITY_ORDER)}

# 고위험 부류 — 결속된 명명된 사람 승인 참조 이후에만 수행 (요구사항 15.5).
HUMAN_APPROVAL_REQUIRED_CLASSES = frozenset(
    {
        "open_github_issue",
        "hosted_database_write",
        "hosted_migration_apply",
        "deployment_execution",
        "rollback_execution",
        "branch_protection_change",
        "secret_value_change",
        "dns_change",
    }
)

# 어떤 승인 상태에서도 수행하지 않는 항목 (요구사항 15.13, 15.16).
NEVER_PERFORMED_ACTIONS = frozenset(
    {
        "release_self_approval",
        "supervisory_authority_notification",
        "data_subject_notification",
    }
)

# Agent_Action_Record가 담을 수 있는 정확한 6개 필드 (요구사항 15.7, 설계 D8).
RECORD_FIELDS = (
    "action_id",
    "trigger_signal_id",
    "signal_severity",
    "action_kind_id",
    "result_code",
    "human_approval_ref",
)

# 식별자·참조 필드의 상한(자유 형식 유입 방지). 신호 원문 본문·진단은 애초에
# 이 스키마에 자리가 없다.
_MAX_FIELD_LENGTH = 200


def _result(ok: bool, error_code: Any, **extra: Any) -> dict:
    out: dict = {"ok": ok, "errorCode": error_code}
    out.update(extra)
    return out


def severity_rank(severity: Any) -> int:
    """심각도 토큰의 순위를 반환한다. 알 수 없으면 -1 (임계값 미충족 처리)."""

    if not isinstance(severity, str):
        return -1
    return _SEVERITY_RANK.get(severity.strip().lower(), -1)


def validate_poll_interval(seconds: Any) -> dict:
    """폴링 주기가 60초 이하인지 확인한다 (요구사항 15.1).

    ``{"ok": bool, "errorCode": None, "seconds": ...}``를 반환한다. 60초를
    초과하거나 양수가 아니면 ``ok=False``.
    """

    if not isinstance(seconds, (int, float)) or isinstance(seconds, bool):
        return _result(False, None, seconds=seconds, reason="not_a_number")
    if seconds <= 0:
        return _result(False, None, seconds=seconds, reason="non_positive")
    if seconds > MAX_POLL_INTERVAL_SECONDS:
        return _result(False, None, seconds=seconds, reason="exceeds_max")
    return _result(True, None, seconds=seconds)


def is_admitted_source(source: Any) -> bool:
    """감시 입력 원본이 허용된 두 원본 중 하나인지 (요구사항 15.1)."""

    return isinstance(source, str) and source in ADMITTED_SIGNAL_SOURCES


# ---------------------------------------------------------------------------
# 데이터 모델
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Signal:
    """감시 입력 신호. 조치 근거는 식별자와 심각도로만 기록한다 (요구사항 15.11).

    ``body``/``diagnostic`` 같은 원문 필드는 이 모델에 존재하지 않는다.
    """

    signal_id: str
    source: str
    kind: str
    severity: str


@dataclass(frozen=True)
class WatchRule:
    """활성 운영자 승인 감시 규칙 (요구사항 15.2).

    신호 종류와 심각도 임계값을 함께 충족할 때 ``action_kind_id`` 조치를 제안한다.
    """

    rule_id: str
    active: bool
    source: str
    kind: str
    min_severity: str
    action_kind_id: str


@dataclass(frozen=True)
class Approval:
    """조치 식별자와 트리거 신호 식별자에 결속된 명명된 사람 승인 참조 (요구사항 15.5)."""

    approval_ref: str
    approver_name: str
    action_kind_id: str
    trigger_signal_id: str

    def binds(self, trigger_signal_id: str, action_kind_id: str) -> bool:
        """승인이 특정 (트리거, 조치)에 결속되고 명명된 사람이 있는지."""

        return (
            isinstance(self.approval_ref, str)
            and bool(self.approval_ref.strip())
            and len(self.approval_ref) <= _MAX_FIELD_LENGTH
            and isinstance(self.approver_name, str)
            and bool(self.approver_name.strip())
            and len(self.approver_name) <= _MAX_FIELD_LENGTH
            and self.trigger_signal_id == trigger_signal_id
            and self.action_kind_id == action_kind_id
        )


@dataclass
class AgentActionRecord:
    """Agent_Action_Record — 정확히 6개 필드 (요구사항 15.7, 설계 D8).

    ``recorded_at``은 저장 계층의 기본값이며 6개 콘텐츠 필드에는 포함되지 않는다.
    신호 원문 본문·공급자 진단·자유 형식 오류 문자열을 담는 필드가 없다.
    """

    action_id: str
    trigger_signal_id: str
    signal_severity: str
    action_kind_id: str
    result_code: Optional[str] = None
    human_approval_ref: Optional[str] = None

    def to_row(self) -> dict:
        """D8 컬럼 집합으로 직렬화한다. 정확히 6개 콘텐츠 필드만."""

        return {name: getattr(self, name) for name in RECORD_FIELDS}


def assert_record_shape(row: Mapping[str, Any]) -> None:
    """레코드가 정확히 6개 허용 필드만 가지며 값이 경계 내인지 검증한다.

    Forbidden_Log_Field 유입(원문 본문·진단·자유 형식 문자열)을 방어한다.
    위반 시 ``ValueError``를 던진다 (요구사항 15.7, 15.11).
    """

    keys = set(row.keys())
    allowed = set(RECORD_FIELDS)
    extra = keys - allowed
    if extra:
        raise ValueError("agent_action_record_extra_field")
    missing = {"action_id", "trigger_signal_id", "signal_severity", "action_kind_id"} - keys
    if missing:
        raise ValueError("agent_action_record_missing_field")
    for name in ("action_id", "trigger_signal_id", "signal_severity", "action_kind_id"):
        value = row.get(name)
        if not isinstance(value, str) or not value.strip():
            raise ValueError("agent_action_record_invalid_field")
        if len(value) > _MAX_FIELD_LENGTH:
            raise ValueError("agent_action_record_field_too_long")
    for name in ("result_code", "human_approval_ref"):
        value = row.get(name)
        if value is None:
            continue
        if not isinstance(value, str) or len(value) > _MAX_FIELD_LENGTH:
            raise ValueError("agent_action_record_invalid_field")


# ---------------------------------------------------------------------------
# 저장 계층 (설계 D8: append-only, unique(trigger_signal_id, action_kind_id)).
# ---------------------------------------------------------------------------
# 저장소 프로토콜:
#   reserve(record) -> "created" | "duplicate" | "unavailable"
#       * 기록이 조치보다 먼저(요구사항 15.15). 6개 필드 중 트리거/심각도/조치
#         종류/action_id를 append-only로 삽입해 (트리거, 조치) 조합을 선점한다.
#       * unique 제약 위반이면 "duplicate" (요구사항 15.8).
#       * 그 밖의 확정 실패면 "unavailable" (요구사항 15.15).
#   record_result(action_id, result_code) -> bool
#       * 특권 기록자가 해당 행의 result_code를 기록한다. public 롤의
#         update/delete는 회수되어 있다(append-only 방어). 저장 계층 구현이
#         이 두 단계를 각자 방식으로 실현한다.


class InMemoryAgentActionStore:
    """테스트·기본용 인메모리 Agent_Action_Record 저장소.

    D8의 ``unique(trigger_signal_id, action_kind_id)``를 시뮬레이션한다. 실제
    배포에서는 Supabase ``local_analytics.agent_action_records`` 어댑터가 이
    프로토콜을 구현한다.
    """

    def __init__(self, *, fail_reserve: bool = False) -> None:
        self._rows: dict[tuple[str, str], dict] = {}
        self._by_action_id: dict[str, tuple[str, str]] = {}
        self._fail_reserve = fail_reserve
        self._budget_claims: dict[str, float] = {}
        self._budget_lock = threading.Lock()

    def trigger_state(self, trigger_signal_id: str) -> str:
        return 'halted' if any(
            row['trigger_signal_id'] == trigger_signal_id and row['result_code'] in
            {None, AGENT_ACTION_UNVERIFIED, AGENT_ACTION_RECORD_UNAVAILABLE}
            for row in self._rows.values()
        ) else 'clear'

    def claim_rate_budget(self, action_id: str, limits, now_seconds: float) -> str:
        """Shared-store admission; production uses a serialized database claim."""
        with self._budget_lock:
            if action_id not in self._by_action_id or not limits:
                return 'unavailable'
            if action_id in self._budget_claims:
                return 'duplicate'
            for limit in limits:
                cutoff = now_seconds - limit['windowMinutes'] * 60
                if sum(ts > cutoff for ts in self._budget_claims.values()) >= limit['maxActions']:
                    return 'limited'
            self._budget_claims[action_id] = now_seconds
            return 'created'

    def reserve(self, record: AgentActionRecord) -> str:
        if self._fail_reserve:
            return "unavailable"
        row = record.to_row()
        try:
            assert_record_shape(row)
        except ValueError:
            # 스키마 위반은 기록 확정 실패로 취급(fail closed).
            return "unavailable"
        key = (record.trigger_signal_id, record.action_kind_id)
        if key in self._rows:
            return "duplicate"
        self._rows[key] = dict(row)
        self._by_action_id[record.action_id] = key
        return "created"

    def record_result(self, action_id: str, result_code: Optional[str]) -> bool:
        key = self._by_action_id.get(action_id)
        if key is None or result_code not in (AGENT_CODES - {None}) | {AGENT_ACTION_PERFORMED}:
            return False
        if self._rows[key]["result_code"] is not None:
            return self._rows[key]["result_code"] == result_code
        self._rows[key]["result_code"] = result_code
        return True

    # 검사 편의(테스트에서만 사용).
    def rows(self) -> list[dict]:
        return [dict(row) for row in self._rows.values()]

    def performed_count(self) -> int:
        return sum(
            1 for row in self._rows.values() if row.get("result_code") == AGENT_ACTION_PERFORMED
        )


# ---------------------------------------------------------------------------
# 허용목록·상한 로딩 (fail closed).
# ---------------------------------------------------------------------------
def load_allowlist(path: str | Path) -> dict:
    """활성 운영자 승인 Agent_Action_Allowlist를 읽는다 (요구사항 15.3, 15.14).

    ``{"ok", "errorCode", "actionKinds": frozenset|None, "active": bool}``를
    반환한다. 파일을 읽을 수 없거나, 파싱 불가, 스키마 부적합, 또는 운영자 승인이
    활성이 아니면(승인자명 부재 / status != approved) 활성 허용목록을 확보할 수
    없으므로 ``agent_allowlist_unavailable``을 반환한다. 어떤 경우에도 공급자
    진단이나 파일 내용을 노출하지 않는다.
    """

    try:
        document = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError, UnicodeDecodeError):
        return _result(
            False, AGENT_ALLOWLIST_UNAVAILABLE, actionKinds=None, active=False
        )

    if not isinstance(document, Mapping):
        return _result(
            False, AGENT_ALLOWLIST_UNAVAILABLE, actionKinds=None, active=False
        )
    if document.get("kind") != "agent_action_allowlist":
        return _result(
            False, AGENT_ALLOWLIST_UNAVAILABLE, actionKinds=None, active=False
        )

    actions = document.get("actions")
    if not isinstance(actions, list) or not actions:
        return _result(
            False, AGENT_ALLOWLIST_UNAVAILABLE, actionKinds=None, active=False
        )

    action_kinds = set()
    for action in actions:
        if not isinstance(action, Mapping):
            return _result(
                False, AGENT_ALLOWLIST_UNAVAILABLE, actionKinds=None, active=False
            )
        kind = action.get("actionKindId")
        if not isinstance(kind, str) or not kind.strip():
            return _result(
                False, AGENT_ALLOWLIST_UNAVAILABLE, actionKinds=None, active=False
            )
        action_kinds.add(kind)

    active = _approval_is_active(document.get("approval"))
    if not active:
        # 파일은 읽혔으나 활성 운영자 승인이 아니다 → 활성 허용목록 부재로 닫힘.
        return _result(
            False,
            AGENT_ALLOWLIST_UNAVAILABLE,
            actionKinds=frozenset(action_kinds),
            active=False,
        )

    return _result(
        True, None, actionKinds=frozenset(action_kinds), active=True
    )


def load_rate_limits(path: str | Path) -> dict:
    """활성 운영자 승인 상한을 읽는다 (요구사항 15.9).

    ``{"ok", "errorCode", "limits": [...], "active": bool}``를 반환한다. 값은
    이 활성 승인 상한에서만 온다. 읽을 수 없거나 활성 승인이 아니면 상한을 확인할
    수 없으므로 ``active=False``로 표시하고, 이후 조치 판단에서 fail closed로
    처리(모든 조치를 ``agent_action_rate_limited``로 거부)한다.
    """

    try:
        document = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError, UnicodeDecodeError):
        return _result(False, None, limits=[], active=False)

    if not isinstance(document, Mapping) or document.get("kind") != "agent_action_rate_limits":
        return _result(False, None, limits=[], active=False)

    raw_limits = document.get("limits")
    if not isinstance(raw_limits, list) or not raw_limits:
        return _result(False, None, limits=[], active=False)

    limits: list[dict] = []
    for entry in raw_limits:
        if not isinstance(entry, Mapping):
            return _result(False, None, limits=[], active=False)
        window = entry.get("windowMinutes")
        max_actions = entry.get("maxActions")
        if not isinstance(window, int) or not isinstance(max_actions, int):
            return _result(False, None, limits=[], active=False)
        if isinstance(window, bool) or isinstance(max_actions, bool):
            return _result(False, None, limits=[], active=False)
        if window <= 0 or max_actions < 0:
            return _result(False, None, limits=[], active=False)
        limits.append(
            {
                "limitId": entry.get("limitId"),
                "windowMinutes": window,
                "maxActions": max_actions,
            }
        )

    active = _approval_is_active(document.get("approval"))
    return _result(active, None, limits=limits, active=active)


def _approval_is_active(approval: Any) -> bool:
    """명명된 사람의 활성 운영자 승인이 성립했는지.

    ``approverName``이 채워지고 ``status``가 ``approved``여야 한다. 커밋된
    원장은 ``approverName: null`` / ``status: unresolved``이므로 활성이 아니다.
    """

    if not isinstance(approval, Mapping):
        return False
    approver = approval.get("approverName")
    status = approval.get("status")
    return (
        isinstance(approver, str)
        and bool(approver.strip())
        and status == "approved"
    )


# ---------------------------------------------------------------------------
# 슬라이딩 상한 (요구사항 15.9).
# ---------------------------------------------------------------------------
class SlidingRateLimiter:
    """Local fast check; the store owns the shared durable execution budget.

    Attempts are counted before the executor runs, including interrupted or
    unverified attempts. Approval and allowlist denials consume no budget.
    Missing active limits fail closed. A new limiter cannot reset store claims.
    """

    def __init__(self, limits: Sequence[Mapping[str, Any]], *, active: bool = True) -> None:
        self._limits = [dict(limit) for limit in limits]
        self._active = active and bool(self._limits)
        self._performed_seconds: list[float] = []

    @property
    def active(self) -> bool:
        return self._active

    @property
    def limits(self) -> list[dict]:
        return [dict(limit) for limit in self._limits] if self._active else []

    def would_exceed(self, now_seconds: float) -> bool:
        """지금 조치를 하나 더 수행하면 어느 상한이라도 초과하는지."""

        if not self._active:
            # 상한을 확인할 수 없다 → fail closed로 초과 취급.
            return True
        for limit in self._limits:
            window_seconds = float(limit["windowMinutes"]) * 60.0
            cutoff = now_seconds - window_seconds
            count = sum(1 for ts in self._performed_seconds if ts > cutoff)
            if count >= int(limit["maxActions"]):
                return True
        return False

    def record_performed(self, now_seconds: float) -> None:
        """실제 수행된 조치의 타임스탬프를 기록한다."""

        self._performed_seconds.append(now_seconds)


# ---------------------------------------------------------------------------
# Watch_Rule 매칭 (요구사항 15.2).
# ---------------------------------------------------------------------------
def match_watch_rule(
    signal: Signal, rules: Sequence[WatchRule]
) -> Optional[WatchRule]:
    """신호를 충족하는 첫 활성 Watch_Rule을 반환한다. 없으면 ``None``.

    허용된 두 원본이 아니거나(요구사항 15.1) 신호 종류·심각도 임계값을 함께
    충족하는 활성 규칙이 없으면 ``None`` (조치 없음).
    """

    if not is_admitted_source(signal.source):
        return None
    signal_rank = severity_rank(signal.severity)
    if signal_rank < 0:
        return None
    for rule in rules:
        if not rule.active:
            continue
        if rule.source != signal.source or rule.kind != signal.kind:
            continue
        threshold = severity_rank(rule.min_severity)
        if threshold < 0:
            continue
        if signal_rank >= threshold:
            return rule
    return None


def classify_action(action_kind_id: str, allowlist_kinds: frozenset) -> str:
    """조치 종류를 분류한다.

    반환값: ``"never_performed"``, ``"high_risk"``, ``"allowlisted"``,
    ``"not_allowlisted"``. never_performed는 어떤 승인에서도 수행 불가라 가장
    먼저 판정한다 (요구사항 15.13, 15.16).
    """

    if action_kind_id in NEVER_PERFORMED_ACTIONS:
        return "never_performed"
    if action_kind_id in HUMAN_APPROVAL_REQUIRED_CLASSES:
        return "high_risk"
    if action_kind_id in allowlist_kinds:
        return "allowlisted"
    return "not_allowlisted"


# ---------------------------------------------------------------------------
# Ops_Agent
# ---------------------------------------------------------------------------
@dataclass
class OpsAgent:
    """감시 입력을 평가하고 경계 안에서만 조치하는 Ops_Agent.

    의존성은 모두 주입한다:
      * ``allowlist_kinds``: 활성 허용목록의 조치 종류 집합 (``load_allowlist``).
      * ``rate_limiter``: 슬라이딩 상한 강제기.
      * ``store``: Agent_Action_Record 저장소 (reserve / record_result).
      * ``executor``: ``action_kind_id -> None`` 로컬 조치 실행 콜러블(부작용).
      * ``verifier``: ``action_kind_id -> bool`` 결과 확인 콜러블.
      * ``clock``: 단조 초 시각 콜러블 (기본 ``time.monotonic``).
    """

    allowlist_kinds: frozenset
    rate_limiter: SlidingRateLimiter
    store: Any
    executor: Callable[[str], None]
    verifier: Callable[[str], bool]
    clock: Callable[[], float] = None  # type: ignore[assignment]
    _halted_triggers: set = field(default_factory=set)

    def __post_init__(self) -> None:
        if self.clock is None:
            import time

            self.clock = time.monotonic

    def process_signal(
        self,
        signal: Signal,
        rules: Sequence[WatchRule],
        *,
        approval: Optional[Approval] = None,
    ) -> dict:
        """하나의 감시 신호를 평가하고 조치 경계를 강제한다 (요구사항 15 전반).

        설계 C11 결정 흐름을 따른다: 허용목록 활성 → Watch_Rule 매칭 → 기록 확정
        (조치보다 먼저) → 중복 → 상한 → 조치 분류/승인 → 실행 → 결과 확인.
        """

        # 감시 입력 원본 제한 (요구사항 15.1).
        if not is_admitted_source(signal.source):
            return _result(
                False,
                None,
                performed=False,
                resultCode=AGENT_ACTION_IDLE,
                reason="source_not_admitted",
                triggerSignalId=signal.signal_id,
            )

        # 동일 트리거 후속 중단 (요구사항 15.10).
        try:
            trigger_state = self.store.trigger_state(signal.signal_id)
        except Exception:
            trigger_state = 'unavailable'
        if trigger_state not in {'clear', 'halted'}:
            return _result(False, AGENT_ACTION_RECORD_UNAVAILABLE, performed=False,
                           resultCode=AGENT_ACTION_RECORD_UNAVAILABLE, halted=True,
                           triggerSignalId=signal.signal_id)
        if signal.signal_id in self._halted_triggers or trigger_state == 'halted':
            return _result(
                False,
                AGENT_ACTION_UNVERIFIED,
                performed=False,
                resultCode=AGENT_ACTION_UNVERIFIED,
                halted=True,
                triggerSignalId=signal.signal_id,
            )

        # 활성 Watch_Rule 매칭 (요구사항 15.2). 없으면 조치 없음.
        rule = match_watch_rule(signal, rules)
        if rule is None:
            return _result(
                False,
                None,
                performed=False,
                resultCode=AGENT_ACTION_IDLE,
                triggerSignalId=signal.signal_id,
            )

        return self._evaluate_action(
            trigger_signal_id=signal.signal_id,
            signal_severity=signal.severity,
            action_kind_id=rule.action_kind_id,
            approval=approval,
        )

    def _evaluate_action(
        self,
        *,
        trigger_signal_id: str,
        signal_severity: str,
        action_kind_id: str,
        approval: Optional[Approval],
    ) -> dict:
        action_id = str(uuid.uuid4())

        # 승인이 결속되어 있으면 기록에 참조를 담는다(고위험 수행 경로에서만
        # 유효). 그 밖엔 null.
        bound_ref: Optional[str] = None
        if (
            approval is not None
            and isinstance(approval, Approval)
            and approval.binds(trigger_signal_id, action_kind_id)
        ):
            bound_ref = approval.approval_ref

        # 기록이 조치보다 먼저 (요구사항 15.2, 15.15). reserve가 (트리거, 조치)
        # 조합을 append-only로 선점하고 D8 unique 제약이 중복을 강제한다.
        record = AgentActionRecord(
            action_id=action_id,
            trigger_signal_id=trigger_signal_id,
            signal_severity=signal_severity,
            action_kind_id=action_kind_id,
            result_code=None,
            human_approval_ref=bound_ref,
        )
        reservation = self.store.reserve(record)

        if reservation == "duplicate":
            # 동일 조합 재요청 (요구사항 15.8).
            return self._deny(
                action_id,
                action_kind_id,
                trigger_signal_id,
                AGENT_ACTION_DUPLICATE,
                write_result=False,
            )
        if reservation != "created":
            # 기록 생성 미확정 (요구사항 15.15). 조치를 실행하지 않는다.
            return self._deny(
                action_id,
                action_kind_id,
                trigger_signal_id,
                AGENT_ACTION_RECORD_UNAVAILABLE,
                write_result=False,
            )

        now = float(self.clock())

        # 상한 초과 확인 (요구사항 15.9). 수행 이전.
        if self.rate_limiter.would_exceed(now):
            return self._deny(
                action_id,
                action_kind_id,
                trigger_signal_id,
                AGENT_ACTION_RATE_LIMITED,
            )

        # 조치 분류.
        category = classify_action(action_kind_id, self.allowlist_kinds)

        if category == "never_performed":
            # 어떤 승인 상태에서도 수행하지 않는다 (요구사항 15.13, 15.16).
            # 명명된 사람의 결정·실행 대기 상태로만 기록한다.
            if not self._record_terminal(action_id, AGENT_ACTION_NOT_ALLOWLISTED):
                return self._deny(action_id, action_kind_id, trigger_signal_id,
                                  AGENT_ACTION_RECORD_UNAVAILABLE, write_result=False)
            return _result(
                False,
                AGENT_ACTION_NOT_ALLOWLISTED,
                performed=False,
                resultCode=AGENT_ACTION_NOT_ALLOWLISTED,
                neverPerformed=True,
                humanDecisionPending=True,
                actionId=action_id,
                actionKindId=action_kind_id,
                triggerSignalId=trigger_signal_id,
            )

        if category == "not_allowlisted":
            # 정확히 일치하지 않음 (요구사항 15.4).
            return self._deny(
                action_id,
                action_kind_id,
                trigger_signal_id,
                AGENT_ACTION_NOT_ALLOWLISTED,
            )

        if category == "high_risk":
            # 결속된 명명된 사람 승인 참조 이후에만 수행 (요구사항 15.5, 15.6).
            if bound_ref is None:
                return self._deny(
                    action_id,
                    action_kind_id,
                    trigger_signal_id,
                    HUMAN_APPROVAL_REQUIRED,
                )
            # 승인이 결속됨 → 수행 경로로 진행.

        # Commit a shared budget claim before executing. An interrupted or
        # unverified attempt remains counted; rejected approvals consume none.
        try:
            budget = self.store.claim_rate_budget(action_id, self.rate_limiter.limits, now)
        except Exception:
            budget = 'unavailable'
        if budget != 'created':
            code = AGENT_ACTION_RATE_LIMITED if budget == 'limited' else AGENT_ACTION_RECORD_UNAVAILABLE
            return self._deny(action_id, action_kind_id, trigger_signal_id, code)
        self.rate_limiter.record_performed(now)

        # 여기부터 실제 로컬 조치 실행 (요구사항 15.3 / 15.5 승인 경로).
        try:
            self.executor(action_kind_id)
        except Exception:
            # 실행기 실패를 검증기의 성공 응답으로 덮어쓰지 않는다. 외부/로컬
            # 공급자 진단은 노출하지 않고 고정 코드로 닫으며 동일 트리거의 후속
            # 조치를 중단한다.
            self._halted_triggers.add(trigger_signal_id)
            return self._deny(
                action_id,
                action_kind_id,
                trigger_signal_id,
                AGENT_ACTION_UNVERIFIED,
                performed=True,
                halted=True,
            )

        verified = self._verify(action_kind_id, now)
        if not verified:
            # 결과 확인 실패 → 실패로 기록하고 동일 트리거 후속 중단 (요구사항 15.10).
            self._halted_triggers.add(trigger_signal_id)
            return self._deny(
                action_id,
                action_kind_id,
                trigger_signal_id,
                AGENT_ACTION_UNVERIFIED,
                performed=True,
                halted=True,
            )

        # 수행·확인 성공. 상한 집계에 반영하고 결과 코드 기록.
        if not self._record_terminal(action_id, AGENT_ACTION_PERFORMED):
            self._halted_triggers.add(trigger_signal_id)
            return self._deny(action_id, action_kind_id, trigger_signal_id,
                              AGENT_ACTION_RECORD_UNAVAILABLE, performed=True,
                              halted=True, write_result=False)
        return _result(
            True,
            None,
            performed=True,
            resultCode=AGENT_ACTION_PERFORMED,
            actionId=action_id,
            actionKindId=action_kind_id,
            triggerSignalId=trigger_signal_id,
            humanApprovalRef=bound_ref,
        )

    def _record_terminal(self, action_id: str, code: str) -> bool:
        try:
            return self.store.record_result(action_id, code) is True
        except Exception:
            return False

    def _verify(self, action_kind_id: str, start_seconds: float) -> bool:
        """At most three read-only probes, bounded by a killable process.

        Callbacks run in an isolated single-threaded POSIX worker, and must open
        their own readback resources. Only a boolean crosses the pipe. Unsafe
        fork contexts fail closed; no background thread can outlive a timeout.
        Both the injected clock and real wall time enforce the total deadline.
        """
        if (not hasattr(os, 'fork') or threading.current_thread() is not threading.main_thread()
                or threading.active_count() != 1):
            return False
        try:
            remaining = MAX_VERIFY_SECONDS - (float(self.clock()) - start_seconds)
            if not math.isfinite(remaining) or not 0 < remaining <= MAX_VERIFY_SECONDS:
                return False
            deadline = time.monotonic() + remaining
            reader, writer = os.pipe()
        except Exception:
            return False
        pid = None
        try:
            pid = os.fork()
            if pid == 0:
                os.close(reader)
                try:
                    os.setsid()
                    # Callback diagnostics must never reach logs or receipts.
                    with open(os.devnull, 'wb') as sink:
                        os.dup2(sink.fileno(), 1)
                        os.dup2(sink.fileno(), 2)
                    result = False
                    for _ in range(MAX_VERIFY_ATTEMPTS):
                        if time.monotonic() >= deadline or float(self.clock()) - start_seconds >= MAX_VERIFY_SECONDS:
                            break
                        observed = self.verifier(action_kind_id) is True
                        if time.monotonic() >= deadline or float(self.clock()) - start_seconds >= MAX_VERIFY_SECONDS:
                            break
                        if observed:
                            result = True
                            break
                    os.write(writer, b'1' if result else b'0')
                except BaseException:
                    pass
                finally:
                    os._exit(0)
            os.close(writer)
            writer = None
            ready, _, _ = select.select([reader], [], [], max(0, deadline - time.monotonic()))
            return (bool(ready) and os.read(reader, 1) == b'1'
                    and time.monotonic() < deadline
                    and float(self.clock()) - start_seconds < MAX_VERIFY_SECONDS)
        except Exception:
            return False
        finally:
            os.close(reader)
            if writer is not None:
                os.close(writer)
            if pid is not None and pid > 0:
                # Kill the worker's group even after a result, so no probe
                # descendant survives. A pre-setsid race still kills the child.
                try:
                    os.killpg(pid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    try:
                        os.kill(pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                os.waitpid(pid, 0)

    def _deny(
        self,
        action_id: str,
        action_kind_id: str,
        trigger_signal_id: str,
        code: str,
        *,
        performed: bool = False,
        halted: bool = False,
        write_result: bool = True,
    ) -> dict:
        """조치를 수행하지 않고 결과 코드를 기록한 뒤 거부 결과를 반환한다."""

        if write_result and not self._record_terminal(action_id, code):
            code = AGENT_ACTION_RECORD_UNAVAILABLE
            self._halted_triggers.add(trigger_signal_id)
            halted = True
        out = _result(
            False,
            code,
            performed=performed,
            resultCode=code,
            actionId=action_id,
            actionKindId=action_kind_id,
            triggerSignalId=trigger_signal_id,
        )
        if halted:
            out["halted"] = True
        return out


def build_agent_from_files(
    *,
    allowlist_path: str | Path,
    rate_limits_path: str | Path,
    store: Any,
    executor: Callable[[str], None],
    verifier: Callable[[str], bool],
    clock: Optional[Callable[[], float]] = None,
) -> dict:
    """파일에서 활성 허용목록·상한을 읽어 Ops_Agent를 구성한다 (fail closed).

    허용목록이 활성이 아니거나 읽을 수 없으면 조치를 수행할 수 없으므로
    ``{"ok": False, "errorCode": "agent_allowlist_unavailable", "agent": None}``
    을 반환한다 (요구사항 15.14). 상한이 비활성이면 상한을 확인할 수 없으므로
    rate_limiter를 비활성으로 구성해 이후 모든 조치가 fail closed로 거부되게
    한다 (요구사항 15.9).
    """

    allowlist = load_allowlist(allowlist_path)
    if not allowlist["ok"]:
        return _result(False, AGENT_ALLOWLIST_UNAVAILABLE, agent=None)

    limits = load_rate_limits(rate_limits_path)
    rate_limiter = SlidingRateLimiter(limits["limits"], active=limits["active"])

    agent = OpsAgent(
        allowlist_kinds=allowlist["actionKinds"],
        rate_limiter=rate_limiter,
        store=store,
        executor=executor,
        verifier=verifier,
        clock=clock,
    )
    return _result(True, None, agent=agent, rateLimitsActive=limits["active"])
