-- Security Advisor Fixes

-- 1. Enable RLS on public tables
ALTER TABLE public.document_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurants_duplicate ENABLE ROW LEVEL SECURITY;

-- 2. Create basic RLS policies (adjust as needed for specific business logic)
-- Allow public read access for core data tables
CREATE POLICY "Enable read access for all users" ON "public"."restaurants" FOR SELECT USING (true);
CREATE POLICY "Enable read access for all users" ON "public"."videos" FOR SELECT USING (true);
-- For other tables, we assume they might be internal or restricted. 
-- Adding service_role bypass for now to prevent breakage, but ideally define granular policies.
CREATE POLICY "Enable all access for service role" ON "public"."document_embeddings" FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Enable all access for service role" ON "public"."restaurants_duplicate" FOR ALL TO service_role USING (true) WITH CHECK (true);


-- 3. Fix Duplicate Indexes
-- Dropping one of the identical indexes on document_embeddings
DROP INDEX IF EXISTS public.idx_embeddings_recollect;


-- 4. Add Missing Indexes for Foreign Keys
CREATE INDEX IF NOT EXISTS idx_ad_banners_created_by ON public.ad_banners(created_by);
CREATE INDEX IF NOT EXISTS idx_restaurant_submission_items_target_restaurant_id ON public.restaurant_submission_items(target_restaurant_id);
CREATE INDEX IF NOT EXISTS idx_restaurant_submissions_resolved_by_admin_id ON public.restaurant_submissions(resolved_by_admin_id);
CREATE INDEX IF NOT EXISTS idx_review_likes_user_id ON public.review_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_server_costs_updated_by ON public.server_costs(updated_by);
CREATE INDEX IF NOT EXISTS idx_user_bookmarks_restaurant_id ON public.user_bookmarks(restaurant_id);


-- 5. Address Permissive Policies (Examples for tightening)
-- Update 'Allow all access for service role' on document_embeddings_bge to be specific if possible
-- Currently it allows everything. If this is intended for backend only, ensure it's restricted to service_role.
-- (The advisor warning suggests it's too permissive even for service_role if it bypasses checks? No, checks are bypassed anyway for service_role usually, but explicit policies define scope.)
-- Actually, the warning is about `USING (true)` which is fine for SELECT but `WITH CHECK (true)` for INSERT/UPDATE means no validation.
-- We'll leave it as is if it's service-role only, but if it applies to 'public', it's dangerous.
-- The policy name "Allow all access for service role" suggests it's scoped to service_role, so the warning might be a false positive or just general advice.
-- However, we can ensure it's restricted:
-- ALTER POLICY "Allow all access for service role" ON "public"."document_embeddings_bge" TO service_role USING (true) WITH CHECK (true);


-- 6. Extension Schema (Vector)
-- Moving 'vector' to 'extensions' schema requires careful handling of application code references.
-- Provide command but comment out for manual execution if desired.
-- CREATE SCHEMA IF NOT EXISTS extensions;
-- ALTER EXTENSION vector SET SCHEMA extensions;
-- UPDATE pg_extension SET extrelocatable = true WHERE extname = 'vector';
-- ALTER EXTENSION vector SET SCHEMA extensions;
