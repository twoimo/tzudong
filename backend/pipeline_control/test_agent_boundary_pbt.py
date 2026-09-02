"""Property-based test for the Ops_Agent action boundary.

Feature: platform-modernization, Property 35: 에이전트 조치 경계.

For *any* set of action requests (allowlisted and non-allowlisted action kinds,
high- and low-risk classes, with and without a bound named-human approval
reference, including duplicate trigger+action combinations, and the three
absolutely-forbidden classes — release self-approval, supervisory-authority
notification, data-subject notification), across the actions actually performed:

  * the count of action kinds absent from the Agent_Action_Allowlist is 0;
  * the count of high-risk-class actions (hosted write / hosted migration /
    deployment / rollback / branch protection / secret value / DNS) performed
    without a bound named-human approval reference is 0;
  * the count of release self-approval / supervisory-authority notification /
    data-subject notification actions is 0 even when an approval reference is
    present; and
  * any single (trigger_signal_id, action_kind_id) combination is performed at
    most once.

Uses Python ``hypothesis`` with ``max_examples=100`` and runs under
``python -m unittest``.

Validates: Requirements 15.3, 15.4, 15.5, 15.6, 15.8, 15.12, 15.16
"""

from __future__ import annotations

import unittest

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.pipeline_control import ops_agent as oa

# 활성 허용목록의 6개 로컬 멱등 조치.
_ALLOWLIST_KINDS = frozenset(
    {
        "restart_local_container",
        "requeue_failed_pipeline_task",
        "flush_log_pending_queue",
        "open_github_issue",
        "capture_diagnostic_snapshot",
        "scale_local_worker_concurrency",
    }
)

# 요청 생성기가 뽑는 조치 종류 어휘: 허용목록(저위험) + 고위험 부류 +
# 절대 금지 3부류(never-performed) + 미등록(허용목록 밖).
_ACTION_VOCAB = (
    sorted(_ALLOWLIST_KINDS)
    + sorted(oa.HUMAN_APPROVAL_REQUIRED_CLASSES)
    + sorted(oa.NEVER_PERFORMED_ACTIONS)
    + ["unknown_action_a", "delete_prod_table", "reboot_host"]
)


class _FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def _rule_for(
    action_kind_id: str, source: str = oa.SIGNAL_SOURCE_OBSERVABILITY
) -> oa.WatchRule:
    return oa.WatchRule(
        rule_id="r",
        active=True,
        source=source,
        kind="k",
        min_severity="low",
        action_kind_id=action_kind_id,
    )


def action_requests() -> st.SearchStrategy:
    """조치 요청 목록 생성기.

    각 요청은 ``(trigger_signal_id, action_kind_id, has_approval)`` 삼중항이다.
    조치 어휘는 허용목록 내·외, 고·저위험, 절대 금지 3부류를 모두 포함하며,
    ``has_approval``로 명명된 사람 승인 참조 유·무를 뽑는다. 트리거는 작은
    집합에서 뽑아 동일 (트리거, 조치) 조합 중복이 자연히 발생하게 한다.
    """

    return st.lists(
        st.tuples(
            st.sampled_from(["t0", "t1", "t2", "t3", "t4"]),
            st.sampled_from(_ACTION_VOCAB),
            st.booleans(),
        ),
        min_size=0,
        max_size=40,
    )


class AgentActionBoundaryProperty(unittest.TestCase):
    # Feature: platform-modernization, Property 35: 에이전트 조치 경계.
    @settings(max_examples=100, deadline=None)
    @given(requests=action_requests())
    def test_property_35_action_boundary(self, requests):
        clock = _FakeClock()
        store = oa.InMemoryAgentActionStore()
        # 넉넉한 상한으로 상한 요인을 배제하고 경계 자체를 검증.
        limits = [
            {"limitId": "sliding_60m", "windowMinutes": 60, "maxActions": 10_000},
            {"limitId": "daily", "windowMinutes": 1440, "maxActions": 10_000},
        ]
        agent = oa.OpsAgent(
            allowlist_kinds=_ALLOWLIST_KINDS,
            rate_limiter=oa.SlidingRateLimiter(limits, active=True),
            store=store,
            executor=lambda kind: None,
            verifier=lambda kind: True,
            clock=clock,
        )

        performed = []  # (trigger, action_kind, human_approval_ref)
        for trigger, action_kind, has_approval in requests:
            approval = None
            if has_approval:
                approval = oa.Approval(
                    approval_ref="APR-" + trigger,
                    approver_name="Named Operator",
                    action_kind_id=action_kind,
                    trigger_signal_id=trigger,
                )
            signal = oa.Signal(
                signal_id=trigger,
                source=oa.SIGNAL_SOURCE_OBSERVABILITY,
                kind="k",
                severity="critical",
            )
            result = agent.process_signal(
                signal, [_rule_for(action_kind)], approval=approval
            )
            if result.get("performed") and result.get("ok"):
                performed.append((trigger, action_kind, result.get("humanApprovalRef")))

        # 1) 허용목록 밖(저위험 미등록) 조치 수행 건수는 0.
        non_allowlisted = [
            p
            for p in performed
            if p[1] not in _ALLOWLIST_KINDS
            and p[1] not in oa.HUMAN_APPROVAL_REQUIRED_CLASSES
        ]
        self.assertEqual(non_allowlisted, [])

        # 2) 결속된 승인 참조 없이 수행된 고위험 부류 건수는 0.
        high_risk_no_approval = [
            p
            for p in performed
            if p[1] in oa.HUMAN_APPROVAL_REQUIRED_CLASSES and not p[2]
        ]
        self.assertEqual(high_risk_no_approval, [])

        # 3) 절대 금지 3부류는 승인이 있어도 수행 0.
        never = [p for p in performed if p[1] in oa.NEVER_PERFORMED_ACTIONS]
        self.assertEqual(never, [])

        # 4) 동일 (트리거, 조치) 조합의 수행 횟수는 1 이하.
        combos = [(p[0], p[1]) for p in performed]
        self.assertEqual(len(combos), len(set(combos)))

        # 저장소 관점에서도 수행 성공 행 수가 combos 집합 크기와 일치.
        self.assertEqual(store.performed_count(), len(set(combos)))


if __name__ == "__main__":
    unittest.main()
