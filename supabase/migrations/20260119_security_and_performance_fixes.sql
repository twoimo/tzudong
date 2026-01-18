-- ============================================================
-- Supabase Database Linter Fixes (Security & Performance)
-- Date: 2026-01-19
-- Description: Resolves permissive RLS policies, duplicate policies,
--              auth initialization performance issues, and unused indexes.
-- ============================================================

-- ============================================================
-- PART 1: Fix Auth RLS Initialization Plan (Performance)
-- Table: ocr_logs
-- Issue: auth.uid() called for every row.
-- Fix: Wrap in (select auth.uid()).
-- Also fixes duplicate policies (casing mismatch).
-- ============================================================

-- Drop potentially conflicting policies
DROP POLICY IF EXISTS "Users can view their own OCR logs" ON public.ocr_logs;
DROP POLICY IF EXISTS "Users can view their own ocr logs" ON public.ocr_logs;
DROP POLICY IF EXISTS "Users can insert their own ocr logs" ON public.ocr_logs;

-- Recreate optimized policies
CREATE POLICY "Users can view their own ocr logs"
ON public.ocr_logs FOR SELECT
TO authenticated
USING ( (select auth.uid()) = user_id );

CREATE POLICY "Users can insert their own ocr logs"
ON public.ocr_logs FOR INSERT
TO authenticated
WITH CHECK ( (select auth.uid()) = user_id );

-- ============================================================
-- PART 2: Fix Multiple Permissive Policies (Performance/Security)
-- Table: restaurant_youtuber
-- Issue: Overlapping policies for SELECT (Admins vs Anyone).
-- Fix: Restrict Admin policy to write operations only, let "Anyone" handle SELECT.
-- ============================================================

-- Drop the broad Admin policy
DROP POLICY IF EXISTS "Admins can manage restaurant youtuber relations" ON public.restaurant_youtuber;

-- Recreate Admin policies only for write operations
CREATE POLICY "Admins can insert restaurant_youtuber"
ON public.restaurant_youtuber FOR INSERT
TO authenticated
WITH CHECK ( public.is_user_admin((select auth.uid())) );

CREATE POLICY "Admins can update restaurant_youtuber"
ON public.restaurant_youtuber FOR UPDATE
TO authenticated
USING ( public.is_user_admin((select auth.uid())) );

CREATE POLICY "Admins can delete restaurant_youtuber"
ON public.restaurant_youtuber FOR DELETE
TO authenticated
USING ( public.is_user_admin((select auth.uid())) );

-- Note: "Anyone can view restaurant youtuber relations" (SELECT) should already exist
-- and is sufficient for Admins read access as well.

-- ============================================================
-- PART 3: Fix RLS Policy Always True & Duplicates
-- Table: search_logs
-- Issue: Unrestricted access warning and duplicate policies.
-- Fix: Remove duplicate "Authenticated" policy. "Anyone" policy with true is accepted for anonymous logging.
-- ============================================================

DROP POLICY IF EXISTS "Authenticated users can insert search logs" ON public.search_logs;

-- "Anyone can insert search logs" (WITH CHECK (true)) is kept as intended for public logging.

-- ============================================================
-- PART 4: Drop Unused Indexes (Performance)
-- Issue: Indexes detected as unused by Supabase linter.
-- ============================================================

DROP INDEX IF EXISTS public.idx_ad_banners_created_by;
DROP INDEX IF EXISTS public.idx_restaurant_submission_items_target_restaurant;
DROP INDEX IF EXISTS public.idx_restaurant_submissions_resolved_by;
DROP INDEX IF EXISTS public.idx_review_likes_user_id_v2;
DROP INDEX IF EXISTS public.idx_server_costs_updated_by_user;
DROP INDEX IF EXISTS public.idx_user_bookmarks_restaurant_id_v2;
DROP INDEX IF EXISTS public.idx_restaurant_youtuber_unique_id;
DROP INDEX IF EXISTS public.idx_restaurant_youtuber_youtube_link;
DROP INDEX IF EXISTS public.idx_restaurant_youtuber_name;
DROP INDEX IF EXISTS public.idx_restaurant_youtuber_eval;
DROP INDEX IF EXISTS public.idx_ocr_logs_hash;

-- ============================================================
-- PART 5: Notification
-- ============================================================

DO $$
BEGIN
    RAISE NOTICE '✅ Security and Performance fixes applied.';
    RAISE NOTICE '   - Optimized RLS policies for ocr_logs (Auth Init Plan).';
    RAISE NOTICE '   - Resolved conflicting policies for restaurant_youtuber and search_logs.';
    RAISE NOTICE '   - Dropped 11 unused indexes.';
    RAISE NOTICE '   ';
    RAISE NOTICE '⚠️  MANUAL ACTION REQUIRED:';
    RAISE NOTICE '   Please enable "Leaked Password Protection" in Supabase Dashboard';
    RAISE NOTICE '   (Authentication -> Providers -> Email -> Password Security).';
END $$;
