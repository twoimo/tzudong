-- Align submission/edit approval RPCs with the active restaurant identity duplicate guard.
-- Also canonicalize stored YouTube links so trace_id / duplicate checks use one video identity.

create or replace function public.canonicalize_youtube_link(raw_url text)
returns text
language sql
immutable
as $$
  select case
    when public.extract_youtube_video_id(raw_url) <> ''
      then 'https://www.youtube.com/watch?v=' || public.extract_youtube_video_id(raw_url)
    else nullif(btrim(raw_url), '')
  end;
$$;

create or replace function public.approve_submission_item(
  p_item_id uuid,
  p_admin_user_id uuid,
  p_restaurant_data jsonb
)
returns table(success boolean, message text, created_restaurant_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_is_admin boolean;
  v_item record;
  v_submission record;
  v_generated_unique_id text;
  v_new_restaurant_id uuid;
  v_role text;
  v_constraint_name text;

  v_name text;
  v_phone text;
  v_categories text[];
  v_tzuyang_review text;
  v_youtube_link text;
  v_youtube_video_id text;
  v_identity_name text;
  v_jibun_address text;
  v_road_address text;
  v_english_address text;
  v_address_elements jsonb;
  v_lat numeric;
  v_lng numeric;
  v_youtube_meta jsonb;
begin
  v_role := current_setting('request.jwt.claim.role', true);
  if v_role is distinct from 'service_role' then
    if auth.uid() is null or auth.uid() <> p_admin_user_id then
      return query select false, '관리자 인증 정보가 일치하지 않습니다.'::text, null::uuid;
      return;
    end if;
  end if;

  select public.is_user_admin(p_admin_user_id) into v_is_admin;
  if not v_is_admin then
    return query select false, '관리자 권한이 필요합니다.'::text, null::uuid;
    return;
  end if;

  select * into v_item
  from public.restaurant_submission_items
  where id = p_item_id and item_status = 'pending';

  if not found then
    return query select false, '처리할 항목이 없거나 이미 처리되었습니다.'::text, null::uuid;
    return;
  end if;

  select * into v_submission
  from public.restaurant_submissions
  where id = v_item.submission_id;

  v_name := nullif(p_restaurant_data->>'name', '');
  v_phone := nullif(p_restaurant_data->>'phone', '');
  v_tzuyang_review := nullif(p_restaurant_data->>'tzuyang_review', '');
  v_youtube_link := public.canonicalize_youtube_link(
    coalesce(nullif(p_restaurant_data->>'youtube_link', ''), v_item.youtube_link)
  );
  v_youtube_video_id := public.extract_youtube_video_id(v_youtube_link);
  v_identity_name := public.normalize_restaurant_identity_name(
    public.resolve_restaurant_identity_name(v_name, null, null, null)
  );
  v_jibun_address := p_restaurant_data->>'jibun_address';
  v_road_address := p_restaurant_data->>'road_address';
  v_english_address := p_restaurant_data->>'english_address';
  v_address_elements := p_restaurant_data->'address_elements';
  v_lat := (p_restaurant_data->>'lat')::numeric;
  v_lng := (p_restaurant_data->>'lng')::numeric;
  v_youtube_meta := coalesce(p_restaurant_data->'youtube_meta', '{}'::jsonb);

  if p_restaurant_data->'categories' is not null and jsonb_typeof(p_restaurant_data->'categories') = 'array' then
    v_categories := array(select jsonb_array_elements_text(p_restaurant_data->'categories'));
    if cardinality(v_categories) = 0 then
      v_categories := null;
    end if;
  else
    v_categories := null;
  end if;

  if v_jibun_address is null or v_lat is null or v_lng is null then
    return query select false, '지오코딩 데이터가 필요합니다 (jibun_address, lat, lng).'::text, null::uuid;
    return;
  end if;

  if v_name is null then
    return query select false, '이름이 없습니다. trace_id 생성 불가'::text, null::uuid;
    return;
  end if;

  if v_youtube_video_id <> '' and v_identity_name is not null and exists (
    select 1
    from public.restaurants r
    where r.status <> 'deleted'
      and public.extract_youtube_video_id(r.youtube_link) = v_youtube_video_id
      and public.normalize_restaurant_identity_name(
        public.resolve_restaurant_identity_name(r.approved_name, r.origin_name, r.naver_name, r.google_name)
      ) = v_identity_name
  ) then
    return query select false, '이미 동일 영상/식당 조합의 active 레코드가 존재합니다.'::text, null::uuid;
    return;
  end if;

  if exists (
    select 1
    from public.restaurants r
    where r.status <> 'deleted'
      and (
        (v_youtube_video_id <> ''
          and public.extract_youtube_video_id(r.youtube_link) = v_youtube_video_id
          and extensions.similarity(coalesce(r.approved_name, r.origin_name, ''), v_name) > 0.8)
        or extensions.similarity(coalesce(r.jibun_address, ''), v_jibun_address) > 0.9
        or extensions.similarity(coalesce(r.road_address, ''), coalesce(v_road_address, '')) > 0.9
      )
  ) then
    return query select false, '이미 등록된 맛집/리뷰입니다 (링크 및 정보 유사).'::text, null::uuid;
    return;
  end if;

  v_generated_unique_id := public.generate_unique_id(
    v_youtube_link,
    v_name,
    v_tzuyang_review
  );

  if v_generated_unique_id is null or v_generated_unique_id = '' then
    return query select false, 'trace_id 생성에 실패했습니다.'::text, null::uuid;
    return;
  end if;

  begin
    insert into public.restaurants (
      trace_id,
      categories,
      phone,
      road_address,
      jibun_address,
      english_address,
      address_elements,
      lat,
      lng,
      youtube_link,
      youtube_meta,
      tzuyang_review,
      status,
      source_type,
      geocoding_success,
      created_by,
      updated_by_admin_id,
      approved_name
    )
    values (
      v_generated_unique_id,
      v_categories,
      v_phone,
      v_road_address,
      v_jibun_address,
      v_english_address,
      coalesce(v_address_elements, '{}'::jsonb),
      v_lat,
      v_lng,
      v_youtube_link,
      coalesce(v_youtube_meta, '{}'::jsonb),
      v_tzuyang_review,
      'approved',
      'user_submission_new',
      true,
      v_submission.user_id,
      p_admin_user_id,
      v_name
    )
    returning id into v_new_restaurant_id;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'idx_restaurants_active_video_identity' then
        return query select false, '이미 동일 영상/식당 조합의 active 레코드가 존재합니다.'::text, null::uuid;
        return;
      elsif v_constraint_name = 'restaurants_trace_id_key' then
        return query select false, '이미 동일 trace_id의 맛집이 존재합니다.'::text, null::uuid;
        return;
      end if;

      return query select false, '이미 동일 영상/식당 조합 또는 trace_id가 존재합니다.'::text, null::uuid;
      return;
  end;

  if v_new_restaurant_id is null then
    return query select false, '음식점 생성/재사용에 실패했습니다.'::text, null::uuid;
    return;
  end if;

  update public.restaurant_submission_items
  set
    item_status = 'approved',
    target_restaurant_id = v_new_restaurant_id
  where id = p_item_id;

  if not found then
    return query select false, 'submission item 업데이트 실패'::text, null::uuid;
    return;
  end if;

  update public.restaurant_submissions
  set
    resolved_by_admin_id = p_admin_user_id,
    reviewed_at = now()
  where id = v_item.submission_id;

  return query select true, '승인이 완료되었습니다.'::text, v_new_restaurant_id;
end;
$$;

create or replace function public.approve_edit_submission_item(
  p_item_id uuid,
  p_admin_user_id uuid,
  p_updated_data jsonb
)
returns table(success boolean, message text, restaurant_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_is_admin boolean;
  v_item record;
  v_submission record;
  v_target_restaurant record;
  v_role text;
  v_constraint_name text;

  v_name text;
  v_phone text;
  v_categories text[];
  v_tzuyang_review text;
  v_youtube_link text;
  v_youtube_video_id text;
  v_identity_name text;
  v_jibun_address text;
  v_road_address text;
  v_english_address text;
  v_address_elements jsonb;
  v_lat numeric;
  v_lng numeric;
  v_youtube_meta jsonb;
begin
  v_role := current_setting('request.jwt.claim.role', true);
  if v_role is distinct from 'service_role' then
    if auth.uid() is null or auth.uid() <> p_admin_user_id then
      return query select false, '관리자 인증 정보가 일치하지 않습니다.'::text, null::uuid;
      return;
    end if;
  end if;

  select public.is_user_admin(p_admin_user_id) into v_is_admin;
  if not v_is_admin then
    return query select false, '관리자 권한이 필요합니다.'::text, null::uuid;
    return;
  end if;

  select * into v_item
  from public.restaurant_submission_items
  where id = p_item_id and item_status = 'pending';

  if not found then
    return query select false, '처리할 항목이 없거나 이미 처리되었습니다.'::text, null::uuid;
    return;
  end if;

  select * into v_submission
  from public.restaurant_submissions
  where id = v_item.submission_id;

  if v_item.target_restaurant_id is null then
    return query select false, '수정 대상 레스토랑 정보가 없습니다.'::text, null::uuid;
    return;
  end if;

  select * into v_target_restaurant
  from public.restaurants
  where id = v_item.target_restaurant_id;

  if not found then
    return query select false, '대상 레스토랑이 존재하지 않습니다.'::text, null::uuid;
    return;
  end if;

  v_name := nullif(p_updated_data->>'name', '');
  v_phone := nullif(p_updated_data->>'phone', '');
  v_tzuyang_review := nullif(p_updated_data->>'tzuyang_review', '');
  v_youtube_link := public.canonicalize_youtube_link(
    coalesce(nullif(p_updated_data->>'youtube_link', ''), v_target_restaurant.youtube_link)
  );
  v_youtube_video_id := public.extract_youtube_video_id(v_youtube_link);
  v_identity_name := public.normalize_restaurant_identity_name(
    public.resolve_restaurant_identity_name(
      coalesce(v_name, v_target_restaurant.approved_name),
      v_target_restaurant.origin_name,
      v_target_restaurant.naver_name,
      v_target_restaurant.google_name
    )
  );
  v_jibun_address := p_updated_data->>'jibun_address';
  v_road_address := p_updated_data->>'road_address';
  v_english_address := p_updated_data->>'english_address';
  v_address_elements := p_updated_data->'address_elements';
  v_lat := (p_updated_data->>'lat')::numeric;
  v_lng := (p_updated_data->>'lng')::numeric;
  v_youtube_meta := coalesce(p_updated_data->'youtube_meta', v_target_restaurant.youtube_meta);

  if p_updated_data->'categories' is not null and jsonb_typeof(p_updated_data->'categories') = 'array' then
    v_categories := array(select jsonb_array_elements_text(p_updated_data->'categories'));
    if cardinality(v_categories) = 0 then
      v_categories := null;
    end if;
  else
    v_categories := null;
  end if;

  if v_jibun_address is null or v_lat is null or v_lng is null then
    return query select false, '지오코딩 데이터가 필요합니다 (jibun_address, lat, lng).'::text, null::uuid;
    return;
  end if;

  if v_youtube_video_id <> '' and v_identity_name is not null and exists (
    select 1
    from public.restaurants r
    where r.id != v_item.target_restaurant_id
      and r.status <> 'deleted'
      and public.extract_youtube_video_id(r.youtube_link) = v_youtube_video_id
      and public.normalize_restaurant_identity_name(
        public.resolve_restaurant_identity_name(r.approved_name, r.origin_name, r.naver_name, r.google_name)
      ) = v_identity_name
  ) then
    return query select false, '이미 동일 영상/식당 조합의 active 레코드가 존재합니다.'::text, null::uuid;
    return;
  end if;

  if exists (
    select 1
    from public.restaurants r
    where r.id != v_item.target_restaurant_id
      and r.status <> 'deleted'
      and (
        (v_youtube_video_id <> ''
          and public.extract_youtube_video_id(r.youtube_link) = v_youtube_video_id
          and extensions.similarity(coalesce(r.approved_name, r.origin_name, ''), coalesce(v_name, v_target_restaurant.approved_name)) > 0.8)
        or extensions.similarity(coalesce(r.jibun_address, ''), v_jibun_address) > 0.9
        or extensions.similarity(coalesce(r.road_address, ''), coalesce(v_road_address, '')) > 0.9
      )
  ) then
    return query select false, '유사한 맛집이 이미 존재합니다. 중복 확인이 필요합니다.'::text, null::uuid;
    return;
  end if;

  begin
    update public.restaurants
    set
      phone = v_phone,
      categories = coalesce(v_categories, categories),
      road_address = coalesce(v_road_address, road_address),
      jibun_address = coalesce(v_jibun_address, jibun_address),
      english_address = coalesce(v_english_address, english_address),
      address_elements = coalesce(v_address_elements, address_elements),
      lat = v_lat,
      lng = v_lng,
      youtube_link = v_youtube_link,
      youtube_meta = coalesce(v_youtube_meta, youtube_meta),
      tzuyang_review = coalesce(v_tzuyang_review, tzuyang_review),
      geocoding_success = true,
      updated_by_admin_id = p_admin_user_id,
      updated_at = now(),
      approved_name = coalesce(v_name, approved_name)
    where id = v_item.target_restaurant_id;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name = 'idx_restaurants_active_video_identity' then
        return query select false, '이미 동일 영상/식당 조합의 active 레코드가 존재합니다.'::text, null::uuid;
        return;
      elsif v_constraint_name = 'restaurants_trace_id_key' then
        return query select false, '이미 동일 trace_id의 맛집이 존재합니다.'::text, null::uuid;
        return;
      end if;

      return query select false, '이미 동일 영상/식당 조합 또는 trace_id가 존재합니다.'::text, null::uuid;
      return;
  end;

  update public.restaurant_submission_items
  set item_status = 'approved'
  where id = p_item_id;

  update public.restaurant_submissions
  set
    resolved_by_admin_id = p_admin_user_id,
    reviewed_at = now()
  where id = v_item.submission_id;

  return query select true, '수정 승인이 완료되었습니다.'::text, v_item.target_restaurant_id;
end;
$$;
