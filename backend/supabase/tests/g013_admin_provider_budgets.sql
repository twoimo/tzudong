-- G013 shared provider-budget adversarial contracts. Run in a disposable migrated database.

BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('77777777-7777-4777-8777-777777777701', 'authenticated', 'authenticated', 'g013-provider-admin@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('77777777-7777-4777-8777-777777777702', 'authenticated', 'authenticated', 'g013-provider-other@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('77777777-7777-4777-8777-777777777703', 'authenticated', 'authenticated', 'g013-provider-user@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());
INSERT INTO public.user_roles (user_id, role) VALUES
  ('77777777-7777-4777-8777-777777777701', 'admin'),
  ('77777777-7777-4777-8777-777777777702', 'admin');
INSERT INTO public.user_account_status (user_id, account_status) VALUES
  ('77777777-7777-4777-8777-777777777701', 'active'),
  ('77777777-7777-4777-8777-777777777702', 'active'),
  ('77777777-7777-4777-8777-777777777703', 'active');

SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

DO $$
DECLARE
  v_admin uuid := '77777777-7777-4777-8777-777777777701';
  v_other_admin uuid := '77777777-7777-4777-8777-777777777702';
  v_user uuid := '77777777-7777-4777-8777-777777777703';
  v_operation uuid;
  v_result record;
  v_call integer;
  v_actor_counter integer;
BEGIN
  FOR v_call IN 1..30 LOOP
    v_operation := ('aaaaaaaa-aaaa-4aaa-8aaa-' || lpad(v_call::text, 12, '0'))::uuid;
    SELECT * INTO v_result
      FROM public.reserve_admin_provider_budget(v_admin, 'naver_local_search', v_operation);
    IF NOT v_result.allowed OR v_result.retry_after_seconds <> 0 THEN
      RAISE EXCEPTION 'G013 provider budget rejected request % before the actor ceiling', v_call;
    END IF;
  END LOOP;

  SELECT * INTO v_result
    FROM public.reserve_admin_provider_budget(
      v_admin,
      'naver_local_search',
      'aaaaaaaa-aaaa-4aaa-8aaa-000000000031'
    );
  IF v_result.allowed OR v_result.retry_after_seconds < 1 THEN
    RAISE EXCEPTION 'G013 provider budget admitted the first request above the actor ceiling';
  END IF;

  SELECT request_count INTO v_actor_counter
    FROM provider_budget_private.admin_provider_budget_counters
   WHERE provider = 'naver_local_search'
     AND scope = 'actor_minute'
     AND bucket_key = v_admin::text;

  SELECT * INTO v_result
    FROM public.reserve_admin_provider_budget(
      v_admin,
      'naver_local_search',
      'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'
    );
  IF NOT v_result.allowed OR v_result.retry_after_seconds <> 0 THEN
    RAISE EXCEPTION 'G013 provider decision replay changed its original result';
  END IF;
  IF (SELECT request_count FROM provider_budget_private.admin_provider_budget_counters WHERE provider = 'naver_local_search' AND scope = 'actor_minute' AND bucket_key = v_admin::text) <> v_actor_counter THEN
    RAISE EXCEPTION 'G013 provider decision replay consumed another counter slot';
  END IF;

  BEGIN
    PERFORM * FROM public.reserve_admin_provider_budget(
      v_other_admin,
      'naver_local_search',
      'aaaaaaaa-aaaa-4aaa-8aaa-000000000001'
    );
    RAISE EXCEPTION 'G013 cross-actor provider operation replay unexpectedly succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM <> 'admin_provider_budget_operation_binding_mismatch' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM * FROM public.reserve_admin_provider_budget(
      v_admin,
      'unknown_provider',
      'bbbbbbbb-bbbb-4bbb-8bbb-000000000001'
    );
    RAISE EXCEPTION 'G013 unknown provider unexpectedly succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM <> 'admin_provider_budget_provider_invalid' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM * FROM public.reserve_admin_provider_budget(
      v_user,
      'naver_geocode',
      'bbbbbbbb-bbbb-4bbb-8bbb-000000000002'
    );
    RAISE EXCEPTION 'G013 non-admin provider reservation unexpectedly succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM <> 'admin_provider_budget_actor_forbidden' THEN
        RAISE;
      END IF;
  END;
END;
$$;

DO $$
BEGIN
  IF pg_catalog.has_schema_privilege('service_role', 'provider_budget_private', 'USAGE')
     OR pg_catalog.has_table_privilege('service_role', 'provider_budget_private.admin_provider_budget_counters', 'INSERT,UPDATE,DELETE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.reserve_admin_provider_budget(uuid,text,uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.reserve_admin_provider_budget(uuid,text,uuid)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.reserve_admin_provider_budget(uuid,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'G013 provider budget privilege matrix is incorrect';
  END IF;
END;
$$;

ROLLBACK;
