#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPABASE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${SUPABASE_DIR}/.." && pwd)"

ENV_FILE="${SUPABASE_ENV_FILE:-}"
if [[ -z "${ENV_FILE}" ]]; then
  if [[ -f "${SUPABASE_DIR}/.env" ]]; then
    ENV_FILE="${SUPABASE_DIR}/.env"
  elif [[ -f "${SUPABASE_DIR}/.env.old" ]]; then
    ENV_FILE="${SUPABASE_DIR}/.env.old"
  else
    echo "Missing Supabase env file (.env or .env.old)." >&2
    exit 1
  fi
fi

DOCKER_BIN=""
for candidate in docker docker.exe; do
  if ! command -v "${candidate}" >/dev/null 2>&1; then
    continue
  fi

  if "${candidate}" compose version >/dev/null 2>&1; then
    DOCKER_BIN="${candidate}"
    break
  fi
done

if [[ -z "${DOCKER_BIN}" ]]; then
  echo "Docker Compose is required for backend/supabase/scripts/test_admin_review_merge_rpcs.sh but is unavailable." >&2
  exit 1
fi

if ! "${DOCKER_BIN}" info >/dev/null 2>&1; then
  echo "Docker is installed (${DOCKER_BIN}) but the Docker daemon is unavailable. Start Docker Desktop / the Docker engine before running this harness." >&2
  exit 1
fi

compose() {
  "${DOCKER_BIN}" compose --env-file "${ENV_FILE}" -f "${SUPABASE_DIR}/docker-compose.yml" "$@"
}

psql_exec() {
  compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

wait_for_db() {
  local attempts=30

  while (( attempts > 0 )); do
    if compose exec -T db pg_isready -U postgres -d postgres >/dev/null 2>&1; then
      return 0
    fi

    attempts=$((attempts - 1))
    sleep 2
  done

  echo "Supabase db did not become ready in time." >&2
  return 1
}

apply_sql_file() {
  local sql_file="$1"
  psql_exec < "${sql_file}"
}

cleanup_sql=$(cat <<'SQL'
delete from public.restaurants
where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444'
);
SQL
)

assert_sql=$(cat <<'SQL'
select set_config('request.jwt.claim.role', 'service_role', true);

do $$
declare
  v_result record;
  v_target public.restaurants%rowtype;
  v_source public.restaurants%rowtype;
begin
  delete from public.restaurants
  where id in (
    '11111111-1111-1111-1111-111111111111',
    '22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333',
    '44444444-4444-4444-4444-444444444444'
  );

  insert into public.restaurants (
    id,
    trace_id,
    approved_name,
    categories,
    youtube_link,
    youtube_meta,
    tzuyang_review,
    status,
    updated_by_admin_id,
    created_at,
    updated_at
  ) values
    (
      '11111111-1111-1111-1111-111111111111',
      'trace-reviewed-target',
      '승인된 맛집',
      array['한식']::text[],
      'https://youtube.com/watch?v=existing',
      '{"title":"기존 영상"}'::jsonb,
      '기존 리뷰',
      'approved',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      '2026-04-01T00:00:00Z'::timestamptz,
      '2026-04-10T08:00:00Z'::timestamptz
    ),
    (
      '22222222-2222-2222-2222-222222222222',
      'trace-missing-source',
      '누락 원본',
      array['분식']::text[],
      'https://youtube.com/watch?v=new',
      '{"title":"새 영상"}'::jsonb,
      '새 리뷰',
      'missing',
      null,
      '2026-04-01T00:00:00Z'::timestamptz,
      '2026-04-10T08:05:00Z'::timestamptz
    );

  select *
  into v_result
  from public.merge_restaurant_records_for_admin_review(
    '11111111-1111-1111-1111-111111111111'::uuid,
    '22222222-2222-2222-2222-222222222222'::uuid,
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
    '2026-04-10T08:00:00Z'::timestamptz,
    'https://youtube.com/watch?v=new',
    '{"title":"새 영상"}'::jsonb,
    '새 리뷰',
    '분식'
  );

  if coalesce(v_result.success, false) is not true then
    raise exception 'expected success merge result, got %', row_to_json(v_result);
  end if;

  select * into v_target
  from public.restaurants
  where id = '11111111-1111-1111-1111-111111111111'::uuid;

  select * into v_source
  from public.restaurants
  where id = '22222222-2222-2222-2222-222222222222'::uuid;

  if v_target.youtube_link <> 'https://youtube.com/watch?v=existing' then
    raise exception 'expected existing youtube_link to win, got %', v_target.youtube_link;
  end if;

  if v_target.youtube_meta <> '{"title":"기존 영상"}'::jsonb then
    raise exception 'expected existing youtube_meta to be preserved, got %', v_target.youtube_meta;
  end if;

  if v_target.tzuyang_review <> '기존 리뷰' then
    raise exception 'expected existing tzuyang_review to be preserved, got %', v_target.tzuyang_review;
  end if;

  if v_target.categories <> array['한식', '분식']::text[] then
    raise exception 'expected category merge, got %', v_target.categories;
  end if;

  if v_target.updated_by_admin_id <> 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid then
    raise exception 'expected admin stamp on target row, got %', v_target.updated_by_admin_id;
  end if;

  if v_source.status <> 'deleted' then
    raise exception 'expected source row to be deleted, got %', v_source.status;
  end if;

  if v_source.updated_by_admin_id <> 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid then
    raise exception 'expected admin stamp on source row, got %', v_source.updated_by_admin_id;
  end if;

  if v_source.db_error_message is not null or v_source.db_error_details is not null then
    raise exception 'expected source row db_error fields to clear';
  end if;

  insert into public.restaurants (
    id,
    trace_id,
    approved_name,
    categories,
    status,
    updated_by_admin_id,
    created_at,
    updated_at
  ) values
    (
      '33333333-3333-3333-3333-333333333333',
      'trace-lock-target',
      '락 테스트 대상',
      array['양식']::text[],
      'approved',
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
      '2026-04-01T00:00:00Z'::timestamptz,
      '2026-04-10T09:00:00Z'::timestamptz
    ),
    (
      '44444444-4444-4444-4444-444444444444',
      'trace-lock-source',
      '락 테스트 원본',
      array['양식']::text[],
      'db_conflict',
      null,
      '2026-04-01T00:00:00Z'::timestamptz,
      '2026-04-10T09:05:00Z'::timestamptz
    );

  select *
  into v_result
  from public.merge_restaurant_records_for_admin_review(
    '33333333-3333-3333-3333-333333333333'::uuid,
    '44444444-4444-4444-4444-444444444444'::uuid,
    'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid,
    '2026-04-09T09:00:00Z'::timestamptz,
    'https://youtube.com/watch?v=lock-test',
    '{"title":"락 테스트"}'::jsonb,
    '락 테스트 리뷰',
    '카페'
  );

  if coalesce(v_result.success, false) is true then
    raise exception 'expected optimistic lock failure, got %', row_to_json(v_result);
  end if;

  if v_result.message <> '다른 관리자가 이미 데이터를 수정했습니다. 다시 시도해주세요.' then
    raise exception 'unexpected optimistic lock message: %', v_result.message;
  end if;

  select * into v_target
  from public.restaurants
  where id = '33333333-3333-3333-3333-333333333333'::uuid;

  select * into v_source
  from public.restaurants
  where id = '44444444-4444-4444-4444-444444444444'::uuid;

  if v_target.categories <> array['양식']::text[] then
    raise exception 'target row mutated on failed lock check: %', v_target.categories;
  end if;

  if v_source.status <> 'db_conflict' then
    raise exception 'source row mutated on failed lock check: %', v_source.status;
  end if;
end $$;

delete from public.restaurants
where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333',
  '44444444-4444-4444-4444-444444444444'
);
SQL
)

trap 'printf "%s\n" "${cleanup_sql}" | psql_exec >/dev/null' EXIT

echo "[admin-review-merge-rpcs] starting local db"
compose up -d db >/dev/null
wait_for_db

echo "[admin-review-merge-rpcs] ensuring minimal schema prerequisites"
psql_exec <<'SQL'
create extension if not exists pgcrypto;

do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'is_user_admin'
      and pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid'
  ) then
    execute $fn$
      create function public.is_user_admin(p_user_id uuid)
      returns boolean
      language sql
      stable
      as $$ select true; $$;
    $fn$;
  end if;
end $$;
SQL

echo "[admin-review-merge-rpcs] applying schema and rpc migrations"
apply_sql_file "${SUPABASE_DIR}/migrations/20260124_create_restaurants.sql"
apply_sql_file "${SUPABASE_DIR}/migrations/20260410_add_admin_review_merge_rpc.sql"

echo "[admin-review-merge-rpcs] running success + optimistic-lock assertions"
printf "%s\n" "${assert_sql}" | psql_exec

echo "[admin-review-merge-rpcs] PASS"
