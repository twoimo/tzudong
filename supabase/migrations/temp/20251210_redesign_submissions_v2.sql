-- ========================================
-- 제보 시스템 테이블 재설계 v2
-- 작성일: 2025년 12월 10일
-- 설명: JSONB 배열 → 정규화된 테이블 구조로 전환
--       request 유형 별도 테이블 분리
-- ========================================

-- ========================================
-- PART 1: ENUM 타입 재정의
-- ========================================

-- 1.1 submission_status ENUM 단순화
DROP TYPE IF EXISTS public.submission_status CASCADE;
CREATE TYPE public.submission_status AS ENUM (
    'pending',            -- 대기 중
    'approved',           -- 승인됨 (전체)
    'partially_approved', -- 부분 승인됨 (edit에서 일부만)
    'rejected'            -- 거부됨 (전체)
);

COMMENT ON TYPE public.submission_status IS '제보 처리 상태 (pending: 대기, approved: 전체승인, partially_approved: 부분승인, rejected: 거부)';

-- 1.2 submission_type ENUM 확인 (기존 유지: new, edit)
-- request는 별도 테이블로 분리하므로 ENUM에 추가하지 않음
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'submission_type') THEN
        CREATE TYPE public.submission_type AS ENUM ('new', 'edit');
    END IF;
END
$$;

-- ========================================
-- PART 2: restaurant_requests 테이블 생성 (쯔양에게 맛집 제보)
-- ========================================

DROP TABLE IF EXISTS public.restaurant_requests CASCADE;

CREATE TABLE public.restaurant_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    
    -- 음식점 기본 정보
    restaurant_name TEXT NOT NULL,
    address TEXT NOT NULL,
    phone TEXT,
    categories TEXT[],
    
    -- 추천 관련
    recommendation_reason TEXT NOT NULL, -- 추천 이유 (필수)
    youtube_link TEXT, -- 선택 (관련 영상이 있다면)
    
    -- 지오코딩 (나중에 배치 처리)
    lat NUMERIC,
    lng NUMERIC,
    geocoding_success BOOLEAN NOT NULL DEFAULT FALSE,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- 제약 조건
    CONSTRAINT requests_name_check CHECK (length(restaurant_name) >= 1 AND length(restaurant_name) <= 100),
    CONSTRAINT requests_address_check CHECK (length(address) >= 1),
    CONSTRAINT requests_reason_check CHECK (length(recommendation_reason) >= 10),
    CONSTRAINT requests_lat_check CHECK (lat IS NULL OR (lat >= -90 AND lat <= 90)),
    CONSTRAINT requests_lng_check CHECK (lng IS NULL OR (lng >= -180 AND lng <= 180)),
    CONSTRAINT requests_categories_check CHECK (categories IS NULL OR (array_length(categories, 1) > 0 AND array_length(categories, 1) <= 5))
);

COMMENT ON TABLE public.restaurant_requests IS '쯔양에게 맛집 추천 제보 테이블 (승인 과정 없음, 지오코딩 후 지도 표시용)';

-- 인덱스
CREATE INDEX idx_restaurant_requests_user_id ON public.restaurant_requests(user_id);
CREATE INDEX idx_restaurant_requests_created_at ON public.restaurant_requests(created_at DESC);
CREATE INDEX idx_restaurant_requests_geocoding ON public.restaurant_requests(geocoding_success) WHERE geocoding_success = FALSE;
CREATE INDEX idx_restaurant_requests_location ON public.restaurant_requests(lat, lng) WHERE lat IS NOT NULL AND lng IS NOT NULL;

-- ========================================
-- PART 3: restaurant_submissions 테이블 재생성
-- ========================================

DROP TABLE IF EXISTS public.restaurant_submissions CASCADE;

CREATE TABLE public.restaurant_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    
    -- 제보 유형: 'new' (신규 맛집 제보) 또는 'edit' (기존 맛집 수정 요청)
    submission_type submission_type NOT NULL,
    
    -- 제보 상태
    status submission_status NOT NULL DEFAULT 'pending',
    
    -- 공통 음식점 정보 (정규 컬럼)
    restaurant_name TEXT NOT NULL,
    restaurant_address TEXT, -- 사용자 입력 원본 주소
    restaurant_phone TEXT,
    restaurant_categories TEXT[],
    
    -- edit 전용: 수정 대상 음식점 ID
    target_restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE SET NULL,
    
    -- 관리자 처리 관련
    admin_notes TEXT,
    rejection_reason TEXT, -- 전체 거부 시 사유 (개별 항목은 items에서 관리)
    resolved_by_admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- 제약 조건
    CONSTRAINT submissions_name_check CHECK (length(restaurant_name) >= 1 AND length(restaurant_name) <= 100),
    CONSTRAINT submissions_categories_check CHECK (restaurant_categories IS NULL OR (array_length(restaurant_categories, 1) > 0 AND array_length(restaurant_categories, 1) <= 5)),
    -- edit 유형일 때만 target_restaurant_id 필수
    CONSTRAINT submissions_edit_target_check CHECK (
        (submission_type = 'new' AND target_restaurant_id IS NULL) OR
        (submission_type = 'edit' AND target_restaurant_id IS NOT NULL)
    )
);

COMMENT ON TABLE public.restaurant_submissions IS '사용자 맛집 제보(신규/수정) 테이블 - 정규화된 구조';
COMMENT ON COLUMN public.restaurant_submissions.submission_type IS '제보 유형 (new: 신규, edit: 수정)';
COMMENT ON COLUMN public.restaurant_submissions.status IS '제보 상태 (pending/approved/partially_approved/rejected)';
COMMENT ON COLUMN public.restaurant_submissions.target_restaurant_id IS 'edit 유형 시 수정 대상 음식점 ID';

-- 인덱스
CREATE INDEX idx_submissions_user_id ON public.restaurant_submissions(user_id);
CREATE INDEX idx_submissions_status ON public.restaurant_submissions(status);
CREATE INDEX idx_submissions_type ON public.restaurant_submissions(submission_type);
CREATE INDEX idx_submissions_created_at ON public.restaurant_submissions(created_at DESC);
CREATE INDEX idx_submissions_pending ON public.restaurant_submissions(created_at DESC) WHERE status = 'pending';
CREATE INDEX idx_submissions_target_restaurant ON public.restaurant_submissions(target_restaurant_id) WHERE target_restaurant_id IS NOT NULL;

-- updated_at 트리거
DROP TRIGGER IF EXISTS update_restaurant_submissions_updated_at ON public.restaurant_submissions;
CREATE TRIGGER update_restaurant_submissions_updated_at
    BEFORE UPDATE ON public.restaurant_submissions
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ========================================
-- PART 4: restaurant_submission_items 테이블 생성
-- ========================================

DROP TABLE IF EXISTS public.restaurant_submission_items CASCADE;

CREATE TABLE public.restaurant_submission_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID NOT NULL REFERENCES public.restaurant_submissions(id) ON DELETE CASCADE,
    
    -- 유튜브 영상 + 쯔양 리뷰 묶음
    youtube_link TEXT NOT NULL,
    tzuyang_review TEXT,
    
    -- edit 전용: 수정 대상 unique_id (같은 음식점의 다른 영상 레코드)
    target_unique_id TEXT,
    
    -- 개별 항목 상태
    item_status TEXT NOT NULL DEFAULT 'pending',
    rejection_reason TEXT, -- 개별 거부 사유
    
    -- 승인 후 연결 (restaurants 테이블의 레코드 ID)
    approved_restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE SET NULL,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- 제약 조건
    CONSTRAINT items_status_check CHECK (item_status IN ('pending', 'approved', 'rejected')),
    CONSTRAINT items_youtube_link_check CHECK (youtube_link ~ '^https?://'),
    -- approved 상태일 때만 approved_restaurant_id 필수
    CONSTRAINT items_approved_link_check CHECK (
        (item_status != 'approved') OR 
        (item_status = 'approved' AND approved_restaurant_id IS NOT NULL)
    )
);

COMMENT ON TABLE public.restaurant_submission_items IS '제보 개별 항목 테이블 (유튜브 영상 + 쯔양 리뷰 묶음)';
COMMENT ON COLUMN public.restaurant_submission_items.target_unique_id IS 'edit 유형 시 수정 대상 레코드의 unique_id';
COMMENT ON COLUMN public.restaurant_submission_items.item_status IS '개별 항목 상태 (pending/approved/rejected)';
COMMENT ON COLUMN public.restaurant_submission_items.approved_restaurant_id IS '승인 후 생성/수정된 restaurants 레코드 ID';

-- 인덱스
CREATE INDEX idx_submission_items_submission_id ON public.restaurant_submission_items(submission_id);
CREATE INDEX idx_submission_items_status ON public.restaurant_submission_items(item_status);
CREATE INDEX idx_submission_items_approved_restaurant ON public.restaurant_submission_items(approved_restaurant_id) 
    WHERE approved_restaurant_id IS NOT NULL;
CREATE INDEX idx_submission_items_target_unique_id ON public.restaurant_submission_items(target_unique_id) 
    WHERE target_unique_id IS NOT NULL;

-- ========================================
-- PART 5: RLS 정책 설정
-- ========================================

-- 5.1 restaurant_requests RLS
ALTER TABLE public.restaurant_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own requests" ON public.restaurant_requests;
CREATE POLICY "Users can view own requests"
    ON public.restaurant_requests FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own requests" ON public.restaurant_requests;
CREATE POLICY "Users can insert own requests"
    ON public.restaurant_requests FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all requests" ON public.restaurant_requests;
CREATE POLICY "Admins can view all requests"
    ON public.restaurant_requests FOR SELECT
    USING (public.is_user_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can update requests" ON public.restaurant_requests;
CREATE POLICY "Admins can update requests"
    ON public.restaurant_requests FOR UPDATE
    USING (public.is_user_admin(auth.uid()));

-- 5.2 restaurant_submissions RLS
ALTER TABLE public.restaurant_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own submissions" ON public.restaurant_submissions;
CREATE POLICY "Users can view own submissions"
    ON public.restaurant_submissions FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own submissions" ON public.restaurant_submissions;
CREATE POLICY "Users can insert own submissions"
    ON public.restaurant_submissions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own pending submissions" ON public.restaurant_submissions;
CREATE POLICY "Users can delete own pending submissions"
    ON public.restaurant_submissions FOR DELETE
    USING (auth.uid() = user_id AND status = 'pending');

DROP POLICY IF EXISTS "Admins can view all submissions" ON public.restaurant_submissions;
CREATE POLICY "Admins can view all submissions"
    ON public.restaurant_submissions FOR SELECT
    USING (public.is_user_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can update all submissions" ON public.restaurant_submissions;
CREATE POLICY "Admins can update all submissions"
    ON public.restaurant_submissions FOR UPDATE
    USING (public.is_user_admin(auth.uid()));

-- 5.3 restaurant_submission_items RLS
ALTER TABLE public.restaurant_submission_items ENABLE ROW LEVEL SECURITY;

-- items는 부모 submission의 소유자/관리자만 접근 가능
DROP POLICY IF EXISTS "Users can view own submission items" ON public.restaurant_submission_items;
CREATE POLICY "Users can view own submission items"
    ON public.restaurant_submission_items FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.restaurant_submissions s
            WHERE s.id = submission_id AND s.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can insert own submission items" ON public.restaurant_submission_items;
CREATE POLICY "Users can insert own submission items"
    ON public.restaurant_submission_items FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.restaurant_submissions s
            WHERE s.id = submission_id AND s.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Admins can manage all submission items" ON public.restaurant_submission_items;
CREATE POLICY "Admins can manage all submission items"
    ON public.restaurant_submission_items FOR ALL
    USING (public.is_user_admin(auth.uid()));

-- ========================================
-- PART 6: restaurants.source_type 제약 수정
-- ========================================

-- 기존 제약 삭제 후 재생성 (user_submission_new, user_submission_edit 추가)
ALTER TABLE public.restaurants DROP CONSTRAINT IF EXISTS restaurants_source_type_check;

ALTER TABLE public.restaurants ADD CONSTRAINT restaurants_source_type_check CHECK (
    source_type IS NULL OR source_type IN (
        'perplexity',
        'geminiCLI',
        'admin',
        'user_submission',      -- 기존 호환성 유지
        'user_submission_new',  -- 신규 제보
        'user_submission_edit'  -- 수정 제보
    )
);

-- ========================================
-- PART 7: 유틸리티 함수
-- ========================================

-- 7.1 submissions 상태 자동 계산 함수
CREATE OR REPLACE FUNCTION public.calculate_submission_status(p_submission_id UUID)
RETURNS submission_status
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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

COMMENT ON FUNCTION public.calculate_submission_status IS 'items 상태 기반으로 submission 전체 상태 계산';

-- 7.2 submission 상태 동기화 트리거 함수
CREATE OR REPLACE FUNCTION public.sync_submission_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

-- items 변경 시 자동으로 submissions.status 동기화
DROP TRIGGER IF EXISTS sync_submission_status_trigger ON public.restaurant_submission_items;
CREATE TRIGGER sync_submission_status_trigger
    AFTER INSERT OR UPDATE OF item_status OR DELETE
    ON public.restaurant_submission_items
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_submission_status();

-- ========================================
-- PART 8: 완료 메시지
-- ========================================

DO $$
BEGIN
    RAISE NOTICE '✅ 제보 시스템 테이블 재설계 v2 완료';
    RAISE NOTICE '   - restaurant_requests 테이블 생성 (쯔양에게 맛집 추천)';
    RAISE NOTICE '   - restaurant_submissions 테이블 재설계 (정규화)';
    RAISE NOTICE '   - restaurant_submission_items 테이블 생성 (개별 항목)';
    RAISE NOTICE '   - submission_status ENUM 단순화';
    RAISE NOTICE '   - RLS 정책 설정 완료';
    RAISE NOTICE '   - restaurants.source_type 제약 수정';
    RAISE NOTICE '   - 상태 자동 동기화 트리거 설정';
END $$;
