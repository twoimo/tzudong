-- Optimize RLS policies for user_bookmarks table
-- Replace auth.uid() with (select auth.uid()) to prevent re-evaluation for each row
-- https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view their own bookmarks" ON public.user_bookmarks;
DROP POLICY IF EXISTS "Users can create their own bookmarks" ON public.user_bookmarks;
DROP POLICY IF EXISTS "Users can delete their own bookmarks" ON public.user_bookmarks;

-- Recreate policies with optimized auth.uid() calls
CREATE POLICY "Users can view their own bookmarks"
ON public.user_bookmarks FOR SELECT
USING ((select auth.uid()) = user_id);

CREATE POLICY "Users can create their own bookmarks"
ON public.user_bookmarks FOR INSERT
WITH CHECK ((select auth.uid()) = user_id);

CREATE POLICY "Users can delete their own bookmarks"
ON public.user_bookmarks FOR DELETE
USING ((select auth.uid()) = user_id);
