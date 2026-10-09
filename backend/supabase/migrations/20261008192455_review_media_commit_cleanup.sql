-- Atomic review commit receipts and durable, owner-scoped media cleanup.
-- No scheduler is installed. The authenticated MY/review UI drains this queue.
-- Tombstones must survive successful cleanup: a delayed write must not revive a
-- deleted key. No retention period is introduced here.
BEGIN;
CREATE SCHEMA IF NOT EXISTS review_media_private;
REVOKE ALL ON SCHEMA review_media_private FROM PUBLIC, anon, authenticated;
CREATE TABLE review_media_private.commits (
  operation_id uuid PRIMARY KEY, owner_id uuid NOT NULL, review_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('edit', 'delete')), request_hash text NOT NULL
);
CREATE TABLE review_media_private.cleanup (
  path text PRIMARY KEY, owner_id uuid NOT NULL, review_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('food', 'verification')),
  retired boolean NOT NULL DEFAULT false, complete boolean NOT NULL DEFAULT false
);
ALTER TABLE review_media_private.commits ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_media_private.cleanup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA review_media_private FROM PUBLIC, anon, authenticated;

CREATE FUNCTION review_media_private.canonical(p_path text, p_owner uuid, p_review uuid, p_purpose text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT COALESCE(p_purpose IN ('food','verification') AND
    p_path LIKE p_owner::text || '/reviews/' || p_review::text || '/' || p_purpose || '/%' AND
    length(split_part(p_path, '/', 5)) <= 240 AND p_path ~* '^[A-Za-z0-9_-]+/reviews/[A-Za-z0-9_-]+/(food|verification)/[A-Za-z0-9][A-Za-z0-9._-]{0,239}\.(avif|jpe?g|png|webp)$', false)
$$;
-- Decode historical public/signed URL values for reference checks and for
-- cleanup only after the authoritative pre-image passes owner/purpose checks.
CREATE FUNCTION review_media_private.reference_key(p_value text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v text := p_value; b bytea := ''::bytea; i integer := 1;
BEGIN
  IF v LIKE '%/storage/v1/object/%/review-photos/%' THEN
    v := split_part(split_part(substring(v FROM '/review-photos/(.*)$'), '?', 1), '#', 1);
    WHILE i <= length(v) LOOP
      IF substring(v, i, 1) = '%' THEN
        b := b || decode(substring(v, i + 1, 2), 'hex'); i := i + 3;
      ELSE
        b := b || convert_to(substring(v, i, 1), 'UTF8'); i := i + 1;
      END IF;
    END LOOP;
    RETURN convert_from(b, 'UTF8');
  END IF;
  RETURN v;
EXCEPTION WHEN OTHERS THEN RETURN p_value;
END $$;
-- Historical composer keys are admitted only from the authoritative row
-- pre-image. Client uploads and compensation still require review-bound keys.
CREATE FUNCTION review_media_private.owned_legacy(p_path text, p_owner uuid, p_purpose text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT COALESCE(split_part(p_path, '/', 1) = p_owner::text AND
    CASE p_purpose
      WHEN 'food' THEN p_path ~ '^[0-9a-f-]{36}/[0-9]{10,16}_food_[0-9]{1,3}_[A-Za-z0-9][A-Za-z0-9._-]{0,200}\.(avif|jpe?g|png|webp)$'
      WHEN 'verification' THEN p_path ~ '^[0-9a-f-]{36}/[0-9]{10,16}_verification_[A-Za-z0-9][A-Za-z0-9._-]{0,200}\.(avif|jpe?g|png|webp)$'
      ELSE false END, false)
$$;
CREATE FUNCTION review_media_private.referenced(p_path text)
RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.reviews r,
    LATERAL unnest(COALESCE(r.food_photos, ARRAY[]::text[]) || ARRAY[r.verification_photo]) p
    WHERE review_media_private.reference_key(p) = p_path)
$$;
-- A transaction lock serializes media reference changes and retirement. It is
-- released BEFORE any Storage HTTP call; retired keys can never be reattached.
-- Metadata-only moderation/likes do not enter this lock.
CREATE FUNCTION review_media_private.lock_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING MESSAGE = 'REVIEW_RETRY_REQUIRED', ERRCODE = '40001';
  END IF;
  PERFORM pg_advisory_xact_lock(741093, 1);
  RETURN NULL;
END $$;
CREATE TRIGGER review_media_serialize BEFORE INSERT OR DELETE OR UPDATE OF food_photos, verification_photo, user_id, id
  ON public.reviews FOR EACH STATEMENT EXECUTE FUNCTION review_media_private.lock_changes();
CREATE FUNCTION review_media_private.guard_references()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p text; old_food text[] := ARRAY[]::text[]; old_verification text; purpose text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.user_id = OLD.user_id AND NEW.id = OLD.id THEN
    old_food := COALESCE(OLD.food_photos, ARRAY[]::text[]);
    old_verification := OLD.verification_photo;
  END IF;
  FOR p, purpose IN SELECT value, 'food' FROM unnest(COALESCE(NEW.food_photos, ARRAY[]::text[])) value
    UNION ALL SELECT NEW.verification_photo, 'verification' LOOP
    IF EXISTS (SELECT 1 FROM review_media_private.cleanup c
      WHERE c.path = review_media_private.reference_key(p) AND c.retired) THEN
      RAISE EXCEPTION USING MESSAGE = 'REVIEW_MEDIA_RETIRED', ERRCODE = '23514';
    END IF;
    -- Historical keys may remain unchanged in their original purpose only.
    IF NOT COALESCE(CASE WHEN purpose = 'food' THEN p = ANY(old_food) ELSE p = old_verification END, false) THEN
      IF NOT review_media_private.canonical(p, NEW.user_id, NEW.id, purpose) THEN
        RAISE EXCEPTION USING MESSAGE = 'REVIEW_MEDIA_INVALID', ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER review_media_reference_guard BEFORE INSERT OR UPDATE OF food_photos, verification_photo, user_id, id
  ON public.reviews FOR EACH ROW EXECUTE FUNCTION review_media_private.guard_references();

-- Every delete path (including legacy and guarded admin) captures OLD, not an
-- actor-supplied path list. The statement trigger already holds the media lock.
CREATE FUNCTION review_media_private.enqueue_removed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p text; purpose text; retained text[] := ARRAY[]::text[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    retained := COALESCE(NEW.food_photos, ARRAY[]::text[]) || ARRAY[NEW.verification_photo];
  END IF;
  FOR p, purpose IN SELECT review_media_private.reference_key(value), 'food'
      FROM unnest(COALESCE(OLD.food_photos, ARRAY[]::text[])) value
    UNION ALL SELECT review_media_private.reference_key(OLD.verification_photo), 'verification' LOOP
    IF (review_media_private.canonical(p, OLD.user_id, OLD.id, purpose)
        OR review_media_private.owned_legacy(p, OLD.user_id, purpose))
      AND NOT EXISTS (SELECT 1 FROM unnest(retained) value
        WHERE review_media_private.reference_key(value) = p) THEN
      INSERT INTO review_media_private.cleanup(path, owner_id, review_id, purpose, retired)
        VALUES (p, OLD.user_id, OLD.id, purpose, NOT review_media_private.referenced(p))
        ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER review_media_enqueue_removed AFTER DELETE OR UPDATE OF food_photos, verification_photo, user_id, id
  ON public.reviews FOR EACH ROW EXECUTE FUNCTION review_media_private.enqueue_removed();

-- Definer is required for the private receipt/queue and global reference check,
-- not to broaden review access. Owner authorization is checked before any row
-- mutation. Existing review triggers, cascades and RLS policies are unchanged.
CREATE FUNCTION public.mutate_review_with_media(
  p_operation_id uuid, p_review_id uuid, p_kind text, p_expected_updated_at timestamptz,
  p_content text DEFAULT NULL, p_categories text[] DEFAULT NULL, p_food_photos text[] DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid := auth.uid(); r public.reviews%ROWTYPE;
  receipt review_media_private.commits%ROWTYPE; h text; p text;
BEGIN
  IF u IS NULL THEN RETURN 'REVIEW_UNAUTHORIZED'; END IF;
  IF p_operation_id IS NULL OR p_review_id IS NULL OR p_kind IS NULL OR p_kind NOT IN ('edit','delete') THEN
    RETURN 'REVIEW_INVALID';
  END IF;
  -- Bound client-controlled work before hashing or acquiring the shared lock.
  -- These generous transport ceilings do not trim stored or submitted text.
  IF p_kind = 'delete' AND (p_content IS NOT NULL OR p_categories IS NOT NULL OR p_food_photos IS NOT NULL) THEN
    RETURN 'REVIEW_INVALID';
  END IF;
  IF p_kind = 'edit' THEN
    IF p_content IS NULL OR octet_length(p_content) > 262144 OR length(btrim(p_content)) < 20
      OR p_categories IS NULL OR cardinality(p_categories) NOT BETWEEN 1 AND 100
      OR p_food_photos IS NULL OR cardinality(p_food_photos) NOT BETWEEN 1 AND 10 THEN
      RETURN 'REVIEW_INVALID';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(p_categories) value WHERE value IS NULL OR length(value) NOT BETWEEN 1 AND 200)
      OR EXISTS (SELECT 1 FROM unnest(p_food_photos) value WHERE value IS NULL OR octet_length(value) > 8192) THEN
      RETURN 'REVIEW_INVALID';
    END IF;
  END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN RETURN 'REVIEW_RETRY_REQUIRED'; END IF;
  h := encode(sha256(convert_to(jsonb_build_array(p_review_id, p_kind, p_expected_updated_at,
    p_content, p_categories, p_food_photos)::text, 'UTF8')), 'hex');
  PERFORM pg_advisory_xact_lock(741093, 1);
  SELECT * INTO receipt FROM review_media_private.commits WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF receipt.owner_id = u AND receipt.review_id = p_review_id AND receipt.kind = p_kind AND receipt.request_hash = h THEN
      RETURN 'REVIEW_COMMITTED';
    END IF;
    RETURN 'REVIEW_CONFLICT';
  END IF;
  SELECT * INTO r FROM public.reviews WHERE id = p_review_id AND user_id = u FOR UPDATE;
  IF NOT FOUND THEN RETURN 'REVIEW_NOT_FOUND'; END IF;
  IF p_expected_updated_at IS NULL OR r.updated_at IS DISTINCT FROM p_expected_updated_at THEN RETURN 'REVIEW_CONFLICT'; END IF;
  IF p_kind = 'edit' THEN
    IF p_content IS NULL OR length(btrim(p_content)) < 20 OR p_categories IS NULL OR cardinality(p_categories) = 0
      OR p_food_photos IS NULL OR cardinality(p_food_photos) NOT BETWEEN 1 AND 10 THEN RETURN 'REVIEW_INVALID'; END IF;
    FOREACH p IN ARRAY p_food_photos LOOP
      -- The submitted list is the complete desired state. Historical display
      -- values can only be kept verbatim from this row or omitted, never added.
      IF p = ANY(COALESCE(r.food_photos, ARRAY[]::text[]))
        AND NOT review_media_private.canonical(p, u, r.id, 'food')
        AND NOT review_media_private.owned_legacy(p, u, 'food') THEN CONTINUE; END IF;
      IF NOT review_media_private.canonical(p, u, r.id, 'food')
        AND NOT (review_media_private.owned_legacy(p, u, 'food') AND p = ANY(COALESCE(r.food_photos, ARRAY[]::text[]))) THEN
        RETURN 'REVIEW_INVALID';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'review-photos' AND name = p) THEN
        RETURN 'REVIEW_MEDIA_MISSING';
      END IF;
    END LOOP;
    UPDATE public.reviews SET content = btrim(p_content), categories = p_categories,
      food_photos = p_food_photos,
      is_verified = false, admin_note = NULL, updated_at = clock_timestamp()
      WHERE id = r.id AND user_id = u;
  ELSE
    DELETE FROM public.reviews WHERE id = r.id AND user_id = u;
  END IF;
  -- The AFTER trigger queues the authoritative pre-image in this transaction.
  INSERT INTO review_media_private.commits VALUES (p_operation_id, u, r.id, p_kind, h);
  RETURN 'REVIEW_COMMITTED';
END $$;
-- Compensation requests are authority-checked and serialized too. A live
-- reference is never retired, even if the caller incorrectly reports failure.
CREATE FUNCTION public.queue_review_upload_cleanup(p_review_id uuid, p_paths text[])
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid := auth.uid(); p text;
BEGIN
  IF u IS NULL THEN RETURN 'REVIEW_UNAUTHORIZED'; END IF;
  IF current_setting('transaction_isolation') <> 'read committed' THEN RETURN 'REVIEW_RETRY_REQUIRED'; END IF;
  IF p_review_id IS NULL OR p_paths IS NULL OR cardinality(p_paths) > 10 THEN RETURN 'REVIEW_INVALID'; END IF;
  FOREACH p IN ARRAY p_paths LOOP
    IF NOT review_media_private.canonical(p, u, p_review_id, 'food') THEN RETURN 'REVIEW_INVALID'; END IF;
  END LOOP;
  PERFORM pg_advisory_xact_lock(741093, 1);
  FOREACH p IN ARRAY p_paths LOOP
    IF NOT review_media_private.referenced(p) THEN
      INSERT INTO review_media_private.cleanup(path, owner_id, review_id, purpose, retired)
        VALUES (p, u, p_review_id, 'food', true) ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;
  RETURN 'REVIEW_CLEANUP_QUEUED';
END $$;
CREATE FUNCTION public.read_review_media_commit(p_operation_id uuid, p_review_id uuid, p_kind text)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN EXISTS (SELECT 1 FROM review_media_private.commits
    WHERE operation_id = p_operation_id AND review_id = p_review_id AND kind = p_kind AND owner_id = auth.uid())
    THEN 'REVIEW_COMMITTED' ELSE 'REVIEW_NOT_CONFIRMED' END
$$;
CREATE FUNCTION public.pending_review_media_cleanup()
RETURNS TABLE(path text, owner_id uuid, review_id uuid, purpose text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR current_setting('transaction_isolation') <> 'read committed' THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(741093, 1);
  UPDATE review_media_private.cleanup c SET retired = true
    WHERE c.owner_id = auth.uid() AND NOT c.retired AND NOT review_media_private.referenced(c.path);
  RETURN QUERY SELECT c.path, c.owner_id, c.review_id, c.purpose FROM review_media_private.cleanup c
    WHERE c.owner_id = auth.uid() AND c.retired AND NOT c.complete
      AND NOT review_media_private.referenced(c.path) ORDER BY c.path LIMIT 20;
END $$;
CREATE FUNCTION public.finish_review_media_cleanup()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NULL; END IF;
  UPDATE review_media_private.cleanup c SET complete = true
    WHERE c.owner_id = auth.uid() AND c.retired AND NOT c.complete
      AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'review-photos' AND o.name = c.path);
  RETURN (SELECT count(*) FROM review_media_private.cleanup c WHERE c.owner_id = auth.uid() AND NOT c.complete);
END $$;
-- A restrictive policy also protects direct browser compensation by older
-- clients: successful HTTP delete responses alone cannot bypass live references.
CREATE FUNCTION public.review_media_delete_allowed(p_path text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE u uuid := auth.uid(); review_id uuid; purpose text;
BEGIN
  IF u IS NULL OR current_setting('transaction_isolation') <> 'read committed' THEN RETURN false; END IF;
  IF octet_length(p_path) > 512 THEN RETURN false; END IF;
  -- Existing composer compensation also uses Storage.remove directly. Admit
  -- only canonical orphan keys, retiring them atomically before that delete;
  -- a delayed insert/update then fails rather than referring to deleted media.
  PERFORM pg_advisory_xact_lock(741093, 1);
  IF EXISTS (SELECT 1 FROM review_media_private.cleanup c WHERE c.path = p_path
    AND c.owner_id = u AND c.retired AND NOT c.complete
    AND review_media_private.owned_legacy(p_path, u, c.purpose)) THEN
    RETURN NOT review_media_private.referenced(p_path);
  END IF;
  BEGIN review_id := split_part(p_path, '/', 3)::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RETURN false; END;
  purpose := split_part(p_path, '/', 4);
  IF NOT review_media_private.canonical(p_path, u, review_id, purpose) THEN RETURN false; END IF;
  IF review_media_private.referenced(p_path) THEN RETURN false; END IF;
  INSERT INTO review_media_private.cleanup(path, owner_id, review_id, purpose, retired)
    VALUES (p_path, u, review_id, purpose, true)
    ON CONFLICT (path) DO UPDATE SET retired = true;
  RETURN true;
END $$;
CREATE POLICY review_media_safe_delete ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
  USING (bucket_id <> 'review-photos' OR public.review_media_delete_allowed(name));
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA review_media_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mutate_review_with_media(uuid,uuid,text,timestamptz,text,text[],text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.queue_review_upload_cleanup(uuid,text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.read_review_media_commit(uuid,uuid,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pending_review_media_cleanup() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finish_review_media_cleanup() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.review_media_delete_allowed(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mutate_review_with_media(uuid,uuid,text,timestamptz,text,text[],text[]),
  public.queue_review_upload_cleanup(uuid,text[]), public.read_review_media_commit(uuid,uuid,text), public.pending_review_media_cleanup(),
  public.finish_review_media_cleanup(), public.review_media_delete_allowed(text) TO authenticated;
COMMIT;
