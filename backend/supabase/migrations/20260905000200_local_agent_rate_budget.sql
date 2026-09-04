-- Local-only shared execution budget. Existing applied migrations stay immutable.
CREATE TABLE local_analytics.agent_action_budget_claims (
    action_id uuid PRIMARY KEY REFERENCES local_analytics.agent_action_records(action_id),
    claimed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX agent_action_budget_claims_time_idx
    ON local_analytics.agent_action_budget_claims (claimed_at);
REVOKE ALL ON local_analytics.agent_action_budget_claims
    FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON local_analytics.agent_action_budget_claims TO service_role;

CREATE FUNCTION local_analytics.claim_agent_action_budget(
    p_action_id uuid, p_windows integer[], p_caps integer[]
) RETURNS text LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog AS $$
DECLARE i integer; current_at timestamptz;
BEGIN
    IF array_ndims(p_windows) IS DISTINCT FROM 1
       OR array_ndims(p_caps) IS DISTINCT FROM 1
       OR array_lower(p_windows, 1) IS DISTINCT FROM 1
       OR array_lower(p_caps, 1) IS DISTINCT FROM 1
       OR cardinality(p_windows) NOT BETWEEN 1 AND 16
       OR cardinality(p_windows) IS DISTINCT FROM cardinality(p_caps) THEN
        RETURN 'unavailable';
    END IF;
    -- All callers share this transaction-scoped lock, including fresh processes.
    PERFORM pg_advisory_xact_lock(731904216583::bigint);
    current_at := clock_timestamp();
    IF NOT EXISTS (SELECT 1 FROM local_analytics.agent_action_records
                   WHERE action_id = p_action_id AND result_code IS NULL)
       OR EXISTS (SELECT 1 FROM local_analytics.agent_action_results WHERE action_id = p_action_id) THEN
        RETURN 'unavailable';
    END IF;
    IF EXISTS (SELECT 1 FROM local_analytics.agent_action_budget_claims WHERE action_id = p_action_id) THEN
        RETURN 'duplicate';
    END IF;
    FOR i IN 1..cardinality(p_windows) LOOP
        IF p_windows[i] IS NULL OR p_windows[i] <= 0 OR p_caps[i] IS NULL OR p_caps[i] < 0 THEN
            RETURN 'unavailable';
        END IF;
        IF (SELECT count(*) FROM local_analytics.agent_action_budget_claims
            WHERE claimed_at > current_at - (p_windows[i]::bigint * 60) * interval '1 second') >= p_caps[i] THEN
            RETURN 'limited';
        END IF;
    END LOOP;
    INSERT INTO local_analytics.agent_action_budget_claims(action_id, claimed_at)
        VALUES (p_action_id, current_at);
    RETURN 'created';
END;
$$;
REVOKE ALL ON FUNCTION local_analytics.claim_agent_action_budget(uuid, integer[], integer[])
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION local_analytics.claim_agent_action_budget(uuid, integer[], integer[])
    TO service_role;
