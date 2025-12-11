-- ========================================
-- restaurant_requests 테이블 주소 컬럼 추가
-- 작성일: 2025년 12월 10일
-- 설명: 원본 주소와 별개로 정규화된 주소 정보 관리
-- ========================================

-- 1. 원본 주소 컬럼명 변경 (address → origin_address)
ALTER TABLE public.restaurant_requests 
RENAME COLUMN address TO origin_address;

-- 2. 정규화된 주소 컬럼 추가
ALTER TABLE public.restaurant_requests 
ADD COLUMN IF NOT EXISTS road_address TEXT,
ADD COLUMN IF NOT EXISTS jibun_address TEXT,
ADD COLUMN IF NOT EXISTS english_address TEXT,
ADD COLUMN IF NOT EXISTS address_elements JSONB;

-- 3. 기존 제약 조건 업데이트
ALTER TABLE public.restaurant_requests DROP CONSTRAINT IF EXISTS requests_address_check;
ALTER TABLE public.restaurant_requests 
ADD CONSTRAINT requests_origin_address_check CHECK (length(origin_address) >= 1);

-- 4. 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_restaurant_requests_road_address 
ON public.restaurant_requests(road_address) 
WHERE road_address IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_restaurant_requests_geocoding_pending 
ON public.restaurant_requests(created_at DESC) 
WHERE geocoding_success = FALSE;

-- 5. 컬럼 코멘트 추가
COMMENT ON COLUMN public.restaurant_requests.origin_address IS '사용자가 입력한 원본 주소';
COMMENT ON COLUMN public.restaurant_requests.road_address IS '정규화된 도로명주소 (지오코딩 결과)';
COMMENT ON COLUMN public.restaurant_requests.jibun_address IS '정규화된 지번주소 (지오코딩 결과)';
COMMENT ON COLUMN public.restaurant_requests.english_address IS '영어주소 (지오코딩 결과)';
COMMENT ON COLUMN public.restaurant_requests.address_elements IS '주소요소 JSON (시/도, 구/군, 동 등)';

-- 6. 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '✅ restaurant_requests 주소 컬럼 업데이트 완료';
    RAISE NOTICE '   - origin_address: 사용자 입력 원본 주소';
    RAISE NOTICE '   - road_address: 도로명주소';
    RAISE NOTICE '   - jibun_address: 지번주소';
    RAISE NOTICE '   - english_address: 영어주소';
    RAISE NOTICE '   - address_elements: 주소요소 JSON';
END $$;
