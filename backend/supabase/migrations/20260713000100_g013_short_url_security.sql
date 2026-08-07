-- G013: atomically allocate public short URLs without exposing a writable table surface.
-- The rate-limit tables deliberately live outside Supabase's exposed API schemas.

CREATE SCHEMA IF NOT EXISTS shortener_private;
REVOKE ALL ON SCHEMA shortener_private FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public.short_urls
     WHERE code IS NULL
        OR target_url IS NULL
  ) THEN
    RAISE EXCEPTION 'short_urls contains NULL code or target_url rows; repair before applying G013';
  END IF;

  IF EXISTS (
    SELECT code
      FROM public.short_urls
     GROUP BY code
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'short_urls contains duplicate code rows; repair before applying G013';
  END IF;

  IF EXISTS (
    SELECT target_url
      FROM public.short_urls
     GROUP BY target_url
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'short_urls contains duplicate target_url rows; repair before applying G013';
  END IF;
END;
$$;

ALTER TABLE public.short_urls
  ALTER COLUMN code SET NOT NULL,
  ALTER COLUMN target_url SET NOT NULL,
  ADD CONSTRAINT short_urls_code_unique UNIQUE (code),
  ADD CONSTRAINT short_urls_target_url_unique UNIQUE (target_url),
  ADD CONSTRAINT short_urls_code_format CHECK (code ~ '^[A-Za-z0-9]{6}$');

CREATE TABLE shortener_private.short_url_rate_limit_policies (
  scope text PRIMARY KEY,
  max_requests integer NOT NULL,
  window_seconds integer NOT NULL,
  CONSTRAINT short_url_rate_limit_policies_scope_check
    CHECK (scope IN ('ip', 'global', 'review')),
  CONSTRAINT short_url_rate_limit_policies_fixed_values_check
    CHECK (
      (scope = 'ip' AND max_requests = 20 AND window_seconds = 60)
      OR (scope = 'global' AND max_requests = 200 AND window_seconds = 60)
      OR (scope = 'review' AND max_requests = 10 AND window_seconds = 60)
    )
);

INSERT INTO shortener_private.short_url_rate_limit_policies (scope, max_requests, window_seconds)
VALUES
  ('ip', 20, 60),
  ('global', 200, 60),
  ('review', 10, 60);

CREATE TABLE shortener_private.short_url_rate_limit_counters (
  policy_scope text NOT NULL REFERENCES shortener_private.short_url_rate_limit_policies (scope),
  bucket_key text NOT NULL,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (policy_scope, bucket_key),
  CONSTRAINT short_url_rate_limit_counters_expiry_check CHECK (expires_at > window_started_at)
);

CREATE INDEX short_url_rate_limit_counters_expiry_idx
  ON shortener_private.short_url_rate_limit_counters (expires_at);

CREATE FUNCTION shortener_private.reject_short_url_rate_limit_policy_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'short_url_rate_limit_policies_are_immutable';
END;
$$;

CREATE TRIGGER short_url_rate_limit_policies_immutable
BEFORE INSERT OR UPDATE OR DELETE ON shortener_private.short_url_rate_limit_policies
FOR EACH ROW
EXECUTE FUNCTION shortener_private.reject_short_url_rate_limit_policy_mutation();

CREATE FUNCTION shortener_private.cleanup_expired_short_url_rate_limits(p_now timestamptz)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH expired AS (
    SELECT counters.ctid
      FROM shortener_private.short_url_rate_limit_counters AS counters
     WHERE counters.expires_at <= p_now - interval '1 hour'
     ORDER BY counters.expires_at ASC
     LIMIT 100
  )
  DELETE FROM shortener_private.short_url_rate_limit_counters AS counters
  USING expired
  WHERE counters.ctid = expired.ctid;
$$;

CREATE FUNCTION shortener_private.consume_short_url_rate_limit(
  p_scope text,
  p_bucket_key text,
  p_now timestamptz
)
RETURNS TABLE (allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_policy shortener_private.short_url_rate_limit_policies%ROWTYPE;
  v_request_count integer;
  v_expires_at timestamptz;
BEGIN
  IF p_scope IS NULL
     OR p_scope NOT IN ('ip', 'global', 'review')
     OR p_bucket_key IS NULL
     OR char_length(p_bucket_key) < 1
     OR char_length(p_bucket_key) > 80
     OR p_now IS NULL THEN
    RAISE EXCEPTION 'invalid_short_url_rate_limit_request';
  END IF;

  SELECT policies.*
    INTO v_policy
    FROM shortener_private.short_url_rate_limit_policies AS policies
   WHERE policies.scope = p_scope;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'missing_short_url_rate_limit_policy';
  END IF;

  INSERT INTO shortener_private.short_url_rate_limit_counters AS counters (
    policy_scope,
    bucket_key,
    window_started_at,
    request_count,
    expires_at
  ) VALUES (
    v_policy.scope,
    p_bucket_key,
    p_now,
    1,
    p_now + (v_policy.window_seconds * interval '1 second')
  )
  ON CONFLICT (policy_scope, bucket_key) DO UPDATE
     SET window_started_at = CASE
           WHEN counters.expires_at <= p_now THEN p_now
           ELSE counters.window_started_at
         END,
         request_count = CASE
           WHEN counters.expires_at <= p_now THEN 1
           ELSE counters.request_count + 1
         END,
         expires_at = CASE
           WHEN counters.expires_at <= p_now THEN p_now + (v_policy.window_seconds * interval '1 second')
           ELSE counters.expires_at
         END
  RETURNING counters.request_count, counters.expires_at
       INTO v_request_count, v_expires_at;

  allowed := v_request_count <= v_policy.max_requests;
  retry_after_seconds := CASE
    WHEN allowed THEN 0
    ELSE GREATEST(1, CEIL(EXTRACT(EPOCH FROM v_expires_at - p_now))::integer)
  END;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.allocate_short_url(
  p_target_url text,
  p_restaurant_id uuid,
  p_review_id uuid,
  p_client_bucket text,
  p_candidate_codes text[]
)
RETURNS TABLE (
  code text,
  is_existing boolean,
  rate_limited boolean,
  retry_after_seconds integer,
  allocation_failed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_ip_allowed boolean;
  v_ip_retry_after integer;
  v_global_allowed boolean;
  v_global_retry_after integer;
  v_review_allowed boolean;
  v_review_retry_after integer;
  v_candidate_code text;
  v_existing_code text;
  v_inserted_code text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'short_url_allocation_service_role_required';
  END IF;

  IF p_target_url IS NULL
     OR p_restaurant_id IS NULL
     OR p_review_id IS NULL
     OR p_client_bucket IS NULL
     OR (p_client_bucket <> 'unknown' AND p_client_bucket !~ '^ip:[0-9a-f]{64}$')
     OR p_target_url !~ E'^/\\?review=[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR p_target_url <> ('/?review=' || p_review_id::text)
     OR p_candidate_codes IS NULL
     OR array_ndims(p_candidate_codes) <> 1
     OR COALESCE(array_length(p_candidate_codes, 1), 0) <> 5 THEN
    RAISE EXCEPTION 'invalid_short_url_allocation_request';
  END IF;

  FOREACH v_candidate_code IN ARRAY p_candidate_codes LOOP
    IF v_candidate_code IS NULL OR v_candidate_code !~ '^[A-Za-z0-9]{6}$' THEN
      RAISE EXCEPTION 'invalid_short_url_allocation_request';
    END IF;
  END LOOP;

  PERFORM shortener_private.cleanup_expired_short_url_rate_limits(v_now);

  SELECT limits.allowed, limits.retry_after_seconds
    INTO v_ip_allowed, v_ip_retry_after
    FROM shortener_private.consume_short_url_rate_limit('ip', p_client_bucket, v_now) AS limits;
  SELECT limits.allowed, limits.retry_after_seconds
    INTO v_global_allowed, v_global_retry_after
    FROM shortener_private.consume_short_url_rate_limit('global', 'global', v_now) AS limits;
  SELECT limits.allowed, limits.retry_after_seconds
    INTO v_review_allowed, v_review_retry_after
    FROM shortener_private.consume_short_url_rate_limit('review', p_review_id::text, v_now) AS limits;

  IF NOT v_ip_allowed OR NOT v_global_allowed OR NOT v_review_allowed THEN
    code := NULL;
    is_existing := false;
    rate_limited := true;
    retry_after_seconds := GREATEST(v_ip_retry_after, v_global_retry_after, v_review_retry_after);
    allocation_failed := false;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT short_urls.code
    INTO v_existing_code
    FROM public.short_urls AS short_urls
   WHERE short_urls.target_url = p_target_url;

  IF FOUND THEN
    code := v_existing_code;
    is_existing := true;
    rate_limited := false;
    retry_after_seconds := 0;
    allocation_failed := false;
    RETURN NEXT;
    RETURN;
  END IF;

  FOREACH v_candidate_code IN ARRAY p_candidate_codes LOOP
    INSERT INTO public.short_urls AS short_urls (
      code,
      target_url,
      restaurant_id,
      restaurant_name
    ) VALUES (
      v_candidate_code,
      p_target_url,
      p_restaurant_id,
      NULL
    )
    ON CONFLICT DO NOTHING
    RETURNING short_urls.code INTO v_inserted_code;

    IF FOUND THEN
      code := v_inserted_code;
      is_existing := false;
      rate_limited := false;
      retry_after_seconds := 0;
      allocation_failed := false;
      RETURN NEXT;
      RETURN;
    END IF;

    SELECT short_urls.code
      INTO v_existing_code
      FROM public.short_urls AS short_urls
     WHERE short_urls.target_url = p_target_url;

    IF FOUND THEN
      code := v_existing_code;
      is_existing := true;
      rate_limited := false;
      retry_after_seconds := 0;
      allocation_failed := false;
      RETURN NEXT;
      RETURN;
    END IF;
  END LOOP;

  code := NULL;
  is_existing := false;
  rate_limited := false;
  retry_after_seconds := 0;
  allocation_failed := true;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON TABLE shortener_private.short_url_rate_limit_policies
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE shortener_private.short_url_rate_limit_counters
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION shortener_private.reject_short_url_rate_limit_policy_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION shortener_private.cleanup_expired_short_url_rate_limits(timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION shortener_private.consume_short_url_rate_limit(text, text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.short_urls
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.allocate_short_url(text, uuid, uuid, text, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_short_url(text, uuid, uuid, text, text[])
  TO service_role;
