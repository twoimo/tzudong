\set ON_ERROR_STOP on

BEGIN;

CREATE FUNCTION public.local_profile_mutation_downstream_conflict_fixture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fixture$
BEGIN
  IF NEW.id = '51000000-0000-4000-8000-000000000005'::uuid THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin');
  END IF;
  RETURN NEW;
END
$fixture$;

CREATE TRIGGER aaa_profile_mutation_downstream_conflict_fixture
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.local_profile_mutation_downstream_conflict_fixture();

DO $signup_trigger_contract$
DECLARE
  v_user_id constant uuid := '51000000-0000-4000-8000-000000000001';
  v_generated_user_id constant uuid := '51000000-0000-4000-8000-000000000002';
  v_failed_user_id constant uuid := '51000000-0000-4000-8000-000000000003';
  v_duplicate_user_id constant uuid := '51000000-0000-4000-8000-000000000004';
  v_downstream_user_id constant uuid := '51000000-0000-4000-8000-000000000005';
  v_nonstring_user_id constant uuid := '51000000-0000-4000-8000-000000000006';
  v_constraint_name text;
BEGIN
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    v_user_id,
    'authenticated', 'authenticated',
    'profile-mutation-one@local.invalid', 'disabled',
    '{}'::jsonb, '{"nickname":"뮤테이션초기"}'::jsonb,
    pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
  );

  IF (SELECT pg_catalog.count(*) FROM public.profiles
      WHERE user_id = v_user_id AND nickname = '뮤테이션초기') <> 1
     OR (SELECT pg_catalog.count(*) FROM public.user_roles
         WHERE user_id = v_user_id AND role::text = 'user') <> 1
     OR (SELECT pg_catalog.count(*) FROM public.user_stats
         WHERE user_id = v_user_id) <> 1
     OR (SELECT pg_catalog.count(*) FROM public.user_account_status
         WHERE user_id = v_user_id
           AND account_status = 'active'
           AND disabled_at IS NULL) <> 1 THEN
    RAISE EXCEPTION 'local_profile_mutation_signup_state_incomplete';
  END IF;

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    v_generated_user_id,
    'authenticated', 'authenticated',
    'profile-mutation-generated@local.invalid', 'disabled',
    '{}'::jsonb, '{}'::jsonb,
    pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
  );

  IF NOT EXISTS (
    SELECT 1
      FROM public.profiles AS profile
     WHERE profile.user_id = v_generated_user_id
       AND profile.nickname = pg_catalog.btrim(profile.nickname)
       AND pg_catalog.char_length(profile.nickname) BETWEEN 2 AND 20
       AND pg_catalog.octet_length(profile.nickname) <= 80
       AND profile.nickname !~ '[[:cntrl:]]'
       AND profile.nickname <> '탈퇴한 사용자'
  ) THEN
    RAISE EXCEPTION 'local_profile_mutation_generated_nickname_invalid';
  END IF;

  BEGIN
    INSERT INTO auth.users (
      id, aud, role, email, encrypted_password,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
      v_failed_user_id,
      'authenticated', 'authenticated',
      'profile-mutation-invalid@local.invalid', 'disabled',
      '{}'::jsonb, '{"nickname":" 잘못된닉네임"}'::jsonb,
      pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
    );
    RAISE EXCEPTION 'local_profile_mutation_invalid_signup_admitted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_failed_user_id)
     OR EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_failed_user_id)
     OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_failed_user_id)
     OR EXISTS (SELECT 1 FROM public.user_stats WHERE user_id = v_failed_user_id)
     OR EXISTS (
       SELECT 1 FROM public.user_account_status WHERE user_id = v_failed_user_id
     ) THEN
    RAISE EXCEPTION 'local_profile_mutation_failed_signup_not_atomic';
  END IF;

  BEGIN
    INSERT INTO auth.users (
      id, aud, role, email, encrypted_password,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
      v_nonstring_user_id,
      'authenticated', 'authenticated',
      'profile-mutation-numeric@local.invalid', 'disabled',
      '{}'::jsonb, '{"nickname":123}'::jsonb,
      pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
    );
    RAISE EXCEPTION 'local_profile_mutation_nonstring_signup_admitted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_nonstring_user_id)
     OR EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_nonstring_user_id)
     OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_nonstring_user_id)
     OR EXISTS (SELECT 1 FROM public.user_stats WHERE user_id = v_nonstring_user_id)
     OR EXISTS (
       SELECT 1 FROM public.user_account_status
       WHERE user_id = v_nonstring_user_id
     ) THEN
    RAISE EXCEPTION 'local_profile_mutation_nonstring_signup_not_atomic';
  END IF;

  BEGIN
    INSERT INTO auth.users (
      id, aud, role, email, encrypted_password,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
      v_duplicate_user_id,
      'authenticated', 'authenticated',
      'profile-mutation-duplicate@local.invalid', 'disabled',
      '{}'::jsonb, '{"nickname":"뮤테이션초기"}'::jsonb,
      pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
    );
    RAISE EXCEPTION 'local_profile_mutation_duplicate_signup_admitted';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
    IF v_constraint_name IS DISTINCT FROM 'profiles_active_nickname_key' THEN
      RAISE;
    END IF;
  END;

  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_duplicate_user_id)
     OR EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_duplicate_user_id)
     OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_duplicate_user_id)
     OR EXISTS (SELECT 1 FROM public.user_stats WHERE user_id = v_duplicate_user_id)
     OR EXISTS (
       SELECT 1 FROM public.user_account_status
       WHERE user_id = v_duplicate_user_id
     ) THEN
    RAISE EXCEPTION 'local_profile_mutation_duplicate_signup_not_atomic';
  END IF;

  BEGIN
    INSERT INTO auth.users (
      id, aud, role, email, encrypted_password,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
      v_downstream_user_id,
      'authenticated', 'authenticated',
      'profile-mutation-downstream@local.invalid', 'disabled',
      '{}'::jsonb, '{"nickname":"다운스트림실패"}'::jsonb,
      pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
    );
    RAISE EXCEPTION 'local_profile_mutation_downstream_failure_admitted';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    IF SQLERRM <> 'signup_profile_initialization_incomplete' THEN
      RAISE;
    END IF;
  END;

  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_downstream_user_id)
     OR EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_downstream_user_id)
     OR EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_downstream_user_id)
     OR EXISTS (SELECT 1 FROM public.user_stats WHERE user_id = v_downstream_user_id)
     OR EXISTS (
       SELECT 1 FROM public.user_account_status
       WHERE user_id = v_downstream_user_id
     ) THEN
    RAISE EXCEPTION 'local_profile_mutation_downstream_failure_not_atomic';
  END IF;
END
$signup_trigger_contract$;

DROP TRIGGER aaa_profile_mutation_downstream_conflict_fixture ON auth.users;
DROP FUNCTION public.local_profile_mutation_downstream_conflict_fixture();

INSERT INTO privacy_retention.privacy_age_profiles (
  user_id, age_band, attested_at, method, status, policy_version_id, updated_at
)
SELECT
  fixture.user_id,
  'age_14_plus',
  pg_catalog.clock_timestamp(),
  'self_attestation',
  'eligible',
  policy.id,
  pg_catalog.clock_timestamp()
FROM (VALUES
  ('51000000-0000-4000-8000-000000000001'::uuid),
  ('51000000-0000-4000-8000-000000000002'::uuid)
) AS fixture(user_id)
CROSS JOIN LATERAL (
  SELECT policy_row.id
    FROM privacy_retention.privacy_policy_versions AS policy_row
   WHERE policy_row.status = 'published'
     AND policy_row.effective_at <= pg_catalog.clock_timestamp()
   ORDER BY policy_row.effective_at DESC, policy_row.id DESC
   LIMIT 1
) AS policy;

UPDATE public.profiles
SET avatar_url = E'legacy\n' || pg_catalog.repeat('x', 4089)
WHERE user_id = '51000000-0000-4000-8000-000000000001'::uuid;

DO $legacy_avatar_boundary$
BEGIN
  IF (
    SELECT pg_catalog.octet_length(profile.avatar_url)
      FROM public.profiles AS profile
     WHERE profile.user_id =
       '51000000-0000-4000-8000-000000000001'::uuid
  ) IS DISTINCT FROM 4096 THEN
    RAISE EXCEPTION 'local_profile_mutation_legacy_avatar_boundary_drift';
  END IF;
END
$legacy_avatar_boundary$;

DO $legacy_avatar_overflow_denied$
DECLARE
  v_constraint_name text;
BEGIN
  BEGIN
    UPDATE public.profiles
       SET avatar_url = pg_catalog.repeat('x', 4097)
     WHERE user_id = '51000000-0000-4000-8000-000000000001'::uuid;
    RAISE EXCEPTION 'local_profile_mutation_legacy_avatar_overflow_admitted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_constraint_name = CONSTRAINT_NAME;
    IF v_constraint_name IS DISTINCT FROM
       'profiles_avatar_url_octet_length_check' THEN
      RAISE;
    END IF;
  END;
END
$legacy_avatar_overflow_denied$;

SET LOCAL ROLE anon;

DO $anon_denied$
BEGIN
  BEGIN
    PERFORM public.update_current_profile_nickname('익명차단');
    RAISE EXCEPTION 'local_profile_mutation_anon_nickname_admitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.compare_and_set_current_profile_avatar(NULL, NULL);
    RAISE EXCEPTION 'local_profile_mutation_anon_avatar_admitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.read_signup_profile_state(
      '51000000-0000-4000-8000-000000000001'::uuid,
      '뮤테이션초기'
    );
    RAISE EXCEPTION 'local_profile_mutation_anon_signup_read_admitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$anon_denied$;

RESET ROLE;
SET LOCAL ROLE authenticated;

DO $authenticated_mutation$
DECLARE
  v_user_id constant uuid := '51000000-0000-4000-8000-000000000001';
  v_operation_id constant uuid := '52000000-0000-4000-8000-000000000001';
  v_expected_marker constant text :=
    'profile-avatar://51000000-0000-4000-8000-000000000001/avatar-52000000-0000-4000-8000-000000000001.jpg';
  v_generated_nickname text;
  v_receipt jsonb;
BEGIN
  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'role', 'authenticated', 'sub', v_user_id::text
    )::text,
    true
  );

  BEGIN
    PERFORM pg_catalog.count(*) FROM public.profiles;
    RAISE EXCEPTION 'local_profile_mutation_direct_profile_read_admitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  v_receipt := public.update_current_profile_nickname('뮤테이션변경');
  IF v_receipt IS DISTINCT FROM pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'status', 'applied',
    'reasonCode', 'PROFILE_NICKNAME_UPDATED',
    'profile', pg_catalog.jsonb_build_object(
      'userId', v_user_id::text,
      'nickname', '뮤테이션변경',
      'avatarReference', E'legacy\n' || pg_catalog.repeat('x', 4089)
    ),
    'changes', pg_catalog.jsonb_build_object('nickname', true),
    'readback', pg_catalog.jsonb_build_object('passed', true)
  ) THEN
    RAISE EXCEPTION 'local_profile_mutation_nickname_receipt_drift';
  END IF;

  v_receipt := public.update_current_profile_nickname('뮤테이션변경');
  IF v_receipt ->> 'status' <> 'unchanged'
     OR v_receipt ->> 'reasonCode' <> 'PROFILE_NICKNAME_UNCHANGED'
     OR (v_receipt #>> '{changes,nickname}')::boolean IS DISTINCT FROM false
     OR (v_receipt #>> '{readback,passed}')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'local_profile_mutation_nickname_unchanged_drift';
  END IF;

  BEGIN
    PERFORM public.update_current_profile_nickname(' 잘못된닉네임');
    RAISE EXCEPTION 'local_profile_mutation_untrimmed_nickname_admitted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  SELECT profile.nickname
    INTO v_generated_nickname
    FROM public.read_public_profile_summaries(ARRAY[
      '51000000-0000-4000-8000-000000000002'::uuid
    ]) AS profile;
  BEGIN
    PERFORM public.update_current_profile_nickname(v_generated_nickname);
    RAISE EXCEPTION 'local_profile_mutation_duplicate_nickname_admitted';
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM <> 'profile_nickname_unavailable' THEN
      RAISE;
    END IF;
  END;

  v_receipt := public.compare_and_set_current_profile_avatar(
    E'legacy\n' || pg_catalog.repeat('x', 4089),
    v_operation_id
  );
  IF v_receipt ->> 'status' <> 'applied'
     OR v_receipt ->> 'reasonCode' <> 'PROFILE_AVATAR_UPDATED'
     OR v_receipt #>> '{profile,avatarReference}' <> v_expected_marker
     OR (v_receipt #>> '{changes,avatar}')::boolean IS DISTINCT FROM true
     OR (v_receipt #>> '{readback,passed}')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'local_profile_mutation_avatar_apply_drift';
  END IF;

  v_receipt := public.compare_and_set_current_profile_avatar(
    E'legacy\n' || pg_catalog.repeat('x', 4089),
    '52000000-0000-4000-8000-000000000002'::uuid
  );
  IF v_receipt ->> 'status' <> 'conflict'
     OR v_receipt ->> 'reasonCode' <> 'PROFILE_VERSION_CONFLICT'
     OR v_receipt #>> '{profile,avatarReference}' <> v_expected_marker
     OR (v_receipt #>> '{changes,avatar}')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'local_profile_mutation_avatar_conflict_drift';
  END IF;

  BEGIN
    PERFORM public.compare_and_set_current_profile_avatar(
      pg_catalog.repeat('x', 4097),
      NULL
    );
    RAISE EXCEPTION 'local_profile_mutation_oversized_avatar_expected_admitted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  v_receipt := public.compare_and_set_current_profile_avatar(
    v_expected_marker,
    v_operation_id
  );
  IF v_receipt ->> 'status' <> 'unchanged'
     OR v_receipt ->> 'reasonCode' <> 'PROFILE_AVATAR_UNCHANGED'
     OR (v_receipt #>> '{changes,avatar}')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'local_profile_mutation_avatar_unchanged_drift';
  END IF;

  v_receipt := public.compare_and_set_current_profile_avatar(
    v_expected_marker,
    NULL
  );
  IF v_receipt ->> 'status' <> 'applied'
     OR v_receipt ->> 'reasonCode' <> 'PROFILE_AVATAR_UPDATED'
     OR v_receipt #> '{profile,avatarReference}' <> 'null'::jsonb
     OR (v_receipt #>> '{changes,avatar}')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'local_profile_mutation_avatar_clear_drift';
  END IF;
END
$authenticated_mutation$;

RESET ROLE;
CREATE FUNCTION public.local_profile_mutation_suppress_update_fixture()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fixture$
BEGIN
  RETURN NULL;
END
$fixture$;

CREATE TRIGGER aaa_profile_mutation_suppress_update_fixture
BEFORE UPDATE ON public.profiles
FOR EACH ROW
WHEN (
  OLD.user_id = '51000000-0000-4000-8000-000000000001'::uuid
)
EXECUTE FUNCTION public.local_profile_mutation_suppress_update_fixture();

SET LOCAL ROLE authenticated;
DO $mutation_readback_guard$
DECLARE
  v_user_id constant uuid := '51000000-0000-4000-8000-000000000001';
BEGIN
  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'role', 'authenticated', 'sub', v_user_id::text
    )::text,
    true
  );
  BEGIN
    PERFORM public.update_current_profile_nickname('읽기검증차단');
    RAISE EXCEPTION 'local_profile_mutation_nickname_suppression_admitted';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    IF SQLERRM <> 'profile_nickname_readback_failed' THEN
      RAISE;
    END IF;
  END;
  BEGIN
    PERFORM public.compare_and_set_current_profile_avatar(
      NULL,
      '52000000-0000-4000-8000-000000000003'::uuid
    );
    RAISE EXCEPTION 'local_profile_mutation_avatar_suppression_admitted';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    IF SQLERRM <> 'profile_avatar_readback_failed' THEN
      RAISE;
    END IF;
  END;
END
$mutation_readback_guard$;

RESET ROLE;
DROP TRIGGER aaa_profile_mutation_suppress_update_fixture ON public.profiles;
DROP FUNCTION public.local_profile_mutation_suppress_update_fixture();

DO $mutation_readback_guard_state$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.profiles AS profile
     WHERE profile.user_id =
       '51000000-0000-4000-8000-000000000001'::uuid
       AND profile.nickname = '뮤테이션변경'
       AND profile.avatar_url IS NULL
  ) THEN
    RAISE EXCEPTION 'local_profile_mutation_suppression_changed_state';
  END IF;
END
$mutation_readback_guard_state$;

SET LOCAL ROLE service_role;

DO $signup_state$
DECLARE
  v_user_id constant uuid := '51000000-0000-4000-8000-000000000001';
  v_receipt jsonb;
BEGIN
  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('role', 'service_role')::text,
    true
  );
  v_receipt := public.read_signup_profile_state(v_user_id, '뮤테이션변경');
  IF v_receipt IS DISTINCT FROM pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'complete', true,
    'reasonCode', 'SIGNUP_PROFILE_READY',
    'nicknameMatches', true,
    'counts', pg_catalog.jsonb_build_object(
      'profile', 1,
      'ordinaryRole', 1,
      'adminRole', 0,
      'stats', 1,
      'activeStatus', 1
    )
  ) THEN
    RAISE EXCEPTION 'local_profile_mutation_signup_receipt_drift';
  END IF;

  BEGIN
    PERFORM public.update_current_profile_nickname('서비스차단');
    RAISE EXCEPTION 'local_profile_mutation_service_nickname_admitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.compare_and_set_current_profile_avatar(NULL, NULL);
    RAISE EXCEPTION 'local_profile_mutation_service_avatar_admitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$signup_state$;

RESET ROLE;
INSERT INTO public.user_roles (user_id, role)
VALUES ('51000000-0000-4000-8000-000000000001'::uuid, 'admin');

SET LOCAL ROLE service_role;
DO $signup_admin_rejected$
DECLARE
  v_receipt jsonb;
BEGIN
  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('role', 'service_role')::text,
    true
  );
  v_receipt := public.read_signup_profile_state(
    '51000000-0000-4000-8000-000000000001'::uuid,
    '뮤테이션변경'
  );
  IF (v_receipt ->> 'complete')::boolean IS DISTINCT FROM false
     OR v_receipt ->> 'reasonCode' <> 'SIGNUP_PROFILE_INCOMPLETE'
     OR (v_receipt #>> '{counts,adminRole}')::integer <> 1 THEN
    RAISE EXCEPTION 'local_profile_mutation_signup_admin_admitted';
  END IF;
END
$signup_admin_rejected$;

RESET ROLE;
DELETE FROM public.user_roles
WHERE user_id = '51000000-0000-4000-8000-000000000001'::uuid
  AND role::text = 'admin';
UPDATE public.profiles
SET nickname = '탈퇴한 사용자'
WHERE user_id = '51000000-0000-4000-8000-000000000001'::uuid;

SET LOCAL ROLE authenticated;
DO $deleted_profile_denied$
DECLARE
  v_user_id constant uuid := '51000000-0000-4000-8000-000000000001';
BEGIN
  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'role', 'authenticated', 'sub', v_user_id::text
    )::text,
    true
  );
  BEGIN
    PERFORM public.update_current_profile_nickname('부활차단');
    RAISE EXCEPTION 'local_profile_mutation_deleted_nickname_admitted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'profile_account_deleted' THEN
      RAISE;
    END IF;
  END;
  BEGIN
    PERFORM public.compare_and_set_current_profile_avatar(NULL, NULL);
    RAISE EXCEPTION 'local_profile_mutation_deleted_avatar_admitted';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'profile_account_deleted' THEN
      RAISE;
    END IF;
  END;
END
$deleted_profile_denied$;

RESET ROLE;
UPDATE public.profiles
SET nickname = '탈퇴한 사용자'
WHERE user_id = '51000000-0000-4000-8000-000000000002'::uuid;

DO $partial_unique_index_contract$
BEGIN
  IF (SELECT pg_catalog.count(*) FROM public.profiles
      WHERE user_id IN (
        '51000000-0000-4000-8000-000000000001'::uuid,
        '51000000-0000-4000-8000-000000000002'::uuid
      ) AND nickname = '탈퇴한 사용자') <> 2 THEN
    RAISE EXCEPTION 'local_profile_mutation_deleted_sentinel_not_repeatable';
  END IF;
END
$partial_unique_index_contract$;

ROLLBACK;
