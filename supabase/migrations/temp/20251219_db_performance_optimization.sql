-- ========================================
-- Supabase 데이터베이스 성능 최적화 마이그레이션
-- 작성일: 2025년 12월 19일
-- 설명: Security Advisor, Performance Advisor 권고사항 적용
-- ========================================

-- ========================================
-- PART 1: 함수 SEARCH_PATH 보안 설정
-- ========================================

-- 1.1 generate_unique_id 함수 재정의 (SET search_path 추가)
DROP FUNCTION IF EXISTS public.generate_unique_id(TEXT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.generate_unique_id(
    p_youtube_link TEXT,
    p_name TEXT,
    p_tzuyang_review TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
    combined_string TEXT;
BEGIN
    combined_string := COALESCE(p_youtube_link, '') || '|' ||
                       COALESCE(p_name, '') || '|' ||
                       COALESCE(p_tzuyang_review, '');
    RETURN encode(extensions.digest(combined_string, 'sha256'), 'hex');
END;
$$;

COMMENT ON FUNCTION public.generate_unique_id IS 'youtube_link + name + tzuyang_review 기반 SHA-256 해시 (search_path 보안 적용)';

-- 1.2 get_ncp_monthly_usage 함수 (존재 시 업데이트)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_ncp_monthly_usage' AND pronamespace = 'public'::regnamespace) THEN
        EXECUTE 'ALTER FUNCTION public.get_ncp_monthly_usage SET search_path = public';
        RAISE NOTICE '✅ get_ncp_monthly_usage 함수에 search_path 설정 완료';
    ELSE
        RAISE NOTICE '⚠️ get_ncp_monthly_usage 함수가 존재하지 않습니다';
    END IF;
END $$;

-- 1.3 increment_ncp_api_usage 함수 (존재 시 업데이트)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'increment_ncp_api_usage' AND pronamespace = 'public'::regnamespace) THEN
        EXECUTE 'ALTER FUNCTION public.increment_ncp_api_usage SET search_path = public';
        RAISE NOTICE '✅ increment_ncp_api_usage 함수에 search_path 설정 완료';
    ELSE
        RAISE NOTICE '⚠️ increment_ncp_api_usage 함수가 존재하지 않습니다';
    END IF;
END $$;

-- ========================================
-- PART 2: RLS INITPLAN 최적화
-- auth.uid() → (select auth.uid()) 변경으로 행별 재평가 방지
-- ========================================

-- 2.1 restaurant_requests RLS
DROP POLICY IF EXISTS "Users can view own requests" ON public.restaurant_requests;
CREATE POLICY "Users can view own requests"
    ON public.restaurant_requests FOR SELECT
    USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own requests" ON public.restaurant_requests;
CREATE POLICY "Users can insert own requests"
    ON public.restaurant_requests FOR INSERT
    WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Admins can view all requests" ON public.restaurant_requests;
CREATE POLICY "Admins can view all requests"
    ON public.restaurant_requests FOR SELECT
    USING (public.is_user_admin((select auth.uid())));

DROP POLICY IF EXISTS "Admins can update requests" ON public.restaurant_requests;
CREATE POLICY "Admins can update requests"
    ON public.restaurant_requests FOR UPDATE
    USING (public.is_user_admin((select auth.uid())));

-- 2.2 restaurant_submissions RLS
DROP POLICY IF EXISTS "Users can view own submissions" ON public.restaurant_submissions;
CREATE POLICY "Users can view own submissions"
    ON public.restaurant_submissions FOR SELECT
    USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert own submissions" ON public.restaurant_submissions;
CREATE POLICY "Users can insert own submissions"
    ON public.restaurant_submissions FOR INSERT
    WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own pending submissions" ON public.restaurant_submissions;
CREATE POLICY "Users can delete own pending submissions"
    ON public.restaurant_submissions FOR DELETE
    USING ((select auth.uid()) = user_id AND status = 'pending');

DROP POLICY IF EXISTS "Admins can view all submissions" ON public.restaurant_submissions;
CREATE POLICY "Admins can view all submissions"
    ON public.restaurant_submissions FOR SELECT
    USING (public.is_user_admin((select auth.uid())));

DROP POLICY IF EXISTS "Admins can update all submissions" ON public.restaurant_submissions;
CREATE POLICY "Admins can update all submissions"
    ON public.restaurant_submissions FOR UPDATE
    USING (public.is_user_admin((select auth.uid())));

-- 2.3 restaurant_submission_items RLS
DROP POLICY IF EXISTS "Users can view own submission items" ON public.restaurant_submission_items;
CREATE POLICY "Users can view own submission items"
    ON public.restaurant_submission_items FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.restaurant_submissions s
            WHERE s.id = submission_id AND s.user_id = (select auth.uid())
        )
    );

DROP POLICY IF EXISTS "Users can insert own submission items" ON public.restaurant_submission_items;
CREATE POLICY "Users can insert own submission items"
    ON public.restaurant_submission_items FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.restaurant_submissions s
            WHERE s.id = submission_id AND s.user_id = (select auth.uid())
        )
    );

DROP POLICY IF EXISTS "Admins can manage all submission items" ON public.restaurant_submission_items;
CREATE POLICY "Admins can manage all submission items"
    ON public.restaurant_submission_items FOR ALL
    USING (public.is_user_admin((select auth.uid())));

-- ========================================
-- PART 3: 중복 인덱스 제거
-- ========================================

-- idx_submission_items_target_restaurant와 idx_submission_items_target_restaurant_id는 동일
DROP INDEX IF EXISTS idx_submission_items_target_restaurant;

-- ========================================
-- PART 4: FK 인덱스 추가
-- ========================================

CREATE INDEX IF NOT EXISTS idx_announcements_admin_id 
    ON public.announcements(admin_id);

CREATE INDEX IF NOT EXISTS idx_submissions_resolved_by_admin 
    ON public.restaurant_submissions(resolved_by_admin_id) 
    WHERE resolved_by_admin_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_restaurants_created_by 
    ON public.restaurants(created_by) 
    WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_restaurants_updated_by_admin 
    ON public.restaurants(updated_by_admin_id) 
    WHERE updated_by_admin_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_server_costs_updated_by 
    ON public.server_costs(updated_by) 
    WHERE updated_by IS NOT NULL;

-- ========================================
-- PART 5: 미사용 인덱스 제거 (52개)
-- ========================================

-- restaurants 테이블
DROP INDEX IF EXISTS idx_restaurants_name_trgm;
DROP INDEX IF EXISTS idx_restaurants_lat_lng;
DROP INDEX IF EXISTS idx_restaurants_categories;
DROP INDEX IF EXISTS idx_restaurants_geocoding_false_stage;
DROP INDEX IF EXISTS idx_restaurants_approved_with_reviews;
DROP INDEX IF EXISTS idx_restaurants_pending;
DROP INDEX IF EXISTS idx_restaurants_address_elements;
DROP INDEX IF EXISTS idx_restaurants_youtube_meta;
DROP INDEX IF EXISTS idx_restaurants_evaluation_results;
DROP INDEX IF EXISTS idx_restaurants_origin_address;

-- reviews 테이블
DROP INDEX IF EXISTS idx_reviews_ocr_pending;
DROP INDEX IF EXISTS idx_reviews_duplicate;
DROP INDEX IF EXISTS idx_reviews_restaurant_id;
DROP INDEX IF EXISTS idx_reviews_user_id;
DROP INDEX IF EXISTS idx_reviews_verified;
DROP INDEX IF EXISTS idx_reviews_pinned;
DROP INDEX IF EXISTS idx_reviews_admin_edited;
DROP INDEX IF EXISTS idx_reviews_restaurant_created;
DROP INDEX IF EXISTS idx_reviews_user_created;
DROP INDEX IF EXISTS idx_reviews_categories;

-- restaurant_submission_items 테이블
DROP INDEX IF EXISTS idx_submission_items_target_restaurant_id;
DROP INDEX IF EXISTS idx_submission_items_status;

-- restaurant_requests 테이블
DROP INDEX IF EXISTS idx_restaurant_requests_created_at;
DROP INDEX IF EXISTS idx_restaurant_requests_geocoding;
DROP INDEX IF EXISTS idx_restaurant_requests_location;
DROP INDEX IF EXISTS idx_restaurant_requests_road_address;
DROP INDEX IF EXISTS idx_restaurant_requests_geocoding_pending;

-- restaurant_submissions 테이블
DROP INDEX IF EXISTS idx_submissions_status;

-- profiles 테이블
DROP INDEX IF EXISTS idx_profiles_email;
DROP INDEX IF EXISTS idx_profiles_created_at;

-- review_likes 테이블
DROP INDEX IF EXISTS idx_review_likes_review_id;
DROP INDEX IF EXISTS idx_review_likes_user_id;

-- user_stats 테이블
DROP INDEX IF EXISTS idx_user_stats_trust_score;
DROP INDEX IF EXISTS idx_user_stats_review_count;
DROP INDEX IF EXISTS idx_user_stats_verified_count;
DROP INDEX IF EXISTS idx_user_stats_leaderboard;

-- notifications 테이블
DROP INDEX IF EXISTS idx_notifications_user_id;
DROP INDEX IF EXISTS idx_notifications_created_at;
DROP INDEX IF EXISTS idx_notifications_type;
DROP INDEX IF EXISTS idx_notifications_user_type;
DROP INDEX IF EXISTS idx_notifications_data;

-- mv_restaurant_stats 테이블
DROP INDEX IF EXISTS idx_mv_restaurant_stats_review_count;
DROP INDEX IF EXISTS idx_mv_restaurant_stats_verified;
DROP INDEX IF EXISTS idx_mv_restaurant_stats_location;

-- mv_user_leaderboard 테이블
DROP INDEX IF EXISTS idx_mv_user_leaderboard_rank;
DROP INDEX IF EXISTS idx_mv_user_leaderboard_trust_score;

-- mv_popular_reviews 테이블
DROP INDEX IF EXISTS idx_mv_popular_reviews_like_count;
DROP INDEX IF EXISTS idx_mv_popular_reviews_restaurant;
DROP INDEX IF EXISTS idx_mv_popular_reviews_created_at;

-- ========================================
-- PART 6: 완료 메시지
-- ========================================

DO $$
BEGIN
    RAISE NOTICE '✅ 데이터베이스 성능 최적화 완료';
    RAISE NOTICE '   - 함수 search_path 보안 설정 (3개)';
    RAISE NOTICE '   - RLS initplan 최적화 (12개 정책)';
    RAISE NOTICE '   - 중복 인덱스 제거 (1개)';
    RAISE NOTICE '   - FK 인덱스 추가 (5개)';
    RAISE NOTICE '   - 미사용 인덱스 제거 (52개)';
    RAISE NOTICE '';
    RAISE NOTICE '⚠️ 수동 설정 필요:';
    RAISE NOTICE '   - Supabase Dashboard > Authentication > Providers > Email';
    RAISE NOTICE '   - "Enable leaked password protection" 활성화';
END $$;
