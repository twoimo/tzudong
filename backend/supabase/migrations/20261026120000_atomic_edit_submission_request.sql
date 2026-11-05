-- Candidate for a NEW migration after 20261025063810. Never append this to, or
-- change, the original hosted-pending custody SQL/contract/statement vector.
-- Hosted: original custody install -> terminal94 -> compatible activation ->
-- separately source-bound admission/journal for this migration. This file does
-- not authorize or perform that hosted operation.
-- Caller owns ONE read-committed transaction (psql -X -v ON_ERROR_STOP=1 -1 -f).
-- No BEGIN/COMMIT here: the ordinary local migration runner owns the transaction.

DO $edit_request_transaction$
BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres'
     OR current_setting('is_superuser') <> 'off'
     OR current_setting('transaction_read_only') <> 'off'
     OR current_setting('transaction_isolation') <> 'read committed'
     OR current_setting('server_version_num')::integer / 10000 NOT IN (15,17) THEN
    RAISE EXCEPTION 'edit_request_install_executor_denied' USING ERRCODE='42501';
  END IF;
  PERFORM pg_catalog.set_config('search_path','',true);
  PERFORM pg_catalog.set_config('edit_request_install.xact',pg_catalog.pg_current_xact_id()::text,true);
END $edit_request_transaction$;

DO $edit_request_pre$
DECLARE
  v_members jsonb;
  v_assertions jsonb;
BEGIN
  IF current_setting('edit_request_install.xact',true) IS NULL
     OR current_setting('edit_request_install.xact',true) IS DISTINCT FROM pg_catalog.pg_current_xact_id_if_assigned()::text THEN
    RAISE EXCEPTION 'edit_request_install_outer_transaction_required' USING ERRCODE='25000';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tzudong:atomic-edit-submission-install:v1',0));
  IF pg_catalog.to_regprocedure('public.hosted_pending_apply(uuid,uuid,text,jsonb)') IS NULL
     OR pg_catalog.to_regclass('pipeline_control.hosted_pending_operations') IS NULL
     OR pg_catalog.to_regclass('public.restaurant_submissions') IS NULL
     OR pg_catalog.to_regclass('public.restaurant_submission_items') IS NULL
     OR pg_catalog.to_regclass('privacy_retention.g014_public_rpc_allowlist') IS NULL
     OR pg_catalog.to_regclass('privacy_retention.g014_nested_helper_allowlist') IS NULL THEN
    RAISE EXCEPTION 'edit_request_install_prerequisite_missing' USING ERRCODE='55000';
  END IF;
  IF pg_catalog.to_regclass('pipeline_control.restaurant_edit_request_bindings') IS NOT NULL
     OR pg_catalog.to_regclass('pg_temp.edit_request_install_before') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname IN ('public','pipeline_control') AND p.proname='submit_restaurant_edit_request') THEN
    RAISE EXCEPTION 'edit_request_install_prior_conflict' USING ERRCODE='55000';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='privacy_retention' AND p.proname IN
      ('assert_g014_workflow_owner_contract','assert_g014_public_rpc_allowlist','assert_g014_definer_contract','assert_g014_catalog_contract')
      AND p.pronargs=0 AND p.prorettype='void'::regtype AND p.proowner='privacy_workflow_owner'::regrole) <> 4 THEN
    RAISE EXCEPTION 'edit_request_install_g014_identity_missing' USING ERRCODE='55000';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]') INTO v_members FROM pg_catalog.pg_auth_members m;
  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) INTO v_assertions FROM pg_catalog.pg_proc p
    WHERE p.oid=ANY(ARRAY['privacy_retention.assert_g014_workflow_owner_contract()'::regprocedure,
      'privacy_retention.assert_g014_public_rpc_allowlist()'::regprocedure,
      'privacy_retention.assert_g014_definer_contract()'::regprocedure,
      'privacy_retention.assert_g014_catalog_contract()'::regprocedure]::oid[]);
  -- The existing bridge is temporary, non-inherited, and removed before either
  -- invocation of the real owner assertion. PG15 has no membership options.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole
             AND member='postgres'::regrole AND grantor='postgres'::regrole) THEN
    RAISE EXCEPTION 'edit_request_install_membership_conflict' USING ERRCODE='42501';
  END IF;
  CREATE TEMP TABLE pg_temp.edit_request_install_before(memberships jsonb NOT NULL,assertions jsonb NOT NULL,registry jsonb) ON COMMIT DROP;
  INSERT INTO pg_temp.edit_request_install_before VALUES(v_members,v_assertions,NULL);
  IF current_setting('server_version_num')::integer / 10000 >= 16 THEN
    EXECUTE 'GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres';
  ELSE
    EXECUTE 'GRANT privacy_workflow_owner TO postgres';
  END IF;
  SET LOCAL ROLE privacy_workflow_owner;
  CREATE FUNCTION pg_temp.edit_request_g014_check(p_phase text) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $check$
  DECLARE v_registry jsonb;
  BEGIN
    IF session_user <> 'postgres' OR current_user <> 'privacy_workflow_owner'
       OR p_phase IS NULL OR p_phase NOT IN ('pre','post') THEN
      RAISE EXCEPTION 'edit_request_install_check_caller_denied' USING ERRCODE='42501';
    END IF;
    PERFORM privacy_retention.assert_g014_workflow_owner_contract();
    PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
    PERFORM privacy_retention.assert_g014_definer_contract();
    PERFORM privacy_retention.assert_g014_catalog_contract();
    v_registry:=jsonb_build_object(
      'public',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY source_signature,grantee),'[]')
        FROM privacy_retention.g014_public_rpc_allowlist r
        WHERE source_signature <> 'public.submit_restaurant_edit_request(uuid,text,uuid,jsonb)'),
      'nested',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY source_signature),'[]')
        FROM privacy_retention.g014_nested_helper_allowlist r
        WHERE source_signature <> 'pipeline_control.submit_restaurant_edit_request(uuid,text,uuid,jsonb)'));
    IF p_phase='post' THEN DROP FUNCTION pg_temp.edit_request_g014_check(text); END IF;
    RETURN v_registry;
  END $check$;
  REVOKE ALL ON FUNCTION pg_temp.edit_request_g014_check(text) FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION pg_temp.edit_request_g014_check(text) TO postgres;
  SET LOCAL ROLE postgres;
  IF current_setting('server_version_num')::integer / 10000 >= 16 THEN
    EXECUTE 'REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres';
  ELSE
    EXECUTE 'REVOKE privacy_workflow_owner FROM postgres';
  END IF;
  IF (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]') FROM pg_catalog.pg_auth_members m) IS DISTINCT FROM v_members THEN
    RAISE EXCEPTION 'edit_request_install_membership_drift' USING ERRCODE='55000';
  END IF;
  UPDATE pg_temp.edit_request_install_before SET registry=pg_temp.edit_request_g014_check('pre');
END $edit_request_pre$;

SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='15s';

-- Minimal idempotency binding only; no duplicate raw payload, user/key ledger,
-- expiry, new retention policy, or changes to the existing submission tables.
-- It follows the existing parent's deletion by the cascading FK.
CREATE TABLE pipeline_control.restaurant_edit_request_bindings (
  submission_id uuid PRIMARY KEY REFERENCES public.restaurant_submissions(id) ON DELETE CASCADE,
  request_sha256 text NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
  persisted_sha256 text NOT NULL CHECK (persisted_sha256 ~ '^[a-f0-9]{64}$')
);
ALTER TABLE pipeline_control.restaurant_edit_request_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_control.restaurant_edit_request_bindings FORCE ROW LEVEL SECURITY;
CREATE POLICY edit_request_binding_owner ON pipeline_control.restaurant_edit_request_bindings
  FOR ALL TO postgres USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE pipeline_control.restaurant_edit_request_bindings FROM PUBLIC,anon,authenticated,service_role,privacy_workflow_owner;

-- BEGIN atomic-edit runtime core (also exercised independently by component tests).
CREATE FUNCTION pipeline_control.submit_restaurant_edit_request(
  p_user_id uuid,p_client_request_key text,p_target_restaurant_id uuid,p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path='' SET lock_timeout='2s' AS $edit_request$
DECLARE
  v_id uuid;
  v_kind text;
  v_name text;
  v_address text;
  v_phone text;
  v_categories text[];
  v_items jsonb;
  v_item jsonb;
  v_count integer;
  v_request_sha text;
  v_expected_sha text;
  v_persisted_sha text;
  v_binding record;
  v_parent public.restaurant_submissions%ROWTYPE;
  v_note text;
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'service_role' AND session_user <> 'service_role' THEN
    RETURN jsonb_build_object('ok',false,'code','EDIT_SUBMISSION_UNAUTHORIZED');
  END IF;
  IF p_user_id IS NULL OR p_target_restaurant_id IS NULL
     OR p_client_request_key IS NULL OR p_client_request_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
     OR p_payload IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object'
     OR octet_length(p_payload::text)>65536 THEN
    RETURN jsonb_build_object('ok',false,'code','EDIT_SUBMISSION_INVALID');
  END IF;
  IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(p_payload) k)
       IS DISTINCT FROM ARRAY['address','category','name','phone','requestKind','youtube_reviews']::text[]
     OR jsonb_typeof(p_payload->'requestKind') IS DISTINCT FROM 'string'
     OR p_payload->>'requestKind' NOT IN ('edit','closure')
     OR jsonb_typeof(p_payload->'name') IS DISTINCT FROM 'string' OR length(p_payload->>'name')>160
     OR jsonb_typeof(p_payload->'address') IS DISTINCT FROM 'string' OR length(p_payload->>'address')>500
     OR jsonb_typeof(p_payload->'phone') IS DISTINCT FROM 'string' OR length(p_payload->>'phone')>40
     OR jsonb_typeof(p_payload->'category') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_payload->'youtube_reviews') IS DISTINCT FROM 'array' THEN
    RETURN jsonb_build_object('ok',false,'code','EDIT_SUBMISSION_INVALID');
  END IF;
  IF jsonb_array_length(p_payload->'category')>10 OR jsonb_array_length(p_payload->'youtube_reviews') NOT BETWEEN 1 AND 100
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'category') c
       WHERE jsonb_typeof(c) IS DISTINCT FROM 'string' OR length(c#>>'{}')>50 OR btrim(c#>>'{}')='') THEN
    RETURN jsonb_build_object('ok',false,'code','EDIT_SUBMISSION_INVALID');
  END IF;
  v_kind:=p_payload->>'requestKind'; v_name:=btrim(p_payload->>'name');
  v_address:=btrim(p_payload->>'address'); v_phone:=nullif(btrim(p_payload->>'phone'),'');
  SELECT coalesce(array_agg(btrim(c) ORDER BY btrim(c) COLLATE "C"),ARRAY[]::text[]) INTO v_categories
    FROM jsonb_array_elements_text(p_payload->'category') c;
  IF cardinality(v_categories)<>(SELECT count(DISTINCT c) FROM unnest(v_categories) c)
     OR (v_phone IS NOT NULL AND (v_phone !~ '^[0-9().[:space:]-]+$'
       OR regexp_replace(v_phone,'[^0-9]','','g') !~ '^(02[0-9]{7,8}|0[3-6][0-9]{7,8}|1[5-8][0-9]{6,7})$'))
     OR (v_kind='edit' AND (v_name='' OR v_address='' OR cardinality(v_categories)=0)) THEN
    RETURN jsonb_build_object('ok',false,'code','EDIT_SUBMISSION_INVALID');
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'youtube_reviews') LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      RETURN jsonb_build_object('ok',false,'code','EDIT_SUBMISSION_INVALID');
    END IF;
    IF (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(v_item) k)
         IS DISTINCT FROM ARRAY['restaurant_id','tzuyang_review','youtube_link']::text[]
       OR jsonb_typeof(v_item->'youtube_link') IS DISTINCT FROM 'string'
       OR length(v_item->>'youtube_link')>2048 OR btrim(v_item->>'youtube_link') !~ '^https?://'
       OR jsonb_typeof(v_item->'tzuyang_review') IS DISTINCT FROM 'string' OR length(v_item->>'tzuyang_review')>4000
       OR jsonb_typeof(v_item->'restaurant_id') IS DISTINCT FROM 'string'
       OR v_item->>'restaurant_id' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' THEN
      RETURN jsonb_build_object('ok',false,'code','EDIT_SUBMISSION_INVALID');
    END IF;
  END LOOP;
  SELECT jsonb_agg(jsonb_build_object('youtube_link',btrim(i->>'youtube_link'),
      'tzuyang_review',nullif(btrim(i->>'tzuyang_review'),''),'restaurant_id',(i->>'restaurant_id')::uuid)
      ORDER BY (i->>'restaurant_id')::uuid,btrim(i->>'youtube_link') COLLATE "C",nullif(btrim(i->>'tzuyang_review'),'') COLLATE "C")
    INTO v_items FROM jsonb_array_elements(p_payload->'youtube_reviews') i;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v_items) i WHERE (i->>'restaurant_id')::uuid=p_target_restaurant_id) THEN
    RETURN jsonb_build_object('ok',false,'code','EDIT_SUBMISSION_INVALID');
  END IF;
  v_count:=jsonb_array_length(v_items);
  v_note:=CASE WHEN v_kind='closure' THEN '폐업 제보: 사용자가 이 맛집이 폐업했거나 더 이상 영업하지 않는다고 알려왔습니다. 관리자 검토 후 상태/노출 여부를 결정하세요.' ELSE NULL END;
  v_request_sha:=encode(sha256(convert_to(jsonb_build_object('target',p_target_restaurant_id,'requestKind',v_kind,
    'name',v_name,'address',v_address,'phone',v_phone,'category',v_categories,'items',v_items)::text,'UTF8')),'hex');

  -- Serialize existing-key reconciliation on the ORIGINAL parent. Never adopt
  -- an old incomplete REST parent or repair/re-dispatch a mismatched request.
  SELECT * INTO v_parent FROM public.restaurant_submissions s WHERE s.user_id=p_user_id
    AND s.submission_type='edit' AND s.client_submission_key=p_client_request_key FOR UPDATE;
  IF NOT FOUND THEN
    IF v_kind='closure' AND v_name='' THEN
      SELECT coalesce(nullif(btrim(r.approved_name),''),nullif(btrim(r.naver_name),''),
        nullif(btrim(r.origin_name),''),nullif(btrim(r.google_name),''),nullif(btrim(r.channel_name),''))
        INTO v_name FROM public.restaurants r WHERE r.id=p_target_restaurant_id;
    END IF;
    -- Existing parent CHECKs are intentionally preserved (name<=100/categories<=5).
    IF v_name IS NULL OR length(v_name) NOT BETWEEN 1 AND 100 OR cardinality(v_categories)>5 THEN
      RETURN jsonb_build_object('ok',false,'code','EDIT_SUBMISSION_INVALID');
    END IF;
    INSERT INTO public.restaurant_submissions(user_id,submission_type,client_submission_key,status,
      restaurant_name,restaurant_address,restaurant_phone,restaurant_categories,admin_notes)
    VALUES(p_user_id,'edit',p_client_request_key,'pending',v_name,v_address,v_phone,v_categories,v_note)
    ON CONFLICT(user_id,submission_type,client_submission_key) WHERE client_submission_key IS NOT NULL DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN
      INSERT INTO public.restaurant_submission_items(submission_id,youtube_link,tzuyang_review,target_restaurant_id,item_status)
        SELECT v_id,i->>'youtube_link',i->>'tzuyang_review',(i->>'restaurant_id')::uuid,'pending'
        FROM jsonb_array_elements(v_items) i;
      v_expected_sha:=encode(sha256(convert_to(jsonb_build_object('name',v_name,'address',v_address,
        'phone',v_phone,'category',v_categories,'note',v_note,'items',v_items)::text,'UTF8')),'hex');
      -- INSERT completion/RETURNING alone is not a stored-set proof: a trigger
      -- may silently suppress or mutate rows. Any mismatch must RAISE so this
      -- block rolls back every write rather than return a partially saved set.
      SELECT * INTO v_parent FROM public.restaurant_submissions s WHERE s.id=v_id
        AND s.user_id=p_user_id AND s.submission_type='edit' AND s.client_submission_key=p_client_request_key FOR UPDATE;
      IF v_parent.id IS NULL OR v_parent.status<>'pending'
         OR (SELECT count(*) FROM public.restaurant_submission_items i WHERE i.submission_id=v_id)<>v_count
         OR EXISTS(SELECT 1 FROM public.restaurant_submission_items i WHERE i.submission_id=v_id AND i.item_status<>'pending') THEN
        RAISE EXCEPTION 'edit_request_persisted_set_mismatch';
      END IF;
      PERFORM 1 FROM public.restaurant_submission_items i WHERE i.submission_id=v_id FOR UPDATE;
      SELECT encode(sha256(convert_to(jsonb_build_object('name',v_parent.restaurant_name,'address',v_parent.restaurant_address,
        'phone',v_parent.restaurant_phone,'category',v_parent.restaurant_categories,'note',v_parent.admin_notes,
        'items',(SELECT jsonb_agg(jsonb_build_object('youtube_link',i.youtube_link,'tzuyang_review',i.tzuyang_review,
          'restaurant_id',i.target_restaurant_id) ORDER BY i.target_restaurant_id,i.youtube_link COLLATE "C",i.tzuyang_review COLLATE "C")
          FROM public.restaurant_submission_items i WHERE i.submission_id=v_id))::text,'UTF8')),'hex') INTO v_persisted_sha;
      IF v_persisted_sha IS DISTINCT FROM v_expected_sha THEN
        RAISE EXCEPTION 'edit_request_persisted_set_mismatch';
      END IF;
      INSERT INTO pipeline_control.restaurant_edit_request_bindings VALUES(v_id,v_request_sha,v_persisted_sha);
      SELECT * INTO v_binding FROM pipeline_control.restaurant_edit_request_bindings WHERE submission_id=v_id;
      IF v_binding.submission_id IS NULL OR v_binding.request_sha256 IS DISTINCT FROM v_request_sha
         OR v_binding.persisted_sha256 IS DISTINCT FROM v_persisted_sha THEN
        RAISE EXCEPTION 'edit_request_persisted_binding_mismatch';
      END IF;
      RETURN jsonb_build_object('ok',true,'code','EDIT_SUBMISSION_SAVED','id',v_id,'status','pending','itemCount',v_count);
    END IF;
    SELECT * INTO v_parent FROM public.restaurant_submissions s WHERE s.user_id=p_user_id
      AND s.submission_type='edit' AND s.client_submission_key=p_client_request_key FOR UPDATE;
  END IF;
  IF v_parent.id IS NULL OR v_parent.status<>'pending' THEN
    RETURN jsonb_build_object('ok',false,'code','EDIT_SUBMISSION_CONFLICT');
  END IF;
  PERFORM 1 FROM public.restaurant_submission_items i WHERE i.submission_id=v_parent.id FOR UPDATE;
  IF (SELECT count(*) FROM public.restaurant_submission_items i WHERE i.submission_id=v_parent.id)<>v_count
     OR EXISTS(SELECT 1 FROM public.restaurant_submission_items i WHERE i.submission_id=v_parent.id AND i.item_status<>'pending') THEN
    RETURN jsonb_build_object('ok',false,'code','EDIT_SUBMISSION_CONFLICT');
  END IF;
  SELECT * INTO v_binding FROM pipeline_control.restaurant_edit_request_bindings WHERE submission_id=v_parent.id;
  SELECT encode(sha256(convert_to(jsonb_build_object('name',v_parent.restaurant_name,'address',v_parent.restaurant_address,
    'phone',v_parent.restaurant_phone,'category',v_parent.restaurant_categories,'note',v_parent.admin_notes,
    'items',(SELECT jsonb_agg(jsonb_build_object('youtube_link',i.youtube_link,'tzuyang_review',i.tzuyang_review,
       'restaurant_id',i.target_restaurant_id) ORDER BY i.target_restaurant_id,i.youtube_link COLLATE "C",i.tzuyang_review COLLATE "C")
      FROM public.restaurant_submission_items i WHERE i.submission_id=v_parent.id))::text,'UTF8')),'hex') INTO v_persisted_sha;
  IF v_binding.submission_id IS NULL OR v_binding.request_sha256 IS DISTINCT FROM v_request_sha
     OR v_binding.persisted_sha256 IS DISTINCT FROM v_persisted_sha THEN
    RETURN jsonb_build_object('ok',false,'code','EDIT_SUBMISSION_CONFLICT');
  END IF;
  RETURN jsonb_build_object('ok',true,'code','EDIT_SUBMISSION_SAVED','id',v_parent.id,'status','pending','itemCount',v_count);
EXCEPTION
  -- This block covers ALL three writes. Any item/binding failure rolls back the
  -- parent and every prior item before the fixed failure JSON is returned.
  WHEN check_violation OR foreign_key_violation OR not_null_violation OR invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN jsonb_build_object('ok',false,'code','EDIT_SUBMISSION_INVALID');
  WHEN OTHERS THEN
    RETURN jsonb_build_object('ok',false,'code','EDIT_SUBMISSION_FAILED');
END $edit_request$;
REVOKE ALL ON FUNCTION pipeline_control.submit_restaurant_edit_request(uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role,privacy_workflow_owner;
GRANT EXECUTE ON FUNCTION pipeline_control.submit_restaurant_edit_request(uuid,text,uuid,jsonb) TO privacy_workflow_owner;
-- END atomic-edit runtime core.

DO $edit_request_registration_role$
BEGIN
  IF current_setting('server_version_num')::integer / 10000 >= 16 THEN
    EXECUTE 'GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres';
  ELSE
    EXECUTE 'GRANT privacy_workflow_owner TO postgres';
  END IF;
END $edit_request_registration_role$;
SET LOCAL ROLE privacy_workflow_owner;
LOCK TABLE privacy_retention.g014_public_rpc_allowlist,privacy_retention.g014_nested_helper_allowlist IN SHARE ROW EXCLUSIVE MODE;
CREATE FUNCTION public.submit_restaurant_edit_request(
  p_user_id uuid,p_client_request_key text,p_target_restaurant_id uuid,p_payload jsonb
) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' SET lock_timeout='2s'
AS $wrapper$ SELECT pipeline_control.submit_restaurant_edit_request($1,$2,$3,$4); $wrapper$;
REVOKE ALL ON FUNCTION public.submit_restaurant_edit_request(uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.submit_restaurant_edit_request(uuid,text,uuid,jsonb) TO service_role;
INSERT INTO privacy_retention.g014_public_rpc_allowlist(function_schema,function_name,identity_arguments,grantee,source_signature)
  SELECT 'public',p.proname,p.proargtypes::text,'service_role','public.submit_restaurant_edit_request(uuid,text,uuid,jsonb)'
  FROM pg_catalog.pg_proc p WHERE p.oid='public.submit_restaurant_edit_request(uuid,text,uuid,jsonb)'::regprocedure;
INSERT INTO privacy_retention.g014_nested_helper_allowlist(source_signature)
  VALUES('pipeline_control.submit_restaurant_edit_request(uuid,text,uuid,jsonb)');
SET LOCAL ROLE postgres;
DO $edit_request_registration_restore$
BEGIN
  IF current_setting('server_version_num')::integer / 10000 >= 16 THEN
    EXECUTE 'REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres';
  ELSE
    EXECUTE 'REVOKE privacy_workflow_owner FROM postgres';
  END IF;
END $edit_request_registration_restore$;

DO $edit_request_post$
DECLARE v_before record; v_assertions jsonb;
BEGIN
  SELECT * INTO STRICT v_before FROM pg_temp.edit_request_install_before;
  IF v_before.registry IS DISTINCT FROM pg_temp.edit_request_g014_check('post')
     OR v_before.memberships IS DISTINCT FROM (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]') FROM pg_catalog.pg_auth_members m) THEN
    RAISE EXCEPTION 'edit_request_install_g014_or_membership_drift' USING ERRCODE='55000';
  END IF;
  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) INTO v_assertions FROM pg_catalog.pg_proc p
    WHERE p.oid=ANY(ARRAY['privacy_retention.assert_g014_workflow_owner_contract()'::regprocedure,
      'privacy_retention.assert_g014_public_rpc_allowlist()'::regprocedure,
      'privacy_retention.assert_g014_definer_contract()'::regprocedure,
      'privacy_retention.assert_g014_catalog_contract()'::regprocedure]::oid[]);
  IF v_before.assertions IS DISTINCT FROM v_assertions THEN
    RAISE EXCEPTION 'edit_request_install_assertion_drift' USING ERRCODE='55000';
  END IF;
END $edit_request_post$;
NOTIFY pgrst,'reload schema';
