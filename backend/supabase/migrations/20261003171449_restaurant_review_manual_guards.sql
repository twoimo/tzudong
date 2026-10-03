-- Preserve scheduled automatic approval; confirm manual bulk actions against one locked snapshot.
BEGIN;
CREATE OR REPLACE FUNCTION public.restaurant_review_automation_tick(request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE policy pipeline_control.restaurant_review_policy; run pipeline_control.restaurant_review_runs;
  restaurant public.restaurants; data jsonb; fingerprint text; classification text; decision text; remaining integer;
BEGIN
  IF request_id IS NULL THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_REQUEST_INVALID'; END IF;
  SELECT * INTO policy FROM pipeline_control.restaurant_review_policy WHERE singleton FOR UPDATE;
  SELECT * INTO run FROM pipeline_control.restaurant_review_runs existing WHERE existing.request_id=restaurant_review_automation_tick.request_id;
  IF FOUND THEN RETURN to_jsonb(run); END IF;
  IF NOT policy.enabled THEN RETURN jsonb_build_object('disabled',true); END IF;
  PERFORM pipeline_control.assert_restaurant_review_operator(policy.operator_id);
  -- Reject rather than race with browser/source writes. All writers obey this lock;
  -- lock timeout is configured by the caller's bounded request, never retried blind.
  LOCK TABLE public.restaurants IN SHARE ROW EXCLUSIVE MODE;
  SELECT greatest(0,policy.daily_limit-coalesce(sum(approved),0)) INTO remaining FROM pipeline_control.restaurant_review_runs
    WHERE started_at>=date_trunc('day',now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul';
  INSERT INTO pipeline_control.restaurant_review_runs(request_id,policy_version) VALUES(request_id,policy.version) RETURNING * INTO run;
  FOR restaurant IN SELECT candidate.* FROM public.restaurants candidate WHERE candidate.status='pending' AND NOT EXISTS(
      SELECT 1 FROM pipeline_control.restaurant_review_items prior WHERE prior.restaurant_id=candidate.id
      AND prior.fingerprint=pipeline_control.restaurant_review_fingerprint(to_jsonb(candidate)))
    AND (remaining>0 OR pipeline_control.restaurant_review_decision(to_jsonb(candidate)) NOT LIKE 'approve:%')
    ORDER BY candidate.created_at,candidate.id LIMIT policy.batch_size FOR UPDATE
  LOOP
    data:=to_jsonb(restaurant); fingerprint:=pipeline_control.restaurant_review_fingerprint(data);
    classification:=pipeline_control.restaurant_review_decision(data); decision:=split_part(classification,':',1);
    IF decision='approve' AND remaining=0 THEN CONTINUE; END IF;
    IF decision='approve' THEN
      UPDATE public.restaurants SET status='approved',approved_name=coalesce(nullif(btrim(approved_name),''),nullif(btrim(naver_name),''),nullif(btrim(google_name),''),origin_name),
        updated_by_admin_id=policy.operator_id,updated_at=now() WHERE id=restaurant.id;
      IF NOT EXISTS(SELECT 1 FROM public.restaurants WHERE id=restaurant.id AND status='approved' AND updated_by_admin_id=policy.operator_id)
        THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_READBACK_FAILED'; END IF;
      remaining:=remaining-1; run.approved:=run.approved+1;
    ELSIF decision='recheck' THEN run.recheck:=run.recheck+1;
    ELSIF decision='protected' THEN run.protected:=run.protected+1;
    ELSE
      UPDATE public.restaurants SET status='hold',updated_at=now() WHERE id=restaurant.id;
      IF NOT EXISTS(SELECT 1 FROM public.restaurants WHERE id=restaurant.id AND status='hold')
        THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_READBACK_FAILED'; END IF;
      run.held:=run.held+1;
    END IF;
    INSERT INTO pipeline_control.restaurant_review_items(run_id,restaurant_id,fingerprint,decision,reason,state,finished_at)
    VALUES(run.id,restaurant.id,fingerprint,decision,split_part(classification,':',2),CASE WHEN decision='recheck' THEN 'queued' ELSE 'applied' END,
      CASE WHEN decision='recheck' THEN NULL ELSE now() END);
    run.scanned:=run.scanned+1;
  END LOOP;
  UPDATE pipeline_control.restaurant_review_runs SET scanned=run.scanned,approved=run.approved,recheck=run.recheck,held=run.held,protected=run.protected WHERE id=run.id;
  UPDATE pipeline_control.restaurant_review_policy SET last_run_at=now() WHERE singleton;
  RETURN to_jsonb(run);
END;
$$;

ALTER FUNCTION public.restaurant_review_automation_tick(uuid) SET lock_timeout='2s';

CREATE FUNCTION pipeline_control.restaurant_review_manual_preview(actor uuid,action text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE policy pipeline_control.restaurant_review_policy; remaining integer; counts jsonb; queued integer; running integer; queue_digest text;
BEGIN
  PERFORM pipeline_control.assert_restaurant_review_operator(actor);
  IF action NOT IN ('run','stop') OR action IS NULL THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_ACTION_INVALID'; END IF;
  SELECT * INTO policy FROM pipeline_control.restaurant_review_policy WHERE singleton;
  IF NOT policy.enabled THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_STALE'; END IF;
  IF (SELECT count(*) FROM (SELECT 1 FROM public.restaurants LIMIT 50001) bounded)>50000
    THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_CAPACITY_EXCEEDED'; END IF;
  SELECT greatest(0,policy.daily_limit-coalesce(sum(approved),0)) INTO remaining FROM pipeline_control.restaurant_review_runs
    WHERE started_at>=date_trunc('day',now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul';
  SELECT count(*) FILTER(WHERE state='queued'),count(*) FILTER(WHERE state='running'),
    md5(coalesce(string_agg(id::text||':'||state,',' ORDER BY id),''))
    INTO queued,running,queue_digest FROM pipeline_control.restaurant_review_items WHERE state IN ('queued','running');
  SELECT coalesce(jsonb_object_agg(decision,total),'{}'::jsonb) INTO counts FROM (
    SELECT decision,count(*) total FROM (
      SELECT split_part(pipeline_control.restaurant_review_decision(to_jsonb(candidate)),':',1) decision
      FROM public.restaurants candidate WHERE candidate.status='pending' AND NOT EXISTS (
        SELECT 1 FROM pipeline_control.restaurant_review_items prior WHERE prior.restaurant_id=candidate.id
          AND prior.fingerprint=pipeline_control.restaurant_review_fingerprint(to_jsonb(candidate)))
        AND (remaining>0 OR pipeline_control.restaurant_review_decision(to_jsonb(candidate)) NOT LIKE 'approve:%')
      ORDER BY candidate.created_at,candidate.id LIMIT policy.batch_size
    ) bounded GROUP BY decision
  ) grouped;
  IF counts ? 'approve' THEN counts:=jsonb_set(counts,'{approve}',to_jsonb(least((counts->>'approve')::integer,remaining))); END IF;
  RETURN jsonb_build_object('action',action,'version',policy.version::text,'counts',counts,
    'batchSize',policy.batch_size,'dailyLimit',policy.daily_limit,'remainingApprovals',remaining,
    'queue',jsonb_build_object('queued',queued,'running',running),
    'previewHash',md5(actor::text||':'||action||':'||policy.version::text||':'||public.admin_evaluation_revision()
      ||':'||coalesce(policy.last_run_at::text,'')||':'||remaining::text||':'||counts::text||':'||queue_digest));
END;
$$;
REVOKE ALL ON FUNCTION pipeline_control.restaurant_review_manual_preview(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION pipeline_control.restaurant_review_manual_preview(uuid,text) TO service_role;

CREATE FUNCTION public.restaurant_review_automation_manual(actor uuid,action text,expected_version text,preview_hash text,request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE policy pipeline_control.restaurant_review_policy; preview jsonb; result jsonb;
BEGIN
  PERFORM pipeline_control.assert_restaurant_review_operator(actor);
  IF action IN ('preview-run','preview-stop') THEN
    RETURN pipeline_control.restaurant_review_manual_preview(actor,substring(action from 9));
  END IF;
  IF action NOT IN ('run','stop') OR action IS NULL THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_ACTION_INVALID'; END IF;
  SELECT * INTO policy FROM pipeline_control.restaurant_review_policy WHERE singleton FOR UPDATE;
  -- Read a committed request before checking a now-stale preview. A lost response
  -- must not cause a second run or erase the original committed result.
  IF action='run' THEN
    IF request_id IS NULL THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_REQUEST_INVALID'; END IF;
    SELECT to_jsonb(existing) INTO result FROM pipeline_control.restaurant_review_runs existing
      WHERE existing.request_id=restaurant_review_automation_manual.request_id;
    IF FOUND THEN RETURN public.restaurant_review_automation_status()||jsonb_build_object('run',result); END IF;
  END IF;
  LOCK TABLE public.restaurants IN SHARE ROW EXCLUSIVE MODE;
  PERFORM 1 FROM pipeline_control.admin_evaluation_catalog_revision WHERE singleton FOR UPDATE;
  preview:=pipeline_control.restaurant_review_manual_preview(actor,action);
  IF expected_version IS DISTINCT FROM preview->>'version' OR preview_hash IS DISTINCT FROM preview->>'previewHash'
    THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_STALE'; END IF;
  IF action='run' THEN
    result:=public.restaurant_review_automation_tick(request_id);
    RETURN public.restaurant_review_automation_status()||jsonb_build_object('run',result);
  END IF;
  RETURN public.restaurant_review_automation_configure(actor,'stop',expected_version,'',policy.batch_size,policy.daily_limit);
END;
$$;
REVOKE ALL ON FUNCTION public.restaurant_review_automation_manual(uuid,text,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.restaurant_review_automation_manual(uuid,text,text,text,uuid) TO service_role;
INSERT INTO privacy_retention.g014_public_rpc_allowlist(function_schema,function_name,identity_arguments,grantee,source_signature)
SELECT n.nspname,p.proname,p.proargtypes::text,'service_role'::name,'public.restaurant_review_automation_manual(uuid,text,text,text,uuid)'
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE p.oid=pg_catalog.to_regprocedure('public.restaurant_review_automation_manual(uuid,text,text,text,uuid)');
COMMIT;
