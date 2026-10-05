-- Add an atomic admin-review merge RPC for the two /admin/evaluations merge flows.

create or replace function public.merge_restaurant_records_for_admin_review(
  p_target_restaurant_id uuid,
  p_source_restaurant_id uuid,
  p_admin_user_id uuid,
  p_expected_target_updated_at timestamptz,
  p_new_youtube_link text default null,
  p_new_youtube_meta jsonb default null,
  p_new_tzuyang_review text default null,
  p_new_category text default null
)
returns table(
  success boolean,
  message text,
  target_restaurant_id uuid,
  source_restaurant_id uuid
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_is_admin boolean;
  v_role text;
  v_now timestamptz := now();
  v_target_restaurant public.restaurants%rowtype;
  v_source_restaurant public.restaurants%rowtype;
  v_target_categories text[];
  v_updated_youtube_link text;
  v_updated_youtube_meta jsonb;
  v_updated_tzuyang_review text;
  v_new_category text := nullif(p_new_category, '');
begin
  v_role := current_setting('request.jwt.claim.role', true);
  if v_role is distinct from 'service_role' then
    if auth.uid() is null or auth.uid() <> p_admin_user_id then
      return query select false, '관리자 인증 정보가 일치하지 않습니다.'::text, null::uuid, null::uuid;
      return;
    end if;
  end if;

  select public.is_user_admin(p_admin_user_id) into v_is_admin;
  if not v_is_admin then
    return query select false, '관리자 권한이 필요합니다.'::text, null::uuid, null::uuid;
    return;
  end if;

  if p_target_restaurant_id is null or p_source_restaurant_id is null then
    return query select false, '병합 대상과 원본 레스토랑 정보가 필요합니다.'::text, null::uuid, null::uuid;
    return;
  end if;

  if p_target_restaurant_id = p_source_restaurant_id then
    return query select false, '병합 대상과 원본 레스토랑이 동일합니다.'::text, null::uuid, null::uuid;
    return;
  end if;

  if p_expected_target_updated_at is null then
    return query select false, '병합 대상 레스토랑의 최신 수정 시각이 필요합니다.'::text, null::uuid, null::uuid;
    return;
  end if;

  select *
  into v_target_restaurant
  from public.restaurants
  where id = p_target_restaurant_id
  for update;

  if not found then
    return query select false, '병합 대상 레스토랑을 찾을 수 없습니다.'::text, null::uuid, null::uuid;
    return;
  end if;

  select *
  into v_source_restaurant
  from public.restaurants
  where id = p_source_restaurant_id
  for update;

  if not found then
    return query select false, '병합 원본 레스토랑을 찾을 수 없습니다.'::text, null::uuid, null::uuid;
    return;
  end if;

  if v_source_restaurant.status = 'deleted' then
    return query select false, '이미 처리된 레코드입니다.'::text, null::uuid, null::uuid;
    return;
  end if;

  if v_target_restaurant.updated_at is distinct from p_expected_target_updated_at then
    return query select false, '다른 관리자가 이미 데이터를 수정했습니다. 다시 시도해주세요.'::text, null::uuid, null::uuid;
    return;
  end if;

  v_updated_youtube_link := coalesce(
    nullif(v_target_restaurant.youtube_link, ''),
    nullif(p_new_youtube_link, '')
  );
  v_updated_youtube_meta := coalesce(v_target_restaurant.youtube_meta, p_new_youtube_meta);
  v_updated_tzuyang_review := coalesce(
    nullif(v_target_restaurant.tzuyang_review, ''),
    nullif(p_new_tzuyang_review, '')
  );
  v_target_categories := v_target_restaurant.categories;

  if v_new_category is not null then
    if v_target_categories is null then
      v_target_categories := array[v_new_category];
    elsif not (v_new_category = any(v_target_categories)) then
      v_target_categories := array_append(v_target_categories, v_new_category);
    end if;
  end if;

  update public.restaurants
  set
    youtube_link = v_updated_youtube_link,
    youtube_meta = v_updated_youtube_meta,
    tzuyang_review = v_updated_tzuyang_review,
    categories = v_target_categories,
    updated_by_admin_id = p_admin_user_id,
    updated_at = v_now
  where id = p_target_restaurant_id;

  if not found then
    return query select false, '병합 대상 업데이트에 실패했습니다.'::text, null::uuid, null::uuid;
    return;
  end if;

  update public.restaurants
  set
    status = 'deleted',
    updated_by_admin_id = p_admin_user_id,
    updated_at = v_now,
    db_error_message = null,
    db_error_details = null
  where id = p_source_restaurant_id;

  if not found then
    return query select false, '원본 레코드 상태 업데이트에 실패했습니다.'::text, null::uuid, null::uuid;
    return;
  end if;

  return query select true, '병합이 완료되었습니다.'::text, p_target_restaurant_id, p_source_restaurant_id;
end;
$$;

revoke all on function public.merge_restaurant_records_for_admin_review(uuid, uuid, uuid, timestamptz, text, jsonb, text, text) from public;
revoke all on function public.merge_restaurant_records_for_admin_review(uuid, uuid, uuid, timestamptz, text, jsonb, text, text) from anon;
grant execute on function public.merge_restaurant_records_for_admin_review(uuid, uuid, uuid, timestamptz, text, jsonb, text, text) to authenticated;
grant execute on function public.merge_restaurant_records_for_admin_review(uuid, uuid, uuid, timestamptz, text, jsonb, text, text) to service_role;
