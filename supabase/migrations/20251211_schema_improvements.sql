-- ============================================================================
-- 스키마 개선 마이그레이션
-- 1. restaurants.status에서 rejected 제거
-- 2. restaurant_submissions에서 target_restaurant_id 제거 (EDIT용이지만 items 레벨로 이동)
-- 3. restaurant_submission_items에 target_restaurant_id 추가
-- ============================================================================

-- ============================================================================
-- 1. restaurants.status에서 'rejected' 제거
-- 레스토랑은 rejected 되지 않음 (제보 항목이 rejected됨)
-- 유효한 값: 'pending', 'approved', 'deleted'
-- ============================================================================

-- 먼저 rejected 상태인 레코드를 deleted로 변환 (있다면)
UPDATE public.restaurants 
SET status = 'deleted', 
    updated_at = NOW()
WHERE status = 'rejected';

-- 기존 제약조건 삭제
ALTER TABLE public.restaurants 
DROP CONSTRAINT IF EXISTS restaurants_status_check;

-- 새 제약조건 추가 (rejected 제외)
ALTER TABLE public.restaurants 
ADD CONSTRAINT restaurants_status_check 
CHECK (status IN ('pending', 'approved', 'deleted'));

-- 코멘트 업데이트
COMMENT ON CONSTRAINT restaurants_status_check ON public.restaurants 
IS '상태 값 제약 (pending: 대기, approved: 승인됨, deleted: 삭제됨)';

COMMENT ON COLUMN public.restaurants.status 
IS '맛집 상태 (pending: 승인대기, approved: 승인됨, deleted: 삭제됨)';

-- ============================================================================
-- 2. restaurant_submissions에서 target_restaurant_id 제거
-- EDIT 제보도 여러 items를 가질 수 있어서 items 레벨로 이동
-- ============================================================================

-- 기존 데이터를 items로 마이그레이션
-- target_restaurant_id가 있는 EDIT 제보의 경우, 
-- 해당 submission의 모든 items에 target_restaurant_id 설정
-- (아래 #3에서 컬럼 추가 후 실행)

-- ============================================================================
-- 3. restaurant_submission_items에 target_restaurant_id 추가
-- EDIT 타입일 때 수정 대상 레스토랑 ID
-- ============================================================================

-- 컬럼 추가 (이미 있으면 무시)
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
    END IF;
END $$;

-- 코멘트 추가
COMMENT ON COLUMN public.restaurant_submission_items.target_restaurant_id 
IS 'EDIT 타입일 때 수정 대상 레스토랑 ID';

-- 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_submission_items_target_restaurant 
ON public.restaurant_submission_items(target_restaurant_id) 
WHERE target_restaurant_id IS NOT NULL;

-- ============================================================================
-- 기존 데이터 마이그레이션: submissions의 target_restaurant_id를 items로 복사
-- ============================================================================

-- submissions에 target_restaurant_id 컬럼이 있는 경우에만 실행
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'restaurant_submissions' 
        AND column_name = 'target_restaurant_id'
    ) THEN
        -- EDIT 타입 제보의 target_restaurant_id를 items로 복사
        -- submission_type enum은 소문자: 'new', 'edit'
        UPDATE public.restaurant_submission_items AS items
        SET target_restaurant_id = subs.target_restaurant_id
        FROM public.restaurant_submissions AS subs
        WHERE items.submission_id = subs.id
          AND subs.submission_type = 'edit'
          AND subs.target_restaurant_id IS NOT NULL
          AND items.target_restaurant_id IS NULL;
          
        -- NOTE: submissions.target_restaurant_id는 하위 호환성을 위해 유지
        -- 향후 프론트엔드가 items.target_restaurant_id로 완전히 전환되면 삭제 가능
        -- ALTER TABLE public.restaurant_submissions 
        -- DROP COLUMN IF EXISTS target_restaurant_id;
    END IF;
END $$;

-- ============================================================================
-- RLS 정책 업데이트 (필요시)
-- ============================================================================

-- 새 컬럼에 대한 RLS 정책은 기존 items 테이블 정책을 따름

-- ============================================================================
-- 완료 메시지
-- ============================================================================
DO $$
BEGIN
    RAISE NOTICE '✅ 스키마 개선 마이그레이션 완료:';
    RAISE NOTICE '  - restaurants.status: pending/approved/deleted (rejected 제거)';
    RAISE NOTICE '  - restaurant_submission_items.target_restaurant_id 추가';
    RAISE NOTICE '  - restaurant_submissions.target_restaurant_id 제거';
END $$;
