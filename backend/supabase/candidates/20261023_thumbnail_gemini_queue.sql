-- Reversible candidate, NOT an applied migration. Public RPC/G014 and private
-- Storage convergence must be reviewed against the real hosted catalog first.
-- No model key, bearer plaintext, provider output or reference pixels is stored here.
BEGIN;

DO $$ BEGIN
  IF pg_catalog.to_regprocedure('storyboard_control.assert_owner(uuid)') IS NULL THEN
    RAISE EXCEPTION 'thumbnail_owner_contract_missing';
  END IF;
END $$;
CREATE SCHEMA thumbnail_control;
REVOKE ALL ON SCHEMA thumbnail_control FROM PUBLIC, anon, authenticated, privacy_workflow_owner;
GRANT USAGE ON SCHEMA thumbnail_control TO service_role;

CREATE TABLE public.admin_thumbnail_workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_sha256 text NOT NULL UNIQUE CHECK (token_sha256 ~ '^[a-f0-9]{64}$'),
  disabled boolean NOT NULL DEFAULT false,
  revoked_at timestamptz,
  models text[] NOT NULL DEFAULT '{}' CHECK (cardinality(models) <= 3
    AND models <@ ARRAY['gemini-3.1-flash-image','gemini-3-pro-image','gemini-3.8-flash']::text[]
    AND array_position(models,NULL) IS NULL),
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(id,owner_id)
);
CREATE TABLE public.admin_thumbnail_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[a-f0-9]{64}$'),
  model text NOT NULL CHECK (model IN ('gemini-3.1-flash-image','gemini-3-pro-image','gemini-3.8-flash')),
  input jsonb NOT NULL CHECK (jsonb_typeof(input)='object' AND octet_length(input::text)<=131072),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','claimed','provider_started','unknown','succeeded','cancelled')),
  worker_id uuid,
  attempt_id uuid,
  fence bigint NOT NULL DEFAULT 0 CHECK (fence BETWEEN 0 AND 9007199254740991),
  lease_expires_at timestamptz,
  provider_started_at timestamptz,
  cancel_requested boolean NOT NULL DEFAULT false,
  result jsonb CHECK (result IS NULL OR (jsonb_typeof(result)='object' AND octet_length(result::text)<=16384)),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(worker_id,owner_id) REFERENCES public.admin_thumbnail_workers(id,owner_id),
  UNIQUE(owner_id,request_id),
  CHECK ((state IN ('claimed','provider_started'))=(lease_expires_at IS NOT NULL)),
  CHECK ((state IN ('claimed','provider_started','unknown','succeeded'))=(worker_id IS NOT NULL)),
  CHECK ((state IN ('claimed','provider_started','unknown','succeeded'))=(attempt_id IS NOT NULL)),
  CHECK ((state IN ('provider_started','unknown','succeeded'))=(provider_started_at IS NOT NULL)),
  CHECK ((state='succeeded')=(result IS NOT NULL)),
  CHECK (state IN ('queued','cancelled') OR fence>0)
);
-- Identity/path changes cannot bypass an unresolved generation of the same input.
CREATE UNIQUE INDEX thumbnail_one_unresolved_input ON public.admin_thumbnail_jobs(owner_id,input_sha256)
  WHERE state IN ('queued','claimed','provider_started','unknown');
-- Unknown still occupies the slot: lease expiry cannot prove that a delayed SDK
-- start or remote generation is over. Only confirmed result recovery releases it.
CREATE UNIQUE INDEX thumbnail_one_active_generation ON public.admin_thumbnail_jobs((true))
  WHERE state IN ('claimed','provider_started','unknown');
CREATE INDEX thumbnail_queue_order ON public.admin_thumbnail_jobs(created_at,id) WHERE state='queued';
CREATE INDEX thumbnail_owner_history ON public.admin_thumbnail_jobs(owner_id,created_at DESC,id DESC);
CREATE TABLE public.admin_thumbnail_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES public.admin_thumbnail_jobs(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  attempt_id uuid,
  fence bigint NOT NULL,
  operation text NOT NULL CHECK (operation IN ('enqueued','claimed','prestart_expired','provider_started','unknown','succeeded','cancelled','cancel_requested')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX thumbnail_job_events ON public.admin_thumbnail_events(job_id,id);

ALTER TABLE public.admin_thumbnail_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_thumbnail_workers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.admin_thumbnail_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_thumbnail_jobs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.admin_thumbnail_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_thumbnail_events FORCE ROW LEVEL SECURITY;
-- Clear inherited default ACLs too: GRANT alone does not narrow an existing ALL
-- grant or its grant options. Only these newly created queue objects are reset.
REVOKE ALL ON public.admin_thumbnail_workers,public.admin_thumbnail_jobs,public.admin_thumbnail_events FROM PUBLIC,anon,authenticated,privacy_workflow_owner,service_role;
REVOKE ALL ON SEQUENCE public.admin_thumbnail_events_id_seq FROM PUBLIC,anon,authenticated,privacy_workflow_owner,service_role;
GRANT SELECT,UPDATE ON public.admin_thumbnail_workers TO service_role;
GRANT SELECT,INSERT,UPDATE ON public.admin_thumbnail_jobs TO service_role;
GRANT SELECT,INSERT ON public.admin_thumbnail_events TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.admin_thumbnail_events_id_seq TO service_role;

CREATE FUNCTION thumbnail_control.valid_input(p_owner uuid,p_request uuid,p_model text,p_input jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE ref jsonb; pos integer:=0; total bigint:=0; suffix text;
BEGIN
  IF p_model='gemini-3.8-flash' THEN
    ref:=p_input->'document';
    RETURN coalesce(jsonb_typeof(p_input)='object' AND octet_length(p_input::text)<=1024
      AND p_input->>'contract'='thumbnail-gemini-chat-v1' AND p_input->>'model'=p_model
      AND p_input-ARRAY['contract','model','document']::text[]='{}'::jsonb
      AND jsonb_typeof(ref)='object' AND ref ?& ARRAY['path','sha256','bytes','mimeType']
      AND ref-ARRAY['path','sha256','bytes','mimeType']::text[]='{}'::jsonb
      AND jsonb_typeof(ref->'path')='string' AND ref->>'path'=p_owner::text||'/'||p_request::text||'/input/chat.json'
      AND jsonb_typeof(ref->'sha256')='string' AND ref->>'sha256' ~ '^[a-f0-9]{64}$'
      AND jsonb_typeof(ref->'bytes')='number' AND ref->>'bytes' ~ '^[0-9]{1,5}$'
      AND CASE WHEN ref->>'bytes' ~ '^[0-9]{1,5}$' THEN (ref->>'bytes')::bigint BETWEEN 16 AND 65536 ELSE false END
      AND ref->>'mimeType'='application/json',false);
  END IF;
  IF p_input IS NULL OR jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR octet_length(p_input::text)>131072
    OR p_input->>'contract' IS DISTINCT FROM 'thumbnail-gemini-image-v1'
    OR p_input->>'model' IS DISTINCT FROM p_model
    OR jsonb_typeof(p_input->'prompt') IS DISTINCT FROM 'string'
    OR length(btrim(p_input->>'prompt'))=0 OR octet_length(p_input->>'prompt')>65536
    OR jsonb_typeof(p_input->'references') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_input->'references')>8
    OR p_input-ARRAY['contract','model','prompt','references']::text[] <> '{}'::jsonb THEN RETURN false; END IF;
  FOR ref IN SELECT value FROM jsonb_array_elements(p_input->'references') LOOP
    IF jsonb_typeof(ref) IS DISTINCT FROM 'object'
      OR NOT(ref ?& ARRAY['path','sha256','mimeType','bytes','role'])
      OR ref-ARRAY['path','sha256','mimeType','bytes','role']::text[] <> '{}'::jsonb
      OR jsonb_typeof(ref->'sha256') IS DISTINCT FROM 'string' OR jsonb_typeof(ref->'role') IS DISTINCT FROM 'string'
      OR jsonb_typeof(ref->'path') IS DISTINCT FROM 'string' OR jsonb_typeof(ref->'mimeType') IS DISTINCT FROM 'string'
      OR coalesce(ref->>'sha256','') !~ '^[a-f0-9]{64}$'
      OR coalesce(ref->>'role','') NOT IN ('host','food','object','person','other')
      OR jsonb_typeof(ref->'bytes') IS DISTINCT FROM 'number'
      OR coalesce(ref->>'bytes','') !~ '^[0-9]{1,8}$' THEN RETURN false; END IF;
    total:=total+(ref->>'bytes')::bigint;
    IF (ref->>'bytes')::bigint NOT BETWEEN 16 AND 8388608 OR total>16777216 THEN RETURN false; END IF;
    suffix:=CASE ref->>'mimeType' WHEN 'image/png' THEN 'png' WHEN 'image/jpeg' THEN 'jpeg' WHEN 'image/webp' THEN 'webp' END;
    IF suffix IS NULL OR ref->>'path' IS DISTINCT FROM
      p_owner::text||'/'||p_request::text||'/input/'||pos::text||'-'||(ref->>'sha256')||'.'||suffix THEN RETURN false; END IF;
    pos:=pos+1;
  END LOOP;
  RETURN true;
END $$;

CREATE FUNCTION thumbnail_control.job_json(j public.admin_thumbnail_jobs) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT jsonb_build_object('id',j.id,'ownerId',j.owner_id,'requestId',j.request_id,'inputSha256',j.input_sha256,
    'model',j.model,'input',j.input,'state',j.state,'workerId',j.worker_id,'attemptId',j.attempt_id,'fence',j.fence,
    'leaseExpiresAt',j.lease_expires_at,'providerStartedAt',j.provider_started_at,'cancelRequested',j.cancel_requested,
    'result',j.result,'createdAt',j.created_at,'updatedAt',j.updated_at)
$$;

CREATE FUNCTION thumbnail_control.preserve_input() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ BEGIN
  IF ROW(NEW.id,NEW.owner_id,NEW.request_id,NEW.input_sha256,NEW.model,NEW.input,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.owner_id,OLD.request_id,OLD.input_sha256,OLD.model,OLD.input,OLD.created_at)
    THEN RAISE EXCEPTION 'thumbnail_input_immutable'; END IF;
  IF OLD.provider_started_at IS NOT NULL AND ROW(NEW.attempt_id,NEW.worker_id,NEW.fence,NEW.provider_started_at)
    IS DISTINCT FROM ROW(OLD.attempt_id,OLD.worker_id,OLD.fence,OLD.provider_started_at)
    THEN RAISE EXCEPTION 'thumbnail_started_identity_immutable'; END IF;
  IF OLD.provider_started_at IS NOT NULL AND NEW.state NOT IN ('provider_started','unknown','succeeded')
    OR OLD.state='unknown' AND NEW.state='provider_started' THEN RAISE EXCEPTION 'thumbnail_no_restart'; END IF;
  IF OLD.state='succeeded' AND ROW(NEW.state,NEW.result) IS DISTINCT FROM ROW(OLD.state,OLD.result)
    OR OLD.state='cancelled' AND NEW.state<>'cancelled' THEN RAISE EXCEPTION 'thumbnail_terminal_immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER thumbnail_input_immutable BEFORE UPDATE ON public.admin_thumbnail_jobs
  FOR EACH ROW EXECUTE FUNCTION thumbnail_control.preserve_input();

CREATE FUNCTION public.thumbnail_production_auth_worker(p_token_sha256 text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE w public.admin_thumbnail_workers;
BEGIN
  IF p_token_sha256 IS NULL OR p_token_sha256 !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'worker_unauthorized'; END IF;
  SELECT * INTO w FROM public.admin_thumbnail_workers WHERE token_sha256=p_token_sha256 AND NOT disabled AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'worker_unauthorized'; END IF;
  PERFORM storyboard_control.assert_owner(w.owner_id);
  RETURN jsonb_build_object('id',w.id,'ownerId',w.owner_id,'models',w.models);
END $$;

CREATE FUNCTION public.thumbnail_production_admin(
  p_owner_id uuid,p_action text,p_job_id uuid DEFAULT NULL,p_request_id uuid DEFAULT NULL,
  p_input_sha256 text DEFAULT NULL,p_model text DEFAULT NULL,p_input jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE j public.admin_thumbnail_jobs; listing jsonb; before_time timestamptz; before_id uuid; reference_bucket timestamptz;
BEGIN
  PERFORM storyboard_control.assert_owner(p_owner_id);
  IF p_action='reference_candidates' THEN
    -- Bounded response from the declared channel's collected API metadata, not a claim of
    -- complete bucket coverage, independent per-video ownership, face detection or extraction.
    IF NOT EXISTS(SELECT 1 FROM public.youtube_channel_kpi_snapshots c
      WHERE c.channel_id='UCfpaSruWW3S4dibonKXENjA' AND c.source='youtube-data-api'
      AND lower(c.channel_handle) IN ('@tzuyang6145','tzuyang6145')) THEN
      PERFORM storyboard_control.assert_owner(p_owner_id);
      RETURN jsonb_build_object('channelId','UCfpaSruWW3S4dibonKXENjA','channelVerified',false,
        'bucketStartedAt',NULL,'candidates','[]'::jsonb);
    END IF;
    SELECT v.bucket_started_at INTO reference_bucket FROM public.youtube_video_kpi_snapshots v
      WHERE v.channel_id='UCfpaSruWW3S4dibonKXENjA' AND v.source='youtube-data-api'
      ORDER BY v.bucket_started_at DESC LIMIT 1;
    SELECT coalesce(jsonb_agg(jsonb_build_object('videoId',r.video_id,'title',r.title)
      ORDER BY r.view_count DESC,r.video_id),'[]'::jsonb) INTO listing FROM (
      SELECT v.video_id,left(v.title,200) title,v.view_count FROM public.youtube_video_kpi_snapshots v
      WHERE v.channel_id='UCfpaSruWW3S4dibonKXENjA' AND v.source='youtube-data-api'
      AND v.bucket_started_at=reference_bucket AND v.video_id ~ '^[A-Za-z0-9_-]{11}$'
      ORDER BY v.view_count DESC,v.video_id LIMIT 32) r;
    PERFORM storyboard_control.assert_owner(p_owner_id);
    RETURN jsonb_build_object('channelId','UCfpaSruWW3S4dibonKXENjA','channelVerified',true,
      'bucketStartedAt',reference_bucket,'candidates',listing);
  ELSIF p_action='enqueue' THEN
    IF p_request_id IS NULL OR p_input_sha256 IS NULL OR p_input_sha256 !~ '^[a-f0-9]{64}$'
      OR p_model IS NULL OR p_model NOT IN ('gemini-3.1-flash-image','gemini-3-pro-image','gemini-3.8-flash')
      OR NOT thumbnail_control.valid_input(p_owner_id,p_request_id,p_model,p_input) THEN RAISE EXCEPTION 'invalid_input'; END IF;
    INSERT INTO public.admin_thumbnail_jobs(owner_id,request_id,input_sha256,model,input)
      VALUES(p_owner_id,p_request_id,p_input_sha256,p_model,p_input) ON CONFLICT DO NOTHING RETURNING * INTO j;
    IF NOT FOUND THEN
      SELECT * INTO j FROM public.admin_thumbnail_jobs WHERE owner_id=p_owner_id AND request_id=p_request_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'input_already_active'; END IF;
      IF j.input_sha256 IS DISTINCT FROM p_input_sha256 OR j.model IS DISTINCT FROM p_model OR j.input IS DISTINCT FROM p_input
        THEN RAISE EXCEPTION 'request_conflict'; END IF;
    ELSE
      INSERT INTO public.admin_thumbnail_events(job_id,owner_id,fence,operation) VALUES(j.id,j.owner_id,j.fence,'enqueued');
    END IF;
    PERFORM storyboard_control.assert_owner(p_owner_id);
    RETURN thumbnail_control.job_json(j);
  ELSIF p_action IN ('request','chat_request') THEN
    -- Recover a DB-generated job ID after enqueue ACK loss without inserting or
    -- issuing a start permission. A missing row is not proof of a rolled-back enqueue.
    IF p_request_id IS NULL THEN RAISE EXCEPTION 'invalid_input'; END IF;
    SELECT * INTO j FROM public.admin_thumbnail_jobs
      WHERE owner_id=p_owner_id AND request_id=p_request_id
        AND ((model='gemini-3.8-flash')=(p_action='chat_request')) FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    PERFORM storyboard_control.assert_owner(p_owner_id);
    RETURN thumbnail_control.job_json(j);
  ELSIF p_action IN ('list','chat_list') THEN
    IF p_input IS NOT NULL AND p_input <> '{}'::jsonb THEN
      IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR octet_length(p_input::text)>256
        OR p_input-ARRAY['beforeCreatedAt','beforeId']::text[]<>'{}'::jsonb
        OR jsonb_typeof(p_input->'beforeCreatedAt') IS DISTINCT FROM 'string'
        OR jsonb_typeof(p_input->'beforeId') IS DISTINCT FROM 'string'
        OR length(p_input->>'beforeCreatedAt') NOT BETWEEN 20 AND 40
        OR NOT pg_catalog.pg_input_is_valid(p_input->>'beforeCreatedAt','timestamp with time zone')
        OR NOT pg_catalog.pg_input_is_valid(p_input->>'beforeId','uuid') THEN RAISE EXCEPTION 'invalid_input'; END IF;
      before_time:=(p_input->>'beforeCreatedAt')::timestamptz;before_id:=(p_input->>'beforeId')::uuid;
    END IF;
    SELECT coalesce(jsonb_agg(item ORDER BY created_at DESC,id DESC),'[]'::jsonb) INTO listing FROM (
      SELECT id,created_at,jsonb_build_object('id',id,'requestId',request_id,'model',model,'state',state,
        'cancelRequested',cancel_requested,'createdAt',created_at,'updatedAt',updated_at) AS item
      FROM public.admin_thumbnail_jobs WHERE owner_id=p_owner_id
        AND ((model='gemini-3.8-flash')=(p_action='chat_list'))
        AND (before_time IS NULL OR (created_at,id)<(before_time,before_id))
      ORDER BY created_at DESC,id DESC LIMIT 32
    ) bounded;
    RETURN listing;
  ELSIF p_action NOT IN ('snapshot','cancel','chat_snapshot','chat_cancel') OR p_action IS NULL THEN RAISE EXCEPTION 'invalid_action'; END IF;
  SELECT * INTO j FROM public.admin_thumbnail_jobs WHERE id=p_job_id AND owner_id=p_owner_id
    AND ((model='gemini-3.8-flash')=(p_action IN ('chat_snapshot','chat_cancel'))) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'job_not_found'; END IF;
  PERFORM storyboard_control.assert_owner(p_owner_id);
  IF p_action IN ('cancel','chat_cancel') AND j.state IN ('queued','claimed') THEN
    UPDATE public.admin_thumbnail_jobs SET state='cancelled',cancel_requested=true,worker_id=NULL,attempt_id=NULL,
      lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=j.id RETURNING * INTO j;
    INSERT INTO public.admin_thumbnail_events(job_id,owner_id,fence,operation) VALUES(j.id,j.owner_id,j.fence,'cancelled');
  ELSIF p_action IN ('cancel','chat_cancel') AND j.state IN ('provider_started','unknown') AND NOT j.cancel_requested THEN
    UPDATE public.admin_thumbnail_jobs SET cancel_requested=true,updated_at=clock_timestamp() WHERE id=j.id RETURNING * INTO j;
    INSERT INTO public.admin_thumbnail_events(job_id,owner_id,attempt_id,fence,operation)
      VALUES(j.id,j.owner_id,j.attempt_id,j.fence,'cancel_requested');
  END IF;
  RETURN thumbnail_control.job_json(j);
END $$;

CREATE FUNCTION thumbnail_control.valid_result(j public.admin_thumbnail_jobs,p_result jsonb) RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE item jsonb; variant text; suffix text; proof jsonb; prefix text;
BEGIN
  IF j.model='gemini-3.8-flash' THEN
    item:=p_result->'content';
    IF p_result IS NULL OR jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR octet_length(p_result::text)>16384
      OR NOT(p_result ?& ARRAY['content','provenance'])
      OR p_result-ARRAY['content','provenance']::text[]<>'{}'::jsonb
      OR jsonb_typeof(item) IS DISTINCT FROM 'object' OR NOT(item ?& ARRAY['path','sha256','bytes','mimeType'])
      OR item-ARRAY['path','sha256','bytes','mimeType']::text[]<>'{}'::jsonb
      OR jsonb_typeof(item->'path') IS DISTINCT FROM 'string'
      OR item->>'path' IS DISTINCT FROM j.owner_id::text||'/'||j.id::text||'/'||j.attempt_id::text||'/response.json'
      OR jsonb_typeof(item->'sha256') IS DISTINCT FROM 'string' OR coalesce(item->>'sha256','') !~ '^[a-f0-9]{64}$'
      OR jsonb_typeof(item->'bytes') IS DISTINCT FROM 'number' OR coalesce(item->>'bytes','') !~ '^[0-9]{1,5}$'
      OR item->>'mimeType' IS DISTINCT FROM 'application/json' THEN RETURN false; END IF;
    IF (item->>'bytes')::bigint NOT BETWEEN 16 AND 48000 THEN RETURN false; END IF;
  ELSE
  IF p_result IS NULL OR jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR octet_length(p_result::text)>16384
    OR NOT(p_result ?& ARRAY['original','normalized','provenance'])
    OR p_result-ARRAY['original','normalized','provenance']::text[] <> '{}'::jsonb THEN RETURN false; END IF;
  prefix:=j.owner_id::text||'/'||j.id::text||'/'||j.attempt_id::text||'/';
  FOREACH variant IN ARRAY ARRAY['original','normalized'] LOOP
    item:=p_result->variant;
    IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR NOT(item ?& ARRAY['path','sha256','mimeType','bytes','width','height'])
      OR item-ARRAY['path','sha256','mimeType','bytes','width','height']::text[] <> '{}'::jsonb
      OR coalesce(item->>'sha256','') !~ '^[a-f0-9]{64}$'
      OR jsonb_typeof(item->'bytes') IS DISTINCT FROM 'number' OR coalesce(item->>'bytes','') !~ '^[0-9]{1,8}$'
      OR jsonb_typeof(item->'width') IS DISTINCT FROM 'number' OR coalesce(item->>'width','') !~ '^[0-9]{1,8}$'
      OR jsonb_typeof(item->'height') IS DISTINCT FROM 'number' OR coalesce(item->>'height','') !~ '^[0-9]{1,8}$' THEN RETURN false; END IF;
    IF (item->>'bytes')::bigint NOT BETWEEN 16 AND 12582912 OR (item->>'width')::bigint<1 OR (item->>'height')::bigint<1
      OR (item->>'width')::bigint*(item->>'height')::bigint>16000000 THEN RETURN false; END IF;
    suffix:=CASE item->>'mimeType' WHEN 'image/png' THEN 'png' WHEN 'image/jpeg' THEN 'jpeg' WHEN 'image/webp' THEN 'webp' END;
    IF suffix IS NULL OR item->>'path' IS DISTINCT FROM prefix||variant||'.'||suffix THEN RETURN false; END IF;
    IF variant='normalized' AND (item->>'mimeType' IS DISTINCT FROM 'image/png'
      OR item->>'width' IS DISTINCT FROM '1280' OR item->>'height' IS DISTINCT FROM '720') THEN RETURN false; END IF;
  END LOOP;
  END IF;
  proof:=p_result->'provenance';
  RETURN coalesce(jsonb_typeof(proof)='object'
    AND proof->>'providerId'='gemini-api' AND proof->>'model'=j.model
    AND proof->>'verification'='official-api' AND proof->>'modelEvidence'='response'
    AND proof->>'attemptId'=j.attempt_id::text AND proof->>'inputSha256'=j.input_sha256
    AND proof->>'responseModel' ~ ('^'||replace(j.model,'.','\.')||'(-([0-9]{3}|[0-9]{2}-[0-9]{2}))?$')
    AND jsonb_typeof(proof->'generatedAt')='string'
    AND proof->>'generatedAt' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$'
    AND pg_catalog.pg_input_is_valid(proof->>'generatedAt','timestamp with time zone')
    AND (proof->'responseId'='null'::jsonb OR (jsonb_typeof(proof->'responseId')='string' AND length(proof->>'responseId') BETWEEN 1 AND 256))
    AND proof-ARRAY['providerId','model','verification','modelEvidence','attemptId','inputSha256','responseModel','generatedAt','responseId']::text[]='{}'::jsonb,false);
END $$;

CREATE FUNCTION public.thumbnail_production_worker(
  p_token_sha256 text,p_action text,p_job_id uuid DEFAULT NULL,p_attempt_id uuid DEFAULT NULL,
  p_fence bigint DEFAULT NULL,p_input_sha256 text DEFAULT NULL,p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE w public.admin_thumbnail_workers; j public.admin_thumbnail_jobs; expired public.admin_thumbnail_jobs;
        identity jsonb; advertised_models text[];
BEGIN
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION 'unsupported_isolation'; END IF;
  -- Every worker RPC takes the worker row before any job row. No operation takes the inverse order.
  identity:=public.thumbnail_production_auth_worker(p_token_sha256);
  SELECT * INTO w FROM public.admin_thumbnail_workers WHERE id=(identity->>'id')::uuid;
  UPDATE public.admin_thumbnail_workers SET last_seen_at=clock_timestamp() WHERE id=w.id;
  IF p_action='models' THEN
    IF p_payload IS NULL OR jsonb_typeof(p_payload->'models') IS DISTINCT FROM 'array'
      OR jsonb_array_length(p_payload->'models')>3 OR p_payload-ARRAY['models']::text[]<>'{}'::jsonb
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'models') v WHERE jsonb_typeof(v)<>'string')
      THEN RAISE EXCEPTION 'invalid_models'; END IF;
    SELECT coalesce(array_agg(value),'{}'::text[]) INTO advertised_models FROM jsonb_array_elements_text(p_payload->'models');
    IF NOT(advertised_models <@ ARRAY['gemini-3.1-flash-image','gemini-3-pro-image','gemini-3.8-flash']::text[])
      OR cardinality(advertised_models)<>(SELECT count(DISTINCT value) FROM unnest(advertised_models) value) THEN RAISE EXCEPTION 'invalid_models'; END IF;
    UPDATE public.admin_thumbnail_workers SET models=advertised_models WHERE id=w.id;
    RETURN jsonb_build_object('models',advertised_models);
  ELSIF p_action='claim' THEN
    -- Transaction-only try-lock: serialize queue admission, without waiting while holding a job row.
    IF NOT pg_catalog.pg_try_advisory_xact_lock(20261023,731) THEN RETURN NULL; END IF;
    SELECT * INTO expired FROM public.admin_thumbnail_jobs
      WHERE owner_id=w.owner_id AND state IN ('claimed','provider_started') AND lease_expires_at<=clock_timestamp()
      ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
    IF FOUND THEN
      IF expired.state='claimed' THEN
        INSERT INTO public.admin_thumbnail_events(job_id,owner_id,attempt_id,fence,operation)
          VALUES(expired.id,expired.owner_id,expired.attempt_id,expired.fence,'prestart_expired');
        UPDATE public.admin_thumbnail_jobs SET state='queued',worker_id=NULL,attempt_id=NULL,
          lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=expired.id;
      ELSE
        UPDATE public.admin_thumbnail_jobs SET state='unknown',lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=expired.id;
        INSERT INTO public.admin_thumbnail_events(job_id,owner_id,attempt_id,fence,operation)
          VALUES(expired.id,expired.owner_id,expired.attempt_id,expired.fence,'unknown');
      END IF;
    END IF;
    IF EXISTS(SELECT 1 FROM public.admin_thumbnail_jobs WHERE state IN ('claimed','provider_started','unknown')) THEN RETURN NULL; END IF;
    SELECT * INTO j FROM public.admin_thumbnail_jobs WHERE owner_id=w.owner_id AND state='queued'
      AND model=ANY(w.models) AND NOT cancel_requested AND fence<9007199254740991
      ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN RETURN NULL; END IF;
    PERFORM storyboard_control.assert_owner(w.owner_id);
    UPDATE public.admin_thumbnail_jobs SET state='claimed',worker_id=w.id,attempt_id=gen_random_uuid(),fence=fence+1,
      lease_expires_at=clock_timestamp()+interval '120 seconds',updated_at=clock_timestamp() WHERE id=j.id RETURNING * INTO j;
    INSERT INTO public.admin_thumbnail_events(job_id,owner_id,attempt_id,fence,operation) VALUES(j.id,j.owner_id,j.attempt_id,j.fence,'claimed');
    RETURN thumbnail_control.job_json(j);
  ELSIF p_action NOT IN ('heartbeat','start','unknown','complete') OR p_action IS NULL THEN RAISE EXCEPTION 'invalid_action'; END IF;

  SELECT * INTO j FROM public.admin_thumbnail_jobs WHERE id=p_job_id AND owner_id=w.owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'job_not_found'; END IF;
  PERFORM storyboard_control.assert_owner(w.owner_id);
  IF j.worker_id IS DISTINCT FROM w.id OR j.attempt_id IS DISTINCT FROM p_attempt_id OR j.fence IS DISTINCT FROM p_fence
    OR j.input_sha256 IS DISTINCT FROM p_input_sha256 THEN RAISE EXCEPTION 'attempt_conflict'; END IF;

  IF p_action='start' THEN
    -- Check real time AFTER the job lock, not a timestamp captured before a blocking wait.
    IF j.state<>'claimed' OR j.cancel_requested OR j.lease_expires_at<=clock_timestamp() OR NOT(j.model=ANY(w.models))
      THEN RAISE EXCEPTION 'start_not_confirmed'; END IF;
    UPDATE public.admin_thumbnail_jobs SET state='provider_started',provider_started_at=clock_timestamp(),
      lease_expires_at=clock_timestamp()+interval '180 seconds',updated_at=clock_timestamp() WHERE id=j.id RETURNING * INTO j;
    INSERT INTO public.admin_thumbnail_events(job_id,owner_id,attempt_id,fence,operation) VALUES(j.id,j.owner_id,j.attempt_id,j.fence,'provider_started');
    RETURN jsonb_build_object('providerId','gemini-api','model',j.model,'ownerId',j.owner_id,'jobId',j.id,
      'attemptId',j.attempt_id,'fence',j.fence,'inputSha256',j.input_sha256,'state','provider_started','permission','fresh-commit');
  ELSIF p_action='heartbeat' THEN
    IF j.state IN ('claimed','provider_started') AND j.lease_expires_at>clock_timestamp() THEN
      UPDATE public.admin_thumbnail_jobs SET lease_expires_at=clock_timestamp()+interval '180 seconds',updated_at=clock_timestamp() WHERE id=j.id RETURNING * INTO j;
    ELSIF j.state='provider_started' THEN
      UPDATE public.admin_thumbnail_jobs SET state='unknown',lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=j.id RETURNING * INTO j;
      INSERT INTO public.admin_thumbnail_events(job_id,owner_id,attempt_id,fence,operation) VALUES(j.id,j.owner_id,j.attempt_id,j.fence,'unknown');
    ELSIF j.state<>'unknown' THEN RAISE EXCEPTION 'worker_lease_lost'; END IF;
  ELSIF p_action='unknown' THEN
    IF j.state='provider_started' THEN
      UPDATE public.admin_thumbnail_jobs SET state='unknown',lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=j.id RETURNING * INTO j;
      INSERT INTO public.admin_thumbnail_events(job_id,owner_id,attempt_id,fence,operation) VALUES(j.id,j.owner_id,j.attempt_id,j.fence,'unknown');
    ELSIF j.state NOT IN ('unknown','succeeded') THEN RAISE EXCEPTION 'attempt_conflict'; END IF;
  ELSIF p_action='complete' THEN
    IF NOT thumbnail_control.valid_result(j,p_payload) THEN RAISE EXCEPTION 'invalid_result'; END IF;
    IF j.state='succeeded' THEN
      IF j.result IS DISTINCT FROM p_payload THEN RAISE EXCEPTION 'result_conflict'; END IF;
    ELSIF j.state IN ('provider_started','unknown') THEN
      UPDATE public.admin_thumbnail_jobs SET state='succeeded',result=p_payload,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE id=j.id RETURNING * INTO j;
      INSERT INTO public.admin_thumbnail_events(job_id,owner_id,attempt_id,fence,operation) VALUES(j.id,j.owner_id,j.attempt_id,j.fence,'succeeded');
    ELSE RAISE EXCEPTION 'attempt_conflict'; END IF;
  END IF;
  RETURN thumbnail_control.job_json(j);
END $$;

REVOKE ALL ON FUNCTION thumbnail_control.valid_input(uuid,uuid,text,jsonb),
  thumbnail_control.job_json(public.admin_thumbnail_jobs),thumbnail_control.preserve_input(),
  thumbnail_control.valid_result(public.admin_thumbnail_jobs,jsonb) FROM PUBLIC,anon,authenticated,privacy_workflow_owner;
GRANT EXECUTE ON FUNCTION thumbnail_control.valid_input(uuid,uuid,text,jsonb),
  thumbnail_control.job_json(public.admin_thumbnail_jobs),thumbnail_control.valid_result(public.admin_thumbnail_jobs,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.thumbnail_production_auth_worker(text),
  public.thumbnail_production_admin(uuid,text,uuid,uuid,text,text,jsonb),
  public.thumbnail_production_worker(text,text,uuid,uuid,bigint,text,jsonb) FROM PUBLIC,anon,authenticated,privacy_workflow_owner;
GRANT EXECUTE ON FUNCTION public.thumbnail_production_auth_worker(text),
  public.thumbnail_production_admin(uuid,text,uuid,uuid,text,text,jsonb),
  public.thumbnail_production_worker(text,text,uuid,uuid,bigint,text,jsonb) TO service_role;
COMMIT;
