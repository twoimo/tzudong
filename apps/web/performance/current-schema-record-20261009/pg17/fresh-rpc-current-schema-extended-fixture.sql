-- Synthetic full-source fixture. Root-reviewed pristine owned PG17 only.
-- Container tzudong-record-runtime-v3-20261009, network none/ports 0; validate label externally.
-- First source SHA 04d993212374b7be75e39452a189e6a990282f08e1993d622a4b24df681f1294.
-- Run with psql -X -v ON_ERROR_STOP=1. No source functions/roles/ACL/RLS/triggers are changed.
-- Setup inserts only synthetic rows under the existing bootstrap login. Actions run as
-- service_role with modern JSON claims. All seed/action changes end in ROLLBACK.
-- An ON_ERROR_STOP failure requires closing the connection for automatic rollback.
-- Unknown enum rejection is labeled schema-level if the enum makes a runtime branch unreachable.
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog,public,extensions;
SET LOCAL row_security=on;
DO $fx$
BEGIN
 IF current_database()<>'tzudong_fresh_pg17_61d148a598b0' OR session_user<>'supabase_admin'
    OR current_setting('server_version_num')::integer/10000<>17 THEN RAISE EXCEPTION 'FX_OWNED_DATABASE_DENIED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)'::regprocedure
   AND pg_get_userbyid(proowner)='postgres' AND NOT prosecdef AND proconfig=ARRAY['search_path=""']::text[]
   AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='5140ad2948b1890b1bbdf212bb89385b34ebad90fe9db60177ac91e7f760b892') THEN RAISE EXCEPTION 'FX_ACTION_SOURCE_DENIED'; END IF;
 IF (SELECT rolsuper FROM pg_roles WHERE rolname='postgres')
   OR has_function_privilege('privacy_workflow_owner','public.is_user_admin(uuid)'::regprocedure,'EXECUTE')
   OR has_function_privilege('privacy_workflow_owner','public.generate_unique_id(text,text,text)'::regprocedure,'EXECUTE')
   OR has_any_column_privilege('privacy_workflow_owner','public.restaurants'::regclass,'UPDATE')
   OR has_any_column_privilege('privacy_workflow_owner','public.restaurants'::regclass,'INSERT') THEN RAISE EXCEPTION 'FX_LEGACY_OWNER_GRANT_NOT_PRISTINE'; END IF;
END $fx$;
SELECT privacy_retention.assert_g014_workflow_owner_contract();
SELECT privacy_retention.assert_g014_public_rpc_allowlist();
SELECT privacy_retention.assert_g014_definer_contract();
SELECT privacy_retention.assert_g014_catalog_contract();
CREATE TEMP TABLE fx_proc_before AS SELECT oid,to_jsonb(p) AS state FROM pg_proc p;
CREATE TEMP TABLE fx_members_before AS TABLE pg_auth_members;
CREATE TEMP TABLE fx_roles_before AS TABLE pg_roles;
CREATE TEMP TABLE fx_trigger_before AS SELECT oid,tgrelid,tgname,tgenabled,tgfoid,pg_get_triggerdef(oid) AS definition FROM pg_trigger;
CREATE TEMP TABLE fx_actors AS SELECT gen_random_uuid() AS actor,gen_random_uuid() AS author;
CREATE TEMP TABLE fx_cases(seq integer PRIMARY KEY,name text UNIQUE,kind text,mode text,item_count integer,error_code text,restaurant_status text,missing boolean,
 submission uuid DEFAULT gen_random_uuid(),target uuid DEFAULT gen_random_uuid(),operation uuid DEFAULT gen_random_uuid());
INSERT INTO fx_cases(seq,name,kind,mode,item_count,error_code,restaurant_status,missing) VALUES
 (1,'new_provenance_trace','new','positive',1,NULL,'pending',false),
 (2,'edit_pending_preservation','edit','positive',1,NULL,'pending',true),
 (3,'edit_hold_preservation','edit','positive',1,NULL,'hold',true),
 (4,'edit_approved_preservation','edit','positive',1,NULL,'approved',false),
 (5,'null_decision_rejected','new','null_decision',1,'RECORD_ACTION_INVALID_PAYLOAD','pending',false),
 (6,'missing_decision_rejected','new','missing_decision',1,'RECORD_ACTION_INVALID_PAYLOAD','pending',false),
 (7,'unknown_decision_rejected','new','unknown_decision',1,'RECORD_ACTION_INVALID_PAYLOAD','pending',false),
 (8,'incomplete_pending_set_rejected','new','incomplete',2,'RECORD_ACTION_INVALID_PAYLOAD','pending',false),
 (9,'duplicate_item_rejected','new','duplicate',2,'RECORD_ACTION_INVALID_PAYLOAD','pending',false),
 (10,'foreign_item_rejected','new','foreign',2,'RECORD_ACTION_INVALID_PAYLOAD','pending',false),
 (11,'edit_missing_target_rejected','edit','missing_target',1,'RECORD_ACTION_STATE_CONFLICT','pending',false),
 (12,'edit_deleted_target_rejected','edit','deleted_target',1,'RECORD_ACTION_STATE_CONFLICT','deleted',true),
 (13,'new_existing_target_rejected','new','new_target',1,'RECORD_ACTION_STATE_CONFLICT','pending',false),
 (14,'all_reject_aggregate','new','all_reject',2,NULL,'pending',false),
 (15,'mixed_decisions_aggregate','new','mixed',2,NULL,'pending',false),
 (16,'approve_then_failure_atomic_rollback','new','approve_rollback',2,'RECORD_ACTION_INVALID_RESTAURANT','pending',false),
 (17,'reject_then_failure_atomic_rollback','new','reject_rollback',2,'RECORD_ACTION_INVALID_RESTAURANT','pending',false),
 (18,'restaurant_cas_preserves_later_admin','edit','restaurant_cas',1,'RECORD_ACTION_STALE','pending',true),
 (19,'item_cas_preserves_later_source','new','item_cas',1,'RECORD_ACTION_STALE','pending',false),
 (20,'historical_approved_item_preserved','edit','history_mix',2,NULL,'approved',false);
CREATE TEMP TABLE fx_items AS
SELECT c.seq,row_number() OVER(PARTITION BY c.seq ORDER BY id)::integer AS ordinal,id,
 'https://www.youtube.com/watch?v='||left(replace(id::text,'-',''),11) AS video
FROM fx_cases c CROSS JOIN LATERAL (SELECT gen_random_uuid() AS id FROM generate_series(1,c.item_count)) x;
CREATE TEMP TABLE fx_results(name text PRIMARY KEY,scope text NOT NULL);
GRANT SELECT ON fx_cases,fx_items,fx_actors TO service_role;
GRANT SELECT,INSERT ON fx_results TO service_role;
INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT actor,'authenticated','authenticated',actor::text||'@example.invalid','{"provider":"email","providers":["email"]}'::jsonb,
 jsonb_build_object('nickname','fx_admin_'||left(actor::text,6)),now(),now() FROM fx_actors
UNION ALL SELECT author,'authenticated','authenticated',author::text||'@example.invalid','{"provider":"email","providers":["email"]}'::jsonb,
 jsonb_build_object('nickname','fx_user_'||left(author::text,6)),now(),now() FROM fx_actors;
DO $fx$ BEGIN
 IF (SELECT count(*) FROM public.profiles p,fx_actors a WHERE p.user_id IN(a.actor,a.author))<>2
   OR (SELECT count(*) FROM public.user_stats p,fx_actors a WHERE p.user_id IN(a.actor,a.author))<>2 THEN RAISE EXCEPTION 'FX_AUTH_SEED_PREREQUISITE_MISSING'; END IF;
END $fx$;
INSERT INTO public.user_roles(user_id,role) SELECT actor,'admin'::public.app_role FROM fx_actors;
INSERT INTO public.user_account_status(user_id,account_status,disabled_at)
SELECT actor,'active',NULL::timestamptz FROM fx_actors UNION ALL SELECT author,'active',NULL::timestamptz FROM fx_actors
ON CONFLICT(user_id) DO NOTHING;
-- Existing edit rows use actual current columns, including preserved non-domain metadata.
INSERT INTO public.restaurants(id,approved_name,origin_name,naver_name,status,is_missing,source_type,created_by,trace_id,
 categories,lat,lng,jibun_address,road_address,geocoding_success,tzuyang_review,youtube_link,youtube_meta,evaluation_results,phone)
SELECT c.target,'FX_'||c.target::text,'FX_'||c.target::text,'FX_'||c.target::text,c.restaurant_status,c.missing,'crawler',a.author,'fx_'||c.target::text,
 ARRAY['한식'],37.5,127,'A_'||c.target::text,'R_'||c.target::text,false,'preserved source | 한글 [ts:00:12]',
 (SELECT video FROM fx_items WHERE seq=c.seq AND ordinal=1),
 '{"title":"stored title","operator_marker":"preserve","duration":42}'::jsonb,
 '{"fixture_evidence_marker":{"eval_value":true,"eval_basis":"synthetic preserved evidence"}}'::jsonb,NULL
FROM fx_cases c CROSS JOIN fx_actors a WHERE c.kind='edit' OR c.mode='new_target';
INSERT INTO public.restaurant_submissions(id,user_id,submission_type,restaurant_name,restaurant_address,restaurant_categories)
SELECT c.submission,a.author,c.kind::public.submission_type,'FX_'||c.submission::text,'A_'||c.submission::text,ARRAY['한식']
FROM fx_cases c CROSS JOIN fx_actors a;
INSERT INTO public.restaurant_submission_items(id,submission_id,youtube_link,tzuyang_review,target_restaurant_id,item_status)
SELECT i.id,c.submission,i.video,'stored item review [ts:00:12]',
 CASE WHEN (c.kind='edit' AND c.mode<>'missing_target') OR c.mode='new_target' THEN c.target ELSE NULL END,
 CASE WHEN c.mode='history_mix' AND i.ordinal=1 THEN 'approved' ELSE 'pending' END
FROM fx_items i JOIN fx_cases c USING(seq);
CREATE TEMP TABLE fx_restaurant_before AS SELECT r.id,to_jsonb(r) AS state FROM public.restaurants r WHERE id IN(SELECT target FROM fx_cases);
CREATE TEMP TABLE fx_item_before AS SELECT i.id,to_jsonb(i) AS state FROM public.restaurant_submission_items i WHERE id IN(SELECT id FROM fx_items);
GRANT SELECT ON fx_restaurant_before,fx_item_before TO service_role;
-- Disabled/missing-status administrator seeds use actual source fields. Status is
-- seeded before the admin role, so no last-admin removal or trigger bypass occurs.
CREATE TEMP TABLE fx_bad_actors AS SELECT mode,gen_random_uuid() AS id
FROM (VALUES('disabled'),('disabled_at'),('missing_status')) x(mode);
GRANT SELECT ON fx_bad_actors TO service_role;
INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT id,'authenticated','authenticated',id::text||'@example.invalid','{"provider":"email","providers":["email"]}'::jsonb,
 jsonb_build_object('nickname','fx_bad_'||left(id::text,8)),now(),now() FROM fx_bad_actors;
INSERT INTO public.user_account_status(user_id,account_status,disabled_at)
SELECT id,CASE WHEN mode='disabled' THEN 'disabled' ELSE 'active' END,
 CASE WHEN mode='disabled_at' THEN now() ELSE NULL::timestamptz END
FROM fx_bad_actors WHERE mode<>'missing_status';
INSERT INTO public.user_roles(user_id,role) SELECT id,'admin'::public.app_role FROM fx_bad_actors;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $fx$
DECLARE c record; a record; i record; payload jsonb; changes jsonb; decision text; entry jsonb; p jsonb; receipt jsonb; again jsonb; rb jsonb;
 before_snapshot jsonb; before_restaurants jsonb; after_restaurants jsonb; before_count integer; created_id uuid;
 caught boolean; claim_role text; claims text; before_row jsonb; after_row jsonb; expected_status text; first_item uuid; foreign_item uuid; negative_case boolean;
BEGIN
 SELECT * INTO STRICT a FROM fx_actors;
 FOR c IN SELECT * FROM fx_cases ORDER BY seq LOOP
  payload:=jsonb_build_object('items','[]'::jsonb);
  SELECT id INTO first_item FROM fx_items WHERE seq=c.seq AND ordinal=1;
  FOR i IN SELECT x.* FROM fx_items x JOIN public.restaurant_submission_items actual ON actual.id=x.id WHERE x.seq=c.seq AND actual.item_status='pending' ORDER BY x.id LOOP
   changes:=jsonb_build_object('approved_name','FX_'||i.id::text,'categories',jsonb_build_array('한식'),'lat',37.5,'lng',127,
     'jibun_address','A_'||i.id::text,'road_address','R_'||i.id::text,'geocoding_success',true,'youtube_link',i.video,
     'tzuyang_review','synthetic new review | 한글 [ts:00:12]','youtube_meta',jsonb_build_object('title','synthetic fixture video','duration',42));
   IF c.kind='edit' THEN changes:=jsonb_build_object('phone','02-1234-5678','youtube_meta',jsonb_build_object('title','edited title')); END IF;
   decision:='approve';
   IF c.mode IN('all_reject','history_mix') OR (c.mode='mixed' AND i.ordinal=2) OR (c.mode='reject_rollback' AND i.ordinal=1) THEN decision:='reject'; END IF;
   IF c.mode IN('approve_rollback','reject_rollback') AND i.ordinal=2 THEN changes:=changes||'{"categories":["invalid"]}'::jsonb; END IF;
   entry:=jsonb_build_object('id',i.id,'decision',decision);
   IF decision='approve' THEN entry:=entry||jsonb_build_object('changes',changes); ELSE entry:=entry||jsonb_build_object('reason','synthetic rejection'); END IF;
   IF c.mode='null_decision' THEN entry:=entry||'{"decision":null,"reason":"synthetic rejection"}'::jsonb; END IF;
   IF c.mode='missing_decision' THEN entry:=(entry-'decision')||'{"reason":"synthetic rejection"}'::jsonb; END IF;
   IF c.mode='unknown_decision' THEN entry:=entry||'{"decision":"unknown","reason":"synthetic rejection"}'::jsonb; END IF;
   IF c.mode='duplicate' THEN entry:=entry||jsonb_build_object('id',first_item); END IF;
   IF c.mode='foreign' AND i.ordinal=2 THEN SELECT id INTO foreign_item FROM fx_items WHERE seq=5 AND ordinal=1;entry:=entry||jsonb_build_object('id',foreign_item); END IF;
   IF NOT(c.mode='incomplete' AND i.ordinal=2) THEN payload:=jsonb_set(payload,'{items}',(payload->'items')||jsonb_build_array(entry)); END IF;
  END LOOP;
  claim_role:=current_setting('request.jwt.claim.role',true);claims:=current_setting('request.jwt.claims',true);
  p:=public.admin_record_action(a.actor,'preview',c.operation,'submission.approve',ARRAY[c.submission],payload,NULL);
  IF p->>'state'<>'preview' OR p->>'previewHash' IS NULL THEN RAISE EXCEPTION 'FX_PREVIEW_FAILED:%',c.name; END IF;
  IF c.mode='restaurant_cas' THEN UPDATE public.restaurants SET phone='02-9999-8888',updated_by_admin_id=a.actor,updated_at=clock_timestamp() WHERE id=c.target; END IF;
  IF c.mode='item_cas' THEN UPDATE public.restaurant_submission_items SET tzuyang_review='later synthetic source correction' WHERE id=first_item; END IF;
  before_snapshot:=pipeline_control.admin_record_snapshot('submission.approve',ARRAY[c.submission]);
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb),count(*) INTO before_restaurants,before_count FROM public.restaurants r;
  negative_case:=c.error_code IS NOT NULL;
  caught:=false;
  BEGIN
   receipt:=public.admin_record_action(a.actor,'apply',c.operation,'submission.approve',ARRAY[c.submission],payload,p->>'previewHash');
  EXCEPTION WHEN OTHERS THEN
   IF NOT negative_case OR SQLERRM IS DISTINCT FROM c.error_code THEN RAISE EXCEPTION 'FX_UNEXPECTED_ACTION_ERROR:%',c.name; END IF;
   caught:=true;
  END;
  IF negative_case THEN
   IF NOT caught THEN RAISE EXCEPTION 'FX_REQUIRED_REJECTION_MISSING:%',c.name; END IF;
   SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.id),'[]'::jsonb) INTO after_restaurants FROM public.restaurants r;
   IF after_restaurants IS DISTINCT FROM before_restaurants
     OR pipeline_control.admin_record_snapshot('submission.approve',ARRAY[c.submission]) IS DISTINCT FROM before_snapshot
     OR EXISTS(SELECT 1 FROM pipeline_control.admin_record_audit WHERE operation_id=c.operation)
     OR (public.admin_record_action(a.actor,'readback',c.operation)->>'state')<>'preview' THEN RAISE EXCEPTION 'FX_NEGATIVE_PARTIAL_MUTATION:%',c.name; END IF;
  ELSE
   IF receipt->>'state'<>'applied' THEN RAISE EXCEPTION 'FX_APPLY_RECEIPT:%',c.name; END IF;
   again:=public.admin_record_action(a.actor,'apply',c.operation,'submission.approve',ARRAY[c.submission],payload,p->>'previewHash');
   rb:=public.admin_record_action(a.actor,'readback',c.operation);
   IF again IS DISTINCT FROM receipt OR rb IS DISTINCT FROM receipt
     OR (SELECT count(*) FROM pipeline_control.admin_record_audit WHERE operation_id=c.operation)<>1
     OR NOT EXISTS(SELECT 1 FROM pipeline_control.admin_record_audit WHERE operation_id=c.operation AND id=(receipt->>'auditId')::uuid AND actor=a.actor AND action='submission.approve') THEN RAISE EXCEPTION 'FX_IDEMPOTENCY_READBACK_AUDIT:%',c.name; END IF;
   expected_status:=CASE WHEN c.mode='all_reject' THEN 'rejected' WHEN c.mode IN('mixed','history_mix') THEN 'partially_approved' ELSE 'approved' END;
   IF NOT EXISTS(SELECT 1 FROM public.restaurant_submissions WHERE id=c.submission AND status::text=expected_status AND resolved_by_admin_id=a.actor AND reviewed_at IS NOT NULL) THEN RAISE EXCEPTION 'FX_PARENT_AGGREGATION:%',c.name; END IF;
   FOR i IN SELECT x.*,actual.item_status,actual.target_restaurant_id,actual.rejection_reason FROM fx_items x JOIN public.restaurant_submission_items actual ON actual.id=x.id WHERE x.seq=c.seq ORDER BY x.id LOOP
    IF c.mode='history_mix' AND i.ordinal=1 THEN
     IF (SELECT to_jsonb(z) FROM public.restaurant_submission_items z WHERE z.id=i.id) IS DISTINCT FROM (SELECT state FROM fx_item_before WHERE id=i.id) THEN RAISE EXCEPTION 'FX_HISTORICAL_ITEM_OVERWRITE'; END IF;
    ELSIF c.mode='all_reject' OR (c.mode='mixed' AND i.ordinal=2) OR c.mode='history_mix' THEN
     IF i.item_status<>'rejected' OR i.rejection_reason<>'synthetic rejection' THEN RAISE EXCEPTION 'FX_REJECT_ITEM:%',c.name; END IF;
    ELSE
     IF i.item_status<>'approved' OR i.target_restaurant_id IS NULL THEN RAISE EXCEPTION 'FX_APPROVED_ITEM_LINK:%',c.name; END IF;
     SELECT to_jsonb(r) INTO after_row FROM public.restaurants r WHERE r.id=i.target_restaurant_id;
     IF c.kind='new' THEN
      IF after_row->>'source_type'<>'user_submission_new' OR (after_row->>'created_by')::uuid<>a.author
       OR (after_row->>'updated_by_admin_id')::uuid<>a.actor OR after_row->>'status'<>'approved'
       OR after_row->>'trace_id'<>encode(extensions.digest(coalesce(after_row->>'youtube_link','')||'|'||coalesce(after_row->>'approved_name','')||'|'||coalesce(after_row->>'tzuyang_review',''),'sha256'),'hex')
       OR after_row->>'tzuyang_review'<>'synthetic new review | 한글 [ts:00:12]' THEN RAISE EXCEPTION 'FX_NEW_PROVENANCE_TRACE:%',c.name; END IF;
      IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(receipt->'readback') x WHERE x->>'kind'='restaurant' AND x->>'id'=i.target_restaurant_id::text) THEN RAISE EXCEPTION 'FX_NEW_RESTAURANT_READBACK:%',c.name; END IF;
     ELSE
      SELECT state INTO before_row FROM fx_restaurant_before WHERE id=c.target;
      IF after_row->'status' IS DISTINCT FROM before_row->'status' OR after_row->'is_missing' IS DISTINCT FROM before_row->'is_missing'
       OR after_row->'evaluation_results' IS DISTINCT FROM before_row->'evaluation_results' OR after_row->'source_type' IS DISTINCT FROM before_row->'source_type'
       OR after_row->'created_by' IS DISTINCT FROM before_row->'created_by' OR after_row->'trace_id' IS DISTINCT FROM before_row->'trace_id'
       OR after_row->'tzuyang_review' IS DISTINCT FROM before_row->'tzuyang_review' OR after_row->'geocoding_success' IS DISTINCT FROM 'true'::jsonb
       OR after_row->'youtube_meta'->>'operator_marker'<>'preserve' OR after_row->>'phone'<>'02-1234-5678' THEN RAISE EXCEPTION 'FX_EDIT_PRESERVATION:%',c.name; END IF;
     END IF;
    END IF;
   END LOOP;
   IF (SELECT count(*) FROM public.restaurants)<>before_count+(CASE WHEN c.kind='new' AND c.mode<>'all_reject' THEN 1 ELSE 0 END) THEN RAISE EXCEPTION 'FX_NEW_ROW_COUNT:%',c.name; END IF;
   IF c.seq=1 THEN
    caught:=false;
    BEGIN PERFORM public.admin_record_action(a.actor,'apply',c.operation,'submission.approve',ARRAY[c.submission],payload||'{"note":"changed payload"}',p->>'previewHash');
    EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'RECORD_ACTION_IDEMPOTENCY_CONFLICT' THEN RAISE EXCEPTION 'FX_CHANGED_PAYLOAD_WRONG_ERROR'; END IF;caught:=true;END;
    IF NOT caught OR (SELECT count(*) FROM pipeline_control.admin_record_audit WHERE operation_id=c.operation)<>1 THEN RAISE EXCEPTION 'FX_CHANGED_PAYLOAD_MUTATION'; END IF;
    INSERT INTO fx_results VALUES('same_uuid_changed_payload_rejected','guarded_runtime');
   END IF;
  END IF;
  IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM claim_role OR current_setting('request.jwt.claims',true) IS DISTINCT FROM claims THEN RAISE EXCEPTION 'FX_CLAIMS_CHANGED:%',c.name; END IF;
  INSERT INTO fx_results VALUES(c.name,'guarded_runtime');
 END LOOP;
END $fx$;
DO $fx$
DECLARE b record; c record; denied_op_uuid uuid; caught boolean; payload jsonb;
BEGIN
 SELECT * INTO STRICT c FROM fx_cases WHERE seq=5;
 payload:=jsonb_build_object('items',jsonb_build_array(jsonb_build_object('id',(SELECT id FROM fx_items WHERE seq=5 AND ordinal=1),'decision','reject','reason','synthetic rejection')));
 FOR b IN SELECT id,mode FROM fx_bad_actors UNION ALL SELECT author,'non_admin' FROM fx_actors UNION ALL SELECT NULL::uuid,'null_actor' LOOP
  denied_op_uuid:=gen_random_uuid();caught:=false;
  BEGIN PERFORM public.admin_record_action(b.id,'preview',denied_op_uuid,'submission.approve',ARRAY[c.submission],payload,NULL);
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'RECORD_ACTION_FORBIDDEN' THEN RAISE EXCEPTION 'FX_ACTOR_WRONG_REJECTION:%',b.mode; END IF;caught:=true;END;
  IF NOT caught OR EXISTS(SELECT 1 FROM pipeline_control.admin_record_operations WHERE id=denied_op_uuid)
    OR EXISTS(SELECT 1 FROM pipeline_control.admin_record_audit WHERE operation_id=denied_op_uuid) THEN RAISE EXCEPTION 'FX_ACTOR_FORBIDDEN_MUTATION:%',b.mode; END IF;
  INSERT INTO fx_results VALUES('actor_'||b.mode||'_rejected','guarded_runtime');
 END LOOP;
END $fx$;
RESET ROLE;
-- Unknown type: use a real unsupported enum label if present. Otherwise the schema
-- itself rejects it; never add enum labels or redefine source tables to reach a branch.
DO $fx$
DECLARE enum_label text; c record; a record; p jsonb; caught boolean:=false;
BEGIN
 SELECT * INTO STRICT a FROM fx_actors;SELECT * INTO STRICT c FROM fx_cases WHERE seq=5;
 SELECT enumlabel INTO enum_label FROM pg_enum WHERE enumtypid='public.submission_type'::regtype AND enumlabel NOT IN('new','edit') ORDER BY enumsortorder LIMIT 1;
 IF enum_label IS NULL THEN
  BEGIN PERFORM 'unknown'::public.submission_type;
  EXCEPTION WHEN invalid_text_representation THEN caught:=true; END;
  IF NOT caught THEN RAISE EXCEPTION 'FX_UNKNOWN_ENUM_NOT_REJECTED'; END IF;
  INSERT INTO fx_results VALUES('unknown_type_rejected','schema_enum_rejection_runtime_branch_unreachable');
 ELSE
  UPDATE public.restaurant_submissions SET submission_type=enum_label::public.submission_type WHERE id=c.submission;
  EXECUTE 'SET LOCAL ROLE service_role';
  p:=public.admin_record_action(a.actor,'preview',gen_random_uuid(),'submission.approve',ARRAY[c.submission],jsonb_build_object('items',jsonb_build_array(jsonb_build_object('id',(SELECT id FROM fx_items WHERE seq=c.seq AND ordinal=1),'decision','reject','reason','synthetic rejection'))),NULL);
  BEGIN PERFORM public.admin_record_action(a.actor,'apply',(p->>'operationId')::uuid,'submission.approve',ARRAY[c.submission],jsonb_build_object('items',jsonb_build_array(jsonb_build_object('id',(SELECT id FROM fx_items WHERE seq=c.seq AND ordinal=1),'decision','reject','reason','synthetic rejection'))),p->>'previewHash');
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'RECORD_ACTION_STATE_CONFLICT' THEN RAISE EXCEPTION 'FX_UNKNOWN_TYPE_WRONG_ERROR'; END IF;caught:=true;END;
  IF NOT caught THEN RAISE EXCEPTION 'FX_UNKNOWN_TYPE_ACCEPTED'; END IF;
  EXECUTE 'RESET ROLE';
  INSERT INTO fx_results VALUES('unknown_type_rejected','guarded_runtime_existing_unsupported_enum_label');
 END IF;
END $fx$;
SELECT privacy_retention.assert_g014_workflow_owner_contract();
SELECT privacy_retention.assert_g014_public_rpc_allowlist();
SELECT privacy_retention.assert_g014_definer_contract();
SELECT privacy_retention.assert_g014_catalog_contract();
DO $fx$ BEGIN
 IF (SELECT count(*) FROM fx_results)<>27 THEN RAISE EXCEPTION 'FX_CASE_SET_INCOMPLETE'; END IF;
 IF EXISTS((SELECT oid,to_jsonb(p) FROM pg_proc p EXCEPT TABLE fx_proc_before) UNION ALL (TABLE fx_proc_before EXCEPT SELECT oid,to_jsonb(p) FROM pg_proc p)) THEN RAISE EXCEPTION 'FX_FUNCTION_METADATA_DRIFT'; END IF;
 IF EXISTS((TABLE pg_auth_members EXCEPT TABLE fx_members_before) UNION ALL (TABLE fx_members_before EXCEPT TABLE pg_auth_members)) THEN RAISE EXCEPTION 'FX_MEMBERSHIP_DRIFT'; END IF;
 IF EXISTS((TABLE pg_roles EXCEPT TABLE fx_roles_before) UNION ALL (TABLE fx_roles_before EXCEPT TABLE pg_roles)) THEN RAISE EXCEPTION 'FX_ROLE_DRIFT'; END IF;
 IF EXISTS((SELECT oid,tgrelid,tgname,tgenabled,tgfoid,pg_get_triggerdef(oid) FROM pg_trigger EXCEPT TABLE fx_trigger_before) UNION ALL (TABLE fx_trigger_before EXCEPT SELECT oid,tgrelid,tgname,tgenabled,tgfoid,pg_get_triggerdef(oid) FROM pg_trigger)) THEN RAISE EXCEPTION 'FX_TRIGGER_DRIFT'; END IF;
END $fx$;
SELECT jsonb_build_object('schema','current-schema-submission-extended-fixture/v1','status','checks_passed_in_transaction',
 'caseCount',(SELECT count(*) FROM fx_results),'cases',(SELECT jsonb_agg(jsonb_build_object('name',name,'scope',scope) ORDER BY name) FROM fx_results),
 'sourceFunctionsUnchanged',true,'rolesAndMembershipUnchanged',true,'sourceTriggersUnchanged',true,'assertionsPassed',4,
 'syntheticOnly',true,'externalCalls',0,'operatingWrites',false,'rollbackStillRequired',true,
 'limitations',jsonb_build_array('Unknown submission type may be rejected by the enum rather than a reachable handler branch.','Single-session CAS; no independent-connection race proof.','No provider/UI/Storage physical deletion or hosted application proof.'));
ROLLBACK;
