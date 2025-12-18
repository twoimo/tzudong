-- RPC 함수 수정: youtube_link도 관리자가 수정한 값 사용
-- 기존 함수 제거 후 재생성

-- ========================================
-- 1. 신규 제보 승인 함수 (NEW) - youtube_link 지원 추가
-- ========================================
CREATE OR REPLACE FUNCTION public.approve_submission_item(
    p_item_id UUID,
    p_admin_user_id UUID,
    p_restaurant_data JSONB  -- 관리자 모달에서 최종 입력된 데이터
    -- { jibun_address, road_address, english_address, address_elements, lat, lng, 
    --   youtube_meta, name, phone, categories, tzuyang_review, youtube_link }
)
RETURNS TABLE(
    success BOOLEAN,
    message TEXT,
    created_restaurant_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_is_admin BOOLEAN;
    v_item RECORD;
    v_submission RECORD;
    v_generated_unique_id TEXT;
    v_new_restaurant_id UUID;
    
    -- 관리자가 모달에서 입력한 최종 데이터
    v_name TEXT;
    v_phone TEXT;
    v_categories TEXT[];
    v_tzuyang_review TEXT;
    v_youtube_link TEXT;  -- 관리자 수정 가능
    v_jibun_address TEXT;
    v_road_address TEXT;
    v_english_address TEXT;
    v_address_elements JSONB;
    v_lat NUMERIC;
    v_lng NUMERIC;
    v_youtube_meta JSONB;
BEGIN
    -- 1. 관리자 권한 확인
    SELECT public.is_user_admin(p_admin_user_id) INTO v_is_admin;
    IF NOT v_is_admin THEN
        RETURN QUERY SELECT FALSE, '관리자 권한이 필요합니다.'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- 2. 항목 조회 (pending 상태만)
    SELECT * INTO v_item
    FROM public.restaurant_submission_items
    WHERE id = p_item_id AND item_status = 'pending';

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, '처리할 항목이 없거나 이미 처리되었습니다.'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- 3. 부모 submission 조회
    SELECT * INTO v_submission
    FROM public.restaurant_submissions
    WHERE id = v_item.submission_id;

    -- 4. 모달에서 최종 입력된 데이터 추출 (관리자 수정 데이터)
    v_name := NULLIF(p_restaurant_data->>'name', '');
    v_phone := NULLIF(p_restaurant_data->>'phone', '');
    v_tzuyang_review := NULLIF(p_restaurant_data->>'tzuyang_review', '');
    -- youtube_link: 관리자가 수정한 값 사용, 없으면 원본 사용
    v_youtube_link := COALESCE(NULLIF(p_restaurant_data->>'youtube_link', ''), v_item.youtube_link);
    v_jibun_address := p_restaurant_data->>'jibun_address';
    v_road_address := p_restaurant_data->>'road_address';
    v_english_address := p_restaurant_data->>'english_address';
    v_address_elements := p_restaurant_data->'address_elements';
    v_lat := (p_restaurant_data->>'lat')::NUMERIC;
    v_lng := (p_restaurant_data->>'lng')::NUMERIC;
    v_youtube_meta := COALESCE(p_restaurant_data->'youtube_meta', '{}'::JSONB);
    
    -- 카테고리 배열 변환
    IF p_restaurant_data->'categories' IS NOT NULL AND jsonb_typeof(p_restaurant_data->'categories') = 'array' THEN
        v_categories := ARRAY(
            SELECT jsonb_array_elements_text(p_restaurant_data->'categories')
        );
        IF cardinality(v_categories) = 0 THEN
            v_categories := NULL;
        END IF;
    ELSE
        v_categories := NULL;
    END IF;

    -- 5. 필수 데이터 검증
    IF v_jibun_address IS NULL OR v_lat IS NULL OR v_lng IS NULL THEN
        RETURN QUERY SELECT FALSE, '지오코딩 데이터가 필요합니다 (jibun_address, lat, lng).'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- 6. unique_id 생성 (파이프라인 규칙: youtube_link + name + tzuyang_review)
    IF v_name IS NULL THEN
        RETURN QUERY SELECT FALSE, '이름이 없습니다. unique_id 생성 불가'::TEXT, NULL::UUID;
        RETURN;
    END IF;
    v_generated_unique_id := public.generate_unique_id(
        v_youtube_link,  -- 관리자가 수정한 값 사용
        v_name,
        v_tzuyang_review
    );
    IF v_generated_unique_id IS NULL OR v_generated_unique_id = '' THEN
        RETURN QUERY SELECT FALSE, 'unique_id 생성에 실패했습니다.'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- 7. 중복 검사 (같은 youtube_link + 유사한 이름/주소)
    -- 링크가 다르면 다른 리뷰로 간주하여 승인 가능
    IF EXISTS (
        SELECT 1 FROM public.restaurants r
        WHERE r.youtube_link = v_youtube_link
        AND (
            extensions.similarity(r.name, v_name) > 0.8
            OR extensions.similarity(COALESCE(r.jibun_address, ''), v_jibun_address) > 0.9
            OR extensions.similarity(COALESCE(r.road_address, ''), COALESCE(v_road_address, '')) > 0.9
        )
    ) THEN
        RETURN QUERY SELECT FALSE, '이미 등록된 맛집/리뷰입니다 (링크 및 정보 유사).'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- 8. restaurants 테이블에 INSERT (unique_id 중복 시 승인 거부)
    BEGIN
        INSERT INTO public.restaurants (
            unique_id,
            name,
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
            updated_by_admin_id
        )
        VALUES (
            v_generated_unique_id,
            v_name,
            v_categories,
            v_phone,
            v_road_address,
            v_jibun_address,
            v_english_address,
            COALESCE(v_address_elements, '{}'::JSONB),
            v_lat,
            v_lng,
            v_youtube_link,  -- 관리자가 수정한 값 사용
            COALESCE(v_youtube_meta, '{}'::JSONB),
            v_tzuyang_review,
            'approved',
            'user_submission_new',
            TRUE,
            v_submission.user_id,
            p_admin_user_id
        )
        RETURNING id INTO v_new_restaurant_id;
    EXCEPTION
        WHEN unique_violation THEN
            RETURN QUERY SELECT FALSE, '이미 동일 unique_id의 맛집이 존재합니다.'::TEXT, NULL::UUID;
            RETURN;
    END;

    IF v_new_restaurant_id IS NULL THEN
        RETURN QUERY SELECT FALSE, '음식점 생성/재사용에 실패했습니다.'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- 9. 항목 상태 업데이트 (target_restaurant_id만 설정)
    UPDATE public.restaurant_submission_items
    SET 
        item_status = 'approved',
        target_restaurant_id = v_new_restaurant_id
    WHERE id = p_item_id;
    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'submission item 업데이트 실패'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- 10. 부모 submission 업데이트 (reviewed_at, resolved_by_admin_id)
    UPDATE public.restaurant_submissions
    SET
        resolved_by_admin_id = p_admin_user_id,
        reviewed_at = NOW()
    WHERE id = v_item.submission_id;

    -- 11. 성공 반환
    RETURN QUERY SELECT TRUE, '승인이 완료되었습니다.'::TEXT, v_new_restaurant_id;
END;
$$;

COMMENT ON FUNCTION public.approve_submission_item IS '신규 제보 항목 승인 - 관리자가 수정한 모든 값(youtube_link 포함) 사용';


-- ========================================
-- 2. 수정 제보 승인 함수 (EDIT) - youtube_link 지원 추가
-- ========================================
CREATE OR REPLACE FUNCTION public.approve_edit_submission_item(
    p_item_id UUID,
    p_admin_user_id UUID,
    p_updated_data JSONB  -- 관리자 모달에서 최종 수정된 데이터
)
RETURNS TABLE(
    success BOOLEAN,
    message TEXT,
    restaurant_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_is_admin BOOLEAN;
    v_item RECORD;
    v_submission RECORD;
    v_target_restaurant RECORD;
    
    -- 관리자가 모달에서 입력한 최종 데이터
    v_name TEXT;
    v_phone TEXT;
    v_categories TEXT[];
    v_tzuyang_review TEXT;
    v_youtube_link TEXT;
    v_jibun_address TEXT;
    v_road_address TEXT;
    v_english_address TEXT;
    v_address_elements JSONB;
    v_lat NUMERIC;
    v_lng NUMERIC;
    v_youtube_meta JSONB;
BEGIN
    -- 1. 관리자 권한 확인
    SELECT public.is_user_admin(p_admin_user_id) INTO v_is_admin;
    IF NOT v_is_admin THEN
        RETURN QUERY SELECT FALSE, '관리자 권한이 필요합니다.'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- 2. 항목 조회 (pending 상태만)
    SELECT * INTO v_item
    FROM public.restaurant_submission_items
    WHERE id = p_item_id AND item_status = 'pending';

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, '처리할 항목이 없거나 이미 처리되었습니다.'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- 3. 부모 submission 조회
    SELECT * INTO v_submission
    FROM public.restaurant_submissions
    WHERE id = v_item.submission_id;

    -- 4. 수정 대상 레스토랑이 있는지 확인
    IF v_item.target_restaurant_id IS NULL THEN
        RETURN QUERY SELECT FALSE, '수정 대상 레스토랑 정보가 없습니다.'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    SELECT * INTO v_target_restaurant
    FROM public.restaurants
    WHERE id = v_item.target_restaurant_id;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, '대상 레스토랑이 존재하지 않습니다.'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- 5. 모달에서 최종 입력된 데이터 추출
    v_name := NULLIF(p_updated_data->>'name', '');
    v_phone := NULLIF(p_updated_data->>'phone', '');
    v_tzuyang_review := NULLIF(p_updated_data->>'tzuyang_review', '');
    -- youtube_link: 관리자가 수정한 값 사용, 없으면 원본 유지
    v_youtube_link := COALESCE(NULLIF(p_updated_data->>'youtube_link', ''), v_target_restaurant.youtube_link);
    v_jibun_address := p_updated_data->>'jibun_address';
    v_road_address := p_updated_data->>'road_address';
    v_english_address := p_updated_data->>'english_address';
    v_address_elements := p_updated_data->'address_elements';
    v_lat := (p_updated_data->>'lat')::NUMERIC;
    v_lng := (p_updated_data->>'lng')::NUMERIC;
    v_youtube_meta := COALESCE(p_updated_data->'youtube_meta', v_target_restaurant.youtube_meta);
    
    -- 카테고리 배열 변환
    IF p_updated_data->'categories' IS NOT NULL AND jsonb_typeof(p_updated_data->'categories') = 'array' THEN
        v_categories := ARRAY(
            SELECT jsonb_array_elements_text(p_updated_data->'categories')
        );
        IF cardinality(v_categories) = 0 THEN
            v_categories := NULL;
        END IF;
    ELSE
        v_categories := NULL;
    END IF;

    -- 6. 필수 데이터 검증
    IF v_jibun_address IS NULL OR v_lat IS NULL OR v_lng IS NULL THEN
        RETURN QUERY SELECT FALSE, '지오코딩 데이터가 필요합니다 (jibun_address, lat, lng).'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- 7. 중복 검사 (자기 자신 제외)
    IF EXISTS (
        SELECT 1 FROM public.restaurants r
        WHERE r.id != v_item.target_restaurant_id
        AND (
            (r.youtube_link = v_youtube_link AND extensions.similarity(r.name, v_name) > 0.8)
            OR extensions.similarity(COALESCE(r.jibun_address, ''), v_jibun_address) > 0.9
            OR extensions.similarity(COALESCE(r.road_address, ''), COALESCE(v_road_address, '')) > 0.9
        )
    ) THEN
        RETURN QUERY SELECT FALSE, '유사한 맛집이 이미 존재합니다. 중복 확인이 필요합니다.'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- 8. restaurants 테이블 업데이트
    UPDATE public.restaurants
    SET
        name = COALESCE(v_name, name),
        phone = v_phone,
        categories = COALESCE(v_categories, categories),
        road_address = COALESCE(v_road_address, road_address),
        jibun_address = COALESCE(v_jibun_address, jibun_address),
        english_address = COALESCE(v_english_address, english_address),
        address_elements = COALESCE(v_address_elements, address_elements),
        lat = v_lat,
        lng = v_lng,
        youtube_link = v_youtube_link,
        youtube_meta = COALESCE(v_youtube_meta, youtube_meta),
        tzuyang_review = COALESCE(v_tzuyang_review, tzuyang_review),
        geocoding_success = TRUE,
        updated_by_admin_id = p_admin_user_id,
        updated_at = NOW()
    WHERE id = v_item.target_restaurant_id;

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
    RETURN QUERY SELECT TRUE, '수정 승인이 완료되었습니다.'::TEXT, v_item.target_restaurant_id;
END;
$$;

COMMENT ON FUNCTION public.approve_edit_submission_item IS '수정 제보 항목 승인 - 관리자가 수정한 모든 값(youtube_link 포함) 사용';
