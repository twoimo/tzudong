-- evaluation_records에 restaurant_id 컬럼 추가
-- 이 컬럼은 승인 시 restaurants 테이블에 삽입된 레코드의 ID를 저장합니다.

ALTER TABLE public.evaluation_records
ADD COLUMN IF NOT EXISTS restaurant_id UUID REFERENCES public.restaurants(id) ON DELETE SET NULL;

-- 인덱스 추가 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_evaluation_records_restaurant_id 
ON public.evaluation_records(restaurant_id);

-- 코멘트 추가
COMMENT ON COLUMN public.evaluation_records.restaurant_id IS 
'승인되어 restaurants 테이블에 삽입된 음식점의 ID. 병합된 경우 병합된 음식점의 ID를 저장.';
