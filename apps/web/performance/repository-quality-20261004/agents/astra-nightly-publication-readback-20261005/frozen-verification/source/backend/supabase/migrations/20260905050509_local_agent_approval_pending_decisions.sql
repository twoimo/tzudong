-- Local-only historical approval decisions. Execution reservations stay separate.
-- Each observation is immutable and linked to any later action by trigger/kind.
CREATE TABLE local_analytics.agent_approval_pending_decisions (
    decision_id uuid PRIMARY KEY,
    trigger_signal_id text NOT NULL CHECK (
        length(btrim(trigger_signal_id)) > 0 AND length(trigger_signal_id) <= 200
    ),
    signal_severity text NOT NULL CHECK (
        signal_severity IN ('info','low','warning','medium','high','critical')
    ),
    action_kind_id text NOT NULL CHECK (action_kind_id IN (
        'open_github_issue','hosted_database_write','hosted_migration_apply',
        'deployment_execution','rollback_execution','branch_protection_change',
        'secret_value_change','dns_change'
    )),
    result_code text NOT NULL DEFAULT 'human_approval_required'
        CHECK (result_code = 'human_approval_required'),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX agent_approval_pending_decisions_trigger_idx
    ON local_analytics.agent_approval_pending_decisions (trigger_signal_id, action_kind_id);
REVOKE ALL ON local_analytics.agent_approval_pending_decisions
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON local_analytics.agent_approval_pending_decisions TO service_role;
