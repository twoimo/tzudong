-- ============================================
-- 고급 맛집 검색 우선순위 시스템
-- ============================================
-- 
-- 검색 우선순위:
-- 1. 완전 포함: 검색어가 맛집명에 그대로 포함 (최우선)
-- 2. 단어 매칭: 검색 단어(띄어쓰기 기준) 1/3 이상 포함
-- 3. Trigram 유사도: 띄어쓰기 제거 후 유사도 계산
-- 4. 레벤슈타인 거리: 편집 거리 기반 우선순위
-- 
-- 필터링: 최소 1글자 이상 포함 필수
-- ============================================

-- 1. 단어 매칭 점수 계산 함수
-- 검색어의 단어가 맛집명에 얼마나 포함되어 있는지 계산 (1/3 이상 필수)
CREATE OR REPLACE FUNCTION public.calculate_word_match_score(
    restaurant_name TEXT,
    search_query TEXT
) RETURNS DOUBLE PRECISION AS $$
DECLARE
    clean_name TEXT;
    clean_query TEXT;
    search_words TEXT[];
    matched_count INT := 0;
    total_words INT;
    word TEXT;
BEGIN
    -- 소문자 변환 (띄어쓰기는 유지)
    clean_name := LOWER(restaurant_name);
    clean_query := LOWER(search_query);
    
    -- 검색어를 띄어쓰기 기준으로 단어 배열로 변환
    search_words := string_to_array(clean_query, ' ');
    total_words := array_length(search_words, 1);
    
    -- 빈 문자열 처리
    IF total_words IS NULL OR total_words = 0 THEN
        RETURN 0.0;
    END IF;
    
    -- 각 단어가 맛집명에 포함되는지 확인
    FOREACH word IN ARRAY search_words LOOP
        IF word != '' AND clean_name LIKE '%' || word || '%' THEN
            matched_count := matched_count + 1;
        END IF;
    END LOOP;
    
    -- 일치 비율 반환 (0~1)
    RETURN matched_count::DOUBLE PRECISION / total_words;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION public.calculate_word_match_score IS 
'검색어의 단어(띄어쓰기 기준)가 맛집명에 얼마나 포함되는지 0~1 사이의 점수 반환';

-- 2. 기존 함수 삭제 (모든 오버로드 버전)
DROP FUNCTION IF EXISTS public.search_restaurants_by_name(TEXT, TEXT[], REAL, INTEGER);
DROP FUNCTION IF EXISTS public.search_restaurants_by_name(TEXT, TEXT[], INTEGER);
DROP FUNCTION IF EXISTS public.search_restaurants_by_name(TEXT, TEXT[], INTEGER, BOOLEAN);
DROP FUNCTION IF EXISTS public.search_restaurants_by_name(TEXT, TEXT[], INTEGER, BOOLEAN, BOOLEAN);
DROP FUNCTION IF EXISTS public.search_restaurants_by_name(TEXT, REAL, INTEGER);
DROP FUNCTION IF EXISTS public.search_restaurants_by_name(TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.search_restaurants_by_youtube_title(TEXT, REAL, INTEGER);
DROP FUNCTION IF EXISTS public.search_restaurants_by_youtube_title(TEXT, INTEGER);
DROP FUNCTION IF EXISTS public.search_restaurants_by_youtube_title(TEXT, INTEGER, BOOLEAN);
DROP FUNCTION IF EXISTS public.search_restaurants_by_youtube_title(TEXT, INTEGER, BOOLEAN, BOOLEAN);
DROP FUNCTION IF EXISTS public.calculate_sequence_match_score(TEXT, TEXT);

-- 3. 맛집명으로 검색하는 고급 함수 (카테고리 필터 지원)
CREATE OR REPLACE FUNCTION public.search_restaurants_by_name(
    search_query TEXT,
    search_categories TEXT[] DEFAULT NULL,
    max_results INTEGER DEFAULT 50,
    include_all_status BOOLEAN DEFAULT FALSE,
    korean_only BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
    id UUID,
    name TEXT,
    road_address TEXT,
    jibun_address TEXT,
    phone TEXT,
    categories TEXT[],
    youtube_link TEXT,
    tzuyang_review TEXT,
    lat NUMERIC,
    lng NUMERIC,
    status TEXT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    english_address TEXT,
    youtube_meta JSONB,
    complete_match_score INT,
    word_match_score DOUBLE PRECISION,
    trigram_similarity REAL,
    levenshtein_distance INT
)
LANGUAGE plpgsql
AS $$
DECLARE
    clean_search_query TEXT;
    min_word_match_threshold DOUBLE PRECISION := 0.33; -- 최소 1/3 단어 매칭
BEGIN
    -- 검색어 정리
    clean_search_query := TRIM(search_query);
    
    -- 빈 검색어는 빈 결과 반환
    IF clean_search_query = '' THEN
        RETURN;
    END IF;
    
    RETURN QUERY
    SELECT 
        r.id,
        r.name,
        r.road_address,
        r.jibun_address,
        r.phone,
        r.categories,
        r.youtube_link,
        r.tzuyang_review,
        r.lat,
        r.lng,
        r.status,
        r.created_at,
        r.updated_at,
        r.english_address,
        r.youtube_meta,
        -- 완전 포함 점수: 검색어가 맛집명에 그대로 포함되면 1, 아니면 0
        CASE 
            WHEN LOWER(r.name) LIKE '%' || LOWER(clean_search_query) || '%' THEN 1
            ELSE 0
        END AS complete_match_score,
        -- 단어 매칭 점수
        calculate_word_match_score(r.name, clean_search_query) AS word_match_score,
        -- Trigram 유사도 (띄어쓰기 제거)
        similarity(
            REPLACE(LOWER(r.name), ' ', ''),
            REPLACE(LOWER(clean_search_query), ' ', '')
        ) AS trigram_similarity,
        -- 레벤슈타인 거리 (편집 거리)
        levenshtein(
            LOWER(r.name),
            LOWER(clean_search_query)
        ) AS levenshtein_distance
    FROM 
        public.restaurants r
    WHERE 
        -- 상태 필터: include_all_status가 true면 전체, false면 approved만
        (include_all_status = TRUE OR r.status = 'approved')
        -- 카테고리 필터 (선택적)
        AND (search_categories IS NULL OR r.categories && search_categories)
        -- 한국 지역 필터 (선택적)
        AND (
            korean_only = FALSE 
            OR COALESCE(r.road_address, r.jibun_address, r.english_address, '') ~ '(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|충청북도|충청남도|전북특별자치도|전라남도|경상북도|경상남도|제주특별자치도)'
        )
        -- 필수 조건: 최소 1글자 이상 포함
        AND EXISTS (
            SELECT 1
            FROM unnest(string_to_array(LOWER(clean_search_query), NULL)) AS query_char
            WHERE query_char != '' AND LOWER(r.name) LIKE '%' || query_char || '%'
        )
    ORDER BY 
        -- 1단계: 검색어가 그대로 포함되는지 여부 (포함=0, 미포함=1)
        CASE WHEN LOWER(r.name) LIKE '%' || LOWER(clean_search_query) || '%' THEN 0 ELSE 1 END,
        -- 2단계: 우선순위
        -- 2-1. 단어 매칭 점수 (높을수록 좋음)
        word_match_score DESC,
        -- 2-2. Trigram 유사도 (띄어쓰기 제거, 높을수록 좋음)
        trigram_similarity DESC,
        -- 2-3. 레벤슈타인 거리 (작을수록 좋음)
        levenshtein_distance ASC,
        -- 2-4. 이름 길이 (짧을수록 좋음)
        LENGTH(r.name) ASC
    LIMIT max_results;
END;
$$;

COMMENT ON FUNCTION public.search_restaurants_by_name IS 
'맛집 이름으로 검색 (완전 포함 → 단어 매칭 → Trigram 유사도 → 레벤슈타인 거리 우선순위)';

-- 4. 유튜브 영상 제목으로 검색하는 고급 함수 (youtube_meta->>'title' 사용)
CREATE OR REPLACE FUNCTION public.search_restaurants_by_youtube_title(
    search_query TEXT,
    max_results INTEGER DEFAULT 50,
    include_all_status BOOLEAN DEFAULT FALSE,
    korean_only BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
    id UUID,
    name TEXT,
    road_address TEXT,
    jibun_address TEXT,
    phone TEXT,
    categories TEXT[],
    youtube_link TEXT,
    tzuyang_review TEXT,
    lat NUMERIC,
    lng NUMERIC,
    status TEXT,
    english_address TEXT,
    youtube_title TEXT,
    youtube_meta JSONB,
    origin_address JSONB,
    address_elements JSONB,
    reasoning_basis TEXT,
    evaluation_results JSONB,
    complete_match_score INT,
    word_match_score DOUBLE PRECISION,
    trigram_similarity REAL,
    levenshtein_distance INT
)
LANGUAGE plpgsql
AS $$
DECLARE
    clean_search_query TEXT;
    min_word_match_threshold DOUBLE PRECISION := 0.33; -- 최소 1/3 단어 매칭
BEGIN
    -- 검색어 정리
    clean_search_query := TRIM(search_query);
    
    -- 빈 검색어는 빈 결과 반환
    IF clean_search_query = '' THEN
        RETURN;
    END IF;
    
    -- youtube_meta JSONB에서 title 추출하여 검색
    RETURN QUERY
    SELECT 
        r.id,
        r.name,
        r.road_address,
        r.jibun_address,
        r.phone,
        r.categories,
        r.youtube_link,
        r.tzuyang_review,
        r.lat,
        r.lng,
        r.status,
        r.english_address,
        (r.youtube_meta->>'title')::TEXT AS youtube_title,
        r.youtube_meta,
        r.origin_address,
        r.address_elements,
        r.reasoning_basis,
        r.evaluation_results,
        -- 완전 포함 점수
        CASE 
            WHEN LOWER(r.youtube_meta->>'title') LIKE '%' || LOWER(clean_search_query) || '%' THEN 1
            ELSE 0
        END AS complete_match_score,
        -- 단어 매칭 점수
        calculate_word_match_score(r.youtube_meta->>'title', clean_search_query) AS word_match_score,
        -- Trigram 유사도 (띄어쓰기 제거)
        similarity(
            REPLACE(LOWER(r.youtube_meta->>'title'), ' ', ''),
            REPLACE(LOWER(clean_search_query), ' ', '')
        ) AS trigram_similarity,
        -- 레벤슈타인 거리
        levenshtein(
            LOWER(r.youtube_meta->>'title'),
            LOWER(clean_search_query)
        ) AS levenshtein_distance
    FROM 
        public.restaurants r
    WHERE 
        -- 상태 필터: include_all_status가 true면 전체, false면 approved만
        (include_all_status = TRUE OR r.status = 'approved')
        AND r.youtube_meta IS NOT NULL
        AND r.youtube_meta->>'title' IS NOT NULL
        AND r.youtube_meta->>'title' != ''
        -- 한국 지역 필터 (선택적)
        AND (
            korean_only = FALSE 
            OR COALESCE(r.road_address, r.jibun_address, r.english_address, '') ~ '(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|충청북도|충청남도|전북특별자치도|전라남도|경상북도|경상남도|제주특별자치도)'
        )
        -- 필수 조건: 최소 1글자 이상 포함
        AND EXISTS (
            SELECT 1
            FROM unnest(string_to_array(LOWER(clean_search_query), NULL)) AS query_char
            WHERE query_char != '' AND LOWER(r.youtube_meta->>'title') LIKE '%' || query_char || '%'
        )
    ORDER BY 
        -- 1단계: 검색어가 그대로 포함되는지 여부 (포함=0, 미포함=1)
        CASE WHEN LOWER(r.youtube_meta->>'title') LIKE '%' || LOWER(clean_search_query) || '%' THEN 0 ELSE 1 END,
        -- 2단계: 우선순위
        -- 2-1. 단어 매칭 점수 (높을수록 좋음)
        word_match_score DESC,
        -- 2-2. Trigram 유사도 (띄어쓰기 제거, 높을수록 좋음)
        trigram_similarity DESC,
        -- 2-3. 레벤슈타인 거리 (작을수록 좋음)
        levenshtein_distance ASC,
        -- 2-4. 제목 길이 (짧을수록 좋음)
        LENGTH(r.youtube_meta->>'title') ASC
    LIMIT max_results;
END;
$$;

COMMENT ON FUNCTION public.search_restaurants_by_youtube_title IS 
'유튜브 제목으로 검색 (완전 포함 → 단어 매칭 → Trigram 유사도 → 레벤슈타인 거리 우선순위)';

-- 5. 함수 실행 권한 부여
GRANT EXECUTE ON FUNCTION public.calculate_word_match_score(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_word_match_score(TEXT, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION public.search_restaurants_by_name(TEXT, TEXT[], INTEGER, BOOLEAN, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_restaurants_by_name(TEXT, TEXT[], INTEGER, BOOLEAN, BOOLEAN) TO anon;
GRANT EXECUTE ON FUNCTION public.search_restaurants_by_youtube_title(TEXT, INTEGER, BOOLEAN, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_restaurants_by_youtube_title(TEXT, INTEGER, BOOLEAN, BOOLEAN) TO anon;

-- 사용 예시:
-- 
-- 1. 맛집명 검색 (기본)
-- SELECT * FROM search_restaurants_by_name('솔밭 식당', NULL, 10, FALSE, FALSE);
-- 
-- 2. 맛집명 검색 (카테고리 필터 적용)
-- SELECT * FROM search_restaurants_by_name('치킨', ARRAY['치킨'], 10, FALSE, FALSE);
-- 
-- 3. 맛집명 검색 (한국 지역만)
-- SELECT * FROM search_restaurants_by_name('맛집', NULL, 10, FALSE, TRUE);
-- 
-- 4. 유튜브 제목 검색
-- SELECT * FROM search_restaurants_by_youtube_title('맛집 투어', 10, FALSE, FALSE);
-- 
-- 5. 유튜브 제목 검색 (한국 지역만)
-- SELECT * FROM search_restaurants_by_youtube_title('대만 맛집', 10, FALSE, TRUE);
-- 
-- 6. 단어 매칭 점수 확인
-- SELECT name, calculate_word_match_score(name, '솔밭 식당') AS score
-- FROM restaurants
-- WHERE status = 'approved'
-- ORDER BY score DESC
-- LIMIT 10;
