-- ============================================
-- 맛집 이름 검색 함수 (Trigram + Levenshtein)
-- ============================================

-- 기존 함수 삭제
DROP FUNCTION IF EXISTS public.search_restaurants_by_name(TEXT, REAL, INTEGER);

-- fuzzystrmatch 확장 활성화 (Levenshtein 함수 사용)
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA extensions;

-- 맛집 이름으로 레스토랑 검색하는 함수 (YouTube 제목 검색과 동일한 로직)
CREATE OR REPLACE FUNCTION public.search_restaurants_by_name(
    search_query TEXT,
    similarity_threshold REAL DEFAULT 0.001,
    max_results INTEGER DEFAULT 100
)
RETURNS SETOF public.restaurants
LANGUAGE plpgsql
AS $$
BEGIN
    -- Bigram (2글자) 사용 설정
    SET pg_trgm.similarity_threshold = 0.02;
    
    RETURN QUERY
    SELECT 
        r.*
    FROM 
        public.restaurants r
    WHERE 
        r.status = 'approved'
        -- 매우 느슨한 필터링: 검색어의 글자 중 일부라도 포함되면 통과
        AND (
            -- 기본 ILIKE 매칭
            r.name ILIKE '%' || search_query || '%'
            -- 유사도 매칭 (매우 낮은 threshold)
            OR similarity(r.name::TEXT, search_query) > 0
            OR word_similarity(search_query, r.name::TEXT) > 0
            -- 띄어쓰기 제거 후 매칭
            OR replace(lower(r.name), ' ', '') LIKE '%' || replace(lower(search_query), ' ', '') || '%'
            -- 검색어의 각 글자를 분해해서 하나라도 포함되면 통과
            OR EXISTS (
                SELECT 1
                FROM unnest(string_to_array(lower(search_query), NULL)) AS query_char
                WHERE lower(r.name) LIKE '%' || query_char || '%'
            )
        )
        -- 필수 조건: 검색어의 최소 1글자는 반드시 포함되어야 함
        AND EXISTS (
            SELECT 1
            FROM unnest(string_to_array(lower(search_query), NULL)) AS query_char
            WHERE lower(r.name) LIKE '%' || query_char || '%'
        )
    ORDER BY 
        -- 1. 완전 일치 우선 (대소문자 무시)
        CASE WHEN lower(r.name) = lower(search_query) THEN 0 ELSE 1 END,
        -- 2. 띄어쓰기 제거 후 완전 일치
        CASE WHEN replace(lower(r.name), ' ', '') = replace(lower(search_query), ' ', '') THEN 0 ELSE 1 END,
        -- 3. 시작 부분 일치 우선
        CASE WHEN lower(r.name) LIKE lower(search_query) || '%' THEN 0 ELSE 1 END,
        -- 4. 토큰 매칭 개수 계산 (검색어의 각 글자가 이름에 몇 개나 있는지)
        (
            SELECT COUNT(*)
            FROM unnest(string_to_array(lower(search_query), NULL)) AS query_char
            WHERE lower(r.name) LIKE '%' || query_char || '%'
        ) DESC,
        -- 5. 단방향 유사도 (검색어가 이름의 일부와 얼마나 비슷한지)
        word_similarity(search_query, r.name::TEXT) DESC,
        -- 6. 전체 유사도 (높을수록 좋음)
        similarity(r.name::TEXT, search_query) DESC,
        -- 7. Levenshtein 거리 (작을수록 좋음)
        levenshtein(lower(r.name), lower(search_query)) ASC,
        -- 8. 이름 길이 (짧을수록 좋음)
        LENGTH(r.name::TEXT) ASC
    LIMIT max_results;
END;
$$;

-- 함수 설명
COMMENT ON FUNCTION public.search_restaurants_by_name IS 
'맛집 이름으로 레스토랑 검색 (Trigram 유사도 + Levenshtein 거리 + 토큰 매칭 개수, status=approved만)';

-- 사용 예시:
-- SELECT * FROM search_restaurants_by_name('고기집', 0.01, 50);
-- SELECT * FROM search_restaurants_by_name('짬뽕', 0.01, 50);
