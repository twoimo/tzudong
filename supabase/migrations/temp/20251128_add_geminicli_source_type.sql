-- ========================================
-- source_type에 'geminiCLI' 값 추가
-- 작성일: 2025년 11월 28일
-- 설명: source_type 컬럼의 CHECK constraint 업데이트하여 'geminiCLI' 추가
-- ========================================

-- 기존 constraint 삭제 후 새로운 constraint 추가
ALTER TABLE public.restaurants
DROP CONSTRAINT IF EXISTS restaurants_source_type_check;

ALTER TABLE public.restaurants
ADD CONSTRAINT restaurants_source_type_check
CHECK (source_type IS NULL OR source_type IN ('perplexity', 'user_submission', 'admin', 'geminiCLI'));

COMMENT ON CONSTRAINT restaurants_source_type_check ON public.restaurants IS 
'source_type 값 제한: perplexity (Perplexity AI 크롤링), geminiCLI (Gemini CLI 크롤링), user_submission (사용자 제보), admin (관리자 직접 추가)';
