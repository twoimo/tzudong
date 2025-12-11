-- =====================================================
-- 리뷰 영수증 OCR 관련 컬럼 추가 마이그레이션
-- 목적: 영수증 OCR 데이터 저장 및 중복 검사
-- =====================================================

-- reviews 테이블에 OCR 관련 컬럼 추가
ALTER TABLE public.reviews 
  ADD COLUMN IF NOT EXISTS receipt_hash TEXT,
  ADD COLUMN IF NOT EXISTS receipt_data JSONB,
  ADD COLUMN IF NOT EXISTS is_duplicate BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS ocr_processed_at TIMESTAMPTZ;

-- =====================================================
-- 인덱스 생성
-- =====================================================

-- 중복 영수증 방지를 위한 유니크 인덱스 (NULL 제외)
-- receipt_hash가 동일하면 동일 영수증으로 판단
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_receipt_hash 
  ON public.reviews(receipt_hash) 
  WHERE receipt_hash IS NOT NULL;

-- OCR 미처리 리뷰 조회용 인덱스 (배치 처리 최적화)
CREATE INDEX IF NOT EXISTS idx_reviews_ocr_pending 
  ON public.reviews(created_at DESC) 
  WHERE ocr_processed_at IS NULL;

-- 중복 리뷰 조회용 인덱스 (관리자 검수 최적화)
CREATE INDEX IF NOT EXISTS idx_reviews_duplicate 
  ON public.reviews(created_at DESC) 
  WHERE is_duplicate = true;

-- =====================================================
-- 컬럼 설명 (문서화)
-- =====================================================

COMMENT ON COLUMN public.reviews.receipt_hash IS '영수증 OCR 해시 (store_name|date|time|amount SHA-256)';
COMMENT ON COLUMN public.reviews.receipt_data IS 'OCR 추출 데이터 JSON: {store_name, date, time, total_amount, items, confidence}';
COMMENT ON COLUMN public.reviews.is_duplicate IS '중복 영수증 여부 (true=동일 영수증으로 다른 리뷰 존재)';
COMMENT ON COLUMN public.reviews.ocr_processed_at IS 'OCR 처리 완료 시각 (NULL=미처리)';
