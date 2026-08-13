\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000000601'::uuid,
    'authenticated', 'authenticated',
    'profile-boundary-one@local.invalid', 'disabled',
    '{}'::jsonb, '{}'::jsonb,
    '2026-01-01T00:00:00Z'::timestamptz,
    '2026-01-01T00:00:00Z'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000000602'::uuid,
    'authenticated', 'authenticated',
    'profile-boundary-two@local.invalid', 'disabled',
    '{}'::jsonb, '{}'::jsonb,
    '2026-01-01T00:00:00Z'::timestamptz,
    '2026-01-01T00:00:00Z'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000000603'::uuid,
    'authenticated', 'authenticated',
    'profile-boundary-deleted@local.invalid', 'disabled',
    '{}'::jsonb, '{}'::jsonb,
    '2026-01-01T00:00:00Z'::timestamptz,
    '2026-01-01T00:00:00Z'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000000604'::uuid,
    'authenticated', 'authenticated',
    'profile-boundary-three@local.invalid', 'disabled',
    '{}'::jsonb, '{}'::jsonb,
    '2026-01-01T00:00:00Z'::timestamptz,
    '2026-01-01T00:00:00Z'::timestamptz
  );

DO $remove_trigger_created_profile_state$
BEGIN
  IF (SELECT pg_catalog.count(*) FROM public.profiles
      WHERE user_id BETWEEN
        '00000000-0000-4000-8000-000000000601'::uuid AND
        '00000000-0000-4000-8000-000000000604'::uuid) <> 4
     OR (SELECT pg_catalog.count(*) FROM public.user_roles
         WHERE user_id BETWEEN
           '00000000-0000-4000-8000-000000000601'::uuid AND
           '00000000-0000-4000-8000-000000000604'::uuid
           AND role::text = 'user') <> 4
     OR (SELECT pg_catalog.count(*) FROM public.user_stats
         WHERE user_id BETWEEN
           '00000000-0000-4000-8000-000000000601'::uuid AND
           '00000000-0000-4000-8000-000000000604'::uuid) <> 4
     OR (SELECT pg_catalog.count(*) FROM public.user_account_status
         WHERE user_id BETWEEN
           '00000000-0000-4000-8000-000000000601'::uuid AND
           '00000000-0000-4000-8000-000000000604'::uuid
           AND account_status = 'active') <> 4 THEN
    RAISE EXCEPTION 'local_profile_read_trigger_fixture_state_drift';
  END IF;

  DELETE FROM public.user_account_status
  WHERE user_id BETWEEN
    '00000000-0000-4000-8000-000000000601'::uuid AND
    '00000000-0000-4000-8000-000000000604'::uuid;
  DELETE FROM public.user_stats
  WHERE user_id BETWEEN
    '00000000-0000-4000-8000-000000000601'::uuid AND
    '00000000-0000-4000-8000-000000000604'::uuid;
  DELETE FROM public.user_roles
  WHERE user_id BETWEEN
    '00000000-0000-4000-8000-000000000601'::uuid AND
    '00000000-0000-4000-8000-000000000604'::uuid;
  DELETE FROM public.profiles
  WHERE user_id BETWEEN
    '00000000-0000-4000-8000-000000000601'::uuid AND
    '00000000-0000-4000-8000-000000000604'::uuid;
END
$remove_trigger_created_profile_state$;

INSERT INTO public.profiles (
  id, user_id, nickname, email, avatar_url, created_at, last_login
)
VALUES
  (
    '00000000-0000-4000-8000-000000000601'::uuid,
    '00000000-0000-4000-8000-000000000601'::uuid,
    '프로필경계일', 'profile-boundary-one@local.invalid',
    'https://local.invalid/avatar-one.png',
    '2026-01-01T00:00:00Z'::timestamptz,
    '2026-01-01T00:00:00Z'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000000602'::uuid,
    '00000000-0000-4000-8000-000000000602'::uuid,
    '프로필경계이', 'profile-boundary-two@local.invalid', NULL,
    '2026-01-01T00:00:00Z'::timestamptz,
    '2026-01-01T00:00:00Z'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000000603'::uuid,
    '00000000-0000-4000-8000-000000000603'::uuid,
    '탈퇴한 사용자', 'profile-boundary-deleted@local.invalid', NULL,
    '2026-01-01T00:00:00Z'::timestamptz,
    '2026-01-01T00:00:00Z'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000000604'::uuid,
    '00000000-0000-4000-8000-000000000604'::uuid,
    '프로필경계삼', 'profile-boundary-three@local.invalid', NULL,
    '2026-01-01T00:00:00Z'::timestamptz,
    '2026-01-01T00:00:00Z'::timestamptz
  );

INSERT INTO public.restaurants_backup (id)
VALUES ('00000000-0000-4000-8000-000000000621'::uuid);

INSERT INTO public.reviews (
  id, user_id, restaurant_id, title, content, visited_at,
  verification_photo, is_verified, created_at, updated_at, like_count
)
SELECT
  fixture.id,
  fixture.user_id,
  restaurant.id,
  fixture.title,
  '프로필 경계 리더보드 로컬 트랜잭션 검증 내용입니다.',
  '2026-01-01T00:00:00Z'::timestamptz,
  'local-only-profile-boundary.jpg',
  fixture.is_verified,
  fixture.created_at,
  fixture.created_at,
  fixture.like_count
FROM (
  VALUES
    (
      '00000000-0000-4000-8000-000000000611'::uuid,
      '00000000-0000-4000-8000-000000000601'::uuid,
      '경계 리뷰 1'::text, true,
      pg_catalog.statement_timestamp(), 4
    ),
    (
      '00000000-0000-4000-8000-000000000612'::uuid,
      '00000000-0000-4000-8000-000000000601'::uuid,
      '경계 리뷰 2'::text, true,
      pg_catalog.statement_timestamp(), 2
    ),
    (
      '00000000-0000-4000-8000-000000000613'::uuid,
      '00000000-0000-4000-8000-000000000601'::uuid,
      '경계 리뷰 이전달'::text, true,
      pg_catalog.timezone(
        'Asia/Seoul',
        pg_catalog.date_trunc(
          'month',
          pg_catalog.timezone(
            'Asia/Seoul', pg_catalog.statement_timestamp()
          )
        ) - interval '1 second'
      ),
      10
    )
) AS fixture(id, user_id, title, is_verified, created_at, like_count)
CROSS JOIN LATERAL (
  SELECT '00000000-0000-4000-8000-000000000621'::uuid AS id
) AS restaurant;

SET LOCAL ROLE anon;

DO $anon_contract$
DECLARE
  v_rows jsonb;
  v_leaderboard jsonb;
BEGIN
  BEGIN
    PERFORM count(*) FROM public.profiles;
    RAISE EXCEPTION 'local_profile_read_anon_direct_profile_read_admitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  SELECT pg_catalog.jsonb_agg(
           pg_catalog.to_jsonb(result_row)
           ORDER BY result_row.input_position
         )
    INTO v_rows
    FROM (
      SELECT
        result.user_id,
        result.nickname,
        result.avatar_url,
        pg_catalog.row_number() OVER () AS input_position
        FROM public.read_public_profile_summaries(ARRAY[
          '00000000-0000-4000-8000-000000000602'::uuid,
          '00000000-0000-4000-8000-000000000699'::uuid,
          '00000000-0000-4000-8000-000000000601'::uuid,
          '00000000-0000-4000-8000-000000000603'::uuid
        ]) AS result
    ) AS result_row;

  IF pg_catalog.jsonb_array_length(v_rows) <> 2
     OR v_rows #>> '{0,user_id}' <>
       '00000000-0000-4000-8000-000000000602'
     OR v_rows #>> '{1,user_id}' <>
       '00000000-0000-4000-8000-000000000601'
     OR v_rows #>> '{0,nickname}' <> '프로필경계이'
     OR v_rows #> '{0,avatar_url}' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'local_profile_read_summary_order_or_omission_failed';
  END IF;

  BEGIN
    PERFORM public.read_public_profile_summaries(NULL::uuid[]);
    RAISE EXCEPTION 'local_profile_read_null_array_admitted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.read_public_profile_summaries(ARRAY[]::uuid[]);
    RAISE EXCEPTION 'local_profile_read_empty_array_admitted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.read_public_profile_summaries(ARRAY[
      '00000000-0000-4000-8000-000000000601'::uuid,
      '00000000-0000-4000-8000-000000000601'::uuid
    ]);
    RAISE EXCEPTION 'local_profile_read_duplicate_array_admitted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.read_public_profile_summaries(
      ARRAY[NULL::uuid]
    );
    RAISE EXCEPTION 'local_profile_read_null_element_admitted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.read_public_profile_summaries(
      ARRAY(
        SELECT ('00000000-0000-4000-8000-' ||
          pg_catalog.lpad(value::text, 12, '0'))::uuid
          FROM pg_catalog.generate_series(1, 101) AS value
      )
    );
    RAISE EXCEPTION 'local_profile_read_oversized_array_admitted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  SELECT pg_catalog.jsonb_agg(
           pg_catalog.to_jsonb(result_row) - 'output_ordinal'
           ORDER BY result_row.output_ordinal
         )
    INTO v_leaderboard
    FROM public.read_public_profile_leaderboard(
      'monthly', 100
    ) WITH ORDINALITY AS result_row(
      user_id, nickname, review_count, verified_review_count, total_likes,
      avg_likes_per_review, quality_score, output_ordinal
    )
   WHERE result_row.user_id IN (
     '00000000-0000-4000-8000-000000000601'::uuid,
     '00000000-0000-4000-8000-000000000602'::uuid,
     '00000000-0000-4000-8000-000000000603'::uuid,
     '00000000-0000-4000-8000-000000000604'::uuid
   );

  IF pg_catalog.jsonb_array_length(v_leaderboard) <> 3
     OR v_leaderboard #>> '{0,user_id}' <>
       '00000000-0000-4000-8000-000000000601'
     OR (v_leaderboard #>> '{0,review_count}')::bigint <> 2
     OR (v_leaderboard #>> '{0,verified_review_count}')::bigint <> 2
     OR (v_leaderboard #>> '{0,total_likes}')::bigint <> 6
     OR (v_leaderboard #>> '{0,avg_likes_per_review}')::numeric <> 3.0
     OR (v_leaderboard #>> '{0,quality_score}')::numeric <> 2.6
     OR v_leaderboard #>> '{1,user_id}' <>
       '00000000-0000-4000-8000-000000000602'
     OR (v_leaderboard #>> '{1,review_count}')::bigint <> 0
     OR (v_leaderboard #>> '{1,quality_score}')::numeric <> 0
     OR v_leaderboard #>> '{2,user_id}' <>
       '00000000-0000-4000-8000-000000000604'
     OR (v_leaderboard #>> '{2,quality_score}')::numeric <> 0 THEN
    RAISE EXCEPTION 'local_profile_read_monthly_leaderboard_failed';
  END IF;

  BEGIN
    PERFORM public.read_public_profile_leaderboard('MONTHLY', 100);
    RAISE EXCEPTION 'local_profile_read_nonexact_period_admitted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.read_public_profile_leaderboard('all', 0);
    RAISE EXCEPTION 'local_profile_read_zero_limit_admitted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END
$anon_contract$;

RESET ROLE;
SET LOCAL ROLE authenticated;

DO $authenticated_contract$
BEGIN
  BEGIN
    PERFORM count(*) FROM public.profiles;
    RAISE EXCEPTION 'local_profile_read_authenticated_direct_profile_read_admitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF (
    SELECT count(*)
      FROM public.read_public_profile_summaries(ARRAY[
        '00000000-0000-4000-8000-000000000601'::uuid
      ])
  ) <> 1
     OR (
       SELECT count(*)
         FROM public.read_public_profile_leaderboard('all', 100)
        WHERE user_id =
          '00000000-0000-4000-8000-000000000602'::uuid
     ) <> 1 THEN
    RAISE EXCEPTION 'local_profile_read_authenticated_execution_failed';
  END IF;
END
$authenticated_contract$;

RESET ROLE;
SET LOCAL ROLE service_role;

DO $service_role_contract$
BEGIN
  BEGIN
    PERFORM count(*) FROM public.profiles;
    RAISE EXCEPTION 'local_profile_read_service_role_direct_profile_read_admitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.read_public_profile_summaries(ARRAY[
      '00000000-0000-4000-8000-000000000601'::uuid
    ]);
    RAISE EXCEPTION 'local_profile_read_service_role_summary_admitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.read_public_profile_leaderboard('all', 100);
    RAISE EXCEPTION 'local_profile_read_service_role_leaderboard_admitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$service_role_contract$;

RESET ROLE;
ROLLBACK;
