"""Durable local agent reservation and append-only terminal-result adapter.

The injected executor commits each fixed statement before returning its scalar
result. It must use the local backend DSN admitted by the existing pool guard.
Neither this module nor its constructor opens a connection or reads secrets.
"""
from __future__ import annotations

from typing import Any, Callable
from backend.pipeline_control.ops_agent import (
    AGENT_CODES, AGENT_ACTION_PERFORMED, AgentActionRecord, assert_record_shape,
)


class PostgresAgentActionStore:
    def __init__(self, execute_one: Callable[[str, tuple[Any, ...]], Any]) -> None:
        self.execute_one = execute_one

    def reserve(self, record: AgentActionRecord) -> str:
        try:
            assert_record_shape(record.to_row())
            if record.result_code is not None:
                return "unavailable"
            created = self.execute_one(
                "INSERT INTO local_analytics.agent_action_records "
                "(action_id, trigger_signal_id, signal_severity, action_kind_id, human_approval_ref) "
                "VALUES (%s::uuid,%s,%s,%s,%s) "
                "ON CONFLICT (trigger_signal_id, action_kind_id) DO NOTHING RETURNING action_id",
                (record.action_id, record.trigger_signal_id, record.signal_severity,
                 record.action_kind_id, record.human_approval_ref),
            )
            return "created" if created is not None else "duplicate"
        except Exception:
            return "unavailable"

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
