"""Property-based tests for the Ops_Agent sliding rate cap.

Feature: platform-modernization, Property 36: 에이전트 슬라이딩 상한.

For *any* sequence of action-request timestamps, within any 60-minute sliding
window the number of performed actions is at most the active operator-approved
cap (10), the daily (24h = 1440-minute) cumulative count is at most the hard
cap (40), and every request that would exceed a cap performs no action and
returns ``agent_action_rate_limited``.

Property 35 (에이전트 조치 경계) lives in ``test_agent_boundary_pbt.py`` — the
canonical file for that property. This module is the canonical home for
Property 36.

Uses Python ``hypothesis`` and runs under ``python -m unittest``.

Validates: Requirements 15.9
"""

from __future__ import annotations

import unittest

from hypothesis import given, settings
from hypothesis import strategies as st

from backend.pipeline_control import ops_agent as oa

# 원장의 5개 로컬 멱등 조치와 사람 승인이 필요한 외부 이슈 조치.
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


class AgentSlidingCapProperty(unittest.TestCase):
    # Feature: platform-modernization, Property 36: 에이전트 슬라이딩 상한.

    @settings(max_examples=100, deadline=None)
    @given(
        count=st.integers(min_value=0, max_value=25),
    )
    def test_property_36_sliding_cap(self, count):
        # 동일 60분 창 안에서 count건을 서로 다른 트리거로 요청. 상한 10.
        clock = _FakeClock()
        store = oa.InMemoryAgentActionStore()
        limits = [
            {"limitId": "sliding_60m", "windowMinutes": 60, "maxActions": 10},
            {"limitId": "daily", "windowMinutes": 1440, "maxActions": 40},
        ]
        agent = oa.OpsAgent(
            allowlist_kinds=_ALLOWLIST_KINDS,
            rate_limiter=oa.SlidingRateLimiter(limits, active=True),
            store=store,
            executor=lambda kind: None,
            verifier=lambda kind: True,
            clock=clock,
        )

        performed = 0
        rate_limited = 0
        for i in range(count):
            signal = oa.Signal(
                signal_id=f"t{i}",
                source=oa.SIGNAL_SOURCE_LOG_PIPELINE,
                kind="k",
                severity="high",
            )
            result = agent.process_signal(
                signal,
                [_rule_for("restart_local_container", oa.SIGNAL_SOURCE_LOG_PIPELINE)],
            )
            if result.get("performed") and result.get("ok"):
                performed += 1
            elif result.get("errorCode") == oa.AGENT_ACTION_RATE_LIMITED:
                rate_limited += 1

        # 창 안 수행 건수는 상한(10) 이하.
        self.assertLessEqual(performed, 10)
        # 상한을 초과하는 요청은 전부 rate_limited로 거부.
        self.assertEqual(performed, min(count, 10))
        self.assertEqual(rate_limited, max(0, count - 10))

    @settings(max_examples=100, deadline=None)
    @given(
        offsets=st.lists(
            st.integers(min_value=0, max_value=24 * 60), min_size=0, max_size=60
        )
    )
    def test_property_36_daily_hard_cap(self, offsets):
        # 하루(1440분) 창 안 임의 분포 요청에서 수행 건수는 하드 캡(40) 이하.
        clock = _FakeClock()
        store = oa.InMemoryAgentActionStore()
        limits = [
            {"limitId": "sliding_60m", "windowMinutes": 60, "maxActions": 10},
            {"limitId": "daily", "windowMinutes": 1440, "maxActions": 40},
        ]
        agent = oa.OpsAgent(
            allowlist_kinds=_ALLOWLIST_KINDS,
            rate_limiter=oa.SlidingRateLimiter(limits, active=True),
            store=store,
            executor=lambda kind: None,
            verifier=lambda kind: True,
            clock=clock,
        )

        performed = 0
        for i, minute in enumerate(sorted(offsets)):
            clock.now = float(minute) * 60.0
            signal = oa.Signal(
                signal_id=f"t{i}",
                source=oa.SIGNAL_SOURCE_LOG_PIPELINE,
                kind="k",
                severity="high",
            )
            result = agent.process_signal(
                signal,
                [_rule_for("restart_local_container", oa.SIGNAL_SOURCE_LOG_PIPELINE)],
            )
            if result.get("performed") and result.get("ok"):
                performed += 1

        self.assertLessEqual(performed, 40)


if __name__ == "__main__":
    unittest.main()
