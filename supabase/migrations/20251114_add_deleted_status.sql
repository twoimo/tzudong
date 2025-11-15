-- ========================================
-- restaurants 테이블에 'deleted' 상태 추가
-- 작성일: 2025년 11월 14일
-- ========================================

-- status 컬럼의 CHECK 제약조건 수정
ALTER TABLE public.restaurants 
DROP CONSTRAINT IF EXISTS restaurants_status_check;

ALTER TABLE public.restaurants 
ADD CONSTRAINT restaurants_status_check 
CHECK (status IN ('pending', 'approved', 'rejected', 'deleted'));

-- approved 데이터 체크 제약조건도 수정 (deleted 상태 추가)
ALTER TABLE public.restaurants 
DROP CONSTRAINT IF EXISTS restaurants_approved_data_check;

ALTER TABLE public.restaurants 
ADD CONSTRAINT restaurants_approved_data_check 
CHECK (
    -- status가 'approved'인 경우 필수 데이터 검증
    (status = 'approved' AND 
     lat IS NOT NULL AND 
     lng IS NOT NULL AND 
     categories IS NOT NULL AND
     (road_address IS NOT NULL OR jibun_address IS NOT NULL)) OR
    -- 그 외의 status는 제약 없음
    status IN ('pending', 'rejected', 'deleted')
);

COMMENT ON CONSTRAINT restaurants_status_check ON public.restaurants IS '상태 값 제약 (pending, approved, rejected, deleted)';

