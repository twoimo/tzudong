-- restaurants 테이블의 name 컬럼에서 NOT NULL 제약 제거
-- no_restaurants, all_names_null 케이스도 DB에 저장하여 관리자가 검수할 수 있도록 함

ALTER TABLE public.restaurants 
ALTER COLUMN name DROP NOT NULL;

-- 확인 코멘트
COMMENT ON COLUMN public.restaurants.name IS 'name이 NULL인 경우는 no_restaurants 또는 all_names_null 케이스로 관리자 검수 필요';
