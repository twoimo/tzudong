-- ========================================
-- 중복 RLS 정책 통합 마이그레이션
-- 작성일: 2025년 12월 19일
-- 설명: Multiple Permissive Policies 경고 해결
-- ========================================

-- ========================================
-- 1. announcements 테이블
-- 기존: "Admins can manage announcements" + "Announcements are viewable by everyone"
-- ========================================

DROP POLICY IF EXISTS "Announcements are viewable by everyone" ON public.announcements;
DROP POLICY IF EXISTS "Admins can manage announcements" ON public.announcements;

-- 통합 SELECT 정책 (일반 사용자: is_active=true만, 관리자: 전체)
CREATE POLICY "Announcements select policy"
    ON public.announcements FOR SELECT
    USING (
        is_active = true 
        OR public.is_user_admin((select auth.uid()))
    );

-- 관리자 전용 INSERT/UPDATE/DELETE
CREATE POLICY "Admins can insert announcements"
    ON public.announcements FOR INSERT
    WITH CHECK (public.is_user_admin((select auth.uid())));

CREATE POLICY "Admins can update announcements"
    ON public.announcements FOR UPDATE
    USING (public.is_user_admin((select auth.uid())));

CREATE POLICY "Admins can delete announcements"
    ON public.announcements FOR DELETE
    USING (public.is_user_admin((select auth.uid())));

-- ========================================
-- 2. restaurant_requests 테이블
-- 기존: "Users can view own requests" + "Admins can view all requests"
-- ========================================

DROP POLICY IF EXISTS "Users can view own requests" ON public.restaurant_requests;
DROP POLICY IF EXISTS "Admins can view all requests" ON public.restaurant_requests;

-- 통합 SELECT 정책
CREATE POLICY "Restaurant requests select policy"
    ON public.restaurant_requests FOR SELECT
    USING (
        (select auth.uid()) = user_id 
        OR public.is_user_admin((select auth.uid()))
    );

-- ========================================
-- 3. restaurant_submissions 테이블
-- 기존: "Users can view own submissions" + "Admins can view all submissions"
-- ========================================

DROP POLICY IF EXISTS "Users can view own submissions" ON public.restaurant_submissions;
DROP POLICY IF EXISTS "Admins can view all submissions" ON public.restaurant_submissions;

-- 통합 SELECT 정책
CREATE POLICY "Restaurant submissions select policy"
    ON public.restaurant_submissions FOR SELECT
    USING (
        (select auth.uid()) = user_id 
        OR public.is_user_admin((select auth.uid()))
    );

-- ========================================
-- 4. restaurant_submission_items 테이블
-- 기존: "Users can view/insert own" + "Admins can manage all"
-- ========================================

DROP POLICY IF EXISTS "Users can view own submission items" ON public.restaurant_submission_items;
DROP POLICY IF EXISTS "Users can insert own submission items" ON public.restaurant_submission_items;
DROP POLICY IF EXISTS "Admins can manage all submission items" ON public.restaurant_submission_items;

-- 통합 SELECT 정책
CREATE POLICY "Submission items select policy"
    ON public.restaurant_submission_items FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.restaurant_submissions s
            WHERE s.id = submission_id AND s.user_id = (select auth.uid())
        )
        OR public.is_user_admin((select auth.uid()))
    );

-- 통합 INSERT 정책
CREATE POLICY "Submission items insert policy"
    ON public.restaurant_submission_items FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.restaurant_submissions s
            WHERE s.id = submission_id AND s.user_id = (select auth.uid())
        )
        OR public.is_user_admin((select auth.uid()))
    );

-- 관리자 전용 UPDATE/DELETE
CREATE POLICY "Admins can update submission items"
    ON public.restaurant_submission_items FOR UPDATE
    USING (public.is_user_admin((select auth.uid())));

CREATE POLICY "Admins can delete submission items"
    ON public.restaurant_submission_items FOR DELETE
    USING (public.is_user_admin((select auth.uid())));

-- ========================================
-- 5. restaurants 테이블
-- 기존: "Approved restaurants are viewable by everyone" + "Admins can view all restaurants"
-- ========================================

DROP POLICY IF EXISTS "Approved restaurants are viewable by everyone" ON public.restaurants;
DROP POLICY IF EXISTS "Admins can view all restaurants" ON public.restaurants;

-- 통합 SELECT 정책 (일반 사용자: approved만, 관리자: 전체)
CREATE POLICY "Restaurants select policy"
    ON public.restaurants FOR SELECT
    USING (
        status = 'approved' 
        OR public.is_user_admin((select auth.uid()))
    );

-- ========================================
-- 6. server_costs 테이블
-- 기존: "Server costs are viewable by everyone" + "Admins can manage server costs"
-- ========================================

DROP POLICY IF EXISTS "Server costs are viewable by everyone" ON public.server_costs;
DROP POLICY IF EXISTS "Admins can manage server costs" ON public.server_costs;

-- 통합 SELECT 정책 (모든 사용자 읽기 가능)
CREATE POLICY "Server costs select policy"
    ON public.server_costs FOR SELECT
    USING (true);

-- 관리자 전용 INSERT/UPDATE/DELETE
CREATE POLICY "Admins can insert server costs"
    ON public.server_costs FOR INSERT
    WITH CHECK (public.is_user_admin((select auth.uid())));

CREATE POLICY "Admins can update server costs"
    ON public.server_costs FOR UPDATE
    USING (public.is_user_admin((select auth.uid())));

CREATE POLICY "Admins can delete server costs"
    ON public.server_costs FOR DELETE
    USING (public.is_user_admin((select auth.uid())));

-- ========================================
-- 완료 메시지
-- ========================================

DO $$
BEGIN
    RAISE NOTICE '✅ 중복 RLS 정책 통합 완료';
    RAISE NOTICE '   - announcements: 2개 → 4개 (역할별 분리)';
    RAISE NOTICE '   - restaurant_requests: 2개 → 1개 SELECT 통합';
    RAISE NOTICE '   - restaurant_submissions: 2개 → 1개 SELECT 통합';
    RAISE NOTICE '   - restaurant_submission_items: 3개 → 4개 (역할별 분리)';
    RAISE NOTICE '   - restaurants: 2개 → 1개 SELECT 통합';
    RAISE NOTICE '   - server_costs: 2개 → 4개 (역할별 분리)';
END $$;
