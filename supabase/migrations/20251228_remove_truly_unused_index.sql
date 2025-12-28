-- Remove only truly unused index that is not a foreign key
-- idx_user_bookmarks_created_at was identified as unused and is not covering any foreign key

DROP INDEX IF EXISTS idx_user_bookmarks_created_at;

-- 완료 메시지
DO $$
BEGIN
    RAISE NOTICE '✅ 미사용 인덱스 1개 제거 완료';
    RAISE NOTICE '   - idx_user_bookmarks_created_at (Foreign Key 아님)';
END $$;
