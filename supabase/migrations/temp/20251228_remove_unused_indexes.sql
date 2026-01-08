-- Revert unused index removal and add indexes for foreign keys
-- These indexes were incorrectly identified as "unused" but are needed for foreign key performance
-- https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys

-- announcements 테이블
CREATE INDEX IF NOT EXISTS idx_announcements_admin_id 
    ON public.announcements(admin_id);

-- restaurant_submissions 테이블  
CREATE INDEX IF NOT EXISTS idx_submissions_resolved_by_admin 
    ON public.restaurant_submissions(resolved_by_admin_id) 
    WHERE resolved_by_admin_id IS NOT NULL;

-- restaurants 테이블
CREATE INDEX IF NOT EXISTS idx_restaurants_created_by 
    ON public.restaurants(created_by) 
    WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_restaurants_updated_by_admin 
    ON public.restaurants(updated_by_admin_id) 
    WHERE updated_by_admin_id IS NOT NULL;

-- server_costs 테이블
CREATE INDEX IF NOT EXISTS idx_server_costs_updated_by 
    ON public.server_costs(updated_by) 
    WHERE updated_by IS NOT NULL;

-- restaurant_submission_items 테이블
CREATE INDEX IF NOT EXISTS idx_submission_items_target_restaurant_id 
    ON public.restaurant_submission_items(target_restaurant_id) 
    WHERE target_restaurant_id IS NOT NULL;

-- reviews 테이블
CREATE INDEX IF NOT EXISTS idx_reviews_edited_by_admin_id 
    ON public.reviews(edited_by_admin_id) 
    WHERE edited_by_admin_id IS NOT NULL;

-- review_likes 테이블
CREATE INDEX IF NOT EXISTS idx_review_likes_user_id 
    ON public.review_likes(user_id);

-- user_bookmarks 테이블
CREATE INDEX IF NOT EXISTS idx_user_bookmarks_restaurant_id 
    ON public.user_bookmarks(restaurant_id);

-- 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '✅ Foreign Key 인덱스 9개 생성 완료';
    RAISE NOTICE '   - idx_announcements_admin_id';
    RAISE NOTICE '   - idx_submissions_resolved_by_admin';
    RAISE NOTICE '   - idx_restaurants_created_by';
    RAISE NOTICE '   - idx_restaurants_updated_by_admin';
    RAISE NOTICE '   - idx_server_costs_updated_by';
    RAISE NOTICE '   - idx_submission_items_target_restaurant_id';
    RAISE NOTICE '   - idx_reviews_edited_by_admin_id';
    RAISE NOTICE '   - idx_review_likes_user_id';
    RAISE NOTICE '   - idx_user_bookmarks_restaurant_id';
    RAISE NOTICE '';
    RAISE NOTICE '⚠️ idx_user_bookmarks_created_at는 제외 (Foreign Key 아님)';
END $$;
