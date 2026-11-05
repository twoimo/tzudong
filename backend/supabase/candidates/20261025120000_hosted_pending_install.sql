-- DRAFT: provisional slot; no operating release admission. Full-schema local candidate only.
-- Private candidate: hosted-pending custody; local compiler rehearsal ledger 93 -> 94.
-- The unchanged atomic compiler owns ledger and transaction; its caller takes
-- tzudong:review-media-sql-successor:workflow:v1 before the ledger lock.
-- No assertion grants, component owner lease, policy activation or table grants.

-- A per-transaction marker makes psql per-statement autocommit fail before any
-- persistent feature/role change. It is an accident guard, not an auth token.
DO $pending_custody_install_transaction$
BEGIN
  IF current_user<>'postgres' OR session_user<>'postgres'
     OR pg_catalog.current_setting('is_superuser')<>'off'
     OR pg_catalog.current_setting('server_version_num')::integer<>170006
     OR pg_catalog.current_setting('transaction_read_only')<>'off'
     OR pg_catalog.current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'pending_custody_install_executor_denied' USING ERRCODE='42501';
  END IF;
  PERFORM pg_catalog.set_config('search_path','',true);
  PERFORM pg_catalog.set_config('pending_custody_install.xact',pg_catalog.pg_current_xact_id()::text,true);
END $pending_custody_install_transaction$;

DO $pending_custody_install_pre$
DECLARE before_members jsonb; after_members jsonb; assertion_metadata jsonb; checker oid;
BEGIN
  IF pg_catalog.current_setting('pending_custody_install.xact',true) IS DISTINCT FROM pg_catalog.pg_current_xact_id_if_assigned()::text
     OR pg_catalog.current_setting('pending_custody_install.xact',true) IS NULL THEN
    RAISE EXCEPTION 'pending_custody_install_outer_transaction_required' USING ERRCODE='25000';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tzudong:hosted-pending-install:v1',0));
  IF pg_catalog.to_regclass('pg_temp.pending_custody_install_before') IS NOT NULL
     OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE pronamespace=pg_catalog.pg_my_temp_schema() AND proname='pending_custody_install_g014_check') THEN
    RAISE EXCEPTION 'pending_custody_install_prior_conflict' USING ERRCODE='55000';
  END IF;
  IF pg_catalog.pg_has_role('postgres','privacy_workflow_owner','SET')
     OR pg_catalog.pg_has_role('postgres','privacy_workflow_owner','USAGE')
     OR (SELECT count(*) FROM pg_catalog.pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole AND member='postgres'::regrole)<>1
     OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole AND member='postgres'::regrole
       AND grantor='supabase_admin'::regrole AND admin_option AND NOT inherit_option AND NOT set_option) THEN
    RAISE EXCEPTION 'pending_custody_install_membership_denied' USING ERRCODE='42501';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='privacy_retention' AND p.proname IN ('assert_g014_workflow_owner_contract','assert_g014_public_rpc_allowlist','assert_g014_definer_contract','assert_g014_catalog_contract'))<>4
     OR EXISTS(SELECT 1 FROM (VALUES
       ('privacy_retention.assert_g014_workflow_owner_contract()','345aed9acb1da06262740ef06d81e51855a44c7470aa8b431a23e6fa629aab1d',false),
       ('privacy_retention.assert_g014_public_rpc_allowlist()','f23203a0a2366eca16b30b256729e859efc556952df8cb75485924153e1188ef',true),
       ('privacy_retention.assert_g014_definer_contract()','bb8dc8d2e4020f70b2332cbdf6acf465a97cbc4d582f9f14415330247ae34131',true),
       ('privacy_retention.assert_g014_catalog_contract()','5c5971a5578e09db25a41e88474f1da15acfbd658571ba28f29e8c226e4d1883',true)
     ) expected(signature,body_sha256,definer)
     LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(expected.signature)
     WHERE p.oid IS NULL OR p.proowner<>'privacy_workflow_owner'::regrole OR p.prosecdef IS DISTINCT FROM expected.definer
       OR p.prokind<>'f' OR p.prorettype<>'void'::regtype OR p.proretset OR p.pronargs<>0
       OR p.proargnames IS NOT NULL OR p.proargmodes IS NOT NULL OR p.proargdefaults IS NOT NULL
       OR p.pronargdefaults<>0 OR p.provariadic<>0 OR p.prosupport<>0 OR p.procost<>100 OR p.prorows<>0
       OR p.proisstrict OR p.proleakproof OR p.provolatile<>'v' OR p.proparallel<>'u'
       OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
       OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
       OR p.proacl::text IS DISTINCT FROM '{privacy_workflow_owner=X/privacy_workflow_owner}'
       OR pg_catalog.octet_length(p.prosrc)>65536
       OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')<>expected.body_sha256) THEN
    RAISE EXCEPTION 'pending_custody_install_assertion_source_drift' USING ERRCODE='55000';
  END IF;
  SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) INTO before_members FROM pg_catalog.pg_auth_members m;
  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) INTO assertion_metadata FROM pg_catalog.pg_proc p
    WHERE p.oid=ANY(ARRAY['privacy_retention.assert_g014_workflow_owner_contract()'::regprocedure,
      'privacy_retention.assert_g014_public_rpc_allowlist()'::regprocedure,
      'privacy_retention.assert_g014_definer_contract()'::regprocedure,
      'privacy_retention.assert_g014_catalog_contract()'::regprocedure]::oid[]);
  CREATE TEMPORARY TABLE pg_temp.pending_custody_install_before(memberships jsonb NOT NULL,assertions jsonb NOT NULL,unchanged jsonb NOT NULL) ON COMMIT DROP;
  INSERT INTO pg_temp.pending_custody_install_before VALUES(before_members,assertion_metadata,'{}');
  GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
  SET LOCAL ROLE privacy_workflow_owner;
  CREATE FUNCTION pg_temp.pending_custody_install_g014_check(p_phase text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $check$
  BEGIN
    IF session_user<>'postgres' OR current_user<>'privacy_workflow_owner' OR p_phase IS NULL OR p_phase NOT IN ('pre','post') THEN
      RAISE EXCEPTION 'pending_custody_install_check_caller_denied' USING ERRCODE='42501';
    END IF;
    PERFORM privacy_retention.assert_g014_workflow_owner_contract();
    PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
    PERFORM privacy_retention.assert_g014_definer_contract();
    PERFORM privacy_retention.assert_g014_catalog_contract();
    IF p_phase='post' THEN DROP FUNCTION pg_temp.pending_custody_snapshot(); DROP FUNCTION pg_temp.pending_custody_install_g014_check(text); END IF;
  END $check$;
  CREATE FUNCTION pg_temp.pending_custody_snapshot() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $snap$ SELECT jsonb_build_object(
 'members',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m),
 'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_roles r),
 'defaults',(SELECT coalesce(jsonb_agg(to_jsonb(d) ORDER BY oid),'[]') FROM pg_default_acl d),
 'publicRegistry',(SELECT jsonb_agg(to_jsonb(r) ORDER BY source_signature,grantee) FROM privacy_retention.g014_public_rpc_allowlist r WHERE function_name NOT LIKE 'hosted_pending_%'),
 'nestedRegistry',(SELECT jsonb_agg(to_jsonb(r) ORDER BY source_signature) FROM privacy_retention.g014_nested_helper_allowlist r WHERE source_signature NOT LIKE 'pipeline_control.hosted_pending_%'),
 'catalog',(SELECT jsonb_agg(to_jsonb(r) ORDER BY manifest_kind,manifest_key) FROM privacy_retention.g014_catalog_contract_manifest r),
 'oldTables',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity) ORDER BY c.oid) FROM pg_class c WHERE c.relnamespace='pipeline_control'::regnamespace AND c.relkind='r' AND c.relname NOT LIKE 'hosted_pending_%'),
 'assertions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_proc p WHERE p.oid=ANY(ARRAY['privacy_retention.assert_g014_workflow_owner_contract()'::regprocedure,'privacy_retention.assert_g014_public_rpc_allowlist()'::regprocedure,'privacy_retention.assert_g014_definer_contract()'::regprocedure,'privacy_retention.assert_g014_catalog_contract()'::regprocedure]::oid[]))); $snap$;
  REVOKE ALL ON FUNCTION pg_temp.pending_custody_snapshot() FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION pg_temp.pending_custody_snapshot() TO postgres;
  REVOKE ALL ON FUNCTION pg_temp.pending_custody_install_g014_check(text) FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION pg_temp.pending_custody_install_g014_check(text) TO postgres;
  SET LOCAL ROLE postgres;
  REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;
  SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) INTO after_members FROM pg_catalog.pg_auth_members m;
  IF after_members IS DISTINCT FROM before_members THEN
    RAISE EXCEPTION 'pending_custody_install_pre_membership_drift' USING ERRCODE='55000';
  END IF;
  checker:=pg_catalog.to_regprocedure('pg_temp.pending_custody_install_g014_check(text)');
  IF checker IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=checker
      AND p.proowner='privacy_workflow_owner'::regrole AND p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[]
      AND (SELECT count(*)=2 AND bool_and(a.privilege_type='EXECUTE' AND NOT a.is_grantable
        AND a.grantee IN ('postgres'::regrole,'privacy_workflow_owner'::regrole)) FROM pg_catalog.aclexplode(p.proacl) a)) THEN
    RAISE EXCEPTION 'pending_custody_install_bridge_drift' USING ERRCODE='55000';
  END IF;
  PERFORM pg_temp.pending_custody_install_g014_check('pre');
  UPDATE pg_temp.pending_custody_install_before SET unchanged=pg_temp.pending_custody_snapshot();
END $pending_custody_install_pre$;


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

-- New fixed wrappers use the existing G014 owner boundary, without assertion edits.
GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
GRANT USAGE ON SCHEMA pipeline_control TO privacy_workflow_owner;
ALTER FUNCTION public.hosted_pending_prepare(uuid,text,jsonb,jsonb) SET SCHEMA pipeline_control;
REVOKE ALL ON FUNCTION pipeline_control.hosted_pending_prepare(uuid,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role,privacy_workflow_owner;
GRANT EXECUTE ON FUNCTION pipeline_control.hosted_pending_prepare(uuid,text,jsonb,jsonb) TO privacy_workflow_owner;
ALTER FUNCTION public.hosted_pending_claim(uuid,uuid,text) SET SCHEMA pipeline_control;
REVOKE ALL ON FUNCTION pipeline_control.hosted_pending_claim(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role,privacy_workflow_owner;
GRANT EXECUTE ON FUNCTION pipeline_control.hosted_pending_claim(uuid,uuid,text) TO privacy_workflow_owner;
ALTER FUNCTION public.hosted_pending_apply(uuid,uuid,text,jsonb) SET SCHEMA pipeline_control;
REVOKE ALL ON FUNCTION pipeline_control.hosted_pending_apply(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role,privacy_workflow_owner;
GRANT EXECUTE ON FUNCTION pipeline_control.hosted_pending_apply(uuid,uuid,text,jsonb) TO privacy_workflow_owner;
ALTER FUNCTION public.hosted_pending_read(uuid,text[]) SET SCHEMA pipeline_control;
REVOKE ALL ON FUNCTION pipeline_control.hosted_pending_read(uuid,text[]) FROM PUBLIC,anon,authenticated,service_role,privacy_workflow_owner;
GRANT EXECUTE ON FUNCTION pipeline_control.hosted_pending_read(uuid,text[]) TO privacy_workflow_owner;
SET LOCAL ROLE privacy_workflow_owner;
LOCK TABLE privacy_retention.g014_public_rpc_allowlist,privacy_retention.g014_nested_helper_allowlist IN SHARE ROW EXCLUSIVE MODE;
CREATE FUNCTION public.hosted_pending_prepare(request_id uuid,source_revision text,freshness jsonb,rows jsonb) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $wrap$ SELECT pipeline_control.hosted_pending_prepare($1,$2,$3,$4); $wrap$;
REVOKE ALL ON FUNCTION public.hosted_pending_prepare(uuid,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hosted_pending_prepare(uuid,text,jsonb,jsonb) TO service_role;
INSERT INTO privacy_retention.g014_public_rpc_allowlist(function_schema,function_name,identity_arguments,grantee,source_signature) SELECT 'public',p.proname,p.proargtypes::text,'service_role','public.hosted_pending_prepare(uuid,text,jsonb,jsonb)' FROM pg_proc p WHERE p.oid='public.hosted_pending_prepare(uuid,text,jsonb,jsonb)'::regprocedure;
INSERT INTO privacy_retention.g014_nested_helper_allowlist(source_signature) VALUES('pipeline_control.hosted_pending_prepare(uuid,text,jsonb,jsonb)');
CREATE FUNCTION public.hosted_pending_claim(request_id uuid,sender_id uuid,binding_sha text) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $wrap$ SELECT pipeline_control.hosted_pending_claim($1,$2,$3); $wrap$;
REVOKE ALL ON FUNCTION public.hosted_pending_claim(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hosted_pending_claim(uuid,uuid,text) TO service_role;
INSERT INTO privacy_retention.g014_public_rpc_allowlist(function_schema,function_name,identity_arguments,grantee,source_signature) SELECT 'public',p.proname,p.proargtypes::text,'service_role','public.hosted_pending_claim(uuid,uuid,text)' FROM pg_proc p WHERE p.oid='public.hosted_pending_claim(uuid,uuid,text)'::regprocedure;
INSERT INTO privacy_retention.g014_nested_helper_allowlist(source_signature) VALUES('pipeline_control.hosted_pending_claim(uuid,uuid,text)');
CREATE FUNCTION public.hosted_pending_apply(request_id uuid,sender_id uuid,binding_sha text,rows jsonb) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s' AS $wrap$ SELECT pipeline_control.hosted_pending_apply($1,$2,$3,$4); $wrap$;
REVOKE ALL ON FUNCTION public.hosted_pending_apply(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hosted_pending_apply(uuid,uuid,text,jsonb) TO service_role;
INSERT INTO privacy_retention.g014_public_rpc_allowlist(function_schema,function_name,identity_arguments,grantee,source_signature) SELECT 'public',p.proname,p.proargtypes::text,'service_role','public.hosted_pending_apply(uuid,uuid,text,jsonb)' FROM pg_proc p WHERE p.oid='public.hosted_pending_apply(uuid,uuid,text,jsonb)'::regprocedure;
INSERT INTO privacy_retention.g014_nested_helper_allowlist(source_signature) VALUES('pipeline_control.hosted_pending_apply(uuid,uuid,text,jsonb)');
CREATE FUNCTION public.hosted_pending_read(request_id uuid DEFAULT NULL,video_ids text[] DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $wrap$ SELECT pipeline_control.hosted_pending_read($1,$2); $wrap$;
REVOKE ALL ON FUNCTION public.hosted_pending_read(uuid,text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.hosted_pending_read(uuid,text[]) TO service_role;
INSERT INTO privacy_retention.g014_public_rpc_allowlist(function_schema,function_name,identity_arguments,grantee,source_signature) SELECT 'public',p.proname,p.proargtypes::text,'service_role','public.hosted_pending_read(uuid,text[])' FROM pg_proc p WHERE p.oid='public.hosted_pending_read(uuid,text[])'::regprocedure;
INSERT INTO privacy_retention.g014_nested_helper_allowlist(source_signature) VALUES('pipeline_control.hosted_pending_read(uuid,text[])');
SET LOCAL ROLE postgres;
REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;
DO $pending_post$
BEGIN
 -- Full G014 validates the graph, not this feature's private-core ACL narrowing.
 IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE p.proname LIKE 'hosted_pending_%' AND n.nspname IN ('public','pipeline_control') AND (
    p.proowner<>CASE WHEN n.nspname='public' THEN 'privacy_workflow_owner'::regrole ELSE 'postgres'::regrole END
    OR NOT p.prosecdef OR p.provolatile<>CASE WHEN p.proname='hosted_pending_read' THEN 's'::"char" ELSE 'v'::"char" END
    OR p.proconfig IS DISTINCT FROM CASE WHEN p.proname='hosted_pending_read' THEN ARRAY['search_path=""'] ELSE ARRAY['search_path=""','lock_timeout=2s'] END
    OR p.proacl::text IS DISTINCT FROM CASE WHEN n.nspname='public' THEN '{privacy_workflow_owner=X/privacy_workflow_owner,service_role=X/privacy_workflow_owner}' ELSE '{postgres=X/postgres,privacy_workflow_owner=X/postgres}' END))
 OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname LIKE 'hosted_pending_%' AND n.nspname IN ('public','pipeline_control'))<>8
 OR EXISTS(SELECT 1 FROM pg_proc p WHERE p.pronamespace='pipeline_control'::regnamespace AND p.proname IN ('pending_digest','pending_items','pending_current','pending_request_read') AND (p.proowner<>'postgres'::regrole OR p.prosecdef OR p.proacl::text IS DISTINCT FROM '{postgres=X/postgres}'))
 OR EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace='pipeline_control'::regnamespace AND c.relkind='r' AND c.relname LIKE 'hosted_pending_%' AND (c.relowner<>'postgres'::regrole OR NOT c.relrowsecurity OR c.relacl::text IS DISTINCT FROM '{postgres=arwdDxtm/postgres}'))
 OR (SELECT nspacl::text FROM pg_namespace WHERE nspname='pipeline_control') IS DISTINCT FROM '{postgres=UC/postgres,service_role=U/postgres,privacy_workflow_owner=U/postgres}'
 THEN RAISE EXCEPTION 'PENDING_INSTALL_NEW_OBJECT_DRIFT'; END IF;
 IF pg_has_role('postgres','privacy_workflow_owner','SET') OR pg_has_role('postgres','privacy_workflow_owner','USAGE')
  OR (SELECT memberships FROM pg_temp.pending_custody_install_before) IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_auth_members m)
  OR (SELECT unchanged FROM pg_temp.pending_custody_install_before) IS DISTINCT FROM pg_temp.pending_custody_snapshot()
 THEN RAISE EXCEPTION 'PENDING_INSTALL_PRESERVATION_DRIFT'; END IF;
 PERFORM pg_temp.pending_custody_install_g014_check('post');
END $pending_post$;

DROP TABLE pg_temp.pending_custody_install_before;
NOTIFY pgrst,'reload schema';
