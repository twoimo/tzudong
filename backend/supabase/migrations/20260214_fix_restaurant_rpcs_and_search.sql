-- Fix schema drift: public.restaurants uses trace_id / approved_name, but some RPC/functions
-- still reference legacy columns (unique_id/name). Also harden admin RPCs to prevent
-- spoofing p_admin_user_id by validating auth.uid() (except service_role).

-- 1) Admin: 신규 제보 항목 승인
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

  -- 관리자가 모달에서 입력한 최종 데이터
  v_name text;
  v_phone text;
  v_categories text[];
  v_tzuyang_review text;
  v_youtube_link text; -- 관리자 수정 가능
  v_jibun_address text;
  v_road_address text;
  v_english_address text;
  v_address_elements jsonb;
  v_lat numeric;
  v_lng numeric;
  v_youtube_meta jsonb;
begin
  -- [SECURITY] service_role이 아니라면 caller(auth.uid)와 p_admin_user_id가 일치해야 함
  v_role := current_setting('request.jwt.claim.role', true);
  if v_role is distinct from 'service_role' then
    if auth.uid() is null or auth.uid() <> p_admin_user_id then
      return query select false, '관리자 인증 정보가 일치하지 않습니다.'::text, null::uuid;
      return;
    end if;
  end if;

  -- 1. 관리자 권한 확인
  select public.is_user_admin(p_admin_user_id) into v_is_admin;
  if not v_is_admin then
    return query select false, '관리자 권한이 필요합니다.'::text, null::uuid;
    return;
  end if;

  -- 2. 항목 조회 (pending 상태만)
  select * into v_item
  from public.restaurant_submission_items
  where id = p_item_id and item_status = 'pending';

  if not found then
    return query select false, '처리할 항목이 없거나 이미 처리되었습니다.'::text, null::uuid;
    return;
  end if;

  -- 3. 부모 submission 조회
  select * into v_submission
  from public.restaurant_submissions
  where id = v_item.submission_id;

  -- 4. 모달에서 최종 입력된 데이터 추출 (관리자 수정 데이터)
  v_name := nullif(p_restaurant_data->>'name', '');
  v_phone := nullif(p_restaurant_data->>'phone', '');
  v_tzuyang_review := nullif(p_restaurant_data->>'tzuyang_review', '');

  -- youtube_link: 관리자가 수정한 값 사용, 없으면 원본 사용
  v_youtube_link := coalesce(nullif(p_restaurant_data->>'youtube_link', ''), v_item.youtube_link);

  v_jibun_address := p_restaurant_data->>'jibun_address';
  v_road_address := p_restaurant_data->>'road_address';
  v_english_address := p_restaurant_data->>'english_address';
  v_address_elements := p_restaurant_data->'address_elements';
  v_lat := (p_restaurant_data->>'lat')::numeric;
  v_lng := (p_restaurant_data->>'lng')::numeric;
  v_youtube_meta := coalesce(p_restaurant_data->'youtube_meta', '{}'::jsonb);

  -- 카테고리 배열 변환
  if p_restaurant_data->'categories' is not null and jsonb_typeof(p_restaurant_data->'categories') = 'array' then
    v_categories := array(select jsonb_array_elements_text(p_restaurant_data->'categories'));
    if cardinality(v_categories) = 0 then
      v_categories := null;
    end if;
  else
    v_categories := null;
  end if;

  -- 5. 필수 데이터 검증
  if v_jibun_address is null or v_lat is null or v_lng is null then
    return query select false, '지오코딩 데이터가 필요합니다 (jibun_address, lat, lng).'::text, null::uuid;
    return;
  end if;

  -- 6. trace_id 생성 (파이프라인 규칙: youtube_link + name + tzuyang_review)
  if v_name is null then
    return query select false, '이름이 없습니다. trace_id 생성 불가'::text, null::uuid;
    return;
  end if;

  v_generated_unique_id := public.generate_unique_id(
    v_youtube_link, -- 관리자가 수정한 값 사용
    v_name,
    v_tzuyang_review
  );

  if v_generated_unique_id is null or v_generated_unique_id = '' then
    return query select false, 'trace_id 생성에 실패했습니다.'::text, null::uuid;
    return;
  end if;

  -- 7. 중복 검사 (같은 youtube_link + 유사한 이름/주소)
  -- 링크가 다르면 다른 리뷰로 간주하여 승인 가능
  if exists (
    select 1
    from public.restaurants r
    where r.youtube_link = v_youtube_link
      and (
        extensions.similarity(r.approved_name, v_name) > 0.8
        or extensions.similarity(coalesce(r.jibun_address, ''), v_jibun_address) > 0.9
        or extensions.similarity(coalesce(r.road_address, ''), coalesce(v_road_address, '')) > 0.9
      )
  ) then
    return query select false, '이미 등록된 맛집/리뷰입니다 (링크 및 정보 유사).'::text, null::uuid;
    return;
  end if;

  -- 8. restaurants 테이블에 INSERT (trace_id 중복 시 승인 거부)
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
      return query select false, '이미 동일 trace_id의 맛집이 존재합니다.'::text, null::uuid;
      return;
  end;

  if v_new_restaurant_id is null then
    return query select false, '음식점 생성/재사용에 실패했습니다.'::text, null::uuid;
    return;
  end if;

  -- 9. 항목 상태 업데이트 (target_restaurant_id만 설정)
  update public.restaurant_submission_items
  set
    item_status = 'approved',
    target_restaurant_id = v_new_restaurant_id
  where id = p_item_id;

  if not found then
    return query select false, 'submission item 업데이트 실패'::text, null::uuid;
    return;
  end if;

  -- 10. 부모 submission 업데이트 (reviewed_at, resolved_by_admin_id)
  update public.restaurant_submissions
  set
    resolved_by_admin_id = p_admin_user_id,
    reviewed_at = now()
  where id = v_item.submission_id;

  -- 11. 성공 반환
  return query select true, '승인이 완료되었습니다.'::text, v_new_restaurant_id;
end;
$$;

-- 2) Admin: 수정 제보 항목 승인 (SECURITY 하드닝만)
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

  -- 관리자가 모달에서 입력한 최종 데이터
  v_name text;
  v_phone text;
  v_categories text[];
  v_tzuyang_review text;
  v_youtube_link text;
  v_jibun_address text;
  v_road_address text;
  v_english_address text;
  v_address_elements jsonb;
  v_lat numeric;
  v_lng numeric;
  v_youtube_meta jsonb;
begin
  -- [SECURITY] service_role이 아니라면 caller(auth.uid)와 p_admin_user_id가 일치해야 함
  v_role := current_setting('request.jwt.claim.role', true);
  if v_role is distinct from 'service_role' then
    if auth.uid() is null or auth.uid() <> p_admin_user_id then
      return query select false, '관리자 인증 정보가 일치하지 않습니다.'::text, null::uuid;
      return;
    end if;
  end if;

  -- 1. 관리자 권한 확인
  select public.is_user_admin(p_admin_user_id) into v_is_admin;
  if not v_is_admin then
    return query select false, '관리자 권한이 필요합니다.'::text, null::uuid;
    return;
  end if;

  -- 2. 항목 조회 (pending 상태만)
  select * into v_item
  from public.restaurant_submission_items
  where id = p_item_id and item_status = 'pending';

  if not found then
    return query select false, '처리할 항목이 없거나 이미 처리되었습니다.'::text, null::uuid;
    return;
  end if;

  -- 3. 부모 submission 조회
  select * into v_submission
  from public.restaurant_submissions
  where id = v_item.submission_id;

  -- 4. 수정 대상 레스토랑이 있는지 확인
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

  -- 5. 모달에서 최종 입력된 데이터 추출
  v_name := nullif(p_updated_data->>'name', '');
  v_phone := nullif(p_updated_data->>'phone', '');
  v_tzuyang_review := nullif(p_updated_data->>'tzuyang_review', '');

  -- youtube_link: 관리자가 수정한 값 사용, 없으면 원본 유지
  v_youtube_link := coalesce(nullif(p_updated_data->>'youtube_link', ''), v_target_restaurant.youtube_link);

  v_jibun_address := p_updated_data->>'jibun_address';
  v_road_address := p_updated_data->>'road_address';
  v_english_address := p_updated_data->>'english_address';
  v_address_elements := p_updated_data->'address_elements';
  v_lat := (p_updated_data->>'lat')::numeric;
  v_lng := (p_updated_data->>'lng')::numeric;
  v_youtube_meta := coalesce(p_updated_data->'youtube_meta', v_target_restaurant.youtube_meta);

  -- 카테고리 배열 변환
  if p_updated_data->'categories' is not null and jsonb_typeof(p_updated_data->'categories') = 'array' then
    v_categories := array(select jsonb_array_elements_text(p_updated_data->'categories'));
    if cardinality(v_categories) = 0 then
      v_categories := null;
    end if;
  else
    v_categories := null;
  end if;

  -- 6. 필수 데이터 검증
  if v_jibun_address is null or v_lat is null or v_lng is null then
    return query select false, '지오코딩 데이터가 필요합니다 (jibun_address, lat, lng).'::text, null::uuid;
    return;
  end if;

  -- 7. 중복 검사 (자기 자신 제외)
  if exists (
    select 1
    from public.restaurants r
    where r.id != v_item.target_restaurant_id
      and (
        (r.youtube_link = v_youtube_link and extensions.similarity(r.approved_name, v_name) > 0.8)
        or extensions.similarity(coalesce(r.jibun_address, ''), v_jibun_address) > 0.9
        or extensions.similarity(coalesce(r.road_address, ''), coalesce(v_road_address, '')) > 0.9
      )
  ) then
    return query select false, '유사한 맛집이 이미 존재합니다. 중복 확인이 필요합니다.'::text, null::uuid;
    return;
  end if;

  -- 8. restaurants 테이블 업데이트
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

  -- 9. 항목 상태 업데이트
  update public.restaurant_submission_items
  set item_status = 'approved'
  where id = p_item_id;

  -- 10. 부모 submission 업데이트
  update public.restaurant_submissions
  set
    resolved_by_admin_id = p_admin_user_id,
    reviewed_at = now()
  where id = v_item.submission_id;

  -- 11. 성공 반환
  return query select true, '수정 승인이 완료되었습니다.'::text, v_item.target_restaurant_id;
end;
$$;

-- 3) Search RPC: restaurants.name -> restaurants.approved_name
create or replace function public.search_restaurants(
  search_query text,
  search_categories text[] default null::text[],
  max_results integer default 50,
  similarity_threshold real default 0.1
)
returns table(
  id uuid,
  name text,
  categories text[],
  road_address text,
  jibun_address text,
  lat numeric,
  lng numeric,
  review_count integer,
  similarity real,
  edit_distance integer
)
language plpgsql
stable
security definer
set search_path to 'public', 'extensions'
as $$
begin
  return query
  select
    r.id,
    r.approved_name as name,
    r.categories,
    r.road_address,
    r.jibun_address,
    r.lat,
    r.lng,
    r.review_count,
    greatest(
      similarity(coalesce(r.approved_name, ''), search_query),
      similarity(coalesce(r.road_address, ''), search_query),
      similarity(coalesce(r.jibun_address, ''), search_query)
    ) as similarity,
    levenshtein(coalesce(r.approved_name, ''), search_query) as edit_distance
  from public.restaurants r
  where
    (search_categories is null or r.categories && search_categories)
    and coalesce(r.approved_name, '') <> ''
    and greatest(
      similarity(coalesce(r.approved_name, ''), search_query),
      similarity(coalesce(r.road_address, ''), search_query),
      similarity(coalesce(r.jibun_address, ''), search_query)
    ) > similarity_threshold
  order by
    edit_distance asc,
    similarity desc,
    r.review_count desc
  limit max_results;
end;
$$;

create or replace function public.search_restaurants_by_name(
  search_query text,
  search_categories text[] default null::text[],
  max_results integer default 50,
  include_all_status boolean default false,
  korean_only boolean default false
)
returns table(
  id uuid,
  name text,
  road_address text,
  jibun_address text,
  phone text,
  categories text[],
  youtube_link text,
  tzuyang_review text,
  lat numeric,
  lng numeric,
  status text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  english_address text,
  youtube_meta jsonb,
  complete_match_score integer,
  word_match_score double precision,
  trigram_similarity real,
  levenshtein_distance integer
)
language plpgsql
stable
set search_path to 'public'
as $$
declare
  clean_search_query text;
begin
  clean_search_query := trim(search_query);
  if clean_search_query = '' then
    return;
  end if;

  return query
  select
    r.id,
    r.approved_name as name,
    r.road_address,
    r.jibun_address,
    r.phone,
    r.categories,
    r.youtube_link,
    r.tzuyang_review,
    r.lat,
    r.lng,
    r.status,
    r.created_at,
    r.updated_at,
    r.english_address,
    r.youtube_meta,
    case
      when lower(r.approved_name) like '%' || lower(clean_search_query) || '%' then 1
      else 0
    end as complete_match_score,
    calculate_word_match_score(r.approved_name, clean_search_query) as word_match_score,
    extensions.similarity(
      replace(lower(r.approved_name), ' ', ''),
      replace(lower(clean_search_query), ' ', '')
    ) as trigram_similarity,
    extensions.levenshtein(
      lower(r.approved_name),
      lower(clean_search_query)
    ) as levenshtein_distance
  from public.restaurants r
  where
    (include_all_status = true or r.status = 'approved')
    and (search_categories is null or r.categories && search_categories)
    and r.approved_name is not null
    and r.approved_name != ''
    and (
      korean_only = false
      or coalesce(r.road_address, r.jibun_address, r.english_address, '') ~ '(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|충청북도|충청남도|전북특별자치도|전라남도|경상북도|경상남도|제주특별자치도)'
    )
    and exists (
      select 1
      from unnest(string_to_array(lower(clean_search_query), null)) as query_char
      where query_char != '' and lower(r.approved_name) like '%' || query_char || '%'
    )
  order by
    case when lower(r.approved_name) like '%' || lower(clean_search_query) || '%' then 0 else 1 end,
    word_match_score desc,
    trigram_similarity desc,
    levenshtein_distance asc,
    length(r.approved_name) asc
  limit max_results;
end;
$$;

-- Principle of least privilege: admin RPCs should not be callable by anon
revoke all on function public.approve_submission_item(uuid, uuid, jsonb) from anon;
revoke all on function public.approve_edit_submission_item(uuid, uuid, jsonb) from anon;

grant execute on function public.approve_submission_item(uuid, uuid, jsonb) to authenticated;
grant execute on function public.approve_submission_item(uuid, uuid, jsonb) to service_role;
grant execute on function public.approve_edit_submission_item(uuid, uuid, jsonb) to authenticated;
grant execute on function public.approve_edit_submission_item(uuid, uuid, jsonb) to service_role;
