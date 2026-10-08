-- Verification images are private; food photos retain their public contract.
-- Historical verification objects must be moved with the Storage API, followed
-- by metadata and public-denial readback. This DDL does not claim that transfer.
BEGIN;
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('review-verifications', 'review-verifications', false, 5242880,
  ARRAY['image/jpeg','image/png','image/webp','image/avif']::text[])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY review_verifications_owner_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'review-verifications' AND
    ((storage.foldername(name))[1] = (SELECT auth.uid()::text)
      OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role)));
CREATE POLICY review_verifications_owner_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'review-verifications' AND
    (storage.foldername(name))[1] = (SELECT auth.uid()::text)
    AND split_part(name, '/', 4) = 'verification');
CREATE POLICY review_verifications_owner_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'review-verifications' AND
    (storage.foldername(name))[1] = (SELECT auth.uid()::text));
CREATE POLICY review_verifications_safe_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (bucket_id <> 'review-verifications' OR public.review_media_delete_allowed(name));

-- Old browser composers must fail before publishing a verification image into
-- the public bucket. Public food uploads keep the current policy unchanged.
CREATE POLICY review_photos_food_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id <> 'review-photos' OR (split_part(name, '/', 4) = 'food'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)));
CREATE POLICY review_photos_food_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (bucket_id <> 'review-photos' OR (split_part(name, '/', 4) = 'food'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)))
  WITH CHECK (bucket_id <> 'review-photos' OR (split_part(name, '/', 4) = 'food'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)));

CREATE OR REPLACE FUNCTION public.finish_review_media_cleanup()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  UPDATE review_media_private.cleanup c SET complete = true
    WHERE c.owner_id = auth.uid() AND c.retired AND NOT c.complete
      AND NOT EXISTS (SELECT 1 FROM storage.objects o
        WHERE o.bucket_id = CASE c.purpose WHEN 'verification' THEN 'review-verifications' ELSE 'review-photos' END
          AND o.name = c.path)
      AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'review-photos' AND o.name = c.path);
  RETURN (SELECT count(*) FROM review_media_private.cleanup c WHERE c.owner_id = auth.uid() AND NOT c.complete);
END $$;
REVOKE ALL ON FUNCTION public.finish_review_media_cleanup() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finish_review_media_cleanup() TO authenticated;
COMMIT;
