-- DRAFT / UNAPPLIED. One new forward source, not an execution authorization.
-- The admitted existing single-migration compiler owns the outer transaction,
-- exact ledger prefix/record/readback and lost-ACK reconciliation. A current
-- writer fence, protected source and full exact-version rehearsal remain required.
-- Never execute the raw queue candidate or concatenate its BEGIN/COMMIT here.

-- A per-transaction marker makes psql per-statement autocommit fail before any
-- persistent feature/role change. It is an accident guard, not an auth token.
DO $thumbnail_install_transaction$
BEGIN
  IF current_user<>'postgres' OR session_user<>'postgres'
     OR pg_catalog.current_setting('is_superuser')<>'off'
     OR pg_catalog.current_setting('server_version_num')::integer/10000<>17
     OR pg_catalog.current_setting('transaction_read_only')<>'off'
     OR pg_catalog.current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'thumbnail_install_executor_denied' USING ERRCODE='42501';
  END IF;
  PERFORM pg_catalog.set_config('search_path','',true);
  PERFORM pg_catalog.set_config('thumbnail_install.xact',pg_catalog.pg_current_xact_id()::text,true);
END $thumbnail_install_transaction$;

DO $thumbnail_install_pre$
DECLARE before_members jsonb; after_members jsonb; assertion_metadata jsonb; checker oid;
BEGIN
  IF pg_catalog.current_setting('thumbnail_install.xact',true) IS DISTINCT FROM pg_catalog.pg_current_xact_id_if_assigned()::text
     OR pg_catalog.current_setting('thumbnail_install.xact',true) IS NULL THEN
    RAISE EXCEPTION 'thumbnail_install_outer_transaction_required' USING ERRCODE='25000';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tzudong:thumbnail-production-install:v1',0));
  IF pg_catalog.to_regnamespace('thumbnail_control') IS NOT NULL
     OR pg_catalog.to_regclass('public.admin_thumbnail_workers') IS NOT NULL
     OR pg_catalog.to_regclass('public.admin_thumbnail_jobs') IS NOT NULL
     OR pg_catalog.to_regclass('public.admin_thumbnail_events') IS NOT NULL
     OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname IN ('thumbnail_production_auth_worker','thumbnail_production_admin','thumbnail_production_worker'))
     OR pg_catalog.to_regclass('pg_temp.thumbnail_install_before') IS NOT NULL
     OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE pronamespace=pg_catalog.pg_my_temp_schema() AND proname='thumbnail_install_g014_check') THEN
    RAISE EXCEPTION 'thumbnail_install_prior_conflict' USING ERRCODE='55000';
  END IF;
  IF pg_catalog.pg_has_role('postgres','privacy_workflow_owner','SET')
     OR pg_catalog.pg_has_role('postgres','privacy_workflow_owner','USAGE')
     OR (SELECT count(*) FROM pg_catalog.pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole AND member='postgres'::regrole)<>1
     OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole AND member='postgres'::regrole
       AND grantor='supabase_admin'::regrole AND admin_option AND NOT inherit_option AND NOT set_option) THEN
    RAISE EXCEPTION 'thumbnail_install_membership_denied' USING ERRCODE='42501';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='privacy_retention' AND p.proname IN ('assert_g014_workflow_owner_contract','assert_g014_public_rpc_allowlist','assert_g014_definer_contract','assert_g014_catalog_contract'))<>4
     OR EXISTS(SELECT 1 FROM (VALUES
       ('privacy_retention.assert_g014_workflow_owner_contract()','345aed9acb1da06262740ef06d81e51855a44c7470aa8b431a23e6fa629aab1d',false),
       ('privacy_retention.assert_g014_public_rpc_allowlist()','f23203a0a2366eca16b30b256729e859efc556952df8cb75485924153e1188ef',true),
       ('privacy_retention.assert_g014_definer_contract()','b9e2f7d812783deee6c91d27d22d6c2019be9aa04e4f1221cc7482567775354a',true),
       ('privacy_retention.assert_g014_catalog_contract()','50948ddce54dbba9497978964bebc535c27ebe98fb0f46bf05e2ec17ab0b9e01',true)
     ) expected(signature,body_sha256,definer)
     LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(expected.signature)
     WHERE p.oid IS NULL OR p.proowner<>'privacy_workflow_owner'::regrole OR p.prosecdef IS DISTINCT FROM expected.definer
       OR p.prokind<>'f' OR p.prorettype<>'void'::regtype OR p.proretset OR p.pronargs<>0
       OR p.proargnames IS NOT NULL OR p.proargmodes IS NOT NULL OR p.proargdefaults IS NOT NULL
       OR p.pronargdefaults<>0 OR p.provariadic<>0 OR p.prosupport<>0 OR p.procost<>100 OR p.prorows<>0
       OR p.proisstrict OR p.proleakproof OR p.provolatile<>'v' OR p.proparallel<>'u'
       OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
       OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
       OR p.proacl::text IS DISTINCT FROM '{privacy_workflow_owner=X/privacy_workflow_owner}'
       OR pg_catalog.octet_length(p.prosrc)>65536
       OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')<>expected.body_sha256) THEN
    RAISE EXCEPTION 'thumbnail_install_assertion_source_drift' USING ERRCODE='55000';
  END IF;
  SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) INTO before_members FROM pg_catalog.pg_auth_members m;
  SELECT jsonb_agg(to_jsonb(p)-'prosrc' ORDER BY p.oid) INTO assertion_metadata FROM pg_catalog.pg_proc p
    WHERE p.oid=ANY(ARRAY['privacy_retention.assert_g014_workflow_owner_contract()'::regprocedure,
      'privacy_retention.assert_g014_public_rpc_allowlist()'::regprocedure,
      'privacy_retention.assert_g014_definer_contract()'::regprocedure,
      'privacy_retention.assert_g014_catalog_contract()'::regprocedure]::oid[]);
  CREATE TEMPORARY TABLE pg_temp.thumbnail_install_before(memberships jsonb NOT NULL,assertions jsonb NOT NULL) ON COMMIT DROP;
  INSERT INTO pg_temp.thumbnail_install_before VALUES(before_members,assertion_metadata);
  GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
  SET LOCAL ROLE privacy_workflow_owner;
  CREATE FUNCTION pg_temp.thumbnail_install_g014_check(p_phase text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $check$
  BEGIN
    IF session_user<>'postgres' OR current_user<>'privacy_workflow_owner' OR p_phase IS NULL OR p_phase NOT IN ('pre','post') THEN
      RAISE EXCEPTION 'thumbnail_install_check_caller_denied' USING ERRCODE='42501';
    END IF;
    PERFORM privacy_retention.assert_g014_workflow_owner_contract();
    PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
    PERFORM privacy_retention.assert_g014_definer_contract();
    PERFORM privacy_retention.assert_g014_catalog_contract();
    IF p_phase='post' THEN DROP FUNCTION pg_temp.thumbnail_install_g014_check(text); END IF;
  END $check$;
  REVOKE ALL ON FUNCTION pg_temp.thumbnail_install_g014_check(text) FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION pg_temp.thumbnail_install_g014_check(text) TO postgres;
  SET LOCAL ROLE postgres;
  REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;
  SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) INTO after_members FROM pg_catalog.pg_auth_members m;
  IF after_members IS DISTINCT FROM before_members THEN
    RAISE EXCEPTION 'thumbnail_install_pre_membership_drift' USING ERRCODE='55000';
  END IF;
  checker:=pg_catalog.to_regprocedure('pg_temp.thumbnail_install_g014_check(text)');
  IF checker IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=checker
      AND p.proowner='privacy_workflow_owner'::regrole AND p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[]
      AND (SELECT count(*)=2 AND bool_and(a.privilege_type='EXECUTE' AND NOT a.is_grantable
        AND a.grantee IN ('postgres'::regrole,'privacy_workflow_owner'::regrole)) FROM pg_catalog.aclexplode(p.proacl) a)) THEN
    RAISE EXCEPTION 'thumbnail_install_bridge_drift' USING ERRCODE='55000';
  END IF;
  PERFORM pg_temp.thumbnail_install_g014_check('pre');
END $thumbnail_install_pre$;


-- BEGIN PINNED QUEUE EXECUTION 24fbdb8d1c99b0666de4b4f5c1b33896f6c7fa4ea20af4ad6ebd491722d4945a
-- Reversible candidate, NOT an applied migration. Public RPC/G014 and private
-- Storage convergence must be reviewed against the real hosted catalog first.
-- No model key, bearer plaintext, provider output or reference pixels is stored here.


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


-- END PINNED QUEUE EXECUTION

GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;

-- BEGIN PINNED REGISTRATION c61ceaa8fb071a1cb59f9e85cfd931ed1b4075b5be825cb96f794cec5379716a
-- DRAFT / UNAPPLIED: exact G014 registration companion for the thumbnail candidate.
-- No BEGIN/COMMIT and no role grant. A separately admitted outer migration must
-- run full G014 before queue creation with the temporary owner lease absent,
-- install the pinned queue, then run this block with its separately admitted
-- lease. Revoke that self-grant BEFORE full G014 post and preserve the provider's
-- bootstrap membership. All stages and the ledger belong to one outer commit.
-- This block alone is NOT a queue/bucket installer or a full G014 certificate.
DO $thumbnail_g014_registration$
DECLARE
  new_signatures text[] := ARRAY['public.thumbnail_production_auth_worker(text)','public.thumbnail_production_admin(uuid,text,uuid,uuid,text,text,jsonb)','public.thumbnail_production_worker(text,text,uuid,uuid,bigint,text,jsonb)'];
  item record; target oid; source_before text; source_after text; definition_before text;
  anchor text; addition text := $addition$      'public.thumbnail_production_auth_worker(text)',
      'public.thumbnail_production_admin(uuid,text,uuid,uuid,text,text,jsonb)',
      'public.thumbnail_production_worker(text,text,uuid,uuid,bigint,text,jsonb)',
$addition$;
  metadata_before jsonb; metadata_after jsonb; registry_before jsonb; registry_after jsonb;
  old_registry_digest text; rpc_before jsonb; rpc_after jsonb; source_bytes integer;
BEGIN
  IF current_user <> 'postgres' OR current_setting('is_superuser') <> 'off'
    OR current_setting('transaction_read_only') <> 'off'
    OR current_setting('transaction_isolation') <> 'read committed'
    OR NOT pg_catalog.pg_has_role('postgres','privacy_workflow_owner','SET') THEN
    RAISE EXCEPTION 'thumbnail_g014_executor_not_admitted' USING ERRCODE='42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('thumbnail-g014-registration-v1',0));
  EXECUTE 'SET LOCAL ROLE privacy_workflow_owner';
  LOCK TABLE privacy_retention.g014_public_rpc_allowlist IN SHARE ROW EXCLUSIVE MODE;
  -- Bound visible rows and text before sorting/serializing the registry.
  -- This is not a bound on physical MVCC/IO work or arbitrary privileged DDL.
  IF (SELECT count(*) FROM (SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist LIMIT 138) bounded)<>137 THEN
    RAISE EXCEPTION 'thumbnail_g014_registry_cardinality_drift' USING ERRCODE='55000';
  END IF;
  IF EXISTS (SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist
      WHERE octet_length(identity_arguments)>4096 OR octet_length(source_signature)>4096) THEN
    RAISE EXCEPTION 'thumbnail_g014_registry_size_drift' USING ERRCODE='55000';
  END IF;
  SELECT jsonb_build_object(
 'role',(SELECT jsonb_build_object('login',rolcanlogin,'super',rolsuper,'inherit',rolinherit,'createDb',rolcreatedb,'bypassRls',rolbypassrls,'createRole',rolcreaterole,'replication',rolreplication) FROM pg_catalog.pg_roles WHERE rolname='privacy_workflow_owner'),
 'schema',(SELECT jsonb_build_object('acl',nspacl::text,'owner',pg_catalog.pg_get_userbyid(nspowner)) FROM pg_catalog.pg_namespace WHERE nspname='privacy_retention'),
 'relation',(SELECT jsonb_build_object('acl',relacl::text,'rls',relrowsecurity,'force',relforcerowsecurity,'owner',pg_catalog.pg_get_userbyid(relowner)) FROM pg_catalog.pg_class WHERE oid='privacy_retention.g014_public_rpc_allowlist'::pg_catalog.regclass),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_catalog.pg_policies p WHERE schemaname='privacy_retention' AND tablename='g014_public_rpc_allowlist'),
 'nonInternalTriggers',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,'definition',pg_catalog.pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_catalog.pg_trigger WHERE tgrelid='privacy_retention.g014_public_rpc_allowlist'::pg_catalog.regclass AND NOT tgisinternal),'[]'::jsonb),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_catalog.pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_catalog.pg_constraint WHERE conrelid='privacy_retention.g014_public_rpc_allowlist'::pg_catalog.regclass)) INTO registry_before;
  IF registry_before IS DISTINCT FROM $expected${"role":{"login":false,"super":false,"inherit":false,"createDb":false,"bypassRls":false,"createRole":false,"replication":false},"schema":{"acl":"{privacy_workflow_owner=UC/privacy_workflow_owner,privacy_retention_operator_approver=U/privacy_workflow_owner,privacy_retention_legal_approver=U/privacy_workflow_owner,privacy_retention_activation_operator=U/privacy_workflow_owner}","owner":"privacy_workflow_owner"},"policies":[{"cmd":"ALL","qual":"true","roles":["privacy_workflow_owner"],"tablename":"g014_public_rpc_allowlist","permissive":"PERMISSIVE","policyname":"g014_privacy_workflow_owner_access","schemaname":"privacy_retention","with_check":"true"}],"relation":{"acl":"{privacy_workflow_owner=arwdDxtm/privacy_workflow_owner}","rls":true,"force":true,"owner":"privacy_workflow_owner"},"constraints":[{"name":"g014_public_rpc_allowlist_grantee_check","definition":"CHECK ((grantee = ANY (ARRAY['anon'::name, 'authenticated'::name, 'service_role'::name])))"},{"name":"g014_public_rpc_allowlist_pkey","definition":"PRIMARY KEY (function_schema, function_name, identity_arguments, grantee)"},{"name":"g014_public_rpc_allowlist_source_signature_grantee_key","definition":"UNIQUE (source_signature, grantee)"}],"nonInternalTriggers":[]}$expected$::jsonb THEN
    RAISE EXCEPTION 'thumbnail_g014_registry_boundary_drift' USING ERRCODE='55000';
  END IF;
  SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((SELECT jsonb_agg(jsonb_build_array(function_schema,function_name,identity_arguments,grantee,source_signature)
 ORDER BY function_schema::text COLLATE "C",function_name::text COLLATE "C",identity_arguments COLLATE "C",grantee::text COLLATE "C",source_signature COLLATE "C")::text
 FROM privacy_retention.g014_public_rpc_allowlist WHERE NOT (source_signature=ANY(new_signatures))), 'UTF8')),'hex') INTO old_registry_digest;
  IF old_registry_digest IS DISTINCT FROM 'e18337a71017c051d5e8dd1624806010a07d756aa11b2ffb1338005421ee2c16'
    OR (SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist) <> 137
    OR EXISTS (SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature=ANY(new_signatures)) THEN
    RAISE EXCEPTION 'thumbnail_g014_registry_drift' USING ERRCODE='55000';
  END IF;
  IF (SELECT count(*) FROM (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('thumbnail_production_auth_worker','thumbnail_production_admin','thumbnail_production_worker') LIMIT 4) bounded)<>3 THEN
    RAISE EXCEPTION 'thumbnail_g014_rpc_overload_drift' USING ERRCODE='55000';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid=ANY(ARRAY(SELECT pg_catalog.to_regprocedure(signature)::oid FROM unnest(new_signatures) signature))
        AND (octet_length(p.prosrc)>65536 OR octet_length(p.proargdefaults::text)>65536)) THEN
    RAISE EXCEPTION 'thumbnail_g014_rpc_size_drift' USING ERRCODE='55000';
  END IF;
  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) INTO rpc_before FROM pg_catalog.pg_proc p
    WHERE p.oid=ANY(ARRAY(SELECT pg_catalog.to_regprocedure(signature)::oid FROM unnest(new_signatures) signature));
  FOR item IN SELECT * FROM (VALUES
      ('public.thumbnail_production_auth_worker(text)','7f653bfab4f42410d3aee41128fe9f87ff0f139b1a78509633b39f70e73227c3',ARRAY['p_token_sha256']::text[],0,''),
      ('public.thumbnail_production_admin(uuid,text,uuid,uuid,text,text,jsonb)','54cedae0c0196b81f512294745658a1467b055448565c4942947f88a56fe87db',ARRAY['p_owner_id','p_action','p_job_id','p_request_id','p_input_sha256','p_model','p_input']::text[],5,'NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::jsonb'),
      ('public.thumbnail_production_worker(text,text,uuid,uuid,bigint,text,jsonb)','911c5d0b9aff9281dbc96b3719c62a011fe8a93b643604ddb112ad0ad5ce4e6f',ARRAY['p_token_sha256','p_action','p_job_id','p_attempt_id','p_fence','p_input_sha256','p_payload']::text[],5,'NULL::uuid, NULL::uuid, NULL::bigint, NULL::text, ''{}''::jsonb')
  ) expected(signature,body_sha256,arg_names,default_count,defaults) LOOP
    target := pg_catalog.to_regprocedure(item.signature);
    IF target IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE p.oid=target AND n.nspname='public' AND p.proowner='postgres'::pg_catalog.regrole
       AND p.prokind='f' AND NOT p.prosecdef AND NOT p.proretset AND p.prorettype='jsonb'::pg_catalog.regtype
       AND p.proargnames=item.arg_names AND p.pronargs=cardinality(item.arg_names) AND p.pronargdefaults=item.default_count
       AND p.proargmodes IS NULL AND p.provariadic=0 AND p.prosupport=0 AND p.procost=100 AND p.prorows=0
       AND NOT p.proisstrict AND NOT p.proleakproof AND p.provolatile='v' AND p.proparallel='u'
       AND COALESCE(pg_catalog.pg_get_expr(p.proargdefaults,0),'')=item.defaults
       AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
       AND p.proconfig=ARRAY['search_path=""']::text[]
       AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')=item.body_sha256
       AND pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
       AND NOT pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
       AND NOT pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
         WHERE acl.grantee NOT IN(p.proowner,'service_role'::pg_catalog.regrole) OR acl.is_grantable)
    ) THEN RAISE EXCEPTION 'thumbnail_g014_rpc_drift' USING ERRCODE='55000'; END IF;
  END LOOP;
  FOR item IN SELECT * FROM (VALUES
    ('privacy_retention.assert_g014_definer_contract()','b9e2f7d812783deee6c91d27d22d6c2019be9aa04e4f1221cc7482567775354a','v_signature'),
    ('privacy_retention.assert_g014_catalog_contract()','50948ddce54dbba9497978964bebc535c27ebe98fb0f46bf05e2ec17ab0b9e01','v_expected.source_signature')
  ) expected(signature,body_sha256,variable) LOOP
    target:=pg_catalog.to_regprocedure(item.signature);
    SELECT octet_length(prosrc) INTO source_bytes FROM pg_catalog.pg_proc WHERE oid=target;
    IF source_bytes IS NULL OR source_bytes>65536 THEN
      RAISE EXCEPTION 'thumbnail_g014_assertion_size_drift' USING ERRCODE='55000';
    END IF;
    SELECT p.prosrc,pg_catalog.pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc'
      INTO source_before,definition_before,metadata_before FROM pg_catalog.pg_proc p
      WHERE p.oid=target AND p.proowner='privacy_workflow_owner'::pg_catalog.regrole
       AND p.prosecdef AND p.prokind='f' AND p.prorettype='void'::pg_catalog.regtype AND NOT p.proretset
       AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
       AND p.pronargs=0 AND p.proargnames IS NULL AND p.proargmodes IS NULL AND p.proargdefaults IS NULL
       AND p.pronargdefaults=0 AND p.provariadic=0 AND p.prosupport=0 AND p.procost=100 AND p.prorows=0
       AND NOT p.proisstrict AND NOT p.proleakproof AND p.provolatile='v' AND p.proparallel='u'
       AND p.proconfig=ARRAY['search_path=""']::text[]
       AND p.proacl::text='{privacy_workflow_owner=X/privacy_workflow_owner}';
    anchor:='    IF '||item.variable||E' IN (\n      ''public.extract_youtube_video_id(text)'',\n';
    IF source_before IS NULL OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(source_before,'UTF8')),'hex')<>item.body_sha256
      OR (length(source_before)-length(replace(source_before,anchor,'')))/length(anchor)<>1
      OR (length(definition_before)-length(replace(definition_before,source_before,'')))/length(source_before)<>1 THEN
      RAISE EXCEPTION 'thumbnail_g014_assertion_source_drift' USING ERRCODE='55000';
    END IF;
    source_after:=replace(source_before,anchor,split_part(anchor,E'\n',1)||E'\n'||addition||substring(anchor FROM strpos(anchor,E'\n')+1));
    IF replace(source_after,addition,'') IS DISTINCT FROM source_before THEN
      RAISE EXCEPTION 'thumbnail_g014_assertion_patch_drift' USING ERRCODE='55000';
    END IF;
    EXECUTE replace(definition_before,source_before,source_after);
    SELECT to_jsonb(p)-'prosrc' INTO metadata_after FROM pg_catalog.pg_proc p WHERE p.oid=target;
    IF metadata_after IS DISTINCT FROM metadata_before OR (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid=target) IS DISTINCT FROM source_after THEN
      RAISE EXCEPTION 'thumbnail_g014_assertion_readback_drift' USING ERRCODE='55000';
    END IF;
  END LOOP;
  INSERT INTO privacy_retention.g014_public_rpc_allowlist(function_schema,function_name,identity_arguments,grantee,source_signature)
    SELECT n.nspname,p.proname,p.proargtypes::text,'service_role',signature
    FROM unnest(new_signatures) signature JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(signature)
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace;
  IF (SELECT count(*) FROM (SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist LIMIT 141) bounded)<>140 THEN
    RAISE EXCEPTION 'thumbnail_g014_registry_readback_drift' USING ERRCODE='55000';
  END IF;
  SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((SELECT jsonb_agg(jsonb_build_array(function_schema,function_name,identity_arguments,grantee,source_signature)
 ORDER BY function_schema::text COLLATE "C",function_name::text COLLATE "C",identity_arguments COLLATE "C",grantee::text COLLATE "C",source_signature COLLATE "C")::text
 FROM privacy_retention.g014_public_rpc_allowlist WHERE NOT (source_signature=ANY(new_signatures))), 'UTF8')),'hex') INTO old_registry_digest;
  SELECT jsonb_build_object(
 'role',(SELECT jsonb_build_object('login',rolcanlogin,'super',rolsuper,'inherit',rolinherit,'createDb',rolcreatedb,'bypassRls',rolbypassrls,'createRole',rolcreaterole,'replication',rolreplication) FROM pg_catalog.pg_roles WHERE rolname='privacy_workflow_owner'),
 'schema',(SELECT jsonb_build_object('acl',nspacl::text,'owner',pg_catalog.pg_get_userbyid(nspowner)) FROM pg_catalog.pg_namespace WHERE nspname='privacy_retention'),
 'relation',(SELECT jsonb_build_object('acl',relacl::text,'rls',relrowsecurity,'force',relforcerowsecurity,'owner',pg_catalog.pg_get_userbyid(relowner)) FROM pg_catalog.pg_class WHERE oid='privacy_retention.g014_public_rpc_allowlist'::pg_catalog.regclass),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_catalog.pg_policies p WHERE schemaname='privacy_retention' AND tablename='g014_public_rpc_allowlist'),
 'nonInternalTriggers',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,'definition',pg_catalog.pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_catalog.pg_trigger WHERE tgrelid='privacy_retention.g014_public_rpc_allowlist'::pg_catalog.regclass AND NOT tgisinternal),'[]'::jsonb),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_catalog.pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_catalog.pg_constraint WHERE conrelid='privacy_retention.g014_public_rpc_allowlist'::pg_catalog.regclass)) INTO registry_after;
  IF old_registry_digest IS DISTINCT FROM 'e18337a71017c051d5e8dd1624806010a07d756aa11b2ffb1338005421ee2c16' OR registry_after IS DISTINCT FROM registry_before
    OR (SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist)<>140
    OR (SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist r JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(r.source_signature)
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE r.source_signature=ANY(new_signatures) AND r.function_schema=n.nspname AND r.function_name=p.proname
       AND r.identity_arguments=p.proargtypes::text AND r.grantee='service_role')<>3 THEN
    RAISE EXCEPTION 'thumbnail_g014_registry_readback_drift' USING ERRCODE='55000';
  END IF;
  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) INTO rpc_after FROM pg_catalog.pg_proc p
    WHERE p.oid=ANY(ARRAY(SELECT pg_catalog.to_regprocedure(signature)::oid FROM unnest(new_signatures) signature));
  IF rpc_after IS DISTINCT FROM rpc_before THEN
    RAISE EXCEPTION 'thumbnail_g014_rpc_readback_drift' USING ERRCODE='55000';
  END IF;
  EXECUTE 'SET LOCAL ROLE postgres';
END;
$thumbnail_g014_registration$;

-- END PINNED REGISTRATION

REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;

DO $thumbnail_install_bucket$
DECLARE policies jsonb; policy_digest text; metadata_before jsonb; metadata_after jsonb;
        browser_before jsonb; browser_after jsonb; previous_path text;
BEGIN
  IF current_user<>'postgres' OR session_user<>'postgres'
     OR pg_catalog.current_setting('thumbnail_install.xact',true) IS DISTINCT FROM pg_catalog.pg_current_xact_id_if_assigned()::text
     OR pg_catalog.current_setting('thumbnail_install.xact',true) IS NULL THEN
    RAISE EXCEPTION 'thumbnail_install_transaction_drift' USING ERRCODE='25000';
  END IF;
  -- INSERT/SELECT alone do not authorize these lock modes on managed tables.
  -- Use only existing privileges; never change a managed owner or grant here.
  IF NOT pg_catalog.has_table_privilege(current_user,'storage.buckets','MAINTAIN,UPDATE,DELETE,TRUNCATE')
     OR NOT pg_catalog.has_table_privilege(current_user,'storage.objects','MAINTAIN,UPDATE,DELETE,TRUNCATE') THEN
    RAISE EXCEPTION 'thumbnail_install_storage_lock_denied' USING ERRCODE='42501';
  END IF;
  IF (SELECT count(*)=2 AND bool_and(NOT rolsuper AND NOT rolbypassrls
        AND NOT pg_catalog.pg_has_role(oid,'supabase_storage_admin'::regrole,'USAGE')
        AND NOT pg_catalog.pg_has_role(oid,'supabase_storage_admin'::regrole,'SET'))
      FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated')) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'thumbnail_install_storage_browser_boundary_denied' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_agg(jsonb_build_array(rolname,rolsuper,rolbypassrls,
      pg_catalog.pg_has_role(oid,'supabase_storage_admin'::regrole,'USAGE'),
      pg_catalog.pg_has_role(oid,'supabase_storage_admin'::regrole,'SET')) ORDER BY rolname COLLATE "C")
    INTO browser_before FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated','service_role');
  LOCK TABLE storage.buckets IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE storage.objects IN SHARE MODE;
  IF (SELECT count(*) FROM pg_catalog.pg_class WHERE oid IN ('storage.buckets'::regclass,'storage.objects'::regclass)
       AND relkind='r' AND relowner='supabase_storage_admin'::regrole AND relrowsecurity AND NOT relforcerowsecurity)<>2
     OR NOT pg_catalog.has_schema_privilege('service_role','storage','USAGE')
     OR NOT pg_catalog.has_table_privilege('service_role','storage.objects','SELECT')
     OR NOT pg_catalog.has_table_privilege('service_role','storage.objects','INSERT')
     OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='service_role' AND rolbypassrls)
     OR (SELECT count(*) FROM (SELECT 1 FROM pg_catalog.pg_policy
       WHERE polrelid IN ('storage.buckets'::regclass,'storage.objects'::regclass) LIMIT 11) bounded)<>10
     OR EXISTS(SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid IN ('storage.buckets'::regclass,'storage.objects'::regclass)
       AND (pg_catalog.octet_length(polqual::text)>65536 OR pg_catalog.octet_length(polwithcheck::text)>65536 OR cardinality(polroles)>8)) THEN
    RAISE EXCEPTION 'thumbnail_install_storage_boundary_drift' USING ERRCODE='55000';
  END IF;
  -- pg_get_expr qualifies visible functions according to search_path. Fix the
  -- deparser context for both projections and restore the caller's local path.
  previous_path:=pg_catalog.current_setting('search_path');
  PERFORM pg_catalog.set_config('search_path','pg_catalog, public',true);
  SELECT COALESCE(jsonb_agg(jsonb_build_array(c.relname::text,p.polname::text,p.polcmd::text,p.polpermissive,
      ARRAY(SELECT CASE WHEN role_oid=0 THEN 'PUBLIC'::text ELSE pg_catalog.pg_get_userbyid(role_oid)::text END
        FROM unnest(p.polroles) role_oid ORDER BY role_oid),pg_catalog.pg_get_expr(p.polqual,p.polrelid),pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid))
      ORDER BY c.relname::text COLLATE "C",p.polname::text COLLATE "C"),'[]'::jsonb)
    INTO policies FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
    WHERE p.polrelid IN ('storage.buckets'::regclass,'storage.objects'::regclass);
  policy_digest:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(policies::text,'UTF8')),'hex');
  SELECT jsonb_agg(jsonb_build_array(oid,relowner,relacl,relrowsecurity,relforcerowsecurity) ORDER BY oid)
    INTO metadata_before FROM pg_catalog.pg_class WHERE oid IN ('storage.buckets'::regclass,'storage.objects'::regclass);
  -- The exact ten existing permissive predicates all require one of three other
  -- bucket IDs. No policy addresses buckets, and none admits this private ID.
  -- Pin their actual expression/role projection instead of altering managed RLS.
  IF policy_digest<>'0ac3c20e004f01a0c5a735093a4484f7ee251ae72b41095f4a2979f87b1055a4'
     OR EXISTS(SELECT 1 FROM storage.buckets WHERE id='youtube-thumbnail-jobs' OR name='youtube-thumbnail-jobs')
     OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='youtube-thumbnail-jobs') THEN
    RAISE EXCEPTION 'thumbnail_install_bucket_prior_conflict' USING ERRCODE='55000';
  END IF;
  INSERT INTO storage.buckets(id,name,owner,public,avif_autodetection,file_size_limit,allowed_mime_types,owner_id,type,versioning_status,lifecycle_configuration,lifecycle_configuration_generation)
    VALUES('youtube-thumbnail-jobs','youtube-thumbnail-jobs',NULL,false,false,12582912,
      ARRAY['image/png','image/jpeg','image/webp','application/json']::text[],NULL,'STANDARD'::storage.buckettype,'DISABLED',NULL,NULL);
  IF (SELECT count(*) FROM storage.buckets WHERE id='youtube-thumbnail-jobs' AND name='youtube-thumbnail-jobs'
        AND owner IS NULL AND owner_id IS NULL AND public IS FALSE AND avif_autodetection IS FALSE
        AND file_size_limit=12582912 AND allowed_mime_types=ARRAY['image/png','image/jpeg','image/webp','application/json']::text[]
        AND type='STANDARD'::storage.buckettype AND versioning_status='DISABLED'
        AND lifecycle_configuration IS NULL AND lifecycle_configuration_generation IS NULL)<>1 THEN
    RAISE EXCEPTION 'thumbnail_install_bucket_readback_drift' USING ERRCODE='55000';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_array(c.relname::text,p.polname::text,p.polcmd::text,p.polpermissive,
      ARRAY(SELECT CASE WHEN role_oid=0 THEN 'PUBLIC'::text ELSE pg_catalog.pg_get_userbyid(role_oid)::text END
        FROM unnest(p.polroles) role_oid ORDER BY role_oid),pg_catalog.pg_get_expr(p.polqual,p.polrelid),pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid))
      ORDER BY c.relname::text COLLATE "C",p.polname::text COLLATE "C"),'[]'::jsonb)
    INTO policies FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
    WHERE p.polrelid IN ('storage.buckets'::regclass,'storage.objects'::regclass);
  SELECT jsonb_agg(jsonb_build_array(oid,relowner,relacl,relrowsecurity,relforcerowsecurity) ORDER BY oid)
    INTO metadata_after FROM pg_catalog.pg_class WHERE oid IN ('storage.buckets'::regclass,'storage.objects'::regclass);
  SELECT jsonb_agg(jsonb_build_array(rolname,rolsuper,rolbypassrls,
      pg_catalog.pg_has_role(oid,'supabase_storage_admin'::regrole,'USAGE'),
      pg_catalog.pg_has_role(oid,'supabase_storage_admin'::regrole,'SET')) ORDER BY rolname COLLATE "C")
    INTO browser_after FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated','service_role');
  IF metadata_after IS DISTINCT FROM metadata_before
     OR browser_after IS DISTINCT FROM browser_before
     OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(policies::text,'UTF8')),'hex') IS DISTINCT FROM policy_digest THEN
    RAISE EXCEPTION 'thumbnail_install_storage_readback_drift' USING ERRCODE='55000';
  END IF;
  PERFORM pg_catalog.set_config('search_path',previous_path,true);
END $thumbnail_install_bucket$;

DO $thumbnail_install_post$
DECLARE current_members jsonb; current_assertions jsonb; previous record;
BEGIN
  IF current_user<>'postgres' OR session_user<>'postgres'
     OR pg_catalog.current_setting('thumbnail_install.xact',true) IS DISTINCT FROM pg_catalog.pg_current_xact_id_if_assigned()::text
     OR pg_catalog.current_setting('thumbnail_install.xact',true) IS NULL THEN
    RAISE EXCEPTION 'thumbnail_install_transaction_drift' USING ERRCODE='25000';
  END IF;
  SELECT * INTO STRICT previous FROM pg_temp.thumbnail_install_before;
  SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) INTO current_members FROM pg_catalog.pg_auth_members m;
  SELECT jsonb_agg(to_jsonb(p)-'prosrc' ORDER BY p.oid) INTO current_assertions FROM pg_catalog.pg_proc p
    WHERE p.oid=ANY(ARRAY['privacy_retention.assert_g014_workflow_owner_contract()'::regprocedure,
      'privacy_retention.assert_g014_public_rpc_allowlist()'::regprocedure,
      'privacy_retention.assert_g014_definer_contract()'::regprocedure,
      'privacy_retention.assert_g014_catalog_contract()'::regprocedure]::oid[]);
  IF current_members IS DISTINCT FROM previous.memberships OR current_assertions IS DISTINCT FROM previous.assertions
     OR pg_catalog.pg_has_role('postgres','privacy_workflow_owner','SET') OR pg_catalog.pg_has_role('postgres','privacy_workflow_owner','USAGE') THEN
    RAISE EXCEPTION 'thumbnail_install_post_restore_drift' USING ERRCODE='55000';
  END IF;
  -- The bridge invokes all four original assertions with the SET lease absent.
  PERFORM pg_temp.thumbnail_install_g014_check('post');
  IF pg_catalog.to_regprocedure('pg_temp.thumbnail_install_g014_check(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'thumbnail_install_bridge_remaining' USING ERRCODE='55000';
  END IF;
  DROP TABLE pg_temp.thumbnail_install_before;
END $thumbnail_install_post$;
