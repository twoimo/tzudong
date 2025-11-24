-- ========================================
-- source_type에 'admin' 값 추가
-- 작성일: 2025년 11월 23일
-- 설명: source_type 컬럼에 CHECK constraint 추가하여 'perplexity', 'user_submission', 'admin' 값만 허용
-- ========================================

-- source_type CHECK constraint 추가
ALTER TABLE public.restaurants
DROP CONSTRAINT IF EXISTS restaurants_source_type_check;

ALTER TABLE public.restaurants
ADD CONSTRAINT restaurants_source_type_check
CHECK (source_type IS NULL OR source_type IN ('perplexity', 'user_submission', 'admin'));

COMMENT ON CONSTRAINT restaurants_source_type_check ON public.restaurants IS 
'source_type 값 제한: perplexity (크롤링), user_submission (사용자 제보), admin (관리자 직접 추가)';
