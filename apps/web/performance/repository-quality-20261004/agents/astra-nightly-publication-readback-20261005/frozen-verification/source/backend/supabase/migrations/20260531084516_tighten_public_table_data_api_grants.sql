-- Tighten table-level Data API grants for public-schema tables.
-- RLS policies remain the row-level authority. These grants make object-level
-- exposure match the app's intended public/authenticated access instead of the
-- earlier broad ALL-privileges grants to anon/authenticated.

-- Public read surfaces: keep anonymous SELECT only where the product intentionally
-- renders public content. Authenticated users keep only the mutations used by RLS.
REVOKE ALL ON public.ad_banners FROM anon, authenticated;
GRANT SELECT ON public.ad_banners TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.ad_banners TO authenticated;

REVOKE ALL ON public.announcements FROM anon, authenticated;
GRANT SELECT ON public.announcements TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.announcements TO authenticated;

REVOKE ALL ON public.profiles FROM anon, authenticated;
GRANT SELECT ON public.profiles TO anon, authenticated;
GRANT INSERT, UPDATE ON public.profiles TO authenticated;

REVOKE ALL ON public.restaurant_popular_rank_snapshots FROM anon, authenticated;
GRANT SELECT ON public.restaurant_popular_rank_snapshots TO anon, authenticated;

REVOKE ALL ON public.restaurants FROM anon, authenticated;
GRANT SELECT ON public.restaurants TO anon, authenticated;
GRANT UPDATE ON public.restaurants TO authenticated;

REVOKE ALL ON public.reviews FROM anon, authenticated;
GRANT SELECT ON public.reviews TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.reviews TO authenticated;

REVOKE ALL ON public.review_likes FROM anon, authenticated;
GRANT SELECT ON public.review_likes TO anon, authenticated;
GRANT INSERT, DELETE ON public.review_likes TO authenticated;

REVOKE ALL ON public.short_urls FROM anon, authenticated;
GRANT SELECT ON public.short_urls TO anon, authenticated;

REVOKE ALL ON public.transcript_embeddings_bge FROM anon, authenticated;
GRANT SELECT ON public.transcript_embeddings_bge TO anon, authenticated;

REVOKE ALL ON public.user_bookmarks FROM anon, authenticated;
GRANT SELECT ON public.user_bookmarks TO anon, authenticated;
GRANT INSERT, DELETE ON public.user_bookmarks TO authenticated;

REVOKE ALL ON public.user_stats FROM anon, authenticated;
GRANT SELECT ON public.user_stats TO anon, authenticated;

REVOKE ALL ON public.video_frame_captions FROM anon, authenticated;
GRANT SELECT ON public.video_frame_captions TO anon, authenticated;

REVOKE ALL ON public.videos FROM anon, authenticated;
GRANT SELECT ON public.videos TO anon, authenticated;

-- Authenticated/user-owned or admin-only workflows: remove anonymous access.
REVOKE ALL ON public.notifications FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;

REVOKE ALL ON public.ocr_logs FROM anon, authenticated;
GRANT SELECT, INSERT ON public.ocr_logs TO authenticated;

REVOKE ALL ON public.restaurant_requests FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.restaurant_requests TO authenticated;

REVOKE ALL ON public.restaurant_submissions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_submissions TO authenticated;

REVOKE ALL ON public.restaurant_submission_items FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_submission_items TO authenticated;

REVOKE ALL ON public.search_logs FROM anon, authenticated;
GRANT INSERT ON public.search_logs TO anon, authenticated;
GRANT SELECT ON public.search_logs TO authenticated;

REVOKE ALL ON public.admin_workflow_runs FROM anon, authenticated;
GRANT SELECT ON public.admin_workflow_runs TO authenticated;

REVOKE ALL ON public.admin_workflow_signals FROM anon, authenticated;
GRANT SELECT ON public.admin_workflow_signals TO authenticated;

REVOKE ALL ON public.admin_workflow_steps FROM anon, authenticated;
GRANT SELECT ON public.admin_workflow_steps TO authenticated;

-- Private implementation tables: service-role/RPC access only. No browser grants.
REVOKE ALL ON public.document_embeddings FROM anon, authenticated;
REVOKE ALL ON public.restaurants_duplicate FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
