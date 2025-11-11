-- ============================================
-- YouTube 제목 검색 함수 (Trigram + Levenshtein)
-- ============================================

-- 기존 함수 삭제
DROP FUNCTION IF EXISTS public.search_restaurants_by_youtube_title(TEXT, REAL, INTEGER);

-- fuzzystrmatch 확장 활성화 (Levenshtein 함수 사용)
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA extensions;

-- YouTube 제목으로 레스토랑 검색하는 함수
CREATE OR REPLACE FUNCTION public.search_restaurants_by_youtube_title(
    search_query TEXT,
    similarity_threshold REAL DEFAULT 0.02,
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
        r.youtube_meta IS NOT NULL
        AND r.youtube_meta->>'title' IS NOT NULL
        -- 부분 문자열 매칭 또는 Trigram 유사도로 필터링
        AND (
            (r.youtube_meta->>'title') ILIKE '%' || search_query || '%'
            OR similarity((r.youtube_meta->>'title')::TEXT, search_query) > similarity_threshold
        )
    ORDER BY 
        -- 1. 단방향 유사도 (검색어가 제목의 일부와 얼마나 비슷한지)
        word_similarity(search_query, (r.youtube_meta->>'title')::TEXT) DESC,
        -- 2. 전체 유사도 (높을수록 좋음)
        similarity((r.youtube_meta->>'title')::TEXT, search_query) DESC,
        -- 3. 제목 길이 (짧을수록 좋음)
        LENGTH((r.youtube_meta->>'title')::TEXT) ASC
    LIMIT max_results;
END;
$$;

-- 함수 설명
COMMENT ON FUNCTION public.search_restaurants_by_youtube_title IS 
'YouTube 영상 제목으로 레스토랑 검색 (Trigram 유사도 + Levenshtein 편집 거리)';

-- 사용 예시:
-- SELECT * FROM search_restaurants_by_youtube_title('서울 맛집 짬뽕', 0.3, 50);
