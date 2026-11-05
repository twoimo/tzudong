-- Separate immutable storyboard-mlx-v1 history from storyboard-gemini-v1 execution.
-- Existing rows, revisions, assets and events remain readable; only the new workflow can mutate or queue.
BEGIN;

ALTER TABLE public.admin_storyboard_production_projects
  DROP CONSTRAINT admin_storyboard_production_projects_request_check,
  DROP CONSTRAINT admin_storyboard_production_projects_check;
ALTER TABLE public.admin_storyboard_production_projects
  ADD CONSTRAINT admin_storyboard_production_projects_request_workflow_check CHECK (
    jsonb_typeof(request) = 'object' AND octet_length(request::text) <= 65536
    AND (request->>'workflow' = 'storyboard-mlx-v1' OR (
      request->>'workflow' = 'storyboard-gemini-v1'
      AND request#>>'{providers,externalAI}' = 'true'
      AND request#>>'{providers,text,id}' = 'gemini-api'
      AND request#>>'{providers,text,model}' = 'gemini-3.8-flash'
      AND request#>>'{providers,image,id}' = 'gemini-api'
      AND request#>>'{providers,image,model}' IN ('gemini-3.1-flash-image','gemini-3-pro-image')))),
  ADD CONSTRAINT admin_storyboard_production_projects_document_workflow_check CHECK (
    document IS NULL OR (jsonb_typeof(document) = 'object'
      AND octet_length(document::text) <= 196608
      AND document->>'schema' = request->>'workflow'
      AND document->>'projectId' = id::text
      AND (document->>'revision')::integer = revision));

ALTER TABLE public.admin_storyboard_production_revisions
  DROP CONSTRAINT admin_storyboard_production_revisions_check;
ALTER TABLE public.admin_storyboard_production_revisions
  ADD CONSTRAINT admin_storyboard_production_revisions_document_workflow_check CHECK (
    jsonb_typeof(document) = 'object' AND octet_length(document::text) <= 196608
    AND document->>'schema' IN ('storyboard-mlx-v1', 'storyboard-gemini-v1')
    AND document->>'projectId' = project_id::text
    AND (document->>'revision')::integer = revision);

-- Active legacy work is terminally held at cutover. Documents, assets, revisions,
-- restore receipts, attempts and prior events stay intact and readable.
WITH legacy_active AS (
  SELECT j.id AS job_id, j.project_id, j.owner_id, j.worker_id AS former_worker_id, p.revision
  FROM public.admin_storyboard_production_jobs j
  JOIN public.admin_storyboard_production_projects p ON p.id = j.project_id AND p.owner_id = j.owner_id
  WHERE p.request->>'workflow' = 'storyboard-mlx-v1' AND j.status IN ('queued','claimed')
  FOR UPDATE OF j, p
), retired AS (
  UPDATE public.admin_storyboard_production_jobs j
    SET status = 'cancelled', stage = 'cancelled', error_code = 'generation_cancelled',
      worker_id = NULL, lease_token = NULL, lease_expires_at = NULL, updated_at = clock_timestamp()
  FROM legacy_active l WHERE j.id = l.job_id
  RETURNING j.id, l.project_id, l.owner_id, l.former_worker_id, l.revision
), held_projects AS (
  UPDATE public.admin_storyboard_production_projects p
    SET status = 'cancelled', updated_at = clock_timestamp()
  FROM retired r WHERE p.id = r.project_id AND p.owner_id = r.owner_id
  RETURNING p.id
)
INSERT INTO public.admin_storyboard_production_events(
  project_id, owner_id, job_id, worker_id, operation, revision, error_code)
SELECT r.project_id, r.owner_id, r.id, r.former_worker_id, 'cancelled', r.revision, 'generation_cancelled'
FROM retired r;

-- A function invocation that started before this transaction can retain its old
-- PL/pgSQL body while waiting for these tables. These row guards are installed in
-- the same transaction as the cutover so that such an invocation cannot recreate
-- or mutate archived work after the table locks are released at commit.
CREATE FUNCTION public.storyboard_production_reject_archived_write() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $storyboard_archive_guard$
DECLARE old_project_id uuid; new_project_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'admin_storyboard_production_projects' THEN
    IF (TG_OP = 'UPDATE' AND OLD.request->>'workflow' = 'storyboard-mlx-v1')
      OR NEW.request->>'workflow' = 'storyboard-mlx-v1' THEN
      RAISE EXCEPTION 'archived_project_read_only' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  new_project_id := NEW.project_id;
  IF TG_OP = 'UPDATE' THEN old_project_id := OLD.project_id; END IF;
  IF EXISTS (SELECT 1 FROM public.admin_storyboard_production_projects p
      WHERE p.id IN (new_project_id, old_project_id)
        AND p.request->>'workflow' = 'storyboard-mlx-v1') THEN
    RAISE EXCEPTION 'archived_project_read_only' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$storyboard_archive_guard$;
REVOKE ALL ON FUNCTION public.storyboard_production_reject_archived_write() FROM PUBLIC, anon, authenticated, privacy_workflow_owner;
GRANT EXECUTE ON FUNCTION public.storyboard_production_reject_archived_write() TO service_role;

CREATE TRIGGER storyboard_archive_projects_write_guard
  BEFORE INSERT OR UPDATE ON public.admin_storyboard_production_projects
  FOR EACH ROW EXECUTE FUNCTION public.storyboard_production_reject_archived_write();
CREATE TRIGGER storyboard_archive_jobs_write_guard
  BEFORE INSERT OR UPDATE ON public.admin_storyboard_production_jobs
  FOR EACH ROW EXECUTE FUNCTION public.storyboard_production_reject_archived_write();
CREATE TRIGGER storyboard_archive_assets_write_guard
  BEFORE INSERT OR UPDATE ON public.admin_storyboard_production_assets
  FOR EACH ROW EXECUTE FUNCTION public.storyboard_production_reject_archived_write();
CREATE TRIGGER storyboard_archive_events_write_guard
  BEFORE INSERT OR UPDATE ON public.admin_storyboard_production_events
  FOR EACH ROW EXECUTE FUNCTION public.storyboard_production_reject_archived_write();
CREATE TRIGGER storyboard_archive_revisions_write_guard
  BEFORE INSERT OR UPDATE ON public.admin_storyboard_production_revisions
  FOR EACH ROW EXECUTE FUNCTION public.storyboard_production_reject_archived_write();
CREATE TRIGGER storyboard_archive_restores_write_guard
  BEFORE INSERT OR UPDATE ON public.admin_storyboard_production_restores
  FOR EACH ROW EXECUTE FUNCTION public.storyboard_production_reject_archived_write();

DO $storyboard_gemini_admin$
DECLARE target oid; definition text; body text; old text; replacement text;
        metadata_before jsonb; metadata_after jsonb; occurrences integer;
BEGIN
  target := pg_catalog.to_regprocedure('public.storyboard_production_admin(uuid,text,uuid,integer,jsonb)');
  SELECT pg_catalog.pg_get_functiondef(p.oid), p.prosrc,
    jsonb_build_array(p.proowner,p.proacl,p.prosecdef,p.proconfig,p.provolatile,p.proparallel)
    INTO definition, body, metadata_before FROM pg_catalog.pg_proc p
    WHERE p.oid = target AND p.proowner = 'postgres'::pg_catalog.regrole AND NOT p.prosecdef
      AND p.proconfig = ARRAY['search_path=""']::text[];
  IF definition IS NULL THEN RAISE EXCEPTION 'STORYBOARD_GEMINI_ADMIN_SOURCE_DRIFT'; END IF;

  old := $old$IF p_action = 'create' THEN
    IF p_payload->>'workflow' IS DISTINCT FROM 'storyboard-mlx-v1'
      OR (p_payload->>'sceneCount')::integer NOT BETWEEN 5 AND 12 THEN RAISE EXCEPTION 'invalid_request'; END IF;$old$;
  replacement := $new$IF p_action = 'create' THEN
    IF p_payload->>'workflow' IS DISTINCT FROM 'storyboard-gemini-v1'
      OR (p_payload->>'sceneCount')::integer NOT BETWEEN 5 AND 12 THEN RAISE EXCEPTION 'invalid_request'; END IF;$new$;
  occurrences := (length(definition)-length(replace(definition,old,'')))/length(old);
  IF occurrences <> 1 THEN RAISE EXCEPTION 'STORYBOARD_GEMINI_ADMIN_SOURCE_DRIFT'; END IF;
  definition := replace(definition, old, replacement);

  old := $old$    RETURN jsonb_build_object('ok', true, 'versions', version_rows, 'preview', preview);
  END IF;
  IF p_action IN ('retry','regenerate') THEN$old$;
  replacement := $new$    RETURN jsonb_build_object('ok', true, 'versions', version_rows, 'preview', preview);
  END IF;
  IF p.request->>'workflow' IS DISTINCT FROM 'storyboard-gemini-v1' THEN
    RAISE EXCEPTION 'archived_project_read_only';
  END IF;
  IF p_action NOT IN ('edit','regenerate','retry','cancel','restore') THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;
  IF p_action IN ('retry','regenerate') THEN$new$;
  occurrences := (length(definition)-length(replace(definition,old,'')))/length(old);
  IF occurrences <> 1 THEN RAISE EXCEPTION 'STORYBOARD_GEMINI_ADMIN_SOURCE_DRIFT'; END IF;
  definition := replace(definition, old, replacement);

  EXECUTE definition;
  SELECT jsonb_build_array(p.proowner,p.proacl,p.prosecdef,p.proconfig,p.provolatile,p.proparallel)
    INTO metadata_after FROM pg_catalog.pg_proc p WHERE p.oid = target;
  IF metadata_after IS DISTINCT FROM metadata_before THEN
    RAISE EXCEPTION 'STORYBOARD_GEMINI_ADMIN_METADATA_DRIFT';
  END IF;
END;
$storyboard_gemini_admin$;

DO $storyboard_gemini_worker$
DECLARE target oid; definition text; body text; old text; replacement text;
        metadata_before jsonb; metadata_after jsonb; occurrences integer;
BEGIN
  target := pg_catalog.to_regprocedure('public.storyboard_production_worker(uuid,text,uuid,uuid,jsonb)');
  SELECT pg_catalog.pg_get_functiondef(p.oid), p.prosrc,
    jsonb_build_array(p.proowner,p.proacl,p.prosecdef,p.proconfig,p.provolatile,p.proparallel)
    INTO definition, body, metadata_before FROM pg_catalog.pg_proc p
    WHERE p.oid = target AND p.proowner = 'postgres'::pg_catalog.regrole AND NOT p.prosecdef
      AND p.proconfig = ARRAY['search_path=""']::text[];
  IF definition IS NULL THEN RAISE EXCEPTION 'STORYBOARD_GEMINI_WORKER_SOURCE_DRIFT'; END IF;

  old := $old$        UPDATE public.admin_storyboard_production_jobs SET last_heartbeat = clock_timestamp(),
          lease_expires_at = clock_timestamp() + interval '120 seconds', updated_at = clock_timestamp()
          WHERE id = p_job_id AND worker_id = w.id AND owner_id = w.owner_id AND status = 'claimed'
            AND lease_token = p_lease_token AND lease_expires_at > clock_timestamp();$old$;
  replacement := $new$        UPDATE public.admin_storyboard_production_jobs active_job SET last_heartbeat = clock_timestamp(),
          lease_expires_at = clock_timestamp() + interval '120 seconds', updated_at = clock_timestamp()
          FROM public.admin_storyboard_production_projects q
          WHERE active_job.id = p_job_id AND active_job.worker_id = w.id
            AND active_job.owner_id = w.owner_id AND active_job.status = 'claimed'
            AND q.id = active_job.project_id AND q.owner_id = active_job.owner_id
            AND q.request->>'workflow' = 'storyboard-gemini-v1'
            AND active_job.lease_token = p_lease_token AND active_job.lease_expires_at > clock_timestamp();$new$;
  occurrences := (length(definition)-length(replace(definition,old,'')))/length(old);
  IF occurrences <> 1 THEN RAISE EXCEPTION 'STORYBOARD_GEMINI_WORKER_SOURCE_DRIFT'; END IF;
  definition := replace(definition, old, replacement);

  old := $old$WHERE q.owner_id = w.owner_id AND EXISTS (SELECT 1 FROM public.admin_storyboard_production_jobs x
        WHERE x.project_id = q.id AND x.status = 'claimed' AND x.lease_expires_at <= clock_timestamp())
      ORDER BY q.created_at LIMIT 32 FOR UPDATE OF q SKIP LOCKED$old$;
  replacement := $new$WHERE q.owner_id = w.owner_id AND q.request->>'workflow' = 'storyboard-gemini-v1'
      AND EXISTS (SELECT 1 FROM public.admin_storyboard_production_jobs x
        WHERE x.project_id = q.id AND x.status = 'claimed' AND x.lease_expires_at <= clock_timestamp())
      ORDER BY q.created_at LIMIT 32 FOR UPDATE OF q SKIP LOCKED$new$;
  occurrences := (length(definition)-length(replace(definition,old,'')))/length(old);
  IF occurrences <> 1 THEN RAISE EXCEPTION 'STORYBOARD_GEMINI_WORKER_SOURCE_DRIFT'; END IF;
  definition := replace(definition, old, replacement);

  old := $old$WHERE q.owner_id = w.owner_id AND EXISTS (SELECT 1 FROM public.admin_storyboard_production_jobs x
        WHERE x.project_id = q.id AND x.status = 'queued' AND x.available_at <= clock_timestamp() AND x.attempts < 3)
      AND q.request#>>'{providers,text,id}' = 'gemini-api'$old$;
  replacement := $new$WHERE q.owner_id = w.owner_id AND EXISTS (SELECT 1 FROM public.admin_storyboard_production_jobs x
        WHERE x.project_id = q.id AND x.status = 'queued' AND x.available_at <= clock_timestamp() AND x.attempts < 3)
      AND q.request->>'workflow' = 'storyboard-gemini-v1'
      AND q.request#>>'{providers,text,id}' = 'gemini-api'$new$;
  occurrences := (length(definition)-length(replace(definition,old,'')))/length(old);
  IF occurrences <> 1 THEN RAISE EXCEPTION 'STORYBOARD_GEMINI_WORKER_SOURCE_DRIFT'; END IF;
  definition := replace(definition, old, replacement);

  old := $old$AND (q.document IS NOT NULL OR public.storyboard_production_model_available(w.models,q.request#>>'{providers,text,model}','chat'))
      AND public.storyboard_production_model_available(w.models,q.request#>>'{providers,image,model}','image')$old$;
  replacement := $new$AND public.storyboard_production_model_available(w.models,q.request#>>'{providers,text,model}','chat')
      AND public.storyboard_production_model_available(w.models,q.request#>>'{providers,image,model}','image')$new$;
  occurrences := (length(definition)-length(replace(definition,old,'')))/length(old);
  IF occurrences <> 1 THEN RAISE EXCEPTION 'STORYBOARD_GEMINI_WORKER_SOURCE_DRIFT'; END IF;
  definition := replace(definition, old, replacement);

  old := $old$  IF p.revision <> j.base_revision THEN RAISE EXCEPTION 'revision_conflict'; END IF;
  scene := (p_payload->>'sceneNo')::integer;$old$;
  replacement := $new$  IF p.revision <> j.base_revision THEN RAISE EXCEPTION 'revision_conflict'; END IF;
  IF p.request->>'workflow' IS DISTINCT FROM 'storyboard-gemini-v1' THEN
    RAISE EXCEPTION 'worker_lease_lost';
  END IF;
  scene := (p_payload->>'sceneNo')::integer;$new$;
  occurrences := (length(definition)-length(replace(definition,old,'')))/length(old);
  IF occurrences <> 1 THEN RAISE EXCEPTION 'STORYBOARD_GEMINI_WORKER_SOURCE_DRIFT'; END IF;
  definition := replace(definition, old, replacement);

  old := $old$jsonb_build_object('schema','storyboard-mlx-v1'$old$;
  replacement := $new$jsonb_build_object('schema','storyboard-gemini-v1'$new$;
  occurrences := (length(definition)-length(replace(definition,old,'')))/length(old);
  IF occurrences <> 1 THEN RAISE EXCEPTION 'STORYBOARD_GEMINI_WORKER_SOURCE_DRIFT'; END IF;
  definition := replace(definition, old, replacement);

  old := $old$status = CASE WHEN request#>>'{providers,image,id}' IN ('manual','chatgpt-manual','grok-manual') THEN 'awaiting_import' ELSE 'generating' END,$old$;
  replacement := $new$status = 'generating',$new$;
  occurrences := (length(definition)-length(replace(definition,old,'')))/length(old);
  IF occurrences <> 1 THEN RAISE EXCEPTION 'STORYBOARD_GEMINI_WORKER_SOURCE_DRIFT'; END IF;
  definition := replace(definition, old, replacement);

  EXECUTE definition;
  SELECT jsonb_build_array(p.proowner,p.proacl,p.prosecdef,p.proconfig,p.provolatile,p.proparallel)
    INTO metadata_after FROM pg_catalog.pg_proc p WHERE p.oid = target;
  IF metadata_after IS DISTINCT FROM metadata_before THEN
    RAISE EXCEPTION 'STORYBOARD_GEMINI_WORKER_METADATA_DRIFT';
  END IF;
END;
$storyboard_gemini_worker$;

COMMIT;
