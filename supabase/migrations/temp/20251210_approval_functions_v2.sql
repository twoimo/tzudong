-- ========================================
-- 제보 승인 함수 재작성
-- 작성일: 2025년 12월 10일
-- 설명: 정규화된 테이블 구조 기반 승인/거부 함수
-- ========================================

-- ========================================
-- PART 1: unique_id 생성 함수 (기존 유지)
-- ========================================

DROP FUNCTION IF EXISTS public.generate_unique_id(TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.generate_unique_id(
    p_name TEXT,
    p_jibun_address TEXT,
    p_tzuyang_review TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
    combined_string TEXT;
    hash_value TEXT;
BEGIN
    combined_string := COALESCE(p_name, '') || '|' || 
                       COALESCE(p_jibun_address, '') || '|' || 
                       COALESCE(p_tzuyang_review, '');
    hash_value := md5(combined_string);
    RETURN hash_value;
END;
$$;

COMMENT ON FUNCTION public.generate_unique_id IS 'name + jibun_address + tzuyang_review 기반으로 unique_id 생성 (MD5 해시)';

-- ========================================
-- PART 2: 중복 검사 함수 (강화된 버전)
-- ========================================

DROP FUNCTION IF EXISTS public.check_restaurant_duplicate(TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.check_restaurant_duplicate(
    p_name TEXT,
    p_jibun_address TEXT,
    p_unique_id TEXT DEFAULT NULL
)
RETURNS TABLE(
    is_duplicate BOOLEAN,
    duplicate_type TEXT,  -- 'exact_unique_id', 'similar_name_address', 'none'
    existing_restaurant_id UUID,
    existing_name TEXT,
    existing_address TEXT,
    similarity_score NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- 1. unique_id 정확 일치 검사
    IF p_unique_id IS NOT NULL THEN
        RETURN QUERY
        SELECT 
            TRUE,
            'exact_unique_id'::TEXT,
            r.id,
            r.name,
            COALESCE(r.jibun_address, r.road_address),
            100.0::NUMERIC
        FROM public.restaurants r
        WHERE r.unique_id = p_unique_id
          AND r.status IN ('approved', 'pending')
        LIMIT 1;
        
        IF FOUND THEN
            RETURN;
        END IF;
    END IF;

    -- 2. 이름 + 주소 유사도 검사 (85% 이상)
    RETURN QUERY
    SELECT 
        TRUE,
        'similar_name_address'::TEXT,
        r.id,
        r.name,
        COALESCE(r.jibun_address, r.road_address),
        (
            extensions.similarity(LOWER(p_name), LOWER(r.name)) * 0.5 +
            extensions.similarity(LOWER(COALESCE(p_jibun_address, '')), LOWER(COALESCE(r.jibun_address, r.road_address, ''))) * 0.5
        ) * 100
    FROM public.restaurants r
    WHERE r.status IN ('approved', 'pending')
      AND r.jibun_address IS NOT NULL
      AND (
          extensions.similarity(LOWER(p_name), LOWER(r.name)) >= 0.7 OR
          extensions.similarity(LOWER(COALESCE(p_jibun_address, '')), LOWER(COALESCE(r.jibun_address, ''))) >= 0.8
      )
    ORDER BY (
        extensions.similarity(LOWER(p_name), LOWER(r.name)) * 0.5 +
        extensions.similarity(LOWER(COALESCE(p_jibun_address, '')), LOWER(COALESCE(r.jibun_address, r.road_address, ''))) * 0.5
    ) DESC
    LIMIT 5;

    -- 중복 없으면 빈 결과
    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'none'::TEXT, NULL::UUID, NULL::TEXT, NULL::TEXT, 0.0::NUMERIC;
    END IF;
END;
$$;

COMMENT ON FUNCTION public.check_restaurant_duplicate IS '음식점 중복 검사 (unique_id 정확 일치 + 이름/주소 유사도 85%)';

-- ========================================
-- PART 3: 신규 맛집 제보 개별 항목 승인 함수
-- ========================================

DROP FUNCTION IF EXISTS public.approve_submission_item(UUID, UUID, JSONB);
CREATE OR REPLACE FUNCTION public.approve_submission_item(
    p_item_id UUID,
    p_admin_user_id UUID,
    p_geocoded_data JSONB  -- { jibun_address, road_address, lat, lng, youtube_meta }
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
    v_jibun_address TEXT;
    v_road_address TEXT;
    v_lat NUMERIC;
    v_lng NUMERIC;
BEGIN
    -- 1. 관리자 권한 확인
    SELECT public.is_user_admin(p_admin_user_id) INTO v_is_admin;
    IF NOT v_is_admin THEN
        RETURN QUERY SELECT FALSE, '관리자 권한이 필요합니다.'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- 2. 항목 조회
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

    -- 4. 지오코딩 데이터 추출
    v_jibun_address := p_geocoded_data->>'jibun_address';
    v_road_address := p_geocoded_data->>'road_address';
    v_lat := (p_geocoded_data->>'lat')::NUMERIC;
    v_lng := (p_geocoded_data->>'lng')::NUMERIC;

    IF v_jibun_address IS NULL OR v_lat IS NULL OR v_lng IS NULL THEN
        RETURN QUERY SELECT FALSE, '지오코딩 데이터가 필요합니다 (jibun_address, lat, lng).'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- 5. unique_id 생성
    v_generated_unique_id := public.generate_unique_id(
        v_submission.restaurant_name,
        v_jibun_address,
        v_item.tzuyang_review
    );

    -- 6. 중복 검사 (unique_id 정확 일치만 차단)
    IF EXISTS (SELECT 1 FROM public.restaurants WHERE unique_id = v_generated_unique_id) THEN
        RETURN QUERY SELECT FALSE, '동일한 맛집+리뷰 조합이 이미 존재합니다.'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- 7. restaurants 테이블에 INSERT
    INSERT INTO public.restaurants (
        unique_id,
        name,
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
        geocoding_success,
        created_by,
        updated_by_admin_id
    )
    VALUES (
        v_generated_unique_id,
        v_submission.restaurant_name,
        v_submission.restaurant_categories,
        v_submission.restaurant_phone,
        v_road_address,
        v_jibun_address,
        v_lat,
        v_lng,
        v_item.youtube_link,
        COALESCE(p_geocoded_data->'youtube_meta', '{}'::JSONB),
        v_item.tzuyang_review,
        'approved',
        CASE v_submission.submission_type
            WHEN 'new' THEN 'user_submission_new'
            WHEN 'edit' THEN 'user_submission_edit'
        END,
        TRUE,
        v_submission.user_id,
        p_admin_user_id
    )
    RETURNING id INTO v_new_restaurant_id;

    -- 8. 항목 상태 업데이트
    UPDATE public.restaurant_submission_items
    SET 
        item_status = 'approved',
        approved_restaurant_id = v_new_restaurant_id
    WHERE id = p_item_id;

    -- 9. submission 상태는 트리거로 자동 업데이트됨
    -- reviewed_at, resolved_by_admin_id 업데이트
    UPDATE public.restaurant_submissions
    SET 
        resolved_by_admin_id = p_admin_user_id,
        reviewed_at = COALESCE(reviewed_at, now())
    WHERE id = v_submission.id;

    RETURN QUERY SELECT TRUE, '항목이 승인되었습니다.'::TEXT, v_new_restaurant_id;
END;
$$;

COMMENT ON FUNCTION public.approve_submission_item IS '제보 개별 항목 승인 (신규: restaurants INSERT)';

-- ========================================
-- PART 4: 기존 맛집 수정 항목 승인 함수
-- ========================================

DROP FUNCTION IF EXISTS public.approve_edit_submission_item(UUID, UUID, JSONB);
CREATE OR REPLACE FUNCTION public.approve_edit_submission_item(
    p_item_id UUID,
    p_admin_user_id UUID,
    p_updated_data JSONB DEFAULT NULL  -- 선택: 관리자가 수정한 데이터
)
RETURNS TABLE(
    success BOOLEAN,
    message TEXT,
    updated_restaurant_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_is_admin BOOLEAN;
    v_item RECORD;
    v_submission RECORD;
    v_target_restaurant_id UUID;
BEGIN
    -- 1. 관리자 권한 확인
    SELECT public.is_user_admin(p_admin_user_id) INTO v_is_admin;
    IF NOT v_is_admin THEN
        RETURN QUERY SELECT FALSE, '관리자 권한이 필요합니다.'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- 2. 항목 조회
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
    WHERE id = v_item.submission_id AND submission_type = 'edit';

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, '수정 요청 제보가 아닙니다.'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- 4. 대상 레코드 확인 (target_unique_id 기반)
    IF v_item.target_unique_id IS NOT NULL THEN
        SELECT id INTO v_target_restaurant_id
        FROM public.restaurants
        WHERE unique_id = v_item.target_unique_id;
    ELSE
        v_target_restaurant_id := v_submission.target_restaurant_id;
    END IF;

    IF v_target_restaurant_id IS NULL THEN
        RETURN QUERY SELECT FALSE, '수정 대상 음식점을 찾을 수 없습니다.'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- 5. restaurants 테이블 UPDATE
    UPDATE public.restaurants
    SET
        youtube_link = COALESCE(p_updated_data->>'youtube_link', v_item.youtube_link, youtube_link),
        tzuyang_review = COALESCE(p_updated_data->>'tzuyang_review', v_item.tzuyang_review, tzuyang_review),
        name = COALESCE(p_updated_data->>'name', v_submission.restaurant_name, name),
        categories = COALESCE(
            CASE WHEN p_updated_data->'categories' IS NOT NULL 
                 THEN ARRAY(SELECT jsonb_array_elements_text(p_updated_data->'categories'))
                 ELSE NULL END,
            v_submission.restaurant_categories,
            categories
        ),
        phone = COALESCE(p_updated_data->>'phone', v_submission.restaurant_phone, phone),
        source_type = 'user_submission_edit',
        updated_by_admin_id = p_admin_user_id,
        updated_at = now()
    WHERE id = v_target_restaurant_id;

    -- 6. 항목 상태 업데이트
    UPDATE public.restaurant_submission_items
    SET 
        item_status = 'approved',
        approved_restaurant_id = v_target_restaurant_id
    WHERE id = p_item_id;

    -- 7. submission 메타 업데이트
    UPDATE public.restaurant_submissions
    SET 
        resolved_by_admin_id = p_admin_user_id,
        reviewed_at = COALESCE(reviewed_at, now())
    WHERE id = v_submission.id;

    RETURN QUERY SELECT TRUE, '수정 항목이 승인되었습니다.'::TEXT, v_target_restaurant_id;
END;
$$;

COMMENT ON FUNCTION public.approve_edit_submission_item IS '수정 요청 개별 항목 승인 (기존 restaurants UPDATE)';

-- ========================================
-- PART 5: 개별 항목 거부 함수
-- ========================================

DROP FUNCTION IF EXISTS public.reject_submission_item(UUID, UUID, TEXT);
CREATE OR REPLACE FUNCTION public.reject_submission_item(
    p_item_id UUID,
    p_admin_user_id UUID,
    p_rejection_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_is_admin BOOLEAN;
    v_submission_id UUID;
BEGIN
    -- 관리자 권한 확인
    SELECT public.is_user_admin(p_admin_user_id) INTO v_is_admin;
    IF NOT v_is_admin THEN
        RAISE EXCEPTION '관리자 권한이 필요합니다.';
    END IF;

    -- 항목 거부 처리
    UPDATE public.restaurant_submission_items
    SET 
        item_status = 'rejected',
        rejection_reason = p_rejection_reason
    WHERE id = p_item_id AND item_status = 'pending'
    RETURNING submission_id INTO v_submission_id;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    -- submission 메타 업데이트
    UPDATE public.restaurant_submissions
    SET 
        resolved_by_admin_id = p_admin_user_id,
        reviewed_at = COALESCE(reviewed_at, now())
    WHERE id = v_submission_id;

    RETURN TRUE;
END;
$$;

COMMENT ON FUNCTION public.reject_submission_item IS '제보 개별 항목 거부';

-- ========================================
-- PART 6: 제보 전체 거부 함수
-- ========================================

DROP FUNCTION IF EXISTS public.reject_submission(UUID, UUID, TEXT);
CREATE OR REPLACE FUNCTION public.reject_submission(
    p_submission_id UUID,
    p_admin_user_id UUID,
    p_rejection_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_is_admin BOOLEAN;
BEGIN
    -- 관리자 권한 확인
    SELECT public.is_user_admin(p_admin_user_id) INTO v_is_admin;
    IF NOT v_is_admin THEN
        RAISE EXCEPTION '관리자 권한이 필요합니다.';
    END IF;

    -- 모든 pending 항목 거부
    UPDATE public.restaurant_submission_items
    SET 
        item_status = 'rejected',
        rejection_reason = p_rejection_reason
    WHERE submission_id = p_submission_id AND item_status = 'pending';

    -- submission 전체 거부 처리
    UPDATE public.restaurant_submissions
    SET
        status = 'rejected',
        rejection_reason = p_rejection_reason,
        resolved_by_admin_id = p_admin_user_id,
        reviewed_at = now(),
        updated_at = now()
    WHERE id = p_submission_id AND status = 'pending';

    RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.reject_submission IS '제보 전체 거부 (모든 항목 일괄 거부)';

-- ========================================
-- PART 7: 마이페이지용 제보 내역 조회 함수
-- ========================================

DROP FUNCTION IF EXISTS public.get_user_submissions(UUID, INTEGER, INTEGER);
CREATE OR REPLACE FUNCTION public.get_user_submissions(
    p_user_id UUID,
    p_limit INTEGER DEFAULT 20,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
    id UUID,
    submission_type TEXT,
    status TEXT,
    restaurant_name TEXT,
    created_at TIMESTAMPTZ,
    items JSONB,
    rejection_reason TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.id,
        s.submission_type::TEXT,
        s.status::TEXT,
        s.restaurant_name,
        s.created_at,
        COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'id', i.id,
                    'youtube_link', i.youtube_link,
                    'tzuyang_review', i.tzuyang_review,
                    'item_status', i.item_status,
                    'rejection_reason', i.rejection_reason,
                    'approved_restaurant_id', i.approved_restaurant_id
                )
            ) FILTER (WHERE i.id IS NOT NULL),
            '[]'::JSONB
        ) as items,
        s.rejection_reason
    FROM public.restaurant_submissions s
    LEFT JOIN public.restaurant_submission_items i ON i.submission_id = s.id
    WHERE s.user_id = p_user_id
    GROUP BY s.id
    ORDER BY s.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION public.get_user_submissions IS '사용자 제보 내역 조회 (items 포함)';

-- ========================================
-- PART 8: 마이페이지용 request 조회 함수
-- ========================================

DROP FUNCTION IF EXISTS public.get_user_requests(UUID, INTEGER, INTEGER);
CREATE OR REPLACE FUNCTION public.get_user_requests(
    p_user_id UUID,
    p_limit INTEGER DEFAULT 20,
    p_offset INTEGER DEFAULT 0
)
RETURNS TABLE(
    id UUID,
    restaurant_name TEXT,
    address TEXT,
    categories TEXT[],
    recommendation_reason TEXT,
    youtube_link TEXT,
    geocoding_success BOOLEAN,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        r.id,
        r.restaurant_name,
        r.address,
        r.categories,
        r.recommendation_reason,
        r.youtube_link,
        r.geocoding_success,
        r.created_at
    FROM public.restaurant_requests r
    WHERE r.user_id = p_user_id
    ORDER BY r.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$;

COMMENT ON FUNCTION public.get_user_requests IS '사용자 추천 제보(request) 내역 조회';

-- ========================================
-- PART 9: 완료 메시지
-- ========================================

DO $$
BEGIN
    RAISE NOTICE '✅ 승인 함수 재작성 완료';
    RAISE NOTICE '   - approve_submission_item(): 신규 제보 개별 항목 승인';
    RAISE NOTICE '   - approve_edit_submission_item(): 수정 요청 개별 항목 승인';
    RAISE NOTICE '   - reject_submission_item(): 개별 항목 거부';
    RAISE NOTICE '   - reject_submission(): 제보 전체 거부';
    RAISE NOTICE '   - check_restaurant_duplicate(): 중복 검사 강화';
    RAISE NOTICE '   - get_user_submissions(): 마이페이지 제보 조회';
    RAISE NOTICE '   - get_user_requests(): 마이페이지 추천 조회';
END $$;
