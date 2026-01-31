-- search_restaurants_by_youtube_title 함수의 r.name 참조 오류 수정
-- restaurants 테이블에 name 컬럼이 없고 approved_name 컬럼이 존재함

CREATE OR REPLACE FUNCTION public.search_restaurants_by_youtube_title(search_query text, max_results integer DEFAULT 50, include_all_status boolean DEFAULT false, korean_only boolean DEFAULT false) RETURNS TABLE(id uuid, name text, road_address text, jibun_address text, phone text, categories text[], youtube_link text, tzuyang_review text, lat numeric, lng numeric, status text, english_address text, youtube_title text, youtube_meta jsonb, origin_address jsonb, address_elements jsonb, reasoning_basis text, evaluation_results jsonb, complete_match_score integer, word_match_score double precision, trigram_similarity real, levenshtein_distance integer)
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public'
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
        r.approved_name AS name,
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
        extensions.similarity(
            REPLACE(LOWER(r.youtube_meta->>'title'), ' ', ''),
            REPLACE(LOWER(clean_search_query), ' ', '')
        ) AS trigram_similarity,
        -- 레벤슈타인 거리
        extensions.levenshtein(
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

ALTER FUNCTION public.search_restaurants_by_youtube_title(search_query text, max_results integer, include_all_status boolean, korean_only boolean) OWNER TO postgres;

COMMENT ON FUNCTION public.search_restaurants_by_youtube_title(search_query text, max_results integer, include_all_status boolean, korean_only boolean) IS '유튜브 제목으로 검색 (완전 포함 → 단어 매칭 → Trigram 유사도 → 레벤슈타인 거리 우선순위)';
