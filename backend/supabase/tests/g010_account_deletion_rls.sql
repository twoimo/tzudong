\set ON_ERROR_STOP on

-- Execute after the G010 foundation, notification, account-deletion, and
-- retention migrations in a disposable local Supabase/Postgres database.
BEGIN;

CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL,
  name text NOT NULL,
  owner_id text
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN (
        'account_deletion_policies',
        'account_deletion_data_classes',
        'account_deletion_requests',
        'account_deletion_request_items'
      )
      AND (NOT relation.relrowsecurity OR NOT relation.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'account deletion tables must enable and force RLS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT role_name, relation_name, privilege_name
      FROM (VALUES
        ('anon'::name),
        ('authenticated'::name)
      ) AS browser_roles(role_name)
      CROSS JOIN (VALUES
        ('account_deletion_policies'::text),
        ('account_deletion_data_classes'::text),
        ('account_deletion_requests'::text),
        ('account_deletion_request_items'::text)
      ) AS relations(relation_name)
      CROSS JOIN (VALUES
        ('SELECT'::text),
        ('INSERT'::text),
        ('UPDATE'::text),
        ('DELETE'::text),
        ('TRUNCATE'::text),
        ('REFERENCES'::text),
        ('TRIGGER'::text)
      ) AS privileges(privilege_name)
    ) AS grant_check
    WHERE pg_catalog.has_table_privilege(
      role_name,
      'public.' || relation_name,
      privilege_name
    )
  ) THEN
    RAISE EXCEPTION 'browser roles must not directly access account deletion tables';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('account_deletion_policies'::text),
      ('account_deletion_data_classes'::text),
      ('account_deletion_requests'::text),
      ('account_deletion_request_items'::text)
    ) AS relations(relation_name)
    CROSS JOIN (VALUES
      ('DELETE'::text),
      ('TRUNCATE'::text),
      ('REFERENCES'::text),
      ('TRIGGER'::text)
    ) AS privileges(privilege_name)
    WHERE pg_catalog.has_table_privilege(
      'service_role',
      'public.' || relation_name,
      privilege_name
    )
  ) OR EXISTS (
    SELECT 1
    FROM (VALUES
      ('account_deletion_policies'::text),
      ('account_deletion_data_classes'::text),
      ('account_deletion_requests'::text),
      ('account_deletion_request_items'::text)
    ) AS relations(relation_name)
    CROSS JOIN (VALUES
      ('SELECT'::text),
      ('INSERT'::text),
      ('UPDATE'::text)
    ) AS privileges(privilege_name)
    WHERE NOT pg_catalog.has_table_privilege(
      'service_role',
      'public.' || relation_name,
      privilege_name
    )
  ) THEN
    RAISE EXCEPTION 'service role account deletion table grant matrix is not least-privilege';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('anon'::name),
      ('authenticated'::name)
    ) AS browser_roles(role_name)
    CROSS JOIN (VALUES
      ('public.preview_account_deletion(uuid,uuid,timestamp with time zone)'::regprocedure),
      ('public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamp with time zone)'::regprocedure),
      ('public.apply_account_deletion_database_cleanup(uuid,uuid)'::regprocedure),
      ('public.list_account_deletion_storage_objects(uuid,uuid)'::regprocedure),
      ('public.finalize_account_deletion_storage(uuid,uuid,boolean)'::regprocedure),
      ('public.finalize_account_deletion_auth(uuid,uuid,boolean)'::regprocedure),
      ('public.fail_account_deletion(uuid,uuid,text)'::regprocedure),
      ('public.account_deletion_reason_code_is_safe(text)'::regprocedure)
    ) AS rpc_check(procedure_name)
    WHERE pg_catalog.has_function_privilege(role_name, procedure_name, 'EXECUTE')
  ) OR EXISTS (
    SELECT 1
    FROM (VALUES
      ('public.preview_account_deletion(uuid,uuid,timestamp with time zone)'::regprocedure),
      ('public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamp with time zone)'::regprocedure),
      ('public.apply_account_deletion_database_cleanup(uuid,uuid)'::regprocedure),
      ('public.list_account_deletion_storage_objects(uuid,uuid)'::regprocedure),
      ('public.finalize_account_deletion_storage(uuid,uuid,boolean)'::regprocedure),
      ('public.finalize_account_deletion_auth(uuid,uuid,boolean)'::regprocedure),
      ('public.fail_account_deletion(uuid,uuid,text)'::regprocedure),
      ('public.account_deletion_reason_code_is_safe(text)'::regprocedure)
    ) AS rpc_check(procedure_name)
    WHERE NOT pg_catalog.has_function_privilege('service_role', procedure_name, 'EXECUTE')
  ) OR EXISTS (
    SELECT 1
    FROM (VALUES
      ('public.account_deletion_set_updated_at()'::regprocedure),
      ('public.account_deletion_require_service_role()'::regprocedure),
      ('public.account_deletion_subject_hash(uuid)'::regprocedure),
      ('public.account_deletion_is_active_admin(uuid)'::regprocedure),
      ('public.account_deletion_write_audit(public.account_deletion_requests,text,text)'::regprocedure)
    ) AS helper_check(procedure_name)
    WHERE pg_catalog.has_function_privilege('service_role', procedure_name, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'account deletion RPC grants must expose only intended service interfaces';
  END IF;
END;
$$;

-- The retention resolver must fail closed until the exact account-deletion
-- audit class is fully approved and activated.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM privacy_retention.privacy_retention_classes
    WHERE code = 'privacy_account_deletion_audit'
      AND status = 'disabled'
  ) THEN
    RAISE EXCEPTION 'account deletion audit retention class must begin disabled';
  END IF;

  BEGIN
    PERFORM public.privacy_resolve_audit_retention_until(
      'privacy_account_deletion_audit',
      pg_catalog.clock_timestamp()
    );
    RAISE EXCEPTION 'disabled account deletion audit retention unexpectedly resolved';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;
END;
$$;

SELECT pg_catalog.set_config(
  'g010_deletion_test.reauthenticated_at',
  pg_catalog.clock_timestamp()::text,
  true
);

INSERT INTO auth.users (
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  last_sign_in_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
VALUES
  (
    '00000000-0000-0000-0000-000000001101',
    'authenticated',
    'authenticated',
    'g010-deletion-target@example.invalid',
    'g010-test-only-placeholder',
    pg_catalog.current_setting('g010_deletion_test.reauthenticated_at')::timestamptz,
    pg_catalog.current_setting('g010_deletion_test.reauthenticated_at')::timestamptz,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    pg_catalog.current_setting('g010_deletion_test.reauthenticated_at')::timestamptz,
    pg_catalog.current_setting('g010_deletion_test.reauthenticated_at')::timestamptz
  ),
  (
    '00000000-0000-0000-0000-000000001102',
    'authenticated',
    'authenticated',
    'g010-deletion-other@example.invalid',
    'g010-test-only-placeholder',
    pg_catalog.current_setting('g010_deletion_test.reauthenticated_at')::timestamptz,
    pg_catalog.current_setting('g010_deletion_test.reauthenticated_at')::timestamptz,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    pg_catalog.current_setting('g010_deletion_test.reauthenticated_at')::timestamptz,
    pg_catalog.current_setting('g010_deletion_test.reauthenticated_at')::timestamptz
  ),
  (
    '00000000-0000-0000-0000-000000001103',
    'authenticated',
    'authenticated',
    'g010-deletion-last-admin@example.invalid',
    'g010-test-only-placeholder',
    pg_catalog.current_setting('g010_deletion_test.reauthenticated_at')::timestamptz,
    pg_catalog.current_setting('g010_deletion_test.reauthenticated_at')::timestamptz,
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb,
    pg_catalog.current_setting('g010_deletion_test.reauthenticated_at')::timestamptz,
    pg_catalog.current_setting('g010_deletion_test.reauthenticated_at')::timestamptz
  );
INSERT INTO public.privacy_policy_versions (
  id,
  version,
  locale,
  status,
  content_sha256,
  effective_at,
  published_at,
  operator_approval_ref
) VALUES (
  '00000000-0000-0000-0000-000000001121',
  'g010-account-deletion-test-v1',
  'ko-KR',
  'published',
  repeat('c', 64),
  pg_catalog.clock_timestamp() - interval '1 minute',
  pg_catalog.clock_timestamp(),
  'G010-ACCOUNT-DELETION-TEST'
);

INSERT INTO public.profiles (user_id, username, nickname, avatar_url, role)
VALUES (
  '00000000-0000-0000-0000-000000001101',
  NULL,
  'G010 test',
  NULL,
  'user'
);

INSERT INTO public.user_roles (user_id, role)
VALUES
  ('00000000-0000-0000-0000-000000001101', 'user'),
  ('00000000-0000-0000-0000-000000001102', 'user'),
  ('00000000-0000-0000-0000-000000001103', 'admin');

INSERT INTO public.user_account_status (user_id, account_status)
VALUES
  ('00000000-0000-0000-0000-000000001101', 'active'),
  ('00000000-0000-0000-0000-000000001102', 'active'),
  ('00000000-0000-0000-0000-000000001103', 'active');

INSERT INTO public.notifications (id, user_id, type, title, message, data)
VALUES (
  '00000000-0000-0000-0000-000000001104',
  '00000000-0000-0000-0000-000000001101',
  'g010_test',
  'G010 test',
  'G010 deletion fixture',
  '{"fixture":true}'::jsonb
);
INSERT INTO public.restaurants (id, approved_name)
VALUES (
  '00000000-0000-0000-0000-000000001110',
  'G010 deletion fixture restaurant'
);

INSERT INTO public.reviews (
  id,
  user_id,
  restaurant_id,
  title,
  content,
  visited_at,
  verification_photo,
  food_photos,
  categories,
  is_verified
)
VALUES
  (
    '00000000-0000-0000-0000-000000001111',
    '00000000-0000-0000-0000-000000001101',
    '00000000-0000-0000-0000-000000001110',
    'G010 target review',
    'G010 target review fixture',
    pg_catalog.clock_timestamp(),
    'g010/target-receipt.webp',
    ARRAY[]::text[],
    ARRAY['한식']::text[],
    false
  ),
  (
    '00000000-0000-0000-0000-000000001112',
    '00000000-0000-0000-0000-000000001102',
    '00000000-0000-0000-0000-000000001110',
    'G010 unrelated review',
    'G010 unrelated review fixture',
    pg_catalog.clock_timestamp(),
    'g010/unrelated-receipt.webp',
    ARRAY[]::text[],
    ARRAY['한식']::text[],
    false
  );

INSERT INTO public.review_likes (review_id, user_id)
VALUES
  ('00000000-0000-0000-0000-000000001111', '00000000-0000-0000-0000-000000001101'),
  ('00000000-0000-0000-0000-000000001111', '00000000-0000-0000-0000-000000001102'),
  ('00000000-0000-0000-0000-000000001112', '00000000-0000-0000-0000-000000001101'),
  ('00000000-0000-0000-0000-000000001112', '00000000-0000-0000-0000-000000001102');

INSERT INTO public.restaurant_submissions (
  id,
  user_id,
  submission_type,
  status,
  restaurant_name,
  restaurant_phone,
  restaurant_address,
  restaurant_categories
)
VALUES
  (
    '00000000-0000-0000-0000-000000001113',
    '00000000-0000-0000-0000-000000001101',
    'new',
    'pending',
    'G010 target submission',
    '010-0000-1101',
    'Seoul G010 target submission',
    ARRAY['한식']::text[]
  ),
  (
    '00000000-0000-0000-0000-000000001114',
    '00000000-0000-0000-0000-000000001102',
    'new',
    'pending',
    'G010 unrelated submission',
    '010-0000-1102',
    'Seoul G010 unrelated submission',
    ARRAY['한식']::text[]
  );

INSERT INTO public.restaurant_requests (
  id,
  user_id,
  restaurant_name,
  origin_address,
  phone,
  categories,
  recommendation_reason,
  youtube_link,
  client_request_key,
  status
)
VALUES
  (
    '00000000-0000-0000-0000-000000001115',
    '00000000-0000-0000-0000-000000001101',
    'G010 target request',
    'Seoul G010 target request',
    '010-0000-1201',
    ARRAY['한식']::text[],
    'G010 target request fixture',
    'https://example.invalid/g010-target-request',
    'g010-request-target-0001',
    'pending'
  ),
  (
    '00000000-0000-0000-0000-000000001116',
    '00000000-0000-0000-0000-000000001102',
    'G010 unrelated request',
    'Seoul G010 unrelated request',
    '010-0000-1202',
    ARRAY['한식']::text[],
    'G010 unrelated request fixture',
    'https://example.invalid/g010-unrelated-request',
    'g010-request-other-0001',
    'pending'
  );

INSERT INTO public.ocr_logs (id, user_id, image_hash)
VALUES
  ('00000000-0000-0000-0000-000000001117', '00000000-0000-0000-0000-000000001101', 'g010-target-ocr-log'),
  ('00000000-0000-0000-0000-000000001118', '00000000-0000-0000-0000-000000001102', 'g010-unrelated-ocr-log');

INSERT INTO public.marketing_campaign_operations (
  id,
  actor_user_id,
  channel,
  title,
  message,
  preview_hash,
  expires_at
)
VALUES
  (
    '00000000-0000-0000-0000-000000001119',
    '00000000-0000-0000-0000-000000001102',
    'push',
    'G010 target recipient campaign',
    'G010 target recipient fixture',
    repeat('a', 64),
    pg_catalog.clock_timestamp() + interval '1 hour'
  ),
  (
    '00000000-0000-0000-0000-000000001120',
    '00000000-0000-0000-0000-000000001102',
    'push',
    'G010 unrelated recipient campaign',
    'G010 unrelated recipient fixture',
    repeat('b', 64),
    pg_catalog.clock_timestamp() + interval '1 hour'
  );

INSERT INTO public.marketing_campaign_recipients (operation_id, user_id)
VALUES
  ('00000000-0000-0000-0000-000000001119', '00000000-0000-0000-0000-000000001101'),
  ('00000000-0000-0000-0000-000000001120', '00000000-0000-0000-0000-000000001102');

INSERT INTO auth.sessions (id, user_id)
VALUES (
  '00000000-0000-0000-0000-000000001105',
  '00000000-0000-0000-0000-000000001101'
);
INSERT INTO public.privacy_onboarding_challenges (
  id,
  token_hash,
  policy_version_id,
  age_band,
  requested_consents,
  expires_at,
  consumed_at,
  consumed_by_user_id
) VALUES (
  '00000000-0000-0000-0000-000000001122',
  repeat('d', 64),
  '00000000-0000-0000-0000-000000001121',
  'under_14',
  '{"email":true}'::jsonb,
  pg_catalog.clock_timestamp() + interval '1 hour',
  pg_catalog.clock_timestamp(),
  '00000000-0000-0000-0000-000000001101'
);
INSERT INTO public.privacy_age_profiles (
  user_id,
  age_band,
  attested_at,
  method,
  status,
  policy_version_id
) VALUES (
  '00000000-0000-0000-0000-000000001101',
  'under_14',
  pg_catalog.clock_timestamp(),
  'verified_provider',
  'guardian_pending',
  '00000000-0000-0000-0000-000000001121'
);
INSERT INTO public.privacy_guardian_verifications (
  id,
  child_user_id,
  status,
  provider,
  provider_reference_hash,
  verified_at,
  expires_at
) VALUES (
  '00000000-0000-0000-0000-000000001132',
  '00000000-0000-0000-0000-000000001101',
  'verified',
  'g010-account-deletion-test',
  repeat('d', 64),
  pg_catalog.clock_timestamp(),
  pg_catalog.clock_timestamp() + interval '1 day'
);
INSERT INTO public.privacy_consent_events (
  id,
  user_id,
  subject_kind,
  guardian_verification_id,
  purpose,
  channel,
  decision,
  policy_version_id,
  notice_sha256,
  source,
  correlation_id,
  idempotency_key
) VALUES
  (
    '00000000-0000-0000-0000-000000001123',
    '00000000-0000-0000-0000-000000001101',
    'child',
    '00000000-0000-0000-0000-000000001132',
    'privacy_required',
    'none',
    'granted',
    '00000000-0000-0000-0000-000000001121',
    repeat('c', 64),
    'guardian',
    '00000000-0000-0000-0000-000000001122',
    'g010-delete-target-required-0001'
  ),
  (
    '00000000-0000-0000-0000-000000001124',
    '00000000-0000-0000-0000-000000001101',
    'self',
    NULL,
    'email_marketing',
    'email',
    'granted',
    '00000000-0000-0000-0000-000000001121',
    repeat('c', 64),
    'password_signup',
    '00000000-0000-0000-0000-000000001122',
    'g010-delete-target-email-000001'
  ),
  (
    '00000000-0000-0000-0000-000000001128',
    '00000000-0000-0000-0000-000000001102',
    'self',
    NULL,
    'email_marketing',
    'email',
    'granted',
    '00000000-0000-0000-0000-000000001121',
    repeat('c', 64),
    'password_signup',
    '00000000-0000-0000-0000-000000001126',
    'g010-delete-other-email-000002'
  );
INSERT INTO public.privacy_audit_events (
  id,
  event_type,
  actor_user_id,
  subject_ref_hash,
  operation_id,
  correlation_id,
  preview_hash,
  status,
  reason_code,
  count_summary,
  request_metadata,
  occurred_at,
  retention_until
) VALUES
  (
    '00000000-0000-0000-0000-000000001125',
    'onboarding_confirmed',
    '00000000-0000-0000-0000-000000001101',
    repeat('e', 64),
    '00000000-0000-0000-0000-000000001126',
    '00000000-0000-0000-0000-000000001127',
    repeat('f', 64),
    'applied',
    'ONBOARDING_CONFIRMED',
    '{"consentEvents":2,"eligible":true}'::jsonb,
    '{"route":"/api/privacy/onboarding"}'::jsonb,
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp() + interval '1 day'
  ),
  (
    '00000000-0000-0000-0000-000000001129',
    'onboarding_confirmed',
    '00000000-0000-0000-0000-000000001102',
    repeat('a', 64),
    '00000000-0000-0000-0000-000000001130',
    '00000000-0000-0000-0000-000000001131',
    repeat('b', 64),
    'applied',
    'ONBOARDING_CONFIRMED',
    '{"consentEvents":1,"eligible":true}'::jsonb,
    '{"route":"/api/privacy/onboarding"}'::jsonb,
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp() + interval '1 day'
  );

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);

DO $$
DECLARE
  v_preview record;
BEGIN
  SELECT * INTO v_preview
  FROM public.preview_account_deletion(
    '00000000-0000-0000-0000-000000001102',
    '00000000-0000-0000-0000-000000001101',
    pg_catalog.current_setting('g010_deletion_test.reauthenticated_at')::timestamptz
  );
  IF v_preview.request_id IS NOT NULL
     OR v_preview.status <> 'failed'
     OR v_preview.reason_code <> 'ACTOR_NOT_ALLOWED' THEN
    RAISE EXCEPTION 'cross-user preview must fail for a non-admin actor';
  END IF;

  SELECT * INTO v_preview
  FROM public.preview_account_deletion(
    '00000000-0000-0000-0000-000000001103',
    '00000000-0000-0000-0000-000000001103',
    pg_catalog.current_setting('g010_deletion_test.reauthenticated_at')::timestamptz
  );
  IF v_preview.request_id IS NOT NULL
     OR v_preview.status <> 'failed'
     OR v_preview.reason_code <> 'LAST_ADMIN_PROTECTED' THEN
    RAISE EXCEPTION 'last active admin preview must fail closed';
  END IF;

  SELECT * INTO v_preview
  FROM public.preview_account_deletion(
    '00000000-0000-0000-0000-000000001101',
    '00000000-0000-0000-0000-000000001101',
    pg_catalog.current_setting('g010_deletion_test.reauthenticated_at')::timestamptz
  );
  IF v_preview.request_id IS NOT NULL
     OR v_preview.status <> 'failed'
     OR v_preview.reason_code <> 'RETENTION_POLICY_UNAVAILABLE' THEN
    RAISE EXCEPTION 'unapproved retention policy must block account deletion preview';
  END IF;
END;
$$;
RESET ROLE;
DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM public.privacy_consent_events AS consent
    WHERE consent.user_id = '00000000-0000-0000-0000-000000001101'
  ) <> 2
  OR NOT EXISTS (
    SELECT 1
    FROM public.privacy_age_profiles AS age_profile
    WHERE age_profile.user_id = '00000000-0000-0000-0000-000000001101'
      AND age_profile.age_band = 'under_14'
      AND age_profile.status = 'guardian_verified'
  )
  OR NOT EXISTS (
    SELECT 1
    FROM public.privacy_guardian_verifications AS guardian
    WHERE guardian.id = '00000000-0000-0000-0000-000000001132'
      AND guardian.child_user_id = '00000000-0000-0000-0000-000000001101'
      AND guardian.status = 'verified'
  )
  OR NOT EXISTS (
    SELECT 1
    FROM public.privacy_onboarding_challenges AS challenge
    WHERE challenge.id = '00000000-0000-0000-0000-000000001122'
      AND challenge.consumed_by_user_id = '00000000-0000-0000-0000-000000001101'
  ) THEN
    RAISE EXCEPTION 'target fixture must represent a completed privacy onboarding';
  END IF;

  BEGIN
    DELETE FROM public.privacy_consent_events
    WHERE id = '00000000-0000-0000-0000-000000001123';
    RAISE EXCEPTION 'direct consent delete without deletion capability unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;

  BEGIN
    UPDATE public.privacy_audit_events
    SET actor_user_id = NULL
    WHERE id = '00000000-0000-0000-0000-000000001125';
    RAISE EXCEPTION 'direct audit actor minimization without deletion capability unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;

  BEGIN
    DELETE FROM public.privacy_audit_events
    WHERE id = '00000000-0000-0000-0000-000000001125';
    RAISE EXCEPTION 'direct audit delete without deletion capability unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;

  PERFORM pg_catalog.set_config('app.account_deletion_user_id', 'malformed', true);
  BEGIN
    DELETE FROM public.privacy_consent_events
    WHERE id = '00000000-0000-0000-0000-000000001123';
    RAISE EXCEPTION 'malformed deletion capability unexpectedly allowed a consent delete';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;

  PERFORM pg_catalog.set_config(
    'app.account_deletion_user_id',
    '00000000-0000-0000-0000-000000001101',
    true
  );

  BEGIN
    DELETE FROM public.privacy_consent_events
    WHERE id = '00000000-0000-0000-0000-000000001128';
    RAISE EXCEPTION 'deletion capability unexpectedly allowed another user consent delete';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;

  BEGIN
    UPDATE public.privacy_audit_events
    SET actor_user_id = NULL
    WHERE id = '00000000-0000-0000-0000-000000001129';
    RAISE EXCEPTION 'deletion capability unexpectedly allowed another user audit minimization';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;

  BEGIN
    UPDATE public.privacy_audit_events
    SET reason_code = 'MUTATED'
    WHERE id = '00000000-0000-0000-0000-000000001125';
    RAISE EXCEPTION 'deletion capability unexpectedly allowed an arbitrary audit update';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;

  BEGIN
    DELETE FROM public.privacy_audit_events
    WHERE id = '00000000-0000-0000-0000-000000001125';
    RAISE EXCEPTION 'deletion capability unexpectedly allowed an audit delete';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;

  PERFORM pg_catalog.set_config('app.account_deletion_user_id', '', true);
END;
$$;

SELECT pg_catalog.set_config(
  'g010_deletion_test.privacy_audit_snapshot',
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', audit.id,
          'record', pg_catalog.to_jsonb(audit) - 'actor_user_id'
        )
        ORDER BY audit.id
      )::text
      FROM public.privacy_audit_events AS audit
      WHERE audit.actor_user_id = '00000000-0000-0000-0000-000000001101'
    ),
    '[]'
  ),
  true
);

UPDATE privacy_retention.privacy_retention_classes
SET
  data_class = 'privacy_account_deletion_audit',
  basis_code = 'g010.test.account_deletion_audit',
  trigger_type = 'event_occurred',
  retention_period = interval '30 days',
  status = 'active',
  approved_evidence_ref = 'G010-TEST-ACCOUNT-DELETION-AUDIT',
  version = 'g010-test-v1'
WHERE code = 'privacy_account_deletion_audit';

DO $$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM privacy_retention.privacy_retention_classes
    WHERE code = 'privacy_account_deletion_audit'
      AND data_class = 'privacy_account_deletion_audit'
      AND trigger_type = 'event_occurred'
      AND retention_period = interval '30 days'
      AND status = 'active'
      AND approved_evidence_ref = 'G010-TEST-ACCOUNT-DELETION-AUDIT'
      AND version = 'g010-test-v1'
      AND activated_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'account deletion audit class was not fully and exactly activated';
  END IF;

  IF public.privacy_resolve_audit_retention_until(
    'privacy_account_deletion_audit',
    v_now
  ) <> v_now + interval '30 days' THEN
    RAISE EXCEPTION 'account deletion audit retention did not derive from its active class';
  END IF;
END;
$$;

INSERT INTO privacy_retention.privacy_legal_holds (
  subject_ref_hash,
  data_class,
  reason_code,
  approved_by,
  approved_evidence_ref
)
VALUES (
  public.account_deletion_subject_hash('00000000-0000-0000-0000-000000001101'),
  'account_deletion',
  'g010_test_hold',
  '00000000-0000-0000-0000-000000001103',
  'G010-TEST-LEGAL-HOLD'
);

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);

DO $$
DECLARE
  v_preview record;
BEGIN
  SELECT * INTO v_preview
  FROM public.preview_account_deletion(
    '00000000-0000-0000-0000-000000001101',
    '00000000-0000-0000-0000-000000001101',
    pg_catalog.current_setting('g010_deletion_test.reauthenticated_at')::timestamptz
  );
  IF v_preview.request_id IS NOT NULL
     OR v_preview.status <> 'failed'
     OR v_preview.reason_code <> 'LEGAL_HOLD_ACTIVE' THEN
    RAISE EXCEPTION 'active legal hold must block account deletion preview';
  END IF;
END;
$$;
RESET ROLE;

UPDATE privacy_retention.privacy_legal_holds
SET status = 'released', released_at = pg_catalog.clock_timestamp()
WHERE subject_ref_hash = public.account_deletion_subject_hash(
  '00000000-0000-0000-0000-000000001101'
)
  AND data_class = 'account_deletion';

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);

DO $$
DECLARE
  v_preview record;
BEGIN
  SELECT * INTO v_preview
  FROM public.preview_account_deletion(
    '00000000-0000-0000-0000-000000001101',
    '00000000-0000-0000-0000-000000001101',
    pg_catalog.current_setting('g010_deletion_test.reauthenticated_at')::timestamptz - interval '1 minute'
  );
  IF v_preview.request_id IS NOT NULL
     OR v_preview.status <> 'failed'
     OR v_preview.reason_code <> 'REAUTH_REQUIRED' THEN
    RAISE EXCEPTION 'preview must require a recent matching reauthentication';
  END IF;

  SELECT * INTO v_preview
  FROM public.preview_account_deletion(
    '00000000-0000-0000-0000-000000001101',
    '00000000-0000-0000-0000-000000001101',
    pg_catalog.current_setting('g010_deletion_test.reauthenticated_at')::timestamptz
  );
  IF v_preview.request_id IS NULL
     OR v_preview.status <> 'previewed'
     OR v_preview.reason_code <> 'PREVIEW_READY'
     OR v_preview.policy_version <> 'g010-account-deletion-v1'
     OR v_preview.preview_hash !~ '^[0-9a-f]{64}$'
     OR v_preview.preview_expires_at <= pg_catalog.clock_timestamp()
     OR v_preview.delete_count <> 15
     OR v_preview.anonymize_count <> 2
     OR v_preview.separate_count <> 0
     OR v_preview.retain_count <> 0 THEN
    RAISE EXCEPTION 'self deletion preview did not return the exact policy-bound itemized result';
  END IF;

  PERFORM pg_catalog.set_config('g010_deletion_test.request_id', v_preview.request_id::text, true);
  PERFORM pg_catalog.set_config('g010_deletion_test.preview_hash', v_preview.preview_hash, true);
  PERFORM pg_catalog.set_config('g010_deletion_test.preview_expires_at', v_preview.preview_expires_at::text, true);
  PERFORM pg_catalog.set_config('g010_deletion_test.idempotency_key', 'g010-delete-apply-0001', true);
END;
$$;
RESET ROLE;

DO $$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
  v_items jsonb;
  v_expected_items jsonb := jsonb_build_object(
    'profile_identity', jsonb_build_object('disposition', 'anonymize', 'mandatory', true, 'plannedCount', 1),
    'user_statistics', jsonb_build_object('disposition', 'delete', 'mandatory', true, 'plannedCount', 0),
    'user_bookmarks', jsonb_build_object('disposition', 'delete', 'mandatory', true, 'plannedCount', 0),
    'notifications', jsonb_build_object('disposition', 'delete', 'mandatory', true, 'plannedCount', 1),
    'user_preferences', jsonb_build_object('disposition', 'delete', 'mandatory', true, 'plannedCount', 0),
    'storyboard_documents', jsonb_build_object('disposition', 'delete', 'mandatory', true, 'plannedCount', 0),
    'submission_drafts', jsonb_build_object('disposition', 'delete', 'mandatory', true, 'plannedCount', 0),
    'review_likes', jsonb_build_object('disposition', 'delete', 'mandatory', true, 'plannedCount', 3),
    'reviews', jsonb_build_object('disposition', 'delete', 'mandatory', true, 'plannedCount', 1),
    'restaurant_submissions', jsonb_build_object('disposition', 'delete', 'mandatory', true, 'plannedCount', 1),
    'restaurant_requests', jsonb_build_object('disposition', 'delete', 'mandatory', true, 'plannedCount', 1),
    'ocr_logs', jsonb_build_object('disposition', 'delete', 'mandatory', true, 'plannedCount', 1),
    'marketing_campaign_recipients', jsonb_build_object('disposition', 'delete', 'mandatory', true, 'plannedCount', 1),
    'privacy_identity_records', jsonb_build_object('disposition', 'delete', 'mandatory', true, 'plannedCount', 5),
    'privacy_audit_actor_references', jsonb_build_object('disposition', 'anonymize', 'mandatory', true, 'plannedCount', 1),
    'storage_objects', jsonb_build_object('disposition', 'delete', 'mandatory', true, 'plannedCount', 0),
    'auth_identity', jsonb_build_object('disposition', 'delete', 'mandatory', true, 'plannedCount', 1),
    'approved_audit_records', jsonb_build_object('disposition', 'retain', 'mandatory', false, 'plannedCount', 0),
    'retention_work_items', jsonb_build_object('disposition', 'separate', 'mandatory', false, 'plannedCount', 0)
  );
BEGIN
  SELECT * INTO v_request
  FROM public.account_deletion_requests
  WHERE id = pg_catalog.current_setting('g010_deletion_test.request_id')::uuid;

  IF NOT FOUND
     OR v_request.actor_user_id <> '00000000-0000-0000-0000-000000001101'
     OR v_request.target_user_id <> '00000000-0000-0000-0000-000000001101'
     OR v_request.policy_version <> 'g010-account-deletion-v1'
     OR v_request.status <> 'previewed'
     OR v_request.reason_code <> 'PREVIEW_READY'
     OR v_request.preview_hash <> pg_catalog.current_setting('g010_deletion_test.preview_hash')
     OR v_request.preview_expires_at <> pg_catalog.current_setting('g010_deletion_test.preview_expires_at')::timestamptz
     OR v_request.preview_expires_at <= v_request.created_at
     OR v_request.preview_expires_at > v_request.created_at + interval '10 minutes'
     OR v_request.count_summary <> '{"requested":17}'::jsonb THEN
    RAISE EXCEPTION 'preview request did not preserve the exact hash, expiry, policy, and count summary';
  END IF;

  SELECT jsonb_object_agg(
    item.data_class_code,
    jsonb_build_object(
      'disposition', item.disposition,
      'mandatory', item.mandatory,
      'plannedCount', item.planned_count
    )
  )
  INTO v_items
  FROM public.account_deletion_request_items AS item
  WHERE item.request_id = v_request.id;

  IF v_items IS DISTINCT FROM v_expected_items THEN
    RAISE EXCEPTION 'preview itemization did not match the exact deletion data-class counts: %', v_items;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.privacy_audit_events AS audit
    WHERE audit.event_type = 'account_deletion'
      AND audit.operation_id = v_request.id
      AND audit.correlation_id = v_request.id
      AND audit.status = 'previewed'
      AND audit.reason_code = 'PREVIEW_READY'
      AND audit.subject_ref_hash = public.account_deletion_subject_hash(v_request.target_user_id)
      AND audit.count_summary = '{"requested":17,"updated":2,"suppressed":0,"failed":0}'::jsonb
      AND audit.request_metadata = '{"route":"/api/account/delete"}'::jsonb
      AND audit.retention_until = audit.occurred_at + interval '30 days'
  ) THEN
    RAISE EXCEPTION 'preview audit did not use the approved account deletion retention class';
  END IF;
END;
$$;

INSERT INTO public.account_deletion_policies (
  version,
  status,
  preview_ttl,
  reauth_max_age,
  confirmation_text
)
VALUES (
  'g010-account-deletion-test-v2',
  'disabled',
  interval '10 minutes',
  interval '5 minutes',
  '계정 삭제'
);

UPDATE public.account_deletion_policies
SET status = 'disabled'
WHERE version = 'g010-account-deletion-v1';
UPDATE public.account_deletion_policies
SET status = 'active'
WHERE version = 'g010-account-deletion-test-v2';

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);

DO $$
DECLARE
  v_apply record;
BEGIN
  SELECT * INTO v_apply
  FROM public.begin_account_deletion_apply(
    '00000000-0000-0000-0000-000000001101',
    '00000000-0000-0000-0000-000000001101',
    pg_catalog.current_setting('g010_deletion_test.request_id')::uuid,
    pg_catalog.current_setting('g010_deletion_test.preview_hash'),
    '계정 삭제',
    pg_catalog.current_setting('g010_deletion_test.idempotency_key'),
    pg_catalog.current_setting('g010_deletion_test.reauthenticated_at')::timestamptz
  );
  IF v_apply.status <> 'failed' OR v_apply.reason_code <> 'POLICY_CHANGED' THEN
    RAISE EXCEPTION 'preview must be bound to its active policy version';
  END IF;
END;
$$;
RESET ROLE;

UPDATE public.account_deletion_policies
SET status = 'disabled'
WHERE version = 'g010-account-deletion-test-v2';
UPDATE public.account_deletion_policies
SET status = 'active'
WHERE version = 'g010-account-deletion-v1';

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);

DO $$
DECLARE
  v_apply record;
BEGIN
  SELECT * INTO v_apply
  FROM public.begin_account_deletion_apply(
    '00000000-0000-0000-0000-000000001101',
    '00000000-0000-0000-0000-000000001101',
    pg_catalog.current_setting('g010_deletion_test.request_id')::uuid,
    pg_catalog.current_setting('g010_deletion_test.preview_hash'),
    '계정 삭제',
    pg_catalog.current_setting('g010_deletion_test.idempotency_key'),
    pg_catalog.current_setting('g010_deletion_test.reauthenticated_at')::timestamptz - interval '1 minute'
  );
  IF v_apply.status <> 'failed' OR v_apply.reason_code <> 'REAUTH_REQUIRED' THEN
    RAISE EXCEPTION 'apply must require a recent matching reauthentication';
  END IF;

  SELECT * INTO v_apply
  FROM public.begin_account_deletion_apply(
    '00000000-0000-0000-0000-000000001101',
    '00000000-0000-0000-0000-000000001101',
    pg_catalog.current_setting('g010_deletion_test.request_id')::uuid,
    pg_catalog.current_setting('g010_deletion_test.preview_hash'),
    '계정 삭제 아님',
    pg_catalog.current_setting('g010_deletion_test.idempotency_key'),
    pg_catalog.current_setting('g010_deletion_test.reauthenticated_at')::timestamptz
  );
  IF v_apply.status <> 'failed' OR v_apply.reason_code <> 'CONFIRMATION_REQUIRED' THEN
    RAISE EXCEPTION 'apply must require the exact Korean confirmation text';
  END IF;

  SELECT * INTO v_apply
  FROM public.begin_account_deletion_apply(
    '00000000-0000-0000-0000-000000001101',
    '00000000-0000-0000-0000-000000001101',
    pg_catalog.current_setting('g010_deletion_test.request_id')::uuid,
    repeat('0', 64),
    '계정 삭제',
    pg_catalog.current_setting('g010_deletion_test.idempotency_key'),
    pg_catalog.current_setting('g010_deletion_test.reauthenticated_at')::timestamptz
  );
  IF v_apply.status <> 'failed' OR v_apply.reason_code <> 'PREVIEW_EXPIRED' THEN
    RAISE EXCEPTION 'apply must reject a mismatched preview hash';
  END IF;

  SELECT * INTO v_apply
  FROM public.begin_account_deletion_apply(
    '00000000-0000-0000-0000-000000001102',
    '00000000-0000-0000-0000-000000001101',
    pg_catalog.current_setting('g010_deletion_test.request_id')::uuid,
    pg_catalog.current_setting('g010_deletion_test.preview_hash'),
    '계정 삭제',
    pg_catalog.current_setting('g010_deletion_test.idempotency_key'),
    pg_catalog.current_setting('g010_deletion_test.reauthenticated_at')::timestamptz
  );
  IF v_apply.status <> 'failed' OR v_apply.reason_code <> 'PREVIEW_NOT_FOUND' THEN
    RAISE EXCEPTION 'apply must fail closed when the actor does not match the preview';
  END IF;

  SELECT * INTO v_apply
  FROM public.begin_account_deletion_apply(
    '00000000-0000-0000-0000-000000001101',
    '00000000-0000-0000-0000-000000001101',
    pg_catalog.current_setting('g010_deletion_test.request_id')::uuid,
    pg_catalog.current_setting('g010_deletion_test.preview_hash'),
    '계정 삭제',
    pg_catalog.current_setting('g010_deletion_test.idempotency_key'),
    pg_catalog.current_setting('g010_deletion_test.reauthenticated_at')::timestamptz
  );
  IF v_apply.request_id <> pg_catalog.current_setting('g010_deletion_test.request_id')::uuid
     OR v_apply.status <> 'applying'
     OR v_apply.reason_code <> 'APPLY_STARTED'
     OR v_apply.delete_count <> 15
     OR v_apply.anonymize_count <> 2
     OR v_apply.separate_count <> 0
     OR v_apply.retain_count <> 0
     OR v_apply.db_readback_passed
     OR v_apply.storage_readback_passed
     OR v_apply.session_readback_passed
     OR v_apply.auth_readback_passed THEN
    RAISE EXCEPTION 'valid apply did not preserve the preview-bound exact counts and initial readback state';
  END IF;

  SELECT * INTO v_apply
  FROM public.begin_account_deletion_apply(
    '00000000-0000-0000-0000-000000001101',
    '00000000-0000-0000-0000-000000001101',
    pg_catalog.current_setting('g010_deletion_test.request_id')::uuid,
    pg_catalog.current_setting('g010_deletion_test.preview_hash'),
    '계정 삭제',
    'g010-delete-apply-0002',
    pg_catalog.current_setting('g010_deletion_test.reauthenticated_at')::timestamptz
  );
  IF v_apply.status <> 'failed' OR v_apply.reason_code <> 'IDEMPOTENCY_KEY_MISMATCH' THEN
    RAISE EXCEPTION 'applying preview must reject a different idempotency key';
  END IF;
END;
$$;
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);

DO $$
DECLARE
  v_cleanup record;
BEGIN
  SELECT * INTO v_cleanup
  FROM public.apply_account_deletion_database_cleanup(
    '00000000-0000-0000-0000-000000001101',
    pg_catalog.current_setting('g010_deletion_test.request_id')::uuid
  );
  IF v_cleanup.request_id <> pg_catalog.current_setting('g010_deletion_test.request_id')::uuid
     OR v_cleanup.status <> 'applying'
     OR v_cleanup.reason_code <> 'DB_AND_SESSION_READBACK_PASSED'
     OR NOT v_cleanup.db_readback_passed
     OR NOT v_cleanup.session_readback_passed THEN
    RAISE EXCEPTION 'database and session cleanup did not produce its required readback';
  END IF;
END;
$$;
RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE id = '00000000-0000-0000-0000-000000001101'
  ) THEN
    RAISE EXCEPTION 'database cleanup must not delete the Auth identity before Auth-last finalization';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM auth.sessions
    WHERE user_id = '00000000-0000-0000-0000-000000001101'
  ) THEN
    RAISE EXCEPTION 'session cleanup failed independent readback';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE user_id = '00000000-0000-0000-0000-000000001101'
      AND nickname = '탈퇴한 사용자'
      AND username IS NULL
      AND avatar_url IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.notifications
    WHERE user_id = '00000000-0000-0000-0000-000000001101'
  ) THEN
    RAISE EXCEPTION 'database cleanup did not independently read back profile anonymization and notification deletion';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.review_likes
    WHERE user_id = '00000000-0000-0000-0000-000000001101'
       OR review_id = '00000000-0000-0000-0000-000000001111'
  ) OR EXISTS (
    SELECT 1
    FROM public.reviews
    WHERE user_id = '00000000-0000-0000-0000-000000001101'
  ) OR EXISTS (
    SELECT 1
    FROM public.restaurant_submissions
    WHERE user_id = '00000000-0000-0000-0000-000000001101'
  ) OR EXISTS (
    SELECT 1
    FROM public.restaurant_requests
    WHERE user_id = '00000000-0000-0000-0000-000000001101'
  ) OR EXISTS (
    SELECT 1
    FROM public.ocr_logs
    WHERE user_id = '00000000-0000-0000-0000-000000001101'
  ) OR EXISTS (
    SELECT 1
    FROM public.marketing_campaign_recipients
    WHERE user_id = '00000000-0000-0000-0000-000000001101'
  ) THEN
    RAISE EXCEPTION 'database cleanup did not independently read back zero target rows for every mandatory account residue class';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.privacy_consent_events AS consent
    WHERE consent.user_id = '00000000-0000-0000-0000-000000001101'
  ) OR EXISTS (
    SELECT 1
    FROM public.privacy_age_profiles AS age_profile
    WHERE age_profile.user_id = '00000000-0000-0000-0000-000000001101'
  ) OR EXISTS (
    SELECT 1
    FROM public.privacy_guardian_verifications AS guardian
    WHERE guardian.child_user_id = '00000000-0000-0000-0000-000000001101'
  ) OR EXISTS (
    SELECT 1
    FROM public.privacy_onboarding_challenges AS challenge
    WHERE challenge.consumed_by_user_id = '00000000-0000-0000-0000-000000001101'
  ) OR EXISTS (
    SELECT 1
    FROM public.privacy_audit_events AS audit
    WHERE audit.actor_user_id = '00000000-0000-0000-0000-000000001101'
  ) THEN
    RAISE EXCEPTION 'database cleanup did not remove target privacy identity rows and audit actor references';
  END IF;

  IF (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', audit.id,
          'record', pg_catalog.to_jsonb(audit) - 'actor_user_id'
        )
        ORDER BY audit.id
      ),
      '[]'::jsonb
    )
    FROM public.privacy_audit_events AS audit
    WHERE audit.id IN (
      SELECT (snapshot_entry.snapshot ->> 'id')::uuid
      FROM jsonb_array_elements(
        pg_catalog.current_setting('g010_deletion_test.privacy_audit_snapshot')::jsonb
      ) AS snapshot_entry(snapshot)
    )
  ) IS DISTINCT FROM pg_catalog.current_setting(
    'g010_deletion_test.privacy_audit_snapshot'
  )::jsonb THEN
    RAISE EXCEPTION 'audit actor minimization did not preserve the original audit records and hashes';
  END IF;

  IF COALESCE(
    pg_catalog.current_setting('app.account_deletion_user_id', true),
    ''
  ) <> '' THEN
    RAISE EXCEPTION 'database cleanup left the account deletion capability set';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.review_likes
    WHERE review_id = '00000000-0000-0000-0000-000000001112'
      AND user_id = '00000000-0000-0000-0000-000000001102'
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.reviews
    WHERE id = '00000000-0000-0000-0000-000000001112'
      AND user_id = '00000000-0000-0000-0000-000000001102'
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.restaurant_submissions
    WHERE id = '00000000-0000-0000-0000-000000001114'
      AND user_id = '00000000-0000-0000-0000-000000001102'
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.restaurant_requests
    WHERE id = '00000000-0000-0000-0000-000000001116'
      AND user_id = '00000000-0000-0000-0000-000000001102'
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.ocr_logs
    WHERE id = '00000000-0000-0000-0000-000000001118'
      AND user_id = '00000000-0000-0000-0000-000000001102'
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.marketing_campaign_recipients
    WHERE operation_id = '00000000-0000-0000-0000-000000001120'
      AND user_id = '00000000-0000-0000-0000-000000001102'
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.privacy_consent_events AS consent
    WHERE consent.id = '00000000-0000-0000-0000-000000001128'
      AND consent.user_id = '00000000-0000-0000-0000-000000001102'
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.privacy_audit_events AS audit
    WHERE audit.id = '00000000-0000-0000-0000-000000001129'
      AND audit.actor_user_id = '00000000-0000-0000-0000-000000001102'
  ) THEN
    RAISE EXCEPTION 'database cleanup did not preserve unrelated account and privacy rows';
  END IF;
END;
$$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);

DO $$
DECLARE
  v_storage record;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.list_account_deletion_storage_objects(
      '00000000-0000-0000-0000-000000001101',
      pg_catalog.current_setting('g010_deletion_test.request_id')::uuid
    )
  ) THEN
    RAISE EXCEPTION 'storage readback test must remain provider-free and have no storage fixture';
  END IF;

  SELECT * INTO v_storage
  FROM public.finalize_account_deletion_storage(
    '00000000-0000-0000-0000-000000001101',
    pg_catalog.current_setting('g010_deletion_test.request_id')::uuid,
    true
  );
  IF v_storage.status <> 'applying'
     OR v_storage.reason_code <> 'STORAGE_READBACK_PASSED'
     OR NOT v_storage.db_readback_passed
     OR NOT v_storage.storage_readback_passed
     OR NOT v_storage.session_readback_passed THEN
    RAISE EXCEPTION 'independent storage readback was not recorded after database/session cleanup';
  END IF;
END;
$$;
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);

DO $$
DECLARE
  v_auth record;
BEGIN
  SELECT * INTO v_auth
  FROM public.finalize_account_deletion_auth(
    '00000000-0000-0000-0000-000000001101',
    pg_catalog.current_setting('g010_deletion_test.request_id')::uuid,
    true
  );
  IF v_auth.status <> 'applied'
     OR v_auth.reason_code <> 'APPLIED'
     OR v_auth.delete_count <> 15
     OR v_auth.anonymize_count <> 2
     OR v_auth.separate_count <> 0
     OR v_auth.retain_count <> 0
     OR NOT v_auth.db_readback_passed
     OR NOT v_auth.storage_readback_passed
     OR NOT v_auth.session_readback_passed
     OR NOT v_auth.auth_readback_passed THEN
    RAISE EXCEPTION 'Auth-last final receipt did not require all ordered readbacks';
  END IF;
END;
$$;
RESET ROLE;

DO $$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
  v_audit_count integer;
BEGIN
  SELECT * INTO v_request
  FROM public.account_deletion_requests
  WHERE id = pg_catalog.current_setting('g010_deletion_test.request_id')::uuid;

  IF NOT FOUND
     OR v_request.status <> 'applied'
     OR v_request.reason_code <> 'APPLIED'
     OR v_request.applied_at IS NULL
     OR NOT v_request.db_readback_passed
     OR NOT v_request.storage_readback_passed
     OR NOT v_request.session_readback_passed
     OR NOT v_request.auth_readback_passed THEN
    RAISE EXCEPTION 'final account deletion receipt did not retain all ordered readback evidence';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE id = '00000000-0000-0000-0000-000000001101'
  ) THEN
    RAISE EXCEPTION 'the SQL receipt function must not itself delete the Auth identity';
  END IF;

  SELECT count(*) INTO v_audit_count
  FROM public.privacy_audit_events AS audit
  WHERE audit.event_type = 'account_deletion'
    AND audit.operation_id = v_request.id
    AND audit.correlation_id = v_request.id;

  IF v_audit_count <> 4
     OR EXISTS (
       SELECT 1
       FROM public.privacy_audit_events AS audit
       WHERE audit.event_type = 'account_deletion'
         AND audit.operation_id = v_request.id
         AND (
           audit.actor_user_id IS NOT NULL
           OR audit.subject_ref_hash <> public.account_deletion_subject_hash(v_request.target_user_id)
           OR audit.count_summary <> '{"requested":17,"updated":2,"suppressed":0,"failed":0}'::jsonb
           OR audit.request_metadata <> '{"route":"/api/account/delete"}'::jsonb
           OR audit.retention_until <> audit.occurred_at + interval '30 days'
           OR NOT public.account_deletion_reason_code_is_safe(audit.reason_code)
           OR audit.count_summary::text ~* '(email|token|rrn|location|snapshot)'
           OR audit.request_metadata::text ~* '(email|token|rrn|location|snapshot)'
           OR audit.request_metadata::text ~ '_'
         )
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.privacy_audit_events AS audit
       WHERE audit.event_type = 'account_deletion'
         AND audit.operation_id = v_request.id
         AND audit.status = 'previewed'
         AND audit.reason_code = 'PREVIEW_READY'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.privacy_audit_events AS audit
       WHERE audit.event_type = 'account_deletion'
         AND audit.operation_id = v_request.id
         AND audit.status = 'readback_passed'
         AND audit.reason_code = 'DB_AND_SESSION_READBACK_PASSED'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.privacy_audit_events AS audit
       WHERE audit.event_type = 'account_deletion'
         AND audit.operation_id = v_request.id
         AND audit.status = 'readback_passed'
         AND audit.reason_code = 'STORAGE_READBACK_PASSED'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.privacy_audit_events AS audit
       WHERE audit.event_type = 'account_deletion'
         AND audit.operation_id = v_request.id
         AND audit.status = 'applied'
         AND audit.reason_code = 'APPLIED'
     ) THEN
    RAISE EXCEPTION 'account deletion audit must be fixed-code, count-only, camelCase-safe, and retention-bound';
  END IF;
END;
$$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);

DO $$
DECLARE
  v_replay record;
BEGIN
  SELECT * INTO v_replay
  FROM public.begin_account_deletion_apply(
    '00000000-0000-0000-0000-000000001101',
    '00000000-0000-0000-0000-000000001101',
    pg_catalog.current_setting('g010_deletion_test.request_id')::uuid,
    pg_catalog.current_setting('g010_deletion_test.preview_hash'),
    '계정 삭제',
    pg_catalog.current_setting('g010_deletion_test.idempotency_key'),
    pg_catalog.current_setting('g010_deletion_test.reauthenticated_at')::timestamptz
  );
  IF v_replay.status <> 'applied'
     OR v_replay.reason_code <> 'APPLIED'
     OR v_replay.delete_count <> 15
     OR v_replay.anonymize_count <> 2
     OR v_replay.separate_count <> 0
     OR v_replay.retain_count <> 0
     OR NOT v_replay.db_readback_passed
     OR NOT v_replay.storage_readback_passed
     OR NOT v_replay.session_readback_passed
     OR NOT v_replay.auth_readback_passed THEN
    RAISE EXCEPTION 'same idempotency key must replay the completed receipt exactly';
  END IF;

  SELECT * INTO v_replay
  FROM public.begin_account_deletion_apply(
    '00000000-0000-0000-0000-000000001101',
    '00000000-0000-0000-0000-000000001101',
    pg_catalog.current_setting('g010_deletion_test.request_id')::uuid,
    pg_catalog.current_setting('g010_deletion_test.preview_hash'),
    '계정 삭제',
    'g010-delete-apply-0002',
    pg_catalog.current_setting('g010_deletion_test.reauthenticated_at')::timestamptz
  );
  IF v_replay.status <> 'failed' OR v_replay.reason_code <> 'REPLAYED_PREVIEW' THEN
    RAISE EXCEPTION 'completed preview must reject a replay with a different idempotency key';
  END IF;
END;
$$;
RESET ROLE;

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM public.privacy_audit_events AS audit
    WHERE audit.event_type = 'account_deletion'
      AND audit.operation_id = pg_catalog.current_setting('g010_deletion_test.request_id')::uuid
  ) <> 4 THEN
    RAISE EXCEPTION 'idempotent replays must not append duplicate account deletion audit rows';
  END IF;
END;
$$;
DELETE FROM auth.users
WHERE id = '00000000-0000-0000-0000-000000001101';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM auth.users
    WHERE id = '00000000-0000-0000-0000-000000001101'
  ) THEN
    RAISE EXCEPTION 'completed privacy cleanup still blocked Auth identity deletion';
  END IF;
END;
$$;

ROLLBACK;
