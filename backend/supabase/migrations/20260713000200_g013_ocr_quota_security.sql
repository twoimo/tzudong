-- G013: reserve OCR quota atomically before provider work.
-- The reservation ledger is private and is never exposed through the Data API.

CREATE SCHEMA ocr_private;
REVOKE ALL ON SCHEMA ocr_private FROM PUBLIC, anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ocr_private
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ocr_private
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ocr_private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE ocr_private.ocr_daily_quota_reservations (
  operation_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  quota_day date NOT NULL,
  reserved_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT ocr_daily_quota_reservations_day_unique
    UNIQUE (user_id, quota_day, operation_id),
  CONSTRAINT ocr_daily_quota_reservations_clock_check
    CHECK (reserved_at <= pg_catalog.clock_timestamp() + interval '1 minute')
);

CREATE INDEX ocr_daily_quota_reservations_user_day_idx
  ON ocr_private.ocr_daily_quota_reservations (user_id, quota_day, reserved_at);
CREATE INDEX ocr_daily_quota_reservations_reserved_at_idx
  ON ocr_private.ocr_daily_quota_reservations (reserved_at);

ALTER TABLE ocr_private.ocr_daily_quota_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocr_private.ocr_daily_quota_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY ocr_daily_quota_reservations_owner_only
  ON ocr_private.ocr_daily_quota_reservations
  TO postgres
  USING (true)
  WITH CHECK (true);

CREATE FUNCTION ocr_private.resolve_ocr_daily_quota(
  p_operation_id uuid,
  p_reserve boolean
)
RETURNS TABLE (
  allowed boolean,
  used_count integer,
  quota_limit integer,
  remaining_count integer,
  unlimited boolean,
  reset_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_quota_day date := (pg_catalog.clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date;
  v_reset_at timestamptz;
  v_used integer := 0;
  v_unlimited boolean := false;
  v_existing_user_id uuid;
  v_existing_quota_day date;
  v_allowed boolean;
BEGIN
  IF auth.role() <> 'authenticated' OR v_user_id IS NULL OR p_reserve IS NULL THEN
    RAISE EXCEPTION 'ocr_quota_authenticated_user_required' USING ERRCODE = '42501';
  END IF;
  IF p_reserve AND p_operation_id IS NULL THEN
    RAISE EXCEPTION 'ocr_quota_operation_required' USING ERRCODE = '22023';
  END IF;

  v_reset_at := ((v_quota_day + 1)::timestamp AT TIME ZONE 'Asia/Seoul');

  WITH expired AS (
    SELECT reservations.ctid
      FROM ocr_private.ocr_daily_quota_reservations AS reservations
     WHERE reservations.quota_day < v_quota_day
     ORDER BY reservations.quota_day, reservations.reserved_at
     LIMIT 100
  )
  DELETE FROM ocr_private.ocr_daily_quota_reservations AS reservations
  USING expired
  WHERE reservations.ctid = expired.ctid;

  SELECT EXISTS (
    SELECT 1
      FROM public.user_roles AS roles
      JOIN public.user_account_status AS account_status
        ON account_status.user_id = roles.user_id
       AND account_status.account_status = 'active'
     WHERE roles.user_id = v_user_id
       AND roles.role = 'admin'
  ) INTO v_unlimited;

  IF p_reserve THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('ocr-operation:' || p_operation_id::text, 0)
    );
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_user_id::text || ':' || v_quota_day::text, 0)
    );

    SELECT reservations.user_id, reservations.quota_day
      INTO v_existing_user_id, v_existing_quota_day
      FROM ocr_private.ocr_daily_quota_reservations AS reservations
     WHERE reservations.operation_id = p_operation_id;

    IF FOUND AND (v_existing_user_id IS DISTINCT FROM v_user_id OR v_existing_quota_day IS DISTINCT FROM v_quota_day) THEN
      RAISE EXCEPTION 'ocr_quota_operation_binding_mismatch' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO v_used
    FROM ocr_private.ocr_daily_quota_reservations AS reservations
   WHERE reservations.user_id = v_user_id
     AND reservations.quota_day = v_quota_day;

  IF v_unlimited THEN
    RETURN QUERY SELECT true, v_used, NULL::integer, NULL::integer, true, v_reset_at;
    RETURN;
  END IF;

  IF p_reserve AND v_existing_user_id IS NOT NULL THEN
    RETURN QUERY SELECT true, v_used, 5, pg_catalog.greatest(0, 5 - v_used), false, v_reset_at;
    RETURN;
  END IF;

  IF p_reserve AND v_used < 5 THEN
    INSERT INTO ocr_private.ocr_daily_quota_reservations (
      operation_id,
      user_id,
      quota_day
    ) VALUES (
      p_operation_id,
      v_user_id,
      v_quota_day
    );
    v_used := v_used + 1;
    v_allowed := true;
  ELSE
    v_allowed := v_used < 5;
  END IF;

  RETURN QUERY
    SELECT v_allowed, v_used, 5, pg_catalog.greatest(0, 5 - v_used), false, v_reset_at;
END;
$$;

CREATE FUNCTION public.get_ocr_daily_quota_status()
RETURNS TABLE (
  allowed boolean,
  used_count integer,
  quota_limit integer,
  remaining_count integer,
  unlimited boolean,
  reset_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT * FROM ocr_private.resolve_ocr_daily_quota(NULL, false);
$$;

CREATE FUNCTION public.reserve_ocr_daily_quota(p_operation_id uuid)
RETURNS TABLE (
  allowed boolean,
  used_count integer,
  quota_limit integer,
  remaining_count integer,
  unlimited boolean,
  reset_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT * FROM ocr_private.resolve_ocr_daily_quota(p_operation_id, true);
$$;

REVOKE ALL ON TABLE ocr_private.ocr_daily_quota_reservations
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ocr_private.resolve_ocr_daily_quota(uuid, boolean)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_ocr_daily_quota_status()
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.reserve_ocr_daily_quota(uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_ocr_daily_quota_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ocr_daily_quota(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';
