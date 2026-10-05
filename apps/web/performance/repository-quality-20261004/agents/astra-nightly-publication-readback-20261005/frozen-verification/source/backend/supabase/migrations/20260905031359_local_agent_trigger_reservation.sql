-- Local agent workers serialize admission for each signal, including different
-- action kinds. Applied migrations remain immutable; no hosted apply is implied.
CREATE FUNCTION local_analytics.reserve_agent_action(
    p_action_id uuid, p_trigger text, p_severity text, p_kind text, p_approval text
) RETURNS text LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog
SET lock_timeout = '5s' AS $$
BEGIN
    IF p_action_id IS NULL OR p_trigger IS NULL OR p_kind IS NULL THEN
        RETURN 'unavailable';
    END IF;
    -- Under READ COMMITTED each VOLATILE function query obtains a fresh
    -- snapshot after this transaction-scoped lock. A competing reservation
    -- therefore observes the first worker's durable pending row before acting.
    -- Stronger isolation could retain a stale snapshot: deny it explicitly.
    IF current_setting('transaction_isolation') <> 'read committed' THEN
        RETURN 'unavailable';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_trigger, 731904216584::bigint));
    IF EXISTS (SELECT 1 FROM local_analytics.agent_action_records
               WHERE trigger_signal_id=p_trigger AND action_kind_id=p_kind) THEN
        RETURN 'duplicate';
    END IF;
    IF EXISTS (SELECT 1 FROM local_analytics.agent_action_state
               WHERE trigger_signal_id=p_trigger AND (result_code IS NULL OR result_code IN
                 ('agent_action_unverified','agent_action_record_unavailable'))) THEN
        RETURN 'halted';
    END IF;
    INSERT INTO local_analytics.agent_action_records
        (action_id,trigger_signal_id,signal_severity,action_kind_id,human_approval_ref)
        VALUES (p_action_id,p_trigger,p_severity,p_kind,p_approval);
    RETURN 'created';
END;
$$;
REVOKE ALL ON FUNCTION local_analytics.reserve_agent_action(uuid,text,text,text,text)
    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION local_analytics.reserve_agent_action(uuid,text,text,text,text)
    TO service_role;
