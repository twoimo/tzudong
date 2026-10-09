BEGIN;
-- Canonical source 20261004190259_admin_record_guarded_actions.sql
-- Guarded human administration; no model, approval policy or applied migration is rewritten.
CREATE TABLE pipeline_control.admin_record_operations (
 id uuid PRIMARY KEY, actor uuid NOT NULL, action text NOT NULL, target_ids uuid[] NOT NULL,
 payload_sha text NOT NULL CHECK(payload_sha ~ '^[a-f0-9]{64}$'), expected jsonb NOT NULL,
 preview_hash text NOT NULL, expires_at timestamptz NOT NULL, state text NOT NULL CHECK(state IN ('preview','applied')),
 receipt jsonb NOT NULL, cleanup_blocked boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE pipeline_control.admin_record_audit (
 id uuid PRIMARY KEY, operation_id uuid UNIQUE NOT NULL REFERENCES pipeline_control.admin_record_operations(id),
 actor uuid NOT NULL, action text NOT NULL, target_ids uuid[] NOT NULL, payload_sha text NOT NULL,
 before_fingerprints jsonb NOT NULL, after_fingerprints jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
-- Object names are isolated cleanup work, never copied to audit or browser receipts.
CREATE TABLE pipeline_control.admin_record_media_cleanup (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), operation_id uuid NOT NULL REFERENCES pipeline_control.admin_record_operations(id),
 bucket text NOT NULL CHECK(bucket='review-photos'), object_name text NOT NULL, object_fingerprint text,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','inflight','uncertain','done')),
 UNIQUE(operation_id,bucket,object_name)
);
ALTER TABLE pipeline_control.admin_record_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_control.admin_record_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_control.admin_record_media_cleanup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pipeline_control.admin_record_operations,pipeline_control.admin_record_audit,pipeline_control.admin_record_media_cleanup FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON pipeline_control.admin_record_operations,pipeline_control.admin_record_media_cleanup TO service_role;
GRANT DELETE ON pipeline_control.admin_record_media_cleanup TO service_role;
GRANT SELECT,INSERT ON pipeline_control.admin_record_audit TO service_role;

CREATE FUNCTION pipeline_control.admin_record_hash(value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$ SELECT encode(sha256(convert_to(value::text,'UTF8')),'hex') $$;
-- A durable retirement fence spans the DB commit and the separate Storage API delete.
-- The only metadata reads are from storage.objects. Object deletion itself remains through Storage API.
CREATE INDEX admin_record_media_path ON pipeline_control.admin_record_media_cleanup(bucket,object_name,state);
CREATE FUNCTION pipeline_control.admin_record_storage_snapshot(path text) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT pipeline_control.admin_record_hash(to_jsonb(o)-'last_accessed_at') FROM storage.objects o WHERE bucket_id='review-photos' AND name=path
$$;
CREATE FUNCTION pipeline_control.admin_record_reference_fence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE path text;
BEGIN
 -- Serialize all new references to each path with claim; foreign/external paths have no tombstone and remain allowed.
 FOR path IN SELECT DISTINCT x FROM unnest(coalesce(NEW.food_photos,'{}'::text[])||ARRAY[NEW.verification_photo]) x WHERE x IS NOT NULL ORDER BY x LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('review-photo:'||path,0));
  IF EXISTS(SELECT 1 FROM pipeline_control.admin_record_media_cleanup WHERE bucket='review-photos' AND object_name=path AND state IN ('inflight','uncertain','done')) THEN
   RAISE EXCEPTION 'RECORD_ACTION_MEDIA_RETIRED';
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER admin_record_reference_fence BEFORE INSERT OR UPDATE OF verification_photo,food_photos ON public.reviews
 FOR EACH ROW EXECUTE FUNCTION pipeline_control.admin_record_reference_fence();
CREATE FUNCTION pipeline_control.admin_record_object_fence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE path text;
BEGIN
 -- Cover ordinary uploads/upserts and privileged storage writes equally. DELETE is deliberately left to Storage.
 -- A read-access timestamp update does not replace content and is safe.
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'last_accessed_at')=(to_jsonb(OLD)-'last_accessed_at') THEN RETURN NEW; END IF;
 FOR path IN SELECT DISTINCT x FROM unnest(CASE WHEN TG_OP='UPDATE' THEN ARRAY[CASE WHEN OLD.bucket_id='review-photos' THEN OLD.name END,CASE WHEN NEW.bucket_id='review-photos' THEN NEW.name END] ELSE ARRAY[CASE WHEN NEW.bucket_id='review-photos' THEN NEW.name END] END) x WHERE x IS NOT NULL ORDER BY x LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('review-photo:'||path,0));
  IF EXISTS(SELECT 1 FROM pipeline_control.admin_record_media_cleanup WHERE bucket='review-photos' AND object_name=path AND state IN ('inflight','uncertain','done')) THEN
   -- Storage v1.33.0 TUS DELETE uses canUpload/testPermission: version '1' is
   -- written in a transaction which is always rolled back before termination.
   -- Permit only that BEFORE probe; the deferred AFTER constraint below rejects
   -- any commit, including forged request GUCs. No persistent write is exempt.
   IF TG_WHEN='BEFORE' AND NEW.version='1'
     AND current_setting('request.method',true)='DELETE'
     AND current_setting('storage.operation',true)='storage.tus.upload.delete'
     AND current_setting('request.path',true) ~ '^/upload/resumable/[A-Za-z0-9_-]+$'
     THEN CONTINUE; END IF;
   RAISE EXCEPTION 'RECORD_ACTION_MEDIA_RETIRED';
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER admin_record_object_fence BEFORE INSERT OR UPDATE ON storage.objects
 FOR EACH ROW EXECUTE FUNCTION pipeline_control.admin_record_object_fence();
-- A rollback-only permission probe must never become a committed replacement.
CREATE CONSTRAINT TRIGGER admin_record_object_commit_fence AFTER INSERT OR UPDATE ON storage.objects
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pipeline_control.admin_record_object_fence();
REVOKE ALL ON FUNCTION pipeline_control.admin_record_reference_fence(),pipeline_control.admin_record_object_fence() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION pipeline_control.admin_record_storage_snapshot(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION pipeline_control.admin_record_storage_snapshot(text) TO service_role;

CREATE FUNCTION pipeline_control.admin_record_snapshot(action text, ids uuid[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb:='{}'; row_value jsonb; related uuid[]:=ids; n integer;
BEGIN
 IF action LIKE 'restaurant.%' THEN
   IF action='restaurant.merge' THEN
    SELECT array_agg(DISTINCT r.id ORDER BY r.id) INTO related FROM public.restaurants r JOIN public.restaurants seed ON seed.id=ANY(ids)
     AND (r.id=seed.id OR (r.status<>'deleted' AND public.normalize_restaurant_identity_name(public.resolve_restaurant_identity_name(r.approved_name,r.origin_name,r.naver_name,r.google_name))=public.normalize_restaurant_identity_name(public.resolve_restaurant_identity_name(seed.approved_name,seed.origin_name,seed.naver_name,seed.google_name))
      AND nullif(coalesce(nullif(r.jibun_address,''),r.road_address),'')=nullif(coalesce(nullif(seed.jibun_address,''),seed.road_address),'')));
    IF cardinality(related)>25 THEN RAISE EXCEPTION 'RECORD_ACTION_LIMIT'; END IF;
   END IF;
   IF (SELECT count(*) FROM public.restaurants WHERE id=ANY(ids))<>cardinality(ids) THEN RAISE EXCEPTION 'RECORD_ACTION_NOT_FOUND'; END IF;
   FOR row_value IN SELECT to_jsonb(r) FROM public.restaurants r WHERE id=ANY(related) ORDER BY id LOOP
    result:=result||jsonb_build_object('restaurant:'||(row_value->>'id'),pipeline_control.admin_record_hash(row_value));
   END LOOP;

 ELSIF action LIKE 'submission.%' THEN
   SELECT to_jsonb(s) INTO row_value FROM public.restaurant_submissions s WHERE id=ids[1];
   IF row_value IS NULL THEN RAISE EXCEPTION 'RECORD_ACTION_NOT_FOUND'; END IF;
   result:=jsonb_build_object('submission:'||ids[1],pipeline_control.admin_record_hash(row_value));
   SELECT count(*) INTO n FROM public.restaurant_submission_items WHERE submission_id=ids[1];
   IF n>25 THEN RAISE EXCEPTION 'RECORD_ACTION_LIMIT'; END IF;
   FOR row_value IN SELECT to_jsonb(i) FROM public.restaurant_submission_items i WHERE submission_id=ids[1] ORDER BY id LOOP
    result:=result||jsonb_build_object('item:'||(row_value->>'id'),pipeline_control.admin_record_hash(row_value));
   END LOOP;
   SELECT array_agg(target_restaurant_id) INTO related FROM public.restaurant_submission_items WHERE submission_id=ids[1] AND target_restaurant_id IS NOT NULL;
 ELSIF action LIKE 'review.%' THEN
   SELECT to_jsonb(r) INTO row_value FROM public.reviews r WHERE id=ids[1];
   IF row_value IS NULL THEN RAISE EXCEPTION 'RECORD_ACTION_NOT_FOUND'; END IF;
   result:=jsonb_build_object('review:'||ids[1],pipeline_control.admin_record_hash(row_value||jsonb_build_object('__media_fingerprints',
    (SELECT jsonb_object_agg(path,pipeline_control.admin_record_storage_snapshot(path)) FROM
     (SELECT DISTINCT x path FROM jsonb_array_elements_text(coalesce(nullif(row_value->'food_photos','null'::jsonb),'[]'::jsonb)||jsonb_build_array(row_value->>'verification_photo')) x WHERE x IS NOT NULL) media))));
   related:=ARRAY[(row_value->>'restaurant_id')::uuid];
 ELSIF action LIKE 'recommendation.%' THEN
   SELECT to_jsonb(r) INTO row_value FROM public.restaurant_requests r WHERE id=ids[1];
   IF row_value IS NULL THEN RAISE EXCEPTION 'RECORD_ACTION_NOT_FOUND'; END IF;
   result:=jsonb_build_object('recommendation:'||ids[1],pipeline_control.admin_record_hash(row_value));
 END IF;
 IF action LIKE 'submission.%' OR action LIKE 'review.%' THEN
   FOR row_value IN SELECT to_jsonb(r) FROM public.restaurants r WHERE id=ANY(related) ORDER BY id LOOP
    result:=result||jsonb_build_object('restaurant:'||(row_value->>'id'),pipeline_control.admin_record_hash(row_value));
   END LOOP;
 END IF;
 RETURN result;
END $$;

CREATE FUNCTION pipeline_control.admin_record_readback(snapshot jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE entry record; result jsonb:='[]'; kind text; target uuid; status_value text;
BEGIN
 FOR entry IN SELECT key,value FROM jsonb_each(snapshot) ORDER BY key LOOP
  kind:=split_part(entry.key,':',1);target:=split_part(entry.key,':',2)::uuid;status_value:=NULL;
  IF entry.value='null'::jsonb THEN status_value:='deleted';
  ELSIF kind='restaurant' THEN SELECT status INTO status_value FROM public.restaurants WHERE id=target;
  ELSIF kind='submission' THEN SELECT status::text INTO status_value FROM public.restaurant_submissions WHERE id=target;
  ELSIF kind='item' THEN SELECT item_status INTO status_value FROM public.restaurant_submission_items WHERE id=target;
  ELSIF kind='recommendation' THEN SELECT status INTO status_value FROM public.restaurant_requests WHERE id=target;
  ELSIF kind='review' THEN SELECT CASE WHEN is_verified THEN 'approved' WHEN admin_note LIKE '거부: %' THEN 'rejected' ELSE 'pending' END INTO status_value FROM public.reviews WHERE id=target;
  END IF;
  IF status_value IS NULL THEN RAISE EXCEPTION 'RECORD_ACTION_READBACK_MISMATCH'; END IF;
  result:=result||jsonb_build_array(jsonb_build_object('id',target,'kind',kind,'status',status_value,'fingerprint',entry.value));
 END LOOP;
 RETURN result;
END $$;

CREATE FUNCTION pipeline_control.admin_record_validate_restaurant(row_value jsonb, exclude_ids uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE categories jsonb:=row_value->'categories';
BEGIN
 IF nullif(btrim(row_value->>'approved_name'),'') IS NULL OR length(row_value->>'approved_name')>160
  OR jsonb_typeof(categories) IS DISTINCT FROM 'array' OR jsonb_array_length(categories) NOT BETWEEN 1 AND 15
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(categories) x WHERE jsonb_typeof(x)<>'string' OR x#>>'{}' <> ALL(ARRAY['치킨','중식','돈까스·회','피자','패스트푸드','찜·탕','족발·보쌈','분식','카페·디저트','한식','고기','양식','아시안','야식','도시락']))
  OR (SELECT count(*)<>count(DISTINCT x) FROM jsonb_array_elements(categories) x)
  OR jsonb_typeof(row_value->'lat') IS DISTINCT FROM 'number' OR jsonb_typeof(row_value->'lng') IS DISTINCT FROM 'number'
  OR (row_value->>'lat')::numeric NOT BETWEEN -90 AND 90 OR (row_value->>'lng')::numeric NOT BETWEEN -180 AND 180
  OR nullif(btrim(coalesce(row_value->>'jibun_address',row_value->>'road_address')),'') IS NULL
  OR row_value->'geocoding_success' IS DISTINCT FROM 'true'::jsonb
  OR coalesce(row_value->>'youtube_link','') !~ '^https://(www\.)?youtube\.com/watch\?v=[A-Za-z0-9_-]{11}$'
 THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_RESTAURANT'; END IF;
 IF EXISTS(SELECT 1 FROM public.restaurants r WHERE NOT (id=ANY(array_remove(exclude_ids,NULL))) AND status<>'deleted'
  AND public.extract_youtube_video_id(r.youtube_link)=public.extract_youtube_video_id(row_value->>'youtube_link')
  AND public.normalize_restaurant_identity_name(public.resolve_restaurant_identity_name(r.approved_name,r.origin_name,r.naver_name,r.google_name))=
      public.normalize_restaurant_identity_name(row_value->>'approved_name')) THEN RAISE EXCEPTION 'RECORD_ACTION_DUPLICATE'; END IF;
END $$;

-- Compose only permitted domain fields. Omission preserves the saved value; JSON null is an explicit clear.
CREATE FUNCTION pipeline_control.admin_record_compose(row_value jsonb, changes jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE k text; meta jsonb; ads jsonb; incoming_meta jsonb;
BEGIN
 IF jsonb_typeof(changes) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(changes) x WHERE x<>ALL(ARRAY[
  'approved_name','phone','categories','youtube_link','tzuyang_review','road_address','jibun_address','english_address','address_elements','lat','lng','geocoding_success','youtube_meta']))
 THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
 FOREACH k IN ARRAY ARRAY['approved_name','phone','youtube_link','tzuyang_review','road_address','jibun_address','english_address'] LOOP
  IF changes ? k AND (jsonb_typeof(changes->k) NOT IN ('string','null') OR length(changes->>k)>4000) THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
 END LOOP;
 IF (changes ? 'approved_name' AND (nullif(btrim(changes->>'approved_name'),'') IS NULL OR length(changes->>'approved_name')>160))
  OR (changes ? 'phone' AND length(changes->>'phone')>80)
  OR (changes ? 'youtube_link' AND changes->'youtube_link'<>'null'::jsonb AND changes->>'youtube_link' !~ '^https://(www\.)?youtube\.com/watch\?v=[A-Za-z0-9_-]{11}$')
  OR (changes ? 'geocoding_success' AND jsonb_typeof(changes->'geocoding_success')<>'boolean')
  OR (changes ? 'youtube_meta' AND jsonb_typeof(changes->'youtube_meta')<>'object')
  OR (changes ? 'address_elements' AND jsonb_typeof(changes->'address_elements') NOT IN ('array','object','null'))
 THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_RESTAURANT'; END IF;
 FOREACH k IN ARRAY ARRAY['lat','lng'] LOOP
  IF changes ? k THEN
   IF jsonb_typeof(changes->k)<>'number' THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_RESTAURANT'; END IF;
   IF (changes->>k)::numeric NOT BETWEEN (CASE k WHEN 'lat' THEN -90 ELSE -180 END) AND (CASE k WHEN 'lat' THEN 90 ELSE 180 END) THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_RESTAURANT'; END IF;
  END IF;
 END LOOP;
 IF changes ? 'categories' THEN
  IF jsonb_typeof(changes->'categories')<>'array' THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_RESTAURANT'; END IF;
  IF jsonb_array_length(changes->'categories') NOT BETWEEN 1 AND 15 OR EXISTS(SELECT 1 FROM jsonb_array_elements(changes->'categories') x WHERE jsonb_typeof(x)<>'string' OR x#>>'{}'<>ALL(ARRAY['치킨','중식','돈까스·회','피자','패스트푸드','찜·탕','족발·보쌈','분식','카페·디저트','한식','고기','양식','아시안','야식','도시락'])) OR (SELECT count(*)<>count(DISTINCT x) FROM jsonb_array_elements(changes->'categories') x) THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_RESTAURANT'; END IF;
 END IF;
 IF changes ? 'youtube_meta' THEN
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(changes->'youtube_meta') meta_key WHERE meta_key<>ALL(ARRAY['title','published_at','duration','is_shorts','is_ads','what_ads'])) THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
  incoming_meta:=changes->'youtube_meta';
  FOREACH k IN ARRAY ARRAY['title','published_at'] LOOP
   IF incoming_meta ? k AND (jsonb_typeof(incoming_meta->k)<>'string' OR length(incoming_meta->>k)>4000) THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
  END LOOP;
  IF incoming_meta ? 'duration' THEN
   IF jsonb_typeof(incoming_meta->'duration')<>'number' THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
   IF (incoming_meta->>'duration')::numeric<0 THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
  END IF;
  IF (incoming_meta ? 'is_shorts' AND jsonb_typeof(incoming_meta->'is_shorts')<>'boolean')
   OR (incoming_meta ? 'is_ads' AND jsonb_typeof(incoming_meta->'is_ads')<>'boolean') THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
  IF incoming_meta ? 'what_ads' AND incoming_meta->'what_ads'<>'null'::jsonb THEN
   IF jsonb_typeof(incoming_meta->'what_ads')<>'array' THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
   IF jsonb_array_length(incoming_meta->'what_ads')>20 OR EXISTS(SELECT 1 FROM jsonb_array_elements(incoming_meta->'what_ads') x WHERE jsonb_typeof(x)<>'string' OR length(x#>>'{}')>4000) THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
  END IF;
  meta:=CASE WHEN jsonb_typeof(row_value->'youtube_meta')='object' THEN row_value->'youtube_meta' ELSE '{}'::jsonb END;
  ads:=CASE WHEN jsonb_typeof(meta->'ads_info')='object' THEN meta->'ads_info' ELSE '{}'::jsonb END;
  FOREACH k IN ARRAY ARRAY['title','duration','is_shorts'] LOOP
   IF incoming_meta ? k THEN meta:=meta||jsonb_build_object(k,incoming_meta->k); END IF;
  END LOOP;
  IF incoming_meta ? 'published_at' THEN meta:=meta||jsonb_build_object('publishedAt',incoming_meta->'published_at'); END IF;
  IF incoming_meta ? 'is_ads' THEN ads:=ads||jsonb_build_object('is_ads',incoming_meta->'is_ads'); END IF;
  IF incoming_meta ? 'what_ads' THEN
   -- Canonical consumers use nullable advertising text. A single wrapped text
   -- round-trips exactly; ordered names retain their text in a readable list.
   ads:=ads||jsonb_build_object('what_ads',CASE WHEN incoming_meta->'what_ads'='null'::jsonb THEN NULL::text ELSE
    (SELECT string_agg(value,', ' ORDER BY ordinal) FROM jsonb_array_elements_text(incoming_meta->'what_ads') WITH ORDINALITY a(value,ordinal)) END);
  END IF;
  IF incoming_meta ? 'is_ads' OR incoming_meta ? 'what_ads' OR meta ? 'ads_info' THEN meta:=meta||jsonb_build_object('ads_info',ads); END IF;
  changes:=changes||jsonb_build_object('youtube_meta',meta);
 END IF;
 RETURN row_value||changes;
END $$;
CREATE FUNCTION pipeline_control.admin_record_identity_check(row_value jsonb,exclude_ids uuid[]) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.restaurants r WHERE NOT(id=ANY(array_remove(exclude_ids,NULL))) AND status<>'deleted'
  AND public.extract_youtube_video_id(r.youtube_link)=public.extract_youtube_video_id(row_value->>'youtube_link')
  AND public.normalize_restaurant_identity_name(public.resolve_restaurant_identity_name(r.approved_name,r.origin_name,r.naver_name,r.google_name))=
      public.normalize_restaurant_identity_name(public.resolve_restaurant_identity_name(row_value->>'approved_name',row_value->>'origin_name',row_value->>'naver_name',row_value->>'google_name')))
 THEN RAISE EXCEPTION 'RECORD_ACTION_DUPLICATE'; END IF;
END $$;
-- The final row was composed/validated before any staging writes. Never copy evaluation or provenance from a request.
CREATE FUNCTION pipeline_control.admin_record_write(id_value uuid,row_value jsonb,actor uuid,approve boolean) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE patched public.restaurants:=jsonb_populate_record(NULL::public.restaurants,row_value);
BEGIN
 UPDATE public.restaurants SET approved_name=patched.approved_name,phone=patched.phone,categories=patched.categories,
  youtube_link=patched.youtube_link,tzuyang_review=patched.tzuyang_review,road_address=patched.road_address,jibun_address=patched.jibun_address,
  english_address=patched.english_address,address_elements=patched.address_elements,lat=patched.lat,lng=patched.lng,
  geocoding_success=patched.geocoding_success,youtube_meta=patched.youtube_meta,updated_by_admin_id=actor,updated_at=clock_timestamp(),
  status=CASE WHEN approve THEN 'approved' ELSE status END,is_missing=CASE WHEN approve THEN false ELSE is_missing END WHERE id=id_value;
END $$;
CREATE FUNCTION pipeline_control.admin_record_patch(id_value uuid, changes jsonb, actor uuid, approve boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE row_value jsonb;
BEGIN
 SELECT to_jsonb(r) INTO row_value FROM public.restaurants r WHERE id=id_value;
 IF row_value IS NULL OR row_value->>'status'='deleted' THEN RAISE EXCEPTION 'RECORD_ACTION_STATE_CONFLICT'; END IF;
 row_value:=pipeline_control.admin_record_compose(row_value,changes);
 IF approve THEN PERFORM pipeline_control.admin_record_validate_restaurant(row_value,ARRAY[id_value]);
 ELSE PERFORM pipeline_control.admin_record_identity_check(row_value,ARRAY[id_value]); END IF;
 PERFORM pipeline_control.admin_record_write(id_value,row_value,actor,approve);
END $$;

CREATE FUNCTION pipeline_control.admin_record_create(changes jsonb,actor uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE created uuid:=gen_random_uuid();
BEGIN
 changes:=pipeline_control.admin_record_compose('{}'::jsonb,changes);
 PERFORM pipeline_control.admin_record_validate_restaurant(changes,'{}'::uuid[]);
 IF nullif(btrim(changes->>'tzuyang_review'),'') IS NULL THEN RAISE EXCEPTION 'RECORD_ACTION_EVIDENCE_REQUIRED'; END IF;
 INSERT INTO public.restaurants(id,approved_name,source_type,status,trace_id,youtube_link,lat,lng,jibun_address,categories,geocoding_success,updated_by_admin_id)
 VALUES(created,changes->>'approved_name','admin','pending',encode(sha256(convert_to('admin-record:'||created::text,'UTF8')),'hex'),changes->>'youtube_link',(changes->>'lat')::numeric,(changes->>'lng')::numeric,
  changes->>'jibun_address',ARRAY(SELECT jsonb_array_elements_text(changes->'categories')),true,actor);
 -- changes is already canonical and validated; do not parse it as the flat DTO twice.
 PERFORM pipeline_control.admin_record_write(created,changes,actor,true);
 RETURN created;
END $$;

-- Service-only actor predicate; protected role tables remain unavailable to Data API callers.
CREATE FUNCTION pipeline_control.admin_record_assert_operator(actor uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF actor IS NULL OR NOT EXISTS (
  SELECT 1 FROM public.user_roles role JOIN public.user_account_status account ON account.user_id=role.user_id
  WHERE role.user_id=actor AND role.role='admin' AND account.account_status='active' AND account.disabled_at IS NULL
 ) THEN RAISE EXCEPTION 'RECORD_ACTION_FORBIDDEN' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION pipeline_control.admin_record_assert_operator(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION pipeline_control.admin_record_assert_operator(uuid) TO service_role;

CREATE FUNCTION public.admin_record_action(p_actor uuid,p_phase text,p_operation_id uuid,p_action text DEFAULT NULL,
 p_target_ids uuid[] DEFAULT '{}'::uuid[],p_payload jsonb DEFAULT '{}'::jsonb,p_preview_hash text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
<<work>>
DECLARE op pipeline_control.admin_record_operations; ids uuid[]; fingerprint jsonb; after_state jsonb; digest text;
 receipt jsonb; audit uuid; row_value jsonb; changed jsonb; item jsonb; target uuid; created uuid; source_id uuid;
 classification text; conflict_constraint text; photo text; job pipeline_control.admin_record_media_cleanup; expected_count integer; pending_count integer; final_rows jsonb; final_row jsonb; key_name text; related_ids uuid[];
BEGIN
 PERFORM pipeline_control.admin_record_assert_operator(p_actor);
 IF current_user NOT IN ('service_role','postgres') OR p_operation_id IS NULL THEN RAISE EXCEPTION 'RECORD_ACTION_FORBIDDEN'; END IF;
 PERFORM set_config('lock_timeout','2s',true);
 PERFORM pg_advisory_xact_lock(hashtextextended('admin-record:'||p_operation_id,0));
 SELECT * INTO op FROM pipeline_control.admin_record_operations WHERE id=p_operation_id FOR UPDATE;
 IF FOUND AND op.actor<>p_actor THEN RAISE EXCEPTION 'RECORD_ACTION_FORBIDDEN'; END IF;
 IF p_phase='readback' THEN
  IF op.id IS NULL THEN RAISE EXCEPTION 'RECORD_ACTION_NOT_FOUND'; END IF;
  RETURN op.receipt||jsonb_build_object('mediaCleanupUnmanaged',op.cleanup_blocked,'mediaCleanupPending',EXISTS(SELECT 1 FROM pipeline_control.admin_record_media_cleanup WHERE operation_id=op.id AND state<>'done'));
 END IF;
 IF p_phase LIKE 'cleanup_%' THEN
  IF op.id IS NULL OR op.state<>'applied' OR op.action<>'review.delete' THEN RAISE EXCEPTION 'RECORD_ACTION_STATE_CONFLICT'; END IF;
  IF p_phase='cleanup_read' THEN
   RETURN jsonb_build_object('jobs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'bucket',bucket,'objectName',object_name,'state',state) ORDER BY id)
     FROM pipeline_control.admin_record_media_cleanup WHERE operation_id=op.id AND state<>'done'),'[]'::jsonb));
  END IF;
  SELECT * INTO job FROM pipeline_control.admin_record_media_cleanup WHERE operation_id=op.id AND id=(p_payload->>'jobId')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RECORD_ACTION_NOT_FOUND'; END IF;
  IF p_phase='cleanup_claim' AND job.state='pending' THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('review-photo:'||job.object_name,0));
   IF EXISTS(SELECT 1 FROM public.reviews WHERE verification_photo=job.object_name OR job.object_name=ANY(food_photos))
     OR job.object_fingerprint IS DISTINCT FROM pipeline_control.admin_record_storage_snapshot(job.object_name) THEN
    -- A new reference or changed object is protected, not a failed database moderation.
    DELETE FROM pipeline_control.admin_record_media_cleanup WHERE id=job.id;
    UPDATE pipeline_control.admin_record_operations SET cleanup_blocked=true WHERE id=op.id;
    RETURN jsonb_build_object('ok',true,'claimed',false);
   END IF;
   UPDATE pipeline_control.admin_record_media_cleanup SET state='inflight' WHERE id=job.id;
   RETURN jsonb_build_object('ok',true,'claimed',true);
  ELSIF p_phase='cleanup_absent' THEN
   PERFORM pg_advisory_xact_lock(hashtextextended('review-photo:'||job.object_name,0));
   IF pipeline_control.admin_record_storage_snapshot(job.object_name) IS NOT NULL THEN RAISE EXCEPTION 'RECORD_ACTION_STATE_CONFLICT'; END IF;
   UPDATE pipeline_control.admin_record_media_cleanup SET state='done' WHERE id=job.id;
  ELSIF p_phase='cleanup_uncertain' AND job.state='inflight' THEN
   UPDATE pipeline_control.admin_record_media_cleanup SET state='uncertain' WHERE id=job.id;
  ELSE RAISE EXCEPTION 'RECORD_ACTION_STATE_CONFLICT'; END IF;
  RETURN jsonb_build_object('ok',true);
 END IF;
 IF p_phase NOT IN ('preview','apply') OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR octet_length(p_payload::text)>65536
  OR p_action NOT IN ('restaurant.approve','restaurant.edit','restaurant.create','restaurant.delete','restaurant.restore','restaurant.register_missing','restaurant.merge','restaurant.hold',
    'submission.approve','submission.reject','submission.delete','submission.edit','review.approve','review.reject','review.delete','recommendation.approve','recommendation.reject')
  THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
 SELECT coalesce(array_agg(x ORDER BY x),'{}'::uuid[]) INTO ids FROM unnest(p_target_ids) x;
 IF cardinality(ids)<>(CASE WHEN p_action='restaurant.create' THEN 0 WHEN p_action='restaurant.merge' THEN 2 WHEN p_action='restaurant.edit' THEN cardinality(ids) ELSE 1 END)
  OR (p_action='restaurant.edit' AND cardinality(ids) NOT BETWEEN 1 AND 25)
  OR array_position(ids,NULL) IS NOT NULL OR (SELECT count(*)<>count(DISTINCT x) FROM unnest(ids) x)
  THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
 IF (p_action IN ('restaurant.delete','restaurant.hold','submission.reject','submission.delete','review.reject','review.delete','recommendation.reject') AND (nullif(btrim(p_payload->>'reason'),'') IS NULL OR length(p_payload->>'reason')>500)) OR length(p_payload->>'note')>500 THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
 digest:=pipeline_control.admin_record_hash(p_payload);
 IF op.id IS NOT NULL THEN
  IF op.action IS DISTINCT FROM p_action OR op.target_ids IS DISTINCT FROM ids OR op.payload_sha IS DISTINCT FROM digest THEN RAISE EXCEPTION 'RECORD_ACTION_IDEMPOTENCY_CONFLICT'; END IF;
  IF p_phase='apply' AND p_preview_hash IS DISTINCT FROM op.preview_hash THEN RAISE EXCEPTION 'RECORD_ACTION_PREVIEW_MISMATCH'; END IF;
  IF op.state='applied' THEN RETURN op.receipt; END IF;
  IF op.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'RECORD_ACTION_PREVIEW_EXPIRED'; END IF;
 ELSIF p_phase='apply' THEN RAISE EXCEPTION 'RECORD_ACTION_PREVIEW_REQUIRED'; END IF;
 -- One deterministic lock order also excludes new duplicate inserts and review counter races.
 -- These short bounded transactions never contain a provider/storage call.
 LOCK TABLE public.restaurants,public.restaurant_submissions,public.restaurant_submission_items,public.reviews,public.restaurant_requests IN SHARE ROW EXCLUSIVE MODE;
 IF p_action='review.delete' THEN
  FOR photo IN SELECT DISTINCT x FROM public.reviews r CROSS JOIN LATERAL unnest(coalesce(r.food_photos,'{}'::text[])||ARRAY[r.verification_photo]) x WHERE r.id=ids[1] AND x IS NOT NULL ORDER BY x LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended('review-photo:'||photo,0));
  END LOOP;
 END IF;
 fingerprint:=pipeline_control.admin_record_snapshot(p_action,ids);
 IF op.id IS NOT NULL AND fingerprint IS DISTINCT FROM op.expected THEN RAISE EXCEPTION 'RECORD_ACTION_STALE'; END IF;
 IF p_phase='preview' THEN
  IF op.id IS NOT NULL THEN RETURN op.receipt; END IF;
  receipt:=jsonb_build_object('operationId',p_operation_id,'action',p_action,'state','preview','targetIds',ids,'auditId',NULL,
    'previewHash',pipeline_control.admin_record_hash(jsonb_build_array(p_actor,p_operation_id,p_action,ids,digest,fingerprint)),
    'expiresAt',clock_timestamp()+interval '15 minutes','readback',pipeline_control.admin_record_readback(fingerprint),'mediaCleanupPending',false);
  INSERT INTO pipeline_control.admin_record_operations(id,actor,action,target_ids,payload_sha,expected,preview_hash,expires_at,state,receipt)
   VALUES(p_operation_id,p_actor,p_action,ids,digest,fingerprint,receipt->>'previewHash',(receipt->>'expiresAt')::timestamptz,'preview',receipt);
  RETURN receipt;
 END IF;
 audit:=gen_random_uuid(); target:=ids[1];
 IF p_action LIKE 'restaurant.%' THEN
  SELECT to_jsonb(r) INTO row_value FROM public.restaurants r WHERE id=target;
  IF p_action='restaurant.create' THEN
   IF jsonb_typeof(coalesce(p_payload->'additions','[]'::jsonb))<>'array' OR jsonb_array_length(coalesce(p_payload->'additions','[]'::jsonb))>24 THEN RAISE EXCEPTION 'RECORD_ACTION_LIMIT'; END IF;
   created:=pipeline_control.admin_record_create(p_payload->'changes',p_actor); ids:=ARRAY[created];
   FOR changed IN SELECT value FROM jsonb_array_elements(coalesce(p_payload->'additions','[]'::jsonb)) LOOP
    created:=pipeline_control.admin_record_create(changed,p_actor); ids:=array_append(ids,created);
   END LOOP;
  ELSIF p_action='restaurant.edit' THEN
   IF jsonb_typeof(coalesce(p_payload->'perTargetChanges','[]'::jsonb))<>'array'
    OR jsonb_typeof(coalesce(p_payload->'removeIds','[]'::jsonb))<>'array' OR jsonb_typeof(coalesce(p_payload->'additions','[]'::jsonb))<>'array'
    OR cardinality(ids)+jsonb_array_length(coalesce(p_payload->'additions','[]'::jsonb))>25
    OR cardinality(ids)-jsonb_array_length(coalesce(p_payload->'removeIds','[]'::jsonb))+jsonb_array_length(coalesce(p_payload->'additions','[]'::jsonb))<1
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_payload->'perTargetChanges','[]'::jsonb)) x WHERE NOT ((x->>'id')::uuid=ANY(ids)))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_payload->'perTargetChanges','[]'::jsonb)) x GROUP BY x->>'id' HAVING count(*)>1)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(p_payload->'removeIds','[]'::jsonb)) x WHERE NOT (x::uuid=ANY(ids)))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(coalesce(p_payload->'removeIds','[]'::jsonb)) x GROUP BY x HAVING count(*)>1)
    THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
   final_rows:='{}'::jsonb;
   FOREACH target IN ARRAY ids LOOP
    SELECT to_jsonb(r) INTO row_value FROM public.restaurants r WHERE id=target;
    IF row_value->>'status'='deleted' THEN RAISE EXCEPTION 'RECORD_ACTION_STATE_CONFLICT'; END IF;
    IF coalesce(p_payload->'removeIds','[]'::jsonb) ? target::text THEN
     IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_payload->'perTargetChanges','[]'::jsonb)) x WHERE x->>'id'=target::text) THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
    ELSE
     SELECT value->'changes' INTO changed FROM jsonb_array_elements(coalesce(p_payload->'perTargetChanges','[]'::jsonb)) WHERE value->>'id'=target::text;
     final_row:=pipeline_control.admin_record_compose(row_value,(p_payload->'changes')||coalesce(changed,'{}'::jsonb));
     PERFORM pipeline_control.admin_record_identity_check(final_row,ids);
     final_rows:=final_rows||jsonb_build_object(target::text,final_row);
    END IF;
   END LOOP;
   -- The canonical unique index is immediate. Vacate claimed video identities only inside this transaction,
   -- then write saved final rows; any final collision rolls the entire transaction back.
   UPDATE public.restaurants SET youtube_link=NULL WHERE id=ANY(ids) AND final_rows ? id::text;
   UPDATE public.restaurants SET status='deleted',updated_by_admin_id=p_actor,updated_at=clock_timestamp()
    WHERE id=ANY(ids) AND NOT(final_rows ? id::text);
   FOR key_name,final_row IN SELECT key,value FROM jsonb_each(final_rows) ORDER BY key LOOP
    PERFORM pipeline_control.admin_record_identity_check(final_row,ARRAY[key_name::uuid]);
    PERFORM pipeline_control.admin_record_write(key_name::uuid,final_row,p_actor,false);
   END LOOP;
   FOR changed IN SELECT value FROM jsonb_array_elements(coalesce(p_payload->'additions','[]'::jsonb)) LOOP
    created:=pipeline_control.admin_record_create(changed,p_actor);ids:=array_append(ids,created);
   END LOOP;
  ELSIF p_action='restaurant.register_missing' THEN
   IF p_action='restaurant.register_missing' AND row_value->'is_missing' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'RECORD_ACTION_STATE_CONFLICT'; END IF;
   PERFORM pipeline_control.admin_record_patch(target,p_payload->'changes',p_actor,p_action='restaurant.register_missing');
  ELSIF p_action='restaurant.approve' THEN
   IF row_value->>'status' NOT IN ('pending','hold') THEN RAISE EXCEPTION 'RECORD_ACTION_STATE_CONFLICT'; END IF;
   row_value:=pipeline_control.admin_record_compose(row_value,coalesce(p_payload->'changes','{}'::jsonb));
   IF nullif(btrim(row_value->>'approved_name'),'') IS NULL THEN
    row_value:=row_value||jsonb_build_object('approved_name',public.resolve_restaurant_identity_name(row_value->>'approved_name',row_value->>'origin_name',row_value->>'naver_name',row_value->>'google_name'));
   END IF;
   -- Explicit human approval may revisit a held/admin-owned row, but cannot invent evaluation evidence.
   classification:=pipeline_control.restaurant_review_decision(row_value||jsonb_build_object('status','pending','updated_by_admin_id',NULL,'created_by',NULL,'source_type','crawler'));
   IF classification<>'approve:all_checks_passed' THEN RAISE EXCEPTION 'RECORD_ACTION_EVIDENCE_REQUIRED'; END IF;
   PERFORM pipeline_control.admin_record_validate_restaurant(row_value,ARRAY[target]);
   PERFORM pipeline_control.admin_record_write(target,row_value,p_actor,true);
  ELSIF p_action='restaurant.merge' THEN
   target:=(p_payload->>'mergeTargetId')::uuid;
   IF NOT target=ANY(ids) THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
   SELECT x INTO source_id FROM unnest(ids) x WHERE x<>target;
   SELECT to_jsonb(r) INTO changed FROM public.restaurants r WHERE id=target;
   SELECT to_jsonb(r) INTO row_value FROM public.restaurants r WHERE id=source_id;
   IF row_value->>'status'='deleted' OR changed->>'status'='deleted' THEN RAISE EXCEPTION 'RECORD_ACTION_STATE_CONFLICT'; END IF;
   row_value:=pipeline_control.admin_record_compose(row_value,coalesce(p_payload->'incomingChanges','{}'::jsonb));
   -- Fill missing target business information; preserve populated administrator fields and all evaluation JSON.
   FOREACH key_name IN ARRAY ARRAY['approved_name','phone','road_address','jibun_address','english_address','address_elements','lat','lng','geocoding_success'] LOOP
    IF changed->key_name IS NULL OR changed->key_name IN ('null'::jsonb,'""'::jsonb,'{}'::jsonb,'false'::jsonb) THEN changed:=changed||jsonb_build_object(key_name,row_value->key_name); END IF;
   END LOOP;
   changed:=changed||jsonb_build_object('categories',(SELECT coalesce(jsonb_agg(x ORDER BY x),'[]'::jsonb) FROM (SELECT DISTINCT value x FROM jsonb_array_elements(coalesce(nullif(changed->'categories','null'::jsonb),'[]'::jsonb)||coalesce(nullif(row_value->'categories','null'::jsonb),'[]'::jsonb))) c));
   IF nullif(changed->>'youtube_link','') IS NULL OR public.extract_youtube_video_id(changed->>'youtube_link')=public.extract_youtube_video_id(row_value->>'youtube_link') THEN
    changed:=changed||jsonb_build_object('youtube_link',coalesce(nullif(changed->>'youtube_link',''),row_value->>'youtube_link'),
     'youtube_meta',coalesce(nullif(row_value->'youtube_meta','null'::jsonb),'{}'::jsonb)||coalesce(nullif(changed->'youtube_meta','null'::jsonb),'{}'::jsonb),
     'tzuyang_review',coalesce(nullif(changed->>'tzuyang_review',''),row_value->>'tzuyang_review'));
    UPDATE public.restaurants SET status='deleted',updated_by_admin_id=p_actor,updated_at=clock_timestamp(),db_error_message=NULL,db_error_details=NULL WHERE id=source_id;
   ELSE
    -- A different video remains a separate active link row; retain its own video metadata, review and evaluation.
    FOREACH key_name IN ARRAY ARRAY['approved_name','phone','categories','road_address','jibun_address','english_address','address_elements','lat','lng','geocoding_success'] LOOP
     row_value:=row_value||jsonb_build_object(key_name,changed->key_name);
    END LOOP;
    PERFORM pipeline_control.admin_record_identity_check(row_value,ARRAY[source_id]);
    PERFORM pipeline_control.admin_record_write(source_id,row_value,p_actor,false);
    UPDATE public.restaurants SET db_error_message=NULL,db_error_details=NULL WHERE id=source_id;
   END IF;
   PERFORM pipeline_control.admin_record_identity_check(changed,ARRAY[target]);
   PERFORM pipeline_control.admin_record_write(target,changed,p_actor,false);
  ELSE
   IF p_action='restaurant.restore' THEN
    IF row_value->>'status'<>'deleted' THEN RAISE EXCEPTION 'RECORD_ACTION_STATE_CONFLICT'; END IF;
    IF EXISTS(SELECT 1 FROM public.restaurants r WHERE id<>target AND status<>'deleted' AND public.extract_youtube_video_id(r.youtube_link)=public.extract_youtube_video_id(row_value->>'youtube_link') AND public.normalize_restaurant_identity_name(r.approved_name)=public.normalize_restaurant_identity_name(row_value->>'approved_name')) THEN RAISE EXCEPTION 'RECORD_ACTION_DUPLICATE'; END IF;
   ELSIF row_value->>'status'='deleted' THEN RAISE EXCEPTION 'RECORD_ACTION_STATE_CONFLICT'; END IF;
   UPDATE public.restaurants SET status=CASE p_action WHEN 'restaurant.delete' THEN 'deleted' WHEN 'restaurant.restore' THEN 'pending' ELSE 'hold' END,
     updated_by_admin_id=p_actor,updated_at=clock_timestamp() WHERE id=target;
  END IF;
 ELSIF p_action LIKE 'submission.%' THEN
  SELECT to_jsonb(s) INTO row_value FROM public.restaurant_submissions s WHERE id=target;
  IF row_value->>'status' NOT IN ('pending','partially_approved') THEN RAISE EXCEPTION 'RECORD_ACTION_STATE_CONFLICT'; END IF;
  IF p_action='submission.edit' THEN
   changed:=p_payload->'changes';
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'itemChanges') x GROUP BY x->>'id' HAVING count(*)>1)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'itemChanges') x WHERE NOT EXISTS(SELECT 1 FROM public.restaurant_submission_items WHERE id=(x->>'id')::uuid AND submission_id=target AND item_status='pending'))
    THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
   UPDATE public.restaurant_submissions SET restaurant_name=changed->>'restaurant_name',restaurant_address=CASE WHEN changed ? 'restaurant_address' THEN changed->>'restaurant_address' ELSE restaurant_address END,
    restaurant_phone=CASE WHEN changed ? 'restaurant_phone' THEN changed->>'restaurant_phone' ELSE restaurant_phone END,restaurant_categories=ARRAY(SELECT jsonb_array_elements_text(changed->'restaurant_categories')),updated_at=clock_timestamp() WHERE id=target;
   FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'itemChanges') LOOP
    UPDATE public.restaurant_submission_items SET youtube_link=item->>'youtube_link',tzuyang_review=CASE WHEN item ? 'tzuyang_review' THEN item->>'tzuyang_review' ELSE tzuyang_review END WHERE id=(item->>'id')::uuid;
   END LOOP;
  ELSIF p_action='submission.approve' THEN
   IF row_value->>'submission_type' IS NULL OR row_value->>'submission_type' NOT IN ('new','edit') THEN RAISE EXCEPTION 'RECORD_ACTION_STATE_CONFLICT'; END IF;
   SELECT count(*) INTO pending_count FROM public.restaurant_submission_items WHERE submission_id=target AND item_status='pending';
   IF jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'items')<>pending_count OR pending_count=0
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'items') x GROUP BY x->>'id' HAVING count(*)>1)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'items') x WHERE x->>'decision' IS NULL OR x->>'decision' NOT IN ('approve','reject') OR NOT EXISTS(SELECT 1 FROM public.restaurant_submission_items WHERE id=(x->>'id')::uuid AND submission_id=target AND item_status='pending'))
    THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'items') ORDER BY value->>'id' LOOP
    IF item->>'decision'='approve' THEN
     SELECT target_restaurant_id INTO source_id FROM public.restaurant_submission_items WHERE id=(item->>'id')::uuid;
     IF row_value->>'submission_type'='new' AND source_id IS NOT NULL THEN RAISE EXCEPTION 'RECORD_ACTION_STATE_CONFLICT'; END IF;
     IF row_value->>'submission_type'='edit' THEN
      SELECT to_jsonb(r) INTO final_row FROM public.restaurants r WHERE id=source_id AND status<>'deleted';
      IF final_row IS NULL THEN RAISE EXCEPTION 'RECORD_ACTION_STATE_CONFLICT'; END IF;
     ELSE final_row:='{}'::jsonb; END IF;
     final_row:=pipeline_control.admin_record_compose(final_row,item->'changes');
     -- Preserve the existing submission URL canonicalization without a privileged helper call.
     final_row:=final_row||jsonb_build_object('youtube_link',CASE
      WHEN public.extract_youtube_video_id(final_row->>'youtube_link')<>'' THEN 'https://www.youtube.com/watch?v='||public.extract_youtube_video_id(final_row->>'youtube_link')
      ELSE nullif(btrim(final_row->>'youtube_link'),'') END);
     PERFORM pipeline_control.admin_record_validate_restaurant(final_row||jsonb_build_object('geocoding_success',true),ARRAY[source_id]);
     IF nullif(btrim(final_row->>'tzuyang_review'),'') IS NULL OR jsonb_typeof(final_row->'youtube_meta') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'RECORD_ACTION_EVIDENCE_REQUIRED'; END IF;
     -- Preserve the inherited fuzzy admission policy, but expose its actual domain reason rather than claiming stale CAS.
     IF EXISTS(SELECT 1 FROM public.restaurants r WHERE r.status<>'deleted' AND r.id IS DISTINCT FROM source_id AND
      ((public.extract_youtube_video_id(r.youtube_link)=public.extract_youtube_video_id(final_row->>'youtube_link') AND extensions.similarity(coalesce(r.approved_name,r.origin_name,''),final_row->>'approved_name')>0.8)
       OR extensions.similarity(coalesce(r.jibun_address,''),final_row->>'jibun_address')>0.9
       OR extensions.similarity(coalesce(r.road_address,''),coalesce(final_row->>'road_address',''))>0.9)) THEN RAISE EXCEPTION 'RECORD_ACTION_DUPLICATE_REVIEW'; END IF;
     -- Use the current-schema service invoker path in the same locked/audited operation.
     -- Edit approval retains existing status, missing marker, evaluation and provenance.
     IF row_value->>'submission_type'='edit' THEN
      PERFORM pipeline_control.admin_record_write(source_id,final_row||jsonb_build_object('geocoding_success',true),p_actor,false);
     ELSE
      -- Create parses a DTO; final_row already contains canonical metadata.
      source_id:=pipeline_control.admin_record_create((item->'changes')||jsonb_build_object('geocoding_success',true,'youtube_link',final_row->>'youtube_link'),p_actor);
      UPDATE public.restaurants SET source_type='user_submission_new',created_by=(row_value->>'user_id')::uuid WHERE id=source_id;
     END IF;
     UPDATE public.restaurant_submission_items SET item_status='approved',target_restaurant_id=source_id,rejection_reason=NULL
      WHERE id=(item->>'id')::uuid AND submission_id=target AND item_status='pending';
     IF NOT FOUND THEN RAISE EXCEPTION 'RECORD_ACTION_STATE_CONFLICT'; END IF;
    ELSE
     IF nullif(btrim(item->>'reason'),'') IS NULL THEN RAISE EXCEPTION 'RECORD_ACTION_INVALID_PAYLOAD'; END IF;
     UPDATE public.restaurant_submission_items SET item_status='rejected',rejection_reason=item->>'reason'
      WHERE id=(item->>'id')::uuid AND submission_id=target AND item_status='pending';
     IF NOT FOUND THEN RAISE EXCEPTION 'RECORD_ACTION_STATE_CONFLICT'; END IF;
    END IF;
   END LOOP;
  ELSE
   UPDATE public.restaurant_submission_items SET item_status='rejected',rejection_reason=p_payload->>'reason' WHERE submission_id=target AND item_status='pending';
  END IF;
  IF p_action<>'submission.edit' THEN
   UPDATE public.restaurant_submissions SET status=(CASE
    WHEN EXISTS(SELECT 1 FROM public.restaurant_submission_items WHERE submission_id=target AND item_status='pending') THEN 'pending'
    WHEN NOT EXISTS(SELECT 1 FROM public.restaurant_submission_items WHERE submission_id=target AND item_status='approved') THEN 'rejected'
    WHEN EXISTS(SELECT 1 FROM public.restaurant_submission_items WHERE submission_id=target AND item_status='rejected') THEN 'partially_approved' ELSE 'approved' END)::public.submission_status,
    resolved_by_admin_id=p_actor,reviewed_at=clock_timestamp(),admin_notes=coalesce(p_payload->>'note',admin_notes),
    rejection_reason=CASE WHEN p_action IN ('submission.reject','submission.delete') THEN p_payload->>'reason' ELSE rejection_reason END,updated_at=clock_timestamp() WHERE id=target;
  END IF;
 ELSIF p_action LIKE 'review.%' THEN
  SELECT to_jsonb(r) INTO row_value FROM public.reviews r WHERE id=target;
  IF p_action='review.delete' THEN
   FOR photo IN SELECT value FROM jsonb_array_elements_text(coalesce(row_value->'food_photos','[]'::jsonb)||jsonb_build_array(row_value->>'verification_photo')) LOOP
    IF coalesce(photo,'')<>'' THEN
     -- Only the existing owner's immutable upload prefix, never URLs or traversal.
     IF photo !~ ('^'||(row_value->>'user_id')||'/reviews/'||target||'/(verification|food)/[A-Za-z0-9][A-Za-z0-9._-]{0,239}\.(avif|jpe?g|png|webp)$') OR length(photo)>1024 THEN
      UPDATE pipeline_control.admin_record_operations SET cleanup_blocked=true WHERE id=op.id; op.cleanup_blocked:=true; CONTINUE;
     END IF;
     IF EXISTS(SELECT 1 FROM public.reviews r WHERE id<>target AND (verification_photo=photo OR photo=ANY(food_photos))) THEN
      UPDATE pipeline_control.admin_record_operations SET cleanup_blocked=true WHERE id=op.id; op.cleanup_blocked:=true; CONTINUE; END IF;
     PERFORM pg_advisory_xact_lock(hashtextextended('review-photo:'||photo,0));
     INSERT INTO pipeline_control.admin_record_media_cleanup(operation_id,bucket,object_name,object_fingerprint)
      VALUES(op.id,'review-photos',photo,pipeline_control.admin_record_storage_snapshot(photo)) ON CONFLICT DO NOTHING;
    END IF;
   END LOOP;
   DELETE FROM public.reviews WHERE id=target;
  ELSE
   UPDATE public.reviews SET is_verified=p_action='review.approve',admin_note=CASE WHEN p_action='review.reject' THEN '거부: '||(p_payload->>'reason') ELSE p_payload->>'note' END,
    is_edited_by_admin=true,edited_by_admin_id=p_actor,edited_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=target;
  END IF;
  UPDATE public.restaurants SET review_count=(SELECT count(*) FROM public.reviews WHERE restaurant_id=(row_value->>'restaurant_id')::uuid),updated_at=clock_timestamp() WHERE id=(row_value->>'restaurant_id')::uuid;
 ELSIF p_action LIKE 'recommendation.%' THEN
  SELECT to_jsonb(r) INTO row_value FROM public.restaurant_requests r WHERE id=target;
  IF row_value->>'status'<>'pending' THEN RAISE EXCEPTION 'RECORD_ACTION_STATE_CONFLICT'; END IF;
  -- Keep the existing domain audit identity but do not duplicate free text into audit.
  INSERT INTO public.restaurant_request_review_audit(id,request_id,admin_user_id,action,before_status,after_status)
   VALUES(audit,target,p_actor,split_part(p_action,'.',2),'pending',CASE WHEN p_action='recommendation.approve' THEN 'approved' ELSE 'rejected' END);
  UPDATE public.restaurant_requests SET status=CASE WHEN p_action='recommendation.approve' THEN 'approved' ELSE 'rejected' END,
   reviewed_by_admin_id=p_actor,reviewed_at=clock_timestamp(),admin_note=p_payload->>'note',
   rejection_reason=CASE WHEN p_action='recommendation.reject' THEN p_payload->>'reason' ELSE NULL END,review_audit_id=audit,updated_at=clock_timestamp() WHERE id=target;
 END IF;
 IF p_action='review.delete' THEN
  after_state:=fingerprint-('review:'||target);
  SELECT pipeline_control.admin_record_hash(to_jsonb(r)) INTO classification FROM public.restaurants r WHERE id=(row_value->>'restaurant_id')::uuid;
  after_state:=after_state||jsonb_build_object('restaurant:'||(row_value->>'restaurant_id'),classification,'review:'||target,NULL);
 ELSIF p_action='restaurant.merge' THEN
  SELECT array_agg(split_part(key,':',2)::uuid) INTO related_ids FROM jsonb_object_keys(fingerprint) key;
  after_state:=pipeline_control.admin_record_snapshot('restaurant.edit',related_ids);
 ELSE after_state:=pipeline_control.admin_record_snapshot(p_action,ids); END IF;
 INSERT INTO pipeline_control.admin_record_audit(id,operation_id,actor,action,target_ids,payload_sha,before_fingerprints,after_fingerprints)
  VALUES(audit,op.id,p_actor,p_action,ids,digest,fingerprint,after_state);
 receipt:=op.receipt||jsonb_build_object('state','applied','auditId',audit,'targetIds',ids,
  'readback',pipeline_control.admin_record_readback(after_state),
  'mediaCleanupUnmanaged',op.cleanup_blocked,'mediaCleanupPending',EXISTS(SELECT 1 FROM pipeline_control.admin_record_media_cleanup WHERE operation_id=op.id AND state<>'done'));
 UPDATE pipeline_control.admin_record_operations SET state='applied',receipt=work.receipt WHERE id=op.id;
 RETURN receipt;
EXCEPTION WHEN unique_violation THEN
 GET STACKED DIAGNOSTICS conflict_constraint=CONSTRAINT_NAME;
 -- Only reviewed restaurant identity constraints become a definite conflict.
 -- Other 23505 failures retain their original error and never claim success.
 IF conflict_constraint=ANY(ARRAY['idx_restaurants_active_candidate_identity','idx_restaurants_active_video_identity','restaurants_trace_id_key','restaurants_duplicate_duplicate_trace_id_key']) THEN
  RAISE EXCEPTION 'RECORD_ACTION_DUPLICATE' USING ERRCODE='P0001';
 END IF;
 RAISE;
END $$;

REVOKE ALL ON FUNCTION pipeline_control.admin_record_create(jsonb,uuid),pipeline_control.admin_record_readback(jsonb),pipeline_control.admin_record_hash(jsonb),pipeline_control.admin_record_snapshot(text,uuid[]),
 pipeline_control.admin_record_compose(jsonb,jsonb),pipeline_control.admin_record_identity_check(jsonb,uuid[]),pipeline_control.admin_record_write(uuid,jsonb,uuid,boolean),
 pipeline_control.admin_record_validate_restaurant(jsonb,uuid[]),pipeline_control.admin_record_patch(uuid,jsonb,uuid,boolean),
 public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION pipeline_control.admin_record_create(jsonb,uuid),pipeline_control.admin_record_readback(jsonb),pipeline_control.admin_record_hash(jsonb),pipeline_control.admin_record_snapshot(text,uuid[]),
 pipeline_control.admin_record_compose(jsonb,jsonb),pipeline_control.admin_record_identity_check(jsonb,uuid[]),pipeline_control.admin_record_write(uuid,jsonb,uuid,boolean),
 pipeline_control.admin_record_validate_restaurant(jsonb,uuid[]),pipeline_control.admin_record_patch(uuid,jsonb,uuid,boolean),
 public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text) TO service_role;
-- G014 registration follows below, in this same transaction.
DO $registration$
DECLARE before_members jsonb; after_members jsonb; temporary_grant boolean:=false; helper oid;
BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres' THEN RAISE EXCEPTION 'RECORD_ACTION_REGISTRATION_EXECUTOR'; END IF;
 SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) INTO before_members FROM pg_auth_members m;
 IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) THEN
  IF current_setting('server_version_num')::int/10000<>17 OR pg_has_role('postgres','privacy_workflow_owner','SET')
    OR pg_has_role('postgres','privacy_workflow_owner','USAGE')
    OR NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE roleid='privacy_workflow_owner'::regrole AND member='postgres'::regrole AND admin_option AND NOT inherit_option AND NOT set_option)
    THEN RAISE EXCEPTION 'RECORD_ACTION_REGISTRATION_MEMBERSHIP'; END IF;
  EXECUTE 'GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres';
  temporary_grant:=true;
 END IF;
 IF to_regprocedure('pg_temp.admin_record_registration()') IS NOT NULL THEN RAISE EXCEPTION 'RECORD_ACTION_REGISTRATION_HELPER'; END IF;
 EXECUTE 'SET LOCAL ROLE privacy_workflow_owner';
 EXECUTE $definition$
 CREATE FUNCTION pg_temp.admin_record_registration() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
 DECLARE name text; target oid; definition text; source text; metadata jsonb; expected text[]; rewritten text;
  anchor text:=$anchor$      'public.restaurant_review_automation_status()',$anchor$;
  signature text:='public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)';
 BEGIN
  IF session_user<>'postgres' OR current_user<>'privacy_workflow_owner' THEN RAISE EXCEPTION 'RECORD_ACTION_REGISTRATION_EXECUTOR'; END IF;
  FOREACH name IN ARRAY ARRAY['definer','catalog'] LOOP
   target:=to_regprocedure('privacy_retention.assert_g014_'||name||'_contract()');
   -- Exact fresh PG15+warning branch and actual PG17 nonce-bound hosted branch.
   expected:=CASE WHEN name='definer' THEN ARRAY['f3fe7e01b85da1718b91ff0439e204b2c07f9795b6bda720b277a50e56eb51d8','a5fff8ca63e34d41fc7c56e5a646023d44645750a7abf9ae0c0efc35818aa964']
    ELSE ARRAY['06076b2296e9cf2cef9748ef43390a7805fe90c0a9145f96e9fed8ff62f9f330','8e9101ecdbb506e25a9ace2a40f7de9cc0dcf3f06d80cc1a75fe07a55effbeab'] END;
   SELECT pg_get_functiondef(p.oid),prosrc,to_jsonb(p)-'prosrc' INTO definition,source,metadata FROM pg_proc p
    WHERE oid=target AND proowner='privacy_workflow_owner'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']::text[];
   IF definition IS NULL OR NOT(encode(sha256(convert_to(source,'UTF8')),'hex')=ANY(expected))
    OR (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'RECORD_ACTION_REGISTRATION_SOURCE_DRIFT'; END IF;
   rewritten:=replace(source,anchor,'      '''||signature||''','||chr(10)||anchor);
   EXECUTE replace(definition,source,rewritten);
   IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=target) IS DISTINCT FROM metadata
    OR (SELECT prosrc FROM pg_proc WHERE oid=target) IS DISTINCT FROM rewritten THEN RAISE EXCEPTION 'RECORD_ACTION_REGISTRATION_METADATA_DRIFT'; END IF;
  END LOOP;
  INSERT INTO privacy_retention.g014_public_rpc_allowlist(function_schema,function_name,identity_arguments,grantee,source_signature)
   SELECT n.nspname,p.proname,p.proargtypes::text,'service_role',signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=to_regprocedure(signature);
  -- Additive phase: preserve the three exact legacy browser-admin entrances.
  -- Authenticated retirement follows only a separately reviewed consumer cutover.
  FOREACH signature IN ARRAY ARRAY[
   'public.approve_submission_item(uuid,uuid,jsonb)',
   'public.approve_edit_submission_item(uuid,uuid,jsonb)',
   'public.merge_restaurant_records_for_admin_review(uuid,uuid,uuid,timestamptz,text,jsonb,text,text)'] LOOP
   target:=to_regprocedure(signature);
   SELECT to_jsonb(p) INTO metadata FROM pg_proc p WHERE oid=target AND proowner='privacy_workflow_owner'::regrole
    AND prosecdef AND proconfig=ARRAY['search_path=""']::text[];
   IF metadata IS NULL OR NOT has_function_privilege('authenticated',target,'EXECUTE') OR NOT has_function_privilege('service_role',target,'EXECUTE')
    OR (SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature=signature AND grantee='authenticated')<>1
    THEN RAISE EXCEPTION 'RECORD_ACTION_LEGACY_RPC_DRIFT'; END IF;
   IF (SELECT to_jsonb(p) FROM pg_proc p WHERE oid=target) IS DISTINCT FROM metadata
    OR NOT has_function_privilege('authenticated',target,'EXECUTE') OR NOT has_function_privilege('service_role',target,'EXECUTE')
    THEN RAISE EXCEPTION 'RECORD_ACTION_LEGACY_RPC_DRIFT'; END IF;
  END LOOP;
  -- No owner/ACL/lookup-path changes to either assertion. Their actual bodies remain authoritative.
  PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
  PERFORM privacy_retention.assert_g014_definer_contract();
  DROP FUNCTION pg_temp.admin_record_registration();
 END $body$;
 $definition$;
 EXECUTE 'REVOKE ALL ON FUNCTION pg_temp.admin_record_registration() FROM PUBLIC,anon,authenticated,service_role';
 EXECUTE 'GRANT EXECUTE ON FUNCTION pg_temp.admin_record_registration() TO postgres';
 EXECUTE 'RESET ROLE';
 IF temporary_grant THEN EXECUTE 'REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres'; END IF;
 SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) INTO after_members FROM pg_auth_members m;
 IF after_members IS DISTINCT FROM before_members THEN RAISE EXCEPTION 'RECORD_ACTION_REGISTRATION_MEMBERSHIP_DRIFT'; END IF;
 helper:=to_regprocedure('pg_temp.admin_record_registration()');
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE oid=helper AND proowner='privacy_workflow_owner'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']::text[]
  AND (SELECT count(*) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))))=2
  AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee NOT IN ('privacy_workflow_owner'::regrole,'postgres'::regrole) OR a.is_grantable))
  THEN RAISE EXCEPTION 'RECORD_ACTION_REGISTRATION_HELPER'; END IF;
 PERFORM pg_temp.admin_record_registration();
 IF to_regprocedure('pg_temp.admin_record_registration()') IS NOT NULL THEN RAISE EXCEPTION 'RECORD_ACTION_REGISTRATION_HELPER'; END IF;
END $registration$;
NOTIFY pgrst,'reload schema';

-- Canonical source 20261004192657_admin_evaluation_raw_warning_groups.sql
-- Forward-only: preserve raw warning inputs; JS remains the classifier.
-- Apply atomically. No restaurant row is changed by the index repair.
LOCK TABLE public.restaurants IN SHARE ROW EXCLUSIVE MODE;
CREATE OR REPLACE FUNCTION pipeline_control.admin_eval_video_id(value text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT coalesce(
  substring(value COLLATE "C" FROM '[?&]v=([A-Za-z0-9_-]{6,128})(?![A-Za-z0-9_-])'),
  substring(value COLLATE "C" FROM 'youtu\.be/([A-Za-z0-9_-]{6,128})(?![A-Za-z0-9_-])'),
  substring(value COLLATE "C" FROM 'youtube\.com/shorts/([A-Za-z0-9_-]{6,128})(?![A-Za-z0-9_-])'),
  substring(value COLLATE "C" FROM 'youtube\.com/embed/([A-Za-z0-9_-]{6,128})(?![A-Za-z0-9_-])'),
  substring(value COLLATE "C" FROM 'youtube\.com/live/([A-Za-z0-9_-]{6,128})(?![A-Za-z0-9_-])'));
$$;
UPDATE pipeline_control.admin_evaluation_read_index idx
 SET video=fixed.video,
 descriptor=jsonb_set(idx.descriptor,'{video}',coalesce(to_jsonb(fixed.video),'null'::jsonb))
 FROM (SELECT id,pipeline_control.admin_eval_video_id(youtube_link) video FROM public.restaurants) fixed
 WHERE idx.id=fixed.id AND (idx.video IS DISTINCT FROM fixed.video
  OR idx.descriptor->'video' IS DISTINCT FROM coalesce(to_jsonb(fixed.video),'null'::jsonb));
UPDATE pipeline_control.admin_evaluation_catalog_revision SET revision=revision+1 WHERE singleton;

-- Exact SQL order; the older descriptor index deliberately truncates to JS ms
-- and therefore cannot be used for this transport cursor.
CREATE INDEX admin_evaluation_warning_source_order ON public.restaurants(created_at DESC NULLS FIRST,id ASC);
CREATE FUNCTION public.admin_evaluation_raw_warning_groups(
 page_ids uuid[], expected_revision text, after_cursor jsonb DEFAULT NULL, batch_size integer DEFAULT 1000
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE
 current_revision text; videos text[]; payload jsonb; input_bytes bigint; largest_row integer;
 total_rows integer; total_groups integer; codec text; sorted_ids jsonb; after_order integer:=0;
 boundary_id uuid; boundary_created timestamptz; actual_offset integer;

BEGIN
 current_revision:=public.admin_evaluation_revision();
 IF expected_revision IS NULL OR expected_revision !~ '^[0-9]{1,20}$'
  OR page_ids IS NULL OR cardinality(page_ids) NOT BETWEEN 1 AND 200
  OR EXISTS(SELECT 1 FROM unnest(page_ids) id WHERE id IS NULL)
  OR (SELECT count(DISTINCT id) FROM unnest(page_ids) id)<>cardinality(page_ids)
  OR batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 1000 THEN
  RAISE EXCEPTION 'EVALUATION_QUERY_INVALID';
 END IF;
 IF current_revision IS DISTINCT FROM expected_revision THEN RAISE EXCEPTION 'EVALUATION_CURSOR_STALE'; END IF;
 IF (SELECT count(*) FROM (SELECT 1 FROM public.restaurants LIMIT 50001) counted)>50000 THEN
  RAISE EXCEPTION 'EVALUATION_WARNING_RAW_CAPACITY_EXCEEDED';
 END IF;
 IF (SELECT count(*) FROM pipeline_control.admin_evaluation_read_index WHERE id=ANY(page_ids))<>cardinality(page_ids) THEN
  RAISE EXCEPTION 'EVALUATION_RECORDS_UNAVAILABLE';
 END IF;
 SELECT array_agg(DISTINCT video) FILTER(WHERE video IS NOT NULL) INTO videos
 FROM pipeline_control.admin_evaluation_read_index WHERE id=ANY(page_ids);
 SELECT jsonb_agg(id ORDER BY id) INTO sorted_ids FROM unnest(page_ids) id;
 SELECT count(*) INTO total_rows FROM pipeline_control.admin_evaluation_read_index WHERE video=ANY(videos);
 IF after_cursor IS NULL THEN
  -- Small catalogs never pay grouping cost. All permitted raw attributes are
  -- retained in positional tuples; field order is versioned by codecVersion.
  IF total_rows<=200 THEN codec:='flat';
  ELSE
   -- Plan only on the first data request. Binary canonical JSON equality is
   -- lossless; this is transport compression, not a warning classifier.
   SELECT count(DISTINCT attrs COLLATE "C"),coalesce(sum(octet_length(attrs)),0),coalesce(max(octet_length(attrs)),0)
   INTO total_groups,input_bytes,largest_row
   FROM (SELECT (to_jsonb(r)-ARRAY['id','created_at','video_id'])::text attrs
    FROM public.admin_evaluation_related_rows r WHERE video_id=ANY(videos)) projected;
   IF input_bytes>67108864 OR largest_row>1048576 THEN
    RAISE EXCEPTION 'EVALUATION_WARNING_RAW_CAPACITY_EXCEEDED';
   END IF;
   -- Conservative admission: at most 1% unique and at most 200 groups.
   -- The flat codec is exact for every other admitted dataset.
   codec:=CASE WHEN total_groups<=200 AND total_groups*100<=total_rows THEN 'grouped' ELSE 'flat' END;
  END IF;
 ELSE
  IF jsonb_typeof(after_cursor)<>'object' OR after_cursor->>'revision' IS DISTINCT FROM current_revision
   OR after_cursor->'pageIds' IS DISTINCT FROM sorted_ids
   OR coalesce(after_cursor->>'mode','') NOT IN ('flat','grouped')
   OR after_cursor->>'totalRows' IS DISTINCT FROM total_rows::text
   OR coalesce(after_cursor->>'offset','') !~ '^[0-9]{1,5}$'
   OR coalesce(after_cursor->>'afterId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   OR NOT after_cursor ? 'afterCreated' THEN RAISE EXCEPTION 'EVALUATION_QUERY_INVALID'; END IF;
  codec:=after_cursor->>'mode'; after_order:=(after_cursor->>'offset')::integer;
  boundary_id:=(after_cursor->>'afterId')::uuid;
  -- Resolve the boundary from the database; never parse a client timestamp
  -- through Date or trust a cursor's claimed row order/membership.
  SELECT r.created_at INTO boundary_created FROM public.restaurants r
   JOIN pipeline_control.admin_evaluation_read_index i USING(id)
   WHERE r.id=boundary_id AND i.video=ANY(videos);
  IF NOT FOUND OR to_jsonb(boundary_created) IS DISTINCT FROM nullif(after_cursor->'afterCreated','null'::jsonb)
   THEN RAISE EXCEPTION 'EVALUATION_QUERY_INVALID'; END IF;
  SELECT count(*) INTO actual_offset FROM public.restaurants r
   JOIN pipeline_control.admin_evaluation_read_index i USING(id) WHERE i.video=ANY(videos) AND
    (CASE WHEN boundary_created IS NULL THEN r.created_at IS NULL AND r.id<=boundary_id
     ELSE r.created_at IS NULL OR r.created_at>boundary_created OR (r.created_at=boundary_created AND r.id<=boundary_id) END);
  IF after_order<>actual_offset OR after_order NOT BETWEEN 1 AND total_rows
   THEN RAISE EXCEPTION 'EVALUATION_QUERY_INVALID'; END IF;
 END IF;
 IF codec='grouped' AND after_cursor IS NOT NULL THEN
  SELECT coalesce(sum(bytes),0),coalesce(max(bytes),0) INTO input_bytes,largest_row
   FROM (SELECT octet_length((to_jsonb(r)-ARRAY['id','created_at','video_id'])::text) bytes
    FROM public.admin_evaluation_related_rows r WHERE video_id=ANY(videos)) sized;
  IF input_bytes>67108864 OR largest_row>1048576 THEN RAISE EXCEPTION 'EVALUATION_WARNING_RAW_CAPACITY_EXCEEDED'; END IF;
 END IF;
 IF codec='flat' THEN
  -- Bound the candidate materialization even for a fabricated service cursor.
  -- Size aggregation streams; it does not retain 1000 oversized JSON values.
  WITH keys AS MATERIALIZED (
   SELECT r.id FROM public.restaurants r JOIN pipeline_control.admin_evaluation_read_index i USING(id)
    WHERE i.video=ANY(videos) AND (after_cursor IS NULL OR
     CASE WHEN boundary_created IS NULL THEN r.created_at IS NOT NULL OR r.id>boundary_id
      ELSE r.created_at<boundary_created OR (r.created_at=boundary_created AND r.id>boundary_id) END)
    ORDER BY r.created_at DESC NULLS FIRST,r.id ASC LIMIT CASE WHEN total_rows<=200 THEN 200 ELSE batch_size END
  ) SELECT coalesce(sum(bytes),0),coalesce(max(bytes),0) INTO input_bytes,largest_row
   FROM (SELECT octet_length(to_jsonb(r)::text) bytes FROM keys JOIN public.admin_evaluation_related_rows r USING(id)) sized;
  IF input_bytes>67108864 OR largest_row>1048576 THEN RAISE EXCEPTION 'EVALUATION_WARNING_RAW_CAPACITY_EXCEEDED'; END IF;
  WITH keys AS MATERIALIZED (
   SELECT r.id,r.created_at FROM public.restaurants r JOIN pipeline_control.admin_evaluation_read_index i USING(id)
    WHERE i.video=ANY(videos) AND (after_cursor IS NULL OR
     CASE WHEN boundary_created IS NULL THEN r.created_at IS NOT NULL OR r.id>boundary_id
      ELSE r.created_at<boundary_created OR (r.created_at=boundary_created AND r.id>boundary_id) END)
    ORDER BY r.created_at DESC NULLS FIRST,r.id ASC LIMIT CASE WHEN total_rows<=200 THEN 200 ELSE batch_size END
  ), items AS MATERIALIZED (
   SELECT k.id,k.created_at,row_number() OVER(ORDER BY k.created_at DESC NULLS FIRST,k.id ASC)::integer+after_order AS ord,
    jsonb_build_array(r.id,r.created_at,r.video_id,r.approved_name,r.origin_name,r.naver_name,r.google_name,
     r.phone,r.status,r.road_address,r.jibun_address,r.youtube_link,r.updated_by_admin_id,r.lat,r.lng,r.evaluation_results,r.name) AS item
   FROM keys k JOIN public.admin_evaluation_related_rows r USING(id)
  ), packed AS (
   SELECT *,sum(octet_length(item::text)+2) OVER(ORDER BY ord) bytes FROM items
  ), selected AS MATERIALIZED (SELECT * FROM packed WHERE bytes<=2097152-16384)
  SELECT jsonb_build_object('codecVersion',1,'mode','flat','revision',current_revision,'pageIds',sorted_ids,
   'totalRows',total_rows,'rowOffset',after_order,'tuples',coalesce((SELECT jsonb_agg(item ORDER BY ord) FROM selected),'[]'::jsonb),
   'hasMore',coalesce((SELECT max(ord) FROM selected),after_order)<total_rows,
   'cursor',(SELECT jsonb_build_object('revision',current_revision,'pageIds',sorted_ids,'mode','flat','totalRows',total_rows,
    'offset',ord,'afterId',id,'afterCreated',created_at) FROM selected ORDER BY ord DESC LIMIT 1),
   'largestRow',coalesce((SELECT max(octet_length(item::text)) FROM items),0)) INTO payload;
  IF (payload->>'largestRow')::integer>1048576 OR octet_length(payload::text)>2097152
   OR (payload->>'hasMore'='true' AND (payload->'tuples'='[]'::jsonb OR total_rows<=200)) THEN
   RAISE EXCEPTION 'EVALUATION_WARNING_RAW_CAPACITY_EXCEEDED';
  END IF;
  RETURN payload-'largestRow';
 END IF;
 WITH ordered AS MATERIALIZED (
  SELECT id, (to_jsonb(r)-ARRAY['id','created_at','video_id'])::text COLLATE "C" AS attrs_key,
   row_number() OVER(ORDER BY created_at DESC,id ASC)::integer AS source_order
  FROM public.admin_evaluation_related_rows r WHERE video_id=ANY(videos)
 ), ranked AS (
  SELECT *,row_number() OVER(PARTITION BY attrs_key ORDER BY source_order) AS sample_rank FROM ordered
 ), grouped AS MATERIALIZED (
  -- No hash-only identity and no linguistic collation: byte-identical raw JSON.
  SELECT attrs_key,min(source_order) AS first_order,count(*)::integer AS row_count,
   array_agg(id ORDER BY id) FILTER(WHERE id=ANY(page_ids)) AS self_ids,
   array_agg(id ORDER BY source_order) FILTER(WHERE sample_rank<=4) AS sample_ids,
   array_agg(source_order ORDER BY source_order) FILTER(WHERE sample_rank<=4) AS sample_orders
  FROM ranked GROUP BY attrs_key
 ), candidates AS MATERIALIZED (
  SELECT * FROM grouped WHERE first_order>after_order ORDER BY first_order LIMIT batch_size
 ), items AS (
  -- Serialize only the bounded candidate batch, not all G groups on every
  -- request. Counts/offsets use the compact relational aggregate above.
  SELECT first_order,jsonb_build_object('attrs',attrs_key::jsonb,'count',row_count,'firstOrder',first_order,
   'selfIds',coalesce(to_jsonb(self_ids),'[]'::jsonb),
   'samples',(SELECT jsonb_agg(jsonb_build_object('id',id,'sourceOrder',source_order) ORDER BY source_order)
     FROM unnest(sample_ids,sample_orders) AS samples(id,source_order))) AS item FROM candidates
 ), packed AS (
  SELECT *,sum(octet_length(item::text)+2) OVER(ORDER BY first_order) AS bytes FROM items
 ), selected AS MATERIALIZED (
  SELECT * FROM packed WHERE bytes<=2097152-16384
 )
 SELECT jsonb_build_object('codecVersion',1,'mode','grouped','revision',current_revision,
  'pageIds',(SELECT jsonb_agg(id ORDER BY id) FROM unnest(page_ids) id),
  'totalRows',(SELECT count(*) FROM ordered),'totalGroups',(SELECT count(*) FROM grouped),
  'groupOffset',(SELECT count(*) FROM grouped WHERE first_order<=after_order),
  'rowOffset',coalesce((SELECT sum(row_count) FROM grouped WHERE first_order<=after_order),0),
  'cursorValid',after_order=0 OR EXISTS(SELECT 1 FROM grouped WHERE first_order=after_order),
  'groups',coalesce((SELECT jsonb_agg(item ORDER BY first_order) FROM selected),'[]'::jsonb),
  'hasMore',EXISTS(SELECT 1 FROM grouped WHERE first_order>coalesce((SELECT max(first_order) FROM selected),after_order)),
  'nextAfterOrder',coalesce((SELECT max(first_order) FROM selected),after_order)) INTO payload;
 IF (payload->>'totalGroups')::integer>200 OR (payload->>'totalGroups')::integer*100>total_rows THEN RAISE EXCEPTION 'EVALUATION_QUERY_INVALID'; END IF;
 IF payload->>'cursorValid'<>'true' THEN RAISE EXCEPTION 'EVALUATION_QUERY_INVALID'; END IF;
 payload:=payload-'cursorValid';
 SELECT payload||jsonb_build_object('cursor',jsonb_build_object('revision',current_revision,'pageIds',sorted_ids,'mode','grouped',
  'totalRows',total_rows,'offset',payload->'nextAfterOrder','afterId',r.id,'afterCreated',r.created_at)) INTO payload
 FROM public.restaurants r JOIN pipeline_control.admin_evaluation_read_index i USING(id) WHERE i.video=ANY(videos)
 ORDER BY r.created_at DESC NULLS FIRST,r.id ASC OFFSET ((payload->>'nextAfterOrder')::integer-1) LIMIT 1;
 IF octet_length(payload::text)>2097152 OR (payload->>'hasMore'='true' AND payload->'groups'='[]'::jsonb) THEN
  RAISE EXCEPTION 'EVALUATION_WARNING_RAW_CAPACITY_EXCEEDED';
 END IF;
 RETURN payload;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer) TO service_role;
-- The immediately following invoker-contract migration registers the RPC as
-- privacy_workflow_owner, without granting permanent table/role privileges.

-- Canonical source 20261004194715_admin_evaluation_raw_warning_invoker_contract.sql
-- Register the raw read RPC in both exact-source G014 invoker assertions.
-- Requires the preceding raw function migration. No permanent role grant.
DO $raw_registration$
DECLARE before_members jsonb; after_members jsonb; temporary_grant boolean:=false; helper oid;
BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres' THEN RAISE EXCEPTION 'G014_RAW_EXECUTOR'; END IF;
 SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) INTO before_members FROM pg_auth_members m;
 IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) THEN
  IF current_setting('server_version_num')::int/10000<>17 OR pg_has_role('postgres','privacy_workflow_owner','SET')
   OR pg_has_role('postgres','privacy_workflow_owner','USAGE')
   OR NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole AND member='postgres'::regrole AND admin_option AND NOT inherit_option AND NOT set_option)
   THEN RAISE EXCEPTION 'G014_RAW_MEMBERSHIP'; END IF;
  EXECUTE 'GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres';
  temporary_grant:=true;
 END IF;
 IF to_regprocedure('pg_temp.admin_raw_warning_registration()') IS NOT NULL THEN RAISE EXCEPTION 'G014_RAW_HELPER'; END IF;
 EXECUTE 'SET LOCAL ROLE privacy_workflow_owner';
 EXECUTE $definition$
 CREATE FUNCTION pg_temp.admin_raw_warning_registration() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
 DECLARE name text; target oid; definition text; source text; admitted text; metadata jsonb; expected text[]; rewritten text;
  anchor text:=$anchor$      'public.restaurant_review_automation_status()',$anchor$;
  record_addition text:=$record_addition$      'public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)',
$record_addition$;
  addition text:=$addition$      'public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer)',
$addition$;
  signature text:='public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer)';
 BEGIN
  IF session_user<>'postgres' OR current_user<>'privacy_workflow_owner' THEN RAISE EXCEPTION 'G014_RAW_EXECUTOR'; END IF;
  IF EXISTS(SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature=signature) THEN RAISE EXCEPTION 'G014_RAW_ALLOWLIST_DRIFT'; END IF;
  FOREACH name IN ARRAY ARRAY['definer','catalog'] LOOP
   target:=to_regprocedure('privacy_retention.assert_g014_'||name||'_contract()');
   expected:=CASE WHEN name='definer' THEN ARRAY['f3fe7e01b85da1718b91ff0439e204b2c07f9795b6bda720b277a50e56eb51d8','a5fff8ca63e34d41fc7c56e5a646023d44645750a7abf9ae0c0efc35818aa964']
    ELSE ARRAY['06076b2296e9cf2cef9748ef43390a7805fe90c0a9145f96e9fed8ff62f9f330','8e9101ecdbb506e25a9ace2a40f7de9cc0dcf3f06d80cc1a75fe07a55effbeab'] END;
   SELECT pg_get_functiondef(p.oid),prosrc,to_jsonb(p)-'prosrc' INTO definition,source,metadata FROM pg_proc p
    WHERE oid=target AND proowner='privacy_workflow_owner'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']::text[];
   -- Also admit the separate, exact one-line record-action extension. The
   -- real source is never stripped; this only checks its known preimage hash.
   admitted:=source;
   IF strpos(source,record_addition)>0 THEN
    IF (length(source)-length(replace(source,record_addition||anchor,'')))/length(record_addition||anchor)<>1 THEN RAISE EXCEPTION 'G014_RAW_SOURCE_DRIFT'; END IF;
    admitted:=replace(source,record_addition||anchor,anchor);
   END IF;
   IF definition IS NULL OR NOT(encode(sha256(convert_to(admitted,'UTF8')),'hex')=ANY(expected))
    OR (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 OR strpos(source,addition)>0 THEN RAISE EXCEPTION 'G014_RAW_SOURCE_DRIFT'; END IF;
   rewritten:=replace(source,anchor,addition||anchor);
   EXECUTE replace(definition,source,rewritten);
   IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=target) IS DISTINCT FROM metadata
    OR (SELECT prosrc FROM pg_proc WHERE oid=target) IS DISTINCT FROM rewritten THEN RAISE EXCEPTION 'G014_RAW_METADATA_DRIFT'; END IF;
  END LOOP;
  INSERT INTO privacy_retention.g014_public_rpc_allowlist(function_schema,function_name,identity_arguments,grantee,source_signature)
   SELECT n.nspname,p.proname,p.proargtypes::text,'service_role',signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=to_regprocedure(signature);
  PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
  PERFORM privacy_retention.assert_g014_definer_contract();
  DROP FUNCTION pg_temp.admin_raw_warning_registration();
 END $body$;
 $definition$;
 EXECUTE 'REVOKE ALL ON FUNCTION pg_temp.admin_raw_warning_registration() FROM PUBLIC,anon,authenticated,service_role';
 EXECUTE 'GRANT EXECUTE ON FUNCTION pg_temp.admin_raw_warning_registration() TO postgres';
 EXECUTE 'RESET ROLE';
 IF temporary_grant THEN EXECUTE 'REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres'; END IF;
 SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) INTO after_members FROM pg_auth_members m;
 IF after_members IS DISTINCT FROM before_members THEN RAISE EXCEPTION 'G014_RAW_MEMBERSHIP_DRIFT'; END IF;
 helper:=to_regprocedure('pg_temp.admin_raw_warning_registration()');
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE oid=helper AND proowner='privacy_workflow_owner'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']::text[]
  AND (SELECT count(*) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))))=2
  AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee NOT IN ('privacy_workflow_owner'::regrole,'postgres'::regrole) OR a.is_grantable))
  THEN RAISE EXCEPTION 'G014_RAW_HELPER'; END IF;
 PERFORM pg_temp.admin_raw_warning_registration();
 IF to_regprocedure('pg_temp.admin_raw_warning_registration()') IS NOT NULL THEN RAISE EXCEPTION 'G014_RAW_HELPER'; END IF;
END $raw_registration$;
NOTIFY pgrst,'reload schema';

-- Canonical source 20261008192455_review_media_commit_cleanup.sql
-- Atomic review commit receipts and durable, owner-scoped media cleanup.
-- No scheduler is installed. The authenticated MY/review UI drains this queue.
-- Tombstones must survive successful cleanup: a delayed write must not revive a
-- deleted key. No retention period is introduced here.
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

-- Canonical source 20261008200719_review_verification_private.sql
-- Verification images are private; food photos retain their public contract.
-- Historical verification objects must be moved with the Storage API, followed
-- by metadata and public-denial readback. This DDL does not claim that transfer.
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

-- Canonical source 20261008201635_review_media_catalog_integration.sql
-- Integrate exactly the two preceding review-media sources into G014.
-- CLI 2.117.0 generated this new migration. No assertion body or immutable
-- manifest row is changed. Execute the complete transaction; do not split it.
SET LOCAL lock_timeout = '2s';
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tzudong:review-media-catalog:v1', 0));
CREATE TEMP TABLE review_media_expected (
  signature text PRIMARY KEY, body_sha256 text NOT NULL, final_body_sha256 text NOT NULL, definer boolean NOT NULL,
  volatility text NOT NULL, language text NOT NULL, result text NOT NULL, argument_names text[] NOT NULL
) ON COMMIT DROP;
INSERT INTO review_media_expected VALUES
    ('public.finish_review_media_cleanup()','f7e925a25dedb987a3166c5ca641ba7db1568a7583bdeca3cee04f27d9189f20','f6c4e71988ed2b789b887484af5fdf2e482bde98f1d1c5b5d4e7ad124c314bd1',true,'v','plpgsql','bigint',ARRAY[]::text[]),
    ('public.mutate_review_with_media(uuid,uuid,text,timestamp with time zone,text,text[],text[])','6f1450d4afaa7d3e9dcba3abb231de62aeb7c0a687cc2a9ceafbbe6dc2c2e413','50bfad7bc4fc7ddbc9d9379e8eb13facd938a15f66553576cc69fbcf69aa98b1',true,'v','plpgsql','text',ARRAY['p_operation_id','p_review_id','p_kind','p_expected_updated_at','p_content','p_categories','p_food_photos']::text[]),
    ('public.pending_review_media_cleanup()','21fa71446354fe855508550a3df78ddbe0ad4c1f7007ea905d04bdb98f1ac766','5a92c8f282c895eabaa77f8cf3f452fb659bac33bd519ed8cf439dc1f2905c7b',true,'v','plpgsql','TABLE(path text, owner_id uuid, review_id uuid, purpose text)',ARRAY[]::text[]),
    ('public.queue_review_upload_cleanup(uuid,text[])','00784e9daa9b6b707432200e4df6592010e9f22d2bc9db831bf8329e14bdb453','89c3b573891f598cac5df6ce9a3217639092801a7439ec0404f338f2097114a8',true,'v','plpgsql','text',ARRAY['p_review_id','p_paths']::text[]),
    ('public.read_review_media_commit(uuid,uuid,text)','c7d2e4e111223150ceeda5893310df0e9656e5930823db053135812a69222081','2f14abfc04864f369467f5ac5f0603defa149b8023d7e6b04e2bb8535f8a268e',true,'v','sql','text',ARRAY['p_operation_id','p_review_id','p_kind']::text[]),
    ('public.review_media_delete_allowed(text)','45fd396f240fb1d9fc084f31bd4feea7ee097017f2fd2b8d12df9c2c59152f78','a75dbd787dd388b0761bee11c82a56d5f410688e4cfd953181bce4d613062ae7',true,'v','plpgsql','boolean',ARRAY['p_path']::text[]),
    ('public.review_media_upload_allowed(text,text)','0a3d375685c5e3fd82721bd8033345c93031704c838a0a7f1b61ff248d9b6636','298c6a127f3a44a193b78be8c1f2577ab58aa34c772b66ccd53f774d807cc90c',true,'v','plpgsql','boolean',ARRAY['p_bucket','p_path']::text[]),
    ('review_media_private.canonical(text,uuid,uuid,text)','87d8397c36cf4c7b986f75cbc2788979333a76be2cc26dc5522cd362f62414a9','87d8397c36cf4c7b986f75cbc2788979333a76be2cc26dc5522cd362f62414a9',false,'i','sql','boolean',ARRAY['p_path','p_owner','p_review','p_purpose']::text[]),
    ('review_media_private.enqueue_removed()','7edb21d70ea3ff81ab90e13617e8c1c2749b54b1506f1ff42aaa6c5dc33f9e38','7edb21d70ea3ff81ab90e13617e8c1c2749b54b1506f1ff42aaa6c5dc33f9e38',true,'v','plpgsql','trigger',ARRAY[]::text[]),
    ('review_media_private.guard_references()','846030547ffd76e17596755d7eee4279dcb9b563361435260826071d2f250d59','846030547ffd76e17596755d7eee4279dcb9b563361435260826071d2f250d59',true,'v','plpgsql','trigger',ARRAY[]::text[]),
    ('review_media_private.lock_changes()','381d89aa6bbf5a59c2ee0fef2a7392ef705147252b324527201b8b6f74376250','381d89aa6bbf5a59c2ee0fef2a7392ef705147252b324527201b8b6f74376250',true,'v','plpgsql','trigger',ARRAY[]::text[]),
    ('review_media_private.owned_legacy(text,uuid,text)','a2d55f09f03fcaeedd77461198511673da7342a6a4873d37227f9cf612090980','a2d55f09f03fcaeedd77461198511673da7342a6a4873d37227f9cf612090980',false,'i','sql','boolean',ARRAY['p_path','p_owner','p_purpose']::text[]),
    ('review_media_private.reference_key(text)','a8910cb09bfd959951045e8b0b8233b1e2a8bdc45073abeebdfc26b552b1dae7','a8910cb09bfd959951045e8b0b8233b1e2a8bdc45073abeebdfc26b552b1dae7',false,'i','plpgsql','text',ARRAY['p_value']::text[]),
    ('review_media_private.referenced(text)','cc295115d85a3a11b380e1378e2ee91b0d9f7f587c68839653f54ed826c398ce','cc295115d85a3a11b380e1378e2ee91b0d9f7f587c68839653f54ed826c398ce',true,'v','sql','boolean',ARRAY['p_path']::text[]);
REVOKE ALL ON pg_temp.review_media_expected FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON pg_temp.review_media_expected TO privacy_workflow_owner;

DO $integration$
DECLARE
  v_expected record; v_function record; v_oid oid;
  v_owner oid := 'privacy_workflow_owner'::regrole;
  v_runner oid := 'postgres'::regrole;
  v_members jsonb; v_assertions jsonb; v_manifest jsonb; v_functions jsonb;
  v_known oid := (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='privacy_retention' AND p.proname='g014_catalog_protected_relations' AND p.pronargs=0);
  v_definition text;
  v_public jsonb;
  v_self jsonb; v_major integer := current_setting('server_version_num')::integer / 10000;
  v_pg15_lease boolean := false;
BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres' OR v_major NOT IN (15,17)
     OR current_setting('transaction_read_only') <> 'off'
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE oid=v_owner AND NOT rolsuper
         AND NOT rolbypassrls AND NOT rolcanlogin AND NOT rolinherit) THEN
    RAISE EXCEPTION 'review_media_catalog_executor_denied';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]')
    INTO v_members FROM pg_auth_members m;
  SELECT to_jsonb(n) INTO v_public FROM pg_namespace n WHERE nspname='public';
  IF NOT has_schema_privilege(v_owner,'public','CREATE') THEN
    RAISE EXCEPTION 'review_media_catalog_existing_public_create_missing';
  END IF;
  SELECT to_jsonb(m) INTO v_self FROM pg_auth_members m
    WHERE roleid=v_owner AND member=v_runner AND grantor=v_runner;
  IF v_self IS NOT NULL AND (v_self->>'admin_option')::boolean THEN
    RAISE EXCEPTION 'review_media_catalog_membership_denied';
  END IF;
  SELECT jsonb_agg(CASE WHEN p.oid=v_known THEN to_jsonb(p)-'prosrc' ELSE to_jsonb(p) END ORDER BY p.oid) INTO v_assertions FROM pg_proc p
    WHERE p.pronamespace='privacy_retention'::regnamespace;
  -- Pre-existing RPC/helper bodies and complete type/default metadata are pinned
  -- before any ownership or grant change. No unknown overload is admitted.
  FOR v_expected IN SELECT * FROM pg_temp.review_media_expected LOOP
    v_oid := to_regprocedure(v_expected.signature);
    SELECT * INTO v_function FROM pg_proc WHERE oid=v_oid;
    IF v_oid IS NULL OR v_function.proowner<>v_runner OR v_function.prokind<>'f'
       OR v_function.prosecdef IS DISTINCT FROM v_expected.definer OR v_function.provolatile::text<>v_expected.volatility
       OR v_function.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
       OR (SELECT lanname FROM pg_language WHERE oid=v_function.prolang)<>v_expected.language
       OR pg_get_function_result(v_oid) IS DISTINCT FROM v_expected.result
       OR coalesce(v_function.proargnames[1:v_function.pronargs],ARRAY[]::text[]) IS DISTINCT FROM v_expected.argument_names
       OR encode(sha256(convert_to(v_function.prosrc,'UTF8')),'hex')<>v_expected.body_sha256
       OR v_function.pronargdefaults<>(CASE WHEN v_function.proname='mutate_review_with_media' THEN 3 ELSE 0 END)
       OR (v_function.pronargdefaults=3 AND pg_get_expr(v_function.proargdefaults,0)<>'NULL::text, NULL::text[], NULL::text[]')
       OR (SELECT count(*) FROM pg_proc x WHERE x.pronamespace=v_function.pronamespace AND x.proname=v_function.proname)<>1 THEN
      RAISE EXCEPTION 'review_media_catalog_source_drift';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace='review_media_private'::regnamespace)<>7 THEN
    RAISE EXCEPTION 'review_media_catalog_identity_conflict';
  END IF;
  -- Preserve semantic defaults. PG15 pg_node_tree contains parser location
  -- offsets that change when the identical definition is recreated. The initial
  -- exact source/default checks above remain mandatory; retain every other field.
  SELECT jsonb_agg(((to_jsonb(p)-'proowner'-'proacl'-'prosrc'-'proargdefaults') || jsonb_build_object('proargdefaults',pg_get_expr(p.proargdefaults,0))) ORDER BY p.oid) INTO v_functions
    FROM pg_proc p JOIN pg_temp.review_media_expected e ON p.oid=to_regprocedure(e.signature);

  -- Use only the existing G014 owner-management authority. This transaction's
  -- noninheriting SET lease is restored exactly before unchanged assertions run.
  -- Never grant a Storage/service role or alter supautils/global configuration.
  IF v_major=17 AND NOT EXISTS (SELECT 1 FROM pg_auth_members
      WHERE roleid=v_owner AND member=v_runner AND admin_option AND grantor<>v_runner) THEN
    RAISE EXCEPTION 'review_media_catalog_existing_owner_admin_missing';
  END IF;
  IF v_major=17 THEN
    EXECUTE 'GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres';
  ELSE
    -- PG15 has one row per role/member pair, even when another grantor owns it.
    -- Lease only absent membership; never revoke a pre-existing grantor's row.
    v_pg15_lease := NOT pg_has_role(v_runner,v_owner,'MEMBER');
    IF v_pg15_lease THEN GRANT privacy_workflow_owner TO postgres; END IF;
  END IF;
  SET LOCAL ROLE privacy_workflow_owner;
  -- Existing G041 claim boundary: never restore auth-schema access for the
  -- workflow owner. Pin the unchanged helper before substituting auth.uid().
  IF has_schema_privilege(v_owner,'auth','USAGE,CREATE') OR NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='privacy_retention' AND p.proname='g041_current_claim_user_id'
      AND p.pronargs=0 AND p.proowner=v_owner AND p.prosecdef AND p.prokind='f'
      AND NOT p.proretset AND p.prorettype='uuid'::regtype AND p.provolatile='s'
      AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
      AND p.proconfig=ARRAY['search_path=""']::text[]
      AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='43f3ff2ed914944802555c4ffe3ff8ecece213e82288e2c1c47ae22efdf81585'
      AND has_function_privilege(v_owner,p.oid,'EXECUTE')
      AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
      AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
      AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')
  ) THEN RAISE EXCEPTION 'review_media_catalog_claim_boundary_drift'; END IF;
  IF EXISTS (SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist a
      JOIN pg_temp.review_media_expected e ON a.function_name=split_part(split_part(e.signature,'(',1),'.',2)
      WHERE a.function_schema='public') THEN
    RAISE EXCEPTION 'review_media_catalog_identity_conflict';
  END IF;
  SELECT jsonb_agg(to_jsonb(m) ORDER BY manifest_kind,manifest_key) INTO v_manifest
    FROM privacy_retention.g014_catalog_contract_manifest m;
  PERFORM privacy_retention.assert_g014_catalog_manifest();
  RESET ROLE;
  GRANT USAGE, CREATE ON SCHEMA review_media_private TO privacy_workflow_owner;
  FOR v_expected IN SELECT * FROM pg_temp.review_media_expected LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO privacy_workflow_owner',to_regprocedure(v_expected.signature));
    SET LOCAL ROLE privacy_workflow_owner;
    IF v_expected.signature LIKE 'public.%' THEN
      SELECT pg_get_functiondef(oid) INTO v_definition FROM pg_proc WHERE oid=to_regprocedure(v_expected.signature);
      EXECUTE replace(v_definition,'auth.uid()','privacy_retention.g041_current_claim_user_id()');
    END IF;
    IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
        WHERE oid=to_regprocedure(v_expected.signature)) IS DISTINCT FROM v_expected.final_body_sha256 THEN
      RAISE EXCEPTION 'review_media_catalog_claim_transition_drift';
    END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',to_regprocedure(v_expected.signature));
    IF v_expected.signature LIKE 'public.%' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',to_regprocedure(v_expected.signature));
    END IF;
    RESET ROLE;
  END LOOP;
  REVOKE CREATE ON SCHEMA review_media_private FROM privacy_workflow_owner;
  REVOKE ALL ON SCHEMA review_media_private FROM PUBLIC, anon, authenticated, service_role;
  REVOKE ALL ON TABLE review_media_private.commits, review_media_private.cleanup FROM PUBLIC, anon, authenticated, service_role;
  -- Private tables keep their migration owner. The implementation role receives
  -- only operations used by the reviewed functions, with explicit RLS policies.
  GRANT SELECT, INSERT ON review_media_private.commits TO privacy_workflow_owner;
  GRANT SELECT, INSERT, UPDATE ON review_media_private.cleanup TO privacy_workflow_owner;
  ALTER TABLE review_media_private.commits FORCE ROW LEVEL SECURITY;
  ALTER TABLE review_media_private.cleanup FORCE ROW LEVEL SECURITY;
  CREATE POLICY review_media_commits_select ON review_media_private.commits FOR SELECT TO privacy_workflow_owner USING (true);
  CREATE POLICY review_media_commits_insert ON review_media_private.commits FOR INSERT TO privacy_workflow_owner WITH CHECK (true);
  CREATE POLICY review_media_cleanup_select ON review_media_private.cleanup FOR SELECT TO privacy_workflow_owner USING (true);
  CREATE POLICY review_media_cleanup_insert ON review_media_private.cleanup FOR INSERT TO privacy_workflow_owner WITH CHECK (true);
  CREATE POLICY review_media_cleanup_update ON review_media_private.cleanup FOR UPDATE TO privacy_workflow_owner USING (true) WITH CHECK (true);
  -- Existing account-deletion contracts already require reviews SELECT/DELETE
  -- and storage.objects SELECT. Add only the six columns this RPC updates.
  GRANT UPDATE(content,categories,food_photos,is_verified,admin_note,updated_at)
    ON public.reviews TO privacy_workflow_owner;
  -- Existing supautils.policy_grants may authorize this DDL without table-owner
  -- USAGE/SET membership. Let the actual policy command decide; no fallback grant.
  CREATE POLICY review_media_workflow_read ON storage.objects FOR SELECT TO privacy_workflow_owner
    USING (bucket_id IN ('review-photos','review-verifications'));

  SET LOCAL ROLE privacy_workflow_owner;
  INSERT INTO privacy_retention.g014_public_rpc_allowlist
    (function_schema,function_name,identity_arguments,grantee,source_signature)
  SELECT 'public',p.proname,p.proargtypes::text,'authenticated',e.signature
    FROM pg_temp.review_media_expected e JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
    WHERE e.signature LIKE 'public.%';
  IF NOT FOUND THEN RAISE EXCEPTION 'review_media_catalog_allowlist_missing'; END IF;

  PERFORM privacy_retention.assert_g014_catalog_manifest();
  IF EXISTS (
    WITH expected(relation,ordinal,name,type,not_null,default_expr) AS (VALUES
      ('commits',1,'operation_id','uuid',true,NULL::text),
      ('commits',2,'owner_id','uuid',true,NULL::text),
      ('commits',3,'review_id','uuid',true,NULL::text),
      ('commits',4,'kind','text',true,NULL::text),
      ('commits',5,'request_hash','text',true,NULL::text),
      ('cleanup',1,'path','text',true,NULL::text),
      ('cleanup',2,'owner_id','uuid',true,NULL::text),
      ('cleanup',3,'review_id','uuid',true,NULL::text),
      ('cleanup',4,'purpose','text',true,NULL::text),
      ('cleanup',5,'retired','boolean',true,'false'),
      ('cleanup',6,'complete','boolean',true,'false')
    ), actual AS (
      SELECT c.relname::text,a.attnum::integer,a.attname::text,pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,
        pg_catalog.pg_get_expr(d.adbin,d.adrelid)
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE c.relnamespace='review_media_private'::regnamespace AND c.relkind IN ('r','p')
    )
    (SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  ) THEN RAISE EXCEPTION 'review_media_catalog_column_shape_drift'; END IF;
  IF EXISTS (
    WITH expected(relation,name,definition) AS (VALUES
      ('commits','commits_pkey','PRIMARY KEY (operation_id)'),
      ('commits','commits_kind_check','CHECK ((kind = ANY (ARRAY[''edit''::text, ''delete''::text])))'),
      ('cleanup','cleanup_pkey','PRIMARY KEY (path)'),
      ('cleanup','cleanup_purpose_check','CHECK ((purpose = ANY (ARRAY[''food''::text, ''verification''::text])))')
    ), actual AS (
      SELECT c.relname::text,k.conname::text,pg_catalog.pg_get_constraintdef(k.oid)
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_constraint k ON k.conrelid=c.oid
      WHERE c.relnamespace='review_media_private'::regnamespace
    )
    (SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  ) OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
      WHERE c.relnamespace='review_media_private'::regnamespace AND NOT t.tgisinternal)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
      WHERE c.relnamespace='review_media_private'::regnamespace AND (NOT k.convalidated OR k.condeferrable OR k.condeferred))
    OR (SELECT count(*) FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid
      WHERE c.relnamespace='review_media_private'::regnamespace)<>2
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid
      WHERE c.relnamespace='review_media_private'::regnamespace AND (NOT i.indisprimary OR NOT i.indisvalid OR NOT i.indisready)) THEN
    RAISE EXCEPTION 'review_media_catalog_constraint_shape_drift';
  END IF;
  -- Extend only the declarative protected-relation list, never an assertion.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid=v_known AND proowner=v_owner
      AND prosecdef AND prokind='f' AND proretset AND provolatile='s'
      AND proconfig=ARRAY['search_path=""']::text[]
      AND prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='sql')
      AND pg_catalog.pg_get_function_result(oid)='TABLE(schema_name name, relation_name name)') THEN
    RAISE EXCEPTION 'review_media_catalog_known_identity_metadata_drift';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(v_known) INTO v_definition;
  IF (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex') FROM pg_catalog.pg_proc WHERE oid=v_known)<>'43bf370fe74864708e9efbc6559d899a6afa5b353e6cbc930306e31c9ecdc499'
     OR EXISTS (SELECT 1 FROM privacy_retention.g014_catalog_contract_manifest
       WHERE manifest_key->>'schema'='review_media_private') THEN
    RAISE EXCEPTION 'review_media_catalog_known_identity_source_drift';
  END IF;
  EXECUTE pg_catalog.replace(v_definition,
    $known_anchor$    ('public', 'notifications'),$known_anchor$,
    $known_replacement$    ('review_media_private', 'commits'),
    ('review_media_private', 'cleanup'),
    ('public', 'notifications'),$known_replacement$);
  IF (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex') FROM pg_catalog.pg_proc WHERE oid=v_known)<>'20acd5742d891cf8a33b265a3a1298c65dd9646402c58391cd17829951cf92f2' THEN
    RAISE EXCEPTION 'review_media_catalog_known_identity_post_drift';
  END IF;
  INSERT INTO privacy_retention.g014_catalog_contract_manifest(manifest_kind,manifest_key,manifest_value)
    SELECT manifest_kind,manifest_key,manifest_value FROM privacy_retention.g014_catalog_manifest_rows()
    WHERE manifest_key->>'schema'='review_media_private'
      AND manifest_key->>'relation' IN ('commits','cleanup');
  IF NOT FOUND THEN RAISE EXCEPTION 'review_media_catalog_manifest_append_missing'; END IF;
  PERFORM privacy_retention.assert_g014_catalog_manifest();
  CREATE FUNCTION pg_temp.review_media_g014_assert() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $bridge$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_temp.review_media_expected e
      JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
      WHERE e.signature LIKE 'public.%' AND (
        (SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist a
          WHERE a.function_schema='public' AND a.function_name=p.proname)<>1
        OR NOT EXISTS (SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist a
          WHERE a.source_signature=e.signature AND a.function_schema='public' AND a.function_name=p.proname
            AND a.identity_arguments=p.proargtypes::text AND a.grantee='authenticated'))) THEN
      RAISE EXCEPTION 'review_media_catalog_allowlist_drift';
    END IF;
    PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
    PERFORM privacy_retention.assert_g014_definer_contract();
    PERFORM privacy_retention.assert_g014_catalog_contract();
    DROP FUNCTION pg_temp.review_media_g014_assert();
  END $bridge$;
  REVOKE ALL ON FUNCTION pg_temp.review_media_g014_assert() FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION pg_temp.review_media_g014_assert() TO postgres;
  IF (SELECT jsonb_agg(to_jsonb(m) ORDER BY manifest_kind,manifest_key)
      FROM privacy_retention.g014_catalog_contract_manifest m
      WHERE m.manifest_key->>'schema' IS DISTINCT FROM 'review_media_private') IS DISTINCT FROM v_manifest THEN
    RAISE EXCEPTION 'review_media_catalog_manifest_drift';
  END IF;
  RESET ROLE;
  IF v_major=15 THEN
    IF v_pg15_lease THEN REVOKE privacy_workflow_owner FROM postgres; END IF;
  ELSIF v_self IS NULL THEN
    REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;
  ELSE
    EXECUTE format('GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT %s, SET %s GRANTED BY postgres',
      upper(v_self->>'inherit_option'),upper(v_self->>'set_option'));
  END IF;
  IF (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]') FROM pg_auth_members m) IS DISTINCT FROM v_members
     OR (SELECT to_jsonb(n) FROM pg_namespace n WHERE nspname='public') IS DISTINCT FROM v_public
     OR (SELECT jsonb_agg(CASE WHEN p.oid=v_known THEN to_jsonb(p)-'prosrc' ELSE to_jsonb(p) END ORDER BY p.oid) FROM pg_proc p
         WHERE p.pronamespace='privacy_retention'::regnamespace) IS DISTINCT FROM v_assertions
     OR (SELECT jsonb_agg(((to_jsonb(p)-'proowner'-'proacl'-'prosrc'-'proargdefaults') || jsonb_build_object('proargdefaults',pg_get_expr(p.proargdefaults,0))) ORDER BY p.oid) FROM pg_proc p
         JOIN pg_temp.review_media_expected e ON p.oid=to_regprocedure(e.signature)) IS DISTINCT FROM v_functions THEN
    RAISE EXCEPTION 'review_media_catalog_preservation_drift' USING DETAIL =
      jsonb_build_object(
        'membershipPreserved',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]') FROM pg_auth_members m) IS NOT DISTINCT FROM v_members,
        'publicNamespacePreserved',(SELECT to_jsonb(n) FROM pg_namespace n WHERE nspname='public') IS NOT DISTINCT FROM v_public,
        'assertionsPreserved',(SELECT jsonb_agg(CASE WHEN p.oid=v_known THEN to_jsonb(p)-'prosrc' ELSE to_jsonb(p) END ORDER BY p.oid) FROM pg_proc p
            WHERE p.pronamespace='privacy_retention'::regnamespace) IS NOT DISTINCT FROM v_assertions,
        'functionMetadataPreserved',(SELECT jsonb_agg(((to_jsonb(p)-'proowner'-'proacl'-'prosrc'-'proargdefaults') || jsonb_build_object('proargdefaults',pg_get_expr(p.proargdefaults,0))) ORDER BY p.oid) FROM pg_proc p
            JOIN pg_temp.review_media_expected e ON p.oid=to_regprocedure(e.signature)) IS NOT DISTINCT FROM v_functions,
        'changedMetadataFields',(SELECT jsonb_agg(DISTINCT old_field.key ORDER BY old_field.key)
          FROM jsonb_array_elements(v_functions) AS old_function(value)
          CROSS JOIN LATERAL jsonb_each(old_function.value) AS old_field(key,value)
          JOIN pg_proc p ON p.oid=(old_function.value->>'oid')::oid
          WHERE old_field.value IS DISTINCT FROM (((to_jsonb(p)-'proowner'-'proacl'-'prosrc'-'proargdefaults') || jsonb_build_object('proargdefaults',pg_get_expr(p.proargdefaults,0))))->old_field.key)
      )::text;
  END IF;
  PERFORM pg_temp.review_media_g014_assert();
  IF to_regprocedure('pg_temp.review_media_g014_assert()') IS NOT NULL THEN
    RAISE EXCEPTION 'review_media_catalog_bridge_remaining';
  END IF;
END $integration$;

-- REVIEW_MEDIA_READBACK_BEGIN
-- The same independent catalog-only checks are embedded in canonical readback.
DO $review_media_catalog_readback$
DECLARE
  v_expected record; v_function record; v_relation record;
  v_owner oid := 'privacy_workflow_owner'::regrole;
  v_path text := current_setting('search_path');
BEGIN
  -- Existing G041 claim boundary: never restore auth-schema access for the
  -- workflow owner. Pin the unchanged helper before substituting auth.uid().
  IF has_schema_privilege(v_owner,'auth','USAGE,CREATE') OR NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='privacy_retention' AND p.proname='g041_current_claim_user_id'
      AND p.pronargs=0 AND p.proowner=v_owner AND p.prosecdef AND p.prokind='f'
      AND NOT p.proretset AND p.prorettype='uuid'::regtype AND p.provolatile='s'
      AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
      AND p.proconfig=ARRAY['search_path=""']::text[]
      AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='43f3ff2ed914944802555c4ffe3ff8ecece213e82288e2c1c47ae22efdf81585'
      AND has_function_privilege(v_owner,p.oid,'EXECUTE')
      AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
      AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
      AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')
  ) THEN RAISE EXCEPTION 'review_media_catalog_claim_boundary_drift'; END IF;
  -- Fix pg_get_expr qualification before comparing the exact parsed predicates.
  PERFORM set_config('search_path','public, pg_catalog',true);
  FOR v_expected IN SELECT * FROM (VALUES
    ('public.finish_review_media_cleanup()','f6c4e71988ed2b789b887484af5fdf2e482bde98f1d1c5b5d4e7ad124c314bd1',true,'v','plpgsql','bigint',ARRAY[]::text[]),
    ('public.mutate_review_with_media(uuid,uuid,text,timestamp with time zone,text,text[],text[])','50bfad7bc4fc7ddbc9d9379e8eb13facd938a15f66553576cc69fbcf69aa98b1',true,'v','plpgsql','text',ARRAY['p_operation_id','p_review_id','p_kind','p_expected_updated_at','p_content','p_categories','p_food_photos']::text[]),
    ('public.pending_review_media_cleanup()','5a92c8f282c895eabaa77f8cf3f452fb659bac33bd519ed8cf439dc1f2905c7b',true,'v','plpgsql','TABLE(path text, owner_id uuid, review_id uuid, purpose text)',ARRAY[]::text[]),
    ('public.queue_review_upload_cleanup(uuid,text[])','89c3b573891f598cac5df6ce9a3217639092801a7439ec0404f338f2097114a8',true,'v','plpgsql','text',ARRAY['p_review_id','p_paths']::text[]),
    ('public.read_review_media_commit(uuid,uuid,text)','2f14abfc04864f369467f5ac5f0603defa149b8023d7e6b04e2bb8535f8a268e',true,'v','sql','text',ARRAY['p_operation_id','p_review_id','p_kind']::text[]),
    ('public.review_media_delete_allowed(text)','a75dbd787dd388b0761bee11c82a56d5f410688e4cfd953181bce4d613062ae7',true,'v','plpgsql','boolean',ARRAY['p_path']::text[]),
    ('public.review_media_upload_allowed(text,text)','298c6a127f3a44a193b78be8c1f2577ab58aa34c772b66ccd53f774d807cc90c',true,'v','plpgsql','boolean',ARRAY['p_bucket','p_path']::text[]),
    ('review_media_private.canonical(text,uuid,uuid,text)','87d8397c36cf4c7b986f75cbc2788979333a76be2cc26dc5522cd362f62414a9',false,'i','sql','boolean',ARRAY['p_path','p_owner','p_review','p_purpose']::text[]),
    ('review_media_private.enqueue_removed()','7edb21d70ea3ff81ab90e13617e8c1c2749b54b1506f1ff42aaa6c5dc33f9e38',true,'v','plpgsql','trigger',ARRAY[]::text[]),
    ('review_media_private.guard_references()','846030547ffd76e17596755d7eee4279dcb9b563361435260826071d2f250d59',true,'v','plpgsql','trigger',ARRAY[]::text[]),
    ('review_media_private.lock_changes()','381d89aa6bbf5a59c2ee0fef2a7392ef705147252b324527201b8b6f74376250',true,'v','plpgsql','trigger',ARRAY[]::text[]),
    ('review_media_private.owned_legacy(text,uuid,text)','a2d55f09f03fcaeedd77461198511673da7342a6a4873d37227f9cf612090980',false,'i','sql','boolean',ARRAY['p_path','p_owner','p_purpose']::text[]),
    ('review_media_private.reference_key(text)','a8910cb09bfd959951045e8b0b8233b1e2a8bdc45073abeebdfc26b552b1dae7',false,'i','plpgsql','text',ARRAY['p_value']::text[]),
    ('review_media_private.referenced(text)','cc295115d85a3a11b380e1378e2ee91b0d9f7f587c68839653f54ed826c398ce',true,'v','sql','boolean',ARRAY['p_path']::text[])
  ) AS expected(signature,body_sha256,definer,volatility,language,result,argument_names) LOOP
    SELECT * INTO v_function FROM pg_proc WHERE oid=to_regprocedure(v_expected.signature);
    IF v_function.oid IS NULL OR v_function.proowner<>v_owner OR v_function.prokind<>'f'
       OR v_function.prosecdef IS DISTINCT FROM v_expected.definer OR v_function.provolatile::text<>v_expected.volatility
       OR v_function.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
       OR (SELECT lanname FROM pg_language WHERE oid=v_function.prolang)<>v_expected.language
       OR pg_get_function_result(v_function.oid) IS DISTINCT FROM v_expected.result
       OR coalesce(v_function.proargnames[1:v_function.pronargs],ARRAY[]::text[]) IS DISTINCT FROM v_expected.argument_names
       OR v_function.pronargdefaults<>(CASE WHEN v_function.proname='mutate_review_with_media' THEN 3 ELSE 0 END)
       OR (v_function.pronargdefaults=3 AND pg_get_expr(v_function.proargdefaults,0)<>'NULL::text, NULL::text[], NULL::text[]')
       OR encode(sha256(convert_to(v_function.prosrc,'UTF8')),'hex')<>v_expected.body_sha256
       OR (SELECT count(*) FROM pg_proc x WHERE x.pronamespace=v_function.pronamespace AND x.proname=v_function.proname)<>1
       OR NOT has_function_privilege(v_owner,v_function.oid,'EXECUTE')
       OR has_function_privilege('anon',v_function.oid,'EXECUTE')
       OR has_function_privilege('service_role',v_function.oid,'EXECUTE')
       OR has_function_privilege('authenticated',v_function.oid,'EXECUTE') IS DISTINCT FROM (v_expected.signature LIKE 'public.%')
       OR EXISTS (SELECT 1 FROM aclexplode(coalesce(v_function.proacl,acldefault('f',v_function.proowner))) a
         WHERE a.is_grantable OR a.privilege_type<>'EXECUTE'
         OR (a.grantee<>v_owner AND NOT (v_expected.signature LIKE 'public.%' AND a.grantee='authenticated'::regrole))) THEN
      RAISE EXCEPTION 'review_media_catalog_function_drift';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace='review_media_private'::regnamespace)<>7
     OR (SELECT count(*) FROM pg_class WHERE relnamespace='review_media_private'::regnamespace AND relkind IN ('r','p','v','m','f','S'))<>2
     OR NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='review_media_private' AND nspowner='postgres'::regrole)
     OR NOT has_schema_privilege(v_owner,'review_media_private','USAGE')
     OR has_schema_privilege(v_owner,'review_media_private','CREATE')
     OR EXISTS (SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
       WHERE n.nspname='review_media_private' AND a.grantee<>n.nspowner
         AND (a.grantee<>v_owner OR a.privilege_type<>'USAGE' OR a.is_grantable)) THEN
    RAISE EXCEPTION 'review_media_catalog_private_schema_drift';
  END IF;
  FOR v_expected IN SELECT * FROM (VALUES
    ('commits',ARRAY['INSERT','SELECT']::text[]),
    ('cleanup',ARRAY['INSERT','SELECT','UPDATE']::text[])
  ) AS expected(name,privileges) LOOP
    SELECT * INTO v_relation FROM pg_class WHERE oid=to_regclass('review_media_private.'||v_expected.name);
    IF v_relation.relkind<>'r' OR v_relation.relowner<>'postgres'::regrole OR NOT v_relation.relrowsecurity OR NOT v_relation.relforcerowsecurity
       OR (SELECT array_agg(a.privilege_type ORDER BY a.privilege_type) FROM aclexplode(v_relation.relacl) a
           WHERE a.grantee=v_owner) IS DISTINCT FROM v_expected.privileges
       OR EXISTS (SELECT 1 FROM aclexplode(v_relation.relacl) a WHERE a.grantee<>v_relation.relowner AND (a.grantee<>v_owner OR a.is_grantable))
       OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=v_relation.oid AND attacl IS NOT NULL) THEN
      RAISE EXCEPTION 'review_media_catalog_private_table_drift';
    END IF;
  END LOOP;
  IF EXISTS (
    WITH expected(relation, name, cmd, using_expr, check_expr) AS (VALUES
      ('commits','review_media_commits_select','r','true'::text,NULL::text),
      ('commits','review_media_commits_insert','a',NULL::text,'true'),
      ('cleanup','review_media_cleanup_select','r','true',NULL::text),
      ('cleanup','review_media_cleanup_insert','a',NULL::text,'true'),
      ('cleanup','review_media_cleanup_update','w','true','true')
    ), actual AS (
      SELECT c.relname::text,p.polname::text,p.polcmd::text,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid),p.polpermissive,p.polroles
      FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relnamespace='review_media_private'::regnamespace
    ), wanted AS (SELECT *,true,ARRAY[v_owner] FROM expected)
    (SELECT * FROM wanted EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM wanted)
  ) THEN RAISE EXCEPTION 'review_media_catalog_private_policy_drift'; END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES ('anon'),('authenticated'),('service_role')) r(name)
    WHERE has_schema_privilege(r.name,'review_media_private','USAGE,CREATE')
       OR has_table_privilege(r.name,'review_media_private.commits','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_table_privilege(r.name,'review_media_private.cleanup','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  ) OR NOT has_table_privilege(v_owner,'public.reviews','SELECT')
     OR NOT has_table_privilege(v_owner,'public.reviews','DELETE')
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['content','categories','food_photos','is_verified','admin_note','updated_at']) c(name)
         WHERE NOT has_column_privilege(v_owner,'public.reviews',c.name,'UPDATE'))
     OR has_table_privilege(v_owner,'public.reviews','INSERT,UPDATE,TRUNCATE,REFERENCES,TRIGGER')
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.reviews'::regclass AND a.attnum>0 AND NOT a.attisdropped
         AND a.attname<>ALL(ARRAY['content','categories','food_photos','is_verified','admin_note','updated_at'])
         AND has_column_privilege(v_owner,a.attrelid,a.attnum,'UPDATE'))
     OR NOT has_table_privilege(v_owner,'storage.objects','SELECT')
     OR has_table_privilege(v_owner,'storage.objects','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'review_media_catalog_minimum_grant_drift';
  END IF;
  IF EXISTS (
    WITH expected(relation,ordinal,name,type,not_null,default_expr) AS (VALUES
      ('commits',1,'operation_id','uuid',true,NULL::text),
      ('commits',2,'owner_id','uuid',true,NULL::text),
      ('commits',3,'review_id','uuid',true,NULL::text),
      ('commits',4,'kind','text',true,NULL::text),
      ('commits',5,'request_hash','text',true,NULL::text),
      ('cleanup',1,'path','text',true,NULL::text),
      ('cleanup',2,'owner_id','uuid',true,NULL::text),
      ('cleanup',3,'review_id','uuid',true,NULL::text),
      ('cleanup',4,'purpose','text',true,NULL::text),
      ('cleanup',5,'retired','boolean',true,'false'),
      ('cleanup',6,'complete','boolean',true,'false')
    ), actual AS (
      SELECT c.relname::text,a.attnum::integer,a.attname::text,pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,
        pg_catalog.pg_get_expr(d.adbin,d.adrelid)
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE c.relnamespace='review_media_private'::regnamespace AND c.relkind IN ('r','p')
    )
    (SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  ) THEN RAISE EXCEPTION 'review_media_catalog_column_shape_drift'; END IF;
  IF EXISTS (
    WITH expected(relation,name,definition) AS (VALUES
      ('commits','commits_pkey','PRIMARY KEY (operation_id)'),
      ('commits','commits_kind_check','CHECK ((kind = ANY (ARRAY[''edit''::text, ''delete''::text])))'),
      ('cleanup','cleanup_pkey','PRIMARY KEY (path)'),
      ('cleanup','cleanup_purpose_check','CHECK ((purpose = ANY (ARRAY[''food''::text, ''verification''::text])))')
    ), actual AS (
      SELECT c.relname::text,k.conname::text,pg_catalog.pg_get_constraintdef(k.oid)
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_constraint k ON k.conrelid=c.oid
      WHERE c.relnamespace='review_media_private'::regnamespace
    )
    (SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  ) OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
      WHERE c.relnamespace='review_media_private'::regnamespace AND NOT t.tgisinternal)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
      WHERE c.relnamespace='review_media_private'::regnamespace AND (NOT k.convalidated OR k.condeferrable OR k.condeferred))
    OR (SELECT count(*) FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid
      WHERE c.relnamespace='review_media_private'::regnamespace)<>2
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid
      WHERE c.relnamespace='review_media_private'::regnamespace AND (NOT i.indisprimary OR NOT i.indisvalid OR NOT i.indisready)) THEN
    RAISE EXCEPTION 'review_media_catalog_constraint_shape_drift';
  END IF;
  IF (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex') FROM pg_catalog.pg_proc
      WHERE pronamespace=(SELECT oid FROM pg_namespace WHERE nspname='privacy_retention')
        AND proname='g014_catalog_protected_relations' AND pronargs=0) IS DISTINCT FROM '20acd5742d891cf8a33b265a3a1298c65dd9646402c58391cd17829951cf92f2' THEN
    RAISE EXCEPTION 'review_media_catalog_known_identity_post_drift';
  END IF;
  -- Exact allowlist and unchanged G014 assertions run through the owner bridge
  -- above; canonical readback also runs them before this catalog-only block.
  -- REVIEW_MEDIA_TRIGGER_READBACK_BEGIN
  IF EXISTS (
    WITH expected(name,definition) AS (VALUES
      ('review_media_enqueue_removed','CREATE TRIGGER review_media_enqueue_removed AFTER DELETE OR UPDATE OF food_photos, verification_photo, user_id, id ON public.reviews FOR EACH ROW EXECUTE FUNCTION review_media_private.enqueue_removed()'),
      ('review_media_reference_guard','CREATE TRIGGER review_media_reference_guard BEFORE INSERT OR UPDATE OF food_photos, verification_photo, user_id, id ON public.reviews FOR EACH ROW EXECUTE FUNCTION review_media_private.guard_references()'),
      ('review_media_serialize','CREATE TRIGGER review_media_serialize BEFORE INSERT OR DELETE OR UPDATE OF food_photos, verification_photo, user_id, id ON public.reviews FOR EACH STATEMENT EXECUTE FUNCTION review_media_private.lock_changes()')
    ), actual AS (
      SELECT tgname::text,pg_get_triggerdef(oid),tgenabled::text FROM pg_trigger
      WHERE tgrelid='public.reviews'::regclass AND tgname LIKE 'review_media_%' AND NOT tgisinternal
    ), wanted AS (SELECT name,definition,'O'::text FROM expected)
    (SELECT * FROM wanted EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM wanted)
  ) THEN RAISE EXCEPTION 'review_media_catalog_trigger_drift'; END IF;
  -- REVIEW_MEDIA_TRIGGER_READBACK_END
  -- Compare command, role, permissive/restrictive bit and BOTH complete predicates.
  IF EXISTS (
    WITH expected(name,cmd,permissive,role_name,using_expr,check_expr) AS (VALUES
      ('review_media_safe_delete','d',false,'authenticated','((bucket_id <> ''review-photos''::text) OR review_media_delete_allowed(name))',NULL::text),
      ('review_media_safe_insert','a',false,'authenticated',NULL::text,'((bucket_id <> ALL (ARRAY[''review-photos''::text, ''review-verifications''::text])) OR review_media_upload_allowed(bucket_id, name))'),
      ('review_media_safe_update','w',false,'authenticated','((bucket_id <> ALL (ARRAY[''review-photos''::text, ''review-verifications''::text])) OR review_media_upload_allowed(bucket_id, name))','((bucket_id <> ALL (ARRAY[''review-photos''::text, ''review-verifications''::text])) OR review_media_upload_allowed(bucket_id, name))'),
      ('review_media_workflow_read','r',true,'privacy_workflow_owner','(bucket_id = ANY (ARRAY[''review-photos''::text, ''review-verifications''::text]))',NULL::text),
      ('review_photos_food_insert','a',false,'authenticated',NULL::text,'((bucket_id <> ''review-photos''::text) OR ((split_part(name, ''/''::text, 4) = ''food''::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid))))'),
      ('review_photos_food_update','w',false,'authenticated','((bucket_id <> ''review-photos''::text) OR ((split_part(name, ''/''::text, 4) = ''food''::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid))))','((bucket_id <> ''review-photos''::text) OR ((split_part(name, ''/''::text, 4) = ''food''::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid))))'),
      ('review_verifications_owner_delete','d',true,'authenticated','((bucket_id = ''review-verifications''::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid)))',NULL::text),
      ('review_verifications_owner_insert','a',true,'authenticated',NULL::text,'((bucket_id = ''review-verifications''::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid)) AND (split_part(name, ''/''::text, 4) = ''verification''::text))'),
      ('review_verifications_owner_read','r',true,'authenticated','((bucket_id = ''review-verifications''::text) AND (((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid)) OR has_role(( SELECT auth.uid() AS uid), ''admin''::app_role)))',NULL::text),
      ('review_verifications_safe_delete','d',false,'authenticated','((bucket_id <> ''review-verifications''::text) OR review_media_delete_allowed(name))',NULL::text)
    ), actual AS (
      SELECT p.polname::text,p.polcmd::text,p.polpermissive,p.polroles,
        regexp_replace(pg_get_expr(p.polqual,p.polrelid),'[[:space:]]+',' ','g'),
        regexp_replace(pg_get_expr(p.polwithcheck,p.polrelid),'[[:space:]]+',' ','g')
      FROM pg_policy p WHERE p.polrelid='storage.objects'::regclass
        AND (p.polname LIKE 'review_media_%' OR p.polname LIKE 'review_photos_%' OR p.polname LIKE 'review_verifications_%')
    ), wanted AS (SELECT name,cmd,permissive,ARRAY[to_regrole(role_name)::oid],using_expr,check_expr FROM expected)
    (SELECT * FROM wanted EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM wanted)
  ) THEN RAISE EXCEPTION 'review_media_catalog_storage_policy_drift'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='review-verifications' AND name='review-verifications'
      AND public=false AND file_size_limit=5242880
      AND allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp','image/avif']::text[]) THEN
    RAISE EXCEPTION 'review_media_catalog_private_bucket_drift';
  END IF;
  -- Admit the strict canonical local read policy or the three exact deployed
  -- bucket read identities. All existing API-role reads must match a known
  -- predicate; the private verification bucket is never publicly readable.
  IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid='storage.objects'::regclass
      AND p.polcmd='r' AND p.polpermissive AND p.polroles && ARRAY[0::oid,'anon'::regrole::oid,'authenticated'::regrole::oid]
      AND p.polname NOT IN ('tzudong_public_media_read','Anyone can view review photos','Public read access',
        'Public read access for profile-avatars','local_nightly_avatar_read','review_verifications_owner_read'))
    OR EXISTS (SELECT 1 FROM pg_policy p JOIN (VALUES
      ('Anyone can view review photos','(bucket_id = ''review-photos''::text)'),
      ('Public read access','(bucket_id = ''ad-banner-images''::text)'),
      ('Public read access for profile-avatars','(bucket_id = ''profile-avatars''::text)')
    ) e(name,predicate) ON p.polname=e.name
      WHERE p.polrelid='storage.objects'::regclass AND (p.polcmd<>'r' OR NOT p.polpermissive
        OR p.polroles<>ARRAY[0::oid] OR p.polwithcheck IS NOT NULL OR pg_get_expr(p.polqual,p.polrelid)<>e.predicate))
    OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid='storage.objects'::regclass
      AND p.polname='tzudong_public_media_read' AND (p.polcmd<>'r' OR NOT p.polpermissive
        OR NOT p.polroles @> ARRAY['anon'::regrole::oid,'authenticated'::regrole::oid] OR cardinality(p.polroles)<>2
        OR p.polwithcheck IS NOT NULL OR pg_get_expr(p.polqual,p.polrelid)<>'(bucket_id = ANY (ARRAY[''profile-avatars''::text, ''review-photos''::text, ''ad-banner-images''::text]))'))
    OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid='storage.objects'::regclass AND p.polname='local_nightly_avatar_read'
      AND (p.polcmd<>'r' OR NOT p.polpermissive OR NOT p.polroles @> ARRAY['anon'::regrole::oid,'authenticated'::regrole::oid]
        OR cardinality(p.polroles)<>2 OR p.polwithcheck IS NOT NULL OR pg_get_expr(p.polqual,p.polrelid)<>'(bucket_id = ''avatars''::text)')) THEN
    RAISE EXCEPTION 'review_media_catalog_public_read_drift';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='storage.objects'::regclass
      AND polname='tzudong_public_media_read' AND polcmd='r' AND polpermissive
      AND polroles @> ARRAY['anon'::regrole::oid,'authenticated'::regrole::oid]
      AND cardinality(polroles)=2 AND polwithcheck IS NULL
      AND pg_get_expr(polqual,polrelid)='(bucket_id = ANY (ARRAY[''profile-avatars''::text, ''review-photos''::text, ''ad-banner-images''::text]))')
    AND (SELECT count(*) FROM pg_policy WHERE polrelid='storage.objects'::regclass
      AND polname IN ('Anyone can view review photos','Public read access','Public read access for profile-avatars'))<>3 THEN
    RAISE EXCEPTION 'review_media_catalog_public_read_drift';
  END IF;
  -- The global reference scan must see all reviews under the trusted role.
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.reviews'::regclass
      AND polname='g014_account_deletion_source_access' AND polcmd='*' AND polpermissive
      AND polroles=ARRAY[v_owner] AND pg_get_expr(polqual,polrelid)='true' AND pg_get_expr(polwithcheck,polrelid)='true') THEN
    RAISE EXCEPTION 'review_media_catalog_reference_visibility_drift';
  END IF;
  PERFORM set_config('search_path',v_path,true);
END $review_media_catalog_readback$;
-- REVIEW_MEDIA_READBACK_END
NOTIFY pgrst, 'reload schema';

-- Canonical source 20261009022915_restaurant_review_manual_preview_eligibility.sql
-- Manual Preview/tick parity and fixed privileged revision lock for server run/stop.
-- Exact prior body; preserve limits, policy/stop/CAS, owner, ACL and all metadata.
DO $manual_preview_parity$
DECLARE target oid:='pipeline_control.restaurant_review_manual_preview(uuid,text)'::regprocedure;
 source text; before_meta jsonb; after_meta jsonb;
 old_sha constant text:='62720283cc47a766451a0e483e628e15175bf3038a7ccc0b26444f4bfc4dee52';
 new_sha constant text:='2f680f3d2e7d94cac4ba1812c0ee29abb30885c3d6e6fa86bb0abbc1ef1e8eb1';
 old_remaining constant text:=$old_remaining$  SELECT greatest(0,policy.daily_limit-coalesce(sum(approved),0)) INTO remaining FROM pipeline_control.restaurant_review_runs
    WHERE started_at>=date_trunc('day',now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul';$old_remaining$;
 new_remaining constant text:=$new_remaining$  SELECT greatest(0,policy.daily_limit-count(*)) INTO remaining FROM pipeline_control.restaurant_review_items
    WHERE restaurant_review_items.decision='approve' AND state='applied'
      AND finished_at>=date_trunc('day',now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul';$new_remaining$;
 old_predicate constant text:=$old_predicate$      FROM public.restaurants candidate WHERE candidate.status='pending' AND NOT EXISTS (
        SELECT 1 FROM pipeline_control.restaurant_review_items prior WHERE prior.restaurant_id=candidate.id
          AND prior.fingerprint=pipeline_control.restaurant_review_fingerprint(to_jsonb(candidate)))$old_predicate$;
 new_predicate constant text:=$new_predicate$      FROM public.restaurants candidate WHERE candidate.status='pending' AND (
        NOT EXISTS(SELECT 1 FROM pipeline_control.restaurant_review_items prior WHERE prior.restaurant_id=candidate.id
          AND (prior.fingerprint=pipeline_control.restaurant_review_fingerprint(to_jsonb(candidate)) OR prior.applied_fingerprint=pipeline_control.restaurant_review_fingerprint(to_jsonb(candidate))))
        OR EXISTS(SELECT 1 FROM pipeline_control.restaurant_review_items prior JOIN pipeline_control.restaurant_review_runs r ON r.id=prior.run_id
          WHERE prior.restaurant_id=candidate.id AND prior.applied_fingerprint=pipeline_control.restaurant_review_fingerprint(to_jsonb(candidate))
            AND prior.state='succeeded' AND prior.reason='daily_limit' AND r.policy_version=policy.version))$new_predicate$;
BEGIN
 SELECT prosrc,to_jsonb(p)-'prosrc' INTO source,before_meta FROM pg_proc p WHERE oid=target;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE oid=target AND proowner='postgres'::regrole AND NOT prosecdef
  AND prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND prorettype='jsonb'::regtype
  AND prokind='f' AND provolatile='s' AND proparallel='u' AND NOT proisstrict AND NOT proleakproof AND NOT proretset
  AND proconfig=ARRAY['search_path=""']::text[] AND proacl=ARRAY['postgres=X/postgres','service_role=X/postgres']::aclitem[])
 THEN RAISE EXCEPTION 'REVIEW_MANUAL_PREVIEW_METADATA_DRIFT'; END IF;
 IF encode(sha256(convert_to(source,'UTF8')),'hex')=new_sha THEN RETURN; END IF;
 IF encode(sha256(convert_to(source,'UTF8')),'hex')<>old_sha
  OR (length(source)-length(replace(source,old_remaining,'')))<>length(old_remaining)
  OR (length(source)-length(replace(source,old_predicate,'')))<>length(old_predicate)
 THEN RAISE EXCEPTION 'REVIEW_MANUAL_PREVIEW_SOURCE_DRIFT'; END IF;
 EXECUTE replace(pg_get_functiondef(target),source,replace(replace(source,old_remaining,new_remaining),old_predicate,new_predicate));
 SELECT prosrc,to_jsonb(p)-'prosrc' INTO source,after_meta FROM pg_proc p WHERE oid=target;
 IF after_meta IS DISTINCT FROM before_meta OR encode(sha256(convert_to(source,'UTF8')),'hex')<>new_sha
 THEN RAISE EXCEPTION 'REVIEW_MANUAL_PREVIEW_READBACK_DRIFT'; END IF;
END;
$manual_preview_parity$;
-- Fixed private lock only: no arguments, dynamic SQL, writes or actor substitution.
-- The public manual RPC remains invoker with its exact prior owner/ACL/settings.
DO $manual_fixed_lock$
DECLARE helper oid; target oid:='public.restaurant_review_automation_manual(uuid,text,text,text,uuid)'::regprocedure;
 source text; before_meta jsonb; after_meta jsonb;
 old_sha constant text:='ec67787639924dbc0a6c6b3753995ba211dae8e4d49cef7e0639d36e2084d7eb'; new_sha constant text:='b792a1646aac690fa2b2b1714978c762408c7a467c3fa8079a51763c956319e1';
 helper_body constant text:=$expected_body$
BEGIN
  PERFORM 1 FROM pipeline_control.admin_evaluation_catalog_revision WHERE singleton FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_STALE'; END IF;
END;
$expected_body$;
 anchor constant text:=$lock_anchor$  PERFORM 1 FROM pipeline_control.admin_evaluation_catalog_revision WHERE singleton FOR UPDATE;$lock_anchor$;
 replacement constant text:='  PERFORM pipeline_control.lock_restaurant_review_catalog_revision();';
BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres' THEN RAISE EXCEPTION 'REVIEW_MANUAL_LOCK_EXECUTOR'; END IF;
 helper:=to_regprocedure('pipeline_control.lock_restaurant_review_catalog_revision()');
 IF helper IS NULL THEN
  EXECUTE $helper_definition$CREATE FUNCTION pipeline_control.lock_restaurant_review_catalog_revision() RETURNS void
   LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $body$
BEGIN
  PERFORM 1 FROM pipeline_control.admin_evaluation_catalog_revision WHERE singleton FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_STALE'; END IF;
END;
$body$;$helper_definition$;
  REVOKE ALL ON FUNCTION pipeline_control.lock_restaurant_review_catalog_revision() FROM PUBLIC,anon,authenticated;
  GRANT EXECUTE ON FUNCTION pipeline_control.lock_restaurant_review_catalog_revision() TO service_role;
  helper:='pipeline_control.lock_restaurant_review_catalog_revision()'::regprocedure;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE oid=helper AND proowner='postgres'::regrole AND prosecdef
  AND prosrc=helper_body AND prorettype='void'::regtype AND prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
  AND prokind='f' AND provolatile='v' AND proparallel='u' AND NOT proisstrict AND NOT proleakproof AND NOT proretset
  AND proconfig=ARRAY['search_path=""','lock_timeout=2s']::text[]
  AND proacl=ARRAY['postgres=X/postgres','service_role=X/postgres']::aclitem[])
  OR has_function_privilege('anon',helper,'EXECUTE') OR has_function_privilege('authenticated',helper,'EXECUTE')
 THEN RAISE EXCEPTION 'REVIEW_MANUAL_LOCK_HELPER_DRIFT'; END IF;
 SELECT prosrc,to_jsonb(p)-'prosrc' INTO source,before_meta FROM pg_proc p WHERE oid=target;
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE oid=target AND proowner='postgres'::regrole AND NOT prosecdef
  AND prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND prorettype='jsonb'::regtype
  AND prokind='f' AND provolatile='v' AND proparallel='u' AND NOT proisstrict AND NOT proleakproof AND NOT proretset
  AND proconfig=ARRAY['search_path=""','lock_timeout=2s']::text[]
  AND proacl=ARRAY['postgres=X/postgres','service_role=X/postgres']::aclitem[])
 THEN RAISE EXCEPTION 'REVIEW_MANUAL_LOCK_METADATA_DRIFT'; END IF;
 IF encode(sha256(convert_to(source,'UTF8')),'hex')=new_sha THEN RETURN; END IF;
 IF encode(sha256(convert_to(source,'UTF8')),'hex')<>old_sha
  OR (length(source)-length(replace(source,anchor,'')))<>length(anchor)
 THEN RAISE EXCEPTION 'REVIEW_MANUAL_LOCK_SOURCE_DRIFT'; END IF;
 EXECUTE replace(pg_get_functiondef(target),source,replace(source,anchor,replacement));
 SELECT prosrc,to_jsonb(p)-'prosrc' INTO source,after_meta FROM pg_proc p WHERE oid=target;
 IF after_meta IS DISTINCT FROM before_meta OR encode(sha256(convert_to(source,'UTF8')),'hex')<>new_sha
 THEN RAISE EXCEPTION 'REVIEW_MANUAL_LOCK_READBACK_DRIFT'; END IF;
END;
$manual_fixed_lock$;

-- Canonical source 20261009091342_admin_record_private_verification_cleanup.sql
-- Keep guarded admin deletion aligned with the private verification bucket.
-- Storage metadata is read here only for CAS/fencing; object deletion remains
-- an explicit service-role Storage API operation after the database commit.

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

  old_text := $old$  IF p_phase='cleanup_read' THEN
   RETURN jsonb_build_object('jobs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'bucket',bucket,'objectName',object_name,'state',state) ORDER BY id)
     FROM pipeline_control.admin_record_media_cleanup WHERE operation_id=op.id AND state<>'done'),'[]'::jsonb));
  END IF;$old$;
  new_text := $new$  IF p_phase='cleanup_read' THEN
   RETURN jsonb_build_object('jobs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',page.id,'bucket',page.bucket,'objectName',page.object_name,'state',page.state) ORDER BY page.id)
     FROM (SELECT id,bucket,object_name,state FROM pipeline_control.admin_record_media_cleanup
       WHERE operation_id=op.id AND state<>'done' ORDER BY id LIMIT 25) page),'[]'::jsonb));
  END IF;$new$;
  IF (length(patched)-length(replace(patched,old_text,'')))/length(old_text) <> 1 THEN
    RAISE EXCEPTION 'ADMIN_PRIVATE_CLEANUP_ACTION_PAGE_DRIFT'; END IF;
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

-- Canonical source 20261009101645_admin_user_management_rpc_forward.sql
-- Current-state forward for the three accepted admin user-management RPC bodies.
-- Requires the exact verified post-five PostgreSQL 17.6 catalog/ACL preimage.
-- Whole-file transaction only. No historical ledger repair or generic admission.
DO $admin_management_group$
DECLARE
 v_owner oid := pg_catalog.to_regrole('privacy_workflow_owner');
 v_runner oid := pg_catalog.to_regrole(session_user);
 v_before jsonb; v_after jsonb; v_oid oid; v_signature text;
 v_rel text; v_forced boolean; v_owned boolean; v_cmd text;
 v_snapshot constant text := $snapshot$SELECT jsonb_build_object(
'types',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(t) AS value FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname !~ '^pg_(temp|toast_temp)') rows),
'enums',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(e) AS value FROM pg_catalog.pg_enum e) rows),
'default_acls',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(a) AS value FROM pg_catalog.pg_default_acl a) rows),
'memberships',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(m) AS value FROM pg_catalog.pg_auth_members m) rows),
'roles',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(r) AS value FROM pg_catalog.pg_roles r) rows),
'schemas',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(n) AS value FROM pg_catalog.pg_namespace n WHERE nspname !~ '^pg_(temp|toast_temp)') rows),
'relations',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(c)-ARRAY['relpages','reltuples','relallvisible','relfrozenxid','relminmxid'] AS value FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','privacy_retention','auth','storage','extensions')) rows),
'functions',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(p) AS value FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_(temp|toast_temp)' AND NOT(n.nspname='public' AND p.proname IN ('read_admin_user_management_metadata','read_admin_user_audit_events','append_admin_user_audit_event'))) rows),
'allowlist',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(a) AS value FROM privacy_retention.g014_public_rpc_allowlist a WHERE NOT(source_signature IN ('public.read_admin_user_management_metadata(uuid[])','public.read_admin_user_audit_events(integer)','public.append_admin_user_audit_event(uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamp with time zone,text,uuid,text,text)') OR (function_schema='public' AND function_name IN ('read_admin_user_management_metadata','read_admin_user_audit_events','append_admin_user_audit_event')))) rows),
'policies',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(x) AS value FROM pg_catalog.pg_policy x WHERE polrelid IN (SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','privacy_retention','auth','storage','extensions'))) rows),
'columns',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(x) AS value FROM pg_catalog.pg_attribute x WHERE attrelid IN (SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','privacy_retention','auth','storage','extensions'))) rows),
'constraints',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(x) AS value FROM pg_catalog.pg_constraint x WHERE conrelid IN (SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','privacy_retention','auth','storage','extensions'))) rows),
'indexes',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(x) AS value FROM pg_catalog.pg_index x WHERE indrelid IN (SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','privacy_retention','auth','storage','extensions'))) rows),
'defaults',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(x) AS value FROM pg_catalog.pg_attrdef x WHERE adrelid IN (SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','privacy_retention','auth','storage','extensions'))) rows),
'triggers',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(x) AS value FROM pg_catalog.pg_trigger x WHERE tgrelid IN (SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','privacy_retention','auth','storage','extensions'))) rows),
'rules',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(x) AS value FROM pg_catalog.pg_rewrite x WHERE ev_class IN (SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','privacy_retention','auth','storage','extensions'))) rows))$snapshot$;
BEGIN
  PERFORM pg_catalog.set_config('search_path','pg_catalog',true);
  IF pg_catalog.current_setting('server_version_num')::integer / 10000 <> 17
     OR current_user <> 'postgres' OR session_user <> 'postgres'
     OR pg_catalog.current_setting('transaction_read_only') <> 'off'
     OR v_owner IS NULL THEN
    RAISE EXCEPTION 'admin_group_executor_denied';
  END IF;
  PERFORM pg_catalog.set_config('lock_timeout','2s',true);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tzudong:admin-management-group:v1',0));
 IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('read_admin_user_management_metadata','read_admin_user_audit_events','append_admin_user_audit_event')) OR EXISTS(SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature IN ('public.read_admin_user_management_metadata(uuid[])','public.read_admin_user_audit_events(integer)','public.append_admin_user_audit_event(uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamp with time zone,text,uuid,text,text)') OR (function_schema='public' AND function_name IN ('read_admin_user_management_metadata','read_admin_user_audit_events','append_admin_user_audit_event'))) THEN RAISE EXCEPTION 'admin_group_identity_conflict'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE oid=v_owner AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolinherit)
     OR (SELECT count(*) FROM pg_catalog.pg_auth_members WHERE roleid=v_owner AND member=v_runner) <> 1
     OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid=v_owner AND member=v_runner AND admin_option AND NOT inherit_option AND NOT set_option AND grantor<>v_runner)
     OR pg_catalog.pg_has_role(v_runner,v_owner,'SET')
     OR pg_catalog.pg_has_role(v_runner,v_owner,'USAGE') THEN
    RAISE EXCEPTION 'admin_group_membership_admission_denied';
  END IF;
 IF NOT has_schema_privilege(v_owner,'public','CREATE') THEN RAISE EXCEPTION 'admin_group_create_denied'; END IF;
 -- The operating postgres executor cannot lock the owner-owned audit table
 -- directly. Add the admitted self-granted membership row transaction-locally,
 -- acquire every dependency lock as the existing owner, then remove that row.
 GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;
 SET LOCAL ROLE privacy_workflow_owner;
 LOCK TABLE public.profiles,public.user_roles,public.user_account_status,public.admin_audit_events IN SHARE MODE;
 LOCK TABLE privacy_retention.g014_public_rpc_allowlist IN SHARE ROW EXCLUSIVE MODE;
 RESET ROLE;
 REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;
-- BEGIN POST-FIVE PREIMAGE GUARD
 IF pg_catalog.current_setting('server_version_num')::integer <> 170006 THEN
   RAISE EXCEPTION 'admin_user_forward_pg176_required';
 END IF;
 IF EXISTS(
   SELECT 1
   FROM (VALUES
     ('pipeline_control.admin_record_review_media(jsonb)','e2e2aea7a72440b151d69ceea13dab5855ba691199f74e065a2850b848004d99',ARRAY['search_path=""']::text[],false),
     ('pipeline_control.admin_record_snapshot(text,uuid[])','7132001985972c0e0fece15782ba7aac68338508f04ef3365733024a7c975cd5',ARRAY['search_path=""']::text[],false),
     ('pipeline_control.admin_record_storage_snapshot(text,text)','952f92d709f60b7f47168e0f4f6ff1b141ceae23f7cf3632db760f4ea2cd541d',ARRAY['search_path=""']::text[],false),
     ('pipeline_control.lock_restaurant_review_catalog_revision()','5fe3230899d7669896f562b5a7afa5e088761b3ecc26f531c13cf0953a569413',ARRAY['search_path=""','lock_timeout=2s']::text[],true),
     ('pipeline_control.restaurant_review_manual_preview(uuid,text)','2f680f3d2e7d94cac4ba1812c0ee29abb30885c3d6e6fa86bb0abbc1ef1e8eb1',ARRAY['search_path=""']::text[],false),
     ('public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer)','7a73f41ceaf7e8cf106e073e6f2ee791aeaafd16d8a6d2a6d11af3d1a8289304',ARRAY['search_path=""']::text[],false),
     ('public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)','a18fad1f748d736371a9ab549a1ca483a5b2f321674fabe71b2411b7e58b3fc9',ARRAY['search_path=""']::text[],false),
     ('public.restaurant_review_automation_manual(uuid,text,text,text,uuid)','b792a1646aac690fa2b2b1714978c762408c7a467c3fa8079a51763c956319e1',ARRAY['search_path=""','lock_timeout=2s']::text[],false)
   ) expected(signature,body_sha,config,security_definer)
   WHERE NOT EXISTS(
     SELECT 1
     FROM pg_catalog.pg_proc p
     WHERE p.oid=pg_catalog.to_regprocedure(expected.signature)
       AND p.proowner=pg_catalog.to_regrole('postgres')
       AND p.prosecdef=expected.security_definer
       AND p.proconfig IS NOT DISTINCT FROM expected.config
       AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')=expected.body_sha
       AND pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
       AND NOT pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
       AND NOT pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
       AND (SELECT count(*) FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))))=2
       AND NOT EXISTS(
         SELECT 1
         FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
         WHERE acl.grantee NOT IN (pg_catalog.to_regrole('postgres'),pg_catalog.to_regrole('service_role'))
            OR acl.privilege_type<>'EXECUTE' OR acl.is_grantable
       )
   )
 ) THEN RAISE EXCEPTION 'admin_user_forward_post_five_function_drift'; END IF;
 IF EXISTS(
   SELECT 1
   FROM (VALUES
     ('privacy_retention.assert_g014_catalog_contract()','50948ddce54dbba9497978964bebc535c27ebe98fb0f46bf05e2ec17ab0b9e01',true),
     ('privacy_retention.assert_g014_definer_contract()','b9e2f7d812783deee6c91d27d22d6c2019be9aa04e4f1221cc7482567775354a',true),
     ('privacy_retention.assert_g014_public_rpc_allowlist()','f23203a0a2366eca16b30b256729e859efc556952df8cb75485924153e1188ef',true),
     ('privacy_retention.assert_g014_workflow_owner_contract()','345aed9acb1da06262740ef06d81e51855a44c7470aa8b431a23e6fa629aab1d',false)
   ) expected(signature,body_sha,security_definer)
   WHERE NOT EXISTS(
     SELECT 1
     FROM pg_catalog.pg_proc p
     WHERE p.oid=pg_catalog.to_regprocedure(expected.signature)
       AND p.proowner=v_owner
       AND p.prosecdef=expected.security_definer
       AND p.proconfig=ARRAY['search_path=""']::text[]
       AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')=expected.body_sha
       AND (SELECT count(*) FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))))=1
       AND NOT EXISTS(
         SELECT 1
         FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
         WHERE acl.grantee<>v_owner OR acl.privilege_type<>'EXECUTE' OR acl.is_grantable
       )
   )
 ) THEN RAISE EXCEPTION 'admin_user_forward_post_five_assertion_drift'; END IF;
 IF (SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist
     WHERE source_signature IN (
       'public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)',
       'public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer)'
     ))<>2
 OR EXISTS(
   SELECT 1
   FROM privacy_retention.g014_public_rpc_allowlist a
   LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(a.source_signature)
   WHERE a.source_signature IN (
       'public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)',
       'public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer)'
     )
     AND (p.oid IS NULL OR a.function_schema<>'public' OR a.function_name<>p.proname
       OR a.identity_arguments<>p.proargtypes::text OR a.grantee<>'service_role')
 ) THEN RAISE EXCEPTION 'admin_user_forward_post_five_allowlist_drift'; END IF;
 IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname LIKE 'pg_temp_%' AND p.proname IN ('admin_record_registration','admin_raw_warning_registration'))<>0
 OR (SELECT pg_catalog.pg_get_constraintdef(c.oid)
     FROM pg_catalog.pg_constraint c
     WHERE c.conname='admin_record_media_cleanup_bucket_check'
       AND c.conrelid=pg_catalog.to_regclass('pipeline_control.admin_record_media_cleanup'))
    IS DISTINCT FROM $constraint$CHECK ((bucket = ANY (ARRAY['review-photos'::text, 'review-verifications'::text])))$constraint$
 THEN RAISE EXCEPTION 'admin_user_forward_post_five_cleanup_drift'; END IF;
-- END POST-FIVE PREIMAGE GUARD
-- BEGIN DEPENDENCY GUARD (shared read-only replay/readback contract)
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE oid=v_owner AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolinherit)
 OR NOT has_schema_privilege(v_owner,'public','USAGE')
 OR NOT has_schema_privilege('service_role','public','USAGE')
 OR NOT EXISTS(SELECT 1 FROM pg_enum WHERE enumtypid='public.app_role'::regtype AND enumlabel='admin')
 OR EXISTS(SELECT 1 FROM (VALUES ('public.profiles','user_id','uuid',true,false),('public.profiles','username','text',false,false),('public.profiles','nickname','text',true,false),('public.profiles','avatar_url','text',false,false),('public.profiles','role','text',true,false),('public.profiles','created_at','timestamptz',true,false),('public.profiles','updated_at','timestamptz',true,false),('public.user_roles','user_id','uuid',true,false),('public.user_roles','role','public.app_role',true,false),('public.user_account_status','user_id','uuid',true,false),('public.user_account_status','account_status','text',true,false),('public.user_account_status','disabled_at','timestamptz',false,false),('public.admin_audit_events','id','uuid',true,false),('public.admin_audit_events','actor_user_id','uuid',true,true),('public.admin_audit_events','target_user_id','uuid',false,true),('public.admin_audit_events','action','text',true,true),('public.admin_audit_events','reason','text',false,true),('public.admin_audit_events','status','text',true,true),('public.admin_audit_events','correlation_id','uuid',false,true),('public.admin_audit_events','applied_at','timestamptz',false,true),('public.admin_audit_events','error_code','text',false,true),('public.admin_audit_events','created_at','timestamptz',true,false),('public.admin_audit_events','audit_counts','jsonb',true,true),('public.admin_audit_events','audit_flags','jsonb',true,true),('public.admin_audit_events','before_state','jsonb',true,true),('public.admin_audit_events','after_state','jsonb',true,true),('public.admin_audit_events','request_id','text',false,true),('public.admin_audit_events','ip_hash','text',false,true),('public.admin_audit_events','user_agent_hash','text',false,true)) x(rel,col,typ,nn,ins)
   LEFT JOIN pg_attribute a ON a.attrelid=to_regclass(x.rel) AND a.attname=x.col AND NOT a.attisdropped
   WHERE a.attnum IS NULL OR a.atttypid<>to_regtype(x.typ) OR a.attnotnull<>x.nn
     OR NOT has_column_privilege(v_owner,a.attrelid,a.attnum,'SELECT')
     OR (x.ins AND NOT has_column_privilege(v_owner,a.attrelid,a.attnum,'INSERT'))) THEN
 RAISE EXCEPTION 'admin_group_column_dependency_denied'; END IF;
 FOR v_rel,v_forced,v_owned IN SELECT * FROM (VALUES ('public.profiles',true,false),('public.user_roles',false,false),('public.user_account_status',false,false),('public.admin_audit_events',true,true)) x LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass(v_rel) AND relkind='r' AND relrowsecurity AND relforcerowsecurity=v_forced AND (relowner=v_owner)=v_owned) THEN RAISE EXCEPTION 'admin_group_relation_denied'; END IF;
   FOR v_cmd IN SELECT unnest(CASE WHEN v_rel='public.admin_audit_events' THEN ARRAY['r','a'] ELSE ARRAY['r'] END) LOOP
     IF NOT EXISTS(SELECT 1 FROM pg_policy p WHERE polrelid=to_regclass(v_rel) AND polcmd::text IN (v_cmd,'*') AND polpermissive
       AND (CASE WHEN v_cmd='a' THEN pg_get_expr(coalesce(polwithcheck,polqual),polrelid) ELSE pg_get_expr(polqual,polrelid) END) IN ('true','(true)')
       AND EXISTS(SELECT 1 FROM unnest(polroles) r WHERE r=0 OR pg_has_role(v_owner,r,'USAGE')))
     OR EXISTS(SELECT 1 FROM pg_policy p WHERE polrelid=to_regclass(v_rel) AND polcmd::text IN (v_cmd,'*') AND NOT polpermissive
       AND coalesce((CASE WHEN v_cmd='a' THEN pg_get_expr(coalesce(polwithcheck,polqual),polrelid) ELSE pg_get_expr(polqual,polrelid) END) NOT IN ('true','(true)'),true)
       AND EXISTS(SELECT 1 FROM unnest(polroles) r WHERE r=0 OR pg_has_role(v_owner,r,'USAGE'))) THEN RAISE EXCEPTION 'admin_group_rls_visibility_denied'; END IF;
   END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM (VALUES('profiles'),('user_account_status')) r(rel) WHERE NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attname='user_id' WHERE i.indrelid=to_regclass('public.'||rel) AND i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate AND i.indnkeyatts=1 AND i.indkey[0]=a.attnum AND i.indpred IS NULL AND i.indexprs IS NULL)) THEN RAISE EXCEPTION 'admin_group_join_key_denied'; END IF;
 IF (SELECT count(*) FROM pg_attribute WHERE attrelid='public.admin_audit_events'::regclass AND attnum>0 AND NOT attisdropped)<>17
 OR EXISTS(SELECT 1 FROM pg_rewrite WHERE ev_class='public.admin_audit_events'::regclass)
 OR (SELECT count(*) FROM pg_constraint WHERE conrelid='public.admin_audit_events'::regclass)<>4
 OR EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.admin_audit_events'::regclass AND (NOT convalidated OR contype='f'))
 OR NOT EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='id' WHERE c.conrelid='public.admin_audit_events'::regclass AND c.contype='p' AND c.conkey=ARRAY[a.attnum]::smallint[])
 OR NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.admin_audit_events'::regclass AND c.conname='admin_audit_events_whitelisted_contract' AND c.contype='c' AND c.convalidated AND regexp_replace(pg_get_expr(c.conbin,c.conrelid),'[[:space:]()]','','g')='public.admin_user_audit_event_is_safeaction,status,reason,error_code,before_state,after_state,audit_counts,audit_flags,request_id,ip_hash,user_agent_hash')
 OR (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.admin_audit_events'::regclass AND NOT tgisinternal)<>1
 OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.admin_audit_events'::regclass AND (tgtype::int & 4)<>0)
 OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.admin_audit_events'::regclass AND tgname='g014_admin_audit_events_append_only' AND tgtype=27 AND tgenabled='O' AND tgfoid=to_regprocedure('privacy_retention.g014_reject_audit_mutation()'))
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('privacy_retention.g014_reject_audit_mutation()') AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='eefd04295b4a2a4ae6a60b3a5e93b430808b0a9a668829e8bf10ba9234f21772')
 THEN RAISE EXCEPTION 'admin_group_audit_contract_denied'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid='public.admin_audit_events'::regclass AND a.attname='id' AND pg_get_expr(d.adbin,d.adrelid) IN ('gen_random_uuid()','pg_catalog.gen_random_uuid()','extensions.gen_random_uuid()'))
 OR NOT EXISTS(SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid='public.admin_audit_events'::regclass AND a.attname='created_at' AND pg_get_expr(d.adbin,d.adrelid) IN ('now()','pg_catalog.now()'))
 OR NOT has_function_privilege(v_owner,'pg_catalog.gen_random_uuid()','EXECUTE') OR NOT has_function_privilege(v_owner,'pg_catalog.now()','EXECUTE')
 OR EXISTS(SELECT 1 FROM pg_attrdef d JOIN pg_depend x ON x.classid='pg_attrdef'::regclass AND x.objid=d.oid JOIN pg_class c ON x.refclassid='pg_class'::regclass AND x.refobjid=c.oid WHERE d.adrelid='public.admin_audit_events'::regclass AND c.relkind='S')
 OR EXISTS(SELECT 1 FROM pg_attrdef d JOIN pg_depend x ON x.classid='pg_attrdef'::regclass AND x.objid=d.oid WHERE d.adrelid='public.admin_audit_events'::regclass AND CASE WHEN x.refclassid='pg_proc'::regclass THEN NOT has_function_privilege(v_owner,x.refobjid,'EXECUTE') ELSE false END)
 THEN RAISE EXCEPTION 'admin_group_default_dependency_denied'; END IF;
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='admin_user_audit_event_is_safe')<>1 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.admin_user_audit_event_is_safe(text,text,text,text,jsonb,jsonb,jsonb,jsonb,text,text,text)') AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='9594ce8b4eb33861298e6d5f3598d96ca63ec37918ea2647ede25c3315ab23cf' AND has_function_privilege(v_owner,oid,'EXECUTE') AND NOT prosecdef AND provolatile='i' AND proconfig IN (ARRAY['search_path=pg_catalog']::text[],ARRAY['search_path=""']::text[])) THEN RAISE EXCEPTION 'admin_group_helper_denied'; END IF;
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='admin_user_audit_reason_code')<>1 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.admin_user_audit_reason_code(text,text)') AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='2b9fd117fcf923d0aaf7858af3f349690b125fae5467329c3205c57a216d9cf1' AND has_function_privilege(v_owner,oid,'EXECUTE') AND NOT prosecdef AND provolatile='i' AND proconfig IN (ARRAY['search_path=pg_catalog']::text[],ARRAY['search_path=""']::text[])) THEN RAISE EXCEPTION 'admin_group_helper_denied'; END IF;
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='admin_user_audit_counts_are_safe')<>1 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.admin_user_audit_counts_are_safe(jsonb)') AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='9add17e04ded01d3dde7cd9687cf96fa4f587b387a31ee23b1475b3615c2e26f' AND has_function_privilege(v_owner,oid,'EXECUTE') AND NOT prosecdef AND provolatile='i' AND proconfig IN (ARRAY['search_path=pg_catalog']::text[],ARRAY['search_path=""']::text[])) THEN RAISE EXCEPTION 'admin_group_helper_denied'; END IF;
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='admin_user_audit_flags_are_safe')<>1 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.admin_user_audit_flags_are_safe(jsonb)') AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='6d00ddf8bb5a81732cbdffcf414af254cc5ccb87f8d5641df56ee8fbe9e90b36' AND has_function_privilege(v_owner,oid,'EXECUTE') AND NOT prosecdef AND provolatile='i' AND proconfig IN (ARRAY['search_path=pg_catalog']::text[],ARRAY['search_path=""']::text[])) THEN RAISE EXCEPTION 'admin_group_helper_denied'; END IF;
-- END DEPENDENCY GUARD
  EXECUTE v_snapshot INTO v_before;

  -- Add only a transaction-local self-granted SET membership row. The foreign
  -- ADMIN=true/INHERIT=false row remains unchanged.
  GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;
  SET LOCAL ROLE privacy_workflow_owner;
  -- Transaction-local bridge runs assertions after SET is restored, preserving
  -- G041's membership invariant while checking the real G014 routines unchanged.
  CREATE FUNCTION pg_temp.admin_group_g014_check() RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $bridge$
  BEGIN
    PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
    PERFORM privacy_retention.assert_g014_definer_contract();
    PERFORM privacy_retention.assert_g014_catalog_contract();
  END $bridge$;
  REVOKE ALL ON FUNCTION pg_temp.admin_group_g014_check() FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION pg_temp.admin_group_g014_check() TO postgres;
  RESET ROLE;
  REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;
  EXECUTE v_snapshot INTO v_after;
  IF v_after IS DISTINCT FROM v_before THEN RAISE EXCEPTION 'admin_group_bridge_restore_drift'; END IF;
  PERFORM pg_temp.admin_group_g014_check();

  GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;
  SET LOCAL ROLE privacy_workflow_owner;
  EXECUTE $rpc$CREATE FUNCTION public.read_admin_user_management_metadata(
  p_user_ids uuid[]
)
RETURNS TABLE (
  user_id uuid,
  username text,
  nickname text,
  avatar_url text,
  profile_role text,
  profile_created_at timestamptz,
  profile_updated_at timestamptz,
  is_admin boolean,
  account_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  requested_count integer := pg_catalog.cardinality(p_user_ids);
BEGIN
  IF p_user_ids IS NULL
     OR requested_count NOT BETWEEN 1 AND 200
     OR pg_catalog.array_position(p_user_ids, NULL::uuid) IS NOT NULL
     OR (
       SELECT count(DISTINCT requested.user_id)
         FROM pg_catalog.unnest(p_user_ids) AS requested(user_id)
     ) <> requested_count THEN
    RAISE EXCEPTION 'admin_user_metadata_request_invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    requested.user_id,
    profile_row.username,
    profile_row.nickname,
    profile_row.avatar_url,
    profile_row.role AS profile_role,
    profile_row.created_at AS profile_created_at,
    profile_row.updated_at AS profile_updated_at,
    EXISTS (
      SELECT 1
        FROM public.user_roles AS role_row
       WHERE role_row.user_id = requested.user_id
         AND role_row.role::text = 'admin'
    ) AS is_admin,
    status_row.account_status
    FROM pg_catalog.unnest(p_user_ids) WITH ORDINALITY
      AS requested(user_id, request_ordinal)
    LEFT JOIN public.profiles AS profile_row
      ON profile_row.user_id = requested.user_id
    LEFT JOIN public.user_account_status AS status_row
      ON status_row.user_id = requested.user_id
   ORDER BY requested.request_ordinal;
END
$$;$rpc$;
  REVOKE ALL ON FUNCTION public.read_admin_user_management_metadata(uuid[]) FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION public.read_admin_user_management_metadata(uuid[]) TO service_role;
  EXECUTE $rpc$CREATE FUNCTION public.read_admin_user_audit_events(
  p_limit integer
)
RETURNS TABLE (
  id uuid,
  actor_user_id uuid,
  target_user_id uuid,
  action text,
  reason text,
  status text,
  correlation_id uuid,
  applied_at timestamptz,
  error_code text,
  created_at timestamptz,
  audit_counts jsonb,
  audit_flags jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'admin_user_audit_limit_invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    audit_row.id,
    audit_row.actor_user_id,
    audit_row.target_user_id,
    audit_row.action,
    audit_row.reason,
    audit_row.status,
    audit_row.correlation_id,
    audit_row.applied_at,
    audit_row.error_code,
    audit_row.created_at,
    audit_row.audit_counts,
    audit_row.audit_flags
    FROM public.admin_audit_events AS audit_row
   ORDER BY audit_row.created_at DESC, audit_row.id DESC
   LIMIT p_limit;
END
$$;$rpc$;
  REVOKE ALL ON FUNCTION public.read_admin_user_audit_events(integer) FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION public.read_admin_user_audit_events(integer) TO service_role;
  EXECUTE $rpc$CREATE FUNCTION public.append_admin_user_audit_event(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_action text,
  p_reason text,
  p_status text,
  p_correlation_id uuid,
  p_audit_counts jsonb,
  p_audit_flags jsonb,
  p_applied_at timestamptz,
  p_error_code text,
  p_request_id uuid,
  p_ip_hash text,
  p_user_agent_hash text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  audit_id uuid;
BEGIN
  IF p_actor_user_id IS NULL
     OR p_request_id IS NULL
     OR p_audit_counts IS NULL
     OR p_audit_flags IS NULL
     OR NOT EXISTS (
       SELECT 1
         FROM public.user_roles AS role_row
         JOIN public.user_account_status AS status_row
           ON status_row.user_id = role_row.user_id
        WHERE role_row.user_id = p_actor_user_id
          AND role_row.role::text = 'admin'
          AND status_row.account_status = 'active'
          AND status_row.disabled_at IS NULL
     )
     OR (p_status = 'applied') IS DISTINCT FROM (p_applied_at IS NOT NULL)
     OR NOT public.admin_user_audit_event_is_safe(
       p_action,
       p_status,
       p_reason,
       p_error_code,
       '{}'::jsonb,
       '{}'::jsonb,
       p_audit_counts,
       p_audit_flags,
       p_request_id::text,
       p_ip_hash,
       p_user_agent_hash
     ) THEN
    RAISE EXCEPTION 'admin_user_audit_event_invalid'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.admin_audit_events (
    actor_user_id,
    target_user_id,
    action,
    reason,
    before_state,
    after_state,
    audit_counts,
    audit_flags,
    status,
    correlation_id,
    applied_at,
    error_code,
    request_id,
    ip_hash,
    user_agent_hash
  ) VALUES (
    p_actor_user_id,
    p_target_user_id,
    p_action,
    p_reason,
    '{}'::jsonb,
    '{}'::jsonb,
    p_audit_counts,
    p_audit_flags,
    p_status,
    p_correlation_id,
    p_applied_at,
    p_error_code,
    p_request_id::text,
    p_ip_hash,
    p_user_agent_hash
  )
  RETURNING admin_audit_events.id INTO audit_id;

  RETURN audit_id;
END
$$;$rpc$;
  REVOKE ALL ON FUNCTION public.append_admin_user_audit_event(uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamp with time zone,text,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION public.append_admin_user_audit_event(uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamp with time zone,text,uuid,text,text) TO service_role;
 INSERT INTO privacy_retention.g014_public_rpc_allowlist(function_schema,function_name,identity_arguments,grantee,source_signature) SELECT 'public',p.proname,p.proargtypes::text,'service_role','public.read_admin_user_management_metadata(uuid[])' FROM pg_proc p WHERE p.oid=to_regprocedure('public.read_admin_user_management_metadata(uuid[])');
 INSERT INTO privacy_retention.g014_public_rpc_allowlist(function_schema,function_name,identity_arguments,grantee,source_signature) SELECT 'public',p.proname,p.proargtypes::text,'service_role','public.read_admin_user_audit_events(integer)' FROM pg_proc p WHERE p.oid=to_regprocedure('public.read_admin_user_audit_events(integer)');
 INSERT INTO privacy_retention.g014_public_rpc_allowlist(function_schema,function_name,identity_arguments,grantee,source_signature) SELECT 'public',p.proname,p.proargtypes::text,'service_role','public.append_admin_user_audit_event(uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamp with time zone,text,uuid,text,text)' FROM pg_proc p WHERE p.oid=to_regprocedure('public.append_admin_user_audit_event(uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamp with time zone,text,uuid,text,text)');
  RESET ROLE;
  REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;
-- BEGIN TARGET GUARD
 v_signature := 'public.read_admin_user_management_metadata(uuid[])'; v_oid := to_regprocedure(v_signature);
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='read_admin_user_management_metadata')<>1
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=v_oid AND proowner=v_owner AND prosecdef AND provolatile='s' AND prokind='f' AND proretset=true AND prorettype='record'::regtype AND pronargs=1 AND pronargdefaults=0 AND NOT proisstrict AND proparallel='u' AND proallargtypes=ARRAY['uuid[]'::regtype::oid,'uuid'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'timestamptz'::regtype::oid,'timestamptz'::regtype::oid,'boolean'::regtype::oid,'text'::regtype::oid] AND proargmodes=ARRAY['i','t','t','t','t','t','t','t','t','t']::"char"[] AND proargnames=ARRAY['p_user_ids','user_id','username','nickname','avatar_url','profile_role','profile_created_at','profile_updated_at','is_admin','account_status']::text[] AND proconfig=ARRAY['search_path=""']::text[] AND prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='c5bbfc08c18c198680419a192ccc70893f2338786af175555cdd3378ae97f656')
 OR NOT coalesce(has_function_privilege('service_role',v_oid,'EXECUTE'),false)
 OR coalesce(has_function_privilege('anon',v_oid,'EXECUTE'),true)
 OR coalesce(has_function_privilege('authenticated',v_oid,'EXECUTE'),true)
 OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=v_oid AND (a.grantee NOT IN (v_owner,'service_role'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable))
 OR (SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature=v_signature OR (function_schema='public' AND function_name='read_admin_user_management_metadata'))<>1
 OR NOT EXISTS(SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist a JOIN pg_proc p ON p.oid=v_oid WHERE a.source_signature=v_signature AND a.function_schema='public' AND a.function_name=p.proname AND a.identity_arguments=p.proargtypes::text AND a.grantee='service_role')
 THEN RAISE EXCEPTION 'admin_group_target_contract_denied'; END IF;
 v_signature := 'public.read_admin_user_audit_events(integer)'; v_oid := to_regprocedure(v_signature);
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='read_admin_user_audit_events')<>1
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=v_oid AND proowner=v_owner AND prosecdef AND provolatile='s' AND prokind='f' AND proretset=true AND prorettype='record'::regtype AND pronargs=1 AND pronargdefaults=0 AND NOT proisstrict AND proparallel='u' AND proallargtypes=ARRAY['integer'::regtype::oid,'uuid'::regtype::oid,'uuid'::regtype::oid,'uuid'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'uuid'::regtype::oid,'timestamptz'::regtype::oid,'text'::regtype::oid,'timestamptz'::regtype::oid,'jsonb'::regtype::oid,'jsonb'::regtype::oid] AND proargmodes=ARRAY['i','t','t','t','t','t','t','t','t','t','t','t','t']::"char"[] AND proargnames=ARRAY['p_limit','id','actor_user_id','target_user_id','action','reason','status','correlation_id','applied_at','error_code','created_at','audit_counts','audit_flags']::text[] AND proconfig=ARRAY['search_path=""']::text[] AND prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='b840e6884476b4790fc377fa042c67031d6cfef950caa1ce05d33ac81a8c9c6e')
 OR NOT coalesce(has_function_privilege('service_role',v_oid,'EXECUTE'),false)
 OR coalesce(has_function_privilege('anon',v_oid,'EXECUTE'),true)
 OR coalesce(has_function_privilege('authenticated',v_oid,'EXECUTE'),true)
 OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=v_oid AND (a.grantee NOT IN (v_owner,'service_role'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable))
 OR (SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature=v_signature OR (function_schema='public' AND function_name='read_admin_user_audit_events'))<>1
 OR NOT EXISTS(SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist a JOIN pg_proc p ON p.oid=v_oid WHERE a.source_signature=v_signature AND a.function_schema='public' AND a.function_name=p.proname AND a.identity_arguments=p.proargtypes::text AND a.grantee='service_role')
 THEN RAISE EXCEPTION 'admin_group_target_contract_denied'; END IF;
 v_signature := 'public.append_admin_user_audit_event(uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamp with time zone,text,uuid,text,text)'; v_oid := to_regprocedure(v_signature);
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='append_admin_user_audit_event')<>1
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=v_oid AND proowner=v_owner AND prosecdef AND provolatile='v' AND prokind='f' AND proretset=false AND prorettype='uuid'::regtype AND pronargs=13 AND pronargdefaults=0 AND NOT proisstrict AND proparallel='u' AND proallargtypes IS NULL AND proargmodes IS NULL AND proargnames=ARRAY['p_actor_user_id','p_target_user_id','p_action','p_reason','p_status','p_correlation_id','p_audit_counts','p_audit_flags','p_applied_at','p_error_code','p_request_id','p_ip_hash','p_user_agent_hash']::text[] AND proconfig=ARRAY['search_path=""']::text[] AND prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='2d4e8d8d1731edc0f5d5ea1cc57fd6c5dd3381faa1374fa96e3fd43a571057a6')
 OR NOT coalesce(has_function_privilege('service_role',v_oid,'EXECUTE'),false)
 OR coalesce(has_function_privilege('anon',v_oid,'EXECUTE'),true)
 OR coalesce(has_function_privilege('authenticated',v_oid,'EXECUTE'),true)
 OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=v_oid AND (a.grantee NOT IN (v_owner,'service_role'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable))
 OR (SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature=v_signature OR (function_schema='public' AND function_name='append_admin_user_audit_event'))<>1
 OR NOT EXISTS(SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist a JOIN pg_proc p ON p.oid=v_oid WHERE a.source_signature=v_signature AND a.function_schema='public' AND a.function_name=p.proname AND a.identity_arguments=p.proargtypes::text AND a.grantee='service_role')
 THEN RAISE EXCEPTION 'admin_group_target_contract_denied'; END IF;
-- END TARGET GUARD
 EXECUTE v_snapshot INTO v_after;
 IF v_after IS DISTINCT FROM v_before THEN RAISE EXCEPTION 'admin_group_catalog_restore_drift'; END IF;
 PERFORM pg_temp.admin_group_g014_check();
 GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;
 SET LOCAL ROLE privacy_workflow_owner;
 DROP FUNCTION pg_temp.admin_group_g014_check();
 RESET ROLE;
 REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;
 EXECUTE v_snapshot INTO v_after;
 IF v_after IS DISTINCT FROM v_before THEN RAISE EXCEPTION 'admin_group_cleanup_restore_drift'; END IF;
END
$admin_management_group$;
NOTIFY pgrst, 'reload schema';

COMMIT;
