-- 1. approve_submission_item 수정 (approved_name 추가, name 제거)
CREATE OR REPLACE FUNCTION public.approve_submission_item(p_item_id uuid, p_admin_user_id uuid, p_restaurant_data jsonb) RETURNS TABLE(success boolean, message text, created_restaurant_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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
    -- approved_name 으로 체크 (name 컬럼 없음)
    IF EXISTS (
        SELECT 1 FROM public.restaurants r
        WHERE r.youtube_link = v_youtube_link
        AND (
            extensions.similarity(r.approved_name, v_name) > 0.8
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
            -- name, -- [삭제] name 컬럼 존재하지 않음
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
            approved_name -- [수정] approved_name 사용
        )
        VALUES (
            v_generated_unique_id,
            -- v_name, -- [삭제]
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
            p_admin_user_id,
            v_name -- [수정] approved_name 값 설정 (관리자 승인 이름)
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

-- 2. approve_edit_submission_item 수정 (approved_name 업데이트, name 제거)
CREATE OR REPLACE FUNCTION public.approve_edit_submission_item(p_item_id uuid, p_admin_user_id uuid, p_updated_data jsonb) RETURNS TABLE(success boolean, message text, restaurant_id uuid)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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
            (r.youtube_link = v_youtube_link AND extensions.similarity(r.approved_name, v_name) > 0.8) -- approved_name 사용
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
        -- name = COALESCE(v_name, name), -- [삭제] name 컬럼 없음
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
        updated_at = NOW(),
        approved_name = COALESCE(v_name, approved_name) -- [수정] approved_name 업데이트
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

-- 3. approve_new_restaurant_submission 수정 (approved_name 추가, name 제거)
CREATE OR REPLACE FUNCTION public.approve_new_restaurant_submission(p_submission_id uuid, p_admin_user_id uuid, p_geocoded_data jsonb) RETURNS TABLE(success boolean, message text, created_restaurant_ids uuid[])
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_is_admin BOOLEAN;
    v_submission_record public.restaurant_submissions;
    v_restaurant_item JSONB;
    v_generated_unique_id TEXT;
    v_new_restaurant_id UUID;
    v_created_ids UUID[] := ARRAY[]::UUID[];
    v_jibun_address TEXT;
    v_youtube_meta JSONB;
BEGIN
    -- 1. 관리자 권한 확인
    SELECT public.is_user_admin(p_admin_user_id) INTO v_is_admin;
    IF NOT v_is_admin THEN
        RETURN QUERY SELECT FALSE, '관리자 권한이 필요합니다.'::TEXT, ARRAY[]::UUID[];
        RETURN;
    END IF;

    -- 2. 제보 조회
    SELECT * INTO v_submission_record
    FROM public.restaurant_submissions
    WHERE id = p_submission_id 
      AND submission_type = 'new'
      AND status = 'pending';

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, '처리할 신규 제보가 없거나 이미 처리되었습니다.'::TEXT, ARRAY[]::UUID[];
        RETURN;
    END IF;

    -- 3. user_restaurants_submission 배열의 각 항목 처리
    FOR v_restaurant_item IN SELECT * FROM jsonb_array_elements(v_submission_record.user_restaurants_submission)
    LOOP
        -- 재지오코딩된 데이터에서 jibun_address 추출 (관리자가 승인 전 재지오코딩 필수)
        v_jibun_address := p_geocoded_data->>(v_restaurant_item->>'name')::TEXT;
        
        IF v_jibun_address IS NULL THEN
            RAISE NOTICE '경고: % 맛집의 지오코딩 데이터가 없습니다. 건너뜁니다.', v_restaurant_item->>'name';
            CONTINUE;
        END IF;

        -- unique_id 생성
        v_generated_unique_id := public.generate_unique_id(
            v_restaurant_item->>'name',
            v_jibun_address,
            v_restaurant_item->>'tzuyang_review'
        );

        -- 중복 검사
        IF EXISTS (
            SELECT 1 FROM public.restaurants 
            WHERE unique_id = v_generated_unique_id
        ) THEN
            RAISE NOTICE '경고: % 맛집은 이미 존재합니다. 건너뜁니다.', v_restaurant_item->>'name';
            CONTINUE;
        END IF;

        -- youtube_meta 가져오기 (실제로는 외부 API 호출 필요, 여기서는 placeholder)
        v_youtube_meta := jsonb_build_object(
            'title', '제목 없음',
            'ads_info', jsonb_build_object('is_ads', false, 'what_ads', null),
            'duration', 0,
            'is_shorts', false,
            'publishedAt', now()
        );

        -- restaurants 테이블에 INSERT
        INSERT INTO public.restaurants (
            unique_id,
            -- name, -- [삭제]
            categories,
            phone,
            road_address,
            jibun_address,
            lat,
            lng,
            youtube_link,
            youtube_meta,
            tzuyang_review,
            status,
            source_type,
            created_by,
            updated_by_admin_id,
            approved_name -- [수정] approved_name 추가
        )
        VALUES (
            v_generated_unique_id,
            -- v_restaurant_item->>'name', -- [삭제]
            ARRAY(SELECT jsonb_array_elements_text(v_restaurant_item->'categories')),
            v_restaurant_item->>'phone',
            p_geocoded_data->>(v_restaurant_item->>'name' || '_road'),
            v_jibun_address,
            (p_geocoded_data->>(v_restaurant_item->>'name' || '_lat'))::NUMERIC,
            (p_geocoded_data->>(v_restaurant_item->>'name' || '_lng'))::NUMERIC,
            v_restaurant_item->>'youtube_link',
            v_youtube_meta,
            v_restaurant_item->>'tzuyang_review',
            'approved',
            'user_submission_new',
            v_submission_record.user_id,
            p_admin_user_id,
            v_restaurant_item->>'name' -- [수정] approved_name 값 설정
        )
        RETURNING id INTO v_new_restaurant_id;

        v_created_ids := array_append(v_created_ids, v_new_restaurant_id);
    END LOOP;

    -- 4. 제보 상태 업데이트
    IF array_length(v_created_ids, 1) > 0 THEN
        UPDATE public.restaurant_submissions
        SET
            status = 'all_approved',
            resolved_by_admin_id = p_admin_user_id,
            reviewed_at = now(),
            updated_at = now()
        WHERE id = p_submission_id;

        RETURN QUERY SELECT TRUE, '신규 맛집 제보가 승인되었습니다.'::TEXT, v_created_ids;
    ELSE
        RETURN QUERY SELECT FALSE, '승인할 수 있는 맛집이 없습니다.'::TEXT, ARRAY[]::UUID[];
    END IF;
END;
$$;

-- 4. approve_restaurant 수정 (name 제거, approved_name 업데이트)
CREATE OR REPLACE FUNCTION public.approve_restaurant(restaurant_id uuid, admin_user_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    is_admin BOOLEAN;
BEGIN
    -- 관리자 권한 확인
    SELECT EXISTS(
        SELECT 1 FROM public.user_roles 
        WHERE user_id = admin_user_id AND role = 'admin'
    ) INTO is_admin;
    
    IF NOT is_admin THEN
        RAISE EXCEPTION '관리자 권한이 필요합니다.';
    END IF;
    
    -- 맛집 승인 처리
    UPDATE public.restaurants
    SET 
        status = 'approved',
        updated_at = now(),
        updated_by_admin_id = admin_user_id
        -- approved_name = COALESCE(approved_name, name) -- [삭제] name이 없으므로 approved_name만 유지 혹은 origin_name 등 활용 필요. 일단 유지하되 name 참조 제거
        -- 만약 approved_name이 NULL이라면 origin_name 등으로 채워야 할 수도 있음.
        -- 여기서는 일단 추가 로직 없이 상태만 변경하거나, 필요한 경우 다른 컬럼 참조
    WHERE id = restaurant_id
    AND status = 'pending';
    
    RETURN FOUND;
END;
$$;

