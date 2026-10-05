-- Local backend only: reservations and terminal results are separately append-only.
-- Never rewrite the historical local_analytics schema migration.
CREATE TABLE local_analytics.agent_action_results (
    action_id uuid PRIMARY KEY REFERENCES local_analytics.agent_action_records(action_id),
    result_code text NOT NULL CHECK (result_code IN (
        'agent_action_not_allowlisted', 'human_approval_required',
        'agent_action_duplicate', 'agent_action_rate_limited',
        'agent_action_unverified', 'agent_allowlist_unavailable',
        'agent_action_record_unavailable', 'agent_action_performed'
    )),
    recorded_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON local_analytics.agent_action_results FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON local_analytics.agent_action_results TO service_role;
REVOKE UPDATE, DELETE ON local_analytics.agent_action_records
    FROM PUBLIC, anon, authenticated, service_role;

CREATE VIEW local_analytics.agent_action_state WITH (security_invoker = true) AS
SELECT r.action_id, r.trigger_signal_id, r.signal_severity, r.action_kind_id,
       COALESCE(t.result_code, r.result_code) AS result_code,
       r.human_approval_ref, r.recorded_at, t.recorded_at AS finalized_at
FROM local_analytics.agent_action_records r
LEFT JOIN local_analytics.agent_action_results t USING (action_id);
REVOKE ALL ON local_analytics.agent_action_state FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON local_analytics.agent_action_state TO service_role;
