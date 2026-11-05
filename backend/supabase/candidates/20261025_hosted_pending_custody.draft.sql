-- COMPONENT DRAFT ONLY: use the separate full G014 installer; no operating admission.
-- New service-only RPCs need a separately reviewed G014 registry/owner bridge.
-- Installed by the local PG17 harness only. Applied migrations remain immutable.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL search_path='';
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='pipeline_control' AND c.relname LIKE 'hosted_pending_%')
   OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','pipeline_control') AND (p.proname LIKE 'hosted_pending_%' OR (n.nspname='pipeline_control' AND p.proname IN ('pending_digest','pending_items','pending_current','pending_request_read'))))
  THEN RAISE EXCEPTION 'PENDING_RESERVED_OBJECT_EXISTS' USING ERRCODE='55000'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='pipeline_control' AND nspowner='postgres'::regrole AND nspacl::text='{postgres=UC/postgres,service_role=U/postgres}')
  THEN RAISE EXCEPTION 'PENDING_NAMESPACE_PREIMAGE_DRIFT' USING ERRCODE='55000'; END IF;
  IF current_user <> 'postgres' OR current_setting('server_version_num')::int/10000 <> 17
    OR to_regprocedure('public.extract_youtube_video_id(text)') IS NULL
    OR to_regprocedure('public.resolve_restaurant_identity_name(text,text,text,text)') IS NULL
    OR to_regprocedure('public.normalize_restaurant_identity_name(text)') IS NULL
    OR to_regclass('public.idx_restaurants_active_video_identity') IS NULL
    OR to_regclass('public.idx_restaurants_active_candidate_identity') IS NOT NULL
  THEN RAISE EXCEPTION 'PENDING_CUSTODY_PREREQUISITE' USING ERRCODE='55000'; END IF;
  IF EXISTS(SELECT 1 FROM (VALUES
    ('extract_youtube_video_id(text)','5ecf7a06fa89265b12773210448acf17fc3b612fe80583346bb217358af11016'),
    ('resolve_restaurant_identity_name(text,text,text,text)','3a63c3941c3e157bb601a8df0dfebcf800e8d47d98bb9e3533ab10fc82487464'),
    ('normalize_restaurant_identity_name(text)','706d9005f6978684d01bcd375a6ba0249e3cb51ed46c08e62e4996d5f6f6263a')
  ) required(signature,sha) LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.'||signature)
    WHERE p.oid IS NULL OR p.proowner<>'postgres'::regrole OR p.provolatile<>'i' OR p.prosecdef
      OR encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')<>required.sha)
    OR NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid='public.idx_restaurants_active_video_identity'::regclass
      AND indrelid='public.restaurants'::regclass AND indisunique AND indisvalid AND indisready AND indnkeyatts=2
      AND pg_get_expr(indexprs,indrelid)=$expr$public.extract_youtube_video_id(youtube_link), public.normalize_restaurant_identity_name(public.resolve_restaurant_identity_name(approved_name, origin_name, naver_name, google_name))$expr$
      AND pg_get_expr(indpred,indrelid)=$pred$((status <> 'deleted'::text) AND (public.extract_youtube_video_id(youtube_link) <> ''::text) AND (public.normalize_restaurant_identity_name(public.resolve_restaurant_identity_name(approved_name, origin_name, naver_name, google_name)) IS NOT NULL))$pred$)
  THEN RAISE EXCEPTION 'PENDING_IDENTITY_SOURCE_DRIFT' USING ERRCODE='55000'; END IF;
END $$;
CREATE TABLE pipeline_control.hosted_pending_operations (
  request_id uuid PRIMARY KEY,
  binding_sha text NOT NULL UNIQUE,
  source_revision text NOT NULL,
  freshness jsonb NOT NULL,
  items jsonb NOT NULL,
  state text NOT NULL CHECK(state IN ('prepared','claimed','committed','held')),
  sender_id uuid,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Only an owner-reviewed cutover imports known legacy uncertainty. No API clears it.
-- evidence_sha is a receipt digest, not a fabricated operation/input fingerprint.
CREATE TABLE pipeline_control.hosted_pending_legacy_holds (
 video text PRIMARY KEY CHECK(video ~ '^[A-Za-z0-9_-]{11}$'),
 evidence_sha text NOT NULL CHECK(evidence_sha ~ '^[a-f0-9]{64}$')
);
ALTER TABLE pipeline_control.hosted_pending_legacy_holds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pipeline_control.hosted_pending_legacy_holds FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE pipeline_control.hosted_pending_identity_custody (
  video text NOT NULL,
  name text NOT NULL,
  request_id uuid NOT NULL REFERENCES pipeline_control.hosted_pending_operations,
  PRIMARY KEY(video,name)
);
ALTER TABLE pipeline_control.hosted_pending_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_control.hosted_pending_identity_custody ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pipeline_control.hosted_pending_operations,
 pipeline_control.hosted_pending_identity_custody FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION pipeline_control.pending_digest(value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT encode(sha256(convert_to(value::text,'UTF8')),'hex');
$$;
CREATE FUNCTION pipeline_control.pending_items(rows jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE row_value jsonb; items jsonb:='[]'; video text; name text; item jsonb;
  allowed text[]:=ARRAY['trace_id','youtube_link','channel_name','recollect_version','status',
   'origin_name','reasoning_basis','naver_name','google_name','categories','tzuyang_review',
   'origin_address','road_address','jibun_address','english_address','lat','lng',
   'geocoding_success','is_missing','is_not_selected','youtube_meta','evaluation_results',
   'source_type','review_count'];
BEGIN
 IF rows IS NULL OR jsonb_typeof(rows)<>'array' OR jsonb_array_length(rows) NOT BETWEEN 1 AND 200
   OR octet_length(rows::text)>2097152
 THEN RAISE EXCEPTION 'PENDING_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 FOR row_value IN SELECT value FROM jsonb_array_elements(rows) LOOP
  IF jsonb_typeof(row_value)<>'object'
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(row_value) k WHERE NOT(k=ANY(allowed)))
    OR NOT(row_value ?& allowed)
    OR row_value->>'status' IS DISTINCT FROM 'pending'
    OR row_value->'review_count' IS DISTINCT FROM '0'::jsonb
    OR row_value->'is_missing' IS DISTINCT FROM 'false'::jsonb
    OR row_value->'is_not_selected' IS DISTINCT FROM 'false'::jsonb
    OR jsonb_typeof(row_value->'trace_id') IS DISTINCT FROM 'string'
    OR row_value->>'trace_id' !~ '^[A-Za-z0-9_-]{1,128}$'
    OR (
      (row_value->'geocoding_success'='true' AND jsonb_typeof(row_value->'lat')='number' AND jsonb_typeof(row_value->'lng')='number')
      OR (row_value#>>'{evaluation_results,location_match_TF,pending_reason}' IN ('ambiguous_chain','multi_candidate','insufficient_evidence')
       AND coalesce(row_value#>>'{evaluation_results,location_match_TF,match_status}','')<>'confirmed_from_video')
    ) IS NOT TRUE
  THEN RAISE EXCEPTION 'PENDING_INPUT_INVALID' USING ERRCODE='22023'; END IF;
  video:=public.extract_youtube_video_id(row_value->>'youtube_link');
  name:=public.normalize_restaurant_identity_name(public.resolve_restaurant_identity_name(NULL,
    row_value->>'origin_name',row_value->>'naver_name',row_value->>'google_name'));
  IF coalesce(video,'') !~ '^[A-Za-z0-9_-]{11}$' OR name IS NULL THEN
    RAISE EXCEPTION 'PENDING_IDENTITY_INVALID' USING ERRCODE='22023'; END IF;
  item:=jsonb_build_object('video',video,'name',name,'trace',row_value->>'trace_id',
    'payloadSha',pipeline_control.pending_digest(row_value));
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(items) x WHERE x->>'video'=video AND x->>'name'=name AND x<>item)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(items) x WHERE x->>'trace'=item->>'trace' AND x<>item)
  THEN RAISE EXCEPTION 'PENDING_SET_AMBIGUOUS' USING ERRCODE='22023'; END IF;
  IF NOT items @> jsonb_build_array(item) THEN items:=items||jsonb_build_array(item); END IF;
 END LOOP;
 RETURN (SELECT jsonb_agg(x ORDER BY x->>'video',x->>'name') FROM jsonb_array_elements(items) x);
END $$;

-- Call only while holding restaurants SHARE ROW EXCLUSIVE in prepare/apply.
CREATE FUNCTION pipeline_control.pending_current(item jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE active_ids uuid[]; conflict boolean; deleted boolean;
BEGIN
 SELECT array_agg(r.id ORDER BY r.id) FILTER(WHERE r.status<>'deleted' AND
   public.normalize_restaurant_identity_name(public.resolve_restaurant_identity_name(r.approved_name,r.origin_name,r.naver_name,r.google_name))=item->>'name'),
   coalesce(bool_or(
    (r.trace_id=item->>'trace' AND (public.extract_youtube_video_id(r.youtube_link) IS DISTINCT FROM item->>'video'
      OR public.normalize_restaurant_identity_name(public.resolve_restaurant_identity_name(r.approved_name,r.origin_name,r.naver_name,r.google_name)) IS DISTINCT FROM item->>'name'))
    OR (public.extract_youtube_video_id(r.youtube_link)=item->>'video' AND item->>'name'=ANY(ARRAY[
       public.normalize_restaurant_identity_name(r.approved_name),public.normalize_restaurant_identity_name(r.origin_name),
       public.normalize_restaurant_identity_name(r.naver_name),public.normalize_restaurant_identity_name(r.google_name)])
      AND public.normalize_restaurant_identity_name(public.resolve_restaurant_identity_name(r.approved_name,r.origin_name,r.naver_name,r.google_name)) IS DISTINCT FROM item->>'name')
   ),false),
   coalesce(bool_or(r.status='deleted' AND (r.trace_id=item->>'trace' OR
      (public.extract_youtube_video_id(r.youtube_link)=item->>'video' AND
       public.normalize_restaurant_identity_name(public.resolve_restaurant_identity_name(r.approved_name,r.origin_name,r.naver_name,r.google_name))=item->>'name'))),false)
 INTO active_ids,conflict,deleted FROM public.restaurants r
 WHERE public.extract_youtube_video_id(r.youtube_link)=item->>'video' OR r.trace_id=item->>'trace';
 IF conflict OR coalesce(cardinality(active_ids),0)>1 THEN RETURN jsonb_build_object('action','unresolved'); END IF;
 IF cardinality(active_ids)=1 THEN RETURN jsonb_build_object('action','present','id',active_ids[1]); END IF;
 IF deleted THEN RETURN jsonb_build_object('action','unresolved'); END IF;
 RETURN jsonb_build_object('action','absent');
END $$;

CREATE FUNCTION public.hosted_pending_prepare(request_id uuid,source_revision text,freshness jsonb,rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE items jsonb; binding text; operation pipeline_control.hosted_pending_operations;
  item jsonb; current_item jsonb; augmented jsonb:='[]'; owner_id uuid; blocked boolean:=false;
BEGIN
 IF request_id IS NULL OR source_revision IS NULL OR source_revision !~ '^[0-9a-f]{40}$'
   OR freshness IS NULL OR jsonb_typeof(freshness)<>'object'
   OR (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(freshness) k) IS DISTINCT FROM ARRAY['complete','contract','inputSha256','sourceSha256']::text[]
   OR freshness->>'contract' IS DISTINCT FROM 'local-pipeline-candidate-set-v1'
   OR freshness->'complete' IS DISTINCT FROM 'true'::jsonb
   OR coalesce(freshness->>'inputSha256','') !~ '^[0-9a-f]{64}$'
   OR coalesce(freshness->>'sourceSha256','') !~ '^[0-9a-f]{64}$'
 THEN RAISE EXCEPTION 'PENDING_FRESHNESS_INVALID' USING ERRCODE='22023'; END IF;
 items:=pipeline_control.pending_items(rows);
 binding:=pipeline_control.pending_digest(jsonb_build_array(source_revision,freshness,items));
 -- Universal table lock also blocks noncooperating ordinary restaurant DML.
 -- Consistent order: restaurant table, then custody/operation row locks.
 LOCK TABLE public.restaurants IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE pipeline_control.hosted_pending_legacy_holds IN SHARE MODE;
 SELECT * INTO operation FROM pipeline_control.hosted_pending_operations o WHERE o.request_id=hosted_pending_prepare.request_id;
 IF FOUND AND operation.binding_sha<>binding THEN RAISE EXCEPTION 'PENDING_REQUEST_DRIFT' USING ERRCODE='22023'; END IF;
 SELECT * INTO operation FROM pipeline_control.hosted_pending_operations o WHERE o.binding_sha=binding;
 IF FOUND THEN RETURN jsonb_build_object('requestId',operation.request_id,'state',operation.state,'created',false,'bindingSha',binding); END IF;
 INSERT INTO pipeline_control.hosted_pending_operations VALUES(request_id,binding,source_revision,freshness,items,'prepared',NULL,NULL,clock_timestamp());
 FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
  current_item:=pipeline_control.pending_current(item);
  IF EXISTS(SELECT 1 FROM pipeline_control.hosted_pending_legacy_holds h WHERE h.video=item->>'video') THEN
   current_item:=jsonb_build_object('action','unresolved');
  END IF;
  IF EXISTS(SELECT 1 FROM pipeline_control.hosted_pending_operations prior
    WHERE prior.request_id<>hosted_pending_prepare.request_id AND prior.state<>'committed'
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(prior.items) other WHERE other->>'video'=item->>'video'))
  THEN current_item:=jsonb_build_object('action','unresolved'); END IF;
  IF current_item->>'action'='absent' THEN
   SELECT c.request_id INTO owner_id FROM pipeline_control.hosted_pending_identity_custody c WHERE c.video=item->>'video' AND c.name=item->>'name';
   IF owner_id IS NOT NULL AND owner_id<>request_id THEN current_item:=jsonb_build_object('action','unresolved'); END IF;
  END IF;
  blocked:=blocked OR current_item->>'action'='unresolved';
  augmented:=augmented||jsonb_build_array(item||jsonb_build_object('atPrepare',current_item));
 END LOOP;
 IF NOT blocked THEN
  FOR item IN SELECT value FROM jsonb_array_elements(augmented) WHERE value#>>'{atPrepare,action}'='absent' LOOP
   INSERT INTO pipeline_control.hosted_pending_identity_custody VALUES(item->>'video',item->>'name',request_id);
  END LOOP;
 END IF;
 UPDATE pipeline_control.hosted_pending_operations o SET items=augmented,state=CASE WHEN blocked THEN 'held' ELSE 'prepared' END WHERE o.request_id=hosted_pending_prepare.request_id;
 RETURN jsonb_build_object('requestId',request_id,'state',CASE WHEN blocked THEN 'held' ELSE 'prepared' END,'created',true,'bindingSha',binding);
END $$;

CREATE FUNCTION public.hosted_pending_claim(request_id uuid,sender_id uuid,binding_sha text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE operation pipeline_control.hosted_pending_operations;
BEGIN
 IF sender_id IS NULL THEN RAISE EXCEPTION 'PENDING_SENDER_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO operation FROM pipeline_control.hosted_pending_operations o WHERE o.request_id=hosted_pending_claim.request_id FOR UPDATE;
 IF NOT FOUND OR binding_sha IS DISTINCT FROM operation.binding_sha THEN RAISE EXCEPTION 'PENDING_REQUEST_DRIFT' USING ERRCODE='22023'; END IF;
 IF operation.state<>'prepared' THEN RETURN jsonb_build_object('claimed',false,'state',operation.state); END IF;
 UPDATE pipeline_control.hosted_pending_operations o SET state='claimed',sender_id=hosted_pending_claim.sender_id WHERE o.request_id=hosted_pending_claim.request_id;
 RETURN jsonb_build_object('claimed',true,'state','claimed');
END $$;

CREATE FUNCTION public.hosted_pending_apply(request_id uuid,sender_id uuid,binding_sha text,rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE operation pipeline_control.hosted_pending_operations; items jsonb; item jsonb; current_item jsonb;
  original_item jsonb; payload jsonb; result_value jsonb:='[]'; row_id uuid; blocked boolean:=false;
BEGIN
 items:=pipeline_control.pending_items(rows);
 LOCK TABLE public.restaurants IN SHARE ROW EXCLUSIVE MODE;
 LOCK TABLE pipeline_control.hosted_pending_legacy_holds IN SHARE MODE;
 SELECT * INTO operation FROM pipeline_control.hosted_pending_operations o WHERE o.request_id=hosted_pending_apply.request_id FOR UPDATE;
 IF NOT FOUND OR binding_sha IS DISTINCT FROM operation.binding_sha
   OR operation.sender_id IS DISTINCT FROM sender_id
   OR pipeline_control.pending_digest(jsonb_build_array(operation.source_revision,operation.freshness,items))<>operation.binding_sha
 THEN RAISE EXCEPTION 'PENDING_REQUEST_DRIFT' USING ERRCODE='22023'; END IF;
 IF operation.state='committed' THEN RETURN jsonb_build_object('state','committed','replayed',true,'rows',operation.result); END IF;
 IF operation.state<>'claimed' THEN RAISE EXCEPTION 'PENDING_STATE_HELD' USING ERRCODE='55000'; END IF;
 -- Preflight ALL members before any restaurant insert. Admin edits are preserved.
 FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
  current_item:=pipeline_control.pending_current(item);
  IF EXISTS(SELECT 1 FROM pipeline_control.hosted_pending_legacy_holds h WHERE h.video=item->>'video') THEN
   current_item:=jsonb_build_object('action','unresolved');
  END IF;
  SELECT value INTO original_item FROM jsonb_array_elements(operation.items) WHERE value->>'video'=item->>'video' AND value->>'name'=item->>'name';
  IF current_item->>'action'='absent' AND (
    original_item#>>'{atPrepare,action}'<>'absent' OR NOT EXISTS(SELECT 1 FROM pipeline_control.hosted_pending_identity_custody c
      WHERE c.video=item->>'video' AND c.name=item->>'name' AND c.request_id=hosted_pending_apply.request_id))
  THEN current_item:=jsonb_build_object('action','unresolved'); END IF;
  blocked:=blocked OR current_item->>'action'='unresolved';
  result_value:=result_value||jsonb_build_array(jsonb_build_object('identitySha',pipeline_control.pending_digest(jsonb_build_array(item->>'video',item->>'name')),
    'video',item->>'video')||current_item);
 END LOOP;
 IF blocked THEN
  UPDATE pipeline_control.hosted_pending_operations o SET state='held',result=result_value WHERE o.request_id=hosted_pending_apply.request_id;
  RETURN jsonb_build_object('state','held','replayed',false,'rows',result_value);
 END IF;
 result_value:='[]';
 FOR item IN SELECT value FROM jsonb_array_elements(items) LOOP
  current_item:=pipeline_control.pending_current(item);
  IF EXISTS(SELECT 1 FROM pipeline_control.hosted_pending_legacy_holds h WHERE h.video=item->>'video') THEN
   current_item:=jsonb_build_object('action','unresolved');
  END IF;
  IF current_item->>'action'='absent' THEN
   SELECT value INTO payload FROM jsonb_array_elements(rows) WHERE pipeline_control.pending_digest(value)=item->>'payloadSha' LIMIT 1;
   INSERT INTO public.restaurants(trace_id,youtube_link,channel_name,recollect_version,status,origin_name,reasoning_basis,
     naver_name,google_name,categories,tzuyang_review,origin_address,road_address,jibun_address,english_address,lat,lng,
     geocoding_success,is_missing,is_not_selected,youtube_meta,evaluation_results,source_type,review_count)
   SELECT p.trace_id,p.youtube_link,p.channel_name,p.recollect_version,'pending',p.origin_name,p.reasoning_basis,
     p.naver_name,p.google_name,p.categories,p.tzuyang_review,p.origin_address,p.road_address,p.jibun_address,p.english_address,p.lat,p.lng,
     p.geocoding_success,p.is_missing,p.is_not_selected,p.youtube_meta,p.evaluation_results,p.source_type,0
   FROM jsonb_populate_record(NULL::public.restaurants,payload) p RETURNING id INTO row_id;
   current_item:=jsonb_build_object('action','inserted','id',row_id);
  END IF;
  result_value:=result_value||jsonb_build_array(jsonb_build_object('identitySha',pipeline_control.pending_digest(jsonb_build_array(item->>'video',item->>'name')),
    'video',item->>'video')||current_item);
 END LOOP;
 UPDATE pipeline_control.hosted_pending_operations o SET state='committed',result=result_value WHERE o.request_id=hosted_pending_apply.request_id;
 RETURN jsonb_build_object('state','committed','replayed',false,'rows',result_value);
EXCEPTION WHEN OTHERS THEN
 RAISE EXCEPTION 'PENDING_APPLY_FAILED' USING ERRCODE=SQLSTATE;
END $$;

CREATE FUNCTION pipeline_control.pending_request_read(request_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH operation AS MATERIALIZED (
  SELECT * FROM pipeline_control.hosted_pending_operations o WHERE o.request_id=pending_request_read.request_id
 ), current_rows AS MATERIALIZED (
  SELECT i,pipeline_control.pending_current(i) AS observed
  FROM operation o CROSS JOIN LATERAL jsonb_array_elements(o.items) i
 )
 SELECT jsonb_build_object('requestId',o.request_id,'bindingSha',o.binding_sha,'state',o.state,
   'rows',o.result,'replayAllowed',false,'sourceRevision',o.source_revision,'freshness',o.freshness,
   'currentRows',coalesce((SELECT jsonb_agg(jsonb_build_object('identitySha',pipeline_control.pending_digest(jsonb_build_array(i->>'video',i->>'name')),
      'video',i->>'video')||observed ORDER BY i->>'video',i->>'name') FROM current_rows),'[]'::jsonb),
   'currentSetPresent',NOT EXISTS(SELECT 1 FROM current_rows WHERE observed->>'action'<>'present'),
   'originalRowsStillPresent',o.state='committed' AND NOT EXISTS(
     SELECT 1 FROM jsonb_array_elements(o.result) r WHERE NOT EXISTS(
       SELECT 1 FROM current_rows c WHERE c.observed->>'action'='present' AND c.observed->>'id'=r->>'id')),
   'relatedRequestIds',coalesce((SELECT jsonb_agg(DISTINCT prior.request_id ORDER BY prior.request_id)
     FROM pipeline_control.hosted_pending_operations prior
     WHERE prior.request_id<>o.request_id AND EXISTS(SELECT 1 FROM jsonb_array_elements(prior.items) pi JOIN current_rows r ON pi->>'video'=r.i->>'video')),'[]'::jsonb))
 FROM operation o;
$$;
CREATE FUNCTION public.hosted_pending_read(request_id uuid DEFAULT NULL,video_ids text[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE answer jsonb; n integer;
BEGIN
 IF request_id IS NOT NULL AND video_ids IS NULL THEN
  RETURN pipeline_control.pending_request_read(request_id);
 ELSIF request_id IS NULL AND cardinality(video_ids) BETWEEN 1 AND 100 AND NOT EXISTS(SELECT 1 FROM unnest(video_ids) v WHERE v IS NULL OR v !~ '^[A-Za-z0-9_-]{11}$') THEN
  SELECT count(*) INTO n FROM (SELECT 1 FROM pipeline_control.hosted_pending_operations o
   WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(o.items) i WHERE i->>'video'=ANY(video_ids)) LIMIT 101) bounded;
  IF n>100 THEN RAISE EXCEPTION 'PENDING_DISCOVERY_UNBOUNDED' USING ERRCODE='54000'; END IF;
  SELECT coalesce(jsonb_agg(pipeline_control.pending_request_read(o.request_id) ORDER BY o.created_at,o.request_id),'[]')
   INTO answer FROM pipeline_control.hosted_pending_operations o
   WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(o.items) i WHERE i->>'video'=ANY(video_ids));
  RETURN jsonb_build_object('videos',to_jsonb(video_ids),'legacyHeld',coalesce((SELECT jsonb_agg(h.video ORDER BY h.video) FROM pipeline_control.hosted_pending_legacy_holds h WHERE h.video=ANY(video_ids)),'[]'),
    'operations',answer,'replayAllowed',false);
 END IF;
 RAISE EXCEPTION 'PENDING_READ_INVALID' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION pipeline_control.pending_digest(jsonb),pipeline_control.pending_items(jsonb),pipeline_control.pending_current(jsonb),pipeline_control.pending_request_read(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.hosted_pending_prepare(uuid,text,jsonb,jsonb),public.hosted_pending_claim(uuid,uuid,text),public.hosted_pending_apply(uuid,uuid,text,jsonb),public.hosted_pending_read(uuid,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hosted_pending_prepare(uuid,text,jsonb,jsonb),public.hosted_pending_claim(uuid,uuid,text),public.hosted_pending_apply(uuid,uuid,text,jsonb),public.hosted_pending_read(uuid,text[]) TO service_role;
COMMIT;
