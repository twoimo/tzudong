-- G013 OCR quota adversarial contracts. Run against a disposable migrated database.

BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('88888888-8888-4888-8888-888888888801', 'authenticated', 'authenticated', 'g013-quota-user@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('88888888-8888-4888-8888-888888888802', 'authenticated', 'authenticated', 'g013-quota-other@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('88888888-8888-4888-8888-888888888803', 'authenticated', 'authenticated', 'g013-quota-admin@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());

INSERT INTO public.user_roles (user_id, role)
VALUES ('88888888-8888-4888-8888-888888888803', 'admin');
INSERT INTO public.user_account_status (user_id, account_status)
VALUES ('88888888-8888-4888-8888-888888888803', 'active');

DO $$
DECLARE
  v_result record;
  v_call integer;
  v_operation_id uuid;
  v_user_id uuid := '88888888-8888-4888-8888-888888888801';
  v_other_user_id uuid := '88888888-8888-4888-8888-888888888802';
  v_admin_user_id uuid := '88888888-8888-4888-8888-888888888803';
BEGIN
  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_user_id, 'role', 'authenticated')::text,
    true
  );

  SELECT * INTO v_result FROM public.get_ocr_daily_quota_status();
  IF NOT v_result.allowed OR v_result.used_count <> 0 OR v_result.quota_limit <> 5 OR v_result.remaining_count <> 5 OR v_result.unlimited THEN
    RAISE EXCEPTION 'G013 initial OCR quota state is incorrect';
  END IF;

  FOR v_call IN 1..5 LOOP
    v_operation_id := ('99999999-9999-4999-8999-' || lpad(v_call::text, 12, '0'))::uuid;
    SELECT * INTO v_result FROM public.reserve_ocr_daily_quota(v_operation_id);
    IF NOT v_result.allowed OR v_result.used_count <> v_call OR v_result.remaining_count <> 5 - v_call THEN
      RAISE EXCEPTION 'G013 reservation % did not atomically consume one slot', v_call;
    END IF;
  END LOOP;

  SELECT * INTO v_result
    FROM public.reserve_ocr_daily_quota('99999999-9999-4999-8999-000000000001');
  IF NOT v_result.allowed OR v_result.used_count <> 5 OR v_result.remaining_count <> 0 THEN
    RAISE EXCEPTION 'G013 idempotent OCR reservation replay changed quota state';
  END IF;

  SELECT * INTO v_result
    FROM public.reserve_ocr_daily_quota('99999999-9999-4999-8999-000000000006');
  IF v_result.allowed OR v_result.used_count <> 5 OR v_result.remaining_count <> 0 THEN
    RAISE EXCEPTION 'G013 OCR quota admitted the sixth operation';
  END IF;

  IF (
    SELECT count(*)
      FROM ocr_private.ocr_daily_quota_reservations AS reservations
     WHERE reservations.user_id = v_user_id
  ) <> 5 THEN
    RAISE EXCEPTION 'G013 OCR reservation ledger count drifted';
  END IF;

  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_other_user_id, 'role', 'authenticated')::text,
    true
  );
  BEGIN
    PERFORM * FROM public.reserve_ocr_daily_quota('99999999-9999-4999-8999-000000000001');
    RAISE EXCEPTION 'G013 cross-user operation replay unexpectedly succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM <> 'ocr_quota_operation_binding_mismatch' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM * FROM public.reserve_ocr_daily_quota(NULL);
    RAISE EXCEPTION 'G013 NULL OCR operation unexpectedly succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM <> 'ocr_quota_operation_required' THEN
        RAISE;
      END IF;
  END;

  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_admin_user_id, 'role', 'authenticated')::text,
    true
  );
  SELECT * INTO v_result
    FROM public.reserve_ocr_daily_quota('99999999-9999-4999-8999-000000000099');
  IF NOT v_result.allowed OR NOT v_result.unlimited OR v_result.quota_limit IS NOT NULL OR v_result.remaining_count IS NOT NULL THEN
    RAISE EXCEPTION 'G013 active admin did not receive bounded unlimited status';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM ocr_private.ocr_daily_quota_reservations AS reservations
     WHERE reservations.operation_id = '99999999-9999-4999-8999-000000000099'
  ) THEN
    RAISE EXCEPTION 'G013 admin bypass persisted an unnecessary reservation';
  END IF;
END;
$$;

DO $$
BEGIN
  IF pg_catalog.has_schema_privilege('authenticated', 'ocr_private', 'USAGE')
     OR pg_catalog.has_table_privilege('authenticated', 'ocr_private.ocr_daily_quota_reservations', 'SELECT')
     OR pg_catalog.has_table_privilege('service_role', 'ocr_private.ocr_daily_quota_reservations', 'INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'G013 private OCR quota ledger is directly reachable';
  END IF;
  IF NOT pg_catalog.has_function_privilege('authenticated', 'public.reserve_ocr_daily_quota(uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.reserve_ocr_daily_quota(uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'public.reserve_ocr_daily_quota(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'G013 OCR quota RPC privilege matrix is incorrect';
  END IF;
END;
$$;

ROLLBACK;
