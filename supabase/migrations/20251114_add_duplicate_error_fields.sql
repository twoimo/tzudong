-- 중복 검사 에러 추적을 위한 컬럼 추가
ALTER TABLE restaurants
ADD COLUMN IF NOT EXISTS db_error_message TEXT,
ADD COLUMN IF NOT EXISTS db_error_details JSONB;

-- 인덱스 추가 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_restaurants_jibun_address_pattern ON restaurants USING btree (jibun_address text_pattern_ops);

-- 코멘트 추가
COMMENT ON COLUMN restaurants.db_error_message IS '중복 검사 등 DB 오류 메시지';

COMMENT ON COLUMN restaurants.db_error_details IS '중복된 맛집 정보 등 상세 에러 정보 (JSONB)';