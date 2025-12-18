-- ========================================
-- 추가 FK 인덱스 생성
-- 작성일: 2025년 12월 19일
-- ========================================

-- restaurant_submission_items
CREATE INDEX IF NOT EXISTS idx_submission_items_target_restaurant_id 
    ON public.restaurant_submission_items(target_restaurant_id) 
    WHERE target_restaurant_id IS NOT NULL;

-- reviews
CREATE INDEX IF NOT EXISTS idx_reviews_restaurant_id 
    ON public.reviews(restaurant_id);

CREATE INDEX IF NOT EXISTS idx_reviews_user_id 
    ON public.reviews(user_id);

CREATE INDEX IF NOT EXISTS idx_reviews_edited_by_admin_id 
    ON public.reviews(edited_by_admin_id) 
    WHERE edited_by_admin_id IS NOT NULL;

-- review_likes
CREATE INDEX IF NOT EXISTS idx_review_likes_user_id 
    ON public.review_likes(user_id);

DO $$
BEGIN
    RAISE NOTICE '✅ 추가 FK 인덱스 생성 완료 (5개)';
END $$;
