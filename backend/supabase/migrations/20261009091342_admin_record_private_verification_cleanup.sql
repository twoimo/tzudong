-- Keep guarded admin deletion aligned with the private verification bucket.
-- Storage metadata is read here only for CAS/fencing; object deletion remains
-- an explicit service-role Storage API operation after the database commit.
BEGIN;

ALTER TABLE pipeline_control.admin_record_media_cleanup
  DROP CONSTRAINT admin_record_media_cleanup_bucket_check;
ALTER TABLE pipeline_control.admin_record_media_cleanup
  ADD CONSTRAINT admin_record_media_cleanup_bucket_check
  CHECK (bucket IN ('review-photos', 'review-verifications'));

CREATE FUNCTION pipeline_control.admin_record_storage_snapshot(p_bucket text, p_path text)
RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT pipeline_control.admin_record_hash(to_jsonb(o) - 'last_accessed_at')
  FROM storage.objects o
  WHERE p_bucket IN ('review-photos', 'review-verifications')
    AND o.bucket_id = p_bucket AND o.name = p_path
$$;

-- A review stores only object keys. Food has one public job. Every verification
-- key has both a private and a legacy-public job, even when either metadata row
-- is absent, so the Storage API consumer must read back both bucket boundaries.
CREATE FUNCTION pipeline_control.admin_record_review_media(row_value jsonb)
RETURNS TABLE(bucket text, object_name text)
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH food AS (
    SELECT 'review-photos'::text AS bucket, item.value AS object_name
    FROM jsonb_array_elements_text(
      coalesce(nullif(row_value->'food_photos', 'null'::jsonb), '[]'::jsonb)
    ) item(value)
    WHERE nullif(item.value, '') IS NOT NULL
  ), verification AS (
    SELECT candidate.bucket, nullif(row_value->>'verification_photo', '') AS object_name
    FROM (VALUES ('review-verifications'::text), ('review-photos'::text)) candidate(bucket)
    WHERE nullif(row_value->>'verification_photo', '') IS NOT NULL
  )
  SELECT DISTINCT media.bucket, media.object_name
  FROM (
    SELECT * FROM food
    UNION ALL SELECT * FROM verification
  ) media
  ORDER BY media.bucket, media.object_name
$$;

CREATE OR REPLACE FUNCTION pipeline_control.admin_record_reference_fence()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE media record;
BEGIN
  -- New references serialize with the exact bucket/object retirement claim.
  FOR media IN SELECT * FROM pipeline_control.admin_record_review_media(to_jsonb(NEW)) LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'review-media:' || media.bucket || ':' || media.object_name, 0));
    IF EXISTS (
      SELECT 1 FROM pipeline_control.admin_record_media_cleanup cleanup
      WHERE cleanup.bucket = media.bucket AND cleanup.object_name = media.object_name
        AND cleanup.state IN ('pending', 'inflight', 'uncertain', 'done')
    ) THEN
      RAISE EXCEPTION 'RECORD_ACTION_MEDIA_RETIRED';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION pipeline_control.admin_record_object_fence()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE media record;
BEGIN
  -- A read-access timestamp update does not replace object content.
  IF TG_OP = 'UPDATE'
    AND (to_jsonb(NEW) - 'last_accessed_at') = (to_jsonb(OLD) - 'last_accessed_at') THEN
    RETURN NEW;
  END IF;
  FOR media IN
    SELECT DISTINCT candidate.bucket, candidate.object_name
    FROM (VALUES
      (CASE WHEN TG_OP = 'UPDATE' THEN OLD.bucket_id END,
       CASE WHEN TG_OP = 'UPDATE' THEN OLD.name END),
      (NEW.bucket_id, NEW.name)
    ) candidate(bucket, object_name)
    WHERE candidate.bucket IN ('review-photos', 'review-verifications')
      AND candidate.object_name IS NOT NULL
    ORDER BY candidate.bucket, candidate.object_name
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'review-media:' || media.bucket || ':' || media.object_name, 0));
    IF EXISTS (
      SELECT 1 FROM pipeline_control.admin_record_media_cleanup cleanup
      WHERE cleanup.bucket = media.bucket AND cleanup.object_name = media.object_name
        AND cleanup.state IN ('pending', 'inflight', 'uncertain', 'done')
    ) THEN
      -- Storage v1.33.0 TUS DELETE performs a rollback-only version='1'
      -- permission probe. The deferred trigger still rejects any commit.
      IF TG_WHEN = 'BEFORE' AND NEW.version = '1'
        AND current_setting('request.method', true) = 'DELETE'
        AND current_setting('storage.operation', true) = 'storage.tus.upload.delete'
        AND current_setting('request.path', true) ~ '^/upload/resumable/[A-Za-z0-9_-]+$'
      THEN CONTINUE; END IF;
      RAISE EXCEPTION 'RECORD_ACTION_MEDIA_RETIRED';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

-- Patch only the two installed callers whose source is fixed by the immutable
-- predecessor. Abort atomically on any unreviewed source or anchor drift.
DO $admin_private_cleanup$
DECLARE
  target regprocedure; definition text; source text; patched text; metadata jsonb;
  argument_defaults text; old_text text; new_text text; occurrences integer;
BEGIN
  target := 'pipeline_control.admin_record_snapshot(text,uuid[])'::regprocedure;
  SELECT pg_get_functiondef(p.oid), p.prosrc,
         to_jsonb(p) - ARRAY['prosrc', 'proargdefaults'],
         pg_get_expr(p.proargdefaults, 0)
    INTO definition, source, metadata, argument_defaults
    FROM pg_proc p WHERE p.oid = target;
  IF encode(sha256(convert_to(source, 'UTF8')), 'hex') <>
      'ad8d49c2b067bd2d507ac9b2773bf852a8bdd1cc44d864d55a23cc0a4e2296a3' THEN
    RAISE EXCEPTION 'ADMIN_PRIVATE_CLEANUP_SNAPSHOT_SOURCE_DRIFT';
  END IF;
  old_text := $old$
    (SELECT jsonb_object_agg(path,pipeline_control.admin_record_storage_snapshot(path)) FROM
     (SELECT DISTINCT x path FROM jsonb_array_elements_text(coalesce(nullif(row_value->'food_photos','null'::jsonb),'[]'::jsonb)||jsonb_build_array(row_value->>'verification_photo')) x WHERE x IS NOT NULL) media)$old$;
  new_text := $new$
    (SELECT jsonb_object_agg(bucket||':'||object_name,
      pipeline_control.admin_record_storage_snapshot(bucket,object_name))
     FROM pipeline_control.admin_record_review_media(row_value))$new$;
  occurrences := (length(source) - length(replace(source, old_text, ''))) / length(old_text);
  IF occurrences <> 1 THEN RAISE EXCEPTION 'ADMIN_PRIVATE_CLEANUP_SNAPSHOT_ANCHOR_DRIFT'; END IF;
  patched := replace(source, old_text, new_text);
  EXECUTE replace(definition, source, patched);
  IF (SELECT to_jsonb(p) - ARRAY['prosrc', 'proargdefaults']
        FROM pg_proc p WHERE p.oid = target) IS DISTINCT FROM metadata
    OR (SELECT pg_get_expr(p.proargdefaults, 0)
        FROM pg_proc p WHERE p.oid = target) IS DISTINCT FROM argument_defaults
    OR (SELECT p.prosrc FROM pg_proc p WHERE p.oid = target) IS DISTINCT FROM patched THEN
    RAISE EXCEPTION 'ADMIN_PRIVATE_CLEANUP_SNAPSHOT_METADATA_DRIFT';
  END IF;

  target := 'public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)'::regprocedure;
  SELECT pg_get_functiondef(p.oid), p.prosrc,
         to_jsonb(p) - ARRAY['prosrc', 'proargdefaults'],
         pg_get_expr(p.proargdefaults, 0)
    INTO definition, source, metadata, argument_defaults
    FROM pg_proc p WHERE p.oid = target;
  IF encode(sha256(convert_to(source, 'UTF8')), 'hex') <>
      'a6e469b2b498e038d8cbbd30b96abd245a114137becd931ad9abf5432fd9492a' THEN
    RAISE EXCEPTION 'ADMIN_PRIVATE_CLEANUP_ACTION_SOURCE_DRIFT';
  END IF;

  old_text := ' classification text; conflict_constraint text; photo text; job pipeline_control.admin_record_media_cleanup;';
  new_text := ' classification text; conflict_constraint text; photo text; media record; job pipeline_control.admin_record_media_cleanup;';
  IF (length(source)-length(replace(source,old_text,'')))/length(old_text) <> 1 THEN
    RAISE EXCEPTION 'ADMIN_PRIVATE_CLEANUP_ACTION_DECLARE_DRIFT'; END IF;
  patched := replace(source, old_text, new_text);

  old_text := 'PERFORM pg_advisory_xact_lock(hashtextextended(''review-photo:''||job.object_name,0));';
  new_text := 'PERFORM pg_advisory_xact_lock(hashtextextended(''review-media:''||job.bucket||'':''||job.object_name,0));';
  IF (length(patched)-length(replace(patched,old_text,'')))/length(old_text) <> 2 THEN
    RAISE EXCEPTION 'ADMIN_PRIVATE_CLEANUP_ACTION_JOB_LOCK_DRIFT'; END IF;
  patched := replace(patched, old_text, new_text);

  old_text := 'pipeline_control.admin_record_storage_snapshot(job.object_name)';
  new_text := 'pipeline_control.admin_record_storage_snapshot(job.bucket,job.object_name)';
  IF (length(patched)-length(replace(patched,old_text,'')))/length(old_text) <> 2 THEN
    RAISE EXCEPTION 'ADMIN_PRIVATE_CLEANUP_ACTION_JOB_SNAPSHOT_DRIFT'; END IF;
  patched := replace(patched, old_text, new_text);

  old_text := $old$FOR photo IN SELECT DISTINCT x FROM public.reviews r CROSS JOIN LATERAL unnest(coalesce(r.food_photos,'{}'::text[])||ARRAY[r.verification_photo]) x WHERE r.id=ids[1] AND x IS NOT NULL ORDER BY x LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('review-photo:'||photo,0));
  END LOOP$old$;
  new_text := $new$FOR media IN SELECT candidate.bucket,candidate.object_name FROM public.reviews r
   CROSS JOIN LATERAL pipeline_control.admin_record_review_media(to_jsonb(r)) candidate
   WHERE r.id=ids[1] ORDER BY candidate.bucket,candidate.object_name LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('review-media:'||media.bucket||':'||media.object_name,0));
  END LOOP$new$;
  IF (length(patched)-length(replace(patched,old_text,'')))/length(old_text) <> 1 THEN
    RAISE EXCEPTION 'ADMIN_PRIVATE_CLEANUP_ACTION_PRELOCK_DRIFT'; END IF;
  patched := replace(patched, old_text, new_text);

  old_text := $old$FOR photo IN SELECT value FROM jsonb_array_elements_text(coalesce(row_value->'food_photos','[]'::jsonb)||jsonb_build_array(row_value->>'verification_photo')) LOOP
    IF coalesce(photo,'')<>'' THEN$old$;
  new_text := $new$FOR media IN SELECT * FROM pipeline_control.admin_record_review_media(row_value) LOOP
    photo:=media.object_name;
    IF coalesce(photo,'')<>'' THEN$new$;
  IF (length(patched)-length(replace(patched,old_text,'')))/length(old_text) <> 1 THEN
    RAISE EXCEPTION 'ADMIN_PRIVATE_CLEANUP_ACTION_PREPARE_LOOP_DRIFT'; END IF;
  patched := replace(patched, old_text, new_text);

  old_text := $old$PERFORM pg_advisory_xact_lock(hashtextextended('review-photo:'||photo,0));
     INSERT INTO pipeline_control.admin_record_media_cleanup(operation_id,bucket,object_name,object_fingerprint)
      VALUES(op.id,'review-photos',photo,pipeline_control.admin_record_storage_snapshot(photo)) ON CONFLICT DO NOTHING;$old$;
  new_text := $new$PERFORM pg_advisory_xact_lock(hashtextextended('review-media:'||media.bucket||':'||photo,0));
     INSERT INTO pipeline_control.admin_record_media_cleanup(operation_id,bucket,object_name,object_fingerprint)
      VALUES(op.id,media.bucket,photo,pipeline_control.admin_record_storage_snapshot(media.bucket,photo)) ON CONFLICT DO NOTHING;$new$;
  IF (length(patched)-length(replace(patched,old_text,'')))/length(old_text) <> 1 THEN
    RAISE EXCEPTION 'ADMIN_PRIVATE_CLEANUP_ACTION_PREPARE_INSERT_DRIFT'; END IF;
  patched := replace(patched, old_text, new_text);

  EXECUTE replace(definition, source, patched);
  IF (SELECT to_jsonb(p) - ARRAY['prosrc', 'proargdefaults']
        FROM pg_proc p WHERE p.oid = target) IS DISTINCT FROM metadata
    OR (SELECT pg_get_expr(p.proargdefaults, 0)
        FROM pg_proc p WHERE p.oid = target) IS DISTINCT FROM argument_defaults
    OR (SELECT p.prosrc FROM pg_proc p WHERE p.oid = target) IS DISTINCT FROM patched THEN
    RAISE EXCEPTION 'ADMIN_PRIVATE_CLEANUP_ACTION_METADATA_DRIFT';
  END IF;
END $admin_private_cleanup$;

REVOKE ALL ON FUNCTION
  pipeline_control.admin_record_storage_snapshot(text,text),
  pipeline_control.admin_record_review_media(jsonb)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  pipeline_control.admin_record_storage_snapshot(text,text),
  pipeline_control.admin_record_review_media(jsonb)
TO service_role;
REVOKE ALL ON FUNCTION
  pipeline_control.admin_record_reference_fence(),
  pipeline_control.admin_record_object_fence()
FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
