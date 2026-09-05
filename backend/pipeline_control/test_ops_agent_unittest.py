#!/usr/bin/env python3
"""Unit tests for ``backend/pipeline_control/ops_agent.py`` (Task 51).

These verify the observable branches and error paths of the Ops_Agent
monitoring-and-action boundary (platform-modernization Requirements 15.1-15.16;
design C11 / D8): admitted-source restriction, poll interval bound, active
Watch_Rule matching, record-before-action, duplicate prevention via the D8
unique constraint, sliding rate limit, exact-match allowlist, high-risk human
approval binding, never-performed classes, result verification with subsequent
halt, and fail-closed loading of the committed allowlist / rate-limit ledgers.
"""

from __future__ import annotations

import json
import tempfile
import unittest
import os
import time
from unittest.mock import patch
from pathlib import Path

from backend.pipeline_control import ops_agent as oa

_ROOT = Path(__file__).resolve().parents[2]
_ALLOWLIST_PATH = _ROOT / "backend" / "deploy" / "agent-action-allowlist.v1.json"
_RATE_LIMITS_PATH = _ROOT / "backend" / "deploy" / "agent-action-rate-limits.v1.json"

# 커밋된 허용목록의 6개 로컬 멱등 조치.
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
    """단조 초 시각을 수동으로 제어하는 테스트 클록."""

    def __init__(self, start: float = 0.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def _rule(action_kind_id: str, *, source=oa.SIGNAL_SOURCE_OBSERVABILITY,
          kind="service_down", min_severity="high", active=True, rule_id="r1"):
    return oa.WatchRule(
        rule_id=rule_id,
        active=active,
        source=source,
        kind=kind,
        min_severity=min_severity,
        action_kind_id=action_kind_id,
    )


def _signal(signal_id="sig-1", *, source=oa.SIGNAL_SOURCE_OBSERVABILITY,
            kind="service_down", severity="critical"):
    return oa.Signal(signal_id=signal_id, source=source, kind=kind, severity=severity)


def _make_agent(
    *,
    allowlist_kinds=_ALLOWLIST_KINDS,
    limits=None,
    active_limits=True,
    executor=None,
    verifier=None,
    clock=None,
    store=None,
):
    if limits is None:
        limits = [
            {"limitId": "sliding_60m", "windowMinutes": 60, "maxActions": 10},
            {"limitId": "daily_hard_cap", "windowMinutes": 1440, "maxActions": 40},
        ]
    return oa.OpsAgent(
        allowlist_kinds=allowlist_kinds,
        rate_limiter=oa.SlidingRateLimiter(limits, active=active_limits),
        store=store or oa.InMemoryAgentActionStore(),
        executor=executor or (lambda kind: None),
        verifier=verifier or (lambda kind: True),
        clock=clock or _FakeClock(),
    )


class PollIntervalAndSourceTests(unittest.TestCase):
    def test_poll_interval_within_bound(self):
        self.assertTrue(oa.validate_poll_interval(60)["ok"])
        self.assertTrue(oa.validate_poll_interval(1)["ok"])

    def test_poll_interval_exceeds_bound(self):
        self.assertFalse(oa.validate_poll_interval(61)["ok"])
        self.assertFalse(oa.validate_poll_interval(0)["ok"])
        self.assertFalse(oa.validate_poll_interval(-5)["ok"])
        self.assertFalse(oa.validate_poll_interval("60")["ok"])

    def test_only_two_admitted_sources(self):
        self.assertTrue(oa.is_admitted_source("observability_stack"))
        self.assertTrue(oa.is_admitted_source("log_pipeline"))
        self.assertFalse(oa.is_admitted_source("crawler"))
        self.assertFalse(oa.is_admitted_source("web_app"))
        self.assertFalse(oa.is_admitted_source(None))

    def test_signal_from_unadmitted_source_is_idle(self):
        agent = _make_agent()
        result = agent.process_signal(
            _signal(source="crawler"), [_rule("restart_local_container")]
        )
        self.assertFalse(result["performed"])
        self.assertEqual(result["resultCode"], oa.AGENT_ACTION_IDLE)


class WatchRuleTests(unittest.TestCase):
    def test_no_active_rule_yields_idle(self):
        agent = _make_agent()
        result = agent.process_signal(_signal(), [])
        self.assertFalse(result["performed"])
        self.assertEqual(result["resultCode"], oa.AGENT_ACTION_IDLE)

    def test_inactive_rule_does_not_match(self):
        self.assertIsNone(
            oa.match_watch_rule(_signal(), [_rule("restart_local_container", active=False)])
        )

    def test_below_severity_threshold_does_not_match(self):
        rule = _rule("restart_local_container", min_severity="critical")
        self.assertIsNone(oa.match_watch_rule(_signal(severity="high"), [rule]))

    def test_at_or_above_threshold_matches(self):
        rule = _rule("restart_local_container", min_severity="high")
        self.assertIsNotNone(oa.match_watch_rule(_signal(severity="high"), [rule]))
        self.assertIsNotNone(oa.match_watch_rule(_signal(severity="critical"), [rule]))

    def test_unknown_severity_does_not_match(self):
        rule = _rule("restart_local_container", min_severity="high")
        self.assertIsNone(oa.match_watch_rule(_signal(severity="nonsense"), [rule]))


class AllowlistedActionTests(unittest.TestCase):
    def test_new_agent_instances_share_the_stores_execution_budget(self):
        store = oa.InMemoryAgentActionStore()
        executed = []
        for i in range(12):
            agent = _make_agent(store=store, executor=executed.append)
            result = agent.process_signal(_signal(str(i)), [_rule('restart_local_container')])
            self.assertEqual(result['performed'], i < 10)
        self.assertEqual(len(executed),10)

    def test_uncertain_execution_still_consumes_shared_budget(self):
        store = oa.InMemoryAgentActionStore()
        limits = [{'windowMinutes':60,'maxActions':1}]
        def failed(_):
            raise RuntimeError('not retained')
        first = _make_agent(store=store, limits=limits, executor=failed)
        self.assertTrue(first.process_signal(_signal('first'), [_rule('restart_local_container')])['performed'])
        second = _make_agent(store=store, limits=limits)
        result = second.process_signal(_signal('second'), [_rule('restart_local_container')])
        self.assertFalse(result['performed'])
        self.assertEqual(result['errorCode'],oa.AGENT_ACTION_RATE_LIMITED)

    def test_allowlisted_action_performed_and_verified(self):
        store = oa.InMemoryAgentActionStore()
        agent = _make_agent(store=store)
        result = agent.process_signal(_signal(), [_rule("restart_local_container")])
        self.assertTrue(result["ok"])
        self.assertTrue(result["performed"])
        self.assertEqual(result["resultCode"], oa.AGENT_ACTION_PERFORMED)
        # 기록이 조치보다 먼저 생성되고 성공 코드가 기록됨.
        rows = store.rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["result_code"], oa.AGENT_ACTION_PERFORMED)
        self.assertEqual(set(rows[0].keys()), set(oa.RECORD_FIELDS))

    def test_record_created_before_action_executes(self):
        # executor가 호출되는 시점에는 이미 reserve가 완료되어 있어야 한다.
        store = oa.InMemoryAgentActionStore()
        seen_rows_at_execute = {}

        def executor(kind):
            seen_rows_at_execute["count"] = len(store.rows())

        agent = _make_agent(store=store, executor=executor)
        agent.process_signal(_signal(), [_rule("restart_local_container")])
        self.assertEqual(seen_rows_at_execute["count"], 1)

    def test_non_allowlisted_action_not_performed(self):
        agent = _make_agent()
        result = agent.process_signal(
            _signal(), [_rule("delete_production_table")]
        )
        self.assertFalse(result["performed"])
        self.assertEqual(result["errorCode"], oa.AGENT_ACTION_NOT_ALLOWLISTED)


class HighRiskApprovalTests(unittest.TestCase):
    def test_external_github_issue_requires_bound_approval(self):
        executed = []
        agent = _make_agent(executor=lambda kind: executed.append(kind))
        result = agent.process_signal(_signal(), [_rule("open_github_issue")])
        self.assertFalse(result["performed"])
        self.assertEqual(result["errorCode"], oa.HUMAN_APPROVAL_REQUIRED)
        self.assertEqual(executed, [])

    def test_external_github_issue_with_bound_approval_performs(self):
        executed = []
        agent = _make_agent(executor=lambda kind: executed.append(kind))
        approval = oa.Approval(
            approval_ref="APR-GH-001",
            approver_name="Named Operator",
            action_kind_id="open_github_issue",
            trigger_signal_id="sig-1",
        )
        result = agent.process_signal(
            _signal(), [_rule("open_github_issue")], approval=approval
        )
        self.assertTrue(result["performed"])
        self.assertEqual(executed, ["open_github_issue"])

    def test_high_risk_without_approval_is_pending(self):
        agent = _make_agent()
        result = agent.process_signal(
            _signal(), [_rule("deployment_execution")]
        )
        self.assertFalse(result["performed"])
        self.assertEqual(result["errorCode"], oa.HUMAN_APPROVAL_REQUIRED)

    def test_high_risk_with_bound_approval_performs(self):
        agent = _make_agent()
        approval = oa.Approval(
            approval_ref="APR-2024-001",
            approver_name="Jane Operator",
            action_kind_id="deployment_execution",
            trigger_signal_id="sig-1",
        )
        result = agent.process_signal(
            _signal(signal_id="sig-1"),
            [_rule("deployment_execution")],
            approval=approval,
        )
        self.assertTrue(result["performed"])
        self.assertEqual(result["humanApprovalRef"], "APR-2024-001")

    def test_high_risk_with_mismatched_approval_is_pending(self):
        agent = _make_agent()
        # 승인이 다른 트리거에 결속됨 → 이 신호에는 결속되지 않음.
        approval = oa.Approval(
            approval_ref="APR-2024-001",
            approver_name="Jane Operator",
            action_kind_id="deployment_execution",
            trigger_signal_id="other-sig",
        )
        result = agent.process_signal(
            _signal(signal_id="sig-1"),
            [_rule("deployment_execution")],
            approval=approval,
        )
        self.assertFalse(result["performed"])
        self.assertEqual(result["errorCode"], oa.HUMAN_APPROVAL_REQUIRED)

    def test_high_risk_with_empty_approver_name_is_pending(self):
        agent = _make_agent()
        approval = oa.Approval(
            approval_ref="APR-2024-001",
            approver_name="   ",
            action_kind_id="secret_value_change",
            trigger_signal_id="sig-1",
        )
        result = agent.process_signal(
            _signal(signal_id="sig-1", kind="service_down"),
            [_rule("secret_value_change")],
            approval=approval,
        )
        self.assertFalse(result["performed"])
        self.assertEqual(result["errorCode"], oa.HUMAN_APPROVAL_REQUIRED)

    def test_high_risk_with_empty_approval_reference_is_pending(self):
        agent = _make_agent()
        approval = oa.Approval(
            approval_ref="   ",
            approver_name="Named Operator",
            action_kind_id="deployment_execution",
            trigger_signal_id="sig-1",
        )
        result = agent.process_signal(
            _signal(), [_rule("deployment_execution")], approval=approval
        )
        self.assertFalse(result["performed"])
        self.assertEqual(result["errorCode"], oa.HUMAN_APPROVAL_REQUIRED)


class NeverPerformedTests(unittest.TestCase):
    def test_never_performed_even_with_approval(self):
        for kind in sorted(oa.NEVER_PERFORMED_ACTIONS):
            with self.subTest(kind=kind):
                agent = _make_agent()
                approval = oa.Approval(
                    approval_ref="APR-X",
                    approver_name="Jane Operator",
                    action_kind_id=kind,
                    trigger_signal_id="sig-1",
                )
                result = agent.process_signal(
                    _signal(signal_id="sig-1"),
                    [_rule(kind)],
                    approval=approval,
                )
                self.assertFalse(result["performed"])
                self.assertTrue(result.get("neverPerformed"))
                self.assertTrue(result.get("humanDecisionPending"))


class DuplicateTests(unittest.TestCase):
    def test_same_trigger_action_combo_only_once(self):
        store = oa.InMemoryAgentActionStore()
        agent = _make_agent(store=store)
        rules = [_rule("restart_local_container")]
        first = agent.process_signal(_signal(signal_id="sig-1"), rules)
        second = agent.process_signal(_signal(signal_id="sig-1"), rules)
        self.assertTrue(first["performed"])
        self.assertFalse(second["performed"])
        self.assertEqual(second["errorCode"], oa.AGENT_ACTION_DUPLICATE)
        # 저장소에는 한 행만.
        self.assertEqual(len(store.rows()), 1)


class RecordUnavailableTests(unittest.TestCase):
    def test_terminal_write_failure_never_reports_success_or_repeats_action(self):
        for raises in (False, True):
            class FailedResultStore(oa.InMemoryAgentActionStore):
                def record_result(self, *_args):
                    if raises:
                        raise RuntimeError("private provider diagnostic")
                    return False
            executed = []
            agent = _make_agent(store=FailedResultStore(), executor=executed.append)
            result = agent.process_signal(_signal(), [_rule("restart_local_container")])
            self.assertFalse(result["ok"])
            self.assertTrue(result["performed"])
            self.assertTrue(result["halted"])
            self.assertEqual(result["errorCode"], oa.AGENT_ACTION_RECORD_UNAVAILABLE)
            agent.process_signal(_signal(), [_rule("restart_local_container")])
            self.assertEqual(executed, ["restart_local_container"])
            self.assertNotIn("private provider", str(result))

    def test_record_reservation_failure_blocks_action(self):
        executed = []
        store = oa.InMemoryAgentActionStore(fail_reserve=True)
        agent = _make_agent(store=store, executor=lambda k: executed.append(k))
        result = agent.process_signal(_signal(), [_rule("restart_local_container")])
        self.assertFalse(result["performed"])
        self.assertEqual(result["errorCode"], oa.AGENT_ACTION_RECORD_UNAVAILABLE)
        # 기록이 조치보다 먼저 → 확정 실패 시 조치 미실행.
        self.assertEqual(executed, [])


class RateLimitTests(unittest.TestCase):
    def test_sliding_window_caps_performed_actions(self):
        clock = _FakeClock()
        limits = [{"limitId": "sliding_60m", "windowMinutes": 60, "maxActions": 2}]
        agent = _make_agent(limits=limits, clock=clock)
        rules_kind = "restart_local_container"
        # 서로 다른 트리거로 3회 시도. 상한 2건.
        r1 = agent.process_signal(_signal(signal_id="s1"), [_rule(rules_kind)])
        r2 = agent.process_signal(_signal(signal_id="s2"), [_rule(rules_kind)])
        r3 = agent.process_signal(_signal(signal_id="s3"), [_rule(rules_kind)])
        self.assertTrue(r1["performed"])
        self.assertTrue(r2["performed"])
        self.assertFalse(r3["performed"])
        self.assertEqual(r3["errorCode"], oa.AGENT_ACTION_RATE_LIMITED)

    def test_window_slides_forward(self):
        clock = _FakeClock()
        limits = [{"limitId": "sliding_60m", "windowMinutes": 60, "maxActions": 1}]
        agent = _make_agent(limits=limits, clock=clock)
        kind = "restart_local_container"
        r1 = agent.process_signal(_signal(signal_id="s1"), [_rule(kind)])
        self.assertTrue(r1["performed"])
        # 61분 경과 → 창 밖으로 밀려남.
        clock.advance(61 * 60)
        r2 = agent.process_signal(_signal(signal_id="s2"), [_rule(kind)])
        self.assertTrue(r2["performed"])

    def test_inactive_limits_fail_closed(self):
        agent = _make_agent(active_limits=False)
        result = agent.process_signal(_signal(), [_rule("restart_local_container")])
        self.assertFalse(result["performed"])
        self.assertEqual(result["errorCode"], oa.AGENT_ACTION_RATE_LIMITED)


class VerificationHaltTests(unittest.TestCase):
    def test_executor_exception_cannot_be_overridden_by_successful_verifier(self):
        verified = {"count": 0}

        def executor(_kind):
            raise RuntimeError("provider detail must stay hidden")

        def verifier(_kind):
            verified["count"] += 1
            return True

        agent = _make_agent(executor=executor, verifier=verifier)
        result = agent.process_signal(
            _signal(signal_id="executor-failed"),
            [_rule("restart_local_container")],
        )
        self.assertFalse(result["ok"])
        self.assertTrue(result["performed"])
        self.assertTrue(result["halted"])
        self.assertEqual(result["errorCode"], oa.AGENT_ACTION_UNVERIFIED)
        self.assertEqual(verified["count"], 0)
        self.assertNotIn("provider detail", repr(result))

    def test_unverified_after_three_failed_attempts(self):
        with tempfile.TemporaryDirectory() as tmp:
            attempts = Path(tmp) / 'attempts'
            def verifier(kind):
                with attempts.open('a') as stream:
                    stream.write('attempt\n')
                return False
            agent = _make_agent(verifier=verifier)
            result = agent.process_signal(_signal(signal_id="s1"), [_rule("restart_local_container")])
            self.assertFalse(result["ok"])
            self.assertEqual(result["errorCode"], oa.AGENT_ACTION_UNVERIFIED)
            self.assertTrue(result["performed"])
            self.assertEqual(len(attempts.read_text().splitlines()), oa.MAX_VERIFY_ATTEMPTS)

    def test_success_returned_after_deadline_is_rejected(self):
        clock = _FakeClock()
        def late(_):
            clock.advance(61)
            return True
        agent = _make_agent(verifier=late, clock=clock)
        result = agent.process_signal(_signal(), [_rule('restart_local_container')])
        self.assertEqual(result['errorCode'], oa.AGENT_ACTION_UNVERIFIED)

    def test_hung_verifier_is_killed_and_reaped_within_real_budget(self):
        with tempfile.TemporaryDirectory() as tmp:
            pidfile = Path(tmp) / 'worker-pid'
            def hung(_):
                pidfile.write_text(str(os.getpid()))
                time.sleep(30)
                return True
            agent = _make_agent(verifier=hung)
            started = time.monotonic()
            with patch.object(oa, 'MAX_VERIFY_SECONDS', 0.2):
                result = agent.process_signal(_signal(), [_rule('restart_local_container')])
            self.assertLess(time.monotonic() - started, 2)
            self.assertEqual(result['errorCode'], oa.AGENT_ACTION_UNVERIFIED)
            with self.assertRaises(ProcessLookupError):
                os.kill(int(pidfile.read_text()), 0)

    def test_new_agent_halts_durable_failure_or_unfinished_action(self):
        for failure in ('unverified', 'unfinished'):
            store = oa.InMemoryAgentActionStore()
            first = _make_agent(store=store, verifier=lambda _: False)
            if failure == 'unverified':
                first.process_signal(_signal(), [_rule('restart_local_container')])
            else:
                store.reserve(oa.AgentActionRecord('interrupted', 'sig-1', 'high', 'restart_local_container'))
            executed = []
            resumed = _make_agent(store=store, executor=executed.append)
            result = resumed.process_signal(_signal(), [_rule('requeue_failed_pipeline_task')])
            self.assertTrue(result['halted'])
            self.assertFalse(result['performed'])
            self.assertEqual(executed, [])

    def test_unavailable_trigger_readback_blocks_execution(self):
        store = oa.InMemoryAgentActionStore()
        store.trigger_state = lambda _: 'unavailable'
        executed = []
        result = _make_agent(store=store, executor=executed.append).process_signal(
            _signal(), [_rule('restart_local_container')])
        self.assertEqual(result['errorCode'], oa.AGENT_ACTION_RECORD_UNAVAILABLE)
        self.assertEqual(executed, [])

    def test_concurrent_kinds_cannot_both_execute_after_clear_prechecks(self):
        from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
        import threading
        barrier = threading.Barrier(2)
        release = threading.Event()
        class RacingStore(oa.InMemoryAgentActionStore):
            def trigger_state(self, trigger):
                state = super().trigger_state(trigger)
                barrier.wait(timeout=5)
                return state
        store = RacingStore()
        executed = []
        def execute(kind):
            executed.append(kind)
            if not release.wait(timeout=5):
                raise AssertionError('competing reservation did not halt')
        def attempt(kind):
            agent = _make_agent(store=store, executor=execute)
            # This test exercises execution admission, not fork-based verification.
            agent._verify = lambda *_: True
            return agent.process_signal(_signal(), [_rule(kind)])
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(attempt, kind) for kind in
                       ('restart_local_container', 'requeue_failed_pipeline_task')]
            try:
                done, _ = wait(futures, timeout=3, return_when=FIRST_COMPLETED)
                self.assertEqual(len(done), 1)
                self.assertTrue(next(iter(done)).result()['halted'])
                self.assertEqual(len(executed), 1)
            finally:
                release.set()
            results = [f.result() for f in futures]
        self.assertEqual(sum(r['performed'] for r in results), 1)
        self.assertEqual(len(store.rows()), 1)

    def test_subsequent_action_halted_for_same_trigger(self):
        agent = _make_agent(verifier=lambda kind: False)
        rules1 = [_rule("restart_local_container")]
        first = agent.process_signal(_signal(signal_id="sig-halt"), rules1)
        self.assertEqual(first["errorCode"], oa.AGENT_ACTION_UNVERIFIED)
        # 동일 트리거에 대한 후속 조치는 중단됨.
        rules2 = [_rule("requeue_failed_pipeline_task")]
        second = agent.process_signal(_signal(signal_id="sig-halt", kind="service_down"), rules2)
        self.assertTrue(second.get("halted"))
        self.assertEqual(second["errorCode"], oa.AGENT_ACTION_UNVERIFIED)
        self.assertFalse(second["performed"])

    def test_verify_time_budget_exceeded(self):
        clock = _FakeClock()

        def verifier(kind):
            # 매 시도마다 61초씩 흐르게 하여 시간 예산 초과 유도.
            clock.advance(61)
            return False

        agent = _make_agent(verifier=verifier, clock=clock)
        result = agent.process_signal(_signal(signal_id="s1"), [_rule("restart_local_container")])
        self.assertEqual(result["errorCode"], oa.AGENT_ACTION_UNVERIFIED)


class RecordShapeTests(unittest.TestCase):
    def test_record_has_exactly_six_fields(self):
        record = oa.AgentActionRecord(
            action_id="a1",
            trigger_signal_id="t1",
            signal_severity="high",
            action_kind_id="restart_local_container",
        )
        row = record.to_row()
        self.assertEqual(set(row.keys()), set(oa.RECORD_FIELDS))
        self.assertEqual(len(oa.RECORD_FIELDS), 6)

    def test_extra_field_rejected(self):
        with self.assertRaises(ValueError):
            oa.assert_record_shape(
                {
                    "action_id": "a1",
                    "trigger_signal_id": "t1",
                    "signal_severity": "high",
                    "action_kind_id": "restart_local_container",
                    "result_code": None,
                    "human_approval_ref": None,
                    "signal_body": "raw provider diagnostic text",
                }
            )

    def test_valid_row_accepted(self):
        oa.assert_record_shape(
            {
                "action_id": "a1",
                "trigger_signal_id": "t1",
                "signal_severity": "high",
                "action_kind_id": "restart_local_container",
                "result_code": None,
                "human_approval_ref": None,
            }
        )


class LedgerLoadingTests(unittest.TestCase):
    def test_committed_allowlist_is_inactive_fail_closed(self):
        # 커밋된 원장은 approverName=null / status=unresolved → 활성 아님.
        result = oa.load_allowlist(_ALLOWLIST_PATH)
        self.assertFalse(result["ok"])
        self.assertEqual(result["errorCode"], oa.AGENT_ALLOWLIST_UNAVAILABLE)
        self.assertFalse(result["active"])
        # 조치 종류는 파싱되지만 활성 승인이 없어 사용 불가.
        self.assertEqual(result["actionKinds"], _ALLOWLIST_KINDS)

    def test_committed_rate_limits_parse_but_inactive(self):
        result = oa.load_rate_limits(_RATE_LIMITS_PATH)
        self.assertFalse(result["active"])
        self.assertEqual(len(result["limits"]), 2)

    def test_missing_allowlist_file_unavailable(self):
        result = oa.load_allowlist("/nonexistent/path/allowlist.json")
        self.assertEqual(result["errorCode"], oa.AGENT_ALLOWLIST_UNAVAILABLE)

    def test_active_allowlist_loads(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "allowlist.json"
            path.write_text(
                json.dumps(
                    {
                        "kind": "agent_action_allowlist",
                        "actions": [
                            {"actionKindId": "restart_local_container"},
                            {"actionKindId": "flush_log_pending_queue"},
                        ],
                        "approval": {
                            "approverName": "Jane Operator",
                            "status": "approved",
                        },
                    }
                ),
                encoding="utf-8",
            )
            result = oa.load_allowlist(path)
            self.assertTrue(result["ok"])
            self.assertTrue(result["active"])
            self.assertIn("restart_local_container", result["actionKinds"])

    def test_build_agent_fails_closed_on_inactive_allowlist(self):
        built = oa.build_agent_from_files(
            allowlist_path=_ALLOWLIST_PATH,
            rate_limits_path=_RATE_LIMITS_PATH,
            store=oa.InMemoryAgentActionStore(),
            executor=lambda k: None,
            verifier=lambda k: True,
        )
        self.assertFalse(built["ok"])
        self.assertEqual(built["errorCode"], oa.AGENT_ALLOWLIST_UNAVAILABLE)
        self.assertIsNone(built["agent"])

    def test_build_agent_with_active_ledgers(self):
        with tempfile.TemporaryDirectory() as tmp:
            al = Path(tmp) / "allowlist.json"
            al.write_text(
                json.dumps(
                    {
                        "kind": "agent_action_allowlist",
                        "actions": [{"actionKindId": "restart_local_container"}],
                        "approval": {"approverName": "Op", "status": "approved"},
                    }
                ),
                encoding="utf-8",
            )
            rl = Path(tmp) / "rate.json"
            rl.write_text(
                json.dumps(
                    {
                        "kind": "agent_action_rate_limits",
                        "limits": [
                            {"limitId": "sliding_60m", "windowMinutes": 60, "maxActions": 10}
                        ],
                        "approval": {"approverName": "Op", "status": "approved"},
                    }
                ),
                encoding="utf-8",
            )
            built = oa.build_agent_from_files(
                allowlist_path=al,
                rate_limits_path=rl,
                store=oa.InMemoryAgentActionStore(),
                executor=lambda k: None,
                verifier=lambda k: True,
                clock=_FakeClock(),
            )
            self.assertTrue(built["ok"])
            self.assertTrue(built["rateLimitsActive"])
            agent = built["agent"]
            result = agent.process_signal(_signal(), [_rule("restart_local_container")])
            self.assertTrue(result["performed"])


if __name__ == "__main__":
    unittest.main()
