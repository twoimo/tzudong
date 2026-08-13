\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  (
    'f0000000-0000-4000-8000-000000000701'::uuid,
    'authenticated', 'authenticated',
    'profile-page-one@local.invalid', 'disabled',
    '{}'::jsonb, '{}'::jsonb,
    '2026-01-01T00:00:00Z'::timestamptz,
    '2026-01-01T00:00:00Z'::timestamptz
  ),
  (
    'f0000000-0000-4000-8000-000000000702'::uuid,
    'authenticated', 'authenticated',
    'profile-page-two@local.invalid', 'disabled',
    '{}'::jsonb, '{}'::jsonb,
    '2026-01-01T00:00:00Z'::timestamptz,
    '2026-01-01T00:00:00Z'::timestamptz
  ),
  (
    'f0000000-0000-4000-8000-000000000703'::uuid,
    'authenticated', 'authenticated',
    'profile-page-three@local.invalid', 'disabled',
    '{}'::jsonb, '{}'::jsonb,
    '2026-01-01T00:00:00Z'::timestamptz,
    '2026-01-01T00:00:00Z'::timestamptz
  ),
  (
    'f0000000-0000-4000-8000-000000000704'::uuid,
    'authenticated', 'authenticated',
    'profile-page-zero@local.invalid', 'disabled',
    '{}'::jsonb, '{}'::jsonb,
    '2026-01-01T00:00:00Z'::timestamptz,
    '2026-01-01T00:00:00Z'::timestamptz
  );

INSERT INTO public.profiles (
  id, user_id, nickname, email, avatar_url, created_at, last_login
)
VALUES
  (
    'f0000000-0000-4000-8000-000000000701'::uuid,
    'f0000000-0000-4000-8000-000000000701'::uuid,
    '페이지일', 'profile-page-one@local.invalid', NULL,
    '2026-01-01T00:00:00Z'::timestamptz,
    '2026-01-01T00:00:00Z'::timestamptz
  ),
  (
    'f0000000-0000-4000-8000-000000000702'::uuid,
    'f0000000-0000-4000-8000-000000000702'::uuid,
    '페이지이', 'profile-page-two@local.invalid', NULL,
    '2026-01-01T00:00:00Z'::timestamptz,
    '2026-01-01T00:00:00Z'::timestamptz
  ),
  (
    'f0000000-0000-4000-8000-000000000703'::uuid,
    'f0000000-0000-4000-8000-000000000703'::uuid,
    '페이지삼', 'profile-page-three@local.invalid', NULL,
    '2026-01-01T00:00:00Z'::timestamptz,
    '2026-01-01T00:00:00Z'::timestamptz
  ),
  (
    'f0000000-0000-4000-8000-000000000704'::uuid,
    'f0000000-0000-4000-8000-000000000704'::uuid,
    '페이지영', 'profile-page-zero@local.invalid', NULL,
    '2026-01-01T00:00:00Z'::timestamptz,
    '2026-01-01T00:00:00Z'::timestamptz
  );

INSERT INTO public.restaurants_backup (id)
VALUES ('f0000000-0000-4000-8000-000000000721'::uuid);

INSERT INTO public.reviews (
  id, user_id, restaurant_id, title, content, visited_at,
  verification_photo, is_verified, created_at, updated_at, like_count
)
SELECT
  fixture.id,
  fixture.user_id,
  'f0000000-0000-4000-8000-000000000721'::uuid,
  fixture.title,
  '프로필 페이지 로컬 트랜잭션 검증 내용입니다.',
  '2026-01-01T00:00:00Z'::timestamptz,
  'local-only-profile-page.jpg',
  true,
  fixture.created_at,
  fixture.created_at,
  fixture.like_count
FROM (
  VALUES
    (
      'f0000000-0000-4000-8000-000000000711'::uuid,
      'f0000000-0000-4000-8000-000000000701'::uuid,
      '페이지 리뷰 1'::text,
      pg_catalog.statement_timestamp(), 1000000000
    ),
    (
      'f0000000-0000-4000-8000-000000000712'::uuid,
      'f0000000-0000-4000-8000-000000000701'::uuid,
      '페이지 리뷰 2'::text,
      pg_catalog.statement_timestamp(), 1000000000
    ),
    (
      'f0000000-0000-4000-8000-000000000713'::uuid,
      'f0000000-0000-4000-8000-000000000702'::uuid,
      '페이지 동점 리뷰 1'::text,
      pg_catalog.statement_timestamp(), 1000000000
    ),
    (
      'f0000000-0000-4000-8000-000000000714'::uuid,
      'f0000000-0000-4000-8000-000000000703'::uuid,
      '페이지 동점 리뷰 2'::text,
      pg_catalog.statement_timestamp(), 1000000000
    ),
    (
      'f0000000-0000-4000-8000-000000000715'::uuid,
      'f0000000-0000-4000-8000-000000000704'::uuid,
      '페이지 이전달 리뷰'::text,
      pg_catalog.timezone(
        'Asia/Seoul',
        pg_catalog.date_trunc(
          'month',
          pg_catalog.timezone(
            'Asia/Seoul', pg_catalog.statement_timestamp()
          )
        ) - interval '1 second'
      ),
      1000000000
    )
) AS fixture(id, user_id, title, created_at, like_count);

SET LOCAL ROLE anon;

DO $anon_contract$
DECLARE
  v_first jsonb;
  v_second jsonb;
  v_zero jsonb;
  v_all jsonb;
BEGIN
  BEGIN
    PERFORM count(*) FROM public.profiles;
    RAISE EXCEPTION 'local_profile_page_anon_direct_profile_read_admitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  SELECT pg_catalog.jsonb_agg(
           pg_catalog.to_jsonb(result_row) - 'output_ordinal'
           ORDER BY result_row.output_ordinal
         )
    INTO v_first
    FROM public.read_public_profile_leaderboard_page(
      'monthly', 2, NULL::numeric, NULL::uuid
    ) WITH ORDINALITY AS result_row(
      user_id, nickname, review_count, verified_review_count, total_likes,
      avg_likes_per_review, quality_score, output_ordinal
    );

  IF pg_catalog.jsonb_array_length(v_first) <> 2
     OR v_first #>> '{0,user_id}' <>
       'f0000000-0000-4000-8000-000000000701'
     OR (v_first #>> '{0,quality_score}')::numeric <> 200000002.0
     OR v_first #>> '{1,user_id}' <>
       'f0000000-0000-4000-8000-000000000702'
     OR (v_first #>> '{1,quality_score}')::numeric <> 100000001.0 THEN
    RAISE EXCEPTION 'local_profile_page_first_page_failed';
  END IF;

  SELECT pg_catalog.jsonb_agg(
           pg_catalog.to_jsonb(result_row) - 'output_ordinal'
           ORDER BY result_row.output_ordinal
         )
    INTO v_second
    FROM public.read_public_profile_leaderboard_page(
      'monthly', 1,
      (v_first #>> '{1,quality_score}')::numeric,
      (v_first #>> '{1,user_id}')::uuid
    ) WITH ORDINALITY AS result_row(
      user_id, nickname, review_count, verified_review_count, total_likes,
      avg_likes_per_review, quality_score, output_ordinal
    );

  IF pg_catalog.jsonb_array_length(v_second) <> 1
     OR v_second #>> '{0,user_id}' <>
       'f0000000-0000-4000-8000-000000000703'
     OR (v_second #>> '{0,quality_score}')::numeric <> 100000001.0 THEN
    RAISE EXCEPTION 'local_profile_page_tie_cursor_failed';
  END IF;

  SELECT pg_catalog.jsonb_agg(
           pg_catalog.to_jsonb(result_row) - 'output_ordinal'
           ORDER BY result_row.output_ordinal
         )
    INTO v_zero
    FROM public.read_public_profile_leaderboard_page(
      'monthly', 1, 0::numeric,
      'f0000000-0000-4000-8000-000000000703'::uuid
    ) WITH ORDINALITY AS result_row(
      user_id, nickname, review_count, verified_review_count, total_likes,
      avg_likes_per_review, quality_score, output_ordinal
    );

  IF pg_catalog.jsonb_array_length(v_zero) <> 1
     OR v_zero #>> '{0,user_id}' <>
       'f0000000-0000-4000-8000-000000000704'
     OR (v_zero #>> '{0,review_count}')::bigint <> 0
     OR (v_zero #>> '{0,quality_score}')::numeric <> 0 THEN
    RAISE EXCEPTION 'local_profile_page_zero_review_monthly_failed';
  END IF;

  SELECT pg_catalog.to_jsonb(result_row)
    INTO v_all
    FROM public.read_public_profile_leaderboard_page(
      'all', 100, NULL::numeric, NULL::uuid
    ) AS result_row
   WHERE result_row.user_id =
     'f0000000-0000-4000-8000-000000000704'::uuid;

  IF v_all IS NULL
     OR (v_all #>> '{review_count}')::bigint <> 1
     OR (v_all #>> '{verified_review_count}')::bigint <> 1
     OR (v_all #>> '{quality_score}')::numeric <> 100000001.0 THEN
    RAISE EXCEPTION 'local_profile_page_all_period_failed';
  END IF;

  BEGIN
    PERFORM public.read_public_profile_leaderboard_page(
      'monthly', 10, NULL::numeric,
      'f0000000-0000-4000-8000-000000000701'::uuid
    );
    RAISE EXCEPTION 'local_profile_page_partial_cursor_id_admitted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.read_public_profile_leaderboard_page(
      'monthly', 10, 1::numeric, NULL::uuid
    );
    RAISE EXCEPTION 'local_profile_page_partial_cursor_score_admitted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.read_public_profile_leaderboard_page(
      'monthly', 10, '-0.1'::numeric,
      'f0000000-0000-4000-8000-000000000701'::uuid
    );
    RAISE EXCEPTION 'local_profile_page_negative_cursor_admitted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.read_public_profile_leaderboard_page(
      'monthly', 10, 'NaN'::numeric,
      'f0000000-0000-4000-8000-000000000701'::uuid
    );
    RAISE EXCEPTION 'local_profile_page_nan_cursor_admitted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.read_public_profile_leaderboard_page(
      'monthly', 10, 'Infinity'::numeric,
      'f0000000-0000-4000-8000-000000000701'::uuid
    );
    RAISE EXCEPTION 'local_profile_page_infinity_cursor_admitted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.read_public_profile_leaderboard_page(
      'monthly', 10, '-Infinity'::numeric,
      'f0000000-0000-4000-8000-000000000701'::uuid
    );
    RAISE EXCEPTION 'local_profile_page_negative_infinity_cursor_admitted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.read_public_profile_leaderboard_page(
      'MONTHLY', 10, NULL::numeric, NULL::uuid
    );
    RAISE EXCEPTION 'local_profile_page_nonexact_period_admitted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.read_public_profile_leaderboard_page(
      'all', 0, NULL::numeric, NULL::uuid
    );
    RAISE EXCEPTION 'local_profile_page_zero_limit_admitted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.read_public_profile_leaderboard_page(
      'all', 101, NULL::numeric, NULL::uuid
    );
    RAISE EXCEPTION 'local_profile_page_oversized_limit_admitted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
END
$anon_contract$;

RESET ROLE;
SET LOCAL ROLE authenticated;

DO $authenticated_contract$
BEGIN
  IF (
    SELECT count(*)
      FROM public.read_public_profile_leaderboard_page(
        'monthly', 1, 100000001.0::numeric,
        'f0000000-0000-4000-8000-000000000702'::uuid
      )
     WHERE user_id = 'f0000000-0000-4000-8000-000000000703'::uuid
  ) <> 1 THEN
    RAISE EXCEPTION 'local_profile_page_authenticated_execution_failed';
  END IF;
END
$authenticated_contract$;

RESET ROLE;
SET LOCAL ROLE service_role;

DO $service_role_contract$
BEGIN
  BEGIN
    PERFORM count(*) FROM public.profiles;
    RAISE EXCEPTION 'local_profile_page_service_role_direct_profile_read_admitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.read_public_profile_leaderboard_page(
      'monthly', 10, NULL::numeric, NULL::uuid
    );
    RAISE EXCEPTION 'local_profile_page_service_role_execution_admitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$service_role_contract$;

RESET ROLE;
ROLLBACK;
