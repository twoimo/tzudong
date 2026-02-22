-- Fix stage flag when syncing approved edit rows into restaurants_backup.
-- geocoding_success = true must keep geocoding_false_stage = NULL.

CREATE OR REPLACE FUNCTION public.approve_edit_submission_item(
  p_item_id uuid,
  p_admin_user_id uuid,
  p_updated_data jsonb
)
RETURNS table(success boolean, message text, restaurant_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
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
BEGIN
  -- [SECURITY] service_role이 아니라면 caller(auth.uid)와 p_admin_user_id가 일치해야 함
  v_role := current_setting('request.jwt.claim.role', true);
  IF v_role IS DISTINCT FROM 'service_role' THEN
    IF auth.uid() IS NULL OR auth.uid() <> p_admin_user_id THEN
      RETURN QUERY SELECT false, '관리자 인증 정보가 일치하지 않습니다.'::text, null::uuid;
      RETURN;
    END IF;
  END IF;

  -- 1. 관리자 권한 확인
  SELECT public.is_user_admin(p_admin_user_id) INTO v_is_admin;
  IF NOT v_is_admin THEN
    RETURN QUERY SELECT false, '관리자 권한이 필요합니다.'::text, null::uuid;
    RETURN;
  END IF;

  -- 2. 항목 조회 (pending 상태만)
  SELECT * INTO v_item
  FROM public.restaurant_submission_items
  WHERE id = p_item_id and item_status = 'pending';

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, '처리할 항목이 없거나 이미 처리되었습니다.'::text, null::uuid;
    RETURN;
  END IF;

  -- 3. 부모 submission 조회
  SELECT * INTO v_submission
  FROM public.restaurant_submissions
  WHERE id = v_item.submission_id;

  -- 4. 수정 대상 레스토랑이 있는지 확인
  IF v_item.target_restaurant_id IS NULL THEN
    RETURN QUERY SELECT false, '수정 대상 레스토랑 정보가 없습니다.'::text, null::uuid;
    RETURN;
  END IF;

  SELECT * INTO v_target_restaurant
  FROM public.restaurants
  WHERE id = v_item.target_restaurant_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, '대상 레스토랑이 존재하지 않습니다.'::text, null::uuid;
    RETURN;
  END IF;

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
  IF p_updated_data->'categories' IS NOT NULL AND jsonb_typeof(p_updated_data->'categories') = 'array' THEN
    v_categories := array(select jsonb_array_elements_text(p_updated_data->'categories'));
    IF cardinality(v_categories) = 0 THEN
      v_categories := NULL;
    END IF;
  ELSE
    v_categories := NULL;
  END IF;

  -- 6. 필수 데이터 검증
  IF v_jibun_address IS NULL OR v_lat IS NULL OR v_lng IS NULL THEN
    RETURN QUERY SELECT false, '지오코딩 데이터가 필요합니다 (jibun_address, lat, lng).'::text, null::uuid;
    RETURN;
  END IF;

  -- 7. 중복 검사 (자기 자신 제외)
  IF EXISTS (
    SELECT 1
    FROM public.restaurants r
    WHERE r.id != v_item.target_restaurant_id
      AND (
        (r.youtube_link = v_youtube_link and extensions.similarity(r.approved_name, v_name) > 0.8)
        OR extensions.similarity(coalesce(r.jibun_address, ''), v_jibun_address) > 0.9
        OR extensions.similarity(coalesce(r.road_address, ''), coalesce(v_road_address, '')) > 0.9
      )
  ) THEN
    RETURN QUERY SELECT false, '유사한 맛집이 이미 존재합니다. 중복 확인이 필요합니다.'::text, null::uuid;
    RETURN;
  END IF;

  -- 8. restaurants 테이블 업데이트
  UPDATE public.restaurants
  SET
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
    updated_at = NOW(),
    approved_name = coalesce(v_name, approved_name)
  WHERE id = v_item.target_restaurant_id;

  -- 8b. restaurants_backup 동기화 (ID 매핑 동일)
  INSERT INTO public.restaurants_backup (
    id,
    name,
    phone,
    categories,
    lat,
    lng,
    road_address,
    jibun_address,
    english_address,
    address_elements,
    origin_address,
    youtube_meta,
    unique_id,
    reasoning_basis,
    evaluation_results,
    source_type,
    geocoding_success,
    geocoding_false_stage,
    status,
    is_missing,
    is_not_selected,
    review_count,
    created_by,
    updated_by_admin_id,
    tzuyang_review,
    youtube_link
  )
  VALUES (
    v_target_restaurant.id,
    coalesce(v_name, v_target_restaurant.approved_name),
    coalesce(v_phone, v_target_restaurant.phone),
    coalesce(v_categories, v_target_restaurant.categories),
    v_lat,
    v_lng,
    coalesce(v_road_address, v_target_restaurant.road_address),
    coalesce(v_jibun_address, v_target_restaurant.jibun_address),
    coalesce(v_english_address, v_target_restaurant.english_address),
    coalesce(v_address_elements, v_target_restaurant.address_elements),
    coalesce(v_target_restaurant.origin_address, '{}'::jsonb),
    coalesce(v_youtube_meta, v_target_restaurant.youtube_meta),
    v_target_restaurant.trace_id,
    v_target_restaurant.reasoning_basis,
    v_target_restaurant.evaluation_results,
    v_target_restaurant.source_type,
    true,
    NULL,
    v_target_restaurant.status,
    coalesce(v_target_restaurant.is_missing, false),
    coalesce(v_target_restaurant.is_not_selected, false),
    coalesce(v_target_restaurant.review_count, 0),
    v_target_restaurant.created_by,
    p_admin_user_id,
    coalesce(v_tzuyang_review, v_target_restaurant.tzuyang_review),
    v_youtube_link
  )
  ON CONFLICT (id)
  DO UPDATE SET
    name = EXCLUDED.name,
    phone = EXCLUDED.phone,
    categories = EXCLUDED.categories,
    lat = EXCLUDED.lat,
    lng = EXCLUDED.lng,
    road_address = EXCLUDED.road_address,
    jibun_address = EXCLUDED.jibun_address,
    english_address = EXCLUDED.english_address,
    address_elements = EXCLUDED.address_elements,
    origin_address = EXCLUDED.origin_address,
    youtube_meta = EXCLUDED.youtube_meta,
    unique_id = EXCLUDED.unique_id,
    reasoning_basis = EXCLUDED.reasoning_basis,
    evaluation_results = EXCLUDED.evaluation_results,
    source_type = EXCLUDED.source_type,
    geocoding_success = EXCLUDED.geocoding_success,
    geocoding_false_stage = CASE WHEN EXCLUDED.geocoding_success THEN NULL ELSE EXCLUDED.geocoding_false_stage END,
    status = EXCLUDED.status,
    is_missing = EXCLUDED.is_missing,
    is_not_selected = EXCLUDED.is_not_selected,
    review_count = EXCLUDED.review_count,
    created_by = EXCLUDED.created_by,
    updated_by_admin_id = EXCLUDED.updated_by_admin_id,
    tzuyang_review = EXCLUDED.tzuyang_review,
    youtube_link = EXCLUDED.youtube_link,
    updated_at = NOW();

  -- 9. 항목 상태 업데이트
  UPDATE public.restaurant_submission_items
  SET item_status = 'approved'
  WHERE id = p_item_id;

  -- 10. 부모 submission 업데이트
  UPDATE public.restaurant_submissions
  SET
    resolved_by_admin_id = p_admin_user_id,
    reviewed_at = NOW()
  WHERE id = v_item.submission_id;

  -- 11. 성공 반환
  RETURN QUERY SELECT true, '수정 승인이 완료되었습니다.'::text, v_item.target_restaurant_id;
END;
$$;