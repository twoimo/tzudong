-- 이미 승인된 evaluation_records와 restaurants를 연결하는 마이그레이션
-- restaurant_id가 NULL인 approved 레코드를 restaurants 테이블과 매칭

-- 전략: 
-- 1차: youtube_link + 음식점명 정확히 일치
-- 2차: youtube_link + tzuyang_review 유사도 (같은 영상, 여러 음식점 케이스)
-- 3차: 주소 기반 매칭 (jibun_address 일치)

-- ============================================================================
-- 1단계: youtube_link + 음식점명 완전 일치 매칭
-- ============================================================================
UPDATE public.evaluation_records AS er
SET restaurant_id = r.id
FROM public.restaurants AS r
WHERE 
  er.status = 'approved' 
  AND er.restaurant_id IS NULL
  AND er.youtube_link = ANY(r.youtube_links)
  AND LOWER(TRIM(er.restaurant_name)) = LOWER(TRIM(r.name));

-- ============================================================================
-- 2단계: youtube_link + tzuyang_review 유사도 매칭 (1단계에서 매칭 안 된 것)
-- ============================================================================
-- 같은 영상에서 여러 음식점을 방문한 경우, tzuyang_review 일부가 일치하는지 확인
UPDATE public.evaluation_records AS er
SET restaurant_id = r.id
FROM public.restaurants AS r
WHERE 
  er.status = 'approved' 
  AND er.restaurant_id IS NULL  -- 1단계에서 매칭 안 된 것만
  AND er.youtube_link = ANY(r.youtube_links)
  AND r.tzuyang_reviews IS NOT NULL 
  AND array_length(r.tzuyang_reviews, 1) > 0
  AND (er.restaurant_info->>'tzuyang_review') IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM unnest(r.tzuyang_reviews) AS review
    WHERE 
      LENGTH(er.restaurant_info->>'tzuyang_review') > 50  -- 최소 50자 이상
      AND LENGTH(review) > 50
      AND (
        -- tzuyang_review의 첫 100자가 70% 이상 일치
        similarity(
          LEFT(er.restaurant_info->>'tzuyang_review', 100),
          LEFT(review, 100)
        ) > 0.7
        OR
        -- 또는 전체 리뷰가 restaurants의 리뷰에 포함됨
        review LIKE '%' || LEFT(er.restaurant_info->>'tzuyang_review', 200) || '%'
      )
  );

-- ============================================================================
-- 3단계: 주소 기반 매칭 (jibun_address 일치, 아직 매칭 안 된 것)
-- ============================================================================
UPDATE public.evaluation_records AS er
SET restaurant_id = r.id
FROM public.restaurants AS r
WHERE 
  er.status = 'approved' 
  AND er.restaurant_id IS NULL  -- 1, 2단계에서 매칭 안 된 것만
  AND (er.restaurant_info->'naver_address_info'->>'jibun_address') IS NOT NULL
  AND r.jibun_address IS NOT NULL
  AND LOWER(TRIM(er.restaurant_info->'naver_address_info'->>'jibun_address')) = LOWER(TRIM(r.jibun_address))
  AND LOWER(TRIM(er.restaurant_name)) = LOWER(TRIM(r.name));  -- 주소 + 이름 모두 일치해야 함

-- ============================================================================
-- 매칭 결과 확인 쿼리들 (실행 후 확인용, 주석 처리)
-- ============================================================================

-- 전체 매칭 상태 요약
-- SELECT 
--   COUNT(*) as total_approved,
--   COUNT(restaurant_id) as with_restaurant_id,
--   COUNT(*) - COUNT(restaurant_id) as without_restaurant_id,
--   ROUND(COUNT(restaurant_id)::numeric / COUNT(*)::numeric * 100, 2) as match_rate_percent
-- FROM public.evaluation_records
-- WHERE status = 'approved';

-- 매칭된 레코드 샘플 확인
-- SELECT 
--   er.id,
--   er.restaurant_name,
--   er.youtube_link,
--   er.restaurant_id,
--   r.name as matched_restaurant_name,
--   r.jibun_address,
--   array_length(r.youtube_links, 1) as youtube_count,
--   array_length(r.tzuyang_reviews, 1) as review_count
-- FROM public.evaluation_records er
-- INNER JOIN public.restaurants r ON er.restaurant_id = r.id
-- WHERE er.status = 'approved'
-- ORDER BY er.created_at DESC
-- LIMIT 20;

-- 매칭되지 않은 레코드 확인 (수동 처리 필요)
-- SELECT 
--   er.id,
--   er.restaurant_name,
--   er.youtube_link,
--   er.status,
--   er.restaurant_info->'naver_address_info'->>'jibun_address' as jibun_address,
--   LEFT(er.restaurant_info->>'tzuyang_review', 100) as review_preview,
--   er.created_at
-- FROM public.evaluation_records er
-- WHERE er.status = 'approved' 
--   AND er.restaurant_id IS NULL
-- ORDER BY er.created_at DESC;

-- 같은 youtube_link에 여러 음식점이 있는 경우 확인
-- SELECT 
--   youtube_link,
--   COUNT(*) as restaurant_count,
--   array_agg(restaurant_name) as restaurants
-- FROM public.evaluation_records
-- WHERE status = 'approved'
-- GROUP BY youtube_link
-- HAVING COUNT(*) > 1
-- ORDER BY COUNT(*) DESC;

COMMENT ON COLUMN public.evaluation_records.restaurant_id IS 
'evaluation_record가 승인되어 생성된 restaurant의 ID (추적용). youtube_link + 음식점명, tzuyang_review 유사도, 주소 기반으로 매칭됨.';
