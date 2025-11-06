-- pg_trgm 확장 활성화 (텍스트 유사도 비교를 위해 필요)
-- similarity() 함수를 사용하여 tzuyang_review 매칭에 활용

CREATE EXTENSION IF NOT EXISTS pg_trgm;

COMMENT ON EXTENSION pg_trgm IS 'Trigram 기반 텍스트 유사도 측정 (evaluation_records와 restaurants 매칭에 사용)';
