-- Converge backend-owned Supabase schema with objects used by the web runtime.
-- This is a new immutable migration. It deliberately does not edit or replay
-- the legacy apps/web migration chain.

CREATE TABLE IF NOT EXISTS public.youtube_channel_kpi_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id text NOT NULL,
  channel_title text,
  channel_handle text,
  subscriber_count bigint,
  view_count bigint,
  video_count integer,
  hidden_subscriber_count boolean NOT NULL DEFAULT false,
  previous_bucket_started_at timestamptz,
  subscriber_delta bigint,
  view_delta bigint,
  video_delta integer,
  bucket_started_at timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  source text NOT NULL DEFAULT 'youtube-data-api',
  CONSTRAINT youtube_channel_kpi_snapshots_bucket_unique
    UNIQUE (channel_id, bucket_started_at),
  CONSTRAINT youtube_channel_kpi_snapshots_non_negative_counts CHECK (
    (subscriber_count IS NULL OR subscriber_count >= 0)
    AND (view_count IS NULL OR view_count >= 0)
    AND (video_count IS NULL OR video_count >= 0)
  )
);

ALTER TABLE public.youtube_channel_kpi_snapshots
  ADD COLUMN IF NOT EXISTS previous_bucket_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS subscriber_delta bigint,
  ADD COLUMN IF NOT EXISTS view_delta bigint,
  ADD COLUMN IF NOT EXISTS video_delta integer;

CREATE INDEX IF NOT EXISTS youtube_channel_kpi_snapshots_latest_idx
  ON public.youtube_channel_kpi_snapshots (channel_id, bucket_started_at DESC);

CREATE INDEX IF NOT EXISTS youtube_channel_kpi_snapshots_previous_bucket_idx
  ON public.youtube_channel_kpi_snapshots (channel_id, previous_bucket_started_at DESC)
  WHERE previous_bucket_started_at IS NOT NULL;

ALTER TABLE public.youtube_channel_kpi_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.youtube_channel_kpi_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.youtube_channel_kpi_snapshots TO service_role;

CREATE TABLE IF NOT EXISTS public.youtube_video_kpi_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id text NOT NULL,
  channel_id text NOT NULL,
  title text NOT NULL DEFAULT '제목 없음',
  published_at timestamptz,
  category_id text,
  duration_seconds integer NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  view_count bigint NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  like_count bigint NOT NULL DEFAULT 0 CHECK (like_count >= 0),
  comment_count bigint NOT NULL DEFAULT 0 CHECK (comment_count >= 0),
  bucket_started_at timestamptz NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  source text NOT NULL DEFAULT 'youtube-data-api',
  CONSTRAINT youtube_video_kpi_snapshots_bucket_unique
    UNIQUE (video_id, bucket_started_at)
);

CREATE INDEX IF NOT EXISTS youtube_video_kpi_snapshots_latest_idx
  ON public.youtube_video_kpi_snapshots (bucket_started_at DESC, published_at DESC);

CREATE INDEX IF NOT EXISTS youtube_video_kpi_snapshots_bucket_views_idx
  ON public.youtube_video_kpi_snapshots (bucket_started_at DESC, view_count DESC, video_id);

CREATE INDEX IF NOT EXISTS youtube_video_kpi_snapshots_video_idx
  ON public.youtube_video_kpi_snapshots (video_id, bucket_started_at DESC);

CREATE INDEX IF NOT EXISTS youtube_video_kpi_snapshots_channel_idx
  ON public.youtube_video_kpi_snapshots (channel_id, bucket_started_at DESC);

ALTER TABLE public.youtube_video_kpi_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.youtube_video_kpi_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.youtube_video_kpi_snapshots TO service_role;

CREATE TABLE IF NOT EXISTS public.youtube_thumbnail_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_key text NOT NULL DEFAULT 'youtube-thumbnail-generator/current',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'revoked')),
  candidate_id text NOT NULL,
  source_manifest_id text NOT NULL,
  source_image_id text NOT NULL,
  storage_bucket text NOT NULL DEFAULT 'youtube-thumbnail-releases'
    CHECK (storage_bucket = 'youtube-thumbnail-releases'),
  storage_object_path text NOT NULL,
  browser_image_path text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  width integer NOT NULL DEFAULT 1280 CHECK (width = 1280),
  height integer NOT NULL DEFAULT 720 CHECK (height = 720),
  mime_type text NOT NULL DEFAULT 'image/png' CHECK (mime_type = 'image/png'),
  provider_id text NOT NULL DEFAULT 'local-codex' CHECK (provider_id = 'local-codex'),
  model text NOT NULL DEFAULT 'gpt-image-2' CHECK (model = 'gpt-image-2'),
  model_provenance text NOT NULL DEFAULT 'exact' CHECK (model_provenance = 'exact'),
  score numeric NOT NULL CHECK (score >= 90),
  issue_tags jsonb NOT NULL DEFAULT '["none"]'::jsonb,
  text_layers jsonb NOT NULL DEFAULT '[]'::jsonb,
  canvas jsonb NOT NULL DEFAULT '{"width":1280,"height":720}'::jsonb,
  source_quality_gate jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT youtube_thumbnail_releases_issue_tags_exact
    CHECK (issue_tags = '["none"]'::jsonb),
  CONSTRAINT youtube_thumbnail_releases_no_raw_paths CHECK (
    storage_object_path NOT LIKE '%.omx/%'
    AND storage_object_path NOT LIKE '%/public/%'
    AND browser_image_path NOT LIKE '%.omx/%'
    AND browser_image_path NOT LIKE '%/public/%'
  )
);

ALTER TABLE public.youtube_thumbnail_releases
  DROP CONSTRAINT IF EXISTS youtube_thumbnail_releases_browser_proxy;
ALTER TABLE public.youtube_thumbnail_releases
  ADD CONSTRAINT youtube_thumbnail_releases_browser_proxy CHECK (
    browser_image_path ~ '^/api/admin/youtube-thumbnail-generator/releases/assets/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );

ALTER TABLE public.youtube_thumbnail_releases
  DROP CONSTRAINT IF EXISTS youtube_thumbnail_releases_storage_object_path;
ALTER TABLE public.youtube_thumbnail_releases
  ADD CONSTRAINT youtube_thumbnail_releases_storage_object_path CHECK (
    storage_object_path ~ '^youtube-thumbnail-generator/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$'
  );

CREATE UNIQUE INDEX IF NOT EXISTS youtube_thumbnail_releases_active_key_idx
  ON public.youtube_thumbnail_releases (release_key)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS youtube_thumbnail_releases_key_published_idx
  ON public.youtube_thumbnail_releases (release_key, published_at DESC);

CREATE INDEX IF NOT EXISTS youtube_thumbnail_releases_candidate_idx
  ON public.youtube_thumbnail_releases (candidate_id);

ALTER TABLE public.youtube_thumbnail_releases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.youtube_thumbnail_releases FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.youtube_thumbnail_releases TO service_role;

CREATE OR REPLACE FUNCTION public.publish_youtube_thumbnail_release(
  p_id uuid,
  p_release_key text,
  p_candidate_id text,
  p_source_manifest_id text,
  p_source_image_id text,
  p_storage_bucket text,
  p_storage_object_path text,
  p_browser_image_path text,
  p_sha256 text,
  p_score numeric,
  p_issue_tags jsonb,
  p_text_layers jsonb,
  p_canvas jsonb,
  p_source_quality_gate jsonb,
  p_published_by uuid,
  p_published_at timestamptz
)
RETURNS public.youtube_thumbnail_releases
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_release public.youtube_thumbnail_releases;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_release_key, 0)
  );

  UPDATE public.youtube_thumbnail_releases
     SET status = 'superseded',
         superseded_at = p_published_at,
         updated_at = p_published_at
   WHERE release_key = p_release_key
     AND status = 'active';

  INSERT INTO public.youtube_thumbnail_releases (
    id, release_key, status, candidate_id, source_manifest_id, source_image_id,
    storage_bucket, storage_object_path, browser_image_path, sha256,
    width, height, mime_type, provider_id, model, model_provenance,
    score, issue_tags, text_layers, canvas, source_quality_gate,
    published_by, published_at, created_at, updated_at
  ) VALUES (
    p_id, p_release_key, 'active', p_candidate_id, p_source_manifest_id,
    p_source_image_id, p_storage_bucket, p_storage_object_path,
    p_browser_image_path, p_sha256, 1280, 720, 'image/png', 'local-codex',
    'gpt-image-2', 'exact', p_score, p_issue_tags, p_text_layers, p_canvas,
    p_source_quality_gate, p_published_by, p_published_at,
    p_published_at, p_published_at
  )
  RETURNING * INTO v_release;

  RETURN v_release;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_youtube_thumbnail_release(
  uuid, text, text, text, text, text, text, text, text, numeric,
  jsonb, jsonb, jsonb, jsonb, uuid, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_youtube_thumbnail_release(
  uuid, text, text, text, text, text, text, text, text, numeric,
  jsonb, jsonb, jsonb, jsonb, uuid, timestamptz
) TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('profile-avatars', 'profile-avatars', true, 2097152, ARRAY['image/*']::text[]),
  ('review-photos', 'review-photos', true, 5242880, ARRAY['image/*']::text[]),
  ('ad-banner-images', 'ad-banner-images', true, 52428800, ARRAY['image/*', 'video/*']::text[]),
  ('youtube-thumbnail-releases', 'youtube-thumbnail-releases', false, 10485760, ARRAY['image/png']::text[])
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types,
  updated_at = timezone('utc', now());

DROP POLICY IF EXISTS tzudong_public_media_read ON storage.objects;
CREATE POLICY tzudong_public_media_read
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id IN ('profile-avatars', 'review-photos', 'ad-banner-images'));

DROP POLICY IF EXISTS tzudong_profile_avatar_insert_own ON storage.objects;
CREATE POLICY tzudong_profile_avatar_insert_own
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'profile-avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
  );

DROP POLICY IF EXISTS tzudong_profile_avatar_update_own ON storage.objects;
CREATE POLICY tzudong_profile_avatar_update_own
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'profile-avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
  )
  WITH CHECK (
    bucket_id = 'profile-avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
  );

DROP POLICY IF EXISTS tzudong_profile_avatar_delete_own ON storage.objects;
CREATE POLICY tzudong_profile_avatar_delete_own
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'profile-avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
  );

DROP POLICY IF EXISTS tzudong_review_photo_insert_own ON storage.objects;
CREATE POLICY tzudong_review_photo_insert_own
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'review-photos'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
  );

DROP POLICY IF EXISTS tzudong_review_photo_update_own ON storage.objects;
CREATE POLICY tzudong_review_photo_update_own
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'review-photos'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
  )
  WITH CHECK (
    bucket_id = 'review-photos'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
  );

DROP POLICY IF EXISTS tzudong_review_photo_delete_own ON storage.objects;
CREATE POLICY tzudong_review_photo_delete_own
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'review-photos'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
  );

DROP POLICY IF EXISTS tzudong_ad_banner_insert_admin ON storage.objects;
CREATE POLICY tzudong_ad_banner_insert_admin
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ad-banner-images'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
    AND EXISTS (
      SELECT 1 FROM public.user_roles AS role_row
      JOIN public.user_account_status AS status_row
        ON status_row.user_id = role_row.user_id
      WHERE role_row.user_id = (SELECT auth.uid())
        AND role_row.role::text = 'admin'
        AND status_row.account_status = 'active'
    )
  );

DROP POLICY IF EXISTS tzudong_ad_banner_update_admin ON storage.objects;
CREATE POLICY tzudong_ad_banner_update_admin
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'ad-banner-images'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
    AND EXISTS (
      SELECT 1 FROM public.user_roles AS role_row
      JOIN public.user_account_status AS status_row
        ON status_row.user_id = role_row.user_id
      WHERE role_row.user_id = (SELECT auth.uid())
        AND role_row.role::text = 'admin'
        AND status_row.account_status = 'active'
    )
  )
  WITH CHECK (
    bucket_id = 'ad-banner-images'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
    AND EXISTS (
      SELECT 1 FROM public.user_roles AS role_row
      JOIN public.user_account_status AS status_row
        ON status_row.user_id = role_row.user_id
      WHERE role_row.user_id = (SELECT auth.uid())
        AND role_row.role::text = 'admin'
        AND status_row.account_status = 'active'
    )
  );

DROP POLICY IF EXISTS tzudong_ad_banner_delete_admin ON storage.objects;
CREATE POLICY tzudong_ad_banner_delete_admin
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'ad-banner-images'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
    AND EXISTS (
      SELECT 1 FROM public.user_roles AS role_row
      JOIN public.user_account_status AS status_row
        ON status_row.user_id = role_row.user_id
      WHERE role_row.user_id = (SELECT auth.uid())
        AND role_row.role::text = 'admin'
        AND status_row.account_status = 'active'
    )
  );

DO $$
DECLARE
  v_table text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    RAISE EXCEPTION 'local_runtime_supabase_realtime_missing';
  END IF;

  FOREACH v_table IN ARRAY ARRAY['notifications', 'review_likes', 'reviews']
  LOOP
    IF pg_catalog.to_regclass(pg_catalog.format('public.%I', v_table)) IS NULL THEN
      RAISE EXCEPTION 'local_runtime_realtime_table_missing: %', v_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = v_table
    ) THEN
      EXECUTE pg_catalog.format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
        v_table
      );
    END IF;
  END LOOP;
END
$$;

NOTIFY pgrst, 'reload schema';
