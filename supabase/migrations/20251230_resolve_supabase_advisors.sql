-- Security Advisor: Fix function search paths
CREATE OR REPLACE FUNCTION public.update_ad_banners_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

CREATE OR REPLACE FUNCTION public.reset_weekly_search_count()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- weekly_search_count를 0으로 초기화
  UPDATE public.restaurants
  SET weekly_search_count = 0;
  
  -- 로그 기록
  RAISE NOTICE 'Weekly search count has been reset at %', NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_old_search_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.search_logs
  WHERE searched_at < NOW() - INTERVAL '90 days';
  
  RAISE NOTICE 'Old search logs have been cleaned up at %', NOW();
END;
$$;


-- Performance Advisor: Optimize RLS Policies (InitPlan) & Multiple Permissive Policies

-- 1. search_logs
DROP POLICY IF EXISTS "Users can view own search logs" ON public.search_logs;
CREATE POLICY "Users can view own search logs"
ON public.search_logs FOR SELECT
USING ((select auth.uid()) = user_id);

-- 2. ad_banners
-- Remove multiple permissive policies for SELECT and combine them
DROP POLICY IF EXISTS "ad_banners_select_active" ON public.ad_banners;
DROP POLICY IF EXISTS "ad_banners_select_admin" ON public.ad_banners;
DROP POLICY IF EXISTS "ad_banners_select_combined" ON public.ad_banners;

CREATE POLICY "ad_banners_select_combined" ON public.ad_banners
    FOR SELECT
    USING (
        (is_active = true) 
        OR 
        (public.is_user_admin((select auth.uid())))
    );

-- Optimize other admin policies to use (select auth.uid())
DROP POLICY IF EXISTS "ad_banners_insert_admin" ON public.ad_banners;
CREATE POLICY "ad_banners_insert_admin" ON public.ad_banners
    FOR INSERT
    WITH CHECK (public.is_user_admin((select auth.uid())));

DROP POLICY IF EXISTS "ad_banners_update_admin" ON public.ad_banners;
CREATE POLICY "ad_banners_update_admin" ON public.ad_banners
    FOR UPDATE
    USING (public.is_user_admin((select auth.uid())));

DROP POLICY IF EXISTS "ad_banners_delete_admin" ON public.ad_banners;
CREATE POLICY "ad_banners_delete_admin" ON public.ad_banners
    FOR DELETE
    USING (public.is_user_admin((select auth.uid())));


-- Performance Advisor: Add missing indexes on foreign keys
CREATE INDEX IF NOT EXISTS idx_ad_banners_created_by ON public.ad_banners(created_by);
CREATE INDEX IF NOT EXISTS idx_search_logs_user_id ON public.search_logs(user_id);

-- Check 2: Add more missing indexes for FKs
CREATE INDEX IF NOT EXISTS idx_announcements_admin_id ON public.announcements(admin_id);
CREATE INDEX IF NOT EXISTS idx_restaurant_submission_items_target_restaurant ON public.restaurant_submission_items(target_restaurant_id);
CREATE INDEX IF NOT EXISTS idx_restaurant_submissions_resolved_by ON public.restaurant_submissions(resolved_by_admin_id);
CREATE INDEX IF NOT EXISTS idx_restaurants_created_by_user ON public.restaurants(created_by);
CREATE INDEX IF NOT EXISTS idx_restaurants_updated_by_admin ON public.restaurants(updated_by_admin_id);
CREATE INDEX IF NOT EXISTS idx_review_likes_user_id_v2 ON public.review_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_edited_by_admin ON public.reviews(edited_by_admin_id);
CREATE INDEX IF NOT EXISTS idx_server_costs_updated_by_user ON public.server_costs(updated_by);
CREATE INDEX IF NOT EXISTS idx_user_bookmarks_restaurant_id_v2 ON public.user_bookmarks(restaurant_id);



-- Performance Advisor: Remove unused indexes
-- Note: Recreating FK indexes above, so irrelevant drops removed.
DROP INDEX IF EXISTS public.idx_ad_banners_display_target;
DROP INDEX IF EXISTS public.idx_search_logs_searched_at;
