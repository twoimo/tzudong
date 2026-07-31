-- G013: atomically bound shared third-party provider usage across web workers.
-- Limits are conservative internal safety ceilings, not claims about provider quota plans.

CREATE SCHEMA provider_budget_private;
REVOKE ALL ON SCHEMA provider_budget_private FROM PUBLIC, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA provider_budget_private
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA provider_budget_private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE provider_budget_private.admin_provider_budget_policies (
  provider text PRIMARY KEY,
  actor_per_minute integer NOT NULL CHECK (actor_per_minute BETWEEN 1 AND 100),
  global_per_minute integer NOT NULL CHECK (global_per_minute BETWEEN 1 AND 1000),
  global_per_day integer NOT NULL CHECK (global_per_day BETWEEN 1 AND 25000),
  CONSTRAINT admin_provider_budget_policies_provider_check
    CHECK (provider IN ('naver_local_search', 'naver_geocode', 'youtube_metadata')),
  CONSTRAINT admin_provider_budget_policies_order_check
    CHECK (actor_per_minute <= global_per_minute AND global_per_minute <= global_per_day)
);

INSERT INTO provider_budget_private.admin_provider_budget_policies (
  provider, actor_per_minute, global_per_minute, global_per_day
) VALUES
  ('naver_local_search', 30, 300, 20000),
  ('naver_geocode', 60, 600, 20000),
  ('youtube_metadata', 30, 300, 9000);

CREATE TABLE provider_budget_private.admin_provider_budget_counters (
  provider text NOT NULL REFERENCES provider_budget_private.admin_provider_budget_policies(provider),
  scope text NOT NULL CHECK (scope IN ('actor_minute', 'global_minute', 'global_day')),
  bucket_key text NOT NULL CHECK (char_length(bucket_key) BETWEEN 1 AND 80),
  request_count integer NOT NULL CHECK (request_count > 0),
  window_started_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (provider, scope, bucket_key),
  CONSTRAINT admin_provider_budget_counters_expiry_check CHECK (expires_at > window_started_at)
);

CREATE INDEX admin_provider_budget_counters_expiry_idx
  ON provider_budget_private.admin_provider_budget_counters (expires_at);

CREATE TABLE provider_budget_private.admin_provider_budget_decisions (
  operation_id uuid PRIMARY KEY,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL REFERENCES provider_budget_private.admin_provider_budget_policies(provider),
  allowed boolean NOT NULL,
  retry_after_seconds integer NOT NULL CHECK (retry_after_seconds BETWEEN 0 AND 86400),
  decided_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

CREATE INDEX admin_provider_budget_decisions_decided_at_idx
  ON provider_budget_private.admin_provider_budget_decisions (decided_at);

ALTER TABLE provider_budget_private.admin_provider_budget_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_budget_private.admin_provider_budget_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE provider_budget_private.admin_provider_budget_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_budget_private.admin_provider_budget_counters FORCE ROW LEVEL SECURITY;
ALTER TABLE provider_budget_private.admin_provider_budget_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_budget_private.admin_provider_budget_decisions FORCE ROW LEVEL SECURITY;

CREATE POLICY admin_provider_budget_policies_owner_only
  ON provider_budget_private.admin_provider_budget_policies TO postgres
  USING (true) WITH CHECK (true);
CREATE POLICY admin_provider_budget_counters_owner_only
  ON provider_budget_private.admin_provider_budget_counters TO postgres
  USING (true) WITH CHECK (true);
CREATE POLICY admin_provider_budget_decisions_owner_only
  ON provider_budget_private.admin_provider_budget_decisions TO postgres
  USING (true) WITH CHECK (true);

CREATE FUNCTION provider_budget_private.reject_admin_provider_budget_policy_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'admin_provider_budget_policies_are_immutable';
END;
$$;

CREATE TRIGGER admin_provider_budget_policies_immutable
BEFORE INSERT OR UPDATE OR DELETE ON provider_budget_private.admin_provider_budget_policies
FOR EACH ROW EXECUTE FUNCTION provider_budget_private.reject_admin_provider_budget_policy_mutation();

CREATE FUNCTION provider_budget_private.consume_admin_provider_counter(
  p_provider text,
  p_scope text,
  p_bucket_key text,
  p_max_requests integer,
  p_now timestamptz,
  p_expires_at timestamptz
)
RETURNS TABLE (allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
  v_expires_at timestamptz;
BEGIN
  IF p_provider IS NULL
     OR p_scope IS NULL
     OR p_scope NOT IN ('actor_minute', 'global_minute', 'global_day')
     OR p_bucket_key IS NULL
     OR char_length(p_bucket_key) NOT BETWEEN 1 AND 80
     OR p_max_requests IS NULL
     OR p_max_requests NOT BETWEEN 1 AND 25000
     OR p_now IS NULL
     OR p_expires_at IS NULL
     OR p_expires_at <= p_now THEN
    RAISE EXCEPTION 'admin_provider_counter_invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO provider_budget_private.admin_provider_budget_counters AS counters (
    provider, scope, bucket_key, request_count, window_started_at, expires_at
  ) VALUES (
    p_provider, p_scope, p_bucket_key, 1, p_now, p_expires_at
  )
  ON CONFLICT (provider, scope, bucket_key) DO UPDATE
     SET request_count = CASE WHEN counters.expires_at <= p_now THEN 1 ELSE counters.request_count + 1 END,
         window_started_at = CASE WHEN counters.expires_at <= p_now THEN p_now ELSE counters.window_started_at END,
         expires_at = CASE WHEN counters.expires_at <= p_now THEN p_expires_at ELSE counters.expires_at END
  RETURNING counters.request_count, counters.expires_at
       INTO v_count, v_expires_at;

  allowed := v_count <= p_max_requests;
  retry_after_seconds := CASE
    WHEN allowed THEN 0
    ELSE pg_catalog.greatest(1, pg_catalog.ceil(EXTRACT(EPOCH FROM v_expires_at - p_now))::integer)
  END;
  RETURN NEXT;
END;
$$;

CREATE FUNCTION public.reserve_admin_provider_budget(
  p_actor_user_id uuid,
  p_provider text,
  p_operation_id uuid
)
RETURNS TABLE (allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_policy provider_budget_private.admin_provider_budget_policies%ROWTYPE;
  v_existing provider_budget_private.admin_provider_budget_decisions%ROWTYPE;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_minute_expiry timestamptz := v_now + interval '1 minute';
  v_day date := (v_now AT TIME ZONE 'Asia/Seoul')::date;
  v_day_expiry timestamptz;
  v_allowed boolean;
  v_retry integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'admin_provider_budget_service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_actor_user_id IS NULL OR p_provider IS NULL OR p_operation_id IS NULL THEN
    RAISE EXCEPTION 'admin_provider_budget_request_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.user_roles AS roles
      JOIN public.user_account_status AS account_status
        ON account_status.user_id = roles.user_id
       AND account_status.account_status = 'active'
     WHERE roles.user_id = p_actor_user_id
       AND roles.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'admin_provider_budget_actor_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT policies.* INTO v_policy
    FROM provider_budget_private.admin_provider_budget_policies AS policies
   WHERE policies.provider = p_provider;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_provider_budget_provider_invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin-provider-operation:' || p_operation_id::text, 0)
  );

  SELECT decisions.* INTO v_existing
    FROM provider_budget_private.admin_provider_budget_decisions AS decisions
   WHERE decisions.operation_id = p_operation_id;
  IF FOUND THEN
    IF v_existing.actor_user_id IS DISTINCT FROM p_actor_user_id
       OR v_existing.provider IS DISTINCT FROM p_provider THEN
      RAISE EXCEPTION 'admin_provider_budget_operation_binding_mismatch' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY SELECT v_existing.allowed, v_existing.retry_after_seconds;
    RETURN;
  END IF;

  WITH expired_counters AS (
    SELECT counters.ctid
      FROM provider_budget_private.admin_provider_budget_counters AS counters
     WHERE counters.expires_at <= v_now - interval '1 hour'
     ORDER BY counters.expires_at
     LIMIT 100
  )
  DELETE FROM provider_budget_private.admin_provider_budget_counters AS counters
  USING expired_counters
  WHERE counters.ctid = expired_counters.ctid;

  WITH expired_decisions AS (
    SELECT decisions.ctid
      FROM provider_budget_private.admin_provider_budget_decisions AS decisions
     WHERE decisions.decided_at < v_now - interval '2 days'
     ORDER BY decisions.decided_at
     LIMIT 100
  )
  DELETE FROM provider_budget_private.admin_provider_budget_decisions AS decisions
  USING expired_decisions
  WHERE decisions.ctid = expired_decisions.ctid;

  SELECT counter.allowed, counter.retry_after_seconds INTO v_allowed, v_retry
    FROM provider_budget_private.consume_admin_provider_counter(
      p_provider, 'actor_minute', p_actor_user_id::text,
      v_policy.actor_per_minute, v_now, v_minute_expiry
    ) AS counter;
  IF NOT v_allowed THEN
    INSERT INTO provider_budget_private.admin_provider_budget_decisions
      (operation_id, actor_user_id, provider, allowed, retry_after_seconds)
    VALUES (p_operation_id, p_actor_user_id, p_provider, false, v_retry);
    RETURN QUERY SELECT false, v_retry;
    RETURN;
  END IF;

  SELECT counter.allowed, counter.retry_after_seconds INTO v_allowed, v_retry
    FROM provider_budget_private.consume_admin_provider_counter(
      p_provider, 'global_minute', 'global',
      v_policy.global_per_minute, v_now, v_minute_expiry
    ) AS counter;
  IF NOT v_allowed THEN
    INSERT INTO provider_budget_private.admin_provider_budget_decisions
      (operation_id, actor_user_id, provider, allowed, retry_after_seconds)
    VALUES (p_operation_id, p_actor_user_id, p_provider, false, v_retry);
    RETURN QUERY SELECT false, v_retry;
    RETURN;
  END IF;

  v_day_expiry := ((v_day + 1)::timestamp AT TIME ZONE 'Asia/Seoul');
  SELECT counter.allowed, counter.retry_after_seconds INTO v_allowed, v_retry
    FROM provider_budget_private.consume_admin_provider_counter(
      p_provider, 'global_day', v_day::text,
      v_policy.global_per_day, v_now, v_day_expiry
    ) AS counter;

  INSERT INTO provider_budget_private.admin_provider_budget_decisions
    (operation_id, actor_user_id, provider, allowed, retry_after_seconds)
  VALUES (p_operation_id, p_actor_user_id, p_provider, v_allowed, v_retry);
  RETURN QUERY SELECT v_allowed, v_retry;
END;
$$;

REVOKE ALL ON TABLE provider_budget_private.admin_provider_budget_policies,
  provider_budget_private.admin_provider_budget_counters,
  provider_budget_private.admin_provider_budget_decisions
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION provider_budget_private.reject_admin_provider_budget_policy_mutation(),
  provider_budget_private.consume_admin_provider_counter(text, text, text, integer, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reserve_admin_provider_budget(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_admin_provider_budget(uuid, text, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
