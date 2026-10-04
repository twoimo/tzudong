-- An expired claimed lease cannot prove that a paid generation never started.
-- Preserve checkpoints and require explicit readback/manual recovery; never requeue blindly.
BEGIN;
ALTER TABLE public.admin_storyboard_production_jobs DROP CONSTRAINT admin_storyboard_production_jobs_stage_check;
ALTER TABLE public.admin_storyboard_production_jobs ADD CONSTRAINT admin_storyboard_production_jobs_stage_check
  CHECK(stage IN ('queued','text','images','complete','failed','cancelled','uncertain'));
DO $uncertain_lease$
DECLARE target oid; definition text; body text; old text; replacement text;
BEGIN
  target:=pg_catalog.to_regprocedure('public.storyboard_production_worker(uuid,text,uuid,uuid,jsonb)');
  SELECT pg_catalog.pg_get_functiondef(p.oid),p.prosrc INTO definition,body FROM pg_catalog.pg_proc p
    WHERE p.oid=target AND p.proowner='postgres'::pg_catalog.regrole AND NOT p.prosecdef
      AND p.proconfig=ARRAY['search_path=""']::text[];
  IF definition IS NULL OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(body,'UTF8')),'hex')
    <> '10a0bbce773e6ecc69f944b07407d12be2793f773f4ad1d504caa75b9102237e' THEN
    RAISE EXCEPTION 'STORYBOARD_UNCERTAIN_LEASE_SOURCE_DRIFT'; END IF;
  old:=$old$UPDATE public.admin_storyboard_production_jobs SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'queued' END,
        stage = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'queued' END, error_code = 'worker_lease_lost',$old$;
  replacement:=$replacement$UPDATE public.admin_storyboard_production_jobs SET status = 'failed',
        stage = 'uncertain', error_code = 'worker_lease_lost',$replacement$;
  IF (length(body)-length(replace(body,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'STORYBOARD_UNCERTAIN_LEASE_SOURCE_DRIFT'; END IF;
  definition:=replace(definition,old,replacement);
  old:=$project_old$UPDATE public.admin_storyboard_production_projects SET status = CASE WHEN j.attempts >= 3
        THEN public.storyboard_production_final_status(request, document) ELSE 'waiting_worker' END,$project_old$;
  replacement:=$project_new$UPDATE public.admin_storyboard_production_projects SET status = public.storyboard_production_final_status(request, document),$project_new$;
  IF (length(body)-length(replace(body,old,'')))/length(old)<>1 THEN RAISE EXCEPTION 'STORYBOARD_UNCERTAIN_LEASE_SOURCE_DRIFT'; END IF;
  EXECUTE replace(definition,old,replacement);
END;
$uncertain_lease$;
COMMIT;
