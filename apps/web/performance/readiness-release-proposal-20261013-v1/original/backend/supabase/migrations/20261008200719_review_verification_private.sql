-- Verification images are private; food photos retain their public contract.
-- Historical verification objects must be moved with the Storage API, followed
-- by metadata and public-denial readback. This DDL does not claim that transfer.
BEGIN;
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('review-verifications', 'review-verifications', false, 5242880,
  ARRAY['image/jpeg','image/png','image/webp','image/avif']::text[])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Serialize Storage writes with review references and retirement. A private
-- object must not shadow a referenced public receipt, and a completed tombstone
-- must continue to deny delayed uploads. Storage upsert/update uses both checks.
CREATE FUNCTION public.review_media_upload_allowed(p_bucket text, p_path text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid := auth.uid(); review_id uuid; purpose text;
BEGIN
  IF u IS NULL OR current_setting('transaction_isolation') <> 'read committed'
    OR p_bucket IS NULL OR p_bucket NOT IN ('review-photos','review-verifications')
    OR p_path IS NULL OR octet_length(p_path) > 512 THEN RETURN false; END IF;
  BEGIN review_id := split_part(p_path, '/', 3)::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RETURN false; END;
  purpose := CASE p_bucket WHEN 'review-photos' THEN 'food' ELSE 'verification' END;
  IF NOT review_media_private.canonical(p_path, u, review_id, purpose) THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(741093, 1);
  RETURN NOT EXISTS (SELECT 1 FROM review_media_private.cleanup c WHERE c.path = p_path AND c.retired)
    AND NOT review_media_private.referenced(p_path);
END $$;
REVOKE ALL ON FUNCTION public.review_media_upload_allowed(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_media_upload_allowed(text,text) TO authenticated;
CREATE POLICY review_media_safe_insert ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (bucket_id NOT IN ('review-photos','review-verifications') OR public.review_media_upload_allowed(bucket_id,name));
CREATE POLICY review_media_safe_update ON storage.objects AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (bucket_id NOT IN ('review-photos','review-verifications') OR public.review_media_upload_allowed(bucket_id,name))
  WITH CHECK (bucket_id NOT IN ('review-photos','review-verifications') OR public.review_media_upload_allowed(bucket_id,name));

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
