-- ========================================
-- restaurant_submission_items 테이블에 target_restaurant_id 추가
-- target_unique_id는 더 이상 사용하지 않음 (나중에 제거 예정)
-- ========================================

-- 1. target_restaurant_id 컬럼 추가
ALTER TABLE public.restaurant_submission_items 
ADD COLUMN IF NOT EXISTS target_restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.restaurant_submission_items.target_restaurant_id IS 'EDIT 제보 시 수정 대상 식당 ID';

-- 2. 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_submission_items_target_restaurant_id 
ON public.restaurant_submission_items(target_restaurant_id) 
WHERE target_restaurant_id IS NOT NULL;

-- 3. target_unique_id 컬럼 삭제 (기존 데이터가 있을 수 있으므로 주의)
-- 주의: 이 작업은 기존 데이터 손실을 야기할 수 있습니다
-- ALTER TABLE public.restaurant_submission_items DROP COLUMN IF EXISTS target_unique_id;
-- DROP INDEX IF EXISTS idx_submission_items_target_unique_id;

-- 참고: target_unique_id 삭제는 별도 마이그레이션에서 진행하는 것이 안전합니다
