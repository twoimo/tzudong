-- Count only jobs compatible with this worker in the bounded claim window.
-- Preserve leases, paid-generation uncertainty handling and inner CAS checks.
BEGIN;
DO $capability_order$
DECLARE target oid; definition text; body text; metadata_before jsonb; metadata_after jsonb;
        old text := $claim_old$WHERE q.owner_id = w.owner_id AND EXISTS (SELECT 1 FROM public.admin_storyboard_production_jobs x
        WHERE x.project_id = q.id AND x.status = 'queued' AND x.available_at <= clock_timestamp() AND x.attempts < 3)
      ORDER BY q.created_at LIMIT 64 FOR UPDATE OF q SKIP LOCKED$claim_old$;
        replacement text := $claim_new$WHERE q.owner_id = w.owner_id AND EXISTS (SELECT 1 FROM public.admin_storyboard_production_jobs x
        WHERE x.project_id = q.id AND x.status = 'queued' AND x.available_at <= clock_timestamp() AND x.attempts < 3)
      AND q.request#>>'{providers,text,id}' = 'gemini-api'
      AND q.request#>>'{providers,image,id}' = 'gemini-api'
      AND (q.document IS NOT NULL OR public.storyboard_production_model_available(w.models,q.request#>>'{providers,text,model}','chat'))
      AND public.storyboard_production_model_available(w.models,q.request#>>'{providers,image,model}','image')
      ORDER BY q.created_at LIMIT 64 FOR UPDATE OF q SKIP LOCKED$claim_new$;
BEGIN
  target:=pg_catalog.to_regprocedure('public.storyboard_production_worker(uuid,text,uuid,uuid,jsonb)');
  SELECT pg_catalog.pg_get_functiondef(p.oid),p.prosrc,
    jsonb_build_array(p.proowner,p.proacl,p.prosecdef,p.proconfig,p.provolatile,p.proparallel)
    INTO definition,body,metadata_before FROM pg_catalog.pg_proc p
    WHERE p.oid=target AND p.proowner='postgres'::pg_catalog.regrole AND NOT p.prosecdef
      AND p.proconfig=ARRAY['search_path=""']::text[];
  IF definition IS NULL OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(body,'UTF8')),'hex')
    <> 'd15ff26c456462db0cc7b73be33be3abf3d1de716a94b24a7b83f3caf8aec3bc' OR (length(body)-length(replace(body,old,'')))/length(old)<>1 THEN
    RAISE EXCEPTION 'STORYBOARD_CLAIM_CAPABILITY_SOURCE_DRIFT'; END IF;
  EXECUTE replace(definition,old,replacement);
  SELECT jsonb_build_array(p.proowner,p.proacl,p.prosecdef,p.proconfig,p.provolatile,p.proparallel)
    INTO metadata_after FROM pg_catalog.pg_proc p WHERE p.oid=target;
  IF metadata_after IS DISTINCT FROM metadata_before THEN
    RAISE EXCEPTION 'STORYBOARD_CLAIM_CAPABILITY_METADATA_DRIFT'; END IF;
END;
$capability_order$;
COMMIT;
