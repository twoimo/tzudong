BEGIN;
GRANT privacy_workflow_owner TO postgres;
INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at, last_sign_in_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated',
  'g028-reauth@example.invalid', 'disabled', clock_timestamp(), clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()
);
SET LOCAL ROLE privacy_workflow_owner;
DO $$
DECLARE
  u uuid := '11111111-1111-4111-8111-111111111111'; o uuid := '12121212-1212-4212-8212-121212121212'; s uuid := '22222222-2222-4222-8222-222222222222'; s2 uuid := '34343434-3434-4434-8434-343434343434'; p uuid; x uuid; q uuid := '33333333-3333-4333-8333-333333333333'; e bigint := extract(epoch FROM clock_timestamp())::bigint; c text; t timestamptz;
BEGIN
  -- Fresh password AMR need not be the array tail.
  c := jsonb_build_object('role','authenticated','sub',u::text,'session_id',s::text,'iat',e-1,'exp',e+600,'amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',e-1),jsonb_build_object('method','otp','timestamp',e)))::text;
  PERFORM set_config('request.jwt.claims',c,true); PERFORM set_config('request.jwt.claim.role','authenticated',true);
  SELECT proof_id INTO p FROM public.issue_account_deletion_reauth_proof(u); IF p IS NULL THEN RAISE EXCEPTION 'G028 non-tail fresh password AMR issue failed'; END IF;
  PERFORM set_config('request.jwt.claims',(c::jsonb-'session_id')::text,true); BEGIN PERFORM public.issue_account_deletion_reauth_proof(u); RAISE EXCEPTION 'G028 missing session succeeded'; EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'account_deletion_reauth_proof_invalid_claims' THEN RAISE; END IF; END;
  PERFORM set_config('request.jwt.claims',jsonb_set(c::jsonb,'{amr}',jsonb_build_array(jsonb_build_object('method','password','timestamp',e-301),jsonb_build_object('method','otp','timestamp',e)))::text,true); BEGIN PERFORM public.issue_account_deletion_reauth_proof(u); RAISE EXCEPTION 'G028 old password AMR succeeded'; EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'account_deletion_reauth_proof_password_reauthentication_required' THEN RAISE; END IF; END;
  PERFORM set_config('request.jwt.claims',c,true);
  -- A second session mismatch must fail without consuming the proof.
  PERFORM set_config('request.jwt.claims',jsonb_set(c::jsonb,'{session_id}',to_jsonb(s2::text))::text,true);
  BEGIN PERFORM public.consume_account_deletion_reauth_proof(p,u,'41414141-4141-4414-8414-414141414141','second-session-mismatch'); RAISE EXCEPTION 'G028 second session mismatch succeeded'; EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'account_deletion_reauth_proof_not_available' THEN RAISE; END IF; END;
  PERFORM set_config('request.jwt.claims',jsonb_set(c::jsonb,'{sub}',to_jsonb(o::text))::text,true);
  BEGIN PERFORM public.consume_account_deletion_reauth_proof(p,o,'42424242-4242-4424-8424-424242424242','cross-user-target'); RAISE EXCEPTION 'G028 cross-user target succeeded'; EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'account_deletion_reauth_proof_not_available' THEN RAISE; END IF; END;
  PERFORM set_config('request.jwt.claims',c,true);
  SELECT proof_id INTO x FROM public.issue_account_deletion_reauth_proof(u);
  UPDATE account_deletion_private.reauth_proofs SET expires_at=issued_at + interval '1 microsecond' WHERE proof_id=x;
  BEGIN PERFORM public.consume_account_deletion_reauth_proof(x,u,'43434343-4343-4434-8434-434343434343','expired-proof'); RAISE EXCEPTION 'G028 expired proof succeeded'; EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'account_deletion_reauth_proof_not_available' THEN RAISE; END IF; END;
  INSERT INTO account_deletion_private.reauth_proofs (proof_id,actor_user_id,target_user_id,session_id,password_reauthenticated_at,issued_at,expires_at) VALUES (q,u,u,s,clock_timestamp() - interval '6 minutes',clock_timestamp() - interval '6 minutes',clock_timestamp() - interval '2 minutes');
  SELECT proof_id INTO p FROM public.issue_account_deletion_reauth_proof(u);
  IF EXISTS (SELECT 1 FROM account_deletion_private.reauth_proofs WHERE proof_id=q) THEN RAISE EXCEPTION 'G028 issue did not clean expired actor proof'; END IF;
END; $$;
RESET ROLE;
DO $$ BEGIN
  IF has_schema_privilege('authenticated','account_deletion_private','USAGE') OR has_table_privilege('authenticated','account_deletion_private.reauth_proofs','SELECT, INSERT, UPDATE, DELETE') OR has_table_privilege('service_role','account_deletion_private.reauth_proofs','SELECT, INSERT, UPDATE, DELETE') OR NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='account_deletion_private.reauth_proofs'::regclass) OR (SELECT count(*) FROM pg_policy WHERE polrelid='account_deletion_private.reauth_proofs'::regclass AND polname='g028_reauth_proof_owner_access' AND polroles=ARRAY['privacy_workflow_owner'::regrole::oid] AND polcmd='*') <> 1 OR has_function_privilege('anon','public.begin_account_deletion_apply_with_reauth(uuid,uuid,uuid,uuid,text,text,text,text)','EXECUTE') OR has_function_privilege('service_role','public.begin_account_deletion_apply_with_reauth(uuid,uuid,uuid,uuid,text,text,text,text)','EXECUTE') OR NOT has_function_privilege('authenticated','public.begin_account_deletion_apply_with_reauth(uuid,uuid,uuid,uuid,text,text,text,text)','EXECUTE') OR has_function_privilege('authenticated','public.consume_account_deletion_reauth_proof(uuid,uuid,uuid,text)','EXECUTE') OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='account_deletion_private' AND table_name='reauth_proofs' AND column_name IN ('password','email','token','access_token','refresh_token','jti','jti_digest')) THEN RAISE EXCEPTION 'G028 ACL, RLS, or secret-column contract failed'; END IF;
END; $$;
DO $$
DECLARE
  v_source text := (SELECT prosrc FROM pg_proc WHERE oid='public.begin_account_deletion_apply_with_reauth(uuid,uuid,uuid,uuid,text,text,text,text)'::regprocedure);
  v_issue_source text := (SELECT prosrc FROM pg_proc WHERE oid='public.issue_account_deletion_reauth_proof(uuid)'::regprocedure);
  v_count_field text;
  v_flag_field text;
BEGIN
  FOREACH v_count_field IN ARRAY ARRAY['delete_count','anonymize_count','separate_count','retain_count'] LOOP
    IF position(format('v_result.%s IS NULL OR v_result.%s < 0',v_count_field,v_count_field) IN v_source)=0 THEN RAISE EXCEPTION 'G028 null-safe count receipt check missing for %',v_count_field; END IF;
  END LOOP;
  FOREACH v_flag_field IN ARRAY ARRAY['db_readback_passed','storage_readback_passed','session_readback_passed','auth_readback_passed'] LOOP
    IF position(format('v_result.%s IS DISTINCT FROM false',v_flag_field) IN v_source)=0 THEN RAISE EXCEPTION 'G028 null-safe readback receipt check missing for %',v_flag_field; END IF;
  END LOOP;
  IF position('DELETE FROM account_deletion_private.reauth_proofs AS proofs WHERE proofs.actor_user_id = v_actor_user_id AND proofs.expires_at <= v_now' IN v_issue_source)=0 THEN RAISE EXCEPTION 'G028 bounded expired proof cleanup missing'; END IF;
END; $$;
CREATE OR REPLACE FUNCTION public.begin_account_deletion_apply(
  p_actor_user_id uuid, p_target_user_id uuid, p_request_id uuid, p_preview_hash text,
  p_confirmation_text text, p_idempotency_key text, p_reauthenticated_at timestamptz,
  p_source_manifest_hash text
) RETURNS TABLE (
  request_id uuid, status text, reason_code text, delete_count integer, anonymize_count integer,
  separate_count integer, retain_count integer, db_readback_passed boolean,
  storage_readback_passed boolean, session_readback_passed boolean, auth_readback_passed boolean,
  storage_receipt_refs jsonb, auth_receipt_ref text, source_manifest_hash text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN QUERY SELECT p_request_id, 'applying'::text, 'APPLY_STARTED'::text,
    NULL::integer, NULL::integer, NULL::integer, NULL::integer,
    false, false, false, false, NULL::jsonb, NULL::text, p_source_manifest_hash;
END; $$;
DO $$
DECLARE
  u uuid := '11111111-1111-4111-8111-111111111111'; p uuid; e bigint := extract(epoch FROM clock_timestamp())::bigint; c text; t timestamptz;
BEGIN
  c := jsonb_build_object('role','authenticated','sub',u::text,'session_id','22222222-2222-4222-8222-222222222222','iat',e-1,'exp',e+600,'amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',e-1)))::text;
  PERFORM set_config('request.jwt.claims',c,true); PERFORM set_config('request.jwt.claim.role','authenticated',true);
  SELECT proof_id INTO p FROM public.issue_account_deletion_reauth_proof(u);
  BEGIN PERFORM public.begin_account_deletion_apply_with_reauth(p,u,u,'66666666-6666-4666-8666-666666666666',repeat('a',64),'DELETE','null-count','manifest'); RAISE EXCEPTION 'G028 null count receipt succeeded'; EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'account_deletion_reauth_begin_receipt_invalid' THEN RAISE; END IF; END;
  SELECT consumed_at INTO t FROM account_deletion_private.reauth_proofs WHERE proof_id=p; IF t IS NOT NULL THEN RAISE EXCEPTION 'G028 null count receipt consumed proof'; END IF;
END; $$;
CREATE OR REPLACE FUNCTION public.begin_account_deletion_apply(
  p_actor_user_id uuid, p_target_user_id uuid, p_request_id uuid, p_preview_hash text,
  p_confirmation_text text, p_idempotency_key text, p_reauthenticated_at timestamptz,
  p_source_manifest_hash text
) RETURNS TABLE (
  request_id uuid, status text, reason_code text, delete_count integer, anonymize_count integer,
  separate_count integer, retain_count integer, db_readback_passed boolean,
  storage_readback_passed boolean, session_readback_passed boolean, auth_readback_passed boolean,
  storage_receipt_refs jsonb, auth_receipt_ref text, source_manifest_hash text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN QUERY SELECT p_request_id, 'applying'::text, 'APPLY_STARTED'::text,
    0, 0, 0, 0, NULL::boolean, false, false, false,
    NULL::jsonb, NULL::text, p_source_manifest_hash;
END; $$;
DO $$
DECLARE
  u uuid := '11111111-1111-4111-8111-111111111111'; p uuid; e bigint := extract(epoch FROM clock_timestamp())::bigint; c text; t timestamptz;
BEGIN
  c := jsonb_build_object('role','authenticated','sub',u::text,'session_id','22222222-2222-4222-8222-222222222222','iat',e-1,'exp',e+600,'amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',e-1)))::text;
  PERFORM set_config('request.jwt.claims',c,true); PERFORM set_config('request.jwt.claim.role','authenticated',true);
  SELECT proof_id INTO p FROM public.issue_account_deletion_reauth_proof(u);
  BEGIN PERFORM public.begin_account_deletion_apply_with_reauth(p,u,u,'77777777-7777-4777-8777-777777777777',repeat('a',64),'DELETE','null-flag','manifest'); RAISE EXCEPTION 'G028 null readback receipt succeeded'; EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'account_deletion_reauth_begin_receipt_invalid' THEN RAISE; END IF; END;
  SELECT consumed_at INTO t FROM account_deletion_private.reauth_proofs WHERE proof_id=p; IF t IS NOT NULL THEN RAISE EXCEPTION 'G028 null readback receipt consumed proof'; END IF;
END; $$;
CREATE OR REPLACE FUNCTION public.begin_account_deletion_apply(
  p_actor_user_id uuid, p_target_user_id uuid, p_request_id uuid, p_preview_hash text,
  p_confirmation_text text, p_idempotency_key text, p_reauthenticated_at timestamptz,
  p_source_manifest_hash text
) RETURNS TABLE (
  request_id uuid, status text, reason_code text, delete_count integer, anonymize_count integer,
  separate_count integer, retain_count integer, db_readback_passed boolean,
  storage_readback_passed boolean, session_readback_passed boolean, auth_readback_passed boolean,
  storage_receipt_refs jsonb, auth_receipt_ref text, source_manifest_hash text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN QUERY SELECT p_request_id, 'applying'::text, 'APPLY_STARTED'::text,
    0, 0, 0, 0, false, false, false, false,
    NULL::jsonb, NULL::text, p_source_manifest_hash;
END; $$;
DO $$
DECLARE
  u uuid := '11111111-1111-4111-8111-111111111111'; p uuid; r record; e bigint := extract(epoch FROM clock_timestamp())::bigint; c text;
BEGIN
  c := jsonb_build_object('role','authenticated','sub',u::text,'session_id','22222222-2222-4222-8222-222222222222','iat',e-1,'exp',e+600,'amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',e-1)))::text;
  PERFORM set_config('request.jwt.claims',c,true); PERFORM set_config('request.jwt.claim.role','authenticated',true);
  SELECT proof_id INTO p FROM public.issue_account_deletion_reauth_proof(u);
  SELECT * INTO r FROM public.begin_account_deletion_apply_with_reauth(p,u,u,'88888888-8888-4888-8888-888888888888',repeat('a',64),'DELETE','successful-begin','manifest');
  IF r.status IS DISTINCT FROM 'applying' OR r.reason_code IS DISTINCT FROM 'APPLY_STARTED' THEN RAISE EXCEPTION 'G028 authenticated wrapper begin failed'; END IF;
  BEGIN PERFORM public.begin_account_deletion_apply_with_reauth(p,u,u,'89898989-8989-4989-8989-898989898989',repeat('a',64),'DELETE','successful-begin-replay','manifest'); RAISE EXCEPTION 'G028 successful wrapper proof replay succeeded'; EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'account_deletion_reauth_proof_not_available' THEN RAISE; END IF; END;
  PERFORM set_config('request.jwt.claims',jsonb_set(c::jsonb,'{role}',to_jsonb('service_role'::text))::text,true); PERFORM set_config('request.jwt.claim.role','service_role',true);
  BEGIN PERFORM public.begin_account_deletion_apply_with_reauth(p,u,u,'99999999-9999-4999-8999-999999999999',repeat('a',64),'DELETE','service-role-denied','manifest'); RAISE EXCEPTION 'G028 service role begin succeeded'; EXCEPTION WHEN OTHERS THEN IF SQLERRM <> 'account_deletion_reauth_proof_invalid_actor' THEN RAISE; END IF; END;
END; $$;
ROLLBACK;
