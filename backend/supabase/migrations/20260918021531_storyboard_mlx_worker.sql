-- Unapplied local-first storyboard workflow. Legacy admin_storyboard_jobs is untouched.
-- Provision ONLY from an admitted server service-role connection:
-- INSERT public.admin_storyboard_production_workers (owner_id, token_sha256)
-- VALUES (<active admin UUID>, <lowercase SHA256 of the UTF-8 bearer token>);
-- The bearer token is canonical base64url of >=32 random bytes; never persist plaintext.
-- Disable with disabled=true or revoke with revoked_at=clock_timestamp().
-- Storage uses the server's Storage client, never credentials delivered to a worker.
BEGIN;

CREATE TABLE public.admin_storyboard_production_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  title text NOT NULL DEFAULT '' CHECK (length(title) <= 200),
  request jsonb NOT NULL CHECK (jsonb_typeof(request) = 'object' AND octet_length(request::text) <= 65536
    AND request->>'workflow' = 'storyboard-mlx-v1'),
  document jsonb CHECK (document IS NULL OR (jsonb_typeof(document) = 'object'
    AND octet_length(document::text) <= 196608 AND document->>'schema' = 'storyboard-mlx-v1'
    AND document->>'projectId' = id::text AND (document->>'revision')::integer = revision)),
  status text NOT NULL CHECK (status IN ('waiting_worker','generating','awaiting_import','partial','ready','failed','cancelled')),
  draft_worker_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(owner_id, request_id), UNIQUE(id, owner_id)
);

CREATE TABLE public.admin_storyboard_production_workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_sha256 text NOT NULL UNIQUE CHECK (token_sha256 ~ '^[a-f0-9]{64}$'),
  disabled boolean NOT NULL DEFAULT false,
  revoked_at timestamptz,
  models jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(models) = 'array'
    AND jsonb_array_length(models) <= 64 AND octet_length(models::text) <= 65536),
  last_heartbeat timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(id, owner_id)
);

CREATE TABLE public.admin_storyboard_production_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  request_id uuid NOT NULL,
  requested_revision integer NOT NULL CHECK (requested_revision >= 0),
  base_revision integer NOT NULL CHECK (base_revision >= 0),
  kind text NOT NULL CHECK (kind IN ('generate','scene')),
  scene_no integer CHECK (scene_no BETWEEN 1 AND 12),
  scene_versions jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(scene_versions) = 'object'),
  result_request_ids uuid[] NOT NULL DEFAULT '{}' CHECK (cardinality(result_request_ids) <= 64),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','claimed','succeeded','failed','cancelled')),
  stage text NOT NULL DEFAULT 'queued' CHECK (stage IN ('queued','text','images','complete','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  worker_id uuid,
  lease_token uuid,
  lease_expires_at timestamptz,
  last_heartbeat timestamptz,
  error_code text CHECK (error_code ~ '^[a-z_]{1,80}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(project_id, owner_id) REFERENCES public.admin_storyboard_production_projects(id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY(worker_id, owner_id) REFERENCES public.admin_storyboard_production_workers(id, owner_id),
  UNIQUE(owner_id, request_id),
  CHECK ((kind = 'scene') = (scene_no IS NOT NULL)),
  CHECK ((status = 'claimed') = (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL AND worker_id IS NOT NULL))
);
CREATE UNIQUE INDEX storyboard_production_one_active_project
  ON public.admin_storyboard_production_jobs(project_id) WHERE status IN ('queued','claimed');
CREATE UNIQUE INDEX storyboard_production_one_active_worker
  ON public.admin_storyboard_production_jobs(worker_id) WHERE status = 'claimed';
CREATE INDEX storyboard_production_queue ON public.admin_storyboard_production_jobs(owner_id, available_at, created_at)
  WHERE status IN ('queued','claimed');
CREATE INDEX storyboard_production_project_jobs ON public.admin_storyboard_production_jobs(project_id, created_at DESC);
CREATE INDEX storyboard_production_owner_projects ON public.admin_storyboard_production_projects(owner_id, updated_at DESC);

CREATE TABLE public.admin_storyboard_production_assets (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  scene_no integer NOT NULL CHECK (scene_no BETWEEN 1 AND 12),
  scene_revision integer NOT NULL CHECK (scene_revision >= 0),
  metadata jsonb NOT NULL CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 16384
    AND metadata->>'id' = id::text AND metadata->>'trustPolicy' = 'storyboard-private-asset-v1'),
  worker_id uuid,
  job_id uuid REFERENCES public.admin_storyboard_production_jobs(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(project_id, owner_id) REFERENCES public.admin_storyboard_production_projects(id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY(worker_id, owner_id) REFERENCES public.admin_storyboard_production_workers(id, owner_id)
);
CREATE INDEX storyboard_production_project_assets ON public.admin_storyboard_production_assets(project_id, owner_id);

CREATE TABLE public.admin_storyboard_production_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  job_id uuid REFERENCES public.admin_storyboard_production_jobs(id),
  worker_id uuid,
  operation text NOT NULL CHECK (operation IN ('created','queued','claimed','edited','draft_saved','image_saved',
    'scene_failed','cancelled','lease_expired','finished')),
  revision integer NOT NULL CHECK (revision >= 0),
  scene_no integer CHECK (scene_no BETWEEN 1 AND 12),
  error_code text CHECK (error_code ~ '^[a-z_]{1,80}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(project_id, owner_id) REFERENCES public.admin_storyboard_production_projects(id, owner_id) ON DELETE CASCADE
);
CREATE INDEX storyboard_production_project_events ON public.admin_storyboard_production_events(project_id, id DESC);

-- No browser policies: both API families authenticate before using server-only RPCs.
ALTER TABLE public.admin_storyboard_production_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_storyboard_production_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_storyboard_production_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_storyboard_production_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_storyboard_production_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_storyboard_production_projects, public.admin_storyboard_production_workers,
  public.admin_storyboard_production_jobs, public.admin_storyboard_production_assets,
  public.admin_storyboard_production_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.admin_storyboard_production_projects, public.admin_storyboard_production_workers,
  public.admin_storyboard_production_jobs, public.admin_storyboard_production_assets,
  public.admin_storyboard_production_events TO service_role;
REVOKE ALL ON SEQUENCE public.admin_storyboard_production_events_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.admin_storyboard_production_events_id_seq TO service_role;

INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('storyboard-private', 'storyboard-private', false, 12582912, ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT(id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE FUNCTION public.storyboard_production_assert_owner(p_owner_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles r JOIN public.user_account_status s USING (user_id)
    WHERE r.user_id = p_owner_id AND r.role = 'admin' AND s.account_status = 'active') THEN
    RAISE EXCEPTION 'owner_forbidden';
  END IF;
END $$;

CREATE FUNCTION public.storyboard_production_error_allowed(p_code text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT p_code IS NULL OR p_code = ANY(ARRAY['worker_lease_lost','generation_cancelled','revision_conflict',
    'model_not_installed','model_capability_mismatch','local_model_unavailable','model_timeout',
    'invalid_structured_response','bge_dependency_unavailable','model_response_too_large',
    'invalid_image_response','invalid_image','image_too_large','provider_auth_failed','provider_forbidden',
    'provider_rate_limited','provider_failed','provider_not_configured','model_identity_mismatch',
    'invalid_local_endpoint','invalid_model_request','invalid_model_response','image_missing']);
$$;
ALTER TABLE public.admin_storyboard_production_jobs ADD CHECK (public.storyboard_production_error_allowed(error_code));
ALTER TABLE public.admin_storyboard_production_events ADD CHECK (public.storyboard_production_error_allowed(error_code));

CREATE FUNCTION public.storyboard_production_final_status(p_request jsonb, p_document jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE missing boolean; failed boolean; has_image boolean;
BEGIN
  IF p_document IS NULL THEN
    RETURN CASE WHEN p_request#>>'{providers,text,id}' IN ('manual','chatgpt-manual','grok-manual')
      THEN 'awaiting_import' ELSE 'failed' END;
  END IF;
  SELECT bool_or(s->'image' IS NULL OR s->'image' = 'null'::jsonb),
    bool_or(s->>'imageError' IS NOT NULL), bool_or(s->'image' IS NOT NULL AND s->'image' <> 'null'::jsonb)
    INTO missing, failed, has_image FROM jsonb_array_elements(p_document->'scenes') s;
  IF missing AND p_request#>>'{providers,image,id}' IN ('manual','chatgpt-manual','grok-manual') THEN RETURN 'awaiting_import'; END IF;
  IF missing OR failed THEN RETURN CASE WHEN has_image THEN 'partial' ELSE 'failed' END; END IF;
  RETURN 'ready';
END $$;

CREATE FUNCTION public.storyboard_production_project_json(p public.admin_storyboard_production_projects) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object('id', p.id, 'revision', p.revision, 'request', p.request, 'document', p.document,
    'status', p.status, 'createdAt', p.created_at, 'updatedAt', p.updated_at);
$$;
CREATE FUNCTION public.storyboard_production_job_json(j public.admin_storyboard_production_jobs) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN j.id IS NULL THEN 'null'::jsonb ELSE jsonb_build_object('id', j.id, 'status', j.status,
    'stage', j.stage, 'sceneNo', j.scene_no, 'errorCode', j.error_code, 'attempts', j.attempts,
    'lastHeartbeat', j.last_heartbeat) END;
$$;
CREATE FUNCTION public.storyboard_production_snapshot(p_owner_id uuid, p_project_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p public.admin_storyboard_production_projects; j public.admin_storyboard_production_jobs;
BEGIN
  SELECT * INTO p FROM public.admin_storyboard_production_projects WHERE id = p_project_id AND owner_id = p_owner_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'project_not_found'; END IF;
  SELECT * INTO j FROM public.admin_storyboard_production_jobs WHERE project_id = p.id ORDER BY created_at DESC, id DESC LIMIT 1;
  RETURN jsonb_build_object('ok', true, 'project', public.storyboard_production_project_json(p),
    'job', public.storyboard_production_job_json(j));
END $$;

CREATE FUNCTION public.storyboard_production_auth_worker(p_token_sha256 text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE w public.admin_storyboard_production_workers;
BEGIN
  SELECT * INTO w FROM public.admin_storyboard_production_workers
    WHERE token_sha256 = p_token_sha256 AND NOT disabled AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'worker_unauthorized'; END IF;
  PERFORM public.storyboard_production_assert_owner(w.owner_id);
  RETURN jsonb_build_object('id', w.id, 'ownerId', w.owner_id, 'models', w.models);
END $$;

CREATE FUNCTION public.storyboard_production_model_available(p_models jsonb, p_model text, p_capability text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(p_models) m WHERE m->>'id' = p_model
    AND (m->>'bytes_on_disk')::numeric > 0 AND m->'capabilities' ? p_capability);
$$;

CREATE FUNCTION public.storyboard_production_admin(
  p_owner_id uuid, p_action text, p_project_id uuid DEFAULT NULL,
  p_revision integer DEFAULT NULL, p_payload jsonb DEFAULT '{}'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  p public.admin_storyboard_production_projects; j public.admin_storyboard_production_jobs;
  old_job public.admin_storyboard_production_jobs; s jsonb; doc jsonb; proof jsonb;
  scene integer; job_request uuid; initial_status text; project_rows jsonb; worker_rows jsonb;
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
  IF p_revision IS DISTINCT FROM p.revision THEN RAISE EXCEPTION 'revision_conflict'; END IF;
  SELECT * INTO j FROM public.admin_storyboard_production_jobs WHERE project_id = p.id AND status IN ('queued','claimed') FOR UPDATE;
  IF p_action = 'cancel' THEN
    IF j.id IS NULL OR j.id IS DISTINCT FROM (p_payload->>'jobId')::uuid THEN RAISE EXCEPTION 'worker_lease_lost'; END IF;
    UPDATE public.admin_storyboard_production_jobs SET status = 'cancelled', stage = 'cancelled', error_code = 'generation_cancelled',
      lease_token = NULL, lease_expires_at = NULL, updated_at = clock_timestamp() WHERE id = j.id;
    UPDATE public.admin_storyboard_production_projects SET status = 'cancelled', revision = revision + 1,
      document = CASE WHEN document IS NULL THEN NULL ELSE jsonb_set(document, '{revision}', to_jsonb(revision + 1)) END,
      updated_at = clock_timestamp() WHERE id = p.id RETURNING * INTO p;
    INSERT INTO public.admin_storyboard_production_events(project_id, owner_id, job_id, operation, revision)
      VALUES (p.id, p_owner_id, j.id, 'cancelled', p.revision);
    RETURN public.storyboard_production_snapshot(p_owner_id, p.id);
  END IF;
  IF j.id IS NOT NULL THEN RAISE EXCEPTION 'project_busy'; END IF;

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
    INSERT INTO public.admin_storyboard_production_jobs(project_id, owner_id, request_id, requested_revision, base_revision, kind, scene_no)
      VALUES (p.id, p_owner_id, job_request, p_revision, p.revision, CASE WHEN p_action = 'regenerate' THEN 'scene' ELSE 'generate' END,
        CASE WHEN p_action = 'regenerate' THEN scene END) RETURNING * INTO j;
    INSERT INTO public.admin_storyboard_production_events(project_id, owner_id, job_id, operation, revision, scene_no)
      VALUES (p.id, p_owner_id, j.id, 'queued', p.revision, j.scene_no);
  END IF;
  RETURN public.storyboard_production_snapshot(p_owner_id, p.id);
END $$;

-- Lock order: worker -> project -> job. Admin operations only lock project -> job.
-- Every result and lease renewal checks expiry with clock_timestamp(), not transaction start time.
CREATE FUNCTION public.storyboard_production_worker(
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
  UPDATE public.admin_storyboard_production_jobs SET base_revision = p.revision,
    result_request_ids = CASE WHEN result_id IS NULL THEN result_request_ids ELSE array_append(result_request_ids,result_id) END,
    updated_at = clock_timestamp() WHERE id = j.id;
  INSERT INTO public.admin_storyboard_production_events(project_id,owner_id,job_id,worker_id,operation,revision,scene_no,error_code)
    VALUES (p.id,w.owner_id,j.id,w.id,CASE p_action WHEN 'draft' THEN 'draft_saved' WHEN 'image' THEN 'image_saved' ELSE 'scene_failed' END,
      p.revision,scene,result_code);
  RETURN jsonb_build_object('ok',true);
END $$;

-- Default function EXECUTE is PUBLIC; revoke for every helper as well as entrypoint.
DO $$ DECLARE f record;
BEGIN
  FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'storyboard_production_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',f.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
  END LOOP;
END $$;

-- The local executor applies migrations as supabase_admin. The G014 catalog
-- contract admits only postgres, privacy_workflow_owner and privacy_auth_bridge
-- as public function owners, and requires every allowlisted SECURITY DEFINER RPC
-- to be owned by privacy_workflow_owner with an empty lookup path. These RPCs are
-- the only access path to the storyboard tables (anon and authenticated hold no
-- table grants at all), so privacy_workflow_owner needs the table privileges and
-- an owner policy on the RLS-enabled tables it reads and writes on their behalf.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_storyboard_production_projects TO privacy_workflow_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_storyboard_production_workers TO privacy_workflow_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_storyboard_production_jobs TO privacy_workflow_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_storyboard_production_assets TO privacy_workflow_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_storyboard_production_events TO privacy_workflow_owner;
GRANT USAGE, SELECT ON SEQUENCE public.admin_storyboard_production_events_id_seq TO privacy_workflow_owner;

CREATE POLICY storyboard_production_owner_access ON public.admin_storyboard_production_projects
  FOR ALL TO privacy_workflow_owner USING (true) WITH CHECK (true);
CREATE POLICY storyboard_production_owner_access ON public.admin_storyboard_production_workers
  FOR ALL TO privacy_workflow_owner USING (true) WITH CHECK (true);
CREATE POLICY storyboard_production_owner_access ON public.admin_storyboard_production_jobs
  FOR ALL TO privacy_workflow_owner USING (true) WITH CHECK (true);
CREATE POLICY storyboard_production_owner_access ON public.admin_storyboard_production_assets
  FOR ALL TO privacy_workflow_owner USING (true) WITH CHECK (true);
CREATE POLICY storyboard_production_owner_access ON public.admin_storyboard_production_events
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

-- G014 requires the effective EXECUTE grantee matrix of every public function
-- to be declared in the allowlist, so register the service_role-only entrypoints
-- and helpers created above.
WITH expected(source_signature, grantee) AS (VALUES
  ('public.storyboard_production_assert_owner(uuid)', 'service_role'::name),
  ('public.storyboard_production_error_allowed(text)', 'service_role'::name),
  ('public.storyboard_production_final_status(jsonb,jsonb)', 'service_role'::name),
  ('public.storyboard_production_project_json(public.admin_storyboard_production_projects)', 'service_role'::name),
  ('public.storyboard_production_job_json(public.admin_storyboard_production_jobs)', 'service_role'::name),
  ('public.storyboard_production_snapshot(uuid,uuid)', 'service_role'::name),
  ('public.storyboard_production_auth_worker(text)', 'service_role'::name),
  ('public.storyboard_production_model_available(jsonb,text,text)', 'service_role'::name),
  ('public.storyboard_production_admin(uuid,text,uuid,integer,jsonb)', 'service_role'::name),
  ('public.storyboard_production_worker(uuid,text,uuid,uuid,jsonb)', 'service_role'::name)
)
INSERT INTO privacy_retention.g014_public_rpc_allowlist (
  function_schema,
  function_name,
  identity_arguments,
  grantee,
  source_signature
)
SELECT
  function_schema.nspname,
  function_row.proname,
  function_row.proargtypes::text,
  expected.grantee,
  expected.source_signature
  FROM expected
  JOIN LATERAL pg_catalog.to_regprocedure(expected.source_signature)
    AS resolved(function_oid) ON true
  JOIN pg_catalog.pg_proc AS function_row
    ON function_row.oid = resolved.function_oid
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = function_row.pronamespace
ON CONFLICT (source_signature, grantee) DO UPDATE
SET function_schema = EXCLUDED.function_schema,
    function_name = EXCLUDED.function_name,
    identity_arguments = EXCLUDED.identity_arguments;
COMMIT;
