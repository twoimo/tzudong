-- ============================================================================
-- 20251211_schema_improvements.sql 실패 후 수정 스크립트
-- 이 스크립트는 이전 마이그레이션 실패 이후 남은 작업을 완료합니다
-- ============================================================================

-- 1. restaurants.status 체크 제약조건에서 rejected 제거
-- (이미 실행되었을 수 있으므로 IF EXISTS 사용)
ALTER TABLE public.restaurants 
DROP CONSTRAINT IF EXISTS restaurants_status_check;

ALTER TABLE public.restaurants 
ADD CONSTRAINT restaurants_status_check 
CHECK (status IN ('pending', 'approved', 'deleted'));

-- approved 데이터 체크 제약조건도 수정
ALTER TABLE public.restaurants 
DROP CONSTRAINT IF EXISTS restaurants_approved_data_check;

ALTER TABLE public.restaurants 
ADD CONSTRAINT restaurants_approved_data_check 
CHECK (
    (status = 'approved' AND 
     lat IS NOT NULL AND 
     lng IS NOT NULL AND 
     categories IS NOT NULL AND
     (road_address IS NOT NULL OR jibun_address IS NOT NULL)) OR
    status IN ('pending', 'deleted')
);

COMMENT ON CONSTRAINT restaurants_status_check ON public.restaurants 
IS '상태 값 제약 (pending, approved, deleted) - rejected 제거됨';

-- ============================================================================
-- 2. restaurant_submission_items에 target_restaurant_id 추가 (이미 있으면 무시)
-- ============================================================================
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'restaurant_submission_items' 
        AND column_name = 'target_restaurant_id'
    ) THEN
        ALTER TABLE public.restaurant_submission_items 
        ADD COLUMN target_restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE SET NULL;
        
        COMMENT ON COLUMN public.restaurant_submission_items.target_restaurant_id 
        IS 'EDIT 타입일 때 수정 대상 레스토랑 ID';
    END IF;
END $$;

-- 인덱스 추가 (이미 있으면 무시)
CREATE INDEX IF NOT EXISTS idx_submission_items_target_restaurant 
ON public.restaurant_submission_items(target_restaurant_id) 
WHERE target_restaurant_id IS NOT NULL;

-- ============================================================================
-- 3. submissions의 target_restaurant_id를 items로 복사
-- submission_type enum은 소문자: 'new', 'edit'
-- ============================================================================
DO $$
BEGIN
    -- submissions 테이블에 target_restaurant_id 컬럼이 있는지 확인
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'restaurant_submissions' 
        AND column_name = 'target_restaurant_id'
    ) THEN
        -- EDIT 타입 제보의 target_restaurant_id를 items로 복사
        UPDATE public.restaurant_submission_items AS items
        SET target_restaurant_id = subs.target_restaurant_id
        FROM public.restaurant_submissions AS subs
        WHERE items.submission_id = subs.id
          AND subs.submission_type = 'edit'  -- 소문자!
          AND subs.target_restaurant_id IS NOT NULL
          AND items.target_restaurant_id IS NULL;
          
        RAISE NOTICE '✅ target_restaurant_id 마이그레이션 완료';
    ELSE
        RAISE NOTICE 'ℹ️ submissions.target_restaurant_id 컬럼 없음 (이미 마이그레이션됨)';
    END IF;
END $$;

-- ============================================================================
-- 완료 메시지
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE '✅ 스키마 수정 완료:';
    RAISE NOTICE '  - restaurants.status: pending/approved/deleted (rejected 제거)';
    RAISE NOTICE '  - restaurant_submission_items.target_restaurant_id 추가';
    RAISE NOTICE '  - submissions.target_restaurant_id → items로 복사 완료';
END $$;
