-- Manual Preview/tick parity and fixed privileged revision lock for server run/stop.
-- Exact prior body; preserve limits, policy/stop/CAS, owner, ACL and all metadata.
BEGIN;
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
COMMIT;
