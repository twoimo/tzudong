BEGIN;

INSERT INTO auth.users(id,aud,role,email,raw_user_meta_data,created_at,updated_at)
VALUES
  ('10000000-0000-4000-8000-000000000001','authenticated','authenticated','actor@fixture.invalid','{"nickname":"Actor"}',now(),now()),
  ('10000000-0000-4000-8000-000000000002','authenticated','authenticated','other@fixture.invalid','{"nickname":"Other"}',now(),now());
UPDATE public.profiles
SET username=CASE user_id
      WHEN '10000000-0000-4000-8000-000000000001' THEN 'fixture_actor'
      ELSE 'fixture_other'
    END,
    nickname=CASE user_id
      WHEN '10000000-0000-4000-8000-000000000001' THEN 'Actor'
      ELSE 'Other'
    END,
    role=CASE user_id
      WHEN '10000000-0000-4000-8000-000000000001' THEN 'admin'
      ELSE 'user'
    END
WHERE user_id IN (
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002'
);
UPDATE public.user_roles
SET role='admin'
WHERE user_id='10000000-0000-4000-8000-000000000001'
  AND role='user';
INSERT INTO public.user_account_status(user_id,account_status,disabled_at)
VALUES
  ('10000000-0000-4000-8000-000000000001','active',NULL),
  ('10000000-0000-4000-8000-000000000002','active',NULL)
ON CONFLICT (user_id) DO UPDATE
SET account_status=EXCLUDED.account_status,
    disabled_at=EXCLUDED.disabled_at;

SET LOCAL ROLE service_role;

DO $invalid_metadata$
DECLARE
  invalid_count integer := 0;
BEGIN
  BEGIN
    PERFORM public.read_admin_user_management_metadata(NULL::uuid[]);
    RAISE EXCEPTION 'FIXTURE_EXPECTED_METADATA_NULL_DENIAL';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'admin_user_metadata_request_invalid' THEN RAISE; END IF;
    invalid_count := invalid_count + 1;
  END;
  BEGIN
    PERFORM public.read_admin_user_management_metadata(
      ARRAY['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001']::uuid[]
    );
    RAISE EXCEPTION 'FIXTURE_EXPECTED_METADATA_DUPLICATE_DENIAL';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'admin_user_metadata_request_invalid' THEN RAISE; END IF;
    invalid_count := invalid_count + 1;
  END;
  BEGIN
    PERFORM public.read_admin_user_management_metadata(
      ARRAY(SELECT pg_catalog.md5(value::text)::uuid FROM pg_catalog.generate_series(1,201) value)
    );
    RAISE EXCEPTION 'FIXTURE_EXPECTED_METADATA_BOUND_DENIAL';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'admin_user_metadata_request_invalid' THEN RAISE; END IF;
    invalid_count := invalid_count + 1;
  END;
  IF invalid_count <> 3 THEN RAISE EXCEPTION 'FIXTURE_METADATA_DENIAL_COUNT'; END IF;
END
$invalid_metadata$;

DO $invalid_append$
DECLARE
  invalid_count integer := 0;
BEGIN
  BEGIN
    PERFORM public.append_admin_user_audit_event(
      NULL,'10000000-0000-4000-8000-000000000002','admin_user_profile_updated',
      'ADMIN_USER_PROFILE_UPDATE_INTENT','intent',NULL,'{}'::jsonb,'{}'::jsonb,NULL,NULL,
      '10000000-0000-4000-8000-000000000010',NULL,NULL
    );
    RAISE EXCEPTION 'FIXTURE_EXPECTED_APPEND_ACTOR_DENIAL';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'admin_user_audit_event_invalid' THEN RAISE; END IF;
    invalid_count := invalid_count + 1;
  END;
  BEGIN
    PERFORM public.append_admin_user_audit_event(
      '10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',
      'admin_user_profile_updated','ADMIN_USER_PROFILE_UPDATE_INTENT','intent',NULL,
      '{}'::jsonb,'{}'::jsonb,NULL,NULL,NULL,NULL,NULL
    );
    RAISE EXCEPTION 'FIXTURE_EXPECTED_APPEND_REQUEST_DENIAL';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'admin_user_audit_event_invalid' THEN RAISE; END IF;
    invalid_count := invalid_count + 1;
  END;
  BEGIN
    PERFORM public.append_admin_user_audit_event(
      '10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',
      'admin_user_profile_updated','ADMIN_USER_PROFILE_UPDATE_INTENT','intent',NULL,
      '{}'::jsonb,'{}'::jsonb,NULL,NULL,'10000000-0000-4000-8000-000000000010',NULL,NULL
    );
    RAISE EXCEPTION 'FIXTURE_EXPECTED_APPEND_NONADMIN_DENIAL';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'admin_user_audit_event_invalid' THEN RAISE; END IF;
    invalid_count := invalid_count + 1;
  END;
  IF invalid_count <> 3 THEN
    RAISE EXCEPTION 'FIXTURE_APPEND_DENIAL_STATE';
  END IF;
END
$invalid_append$;

RESET ROLE;
DO $invalid_append_state$
BEGIN
  IF (SELECT count(*) FROM public.admin_audit_events) <> 0 THEN
    RAISE EXCEPTION 'FIXTURE_APPEND_DENIAL_STATE';
  END IF;
END
$invalid_append_state$;
SET LOCAL ROLE service_role;

SELECT public.append_admin_user_audit_event(
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  'admin_user_profile_updated',
  'ADMIN_USER_PROFILE_UPDATE_INTENT',
  'intent',
  NULL,
  '{}'::jsonb,
  '{}'::jsonb,
  NULL,
  NULL,
  '10000000-0000-4000-8000-000000000010',
  NULL,
  NULL
) FROM pg_catalog.generate_series(1,52);

DO $invalid_limit$
DECLARE
  invalid_count integer := 0;
BEGIN
  BEGIN
    PERFORM public.read_admin_user_audit_events(0);
    RAISE EXCEPTION 'FIXTURE_EXPECTED_AUDIT_ZERO_DENIAL';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'admin_user_audit_limit_invalid' THEN RAISE; END IF;
    invalid_count := invalid_count + 1;
  END;
  BEGIN
    PERFORM public.read_admin_user_audit_events(51);
    RAISE EXCEPTION 'FIXTURE_EXPECTED_AUDIT_BOUND_DENIAL';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'admin_user_audit_limit_invalid' THEN RAISE; END IF;
    invalid_count := invalid_count + 1;
  END;
  IF invalid_count <> 2 THEN RAISE EXCEPTION 'FIXTURE_AUDIT_DENIAL_COUNT'; END IF;
END
$invalid_limit$;

SELECT jsonb_build_object(
  'metadata',(
    SELECT jsonb_build_object(
      'rowCount',count(*),
      'ordered',array_agg(user_id)=ARRAY[
        '10000000-0000-4000-8000-000000000002',
        '10000000-0000-4000-8000-000000000003',
        '10000000-0000-4000-8000-000000000001'
      ]::uuid[],
      'missingProfileNull',count(*) FILTER (WHERE user_id='10000000-0000-4000-8000-000000000003' AND nickname IS NULL)=1,
      'adminProjection',count(*) FILTER (WHERE user_id='10000000-0000-4000-8000-000000000001' AND is_admin)=1,
      'bound200',(SELECT count(*) FROM public.read_admin_user_management_metadata(
        ARRAY(SELECT pg_catalog.md5(value::text)::uuid FROM pg_catalog.generate_series(1,200) value)
      ))
    )
    FROM public.read_admin_user_management_metadata(ARRAY[
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000001'
    ]::uuid[])
  ),
  'audit',(
    SELECT jsonb_build_object(
      'storedCount',52,
      'returnedCount',count(*),
      'ordered',array_agg(id ORDER BY ordinal)=array_agg(id ORDER BY created_at DESC,id DESC),
      'minimizedProjection',bool_and(
        (SELECT count(*) FROM pg_catalog.jsonb_object_keys(to_jsonb(audit_rows)-'ordinal'))=12
        AND (to_jsonb(audit_rows)-'ordinal') ?& ARRAY[
          'id','actor_user_id','target_user_id','action','reason','status','correlation_id',
          'applied_at','error_code','created_at','audit_counts','audit_flags'
        ]
      )
    )
    FROM public.read_admin_user_audit_events(50) WITH ORDINALITY audit_rows(
      id,actor_user_id,target_user_id,action,reason,status,correlation_id,applied_at,
      error_code,created_at,audit_counts,audit_flags,ordinal
    )
  ),
  'invalidMetadataDenied',3,
  'invalidAuditLimitsDenied',2,
  'invalidAppendDenied',3,
  'positiveAppendCount',52,
  'transactionRollbackPending',true
)::text AS state;

ROLLBACK;
