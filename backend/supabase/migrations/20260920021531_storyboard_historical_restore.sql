BEGIN;

-- Immutable document snapshots and historical restore. Restore does not call a model
-- and does not enqueue a job. Do not edit 20260918021531_storyboard_mlx_worker.sql.

CREATE TABLE public.admin_storyboard_production_revisions (
  project_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 0),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'
    AND octet_length(document::text) <= 196608 AND document->>'schema' = 'storyboard-mlx-v1'
    AND document->>'projectId' = project_id::text AND (document->>'revision')::integer = revision),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (project_id, revision),
  FOREIGN KEY (project_id, owner_id) REFERENCES public.admin_storyboard_production_projects(id, owner_id) ON DELETE CASCADE
);

CREATE TABLE public.admin_storyboard_production_restores (
  project_id uuid NOT NULL,
  request_id uuid NOT NULL,
  target_revision integer NOT NULL CHECK (target_revision >= 0),
  scene_no integer CHECK (scene_no IS NULL OR scene_no BETWEEN 1 AND 12),
  applied_revision integer NOT NULL CHECK (applied_revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (project_id, request_id),
  FOREIGN KEY (project_id) REFERENCES public.admin_storyboard_production_projects(id) ON DELETE CASCADE
);

ALTER TABLE public.admin_storyboard_production_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_storyboard_production_restores ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_storyboard_production_revisions, public.admin_storyboard_production_restores
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.admin_storyboard_production_revisions, public.admin_storyboard_production_restores TO service_role;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'admin_storyboard_production_events'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%operation%'
  LOOP
    EXECUTE format('ALTER TABLE public.admin_storyboard_production_events DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.admin_storyboard_production_events
  ADD CHECK (operation IN ('created','queued','claimed','edited','draft_saved','image_saved',
    'scene_failed','cancelled','lease_expired','finished','restored'));

CREATE OR REPLACE FUNCTION public.storyboard_production_error_allowed(p_code text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT p_code IS NULL OR p_code = ANY(ARRAY['worker_lease_lost','generation_cancelled','revision_conflict',
    'model_not_installed','model_capability_mismatch','local_model_unavailable','model_timeout',
    'invalid_structured_response','bge_dependency_unavailable','model_response_too_large',
    'invalid_image_response','invalid_image','image_too_large','provider_auth_failed','provider_forbidden',
    'provider_rate_limited','provider_failed','provider_not_configured','model_identity_mismatch',
    'invalid_local_endpoint','invalid_model_request','invalid_model_response','image_missing',
    'version_not_found','restore_asset_missing']);
$$;

CREATE OR REPLACE FUNCTION public.storyboard_production_admin(
  p_owner_id uuid, p_action text, p_project_id uuid DEFAULT NULL,
  p_revision integer DEFAULT NULL, p_payload jsonb DEFAULT '{}'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  p public.admin_storyboard_production_projects; j public.admin_storyboard_production_jobs;
  old_job public.admin_storyboard_production_jobs; s jsonb; doc jsonb; proof jsonb;
  scene integer; job_request uuid; initial_status text; project_rows jsonb; worker_rows jsonb;
  target_rev integer; restore_request uuid; hist jsonb; hist_scene jsonb; asset_id uuid;
  applied public.admin_storyboard_production_restores; version_rows jsonb; preview jsonb;
BEGIN
  PERFORM public.storyboard_production_assert_owner(p_owner_id);
  IF p_action = 'list' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'revision', q.revision, 'status', q.status,
      'title', q.title, 'createdAt', q.created_at, 'updatedAt', q.updated_at) ORDER BY q.updated_at DESC), '[]')
      INTO project_rows FROM (SELECT * FROM public.admin_storyboard_production_projects
      WHERE owner_id = p_owner_id ORDER BY updated_at DESC LIMIT 50) q;
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'online',
      NOT w.disabled AND w.revoked_at IS NULL AND coalesce(w.last_heartbeat > clock_timestamp() - interval '120 seconds', false),
      'lastHeartbeat', w.last_heartbeat, 'models', w.models) ORDER BY w.created_at), '[]') INTO worker_rows
      FROM (SELECT * FROM public.admin_storyboard_production_workers WHERE owner_id = p_owner_id ORDER BY created_at LIMIT 64) w;
    RETURN jsonb_build_object('ok', true, 'projects', project_rows, 'workers', worker_rows);
  END IF;
  IF p_action = 'create' THEN
    IF p_payload->>'workflow' IS DISTINCT FROM 'storyboard-mlx-v1'
      OR (p_payload->>'sceneCount')::integer NOT BETWEEN 5 AND 12 THEN RAISE EXCEPTION 'invalid_request'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_each(p_payload->'providers') x WHERE x.key IN ('text','image')
      AND x.value->>'id' IN ('openai-api','xai-api')) THEN RAISE EXCEPTION 'provider_not_configured'; END IF;
    IF NOT coalesce((p_payload#>>'{providers,externalAI}')::boolean, false)
      AND (p_payload#>>'{providers,text,id}' NOT IN ('local-mlx','manual')
        OR p_payload#>>'{providers,image,id}' NOT IN ('local-mlx','manual')) THEN RAISE EXCEPTION 'external_ai_disabled'; END IF;
    job_request := (p_payload->>'requestId')::uuid;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_id::text || job_request::text, 0));
    SELECT * INTO p FROM public.admin_storyboard_production_projects WHERE owner_id = p_owner_id AND request_id = job_request;
    IF FOUND THEN
      IF p.request <> p_payload THEN RAISE EXCEPTION 'request_conflict'; END IF;
      RETURN public.storyboard_production_snapshot(p_owner_id, p.id);
    END IF;
    initial_status := CASE WHEN p_payload#>>'{providers,text,id}' = 'local-mlx' THEN 'waiting_worker' ELSE 'awaiting_import' END;
    INSERT INTO public.admin_storyboard_production_projects(owner_id, request_id, request, status)
      VALUES (p_owner_id, job_request, p_payload, initial_status) RETURNING * INTO p;
    IF initial_status = 'waiting_worker' THEN
      INSERT INTO public.admin_storyboard_production_jobs(project_id, owner_id, request_id, requested_revision, base_revision, kind)
        VALUES (p.id, p_owner_id, job_request, 0, 0, 'generate') RETURNING * INTO j;
    END IF;
    INSERT INTO public.admin_storyboard_production_events(project_id, owner_id, job_id, operation, revision)
      VALUES (p.id, p_owner_id, j.id, 'created', p.revision);
    RETURN public.storyboard_production_snapshot(p_owner_id, p.id);
  END IF;

  SELECT * INTO p FROM public.admin_storyboard_production_projects WHERE id = p_project_id AND owner_id = p_owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'project_not_found'; END IF;
  IF p_action = 'read' THEN
    RETURN public.storyboard_production_snapshot(p_owner_id, p.id) || jsonb_build_object('events',
      (SELECT coalesce(jsonb_agg(jsonb_build_object('id', e.id::text, 'jobId', e.job_id, 'operation', e.operation,
        'revision', e.revision, 'sceneNo', e.scene_no, 'errorCode', e.error_code, 'createdAt', e.created_at)
        ORDER BY e.id), '[]') FROM (SELECT * FROM public.admin_storyboard_production_events
        WHERE project_id = p.id AND owner_id = p_owner_id ORDER BY id DESC LIMIT 100) e));
  END IF;
  IF p_action = 'versions' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'revision', r.revision, 'createdAt', r.created_at, 'title', coalesce(r.document->>'title', ''),
      'sceneCount', coalesce(jsonb_array_length(r.document->'scenes'), 0)) ORDER BY r.revision DESC), '[]')
      INTO version_rows FROM (SELECT * FROM public.admin_storyboard_production_revisions
        WHERE project_id = p.id AND owner_id = p_owner_id ORDER BY revision DESC LIMIT 200) r;
    preview := NULL;
    IF p_payload ? 'targetRevision' THEN
      target_rev := (p_payload->>'targetRevision')::integer;
      SELECT r.document INTO preview FROM public.admin_storyboard_production_revisions r
        WHERE r.project_id = p.id AND r.owner_id = p_owner_id AND r.revision = target_rev;
      IF preview IS NULL THEN RAISE EXCEPTION 'version_not_found'; END IF;
    END IF;
    RETURN jsonb_build_object('ok', true, 'versions', version_rows, 'preview', preview);
  END IF;
  IF p_action IN ('retry','regenerate') THEN
    job_request := (p_payload->>'requestId')::uuid;
    SELECT * INTO old_job FROM public.admin_storyboard_production_jobs WHERE owner_id = p_owner_id AND request_id = job_request;
    IF FOUND THEN
      IF old_job.project_id <> p.id OR old_job.requested_revision <> p_revision
        OR old_job.kind <> (CASE WHEN p_action = 'regenerate' THEN 'scene' ELSE 'generate' END)
        OR old_job.scene_no IS DISTINCT FROM (p_payload->>'sceneNo')::integer THEN RAISE EXCEPTION 'request_conflict'; END IF;
      RETURN public.storyboard_production_snapshot(p_owner_id, p.id);
    END IF;
  END IF;
  -- Resolve an already committed request before CAS/busy checks, including a stale HTTP retry.
  IF p_action = 'restore' THEN
    restore_request := (p_payload->>'requestId')::uuid;
    target_rev := (p_payload->>'targetRevision')::integer;
    scene := (p_payload->>'sceneNo')::integer;
    SELECT * INTO applied FROM public.admin_storyboard_production_restores
      WHERE project_id = p.id AND request_id = restore_request;
    IF FOUND THEN
      IF applied.target_revision IS DISTINCT FROM target_rev
        OR applied.scene_no IS DISTINCT FROM scene THEN RAISE EXCEPTION 'request_conflict'; END IF;
      RETURN public.storyboard_production_snapshot(p_owner_id, p.id);
    END IF;
  END IF;
  IF p_revision IS DISTINCT FROM p.revision THEN RAISE EXCEPTION 'revision_conflict'; END IF;
  SELECT * INTO j FROM public.admin_storyboard_production_jobs WHERE project_id = p.id AND status IN ('queued','claimed') FOR UPDATE;
  IF p_action = 'cancel' THEN
    IF j.id IS NULL OR j.id IS DISTINCT FROM (p_payload->>'jobId')::uuid THEN RAISE EXCEPTION 'worker_lease_lost'; END IF;
    UPDATE public.admin_storyboard_production_jobs SET status = 'cancelled', stage = 'cancelled', error_code = 'generation_cancelled',
      lease_token = NULL, lease_expires_at = NULL, updated_at = clock_timestamp() WHERE id = j.id;
    UPDATE public.admin_storyboard_production_projects SET status = 'cancelled', revision = revision + 1,
      document = CASE WHEN document IS NULL THEN NULL ELSE jsonb_set(document, '{revision}', to_jsonb(revision + 1)) END,
      updated_at = clock_timestamp() WHERE id = p.id RETURNING * INTO p;
    IF p.document IS NOT NULL THEN
      INSERT INTO public.admin_storyboard_production_revisions(project_id, owner_id, revision, document)
      VALUES (p.id, p.owner_id, p.revision, p.document)
      ON CONFLICT (project_id, revision) DO NOTHING;
    END IF;
    INSERT INTO public.admin_storyboard_production_events(project_id, owner_id, job_id, operation, revision)
      VALUES (p.id, p_owner_id, j.id, 'cancelled', p.revision);
    RETURN public.storyboard_production_snapshot(p_owner_id, p.id);
  END IF;
  IF j.id IS NOT NULL THEN RAISE EXCEPTION 'project_busy'; END IF;

  IF p_action = 'restore' THEN
    restore_request := (p_payload->>'requestId')::uuid;
    target_rev := (p_payload->>'targetRevision')::integer;
    scene := (p_payload->>'sceneNo')::integer;
    IF restore_request IS NULL OR target_rev IS NULL OR target_rev < 0 OR target_rev >= p.revision THEN
      RAISE EXCEPTION 'invalid_request'; END IF;
    SELECT r.document INTO hist FROM public.admin_storyboard_production_revisions r
      WHERE r.project_id = p.id AND r.owner_id = p_owner_id AND r.revision = target_rev;
    IF hist IS NULL THEN RAISE EXCEPTION 'version_not_found'; END IF;
    IF scene IS NOT NULL THEN
      IF p.document IS NULL OR scene NOT BETWEEN 1 AND jsonb_array_length(hist->'scenes')
        OR scene NOT BETWEEN 1 AND jsonb_array_length(p.document->'scenes') THEN
        RAISE EXCEPTION 'invalid_scene'; END IF;
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements(
        CASE WHEN scene IS NULL THEN coalesce(hist->'scenes', '[]'::jsonb)
             ELSE jsonb_build_array(hist->'scenes'->(scene - 1)) END) AS img(scene_doc)
      WHERE jsonb_typeof(img.scene_doc->'image') = 'object'
        AND NOT EXISTS (
          SELECT 1 FROM public.admin_storyboard_production_assets a
          WHERE a.id = (img.scene_doc#>>'{image,id}')::uuid AND a.project_id = p.id AND a.owner_id = p_owner_id
            AND a.scene_no = (img.scene_doc->>'sceneNo')::integer
             AND a.metadata = img.scene_doc->'image'
        )
    ) THEN RAISE EXCEPTION 'restore_asset_missing'; END IF;
    IF p.document IS NOT NULL THEN
      INSERT INTO public.admin_storyboard_production_revisions(project_id, owner_id, revision, document)
      VALUES (p.id, p.owner_id, p.revision, p.document)
      ON CONFLICT (project_id, revision) DO NOTHING;
    END IF;
    IF scene IS NULL THEN doc := hist;
    ELSE doc := jsonb_set(p.document, ARRAY['scenes', (scene - 1)::text], hist->'scenes'->(scene - 1)); END IF;
    -- Restore content while keeping scene CAS versions monotonic.
    doc := jsonb_set(doc, '{scenes}', (SELECT jsonb_agg(
      CASE WHEN scene IS NULL OR (x->>'sceneNo')::integer = scene
        THEN jsonb_set(x, '{revision}', to_jsonb(greatest(
          coalesce((p.document->'scenes'->((x->>'sceneNo')::integer - 1)->>'revision')::integer, 0),
          (x->>'revision')::integer) + 1)) ELSE x END ORDER BY (x->>'sceneNo')::integer)
      FROM jsonb_array_elements(doc->'scenes') x));
    doc := jsonb_set(doc, '{revision}', to_jsonb(p.revision + 1));
    UPDATE public.admin_storyboard_production_projects SET document = doc, title = doc->>'title', revision = revision + 1,
      status = public.storyboard_production_final_status(request, doc), updated_at = clock_timestamp()
      WHERE id = p.id RETURNING * INTO p;
    INSERT INTO public.admin_storyboard_production_revisions(project_id, owner_id, revision, document)
      VALUES (p.id, p.owner_id, p.revision, p.document)
      ON CONFLICT (project_id, revision) DO NOTHING;
    INSERT INTO public.admin_storyboard_production_restores(project_id, request_id, target_revision, scene_no, applied_revision)
      VALUES (p.id, restore_request, target_rev, scene, p.revision);
    INSERT INTO public.admin_storyboard_production_events(project_id, owner_id, operation, revision, scene_no)
      VALUES (p.id, p_owner_id, 'restored', p.revision, scene);
    RETURN public.storyboard_production_snapshot(p_owner_id, p.id);
  END IF;

  scene := (p_payload->>'sceneNo')::integer;
  IF p_action IN ('edit','regenerate','import-image') THEN
    IF p.document IS NULL OR scene IS NULL OR scene NOT BETWEEN 1 AND jsonb_array_length(p.document->'scenes') THEN
      RAISE EXCEPTION 'invalid_scene';
    END IF;
    s := p.document->'scenes'->(scene - 1);
  END IF;
  IF p_action = 'edit' THEN
    s := (p_payload->'scene') || jsonb_build_object('sceneNo', scene, 'revision', (s->>'revision')::integer + 1,
      'image', s->'image', 'imageError', s->'imageError');
    doc := jsonb_set(p.document, ARRAY['scenes', (scene - 1)::text], s);
  ELSIF p_action = 'import-text' THEN
    IF p.request#>>'{providers,text,id}' NOT IN ('manual','chatgpt-manual','grok-manual') OR p.document IS NOT NULL
      OR p_payload->>'projectId' IS DISTINCT FROM p.id::text OR p_payload->>'schema' IS DISTINCT FROM 'storyboard-mlx-v1' THEN
      RAISE EXCEPTION 'invalid_request';
    END IF;
    proof := jsonb_build_object('providerId', p.request#>>'{providers,text,id}', 'model', p.request#>>'{providers,text,model}',
      'verification','user-import','generatedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'requestId',gen_random_uuid(),'responseId',NULL,'responseModel',NULL,'modelEvidence','unverified');
    doc := (p_payload->'draft') || jsonb_build_object('schema','storyboard-mlx-v1','projectId',p.id,
      'generatedAt',proof->>'generatedAt','textProvenance',proof,'scenes',
      (SELECT jsonb_agg(x || jsonb_build_object('revision',0,'image',NULL,'imageError',NULL) ORDER BY (x->>'sceneNo')::integer)
       FROM jsonb_array_elements(p_payload#>'{draft,scenes}') x));
  ELSIF p_action = 'import-image' THEN
    IF p.request#>>'{providers,image,id}' NOT IN ('manual','chatgpt-manual','grok-manual') THEN RAISE EXCEPTION 'invalid_request'; END IF;
    IF (p_payload->>'sceneRevision')::integer IS DISTINCT FROM (s->>'revision')::integer THEN RAISE EXCEPTION 'revision_conflict'; END IF;
    INSERT INTO public.admin_storyboard_production_assets(id, project_id, owner_id, scene_no, scene_revision, metadata)
      VALUES ((p_payload#>>'{asset,id}')::uuid, p.id, p_owner_id, scene, (s->>'revision')::integer + 1, p_payload->'asset');
    s := s || jsonb_build_object('image', p_payload->'asset', 'imageError', NULL, 'revision', (s->>'revision')::integer + 1);
    doc := jsonb_set(p.document, ARRAY['scenes', (scene - 1)::text], s);
  ELSIF p_action NOT IN ('retry','regenerate') THEN RAISE EXCEPTION 'invalid_request';
  END IF;

  IF doc IS NOT NULL THEN
    doc := jsonb_set(doc, '{revision}', to_jsonb(p.revision + 1));
    UPDATE public.admin_storyboard_production_projects SET document = doc, title = doc->>'title', revision = revision + 1,
      status = public.storyboard_production_final_status(request, doc), updated_at = clock_timestamp() WHERE id = p.id RETURNING * INTO p;
    IF p.document IS NOT NULL THEN
      INSERT INTO public.admin_storyboard_production_revisions(project_id, owner_id, revision, document)
      VALUES (p.id, p.owner_id, p.revision, p.document)
      ON CONFLICT (project_id, revision) DO NOTHING;
    END IF;
    INSERT INTO public.admin_storyboard_production_events(project_id, owner_id, operation, revision, scene_no)
      VALUES (p.id, p_owner_id, CASE p_action WHEN 'edit' THEN 'edited' WHEN 'import-text' THEN 'draft_saved' ELSE 'image_saved' END, p.revision, scene);
  END IF;
  IF p_action IN ('retry','regenerate') OR (p_action = 'import-text' AND p.request#>>'{providers,image,id}' = 'local-mlx') THEN
    IF (p.document IS NULL AND p.request#>>'{providers,text,id}' <> 'local-mlx')
      OR (p.document IS NOT NULL AND p.request#>>'{providers,image,id}' <> 'local-mlx') THEN RAISE EXCEPTION 'nothing_to_retry'; END IF;
    IF p_action <> 'regenerate' AND p.document IS NOT NULL AND public.storyboard_production_final_status(p.request,p.document) = 'ready' THEN
      RAISE EXCEPTION 'nothing_to_retry';
    END IF;
    job_request := coalesce(job_request, gen_random_uuid());
    UPDATE public.admin_storyboard_production_projects SET revision = revision + 1, status = 'waiting_worker',
      document = CASE WHEN document IS NULL THEN NULL ELSE jsonb_set(document,'{revision}',to_jsonb(revision + 1)) END,
      updated_at = clock_timestamp() WHERE id = p.id RETURNING * INTO p;
    IF p.document IS NOT NULL THEN
      INSERT INTO public.admin_storyboard_production_revisions(project_id, owner_id, revision, document)
      VALUES (p.id, p.owner_id, p.revision, p.document)
      ON CONFLICT (project_id, revision) DO NOTHING;
    END IF;
    INSERT INTO public.admin_storyboard_production_jobs(project_id, owner_id, request_id, requested_revision, base_revision, kind, scene_no)
      VALUES (p.id, p_owner_id, job_request, p_revision, p.revision, CASE WHEN p_action = 'regenerate' THEN 'scene' ELSE 'generate' END,
        CASE WHEN p_action = 'regenerate' THEN scene END) RETURNING * INTO j;
    INSERT INTO public.admin_storyboard_production_events(project_id, owner_id, job_id, operation, revision, scene_no)
      VALUES (p.id, p_owner_id, j.id, 'queued', p.revision, j.scene_no);
  END IF;
  RETURN public.storyboard_production_snapshot(p_owner_id, p.id);
END $$;

CREATE OR REPLACE FUNCTION public.storyboard_production_worker(
  p_worker_id uuid, p_action text, p_job_id uuid DEFAULT NULL,
  p_lease_token uuid DEFAULT NULL, p_payload jsonb DEFAULT '{}'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  w public.admin_storyboard_production_workers; p public.admin_storyboard_production_projects;
  j public.admin_storyboard_production_jobs; candidate record; doc jsonb; s jsonb; scene integer;
  result_id uuid; final_status text; result_code text; lease_valid boolean := false;
BEGIN
  SELECT * INTO w FROM public.admin_storyboard_production_workers WHERE id = p_worker_id FOR UPDATE;
  IF NOT FOUND OR w.disabled OR w.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'worker_unauthorized'; END IF;
  PERFORM public.storyboard_production_assert_owner(w.owner_id);
  IF p_action = 'heartbeat' THEN
    UPDATE public.admin_storyboard_production_workers SET last_heartbeat = clock_timestamp(), models = p_payload->'models' WHERE id = w.id;
    IF p_job_id IS NOT NULL THEN
      SELECT project_id INTO candidate FROM public.admin_storyboard_production_jobs WHERE id = p_job_id AND owner_id = w.owner_id;
      IF FOUND THEN
        PERFORM 1 FROM public.admin_storyboard_production_projects WHERE id = candidate.project_id FOR UPDATE;
        UPDATE public.admin_storyboard_production_jobs SET last_heartbeat = clock_timestamp(),
          lease_expires_at = clock_timestamp() + interval '120 seconds', updated_at = clock_timestamp()
          WHERE id = p_job_id AND worker_id = w.id AND owner_id = w.owner_id AND status = 'claimed'
            AND lease_token = p_lease_token AND lease_expires_at > clock_timestamp();
        lease_valid := FOUND;
      END IF;
    END IF;
    RETURN jsonb_build_object('ok',true,'leaseValid',lease_valid);
  END IF;
  IF p_action = 'claim' THEN
    -- Recover only this owner's expired leases, even when this worker already has an expired claim.
    FOR candidate IN SELECT q.id FROM public.admin_storyboard_production_projects q
      WHERE q.owner_id = w.owner_id AND EXISTS (SELECT 1 FROM public.admin_storyboard_production_jobs x
        WHERE x.project_id = q.id AND x.status = 'claimed' AND x.lease_expires_at <= clock_timestamp())
      ORDER BY q.created_at LIMIT 32 FOR UPDATE OF q SKIP LOCKED
    LOOP
      SELECT * INTO j FROM public.admin_storyboard_production_jobs WHERE project_id = candidate.id AND status = 'claimed' FOR UPDATE;
      IF j.lease_expires_at > clock_timestamp() THEN CONTINUE; END IF;
      SELECT * INTO p FROM public.admin_storyboard_production_projects WHERE id = candidate.id;
      UPDATE public.admin_storyboard_production_jobs SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'queued' END,
        stage = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'queued' END, error_code = 'worker_lease_lost',
        lease_token = NULL, lease_expires_at = NULL, worker_id = NULL,
        available_at = clock_timestamp() + make_interval(secs => least(60, 5 * (2 ^ greatest(attempts - 1,0))::integer)),
        updated_at = clock_timestamp() WHERE id = j.id;
      UPDATE public.admin_storyboard_production_projects SET status = CASE WHEN j.attempts >= 3
        THEN public.storyboard_production_final_status(request, document) ELSE 'waiting_worker' END,
        updated_at = clock_timestamp() WHERE id = p.id;
      INSERT INTO public.admin_storyboard_production_events(project_id, owner_id, job_id, worker_id, operation, revision, error_code)
        VALUES (p.id, w.owner_id, j.id, j.worker_id, 'lease_expired', p.revision, 'worker_lease_lost');
    END LOOP;
    IF EXISTS (SELECT 1 FROM public.admin_storyboard_production_jobs WHERE worker_id = w.id AND status = 'claimed') THEN
      RETURN jsonb_build_object('ok',true,'job',NULL);
    END IF;
    FOR candidate IN SELECT q.id FROM public.admin_storyboard_production_projects q
      WHERE q.owner_id = w.owner_id AND EXISTS (SELECT 1 FROM public.admin_storyboard_production_jobs x
        WHERE x.project_id = q.id AND x.status = 'queued' AND x.available_at <= clock_timestamp() AND x.attempts < 3)
      ORDER BY q.created_at LIMIT 64 FOR UPDATE OF q SKIP LOCKED
    LOOP
      SELECT * INTO p FROM public.admin_storyboard_production_projects WHERE id = candidate.id;
      SELECT * INTO j FROM public.admin_storyboard_production_jobs WHERE project_id = p.id AND status = 'queued'
        AND available_at <= clock_timestamp() AND attempts < 3 FOR UPDATE SKIP LOCKED;
      IF NOT FOUND THEN CONTINUE; END IF;
      IF p.document IS NULL THEN
        IF p.request#>>'{providers,text,id}' <> 'local-mlx'
          OR NOT public.storyboard_production_model_available(w.models,p.request#>>'{providers,text,model}','chat') THEN CONTINUE; END IF;
      END IF;
      IF p.request#>>'{providers,image,id}' = 'local-mlx' THEN
        IF NOT public.storyboard_production_model_available(w.models,p.request#>>'{providers,image,model}','image') THEN CONTINUE; END IF;
      ELSIF p.document IS NOT NULL THEN CONTINUE;
      END IF;
      IF p.revision <> j.base_revision OR p.status = 'cancelled' THEN RAISE EXCEPTION 'revision_conflict'; END IF;
      UPDATE public.admin_storyboard_production_jobs SET status = 'claimed', worker_id = w.id, lease_token = gen_random_uuid(),
        lease_expires_at = clock_timestamp() + interval '120 seconds', last_heartbeat = clock_timestamp(), attempts = attempts + 1,
        error_code = NULL, stage = CASE WHEN p.document IS NULL THEN 'text' ELSE 'images' END,
        scene_versions = coalesce((SELECT jsonb_object_agg(x->>'sceneNo', x->'revision') FROM jsonb_array_elements(p.document->'scenes') x),'{}'),
        updated_at = clock_timestamp() WHERE id = j.id RETURNING * INTO j;
      UPDATE public.admin_storyboard_production_workers SET last_heartbeat = clock_timestamp() WHERE id = w.id;
      UPDATE public.admin_storyboard_production_projects SET status = 'generating', updated_at = clock_timestamp() WHERE id = p.id;
      INSERT INTO public.admin_storyboard_production_events(project_id, owner_id, job_id, worker_id, operation, revision, scene_no)
        VALUES (p.id, w.owner_id, j.id, w.id, 'claimed', p.revision, j.scene_no);
      RETURN jsonb_build_object('ok',true,'job',jsonb_build_object('id',j.id,'projectId',p.id,'revision',p.revision,
        'kind',j.kind,'sceneNo',j.scene_no,'request',p.request,'document',p.document,'leaseToken',j.lease_token));
    END LOOP;
    RETURN jsonb_build_object('ok',true,'job',NULL);
  END IF;

  SELECT project_id INTO candidate FROM public.admin_storyboard_production_jobs WHERE id = p_job_id AND owner_id = w.owner_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'worker_lease_lost'; END IF;
  SELECT * INTO p FROM public.admin_storyboard_production_projects WHERE id = candidate.project_id AND owner_id = w.owner_id FOR UPDATE;
  SELECT * INTO j FROM public.admin_storyboard_production_jobs WHERE id = p_job_id FOR UPDATE;
  IF j.status <> 'claimed' OR j.worker_id IS DISTINCT FROM w.id OR j.lease_token IS DISTINCT FROM p_lease_token
    OR j.lease_expires_at <= clock_timestamp() OR p.status = 'cancelled' THEN RAISE EXCEPTION 'worker_lease_lost'; END IF;
  IF p.revision <> j.base_revision THEN RAISE EXCEPTION 'revision_conflict'; END IF;
  scene := (p_payload->>'sceneNo')::integer;
  IF scene IS NOT NULL THEN
    IF p.document IS NULL OR scene NOT BETWEEN 1 AND jsonb_array_length(p.document->'scenes')
      OR (j.kind = 'scene' AND j.scene_no <> scene) THEN RAISE EXCEPTION 'invalid_scene'; END IF;
    s := p.document->'scenes'->(scene - 1);
    IF (j.scene_versions->>scene::text)::integer IS DISTINCT FROM (s->>'revision')::integer THEN RAISE EXCEPTION 'revision_conflict'; END IF;
  END IF;
  IF p_action = 'check' THEN
    RETURN jsonb_build_object('ok',true,'project',public.storyboard_production_project_json(p),'job',
      public.storyboard_production_job_json(j),'kind',j.kind,'sceneRevision',(s->>'revision')::integer,'models',w.models);
  END IF;
  result_code := p_payload->>'errorCode';
  IF NOT public.storyboard_production_error_allowed(result_code) THEN RAISE EXCEPTION 'invalid_request'; END IF;
  IF p_action IN ('draft','image') THEN
    result_id := (p_payload#>>'{provenance,requestId}')::uuid;
    IF result_id IS NULL OR result_id = ANY(j.result_request_ids) THEN RAISE EXCEPTION 'revision_conflict'; END IF;
    IF p_payload#>>'{provenance,providerId}' IS DISTINCT FROM 'local-mlx'
      OR p_payload#>>'{provenance,verification}' IS DISTINCT FROM 'local-worker'
      OR p_payload#>>'{provenance,model}' IS DISTINCT FROM p.request#>>ARRAY['providers',(CASE WHEN p_action = 'draft' THEN 'text' ELSE 'image' END),'model']
      OR NOT public.storyboard_production_model_available(w.models,p_payload#>>'{provenance,model}',CASE WHEN p_action = 'draft' THEN 'chat' ELSE 'image' END)
      THEN RAISE EXCEPTION 'model_identity_mismatch'; END IF;
  END IF;
  IF p_action = 'draft' THEN
    IF p.document IS NOT NULL OR j.kind <> 'generate' OR p.request#>>'{providers,text,id}' <> 'local-mlx' THEN RAISE EXCEPTION 'revision_conflict'; END IF;
    doc := (p_payload->'draft') || jsonb_build_object('schema','storyboard-mlx-v1','projectId',p.id,
      'generatedAt',p_payload#>>'{provenance,generatedAt}','textProvenance',p_payload->'provenance','scenes',
      (SELECT jsonb_agg(x || jsonb_build_object('revision',0,'image',NULL,'imageError',NULL) ORDER BY (x->>'sceneNo')::integer)
       FROM jsonb_array_elements(p_payload#>'{draft,scenes}') x));
    UPDATE public.admin_storyboard_production_jobs SET stage = 'images', scene_versions =
      (SELECT jsonb_object_agg(x->>'sceneNo',0) FROM jsonb_array_elements(doc->'scenes') x) WHERE id = j.id;
    UPDATE public.admin_storyboard_production_projects SET draft_worker_id = w.id WHERE id = p.id;
  ELSIF p_action IN ('image','scene-error') THEN
    IF scene IS NULL OR p.request#>>'{providers,image,id}' <> 'local-mlx' THEN RAISE EXCEPTION 'invalid_scene'; END IF;
    IF p_action = 'image' THEN
      IF (p_payload->>'sceneRevision')::integer IS DISTINCT FROM (s->>'revision')::integer THEN RAISE EXCEPTION 'revision_conflict'; END IF;
      INSERT INTO public.admin_storyboard_production_assets(id,project_id,owner_id,scene_no,scene_revision,metadata,worker_id,job_id)
        VALUES ((p_payload#>>'{asset,id}')::uuid,p.id,w.owner_id,scene,(s->>'revision')::integer + 1,p_payload->'asset',w.id,j.id);
      s := s || jsonb_build_object('image',p_payload->'asset','imageError',NULL,'revision',(s->>'revision')::integer + 1);
    ELSE
      IF result_code IS NULL THEN RAISE EXCEPTION 'invalid_request'; END IF;
      s := s || jsonb_build_object('imageError',result_code,'revision',(s->>'revision')::integer + 1);
    END IF;
    doc := jsonb_set(p.document,ARRAY['scenes',(scene - 1)::text],s);
  ELSIF p_action = 'finish' THEN
    final_status := public.storyboard_production_final_status(p.request,p.document);
    IF result_code IS NOT NULL AND final_status = 'ready' THEN final_status := 'partial'; END IF;
    UPDATE public.admin_storyboard_production_jobs SET status = CASE WHEN result_code IS NULL AND final_status IN ('ready','awaiting_import')
      THEN 'succeeded' ELSE 'failed' END, stage = CASE WHEN result_code IS NULL AND final_status IN ('ready','awaiting_import') THEN 'complete' ELSE 'failed' END,
      error_code = coalesce(result_code,CASE WHEN final_status IN ('failed','partial') THEN 'image_missing' END),
      lease_token = NULL, lease_expires_at = NULL, updated_at = clock_timestamp() WHERE id = j.id;
    UPDATE public.admin_storyboard_production_projects SET status = final_status, updated_at = clock_timestamp() WHERE id = p.id;
    INSERT INTO public.admin_storyboard_production_events(project_id,owner_id,job_id,worker_id,operation,revision,error_code)
      VALUES (p.id,w.owner_id,j.id,w.id,'finished',p.revision,result_code);
    RETURN jsonb_build_object('ok',true);
  ELSE RAISE EXCEPTION 'invalid_request';
  END IF;
  doc := jsonb_set(doc,'{revision}',to_jsonb(p.revision + 1));
  UPDATE public.admin_storyboard_production_projects SET document = doc, title = doc->>'title', revision = revision + 1,
    status = CASE WHEN request#>>'{providers,image,id}' IN ('manual','chatgpt-manual','grok-manual') THEN 'awaiting_import' ELSE 'generating' END,
    updated_at = clock_timestamp() WHERE id = p.id RETURNING * INTO p;
    IF p.document IS NOT NULL THEN
      INSERT INTO public.admin_storyboard_production_revisions(project_id, owner_id, revision, document)
      VALUES (p.id, p.owner_id, p.revision, p.document)
      ON CONFLICT (project_id, revision) DO NOTHING;
    END IF;
  UPDATE public.admin_storyboard_production_jobs SET base_revision = p.revision,
    result_request_ids = CASE WHEN result_id IS NULL THEN result_request_ids ELSE array_append(result_request_ids,result_id) END,
    updated_at = clock_timestamp() WHERE id = j.id;
  INSERT INTO public.admin_storyboard_production_events(project_id,owner_id,job_id,worker_id,operation,revision,scene_no,error_code)
    VALUES (p.id,w.owner_id,j.id,w.id,CASE p_action WHEN 'draft' THEN 'draft_saved' WHEN 'image' THEN 'image_saved' ELSE 'scene_failed' END,
      p.revision,scene,result_code);
  RETURN jsonb_build_object('ok',true);
END $$;

INSERT INTO public.admin_storyboard_production_revisions(project_id, owner_id, revision, document)
SELECT id, owner_id, revision, document
FROM public.admin_storyboard_production_projects
WHERE document IS NOT NULL
ON CONFLICT (project_id, revision) DO NOTHING;

DO $$ DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'storyboard_production_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_storyboard_production_projects TO privacy_workflow_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_storyboard_production_workers TO privacy_workflow_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_storyboard_production_jobs TO privacy_workflow_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_storyboard_production_assets TO privacy_workflow_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_storyboard_production_events TO privacy_workflow_owner;
GRANT SELECT, INSERT, DELETE ON public.admin_storyboard_production_revisions TO privacy_workflow_owner;
GRANT SELECT, INSERT, DELETE ON public.admin_storyboard_production_restores TO privacy_workflow_owner;
GRANT USAGE, SELECT ON SEQUENCE public.admin_storyboard_production_events_id_seq TO privacy_workflow_owner;

CREATE POLICY storyboard_production_owner_access ON public.admin_storyboard_production_revisions
  FOR ALL TO privacy_workflow_owner USING (true) WITH CHECK (true);
CREATE POLICY storyboard_production_owner_access ON public.admin_storyboard_production_restores
  FOR ALL TO privacy_workflow_owner USING (true) WITH CHECK (true);

ALTER FUNCTION public.storyboard_production_assert_owner(uuid) SECURITY DEFINER;
ALTER FUNCTION public.storyboard_production_error_allowed(text) SECURITY DEFINER;
ALTER FUNCTION public.storyboard_production_final_status(jsonb, jsonb) SECURITY DEFINER;
ALTER FUNCTION public.storyboard_production_project_json(public.admin_storyboard_production_projects) SECURITY DEFINER;
ALTER FUNCTION public.storyboard_production_job_json(public.admin_storyboard_production_jobs) SECURITY DEFINER;
ALTER FUNCTION public.storyboard_production_snapshot(uuid, uuid) SECURITY DEFINER;
ALTER FUNCTION public.storyboard_production_auth_worker(text) SECURITY DEFINER;
ALTER FUNCTION public.storyboard_production_model_available(jsonb, text, text) SECURITY DEFINER;
ALTER FUNCTION public.storyboard_production_admin(uuid, text, uuid, integer, jsonb) SECURITY DEFINER;
ALTER FUNCTION public.storyboard_production_worker(uuid, text, uuid, uuid, jsonb) SECURITY DEFINER;

ALTER FUNCTION public.storyboard_production_assert_owner(uuid) SET search_path = '';
ALTER FUNCTION public.storyboard_production_error_allowed(text) SET search_path = '';
ALTER FUNCTION public.storyboard_production_final_status(jsonb, jsonb) SET search_path = '';
ALTER FUNCTION public.storyboard_production_project_json(public.admin_storyboard_production_projects) SET search_path = '';
ALTER FUNCTION public.storyboard_production_job_json(public.admin_storyboard_production_jobs) SET search_path = '';
ALTER FUNCTION public.storyboard_production_snapshot(uuid, uuid) SET search_path = '';
ALTER FUNCTION public.storyboard_production_auth_worker(text) SET search_path = '';
ALTER FUNCTION public.storyboard_production_model_available(jsonb, text, text) SET search_path = '';
ALTER FUNCTION public.storyboard_production_admin(uuid, text, uuid, integer, jsonb) SET search_path = '';
ALTER FUNCTION public.storyboard_production_worker(uuid, text, uuid, uuid, jsonb) SET search_path = '';

ALTER FUNCTION public.storyboard_production_assert_owner(uuid) OWNER TO privacy_workflow_owner;
ALTER FUNCTION public.storyboard_production_error_allowed(text) OWNER TO privacy_workflow_owner;
ALTER FUNCTION public.storyboard_production_final_status(jsonb, jsonb) OWNER TO privacy_workflow_owner;
ALTER FUNCTION public.storyboard_production_project_json(public.admin_storyboard_production_projects) OWNER TO privacy_workflow_owner;
ALTER FUNCTION public.storyboard_production_job_json(public.admin_storyboard_production_jobs) OWNER TO privacy_workflow_owner;
ALTER FUNCTION public.storyboard_production_snapshot(uuid, uuid) OWNER TO privacy_workflow_owner;
ALTER FUNCTION public.storyboard_production_auth_worker(text) OWNER TO privacy_workflow_owner;
ALTER FUNCTION public.storyboard_production_model_available(jsonb, text, text) OWNER TO privacy_workflow_owner;
ALTER FUNCTION public.storyboard_production_admin(uuid, text, uuid, integer, jsonb) OWNER TO privacy_workflow_owner;
ALTER FUNCTION public.storyboard_production_worker(uuid, text, uuid, uuid, jsonb) OWNER TO privacy_workflow_owner;

COMMIT;
