--
-- PostgreSQL database dump
--

\restrict CFkUqswlnIOxGIipA4VAbdNrwJZOQL0n0ud8ggBuRxMk3QqgorIxPnrRTjeg9VD

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'admin',
    'user'
);


--
-- Name: notification_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.notification_type AS ENUM (
    'system',
    'user',
    'admin_announcement',
    'new_restaurant',
    'ranking_update',
    'review_approved',
    'review_rejected',
    'submission_approved',
    'submission_rejected'
);


--
-- Name: submission_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.submission_status AS ENUM (
    'pending',
    'approved',
    'partially_approved',
    'rejected'
);


--
-- Name: TYPE submission_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TYPE public.submission_status IS '제보 처리 상태 (pending: 대기, approved: 전체승인, partially_approved: 부분승인, rejected: 거부)';


--
-- Name: submission_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.submission_type AS ENUM (
    'new',
    'edit'
);


--
-- Name: approve_edit_restaurant_submission(uuid, uuid, uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_edit_restaurant_submission(p_submission_id uuid, p_admin_user_id uuid, p_approved_unique_ids uuid[]) RETURNS TABLE(success boolean, message text, updated_count integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_is_admin BOOLEAN;
    v_submission_record public.restaurant_submissions;
    v_restaurant_item JSONB;
    v_updated_count INTEGER := 0;
    v_total_count INTEGER := 0;
BEGIN
    -- 1. 관리자 권한 확인
    SELECT public.is_user_admin(p_admin_user_id) INTO v_is_admin;
    IF NOT v_is_admin THEN
        RETURN QUERY SELECT FALSE, '관리자 권한이 필요합니다.'::TEXT, 0;
        RETURN;
    END IF;

    -- 2. 제보 조회
    SELECT * INTO v_submission_record
    FROM public.restaurant_submissions
    WHERE id = p_submission_id 
      AND submission_type = 'edit'
      AND status = 'pending';

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, '처리할 수정 요청이 없거나 이미 처리되었습니다.'::TEXT, 0;
        RETURN;
    END IF;

    -- 3. user_restaurants_submission 배열의 각 항목 처리
    SELECT jsonb_array_length(v_submission_record.user_restaurants_submission) INTO v_total_count;

    FOR v_restaurant_item IN SELECT * FROM jsonb_array_elements(v_submission_record.user_restaurants_submission)
    LOOP
        -- 관리자가 승인한 항목만 처리
        IF (v_restaurant_item->>'unique_id')::UUID = ANY(p_approved_unique_ids) THEN
            -- restaurants 테이블 업데이트
            UPDATE public.restaurants
            SET
                name = COALESCE(v_restaurant_item->>'name', name),
                categories = COALESCE(
                    ARRAY(SELECT jsonb_array_elements_text(v_restaurant_item->'categories')),
                    categories
                ),
                phone = COALESCE(v_restaurant_item->>'phone', phone),
                road_address = COALESCE(v_restaurant_item->>'address', road_address),
                youtube_link = COALESCE(v_restaurant_item->>'youtube_link', youtube_link),
                tzuyang_review = COALESCE(v_restaurant_item->>'tzuyang_review', tzuyang_review),
                resource_type = 'user_submission_edit',
                updated_by_admin_id = p_admin_user_id,
                updated_at = now()
            WHERE unique_id = v_restaurant_item->>'unique_id';

            IF FOUND THEN
                v_updated_count := v_updated_count + 1;
            END IF;
        END IF;
    END LOOP;

    -- 4. 제보 상태 업데이트
    IF v_updated_count = v_total_count THEN
        -- 모두 승인
        UPDATE public.restaurant_submissions
        SET
            status = 'all_approved',
            resolved_by_admin_id = p_admin_user_id,
            reviewed_at = now(),
            updated_at = now()
        WHERE id = p_submission_id;
    ELSIF v_updated_count > 0 THEN
        -- 부분 승인
        UPDATE public.restaurant_submissions
        SET
            status = 'partially_approved',
            resolved_by_admin_id = p_admin_user_id,
            reviewed_at = now(),
            updated_at = now()
        WHERE id = p_submission_id;
    ELSE
        -- 모두 거부
        UPDATE public.restaurant_submissions
        SET
            status = 'all_deleted',
            resolved_by_admin_id = p_admin_user_id,
            reviewed_at = now(),
            updated_at = now()
        WHERE id = p_submission_id;
    END IF;

    RETURN QUERY SELECT TRUE, format('수정 요청이 처리되었습니다. (승인: %s/%s)', v_updated_count, v_total_count)::TEXT, v_updated_count;
END;
$$;


--
-- Name: FUNCTION approve_edit_restaurant_submission(p_submission_id uuid, p_admin_user_id uuid, p_approved_unique_ids uuid[]); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.approve_edit_restaurant_submission(p_submission_id uuid, p_admin_user_id uuid, p_approved_unique_ids uuid[]) IS '기존 맛집 수정 요청 승인 (관리자 전용, 부분 승인 가능)';


--
-- Name: approve_edit_submission_item(uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_edit_submission_item(p_item_id uuid, p_admin_user_id uuid, p_updated_data jsonb) RETURNS TABLE(success boolean, message text, restaurant_id uuid)
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


--
-- Name: FUNCTION approve_edit_submission_item(p_item_id uuid, p_admin_user_id uuid, p_updated_data jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.approve_edit_submission_item(p_item_id uuid, p_admin_user_id uuid, p_updated_data jsonb) IS '수정 제보 항목 승인 - 관리자가 수정한 모든 값(youtube_link 포함) 사용';


--
-- Name: approve_new_restaurant_submission(uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_new_restaurant_submission(p_submission_id uuid, p_admin_user_id uuid, p_geocoded_data jsonb) RETURNS TABLE(success boolean, message text, created_restaurant_ids uuid[])
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


--
-- Name: FUNCTION approve_new_restaurant_submission(p_submission_id uuid, p_admin_user_id uuid, p_geocoded_data jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.approve_new_restaurant_submission(p_submission_id uuid, p_admin_user_id uuid, p_geocoded_data jsonb) IS '신규 맛집 제보 승인 (관리자 전용, 재지오코딩 필수)';


--
-- Name: approve_restaurant(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_restaurant(restaurant_id uuid, admin_user_id uuid) RETURNS boolean
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


--
-- Name: FUNCTION approve_restaurant(restaurant_id uuid, admin_user_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.approve_restaurant(restaurant_id uuid, admin_user_id uuid) IS '맛집 승인 처리 (관리자 전용)';


--
-- Name: approve_restaurant_submission(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_restaurant_submission(submission_id uuid, admin_user_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    submission_record public.restaurant_submissions;
    is_admin BOOLEAN;
BEGIN
    -- 1. 관리자 권한 확인
    SELECT public.is_user_admin(admin_user_id) INTO is_admin;
    IF NOT is_admin THEN
        RAISE EXCEPTION '관리자 권한이 필요합니다.';
    END IF;

    -- 2. 처리할 제보 조회 (pending 상태, 관리자가 입력한 최종 데이터 기준)
    SELECT * INTO submission_record
    FROM public.restaurant_submissions
    WHERE id = submission_id AND status = 'pending';

    IF NOT FOUND THEN
        RAISE EXCEPTION '처리할 제보가 없거나 이미 처리된 제보입니다.';
    END IF;

    -- 3. [관리자 검증] 필수 항목이 채워졌는지 확인 (지오코딩/수동입력 완료 여부)
    IF submission_record.name IS NULL OR
       submission_record.lat IS NULL OR
       submission_record.lng IS NULL OR
       submission_record.categories IS NULL OR
       (submission_record.road_address IS NULL AND submission_record.jibun_address IS NULL)
    THEN
        RAISE EXCEPTION '승인 실패: 필수 항목(이름, 좌표, 카테고리, 주소)이 누락되었습니다. 지오코딩 또는 수동 입력 후 승인하세요.';
    END IF;

    -- 4. 제보 유형에 따라 분기
    IF submission_record.submission_type = 'new' THEN
        
        -- 4-1. 신규 제보 승인 (INSERT into restaurants)
        INSERT INTO public.restaurants (
            name, phone, categories,
            lat, lng, road_address, jibun_address, english_address, address_elements,
            status, -- 'approved'로 즉시 승인
            source_type, -- 'user_submission_new'
            created_by, -- 제보한 사용자 ID
            updated_by_admin_id -- 승인한 관리자 ID
        )
        VALUES (
            submission_record.name, submission_record.phone, submission_record.categories,
            submission_record.lat, submission_record.lng, submission_record.road_address, 
            submission_record.jibun_address, submission_record.english_address, submission_record.address_elements,
            'approved',
            'user_submission_new', -- 요청하신 source_type
            submission_record.user_id,
            admin_user_id
        );

    ELSIF submission_record.submission_type = 'edit' THEN
    
        -- 4-2. 수정 제보 승인 (UPDATE restaurants)
        
        IF submission_record.restaurant_id IS NULL THEN
            RAISE EXCEPTION '승인 실패: 수정할 대상 맛집(restaurant_id)이 지정되지 않았습니다.';
        END IF;

        UPDATE public.restaurants r
        SET
            -- 관리자가 제보 테이블에 수정한 값으로 덮어쓰기
            -- (COALESCE 사용: 제보에 값이 있으면 그 값으로, 없으면(NULL) 기존 값 유지)
            name = COALESCE(submission_record.name, r.name),
            phone = COALESCE(submission_record.phone, r.phone),
            categories = COALESCE(submission_record.categories, r.categories),
            lat = COALESCE(submission_record.lat, r.lat),
            lng = COALESCE(submission_record.lng, r.lng),
            road_address = COALESCE(submission_record.road_address, r.road_address),
            jibun_address = COALESCE(submission_record.jibun_address, r.jibun_address),
            english_address = COALESCE(submission_record.english_address, r.english_address),
            address_elements = COALESCE(submission_record.address_elements, r.address_elements),
            
            status = 'approved', -- 'approved' 상태 보장
            source_type = 'user_submission_edit', -- 'modifying' 대신 'edit' 사용 (수정 가능)
            updated_by_admin_id = admin_user_id,
            updated_at = now()
        WHERE
            r.id = submission_record.restaurant_id;

        IF NOT FOUND THEN
             RAISE EXCEPTION '승인 실패: 수정할 대상 맛집(ID: %)을 찾을 수 없습니다.', submission_record.restaurant_id;
        END IF;

    END IF;

    -- 5. 제보 테이블 상태 'approved'로 변경
    UPDATE public.restaurant_submissions
    SET
        status = 'approved',
        resolved_by_admin_id = admin_user_id,
        updated_at = now()
    WHERE
        id = submission_id;

    RETURN TRUE;
END;
$$;


--
-- Name: FUNCTION approve_restaurant_submission(submission_id uuid, admin_user_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.approve_restaurant_submission(submission_id uuid, admin_user_id uuid) IS '사용자 제보(신규/수정)를 승인하고 restaurants 테이블에 status=approved로 즉시 반영합니다. (관리자 전용)';


--
-- Name: approve_submission_item(uuid, uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_submission_item(p_item_id uuid, p_admin_user_id uuid, p_restaurant_data jsonb) RETURNS TABLE(success boolean, message text, created_restaurant_id uuid)
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


--
-- Name: FUNCTION approve_submission_item(p_item_id uuid, p_admin_user_id uuid, p_restaurant_data jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.approve_submission_item(p_item_id uuid, p_admin_user_id uuid, p_restaurant_data jsonb) IS '신규 제보 항목 승인 - 관리자가 수정한 모든 값(youtube_link 포함) 사용';


--
-- Name: batch_insert_restaurants_from_jsonl(jsonb[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.batch_insert_restaurants_from_jsonl(jsonl_array jsonb[]) RETURNS TABLE(inserted_count integer, updated_count integer, failed_count integer, failed_records jsonb[])
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    record JSONB;
    inserted INTEGER := 0;
    updated INTEGER := 0;
    failed INTEGER := 0;
    failed_list JSONB[] := ARRAY[]::JSONB[];
    result_id UUID;
BEGIN
    FOREACH record IN ARRAY jsonl_array
    LOOP
        BEGIN
            -- unique_id 존재 여부 확인
            IF EXISTS (SELECT 1 FROM public.restaurants WHERE unique_id = record->>'unique_id') THEN
                result_id := public.insert_restaurant_from_jsonl(record);
                updated := updated + 1;
            ELSE
                result_id := public.insert_restaurant_from_jsonl(record);
                inserted := inserted + 1;
            END IF;
        EXCEPTION
            WHEN OTHERS THEN
                failed := failed + 1;
                failed_list := array_append(failed_list, jsonb_build_object(
                    'data', record,
                    'error', SQLERRM
                ));
        END;
    END LOOP;
    
    RETURN QUERY SELECT inserted, updated, failed, failed_list;
END;
$$;


--
-- Name: FUNCTION batch_insert_restaurants_from_jsonl(jsonl_array jsonb[]); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.batch_insert_restaurants_from_jsonl(jsonl_array jsonb[]) IS 'JSONL 배열을 한 번에 처리하여 restaurants 테이블에 삽입/업데이트';


--
-- Name: calculate_submission_status(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_submission_status(p_submission_id uuid) RETURNS public.submission_status
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_total_count INTEGER;
    v_approved_count INTEGER;
    v_rejected_count INTEGER;
    v_pending_count INTEGER;
BEGIN
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE item_status = 'approved'),
        COUNT(*) FILTER (WHERE item_status = 'rejected'),
        COUNT(*) FILTER (WHERE item_status = 'pending')
    INTO v_total_count, v_approved_count, v_rejected_count, v_pending_count
    FROM public.restaurant_submission_items
    WHERE submission_id = p_submission_id;

    -- 아직 처리 안 된 항목이 있으면 pending
    IF v_pending_count > 0 THEN
        RETURN 'pending';
    -- 모두 승인
    ELSIF v_approved_count = v_total_count THEN
        RETURN 'approved';
    -- 모두 거부
    ELSIF v_rejected_count = v_total_count THEN
        RETURN 'rejected';
    -- 일부만 승인 (나머지는 거부)
    ELSE
        RETURN 'partially_approved';
    END IF;
END;
$$;


--
-- Name: FUNCTION calculate_submission_status(p_submission_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.calculate_submission_status(p_submission_id uuid) IS 'items 상태 기반으로 submission 전체 상태 계산';


--
-- Name: calculate_word_match_score(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_word_match_score(restaurant_name text, search_query text) RETURNS double precision
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public'
    AS $$
DECLARE
    clean_name TEXT;
    clean_query TEXT;
    search_words TEXT[];
    matched_count INT := 0;
    total_words INT;
    word TEXT;
BEGIN
    -- 소문자 변환 (띄어쓰기는 유지)
    clean_name := LOWER(restaurant_name);
    clean_query := LOWER(search_query);
    
    -- 검색어를 띄어쓰기 기준으로 단어 배열로 변환
    search_words := string_to_array(clean_query, ' ');
    total_words := array_length(search_words, 1);
    
    -- 빈 문자열 처리
    IF total_words IS NULL OR total_words = 0 THEN
        RETURN 0.0;
    END IF;
    
    -- 각 단어가 맛집명에 포함되는지 확인
    FOREACH word IN ARRAY search_words LOOP
        IF word != '' AND clean_name LIKE '%' || word || '%' THEN
            matched_count := matched_count + 1;
        END IF;
    END LOOP;
    
    -- 일치 비율 반환 (0~1)
    RETURN matched_count::DOUBLE PRECISION / total_words;
END;
$$;


--
-- Name: FUNCTION calculate_word_match_score(restaurant_name text, search_query text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.calculate_word_match_score(restaurant_name text, search_query text) IS '검색어의 단어(띄어쓰기 기준)가 맛집명에 얼마나 포함되는지 0~1 사이의 점수 반환';


--
-- Name: check_restaurant_duplicate(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_restaurant_duplicate(p_name text, p_jibun_address text, p_unique_id text DEFAULT NULL::text) RETURNS TABLE(is_duplicate boolean, duplicate_type text, existing_restaurant_id uuid, existing_name text, existing_address text, similarity_score numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: FUNCTION check_restaurant_duplicate(p_name text, p_jibun_address text, p_unique_id text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.check_restaurant_duplicate(p_name text, p_jibun_address text, p_unique_id text) IS '음식점 중복 검사 (unique_id 정확 일치 + 이름/주소 유사도 85%)';


--
-- Name: cleanup_old_notifications(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_old_notifications(days_to_keep integer DEFAULT 90) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM public.notifications
    WHERE created_at < now() - (days_to_keep || ' days')::INTERVAL
    AND is_read = true;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;


--
-- Name: FUNCTION cleanup_old_notifications(days_to_keep integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.cleanup_old_notifications(days_to_keep integer) IS '오래된 읽은 알림 삭제 (기본: 90일)';


--
-- Name: cleanup_old_search_logs(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_old_search_logs() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  DELETE FROM public.search_logs
  WHERE searched_at < NOW() - INTERVAL '90 days';
  
  RAISE NOTICE 'Old search logs have been cleaned up at %', NOW();
END;
$$;


--
-- Name: create_admin_announcement_notification(text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_admin_announcement_notification(p_title text, p_message text, p_data jsonb DEFAULT '{}'::jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    INSERT INTO public.notifications (user_id, type, title, message, data)
    SELECT
        p.user_id,
        'admin_announcement'::notification_type,
        p_title,
        p_message,
        p_data
    FROM public.profiles p;
END;
$$;


--
-- Name: FUNCTION create_admin_announcement_notification(p_title text, p_message text, p_data jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_admin_announcement_notification(p_title text, p_message text, p_data jsonb) IS '모든 사용자에게 관리자 공지 알림 생성';


--
-- Name: create_new_restaurant_notification(text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_new_restaurant_notification(p_title text, p_message text, p_data jsonb DEFAULT '{}'::jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    INSERT INTO public.notifications (user_id, type, title, message, data)
    SELECT
        p.user_id,
        'new_restaurant'::notification_type,
        p_title,
        p_message,
        p_data
    FROM public.profiles p;
END;
$$;


--
-- Name: FUNCTION create_new_restaurant_notification(p_title text, p_message text, p_data jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_new_restaurant_notification(p_title text, p_message text, p_data jsonb) IS '모든 사용자에게 신규 맛집 알림 생성';


--
-- Name: create_ranking_notification(uuid, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_ranking_notification(p_user_id uuid, p_ranking integer, p_period text DEFAULT 'monthly'::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    notification_id UUID;
    ranking_title TEXT;
    ranking_message TEXT;
BEGIN
    ranking_title := '랭킹 업데이트';
    ranking_message := p_period || ' 랭킹이 ' || p_ranking || '위로 업데이트되었습니다!';

    INSERT INTO public.notifications (user_id, type, title, message, data)
    VALUES (
        p_user_id,
        'ranking_update'::notification_type,
        ranking_title,
        ranking_message,
        jsonb_build_object('ranking', p_ranking, 'period', p_period)
    )
    RETURNING id INTO notification_id;

    RETURN notification_id;
END;
$$;


--
-- Name: FUNCTION create_ranking_notification(p_user_id uuid, p_ranking integer, p_period text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_ranking_notification(p_user_id uuid, p_ranking integer, p_period text) IS '특정 사용자에게 랭킹 업데이트 알림 생성';


--
-- Name: create_user_notification(uuid, public.notification_type, text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_user_notification(p_user_id uuid, p_type public.notification_type, p_title text, p_message text, p_data jsonb DEFAULT '{}'::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    notification_id UUID;
BEGIN
    INSERT INTO public.notifications (user_id, type, title, message, data)
    VALUES (p_user_id, p_type, p_title, p_message, p_data)
    RETURNING id INTO notification_id;

    RETURN notification_id;
END;
$$;


--
-- Name: FUNCTION create_user_notification(p_user_id uuid, p_type public.notification_type, p_title text, p_message text, p_data jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_user_notification(p_user_id uuid, p_type public.notification_type, p_title text, p_message text, p_data jsonb) IS '특정 사용자에게 알림 생성';


--
-- Name: decrement_review_count(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.decrement_review_count(restaurant_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    UPDATE public.restaurants
    SET review_count = GREATEST(COALESCE(review_count, 0) - 1, 0)
    WHERE id = restaurant_id;
END;
$$;


--
-- Name: FUNCTION decrement_review_count(restaurant_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.decrement_review_count(restaurant_id uuid) IS '맛집의 리뷰 개수를 1 감소 (최소 0)';


--
-- Name: decrement_review_like_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.decrement_review_like_count() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    UPDATE public.reviews
    SET like_count = GREATEST(like_count - 1, 0)
    WHERE id = OLD.review_id;
    
    RETURN OLD;
END;
$$;


--
-- Name: FUNCTION decrement_review_like_count(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.decrement_review_like_count() IS 'review_likes DELETE 시 해당 리뷰의 like_count 자동 감소 (최소값 0)';


--
-- Name: delete_notification(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_notification(notification_uuid uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    DELETE FROM public.notifications
    WHERE id = notification_uuid AND user_id = auth.uid();
END;
$$;


--
-- Name: FUNCTION delete_notification(notification_uuid uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.delete_notification(notification_uuid uuid) IS '특정 알림 삭제';


--
-- Name: delete_user_account(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_user_account(target_user_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    -- 현재 사용자만 본인 계정 삭제 가능
    IF auth.uid() != target_user_id THEN
        RAISE EXCEPTION 'Unauthorized: You can only delete your own account';
    END IF;

    -- 1. 프로필 익명화
    UPDATE public.profiles
    SET nickname = '탈퇴한 사용자',
        profile_picture = NULL,
        email = 'deleted_' || target_user_id || '@deleted.local'
    WHERE user_id = target_user_id;

    -- 2. 통계 삭제
    DELETE FROM public.user_stats WHERE user_id = target_user_id;

    -- 3. 역할 삭제
    DELETE FROM public.user_roles WHERE user_id = target_user_id;
    
    RAISE NOTICE 'Account anonymized for user: %', target_user_id;
END;
$$;


--
-- Name: generate_unique_id(text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_unique_id(p_youtube_link text, p_name text, p_tzuyang_review text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public'
    AS $$
DECLARE
    combined_string TEXT;
BEGIN
    combined_string := COALESCE(p_youtube_link, '') || '|' ||
                       COALESCE(p_name, '') || '|' ||
                       COALESCE(p_tzuyang_review, '');
    RETURN encode(extensions.digest(combined_string, 'sha256'), 'hex');
END;
$$;


--
-- Name: FUNCTION generate_unique_id(p_youtube_link text, p_name text, p_tzuyang_review text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.generate_unique_id(p_youtube_link text, p_name text, p_tzuyang_review text) IS 'youtube_link + name + tzuyang_review 기반 SHA-256 해시 (search_path 보안 적용)';


--
-- Name: get_all_approved_restaurant_names(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_all_approved_restaurant_names() RETURNS TABLE(name text, categories text[])
    LANGUAGE sql STABLE
    AS $$
  select
    r.approved_name as name,
    r.categories
  from restaurants r
  where r.status = 'approved'
  order by r.approved_name;
$$;


--
-- Name: get_approved_restaurants(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_approved_restaurants(limit_count integer DEFAULT 100, offset_count integer DEFAULT 0) RETURNS TABLE(id uuid, name text, phone text, lat numeric, lng numeric, categories text[], road_address text, jibun_address text, english_address text, youtube_links text[], tzuyang_reviews jsonb, review_count integer, created_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        r.id,
        r.name,
        r.phone,
        r.lat,
        r.lng,
        r.categories,
        r.road_address,
        r.jibun_address,
        r.english_address,
        r.youtube_links,
        r.tzuyang_reviews,
        r.review_count,
        r.created_at
    FROM public.restaurants r
    WHERE r.status = 'approved'
    ORDER BY r.created_at DESC
    LIMIT limit_count
    OFFSET offset_count;
END;
$$;


--
-- Name: FUNCTION get_approved_restaurants(limit_count integer, offset_count integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_approved_restaurants(limit_count integer, offset_count integer) IS '승인된 맛집만 조회 (일반 사용자용)';


--
-- Name: get_categories_by_restaurant_name_or_youtube_url(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_categories_by_restaurant_name_or_youtube_url(p_restaurant_name text DEFAULT NULL::text, p_video_id text DEFAULT NULL::text) RETURNS text[]
    LANGUAGE sql STABLE
    AS $$
  select array_agg(distinct c)
  from restaurants r, unnest(r.categories) as c
  where r.status = 'approved'
    and (p_restaurant_name is null or r.approved_name = p_restaurant_name)
    and (p_video_id is null or substring(r.youtube_link from 'v=([^&]+)') = p_video_id);
$$;


--
-- Name: get_index_usage(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_index_usage() RETURNS TABLE(schema_name text, table_name text, index_name text, index_scans bigint, tuples_read bigint, tuples_fetched bigint, index_size text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
    SELECT
        schemaname::TEXT AS schema_name,
        relname::TEXT AS table_name,
        indexrelname::TEXT AS index_name,
        idx_scan AS index_scans,
        idx_tup_read AS tuples_read,
        idx_tup_fetch AS tuples_fetched,
        pg_size_pretty(pg_relation_size(indexrelid)) AS index_size
    FROM pg_stat_user_indexes
    WHERE schemaname = 'public'
    ORDER BY idx_scan DESC;
$$;


--
-- Name: FUNCTION get_index_usage(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_index_usage() IS '인덱스 사용 통계 조회 함수 (사용되지 않는 인덱스 확인)';


--
-- Name: get_ncp_monthly_usage(text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_ncp_monthly_usage(p_service_type text DEFAULT NULL::text, p_year_month date DEFAULT NULL::date) RETURNS TABLE(service_type text, total_count bigint, request_date date)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_start_date DATE;
    v_end_date DATE;
BEGIN
    -- 기본값: 현재 월
    IF p_year_month IS NULL THEN
        v_start_date := DATE_TRUNC('month', CURRENT_DATE)::DATE;
        v_end_date := (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month')::DATE;
    ELSE
        v_start_date := DATE_TRUNC('month', p_year_month)::DATE;
        v_end_date := (DATE_TRUNC('month', p_year_month) + INTERVAL '1 month')::DATE;
    END IF;

    RETURN QUERY
    SELECT
        ncp_api_usage.service_type,
        SUM(ncp_api_usage.daily_count)::BIGINT AS total_count,
        MAX(ncp_api_usage.request_date) AS request_date
    FROM ncp_api_usage
    WHERE ncp_api_usage.request_date >= v_start_date
      AND ncp_api_usage.request_date < v_end_date
      AND (p_service_type IS NULL OR ncp_api_usage.service_type = p_service_type)
    GROUP BY ncp_api_usage.service_type;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    nickname text NOT NULL,
    email text NOT NULL,
    avatar_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_login timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT profiles_email_check CHECK ((email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'::text)),
    CONSTRAINT profiles_nickname_check CHECK (((length(nickname) >= 2) AND (length(nickname) <= 20)))
);


--
-- Name: TABLE profiles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.profiles IS '사용자 프로필 정보 테이블 (이메일 중복 가능, 닉네임만 고유, 소프트 삭제 지원)';


--
-- Name: COLUMN profiles.nickname; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.nickname IS '사용자 닉네임 (고유값, 2-20자, 중복 불가)';


--
-- Name: COLUMN profiles.email; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.email IS '이메일 주소 (형식 검증, 중복 가능 - 회원탈퇴 후 재가입 허용)';


--
-- Name: COLUMN profiles.avatar_url; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.avatar_url IS '프로필 이미지 URL';


--
-- Name: COLUMN profiles.last_login; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.last_login IS '마지막 로그인 시간';


--
-- Name: restaurants_backup; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.restaurants_backup (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text,
    phone text,
    categories text[],
    lat numeric,
    lng numeric,
    road_address text,
    jibun_address text,
    english_address text,
    address_elements jsonb DEFAULT '{}'::jsonb,
    origin_address jsonb,
    youtube_meta jsonb,
    unique_id text,
    reasoning_basis text,
    evaluation_results jsonb,
    source_type text,
    geocoding_success boolean DEFAULT false NOT NULL,
    geocoding_false_stage integer,
    status text DEFAULT 'pending'::text NOT NULL,
    is_missing boolean DEFAULT false NOT NULL,
    is_not_selected boolean DEFAULT false NOT NULL,
    review_count integer DEFAULT 0 NOT NULL,
    created_by uuid,
    updated_by_admin_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    db_error_message text,
    db_error_details jsonb,
    tzuyang_review text,
    youtube_link text,
    search_count integer DEFAULT 0,
    weekly_search_count integer DEFAULT 0,
    CONSTRAINT restaurants_approved_data_check CHECK ((((status = 'approved'::text) AND (lat IS NOT NULL) AND (lng IS NOT NULL) AND (categories IS NOT NULL) AND ((road_address IS NOT NULL) OR (jibun_address IS NOT NULL))) OR (status = ANY (ARRAY['pending'::text, 'deleted'::text])))),
    CONSTRAINT restaurants_categories_check CHECK (((categories IS NULL) OR ((array_length(categories, 1) > 0) AND (array_length(categories, 1) <= 5)))),
    CONSTRAINT restaurants_geocoding_false_stage_check CHECK (((geocoding_false_stage IS NULL) OR (geocoding_false_stage = ANY (ARRAY[0, 1, 2])))),
    CONSTRAINT restaurants_geocoding_stage_check CHECK ((((geocoding_success = true) AND (geocoding_false_stage IS NULL)) OR ((geocoding_success = false) AND (geocoding_false_stage IS NOT NULL)) OR ((geocoding_success = false) AND (geocoding_false_stage IS NULL)))),
    CONSTRAINT restaurants_lat_check CHECK (((lat IS NULL) OR ((lat >= ('-90'::integer)::numeric) AND (lat <= (90)::numeric)))),
    CONSTRAINT restaurants_lng_check CHECK (((lng IS NULL) OR ((lng >= ('-180'::integer)::numeric) AND (lng <= (180)::numeric)))),
    CONSTRAINT restaurants_name_check CHECK (((length(name) >= 1) AND (length(name) <= 100))),
    CONSTRAINT restaurants_review_count_check CHECK ((review_count >= 0)),
    CONSTRAINT restaurants_source_type_check CHECK (((source_type IS NULL) OR (source_type = ANY (ARRAY['perplexity'::text, 'geminiCLI'::text, 'admin'::text, 'user_submission'::text, 'user_submission_new'::text, 'user_submission_edit'::text])))),
    CONSTRAINT restaurants_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'deleted'::text])))
);


--
-- Name: TABLE restaurants_backup; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.restaurants_backup IS '맛집 정보 통합 테이블 (restaurants + evaluation_records)';


--
-- Name: COLUMN restaurants_backup.name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurants_backup.name IS 'name이 NULL인 경우는 no_restaurants 또는 all_names_null 케이스로 관리자 검수 필요';


--
-- Name: COLUMN restaurants_backup.phone; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurants_backup.phone IS '전화번호 (형식: 02-1234-5678 또는 010-1234-5678)';


--
-- Name: COLUMN restaurants_backup.categories; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurants_backup.categories IS '맛집 카테고리 배열 (1-5개, status=approved일 때 필수)';


--
-- Name: COLUMN restaurants_backup.lat; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurants_backup.lat IS '위도 (범위: -90 ~ 90, status=approved일 때 필수)';


--
-- Name: COLUMN restaurants_backup.lng; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurants_backup.lng IS '경도 (범위: -180 ~ 180, status=approved일 때 필수)';


--
-- Name: COLUMN restaurants_backup.road_address; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurants_backup.road_address IS '도로명 주소';


--
-- Name: COLUMN restaurants_backup.jibun_address; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurants_backup.jibun_address IS '지번 주소';


--
-- Name: COLUMN restaurants_backup.english_address; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurants_backup.english_address IS '영문 주소';


--
-- Name: COLUMN restaurants_backup.address_elements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurants_backup.address_elements IS '주소 상세 정보 (JSONB)';


--
-- Name: COLUMN restaurants_backup.origin_address; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurants_backup.origin_address IS 'AI 크롤링 원본 주소 정보 (JSON: {address, lat, lng})';


--
-- Name: COLUMN restaurants_backup.youtube_meta; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurants_backup.youtube_meta IS '개별 유튜브 메타데이터 (AI 크롤링용)';


--
-- Name: COLUMN restaurants_backup.unique_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurants_backup.unique_id IS 'AI 크롤링 고유 식별자 (youtube_link 기반)';


--
-- Name: COLUMN restaurants_backup.reasoning_basis; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurants_backup.reasoning_basis IS 'AI 평가 근거';


--
-- Name: COLUMN restaurants_backup.evaluation_results; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurants_backup.evaluation_results IS 'AI 평가 결과 (JSON)';


--
-- Name: COLUMN restaurants_backup.geocoding_success; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurants_backup.geocoding_success IS '지오코딩 성공 여부';


--
-- Name: COLUMN restaurants_backup.geocoding_false_stage; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurants_backup.geocoding_false_stage IS '지오코딩 실패 단계 (0: 초기, 1: 중간, 2: 최종)';


--
-- Name: COLUMN restaurants_backup.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurants_backup.status IS '맛집 상태 (pending: 승인대기, approved: 승인됨, deleted: 삭제됨)';


--
-- Name: COLUMN restaurants_backup.is_missing; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurants_backup.is_missing IS '맛집 정보 누락 여부';


--
-- Name: COLUMN restaurants_backup.is_not_selected; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurants_backup.is_not_selected IS '선택되지 않음 여부';


--
-- Name: COLUMN restaurants_backup.review_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurants_backup.review_count IS '리뷰 개수 (0 이상)';


--
-- Name: COLUMN restaurants_backup.db_error_message; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurants_backup.db_error_message IS '중복 검사 등 DB 오류 메시지';


--
-- Name: COLUMN restaurants_backup.db_error_details; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurants_backup.db_error_details IS '중복된 맛집 정보 등 상세 에러 정보 (JSONB)';


--
-- Name: COLUMN restaurants_backup.tzuyang_review; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurants_backup.tzuyang_review IS '쯔양의 첫 번째 리뷰 (단일 텍스트)';


--
-- Name: COLUMN restaurants_backup.youtube_link; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurants_backup.youtube_link IS '첫 번째 유튜브 영상 링크 (단일 텍스트)';


--
-- Name: CONSTRAINT restaurants_status_check ON restaurants_backup; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON CONSTRAINT restaurants_status_check ON public.restaurants_backup IS '상태 값 제약 (pending, approved, deleted) - rejected 제거됨';


--
-- Name: review_likes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_likes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    review_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE review_likes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.review_likes IS '리뷰 좋아요 테이블';


--
-- Name: COLUMN review_likes.review_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.review_likes.review_id IS '좋아요한 리뷰 ID';


--
-- Name: COLUMN review_likes.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.review_likes.user_id IS '좋아요한 사용자 ID';


--
-- Name: reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    visited_at timestamp with time zone NOT NULL,
    verification_photo text NOT NULL,
    food_photos text[] DEFAULT ARRAY[]::text[],
    categories text[] DEFAULT ARRAY[]::text[],
    is_verified boolean DEFAULT false NOT NULL,
    admin_note text,
    is_pinned boolean DEFAULT false NOT NULL,
    is_edited_by_admin boolean DEFAULT false NOT NULL,
    edited_by_admin_id uuid,
    edited_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    receipt_hash text,
    receipt_data jsonb,
    is_duplicate boolean DEFAULT false,
    ocr_processed_at timestamp with time zone,
    like_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT reviews_content_check CHECK ((length(content) >= 10)),
    CONSTRAINT reviews_edited_consistency CHECK ((((is_edited_by_admin = false) AND (edited_by_admin_id IS NULL) AND (edited_at IS NULL)) OR ((is_edited_by_admin = true) AND (edited_by_admin_id IS NOT NULL) AND (edited_at IS NOT NULL)))),
    CONSTRAINT reviews_like_count_check CHECK ((like_count >= 0)),
    CONSTRAINT reviews_title_check CHECK (((length(title) >= 2) AND (length(title) <= 200))),
    CONSTRAINT reviews_visited_at_check CHECK ((visited_at <= now()))
);


--
-- Name: TABLE reviews; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.reviews IS '사용자 리뷰 테이블';


--
-- Name: COLUMN reviews.title; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reviews.title IS '리뷰 제목 (2-200자)';


--
-- Name: COLUMN reviews.content; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reviews.content IS '리뷰 내용 (최소 10자)';


--
-- Name: COLUMN reviews.visited_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reviews.visited_at IS '방문 일시 (미래 날짜 불가)';


--
-- Name: COLUMN reviews.verification_photo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reviews.verification_photo IS '방문 인증 사진 URL';


--
-- Name: COLUMN reviews.food_photos; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reviews.food_photos IS '음식 사진 URL 배열';


--
-- Name: COLUMN reviews.categories; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reviews.categories IS '리뷰 카테고리 배열';


--
-- Name: COLUMN reviews.is_verified; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reviews.is_verified IS '관리자 인증 여부';


--
-- Name: COLUMN reviews.admin_note; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reviews.admin_note IS '관리자 메모';


--
-- Name: COLUMN reviews.is_pinned; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reviews.is_pinned IS '고정 여부';


--
-- Name: COLUMN reviews.is_edited_by_admin; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reviews.is_edited_by_admin IS '관리자 수정 여부';


--
-- Name: COLUMN reviews.edited_by_admin_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reviews.edited_by_admin_id IS '수정한 관리자 ID';


--
-- Name: COLUMN reviews.edited_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reviews.edited_at IS '관리자 수정 시간';


--
-- Name: COLUMN reviews.receipt_hash; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reviews.receipt_hash IS '영수증 OCR 해시 (store_name|date|time|amount SHA-256)';


--
-- Name: COLUMN reviews.receipt_data; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reviews.receipt_data IS 'OCR 추출 데이터 JSON: {store_name, date, time, total_amount, items, confidence}';


--
-- Name: COLUMN reviews.is_duplicate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reviews.is_duplicate IS '중복 영수증 여부 (true=동일 영수증으로 다른 리뷰 존재)';


--
-- Name: COLUMN reviews.ocr_processed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reviews.ocr_processed_at IS 'OCR 처리 완료 시각 (NULL=미처리)';


--
-- Name: COLUMN reviews.like_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.reviews.like_count IS '리뷰 좋아요 개수 (캐시). review_likes 테이블과 트리거로 동기화됨.';


--
-- Name: mv_popular_reviews; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_popular_reviews AS
 SELECT rv.id,
    rv.restaurant_id,
    rv.user_id,
    rv.title,
    rv.content,
    rv.visited_at,
    rv.verification_photo,
    rv.food_photos,
    rv.is_verified,
    rv.is_pinned,
    rv.created_at,
    count(rl.id) AS like_count,
    p.nickname AS user_nickname,
    p.avatar_url AS user_profile_picture,
    r.name AS restaurant_name,
    r.road_address AS restaurant_address
   FROM (((public.reviews rv
     JOIN public.profiles p ON ((rv.user_id = p.user_id)))
     JOIN public.restaurants_backup r ON ((rv.restaurant_id = r.id)))
     LEFT JOIN public.review_likes rl ON ((rv.id = rl.review_id)))
  GROUP BY rv.id, rv.restaurant_id, rv.user_id, rv.title, rv.content, rv.visited_at, rv.verification_photo, rv.food_photos, rv.is_verified, rv.is_pinned, rv.created_at, p.nickname, p.avatar_url, r.name, r.road_address
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW mv_popular_reviews; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.mv_popular_reviews IS '인기 리뷰 Materialized View (좋아요 수 포함)';


--
-- Name: get_popular_reviews(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_popular_reviews() RETURNS SETOF public.mv_popular_reviews
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    SELECT * FROM public.mv_popular_reviews;
$$;


--
-- Name: FUNCTION get_popular_reviews(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_popular_reviews() IS '인기 리뷰 조회 함수 (Materialized View 래퍼)';


--
-- Name: mv_restaurant_stats; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_restaurant_stats AS
 SELECT r.id,
    r.name,
    r.categories,
    r.lat,
    r.lng,
    r.road_address,
    r.status,
    r.review_count,
    count(rv.id) AS actual_review_count,
    count(rv.id) FILTER (WHERE (rv.is_verified = true)) AS verified_review_count,
    count(DISTINCT rv.user_id) AS unique_reviewers,
    max(rv.created_at) AS last_review_at,
    array_agg(DISTINCT cat.cat) FILTER (WHERE (cat.cat IS NOT NULL)) AS all_review_categories
   FROM ((public.restaurants_backup r
     LEFT JOIN public.reviews rv ON ((r.id = rv.restaurant_id)))
     LEFT JOIN LATERAL unnest(rv.categories) cat(cat) ON (true))
  WHERE (r.status = 'approved'::text)
  GROUP BY r.id, r.name, r.categories, r.lat, r.lng, r.road_address, r.status, r.review_count
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW mv_restaurant_stats; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.mv_restaurant_stats IS '승인된 맛집 통계 Materialized View (status=approved만 포함, 주기적 REFRESH 필요)';


--
-- Name: get_restaurant_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_restaurant_stats() RETURNS SETOF public.mv_restaurant_stats
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    SELECT * FROM public.mv_restaurant_stats;
$$;


--
-- Name: FUNCTION get_restaurant_stats(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_restaurant_stats() IS '맛집 통계 조회 함수 (Materialized View 래퍼)';


--
-- Name: get_restaurant_stats_by_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_restaurant_stats_by_status() RETURNS TABLE(total_records bigint, approved_count bigint, pending_count bigint, rejected_count bigint, geocoding_success_count bigint, geocoding_failed_count bigint, missing_count bigint, not_selected_count bigint, geocoding_success_rate numeric, approval_rate numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*)::BIGINT as total_records,
        COUNT(*) FILTER (WHERE status = 'approved')::BIGINT as approved_count,
        COUNT(*) FILTER (WHERE status = 'pending')::BIGINT as pending_count,
        COUNT(*) FILTER (WHERE status = 'rejected')::BIGINT as rejected_count,
        COUNT(*) FILTER (WHERE geocoding_success = true)::BIGINT as geocoding_success_count,
        COUNT(*) FILTER (WHERE geocoding_success = false)::BIGINT as geocoding_failed_count,
        COUNT(*) FILTER (WHERE is_missing = true)::BIGINT as missing_count,
        COUNT(*) FILTER (WHERE is_not_selected = true)::BIGINT as not_selected_count,
        ROUND(
            (COUNT(*) FILTER (WHERE geocoding_success = true)::NUMERIC / 
            NULLIF(COUNT(*), 0)::NUMERIC * 100), 2
        ) as geocoding_success_rate,
        ROUND(
            (COUNT(*) FILTER (WHERE status = 'approved')::NUMERIC / 
            NULLIF(COUNT(*), 0)::NUMERIC * 100), 2
        ) as approval_rate
    FROM public.restaurants;
END;
$$;


--
-- Name: FUNCTION get_restaurant_stats_by_status(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_restaurant_stats_by_status() IS '맛집 통계 조회 (상태별: approved, pending, rejected)';


--
-- Name: get_review_like_count(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_review_like_count(review_id_param uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    SELECT COUNT(*)::INTEGER
    FROM public.review_likes
    WHERE review_id = review_id_param;
$$;


--
-- Name: FUNCTION get_review_like_count(review_id_param uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_review_like_count(review_id_param uuid) IS '특정 리뷰의 좋아요 개수 조회';


--
-- Name: get_table_sizes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_table_sizes() RETURNS TABLE(schema_name text, table_name text, total_size text, table_size text, index_size text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
    SELECT
        schemaname::TEXT AS schema_name,
        tablename::TEXT AS table_name,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
        pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) AS table_size,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) AS index_size
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
$$;


--
-- Name: FUNCTION get_table_sizes(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_table_sizes() IS '테이블 및 인덱스 크기 조회 함수';


--
-- Name: user_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_stats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    review_count integer DEFAULT 0 NOT NULL,
    verified_review_count integer DEFAULT 0 NOT NULL,
    trust_score numeric DEFAULT 0 NOT NULL,
    last_updated timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_stats_count_consistency CHECK ((verified_review_count <= review_count)),
    CONSTRAINT user_stats_review_count_check CHECK ((review_count >= 0)),
    CONSTRAINT user_stats_trust_score_check CHECK (((trust_score >= (0)::numeric) AND (trust_score <= (100)::numeric))),
    CONSTRAINT user_stats_verified_review_count_check CHECK ((verified_review_count >= 0))
);


--
-- Name: TABLE user_stats; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_stats IS '사용자 활동 통계 테이블';


--
-- Name: COLUMN user_stats.review_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_stats.review_count IS '총 리뷰 작성 수 (0 이상)';


--
-- Name: COLUMN user_stats.verified_review_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_stats.verified_review_count IS '인증된 리뷰 수 (0 이상, review_count 이하)';


--
-- Name: COLUMN user_stats.trust_score; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_stats.trust_score IS '신뢰도 점수 (0-100)';


--
-- Name: mv_user_leaderboard; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.mv_user_leaderboard AS
 SELECT p.user_id,
    p.nickname,
    p.avatar_url AS profile_picture,
    us.review_count,
    us.verified_review_count,
    us.trust_score,
    count(rl.id) AS total_likes_received,
    rank() OVER (ORDER BY us.trust_score DESC, us.verified_review_count DESC, us.review_count DESC) AS rank
   FROM (((public.profiles p
     JOIN public.user_stats us ON ((p.user_id = us.user_id)))
     LEFT JOIN public.reviews rv ON ((p.user_id = rv.user_id)))
     LEFT JOIN public.review_likes rl ON ((rv.id = rl.review_id)))
  GROUP BY p.user_id, p.nickname, p.avatar_url, us.review_count, us.verified_review_count, us.trust_score
  WITH NO DATA;


--
-- Name: MATERIALIZED VIEW mv_user_leaderboard; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON MATERIALIZED VIEW public.mv_user_leaderboard IS '사용자 리더보드 Materialized View (주기적 REFRESH 필요)';


--
-- Name: get_user_leaderboard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_leaderboard() RETURNS SETOF public.mv_user_leaderboard
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    SELECT * FROM public.mv_user_leaderboard;
$$;


--
-- Name: FUNCTION get_user_leaderboard(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_user_leaderboard() IS '사용자 리더보드 조회 함수 (Materialized View 래퍼)';


--
-- Name: get_user_requests(uuid, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_requests(p_user_id uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0) RETURNS TABLE(id uuid, restaurant_name text, address text, categories text[], recommendation_reason text, youtube_link text, geocoding_success boolean, created_at timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: FUNCTION get_user_requests(p_user_id uuid, p_limit integer, p_offset integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_user_requests(p_user_id uuid, p_limit integer, p_offset integer) IS '사용자 추천 제보(request) 내역 조회';


--
-- Name: get_user_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_stats() RETURNS TABLE(total_users bigint, total_reviews bigint, total_verified_reviews bigint, avg_trust_score numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(DISTINCT p.user_id)::BIGINT as total_users,
        COUNT(rv.id)::BIGINT as total_reviews,
        COUNT(rv.id) FILTER (WHERE rv.is_verified = true)::BIGINT as total_verified_reviews,
        COALESCE(AVG(us.trust_score), 0)::NUMERIC as avg_trust_score
    FROM public.profiles p
    LEFT JOIN public.reviews rv ON p.user_id = rv.user_id
    LEFT JOIN public.user_stats us ON p.user_id = us.user_id;
END;
$$;


--
-- Name: FUNCTION get_user_stats(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_user_stats() IS '사용자 및 리뷰 전체 통계 조회';


--
-- Name: get_user_submissions(uuid, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_submissions(p_user_id uuid, p_limit integer DEFAULT 20, p_offset integer DEFAULT 0) RETURNS TABLE(id uuid, submission_type text, status text, restaurant_name text, created_at timestamp with time zone, items jsonb, rejection_reason text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: FUNCTION get_user_submissions(p_user_id uuid, p_limit integer, p_offset integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_user_submissions(p_user_id uuid, p_limit integer, p_offset integer) IS '사용자 제보 내역 조회 (items 포함)';


--
-- Name: video_frame_captions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.video_frame_captions (
    id bigint NOT NULL,
    video_id text NOT NULL,
    recollect_id integer NOT NULL,
    start_sec integer NOT NULL,
    end_sec integer NOT NULL,
    rank integer,
    raw_caption text,
    chronological_analysis text,
    highlight_keywords text[],
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    duration integer
);


--
-- Name: get_video_captions_for_range(text, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_video_captions_for_range(p_video_id text, p_recollect_id integer, p_start_sec integer, p_end_sec integer) RETURNS SETOF public.video_frame_captions
    LANGUAGE plpgsql STABLE
    AS $$
declare
  v_target_recollect_id int;
  v_target_duration int;
begin
  -- 1. 요청받은 recollect_id에 해당하는 캡션 데이터가 있는지 확인
  perform 1 from video_frame_captions
  where video_id = p_video_id and recollect_id = p_recollect_id
  limit 1;

  if found then
    v_target_recollect_id := p_recollect_id;
  else
    -- 2. 없다면, video_frame_captions에서 해당 video_id의 duration을 확인
    select duration into v_target_duration
    from video_frame_captions
    where video_id = p_video_id
    limit 1;

    -- 3. 같은 duration을 가진 것 중 가장 최신(큰) recollect_id 찾기
    --    duration 매칭이 안 되면 결과 없음 (fallback 없음)
    if v_target_duration is not null then
      select max(recollect_id) into v_target_recollect_id
      from video_frame_captions
      where video_id = p_video_id and duration = v_target_duration;
    end if;
  end if;

  return query
  select *
  from video_frame_captions
  where video_id = p_video_id
    and recollect_id = v_target_recollect_id
    -- overlaps 연산자 (start1, end1) overlaps (start2, end2) 대체
    -- 조건: r.start_sec < p_end_sec AND p_start_sec < r.end_sec
    and start_sec < p_end_sec 
    and p_start_sec < end_sec
  order by rank asc;
end;
$$;


--
-- Name: videos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.videos (
    id text NOT NULL,
    published_at timestamp with time zone,
    duration integer,
    view_count bigint,
    like_count integer,
    comment_count integer,
    latest_recollect_id integer DEFAULT 0,
    is_shorts boolean DEFAULT false,
    is_ads boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    youtube_link text NOT NULL,
    channel_name text NOT NULL,
    title text,
    description text,
    category text,
    thumbnail_url text,
    thumbnail_hash text,
    advertisers text[],
    tags text[],
    recollect_vars text[],
    meta_history jsonb DEFAULT '[]'::jsonb
);


--
-- Name: get_video_metadata_filtered(integer, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_video_metadata_filtered(min_view_count integer DEFAULT 0, p_limit integer DEFAULT 5, p_order_by text DEFAULT 'view_count'::text) RETURNS SETOF public.videos
    LANGUAGE plpgsql STABLE
    AS $$
begin
  return query
  select *
  from videos
  where view_count >= min_view_count
  order by
    case when p_order_by = 'view_count' then view_count end desc nulls last,
    case when p_order_by = 'published_at' then published_at end desc nulls last,
    case when p_order_by = 'comment_count' then comment_count end desc nulls last
  limit p_limit;
end;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    prefixes TEXT[] := ARRAY[
        '위장이2개', '블랙홀위장', '쯔동민턴', '냉면빨대', '짜장면통째로',
        '라면8봉', '삼겹살산맥', '치킨흡입기', '쩝쩝박사', '대왕카스테라',
        '국밥말아먹어', '쯔양제자', '먹방견습생', '위장무한대', '풀코스다먹어',
        '5인분혼밥러', '배터지기직전', '밥도둑잡아라', '냠냠폭격기', '칼로리는숫자',
        '야식은기본', '다이어트내일부터'
    ];
    random_prefix TEXT;
    random_suffix TEXT;
    generated_nickname TEXT;
    retry_count INTEGER := 0;
    max_retries CONSTANT INTEGER := 10;
    nickname_exists BOOLEAN;
BEGIN
    -- 메타데이터에 닉네임이 있으면 사용
    IF NEW.raw_user_meta_data->>'nickname' IS NOT NULL THEN
        generated_nickname := NEW.raw_user_meta_data->>'nickname';
    ELSE
        -- 중복되지 않는 닉네임 생성 (최대 10회 재시도)
        LOOP
            random_prefix := prefixes[1 + floor(random() * array_length(prefixes, 1))::int];
            random_suffix := lpad((floor(random() * 10000))::text, 4, '0');
            generated_nickname := random_prefix || '_' || random_suffix;
            
            -- 중복 체크
            SELECT EXISTS(
                SELECT 1 FROM public.profiles WHERE nickname = generated_nickname
            ) INTO nickname_exists;
            
            EXIT WHEN NOT nickname_exists OR retry_count >= max_retries;
            retry_count := retry_count + 1;
        END LOOP;
        
        -- 최대 재시도 초과 시 user_id 기반 폴백
        IF nickname_exists THEN
            generated_nickname := '쯔동이_' || substr(NEW.id::text, 1, 8);
        END IF;
    END IF;

    -- 프로필 생성
    INSERT INTO public.profiles (user_id, nickname, email)
    VALUES (NEW.id, generated_nickname, NEW.email);

    -- 일반 사용자 역할 부여
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user');

    -- 사용자 통계 초기화
    INSERT INTO public.user_stats (user_id)
    VALUES (NEW.id);

    RETURN NEW;
EXCEPTION
    WHEN OTHERS THEN
        RAISE WARNING 'Error in handle_new_user: %', SQLERRM;
        RETURN NEW;
END;
$$;


--
-- Name: FUNCTION handle_new_user(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.handle_new_user() IS '신규 사용자 가입 시 쯔양 테마 랜덤 닉네임(중복 체크 포함)으로 프로필, 역할, 통계 자동 생성';


--
-- Name: handle_new_user_avatar(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user_avatar() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE public.profiles
  SET avatar_url = NEW.raw_user_meta_data->>'avatar_url'
  WHERE user_id = NEW.id
  AND avatar_url IS NULL
  AND NEW.raw_user_meta_data->>'avatar_url' IS NOT NULL;
  RETURN NEW;
END;
$$;


--
-- Name: has_role(uuid, public.app_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_id = _user_id
        AND role = _role
    )
$$;


--
-- Name: FUNCTION has_role(_user_id uuid, _role public.app_role); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) IS '특정 사용자가 특정 역할을 가지고 있는지 확인';


--
-- Name: increment_ncp_api_usage(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_ncp_api_usage(p_service_type text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_today DATE := CURRENT_DATE;
    v_this_month DATE := DATE_TRUNC('month', CURRENT_DATE)::DATE;
BEGIN
    -- 당일 사용량 증가
    INSERT INTO ncp_api_usage (service_type, request_date, daily_count, monthly_count)
    VALUES (p_service_type, v_today, 1, 1)
    ON CONFLICT (service_type, request_date)
    DO UPDATE SET
        daily_count = ncp_api_usage.daily_count + 1,
        monthly_count = ncp_api_usage.monthly_count + 1,
        updated_at = NOW();
END;
$$;


--
-- Name: increment_review_count(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_review_count(restaurant_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    UPDATE public.restaurants
    SET review_count = COALESCE(review_count, 0) + 1
    WHERE id = restaurant_id;
END;
$$;


--
-- Name: FUNCTION increment_review_count(restaurant_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.increment_review_count(restaurant_id uuid) IS '맛집의 리뷰 개수를 1 증가';


--
-- Name: increment_review_like_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_review_like_count() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    UPDATE public.reviews
    SET like_count = like_count + 1
    WHERE id = NEW.review_id;
    
    RETURN NEW;
END;
$$;


--
-- Name: FUNCTION increment_review_like_count(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.increment_review_like_count() IS 'review_likes INSERT 시 해당 리뷰의 like_count 자동 증가';


--
-- Name: increment_search_count(uuid, uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_search_count(restaurant_id uuid, user_id uuid, session_id text, ip_address text, user_agent text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
    v_success boolean;
    v_message text;
BEGIN
    -- Increment the counters
    UPDATE public.restaurants
    SET 
        search_count = COALESCE(search_count, 0) + 1,
        weekly_search_count = COALESCE(weekly_search_count, 0) + 1,
        updated_at = NOW()
    WHERE id = restaurant_id;

    IF FOUND THEN
        RETURN json_build_object(
            'success', true,
            'reason', 'success',
            'message', 'Search count incremented'
        );
    ELSE
        RETURN json_build_object(
            'success', false,
            'reason', 'not_found',
            'message', 'Restaurant not found'
        );
    END IF;

EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object(
        'success', false,
        'reason', 'error',
        'message', SQLERRM
    );
END;
$$;


--
-- Name: insert_restaurant_from_jsonl(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.insert_restaurant_from_jsonl(jsonl_data jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    new_restaurant_id UUID;
    categories_array TEXT[];
BEGIN
    -- category를 TEXT[]로 변환 (단일 값인 경우 배열로)
    IF jsonb_typeof(jsonl_data->'category') = 'string' THEN
        categories_array := ARRAY[jsonl_data->>'category'];
    ELSE
        categories_array := ARRAY(SELECT jsonb_array_elements_text(jsonl_data->'category'));
    END IF;
    
    -- restaurants 테이블에 삽입
    INSERT INTO public.restaurants (
        unique_id,
        name,
        phone,
        categories,
        status,
        source_type,
        youtube_meta,
        evaluation_results,
        reasoning_basis,
        tzuyang_reviews,
        origin_address,
        road_address,
        jibun_address,
        english_address,
        address_elements,
        geocoding_success,
        geocoding_false_stage,
        is_missing,
        is_not_selected,
        lat,
        lng
    ) VALUES (
        jsonl_data->>'unique_id',
        jsonl_data->>'name',
        jsonl_data->>'phone',
        categories_array,
        COALESCE(jsonl_data->>'status', 'pending'),
        COALESCE(jsonl_data->>'source_type', 'perplexity'),  -- 기본값: perplexity
        jsonl_data->'youtube_meta',
        jsonl_data->'evaluation_results',
        jsonl_data->>'reasoning_basis',
        jsonb_build_array(jsonb_build_object('review', jsonl_data->>'tzuyang_review')),
        jsonl_data->'origin_address',
        jsonl_data->>'roadAddress',
        jsonl_data->>'jibunAddress',
        jsonl_data->>'englishAddress',
        jsonl_data->'addressElements',
        COALESCE((jsonl_data->>'geocoding_success')::boolean, false),
        (jsonl_data->>'geocoding_false_stage')::integer,
        COALESCE((jsonl_data->>'is_missing')::boolean, false),
        COALESCE((jsonl_data->>'is_notSelected')::boolean, false),  -- camelCase 지원
        (jsonl_data->'origin_address'->>'lat')::numeric,
        (jsonl_data->'origin_address'->>'lng')::numeric
    )
    ON CONFLICT (unique_id) 
    DO UPDATE SET
        name = EXCLUDED.name,
        phone = EXCLUDED.phone,
        categories = EXCLUDED.categories,
        source_type = EXCLUDED.source_type,
        youtube_meta = EXCLUDED.youtube_meta,
        evaluation_results = EXCLUDED.evaluation_results,
        reasoning_basis = EXCLUDED.reasoning_basis,
        tzuyang_reviews = EXCLUDED.tzuyang_reviews,
        origin_address = EXCLUDED.origin_address,
        road_address = EXCLUDED.road_address,
        jibun_address = EXCLUDED.jibun_address,
        english_address = EXCLUDED.english_address,
        address_elements = EXCLUDED.address_elements,
        geocoding_success = EXCLUDED.geocoding_success,
        geocoding_false_stage = EXCLUDED.geocoding_false_stage,
        is_missing = EXCLUDED.is_missing,
        is_not_selected = EXCLUDED.is_not_selected,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        updated_at = now()
    RETURNING id INTO new_restaurant_id;
    
    -- youtube_links 배열에 추가 (중복 방지)
    UPDATE public.restaurants
    SET youtube_links = array_append(
        COALESCE(youtube_links, ARRAY[]::TEXT[]),
        jsonl_data->>'youtube_link'
    )
    WHERE id = new_restaurant_id
    AND NOT (jsonl_data->>'youtube_link' = ANY(COALESCE(youtube_links, ARRAY[]::TEXT[])));
    
    RETURN new_restaurant_id;
END;
$$;


--
-- Name: FUNCTION insert_restaurant_from_jsonl(jsonl_data jsonb); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.insert_restaurant_from_jsonl(jsonl_data jsonb) IS 'JSONL 크롤링 데이터를 restaurants 테이블에 삽입/업데이트 (unique_id 기준 UPSERT)';


--
-- Name: is_review_liked_by_user(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_review_liked_by_user(review_id_param uuid, user_id_param uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.review_likes
        WHERE review_id = review_id_param AND user_id = user_id_param
    );
$$;


--
-- Name: FUNCTION is_review_liked_by_user(review_id_param uuid, user_id_param uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.is_review_liked_by_user(review_id_param uuid, user_id_param uuid) IS '특정 사용자가 특정 리뷰에 좋아요를 눌렀는지 확인';


--
-- Name: is_user_admin(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_user_admin(user_uuid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_id = user_uuid
        AND role = 'admin'
    )
$$;


--
-- Name: FUNCTION is_user_admin(user_uuid uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.is_user_admin(user_uuid uuid) IS '사용자가 관리자인지 확인';


--
-- Name: make_user_admin(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.make_user_admin(target_email text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_user_id UUID;
BEGIN
    -- 이메일로 사용자 ID 찾기
    SELECT id INTO v_user_id
    FROM auth.users
    WHERE email = target_email;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'User not found with email: %', target_email;
    END IF;

    -- 관리자 역할 부여
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_user_id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;

    RAISE NOTICE 'User % is now an admin', target_email;
END;
$$;


--
-- Name: FUNCTION make_user_admin(target_email text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.make_user_admin(target_email text) IS '사용자를 관리자로 승격 (개발/테스트용)';


--
-- Name: mark_all_notifications_read(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_all_notifications_read() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    UPDATE public.notifications
    SET is_read = true
    WHERE user_id = auth.uid() AND is_read = false;
END;
$$;


--
-- Name: FUNCTION mark_all_notifications_read(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.mark_all_notifications_read() IS '현재 사용자의 모든 알림을 읽음 처리';


--
-- Name: mark_notification_read(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_notification_read(notification_uuid uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    UPDATE public.notifications
    SET is_read = true
    WHERE id = notification_uuid AND user_id = auth.uid();
END;
$$;


--
-- Name: FUNCTION mark_notification_read(notification_uuid uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.mark_notification_read(notification_uuid uuid) IS '특정 알림을 읽음 처리';


--
-- Name: match_documents_bge(public.vector, double precision, integer, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_documents_bge(query_embedding public.vector, match_threshold double precision, match_count integer, filter jsonb DEFAULT '{}'::jsonb) RETURNS TABLE(id bigint, video_id text, chunk_index integer, recollect_id integer, page_content text, metadata jsonb, embedding public.vector, similarity double precision)
    LANGUAGE plpgsql STABLE
    AS $$
begin
  return query
  select
    t.id,
    t.video_id,
    t.chunk_index,
    t.recollect_id,
    t.page_content,
    t.metadata,
    t.embedding,
    1 - (t.embedding <=> query_embedding) as similarity
  from transcript_embeddings_bge as t
  where 1 - (t.embedding <=> query_embedding) > match_threshold
  order by t.embedding <=> query_embedding
  limit match_count;
end;
$$;


--
-- Name: match_documents_hybrid(public.vector, jsonb, double precision, double precision, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_documents_hybrid(query_embedding public.vector, query_sparse jsonb, dense_weight double precision DEFAULT 0.6, match_threshold double precision DEFAULT 0.5, match_count integer DEFAULT 20) RETURNS TABLE(id bigint, video_id text, chunk_index integer, recollect_id integer, page_content text, metadata jsonb, embedding public.vector, dense_score double precision, sparse_score double precision, hybrid_score double precision)
    LANGUAGE plpgsql STABLE
    AS $$
#variable_conflict use_column
begin
  return query
  with 
  -- [Step 1] 벡터 검색으로 후보군 넉넉하게 추출 (인덱스 활용)
  candidates as (
    select
      teb.id, teb.video_id, teb.chunk_index, teb.recollect_id,
      teb.page_content, teb.metadata, teb.embedding, teb.sparse_embedding,
      1 - (teb.embedding <=> query_embedding) as dense_score
    from transcript_embeddings_bge teb
    where 1 - (teb.embedding <=> query_embedding) > match_threshold
    order by teb.embedding <=> query_embedding
    limit match_count * 5 -- 후보군 여유있게 (중복 및 구버전 필터링 대비)
  ),
  
  -- [Step 2] 최신 버전 필터링 (Subquery)
  -- 1차로 뽑힌 후보군에 대해서만 최신 버전인지 검증
  valid_candidates as (
    select c.*
    from candidates c
    where c.recollect_id = (
        select max(recollect_id) 
        from transcript_embeddings_bge 
        where video_id = c.video_id
    )
  ),

  -- [Step 3] Sparse 점수 계산 및 Hybrid 점수 산출
  scored as (
    select 
      vc.id, vc.video_id, vc.chunk_index, vc.recollect_id,
      vc.page_content, vc.metadata, vc.embedding,
      vc.dense_score,
      coalesce(
        (select sum((vc.sparse_embedding->>k)::float * (query_sparse->>k)::float)
         from jsonb_object_keys(query_sparse) k
         where vc.sparse_embedding ? k), 0
      ) as sparse_score
    from valid_candidates vc
  )
  
  -- [Step 4] 최종 점수 합산 및 반환
  select 
    s.id, s.video_id, s.chunk_index, s.recollect_id,
    s.page_content, s.metadata, s.embedding,
    s.dense_score::float,
    s.sparse_score::float,
    (s.dense_score * dense_weight + s.sparse_score * (1 - dense_weight))::float as hybrid_score
  from scored s
  order by hybrid_score desc
  limit match_count;
end;
$$;


--
-- Name: reactivate_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reactivate_user() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    -- 탈퇴한 사용자의 deleted_at을 NULL로 되돌림
    UPDATE public.profiles
    SET 
        deleted_at = NULL,
        last_login = now()
    WHERE user_id = (SELECT auth.uid())
    AND deleted_at IS NOT NULL;
END;
$$;


--
-- Name: FUNCTION reactivate_user(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.reactivate_user() IS '탈퇴한 사용자 재활성화 (재가입 시 deleted_at을 NULL로 초기화)';


--
-- Name: refresh_materialized_views(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_materialized_views() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_restaurant_stats;
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_user_leaderboard;
    REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_popular_reviews;
END;
$$;


--
-- Name: FUNCTION refresh_materialized_views(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.refresh_materialized_views() IS 'Materialized View들을 동시에 REFRESH (CONCURRENTLY)';


--
-- Name: reject_restaurant(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_restaurant(restaurant_id uuid, admin_user_id uuid, reject_reason text DEFAULT NULL::text) RETURNS boolean
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
    
    -- 맛집 거부 처리
    UPDATE public.restaurants
    SET 
        status = 'rejected',
        updated_at = now(),
        updated_by_admin_id = admin_user_id,
        admin_notes = COALESCE(reject_reason, admin_notes)
    WHERE id = restaurant_id
    AND status = 'pending';
    
    RETURN FOUND;
END;
$$;


--
-- Name: FUNCTION reject_restaurant(restaurant_id uuid, admin_user_id uuid, reject_reason text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.reject_restaurant(restaurant_id uuid, admin_user_id uuid, reject_reason text) IS '맛집 거부 처리 (관리자 전용)';


--
-- Name: reject_restaurant_submission(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_restaurant_submission(p_submission_id uuid, p_admin_user_id uuid, p_rejection_reason text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_is_admin BOOLEAN;
BEGIN
    -- 관리자 권한 확인
    SELECT public.is_user_admin(p_admin_user_id) INTO v_is_admin;
    IF NOT v_is_admin THEN
        RAISE EXCEPTION '관리자 권한이 필요합니다.';
    END IF;

    -- 제보 거부 처리
    UPDATE public.restaurant_submissions
    SET
        status = 'all_deleted',
        rejection_reason = p_rejection_reason,
        resolved_by_admin_id = p_admin_user_id,
        reviewed_at = now(),
        updated_at = now()
    WHERE
        id = p_submission_id
        AND status = 'pending';

    RETURN FOUND;
END;
$$;


--
-- Name: FUNCTION reject_restaurant_submission(p_submission_id uuid, p_admin_user_id uuid, p_rejection_reason text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.reject_restaurant_submission(p_submission_id uuid, p_admin_user_id uuid, p_rejection_reason text) IS '제보 거부 (관리자 전용)';


--
-- Name: reject_submission(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_submission(p_submission_id uuid, p_admin_user_id uuid, p_rejection_reason text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: FUNCTION reject_submission(p_submission_id uuid, p_admin_user_id uuid, p_rejection_reason text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.reject_submission(p_submission_id uuid, p_admin_user_id uuid, p_rejection_reason text) IS '제보 전체 거부 (모든 항목 일괄 거부)';


--
-- Name: reject_submission_item(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_submission_item(p_item_id uuid, p_admin_user_id uuid, p_rejection_reason text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
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


--
-- Name: FUNCTION reject_submission_item(p_item_id uuid, p_admin_user_id uuid, p_rejection_reason text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.reject_submission_item(p_item_id uuid, p_admin_user_id uuid, p_rejection_reason text) IS '제보 개별 항목 거부';


--
-- Name: reset_weekly_search_count(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reset_weekly_search_count() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  -- weekly_search_count를 0으로 초기화
  UPDATE public.restaurants
  SET weekly_search_count = 0;
  
  -- 로그 기록
  RAISE NOTICE 'Weekly search count has been reset at %', NOW();
END;
$$;


--
-- Name: search_restaurants(text, text[], integer, real); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_restaurants(search_query text, search_categories text[] DEFAULT NULL::text[], max_results integer DEFAULT 50, similarity_threshold real DEFAULT 0.1) RETURNS TABLE(id uuid, name text, categories text[], road_address text, jibun_address text, lat numeric, lng numeric, review_count integer, similarity real, edit_distance integer)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        r.id,
        r.name,
        r.categories,
        r.road_address,
        r.jibun_address,
        r.lat,
        r.lng,
        r.review_count,
        GREATEST(
            similarity(r.name, search_query),
            similarity(COALESCE(r.road_address, ''), search_query),
            similarity(COALESCE(r.jibun_address, ''), search_query)
        ) AS similarity,
        
        -- 이름에 대한 Levenshtein 거리 계산
        levenshtein(r.name, search_query) AS edit_distance 
        
    FROM public.restaurants r
    WHERE 
        (search_categories IS NULL OR r.categories && search_categories)
        
        -- [1단계: 필터링] Trigram GIN 인덱스를 사용하여 빠르게 후보군 필터링
        AND GREATEST(
            similarity(r.name, search_query),
            similarity(COALESCE(r.road_address, ''), search_query),
            similarity(COALESCE(r.jibun_address, ''), search_query)
        ) > similarity_threshold
        
    -- [2단계: 재정렬] 편집 거리가 짧은 순(정확도) -> 유사도가 높은 순(보조)
    ORDER BY 
        edit_distance ASC, 
        similarity DESC, 
        r.review_count DESC
    LIMIT max_results;
END;
$$;


--
-- Name: FUNCTION search_restaurants(search_query text, search_categories text[], max_results integer, similarity_threshold real); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.search_restaurants(search_query text, search_categories text[], max_results integer, similarity_threshold real) IS '맛집 검색 함수 (하이브리드: Trigram 인덱스 필터링 + Levenshtein 정렬)';


--
-- Name: search_restaurants_by_category(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_restaurants_by_category(p_category text, p_limit integer DEFAULT 10) RETURNS TABLE(id uuid, name text, categories text[], youtube_link text, description_map_url text, video_id text)
    LANGUAGE sql STABLE
    AS $$
  select
    r.id,
    r.approved_name as name,
    r.categories,
    r.youtube_link,
    r.description_map_url,
    -- youtube_link에서 video_id 추출 (간단한 파싱, Regex 필요시 조정)
    substring(r.youtube_link from 'v=([^&]+)') as video_id
  from restaurants r
  where r.status = 'approved'
    and p_category = any(r.categories)
  limit p_limit;
$$;


--
-- Name: search_restaurants_by_name(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_restaurants_by_name(keyword text, p_limit integer DEFAULT 5) RETURNS TABLE(id uuid, name text, categories text[], youtube_link text, video_id text, tzuyang_review text)
    LANGUAGE sql STABLE
    AS $$
  select
    r.id,
    r.approved_name as name,
    r.categories,
    r.youtube_link,
    substring(r.youtube_link from 'v=([^&]+)') as video_id,
    r.tzuyang_review
  from restaurants r
  where r.status = 'approved'
    and (r.approved_name ilike '%' || keyword || '%')
  limit p_limit;
$$;


--
-- Name: search_restaurants_by_name(text, text[], integer, boolean, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_restaurants_by_name(search_query text, search_categories text[] DEFAULT NULL::text[], max_results integer DEFAULT 50, include_all_status boolean DEFAULT false, korean_only boolean DEFAULT false) RETURNS TABLE(id uuid, name text, road_address text, jibun_address text, phone text, categories text[], youtube_link text, tzuyang_review text, lat numeric, lng numeric, status text, created_at timestamp with time zone, updated_at timestamp with time zone, english_address text, youtube_meta jsonb, complete_match_score integer, word_match_score double precision, trigram_similarity real, levenshtein_distance integer)
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $$
DECLARE
    clean_search_query TEXT;
    min_word_match_threshold DOUBLE PRECISION := 0.33; -- 최소 1/3 단어 매칭
BEGIN
    -- 검색어 정리
    clean_search_query := TRIM(search_query);
    
    -- 빈 검색어는 빈 결과 반환
    IF clean_search_query = '' THEN
        RETURN;
    END IF;
    
    RETURN QUERY
    SELECT 
        r.id,
        r.name,
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
        -- 완전 포함 점수: 검색어가 맛집명에 그대로 포함되면 1, 아니면 0
        CASE 
            WHEN LOWER(r.name) LIKE '%' || LOWER(clean_search_query) || '%' THEN 1
            ELSE 0
        END AS complete_match_score,
        -- 단어 매칭 점수
        calculate_word_match_score(r.name, clean_search_query) AS word_match_score,
        -- Trigram 유사도 (띄어쓰기 제거)
        extensions.similarity(
            REPLACE(LOWER(r.name), ' ', ''),
            REPLACE(LOWER(clean_search_query), ' ', '')
        ) AS trigram_similarity,
        -- 레벤슈타인 거리 (편집 거리)
        extensions.levenshtein(
            LOWER(r.name),
            LOWER(clean_search_query)
        ) AS levenshtein_distance
    FROM 
        public.restaurants r
    WHERE 
        -- 상태 필터: include_all_status가 true면 전체, false면 approved만
        (include_all_status = TRUE OR r.status = 'approved')
        -- 카테고리 필터 (선택적)
        AND (search_categories IS NULL OR r.categories && search_categories)
        -- 한국 지역 필터 (선택적)
        AND (
            korean_only = FALSE 
            OR COALESCE(r.road_address, r.jibun_address, r.english_address, '') ~ '(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|충청북도|충청남도|전북특별자치도|전라남도|경상북도|경상남도|제주특별자치도)'
        )
        -- 필수 조건: 최소 1글자 이상 포함
        AND EXISTS (
            SELECT 1
            FROM unnest(string_to_array(LOWER(clean_search_query), NULL)) AS query_char
            WHERE query_char != '' AND LOWER(r.name) LIKE '%' || query_char || '%'
        )
    ORDER BY 
        -- 1단계: 검색어가 그대로 포함되는지 여부 (포함=0, 미포함=1)
        CASE WHEN LOWER(r.name) LIKE '%' || LOWER(clean_search_query) || '%' THEN 0 ELSE 1 END,
        -- 2단계: 우선순위
        -- 2-1. 단어 매칭 점수 (높을수록 좋음)
        word_match_score DESC,
        -- 2-2. Trigram 유사도 (띄어쓰기 제거, 높을수록 좋음)
        trigram_similarity DESC,
        -- 2-3. 레벤슈타인 거리 (작을수록 좋음)
        levenshtein_distance ASC,
        -- 2-4. 이름 길이 (짧을수록 좋음)
        LENGTH(r.name) ASC
    LIMIT max_results;
END;
$$;


--
-- Name: FUNCTION search_restaurants_by_name(search_query text, search_categories text[], max_results integer, include_all_status boolean, korean_only boolean); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.search_restaurants_by_name(search_query text, search_categories text[], max_results integer, include_all_status boolean, korean_only boolean) IS '맛집 이름으로 검색 (완전 포함 → 단어 매칭 → Trigram 유사도 → 레벤슈타인 거리 우선순위)';


--
-- Name: search_restaurants_by_youtube_title(text, integer, boolean, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_restaurants_by_youtube_title(search_query text, max_results integer DEFAULT 50, include_all_status boolean DEFAULT false, korean_only boolean DEFAULT false) RETURNS TABLE(id uuid, name text, road_address text, jibun_address text, phone text, categories text[], youtube_link text, tzuyang_review text, lat numeric, lng numeric, status text, english_address text, youtube_title text, youtube_meta jsonb, origin_address jsonb, address_elements jsonb, reasoning_basis text, evaluation_results jsonb, complete_match_score integer, word_match_score double precision, trigram_similarity real, levenshtein_distance integer)
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
    AS $$
DECLARE
    clean_search_query TEXT;
    min_word_match_threshold DOUBLE PRECISION := 0.33; -- 최소 1/3 단어 매칭
BEGIN
    -- 검색어 정리
    clean_search_query := TRIM(search_query);
    
    -- 빈 검색어는 빈 결과 반환
    IF clean_search_query = '' THEN
        RETURN;
    END IF;
    
    -- youtube_meta JSONB에서 title 추출하여 검색
    RETURN QUERY
    SELECT 
        r.id,
        r.approved_name AS name,
        r.road_address,
        r.jibun_address,
        r.phone,
        r.categories,
        r.youtube_link,
        r.tzuyang_review,
        r.lat,
        r.lng,
        r.status,
        r.english_address,
        (r.youtube_meta->>'title')::TEXT AS youtube_title,
        r.youtube_meta,
        r.origin_address,
        r.address_elements,
        r.reasoning_basis,
        r.evaluation_results,
        -- 완전 포함 점수
        CASE 
            WHEN LOWER(r.youtube_meta->>'title') LIKE '%' || LOWER(clean_search_query) || '%' THEN 1
            ELSE 0
        END AS complete_match_score,
        -- 단어 매칭 점수
        calculate_word_match_score(r.youtube_meta->>'title', clean_search_query) AS word_match_score,
        -- Trigram 유사도 (띄어쓰기 제거)
        extensions.similarity(
            REPLACE(LOWER(r.youtube_meta->>'title'), ' ', ''),
            REPLACE(LOWER(clean_search_query), ' ', '')
        ) AS trigram_similarity,
        -- 레벤슈타인 거리
        extensions.levenshtein(
            LOWER(r.youtube_meta->>'title'),
            LOWER(clean_search_query)
        ) AS levenshtein_distance
    FROM 
        public.restaurants r
    WHERE 
        -- 상태 필터: include_all_status가 true면 전체, false면 approved만
        (include_all_status = TRUE OR r.status = 'approved')
        AND r.youtube_meta IS NOT NULL
        AND r.youtube_meta->>'title' IS NOT NULL
        AND r.youtube_meta->>'title' != ''
        -- 한국 지역 필터 (선택적)
        AND (
            korean_only = FALSE 
            OR COALESCE(r.road_address, r.jibun_address, r.english_address, '') ~ '(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|충청북도|충청남도|전북특별자치도|전라남도|경상북도|경상남도|제주특별자치도)'
        )
        -- 필수 조건: 최소 1글자 이상 포함
        AND EXISTS (
            SELECT 1
            FROM unnest(string_to_array(LOWER(clean_search_query), NULL)) AS query_char
            WHERE query_char != '' AND LOWER(r.youtube_meta->>'title') LIKE '%' || query_char || '%'
        )
    ORDER BY 
        -- 1단계: 검색어가 그대로 포함되는지 여부 (포함=0, 미포함=1)
        CASE WHEN LOWER(r.youtube_meta->>'title') LIKE '%' || LOWER(clean_search_query) || '%' THEN 0 ELSE 1 END,
        -- 2단계: 우선순위
        -- 2-1. 단어 매칭 점수 (높을수록 좋음)
        word_match_score DESC,
        -- 2-2. Trigram 유사도 (띄어쓰기 제거, 높을수록 좋음)
        trigram_similarity DESC,
        -- 2-3. 레벤슈타인 거리 (작을수록 좋음)
        levenshtein_distance ASC,
        -- 2-4. 제목 길이 (짧을수록 좋음)
        LENGTH(r.youtube_meta->>'title') ASC
    LIMIT max_results;
END;
$$;


--
-- Name: FUNCTION search_restaurants_by_youtube_title(search_query text, max_results integer, include_all_status boolean, korean_only boolean); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.search_restaurants_by_youtube_title(search_query text, max_results integer, include_all_status boolean, korean_only boolean) IS '유튜브 제목으로 검색 (완전 포함 → 단어 매칭 → Trigram 유사도 → 레벤슈타인 거리 우선순위)';


--
-- Name: search_video_ids_by_query(public.vector, jsonb, double precision, double precision, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_video_ids_by_query(query_embedding public.vector, query_sparse jsonb, dense_weight double precision DEFAULT 0.6, match_threshold double precision DEFAULT 0.5, match_count integer DEFAULT 10) RETURNS TABLE(video_id text, recollect_id integer, best_score double precision, sample_content text, has_peak boolean)
    LANGUAGE plpgsql STABLE
    AS $$
#variable_conflict use_column
begin
  return query
  with 
  candidates as (
    select
      teb.video_id, teb.recollect_id, teb.page_content, teb.metadata, teb.embedding, teb.sparse_embedding,
      1 - (teb.embedding <=> query_embedding) as dense_score
    from transcript_embeddings_bge teb
    where 1 - (teb.embedding <=> query_embedding) > match_threshold
    order by teb.embedding <=> query_embedding
    limit match_count * 5
  ),
  valid_candidates as (
    select c.*
    from candidates c
    where c.recollect_id = (
        select max(recollect_id) 
        from transcript_embeddings_bge 
        where video_id = c.video_id
    )
  ),
  scored as (
    select 
      vc.video_id,
      vc.recollect_id,
      vc.page_content,
      vc.metadata,
      (vc.dense_score * dense_weight) +
      coalesce(
        (select sum((vc.sparse_embedding->>k)::float * (query_sparse->>k)::float)
         from jsonb_object_keys(query_sparse) k
         where vc.sparse_embedding ? k), 0
      ) * (1 - dense_weight) as score
    from valid_candidates vc
  ),
  ranked as (
    select 
      s.video_id,
      s.recollect_id,
      s.score,
      s.page_content,
      s.metadata,
      row_number() over (partition by s.video_id order by s.score desc) as rn
    from scored s
  )
  select 
    r.video_id,
    r.recollect_id,
    r.score::float as best_score,
    left(r.page_content, 150) as sample_content,
    (r.metadata->>'is_peak')::boolean as has_peak
  from ranked r
  where r.rn = 1
  order by r.score desc
  limit match_count;
end;
$$;


--
-- Name: set_review_edited_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_review_edited_at() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    IF NEW.is_edited_by_admin = true AND (OLD.is_edited_by_admin IS NULL OR OLD.is_edited_by_admin = false) THEN
        NEW.edited_at = now();
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: FUNCTION set_review_edited_at(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.set_review_edited_at() IS '리뷰를 관리자가 수정할 때 수정 시간 자동 설정';


--
-- Name: soft_delete_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.soft_delete_user() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    -- profiles 테이블에 deleted_at 설정
    UPDATE public.profiles
    SET deleted_at = now()
    WHERE user_id = (SELECT auth.uid())
    AND deleted_at IS NULL;
    
    -- 알림: 클라이언트에서 signOut() 호출 필요
END;
$$;


--
-- Name: FUNCTION soft_delete_user(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.soft_delete_user() IS '현재 사용자 소프트 삭제 (deleted_at 설정, auth.users는 유지)';


--
-- Name: sync_submission_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_submission_status() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_new_status submission_status;
BEGIN
    -- item 상태가 변경되면 부모 submission 상태 재계산
    v_new_status := public.calculate_submission_status(
        COALESCE(NEW.submission_id, OLD.submission_id)
    );
    
    UPDATE public.restaurant_submissions
    SET 
        status = v_new_status,
        updated_at = now()
    WHERE id = COALESCE(NEW.submission_id, OLD.submission_id)
      AND status != v_new_status; -- 변경이 있을 때만 업데이트
    
    RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: update_ad_banners_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_ad_banners_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: update_announcements_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_announcements_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


--
-- Name: update_table_statistics(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_table_statistics() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    -- 주요 테이블의 통계 정보 업데이트
    ANALYZE public.restaurants;
    ANALYZE public.reviews;
    ANALYZE public.review_likes;
    ANALYZE public.user_stats;
    ANALYZE public.notifications;
END;
$$;


--
-- Name: FUNCTION update_table_statistics(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.update_table_statistics() IS '주요 테이블의 통계 정보 업데이트 (쿼리 플래너 최적화)';


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


--
-- Name: FUNCTION update_updated_at_column(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.update_updated_at_column() IS '레코드 수정 시 updated_at 컬럼 자동 업데이트';


--
-- Name: update_user_stats_on_review(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_user_stats_on_review() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
    -- 리뷰 신규 작성
    IF TG_OP = 'INSERT' THEN
        UPDATE public.user_stats
        SET
            review_count = COALESCE(review_count, 0) + 1,
            last_updated = now()
        WHERE user_id = NEW.user_id;
        
        -- 맛집 리뷰 카운트 증가
        UPDATE public.restaurants
        SET review_count = COALESCE(review_count, 0) + 1
        WHERE id = NEW.restaurant_id;

        RETURN NEW;

    -- 리뷰 인증 처리
    ELSIF TG_OP = 'UPDATE' AND NEW.is_verified = true AND OLD.is_verified = false THEN
        UPDATE public.user_stats
        SET
            verified_review_count = COALESCE(verified_review_count, 0) + 1,
            trust_score = LEAST(COALESCE(trust_score, 0) + 5, 100), -- 인증 시 신뢰도 +5 (최대 100)
            last_updated = now()
        WHERE user_id = NEW.user_id;

        RETURN NEW;

    -- 리뷰 삭제
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE public.user_stats
        SET
            review_count = GREATEST(COALESCE(review_count, 0) - 1, 0),
            verified_review_count = CASE
                WHEN OLD.is_verified THEN GREATEST(COALESCE(verified_review_count, 0) - 1, 0)
                ELSE COALESCE(verified_review_count, 0)
            END,
            last_updated = now()
        WHERE user_id = OLD.user_id;
        
        -- 맛집 리뷰 카운트 감소
        UPDATE public.restaurants
        SET review_count = GREATEST(COALESCE(review_count, 0) - 1, 0)
        WHERE id = OLD.restaurant_id;

        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$$;


--
-- Name: FUNCTION update_user_stats_on_review(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.update_user_stats_on_review() IS '리뷰 작성/인증/삭제 시 사용자 통계 및 맛집 리뷰 카운트 자동 업데이트';


--
-- Name: update_youtuber_restaurant_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_youtuber_restaurant_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$;


--
-- Name: verify_review_like_counts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.verify_review_like_counts() RETURNS TABLE(review_id uuid, cached_count integer, actual_count bigint, difference integer)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
    SELECT 
        r.id as review_id,
        r.like_count as cached_count,
        COUNT(rl.id) as actual_count,
        (r.like_count - COUNT(rl.id))::INTEGER as difference
    FROM public.reviews r
    LEFT JOIN public.review_likes rl ON r.id = rl.review_id
    GROUP BY r.id, r.like_count
    HAVING r.like_count != COUNT(rl.id);
$$;


--
-- Name: FUNCTION verify_review_like_counts(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.verify_review_like_counts() IS '리뷰의 캐시된 like_count와 실제 review_likes 개수 불일치 검증';


--
-- Name: ad_banners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ad_banners (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    image_url text,
    link_url text,
    is_active boolean DEFAULT true NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    display_target text[] DEFAULT ARRAY['sidebar'::text, 'mobile_popup'::text] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    video_url text,
    media_type text DEFAULT 'none'::text,
    CONSTRAINT ad_banners_media_type_check CHECK ((media_type = ANY (ARRAY['image'::text, 'video'::text, 'none'::text])))
);


--
-- Name: TABLE ad_banners; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ad_banners IS '광고 배너 테이블 - 사이드바 및 모바일/태블릿 팝업에서 표시';


--
-- Name: COLUMN ad_banners.priority; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ad_banners.priority IS '우선순위 (높을수록 먼저 표시)';


--
-- Name: COLUMN ad_banners.display_target; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ad_banners.display_target IS '표시 위치: sidebar, mobile_popup';


--
-- Name: announcements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.announcements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_by uuid,
    title text NOT NULL,
    content text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    show_on_banner boolean DEFAULT false NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    CONSTRAINT announcements_content_length_check CHECK ((char_length(content) >= 1)),
    CONSTRAINT announcements_priority_range_check CHECK (((priority >= 0) AND (priority <= 100))),
    CONSTRAINT announcements_title_length_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 100)))
);


--
-- Name: TABLE announcements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.announcements IS '관리자 공지사항 테이블';


--
-- Name: COLUMN announcements.created_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.announcements.created_by IS '공지 작성 관리자 ID';


--
-- Name: COLUMN announcements.title; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.announcements.title IS '공지 제목 (1-100자)';


--
-- Name: COLUMN announcements.content; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.announcements.content IS '공지 내용 (1자 이상)';


--
-- Name: COLUMN announcements.is_active; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.announcements.is_active IS '공지 활성화 여부';


--
-- Name: document_embeddings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_embeddings (
    id integer NOT NULL,
    video_id text NOT NULL,
    chunk_index integer NOT NULL,
    recollect_id integer DEFAULT 0 NOT NULL,
    page_content text NOT NULL,
    embedding public.vector(1536),
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: transcript_embeddings_bge; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transcript_embeddings_bge (
    id bigint NOT NULL,
    video_id text NOT NULL,
    chunk_index integer NOT NULL,
    recollect_id integer DEFAULT 0 NOT NULL,
    page_content text NOT NULL,
    embedding public.vector(1024),
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    sparse_embedding jsonb
);


--
-- Name: document_embeddings_bge_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.transcript_embeddings_bge ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.document_embeddings_bge_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: document_embeddings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.document_embeddings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: document_embeddings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.document_embeddings_id_seq OWNED BY public.document_embeddings.id;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    type public.notification_type DEFAULT 'system'::public.notification_type NOT NULL,
    title text NOT NULL,
    message text NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    data jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notifications_message_check CHECK (((length(message) >= 1) AND (length(message) <= 500))),
    CONSTRAINT notifications_title_check CHECK (((length(title) >= 1) AND (length(title) <= 100)))
);


--
-- Name: TABLE notifications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.notifications IS '사용자 알림 테이블';


--
-- Name: COLUMN notifications.type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notifications.type IS '알림 타입 (system, user, admin_announcement 등)';


--
-- Name: COLUMN notifications.title; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notifications.title IS '알림 제목 (1-100자)';


--
-- Name: COLUMN notifications.message; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notifications.message IS '알림 내용 (1-500자)';


--
-- Name: COLUMN notifications.is_read; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notifications.is_read IS '읽음 여부';


--
-- Name: COLUMN notifications.data; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.notifications.data IS '추가 데이터 (JSONB)';


--
-- Name: ocr_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ocr_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    image_hash text NOT NULL,
    model_used text DEFAULT 'gemini-3-flash-preview'::text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    success boolean DEFAULT true,
    metadata jsonb
);


--
-- Name: restaurant_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.restaurant_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    restaurant_name text NOT NULL,
    origin_address text NOT NULL,
    phone text,
    categories text[],
    recommendation_reason text NOT NULL,
    youtube_link text,
    lat numeric,
    lng numeric,
    geocoding_success boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    road_address text,
    jibun_address text,
    english_address text,
    address_elements jsonb,
    CONSTRAINT requests_categories_check CHECK (((categories IS NULL) OR ((array_length(categories, 1) > 0) AND (array_length(categories, 1) <= 5)))),
    CONSTRAINT requests_lat_check CHECK (((lat IS NULL) OR ((lat >= ('-90'::integer)::numeric) AND (lat <= (90)::numeric)))),
    CONSTRAINT requests_lng_check CHECK (((lng IS NULL) OR ((lng >= ('-180'::integer)::numeric) AND (lng <= (180)::numeric)))),
    CONSTRAINT requests_name_check CHECK (((length(restaurant_name) >= 1) AND (length(restaurant_name) <= 100))),
    CONSTRAINT requests_origin_address_check CHECK ((length(origin_address) >= 1)),
    CONSTRAINT requests_reason_check CHECK ((length(recommendation_reason) >= 10))
);


--
-- Name: TABLE restaurant_requests; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.restaurant_requests IS '쯔양에게 맛집 추천 제보 테이블 (승인 과정 없음, 지오코딩 후 지도 표시용)';


--
-- Name: COLUMN restaurant_requests.origin_address; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurant_requests.origin_address IS '사용자가 입력한 원본 주소';


--
-- Name: COLUMN restaurant_requests.road_address; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurant_requests.road_address IS '정규화된 도로명주소 (지오코딩 결과)';


--
-- Name: COLUMN restaurant_requests.jibun_address; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurant_requests.jibun_address IS '정규화된 지번주소 (지오코딩 결과)';


--
-- Name: COLUMN restaurant_requests.english_address; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurant_requests.english_address IS '영어주소 (지오코딩 결과)';


--
-- Name: COLUMN restaurant_requests.address_elements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurant_requests.address_elements IS '주소요소 JSON (시/도, 구/군, 동 등)';


--
-- Name: restaurant_submission_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.restaurant_submission_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    submission_id uuid NOT NULL,
    youtube_link text NOT NULL,
    tzuyang_review text,
    item_status text DEFAULT 'pending'::text NOT NULL,
    rejection_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    target_restaurant_id uuid,
    CONSTRAINT items_approved_link_check CHECK (((item_status <> 'approved'::text) OR ((item_status = 'approved'::text) AND (target_restaurant_id IS NOT NULL)))),
    CONSTRAINT items_status_check CHECK ((item_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text]))),
    CONSTRAINT items_youtube_link_check CHECK ((youtube_link ~ '^https?://'::text))
);


--
-- Name: TABLE restaurant_submission_items; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.restaurant_submission_items IS '제보 개별 항목 테이블 (유튜브 영상 + 쯔양 리뷰 묶음)';


--
-- Name: COLUMN restaurant_submission_items.item_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurant_submission_items.item_status IS '개별 항목 상태 (pending/approved/rejected)';


--
-- Name: COLUMN restaurant_submission_items.target_restaurant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurant_submission_items.target_restaurant_id IS 'EDIT 제보 시 수정 대상 식당 ID';


--
-- Name: restaurant_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.restaurant_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    submission_type public.submission_type NOT NULL,
    status public.submission_status DEFAULT 'pending'::public.submission_status NOT NULL,
    restaurant_name text NOT NULL,
    restaurant_address text,
    restaurant_phone text,
    restaurant_categories text[],
    admin_notes text,
    rejection_reason text,
    resolved_by_admin_id uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT submissions_categories_check CHECK (((restaurant_categories IS NULL) OR ((array_length(restaurant_categories, 1) > 0) AND (array_length(restaurant_categories, 1) <= 5)))),
    CONSTRAINT submissions_name_check CHECK (((length(restaurant_name) >= 1) AND (length(restaurant_name) <= 100)))
);


--
-- Name: TABLE restaurant_submissions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.restaurant_submissions IS '사용자 맛집 제보(신규/수정) 테이블 - 정규화된 구조';


--
-- Name: COLUMN restaurant_submissions.submission_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurant_submissions.submission_type IS '제보 유형 (new: 신규, edit: 수정)';


--
-- Name: COLUMN restaurant_submissions.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.restaurant_submissions.status IS '제보 상태 (pending/approved/partially_approved/rejected)';


--
-- Name: restaurants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.restaurants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    approved_name text,
    phone text,
    categories text[],
    lat numeric,
    lng numeric,
    road_address text,
    jibun_address text,
    english_address text,
    address_elements jsonb DEFAULT '{}'::jsonb,
    origin_address jsonb,
    youtube_meta jsonb,
    trace_id text,
    reasoning_basis text,
    evaluation_results jsonb,
    source_type text,
    geocoding_success boolean DEFAULT false,
    geocoding_false_stage integer,
    status text DEFAULT 'pending'::text,
    is_missing boolean DEFAULT false,
    is_not_selected boolean DEFAULT false,
    review_count integer DEFAULT 0,
    created_by uuid,
    updated_by_admin_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    db_error_message text,
    db_error_details jsonb,
    tzuyang_review text,
    youtube_link text,
    search_count integer DEFAULT 0,
    weekly_search_count integer DEFAULT 0,
    origin_name text,
    naver_name text,
    trace_id_name_source text,
    channel_name text,
    description_map_url text,
    recollect_version jsonb
);


--
-- Name: TABLE restaurants; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.restaurants IS 'This is a duplicate of restaurants_duplicate';


--
-- Name: restaurants_duplicate; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.restaurants_duplicate (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    approved_name text,
    phone text,
    categories text[],
    lat numeric,
    lng numeric,
    road_address text,
    jibun_address text,
    english_address text,
    address_elements jsonb DEFAULT '{}'::jsonb,
    origin_address jsonb,
    youtube_meta jsonb,
    trace_id text,
    reasoning_basis text,
    evaluation_results jsonb,
    source_type text,
    geocoding_success boolean DEFAULT false,
    geocoding_false_stage integer,
    status text DEFAULT 'pending'::text,
    is_missing boolean DEFAULT false,
    is_not_selected boolean DEFAULT false,
    review_count integer DEFAULT 0,
    created_by uuid,
    updated_by_admin_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    db_error_message text,
    db_error_details jsonb,
    tzuyang_review text,
    youtube_link text,
    search_count integer DEFAULT 0,
    weekly_search_count integer DEFAULT 0,
    origin_name text,
    naver_name text,
    trace_id_name_source text,
    channel_name text,
    description_map_url text,
    recollect_version jsonb
);


--
-- Name: TABLE restaurants_duplicate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.restaurants_duplicate IS 'This is a duplicate of restaurants';


--
-- Name: search_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.search_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    restaurant_id uuid NOT NULL,
    user_id uuid,
    session_id text,
    searched_at timestamp with time zone DEFAULT now(),
    ip_address inet,
    user_agent text,
    counted boolean DEFAULT true
);


--
-- Name: server_costs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.server_costs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    item_name text NOT NULL,
    monthly_cost numeric NOT NULL,
    description text,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT server_costs_item_name_check CHECK ((length(item_name) >= 2)),
    CONSTRAINT server_costs_monthly_cost_check CHECK ((monthly_cost >= (0)::numeric))
);


--
-- Name: TABLE server_costs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.server_costs IS '서버 운영 비용 테이블';


--
-- Name: COLUMN server_costs.item_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.server_costs.item_name IS '비용 항목명 (최소 2자)';


--
-- Name: COLUMN server_costs.monthly_cost; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.server_costs.monthly_cost IS '월 비용 (0 이상)';


--
-- Name: COLUMN server_costs.description; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.server_costs.description IS '비용 설명';


--
-- Name: short_urls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.short_urls (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    code character varying(10) NOT NULL,
    target_url text NOT NULL,
    restaurant_id uuid,
    restaurant_name text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE short_urls; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.short_urls IS 'Short URL mapping table (RLS enabled, public read, service_role write)';


--
-- Name: user_bookmarks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_bookmarks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    restaurant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE user_bookmarks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_bookmarks IS '사용자 맛집 북마크';


--
-- Name: COLUMN user_bookmarks.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_bookmarks.user_id IS '북마크한 사용자 ID';


--
-- Name: COLUMN user_bookmarks.restaurant_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_bookmarks.restaurant_id IS '북마크된 맛집 ID';


--
-- Name: COLUMN user_bookmarks.created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_bookmarks.created_at IS '북마크 생성 시간';


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role DEFAULT 'user'::public.app_role NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE user_roles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.user_roles IS '사용자 역할 관리 테이블 (admin, user)';


--
-- Name: COLUMN user_roles.user_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_roles.user_id IS 'auth.users 테이블의 사용자 ID';


--
-- Name: COLUMN user_roles.role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.user_roles.role IS '사용자 역할 (admin: 관리자, user: 일반 사용자)';


--
-- Name: video_frame_captions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.video_frame_captions ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.video_frame_captions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: document_embeddings id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_embeddings ALTER COLUMN id SET DEFAULT nextval('public.document_embeddings_id_seq'::regclass);


--
-- Name: ad_banners ad_banners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_banners
    ADD CONSTRAINT ad_banners_pkey PRIMARY KEY (id);


--
-- Name: announcements announcements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);


--
-- Name: transcript_embeddings_bge document_embeddings_bge_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transcript_embeddings_bge
    ADD CONSTRAINT document_embeddings_bge_pkey PRIMARY KEY (id);


--
-- Name: transcript_embeddings_bge document_embeddings_bge_unique_version; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transcript_embeddings_bge
    ADD CONSTRAINT document_embeddings_bge_unique_version UNIQUE (video_id, chunk_index, recollect_id);


--
-- Name: document_embeddings document_embeddings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_embeddings
    ADD CONSTRAINT document_embeddings_pkey PRIMARY KEY (id);


--
-- Name: document_embeddings document_embeddings_unique_version; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_embeddings
    ADD CONSTRAINT document_embeddings_unique_version UNIQUE (video_id, chunk_index, recollect_id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: ocr_logs ocr_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocr_logs
    ADD CONSTRAINT ocr_logs_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_nickname_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_nickname_key UNIQUE (nickname);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_key UNIQUE (user_id);


--
-- Name: restaurant_requests restaurant_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_requests
    ADD CONSTRAINT restaurant_requests_pkey PRIMARY KEY (id);


--
-- Name: restaurant_submission_items restaurant_submission_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_submission_items
    ADD CONSTRAINT restaurant_submission_items_pkey PRIMARY KEY (id);


--
-- Name: restaurant_submissions restaurant_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_submissions
    ADD CONSTRAINT restaurant_submissions_pkey PRIMARY KEY (id);


--
-- Name: restaurants restaurants_duplicate_duplicate_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurants
    ADD CONSTRAINT restaurants_duplicate_duplicate_pkey PRIMARY KEY (id);


--
-- Name: restaurants restaurants_duplicate_duplicate_trace_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurants
    ADD CONSTRAINT restaurants_duplicate_duplicate_trace_id_key UNIQUE (trace_id);


--
-- Name: restaurants_duplicate restaurants_duplicate_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurants_duplicate
    ADD CONSTRAINT restaurants_duplicate_pkey PRIMARY KEY (id);


--
-- Name: restaurants_duplicate restaurants_duplicate_trace_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurants_duplicate
    ADD CONSTRAINT restaurants_duplicate_trace_id_key UNIQUE (trace_id);


--
-- Name: restaurants_backup restaurants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurants_backup
    ADD CONSTRAINT restaurants_pkey PRIMARY KEY (id);


--
-- Name: restaurants_backup restaurants_unique_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurants_backup
    ADD CONSTRAINT restaurants_unique_id_key UNIQUE (unique_id);


--
-- Name: review_likes review_likes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_likes
    ADD CONSTRAINT review_likes_pkey PRIMARY KEY (id);


--
-- Name: review_likes review_likes_review_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_likes
    ADD CONSTRAINT review_likes_review_id_user_id_key UNIQUE (review_id, user_id);


--
-- Name: reviews reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);


--
-- Name: search_logs search_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_logs
    ADD CONSTRAINT search_logs_pkey PRIMARY KEY (id);


--
-- Name: server_costs server_costs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.server_costs
    ADD CONSTRAINT server_costs_pkey PRIMARY KEY (id);


--
-- Name: short_urls short_urls_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.short_urls
    ADD CONSTRAINT short_urls_code_key UNIQUE (code);


--
-- Name: short_urls short_urls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.short_urls
    ADD CONSTRAINT short_urls_pkey PRIMARY KEY (id);


--
-- Name: user_bookmarks unique_user_restaurant_bookmark; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_bookmarks
    ADD CONSTRAINT unique_user_restaurant_bookmark UNIQUE (user_id, restaurant_id);


--
-- Name: user_bookmarks user_bookmarks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_bookmarks
    ADD CONSTRAINT user_bookmarks_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);


--
-- Name: user_stats user_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_stats
    ADD CONSTRAINT user_stats_pkey PRIMARY KEY (id);


--
-- Name: user_stats user_stats_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_stats
    ADD CONSTRAINT user_stats_user_id_key UNIQUE (user_id);


--
-- Name: video_frame_captions video_frame_captions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_frame_captions
    ADD CONSTRAINT video_frame_captions_pkey PRIMARY KEY (id);


--
-- Name: video_frame_captions video_frame_captions_unique_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.video_frame_captions
    ADD CONSTRAINT video_frame_captions_unique_key UNIQUE (video_id, recollect_id, start_sec);


--
-- Name: videos videos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.videos
    ADD CONSTRAINT videos_pkey PRIMARY KEY (id);


--
-- Name: idx_ad_banners_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ad_banners_created_by ON public.ad_banners USING btree (created_by);


--
-- Name: idx_ad_banners_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ad_banners_is_active ON public.ad_banners USING btree (is_active);


--
-- Name: idx_ad_banners_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ad_banners_priority ON public.ad_banners USING btree (priority DESC);


--
-- Name: idx_announcements_active_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_announcements_active_priority ON public.announcements USING btree (priority DESC, created_at DESC) WHERE (is_active = true);


--
-- Name: idx_announcements_admin_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_announcements_admin_id ON public.announcements USING btree (created_by);


--
-- Name: idx_announcements_banner_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_announcements_banner_priority ON public.announcements USING btree (priority DESC, created_at DESC) WHERE ((is_active = true) AND (show_on_banner = true));


--
-- Name: idx_announcements_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_announcements_created_by ON public.announcements USING btree (created_by) WHERE (created_by IS NOT NULL);


--
-- Name: idx_bge_embeddings_vector; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bge_embeddings_vector ON public.transcript_embeddings_bge USING hnsw (embedding public.vector_cosine_ops);


--
-- Name: idx_bge_embeddings_video_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bge_embeddings_video_id ON public.transcript_embeddings_bge USING btree (video_id);


--
-- Name: idx_bge_embeddings_video_recollect; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bge_embeddings_video_recollect ON public.transcript_embeddings_bge USING btree (video_id, recollect_id);


--
-- Name: idx_embeddings_video_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_embeddings_video_id ON public.document_embeddings USING btree (video_id);


--
-- Name: idx_embeddings_video_recollect; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_embeddings_video_recollect ON public.document_embeddings USING btree (video_id, recollect_id);


--
-- Name: idx_mv_popular_reviews_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mv_popular_reviews_id ON public.mv_popular_reviews USING btree (id);


--
-- Name: idx_mv_restaurant_stats_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mv_restaurant_stats_id ON public.mv_restaurant_stats USING btree (id);


--
-- Name: idx_mv_user_leaderboard_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_mv_user_leaderboard_user_id ON public.mv_user_leaderboard USING btree (user_id);


--
-- Name: idx_notifications_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_unread ON public.notifications USING btree (user_id, created_at DESC) WHERE (is_read = false);


--
-- Name: INDEX idx_notifications_unread; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_notifications_unread IS '읽지 않은 알림 조회 최적화';


--
-- Name: idx_notifications_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_created ON public.notifications USING btree (user_id, created_at DESC);


--
-- Name: INDEX idx_notifications_user_created; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_notifications_user_created IS '사용자별 최신 알림 조회 최적화';


--
-- Name: idx_ocr_logs_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ocr_logs_user_date ON public.ocr_logs USING btree (user_id, created_at DESC);


--
-- Name: idx_profiles_nickname; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_nickname ON public.profiles USING btree (nickname);


--
-- Name: INDEX idx_profiles_nickname; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_profiles_nickname IS '닉네임 검색 최적화 (UNIQUE - 중복 불가)';


--
-- Name: idx_profiles_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_user_id ON public.profiles USING btree (user_id);


--
-- Name: idx_restaurant_requests_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_requests_user_id ON public.restaurant_requests USING btree (user_id);


--
-- Name: idx_restaurant_submission_items_target_restaurant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_submission_items_target_restaurant_id ON public.restaurant_submission_items USING btree (target_restaurant_id);


--
-- Name: idx_restaurant_submissions_resolved_by_admin_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurant_submissions_resolved_by_admin_id ON public.restaurant_submissions USING btree (resolved_by_admin_id);


--
-- Name: idx_restaurants_approved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurants_approved ON public.restaurants_backup USING btree (created_at DESC, review_count DESC) WHERE (status = 'approved'::text);


--
-- Name: INDEX idx_restaurants_approved; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_restaurants_approved IS '승인된 맛집 조회 최적화 (일반 사용자용)';


--
-- Name: idx_restaurants_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurants_created_at ON public.restaurants_backup USING btree (created_at DESC);


--
-- Name: idx_restaurants_created_by_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurants_created_by_user ON public.restaurants_backup USING btree (created_by);


--
-- Name: idx_restaurants_geocoding_success; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurants_geocoding_success ON public.restaurants_backup USING btree (geocoding_success);


--
-- Name: idx_restaurants_jibun_address_pattern; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurants_jibun_address_pattern ON public.restaurants_backup USING btree (jibun_address text_pattern_ops);


--
-- Name: idx_restaurants_location_review_count; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurants_location_review_count ON public.restaurants_backup USING btree (lat, lng, review_count DESC);


--
-- Name: idx_restaurants_missing; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurants_missing ON public.restaurants_backup USING btree (created_at DESC) WHERE (is_missing = true);


--
-- Name: idx_restaurants_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurants_name ON public.restaurants_backup USING btree (name);


--
-- Name: INDEX idx_restaurants_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_restaurants_name IS '맛집 이름 검색 최적화';


--
-- Name: idx_restaurants_not_selected; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurants_not_selected ON public.restaurants_backup USING btree (created_at DESC) WHERE (is_not_selected = true);


--
-- Name: idx_restaurants_rejected; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurants_rejected ON public.restaurants_backup USING btree (created_at DESC) WHERE (status = 'rejected'::text);


--
-- Name: idx_restaurants_review_count; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurants_review_count ON public.restaurants_backup USING btree (review_count DESC);


--
-- Name: idx_restaurants_search_count; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurants_search_count ON public.restaurants_backup USING btree (search_count DESC);


--
-- Name: idx_restaurants_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurants_status ON public.restaurants_backup USING btree (status);


--
-- Name: INDEX idx_restaurants_status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_restaurants_status IS '상태별 검색 최적화 (pending, approved, rejected)';


--
-- Name: idx_restaurants_status_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurants_status_created ON public.restaurants_backup USING btree (status, created_at DESC);


--
-- Name: idx_restaurants_unique_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurants_unique_id ON public.restaurants_backup USING btree (unique_id);


--
-- Name: INDEX idx_restaurants_unique_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_restaurants_unique_id IS 'AI 크롤링 고유 ID 검색 최적화';


--
-- Name: idx_restaurants_updated_by_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurants_updated_by_admin ON public.restaurants_backup USING btree (updated_by_admin_id);


--
-- Name: idx_restaurants_weekly_search_count; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_restaurants_weekly_search_count ON public.restaurants_backup USING btree (weekly_search_count DESC);


--
-- Name: idx_review_likes_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_review_likes_user_id ON public.review_likes USING btree (user_id);


--
-- Name: idx_reviews_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_created_at ON public.reviews USING btree (created_at DESC);


--
-- Name: INDEX idx_reviews_created_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_reviews_created_at IS '최신 리뷰 조회 최적화';


--
-- Name: idx_reviews_edited_by_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_edited_by_admin ON public.reviews USING btree (edited_by_admin_id);


--
-- Name: idx_reviews_like_count; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_like_count ON public.reviews USING btree (like_count DESC) WHERE (is_verified = true);


--
-- Name: INDEX idx_reviews_like_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON INDEX public.idx_reviews_like_count IS '인증된 리뷰를 좋아요 개수 기준 내림차순 정렬 시 사용';


--
-- Name: idx_reviews_receipt_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_reviews_receipt_hash ON public.reviews USING btree (receipt_hash) WHERE (receipt_hash IS NOT NULL);


--
-- Name: idx_reviews_restaurant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_restaurant_id ON public.reviews USING btree (restaurant_id);


--
-- Name: idx_reviews_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_user_id ON public.reviews USING btree (user_id);


--
-- Name: idx_search_logs_restaurant_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_search_logs_restaurant_session ON public.search_logs USING btree (restaurant_id, session_id, searched_at DESC);


--
-- Name: idx_search_logs_restaurant_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_search_logs_restaurant_user ON public.search_logs USING btree (restaurant_id, user_id, searched_at DESC);


--
-- Name: idx_search_logs_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_search_logs_user_id ON public.search_logs USING btree (user_id);


--
-- Name: idx_server_costs_updated_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_server_costs_updated_by ON public.server_costs USING btree (updated_by);


--
-- Name: idx_short_urls_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_short_urls_code ON public.short_urls USING btree (code);


--
-- Name: idx_sparse_embedding_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sparse_embedding_gin ON public.transcript_embeddings_bge USING gin (sparse_embedding);


--
-- Name: idx_submission_items_submission_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_submission_items_submission_id ON public.restaurant_submission_items USING btree (submission_id);


--
-- Name: idx_submissions_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_submissions_created_at ON public.restaurant_submissions USING btree (created_at DESC);


--
-- Name: idx_submissions_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_submissions_pending ON public.restaurant_submissions USING btree (created_at DESC) WHERE (status = 'pending'::public.submission_status);


--
-- Name: idx_submissions_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_submissions_type ON public.restaurant_submissions USING btree (submission_type);


--
-- Name: idx_submissions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_submissions_user_id ON public.restaurant_submissions USING btree (user_id);


--
-- Name: idx_transcript_embeddings_bge_video_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transcript_embeddings_bge_video_id ON public.transcript_embeddings_bge USING btree (video_id);


--
-- Name: idx_user_bookmarks_restaurant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_bookmarks_restaurant_id ON public.user_bookmarks USING btree (restaurant_id);


--
-- Name: idx_user_bookmarks_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_bookmarks_user_id ON public.user_bookmarks USING btree (user_id);


--
-- Name: idx_video_frame_captions_duration; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_video_frame_captions_duration ON public.video_frame_captions USING btree (video_id, duration);


--
-- Name: idx_videos_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_videos_channel ON public.videos USING btree (channel_name);


--
-- Name: idx_videos_desc_fts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_videos_desc_fts ON public.videos USING gin (to_tsvector('simple'::regconfig, COALESCE(description, ''::text)));


--
-- Name: idx_videos_published; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_videos_published ON public.videos USING btree (published_at DESC);


--
-- Name: idx_videos_recollect_vars; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_videos_recollect_vars ON public.videos USING gin (recollect_vars);


--
-- Name: idx_videos_tags; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_videos_tags ON public.videos USING gin (tags);


--
-- Name: idx_videos_title_fts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_videos_title_fts ON public.videos USING gin (to_tsvector('simple'::regconfig, COALESCE(title, ''::text)));


--
-- Name: idx_videos_views; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_videos_views ON public.videos USING btree (view_count DESC NULLS LAST);


--
-- Name: review_likes review_like_delete_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER review_like_delete_trigger AFTER DELETE ON public.review_likes FOR EACH ROW EXECUTE FUNCTION public.decrement_review_like_count();


--
-- Name: review_likes review_like_insert_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER review_like_insert_trigger AFTER INSERT ON public.review_likes FOR EACH ROW EXECUTE FUNCTION public.increment_review_like_count();


--
-- Name: restaurant_submission_items sync_submission_status_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sync_submission_status_trigger AFTER INSERT OR DELETE OR UPDATE OF item_status ON public.restaurant_submission_items FOR EACH ROW EXECUTE FUNCTION public.sync_submission_status();


--
-- Name: ad_banners trigger_ad_banners_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_ad_banners_updated_at BEFORE UPDATE ON public.ad_banners FOR EACH ROW EXECUTE FUNCTION public.update_ad_banners_updated_at();


--
-- Name: announcements trigger_announcements_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_announcements_updated_at BEFORE UPDATE ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.update_announcements_updated_at();


--
-- Name: reviews trigger_set_review_edited_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_set_review_edited_at BEFORE UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.set_review_edited_at();


--
-- Name: TRIGGER trigger_set_review_edited_at ON reviews; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER trigger_set_review_edited_at ON public.reviews IS '리뷰 관리자 수정 시 edited_at 자동 설정';


--
-- Name: reviews trigger_update_user_stats; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_user_stats AFTER INSERT OR DELETE OR UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.update_user_stats_on_review();


--
-- Name: TRIGGER trigger_update_user_stats ON reviews; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER trigger_update_user_stats ON public.reviews IS '리뷰 작성/인증/삭제 시 사용자 통계 자동 업데이트';


--
-- Name: restaurant_submissions update_restaurant_submissions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_restaurant_submissions_updated_at BEFORE UPDATE ON public.restaurant_submissions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: restaurants_backup update_restaurants_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_restaurants_updated_at BEFORE UPDATE ON public.restaurants_backup FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: TRIGGER update_restaurants_updated_at ON restaurants_backup; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER update_restaurants_updated_at ON public.restaurants_backup IS '맛집 정보 수정 시 updated_at 자동 업데이트';


--
-- Name: reviews update_reviews_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_reviews_updated_at BEFORE UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: TRIGGER update_reviews_updated_at ON reviews; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER update_reviews_updated_at ON public.reviews IS '리뷰 수정 시 updated_at 자동 업데이트';


--
-- Name: server_costs update_server_costs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_server_costs_updated_at BEFORE UPDATE ON public.server_costs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: TRIGGER update_server_costs_updated_at ON server_costs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TRIGGER update_server_costs_updated_at ON public.server_costs IS '서버 비용 수정 시 updated_at 자동 업데이트';


--
-- Name: ad_banners ad_banners_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ad_banners
    ADD CONSTRAINT ad_banners_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: announcements announcements_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_admin_id_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: announcements announcements_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: ocr_logs ocr_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocr_logs
    ADD CONSTRAINT ocr_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: restaurant_requests restaurant_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_requests
    ADD CONSTRAINT restaurant_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: restaurant_submission_items restaurant_submission_items_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_submission_items
    ADD CONSTRAINT restaurant_submission_items_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.restaurant_submissions(id) ON DELETE CASCADE;


--
-- Name: restaurant_submission_items restaurant_submission_items_target_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_submission_items
    ADD CONSTRAINT restaurant_submission_items_target_restaurant_id_fkey FOREIGN KEY (target_restaurant_id) REFERENCES public.restaurants_backup(id) ON DELETE SET NULL;


--
-- Name: restaurant_submissions restaurant_submissions_resolved_by_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_submissions
    ADD CONSTRAINT restaurant_submissions_resolved_by_admin_id_fkey FOREIGN KEY (resolved_by_admin_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: restaurant_submissions restaurant_submissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurant_submissions
    ADD CONSTRAINT restaurant_submissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: restaurants_backup restaurants_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurants_backup
    ADD CONSTRAINT restaurants_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: restaurants_backup restaurants_updated_by_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.restaurants_backup
    ADD CONSTRAINT restaurants_updated_by_admin_id_fkey FOREIGN KEY (updated_by_admin_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: review_likes review_likes_review_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_likes
    ADD CONSTRAINT review_likes_review_id_fkey FOREIGN KEY (review_id) REFERENCES public.reviews(id) ON DELETE CASCADE;


--
-- Name: review_likes review_likes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_likes
    ADD CONSTRAINT review_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: reviews reviews_edited_by_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_edited_by_admin_id_fkey FOREIGN KEY (edited_by_admin_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: reviews reviews_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants_backup(id) ON DELETE CASCADE;


--
-- Name: reviews reviews_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reviews
    ADD CONSTRAINT reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: search_logs search_logs_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_logs
    ADD CONSTRAINT search_logs_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants_backup(id) ON DELETE CASCADE;


--
-- Name: search_logs search_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_logs
    ADD CONSTRAINT search_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: server_costs server_costs_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.server_costs
    ADD CONSTRAINT server_costs_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: user_bookmarks user_bookmarks_restaurant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_bookmarks
    ADD CONSTRAINT user_bookmarks_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants_backup(id) ON DELETE CASCADE;


--
-- Name: user_bookmarks user_bookmarks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_bookmarks
    ADD CONSTRAINT user_bookmarks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_stats user_stats_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_stats
    ADD CONSTRAINT user_stats_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: restaurants_backup Admins can delete restaurants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete restaurants" ON public.restaurants_backup FOR DELETE TO authenticated USING (public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role));


--
-- Name: server_costs Admins can delete server costs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete server costs" ON public.server_costs FOR DELETE USING (public.is_user_admin(( SELECT auth.uid() AS uid)));


--
-- Name: short_urls Admins can delete short URLs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete short URLs" ON public.short_urls FOR DELETE USING (public.is_user_admin(( SELECT auth.uid() AS uid)));


--
-- Name: restaurant_submission_items Admins can delete submission items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can delete submission items" ON public.restaurant_submission_items FOR DELETE USING (public.is_user_admin(( SELECT auth.uid() AS uid)));


--
-- Name: restaurants_backup Admins can insert restaurants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can insert restaurants" ON public.restaurants_backup FOR INSERT TO authenticated WITH CHECK (public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role));


--
-- Name: server_costs Admins can insert server costs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can insert server costs" ON public.server_costs FOR INSERT WITH CHECK (public.is_user_admin(( SELECT auth.uid() AS uid)));


--
-- Name: restaurant_submissions Admins can update all submissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update all submissions" ON public.restaurant_submissions FOR UPDATE USING (public.is_user_admin(( SELECT auth.uid() AS uid)));


--
-- Name: restaurant_requests Admins can update requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update requests" ON public.restaurant_requests FOR UPDATE USING (public.is_user_admin(( SELECT auth.uid() AS uid)));


--
-- Name: restaurants_backup Admins can update restaurants; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update restaurants" ON public.restaurants_backup FOR UPDATE TO authenticated USING (public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role));


--
-- Name: server_costs Admins can update server costs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update server costs" ON public.server_costs FOR UPDATE USING (public.is_user_admin(( SELECT auth.uid() AS uid)));


--
-- Name: restaurant_submission_items Admins can update submission items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins can update submission items" ON public.restaurant_submission_items FOR UPDATE USING (public.is_user_admin(( SELECT auth.uid() AS uid)));


--
-- Name: transcript_embeddings_bge Allow all access for service role; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all access for service role" ON public.transcript_embeddings_bge TO service_role USING (true) WITH CHECK (true);


--
-- Name: restaurants_duplicate Allow public read access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow public read access" ON public.restaurants_duplicate FOR SELECT USING (true);


--
-- Name: transcript_embeddings_bge Allow read access for all users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow read access for all users" ON public.transcript_embeddings_bge FOR SELECT USING (true);


--
-- Name: search_logs Anyone can insert search logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can insert search logs" ON public.search_logs FOR INSERT WITH CHECK (true);


--
-- Name: POLICY "Anyone can insert search logs" ON search_logs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON POLICY "Anyone can insert search logs" ON public.search_logs IS '모든 사용자가 검색 로그를 생성할 수 있음. 현재 사용되지 않는 테이블이나, 향후 분석을 위해 허용.';


--
-- Name: user_bookmarks Anyone can view bookmarks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view bookmarks" ON public.user_bookmarks FOR SELECT USING (true);


--
-- Name: review_likes Anyone can view review likes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view review likes" ON public.review_likes FOR SELECT USING (true);


--
-- Name: short_urls Anyone can view short URLs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view short URLs" ON public.short_urls FOR SELECT USING (true);


--
-- Name: review_likes Authenticated users can insert own review likes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can insert own review likes" ON public.review_likes FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: document_embeddings Enable all access for service role; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Enable all access for service role" ON public.document_embeddings TO service_role USING (true) WITH CHECK (true);


--
-- Name: video_frame_captions Enable insert for service role; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Enable insert for service role" ON public.video_frame_captions FOR INSERT TO service_role WITH CHECK (true);


--
-- Name: restaurants Enable read access for all users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Enable read access for all users" ON public.restaurants FOR SELECT USING (true);


--
-- Name: video_frame_captions Enable read access for all users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Enable read access for all users" ON public.video_frame_captions FOR SELECT USING (true);


--
-- Name: videos Enable read access for all users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Enable read access for all users" ON public.videos FOR SELECT USING (true);


--
-- Name: restaurants Enable update for admins; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Enable update for admins" ON public.restaurants FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) IN ( SELECT user_roles.user_id
   FROM public.user_roles
  WHERE (user_roles.role = 'admin'::public.app_role))));


--
-- Name: video_frame_captions Enable update for service role; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Enable update for service role" ON public.video_frame_captions FOR UPDATE TO service_role USING (true);


--
-- Name: profiles Public profiles are viewable by everyone; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);


--
-- Name: POLICY "Public profiles are viewable by everyone" ON profiles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON POLICY "Public profiles are viewable by everyone" ON public.profiles IS '모든 사용자가 프로필을 조회할 수 있음. 중복 정책 제거됨.';


--
-- Name: restaurant_requests Restaurant requests select policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Restaurant requests select policy" ON public.restaurant_requests FOR SELECT USING (((( SELECT auth.uid() AS uid) = user_id) OR public.is_user_admin(( SELECT auth.uid() AS uid))));


--
-- Name: restaurant_submissions Restaurant submissions select policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Restaurant submissions select policy" ON public.restaurant_submissions FOR SELECT USING (((( SELECT auth.uid() AS uid) = user_id) OR public.is_user_admin(( SELECT auth.uid() AS uid))));


--
-- Name: reviews Reviews are viewable by everyone; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Reviews are viewable by everyone" ON public.reviews FOR SELECT USING (true);


--
-- Name: server_costs Server costs select policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Server costs select policy" ON public.server_costs FOR SELECT USING (true);


--
-- Name: short_urls Service role can insert short URLs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can insert short URLs" ON public.short_urls FOR INSERT TO service_role WITH CHECK (true);


--
-- Name: short_urls Service role can update short URLs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can update short URLs" ON public.short_urls FOR UPDATE TO service_role USING (true);


--
-- Name: restaurant_submission_items Submission items insert policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Submission items insert policy" ON public.restaurant_submission_items FOR INSERT WITH CHECK (((EXISTS ( SELECT 1
   FROM public.restaurant_submissions s
  WHERE ((s.id = restaurant_submission_items.submission_id) AND (s.user_id = ( SELECT auth.uid() AS uid))))) OR public.is_user_admin(( SELECT auth.uid() AS uid))));


--
-- Name: restaurant_submission_items Submission items select policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Submission items select policy" ON public.restaurant_submission_items FOR SELECT USING (((EXISTS ( SELECT 1
   FROM public.restaurant_submissions s
  WHERE ((s.id = restaurant_submission_items.submission_id) AND (s.user_id = ( SELECT auth.uid() AS uid))))) OR public.is_user_admin(( SELECT auth.uid() AS uid))));


--
-- Name: notifications System can insert notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "System can insert notifications" ON public.notifications FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: POLICY "System can insert notifications" ON notifications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON POLICY "System can insert notifications" ON public.notifications IS '사용자는 자신의 알림만 생성 가능. 실제로는 create_user_notification RPC 함수를 통해서만 생성됨.';


--
-- Name: user_stats User stats are viewable by everyone; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "User stats are viewable by everyone" ON public.user_stats FOR SELECT USING (true);


--
-- Name: reviews Users and admins can delete reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users and admins can delete reviews" ON public.reviews FOR DELETE TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role)));


--
-- Name: reviews Users and admins can update reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users and admins can update reviews" ON public.reviews FOR UPDATE TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role)));


--
-- Name: user_roles Users and admins can view roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users and admins can view roles" ON public.user_roles FOR SELECT TO authenticated USING (((user_id = ( SELECT auth.uid() AS uid)) OR public.has_role(( SELECT auth.uid() AS uid), 'admin'::public.app_role)));


--
-- Name: user_bookmarks Users can create their own bookmarks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create their own bookmarks" ON public.user_bookmarks FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: notifications Users can delete own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own notifications" ON public.notifications FOR DELETE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: restaurant_submissions Users can delete own pending submissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own pending submissions" ON public.restaurant_submissions FOR DELETE USING (((( SELECT auth.uid() AS uid) = user_id) AND (status = 'pending'::public.submission_status)));


--
-- Name: review_likes Users can delete own review likes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own review likes" ON public.review_likes FOR DELETE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: user_bookmarks Users can delete their own bookmarks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete their own bookmarks" ON public.user_bookmarks FOR DELETE USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: profiles Users can insert own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: restaurant_requests Users can insert own requests; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own requests" ON public.restaurant_requests FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: reviews Users can insert own reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own reviews" ON public.reviews FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: restaurant_submissions Users can insert own submissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own submissions" ON public.restaurant_submissions FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: ocr_logs Users can insert their own ocr logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own ocr logs" ON public.ocr_logs FOR INSERT TO authenticated WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: notifications Users can update own notifications (read status); Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own notifications (read status)" ON public.notifications FOR UPDATE TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: profiles Users can update own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: notifications Users can view own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own notifications" ON public.notifications FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: search_logs Users can view own search logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view own search logs" ON public.search_logs FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: ocr_logs Users can view their own ocr logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own ocr logs" ON public.ocr_logs FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: ad_banners; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ad_banners ENABLE ROW LEVEL SECURITY;

--
-- Name: ad_banners ad_banners_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ad_banners_delete_admin ON public.ad_banners FOR DELETE USING (public.is_user_admin(( SELECT auth.uid() AS uid)));


--
-- Name: ad_banners ad_banners_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ad_banners_insert_admin ON public.ad_banners FOR INSERT WITH CHECK (public.is_user_admin(( SELECT auth.uid() AS uid)));


--
-- Name: ad_banners ad_banners_select_combined; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ad_banners_select_combined ON public.ad_banners FOR SELECT USING (((is_active = true) OR public.is_user_admin(( SELECT auth.uid() AS uid))));


--
-- Name: ad_banners ad_banners_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ad_banners_update_admin ON public.ad_banners FOR UPDATE USING (public.is_user_admin(( SELECT auth.uid() AS uid)));


--
-- Name: announcements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

--
-- Name: announcements announcements_delete_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY announcements_delete_admin ON public.announcements FOR DELETE USING (public.is_user_admin(( SELECT auth.uid() AS uid)));


--
-- Name: announcements announcements_insert_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY announcements_insert_admin ON public.announcements FOR INSERT WITH CHECK (public.is_user_admin(( SELECT auth.uid() AS uid)));


--
-- Name: announcements announcements_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY announcements_select_policy ON public.announcements FOR SELECT USING (((is_active = true) OR public.is_user_admin(( SELECT auth.uid() AS uid))));


--
-- Name: announcements announcements_update_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY announcements_update_admin ON public.announcements FOR UPDATE USING (public.is_user_admin(( SELECT auth.uid() AS uid))) WITH CHECK (public.is_user_admin(( SELECT auth.uid() AS uid)));


--
-- Name: document_embeddings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_embeddings ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: ocr_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ocr_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: restaurant_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.restaurant_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: restaurant_submission_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.restaurant_submission_items ENABLE ROW LEVEL SECURITY;

--
-- Name: restaurant_submissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.restaurant_submissions ENABLE ROW LEVEL SECURITY;

--
-- Name: restaurants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;

--
-- Name: restaurants_backup; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.restaurants_backup ENABLE ROW LEVEL SECURITY;

--
-- Name: restaurants_duplicate; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.restaurants_duplicate ENABLE ROW LEVEL SECURITY;

--
-- Name: review_likes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.review_likes ENABLE ROW LEVEL SECURITY;

--
-- Name: reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: search_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.search_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: server_costs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.server_costs ENABLE ROW LEVEL SECURITY;

--
-- Name: short_urls; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.short_urls ENABLE ROW LEVEL SECURITY;

--
-- Name: transcript_embeddings_bge; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.transcript_embeddings_bge ENABLE ROW LEVEL SECURITY;

--
-- Name: user_bookmarks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_bookmarks ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: user_stats; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_stats ENABLE ROW LEVEL SECURITY;

--
-- Name: video_frame_captions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.video_frame_captions ENABLE ROW LEVEL SECURITY;

--
-- Name: videos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict CFkUqswlnIOxGIipA4VAbdNrwJZOQL0n0ud8ggBuRxMk3QqgorIxPnrRTjeg9VD

