-- approve_submission_item / approve_edit_submission_item 함수 업데이트
-- 관리자가 수정한 데이터(이름, 전화번호, 카테고리, 리뷰 등)를 반영하여 restaurants 테이블에 저장
-- approved_restaurant_id 컬럼 제거, target_restaurant_id만 사용

-- 기존 함수 제거
DROP FUNCTION IF EXISTS public.approve_submission_item(UUID, UUID, JSONB);
DROP FUNCTION IF EXISTS public.approve_edit_submission_item(UUID, UUID, JSONB);

-- ========================================
-- -1. unique_id 생성 함수 (파이프라인 규칙과 일치)
--    평가 transforms 스크립트와 동일: youtube_link + name + tzuyang_review (SHA-256)
-- ========================================
-- pgcrypto 확장은 Supabase에서 extensions 스키마에 있음

DROP FUNCTION IF EXISTS public.generate_unique_id(TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.generate_unique_id(
    p_youtube_link TEXT,
    p_name TEXT,
    p_tzuyang_review TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    combined_string TEXT;
BEGIN
    combined_string := COALESCE(p_youtube_link, '') || '|' ||
                       COALESCE(p_name, '') || '|' ||
                       COALESCE(p_tzuyang_review, '');

    -- Supabase에서 pgcrypto는 extensions 스키마에 있음
    RETURN encode(extensions.digest(combined_string, 'sha256'), 'hex');
END;
$$;

COMMENT ON FUNCTION public.generate_unique_id IS 'youtube_link + name + tzuyang_review 기반 SHA-256 해시 (평가 transforms 규칙과 동일)';

-- ========================================
-- 0. approved_restaurant_id 컬럼 및 제약조건 제거, target_restaurant_id로 통합
-- ========================================

-- 기존 제약 조건 제거
ALTER TABLE public.restaurant_submission_items 
DROP CONSTRAINT IF EXISTS items_approved_link_check;

-- 기존 인덱스 제거
DROP INDEX IF EXISTS idx_submission_items_approved_restaurant;

-- approved_restaurant_id 컬럼 제거
ALTER TABLE public.restaurant_submission_items 
DROP COLUMN IF EXISTS approved_restaurant_id;

-- 새로운 제약 조건 추가 (target_restaurant_id 사용)
ALTER TABLE public.restaurant_submission_items 
ADD CONSTRAINT items_approved_link_check CHECK (
    item_status != 'approved' 
    OR (item_status = 'approved' AND target_restaurant_id IS NOT NULL)
);

-- 새 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_submission_items_target_restaurant ON public.restaurant_submission_items(target_restaurant_id) 
    WHERE target_restaurant_id IS NOT NULL;

-- ========================================
-- 1. 신규 제보 승인 함수 (NEW)
-- ========================================
CREATE OR REPLACE FUNCTION public.approve_submission_item(
    p_item_id UUID,
    p_admin_user_id UUID,
    p_restaurant_data JSONB  -- 관리자 모달에서 최종 입력된 데이터
    -- { jibun_address, road_address, english_address, address_elements, lat, lng, 
    --   youtube_meta, name, phone, categories, tzuyang_review }
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
        v_item.youtube_link,
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
        WHERE r.youtube_link = v_item.youtube_link
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
            v_item.youtube_link,
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

    -- 10. submission 메타 및 상태 업데이트 (트리거 보완)
    UPDATE public.restaurant_submissions
    SET 
        status = public.calculate_submission_status(v_submission.id),
        resolved_by_admin_id = p_admin_user_id,
        reviewed_at = now()
    WHERE id = v_submission.id;

    RETURN QUERY SELECT TRUE, '항목이 승인되었습니다.'::TEXT, v_new_restaurant_id;
END;
$$;

COMMENT ON FUNCTION public.approve_submission_item IS '신규 제보 개별 항목 승인 - 관리자 모달에서 최종 입력된 데이터 사용';

-- ========================================
-- 2. 수정 제보 승인 함수 (EDIT)
-- ========================================
CREATE OR REPLACE FUNCTION public.approve_edit_submission_item(
    p_item_id UUID,
    p_admin_user_id UUID,
    p_updated_data JSONB  -- 프론트엔드에서 사용하는 파라미터명 유지
    -- { jibun_address, road_address, english_address, address_elements, lat, lng,
    --   youtube_meta, name, phone, categories, tzuyang_review }
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
    v_target_restaurant_id UUID;
    
    -- 관리자가 모달에서 입력한 최종 데이터
    v_name TEXT;
    v_phone TEXT;
    v_categories TEXT[];
    v_tzuyang_review TEXT;
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

    -- 3. 부모 submission 조회 (edit 타입만)
    SELECT * INTO v_submission
    FROM public.restaurant_submissions
    WHERE id = v_item.submission_id AND submission_type = 'edit';

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, '수정 요청 제보가 아닙니다.'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- 4. 수정 대상 레코드 확인 (item의 target_restaurant_id 사용)
    v_target_restaurant_id := v_item.target_restaurant_id;

    IF v_target_restaurant_id IS NULL THEN
        RETURN QUERY SELECT FALSE, '수정 대상 음식점 ID가 없습니다. (target_restaurant_id가 NULL)'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- 대상 레스토랑 존재 여부 확인
    IF NOT EXISTS (SELECT 1 FROM public.restaurants WHERE id = v_target_restaurant_id) THEN
        RETURN QUERY SELECT FALSE, '수정 대상 음식점이 존재하지 않습니다.'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- 5. 모달에서 최종 입력된 데이터 추출 (관리자 수정 데이터)
    v_name := NULLIF(p_updated_data->>'name', '');
    v_phone := NULLIF(p_updated_data->>'phone', '');
    v_tzuyang_review := NULLIF(p_updated_data->>'tzuyang_review', '');
    v_jibun_address := p_updated_data->>'jibun_address';
    v_road_address := p_updated_data->>'road_address';
    v_english_address := p_updated_data->>'english_address';
    v_address_elements := p_updated_data->'address_elements';
    v_lat := (p_updated_data->>'lat')::NUMERIC;
    v_lng := (p_updated_data->>'lng')::NUMERIC;
    v_youtube_meta := COALESCE(p_updated_data->'youtube_meta', '{}'::JSONB);

    -- 필요 시 프론트에서 target_restaurant_id를 추가로 전달하면 보완
    IF v_target_restaurant_id IS NULL AND p_updated_data ? 'target_restaurant_id' THEN
        v_target_restaurant_id := (p_updated_data->>'target_restaurant_id')::UUID;
    END IF;
    
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
    IF v_name IS NULL THEN
        RETURN QUERY SELECT FALSE, '이름이 없습니다. unique_id 생성 불가'::TEXT, NULL::UUID;
        RETURN;
    END IF;
    IF v_jibun_address IS NULL OR v_lat IS NULL OR v_lng IS NULL THEN
        RETURN QUERY SELECT FALSE, '지오코딩 데이터가 필요합니다.'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- 7. 중복 검사 (자기 자신 제외, 같은 youtube_link + 유사한 이름/주소)
    IF EXISTS (
        SELECT 1 FROM public.restaurants r
        WHERE r.id != v_target_restaurant_id
        AND r.youtube_link = v_item.youtube_link
        AND (
            similarity(r.name, v_name) > 0.8
            OR similarity(COALESCE(r.jibun_address, ''), v_jibun_address) > 0.9
            OR similarity(COALESCE(r.road_address, ''), COALESCE(v_road_address, '')) > 0.9
        )
    ) THEN
        RETURN QUERY SELECT FALSE, '수정된 정보와 동일한 다른 맛집이 이미 존재합니다.'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- 8. restaurants 테이블 UPDATE (unique_id는 변경하지 않음)
    UPDATE public.restaurants
    SET
        name = v_name,
        categories = v_categories,
        phone = v_phone,
        road_address = v_road_address,
        jibun_address = v_jibun_address,
        english_address = v_english_address,
        address_elements = COALESCE(v_address_elements, '{}'::JSONB),
        lat = v_lat,
        lng = v_lng,
        youtube_link = v_item.youtube_link,
        youtube_meta = COALESCE(v_youtube_meta, '{}'::JSONB),
        tzuyang_review = v_tzuyang_review,
        source_type = 'user_submission_edit',
        geocoding_success = TRUE,
        updated_by_admin_id = p_admin_user_id,
        updated_at = now()
    WHERE id = v_target_restaurant_id;

    -- 9. 항목 상태 업데이트 (target_restaurant_id는 이미 설정되어 있음)
    UPDATE public.restaurant_submission_items
    SET 
        item_status = 'approved'
    WHERE id = p_item_id;
    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'submission item 업데이트 실패'::TEXT, NULL::UUID;
        RETURN;
    END IF;

    -- 10. submission 메타 및 상태 업데이트 (트리거 보완)
    UPDATE public.restaurant_submissions
    SET 
        status = public.calculate_submission_status(v_submission.id),
        resolved_by_admin_id = p_admin_user_id,
        reviewed_at = now()
    WHERE id = v_submission.id;

    RETURN QUERY SELECT TRUE, '수정 항목이 승인되었습니다.'::TEXT, v_target_restaurant_id;
END;
$$;

COMMENT ON FUNCTION public.approve_edit_submission_item IS '수정 제보 개별 항목 승인 - 관리자 모달에서 최종 입력된 데이터로 UPDATE, unique_id 유지';

-- ========================================
-- 완료 메시지
-- ========================================
DO $$
BEGIN
    RAISE NOTICE '✅ 승인 함수 업데이트 완료';
    RAISE NOTICE '   - approved_restaurant_id 컬럼 제거, target_restaurant_id만 사용';
    RAISE NOTICE '   - approve_submission_item(): 신규 제보 승인 (관리자 모달 데이터 사용)';
    RAISE NOTICE '   - approve_edit_submission_item(): 수정 제보 승인 (unique_id 유지, 중복 검사 개선)';
    RAISE NOTICE '   - 중복 검사: 같은 youtube_link + 유사한 이름/주소일 때만 차단';
END $$;
