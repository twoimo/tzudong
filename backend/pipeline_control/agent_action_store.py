"""Durable local agent reservation and append-only terminal-result adapter.

The injected executor commits each fixed statement before returning its scalar
result. It must use the local backend DSN admitted by the existing pool guard.
Neither this module nor its constructor opens a connection or reads secrets.
"""
from __future__ import annotations

from typing import Any, Callable
from backend.pipeline_control.ops_agent import (
    AGENT_CODES, AGENT_ACTION_PERFORMED, AgentActionRecord, assert_record_shape,
    HUMAN_APPROVAL_REQUIRED, HUMAN_APPROVAL_REQUIRED_CLASSES, SEVERITY_ORDER,
)


class PostgresAgentActionStore:
    def __init__(self, execute_one: Callable[[str, tuple[Any, ...]], Any]) -> None:
        self.execute_one = execute_one

    def trigger_state(self, trigger_signal_id: str) -> str:
        """Pending or failed durable results block every action for this signal."""
        try:
            halted = self.execute_one(
                'SELECT EXISTS (SELECT 1 FROM local_analytics.agent_action_state '
                'WHERE trigger_signal_id=%s AND (result_code IS NULL OR result_code IN '
                "('agent_action_unverified','agent_action_record_unavailable')))",
                (trigger_signal_id,),
            )
            return ('halted' if halted else 'clear') if type(halted) is bool else 'unavailable'
        except Exception:
            return 'unavailable'

    def reserve(self, record: AgentActionRecord) -> str:
        try:
            assert_record_shape(record.to_row())
            if record.result_code is not None:
                return "unavailable"
            result = self.execute_one(
                "SELECT local_analytics.reserve_agent_action(%s::uuid,%s,%s,%s,%s)",
                (record.action_id, record.trigger_signal_id, record.signal_severity,
                 record.action_kind_id, record.human_approval_ref),
            )
            return result if result in {'created', 'duplicate', 'halted'} else 'unavailable'
        except Exception:
            return "unavailable"

    def record_approval_pending(self, record: AgentActionRecord) -> bool:
        """Commit and independently read back the minimized historical decision.

        No execution reservation or rate claim is consumed. Retrying this exact
        decision is idempotent; a new observation has its own decision identity.
        """
        try:
            assert_record_shape(record.to_row())
            if (record.result_code != HUMAN_APPROVAL_REQUIRED
                    or record.human_approval_ref is not None
                    or record.action_kind_id not in HUMAN_APPROVAL_REQUIRED_CLASSES
                    or record.signal_severity not in SEVERITY_ORDER):
                return False
            values = (record.action_id, record.trigger_signal_id,
                      record.signal_severity, record.action_kind_id)
            self.execute_one(
                'INSERT INTO local_analytics.agent_approval_pending_decisions '
                '(decision_id,trigger_signal_id,signal_severity,action_kind_id) '
                'VALUES (%s::uuid,%s,%s,%s) ON CONFLICT (decision_id) DO NOTHING '
                'RETURNING decision_id', values,
            )
            actual = self.execute_one(
                'SELECT EXISTS (SELECT 1 FROM local_analytics.agent_approval_pending_decisions '
                'WHERE decision_id=%s::uuid AND trigger_signal_id=%s '
                'AND signal_severity=%s AND action_kind_id=%s '
                "AND result_code='human_approval_required')", values,
            )
            return actual is True
        except Exception:
            return False

    def record_result(self, action_id: str, result_code: str | None) -> bool:
        if result_code not in (AGENT_CODES - {None}) | {AGENT_ACTION_PERFORMED}:
            return False
        try:
            self.execute_one(
                "INSERT INTO local_analytics.agent_action_results (action_id,result_code) "
                "VALUES (%s::uuid,%s) ON CONFLICT (action_id) DO NOTHING RETURNING result_code",
                (action_id, result_code),
            )
            actual = self.execute_one(
                "SELECT result_code FROM local_analytics.agent_action_results WHERE action_id=%s::uuid",
                (action_id,),
            )
            return actual == result_code
        except Exception:
            return False

    def claim_rate_budget(self, action_id: str, limits, now_seconds: float) -> str:
        """Atomic shared claim; the database owns time, not a process clock."""
        try:
            if not limits or any(type(item['windowMinutes']) is not int
                or type(item['maxActions']) is not int for item in limits):
                return 'unavailable'
            result = self.execute_one(
                'SELECT local_analytics.claim_agent_action_budget(%s::uuid,%s::integer[],%s::integer[])',
                (action_id, [item['windowMinutes'] for item in limits],
                 [item['maxActions'] for item in limits]),
            )
            return result if result in {'created', 'limited', 'duplicate'} else 'unavailable'
        except Exception:
            return 'unavailable'
