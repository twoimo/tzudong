-- ========================================
-- restaurant_submissions 테이블 재설계 마이그레이션
-- 작성일: 2025년 11월 17일
-- 설명: 사용자 제보 시스템 개선 - JSONB 배열 기반 구조로 전환
-- ========================================

-- ========================================
-- PART 1: ENUM 타입 수정
-- ========================================

-- 1.1 submission_status ENUM 타입 재정의
DROP TYPE IF EXISTS public.submission_status CASCADE;
CREATE TYPE public.submission_status AS ENUM (
    'pending',              -- 대기중
    'all_approved',         -- 모두 승인됨
    'partially_approved',   -- 부분 승인됨 (수정 요청에서 일부만 승인된 경우)
    'all_deleted'           -- 모두 거부됨
);

COMMENT ON TYPE public.submission_status IS '제보 처리 상태 타입';

-- ========================================
-- PART 2: restaurant_submissions 테이블 재생성
-- ========================================

-- 기존 테이블 삭제 (CASCADE로 관련 함수도 함께 삭제됨)
DROP TABLE IF EXISTS public.restaurant_submissions CASCADE;

CREATE TABLE public.restaurant_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL NOT NULL,
    
    -- 제보 유형: 'new' (신규 맛집 제보) 또는 'edit' (기존 맛집 수정 요청)
    submission_type submission_type NOT NULL,
    
    -- 제보 상태
    status submission_status NOT NULL DEFAULT 'pending',
    
    -- 사용자가 제보한 맛집 정보 배열 (JSONB)
    -- 구조: [{ unique_id, name, categories, address, phone, youtube_link, tzuyang_review }, ...]
    -- - unique_id: 수정 요청 시에는 기존 맛집의 unique_id, 신규 제보 시에는 null (승인 시 생성)
    -- - name: 맛집 이름
    -- - categories: 카테고리 배열 (예: ["한식", "분식"])
    -- - address: 주소 (사용자가 입력한 원본)
    -- - phone: 전화번호
    -- - youtube_link: 유튜브 영상 링크
    -- - tzuyang_review: 쯔양 리뷰 내용
    user_restaurants_submission JSONB DEFAULT '[]'::JSONB NOT NULL,
    
    -- 관리자 처리 관련
    admin_notes TEXT, -- 관리자 메모
    rejection_reason TEXT, -- 거부 사유
    resolved_by_admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMP WITH TIME ZONE, -- 검토 완료 시간
    
    -- 타임스탬프
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.restaurant_submissions IS '사용자 맛집 제보(신규/수정) 테이블 - JSONB 배열 기반';
COMMENT ON COLUMN public.restaurant_submissions.submission_type IS '제보 유형 (new: 신규, edit: 수정)';
COMMENT ON COLUMN public.restaurant_submissions.status IS '제보 상태 (pending: 대기, all_approved: 모두 승인, partially_approved: 부분 승인, all_deleted: 모두 거부)';
COMMENT ON COLUMN public.restaurant_submissions.user_restaurants_submission IS '사용자가 제보한 맛집 정보 배열 (JSONB)';

-- 인덱스 생성
CREATE INDEX idx_restaurant_submissions_user_id ON public.restaurant_submissions(user_id);
CREATE INDEX idx_restaurant_submissions_status ON public.restaurant_submissions(status);
CREATE INDEX idx_restaurant_submissions_submission_type ON public.restaurant_submissions(submission_type);
CREATE INDEX idx_restaurant_submissions_created_at ON public.restaurant_submissions(created_at DESC);

-- ========================================
-- PART 3: unique_id 생성 함수
-- ========================================

-- unique_id 생성 함수 (name + jibun_address + tzuyang_review 기반 해시)
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
    -- 3개 값을 결합 (null 처리)
    combined_string := COALESCE(p_name, '') || '|' || 
                      COALESCE(p_jibun_address, '') || '|' || 
                      COALESCE(p_tzuyang_review, '');
    
    -- MD5 해시 생성
    hash_value := md5(combined_string);
    
    RETURN hash_value;
END;
$$;

COMMENT ON FUNCTION public.generate_unique_id IS 'name + jibun_address + tzuyang_review 기반으로 unique_id 생성 (MD5 해시)';

-- ========================================
-- PART 4: 제보 승인 함수 재작성
-- ========================================

-- 4.1 신규 맛집 제보 승인 함수
DROP FUNCTION IF EXISTS public.approve_new_restaurant_submission(UUID, UUID, JSONB);
CREATE OR REPLACE FUNCTION public.approve_new_restaurant_submission(
    p_submission_id UUID,
    p_admin_user_id UUID,
    p_geocoded_data JSONB -- 관리자가 재지오코딩한 데이터
)
RETURNS TABLE(
    success BOOLEAN,
    message TEXT,
    created_restaurant_ids UUID[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
        -- TODO: 실제 youtube_meta 가져오는 로직 구현 필요
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
            resource_type,
            created_by,
            updated_by_admin_id
        )
        VALUES (
            v_generated_unique_id,
            v_restaurant_item->>'name',
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
            p_admin_user_id
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

COMMENT ON FUNCTION public.approve_new_restaurant_submission IS '신규 맛집 제보 승인 (관리자 전용, 재지오코딩 필수)';

-- 4.2 기존 맛집 수정 요청 승인 함수
DROP FUNCTION IF EXISTS public.approve_edit_restaurant_submission(UUID, UUID, UUID[]);
CREATE OR REPLACE FUNCTION public.approve_edit_restaurant_submission(
    p_submission_id UUID,
    p_admin_user_id UUID,
    p_approved_unique_ids UUID[] -- 관리자가 승인한 unique_id 배열
)
RETURNS TABLE(
    success BOOLEAN,
    message TEXT,
    updated_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

COMMENT ON FUNCTION public.approve_edit_restaurant_submission IS '기존 맛집 수정 요청 승인 (관리자 전용, 부분 승인 가능)';

-- 4.3 제보 거부 함수
DROP FUNCTION IF EXISTS public.reject_restaurant_submission(UUID, UUID, TEXT);
CREATE OR REPLACE FUNCTION public.reject_restaurant_submission(
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

COMMENT ON FUNCTION public.reject_restaurant_submission IS '제보 거부 (관리자 전용)';

-- ========================================
-- PART 5: RLS 정책 설정
-- ========================================

ALTER TABLE public.restaurant_submissions ENABLE ROW LEVEL SECURITY;

-- 사용자는 자신의 제보만 조회 가능
DROP POLICY IF EXISTS "Users can view own submissions" ON public.restaurant_submissions;
CREATE POLICY "Users can view own submissions"
    ON public.restaurant_submissions
    FOR SELECT
    USING (auth.uid() = user_id);

-- 사용자는 자신의 제보만 삽입 가능
DROP POLICY IF EXISTS "Users can insert own submissions" ON public.restaurant_submissions;
CREATE POLICY "Users can insert own submissions"
    ON public.restaurant_submissions
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- 관리자는 모든 제보 조회 가능
DROP POLICY IF EXISTS "Admins can view all submissions" ON public.restaurant_submissions;
CREATE POLICY "Admins can view all submissions"
    ON public.restaurant_submissions
    FOR SELECT
    USING (public.is_user_admin(auth.uid()));

-- 관리자는 모든 제보 수정 가능
DROP POLICY IF EXISTS "Admins can update all submissions" ON public.restaurant_submissions;
CREATE POLICY "Admins can update all submissions"
    ON public.restaurant_submissions
    FOR UPDATE
    USING (public.is_user_admin(auth.uid()));

-- ========================================
-- PART 6: 완료 메시지
-- ========================================

DO $$
BEGIN
    RAISE NOTICE '✅ restaurant_submissions 테이블 재설계 완료';
    RAISE NOTICE '   - JSONB 배열 기반 구조로 변경';
    RAISE NOTICE '   - unique_id 생성 함수 추가';
    RAISE NOTICE '   - 신규/수정 승인 함수 재작성';
    RAISE NOTICE '   - 부분 승인 기능 추가';
END $$;
