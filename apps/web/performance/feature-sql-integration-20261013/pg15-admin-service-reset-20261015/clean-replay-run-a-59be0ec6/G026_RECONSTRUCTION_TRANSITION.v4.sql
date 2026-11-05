-- G026 source-only empty-clean-replay synthesis; never historical or hosted-state evidence.
-- Extension bootstrap runs before ordinal 2. Any failure rolls back its entire normalized fingerprint.
BEGIN;
CREATE SCHEMA IF NOT EXISTS extensions AUTHORIZATION postgres;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
DO $$ BEGIN
 IF (SELECT nspname FROM pg_namespace WHERE oid=(SELECT extnamespace FROM pg_extension WHERE extname='vector')) IS DISTINCT FROM 'extensions' THEN RAISE EXCEPTION 'G026 extension capability checkpoint failed: vector namespace' USING ERRCODE='P0001'; END IF;
 IF (SELECT nspname FROM pg_namespace WHERE oid=(SELECT extnamespace FROM pg_extension WHERE extname='fuzzystrmatch')) IS DISTINCT FROM 'extensions' THEN RAISE EXCEPTION 'G026 extension capability checkpoint failed: fuzzystrmatch namespace' USING ERRCODE='P0001'; END IF;
 IF (SELECT nspname FROM pg_namespace WHERE oid=(SELECT extnamespace FROM pg_extension WHERE extname='pgcrypto')) IS DISTINCT FROM 'extensions' THEN RAISE EXCEPTION 'G026 extension capability checkpoint failed: pgcrypto namespace' USING ERRCODE='P0001'; END IF;
 IF to_regtype('extensions.vector') IS NULL THEN RAISE EXCEPTION 'G026 extension capability checkpoint failed: vector type' USING ERRCODE='P0001'; END IF;
 IF to_regoperator('extensions.<=>(extensions.vector,extensions.vector)') IS NULL THEN RAISE EXCEPTION 'G026 extension capability checkpoint failed: cosine operator' USING ERRCODE='P0001'; END IF;
 IF to_regprocedure('extensions.levenshtein(text,text)') IS NULL THEN RAISE EXCEPTION 'G026 extension capability checkpoint failed: levenshtein(text,text)' USING ERRCODE='P0001'; END IF;
 IF to_regprocedure('extensions.digest(text,text)') IS NULL THEN RAISE EXCEPTION 'G026 extension capability checkpoint failed: digest(text,text)' USING ERRCODE='P0001'; END IF;
END $$;
SAVEPOINT g026_hnsw_probe;
CREATE TABLE public.g026_hnsw_probe_vectors (embedding extensions.vector(3) NOT NULL);
CREATE INDEX g026_hnsw_probe_vectors_embedding_hnsw_idx ON public.g026_hnsw_probe_vectors USING hnsw (embedding extensions.vector_cosine_ops);
ROLLBACK TO SAVEPOINT g026_hnsw_probe;
RELEASE SAVEPOINT g026_hnsw_probe;
DO $$ BEGIN IF to_regclass('public.g026_hnsw_probe_vectors') IS NOT NULL OR to_regclass('public.g026_hnsw_probe_vectors_embedding_hnsw_idx') IS NOT NULL THEN RAISE EXCEPTION 'G026 HNSW probe residue exists' USING ERRCODE='P0001'; END IF; END $$;
COMMIT;

-- Phase A runs exactly after ordinal 2 and before ordinal 3.
BEGIN;
LOCK TABLE public.profiles, public.reviews, public.restaurants, public.restaurant_submissions, public.restaurant_submission_items IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.profiles) <> 0 OR (SELECT count(*) FROM public.reviews) <> 0 OR (SELECT count(*) FROM public.restaurants) <> 0 OR (SELECT count(*) FROM public.restaurant_submissions) <> 0 OR (SELECT count(*) FROM public.restaurant_submission_items) <> 0 THEN RAISE EXCEPTION 'G026 requires an empty clean replay' USING ERRCODE='P0001'; END IF;
 IF to_regclass('public.restaurants_backup') IS NOT NULL OR to_regclass('public.document_embeddings') IS NOT NULL OR to_regclass('public.document_embeddings_id_seq') IS NOT NULL OR to_regclass('public.ad_banners') IS NOT NULL OR to_regclass('public.short_urls') IS NOT NULL OR to_regclass('public.restaurants_duplicate') IS NOT NULL THEN RAISE EXCEPTION 'G026 phase A relations already exist' USING ERRCODE='P0001'; END IF;
END $$;
-- G026 source-only Phase A legacy-shape normalization; not historical or hosted-state evidence.
-- Legacy shape is bound to RECONSTRUCTION_SOURCES.v1.json sha256=1f87d2bb4d64b9c4771bacad881a8c6effdca072ba0b22732a8373123a6f836e ordinal-0 source sha256=23de25dcbe84612ca032b680608d671ffdfa0a72eac44b823e8d001b59919f33.
-- Required target columns are bound to APPLICATION_PREREQUISITES.v1.json sha256=055d31e0d7597ec026e570eaf85adfb2c4a6c5480f80a3ed7a7ca525a6b2a9f3 output sha256=34e7904a4dfb271d811d433102e92c94aceff6528c751bf5b02f94c2a56f3d15.
DO $g026_legacy_shape$
DECLARE
  v_profile_shape text[];
  v_review_shape text[];
BEGIN
  IF to_regclass('public.profiles') IS NULL OR to_regclass('public.reviews') IS NULL THEN
    RAISE EXCEPTION 'G026 legacy-shape normalization requires profiles and reviews' USING ERRCODE='P0001';
  END IF;
  IF (SELECT relation.relkind FROM pg_catalog.pg_class AS relation WHERE relation.oid = 'public.profiles'::regclass) IS DISTINCT FROM 'r'
     OR (SELECT relation.relkind FROM pg_catalog.pg_class AS relation WHERE relation.oid = 'public.reviews'::regclass) IS DISTINCT FROM 'r' THEN
    RAISE EXCEPTION 'G026 legacy-shape normalization requires ordinary tables' USING ERRCODE='P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles) OR EXISTS (SELECT 1 FROM public.reviews) THEN
    RAISE EXCEPTION 'G026 legacy-shape normalization requires empty profiles and reviews' USING ERRCODE='P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.profiles'::regclass AND attname = 'profile_picture' AND attnum > 0 AND NOT attisdropped
  ) AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.profiles'::regclass AND attname = 'avatar_url' AND attnum > 0 AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'G026 profiles legacy and target avatar columns both exist' USING ERRCODE='P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.profiles'::regclass AND attname = 'avatar_url' AND attnum > 0 AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.profiles'::regclass AND attname = 'profile_picture'
      AND atttypid = 'pg_catalog.text'::regtype AND NOT attnotnull AND attnum > 0 AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'G026 profiles legacy avatar column shape drifted' USING ERRCODE='P0001';
  END IF;
  SELECT pg_catalog.array_agg(
           pg_catalog.format('%s|%s|%s|%s', attribute.attname, pg_catalog.format_type(attribute.atttypid, attribute.atttypmod), attribute.attnotnull, attribute.atthasdef)
           ORDER BY attribute.attnum
         )
  INTO v_profile_shape
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = 'public.profiles'::regclass
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;
  IF v_profile_shape IS DISTINCT FROM ARRAY[
    'id|uuid|t|t',
    'user_id|uuid|t|f',
    'nickname|text|t|f',
    'email|text|t|f',
    'profile_picture|text|f|f',
    'created_at|timestamp with time zone|t|t',
    'last_login|timestamp with time zone|t|t'
  ]::text[] THEN
    RAISE EXCEPTION 'G026 profiles exact legacy base shape drifted' USING ERRCODE='P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.reviews'::regclass AND attname = 'like_count' AND attnum > 0 AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'G026 reviews target like_count already exists' USING ERRCODE='P0001';
  END IF;
  SELECT pg_catalog.array_agg(
           pg_catalog.format('%s|%s|%s|%s', attribute.attname, pg_catalog.format_type(attribute.atttypid, attribute.atttypmod), attribute.attnotnull, attribute.atthasdef)
           ORDER BY attribute.attnum
         )
  INTO v_review_shape
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = 'public.reviews'::regclass
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;
  IF v_review_shape IS DISTINCT FROM ARRAY[
    'id|uuid|t|t',
    'user_id|uuid|t|f',
    'restaurant_id|uuid|t|f',
    'title|text|t|f',
    'content|text|t|f',
    'visited_at|timestamp with time zone|t|f',
    'verification_photo|text|t|f',
    'food_photos|text[]|f|t',
    'categories|text[]|f|t',
    'is_verified|boolean|t|t',
    'admin_note|text|f|f',
    'is_pinned|boolean|t|t',
    'is_edited_by_admin|boolean|t|t',
    'edited_by_admin_id|uuid|f|f',
    'edited_at|timestamp with time zone|f|f',
    'created_at|timestamp with time zone|t|t',
    'updated_at|timestamp with time zone|t|t'
  ]::text[] THEN
    RAISE EXCEPTION 'G026 reviews exact legacy base shape drifted' USING ERRCODE='P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.reviews'::regclass AND conname = 'reviews_like_count_check'
  ) THEN
    RAISE EXCEPTION 'G026 reviews like_count constraint already exists' USING ERRCODE='P0001';
  END IF;

  ALTER TABLE public.profiles RENAME COLUMN profile_picture TO avatar_url;
  ALTER TABLE public.reviews ADD COLUMN like_count integer NOT NULL DEFAULT 0;
  ALTER TABLE public.reviews ADD CONSTRAINT reviews_like_count_check CHECK (like_count >= 0);

  SELECT pg_catalog.array_agg(
           pg_catalog.format('%s|%s|%s|%s', attribute.attname, pg_catalog.format_type(attribute.atttypid, attribute.atttypmod), attribute.attnotnull, attribute.atthasdef)
           ORDER BY attribute.attnum
         )
  INTO v_profile_shape
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = 'public.profiles'::regclass
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;
  SELECT pg_catalog.array_agg(
           pg_catalog.format('%s|%s|%s|%s', attribute.attname, pg_catalog.format_type(attribute.atttypid, attribute.atttypmod), attribute.attnotnull, attribute.atthasdef)
           ORDER BY attribute.attnum
         )
  INTO v_review_shape
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = 'public.reviews'::regclass
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;
  IF EXISTS (
       SELECT 1 FROM pg_catalog.pg_attribute
       WHERE attrelid = 'public.profiles'::regclass AND attname = 'profile_picture' AND attnum > 0 AND NOT attisdropped
     ) OR v_profile_shape IS DISTINCT FROM ARRAY[
       'id|uuid|t|t',
       'user_id|uuid|t|f',
       'nickname|text|t|f',
       'email|text|t|f',
       'avatar_url|text|f|f',
       'created_at|timestamp with time zone|t|t',
       'last_login|timestamp with time zone|t|t'
     ]::text[] THEN
    RAISE EXCEPTION 'G026 profiles normalized shape postcondition failed' USING ERRCODE='P0001';
  END IF;
  IF v_review_shape IS DISTINCT FROM ARRAY[
       'id|uuid|t|t',
       'user_id|uuid|t|f',
       'restaurant_id|uuid|t|f',
       'title|text|t|f',
       'content|text|t|f',
       'visited_at|timestamp with time zone|t|f',
       'verification_photo|text|t|f',
       'food_photos|text[]|f|t',
       'categories|text[]|f|t',
       'is_verified|boolean|t|t',
       'admin_note|text|f|f',
       'is_pinned|boolean|t|t',
       'is_edited_by_admin|boolean|t|t',
       'edited_by_admin_id|uuid|f|f',
       'edited_at|timestamp with time zone|f|f',
       'created_at|timestamp with time zone|t|t',
       'updated_at|timestamp with time zone|t|t',
       'like_count|integer|t|t'
     ]::text[] THEN
    RAISE EXCEPTION 'G026 reviews normalized shape postcondition failed' USING ERRCODE='P0001';
  END IF;
  IF (SELECT pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid)
      FROM pg_catalog.pg_attribute AS attribute
      JOIN pg_catalog.pg_attrdef AS default_row
        ON default_row.adrelid = attribute.attrelid AND default_row.adnum = attribute.attnum
      WHERE attribute.attrelid = 'public.reviews'::regclass
        AND attribute.attname = 'like_count'
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped) IS DISTINCT FROM '0' THEN
    RAISE EXCEPTION 'G026 reviews like_count default postcondition failed' USING ERRCODE='P0001';
  END IF;
  IF (SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_constraint AS constraint_row
      WHERE constraint_row.conrelid = 'public.reviews'::regclass
        AND constraint_row.conname = 'reviews_like_count_check'
        AND constraint_row.contype = 'c'
        AND constraint_row.convalidated
        AND pg_catalog.pg_get_constraintdef(constraint_row.oid, true) = 'CHECK (like_count >= 0)') <> 1 THEN
    RAISE EXCEPTION 'G026 reviews like_count constraint postcondition failed' USING ERRCODE='P0001';
  END IF;
END
$g026_legacy_shape$;
-- G026 non-historical synthesized Phase A base relation: source-derived solely from backend/supabase/migrations/20260713000100_g013_short_url_security.sql.
-- G013 lines 7-35 validate code/target_url, lines 38-43 own NOT NULL, uniqueness, and format constraints, and lines 283-294 allocate code, target_url, restaurant_id, and restaurant_name.
CREATE TABLE public.short_urls (
 id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
 code text NOT NULL,
 target_url text NOT NULL,
 restaurant_id uuid,
 restaurant_name text,
 created_at timestamptz DEFAULT now()
);
DO $$ BEGIN
 IF to_regclass('public.short_urls') IS NULL THEN RAISE EXCEPTION 'G026 short_urls synthesized base relation checkpoint failed: relation is absent' USING ERRCODE='P0001'; END IF;
END $$;
DO $$ BEGIN
 IF to_regclass('public.transcript_embeddings_bge') IS NOT NULL OR to_regclass('public.video_frame_captions') IS NOT NULL OR to_regclass('public.videos') IS NOT NULL THEN RAISE EXCEPTION 'G026 phase A storyboard relations already exist' USING ERRCODE='P0001'; END IF;
END $$;
-- G026 non-historical synthesized Phase A base relations: source-derived solely from backend/storyboard-agent/src/prompts/intern.py lines 12-62, backend/storyboard-agent/scripts/01-bge-embed-and-store-supabase.py, backend/storyboard-agent/scripts/02-video-caption-store-supabase.py, and apps/web/supabase/migrations/20260612075100_storyboard_caption_provenance.sql.
-- Actions run 29364092725 failed: relation public.transcript_embeddings_bge does not exist. The strict 20260531 grants immediately also require video_frame_captions and videos; 20260612 owns caption provenance fields and is intentionally not synthesized here.
CREATE TABLE public.transcript_embeddings_bge (
 id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
 video_id text NOT NULL,
 chunk_index integer NOT NULL,
 recollect_id integer NOT NULL DEFAULT 0,
 page_content text NOT NULL,
 embedding extensions.vector(1024),
 metadata jsonb DEFAULT '{}'::jsonb,
 sparse_embedding jsonb,
 created_at timestamptz DEFAULT now(),
 updated_at timestamptz DEFAULT now(),
 UNIQUE(video_id,chunk_index,recollect_id)
);
CREATE TABLE public.video_frame_captions (
 id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
 video_id text NOT NULL,
 recollect_id integer NOT NULL,
 start_sec integer NOT NULL,
 end_sec integer NOT NULL,
 rank integer,
 raw_caption text,
 chronological_analysis text,
 highlight_keywords text[],
 duration integer,
 UNIQUE(video_id,recollect_id,start_sec)
);
CREATE TABLE public.videos (
 id text PRIMARY KEY,
 title text,
 description text,
 published_at timestamptz,
 duration integer,
 view_count bigint,
 like_count integer,
 comment_count integer,
 channel_name text NOT NULL,
 is_shorts boolean,
 is_ads boolean,
 tags text[],
 thumbnail_url text,
 latest_recollect_id integer DEFAULT 0
);
DO $$ BEGIN
 IF to_regclass('public.transcript_embeddings_bge') IS NULL OR to_regclass('public.video_frame_captions') IS NULL OR to_regclass('public.videos') IS NULL THEN RAISE EXCEPTION 'G026 storyboard synthesized base relation checkpoint failed: relation is absent' USING ERRCODE='P0001'; END IF;
END $$;
DO $$ BEGIN
 IF to_regtype('public.admin_workflow_trigger_source') IS NOT NULL OR to_regtype('public.admin_workflow_correlation_state') IS NOT NULL OR to_regtype('public.admin_workflow_step_status') IS NOT NULL THEN RAISE EXCEPTION 'G026 Phase A admin workflow types already exist' USING ERRCODE='P0001'; END IF;
 IF to_regclass('public.admin_workflow_runs') IS NOT NULL OR to_regclass('public.admin_workflow_steps') IS NOT NULL OR to_regclass('public.admin_workflow_signals') IS NOT NULL OR to_regclass('public.idx_admin_workflow_runs_requested_at') IS NOT NULL OR to_regclass('public.idx_admin_workflow_runs_state') IS NOT NULL OR to_regclass('public.idx_admin_workflow_runs_channel') IS NOT NULL OR to_regclass('public.idx_admin_workflow_steps_run') IS NOT NULL OR to_regclass('public.idx_admin_workflow_steps_status') IS NOT NULL OR to_regclass('public.idx_admin_workflow_signals_run') IS NOT NULL OR to_regprocedure('public.touch_admin_workflow_updated_at()') IS NOT NULL THEN RAISE EXCEPTION 'G026 Phase A admin workflow objects already exist' USING ERRCODE='P0001'; END IF;
END $$;
-- G026 source-only Phase A prerequisite: source-derived solely from backend/supabase/baselines/historical/20260310_admin_workflow_pipeline.sql sha256=83acbf7f9ad5abf66de2aae7350db1a23a1f53d940336629252cdcb9d4f47a6e.
-- The source's conditional-create and replacement clauses are deliberately not replayed: the preceding source-bound absence gate fails closed rather than self-baselining an unknown object.
CREATE TYPE public.admin_workflow_trigger_source AS ENUM ('schedule', 'manual_admin');
CREATE TYPE public.admin_workflow_correlation_state AS ENUM (
  'pending_dispatch',
  'dispatched_unmatched',
  'matched',
  'reconciled_timeout',
  'reconciled_error',
  'completed'
);
CREATE TYPE public.admin_workflow_step_status AS ENUM (
  'queued',
  'running',
  'success',
  'failed',
  'timeout',
  'partial',
  'skipped'
);
CREATE TABLE public.admin_workflow_runs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_request_id text UNIQUE NOT NULL,
  correlation_key text,
  trigger_source public.admin_workflow_trigger_source NOT NULL,
  requested_by_user_id uuid NULL,
  channel_url_raw text,
  channel_url_normalized text,
  channel_slug text,
  channel_id text,
  workflow_file text NOT NULL DEFAULT 'daily-crawler.yml',
  workflow_ref text NOT NULL DEFAULT 'data',
  github_workflow_id bigint,
  github_run_id bigint,
  github_run_number integer,
  github_run_attempt integer,
  github_status text,
  github_conclusion text,
  correlation_state public.admin_workflow_correlation_state NOT NULL DEFAULT 'pending_dispatch',
  requested_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  matched_at timestamptz,
  completed_at timestamptz,
  dedupe_of_run_id uuid REFERENCES public.admin_workflow_runs(run_id),
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.admin_workflow_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.admin_workflow_runs(run_id) ON DELETE CASCADE,
  canonical_step_no integer NOT NULL CHECK (canonical_step_no BETWEEN 1 AND 12),
  canonical_step_key text NOT NULL,
  script_step_label text,
  status public.admin_workflow_step_status NOT NULL DEFAULT 'queued',
  started_at timestamptz,
  ended_at timestamptz,
  duration_ms bigint,
  message text,
  row_delta jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id, canonical_step_no)
);
CREATE TABLE public.admin_workflow_signals (
  id bigint generated always as identity PRIMARY KEY,
  run_id uuid REFERENCES public.admin_workflow_runs(run_id) ON DELETE CASCADE,
  signal_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_admin_workflow_runs_requested_at ON public.admin_workflow_runs(requested_at DESC);
CREATE INDEX idx_admin_workflow_runs_state ON public.admin_workflow_runs(correlation_state, github_status);
CREATE INDEX idx_admin_workflow_runs_channel ON public.admin_workflow_runs(channel_slug, requested_at DESC);
CREATE INDEX idx_admin_workflow_steps_run ON public.admin_workflow_steps(run_id, canonical_step_no);
CREATE INDEX idx_admin_workflow_steps_status ON public.admin_workflow_steps(status, run_id);
CREATE INDEX idx_admin_workflow_signals_run ON public.admin_workflow_signals(run_id, created_at DESC);
CREATE FUNCTION public.touch_admin_workflow_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER admin_workflow_runs_updated_at_trigger
  BEFORE UPDATE ON public.admin_workflow_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_admin_workflow_updated_at();
CREATE TRIGGER admin_workflow_steps_updated_at_trigger
  BEFORE UPDATE ON public.admin_workflow_steps
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_admin_workflow_updated_at();
ALTER TABLE public.admin_workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_workflow_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_workflow_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_workflow_runs_select_admin
  ON public.admin_workflow_runs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = (SELECT auth.uid()) AND ur.role = 'admin'
    )
  );
CREATE POLICY admin_workflow_steps_select_admin
  ON public.admin_workflow_steps
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = (SELECT auth.uid()) AND ur.role = 'admin'
    )
  );
CREATE POLICY admin_workflow_signals_select_admin
  ON public.admin_workflow_signals
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = (SELECT auth.uid()) AND ur.role = 'admin'
    )
  );
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication AS publication
    WHERE publication.pubname = 'supabase_realtime'
  ) THEN
    RAISE EXCEPTION 'G026 realtime publication checkpoint failed: supabase_realtime is absent' USING ERRCODE='P0001';
  END IF;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_workflow_runs;
  EXCEPTION
    WHEN duplicate_object THEN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_publication_rel AS publication_relation
        JOIN pg_catalog.pg_publication AS publication ON publication.oid = publication_relation.prpubid
        WHERE publication.pubname = 'supabase_realtime'
          AND publication_relation.prrelid = 'public.admin_workflow_runs'::regclass
      ) THEN
        RAISE EXCEPTION 'G026 realtime publication membership checkpoint failed: duplicate admin_workflow_runs membership was not proven' USING ERRCODE='P0001';
      END IF;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_workflow_steps;
  EXCEPTION
    WHEN duplicate_object THEN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_publication_rel AS publication_relation
        JOIN pg_catalog.pg_publication AS publication ON publication.oid = publication_relation.prpubid
        WHERE publication.pubname = 'supabase_realtime'
          AND publication_relation.prrelid = 'public.admin_workflow_steps'::regclass
      ) THEN
        RAISE EXCEPTION 'G026 realtime publication membership checkpoint failed: duplicate admin_workflow_steps membership was not proven' USING ERRCODE='P0001';
      END IF;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication_rel AS publication_relation
    JOIN pg_catalog.pg_publication AS publication ON publication.oid = publication_relation.prpubid
    WHERE publication.pubname = 'supabase_realtime'
      AND publication_relation.prrelid = 'public.admin_workflow_runs'::regclass
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication_rel AS publication_relation
    JOIN pg_catalog.pg_publication AS publication ON publication.oid = publication_relation.prpubid
    WHERE publication.pubname = 'supabase_realtime'
      AND publication_relation.prrelid = 'public.admin_workflow_steps'::regclass
  ) THEN
    RAISE EXCEPTION 'G026 realtime publication postcondition failed: required memberships are absent' USING ERRCODE='P0001';
  END IF;
END $$;
DO $$ BEGIN
 IF to_regclass('public.admin_workflow_runs') IS NULL OR to_regclass('public.admin_workflow_steps') IS NULL OR to_regclass('public.admin_workflow_signals') IS NULL THEN RAISE EXCEPTION 'G026 admin workflow synthesized prerequisite checkpoint failed: relation is absent' USING ERRCODE='P0001'; END IF;
END $$;
DO $$ BEGIN
 IF to_regclass('public.search_logs') IS NOT NULL THEN RAISE EXCEPTION 'G026 Phase A search_logs relation already exists' USING ERRCODE='P0001'; END IF;
END $$;
-- G026 non-historical compatibility shell: derived solely from the current first-party apps/web/lib/search-count.ts disabled analytics contract.
-- Analytics remains disabled until an approved aggregate-only endpoint and retention contract exist. This shell has no query, user, location, or other payload columns.
-- The strict backend/supabase/migrations/20260531084516_tighten_public_table_data_api_grants.sql lines 69-72 grants are object-level only; FORCE RLS with no policies denies every runtime read and insert.
CREATE TABLE public.search_logs (
 id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.search_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_logs FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF to_regclass('public.search_logs') IS NULL THEN RAISE EXCEPTION 'G026 search_logs compatibility shell checkpoint failed: relation is absent' USING ERRCODE='P0001'; END IF;
END $$;
DO $$ BEGIN
 IF to_regclass('public.restaurants_duplicate') IS NOT NULL THEN RAISE EXCEPTION 'G026 Phase A restaurants_duplicate relation already exists' USING ERRCODE='P0001'; END IF;
END $$;
-- G026 non-historical compatibility shell: derived solely from the current strict grant and security-audit private-table contracts.
-- This shell exists only so 20260531084516 can revoke Data API access; it contains no production-derived fields, data, policies, or grants.
CREATE TABLE public.restaurants_duplicate (
 id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid()
);
ALTER TABLE public.restaurants_duplicate ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurants_duplicate FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF to_regclass('public.restaurants_duplicate') IS NULL THEN RAISE EXCEPTION 'G026 restaurants_duplicate compatibility shell checkpoint failed: relation is absent' USING ERRCODE='P0001'; END IF;
END $$;
DO $$ BEGIN
 IF to_regclass('public.user_bookmarks') IS NOT NULL THEN RAISE EXCEPTION 'G026 Phase A user bookmarks relation already exists' USING ERRCODE='P0001'; END IF;
END $$;
-- G026 provenance begin: HISTORICAL_SOURCES.v1.zip:supabase/migrations/temp/20251226_user_bookmarks.sql sha1=1dd4894d0367a2ab1b5791bba28dc982be801c0e sha256=accd6b079af87270a4768211a93a224e285b778c661b8d2b3e30b2c40806598d
-- 북마크 테이블 생성
CREATE TABLE IF NOT EXISTS public.user_bookmarks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT unique_user_restaurant_bookmark UNIQUE(user_id, restaurant_id)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_user_bookmarks_user_id ON public.user_bookmarks(user_id);
CREATE INDEX IF NOT EXISTS idx_user_bookmarks_restaurant_id ON public.user_bookmarks(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_user_bookmarks_created_at ON public.user_bookmarks(created_at DESC);

-- RLS 활성화
ALTER TABLE public.user_bookmarks ENABLE ROW LEVEL SECURITY;

-- RLS 정책: 사용자는 자신의 북마크만 조회 가능
CREATE POLICY "Users can view their own bookmarks"
ON public.user_bookmarks FOR SELECT
USING (auth.uid() = user_id);

-- RLS 정책: 사용자는 자신의 북마크만 생성 가능
CREATE POLICY "Users can create their own bookmarks"
ON public.user_bookmarks FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- RLS 정책: 사용자는 자신의 북마크만 삭제 가능
CREATE POLICY "Users can delete their own bookmarks"
ON public.user_bookmarks FOR DELETE
USING (auth.uid() = user_id);

-- 테이블 코멘트
COMMENT ON TABLE public.user_bookmarks IS '사용자 맛집 북마크';
COMMENT ON COLUMN public.user_bookmarks.user_id IS '북마크한 사용자 ID';
COMMENT ON COLUMN public.user_bookmarks.restaurant_id IS '북마크된 맛집 ID';
COMMENT ON COLUMN public.user_bookmarks.created_at IS '북마크 생성 시간';
-- G026 provenance end: exact historical member above
-- G026 provenance begin: HISTORICAL_SOURCES.v1.zip:supabase/migrations/temp/20251229_create_ad_banners_table.sql sha256=dc4631c104dab83add16b459ab72f509bbf3647565f320dc942d76f64d4af7d4
-- 광고 배너 테이블 생성
-- 사이드바 및 모바일/태블릿 팝업에서 표시되는 광고 배너를 관리합니다.

CREATE TABLE IF NOT EXISTS ad_banners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    image_url TEXT,
    link_url TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    priority INTEGER NOT NULL DEFAULT 0,
    display_target TEXT[] NOT NULL DEFAULT ARRAY['sidebar', 'mobile_popup'],
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_ad_banners_is_active ON ad_banners(is_active);
CREATE INDEX IF NOT EXISTS idx_ad_banners_priority ON ad_banners(priority DESC);
CREATE INDEX IF NOT EXISTS idx_ad_banners_display_target ON ad_banners USING GIN(display_target);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_ad_banners_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_ad_banners_updated_at ON ad_banners;
CREATE TRIGGER trigger_ad_banners_updated_at
    BEFORE UPDATE ON ad_banners
    FOR EACH ROW
    EXECUTE FUNCTION update_ad_banners_updated_at();

-- RLS 활성화
ALTER TABLE ad_banners ENABLE ROW LEVEL SECURITY;

-- RLS 정책: 모든 사용자가 활성화된 배너 조회 가능
CREATE POLICY "ad_banners_select_active" ON ad_banners
    FOR SELECT
    USING (is_active = true);

-- RLS 정책: 관리자만 모든 배너 조회 가능
CREATE POLICY "ad_banners_select_admin" ON ad_banners
    FOR SELECT
    USING (public.is_user_admin(auth.uid()));

-- RLS 정책: 관리자만 배너 생성 가능
CREATE POLICY "ad_banners_insert_admin" ON ad_banners
    FOR INSERT
    WITH CHECK (public.is_user_admin(auth.uid()));

-- RLS 정책: 관리자만 배너 수정 가능
CREATE POLICY "ad_banners_update_admin" ON ad_banners
    FOR UPDATE
    USING (public.is_user_admin(auth.uid()));

-- RLS 정책: 관리자만 배너 삭제 가능
CREATE POLICY "ad_banners_delete_admin" ON ad_banners
    FOR DELETE
    USING (public.is_user_admin(auth.uid()));

-- 초기 더미 데이터 (선택적)
INSERT INTO ad_banners (title, description, display_target, priority, is_active)
VALUES 
    ('광고주 모집', '귀하의 맛집을\n천하에 널리 알리옵소서', ARRAY['sidebar', 'mobile_popup'], 100, true),
    ('명당 자리', '수많은 미식가들이\n오가는 길목이옵니다', ARRAY['sidebar', 'mobile_popup'], 90, true),
    ('동반 성장', '쯔동여지도와 더불어\n큰 뜻을 펼치시옵소서', ARRAY['sidebar', 'mobile_popup'], 80, true);

-- 코멘트 추가
COMMENT ON TABLE ad_banners IS '광고 배너 테이블 - 사이드바 및 모바일/태블릿 팝업에서 표시';
COMMENT ON COLUMN ad_banners.display_target IS '표시 위치: sidebar, mobile_popup';
COMMENT ON COLUMN ad_banners.priority IS '우선순위 (높을수록 먼저 표시)';
-- G026 provenance end: exact historical member above
ALTER TABLE public.restaurants RENAME COLUMN name TO approved_name;
ALTER TABLE public.restaurants RENAME COLUMN unique_id TO trace_id;
ALTER TABLE public.restaurants ADD COLUMN search_count integer DEFAULT 0;
ALTER TABLE public.restaurants ADD COLUMN weekly_search_count integer DEFAULT 0;
ALTER TABLE public.restaurants ADD COLUMN origin_name text;
ALTER TABLE public.restaurants ADD COLUMN naver_name text;
ALTER TABLE public.restaurants ADD COLUMN trace_id_name_source text;
ALTER TABLE public.restaurants ADD COLUMN channel_name text;
ALTER TABLE public.restaurants ADD COLUMN description_map_url text;
ALTER TABLE public.restaurants ADD COLUMN recollect_version jsonb;
ALTER TABLE public.restaurants DROP CONSTRAINT restaurants_name_check;
ALTER TABLE public.restaurants DROP CONSTRAINT restaurants_unique_id_key;
ALTER TABLE public.restaurants DROP CONSTRAINT IF EXISTS restaurants_status_check;
ALTER TABLE public.restaurants ADD CONSTRAINT restaurants_approved_name_check CHECK (approved_name IS NULL OR length(approved_name) BETWEEN 1 AND 100), ADD CONSTRAINT restaurants_trace_id_key UNIQUE(trace_id);
CREATE TABLE public.document_embeddings (id serial PRIMARY KEY,video_id text NOT NULL,chunk_index integer NOT NULL,recollect_id integer NOT NULL DEFAULT 0,page_content text NOT NULL,embedding extensions.vector(1536),metadata jsonb DEFAULT '{}'::jsonb,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),CONSTRAINT document_embeddings_video_id_chunk_index_key UNIQUE(video_id,chunk_index));
CREATE INDEX idx_embeddings_video_id ON public.document_embeddings(video_id);
CREATE TABLE public.restaurants_backup (id uuid NOT NULL DEFAULT extensions.gen_random_uuid(),name text,phone text,categories text[],lat numeric,lng numeric,road_address text,jibun_address text,english_address text,address_elements jsonb NOT NULL DEFAULT '{}'::jsonb,origin_address jsonb,youtube_meta jsonb,unique_id text,reasoning_basis text,evaluation_results jsonb,source_type text,geocoding_false_stage integer,db_error_message text,db_error_details jsonb,tzuyang_review text,youtube_link text,geocoding_success boolean NOT NULL DEFAULT false,status text NOT NULL DEFAULT 'pending',is_missing boolean NOT NULL DEFAULT false,is_not_selected boolean NOT NULL DEFAULT false,review_count integer NOT NULL DEFAULT 0,created_by uuid,updated_by_admin_id uuid,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),search_count integer NOT NULL DEFAULT 0,weekly_search_count integer NOT NULL DEFAULT 0,CONSTRAINT restaurants_backup_pkey PRIMARY KEY(id),CONSTRAINT restaurants_backup_unique_id_key UNIQUE(unique_id),CONSTRAINT restaurants_backup_categories_check CHECK(categories IS NULL OR cardinality(categories) BETWEEN 1 AND 5),CONSTRAINT restaurants_backup_geocoding_false_stage_check CHECK(geocoding_false_stage IS NULL OR geocoding_false_stage IN(0,1,2)),CONSTRAINT restaurants_backup_geocoding_stage_check CHECK((geocoding_success AND geocoding_false_stage IS NULL) OR NOT geocoding_success),CONSTRAINT restaurants_backup_lat_check CHECK(lat IS NULL OR lat BETWEEN -90 AND 90),CONSTRAINT restaurants_backup_lng_check CHECK(lng IS NULL OR lng BETWEEN -180 AND 180),CONSTRAINT restaurants_backup_name_check CHECK(name IS NULL OR length(name) BETWEEN 1 AND 100),CONSTRAINT restaurants_backup_review_count_check CHECK(review_count >= 0),CONSTRAINT restaurants_backup_search_count_check CHECK(search_count >= 0),CONSTRAINT restaurants_backup_weekly_search_count_check CHECK(weekly_search_count >= 0),CONSTRAINT restaurants_backup_created_by_fkey FOREIGN KEY(created_by) REFERENCES auth.users(id) ON DELETE SET NULL,CONSTRAINT restaurants_backup_updated_by_admin_id_fkey FOREIGN KEY(updated_by_admin_id) REFERENCES auth.users(id) ON DELETE SET NULL);
ALTER TABLE public.restaurants_backup OWNER TO postgres;
ALTER TABLE public.restaurants_backup ENABLE ROW LEVEL SECURITY; ALTER TABLE public.restaurants_backup FORCE ROW LEVEL SECURITY; REVOKE ALL ON public.restaurants_backup FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.restaurant_submission_items ADD COLUMN target_restaurant_id uuid, ADD CONSTRAINT restaurant_submission_items_target_restaurant_id_fkey FOREIGN KEY(target_restaurant_id) REFERENCES public.restaurants_backup(id) ON DELETE SET NULL;
CREATE INDEX idx_submission_items_target_restaurant_id ON public.restaurant_submission_items(target_restaurant_id) WHERE target_restaurant_id IS NOT NULL;
ALTER TABLE public.restaurant_submission_items DROP CONSTRAINT IF EXISTS items_approved_link_check;
ALTER TABLE public.restaurant_submission_items ADD CONSTRAINT items_approved_target_restaurant_check CHECK(item_status <> 'approved' OR target_restaurant_id IS NOT NULL);
COMMIT;
