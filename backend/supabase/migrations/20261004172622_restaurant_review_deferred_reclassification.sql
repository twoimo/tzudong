-- Reclassify confirmed deferred judgments under current server constraints.
-- The applied Gemini migration and all worker/provider limits remain immutable.
BEGIN;
DO $deferred_reclassification$
DECLARE function_oid oid := 'public.restaurant_review_automation_tick(uuid)'::regprocedure;
 source text; before_meta jsonb; after_meta jsonb;
 old_sha constant text := 'c23d8d0f085e7e320f9d8cac73f05f64292cb06c728ff00acf13de926ad6dd79';
 new_sha constant text := '658473cae9137b04ddd810cb6ccf688b9ae998446880fa164e912eb8a1fbef6d';
 anchor constant text := $old_branch$     ELSE
       UPDATE pipeline_control.restaurant_review_items SET state='cancelled',reason='server_constraints',finished_at=now(),
         gemini_decision=gemini_decision||jsonb_build_object('outcome','blocked') WHERE id=previous.id;
     END IF;$old_branch$;
 replacement constant text := $new_branch$     ELSIF decision='approve' AND remaining=0 THEN
       -- The loop may have consumed the last slot after its candidate cursor
       -- opened. Keep the successful judgment deferred; never cancel or requeue it.
       NULL;
     ELSIF decision='hold' THEN
       UPDATE public.restaurants SET status='hold',updated_at=now() WHERE id=restaurant.id;
       IF NOT EXISTS(SELECT 1 FROM public.restaurants WHERE id=restaurant.id AND status='hold')
         THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_READBACK_FAILED'; END IF;
       UPDATE pipeline_control.restaurant_review_items SET state='applied',decision='hold',reason=deferred_tick.reason,
         finished_at=now(),applied_fingerprint=pipeline_control.restaurant_review_fingerprint(
           (SELECT to_jsonb(current_row) FROM public.restaurants current_row WHERE current_row.id=restaurant.id)),
         gemini_decision=gemini_decision||jsonb_build_object('outcome','hold') WHERE id=previous.id;
       run.held:=run.held+1;
     ELSIF decision='recheck' AND
       pipeline_control.restaurant_review_gemini_valid(previous.gemini_decision-ARRAY['outcome','decidedAt'],previous.input_sha256) THEN
       -- This is a new claim after a confirmed completed judgment, never a
       -- retry of uncertain provider work. Retire the old capability and bind
       -- the queue to the current row; one model call per claim stays unchanged.
       UPDATE pipeline_control.restaurant_review_items SET state='queued',decision='recheck',reason=deferred_tick.reason,
         fingerprint=v_fingerprint,applied_fingerprint=NULL,worker_token=NULL,lease_until=NULL,finished_at=NULL,
         gemini_decision=gemini_decision||jsonb_build_object('outcome','recheck') WHERE id=previous.id;
       run.recheck:=run.recheck+1;
     ELSE
       UPDATE pipeline_control.restaurant_review_items SET state='cancelled',reason='server_constraints',finished_at=now(),
         gemini_decision=gemini_decision||jsonb_build_object('outcome','blocked') WHERE id=previous.id;
       IF decision='protected' THEN run.protected:=run.protected+1; END IF;
     END IF;$new_branch$;
BEGIN
 SELECT prosrc,to_jsonb(p)-'prosrc' INTO source,before_meta FROM pg_catalog.pg_proc p WHERE oid=function_oid;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE oid=function_oid
     AND pg_catalog.pg_get_userbyid(proowner)='postgres' AND NOT prosecdef
     AND prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
     AND prorettype='jsonb'::regtype AND prokind='f' AND provolatile='v' AND proparallel='u'
     AND NOT proisstrict AND NOT proleakproof AND NOT proretset
     AND proconfig=ARRAY['search_path=""','lock_timeout=2s']::text[]
     AND proacl=ARRAY['postgres=X/postgres','service_role=X/postgres']::aclitem[])
 THEN RAISE EXCEPTION 'REVIEW_DEFERRED_METADATA_DRIFT'; END IF;
 IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(source,'UTF8')),'hex')=new_sha THEN RETURN; END IF;
 IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(source,'UTF8')),'hex')<>old_sha
    OR (length(source)-length(replace(source,anchor,'')))<>length(anchor)
 THEN RAISE EXCEPTION 'REVIEW_DEFERRED_SOURCE_DRIFT'; END IF;
 EXECUTE replace(replace(pg_catalog.pg_get_functiondef(function_oid),anchor,replacement),
   E'\nDECLARE policy',E'\n<<deferred_tick>>\nDECLARE policy');
 SELECT prosrc,to_jsonb(p)-'prosrc' INTO source,after_meta FROM pg_catalog.pg_proc p WHERE oid=function_oid;
 IF after_meta IS DISTINCT FROM before_meta
    OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(source,'UTF8')),'hex')<>new_sha
 THEN RAISE EXCEPTION 'REVIEW_DEFERRED_READBACK_DRIFT'; END IF;
END;
$deferred_reclassification$;
COMMIT;
