-- 데이터베이스 성능 최적화 마이그레이션
-- Supabase 쿼리 성능 로그 분석 기반 최적화
-- 시스템 카탈로그는 Supabase에서 관리하므로 사용자 테이블/뷰에 대한 최적화만 적용

-- 1. 사용자 정의 테이블에 대한 인덱스 최적화
-- reviews 테이블의 자주 조회되는 컬럼에 인덱스 추가
CREATE INDEX IF NOT EXISTS idx_reviews_user_id_created_at
ON public.reviews (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reviews_restaurant_id_is_verified
ON public.reviews (restaurant_id, is_verified);

-- restaurant_submissions 테이블의 상태별 조회 최적화
CREATE INDEX IF NOT EXISTS idx_restaurant_submissions_user_id_created_at
ON public.restaurant_submissions (user_id, created_at DESC);

-- user_roles 테이블의 역할 조회 최적화
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id_role
ON public.user_roles (user_id, role);

-- 2. 통계 정보 조회를 위한 뷰 (시스템 카탈로그 대신 사용자 데이터 활용)
CREATE OR REPLACE VIEW public.database_stats AS
SELECT
    'restaurants' as table_name,
    COUNT(*) as record_count,
    COUNT(DISTINCT category) as category_count,
    AVG(ai_rating) as avg_rating,
    MAX(created_at) as latest_record
FROM public.restaurants
UNION ALL
SELECT
    'reviews' as table_name,
    COUNT(*) as record_count,
    COUNT(DISTINCT restaurant_id) as restaurant_count,
    AVG(CASE WHEN is_verified THEN 1 ELSE 0 END)::float as verified_ratio,
    MAX(created_at) as latest_record
FROM public.reviews
UNION ALL
SELECT
    'restaurant_submissions' as table_name,
    COUNT(*) as record_count,
    COUNT(DISTINCT user_id) as user_count,
    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as recent_submissions,
    MAX(created_at) as latest_record
FROM public.restaurant_submissions;

-- 3. 애플리케이션 데이터 최적화를 위한 뷰 생성

-- 사용자 활동 요약 뷰 (성능 향상)
CREATE OR REPLACE VIEW public.user_activity_summary AS
SELECT
    u.id as user_id,
    u.raw_user_meta_data->>'nickname' as nickname,
    COALESCE(r.review_count, 0) as total_reviews,
    COALESCE(r.verified_reviews, 0) as verified_reviews,
    COALESCE(s.submission_count, 0) as total_submissions,
    u.created_at as joined_at,
    GREATEST(
        COALESCE(r.last_review_date, '1970-01-01'::timestamp),
        COALESCE(s.last_submission_date, '1970-01-01'::timestamp)
    ) as last_activity
FROM auth.users u
LEFT JOIN (
    SELECT
        user_id,
        COUNT(*) as review_count,
        COUNT(*) FILTER (WHERE is_verified) as verified_reviews,
        MAX(created_at) as last_review_date
    FROM public.reviews
    GROUP BY user_id
) r ON u.id = r.user_id
LEFT JOIN (
    SELECT
        user_id,
        COUNT(*) as submission_count,
        MAX(created_at) as last_submission_date
    FROM public.restaurant_submissions
    GROUP BY user_id
) s ON u.id = s.user_id;

-- 뷰에 대한 보안 정책
ALTER VIEW public.user_activity_summary OWNER TO postgres;
GRANT SELECT ON public.user_activity_summary TO authenticated;

-- 맛집 통계 뷰 (조회 성능 향상)
CREATE OR REPLACE VIEW public.restaurant_insights AS
SELECT
    r.id,
    r.name,
    r.category,
    r.ai_rating,
    r.visit_count,
    COUNT(rv.id) as total_reviews,
    COUNT(rv.id) FILTER (WHERE rv.is_verified) as verified_reviews,
    r.ai_rating as avg_user_rating, -- AI 등급을 사용자 평점으로 사용
    MAX(rv.created_at) as latest_review_date,
    CASE
        WHEN COUNT(rv.id) FILTER (WHERE rv.is_verified) >= 10 THEN '인기 맛집'
        WHEN COUNT(rv.id) FILTER (WHERE rv.is_verified) >= 5 THEN '주목받는 맛집'
        ELSE '신규 맛집'
    END as popularity_status
FROM public.restaurants r
LEFT JOIN public.reviews rv ON r.id = rv.restaurant_id
GROUP BY r.id, r.name, r.category, r.ai_rating, r.visit_count;

-- 뷰에 대한 보안 정책
ALTER VIEW public.restaurant_insights OWNER TO postgres;
GRANT SELECT ON public.restaurant_insights TO public;

-- 리뷰 트렌드 분석 뷰
CREATE OR REPLACE VIEW public.review_trends AS
SELECT
    DATE_TRUNC('day', created_at) as review_date,
    COUNT(*) as daily_reviews,
    COUNT(*) FILTER (WHERE is_verified) as daily_verified_reviews,
    COUNT(DISTINCT user_id) as active_users,
    COUNT(DISTINCT restaurant_id) as reviewed_restaurants
FROM public.reviews
WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', created_at)
ORDER BY review_date DESC;

-- 뷰에 대한 보안 정책
ALTER VIEW public.review_trends OWNER TO postgres;
GRANT SELECT ON public.review_trends TO authenticated;

-- 4. 사용자 정의 함수로 자주 사용하는 집계 쿼리 최적화
CREATE OR REPLACE FUNCTION public.get_restaurant_stats(restaurant_id_param uuid)
RETURNS TABLE (
    total_reviews bigint,
    verified_reviews bigint,
    avg_rating numeric,
    recent_reviews bigint
) LANGUAGE sql SECURITY DEFINER AS $$
    SELECT
        (SELECT COUNT(*) FROM public.reviews WHERE restaurant_id = restaurant_id_param) as total_reviews,
        (SELECT COUNT(*) FROM public.reviews WHERE restaurant_id = restaurant_id_param AND is_verified) as verified_reviews,
        (SELECT ai_rating FROM public.restaurants WHERE id = restaurant_id_param) as avg_rating,
        (SELECT COUNT(*) FROM public.reviews
         WHERE restaurant_id = restaurant_id_param
         AND created_at >= CURRENT_DATE - INTERVAL '7 days') as recent_reviews;
$$;

-- 함수에 대한 권한 설정
GRANT EXECUTE ON FUNCTION public.get_restaurant_stats(uuid) TO authenticated;

-- 5. 사용자 정의 함수로 사용자 활동 통계 최적화
CREATE OR REPLACE FUNCTION public.get_user_stats(user_id_param uuid)
RETURNS TABLE (
    total_reviews bigint,
    verified_reviews bigint,
    total_submissions bigint,
    joined_days bigint
) LANGUAGE sql SECURITY DEFINER AS $$
    SELECT
        COALESCE(r.review_count, 0) as total_reviews,
        COALESCE(r.verified_count, 0) as verified_reviews,
        COALESCE(s.submission_count, 0) as total_submissions,
        (CURRENT_DATE - u.created_at::date) as joined_days
    FROM auth.users u
    LEFT JOIN (
        SELECT
            user_id,
            COUNT(*) as review_count,
            COUNT(*) FILTER (WHERE is_verified) as verified_count
        FROM public.reviews
        WHERE user_id = user_id_param
        GROUP BY user_id
    ) r ON u.id = r.user_id
    LEFT JOIN (
        SELECT
            user_id,
            COUNT(*) as submission_count
        FROM public.restaurant_submissions
        WHERE user_id = user_id_param
        GROUP BY user_id
    ) s ON u.id = s.user_id
    WHERE u.id = user_id_param;
$$;

-- 함수에 대한 권한 설정
GRANT EXECUTE ON FUNCTION public.get_user_stats(uuid) TO authenticated;

-- 6. ANALYZE 실행으로 사용자 테이블 통계 업데이트
ANALYZE public.restaurants;
ANALYZE public.reviews;
ANALYZE public.restaurant_submissions;
ANALYZE public.user_roles;
